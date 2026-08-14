// ウォークスルーを抜けたあと、扉の開閉設定が効かなくなる不具合。
//
// ウォークスルー中の近接開閉(近づくと開く/離れると閉まる)は _doorWantByItem に記録される。
// 家具の非同期ロード完了ごとに走る rebuild3D() をまたいで開閉アニメを保つためのもので、
// これ自体は必要。問題はこの記録がウォークスルーを抜けても残り、扉の生成時に
// プランの doorOpenState より優先されつづけること。
// 扉から離れて終了すると 0(閉) が残り、外観3D/内観3Dで「開く」に設定しても閉じたまま、
// 二度と開けられなくなる。
//
// grep ではなく、index.html の関数を実際に動かして判定そのものを見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start), depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}

// 扉の開閉に関わる関数だけを取り出して動かす。カメラも three.js も要らない。
function loadDoorWant() {
  const sandbox = {
    ST: { view: '2d' },
    WALK: { active: false, x: 0, z: 0, floor: 1 },
    floorTopY: function () { return 0; }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'var _doorAnims=[];',
    'var _doorWantByItem=new WeakMap();',
    topLevelFunction('isWalkView'),
    topLevelFunction('doorOpenState'),
    topLevelFunction('doorOpenWant'),
    topLevelFunction('resetWalkDoorWants'),
    topLevelFunction('updateWalkDoors')
  ].join('\n'), sandbox);
  return sandbox;
}

// ウォークスルーで扉から離れた状態を作る(近接判定が閉を書き込む)
function walkAwayFrom(s, it) {
  const grp = { position: { x: 100, y: 0, z: 100 } };  // プレイヤーから十分遠い
  s._doorAnims.push({ it: it, grp: grp, pivot: { rotation: { y: 0 } }, openY: 1.57, _want: 1 });
  s.ST.view = '3d-walk';
  s.WALK.active = true;
  s.updateWalkDoors(0.016);
}

test('最重要: ウォークスルーを抜けたら、扉は「開く」設定どおりに開く', () => {
  const s = loadDoorWant();
  const door = { type: 'door-hinge', doorOpenState: 'open' };

  assert.equal(s.doorOpenWant(door), 1, '前提: ウォークスルー前は開いている');
  walkAwayFrom(s, door);
  assert.equal(s._doorWantByItem.get(door), 0, '前提: 離れたので閉が記録されている');

  // ウォークスルーを抜けて外観3Dへ
  s.ST.view = '3d-ext';
  s.WALK.active = false;
  s.resetWalkDoorWants();

  assert.equal(s.doorOpenWant(door), 1,
    'ウォークスルー中の閉状態が残り、「開く」設定の扉が閉じたままになっている');
});

test('ウォークスルーを抜けたあとに「開く」へ設定し直せば必ず開く', () => {
  const s = loadDoorWant();
  const door = { type: 'door-hinge', doorOpenState: 'closed' };
  walkAwayFrom(s, door);
  s.ST.view = '3d-int';
  s.WALK.active = false;
  s.resetWalkDoorWants();

  door.doorOpenState = 'open';   // ユーザーが開閉状態を「開く」に変更
  assert.equal(s.doorOpenWant(door), 1, '設定を変えても開かない = 操作不能になっている');
});

test('ウォークスルー中は近接開閉が勝つ(rebuild3D でパタパタしない)', () => {
  const s = loadDoorWant();
  const door = { type: 'door-hinge', doorOpenState: 'open' };
  walkAwayFrom(s, door);
  // ウォークスルーのまま。家具ロード完了で rebuild3D() が走る想定
  assert.equal(s.doorOpenWant(door), 0,
    'ウォークスルー中に離れた扉が、再生成のたびにプラン既定の開へ戻ってしまう');
});

test('記録が無い扉は、ウォークスルー中でもプランの開閉状態に従う', () => {
  const s = loadDoorWant();
  s.ST.view = '3d-walk';
  s.WALK.active = true;
  assert.equal(s.doorOpenWant({ doorOpenState: 'open' }), 1);
  assert.equal(s.doorOpenWant({ doorOpenState: 'closed' }), 0);
});

test('開閉状態が未設定の扉は開扱い(既存プランの見た目を変えない)', () => {
  const s = loadDoorWant();
  assert.equal(s.doorOpenWant({ type: 'door-hinge' }), 1);
});

test('resetWalkDoorWants は記録を消し、以後は近接判定で入れ直せる', () => {
  const s = loadDoorWant();
  const door = { type: 'door-hinge', doorOpenState: 'open' };
  walkAwayFrom(s, door);
  s.resetWalkDoorWants();
  assert.equal(s._doorWantByItem.has(door), false, '記録が残っている');
  s.updateWalkDoors(0.016);
  assert.equal(s._doorWantByItem.has(door), true, '再度ウォークスルーすれば記録し直せる');
});

// 判定の重複が復活すると、片方だけ直った状態に戻る
test('扉の生成側は _doorWantByItem を直接読まず doorOpenWant を通す', () => {
  const body = topLevelFunction('buildWinFrames');
  const leaks = [];
  body.split('\n').forEach(function (line, i) {
    if (/_doorWantByItem/.test(line)) leaks.push((i + 1) + ': ' + line.trim());
  });
  assert.deepEqual(leaks, [], 'この行はウォークスルー終了後も閉状態を引きずる:\n' + leaks.join('\n'));
});

// ビュー切替の出口でしか記録を捨てられないので、配線が消えたら気づけるようにする
test('ウォークスルーを離れる setView の分岐で記録を捨てている', () => {
  const body = topLevelFunction('setView');
  const at = body.indexOf("v!=='3d-walk'");
  assert.notEqual(at, -1, 'setView にウォークスルーを離れる分岐が無い');
  const block = body.slice(at, at + 700);
  assert.match(block, /resetWalkDoorWants\(\)/,
    'ウォークスルーを離れるときに扉の開閉記録を捨てていない');
});
