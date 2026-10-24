"""SDK boundary fixtures only: never reads a real inbox or sends a real message."""
import importlib.util
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))

spec = importlib.util.spec_from_file_location("private_adapter", Path(__file__).resolve().parents[1] / "python" / "private.py")
private = importlib.util.module_from_spec(spec)
spec.loader.exec_module(private)


def incoming(**patches):
    return {"sender_uid": 456, "receiver_id": 123, "receiver_type": 1, "msg_type": 1,
            "msg_key": 777, "msg_seqno": 1, "timestamp": 1792728000,
            "content": json.dumps({"content": "你好，谢谢分享。"}), **patches}


class PrivateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = Credential(sessdata="test-placeholder", bili_jct="test-placeholder", dedeuserid="123")
        self.info = AsyncMock(return_value={"mid": 123})
        self.fetch = AsyncMock(return_value={"messages": [incoming()]})
        self.relation = AsyncMock(return_value={"relation": {"attribute": 0}, "be_relation": {"attribute": 2}})
        self.send = AsyncMock(return_value={"msg_key": "receipt-888"})
        self.patches = [patch.object(private.user, "get_self_info", self.info),
                        patch.object(private.session, "fetch_session_msgs", self.fetch),
                        patch.object(private.user.User, "get_relation", self.relation),
                        patch.object(private.session, "send_msg", self.send)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    async def dispatch(self, method, **params):
        return await private.dispatch(method, {"expected_account": "123", "uid": "456", **params}, self.cred)

    async def test_inbox_only_accepts_latest_incoming_text_in_one_to_one_sessions(self):
        sessions = [{"session_type": 1, "talker_id": 456, "last_msg": incoming()},
                    {"session_type": 2, "talker_id": 456, "last_msg": incoming()},
                    {"session_type": 1, "talker_id": 456, "last_msg": incoming(sender_uid=123, receiver_id=456)},
                    {"session_type": 1, "talker_id": 456, "last_msg": incoming(msg_type=2)}]
        with patch.object(private.session, "get_sessions", AsyncMock(return_value={"session_list": sessions})):
            result = await self.dispatch("dm_inbox")
        self.assertEqual(len(result["messages"]), 1)
        self.assertEqual(result["messages"][0]["id"], "777")
        self.assertEqual(result["messages"][0]["uid"], "456")
        self.assertEqual(result["messages"][0]["text"], "你好，谢谢分享。")
        self.send.assert_not_awaited()

    async def test_identity_change_fails_before_inbox_or_send(self):
        self.info.return_value = {"mid": 999}
        with self.assertRaises(private.PrivateError) as caught:
            await self.dispatch("dm_reply", message_id="777", reply="你好")
        self.assertEqual(caught.exception.code, "ACCOUNT_CHANGED")
        self.fetch.assert_not_awaited()
        self.send.assert_not_awaited()

    def test_inline_bilibili_emote_codes_and_unicode_remain_exact_in_text_message(self):
        for text in ['[doge]', '你好[千恋万花_害羞]', '😺']:
            parsed = private.message(incoming(content=json.dumps({'content': text})), '123', '456')
            self.assertIsNotNone(parsed)
            self.assertEqual(parsed['text'], text)
            self.assertEqual(parsed['id'], '777')

    async def test_follow_direction_is_target_following_agent_not_agent_following_target(self):
        result = await self.dispatch("dm_thread")
        self.assertTrue(result["fan"])
        self.relation.return_value = {"relation": {"attribute": 2}, "be_relation": {"attribute": 0}}
        result = await self.dispatch("dm_thread")
        self.assertFalse(result["fan"])
        with self.assertRaises(private.PrivateError):
            await self.dispatch("dm_reply", message_id="777", reply="你好")
        self.send.assert_not_awaited()

    async def test_manual_reply_or_new_message_invalidates_old_draft(self):
        for row in [incoming(msg_key=778, msg_seqno=3), incoming(sender_uid=123, receiver_id=456, msg_seqno=3), incoming(msg_type=5, msg_seqno=3)]:
            self.fetch.return_value = {"messages": [row, incoming()]}
            with self.assertRaises(private.PrivateError) as caught:
                await self.dispatch("dm_reply", message_id="777", reply="你好")
            self.assertEqual(caught.exception.code, "DM_STALE")
        self.send.assert_not_awaited()

    async def test_owner_can_bypass_fan_check_but_not_block_or_self(self):
        self.relation.return_value = {"relation": {"attribute": 0}, "be_relation": {"attribute": 0}}
        result = await self.dispatch("dm_reply", message_id="777", reply="你好", owner_uid="456")
        self.assertTrue(result["confirmed"])
        self.relation.return_value = {"relation": {"attribute": 128}, "be_relation": {"attribute": 2}}
        with self.assertRaises(private.PrivateError):
            await self.dispatch("dm_reply", message_id="777", reply="你好", owner_uid="456")
        with self.assertRaises(private.PrivateError):
            await self.dispatch("dm_reply", uid="123", message_id="777", reply="你好", owner_uid="123")
        self.assertEqual(self.send.await_count, 1)

    async def test_send_is_one_shot_restores_sdk_retry_setting_and_unknown_is_not_retried(self):
        before = private.request_settings.get_wbi_retry_times()
        async def fail(*args):
            self.assertEqual(private.request_settings.get_wbi_retry_times(), 1)
            raise TimeoutError()
        self.send.side_effect = fail
        with self.assertRaises(TimeoutError):
            await self.dispatch("dm_reply", message_id="777", reply="你好")
        self.assertEqual(self.send.await_count, 1)
        self.assertEqual(private.request_settings.get_wbi_retry_times(), before)

    async def test_malformed_and_oversized_messages_are_not_processed(self):
        for row in [incoming(content="not JSON"), incoming(content=json.dumps({"content": "x" * 2001})),
                    incoming(receiver_type=2), incoming(receiver_id=999), incoming(msg_key="../path")]:
            self.assertIsNone(private.message(row, "123", "456"))

    async def test_import_is_bounded_and_does_not_fetch_private_messages_or_send(self):
        people = [{"mid": i + 1, "uname": "粉丝"} for i in range(101)]
        with patch.object(private.user.User, "get_followers", AsyncMock(return_value={"list": people, "total": 9999})):
            result = await self.dispatch("contacts_page", page=1)
        self.assertEqual(len(result["people"]), 100)
        self.assertTrue(result["hasMore"])
        self.fetch.assert_not_awaited()
        self.send.assert_not_awaited()
