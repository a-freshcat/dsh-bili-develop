"""Owned-publication and single-POST boundaries; all SDK/network calls mocked."""
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import account_manager as am

BV = 'BV1xx411c7mD'


class AccountManagerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = Credential(sessdata='fixture-session', bili_jct='fixture-csrf', dedeuserid='123')
        self.info = {'bvid': BV, 'aid': 987, 'title': '合成作品', 'owner': {'mid': 123}}
        self.dynamic = {'item': {'id_str': '999', 'basic': {'comment_type': 17, 'comment_id_str': '999'}, 'modules': {'module_author': {'mid': 123}, 'module_dynamic': {'desc': {'text': '合成动态'}}}}}
        self.raw = {'rpid': 201, 'member': {'mid': 456}, 'ctime': 1000, 'content': {'message': '这条作品挺有趣'}}
        self.thread = {'root': self.raw, 'replies': []}
        self.posts = []
        self.api_failure = False
        self.post_result = {'rpid': 555}
        owner = self
        class FakeApi:
            def __init__(self, **kwargs): pass
            def update_data(self, **payload):
                owner.posts.append(payload)
                return self
            @property
            async def result(self):
                if owner.api_failure: raise TimeoutError('fixture timeout')
                return owner.post_result
        for obj, key, value in [(am.user, 'get_self_info', AsyncMock(return_value={'mid': 123})),
                                 (am.video.Video, 'get_info', AsyncMock(side_effect=lambda: self.info)),
                                 (am.dynamic.Dynamic, 'get_info', AsyncMock(side_effect=lambda: self.dynamic)),
                                 (am.comment.Comment, 'get_sub_comments', AsyncMock(side_effect=lambda **kw: self.thread)),
                                 (am, 'Api', FakeApi)]:
            p = patch.object(obj, key, value); p.start(); self.addCleanup(p.stop)
        self.resource = {'type': 'video', 'id': BV, 'oid': '987', 'commentType': 1}
        self.target = am.row(self.raw)

    def params(self):
        return {'expected_account': '123', 'resource': self.resource, 'target': self.target, 'text': '谢谢，后续还在准备。'}

    async def test_resource_ownership_and_platform_comment_type(self):
        res = await am.resource(self.resource, '123', self.cred)
        self.assertEqual(res['commentType'], 1)
        self.info['owner']['mid'] = 999
        with self.assertRaises(am.PublishError): await am.resource(self.resource, '123', self.cred)
        for kind in (11, 12, 17):
            self.dynamic['item']['basic']['comment_type'] = kind
            result = await am.resource({'type': 'dynamic', 'id': '999'}, '123', self.cred)
            self.assertEqual(result['commentType'], kind)
        self.dynamic['item']['modules']['module_author']['mid'] = 999
        with self.assertRaises(am.PublishError): await am.resource({'type': 'dynamic', 'id': '999'}, '123', self.cred)
        self.assertFalse(self.posts)

    async def test_probe_never_posts_and_publish_uses_verified_type_parent_and_exact_text(self):
        p = self.params(); await am.dispatch('account_reply_probe', p, self.cred); self.assertFalse(self.posts)
        result = await am.dispatch('account_reply_publish', p, self.cred)
        self.assertTrue(result['confirmed']); self.assertEqual(result['receipt'], '555')
        self.assertEqual(len(self.posts), 1)
        self.assertEqual({k: self.posts[0][k] for k in ('oid', 'type', 'root', 'parent', 'message')}, {'oid': 987, 'type': 1, 'root': 201, 'parent': 201, 'message': p['text']})

    async def test_dynamic_and_nested_reply_stay_in_owned_dynamic_thread(self):
        self.resource = {'type': 'dynamic', 'id': '999', 'oid': '999', 'commentType': 17}
        raw = {'rpid': 202, 'root': 201, 'member': {'mid': 456}, 'ctime': 1001, 'content': {'message': '楼中楼留言'}}
        self.thread['replies'] = [raw]; self.target = am.row(raw, '201')
        await am.dispatch('account_reply_publish', self.params(), self.cred)
        self.assertEqual(self.posts[0]['type'], 17); self.assertEqual(self.posts[0]['oid'], 999)
        self.assertEqual(self.posts[0]['root'], 201); self.assertEqual(self.posts[0]['parent'], 202)

    async def test_changed_account_owner_target_and_credential_text_never_post(self):
        for field, value in [('expected_account', '999'), ('text', 'SESSDATA=fixture-session')]:
            p = self.params(); p[field] = value
            with self.assertRaises(am.PublishError): await am.dispatch('account_reply_publish', p, self.cred)
        self.raw['content']['message'] = '已编辑'
        with self.assertRaises(am.PublishError): await am.dispatch('account_reply_publish', self.params(), self.cred)
        self.assertFalse(self.posts)

    async def test_timeout_does_not_retry_and_restores_retry_setting(self):
        self.api_failure = True; before = am.request_settings.get_wbi_retry_times()
        with self.assertRaises(TimeoutError): await am.dispatch('account_reply_publish', self.params(), self.cred)
        self.assertEqual(len(self.posts), 1); self.assertEqual(am.request_settings.get_wbi_retry_times(), before)

    async def test_verify_requires_same_author_parent_and_receipt_without_post(self):
        self.thread['replies'] = [{'rpid': 555, 'parent': 201, 'member': {'mid': 123}, 'content': {'message': self.params()['text']}}]
        p = self.params(); p['receipt'] = '555'
        self.assertTrue((await am.dispatch('account_reply_verify', p, self.cred))['confirmed'])
        p['receipt'] = '777'
        self.assertFalse((await am.dispatch('account_reply_verify', p, self.cred))['confirmed'])
        self.assertFalse(self.posts)

    async def test_recent_list_excludes_foreign_dynamics_and_video_alias_threads(self):
        own = self.dynamic['item']
        foreign = {**own, 'id_str': '888', 'modules': {'module_author': {'mid': 999}}}
        video_alias = {**own, 'id_str': '777', 'basic': {'comment_type': 1}}
        with patch.object(am.user.User, 'get_videos', AsyncMock(return_value={'list': {'vlist': [{'bvid': BV, 'title': '作品'}]}})), \
             patch.object(am.user.User, 'get_dynamics_new', AsyncMock(return_value={'items': [own, foreign, video_alias]})):
            result = await am.dispatch('account_resources', {'expected_account': '123'}, self.cred)
        self.assertEqual([(x['type'], x['id']) for x in result['resources']], [('video', BV), ('dynamic', '999')])
        self.assertFalse(self.posts)

    async def test_captcha_feedback_is_not_promoted_to_success(self):
        self.post_result = {'rpid': 555, 'need_captcha': 1}
        result = await am.dispatch('account_reply_publish', self.params(), self.cred)
        self.assertFalse(result['confirmed']); self.assertEqual(result['receipt'], '')
        self.assertTrue(result['platformFeedback']['needCaptcha']); self.assertEqual(len(self.posts), 1)
