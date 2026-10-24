"""Explicit, cancellable setup of an optional public Whisper model."""
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

MODELS = {name: "Systran/faster-whisper-" + name for name in ("tiny", "base", "small", "medium")}
SOURCES = {"official": "https://huggingface.co", "mirror": "https://hf-mirror.com"}
NAMES = {"config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.txt", "vocabulary.json"}
REQUIRED = {"config.json", "model.bin", "tokenizer.json"}


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def child_path(root, name):
    path = root / name
    if Path(name).name != name or path.is_symlink() or path.resolve().parent != root.resolve():
        raise ValueError("MODEL_PATH")
    return path


def valid_file(directory, row):
    if not isinstance(row, dict) or row.get("name") not in NAMES or type(row.get("size")) is not int or row["size"] <= 0:
        return False
    path = child_path(directory, row["name"])
    if not path.is_file() or path.stat().st_size != row["size"]:
        return False
    expected = row.get("sha256")
    if expected:
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            return False
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                return False
    return True


def valid_files(directory, files):
    return isinstance(files, list) and all(isinstance(row, dict) for row in files) and \
        REQUIRED.issubset({row.get("name") for row in files}) and all(valid_file(directory, row) for row in files)


def verify_model(path):
    from faster_whisper import WhisperModel
    model = WhisperModel(str(path), device="cpu", compute_type="int8", local_files_only=True, cpu_threads=4)
    del model
    gc.collect()


def prepare(root, model, source, progress=emit, api=None, download=None, verify=verify_model):
    if model not in MODELS or source not in SOURCES:
        raise ValueError("MODEL_INPUT")
    if not root.is_absolute() or root.is_symlink():
        raise ValueError("MODEL_PATH")
    root.mkdir(parents=True, exist_ok=True)
    pointer = child_path(root, model + ".json")
    if pointer.is_file():
        try:
            cached = json.loads(pointer.read_text(encoding="utf-8"))
            if cached.get("model") == model and cached.get("repo") == MODELS[model] and re.fullmatch(r"[0-9a-f]{40}", cached.get("revision", "")):
                target = child_path(root, cached["directory"])
                if target.is_dir() and valid_files(target, cached["files"]):
                    progress({"stage": "verifying_model"})
                    verify(target)
                    return {"path": str(target), "model": model, "revision": cached["revision"], "reused": True}
        except (ValueError, KeyError, OSError):
            pass
    if api is None or download is None:
        from huggingface_hub import HfApi, hf_hub_download
        api = api or HfApi(endpoint=SOURCES[source], token=False)
        download = download or hf_hub_download
    progress({"stage": "checking_model"})
    info = api.model_info(MODELS[model], files_metadata=True, timeout=20, token=False)
    if not re.fullmatch(r"[0-9a-f]{40}", info.sha):
        raise ValueError("MODEL_REVISION")
    files = []
    for item in info.siblings:
        if item.rfilename not in NAMES:
            continue
        if type(item.size) is not int or item.size <= 0:
            raise ValueError("MODEL_SIZE")
        digest = getattr(getattr(item, "lfs", None), "sha256", None)
        files.append({"name": item.rfilename, "size": item.size, **({"sha256": digest} if digest else {})})
    if not REQUIRED.issubset({row["name"] for row in files}) or sum(row["size"] for row in files) > 2_000_000_000:
        raise ValueError("MODEL_FILES")
    stage = child_path(root, ".download-" + model)
    stage.mkdir(exist_ok=True)
    total = sum(row["size"] for row in files)
    completed = 0
    from tqdm.auto import tqdm
    for row in sorted(files, key=lambda row: row["size"]):
        progress({"stage": "downloading_model", "downloadedBytes": completed, "totalBytes": total})
        # Per-file byte progress. No paths, tokens or raw HTTP diagnostics enter UI.
        class Meter(tqdm):
            def __init__(self, *args, **kwargs):
                kwargs["disable"] = True
                super().__init__(*args, **kwargs)
                self.last_sent = 0
            def update(self, n=1):
                self.n += n
                now = time.monotonic()
                if now - self.last_sent >= 0.25:
                    self.last_sent = now
                    progress({"stage": "downloading_model", "downloadedBytes": min(total, completed + self.n), "totalBytes": total})
        destination = child_path(stage, row["name"])
        force = destination.exists() and not valid_file(stage, row)
        downloaded = Path(download(repo_id=MODELS[model], filename=row["name"], revision=info.sha,
                                   local_dir=stage, endpoint=SOURCES[source], token=False, tqdm_class=Meter, force_download=force))
        if downloaded.resolve() != child_path(stage, row["name"]).resolve():
            raise ValueError("MODEL_PATH")
        completed += row["size"]
    progress({"stage": "verifying_model", "downloadedBytes": total, "totalBytes": total})
    if not valid_files(stage, files):
        raise ValueError("MODEL_INTEGRITY")
    verify(stage)
    target = child_path(root, model + "-" + info.sha[:12] + "-" + uuid.uuid4().hex[:8])
    stage.rename(target)
    manifest = {"model": model, "repo": MODELS[model], "revision": info.sha, "directory": target.name, "files": files}
    temporary = child_path(root, "." + uuid.uuid4().hex + ".json")
    temporary.write_text(json.dumps(manifest), encoding="utf-8")
    os.replace(temporary, pointer)
    return {"path": str(target), "model": model, "revision": info.sha, "reused": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--model", choices=MODELS, required=True)
    parser.add_argument("--source", choices=SOURCES, default="official")
    args = parser.parse_args()
    # Public downloads only; never implicitly consume another application's HF login.
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "30"
    try:
        result = prepare(Path(args.root), args.model, args.source)
        emit({"ok": True, "result": result})
    except Exception:
        emit({"ok": False, "message": "模型准备未完成，请检查下载源、网络、磁盘或音频依赖；已有模型与转写设置已保留。"})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
