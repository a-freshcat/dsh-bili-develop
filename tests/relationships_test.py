"""SDK boundary mocks. No platform following or private messages."""
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import relationships as adapter


class RelationshipsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = Credential(sessdata='synthetic-only-cookie', bili_jct='synthetic-csrf-value', dedeuserid='123')
        self.identity = AsyncMock(return_value={'mid': 123})
        self.relation = AsyncMock(return_value={'relation': {'attribute': 0}, 'be_relation': {'attribute': 2}})
        self.fetch = AsyncMock(return_value={'messages': []})
        self.follow = AsyncMock()
        self.send = AsyncMock(return_value={'msg_key': 'synthetic-receipt'})
        self.patches = [patch.object(adapter.user, 'get_self_info', self.identity), patch.object(adapter.user.User, 'get_relation', self.relation),
                        patch.object(adapter.session, 'fetch_session_msgs', self.fetch), patch.object(adapter.user.User, 'modify_relation', self.follow), patch.object(adapter.session, 'send_msg', self.send)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    async def call(self, method, **changes):
        return await adapter.dispatch(method, {'expected_account': '123', 'uid': '456', 'enabled': True, **changes}, self.cred)

    async def test_already_followed_has_no_mutation_and_no_attempt(self):
        self.relation.return_value['relation']['attribute'] = 2
        found = await self.call('follow_user')
        self.assertTrue(found['alreadyFollowed']); self.assertFalse(found['attempted']); self.follow.assert_not_awaited()

    async def test_follow_is_once_without_retry_and_verified_from_relationship(self):
        self.relation.side_effect = [{'relation': {'attribute': 0}, 'be_relation': {'attribute': 2}}, {'relation': {'attribute': 2}, 'be_relation': {'attribute': 2}}]
        previous = adapter.request_settings.get_wbi_retry_times()
        async def once(*args, **kwargs):
            self.assertEqual(adapter.request_settings.get_wbi_retry_times(), 1)
        self.follow.side_effect = once
        found = await self.call('follow_user'); self.assertTrue(found['confirmed']); self.follow.assert_awaited_once()
        self.assertEqual(adapter.request_settings.get_wbi_retry_times(), previous)

    async def test_disabled_unknown_relation_wrong_account_and_nonfan_do_not_mutate(self):
        for kind in ['disabled', 'account', 'relation', 'nonfan']:
            self.identity.return_value = {'mid': 999 if kind == 'account' else 123}
            self.relation.return_value = {'relation': {'attribute': 0 if kind != 'relation' else 999}, 'be_relation': {'attribute': 0 if kind == 'nonfan' else 2}}
            with self.assertRaises(adapter.RelationshipError):
                await self.call('follow_user', enabled=kind != 'disabled')
        self.follow.assert_not_awaited(); self.send.assert_not_awaited()

    async def test_proactive_requires_same_actual_thread_and_secret_free_text(self):
        found = await self.call('dm_proactive_probe'); version = found['threadVersion']
        self.assertNotIn('messages', found)
        with self.assertRaises(adapter.RelationshipError):
            await self.call('dm_proactive_send', thread_version='b' * 64, reply='你好。')
        with self.assertRaises(adapter.RelationshipError) as cm:
            await self.call('dm_proactive_send', thread_version=version, reply='synthetic-only-cookie')
        self.assertEqual(cm.exception.code, 'PRIVACY_BLOCKED'); self.send.assert_not_awaited()
        await self.call('dm_proactive_send', thread_version=version, reply='今天有空聊聊吗？')
        self.send.assert_awaited_once()

    async def test_uncertain_mutations_do_not_retry(self):
        self.follow.side_effect = OSError('synthetic failure')
        with self.assertRaises(adapter.RelationshipError):
            await self.call('follow_user')
        self.follow.assert_awaited_once()
        found = await self.call('dm_proactive_probe'); self.send.side_effect = OSError('synthetic failure')
        with self.assertRaises(adapter.RelationshipError):
            await self.call('dm_proactive_send', thread_version=found['threadVersion'], reply='你好。')
        self.send.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
