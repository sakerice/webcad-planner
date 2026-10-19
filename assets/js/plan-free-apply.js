// 短い指示（worker/plan-free.mjs）で読み取った答えを、取り込みの形（plan-import.js が受ける形）に直す。
//
// 答えは方角（N/E/S/W）で向きを書いてくる。アプリは向きを rot・flipX・flipY で持ち、建具は
// 吸い付く壁の向きを基準に左右を決める（assets/js/draw-2d.js）。その翻訳をここ1か所で行う。
// 画面（取り込み）と、読み取りを測る道具（tools/plan-eval/free-answer.mjs）が同じこれを使う。
//
// 返す形: { walls:[{x1,y1,x2,y2,floor,thick}], rooms:[{x,y,w,d,floor,n}],
//           items:[{type, x, y（中心）, w, d, rot, floor, extra:{flipX,...}}], notes:[] }
// items の x,y は**中心**（取り込みの決まり。角へ直すのは plan-import.js の toAppObjects）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanFreeApply = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  var ROT = { N: 0, E: 90, S: 180, W: 270 };
  // 直進階段は +d へ上る。上る方角 → rot。
  var STAIR_ROT = { S: 0, W: 90, N: 180, E: 270 };
  var DEPTH = { window: 150, 'window-door': 180, 'door-slide': 150, 'door-slide-s': 150, 'door-fold': 420,
    'door-opening': 160, 'door-front': 200 };
  // 種類 → アプリの type。
  //   水まわりと外構の床・段は、これまでの取り込みと同じ組み込みの type（設備の差し替えや段数の
  //   計算がこの type を前提にしている）。
  //   家具はカタログのモデル。**組み込みの家具（sofa・tv など）は使わない。** 読み込み時に
  //   カタログへ置き換えられ、寸法が既定に戻り、テレビは消される（index.html の
  //   normalizeLegacyFurnitureItems）。
  // 水まわりも組み込みの type は使わない。読み込み時に fmp- のモデルへ置き換えられ、そのとき
  // 正面の向きの決まりが変わって逆を向く（2026-10-19 実測: 便器がすべて逆向き）。
  var BUILTIN = { ramp: 'ramp', balcony: 'balcony', 'exterior-stair': 'exterior-stair' };
  // 種類ごとの既定のモデル。アプリの既定（app-constants.js の LEGACY_FMP_TYPE_MAP）と同じものを使う。
  // キッチンだけは既定が収納棚（fmp-CabinetA01）なので、I型のシステムキッチンにする。
  var DEFAULT_MODEL = {
    bathtub: 'fmp-BathTub01', toilet: 'fmp-Toilet01', vanity: 'fmp-WashBasin01', 'kitchen-unit': 'original-kitchen-i2550',
    refrigerator: 'fmp-Refrigerator01', sofa: 'fmp-Sofa01', 'dining-table': 'original-table', bed: 'fmp-Bed01',
    closet: 'fmp-Closet01', laundry: 'original-washer-drum', 'shoe-storage': 'original-shoe-counter',
    chair: 'fmp-Chair01', 'low-table': 'fmp-Table33', 'kitchen-storage': 'fmp-CabinetA01', deck: 'original-terrace-tile',
    // 分類表で確信度だけで選ぶと、赤い枠の棚のような癖のあるモデルが当たる（2026-10-19 実測）。
    // よく出る種類は、色の癖の無いものを決めておく。
    cooktop: 'fmp-GasStove01', 'range-hood': 'fmp-KitchenExhaust01', 'cooking-appliance': 'fmp-KitchenOven01',
    'kitchen-sink': 'fmp-CabinetA_Sink', shower: 'fmp-ShowerSystem01', desk: 'original-desk', 'counter-table': 'fmp-Table31',
    cabinet: 'original-sideboard', chest: 'fmp-Drawer01', shelf: 'im0261-Shelf-MEGA_PACK_Shelf-shelf-310090_frame_natural',
    tv: 'im0261-Tv-MEGA_PACK_tv-electronic-101085_frame', 'gate-post': 'original-mailbox', 'garden-plant': 'fmp-GardenTree01',
  };
  // 正面の向きの決まりが分かっているカタログだけを使う（rot+180 の側が正面、modelFacingVersion 1）。
  var CATALOG_PREFIX = /^(fmp-|im0261-|original-)/;
  // 窓・扉は壁の上にしか無い。これより壁から離れた答えは捨てる（アプリは 400mm 以内の壁に
  // 吸い付けるので、残すと別の壁に穴が開く）。
  var OPENING_MAX_OFF_WALL_MM = 250;

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  // tags: { 品番: {kind, confidence, review} }（assets/models/tags.json の items）
  function typeForKind(kind, w, tags) {
    if (BUILTIN[kind]) return BUILTIN[kind];
    if (DEFAULT_MODEL[kind]) return DEFAULT_MODEL[kind];
    // 既定の無い種類は、分類表で種類の確信度（confidence.kind）がいちばん高いモデル。
    var best = null;
    Object.keys(tags || {}).forEach(function (id) {
      var v = tags[id];
      if (!v || v.kind !== kind || v.review || !CATALOG_PREFIX.test(id)) return;
      var c = Number(v.confidence && v.confidence.kind) || 0;
      if (!best || c > best.c) best = { id: id, c: c };
    });
    return best ? best.id : null;
  }

  function nearestWall(walls, cx, cy) {
    var best = null;
    walls.forEach(function (w) {
      var L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (L < 1) return;
      var ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L;
      var t = Math.max(0, Math.min(L, (cx - w.x1) * ux + (cy - w.y1) * uy));
      var d = Math.hypot(cx - w.x1 - ux * t, cy - w.y1 - uy * t);
      if (!best || d < best.d) best = { d: d, ux: ux, uy: uy };
    });
    return best;
  }

  // options.keepOffWall: 壁の上に無い窓・扉も残す（見直しの前。AI に事実として伝えるため）。
  // 既定（見直しのあと）は置かず、置かなかったことを notes に書く。黙って消さない。
  function toImportPlan(answer, tags, options) {
    options = options || {};
    var plan = { walls: [], rooms: [], items: [], notes: [], offWall: [] };
    ((answer && answer.notes) || []).forEach(function (n) { plan.notes.push(String(n)); });
    ((answer && answer.floors) || []).forEach(function (f) {
      var floor = num(f.floor) || 1;
      var walls = (f.walls || []).map(function (w) {
        var wall = { x1: num(w.x1), y1: num(w.y1), x2: num(w.x2), y2: num(w.y2), floor: floor, thick: 120 };
        // 手すり壁・腰壁は、アプリの壁の種類「バルコニーフェンス」（床から1100mm＋笠木）で建てる。
        // 普通の壁として建てると、バルコニーが天井まで壁で囲まれた箱になる（2026-10-19 実測）。
        if (w.style === 'balcony-fence') wall.wallStyle = 'balcony-fence';
        return wall;
      }).filter(function (w) { return Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 1; });
      plan.walls = plan.walls.concat(walls);

      (f.rooms || []).forEach(function (r) {
        (r.parts || []).forEach(function (p) {
          var x0 = Math.min(num(p.x0), num(p.x1)), y0 = Math.min(num(p.y0), num(p.y1));
          var w = Math.abs(num(p.x1) - num(p.x0)), d = Math.abs(num(p.y1) - num(p.y0));
          if (w < 1 || d < 1) return;
          plan.rooms.push({ x: x0, y: y0, w: w, d: d, floor: floor, n: String(r.name || '') });
        });
      });

      (f.openings || []).forEach(function (o) {
        var t = String(o.type || ''), width = num(o.width) || 780;
        var near = nearestWall(walls, num(o.x), num(o.y));
        if (!near || near.d > OPENING_MAX_OFF_WALL_MM) {
          plan.offWall.push({ floor: floor, type: t, x: Math.round(num(o.x)), y: Math.round(num(o.y)), d: near ? Math.round(near.d) : null });
          if (!options.keepOffWall) return;
          near = near || { ux: 1, uy: 0, d: 0 };
        }
        var vertical = Math.abs(near.uy) > Math.abs(near.ux);
        var depth = (t === 'door-swing') ? width : (DEPTH[t] || 150);
        var extra = {};
        if (/^door-|^window-door/.test(t)) { extra.doorOpenState = 'closed'; extra.doorHeight = t === 'door-front' ? 2330 : 2000; }
        if (o.hinge && DIR[o.hinge]) extra.flipX = DIR[o.hinge][0] * near.ux + DIR[o.hinge][1] * near.uy > 0;
        if (o.opens && DIR[o.opens]) {
          // 進行方向の右手（画面で時計回りに90°）= (-uy, ux)。開き戸は flipY=false で右手側へ開き、
          // 折戸は山形が逆側に出る。
          var right = DIR[o.opens][0] * -near.uy + DIR[o.opens][1] * near.ux > 0;
          extra.flipY = t.indexOf('door-fold') === 0 ? right : !right;
        }
        plan.items.push({ type: t, x: num(o.x), y: num(o.y), w: width, d: depth, rot: vertical ? 90 : 0, floor: floor, extra: extra });
      });

      (f.stairs || []).forEach(function (s) {
        var width = num(s.width) || 910;
        if (s.type === 'stair-corner') {
          // +d 辺から入り +w 辺へ抜ける。入る辺に +d を向け、抜ける向きが逆なら flipX。
          var rot = STAIR_ROT[DIR[s.enter] ? s.enter : 'S'];
          var th = rot * Math.PI / 180, ex = [Math.cos(th), Math.sin(th)];
          var want = DIR[s.exit] || ex;
          plan.items.push({ type: 'stair-corner', x: num(s.x), y: num(s.y), w: width, d: width, rot: rot, floor: floor,
            extra: { flipX: ex[0] * want[0] + ex[1] * want[1] < 0 } });
        } else {
          plan.items.push({ type: 'stair', x: num(s.x), y: num(s.y), w: width, d: num(s.length) || 2730,
            rot: STAIR_ROT[DIR[s.up] ? s.up : 'S'], floor: floor, extra: {} });
        }
      });

      // 屋根: 載る階 f の上 → アプリの屋根は floor=f+1（plan-structure.js と同じ決まり）。
      // 切妻は棟が x 方向（gable）か y 方向（gable-y）。片流れ（mono）は rot=0 で低い側が北。
      // 東・西が低いときは 90°・270°回し、幅と奥行きを入れ替えて同じ範囲を覆う。
      (f.roofs || []).forEach(function (r) {
        var x0 = Math.min(num(r.x0), num(r.x1)), y0 = Math.min(num(r.y0), num(r.y1));
        var w = Math.abs(num(r.x1) - num(r.x0)), d = Math.abs(num(r.y1) - num(r.y0));
        if (w < 100 || d < 100) return;
        var on = num(r.floor) || floor;
        var shape = String(r.shape || 'flat');
        var roofType = shape === 'gable' ? (r.ridge === 'NS' ? 'gable-y' : 'gable') : shape === 'hip' ? 'hip' : shape === 'mono' ? 'mono' : 'flat';
        var rot = 0, iw = w, id = d, extra = { roofType: roofType, pitch: Math.max(5, Math.min(60, num(r.pitch) || (roofType === 'flat' ? 5 : 25))) };
        if (roofType === 'flat') extra.roofThickness = 260;
        if (roofType === 'mono') {
          var low = DIR[r.low] ? r.low : 'N';
          if (low === 'S') rot = 180;
          if (low === 'E' || low === 'W') { rot = low === 'E' ? 90 : 270; iw = d; id = w; }
        }
        plan.items.push({ type: 'roof', x: x0 + w / 2, y: y0 + d / 2, w: iw, d: id, rot: rot, floor: on + 1, extra: extra });
      });

      (f.objects || []).forEach(function (o) {
        var w = num(o.w) || 600, d = num(o.d) || 600;
        var type = typeForKind(String(o.kind || ''), w, tags);
        if (!type) return;
        // 正面の向き → rot。カタログのモデルは rot+180 の側が正面（modelFacingVersion 1。
        // tools/lint_plan.py の _front_dir と同じ決まり）。印を付けておかないと、読み込み時に
        // 古い保存の向きとみなされて 180° 回される。
        var rot = ROT[o.face] != null ? ROT[o.face] : 0;
        var extra = {};
        if (CATALOG_PREFIX.test(type)) { rot += 180; extra.modelFacingVersion = 1; extra.modelFrontAxis = '+Z'; }
        plan.items.push({ type: type, x: num(o.x), y: num(o.y), w: w, d: d, rot: rot % 360, floor: floor, extra: extra });
      });
    });
    if (!options.keepOffWall && plan.offWall.length) {
      plan.notes.push('壁の上に無い窓・扉を ' + plan.offWall.length + ' 件置きませんでした（'
        + plan.offWall.map(function (o) { return o.floor + '階 (' + o.x + ', ' + o.y + ')'; }).join('、') + '）。');
    }
    return plan;
  }

  // 組み立てた結果について、機械で分かる事実。見直しのときに AI へ伝える（直し方は AI に任せる）。
  function factsOf(plan, answer) {
    var facts = [];
    plan.offWall.forEach(function (o) {
      facts.push(o.floor + '階の ' + o.type + '（中心 ' + o.x + ', ' + o.y + '）は壁の上にありません'
        + (o.d != null ? '（いちばん近い壁まで ' + o.d + 'mm）' : '') + '。アプリは窓・扉を壁から 400mm 以内でしか置けません。');
    });
    var hasRoof = ((answer && answer.floors) || []).some(function (f) { return (f.roofs || []).length; });
    if (!hasRoof) facts.push('屋根を答えていません。このままだと、いちばん上の階に平らな屋根が1枚だけ作られます。');
    // 階ごとの壁の外形から外れた家具・設備（外構は除く）。
    var EXTERIOR = { ramp: 1, balcony: 1, deck: 1, 'exterior-stair': 1, 'gate-post': 1, 'garden-plant': 1, 'garden-equipment': 1, fence: 1 };
    ((answer && answer.floors) || []).forEach(function (f) {
      var ws = f.walls || [];
      if (!ws.length) return;
      var xs = [], ys = [];
      ws.forEach(function (w) { xs.push(num(w.x1), num(w.x2)); ys.push(num(w.y1), num(w.y2)); });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      (f.objects || []).forEach(function (o) {
        if (EXTERIOR[o.kind]) return;
        if (num(o.x) < x0 || num(o.x) > x1 || num(o.y) < y0 || num(o.y) > y1) {
          facts.push((f.floor || 1) + '階の ' + o.kind + '（中心 ' + Math.round(num(o.x)) + ', ' + Math.round(num(o.y)) + '）は、その階の壁の外側にあります。');
        }
      });
    });
    return facts;
  }

  // 書き出し途中の答え（JSON の頭の部分）から、どこまで作ったかを数える。画面の進み具合に使う。
  function progressOf(partial) {
    var s = String(partial || '');
    var floorMatch = s.match(/"floor"\s*:\s*(\d+)/g) || [];
    var floor = floorMatch.length ? Number(floorMatch[floorMatch.length - 1].replace(/\D/g, '')) : 0;
    var count = function (re) { return (s.match(re) || []).length; };
    var sections = ['walls', 'rooms', 'openings', 'stairs', 'roofs', 'objects'];
    var at = -1, now = '';
    sections.forEach(function (k) {
      var i = s.lastIndexOf('"' + k + '"');
      if (i > at) { at = i; now = k; }
    });
    return {
      floor: floor, section: now,
      walls: count(/"y2"\s*:/g),          // 壁だけが y2 を持つ（部屋の長方形は x0,y0,x1,y1）
      rooms: count(/"name"\s*:/g),
      openings: count(/"hinge"\s*:/g),
      objects: count(/"face"\s*:/g),
    };
  }

  return { factsOf: factsOf, toImportPlan: toImportPlan, progressOf: progressOf, typeForKind: typeForKind, DEFAULT_MODEL: DEFAULT_MODEL };
}));
