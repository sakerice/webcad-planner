// AI に見せる「置ける物の種類」の一覧(operations-catalog.js の describeVocabulary と placeItem の説明)と、
// 実際に placeItem が受け付ける種類が食い違っていないか。
//
// なぜ要るか: 2026-11-20 に、一覧に載っている kitchen-unit を置こうとすると断られ、一覧に無い foundation(基礎)は
// 置ける、という食い違いが見つかった。AI は一覧を見て道具を呼ぶので、載っているのに断られると呼び直しで往復と費用を使い、
// 載っていない物は白紙から家を作るときに使われない。
//
// 受け付ける側は Worker の ctx(worker/plan-ctx.mjs の workerOpsCtx。MCP の受け口が使う。画面のチャットの
// planChatCtx と同じ判定。画面の側は tools/tests/chat-ctx.browser.mjs が同じ一覧で確かめる)。
//   1. 一覧に載っている種類は、どれも空のプランの 1 階に置ける
//   2. 画面の道具(index.html の data-tool)で人が置ける種類のうち、AI の ctx も受け付ける物は、一覧に載せるか、
//      載せない理由を UNLISTED に書く(新しい道具を足したときに、ここで気づく)
//   3. UNLISTED の種類は一覧に載っていない。理由は空でない
//   4. システムプロンプトの一覧(describeVocabulary)と、placeItem の道具の説明(MCP も同じ)に、どの種類も載っている。
//      kitchen-unit は置ける物としては載せない(調理台の作り方の文だけ)
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const Catalog = require('../../assets/js/plan-core/operations-catalog.js');
const O = require('../../assets/js/plan-core/operations.js');
const DEPS = { settable: require('../../assets/js/plan-settable.js'), knowledge: require('../../assets/js/object-knowledge.js') };

const ctxReady = import(pathToFileURL(join(ROOT, 'worker', 'plan-ctx.mjs')).href);

function placeOn(workerOpsCtx, type) {
  const plan = { walls: [], rooms: [], items: [] };
  const r = O.applyOperations(plan, [{ op: 'placeItem', args: { type, x: 2000, y: 2000, floor: 1 } }], workerOpsCtx(plan));
  return r.errors.length ? r.errors[0].message : null;
}

const paletteTools = () => [...new Set([...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]))];

test('一覧に載っている種類は、どれも置ける', async () => {
  const { workerOpsCtx } = await ctxReady;
  const listed = Catalog.listedTypes(DEPS);
  assert.ok(listed.length >= 60, '一覧が短すぎる: ' + listed.length);
  const refused = listed.map((t) => [t, placeOn(workerOpsCtx, t)]).filter(([, m]) => m);
  assert.deepEqual(refused, [], '一覧に載っているのに置けない種類がある');
  assert.ok(listed.includes('foundation'), '基礎(foundation)が一覧に無い');
  assert.ok(!listed.includes('kitchen-unit'), 'kitchen-unit は置けないのに一覧にある');
  assert.equal(placeOn(workerOpsCtx, 'kitchen-unit') !== null, true, 'kitchen-unit が置けるなら、一覧に戻す');
  // 調理台の作り方の文に書いた部品は置ける
  for (const t of ['kitchen-sink', 'cooktop', 'original-kitchen-box-drawer450', 'original-kitchen-box-drawer600', 'original-kitchen-box-drawer750', 'original-kitchen-box-drawer900']) {
    assert.equal(placeOn(workerOpsCtx, t), null, t + ' が置けない');
  }
});

test('画面で人が置ける種類のうち AI も置ける物は、一覧に載せるか、載せない理由を書く', async () => {
  const { workerOpsCtx } = await ctxReady;
  const listed = new Set(Catalog.listedTypes(DEPS));
  const missing = paletteTools().filter((t) => !listed.has(t) && !Object.prototype.hasOwnProperty.call(Catalog.UNLISTED, t) && !placeOn(workerOpsCtx, t));
  assert.deepEqual(missing, [], '一覧にも UNLISTED にも無い種類(operations-catalog.js に足す)');
});

test('UNLISTED の種類は一覧に載せず、理由が書いてある', () => {
  const listed = new Set(Catalog.listedTypes(DEPS));
  for (const [t, why] of Object.entries(Catalog.UNLISTED)) {
    assert.ok(!listed.has(t), t + ' は UNLISTED なのに一覧にある');
    assert.ok(typeof why === 'string' && why.length >= 4, t + ' の理由が無い');
  }
});

test('システムプロンプトの一覧と placeItem の説明(チャット・MCP)に、どの種類も載っている', () => {
  const voc = Catalog.describeVocabulary(DEPS);
  const claude = Catalog.toClaudeTools(DEPS).find((t) => t.name === 'placeItem').description;
  const mcp = Catalog.toMcpTools(DEPS).find((t) => t.name === 'placeItem').description;
  assert.equal(claude, mcp);
  const words = (s) => new Set(s.split(/[^A-Za-z0-9_-]+/).filter(Boolean));
  const inVoc = words(voc), inDesc = words(claude);
  for (const t of Catalog.listedTypes(DEPS)) {
    assert.ok(inVoc.has(t), t + ' がシステムプロンプトの一覧に無い');
    assert.ok(inDesc.has(t), t + ' が placeItem の説明に無い');
  }
  // kitchen-unit は「置ける物」の行には出さない(調理台の作り方の文にだけ出る)
  assert.ok(!inDesc.has('kitchen-unit'), 'placeItem の説明に kitchen-unit がある');
  const lines = voc.split('\n').filter((l) => /\bkitchen-unit\b/.test(l));
  assert.equal(lines.length, 1, 'kitchen-unit の行は調理台の作り方の1行だけ: ' + JSON.stringify(lines));
  assert.match(lines[0], /置けない/);
});
