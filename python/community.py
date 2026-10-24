"""Bounded comment samples for sound videos. No audio or publishing methods."""
import asyncio
import re
import unicodedata

from bilibili_api import comment

LIMIT = 20
PER_COMMENT = 500
TEXT_LIMIT = 6000
SOUND_TERMS = ("asmr", "助眠", "耳搔", "掏耳", "采耳", "触发音", "口腔音", "无人声", "音声")


def classify(text, source):
    text = unicodedata.normalize("NFKC", text).casefold()
    for term in SOUND_TERMS:
        if (re.search(r"(?<![a-z])asmr(?![a-z])", text) if term == "asmr" else term in text):
            return {"kind": "asmr", "matchedBy": source, "term": term}
    return None


def units(text):
    return len(text.encode("utf-16-le")) // 2


def rows(page):
    """Only top-level comments, including pinned rows; never crawl replies."""
    if not isinstance(page, dict):
        return []
    result = []
    top = page.get("upper", {}).get("top") if isinstance(page.get("upper"), dict) else None
    if isinstance(top, dict):
        result.append(top)
    for key in ("top_replies", "hots", "replies"):
        value = page.get(key)
        if isinstance(value, list):
            result.extend(value[:30])
    return result[:90]


def select_samples(pages, bvid, budget):
    # Interleave both orders so a full hot page cannot starve recent comments.
    streams = [(order, rows(page)) for order, page in pages.items()]
    selected, ids, texts, used = [], set(), set(), 0
    for index in range(max((len(items) for _, items in streams), default=0)):
        for order, items in streams:
            if index >= len(items):
                continue
            row = items[index]
            if not isinstance(row, dict):
                continue
            rpid = str(row.get("rpid_str") or row.get("rpid") or "")
            content = row.get("content")
            raw = content.get("message") if isinstance(content, dict) else None
            if not re.fullmatch(r"[1-9][0-9]{0,29}", rpid) or not isinstance(raw, str):
                continue
            text = "".join(c for c in raw if unicodedata.category(c) != "Cc" or c in "\n\t").strip()
            text = text.encode("utf-16-le")[:PER_COMMENT * 2].decode("utf-16-le", errors="ignore")
            meaningful = re.sub(r"\[[^\]\n]{0,40}\]", "", text)
            normalized = re.sub(r"\s", "", unicodedata.normalize("NFKC", text))
            if (sum(c.isalnum() for c in meaningful) < 6 or not any(c.isalpha() for c in meaningful)
                    or rpid in ids or normalized in texts or used + units(text) + 1 > budget):
                continue
            likes = row.get("like", 0)
            selected.append({"id": rpid, "text": text,
                             "likes": min(likes, 2**31 - 1) if type(likes) is int and likes >= 0 else 0,
                             "order": order, "url": f"https://www.bilibili.com/video/{bvid}/#reply{rpid}",
                             "truncated": units(raw.strip()) > PER_COMMENT})
            ids.add(rpid)
            texts.add(normalized)
            used += units(text) + 1
            if len(selected) >= LIMIT:
                return selected
    return selected


async def read_sound_video(obj, info, base, cred, budget):
    classification = classify(str(info.get("title", ""))[:1000], "title")
    if classification is None and base.get("cid"):
        try:
            tags = await asyncio.wait_for(obj.get_tags(cid=base["cid"]), timeout=8)
            for tag in tags[:30] if isinstance(tags, list) else []:
                if isinstance(tag, dict):
                    classification = classify(str(tag.get("tag_name", ""))[:100], "tag")
                    if classification:
                        break
        except Exception:
            pass  # A missing tag service must not break the ordinary subtitle path.
    if classification is None:
        return None

    budget = min(budget, TEXT_LIMIT)
    result = {**base, "source": "comments", "coverage": "none", "segments": [], "text": "",
              "classification": classification,
              "commentSample": {"count": 0, "limit": LIMIT, "maxChars": budget,
                                "orders": [], "failedOrders": [], "scope": "whole_video"}, "comments": []}
    aid = info.get("aid")
    if type(aid) is not int or aid <= 0:
        return {**result, "skipReason": "已识别声音类视频，但缺少可核对的评论区标识，本次跳过。"}

    orders = {"hot": comment.OrderType.LIKE, "recent": comment.OrderType.TIME}
    async def fetch(order):
        return await asyncio.wait_for(comment.get_comments(
            oid=aid, type_=comment.CommentResourceType.VIDEO, page_index=1,
            order=order, credential=cred), timeout=12)
    responses = await asyncio.gather(*(fetch(order) for order in orders.values()), return_exceptions=True)
    pages, failed = {}, []
    for order, response in zip(orders, responses):
        if isinstance(response, BaseException) or not isinstance(response, dict):
            failed.append(order)
        else:
            pages[order] = response
    samples = select_samples(pages, base["bvid"], budget)
    result.update({"comments": samples, "text": "\n".join(row["text"] for row in samples),
                   "coverage": "sampled" if samples else "none",
                   "commentSample": {**result["commentSample"], "count": len(samples),
                                     "orders": list(pages), "failedOrders": failed}})
    if len(samples) < 2:
        result["skipReason"] = ("ASMR评论区暂不可读，本次跳过；没有读取或转写音频。" if not pages else
                                "ASMR评论区不足2条有效且不重复的文字评论，本次跳过；未据此推断声音内容。")
    return result
