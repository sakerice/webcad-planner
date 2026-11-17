// チャットで AI に渡すプランの要約を作る。画面にも Worker にも依存しない(グローバルに触らない)。
//
//   ChatPlanSummary.summarize(plan, {selectedIds, labelOf(type), kindOf(type), maxChars}) → 文字列
//
// 部屋・壁・物を1行ずつ、id・種類・階・中心・大きさ・回転の順に書く(worker/chat.mjs の CHAT_SYSTEM の
// 「依頼文に付くプランの要約」と合わせてある)。座標は mm の整数で、部屋と物は中心(x+w/2, y+d/2)。
// 選択中の物の行は先頭に「[選択中] 」を付ける。物の行は、選択中の物を先に、残りをプランの並びで書く。
// 物の呼び名は labelOf(type)(画面では itemTypeLabel)、家具の分類は kindOf(type)(画面では
// CATALOGUE_TAGS.items[type].kind)を引数で受ける。
// maxChars(既定 40,000)を超えるときは、選択中でない物を、数の多い種類から「種類ごとの数」の行にまとめ、
// まとめたことを1行書く。それでも超えれば、末尾を切って切ったことを書く。
// 名前は利用者が付けた文字なので、改行と < > を書き換え(依頼文の <plan_summary> の囲みを壊させない)、長さを切る。
// plan は書き換えない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatPlanSummary = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  var DEFAULT_MAX_CHARS = 40000;
  var NAME_MAX = 40;

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
    var maxChars = Number(opts.maxChars) > 0 ? Math.floor(Number(opts.maxChars)) : DEFAULT_MAX_CHARS;
    var selected = {};
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
    var itemLine = function (it) {
      return mark(it) + 'id=' + clean(it.id, 60) + ' ' + typeText(it.type, opts) + ' ' + floorOf(it) + '階 中心=' + center(it)
        + ' 大きさ=' + n(it.w) + 'x' + n(it.d) + ' 回転=' + n(it.rot) + lockMark(it);
    };

    // まとめる候補: 選択中でない物を種類ごとに。数の多い順(同数は種類名の順)。
    var groups = {};
    items.forEach(function (it) {
      if (mark(it)) return;
      var t = String(it.type);
      (groups[t] = groups[t] || []).push(it);
    });
    // 1つしか無い種類はまとめても短くならないので、まとめない。
    var order = Object.keys(groups).filter(function (t) { return groups[t].length >= 2; }).sort(function (a, b) {
      return groups[b].length - groups[a].length || (a < b ? -1 : a > b ? 1 : 0);
    });
    var collapsed = {};

    function build() {
      var lines = head.concat(roomLines, wallLines);
      var names = order.filter(function (t) { return collapsed[t]; });
      lines.push(itemHead);
      if (names.length) lines.push('※ 物が多いので、数の多い種類は（まとめ）の行に種類ごとの数だけを書いた（その物の id は載せていない）。');
      // まとめの行は個々の行より先に書く(それでも長すぎて末尾を切るとき、まとめが残るように)。
      names.forEach(function (t) {
        var per = {};
        groups[t].forEach(function (it) { var f = floorOf(it); per[f] = (per[f] || 0) + 1; });
        lines.push('（まとめ）' + typeText(t, opts) + ' ' + groups[t].length + '個: '
          + Object.keys(per).map(Number).sort(function (a, b) { return a - b; }).map(function (f) { return f + '階 ' + per[f]; }).join('・'));
      });
      // 選択中の物は先に書く(末尾を切っても残るように)。残りはプランの並び。
      items.forEach(function (it) { if (mark(it)) lines.push(itemLine(it)); });
      items.forEach(function (it) { if (!mark(it) && !collapsed[String(it.type)]) lines.push(itemLine(it)); });
      return lines;
    }

    var lines = build();
    var text = lines.join('\n');
    for (var i = 0; i < order.length && text.length > maxChars; i++) {
      collapsed[order[i]] = true;
      lines = build();
      text = lines.join('\n');
    }
    if (text.length > maxChars) {
      var tail = '…（長すぎるので、ここから後を省いた）';
      var out = [];
      var len = 0;
      for (var k = 0; k < lines.length; k++) {
        var add = (out.length ? 1 : 0) + lines[k].length;
        if (len + add + 1 + tail.length > maxChars) break;
        out.push(lines[k]);
        len += add;
      }
      out.push(tail);
      text = out.join('\n');
      if (text.length > maxChars) text = text.slice(0, maxChars);
    }
    return text;
  }

  return { summarize: summarize, DEFAULT_MAX_CHARS: DEFAULT_MAX_CHARS };
}));
