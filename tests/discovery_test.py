"""Synthetic recommendation/metadata boundaries, no real account or network."""
import sys
import os
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import discovery


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = Credential(sessdata='synthetic-only', dedeuserid='123')
        self.rows = [{'bvid': 'BV1000000000', 'goto': 'av', 'title': '标题党里有兴趣词'}, {'bvid': 'BV2000000000', 'goto': 'av'}]
        self.reads = []
        self.bad = None
        outer = self
        class Video:
            def __init__(self, bvid, credential):
                self.bvid = bvid
            async def get_info(self):
                outer.reads.append(self.bvid)
                if outer.bad:
                    if isinstance(outer.bad, Exception):
                        raise outer.bad
                    return outer.bad
                return {'bvid': self.bvid, 'cid': 123, 'title': '实际标题', 'desc': '实际简介', 'duration': 20, 'owner': {'mid': 987, 'name': '公开作者'}}
            async def get_tags(self, cid):
                return [{'tag_id': 1, 'tag_name': '实际手工标签'}]
        self.identity = AsyncMock(return_value={'mid': 123})
        self.feed = AsyncMock(side_effect=lambda **kwargs: {'item': self.rows})
        self.patches = [patch.object(discovery.user, 'get_self_info', self.identity), patch.object(discovery.homepage, 'get_videos', self.feed),
                        patch.object(discovery.video, 'Video', Video)]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    async def test_feed_has_no_keyword_and_uses_actual_metadata_not_recommendation_titles(self):
        result = await discovery.recommend(self.cred)
        self.assertEqual(result['accountUid'], '123')
        self.assertEqual(result['source'], 'recommendation')
        self.assertEqual(result['videos'][0]['title'], '实际标题')
        self.assertEqual(result['videos'][0]['tags'], [{'id': '1', 'name': '实际手工标签'}])
        self.assertEqual(result['videos'][0]['description'], '实际简介')
        self.feed.assert_awaited_once_with(credential=self.cred)

    async def test_nonvideo_ads_duplicates_and_more_than_twelve_candidates_are_not_read(self):
        self.rows = [{'bvid': 'BV9000000000', 'goto': 'live'}, {'bvid': 'BV9000000001', 'is_ad': True}, {'bvid': 'BV9000000002', 'ad_info': {'any': True}},
                     {'bvid': 'malformed'}] + [{'bvid': 'BV' + str(n).zfill(10)} for n in range(20)] + [{'bvid': 'BV0000000000'}]
        result = await discovery.recommend(self.cred)
        self.assertEqual(len(result['videos']), 12)
        self.assertEqual(len(self.reads), 12)
        self.assertNotIn('BV9000000000', self.reads)

    async def test_incomplete_or_failed_metadata_is_not_replaced_with_title_only_candidates(self):
        for bad in [TimeoutError('synthetic'), {'bvid': 'BV9000000000'}, {'bvid': 'BV1000000000', 'cid': 123}]:
            self.bad = bad
            result = await discovery.recommend(self.cred)
            self.assertEqual(result['videos'], [])
            self.assertEqual(result['unverified'], 2)

    async def test_auth_and_risk_failure_stops_batch_without_anonymous_or_search_fallback(self):
        error = RuntimeError('synthetic private error'); error.code = -412; self.bad = error
        with self.assertRaises(discovery.DiscoveryError) as result:
            await discovery.recommend(self.cred)
        self.assertEqual(result.exception.code, 'DISCOVERY_UNAVAILABLE')
        self.assertNotIn('private error', str(result.exception))
        self.feed.assert_awaited_once()

    async def test_bad_identity_and_changed_platform_shape_are_explicit_failures(self):
        self.identity.return_value = {'mid': 'invalid'}
        with self.assertRaises(discovery.DiscoveryError):
            await discovery.recommend(self.cred)
        self.feed.assert_not_awaited()
        self.identity.return_value = {'mid': 123}; self.feed.side_effect = None; self.feed.return_value = {'unexpected': []}
        with self.assertRaises(discovery.DiscoveryError):
            await discovery.recommend(self.cred)

    async def test_no_session_cannot_request_recommendations(self):
        with self.assertRaises(discovery.DiscoveryError):
            await discovery.recommend(Credential())
        self.identity.assert_not_awaited(); self.feed.assert_not_awaited()

    async def test_reader_dispatch_routes_recommendations_and_returns_safe_specific_failure(self):
        root = Path(__file__).resolve().parents[1]
        os.environ['BILI_HARNESS_DATA'] = str(root / '.runtime' / 'discovery-reader-tests')
        spec = importlib.util.spec_from_file_location('discovery_reader_test', root / 'python' / 'reader.py')
        reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)
        with patch.object(reader, 'credential', return_value=self.cred):
            result = await reader.dispatch('recommend_videos', {})
            self.assertEqual(result['source'], 'recommendation')
            self.identity.return_value = {'mid': 'bad'}
            with self.assertRaises(reader.ReadError) as error:
                await reader.dispatch('recommend_videos', {})
            self.assertEqual(error.exception.code, 'DISCOVERY_ACCOUNT')


if __name__ == '__main__':
    unittest.main()
