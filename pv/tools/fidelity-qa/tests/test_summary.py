"""Task 20-3: ユーザーに見せる日本語の要約 (`summary.py`)。

判定はやり直さない。`report.evaluate()` が出したものを言い換えるだけである。
だからテストも「文字列を組み立てる関数」ではなく、**本物の evaluate の結果**
を通して読む。ここが要約と本体の判定が食い違わない唯一の担保になる。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import categories as cat
from report import evaluate
from summary import summarise, summary_text

from test_report import category, instance, row, thresholds


def _evaluate(rows, **kw):
    return evaluate(rows, thresholds(**kw))


class HeadlineTest(unittest.TestCase):
    def test_a_clean_run_says_the_plan_is_intact_and_nothing_else(self):
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95),
                                            "furniture": category(cat.SOFT, 0.95)})])
        self.assertEqual(got["verdict"], "PASS")
        lines = summarise(got)
        self.assertEqual(lines, ["間取り（壁・窓・建具・屋根・床）は保たれています。"])

    def test_a_locked_failure_says_the_plan_changed_and_names_the_part(self):
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.10, lost_px=900)})],
                        min_locked_recall=0.75)
        self.assertEqual(got["verdict"], "FAIL")
        text = summary_text(got)
        self.assertIn("間取りが変わっています", text)
        self.assertIn("壁", text)                      # カテゴリは日本語で
        self.assertNotIn("recall", text)               # 判定器の生の数字は出さない
        self.assertNotIn("0.10", text)

    def test_a_named_instance_reaches_the_summary_by_name(self):
        got = _evaluate([row(0, instances={
            "lattice-screen#35": instance(cat.LOCKED, 0.99, category_key="exterior",
                                          finish_drift=69.5)})],
            max_locked_finish_drift=12.0)
        self.assertEqual(got["verdict"], "FAIL")
        self.assertIn("lattice-screen#35", summary_text(got))

    def test_a_soft_regression_does_not_say_the_plan_changed(self):
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95),
                                            "furniture": category(cat.SOFT, 0.10)})],
                        min_soft_recall=0.75)
        self.assertEqual(got["verdict"], "SOFT_REGRESSION")
        lines = summarise(got)
        self.assertIn("間取り（壁・窓・建具・屋根・床）は保たれています。", lines[0])
        self.assertNotIn("間取りが変わっています", " ".join(lines))
        joined = " ".join(lines)
        self.assertIn("家具", joined)
        self.assertIn("許容範囲", joined)

    def test_the_three_tiers_are_not_spoken_of_in_the_same_breath(self):
        """LOCKED の指摘と SOFT の指摘は必ず別の行に置く。"""
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.10),
                                            "furniture": category(cat.SOFT, 0.10)})],
                        min_locked_recall=0.75, min_soft_recall=0.75)
        lines = summarise(got)
        locked_line = [i for i, l in enumerate(lines) if "間取りが変わっています" in l]
        soft_line = [i for i, l in enumerate(lines) if "許容範囲" in l]
        self.assertEqual(len(locked_line), 1)
        self.assertEqual(len(soft_line), 1)
        self.assertNotEqual(locked_line[0], soft_line[0])


class FreeIsNeverMentionedTest(unittest.TestCase):
    """FREE は触れない。減点しないものを要約で話題にすると、読む側は
    減点されたと読む。"""

    def test_a_huge_free_addition_changes_not_one_character(self):
        clean = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95)})])
        lived_in = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95)},
                                  added_px=9_000_000)])
        self.assertEqual(summary_text(clean), summary_text(lived_in))
        self.assertNotIn("追加", summary_text(lived_in))

    def test_a_part_declared_free_is_not_named(self):
        got = _evaluate([row(0, instances={
            "neighbor-house#12": instance(cat.FREE, 0.0, category_key="neighbour",
                                          finish_drift=180.0)})])
        self.assertEqual(got["verdict"], "PASS")
        self.assertNotIn("neighbor-house#12", summary_text(got))


class UnverifiableIsNotReassuranceTest(unittest.TestCase):
    """**測れなかったことと、測って大丈夫だったことを混ぜない。**"""

    def test_a_pass_with_unverifiable_checks_does_not_claim_more_than_it_checked(self):
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95),
                                            "windows": category(cat.LOCKED, None)})],
                        max_unverifiable_fraction=0.9)
        self.assertEqual(got["verdict"], "PASS")
        text = summary_text(got)
        self.assertIn("確かめられた範囲では", text)
        self.assertIn("確かめられていません", text)
        self.assertIn("問題が無かったのではなく", text)

    def test_a_fully_verified_pass_carries_no_hedge(self):
        """逆向きも守る。何も測れなかった run と同じ言葉で語らない。"""
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95)})])
        text = summary_text(got)
        self.assertNotIn("確かめられた範囲では", text)
        self.assertNotIn("確かめられていません", text)

    def test_a_run_that_could_not_be_checked_does_not_say_the_plan_changed(self):
        """検証不能率だけで落ちた run。変わったと分かったわけではない。"""
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, None),
                                            "windows": category(cat.LOCKED, None)})],
                        max_unverifiable_fraction=0.0)
        self.assertEqual(got["verdict"], "FAIL")
        text = summary_text(got)
        self.assertIn("判定できませんでした", text)
        self.assertNotIn("間取りが変わっています", text)
        self.assertNotIn("保たれています", text)

    def test_the_count_of_unverifiable_checks_is_stated_not_rounded_away(self):
        got = _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95),
                                            "windows": category(cat.LOCKED, None),
                                            "doors": category(cat.LOCKED, None)})],
                        max_unverifiable_fraction=0.9)
        text = summary_text(got)
        self.assertIn("2件", text)
        self.assertIn("3件", text)      # 検査の総数


class ShapeTest(unittest.TestCase):
    def test_the_summary_is_never_more_than_three_lines_and_never_empty(self):
        cases = [
            _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.95)})]),
            _evaluate([row(0, categories={"walls": category(cat.LOCKED, 0.10),
                                          "windows": category(cat.LOCKED, None),
                                          "furniture": category(cat.SOFT, 0.10)})],
                      min_locked_recall=0.75, min_soft_recall=0.75,
                      max_unverifiable_fraction=0.9),
            evaluate([], thresholds()),
        ]
        for got in cases:
            lines = summarise(got)
            self.assertGreaterEqual(len(lines), 1, got["verdict"])
            self.assertLessEqual(len(lines), 3, lines)
            for line in lines:
                self.assertTrue(line.strip())

    def test_many_broken_parts_are_summarised_not_listed_in_full(self):
        got = _evaluate([row(0, instances={
            f"wall#{i}": instance(cat.LOCKED, 0.0) for i in range(9)})],
            min_locked_instance_recall=0.45)
        text = summary_text(got)
        self.assertIn("ほか", text)
        self.assertLessEqual(len(text), 200)


class CliPlacementTest(unittest.TestCase):
    """要約は **パッケージ有りの run と、明示的に頼まれたときだけ** 出す。

    既存の PV 実行 (package.json を持たない) の標準出力と JSON を1バイトも
    動かさない、というのがこのタスクの前提条件だからである。ここは
    `report.py` を実際に起動して確かめる。
    """

    import json as _json
    import subprocess as _subprocess
    import tempfile as _tempfile

    ROOT = Path(__file__).resolve().parents[1]
    FLAGS = ["--min-locked-recall", "0.55", "--max-locked-contradiction", "0.20",
             "--min-locked-instance-recall", "0.45", "--min-soft-recall", "0.55",
             "--min-soft-instance-recall", "0.45", "--max-unverifiable-fraction", "0.5",
             "--max-locked-finish-drift", "60", "--radius", "2", "--quiet-narrative"]

    def _fixture(self, root: Path):
        import numpy as np
        from test_report import (_make_truth_dirs, _regions, _line_drawing,
                                 _segmentation, _render, _appearance_upgrade,
                                 _save, SOFA_H, SOFA_W)
        truth, gen = _make_truth_dirs(root, with_instance=True)
        regions = _regions(sofa=(120, 200))
        _save(truth / "edge" / "0000.png", _line_drawing(regions))
        _save(truth / "segmentation" / "0000.png", _segmentation(regions))
        _save(truth / "base" / "0000.png", _render(regions))
        guide = np.zeros((300, 300, 3), dtype=np.uint8)
        guide[120:120 + SOFA_H, 200:200 + SOFA_W] = (255, 0, 0)
        _save(truth / "instance" / "0000.png", guide)
        _save(gen / "0000.png", _appearance_upgrade(regions))
        (truth / "instance-legend.json").write_text(self._json.dumps(
            {"version": 2, "instances": [{"id": 1, "color": "#ff0000", "type": "sofa"}]}))
        (root / "package.json").write_text(self._json.dumps(
            {"version": 1, "source": "3d",
             "instances": [{"id": 1, "color": "#ff0000", "type": "sofa",
                            "floor": 2, "tier": "SOFT"}]}))
        return truth, gen

    def _run(self, extra):
        with self._tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            truth, gen = self._fixture(root)
            out_json = root / "out.json"
            proc = self._subprocess.run(
                [sys.executable, str(self.ROOT / "report.py"),
                 "--truth", str(truth), "--generated", str(gen),
                 "--json", str(out_json)] + self.FLAGS + [
                    a.replace("PACKAGE", str(root / "package.json")) for a in extra],
                capture_output=True, text=True, env={"PYTHONDONTWRITEBYTECODE": "1",
                                                     "PATH": "/usr/bin:/bin"})
            return proc, self._json.loads(out_json.read_text())

    def test_a_run_without_a_package_prints_no_summary_and_stores_none(self):
        proc, result = self._run([])
        self.assertNotIn("要約", proc.stdout)
        self.assertNotIn("summary_ja", result)

    def test_a_run_with_a_package_shows_the_summary_first(self):
        proc, result = self._run(["--package", "PACKAGE"])
        self.assertIn("要約", proc.stdout)
        self.assertIn("summary_ja", result)
        self.assertEqual(result["summary_ja"], summarise(result))
        # 判定器の生の行より **前** に置く。ユーザーが最初に読むのはこちら。
        self.assertLess(proc.stdout.index("要約"), proc.stdout.index("frames compared"))

    def test_the_summary_can_be_asked_for_without_a_package(self):
        proc, result = self._run(["--summary"])
        self.assertIn("要約", proc.stdout)
        self.assertIn("summary_ja", result)


# 直接走らせても走るように。無いとこのファイルだけ「静かに0件」になる(Task 26-6)。
if __name__ == "__main__":
    unittest.main()
