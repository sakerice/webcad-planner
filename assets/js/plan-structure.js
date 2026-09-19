// 壁から、家として成り立つのに要る構造部材を組み立てる。
//
// なぜ在るのか
// ------------
// 間取り図から起こしたプランに、**基礎も屋根も無かった**。AIに渡す
// 「使える種類」の一覧に foundation も roof も入れていなかったので、
// 出さなかったのではなく出すなと言っていたことになる。結果、出来上がるのは
// 「家」ではなく「壁の集まり」で、3Dに立てても屋根の無い箱だった。
//
// ただしこれは、AIに出させて直す話ではない。**基礎と屋根は壁から一意に
// 決まる**からである。
//
//   基礎 = 1階の壁の外形そのもの
//   屋根 = 最上階の壁の外形 + 軒の出
//
// 部屋を壁から計算したのと同じ考え方で、AIに頼むのは「図面にしか無い情報」
// だけにする。そうすれば、AIの出力が多少粗くても、出てくるものは常に
// このアプリの家として成立する。
//
// 敷地(site-rect)は作らない。**図面に描かれていないものを推測で置くと、
// 無いことより悪くなる。**（隣地との距離も道路の位置も分からないまま
// それらしい矩形を置いても、利用者はそれを信じてしまう）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanStructure = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // 軒の出(mm)。既定間取りと同じ。
  var EAVE_MM = 450;
  // 基礎の高さ(mm)。アプリの新規配置と同じ既定値。
  var FOUNDATION_HEIGHT_MM = 450;

  function footprint(walls, floor) {
    var mine = (walls || []).filter(function (w) {
      return w && (w.floor || 1) === floor &&
        [w.x1, w.y1, w.x2, w.y2].every(function (v) { return typeof v === 'number' && isFinite(v); });
    });
    if (!mine.length) return null;
    var xs = [], ys = [];
    mine.forEach(function (w) { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
  }

  function floorsOf(walls) {
    var set = Object.create(null);
    (walls || []).forEach(function (w) { if (w) set[w.floor || 1] = true; });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  // 壁から、足りない構造部材を作って返す。
  //
  // 返すのは「アプリのアイテムに渡す素の値」で、色やテクスチャの既定値は
  // 呼び出し側が mkItem を通して付ける。ここで既定値を二重に持たない。
  function structureFor(walls, options) {
    options = options || {};
    var out = [];
    var floors = floorsOf(walls);
    if (!floors.length) return out;

    // ── 基礎：1階の壁の外形そのもの ───────────────────────────────
    if (options.foundation !== false) {
      var base = footprint(walls, floors[0]);
      if (base) {
        out.push({
          type: 'foundation', floor: floors[0],
          x: base.x, y: base.y, w: base.w, d: base.d, rot: 0,
          foundationHeight: options.foundationHeightMm || FOUNDATION_HEIGHT_MM,
        });
      }
    }

    // ── 屋根：最上階の外形 + 軒の出 ───────────────────────────────
    //
    // 形は陸屋根にする。**図面に屋根伏図が無い以上、勾配屋根の向きも
    // 棟の位置も分からない。**分からないものを推測で置くより、平らな板を
    // 載せて「あとから利用者が選ぶ」ほうが害が小さい。
    if (options.roof !== false) {
      var top = footprint(walls, floors[floors.length - 1]);
      if (top) {
        var eave = options.eaveMm == null ? EAVE_MM : options.eaveMm;
        out.push({
          type: 'roof', floor: floors[floors.length - 1] + 1,
          x: top.x - eave, y: top.y - eave, w: top.w + eave * 2, d: top.d + eave * 2, rot: 0,
          roofType: 'flat', pitch: 5, roofThickness: 260, roofSkirt: 0, elev: 0,
        });
      }
    }
    return out;
  }

  // 読み取った結果に、何が足されたかを日本語で1行にする。利用者に見せる用。
  function describe(items) {
    var names = { foundation: '基礎', roof: '屋根（陸屋根）' };
    var made = (items || []).map(function (i) { return names[i.type] || i.type; });
    return made.length ? made.join('・') + 'は、壁の外形から自動で置きました' : '';
  }

  // 各階が同じ位置に重なっているか。
  //
  // 実測で、AIが**PDFの各ページを紙の上の位置のまま**並べたことがある
  // (1階 y=0..4095、2階 y=4095..8190、3階 y=8190..11830)。上下階が
  // 重ならないので、屋根も基礎もあらぬ位置に付く。見た目にはすぐ分かるが、
  // 数字だけ見ていると気づきにくいので、ここで検出する。
  function floorsOverlap(walls) {
    var floors = floorsOf(walls);
    if (floors.length < 2) return { ok: true, floors: floors };
    var boxes = floors.map(function (f) { return { floor: f, box: footprint(walls, f) }; })
      .filter(function (b) { return b.box; });
    if (boxes.length < 2) return { ok: true, floors: floors };
    var base = boxes[0].box;
    var bad = boxes.slice(1).filter(function (b) {
      // 下階とまったく重ならない = 積み上げている
      return b.box.x + b.box.w <= base.x || b.box.x >= base.x + base.w ||
             b.box.y + b.box.d <= base.y || b.box.y >= base.y + base.d;
    });
    return {
      ok: bad.length === 0,
      floors: floors,
      detached: bad.map(function (b) { return b.floor; }),
    };
  }

  return {
    structureFor: structureFor,
    floorsOverlap: floorsOverlap,
    footprint: footprint,
    floorsOf: floorsOf,
    describe: describe,
    EAVE_MM: EAVE_MM,
    FOUNDATION_HEIGHT_MM: FOUNDATION_HEIGHT_MM,
  };
}));
