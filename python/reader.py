"""Bilibili adapter: video previews and separately admitted text DM replies."""
import asyncio
import base64
import contextlib
import importlib.metadata
import importlib.util
import io
import json
import os
import re
from html import unescape
from pathlib import Path
import sys
from urllib.parse import urlsplit, parse_qsl
from datetime import datetime, timezone

import httpx
import qrcode
from bilibili_api import Credential, video, user, search

DATA = Path(os.environ["BILI_HARNESS_DATA"])
CREDENTIAL = DATA / "credential.json"
login = None
_audio = None
_community = None
_private = None
_publishing = None
_vision = None


def publishing_module():
    global _publishing
    if _publishing is None:
        spec = importlib.util.spec_from_file_location("bili_publishing", Path(__file__).with_name("publishing.py"))
        _publishing = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_publishing)
    return _publishing


def private_module():
    global _private
    if _private is None:
        spec = importlib.util.spec_from_file_location("bili_private", Path(__file__).with_name("private.py"))
        _private = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_private)
    return _private


def audio_module():
    global _audio
    if _audio is None:
        spec = importlib.util.spec_from_file_location("bili_local_audio", Path(__file__).with_name("audio.py"))
        _audio = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_audio)
    return _audio


def community_module():
    global _community
    if _community is None:
        spec = importlib.util.spec_from_file_location("bili_community", Path(__file__).with_name("community.py"))
        _community = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_community)
    return _community


def vision_module():
    global _vision
    if _vision is None:
        spec = importlib.util.spec_from_file_location("bili_vision", Path(__file__).with_name("vision.py"))
        _vision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_vision)
    return _vision


class ReadError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def credential():
    if not CREDENTIAL.exists():
        return Credential()
    import secure_storage
    try:
        value = secure_storage.load(CREDENTIAL)
    except Exception:
        raise ReadError('CREDENTIAL_READ', '本机凭据无法解密或读取，请使用原操作系统账号，必要时重新扫码。') from None
    return Credential(**{k: value.get(k, "") for k in ("sessdata", "bili_jct", "buvid3", "dedeuserid")})


def save_credential(cred):
    value = {k: getattr(cred, k, "") for k in ("sessdata", "bili_jct", "buvid3", "dedeuserid")}
    if not all(value[k] for k in ("sessdata", "bili_jct", "dedeuserid")):
        raise ReadError("LOGIN_CREDENTIALS", "扫码已确认，但平台未返回完整登录凭据，请重新生成二维码。")
    import secure_storage
    secure_storage.save(CREDENTIAL, value)


class WebQrLogin:
    """Fixed web QR endpoints; retain response cookies as well as legacy URL credentials."""
    BASE = "https://passport.bilibili.com/x/passport-login/web/qrcode/"

    def __init__(self, client=None):
        self.client = client if client is not None else httpx.AsyncClient(
            timeout=15, follow_redirects=False,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"},
        )
        self.key = None

    async def close(self):
        await self.client.aclose()

    async def request(self, operation, **kwargs):
        response = await self.client.get(self.BASE + operation, **kwargs)
        response.raise_for_status()
        body = response.json()
        if body.get("code") != 0 or not isinstance(body.get("data"), dict):
            raise ReadError("LOGIN_RESPONSE", "平台登录接口未返回有效结果，请稍后重试。")
        return body["data"]

    async def generate(self):
        data = await self.request("generate")
        parsed = urlsplit(data.get("url", ""))
        if (not data.get("qrcode_key") or parsed.scheme != "https" or not parsed.hostname
                or not (parsed.hostname == "bilibili.com" or parsed.hostname.endswith(".bilibili.com"))):
            raise ReadError("LOGIN_QR", "平台未返回有效二维码，请稍后重试。")
        self.key = data["qrcode_key"]
        output = io.BytesIO()
        qrcode.make(data["url"]).save(output, format="PNG")
        return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")

    async def poll(self):
        data = await self.request("poll", params={"qrcode_key": self.key})
        code = data.get("code")
        if code in (86101, 86090, 86038):
            return {86101: "waiting_scan", 86090: "confirming", 86038: "qr_expired"}[code], None
        if code != 0:
            raise ReadError("LOGIN_STATE", "平台返回了未识别的扫码状态，请稍后检查或重新生成二维码。")
        fields = {"sessdata": "", "bili_jct": "", "buvid3": "", "dedeuserid": ""}
        # Read Set-Cookie first. No cookies or callback URLs are logged or sent to the model.
        for cookie in self.client.cookies.jar:
            domain = cookie.domain.lstrip(".").lower()
            if (domain == "bilibili.com" or domain.endswith(".bilibili.com")) and cookie.name.lower() in fields:
                fields[cookie.name.lower()] = cookie.value
        parsed = urlsplit(data.get("url", ""))
        if parsed.scheme == "https" and parsed.hostname and any(
                parsed.hostname == host or parsed.hostname.endswith("." + host)
                for host in ("bilibili.com", "biligame.com")):
            for key, value in parse_qsl(parsed.query):
                if key.lower() in fields and not fields[key.lower()]:
                    fields[key.lower()] = value
        return "done", Credential(**fields)


async def account():
    cred = credential()
    if not cred.sessdata:
        return {"status": "logged_out"}
    try:
        info = await user.get_self_info(credential=cred)
    except Exception as error:
        if getattr(error, "code", None) == -101:
            return {"status": "expired", "message": "登录已失效，请重新扫码。"}
        return {"status": "unverified", "message": "登录凭据已保存，暂时无法验证账号，请稍后点“检查登录”。"}
    return {"status": "logged_in", "uid": str(info.get("mid", "")), "name": info.get("name", "")}


async def dispatch(method, params):
    try:
        version = tuple(int(v) for v in importlib.metadata.version('brotli').split('.')[:3])
        if version < (1, 2, 1):
            raise ValueError('vulnerable decoder')
    except (importlib.metadata.PackageNotFoundError, ValueError):
        raise ReadError('DEPENDENCY_SECURITY', 'Brotli需要1.2.1或以上安全版本，请在高级设置准备Python依赖后重试。') from None
    global login
    if method == "ping":
        return {"protocol": 1, "bilibiliApi": importlib.metadata.version("bilibili-api-python")}
    if method == "account":
        return await account()
    if method == "user_info":
        uid = params.get("uid", "")
        if not isinstance(uid, str) or not re.fullmatch(r"[1-9]\d{0,19}", uid):
            raise ReadError("INVALID_UID", "请填写有效的B站UID。")
        try:
            info = await user.User(int(uid), credential=credential()).get_user_info()
        except Exception as error:
            if getattr(error, "code", None) in (-404, 62002):
                raise ReadError("USER_NOT_FOUND", "未找到这个B站账号，请核对UID。") from None
            raise ReadError("USER_LOOKUP_FAILED", "账号资料查询未完成，请检查登录和网络后重试。") from None
        if str(info.get("mid", "")) != uid or not isinstance(info.get("name"), str) or not info["name"].strip():
            raise ReadError("USER_PROFILE", "平台未返回对应账号的有效昵称，请检查UID后重试。")
        return {"uid": uid, "name": info["name"], "face": str(info.get("face", ""))}
    if method == "logout":
        if login is not None:
            await login.close()
        login = None
        CREDENTIAL.unlink(missing_ok=True)
        return {"status": "logged_out"}
    if method == "login_start":
        if login is not None:
            await login.close()
        login = None
        pending = WebQrLogin()
        try:
            image = await pending.generate()
        except BaseException:
            await pending.close()
            raise
        login = pending
        return {"status": "qrcode_ready", "image": image}
    if method == "login_poll":
        if login is None:
            current = await account()
            return {"status": "no_session"} if current["status"] == "logged_out" else current
        state, cred = await login.poll()
        if state == "done":
            try:
                save_credential(cred)
            except ReadError as error:
                return {"status": "login_failed", "message": str(error)}
            finally:
                await login.close()
                login = None
            return await account()
        if state == "qr_expired":
            await login.close()
            login = None
        return {"status": state}
    if method == "recommend_videos":
        import discovery
        try:
            return await discovery.recommend(credential())
        except discovery.DiscoveryError as error:
            raise ReadError(error.code, str(error)) from None
    if method == "search_videos":
        keyword, page = params.get("keyword"), params.get("page", 1)
        if not isinstance(keyword, str) or not 1 <= len(keyword.strip()) <= 100 or any(c in keyword for c in "\r\n\0"):
            raise ReadError("SEARCH_INPUT", "关键词需要1～100个字符。")
        if type(page) is not int or not 1 <= page <= 20:
            raise ReadError("SEARCH_INPUT", "搜索页码超出范围。")
        if params.get('tag_filter') is not None:
            import tag_search
            try:
                tag_search.valid_filter(params['tag_filter'])
            except tag_search.TagError as error:
                raise ReadError(error.code, str(error)) from None
        if not credential().sessdata:
            raise ReadError("NOT_LOGGED_IN", "请先检查登录。")
        found = await search.search_by_type(keyword=keyword.strip(), search_type=search.SearchObjectType.VIDEO,
                                            page=page, page_size=20)
        videos, seen = [], set()
        for row in (found.get("result") or [])[:40]:
            bvid = row.get("bvid", "")
            if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid) or bvid in seen:
                continue
            seen.add(bvid)
            videos.append({"bvid": bvid, "title": unescape(re.sub(r"<[^>]*>", "", str(row.get("title", ""))))[:300]})
            if len(videos) >= 20:
                break
        if params.get('tag_filter') is not None:
            import tag_search
            try:
                return {**await tag_search.filter_videos(videos, params['tag_filter'], credential()), 'page': page, 'query': keyword.strip()}
            except tag_search.TagError as error:
                raise ReadError(error.code, str(error)) from None
        return {"videos": videos, "page": page}
    if method == "audio_check":
        return audio_module().check_environment(params.get("model_path", ""))
    if method == "audio_cleanup":
        return audio_module().cleanup_temporary(DATA)
    if method == "vision_check":
        return vision_module().check_environment()
    if method == "vision_cleanup":
        return vision_module().cleanup_temporary(DATA)
    if method == "sample_frames":
        bvid = params.get("bvid", "")
        if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
            raise ReadError("VISION_INPUT", "画面视频标识无效。")
        cred = credential()
        if not cred.sessdata:
            raise ReadError("NOT_LOGGED_IN", "请先检查登录。")
        obj = video.Video(bvid=bvid, credential=cred)
        module = vision_module()
        try:
            return await module.run(obj, params, DATA, str(cred.dedeuserid or ""))
        except module.VisionError as error:
            raise ReadError(error.code, str(error)) from None
    if method == "read_cover":
        bvid = params.get("bvid", "")
        if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
            raise ReadError("INVALID_BVID", "视频标识无效。")
        cred = credential()
        if not cred.sessdata:
            raise ReadError("NOT_LOGGED_IN", "请先检查登录。")
        info = await video.Video(bvid=bvid, credential=cred).get_info()
        return {"bvid": bvid, "cover": str(info.get("pic", ""))}
    if method == "transcribe_video":
        bvid = params.get("bvid", "")
        if not isinstance(bvid, str) or not re.fullmatch(r"BV[0-9A-Za-z]{10}", bvid):
            raise ReadError("AUDIO_INPUT", "音频视频标识无效。")
        cred = credential()
        if not cred.sessdata:
            raise ReadError("NOT_LOGGED_IN", "请先检查登录。")
        obj = video.Video(bvid=bvid, credential=cred)
        module = audio_module()
        try:
            return await module.run(obj, params, DATA, str(cred.dedeuserid or ""))
        except module.AudioError as error:
            raise ReadError(error.code, str(error)) from None
    if method in ("weekly_image", "weekly_card", "weekly_probe", "weekly_publish", "weekly_verify"):
        import weekly
        try:
            return await weekly.dispatch(method, params, credential(), DATA)
        except weekly.PublishError as error:
            raise ReadError(error.code, str(error)) from None
    if method in ("comment_probe", "comment_publish", "comment_verify", "comment_feedback", "interaction_scan", "owner_mentions", "mentioned_video_context", "comment_reply_probe", "comment_reply_publish", "comment_reply_verify"):
        module = publishing_module()
        try:
            return await module.dispatch(method, params, credential())
        except module.PublishError as error:
            raise ReadError(error.code, str(error)) from None
    if method in ("relationship_probe", "follow_user", "dm_proactive_probe", "dm_proactive_send"):
        import relationships
        try:
            return await relationships.dispatch(method, params, credential())
        except relationships.RelationshipError as error:
            raise ReadError(error.code, str(error)) from None
    if method in ("contacts_page", "dm_inbox", "dm_thread", "dm_reply"):
        if not credential().sessdata:
            raise ReadError("NOT_LOGGED_IN", "请先在高级设置检查登录。")
        module = private_module()
        try:
            return await module.dispatch(method, params, credential())
        except module.PrivateError as error:
            raise ReadError(error.code, str(error)) from None
    if method != "read_video":
        raise ReadError("READ_ONLY", "该适配器仅支持读取。")
    bvid = params["bvid"]
    cred = credential()
    if not cred.sessdata:
        raise ReadError("NOT_LOGGED_IN", "请先在设置面板扫码登录 B站。")
    obj = video.Video(bvid=bvid, credential=cred)
    info = await obj.get_info()
    pages = info.get("pages") or []
    cid = info.get("cid") or (pages[0]["cid"] if pages else 0)
    result = {
        "bvid": bvid, "title": info.get("title", ""), "cid": cid,
        "cover": str(info.get("pic", "")),
        "owner": info.get("owner", {}).get("name", ""), "url": "https://www.bilibili.com/video/" + bvid,
        "ownerUid": str(info.get("owner", {}).get("mid", "")),
        "duration": (pages[0].get("duration") if pages else None) or info.get("duration", 0), "accountUid": str(cred.dedeuserid or ""),
        "readAt": datetime.now(timezone.utc).isoformat(),
        "source": "subtitle", "coverage": "none", "segments": [], "text": "",
    }
    budget = max(1000, min(int(params.get("max_chars", 18000)), 30000))
    community = await community_module().read_sound_video(obj, info, result, cred, budget)
    if community is not None:
        return community
    if not cid:
        return {**result, "skipReason": "视频没有可读取的分 P。"}
    subtitle_info = await obj.get_subtitle(cid=cid)
    subtitles = subtitle_info.get("subtitles") or []
    if not subtitles:
        return {**result, "skipReason": "无可用字幕；未启用音频转写时跳过。"}
    selected = next((s for s in subtitles if s.get("lan") in ("ai-zh", "zh-CN", "zh")), subtitles[0])
    url = selected.get("subtitle_url", "")
    if url.startswith("//"):
        url = "https:" + url
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443) or not parsed.hostname or not any(
        parsed.hostname == h or parsed.hostname.endswith("." + h) for h in ("hdslb.com", "bilibili.com")
    ):
        raise ReadError("SUBTITLE_URL", "平台返回了不支持的字幕地址。")
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > 4_000_000:
                    raise ReadError("SUBTITLE_TOO_LARGE", "字幕超过读取预算。")
            body = json.loads(payload).get("body") or []
    segments, used = [], 0
    rows = [row for row in body if str(row.get("content", "")).strip()]
    for row in rows:
        text = str(row.get("content", "")).strip()
        if not text:
            continue
        if used + len(text) + 1 > budget:
            break
        segments.append({"from": row.get("from", 0), "to": row.get("to", 0), "text": text})
        used += len(text) + 1
    return {
        **result, "language": selected.get("lan_doc", selected.get("lan", "")),
        "totalSegments": len(rows), "segments": segments,
        "coverage": "complete" if len(segments) == len(rows) else "partial",
        "text": "\n".join(s["text"] for s in segments),
        **({"skipReason": "字幕没有可用于理解的文本。"} if not segments else {}),
    }


async def main():
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            return
        request = {}
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                timeout = request.get("params", {}).get("timeout_seconds", 300) if request["method"] == "transcribe_video" else (110 if request["method"] == "weekly_publish" or (request["method"] == "search_videos" and request.get('params', {}).get('tag_filter')) else 55)
                if type(timeout) is not int or not 30 <= timeout <= 1800:
                    raise ReadError("AUDIO_INPUT", "音频超时参数无效。")
                # The parent owns the hard process deadline for local inference.
                # Cancelling to_thread would leave inference running after failure.
                if request["method"] == "transcribe_video":
                    result = await dispatch(request["method"], request.get("params", {}))
                else:
                    result = await asyncio.wait_for(dispatch(request["method"], request.get("params", {})), timeout=timeout)
            response = {"id": request["id"], "result": result}
        except ReadError as error:
            response = {"id": request.get("id"), "error": {"code": error.code, "message": str(error)}}
        except Exception as error:
            response = {"id": request.get("id"), "error": {
                "code": str(getattr(error, "code", "BILI_READ")),
                "message": "B站读取未完成（" + type(error).__name__ + "）；请检查登录状态或稍后重试。",
            }}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
