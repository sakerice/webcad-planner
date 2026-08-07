const test = require('node:test');
const assert = require('node:assert/strict');
const VideoPrompt = require('../../assets/js/video-prompt.js');

const legend = [
  { id: 1, color: '#a1', type: 'window', floor: 2 },
  { id: 2, color: '#a2', type: 'window', floor: 2 },
  { id: 3, color: '#a3', type: 'window', floor: 2 },
  { id: 4, color: '#b1', type: 'door-slide', floor: 2 },
  { id: 5, color: '#b2', type: 'stair', floor: 2 },
  { id: 6, color: '#c1', type: 'fmp-Sofa39', floor: 2 },
  { id: 7, color: '#c2', type: 'fmp-Table35', floor: 2 }
];
const camera = { posM: [6.3, 4.2, 1.15], targetM: [3.0, 4.05, 1.15], fov: 60, eyeHeightM: 1.15 };
const compose = (id, extra) => VideoPrompt.compose(Object.assign(
  { preset: VideoPrompt.PRESETS.find(p => p.id === id), legend: legend, camera: camera }, extra || {}));

test('プリセットは6件で、id が重複しない', () => {
  assert.equal(VideoPrompt.PRESETS.length, 6);
  assert.equal(new Set(VideoPrompt.PRESETS.map(p => p.id)).size, 6);
});

// 実測の失敗: 3Dレンダに「フラットな未着色CAD状態から始めて」と書いたところ、
// 生成AIは渡した映像を捨てて線画を描き直した。素材の種類で出し分ける。
test('3Dビューを撮ったとき「CAD図面 → 生活」は選べない', () => {
  const ids = VideoPrompt.presetsFor('3d').map(p => p.id);
  assert.ok(!ids.includes('plan-to-life'));
  assert.ok(!ids.includes('plan-to-life-watercolor'));
  assert.ok(ids.includes('render-to-life'));
});

test('平面図を撮ったときは図面系のプリセットだけが出る', () => {
  const ids = VideoPrompt.presetsFor('plan').map(p => p.id);
  assert.deepEqual(ids.sort(), ['plan-to-life', 'plan-to-life-watercolor']);
});

// ── 構成比。これを崩すと生成が素通しになる ──
test('禁止条項は本文の末尾3文以内に収まる', () => {
  const text = compose('render-to-life');
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const negIdx = sentences.findIndex(s => /\bdo not\b|\bnever\b/i.test(s));
  assert.ok(negIdx >= sentences.length - 3,
    'first prohibition at sentence ' + negIdx + ' of ' + sentences.length + '; must be in the last 3');
});

test('禁止条項は本文の3割を超えない', () => {
  const text = compose('render-to-life');
  const neg = text.split(/(?<=[.!?])\s+/).filter(s => /\bdo not\b|\bnever\b/i.test(s)).join(' ');
  assert.ok(neg.length / text.length < 0.3,
    'prohibitions are ' + Math.round(neg.length / text.length * 100) + '% of the body');
});

// ── LOCKED は名指しする ──
test('LOCKED の開口は個数を名指しされる', () => {
  const text = compose('render-to-life');
  assert.match(text, /three windows/i);
});

test('LOCKED に階段があれば触れられる', () => {
  assert.match(compose('render-to-life'), /stair/i);
});

// ── 書いてはならないこと ──
// 実測: 仕上げの色を固定する指示は効かず、生成そのものを止めた。
test('個々の仕上げの色を固定する文言は入らない', () => {
  const text = compose('render-to-life');
  assert.doesNotMatch(text, /stays (black|grey|gray|white)/i);
  assert.doesNotMatch(text, /do not re-?colou?r/i);
});

test('線画に戻すなという禁止は必ず入る（実測で効くことが確認されている唯一の禁止）', () => {
  assert.match(compose('render-to-life'), /line drawing/i);
});

// ── ユーザーの書き換えが本文になる ──
test('userText が与えられればそれが表現の本文になる', () => {
  const text = compose('render-to-life', { userText: 'A quiet snowy morning.' });
  assert.match(text, /A quiet snowy morning\./);
  assert.match(text, /line drawing/i, 'the closing constraint still gets appended');
});

test('尺の上限は15秒、既定は8秒', () => {
  assert.equal(VideoPrompt.MAX_DURATION_SEC, 15);
  assert.equal(VideoPrompt.DEFAULT_DURATION_SEC, 8);
});
