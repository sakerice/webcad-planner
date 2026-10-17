#!/usr/bin/env node
// 読み取った間取りを、人が直した正解と比べて点数を出す（計画の 0-3）。
//
// なぜ在るのか
// ------------
// 読み取りの改善を、見た目の印象ではなく数字で比べるため。モデルを替える・
// 指示文を直す・切り出しを変える、のどれも「良くなった気がする」では選べない。
// 同じ図面・同じ正解・同じ採点で並べて、上がったものだけを取り込む。
//
// 何を比べるか
// ------------
//   壁   … 位置と長さ。正解の壁のうち読み取りが重なっている長さの割合（取りこぼし）と、
//          読み取りの壁のうち正解に重なっている長さの割合（余計な壁）の調和平均。
//   部屋 … 数・名前・面積。部屋どうしを重なり（IoU）で対応づけてから比べる。
//   建具 … 数と位置。窓・扉ごとに、中心の近いものを対応づける。
//
// どちらのプランも**アプリに保存される形**（JSON に書き出したもの）で受け取る。
// 原点は図面ごとに違うので、平行移動だけは採点の側で合わせる（回転・反転はしない）。
//
// 使い方
//   node tools/plan-eval/score.cjs <正解.json> <読み取り.json> [--json]
'use strict';

const CELL_MM = 50;          // 部屋の重なりを数える升目
const WALL_TOL_MM = 150;     // 壁が「同じ位置」とみなす芯のずれ（壁の厚みほど）
const WALL_TOL_STRICT_MM = 50;
const WALL_STEP_MM = 50;     // 壁を点に分ける間隔
const OPENING_TOL_MM = 600;  // 建具の中心がこれ以内なら同じ建具とみなす
const ROOM_MIN_IOU = 0.3;
const WEIGHTS = { walls: 0.4, rooms: 0.3, openings: 0.3 };

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function floorOf(o) { return num(o && o.floor) || 1; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function f1(p, r) { return p + r > 0 ? 2 * p * r / (p + r) : 0; }

// ── 名前 ────────────────────────────────────────────────────────────
//
// 「洋室（4.2帖）」と「洋室」、「趣味部屋①」と「趣味部屋1」は同じ名前として扱う。
// 図面に添えてある畳数や番号の書き方の違いで点を落とさないため。
function normalizeName(name) {
  let s = String(name || '').normalize('NFKC').toLowerCase();
  s = s.replace(/[(（][^)）]*[)）]/g, '');
  s = s.replace(/[0-9.]+\s*(帖|畳|j)/g, '');
  s = s.replace(/[\s・･、,]/g, '');
  return s;
}

// 名前が違っても**同じ用途**なら半分の点を与える。並びは判定の順（先に当たったもの）。
const ROOM_KINDS = [
  ['ldk', ['ldk', 'リビング', 'ダイニング', 'キッチン', 'living', 'dining', 'dinning', 'kitchen', '居間', '食堂', '台所']],
  ['toilet', ['トイレ', 'wc', '便所']],
  ['bath', ['浴室', 'バス', 'bath', 'ユニットバス']],
  ['wash', ['洗面', '脱衣', 'ランドリー', 'サニタリー']],
  ['storage', ['収納', 'クローゼット', 'クロゼット', '納戸', '物入', '押入', 'wic', 'sic', 'cl', 'パントリー']],
  ['entry', ['玄関', '土間', 'ポーチ', '置き場']],
  ['hall', ['廊下', 'ホール', '階段', 'ギャラリー']],
  ['balcony', ['バルコニー', 'ベランダ', 'テラス']],
  ['bed', ['洋室', '和室', '寝室', '子供室', '子ども室', '個室', '部屋', '書斎', 'bed']],
];
function roomKind(name) {
  const s = normalizeName(name);
  for (const [kind, words] of ROOM_KINDS) {
    if (words.some((w) => s.includes(w))) return kind;
  }
  return '';
}
function nameScore(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (na && na === nb) return 1;
  const ka = roomKind(a), kb = roomKind(b);
  if (ka && ka === kb) return 0.5;
  return 0;
}

// ── 部屋 ────────────────────────────────────────────────────────────
//
// L字の部屋は「同じ名前の長方形が接している」形で入っている。数を数える前に
// 1つにまとめる。まとめないと、L字を長方形2つで正しく描いても数が合わなくなる。
function roomGroups(rooms, floor, dx, dy) {
  const list = (rooms || []).filter((r) => r && floorOf(r) === floor && num(r.w) > 0 && num(r.d) > 0)
    .map((r) => ({
      x0: num(r.x) + dx, y0: num(r.y) + dy,
      x1: num(r.x) + num(r.w) + dx, y1: num(r.y) + num(r.d) + dy,
      name: String(r.n || r.name || ''),
    }));
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touch = (a, b) => a.x0 <= b.x1 + 1 && b.x0 <= a.x1 + 1 && a.y0 <= b.y1 + 1 && b.y0 <= a.y1 + 1;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const ni = normalizeName(list[i].name);
      if (ni && ni === normalizeName(list[j].name) && touch(list[i], list[j])) parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map();
  list.forEach((r, i) => {
    const k = find(i);
    if (!byRoot.has(k)) byRoot.set(k, { name: r.name, rects: [] });
    byRoot.get(k).rects.push(r);
  });
  return [...byRoot.values()].map((g) => ({ ...g, cells: cellsOf(g.rects) }));
}

function cellsOf(rects) {
  const set = new Set();
  for (const r of rects) {
    const cx0 = Math.round(r.x0 / CELL_MM), cx1 = Math.round(r.x1 / CELL_MM);
    const cy0 = Math.round(r.y0 / CELL_MM), cy1 = Math.round(r.y1 / CELL_MM);
    for (let x = cx0; x < cx1; x++) for (let y = cy0; y < cy1; y++) set.add(x + ',' + y);
  }
  return set;
}

function iou(a, b) {
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const c of small) if (big.has(c)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

// 重なりの大きい組から順に対応づける。部屋の数は多くて十数なので、これで足りる。
function matchRooms(truth, read) {
  const pairs = [];
  truth.forEach((t, i) => read.forEach((r, j) => {
    const v = iou(t.cells, r.cells);
    if (v >= ROOM_MIN_IOU) pairs.push({ i, j, v });
  }));
  pairs.sort((a, b) => b.v - a.v);
  const ti = new Set(), rj = new Set(), out = [];
  for (const p of pairs) {
    if (ti.has(p.i) || rj.has(p.j)) continue;
    ti.add(p.i); rj.add(p.j); out.push(p);
  }
  return out;
}

function scoreRooms(truthPlan, readPlan, floor, dx, dy) {
  const truth = roomGroups(truthPlan.rooms, floor, 0, 0);
  const read = roomGroups(readPlan.rooms, floor, dx, dy);
  const matched = matchRooms(truth, read);
  const area = (g) => g.cells.size * CELL_MM * CELL_MM / 1e6;
  const detail = truth.map((t, i) => {
    const m = matched.find((p) => p.i === i);
    if (!m) return { truth: t.name, read: null, truthArea: round2(area(t)), readArea: null, iou: 0, name: 0, area: 0 };
    const r = read[m.j];
    const at = area(t), ar = area(r);
    return {
      truth: t.name, read: r.name, truthArea: round2(at), readArea: round2(ar), iou: round2(m.v),
      name: nameScore(t.name, r.name),
      area: at > 0 ? clamp01(1 - Math.abs(at - ar) / at) : 0,
    };
  });
  const recall = truth.length ? matched.length / truth.length : (read.length ? 0 : 1);
  const precision = read.length ? matched.length / read.length : (truth.length ? 0 : 1);
  const mean = (k) => (detail.length ? detail.reduce((n, d) => n + d[k], 0) / detail.length : (read.length ? 0 : 1));
  const count = f1(precision, recall);
  const name = mean('name');
  const areaScore = mean('area');
  return {
    score: (count + name + areaScore) / 3,
    count, name, area: areaScore,
    truthCount: truth.length, readCount: read.length, matched: matched.length,
    extra: read.filter((_, j) => !matched.some((p) => p.j === j)).map((r) => r.name),
    detail,
  };
}

// ── 壁 ──────────────────────────────────────────────────────────────
function wallSegs(walls, floor, dx, dy) {
  return (walls || []).filter((w) => w && floorOf(w) === floor).map((w) => {
    const x1 = num(w.x1) + dx, y1 = num(w.y1) + dy, x2 = num(w.x2) + dx, y2 = num(w.y2) + dy;
    const len = Math.hypot(x2 - x1, y2 - y1);
    return { x1, y1, x2, y2, len, ux: len ? (x2 - x1) / len : 0, uy: len ? (y2 - y1) / len : 0 };
  }).filter((s) => s.len > 1);
}

function distToSeg(px, py, s) {
  const t = clamp01(((px - s.x1) * s.ux + (py - s.y1) * s.uy) / s.len);
  return Math.hypot(px - (s.x1 + s.ux * s.len * t), py - (s.y1 + s.uy * s.len * t));
}

// a の壁を点に分け、b の平行な壁が tol 以内にある点の長さを数える。
function coverage(a, b, tol) {
  let total = 0, covered = 0, err = 0;
  for (const s of a) {
    const n = Math.max(1, Math.round(s.len / WALL_STEP_MM));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = s.x1 + s.ux * s.len * t, py = s.y1 + s.uy * s.len * t;
      let best = Infinity;
      for (const o of b) {
        if (Math.abs(s.ux * o.ux + s.uy * o.uy) < 0.985) continue;   // 平行（約10°以内）だけ
        const d = distToSeg(px, py, o);
        if (d < best) best = d;
      }
      total += s.len / n;
      if (best <= tol) { covered += s.len / n; err += best * s.len / n; }
    }
  }
  return { total, covered, ratio: total > 0 ? covered / total : (b.length ? 0 : 1), meanErr: covered > 0 ? err / covered : null };
}

function scoreWalls(truthPlan, readPlan, floor, dx, dy, tol = WALL_TOL_MM) {
  const t = wallSegs(truthPlan.walls, floor, 0, 0);
  const r = wallSegs(readPlan.walls, floor, dx, dy);
  const rec = coverage(t, r, tol);
  const pre = coverage(r, t, tol);
  return {
    score: f1(pre.ratio, rec.ratio),
    recall: rec.ratio, precision: pre.ratio,
    truthLength: Math.round(rec.total), readLength: Math.round(pre.total),
    meanOffsetMm: rec.meanErr == null ? null : Math.round(rec.meanErr),
  };
}

// ── 建具 ────────────────────────────────────────────────────────────
//
// 窓どうし・扉どうしで対応づける（窓を扉と読んだものは当たりにしない）。
// 種類まで一致したか（引き戸を開き戸と読んでいないか）は別に数える。
function openingGroup(type) {
  const t = String(type || '');
  if (t === 'window' || t === 'window-door' || /^original-window/.test(t)) return 'window';
  if (/^door-/.test(t)) return 'door';
  return '';
}

function openings(items, floor, dx, dy) {
  return (items || []).filter((it) => it && floorOf(it) === floor && openingGroup(it.type)).map((it) => ({
    type: it.type, group: openingGroup(it.type),
    cx: num(it.x) + num(it.w) / 2 + dx, cy: num(it.y) + num(it.d) / 2 + dy,
  }));
}

function scoreOpenings(truthPlan, readPlan, floor, dx, dy) {
  const t = openings(truthPlan.items, floor, 0, 0);
  const r = openings(readPlan.items, floor, dx, dy);
  const pairs = [];
  t.forEach((a, i) => r.forEach((b, j) => {
    if (a.group !== b.group) return;
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    if (d <= OPENING_TOL_MM) pairs.push({ i, j, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const ti = new Set(), rj = new Set(), matched = [];
  for (const p of pairs) {
    if (ti.has(p.i) || rj.has(p.j)) continue;
    ti.add(p.i); rj.add(p.j); matched.push(p);
  }
  const recall = t.length ? matched.length / t.length : (r.length ? 0 : 1);
  const precision = r.length ? matched.length / r.length : (t.length ? 0 : 1);
  const count = f1(precision, recall);
  // 位置の点は、正解の建具ごとに「近いほど1、外れたら0」を平均する。取りこぼしも0になる。
  const position = t.length
    ? matched.reduce((n, p) => n + (1 - p.d / OPENING_TOL_MM), 0) / t.length
    : (r.length ? 0 : 1);
  const sameType = matched.filter((p) => t[p.i].type === r[p.j].type).length;
  return {
    score: (count + position) / 2,
    count, position,
    truthCount: t.length, readCount: r.length, matched: matched.length,
    typeMatch: matched.length ? sameType / matched.length : null,
    meanOffsetMm: matched.length ? Math.round(matched.reduce((n, p) => n + p.d, 0) / matched.length) : null,
    missing: t.filter((_, i) => !ti.has(i)).map((o) => `${o.type}@(${Math.round(o.cx)},${Math.round(o.cy)})`),
    extra: r.filter((_, j) => !rj.has(j)).map((o) => `${o.type}@(${Math.round(o.cx)},${Math.round(o.cy)})`),
  };
}

// ── 原点合わせ ──────────────────────────────────────────────────────
//
// 読み取りの原点は図面ごと・モデルごとにまちまちで、取り込み先に間取りがあれば
// 右隣へずらして建てられる。ずれたまま比べると全部外れになるので、
// 壁の点数がいちばん高くなる平行移動を探す。候補は各階の外形の四隅を
// 重ねる移動と、その周り ±200mm。
function floorsIn(plan) {
  const s = new Set();
  for (const k of ['walls', 'rooms', 'items']) for (const o of plan[k] || []) s.add(floorOf(o));
  return [...s].sort((a, b) => a - b);
}

function wallBox(walls, floor) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls || []) {
    if (!w || floorOf(w) !== floor) continue;
    x0 = Math.min(x0, num(w.x1), num(w.x2)); x1 = Math.max(x1, num(w.x1), num(w.x2));
    y0 = Math.min(y0, num(w.y1), num(w.y2)); y1 = Math.max(y1, num(w.y1), num(w.y2));
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

function findOffset(truth, read, floors) {
  const cands = new Map();
  const add = (dx, dy) => cands.set(Math.round(dx) + ',' + Math.round(dy), [Math.round(dx), Math.round(dy)]);
  add(0, 0);
  for (const f of floors) {
    const a = wallBox(truth.walls, f), b = wallBox(read.walls, f);
    if (!a || !b) continue;
    add(a.x0 - b.x0, a.y0 - b.y0); add(a.x1 - b.x1, a.y1 - b.y1);
    add(a.x0 - b.x0, a.y1 - b.y1); add(a.x1 - b.x1, a.y0 - b.y0);
  }
  const wallsAt = (dx, dy) => floors.reduce((n, f) => {
    const w = scoreWalls(truth, read, f, dx, dy);
    return n + w.score * Math.max(1, w.truthLength);
  }, 0);
  let best = [0, 0], bestV = -1;
  for (const [dx, dy] of cands.values()) {
    const v = wallsAt(dx, dy);
    if (v > bestV) { bestV = v; best = [dx, dy]; }
  }
  for (const step of [100, 50, 25]) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [ex, ey] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const v = wallsAt(best[0] + ex, best[1] + ey);
        if (v > bestV + 1e-9) { bestV = v; best = [best[0] + ex, best[1] + ey]; moved = true; }
      }
    }
  }
  return { dx: best[0], dy: best[1] };
}

// ── 全体 ────────────────────────────────────────────────────────────
function scorePlan(truth, read, options = {}) {
  const floors = floorsIn(truth).filter((f) => (truth.walls || []).some((w) => floorOf(w) === f));
  const offset = options.offset || findOffset(truth, read, floors);
  const perFloor = floors.map((f) => {
    const walls = scoreWalls(truth, read, f, offset.dx, offset.dy);
    const strict = scoreWalls(truth, read, f, offset.dx, offset.dy, WALL_TOL_STRICT_MM);
    const rooms = scoreRooms(truth, read, f, offset.dx, offset.dy);
    const opens = scoreOpenings(truth, read, f, offset.dx, offset.dy);
    const total = WEIGHTS.walls * walls.score + WEIGHTS.rooms * rooms.score + WEIGHTS.openings * opens.score;
    return { floor: f, total, walls: { ...walls, strict: strict.score }, rooms, openings: opens };
  });
  const avg = (pick) => (perFloor.length ? perFloor.reduce((n, p) => n + pick(p), 0) / perFloor.length : 0);
  const extraFloors = floorsIn(read).filter((f) => !floors.includes(f) && (read.walls || []).some((w) => floorOf(w) === f));
  return {
    total: round1(100 * avg((p) => p.total)),
    walls: round1(100 * avg((p) => p.walls.score)),
    rooms: round1(100 * avg((p) => p.rooms.score)),
    openings: round1(100 * avg((p) => p.openings.score)),
    offset, extraFloors, floors: perFloor,
  };
}

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
const pct = (v) => (v == null ? '-' : Math.round(v * 100) + '%');

// 人が読む形。点数の内訳と、外れたものの一覧。
function formatReport(r) {
  const lines = [];
  lines.push(`総合 ${r.total} 点（壁 ${r.walls} / 部屋 ${r.rooms} / 建具 ${r.openings}）  原点のずれ ${r.offset.dx},${r.offset.dy}mm`);
  if (r.extraFloors.length) lines.push(`  正解に無い階を読んでいる: ${r.extraFloors.join(', ')}階`);
  for (const f of r.floors) {
    lines.push(`■ ${f.floor}階  ${round1(100 * f.total)} 点`);
    lines.push(`  壁   ${round1(100 * f.walls.score)}  取りこぼし無し ${pct(f.walls.recall)} / 余計な壁無し ${pct(f.walls.precision)}`
      + ` / 芯のずれ平均 ${f.walls.meanOffsetMm == null ? '-' : f.walls.meanOffsetMm + 'mm'} / 50mm以内で ${round1(100 * f.walls.strict)}`);
    lines.push(`  部屋 ${round1(100 * f.rooms.score)}  数 ${f.rooms.readCount}/${f.rooms.truthCount}（対応 ${f.rooms.matched}）`
      + ` 数の点 ${pct(f.rooms.count)} / 名前 ${pct(f.rooms.name)} / 面積 ${pct(f.rooms.area)}`);
    for (const d of f.rooms.detail) {
      lines.push(d.read == null
        ? `    ✗ ${d.truth}（${d.truthArea}㎡）が読めていない`
        : `    ${d.name === 1 ? '○' : d.name ? '△' : '✗'} ${d.truth} ← ${d.read || '(名前なし)'}  ${d.truthArea}㎡ ← ${d.readArea}㎡`);
    }
    if (f.rooms.extra.length) lines.push(`    余計な部屋: ${f.rooms.extra.map((n) => n || '(名前なし)').join('、')}`);
    lines.push(`  建具 ${round1(100 * f.openings.score)}  数 ${f.openings.readCount}/${f.openings.truthCount}（対応 ${f.openings.matched}）`
      + ` 位置 ${pct(f.openings.position)} / 種類まで一致 ${pct(f.openings.typeMatch)} / ずれ平均 ${f.openings.meanOffsetMm == null ? '-' : f.openings.meanOffsetMm + 'mm'}`);
    if (f.openings.missing.length) lines.push(`    読めていない: ${f.openings.missing.join('、')}`);
    if (f.openings.extra.length) lines.push(`    余計: ${f.openings.extra.join('、')}`);
  }
  return lines.join('\n');
}

module.exports = { scorePlan, formatReport, normalizeName, nameScore, roomKind, WEIGHTS };

if (require.main === module) {
  const fs = require('node:fs');
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length < 2) {
    console.error('使い方: node tools/plan-eval/score.cjs <正解.json> <読み取り.json> [--json]');
    process.exit(1);
  }
  const truth = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  const read = JSON.parse(fs.readFileSync(files[1], 'utf8'));
  const result = scorePlan(truth, read.plan || read);
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : formatReport(result));
}
