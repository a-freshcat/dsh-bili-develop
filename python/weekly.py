"""Local image preparation and explicitly approved dynamic publication. No scheduling."""
import base64
import hashlib
import io
import os
from pathlib import Path
import re
import warnings
from urllib.parse import urlsplit
import httpx
from PIL import Image, ImageOps
from bilibili_api import Picture, dynamic, user
from bilibili_api.utils.network import HEADERS, request_settings
from publishing import PublishError


def failure_label(error):
    name = type(error).__name__
    name = name if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,59}', name) else 'Error'
    code = getattr(error, 'code', None)
    if code is None and isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
    return name + ('，代码' + str(code) if type(code) is int and abs(code) <= 2147483648 else '')


class ImageUploadError(Exception):
    """Raised only while the SDK is uploading images, before it creates a dynamic."""

class UploadResponseError(Exception):
    def __init__(self, code):
        self.code = code


class ApprovedPicture(Picture):
    """Use HTTPX's binary multipart contract, avoiding SDK file conversion and CDN rereads."""
    async def upload(self, credential):
        try:
            # The pinned SDK's HTTPX adapter passes BiliAPIFile straight to HTTPX.
            # Correct multipart input here keeps the signed dynamic creation in the SDK.
            async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10), follow_redirects=False, headers=HEADERS,
                                         cookies=credential.get_cookies()) as client:
                response = await client.post('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs',
                                             data={'biz': 'new_dyn', 'category': 'daily', 'csrf': credential.bili_jct},
                                             files={'file_up': ('approved.jpg', self.content, 'image/jpeg')})
                response.raise_for_status()
                if response.status_code != 200 or len(response.content) > 65536:
                    raise ValueError('Invalid upload response')
                payload = response.json()
                if not isinstance(payload, dict) or type(payload.get('code')) is not int:
                    raise ValueError('Invalid upload response')
                if payload['code'] != 0:
                    raise UploadResponseError(payload['code'])
                value = payload.get('data')
            # Keep the reviewed bytes and dimensions; never fetch the returned URL.
            if not isinstance(value, dict):
                raise ValueError('Invalid upload response')
            url = value.get('image_url')
            parsed = urlsplit(url) if isinstance(url, str) else None
            if not parsed or parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or parsed.port or parsed.fragment or not (
                parsed.hostname == 'hdslb.com' or parsed.hostname.endswith('.hdslb.com')
            ) or not parsed.path.startswith('/bfs/') or len(url) > 1000:
                raise ValueError('Invalid uploaded image address')
            if type(value.get('image_width')) is not int or type(value.get('image_height')) is not int or (
                value['image_width'], value['image_height']
            ) != (self.width, self.height):
                raise ValueError('Uploaded image dimensions changed')
            self.url = url
            return self
        except Exception as error:
            raise ImageUploadError(failure_label(error)) from None


def managed_images(root):
    path = Path(root).resolve(strict=True)
    for part in ('.bilibili-harness', 'weekly', 'images'):
        path = path / part
        if path.exists() and (path.is_symlink() or getattr(path, 'is_junction', lambda: False)()):
            raise PublishError('WEEKLY_IMAGE', '配图目录不能是链接。')
        path.mkdir(exist_ok=True)
    return path


def prepare_image(params, data):
    encoded = params.get('base64')
    if not isinstance(encoded, str) or not 1 <= len(encoded) <= 6 * 1024 * 1024:
        raise PublishError('WEEKLY_IMAGE', '请选择4MB以内的PNG或JPEG图片。')
    try:
        content = base64.b64decode(encoded, validate=True)
        if len(content) > 4 * 1024 * 1024:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as opened:
                if opened.format not in ('PNG', 'JPEG') or opened.width * opened.height > 20000000 or getattr(opened, 'n_frames', 1) != 1:
                    raise ValueError()
                image = ImageOps.exif_transpose(opened).convert('RGBA')
                background = Image.new('RGB', image.size, 'white'); background.paste(image, mask=image.getchannel('A'))
                background.thumbnail((1600, 1600))
                result = io.BytesIO(); background.save(result, format='JPEG', quality=90)
                raw = result.getvalue()
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError()
                thumb = background.copy(); thumb.thumbnail((360, 360))
                small = io.BytesIO(); thumb.save(small, format='JPEG', quality=75)
                width, height = background.size
    except Exception:
        raise PublishError('WEEKLY_IMAGE', '图片无法安全读取；请使用单张、4MB以内的PNG/JPEG。') from None
    digest = hashlib.sha256(raw).hexdigest()
    directory = managed_images(data)
    file = directory / (digest + '.jpg')
    if file.exists() and (file.is_symlink() or not file.is_file()):
        raise PublishError('WEEKLY_IMAGE', '配图存储路径无效。')
    temporary = directory / (digest + '.' + str(os.getpid()) + '.tmp')
    temporary.write_bytes(raw); temporary.replace(file)
    return {'hash': digest, 'mime': 'image/jpeg', 'size': len(raw), 'width': width, 'height': height,
            'thumbnail': 'data:image/jpeg;base64,' + base64.b64encode(small.getvalue()).decode('ascii')}


async def preflight(params, cred):
    cred.raise_for_no_sessdata()
    account = str((await user.get_self_info(cred)).get('mid', ''))
    if account != params.get('expected_account') or not re.fullmatch(r'[1-9]\d{0,19}', account):
        raise PublishError('WEEKLY_PREFLIGHT', '登录账号与审核账号不一致，未发布。')
    mentions = params.get('mentions', [])
    if not isinstance(mentions, list) or len(mentions) > 3:
        raise PublishError('WEEKLY_PREFLIGHT', '动态提及对象无效。')
    # Reuse the established UID/nickname/following checks, without fetching a video.
    seen = set()
    from bilibili_api.utils.network import Api
    for item in mentions:
        if not isinstance(item, dict) or not isinstance(item.get('uid'), str) or not re.fullmatch(r'[1-9]\d{0,19}', item['uid']) or item['uid'] in seen:
            raise PublishError('WEEKLY_PREFLIGHT', '动态提及UID无效。')
        name = item.get('name')
        if not isinstance(name, str) or not 1 <= len(name) <= 80 or re.search(r'[\s@＠\0]', name):
            raise PublishError('WEEKLY_PREFLIGHT', '动态提及昵称无效。')
        profile = await user.User(int(item['uid']), credential=cred).get_user_info()
        relation = await Api(url='https://api.bilibili.com/x/relation', method='GET', verify=True, credential=cred).update_params(fid=int(item['uid'])).result
        if str(profile.get('mid')) != item['uid'] or profile.get('name') != name or str(relation.get('mid')) != item['uid'] or relation.get('attribute') not in (2, 6):
            raise PublishError('WEEKLY_PREFLIGHT', '请先关注动态提及对象，并重新确认昵称；未发布。')
        seen.add(item['uid'])
    return {'accountUid': account, 'mentions': mentions}


async def verify_publication(params, cred):
    body, mentions, at, count = (params.get(k) for k in ('body', 'mentions', 'attempt_at', 'image_count'))
    if not isinstance(body, str) or not body.strip() or len(body) > 1800 or not isinstance(mentions, list) or len(mentions) > 3 or (
        type(at) is not int or not 0 < at < 8640000000000000 or type(count) is not int or not 1 <= count <= 3
    ):
        raise PublishError('WEEKLY_VERIFY', '核对材料或发送时间无效。')
    builder = dynamic.BuildDynamic.empty().add_plain_text(body)
    for item in mentions:
        if not isinstance(item, dict) or not isinstance(item.get('uid'), str) or not re.fullmatch(r'[1-9]\d{0,19}', item['uid']) or (
            not isinstance(item.get('name'), str) or not 1 <= len(item['name']) <= 80 or re.search(r'[\s@＠\0]', item['name'])
        ):
            raise PublishError('WEEKLY_VERIFY', '核对提及对象无效。')
        builder.add_plain_text('\n').add_at(uid=int(item['uid']), uname=item['name'])
    cred.raise_for_no_sessdata()
    account = str((await user.get_self_info(cred)).get('mid', ''))
    if account != params.get('expected_account') or not re.fullmatch(r'[1-9]\d{0,19}', account):
        raise PublishError('WEEKLY_VERIFY', '请用原发送账号核对动态。')
    result = {'accountUid': account, 'source': 'own_space', 'confirmed': False, 'receipt': '', 'sampleCount': 0, 'matchCount': 0}
    try:
        expected = ''.join(c['raw_text'] for c in await builder.get_contents(cred)).replace('\r\n', '\n').rstrip()
        found = await user.User(int(account), credential=cred).get_dynamics_new()
        items = found.get('items') or []
        if not isinstance(items, list) or len(items) > 100:
            raise ValueError('Invalid dynamic page')
        matches = []
        for item in items[:20]:
            modules = item.get('modules') or {}; author = modules.get('module_author') or {}; material = modules.get('module_dynamic') or {}
            major = material.get('major') or {}; opus = major.get('opus') or {}
            text = (material.get('desc') or {}).get('text') or (opus.get('summary') or {}).get('text') or ''
            pictures = (major.get('draw') or {}).get('items') or opus.get('pics') or []
            stamp, identity = author.get('pub_ts'), item.get('id_str')
            if (str(author.get('mid')) == account and type(stamp) is int and at - 120000 <= stamp * 1000 <= at + 600000 and
                isinstance(text, str) and text.replace('\r\n', '\n').rstrip() == expected and isinstance(pictures, list) and len(pictures) == count and
                isinstance(identity, str) and re.fullmatch(r'[1-9]\d{0,29}', identity)):
                matches.append(identity)
        unique = len(matches) == 1
        return {**result, 'status': 'found' if unique else 'ambiguous' if len(matches) > 1 else 'not_in_sample',
                'confirmed': unique, 'receipt': matches[0] if unique else '', 'sampleCount': len(items[:20]), 'matchCount': len(matches)}
    except Exception as error:
        return {**result, 'status': 'unavailable', 'failure': failure_label(error)}


async def dispatch(method, params, cred, data):
    if method == 'weekly_card':
        from weekly_card import draw_card
        try:
            raw = draw_card(params)
            return prepare_image({'base64': base64.b64encode(raw).decode('ascii')}, data)
        except PublishError:
            raise
        except Exception:
            raise PublishError('WEEKLY_CARD', '本地周报配图未生成，请检查中文字体后重试，或手动选择图片。') from None
    if method == 'weekly_image':
        return prepare_image(params, data)
    if method == 'weekly_verify':
        return await verify_publication(params, cred)
    found = await preflight(params, cred)
    if method == 'weekly_probe':
        return found
    if method != 'weekly_publish' or params.get('approved') is not True:
        raise PublishError('WEEKLY_PREFLIGHT', '动态未获本次明确审核，未发布。')
    body, images = params.get('body'), params.get('images')
    if not isinstance(body, str) or not body.strip() or len(body) > 1800 or re.search(r'[@＠\0]', body) or not isinstance(images, list) or not 1 <= len(images) <= 3:
        raise PublishError('WEEKLY_PREFLIGHT', '审核文案或配图无效。')
    from privacy_guard import assert_outgoing
    try:
        assert_outgoing(body, cred)
    except ValueError:
        raise PublishError('PRIVACY_BLOCKED', '动态草稿疑似夹带账号凭据，已阻止；未上传或发布。') from None
    directory = managed_images(params.get('workspace', ''))
    pictures = []
    for image in images:
        digest = image.get('hash') if isinstance(image, dict) else None
        if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise PublishError('WEEKLY_IMAGE', '配图标识无效。')
        file = directory / (digest + '.jpg')
        if not file.is_file() or file.is_symlink() or file.stat().st_size > 2 * 1024 * 1024:
            raise PublishError('WEEKLY_IMAGE', '配图已变化，未发布。')
        raw = file.read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest or len(raw) != image.get('size'):
            raise PublishError('WEEKLY_IMAGE', '配图内容与审核不符，未发布。')
        try:
            with Image.open(io.BytesIO(raw)) as opened:
                if opened.format != 'JPEG' or max(opened.size) > 1600:
                    raise ValueError()
                width, height = opened.size
                opened.verify()
        except Exception:
            raise PublishError('WEEKLY_IMAGE', '审核配图无法安全读取，未发布。') from None
        # Snapshot all bytes before the first upload. Use the SDK's public data class,
        # avoiding from_content's fixed temporary file and unclosed metadata reader.
        pictures.append(ApprovedPicture(content=raw, imageType='jpg', width=width, height=height, size=round(len(raw) / 1024)))
    builder = dynamic.BuildDynamic.empty().add_plain_text(body)
    for mention in found['mentions']:
        builder.add_plain_text('\n').add_at(uid=int(mention['uid']), uname=mention['name'])
    builder.add_image(pictures)
    cred.raise_for_no_bili_jct()
    previous = request_settings.get_wbi_retry_times(); request_settings.set_wbi_retry_times(1)
    try:
        result = await dynamic.send_dynamic(builder, cred)
    except ImageUploadError as error:
        raise PublishError('WEEKLY_UPLOAD_FAILED', '配图上传阶段未完成（' + str(error) + '）；动态未提交，本次尝试保留，不重发。') from None
    except Exception as error:
        if type(getattr(error, 'code', None)) is int:
            raise PublishError('WEEKLY_REJECTED', '平台拒绝动态（代码' + str(error.code) + '）；本次尝试保留，不重发。') from None
        raise PublishError('WEEKLY_UNKNOWN', '动态提交结果未确认（' + failure_label(error) + '）；请到B站核对，不重发。') from None
    finally:
        request_settings.set_wbi_retry_times(previous)
    result = result if isinstance(result, dict) else {}
    receipt = str(result.get('dyn_id_str') or result.get('dyn_id') or '')
    return {**found, 'receipt': receipt if re.fullmatch(r'[1-9]\d{0,29}', receipt) else '', 'accepted': bool(re.fullmatch(r'[1-9]\d{0,29}', receipt))}
