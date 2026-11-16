// 画面の placeItem・delSel・updateSelectedProp を node:vm で動かす検査のための手伝い。
//
// 3つの関数は、中身を assets/js/plan-core/operations.js(PlanCoreOperations.applyOperations)に任せ、
// 画面の ctx を planOpsCtx(assets/js/plan-data.js)で作る包みになっている。関数の本文だけを切り出して
// 走らせると、この2つが無くて動かない。installOps(ctx) で、本物の operations.js と、本物の
// planCoreCtx・planOpsCtx の本文を vm の文脈に入れる。
//
// planOpsCtx は作る時点で吸着の設定(定数と関数)を読むので、文脈に無いものだけ既定の値を入れる。
// 検査が本物の関数を自分で入れている場合はそちらが使われる(既にある名前は上書きしない)。
const vm = require('node:vm');
const { join } = require('node:path');
const { appSource, ROOT } = require('./app-source.cjs');
const Ops = require(join(ROOT, 'assets', 'js', 'plan-core', 'operations.js'));

function topLevelFunction(name) {
  const html = appSource();
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' がソースに無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
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

const DEFAULTS = {
  EDGE_SNAP_THRESH: 80, STAIR_SNAP_MM: 250, STAIR_LINK_MIN_SPAN_MM: 100,
  RULER_THICKNESS_MM: 60, WALK_ROUTE_THICKNESS_MM: 50, WALK_DEFAULT_SPEED_MPS: 1.2,
  stairPartEdgesMm: () => [], isStairPartType: (t) => t === 'stair' || t === 'stair-corner' || t === 'stair-landing',
  isPlanAnnotationType: () => false, wallThicknessMm: () => 120,
  syncExteriorWallSettings: () => {},
};

// ctx: vm.createContext で作った文脈。DATA が無ければ空のプランを入れる(画面の選択がプランの外の物でも動く)。
function installOps(ctx) {
  ctx.PlanCoreOperations = Ops;
  if (ctx.DATA === undefined) ctx.DATA = { walls: [], rooms: [], items: [] };
  for (const k of Object.keys(DEFAULTS)) if (ctx[k] === undefined) ctx[k] = DEFAULTS[k];
  vm.runInContext(['planCoreCtx', 'planOpsCtx'].map(topLevelFunction).join('\n'), ctx);
  return ctx;
}

module.exports = { installOps, topLevelFunction };
