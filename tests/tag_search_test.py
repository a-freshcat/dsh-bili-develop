"""Only synthetic SDK responses; no platform traffic."""
import sys
import os
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, AsyncMock
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import tag_search
os.environ['BILI_HARNESS_DATA'] = str(Path(__file__).resolve().parents[1] / '.runtime' / 'tag-reader-tests')
spec = importlib.util.spec_from_file_location('tag_test_reader', Path(__file__).resolve().parents[1] / 'python' / 'reader.py')
reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)


class TagSearchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cred = Credential(sessdata='test-only', dedeuserid='123')
        self.mapping = {'BV1000000000': ['ASMR', '助眠'], 'BV2000000000': ['游戏'], 'BV3000000000': ['ASMR助眠']}
        self.rows = [{'bvid': bv, 'title': '没有目标词的标题' if i == 0 else 'ASMR 助眠'} for i, bv in enumerate(self.mapping)]
        self.reads = []
        outer = self
        class Video:
            def __init__(self, bvid, **kwargs):
                self.bvid = bvid
            async def get_info(self):
                return {'bvid': self.bvid, 'cid': 123}
            async def get_tags(self, **kwargs):
                outer.reads.append(self.bvid)
                value = outer.mapping[self.bvid]
                if isinstance(value, Exception):
                    raise value
                return [{'tag_id': i + 1, 'tag_name': name} for i, name in enumerate(value)]
        self.patch = patch.object(tag_search.video, 'Video', Video); self.patch.start()

    def tearDown(self):
        self.patch.stop()

    async def search(self, tags=None, match='any'):
        return await tag_search.filter_videos(self.rows, {'tags': tags or ['ASMR'], 'match': match}, self.cred)

    async def test_actual_tag_hits_survive_missing_title_words_and_title_only_hits_are_rejected(self):
        result = await self.search()
        self.assertEqual([r['bvid'] for r in result['videos']], ['BV1000000000'])
        self.assertEqual(result['tagStats'], {'checked': 3, 'verified': 3, 'matched': 1, 'mismatched': 2, 'unverified': 0})

    async def test_all_matching_and_normalization_use_full_labels(self):
        result = await self.search(['ＡＳＭＲ', ' 助眠 '], 'all')
        self.assertEqual(len(result['videos']), 1)
        result = await self.search(['asm'], 'any')
        self.assertEqual(result['videos'], [])

    async def test_failed_label_read_cannot_fall_back_to_title(self):
        self.mapping['BV1000000000'] = TimeoutError('synthetic')
        result = await self.search()
        self.assertEqual(result['videos'], []); self.assertEqual(result['tagStats']['unverified'], 1)

    async def test_platform_auth_or_risk_error_stops_the_whole_page(self):
        error = RuntimeError('synthetic'); error.code = -412
        self.mapping['BV1000000000'] = error
        with self.assertRaisesRegex(tag_search.TagError, '本轮停止'):
            await self.search()

    async def test_invalid_filter_or_missing_account_fails_before_metadata_reads(self):
        for value in ({'tags': [], 'match': 'any'}, {'tags': ['ASMR'], 'match': 'unknown'}, {'tags': ['bad\nline'], 'match': 'any'}):
            with self.assertRaises(tag_search.TagError):
                await tag_search.filter_videos(self.rows, value, self.cred)
        with self.assertRaises(tag_search.TagError):
            await tag_search.filter_videos(self.rows, {'tags': ['ASMR'], 'match': 'any'}, Credential())
        self.assertEqual(self.reads, [])

    async def test_reader_dispatch_filters_actual_tags_but_keyword_mode_remains_unfiltered(self):
        search = AsyncMock(return_value={'result': self.rows})
        with patch.object(reader, 'credential', return_value=self.cred), patch.object(reader.search, 'search_by_type', search):
            result = await reader.dispatch('search_videos', {'keyword': 'ASMR', 'tag_filter': {'tags': ['ASMR'], 'match': 'any'}})
            self.assertEqual(result['source'], 'tag'); self.assertEqual(result['query'], 'ASMR')
            self.assertEqual(len(result['videos']), 1); self.assertEqual(result['videos'][0]['title'], '没有目标词的标题')
            read_count = len(self.reads)
            keyword = await reader.dispatch('search_videos', {'keyword': 'ASMR'})
            self.assertEqual(len(keyword['videos']), 3); self.assertEqual(len(self.reads), read_count)
            search.reset_mock()
            with self.assertRaises(reader.ReadError):
                await reader.dispatch('search_videos', {'keyword': 'ASMR', 'tag_filter': {'tags': [], 'match': 'any'}})
            search.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
