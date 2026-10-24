"""Local image tests and mocked SDK calls only. No live uploads or dynamic posts."""
import base64
import io
from pathlib import Path
import sys
import tempfile
import unittest
import httpx
from unittest.mock import AsyncMock, patch
from PIL import Image, PngImagePlugin
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import weekly


class WeeklyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        (Path(__file__).resolve().parents[1] / 'desktop-m0-m1').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / 'desktop-m0-m1', prefix='test-weekly-')
        self.root = Path(self.temporary.name)
        self.cred = Credential(sessdata='test-only', bili_jct='test-only', dedeuserid='123')
        self.identity = AsyncMock(return_value={'mid': 123})
        self.profile = AsyncMock(return_value={'mid': 456, 'name': '测试对象'})
        self.real_sender = weekly.dynamic.send_dynamic
        self.sender = AsyncMock(return_value={'dyn_id_str': '987654321'})
        self.attribute = 2
        outer = self

        class Api:
            def __init__(self, **kwargs):
                outer.assertEqual(kwargs['method'], 'GET')
                outer.assertEqual(kwargs['url'], 'https://api.bilibili.com/x/relation')
            def update_params(self, **kwargs):
                self.params = kwargs
                return self
            @property
            def result(self):
                async def get():
                    return {'mid': self.params['fid'], 'attribute': outer.attribute}
                return get()
        self.patches = [patch.object(weekly.user, 'get_self_info', self.identity),
                        patch.object(weekly.user.User, 'get_user_info', self.profile),
                        patch.object(weekly.dynamic, 'send_dynamic', self.sender),
                        patch('bilibili_api.utils.network.Api', Api)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temporary.cleanup()

    def image(self):
        source = io.BytesIO()
        metadata = PngImagePlugin.PngInfo(); metadata.add_text('private-note', 'must-be-removed')
        Image.new('RGBA', (2000, 1000), (20, 120, 220, 120)).save(source, format='PNG', pnginfo=metadata)
        return weekly.prepare_image({'base64': base64.b64encode(source.getvalue()).decode('ascii')}, self.root)

    async def call(self, method='weekly_publish', **changes):
        params = {'expected_account': '123', 'body': '最近一周的公开浏览小结。', 'mentions': [], 'approved': True,
                  'workspace': str(self.root), **changes}
        if 'images' not in params:
            params['images'] = [self.image()]
        return await weekly.dispatch(method, params, self.cred, self.root)

    async def test_prepared_image_is_bounded_jpeg_without_source_metadata(self):
        result = self.image()
        file = weekly.managed_images(self.root) / (result['hash'] + '.jpg')
        with Image.open(file) as image:
            self.assertEqual(image.format, 'JPEG'); self.assertEqual(image.size, (1600, 800))
            self.assertNotIn('private-note', image.info); self.assertEqual(len(image.getexif()), 0)
        self.assertTrue(result['thumbnail'].startswith('data:image/jpeg;base64,'))
        self.sender.assert_not_called(); self.identity.assert_not_called()

    async def test_invalid_image_data_is_rejected_locally(self):
        for encoded in ('not valid base64!!', base64.b64encode(b'not an image').decode('ascii'), 'A' * (6 * 1024 * 1024 + 1)):
            with self.assertRaises(weekly.PublishError):
                weekly.prepare_image({'base64': encoded}, self.root)
        self.sender.assert_not_called()

    async def test_no_approval_no_image_or_inline_mentions_never_upload(self):
        for change in ({'approved': False}, {'images': []}, {'body': '@测试对象 正文'}, {'body': ''}):
            with self.assertRaises(weekly.PublishError):
                await self.call(**change)
        self.sender.assert_not_called()

    async def test_account_mismatch_and_unfollowed_mentions_are_blocked(self):
        with self.assertRaises(weekly.PublishError):
            await self.call(expected_account='999')
        self.attribute = 0
        with self.assertRaisesRegex(weekly.PublishError, '先关注'):
            await self.call(mentions=[{'uid': '456', 'name': '测试对象'}])
        self.sender.assert_not_called()

    async def test_probe_only_checks_account_and_following_without_uploads(self):
        result = await self.call('weekly_probe', mentions=[{'uid': '456', 'name': '测试对象'}])
        self.assertEqual(result['accountUid'], '123'); self.sender.assert_not_called()

    async def test_same_path_image_replacement_fails_before_dynamic_sdk(self):
        image = self.image()
        (weekly.managed_images(self.root) / (image['hash'] + '.jpg')).write_bytes(b'changed bytes')
        with self.assertRaisesRegex(weekly.PublishError, '配图内容'):
            await self.call(images=[image])
        self.sender.assert_not_called()

    async def test_approved_picture_and_structured_mention_send_once_with_retry_disabled(self):
        previous = weekly.request_settings.get_wbi_retry_times()
        async def send(builder, cred):
            self.assertEqual(weekly.request_settings.get_wbi_retry_times(), 1)
            self.assertEqual(len(builder.pics), 1)
            contents = await builder.get_contents(cred)
            self.assertTrue(any(str(c.get('biz_id')) == '456' for c in contents))
            return {'dyn_id_str': '987654321'}
        self.sender.side_effect = send
        result = await self.call(mentions=[{'uid': '456', 'name': '测试对象'}])
        self.assertTrue(result['accepted']); self.assertEqual(result['receipt'], '987654321')
        self.sender.assert_awaited_once(); self.assertEqual(weekly.request_settings.get_wbi_retry_times(), previous)

    async def test_timeout_and_missing_receipt_never_become_public_success(self):
        self.sender.return_value = {'message': 'OK'}
        result = await self.call(); self.assertFalse(result['accepted'])
        self.sender.reset_mock(); self.sender.side_effect = TimeoutError('simulated')
        with self.assertRaisesRegex(weekly.PublishError, '未确认'):
            await self.call()
        self.sender.assert_awaited_once()

    async def test_real_sdk_does_not_require_a_second_cdn_download_of_approved_image(self):
        # Exercise the installed SDK rather than replacing send_dynamic itself.
        # A failure in its redundant CDN read currently becomes the user's generic UNKNOWN.
        real_send = self.real_sender
        calls = []; uploads = []
        outer = self

        class LocalApi:
            def __init__(self, **kwargs):
                self.url = kwargs['url']; self.data = {}; self.files = {}
            def update_data(self, **kwargs):
                self.data = kwargs; return self
            def update_files(self, **kwargs):
                self.files = kwargs; return self
            def update_params(self, **kwargs):
                return self
            @property
            def result(self):
                async def result():
                    calls.append(self.url)
                    outer.assertTrue(self.url.endswith('/create/dyn'))
                    outer.assertEqual(len(self.data['dyn_req']['pics']), 1)
                    return {'dyn_id_str': '987654321'}
                return result()

        async def upload(request):
            self.assertEqual(request.method, 'POST'); self.assertEqual(str(request.url), 'https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs')
            body = await request.aread(); uploads.append(body)
            self.assertIn(b'filename="approved.jpg"', body); self.assertIn(b'\xff\xd8', body)
            self.assertIn(b'name="csrf"', body); self.assertIn('SESSDATA=test-only', request.headers['cookie'])
            return httpx.Response(200, json={'code': 0, 'data': {'image_url': 'http://i0.hdslb.com/bfs/new_dyn/' + 'a' * 40 + '.jpg',
                                                               'image_width': 1600, 'image_height': 800, 'img_size': 100}})
        client = httpx.AsyncClient
        with patch.object(weekly.dynamic, 'send_dynamic', real_send), patch.object(weekly.dynamic, 'Api', LocalApi), \
             patch.object(weekly.dynamic, 'upload_image', AsyncMock(side_effect=AssertionError('broken SDK upload must not run'))), \
             patch.object(weekly.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(upload), **kwargs)), \
             patch.object(weekly.Picture, 'load_url', AsyncMock(side_effect=ConnectionError('synthetic CDN is unavailable'))) as cdn, \
             patch('tempfile.tempdir', str(self.root)):
            result = await self.call()
        self.assertTrue(result['accepted'])
        self.assertEqual(len(uploads), 1)
        self.assertEqual(sum(url.endswith('/create/dyn') for url in calls), 1)
        cdn.assert_not_called()

    async def test_real_sdk_image_upload_failure_is_reported_before_create_and_leaves_no_shared_file(self):
        async def fail(_request): raise PermissionError('sensitive path must not be exposed')
        client = httpx.AsyncClient
        with patch.object(weekly.dynamic, 'send_dynamic', self.real_sender), \
             patch.object(weekly.dynamic, 'upload_image', AsyncMock(side_effect=AssertionError('broken SDK upload must not run'))), \
             patch.object(weekly.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(fail), **kwargs)):
            with self.assertRaises(weekly.PublishError) as raised:
                await self.call()
        self.assertEqual(raised.exception.code, 'WEEKLY_UPLOAD_FAILED')
        self.assertIn('PermissionError', str(raised.exception)); self.assertIn('动态未提交', str(raised.exception))
        self.assertNotIn('sensitive path', str(raised.exception))
        self.assertEqual(list((self.root / 'tmp').glob('weekly-upload-*')), [])
        self.assertFalse((self.root / 'tmp' / 'test.jpg').exists())

    async def test_upload_response_must_still_refer_to_the_reviewed_image(self):
        responses = [
            {'image_url': 'https://untrusted.example/image.jpg', 'image_width': 1600, 'image_height': 800},
            {'image_url': 'https://i0.hdslb.com/bfs/new_dyn/test.jpg', 'image_width': 10, 'image_height': 10},
        ]
        for response in responses:
            client = httpx.AsyncClient
            with patch.object(weekly.dynamic, 'send_dynamic', self.real_sender), \
                 patch.object(weekly.dynamic, 'upload_image', AsyncMock(side_effect=AssertionError('broken SDK upload must not run'))), \
                 patch.object(weekly.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'code': 0, 'data': response})), **kwargs)):
                with self.assertRaises(weekly.PublishError) as raised:
                    await self.call()
            self.assertEqual(raised.exception.code, 'WEEKLY_UPLOAD_FAILED')

    def own_item(self, **changes):
        item = {'id_str': '987654321', 'modules': {'module_author': {'mid': 123, 'pub_ts': 1000}, 'module_dynamic': {
            'major': {'type': 'MAJOR_TYPE_OPUS', 'opus': {'summary': {'text': '最近一周的公开浏览小结。'}, 'pics': [{}]}}}}}
        for key, value in changes.items():
            if key == 'id': item['id_str'] = value
            elif key in ('mid', 'pub_ts'): item['modules']['module_author'][key] = value
            else: item['modules']['module_dynamic']['major']['opus'][key] = value
        return item

    async def verify_call(self, items, **changes):
        params = {'expected_account': '123', 'body': '最近一周的公开浏览小结。', 'mentions': [], 'attempt_at': 1000000, 'image_count': 1, **changes}
        with patch.object(weekly.user.User, 'get_dynamics_new', AsyncMock(return_value={'items': items})):
            return await weekly.dispatch('weekly_verify', params, self.cred, self.root)

    async def test_readonly_verify_accepts_only_one_exact_own_text_time_and_picture_count(self):
        result = await self.verify_call([self.own_item()])
        self.assertTrue(result['confirmed']); self.assertEqual(result['receipt'], '987654321')
        self.assertEqual(result['source'], 'own_space'); self.assertEqual(result['sampleCount'], 1)
        for item in (self.own_item(mid=999), self.own_item(pub_ts=1), self.own_item(summary={'text': '别的动态'}), self.own_item(pics=[])):
            result = await self.verify_call([item]); self.assertFalse(result['confirmed'])
        result = await self.verify_call([self.own_item(), self.own_item(id='987654322')]); self.assertFalse(result['confirmed'])
        self.assertEqual(result['status'], 'ambiguous'); self.sender.assert_not_called()
        item = self.own_item(summary={'text': '最近一周的公开浏览小结。\n@测试对象 '})
        result = await self.verify_call([item], mentions=[{'uid': '456', 'name': '测试对象'}])
        self.assertTrue(result['confirmed']); self.profile.assert_not_called()

    async def test_readonly_verify_does_not_require_following_and_get_errors_are_not_success(self):
        self.attribute = 0
        result = await self.verify_call([], mentions=[{'uid': '456', 'name': '测试对象'}])
        self.assertFalse(result['confirmed']); self.profile.assert_not_called(); self.sender.assert_not_called()
        with patch.object(weekly.user.User, 'get_dynamics_new', AsyncMock(side_effect=TimeoutError('secret-cookie'))):
            result = await weekly.dispatch('weekly_verify', {'expected_account': '123', 'body': '公开正文', 'mentions': [], 'attempt_at': 1000000, 'image_count': 1}, self.cred, self.root)
        self.assertFalse(result['confirmed']); self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('secret-cookie', str(result))

    async def test_readonly_verify_checks_account_and_inputs_before_reading_space(self):
        with patch.object(weekly.user.User, 'get_dynamics_new', AsyncMock()) as listing:
            for changes in ({'expected_account': '999'}, {'attempt_at': True}, {'image_count': 0}, {'body': ''}):
                with self.assertRaises(weekly.PublishError):
                    await weekly.dispatch('weekly_verify', {'expected_account': '123', 'body': '公开正文', 'mentions': [], 'attempt_at': 1000000, 'image_count': 1, **changes}, self.cred, self.root)
            listing.assert_not_called()

    async def test_http_upload_rejection_timeout_and_redirect_stop_before_dynamic_creation(self):
        async def timed_out(request): raise httpx.ReadTimeout('private error text', request=request)
        handlers = [lambda request: httpx.Response(200, json={'code': -101, 'message': 'private response text'}),
                    lambda request: httpx.Response(302, headers={'location': 'https://untrusted.example'}), timed_out]
        for handler in handlers:
            client = httpx.AsyncClient
            creator = AsyncMock(side_effect=AssertionError('dynamic must not be created'))
            with patch.object(weekly.dynamic, 'send_dynamic', self.real_sender), patch.object(weekly.dynamic, 'Api', creator), \
                 patch.object(weekly.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs)):
                with self.assertRaises(weekly.PublishError) as raised:
                    await self.call()
            self.assertEqual(raised.exception.code, 'WEEKLY_UPLOAD_FAILED')
            self.assertNotIn('private', str(raised.exception)); self.assertNotIn('untrusted', str(raised.exception))
            creator.assert_not_called()


if __name__ == '__main__':
    unittest.main()
