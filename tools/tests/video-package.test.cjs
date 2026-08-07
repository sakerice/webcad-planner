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
  const sig = '\nfunction ' + name + '(';
  const at = html.indexOf(sig);
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
  // 2F の実データ: window 7 / stair+stair-corner / balcony 1
  assert.match(text, /seven windows/, '窓の数を名指ししていない: ' + text);
  assert.match(text, /a staircase/, '階段を名指ししていない');
  assert.match(text, /a balcony/, 'バルコニーを名指ししていない');
  // 名指しできないときの総称形に落ちていないこと
  assert.doesNotMatch(text, /The house is the one the reference draws/);
});

test('1F でも建具を数えて名指しする（階ごとに中身が変わる）', () => {
  const text = VideoPrompt.compose({
    preset: planPreset(), legend: planInstanceListOf(1),
    camera: null, daylight: { timeOfDay: 'day' }
  });
  assert.match(text, /four windows/, text);
  assert.match(text, /three sliding doors/);
  assert.match(text, /a front door/);
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

test('構図が小さすぎるパッケージは書き出されずに投げる', () => {
  const branch = planBranch();
  assert.match(branch, /PLAN_SUBJECT_MIN_FRAME_RATIO/);
  assert.match(branch, /planSubjectFrameRatio\(|planSubjectFrameRatio/);
  assert.match(branch, /throw new Error/);
});

test('平面図の参照は3D経路と同じ画素数で撮る', () => {
  const branch = planBranch();
  assert.match(branch, /fit:true/, '撮る前に構図を作っていない');
  assert.match(branch, /scale:/, '3D と同じ画素数で撮っていない');
});
