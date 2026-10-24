"""Explicitly enabled following and proactive private messages; no retries."""
import hashlib
import json
import re
from bilibili_api import user, session
from bilibili_api.utils.network import request_settings
from privacy_guard import assert_outgoing


class RelationshipError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


async def probe(params, cred, include_thread=False):
    uid, expected = params.get('uid'), params.get('expected_account')
    if any(not isinstance(v, str) or not re.fullmatch(r'[1-9]\d{0,19}', v) for v in (uid, expected)) or uid == expected:
        raise RelationshipError('RELATION_TARGET', '关系操作账号或目标无效。')
    account = str((await user.get_self_info(credential=cred)).get('mid', ''))
    if account != expected:
        raise RelationshipError('ACCOUNT_CHANGED', '登录账号已变化，停止关系操作。')
    relation = await user.User(int(uid), credential=cred).get_relation()
    a, b = (relation.get('relation') or {}).get('attribute'), (relation.get('be_relation') or {}).get('attribute')
    if type(a) is not int or type(b) is not int or a not in (0, 2, 6, 128) or b not in (0, 2, 6, 128):
        raise RelationshipError('RELATION_TARGET', '无法核实双方关系，本次不操作。')
    result = {'accountUid': account, 'uid': uid, 'following': a in (2, 6), 'fan': b in (2, 6), 'blocked': a == 128 or b == 128}
    if include_thread:
        value = await session.fetch_session_msgs(int(uid), cred)
        messages = value.get('messages')
        if not isinstance(messages, list):
            raise RelationshipError('PROACTIVE_THREAD', '无法核实最近私信状态，未主动发送。')
        latest = max(messages[:100], key=lambda m: int(m.get('msg_seqno', 0)), default=None)
        if latest:
            if (not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', str(latest.get('msg_key', ''))) or
                    type(latest.get('timestamp')) not in (int, float)):
                raise RelationshipError('PROACTIVE_THREAD', '最近私信标识无效，未主动发送。')
            last = [str(latest['msg_key']), latest.get('msg_seqno'), latest['timestamp'], str(latest.get('sender_uid', ''))]
            result['latestAt'] = int(latest['timestamp'] * 1000)
        else:
            last = []; result['latestAt'] = 0
        result['threadVersion'] = hashlib.sha256(json.dumps(last, separators=(',', ':')).encode()).hexdigest()
    return result


async def dispatch(method, params, cred):
    proactive = method.startswith('dm_proactive_')
    found = await probe(params, cred, proactive)
    if method in ('relationship_probe', 'dm_proactive_probe'):
        return found
    if params.get('enabled') is not True or found['blocked'] or not (found['fan'] or found['uid'] == params.get('owner_uid')):
        raise RelationshipError('RELATION_DISABLED', '未获明确开启、对方不在认识范围或已屏蔽，未操作。')
    if method == 'follow_user':
        if found['following']:
            return {**found, 'confirmed': True, 'alreadyFollowed': True, 'attempted': False}
        old = request_settings.get_wbi_retry_times(); request_settings.set_wbi_retry_times(1)
        try:
            await user.User(int(found['uid']), credential=cred).modify_relation(user.RelationType.SUBSCRIBE)
            after = await probe(params, cred)
            return {**after, 'confirmed': after['following'], 'alreadyFollowed': False, 'attempted': True}
        except Exception:
            raise RelationshipError('FOLLOW_UNKNOWN', '关注结果未确认；本次尝试保留，不自动重复。') from None
        finally:
            request_settings.set_wbi_retry_times(old)
    if method != 'dm_proactive_send' or found.get('threadVersion') != params.get('thread_version'):
        raise RelationshipError('PROACTIVE_STALE', '私信会话已变化，未发送旧的主动问候。')
    text = params.get('reply')
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1000 or '\0' in text:
        raise RelationshipError('PROACTIVE_TEXT', '主动私信草稿无效。')
    try:
        assert_outgoing(text, cred)
    except ValueError:
        raise RelationshipError('PRIVACY_BLOCKED', '主动私信疑似夹带凭据，未发送。') from None
    old = request_settings.get_wbi_retry_times(); request_settings.set_wbi_retry_times(1)
    try:
        result = await session.send_msg(cred, int(found['uid']), session.EventType.TEXT, text)
    except Exception:
        raise RelationshipError('PROACTIVE_UNKNOWN', '主动私信结果未确认；保留尝试，不重发。') from None
    finally:
        request_settings.set_wbi_retry_times(old)
    receipt = str((result or {}).get('msg_key', ''))
    return {**found, 'confirmed': bool(re.fullmatch(r'[A-Za-z0-9_-]{1,100}', receipt)), 'receipt': receipt[:100]}
