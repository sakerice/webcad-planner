const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const format = async (edge) => {
  const {formatDimensionLines} = await import('../probe-dimensions.mjs');
  return formatDimensionLines({top:edge}).join('\n');
};

test('probe reports unknown totals rather than zero or a checkmark', async () => {
  for (const total of [null,undefined,'',' ',false,0,-1,'bad']) {
    const text = await format({total,parts:[910,910]});
    assert.match(text,/総 \?/);
    assert.match(text,/照合不可/);
    assert.doesNotMatch(text,/✓|総 0/);
  }
});

test('probe cannot check off a chain with an unreadable position', async () => {
  for (const part of [null,undefined,'',false,0,-1,'bad']) {
    const text = await format({total:1820,parts:[910,part,910]});
    assert.match(text,/910 \+ \? \+ 910/);
    assert.match(text,/内訳に不明値あり/);
    assert.doesNotMatch(text,/✓/);
  }
});

test('probe retains valid numeric and legacy chains, and detects actual mismatches', async () => {
  for (const edge of [{total:'1820',parts:['910',910]},[1820,[910,910]]]) {
    assert.match(await format(edge),/総 1820  = 910 \+ 910  ✓/);
  }
  assert.match(await format({total:1820,parts:[910,900]}),/✗ 内訳の合計が 1810/);
  for (const parts of [null,undefined,[]]) {
    assert.match(await format({total:1820,parts}),/内訳なし・照合不可/);
  }
  assert.match(await format(null),/総 \?.*照合不可/);
});

test('both provider probes use the offline formatter instead of coercing evidence', () => {
  for (const name of ['probe_openai.cjs','probe_vertex.cjs']) {
    const source=readFileSync(join(__dirname,'..',name),'utf8');
    assert.match(source,/const lines = formatDimensionLines\(dims\)/);
    assert.doesNotMatch(source,/Number\(d\.total\)|raw\.map\(Number\)|d\.parts\.map\(Number\)/);
  }
});
