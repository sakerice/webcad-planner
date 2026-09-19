// 出荷する index.html と、それが読む JS/CSS が、一緒に新しくなるか。
//
// なぜ在るのか
// ------------
// index.html と assets/js/*.js は別ファイルなので、ブラウザは古い JS を
// キャッシュから使い続けられる。新しい HTML + 古い JS の組み合わせは、
// こちらの手元では再現しない。tools/version_page_assets.py が、ビルドのときに
// 参照へ内容ハッシュを付けてこれを防ぐ。
//
// ハッシュは **ビルドで dist に対してだけ** 付ける。ソースの index.html に
// 手で書くと、JS を直すたびに黙って腐る(実際に4ファイルぶん腐っていた)。
// 腐ったハッシュは「古い JS を使い続ける」というこのバグそのものを起こす。
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'tools', 'version_page_assets.py');
const LOCAL_REF = /(?:src|href)="((?:assets\/)[^"?]+\.(?:js|css))(\?v=([0-9a-f]+))?"/g;

// 一時ディレクトリに小さなページ一式を作って、スクリプトをそこで走らせる。
function sandbox(js) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-version-'));
  fs.mkdirSync(path.join(dir, 'assets', 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'js', 'app.js'), js);
  fs.writeFileSync(path.join(dir, 'assets', 'style.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<link rel="stylesheet" href="assets/style.css">\n' +
    '<script src="assets/js/app.js"></script>\n' +
    '<script src="https://cdn.example.com/three.js"></script>\n' +
    '<script>var inline="assets/js/app.js";</script>\n');
  return dir;
}
const stamp = (dir) => execFileSync('python3', [SCRIPT, path.join(dir, 'index.html')]);
const page = (dir) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const versions = (html) => Array.from(html.matchAll(LOCAL_REF)).map((m) => m[1] + ':' + (m[3] || ''));

test('ビルドで、手元の JS/CSS の参照に内容ハッシュが付く', () => {
  const dir = sandbox('var a=1;');
  stamp(dir);
  const html = page(dir);
  assert.deepEqual(versions(html).map((v) => v.split(':')[0]), ['assets/style.css', 'assets/js/app.js']);
  assert.ok(versions(html).every((v) => /:[0-9a-f]{12}$/.test(v)), 'ハッシュが付いていない: ' + versions(html));
  // 外部CDNは触らない。インラインの文字列も書き換えない(JS が壊れる)。
  assert.ok(html.includes('src="https://cdn.example.com/three.js"'));
  assert.ok(html.includes('var inline="assets/js/app.js";'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('JS を直せばハッシュが変わり、直さなければ何度走らせても同じ', () => {
  const dir = sandbox('var a=1;');
  stamp(dir);
  const first = versions(page(dir));
  stamp(dir);
  assert.deepEqual(versions(page(dir)), first, '2度走らせると値が変わる(ハッシュが二重に付いている)');
  fs.writeFileSync(path.join(dir, 'assets', 'js', 'app.js'), 'var a=2;');
  stamp(dir);
  const after = versions(page(dir));
  assert.notEqual(after[1], first[1], 'JS を変えたのにハッシュが同じ(古い JS が使われ続ける)');
  assert.equal(after[0], first[0], '触っていない CSS のハッシュまで変わっている');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('参照先が無いときはビルドを止める（黙って素通りさせない）', () => {
  const dir = sandbox('var a=1;');
  fs.rmSync(path.join(dir, 'assets', 'js', 'app.js'));
  assert.throws(() => execFileSync('python3', [SCRIPT, path.join(dir, 'index.html')], { stdio: 'pipe' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('build.sh は dist に対してこれを走らせる', () => {
  const build = fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8');
  assert.match(build, /python3 tools\/version_page_assets\.py dist\/index\.html/);
});

test('ソースの index.html には、手書きのハッシュを残さない', () => {
  // 手で書いたハッシュは JS を直した瞬間に腐る。腐ったハッシュは、
  // 「HTML は新しいのに JS は古い」をブラウザに固定させる。
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const stamped = Array.from(html.matchAll(LOCAL_REF)).filter((m) => m[3]).map((m) => m[1]);
  assert.deepEqual(stamped, [], 'ソースにハッシュが書かれている(ビルドで付けるもの)');
});
