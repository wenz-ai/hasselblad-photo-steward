import unittest
from unittest.mock import patch
from ai_review import batches, cache_key, validate


def sample(i, decision, peer=0):
    return {"index":i,"decision":decision,"peer":peer,"exposure":18,"focus":19,"composition":17,"aesthetics":14,
            "reason":"红色主体位于中央。","uncertainty":"","exposure_reason":"亮部仍有明暗层次",
            "composition_reason":"主体完整","focus_reason":"轮廓分明","aesthetics_reason":"红绿对照明显",
            "alternative":"可保留另一种裁切。","recovery":"直接可用","edit_priority":"无需后期",
            "crop":"保持原构图","recovery_reason":"主体清楚","edit_reason":"原图适合分享","crop_reason":"留白均衡。"}


class ReviewTest(unittest.TestCase):
    def test_checked_scores_and_peer(self):
        records=[sample(1,"保留"),sample(2,"相似备选",1)]
        marks=validate({"photos":records},["first","second"])
        self.assertEqual(marks["second"]["peer"],"first")
        self.assertEqual(marks["first"]["score"],68)
        records[1]["peer"]=2
        with self.assertRaises(ValueError):validate({"photos":records},["first","second"])
        records[1]["peer"]=1
        records[0]["focus"]=26
        with self.assertRaises(ValueError):validate({"photos":records},["first","second"])

    def test_recoverable_frames_require_review(self):
        for recovery in ("需查原片","可尝试后期","直接可用","修复空间很小"):
            candidate=sample(1,"疑似废片")
            candidate.update(recovery=recovery,edit_priority="暂缓投入",crop="裁切解决不了")
            result=validate({"photos":[candidate]},["frame"])["frame"]
            expected="疑似废片" if recovery=="修复空间很小" else "需复核"
            self.assertEqual(result["decision"],expected)
            self.assertEqual(candidate["decision"],"疑似废片")

    def test_limited_batches_and_cache_separation(self):
        rows=[{"id":str(i),"date":"2026-01-01","group":"shared","files":[{"size":7,"mtime":5}]} for i in range(14)]
        plans=batches(rows)
        self.assertEqual(list(map(len,plans)),[6,6,2])
        with patch("ai_review.selected_model",return_value="example-vision"):
            self.assertNotEqual(cache_key(plans[0],"subscription"),cache_key(plans[0],"key"))
            self.assertNotEqual(cache_key(plans[0],"subscription"),cache_key(plans[0][::-1],"subscription"))
