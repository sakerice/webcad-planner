#!/bin/sh
cd "$(dirname "$0")/.." || exit 1

fail=0
for f in tools/tests/*.test.cjs; do
  if ! output=$(node "$f" 2>&1); then
    echo "FAIL $f"
    printf '%s\n' "$output"
    fail=1
  fi
done
# lint の自己検査。「検査が実際に発火するか」を見る。
# 死んだ検査(何を入れても0件)を0件=合格として報告した事故があった。
if ! output=$(python3 tools/tests/lint_selftest.py 2>&1); then
  echo "FAIL tools/tests/lint_selftest.py"
  printf '%s\n' "$output"
  fail=1
fi
echo "exit=$fail"
exit "$fail"
