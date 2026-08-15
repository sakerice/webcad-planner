// 動画AIレンダー用パッケージの組み立て (Task 7)。
//
// このファイルは2層になっている。
//   前半 (Task 7 当時): index.html の**ソース文字列**を見る grep。守るのは
//     「経路を二重化しない」「既定を絞る」という構造だけで、挙動は見ていない。
//   後半 (Task 10-5): generateVideoRenderPackage を node:vm で**実際に走らせ**、
//     出てきた ZIP の中身と package.json の値を測る。
// 後半を足した理由は、全体レビューの実測で 22 の変異のうち 16 が全テスト緑のまま
// 生き残ったこと。grep は必要だが十分ではない。判断を下す側（ShadowLift・
// LockTiers・VideoPrompt・構図の検査・高さの解決）は後半では本物を通す。
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

// 関数の本体は「次の行頭 function まで」で切る。固定長で切ると、関数が育った日に
// 検査が静かに本体の外を見なくなる（この計画で既に3回起きた形）。
function functionBody(name) {
  const at = html.indexOf('function ' + name);
  assert.notEqual(at, -1, name + ' が index.html に無い');
  const rest = html.slice(at + 1);
  const end = rest.indexOf('\nfunction ');
  return rest.slice(0, end === -1 ? undefined : end);
}
const pkg = functionBody('generateVideoRenderPackage');
// 平面図ソースの枝だけを切り出す。3Dの撮影がこの枝に紛れ込んでいないことを見るため、
// 枝の終わりの目印はソース側にコメントとして置いてある。
function planBranch() {
  const at = pkg.indexOf("source==='plan'");
  assert.notEqual(at, -1, 'plan ソースの分岐が無い');
  const end = pkg.indexOf('平面図ソースはここへ来ない');
  assert.notEqual(end, -1, '3D経路の始まりを示す目印が無い');
  return pkg.slice(at, end);
}

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
  // 中身が正しいか（レンダの実寸と一致するか）は height-wiring.test.cjs が
  // videoHeightModelRecord を実際に走らせて測る。ここは配線だけを見る。
  assert.match(pkg, /videoHeightModelRecord\(/);
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

// ── Task 7b: 平面図そのものを参照にする経路 ──────────────────────────────
// 「図面が家になる」は素材が本当に図面のときだけ成立する。3Dレンダに図面用の文を
// 当てると、実測でモデルは渡した映像を捨てて線画を描き直した。素材とプリセットが
// 一対であることを、ユーザーの注意力ではなくコードで保証する。

test('平面図ソースでは reference.png が平面図で、プリセットは図面系になる', () => {
  assert.match(pkg, /capturePlan2dDataUrl\(/);
  assert.match(pkg, /source===['"]plan['"]/);
  // プリセットの候補は素材の種類から引く。'3d' を直書きしない。
  const resolver = functionBody('resolveVideoPreset');
  assert.match(resolver, /VideoPrompt\.presetsFor\(source\)/);
  assert.match(pkg, /resolveVideoPreset\(/);
  assert.doesNotMatch(pkg, /presetsFor\(\s*['"]3d['"]\s*\)/,
    'preset list must come from the source, not a hardcoded 3d');
});

test('素材とプリセットを取り違えたら、黙って差し替えずに投げる', () => {
  const resolver = functionBody('resolveVideoPreset');
  // 逆側の候補を引いて「なぜ噛み合わないか」を言う。
  assert.match(resolver, /presetsFor\(other\)/);
  assert.match(resolver, /throw new Error/);
  // 既定へ倒すのは presetId が指定されなかったときだけ。指定されたidが見つからない
  // まま presets[0] へ落ちるのが、参照を壊すプロンプトを黙って渡す経路である。
  assert.ok(resolver.lastIndexOf('throw new Error') < resolver.indexOf('presets[0]'),
    'the default preset must be reachable only after every mismatch has thrown');
});

test('平面図ソースでは構図の合わないガイドを同梱しない', () => {
  const branch = planBranch();
  for (const fn of ['captureSegmentation3DDataUrl', 'captureAiOverrideGuideDataUrl',
                    'makeEdgeDataUrlFromSegmentation', 'instance_guide.png']) {
    assert.ok(branch.indexOf(fn) === -1, 'plan branch must not ship ' + fn);
  }
});

test('平面図ソースでは3Dを1枚も撮らない（構図の合わない素材を作らない）', () => {
  const branch = planBranch();
  for (const fn of ['captureCurrent3DDataUrl', 'captureInstance3DData',
                    'ShadowLift.apply', 'ensureAiRenderableView']) {
    assert.ok(branch.indexOf(fn) === -1, 'plan branch must not call ' + fn);
  }
});

test('package.json は参照の出どころを記録する', () => {
  assert.match(html, /source:\s*(source|state\.source)/);
});

test('平面図ソースは同じ画像を2つの名前で入れない', () => {
  const branch = planBranch();
  assert.match(branch, /reference\.png/);
  assert.ok(branch.indexOf('plan_context.png') === -1,
    'reference.png IS the plan here; shipping the same bytes as plan_context.png is a duplicate');
});

test('持ち上げを「しなかった」ことも理由ごと記録される', () => {
  const rec = functionBody('videoShadowLiftRecord');
  assert.match(rec, /reason/);
  assert.match(planBranch(), /plan source/);
});

test('同梱しなかったものは理由ごと package.json に残る', () => {
  assert.match(html, /function videoPlanWithheldRecord\(/);
  const j = functionBody('videoPackageJson');
  assert.match(j, /withheld/);
  const w = functionBody('videoPlanWithheldRecord');
  assert.match(w, /reason/);
  assert.match(w, /requested/);
});

test('平面図ソースは表示中の階を撮り、暗黙に切り替えない', () => {
  const branch = planBranch();
  assert.match(branch, /ST\.floor/);
  assert.ok(branch.indexOf('setView(') === -1 && branch.indexOf('onFloorChange(') === -1,
    'plan branch must not switch view or floor behind the user');
});

test('平面図ソースでも家具の上面画像を待ち、画素で確かめる', () => {
  const branch = planBranch();
  assert.match(branch, /waitForPlanFloorTopImages\(/);
  assert.match(branch, /findPlanPlaceholderInstances\(/);
});

// ── Task 7c-2: 平面図経路にも部材の名指しを戻す ─────────────────────────
// 以下は grep ではなく**出力**を見る。index.html から planInstanceList を切り出して
// node で走らせ、実データ (assets/default_plan.json) を食わせ、その戻り値を
// 本物の VideoPrompt.compose に渡して、出てきた文に窓の数が入っているかを測る。
const vm = require('node:vm');
const LockTiers = require('../../assets/js/lock-tiers.js');
const VideoPrompt = require('../../assets/js/video-prompt.js');

function topLevelFunction2(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  if (at === -1) at = html.indexOf('\nasync function ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}
function topLevelVar2(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}
const PLAN_DATA = JSON.parse(readFileSync(join(__dirname, '..', '..', 'assets', 'default_plan.json'), 'utf8'));
function planListFor(data) {
  const src = [
    topLevelVar2('CONTEXT_EXTERIOR_TYPES'),
    topLevelFunction2('isContextExteriorItemType'),
    topLevelFunction2('isPlanAnnotationType'),
    topLevelFunction2('objectIdLabel'),
    topLevelFunction2('isPlanSubjectObject'),
    topLevelFunction2('planInstanceList')
  ].join('\n');
  const ctx = vm.createContext({ console: console, DATA: data || PLAN_DATA, LockTiers: LockTiers });
  vm.runInContext(src, ctx);
  return ctx.planInstanceList;
}
function planPreset() {
  const p = VideoPrompt.presetsFor('plan');
  assert.ok(p.length > 0);
  return p[0];
}

test('planInstanceList は DATA から、その階の部材を数える', () => {
  const list = planInstanceListOf(2);
  // 期待値はテスト側で独立に数える（実装の規則を写さない）
  const expect = [].concat(PLAN_DATA.walls, PLAN_DATA.rooms, PLAN_DATA.items).filter(function (o) {
    if (o.floor !== 2) return false;
    return ['memo', 'ruler', 'walk-route', 'site-rect', 'road',
            'neighbor-house', 'neighbor-building', 'utility-pole'].indexOf(o.type) === -1;
  }).length;
  assert.ok(expect > 0);
  assert.equal(list.length, expect);
});
function planInstanceListOf(floor) { return planListFor(null)(floor); }

test('planInstanceList の各件は id / type / floor / tier を持ち、色は持たない', () => {
  const list = planInstanceListOf(2);
  list.forEach(function (e) {
    assert.ok(e.id !== undefined && e.id !== null && String(e.id) !== '', 'id が無い');
    assert.equal(typeof e.type, 'string');
    assert.equal(e.floor, 2);
    // ガイド画像が無い経路なので、色で切り出す相手が居ない。色は嘘になる。
    assert.ok(!Object.prototype.hasOwnProperty.call(e, 'color'), 'color を持ってはいけない');
  });
  const ids = list.map(function (e) { return String(e.id); });
  assert.equal(new Set(ids).size, ids.length, 'id が重複している（部材を指せない）');
});

test('階層は LockTiers.tierOf の戻り値そのもの（分類規則を書き写さない）', () => {
  const list = planInstanceListOf(2);
  list.forEach(function (e) {
    assert.equal(e.tier, LockTiers.tierOf(e.type), e.type + ' の階層が違う');
  });
  const body = topLevelFunction2('planInstanceList');
  assert.match(body, /LockTiers\.tierOf\(/);
  assert.doesNotMatch(body, /'LOCKED'|"LOCKED"|'SOFT'|"SOFT"/,
    '階層の文字列を書き写している（分類が2か所になる）');
});

test('平面図経路のプロンプトが、この家の窓・階段・バルコニーを数えて名指しする', () => {
  const text = VideoPrompt.compose({
    preset: planPreset(), legend: planInstanceListOf(2),
    camera: null, daylight: { timeOfDay: 'day' }
  });
  // 2F の実データ: window+window-door 9 / balcony 1 / 引戸4(2Fトイレ・WIC連絡・CL・リネン庫)
  assert.match(text, /nine windows/, '窓の数を名指ししていない: ' + text);
  assert.match(text, /a balcony/, 'バルコニーを名指ししていない');
  assert.match(text, /four sliding doors/, '引戸を名指ししていない');
  // 名指しできないときの総称形に落ちていないこと
  assert.doesNotMatch(text, /The house is the one the reference draws/);
});

test('1F でも建具を数えて名指しする（階ごとに中身が変わる）', () => {
  const text = VideoPrompt.compose({
    preset: planPreset(), legend: planInstanceListOf(1),
    camera: null, daylight: { timeOfDay: 'day' }
  });
  assert.match(text, /nine windows/, text);
  assert.match(text, /three sliding doors/);
  assert.match(text, /a front door/);
  assert.match(text, /a staircase/, '階段を名指ししていない');
});

test('compose は色を必要としない（色は composer の要件ではない）', () => {
  const list = planInstanceListOf(2);
  const withColor = list.map(function (e) {
    return { id: e.id, color: '#abcdef', type: e.type, floor: e.floor, tier: e.tier };
  });
  const a = VideoPrompt.compose({ preset: planPreset(), legend: list, camera: null, daylight: 'day' });
  const b = VideoPrompt.compose({ preset: planPreset(), legend: withColor, camera: null, daylight: 'day' });
  assert.equal(a, b, '色の有無で文が変わる＝composer が色に結合している');
});

test('平面図経路の package.json の instances は null ではない', () => {
  const branch = planBranch();
  assert.match(branch, /planInstanceList\(/);
  // videoPackageJson に渡す state の instances だけを見る（capture.instances は
  // ガイド画像の中の件数なので、ガイドの無いこの経路では null が正しい）。
  const state = branch.slice(branch.indexOf('videoPackageJson({'), branch.indexOf('capture:'));
  assert.ok(state.length > 0);
  assert.doesNotMatch(state, /instances:\s*null/,
    'plan 経路は部材一覧を持てる。null を書き込むのは Task 7b の欠落そのもの');
  assert.match(state, /instances:/);
});

test('空の階の検査は両経路で同じ1か所を通る（文面を2つ持たない）', () => {
  assert.match(html, /function planEmptyFloorRefusal\(/);
  // 実際に投げるかどうかは、下の「実行する検査」が
  // generateVideoRenderPackage を走らせて測る。
  assert.equal((pkg.match(/planEmptyFloorRefusal\(/g) || []).length, 2,
    'plan 経路と 3D 経路の両方が同じ検査を通っていない');
});

test('平面図の参照は3D経路と同じ画素数で撮る', () => {
  const branch = planBranch();
  assert.match(branch, /fit:true/, '撮る前に構図を作っていない');
  assert.match(branch, /scale:/, '3D と同じ画素数で撮っていない');
});

// ════════════════════════════════════════════════════════════════════════════
// Task 10-5: 消しても緑のまま出荷される挙動に、**実行する**回帰テストを。
//
// 全体レビューの実測: index.html 側に当てた 22 の変異のうち 16 が全テスト緑のまま
// 生き残った。上の grep 群は「文字列が在るか」しか見ていないためである。
// （最悪の例: reference.png を持ち上げずに出荷し package.json にはガンマを書く、が
//  /ShadowLift\.(curveFor|apply)/ という grep を curveFor だけで満たして通った。）
//
// 以下は generateVideoRenderPackage を node:vm で**実際に走らせ**、出てきた
// ZIP の中身と package.json を測る。撮影・復号・ZIP 化だけを最小のスタブに置き換え、
// 判断を下す側（ShadowLift・LockTiers・VideoPrompt・構図の検査・高さの解決）は
// すべて本物を通す。
// ════════════════════════════════════════════════════════════════════════════
const ShadowLift = require('../../assets/js/shadow-lift.js');
const HeightModel = require('../../assets/js/height-model.js');

const FRAME = { w: 1400, h: 900 };            // Task 7b が実測に使ったビューポート
const SAVED_VIEW = PLAN_DATA.viewState.twoD;  // ユーザーが眺めていたパン・ズーム

function imageOf(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const px = fill(i % w, Math.floor(i / w));
    d[i * 4] = px[0]; d[i * 4 + 1] = px[1]; d[i * 4 + 2] = px[2]; d[i * 4 + 3] = 255;
  }
  return { data: d, width: w, height: h };
}
// 左半分が潰れた LOCKED 部材、右半分が明るい部材。持ち上げが必要な絵。
const DARK_RGB = [3, 3, 3];
const LIT = { legend: [
  { id: 'W1', color: '#ff0000', type: 'wall', floor: 2, ref: null },
  { id: 'I2', color: '#00ff00', type: 'sofa', floor: 2, ref: null }
] };
function meanLeftHalf(im) {
  let sum = 0, n = 0;
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width / 2; x++) {
      const p = (y * im.width + x) * 4;
      sum += im.data[p] + im.data[p + 1] + im.data[p + 2];
      n += 3;
    }
  }
  return sum / n;
}

const VIDEO_FNS = [
  'isContextExteriorItemType', 'isPlanAnnotationType', 'isFiniteCanvasValue',
  'getObjBounds', 'objectIdLabel',
  'isPlanSubjectObject', 'planSubjectBoundsMm', 'planContextBoundsMm', 'planFitViewFor',
  'planSubjectFrameRatio', 'planEmptyFloorRefusal',
  'videoRenderViewRefusalText', 'planPlaceholderError',
  'videoSourceLabel', 'resolveVideoPreset', 'composeVideoPromptOrThrow',
  'videoShadowLiftRecord', 'videoPlanWithheldRecord', 'videoPackageJson',
  'planInstanceList',
  // 高さ（package.json の heightModel はレンダと同じ経路で解く）
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber', 'roomExplicitCeilingMm', 'roomCeilingHeightM',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
    'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomCeilingSlopeM',
  'roomRenderedCeilingMm', 'roomRenderedCeilingShape', 'roomRenderedCeilingLabel',
  'videoHeightModelRecord',
  'generateVideoRenderPackage'
];
const VIDEO_VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM',
  'CONTEXT_EXTERIOR_TYPES', 'PLAN_FIT_MARGIN'];

// 撮影・復号・ZIP だけを置き換えた実行環境。
// capturePlan2dDataUrl は本物の planFitViewFor を使って「fit:true なら構図を作る、
// でなければユーザーの保存視点のまま」という現実の振る舞いを再現する。
// これで「3D経路から fit:true を外す」変異が本物の構図の検査に当たる。
function harness(opts) {
  const o = opts || {};
  const data = o.data || PLAN_DATA;
  const registry = new Map();
  const log = { captures: [], overlays: [], downloads: [], zips: [] };
  const baseIm = imageOf(20, 10, (x) => (x < 10 ? DARK_RGB : [180, 180, 180]));
  const instIm = imageOf(20, 10, (x) => (x < 10 ? [255, 0, 0] : [0, 255, 0]));
  registry.set('url:base', baseIm);
  registry.set('url:instance', instIm);
  let outN = 0;

  const ctx = vm.createContext({
    console: console, TextEncoder: TextEncoder,
    DATA: data, ST: { view: o.view || '3d-ext', floor: o.floor === undefined ? 2 : o.floor },
    LockTiers: LockTiers, ShadowLift: ShadowLift, VideoPrompt: VideoPrompt, HeightModel: HeightModel,
    waitFrame: function () { return Promise.resolve(); },
    isUnityRenderableView: function () { return ctx.ST.view === '3d-ext' || ctx.ST.view === '3d-int'; },
    videoDaylightDescriptor: function () { return o.daylight || { timeOfDay: 'day' }; },
    waitForPlanFloorTopImages: function () {
      return Promise.resolve({ images: 12, pending: 0, waitedMs: 0 });
    },
    planCaptureScaleForVideo: function () { return 1; },
    capturePlan2dDataUrl: function (co) {
      let view = { panX: SAVED_VIEW.panX, panY: SAVED_VIEW.panY, zoom: SAVED_VIEW.zoom };
      if (co.fit) {
        // 本物と同じ: fitBounds があればその箱、なければ主題そのもの
        const fv = ctx.planFitViewFor(co.fitBounds || ctx.planSubjectBoundsMm(co.floor),
          FRAME.w, FRAME.h);
        if (fv) view = fv;      // 本物と同じ: fit できないときは触らない
      }
      log.captures.push({ floor: co.floor, fit: !!co.fit, fitBounds: co.fitBounds || null,
        ceilingLabels: co.ceilingLabels });
      ctx.PLAN_CAPTURE_VIEW = {
        panX: view.panX, panY: view.panY, zoom: view.zoom,
        width: FRAME.w, height: FRAME.h, floor: co.floor, scale: 1
      };
      const url = 'url:plan' + log.captures.length;
      registry.set(url, imageOf(4, 4, () => [200, 200, 200]));
      registry.get(url).width = FRAME.w;
      registry.get(url).height = FRAME.h;
      return url;
    },
    captureCurrent3DDataUrl: function () { return 'url:base'; },
    captureInstance3DData: function () { return { dataUrl: 'url:instance', legend: LIT.legend }; },
    captureSegmentation3DDataUrl: function () { return 'url:seg'; },
    captureAiOverrideGuideDataUrl: function (k) { return 'url:' + k; },
    makeEdgeDataUrlFromSegmentation: function () { return Promise.resolve('url:edge'); },
    aiSegmentationLegend: function () { return []; },
    decodePngDataUrlToImageData: function (u) {
      const im = registry.get(u);
      if (!im) return Promise.reject(new Error('unknown image ' + u));
      return Promise.resolve(im);
    },
    imageDataToPngDataUrl: function (im) {
      const u = 'url:out' + (++outN);
      registry.set(u, im);
      return u;
    },
    findPlanPlaceholderInstances: function () { return o.placeholders || []; },
    videoCameraDescriptor: function (floor) {
      return { mode: 'exterior', floor: floor, posM: [20, 6, 6], targetM: [5, 4, 1],
               hFovDeg: 60, aspect: 1.5, eyeHeightM: 1.5, floorBaseYM: 0 };
    },
    drawPlanCameraOverlay: function (url, camera, view) {
      log.overlays.push({ url: url, view: view });
      return Promise.resolve('url:planctx');
    },
    dataUrlToBytes: function (u) { return Promise.resolve(new Uint8Array(Buffer.from(u, 'utf8'))); },
    makeZipBlob: function (files) { log.zips.push(files.map((f) => f.name)); return { zip: true }; },
    downloadBlobFile: function (name) { log.downloads.push(name); }
  });
  vm.runInContext(VIDEO_VARS.map(topLevelVar2)
    .concat(VIDEO_FNS.map(topLevelFunction2)).join('\n'), ctx);
  ctx.$log = log;
  ctx.$registry = registry;
  ctx.$baseIm = baseIm;
  return ctx;
}
// 出来上がった ZIP から、名前でファイルの中身（文字列）を取り出す。
function fileText(pkg, name) {
  const f = pkg.filesRaw.filter((e) => e.name === name)[0];
  assert.ok(f, name + ' が ZIP に入っていない');
  return Buffer.from(f.bytes).toString('utf8');
}
async function build(ctx, options) {
  const pkg = await ctx.generateVideoRenderPackage(Object.assign({ download: false }, options || {}));
  // files は {name,size} に畳まれているので、中身は VIDEO_RENDER_PACKAGE から取れない。
  // 代わりに dataUrlToBytes / TextEncoder の結果をそのまま持つ配列を組み直す。
  return pkg;
}

// ── 1. reference.png は本当に持ち上げられて出荷されるか ──────────────────
// 生き残った変異: `var reference=base;`（持ち上げずに出荷し、package.json には
// ガンマを書く）。grep /ShadowLift\.(curveFor|apply)/ は curveFor だけで満たされる。
test('reference.png は package.json が記録したカーブを実際に適用した画素である', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  const json = pkg.packageJson;
  assert.equal(json.shadowLift.applied, true, 'カーブが適用されたと記録されていない');
  assert.ok(json.shadowLift.gamma < 1, 'ガンマが 1 のまま: ' + json.shadowLift.gamma);

  // ZIP に入った reference.png の中身は dataUrlToBytes(url) の結果＝url の文字列
  // そのもの。その url が指す ImageData を取り出して、画素を直接測る。
  assert.ok(pkg.files.filter((f) => f.name === 'reference.png').length,
    'reference.png が ZIP に入っていない');
  const shipped = c.$registry.get(c.VIDEO_RENDER_PACKAGE.images.reference);
  assert.ok(shipped, '出荷された reference が画像として辿れない: '
    + c.VIDEO_RENDER_PACKAGE.images.reference);
  const before = meanLeftHalf(c.$baseIm);
  const after = meanLeftHalf(shipped);
  assert.ok(before < 5, '前提が壊れている（元画像が暗くない）: ' + before);
  assert.ok(after > before,
    'package.json はガンマ ' + json.shadowLift.gamma + ' を記録しているのに、'
    + '出荷された画素は持ち上がっていない (' + before.toFixed(2) + ' -> ' + after.toFixed(2) + ')');
  // 記録したガンマで元画像を持ち上げた結果と一致すること（別のカーブでもない）。
  const expected = meanLeftHalf(ShadowLift.apply(c.$baseIm, json.shadowLift));
  assert.ok(Math.abs(after - expected) < 1e-6,
    '出荷された画素が記録のカーブと一致しない: ' + after + ' vs ' + expected);
});

test('持ち上げきれなかった部材は名指しで package.json に残る', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  const rec = pkg.packageJson.shadowLift;
  assert.ok(Array.isArray(rec.unliftableColors));
  const shipped = c.$registry.get(c.VIDEO_RENDER_PACKAGE.images.reference);
  // 床に届いたか、届かなかったものとして名前が残っているか、のどちらか。
  assert.ok(meanLeftHalf(shipped) >= rec.floorLuminance
    || rec.unliftableColors.indexOf('#ff0000') >= 0,
    '暗いまま、記録もされずに通っている');
});

// ── 2. 家具プレースホルダの拒否 ──────────────────────────────────────────
test('灰色のプレースホルダが残っていたら3D経路は書き出さずに投げる', async () => {
  const c = harness({ view: '3d-ext', floor: 2,
    placeholders: [{ id: 9, type: 'sofa', color: '#c8c8c8', x: 0, y: 0, w: 10, h: 10 }] });
  await assert.rejects(() => build(c), (e) => {
    assert.match(e.message, /プレースホルダ/);
    return true;
  });
  assert.equal(c.$log.zips.length, 0, '拒否したのに ZIP を組んでいる');
  assert.equal(c.$log.downloads.length, 0);
});

test('灰色のプレースホルダが残っていたら平面図経路も書き出さずに投げる', async () => {
  const c = harness({ view: '2d', floor: 2,
    placeholders: [{ id: 9, type: 'sofa', color: '#c8c8c8', x: 0, y: 0, w: 10, h: 10 }] });
  await assert.rejects(() => build(c, { source: 'plan' }), /プレースホルダ/);
  assert.equal(c.$log.zips.length, 0);
});

// ── 3. Task 11-1: 拒否するのは「空の階」だけ ─────────────────────────────
test('設計要素の無い階は、そう名乗って止まる（両経路とも、その絵の名前で言う）', async () => {
  const a = harness({ view: '3d-ext', floor: 9 });
  await assert.rejects(() => build(a), (e) => {
    assert.match(e.message, /描くものがありません/, e.message);
    assert.match(e.message, /plan_context\.png/, e.message);
    // 撤回した理屈（占有率・空の映像）を名乗り直していないこと
    assert.doesNotMatch(e.message, /占めていません|空の映像/, e.message);
    return true;
  });
  assert.equal(a.$log.captures.length, 0, '空だと分かっているのに撮っている');
  assert.equal(a.$log.zips.length, 0);
  const b = harness({ view: '2d', floor: 9 });
  await assert.rejects(() => build(b, { source: 'plan' }), (e) => {
    assert.match(e.message, /描くものがありません/);
    assert.match(e.message, /平面図/);
    return true;
  });
  assert.equal(b.$log.zips.length, 0);
});

// 撤回そのものの回帰テスト。占有率が低い構図でも ZIP は出る。
// 「家が小さいと生成AIは空の映像を返す」は一度も測っていない主張だった。
test('家が小さく写る構図でも、拒否せずに書き出す（占有率に下限は無い）', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  const view = c.PLAN_CAPTURE_VIEW;
  const ratio = c.planSubjectFrameRatio(c.planSubjectBoundsMm(2), view, view.width, view.height);
  // カメラ（世界座標 x=20m, z=6m）まで入れた箱に fit するので、家そのものは
  // 主題だけに fit したとき (約0.9) よりずっと小さく写る。
  assert.ok(ratio < 0.7,
    'この構図では家が小さく写るはずだが ' + ratio.toFixed(3) + ' だった（前提が壊れている）');
  assert.ok(Array.from(pkg.files).some((f) => f.name === 'plan_context.png'),
    '小さく写ることを理由に plan_context.png が落とされている');
  // 測った値は捨てずに package.json へ残す（拒否ではなく開示）
  assert.ok(Math.abs(pkg.packageJson.capture.subjectFrameRatio - ratio) < 1e-9,
    '占有率が記録されていない: ' + pkg.packageJson.capture.subjectFrameRatio);
});

// ── 3b. Task 11-1: plan_context.png はカメラごと写す ──────────────────────
// この図の役目は「どこから撮っているか」を示すこと。カメラが画面外なら役目を
// 果たさない。実測（既定プラン 2F・保存視点 1400x900）ではカメラの三角が
// フレームの下へ出ていた。
test('plan_context.png はカメラの立ち位置がフレームに入るよう fit される', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  await build(c);
  assert.equal(c.$log.captures.length, 1);
  assert.equal(c.$log.captures[0].fit, true, 'fit:true が渡っていない');
  assert.ok(c.$log.captures[0].fitBounds, 'カメラ込みの箱が渡っていない');

  const cam = c.videoCameraDescriptor(2);
  const camX = cam.posM[0] / 0.001, camY = cam.posM[2] / 0.001;
  const view = c.PLAN_CAPTURE_VIEW;
  const sc = view.zoom * 0.05;
  const px = view.panX + camX * sc, py = view.panY + camY * sc;
  assert.ok(px >= 0 && px <= view.width && py >= 0 && py <= view.height,
    'カメラがフレームの外にいる: ' + px.toFixed(1) + ',' + py.toFixed(1));

  // 主題だけに fit した構図では、同じカメラは外へ出る（＝これが直した不良）
  const sv = c.planFitViewFor(c.planSubjectBoundsMm(2), FRAME.w, FRAME.h);
  const ssc = sv.zoom * 0.05;
  const spx = sv.panX + camX * ssc;
  assert.ok(spx > FRAME.w, '不良を再現できていない（主題 fit でもカメラが入る）: ' + spx);

  // 家も一緒に入っていること（カメラだけの図では文脈にならない）
  const b = c.planSubjectBoundsMm(2);
  [[b.minX, b.minY], [b.maxX, b.maxY]].forEach(function (p) {
    const x = view.panX + p[0] * sc, y = view.panY + p[1] * sc;
    assert.ok(x >= 0 && x <= view.width && y >= 0 && y <= view.height,
      '家がフレームから出ている: ' + x.toFixed(1) + ',' + y.toFixed(1));
  });
});

// reference.png（平面図ソース）は参照画像であり、カメラは描かれない。
// カメラ込みの箱で fit すると、参照そのものが無駄に小さくなる。
test('平面図ソースの reference.png は家だけに fit する（カメラの箱を使わない）', async () => {
  const c = harness({ view: '2d', floor: 2 });
  await build(c, { source: 'plan' });
  assert.equal(c.$log.captures.length, 1);
  assert.equal(c.$log.captures[0].fitBounds, null,
    'reference.png にカメラ込みの箱が渡っている');
  const view = c.PLAN_CAPTURE_VIEW;
  const ratio = c.planSubjectFrameRatio(c.planSubjectBoundsMm(2), view, view.width, view.height);
  assert.ok(ratio > 0.9, '家に fit していない: ' + ratio.toFixed(3));
  assert.ok(Math.abs(c.VIDEO_RENDER_PACKAGE.packageJson.capture.subjectFrameRatio - ratio) < 1e-9,
    '平面図経路が占有率を記録していない');
});

test('カメラの三角は「撮ったときの」座標系で重ねられる（ST ではなく）', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  await build(c);
  assert.equal(c.$log.overlays.length, 1);
  const passed = c.$log.overlays[0].view;
  assert.ok(passed, 'drawPlanCameraOverlay に撮影時の視点が渡っていない');
  assert.equal(passed.zoom, c.PLAN_CAPTURE_VIEW.zoom);
  assert.notEqual(Math.round(passed.zoom * 1e6), Math.round(SAVED_VIEW.zoom * 1e6),
    'fit した構図ではなくユーザーの保存視点が渡っている');
});

// ── 4. プリセットと素材の不一致の拒否 ────────────────────────────────────
test('平面図用プリセットで3Dを撮ろうとしたら投げる（黙って差し替えない）', async () => {
  const planId = VideoPrompt.presetsFor('plan')[0].id;
  const c = harness({ view: '3d-ext', floor: 2 });
  await assert.rejects(() => build(c, { presetId: planId }), (e) => {
    assert.match(e.message, new RegExp(planId));
    assert.match(e.message, /平面図/);
    return true;
  });
  assert.equal(c.$log.zips.length, 0, '取り違えたまま ZIP を組んでいる');
});

test('3D用プリセットで平面図を撮ろうとしても投げる（逆向きも塞ぐ）', async () => {
  const d3Id = VideoPrompt.presetsFor('3d')[0].id;
  const c = harness({ view: '2d', floor: 2 });
  await assert.rejects(() => build(c, { source: 'plan', presetId: d3Id }),
    new RegExp(d3Id));
  assert.equal(c.$log.zips.length, 0);
});

test('存在しないプリセットidは既定へ倒れずに投げる', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  await assert.rejects(() => build(c, { presetId: 'no-such-preset' }), /存在しません/);
});

// ── 5. 光の文が入らなかったときの拒否 ────────────────────────────────────
test('プロンプトに光の文を書けなかったら、黙って続けずに投げる', async () => {
  const c = harness({ view: '3d-ext', floor: 2, daylight: { timeOfDay: 'no-such-hour' } });
  await assert.rejects(() => build(c), (e) => {
    assert.match(e.message, /光の状態/);
    assert.match(e.message, /no-such-hour/);
    return true;
  });
  assert.equal(c.$log.zips.length, 0);
});

test('光の文が書けたときは、その文がプロンプトに実際に入っている', async () => {
  const c = harness({ view: '3d-ext', floor: 2, daylight: { timeOfDay: 'day' } });
  const pkg = await build(c);
  const withoutLight = VideoPrompt.compose({
    preset: VideoPrompt.presetsFor('3d')[0], legend: LIT.legend,
    camera: c.videoCameraDescriptor(2)
  });
  assert.notEqual(pkg.prompt, withoutLight, '光の文が入っていない');
  assert.ok(pkg.prompt.length > withoutLight.length);
});

// ── 6. ウォークスルーからは撮らない（Task 10-4）──────────────────────────
test('ウォークスルーから押すと、理由を言って拒否する（黙って外観へ寄せない）', async () => {
  const c = harness({ view: '3d-walk', floor: 2 });
  await assert.rejects(() => build(c), (e) => {
    assert.match(e.message, /ウォークスルー/);
    assert.match(e.message, /外観3D/);
    return true;
  });
  assert.equal(c.ST.view, '3d-walk', 'ユーザーのビューを勝手に切り替えている');
  assert.equal(c.$log.captures.length, 0, '拒否したのに撮っている');
  assert.equal(c.$log.zips.length, 0);
});

// ── 7. 高さの記録（Task 10-1 の package.json 側）──────────────────────────
test('package.json の天井高は、レンダが置いた実寸と一致する', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  const hm = pkg.packageJson.heightModel;
  assert.equal(hm.storyHeightMm, 2700);
  assert.ok(hm.rooms.length > 0);
  hm.rooms.forEach(function (r) {
    assert.equal(r.ceiling.type, 'flat');
    assert.equal(r.ceiling.heightMm, 2520,
      '2階の実寸は 2520（階高 2700 - 床スラブ 180）。' + r.id + ' は ' + r.ceiling.heightMm);
    assert.equal(r.label, 'CH 2520', r.id + ' のラベル: ' + r.label);
  });
});

// ── 8. 通ったときは4ファイルが揃う（拒否のテストの対照）────────────────
test('通れば既定の4ファイルが揃い、ZIP に入る', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  assert.equal(Array.from(pkg.files).map((f) => f.name).join(','),
    'reference.png,plan_context.png,prompt.txt,package.json');
  assert.equal(Array.from(c.$log.zips[0]).join(','),
    'reference.png,plan_context.png,prompt.txt,package.json');
  assert.equal(JSON.parse(pkg.packageJsonText).source, '3d');
});

test('平面図経路は平面図そのものを参照にし、3Dを1枚も撮らない', async () => {
  const c = harness({ view: '2d', floor: 2 });
  const pkg = await build(c, { source: 'plan' });
  assert.equal(Array.from(pkg.files).map((f) => f.name).join(','),
    'reference.png,prompt.txt,package.json');
  assert.equal(pkg.packageJson.source, 'plan');
  assert.equal(pkg.packageJson.shadowLift.applied, false);
  assert.equal(c.$log.captures[0].fit, true);
});

// ── 9. カメラの三角は「撮ったときの」座標系で重なるか（実際に描かせて測る）──
// 上の「渡っているか」の検査は引数しか見ない。ここは drawPlanCameraOverlay を
// 本当に走らせ、キャンバスに打たれた頂点の座標を測る。fit した構図は撮影後に
// finally で戻るので、ST を読むと三角は絵と無関係な場所に出る。
function overlayHarness(view) {
  const ops = [];
  const cx = {
    drawImage: function () {}, save: function () {}, restore: function () {},
    beginPath: function () { ops.push(['beginPath']); },
    moveTo: function (x, y) { ops.push(['moveTo', x, y]); },
    lineTo: function (x, y) { ops.push(['lineTo', x, y]); },
    closePath: function () {}, fill: function () {}, stroke: function () {},
    arc: function (x, y) { ops.push(['arc', x, y]); },
    fillStyle: '', strokeStyle: '', lineWidth: 0
  };
  const ctx = vm.createContext({
    console: console,
    ST: { panX: 999999, panY: 999999, zoom: 40 },     // 「戻ったあとの」ユーザー視点
    PLAN_CAPTURE_VIEW: view,
    document: { createElement: function () {
      return { width: 0, height: 0, getContext: function () { return cx; },
               toDataURL: function () { return 'url:overlaid'; } };
    } },
    Image: function () {
      const self = this;
      Object.defineProperty(this, 'src', {
        set: function () { setTimeout(function () { self.onload(); }, 0); }
      });
      this.naturalWidth = FRAME.w;
      this.naturalHeight = FRAME.h;
    }
  });
  vm.runInContext([topLevelVar2('U'), topLevelFunction2('drawPlanCameraOverlay')].join('\n'), ctx);
  ctx.$ops = ops;
  return ctx;
}

test('カメラの三角は、撮影時のパン・ズームで打たれる（ST を読んでいない）', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const bounds = c.planSubjectBoundsMm(2);
  const view = c.planFitViewFor(bounds, FRAME.w, FRAME.h);
  const o = overlayHarness(view);
  const camera = { posM: [5, 1.5, 3], targetM: [8, 1.5, 6], hFovDeg: 60 };
  const url = await o.drawPlanCameraOverlay('url:plan', camera, view);
  assert.equal(url, 'url:overlaid');

  const apex = o.$ops.filter((op) => op[0] === 'arc')[0];
  assert.ok(apex, 'カメラ位置の点が打たれていない');
  const sc = view.zoom * 0.05;
  const wantX = view.panX + (camera.posM[0] / 0.001) * sc;
  const wantY = view.panY + (camera.posM[2] / 0.001) * sc;
  assert.ok(Math.abs(apex[1] - wantX) < 1e-6 && Math.abs(apex[2] - wantY) < 1e-6,
    'カメラ位置が撮影時の座標系で打たれていない: ' + apex[1] + ',' + apex[2]
    + ' expected ' + wantX + ',' + wantY);
  // 打たれた位置が絵の中にあること（ST を読むと 999999 側へ飛ぶ）
  assert.ok(apex[1] >= 0 && apex[1] <= FRAME.w && apex[2] >= 0 && apex[2] <= FRAME.h,
    'カメラ位置がフレームの外に出ている: ' + apex[1] + ',' + apex[2]);
});

// 敷地の方位を伝えないと、生成AIは光の向きを自分で決める。実測で一度、
// 光の無いレンダに対して「窓から差す午後の光」を頼み、モデルが好きな場所に
// 光源を発明したことがある。方位はその再発の芽になる。
// 方位はプランが持つ (DATA.northDeg)。照明側 (LIGHT_SETTINGS) は写しなので読まない。
test('動画パッケージの daylight は敷地の方位を持つ', () => {
  const i = html.indexOf('function videoDaylightDescriptor');
  assert.notEqual(i, -1);
  const body = html.slice(i, html.indexOf('\n}', i));
  assert.match(body, /northDeg:\s*planNorthDeg\(\)/,
    'the bearing must come from the plan, not from the lighting mirror');
  assert.doesNotMatch(body, /northDeg:\s*LIGHT_SETTINGS/,
    'reading the mirror would go stale the moment the plan is reloaded');
});

// 方位の定義。地図と同じく、既定ではキャンバスの上が北。
// スライダのラベルは「北の方角」で、値は **北がどちらを向いているか** を表す
// （0度=上、90度=右）。したがって北が45度回れば、上を向いた面は北から
// 反時計回りに45度、つまり **北西** を向く。
// この定義は太陽の位置・斜線制限の面・立面図の呼称が共有しており、
// どれか1つだけ符号を変えると図面が法的な制限面と矛盾する。
test('方位の既定はキャンバスの上が北', () => {
  const i = html.indexOf('function computeSunPosition');
  assert.notEqual(i, -1);
  const body = html.slice(i, html.indexOf('\n}', i));
  // 画面奥(-Z)を北とし、northDeg ぶん回す。符号が反転すると太陽が逆から差す。
  assert.match(body, /az\s*\+\s*Math\.PI\s*\+\s*\(northDeg\s*\|\|\s*0\)/,
    'the bearing must ADD to the azimuth; negating it swings the sun the wrong way');
  const slider = html.slice(html.indexOf('id="sun-north"') - 260, html.indexOf('id="sun-north"') + 120);
  assert.match(slider, /value="0"/, 'the default bearing is north-up, like a map');
  assert.match(slider, /北の方角/, 'the label states what the value means');
});

// ── 4. Task 26-4: 3D経路の階層が、消しても緑のまま出荷されないように ──────
// 生き残った変異: 3D経路が package.json に書く部材の階層をすべて FREE にする。
// 判定器は FREE を「生成AIの領分」として測らないので、**何も測らなくなる**。
// 併せて、色→階層の表そのものが空になる変異も塞ぐ（同じ結果になる）。
test('26-4(最重要): 3D経路の色→階層の表は空にならず、LockTiers の分類そのものになる', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  const table = pkg.packageJson.lockTiers;
  assert.ok(table && typeof table === 'object', 'lockTiers が無い');
  const colors = Object.keys(table);
  assert.equal(colors.length, LIT.legend.length,
    'ガイドに写った部材の数だけ色がある: ' + JSON.stringify(table));
  // 期待値はテスト側で独立に引く（実装の分類規則を書き写さない）。
  LIT.legend.forEach((e) => {
    assert.equal(table[e.color.toLowerCase()], LockTiers.tierOf(e.type),
      e.type + ' (' + e.color + ') の階層が違う: ' + JSON.stringify(table));
  });
  assert.ok(colors.some((k) => table[k] !== 'FREE'),
    'すべて FREE になっている＝判定器が1つも測らない');
});

test('26-4(最重要): 3D経路の instances の階層も LockTiers の分類そのもの', async () => {
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  const list = pkg.packageJson.instances;
  assert.ok(Array.isArray(list) && list.length === LIT.legend.length,
    'instances が無い/数が合わない: ' + JSON.stringify(list));
  list.forEach((e) => {
    const src = LIT.legend.filter((x) => x.id === e.id)[0];
    assert.ok(src, '知らない部材が混ざっている: ' + JSON.stringify(e));
    assert.equal(e.tier, LockTiers.tierOf(src.type), src.type + ' の階層が違う');
  });
  // 建具・躯体は必ず LOCKED 側に残る（すべて FREE にする変異はここで赤くなる）。
  const locked = list.filter((e) => e.tier === 'LOCKED');
  assert.ok(locked.length >= 1,
    'LOCKED の部材が1つも無い＝判定器が何も測らない: ' + JSON.stringify(list));
  assert.equal(locked[0].type, 'wall');
});

test('26-4(最重要): 階層が全部 FREE になると、暗部の持ち上げも起きない', async () => {
  // 「FREE の部材は持ち上げの理由にならない」(shadow-lift.js) ので、階層が
  // 死ぬと reference.png も持ち上がらない。ここは同じ入力を2通りの表で通し、
  // その因果を実際に測る（変異が何を壊すのかを、テスト自身が示す）。
  const c = harness({ view: '3d-ext', floor: 2 });
  const pkg = await build(c);
  assert.equal(pkg.packageJson.shadowLift.applied, true, '本物の表では持ち上がる');
  const allFree = {};
  Object.keys(pkg.packageJson.lockTiers).forEach((k) => { allFree[k] = 'FREE'; });
  const dead = ShadowLift.curveFor(ShadowLift.measure(c.$baseIm,
    c.$registry.get('url:instance'), allFree));
  assert.equal(dead.applied, false,
    'すべて FREE でも持ち上がってしまう＝この試験は階層の生死を見ていない');
});
