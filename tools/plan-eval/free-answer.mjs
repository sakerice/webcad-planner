// 短い指示で答えさせた読み取り（worker/plan-free.mjs の答え）を、アプリのプランの形に直して採点する。
//
// 方角 → rot・flipX・flipY の翻訳は assets/js/plan-free-apply.js（取り込みの画面と同じ部品）に任せ、
// ここでは取り込みの toAppObjects と同じく、中心の座標を角へ直して保存の形にする。
//
//   node tools/plan-eval/free-answer.mjs <答え.json> <出力のプラン.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PlanFreeApply = require('../../assets/js/plan-free-apply.js');
const TAGS = (() => { const t = require('../../assets/models/tags.json'); return t.items || t; })();

export function toPlan(answer) {
  const p = PlanFreeApply.toImportPlan(answer, TAGS);
  let id = 1;
  return {
    walls: p.walls.map((w) => ({ id: id++, ...w })),
    rooms: p.rooms.map((r) => ({ id: 'r' + id++, type: 'room', ...r })),
    items: p.items.map((it) => ({
      id: id++, type: it.type, x: it.x - it.w / 2, y: it.y - it.d / 2, w: it.w, d: it.d, rot: it.rot, floor: it.floor,
      flipX: false, flipY: false, ...it.extra,
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, out] = process.argv.slice(2);
  const plan = toPlan(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(out, JSON.stringify(plan));
  const { scorePlan, formatReport } = require('./score.cjs');
  const truth = JSON.parse(readFileSync(new URL('./truth/madori-3f.json', import.meta.url), 'utf8'));
  console.log(formatReport(scorePlan(truth, plan)));
}
