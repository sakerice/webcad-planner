#!/bin/sh
fail=0
for f in tools/tests/*.test.cjs; do
  if ! node "$f" > /dev/null 2>&1; then
    echo "FAIL $f"
    fail=1
  fi
done
echo "exit=$fail"
