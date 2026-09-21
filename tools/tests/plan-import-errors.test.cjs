// 失敗の文面に、読む側の事情を出さない。
//
// サーバが返すのは JSON とは限らない。Cloudflare が作るエラーページは HTML で、
// res.json() をそのまま呼ぶと JSON の構文エラーになる。実測で、その文面が
// そのまま利用者の画面に出ていた:
//
//   通信に失敗しました: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
//
// 利用者には何の意味も無いし、次に何をすればよいかも分からない。
const assert = require('assert');
const path = require('path');
const { readFileSync } = require('fs');

const src = readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-import.js'), 'utf8');

// JSON として読めなかったときに落ちない読み方をしている
assert.match(src, /function readReply\(res\)/, '返事を読む窓口が無い');
assert.match(src, /JSON\.parse\(text\)/, '本文を自分で読んでいない');
// 文面を画面に出す2つの経路（読み取り・見直し）が、この窓口を通っていること。
// 残り回数の取得と図面の位置探しも res.json() を呼ぶが、どちらも失敗を握りつぶす
// ので文面は出ない。
assert.equal((src.match(/\.then\(readReply\)/g) || []).length, 3,
  '読み取り・見直し・出来上がりの問い合わせが、返事を読む窓口を通っていない');

// 例外の中身をそのまま画面へ出していない
assert.ok(!/通信に失敗しました: ' \+ \(e/.test(src), '例外の message をそのまま出している');

// 状態コードだけでも、次に何をすればよいか分かる文面がある
const messages = {};
global.self = global; global.document = undefined;
require(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-import.js'));
global.document = {
  getElementById: () => ({ set textContent(v) { messages.last = v; }, get textContent() { return messages.last; },
                           style: {}, classList: { add() {}, remove() {} } }),
};
for (const [status, want] of [[500, /サーバ側でエラー/], [504, /時間がかかりすぎて/], [524, /時間がかかりすぎて/]]) {
  messages.last = '';
  global.PlanImport.showPlanImportError(status, null);
  assert.match(messages.last, want, `${status} の文面が利用者向けになっていない`);
  assert.ok(!/JSON|token|DOCTYPE/.test(messages.last), `${status} の文面に読む側の事情が混ざっている`);
}

console.log('plan-import-errors: ok');
