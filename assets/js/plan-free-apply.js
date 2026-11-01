// 短い指示（worker/plan-free.mjs）で読み取った答えを、取り込みの形（plan-import.js が受ける形）に直す。
//
// 答えは方角（N/E/S/W）で向きを書いてくる。アプリは向きを rot・flipX・flipY で持ち、建具は
// 吸い付く壁の向きを基準に左右を決める（assets/js/draw-2d.js）。その翻訳をここ1か所で行う。
// 画面（取り込み）と、読み取りを測る道具（tools/plan-eval/free-answer.mjs）が同じこれを使う。
//
// 返す形: { walls:[{x1,y1,x2,y2,floor,thick,extra}], rooms:[{x,y,w,d,floor,n,extra}],
//           items:[{type, x, y（中心）, w, d, rot, floor, extra:{flipX,...}}], site, notes:[] }
// items の x,y は**中心**（取り込みの決まり。角へ直すのは plan-import.js の toAppObjects）。
// 設定パネルの項目（set）・外構の種類・建具の種類は assets/js/plan-settable.js の表に従う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./plan-settable.js'), require('./object-knowledge.js'));
  else root.PlanFreeApply = factory(root.PlanSettable, root.ObjectKnowledge);
}(typeof self !== 'undefined' ? self : this, function (PlanSettable, ObjectKnowledge) {
  'use strict';

  var DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  var ROT = { N: 0, E: 90, S: 180, W: 270 };
  // 直進階段は +d へ上る。上る方角 → rot。
  var STAIR_ROT = { S: 0, W: 90, N: 180, E: 270 };
  var DEPTH = {};
  PlanSettable.OPENINGS.forEach(function (o) { DEPTH[o.type] = o.d; });
  // 種類 → アプリの type。
  //   水まわりと外構の床・段は、これまでの取り込みと同じ組み込みの type（設備の差し替えや段数の
  //   計算がこの type を前提にしている）。
  //   家具はカタログのモデル。**組み込みの家具（sofa・tv など）は使わない。** 読み込み時に
  //   カタログへ置き換えられ、寸法が既定に戻り、テレビは消される（index.html の
  //   normalizeLegacyFurnitureItems）。
  // 水まわりも組み込みの type は使わない。読み込み時に fmp- のモデルへ置き換えられ、そのとき
  // 正面の向きの決まりが変わって逆を向く（2026-10-19 実測: 便器がすべて逆向き）。
  //   外構の組み込みの種類（車・フェンス・スロープなど）は PlanSettable.EXTERIOR が kind → type を決める。
  // 種類ごとの既定のモデル。アプリの既定（app-constants.js の LEGACY_FMP_TYPE_MAP）と同じものを使う。
  // キッチンだけは既定が収納棚（fmp-CabinetA01）なので、I型のシステムキッチンにする。
  // 洗面台も、アプリの既定（fmp-WashBasin01）はカウンターに載せる鉢だけ（高さ264mm）で、
  // 単独で置くと床に鉢が転がる（2026-10-23 利用者の指摘「洗面台が鉢だけで下の戸棚が無い」）。
  // 日本の洗面脱衣室の洗面台は、下の戸棚・鉢・鏡が一体の洗面化粧台なので、それにする。
  var DEFAULT_MODEL = {
    bathtub: 'fmp-BathTub01', toilet: 'fmp-Toilet01', vanity: 'original-vanity', 'kitchen-unit': 'original-kitchen-i2550',
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
    var ext = PlanSettable.exteriorByKind(kind);
    if (ext) return ext.type;
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

  // ── キッチン ──────────────────────────────────────────────────────
  // AI には調理台（kitchen-unit）・流し・コンロを別々に答えさせている（図面にそう描かれる）。
  // 以前は調理台に流しとコンロの付いた一体のモデルを使い、別に答えた流し・コンロを床に置いていたため、
  // 流しやコンロが二重になり、答えた方は調理台の中に埋もれていた（2026-11-01、3つの間取りすべて）。
  // いまは調理台の範囲を、カタログの部品の台（流し・コンロ・食洗機・引出し）で、答えた位置どおりに埋める。
  var KITCHEN_PARTS = { 'kitchen-unit': 1, 'kitchen-sink': 1, cooktop: 1, 'cooking-appliance': 1 };
  var KITCHEN_BOX = {
    'kitchen-sink': { type: 'original-kitchen-box-sink900', w: 900 },
    cooktop: { type: 'original-kitchen-box-hob750', w: 750 },
    'cooking-appliance': { type: 'original-kitchen-box-dishwasher450', w: 450 },
  };
  var KITCHEN_DRAWERS = [450, 600, 750, 900];
  // 天板の高さ（部品の台の高さ）と、床から測った取り付けの高さ。レンジフードは火源から下端まで
  // 800mm 以上（object-knowledge.js の range-hood）なので、天板 850 + 800。
  var COUNTER_MM = 850;
  var MOUNT_ELEV_MM = { 'range-hood': COUNTER_MM + 800 };
  // 流し・コンロが調理台に「載っている」とみなす、調理台の外形からのはみ出し。
  var KITCHEN_ON_MM = 150;

  function catalogItem(type, x, y, w, d, face, floor, extra) {
    var rot = (ROT[face] != null ? ROT[face] : 0) + 180;
    extra = extra || {};
    extra.modelFacingVersion = 1; extra.modelFrontAxis = '+Z';
    return { type: type, x: x, y: y, w: w, d: d, rot: rot % 360, floor: floor, extra: extra };
  }

  // 調理台の長さ L（中心が 0）の上に、部品 {s: 中心, w: 幅, type} を重ならないよう並べ、
  // すき間を引出しの台で埋める。返り値は [{a, b, type}]（a〜b が台の範囲）。
  function layoutCounter(L, fixtures) {
    var fs = fixtures.slice().sort(function (p, q) { return p.s - q.s; });
    var total = fs.reduce(function (n, p) { return n + p.w; }, 0);
    var k = total > L ? L / total : 1;
    fs.forEach(function (p) { p.w *= k; });
    var prev = -L / 2;
    fs.forEach(function (p) { p.a = Math.max(p.s - p.w / 2, prev); prev = p.a + p.w; });
    for (var i = fs.length - 1; i >= 0; i--) {
      var limit = i === fs.length - 1 ? L / 2 : fs[i + 1].a;
      if (fs[i].a + fs[i].w > limit) fs[i].a = limit - fs[i].w;
    }
    var segs = fs.map(function (p) { return { a: p.a, b: p.a + p.w, type: p.type }; });
    var out = [], at = -L / 2;
    var fill = function (a, b, left, right) {
      var g = b - a;
      if (g < 1) return;
      // 300 未満のすき間は引出しにせず、となりの部品の幅に足す。
      if (g < 300 && (left || right)) { if (left) left.b = b; else right.a = a; return; }
      var n = Math.max(1, Math.ceil(g / 900)), step = g / n;
      var near = KITCHEN_DRAWERS.reduce(function (m, w) { return Math.abs(w - step) < Math.abs(m - step) ? w : m; });
      for (var j = 0; j < n; j++) out.push({ a: a + j * step, b: a + (j + 1) * step, type: 'original-kitchen-box-drawer' + near });
    };
    segs.forEach(function (sg, i) { fill(at, sg.a, i > 0 ? segs[i - 1] : null, sg); at = sg.b; });
    fill(at, L / 2, segs.length ? segs[segs.length - 1] : null, null);
    return out.concat(segs).sort(function (p, q) { return p.a - q.a; });
  }

  function composeKitchens(parts, floor, tags, ctx) {
    var items = [];
    var units = parts.filter(function (p) { return p.kind === 'kitchen-unit'; }).map(function (u, i) {
      var alongX = !(u.face === 'E' || u.face === 'W');
      var hx = (alongX ? u.w : u.d) / 2, hy = (alongX ? u.d : u.w) / 2;
      return { u: u, i: i, alongX: alongX, x0: u.x - hx, x1: u.x + hx, y0: u.y - hy, y1: u.y + hy, fixtures: [] };
    });
    parts.forEach(function (p) {
      if (p.kind === 'kitchen-unit') return;
      var on = null;
      units.forEach(function (k) {
        if (!on && p.x >= k.x0 - KITCHEN_ON_MM && p.x <= k.x1 + KITCHEN_ON_MM && p.y >= k.y0 - KITCHEN_ON_MM && p.y <= k.y1 + KITCHEN_ON_MM) on = k;
      });
      var box = KITCHEN_BOX[p.kind];
      if (on) { on.fixtures.push({ s: on.alongX ? p.x - on.u.x : p.y - on.u.y, w: box.w, type: box.type }); return; }
      // 調理台の上に無いもの。流し・コンロは単独の台として、家電は今までどおりの物として置く。
      var type = p.kind === 'cooking-appliance' ? typeForKind(p.kind, p.w, tags) : box.type;
      if (!type) return;
      var alone = catalogItem(type, p.x, p.y, p.kind === 'cooking-appliance' ? p.w : Math.max(p.w, box.w), p.kind === 'cooking-appliance' ? p.d : Math.max(p.d, 600),
        p.face, floor, PlanSettable.applySettings('object', p.kind, p.set, {}, ctx));
      alone.kind = p.kind;   // 台の上に載せるかを決めるため（toImportPlan が使って消す）
      items.push(alone);
    });
    units.forEach(function (k) {
      var u = k.u, run = 'kitchen-' + floor + '-' + (k.i + 1);
      layoutCounter(u.w, k.fixtures).forEach(function (sg) {
        var c = (sg.a + sg.b) / 2;
        items.push(catalogItem(sg.type, k.alongX ? u.x + c : u.x, k.alongX ? u.y : u.y + c, sg.b - sg.a, u.d, u.face, floor, { kitchenRun: run }));
      });
    });
    return items;
  }

  // ── 台の上に載る物 ────────────────────────────────────────────────
  // 卓上に置く種類（object-knowledge.js の mount 'tabletop'。レンジ・小物）は、答えの位置に
  // 天板のある家具（食器棚・棚・机など）があれば、その天板の高さに載せる。床に置くと家具の中に
  // 埋まる（2026-11-02、過去の読み取り9回のうち3回、食器棚の上のレンジが棚の中の床に置かれていた）。
  // 家具の高さはカタログの値（options.heightOf）。分からなければ載せない（推測の高さで浮かせない）。
  // 台にするのは天板が平らな家具だけ。ベッド・ソファはカタログの高さがヘッドボード・背もたれの
  // 上端なので、そこに載せると宙に浮く。
  var SURFACE_KINDS = { 'kitchen-storage': 1, cabinet: 1, chest: 1, shelf: 1, desk: 1, 'dining-table': 1,
    'low-table': 1, 'counter-table': 1, 'shoe-storage': 1 };
  function mountOf(kind) {
    var k = ObjectKnowledge && ObjectKnowledge.KNOWLEDGE && ObjectKnowledge.KNOWLEDGE[kind];
    return k ? k.mount : null;
  }
  function footprint(it) {
    var turned = ((Number(it.rot) || 0) % 180) === 90;
    var hw = (turned ? it.d : it.w) / 2, hd = (turned ? it.w : it.d) / 2;
    return { x0: it.x - hw, x1: it.x + hw, y0: it.y - hd, y1: it.y + hd };
  }
  function restOnFurniture(placed, heightOf) {
    if (typeof heightOf !== 'function') return;
    placed.forEach(function (p) {
      if (mountOf(p.kind) !== 'tabletop' || (p.item.extra && p.item.extra.elev)) return;
      var top = 0;
      placed.forEach(function (q) {
        if (q === p || !SURFACE_KINDS[q.kind]) return;
        var r = footprint(q.item);
        if (p.item.x < r.x0 || p.item.x > r.x1 || p.item.y < r.y0 || p.item.y > r.y1) return;
        var h = Number(heightOf(q.item.type));
        if (isFinite(h) && h > top) top = h;
      });
      if (top > 0) { p.item.extra = p.item.extra || {}; p.item.extra.elev = Math.round(top); }
    });
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
    // notes は AI が書いた作業メモ（測定・開発用）、userNotes は利用者に見せてよい文だけ。
    // dropped: アプリに置けなかった種類（測定と検査で見る。黙って捨てたものを数えるため）。
    // rejected: 使えない値だったため入れなかった設定（項目=値）。
    var plan = { walls: [], rooms: [], items: [], site: null, notes: [], userNotes: [], offWall: [], dropped: [], rejected: [] };
    var ctx = { rejected: plan.rejected };
    var siteParts = [];
    ((answer && answer.notes) || []).forEach(function (n) { plan.notes.push(String(n)); });
    ((answer && answer.floors) || []).forEach(function (f) {
      var floor = num(f.floor) || 1;
      var walls = (f.walls || []).map(function (w) {
        var wall = { x1: num(w.x1), y1: num(w.y1), x2: num(w.x2), y2: num(w.y2), floor: floor, thick: 120 };
        // 手すり壁・腰壁は、アプリの壁の種類「バルコニーフェンス」（床から1100mm＋笠木）で建てる。
        // 普通の壁として建てると、バルコニーが天井まで壁で囲まれた箱になる（2026-10-19 実測）。
        if (w.style === 'balcony-fence') wall.wallStyle = 'balcony-fence';
        var set = PlanSettable.applySettings('wall', null, w.set, {}, ctx);
        if (set.thick) wall.thick = set.thick;
        if (set.wallHeight) wall.extra = { wallHeight: set.wallHeight };
        return wall;
      }).filter(function (w) { return Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 1; });
      plan.walls = plan.walls.concat(walls);

      (f.rooms || []).forEach(function (r) {
        var roomSet = PlanSettable.applySettings('room', null, r.set, {}, { floor: floor, rejected: ctx.rejected });
        (r.parts || []).forEach(function (p) {
          var x0 = Math.min(num(p.x0), num(p.x1)), y0 = Math.min(num(p.y0), num(p.y1));
          var w = Math.abs(num(p.x1) - num(p.x0)), d = Math.abs(num(p.y1) - num(p.y0));
          if (w < 1 || d < 1) return;
          plan.rooms.push({ x: x0, y: y0, w: w, d: d, floor: floor, n: String(r.name || ''), extra: JSON.parse(JSON.stringify(roomSet)) });
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
        // 開き戸は奥行きが扉の幅と同じ（表で d を持たない種類）。
        var depth = DEPTH[t] == null ? width : DEPTH[t];
        // 扉は閉じた状態で置く（開いた扉が並ぶと間取りが読みにくい）。高さなどは set から。
        var extra = PlanSettable.applySettings('opening', t, o.set, {}, ctx);
        if (/^door-|^window-door/.test(t)) extra.doorOpenState = 'closed';
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
          var cornerExtra = PlanSettable.applySettings('stair', 'stair-corner', s.set, {}, ctx);
          cornerExtra.flipX = ex[0] * want[0] + ex[1] * want[1] < 0;
          plan.items.push({ type: 'stair-corner', x: num(s.x), y: num(s.y), w: width, d: width, rot: rot, floor: floor, extra: cornerExtra });
        } else {
          plan.items.push({ type: 'stair', x: num(s.x), y: num(s.y), w: width, d: num(s.length) || 2730,
            rot: STAIR_ROT[DIR[s.up] ? s.up : 'S'], floor: floor, extra: PlanSettable.applySettings('stair', 'stair', s.set, {}, ctx) });
        }
      });

      // 屋根: 載る階 f の上 → アプリの屋根は floor=f+1（plan-structure.js と同じ決まり）。
      // 切妻は棟が x 方向（gable）か y 方向（gable-y）。片流れ（mono）は rot=0 で低い側が北。
      // 東・西が低いときは 90°・270°回し、幅と奥行きを入れ替えて同じ範囲を覆う。
      (f.roofs || []).forEach(function (r) {
        var x0 = Math.min(num(r.x0), num(r.x1)), y0 = Math.min(num(r.y0), num(r.y1));
        var w = Math.abs(num(r.x1) - num(r.x0)), d = Math.abs(num(r.y1) - num(r.y0));
        if (w < 100 || d < 100) { plan.dropped.push('roof'); return; }
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

      var kitchenParts = [], placed = [];
      (f.objects || []).forEach(function (o) {
        var w = num(o.w) || 600, d = num(o.d) || 600;
        var kind = String(o.kind || '');
        // 敷地と区画はまとめて1つの敷地にする（下の siteOf）。
        if (kind === 'site' || kind === 'site-zone') { siteParts.push({ kind: kind, x: num(o.x), y: num(o.y), w: w, d: d, set: o.set }); return; }
        // 調理台と、その上に載る流し・コンロ・組み込みの家電は、まとめて部品の台で組む（下の composeKitchens）。
        if (KITCHEN_PARTS[kind]) { kitchenParts.push({ kind: kind, x: num(o.x), y: num(o.y), w: w, d: d, face: o.face, set: o.set }); return; }
        var type = typeForKind(kind, w, tags);
        if (!type) { plan.dropped.push(kind); return; }
        // 正面の向き → rot。カタログのモデルは rot+180 の側が正面（modelFacingVersion 1。
        // tools/lint_plan.py の _front_dir と同じ決まり）。印を付けておかないと、読み込み時に
        // 古い保存の向きとみなされて 180° 回される。
        var rot = ROT[o.face] != null ? ROT[o.face] : 0;
        var extra = PlanSettable.applySettings('object', kind, o.set, {}, ctx);
        if (CATALOG_PREFIX.test(type)) { rot += 180; extra.modelFacingVersion = 1; extra.modelFrontAxis = '+Z'; }
        else if ((PlanSettable.exteriorByKind(kind) || {}).front180) rot += 180;
        // 天井から下がる物（レンジフード）は、床ではなくその高さに置く。
        if (MOUNT_ELEV_MM[kind]) extra.elev = MOUNT_ELEV_MM[kind];
        var item = { type: type, x: num(o.x), y: num(o.y), w: w, d: d, rot: rot % 360, floor: floor, extra: extra };
        plan.items.push(item);
        placed.push({ kind: kind, item: item });
      });
      composeKitchens(kitchenParts, floor, tags, ctx).forEach(function (it) {
        plan.items.push(it);
        if (it.kind) { placed.push({ kind: it.kind, item: it }); delete it.kind; }
      });
      restOnFurniture(placed, options.heightOf);
    });
    plan.site = siteOf(siteParts);
    if (!options.keepOffWall && plan.dropped.length) {
      plan.userNotes.push('読み取った物のうち ' + plan.dropped.length + ' 点は、house-planner で表せない形だったため置いていません。');
    }
    if (!options.keepOffWall && plan.offWall.length) {
      var floorsOff = [];
      plan.offWall.forEach(function (o) { if (floorsOff.indexOf(o.floor) < 0) floorsOff.push(o.floor); });
      plan.userNotes.push('位置を確かめられなかった窓・扉が ' + plan.offWall.length + ' か所あります（'
        + floorsOff.sort().map(function (f) { return f + '階'; }).join('・') + '）。必要なら手で足してください。');
    }
    return plan;
  }

  // 敷地（kind site）と区画（kind site-zone）から、アプリの敷地を1つ作る。区画は敷地の左上を
  // 原点に持つ（アプリの siteZones の決まり）。敷地が無く区画だけなら、区画を包む範囲を敷地にする。
  function siteOf(parts) {
    if (!parts.length) return null;
    var box = function (p) { return { x0: p.x - p.w / 2, y0: p.y - p.d / 2, x1: p.x + p.w / 2, y1: p.y + p.d / 2 }; };
    var site = parts.filter(function (p) { return p.kind === 'site' && p.w >= 1000 && p.d >= 1000; })[0];
    var zones = parts.filter(function (p) { return p.kind === 'site-zone' && p.w >= 100 && p.d >= 100; });
    var b = site ? box(site) : null;
    if (!b) {
      if (!zones.length) return null;
      b = zones.map(box).reduce(function (a, z) {
        return { x0: Math.min(a.x0, z.x0), y0: Math.min(a.y0, z.y0), x1: Math.max(a.x1, z.x1), y1: Math.max(a.y1, z.y1) };
      });
    }
    var siteSet = site ? PlanSettable.applySettings('object', 'site', site.set, {}) : {};
    return {
      x: b.x0, y: b.y0, w: b.x1 - b.x0, d: b.y1 - b.y0, surface: siteSet.surface || 'grass',
      zones: zones.map(function (z) {
        var zs = PlanSettable.applySettings('object', 'site-zone', z.set, {}), zb = box(z);
        return { name: zs.name || '', x: zb.x0 - b.x0, y: zb.y0 - b.y0, w: z.w, d: z.d, surface: zs.surface || 'concrete' };
      }),
    };
  }

  // 組み立てた結果について、機械で分かる事実。見直しのときに AI へ伝える（直し方は AI に任せる）。
  function factsOf(plan, answer) {
    var facts = [];
    plan.offWall.forEach(function (o) {
      facts.push(o.floor + '階の ' + o.type + '（中心 ' + o.x + ', ' + o.y + '）は壁の上にありません'
        + (o.d != null ? '（いちばん近い壁まで ' + o.d + 'mm）' : '') + '。アプリは窓・扉を壁から 400mm 以内でしか置けません。');
    });
    (plan.dropped || []).forEach(function (k) {
      facts.push(k === 'roof' ? '大きさが 100mm 未満の屋根があり、置いていません。'
        : 'objects の kind「' + k + '」は house-planner に置けないため、置いていません。一覧にある kind を使ってください。');
    });
    (plan.rejected || []).forEach(function (kv) {
      facts.push('set の「' + kv + '」は、項目名か値が一覧に無いため使っていません。');
    });
    var hasRoof = ((answer && answer.floors) || []).some(function (f) { return (f.roofs || []).length; });
    if (!hasRoof) facts.push('屋根を答えていません。このままだと、いちばん上の階に平らな屋根が1枚だけ作られます。');
    // 階ごとの壁の外形から外れた家具・設備（外構は除く）。
    var EXTERIOR = { deck: 1, 'gate-post': 1, 'garden-plant': 1, 'garden-equipment': 1 };
    PlanSettable.EXTERIOR.forEach(function (e) { EXTERIOR[e.kind] = 1; });
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
    // 階の始まり（"floor": n の直後に "walls"）だけを数える。屋根の floor（載る階）を拾うと階を取り違える。
    var floorMatch = s.match(/"floor"\s*:\s*(\d+)\s*,\s*"walls"/g) || [];
    var floor = floorMatch.length ? Number(/(\d+)/.exec(floorMatch[floorMatch.length - 1])[1]) : 0;
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
