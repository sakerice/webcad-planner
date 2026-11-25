// 平面図の選択順(重ね順)。
//
// 直した不良: 「最背面へ」は DATA.items の並び替えだけで、アイテムを壁・部屋・
// 敷地より後ろへ回すことができなかった。大きな板や屋根が1枚重なっているだけで、
// 下にある壁はどう頑張っても選べない。
// 重ね順を obj.stack という共通の数値にし、種別の既定順より先に見るようにした。
// stack を持たない(= 既存の保存プランの)オブジェクトは 0 なので、何も設定して
// いないプランの選択順は1つも変わらない。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = require('./app-source.cjs').appSource();
const { installOps } = require('./ops-vm.cjs');

function topLevelFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}

const FNS = [
  'objectStackOrder', 'stackableObjectsOnFloor', 'canChangeStackOrder',
  'stackOrderAdjustedCount', 'applyStackOrder',
  'itemDrawOrderLayerKey', 'canSendItemToBack',
  'findItemLayerBackIndex', 'findItemLayerFrontIndex',
  'collect2DPickCandidates'
];

// 当たり判定そのものは別のテストの領分。ここで測るのは **並び順** なので、
// 形の判定は「全部当たっている」に固定して、重なりの順序だけを見る。
function ctxFor(data, floor) {
  const ctx = vm.createContext({
    console, Number, Math, isFinite, Array, Object, JSON,
    DATA: data, ST: { floor: floor || 1 },
    isInsideItem: () => true,
    nearWall: () => true,
    isNearRoomLabel: () => true,
    isNearItemBorder: () => true,
    isFoundationSelectableHit: () => true
  });
  vm.runInContext([topLevelVar('PICK_RANK')].concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

function plan() {
  return {
    items: [
      { id: 'site', type: 'site-rect', floor: 1 },
      { id: 'fnd', type: 'foundation', floor: 1 },
      { id: 'deskA', type: 'table', floor: 1 },
      { id: 'deskB', type: 'table', floor: 1 }
    ],
    walls: [{ id: 'w1', floor: 1 }],
    rooms: [{ id: 'r1', floor: 1, n: 'LDK' }]
  };
}
// VM の中で作られた配列はこちらの Array とは別物なので、deepEqual は
// 「構造は同じだが同一でない」で落ちる。文字列にして比べる。
function order(ctx, opt) {
  return ctx.collect2DPickCandidates(0, 0, 0, 0, opt || {}).map(c => c.obj.id).join(' ');
}

test('既定の並びは従来のヒットテストの順序と同じ', () => {
  const ctx = ctxFor(plan());
  // アイテム(配列の後ろが手前) → 部屋名 → 壁 → 基礎 → 敷地
  assert.equal(order(ctx), 'deskB deskA r1 w1 fnd site');
});

test('部屋の内部は既定では候補に入らない（空きスペースのドラッグ選択を残す）', () => {
  const ctx = ctxFor(plan());
  ctx.isNearRoomLabel = () => false;          // 名前から外れた位置
  assert.equal(order(ctx), 'deskB deskA w1 fnd site');
  // 巡回のときだけ部屋の内部も候補になる
  assert.equal(order(ctx, { includeRoomArea: true }), 'deskB deskA w1 r1 fnd site');
});

// ── 直した不良 ──────────────────────────────────────────────────────────
test('アイテムを最背面へ回すと、下の壁が選べるようになる', () => {
  const ctx = ctxFor(plan());
  const deskB = ctx.DATA.items[3];
  ctx.applyStackOrder(deskB, false);
  assert.equal(ctx.objectStackOrder(deskB), -1);
  assert.equal(order(ctx), 'deskA r1 w1 fnd site deskB');
});

test('壁を最前面へ出すと、重なったアイテムより先に選ばれる', () => {
  const ctx = ctxFor(plan());
  const wall = ctx.DATA.walls[0];
  ctx.applyStackOrder(wall, true);
  assert.equal(ctx.objectStackOrder(wall), 1);
  assert.equal(order(ctx).split(' ')[0], 'w1');
});

test('続けて後ろに回すと、後から回したものがより後ろへ行く', () => {
  const ctx = ctxFor(plan());
  const a = ctx.DATA.items[2], b = ctx.DATA.items[3];
  ctx.applyStackOrder(b, false);
  ctx.applyStackOrder(a, false);
  assert.equal(ctx.objectStackOrder(b), -1);
  assert.equal(ctx.objectStackOrder(a), -2);
  assert.equal(order(ctx), 'r1 w1 fnd site deskB deskA');
});

test('重ね順は壁・部屋・アイテムのどれにも付けられる（以前はアイテムだけ）', () => {
  const ctx = ctxFor(plan());
  assert.equal(ctx.canChangeStackOrder(ctx.DATA.walls[0]), true);
  assert.equal(ctx.canChangeStackOrder(ctx.DATA.rooms[0]), true);
  assert.equal(ctx.canChangeStackOrder(ctx.DATA.items[2]), true);
  assert.equal(ctx.canChangeStackOrder({ id: 'x' }), false);
});

test('重ね順を変えた数は階ごとに数える', () => {
  const ctx = ctxFor(plan());
  assert.equal(ctx.stackOrderAdjustedCount(1), 0);
  ctx.applyStackOrder(ctx.DATA.walls[0], true);
  assert.equal(ctx.stackOrderAdjustedCount(1), 1);
  assert.equal(ctx.stackOrderAdjustedCount(2), 0);
});

test('他の階のオブジェクトは重ね順の計算にも候補にも入らない', () => {
  const p = plan();
  p.items.push({ id: 'up', type: 'table', floor: 2, stack: 9 });
  const ctx = ctxFor(p);
  assert.equal(order(ctx).indexOf('up'), -1);   // 2階のものは候補に出ない
  ctx.applyStackOrder(ctx.DATA.items[3], true);
  assert.equal(ctx.objectStackOrder(ctx.DATA.items[3]), 1);  // 2階の 9 に引きずられない
});

// ── アイテムの描画順（配列の並び）──────────────────────────────────────
test('同じ階のアイテム帯の先頭/末尾を返す（描画順を重ね順に合わせるため）', () => {
  const ctx = ctxFor(plan());
  const item = ctx.DATA.items[3];
  assert.equal(ctx.findItemLayerBackIndex(item), 2);
  assert.equal(ctx.findItemLayerFrontIndex(item), 4);
  // 敷地と基礎は別の帯なので、アイテムの並び替えでは動かさない
  assert.equal(ctx.canSendItemToBack(ctx.DATA.items[0]), false);
  assert.equal(ctx.canSendItemToBack(ctx.DATA.items[1]), false);
});

test('その階にアイテムが1つも無ければ末尾を返す（帯が無いときの行き先）', () => {
  const p = plan();
  const lone = { id: 'lone', type: 'table', floor: 3 };
  const ctx = ctxFor(p);
  assert.equal(ctx.findItemLayerBackIndex(lone), p.items.length);
  assert.equal(ctx.findItemLayerFrontIndex(lone), p.items.length);
});

// ── 重なりの巡回 ────────────────────────────────────────────────────────
test('掴んで動かしたクリックでは巡回しない（掴み直すたびに下へ落ちない）', () => {
  const body = topLevelFunction('advancePickCycleOnClick');
  assert.match(body, /PICK_CYCLE\.moved/);
  const move = topLevelFunction('moveSelectedInStack');
  assert.match(move, /resetPickCycle\(\)/);
  // タップは mousedown を2回投げない（1タップで巡回が起きてしまう）
  const touchEnd = html.slice(html.indexOf("canvas.addEventListener('touchend'"));
  const tap = touchEnd.slice(0, touchEnd.indexOf('_touch1.active=false'));
  assert.equal((tap.match(/MouseEvent\('mousedown'/g) || []).length, 0);
});

// ── タッチでの複数選択 ────────────────────────────────────────────────
// タブレットでは複数選択が1つもできなかった。物理Shiftキーが無く、
// 1本指のドラッグは範囲選択ではなく図面のパンになるため。
test('複数選択は物理Shiftか「複数選択」モードのとき（仮想Shiftは使わない）', () => {
  const fn = topLevelFunction('isMultiSelectModifier');
  assert.match(fn, /ST\.multiSelectMode/);
  assert.match(fn, /e\.shiftKey/);
  // 仮想Shift(mobileShift)はモバイルで既定ONなので、流用すると通常のタップが
  // すべて追加選択になる。ここに混ぜてはいけない。
  assert.doesNotMatch(fn, /mobileShift/);
  const ctx = vm.createContext({ ST: { multiSelectMode: false } });
  vm.runInContext(fn, ctx);
  assert.equal(ctx.isMultiSelectModifier({}), false);
  assert.equal(ctx.isMultiSelectModifier({ shiftKey: true }), true);
  ctx.ST.multiSelectMode = true;
  assert.equal(ctx.isMultiSelectModifier({}), true);
});

test('タッチの範囲選択は「複数選択」モードのときだけ（普段の1本指はパンのまま）', () => {
  const fn = topLevelFunction('touchMarqueeActive');
  const ctx = vm.createContext({ ST: { multiSelectMode: false }, DRAG: { marquee: null } });
  vm.runInContext(fn, ctx);
  assert.equal(ctx.touchMarqueeActive(), false);
  ctx.DRAG.marquee = {};
  assert.equal(ctx.touchMarqueeActive(), false, 'モードOFFなら矩形にしない＝パンが効く');
  ctx.ST.multiSelectMode = true;
  assert.equal(ctx.touchMarqueeActive(), true);
  // 1本指のパンの分岐がこの判定で塞がれている
  const touchMove = html.slice(html.indexOf("canvas.addEventListener('touchmove'"));
  assert.match(touchMove.slice(0, 1200), /_touch1\.moved&&ST\.tool==='select'&&!touchMarqueeActive\(\)/);
});

test('「複数選択」は既定OFFの独立した切り替えで、モバイルの欄に出る', () => {
  assert.match(html, /multiSelectMode:false/);
  assert.match(html, /id="multi-select-btn"[^>]*onclick="toggleMultiSelectMode\(\)"/);
  assert.match(html, /複数選択: OFF<\/button>/);
});

// ── 3Dビューでの複数選択 ──────────────────────────────────────────────
// 3Dの選択は ST.selected への代入だけで、複数選択の仕組みが一度も入って
// いなかった(デスクトップのShift+クリックでも1つしか選べない)。
test('3Dの選択も複数選択の修飾を見る', () => {
  const fn = topLevelFunction('handle3DPointerPick');
  assert.match(fn, /isMultiSelectModifier\(e\)/);
  assert.match(fn, /ST\.multiSelected=list\.slice\(0,-1\)/);
  // 単独で選び直したら、平面図で掴んでいた選択は必ず捨てる
  assert.match(fn, /clearMultiSelection\(\);\s*\n\s*ST\.selected=ref;/);
});

test('3Dの選択枠は選択中のすべてに出る（札は主役だけ）', () => {
  const fn = topLevelFunction('add3DSelectionMarker');
  assert.match(fn, /explicit2DSelection\(\)\.forEach/);
  const one = topLevelFunction('add3DSelectionMarkerFor');
  assert.match(one, /if\(!primary\)\{ sc3\.add\(group\); return; \}/);
});

test('3Dの移動ギズモは選択中をまとめて動かす', () => {
  const start = topLevelFunction('start3DGizmoDrag');
  assert.match(start, /GIZMO_DRAG\.group=explicit2DSelection\(\)/);
  // 部分移動は全員ぶん取れたときだけ。1つでも取れなければ組み直す
  assert.match(start, /partialOk\?roots:null/);
  const apply = topLevelFunction('apply3DGizmoDrag');
  assert.match(apply, /\(gd\.group\|\|\[\{obj:ref,orig:gd\.orig\}\]\)\.forEach/);
});

// 画面の delSel を、操作の部品(PlanCoreOperations)と画面の ctx(planOpsCtx)ごと node:vm で動かして、
// 複数選択した物が全部消えることを確かめる(関数の本文の文字は見ない)。
function delSelCtx(data) {
  const log = { save: 0, sync: 0 };
  const ctx = vm.createContext({
    console, Number, Math, isFinite, Array, Object, JSON, String,
    DATA: data, ST: { floor: 1, selected: null, multiSelected: [], selectAll: false, snap: 10, shiftKey: false },
    DRAG: {}, WALKTHROUGH: null, ren: null, nextId: 9000,
    isObjectLocked: (o) => !!(o && o.locked),
    saveState: () => { log.save++; }, syncExteriorWallSettings: () => { log.sync++; },
    updateProps: () => {}, draw2d: () => {},
  });
  installOps(ctx);
  vm.runInContext(['explicit2DSelection', 'clearMultiSelection', 'delSel'].map(topLevelFunction).join('\n'), ctx);
  ctx.log = log;
  return ctx;
}

test('削除は選択中すべてに効く（1つしか消えなかった）', () => {
  const data = {
    walls: [{ id: 1, floor: 1, x1: 0, y1: 0, x2: 1000, y2: 0 }, { id: 2, floor: 1, x1: 0, y1: 0, x2: 0, y2: 1000 }],
    rooms: [{ id: 'r1', floor: 1, x: 0, y: 0, w: 1000, d: 1000 }],
    items: [
      { id: 10, type: 'sofa', floor: 1, x: 0, y: 0, w: 100, d: 100 },
      { id: 11, type: 'desk', floor: 1, x: 0, y: 0, w: 100, d: 100 },
      { id: 12, type: 'bed', floor: 1, x: 0, y: 0, w: 100, d: 100, locked: true },
      { id: 13, type: 'tv', floor: 1, x: 0, y: 0, w: 100, d: 100 },
    ],
  };
  const c = delSelCtx(data);
  // 家具2つ・壁1つ・ロックした家具1つを選んで消す
  c.ST.selected = data.items[1];
  c.ST.multiSelected = [data.items[0], data.walls[0], data.items[2]];
  c.delSel();
  assert.deepEqual(c.DATA.items.map((o) => o.id), [12, 13], '選んだ家具が全部は消えていない(ロックした物は残る)');
  assert.deepEqual(c.DATA.walls.map((o) => o.id), [2], '選んだ壁が消えていない');
  assert.deepEqual(c.DATA.rooms.map((o) => o.id), ['r1']);
  assert.equal(c.log.save, 1, '取り消しの履歴に1回だけ積む');
  assert.equal(c.log.sync, 1, '外壁の設定表を片付けていない');
  assert.equal(c.ST.selected, null);
  assert.equal(c.ST.multiSelected.length, 0);
  // ロックした物だけを選んでいるときは、何も消さず履歴にも積まない
  const c2 = delSelCtx(data);
  c2.ST.selected = data.items.find((o) => o.id === 12);
  c2.delSel();
  assert.deepEqual(c2.DATA.items.map((o) => o.id), [12, 13]);
  assert.equal(c2.log.save, 0);
  // id が重なった古いプランでも、選んだ方だけが消える(物そのものを指して消す)
  const dup = { walls: [], rooms: [], items: [{ id: 5, type: 'sofa', floor: 1 }, { id: 5, type: 'desk', floor: 1 }] };
  const c3 = delSelCtx(dup);
  c3.ST.selected = dup.items[1];
  c3.delSel();
  assert.deepEqual(c3.DATA.items.map((o) => o.type), ['sofa'], 'id が重なった物で、選んでいない方まで消えた・選んだ方が消えない');
  const label = topLevelFunction('selectedDeleteButtonHtml');
  assert.match(label, /選択中の'\+n\+'個を削除/);
});

// ── 屋根の結合が「なぜできないか」を言う ──────────────────────────────
test('結合できない屋根を選んだら理由を出す（既定プランは屋根が2階と3階に分かれている）', () => {
  const fn = topLevelFunction('roofMergeMembers');
  assert.match(fn, /rejected/);
  assert.match(fn, /別の階/);
  assert.match(fn, /回転角が違います/);
  const section = topLevelFunction('roofMergeSectionHtml');
  // 結合できないときも節ごと消さない(やり方が画面から消えてしまう)
  assert.match(section, /やり方/);
  assert.match(section, /複数選択/);
  assert.doesNotMatch(section, /return '';/);
});

test('階ごとの高さは上の行が上の階（3Dビューと上下をそろえる）', () => {
  const fn = topLevelFunction('syncHeightDefaultsUI');
  assert.match(fn, /HEIGHT_SETTING_FLOORS\.slice\(\)\.reverse\(\)/);
});

// ── 3Dのタッチが「残る」問題 ──────────────────────────────────────────
// OrbitControls が setPointerCapture するのは最初の1本だけなので、2本目以降の
// 指をキャンバスの外(タブレットでは3Dを囲むサイドメニュー等)で離すと pointerup が
// 届かず、内部の _pointers に残る。残ったまま次に1本指で触ると「2本指」と
// 数えられ、回転のはずが拡大縮小になる。
test('離れた指はOrbitControlsの表から掃除する', () => {
  const fn = topLevelFunction('release3DStalePointers');
  assert.match(fn, /orbit\._pointers\.filter/);
  assert.match(fn, /orbit\._removePointer/);
  assert.match(fn, /orbit\.state=-1/);        // _STATE.NONE
  // window で捕まえる(キャンバスに届かない pointerup を拾うのが目的なので
  // キャンバスに貼っても意味がない)
  assert.match(html, /window\.addEventListener\('pointerup',note3DPointerUp,true\)/);
  assert.match(html, /window\.addEventListener\('pointercancel',note3DPointerUp,true\)/);

  const ctx = vm.createContext({
    orbit: { _pointers: [11, 22], state: 5, _removePointer(e) { this._pointers = this._pointers.filter(id => id !== e.pointerId); } },
    _t3d: { t1down: true, p2x: 1, p2y: 2 },
    _live3DPointers: { 11: 1 }                 // 22 はもう離れている
  });
  vm.runInContext(fn, ctx);
  ctx.release3DStalePointers();
  assert.equal(ctx.orbit._pointers.join(','), '11', '離れた指だけを落とす');
  assert.equal(ctx.orbit.state, 5, 'まだ指が残っていれば状態は触らない');
  ctx._live3DPointers = {};
  ctx.release3DStalePointers();
  assert.equal(ctx.orbit._pointers.length, 0);
  assert.equal(ctx.orbit.state, -1, '全部離れたら NONE に戻す');
  assert.equal(ctx._t3d.t1down, false);
});

test('内観3D: 2本指から1本離しても、残った指で回転を続けられる', () => {
  const block = html.slice(html.indexOf('function init3DTouchOnce'));
  const touchEnd = block.slice(block.indexOf("el.addEventListener('touchend'"));
  const body = touchEnd.slice(0, touchEnd.indexOf('},{passive:false});'));
  assert.match(body, /e\.touches&&e\.touches\.length===1/);
  assert.match(body, /_t3d\.t1down=true/);
  assert.match(body, /_t3d\.lx=e\.touches\[0\]\.clientX/);
});

// ── 斜線制限のパネル ──────────────────────────────────────────────────
test('斜線制限の断り書きは畳む（消さずに、既定では出さない）', () => {
  const fn = topLevelFunction('siteSetbackPanelHtml');
  assert.match(fn, /<details class="prop-details">/);
  // 常に出るのは1行だけ
  assert.match(fn, /確認申請には使えません/);
  // 何を見ていないかは畳んだ中に残っている
  assert.match(fn, /絶対高さ制限（法55条/);
  assert.match(fn, /日影規制（法56条の2）/);
});

test('操作ガイドはクリックを通す（平面図の左上が永久に選べなくなっていた）', () => {
  const m = require('./app-source.cjs').appCss().match(/#help-box\{[^}]*\}/);
  assert.notEqual(m, null);
  assert.match(m[0], /pointer-events:none/);
});
