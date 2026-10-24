"""Adapter behavior tests with library/network boundaries replaced; no real account."""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch, AsyncMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
os.environ["BILI_HARNESS_DATA"] = str(ROOT / ".runtime" / "python-tests")
spec = importlib.util.spec_from_file_location("bili_reader", ROOT / "python" / "reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class FakeVideo:
    subtitles = [{"lan": "zh", "subtitle_url": "https://i0.hdslb.com/subtitle.json"}]
    def __init__(self, **kwargs):
        pass
    async def get_info(self):
        return {"title": "测试材料", "cid": 123, "owner": {"name": "测试作者", "mid": 987654}, "duration": 20,
                "pic": "https://i0.hdslb.com/bfs/archive/fixture.jpg"}
    async def get_subtitle(self, **kwargs):
        return {"subtitles": self.subtitles}


class FakeResponse:
    payload = b""
    def raise_for_status(self):
        pass
    async def aiter_bytes(self):
        yield self.payload
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass


class FakeClient:
    def __init__(self, **kwargs):
        pass
    def stream(self, method, url):
        return FakeResponse()
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass


class ReaderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = reader.Credential(sessdata="test-placeholder", dedeuserid="0")
        self.patches = [
            patch.object(reader, "credential", return_value=self.cred),
            patch.object(reader.video, "Video", FakeVideo),
            patch.object(reader.httpx, "AsyncClient", FakeClient),
        ]
        for p in self.patches:
            p.start()
        FakeVideo.subtitles = [{"lan": "zh", "subtitle_url": "https://i0.hdslb.com/subtitle.json"}]
        FakeResponse.payload = json.dumps({"body": [
            {"from": 0, "to": 1, "content": ""},
            {"from": 1, "to": 3, "content": "字幕原文示例"},
        ]}).encode()

    async def test_vulnerable_brotli_fails_before_any_network_operation(self):
        with patch.object(reader.importlib.metadata, 'version', return_value='1.2.0'):
            with self.assertRaises(reader.ReadError) as caught:
                await reader.dispatch('read_video', {'bvid': 'BV1xx411c7mD'})
        self.assertEqual(caught.exception.code, 'DEPENDENCY_SECURITY')

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    async def read(self, **kwargs):
        return await reader.dispatch("read_video", {"bvid": "BV1xx411c7mD", **kwargs})

    async def test_subtitle_has_real_segments_and_blank_rows_do_not_make_it_partial(self):
        value = await self.read()
        self.assertEqual(value["coverage"], "complete")
        self.assertEqual(value["segments"][0]["from"], 1)
        self.assertEqual(value["totalSegments"], 1)
        self.assertEqual(value["ownerUid"], "987654")
        self.assertEqual(value["cover"], "https://i0.hdslb.com/bfs/archive/fixture.jpg")

    async def test_cover_backfill_only_reads_video_metadata(self):
        with patch.object(FakeVideo, "get_subtitle", side_effect=AssertionError("must not read subtitles")):
            value = await reader.dispatch("read_cover", {"bvid": "BV1xx411c7mD"})
        self.assertEqual(value["bvid"], "BV1xx411c7mD")
        self.assertEqual(value["cover"], "https://i0.hdslb.com/bfs/archive/fixture.jpg")
        self.assertEqual(set(value), {"bvid", "cover"})

    async def test_uid_profile_lookup_returns_only_matched_public_identity(self):
        info = AsyncMock(return_value={"mid": 456, "name": "实际昵称", "face": "https://i0.hdslb.com/face.jpg", "private": "omit"})
        with patch.object(reader.user.User, "get_user_info", info):
            value = await reader.dispatch("user_info", {"uid": "456"})
        self.assertEqual(value, {"uid": "456", "name": "实际昵称", "face": "https://i0.hdslb.com/face.jpg"})
        info.assert_awaited_once()

    async def test_user_lookup_rejects_invalid_uids_before_the_sdk(self):
        info = AsyncMock()
        with patch.object(reader.user.User, "get_user_info", info):
            for uid in ["0", "-1", "nickname", 456, "https://evil.test/456"]:
                with self.assertRaises(reader.ReadError):
                    await reader.dispatch("user_info", {"uid": uid})
        info.assert_not_awaited()

    async def test_user_lookup_rejects_mismatched_identity_and_sanitizes_network_failure(self):
        with patch.object(reader.user.User, "get_user_info", AsyncMock(return_value={"mid": 789, "name": "另一个人"})):
            with self.assertRaises(reader.ReadError) as caught:
                await reader.dispatch("user_info", {"uid": "456"})
            self.assertEqual(caught.exception.code, "USER_PROFILE")
        with patch.object(reader.user.User, "get_user_info", AsyncMock(side_effect=RuntimeError("secret network info"))):
            with self.assertRaises(reader.ReadError) as caught:
                await reader.dispatch("user_info", {"uid": "456"})
            self.assertNotIn("secret", str(caught.exception))
            self.assertEqual(caught.exception.code, "USER_LOOKUP_FAILED")

    async def test_budget_records_partial_coverage_without_inventing_text(self):
        FakeResponse.payload = json.dumps({"body": [
            {"content": "文" * 600}, {"content": "字" * 600}
        ]}).encode()
        value = await self.read(max_chars=1000)
        self.assertEqual(value["coverage"], "partial")
        self.assertEqual(len(value["segments"]), 1)
        self.assertNotIn("字", value["text"])

    async def test_no_subtitles_skip_instead_of_using_title_as_content(self):
        FakeVideo.subtitles = []
        value = await self.read()
        self.assertTrue(value["skipReason"])
        self.assertEqual(value["text"], "")

    async def test_sound_video_uses_comments_even_with_available_subtitles(self):
        sample = {"replies": [
            {"rpid": 1, "content": {"message": "敲击声音和摩擦声音交替出现"}},
            {"rpid": 2, "content": {"message": "评论里的感受和我的期待有差别"}},
        ]}
        with patch.object(FakeVideo, "get_info", return_value={"title": "ASMR 助眠", "cid": 123, "aid": 777}), \
                patch.object(FakeVideo, "get_subtitle", side_effect=AssertionError("must not read subtitles")), \
                patch.object(reader.community_module().comment, "get_comments", return_value=sample):
            value = await self.read()
        self.assertEqual(value["source"], "comments")
        self.assertEqual(value["commentSample"]["count"], 2)
        self.assertEqual(value["accountUid"], "0")
        self.assertEqual(value["segments"], [])

    async def test_foreign_or_non_https_subtitle_address_is_rejected(self):
        for url in ["https://evil.test/subtitle.json", "http://i0.hdslb.com/subtitle.json"]:
            FakeVideo.subtitles = [{"subtitle_url": url}]
            with self.assertRaises(reader.ReadError) as caught:
                await self.read()
            self.assertEqual(caught.exception.code, "SUBTITLE_URL")

    async def test_oversized_response_is_bounded(self):
        FakeResponse.payload = b"x" * 4_000_001
        with self.assertRaises(reader.ReadError) as caught:
            await self.read()
        self.assertEqual(caught.exception.code, "SUBTITLE_TOO_LARGE")

    async def test_no_public_comment_send_and_no_read_without_login(self):
        with self.assertRaises(reader.ReadError):
            await reader.dispatch("send_comment", {})
        with patch.object(reader, "credential", return_value=reader.Credential()):
            with self.assertRaises(reader.ReadError) as caught:
                await self.read()
            self.assertEqual(caught.exception.code, "NOT_LOGGED_IN")

class LoginTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        reader.DATA.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=reader.DATA)
        self.path = Path(self.temp.name) / "credential.json"
        self.saved = patch.object(reader, "CREDENTIAL", self.path)
        self.saved.start()
        reader.login = None

    async def asyncTearDown(self):
        if reader.login is not None:
            await reader.login.close()
        reader.login = None
        self.saved.stop()
        self.temp.cleanup()

    async def test_empty_credentials_must_not_be_saved_as_success(self):
        self.path.write_text('{"existing":"keep"}')
        with self.assertRaises(reader.ReadError):
            reader.save_credential(reader.Credential())
        self.assertEqual(json.loads(self.path.read_text()), {"existing": "keep"})

    async def test_duplicate_poll_after_success_keeps_verified_login(self):
        reader.login = None
        with patch.object(reader, "account", AsyncMock(return_value={"status": "logged_in"})):
            result = await reader.dispatch("login_poll", {})
        self.assertEqual(result["status"], "logged_in")

    def qr_session(self, states):
        def handler(request):
            if request.url.path.endswith("/generate"):
                return reader.httpx.Response(200, json={"code": 0, "data": {
                    "url": "https://passport.bilibili.com/h5-app/passport/login/scan?test=1",
                    "qrcode_key": "mock-key",
                }})
            self.assertEqual(request.url.params["qrcode_key"], "mock-key")
            code, extra, headers = states.pop(0)
            return reader.httpx.Response(200, json={"code": 0, "data": {"code": code, **extra}}, headers=headers)
        return reader.WebQrLogin(reader.httpx.AsyncClient(transport=reader.httpx.MockTransport(handler)))

    async def test_poll_waits_for_confirmation_and_reads_set_cookie_on_success(self):
        session = self.qr_session([
            (86101, {}, []), (86090, {}, []), (0, {"url": ""}, [
                ("set-cookie", "SESSDATA=mock-session; Domain=.bilibili.com; Path=/"),
                ("set-cookie", "bili_jct=mock-csrf; Domain=.bilibili.com; Path=/"),
                ("set-cookie", "DedeUserID=123; Domain=.bilibili.com; Path=/"),
            ]),
        ])
        reader.login = session
        self.assertTrue((await session.generate()).startswith("data:image/png;base64,"))
        self.assertEqual((await reader.dispatch("login_poll", {}))["status"], "waiting_scan")
        self.assertEqual((await reader.dispatch("login_poll", {}))["status"], "confirming")
        with patch.object(reader, "account", AsyncMock(return_value={"status": "logged_in"})):
            self.assertEqual((await reader.dispatch("login_poll", {}))["status"], "logged_in")
            self.assertEqual((await reader.dispatch("login_poll", {}))["status"], "logged_in")
        self.assertIsNone(reader.login)
        self.assertEqual(reader.credential().dedeuserid, "123")

    async def test_url_fallback_and_expiry(self):
        session = self.qr_session([(0, {"url": "https://passport.biligame.com/crossDomain?SESSDATA=mock%2Cvalue&bili_jct=mock-csrf&DedeUserID=321"}, [])])
        reader.login = session
        await session.generate()
        with patch.object(reader, "account", AsyncMock(return_value={"status": "logged_in"})):
            await reader.dispatch("login_poll", {})
        self.assertEqual(reader.credential().dedeuserid, "321")
        session = self.qr_session([(86038, {}, [])])
        reader.login = session
        await session.generate()
        self.assertEqual((await reader.dispatch("login_poll", {}))["status"], "qr_expired")
        self.assertIsNone(reader.login)

    async def test_incomplete_or_unknown_success_does_not_replace_credentials(self):
        self.path.write_text('{"existing":"keep"}')
        for code in (0, 99999):
            session = self.qr_session([(code, {"url": ""}, [])])
            reader.login = session
            await session.generate()
            if code == 0:
                self.assertEqual((await reader.dispatch("login_poll", {}))["status"], "login_failed")
            else:
                with self.assertRaises(reader.ReadError):
                    await reader.dispatch("login_poll", {})
                await session.close()
                reader.login = None
            self.assertEqual(json.loads(self.path.read_text()), {"existing": "keep"})

    async def test_network_failure_does_not_call_stored_login_expired(self):
        cred = reader.Credential(sessdata="mock-session", bili_jct="mock-csrf", dedeuserid="123")
        with patch.object(reader, "credential", return_value=cred), patch.object(reader.user, "get_self_info", AsyncMock(side_effect=TimeoutError())):
            self.assertEqual((await reader.account())["status"], "unverified")


class SearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_uses_video_type_and_returns_bounded_clean_candidates(self):
        api = AsyncMock(return_value={"result": [
            {"bvid": "BV1xx411c7mD", "title": '<em class="keyword">测试</em>&amp;视频'},
            {"bvid": "BV1xx411c7mD", "title": "重复"}, {"bvid": "invalid", "title": "忽略"},
        ]})
        with patch.object(reader, "credential", return_value=reader.Credential(sessdata="mock")), patch.object(reader.search, "search_by_type", api):
            result = await reader.dispatch("search_videos", {"keyword": "测试", "page": 2})
        self.assertEqual(result["videos"], [{"bvid": "BV1xx411c7mD", "title": "测试&视频"}])
        self.assertEqual(api.call_args.kwargs["page_size"], 20)
        self.assertEqual(api.call_args.kwargs["search_type"], reader.search.SearchObjectType.VIDEO)

    async def test_search_rejects_bad_input_and_requires_login(self):
        for params in [{"keyword": ""}, {"keyword": "bad\ninput"}, {"keyword": "测试", "page": True}, {"keyword": "测试", "page": 21}]:
            with self.assertRaises(reader.ReadError):
                await reader.dispatch("search_videos", params)
        with patch.object(reader, "credential", return_value=reader.Credential()):
            with self.assertRaises(reader.ReadError) as caught:
                await reader.dispatch("search_videos", {"keyword": "测试"})
            self.assertEqual(caught.exception.code, "NOT_LOGGED_IN")


if __name__ == "__main__":
    unittest.main()
