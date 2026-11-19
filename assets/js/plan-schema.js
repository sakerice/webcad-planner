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
    MAX_OBJECTS: 20000,       // 1プランの総数。これ以上は描画が実用にならない
    // 画面へ丸ごと入れるプランの総数(壁・部屋・物)。超えたら開かずに断る(loadProblem)。
    // 手元の正当なプランの最大は 287 個(固定プラン house-2f)。headless の画面で測ると、3D の組み立てが数の2乗で
    // 重くなる(300 個 1.4 秒・1000 個 8 秒・1500 個 19 秒・5000 個 297 秒。読み込みは 5000 個で 25 秒)。
    // 正当な最大の約7倍で、3D が数十秒で終わる所に置いた(MAX_OBJECTS は形の検査の上限で、別の物)。
    MAX_LOAD_OBJECTS: 2000
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
    if (w.baseLevel !== undefined && w.baseLevel !== 'floor' && w.baseLevel !== 'skip') {
      warnings.push(where + ': 壁の基準 "' + w.baseLevel + '" は floor / skip のどちらでもないので自動判定で読む');
    }
    checkBaseRoom(w, where, warnings);
  }

  // 載せる床(部屋のid)。見つからない部屋を指していても読めるので warnings。
  // アプリ側は、指した部屋が無ければ自動に戻す(baseRoomOf)。
  function checkBaseRoom(o, where, warnings) {
    if (o.baseRoom === undefined || o.baseRoom === null) return;
    if (typeof o.baseRoom !== 'string' && typeof o.baseRoom !== 'number') {
      warnings.push(where + ': 載せる床(baseRoom) が部屋のidでないので自動判定で読む');
    }
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
    if (it.landingMode !== undefined && it.landingMode !== 'floor') {
      warnings.push(where + ': 踊り場の使い方 "' + it.landingMode + '" は floor ではないので階段の一部として読む');
    }
    // 置く高さの基準。物は floor / under、階段は floor / skip を使う。
    if (it.baseLevel !== undefined &&
        ['floor', 'under', 'skip'].indexOf(it.baseLevel) < 0) {
      warnings.push(where + ': 置く高さの基準 "' + it.baseLevel + '" は floor / under / skip のどれでもないので自動判定で読む');
    }
    checkBaseRoom(it, where, warnings);
    if (it.stairRail !== undefined &&
        ['none', 'left', 'right', 'both'].indexOf(it.stairRail) < 0) {
      warnings.push(where + ': 階段の手すり "' + it.stairRail + '" は none / left / right / both のどれでもないので手すり無しとして読む');
    }
    if (it.railInfill !== undefined &&
        ['bars', 'wires', 'baluster', 'none'].indexOf(it.railInfill) < 0) {
      warnings.push(where + ': 手すり・柵の意匠 "' + it.railInfill + '" は bars / wires / baluster / none のどれでもないので横桟として読む');
    }
    if (it.stairRailMount !== undefined && it.stairRailMount !== 'wall' && it.stairRailMount !== 'post') {
      warnings.push(where + ': 手すりの付け方 "' + it.stairRailMount + '" は wall / post のどちらでもないので自動判定で読む');
    }
    if (it.stairStyle !== undefined &&
        ['open', 'box', 'skeleton'].indexOf(it.stairStyle) < 0) {
      warnings.push(where + ': 階段の形状 "' + it.stairStyle + '" は open / box / skeleton のどれでもないのでひな壇として読む');
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
    // 鍵 __proto__ は写さない(JSON.parse が自分の鍵として作る。代入すると写しの継承元を差し替える)。
    Object.keys(plan).forEach(function (k) {
      if (COLLECTIONS.indexOf(k) < 0 && k !== '__proto__') out[k] = plan[k];
    });
    var nextId = 1;
    function idFor(o) {
      if (o.id !== undefined && o.id !== null && o.id !== '') return o.id;
      return 'p' + (nextId++);
    }
    function base(o) {
      var c = {};
      Object.keys(o).forEach(function (k) { if (k !== '__proto__') c[k] = o[k]; });
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

  // ── 他人のプランを画面に入れる前に形をそろえる ──────────────────────────
  //
  // プランはファイル・共有 URL・共同編集の部屋・自動保存・AI の結果など、外から入る。中の欄は誰でも
  // 決められるので、画面が例外で止まったり固まったりする形を、入れる前にここでそろえる。
  // 呼ぶ所: 画面の normalizeLoadedPlan(開く経路と、相手の差分を当てたあと)・installSharedPlan・
  // PlanSnapshot。プランを丸ごと入れ替える入口(ファイル・自動保存・一覧・共有)は、先に loadProblem で
  // 大きさを見て、超えていれば入れずに断る。
  //
  // 決まり(どれも「型と範囲」だけを見る。利用者の手直しを潰さないため、座標の端数は丸めず、物は寄せない):
  //   - walls・items・rooms が配列でなければ空の配列にする。要素が素のオブジェクトでなければ捨てる。
  //   - 座標・大きさ(壁の両端、部屋の位置と大きさ、物の位置): 数の文字は数に直す。直せない・有限でない・
  //     絶対値が TIDY_MAX_ABS を超えるときは、その物を捨てる(validatePlan が「読み込めない」とする物と同じ)。
  //   - 省いてよい数の欄(物の幅・奥行き・回転・高さ、壁の厚さ・高さ): 有限でない・桁外れ・数にならない
  //     値は欄を消して既定値で読む。数の文字は残す(既存の保存に壁厚 "120" があり、画面はそのまま読めている)。
  //     null は「自動」の意味で使う欄があるので残す。
  //   - 階: 数の文字は数に直す。MIN_FLOOR〜MAX_FLOOR に入らなければその物を捨てる(階 1e9 で読み込みが
  //     2 分半かかった)。省略は今までどおり1階。端数のある階は変えない。
  //   - 物・壁・部屋の一段めの文字で TIDY_MAX_TEXT 字を超える物は切る(画像の data: URL は切らない)。
  //     名前はふつう数十字なので、ふつうのプランでは何も変わらない。
  //   - プランのどの深さでも、自分の鍵 __proto__・constructor・prototype は消す。id が __proto__ などの物は捨てる。
  //   - 全体の設定の入れ物(外壁・内壁・屋根・階の設定など)は、素のオブジェクトか null でなければ消して、
  //     画面の ensure* に既定を作らせる。入れ物の中の表(階ごと・壁ごと・面ごと)の値も同じ。
  //   - 知らない欄は消さない(新しい版で保存したプランを古い版が壊さないため)。
  //
  // 戻り値: { changed: 変えた数, dropped: {walls, items, rooms}, notes: [理由の文] }。plan はその場で直す。
  var TIDY_MAX_ABS = 1e9;          // 座標・大きさの絶対値(mm)。共同編集の部屋の検査(worker/room-guard.mjs)と同じ
  var TIDY_MAX_TEXT = 10000;       // 1つの文字の欄の長さ。2百万字の部屋の名前で起動が 30 秒を超えた
  var TIDY_UNSAFE = ['__proto__', 'constructor', 'prototype'];
  // id がこの名前の物は捨てる。画面と Worker はこの id を鍵に設定の表を作るため(差分の当て方
  // assets/js/plan-core/patch.js の UNSAFE_KEYS と同じ一覧。plan-load-guards.test.cjs が一致を見る)。
  var TIDY_UNSAFE_IDS = ['__proto__', 'constructor', 'prototype', 'toString', 'toLocaleString', 'valueOf',
    'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'];
  var TIDY_COORDS = { walls: ['x1', 'y1', 'x2', 'y2'], rooms: ['x', 'y', 'w', 'd'], items: ['x', 'y'] };
  var TIDY_OPTIONAL = { walls: ['thick', 'h', 'elev'], rooms: ['skipLevelMm'], items: ['w', 'd', 'rot', 'elev', 'h'] };
  // 全体の設定の入れ物。値は 'object'(素のオブジェクトか null)。入れ物の中の表の名前を並べた物は、
  // その表の値も素のオブジェクトか null に限る('*' は入れ物の値そのものが表)。
  // 'whole' のように表でない物は、その値だけを見る(TIDY_INNER_OBJECTS)。
  var TIDY_FIELDS = {
    exteriorWallSettings: ['whole', 'floors', 'walls', 'faces'],
    interiorWallSettings: ['whole', 'floors', 'walls', 'faces'],
    roofAppearance: ['whole', 'floors'],
    floorMetadata: ['*'],
    exteriorDetail: [],
    heightDefaults: [],
    viewState: []
  };
  var TIDY_INNER_OBJECTS = ['whole'];

  function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // どの深さでも危ない鍵を消す。入れ子が深すぎるプランは JSON.parse が作れないので、深さで止めない。
  function dropUnsafeKeys(root) {
    var n = 0, stack = [root];
    while (stack.length) {
      var v = stack.pop();
      if (!v || typeof v !== 'object') continue;
      for (var i = 0; i < TIDY_UNSAFE.length; i++) {
        if (own(v, TIDY_UNSAFE[i])) { delete v[TIDY_UNSAFE[i]]; n++; }
      }
      if (Array.isArray(v)) { for (var j = 0; j < v.length; j++) if (v[j] && typeof v[j] === 'object') stack.push(v[j]); }
      else { var ks = Object.keys(v); for (var k = 0; k < ks.length; k++) { var c = v[ks[k]]; if (c && typeof c === 'object') stack.push(c); } }
    }
    return n;
  }

  // 数の欄の値を見る。戻り値: 'ok'(そのまま)・数(この数に置き換える)・null(使えない)。
  function numCheck(v, convert) {
    if (typeof v === 'number') return (isFinite(v) && Math.abs(v) <= TIDY_MAX_ABS) ? 'ok' : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v);
      if (!isFinite(n) || Math.abs(n) > TIDY_MAX_ABS) return null;
      return convert ? n : 'ok';
    }
    return null;
  }

  function tidyPlan(plan) {
    var out = { changed: 0, dropped: { walls: 0, items: 0, rooms: 0 }, notes: [] };
    if (!isPlain(plan)) return out;
    var removedKeys = dropUnsafeKeys(plan);
    if (removedKeys) { out.changed += removedKeys; out.notes.push('危ない鍵を ' + removedKeys + ' 個消した'); }
    COLLECTIONS.forEach(function (name) {
      if (!Array.isArray(plan[name])) {
        if (plan[name] !== undefined && plan[name] !== null) out.notes.push(name + ' が配列でないので空にした');
        plan[name] = []; out.changed++;
        return;
      }
      var list = plan[name], kept = [];
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!isPlain(o)) { out.dropped[name]++; continue; }
        if (!tidyElement(name, o, out)) { out.dropped[name]++; continue; }
        kept.push(o);
      }
      if (kept.length !== list.length) {
        out.changed += list.length - kept.length;
        out.notes.push(name + ' から読めない物を ' + (list.length - kept.length) + ' 個捨てた');
        list.length = 0;
        for (var j = 0; j < kept.length; j++) list.push(kept[j]);
      }
    });
    Object.keys(TIDY_FIELDS).forEach(function (key) {
      if (!own(plan, key)) return;
      var v = plan[key];
      if (v === null) return;
      if (!isPlain(v)) { delete plan[key]; out.changed++; out.notes.push(key + ' が入れ物でないので消した'); return; }
      TIDY_FIELDS[key].forEach(function (inner) {
        var map = inner === '*' ? v : v[inner];
        if (inner !== '*' && !own(v, inner)) return;
        if (inner !== '*' && map !== null && !isPlain(map)) { delete v[inner]; out.changed++; return; }
        if (!map || TIDY_INNER_OBJECTS.indexOf(inner) >= 0) return;
        Object.keys(map).forEach(function (k) {
          if (map[k] !== null && !isPlain(map[k])) { delete map[k]; out.changed++; }
        });
      });
    });
    if (own(plan, 'floors') && plan.floors !== null && typeof plan.floors !== 'object') { delete plan.floors; out.changed++; }
    if (own(plan, 'northDeg') && plan.northDeg !== undefined && plan.northDeg !== null && numCheck(plan.northDeg, false) === null) {
      delete plan.northDeg; out.changed++;
    }
    if (typeof plan.planName === 'string' && plan.planName.length > TIDY_MAX_TEXT) {
      plan.planName = plan.planName.slice(0, TIDY_MAX_TEXT); out.changed++;
    }
    return out;
  }

  // 1つの物を直す。捨てるべき物なら false。
  function tidyElement(name, o, out) {
    if (typeof o.id === 'string' && TIDY_UNSAFE_IDS.indexOf(o.id) >= 0) return false;
    var coords = TIDY_COORDS[name];
    for (var i = 0; i < coords.length; i++) {
      var r = numCheck(o[coords[i]], true);
      if (r === null) return false;
      if (r !== 'ok') { o[coords[i]] = r; out.changed++; }
    }
    if (o.floor !== undefined && o.floor !== null) {
      var f = numCheck(o.floor, true);
      if (f === null) return false;
      var fv = f === 'ok' ? Number(o.floor) : f;
      if (fv < LIMITS.MIN_FLOOR || fv > LIMITS.MAX_FLOOR) return false;
      if (f !== 'ok') { o.floor = f; out.changed++; }
    }
    var opt = TIDY_OPTIONAL[name];
    for (var j = 0; j < opt.length; j++) {
      var k = opt[j];
      if (!own(o, k) || o[k] === undefined || o[k] === null) continue;
      if (numCheck(o[k], false) === null) { delete o[k]; out.changed++; }
    }
    var keys = Object.keys(o);
    for (var m = 0; m < keys.length; m++) {
      var s = o[keys[m]];
      if (typeof s === 'string' && s.length > TIDY_MAX_TEXT && s.slice(0, 5) !== 'data:') {
        o[keys[m]] = s.slice(0, TIDY_MAX_TEXT); out.changed++;
      }
    }
    return true;
  }

  // 丸ごと入れ替える前に、画面が扱える大きさかを見る。収まっていれば null、超えていれば利用者に見せる文。
  // 上限の根拠は LIMITS.MAX_LOAD_OBJECTS の注釈。
  function loadProblem(plan) {
    if (!isPlain(plan)) return 'プランの形が正しくないため、開けませんでした。';
    var total = 0;
    COLLECTIONS.forEach(function (name) { if (Array.isArray(plan[name])) total += plan[name].length; });
    if (total > LIMITS.MAX_LOAD_OBJECTS) {
      return 'このプランは大きすぎるため開けません。壁・部屋・物は合わせて ' + LIMITS.MAX_LOAD_OBJECTS + ' 個までです。';
    }
    return null;
  }

  return {
    LIMITS: LIMITS,
    COLLECTIONS: COLLECTIONS,
    validatePlan: validatePlan,
    normalizePlan: normalizePlan,
    summarize: summarize,
    tidyPlan: tidyPlan,
    TIDY_UNSAFE_IDS: TIDY_UNSAFE_IDS,
    loadProblem: loadProblem
  };
}));
