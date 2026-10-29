"""Bounded replies on the authenticated account's own publications only."""
import json
import re
from bilibili_api import user, video, dynamic, comment
from bilibili_api.utils.network import Api, request_settings
from publishing import PublishError, interaction_row, platform_feedback
from privacy_guard import assert_outgoing


def number(value):
    return isinstance(value, str) and re.fullmatch(r"[1-9]\d{0,29}", value)


async def identity(params, cred):
    cred.raise_for_no_sessdata()
    uid = str((await user.get_self_info(cred)).get("mid", ""))
    if not number(uid) or uid != params.get("expected_account"):
        raise PublishError("ACCOUNT_CHANGED", "登录账号已变化，账号管理未发送。")
    return uid


async def resource(spec, uid, cred):
    if not isinstance(spec, dict):
        raise PublishError("ACCOUNT_RESOURCE", "账号内容标识无效。")
    if spec.get("type") == "video" and re.fullmatch(r"BV[0-9A-Za-z]{10}", spec.get("id", "")):
        info = await video.Video(bvid=spec["id"], credential=cred).get_info()
        if str((info.get("owner") or {}).get("mid", "")) != uid or info.get("bvid") != spec["id"]:
            raise PublishError("ACCOUNT_RESOURCE", "这个视频不属于当前登录账号。")
        result = dict(type="video", id=spec["id"], oid=str(info.get("aid", "")), commentType=1,
                      title=str(info.get("title", ""))[:160], url="https://www.bilibili.com/video/" + spec["id"] + "/")
    elif spec.get("type") == "dynamic" and number(spec.get("id")):
        info = await dynamic.Dynamic(int(spec["id"]), credential=cred).get_info()
        item = info.get("item", info)
        if str(item.get("id_str", "")) != spec["id"] or str(item.get("modules", {}).get("module_author", {}).get("mid", "")) != uid:
            raise PublishError("ACCOUNT_RESOURCE", "这条动态不属于当前登录账号。")
        basic = item.get("basic", {})
        kind = basic.get("comment_type")
        oid = str(basic.get("comment_id_str") or (spec["id"] if kind == 17 else ""))
        if kind not in (11, 12, 17):
            raise PublishError("ACCOUNT_RESOURCE", "该动态的评论类型暂不支持；视频投稿请从视频入口处理。")
        desc = item.get("modules", {}).get("module_dynamic", {}).get("desc") or {}
        result = dict(type="dynamic", id=spec["id"], oid=oid, commentType=kind,
                      title=str(desc.get("text") or "账号动态")[:160], url="https://t.bilibili.com/" + spec["id"])
    else:
        raise PublishError("ACCOUNT_RESOURCE", "只支持BV视频和B站动态标识。")
    if not number(result["oid"]):
        raise PublishError("ACCOUNT_RESOURCE", "平台未返回可核验的评论区标识。")
    return result


def row(raw, root=None):
    value = interaction_row(raw, root)
    if not value:
        return None
    at = raw.get("ctime")
    if not isinstance(at, int) or isinstance(at, bool) or at <= 0:
        return None
    return {**value, "at": at * 1000}


async def discussion(res, cred):
    kind = comment.CommentResourceType(res["commentType"])
    page = await comment.get_comments(int(res["oid"]), kind, page_index=1, order=comment.OrderType.TIME, credential=cred)
    roots = (page.get("replies") or [])[:20]
    result = []
    for raw in roots:
        top = row(raw)
        if top:
            result.append(top)
    # Fetch only the first five recent threads; do not crawl arbitrary subthreads.
    for top in result[:5]:
        sub = await comment.Comment(int(res["oid"]), kind, int(top["id"]), credential=cred).get_sub_comments(page_index=1, page_size=20)
        for raw in (sub.get("replies") or [])[:20]:
            value = row(raw, top["id"])
            if value:
                result.append(value)
    return result[:120]


async def target(params, uid, cred):
    res = await resource(params.get("resource"), uid, cred)
    requested = params.get("resource", {})
    if requested.get("oid") != res["oid"] or requested.get("commentType") != res["commentType"]:
        raise PublishError("ACCOUNT_RESOURCE", "评论区标识已变化，未发送。")
    t = params.get("target")
    if not isinstance(t, dict) or not all(number(t.get(k)) for k in ("id", "root", "uid")) or t.get("level") not in ("top", "sub"):
        raise PublishError("ACCOUNT_TARGET", "原留言标识无效。")
    page = await comment.Comment(int(res["oid"]), comment.CommentResourceType(res["commentType"]), int(t["root"]), credential=cred).get_sub_comments(page_index=1, page_size=20)
    rows = [page.get("root")] if t["level"] == "top" else (page.get("replies") or [])[:20]
    for raw in rows:
        actual = row(raw, t["root"] if t["level"] == "sub" else None)
        if actual == t and t["uid"] != uid:
            return res, t, page
    raise PublishError("ACCOUNT_TARGET", "原评论已变化、删除或不在当前可读样本内，未发送。")


async def dispatch(method, params, cred):
    uid = await identity(params, cred)
    if method == "account_resources":
        person = user.User(int(uid), credential=cred)
        values = []
        if params.get("videos", True):
            page = await person.get_videos(pn=1, ps=10)
            values += [{"type": "video", "id": x.get("bvid"), "title": str(x.get("title", ""))[:160]} for x in (page.get("list", {}).get("vlist") or [])[:10] if re.fullmatch(r"BV[0-9A-Za-z]{10}", x.get("bvid", ""))]
        if params.get("dynamics", True):
            page = await person.get_dynamics_new()
            values += [{"type": "dynamic", "id": x["id_str"], "title": "账号动态"} for x in (page.get("items") or [])[:10] if number(x.get("id_str")) and str(x.get("modules", {}).get("module_author", {}).get("mid", "")) == uid and x.get("basic", {}).get("comment_type") in (11, 12, 17)]
        return {"accountUid": uid, "resources": values}
    if method == "account_comments":
        res = await resource(params.get("resource"), uid, cred)
        return {"accountUid": uid, "resource": res, "comments": await discussion(res, cred)}
    if method not in ("account_reply_probe", "account_reply_publish", "account_reply_verify"):
        raise PublishError("ACCOUNT_METHOD", "不支持的账号管理操作。")
    res, t, page = await target(params, uid, cred)
    found = {"accountUid": uid, "resource": res, "target": t}
    if method == "account_reply_probe":
        return found
    text = params.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 1000 or "\0" in text or "@" in text or "＠" in text:
        raise PublishError("ACCOUNT_TEXT", "回复正文无效，不附加额外提及。")
    if method == "account_reply_verify":
        receipt = params.get("receipt", "")
        candidates = [x for x in (page.get("replies") or [])[:20] if isinstance(x, dict)
                      and str((x.get("member") or {}).get("mid", "")) == uid
                      and str(x.get("parent_str") or x.get("parent") or "") == t["id"]
                      and (x.get("content") or {}).get("message") == text
                      and (not receipt or str(x.get("rpid_str") or x.get("rpid") or "") == receipt)]
        rid = str(candidates[0].get("rpid_str") or candidates[0].get("rpid")) if len(candidates) == 1 else ""
        return {**found, "confirmed": bool(rid and number(rid)), "receipt": rid}
    cred.raise_for_no_bili_jct()
    try:
        assert_outgoing(text, cred)
    except ValueError:
        raise PublishError("PRIVACY_BLOCKED", "回复疑似包含凭据，未发送。") from None
    api = Api(**comment.API["comment"]["send"], credential=cred).update_data(
        oid=int(res["oid"]), type=res["commentType"], message=text, root=int(t["root"]), parent=int(t["id"]), plat=1, gaia_source="main_web")
    previous = request_settings.get_wbi_retry_times()
    request_settings.set_wbi_retry_times(1)
    try:
        data = await api.result
    finally:
        request_settings.set_wbi_retry_times(previous)
    data = data if isinstance(data, dict) else {}
    rid = str(data.get("rpid_str") or data.get("rpid") or "")
    feedback = platform_feedback(data, data.get("reply") if isinstance(data.get("reply"), dict) else {})
    confirmed = bool(number(rid)) and feedback.get("needCaptcha") is not True
    return {**found, "confirmed": confirmed, "receipt": rid if confirmed else "", "platformFeedback": feedback}
