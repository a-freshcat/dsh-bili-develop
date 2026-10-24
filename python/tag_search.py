"""Filter platform search candidates using real video tags, never their titles."""
import asyncio
import re
import unicodedata
from bilibili_api import video


class TagError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def normal(value):
    return unicodedata.normalize('NFKC', value).strip().lower()


def valid_filter(value):
    if not isinstance(value, dict) or value.get('match') not in ('any', 'all'):
        raise TagError('TAG_INPUT', 'TAG匹配方式无效。')
    tags = value.get('tags')
    if not isinstance(tags, list) or not 1 <= len(tags) <= 10 or any(not isinstance(t, str) or not t.strip() or len(t) > 80 or re.search(r'[\r\n\0]', t) for t in tags):
        raise TagError('TAG_INPUT', 'TAG需要1～10个实际标签名，每个最多80字。')
    return list(dict.fromkeys(normal(t) for t in tags)), value['match']


async def filter_videos(candidates, value, cred):
    required, match = valid_filter(value)
    uid = str(cred.dedeuserid or '')
    if not re.fullmatch(r'[1-9]\d{0,19}', uid):
        raise TagError('NOT_LOGGED_IN', '请先检查登录，再按TAG检索。')
    semaphore = asyncio.Semaphore(3)
    fatal = None
    checked, verified = 0, 0

    async def one(row):
        nonlocal checked, verified, fatal
        async with semaphore:
            if fatal:
                return None
            checked += 1
            try:
                obj = video.Video(bvid=row['bvid'], credential=cred)
                async def fetch():
                    info = await obj.get_info()
                    if info.get('bvid') != row['bvid'] or type(info.get('cid')) is not int or info['cid'] <= 0:
                        raise ValueError()
                    return await obj.get_tags(cid=info['cid'])
                found = await asyncio.wait_for(fetch(), timeout=10)
                if not isinstance(found, list) or len(found) > 50:
                    raise ValueError()
                tags, seen = [], set()
                for tag in found:
                    if not isinstance(tag, dict):
                        raise ValueError()
                    tag_id, name = str(tag.get('tag_id', '')), tag.get('tag_name')
                    if not re.fullmatch(r'[1-9]\d{0,19}', tag_id) or not isinstance(name, str) or not name.strip() or len(name) > 80 or re.search(r'[\r\n\0]', name):
                        raise ValueError()
                    if tag_id not in seen:
                        tags.append({'id': tag_id, 'name': name}); seen.add(tag_id)
                verified += 1
                names = {normal(t['name']) for t in tags}
                accepted = all(t in names for t in required) if match == 'all' else any(t in names for t in required)
                return {**row, 'tags': tags} if accepted else None
            except Exception as error:
                if getattr(error, 'code', None) in (-101, -352, -412, -799):
                    fatal = TagError('TAG_UNAVAILABLE', '平台暂不允许读取标签；本轮停止，不按标题放行。请检查登录或稍后再试。')
                return None

    tasks = [asyncio.create_task(one(row)) for row in candidates[:20]]
    try:
        found = await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    if fatal:
        raise fatal
    videos = [row for row in found if row is not None]
    return {'videos': videos, 'accountUid': uid, 'source': 'tag', 'tagStats': {
        'checked': checked, 'verified': verified, 'matched': len(videos), 'mismatched': verified - len(videos), 'unverified': checked - verified}}
