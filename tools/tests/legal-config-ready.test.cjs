// 運営者が決める値(legal/site.json)が、すべて入っていること。
//
// **値が入るまで、この検査は落ちる。わざとそうしてある。**
// 未設定のまま main に入ると、本番のビルドはプライバシーポリシー・利用規約・サポートのページを配らず
// (legal/build.cjs)、画面のリンクの先が「ページが見つかりません」になる。そうならないよう、ここで止める。
//
// 落ちたときにすること: docs/legal-pages-and-registry.md の「運営者が入れる値」を見て、legal/site.json を埋める。
// 検査を消したり、仮の値を入れたりして通さない(仮の値がそのまま公開される)。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const legal = require(path.join(__dirname, '..', '..', 'legal', 'build.cjs'));

test('legal/site.json の必須の欄がすべて入っている', () => {
  const cfg = legal.loadConfig(path.join(__dirname, '..', '..', 'legal', 'site.json'));
  assert.deepEqual(legal.configProblems(cfg), []);
  assert.deepEqual(legal.missingFields(cfg), [],
    'legal/site.json に未設定の欄がある。docs/legal-pages-and-registry.md の「運営者が入れる値」を見て埋める');
});
