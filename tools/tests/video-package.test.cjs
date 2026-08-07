// 動画AIレンダー用パッケージの組み立て (Task 7)。
//
// ここのテストはすべて index.html の**ソース文字列**を見る grep である。
// 「絵が正しく出るか」「ZIP に本当に4ファイル入るか」は見ていない。
// この計画では既に3回、未変更のコードに対して通ってしまう検査があった。
// grep は必要だが十分ではない。実質的な検証はレポートのブラウザ実測であって、
// このファイルではない。ここが守るのは「経路を二重化しない」「既定を絞る」
// 「記録を落とさない」という構造だけである。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

function bodyOf(signature, length) {
  const at = html.indexOf(signature);
  assert.notEqual(at, -1, signature + ' が index.html に無い');
  return html.slice(at, at + (length || 8000));
}

const pkg = html.slice(html.indexOf('function generateVideoRenderPackage'),
                      html.indexOf('function generateVideoRenderPackage') + 8000);

test('generateVideoRenderPackage が存在する', () => {
  assert.match(html, /function generateVideoRenderPackage\(/);
});

// 二重化は必ず片方が腐る。動画版のために別のキャプチャ経路を作らない。
test('ガイドは既存のキャプチャ関数を使う', () => {
  assert.match(pkg, /captureInstance3DData\(/);
  assert.match(pkg, /captureCurrent3DDataUrl\(/);
});

test('参照画像は暗部持ち上げを通ってから書き出される', () => {
  assert.match(pkg, /ShadowLift\.(curveFor|apply)/);
});

test('適用したカーブは package.json に記録される', () => {
  assert.match(pkg, /shadowLift/);
});

test('色→階層の表が package.json に入る', () => {
  assert.match(pkg, /LockTiers\.tableFor\(/);
});

test('詳細ガイドは既定で入らない', () => {
  assert.match(pkg, /includeGuides/);
});

// 既存ユーザーの出力を変えない。
test('既存の generateAiRenderPackage は動画側の処理を通らない', () => {
  const still = html.slice(html.indexOf('async function generateAiRenderPackage'),
                           html.indexOf('async function generateAiRenderPackage') + 6000);
  assert.doesNotMatch(still, /ShadowLift\.apply/);
});

// ── ここから下は brief に無い追加分 ──────────────────────────────────────

test('既存の generateAiRenderPackage は動画側の関数を1つも呼ばない', () => {
  const still = html.slice(html.indexOf('async function generateAiRenderPackage'),
                           html.indexOf('async function generateAiRenderPackage') + 6000);
  assert.doesNotMatch(still, /generateVideoRenderPackage|videoPackage|VideoPrompt|LockTiers|ShadowLift/);
});

test('残り5枚のガイドも既存のキャプチャ関数から採る（動画用の第二経路を作らない）', () => {
  assert.match(pkg, /captureSegmentation3DDataUrl\(/);
  assert.match(pkg, /captureAiOverrideGuideDataUrl\(/);
  assert.match(pkg, /makeEdgeDataUrlFromSegmentation\(/);
  assert.match(pkg, /capturePlan2dDataUrl\(/);
  // 動画用に自前で ren.render / toDataURL を書いていないこと。
  assert.doesNotMatch(pkg, /ren\.domElement\.toDataURL/);
});

test('既定の4ファイルが宣言されている', () => {
  assert.match(pkg, /reference\.png/);
  assert.match(pkg, /plan_context\.png/);
  assert.match(pkg, /prompt\.txt/);
  assert.match(pkg, /'package\.json'/);
});

// Task 6 の unliftableColors は「モデルが本当に見えていない部材」の名簿である。
// gamma だけ記録して落とすと、判定器はそれを普通の部材として測ってしまう。
test('持ち上げきれなかった部材も package.json に運ばれる', () => {
  const rec = bodyOf('function videoShadowLiftRecord', 1500);
  assert.match(rec, /unliftableColors/);
});

test('カーブが不適用でも gamma が記録される（判定器が推測しなくて済むように）', () => {
  const rec = bodyOf('function videoShadowLiftRecord', 1500);
  assert.match(rec, /applied/);
  assert.match(rec, /gamma/);
  assert.match(rec, /floorLuminance/);
});

// ── 家具の上面画像のレース（Task 3 が Task 7 に持ち越した前提条件） ──────
test('階を撮る前に家具の上面画像を待つ', () => {
  assert.match(html, /function waitForPlanFloorTopImages\(/);
  assert.match(pkg, /waitForPlanFloorTopImages\(/);
});

test('待ちを信じず、出てきた画素でプレースホルダを検出する', () => {
  const finder = bodyOf('function findPlanPlaceholderInstances', 3000);
  // 出力画素を見る。待ちの結果 (img.complete) を見るのではない。
  assert.match(finder, /imageData|\.data\[/);
  assert.doesNotMatch(finder, /\.complete/);
  assert.match(pkg, /findPlanPlaceholderInstances\(/);
});

test('プレースホルダの色は描画側と1か所を共有する（表を2つ持たない）', () => {
  // 逆算に使う定数が描画側とずれたら、検出は静かに効かなくなる。
  assert.match(html, /var PLAN_PLACEHOLDER_RGB=/);
  assert.match(html, /ctx\.fillStyle=PLAN_PLACEHOLDER_FILL;/);
  const could = bodyOf('function planPlaceholderCouldBe', 800);
  assert.match(could, /PLAN_PLACEHOLDER_ALPHA/);
  assert.match(could, /PLAN_PLACEHOLDER_RGB/);
});

test('プレースホルダが残っていたら黙って書き出さない', () => {
  assert.match(pkg, /throw new Error/);
});

// ── 光の形（Task 5 が Task 7 に持ち越した前提条件） ──────────────────────
test('光は1つの決まった形で渡される', () => {
  assert.match(html, /function videoDaylightDescriptor\(/);
  const d = bodyOf('function videoDaylightDescriptor', 1200);
  assert.match(d, /timeOfDay/);
  assert.match(pkg, /videoDaylightDescriptor\(/);
});

test('プロンプトに光の文が入らなかったら黙って続けない', () => {
  // compose は読めない daylight を黙って落とす。落ちたことを呼び出し側が検出して
  // 声を上げる。検出は「daylight 抜きで組んだ文と一致するか」で行うので、
  // LIGHT の鍵の表を index.html 側に写し取らない。
  assert.match(pkg, /composeVideoPromptOrThrow\(/);
  const guard = bodyOf('function composeVideoPromptOrThrow', 2000);
  assert.match(guard, /VideoPrompt\.compose/);
  assert.match(guard, /throw new Error/);
  assert.match(guard, /daylight/);
});

// ── package.json の中身 ─────────────────────────────────────────────────
test('package.json はカメラ・時刻・フロア・尺・プリセットidを持つ', () => {
  const j = bodyOf('function videoPackageJson', 3000);
  assert.match(j, /camera/);
  assert.match(j, /daylight/);
  assert.match(j, /floor/);
  assert.match(j, /durationSec/);
  assert.match(j, /presetId/);
});

test('package.json は撮影に使われた階高・天井高を持つ', () => {
  const j = bodyOf('function videoPackageJson', 3000);
  assert.match(j, /heightModel/);
  const hm = bodyOf('function videoHeightModelRecord', 2000);
  assert.match(hm, /HeightModel\.storyHeightMm\(/);
  assert.match(hm, /HeightModel\.ceilingShape\(|HeightModel\.ceilingLabel\(/);
});

test('尺は15秒を超えない', () => {
  assert.match(pkg, /MAX_DURATION_SEC/);
});

// ── "Mesh" の漏れ（Task 4 が Task 7 に持ち越した前提条件） ───────────────
test('instance legend の type に three.js のクラス名が漏れない', () => {
  const s = bodyOf('function aiInstanceSummary', 900);
  // ref が three.js の Object3D のときは .type を読まない（'Mesh' はクラス名）。
  assert.match(s, /isObject3D/);
});

// 色→階層の表だけでは「#a1b2c3 が変わった」としか言えない。判定器の指摘も、
// ユーザーに見せる要約 (設計 §10) も部材名で語る必要がある。既定パッケージには
// instance-legend.json を入れない方針なので、名前の対応は package.json が持つ。
test('package.json は色だけでなく部材名も持つ', () => {
  assert.match(html, /instances:packageInstances/,
    'package.json must carry an instance list, not just the colour->tier table');
  const build = html.slice(html.indexOf('var packageInstances='),
                           html.indexOf('var packageInstances=') + 500);
  for (const field of ['id', 'color', 'type', 'floor', 'tier']) {
    assert.match(build, new RegExp('\\b' + field + ':'), 'missing field: ' + field);
  }
  assert.match(build, /toLowerCase\(\)/,
    'colours must be normalised the same way LockTiers.tableFor normalises them');
});
