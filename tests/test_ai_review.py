import unittest
from unittest.mock import patch
from ai_review import batches, cache_key, validate


def sample(i, decision, peer=0):
    return {"index":i,"decision":decision,"peer":peer,"moment":26,"composition":20,"quality":22,
            "reason":"红色主体占画面中央。","uncertainty":"","moment_reason":"主体突出",
            "composition_reason":"留白均衡","quality_reason":"边缘可见","alternative":"可以保留另一种裁切。"}


class ReviewTest(unittest.TestCase):
    def test_checked_scores_and_peer(self):
        records=[sample(1,"保留"),sample(2,"相似备选",1)]
        marks=validate({"photos":records},["first","second"])
        self.assertEqual(marks["second"]["peer"],"first")
        self.assertEqual(marks["first"]["score"],68)
        records[1]["peer"]=2
        with self.assertRaises(ValueError):validate({"photos":records},["first","second"])
        records[1]["peer"]=1
        records[0]["moment"]=41
        with self.assertRaises(ValueError):validate({"photos":records},["first","second"])

    def test_limited_batches_and_cache_separation(self):
        rows=[{"id":str(i),"date":"2026-01-01","group":"shared","files":[{"size":7,"mtime":5}]} for i in range(14)]
        plans=batches(rows)
        self.assertEqual(list(map(len,plans)),[6,6,2])
        with patch("ai_review.selected_model",return_value="example-vision"):
            self.assertNotEqual(cache_key(plans[0],"subscription"),cache_key(plans[0],"key"))
            self.assertNotEqual(cache_key(plans[0],"subscription"),cache_key(plans[0][::-1],"subscription"))
