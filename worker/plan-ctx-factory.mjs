// Worker(画面の無い所)で、間取りの操作部品 PlanCoreOperations.applyOperations を動かすための ctx を作る工場。
//
// なぜ在るのか
// ------------
// 画面のチャット(assets/js/plan-data.js の planChatCtx)は、画面の関数(グローバルの DATA を見る)を
// hooks に渡して、置いた物の高さ・屋内の印・外壁の設定表などを決めている。Worker には画面の関数が無いので、
// 同じ答えになる式をここに書く。**品質の線は「Worker で当てた結果が、画面のチャットで同じ操作を当てた結果と
// 同じであること」。** 画面と同じ答えを式で出せない置き方は、近い値で置かずに断る(理由を errors に返す)。
// 照らし合わせは画面テスト tools/tests/worker-ctx-parity.browser.mjs が、画面の上で両方を当てて行う。
//
// このファイルは何も import しない(依存は引数で受ける)。Worker 用の入口は worker/plan-ctx.mjs で、
// そこが部品と表(assets/data/worker-catalog.json・assets/models/tags.json)を import して渡す。
// 画面テストは、ページの中でこのファイルを import し、画面に読み込まれている同じ部品と、fetch した表を渡す。
//
// 画面のどの関数に合わせたかは、各関数の注釈と .superpowers/sdd/2026-11-18-stage5-mcp/task-2-report.md。
// 式は画面の関数を1行ずつ写したもので、条件・丸め・計算の順を変えていない(浮動小数の丸めまで同じにするため)。
// 画面の関数を直したら、ここも直す(照らし合わせのテストが落ちて気づける)。

// 断るときの文の頭。続けて(理由)を書く。
export const REFUSAL = 'この操作は house-planner の画面で行ってください';
// operations.js が、hooks の中で投げた例外を errors に変えるときに付ける頭。断る理由を afterPlace・
// ceilingElevation の中で投げたときだけ、これが付く(workerApply が外す)。
const OPS_EXCEPTION_PREFIX = '操作の途中で誤りが起きました: ';

const U = 0.001;                      // app-constants.js の U
const SKIP_CAVITY_MIN_MM = 400;       // app-constants.js の SKIP_CAVITY_MIN_MM
const EDGE_SNAP_THRESH = 80;          // app-state.js
const STAIR_SNAP_MM = 250;            // index.html
const STAIR_LINK_MIN_SPAN_MM = 100;   // index.html
const LIGHT_MIN_ELEV_MM = 1800;       // app-state.js defaultLightElevationMm の下限
const WALL_COLORS = { 1: '#5c3820', 2: '#e8e0cc', 3: '#e8e0cc', 4: '#e8e0cc' }; // app-constants.js
// 画面のチャットで、分類名として引かない名前(plan-data.js の CHAT_SKIP_KINDS)。
const CHAT_SKIP_KINDS = { fence: true, other: true };
const CHAT_KITCHEN_UNIT_MESSAGE = '調理台(kitchen-unit)は部品の台を並べて作るので、1つの物としては置けません。流し(kitchen-sink)・コンロ(cooktop)・引出しの台を並べて置いてください';
const OPENING_MODEL_PREFIXES = ['opening-door-model:', 'opening-window-model:'];

const WHY = {
  surface: '置く場所の下に台・棚・基礎などがあり、その上に載せる高さは画面でしか決められません',
  slopedCeiling: '勾配天井・吹き抜けの部屋の天井に付ける器具の高さは、画面でしか決められません',
  lightCeiling: 'この部屋の天井(段差・天井の範囲・天井高の指定・斜線制限など)では、照明の高さを画面でしか決められません',
  ceilingFixtures: 'この部屋には天井に付いた照明や物干しがあり、天井高を変えると器具の高さも動くので、画面で変えてください',
  openingModel: '建具・窓のモデルを指定して置くことは画面でしかできません。door-swing・window などの種類で置いてください',
};
function refusal(key) { return REFUSAL + '(' + WHY[key] + ')'; }
function RefusalError(key) { var e = new Error(refusal(key)); e.workerRefusal = true; return e; }

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const isPositiveNumber = (v) => typeof v === 'number' && isFinite(v) && v > 0;

// 画面の ensureObjectIds(app-state.js)と同じ数え方: 壁・物・部屋の id の末尾の数字の最大 + 1。
// (部屋の 'rm_1700000000000' の末尾も数える。画面の連番 nextId もこの数え方で決まる。)
export function firstNewId(plan) {
  var maxId = 0;
  function scanId(v) {
    if (v === undefined || v === null) return;
    var m = String(v).match(/(\d+)$/);
    if (m) maxId = Math.max(maxId, +m[1]);
  }
  ['walls', 'items', 'rooms'].forEach(function (k) { ((plan && plan[k]) || []).forEach(function (o) { if (o) scanId(o.id); }); });
  return maxId + 1;
}

// deps: {catalog, tags, Operations, Settable, Knowledge, FreeApply, HeightModel, Summary, Inspect, Schema, Check, Structure}
//   catalog … assets/data/worker-catalog.json の中身、tags … assets/models/tags.json の中身
//   ほかは UMD の部品(PlanCoreOperations・PlanSettable・ObjectKnowledge・PlanFreeApply・HeightModel・
//   ChatPlanSummary・PlanCoreInspect・PlanSchema・PlanCheck・PlanStructure)
// 表から引く物は、ここで1回だけ作る(Worker ではモジュールの読み込み時に1回)。
export function createPlanCtxTools(deps) {
  const { catalog, tags, Operations, Settable, Knowledge, FreeApply, HeightModel, Summary, Inspect } = deps;
  const TYPES = catalog.types, OTHERS = catalog.others || {}, LEGACY = catalog.legacy || {}, C = catalog.constants;
  const TYPE_ORDER = Object.keys(TYPES);
  const TAG_ITEMS = (tags && tags.items) || {};
  const KNOWLEDGE = (Knowledge && Knowledge.KNOWLEDGE) || {};
  const MOUNT = (FreeApply && FreeApply.MOUNT_ELEV_MM) || {};
  // 画面の ISIZES(寸法の表)。表の types のうちモデルでない物(task-1-report の注1)。
  const ISIZES = {};
  TYPE_ORDER.forEach(function (t) { if (!TYPES[t].m) ISIZES[t] = { w: TYPES[t].w, d: TYPES[t].d }; });
  const FLAGS = {};
  TYPE_ORDER.forEach(function (t) { var s = {}; (TYPES[t].f || []).forEach(function (k) { s[k] = true; }); FLAGS[t] = s; });
  Object.keys(OTHERS).forEach(function (t) { var s = {}; (OTHERS[t].f || []).forEach(function (k) { s[k] = true; }); FLAGS['\u0000' + t] = s; });
  function flag(t, k) { return has(TYPES, t) ? !!FLAGS[t][k] : false; }
  function entry(t) { return has(TYPES, t) ? TYPES[t] : null; }

  // ── 種類(画面の planCoreCtx の catalog と、planChatCtx の分類名の引き方)───────────
  function bestFmpType(t) { return has(LEGACY, t) ? LEGACY[t] : t; }               // bestFmpType
  function isFmpItemType(t) { return !!(t && has(TYPES, t) && TYPES[t].m); }          // isFmpItemType(標準のカタログ)
  function baseKnown(t) { return !!(t && has(TYPES, t)); }                            // ISIZES か FMP_ITEMS にある
  function itemColor(t) { if (has(TYPES, t)) return TYPES[t].c; if (has(OTHERS, t)) return OTHERS[t].c; return undefined; } // ICOLORS[t]
  function isLightType(t) { return flag(t, 'light'); }
  function isContextExteriorType(t) { return flag(t, 'contextExterior'); }
  function isGroundOnly(t) { return flag(t, 'groundOnly'); }                          // placeGroundOnly(index.html)
  function isGroundLevelType(t) { return flag(t, 'groundLevel'); }                    // isGroundLevelItemType
  function isCeilingFixtureType(t) { return flag(t, 'ceilingFixture'); }              // shiftRoomCeilingFixtures の条件
  function isColumnType(t) { return t === 'column' || t === 'column-round'; }
  function isStairPartType(t) { return t === 'stair' || t === 'stair-corner' || t === 'stair-landing'; }
  function isPlanAnnotationType(t) { return t === 'memo' || t === 'ruler' || t === 'walk-route'; }
  function isWindowLikeType(t) { return t === 'window' || t === 'window-door'; }
  // canSetItemElevation(index.html)。表に無い種類(追加のセットの品番など)は、画面の規則(開口・注記・
  // 敷地・基礎以外は真)と同じく真にする。開口の種類は全部表にある。
  function canSetItemElevation(it) {
    if (!it || !it.type) return false;
    var t = it.type;
    if (has(TYPES, t)) return flag(t, 'elev');
    if (has(OTHERS, t)) return !!FLAGS['\u0000' + t].elev;
    if (t === 'room' || t === 'wall' || isPlanAnnotationType(t) || t === 'site-rect' || t === 'foundation') return false;
    return true;
  }
  // isPlacementSurfaceItem(index.html)。表に無い種類は、台になるかを決められない(追加のセットの分類による)
  // ので、台とみなす(その上に置く物は断る側に倒れる)。
  function isPlacementSurfaceItem(it) {
    if (!it) return false;
    if (it.type === 'foundation') return true;
    if (!canSetItemElevation(it)) return false;
    if (has(TYPES, it.type)) return flag(it.type, 'surface');
    if (has(OTHERS, it.type)) return false;
    return true;
  }

  // planChatKindType(plan-data.js): 家具・設備の分類名(ObjectKnowledge の kind)を先に引く。
  function kindType(name) {
    if (typeof name !== 'string' || CHAT_SKIP_KINDS[name]) return null;
    if (!has(KNOWLEDGE, name)) return null;
    if (name === 'kitchen-unit') return { type: null, why: CHAT_KITCHEN_UNIT_MESSAGE };
    var box = FreeApply.KITCHEN_BOX && FreeApply.KITCHEN_BOX[name];
    if (box && name !== 'cooking-appliance') return { type: box.type };
    var t = FreeApply.typeForKind(name, 0, TAG_ITEMS);
    if (t) return { type: t };
    return { type: null, why: '分類 ' + name + ' に当たる物がカタログにありません。候補から選んでください' };
  }
  function resolve(type) { var k = kindType(type); return k ? (k.type ? bestFmpType(k.type) : type) : bestFmpType(type); }
  function known(type) { var k = kindType(type); return k ? !!(k.type && baseKnown(bestFmpType(k.type))) : baseKnown(bestFmpType(type)); }
  // planCoreSuggestTypes(plan-data.js)。並びは画面の Object.keys(ISIZES).concat(Object.keys(FMP_ITEMS))。
  function suggestTypes(type) {
    var q = String(type || '').toLowerCase();
    if (!q) return [];
    var scored = [];
    TYPE_ORDER.forEach(function (t) {
      var s = t.toLowerCase(), score = 0;
      if (s === q) score = 1000;
      else if (s.indexOf(q) >= 0 || q.indexOf(s) >= 0) score = 500 - Math.abs(s.length - q.length);
      else { var n = 0; while (n < s.length && n < q.length && s[n] === q[n]) n++; score = n >= 3 ? n : 0; }
      if (score > 0) scored.push({ t: t, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); });
    return scored.slice(0, 8).map(function (e) { return e.t; });
  }
  // getItemDefaultSize(app-constants.js)
  function defaultSizeOf(t) {
    t = bestFmpType(t);
    var e = entry(t);
    if (e && e.m) return { w: e.w || 900, d: e.d || 900, h: e.h || 600 };
    return e ? { w: e.w, d: e.d } : { w: 900, d: 900 };
  }

  // ── 高さ(app-constants.js・app-state.js の関数を、DATA の代わりに引数 p で)──────────
  function wallHGlobal(p) {                                      // WALL_H(開いたプランの heightDefaults から)
    var hd = p && p.heightDefaults;
    var v = Number(hd && hd.wallHeight);
    if (hd && isFinite(v) && v > 0) return Math.max(C.wallHeightMin, Math.min(C.wallHeightMax, Math.round(v)));
    return C.defaultWallHeight;
  }
  function perFloorHeightsEnabled(p) { var hd = p ? p.heightDefaults : null; return !!(hd && hd.perFloor); }
  function planFloorHeightEntry(p, floor) {
    var floors = p ? p.floors : null;
    if (!floors || typeof floors !== 'object') return null;
    var e = floors[String(floor)] !== undefined ? floors[String(floor)] : floors[floor];
    return (e && typeof e === 'object' && !Array.isArray(e)) ? e : null;
  }
  function defaultWallHeightMmForFloor(p, floor) {
    if (perFloorHeightsEnabled(p)) {
      var e = planFloorHeightEntry(p, floor);
      var v = Number(e && e.wallHeight);
      if (isFinite(v) && v > 0) return Math.max(300, Math.min(6000, Math.round(v)));
    }
    var g = Number(wallHGlobal(p));
    return (isFinite(g) && g > 0) ? g : 2400;
  }
  function defaultFloorRaiseMmForFloor(p, floor) {
    if (perFloorHeightsEnabled(p)) {
      var e = planFloorHeightEntry(p, floor);
      var v = Number(e && e.floorRaise);
      if (isFinite(v) && v >= 0) return Math.max(0, Math.min(600, Math.round(v)));
    }
    var hd = p ? p.heightDefaults : null;
    var g = Number(hd && hd.floorRaise);
    return (isFinite(g) && g >= 0) ? Math.max(0, Math.min(600, Math.round(g))) : 0;
  }
  function clampFloorRaiseMm(v) { var n = Number(v); if (!isFinite(n)) return 0; return Math.max(0, Math.min(600, Math.round(n))); }
  function newRoomFloorRaiseMm(p, floor) {
    var f = floor || 1;
    if (perFloorHeightsEnabled(p)) {
      var e = planFloorHeightEntry(p, f);
      if (e && isFinite(Number(e.floorRaise))) return clampFloorRaiseMm(e.floorRaise);
    } else {
      var hd = p ? p.heightDefaults : null;
      if (hd && hd.floorRaiseSet) return clampFloorRaiseMm(hd.floorRaise);
    }
    return f === 1 ? 150 : 0;
  }
  function foundationHeightMm(p) {
    if (!p || !p.items) return 0;
    var maxH = 0;
    p.items.forEach(function (it) {
      if (it && it.type === 'foundation') {
        var h = Number(it.foundationHeight);
        if (!isFinite(h)) h = 450;
        maxH = Math.max(maxH, Math.max(0, h));
      }
    });
    return Math.max(0, Math.min(2000, maxH));
  }
  function usesFinishedHeightModel(p) { return !!(p && p.heightDefaults && p.heightDefaults.modelVersion === 2); }
  function defaultFloorThicknessMm(p, floor) {
    var hd = p.heightDefaults || {}, e = perFloorHeightsEnabled(p) ? planFloorHeightEntry(p, floor) : null;
    var n = Number(e && e.floorThickness !== undefined ? e.floorThickness : hd.floorThickness);
    return Number.isFinite(n) ? Math.max(20, Math.min(1000, n)) : 180;
  }
  function floorSlabMmForFloor(p, floor) {
    if (usesFinishedHeightModel(p)) return defaultFloorThicknessMm(p, floor);
    return (floor || 1) <= 1 ? 0 : Math.max(0, C.floorSlabHeight || 0);
  }
  function floorSlabHeightMForFloor(p, floor) { return floorSlabMmForFloor(p, floor) * U; }
  function storyHeightMmForFloor(p, floor) {
    if (usesFinishedHeightModel(p)) return defaultWallHeightMmForFloor(p, floor) + defaultFloorThicknessMm(p, floor);
    var base = HeightModel.storyHeightMm(p, floor);
    var need = floorSlabMmForFloor(p, floor) + defaultWallHeightMmForFloor(p, floor);
    return Math.max(base, need);
  }
  function storyHeightM(p, floor) { return storyHeightMmForFloor(p, floor) * U; }
  function ceilingFinishThicknessM(p) { return usesFinishedHeightModel(p) ? 0 : C.ceilingFinishM; }
  function wallFullHeightM(p, floor) {
    return Math.max(defaultWallHeightMmForFloor(p, floor) * U + floorSlabHeightMForFloor(p, floor), storyHeightM(p, floor));
  }
  function roomFloorOffsetMm(p, room) {
    var n = Number(room && room.floorRaiseMm);
    if (Number.isFinite(n)) return Math.max(usesFinishedHeightModel(p) ? -Math.max(0, floorSlabMmForFloor(p, room.floor) - 20) : 0, Math.min(600, n));
    return defaultFloorRaiseMmForFloor(p, room && room.floor);
  }
  function roomSkipLevelMm(p, room) { if (!room) return 0; return HeightModel.skipLevelMm(p, room); }
  function roomSkipCavityMm(p, room) {
    if (!room) return 0;
    var t = roomSkipLevelMm(p, room) + roomFloorOffsetMm(p, room);
    return t >= SKIP_CAVITY_MIN_MM ? t : 0;
  }
  // roomsAtPointOnFloor / roomAtPointOnFloor(app-constants.js)
  function roomAtPointOnFloor(p, floor, x, y) {
    if (!p || !p.rooms) return null;
    var out = [];
    p.rooms.forEach(function (r, i) {
      if (!r || r.floor !== floor || r.hidden3D) return;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d) out.push({ r: r, i: i });
    });
    function stackOf(r) { var v = Number(r.stack); return isFinite(v) ? v : 0; }
    out.sort(function (a, b) {
      return (a.r.w * a.r.d - b.r.w * b.r.d) || (stackOf(b.r) - stackOf(a.r)) || (b.i - a.i);
    });
    return out.length ? out[0].r : null;
  }
  // 天井の形を式で出せない部屋か(出せないときは理由の鍵、出せるときは null)。
  // 照明を置いたときの高さ(defaultLightElevationMm → ceilingFinishElevationMm → roomCeilingElevationMm)を
  // 式で出せるのは、天井の範囲・勾配・吹き抜け・段差・斜線制限の屋根が無く、天井高の指定が階高に収まる部屋だけ。
  function setbackActive(p) {
    return (p.items || []).some(function (it) { return it && it.type === 'site-rect' && it.setback && typeof it.setback === 'object'; });
  }
  function lightCeilingProblem(p, room) {
    if (!isFinite(room.x)) return 'lightCeiling';
    var c = room.ceiling;
    if (c && (c.type === 'sloped' || c.type === 'void')) return 'slopedCeiling';
    if (roomSkipLevelMm(p, room) > 0) return 'lightCeiling';
    if (setbackActive(p)) return 'lightCeiling';
    if (room.ceilingAreas && (!Array.isArray(room.ceilingAreas) || room.ceilingAreas.length)) return 'lightCeiling';
    var fl = room.floor || 1;
    if ((p.items || []).some(function (it) { return it && it.type === 'ceiling-area' && (it.floor || 1) === fl; })) return 'lightCeiling';
    var h = explicitCeilingM(p, room);
    if (h !== null && h > storyHeightM(p, room.floor || 1)) return 'lightCeiling';
    return null;
  }
  // roomExplicitCeilingMm と roomCeilingHeightM の、平らな天井で段差の無い部屋の枝(lightCeilingProblem が null のとき)。
  function explicitCeilingM(p, room) {
    var c = room.ceiling;
    if (!isPositiveNumber(c && c.heightMm) && !isPositiveNumber(room.ceilingHeight)) return null;
    var mm = HeightModel.ceilingHeightMm(p, room);
    return mm * U + (floorSlabHeightMForFloor(p, room.floor) + roomSkipLevelMm(p, room) * U);
  }
  function roomCeilingHeightM(p, room) {
    var storyM = storyHeightM(p, (room && room.floor) || 1);
    var h = explicitCeilingM(p, room);
    return h === null ? storyM : h;
  }
  function roomCeilingElevationMm(p, room) {
    var fl = room.floor || 1;
    return Math.round((roomCeilingHeightM(p, room) - floorSlabHeightMForFloor(p, fl) - ceilingFinishThicknessM(p)) / U)
      - (roomFloorOffsetMm(p, room) + roomSkipLevelMm(p, room));
  }
  // defaultLightElevationMm(floor, cx, cy)。部屋の天井を式で出せないときは断る(呼ぶ前に lightCeilingProblem で見る)。
  function defaultLightElevationMm(p, floor, cx, cy) {
    var fl = floor || 1;
    var r = (isFinite(cx) && isFinite(cy)) ? roomAtPointOnFloor(p, fl, cx, cy) : null;
    if (r) return Math.max(LIGHT_MIN_ELEV_MM, roomCeilingElevationMm(p, r) + 0);
    return Math.max(LIGHT_MIN_ELEV_MM, Math.round((wallFullHeightM(p, fl) - floorSlabHeightMForFloor(p, fl) - ceilingFinishThicknessM(p)) / U));
  }

  // ── 置く物の高さ: 台の上に載るか(findDefaultPlacementSurface)───────────────────
  // isInsideItem(index.html)。台になる物は開口でも注記でも開き戸でもないので、余白 0 の回転した矩形。
  function insideItem(s, px, py) {
    var cx = s.x + s.w / 2, cy = s.y + s.d / 2;
    var rad = -(s.rot || 0) * Math.PI / 180;
    var dx = px - cx, dy = py - cy;
    var lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    var ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    return lx >= -(s.w / 2) && lx <= s.w / 2 && ly >= -(s.d / 2) && ly <= s.d / 2;
  }
  // 置く物(種類 t、階 floor、中心 cx,cy、屋内の印 indoor)が、画面では台の上に載せられうるか。
  // 基礎は、床に載る物なら、床の天端が基礎の天端より下になることが無い(基礎の高さ elev が 0 以下のとき)ので、
  // 載らない。床に載る物は item3DBaseY(app-constants.js)で地面を基準にしない物: 地面に置く種類でない物、
  // 屋内の印の付いたモデル(itemPlacedOnFloorExplicitly)、部屋の中か2階以上に置いた、階を見る地面の種類
  // (isFloorAwareGroundItemType。車・木・塀など)。それ以外の台は全部断る。
  function surfaceProblem(p, t, floor, cx, cy, indoor) {
    if (!canSetItemElevation({ type: t }) || isLightType(t)) return null;
    var placedOnFloor = !!(indoor && isFmpItemType(t) && !isContextExteriorType(t));  // itemPlacedOnFloorExplicitly
    var floorAwareOnFloor = flag(t, 'floorAwareGround') && (floor > 1 || !!roomAtPointOnFloor(p, floor, cx, cy));
    var groundBased = (isGroundLevelType(t) || isContextExteriorType(t)) && !placedOnFloor && !floorAwareOnFloor;
    var hit = (p.items || []).some(function (s) {
      if (!s || (s.floor || 1) !== floor || !isPlacementSurfaceItem(s)) return false;
      if (!insideItem(s, cx, cy)) return false;
      if (s.type === 'foundation') return groundBased || (Number(s.elev) || 0) > 0;
      return true;
    });
    return hit ? 'surface' : null;
  }
  // 読み取りと同じ取付の高さ(PlanFreeApply.MOUNT_ELEV_MM。分類は tags.json の kind)。表に無ければ undefined。
  function mountElevOf(t) {
    var tag = has(TAG_ITEMS, t) ? TAG_ITEMS[t] : null;
    return tag && has(MOUNT, tag.kind) ? MOUNT[tag.kind] : undefined;
  }
  // 置いたあとの高さ・位置で、画面と同じに決められない物か(断る理由の鍵、無ければ null)。
  function placeProblem(p, t, floor, cx, cy, indoor) {
    if (isCeilingFixtureType(t)) {
      var r = roomAtPointOnFloor(p, floor, cx, cy);
      if (r && r.ceiling && (r.ceiling.type === 'sloped' || r.ceiling.type === 'void')) return 'slopedCeiling';
    }
    if (isLightType(t)) {
      var lr = roomAtPointOnFloor(p, floor, cx, cy);
      if (lr) { var why = lightCeilingProblem(p, lr); if (why) return why; }
      return null;
    }
    // 取付の高さの表にある分類(レンジフードなど)は台に載せず表の高さにする(planChatCtx の afterPlace)ので、台を見ない。
    if (mountElevOf(t) !== undefined) return null;
    return surfaceProblem(p, t, floor, cx, cy, indoor);
  }
  // placeIndoorAt(index.html): 地面に置く印(gl)のモデルを、部屋の中に置くか。
  function placeIndoorAt(p, t, floor, x, y) { return !!(has(TYPES, t) && TYPES[t].gl && roomAtPointOnFloor(p, floor, x, y)); }

  // ── 外壁の設定表(index.html の ensureExteriorWallSettings・getExteriorWallSetting・syncExteriorWallSettings)──
  function normalizeTextureOrientationTarget(obj) {
    if (!obj) return obj;
    if (obj.textureFlipX === undefined) obj.textureFlipX = false;
    if (obj.textureFlipY === undefined) obj.textureFlipY = false;
    return obj;
  }
  function defaultExteriorFloorSetting(floor) {
    return { linked: true, color: WALL_COLORS[floor] || '#e8e0cc', texture: null, textureFlipX: false, textureFlipY: false };
  }
  function ensureExteriorWallSettings(p) {
    if (!p.exteriorWallSettings) {
      p.exteriorWallSettings = {
        whole: { linked: false, color: '#e8e0cc', texture: null, textureFlipX: false, textureFlipY: false },
        floors: {}, walls: {}, faces: {}
      };
    }
    var s = p.exteriorWallSettings;
    if (!s.whole) s.whole = { linked: false, color: '#e8e0cc', texture: null, textureFlipX: false, textureFlipY: false };
    normalizeTextureOrientationTarget(s.whole);
    if (!s.floors) s.floors = {};
    if (!s.walls) s.walls = {};
    if (!s.faces) s.faces = {};
    for (var f = 1; f <= 4; f++) {
      if (!s.floors[f]) {
        s.floors[f] = defaultExteriorFloorSetting(f);
      } else {
        if (s.floors[f].linked === undefined) s.floors[f].linked = true;
        if (!s.floors[f].color) s.floors[f].color = WALL_COLORS[f] || '#e8e0cc';
        if (s.floors[f].texture === undefined) s.floors[f].texture = null;
        normalizeTextureOrientationTarget(s.floors[f]);
      }
    }
    return s;
  }
  function wallSettingKey(w) {
    return String(w.id || [w.floor, Math.round(w.x1), Math.round(w.y1), Math.round(w.x2), Math.round(w.y2)].join('_'));
  }
  function getExteriorWallSetting(p, w) {
    var s = ensureExteriorWallSettings(p);
    var key = wallSettingKey(w);
    if (!s.walls[key]) s.walls[key] = { color: null, texture: null, textureFlipX: false, textureFlipY: false };
    normalizeTextureOrientationTarget(s.walls[key]);
    if (w.exteriorColor && !s.walls[key].color) s.walls[key].color = w.exteriorColor;
    if (w.exteriorTexture && !s.walls[key].texture) s.walls[key].texture = w.exteriorTexture;
    if (w.exteriorTextureFlipX) s.walls[key].textureFlipX = true;
    if (w.exteriorTextureFlipY) s.walls[key].textureFlipY = true;
    return s.walls[key];
  }
  // 面ごとの外壁設定(faces)の片付けは、画面では今の壁の外面を幾何で求め直して残す物を決める
  // (getWallExteriorSpans。壁の網目の外側判定まで要る)。Worker は、消えた壁の面の行だけを片付け、
  // 残っている壁の面の行は残す。画面で開くと、読み込みの片付け(syncExteriorWallSettings)が残りを片付ける。
  var FACE_SUFFIX = /^-?1_-?\d+_-?\d+$/;
  function syncExteriorWallSettings(p) {
    var s = ensureExteriorWallSettings(p);
    var alive = {};
    (p.walls || []).forEach(function (w) { alive[wallSettingKey(w)] = true; });
    Object.keys(s.walls).forEach(function (key) { if (!alive[key]) delete s.walls[key]; });
    Object.keys(s.faces).forEach(function (key) {
      var keep = Object.keys(alive).some(function (k) { return key.indexOf(k + '_') === 0 && FACE_SUFFIX.test(key.slice(k.length + 1)); });
      if (!keep) delete s.faces[key];
    });
  }

  // ── 窓の高さ(index.html の windowSillMm・normalizeWindowVerticalProps)。窓の _wallRef は画面でも
  //    付けられていない(どこからも代入されない)ので、壁の高さは階を渡さない既定の高さ。
  function wallHeightMm(p, w) {
    var v = Number(w && w.wallHeight);
    return isFinite(v) ? Math.max(300, Math.min(6000, v)) : defaultWallHeightMmForFloor(p, w && w.floor);
  }
  function windowMaxTopMm(p, it) { return Math.max(200, wallHeightMm(p, it && it._wallRef) - 50); }
  function windowSillMm(p, it) {
    var v = Number(it && it.windowSill);
    var def = it && it.type === 'window-door' ? 0 : 900;
    return isFinite(v) ? Math.max(0, Math.min(windowMaxTopMm(p, it) - 200, v)) : def;
  }
  function normalizeWindowVerticalProps(p, it) {
    if (!it || !isWindowLikeType(it.type)) return;
    var maxTop = windowMaxTopMm(p, it);
    var sill = Number(it.windowSill);
    var height = Number(it.windowHeight);
    if (!isFinite(sill)) sill = it.type === 'window-door' ? 0 : 900;
    if (!isFinite(height)) height = it.type === 'window-door' ? 2100 : 1200;
    sill = Math.max(0, Math.min(maxTop - 200, sill));
    height = Math.max(200, Math.min(maxTop, height));
    if (sill + height > maxTop) height = Math.max(200, maxTop - sill);
    it.windowSill = Math.round(sill);
    it.windowHeight = Math.round(height);
    if (it.windowTop !== undefined) delete it.windowTop;
  }

  // ── 階段の辺(index.html の stairPartEdgesRaw)──────────────────────────────
  function stairPartEdgesMm(it) {
    var r = (Number(it.rot) || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    var w = Number(it.w) || 0, d = Number(it.d) || 0;
    var cx = (Number(it.x) || 0) + w / 2, cy = (Number(it.y) || 0) + d / 2;
    var fx = it.flipX ? -1 : 1, fy = it.flipY ? -1 : 1;
    function P(lx, ly) { lx *= fx; ly *= fy; return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }
    function V(lx, ly) { lx *= fx; ly *= fy; return { x: lx * cos - ly * sin, y: lx * sin + ly * cos }; }
    var landing = it.type === 'stair-landing', corner = it.type === 'stair-corner';
    function role(k) {
      if (landing) return 'any';
      if (corner) return k === '+d' ? 'down' : (k === '+w' ? 'up' : 'side');
      return k === '+d' ? 'up' : (k === '-d' ? 'down' : 'side');
    }
    return [
      { k: '+d', a: P(-w / 2, d / 2), b: P(w / 2, d / 2), n: V(0, 1) },
      { k: '-d', a: P(w / 2, -d / 2), b: P(-w / 2, -d / 2), n: V(0, -1) },
      { k: '+w', a: P(w / 2, d / 2), b: P(w / 2, -d / 2), n: V(1, 0) },
      { k: '-w', a: P(-w / 2, -d / 2), b: P(-w / 2, d / 2), n: V(-1, 0) }
    ].map(function (e) {
      e.role = role(e.k); e.part = it; e.len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      e.depth = (e.k === '+d' || e.k === '-d') ? d : w;
      return e;
    });
  }

  // ── 周辺の建物の高さ(app-state.js の defaultContextExteriorHeight など)─────────────
  function contextStoryHeightMm(p) { return Math.round(Math.max(C.floorHeight || 2700, wallHGlobal(p) || 2400, 2700)); }
  function defaultContextFloors(t) { if (t === 'neighbor-building') return 4; if (t === 'neighbor-house') return 2; return 1; }
  function defaultContextExteriorHeight(p, t) {
    if (t === 'neighbor-building' || t === 'neighbor-house') {
      var cx = entry(t) && entry(t).cx;
      var max = t === 'neighbor-building' ? 12 : 3;
      var floors = Math.max(1, Math.min(max, Math.round(Number(defaultContextFloors(t)) || defaultContextFloors(t))));
      return Math.round(floors * contextStoryHeightMm(p) + (cx ? cx.roof || 0 : 0));
    }
    if (t === 'utility-pole') return 6500;
    if (t === 'road') return 70;
    return 400;
  }

  // ── ctx ────────────────────────────────────────────────────────────────
  // plan: これから操作を当てるプラン(連番の始まりをここから数える)。
  // 写しに当てる(inPlace でない)ctx。applyOperations(plan, ops, ctx) は plan を変えず、結果の plan(写し)を返す。
  // 画面のチャット(planChatCtx)も写しに当てるので、種類の確かめ(候補つき)、角度の 0〜360 へのそろえ、
  // 桁違いの値の警告が、同じに働く。
  // opts.firstId(省略可): 連番の数え始め。plan から数えた値(firstNewId)より小さければ plan の値を使う
  // (ルームが持つ「減らない連番」を渡して、消した物の id を使い回さないため)。省けば今までどおり firstNewId(plan)。
  // ctx.peekNextId() は、まだ使っていない次の連番(部屋の 'rm_'+連番 も同じ連番から取る)。
  function workerOpsCtx(plan, opts) {
    var next = firstNewId(plan);
    var given = opts && Number(opts.firstId);
    if (given && isFinite(given) && given > next) next = Math.floor(given);
    var cur = plan;   // 操作を当てている写し(withPlan で差し替える)
    var ctx = {
      newId: function () { return next++; },
      peekNextId: function () { return next; },
      catalog: {
        resolveType: resolve,
        known: known,
        unknownMessage: function (type) {
          var k = kindType(type);
          if (k && !k.type) return k.why;
          if (typeof type === 'string' && OPENING_MODEL_PREFIXES.some(function (pre) { return type.indexOf(pre) === 0; })) return refusal('openingModel');
          return null;
        },
        suggest: function (type) {
          var q = String(type || '').toLowerCase(), out = [];
          var add = function (t) { if (t && out.indexOf(t) < 0 && known(t)) out.push(t); };
          if (type === 'kitchen-unit') {
            add('kitchen-sink'); add('cooktop');
            [450, 600, 750, 900].forEach(function (w) { add('original-kitchen-box-drawer' + w); });
            return out.slice(0, 8);
          }
          if (q) Object.keys(KNOWLEDGE).forEach(function (k) { if (!CHAT_SKIP_KINDS[k] && (k.indexOf(q) >= 0 || q.indexOf(k) >= 0)) add(k); });
          suggestTypes(type).forEach(add);
          return out.slice(0, 8);
        },
        defaultSize: function (type) { return defaultSizeOf(resolve(type)); },
        defaultColor: function (type) { return itemColor(resolve(type)); },
        model: function (type) { var t = resolve(type); return isFmpItemType(t) ? { defaultElevation: TYPES[t].de } : null; },
        is: function (kind, type) {
          var t = resolve(type);
          switch (kind) {
            case 'light': case 'contextExterior': case 'windowLike': case 'doorLikeOpening': case 'doorPanel': return flag(t, kind);
          }
          return false;
        },
        canSetElevation: canSetItemElevation,
        // ensureLightDefaults(app-state.js)を、物を作る部品が作った直後の物に当てた形。elev は画面では天井の
        // 取付面を測って入れるが、直後に物を作る部品が 0 に戻す(照明は高さを設定できる種類)。並びだけ同じにする。
        applyLightDefaults: function (it) {
          if (!it || !isLightType(it.type)) return it;
          var lt = TYPES[it.type].lt || {};
          if (!it.lightKind) it.lightKind = lt.lightKind;
          if (!it.lightShape) it.lightShape = 'point';
          if (!it.lightColor) it.lightColor = it.color && /^#/.test(String(it.color)) ? it.color : '#fff6dd';
          if (!isFinite(Number(it.lightIntensity))) it.lightIntensity = lt.lightIntensity;
          if (!isFinite(Number(it.lightRange))) it.lightRange = lt.lightRange;
          if (!isFinite(Number(it.lightAngle))) it.lightAngle = lt.lightAngle;
          if (it.lightCastShadow === undefined) it.lightCastShadow = true;
          if (!isFinite(Number(it.elev))) it.elev = 0;
          it.color = it.lightColor;
          return it;
        },
        contextExteriorHeight: function (type) { return defaultContextExteriorHeight(cur, resolve(type)); },
        contextFloors: function (type) { return defaultContextFloors(resolve(type)); },
        constants: { rulerThickness: C.rulerThickness, walkRouteThickness: C.walkRouteThickness, walkDefaultSpeed: C.walkDefaultSpeed }
      },
      plan: {
        wallHeightForFloor: function (floor) { return defaultWallHeightMmForFloor(cur, floor); },
        floorRaiseForFloor: function (floor) { return newRoomFloorRaiseMm(cur, floor); },
        foundationHeight: function () { return foundationHeightMm(cur); }
      },
      settable: Settable,
      snap: {
        grid: 0, edges: false, edgeThreshold: EDGE_SNAP_THRESH,
        stair: true, stairRadius: STAIR_SNAP_MM, stairMinSpan: STAIR_LINK_MIN_SPAN_MM,
        stairPartEdges: stairPartEdgesMm, isStairPart: isStairPartType,
        isAnnotationType: isPlanAnnotationType,
        wallThickness: function (w) { var t = Number(w && w.thick); return isFinite(t) && t > 0 ? t : 120; }
      },
      hooks: {
        isLocked: function (o) { return !!(o && o.locked); },
        canPlace: function (type, floor, cx, cy, p) {
          var t = resolve(type);
          var work = p || cur;
          var indoor = placeIndoorAt(work, t, floor, cx, cy);
          if (isGroundOnly(t) && floor !== 1 && !indoor) return '地面に置く種類なので、1階にしか置けません';
          var fl = isGroundOnly(t) && !indoor ? 1 : floor;
          var why = placeProblem(work, t, fl, cx, cy, indoor);
          return why ? refusal(why) : null;
        },
        placeFloor: function (type, floor, cx, cy, p) {
          var t = resolve(type);
          var indoor = placeIndoorAt(p || cur, t, floor, cx, cy);
          return { floor: isGroundOnly(t) && !indoor ? 1 : floor, indoor: indoor };
        },
        // placeAfterSnap(index.html)と、planChatCtx の取付の高さ。
        afterPlace: function (it, p) {
          var work = p || cur;
          var cx = it.x + it.w / 2, cy = it.y + it.d / 2;
          // 階段の部材は吸着で中心が動くので、動いたあとの位置で断る理由を見直す。
          var why = placeProblem(work, it.type, it.floor || 1, cx, cy, !!it.indoor);
          if (why) throw RefusalError(why);
          // placeAfterSnap(index.html)→ applyDefaultPlacementElevation: 照明は天井から
          // (defaultLightElevationMm)。ほかは台の上(findDefaultPlacementSurface。台の上は断っているので、ここでは変えない)。
          if (isLightType(it.type)) it.elev = defaultLightElevationMm(work, it.floor, cx, cy);
          // placeAfterSnap の柱の段差(roomSkipCavityMm)。
          if (isColumnType(it.type)) {
            var cavity = roomSkipCavityMm(work, roomAtPointOnFloor(work, it.floor, cx, cy));
            if (cavity > 0) { it.baseLevel = 'under'; it.columnHeight = cavity; }
          }
          // planChatCtx の afterPlace: 取付の高さの表にある分類は、台があっても表の高さ。
          var mount = mountElevOf(it.type);
          if (mount !== undefined) it.elev = mount;
        },
        windowSill: function (it) { return windowSillMm(cur, it); },
        normalizeWindow: function (it) { normalizeWindowVerticalProps(cur, it); },
        // 天井高を変える前に呼ばれる。天井に付いた器具がある部屋は断る(器具を天井に合わせて動かす高さを
        // 画面と同じに出せないため)。器具が無ければ動かす物が無いので、天井高を測らずに null を返す。
        ceilingElevation: function (room, p) {
          var work = p || cur;
          var hit = (work.items || []).some(function (it) {
            if (!it || !isCeilingFixtureType(it.type)) return false;
            return roomAtPointOnFloor(work, it.floor, it.x + it.w / 2, it.y + it.d / 2) === room;
          });
          if (hit) throw RefusalError('ceilingFixtures');
          return null;
        },
        shiftCeilingFixtures: function () { return []; },
        prop: {
          exteriorColor: function (w, v, p) { getExteriorWallSetting(p || cur, w).color = v || null; },
          exteriorTexture: function (w, v, p) { getExteriorWallSetting(p || cur, w).texture = v || null; }
        },
        afterDelete: function (p) { syncExteriorWallSettings(p || cur); }
      },
      withPlan: function (work, run) {
        var saved = cur;
        cur = work;
        try { return run(); } finally { cur = saved; }
      }
    };
    return ctx;
  }

  // 断る理由を hooks の中で投げたときに operations.js が付ける頭を外す。
  function tidy(res) {
    (res.errors || []).forEach(function (e) {
      if (typeof e.message === 'string' && e.message.indexOf(OPS_EXCEPTION_PREFIX + REFUSAL) === 0) e.message = e.message.slice(OPS_EXCEPTION_PREFIX.length);
    });
    return res;
  }
  // ルームの中で使う入口: plan(変えない)に ops を当て、{plan(当てた後の写し), changedIds, removedIds, warnings, errors, nextId}。
  // opts.firstId は workerOpsCtx と同じ。nextId は当てたあとの、まだ使っていない次の連番(失敗のときも返すが、使わない)。
  function workerApply(plan, ops, opts) {
    var ctx = workerOpsCtx(plan, opts);
    var res = tidy(Operations.applyOperations(plan, ops, ctx));
    res.nextId = ctx.peekNextId();
    return res;
  }

  // 要約(画面のチャットと同じ部品と同じ呼び名・分類。選択中の物は無い)。依頼文に付ける囲みまで付ける。
  function labelOf(t) {
    if (has(TYPES, t) && TYPES[t].n) return TYPES[t].n;
    if (has(OTHERS, t) && OTHERS[t].n) return OTHERS[t].n;
    return t || '要素';
  }
  function kindOf(t) { return has(TAG_ITEMS, t) && TAG_ITEMS[t] ? TAG_ITEMS[t].kind : null; }
  function workerSummarize(plan) {
    return '<plan_summary>\n' + Summary.summarize(plan, { labelOf: labelOf, kindOf: kindOf }) + '\n</plan_summary>';
  }
  // 検査(画面のチャットの inspect_plan と同じ。既定の寸法は画面の ISIZES)。
  function workerInspect(plan) {
    return Inspect.inspectPlan(plan, { defaults: ISIZES, schema: deps.Schema, check: deps.Check, structure: deps.Structure });
  }

  return { workerOpsCtx, workerApply, workerSummarize, workerInspect, firstNewId, REFUSAL };
}
