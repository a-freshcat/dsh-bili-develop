"""Bounded text inbox and one-shot replies. Only the host policy admits a send."""
import json
import re
from bilibili_api import session, user
from bilibili_api.utils.network import request_settings


class PrivateError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def uid(value):
    text = str(value or "")
    if not re.fullmatch(r"[1-9]\d{0,19}", text):
        raise PrivateError("DM_UID", "私信账号标识无效。")
    return text


async def identity(cred, expected=None):
    cred.raise_for_no_sessdata()
    info = await user.get_self_info(cred)
    account = uid(info.get("mid"))
    if expected is not None and account != expected:
        raise PrivateError("ACCOUNT_CHANGED", "登录账号已变化，停止私信操作。")
    return account


def message(raw, account, talker):
    if not isinstance(raw, dict) or raw.get("msg_type") != 1 or raw.get("receiver_type") != 1:
        return None
    if str(raw.get("sender_uid")) != talker or str(raw.get("receiver_id")) != account or talker == account:
        return None
    key = str(raw.get("msg_key", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", key):
        return None
    content = raw.get("content")
    try:
        body = json.loads(content) if isinstance(content, str) else content
        text = body.get("content") if isinstance(body, dict) else None
    except (ValueError, TypeError):
        return None
    timestamp = raw.get("timestamp")
    if not isinstance(text, str) or not text.strip() or "\0" in text or len(text) > 2000 or type(timestamp) not in (int, float):
        return None
    return {"id": key, "uid": talker, "text": text, "at": int(timestamp * 1000)}


async def thread(cred, account, talker):
    found = await session.fetch_session_msgs(int(talker), cred)
    rows = found.get("messages") or []
    latest = max(rows, key=lambda r: int(r.get("msg_seqno", 0)), default=None)
    incoming = message(latest, account, talker)
    relation = await user.User(int(talker), credential=cred).get_relation()
    a = relation.get("relation", {}).get("attribute")
    b = relation.get("be_relation", {}).get("attribute")
    return {"accountUid": account, "uid": talker, "message": incoming,
            "fan": b in (2, 6), "blocked": a == 128 or b == 128}


async def dispatch(method, params, cred):
    account = await identity(cred, params.get("expected_account"))
    if method == "contacts_page":
        page = params.get("page", 1)
        if type(page) is not int or not 1 <= page <= 10000:
            raise PrivateError("CONTACT_PAGE", "粉丝页码无效。")
        value = await user.User(int(account), credential=cred).get_followers(pn=page, ps=100)
        rows = value.get("list") or []
        people = []
        for row in rows[:100]:
            try:
                people.append({"uid": uid(row.get("mid")), "name": str(row.get("uname", ""))[:80]})
            except PrivateError:
                continue
        return {"accountUid": account, "people": people, "page": page,
                "hasMore": len(rows) >= 100, "total": value.get("total")}
    if method == "dm_inbox":
        found = await session.get_sessions(cred, session_type=1)
        messages = []
        for row in (found.get("session_list") or [])[:20]:
            if row.get("session_type") != 1:
                continue
            try:
                talker = uid(row.get("talker_id"))
            except PrivateError:
                continue
            incoming = message(row.get("last_msg"), account, talker)
            if incoming:
                messages.append(incoming)
        return {"accountUid": account, "messages": messages, "scope": "latest_20_sessions"}
    talker = uid(params.get("uid"))
    if talker == account:
        raise PrivateError("DM_SELF", "不能向登录账号自身发送私信。")
    value = await thread(cred, account, talker)
    if method == "dm_thread":
        return value
    if method != "dm_reply":
        raise PrivateError("DM_METHOD", "私信操作无效。")
    if value["blocked"] or not (value["fan"] or talker == params.get("owner_uid")):
        raise PrivateError("DM_NOT_KNOWN", "对方不是粉丝或已屏蔽，停止回复。")
    if not value["message"] or value["message"]["id"] != params.get("message_id"):
        raise PrivateError("DM_STALE", "对话已有新消息、已人工回复或原消息不再可用，未发送旧草稿。")
    reply = params.get("reply")
    if not isinstance(reply, str) or not 1 <= len(reply.strip()) <= 1000 or "\0" in reply:
        raise PrivateError("DM_TEXT", "回复文字无效。")
    # No automatic HTTP/WBI retry for a mutation, including uncertain responses.
    from privacy_guard import assert_outgoing
    try:
        assert_outgoing(reply, cred)
    except ValueError:
        raise PrivateError('PRIVACY_BLOCKED', '私信草稿疑似夹带账号凭据，已阻止；未发送。') from None
    previous = request_settings.get_wbi_retry_times()
    request_settings.set_wbi_retry_times(1)
    try:
        result = await session.send_msg(cred, int(talker), session.EventType.TEXT, reply)
    finally:
        request_settings.set_wbi_retry_times(previous)
    receipt = str((result or {}).get("msg_key", ""))
    return {"accountUid": account, "uid": talker, "messageId": params["message_id"],
            "confirmed": bool(re.fullmatch(r"[A-Za-z0-9_-]{1,100}", receipt)), "receipt": receipt[:100]}
