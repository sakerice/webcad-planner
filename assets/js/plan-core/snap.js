// 吸着(格子・物の端・階段の出入り口)の計算。画面にも Worker にも依存しない。
//
// 今まで assets/js/app-state.js の snapRectOriginToGrid / getEdgeCandidates / applyEdgeSnap と、
// index.html の stairSnapPosition に書いてあったものを、そのまま移した。
// 外の世界(今の階、格子の幅、閾値、階段の辺の求め方)は、すべて引数で受ける。
// 画面の関数は、グローバルを引数に詰めてここを呼ぶだけの包みになっている。
// 計算の順番・比較の向き(< と <=)は画面の操作感そのものなので、変えてはいけない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanCoreSnap = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // 画面の isPlanAnnotationType と同じ既定。画面からは実物を opts で渡す。
  function defaultIsAnnotationType(type) {
    return type === 'memo' || type === 'ruler' || type === 'walk-route';
  }
  // 画面の wallThicknessMm と同じ既定。
  function defaultWallThickness(w) {
    var t = Number(w && w.thick);
    return isFinite(t) && t > 0 ? t : 120;
  }
  // 画面の isStairPartType と同じ既定。
  function defaultIsStairPart(type) {
    return type === 'stair' || type === 'stair-corner' || type === 'stair-landing';
  }
  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }
  // opts を省いて呼ばれたとき(Worker・Node)の既定。画面の EDGE_SNAP_THRESH・STAIR_SNAP_MM と同じ値。
  var DEFAULT_EDGE_THRESHOLD = 80;
  var DEFAULT_STAIR_RADIUS = 250;
  function numberOr(v, fallback) {
    return isFiniteNumber(v) ? v : fallback;
  }

  // 回転した矩形の外接の上下左右と中心。x,y は回転前の矩形の北西角。
  function rectSnapBounds(x, y, w, d, rot) {
    var cx = x + w / 2, cy = y + d / 2, rad = (rot || 0) * Math.PI / 180;
    var ex = Math.abs(Math.cos(rad)) * w / 2 + Math.abs(Math.sin(rad)) * d / 2;
    var ey = Math.abs(Math.sin(rad)) * w / 2 + Math.abs(Math.cos(rad)) * d / 2;
    return { left: cx - ex, right: cx + ex, top: cy - ey, bottom: cy + ey, cx: cx, cy: cy };
  }

  function nearestAxisDelta(values, candidates, thresh) {
    var best = null, min = thresh;
    values.forEach(function (v) {
      candidates.forEach(function (c) {
        var delta = c - v, dist = Math.abs(delta);
        if (dist < min) { min = dist; best = { delta: delta, target: c }; }
      });
    });
    return best;
  }

  // 物の外接の辺(左右・上下)が格子に乗るよう、原点をずらす。step が 0 なら動かさない。
  function snapRectOriginToGrid(x, y, w, d, rot, step) {
    step = Number(step) || 0;
    if (!step) return { x: x, y: y };
    var b = rectSnapBounds(x, y, w, d, rot);
    function gridDelta(values) {
      var best = null, min = Infinity;
      values.forEach(function (v) {
        var delta = Math.round(v / step) * step - v, dist = Math.abs(delta);
        if (dist < min) { min = dist; best = delta; }
      });
      return best || 0;
    }
    // 保存される原点や中心ではなく、見えている辺を格子へ乗せる。
    return { x: x + gridDelta([b.left, b.right]), y: y + gridDelta([b.top, b.bottom]) };
  }

  // 吸い付く先の候補。opts: { floor, excludeIds, isAnnotationType?, wallThickness? }
  // excludeIds に入っている id の物は候補にしない(画面の「it.id !== excludeId」と同じく === で比べる)。
  function edgeCandidates(plan, opts) {
    opts = opts || {};
    var ex = {}, ey = {}, cx = {}, cy = {};  // 辺と中心は別々に重複を除く
    var fl = opts.floor;
    var excl = opts.excludeIds || [];
    var isAnno = opts.isAnnotationType || defaultIsAnnotationType;
    var thick = opts.wallThickness || defaultWallThickness;
    (plan.items || []).filter(function (it) {
      return it.floor === fl && excl.indexOf(it.id) < 0 && it.type !== 'site-rect' && !isAnno(it.type);
    }).forEach(function (it) {
      if (!isFiniteNumber(it.x) || !isFiniteNumber(it.y) || !isFiniteNumber(it.w) || !isFiniteNumber(it.d)) return;
      var b = rectSnapBounds(it.x, it.y, it.w, it.d, it.rot || 0);
      [b.left, b.right].forEach(function (v) { ex[Math.round(v)] = v; });
      [b.top, b.bottom].forEach(function (v) { ey[Math.round(v)] = v; });
      cx[Math.round(b.cx)] = b.cx; cy[Math.round(b.cy)] = b.cy;
    });
    (plan.rooms || []).filter(function (r) { return r.floor === fl; }).forEach(function (r) {
      [r.x, r.x + r.w].forEach(function (v) { ex[Math.round(v)] = v; });
      [r.y, r.y + r.d].forEach(function (v) { ey[Math.round(v)] = v; });
      cx[Math.round(r.x + r.w / 2)] = r.x + r.w / 2; cy[Math.round(r.y + r.d / 2)] = r.y + r.d / 2;
    });
    (plan.walls || []).filter(function (w) { return w.floor === fl; }).forEach(function (w) {
      var half = thick(w) / 2;
      if (Math.abs(w.x2 - w.x1) < Math.abs(w.y2 - w.y1)) {
        var wx = (w.x1 + w.x2) / 2;
        [wx - half, wx + half].forEach(function (v) { ex[Math.round(v)] = v; });
        cx[Math.round(wx)] = wx;
        [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)].forEach(function (v) { ey[Math.round(v)] = v; });
      } else {
        var wy = (w.y1 + w.y2) / 2;
        [wy - half, wy + half].forEach(function (v) { ey[Math.round(v)] = v; });
        cy[Math.round(wy)] = wy;
        [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)].forEach(function (v) { ex[Math.round(v)] = v; });
      }
    });
    return {
      edgeX: Object.values(ex), edgeY: Object.values(ey),
      centerX: Object.values(cx), centerY: Object.values(cy),
      // 大きさを変えるときの吸着は、中心線ではなく物の辺だけを使う。
      x: Object.values(ex), y: Object.values(ey)
    };
  }

  // 物の端・中心への吸着。rect: { x, y, w, d, rot }。
  // opts: { floor, threshold?(既定 80), excludeIds, isAnnotationType?, wallThickness? }
  // 戻り値は { x, y, snapX, snapXVal, snapY, snapYVal }(画面は snapX.. を補助線の表示に使う)。
  function edgeSnap(rect, plan, opts) {
    opts = opts || {};
    var x = rect.x, y = rect.y;
    var thresh = numberOr(opts.threshold, DEFAULT_EDGE_THRESHOLD);
    var cands = edgeCandidates(plan, opts);
    var b = rectSnapBounds(x, y, rect.w, rect.d, rect.rot || 0);
    // 閾値の内なら、辺どうしの吸着がいつも勝つ。
    var bestX = nearestAxisDelta([b.left, b.right], cands.edgeX, thresh);
    var bestY = nearestAxisDelta([b.top, b.bottom], cands.edgeY, thresh);
    // 辺が合わないときだけ、中心どうしにそろえる。
    if (!bestX) bestX = nearestAxisDelta([b.cx], cands.centerX, thresh);
    if (!bestY) bestY = nearestAxisDelta([b.cy], cands.centerY, thresh);
    return {
      x: bestX ? x + bestX.delta : x, y: bestY ? y + bestY.delta : y,
      snapX: !!bestX, snapXVal: bestX ? bestX.target : null,
      snapY: !!bestY, snapYVal: bestY ? bestY.target : null
    };
  }

  // 動かしている階段の部材を、近くの部材の出入り口へ吸い付ける(平面 mm)。
  // 出入り口の辺どうしが向き合い、隙間が radius 以内なら隙間を 0 にし、
  // 辺に沿ったずれも近ければ、中心どうし・片側の端どうしのどちらか近い方にそろえる。
  // opts: { radius?(既定 250), partEdges(item) → 辺の配列, minSpan?(既定 100), isStairPart? }
  // partEdges には既定が無い(辺の求め方は画面の stairPartEdgesMm が正本)。渡されなければ投げる。
  // 吸い付けば { x, y, score, other }、吸い付かなければ { x, y } を返す。
  function stairSnap(item, x, y, plan, opts) {
    opts = opts || {};
    if (typeof opts.partEdges !== 'function') {
      throw new Error('PlanCoreSnap.stairSnap: opts.partEdges(item) に階段の辺を返す関数を渡してください');
    }
    var isStair = opts.isStairPart || defaultIsStairPart;
    if (!item || !isStair(item.type)) return { x: x, y: y };
    var radius = numberOr(opts.radius, DEFAULT_STAIR_RADIUS);
    var minSpan = opts.minSpan !== undefined ? opts.minSpan : 100;
    var partEdges = opts.partEdges;
    var probe = Object.assign({}, item, { x: x, y: y });
    var mine = partEdges(probe).filter(function (e) { return e.role !== 'side'; });
    var best = null, fl = item.floor || 1;
    (plan.items || []).forEach(function (o) {
      if (o === item || (o.floor || 1) !== fl || !isStair(o.type) || (item.id !== undefined && o.id === item.id)) return;
      partEdges(o).forEach(function (eo) {
        if (eo.role === 'side') return;
        mine.forEach(function (e) {
          if (e.len < 1 || e.n.x * eo.n.x + e.n.y * eo.n.y > -0.97) return;
          var ex = (e.a.x + e.b.x) / 2, ey = (e.a.y + e.b.y) / 2, mx = (eo.a.x + eo.b.x) / 2, my = (eo.a.y + eo.b.y) / 2;
          var gap = (mx - ex) * e.n.x + (my - ey) * e.n.y;
          if (Math.abs(gap) > radius) return;
          var ux = (e.b.x - e.a.x) / e.len, uy = (e.b.y - e.a.y) / e.len;
          var lat = (mx - ex) * ux + (my - ey) * uy;
          if (Math.abs(lat) > (e.len + eo.len) / 2 - minSpan) return;
          var half = (eo.len - e.len) / 2, al = null;
          [lat, lat - half, lat + half].forEach(function (v) { if (Math.abs(v) <= radius && (al === null || Math.abs(v) < Math.abs(al))) al = v; });
          var dx = gap * e.n.x + (al !== null ? al * ux : 0), dy = gap * e.n.y + (al !== null ? al * uy : 0);
          var score = Math.abs(gap) + (al !== null ? Math.abs(al) * 0.5 : radius);
          if (!best || score < best.score) best = { x: x + dx, y: y + dy, score: score, other: o };
        });
      });
    });
    return best || { x: x, y: y };
  }

  return {
    rectSnapBounds: rectSnapBounds,
    snapRectOriginToGrid: snapRectOriginToGrid,
    edgeCandidates: edgeCandidates,
    edgeSnap: edgeSnap,
    stairSnap: stairSnap
  };
}));
