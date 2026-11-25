// plan-core/operations-catalog.js の単体テスト。
// 操作の名前・説明・引数の Schema が operations.js の OPS と食い違わないこと、
// Claude に渡す道具の定義が大きくなりすぎないこと(enum・anyOf が多いと「文法が大きすぎる」で断られる)を見る。
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const C = require('../../assets/js/plan-core/operations-catalog.js');
const O = require('../../assets/js/plan-core/operations.js');
const PlanSettable = require('../../assets/js/plan-settable.js');
const ObjectKnowledge = require('../../assets/js/object-knowledge.js');

const deps = { settable: PlanSettable, knowledge: ObjectKnowledge };

function countKeys(node, names) {
  let n = 0;
  if (Array.isArray(node)) { node.forEach((x) => { n += countKeys(x, names); }); return n; }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => { if (names.includes(k)) n++; n += countKeys(node[k], names); });
  }
  return n;
}
function opByName(name) { return C.OPERATIONS.find((o) => o.name === name); }

test('OPERATIONS の名前は operations.js の OPS と同じ集合', () => {
  const names = C.OPERATIONS.map((o) => o.name).sort();
  assert.deepEqual(names, Object.keys(O.OPS).sort());
  assert.equal(new Set(names).size, names.length, '名前が重複している');
});

test('各 Schema は object で、required の鍵はすべて properties にある', () => {
  C.OPERATIONS.forEach((o) => {
    assert.equal(typeof o.description, 'string', o.name);
    assert.ok(o.description.length > 0, o.name + ' の説明が空');
    assert.equal(o.inputSchema.type, 'object', o.name);
    assert.ok(o.inputSchema.properties && typeof o.inputSchema.properties === 'object', o.name);
    (o.inputSchema.required || []).forEach((k) => assert.ok(k in o.inputSchema.properties, o.name + ' の required ' + k));
  });
});

test('setProps は set の形だけを載せる(props は画面用で、AI には見せない)', () => {
  const s = opByName('setProps').inputSchema;
  assert.ok(s.properties.set);
  assert.equal(s.properties.props, undefined);
  assert.deepEqual(s.required.slice().sort(), ['id', 'set']);
});

// 道具の定義は毎回の呼び出しで送る(システムプロンプトと一緒にキャッシュされる)。2026-11-21 に、白紙から家を作る
// 操作(addRoomWalls・placeOpening・addRoof)を足して 8,000 から 10,000 に上げた(壁を1本ずつ・扉の座標を計算して
// 呼ぶより、往復と出力が減るため)。
test('toClaudeTools は 10,000 文字以内で、enum と anyOf は合わせて 10 個以下', () => {
  const tools = C.toClaudeTools(deps);
  const text = JSON.stringify(tools);
  assert.ok(text.length <= 10000, 'Claude の道具の定義が ' + text.length + ' 文字ある');
  const n = countKeys(tools, ['enum', 'anyOf']);
  assert.ok(n <= 10, 'enum と anyOf が ' + n + ' 個ある');
  assert.equal(tools.length, C.OPERATIONS.length);
  tools.forEach((t) => {
    assert.deepEqual(Object.keys(t).sort(), ['description', 'input_schema', 'name']);
    assert.deepEqual(t.input_schema, opByName(t.name).inputSchema);
  });
});

test('toMcpTools は同じ名前・同じ Schema を inputSchema で返す', () => {
  const tools = C.toMcpTools(deps);
  assert.equal(tools.length, C.OPERATIONS.length);
  tools.forEach((t) => {
    assert.deepEqual(Object.keys(t).sort(), ['description', 'inputSchema', 'name']);
    assert.deepEqual(t.inputSchema, opByName(t.name).inputSchema);
  });
  assert.deepEqual(tools.map((t) => t.description), C.toClaudeTools(deps).map((t) => t.description));
});

test('deps を省いても道具の定義は作れる(語彙の一覧が付かないだけ)', () => {
  const bare = C.toClaudeTools();
  assert.equal(bare.length, C.OPERATIONS.length);
  const full = C.toClaudeTools(deps);
  const placeBare = bare.find((t) => t.name === 'placeItem').description;
  const placeFull = full.find((t) => t.name === 'placeItem').description;
  assert.ok(placeFull.length > placeBare.length);
  assert.ok(placeFull.includes('door-swing'));
});

// Task 3(plan-core-operations.test.cjs)で成功させた操作の args。setProps は set の形だけ。
const SUCCESS = [
  ['addRoom', { name: '寝室', floor: 2, x: 3000, y: 2000, w: 2000, d: 1000 }],
  ['addRoom', { x: 0, y: 0, w: 1000, d: 1000 }],
  ['addRoomWalls', { ids: ['rm_a'], thick: 105, outerThick: 150 }],
  ['placeOpening', { type: 'door-swing', room: 'rm_a', side: 'S', hinge: 'E', opens: 'S', offset: 100 }],
  ['addRoof', { floor: 2, shape: 'gable', ridge: 'NS', pitch: 30, overhang: 450 }],
  ['resizeRoom', { id: 'rm_a', w: 3000 }],
  ['resizeRoom', { id: 'rm_a', x: 5000, y: 6000, d: 2000 }],
  ['renameRoom', { id: 'rm_a', name: '書斎' }],
  ['addWall', { x1: 0, y1: 3000, x2: 4000, y2: 3000, floor: 2, thick: 90 }],
  ['removeWall', { id: 1 }],
  ['placeItem', { type: 'sofa', x: 5000, y: 5000, rot: 90, w: 1800, d: 900 }],
  ['placeItem', { type: 'chair', x: 1000, y: 1000, floor: 2 }],
  ['placeItem', { type: 'stair', x: 0, y: 0 }],
  ['placeItem', { type: 'wood-fence', x: 0, y: 0, w: 2000, d: 100, set: { fenceHeight: 1200, fencePattern: 'vertical' } }],
  ['moveObject', { id: 10, x: 5000, y: 5000 }],
  ['moveObject', { id: 'rm_a', dx: 100, dy: -50 }],
  ['moveObject', { id: 1, dx: 0, dy: 500 }],
  ['rotateObject', { id: 10, rot: 90 }],
  ['rotateObject', { id: 10, by: 300 }],
  ['deleteObjects', { ids: [10, 1, 'rm_a', 10] }],
  ['setProps', { id: 1, set: { thick: 1000 } }],
  ['setProps', { id: 12, set: { windowKind: 'fix', windowHeight: 3000 } }],
  ['setProps', { id: 15, set: { surface: 'gravel' } }],
  ['setProps', { id: 'rm_a', set: { floorLevel: 'doma', floorMaterial: 'tile_floor' } }],
];

test('Task 3 の成功例の args は、checkArgs を全部通る', () => {
  SUCCESS.forEach(([name, args]) => {
    assert.deepEqual(C.checkArgs(name, args), { ok: true, errors: [] }, name + ' ' + JSON.stringify(args));
  });
});

test('id は Schema では文字。数の id も checkArgs は通す（文字でも数でも operations.js は同じ物を引く）', () => {
  assert.equal(opByName('moveObject').inputSchema.properties.id.type, 'string');
  assert.ok(opByName('moveObject').inputSchema.properties.id.description.includes('"12"'));
  assert.equal(C.checkArgs('moveObject', { id: '12', dx: 1, dy: 0 }).ok, true);
  assert.equal(C.checkArgs('moveObject', { id: 12, dx: 1, dy: 0 }).ok, true);
  assert.equal(C.checkArgs('deleteObjects', { ids: [12, 'rm_a'] }).ok, true);
  assert.equal(C.checkArgs('moveObject', { id: true, dx: 1, dy: 0 }).ok, false);
  // id 以外の文字の欄は数を受けない
  assert.equal(C.checkArgs('renameRoom', { id: 'rm_a', name: 12 }).ok, false);
});

test('checkArgs は定義に無い鍵・required の欠け・型違い・知らない操作名を errors にする', () => {
  const props = C.checkArgs('setProps', { id: '10', set: { thick: 100 }, props: { color: '#000' } });
  assert.equal(props.ok, false);
  assert.ok(props.errors.some((e) => e.includes('props')), JSON.stringify(props.errors));
  const onlyProps = C.checkArgs('setProps', { id: '10', props: { color: '#000' } });
  assert.equal(onlyProps.ok, false);
  assert.ok(onlyProps.errors.some((e) => e.includes('set')));
  assert.equal(C.checkArgs('addWall', { x1: '0', y1: 0, x2: 1, y2: 0 }).ok, false);
  assert.equal(C.checkArgs('addWall', { x1: NaN, y1: 0, x2: 1, y2: 0 }).ok, false);
  assert.equal(C.checkArgs('addRoom', { x: 0, y: 0, w: 1000 }).ok, false);
  assert.equal(C.checkArgs('addRoom', { x: 0, y: 0, w: 1000, d: 1000, floor: 1.5 }).ok, false);
  assert.equal(C.checkArgs('deleteObjects', { ids: [true] }).ok, false);
  assert.equal(C.checkArgs('deleteObjects', { ids: 'rm_a' }).ok, false);
  assert.equal(C.checkArgs('placeItem', { type: 'sofa', x: 0, y: 0, set: 'thick=100' }).ok, false);
  assert.equal(C.checkArgs('moveObject', null).ok, false);
  assert.equal(C.checkArgs('moveObject', [1]).ok, false);
  const unknown = C.checkArgs('noSuchOp', {});
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors[0].includes('noSuchOp'));
  assert.ok(unknown.errors.every((e) => typeof e === 'string'));
});

test('checkArgs の判定は Schema から機械的に作る（全操作で、定義に無い鍵を1つ足すと落ちる）', () => {
  C.OPERATIONS.forEach((o) => {
    const ok = SUCCESS.find(([name]) => name === o.name)[1];
    const r = C.checkArgs(o.name, Object.assign({ unknownKey: 1 }, ok));
    assert.equal(r.ok, false, o.name);
    assert.equal(r.errors.length, 1, o.name + ' ' + JSON.stringify(r.errors));
  });
});

test('describeVocabulary は PlanSettable.SETTINGS の全項目の key と、家財の分類・窓扉の種類を含む', () => {
  const text = C.describeVocabulary(deps);
  assert.equal(typeof text, 'string');
  Object.keys(PlanSettable.SETTINGS).forEach((part) => {
    PlanSettable.SETTINGS[part].forEach((s) => assert.ok(text.includes(s.key), part + '.' + s.key));
  });
  PlanSettable.OPENINGS.forEach((o) => assert.ok(text.includes(o.type), o.type));
  ['bed', 'sofa', 'bathtub', 'refrigerator'].forEach((k) => assert.ok(text.includes(k), k));
  // 選択肢の値も手書きでなく表から入る
  assert.ok(text.includes('tile_floor'));
  assert.ok(text.includes('skeleton'));
});

test('describeVocabulary は座標の約束と、失敗すると全部が取り消されることを書く', () => {
  const text = C.describeVocabulary(deps);
  assert.ok(text.includes('mm'));
  assert.ok(text.includes('中心'));
  assert.ok(text.includes('取り消'));
});

test('説明は operations.js の今の動きを書く（全部取り消し・両方渡す・階段の向き・吊元・階・桁・部屋の中身）', () => {
  const all = C.toClaudeTools(deps).map((t) => t.description).join('\n') + '\n' + C.describeVocabulary(deps);
  ['全部取り消', 'x と y の両方', 'dx と dy の両方', '南（+y）へ上る', '吊元と開く向きは指定できない',
    '1〜4', '桁（mm）', '中の物と壁は動かない'].forEach((w) => assert.ok(all.includes(w), w));
});

test('plan-core/operations-catalog.js はグローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/plan-core/operations-catalog.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'nextId', 'PlanSettable', 'ObjectKnowledge', 'PlanCoreOperations.', 'require(']) {
    assert.ok(!src.includes(w), w + ' が残っている');
  }
});

// 編集(チャット・MCP)の説明には、編集だけの選択肢(土間をやめる normal)も出す。読み取りの説明には出さない
// (tools/tests/plan-settable.test.cjs が見る)。
test('describeVocabulary は floorLevel の編集だけの選択肢 normal も書く', () => {
  const text = C.describeVocabulary(deps);
  const line = text.split('\n').find((l) => l.indexOf('floorLevel（') >= 0);
  assert.ok(line, 'floorLevel の行が無い');
  assert.match(line, /doma=/);
  assert.match(line, /normal=/);
});
