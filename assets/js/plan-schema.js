// 間取り(プラン)JSONの形を1か所に決める。
//
// なぜ在るのか
// ------------
// これまでプランの「正しい形」はどこにも書かれておらず、読み込みは
// JSON.parse したものをそのまま DATA に入れ、壊れていれば描画の途中で
// 初めて落ちる作りだった。worker 側の検査も walls/items/rooms が配列か
// どうかを見る2行だけで、中身は見ていない。
//
// 間取りをAIに起こさせる(画像→プラン)機能では、**こちらの知らない形が
// 返ってくるのが常態**になる。座標が文字列で来る、階が0から始まる、
// 長さゼロの壁が混ざる、といったものを DATA へ入れてしまうと、
// 画面が真っ白になってから原因を探すことになる。入口で弾く場所が要る。
//
// 何を見て、何を見ないか
// ----------------------
// ここで見るのは **その間取りが読み込めるか** だけ。
// 「玄関が北にある」「廊下が狭い」のような設計の良し悪しは
// tools/lint_plan.py の仕事で、ここでは一切判断しない。
//
// errors が1件でもあれば読み込んではいけない。warnings は読み込めるが
// 意図しない結果になりそうなもの(見慣れない種類、極端な寸法)を挙げる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanSchema = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // 寸法はすべてミリメートル。アプリの座標系と同じ。
  var LIMITS = {
    COORD_MM: 1000000,        // 原点から±1km。これを超えるのは単位の取り違え
    MIN_WALL_LEN_MM: 1,       // 長さゼロの壁は面を張れない
    MIN_WALL_THICK_MM: 10,
    MAX_WALL_THICK_MM: 1000,
    MIN_SIZE_MM: 1,           // 部屋・物の幅/奥行き
    MAX_SIZE_MM: 200000,
    MAX_SKIP_LEVEL_MM: 2400,  // スキップフロアの段差。これを超えるともう1つの階
    MIN_FLOOR: 1,
    MAX_FLOOR: 5,             // 3階建て + その上に載る屋根アイテムぶんの余裕
    MAX_OBJECTS: 20000        // 1プランの総数。これ以上は描画が実用にならない
  };

  var COLLECTIONS = ['walls', 'rooms', 'items'];

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  // 文字列の数値("1200")は受ける。AIの出力でもJSONの手書きでも普通に混ざる。
  function num(v) {
    if (isFiniteNum(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function inRange(v, lo, hi) { return v !== null && v >= lo && v <= hi; }

  function coordOk(v) { return inRange(v, -LIMITS.COORD_MM, LIMITS.COORD_MM); }

  // ── 1件ずつの検査 ──────────────────────────────────────────────────
  // どれも「その1件が読み込めるか」だけを返す。where は 'walls[3]' のような
  // 場所を指す文字列で、そのまま利用者に見せられる粒度にしてある。

  function checkWall(w, where, errors, warnings) {
    if (!w || typeof w !== 'object') { errors.push(where + ': 壁がオブジェクトではない'); return; }
    var x1 = num(w.x1), y1 = num(w.y1), x2 = num(w.x2), y2 = num(w.y2);
    if (![x1, y1, x2, y2].every(coordOk)) {
      errors.push(where + ': 端点の座標が数値でないか、±' + LIMITS.COORD_MM + 'mm を超えている');
      return;
    }
    var len = Math.hypot(x2 - x1, y2 - y1);
    if (len < LIMITS.MIN_WALL_LEN_MM) {
      errors.push(where + ': 長さが ' + Math.round(len) + 'mm しかない(始点と終点が同じ)');
    }
    var thick = num(w.thick);
    if (thick === null) {
      warnings.push(where + ': 厚みが無いので既定値で読む');
    } else if (!inRange(thick, LIMITS.MIN_WALL_THICK_MM, LIMITS.MAX_WALL_THICK_MM)) {
      errors.push(where + ': 厚み ' + thick + 'mm は範囲外(' +
        LIMITS.MIN_WALL_THICK_MM + '〜' + LIMITS.MAX_WALL_THICK_MM + 'mm)');
    }
    checkFloor(w.floor, where, errors);
  }

  function checkRoom(r, where, errors, warnings) {
    if (!r || typeof r !== 'object') { errors.push(where + ': 部屋がオブジェクトではない'); return; }
    var x = num(r.x), y = num(r.y), w = num(r.w), d = num(r.d);
    if (!coordOk(x) || !coordOk(y)) { errors.push(where + ': 位置が数値でないか範囲外'); return; }
    if (!inRange(w, LIMITS.MIN_SIZE_MM, LIMITS.MAX_SIZE_MM) ||
        !inRange(d, LIMITS.MIN_SIZE_MM, LIMITS.MAX_SIZE_MM)) {
      errors.push(where + ': 大きさ ' + w + '×' + d + 'mm が範囲外(' +
        LIMITS.MIN_SIZE_MM + '〜' + LIMITS.MAX_SIZE_MM + 'mm)');
    }
    checkFloor(r.floor, where, errors);
    if (r.n !== undefined && typeof r.n !== 'string') warnings.push(where + ': 部屋名が文字列でない');
    // スキップフロアの段差。読み込めなくはないので errors ではなく warnings。
    // 範囲外は HeightModel 側で丸まるので、丸まることだけ伝える。
    if (r.skipLevelMm !== undefined) {
      var sk = num(r.skipLevelMm);
      if (sk === null || sk < 0) {
        warnings.push(where + ': 段差(skipLevelMm) が数値でないので段差なしとして読む');
      } else if (sk > LIMITS.MAX_SKIP_LEVEL_MM) {
        warnings.push(where + ': 段差 ' + sk + 'mm は上限 ' + LIMITS.MAX_SKIP_LEVEL_MM +
          'mm を超えるので丸めて読む(それ以上は別の階として作るもの)');
      }
    }
  }

  function checkItem(it, where, errors, warnings) {
    if (!it || typeof it !== 'object') { errors.push(where + ': 物がオブジェクトではない'); return; }
    if (typeof it.type !== 'string' || !it.type) { errors.push(where + ': type が無い'); return; }
    var x = num(it.x), y = num(it.y);
    if (!coordOk(x) || !coordOk(y)) { errors.push(where + ': 位置が数値でないか範囲外'); return; }
    var w = num(it.w), d = num(it.d);
    // 幅・奥行きは既定値を持つ種類が多いので、無いこと自体は許す。
    if (w !== null && !inRange(w, LIMITS.MIN_SIZE_MM, LIMITS.MAX_SIZE_MM)) {
      errors.push(where + ': 幅 ' + w + 'mm が範囲外');
    }
    if (d !== null && !inRange(d, LIMITS.MIN_SIZE_MM, LIMITS.MAX_SIZE_MM)) {
      errors.push(where + ': 奥行き ' + d + 'mm が範囲外');
    }
    var rot = num(it.rot);
    if (it.rot !== undefined && rot === null) errors.push(where + ': 回転角が数値でない');
    checkFloor(it.floor, where, errors);
    // 階段の行き先と、置く高さの基準。見慣れない値は既定として読む。
    if (it.stairTarget !== undefined && it.stairTarget !== 'upper' && it.stairTarget !== 'level') {
      warnings.push(where + ': 階段の行き先 "' + it.stairTarget + '" は upper / level のどちらでもないので上の階として読む');
    }
    if (it.baseLevel !== undefined && it.baseLevel !== 'floor' && it.baseLevel !== 'under') {
      warnings.push(where + ': 置く高さの基準 "' + it.baseLevel + '" は floor / under のどちらでもないので床の上として読む');
    }
    if (it.stairUnder !== undefined && it.stairUnder !== 'open' && it.stairUnder !== 'filled') {
      warnings.push(where + ': 階段の下 "' + it.stairUnder + '" は open / filled のどちらでもないので素通しとして読む');
    }
    if (it.shelfSides !== undefined && it.shelfSides !== 'none' && it.shelfSides !== 'both') {
      warnings.push(where + ': 造作棚の縦板 "' + it.shelfSides + '" は none / both のどちらでもないので自動判定で読む');
    }
  }

  function checkFloor(v, where, errors) {
    if (v === undefined || v === null) return;      // 省略は1階とみなす
    var f = num(v);
    if (f === null || f !== Math.round(f) || !inRange(f, LIMITS.MIN_FLOOR, LIMITS.MAX_FLOOR)) {
      errors.push(where + ': 階 ' + v + ' は ' + LIMITS.MIN_FLOOR + '〜' + LIMITS.MAX_FLOOR + ' の整数ではない');
    }
  }

  // ── まとめての検査 ──────────────────────────────────────────────────
  //
  // knownItemTypes を渡すと、見慣れない種類を warnings に挙げる。
  // 渡さなければ種類は見ない(worker 側は種類の一覧を持っていないため)。
  function validatePlan(plan, opts) {
    opts = opts || {};
    var errors = [], warnings = [];

    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      return { ok: false, errors: ['プランがオブジェクトではない'], warnings: warnings };
    }
    COLLECTIONS.forEach(function (name) {
      if (!Array.isArray(plan[name])) errors.push(name + ' が配列ではない');
    });
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };

    var total = COLLECTIONS.reduce(function (n, name) { return n + plan[name].length; }, 0);
    if (total > LIMITS.MAX_OBJECTS) {
      errors.push('要素が ' + total + ' 個ある(上限 ' + LIMITS.MAX_OBJECTS + ' 個)');
    }

    plan.walls.forEach(function (w, i) { checkWall(w, 'walls[' + i + ']', errors, warnings); });
    plan.rooms.forEach(function (r, i) { checkRoom(r, 'rooms[' + i + ']', errors, warnings); });
    plan.items.forEach(function (it, i) { checkItem(it, 'items[' + i + ']', errors, warnings); });

    // id の重複。同じ id が2つあると、片方を動かすともう片方も動く。
    COLLECTIONS.forEach(function (name) {
      var seen = Object.create(null);
      plan[name].forEach(function (o, i) {
        var id = o && o.id;
        if (id === undefined || id === null) return;
        var key = String(id);
        if (seen[key] !== undefined) {
          errors.push(name + '[' + i + ']: id "' + key + '" が ' + name + '[' + seen[key] + '] と重複');
        } else seen[key] = i;
      });
    });

    if (opts.knownItemTypes) {
      var known = opts.knownItemTypes;
      var has = typeof known.has === 'function'
        ? function (t) { return known.has(t); }
        : function (t) { return Object.prototype.hasOwnProperty.call(known, t); };
      var unknown = Object.create(null);
      plan.items.forEach(function (it) {
        if (it && typeof it.type === 'string' && !has(it.type)) unknown[it.type] = (unknown[it.type] || 0) + 1;
      });
      Object.keys(unknown).forEach(function (t) {
        warnings.push('見慣れない種類 "' + t + '" が ' + unknown[t] + ' 件。読み込めるが箱で描かれる');
      });
    }

    if (!plan.walls.length) warnings.push('壁が1本も無い');

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // ── 読み込める形に均す ──────────────────────────────────────────────
  //
  // validatePlan を通ったものだけを渡すこと。ここは「通る形」を「扱いやすい
  // 形」にするだけで、壊れたものを直そうとはしない。文字列の数値を数値に
  // し、階の省略を1階にし、id の無いものに連番を振る。
  //
  // アプリ側の ensure*() が担う既定値(色・テクスチャ・開口の設定など)には
  // 触らない。二重に既定値を入れる場所を作らないため。
  function normalizePlan(plan) {
    var out = { walls: [], rooms: [], items: [] };
    Object.keys(plan).forEach(function (k) {
      if (COLLECTIONS.indexOf(k) < 0) out[k] = plan[k];
    });
    var nextId = 1;
    function idFor(o) {
      if (o.id !== undefined && o.id !== null && o.id !== '') return o.id;
      return 'p' + (nextId++);
    }
    function base(o) {
      var c = {};
      Object.keys(o).forEach(function (k) { c[k] = o[k]; });
      c.id = idFor(o);
      c.floor = num(o.floor) === null ? 1 : Math.round(num(o.floor));
      return c;
    }
    plan.walls.forEach(function (w) {
      var c = base(w);
      c.x1 = num(w.x1); c.y1 = num(w.y1); c.x2 = num(w.x2); c.y2 = num(w.y2);
      if (num(w.thick) !== null) c.thick = num(w.thick);
      out.walls.push(c);
    });
    plan.rooms.forEach(function (r) {
      var c = base(r);
      c.x = num(r.x); c.y = num(r.y); c.w = num(r.w); c.d = num(r.d);
      out.rooms.push(c);
    });
    plan.items.forEach(function (it) {
      var c = base(it);
      c.x = num(it.x); c.y = num(it.y);
      if (num(it.w) !== null) c.w = num(it.w);
      if (num(it.d) !== null) c.d = num(it.d);
      c.rot = num(it.rot) === null ? 0 : num(it.rot);
      out.items.push(c);
    });
    return out;
  }

  // 一行で読める要約。取り込みの結果を利用者に見せるときに使う。
  function summarize(plan) {
    var floors = Object.create(null);
    COLLECTIONS.forEach(function (name) {
      (plan[name] || []).forEach(function (o) {
        var f = (o && num(o.floor)) || 1;
        floors[f] = (floors[f] || 0) + 1;
      });
    });
    return {
      walls: (plan.walls || []).length,
      rooms: (plan.rooms || []).length,
      items: (plan.items || []).length,
      floors: Object.keys(floors).map(Number).sort(function (a, b) { return a - b; })
    };
  }

  return {
    LIMITS: LIMITS,
    COLLECTIONS: COLLECTIONS,
    validatePlan: validatePlan,
    normalizePlan: normalizePlan,
    summarize: summarize
  };
}));
