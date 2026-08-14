"""テストが「走っていない」ことを、成功で隠さないための検査 (Task 26-6)。

`unittest.main()` がファイルの途中にあると、そこから下の TestCase は
`python3 tests/test_report.py` で **登録されないまま OK が返る**。実測では
101件のうち51件しか走っておらず、残り50件が緑のまま出荷されていた。
discovery 形式では全部走るので、走らせ方の違いだけで件数が変わる。

ここは走らせ方に依らないよう、ソースを構文木で読む。見るのは2つだけ:
  1. すべての test_*.py に `unittest.main()` の起動口がある
  2. その起動口より **後ろ** に TestCase が1つも無い
"""

import ast
import unittest
from pathlib import Path

TEST_DIRS = [
    Path(__file__).resolve().parent,                                  # fidelity-qa
    Path(__file__).resolve().parents[2] / "truth-render" / "tests",   # truth-render
]


def _test_modules():
    for d in TEST_DIRS:
        if not d.is_dir():
            continue
        for p in sorted(d.glob("test_*.py")):
            yield p


def _main_call_line(tree):
    """`unittest.main()` を呼んでいる行番号。無ければ None。"""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr == "main" \
                and isinstance(f.value, ast.Name) and f.value.id == "unittest":
            return node.lineno
    return None


def _testcase_class_lines(tree):
    out = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        for base in node.bases:
            name = base.attr if isinstance(base, ast.Attribute) else getattr(base, "id", None)
            if name == "TestCase":
                out.append((node.name, node.lineno))
                break
    return out


class SuiteWiringTest(unittest.TestCase):
    def test_every_test_module_can_be_run_on_its_own(self):
        found = list(_test_modules())
        self.assertGreaterEqual(len(found), 6, "テストファイルが見つからない: " + str(found))
        for path in found:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            self.assertIsNotNone(
                _main_call_line(tree),
                f"{path.name} に unittest.main() が無い。"
                "直接走らせると静かに0件になる",
            )

    def test_no_test_case_is_defined_after_unittest_main(self):
        for path in _test_modules():
            tree = ast.parse(path.read_text(encoding="utf-8"))
            main_line = _main_call_line(tree)
            if main_line is None:
                continue                      # 上の検査が名指しで落とす
            orphans = [f"{n} (L{l})" for n, l in _testcase_class_lines(tree) if l > main_line]
            self.assertEqual(
                orphans, [],
                f"{path.name}: unittest.main() (L{main_line}) より後ろの TestCase は "
                "直接実行では登録されない。main() をファイルの末尾へ移すこと: "
                + ", ".join(orphans),
            )


if __name__ == "__main__":
    unittest.main()
