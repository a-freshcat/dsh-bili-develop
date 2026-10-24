"""Video comments with explicit UID mentions, bounded verification and one POST."""
import asyncio
import json
import re
import unicodedata
from bilibili_api import Credential, user, video, comment
from bilibili_api.utils.network import Api, request_settings


class PublishError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


async def target(params, cred, resolve_mentions=True):
    cred.raise_for_no_sessdata()
    account = str((await user.get_self_info(cred)).get("mid", ""))
    if not re.fullmatch(r"[1-9]\d{0,19}", account) or account != params.get("expected_account"):
        raise PublishError("COMMENT_PREFLIGHT", "登录账号与草稿账号不同，未发送。")
    bvid = params.get("bvid", "")
    if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
        raise PublishError("COMMENT_PREFLIGHT", "视频标识无效。")
    info = await video.Video(bvid=bvid, credential=cred).get_info()
    oid = str(info.get("aid", ""))
    if info.get("bvid", bvid) != bvid or not re.fullmatch(r"[1-9]\d*", oid):
        raise PublishError("COMMENT_PREFLIGHT", "平台视频标识不匹配，未发送。")
    mentions = params.get("mentions", [])
    if not isinstance(mentions, list) or len(mentions) > 3:
        raise PublishError("COMMENT_PREFLIGHT", "提及人数无效。")
    names, uids = set(), set()
    for item in mentions:
        if not isinstance(item, dict):
            raise PublishError("COMMENT_PREFLIGHT", "提及对象格式无效。")
        uid, name = item.get("uid"), item.get("name")
        if (not isinstance(uid, str) or not re.fullmatch(r"[1-9]\d{0,19}", uid) or uid in uids
                or not isinstance(name, str) or not 1 <= len(name) <= 80 or re.search(r"[\s@＠\0]", name) or name in names):
            raise PublishError("COMMENT_PREFLIGHT", "提及UID、昵称或重复对象无效。")
        if resolve_mentions:
            profile = await user.User(int(uid), credential=cred).get_user_info()
            if str(profile.get("mid", "")) != uid or profile.get("name") != name:
                raise PublishError("COMMENT_PREFLIGHT", "提及账号昵称已变化，请重新解析并更新预览。")
            try:
                relation = await Api(url="https://api.bilibili.com/x/relation", method="GET", verify=True,
                                     credential=cred).update_params(fid=int(uid)).result
            except Exception:
                raise PublishError("COMMENT_PREFLIGHT", "暂时无法确认提及对象的关注关系，未发送；请稍后检查。") from None
            if not isinstance(relation, dict) or str(relation.get("mid", "")) != uid or type(relation.get("attribute")) is not int:
                raise PublishError("COMMENT_PREFLIGHT", "关注关系返回无效，未发送。")
            if relation["attribute"] not in (2, 6):
                raise PublishError("COMMENT_PREFLIGHT", "尚未关注提及对象“" + name + "”；请先用发送账号在B站关注，或取消本次提及。未发送。")
        uids.add(uid)
        names.add(name)
    return {"accountUid": account, "bvid": bvid, "oid": oid, "mentions": mentions}


def mention_state(reply, mentions):
    if not mentions:
        return "none"
    content = (reply or {}).get("content") or {}
    members = {str(member.get("mid", "")) for member in content.get("members", []) if isinstance(member, dict)}
    mapping = content.get("at_name_to_mid") or {}
    if isinstance(mapping, dict):
        members.update(str(uid) for uid in mapping.values())
    return "rendered" if all(t["uid"] in members for t in mentions) else "unverified"


def safe_platform_hint(value):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"https?://\S+", "[链接已省略]", value)
    value = re.sub(r"(?i)\b(sessdata|bili_jct|csrf(?:_token)?|access_key|access_token|refresh_token|cookie|authorization)\b\s*[:=]\s*[^\s,;]+", r"\1=[已省略]", value)
    return re.sub(r"[\x00-\x1f\x7f]", " ", value).strip()[:200]


def platform_feedback(data, reply):
    feedback = {"captured": True}
    hint = safe_platform_hint(data.get("success_toast"))
    if hint:
        feedback["toast"] = hint
    for key, value in (("needCaptcha", data.get("need_captcha")), ("invisible", reply.get("invisible"))):
        if type(value) is bool or type(value) is int and value in (0, 1):
            feedback[key] = bool(value)
    for key, value in (("successAction", data.get("success_action")), ("replyState", reply.get("state"))):
        if type(value) is int and -(2 ** 31) <= value < 2 ** 31:
            feedback[key] = value
    return feedback


def message_matches(actual, expected, mentions):
    if actual == expected:
        return True
    if not isinstance(actual, str) or not mentions:
        return False
    # Bilibili can remove the terminal ASCII space from our declared @ suffix.
    # Keep the body, line breaks, nicknames and spaces between mentions exact.
    suffix = "\n" + "".join("@" + t["name"] + " " for t in mentions)
    return expected.endswith(suffix) and actual == expected.rstrip(" ")


async def anonymous_list_sample(found, text, receipt):
    try:
        # No login, no receipt/seek parameter: a direct permalink can show a
        # comment which is absent from the ordinary latest list.
        page = await asyncio.wait_for(comment.get_comments_lazy(
            int(found["oid"]), comment.CommentResourceType.VIDEO,
            order=comment.OrderType.TIME, credential=Credential()), timeout=10)
        rows = page.get("replies") or []
        if not isinstance(rows, list):
            return {"state": "unavailable"}
        rows = rows[:20]
        present = any(isinstance(row, dict)
                      and str(row.get("rpid_str") or row.get("rpid") or "") == receipt
                      and str((row.get("member") or {}).get("mid", row.get("mid", ""))) == found["accountUid"]
                      and message_matches((row.get("content") or {}).get("message"), text, found["mentions"])
                      for row in rows)
        return {"state": "found" if present else "not_in_sample", "sampleCount": len(rows)}
    except Exception:
        return {"state": "unavailable"}


def interaction_row(row, root=None):
    if not isinstance(row, dict):
        return None
    rid = str(row.get("rpid_str") or row.get("rpid") or "")
    uid = str((row.get("member") or {}).get("mid", ""))
    text = (row.get("content") or {}).get("message")
    if (not re.fullmatch(r"[1-9]\d{0,29}", rid) or not re.fullmatch(r"[1-9]\d{0,19}", uid)
            or not isinstance(text, str) or not text.strip() or len(text) > 500 or "\0" in text):
        return None
    if root and str(row.get("root_str") or row.get("root") or "") != root:
        return None
    return {"id": rid, "root": root or rid, "uid": uid, "text": text, "level": "sub" if root else "top"}


async def thread(found, root, cred):
    return await comment.Comment(int(found["oid"]), comment.CommentResourceType.VIDEO, int(root), credential=cred).get_sub_comments(page_index=1, page_size=20)


async def scan_interactions(params, cred):
    keys = params.get("keywords", [])
    if not keys:
        return {"disabled": True, "matches": []}
    if (not isinstance(keys, list) or len(keys) > 20 or any(not isinstance(k, str) or not k.strip() or len(k) > 100 or "\0" in k for k in keys)
            or any(type(params.get(k, 1)) is not int or not 0 <= params.get(k, 1) <= 5 for k in ("top_limit", "sub_limit"))):
        raise PublishError("INTERACTION_CONFIG", "互动关键词或次数无效。")
    if params.get("top_limit", 1) == 0 and params.get("sub_limit", 1) == 0:
        return {"disabled": True, "matches": []}
    found = await target(params, cred)
    keys = [unicodedata.normalize("NFKC", k).strip().lower() for k in keys]
    page = await comment.get_comments(int(found["oid"]), comment.CommentResourceType.VIDEO, page_index=1, order=comment.OrderType.TIME, credential=cred)
    roots = (page.get("replies") or [])[:20]
    matches, seen, sub_count, failed = [], set(), 0, 0

    def collect(raw, root=None):
        row = interaction_row(raw, root)
        if row and row["uid"] != found["accountUid"] and row["id"] not in seen and any(k in unicodedata.normalize("NFKC", row["text"]).lower() for k in keys):
            seen.add(row["id"])
            matches.append({**row, "name": str((raw.get("member") or {}).get("uname", ""))[:80],
                            "url": "https://www.bilibili.com/video/" + found["bvid"] + "/#reply" + row["id"]})
    for raw in roots:
        if params.get("top_limit", 1):
            collect(raw)
    if params.get("sub_limit", 1):
        examined = 0
        for raw in roots:
            row = interaction_row(raw)
            if not row or not (raw.get("rcount") or raw.get("replies")):
                continue
            examined += 1
            try:
                data = await thread(found, row["id"], cred)
                replies = (data.get("replies") or [])[:20]
                sub_count += len(replies)
                for reply in replies:
                    collect(reply, row["id"])
            except Exception:
                failed += 1
            if examined >= 3:
                break
    return {**found, "matches": matches[:80], "topRead": len(roots), "subRead": sub_count, "failedThreads": failed, "threadLimit": 3}


async def reply_context(params, found, cred):
    t = params.get("target")
    if (not isinstance(t, dict) or any(not isinstance(t.get(k), str) or not re.fullmatch(r"[1-9]\d{0,29}", t[k]) for k in ("id", "root", "uid"))
            or t.get("level") not in ("top", "sub") or (t["id"] == t["root"]) != (t["level"] == "top")):
        raise PublishError("COMMENT_PREFLIGHT", "互动目标标识无效，未发送。")
    data = await thread(found, t["root"], cred)
    rows = [data.get("root")] if t["level"] == "top" else (data.get("replies") or [])[:20]
    for raw in rows:
        row = interaction_row(raw, t["root"] if t["level"] == "sub" else None)
        if row == t and row["uid"] != found["accountUid"]:
            return row, data
    raise PublishError("COMMENT_PREFLIGHT", "互动原评论已变化、不可读或不在当前样本中，未发送。")


async def dispatch(method, params, cred):
    if method == "interaction_scan":
        return await scan_interactions(params, cred)
    if method == 'comment_feedback':
        found = await target(params, cred, resolve_mentions=False)
        own_id, root_id, at = params.get('comment_id'), params.get('root_id'), params.get('attempted_at')
        if any(not isinstance(v, str) or not re.fullmatch(r'[1-9]\d{0,29}', v) for v in (own_id, root_id)) or type(at) is not int:
            raise PublishError('FEEDBACK_SOURCE', '原评论标识或时间无效，未采集反馈。')
        data = await thread(found, root_id, cred)
        raw_rows = [data.get('root')] + (data.get('replies') or [])[:20]
        original = next((r for r in raw_rows if isinstance(r, dict) and str(r.get('rpid_str') or r.get('rpid')) == own_id), None)
        if (not original or str((original.get('member') or {}).get('mid', original.get('mid', ''))) != found['accountUid'] or
                not message_matches((original.get('content') or {}).get('message'), params.get('text'), found['mentions'])):
            raise PublishError('FEEDBACK_SOURCE', '未找到本人原评论及匹配正文，不采集其他评论的反馈。')
        replies = []
        for raw in (data.get('replies') or [])[:20]:
            row = interaction_row(raw, root_id)
            if (row and row['uid'] != found['accountUid'] and str(raw.get('parent_str') or raw.get('parent')) == own_id and
                    type(raw.get('ctime')) in (int, float) and raw['ctime'] * 1000 >= at - 2000):
                replies.append({'id': row['id'], 'parent': own_id, 'uid': row['uid'], 'text': row['text']})
        return {'accountUid': found['accountUid'], 'bvid': found['bvid'], 'commentId': own_id, 'replies': replies}
    reply_method = method.startswith("comment_reply_")
    method = method.replace("comment_reply_", "comment_") if reply_method else method
    found = await target(params, cred, resolve_mentions=method != "comment_verify")
    reply_page = None
    if reply_method:
        t, reply_page = await reply_context(params, found, cred)
        found["target"] = t
        if found["mentions"]:
            raise PublishError("COMMENT_PREFLIGHT", "关键词回复不附加额外提及对象。")
    if method == "comment_probe":
        # Reading comments can reveal closed/unavailable sections; it is not proof of posting permission.
        if not reply_method:
            await comment.get_comments(int(found["oid"]), comment.CommentResourceType.VIDEO, page_index=1, order=comment.OrderType.TIME, credential=cred)
        return found
    text = params.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 1000 or "\0" in text:
        raise PublishError("COMMENT_PREFLIGHT", "最终评论文字无效。")
    suffix = "\n" + "".join("@" + t["name"] + " " for t in found["mentions"]) if found["mentions"] else ""
    body = text[:-len(suffix)] if suffix and text.endswith(suffix) else text if not suffix else None
    if body is None or not body.strip() or re.search(r"[@＠]", body):
        raise PublishError("COMMENT_PREFLIGHT", "最终文案含未声明的提及或与预览不匹配。")
    if method == "comment_verify":
        at = params.get("attempted_at")
        if type(at) is not int or at < 0:
            raise PublishError("COMMENT_VERIFY", "发送时间无效。")
        data = reply_page if reply_method else await comment.get_comments(int(found["oid"]), comment.CommentResourceType.VIDEO, page_index=1, order=comment.OrderType.TIME, credential=cred)
        matches = {}
        for row in (data.get("replies") or [])[:20]:
            rid = str(row.get("rpid_str") or row.get("rpid") or "")
            author = str((row.get("member") or {}).get("mid", row.get("mid", "")))
            if (author == found["accountUid"] and message_matches((row.get("content") or {}).get("message"), text, found["mentions"])
                    and (not reply_method or (str(row.get("root_str") or row.get("root")) == found["target"]["root"] and str(row.get("parent_str") or row.get("parent")) == found["target"]["id"]))
                    and type(row.get("ctime")) in (int, float) and at - 2000 <= row["ctime"] * 1000 <= at + 300000
                    and re.fullmatch(r"[1-9]\d*", rid) and (not params.get("receipt") or params["receipt"] == rid)):
                matches[rid] = row
        rid = next(iter(matches)) if len(matches) == 1 else ""
        return {**found, "confirmed": bool(rid), "receipt": rid,
                **({"publicList": await anonymous_list_sample(found, text, rid)} if rid and not reply_method else {}),
                "mentionState": mention_state(matches.get(rid), found["mentions"])}
    if method != "comment_publish" or params.get("oid") != found["oid"]:
        raise PublishError("COMMENT_PREFLIGHT", "发送目标与预览不匹配，未发送。")
    cred.raise_for_no_bili_jct()
    from privacy_guard import assert_outgoing
    try:
        assert_outgoing(text, cred)
    except ValueError:
        raise PublishError('PRIVACY_BLOCKED', '评论疑似夹带账号凭据，已阻止；未发送。') from None
    payload = dict(
        oid=int(found["oid"]), type=1, message=text, plat=1, gaia_source="main_web",
        statistics=json.dumps({"appId": 100, "platform": 5}),
        at_name_to_mid=json.dumps({t["name"]: int(t["uid"]) for t in found["mentions"]}, ensure_ascii=False))
    if reply_method:
        payload.update(root=int(found["target"]["root"]), parent=int(found["target"]["id"]))
    api = Api(**comment.API["comment"]["send"], credential=cred).update_data(**payload)
    previous = request_settings.get_wbi_retry_times()
    request_settings.set_wbi_retry_times(1)
    try:
        data = await api.result
    except Exception as error:
        if type(getattr(error, "code", None)) is int:
            hint = safe_platform_hint(getattr(error, "msg", None))
            raise PublishError("COMMENT_REJECTED", "平台拒绝本次评论（代码" + str(error.code) + "）" +
                               ("：" + hint if hint else "，请检查账号或评论区限制") + "。") from None
        raise PublishError("COMMENT_UNKNOWN", "未确认平台回执，请先核对评论，不自动重发。") from None
    finally:
        request_settings.set_wbi_retry_times(previous)
    data = data if isinstance(data, dict) else {}
    rid = str(data.get("rpid_str") or data.get("rpid") or "")
    reply = data.get("reply") if isinstance(data.get("reply"), dict) else {}
    feedback = platform_feedback(data, reply)
    confirmed = bool(re.fullmatch(r"[1-9]\d*", rid)) and feedback.get("needCaptcha") is not True and message_matches((reply.get("content") or {}).get("message"), text, found["mentions"])
    if reply_method:
        confirmed = confirmed and str(reply.get("root_str") or reply.get("root")) == found["target"]["root"] and str(reply.get("parent_str") or reply.get("parent")) == found["target"]["id"]
    return {**found, "confirmed": confirmed, "receipt": rid if confirmed else "",
            **({"receiptCandidate": rid} if not confirmed and re.fullmatch(r"[1-9]\d*", rid) else {}),
            "platformFeedback": feedback, "mentionState": mention_state(reply, found["mentions"])}
