// 配信物(dist)に、編集用ファイルが混ざったらビルドを止める検査の検査。
// .blend・.DS_Store・*_preview.png・.py は、利用者に配る物ではない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = join(__dirname, '..', 'check_dist.cjs');

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-'));
  try {
    for (const f of files) {
      const p = join(dir, f);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, 'x');
    }
    return spawnSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('.blend が混ざっていたら終了コード1で、見つけたパスを出す', () => {
  const r = run(['assets/a.blend', 'ok.png']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /a\.blend/);
});

test('.DS_Store・_preview.png・.py も止める', () => {
  for (const f of ['assets/.DS_Store', 'assets/x_preview.png', 'tools/x.py']) {
    const r = run([f]);
    assert.equal(r.status, 1, f);
  }
});

test('ふつうの配信物だけなら終了コード0', () => {
  const r = run(['ok.png', 'assets/models/a.glb', 'index.html']);
  assert.equal(r.status, 0);
});
