"""One bounded homepage recommendation batch, enriched with actual public metadata."""
import asyncio
import re
from html import unescape
from datetime import datetime, timezone
from bilibili_api import homepage, user, video


class DiscoveryError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def text(value, limit):
    return unescape(re.sub(r'<[^>]*>', '', str(value or ''))).replace('\0', '').strip()[:limit]


async def recommend(credential):
    if not credential.sessdata:
        raise DiscoveryError('NOT_LOGGED_IN', '请先检查登录，再读取推荐候选。')
    identity = await user.get_self_info(credential=credential)
    uid = str(identity.get('mid', ''))
    if not re.fullmatch(r'[1-9]\d{0,19}', uid):
        raise DiscoveryError('DISCOVERY_ACCOUNT', '无法核实推荐账号，本轮停止。')
    found = await homepage.get_videos(credential=credential)
    if not isinstance(found, dict) or not isinstance(found.get('item'), list):
        raise DiscoveryError('DISCOVERY_RESULT', '平台推荐格式变化，本轮不按猜测继续。')
    candidates, seen = [], set()
    for row in found['item'][:40]:
        if not isinstance(row, dict) or row.get('goto', 'av') != 'av' or row.get('is_ad') or row.get('ad_info'):
            continue
        bvid = row.get('bvid', '')
        if not isinstance(bvid, str) or not re.fullmatch(r'BV[0-9A-Za-z]{10}', bvid) or bvid in seen:
            continue
        seen.add(bvid)
        candidates.append(bvid)
        if len(candidates) == 12:
            break
    gate = asyncio.Semaphore(3)
    fatal = False

    async def enrich(bvid):
        nonlocal fatal
        async with gate:
            if fatal:
                return None
            try:
                async def read():
                    v = video.Video(bvid=bvid, credential=credential)
                    info = await v.get_info()
                    if type(info.get('cid')) is not int or info['cid'] <= 0:
                        raise ValueError()
                    tags = await v.get_tags(cid=info['cid'])
                    return info, tags
                info, tags = await asyncio.wait_for(read(), 9)
                owner = info.get('owner') or {}
                if info.get('bvid') != bvid or not isinstance(tags, list) or len(tags) > 50 or not isinstance(info.get('title'), str) or not text(info.get('title'), 200):
                    return None
                duration = info.get('duration')
                if type(duration) not in (int, float) or not 0 <= duration <= 10000000 or not re.fullmatch(r'[1-9]\d{0,19}', str(owner.get('mid', ''))):
                    return None
                actual_tags = []
                for tag in tags:
                    if not isinstance(tag, dict) or not re.fullmatch(r'[1-9]\d{0,19}', str(tag.get('tag_id', ''))) or not isinstance(tag.get('tag_name'), str) or not 1 <= len(tag['tag_name'].strip()) <= 80 or re.search(r'[\r\n\0]', tag['tag_name']):
                        return None
                    actual_tags.append({'id': str(tag['tag_id']), 'name': tag['tag_name'].strip()})
                return {'bvid': bvid, 'title': text(info['title'], 200), 'description': text(info.get('desc'), 600),
                        'owner': {'uid': str(owner['mid']), 'name': text(owner.get('name'), 80)},
                        'duration': duration, 'tags': actual_tags}
            except Exception as error:
                if getattr(error, 'code', None) in (-101, -111, -352, -412, -403, 412, 403):
                    fatal = True
                    raise DiscoveryError('DISCOVERY_UNAVAILABLE', '推荐资料遇到登录或平台限制，本轮停止，不切换搜索或重试。') from None
                return None

    results = await asyncio.gather(*(enrich(bvid) for bvid in candidates), return_exceptions=True)
    for result in results:
        if isinstance(result, DiscoveryError):
            raise result
    videos = [row for row in results if isinstance(row, dict)]
    return {'source': 'recommendation', 'accountUid': uid, 'videos': videos,
            'unverified': len(candidates) - len(videos), 'checkedAt': datetime.now(timezone.utc).isoformat()}
