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
//   建具 … 数と位置。窓・扉ごとに、中心の近いものを対応づける。開き戸・折戸・玄関ドアは
//          吊り元の端と開く側（方角）も比べる。
//   階段 … 部材（直進・廻り）の位置と、上る向き（廻り部は抜ける向き）。
//   家具・設備・外構 … 種類（tags.json の kind）ごとに中心の近いものを対応づけ、数・位置・
//          正面の向きを比べる（外構は数と位置）。
//
// 総合は、正解にその項目がある階だけで重みを配り直した平均。家具まで含めた総合とは別に、
// 壁・部屋・建具（数と位置）だけの「骨組み」の点も出す（2026-10-17 の測定と比べるため）。
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
const OBJECT_TOL_MM = 700;    // 家具・設備・階段の中心がこれ以内（大きい物は幅の6割まで）なら同じ物
const EXTERIOR_TOL_MM = 1000;
const WEIGHTS = { walls: 0.25, rooms: 0.2, openings: 0.2, stairs: 0.1, fixtures: 0.1, furniture: 0.1, exterior: 0.05 };
// 2026-10-17 の測定（壁・部屋・建具だけ）と同じ物差し。
const CORE_WEIGHTS = { walls: 0.4, rooms: 0.3, openings: 0.3 };

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

function openings(items, floor, dx, dy, walls) {
  return (items || []).filter((it) => it && floorOf(it) === floor && openingGroup(it.type)).map((it) => {
    const cx = num(it.x) + num(it.w) / 2, cy = num(it.y) + num(it.d) / 2;
    return { type: it.type, group: openingGroup(it.type), cx: cx + dx, cy: cy + dy, swing: swingOf(it, cx, cy, walls, floor) };
  });
}

// 開き戸・折戸・玄関ドアの「吊り元の端」と「開く側」を、壁の向きによらない方角のベクトルにする。
// アプリは建具を 400mm 以内の最寄りの壁に吸い付け、その壁の始点→終点をローカルの +x とする
// （assets/js/draw-2d.js）。開き戸は flipX=false で吊り元が -x 端、flipY=false で弧が +y（進行方向の
// 右手）側。折戸は山形の出る側が逆（flipY=false で -y 側）。
const SWING_TYPES = /^(door-swing|door-front|door-fold)/;
function swingOf(it, cx, cy, walls, floor) {
  if (!SWING_TYPES.test(String(it.type || ''))) return null;
  let best = null;
  for (const w of walls || []) {
    if (!w || floorOf(w) !== floor) continue;
    const x1 = num(w.x1), y1 = num(w.y1), x2 = num(w.x2), y2 = num(w.y2);
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L < 1) continue;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const t = clamp01(((cx - x1) * ux + (cy - y1) * uy) / L) * L;
    const d = Math.hypot(cx - x1 - ux * t, cy - y1 - uy * t);
    if (d <= 400 && (!best || d < best.d)) best = { d, ux, uy };
  }
  if (!best) return null;
  const { ux, uy } = best, nx = -uy, ny = ux;
  const fold = /^door-fold/.test(it.type);
  const hs = it.flipX ? 1 : -1;
  const os = fold ? (it.flipY ? 1 : -1) : (it.flipY ? -1 : 1);
  return { hinge: [ux * hs, uy * hs], opens: [nx * os, ny * os] };
}
const agree = (a, b) => a[0] * b[0] + a[1] * b[1] > 0.7;

function scoreOpenings(truthPlan, readPlan, floor, dx, dy) {
  const t = openings(truthPlan.items, floor, 0, 0, truthPlan.walls);
  const r = openings(readPlan.items, floor, dx, dy, readPlan.walls);
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
  // 向き: 正解の開き戸ごとに、吊り元の端と開く側が合えば各半分。取りこぼしと、開き戸でない物に
  // 読んだもの（向きを持たない）は0。
  const swingers = t.map((o, i) => ({ o, i })).filter((x) => x.o.swing);
  const swing = swingers.length ? swingers.reduce((n, { o, i }) => {
    const m = matched.find((p) => p.i === i);
    const rs = m && r[m.j].swing;
    if (!rs) return n;
    return n + (agree(o.swing.hinge, rs.hinge) ? 0.5 : 0) + (agree(o.swing.opens, rs.opens) ? 0.5 : 0);
  }, 0) / swingers.length : null;
  return {
    score: swing == null ? (count + position) / 2 : (count + position + swing) / 3,
    core: (count + position) / 2,
    count, position, swing, swingCount: swingers.length,
    truthCount: t.length, readCount: r.length, matched: matched.length,
    typeMatch: matched.length ? sameType / matched.length : null,
    meanOffsetMm: matched.length ? Math.round(matched.reduce((n, p) => n + p.d, 0) / matched.length) : null,
    missing: t.filter((_, i) => !ti.has(i)).map((o) => `${o.type}@(${Math.round(o.cx)},${Math.round(o.cy)})`),
    extra: r.filter((_, j) => !rj.has(j)).map((o) => `${o.type}@(${Math.round(o.cx)},${Math.round(o.cy)})`),
  };
}

// ── 物（家具・設備・外構・階段）の種類と向き ──────────────────────────
//
// 種類はカタログの分類（assets/models/tags.json の kind）を正にする。組み込みの type は
// ここで同じ語彙へ寄せる。どの区分にも入らない物は採点しない。
const BUILTIN_KIND = {
  bath: 'bathtub', toilet: 'toilet', sink: 'vanity', kitchen: 'kitchen-unit', washer: 'laundry',
  fridge: 'refrigerator', sofa: 'sofa', 'dining-table': 'dining-table', 'bed-s': 'bed', 'bed-d': 'bed',
  tv: 'tv', desk: 'desk', closet: 'closet', futon_set: 'bedding',
  ramp: 'ramp', 'exterior-stair': 'exterior-stair', balcony: 'balcony', fence: 'fence', 'wood-fence': 'fence',
  'lattice-screen': 'fence', tree: 'garden-plant',
};
const FIXTURE_KINDS = new Set(['bathtub', 'toilet', 'vanity', 'kitchen-unit', 'laundry', 'kitchen-sink', 'shower']);
const EXTERIOR_KINDS = new Set(['ramp', 'exterior-stair', 'balcony', 'fence', 'garden-plant', 'deck', 'gate-post', 'garden-equipment']);
const SKIP_KINDS = new Set(['light', 'curtain', 'roller-screen', 'hvac', 'utility-equipment', 'joinery-prop', 'other', 'wall-decor', 'decor']);
let TAGS = null;
function tagKind(type) {
  if (TAGS === null) {
    try { const t = require('../../assets/models/tags.json'); TAGS = t.items || t; } catch (e) { TAGS = {}; }
  }
  return (TAGS[type] && TAGS[type].kind) || '';
}
function objectClass(type) {
  const t = String(type || '');
  const kind = BUILTIN_KIND[t] || tagKind(t);
  if (!kind || SKIP_KINDS.has(kind)) return null;
  if (EXTERIOR_KINDS.has(kind)) return { group: 'exterior', kind };
  if (FIXTURE_KINDS.has(kind)) return { group: 'fixtures', kind };
  return { group: 'furniture', kind };
}

// 正面の向き（単位ベクトル）。tools/lint_plan.py の _front_dir と同じ決まり（rot=0 は北）。
function frontOf(it) {
  const canonical = it.type === 'washer' || it.modelFrontAxis === '+Z'
    || (it.modelFacingVersion === 1 && /^(fmp-|original-|im0261-)/.test(String(it.type || '')));
  const th = (num(it.rot) + (canonical ? 180 : 0)) * Math.PI / 180;
  return [Math.sin(th), -Math.cos(th)];
}

function objects(items, floor, group, dx, dy) {
  return (items || []).filter((it) => it && floorOf(it) === floor).map((it) => {
    const c = objectClass(it.type);
    if (!c || c.group !== group) return null;
    return { type: it.type, kind: c.kind, cx: num(it.x) + num(it.w) / 2 + dx, cy: num(it.y) + num(it.d) / 2 + dy,
      size: Math.max(num(it.w), num(it.d)), front: frontOf(it), memo: it.memo || '' };
  }).filter(Boolean);
}

// 同じ種類どうしを、近い順に対応づける。
function matchByDistance(t, r, same, tolOf) {
  const pairs = [];
  t.forEach((a, i) => r.forEach((b, j) => {
    if (!same(a, b)) return;
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const tol = tolOf(a);
    if (d <= tol) pairs.push({ i, j, d, tol });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const ti = new Set(), rj = new Set(), out = [];
  for (const p of pairs) {
    if (ti.has(p.i) || rj.has(p.j)) continue;
    ti.add(p.i); rj.add(p.j); out.push(p);
  }
  return out;
}

function scoreObjects(truthPlan, readPlan, floor, dx, dy, group) {
  const t = objects(truthPlan.items, floor, group, 0, 0);
  const r = objects(readPlan.items, floor, group, dx, dy);
  if (!t.length) return null;
  const tolBase = group === 'exterior' ? EXTERIOR_TOL_MM : OBJECT_TOL_MM;
  const matched = matchByDistance(t, r, (a, b) => a.kind === b.kind, (a) => Math.max(tolBase, 0.6 * a.size));
  const recall = matched.length / t.length;
  const precision = r.length ? matched.length / r.length : 0;
  const count = f1(precision, recall);
  const position = matched.reduce((n, p) => n + (1 - p.d / p.tol), 0) / t.length;
  const facing = matched.reduce((n, p) => n + (agree(t[p.i].front, r[p.j].front) ? 1 : 0), 0) / t.length;
  const score = group === 'exterior' ? (count + position) / 2 : (count + position + facing) / 3;
  const label = (o) => `${o.memo || o.kind}@(${Math.round(o.cx)},${Math.round(o.cy)})`;
  return {
    score, count, position, facing: group === 'exterior' ? null : facing,
    truthCount: t.length, readCount: r.length, matched: matched.length,
    missing: t.filter((_, i) => !matched.some((p) => p.i === i)).map(label),
    extra: r.filter((_, j) => !matched.some((p) => p.j === j)).map(label),
    wrongFacing: group === 'exterior' ? [] : matched.filter((p) => !agree(t[p.i].front, r[p.j].front)).map((p) => label(t[p.i])),
  };
}

// 階段: 直進部は上る向き、廻り部は抜ける向き（アプリの決まり: 直進は +d へ上る、廻りは +d 辺から
// 入って +w 辺へ抜ける。flipY・flipX で反転。index.html の階段のつながり）。
function stairParts(items, floor, dx, dy) {
  return (items || []).filter((it) => it && floorOf(it) === floor && /^stair(-corner|-landing)?$/.test(String(it.type || ''))).map((it) => {
    const th = num(it.rot) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const local = (x, y) => [x * c - y * s, x * s + y * c];    // 画面で時計回りの回転
    let dir = null;
    if (it.type === 'stair') dir = local(0, it.flipY ? -1 : 1);
    else if (it.type === 'stair-corner') dir = local(it.flipX ? -1 : 1, 0);
    return { type: it.type, cx: num(it.x) + num(it.w) / 2 + dx, cy: num(it.y) + num(it.d) / 2 + dy, dir, memo: it.memo || '' };
  });
}

function scoreStairs(truthPlan, readPlan, floor, dx, dy) {
  const t = stairParts(truthPlan.items, floor, 0, 0);
  const r = stairParts(readPlan.items, floor, dx, dy);
  if (!t.length) return null;
  const matched = matchByDistance(t, r, () => true, () => OBJECT_TOL_MM);
  const recall = matched.length / t.length;
  const precision = r.length ? matched.length / r.length : 0;
  const count = f1(precision, recall);
  const position = matched.reduce((n, p) => n + (1 - p.d / p.tol), 0) / t.length;
  const direction = matched.reduce((n, p) => {
    const a = t[p.i], b = r[p.j];
    return n + (a.type === b.type && a.dir && b.dir && agree(a.dir, b.dir) ? 1 : 0);
  }, 0) / t.length;
  const label = (o) => `${o.memo || o.type}@(${Math.round(o.cx)},${Math.round(o.cy)})`;
  return {
    score: (count + position + direction) / 3, count, position, direction,
    truthCount: t.length, readCount: r.length, matched: matched.length,
    missing: t.filter((_, i) => !matched.some((p) => p.i === i)).map(label),
    wrongDirection: matched.filter((p) => !(t[p.i].type === r[p.j].type && t[p.i].dir && r[p.j].dir && agree(t[p.i].dir, r[p.j].dir))).map((p) => label(t[p.i])),
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
    const stairs = scoreStairs(truth, read, f, offset.dx, offset.dy);
    const fixtures = scoreObjects(truth, read, f, offset.dx, offset.dy, 'fixtures');
    const furniture = scoreObjects(truth, read, f, offset.dx, offset.dy, 'furniture');
    const exterior = scoreObjects(truth, read, f, offset.dx, offset.dy, 'exterior');
    // 正解にその項目が無い階では、その重みを残りに配り直す。
    const parts = { walls: walls.score, rooms: rooms.score, openings: opens.score,
      stairs: stairs && stairs.score, fixtures: fixtures && fixtures.score, furniture: furniture && furniture.score, exterior: exterior && exterior.score };
    let wsum = 0, total = 0;
    for (const k of Object.keys(WEIGHTS)) if (parts[k] != null) { wsum += WEIGHTS[k]; total += WEIGHTS[k] * parts[k]; }
    total = wsum ? total / wsum : 0;
    const core = CORE_WEIGHTS.walls * walls.score + CORE_WEIGHTS.rooms * rooms.score + CORE_WEIGHTS.openings * opens.core;
    return { floor: f, total, core, walls: { ...walls, strict: strict.score }, rooms, openings: opens, stairs, fixtures, furniture, exterior };
  });
  const avg = (pick) => (perFloor.length ? perFloor.reduce((n, p) => n + pick(p), 0) / perFloor.length : 0);
  // 正解にその項目がある階だけの平均。どの階にも無ければ null。
  const avgOf = (k) => {
    const xs = perFloor.map((p) => p[k]).filter(Boolean);
    return xs.length ? round1(100 * xs.reduce((n, x) => n + x.score, 0) / xs.length) : null;
  };
  const extraFloors = floorsIn(read).filter((f) => !floors.includes(f) && (read.walls || []).some((w) => floorOf(w) === f));
  return {
    total: round1(100 * avg((p) => p.total)),
    walls: round1(100 * avg((p) => p.walls.score)),
    rooms: round1(100 * avg((p) => p.rooms.score)),
    openings: round1(100 * avg((p) => p.openings.score)),
    stairs: avgOf('stairs'), fixtures: avgOf('fixtures'), furniture: avgOf('furniture'), exterior: avgOf('exterior'),
    core: round1(100 * avg((p) => p.core)),
    offset, extraFloors, floors: perFloor,
  };
}

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
const pct = (v) => (v == null ? '-' : Math.round(v * 100) + '%');

// 人が読む形。点数の内訳と、外れたものの一覧。
function formatReport(r) {
  const lines = [];
  const opt = (v) => (v == null ? '-' : v);
  lines.push(`総合 ${r.total} 点（壁 ${r.walls} / 部屋 ${r.rooms} / 建具 ${r.openings} / 階段 ${opt(r.stairs)} / 設備 ${opt(r.fixtures)}`
    + ` / 家具 ${opt(r.furniture)} / 外構 ${opt(r.exterior)}）  骨組みだけ ${r.core} 点  原点のずれ ${r.offset.dx},${r.offset.dy}mm`);
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
      + ` 位置 ${pct(f.openings.position)} / 種類まで一致 ${pct(f.openings.typeMatch)} / ずれ平均 ${f.openings.meanOffsetMm == null ? '-' : f.openings.meanOffsetMm + 'mm'}`
      + (f.openings.swing == null ? '' : ` / 開く向き ${pct(f.openings.swing)}（${f.openings.swingCount}枚）`));
    if (f.openings.missing.length) lines.push(`    読めていない: ${f.openings.missing.join('、')}`);
    if (f.openings.extra.length) lines.push(`    余計: ${f.openings.extra.join('、')}`);
    if (f.stairs) {
      lines.push(`  階段 ${round1(100 * f.stairs.score)}  部材 ${f.stairs.readCount}/${f.stairs.truthCount}（対応 ${f.stairs.matched}） 位置 ${pct(f.stairs.position)} / 上る向き ${pct(f.stairs.direction)}`);
      if (f.stairs.missing.length) lines.push(`    読めていない: ${f.stairs.missing.join('、')}`);
      if (f.stairs.wrongDirection.length) lines.push(`    向きが違う: ${f.stairs.wrongDirection.join('、')}`);
    }
    for (const [key, ja] of [['fixtures', '設備'], ['furniture', '家具'], ['exterior', '外構']]) {
      const o = f[key];
      if (!o) continue;
      lines.push(`  ${ja} ${round1(100 * o.score)}  数 ${o.readCount}/${o.truthCount}（対応 ${o.matched}） 位置 ${pct(o.position)}`
        + (o.facing == null ? '' : ` / 正面の向き ${pct(o.facing)}`));
      if (o.missing.length) lines.push(`    読めていない: ${o.missing.join('、')}`);
      if (o.extra.length) lines.push(`    余計: ${o.extra.join('、')}`);
      if (o.wrongFacing.length) lines.push(`    向きが違う: ${o.wrongFacing.join('、')}`);
    }
  }
  return lines.join('\n');
}

// 確認画面（tools/plan-eval/review.py）が、採点と同じ見方で向きを描くための注記。
function annotate(plan) {
  const out = {};
  for (const it of plan.items || []) {
    const f = floorOf(it), cx = num(it.x) + num(it.w) / 2, cy = num(it.y) + num(it.d) / 2;
    const c = objectClass(it.type);
    const st = stairParts([it], f, 0, 0)[0];
    out[it.id] = {
      group: c ? c.group : (openingGroup(it.type) || (st ? 'stairs' : '')),
      kind: c ? c.kind : '',
      front: c ? frontOf(it) : null,
      swing: swingOf(it, cx, cy, plan.walls, f),
      stairDir: st ? st.dir : null,
    };
  }
  return out;
}

module.exports = { annotate, scorePlan, formatReport, normalizeName, nameScore, roomKind, objectClass, frontOf, WEIGHTS, CORE_WEIGHTS };

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
