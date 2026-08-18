// テストは出荷する既定間取りを読まない。
//
// 既定間取り(assets/default_plan.json)は**商品**であって仕様ではない。
// テストがそれを直接読むと、間取りを良くするたびにテストが落ち、
// 「テストを通すために間取りを直す」という逆立ちが起きる。
//
//   実装の検査      … tools/tests/*.test.cjs  → tools/tests/fixtures/ の凍結間取り
//   出荷物の検査    … tools/lint_plan.py (33項目) → assets/default_plan.json
//
// この分担が崩れていないかを見る。詳しくは tools/tests/fixtures/README.md。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const HERE = __dirname;
const FILES = readdirSync(HERE).filter((f) => f.endsWith('.test.cjs'));

test('どのテストも assets/default_plan.json を読み込んでいない', () => {
  const offenders = [];
  for (const f of FILES) {
    if (f === 'fixture-only.test.cjs') continue;
    const src = readFileSync(join(HERE, f), 'utf8');
    // コメントで言及するのは構わない。readFileSync に渡していたら駄目。
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/'default_plan\.json'|"default_plan\.json"|default_plan\.json/.test(line)) {
        offenders.push(`${f}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    '既定間取りを読んでいるテストがある。tools/tests/fixtures/ の凍結間取りへ向けること:\n'
    + offenders.join('\n'));
});

test('凍結した間取りは、エンジンの検査に必要な要素を含んでいる', () => {
  // 中身が痩せると、通っていても何も守っていない状態になる。
  const plan = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
  const types = new Set(plan.items.map((it) => it.type));
  const floors = new Set(plan.rooms.map((r) => r.floor));

  assert.ok(plan.walls.length >= 20, `壁が少なすぎる: ${plan.walls.length}`);
  assert.ok(plan.rooms.length >= 15, `部屋が少なすぎる: ${plan.rooms.length}`);
  assert.ok(floors.has(1) && floors.has(2), '2層になっていない');
  assert.ok(plan.rooms.some((r) => (r.ceiling || {}).type === 'void'), '吹き抜けが無い');

  for (const t of ['roof', 'site-rect', 'road', 'neighbor-house', 'foundation',
                   'stair', 'balcony', 'window', 'window-door',
                   'light-ceiling', 'light-down']) {
    assert.ok(types.has(t), `フィクスチャに ${t} が無い`);
  }
});
