// 壁から部屋を求める。
//
// なぜ在るのか
// ------------
// 間取り図の読み取りで、AIに「壁」と「部屋」の両方を出させていた。
// この2つは本来同じ情報なので、**食い違う**。同じ図面で部屋が3〜9個に
// 変動し、浴室や玄関が落ちたり入ったりしていた。
//
// 壁が正しく読めているなら、囲まれた領域は計算で求まる。AIには線と文字を
// 読ませ、領域の切り出しはこちらでやる。そうすれば壁と部屋は必ず一致する。
//
// やり方
// ------
//   1. 壁の端点の x と y を集めて、通り芯の格子を作る
//   2. 格子の升ごとに、四辺が壁でふさがれているかを見る
//   3. ふさがれていない辺でつながる升をひとまとめにする（連結領域）
//   4. 外周の外につながる領域は屋外なので捨てる
//   5. 領域の中にある文字を、その領域の名前にする
//   6. 領域を長方形に切り分ける（アプリの部屋は長方形1つなので）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanRooms = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // 座標の突き合わせに使う許容値(mm)。AIが返す座標は1mm単位で揃うとは限らない。
  var TOL = 30;
  // これより小さい升は、壁の厚みぶんの隙間とみなして部屋にしない。
  var MIN_CELL_MM = 200;
  // これより小さい領域は部屋として扱わない(壁の間の隙間など)。
  var MIN_ROOM_AREA_MM2 = 400000;   // 0.4 m²

  // 日本の住宅の寸法は 227.5mm（455の半分＝4分の1間）の倍数にほぼ必ず乗る。
  // 910=×4 / 1365=×6 / 1820=×8 / 2275=×10 / 1137.5=×5 / 455=×2 / 227.5=×1。
  //
  // 図面の細かい数字は読み違いが起きる。実測で 227.5→275、455→450 の
  // 読み違いを確認した。どちらも倍数から数十mm外れるだけなので、
  // **近ければ倍数へ寄せる**。遠いものは触らない（本当に半端な寸法のことも
  // あるので、無理に寄せると逆に壊す）。
  var MODULE_MM = 227.5;
  function snapToModule(value, tolerance) {
    if (typeof value !== 'number' || !isFinite(value)) return value;
    var snapped = Math.round(value / MODULE_MM) * MODULE_MM;
    return Math.abs(snapped - value) <= tolerance ? snapped : value;
  }

  // 壁の端点をモジュールへ寄せる。部屋は壁から作るので、ここが揃えば
  // 部屋の境界も揃う。
  function snapWalls(walls, tolerance) {
    // 50mm。モジュールの間隔が227.5mmなので、数直線の44%を拾う。攻めた値だが、
    // 日本の住宅は寸法がモジュールに乗るのが原則なので実害より利が大きい。
    // 実測の読み違い(227.5→275 は47.5mmのずれ)を拾うにはここまで要る。
    if (tolerance == null) tolerance = 50;
    return (walls || []).map(function (w) {
      var c = {};
      Object.keys(w).forEach(function (k) { c[k] = w[k]; });
      ['x1', 'y1', 'x2', 'y2'].forEach(function (k) { c[k] = snapToModule(w[k], tolerance); });
      return c;
    });
  }

  function uniqSorted(values) {
    var out = [];
    values.slice().sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (!out.length || Math.abs(v - out[out.length - 1]) > TOL) out.push(v);
    });
    return out;
  }

  function near(a, b) { return Math.abs(a - b) <= TOL; }

  // 線分 (x1,y1)-(x2,y2) が、軸に沿った区間 [from,to] を覆っているか。
  // 壁は芯線なので、升の辺とぴったり重なる想定。
  function coversSegment(wall, fixedAxis, fixedValue, from, to) {
    var x1 = wall.x1, y1 = wall.y1, x2 = wall.x2, y2 = wall.y2;
    if (fixedAxis === 'y') {
      if (!near(y1, fixedValue) || !near(y2, fixedValue)) return false;
      var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
      return lo <= from + TOL && hi >= to - TOL;
    }
    if (!near(x1, fixedValue) || !near(x2, fixedValue)) return false;
    var lo2 = Math.min(y1, y2), hi2 = Math.max(y1, y2);
    return lo2 <= from + TOL && hi2 >= to - TOL;
  }

  // ── 主処理 ────────────────────────────────────────────────────────
  //
  // walls  : [{x1,y1,x2,y2,floor}, ...]（芯線）
  // labels : [{text,x,y,floor}, ...]（図に書かれた部屋名とその位置）
  // 戻り値 : [{x,y,w,d,n,floor}, ...]
  function roomsFromWalls(walls, labels, options) {
    options = options || {};
    var floor = options.floor || 1;
    var mine = (walls || []).filter(function (w) {
      return w && (w.floor || 1) === floor &&
        [w.x1, w.y1, w.x2, w.y2].every(function (v) { return typeof v === 'number' && isFinite(v); });
    });
    if (options.snap !== false) mine = snapWalls(mine, options.snapTolerance);
    if (mine.length < 4) return [];

    // 1. 通り芯の格子
    var xs = uniqSorted(mine.reduce(function (a, w) { return a.concat([w.x1, w.x2]); }, []));
    var ys = uniqSorted(mine.reduce(function (a, w) { return a.concat([w.y1, w.y2]); }, []));
    if (xs.length < 2 || ys.length < 2) return [];

    var cols = xs.length - 1, rows = ys.length - 1;
    // 2〜3. 升の四辺がふさがれているかを見て、つながりをたどる
    //
    // 升を1つ余分に外側へ広げて「屋外」の升を作る。屋外からたどり着ける
    // 領域は外なので捨てられる。外周に隙間があっても、そこが屋外と
    // つながるだけで、内側の部屋は壊れない。
    var W = cols + 2, H = rows + 2;
    var id = new Int32Array(W * H).fill(-1);

    function blocked(cx, cy, dir) {
      // cx,cy は「余分な外枠を含む」座標。実際の升は 1..cols / 1..rows。
      var x0, x1, y0, y1;
      if (dir === 'up' || dir === 'down') {
        var yIndex = dir === 'up' ? cy - 1 : cy;          // 升の上辺 / 下辺
        if (yIndex < 0 || yIndex > rows) return false;    // 外枠の外側は素通し
        if (cx - 1 < 0 || cx - 1 >= cols) return false;
        x0 = xs[cx - 1]; x1 = xs[cx]; y0 = ys[yIndex];
        return mine.some(function (w) { return coversSegment(w, 'y', y0, x0, x1); });
      }
      var xIndex = dir === 'left' ? cx - 1 : cx;
      if (xIndex < 0 || xIndex > cols) return false;
      if (cy - 1 < 0 || cy - 1 >= rows) return false;
      y0 = ys[cy - 1]; y1 = ys[cy]; x0 = xs[xIndex];
      return mine.some(function (w) { return coversSegment(w, 'x', x0, y0, y1); });
    }

    var next = 0, regions = [];
    for (var sy = 0; sy < H; sy++) {
      for (var sx = 0; sx < W; sx++) {
        if (id[sy * W + sx] >= 0) continue;
        var rid = next++;
        var cells = [];
        var stack = [[sx, sy]];
        id[sy * W + sx] = rid;
        while (stack.length) {
          var cur = stack.pop();
          var cx = cur[0], cy = cur[1];
          cells.push([cx, cy]);
          [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]].forEach(function (step) {
            var nx = cx + step[1], ny = cy + step[2];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
            if (id[ny * W + nx] >= 0) return;
            if (blocked(cx, cy, step[0])) return;
            id[ny * W + nx] = rid;
            stack.push([nx, ny]);
          });
        }
        regions.push(cells);
      }
    }

    // 4. 屋外につながる領域を捨てる
    var outsideId = id[0];
    var out = [];
    regions.forEach(function (cells, rid) {
      if (rid === outsideId) return;
      // 外枠の升だけで出来た領域も屋外
      var inner = cells.filter(function (c) { return c[0] >= 1 && c[0] <= cols && c[1] >= 1 && c[1] <= rows; });
      if (!inner.length) return;

      // 6. 長方形に切り分ける
      rectanglesOf(inner, xs, ys).forEach(function (rect) {
        if (rect.w * rect.d < MIN_ROOM_AREA_MM2) return;
        out.push(rect);
      });
    });

    // 5. 領域の中にある文字を名前にする
    (labels || []).forEach(function (label) {
      if (!label || (label.floor || 1) !== floor) return;
      var hit = out.find(function (r) {
        return label.x >= r.x && label.x <= r.x + r.w && label.y >= r.y && label.y <= r.y + r.d;
      });
      if (hit && !hit.n) hit.n = String(label.text || '');
    });
    out.forEach(function (r) { r.n = r.n || ''; r.floor = floor; });
    return out;
  }

  // 升の集まりを長方形に切り分ける。
  //
  // アプリの部屋は長方形1つなので、L字の領域は複数の部屋に分かれる
  // (名前は同じものが付く)。欲張って最小個数を狙わず、**横に伸ばせるだけ
  // 伸ばして、縦に積めるだけ積む**という素直なやり方にしてある。
  // 部屋の形が少し細切れになっても、利用者が後で結合できる。
  function rectanglesOf(cells, xs, ys) {
    var have = Object.create(null);
    cells.forEach(function (c) { have[c[0] + ',' + c[1]] = true; });
    var used = Object.create(null);
    var rects = [];
    cells.slice().sort(function (a, b) { return (a[1] - b[1]) || (a[0] - b[0]); }).forEach(function (c) {
      var key = c[0] + ',' + c[1];
      if (used[key]) return;
      // 横へ伸ばす
      var w = 1;
      while (have[(c[0] + w) + ',' + c[1]] && !used[(c[0] + w) + ',' + c[1]]) w++;
      // その幅のまま下へ積む
      var h = 1;
      for (;;) {
        var ok = true;
        for (var i = 0; i < w; i++) {
          var k = (c[0] + i) + ',' + (c[1] + h);
          if (!have[k] || used[k]) { ok = false; break; }
        }
        if (!ok) break;
        h++;
      }
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) used[(c[0] + xx) + ',' + (c[1] + yy)] = true;
      var x0 = xs[c[0] - 1], x1 = xs[c[0] - 1 + w];
      var y0 = ys[c[1] - 1], y1 = ys[c[1] - 1 + h];
      if (x1 - x0 < MIN_CELL_MM || y1 - y0 < MIN_CELL_MM) return;
      rects.push({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, n: '' });
    });
    return rects;
  }

  return {
    roomsFromWalls: roomsFromWalls,
    snapToModule: snapToModule,
    snapWalls: snapWalls,
    MODULE_MM: MODULE_MM,
    TOL: TOL,
    MIN_ROOM_AREA_MM2: MIN_ROOM_AREA_MM2,
  };
}));
