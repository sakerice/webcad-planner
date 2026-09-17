// 出力の形を、指示文でお願いするのではなく通信の設定で縛れているか。
//
// なぜ在るのか
// ------------
// 形をプロンプトの本文に書いていた頃、実測で位置の項目名が box_2d から box へ
// 勝手に変わって返った。お願いは破られる。responseSchema なら API の制約になる。
//
// もうひとつ、**形の説明が本文に戻ってこないこと**を見張る。本文と schema の
// 両方に書くと、片方だけ直したときに食い違い、どちらが正か分からなくなる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('階ごとの入れ子で返させる（読み取りの手順と同じ形）', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  assert.equal(s.type, 'OBJECT');
  const floors = s.properties.floors;
  assert.equal(floors.type, 'ARRAY');
  const f = floors.items.properties;
  for (const k of ['floor', 'dims', 'walls', 'labels', 'items']) {
    assert.ok(f[k], `階の中に ${k} が無い`);
  }
  assert.deepEqual(floors.items.required, ['floor', 'walls'],
    '階と壁は必須。どちらが欠けても家にならない');
});

test('使える種類は enum で縛る（知らない名前は返せない）', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const { ALLOWED_ITEM_TYPES } = await mod('worker/plan-item-spec.mjs');
  const item = s.properties.floors.items.properties.items.items;
  assert.deepEqual(item.properties.type.enum, ALLOWED_ITEM_TYPES,
    '種類の一覧が仕様とずれている');
});

test('項目の意味は schema の側に書く', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const f = s.properties.floors.items.properties;
  // 中心か左上の角か。ここを取り違えると開口が半分ぶんずれる(実測で845mm)。
  assert.match(f.items.items.properties.x.description, /中心/);
  // 壁は芯線。外形の寸法線は芯々。
  assert.match(f.walls.items.description, /芯/);
  // 室名は位置だけ。範囲はアプリが壁から計算する。
  assert.match(f.labels.description, /範囲は出さない/);
  // 内訳の合計は総寸法と一致すること。
  assert.match(f.dims.properties.top.properties.parts.description, /合計/);
});

test('部屋はAIに出させない（壁から計算する）', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const f = s.properties.floors.items.properties;
  assert.ok(!f.rooms, '部屋を出させようとしている。壁と食い違うと直しようがない');
});

test('形の説明が指示文の本文に戻ってきていない', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 「こういうJSONで返して」という例示は schema の仕事。
  assert.ok(!/"walls"\s*:\s*\[\s*\{/.test(p), '本文にJSONの例が戻っている');
  assert.ok(!/"x1"\s*:/.test(p), '本文に項目名の羅列が戻っている');
});

test('送信時に responseSchema を渡している', async () => {
  const { readFileSync } = require('node:fs');
  for (const f of ['worker/routes-ai.mjs', 'tools/probe_vertex.cjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /responseSchema:\s*PLAN_RESPONSE_SCHEMA/,
      `${f} が形を縛らずに送っている`);
  }
  const vertex = readFileSync(join(ROOT, 'worker', 'vertex.mjs'), 'utf8');
  assert.match(vertex, /responseSchema/, 'vertex.mjs が responseSchema を受けていない');
});

// ── 返ってきたものを受ける側 ────────────────────────────────────────
//
// 形を縛っても、受ける側が古い形しか知らなければ意味がない。逆に、
// 縛る前に保存した結果や、schema を外して試したときの平らな形も読めること。

test('階ごとの入れ子を、階つきの平らな並びに開く', async () => {
  const { decodeCompactPlan } = await mod('worker/plan-prompt.mjs');
  const out = decodeCompactPlan({
    floors: [
      { floor: 1, walls: [{ x1: 0, y1: 0, x2: 7280, y2: 0 }], labels: [{ text: '洋室', x: 100, y: 100 }],
        items: [{ type: 'stair', x: 3000, y: 2000, w: 910 }] },
      { floor: 2, walls: [{ x1: 0, y1: 0, x2: 7280, y2: 0 }] },
    ],
    notes: ['下辺の内訳が1つ欠けていたので差から補った'],
  });
  assert.equal(out.walls.length, 2);
  assert.deepEqual(out.walls.map((w) => w.floor), [1, 2], '階が1件ずつに配られていない');
  assert.equal(out.labels[0].floor, 1);
  assert.equal(out.items[0].floor, 1);
  assert.equal(out.notes.length, 1);
});

test('1件ずつが自分で階を持っていれば、そちらを尊重する', async () => {
  const { decodeCompactPlan } = await mod('worker/plan-prompt.mjs');
  const out = decodeCompactPlan({
    floors: [{ floor: 1, walls: [{ x1: 0, y1: 0, x2: 10, y2: 0, floor: 3 }] }],
  });
  assert.equal(out.walls[0].floor, 3);
});

test('古い平らな形も読める', async () => {
  const { decodeCompactPlan } = await mod('worker/plan-prompt.mjs');
  const out = decodeCompactPlan({
    walls: [{ x1: 0, y1: 0, x2: 10, y2: 0, floor: 1 }],
    labels: [{ text: '浴室', x: 1, y: 2, floor: 1 }],
    items: [{ type: 'window', x: 5, y: 0, w: 1650, floor: 1 }],
    notes: ['ふるい形'],
  });
  assert.equal(out.walls.length, 1);
  assert.equal(out.labels.length, 1);
  assert.equal(out.items.length, 1);
});

test('壊れたものを渡しても落ちない', async () => {
  const { decodeCompactPlan } = await mod('worker/plan-prompt.mjs');
  for (const bad of [null, undefined, 'abc', 42, [], {}, { floors: null }, { floors: [null, 3] }]) {
    const out = decodeCompactPlan(bad);
    assert.ok(Array.isArray(out.walls), `${JSON.stringify(bad)} で壊れた`);
  }
});
