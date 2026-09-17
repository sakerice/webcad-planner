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

// 出荷する既定間取りは、**高さモデルを明示して**いなければならない。
// 印(heightDefaults.modelVersion)が無いプランは「v2以前に保存されたもの」として
// 旧い基準で読まれる。生成器を回して印が落ちると、1階の天井が300mm下がり、
// 物干しやレンジフードが天井に埋まったまま出荷される。目では気付けないので
// ここで止める(検査の本体は tools/lint_plan.py の check33)。
function heightModelErrors(plan) {
  const hd = plan && plan.heightDefaults;
  if (!hd || hd.modelVersion !== 2) {
    return ['heightDefaults.modelVersion が 2 でない(高さモデルの印が無い)'];
  }
  const out = [];
  const thickness = Number(hd.floorThickness);
  if (!(thickness > 0)) out.push('heightDefaults.floorThickness が無い');
  if (hd.perFloor) {
    const floors = plan.floors || {};
    const missing = Object.keys(floors).filter(
      (f) => !(Number((floors[f] || {}).wallHeight) > 0));
    if (missing.length) out.push(`floors の壁の高さが無い: ${missing.join(', ')}`);
  } else if (!(Number(hd.wallHeight) > 0)) {
    out.push('heightDefaults.wallHeight が無い');
  }
  return out;
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
    const heights = heightModelErrors(plan);
    if (heights.length) {
      console.error(`${file}: 高さの設定が出荷できる形ではない (${shape})`);
      heights.forEach((m) => console.error('  ' + m));
      bad = 1;
    } else {
      console.log(`${file}: OK (${shape})`);
      r.warnings.slice(0, 5).forEach((m) => console.log('  警告: ' + m));
    }
  }
}
process.exit(bad);
