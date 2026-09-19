// 囲む操作の座標が、表示のされ方によってずれないこと。
//
// canvas は object-fit: contain で表示している。縦長の画像だと高さが上限
// (max-height:52dvh)に当たり、要素の箱のほうが絵より横に広くなる。contain は
// 絵を中央に収めるので左右に余白ができ、getBoundingClientRect が返す箱の
// 左端と、絵の左端が一致しなくなる。
const assert = require('assert');
const path = require('path');

global.self = global;
global.document = undefined;
require(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-import.js'));
const fit = global.PlanImport.fitContain;

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

// 余白が無いとき（箱と絵の縦横比が一致）は、箱の左上がそのまま絵の左上。
let f = fit({ left: 10, top: 20, width: 600, height: 400 }, 1200, 800);
near(f.left, 10, '余白が無いのに左がずれた');
near(f.top, 20, '余白が無いのに上がずれた');
near(f.scale, 0.5, '倍率が違う');

// 縦長の絵を、横に広い箱へ入れたとき（高さの上限に当たった状態）。
// 絵は 300x400 で描かれ、左右に (600-300)/2 = 150 ずつ余白ができる。
f = fit({ left: 0, top: 0, width: 600, height: 400 }, 600, 800);
near(f.scale, 0.5, '短いほうの辺に合わせていない');
near(f.left, 150, '左の余白を差し引いていない（始点がずれる原因）');
near(f.top, 0, '上に余計な余白を作っている');

// 横長の絵を、縦に高い箱へ入れたとき。
f = fit({ left: 0, top: 0, width: 400, height: 600 }, 800, 400);
near(f.scale, 0.5, '短いほうの辺に合わせていない');
near(f.left, 0, '左に余計な余白を作っている');
near(f.top, 200, '上の余白を差し引いていない');

// 箱の大きさが取れない場面（表示前など）でも壊れない。
f = fit({ left: 0, top: 0, width: 0, height: 0 }, 100, 100);
assert.ok(isFinite(f.scale) && f.scale > 0, '倍率が数値でない');

console.log('plan-import-crop: ok');
