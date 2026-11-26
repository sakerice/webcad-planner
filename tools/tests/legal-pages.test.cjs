// プライバシーポリシー・利用規約・サポートのページと、ドメインの確認用のファイルの書き出し(legal/build.cjs)。
//
// 見ること:
//   1. 値が入った設定(見本)では、6枚(日本語3・英語3)が書き出され、値が本文に入り、未設定の印が残らない。
//   2. 値が入っていない設定では、手元は「下書き」として書き出し、本番(strict)は書き出さない。ビルドは止めない。
//   3. 確認用のファイルは、値があるときだけ、その文字列だけで書き出す。形のおかしい値は断る。
//   4. ページは外から何も読み込まない(字・絵・スクリプト)。
//   5. 本文に書いた数(60 日・5 件)が、コードの値と合っている。
//   6. build.sh がこの書き出しを呼び、_headers が確認用のファイルを文字として返す。
//   7. 公式 MCP Registry 用の下書き(docs/mcp-registry/server.json)が、書式と今の受け口に合っている。
// 「運営者の値が実際に入ったか」は legal-config-ready.test.cjs が見る(ここでは仕組みだけ)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const legal = require(path.join(ROOT, 'legal', 'build.cjs'));
const FILLED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legal-site.json'), 'utf8'));
const EMPTY = { operatorName: null, contactEmail: null, effectiveDate: null, governingLaw: { ja: null, en: null }, jurisdiction: { ja: null, en: null }, openaiAppsChallenge: '', mcpRegistryAuth: '' };
const FILES = ['privacy.html', 'terms.html', 'support.html', 'en/privacy.html', 'en/terms.html', 'en/support.html'];

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'legal-pages-')); }
const quiet = { log() {} };
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('値が入っていれば、6枚を書き出し、値が本文に入る', () => {
  const dir = tmp();
  const r = legal.build(dir, { cfg: FILLED, ...quiet });
  assert.deepEqual(r.missing, []);
  assert.equal(r.skipped, false);
  assert.deepEqual(r.pages, ['/privacy', '/terms', '/support', '/en/privacy', '/en/terms', '/en/support']);
  for (const rel of FILES) {
    const html = read(dir, rel);
    assert.ok(!/\{\{[A-Za-z]+\}\}/.test(html), `${rel} に置き換え残しがある`);
    assert.ok(!/未設定|NOT SET|下書き|This page is a draft/.test(html), `${rel} に未設定の印が残っている`);
    assert.ok(!/name="robots"/.test(html), `${rel} が検索に載らない設定のまま`);
    assert.ok(html.includes('mailto:support@example.com'), `${rel} に問い合わせ先が無い`);
    assert.match(html, /<h1>[^<]+<\/h1>/);
  }
  // 値は HTML として解釈されない
  assert.ok(read(dir, 'privacy.html').includes('検査用の運営者 &lt;&amp;&gt;'));
  assert.ok(!read(dir, 'privacy.html').includes('検査用の運営者 <&>'));
  assert.ok(read(dir, 'privacy.html').includes('2026年12月1日'));
  assert.ok(read(dir, 'en/privacy.html').includes('December 1, 2026'));
  assert.ok(read(dir, 'terms.html').includes('検査用の準拠法') && read(dir, 'terms.html').includes('検査用の裁判所'));
  assert.ok(read(dir, 'en/terms.html').includes('the test governing law') && read(dir, 'en/terms.html').includes('the test court'));
  assert.match(read(dir, 'privacy.html'), /<html lang="ja">/);
  assert.match(read(dir, 'en/privacy.html'), /<html lang="en">/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('値が入っていなければ、手元は下書きとして書き出し、本番は書き出さない', () => {
  assert.deepEqual(legal.missingFields(EMPTY),
    ['operatorName', 'contactEmail', 'effectiveDate', 'governingLaw.ja', 'governingLaw.en', 'jurisdiction.ja', 'jurisdiction.en']);
  assert.deepEqual(legal.missingFields({ ...FILLED, contactEmail: '  ' }), ['contactEmail']);

  const draft = tmp();
  const logs = [];
  const r = legal.build(draft, { cfg: EMPTY, log: (m) => logs.push(m) });
  assert.equal(r.skipped, false);
  assert.equal(r.pages.length, 6);
  assert.ok(logs.join('\n').includes('未設定'), '未設定をビルドの出力で知らせる');
  for (const rel of FILES) {
    const html = read(draft, rel);
    assert.ok(/name="robots" content="noindex"/.test(html), `${rel} の下書きが検索に載る`);
    assert.ok(/class="draft"/.test(html), `${rel} に下書きの帯が無い`);
    assert.ok(!/\{\{[A-Za-z]+\}\}/.test(html));
  }
  assert.ok(read(draft, 'privacy.html').includes('【未設定：運営者の名前】'));
  assert.ok(read(draft, 'terms.html').includes('【未設定：準拠法】'));
  assert.ok(read(draft, 'en/support.html').includes('[NOT SET: contact email]'));

  const strict = tmp();
  const logs2 = [];
  const r2 = legal.build(strict, { cfg: EMPTY, strict: true, log: (m) => logs2.push(m) });
  assert.equal(r2.skipped, true);
  assert.deepEqual(r2.pages, []);
  for (const rel of FILES) assert.ok(!fs.existsSync(path.join(strict, rel)), `本番のビルドが下書きの ${rel} を書き出した`);
  assert.ok(logs2.join('\n').includes('配信物に入れません'));

  // 値がそろっていれば、本番でも書き出す
  const ok = tmp();
  assert.equal(legal.build(ok, { cfg: FILLED, strict: true, ...quiet }).pages.length, 6);
  for (const d of [draft, strict, ok]) fs.rmSync(d, { recursive: true, force: true });
});

test('確認用のファイルは、値があるときだけ、その文字列だけで書き出す', () => {
  const none = tmp();
  const r0 = legal.build(none, { cfg: { ...FILLED, openaiAppsChallenge: '', mcpRegistryAuth: '' }, ...quiet });
  assert.deepEqual(r0.wellKnown, []);
  assert.ok(!fs.existsSync(path.join(none, '.well-known')), '値が無いのに .well-known を作った');

  const some = tmp();
  const r1 = legal.build(some, { cfg: { ...FILLED, openaiAppsChallenge: '  ' + FILLED.openaiAppsChallenge + '\n' }, ...quiet });
  assert.deepEqual(r1.wellKnown, ['/.well-known/openai-apps-challenge', '/.well-known/mcp-registry-auth']);
  assert.equal(read(some, '.well-known/openai-apps-challenge'), FILLED.openaiAppsChallenge, '前後の空白や改行を足さない');
  assert.equal(read(some, '.well-known/mcp-registry-auth'), FILLED.mcpRegistryAuth);

  // ページが未設定で本番でも、確認用のファイルは出す(ドメインの確認はページより先に進められる)
  const early = tmp();
  const r2 = legal.build(early, { cfg: { ...EMPTY, openaiAppsChallenge: FILLED.openaiAppsChallenge }, strict: true, ...quiet });
  assert.deepEqual(r2.wellKnown, ['/.well-known/openai-apps-challenge']);
  assert.deepEqual(r2.pages, []);
  for (const d of [none, some, early]) fs.rmSync(d, { recursive: true, force: true });
});

test('形のおかしい値は断る', () => {
  const bad = [
    [{ contactEmail: 'not-an-address' }, /contactEmail/],
    [{ effectiveDate: '2026/12/01' }, /effectiveDate/],
    [{ effectiveDate: '2026-13-01' }, /effectiveDate/],
    [{ openaiAppsChallenge: '{"token":"abc"}' }, /openaiAppsChallenge/],
    [{ openaiAppsChallenge: 'two words here' }, /openaiAppsChallenge/],
    [{ openaiAppsChallenge: 42 }, /openaiAppsChallenge/],
    [{ mcpRegistryAuth: '-----BEGIN PRIVATE KEY-----' }, /mcpRegistryAuth/],
  ];
  for (const [patch, re] of bad) {
    const cfg = { ...FILLED, ...patch };
    assert.ok(legal.configProblems(cfg).some((p) => re.test(p)), JSON.stringify(patch) + ' を通した');
    const dir = tmp();
    assert.throws(() => legal.build(dir, { cfg, ...quiet }), re);
    assert.deepEqual(fs.readdirSync(dir), [], '断ったのに何か書き出した');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(legal.configProblems(FILLED), []);
  assert.deepEqual(legal.configProblems(EMPTY), [], '未設定は誤りに数えない');
});

test('リポジトリの設定(legal/site.json)が読め、形の誤りが無い', () => {
  const cfg = legal.loadConfig(path.join(ROOT, 'legal', 'site.json'));
  assert.deepEqual(legal.configProblems(cfg), []);
  for (const f of legal.REQUIRED) assert.ok(f.key in cfg, `legal/site.json に ${f.key} の欄が無い`);
  assert.ok('openaiAppsChallenge' in cfg && 'mcpRegistryAuth' in cfg);
});

test('ページは外から何も読み込まない', () => {
  const dir = tmp();
  legal.build(dir, { cfg: FILLED, ...quiet });
  for (const rel of FILES) {
    const html = read(dir, rel);
    assert.ok(!/<script/i.test(html), `${rel} にスクリプトがある`);
    assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), `${rel} が外の字を読み込む`);
    for (const m of html.matchAll(/<(?:img|link|iframe|source|video|audio)\b[^>]*>/gi)) {
      if (/rel="alternate"/.test(m[0])) continue; // 言語違いのページの案内(読み込みではない)
      const url = (m[0].match(/\b(?:src|href)="([^"]+)"/) || [])[1] || '';
      assert.ok(url.startsWith('/') && !url.startsWith('//'), `${rel} が外から読み込む: ${m[0]}`);
    }
    assert.ok(!/url\(/.test(html), `${rel} の CSS が何かを読み込む`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('本文の数が、コードの値と合っている', () => {
  const shared = fs.readFileSync(path.join(ROOT, 'worker', 'shared.mjs'), 'utf8');
  assert.match(shared, /RETENTION_MS = 60 \* 24 \* 60 \* 60 \* 1000/, '共同編集の保存の日数が変わった。legal/pages/ の「60 日」も直す');
  const state = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'app-state.js'), 'utf8');
  assert.match(state, /ROOM_KEEP=5\b/, 'ブラウザに残す共同編集の写しの数が変わった。legal/pages/privacy の「5 件」も直す');
  const quota = fs.readFileSync(path.join(ROOT, 'worker', 'ai-quota.mjs'), 'utf8');
  assert.match(quota, /keepDays = new Set\(\[today, yesterday\]\)/, '回数を数える記録の残し方が変わった。legal/pages/privacy の「当日と前日」も直す');
  for (const lang of legal.LANGS) {
    const privacy = legal.readBody('privacy', lang);
    assert.ok((privacy.match(/60 (日|days)/g) || []).length >= 2, `privacy.${lang} に 60 日の記述が無い`);
    assert.ok(/5 件|five most recent/.test(privacy), `privacy.${lang} に 5 件の記述が無い`);
    for (const page of ['terms', 'support']) assert.ok(/60 (日|days)/.test(legal.readBody(page, lang)), `${page}.${lang} に 60 日の記述が無い`);
  }
  // サポートに書く連携先の住所は、Worker の受け口と同じ
  const mcp = fs.readFileSync(path.join(ROOT, 'worker', 'mcp.mjs'), 'utf8');
  assert.match(mcp, /MCP_PATH = "\/api\/mcp"/);
  const dir = tmp();
  legal.build(dir, { cfg: FILLED, ...quiet });
  assert.ok(read(dir, 'support.html').includes('<code>https://cad-planner.srapps.us/api/mcp</code>'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('build.sh が書き出しを呼び、_headers が確認用のファイルを文字として返す', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8');
  assert.match(sh, /^node legal\/build\.cjs dist$/m);
  assert.ok(sh.indexOf('rm -rf dist') < sh.indexOf('node legal/build.cjs dist'), 'dist を消したあとに書き出す');
  const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  for (const name of ['openai-apps-challenge', 'mcp-registry-auth']) {
    assert.match(headers, new RegExp(`^/\\.well-known/${name}\\n  Content-Type: text/plain; charset=utf-8$`, 'm'));
  }
});

test('画面(index.html)から3つのページへ行ける', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const [href, label] of [['privacy', 'プライバシーポリシー'], ['terms', '利用規約'], ['support', 'サポート']]) {
    assert.match(html, new RegExp(`<a href="${href}" target="_blank" rel="noopener"[^>]*>${label}</a>`));
  }
});

test('公式 MCP Registry 用の下書き(server.json)が、書式と今の受け口に合っている', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'mcp-registry', 'server.json'), 'utf8'));
  // 書式は https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json(2026-11-26 に読んだ)
  assert.equal(s.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.match(s.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(s.name.length >= 3 && s.name.length <= 200);
  assert.ok(s.description.length >= 1 && s.description.length <= 100, `description は 100 字まで(いま ${s.description.length})`);
  assert.ok(s.title.length <= 100);
  assert.ok(!/[\^~>*]|\.x$/.test(s.version), 'version に範囲は書けない');
  assert.deepEqual(s.remotes, [{ type: 'streamable-http', url: 'https://cad-planner.srapps.us/api/mcp' }]);
  assert.ok(!('packages' in s), '遠隔だけのサーバーなので packages は書かない');
  assert.ok(!('repository' in s), 'リポジトリは公開していないので書かない');
  // ドメインで確かめる名前空間(逆順のドメイン)。受け口のホストと同じドメインにしておく
  assert.equal(s.name.split('/')[0], 'us.srapps.cad-planner');
  // 版は Worker が名乗る版と同じ
  const mcp = fs.readFileSync(path.join(ROOT, 'worker', 'mcp.mjs'), 'utf8');
  const m = mcp.match(/SERVER_INFO = Object\.freeze\(\{[^}]*version: "([^"]+)"/);
  assert.ok(m, 'worker/mcp.mjs の SERVER_INFO が読めない');
  assert.equal(s.version, m[1], 'server.json の version を worker/mcp.mjs の SERVER_INFO に合わせる');
});
