const test = require('node:test');
const assert = require('node:assert/strict');
const ShadowLift = require('../../assets/js/shadow-lift.js');

// w*h の ImageData 相当。ブラウザの ImageData と同じ形 {data, width, height}。
function img(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    const px = fill(Math.floor(i / 4) % w, Math.floor(i / 4 / w));
    d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = 255;
  }
  return { data: d, width: w, height: h };
}
const TIERS = { '#ff0000': 'LOCKED', '#00ff00': 'SOFT', '#0000ff': 'FREE' };
// 左1/3が真っ暗な LOCKED、中1/3が明るい SOFT、右1/3が FREE
const instance = img(30, 10, x => x < 10 ? [255, 0, 0] : x < 20 ? [0, 255, 0] : [0, 0, 255]);
const base = img(30, 10, x => x < 10 ? [2, 3, 2] : x < 20 ? [180, 175, 170] : [90, 90, 90]);

test('部材ごとの平均輝度が測れる', () => {
  const m = ShadowLift.measure(base, instance, TIERS);
  const dark = m.find(e => e.color === '#ff0000');
  assert.equal(dark.tier, 'LOCKED');
  assert.ok(dark.meanLuminance < 5, 'measured ' + dark.meanLuminance);
  assert.equal(dark.pixels, 100);
});

test('潰れた部材があればカーブが適用される', () => {
  const curve = ShadowLift.curveFor(ShadowLift.measure(base, instance, TIERS));
  assert.equal(curve.applied, true);
  assert.ok(curve.gamma < 1, 'a lift needs gamma < 1, got ' + curve.gamma);
});

test('持ち上げ後、最も暗い LOCKED/SOFT 部材は輝度30以上になる', () => {
  const curve = ShadowLift.curveFor(ShadowLift.measure(base, instance, TIERS));
  const lifted = ShadowLift.apply(base, curve);
  const m = ShadowLift.measure(lifted, instance, TIERS);
  const dark = m.find(e => e.color === '#ff0000');
  assert.ok(dark.meanLuminance >= 30, 'still ' + dark.meanLuminance);
});

test('ハイライトはクリップしない', () => {
  const white = img(4, 4, () => [255, 255, 255]);
  const curve = { applied: true, gamma: 0.4, floorLuminance: 30 };
  const out = ShadowLift.apply(white, curve);
  assert.equal(out.data[0], 255);
});

test('元の ImageData は変更されない', () => {
  const before = base.data[0];
  ShadowLift.apply(base, { applied: true, gamma: 0.4, floorLuminance: 30 });
  assert.equal(base.data[0], before);
});

// FREE は生成AIに任せる領域なので、暗いままでも持ち上げの理由にならない。
test('FREE の部材だけが暗くてもカーブは適用されない', () => {
  const b = img(30, 10, x => x < 20 ? [180, 175, 170] : [1, 1, 1]);
  const curve = ShadowLift.curveFor(ShadowLift.measure(b, instance, TIERS));
  assert.equal(curve.applied, false);
});

test('十分明るければ何もしない（applied:false）', () => {
  const b = img(30, 10, () => [180, 175, 170]);
  const curve = ShadowLift.curveFor(ShadowLift.measure(b, instance, TIERS));
  assert.equal(curve.applied, false);
});

test('applied:false のカーブを適用しても絵は1バイトも変わらない', () => {
  const out = ShadowLift.apply(base, { applied: false });
  assert.deepEqual(Array.from(out.data), Array.from(base.data));
});

// --- ここから下は brief の外。曖昧さの解消として指示された不変条件を構成的に検査する ---

// 白1点ではなく全256階調 x 複数ガンマで、上端が動かず順序も壊れないことを確かめる。
test('どのガンマでも 255 は 255 のまま、単調で、範囲外に出ない', () => {
  const ramp = img(256, 1, x => [x, x, x]);
  for (const gamma of [0.2, 0.4, 0.55, 0.75, 0.9, 1.0]) {
    const out = ShadowLift.apply(ramp, { applied: true, gamma, floorLuminance: 30 });
    assert.equal(out.data[255 * 4], 255, 'white clipped/darkened at gamma ' + gamma);
    assert.equal(out.data[0], 0, 'black moved at gamma ' + gamma);
    let prev = -1;
    for (let x = 0; x < 256; x++) {
      const v = out.data[x * 4];
      assert.ok(v >= x, 'lift darkened ' + x + ' at gamma ' + gamma);
      assert.ok(v <= 255, 'out of range at ' + x + ' gamma ' + gamma);
      assert.ok(v >= prev, 'non-monotonic at ' + x + ' gamma ' + gamma);
      prev = v;
    }
    // 不変条件だけでは「何もしない apply」も通ってしまうので、実際に持ち上がっていること。
    if (gamma < 1) assert.ok(out.data[64 * 4] > 64, 'gamma ' + gamma + ' did not lift midtones');
  }
});

// このカメラから見えない部材は測れない。測れないものを 0 として扱うと、
// 存在しない暗部のためにレンダ全体が持ち上がってしまう。
test('ガイドに1画素も現れない部材は測定にも持ち上げ判定にも出てこない', () => {
  const tiers = Object.assign({ '#123456': 'LOCKED' }, TIERS);
  const bright = img(30, 10, () => [180, 175, 170]);
  const m = ShadowLift.measure(bright, instance, tiers);
  assert.equal(m.find(e => e.color === '#123456'), undefined);
  assert.equal(ShadowLift.curveFor(m).applied, false);
});

// ガンマは画面全体にかかる。真っ黒に近い部材1つのために絵全体を白茶けさせたくない
// ときのために、持ち上げの上限を締められる。締めて届かなかった部材は黙らせず残す。
test('minGamma で持ち上げを制限でき、届かなかった部材は記録される', () => {
  const m = ShadowLift.measure(base, instance, TIERS);
  const curve = ShadowLift.curveFor(m, { minGamma: 0.9 });
  assert.equal(curve.applied, false, 'nothing is liftable at gamma 0.9, so no wash-out');

  // 中間の暗さなら、締めた範囲内で持ち上がる
  const b = img(30, 10, x => x < 10 ? [20, 20, 20] : [180, 175, 170]);
  const soft = ShadowLift.curveFor(ShadowLift.measure(b, instance, TIERS), { minGamma: 0.5 });
  assert.equal(soft.applied, true);
  assert.ok(soft.gamma >= 0.5, 'gamma ' + soft.gamma + ' broke the floor');
  assert.deepEqual(soft.unliftableColors, []);
});

// 持ち上げた絵と一緒に記録される数値なので、判定器が読める形でなければならない。
test('カーブは持ち上げ前の最小輝度と目標床を記録する', () => {
  const curve = ShadowLift.curveFor(ShadowLift.measure(base, instance, TIERS));
  assert.ok(curve.liftedFrom < 5, 'liftedFrom was ' + curve.liftedFrom);
  assert.equal(curve.floorLuminance, 30);
});
