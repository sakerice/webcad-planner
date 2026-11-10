#!/bin/sh
fail=0
for f in tools/tests/*.test.cjs; do
  if ! node "$f" > /dev/null 2>&1; then
    echo "FAIL $f"
    fail=1
  fi
done
# *_test.py (tools/tests/ に置く unittest)
for f in tools/tests/*_test.py; do
  [ -f "$f" ] || continue
  if ! python3 "$f" > /dev/null 2>&1; then
    echo "FAIL $f"
    fail=1
  fi
done
# lint の自己検査。「検査が実際に発火するか」を見る。
# 死んだ検査(何を入れても0件)を0件=合格として報告した事故があった。
if ! python3 tools/tests/lint_selftest.py > /dev/null 2>&1; then
  echo "FAIL tools/tests/lint_selftest.py"
  fail=1
fi
# pv の検査(合計 数秒)。truth-render は node と python、fidelity-qa は python。
# 実物のブラウザは要らない。python 側は PIL が要る。
for f in pv/tools/truth-render/tests/*.test.mjs; do
  if ! node --test "$f" > /dev/null 2>&1; then
    echo "FAIL $f"
    fail=1
  fi
done
for d in pv/tools/truth-render pv/tools/fidelity-qa; do
  if ! (cd "$d" && python3 -m unittest discover -s tests -t . > /dev/null 2>&1); then
    echo "FAIL $d/tests (python)"
    fail=1
  fi
done
echo "exit=$fail"
