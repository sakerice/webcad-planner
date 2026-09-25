// 取り込んだ間取りを、物の置かれ方の知識に照らす。
//
// なぜ在るのか
// ------------
// 読み取りは図面から設備を拾うが、**それが置かれた部屋が正しいかは見ていない。**
// 浴槽が「主寝室」に、便器が「LDK」に入っていても、そのまま通って3Dになる。
// 見れば一目で分かる間違いだが、読み取りの時点では誰も気づかない。
//
// **なぜブラウザ側に置くのか**
// 呼ぶ人が2人いる。取り込みの直後(Worker。部屋の名前の規則だけで照らす)と、
// 仕上げのあと(ブラウザ。jev が「洋室」の用途を決めたあとで照らす)。
// 実装を二か所に書くと必ず食い違うので、ここ1つを両方から使う。
//
// 何を見て、何を見ないか
// ----------------------
// 「その部屋に在り得るか」と「実寸の範囲に収まるか」の2つだけ。どちらも
// assets/js/object-knowledge.js に書いてあるものしか見ない。
// **書いていないものは黙る。** 推測で警告を出すと、正しい図面を直させることになる。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./object-knowledge.js'), require('./room-program.js'));
  } else {
    root.PlanCheck = factory(root.ObjectKnowledge, root.RoomProgram);
  }
}(typeof self !== 'undefined' ? self : this, function (ObjectKnowledge, RoomProgram) {

  // 読み取りが返す種類 → 知識表の分類。
  // **読み取り側の名前は図面の言葉、知識表の名前はカタログの言葉**で、
  // 揃っていない。ここが唯一の変換点。
  var IMPORT_TO_KIND = {
    bath: "bathtub",
    toilet: "toilet",
    sink: "vanity",
    kitchen: "kitchen-unit",
  };

  // 画面に出す名前。読み取りの種類名のままでは利用者に伝わらない。
  var JA = { bath: "浴槽", toilet: "便器", sink: "洗面台", kitchen: "流し台" };

  /** 数として読めれば数、読めなければ null。null・空文字は 0 にしない。 */
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function centreOf(item) {
    return {
      x: Number(item.x || 0) + Number(item.w || 0) / 2,
      y: Number(item.y || 0) + Number(item.d || 0) / 2,
    };
  }

  function roomAt(plan, floor, x, y) {
    var rooms = (plan.rooms || []).filter((r) => (r.floor || 1) === (floor || 1)
      && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d);
    // 小さい部屋を優先する（大きな外形と重なっている場合があるため）
    rooms.sort((a, b) => a.w * a.d - b.w * b.d);
    return rooms[0] || null;
  }

  /**
   * 知識に照らした指摘を、画面へ出す文で返す。
   * 判定できないものは何も返さない（黙る）。
   *
   * roomTypes は {部屋のid: 用途} の対応表（任意）。**「洋室」のように名前だけ
   * では用途が決まらない部屋を、jev が決めたあとに渡すためにある。** 無ければ
   * 名前の規則だけで判定し、決まらない部屋については黙る。
   */
  function knowledgeWarnings(plan, roomTypes, options) {
    var out = [];
    var defaults = (options && options.defaults) || null;
    if (!plan || !Array.isArray(plan.items)) return out;
    for (var item of plan.items) {
      var kind = IMPORT_TO_KIND[item.type];
      if (!kind) continue;
      var name = JA[item.type] || item.type;
      var c = centreOf(item);
      var room = roomAt(plan, item.floor, c.x, c.y);

      // 1. その部屋に在り得るか
      if (room) {
        // 渡された用途を優先する（jev が決めたもの）。無ければ名前の規則。
        var given = roomTypes && (roomTypes[room.id] || roomTypes[room.n]);
        var type = given || RoomProgram.typeFromName(room.n || "");
        var allowed = ObjectKnowledge.roomAllows(kind, type);
        if (allowed === false) {
          var where = (RoomProgram.ROOM_TYPES[type] || {}).ja || room.n || "この部屋";
          var k = ObjectKnowledge.knowledgeFor(kind);
          var expect = (k.rooms || []).map((r) =>
            (RoomProgram.ROOM_TYPES[r] || {}).ja || r).join("・");
          out.push(`${name}が「${room.n || where}」にあります。`
            + `${name}は${expect}にあるものです。読み取りの取り違えか、部屋の名前が違います`);
        }
      } else {
        out.push(`${name}がどの部屋にも入っていません。位置か部屋の範囲を確かめてください`);
      }

      // 2. 実寸の範囲に収まるか
      //
      // **既定寸法のままのものは、寸法を読んだ答えではない。**
      // 読み取りの手順17は設備について「w と d は仕様の既定値のまま変えない」と
      // 命じている(図に合わせて変えると、アプリのカタログの品物と食い違うため)。
      // 命じたとおりの値を「日本の住宅の寸法から外れる」と叱ると、**正しく読めた
      // 図面ほど必ず警告が出る**。実測で、浴槽の既定 1600×1600 は知識表の
      // 湯船(1100〜1700 × 650〜900)から外れており、浴槽のある図面すべてで
      // この指摘が出ていた。
      //
      // 既定から外れている値だけを見る。そこは読み取りが手順に反して図から
      // 拾った値であり、3000×3000 の便器のような読み違いはここに出る。
      var byDefault = defaults && defaults[item.type]
        && Number(item.w) === Number(defaults[item.type].w)
        && Number(item.d) === Number(defaults[item.type].d);
      if (!byDefault && ObjectKnowledge.sizeOk(kind, item.w, item.d) === false) {
        var k = ObjectKnowledge.knowledgeFor(kind);
        out.push(`${name}が ${Math.round(item.w)}×${Math.round(item.d)}mm です。`
          + `日本の住宅では ${k.size.what}。寸法の読み違いかもしれません`);
      }
    }
    return out;
  }

  var _internals = { IMPORT_TO_KIND, roomAt };

  // ── 図面の印を読む（いまの本筋） ─────────────────────────────
  //
  // **何であるかは、図面を見ている読み取りが答える(guess)。**知識はそれを
  // 照らすだけ。実物の図面3枚・印114件で比べた:
  //
  //   A. jev に選ばせる(見た目の描写と知識の説明を渡す)
  //   B. 読み取りが答え、知識で照らす
  //
  // 2つの答えが食い違った49件のうち、**A だけが正しかったものは0件**。
  // jev が受け取るのは読み取りの一行の描写で、「小さな矩形の中に複数の円」を
  // 食卓セットと読んだ。読み取りは調理台の上にあるのを見ていてコンロと答えた。
  //
  // 読み取りが答えなかった印(guess が無い・other)は、部屋の用途が決まって
  // いれば jev に回す(ask)。
  //
  //   roomTypes は {部屋のid: 用途}。部屋の id は取り込んだ間取りのもの。
  function readMarks(plan, marks, roomTypes) {
    var reads = [], ask = [];
    var list = Array.isArray(marks) ? marks : [];
    for (var i = 0; i < list.length; i++) {
      var mark = list[i];
      var cx = numOrNull(mark.x), cy = numOrNull(mark.y);
      if (cx === null || cy === null) continue;
      var room = roomAt(plan, mark.floor, cx, cy);
      var type = room
        ? ((roomTypes && roomTypes[room.id]) || RoomProgram.typeFromName(room.n || '') || room.use || null)
        : null;
      var guess = typeof mark.guess === 'string' ? mark.guess : '';
      if (guess && guess !== 'other' && ObjectKnowledge.KNOWLEDGE[guess]) {
        var fits = ObjectKnowledge.roomAllows(guess, type);
        reads.push({
          index: i, mark: mark, room: room ? room.n : null, roomType: type,
          kind: guess, from: 'reader',
          // 知識と食い違ったものは消さずに印を付ける。**実物の図面で調べると
          // 13件すべてが知識の側の穴だった**(部屋の範囲が狭すぎた11件、
          // ナイトテーブルという分類そのものが無かった2件)。
          fits: fits,
        });
      } else if (type) {
        ask.push({
          id: 'm' + i, index: i, room: room ? room.n : null,
          looks: mark.looks || '', label: mark.label || '',
          w: mark.w, d: mark.d,
          roomJa: (RoomProgram.ROOM_TYPES[type] || {}).ja || '',
          candidates: ObjectKnowledge.shortlistFor(mark, type),
        });
      }
    }
    return { reads: reads, ask: ask.filter(function (a) { return a.candidates.length; }) };
  }

  /**
   * 仕上げ(jev)が返した部屋の用途を、取り込んだ間取りの部屋の id に付け直す。
   *
   * **仕上げへは部屋を並び順の番号(r0, r1, …)で送っている。** 取り込んだ部屋の
   * id は p38 のような別の番号なので、そのまま引くと1件も当たらない。実物の
   * 2階建てで 29部屋中0部屋だった。jev が決めた用途が、知識の照合にも印の
   * 解釈にも一度も届いていなかった。
   */
  function typesByRoomId(plan, named) {
    var out = {};
    var rooms = (plan && plan.rooms) || [];
    (named || []).forEach(function (r) {
      if (!r || !r.type) return;
      var m = /^r(\d+)$/.exec(String(r.id));
      var room = m ? rooms[Number(m[1])] : null;
      if (room && room.id !== undefined) out[room.id] = r.type;
    });
    return out;
  }

  // ── 図面の印を解釈する ──────────────────────────────────────
  //
  // 読み取りは印の位置・大きさ・添え字だけを返す（種類は当てさせていない）。
  // ここで、その印が**どの部屋にあり、そばに何があり、外壁沿いか**を集めて、
  // 置かれ方の知識に渡す。
  //
  // **返すのは候補であって、決定ではない。** 1つに絞れないことのほうが多く、
  // 絞れないまま返すのが正しい。置くかどうかは人が決める。
  function interpretMarks(plan, marks, options) {
    var opts = options || {};
    var list = Array.isArray(marks) ? marks : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var mark = list[i];
      // **null や空文字を 0 として通さない。** Number(null) は 0 なので、
      // 位置が読めなかった印が原点に置かれた印として通ってしまう。
      var cx = numOrNull(mark.x), cy = numOrNull(mark.y);
      if (cx === null || cy === null) continue;
      var room = roomAt(plan, mark.floor, cx, cy);
      var type = room
        ? ((opts.roomTypes && (opts.roomTypes[room.id] || opts.roomTypes[room.n]))
           || RoomProgram.typeFromName(room.n || ""))
        : null;
      var ctx = {
        roomType: type,
        near: nearbyOf(plan, mark),
        onExteriorWall: onExteriorWall(plan, mark, room),
        names: opts.names,
      };
      out.push({
        mark: mark,
        room: room ? (room.n || "") : "",
        roomType: type || null,
        candidates: ObjectKnowledge.candidatesFor(mark, ctx).slice(0, 4),
      });
    }
    return out;
  }

  /** 印のそばにある建具・設備。距離は中心どうし。 */
  function nearbyOf(plan, mark) {
    var cx = Number(mark.x), cy = Number(mark.y);
    var near = [];
    var items = plan.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if ((it.floor || 1) !== (mark.floor || 1)) continue;
      var c = centreOf(it);
      var dist = Math.sqrt((c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy));
      if (dist > 3000) continue;
      near.push({
        kind: IMPORT_TO_KIND[it.type] || it.type,
        x: c.x, y: c.y, w: it.w, d: it.d, dist: dist,
      });
    }
    near.sort(function (a, b) { return a.dist - b.dist; });
    return near.slice(0, 12);
  }

  /**
   * 外壁沿いか。**部屋の外へ出てみて確かめる。**
   * 印の中心から四方へ少し出た点を見て、どれかが「どの部屋でもない」なら外壁側。
   * 部屋が分からないときは判定しない（false を返して手がかりに使わない）。
   */
  function onExteriorWall(plan, mark, room) {
    if (!room) return false;
    var cx = Number(mark.x), cy = Number(mark.y);
    var step = 700;
    var probes = [[cx - step, cy], [cx + step, cy], [cx, cy - step], [cx, cy + step]];
    for (var i = 0; i < probes.length; i++) {
      if (!roomAt(plan, mark.floor, probes[i][0], probes[i][1])) return true;
    }
    return false;
  }

  return {
    knowledgeWarnings: knowledgeWarnings,
    readMarks: readMarks,
    typesByRoomId: typesByRoomId,
    interpretMarks: interpretMarks,
    _internals: _internals,
  };
}));
