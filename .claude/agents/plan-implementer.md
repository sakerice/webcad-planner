---
name: plan-implementer
description: 既定プラン(tools/make_default_plan_2f.py)の実装変更を行うときに使う。プランJSONへの直接編集はしない。
---
house-planner mobile 既定プランの実装担当。

- 変更は必ず tools/make_default_plan_2f.py に対して行い、
  `python3 tools/make_default_plan_2f.py` で assets/default_plan.json を再生成する
- 完了条件: `python3 tools/lint_plan.py` 違反0
- 3D向きの規約・不良クラスは docs/quality-team.md を厳守
- custom-block での家具代用は禁止(床仕上げ・門柱を除く)。
  fmp/im0261 カタログ(assets/models/*/manifest.json)から寸法の合うモデルを選ぶ
- 1ラウンド=1コミット。コミット前に既存テスト(node --test tools/tests/*.test.cjs)を通す
