"""Sound-video routing and comment samples; no account or network calls."""
import asyncio
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("community_test_subject", ROOT / "python" / "community.py")
community = importlib.util.module_from_spec(spec)
spec.loader.exec_module(community)
BV = "BV1xx411c7mD"


def row(rpid, text, **extra):
    return {"rpid": rpid, "content": {"message": text}, "like": 3, **extra}


def base():
    return {"bvid": BV, "cid": 123, "accountUid": "fixture-account", "title": "ASMR 测试",
            "source": "subtitle", "coverage": "none", "segments": [], "text": ""}


def pages():
    return {"hot": {"replies": [row(11, "这段敲击声音让人觉得很放松"), row(12, "我更喜欢后半段的摩擦声")]},
            "recent": {"replies": [row(13, "最后的变化比较突然还没听完")]}}


class CommunityTests(unittest.IsolatedAsyncioTestCase):
    async def test_title_and_tag_routing_and_request_scopes(self):
        for title, tags, by in [("【ＡＳＭＲ】无人声", [], "title"), ("深夜小屋", [{"tag_name": "助眠"}], "tag")]:
            obj = AsyncMock()
            obj.get_tags.return_value = tags
            async def fetch(**kwargs):
                self.assertEqual((kwargs["oid"], kwargs["page_index"]), (777, 1))
                self.assertEqual(kwargs["type_"], community.comment.CommentResourceType.VIDEO)
                self.assertEqual(kwargs["credential"], "fixture-credential")
                return pages()["hot" if kwargs["order"] == community.comment.OrderType.LIKE else "recent"]
            with patch.object(community.comment, "get_comments", side_effect=fetch) as read:
                result = await community.read_sound_video(obj, {"title": title, "aid": 777}, base(), "fixture-credential", 18000)
            self.assertEqual(result["classification"]["matchedBy"], by)
            self.assertEqual(result["source"], "comments")
            self.assertEqual(result["coverage"], "sampled")
            self.assertEqual(result["commentSample"]["scope"], "whole_video")
            self.assertEqual(result["commentSample"]["orders"], ["hot", "recent"])
            self.assertEqual(read.call_count, 2)
            self.assertNotIn("skipReason", result)
            if by == "title":
                obj.get_tags.assert_not_called()

    async def test_ordinary_video_and_failed_tag_lookup_preserve_subtitle_route(self):
        obj = AsyncMock()
        for tags in ([], RuntimeError("private-error")):
            obj.get_tags.side_effect = tags if isinstance(tags, Exception) else None
            obj.get_tags.return_value = tags
            with patch.object(community.comment, "get_comments", side_effect=AssertionError("must not read comments")):
                self.assertIsNone(await community.read_sound_video(obj, {"title": "程序开发教程"}, base(), None, 18000))
        self.assertIsNone(community.classify("ASMRToolkit 开发教程", "title"))
        self.assertIsNotNone(community.classify("asmr 低声耳语", "title"))

    async def test_closed_failed_or_too_few_comments_skip_without_leaking_errors(self):
        obj = AsyncMock()
        for response in (RuntimeError("credential-secret"), {"replies": []}, {"replies": [row(1, "只有这一条有效的观众留言")]}):
            with patch.object(community.comment, "get_comments", side_effect=response if isinstance(response, Exception) else None,
                              return_value=response):
                result = await community.read_sound_video(obj, {"title": "ASMR", "aid": 77}, base(), None, 18000)
            self.assertIn("skipReason", result)
            self.assertNotIn("credential-secret", str(result))
            self.assertEqual(result["source"], "comments")
            self.assertLess(result["commentSample"]["count"], 2)

    async def test_one_unavailable_order_still_records_bounded_sample_and_failure(self):
        async def fetch(**kwargs):
            if kwargs["order"] == community.comment.OrderType.TIME:
                raise TimeoutError("private host")
            return pages()["hot"]
        with patch.object(community.comment, "get_comments", side_effect=fetch):
            result = await community.read_sound_video(AsyncMock(), {"title": "耳搔", "aid": 77}, base(), None, 18000)
        self.assertEqual(result["commentSample"]["orders"], ["hot"])
        self.assertEqual(result["commentSample"]["failedOrders"], ["recent"])
        self.assertNotIn("skipReason", result)
        self.assertNotIn("private host", str(result))

    async def test_missing_comment_resource_never_uses_cid_as_oid(self):
        with patch.object(community.comment, "get_comments", side_effect=AssertionError("must not read")):
            result = await community.read_sound_video(AsyncMock(), {"title": "ASMR", "aid": 0}, base(), None, 1000)
        self.assertEqual(result["comments"], [])
        self.assertIn("标识", result["skipReason"])


class SampleTests(unittest.TestCase):
    def test_pinned_deduplication_and_no_replies_or_member_profiles(self):
        first = row(1, "敲击和摩擦的节奏各有不同", member={"mid": "secret-uid"}, replies=[row(9, "不能偷偷读取的楼中楼内容")])
        sample = community.select_samples({
            "hot": {"upper": {"top": first}, "hots": [first], "replies": [row(2, first["content"]["message"]),
                    row(3, "[doge][doge][doge]"), row(4, "好听"), {"rpid": 0, "content": {"message": "无效标识的评论不应留下"}}]},
            "recent": {"replies": [row(5, "这个版本的音量变化比较明显")]},
        }, BV, 6000)
        self.assertEqual([item["id"] for item in sample], ["1", "5"])
        self.assertNotIn("secret-uid", str(sample))
        self.assertNotIn("楼中楼", str(sample))
        self.assertEqual(sample[0]["url"], f"https://www.bilibili.com/video/{BV}/#reply1")

    def test_count_utf16_char_and_both_order_budgets(self):
        sample = community.select_samples({order: {"replies": [row(i + start, f"{order}第{i}条评论的具体描述" + "声音😀" * 200)
                           for i in range(30)]} for order, start in (("hot", 1), ("recent", 101))}, BV, 6000)
        self.assertLessEqual(len(sample), 20)
        self.assertLessEqual(community.units("\n".join(item["text"] for item in sample)), 6000)
        self.assertTrue(all(community.units(item["text"]) <= 500 and item["truncated"] for item in sample))
        self.assertEqual({item["order"] for item in sample}, {"hot", "recent"})
        full = community.select_samples({"hot": {"replies": [row(i + 1, f"第{i}条各不相同的简短评论内容") for i in range(30)]}}, BV, 6000)
        self.assertEqual(len(full), 20)


if __name__ == "__main__":
    unittest.main()
