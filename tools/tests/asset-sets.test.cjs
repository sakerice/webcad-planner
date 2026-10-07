// アセットのセット（標準・洋館・…）の、表示の切り替えと、セットの納品物の検査。
//
// 納品物の検査は、Codex などが新しいセット（例: 日本古民家）を足すときの受け入れ条件でもある。
// ここが通らない限り、カタログに出す前の段階で止まる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const AssetSets = require('../../assets/js/asset-sets.js');

function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
const registry = { sets: [{ id: 'standard', name: '標準' }, { id: 'rpg-mansion', name: '洋館', manifest: 'm.json' }] };
const fetchJson = (url) => Promise.resolve(url === AssetSets.REGISTRY_URL ? registry : { items: [{ id: 'rpg-mansion-chair-01' }] });

test('最初は標準だけを表示する（今のカタログと同じ中身）', async () => {
  AssetSets._reset();
  const manifests = await AssetSets.load(fetchJson, memoryStorage());
  assert.deepEqual(AssetSets.visible(), ['standard']);
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].items[0].assetSet, 'rpg-mansion', '標準以外の物にはセットの印が付く');
  assert.ok(AssetSets.isVisible({ id: 'fmp-Bed01' }), '印の無い物は標準');
  assert.ok(!AssetSets.isVisible({ assetSet: 'rpg-mansion' }));
});

test('切り替えはこのブラウザに覚え、次に開いたときも同じ', async () => {
  AssetSets._reset();
  const storage = memoryStorage();
  await AssetSets.load(fetchJson, storage);
  assert.ok(AssetSets.toggle('rpg-mansion', storage));
  assert.deepEqual(AssetSets.visible(), ['standard', 'rpg-mansion']);
  AssetSets._reset();
  await AssetSets.load(fetchJson, storage);
  assert.deepEqual(AssetSets.visible(), ['standard', 'rpg-mansion']);
});

test('何も表示しない状態にはならない', async () => {
  AssetSets._reset();
  const storage = memoryStorage();
  await AssetSets.load(fetchJson, storage);
  assert.equal(AssetSets.toggle('standard', storage), false, '最後の1つは外せない');
  assert.deepEqual(AssetSets.visible(), ['standard']);
  AssetSets.toggle('rpg-mansion', storage);
  assert.ok(AssetSets.toggle('standard', storage), '洋館だけにはできる');
  assert.deepEqual(AssetSets.visible(), ['rpg-mansion']);
});

test('覚えた値が壊れている・消えたセットを指しているときは標準に戻る', async () => {
  for (const raw of ['{', '[]', '["no-such-set"]', '42']) {
    AssetSets._reset();
    await AssetSets.load(fetchJson, memoryStorage({ [AssetSets.STORAGE_KEY]: raw }));
    assert.deepEqual(AssetSets.visible(), ['standard'], raw);
  }
});

test('一覧が読めなくても標準だけで動く', async () => {
  AssetSets._reset();
  const manifests = await AssetSets.load(() => Promise.resolve(null), memoryStorage());
  assert.deepEqual(manifests, []);
  assert.deepEqual(AssetSets.sets().map((s) => s.id), ['standard']);
});

test('標準以外の物にはセット名の札と、見出し用の短い印が付く', async () => {
  AssetSets._reset();
  await AssetSets.load(fetchJson, memoryStorage());
  assert.equal(AssetSets.badge({ assetSet: 'rpg-mansion' }), '洋館');
  assert.equal(AssetSets.badge({}), '');
  assert.equal(AssetSets.mark({ assetSet: 'rpg-mansion' }), '洋', '一覧に mark が無ければセット名の頭1文字');
  assert.equal(AssetSets.mark({}), '');
});

// ── 納品物の検査（リポジトリに置いてある実物を見る） ──────────────────────
const doc = JSON.parse(readFileSync(join(ROOT, 'assets/models/asset-sets.json'), 'utf8'));
const kinds = JSON.parse(readFileSync(join(ROOT, 'assets/models/tags.json'), 'utf8')).kinds || {};
const standardIds = new Set();
for (const rel of ['assets/models/furniture_mega/manifest.json', 'assets/models/interior_model_0_26_1/manifest.json', 'assets/models/custom/manifest.json']) {
  for (const it of JSON.parse(readFileSync(join(ROOT, rel), 'utf8')).items || []) standardIds.add(it.id);
}

for (const set of doc.sets.filter((s) => s.manifest)) {
  test(`セット「${set.name}」の納品物がカタログに載せられる形になっている`, () => {
    const manifestPath = join(ROOT, set.manifest);
    assert.ok(existsSync(manifestPath), set.manifest + ' が無い');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.ok(Array.isArray(m.items) && m.items.length, '物が1つも無い');
    const seen = new Set();
    for (const it of m.items) {
      const where = `${set.name} / ${it.id}`;
      assert.ok(it.id && it.id.startsWith(set.id + '-'), `${where}: ID はセット名で始める（標準の ID とぶつけないため）`);
      assert.ok(!seen.has(it.id), `${where}: ID が重複`); seen.add(it.id);
      assert.ok(!standardIds.has(it.id), `${where}: 標準のカタログと同じ ID`);
      assert.ok(it.name && it.group && it.category, `${where}: 名前・大分類・分類が要る`);
      assert.ok(['住設', '家具', '外構'].includes(it.group), `${where}: 大分類は 住設/家具/外構 のどれか`);
      for (const k of ['w', 'd', 'h']) assert.ok(Number(it[k]) > 0, `${where}: ${k} が正の mm でない`);
      for (const k of ['model', 'thumb', 'top']) assert.ok(it[k] && existsSync(join(ROOT, it[k])), `${where}: ${k} のファイルが無い (${it[k]})`);
      assert.match(it.model, /\.glb$/, `${where}: モデルは GLB`);
      // 色を変えられる部位。割れたガラスのように色を持たない物だけ空でよい（空の配列を明示する）
      assert.ok(Array.isArray(it.finishChannels), `${where}: 色を変えられる部位(finishChannels)の定義が無い`);
      for (const ch of it.finishChannels) assert.ok(ch.key && ch.label && /^#[0-9a-f]{6}$/i.test(ch.default), `${where}: 部位 ${ch.key} の定義が不完全`);
      // 分類(kind)は標準と同じ名前を使う。標準の見出しの下に混ざって並ぶため。無い物はセット独自の見出しになる
      if (it.kind) assert.ok(kinds[it.kind], `${where}: 分類 ${it.kind} が tags.json に無い`);
      assert.equal(it.provenance, 'original', `${where}: 独自制作でない物は台帳で権利を確かめてから載せる`);
    }
  });
}
