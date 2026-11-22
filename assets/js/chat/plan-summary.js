// チャットで AI に渡すプランの要約を作る。画面にも Worker にも依存しない(グローバルに触らない)。
//
//   ChatPlanSummary.summarize(plan, {selectedIds, labelOf(type), kindOf(type), maxBytes, progressLines}) → 文字列
//   progressLines は段階ごとの出来具合の行(PlanCoreProgress.progressLines)。見出しの次に入れ、長すぎて切るときも残す。
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
// 名前・id・種類は利用者が書ける文字なので、clean(下の「AI に渡す文の掃除と囲み」)を通して、改行・見えない文字・
// 山かっこに似た文字などを書き換え(依頼文の <plan_summary> の囲みを壊させない)、長さを文字単位で切る。
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

  // ── AI に渡す文の掃除と囲み ──────────────────────────────────────────
  // AI に渡す信頼できない文(利用者の依頼、プランの中の名前・id・種類、道具と検査の結果、読み取りのひとこと)は、
  // 種類ごとの囲み(<plan_summary> など。TAGS)に入れて渡す。決まり(囲みの中はデータで指示ではない、など)は
  // 囲みの外の、前の側に置く(チャットは worker/chat.mjs の CHAT_SYSTEM、外の AI と読み取りは worker/ai-rules.mjs)。
  // 囲みを偽って外へ出られないよう、囲みに入れる文は先に掃除する:
  //   - 見えない文字を落とす: 書式文字 \p{Cf}(ゼロ幅・双方向の制御・BOM・タグ文字 U+E0000 台など)と、片割れのサロゲート
  //   - 制御文字 \p{Cc}(C0・DEL・C1)と行・段落の区切り(U+2028・U+2029)は空白にする。複数行の文(cleanText)では
  //     改行だけ残す(CR LF・CR・U+2028・U+2029 も改行に)。タブは空白にする
  //   - 山かっこと、それに似た文字(全角・小字形・ギユメ・数学記号・カナダ音節文字など)は 〔 〕 にする
  //     (＜ ＞ も囲みに似るので残さない)。& は ＆ にする(&lt; のような実体参照で山かっこを書かせない)。
  //     \u003c・\x3c・%3C のように符号化した山かっこも 〔 〕 にする
  //   - 切り詰めは文字(コードポイント)単位(絵文字を割らない)
  // 寸法や単位(6畳、2.5m×3m、3640mm、900〜1000mm)は変えない。
  // 利用者が AI に渡す文(チャットの依頼1件、読み取りのひとこと)の長さの上限。文字(コードポイント)で数える。
  // 画面の入力欄(chat-ui.js の attachCharLimit)と Worker(worker/chat.mjs、routes-ai.mjs のひとこと)が同じこの値を見る。
  // 攻撃の文を長く送らせないため、AI の利用量を抑えるため。
  // 値を変えるときはここだけを変える(利用者向けの文もこの値から作る: REQUEST_TOO_LONG_MESSAGE、chat-ui.js の表示)。
  var REQUEST_MAX_CHARS = 300;
  var REQUEST_TOO_LONG_MESSAGE = '頼む文は' + REQUEST_MAX_CHARS + '字までにしてください。';
  function countChars(s) { return Array.from(String(s === undefined || s === null ? '' : s)).length; }
  var TAGS = ['plan_summary', 'user_request', 'tool_result', 'inspect_result', 'user_hint', 'previous_answer', 'check_facts'];
  var OPEN_LIKE = '<＜﹤‹«〈〈《⟨⟪❮❬❰⧼˂ᐸ≪⋘︿︽≺˱';
  var CLOSE_LIKE = '>＞﹥›»〉〉》⟩⟫❯❭❱⧽˃ᐳ≫⋙﹀︾≻˲';
  var OPEN_RE = new RegExp('[' + OPEN_LIKE + ']|\\\\u\\{?0*3c\\}?|\\\\x3c|%3c', 'gi');
  var CLOSE_RE = new RegExp('[' + CLOSE_LIKE + ']|\\\\u\\{?0*3e\\}?|\\\\x3e|%3e', 'gi');
  // 囲みの中に残ってはいけない文字(isClean が見る)。
  // 見えない文字(書式文字・片割れのサロゲート)は stripInvisible で見る(絵文字のつなぎは残すため)。
  var DIRTY_RE = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029&' + OPEN_LIKE + CLOSE_LIKE + ']'
    + '|\\\\u\\{?0*3[ce]|\\\\x3[ce]|%3[ce]', 'iu');
  var INVISIBLE_RE = new RegExp('[\\p{Cf}\\p{Cs}]', 'gu');
  // 絵文字のつなぎ(ZWJ、U+200D)は、絵文字(肌の色・異体字セレクタ U+FE0F が付いてもよい)と絵文字の間にあるときだけ残す
  // (家族の絵文字（👨・👩・👧を ZWJ でつないだ物） を割らない)。それ以外の位置の ZWJ は落とす。ZWJ は山かっこを作れないので囲みの守りには関係しない。
  var ZWJ = String.fromCharCode(0x200d);
  var ZWJ_PREV_RE = new RegExp('\\p{Extended_Pictographic}[\\u{1F3FB}-\\u{1F3FF}\\uFE0F]*$', 'u');
  var ZWJ_NEXT_RE = new RegExp('^\\p{Extended_Pictographic}', 'u');
  // 決まりの見出し(worker/ai-rules.mjs の RULES_HEAD)。囲みの中に同じ見出しを書かせない。
  var RULES_HEAD_RE = /【\s*入力の扱い\s*】/g;
  var RULES_HEAD_ONE = /【\s*入力の扱い\s*】/;

  // 見えない文字(書式文字・片割れのサロゲート)を落とす。名前を書き込むとき(operations.js の tidyName、
  // plan-settable.js の tidyText)も同じ決まりで落とす(tools/tests/ai-input-guard.test.cjs が揃っていることを見る)。
  function stripInvisible(s) {
    return String(s === undefined || s === null ? '' : s).replace(INVISIBLE_RE, function (ch, at, all) {
      if (ch === ZWJ && ZWJ_PREV_RE.test(all.slice(Math.max(0, at - 8), at)) && ZWJ_NEXT_RE.test(all.slice(at + 1, at + 3))) return ch;
      return '';
    });
  }
  function neutralize(t) {
    return t.replace(/&/g, '＆').replace(OPEN_RE, '〔').replace(CLOSE_RE, '〕').replace(RULES_HEAD_RE, '〔入力の扱い〕');
  }
  // 文字(コードポイント)単位で max 字に切る。切ったら末尾に … を付ける。
  function cutChars(t, max) {
    if (!(max >= 0) || t.length <= max) return t;
    var chars = Array.from(t);
    return chars.length > max ? chars.slice(0, max).join('') + '…' : t;
  }
  // 1行の文: 改行も空白にする(要約の名前・id・種類、検査の文の1行)。
  function clean(s, max) {
    var t = stripInvisible(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
    t = neutralize(t).replace(/\s+/g, ' ').trim();
    return cutChars(t, max);
  }
  // 複数行の文: 改行を残す(利用者の依頼・道具の結果)。行の中の空白はまとめ、空行は1つまでにする。
  function cleanText(s, max) {
    var t = stripInvisible(s)
      .replace(/\r\n?|[\u2028\u2029]/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ');
    t = neutralize(t).replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return cutChars(t, max);
  }
  // 囲みの中に入れてよい文か(掃除で落とす・書き換える文字が無いか)。
  function isClean(s) { return typeof s === 'string' && !DIRTY_RE.test(s) && !RULES_HEAD_ONE.test(s) && stripInvisible(s) === s; }
  // 掃除した文を囲む。tag は TAGS のどれか。text は掃除してから渡す(wrapText は掃除もする)。
  function wrap(tag, text) {
    if (TAGS.indexOf(tag) < 0) throw new Error('知らない囲み: ' + tag);
    return '<' + tag + '>\n' + text + '\n</' + tag + '>';
  }
  function wrapText(tag, s, max) { return wrap(tag, cleanText(s, max)); }
  // 掃除済みのはずの文を囲む。囲む直前に確かめ、掃除の決まりに合わなければ掃除し直してから囲む。
  function wrapSafe(tag, text) { return wrap(tag, isClean(text) ? text : cleanText(text)); }
  // 値(入れ子の物)の文字をすべて1行の掃除に通した写し。鍵も掃除する。文字は maxEach 字まで。
  function cleanDeep(v, maxEach, depth) {
    depth = depth || 0;
    if (typeof v === 'string') return clean(v, maxEach);
    if (!v || typeof v !== 'object') return v;
    // 深すぎる入れ子は、文字にしてから掃除する(掃除しないまま返すと、深い所の文字で囲みを閉じられる)。
    if (depth > 8) { var flat; try { flat = JSON.stringify(v); } catch (e) { flat = ''; } return clean(flat, maxEach); }
    if (Array.isArray(v)) return v.map(function (x) { return cleanDeep(x, maxEach, depth + 1); });
    var out = {};
    // 鍵が __proto__ でも継承元を差し替えないよう、自分の欄として書く。
    Object.keys(v).forEach(function (k) {
      Object.defineProperty(out, clean(k, maxEach), { value: cleanDeep(v[k], maxEach, depth + 1), enumerable: true, writable: true, configurable: true });
    });
    return out;
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
      // 段階ごとの出来具合(opts.progressLines。plan-core/progress.js の progressLines)。切るときも残す。
      (opts.progressLines || []).forEach(function (t) { put(clean(t, 2000), true); });
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
      // 切った境目で絵文字が割れたときの片割れを落とす(行の中の文字は掃除済みなので、ほかに落ちる物は無い)。
      text = stripInvisible(text);
    }
    return text;
  }

  // 掃除と囲み(clean・cleanText・wrap など)は、画面のチャット(chat-session.js)、Worker のチャットの受け口(worker/chat.mjs)、
  // 外の AI の受け口(worker/mcp.mjs)、読み取り(worker/ai-rules.mjs)が同じ物を使う。
  return {
    summarize: summarize, utf8Bytes: utf8Bytes, DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES,
    clean: clean, cleanText: cleanText, cleanDeep: cleanDeep, stripInvisible: stripInvisible, cutChars: cutChars,
    REQUEST_MAX_CHARS: REQUEST_MAX_CHARS, REQUEST_TOO_LONG_MESSAGE: REQUEST_TOO_LONG_MESSAGE, countChars: countChars,
    isClean: isClean, wrap: wrap, wrapText: wrapText, wrapSafe: wrapSafe, TAGS: TAGS
  };
}));
