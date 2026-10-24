"""Temporary synthetic credentials only; never reads the user's credential file."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from urllib.parse import quote
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import secure_storage
from privacy_guard import assert_outgoing


class PrivacyTests(unittest.TestCase):
    def test_secret_raw_encoded_width_spacing_and_base64_are_rejected(self):
        secret = 'synthetic-cookie+/=='; cred = SimpleNamespace(sessdata=secret)
        for value in [secret, quote(secret, safe=''), base64.b64encode(secret.encode()).decode(), ' '.join(secret), 'ＳＥＳＳＤＡＴＡ=synthetic-value']:
            with self.assertRaises(ValueError):
                assert_outgoing('仅供测试 ' + value, cred)
        assert_outgoing('正常的公开视频评价。', cred)

    def test_roundtrip_legacy_upgrade_and_atomic_failure_preserve_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'credential.json'; value = {'sessdata': 'synthetic-only-cookie', 'bili_jct': 'synthetic-csrf-value'}
            path.write_text(json.dumps(value), encoding='utf8')
            self.assertEqual(secure_storage.load(path), value)
            if os.name == 'nt':
                self.assertNotIn('synthetic-only-cookie', path.read_text())
                self.assertEqual(json.loads(path.read_text())['format'], 'dpapi-v1')
            else:
                self.assertEqual(path.stat().st_mode & 0o077, 0)
            previous = path.read_bytes()
            with patch.object(secure_storage.os, 'replace', side_effect=OSError('synthetic failure')):
                with self.assertRaises(OSError):
                    secure_storage.save(path, {'sessdata': 'changed synthetic value'})
            self.assertEqual(path.read_bytes(), previous)
            self.assertEqual(list(Path(directory).glob('.credential-*.tmp')), [])
            secure_storage.save(path, value); self.assertEqual(secure_storage.load(path), value)

    def test_invalid_encrypted_storage_does_not_fall_back_to_plaintext_or_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'credential.json'; raw = json.dumps({'format': 'dpapi-v1', 'blob': 'invalid base64'})
            path.write_text(raw)
            with self.assertRaises(Exception):
                secure_storage.load(path)
            self.assertEqual(path.read_text(), raw)
            path.write_text('[]')
            with self.assertRaises(ValueError):
                secure_storage.load(path)


if __name__ == '__main__':
    unittest.main()
