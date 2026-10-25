"""Mocked SDK boundaries: no platform POSTs, credentials or real account data."""
import importlib.util
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))

spec = importlib.util.spec_from_file_location("publishing_adapter", Path(__file__).resolve().parents[1] / "python" / "publishing.py")
publishing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publishing)
BV = "BV1xx411c7mD"


class PublishingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = Credential(sessdata="test-placeholder", bili_jct="test-placeholder", dedeuserid="123")
        self.info = AsyncMock(return_value={"mid": 123})
        self.video = AsyncMock(return_value={"aid": 987, "bvid": BV})
        self.profile = AsyncMock(return_value={"mid": 456, "name": "测试对象"})
        self.comments = AsyncMock(return_value={"replies": []})
        self.public_comments = AsyncMock(return_value={"replies": []})
        self.subcomments = AsyncMock(return_value={"root": self.root(), "replies": []})
        self.at_notices = AsyncMock(return_value={'items': []})
        self.posts, self.inputs = [], []
        self.failure = None
        self.relation_attribute = 2
        self.result = {"rpid": 555, "reply": {"content": {"message": "内容很清晰。"}}}
        outer = self

        class Api:
            def __init__(self, **kwargs):
                outer.inputs.append(kwargs)
                self.method = kwargs.get('method')

            def update_params(self, **kwargs):
                self.params = kwargs
                return self

            def update_data(self, **kwargs):
                self.data = kwargs
                return self

            @property
            def result(self):
                async def send():
                    if self.method == 'GET':
                        return {'mid': self.params['fid'], 'attribute': outer.relation_attribute}
                    outer.posts.append(self.data)
                    outer.assertEqual(publishing.request_settings.get_wbi_retry_times(), 1)
                    if outer.failure:
                        raise outer.failure
                    return outer.result
                return send()

        self.patches = [patch.object(publishing.user, "get_self_info", self.info),
                        patch.object(publishing.user.User, "get_user_info", self.profile),
                        patch.object(publishing.video.Video, "get_info", self.video),
                        patch.object(publishing.comment, "get_comments", self.comments),
                        patch.object(publishing.comment, "get_comments_lazy", self.public_comments),
                        patch.object(publishing.comment.Comment, "get_sub_comments", self.subcomments), patch.object(publishing, "Api", Api)]
        self.patches.append(patch.object(publishing.session, 'get_at', self.at_notices))
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    async def dispatch(self, method="comment_publish", **params):
        return await publishing.dispatch(method, {"expected_account": "123", "bvid": BV, "oid": "987",
                                                 "text": "内容很清晰。", "mentions": [], **params}, self.cred)

    @staticmethod
    def root(**changes):
        return {"rpid": 101, "member": {"mid": 456, "uname": "留言者"}, "content": {"message": "鱼来"}, "root": 0, "rcount": 1, **changes}

    async def test_feedback_only_accepts_direct_replies_to_verified_own_text_after_publication(self):
        original = self.root(rpid=555, member={'mid': 123}, content={'message': '内容很清晰。'})
        self.subcomments.return_value = {'root': original, 'replies': [
            self.root(rpid=601, root=555, parent=555, ctime=100, content={'message': 'AI味太重'}),
            self.root(rpid=602, root=555, parent=999, ctime=100),
            self.root(rpid=603, root=555, parent=555, ctime=1),
            self.root(rpid=604, root=555, parent=555, ctime=100, member={'mid': 123})]}
        found = await self.dispatch('comment_feedback', comment_id='555', root_id='555', attempted_at=100000)
        self.assertEqual([r['id'] for r in found['replies']], ['601'])
        self.assertEqual(found['replies'][0]['parent'], '555')
        self.assertEqual(found['replies'][0]['root'], '555')
        self.assertEqual(found['replies'][0]['at'], 100000)
        self.assertEqual(self.posts, [])
        for changes in [{'member': {'mid': 456}}, {'content': {'message': '另一条评论'}}]:
            self.subcomments.return_value['root'] = {**original, **changes}
            with self.assertRaises(publishing.PublishError):
                await self.dispatch('comment_feedback', comment_id='555', root_id='555', attempted_at=100000)

    async def test_direct_reply_to_own_keyword_subcomment_uses_original_thread_and_ignores_other_conversations(self):
        root = self.root(rpid=101, content={'message': '鱼来'})
        own = self.root(rpid=555, root=101, parent=101, member={'mid': 123}, content={'message': '内容很清晰。'})
        reply = self.root(rpid=601, root=101, parent=555, ctime=100, content={'message': '谢谢，你刚才说得很有趣。'})
        self.subcomments.return_value = {'root': root, 'replies': [own, reply,
            self.root(rpid=602, root=101, parent=101, ctime=100),
            self.root(rpid=603, root=101, parent=999, ctime=100)]}
        found = await self.dispatch('comment_feedback', comment_id='555', root_id='101', attempted_at=100000)
        self.assertEqual([r['id'] for r in found['replies']], ['601'])
        self.assertEqual(found['replies'][0]['root'], '101')
        target = {k: found['replies'][0][k] for k in ('id', 'root', 'uid', 'text', 'level')}
        probe = await self.dispatch('comment_reply_probe', target=target, self_reply_parent='555')
        self.assertEqual(probe['target'], target)
        self.assertEqual(self.posts, [])

    async def test_credential_leak_is_blocked_before_comment_post(self):
        with self.assertRaises(publishing.PublishError) as cm:
            await self.dispatch(text='内容包含test-placeholder')
        self.assertEqual(cm.exception.code, 'PRIVACY_BLOCKED')
        self.assertEqual(self.posts, [])

    async def test_direct_reply_preflight_requires_parent_to_be_current_accounts_comment(self):
        own = self.root(rpid=555, member={'mid': 123}, content={'message': '内容很清晰。'})
        reply = self.root(rpid=601, root=555, parent=555, content={'message': '这句可以再自然一点。'})
        self.subcomments.return_value = {'root': own, 'replies': [reply]}
        target = {'id': '601', 'root': '555', 'uid': '456', 'text': '这句可以再自然一点。', 'level': 'sub'}
        found = await self.dispatch('comment_reply_probe', target=target, self_reply_parent='555')
        self.assertEqual(found['target'], target)
        for root, row in [({**own, 'member': {'mid': 999}}, reply), (own, {**reply, 'parent': 999})]:
            self.subcomments.return_value = {'root': root, 'replies': [row]}
            with self.assertRaises(publishing.PublishError):
                await self.dispatch('comment_reply_publish', target=target, self_reply_parent='555')
        self.assertEqual(self.posts, [])

    async def test_keyword_scan_is_empty_without_network_when_disabled(self):
        result = await self.dispatch("interaction_scan", keywords=[])
        self.assertEqual(result["matches"], [])
        self.info.assert_not_awaited()
        self.comments.assert_not_awaited()

    async def test_owner_mention_scan_requires_platform_uid_not_nickname_and_no_keyword(self):
        self.comments.return_value = {'replies': [
            self.root(rpid=101, member={'mid': 789}, content={'message': '@大肥鱼 来看看'}),
            self.root(rpid=102, member={'mid': 789}, content={'message': '@大肥鱼 来看看', 'members': [{'mid': 123}]}),
            self.root(rpid=103, member={'mid': 456}, content={'message': '@大肥鱼 来看看', 'members': [{'mid': 123}]}),
            self.root(rpid=104, member={'mid': 789}, content={'message': '@大肥鱼 来看看', 'members': [{'mid': 999}]})]}
        found = await self.dispatch('interaction_scan', keywords=[], owner_mention_uid='789', sub_limit=0)
        self.assertEqual([r['id'] for r in found['matches']], ['102'])
        self.assertEqual(found['matches'][0]['mentionedUids'], ['123'])
        self.assertEqual(self.posts, [])

    def notice(self, **changes):
        return {'id': 901, 'user': {'mid': 789}, 'at_time': 100, 'item': {
            'type': 'reply', 'business_id': 1, 'uri': f'https://www.bilibili.com/video/{BV}/',
            'subject_id': 987, 'root_id': 0, 'source_id': 101, 'source_content': '@大肥鱼 来看看',
            'at_details': [{'mid': 123}], **changes}}

    async def test_owner_notifications_recheck_actual_video_comment_and_mention_before_returning(self):
        self.at_notices.return_value = {'items': [self.notice()]}
        self.subcomments.return_value = {'root': self.root(member={'mid': 789}, content={'message': '@大肥鱼 来看看', 'members': [{'mid': 123}]}), 'replies': []}
        found = await self.dispatch('owner_mentions', owner_uid='789', since=99000)
        self.assertEqual(len(found['matches']), 1)
        self.assertEqual((found['matches'][0]['bvid'], found['matches'][0]['notificationId'], found['matches'][0]['uid']), (BV, '901', '789'))
        self.assertEqual(self.posts, [])
        found = await self.dispatch('owner_mentions', owner_uid='789', since=99000, handled_ids=['101'])
        self.assertEqual(found['matches'], [])
        self.at_notices.return_value = {'items': [self.notice(root_id='0')]}
        self.assertEqual(len((await self.dispatch('owner_mentions', owner_uid='789', since=99000))['matches']), 1)
        self.subcomments.return_value['root']['content']['members'] = [{'mid': 999}]
        self.assertEqual((await self.dispatch('owner_mentions', owner_uid='789', since=99000))['matches'], [])
        with self.assertRaises(publishing.PublishError):
            await self.dispatch('comment_reply_probe', owner_mention_uid='789', target={
                'id': '101', 'root': '101', 'uid': '789', 'text': '@大肥鱼 来看看', 'level': 'top'})
        self.assertEqual(self.posts, [])

    async def test_owner_notifications_ignore_wrong_sender_old_dynamic_foreign_link_and_account(self):
        notices = [self.notice(business_id=11), self.notice(uri=f'https://www.bilibili.com.evil.test/video/{BV}/'),
                   self.notice(at_details=[{'mid': 999}]), {**self.notice(), 'at_time': 1}, {**self.notice(), 'user': {'mid': 999}}]
        self.at_notices.return_value = {'items': notices}
        self.assertEqual((await self.dispatch('owner_mentions', owner_uid='789', since=99000))['matches'], [])
        self.video.assert_not_awaited()
        self.subcomments.assert_not_awaited()
        with self.assertRaises(publishing.PublishError):
            await self.dispatch('owner_mentions', owner_uid='789', since=99000, expected_account='999')
        self.assertEqual(self.posts, [])

    async def test_keyword_scan_bounds_threads_and_excludes_self_nonmatching_and_wrong_root(self):
        self.comments.return_value = {"replies": [self.root(rpid=i + 101) for i in range(30)]}
        async def fetch(*args, **kwargs):
            return {"root": self.root(), "replies": [self.root(rpid=201, root=101), self.root(rpid=202, root=101, member={"mid": 123}),
                                                    self.root(rpid=203, root=999), self.root(rpid=204, root=101, content={"message": "不匹配"})]}
        self.subcomments.side_effect = fetch
        result = await self.dispatch("interaction_scan", keywords=["鱼来"], top_limit=1, sub_limit=1)
        self.assertEqual(result["topRead"], 20)
        self.assertEqual(self.subcomments.await_count, 0, 'keywords never browse unrelated subthreads')
        self.assertEqual(sum(r["level"] == "sub" for r in result["matches"]), 0)
        self.assertTrue(all(r['level'] == 'top' for r in result['matches']))
        self.assertEqual(self.posts, [])

    async def test_reply_send_binds_real_root_parent_and_rechecks_original_text(self):
        target = {"id": "101", "root": "101", "uid": "456", "text": "鱼来", "level": "top"}
        self.result["reply"].update(root=101, parent=101)
        result = await self.dispatch("comment_reply_publish", target=target)
        self.assertTrue(result["confirmed"])
        self.assertEqual((self.posts[0]["root"], self.posts[0]["parent"]), (101, 101))
        self.subcomments.return_value = {"root": self.root(), "replies": [self.root(rpid=201, root=101)]}
        self.result["reply"].update(parent=201)
        result = await self.dispatch("comment_reply_publish", target={**target, "id": "201", "level": "sub"})
        self.assertTrue(result["confirmed"])
        self.assertEqual((self.posts[1]["root"], self.posts[1]["parent"]), (101, 201))
        with self.assertRaises(publishing.PublishError):
            await self.dispatch("comment_reply_publish", target={**target, "text": "原文被改了"})
        with self.assertRaises(publishing.PublishError):
            await self.dispatch("comment_reply_publish", target={**target, "uid": "999"})
        self.assertEqual(len(self.posts), 2)

    async def test_reply_verify_matches_parent_and_root_and_does_not_publish(self):
        at = 1792728000000
        t = {"id": "101", "root": "101", "uid": "456", "text": "鱼来", "level": "top"}
        sent = self.root(rpid=555, root=101, parent=101, member={"mid": 123}, ctime=at // 1000, content={"message": "内容很清晰。"})
        self.subcomments.return_value = {"root": self.root(), "replies": [sent]}
        self.assertTrue((await self.dispatch("comment_reply_verify", target=t, attempted_at=at))["confirmed"])
        self.subcomments.return_value["replies"] = [{**sent, "parent": 999}]
        self.assertFalse((await self.dispatch("comment_reply_verify", target=t, attempted_at=at))["confirmed"])
        self.assertEqual(self.posts, [])

    async def test_normal_comment_checks_identity_and_video_then_posts_once(self):
        result = await self.dispatch()
        self.assertTrue(result["confirmed"])
        self.assertEqual(result["receipt"], "555")
        self.assertEqual(result["mentionState"], "none")
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]["oid"], 987)
        self.assertEqual(self.posts[0]["type"], 1)
        self.assertEqual(self.inputs[0]["method"], "POST")
        self.info.assert_awaited_once()
        self.video.assert_awaited_once()

    async def test_real_uid_mention_mapping_preserves_integer_precision(self):
        uid = "1234567890123456789"
        self.profile.return_value = {"mid": int(uid), "name": "测试对象"}
        text = "内容很清晰。\n@测试对象 "
        self.result = {"rpid_str": "555", "reply": {"content": {"message": text, "members": [{"mid": int(uid)}]}}}
        result = await self.dispatch(text=text, mentions=[{"uid": uid, "name": "测试对象"}])
        self.assertEqual(json.loads(self.posts[0]["at_name_to_mid"]), {"测试对象": int(uid)})
        self.assertTrue(result["confirmed"])
        self.assertEqual(result["mentionState"], "rendered")

    async def test_mentions_require_following_before_probe_or_publish_but_readonly_verify_remains_available(self):
        text = '内容很清晰。\n@测试对象 '
        mentions = [{'uid': '456', 'name': '测试对象'}]
        for attribute in (0, 128, 99):
            self.relation_attribute = attribute
            for method in ('comment_probe', 'comment_publish'):
                with self.assertRaises(publishing.PublishError) as caught:
                    await self.dispatch(method, text=text, mentions=mentions)
                self.assertEqual(caught.exception.code, 'COMMENT_PREFLIGHT')
                self.assertIn('尚未关注', str(caught.exception))
        self.assertEqual(self.posts, [])
        at = 1792728000000
        self.comments.return_value = {'replies': [{'rpid': 555, 'ctime': at // 1000, 'member': {'mid': 123}, 'content': {'message': text.rstrip(' ')}}]}
        result = await self.dispatch('comment_verify', text=text, mentions=mentions, attempted_at=at)
        self.assertTrue(result['confirmed'])
        self.relation_attribute = 6
        self.result = {'rpid': 556, 'reply': {'content': {'message': text}}}
        self.assertTrue((await self.dispatch(text=text, mentions=mentions))['confirmed'])
        self.assertEqual(len(self.posts), 1)

    async def test_mention_receipt_accepts_only_platform_trimmed_generated_terminal_spaces(self):
        text = "内容很清晰。\n@测试对象 "
        mentions = [{"uid": "456", "name": "测试对象"}]
        self.result = {"rpid_str": "555", "reply": {"content": {"message": text.rstrip(" "), "members": [{"mid": 456}]}}}
        result = await self.dispatch(text=text, mentions=mentions)
        self.assertTrue(result["confirmed"])
        self.assertEqual(result["mentionState"], "rendered")
        self.assertEqual(self.posts[0]["message"], text, 'the sent payload is unchanged')
        self.assertEqual(len(self.posts), 1)

    async def test_readonly_mention_verification_recognises_trimmed_suffix_but_keeps_other_identity_checks(self):
        at = 1792728000000
        text = "内容很清晰。\n@测试对象 "
        mentions = [{"uid": "456", "name": "测试对象"}]
        row = {"rpid": 555, "member": {"mid": 123}, "ctime": at // 1000, "content": {"message": text.rstrip(" "), "members": [{"mid": 456}]}}
        self.comments.return_value = {"replies": [row]}
        found = await self.dispatch('comment_verify', attempted_at=at, text=text, mentions=mentions)
        self.assertTrue(found['confirmed']); self.assertEqual(found['receipt'], '555')
        self.assertEqual(found['mentionState'], 'rendered')
        for changed in ["别的内容。\n@测试对象", "内容很 清晰。\n@测试对象", "内容很清晰。 @测试对象", "内容很清晰。\n@另一个人", "内容很清晰。\n@测试对象\n", "内容很清晰。\n@测试对象\t"]:
            self.comments.return_value = {"replies": [{**row, "content": {"message": changed}}]}
            self.assertFalse((await self.dispatch('comment_verify', attempted_at=at, text=text, mentions=mentions))['confirmed'])
        self.comments.return_value = {"replies": [row, {**row, "rpid": 556}]}
        self.assertFalse((await self.dispatch('comment_verify', attempted_at=at, text=text, mentions=mentions))['confirmed'])
        self.comments.return_value = {"replies": [{**row, "member": {"mid": 999}}]}
        self.assertFalse((await self.dispatch('comment_verify', attempted_at=at, text=text, mentions=mentions))['confirmed'])
        self.assertEqual(self.posts, [])

    async def test_identity_video_or_nickname_change_prevents_post(self):
        self.info.return_value = {"mid": 999}
        with self.assertRaises(publishing.PublishError):
            await self.dispatch()
        self.info.return_value = {"mid": 123}
        self.video.return_value = {"aid": 888, "bvid": BV}
        with self.assertRaises(publishing.PublishError):
            await self.dispatch()
        self.video.return_value = {"aid": 987, "bvid": BV}
        self.profile.return_value = {"mid": 456, "name": "改名后"}
        with self.assertRaises(publishing.PublishError):
            await self.dispatch(mentions=[{"uid": "456", "name": "测试对象"}], text="内容很清晰。\n@测试对象 ")
        self.assertEqual(self.posts, [])

    async def test_account_record_does_not_prove_presence_in_anonymous_normal_list(self):
        at = 1792728000000
        text = "内容很清晰。\n@测试对象 "
        row = {"rpid": 555, "member": {"mid": 123}, "ctime": at // 1000,
               "content": {"message": text.rstrip(" "), "members": [{"mid": 456}]}}
        self.comments.return_value = {"replies": [row]}
        self.public_comments.return_value = {"replies": [{**row, "rpid": 888}]}
        result = await self.dispatch('comment_verify', attempted_at=at, text=text, mentions=[{"uid": "456", "name": "测试对象"}])
        self.assertTrue(result['confirmed'])
        self.assertEqual(result['publicList'], {'state': 'not_in_sample', 'sampleCount': 1})
        args, kwargs = self.public_comments.call_args
        self.assertFalse(kwargs['credential'].sessdata)
        self.assertFalse(kwargs['credential'].bili_jct)
        self.assertFalse(kwargs['credential'].dedeuserid)
        self.assertNotIn('receipt', kwargs)
        self.assertNotIn('root', kwargs)
        self.assertEqual(self.posts, [])

    async def test_anonymous_list_requires_same_receipt_author_and_text_in_bounded_sample(self):
        at = 1792728000000
        row = {"rpid": 555, "member": {"mid": 123}, "ctime": at // 1000, "content": {"message": "内容很清晰。"}}
        self.comments.return_value = {"replies": [row]}
        for rows, state in [([row], 'found'), ([{**row, 'rpid': 556}], 'not_in_sample'),
                            ([{**row, 'member': {'mid': 999}}], 'not_in_sample'),
                            ([{**row, 'content': {'message': '别的内容'}}], 'not_in_sample'),
                            ([{**row, 'rpid': i + 1000} for i in range(20)] + [row], 'not_in_sample')]:
            with self.subTest(state=state, count=len(rows)):
                self.public_comments.return_value = {'replies': rows}
                result = await self.dispatch('comment_verify', attempted_at=at)
                self.assertEqual(result['publicList'], {'state': state, 'sampleCount': min(len(rows), 20)})
        self.assertEqual(self.posts, [])

    async def test_anonymous_list_error_preserves_account_receipt_without_claiming_visibility(self):
        at = 1792728000000
        row = {"rpid": 555, "member": {"mid": 123}, "ctime": at // 1000, "content": {"message": "内容很清晰。"}}
        self.comments.return_value = {"replies": [row]}
        self.public_comments.side_effect = TimeoutError()
        result = await self.dispatch('comment_verify', attempted_at=at)
        self.assertTrue(result['confirmed'])
        self.assertEqual(result['publicList'], {'state': 'unavailable'})
        self.assertEqual(self.posts, [])

    async def test_probe_reads_comments_without_publishing(self):
        result = await self.dispatch("comment_probe")
        self.assertEqual(result["oid"], "987")
        self.comments.assert_awaited_once()
        self.assertEqual(self.posts, [])

    async def test_declared_mentions_require_exact_suffix_and_no_raw_at_in_body(self):
        for params in [{"text": "你好@陌生账号"}, {"text": "你好＠陌生账号"},
                       {"mentions": [{"uid": "456", "name": "测试对象"}], "text": "内容很清晰。"},
                       {"mentions": [None]}, {"mentions": [{"uid": "456", "name": "测试对象"}] * 2},
                       {"text": "x" * 1001}]:
            with self.subTest(params=params), self.assertRaises(publishing.PublishError):
                await self.dispatch(**params)
        self.assertEqual(self.posts, [])

    async def test_transport_ambiguity_and_platform_rejection_are_distinct_and_never_retried(self):
        previous = publishing.request_settings.get_wbi_retry_times()
        self.failure = TimeoutError()
        with self.assertRaises(publishing.PublishError) as caught:
            await self.dispatch()
        self.assertEqual(caught.exception.code, "COMMENT_UNKNOWN")
        self.assertEqual(publishing.request_settings.get_wbi_retry_times(), previous)
        self.failure = type("Rejection", (Exception,), {"code": -101})()
        with self.assertRaises(publishing.PublishError) as caught:
            await self.dispatch()
        self.assertEqual(caught.exception.code, "COMMENT_REJECTED")
        self.assertEqual(publishing.request_settings.get_wbi_retry_times(), previous)
        self.assertEqual(len(self.posts), 2)

    async def test_missing_echo_or_receipt_never_claims_confirmed(self):
        for result in [{"rpid": 555}, {"reply": {"content": {"message": "内容很清晰。"}}},
                       {"rpid": 555, "reply": {"content": {"message": "别的文案"}}}]:
            self.result = result
            self.assertFalse((await self.dispatch())["confirmed"])

    async def test_publish_keeps_bounded_platform_feedback_without_raw_response_or_urls(self):
        self.result.update(success_toast='评论已提交，审核通过后展示', need_captcha=False, success_action=0,
                           url='https://example.invalid/?token=private', cookies={'SESSDATA': 'private-cookie'}, debug='private-debug')
        self.result['reply'].update(state=17, invisible=True)
        result = await self.dispatch()
        self.assertEqual(result['platformFeedback'], {'captured': True, 'toast': '评论已提交，审核通过后展示',
                         'needCaptcha': False, 'successAction': 0, 'replyState': 17, 'invisible': True})
        self.assertNotIn('private', json.dumps(result['platformFeedback']))
        self.assertEqual(len(self.posts), 1)
        self.result['success_toast'] = 'x' * 1000
        self.assertLessEqual(len((await self.dispatch())['platformFeedback']['toast']), 200)
        self.result['success_toast'] = 'csrf=private-token https://example.invalid/?token=private-token'
        safe = (await self.dispatch())['platformFeedback']['toast']
        self.assertNotIn('private-token', safe)
        self.assertNotIn('https://', safe)

    async def test_captcha_or_missing_echo_keeps_candidate_receipt_but_never_claims_confirmed_or_retries(self):
        for result in [ {'rpid': 555, 'need_captcha': True, 'reply': {'content': {'message': '内容很清晰。'}}},
                        {'rpid': 555, 'success_toast': '评论已提交，审核中'} ]:
            self.result = result
            found = await self.dispatch()
            self.assertFalse(found['confirmed'])
            self.assertEqual(found['receipt'], '')
            self.assertEqual(found['receiptCandidate'], '555')
        self.assertEqual(len(self.posts), 2, 'one POST for each explicit test invocation')

    async def test_platform_rejection_preserves_only_its_safe_message_not_exception_raw(self):
        self.failure = type('PlatformRejection', (Exception,), {'code': 12035, 'msg': '该账号被UP主列入评论黑名单',
                              'raw': {'SESSDATA': 'private-cookie'}})()
        with self.assertRaises(publishing.PublishError) as caught:
            await self.dispatch()
        self.assertIn('该账号被UP主列入评论黑名单', str(caught.exception))
        self.assertNotIn('private-cookie', str(caught.exception))
        self.assertEqual(caught.exception.code, 'COMMENT_REJECTED')
        self.assertEqual(len(self.posts), 1)

    async def test_verification_requires_unique_matching_author_text_time_and_optional_receipt(self):
        at = 1792728000000
        row = {"rpid": 555, "member": {"mid": 123}, "ctime": at // 1000, "content": {"message": "内容很清晰。"}}
        for rows, receipt, expected in [([row], "", True), ([row], "555", True), ([row], "999", False),
                                        ([{**row, "member": {"mid": 999}}], "", False),
                                        ([{**row, "ctime": at // 1000 + 301}], "", False),
                                        ([{**row, "ctime": at // 1000 - 3}], "", False),
                                        ([row, {**row, "rpid": 556}], "", False),
                                        ([{**row, "rpid": i + 1, "member": {"mid": 999}} for i in range(20)] + [row], "", False)]:
            with self.subTest(rows=len(rows), receipt=receipt):
                self.comments.return_value = {"replies": rows}
                result = await self.dispatch("comment_verify", attempted_at=at, receipt=receipt)
                self.assertEqual(result["confirmed"], expected)
        self.assertEqual(self.posts, [])

    def test_mention_rendering_requires_all_requested_accounts(self):
        mentions = [{"uid": "456"}, {"uid": "789"}]
        self.assertEqual(publishing.mention_state({"content": {"members": [{"mid": 456}]}}, mentions), "unverified")
        self.assertEqual(publishing.mention_state({"content": {"at_name_to_mid": {"a": 456, "b": 789}}}, mentions), "rendered")

    def test_only_generated_mention_suffix_can_lose_its_final_ascii_space(self):
        mentions = [{"uid": "456", "name": "甲"}, {"uid": "789", "name": "乙"}]
        expected = "正文\n@甲 @乙 "
        self.assertTrue(publishing.message_matches("正文\n@甲 @乙", expected, mentions))
        self.assertFalse(publishing.message_matches("正文\n@甲@乙", expected, mentions))
        self.assertFalse(publishing.message_matches("正文\n@甲 @乙  ", expected, mentions))
        self.assertFalse(publishing.message_matches("正文", "正文 ", []))
        self.assertFalse(publishing.message_matches("正文\n@甲 @乙", "正文\n@甲 @乙  ", mentions))
