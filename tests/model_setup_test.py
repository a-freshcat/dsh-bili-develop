import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("model_setup_under_test", ROOT / "python" / "model_setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ModelSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / ".runtime")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "asr-models"
        self.payloads = {"config.json": b"{}", "model.bin": b"fixture weights", "tokenizer.json": b"{}"}
        self.info = SimpleNamespace(sha="a" * 40, siblings=[SimpleNamespace(rfilename=name, size=len(data),
            lfs=SimpleNamespace(sha256=hashlib.sha256(data).hexdigest()) if name == "model.bin" else None)
            for name, data in self.payloads.items()])
        self.metadata_calls, self.download_calls, self.verify_calls, self.progress = 0, 0, 0, []
        self.api = SimpleNamespace(model_info=self.model_info)
        fake_tqdm = patch.dict(sys.modules, {"tqdm.auto": SimpleNamespace(tqdm=object)})
        fake_tqdm.start()
        self.addCleanup(fake_tqdm.stop)

    def model_info(self, repo, **kwargs):
        self.metadata_calls += 1
        self.assertFalse(kwargs["token"])
        self.assertTrue(kwargs["files_metadata"])
        return self.info

    def download(self, **kwargs):
        self.download_calls += 1
        self.assertEqual(kwargs["revision"], "a" * 40)
        self.assertFalse(kwargs["token"])
        self.assertEqual(kwargs["endpoint"], "https://huggingface.co")
        target = kwargs["local_dir"] / kwargs["filename"]
        target.write_bytes(self.payloads[kwargs["filename"]])
        return str(target)

    def verify(self, path):
        self.verify_calls += 1
        self.assertEqual((path / "model.bin").read_bytes(), self.payloads["model.bin"])

    def prepare(self, **kwargs):
        return setup.prepare(self.root, "tiny", "official", self.progress.append, api=self.api,
                             download=kwargs.get("download", self.download), verify=kwargs.get("verify", self.verify))

    def test_publish_only_after_valid_files_and_load_then_reuse_without_network(self):
        first = self.prepare()
        self.assertTrue(Path(first["path"]).is_dir())
        self.assertFalse(first["reused"])
        self.assertEqual(self.download_calls, 3)
        self.assertEqual(self.verify_calls, 1)
        second = self.prepare()
        self.assertTrue(second["reused"])
        self.assertEqual(first["path"], second["path"])
        self.assertEqual(self.metadata_calls, 1)
        self.assertEqual(self.download_calls, 3)
        self.assertEqual(self.verify_calls, 2)

    def test_bad_digest_never_publishes_a_ready_pointer(self):
        def corrupt(**kwargs):
            target = Path(self.download(**kwargs))
            if kwargs["filename"] == "model.bin":
                target.write_bytes(b"x" * len(self.payloads["model.bin"]))
            return str(target)
        with self.assertRaises(ValueError):
            self.prepare(download=corrupt)
        self.assertFalse((self.root / "tiny.json").exists())
        self.assertEqual(self.verify_calls, 0)
        forced = []
        def retry(**kwargs):
            if kwargs["filename"] == "model.bin":
                forced.append(kwargs["force_download"])
            return self.download(**kwargs)
        result = self.prepare(download=retry)
        self.assertTrue(Path(result["path"]).is_dir())
        self.assertEqual(forced, [True])

    def test_load_failure_keeps_the_previous_pointer_and_never_marks_ready(self):
        self.root.mkdir()
        pointer = self.root / "tiny.json"
        old = '{"model":"old-pointer"}'
        pointer.write_text(old)
        def fail(path):
            raise RuntimeError("fixture model load failure")
        with self.assertRaises(RuntimeError):
            self.prepare(verify=fail)
        self.assertEqual(pointer.read_text(), old)

    def test_partial_download_can_be_retried_without_publishing_an_incomplete_model(self):
        def interrupt(**kwargs):
            if kwargs["filename"] == "model.bin":
                raise OSError("interrupted fixture download")
            return self.download(**kwargs)
        with self.assertRaises(OSError):
            self.prepare(download=interrupt)
        self.assertFalse((self.root / "tiny.json").exists())
        result = self.prepare()
        self.assertTrue(Path(result["path"]).is_dir())

    def test_paths_and_unrecognized_models_are_rejected_before_any_download(self):
        self.root.mkdir()
        for name in ("..", "../outside", str(ROOT / "outside")):
            with self.assertRaises(ValueError):
                setup.child_path(self.root, name)
        with self.assertRaises(ValueError):
            setup.prepare(self.root, "arbitrary/repo", "official", api=self.api, download=self.download)
        with self.assertRaises(ValueError):
            setup.prepare(self.root, "tiny", "https://evil.test", api=self.api, download=self.download)
        self.assertEqual(self.download_calls + self.metadata_calls, 0)

    def test_invalid_repository_file_sizes_do_not_start_downloads(self):
        self.info.siblings[0].size = 0
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(self.download_calls, 0)


if __name__ == "__main__":
    unittest.main()
