// 通り芯と「升目の塗り分け」から、壁と部屋を組み立てる。
//
// なぜ在るのか
// ------------
// 壁の端点をAIに答えさせると、**位置は合っているのに伸ばし方が違う**という
// 失敗が残った。実測では、返ってきた壁13本のうち12本が通り芯にぴったり
// 載っていて、外していたのは「どこからどこまで引くか」だけだった。
//
// 壁の端点は、その壁が仕切っている部屋から決まるもので、独立した情報では
// ない。だから独立に答えさせるとずれる。
//
// では部屋を長方形で答えさせればよいかというと、それも足りない。実際の
// 図面には **L字の部屋** がある（試した図面の洋室がそうだった）。長方形
// ひとつでは表せず、分割して答えさせると今度は分割の仕方でずれる。
//
// そこで、通り芯で切った升目を1文字ずつ塗り分けてもらう。
//
//   gridX, gridY … 通り芯の座標(mm)
//   cells        … 1行1文字ずつの塗り分け。1文字 = 1升目
//   legend       … 文字 → 室名
//
// AIに要るのは「この升目はどの部屋か」という**その場で答えられる問い**だけに
// なる。形の分割も、座標の足し上げも要らない。壁は塗り分けの境目そのもの。
//
// 部屋・基礎・屋根を壁から計算しているのと同じ考え方を、壁にも当てた形。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanGrid = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  var DEFAULT_THICK_MM = 120;
  var OUTSIDE = '.';        // 建物の外。ここには床も壁も作らない
  // 升目の大きさ。4分の1間。日本の住宅の壁は、ほぼこの倍数の位置に立つ。
  // **通り芯をAIに選ばせるのはやめた。** 実測で、縦の通り芯を3本しか置かず、
  // その粗さでは収納も浴室も表せない塗り分けが返った。等間隔に固定すれば、
  // 升目の数は総寸法から決まり、選ぶ余地が無くなる。
  var MODULE_MM = 227.5;

  // 総寸法から、等間隔の通り芯を作る。
  function moduleGrid(total, moduleMm) {
    var m = Number(moduleMm) || MODULE_MM;
    var n = Math.round(Number(total) / m);
    if (!isFinite(n) || n < 1) return [];
    var out = [];
    for (var i = 0; i <= n; i++) out.push(i === n ? Number(total) : i * m);
    return out;
  }

  function numbers(list) {
    var out = (list || []).map(Number).filter(function (v) { return isFinite(v); });
    out.sort(function (a, b) { return a - b; });
    var uniq = [];
    for (var i = 0; i < out.length; i++) {
      if (!uniq.length || out[i] - uniq[uniq.length - 1] > 1) uniq.push(out[i]);
    }
    return uniq;
  }

  // 塗り分けを、升目の表に開く。
  // **行の長さが合わないのは見逃せない。** 1文字ずれると、その行から先の
  // 部屋の割り当てが全部ずれるのに、出来上がった間取りは一見それらしく見える。
  function readCells(cells, cols, rows) {
    var grid = [], problems = [];
    for (var j = 0; j < rows; j++) {
      var line = typeof (cells || [])[j] === 'string' ? cells[j] : '';
      if (line.length !== cols) {
        problems.push((j + 1) + '行目の升目が ' + line.length + ' 個（' + cols + ' 個のはず）');
      }
      var row = [];
      for (var i = 0; i < cols; i++) {
        var ch = i < line.length ? line[i] : OUTSIDE;
        row.push(ch === OUTSIDE || ch === ' ' ? null : ch);
      }
      grid.push(row);
    }
    if ((cells || []).length !== rows) {
      problems.push('塗り分けが ' + (cells || []).length + ' 行（' + rows + ' 行のはず）');
    }
    return { grid: grid, problems: problems };
  }

  // 部屋の範囲(ミリメートルの長方形)を升目に塗る。
  //
  // **文字を数えさせるのはやめた。** 実測で、32文字の行を6行続けて31文字で
  // 返した。1文字ずれると、その行から先の割り当てが全部ずれるのに、
  // 出来上がった間取りは一見それらしく見える。
  //
  // 代わりに「この部屋は x 2275 から 3185 まで」と、読み取った寸法の数値を
  // そのまま言ってもらう。数える作業が無くなる。升目への変換はここでやる。
  // スキップフロアの段差の上限。assets/js/app-constants.js の SKIP_LEVEL_MAX_MM と
  // 同じ値。ずれると、読み取りが通した段をアプリが黙って切り詰める。
  var SKIP_LEVEL_MAX_MM = 2400;

  function paintRects(gx, gy, rooms) {
    var cols = gx.length - 1, rows = gy.length - 1;
    var grid = [], j, i;
    for (j = 0; j < rows; j++) { grid.push(new Array(cols).fill(null)); }
    var problems = [], names = Object.create(null), levels = Object.create(null), uses = Object.create(null);
    // 升目の中心がその長方形に入っていれば塗る。境界のわずかなずれに強い。
    var cx = [], cy = [];
    for (i = 0; i < cols; i++) cx.push((gx[i] + gx[i + 1]) / 2);
    for (j = 0; j < rows; j++) cy.push((gy[j] + gy[j + 1]) / 2);

    (rooms || []).forEach(function (r, idx) {
      if (!r || typeof r !== 'object') return;
      var key = String.fromCharCode(65 + (idx % 26)) + (idx >= 26 ? String(Math.floor(idx / 26)) : '');
      names[key] = r.name == null ? '' : String(r.name);
      // スキップフロア(その区画ごと床も天井も上がる段差)。アプリ側の
      // room.skipLevelMm と同じもので、上限も揃えてある。
      // **省略と 0 は区別しない。** 段が無い部屋がほとんどなので、
      // 持っていない部屋は 0 として扱えばよい。
      var lv = Number(r.level);
      levels[key] = (isFinite(lv) && lv > 0) ? Math.min(Math.round(lv), SKIP_LEVEL_MAX_MM) : 0;
      // 図面を見ている側が判断した用途。名前だけで決まらない語のために持つ。
      if (typeof r.use === 'string' && r.use) uses[key] = r.use;
      var parts = Array.isArray(r.parts) ? r.parts : [r];
      var painted = 0, clash = 0;
      parts.forEach(function (q) {
        if (!q) return;
        var x0 = Math.min(Number(q.x0), Number(q.x1)), x1 = Math.max(Number(q.x0), Number(q.x1));
        var y0 = Math.min(Number(q.y0), Number(q.y1)), y1 = Math.max(Number(q.y0), Number(q.y1));
        if (![x0, x1, y0, y1].every(isFinite) || x1 - x0 < 1 || y1 - y0 < 1) return;
        for (var jj = 0; jj < rows; jj++) {
          if (cy[jj] < y0 || cy[jj] > y1) continue;
          for (var ii = 0; ii < cols; ii++) {
            if (cx[ii] < x0 || cx[ii] > x1) continue;
            if (grid[jj][ii] !== null && grid[jj][ii] !== key) clash++;
            grid[jj][ii] = key; painted++;
          }
        }
      });
      if (!painted) problems.push('「' + (names[key] || '名前なし') + '」の範囲が升目に載らない');
      if (clash) problems.push('「' + (names[key] || '名前なし') + '」が他の部屋と ' + clash + ' マス重なっている');
    });
    return { grid: grid, names: names, levels: levels, uses: uses, problems: problems };
  }

  // 隣り合う升目の持ち主が違えば、そこが壁。外側との境も壁。
  function wallsFrom(gx, gy, grid, floor, thick) {
    var cols = gx.length - 1, rows = gy.length - 1;
    var at = function (ix, iy) {
      if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) return null;
      return grid[iy][ix];
    };
    var walls = [];
    for (var i = 0; i <= cols; i++) {           // 縦の壁
      var run = null;
      for (var j = 0; j < rows; j++) {
        var a = at(i - 1, j), b = at(i, j);
        if (a !== b && (a !== null || b !== null)) {
          if (run) run.y2 = gy[j + 1];
          else run = { x1: gx[i], y1: gy[j], x2: gx[i], y2: gy[j + 1] };
        } else if (run) { walls.push(run); run = null; }
      }
      if (run) walls.push(run);
    }
    for (var j2 = 0; j2 <= rows; j2++) {        // 横の壁
      var run2 = null;
      for (var i2 = 0; i2 < cols; i2++) {
        var a2 = at(i2, j2 - 1), b2 = at(i2, j2);
        if (a2 !== b2 && (a2 !== null || b2 !== null)) {
          if (run2) run2.x2 = gx[i2 + 1];
          else run2 = { x1: gx[i2], y1: gy[j2], x2: gx[i2 + 1], y2: gy[j2] };
        } else if (run2) { walls.push(run2); run2 = null; }
      }
      if (run2) walls.push(run2);
    }
    return walls.map(function (w) {
      return { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thick: thick, floor: floor };
    });
  }

  // 同じ文字でつながった升目を、長方形に切り分ける。
  // アプリの部屋は長方形なので、L字の部屋は複数の長方形になる。
  function rectsOf(grid, cols, rows, key) {
    var used = [];
    for (var j = 0; j < rows; j++) { used.push(new Array(cols).fill(false)); }
    var out = [];
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        if (used[y][x] || grid[y][x] !== key) continue;
        // 右へ伸ばせるだけ伸ばし、次に下へ伸ばせるだけ伸ばす
        var x1 = x;
        while (x1 + 1 < cols && !used[y][x1 + 1] && grid[y][x1 + 1] === key) x1++;
        var y1 = y;
        for (var yy = y + 1; yy < rows; yy++) {
          var ok = true;
          for (var xx = x; xx <= x1; xx++) {
            if (used[yy][xx] || grid[yy][xx] !== key) { ok = false; break; }
          }
          if (!ok) break;
          y1 = yy;
        }
        for (var a = y; a <= y1; a++) for (var b = x; b <= x1; b++) used[a][b] = true;
        out.push({ x0: x, x1: x1 + 1, y0: y, y1: y1 + 1 });
      }
    }
    return out;
  }

  function legendMap(legend) {
    var map = Object.create(null);
    if (Array.isArray(legend)) {
      legend.forEach(function (e) {
        if (e && typeof e === 'object' && e.key) map[String(e.key)[0]] = String(e.name == null ? '' : e.name);
      });
    } else if (legend && typeof legend === 'object') {
      Object.keys(legend).forEach(function (k) { map[k[0]] = String(legend[k] == null ? '' : legend[k]); });
    }
    return map;
  }

  // 1階ぶんを組み立てる。
  function build(spec) {
    spec = spec || {};
    // 総寸法が来ていれば、通り芯は等間隔で作る。gridX/gridY の指定は
    // 古い形のために残してあるだけで、本筋は総寸法のほう。
    var gx = spec.width ? moduleGrid(spec.width, spec.moduleMm) : numbers(spec.gridX);
    var gy = spec.depth ? moduleGrid(spec.depth, spec.moduleMm) : numbers(spec.gridY);
    var floor = Number(spec.floor) || 1;
    var thick = Number(spec.thick) || DEFAULT_THICK_MM;
    if (gx.length < 2 || gy.length < 2) {
      return { walls: [], rooms: [], problems: ['通り芯が足りない（縦' + gx.length + '本 横' + gy.length + '本）'] };
    }
    var cols = gx.length - 1, rows = gy.length - 1;
    var read, names, levels, uses;
    if (Array.isArray(spec.rooms) && spec.rooms.length) {
      var painted = paintRects(gx, gy, spec.rooms);
      read = { grid: painted.grid, problems: painted.problems };
      names = painted.names;
      levels = painted.levels;
      uses = painted.uses;
    } else {
      read = readCells(spec.cells, cols, rows);
      names = legendMap(spec.legend);
      levels = Object.create(null);
      uses = Object.create(null);
    }
    var walls = wallsFrom(gx, gy, read.grid, floor, thick);

    var keys = Object.create(null);
    read.grid.forEach(function (row) { row.forEach(function (ch) { if (ch) keys[ch] = true; }); });
    var rooms = [];
    Object.keys(keys).forEach(function (k) {
      rectsOf(read.grid, cols, rows, k).forEach(function (r) {
        var made = {
          n: names[k] === undefined ? '' : names[k], floor: floor,
          x: gx[r.x0], y: gy[r.y0], w: gx[r.x1] - gx[r.x0], d: gy[r.y1] - gy[r.y0],
        };
        // **段のある部屋だけが持つ。** 0 を全部屋に書くと、この欄を持たない
        // 既存プランとの差が生まれる。
        if (levels[k]) made.skipLevelMm = levels[k];
        if (uses[k]) made.use = uses[k];
        rooms.push(made);
      });
    });
    var problems = read.problems.slice();
    Object.keys(keys).forEach(function (k) {
      if (names[k] === undefined) problems.push('塗り分けの "' + k + '" が室名の対応表に無い');
    });
    return { walls: walls, rooms: rooms, problems: problems, gridX: gx, gridY: gy, grid: read.grid };
  }

  // 読み取り結果(階の並び)から、壁と部屋をまとめて作る。
  //
  // 読み取りの経路は3つある(worker / 画面 / 計測用のコマンド)。同じ組み立てを
  // 3か所に書くと、直したつもりの経路だけ直って残りが古いまま、という形の
  // 不具合になる。**組み立てはここ1か所**にする。
  function buildFloors(floors, options) {
    options = options || {};
    var out = { walls: [], rooms: [], problems: [] };
    (floors || []).forEach(function (f) {
      if (!f) return;
      var one = build({
        width: f.width, depth: f.depth, moduleMm: options.moduleMm,
        rooms: f.rooms, gridX: f.gridX, gridY: f.gridY, cells: f.cells, legend: f.legend,
        floor: f.floor, thick: options.thick,
      });
      one.problems.forEach(function (m) { out.problems.push((f.floor || 1) + '階: ' + m); });
      out.walls.push.apply(out.walls, one.walls);
      out.rooms.push.apply(out.rooms, one.rooms);
    });
    return out;
  }

  return {
    build: build,
    buildFloors: buildFloors,
    moduleGrid: moduleGrid,
    OUTSIDE: OUTSIDE,
    MODULE_MM: MODULE_MM,
    DEFAULT_THICK_MM: DEFAULT_THICK_MM,
  };
}));
