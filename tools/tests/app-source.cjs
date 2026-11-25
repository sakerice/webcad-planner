// アプリのソース全体を1つの文字列として返す。
//
// なぜ在るのか
// ------------
// テストは index.html から関数を名前で切り出し、node:vm の上で回している。
// アプリの JS が index.html のインライン script 1枚に収まっていた頃は
// index.html を読めば足りたが、いまは assets/js/ へ切り出してある。
// 各テストが「どのファイルに在るか」を知っている必要はないので、
// ここで**読み込まれる順に**つないだものを渡す。
//
// 順番は index.html の <script src> の並びと同じにしてある。同じ名前が
// 2か所にあることは無い前提だが、もしあれば先に読まれた方が勝つ——
// ブラウザでの実際の挙動と同じになる。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');

// index.html が読む順。切り出したファイルを増やしたらここにも足すこと。
const EXTRACTED = [
  'assets/js/plan-core/factories.js',
  'assets/js/plan-core/snap.js',
  'assets/js/plan-core/operations.js',
  'assets/js/plan-core/operations-catalog.js',
  'assets/js/plan-core/progress.js',
  'assets/js/plan-core/inspect.js',
  'assets/js/plan-core/patch.js',
  'assets/js/app-constants.js',
  'assets/js/app-state.js',
  'assets/js/plan-data.js',
  'assets/js/draw-2d.js',
  'assets/js/chat/claude-stream.js',
  'assets/js/chat/plan-summary.js',
  'assets/js/chat/chat-session.js',
  'assets/js/chat/chat-ui.js',
];

let cached = null;

// index.html の中身(HTMLのマークアップも含む)に、切り出した JS をつないだもの。
// マークアップに対する検査(onclick= の文字列など)もこれまでどおり効く。
function appSource() {
  if (cached === null) {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const js = EXTRACTED.map((rel) => readFileSync(join(ROOT, rel), 'utf8')).join('\n');
    // 先頭に改行を足す。切り出し側の1行目が "function foo(" のとき、
    // 検索が '\nfunction foo(' を探す作りなので見つからなくなる。
    cached = html + '\n' + js + '\n';
  }
  return cached;
}

// 表を自分の鍵だけで引く小さな関数(assets/js/app-constants.js の ownGet・ownSlot)と、
// 設定の欄の形を作り直せる形に戻す関数(isPlainObj・repairSettingsShape。ensure… が最初に呼ぶ)の本文。
// 種類名などで表を引く関数は、これを使う(継承した鍵 constructor などに当たらないため)。
// 関数を切り出して node:vm に載せるテストは、これも一緒に載せる。
function ownHelpersSource() {
  const src = appSource();
  return ['ownGet', 'ownSlot', 'isPlainObj', 'repairSettingsShape'].map((name) => {
    const at = src.indexOf('\nfunction ' + name + '(');
    if (at < 0) throw new Error('function ' + name + ' がソースに無い');
    return src.slice(at + 1, src.indexOf('\n}\n', at) + 2);
  }).join('\n');
}

// 関数を node:vm に載せるテストのうち、載せる関数を名前の一覧で持たない物(本文を範囲で
//切り出す物や、文脈を何か所でも作る物)は、これを先頭で1回呼ぶ。以後このプロセスで作る
// vm の文脈には、最初から ownGet・ownSlot が入っている。
let ownHelpersInstalled = false;
function installOwnHelpersInVm() {
  if (ownHelpersInstalled) return;
  ownHelpersInstalled = true;
  const vm = require('node:vm');
  const create = vm.createContext;
  const src = ownHelpersSource();
  vm.createContext = function (sandbox, options) {
    const ctx = create.call(vm, sandbox, options);
    vm.runInContext(src, ctx);
    return ctx;
  };
}

// アプリ本体のスタイルシート(assets/app.css)の中身。
// もとは index.html の <style> 1枚だった(2026-11 に外のファイルへ出した)。
// appSource() は CSS を含まないので、CSS を読むテスト(セレクタを解いて効く値を
// 求めるもの、CSS の綴りを見るもの)はこれを使う。読む範囲は外へ出す前と同じで、
// 後ろで読む ui-refinement.css・chat.css・ceiling-designer.css は含めない。
const APP_CSS = 'assets/app.css';
let cachedCss = null;
function appCss() {
  if (cachedCss === null) {
    // テストは外のファイルを直接読むので、画面が実際にそれを読んでいることもここで確かめる。
    // 読む順は ui-refinement.css より前(後ろの物が上書きする前提で書かれている)。
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const at = html.indexOf('<link rel="stylesheet" href="' + APP_CSS + '">');
    const next = html.indexOf('<link rel="stylesheet" href="assets/ui-refinement.css">');
    if (at < 0 || next < 0 || at > next || html.indexOf('</head>') < at) {
      throw new Error('index.html の <head> が ' + APP_CSS + ' を ui-refinement.css より前で読んでいない');
    }
    cachedCss = readFileSync(join(ROOT, APP_CSS), 'utf8');
  }
  return cachedCss;
}

module.exports = { appSource, appCss, ownHelpersSource, installOwnHelpersInVm, EXTRACTED, APP_CSS, ROOT };
