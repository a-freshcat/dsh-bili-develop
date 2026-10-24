"""Optional local speech transcription; no service keys or model downloads."""
import asyncio
import importlib
import importlib.metadata
import importlib.util
import math
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class AudioError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def cleanup_temporary(data_dir):
    root = data_dir / "tmp"
    if not root.is_dir() or root.is_symlink():
        return {"removed": 0, "message": "没有遗留音频缓存。"}
    removed = 0
    for directory in root.glob("asr-*"):
        if not directory.is_dir() or directory.is_symlink() or directory.resolve().parent != root.resolve():
            continue
        target = directory / "track.media"
        if target.is_symlink() or target.resolve().parent != directory.resolve():
            continue
        try:
            target.unlink(missing_ok=True)
            directory.rmdir()  # Never recursively remove other contents.
            removed += 1
        except OSError:
            pass  # An older worker may still be releasing a file handle.
    return {"removed": removed, "message": f"已清理{removed}个遗留音频缓存目录；使用中的文件稍后再清理。"}


def check_environment(model_path):
    dependencies = all(importlib.util.find_spec(name) is not None for name in ("faster_whisper", "av", "numpy"))
    if dependencies:
        try:
            importlib.import_module("faster_whisper")
        except Exception:
            dependencies = False
    directory = Path(model_path) if model_path else None
    model_ready = bool(directory and directory.is_absolute() and directory.is_dir() and all(
        (directory / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")
    ))
    message = ("本地转写依赖与模型文件已找到；首次转写会验证模型能否加载。" if dependencies and model_ready else
               "请先准备音频依赖。" if not dependencies else
               "音频依赖已就绪；尚未找到讲话模型。可准备模型或填写含model.bin、config.json和tokenizer.json的绝对目录。")
    return {"ready": dependencies and model_ready, "dependencies": dependencies, "modelFiles": model_ready, "message": message}


def audio_url(url):
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        raise AudioError("AUDIO_URL", "平台音轨地址格式无效。") from None
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443) or not parsed.hostname or not any(
        parsed.hostname == host or parsed.hostname.endswith("." + host)
        for host in ("bilivideo.com", "bilivideo.cn", "hdslb.com", "bilibili.com")
    ):
        raise AudioError("AUDIO_URL", "平台音轨地址不在支持的HTTPS范围内。")
    return url


def select_audio_url(choices):
    """Prefer low bandwidth, but try signed backups under the same URL policy."""
    tracks = [row for row in choices[:20] if isinstance(row, dict)] if isinstance(choices, list) else []
    tracks.sort(key=lambda row: row.get('bandwidth') if type(row.get('bandwidth')) is int and row['bandwidth'] > 0 else float('inf'))
    for row in tracks:
        backups = row.get('backupUrl') or row.get('backup_url') or []
        urls = [row.get('baseUrl') or row.get('base_url')] + (backups[:10] if isinstance(backups, list) else [])
        for url in urls:
            if not isinstance(url, str):
                continue
            try:
                return audio_url(url)
            except AudioError:
                continue
    raise AudioError('AUDIO_URL', '平台主音轨及备用地址均不符合HTTPS下载规则；未获取音频，可稍后重试。')


async def download(url, target):
    audio_url(url)
    # No redirects/cookies: the signed media URL already grants access.
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        async with client.stream("GET", url, headers={"Referer": "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0"}) as response:
            response.raise_for_status()
            size = 0
            with target.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > 64 * 1024 * 1024:
                        raise AudioError("AUDIO_TOO_LARGE", "音轨超过首版64MiB下载上限，未进行转写。")
                    output.write(chunk)
    if size == 0:
        raise AudioError("AUDIO_EMPTY", "平台返回了空音轨。")


def decode_prefix(path, seconds):
    import av
    import numpy as np

    limit = seconds * 16000
    chunks, count = [], 0
    # This is the speech branch only. Original media is not downmixed on disk.
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    with av.open(str(path)) as container:
        for frame in container.decode(audio=0):
            frame.pts = None
            for converted in resampler.resample(frame):
                data = converted.to_ndarray().reshape(-1)[:limit - count]
                if data.size:
                    chunks.append(data.copy())
                    count += data.size
            if count >= limit:
                break
        if count < limit:
            for converted in resampler.resample(None):
                data = converted.to_ndarray().reshape(-1)[:limit - count]
                if data.size:
                    chunks.append(data.copy())
                    count += data.size
    if not count:
        raise AudioError("AUDIO_EMPTY", "音轨没有可解码的音频采样。")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def normalize_segments(rows, processed, max_chars):
    segments, used, previous, truncated = [], 0, 0, False
    for row in rows:
        text = row.text.strip()
        if not text or row.no_speech_prob > 0.6 or row.avg_logprob < -1.0:
            continue
        start, end = float(row.start), float(row.end)
        if not math.isfinite(start) or not math.isfinite(end):
            continue
        start, end = max(previous, start), min(processed, end)
        if end <= start:
            continue
        if used + len(text) + (1 if segments else 0) > max_chars:
            truncated = True
            break
        used += len(text) + (1 if segments else 0)
        segments.append({"from": start, "to": end, "text": text})
        previous = end
    return segments, truncated


def transcribe(path, model_path, seconds, max_chars):
    from faster_whisper import WhisperModel

    samples = decode_prefix(path, seconds)
    processed = len(samples) / 16000
    # A fresh instance per task bounds retained resources. Explicit existing path
    # and local_files_only prohibit implicit network downloads.
    model = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=4,
                         local_files_only=True, num_workers=1)
    rows, info = model.transcribe(samples, beam_size=3, vad_filter=True, condition_on_previous_text=False,
                                  no_speech_threshold=0.6, log_prob_threshold=-1.0)
    segments, truncated = normalize_segments(rows, processed, max_chars)
    return {"segments": segments, "text": "\n".join(row["text"] for row in segments),
            "processedSeconds": processed, "truncated": truncated, "language": info.language,
            "processor": {"name": "faster-whisper", "version": importlib.metadata.version("faster-whisper")}}


async def run(obj, params, data_dir, account_uid):
    bvid, cid, seconds = params.get("bvid"), params.get("cid"), params.get("seconds")
    if type(cid) is not int or cid <= 0 or type(seconds) is not int or not 1 <= seconds <= 3600:
        raise AudioError("AUDIO_INPUT", "音频分P或时长参数无效。")
    if params.get("expected_account") != account_uid:
        raise AudioError("ACCOUNT_CHANGED", "转写账号与读取账号不一致，未获取音轨。")
    if not check_environment(params.get("model_path", ""))["ready"]:
        raise AudioError("AUDIO_NOT_READY", "本地音频依赖或模型目录未就绪。")
    info = await obj.get_info()
    first = (info.get("pages") or [{}])[0]
    actual_cid = first.get("cid") or info.get("cid")
    duration = first.get("duration") or info.get("duration", 0)
    if actual_cid != cid or not isinstance(duration, (int, float)) or duration <= 0:
        raise AudioError("AUDIO_METADATA", "音轨分P与已读取视频不一致。")
    download_info = await obj.get_download_url(cid=cid)
    choices = (download_info.get("dash") or {}).get("audio") or []
    if not choices:
        raise AudioError("AUDIO_UNAVAILABLE", "平台没有返回可用的独立音轨；首版暂不处理合并音视频。")
    url = select_audio_url(choices)
    cache = data_dir / "tmp"
    cache.mkdir(parents=True, exist_ok=True)
    if cache.is_symlink() or cache.resolve().parent != data_dir.resolve():
        raise AudioError("AUDIO_PATH", "音频临时目录必须位于插件数据目录内。")
    cleanup_temporary(data_dir)
    max_chars = max(1000, min(int(params.get("max_chars", 18000)), 30000))
    # TemporaryDirectory and finally cleanup also cover network/model errors.
    with tempfile.TemporaryDirectory(prefix="asr-", dir=cache) as temporary:
        target = Path(temporary) / "track.media"
        await download(url, target)
        try:
            result = await asyncio.to_thread(transcribe, target, params["model_path"], seconds, max_chars)
        except AudioError:
            raise
        except Exception:
            raise AudioError("AUDIO_MODEL", "本地模型加载或转写未完成；请检查模型格式、内存和运行依赖。") from None
    return {**result, "bvid": bvid, "cid": cid, "accountUid": account_uid, "source": "asr",
            "coverage": "complete" if not result["truncated"] and result["processedSeconds"] >= duration - 0.1 else "partial",
            "totalSegments": len(result["segments"]), "processedRanges": [{"from": 0, "to": result["processedSeconds"]}],
            "skipReason": None if result["text"] else "已处理音频中未检测到可靠讲话；未推断ASMR音效或编造台词。"}
