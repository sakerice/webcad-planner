// 壁・床・屋根をまとめて様式に切り替えるときの、「どこを何の素材にするか」の決め方。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../../assets/js/building-style.js');

const style = {
  exterior: { base: 'stone', upper: 'brick' },
  roof: 'slate',
  interior: 'damask',
  floor: 'herringbone',
  rooms: [
    { match: ['浴室', '洗面', 'トイレ'], floor: 'marble', wall: 'subway' },
    { match: ['キッチン'], wall: 'subway' },
    { match: ['玄関'], floor: 'marble' },
  ],
  outdoorRooms: ['バルコニー', 'ポーチ'],
};

test('2階建て以上は1階を石、上の階をレンガにする', () => {
  const p = B.plan({ floors: [2, 1, 3] }, style);
  assert.deepEqual(p.exterior, [{ floor: 1, texture: 'stone' }, { floor: 2, texture: 'brick' }, { floor: 3, texture: 'brick' }]);
});

test('平屋はレンガだけ', () => {
  assert.deepEqual(B.plan({ floors: [1] }, style).exterior, [{ floor: 1, texture: 'brick' }]);
});

test('床は部屋の名前で決める。番号付きの名前(トイレ(2))も当たる', () => {
  const p = B.plan({ rooms: [{ id: 0, n: 'LDK', floor: 1 }, { id: 1, n: 'トイレ(2)', floor: 2 }, { id: 2, n: '玄関', floor: 1 }] }, style);
  assert.deepEqual(p.rooms.map((r) => r.texture), ['herringbone', 'marble', 'marble']);
});

test('屋外の部屋は床を替えない', () => {
  const p = B.plan({ rooms: [{ id: 0, n: 'バルコニー', floor: 2 }, { id: 1, n: '寝室', floor: 2 }] }, style);
  assert.deepEqual(p.rooms.map((r) => r.n), ['寝室']);
  assert.deepEqual(p.skippedRooms.map((r) => r.n), ['バルコニー']);
});

test('内壁は家全体を壁紙にし、水まわりとキッチンの面だけ別の素材にする', () => {
  const p = B.plan({ faces: [{ key: 'a', room: '浴室' }, { key: 'b', room: 'LDK' }, { key: 'c', room: null }, { key: 'd', room: 'キッチン' }] }, style);
  assert.equal(p.interior, 'damask');
  assert.deepEqual(p.faces.map((f) => [f.key, f.texture]), [['a', 'subway'], ['d', 'subway']]);
});

test('洋館の様式が指す素材は、すべてアプリに登録してあり、ファイルもある', () => {
  const root = path.join(__dirname, '..', '..');
  const sets = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/asset-sets.json'), 'utf8'));
  const st = sets.sets.find((s) => s.id === 'rpg-mansion').style;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const keys = new Set([st.exterior.base, st.exterior.upper, st.roof, st.interior]);
  st.rooms.forEach((r) => r.wall && keys.add(r.wall));
  const floorKeys = new Set([st.floor]);
  st.rooms.forEach((r) => r.floor && floorKeys.add(r.floor));
  for (const k of keys) {
    const m = html.match(new RegExp(`'${k}':\\s*'([^']+)'`));
    assert.ok(m, `ASSET_TEX_MAP に ${k} が無い`);
    assert.ok(fs.existsSync(path.join(root, m[1])), `${m[1]} が無い`);
    assert.match(html, new RegExp(`\\b${k}:\\s*[0-9.]+`), `TEX_TILE_M に ${k} の寸法が無い`);
    assert.ok(st.names[k], `${k} の日本語名が無い`);
  }
  for (const k of floorKeys) {
    // 床材は拡張子の無いファイル名の頭(法線の表 ASSET_TEX_NORMAL の同じキーと区別する)
    const m = html.match(new RegExp(`\\b${k}:\\s*'([^'.]+)'`));
    assert.ok(m, `FLOOR_PBR_STEM に ${k} が無い`);
    for (const suf of ['diffuse', 'normal', 'roughness']) {
      assert.ok(fs.existsSync(path.join(root, 'assets/textures', `${m[1]}_${suf}.jpg`)), `${k} の ${suf} が無い`);
    }
    assert.ok(st.names[k], `${k} の日本語名が無い`);
  }
});

test('建具は開き戸と玄関ドアだけ替え、浴室の透明ドア・引き戸は残す', () => {
  const st = { ...style, doors: { swing: 'six', front: 'entrance' } };
  const p = B.plan({ doors: [
    { id: 1, type: 'door-swing', finish: '' }, { id: 2, type: 'door-swing-s', finish: '' },
    { id: 3, type: 'door-front', finish: '' }, { id: 4, type: 'door-swing', finish: 'bath-clear' },
    { id: 5, type: 'door-slide', finish: '' },
  ] }, st);
  assert.deepEqual(p.doors.map((d) => [d.id, d.model]), [[1, 'six'], [2, 'six'], [3, 'entrance']]);
  assert.equal(p.keptDoors, 2);
});

test('洋館の様式が指す扉は、洋館セットに在る「ドア」の物', () => {
  const root = path.join(__dirname, '..', '..');
  const sets = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/asset-sets.json'), 'utf8'));
  const st = sets.sets.find((s) => s.id === 'rpg-mansion').style;
  const man = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/packs/rpg-mansion/manifest.json'), 'utf8'));
  for (const [k, id] of Object.entries(st.doors)) {
    const it = man.items.find((i) => i.id === id);
    assert.ok(it && !it.retired, `${k}: ${id} が manifest に無い`);
    assert.equal(it.category, 'ドア');
    assert.equal(/-entrance-door-/.test(id), k === 'front', `${k}: 玄関ドアと室内ドアの取り違え`);
  }
});
