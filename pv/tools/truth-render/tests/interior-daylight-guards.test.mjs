// index.html の内観採光スイッチ(PV_INTERIOR_DAYLIGHT)が、
//   ・既定(null)では従来の内観3Dと寸分違わない値を出す
//   ・PVキャプチャで値が入ったときだけ太陽と天井を有効にする
// ことを、実際の index.html から該当行を取り出して評価して確かめる。
//
// three.js の描画そのものはここでは動かない(ブラウザが要る)。ここで固定するのは
// 「どちらの分岐へ落ちるか」— つまりオプトインが本当にオプトインであることだけ。
// 取り出しは行の完全一致で行うので、該当行が書き換われば必ずこのテストが落ちる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const indexPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'index.html');
const LINES = readFileSync(indexPath, 'utf8').split('\n');

// index.html 内で一意に決まる1行を取り出す。複数ヒット/ゼロヒットは、
// 取り違えたまま「何も検証していないテスト」になるのを防ぐため即失敗にする。
function sourceLine(fragment) {
  const hits = LINES.filter(l => l.includes(fragment));
  assert.equal(hits.length, 1,
    `index.html に "${fragment}" を含む行が ${hits.length} 本ある(1本であるべき)`);
  return hits[0].trim();
}

// index.html 内の関数を丸ごと取り出す。波括弧の対応を数えて末尾を決め、
// 釣り合わなければ失敗する(取り違えた断片を評価して「何も検証していない
// テスト」になるのを防ぐ)。
function sourceFunction(signature) {
  const start = LINES.findIndex(l => l.trim().startsWith(signature));
  assert.ok(start >= 0, `index.html に "${signature}" が見つからない`);
  let depth = 0, out = [];
  for (let i = start; i < LINES.length; i++) {
    out.push(LINES[i]);
    for (const ch of LINES[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && out.length > 1) {
      const text = out.join('\n');
      assert.ok(text.trimEnd().endsWith('}'), `"${signature}" の抽出が } で終わっていない`);
      return text;
    }
  }
  assert.fail(`"${signature}" の波括弧が閉じていない`);
}

const SUN_SCALE = sourceLine('var pvSunScale=');
const INTERIOR_MODE = sourceLine('var interiorMode=(');
const SUN_INTENSITY = sourceLine('o.intensity=interiorMode?0:LIGHT_SETTINGS.sun*pvSunScale;');
const SUN_CAST = sourceLine('o.castShadow=!interiorMode;');
const CEILING_MAT = sourceLine('var matCeiling=');
const SHADOW_FIT = sourceLine('if(_sunLight && (!isInt');

const CEILING_MAT_FN = sourceFunction('function makeCeilingMaterial()');
const CENSUS_FN = sourceFunction('function pvCeilingCensus()');
const NO_COVERED_ROOM_FN = sourceFunction('function pvAssertNoCoveredRoom(');
// buildRoomCeilingMesh が影の設定と userData を確定させる3つの文。
// **1行ずつ抜き出してはいけない。** userData の代入は行が伸びれば折り返され、
// 1行だけ取ると閉じ括弧の無い断片になって SyntaxError になる。実際に起きた:
// aiInstanceType を足した時点で2行になり、このテスト群が5件落ちたまま
// 数日気づかれなかった（このファイルを走らせていなかったため）。
// 文の終わり(;)まで読む。
function sourceStatement(prefix) {
  const start = LINES.findIndex(l => l.trim().startsWith(prefix));
  assert.ok(start >= 0, `index.html に "${prefix}" が見つからない`);
  const out = [];
  for (let i = start; i < LINES.length && i < start + 20; i++) {
    out.push(LINES[i]);
    if (LINES[i].trimEnd().endsWith(';')) return out.join('\n');
  }
  assert.fail(`"${prefix}" の文が ; で終わらない`);
}
const CEILING_FLAGS = [
  sourceStatement('var pvOccluder=!!('),
  sourceStatement('ceiling.castShadow=pvOccluder;'),
  sourceStatement('ceiling.userData={b:true,ceiling:true,'),
].join('\n');

function Mat(kind) {
  return function (params) { Object.assign(this, params || {}); this.kind = kind; this.dispose = () => { }; };
}
const THREE_STUB = {
  MeshStandardMaterial: Mat('standard'),
  MeshBasicMaterial: Mat('basic'),
  DoubleSide: 2,
};
const LIGHT_SETTINGS = { sun: 0.78, sunSim: false, timeOfDay: 'day' };

// applyLightingToScene の SunLight 分岐(sunSim OFF 側)をそのまま評価する。
function sunBranch({ view, isInt, daylight }) {
  const run = new Function('ST', 'isInt', 'PV_INTERIOR_DAYLIGHT', 'LIGHT_SETTINGS', 'o',
    `${SUN_SCALE}\n${INTERIOR_MODE}\n${SUN_CAST}\n${SUN_INTENSITY}\n` +
    'return {interiorMode:interiorMode, pvSunScale:pvSunScale, intensity:o.intensity, castShadow:o.castShadow};');
  return run({ view }, isInt, daylight, LIGHT_SETTINGS, {});
}

// buildRooms3D の天井マテリアル生成(makeCeilingMaterial 込み)をそのまま評価する。
function ceilingMaterial({ isInt, daylight }) {
  const run = new Function('isInt', 'PV_INTERIOR_DAYLIGHT', 'THREE',
    `${CEILING_MAT_FN}\n${CEILING_MAT}\nreturn matCeiling;`);
  return run(isInt, daylight, THREE_STUB);
}

// buildRoomCeilingMesh が「生成時に」決める天井メッシュ1枚を、実際の
// index.html の行だけで組み立てる。
function buildCeiling({ isInt, daylight, roomId = 'rm43' }) {
  const mat = ceilingMaterial({ isInt, daylight });
  const run = new Function('isInt', 'PV_INTERIOR_DAYLIGHT', 'ceiling', 'r',
    `${CEILING_FLAGS}\nreturn ceiling;`);
  return run(isInt, daylight, { isMesh: true, material: mat }, { id: roomId });
}

// フックの観測関数を、上で組み立てたメッシュに対してそのまま走らせる。
function census(meshes) {
  const run = new Function('sc3', `${CENSUS_FN}\nreturn pvCeilingCensus();`);
  return run({ traverse: fn => meshes.forEach(fn) });
}

function assertNoCoveredRoom(state, when) {
  const run = new Function('state', 'when',
    `${NO_COVERED_ROOM_FN}\nreturn pvAssertNoCoveredRoom(state,when);`);
  return run(state, when);
}

// build3D 末尾の影カメラフィットをそのまま評価する。呼ばれたかどうかは、
// 呼び出しを記録する fitShadowCamera を渡して見る。
function shadowFitCalls({ isInt, daylight }) {
  const calls = [];
  const run = new Function('isInt', 'PV_INTERIOR_DAYLIGHT', '_sunLight', 'fitShadowCamera',
    SHADOW_FIT + '\nreturn null;');
  run(isInt, daylight, { name: 'SunLight' }, l => calls.push(l));
  return calls.length;
}

test('通常の内観3D(スイッチ null): 太陽は消灯・影なし・天井を作らない・影カメラも合わせない', () => {
  const sun = sunBranch({ view: '3d-int', isInt: true, daylight: null });
  assert.equal(sun.interiorMode, true);
  assert.equal(sun.intensity, 0);
  assert.equal(sun.castShadow, false);
  assert.equal(ceilingMaterial({ isInt: true, daylight: null }), null);
  assert.equal(shadowFitCalls({ isInt: true, daylight: null }), 0);
});

test('外観3D(スイッチ null): 太陽の強度はプリセット値そのまま(×1 で値が変わらない)', () => {
  const sun = sunBranch({ view: '3d-ext', isInt: false, daylight: null });
  assert.equal(sun.interiorMode, false);
  assert.equal(sun.pvSunScale, 1);
  // 掛け算を差し込んだせいで外観の明るさが1ビットでも変われば、ここで落ちる。
  assert.equal(sun.intensity, LIGHT_SETTINGS.sun);
  assert.equal(Object.is(sun.intensity, 0.78), true);
  assert.equal(sun.castShadow, true);
  assert.equal(ceilingMaterial({ isInt: false, daylight: null }).kind, 'standard');
  assert.equal(shadowFitCalls({ isInt: false, daylight: null }), 1);
});

test('PVキャプチャの内観採光: 内観でも太陽が点き、影を落とし、天井が作られ、影カメラも合う', () => {
  const sun = sunBranch({ view: '3d-int', isInt: true, daylight: { sunScale: 1 } });
  assert.equal(sun.interiorMode, false);
  assert.equal(sun.intensity, LIGHT_SETTINGS.sun);
  assert.equal(sun.castShadow, true);
  assert.equal(ceilingMaterial({ isInt: true, daylight: { sunScale: 1 } }).kind, 'basic');
  assert.equal(shadowFitCalls({ isInt: true, daylight: { sunScale: 1 } }), 1);
});

test('sunScale は太陽の強度に効く', () => {
  assert.equal(sunBranch({ view: '3d-int', isInt: true, daylight: { sunScale: 1.5 } }).intensity, 0.78 * 1.5);
  // 壊れた値(0 や欠落)を渡しても暗転しない: 既定は等倍。
  assert.equal(sunBranch({ view: '3d-int', isInt: true, daylight: {} }).intensity, 0.78);
});

// ── 生成時にオクルーダーになること ───────────────────────────────
// ここが今回の事故の中心。以前はフックが build3D のあとに材質を差し替えていた
// ため、GLB読み込み完了で走る非同期の rebuild3D() が黙って元へ戻し、部屋全体が
// 不透明な天井で覆われた俯瞰が撮れた。生成時に決めていれば、何度作り直しても
// 同じものが出てくる。
test('PV採光の天井は、生成された時点で「描かないが影は落とす」', () => {
  const c = buildCeiling({ isInt: true, daylight: { sunScale: 1 } });
  assert.equal(c.material.kind, 'basic');
  assert.equal(c.material.colorWrite, false);
  assert.equal(c.material.depthWrite, false);
  assert.equal(c.material.transparent, true);   // ガイド画像から除外させる印
  assert.equal(c.material.opacity, 0);
  assert.equal(c.castShadow, true);
  assert.equal(c.receiveShadow, false);
  assert.equal(c.userData.ceiling, true);
  assert.equal(c.userData.ceilingOccluder, true);
});

test('外観の天井は従来どおり見える天井のまま(影は落とさない)', () => {
  const c = buildCeiling({ isInt: false, daylight: null });
  assert.equal(c.material.kind, 'standard');
  assert.equal(c.material.colorWrite, undefined); // 既定=描画する
  assert.equal(c.castShadow, false);
  assert.equal(c.receiveShadow, true);
  assert.equal(c.userData.ceilingOccluder, false);
});

test('何度作り直しても同じオクルーダーになる(再構築で巻き戻らない)', () => {
  // build3D が3回走ったのと同じこと。差し替え方式ならここで元へ戻っていた。
  const rebuilt = [0, 1, 2].map(() => buildCeiling({ isInt: true, daylight: { sunScale: 1 } }));
  const c = census(rebuilt);
  assert.deepEqual(c, { ceilings: 3, occluders: 3 });
});

test('観測(pvCeilingCensus)は、製品が実際に作る天井をオクルーダーと数える', () => {
  const meshes = [
    buildCeiling({ isInt: true, daylight: { sunScale: 1 }, roomId: 'rm43' }),
    buildCeiling({ isInt: true, daylight: { sunScale: 1 }, roomId: 'rm_x' }),
  ];
  assert.deepEqual(census(meshes), { ceilings: 2, occluders: 2 });
});

test('観測は userData の自己申告ではなくマテリアルの実値を見る', () => {
  // 「userData はオクルーダーだと言っているのに、材質だけ不透明に戻っている」＝
  // まさに今回の壊れ方。フラグを信じる実装ならここを見逃す。
  const fake = buildCeiling({ isInt: true, daylight: { sunScale: 1 } });
  fake.material = ceilingMaterial({ isInt: false, daylight: null }); // 再構築で戻った材質
  assert.equal(fake.userData.ceilingOccluder, true);
  assert.deepEqual(census([fake]), { ceilings: 1, occluders: 0 });
});

test('天井はあるのにオクルーダーが0枚なら、その場で例外(黙って撮らない)', () => {
  assert.throws(
    () => assertNoCoveredRoom({ enabled: true, ceilings: 2, ceilingOccluders: 0 }, 'before the first frame'),
    /opaque slab covering the room/);
  // 正常な状態と、そもそも採光を使わないショットは素通しする。
  assert.doesNotThrow(() => assertNoCoveredRoom({ enabled: true, ceilings: 2, ceilingOccluders: 2 }, 'x'));
  assert.doesNotThrow(() => assertNoCoveredRoom({ enabled: false, ceilings: 0, ceilingOccluders: 0 }, 'x'));
});

test('スイッチの既定値は null(通常の利用者には無効)', () => {
  assert.equal(sourceLine('var PV_INTERIOR_DAYLIGHT='), 'var PV_INTERIOR_DAYLIGHT=null;');
});

test('スイッチを立てるのは PV キャプチャフックの中だけ', () => {
  const hookStart = LINES.findIndex(l => l.includes('PV capture hook (guarded'));
  assert.ok(hookStart > 0, 'PV capture hook のブロックが見つからない');
  const assignments = LINES
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /PV_INTERIOR_DAYLIGHT\s*=[^=]/.test(l));
  assert.ok(assignments.length > 0);
  for (const { l, i } of assignments) {
    assert.ok(i > hookStart || l.trim() === 'var PV_INTERIOR_DAYLIGHT=null;',
      `PV_INTERIOR_DAYLIGHT がフックの外(${i + 1}行目)で書き換えられている: ${l.trim()}`);
  }
});
