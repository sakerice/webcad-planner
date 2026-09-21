// カタログ753点の分類(assets/models/tags.json)。
//
// 見ているのは4つ:
//   1. **1点も漏れていない**こと。漏れた品はサイドバーで「その他」に落ちる。
//   2. 語彙の外の分類が混ざっていないこと。
//   3. 検索語が**実際に引ける**こと。死んだ語（何も返さない語）を置かない。
//   4. 分類と高さが噛み合っていること（机の高さのローテーブルを机と呼ばない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const TAGS = read('assets/models/tags.json');
const AssetCatalogue = require(join(ROOT, 'assets', 'js', 'asset-catalogue.js'));

function catalogueItems() {
  const out = [];
  for (const source of ['custom', 'furniture_mega', 'interior_model_0_26_1']) {
    for (const item of read(`assets/models/${source}/manifest.json`).items) out.push(item);
  }
  return out;
}

// アプリがタグを貼ったあとの、検索に掛かる文字列。
// assets/js/app-constants.js の data-search と同じ作り方をする。
function searchText(item) {
  const tag = TAGS.items[item.id];
  const kind = tag && TAGS.kinds[tag.kind];
  const words = kind ? [kind.ja].concat(kind.search || []).join(' ') : '';
  return [item.name, item.category, words, item.id].join(' ');
}

test('753点すべてに分類が付いている', () => {
  const items = catalogueItems();
  assert.equal(items.length, 756, 'カタログの点数が変わった。変わったならタグを貼り直すこと');
  const missing = items.filter((i) => !TAGS.items[i.id]);
  assert.deepEqual(missing.map((i) => i.id), [], '分類の無い品がある（node tools/tag_catalogue.mjs --resume で貼れる）');
});

test('語彙の外の分類は入っていない', async () => {
  const { KINDS, MOUNTS, ROOMS } = await import(pathToFileURL(join(ROOT, 'tools', 'catalogue-vocab.mjs')).href);
  for (const [id, tag] of Object.entries(TAGS.items)) {
    assert.ok(KINDS[tag.kind], `${id}: 語彙に無い分類 ${tag.kind}`);
    if (tag.mount) assert.ok(MOUNTS[tag.mount], `${id}: 語彙に無い置き方 ${tag.mount}`);
    if (tag.room) assert.ok(ROOMS[tag.room], `${id}: 語彙に無い部屋 ${tag.room}`);
  }
  // 出荷するファイルの中の kinds も、語彙と食い違っていないこと
  for (const [key, v] of Object.entries(TAGS.kinds)) {
    assert.ok(KINDS[key], `tags.json に語彙外の分類 ${key} がある`);
    assert.equal(v.ja, KINDS[key].ja, `${key}: 名前が食い違っている`);
  }
});

test('施主の言葉で引ける（貼る前は引けなかった語で確かめる）', () => {
  const items = catalogueItems();
  const find = (query) => items.filter((i) => AssetCatalogue.matches(searchText(i), query));
  // 貼る前は name が "BathTub01"、category が "バスルーム" なので、
  // 「浴槽」「風呂」では1点も引けなかった。
  for (const [query, least] of [['浴槽', 5], ['風呂', 5], ['バスタブ', 5], ['便器', 5],
    ['冷蔵庫', 5], ['食卓', 3], ['タンス', 20], ['本棚', 5], ['絨毯', 5], ['観葉植物', 5],
    ['寝具', 5], ['子供', 5], ['門柱', 3], ['レンジフード', 3], ['間接照明', 5]]) {
    assert.ok(find(query).length >= least,
      `「${query}」で ${find(query).length} 点しか引けない（${least} 点以上あるはず）`);
  }
  // 引いた先が正しいこと。「浴槽」で椅子が出てこない。
  for (const item of find('浴槽')) {
    assert.equal(TAGS.items[item.id].kind, 'bathtub', `「浴槽」で ${item.id} が出てくる`);
  }
});

// **検索の細かさは、分類の細かさで決まる。** 同じ kind の品は、その kind の
// どの語でも全部返る。だから、施主が名前で呼び分けるものを1つの kind に
// まとめてはいけない。
//
// 実際、はじめは「キッチン機器」1つにコンロ・レンジフード・オーブン・
// 電子レンジを入れていた。「レンジフード」と打つと31点返り、コーヒー
// メーカーまで並んだ。コンロ / レンジフード / 調理家電 に割って直した。
test('細かい言葉は、細かく返る', () => {
  const items = catalogueItems();
  const find = (query) => items.filter((i) => AssetCatalogue.matches(searchText(i), query));
  for (const [query, most] of [['レンジフード', 10], ['コンロ', 10], ['ロールスクリーン', 12],
    ['便器', 10], ['冷蔵庫', 12], ['浴槽', 15]]) {
    assert.ok(find(query).length <= most,
      `「${query}」で ${find(query).length} 点返る（${most} 点以下のはず。分類が粗い）`);
  }
});

test('死んだ検索語を置かない（どの語も1点以上を引く）', () => {
  const items = catalogueItems();
  const used = new Set(Object.values(TAGS.items).map((t) => t.kind));
  for (const kind of used) {
    for (const word of TAGS.kinds[kind].search || []) {
      const hit = items.some((i) => AssetCatalogue.matches(searchText(i), word));
      assert.ok(hit, `「${word}」(${TAGS.kinds[kind].ja}) が1点も引かない`);
    }
  }
});

test('分類と高さが噛み合っている（噛み合わないものは印が付いている）', async () => {
  const { heightProblem } = await import(pathToFileURL(join(ROOT, 'tools', 'catalogue-vocab.mjs')).href);
  const byId = new Map(catalogueItems().map((i) => [i.id, i]));
  for (const [id, tag] of Object.entries(TAGS.items)) {
    const problem = heightProblem(tag.kind, (byId.get(id) || {}).h);
    if (!problem) continue;
    assert.ok(tag.review && tag.review.some((r) => r.includes('範囲外')),
      `${id}: 高さが分類と合わないのに印が付いていない（${problem}）`);
  }
});

test('アプリは tags.json を読んで見出しに使う', () => {
  const src = readFileSync(join(ROOT, 'assets', 'js', 'app-constants.js'), 'utf8');
  assert.match(src, /CATALOGUE_TAGS_URL\s*=\s*'assets\/models\/tags\.json'/, 'タグを読みに行っていない');
  assert.match(src, /function catalogueHeading/, '見出しを分類から作っていない');
  assert.match(src, /item\.searchWords/, '検索語を検索対象に入れていない');
  // 読めなかったときは、これまでどおり category で並ぶこと
  assert.match(src, /\(item&&item\.kindJa\)\|\|\(item&&item\.category\)/, 'タグが無いときの並びが元に戻らない');
});

// カタログの過不足を数える検査（docs/catalogue-gap.md）。
//
// **死んだ検査にしない。** 範囲を広げすぎると全部が合格になり、寸法の
// 食い違いを見逃す。いま分かっている食い違いを名指しで押さえておく。
test('実寸の検査が、実際に食い違いを捕まえる', async () => {
  const { realSizeOk } = await import(pathToFileURL(join(ROOT, 'tools', 'catalogue-vocab.mjs')).href);
  // 日本の標準寸法は通る
  assert.equal(realSizeOk('bathtub', 1600, 750), true, '1坪UBの湯船を弾いている');
  assert.equal(realSizeOk('toilet', 380, 680), true, '標準の便器を弾いている');
  assert.equal(realSizeOk('desk', 1000, 600), true, '学習机を弾いている');
  assert.equal(realSizeOk('kitchen-unit', 2550, 650), true, '間口2550のキッチンを弾いている');
  // 向きが入れ替わっていても通る
  assert.equal(realSizeOk('bathtub', 750, 1600), true);
  // いま在庫にある寸法は落ちる
  assert.equal(realSizeOk('toilet', 371, 572), false, '小さすぎる便器を通している');
  assert.equal(realSizeOk('desk', 1050, 420), false, '奥行の足りない机を通している');
  assert.equal(realSizeOk('bathtub', 569, 428), false, '湯船でないものを通している');
  // 範囲の無い分類は判定しない
  assert.equal(realSizeOk('decor', 100, 100), null);
});

test('過不足の表が、数えられる形で出る', async () => {
  const { gapReport, realSizeReport } = await import(pathToFileURL(join(ROOT, 'tools', 'catalogue_gap.mjs')).href);
  const rows = gapReport();
  assert.ok(rows.length > 20, '要るものを数えられていない');
  for (const row of rows) {
    assert.ok(TAGS.kinds[row.kind], `${row.kind} が語彙に無い（room-program.js と語彙が食い違っている）`);
    assert.ok(row.needed > 0 && row.rooms.length, `${row.kind} に要る数か部屋が無い`);
  }
  const sizes = realSizeReport();
  assert.ok(sizes.some((s) => s.fits === 0), '実寸に合う在庫が0の品を見つけられていない');
});
