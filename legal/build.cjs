#!/usr/bin/env node
// プライバシーポリシー・利用規約・サポートのページ(/privacy・/terms・/support と、英語の /en/…)と、
// ドメインの確認用のファイル(/.well-known/…)を、配信物(dist)に書き出す。
//
//   node legal/build.cjs <出力先のフォルダ>          build.sh が dist を渡して呼ぶ
//   node legal/build.cjs --check                    運営者が決める値が入っているかだけを見る(足りなければ終了コード 1)
//
// なぜ在るのか
// ------------
// 公開の申請(Claude のコネクタの一覧・ChatGPT のアプリの一覧・App Store)が、プライバシーポリシー・利用規約・
// サポートの URL を求める。本文は legal/pages/ に、運営者が決める値(名前・連絡先・準拠法など)は legal/site.json の
// 1か所に置く。本文の {{operatorName}} などを、ここで値に置き換える。
//
// 値が入っていない間の動き
// ------------------------
// legal/site.json の必須の欄が1つでも null の間は「下書き」として扱う。
//   - 手元のビルド: ページは書き出すが、上端に「下書き」の帯を出し、未設定の箇所を【未設定：…】と表示する(検索にも載せない)。
//   - 本番のビルド(Workers Builds。環境変数 WORKERS_CI がある)と LEGAL_PAGES=strict: ページを書き出さない
//     (/privacy などは今までどおり 404)。未設定の箇所が残ったページを本番に出さないため。ビルドは止めない
//     (ここで止めると、ほかの直しまで本番に出なくなる)。
// マージの歯止めは tools/tests/legal-config-ready.test.cjs(値が入るまで落ちる)。
//
// ドメインの確認用のファイル
// --------------------------
//   openaiAppsChallenge … ChatGPT のアプリの申請で OpenAI の画面が出す確認用の文字列。入っていれば
//                         /.well-known/openai-apps-challenge に、その文字列だけを書く。空なら書かない(404)。
//   mcpRegistryAuth     … 公式 MCP Registry の HTTP 方式の確認に使う1行(v=MCPv1; k=…; p=…)。入っていれば
//                         /.well-known/mcp-registry-auth に書く。空なら書かない。
// どちらも公開される値で、秘密ではない(秘密鍵は入れない)。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const SITE_ORIGIN = 'https://cad-planner.srapps.us';
const PAGES = ['privacy', 'terms', 'support'];
const LANGS = ['ja', 'en'];

// 必須の欄と、未設定のときに画面へ出す呼び名。
const REQUIRED = [
  { key: 'operatorName', label: { ja: '運営者の名前', en: 'operator name' } },
  { key: 'contactEmail', label: { ja: '問い合わせ先のメールアドレス', en: 'contact email' } },
  { key: 'effectiveDate', label: { ja: '制定日', en: 'effective date' } },
  { key: 'governingLaw', perLang: true, label: { ja: '準拠法', en: 'governing law' } },
  { key: 'jurisdiction', perLang: true, label: { ja: '管轄の裁判所', en: 'court of jurisdiction' } },
];

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// OpenAI の確認用の文字列。形は公開されていないので、URL に使える字だけ・空白なし・長すぎない、だけを見る。
const CHALLENGE_RE = /^[A-Za-z0-9._~+/=:-]{8,512}$/;
// MCP Registry の HTTP 方式の1行(https://modelcontextprotocol.io/registry/authentication の書式)。
const MCP_AUTH_RE = /^v=MCPv1; k=(ed25519|ecdsap384); p=[A-Za-z0-9+/=]{16,512}$/;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function filled(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function loadConfig(file) {
  // LEGAL_SITE_CONFIG は、検査が見本の値で配信物を作るための差し替え口(tools/tests/legal-pages.browser.mjs)。
  return JSON.parse(fs.readFileSync(file || process.env.LEGAL_SITE_CONFIG || path.join(HERE, 'site.json'), 'utf8'));
}

// 入っていない必須の欄の名前(例: "operatorName"、"governingLaw.en")。
function missingFields(cfg) {
  const out = [];
  for (const f of REQUIRED) {
    const v = cfg ? cfg[f.key] : null;
    if (f.perLang) {
      for (const lang of LANGS) if (!filled(v && v[lang])) out.push(`${f.key}.${lang}`);
    } else if (!filled(v)) out.push(f.key);
  }
  return out;
}

// 入っている値の形の誤り(文の配列)。未設定は誤りに数えない。
function configProblems(cfg) {
  const out = [];
  if (!cfg || typeof cfg !== 'object') return ['legal/site.json が読めない'];
  if (filled(cfg.contactEmail) && !EMAIL_RE.test(cfg.contactEmail.trim())) out.push('contactEmail がメールアドレスの形でない');
  if (filled(cfg.effectiveDate)) {
    const m = cfg.effectiveDate.trim().match(DATE_RE);
    const ok = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31;
    if (!ok) out.push('effectiveDate は 2026-12-01 の形で書く');
  }
  for (const key of ['openaiAppsChallenge', 'mcpRegistryAuth']) {
    if (cfg[key] !== undefined && cfg[key] !== null && typeof cfg[key] !== 'string') out.push(`${key} は文字で書く(無ければ "")`);
  }
  if (filled(cfg.openaiAppsChallenge) && !CHALLENGE_RE.test(cfg.openaiAppsChallenge.trim())) {
    out.push('openaiAppsChallenge に使えない字がある(OpenAI の画面の文字列を、前後の空白なしでそのまま入れる)');
  }
  if (filled(cfg.mcpRegistryAuth) && !MCP_AUTH_RE.test(cfg.mcpRegistryAuth.trim())) {
    out.push('mcpRegistryAuth は「v=MCPv1; k=ed25519; p=…」の1行で書く(公開鍵の側。秘密鍵は入れない)');
  }
  return out;
}

function formatDate(iso, lang) {
  const m = String(iso).trim().match(DATE_RE);
  if (!m) return iso;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (lang === 'ja') return `${y}年${mo}月${d}日`;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[mo - 1]} ${d}, ${y}`;
}

// 本文の {{…}} に入れる値(HTML)。未設定は、目立つ仮の表示にする。
function tokens(cfg, lang) {
  const todo = (f) => `<mark class="todo">${lang === 'ja' ? '【未設定：' + f.label.ja + '】' : '[NOT SET: ' + f.label.en + ']'}</mark>`;
  const out = {};
  for (const f of REQUIRED) {
    const raw = f.perLang ? (cfg[f.key] && cfg[f.key][lang]) : cfg[f.key];
    if (!filled(raw)) { out[f.key] = todo(f); continue; }
    const v = raw.trim();
    if (f.key === 'contactEmail') out[f.key] = `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    else if (f.key === 'effectiveDate') out[f.key] = esc(formatDate(v, lang));
    else out[f.key] = esc(v);
  }
  out.mcpAddress = `${SITE_ORIGIN}/api/mcp`;
  out.siteOrigin = SITE_ORIGIN;
  return out;
}

const TEXT = {
  ja: {
    site: 'house-planner mobile',
    nav: { privacy: 'プライバシーポリシー', terms: '利用規約', support: 'サポート' },
    back: 'アプリを開く',
    other: 'English',
    draft: 'このページは下書きです。運営者が決める項目がまだ入っていません。',
  },
  en: {
    site: 'house-planner mobile',
    nav: { privacy: 'Privacy Policy', terms: 'Terms of Use', support: 'Support' },
    back: 'Open the app',
    other: '日本語',
    draft: 'This page is a draft. Some items that the operator must decide are not filled in yet.',
  },
};

// アプリの色(assets/app.css の --hp-*)に合わせる。外から何も読み込まない(字も端末の字を使う)。
const STYLE = `
:root{--bg:#faf7f2;--surface:#fff;--text:#2d2a27;--soft:#6f6861;--line:#eadfd2;--primary:#ff4328;--primary-dark:#c8291a;--link:#0079ad}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.85 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif;overflow-wrap:anywhere}
a{color:var(--link)}
a:focus-visible{outline:2px solid var(--link);outline-offset:3px;border-radius:4px}
.top{max-width:820px;margin:0 auto;padding:20px 16px 0;display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:700;color:var(--text);text-decoration:none;margin-right:auto}
.brand img{width:32px;height:32px;border-radius:8px}
.nav{display:flex;flex-wrap:wrap;gap:6px}
.nav a{display:inline-block;padding:7px 14px;border-radius:999px;color:var(--soft);text-decoration:none;font-size:14px;line-height:1.4}
.nav a:hover{background:#fff}
.nav a[aria-current="page"]{background:var(--text);color:#fff}
.nav a.lang{border:1px solid var(--line)}
.draft{max-width:820px;margin:16px auto 0;padding:0 16px}
.draft p{margin:0;padding:10px 14px;border-radius:10px;background:#fff3c4;color:#5c4400;font-size:14px;line-height:1.6}
main{max-width:820px;margin:16px auto 0;padding:0 16px}
article{background:var(--surface);border-radius:18px;padding:32px 36px;box-shadow:0 8px 24px rgba(63,45,28,.08)}
h1{font-size:26px;line-height:1.4;margin:0 0 4px}
.meta{margin:0 0 20px;color:var(--soft);font-size:14px}
.lead{margin:0 0 8px}
h2{font-size:19px;line-height:1.5;margin:36px 0 10px;padding-top:20px;border-top:1px solid var(--line)}
h3{font-size:16px;line-height:1.6;margin:22px 0 6px}
p{margin:0 0 12px}
ul,ol{margin:0 0 12px;padding-left:1.4em}
li{margin:0 0 6px}
.fact{margin:0 0 12px;padding:14px 16px;border-radius:12px;background:var(--bg)}
.fact h3{margin:0 0 6px}
.fact dl{margin:0;display:grid;grid-template-columns:7.5em 1fr;gap:4px 12px}
.fact dt{color:var(--soft);font-size:14px;padding-top:2px}
.fact dd{margin:0}
code{font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--bg);padding:2px 6px;border-radius:6px;word-break:break-all}
mark.todo{background:#ffe08a;color:#5c2d00;padding:1px 4px;border-radius:4px;font-weight:700}
.foot{max-width:820px;margin:20px auto 0;padding:0 16px 48px;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;color:var(--soft);font-size:14px}
.foot .open{display:inline-block;padding:10px 22px;border-radius:999px;background:var(--primary);color:#fff;font-weight:700;text-decoration:none;margin-right:auto}
.foot .open:hover{background:var(--primary-dark)}
@media (max-width:640px){
  body{font-size:15px}
  .top{padding-top:14px}
  .nav{width:100%}
  .nav a{padding:7px 11px;font-size:13px}
  article{padding:22px 18px;border-radius:14px}
  h1{font-size:22px}
  h2{font-size:17px;margin-top:28px}
  .fact dl{grid-template-columns:1fr;gap:0}
  .fact dt{padding-top:8px}
}
@media print{body{background:#fff}.top,.foot,.draft{display:none}article{box-shadow:none;padding:0}}
`.trim();

function pagePath(page, lang) {
  return lang === 'ja' ? `/${page}` : `/${lang}/${page}`;
}

// 1ページ分の HTML。body は legal/pages/<page>.<lang>.html(1行目が <h1>…</h1>)。
function renderPage({ page, lang, body, cfg }) {
  const t = TEXT[lang];
  const draft = missingFields(cfg).length > 0;
  const tk = tokens(cfg, lang);
  const unknown = [];
  const filledBody = body.replace(/\{\{([A-Za-z]+)\}\}/g, (all, key) => {
    if (Object.prototype.hasOwnProperty.call(tk, key)) return tk[key];
    unknown.push(key);
    return all;
  });
  if (unknown.length) throw new Error(`legal/pages/${page}.${lang}.html に知らない欄がある: ${unknown.join(', ')}`);
  const title = `${t.nav[page]} | ${t.site}`;
  const otherLang = lang === 'ja' ? 'en' : 'ja';
  const nav = PAGES.map((p) => `<a href="${pagePath(p, lang)}"${p === page ? ' aria-current="page"' : ''}>${esc(t.nav[p])}</a>`).join('')
    + `<a class="lang" href="${pagePath(page, otherLang)}" lang="${otherLang}" hreflang="${otherLang}">${esc(t.other)}</a>`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${draft ? '<meta name="robots" content="noindex">\n' : ''}<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/assets/brand/house-planner-mobile-icon.png?v=3">
<link rel="alternate" hreflang="ja" href="${SITE_ORIGIN}${pagePath(page, 'ja')}">
<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}${pagePath(page, 'en')}">
<style>
${STYLE}
</style>
</head>
<body>
<header class="top">
  <a class="brand" href="/"><img src="/assets/brand/house-planner-mobile-icon.png?v=3" alt="" width="32" height="32">${esc(t.site)}</a>
  <nav class="nav" aria-label="${lang === 'ja' ? 'このサイトの案内' : 'Site pages'}">${nav}</nav>
</header>
${draft ? `<div class="draft" role="note"><p>${esc(t.draft)}</p></div>\n` : ''}<main>
<article>
${filledBody.trim()}
</article>
</main>
<footer class="foot">
  <a class="open" href="/">${esc(t.back)}</a>
  <span>${esc(t.site)}</span>
</footer>
</body>
</html>
`;
}

function readBody(page, lang) {
  return fs.readFileSync(path.join(HERE, 'pages', `${page}.${lang}.html`), 'utf8');
}

// 配信物を書き出す。戻り値: { pages:[書いた道], wellKnown:[書いた道], missing:[未設定の欄], skipped:真偽 }
function build(outDir, { cfg = loadConfig(), strict = false, log = console.log } = {}) {
  const problems = configProblems(cfg);
  if (problems.length) throw new Error('legal/site.json の値が正しくない:\n  - ' + problems.join('\n  - '));
  const missing = missingFields(cfg);
  const result = { pages: [], wellKnown: [], missing, skipped: false };

  if (missing.length && strict) {
    result.skipped = true;
    log('!!! legal/site.json に未設定の欄があるので、/privacy・/terms・/support を配信物に入れません: ' + missing.join(', '));
  } else {
    for (const lang of LANGS) {
      for (const page of PAGES) {
        const rel = lang === 'ja' ? `${page}.html` : path.join(lang, `${page}.html`);
        const file = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, renderPage({ page, lang, body: readBody(page, lang), cfg }));
        result.pages.push(pagePath(page, lang));
      }
    }
    if (missing.length) log('legal: 下書きとして書き出しました(未設定: ' + missing.join(', ') + ')。本番のビルドでは配りません。');
  }

  const wellKnown = [
    ['openaiAppsChallenge', 'openai-apps-challenge'],
    ['mcpRegistryAuth', 'mcp-registry-auth'],
  ];
  for (const [key, name] of wellKnown) {
    if (!filled(cfg[key])) continue;
    const file = path.join(outDir, '.well-known', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 文字列だけを書く(改行も足さない)。OpenAI は「Return only the exact token」と書いている。
    fs.writeFileSync(file, cfg[key].trim());
    result.wellKnown.push(`/.well-known/${name}`);
  }
  return result;
}

module.exports = { PAGES, LANGS, REQUIRED, SITE_ORIGIN, loadConfig, missingFields, configProblems, renderPage, readBody, build, pagePath };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('使い方: node legal/build.cjs <出力先のフォルダ> | --check');
    process.exit(2);
  }
  try {
    const cfg = loadConfig();
    if (arg === '--check') {
      const problems = configProblems(cfg);
      const missing = missingFields(cfg);
      for (const p of problems) console.error('誤り: ' + p);
      if (missing.length) console.error('未設定: ' + missing.join(', '));
      process.exit(problems.length || missing.length ? 1 : 0);
    }
    const strict = Boolean(process.env.WORKERS_CI) || process.env.LEGAL_PAGES === 'strict';
    const r = build(arg, { cfg, strict });
    console.log(`legal: ページ ${r.pages.length} 枚、確認用のファイル ${r.wellKnown.length} 個`);
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exit(1);
  }
}
