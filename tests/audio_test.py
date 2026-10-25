"""Local audio boundaries; no model weights or account credentials required."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch, AsyncMock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("audio_under_test", ROOT / "python" / "audio.py")
audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio)


class AudioTests(unittest.IsolatedAsyncioTestCase):
    def test_cleanup_removes_only_known_media_and_preserves_unrelated_files(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime") as directory:
            root = Path(directory)
            clean = root / "tmp" / "asr-fixture"
            clean.mkdir(parents=True)
            (clean / "track.media").write_bytes(b"interrupted")
            preserve = root / "tmp" / "asr-unrelated"
            preserve.mkdir()
            (preserve / "keep.txt").write_text("preserve")
            result = audio.cleanup_temporary(root)
            self.assertEqual(result["removed"], 1)
            self.assertFalse(clean.exists())
            self.assertTrue((preserve / "keep.txt").exists())

    def test_url_rejects_foreign_hosts_and_credentials(self):
        self.assertEqual(audio.audio_url("https://upos.bilivideo.com/a?sign=fixture"), "https://upos.bilivideo.com/a?sign=fixture")
        for url in ["https://bilivideo.com.evil.test/a", "http://upos.bilivideo.com/a",
                    "file:///C:/model", "https://a:b@upos.bilivideo.com/a", "https://upos.bilivideo.com:8080/a"]:
            with self.assertRaises(audio.AudioError):
                audio.audio_url(url)

    def test_audio_backup_selection_preserves_https_host_port_and_credential_boundaries(self):
        safe = 'https://upos.bilivideo.com/audio'
        self.assertEqual(audio.select_audio_url([{'bandwidth': 1, 'base_url': 'https://x.mcdn.bilivideo.cn:8082/a', 'backup_url': [safe]}]), safe)
        for backup in ['https://evil.test/a', 'https://127.0.0.1/a', 'http://upos.bilivideo.com/a', 'https://a:b@upos.bilivideo.com/a', 'https://upos.bilivideo.com:8082/a']:
            with self.assertRaises(audio.AudioError):
                audio.select_audio_url([{'baseUrl': 'https://x.mcdn.bilivideo.cn:8082/a', 'backupUrl': [backup]}])
        self.assertEqual(audio.select_audio_url([{'bandwidth': 1, 'baseUrl': 'https://evil.test/a'}, {'bandwidth': 2, 'baseUrl': safe}]), safe)

    def test_environment_separates_missing_dependencies_and_existing_model_files(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime") as directory:
            with patch.object(audio.importlib.util, "find_spec", return_value=object()), patch.object(audio.importlib, "import_module", return_value=object()):
                self.assertFalse(audio.check_environment(directory)["ready"])
                for name in ("model.bin", "config.json", "tokenizer.json"):
                    (Path(directory) / name).write_text("fixture")
                self.assertTrue(audio.check_environment(directory)["ready"])
            with patch.object(audio.importlib.util, "find_spec", return_value=None):
                result = audio.check_environment(directory)
                self.assertFalse(result["ready"])
                self.assertTrue(result["modelFiles"])

    def test_silence_and_low_confidence_rows_are_not_presented_as_speech(self):
        row = lambda **kw: SimpleNamespace(start=0, end=3, text="虚构台词", no_speech_prob=kw.get("silence", 0), avg_logprob=kw.get("log", 0))
        segments, _ = audio.normalize_segments([row(silence=.9), row(log=-2)], 10, 1000)
        self.assertEqual(segments, [])

    async def test_empty_transcription_marks_no_text_coverage_and_explains_screen_text_boundary(self):
        obj = SimpleNamespace(get_info=AsyncMock(return_value={'cid': 123, 'duration': 63}),
                              get_download_url=AsyncMock(return_value={'dash': {'audio': [{'baseUrl': 'https://upos.bilivideo.com/a'}]}}))
        result = {'segments': [], 'text': '', 'processedSeconds': 62.647, 'truncated': False, 'language': 'en'}
        with tempfile.TemporaryDirectory(dir=ROOT / '.runtime') as directory:
            with patch.object(audio, 'check_environment', return_value={'ready': True}), patch.object(audio, 'download', AsyncMock()), patch.object(audio, 'transcribe', return_value=result):
                found = await audio.run(obj, {'bvid': 'BV1xx411c7mD', 'cid': 123, 'seconds': 63, 'expected_account': 'fixture', 'model_path': 'fixture'}, Path(directory), 'fixture')
        self.assertEqual(found['coverage'], 'none')
        self.assertEqual(found['totalSegments'], 0)
        self.assertIn('画面文字', found['skipReason'])
        self.assertIn('OCR', found['skipReason'])

    def test_timestamps_and_character_budget_are_bounded(self):
        rows = [SimpleNamespace(start=0, end=3, text="第一段讲话", no_speech_prob=0, avg_logprob=0),
                SimpleNamespace(start=2, end=99, text="第二段讲话", no_speech_prob=0, avg_logprob=0)]
        segments, truncated = audio.normalize_segments(rows, 5, 100)
        self.assertEqual(segments[1]["from"], 3)
        self.assertEqual(segments[1]["to"], 5)
        limited, truncated = audio.normalize_segments(rows, 5, 6)
        self.assertEqual(len(limited), 1)
        self.assertTrue(truncated)

    async def test_account_and_part_mismatch_prevent_download(self):
        obj = SimpleNamespace(get_info=AsyncMock(return_value={"cid": 123, "duration": 100}), get_download_url=AsyncMock())
        params = {"bvid": "BV1xx411c7mD", "cid": 999, "seconds": 20, "expected_account": "fixture", "model_path": "fixture"}
        with patch.object(audio, "check_environment", return_value={"ready": True}):
            with self.assertRaises(audio.AudioError):
                await audio.run(obj, {**params, "expected_account": "other"}, ROOT / ".runtime", "fixture")
            with self.assertRaises(audio.AudioError):
                await audio.run(obj, params, ROOT / ".runtime", "fixture")
        obj.get_download_url.assert_not_awaited()

    async def test_valid_audio_result_has_coverage_and_temporary_media_is_removed(self):
        obj = SimpleNamespace(get_info=AsyncMock(return_value={"cid": 123, "duration": 100}),
                              get_download_url=AsyncMock(return_value={"dash": {"audio": [{"baseUrl": "https://upos.bilivideo.com/a"}]}}))
        result = {"text": "讲话", "segments": [{"from": 0, "to": 1, "text": "讲话"}], "processedSeconds": 20, "truncated": False}
        paths = []
        async def download(_url, path):
            path.write_bytes(b"fixture media")
            paths.append(path)
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime") as directory:
            with patch.object(audio, "check_environment", return_value={"ready": True}), patch.object(audio, "download", download), patch.object(audio, "transcribe", return_value=result):
                value = await audio.run(obj, {"bvid": "BV1xx411c7mD", "cid": 123, "seconds": 20,
                                       "expected_account": "fixture", "model_path": "fixture"}, Path(directory), "fixture")
            self.assertEqual(value["coverage"], "partial")
            self.assertEqual(value["processedRanges"], [{"from": 0, "to": 20}])
            self.assertTrue(all(not path.exists() for path in paths))

    async def test_mcdn_nonstandard_port_uses_safe_https_backup_before_download(self):
        primary = 'https://xy1.mcdn.bilivideo.cn:8082/audio?sign=fixture'
        safe = 'https://upos-sz-mirrorhwo1.bilivideo.com/audio?sign=fixture'
        obj = SimpleNamespace(get_info=AsyncMock(return_value={'cid': 123, 'duration': 100}), get_download_url=AsyncMock(return_value={
            'dash': {'audio': [{'bandwidth': 1, 'baseUrl': primary, 'backupUrl': ['https://edge.mountaintoys.cn:4483/a', safe]}]}}))
        result = {'text': '讲话', 'segments': [], 'processedSeconds': 20, 'truncated': False}
        downloaded = []
        async def download(url, path):
            downloaded.append(url)
            path.write_bytes(b'fixture')
        with tempfile.TemporaryDirectory(dir=ROOT / '.runtime') as directory:
            with patch.object(audio, 'check_environment', return_value={'ready': True}), patch.object(audio, 'download', download), patch.object(audio, 'transcribe', return_value=result):
                await audio.run(obj, {'bvid': 'BV1xx411c7mD', 'cid': 123, 'seconds': 20, 'expected_account': 'fixture', 'model_path': 'fixture'}, Path(directory), 'fixture')
        self.assertEqual(downloaded, [safe])

    async def test_model_failure_also_removes_temporary_media(self):
        obj = SimpleNamespace(get_info=AsyncMock(return_value={"cid": 123, "duration": 100}),
                              get_download_url=AsyncMock(return_value={"dash": {"audio": [{"baseUrl": "https://upos.bilivideo.com/a"}]}}))
        paths = []
        async def download(_url, path):
            path.write_bytes(b"fixture")
            paths.append(path)
        with tempfile.TemporaryDirectory(dir=ROOT / ".runtime") as directory:
            with patch.object(audio, "check_environment", return_value={"ready": True}), patch.object(audio, "download", download), patch.object(audio, "transcribe", side_effect=RuntimeError("private model path")):
                with self.assertRaises(audio.AudioError) as caught:
                    await audio.run(obj, {"bvid": "BV1xx411c7mD", "cid": 123, "seconds": 20,
                                    "expected_account": "fixture", "model_path": "fixture"}, Path(directory), "fixture")
            self.assertEqual(caught.exception.code, "AUDIO_MODEL")
            self.assertNotIn("private", str(caught.exception))
            self.assertTrue(all(not path.exists() for path in paths))


if __name__ == "__main__":
    unittest.main()
