// 色を変えられる部位（assets/models/finishes.json）。
//
// なぜ在るのか
// ------------
// 色を変える仕組みは2つあって噛み合っていなかった。
//
//   applySelectableColor()  テクスチャ付きを避ける。685点中684点がテクスチャ
//                           付きなので、外部アセットはほぼ色を変えられない
//   applyFinishes()         柄を輝度に落として色を掛ける。**仕組みは足りて
//                           いたが、手書きの2点にしか繋がっていなかった**
//
// ここは、全点への配線が生きているかを見る。**この検査が落ちると、
// カタログの大半が「色を選べるのに変わらない」状態に戻る。**
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');

const ROOT = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const FINISHES = JSON.parse(read('assets/models/finishes.json'));

test('外部アセットの大半に、色を変えられる部位が付いている', () => {
  const models = Object.keys(FINISHES.models);
  assert.ok(models.length >= 650, `配線されたモデルが ${models.length} 点しかない`);
  // 手書きだった頃は2点。**桁が違うことを見る。**
  const materials = Object.values(FINISHES.models).reduce((n, m) => n + Object.keys(m).length, 0);
  assert.ok(materials >= 800, `マテリアルが ${materials} しか貼られていない`);
});

test('語彙の外の部位は入っていない', () => {
  const known = new Set(Object.keys(FINISHES.channels));
  for (const [url, map] of Object.entries(FINISHES.models)) {
    for (const [material, channel] of Object.entries(map)) {
      assert.ok(known.has(channel), `${url} / ${material}: 語彙に無い部位 ${channel}`);
    }
  }
  for (const key of FINISHES.fixed) {
    assert.ok(known.has(key), `色を変えない部位 ${key} が語彙に無い`);
  }
});

test('貼った先のモデルが実在する', () => {
  const missing = Object.keys(FINISHES.models).filter((url) => !existsSync(join(ROOT, url)));
  assert.deepEqual(missing, [], 'finishes.json が存在しないモデルを指している');
});

test('柄の明るさの基準が、すべての部位にある', () => {
  // 基準が無いと既定の1で効き、**指定した色より暗く出る**。
  // 実機で、柄の平均輝度0.36のソファに濃紺を指定すると、さらに暗い紺になった。
  const used = new Set();
  for (const map of Object.values(FINISHES.models)) for (const c of Object.values(map)) used.add(c);
  for (const channel of used) {
    if (FINISHES.fixed.includes(channel)) continue;
    const value = FINISHES.defaults[channel];
    assert.ok(typeof value === 'number' && value > 0.02 && value < 1,
      `部位 ${channel} に使える基準値が無い (${value})`);
  }
});

test('人が決めた較正値は、機械の値に上書きされていない', () => {
  // 実物を見て決めたもの。**機械の平均より、こちらを信じる。**
  const sofa = 'assets/models/interior_model_0_26_1/glb/Sofa/MEGA_PACK_Sofa__BOLIA_sofa_Ivory.glb';
  const bed = 'assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb';
  assert.equal(FINISHES.models[sofa]['BOLIA-Ivory'], 'wood');
  assert.equal(FINISHES.references[sofa]['BOLIA-Ivory'], 0.3);
  assert.equal(FINISHES.references[bed]['43693'], 0.08);
});

test('ファイルが読めなくても、前と同じだけは効く', () => {
  // 差し込み式にしたとき、手書きの2点が効かなくなる退行を検査が捕まえた。
  // **組み込みの種として残してある**ことを見る。
  const src = read('assets/js/model-quality.js');
  assert.match(src, /SEED_FINISHES/, '組み込みの種が無い');
  assert.match(src, /BOLIA-Ivory/, '手書きの割り当てが種に残っていない');
  assert.match(src, /function setFinishes/, '外から差し込めない');
  assert.match(src, /finishDefaults\[channel\]/, '部位ごとの基準値を使っていない');
});

test('アプリが finishes.json を読み、部位を画面へ渡している', () => {
  const src = read('assets/js/app-constants.js');
  assert.match(src, /CATALOGUE_FINISHES_URL\s*=\s*'assets\/models\/finishes\.json'/, '読みに行っていない');
  assert.match(src, /ModelQuality\.setFinishes/, 'レンダラへ渡していない');
  assert.match(src, /function applyFinishChannels/, '画面用の部位一覧を作っていない');
  // ガラスは操作を出さない（押しても何も起きない欄を作らない）
  assert.match(src, /fixed\.indexOf\(key\)>=0/, '色を変えない部位を除いていない');
  // マニフェストが自前で持つものは触らない（自作モデルは登録時に既定色を拾う）
  assert.match(src, /item\.finishChannels&&item\.finishChannels\.length/, '既存の部位を上書きしている');
});

// ── テクスチャ（壁と同じ資産を、家具にも貼れるようにする） ──────────
//
// 壁は色のほかにテクスチャを貼れるのに、カタログのモデルは色だけだった。
// 仕様を分ける理由が無いので揃えた。**貼れることと、実寸で貼れることの両方**
// を見る。
test('仕上げの指定は、1か所の一覧で管理されている', () => {
  const src = read('index.html');
  assert.match(src, /var FINISH_PROPS\s*=\s*\['finishColors','finishRoughness','finishTextures'\]/,
    '仕上げの項目一覧が無い');
  // **インスタンシングの除外条件がこの一覧を見ていること。**
  // 見ていないと、新しい項目を足したときに「指定したのに何も起きない」になる。
  // 実際 finishTextures を足したとき、同じモデルが1つにまとめられて無視された。
  assert.match(src, /if\(it\.colorCustom \|\| FINISH_PROPS\.some\(/,
    'インスタンシングの除外条件が一覧を見ていない');
});

test('テクスチャは、壁と同じ資産・同じ実寸で貼る', () => {
  const src = read('index.html');
  assert.match(src, /var FINISH_TEXTURE_DEPS\s*=\s*\{/, '資産の解決が無い');
  assert.match(src, /tileM:\s*function\(key,fallback\)\{ return texTileM\(key,fallback\); \}/,
    '壁と同じ実寸(TEX_TILE_M)を使っていない');

  const mq = read('assets/js/model-quality.js');
  assert.match(mq, /function metresPerUv/, 'UVの実寸換算が無い');
  // **三角形ごとの中央値を採る。** 面積の合計で割ると、アトラスの外れ値に
  // 引きずられる(1.2mのクローゼットに repeat=15 が出た)。
  assert.match(mq, /samples\[samples\.length>>1\]/, '中央値を採っていない');
  assert.match(mq, /own\.map=map/, 'テクスチャを差し替えていない');
  // 差し替えたら、元の柄をほどく処理はかけない(二重に効く)
  assert.match(mq, /neutralizeFinish:false/, '差し替え後に元の柄の処理が残っている');
});

test('画面から素材を選べ、戻すと色・素材・艶がすべて戻る', () => {
  const src = read('assets/js/app-state.js');
  assert.match(src, /var MODEL_FINISH_TEXTURES=/, '素材の選択肢が無い');
  assert.match(src, /function updateSelectedModelTexture/, '素材を変える窓口が無い');
  assert.match(src, /finish-texture-/, '部位ごとの素材の欄が無い');
  // 色だけ戻して柄が残ると、押したのに元に戻らない、という見え方になる
  const reset = /function updateSelectedModelFinishReset\(\)\{[\s\S]*?\n\}/.exec(src);
  assert.ok(reset, '戻す窓口が無い');
  for (const key of ['finishColors', 'finishTextures', 'finishRoughness']) {
    assert.ok(reset[0].includes(key), `戻すときに ${key} を消していない`);
  }
});
