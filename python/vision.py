"""Optional uniform frame sampling for visual evaluation.

Downloads a bounded prefix of the DASH video stream, decodes it with PyAV
(bundled FFmpeg, no external binary), and returns evenly spaced JPEG frames.
No OCR runs here: frames are handed to the multimodal model as-is.
"""
import asyncio
import base64
import io
import math
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx

DOWNLOAD_LIMIT = 64 * 1024 * 1024
MAX_FRAMES = 24
LONG_EDGE = 768
JPEG_QUALITY = 80
FRAME_BYTES_TARGET = 120 * 1024


class VisionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def cleanup_temporary(data_dir):
    root = data_dir / "tmp"
    if not root.is_dir() or root.is_symlink():
        return {"removed": 0, "message": "没有遗留画面缓存。"}
    removed = 0
    for directory in root.glob("frames-*"):
        if not directory.is_dir() or directory.is_symlink() or directory.resolve().parent != root.resolve():
            continue
        target = directory / "video.media"
        if target.is_symlink() or target.resolve().parent != directory.resolve():
            continue
        try:
            target.unlink(missing_ok=True)
            directory.rmdir()  # Never recursively remove other contents.
            removed += 1
        except OSError:
            pass  # An older worker may still be releasing a file handle.
    return {"removed": removed, "message": f"已清理{removed}个遗留画面缓存目录；使用中的文件稍后再清理。"}


def check_environment():
    import importlib.util
    dependencies = all(importlib.util.find_spec(name) is not None for name in ("av", "PIL"))
    message = "本机可以抽帧；不需要外部ffmpeg。" if dependencies else "请先准备画面依赖（av、Pillow）。"
    return {"ready": dependencies, "dependencies": dependencies, "message": message}


def video_url(url):
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError:
        raise VisionError("VISION_URL", "平台视频地址格式无效。") from None
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443) or not parsed.hostname or not any(
        parsed.hostname == host or parsed.hostname.endswith("." + host)
        for host in ("bilivideo.com", "bilivideo.cn", "hdslb.com", "bilibili.com")
    ):
        raise VisionError("VISION_URL", "平台视频地址不在支持的HTTPS范围内。")
    return url


def select_video_url(choices):
    """Lowest resolution AVC keeps decode cheap and OCR/model input adequate."""
    tracks = [row for row in choices[:40] if isinstance(row, dict)] if isinstance(choices, list) else []
    avc = [row for row in tracks if row.get("codecid") == 7]
    ranked = avc or tracks
    ranked.sort(key=lambda row: (
        row.get("height") if type(row.get("height")) is int and row["height"] > 0 else 10 ** 6,
        row.get("bandwidth") if type(row.get("bandwidth")) is int and row["bandwidth"] > 0 else 10 ** 6,
    ))
    for row in ranked:
        backups = row.get("backupUrl") or row.get("backup_url") or []
        urls = [row.get("baseUrl") or row.get("base_url")] + (backups[:10] if isinstance(backups, list) else [])
        for url in urls:
            if not isinstance(url, str):
                continue
            try:
                return video_url(url)
            except VisionError:
                continue
    raise VisionError("VISION_URL", "平台主视频流及备用地址均不符合HTTPS下载规则；未抽帧，可稍后重试。")


async def download(url, target, limit_bytes):
    video_url(url)
    # No redirects/cookies: the signed media URL already grants access.
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        async with client.stream("GET", url, headers={"Referer": "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0"}) as response:
            response.raise_for_status()
            size = 0
            with target.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > limit_bytes:
                        # A truncated prefix is still decodable: keep what arrived.
                        output.write(chunk[: max(0, limit_bytes - (size - len(chunk)))])
                        break
                    output.write(chunk)
    if size == 0:
        raise VisionError("VISION_EMPTY", "平台返回了空视频流。")


def even_timestamps(duration, count):
    """Uniform interior sampling; start and end are excluded."""
    if count <= 0 or not duration or duration <= 0:
        return []
    step = duration / (count + 1)
    return [round(step * (index + 1), 3) for index in range(count)]


def encode_frame(array, long_edge=LONG_EDGE, quality=JPEG_QUALITY):
    from PIL import Image
    image = Image.fromarray(array)
    width, height = image.size
    scale = min(1.0, float(long_edge) / max(width, height))
    if scale < 1.0:
        image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
    for attempt in range(4):
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=max(40, quality - attempt * 10), optimize=True)
        data = buffer.getvalue()
        if len(data) <= FRAME_BYTES_TARGET:
            break
    return data, image.size


def sample(path, duration, count):
    import av

    targets = even_timestamps(duration, count)
    if not targets:
        raise VisionError("VISION_INPUT", "缺少可用的视频时长，未抽帧。")
    frames, index = [], 0
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        last_seconds = None
        for frame in container.decode(video=0):
            seconds = float(frame.pts * frame.time_base) if frame.pts is not None else None
            if seconds is None:
                continue
            last_seconds = seconds
            while index < len(targets) and seconds >= targets[index]:
                data, size = encode_frame(frame.to_ndarray(format="rgb24"))
                frames.append({"at": round(seconds, 2), "bytes": data, "width": size[0], "height": size[1]})
                index += 1
            if index >= len(targets):
                break
    if not frames:
        raise VisionError("VISION_EMPTY", "视频流前段没有可解码画面；未据此推断内容。")
    # The downloaded prefix may end before the requested span; report what is real.
    processed = min(duration, (last_seconds or 0) + 0.1)
    return frames, processed


async def run(obj, params, data_dir, account_uid):
    bvid, cid = params.get("bvid"), params.get("cid")
    count = params.get("frames")
    if type(cid) is not int or cid <= 0:
        raise VisionError("VISION_INPUT", "视频分P参数无效。")
    if type(count) is not int or not 1 <= count <= MAX_FRAMES:
        raise VisionError("VISION_INPUT", "抽帧数量需要在1～24之间。")
    if params.get("expected_account") != account_uid:
        raise VisionError("ACCOUNT_CHANGED", "抽帧账号与读取账号不一致，未获取视频流。")

    info = await obj.get_info()
    first = (info.get("pages") or [{}])[0]
    actual_cid = first.get("cid") or info.get("cid")
    duration = first.get("duration") or info.get("duration", 0)
    if actual_cid != cid or not isinstance(duration, (int, float)) or duration <= 0:
        raise VisionError("VISION_METADATA", "画面分P与已读取视频不一致。")

    download_info = await obj.get_download_url(cid=cid)
    choices = (download_info.get("dash") or {}).get("video") or []
    if not choices:
        raise VisionError("VISION_UNAVAILABLE", "平台没有返回可用的视频流；本次未抽帧。")
    url = select_video_url(choices)

    cache = data_dir / "tmp"
    cache.mkdir(parents=True, exist_ok=True)
    if cache.is_symlink() or cache.resolve().parent != data_dir.resolve():
        raise VisionError("VISION_PATH", "画面临时目录必须位于插件数据目录内。")
    cleanup_temporary(data_dir)

    # Short videos need only the opening prefix; long ones need more span for
    # uniform coverage, so scale the byte budget with the requested span.
    limit_bytes = min(DOWNLOAD_LIMIT, max(8 * 1024 * 1024, int(duration) * 512 * 1024))
    with tempfile.TemporaryDirectory(prefix="frames-", dir=cache) as temporary:
        target = Path(temporary) / "video.media"
        await download(url, target, limit_bytes)
        try:
            frames, processed = await asyncio.to_thread(sample, target, duration, count)
        except VisionError:
            raise
        except Exception:
            raise VisionError("VISION_DECODE", "视频流解码未完成；请检查编码格式与运行依赖。") from None

    for frame in frames:
        frame["data"] = base64.b64encode(frame.pop("bytes")).decode("ascii")
    return {
        "bvid": bvid, "cid": cid, "accountUid": account_uid, "source": "frames",
        "frames": frames, "processedSeconds": round(processed, 2), "duration": duration,
        "processor": "pyav", "coverage": "complete" if processed >= duration - 0.5 else "partial",
        "totalFrames": len(frames),
    }
