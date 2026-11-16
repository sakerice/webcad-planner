// plan-core/operations-catalog.js の単体テスト。
// 操作の名前・説明・引数の Schema が operations.js の OPS と食い違わないこと、
// Claude に渡す道具の定義が大きくなりすぎないこと(enum・anyOf が多いと「文法が大きすぎる」で断られる)を見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../assets/js/plan-core/operations-catalog.js');
const O = require('../../assets/js/plan-core/operations.js');
const PlanSettable = require('../../assets/js/plan-settable.js');
const ObjectKnowledge = require('../../assets/js/object-knowledge.js');

const deps = { settable: PlanSettable, knowledge: ObjectKnowledge };

// 小さな Schema の検査。使っている形(type・properties・required・items・additionalProperties)だけを見る。
function typeOk(type, v) {
  if (Array.isArray(type)) return type.some((t) => typeOk(t, v));
  switch (type) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case undefined: return true;
    default: throw new Error('検査関数が知らない type: ' + type);
  }
}
function validate(schema, v, at) {
  at = at || 'args';
  const errs = [];
  if (!typeOk(schema.type, v)) return [at + ' の型が ' + JSON.stringify(schema.type) + ' でない'];
  if (schema.enum && !schema.enum.includes(v)) errs.push(at + ' が選択肢に無い');
  if (schema.type === 'object' || (Array.isArray(schema.type) && typeOk('object', v) && schema.properties)) {
    (schema.required || []).forEach((k) => { if (!(k in v)) errs.push(at + '.' + k + ' が無い'); });
    Object.keys(v).forEach((k) => {
      const p = schema.properties && schema.properties[k];
      if (!p) { if (schema.additionalProperties === false) errs.push(at + '.' + k + ' は定義に無い'); return; }
      errs.push(...validate(p, v[k], at + '.' + k));
    });
  }
  if (schema.type === 'array' && schema.items) v.forEach((x, i) => errs.push(...validate(schema.items, x, at + '[' + i + ']')));
  return errs;
}
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

test('toClaudeTools は 8,000 文字以内で、enum と anyOf は合わせて 10 個以下', () => {
  const tools = C.toClaudeTools(deps);
  const text = JSON.stringify(tools);
  assert.ok(text.length <= 8000, 'Claude の道具の定義が ' + text.length + ' 文字ある');
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

test('Task 3 の成功例の args は、対応する Schema の required と型を満たす', () => {
  SUCCESS.forEach(([name, args]) => {
    const errs = validate(opByName(name).inputSchema, args);
    assert.deepEqual(errs, [], name + ' ' + JSON.stringify(args));
  });
});

test('検査関数そのものが、型の違いと required の抜けを見つける', () => {
  assert.notDeepEqual(validate(opByName('addWall').inputSchema, { x1: '0', y1: 0, x2: 1, y2: 0 }), []);
  assert.notDeepEqual(validate(opByName('addRoom').inputSchema, { x: 0, y: 0, w: 1000 }), []);
  assert.notDeepEqual(validate(opByName('deleteObjects').inputSchema, { ids: [true] }), []);
  assert.notDeepEqual(validate(opByName('setProps').inputSchema, { id: 1, props: { color: '#000' } }), []);
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
