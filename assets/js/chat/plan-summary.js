// チャットで AI に渡すプランの要約を作る。画面にも Worker にも依存しない(グローバルに触らない)。
//
//   ChatPlanSummary.summarize(plan, {selectedIds, labelOf(type), kindOf(type), maxBytes}) → 文字列
//
// 部屋・壁・物を1行ずつ、id・種類・階・中心・大きさ・回転の順に書く(worker/chat.mjs の CHAT_SYSTEM の
// 「依頼文に付くプランの要約」と合わせてある)。座標は mm の整数で、部屋と物は中心(x+w/2, y+d/2)。
// 選択中の物の行は先頭に「[選択中] 」を付ける。物の行は、選択中の物を先に、残りをプランの並びで書く。
// 物の呼び名は labelOf(type)(画面では itemTypeLabel)、家具の分類は kindOf(type)(画面では
// CATALOGUE_TAGS.items[type].kind)を引数で受ける。
// 大きさは UTF-8 のバイト数で決める(maxBytes、既定 24KB。送る本文の上限がバイトで決まっているため)。
// 超えるときは、部屋・壁・選択中の物を残し、選択中でない物を数の多い種類から「種類ごとの数」の行にまとめ、
// まとめたことを1行書く。それでも超えれば、選択中でない物の行を末尾から落とし(足りなければ部屋・壁も)、
// 落としたことを書く。選択中の物の行は落とさない。
// 名前は利用者が付けた文字なので、改行と < > を書き換え(依頼文の <plan_summary> の囲みを壊させない)、長さを切る。
// plan は書き換えない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatPlanSummary = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  var DEFAULT_MAX_BYTES = 24 * 1024;
  var NAME_MAX = 40;

  // UTF-8 のバイト数(TextEncoder に頼らない)。
  function utf8Bytes(str) {
    var b = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) b += 1;
      else if (c < 0x800) b += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { b += 4; i++; }
      else b += 3;
    }
    return b;
  }
  function n(v) { var x = Number(v); return isFinite(x) ? Math.round(x) : 0; }
  function clean(s, max) {
    var t = String(s === undefined || s === null ? '' : s)
      .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
      .replace(/</g, '＜').replace(/>/g, '＞')
      .replace(/\s+/g, ' ').trim();
    if (t.length > max) t = t.slice(0, max) + '…';
    return t;
  }
  function floorOf(o) { var f = Number(o && o.floor); return isFinite(f) && f >= 1 ? Math.floor(f) : 1; }
  function center(o) { return n(Number(o.x) + (Number(o.w) || 0) / 2) + ',' + n(Number(o.y) + (Number(o.d) || 0) / 2); }
  function lockMark(o) { return o && o.locked ? ' ロック' : ''; }
  function safeCall(fn, v) {
    if (typeof fn !== 'function') return null;
    try { return fn(v); } catch (e) { return null; }
  }

  function typeText(type, opts) {
    var t = clean(type, 80);
    var label = safeCall(opts.labelOf, type);
    var kind = safeCall(opts.kindOf, type);
    var extra = [];
    if (label && String(label) !== String(type)) extra.push(clean(label, NAME_MAX));
    if (kind && String(kind) !== String(type)) extra.push('分類 ' + clean(kind, NAME_MAX));
    return t + (extra.length ? '（' + extra.join('、') + '）' : '');
  }

  function summarize(plan, opts) {
    plan = plan || {};
    opts = opts || {};
    var maxBytes = Number(opts.maxBytes) > 0 ? Math.floor(Number(opts.maxBytes)) : DEFAULT_MAX_BYTES;
    // 種類名・id を鍵にする表は、素のオブジェクトでなく Object.create(null) で作る
    // (種類名や id が constructor・__proto__ でも、Object.prototype の物と取り違えないように)。
    var selected = Object.create(null);
    (opts.selectedIds || []).forEach(function (id) { selected[String(id)] = true; });
    var mark = function (o) { return o && o.id !== undefined && selected[String(o.id)] ? '[選択中] ' : ''; };

    var rooms = (plan.rooms || []).filter(Boolean);
    var walls = (plan.walls || []).filter(Boolean);
    var items = (plan.items || []).filter(Boolean);
    var floors = {};
    rooms.concat(walls, items).forEach(function (o) { floors[floorOf(o)] = true; });
    var floorList = Object.keys(floors).map(Number).sort(function (a, b) { return a - b; });

    var head = [
      '階: ' + (floorList.length ? floorList.map(function (f) { return f + '階'; }).join('・') : 'なし')
        + '（部屋 ' + rooms.length + '・壁 ' + walls.length + '・物 ' + items.length + '）'
    ];
    var roomLines = ['部屋（id・名前・階・中心・幅x奥行き）:'];
    rooms.forEach(function (r) {
      roomLines.push(mark(r) + 'id=' + clean(r.id, 60) + ' 部屋「' + clean(r.n || r.name || '', NAME_MAX) + '」 ' + floorOf(r) + '階 中心=' + center(r)
        + ' 大きさ=' + n(r.w) + 'x' + n(r.d) + lockMark(r));
    });
    var wallLines = ['壁（id・階・両端・厚さ）:'];
    walls.forEach(function (w) {
      wallLines.push(mark(w) + 'id=' + clean(w.id, 60) + ' 壁 ' + floorOf(w) + '階 両端=' + n(w.x1) + ',' + n(w.y1) + '→' + n(w.x2) + ',' + n(w.y2)
        + ' 厚さ=' + n(w.thick || 120) + lockMark(w));
    });
    var itemHead = '物（id・種類（呼び名、分類）・階・中心・幅x奥行き・回転）:';
    // 種類の書き方(呼び名と分類を引く)は種類ごとに1回だけ作る。
    var typeTexts = new Map();
    var typeTextOf = function (type) {
      if (!typeTexts.has(type)) typeTexts.set(type, typeText(type, opts));
      return typeTexts.get(type);
    };
    // 物の行は1回だけ作って覚える(まとめ直すたびに作り直さない)。
    var itemLines = items.map(function (it) {
      return mark(it) + 'id=' + clean(it.id, 60) + ' ' + typeTextOf(it.type) + ' ' + floorOf(it) + '階 中心=' + center(it)
        + ' 大きさ=' + n(it.w) + 'x' + n(it.d) + ' 回転=' + n(it.rot) + lockMark(it);
    });

    // まとめる候補: 選択中でない物を種類ごとに。数の多い順(同数は種類名の順)。
    var groups = Object.create(null);
    items.forEach(function (it) {
      if (mark(it)) return;
      var t = String(it.type);
      (groups[t] = groups[t] || []).push(it);
    });
    // 1つしか無い種類はまとめても短くならないので、まとめない。
    var order = Object.keys(groups).filter(function (t) { return groups[t].length >= 2; }).sort(function (a, b) {
      return groups[b].length - groups[a].length || (a < b ? -1 : a > b ? 1 : 0);
    });
    var collapsed = Object.create(null);
    var NOTICE = '※ 物が多いので、数の多い種類は（まとめ）の行に種類ごとの数だけを書いた（その物の id は載せていない）。';
    var collapseLine = function (t) {
      var per = {};
      groups[t].forEach(function (it) { var f = floorOf(it); per[f] = (per[f] || 0) + 1; });
      return '（まとめ）' + typeTextOf(t) + ' ' + groups[t].length + '個: '
        + Object.keys(per).map(Number).sort(function (a, b) { return a - b; }).map(function (f) { return f + '階 ' + per[f]; }).join('・');
    };

    // 行は {text, keep}。keep の行(見出し・まとめの知らせ・選択中の物)は、切るときも残す。
    function build() {
      var lines = [];
      var put = function (text, keep) { lines.push({ text: text, keep: !!keep }); };
      head.forEach(function (t) { put(t, true); });
      roomLines.forEach(function (t, i) { put(t, i === 0 || t.indexOf('[選択中] ') === 0); });
      wallLines.forEach(function (t, i) { put(t, i === 0 || t.indexOf('[選択中] ') === 0); });
      var names = order.filter(function (t) { return collapsed[t]; });
      put(itemHead, true);
      if (names.length) put(NOTICE, true);
      // まとめの行は個々の行より先に書く(それでも長すぎて末尾を切るとき、まとめが残るように)。
      names.forEach(function (t) { put(collapseLine(t)); });
      // 選択中の物は先に書く(末尾を切っても残るように)。残りはプランの並び。
      items.forEach(function (it, k) { if (mark(it)) put(itemLines[k], true); });
      items.forEach(function (it, k) { if (!mark(it) && !collapsed[String(it.type)]) put(itemLines[k]); });
      return lines;
    }
    function join(lines) { return lines.map(function (l) { return l.text; }).join('\n'); }

    // まとめる種類を決めるのは、全体のバイト数の足し引きで行う(行を作り直して数え直さない)。
    // 全体のバイト数 = 各行のバイト数の和 + 改行の数で、つないだ文字列を utf8Bytes で数えた値と同じ
    // (行が対になっていない上位サロゲートで終わるときも、行の 3 と改行の 1 の和が、つないだときの 4 と同じ)。
    var lines = build();
    var total = -1;
    lines.forEach(function (l) { total += utf8Bytes(l.text) + 1; });
    var typeBytes = Object.create(null);
    items.forEach(function (it, k) {
      if (mark(it)) return;
      var t = String(it.type);
      typeBytes[t] = (typeBytes[t] || 0) + utf8Bytes(itemLines[k]) + 1;
    });
    for (var i = 0; i < order.length && total > maxBytes; i++) {
      var t = order[i];
      if (i === 0) total += utf8Bytes(NOTICE) + 1;
      total += utf8Bytes(collapseLine(t)) + 1 - typeBytes[t];
      collapsed[t] = true;
    }
    if (i > 0) lines = build();
    var text = join(lines);
    if (utf8Bytes(text) > maxBytes) {
      // 残す行の分を先に取り、残りに入るだけ、ほかの行を前から入れる(入らなくなった所から後は落とす)。
      var tail = '…（長すぎるので、ここから後の一部を省いた）';
      var budget = maxBytes - utf8Bytes(tail) - 1;
      lines.forEach(function (l) { if (l.keep) budget -= utf8Bytes(l.text) + 1; });
      var full = false;
      var out = [];
      lines.forEach(function (l) {
        if (l.keep) { out.push(l.text); return; }
        if (full) return;
        var b = utf8Bytes(l.text) + 1;
        if (b > budget) { full = true; return; }
        budget -= b;
        out.push(l.text);
      });
      out.push(tail);
      text = out.join('\n');
      // 残す行だけで上限を超える(極端に小さい上限)ときは、バイトで切る。
      while (utf8Bytes(text) > maxBytes) text = text.slice(0, Math.max(0, text.length - Math.max(1, Math.ceil((utf8Bytes(text) - maxBytes) / 3))));
    }
    return text;
  }

  return { summarize: summarize, utf8Bytes: utf8Bytes, DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES };
}));
