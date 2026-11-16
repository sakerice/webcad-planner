// 間取りを変える操作(部屋・壁・物の追加、移動、回転、削除、設定の変更)。画面にも Worker にも依存しない。
//
// 画面の placeItem(index.html)・delSel(index.html)・updateSelectedProp(app-state.js)と、
// AI のチャット・ChatGPT 連携が、同じこの部品を呼ぶ。
// 外の世界(連番、カタログ、吸着の設定、画面のグローバルに依存する後始末)は、すべて引数 ctx で受ける。
// ctx の形と各操作の引数は docs/superpowers/plans/2026-11-16-stage3-operations-inspect.md の Task 3。
//
// 座標: mm、+x 東、+y 南。物の x,y(保存形)は回転前の矩形の北西角で、回転は中心まわり。
// 操作の引数の x,y は中心で受け、ここで角に直す。
//
// applyProp は updateSelectedProp のキーごとの後始末を、順番と条件を変えずに移したもの。
// 項目を書く順番は保存 JSON の並びになるので、変えてはいけない。
// グローバルに依存して移せなかった後始末は、ctx.hooks に出している(画面が実物を渡す):
//   windowSill(obj)                     … windowTop を高さに直すときの腰高(windowSillMm。壁の高さに依存)
//   normalizeWindow(obj, key)           … 窓の腰高・高さの正規化(normalizeWindowVerticalProps)
//   ceilingElevation(room, plan)        … 天井高(roomCeilingElevationMm)
//   shiftCeilingFixtures(room, d, plan) … 天井付けの器具を動かす(shiftRoomCeilingFixtures)。動かした id を返す
//   prop.exteriorColor / prop.exteriorTexture(obj, value, plan) … 外壁の設定表(getExteriorWallSetting)
// windowSill・normalizeWindow は、省くと画面と同じ計算をここで行う(壁の高さは ctx.plan.wallHeightForFloor)。
// ceilingElevation・shiftCeilingFixtures を省くと、器具は動かさず warnings に書く。
//
// hooks の決まり: hooks は引数で受けた plan と物だけを読み書きする。
// グローバルの DATA を読み書きする hooks(画面の実物)は、inPlace(plan が DATA そのもの)のときだけ渡してよい。
// 写しに当てるときに渡すと、hooks は写しでなく DATA を見て、DATA を書き換えてしまう。
//
// 入口の守り(AI から呼ばれる写しの側):
//   ctx.allowProps … setProps の props(アプリの欄名をそのまま書く形)は、これが true のとき(画面の包み)だけ受ける。
//   ctx.maxFloor   … 受ける階の上限(省けば 4。画面で選べる階は 1〜4)。
//   写しに当てるとき(inPlace でないとき)は ctx.catalog.known が無いと物を置かない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./factories.js'), require('./snap.js'));
  } else {
    root.PlanCoreOperations = factory(root.PlanCoreFactories, root.PlanCoreSnap);
  }
}(typeof self !== 'undefined' ? self : this, function (Factories, Snap) {

  // ロック中でも変えられる項目(画面の updateSelectedProp と同じ。間取りの形を変えないもの)。
  var LOCK_ALLOWED = ['locked', 'hidden3D', 'vis3D'];

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isPositive(v) { return isNum(v) && v > 0; }
  function maxFloorOf(ctx) { return ctx && isNum(ctx.maxFloor) && ctx.maxFloor >= 1 ? Math.floor(ctx.maxFloor) : 4; }
  function floorError(v, ctx) {
    if (v === undefined) return null;
    var max = maxFloorOf(ctx);
    if (isNum(v) && v >= 1 && v <= max && Math.floor(v) === v) return null;
    return fail('floor は 1〜' + max + ' の整数で渡してください(' + label(v) + ' の階はありません)');
  }
  function isCopy(ctx) { return !(ctx && ctx.inPlace === true); }
  // 書き込めば済むが、桁を間違えたらしい値(写しに当てるときだけ warnings に書く)。
  var SMALL_MM = 50, LARGE_MM = 100000;
  function checkScale(ctx, rec, what, dims, coords) {
    if (!isCopy(ctx)) return;
    (dims || []).forEach(function (d) {
      if (!isNum(d[1])) return;
      if (Math.abs(d[1]) < SMALL_MM) rec.warnings.push(what + 'の ' + d[0] + '=' + d[1] + 'mm は ' + SMALL_MM + 'mm 未満です。単位(mm)を確かめてください');
      else if (Math.abs(d[1]) > LARGE_MM) rec.warnings.push(what + 'の ' + d[0] + '=' + d[1] + 'mm は ' + LARGE_MM + 'mm を超えています。単位(mm)を確かめてください');
    });
    (coords || []).forEach(function (c) {
      if (isNum(c[1]) && Math.abs(c[1]) > LARGE_MM) rec.warnings.push(what + 'の ' + c[0] + '=' + c[1] + 'mm は ' + LARGE_MM + 'mm を超えています。単位(mm)を確かめてください');
    });
  }
  function normRot(r) { return ((r % 360) + 360) % 360; }
  // 書き込ませない項目名。id を書き換えると物を指せなくなり、残りの3つはオブジェクトの仕組みを壊す。
  var FORBIDDEN_KEYS = ['id', '__proto__', 'constructor', 'prototype'];
  function forbiddenKey(keys) {
    for (var i = 0; i < keys.length; i++) if (FORBIDDEN_KEYS.indexOf(keys[i]) >= 0) return keys[i];
    return null;
  }
  function hooksOf(ctx) { return (ctx && ctx.hooks) || {}; }
  function isLocked(obj, ctx) {
    var h = hooksOf(ctx);
    return typeof h.isLocked === 'function' ? !!h.isLocked(obj) : !!(obj && obj.locked);
  }
  function catIs(ctx, kind, type) {
    var cat = ctx && ctx.catalog;
    return !!(cat && typeof cat.is === 'function' && cat.is(kind, type));
  }
  function defaultIsStairPart(type) {
    return type === 'stair' || type === 'stair-corner' || type === 'stair-landing';
  }
  function fail(message, candidates) {
    var e = { error: message };
    if (candidates) e.candidates = candidates;
    return e;
  }
  function label(id) { return JSON.stringify(id); }

  // 深い写し。素のオブジェクトと配列だけを写し、それ以外(画像・3D の物など)は同じ物を指す。
  // 同じ物を2か所から指していれば(窓の _wallRef など)、写しでも同じ1つを指す。
  function cloneDeep(v, seen) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    var out;
    if (Array.isArray(v)) {
      out = [];
      seen.set(v, out);
      for (var i = 0; i < v.length; i++) out.push(cloneDeep(v[i], seen));
      return out;
    }
    var proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;
    out = {};
    seen.set(v, out);
    Object.keys(v).forEach(function (k) { out[k] = cloneDeep(v[k], seen); });
    return out;
  }

  // id から物を探す。数と文字の違い(12 と "12")は同じとみなす。
  var COLLS = ['walls', 'rooms', 'items'];
  function findById(plan, id) {
    if (id === undefined || id === null || id === '') return { error: 'id がありません' };
    var hits = [];
    COLLS.forEach(function (coll) {
      (plan[coll] || []).forEach(function (o, i) {
        if (o && (o.id === id || String(o.id) === String(id))) hits.push({ obj: o, coll: coll, index: i });
      });
    });
    if (!hits.length) return { error: 'id ' + label(id) + ' の物はありません。プランの要約にある id をそのまま使ってください(消した物の id は使えません)' };
    if (hits.length > 1) return { error: 'id ' + label(id) + ' の物が ' + hits.length + ' つあり、どれか決められません' };
    return hits[0];
  }
  function lockedError(obj) {
    return fail('id ' + label(obj.id) + ' はロックされているので変えられません(locked・hidden3D・vis3D だけ変えられます)');
  }

  function Recorder() { this.changed = []; this.removed = []; this.warnings = []; }
  Recorder.prototype.change = function (id) {
    if (this.changed.indexOf(id) < 0) this.changed.push(id);
  };
  Recorder.prototype.remove = function (id) {
    this.change(id);
    if (this.removed.indexOf(id) < 0) this.removed.push(id);
  };

  // ── 窓の高さの計算(画面の windowSillMm / normalizeWindowVerticalProps と同じ。hooks が無いときに使う)──
  function wallHeightOf(wall, ctx) {
    var v = Number(wall && wall.wallHeight);
    if (isFinite(v)) return Math.max(300, Math.min(6000, v));
    return ctx && ctx.plan && typeof ctx.plan.wallHeightForFloor === 'function'
      ? ctx.plan.wallHeightForFloor(wall && wall.floor) : 2400;
  }
  function windowMaxTop(it, ctx) { return Math.max(200, wallHeightOf(it && it._wallRef, ctx) - 50); }
  function windowSillOf(it, ctx) {
    var h = hooksOf(ctx);
    if (typeof h.windowSill === 'function') return h.windowSill(it);
    var v = Number(it && it.windowSill);
    var def = it && it.type === 'window-door' ? 0 : 900;
    return isFinite(v) ? Math.max(0, Math.min(windowMaxTop(it, ctx) - 200, v)) : def;
  }
  function normalizeWindow(it, key, ctx) {
    var h = hooksOf(ctx);
    if (typeof h.normalizeWindow === 'function') { h.normalizeWindow(it, key); return; }
    if (!it || !catIs(ctx, 'windowLike', it.type)) return;
    var maxTop = windowMaxTop(it, ctx);
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

  // ── applyProp: updateSelectedProp のキーごとの後始末 ─────────────────────
  // ロックの判定・saveState・描画・色選びの途中の扱いは画面側(呼ぶ側)に残る。
  // 戻り値の changed は、変えた物の id(天井を変えて動いた器具を含む)。
  function applyProp(obj, key, value, plan, ctx, warnings) {
    ctx = ctx || {};
    var h = hooksOf(ctx);
    var changed = [obj.id];
    if (key === 'locked') {
      if (value) obj.locked = true;
      else delete obj.locked;
      return { changed: changed };
    }
    var isWindow = catIs(ctx, 'windowLike', obj.type);
    // 天井を書き換えると、その部屋の天井付けの器具も一緒に動く。
    var canMeasureCeiling = typeof h.ceilingElevation === 'function';
    var ceilBefore = (key === 'ceiling' && canMeasureCeiling) ? h.ceilingElevation(obj, plan) : null;
    if (key === 'color') obj.colorCustom = true;
    if (catIs(ctx, 'light', obj.type) && key === 'lightColor') {
      obj.color = value;
      obj.colorCustom = true;
    }
    if (key === 'texture') {
      if (obj._texObj) obj._texObj = null;
      if (!value) {
        obj.textureFlipX = false;
        obj.textureFlipY = false;
      }
    }
    if (isWindow && key === 'windowTop') {
      obj.windowHeight = Number(value) - windowSillOf(obj, ctx);
      normalizeWindow(obj, 'windowTop', ctx);
      delete obj.windowTop;
    } else {
      obj[key] = value;
      if (isWindow && (key === 'windowSill' || key === 'windowHeight')) normalizeWindow(obj, key, ctx);
    }
    // 天井を「指定なし」へ戻したときは受け口ごと消す。旧フィールド(ceilingHeight)も消す。
    if (key === 'ceiling') {
      if (!value) delete obj.ceiling;
      delete obj.ceilingHeight;
      if (ceilBefore !== null) {
        var ceilAfter = h.ceilingElevation(obj, plan);
        if (ceilAfter !== null && ceilAfter !== ceilBefore) {
          if (typeof h.shiftCeilingFixtures === 'function') {
            var moved = h.shiftCeilingFixtures(obj, ceilAfter - ceilBefore, plan);
            (Array.isArray(moved) ? moved : []).forEach(function (id) { if (changed.indexOf(id) < 0) changed.push(id); });
          } else if (warnings) {
            warnings.push('id ' + label(obj.id) + ' の天井高が ' + ceilBefore + 'mm から ' + ceilAfter
              + 'mm に変わりましたが、その部屋の天井付けの器具(照明・物干しなど)の高さは動かしていません');
          }
        }
      } else if (!canMeasureCeiling && warnings) {
        warnings.push('id ' + label(obj.id) + ' の天井を変えましたが、天井高を測れないため、'
          + 'その部屋の天井付けの器具(照明・物干しなど)の高さは確かめておらず、動かしていません');
      }
    }
    // 既定へ戻したら受け口ごと消す(undefined を残すと、保存 JSON とメモリの中身が食い違う)。
    if (key === 'setback' && !value) delete obj.setback;
    if ((key === 'stairTarget' || key === 'baseLevel' || key === 'vis3D' || key === 'footOffsetMm' || key === 'lightAim') && !value) delete obj[key];
    if (key === 'stairTarget' && value !== 'level') delete obj.stairTo;
    if (key === 'ceilingColor' && !value) delete obj.ceilingColor;
    if (key === 'floorColor' && !value) delete obj.floorColor;
    if (key === 'stairFloorMaterial' && !value) delete obj.stairFloorMaterial;
    if (key === 'ceilingTexture' && !value) {
      delete obj.ceilingTexture;
      delete obj.ceilingTextureFlipX;
      delete obj.ceilingTextureFlipY;
    }
    if (isWindow && (key === 'w' || key === 'windowHeight' || key === 'windowSill' || key === 'windowTop')) delete obj.windowStd;
    if ((key === 'exteriorColor' || key === 'exteriorTexture') && obj.x1 !== undefined) {
      var hook = h.prop && h.prop[key];
      if (typeof hook === 'function') hook(obj, value, plan);
    }
    return { changed: changed };
  }

  // ── 部屋 ─────────────────────────────────────────────────────────
  function addRoom(plan, a, ctx, rec) {
    if (!isNum(a.x) || !isNum(a.y)) return fail('x・y(部屋の中心)は数で渡してください');
    if (!isPositive(a.w) || !isPositive(a.d)) return fail('w・d(部屋の幅と奥行き)は 0 より大きい数で渡してください');
    var fe = floorError(a.floor, ctx);
    if (fe) return fe;
    if (a.name !== undefined && typeof a.name !== 'string') return fail('name は文字で渡してください');
    // 部屋の id が既にある部屋と重なったら(画面の 'rm_'+時刻は同じミリ秒に2回呼ぶと重なる)、連番で作り直す。
    var id = typeof ctx.roomId === 'function' ? ctx.roomId() : 'rm_' + ctx.newId();
    var rooms = plan.rooms || [];
    var taken = function (x) { return rooms.some(function (r) { return r && String(r.id) === String(x); }); };
    for (var tries = 0; taken(id); tries++) {
      if (tries >= 1000) return fail('部屋の id を重ならないように作れませんでした');
      id = 'rm_' + ctx.newId();
    }
    checkScale(ctx, rec, '部屋', [['w', a.w], ['d', a.d]], [['x', a.x], ['y', a.y]]);
    var args = { id: id, x: a.x - a.w / 2, y: a.y - a.d / 2, w: a.w, d: a.d, floor: a.floor || 1 };
    if (a.name !== undefined) args.n = a.name;
    var room = Factories.makeRoom(args, ctx);
    if (!plan.rooms) plan.rooms = [];
    plan.rooms.push(room);
    rec.change(room.id);
  }

  function findRoom(plan, id) {
    var f = findById(plan, id);
    if (f.error) return f;
    if (f.coll !== 'rooms') return { error: 'id ' + label(id) + ' は部屋ではありません' };
    return f;
  }

  function resizeRoom(plan, a, ctx, rec) {
    var f = findRoom(plan, a.id);
    if (f.error) return fail(f.error);
    var r = f.obj;
    if (isLocked(r, ctx)) return lockedError(r);
    var keys = ['x', 'y', 'w', 'd'];
    for (var i = 0; i < keys.length; i++) {
      if (a[keys[i]] !== undefined && !isNum(a[keys[i]])) return fail(keys[i] + ' は数で渡してください');
    }
    if ((a.w !== undefined && a.w <= 0) || (a.d !== undefined && a.d <= 0)) return fail('w・d は 0 より大きい数で渡してください');
    var cx = a.x !== undefined ? a.x : r.x + r.w / 2;
    var cy = a.y !== undefined ? a.y : r.y + r.d / 2;
    var w = a.w !== undefined ? a.w : r.w;
    var d = a.d !== undefined ? a.d : r.d;
    if (!isNum(cx) || !isNum(cy) || !isPositive(w) || !isPositive(d)) return fail('id ' + label(r.id) + ' の今の位置か大きさが数ではありません');
    checkScale(ctx, rec, '部屋', [['w', a.w], ['d', a.d]], [['x', a.x], ['y', a.y]]);
    r.x = cx - w / 2;
    r.y = cy - d / 2;
    r.w = w;
    r.d = d;
    rec.change(r.id);
  }

  function renameRoom(plan, a, ctx, rec) {
    var f = findRoom(plan, a.id);
    if (f.error) return fail(f.error);
    if (typeof a.name !== 'string') return fail('name は文字で渡してください');
    if (isLocked(f.obj, ctx)) return lockedError(f.obj);
    f.obj.n = a.name;
    rec.change(f.obj.id);
  }

  // ── 壁 ───────────────────────────────────────────────────────────
  function addWall(plan, a, ctx, rec) {
    if (!isNum(a.x1) || !isNum(a.y1) || !isNum(a.x2) || !isNum(a.y2)) return fail('x1・y1・x2・y2 は数で渡してください');
    if (a.x1 === a.x2 && a.y1 === a.y2) return fail('壁の始点と終点が同じです');
    var fe = floorError(a.floor, ctx);
    if (fe) return fe;
    if (a.thick !== undefined && !isPositive(a.thick)) return fail('thick は 0 より大きい数で渡してください');
    checkScale(ctx, rec, '壁', [['長さ', Math.hypot(a.x2 - a.x1, a.y2 - a.y1)]],
      [['x1', a.x1], ['y1', a.y1], ['x2', a.x2], ['y2', a.y2]]);
    var w = Factories.makeWall({ x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, floor: a.floor, thick: a.thick }, ctx);
    if (!plan.walls) plan.walls = [];
    plan.walls.push(w);
    rec.change(w.id);
  }

  function removeWall(plan, a, ctx, rec) {
    var f = findById(plan, a.id);
    if (f.error) return fail(f.error);
    if (f.coll !== 'walls') return fail('id ' + label(a.id) + ' は壁ではありません');
    if (isLocked(f.obj, ctx)) return lockedError(f.obj);
    plan.walls.splice(f.index, 1);
    rec.remove(f.obj.id);
    var h = hooksOf(ctx);
    if (typeof h.afterDelete === 'function') h.afterDelete(plan, [f.obj.id]);
  }

  // ── 吸着 ─────────────────────────────────────────────────────────
  function snapOf(ctx) { return (ctx && ctx.snap) || {}; }
  function edgeOpts(snap, floor, excludeId) {
    return {
      floor: floor, threshold: snap.edgeThreshold, excludeIds: [excludeId],
      isAnnotationType: snap.isAnnotationType, wallThickness: snap.wallThickness
    };
  }
  function stairOpts(snap) {
    return { radius: snap.stairRadius, minSpan: snap.stairMinSpan, partEdges: snap.stairPartEdges, isStairPart: snap.isStairPart };
  }
  function isStairPartOf(snap, type) {
    return typeof snap.isStairPart === 'function' ? !!snap.isStairPart(type) : defaultIsStairPart(type);
  }
  // 階段の吸着をしたいのに辺の求め方が無ければ、吸着せず warnings に書く(Snap.stairSnap は投げるため)。
  function canStairSnap(snap, rec) {
    if (!snap.stair) return false;
    if (typeof snap.stairPartEdges === 'function') return true;
    rec.warnings.push('ctx.snap.stairPartEdges が無いので、階段の吸着をしていません');
    return false;
  }

  // ── setProps の set(PlanSettable の語彙)────────────────────────────
  // PlanSettable の SETTINGS は部位(part)ごとで、object 部の for は読み取りの kind('fence' など)。
  // アプリの物から part と kind を引く:
  //   壁(plan.walls)→ wall、部屋(plan.rooms)→ room、
  //   OPENINGS の type → opening(kind は type そのまま)、stair・stair-corner → stair(kind は type)、
  //   EXTERIOR・SITE の type → object(kind はその type を持つ最初の kind。wood-fence→fence、fence→block-wall、site-rect→site)。
  // これ以外(カタログの家具・踊り場・照明など)は、読み取りの分類に引けないので set を受け付けない。
  function partKindOf(found, settable) {
    if (found.coll === 'walls') return { part: 'wall', kind: null };
    if (found.coll === 'rooms') return { part: 'room', kind: null };
    var type = found.obj.type;
    var opening = (settable.OPENINGS || []).some(function (o) { return o.type === type; });
    if (opening) return { part: 'opening', kind: type };
    if (type === 'stair' || type === 'stair-corner') return { part: 'stair', kind: type };
    var ext = (settable.EXTERIOR || []).concat(settable.SITE || []);
    for (var i = 0; i < ext.length; i++) if (ext[i].type === type) return { part: 'object', kind: ext[i].kind };
    return null;
  }
  // set の項目名 → アプリの項目名。ここに無いものは同じ名前。
  var SET_TO_APP = { object: { surface: 'siteSurface' } };
  // アプリの1項目に直せず、画面の計算が要る項目。hooks.set[key] があるときだけ受ける。
  var SET_NEEDS_HOOK = { room: { floorLevel: true } };

  function choicesOf(def) { return def.choices ? def.choices.map(function (c) { return c[0]; }) : undefined; }

  // set を確かめて、アプリの項目の並び [{key, value, viaHook}] にする。書き込みはしない。
  function resolveSet(set, target, ctx, warnings) {
    var settable = ctx.settable;
    if (!settable || typeof settable.applySettings !== 'function') return fail('set を使うには ctx.settable(PlanSettable)が要ります');
    if (!set || typeof set !== 'object' || Array.isArray(set)) return fail('set は {項目: 値} の形で渡してください');
    var pk = partKindOf(target, settable);
    var type = target.obj.type;
    if (!pk) return fail('種類 ' + label(type) + ' には、set で設定できる項目がありません(props を使うか、種類を確かめてください)');
    var defs = settable.settingsFor(pk.part, pk.kind);
    var allowed = defs.map(function (d) { return d.key; });
    if (!allowed.length) return fail('種類 ' + label(type) + ' には、set で設定できる項目がありません');
    var out = {};
    var keys = Object.keys(set);
    if (!keys.length) return fail('set が空です');
    var bad = forbiddenKey(keys);
    if (bad) return fail('set の「' + bad + '」は書き換えられません', allowed);
    var h = hooksOf(ctx);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i], value = set[key];
      var def = null;
      for (var j = 0; j < defs.length; j++) if (defs[j].key === key) def = defs[j];
      if (!def) return fail('set の「' + key + '」は、この物(' + pk.part + (pk.kind ? ' ' + pk.kind : '') + ')には設定できません', allowed);
      var needsHook = SET_NEEDS_HOOK[pk.part] && SET_NEEDS_HOOK[pk.part][key];
      if (needsHook && !(h.set && typeof h.set[key] === 'function')) {
        return fail('set の「' + key + '」は、この ctx では設定できません(画面の計算が要ります)');
      }
      var rejected = [];
      settable.applySettings(pk.part, pk.kind, [{ key: key, value: value }], out, { floor: target.obj.floor || 1, rejected: rejected });
      if (rejected.length) {
        return fail('set の「' + key + '=' + String(value) + '」は使えません' + (def.num ? '(数で渡してください)' : def.text ? '(文字で渡してください)' : '(選択肢から選んでください)'),
          def.choices ? choicesOf(def) : undefined);
      }
      if (def.num) {
        var n = parseFloat(String(value).replace(/[，,]/g, ''));
        var got = out[key];
        if (got !== undefined && got !== Math.round(n)) warnings.push('set の ' + key + '=' + String(value) + ' は範囲(' + def.num[0] + '〜' + def.num[1] + ')の外なので ' + got + ' にしました');
      }
    }
    var map = SET_TO_APP[pk.part] || {};
    var list = Object.keys(out).map(function (k) {
      var needs = SET_NEEDS_HOOK[pk.part] && SET_NEEDS_HOOK[pk.part][k];
      return { key: map[k] || k, setKey: k, value: out[k], viaHook: !!needs };
    });
    return { list: list };
  }

  function applySetList(obj, list, plan, ctx, rec) {
    var h = hooksOf(ctx);
    list.forEach(function (e) {
      if (e.viaHook) {
        var ids = h.set[e.setKey](obj, e.value, plan);
        rec.change(obj.id);
        (Array.isArray(ids) ? ids : []).forEach(function (id) { rec.change(id); });
        return;
      }
      applyProp(obj, e.key, e.value, plan, ctx, rec.warnings).changed.forEach(function (id) { rec.change(id); });
    });
  }

  // ── 物を置く ─────────────────────────────────────────────────────
  // 手順は画面の placeItem と同じ:
  //   開口のプリセット → 置けるか → 階と屋内の印 → makeItem → 屋内の印・プリセットの項目
  //   → 中心から角へ → 格子 → 物の端 → 階段 → afterPlace(高さ決め・柱の段差) → plan.items へ足す。
  function placeItem(plan, a, ctx, rec) {
    if (typeof a.type !== 'string' || !a.type) return fail('type(種類)を文字で渡してください');
    if (!isNum(a.x) || !isNum(a.y)) return fail('x・y(物の中心)は数で渡してください');
    if (a.rot !== undefined && !isNum(a.rot)) return fail('rot(度)は数で渡してください');
    var fe = floorError(a.floor, ctx);
    if (fe) return fe;
    if ((a.w !== undefined && !isPositive(a.w)) || (a.d !== undefined && !isPositive(a.d))) return fail('w・d は 0 より大きい数で渡してください');
    var h = hooksOf(ctx);
    var cat = ctx.catalog || {};
    // 写しに当てる(AI の)ときは、種類をカタログで確かめられない ctx では置かない。
    if (isCopy(ctx) && typeof cat.known !== 'function') return fail('この ctx では物を置けません(種類を確かめる ctx.catalog.known がありません)');
    var preset = typeof h.openingPreset === 'function' ? h.openingPreset(a.type) : null;
    var placeType = preset ? preset.type : a.type;
    if (typeof cat.known === 'function' && !cat.known(placeType)) {
      var cands = typeof cat.suggest === 'function' ? cat.suggest(a.type) : undefined;
      return fail('種類 ' + label(a.type) + ' はカタログにありません', cands);
    }
    var floor = a.floor || 1;
    if (typeof h.canPlace === 'function') {
      var why = h.canPlace(placeType, floor, a.x, a.y, plan);
      if (why) return fail(String(why));
    }
    var setList = null;
    if (a.set !== undefined) {
      var probe = { obj: { id: '(新しい物)', type: cat.resolveType ? cat.resolveType(placeType) : placeType, floor: floor }, coll: 'items' };
      var rs = resolveSet(a.set, probe, ctx, rec.warnings);
      if (rs.error) return rs;
      setList = rs.list;
    }
    var on = typeof h.placeFloor === 'function' ? (h.placeFloor(placeType, floor, a.x, a.y, plan) || {}) : {};
    var indoor = !!on.indoor;
    var sz = typeof cat.defaultSize === 'function' ? cat.defaultSize(placeType) : { w: 0, d: 0 };
    checkScale(ctx, rec, '種類 ' + label(a.type) + ' ', [['w', a.w], ['d', a.d]], [['x', a.x], ['y', a.y]]);
    // 角度を 0〜360 にそろえるのは写しのときだけ(画面の今の保存値を変えない)。
    var rot = (isCopy(ctx) && a.rot !== undefined) ? normRot(a.rot) : a.rot;
    var it = Factories.makeItem(placeType, {
      x: a.x - (a.w || sz.w) / 2, y: a.y - (a.d || sz.d) / 2, rot: rot,
      floor: on.floor !== undefined ? on.floor : floor, w: a.w, d: a.d
    }, ctx);
    if (indoor) it.indoor = true;
    if (preset) {
      if (preset.props) Object.keys(preset.props).forEach(function (k) { it[k] = preset.props[k]; });
      if (typeof preset.apply === 'function') preset.apply(it);
      var over = [];
      if (a.w !== undefined && it.w !== a.w) over.push('w=' + a.w + '→' + it.w);
      if (a.d !== undefined && it.d !== a.d) over.push('d=' + a.d + '→' + it.d);
      if (over.length) rec.warnings.push('種類 ' + label(a.type) + ' は寸法が決まっているので、渡された寸法を使っていません(' + over.join('、') + ')');
    }
    // 角は最終の寸法(プリセットで変わった寸法を含む)から出す。吸着もこの寸法の辺で見る。
    it.x = a.x - it.w / 2;
    it.y = a.y - it.d / 2;
    var snap = snapOf(ctx);
    var g = Snap.snapRectOriginToGrid(it.x, it.y, it.w, it.d, it.rot || 0, snap.grid || 0);
    it.x = g.x; it.y = g.y;
    if (snap.edges) {
      var e = Snap.edgeSnap({ x: it.x, y: it.y, w: it.w, d: it.d, rot: it.rot || 0 }, plan, edgeOpts(snap, it.floor, null));
      it.x = e.x; it.y = e.y;
    }
    if (isStairPartOf(snap, it.type) && canStairSnap(snap, rec)) {
      var s = Snap.stairSnap(it, it.x, it.y, plan, stairOpts(snap));
      it.x = s.x; it.y = s.y;
    }
    if (typeof h.afterPlace === 'function') h.afterPlace(it, plan);
    if (setList) applySetList(it, setList, plan, ctx, rec);
    if (!plan.items) plan.items = [];
    plan.items.push(it);
    rec.change(it.id);
  }

  // ── 動かす・回す ─────────────────────────────────────────────────
  function moveObject(plan, a, ctx, rec) {
    var f = findById(plan, a.id);
    if (f.error) return fail(f.error);
    var o = f.obj;
    var byCenter = a.x !== undefined || a.y !== undefined;
    var byDelta = a.dx !== undefined || a.dy !== undefined;
    if (byCenter && byDelta) return fail('x,y(中心)か dx,dy(動かす量)のどちらか一方を渡してください');
    if (f.coll === 'walls' && byCenter) return fail('壁は dx,dy(動かす量)で動かしてください');
    if (byCenter && (!isNum(a.x) || !isNum(a.y))) return fail('x・y(中心)は数で渡してください');
    if (byDelta && (!isNum(a.dx) || !isNum(a.dy))) return fail('dx・dy は数で渡してください');
    if (!byCenter && !byDelta) return fail('x,y(中心)か dx,dy(動かす量)を渡してください');
    if (isLocked(o, ctx)) return lockedError(o);
    if (byCenter) checkScale(ctx, rec, 'id ' + label(o.id) + ' ', [], [['x', a.x], ['y', a.y]]);
    var snap = snapOf(ctx);
    if (f.coll === 'walls') {
      var dx = a.dx, dy = a.dy;
      if (snap.grid) { dx = Math.round(dx / snap.grid) * snap.grid; dy = Math.round(dy / snap.grid) * snap.grid; }
      if (![o.x1, o.y1, o.x2, o.y2].every(isNum)) return fail('id ' + label(o.id) + ' の今の位置が数ではありません');
      o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy;
      rec.change(o.id);
      return;
    }
    var w = o.w || 0, d = o.d || 0;
    var nx = byCenter ? a.x - w / 2 : o.x + a.dx;
    var ny = byCenter ? a.y - d / 2 : o.y + a.dy;
    if (!isNum(nx) || !isNum(ny)) return fail('id ' + label(o.id) + ' の今の位置か大きさが数ではありません');
    // 吸着は画面のドラッグと同じ順(格子 → 物の端 → 階段)。
    var g = Snap.snapRectOriginToGrid(nx, ny, w, d, o.rot || 0, snap.grid || 0);
    nx = g.x; ny = g.y;
    if (snap.edges && o.type !== 'wall') {
      var e = Snap.edgeSnap({ x: nx, y: ny, w: w, d: d, rot: o.rot || 0 }, plan, edgeOpts(snap, o.floor, o.id));
      nx = e.x; ny = e.y;
    }
    if (isStairPartOf(snap, o.type) && canStairSnap(snap, rec)) {
      var s = Snap.stairSnap(o, nx, ny, plan, stairOpts(snap));
      nx = s.x; ny = s.y;
    }
    o.x = nx; o.y = ny;
    rec.change(o.id);
  }

  // x,y は回転前の矩形の北西角なので、rot を変えるだけで中心は動かない。
  // 写しに当てるときは角度を 0 以上 360 未満にそろえる(inPlace では画面と同じくそろえない)。
  function rotateObject(plan, a, ctx, rec) {
    var f = findById(plan, a.id);
    if (f.error) return fail(f.error);
    if (f.coll !== 'items') return fail('id ' + label(a.id) + ' は回せる物ではありません(壁と部屋は回せません)');
    var hasRot = a.rot !== undefined, hasBy = a.by !== undefined;
    if (hasRot === hasBy) return fail('rot(絶対の角度)か by(足す角度)のどちらか一方を渡してください');
    if (hasRot && !isNum(a.rot)) return fail('rot は数で渡してください');
    if (hasBy && !isNum(a.by)) return fail('by は数で渡してください');
    var o = f.obj;
    if (isLocked(o, ctx)) return lockedError(o);
    var r = hasRot ? a.rot : (Number(o.rot) || 0) + a.by;
    if (isCopy(ctx)) r = normRot(r);
    o.rot = r;
    rec.change(o.id);
  }

  // ── 消す ─────────────────────────────────────────────────────────
  function deleteObjects(plan, a, ctx, rec) {
    if (!Array.isArray(a.ids) || !a.ids.length) return fail('ids は id の配列で渡してください');
    var targets = [];
    for (var i = 0; i < a.ids.length; i++) {
      var f = findById(plan, a.ids[i]);
      if (f.error) return fail(f.error);
      if (isLocked(f.obj, ctx)) return lockedError(f.obj);
      if (targets.indexOf(f.obj) < 0) targets.push(f.obj);
    }
    var ids = targets.map(function (o) { return o.id; });
    COLLS.forEach(function (coll) {
      if (!plan[coll]) return;
      plan[coll] = plan[coll].filter(function (o) { return targets.indexOf(o) < 0; });
    });
    ids.forEach(function (id) { rec.remove(id); });
    var h = hooksOf(ctx);
    if (typeof h.afterDelete === 'function') h.afterDelete(plan, ids.slice());
  }

  // ── 設定を変える ─────────────────────────────────────────────────
  function setProps(plan, a, ctx, rec) {
    var f = findById(plan, a.id);
    if (f.error) return fail(f.error);
    var hasSet = a.set !== undefined, hasProps = a.props !== undefined;
    if (hasSet === hasProps) return fail('set か props のどちらか一方を渡してください');
    var o = f.obj;
    if (hasProps) {
      // props はアプリの欄名をそのまま書く画面用の形。検査が無いので、画面の包み(ctx.allowProps)だけに許す。
      if (ctx.allowProps !== true) return fail('props は使えません。set を使ってください');
      if (!a.props || typeof a.props !== 'object' || Array.isArray(a.props)) return fail('props は {項目: 値} の形で渡してください');
      var keys = Object.keys(a.props);
      if (!keys.length) return fail('props が空です');
      var bad = forbiddenKey(keys);
      if (bad) return fail('props の「' + bad + '」は書き換えられません');
      if (isLocked(o, ctx) && keys.some(function (k) { return LOCK_ALLOWED.indexOf(k) < 0; })) return lockedError(o);
      keys.forEach(function (k) {
        applyProp(o, k, a.props[k], plan, ctx, rec.warnings).changed.forEach(function (id) { rec.change(id); });
      });
      return;
    }
    if (isLocked(o, ctx)) return lockedError(o);
    var warnings = [];
    var rs = resolveSet(a.set, f, ctx, warnings);
    if (rs.error) return rs;
    warnings.forEach(function (w) { rec.warnings.push(w); });
    applySetList(o, rs.list, plan, ctx, rec);
  }

  var OPS = {
    addRoom: addRoom, resizeRoom: resizeRoom, renameRoom: renameRoom,
    addWall: addWall, removeWall: removeWall,
    placeItem: placeItem, moveObject: moveObject, rotateObject: rotateObject,
    deleteObjects: deleteObjects, setProps: setProps
  };

  function failure(plan, index, op, message, candidates) {
    var err = { index: index, op: op, message: message };
    if (candidates) err.candidates = candidates;
    return { plan: plan, changedIds: [], removedIds: [], warnings: [], errors: [err] };
  }

  // ops を順に当てる。全部当たれば {plan: 当てた後, ...}、1つでも失敗すれば渡された plan をそのまま返す。
  // ctx.inPlace のときは plan に直接当てる(1操作だけ。各操作は書き込む前に検査を終える)。
  function applyOperations(plan, ops, ctx) {
    var index = null, opName = null;
    try {
      if (!Array.isArray(ops)) return failure(plan, null, null, 'ops は操作の配列で渡してください');
      if (!plan || typeof plan !== 'object') return failure(plan, null, null, 'plan がありません');
      ctx = ctx || {};
      if (ctx.inPlace === true && ops.length !== 1) return failure(plan, null, null, 'inPlace のときは操作を1つだけ渡してください');
      var target = ctx.inPlace === true ? plan : cloneDeep(plan, new Map());
      var rec = new Recorder();
      for (var i = 0; i < ops.length; i++) {
        index = i;
        var op = ops[i];
        opName = op && typeof op.op === 'string' ? op.op : null;
        if (!op || typeof op !== 'object') return failure(plan, i, null, '操作は {op, args} の形で渡してください');
        if (!opName || !Object.prototype.hasOwnProperty.call(OPS, opName)) {
          return failure(plan, i, opName, '知らない操作です: ' + String(op.op), Object.keys(OPS));
        }
        var args = op.args === undefined ? {} : op.args;
        if (!args || typeof args !== 'object' || Array.isArray(args)) return failure(plan, i, opName, 'args は {…} の形で渡してください');
        var res = OPS[opName](target, args, ctx, rec);
        if (res && res.error) return failure(plan, i, opName, res.error, res.candidates);
      }
      return { plan: target, changedIds: rec.changed, removedIds: rec.removed, warnings: rec.warnings, errors: [] };
    } catch (e) {
      var msg = '操作の途中で誤りが起きました: ' + (e && e.message ? e.message : String(e));
      if (ctx && ctx.inPlace === true) msg += '(inPlace なので、プランが途中まで変わっているかもしれません)';
      return failure(plan, index, opName, msg);
    }
  }

  return { applyOperations: applyOperations, applyProp: applyProp, OPS: OPS };
}));
