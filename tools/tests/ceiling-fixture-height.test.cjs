// 天井付けの器具(シーリングライト・ダウンライト・シーリングファン)が、
// その場の天井仕上げ面に付いているか。
//
// 土台は height-runtime.cjs。あちらが index.html と assets/js/ から関数を
// 切り出して node:vm に載せる。ここは載せた関数を実際に走らせて数値で見る。
// grep の検査(height-defaults / height-wiring)は「式がそこに在るか」までしか
// 見られず、基準の取り違えはすり抜ける。取り違えは必ず浮くか埋まる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { makeCtx } = require('./height-runtime.cjs');

// 凍結した間取り。出荷する assets/default_plan.json を読むと、既定間取りを
// 良くするたびにここが落ちる(役割は fixtures/README.md)。
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const copyFixture = () => JSON.parse(JSON.stringify(FIXTURE));

// 検査用の最小の間取り。既定は 壁2400 + 天井仕上げ12mm の旧モデル。
function plan(extra) {
  return Object.assign({ walls: [], rooms: [], items: [], floors: {}, heightDefaults: {} }, extra);
}
const room = (o) => Object.assign({ id: 'r1', type: 'room', floor: 1, x: 0, y: 0, w: 4000, d: 3000 }, o);
const light = (o) => Object.assign({ id: 1, type: 'light-ceiling', floor: 1, x: 1000, y: 1000, w: 400, d: 400 }, o);

// 旧実装の当て推量。壁の高さから 160mm 引いていただけで、床スラブも天井仕上げも
// 見ていなかった。これと一致したら、直したはずの式が戻っている。
const oldGuess = (g, floor) => Math.round(g.wallFullHeightM(floor) / g.U) - 160;

test('凍結した間取りの天井付け器具は、すべてその場の天井仕上げ面に付いている', () => {
  const data = copyFixture();
  const g = makeCtx(data);
  const mounted = [];
  const off = [];
  data.items.forEach((it) => {
    const topOff = g.CEILING_FIXTURE_TOP_MM[it.type];
    if (topOff === undefined) return;
    const cx = it.x + it.w / 2, cy = it.y + it.d / 2;
    // 玄関ポーチの軒下など、部屋の外の器具は天井が無いので対象外。
    if (!g.roomAtPointOnFloor(it.floor || 1, cx, cy)) return;
    mounted.push(it);
    const want = g.ceilingFinishElevationMm(it.floor || 1, cx, cy) - topOff;
    const gap = (Number(it.elev) || 0) - want;
    if (Math.abs(gap) > 1) off.push(it.type + '(' + it.floor + 'F) elev=' + it.elev + ' 天井面=' + want + ' ずれ=' + gap);
  });
  // 空振りの検査にしない。0件を合格として報告した事故があった。
  assert.ok(mounted.length >= 30, '対象の器具が数えられていない: ' + mounted.length + '個');
  assert.ok(mounted.some((it) => it.type === 'fmp-CeilingFan01'), 'シーリングファンが対象に入っていない');
  assert.deepEqual(off, [], '天井面から浮いている/埋まっている器具がある');
});

test('既定の取付高さは天井仕上げ面と同じで、旧実装の当て推量ではない', () => {
  const g = makeCtx(copyFixture());
  // 1階は当て推量より148mm高い(=旧実装では天井から148mm下に浮いていた)。
  assert.equal(g.ceilingFinishElevationMm(1, NaN, NaN), 2688);
  assert.equal(g.defaultLightElevationMm(1, NaN, NaN), 2688);
  assert.equal(oldGuess(g, 1), 2540);
  // 2階は当て推量より32mm低い(=旧実装では天井裏に埋まっていた)。
  assert.equal(g.ceilingFinishElevationMm(2, NaN, NaN), 2508);
  assert.equal(g.defaultLightElevationMm(2, NaN, NaN), 2508);
  assert.equal(oldGuess(g, 2), 2540);
});

test('床を上げ下げしても器具は天井に残る（動くのは elev の数字だけ）', () => {
  const flat = makeCtx(plan({ rooms: [room({})] }));
  const ceiling = flat.ceilingFinishElevationMm(1, 2000, 1500);
  const raised = makeCtx(plan({ rooms: [room({ floorRaiseMm: 150 })] }));
  // elev は床仕上げ面から測る。床が150mm上がれば、同じ天井面までは150mm近い。
  assert.equal(raised.ceilingFinishElevationMm(1, 2000, 1500), ceiling - 150);
  assert.equal(raised.defaultLightElevationMm(1, 2000, 1500), ceiling - 150);
});

test('折り上げ・折り下げ天井の下では、その段差に追従する', () => {
  // 天井範囲は ceiling-designer.js が持つ。ここは段差だけを与えて、
  // 取付高さがその分動くことを見る。
  const down = makeCtx(plan({ rooms: [room({})] }));
  const ceiling = down.ceilingFinishElevationMm(1, 2000, 1500);
  down.CeilingDesigner = { offsetAt: () => -150 };
  assert.equal(down.ceilingFinishElevationMm(1, 2000, 1500), ceiling - 150);
  const up = makeCtx(plan({ rooms: [room({})] }));
  up.CeilingDesigner = { offsetAt: () => 150 };
  assert.equal(up.ceilingFinishElevationMm(1, 2000, 1500), ceiling + 150);
});

test('高さモデルv2では、壁の高さがそのまま天井面（仕上げ厚を二重に引かない）', () => {
  // v2 の壁の高さは「仕上げ床 → 仕上げ天井」。旧モデルのように 12mm を引くと、
  // 器具が天井裏へ12mm埋まる。
  const g = makeCtx(plan({ rooms: [room({})], heightDefaults: { modelVersion: 2, floorThickness: 180 } }));
  assert.equal(g.usesFinishedHeightModel(), true);
  assert.equal(g.defaultWallHeightMmForFloor(1), 2400);
  assert.equal(g.ceilingFinishElevationMm(1, 2000, 1500), 2400);
  assert.equal(g.defaultLightElevationMm(1, 2000, 1500), 2400);
  // 階高は壁の高さ + 床厚。天井面はそこから床厚を引いた位置に戻る。
  assert.equal(g.storyHeightMmForFloor(1), 2580);
});

test('保存済みプランの寄せ直しは、ずれたものだけを動かし、屋外には触らない', () => {
  // 既定プランは全灯 elev=2380 の一律だった。式を直しても保存済みの値は古いまま
  // なので、読み込み時に1度だけ寄せ直す。
  const data = plan({
    rooms: [room({})],
    items: [
      light({ id: 1, elev: 2380 }),
      light({ id: 2, type: 'fmp-CeilingFan01', x: 2000, y: 1000, w: 1200, d: 1200, elev: 2380 }),
      light({ id: 3, type: 'light-down', x: 9000, y: 9000, w: 100, d: 100, elev: 2380 }),
      light({ id: 4, type: 'sofa', x: 500, y: 500, w: 1800, d: 800, elev: 0 })
    ]
  });
  const g = makeCtx(data);
  const ceiling = g.ceilingFinishElevationMm(1, 1200, 1200);
  assert.equal(g.snapCeilingFixturesToCeiling(), 2);
  assert.equal(data.items[0].elev, ceiling);              // シーリングライトは天井面そのもの
  assert.equal(data.items[1].elev, ceiling - 350);        // ファンは器具の上端ぶん下がる
  assert.equal(data.items[2].elev, 2380);                 // 部屋の外は天井が無いので触らない
  assert.equal(data.items[3].elev, 0);                    // 天井付けでない家具は対象外
  // 2度目は動かさない。意図して下げたペンダントを天井へ戻してしまうため。
  assert.equal(data.planFixes.ceilingFixtureElev, 1);
  assert.equal(g.snapCeilingFixturesToCeiling(), 0);
  data.items[0].elev = 1500;
  assert.equal(g.snapCeilingFixturesToCeiling(), 0);
  assert.equal(data.items[0].elev, 1500);
});

test('部屋が読めていないうちは寄せ直さず、済んだ印も付けない', () => {
  // 印を先に付けてしまうと、部屋が入った次の読み込みで二度と直せなくなる。
  const data = plan({ items: [light({ elev: 2380 })] });
  const g = makeCtx(data);
  assert.equal(g.snapCeilingFixturesToCeiling(), 0);
  assert.equal(data.items[0].elev, 2380);
  assert.equal(data.planFixes.ceilingFixtureElev, undefined);
});
