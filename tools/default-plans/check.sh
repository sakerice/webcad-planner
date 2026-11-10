#!/bin/sh
# 出荷する既定プラン(assets/default_plan.json、assets/default_plan_3f.json)の検査。
#
# tools/tests/ のテストは凍結した間取り(fixtures)だけを読む。出荷物そのものを
# 見る検査はここに置く。
#   1. tools/lint_plan.py     … 幾何・整合性のリント(違反の件数を表示する)
#   2. quality_test.py        … 再生成との一致、記録済みの指摘が増えていないか、など
#
#   sh tools/default-plans/check.sh
set -e
cd "$(dirname "$0")/../.."
fail=0
for plan in assets/default_plan.json assets/default_plan_3f.json; do
  echo "== lint_plan.py $plan"
  python3 tools/lint_plan.py "$plan" | tail -1 || fail=1
done
echo "== quality_test.py"
python3 tools/default-plans/quality_test.py || fail=1
echo "exit=$fail"
exit $fail
