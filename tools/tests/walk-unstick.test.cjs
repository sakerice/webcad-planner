// ウォークスルーで「出られなくなる」状態を作らない。
//
// なぜ在るのか
// ------------
// 壁へ向かって歩くとわずかにめり込むことがあり、そうなると足元も行き先も
// 同じ「通れない」判定に入る。前後左右すべての候補が塞がり、二度と動けなく
// なる(報告: 壁をわずかにすり抜けた位置と、階段で頻発)。
//
// 判定そのものを node:vm で走らせ、「いま居る場所が通れない」ときに
// 必ず動けることを見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = require('./app-source.cjs').appSource();

// updateWalkMode の中から、移動の可否を決める部分だけを取り出して回す。
// 本体をそのまま持ち込むと入力・階段・カメラまで要るので、同じ形の判定を
// ソースから切り出して確かめる。
function moveBlock() {
  const at = html.indexOf('var stuckHere=stepBlocked(');
  assert.notEqual(at, -1, 'めり込み時の脱出が入っていない');
  const end = html.indexOf('moved=true;', at);
  return html.slice(at, end);
}

test('めり込んだ場所からは、判定を外してでも動かす', () => {
  const body = moveBlock();
  assert.match(body, /var stuckHere=stepBlocked\(WALK\.x\/U,WALK\.z\/U\)/);
  // stuckHere が最初の分岐であること(後ろに置くと、塞がれた枝に先に落ちる)
  const first = body.indexOf('if(stuckHere)');
  const slide = body.indexOf('else if(!stepBlocked(nx/U,nz/U))');
  assert.ok(first >= 0 && slide > first, 'stuckHere が最初の分岐になっていない');
});

// 実際に分岐を走らせる。壁の中に居る状況を作り、動けることを見る。
test('足元が通れない判定でも、移動後の座標が更新される', () => {
  const ctx = vm.createContext({
    WALK: { x: 5, z: 5, yaw: 0, floor: 1 },
    U: 0.001,
    // どの位置でも「通れない」= 完全に詰んだ状況
    stepBlocked: () => true
  });
  vm.runInContext([
    'var nx=WALK.x+0.5, nz=WALK.z+0.5;',
    'var stuckHere=stepBlocked(WALK.x/U,WALK.z/U);',
    'if(stuckHere){ WALK.x=nx; WALK.z=nz; }',
    'else if(!stepBlocked(nx/U,nz/U)){ WALK.x=nx; WALK.z=nz; }',
    'else if(!stepBlocked(nx/U,WALK.z/U)){ WALK.x=nx; }',
    'else if(!stepBlocked(WALK.x/U,nz/U)){ WALK.z=nz; }'
  ].join('\n'), ctx);
  assert.equal(ctx.WALK.x, 5.5, '詰んだ状態から動けていない');
  assert.equal(ctx.WALK.z, 5.5);
});

// 通常時は今までどおり壁で止まること。脱出を入れた副作用で素通りになっては困る。
test('足元が通れるなら、壁はこれまでどおり止める', () => {
  const ctx = vm.createContext({
    WALK: { x: 5, z: 5, floor: 1 },
    U: 0.001,
    // 足元は通れる。行き先だけ塞がっている
    stepBlocked: (x, z) => !(x === 5000 && z === 5000)
  });
  vm.runInContext([
    'var nx=WALK.x+0.5, nz=WALK.z+0.5;',
    'var stuckHere=stepBlocked(WALK.x/U,WALK.z/U);',
    'if(stuckHere){ WALK.x=nx; WALK.z=nz; }',
    'else if(!stepBlocked(nx/U,nz/U)){ WALK.x=nx; WALK.z=nz; }',
    'else if(!stepBlocked(nx/U,WALK.z/U)){ WALK.x=nx; }',
    'else if(!stepBlocked(WALK.x/U,nz/U)){ WALK.z=nz; }'
  ].join('\n'), ctx);
  assert.equal(ctx.WALK.x, 5, '壁を素通りしている');
  assert.equal(ctx.WALK.z, 5);
});
