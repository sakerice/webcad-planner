#!/usr/bin/env python3
"""probe/0000.png と probe/0002.png が byte 一致することを検証する。

capture-runner.mjs を determinism モードで走らせると、ポーズ A → B → A の
3枚が probe/ に出力される。0番と2番が一致しなければカメラ制御に隠れ状態があり、
連番キャプチャは再現不能である。

使い方: python3 pv/tools/truth-render/check_determinism.py pv/renders/<shot-id>
"""
import hashlib
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check_determinism.py <shot-render-dir>", file=sys.stderr)
        return 2
    probe = Path(sys.argv[1]) / "probe"
    a, b, c = probe / "0000.png", probe / "0001.png", probe / "0002.png"
    for p in (a, b, c):
        if not p.exists():
            print(f"FAIL missing {p}", file=sys.stderr)
            return 1

    def digest(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    da, db, dc = digest(a), digest(b), digest(c)
    if da != dc:
        print(f"FAIL pose A is not reproducible\n  0000 {da}\n  0002 {dc}", file=sys.stderr)
        return 1
    if da == db:
        print("FAIL pose B is identical to pose A; setPose had no effect", file=sys.stderr)
        return 1
    print(f"PASS pose A reproducible ({da[:12]}), pose B distinct ({db[:12]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
