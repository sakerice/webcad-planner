// tools/tests/ にあるテストは、必ずどちらかの実行スクリプトが走らせる。
//
// 実行スクリプトは2つある。
//   tools/run_tests.sh          … *.test.cjs と lint_selftest.py など(ブラウザ不要)
//   tools/run_browser_tests.sh  … *.browser.mjs と *.browser.cjs(実物のブラウザが要る)
//
// 以前は *.browser.cjs の2本と default_plan_quality_test.py がどちらにも
// 拾われず、書いたのに一度も走らない状態が続いた。走っていないテストは
// 緑にも赤にもならないので、気づけない。ここでは、両スクリプトの中に書かれた
// グロブ(tools/tests/*.test.cjs など)を読み取り、各テストファイルがどれかに
// 当たるかを調べる。
//
// 部品として除外するもの: app-source.cjs、height-runtime.cjs、fixtures/
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const HERE = __dirname;
const ROOT = join(HERE, '..', '..');
const SCRIPTS = ['tools/run_tests.sh', 'tools/run_browser_tests.sh'];

const TEST_FILE = /(\.test\.cjs|\.browser\.mjs|\.browser\.cjs|_test\.py)$|^lint_selftest\.py$/;

// シェルのグロブ(*のみ)を正規表現にする。
function globToRegExp(glob) {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + esc + '$');
}

// スクリプトの中から tools/tests/ 配下を指す語を拾う(コメント行は除く)。
function patternsIn(script) {
  const found = [];
  for (const line of readFileSync(join(ROOT, script), 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(/tools\/tests\/([^\s"')$;]+)/g)) found.push(m[1]);
  }
  return found;
}

test('tools/tests/ のテストは、どちらかの実行スクリプトに拾われる', () => {
  const patterns = SCRIPTS.flatMap(patternsIn).filter((p) => !p.includes('$'));
  const regexps = patterns.map(globToRegExp);
  const files = readdirSync(HERE).filter((f) => TEST_FILE.test(f));
  const orphans = files.filter((f) => !regexps.some((re) => re.test(f)));
  assert.deepEqual(orphans, [],
    'どの実行スクリプトからも走らないテストがある:\n' + orphans.join('\n'));
});

test('判定自体が働いている(拾われるファイルを正しく数えている)', () => {
  // グロブを1つも読み取れないと、上のテストは「全部が拾われない」か
  // 「全部が拾われる」に偏って意味を失う。
  const patterns = SCRIPTS.flatMap(patternsIn);
  assert.ok(patterns.some((p) => p === '*.test.cjs'), '*.test.cjs を読み取れていない');
  assert.ok(patterns.some((p) => p === '*.browser.mjs'), '*.browser.mjs を読み取れていない');
  assert.ok(globToRegExp('*.browser.cjs').test('preset-start.browser.cjs'));
  assert.ok(!globToRegExp('*.browser.mjs').test('preset-start.browser.cjs'));
});
