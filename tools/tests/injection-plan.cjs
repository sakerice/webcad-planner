// 攻撃の文字を入れたプランを作る部品。画面テスト(injection-screen.browser.mjs)と
// node の単体テスト(html-injection.test.cjs)が同じプランを使う。
//
// 攻撃の文字は fixtures/injection/payloads.json、土台は fixtures/house-2f.json。
// evilPlan(v, faceKeys, opts) の v(field) は欄に入れる文字を返す。field は「どの欄か」の名前。
// faceKeys は土台のプランの壁の面の設定の鍵({exterior:[…], interior:[…]})。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const PAYLOADS = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'injection', 'payloads.json'), 'utf8'));
const BASE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 攻撃の文字 ───────────────────────────────────────────────
function stringPayloads() {
  const long = PAYLOADS.long;
  const longValue = long.unit.repeat(Math.ceil(long.length / long.unit.length)).slice(0, long.length);
  return [...PAYLOADS.markup, ...PAYLOADS.urls, ...PAYLOADS.control, { id: long.id, value: longValue }];
}
const tagged = (p) => (field) => p.value.split(PAYLOADS.tag).join(field);
// 長い文字は、欄の種類ごとに2つまでに入れる(全部に入れるとプランが 50MB を超える)
function sparse(v) {
  const seen = {};
  return (field) => { const k = field.replace(/#.*$/, ''); seen[k] = (seen[k] || 0) + 1; return seen[k] <= 2 ? v(field) : 'x-' + field; };
}
// 継承した鍵の名前は、欄ごとに順に配る(同じ鍵が id で重ならないよう、id には番号を付けない)
function inheritedValue() {
  const keys = PAYLOADS.inheritedKeys;
  let i = 0;
  return () => keys[i++ % keys.length];
}

// ── 悪いプランを作る ─────────────────────────────────────────
// v(field) が欄に入れる文字を返す。field は「どの欄か」の名前(__TAG__ の置き換え先)。
// faceKeys は土台のプランを一度開いて集めた、壁の面の設定の鍵({exterior:[…], interior:[…]})。
function evilPlan(v, faceKeys, opts = {}) {
  const p = clone(opts.base || BASE);
  const ex = p.exteriorWallSettings, ins = p.interiorWallSettings;
  const rekeyWall = (oldId, newId) => {
    const ok = String(oldId), nk = String(newId);
    if (ex.walls && Object.prototype.hasOwnProperty.call(ex.walls, ok)) { Object.defineProperty(ex.walls, nk, { value: ex.walls[ok], enumerable: true, writable: true, configurable: true }); delete ex.walls[ok]; }
    for (const s of [ex, ins]) {
      for (const k of Object.keys(s.faces || {})) if (k.startsWith(ok + '_')) { s.faces[nk + k.slice(ok.length)] = s.faces[k]; delete s.faces[k]; }
    }
  };
  // 面の設定(個別設定にして、色と画像と巾木の色を入れる)
  for (const [s, keys, name] of [[ex, faceKeys.exterior, 'ext'], [ins, faceKeys.interior, 'int']]) {
    s.faces = s.faces || {};
    keys.forEach((k, i) => { s.faces[k] = { mode: 'custom', color: v(name + '.face.color#' + i), texture: v(name + '.face.texture#' + i), textureFlipX: false, textureFlipY: false, skirting: true, skirtingColor: v(name + '.face.skirtingColor#' + i) }; });
  }
  // 壁
  p.walls.forEach((w, i) => {
    w.color = v('wall.color#' + i); w.exteriorColor = v('wall.exteriorColor#' + i); w.interiorColor = v('wall.interiorColor#' + i);
    if (i % 3 === 0) w.texture = v('wall.texture#' + i);
  });
  // 薄い壁(厚み 120 未満)は欄に色が出る。1枚は薄くしておく
  p.walls[5].thick = 90;
  p.walls[2].thick = v('wall.thick');
  // id を差し替える壁(面の設定の鍵もいっしょに付け替える)
  [0, 1, 3].forEach((i, n) => { const nid = opts.inherited ? v('wall.id') : v('wall.id#' + n); rekeyWall(p.walls[i].id, nid); p.walls[i].id = nid; });
  // 部屋
  p.rooms.forEach((r, i) => {
    r.n = v('room.n#' + i); r.floorColor = v('room.floorColor#' + i); r.ceilingColor = v('room.ceilingColor#' + i);
    if (i % 2) { r.texture = v('room.texture#' + i); r.ceilingTexture = v('room.ceilingTexture#' + i); r.floorMaterial = v('room.floorMaterial#' + i); }
  });
  p.rooms[4].floorRaiseMm = v('room.floorRaiseMm'); p.rooms[6].ceilingHeight = v('room.ceilingHeight');
  [2, 7].forEach((i, n) => { p.rooms[i].id = opts.inherited ? v('room.id') : v('room.id#' + n); });
  // 物
  const textKeys = ['color', 'name', 'label', 'texture', 'model', 'lightColor', 'sashColor', 'roofEdgeColor', 'gapInfillColor',
    'railCapColor', 'railFrameColor', 'coveColor', 'windowStd', 'stairTo', 'baseRoom', 'doorFinish', 'gutterMode'];
  p.items.forEach((it, i) => {
    for (const k of textKeys) it[k] = v('item.' + k + '#' + i);
    it.finishColors = { wood: v('item.finishColors.wood#' + i), fabric: v('item.finishColors.fabric#' + i), metal: v('item.finishColors.metal#' + i), accent: v('item.finishColors.accent#' + i), body: v('item.finishColors.body#' + i) };
    it.finishTextures = { wood: v('item.finishTextures.wood#' + i), fabric: v('item.finishTextures.fabric#' + i) };
    if (it.type === 'memo') it.noteText = v('memo.noteText');
    if (it.type === 'site-rect') {
      it.siteSurface = v('site.siteSurface#' + i);
      it.siteZones = [{ name: v('site.zone.name#' + i), x: 0, y: 0, w: 1000, d: 1000, surface: v('site.zone.surface#' + i) }];
      it.setback = { zone: v('site.setback.zone#' + i), road: true, north: true };
    }
    if (it.type === 'roof') { it.roofType = v('roof.roofType#' + i); it.gapInfillTexture = v('roof.gapInfillTexture#' + i); }
    if (it.type === 'stair') { it.stairOrder = v('stair.stairOrder'); it.stairStyle = v('stair.stairStyle'); it.stairRail = v('stair.stairRail'); it.stairTarget = 'level'; }
    if (/^light-/.test(it.type)) it.lightKind = v('light.lightKind#' + i);
  });
  // 数の欄に文字(設定欄に値として出る物)
  const tree = p.items.find((it) => it.type === 'tree');
  Object.assign(tree, { sScale: v('item.sScale'), sX: v('item.sX'), sY: v('item.sY'), rot: v('item.rot'), elev: v('item.elev') });
  const block = p.items.find((it) => it.type === 'custom-block'); block.customHeight = v('item.customHeight');
  const meter = p.items.find((it) => it.type === 'meter-box'); meter.sScale = v('item.sScale#meter');
  // 階の欄に文字(一括差し替えのダイアログは階をそのまま出していた)
  const fmp = p.items.find((it) => /^fmp-Sofa/.test(it.type)); fmp.floor = opts.inherited ? v('item.floor') : 1;
  // 種類名と id(種類名は、継承した鍵を全部入れる。文字の攻撃のときは2つ)
  const plain = p.items.filter((it) => ['tree', 'bicycle', 'sewer-pit', 'fmp-AirConditionerWall01', 'ac-outdoor', 'im0261-Curtain-MEGA_PACK_Curtain-curtain-177647', 'light-down'].includes(it.type));
  if (opts.inherited) plain.forEach((it) => { it.type = v('item.type'); });
  else plain.slice(0, 2).forEach((it, n) => { it.type = v('item.type#' + n); });
  p.items.filter((it) => it.type === 'sewer-pit').slice(0, 3).forEach((it, n) => { it.id = opts.inherited ? v('item.id') : v('item.id#' + n); });
  // 画面テストのために足す物(土台のプランに無い種類)
  const r0 = BASE.rooms.find((r) => r.floor === 1 && r.w > 2500 && r.d > 2500);
  p.items.push(
    { id: 'inj-walk', type: 'walk-route', x: 1000, y: 1000, w: 2000, d: 10, rot: 0, floor: 1, pathPoints: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], color: v('walk.color') },
    { id: 'inj-ceil', type: 'ceiling-area', x: r0.x + 300, y: r0.y + 300, w: 900, d: 900, rot: 0, floor: 1, offset: -150, cove: true, color: v('ceil.color'), coveColor: v('ceil.coveColor'), texture: v('ceil.texture') },
    { id: 'inj-spot', type: 'light-spot', x: 2000, y: 2000, w: 900, d: 60, rot: 0, floor: 1, elev: 2300, lightKind: 'spot', lightShape: 'line', lightColor: v('spot.lightColor'), lightAim: v('spot.lightAim') },
    { id: 'inj-fence', type: 'wood-fence', x: -800, y: 10500, w: 2000, d: 60, rot: 0, floor: 1, color: v('fence.color'), fencePattern: v('fence.fencePattern'), texture: v('fence.texture') },
  );
  // 家全体の設定
  const paint = (o, name) => { o.color = v(name + '.color'); o.texture = v(name + '.texture'); if ('sheen' in o || name.startsWith('roof')) o.sheen = v(name + '.sheen'); };
  paint(ex.whole, 'ext.whole');
  for (const f of Object.keys(ex.floors)) paint(ex.floors[f], 'ext.floor' + f);
  for (const k of Object.keys(ex.walls)) { ex.walls[k].color = v('ext.walls.color'); ex.walls[k].texture = v('ext.walls.texture'); }
  paint(ins.whole, 'int.whole'); ins.whole.skirtingColor = v('int.whole.skirtingColor');
  for (const f of Object.keys(ins.floors)) { paint(ins.floors[f], 'int.floor' + f); ins.floors[f].skirtingColor = v('int.floor' + f + '.skirtingColor'); }
  p.roofAppearance.whole.linked = false;
  paint(p.roofAppearance.whole, 'roof.whole');
  p.roofAppearance.floors = { 1: { linked: true }, 2: { linked: true }, 3: { linked: true } };
  for (const f of Object.keys(p.roofAppearance.floors)) paint(p.roofAppearance.floors[f], 'roof.floor' + f);
  p.exteriorDetail.gutterColor = v('exteriorDetail.gutterColor');
  p.planName = v('planName');
  return p;
}

module.exports = { PAYLOADS, BASE, clone, stringPayloads, tagged, sparse, inheritedValue, evilPlan };
