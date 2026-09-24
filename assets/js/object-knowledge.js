// 日本の住宅で、その物がどう置かれるか。
//
// なぜ在るのか
// ------------
// 取り込んだ間取りに「外壁沿いにある薄い箱」があったとき、それがテレビなのか
// カーテンなのかは、形だけでは決まらない。**カーテンは窓に付き、幅は窓幅より
// 左右100〜200mm大きく、室内側に下がる**——この作法を知っていて初めて分かる。
//
// これは jev が持っている一般常識ではなく、**このサービスが持つべき知識**である。
// jev に判断させるにも、まずこの知識を渡す必要がある。
//
// 知識を置く場所を分けない。取り込みの解釈にも、配置の検査にも、jev への
// 状態づくりにも、**この表ひとつ**を使う。二重に書くと必ず食い違い、
// 「検査は通るのに実物が変」という事故が起きる(実際に起きている)。
//
// 分類(kind)の key は tools/catalogue-vocab.mjs の KINDS と、
// 部屋(rooms)の key は assets/js/room-program.js の ROOM_TYPES と揃えてある。
//
// 表の読み方
// ----------
//   rooms   在り得る部屋。'any' はどこでも
//   mount   取り付け方 floor / wall / ceiling / tabletop / builtin / outdoor
//   size    実寸の範囲(mm)。**分かっているものだけ書く。**推測では書かない
//   attach  何に付随するか。to=付随先の分類か 'window'、within=その距離(mm)以内、
//           side=位置関係 above / under / interior / beside / on
//   span    付随先との幅の関係。plus=[最小,最大] は付随先の幅に足す量、
//           atLeast=true は「付随先以上の幅」
//   place   位置の決まり exterior-wall / against-wall / free / room-centre /
//           corner / boundary
//   face    向きの決まり into-room / none、または {faces:'<分類>'}
//   why     なぜそうなのか。**人が読んで直せるように書く**
//
// 空欄は「まだ調べていない」であって「決まりが無い」ではない。
// 半端な推測を入れるより空けておく。埋めるのは都度でよい。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ObjectKnowledge = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  var K = {
    // ── キッチン ────────────────────────────────────────────────
    'kitchen-unit': {
      rooms: ['kitchen', 'ldk'], mount: 'floor', place: 'against-wall', face: 'into-room',
      size: { w: [1800, 2700], d: [600, 1000], what: '間口2550・奥行650（対面は970）' },
      why: '壁付けか対面。対面は背面に収納を置くので奥行が増える',
    },
    'kitchen-storage': {
      rooms: ['kitchen', 'ldk'], mount: 'floor', place: 'against-wall', face: 'into-room',
      why: 'カップボード。調理台の背面に置き、通路を挟んで向かい合う',
    },
    cooktop: {
      rooms: ['kitchen', 'ldk'], mount: 'builtin',
      attach: { to: 'kitchen-unit', within: 0, side: 'on' },
      size: { w: [550, 800], d: [450, 650], what: '3口コンロ 600×520 / 750×520' },
      why: '調理台へ落とし込む。単体で床に置かれることはない',
    },
    'range-hood': {
      rooms: ['kitchen', 'ldk'], mount: 'ceiling',
      attach: { to: 'cooktop', within: 200, side: 'above' },
      span: { of: 'cooktop', atLeast: true },
      size: { w: [600, 900], d: [600, 800], what: '間口600 / 750 / 900' },
      why: 'コンロの真上。**火源から下端まで800mm以上**（消防法）。'
         + 'コンロより狭いと煙を捕らえられないので、幅はコンロ以上',
    },
    'cooking-appliance': {
      rooms: ['kitchen', 'ldk'], mount: 'tabletop',
      why: 'レンジ・炊飯器・食洗機。カップボードの天板か、調理台へ組み込む',
    },
    'kitchen-sink': {
      rooms: ['kitchen', 'ldk'], mount: 'builtin',
      attach: { to: 'kitchen-unit', within: 0, side: 'on' },
      why: '調理台へ落とし込む。システムキッチンには最初から含まれる',
    },
    refrigerator: {
      rooms: ['kitchen', 'ldk'], mount: 'floor', place: 'against-wall', face: 'into-room',
      size: { w: [550, 800], d: [600, 780], what: '400〜500L で 685×700' },
      why: '扉が手前へ開くので、前に600mm以上の空きが要る',
    },

    // ── 水まわり ────────────────────────────────────────────────
    bathtub: {
      rooms: ['bath'], mount: 'builtin', place: 'corner',
      size: { w: [1100, 1700], d: [650, 900], what: '1坪UBの湯船 1600×750。0.75坪でも 1100×700' },
      why: 'ユニットバスの一部。二辺が壁に接する',
    },
    shower: {
      rooms: ['bath'], mount: 'wall', place: 'against-wall',
      why: '浴槽の長辺側の壁。洗い場に向く',
    },
    vanity: {
      rooms: ['washroom'], mount: 'floor', place: 'against-wall', face: 'into-room',
      size: { w: [600, 1200], d: [450, 620], what: '間口750 / 900、奥行500' },
      why: '鏡が上に付く。前に立つので600mm以上の空きが要る',
    },
    toilet: {
      rooms: ['toilet'], mount: 'floor', place: 'against-wall', face: 'into-room',
      size: { w: [350, 520], d: [620, 820], what: 'タンク付き洋風便器 380×680' },
      why: 'タンク側を壁に付ける。前に400mm以上の空きが要る',
    },
    laundry: {
      rooms: ['washroom', 'balcony'], mount: 'floor', place: 'against-wall',
      why: '洗濯機・洗濯パン・物干しを含む分類。**それぞれ置かれ方が違う**ので、'
         + 'ここでは共通の分しか書けない。洗濯機はパンの上、物干しは天井付け',
    },
    'shoe-storage': {
      rooms: ['entry'], mount: 'floor', place: 'against-wall', face: 'into-room',
      size: { w: [700, 1800], d: [330, 450], what: '下駄箱 奥行350〜400' },
      why: '玄関土間に面する壁。奥行が深いと土間が狭くなる',
    },

    // ── 設備 ──────────────────────────────────────────────────
    hvac: {
      rooms: ['ldk', 'bedroom', 'kids', 'washitsu', 'study'], mount: 'wall',
      place: 'against-wall', face: 'into-room',
      why: '壁の高い位置（床から1,800〜2,200mm）。室内へ吹き出す。'
         + '室外機と配管でつながるので、外壁側が自然',
    },
    'utility-equipment': {
      rooms: ['outdoor'], mount: 'outdoor', place: 'against-wall',
      why: '室外機・給湯器・メーター。建物の外壁沿い',
    },
    'joinery-prop': {
      rooms: 'any', mount: 'builtin',
      why: '建具のモデル。**実際のドアは壁に開口を切る仕組みで置く**ので、'
         + 'これを家具として置くと壁と無関係な位置に浮く',
    },
    light: {
      rooms: 'any', mount: 'ceiling', place: 'room-centre',
      why: '天井付け。部屋の中心が基本で、ダウンライトは複数を割り付ける',
    },
    appliance: {
      rooms: ['washroom', 'ldk'], mount: 'floor',
      why: '掃除機・空気清浄機・扇風機。住設ではないので置き場は自由',
    },

    // ── 居室の家具 ──────────────────────────────────────────────
    sofa: {
      rooms: ['ldk'], mount: 'floor', place: 'against-wall', face: { faces: 'tv' },
      size: { w: [1500, 2500], d: [750, 1050], what: '2.5〜3人掛け 1900×900' },
      why: 'テレビと向かい合う。間に1,800〜2,500mm空けるのが一般的',
    },
    tv: {
      rooms: ['ldk', 'bedroom'], mount: 'floor', place: 'against-wall',
      face: { faces: 'sofa' },
      size: { w: [800, 1800], d: [50, 400], what: '55型で幅1,240。台を含めると奥行400' },
      why: '**薄い箱で壁沿いにある点がカーテンと紛らわしい。**'
         + 'テレビは窓に付かず室内を向き、カーテンは窓に付いて向きを持たない',
    },
    chair: {
      rooms: ['ldk', 'kitchen', 'kids', 'study'], mount: 'floor',
      attach: { to: 'dining-table', within: 700, side: 'beside' },
      face: { faces: 'dining-table' },
      why: '卓を囲む。引くのに後ろへ600mm要る',
    },
    'dining-table': {
      rooms: ['ldk', 'kitchen'], mount: 'floor', place: 'free',
      size: { w: [1200, 1900], d: [700, 950], what: '4人掛け 1500×800' },
      why: '椅子を引くので四周に空きが要る。壁付けなら三方',
    },
    'low-table': {
      rooms: ['ldk', 'washitsu'], mount: 'floor', place: 'free',
      attach: { to: 'sofa', within: 700, side: 'beside' },
      why: 'ソファの前。天板高さは概ね400mm以下',
    },
    desk: {
      rooms: ['kids', 'study', 'bedroom'], mount: 'floor', place: 'against-wall',
      face: 'into-room',
      size: { w: [900, 1500], d: [550, 750], what: '学習机 1000×600' },
      why: '壁に向けるか窓に向ける。椅子を引くので後ろへ600mm要る',
    },
    'counter-table': {
      rooms: ['ldk', 'kitchen'], mount: 'floor',
      attach: { to: 'kitchen-unit', within: 150, side: 'beside' },
      why: '対面キッチンのカウンター。天板高さ820〜1,150mmで、高い椅子を使う',
    },
    'table-set': {
      rooms: ['ldk'], mount: 'floor', place: 'free',
      why: '卓と椅子が組みになったもの。ダイニングテーブル＋椅子と二重になる',
    },
    bed: {
      rooms: ['bedroom', 'kids'], mount: 'floor', place: 'against-wall',
      size: { w: [950, 1600], d: [1900, 2150], what: 'シングル 970×1950 / ダブル 1400×1950' },
      why: '**頭側を壁に付ける。**長辺の片側に乗り降りの空きが要る',
    },
    bedding: {
      rooms: ['bedroom', 'kids'], mount: 'tabletop',
      attach: { to: 'bed', within: 0, side: 'on' },
      why: '敷き布団・掛け布団・枕。ベッドの上に載る',
    },
    closet: {
      rooms: ['wic', 'bedroom', 'kids'], mount: 'floor', place: 'against-wall',
      face: 'into-room',
      why: '扉か引き出しが前に開く。600mm以上の空きが要る',
    },
    cabinet: { rooms: ['ldk'], mount: 'floor', place: 'against-wall', face: 'into-room' },
    chest: { rooms: ['bedroom', 'kids'], mount: 'floor', place: 'against-wall', face: 'into-room' },
    shelf: {
      rooms: ['study', 'kids', 'storage', 'wic'], mount: 'floor',
      place: 'against-wall', face: 'into-room',
    },

    // ── 窓まわり ────────────────────────────────────────────────
    curtain: {
      rooms: 'any', mount: 'wall', place: 'exterior-wall', face: 'none',
      attach: { to: 'window', within: 300, side: 'interior' },
      span: { of: 'window', plus: [100, 400] },
      why: '**窓の室内側。**幅は窓より左右100〜200mm大きい（開けたとき窓を塞がない'
         + 'ため）。丈は掃き出し窓なら床まで、腰窓なら窓下＋150mm',
    },
    'roller-screen': {
      rooms: 'any', mount: 'wall', place: 'exterior-wall', face: 'none',
      attach: { to: 'window', within: 200, side: 'interior' },
      span: { of: 'window', plus: [0, 100] },
      why: '窓枠の内側か、窓の上へ付ける。カーテンと違い左右へ広がらない。'
         + 'カーテンを掛けない洗面・トイレで使う',
    },

    // ── 仕上げ・飾り ────────────────────────────────────────────
    rug: {
      rooms: ['ldk', 'bedroom', 'washitsu'], mount: 'floor', place: 'free',
      attach: { to: 'sofa', within: 1200, side: 'beside' },
      why: 'ソファとローテーブルの足元。家具の脚が乗る大きさにする',
    },
    mirror: {
      rooms: ['entry', 'washroom'], mount: 'wall', place: 'against-wall',
      why: '洗面では洗面化粧台の上。玄関では姿見として壁に掛ける',
    },
    'wall-decor': { rooms: 'any', mount: 'wall', place: 'against-wall', why: '絵画・時計。壁に掛ける' },
    decor: {
      rooms: ['ldk', 'entry', 'washitsu'], mount: 'tabletop',
      why: '棚や卓の上に載る小物。床に直置きはしない',
    },
    plant: { rooms: ['ldk'], mount: 'floor', place: 'free', why: '床置きの鉢と卓上の小鉢がある' },
    kids: { rooms: ['kids'], mount: 'floor', place: 'free' },
    pet: { rooms: ['ldk'], mount: 'floor', place: 'free' },

    // ── 外構 ──────────────────────────────────────────────────
    'gate-post': {
      rooms: ['outdoor'], mount: 'outdoor', place: 'boundary',
      why: '道路から見える位置。アプローチの入口に立てる',
    },
    deck: {
      rooms: ['outdoor'], mount: 'outdoor',
      attach: { to: 'window-door', within: 300, side: 'beside' },
      why: '**掃き出し窓の外。**窓から降りて使うものなので、窓から離れていたら'
         + 'ただの板になる',
    },
    'garden-plant': { rooms: ['outdoor'], mount: 'outdoor', place: 'free' },
    'garden-equipment': { rooms: ['outdoor'], mount: 'outdoor', place: 'free' },
    fence: {
      rooms: ['outdoor'], mount: 'outdoor', place: 'boundary',
      why: '敷地の境界か、隣家との視線を切る位置',
    },
    other: {},
  };

  // 実寸の範囲だけを取り出したもの。tools/catalogue-vocab.mjs の REAL_SIZE が
  // これを参照する（**同じ数字を二か所に書かないため**）。
  function sizeTable() {
    var out = {};
    for (var kind in K) {
      if (Object.prototype.hasOwnProperty.call(K, kind) && K[kind].size) out[kind] = K[kind].size;
    }
    return out;
  }

  function knowledgeFor(kind) { return K[kind] || null; }

  /** その分類がその部屋に在り得るか。知らない分類・部屋なら null（判定しない）。 */
  function roomAllows(kind, roomType) {
    var k = K[kind];
    if (!k || !k.rooms || !roomType) return null;
    if (k.rooms === 'any') return true;
    return k.rooms.indexOf(roomType) >= 0;
  }

  /** 実寸が範囲に収まるか。向きは問わない。知らない分類なら null。 */
  function sizeOk(kind, w, d) {
    var spec = K[kind] && K[kind].size;
    if (!spec) return null;
    var width = Number(w), depth = Number(d);
    if (!isFinite(width) || !isFinite(depth)) return false;
    function fits(a, b) {
      return a >= spec.w[0] && a <= spec.w[1] && b >= spec.d[0] && b <= spec.d[1];
    }
    return fits(width, depth) || fits(depth, width);
  }

  /** 付随先との幅の関係が成り立つか。span が無ければ null。 */
  function spanOk(kind, width, hostWidth) {
    var s = K[kind] && K[kind].span;
    if (!s) return null;
    var w = Number(width), h = Number(hostWidth);
    if (!isFinite(w) || !isFinite(h)) return false;
    if (s.atLeast) return w >= h - 1;
    return w >= h + s.plus[0] - 1 && w <= h + s.plus[1] + 1;
  }

  // ── jev へ渡す説明文 ────────────────────────────────────────
  //
  // **知識を文章にして渡す。** jev はリビングが何かは知っているが、
  // 「カーテンの幅は窓より左右100〜200mm大きい」は知らない。
  function describe(kind) {
    var k = K[kind];
    if (!k) return '';
    var lines = [];
    if (k.rooms) lines.push('置かれる部屋: ' + (k.rooms === 'any' ? 'どこでも' : k.rooms.join(', ')));
    if (k.mount) lines.push('取り付け: ' + k.mount);
    if (k.place) lines.push('位置: ' + k.place);
    if (k.face) lines.push('向き: ' + (k.face.faces ? k.face.faces + ' を向く' : k.face));
    if (k.attach) {
      lines.push('付随先: ' + k.attach.to
        + (k.attach.within ? '（' + k.attach.within + 'mm 以内）' : '')
        + (k.attach.side ? ' / ' + k.attach.side : ''));
    }
    if (k.span) {
      lines.push('幅: ' + k.span.of + (k.span.atLeast ? ' 以上'
        : ' + ' + k.span.plus[0] + '〜' + k.span.plus[1] + 'mm'));
    }
    if (k.size) lines.push('実寸: 幅' + k.size.w.join('〜') + ' 奥行' + k.size.d.join('〜')
      + '（' + k.size.what + '）');
    if (k.why) lines.push('理由: ' + k.why);
    return lines.join('\n');
  }

  // ── 図面の印が何であるかを当てる ──────────────────────────────
  //
  // **これが知識を書いた目的。** 図面に「外壁沿いの薄い箱」があったとき、
  // 形だけではテレビともカーテンとも取れる。知識で絞る。
  //
  //   mark  { w, d, floor, label }      図面から拾った印の大きさと添え字
  //   ctx   { roomType, near, onExteriorWall }
  //         near は近くにあるものの配列 [{kind, x, y, w, d, dist}]
  //
  // 返すのは候補の配列。**確信ではなく候補**であることを名前で示す。
  // 1つに絞れないことのほうが多く、絞れないまま返すのが正しい。
  function candidatesFor(mark, ctx) {
    var context = ctx || {};
    var near = context.near || [];
    var out = [];
    for (var kind in K) {
      if (!Object.prototype.hasOwnProperty.call(K, kind)) continue;
      var k = K[kind];
      var score = 0;

      // 根拠は**効いた順に並べる**。拾った順ではない。
      // 画面はいちばん強い根拠(why[0])だけを出すので、拾った順のままだと
      // 「LDKの900×1400は食卓かもしれません（この部屋に在るもの）」という、
      // 何も説明していない一行になる。実測でそうなっていた。
      var reasons = [];
      var why = [];
      // ブロックの中の関数宣言は古い実行環境で挙動が揺れる。式で持つ。
      var add = function (weight, text) { reasons.push({ w: weight, t: text }); };

      // 図面の添え字は、**いちばん強い手がかり**。「TV」「クローゼット」など。
      // 分類の呼び名はカタログの語彙(tags.json の kinds)が持っているので、
      // ここには書き写さない。呼び名が渡されなければ、この手がかりは使わない。
      var hit = labelHit(mark.label, context.names && context.names[kind]);
      if (hit) { score += 5; add(5, '図面に「' + hit + '」と書かれている'); }

      // **添え字が当たっているものは、以下で振り落とさない。**
      // 「テレビ」と書いてあるのに寸法が合わないとき、欲しいのは
      // 「冷蔵庫では」ではなく「テレビだが寸法が違う」という答えである。
      var keep = !!hit;

      // 部屋で弾く
      var allowed = roomAllows(kind, context.roomType);
      if (allowed === false && !keep) continue;
      if (allowed === false) add(-1, 'ただし、この部屋には在らないもの');
      else if (allowed === true && k.rooms !== 'any') { score += 1; add(1, 'この部屋に在るもの'); }

      // 実寸
      var size = sizeOk(kind, mark.w, mark.d);
      if (size === false && !keep) continue;
      if (size === false) add(-1, 'ただし、実寸が ' + k.size.what + ' から外れる');
      else if (size === true) { score += 2; add(2, '実寸が合う'); }

      // 付随先が近くにあるか。**ここがいちばん効く。**
      if (k.attach) {
        var host = nearest(near, k.attach.to);
        if ((!host || host.dist > k.attach.within) && !keep) continue;
        if (!host || host.dist > k.attach.within) {
          add(-1, 'ただし、そばに ' + k.attach.to + ' が無い');
        } else {
          score += 3;
          add(3, k.attach.to + ' のそばにある');
          var span = spanOk(kind, mark.w, Math.max(host.w || 0, host.d || 0));
          if (span === false && !keep) continue;
          if (span === false) add(-1, 'ただし、幅が ' + k.attach.to + ' と釣り合わない');
          else if (span === true) { score += 3; add(4, '幅が ' + k.attach.to + ' と釣り合う'); }
        }
      }

      // 外壁沿いかどうか
      if (k.place === 'exterior-wall' && context.onExteriorWall) { score += 1; add(1, '外壁沿い'); }

      // 強い根拠から並べ、「ただし…」の但し書きは最後に回す。
      why = reasons.slice().sort(function (a, b) { return b.w - a.w; }).map(function (r) { return r.t; });
      if (score > 0) out.push({ kind: kind, score: score, why: why });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /** 添え字が、その分類の呼び名や検索語を含んでいるか。含んでいればその語。 */
  function labelHit(label, names) {
    if (!label || !names) return null;
    var text = String(label).toLowerCase();
    var words = [names.ja].concat(names.search || []).filter(Boolean);
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(String(words[i]).toLowerCase()) >= 0) return words[i];
    }
    return null;
  }

  /** near の中から、その分類のもので最も近いものを返す。 */
  function nearest(near, kind) {
    var best = null;
    for (var i = 0; i < near.length; i++) {
      var n = near[i];
      var is = n.kind === kind
        || (kind === 'window' && (n.kind === 'window' || n.kind === 'window-door'))
        || (kind === 'window-door' && n.kind === 'window-door');
      if (!is) continue;
      if (!best || (n.dist || 0) < (best.dist || 0)) best = n;
    }
    return best;
  }

  return {
    KNOWLEDGE: K,
    candidatesFor: candidatesFor,
    knowledgeFor: knowledgeFor,
    sizeTable: sizeTable,
    roomAllows: roomAllows,
    sizeOk: sizeOk,
    spanOk: spanOk,
    describe: describe,
  };
}));
