"""Synthetic local cards only; no real accounts, model calls or network."""
import io
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image
from bilibili_api import Credential
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import weekly
import weekly_card


class CardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        (Path(__file__).resolve().parents[1] / 'desktop-m0-m1').mkdir(exist_ok=True)

    def params(self):
        return {'body': '这是一份根据已读公开字幕整理的周记。' * 50, 'week': '2026-10-19', 'count': 3, 'sources': ['subtitle', 'comments']}

    async def test_card_is_readable_bounded_jpeg_and_contains_no_source_metadata(self):
        raw = weekly_card.draw_card(self.params())
        with Image.open(io.BytesIO(raw)) as image:
            self.assertEqual(image.format, 'JPEG'); self.assertEqual(image.size, (1200, 1500)); self.assertEqual(len(image.getexif()), 0)
        self.assertLess(len(raw), 2 * 1024 * 1024)

    async def test_dispatch_needs_no_login_and_never_touches_platform_functions(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / 'desktop-m0-m1', prefix='test-card-') as root:
            with patch.object(weekly.user, 'get_self_info', side_effect=AssertionError('must stay local')), patch.object(weekly.dynamic, 'send_dynamic', side_effect=AssertionError('must not publish')):
                value = await weekly.dispatch('weekly_card', self.params(), Credential(), Path(root))
            self.assertEqual(value['width'], 1200); self.assertEqual(value['height'], 1500)
            self.assertTrue((weekly.managed_images(root) / (value['hash'] + '.jpg')).is_file())

    async def test_invalid_payload_and_missing_font_fail_without_external_fallback(self):
        for changes in ({'body': ''}, {'week': 'invalid'}, {'count': 0}, {'sources': ['dm']}):
            with self.assertRaises(ValueError):
                weekly_card.draw_card({**self.params(), **changes})
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / 'desktop-m0-m1', prefix='test-card-') as root:
            with patch.object(weekly_card, 'font', side_effect=ValueError('unavailable')):
                with self.assertRaisesRegex(weekly.PublishError, '本地周报配图未生成'):
                    await weekly.dispatch('weekly_card', self.params(), Credential(), Path(root))


if __name__ == '__main__':
    unittest.main()
