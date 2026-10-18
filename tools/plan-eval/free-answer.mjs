// 短い指示で答えさせた読み取り（free-brief の答え）を、アプリのプランの形に直して採点する。
//
// なぜ在るのか
// ------------
// 今の読み取りの指示は手順と答えの型が細かく決まっている（壁は部屋の境目から機械で作る、
// ページを1枚ずつ読む、家具と扉の向きは答える欄が無い）。その制約が読み取りを狭めているのか
// を確かめるため、制約を外した答え方を用意して同じ物差しで比べる（2026-10-19 利用者の指摘）。
//
//   node tools/plan-eval/free-answer.mjs <答え.json> <出力のプラン.json>
//
// 答えの形（free-brief に書いたもの）:
//   { floors: [ { floor, walls:[{x1,y1,x2,y2}], rooms:[{name, parts:[{x0,y0,x1,y1}]}],
//       openings:[{type, x, y, width, hinge, opens}], stairs:[{type, x, y, width, length, up, enter, exit}],
//       objects:[{kind, x, y, w, d, face}] } ] }
// 座標は mm、原点は1階の外壁の北西の角（芯）、x は東、y は南。方角は N/E/S/W。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TAGS = (() => { const t = require('../../assets/models/tags.json'); return t.items || t; })();

const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const ROT = { N: 0, E: 90, S: 180, W: 270 };
const DEPTH = { window: 150, 'window-door': 180, 'door-slide': 150, 'door-slide-s': 150, 'door-fold': 420,
  'door-opening': 160, 'door-front': 200 };
// 種類 → アプリの type。組み込みがあるものはそれを、無いものはカタログで確信度の高いモデルを使う。
const BUILTIN = { sofa: 'sofa', 'dining-table': 'dining-table', tv: 'tv', refrigerator: 'fridge', laundry: 'washer',
  bathtub: 'bath', toilet: 'toilet', vanity: 'sink', 'kitchen-unit': 'kitchen', ramp: 'ramp', balcony: 'balcony',
  deck: 'original-terrace-tile', 'exterior-stair': 'exterior-stair', desk: 'desk', closet: 'closet' };
function typeForKind(kind, w) {
  if (kind === 'bed') return w > 1200 ? 'bed-d' : 'bed-s';
  if (BUILTIN[kind]) return BUILTIN[kind];
  let best = null;
  for (const [id, v] of Object.entries(TAGS)) {
    if (v.kind !== kind || v.review) continue;
    if (!best || (v.confidence || 0) > (best.c || 0)) best = { id, c: v.confidence || 0 };
  }
  return best && best.id;
}

let nextId = 1;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function nearestWall(walls, cx, cy) {
  let best = null;
  for (const w of walls) {
    const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (L < 1) continue;
    const ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
    const t = Math.max(0, Math.min(L, (cx - w.x1) * ux + (cy - w.y1) * uy));
    const d = Math.hypot(cx - w.x1 - ux * t, cy - w.y1 - uy * t);
    if (!best || d < best.d) best = { d, ux, uy };
  }
  return best;
}

function item(type, cx, cy, w, d, floor, rot, extra) {
  return { id: nextId++, type, x: cx - w / 2, y: cy - d / 2, w, d, rot: rot || 0, floor, flipX: false, flipY: false, ...(extra || {}) };
}

export function toPlan(answer) {
  const plan = { walls: [], rooms: [], items: [] };
  for (const f of answer.floors || []) {
    const floor = num(f.floor) || 1;
    const walls = (f.walls || []).map((w) => ({ id: nextId++, x1: num(w.x1), y1: num(w.y1), x2: num(w.x2), y2: num(w.y2), floor, thick: 120 }));
    plan.walls.push(...walls);
    for (const r of f.rooms || []) {
      for (const p of r.parts || []) {
        const x0 = Math.min(num(p.x0), num(p.x1)), y0 = Math.min(num(p.y0), num(p.y1));
        plan.rooms.push({ id: 'r' + nextId++, type: 'room', x: x0, y: y0, w: Math.abs(num(p.x1) - num(p.x0)), d: Math.abs(num(p.y1) - num(p.y0)), floor, n: String(r.name || '') });
      }
    }
    for (const o of f.openings || []) {
      const t = String(o.type || '');
      const width = num(o.width) || 780;
      const near = nearestWall(walls, num(o.x), num(o.y));
      const vertical = near && Math.abs(near.uy) > Math.abs(near.ux);
      const depth = /^door-swing|^door-front/.test(t) && t !== 'door-front' ? width : (DEPTH[t] || 150);
      const it = item(t, num(o.x), num(o.y), width, depth, floor, vertical ? 90 : 0);
      if (near && o.hinge && DIR[o.hinge]) {
        const [hx, hy] = DIR[o.hinge];
        it.flipX = hx * near.ux + hy * near.uy > 0;
      }
      if (near && o.opens && DIR[o.opens]) {
        const [ox, oy] = DIR[o.opens];
        const right = ox * -near.uy + oy * near.ux > 0;
        it.flipY = t.startsWith('door-fold') ? right : !right;
      }
      plan.items.push(it);
    }
    for (const s of f.stairs || []) {
      const width = num(s.width) || 910, len = num(s.length) || 910;
      if (s.type === 'stair-corner') {
        // +d 辺から入り +w 辺へ抜ける。入る辺に +d を向け、抜ける向きが逆なら flipX。
        const enter = DIR[s.enter] ? s.enter : 'S';
        const rot = { S: 0, W: 90, N: 180, E: 270 }[enter];
        const th = rot * Math.PI / 180, ex = [Math.cos(th), Math.sin(th)];
        const want = DIR[s.exit] || ex;
        plan.items.push(item('stair-corner', num(s.x), num(s.y), width, width, floor, rot, { flipX: ex[0] * want[0] + ex[1] * want[1] < 0 }));
      } else {
        const rot = { S: 0, W: 90, N: 180, E: 270 }[DIR[s.up] ? s.up : 'S'];
        plan.items.push(item('stair', num(s.x), num(s.y), width, len, floor, rot));
      }
    }
    for (const o of f.objects || []) {
      const w = num(o.w) || 600, d = num(o.d) || 600;
      const type = typeForKind(String(o.kind || ''), w);
      if (!type) continue;
      let rot = (ROT[o.face] ?? 0) + (type === 'washer' ? 180 : 0);
      const extra = {};
      if (/^(im0261-|original-)/.test(type)) { rot += 180; extra.modelFrontAxis = '+Z'; }
      plan.items.push(item(type, num(o.x), num(o.y), w, d, floor, rot % 360, extra));
    }
  }
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, out] = process.argv.slice(2);
  const plan = toPlan(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(out, JSON.stringify(plan));
  const { scorePlan, formatReport } = require('./score.cjs');
  const truth = JSON.parse(readFileSync(new URL('./truth/madori-3f.json', import.meta.url), 'utf8'));
  console.log(formatReport(scorePlan(truth, plan)));
}
