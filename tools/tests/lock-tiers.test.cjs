// tools/tests/lock-tiers.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const LockTiers = require('../../assets/js/lock-tiers.js');

test('建具と躯体は LOCKED', () => {
  for (const t of ['wall', 'window', 'door-swing', 'door-slide', 'stair',
                   'stair-corner', 'roof', 'balcony', 'room', 'foundation']) {
    assert.equal(LockTiers.tierOf(t), 'LOCKED', t);
  }
});

test('GLB家具と什器は SOFT', () => {
  for (const t of ['fmp-Sofa39', 'fmp-Chair37', 'im0261-Tv-MEGA_PACK_tv-electronic-123142',
                   'light-down', 'closet', 'washer']) {
    assert.equal(LockTiers.tierOf(t), 'SOFT', t);
  }
});

test('周辺環境と注記は FREE', () => {
  for (const t of ['neighbor-house', 'neighbor-building', 'road', 'utility-pole',
                   'memo', 'ruler', 'walk-route']) {
    assert.equal(LockTiers.tierOf(t), 'FREE', t);
  }
});

// 分類漏れの倒し方。ここが逆だと、新しい建具種別が黙って自由化される。
test('未知の type は LOCKED に倒れる', () => {
  assert.equal(LockTiers.tierOf('door-something-new-2027'), 'LOCKED');
  assert.equal(LockTiers.tierOf(''), 'LOCKED');
  assert.equal(LockTiers.tierOf(undefined), 'LOCKED');
});

test('legend から色→階層の表が引ける', () => {
  const legend = [
    { id: 1, color: '#aabbcc', type: 'wall' },
    { id: 2, color: '#ddeeff', type: 'fmp-Sofa39' },
    { id: 3, color: '#112233', type: 'road' }
  ];
  assert.deepEqual(LockTiers.tableFor(legend), {
    '#aabbcc': 'LOCKED', '#ddeeff': 'SOFT', '#112233': 'FREE'
  });
});

test('色は小文字に正規化される（照合側が厳密一致で切り出すため）', () => {
  const table = LockTiers.tableFor([{ id: 1, color: '#AABBCC', type: 'wall' }]);
  assert.deepEqual(Object.keys(table), ['#aabbcc']);
});

test('summarize は階層ごとの種別と個数を返す', () => {
  const legend = [
    { id: 1, color: '#a', type: 'window' }, { id: 2, color: '#b', type: 'window' },
    { id: 3, color: '#c', type: 'fmp-Sofa39' }
  ];
  const s = LockTiers.summarize(legend);
  assert.equal(s.counts.LOCKED, 2);
  assert.equal(s.counts.SOFT, 1);
  assert.deepEqual(s.LOCKED, ['window']);
});

// 実データ (pv/renders/*/instance-legend.json) に現れるのに表に無かった type。
// 未知の既定でも LOCKED にはなるが、既定に頼っていると「意図してLOCKEDにした」のか
// 「分類し忘れている」のかが区別できない。明示しておく。
test('custom-block は明示的に LOCKED（未知の既定に頼らない）', () => {
  assert.equal(LockTiers.tierOf('custom-block'), 'LOCKED');
  // 明示されていることを、未知の型と区別できる形で確かめる
  assert.ok(LockTiers.isKnownType('custom-block'),
    'custom-block should be an explicit rule, not the unknown-type fallback');
  // door* のワイルドカードに一致する名前は「未知」ではない。既定に頼っている型を
  // 探すときは、どの規則にも当たらない名前を使う。
  assert.ok(!LockTiers.isKnownType('plumbing-riser-2027'));
  assert.equal(LockTiers.tierOf('plumbing-riser-2027'), 'LOCKED');
});

// 屋外設備。実データに現れるのに表に無く、未知の既定で LOCKED になっていた。
// 建具ではないので凍結する理由が無く、消えられても困る -> SOFT。
test('屋外設備は SOFT として明示されている', () => {
  for (const t of ['ac-outdoor', 'gas-heater', 'meter-box']) {
    assert.equal(LockTiers.tierOf(t), 'SOFT', t);
    assert.ok(LockTiers.isKnownType(t), t + ' should be an explicit rule');
  }
});
