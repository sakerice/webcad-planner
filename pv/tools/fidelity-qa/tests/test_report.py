import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report import evaluate


def row(index, recall, precision, instances=None):
    return {"index": index, "recall": recall, "precision": precision,
            "instances": instances or {}}


class EvaluateTest(unittest.TestCase):
    def test_all_above_threshold_passes(self):
        rows = [row(0, 0.95, 0.93), row(1, 0.97, 0.91)]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "PASS")
        self.assertEqual(got["failures"], [])

    def test_low_recall_fails_and_names_the_frame(self):
        rows = [row(0, 0.95, 0.95), row(7, 0.40, 0.95)]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertEqual(len(got["failures"]), 1)
        self.assertEqual(got["failures"][0]["index"], 7)
        self.assertIn("recall", got["failures"][0]["reasons"][0])

    def test_low_precision_fails(self):
        rows = [row(3, 0.99, 0.30)]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("precision", got["failures"][0]["reasons"][0])

    def test_missing_instance_is_named_in_the_failure(self):
        rows = [row(2, 0.99, 0.99, {"sofa": 0.98, "dining_table": 0.10})]
        got = evaluate(rows, min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")
        joined = " ".join(got["failures"][0]["reasons"])
        self.assertIn("dining_table", joined)
        self.assertNotIn("sofa", joined)

    def test_empty_rows_fail_rather_than_silently_pass(self):
        got = evaluate([], min_recall=0.9, min_precision=0.9)
        self.assertEqual(got["verdict"], "FAIL")


if __name__ == "__main__":
    unittest.main()
