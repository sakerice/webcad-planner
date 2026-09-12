// 切り出した JS の読み込み順。
//
// index.html のインライン script から assets/js/ へ移した部分は、
// **本体より先に、かつ #c2d などの要素より後に**読まれなければならない。
//
//   - 先に読む理由: 本体(3Dエンジン・入力処理)は、ここで定義される定数や
//     描画関数をトップレベルで参照する。
//   - 要素より後に読む理由: 切り出した側に document.getElementById('c2d') を
//     トップレベルで呼ぶ行がある。<head> に置くと null になり、平面図が
//     一切描かれなくなる。エラーは出ないので気づきにくい。
//
// この順序が崩れると「例外は出ないのに絵が出ない」壊れ方をするので、
// 並びそのものを検査にしてある。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { EXTRACTED, ROOT } = require('./app-source.cjs');

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

test('切り出したファイルはどれも構文として通る', () => {
  for (const rel of EXTRACTED) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: rel }), rel + ' が構文エラー');
  }
});

test('index.html が、切り出した順のとおりに読み込んでいる', () => {
  const at = EXTRACTED.map((rel) => {
    const i = html.indexOf('<script src="' + rel + '">');
    assert.notEqual(i, -1, rel + ' を読む <script> が index.html に無い');
    return i;
  });
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i - 1] < at[i], EXTRACTED[i - 1] + ' より先に ' + EXTRACTED[i] + ' が読まれている');
  }
});

test('切り出した JS は、平面図のキャンバスより後に読まれる', () => {
  // トップレベルで document.getElementById('c2d') を呼ぶ行があるため。
  const canvas = html.indexOf('id="c2d"');
  assert.notEqual(canvas, -1);
  const first = html.indexOf('<script src="' + EXTRACTED[0] + '">');
  assert.ok(canvas < first, '<canvas id="c2d"> より前で読み込んでいる。平面図が描かれなくなる');
});

test('切り出した JS は、本体のインライン script より先に読まれる', () => {
  const last = html.indexOf('<script src="' + EXTRACTED[EXTRACTED.length - 1] + '">');
  const body = html.indexOf('// ───── 3D ENGINE ─────');
  assert.notEqual(body, -1, '本体のインライン script が見つからない');
  assert.ok(last < body, '本体より後に読み込んでいる');
});

test('切り出した側のトップレベルで、本体の関数を呼んでいない', () => {
  // 関数の宣言は巻き上げられるので、1枚の script の中なら後ろで定義した関数を
  // 前から呼べた。ファイルを分けるとそれが効かない。トップレベルの「文」から
  // 本体の関数を呼ぶと、読み込んだ瞬間に落ちる。
  const bodyStart = html.indexOf('// ───── 3D ENGINE ─────');
  const bodyNames = new Set();
  const re = /^(?:async )?function ([A-Za-z0-9_$]+)\(/gm;
  const body = html.slice(bodyStart);
  let m;
  while ((m = re.exec(body))) bodyNames.add(m[1]);
  assert.ok(bodyNames.size > 100, '本体の関数名が拾えていない');

  const offenders = [];
  for (const rel of EXTRACTED) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line || /^[ \t]/.test(line)) return;                 // 字下げ = 何かの中身
      if (/^(\/\/|\/\*|\*)/.test(line)) return;                 // コメント
      if (/^(function|async function|var |let |const |class )/.test(line)) return;  // 宣言
      for (const call of line.matchAll(/([A-Za-z0-9_$]+)\s*\(/g)) {
        if (bodyNames.has(call[1])) offenders.push(`${rel}:${i + 1} ${call[1]}()`);
      }
    });
  }
  assert.deepEqual(offenders, [], '読み込んだ瞬間に落ちる呼び出しがある');
});
