// 読み取った結果を、平面図として描き直す。
//
// なぜ在るのか
// ------------
// 読み取りは、これまで **投げて一度答えを受け取るだけ**だった。モデルは自分の
// 書いた座標が間取りとしてどう見えるかを一度も見ていない。
//
// 残っていた誤りは、数字の列で見ると気づけないが、絵にすると一目で分かる
// 種類のものだった（実測）:
//
//   洗面所が455mm高く、隣の部屋へ食い込んでいる
//   玄関が隣の部屋に飲み込まれて消えている
//   2階の奥行きだけ 4,170mm（正しくは 4,095mm）で、1階と輪郭が合わない
//
// そこで、答えをこちらで描いて、元の図面と並べてもう一度見せる。
// 描くのは **モデルが答えたものそのもの**（部屋の長方形と、置いた物）で、
// アプリが後から組み立てた壁ではない。見せる相手は、自分の答えを直す本人で
// あって、アプリの出来ばえを評価する人ではない。
//
// 画素を持っているのはブラウザだけ（Cloudflare Workers に canvas は無い）なので、
// ここは画面側に置く。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanReviewDraw = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  // 1階ぶんの長辺。寸法の文字が読める大きさがあればよく、元の図面ほどの
  // 解像度は要らない（読むのは自分が書いた数字の裏取りだから）。
  var FLOOR_PX = 1200;
  var PAD = 96;          // 寸法線と階の見出しを置く余白(画素)
  var GAP = 48;          // 同じページに複数の階があるときの間隔

  // 種類の日本語。**ALLOWED_ITEM_TYPES と過不足なく一致させる。**
  // tools/tests/plan-review-draw.test.cjs が一致を検査している。
  var JA = {
    'window': '窓', 'window-door': '掃出窓', 'door-swing': '開き戸',
    'door-slide-s': '引戸', 'door-fold': '折戸', 'door-opening': '開口',
    'door-front': '玄関ドア',
    'stair': '階段', 'stair-corner': '廻り',
    'bath': '浴槽', 'toilet': '便器', 'sink': '洗面台', 'kitchen': '流し台',
    'balcony': 'バルコニー'
  };
  // 既定寸法。d が省かれて返ることがあるので、そのときはここから補う。
  var SIZES = {
    'window': { w: 1650, d: 150 }, 'window-door': { w: 1650, d: 180 },
    'door-swing': { w: 780, d: 780 }, 'door-slide-s': { w: 780, d: 150 },
    'door-fold': { w: 780, d: 420 }, 'door-opening': { w: 780, d: 160 },
    'door-front': { w: 940, d: 200 },
    'stair': { w: 910, d: 2730 }, 'stair-corner': { w: 910, d: 910 },
    'bath': { w: 1600, d: 1600 }, 'toilet': { w: 380, d: 680 },
    'sink': { w: 750, d: 560 }, 'kitchen': { w: 2550, d: 650 },
    'balcony': { w: 1820, d: 910 }
  };
  // 色で役割を分ける。開口・階段・設備は、間違え方がそれぞれ違う。
  var COLOR = {
    opening: '#c0392b', stair: '#1d4ed8', fixture: '#047857', outdoor: '#7c3aed'
  };
  function groupOf(type) {
    if (type === 'stair' || type === 'stair-corner') return 'stair';
    if (type === 'balcony') return 'outdoor';
    if (type === 'bath' || type === 'toilet' || type === 'sink' || type === 'kitchen') return 'fixture';
    return 'opening';
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function partsOf(room) { return (room && Array.isArray(room.parts)) ? room.parts : []; }

  // 階の外形。width/depth が抜けていても、部屋の広がりから描けるようにする。
  function extentOf(floor) {
    var w = num(floor && floor.width), d = num(floor && floor.depth);
    var rooms = (floor && Array.isArray(floor.rooms)) ? floor.rooms : [];
    rooms.forEach(function (r) {
      partsOf(r).forEach(function (p) {
        w = Math.max(w, num(p.x1)); d = Math.max(d, num(p.y1));
      });
    });
    return { w: w || 1, d: d || 1 };
  }

  // 部屋の名前を置く場所。いちばん広い長方形の真ん中。
  function biggestPart(room) {
    var best = null, area = -1;
    partsOf(room).forEach(function (p) {
      var a = Math.abs(num(p.x1) - num(p.x0)) * Math.abs(num(p.y1) - num(p.y0));
      if (a > area) { area = a; best = p; }
    });
    return best;
  }

  function drawRooms(ctx, floor, s) {
    var rooms = (floor && Array.isArray(floor.rooms)) ? floor.rooms : [];
    rooms.forEach(function (room) {
      partsOf(room).forEach(function (p) {
        var x = num(p.x0) * s, y = num(p.y0) * s;
        var w = (num(p.x1) - num(p.x0)) * s, h = (num(p.y1) - num(p.y0)) * s;
        ctx.fillStyle = '#eef2f7';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      });
      var big = biggestPart(room);
      if (!big) return;
      var cx = (num(big.x0) + num(big.x1)) / 2 * s;
      var cy = (num(big.y0) + num(big.y1)) / 2 * s;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(String(room.name || '(名前なし)'), cx, cy - 12);
      ctx.font = '15px sans-serif';
      // 長方形が複数あるなら、その数も出す。L字を1つで済ませた誤りが目で分かる。
      var n = partsOf(room).length;
      var size = Math.round(num(big.x1) - num(big.x0)) + '×' + Math.round(num(big.y1) - num(big.y0));
      ctx.fillText(n > 1 ? size + ' 他' + (n - 1) : size, cx, cy + 10);
    });
  }

  // 置いた物。**向きが分かるように描く。** 回転を間違えた階段は、矩形だけ
  // 描いても正しく見えてしまう。
  function drawItems(ctx, floor, s) {
    var items = (floor && Array.isArray(floor.items)) ? floor.items : [];
    items.forEach(function (it) {
      var type = String(it && it.type || '');
      var def = SIZES[type] || { w: 900, d: 900 };
      var w = (num(it.w) || def.w) * s;
      var d = (num(it.d) || def.d) * s;
      var cx = num(it.x) * s, cy = num(it.y) * s;
      var group = groupOf(type);
      var color = COLOR[group];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(num(it.rot) * Math.PI / 180);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      if (group === 'stair') {
        // 段を描く。上る向き(rot)は矢印で示す。
        ctx.lineWidth = 1;
        var steps = Math.max(2, Math.round(d / (227.5 * s) ) );
        for (var i = 1; i < steps; i++) {
          var yy = -d / 2 + d * i / steps;
          ctx.beginPath(); ctx.moveTo(-w / 2, yy); ctx.lineTo(w / 2, yy); ctx.stroke();
        }
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, d / 2 - 6); ctx.lineTo(0, -d / 2 + 6);
        ctx.moveTo(-7, -d / 2 + 16); ctx.lineTo(0, -d / 2 + 6); ctx.lineTo(7, -d / 2 + 16);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(JA[type] || type, cx, cy - Math.max(d, 20) / 2 - 10);
    });
  }

  // 外形と、上辺・左辺の寸法。図面の寸法線と突き合わせられるように数字を出す。
  function drawFrame(ctx, ext, s) {
    var W = ext.w * s, D = ext.d * s;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, W, D);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var top = -36;
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(W, top); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, top - 8); ctx.lineTo(0, top + 8);
    ctx.moveTo(W, top - 8); ctx.lineTo(W, top + 8); ctx.stroke();
    ctx.fillText(String(Math.round(ext.w)), W / 2, top - 10);

    var left = -36;
    ctx.beginPath(); ctx.moveTo(left, 0); ctx.lineTo(left, D); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left - 8, 0); ctx.lineTo(left + 8, 0);
    ctx.moveTo(left - 8, D); ctx.lineTo(left + 8, D); ctx.stroke();
    ctx.save();
    ctx.translate(left - 10, D / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(Math.round(ext.d)), 0, 0);
    ctx.restore();
  }

  // 1ページぶん（その紙に載っていた階すべて）を1枚の画像にする。
  //
  // 階を横に並べる。ページと画像を1対1にしておくと、元の図面と並べて
  // 渡すときに対応が崩れない。
  function drawPage(page, options) {
    options = options || {};
    var doc = options.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var floors = (page && Array.isArray(page.floors)) ? page.floors : [];
    if (!floors.length) return null;

    var boxes = floors.map(function (f) { return extentOf(f); });
    var longest = boxes.reduce(function (n, b) { return Math.max(n, b.w, b.d); }, 1);
    var s = (options.floorPx || FLOOR_PX) / longest;

    var totalW = boxes.reduce(function (n, b) { return n + b.w * s; }, 0)
      + GAP * (boxes.length - 1) + PAD * 2;
    var totalH = boxes.reduce(function (n, b) { return Math.max(n, b.d * s); }, 0) + PAD * 2;

    var canvas = doc.createElement('canvas');
    canvas.width = Math.round(totalW);
    canvas.height = Math.round(totalH);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var x = PAD;
    floors.forEach(function (f, i) {
      var box = boxes[i];
      ctx.save();
      ctx.translate(x, PAD);
      drawFrame(ctx, box, s);
      drawRooms(ctx, f, s);
      drawItems(ctx, f, s);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(num(f.floor) || (i + 1)) + '階', 0, box.d * s + 40);
      ctx.restore();
      x += box.w * s + GAP;
    });
    return canvas.toDataURL('image/png');
  }

  return {
    drawPage: drawPage,
    FLOOR_PX: FLOOR_PX,
    JA: JA,
    SIZES: SIZES,
  };
}));
