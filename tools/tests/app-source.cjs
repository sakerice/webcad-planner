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
  'assets/js/app-constants.js',
  'assets/js/app-state.js',
  'assets/js/plan-data.js',
  'assets/js/draw-2d.js',
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

module.exports = { appSource, EXTRACTED, ROOT };
