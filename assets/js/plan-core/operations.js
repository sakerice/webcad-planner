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
//   ctx.maxFloor   … 受ける階の上限。省けば 4(AI に渡す範囲。画面の階の選び方の 1〜4 と同じ)。
//                    画面の包み(planOpsCtx)は、保存プランが持てる上限(PlanSchema.LIMITS.MAX_FLOOR=5)を渡す。
//                    画面では選択した壁へ飛ぶ・ウォークスルーの階移動で今の階が 5 になりうるので、
//                    「AI の範囲」と「画面が許す範囲」は別にしている。
//   写しに当てるとき(inPlace でないとき)は ctx.catalog.known が無いと物を置かない。
//   種類を known で確かめるのも写しのときだけ(画面は、カタログに無い種類名でも今までどおり置く)。
//   known が偽のとき、ctx.catalog.unknownMessage(type) が文を返せば、errors の文はそれにする(候補は suggest)。
//
// ctx.targets(inPlace のときだけ): 物そのものの配列。渡されたら、id で探す代わりにその物を使う。
//   画面の delSel・updateSelectedProp は選んだ物そのものを指して操作する。id が重なっている・id が無い
//   古いプランでも今と同じに消せる・変えられるように、包みは選んだ物を targets で渡す。
//   deleteObjects は targets の物すべて(ids は見ない)。setProps・moveObject・rotateObject・resizeRoom・
//   renameRoom・removeWall は targets の1つめだけ(2つ以上は errors)。inPlace でないのに渡すと errors。
//
// ctx.withPlan(workPlan, run)(写しに当てるときだけ使う): あれば、写しを作ったあとの処理全体を
//   ctx.withPlan(写し, run) の中で動かし、run の戻り値を返す。画面の hooks はグローバルの DATA を見るので、
//   画面の AI 用の ctx(plan-data.js の planChatCtx)が、その間だけ DATA を写しに差し替え、finally で戻す。
//   inPlace では呼ばない。
// ctx.rethrow(inPlace のときだけ効く): 操作の途中で出た例外を errors に変えず、そのまま投げ直す。
//   画面の包みが立てる(変更前の画面と同じく、例外がエラーの見張りに出るように)。
//   写しに当てるとき(AI)は立っていても投げず、今までどおり errors にして外へ出さない。
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
    // 鍵が __proto__(プランの値の壁の id など)のとき、代入すると写しの継承元を差し替えてしまう。自分の欄として作る。
    Object.keys(v).forEach(function (k) {
      if (k === '__proto__') Object.defineProperty(out, k, { value: cloneDeep(v[k], seen), writable: true, enumerable: true, configurable: true });
      else out[k] = cloneDeep(v[k], seen);
    });
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
  // 操作の対象を探す。ctx.targets があればその1つめ(物そのもの)、無ければ id で探す。
  // targets の物がプランの walls・rooms・items に無ければ coll は null(画面の選択がプランの外の物のとき)。
  function findTarget(plan, a, ctx) {
    var targets = ctx && ctx.targets;
    if (!targets) return findById(plan, a.id);
    if (targets.length !== 1) return { error: 'この操作では ctx.targets を1つだけ渡してください' };
    var obj = targets[0];
    for (var c = 0; c < COLLS.length; c++) {
      var list = plan[COLLS[c]] || [];
      var i = list.indexOf(obj);
      if (i >= 0) return { obj: obj, coll: COLLS[c], index: i };
    }
    return { obj: obj, coll: null, index: -1 };
  }
  function notInPlan(f) { return f.coll === null ? 'ctx.targets の物がプランの中にありません' : null; }
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
  // 階段の手すり(stairRail)・形(stairStyle)を書いたあとの保存の形を整える。obj[key] に値を書いたあとに呼ぶ。
  // 設定パネル・AI の set(applyProp)と、図面の読み取りの取り込み(plan-import.js の toAppObjects)が、
  // 同じこの関数を通る。経路ごとに保存の形が違うと、描画は同じでも比べる検査・共同編集の差分・inspect の
  // 答えが食い違うため(読み取りだけ stairRail:'none'・stairStyle:'open' を残していた)。
  //
  // 手すり「なし」・形「ひな壇」は既定なので、欄ごと消す(設定パネルは undefined を、AI の set と読み取りは
  // 'none'・'open' を渡す。描画の stairRailSides・stairStyleOf は、欄が無ければ手すり無し・ひな壇)。
  // 形を書いたら、古い欄 stairUnder('filled' なら箱型として読む)は消す。残すと「ひな壇」を選んで stairStyle を
  // 消したとき、stairStyleOf が stairUnder を読んで箱型に戻り、ひな壇にできない。箱型・スケルトンは stairStyle が
  // 先に読まれるので、消しても描画は変わらない。
  function tidyStairProp(obj, key) {
    if (!obj) return;
    var value = obj[key];
    if (key === 'stairRail' && (!value || value === 'none')) delete obj.stairRail;
    if (key === 'stairStyle') {
      if (!value || value === 'open') delete obj.stairStyle;
      delete obj.stairUnder;
    }
  }

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
    if (key === 'stairRail' || key === 'stairStyle') tidyStairProp(obj, key);
    // 古いプラン(既定プランを含む)は床材のキーを texture に書いていて、描画(index.html の roomFloorMaterialKey)は
    // texture を floorMaterial より先に読む。画面の床材の欄(app-state.js の updateSelectedRoomFloorMaterial)と同じく、
    // texture が床材のキーなら消す(残すと、床材を書いても画面の床は元のまま)。床の画像(それ以外の texture)は
    // 消さない。画像が床材より優先されて床材は画面に出ないので、そのことを警告で返す(AI が「変えた」と答えないように)。
    if (key === 'floorMaterial' && obj.texture) {
      var floorKeys = ctx.settable && Array.isArray(ctx.settable.FLOOR_MATERIALS)
        ? ctx.settable.FLOOR_MATERIALS.map(function (c) { return c[0]; }) : [];
      if (floorKeys.indexOf(obj.texture) >= 0) delete obj.texture;
      else if (value && warnings) {
        warnings.push('id ' + label(obj.id) + ' の床材を ' + value + ' にしましたが、この部屋には床の画像(' + obj.texture
          + ')が設定されていて、画像が床材より優先されるため、画面の床は変わりません。床の画像は、利用者が設定パネルの「床テクスチャ解除」で外せます');
      }
    }
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
    var name = a.name !== undefined ? tidyName(a.name) : undefined;
    if (name !== undefined && nameError(name)) return fail(nameError(name));
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
    if (name !== undefined) args.n = name;
    var room = Factories.makeRoom(args, ctx);
    if (!plan.rooms) plan.rooms = [];
    plan.rooms.push(room);
    rec.change(room.id);
  }

  function findRoom(plan, a, ctx) {
    var f = findTarget(plan, a, ctx);
    if (f.error) return f;
    if (f.coll !== 'rooms') return { error: 'id ' + label(f.coll === null ? a.id : f.obj.id) + ' は部屋ではありません' };
    return f;
  }

  function resizeRoom(plan, a, ctx, rec) {
    var f = findRoom(plan, a, ctx);
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
    var f = findRoom(plan, a, ctx);
    if (f.error) return fail(f.error);
    if (typeof a.name !== 'string') return fail('name は文字で渡してください');
    var name = tidyName(a.name);
    if (nameError(name)) return fail(nameError(name));
    if (isLocked(f.obj, ctx)) return lockedError(f.obj);
    f.obj.n = name;
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
    var f = findTarget(plan, a, ctx);
    if (f.error) return fail(f.error);
    if (f.coll !== 'walls') return fail(notInPlan(f) || 'id ' + label(a.id) + ' は壁ではありません');
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
  //   色を変えられる部位(finishChannels)を持つカタログのモデル → furniture(編集だけの項目。部位は ctx.catalog.finishChannels(type))。
  // これ以外(部位の無い家具・踊り場・照明など)は、set を受け付けない。
  function partKindOf(found, settable, ctx) {
    if (found.coll === 'walls') return { part: 'wall', kind: null };
    if (found.coll === 'rooms') return { part: 'room', kind: null };
    var type = found.obj.type;
    var opening = (settable.OPENINGS || []).some(function (o) { return o.type === type; });
    if (opening) return { part: 'opening', kind: type };
    if (type === 'stair' || type === 'stair-corner') return { part: 'stair', kind: type };
    var ext = (settable.EXTERIOR || []).concat(settable.SITE || []);
    for (var i = 0; i < ext.length; i++) if (ext[i].type === type) return { part: 'object', kind: ext[i].kind };
    var cat = ctx && ctx.catalog;
    var channels = cat && typeof cat.finishChannels === 'function' ? cat.finishChannels(type) : null;
    if (Array.isArray(channels) && channels.length && settable.SETTINGS && settable.SETTINGS.furniture) return { part: 'furniture', kind: null, channels: channels };
    return null;
  }
  // set の項目名 → アプリの項目名。ここに無いものは同じ名前。
  var SET_TO_APP = { object: { surface: 'siteSurface' } };
  // アプリの1項目に直せず、画面の計算が要る項目。hooks.set[key] があるときだけ受ける。
  var SET_NEEDS_HOOK = { room: { floorLevel: true } };

  // 選択肢の値の並び。setProps は編集なので、編集だけの選択肢(editChoices。土間をやめる normal など)も含める。
  function choicesOf(def) {
    if (!def.choices) return undefined;
    return def.choices.concat(def.editChoices || []).map(function (c) { return c[0]; });
  }

  // set を確かめて、アプリの項目の並び [{key, value, viaHook}] にする。書き込みはしない。
  function resolveSet(set, target, ctx, warnings) {
    var settable = ctx.settable;
    if (!settable || typeof settable.applySettings !== 'function') return fail('set を使うには ctx.settable(PlanSettable)が要ります');
    if (!set || typeof set !== 'object' || Array.isArray(set)) return fail('set は {項目: 値} の形で渡してください');
    var pk = partKindOf(target, settable, ctx);
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
      // edit: 編集の印。PlanSettable は、これがあるときだけ編集だけの選択肢(editChoices)と編集だけの項目(editOnly。色・仕上げ)を
      // 受ける(読み取りは受けない)。channels・current は部位ごとの項目(家具の色・素材・艶)の部位の並びと、重ねる元の今の物。
      // 同じ set の中で同じ欄を2度書くことは無い(項目名が欄の名前なので)。
      var actx = { floor: target.obj.floor || 1, rejected: rejected, edit: true, channels: pk.channels || [], current: target.obj };
      settable.applySettings(pk.part, pk.kind, [{ key: key, value: value }], out, actx);
      if (rejected.length) {
        var shown = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (actx.why) return fail('set の「' + key + '=' + shown + '」は使えません(' + actx.why + ')', actx.candidates && actx.candidates.length ? actx.candidates : undefined);
        return fail('set の「' + key + '=' + shown + '」は使えません' + (def.num ? '(数で渡してください)' : def.text ? '(文字で渡してください)' : '(選択肢から選んでください)'),
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
    // 種類を確かめるのは写しに当てる(AI の)ときだけ。画面(inPlace)は今までどおり、カタログに無い種類名も置く。
    if (isCopy(ctx) && typeof cat.known === 'function' && !cat.known(placeType)) {
      var cands = typeof cat.suggest === 'function' ? cat.suggest(a.type) : undefined;
      // 置けない理由をカタログが言えるとき(読み込み中・組んで作る種類など)は、その文を使う。
      var unknownWhy = typeof cat.unknownMessage === 'function' ? cat.unknownMessage(a.type) : null;
      return fail(unknownWhy ? String(unknownWhy) : '種類 ' + label(a.type) + ' はカタログにありません', cands);
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
    var f = findTarget(plan, a, ctx);
    if (f.error) return fail(f.error);
    if (notInPlan(f)) return fail(notInPlan(f));
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
    var f = findTarget(plan, a, ctx);
    if (f.error) return fail(f.error);
    if (notInPlan(f)) return fail(notInPlan(f));
    if (f.coll !== 'items') return fail('id ' + label(f.obj.id) + ' は回せる物ではありません(壁と部屋は回せません)');
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
    // 全選択の削除では物の数も消す数も多いので、重ねがけの indexOf でなく Set で引く。
    var targets = [], targetSet = new Set();
    var add = function (o) { if (!targetSet.has(o)) { targetSet.add(o); targets.push(o); } };
    if (ctx.targets) {
      // 画面: 選んだ物そのものを消す(id が重なっていても、指した物だけが消える)。
      for (var t = 0; t < ctx.targets.length; t++) {
        var o = ctx.targets[t];
        if (isLocked(o, ctx)) return lockedError(o);
        add(o);
      }
    } else {
      if (!Array.isArray(a.ids) || !a.ids.length) return fail('ids は id の配列で渡してください');
      for (var i = 0; i < a.ids.length; i++) {
        var f = findById(plan, a.ids[i]);
        if (f.error) return fail(f.error);
        if (isLocked(f.obj, ctx)) return lockedError(f.obj);
        add(f.obj);
      }
    }
    // 消したと記録するのは、プランの中にあった物だけ(順は targets の順)。
    var present = new Set();
    COLLS.forEach(function (coll) { (plan[coll] || []).forEach(function (o) { present.add(o); }); });
    var ids = targets.filter(function (o) { return present.has(o); }).map(function (o) { return o.id; });
    COLLS.forEach(function (coll) {
      if (!plan[coll]) return;
      plan[coll] = plan[coll].filter(function (o) { return !targetSet.has(o); });
    });
    ids.forEach(function (id) { rec.remove(id); });
    var h = hooksOf(ctx);
    if (typeof h.afterDelete === 'function') h.afterDelete(plan, ids.slice());
  }

  // ── 設定を変える ─────────────────────────────────────────────────
  function setProps(plan, a, ctx, rec) {
    var f = findTarget(plan, a, ctx);
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
    if (notInPlan(f)) return fail(notInPlan(f));
    if (isLocked(o, ctx)) return lockedError(o);
    var warnings = [];
    var rs = resolveSet(a.set, f, ctx, warnings);
    if (rs.error) return rs;
    warnings.forEach(function (w) { rec.warnings.push(w); });
    applySetList(o, rs.list, plan, ctx, rec);
  }

  // ── 名前を書き込むときの掃除 ───────────────────────────────────────
  // 部屋の名前は AI(チャット・外の AI)が書く。共有相手の画面にも、AI に渡る要約にも出る。
  // 書き込む時点で、見えない文字(書式文字 \p{Cf}・片割れのサロゲート)を落とし、制御文字と行の区切りを空白にして、
  // 空白をまとめる(assets/js/chat/plan-summary.js の stripInvisible と同じ決まり。tools/tests/ai-input-guard.test.cjs が揃っていることを見る)。
  // 長さは掃除した後の文字(コードポイント)で数え、ROOM_NAME_MAX 字を超えたら切らずに失敗にする(AI が直して呼び直せるように)。
  // 既に保存されている長い名前は、ほかの操作では触らない(開ける・直せる)。
  var ROOM_NAME_MAX = 40;
  var INVISIBLE_RE = new RegExp('[\\p{Cf}\\p{Cs}]', 'gu');
  var CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
  // 絵文字のつなぎ(ZWJ、U+200D)は、絵文字と絵文字の間にあるときだけ残す(plan-summary.js の stripInvisible と同じ)。
  var ZWJ = String.fromCharCode(0x200d);
  var ZWJ_PREV_RE = new RegExp('\\p{Extended_Pictographic}[\\u{1F3FB}-\\u{1F3FF}\\uFE0F]*$', 'u');
  var ZWJ_NEXT_RE = new RegExp('^\\p{Extended_Pictographic}', 'u');
  function dropInvisible(ch, at, all) {
    if (ch === ZWJ && ZWJ_PREV_RE.test(all.slice(Math.max(0, at - 8), at)) && ZWJ_NEXT_RE.test(all.slice(at + 1, at + 3))) return ch;
    return '';
  }
  function tidyName(s) {
    return String(s).replace(INVISIBLE_RE, dropInvisible).replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  }
  function nameError(name) {
    var len = Array.from(name).length;
    return len > ROOM_NAME_MAX ? 'name は ' + ROOM_NAME_MAX + ' 字までにしてください（' + len + ' 字が来ました）' : null;
  }

  // ── 白紙から家を作るための操作(部屋を壁で囲む・開口・屋根)──────────────────
  // AI が白紙から家を作るとき、壁を1本ずつ・扉の座標を自分で計算して置くと、手数が多く、二重の壁や壁から外れた扉ができる。
  // そこで部屋を単位にした操作を足す。どれも中で今の部品(makeWall・placeItem)を呼ぶので、できる物は画面で人が作る物と同じ。
  //
  // 線の重なり: 同じ向き(平行)で、線どうしの距離が LINE_TOL 以内の壁・辺を「同じ線の上」とみなす。
  // 部屋の辺は軸に沿うので、扉と窓は軸に沿う辺だけを扱う。壁で囲む操作は多角形(斜めの辺)も受ける。
  var LINE_TOL = 30;
  var MIN_PIECE = 50;    // これより短い壁の切れ端は作らない(mm)
  var SIDES = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  // 画面の屋根の設定欄の形(index.html の roofTypeOptions と同じ。plan-core-build-ops の検査が突き合わせる)。
  var ROOF_TYPES = ['gable', 'gable-y', 'hip', 'hip-ridge', 'hip-ridge-long', 'flat', 'mono'];
  var ROOF_OVERHANG = 450;   // 軒の出の既定(壁の芯から。既定の2階建てのプランと同じ)
  // 吊り元と開く向きを持つ種類(plan-settable.js の SWING_TYPES と同じ)。折戸は開く側の印が逆(plan-free-apply.js と同じ)。
  var SWING_TYPES = ['door-swing', 'door-swing-s', 'door-front', 'door-fold', 'door-fold-w'];

  // 線分 p→q に沿った、壁(同じ階・同じ線の上)が覆う区間の並び [[t0,t1], …](t は p からの長さ mm)。
  function coveredOnSegment(walls, floor, p, q) {
    var L = Math.hypot(q.x - p.x, q.y - p.y);
    if (L < 1) return [];
    var ux = (q.x - p.x) / L, uy = (q.y - p.y) / L;
    var out = [];
    (walls || []).forEach(function (w) {
      if (!w || (w.floor || 1) !== floor) return;
      var wl = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (wl < 1) return;
      var cross = ((w.x2 - w.x1) * uy - (w.y2 - w.y1) * ux) / wl;
      if (Math.abs(cross) > 0.01) return;
      var off = Math.abs((w.x1 - p.x) * uy - (w.y1 - p.y) * ux);
      if (off > LINE_TOL) return;
      var t1 = (w.x1 - p.x) * ux + (w.y1 - p.y) * uy, t2 = (w.x2 - p.x) * ux + (w.y2 - p.y) * uy;
      var a = Math.max(0, Math.min(t1, t2)), b = Math.min(L, Math.max(t1, t2));
      if (b - a > 1) out.push([a, b]);
    });
    return out;
  }
  // [0,L] から区間を引いた残り。
  function subtractIntervals(L, cut) {
    var parts = [[0, L]];
    cut.forEach(function (c) {
      var next = [];
      parts.forEach(function (pp) {
        if (c[1] <= pp[0] || c[0] >= pp[1]) { next.push(pp); return; }
        if (c[0] > pp[0]) next.push([pp[0], c[0]]);
        if (c[1] < pp[1]) next.push([c[1], pp[1]]);
      });
      parts = next;
    });
    return parts;
  }
  // 部屋の4辺(軸に沿う)。axis 'h' は東西に走る辺(位置 c は y、範囲 a〜b は x)、'v' は南北に走る辺。
  function roomEdges(r) {
    return [
      { side: 'N', axis: 'h', c: r.y, a: r.x, b: r.x + r.w },
      { side: 'S', axis: 'h', c: r.y + r.d, a: r.x, b: r.x + r.w },
      { side: 'W', axis: 'v', c: r.x, a: r.y, b: r.y + r.d },
      { side: 'E', axis: 'v', c: r.x + r.w, a: r.y, b: r.y + r.d }
    ];
  }
  function edgeEnds(e, a, b) {
    return e.axis === 'h' ? [{ x: a, y: e.c }, { x: b, y: e.c }] : [{ x: e.c, y: a }, { x: e.c, y: b }];
  }
  // 辺 e のうち、同じ階のほかの部屋の辺と重なる区間 [a, b, 相手の部屋](絶対の位置)。
  function sharedWithRooms(plan, room, e) {
    var out = [];
    (plan.rooms || []).forEach(function (o) {
      if (!o || o === room || (o.floor || 1) !== (room.floor || 1)) return;
      roomEdges(o).forEach(function (f) {
        if (f.axis !== e.axis || Math.abs(f.c - e.c) > LINE_TOL) return;
        var a = Math.max(e.a, f.a), b = Math.min(e.b, f.b);
        if (b - a > 1) out.push([a, b, o]);
      });
    });
    return out;
  }
  function roomById(plan, id) {
    var f = findById(plan, id);
    if (f.error) return f;
    if (f.coll !== 'rooms') return { error: 'id ' + label(id) + ' は部屋ではありません' };
    return f;
  }

  // 部屋(ids)か多角形(points と floor)の外周に壁を作る。既にある壁(この呼び出しで作った壁を含む)と
  // 同じ線の上で重なる区間は作らない。部屋の辺のうち、同じ階のほかの部屋と接する区間は間仕切り(thick)、
  // それ以外は外周(outerThick。省くと thick)。多角形の辺はすべて外周の厚さ。
  function addRoomWalls(plan, a, ctx, rec) {
    var hasIds = a.ids !== undefined, hasPts = a.points !== undefined;
    if (hasIds === hasPts) return fail('ids(部屋の id の配列)か points(多角形の頂点 {x,y} の配列)のどちらか一方を渡してください');
    if (a.thick !== undefined && !isPositive(a.thick)) return fail('thick は 0 より大きい数で渡してください');
    if (a.outerThick !== undefined && !isPositive(a.outerThick)) return fail('outerThick は 0 より大きい数で渡してください');
    var inner = a.thick, outer = a.outerThick !== undefined ? a.outerThick : a.thick;
    var segs = [];   // {p, q, floor, thick}
    if (hasIds) {
      if (!Array.isArray(a.ids) || !a.ids.length) return fail('ids は部屋の id の配列で渡してください');
      for (var i = 0; i < a.ids.length; i++) {
        var f = roomById(plan, a.ids[i]);
        if (f.error) return fail(f.error);
        var r = f.obj;
        if (!isNum(r.x) || !isNum(r.y) || !isPositive(r.w) || !isPositive(r.d)) return fail('部屋 ' + label(r.id) + ' の位置か大きさが数ではありません');
        roomEdges(r).forEach(function (e) {
          // 辺を、ほかの部屋と接する区間と、外に面する区間に切り分ける。
          var shared = sharedWithRooms(plan, r, e);
          var cuts = [e.a, e.b];
          shared.forEach(function (s) { cuts.push(s[0], s[1]); });
          cuts.sort(function (x, y) { return x - y; });
          for (var k = 0; k + 1 < cuts.length; k++) {
            var s0 = cuts[k], s1 = cuts[k + 1];
            if (s1 - s0 < 1) continue;
            var mid = (s0 + s1) / 2;
            var isShared = shared.some(function (s) { return mid > s[0] && mid < s[1]; });
            var ends = edgeEnds(e, s0, s1);
            segs.push({ p: ends[0], q: ends[1], floor: r.floor || 1, thick: isShared ? inner : outer });
          }
        });
      }
    } else {
      var fe = floorError(a.floor, ctx);
      if (fe) return fe;
      var pts = a.points;
      if (!Array.isArray(pts) || pts.length < 3) return fail('points は 3 つ以上の頂点 {x, y} の配列で渡してください');
      for (var j = 0; j < pts.length; j++) {
        if (!pts[j] || !isNum(pts[j].x) || !isNum(pts[j].y)) return fail('points[' + j + '] は {x, y}(数)で渡してください');
      }
      for (var m = 0; m < pts.length; m++) {
        var p = pts[m], q = pts[(m + 1) % pts.length];
        if (Math.hypot(q.x - p.x, q.y - p.y) >= 1) segs.push({ p: { x: p.x, y: p.y }, q: { x: q.x, y: q.y }, floor: a.floor || 1, thick: outer });
      }
    }
    if (!plan.walls) plan.walls = [];
    var made = 0;
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    segs.forEach(function (sg) {
      var L = Math.hypot(sg.q.x - sg.p.x, sg.q.y - sg.p.y);
      var ux = (sg.q.x - sg.p.x) / L, uy = (sg.q.y - sg.p.y) / L;
      subtractIntervals(L, coveredOnSegment(plan.walls, sg.floor, sg.p, sg.q)).forEach(function (pc) {
        if (pc[1] - pc[0] < MIN_PIECE) return;
        var w = Factories.makeWall({
          x1: r1(sg.p.x + ux * pc[0]), y1: r1(sg.p.y + uy * pc[0]), x2: r1(sg.p.x + ux * pc[1]), y2: r1(sg.p.y + uy * pc[1]),
          floor: sg.floor, thick: sg.thick
        }, ctx);
        plan.walls.push(w);
        rec.change(w.id);
        made++;
      });
    });
    if (!made) rec.warnings.push('どの辺にも既に壁があるので、壁は作っていません');
  }

  // 部屋 room と、別の部屋 to(または外 'outside')のあいだの壁の上に、窓・扉を置く。
  //   外に面した壁は side(N・E・S・W)で選ぶ。部屋どうしは共有する辺(side を渡せばその辺だけ)。
  //   位置: 既定は使える区間の中央。offset を渡すと、区間の北か西の端から開口の端までの長さ(mm)。
  //   hinge(吊り元の側)・opens(開く側)は N・E・S・W。決まりは読み取り(plan-free-apply.js)と lint(tools/lint_plan.py)と同じ:
  //   物の軸 u(rot 0 で東、90 で南)の向きに吊り元があれば flipX、開く側が v(u を時計回りに 90°)なら flipY=false
  //   (折戸は逆)。
  function placeOpening(plan, a, ctx, rec) {
    if (typeof a.type !== 'string' || !a.type) return fail('type(窓・扉の種類)を文字で渡してください');
    var h = hooksOf(ctx);
    var preset = typeof h.openingPreset === 'function' ? h.openingPreset(a.type) : null;
    var baseType = preset ? preset.type : a.type;
    if (!catIs(ctx, 'windowLike', baseType) && !catIs(ctx, 'doorLikeOpening', baseType)) {
      return fail('種類 ' + label(a.type) + ' は窓・扉ではありません(窓・扉の種類を渡してください)');
    }
    var fr = roomById(plan, a.room);
    if (fr.error) return fail(fr.error);
    var room = fr.obj, floor = room.floor || 1;
    if (a.side !== undefined && !SIDES[a.side]) return fail('side は N・E・S・W のどれかで渡してください');
    var toOutside = a.to === undefined || a.to === 'outside';
    var spans = [];   // {e, a, b}
    if (toOutside) {
      if (!a.side) return fail('外に面した壁に置くときは side(N・E・S・W)を渡してください');
      roomEdges(room).forEach(function (e) {
        if (e.side !== a.side) return;
        var shared = sharedWithRooms(plan, room, e).map(function (s) { return [s[0] - e.a, s[1] - e.a]; });
        subtractIntervals(e.b - e.a, shared).forEach(function (pc) {
          if (pc[1] - pc[0] > 1) spans.push({ e: e, a: e.a + pc[0], b: e.a + pc[1] });
        });
      });
      if (!spans.length) return fail('部屋 ' + label(room.id) + ' の ' + a.side + ' の辺は、外に面していません(ほかの部屋と接しています)。to に隣の部屋の id を渡してください');
    } else {
      var fo = roomById(plan, a.to);
      if (fo.error) return fail(fo.error);
      var other = fo.obj;
      if ((other.floor || 1) !== floor) return fail('部屋 ' + label(room.id) + ' と ' + label(other.id) + ' は階が違います');
      roomEdges(room).forEach(function (e) {
        if (a.side && e.side !== a.side) return;
        sharedWithRooms(plan, room, e).forEach(function (s) { if (s[2] === other) spans.push({ e: e, a: s[0], b: s[1] }); });
      });
      if (!spans.length) return fail('部屋 ' + label(room.id) + ' と ' + label(other.id) + ' は辺で接していません');
    }
    // 壁のある区間だけを使う。
    var usable = [];
    spans.forEach(function (sp) {
      var ends = edgeEnds(sp.e, sp.a, sp.b);
      coveredOnSegment(plan.walls, floor, ends[0], ends[1]).forEach(function (c) {
        usable.push({ e: sp.e, a: sp.a + c[0], b: sp.a + c[1] });
      });
    });
    if (!usable.length) return fail('その辺には壁がありません。先に addRoomWalls で壁を作ってから置いてください');
    // 壁が細切れのときは、つながっている区間をまとめる(同じ辺の上で隣り合う区間)。
    usable.sort(function (x, y) { return x.e === y.e ? x.a - y.a : 0; });
    var merged = [];
    usable.forEach(function (u0) {
      var last = merged[merged.length - 1];
      if (last && last.e === u0.e && u0.a <= last.b + 1) last.b = Math.max(last.b, u0.b);
      else merged.push({ e: u0.e, a: u0.a, b: u0.b });
    });
    merged.sort(function (x, y) { return (y.b - y.a) - (x.b - x.a); });
    var best = merged[0], e = best.e;
    var cat = ctx.catalog || {};
    if (a.width !== undefined && !isPositive(a.width)) return fail('width は 0 より大きい数で渡してください');
    var size = typeof cat.defaultSize === 'function' ? cat.defaultSize(baseType) : null;
    var width = a.width !== undefined ? a.width : (size && size.w) || 780;
    if (a.offset !== undefined && !(isNum(a.offset) && a.offset >= 0)) return fail('offset は 0 以上の数で渡してください');
    var start = a.offset !== undefined ? best.a + a.offset : (best.a + best.b) / 2 - width / 2;
    if (start < best.a - 1 || start + width > best.b + 1) {
      return fail('幅 ' + width + 'mm の開口は、使える壁(長さ ' + Math.round(best.b - best.a) + 'mm)に収まりません。offset は 0〜'
        + Math.max(0, Math.round(best.b - best.a - width)) + ' にするか、width を小さくしてください');
    }
    var mid = start + width / 2;
    var cx = e.axis === 'h' ? mid : e.c, cy = e.axis === 'h' ? e.c : mid;
    var rot = e.axis === 'h' ? 0 : 90;
    // 同じ壁の上の開口と重ならない。
    var clash = (plan.items || []).filter(function (it) {
      if (!it || (it.floor || 1) !== floor) return false;
      if (!catIs(ctx, 'windowLike', it.type) && !catIs(ctx, 'doorLikeOpening', it.type)) return false;
      var vertical = Math.round(normRot(it.rot || 0)) % 180 === 90;
      if (vertical !== (e.axis === 'v')) return false;
      var icx = it.x + it.w / 2, icy = it.y + it.d / 2;
      if (Math.abs((e.axis === 'h' ? icy : icx) - e.c) > LINE_TOL + 200) return false;
      var ic = e.axis === 'h' ? icx : icy;
      return Math.min(ic + it.w / 2, start + width) - Math.max(ic - it.w / 2, start) > 1;
    });
    if (clash.length) return fail('その位置は既にある開口(id ' + clash.map(function (it) { return label(it.id); }).join(', ') + ')と重なります。offset で位置をずらしてください');
    var u = e.axis === 'h' ? [1, 0] : [0, 1], v = e.axis === 'h' ? [0, 1] : [-1, 0];
    var flipX, flipY;
    if ((a.hinge !== undefined || a.opens !== undefined) && SWING_TYPES.indexOf(baseType) < 0) {
      return fail('hinge・opens は開き戸・玄関ドア・折戸(' + SWING_TYPES.join(', ') + ')にだけ渡せます');
    }
    if (a.hinge !== undefined) {
      var hd = SIDES[a.hinge];
      if (!hd) return fail('hinge は N・E・S・W のどれかで渡してください');
      var hu = hd[0] * u[0] + hd[1] * u[1];
      if (!hu) return fail('hinge は壁に沿った向き(この壁では ' + (e.axis === 'h' ? 'E か W' : 'N か S') + ')で渡してください');
      flipX = hu > 0;
    }
    if (a.opens !== undefined) {
      var od = SIDES[a.opens];
      if (!od) return fail('opens は N・E・S・W のどれかで渡してください');
      var ov = od[0] * v[0] + od[1] * v[1];
      if (!ov) return fail('opens は壁と直角の向き(この壁では ' + (e.axis === 'h' ? 'N か S' : 'E か W') + ')で渡してください');
      flipY = baseType.indexOf('door-fold') === 0 ? ov > 0 : !(ov > 0);
    }
    var args = { type: a.type, x: cx, y: cy, rot: rot, floor: floor, w: width };
    // 開き戸は奥行きが扉の幅と同じ(読み取りと同じ。PlanSettable の OPENINGS で d を持たない種類)。
    var settable = ctx.settable;
    var odef = settable && settable.OPENINGS ? settable.OPENINGS.filter(function (o) { return o.type === baseType; })[0] : null;
    if (odef && odef.d === null) args.d = width;
    var before = (plan.items || []).length;
    var res = placeItem(plan, args, ctx, rec);
    if (res && res.error) return res;
    var it = plan.items[before];
    if (flipX !== undefined) it.flipX = flipX;
    if (flipY !== undefined) it.flipY = flipY;
    // 扉は閉じた状態で置く(読み取りの plan-free-apply.js と同じ。開いた扉が並ぶと間取りが読みにくく、外観では玄関が開いて見える)。
    // 画面の道具で人が置くとき(placeItem)の既定は変えない。
    if (/^door-|^window-door/.test(baseType)) it.doorOpenState = 'closed';
  }

  // 屋根をかける。画面の屋根の道具と同じ物(placeItem の roof)を置き、画面の設定欄と同じ roofType・pitch を書く。
  //   floor は屋根が載る階(その階の壁の上)。屋根の物は floor+1 に置く(画面・読み取りと同じ決まり)。
  //   範囲: x・y・w・d(中心と大きさ、壁の芯で)を渡せばそこ、省けば floor の壁の外周。外周が長方形でなければ断る
  //   (L字などを1枚の長方形で覆う近似はしない。部分ごとに範囲を渡してもらう)。overhang(軒の出)を四方に足す。
  //   shape は画面の形(ROOF_TYPES)。切妻は ridge(EW・NS。省くと長い辺に沿う)、片流れは low(低い側。省くと N)。
  //   片流れは rot=0 で低い側が北(読み取りと同じ)。東・西が低いときは 90°・270° 回し、幅と奥行きを入れ替える。
  function addRoof(plan, a, ctx, rec) {
    if (a.floor === undefined) return fail('floor(屋根が載る階)を渡してください');
    var fe = floorError(a.floor, ctx);
    if (fe) return fe;
    var shape = a.shape;
    if (ROOF_TYPES.indexOf(shape) < 0) return fail('shape は画面の屋根の形のどれかで渡してください', ROOF_TYPES.slice());
    if (a.ridge !== undefined && (shape !== 'gable' || (a.ridge !== 'EW' && a.ridge !== 'NS'))) return fail('ridge は shape が gable のときだけ、EW か NS で渡せます');
    if (a.low !== undefined && (shape !== 'mono' || !SIDES[a.low])) return fail('low は shape が mono のときだけ、N・E・S・W で渡せます');
    if (a.pitch !== undefined && !isNum(a.pitch)) return fail('pitch は数(度)で渡してください');
    if (a.overhang !== undefined && !(isNum(a.overhang) && a.overhang >= 0 && a.overhang <= 2000)) return fail('overhang は 0〜2000 の数(mm)で渡してください');
    var rectKeys = ['x', 'y', 'w', 'd'].filter(function (k) { return a[k] !== undefined; });
    var x0, y0, x1, y1;
    if (rectKeys.length) {
      if (rectKeys.length !== 4) return fail('範囲は x・y・w・d の4つをそろえて渡してください(省くと壁の外周)');
      if (!isNum(a.x) || !isNum(a.y) || !isPositive(a.w) || !isPositive(a.d)) return fail('x・y は数、w・d は 0 より大きい数で渡してください');
      x0 = a.x - a.w / 2; y0 = a.y - a.d / 2; x1 = a.x + a.w / 2; y1 = a.y + a.d / 2;
    } else {
      var walls = (plan.walls || []).filter(function (w) { return w && (w.floor || 1) === a.floor; });
      if (!walls.length) return fail(a.floor + '階に壁がありません。先に壁を作るか、範囲(x・y・w・d)を渡してください');
      x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
      walls.forEach(function (w) {
        x0 = Math.min(x0, w.x1, w.x2); x1 = Math.max(x1, w.x1, w.x2);
        y0 = Math.min(y0, w.y1, w.y2); y1 = Math.max(y1, w.y1, w.y2);
      });
      var sides = [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x0, y: y1 }, { x: x1, y: y1 }], [{ x: x0, y: y0 }, { x: x0, y: y1 }]];
      var rect = sides.every(function (sd) {
        var L = Math.hypot(sd[1].x - sd[0].x, sd[1].y - sd[0].y);
        var gap = subtractIntervals(L, coveredOnSegment(walls, a.floor, sd[0], sd[1])).reduce(function (s, pc) { return s + pc[1] - pc[0]; }, 0);
        return L > 0 && gap <= L * 0.05;
      });
      if (!rect) return fail(a.floor + '階の壁の外周が長方形ではありません。屋根をかける長方形の範囲(x・y・w・d)を、部分ごとに渡してください');
    }
    var over = a.overhang !== undefined ? a.overhang : ROOF_OVERHANG;
    x0 -= over; y0 -= over; x1 += over; y1 += over;
    var W = x1 - x0, D = y1 - y0;
    // 同じ階に重なる屋根があれば断る(二重にかけない)。
    var dup = (plan.items || []).filter(function (it) {
      if (!it || it.type !== 'roof' || (it.floor || 1) !== a.floor + 1) return false;
      var turned = Math.round(normRot(it.rot || 0)) % 180 === 90;
      var cx = it.x + it.w / 2, cy = it.y + it.d / 2, hw = (turned ? it.d : it.w) / 2, hd = (turned ? it.w : it.d) / 2;
      var ox = Math.min(x1, cx + hw) - Math.max(x0, cx - hw), oy = Math.min(y1, cy + hd) - Math.max(y0, cy - hd);
      return ox > 1 && oy > 1 && ox * oy > W * D * 0.01;
    });
    if (dup.length) return fail('その範囲には屋根が既にあります(id ' + dup.map(function (it) { return label(it.id); }).join(', ') + ')');
    var roofType = shape, rot = 0, iw = W, id = D;
    if (shape === 'gable') roofType = (a.ridge || (W >= D ? 'EW' : 'NS')) === 'NS' ? 'gable-y' : 'gable';
    if (shape === 'mono') {
      var low = a.low || 'N';
      if (low === 'S') rot = 180;
      if (low === 'E' || low === 'W') { rot = low === 'E' ? 90 : 270; iw = D; id = W; }
    }
    var args = { type: 'roof', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: iw, d: id, floor: a.floor + 1 };
    if (rot) args.rot = rot;
    var before = (plan.items || []).length;
    var res = placeItem(plan, args, ctx, rec);
    if (res && res.error) return res;
    var it = plan.items[before];
    it.roofType = roofType;
    if (a.pitch !== undefined) {
      var p = Math.max(5, Math.min(60, a.pitch));
      if (p !== a.pitch) rec.warnings.push('pitch=' + a.pitch + ' は画面の範囲(5〜60°)の外なので ' + p + ' にしました');
      it.pitch = p;
    }
  }

  // ── 一括差し替え(画面の「表示するセット」の下の「一括差し替え」と同じ。assets/js/asset-swap.js)────────────
  // ctx.assetSwap = {sets() → [{id, name}], find(名前か id) → {id, name} か null, plan(plan, setId, {frozen, keep}) → 行,
  //                  applyRows(plan, 行, makeItem) → {changed, removed}}
  // 画面(plan-data.js の planAssetSwapCtx)は AssetSwap.planFor、Worker(plan-ctx-factory.mjs)は表から同じ計算をする。
  // 差し替える物の決め方・大きさ・高さは画面の一括差し替えと同じ。違うのは次の2つだけ:
  //   - ロックされた物は替えない・外さない・高さも変えない(画面の一括差し替えはロックを見ない)。ids でロックされた物を
  //     名指ししたときは、ほかの操作と同じく失敗にする。
  //   - ids(この物だけ)・except(この物を除く)で、替える物を選べる(画面の確認の一覧でチェックを外すのに当たる)。
  //     選ばなかった物は替えないが、載っている台が替わるときは台の高さに合わせる。
  function idList(v, what) {
    if (v === undefined) return { list: null };
    if (!Array.isArray(v)) return { error: what + ' は id の配列で渡してください' };
    return { list: v.map(function (x) { return String(x); }) };
  }
  function swapAssetSet(plan, a, ctx, rec) {
    var sw = ctx.assetSwap;
    if (!sw || typeof sw.plan !== 'function') return fail('この ctx では家具の一括差し替えができません');
    var names = (sw.sets() || []).map(function (s) { return s.id; });
    if (typeof a.set !== 'string' || !a.set.trim()) return fail('set(差し替え先のセット)を文字で渡してください', names);
    var set = sw.find(a.set);
    if (!set) {
      var shown = (sw.sets() || []).map(function (s) { return s.id + '（' + s.name + '）'; }).join('・');
      return fail('差し替え先のセット ' + label(a.set) + ' はありません。使えるセット: ' + (shown || 'なし'), names);
    }
    var only = idList(a.ids, 'ids'), except = idList(a.except, 'except');
    if (only.error) return fail(only.error);
    if (except.error) return fail(except.error);
    var items = plan.items || [];
    var byId = {};
    items.forEach(function (it) { if (it && it.id !== undefined) byId[String(it.id)] = it; });
    var named = (only.list || []).concat(except.list || []);
    for (var i = 0; i < named.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(byId, named[i])) return fail('id ' + label(named[i]) + ' の物が見つかりません(一括差し替えで選べるのは物だけです)');
    }
    for (var j = 0; only.list && j < only.list.length; j++) {
      if (isLocked(byId[only.list[j]], ctx)) return lockedError(byId[only.list[j]]);
    }
    var frozen = function (it) { return isLocked(it, ctx); };
    var keep = function (it) {
      var id = String(it.id);
      if (only.list && only.list.indexOf(id) < 0) return true;
      return !!(except.list && except.list.indexOf(id) >= 0);
    };
    var rows = sw.plan(plan, set.id, { frozen: frozen, keep: (only.list || except.list) ? keep : undefined });
    var change = rows.filter(function (r) { return r.action !== 'keep'; });
    var kept = rows.filter(function (r) { return r.action === 'keep'; });
    var made = sw.applyRows(plan, change, function (type, x, y, rot, floor, w, d) {
      return Factories.makeItem(type, { x: x, y: y, rot: rot, floor: floor, w: w, d: d }, ctx);
    });
    made.changed.forEach(function (id) { rec.change(id); });
    made.removed.forEach(function (id) { rec.remove(id); });
    if (!change.length) rec.warnings.push(set.name + 'に差し替えられる家具がありませんでした(プランは変わっていません)');
    if (kept.length) {
      rec.warnings.push('そのまま残した物 ' + kept.length + ' 点: ' + kept.slice(0, 12).map(function (r) {
        return 'id ' + label(r.id) + ' ' + r.type + '（' + r.reason + '）';
      }).join('、') + (kept.length > 12 ? ' ほか' : ''));
    }
  }

  var OPS = {
    addRoom: addRoom, resizeRoom: resizeRoom, renameRoom: renameRoom,
    addWall: addWall, removeWall: removeWall,
    placeItem: placeItem, moveObject: moveObject, rotateObject: rotateObject,
    deleteObjects: deleteObjects, setProps: setProps,
    addRoomWalls: addRoomWalls, placeOpening: placeOpening, addRoof: addRoof,
    swapAssetSet: swapAssetSet
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
      if (ctx.targets !== undefined) {
        if (ctx.inPlace !== true) return failure(plan, null, null, 'ctx.targets は inPlace のときだけ使えます');
        if (!Array.isArray(ctx.targets) || !ctx.targets.length
          || ctx.targets.some(function (o) { return !o || typeof o !== 'object'; })) {
          return failure(plan, null, null, 'ctx.targets は物の配列で渡してください');
        }
      }
      var target = ctx.inPlace === true ? plan : cloneDeep(plan, new Map());
      var rec = new Recorder();
      var runAll = function () {
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
      };
      // 写しに当てるときだけ、写しを作ったあとの処理全体を ctx.withPlan(写し, run) の中で動かす
      // (画面のグローバルに依存する hooks に、写しを「今のプラン」として見せるため。画面の planChatCtx)。
      if (ctx.inPlace !== true && typeof ctx.withPlan === 'function') return ctx.withPlan(target, runAll);
      return runAll();
    } catch (e) {
      if (ctx && ctx.inPlace === true && ctx.rethrow === true) throw e;
      var msg = '操作の途中で誤りが起きました: ' + (e && e.message ? e.message : String(e));
      if (ctx && ctx.inPlace === true) msg += '(inPlace なので、プランが途中まで変わっているかもしれません)';
      return failure(plan, index, opName, msg);
    }
  }

  // プランの写し(applyOperations が写しに当てるときと同じ写し方)。チャットが依頼の始めに使う。
  function clonePlan(plan) { return cloneDeep(plan, new Map()); }

  return { applyOperations: applyOperations, applyProp: applyProp, tidyStairProp: tidyStairProp, clonePlan: clonePlan, OPS: OPS, ROOF_TYPES: ROOF_TYPES, tidyName: tidyName, ROOM_NAME_MAX: ROOM_NAME_MAX };
}));
