// 読み取った間取りを仕上げる。
//
// 取り込んだ直後の間取りは、壁と部屋と建具と水まわりだけの箱である。
// 家具は置かない（図面の家具はメーカーの標準仕様の絵で、置く物ではない）。
// ただし図面に**何が描かれていたか**は読み取りが返している(marks)。
//
// ここは4つをやる:
//
//   1. 部屋の種別を決める（「洋室(1)」は子供部屋か主寝室か）
//   2. 水まわりの既定モデルを、その部屋に合うものに差し替える
//   3. 図面の印が何であるかを決め、知識に照らす(plan-check.js の readMarks)
//   4. 図面に描かれていた家具を「おすすめの家具」としてカタログの先頭に出す
//
// **置く場所は決めない。**おすすめを押すと、カタログのその分類の欄が開く
// だけで、置くのはカタログからいつもどおりに行う。自動で置くと、通路を塞ぐ・
// 掃き出し窓の前に立つ・背面が入口を向く、といった納まりの失敗がそのまま
// 出荷される。半端に置くくらいなら、置かないほうがよい。
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
        // 読み取り(図面を見ている側)が判断した用途。サーバは名前の表の次に
        // これを採り、無いときだけ jev に聞く。
        use: r.use || '',
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
    var PC = (typeof PlanCheck === 'object' && PlanCheck) || null;
    var body = { rooms: roomsOf(plan).slice(0, 40), slots: slotsOf(plan).slice(0, 24) };
    return post(body).then(function (out) {
      if (!out || !out.rooms) return null;
      // **用途が決まってから、もう一度知識に照らす。**仕上げへは部屋を並び順の
      // 番号で送っているので、取り込んだ部屋の id に付け直してから使う。
      var types = PC ? PC.typesByRoomId(plan, out.rooms) : {};
      // 既定寸法を渡す。**渡さないと、手順どおりに読めた設備が叱られる**
      // (読み取りは設備の寸法を既定のままにするよう命じられている)。
      var warnings = PC
        ? PC.knowledgeWarnings(plan, types, { defaults: (typeof ISIZES === 'object' && ISIZES) || null })
        : [];
      // 図面の印。**読み取りが答えたものはそれを採り**、答えなかったものだけ
      // jev に回す(assets/js/plan-check.js の readMarks を見ること)。
      var got = PC && marks.length ? PC.readMarks(plan, marks, types) : { reads: [], ask: [] };
      var asked = got.ask.length ? post({ marks: got.ask }) : Promise.resolve(null);
      return asked.then(function (judged) {
        var reads = got.reads.slice();
        ((judged && judged.reads) || []).forEach(function (j) {
          var a = got.ask.filter(function (x) { return x.id === j.id; })[0];
          if (!a) return;
          reads.push({ index: a.index, mark: marks[a.index], room: a.room, kind: j.kind, from: 'jev',
            confidence: j.confidence, fits: true });
        });
        reads.sort(function (x, y) { return x.index - y.index; });
        ST.result = {
          plan: plan, rooms: out.rooms, picks: out.picks || [],
          missing: out.missing || [], warnings: warnings, reads: reads,
        };
        return ST.result;
      });
    }).catch(function () { return null; });
  }

  function post(body) {
    return fetch('/api/ai/finish-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) { return res.ok ? res.json() : null; });
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

  // ── おすすめの家具 ──────────────────────────────────────────────
  //
  // 取り込んだ図面に描かれていた家具を、**カタログの欄への入口**として並べる。
  //
  // 以前は「この間取りに足りないもの（93件）」を赤い札でサイドバーに直に生やし、
  // 札を押すとその場で道具にしていた。実機で見て取り下げた。板が無く図に
  // 重なって読めない。置く導線はカタログが既に持っているのに作り直していた。
  // 部屋ごとに要るものを全部挙げると93件になり、選べない。
  //
  // 決まり(AGENTS.md「UI を新しく作るとき」):
  //   - 板の上に載せる。検索の欄と同じ、浮いたカード(DESIGN.md)
  //   - **ここからは置かない。**押したら、カタログのその分類の欄を開いて
  //     そこまで送る。置くのはカタログから、いつもどおりに
  //   - ×で1つずつ消せる。全部消えたらカードごと消える
  //
  // 並べるのは**図面に描かれていたもの**だけ(assets/js/plan-check.js の
  // readMarks が決めたもの)。目標は「間取りをそのまま再現する」ことなので、
  // 一般論で足りないものより、その図面にあったものを出す。

  // 取り込みが自分で置く設備。挙げると二重になる。
  var PLACED_BY_IMPORT = { bathtub: true, toilet: true, vanity: true, 'kitchen-unit': true };

  // 並べる順。**多い順にすると、ハンガーパイプ(クローゼット)が先頭に来る。**
  // 実物の平屋で WIC と家族のクローゼットに8本あり、ベッドやソファより前に
  // 並んだ。部屋を形づくる家具を先に見せたいので、カタログの大分類
  // (家具 → 住設 → 外構)、その中は置かれ方の知識の表の並び(ソファ・テレビ・
  // 椅子・食卓…)に従う。
  var GROUP_RANK = { '家具': 0, '住設': 1, '外構': 2 };

  /**
   * 図面の印から、おすすめの一覧を作る。**画面に触らない**ので検査できる。
   * 同じ分類はまとめ、描かれていた部屋を添える。
   *   options.kinds  分類ごとの {group}(カタログの tags.json の kinds)
   *   options.order  分類の並び(置かれ方の知識の表の key の並び)
   * どちらも無ければ多い順。
   */
  function recommendations(result, options) {
    var o = options || {};
    var kinds = o.kinds || {};
    var order = o.order || [];
    var byKind = {};
    ((result && result.reads) || []).forEach(function (r) {
      if (!r || !r.kind || r.kind === 'other' || PLACED_BY_IMPORT[r.kind]) return;
      var e = byKind[r.kind] || (byKind[r.kind] = { kind: r.kind, count: 0, rooms: [] });
      e.count++;
      if (r.room && e.rooms.indexOf(r.room) < 0) e.rooms.push(r.room);
    });
    function rank(kind) {
      var g = kinds[kind] && GROUP_RANK[kinds[kind].group];
      var i = order.indexOf(kind);
      return [g === undefined ? 9 : g, i < 0 ? 999 : i];
    }
    return Object.keys(byKind).map(function (k) { return byKind[k]; }).sort(function (a, b) {
      var ra = rank(a.kind), rb = rank(b.kind);
      return ra[0] - rb[0] || ra[1] - rb[1] || b.count - a.count || a.kind.localeCompare(b.kind);
    });
  }

  /** 画面で並べるときの手がかり(カタログの分類と、知識の表の並び)。 */
  function orderHints() {
    var tags = (typeof CATALOGUE_TAGS === 'object' && CATALOGUE_TAGS) || null;
    var ok = (typeof ObjectKnowledge === 'object' && ObjectKnowledge) || null;
    return { kinds: (tags && tags.kinds) || {}, order: ok ? Object.keys(ok.KNOWLEDGE) : [] };
  }

  /** 分類の日本語名。カタログの分類表(tags.json)が持っている。 */
  function kindLabel(kind) {
    var tags = (typeof CATALOGUE_TAGS === 'object' && CATALOGUE_TAGS) || null;
    var k = tags && tags.kinds && tags.kinds[kind];
    return (k && k.ja) || kind;
  }

  /** カタログの、その分類の欄。無ければ null(その分類の品がカタログに無い)。 */
  function sectionFor(kind) {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar || !kind) return null;
    var key = (typeof CSS === 'object' && CSS.escape) ? CSS.escape(kind) : kind;
    return sidebar.querySelector('.asset-subcat[data-kind="' + key + '"]');
  }

  /** 画面に出すおすすめ。カタログに欄の無い分類は出さない(押しても開く先が無い)。
   *  カードと取り込み結果の画面で**同じ数**を言うために、ここ1つで決める。 */
  function shownRecommendations(result) {
    return recommendations(result, orderHints()).filter(function (r) { return sectionFor(r.kind); });
  }

  function mount(result) {
    if (typeof document === 'undefined') return;
    var old = document.getElementById('plan-recommend');
    if (old) old.remove();
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var list = shownRecommendations(result);
    if (!list.length) return;

    var card = document.createElement('section');
    card.id = 'plan-recommend';
    card.setAttribute('aria-labelledby', 'plan-recommend-title');
    var title = document.createElement('h2');
    title.id = 'plan-recommend-title';
    title.textContent = 'おすすめの家具';
    var note = document.createElement('p');
    note.className = 'catalogue-count';
    note.textContent = '図面に描かれていたものです。押すと、カタログのその欄を開きます。';
    var ul = document.createElement('ul');
    ul.className = 'plan-recommend-list';
    list.forEach(function (r) { ul.append(row(r)); });
    card.append(title, note, ul);

    // 検索の欄のすぐ下(検索結果より後ろ)。カタログの先頭に置く。
    var anchor = document.getElementById('object-search-results') || document.getElementById('object-search');
    if (anchor) anchor.after(card);
    else sidebar.prepend(card);
  }

  function row(r) {
    var ja = kindLabel(r.kind);
    var where = (r.count > 1 ? r.count + '点' : '') + (r.count > 1 && r.rooms.length ? '・' : '') + r.rooms.join('・');
    var li = document.createElement('li');
    li.className = 'plan-recommend-item';
    li.setAttribute('data-kind', r.kind);

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'plan-recommend-open';
    // 欄の見出しと同じ絵(assets/js/menu-icons.js)。中身は固定の表から作られる。
    if (typeof MenuIcons === 'object' && MenuIcons.html) open.innerHTML = MenuIcons.html(ja);
    var text = document.createElement('span');
    text.className = 'plan-recommend-text';
    var name = document.createElement('span');
    name.className = 'plan-recommend-name';
    name.textContent = ja;
    text.append(name);
    if (where) {
      // 1行に収め、はみ出す分は … にする。全部は title と読み上げで分かる。
      // 折り返すと「子/ども室」「フ/ァミリー」と語の途中で切れた。
      var sub = document.createElement('span');
      sub.className = 'plan-recommend-where';
      sub.textContent = where;   // 室名は図面由来の文字。textContent で入れる
      text.append(sub);
    }
    open.append(text);
    open.title = ja + (where ? '（' + where + '）' : '');
    open.setAttribute('aria-label', ja + 'の欄を開く' + (where ? '（' + where + '）' : ''));
    open.addEventListener('click', function () { openInCatalogue(r.kind); });

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'plan-recommend-dismiss';
    close.setAttribute('aria-label', ja + 'をおすすめから消す');
    close.textContent = '×';
    close.addEventListener('click', function () { dismiss(li); });

    li.append(open, close);
    return li;
  }

  // ×。その行を消すだけ。取り込み直せば出し直す。
  function dismiss(li) {
    var card = document.getElementById('plan-recommend');
    // 消したあとの行き先。次の行、無ければ前の行。キーボードで続けて消せるように。
    var next = li.nextElementSibling || li.previousElementSibling;
    li.remove();
    if (card && !card.querySelector('.plan-recommend-item')) { card.remove(); return; }
    var target = next && next.querySelector('.plan-recommend-dismiss');
    if (target) target.focus();
  }

  /**
   * カタログの、その分類の欄を開いてそこまで送る。**開閉は既存の関数で行う**
   * (toggleCat / toggleAssetCat)。＋／－の印もそちらが揃える。
   */
  function openInCatalogue(kind) {
    var section = sectionFor(kind);
    if (!section) return false;
    var sidebar = document.getElementById('sidebar');
    // 検索中は欄が隠れている(#sidebar.catalogue-searching)。検索を解いてから開く。
    var input = document.getElementById('object-search-input');
    if (input && input.value) {
      input.value = '';
      if (sidebar && typeof sidebar._globalCatalogueSearch === 'function') sidebar._globalCatalogueSearch();
    }
    // 大分類(家具・住設・外構)
    var body = section.closest('.cat-body');
    if (body && !body.classList.contains('open')) {
      var hdr = body.previousElementSibling;
      if (hdr && typeof toggleCat === 'function') toggleCat(hdr);
      else body.classList.add('open');
    }
    // その分類の欄
    var head = section.querySelector('.asset-subhdr');
    if (!section.classList.contains('open')) {
      if (head && typeof toggleAssetCat === 'function') toggleAssetCat(head);
      else section.classList.add('open');
    }
    var reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    reveal(sidebar, head || section, !reduce);
    // どこが開いたかを一瞬示す。キーボードではその欄の最初の品へ移る。
    // 続けて押されたら前の消し時計は捨てる(先の時計が、後の印を早く消さないように)。
    clearTimeout(section._recommendTimer);
    section.classList.remove('plan-recommend-target');
    void section.offsetWidth;
    section.classList.add('plan-recommend-target');
    section._recommendTimer = setTimeout(function () { section.classList.remove('plan-recommend-target'); }, 1600);
    var first = section.querySelector('.asset-tile');
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  // 欄の見出しを、上に貼り付いている共通操作(position:sticky)の**すぐ下**へ送る。
  //
  // サイドバーの scroll-padding は固定の 244px で、スマホでは共通操作のほうが
  // 高く(実測 330px)、scrollIntoView だと見出しがその下に隠れた。
  // その場の高さを測って送る量を決める。
  function reveal(sidebar, head, smooth) {
    var floor = sidebar.getBoundingClientRect().top;
    var common = sidebar.querySelector('.common-tools');
    if (common && getComputedStyle(common).position === 'sticky') {
      floor = Math.max(floor, common.getBoundingClientRect().bottom);
    }
    sidebar.scrollBy({ top: head.getBoundingClientRect().top - floor - 8, behavior: smooth ? 'smooth' : 'auto' });
  }

  root.PlanFinish = {
    analyze: analyze,
    applyPicks: applyPicks,
    recommendations: recommendations,
    orderHints: orderHints,
    shownRecommendations: shownRecommendations,
    openInCatalogue: openInCatalogue,
    mount: mount,
    // 検査から使う
    _roomsOf: roomsOf, _slotsOf: slotsOf, _kindOf: kindOf, _candidatesFor: candidatesFor,
    get result() { return ST.result; },
  };
}(typeof window === 'object' ? window : globalThis));
