// plan-core/patch.js の単体テスト。共同編集で相手の変更(差分)を間取りに当てる関数。
// 画面(index.html の applySharedPatch)と Worker(worker/shared.mjs)が同じこの1つを使う。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const P = require('../../assets/js/plan-core/patch.js');

test('追加・更新・削除', () => {
  // worker-routes.test.cjs の「差分の当て方は元のまま」と同じ入力
  const plan = { walls: [{ id: 'a', x1: 0 }, { id: 'b', x1: 1 }], items: [], rooms: [], viewState: { z: 1 } };
  const out = P.applyPatch(plan, {
    collections: { walls: { upserts: [{ id: 'b', x1: 99 }, { id: 'c', x1: 3 }], removes: ['a'] } },
    fields: { northDeg: 90, viewState: { z: 9 } },
  });
  assert.equal(out, plan, 'その場で直したプランを返す');
  assert.deepEqual(plan.walls, [{ id: 'b', x1: 99 }, { id: 'c', x1: 3 }]);
  assert.equal(plan.northDeg, 90);
  assert.deepEqual(plan.viewState, { z: 1 });
});

test('fields の walls と viewState は書かない', () => {
  const plan = { walls: [{ id: 1 }], items: [], rooms: [], viewState: { z: 1 } };
  P.applyPatch(plan, { fields: { walls: [], items: [{ id: 9 }], rooms: null, viewState: { z: 2 } } });
  assert.deepEqual(plan.walls, [{ id: 1 }]);
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.rooms, []);
  assert.deepEqual(plan.viewState, { z: 1 });
});

test('SHARED_FIELDS に無い鍵も書く', () => {
  const plan = { walls: [], items: [], rooms: [] };
  P.applyPatch(plan, { fields: { somethingNew: 1 } });
  assert.equal(plan.somethingNew, 1);
});

test('upserts の null は無視する', () => {
  const plan = { walls: [{ id: 1, v: 0 }], items: [], rooms: [] };
  P.applyPatch(plan, { collections: { walls: { upserts: [null, { id: 2 }, undefined], removes: [] } } });
  assert.deepEqual(plan.walls, [{ id: 1, v: 0 }, { id: 2 }]);
});

test('removes と upserts に同じ id があれば入れ直す', () => {
  const plan = { walls: [{ id: 1, v: 0 }, { id: 2 }], items: [], rooms: [] };
  P.applyPatch(plan, { collections: { walls: { upserts: [{ id: 1, v: 5 }], removes: [1] } } });
  // 消してから末尾に足し直す(Worker の今の決まり)
  assert.deepEqual(plan.walls, [{ id: 2 }, { id: 1, v: 5 }]);
});

test('id は文字列と数を区別しない', () => {
  const plan = { walls: [{ id: 1, v: 0 }, { id: 2 }], items: [], rooms: [] };
  P.applyPatch(plan, { collections: { walls: { upserts: [{ id: 2, v: 1 }], removes: ['1'] } } });
  assert.deepEqual(plan.walls, [{ id: 2, v: 1 }]);
});

test('clone を渡すと、入れた物は差分の物と別の実体になる', () => {
  const plan = { walls: [], items: [], rooms: [] };
  const wall = { id: 1, _texObj: { big: true } };
  const settings = { a: 1 };
  const patch = { collections: { walls: { upserts: [wall], removes: [] } }, fields: { exteriorWallSettings: settings } };
  const clone = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === '_texObj' ? undefined : x)));
  P.applyPatch(plan, patch, { clone });
  assert.notEqual(plan.walls[0], wall);
  assert.deepEqual(plan.walls[0], { id: 1 });
  assert.notEqual(plan.exteriorWallSettings, settings);
  assert.deepEqual(plan.exteriorWallSettings, { a: 1 });
  // 渡さなければ同じ実体のまま(Worker の今の動き)
  const plan2 = { walls: [], items: [], rooms: [] };
  P.applyPatch(plan2, patch);
  assert.equal(plan2.walls[0], wall);
  assert.equal(plan2.exteriorWallSettings, settings);
});

test('clone を渡すと、欄の null はそのまま null で入る', () => {
  const plan = { walls: [], items: [], rooms: [], northDeg: 30 };
  P.applyPatch(plan, { fields: { northDeg: null } }, { clone: (v) => JSON.parse(JSON.stringify(v)) });
  assert.equal(plan.northDeg, null);
});

test('plan に配列が無ければ空の配列を作る', () => {
  const plan = {};
  P.applyPatch(plan, {});
  assert.deepEqual([plan.walls, plan.items, plan.rooms], [[], [], []]);
});

test('COLLECTIONS と SHARED_FIELDS', () => {
  assert.deepEqual(P.COLLECTIONS, ['walls', 'items', 'rooms']);
  for (const k of ['exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail', 'floorMetadata', 'northDeg']) {
    assert.ok(P.SHARED_FIELDS.includes(k), k + ' が SHARED_FIELDS に無い');
  }
  for (const k of ['viewState', 'planFixes', 'camStash', 'walls', 'items', 'rooms']) {
    assert.ok(!P.SHARED_FIELDS.includes(k), k + ' は共有しない');
  }
});

test('plan-core/patch.js はグローバルに触らない', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/plan-core/patch.js'), 'utf8')
    .replace(/\/\/.*$/gm, '');
  for (const name of ['DATA', 'ST', 'SHARED', 'document', 'window']) {
    assert.ok(!new RegExp('\\b' + name + '\\b').test(src), name + ' に触っている');
  }
});

test('画面と Worker が同じ関数を使っている', async () => {
  const worker = await import(pathToFileURL(path.join(ROOT, 'worker/shared.mjs')).href);
  assert.equal(worker.applyPatch, P.applyPatch, 'Worker の applyPatch が plan-core のものではない');
  assert.deepEqual(worker.COLLECTIONS, P.COLLECTIONS);

  // 配列を removes で作り直す自前の実装が、Worker にも画面にも残っていない
  const shared = fs.readFileSync(path.join(ROOT, 'worker/shared.mjs'), 'utf8');
  assert.ok(!/\.removes\b/.test(shared), 'worker/shared.mjs に差分の当て方が残っている');
  const { appSource } = require('./app-source.cjs');
  const app = appSource();
  const at = app.indexOf('\nfunction applySharedPatch(');
  assert.notEqual(at, -1);
  const body = app.slice(at, app.indexOf('\nfunction ', at + 1));
  assert.ok(body.includes('PlanCorePatch.applyPatch(DATA,patch,{clone:sharedClone})'), 'applySharedPatch が plan-core を通していない');
  assert.ok(!/\.removes\b/.test(body), 'applySharedPatch に差分の当て方が残っている');
  // 画面の共有の欄は plan-core の一覧そのもの
  assert.match(app, /\nvar SHARED_FIELDS=PlanCorePatch\.SHARED_FIELDS;/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="assets/js/plan-core/patch.js"></script>'));
});

test('高さの既定・階ごとの高さ・自動照明の設定も共有する', () => {
  for (const k of ['heightDefaults', 'floors', 'autoRoomLights']) assert.ok(P.SHARED_FIELDS.includes(k), k);
  const plan = { walls: [], items: [], rooms: [] };
  P.applyPatch(plan, { fields: { heightDefaults: { wallHeight: 2600, perFloor: false }, floors: { 2: { wallHeight: 2500 } }, autoRoomLights: false } });
  assert.deepEqual(plan.heightDefaults, { wallHeight: 2600, perFloor: false });
  assert.deepEqual(plan.floors, { 2: { wallHeight: 2500 } });
  assert.equal(plan.autoRoomLights, false);
});

test('新しく足した3つの欄は、null が届いたら欄を消す（前からある欄は null を書く）', () => {
  const plan = { walls: [], items: [], rooms: [], autoRoomLights: false, heightDefaults: {}, floors: {}, northDeg: 10 };
  P.applyPatch(plan, { fields: { autoRoomLights: null, heightDefaults: null, floors: null, northDeg: null } }, { clone: (v) => JSON.parse(JSON.stringify(v)) });
  assert.ok(!('autoRoomLights' in plan));
  assert.ok(!('heightDefaults' in plan));
  assert.ok(!('floors' in plan));
  assert.equal(plan.northDeg, null);
});

test('upserts の新しい物は、届いた順に末尾へ足す（id の大小で並べ替えない）', () => {
  const plan = { walls: [{ id: 5 }, { id: 'a' }], items: [], rooms: [] };
  P.applyPatch(plan, { collections: { walls: { upserts: [{ id: 'z' }, { id: 9 }, { id: 'a', v: 1 }, { id: 2 }], removes: [] } } });
  assert.deepEqual(plan.walls.map((w) => w.id), [5, 'a', 'z', 9, 2]);
  assert.equal(plan.walls[1].v, 1, '既にある物はその場で入れ替える');
});

// ── 形の合わない差分と危ない鍵(2026-11-19)。Worker が古い版で形を見ずに流してきても、受け手が壊れないこと ──
const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
const cleanProto = () => {
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(','), PROTO_NAMES);
  assert.equal({}.polluted, undefined);
};

test('fields の __proto__・constructor・prototype と Object.prototype の名前は書かない', () => {
  const plan = { walls: [], items: [], rooms: [] };
  const protoBefore = Object.getPrototypeOf(plan);
  P.applyPatch(plan, JSON.parse('{"fields":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"prototype":{"polluted":1},"hasOwnProperty":1,"toString":"x","northDeg":5}}'));
  assert.equal(Object.getPrototypeOf(plan), protoBefore, 'プランの継承元が変わった');
  assert.equal(plan.polluted, undefined);
  assert.equal(typeof plan.hasOwnProperty, 'function');
  assert.equal(typeof plan.toString, 'function');
  assert.ok(!Object.prototype.hasOwnProperty.call(plan, 'constructor'));
  assert.ok(!Object.prototype.hasOwnProperty.call(plan, 'prototype'));
  assert.equal(plan.northDeg, 5, '正当な欄は書く');
  cleanProto();
});

test('値のどこかに危ない鍵を含む物と欄は入れない', () => {
  const plan = { walls: [{ id: 1, v: 0 }], items: [], rooms: [] };
  P.applyPatch(plan, JSON.parse('{"collections":{"walls":{"upserts":[{"id":1,"v":1,"a":{"b":[{"__proto__":{"polluted":1}}]}},{"id":2,"constructor":{"prototype":{"polluted":1}}},{"id":3,"v":3}],"removes":[]}},"fields":{"exteriorWallSettings":{"walls":{"1":{"prototype":{}}}},"floors":{"1":{"wallHeight":2500}}}}'));
  assert.deepEqual(plan.walls, [{ id: 1, v: 0 }, { id: 3, v: 3 }]);
  assert.equal(plan.exteriorWallSettings, undefined);
  assert.deepEqual(plan.floors, { 1: { wallHeight: 2500 } });
  cleanProto();
});

test('形の合わない差分は例外を出さず、合わない部分だけ飛ばす', () => {
  const bad = [
    'abc', 5, null, [], { collections: 'x', fields: 'y' }, { collections: [], fields: [] },
    { collections: { walls: 'x', items: [], rooms: null } },
    { collections: { walls: { upserts: 'abc', removes: 'abc' } } },
    { collections: { items: { upserts: { id: 1 }, removes: { 0: '1' } } } },
    { collections: { items: { upserts: [null, 5, 'x', [1, 2], true], removes: [null, {}, [], true] } } },
    { collections: { doors: { upserts: [{ id: 9 }] } } },
    JSON.parse('{"collections":{"__proto__":{"walls":{"upserts":[{"id":9}]}}}}'),
  ];
  for (const patch of bad) {
    const plan = { walls: [{ id: 1 }], items: [{ id: 2 }], rooms: [{ id: 'rm3' }] };
    P.applyPatch(plan, patch);
    assert.deepEqual(plan, { walls: [{ id: 1 }], items: [{ id: 2 }], rooms: [{ id: 'rm3' }] }, JSON.stringify(patch));
  }
  // 壊れた部分と正しい部分が混ざっていても、正しい部分は当てる
  const plan = { walls: [{ id: 1 }], items: [{ id: 2 }], rooms: [] };
  P.applyPatch(plan, { collections: { walls: { upserts: 'abc', removes: ['1'] }, items: { upserts: [null, { id: 2, x: 5 }], removes: 'x' } } });
  assert.deepEqual(plan, { walls: [], items: [{ id: 2, x: 5 }], rooms: [] });
  cleanProto();
});

test('hasUnsafeKey: 自分の鍵だけを見る。深すぎるものは危ないとみなす', () => {
  assert.equal(P.hasUnsafeKey({ a: { b: [1, { c: 'constructor' }] } }), false, '値の文字は見ない');
  assert.equal(P.hasUnsafeKey(JSON.parse('{"a":[{"__proto__":1}]}')), true);
  assert.equal(P.hasUnsafeKey({ toString: 1 }), true, '文字に直すときに例外になる鍵も危ない');
  assert.equal(P.hasUnsafeKey({ a: [{ valueOf: 1 }] }), true);
  for (const k of Object.getOwnPropertyNames(Object.prototype)) assert.ok(P.UNSAFE_KEYS.includes(k), k + ' が一覧に無い');
  let deep = 1;
  for (let i = 0; i < 70; i++) deep = { a: deep };
  assert.equal(P.hasUnsafeKey(deep), true);
});
