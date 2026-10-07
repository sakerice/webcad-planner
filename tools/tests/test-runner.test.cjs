// 検査の失敗がシェルの終了コードにも伝わること。実際の検査一式は再帰実行しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = process.env.TEST_RUNNER_SOURCE || path.join(__dirname, '..', 'run_tests.sh');

function runFixture(t, { nodeFails = false, lintFails = false, elsewhere = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webcad test runner-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'repo');
  const tests = path.join(root, 'tools', 'tests');
  fs.mkdirSync(tests, { recursive: true });
  const runner = path.join(root, 'tools', 'run_tests.sh');
  fs.copyFileSync(source, runner);
  fs.writeFileSync(path.join(tests, 'a.test.cjs'), nodeFails
    ? 'console.error("intentional node failure"); process.exit(1);\n'
    : 'console.log("node success");\n');
  fs.writeFileSync(path.join(tests, 'b.test.cjs'),
    'require("node:fs").writeFileSync("second-ran", "yes");\n');
  fs.writeFileSync(path.join(tests, 'lint_selftest.py'),
    'from pathlib import Path\nPath("lint-ran").write_text("yes")\n' +
    (lintFails ? 'raise SystemExit("intentional lint failure")\n' : 'print("lint success")\n'));
  const result = spawnSync('sh', [runner], {
    cwd: elsewhere ? tmp : root, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { ...result, root };
}

test('全検査が通ったときだけ終了コード0を返す', (t) => {
  const result = runFixture(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exit=0/);
  assert.doesNotMatch(result.stdout, /FAIL/);
});

test('Nodeの検査が落ちたら非0を返し、原因も表示する', (t) => {
  const result = runFixture(t, { nodeFails: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL tools\/tests\/a\.test\.cjs/);
  assert.match(result.stdout, /intentional node failure/);
  assert.match(result.stdout, /exit=1/);
  assert.ok(fs.existsSync(path.join(result.root, 'second-ran')), '後続のNode検査を飛ばした');
  assert.ok(fs.existsSync(path.join(result.root, 'lint-ran')), 'lintの自己検査を飛ばした');
});

test('lintの自己検査が落ちても非0を返し、原因を表示する', (t) => {
  const result = runFixture(t, { lintFails: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL tools\/tests\/lint_selftest\.py/);
  assert.match(result.stdout, /intentional lint failure/);
  assert.match(result.stdout, /exit=1/);
});

test('Nodeとlintの両方が落ちたら両方の失敗を報告する', (t) => {
  const result = runFixture(t, { nodeFails: true, lintFails: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /intentional node failure/);
  assert.match(result.stdout, /intentional lint failure/);
});

test('別の作業ディレクトリから呼んでも対象リポジトリを検査する', (t) => {
  const result = runFixture(t, { elsewhere: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exit=0/);
  assert.doesNotMatch(result.stdout, /FAIL/);
  assert.ok(fs.existsSync(path.join(result.root, 'second-ran')));
  assert.ok(fs.existsSync(path.join(result.root, 'lint-ran')));
});
