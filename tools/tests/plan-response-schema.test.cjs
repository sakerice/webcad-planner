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
  for (const k of ['floor', 'dims', 'width', 'depth', 'rooms', 'items']) {
    assert.ok(f[k], `階の中に ${k} が無い`);
  }
  assert.deepEqual(floors.items.required, ['floor', 'width', 'depth', 'rooms'],
    '階・大きさ・部屋は必須。どれが欠けても家にならない');
});

test('使える種類は enum で縛る（知らない名前は返せない）', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const { ALLOWED_ITEM_TYPES } = await mod('worker/plan-item-spec.mjs');
  const item = s.properties.floors.items.properties.items.items;
  assert.deepEqual(item.properties.type.enum, ALLOWED_ITEM_TYPES,
    '種類の一覧が仕様とずれている');
});

test('schema が持つのは形だけ（意味は仕様書、段取りは手順）', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.description === 'string') {
      assert.ok(node.description.length <= 24,
        path + ' の説明が長い（' + node.description.length + '文字）。意味は仕様書の側へ');
      for (const w of ['227.5', 'こと', 'ない。', '**']) {
        assert.ok(!node.description.includes(w),
          path + ' の説明に「' + w + '」が入っている。決まりや助言は schema の外へ');
      }
    }
    if (node.properties) for (const k of Object.keys(node.properties)) walk(node.properties[k], path + '.' + k);
    if (node.items) walk(node.items, path + '[]');
  };
  walk(s, '');
});

test('壁はAIに出させない（部屋の境目から作る）', async () => {
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const f = s.properties.floors.items.properties;
  assert.ok(!f.walls, '壁を出させようとしている。部屋と食い違うと直しようがない');
  assert.ok(f.rooms, '部屋が無い');
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
      { floor: 1, width: 7280, depth: 4095,
        rooms: [{ name: '洋室', parts: [{ x0: 0, y0: 0, x1: 3185, y1: 1365 }] }],
        items: [{ type: 'stair', x: 3000, y: 2000, w: 910 }] },
      { floor: 2, width: 7280, depth: 4095, rooms: [] },
    ],
    notes: ['下辺の内訳が1つ欠けていた'],
  });
  assert.equal(out.floors.length, 2);
  assert.deepEqual(out.floors.map((f) => f.floor), [1, 2]);
  assert.equal(out.floors[0].width, 7280);
  assert.equal(out.floors[0].rooms.length, 1);
  assert.equal(out.items[0].floor, 1, '階が1件ずつに配られていない');
  assert.equal(out.notes.length, 1);
});

test('1件ずつが自分で階を持っていれば、そちらを尊重する', async () => {
  const { decodeCompactPlan } = await mod('worker/plan-prompt.mjs');
  const out = decodeCompactPlan({
    floors: [{ floor: 1, width: 10, depth: 10, rooms: [], items: [{ type: 'window', x: 1, y: 0, w: 900, floor: 3 }] }],
  });
  assert.equal(out.items[0].floor, 3);
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
