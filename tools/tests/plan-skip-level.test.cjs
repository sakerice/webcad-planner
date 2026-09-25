// スキップフロアを取り込む。
//
// なぜ在るのか
// ------------
// アプリは前から `room.skipLevelMm`（その区画ごと床も天井も持ち上がる段差、
// 上限2400mm）を持っていて、段差の下を空間として扱う仕組みまである。
// **段差の下の空間こそが「ハーフ収納」「床上げ収納」であり、提供された
// 実物の図面にどちらも出てくる。** ところが読み取りの側に段差を書く欄が
// 無かったので、スキップフロアのある家は平らな家として取り込まれていた。
//
// ここが落ちると、その欄が黙って捨てられるようになる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import('file://' + join(ROOT, rel));

/** ホール＋段の上がった区画、ひと組。 */
function twoRooms(level) {
  const room = { name: 'スキップ', parts: [{ x0: 1820, y0: 0, x1: 3640, y1: 1820 }] };
  if (level !== undefined) room.level = level;
  return {
    floors: [{
      floor: 2, width: 3640, depth: 1820,
      rooms: [{ name: 'ホール', parts: [{ x0: 0, y0: 0, x1: 1820, y1: 1820 }] }, room],
    }],
  };
}

async function build(parsed) {
  const { finishImportedPlan } = await mod('worker/routes-ai.mjs');
  const body = await finishImportedPlan(parsed, null, {}).json();
  assert.ok(body.plan, body.message || '取り込めていない');
  return body.plan;
}

test('段差が、アプリのスキップフロアの欄に入る', async () => {
  const rooms = (await build(twoRooms(900))).rooms;
  const skip = rooms.find((r) => r.n === 'スキップ');
  assert.equal(skip.skipLevelMm, 900);
});

test('段の無い部屋には、欄そのものを持たせない', async () => {
  // **0 を全部屋に書かない。** この欄を持たない既存プランと形が変わる。
  const rooms = (await build(twoRooms(900))).rooms;
  const hall = rooms.find((r) => r.n === 'ホール');
  assert.equal('skipLevelMm' in hall, false, '段の無い部屋が欄を持っている');
  // level を書かなかった場合も同じ
  const plain = (await build(twoRooms())).rooms.find((r) => r.n === 'スキップ');
  assert.equal('skipLevelMm' in plain, false);
});

test('段差の上限が、アプリと揃っている', async () => {
  // ずれると、読み取りが通した段をアプリが黙って切り詰める。
  const app = readFileSync(join(ROOT, 'assets/js/app-constants.js'), 'utf8');
  const m = /var SKIP_LEVEL_MAX_MM\s*=\s*(\d+)/.exec(app);
  assert.ok(m, 'アプリ側の上限が読めない');
  const rooms = (await build(twoRooms(99999))).rooms;
  assert.equal(rooms.find((r) => r.n === 'スキップ').skipLevelMm, Number(m[1]));
});

test('読み取りの返事の形に、段差の欄がある', async () => {
  const { PLAN_RESPONSE_SCHEMA } = await mod('worker/plan-response-schema.mjs');
  const room = PLAN_RESPONSE_SCHEMA.properties.floors.items.properties.rooms.items;
  assert.ok(room.properties.level, '返事の形に level が無い');
  assert.ok(room.propertyOrdering.includes('level'));
});

test('仕様書と手順の両方に書いてある', async () => {
  // 形(schema)・意味(仕様書)・段取り(手順)の三者に役割を分けている決まり。
  const { planSpec } = await mod('worker/plan-spec.mjs');
  const { planProcedure } = await mod('worker/plan-prompt.mjs');
  assert.match(planSpec(), /level/);
  assert.match(planSpec(), /ハーフ収納/, '段の下が収納になる話が仕様書に無い');
  assert.match(planProcedure(), /level/);
});

test('画面側も、段差を持ったまま組み立てる', () => {
  // toAppObjects が欄を落とすと、3Dは平らなままになる。
  const src = readFileSync(join(ROOT, 'assets/js/plan-import.js'), 'utf8');
  assert.match(src, /made\.skipLevelMm = r\.skipLevelMm/,
    'toAppObjects がスキップフロアを引き継いでいない');
});
