#!/usr/bin/env node
// 間取りJSONが「読み込める形」かを見る。assets/js/plan-schema.js に聞くだけ。
//
// テストからは出荷用の assets/default_plan.json を読めない決まりがある
// (tools/tests/fixture-only.test.cjs。既定間取りを良くするたびにテストが
// 落ちるのを避けるため)。一方で、出荷するものが読めない形になっていたら
// 困るので、こちらは build.sh から呼ぶ。
//
//   node tools/check_plan_schema.cjs assets/default_plan.json [...]
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const PlanSchema = require(join(__dirname, '..', 'assets', 'js', 'plan-schema.js'));

const files = process.argv.slice(2);
if (!files.length) {
  console.error('使い方: node tools/check_plan_schema.cjs <プランJSON> [...]');
  process.exit(2);
}

let bad = 0;
for (const file of files) {
  let plan;
  try {
    plan = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`${file}: JSON として読めない (${e.message})`);
    bad = 1;
    continue;
  }
  const r = PlanSchema.validatePlan(plan);
  const s = PlanSchema.summarize(plan);
  const shape = `壁${s.walls} 部屋${s.rooms} 物${s.items} 階${s.floors.join('/')}`;
  if (!r.ok) {
    console.error(`${file}: 読み込める形ではない (${shape})`);
    r.errors.slice(0, 20).forEach((m) => console.error('  ' + m));
    if (r.errors.length > 20) console.error(`  ...ほか ${r.errors.length - 20} 件`);
    bad = 1;
  } else {
    console.log(`${file}: OK (${shape})`);
    r.warnings.slice(0, 5).forEach((m) => console.log('  警告: ' + m));
  }
}
process.exit(bad);
