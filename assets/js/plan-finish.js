// 読み取った間取りを仕上げる。
//
// 取り込んだ直後の間取りは、壁と部屋と建具と水まわりだけの箱である。
// 家具は1つも入っていない（読み取りが出せるのは14種類で、図面の家具は
// メーカーの標準仕様の絵だから読まない）。画面は
// 「取り込んだあと、手で直して仕上げてください」で終わり、そこから先は
// 753点のカタログを自分で掘ることになっていた。
//
// ここは3つをやる:
//
//   1. 部屋の種別を決める（「洋室(1)」は子供部屋か主寝室か）
//   2. 水まわりの既定モデルを、その部屋に合うものに差し替える
//   3. その部屋に要るのに無いものを、**カタログの道具として**並べる
//
// **置く場所は決めない。** 足りないものを押すと、その品が道具として選ばれる。
// どこに置くかは指でやってもらう。自動で置くと、通路を塞ぐ・掃き出し窓の前に
// 立つ・背面が入口を向く、といった納まりの失敗がそのまま出荷される。
// 半端に置くくらいなら、置かないほうがよい。
(function (root) {
  var ST = { result: null };

  // 読み取りが出す14種類のうち、カタログの分類に対応するもの。
  // 開口と階段は家具ではないので入れない。
  var TYPE_KIND = {
    bath: 'bathtub', toilet: 'toilet', sink: 'vanity', kitchen: 'kitchen-unit',
  };
  // 差し替えの相手を探す分類。ここに無い種類は既定のまま。
  var SWAPPABLE = { bath: 'bathtub', toilet: 'toilet', sink: 'vanity', kitchen: 'kitchen-unit' };

  function items() { return (typeof FMP_ITEMS === 'object' && FMP_ITEMS) || {}; }

  function kindOf(type) {
    var fmp = items()[type];
    if (fmp && fmp.kind) return fmp.kind;
    return TYPE_KIND[type] || null;
  }

  function inRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d;
  }

  // 部屋ごとに、いま中にある品の分類を集める。
  function kindsInRoom(plan, room) {
    var out = [];
    (plan.items || []).forEach(function (it) {
      if ((it.floor || 1) !== (room.floor || 1)) return;
      var w = Number(it.w) || 0, d = Number(it.d) || 0;
      if (!inRect(Number(it.x) + w / 2, Number(it.y) + d / 2, room)) return;
      var kind = kindOf(it.type);
      if (kind) out.push(kind);
    });
    return out;
  }

  // 部屋に置ける候補を、**寸法で先に絞る**。
  // カタログの中身を持っているのはこちら側なので、ここで絞ってから送る。
  //
  // **四周に余白を求めない。** 浴槽も洗面台もキッチンも壁に付けて置くもので、
  // 1820角の浴室に入るべきなのは 1600×750 の浴槽（1坪ユニットバス）である。
  // 四周300mmを要求すると、壁付けの品が軒並み候補から落ちる。
  // 求めるのは「部屋に入ること」だけにして、部屋に見合うかどうかの判断は、
  // 寸法を渡したうえで Jev にさせる。
  function candidatesFor(kind, room, limit) {
    var all = items(), out = [];
    Object.keys(all).forEach(function (id) {
      var m = all[id];
      if (!m || m.kind !== kind) return;
      if (Number(m.w) > room.w - 100 || Number(m.d) > room.d - 100) return;
      out.push({ id: id, name: m.name, w: Number(m.w) || 0, d: Number(m.d) || 0, h: Number(m.h) || 0 });
    });
    // 大きいものから。小さすぎる品が並ぶより、部屋に見合うものを先に見せる。
    out.sort(function (a, b) { return (b.w * b.d) - (a.w * a.d); });
    return out.slice(0, limit || 8);
  }

  // その分類で、いちばん部屋に見合うもの1点。足りないものを道具にするときに使う。
  function bestFor(kind, room) {
    var list = room ? candidatesFor(kind, room, 1) : [];
    if (list.length) return list[0].id;
    var all = items(), found = null;
    Object.keys(all).forEach(function (id) {
      if (!found && all[id] && all[id].kind === kind) found = id;
    });
    return found;
  }

  function roomsOf(plan) {
    return (plan.rooms || []).map(function (r, i) {
      var area = (Number(r.w) || 0) * (Number(r.d) || 0) / 1e6;
      return {
        id: 'r' + i,
        name: r.n || '',
        floor: r.floor || 1,
        w: Number(r.w) || 0, d: Number(r.d) || 0,
        area_m2: Number(area.toFixed(1)),
        tatami: Number((area / 1.6562).toFixed(1)),
        kinds: kindsInRoom(plan, r),
      };
    });
  }

  function roomAt(plan, it) {
    var w = Number(it.w) || 0, d = Number(it.d) || 0;
    var cx = Number(it.x) + w / 2, cy = Number(it.y) + d / 2;
    var found = null;
    (plan.rooms || []).forEach(function (r, i) {
      if (found) return;
      if ((r.floor || 1) === (it.floor || 1) && inRect(cx, cy, r)) found = { index: i, room: r };
    });
    return found;
  }

  function slotsOf(plan) {
    var out = [];
    (plan.items || []).forEach(function (it, i) {
      var kind = SWAPPABLE[it.type];
      if (!kind) return;
      var at = roomAt(plan, it);
      if (!at) return;
      var candidates = candidatesFor(kind, at.room, 8);
      if (candidates.length < 2) return;
      out.push({
        id: 'i' + i, room: 'r' + at.index, roomJa: at.room.n || '',
        roomW: at.room.w, roomD: at.room.d,
        current: it.type, w: it.w, d: it.d,
        candidates: candidates,
      });
    });
    return out;
  }

  /**
   * 仕上げの判断をもらう。**失敗しても取り込みは止めない。**
   * 判断が得られなければ null を返し、画面は仕上げの欄を出さない。
   */
  /**
   * 取り込んだ間取りを仕上げる。
   * marks は図面に描かれていた印（読み取りが返す。無くてもよい）。
   */
  function analyze(plan, marksIn) {
    if (!plan || !(plan.rooms || []).length) return Promise.resolve(null);
    var marks = Array.isArray(marksIn) ? marksIn : [];
    var body = { rooms: roomsOf(plan).slice(0, 40), slots: slotsOf(plan).slice(0, 24) };
    return fetch('/api/ai/finish-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (out) {
      if (!out || !out.rooms) return null;
      // **用途が決まってから、もう一度知識に照らす。**「洋室」のように名前だけ
      // では用途が決まらない部屋は、取り込み直後には判定できず黙っていた。
      // jev が決めたあとなら「浴槽が寝室にある」と言える。
      var types = {};
      out.rooms.forEach(function (r) { if (r && r.id && r.type) types[r.id] = r.type; });
      // 既定寸法を渡す。**渡さないと、手順どおりに読めた設備が叱られる**
      // (読み取りは設備の寸法を既定のままにするよう命じられている)。
      var warnings = (typeof PlanCheck === 'object' && PlanCheck)
        ? PlanCheck.knowledgeWarnings(plan, types,
            { defaults: (typeof ISIZES === 'object' && ISIZES) || null }) : [];
      // 図面に描かれていた印を解釈する。**分類の呼び名を持っているのは
      // 画面側**(CATALOGUE_TAGS.kinds)なので、ここで当てる。
      var reads = (typeof PlanCheck === 'object' && PlanCheck && marks.length)
        ? PlanCheck.interpretMarks(plan, marks, { roomTypes: types, names: kindNames() })
        : [];
      ST.result = {
        plan: plan, rooms: out.rooms, picks: out.picks || [],
        missing: out.missing || [], warnings: warnings, reads: reads,
      };
      return ST.result;
    }).catch(function () { return null; });
  }

  /**
   * 選ばれたモデルを、読み取った間取りに書き戻す。
   * **中心は動かさない。** 寸法だけ入れ替えるので、置き場所は図面のまま。
   */
  function applyPicks(plan, picks) {
    var changed = [];
    (picks || []).forEach(function (pick) {
      var index = Number(String(pick.slot).slice(1));
      var it = (plan.items || [])[index];
      var model = items()[pick.model];
      if (!it || !model) return;
      var was = it.type;
      it.type = pick.model;
      it.w = Number(model.w) || it.w;
      it.d = Number(model.d) || it.d;
      changed.push({ was: was, now: model.name });
    });
    return changed;
  }

  /** 画面に出す1行。「LDK に ソファ が無い（くつろぐ場所）」 */
  function missingLines(result) {
    if (!result) return [];
    var byId = {};
    (result.rooms || []).forEach(function (r) { byId[r.id] = r; });
    var kinds = ((typeof CATALOGUE_TAGS === 'object' && CATALOGUE_TAGS) || {}).kinds || {};
    var lines = [];
    (result.missing || []).forEach(function (room) {
      var meta = byId[room.id] || {};
      var name = roomLabel(meta);
      room.missing.forEach(function (m) {
        lines.push({
          room: name, roomId: room.id, kind: m.kind,
          ja: (kinds[m.kind] || {}).ja || m.kind, why: m.why,
        });
      });
    });
    return lines;
  }

  function roomLabel(room) {
    var types = (typeof RoomProgram === 'object' && RoomProgram) ? RoomProgram.ROOM_TYPES : {};
    var ja = (types[room.type] || {}).ja || '';
    var name = room.name || '';
    if (!ja) return name || '部屋';
    if (!name || name === ja) return ja;
    return name + '（' + ja + '）';
  }

  // ── 画面 ──────────────────────────────────────────────────────────
  //
  // サイドバーの検索の下に差し込む。**取り込んだあとも残る**ので、
  // 1つ置いてから次を置く、という使い方ができる。
  /** 分類の日本語名。無ければ分類の key をそのまま返す。 */
  function kindLabel(kind) {
    var names = kindNames();
    return (names && names[kind] && names[kind].ja) || kind;
  }

  /** 分類の呼び名。カタログの分類表(tags.json)が持っている。 */
  function kindNames() {
    var tags = (typeof CATALOGUE_TAGS === 'object' && CATALOGUE_TAGS) || null;
    if (!tags || !tags.kinds) return null;
    var out = {};
    Object.keys(tags.kinds).forEach(function (k) {
      out[k] = { ja: tags.kinds[k].ja, search: tags.kinds[k].search };
    });
    return out;
  }

  // 画面へ出す口は、いま**外してある**。
  //
  // 取り込みの直後にサイドバーへ地の文を生やしていた（「この間取りに足りない
  // もの（93件）」と赤い札の並び）。実機で見て、次の理由で取り下げた:
  //
  //   1. **板が無い。** 浮いたカードに載せるのが DESIGN.md の決まりで、
  //      地の文を figure の上へ直接置くと図に重なって読めない
  //   2. **車輪の再生産。** 札を押すとその場で道具になる作りで、カタログの
  //      パネルが既に持っている導線を別の場所に作り直していた
  //   3. **93件は多すぎる。** 部屋ごとに要るものを全部挙げると、選べない
  //
  // 作り直しの形は決まっている（AGENTS.md「UI を新しく作るとき」）:
  // レコメンドの欄をカードで作り、項目を押したら**カタログのパネルを開いて
  // その品まで送る**。×で個別に消せる。判断は PlanFinish.result に残って
  // いるので、画面の作り直しはここを読むだけでよい。
  function mount() {}

  // 足りないものを押したとき。**置かない。道具にするだけ。**
  function pickTool(line, button) {
    var room = null;
    ((ST.result && ST.result.plan && ST.result.plan.rooms) || []).forEach(function (r, i) {
      if ('r' + i === line.roomId) room = r;
    });
    var model = bestFor(line.kind, room);
    if (!model) {
      button.disabled = true;
      button.textContent = line.ja + '（カタログに無し）';
      return;
    }
    if (typeof setTool === 'function') setTool(model);
    button.classList.add('active');
  }

  root.PlanFinish = {
    analyze: analyze,
    applyPicks: applyPicks,
    missingLines: missingLines,
    roomLabel: roomLabel,
    mount: mount,
    // 検査から使う
    _roomsOf: roomsOf, _slotsOf: slotsOf, _kindOf: kindOf, _candidatesFor: candidatesFor,
    get result() { return ST.result; },
  };
}(typeof window === 'object' ? window : globalThis));
