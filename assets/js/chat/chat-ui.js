// チャット欄(画面)。言葉で頼むと AI が間取りを直す。
//
//   openChat() / closeChat()    パネルを開く・閉じる(依頼中に閉じると依頼を取り消す)
//   applyChatResult(result)     ChatSession.send の成功の結果(AI が直した写し)を本物のプランに入れる
//   ChatUI.state()              {open, busy, hasSession, entries}(テスト用の覗き窓)
//
// 部品は assets/js/chat/ の ChatSession(1回の依頼の往復)・ChatPlanSummary(要約)と、
// assets/js/plan-data.js の planChatCtx(操作を写しに当てる ctx)。
// 1度も開かない人には、開くボタンが1つあるだけにする。ChatSession もキー操作の見張りも、初めて開いたときに作る。
//
// 本物のプランに触るのは applyChatResult だけで、手順は読み取りの取り込み(plan-import.js の applyPlanImport)の
// 後始末に揃えてある: saveState を1回 → 入れ替え → 選択を解く → normalizeLoadedPlan → sharedForceFullSync → markDirty → 描画。
// 1回の依頼で入った変更は、取り消し1回で全部戻る。
// 依頼の途中で本物のプランが変わったとき(共同編集の相手の変更など)は、写しで上書きせずに断る。
// 依頼の始め(ChatSession が getPlan を呼んだとき)の印と、取り込む直前の印を比べて見つける。
//
// やり取りの一覧はページを開いている間だけ持つ(閉じて開き直すと見える。保存はしない)。
(function (root) {
  'use strict';

  var INTRO = '言葉で頼むと、間取りを直します。直した内容は「元に戻す」で取り消せます。';
  // 例は、今の部品で実際にできること(部屋を足す・家具を置く・選んだ物を消す)だけにする。
  var EXAMPLES = ['リビングにソファとテレビを置いて', '2階に6畳の子ども部屋を足して', '選んでいる物を1つ消して'];
  var CONFLICT_MESSAGE = '作業中にプランが変わったため、変更を取り込みませんでした。もう一度お試しください。';
  var NO_TEXT = '（文の返事はありませんでした）';
  var UNDONE_NOTE = '元に戻しました';
  var THINKING = '考えています…';
  var TAGS_WAITING = '家具の一覧を読み込んでいます…';
  var TAGS_WAIT_MS = 20000;
  // 取り込む欄。壁・物・部屋と、操作の後始末(planOpsCtx の hooks)が書く外壁の設定表。
  // 視点(viewState)・階・高さの既定・屋根の見た目など、操作が書かない欄は本物のまま残す。
  var APPLY_FIELDS = ['walls', 'rooms', 'items', 'exteriorWallSettings'];

  var S = {
    session: null,     // ChatSession(初めて開いたときに作る)
    open: false,
    busy: false,
    entries: [],       // やり取りの一覧 {kind:'chat'|'note', user, ai, status, undoable, undone, cancelled}
    current: null,     // 依頼中のやり取り
    fp: null,          // 依頼の始めの本物のプランの印
    undo: null,        // 最後に取り込んだ依頼の取り消しの印 {len, top, entry}
    undoTimer: null,
    remaining: null,
    tagsGaveUp: false, // カタログの札を待ちきれなかった(以後は待たない)
    wired: false
  };

  function $(id) { return document.getElementById(id); }
  function g(name) { return root[name]; }
  function call(name) {
    var fn = root[name];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(root, Array.prototype.slice.call(arguments, 1));
  }

  // ── 本物のプランの印 ───────────────────────────────────────────────
  // 壁・物・部屋と共同編集で共有する欄の JSON の長さと簡単なハッシュ。_ で始まる欄(描画の記憶など)は見ない。
  function sharedFields() {
    var P = g('PlanCorePatch');
    return P && P.SHARED_FIELDS ? P.SHARED_FIELDS : [];
  }
  function fingerprint(plan) {
    if (!plan) return '';
    var o = {};
    ['walls', 'rooms', 'items'].concat(sharedFields()).forEach(function (k) { o[k] = plan[k] === undefined ? null : plan[k]; });
    var s = JSON.stringify(o, function (k, v) { return k.charAt(0) === '_' ? undefined : v; });
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return s.length + ':' + h.toString(16);
  }

  // ── 部品の組み立て ─────────────────────────────────────────────────
  function selectedIds() {
    var ST = g('ST');
    if (!ST) return [];
    var out = [];
    var add = function (o) { if (o && o.id !== undefined && out.indexOf(o.id) < 0) out.push(o.id); };
    add(ST.selected);
    (ST.multiSelected || []).forEach(add);
    return out;
  }
  function kindOf(t) {
    var tags = g('CATALOGUE_TAGS');
    return tags && tags.items && tags.items[t] ? tags.items[t].kind : null;
  }
  function ensureSession() {
    if (S.session) return S.session;
    S.session = root.ChatSession.create({
      // 呼ぶ時点の window.fetch を使う(差し替えられていてもそれに従う)。
      fetch: function (url, init) { return root.fetch(url, init); },
      getPlan: function () { S.fp = fingerprint(g('DATA')); return g('DATA'); },
      ctxFor: function () { return call('planChatCtx'); },
      tools: {
        checkArgs: function (name, input) { return root.PlanCoreOperationsCatalog.checkArgs(name, input); },
        applyOperations: function (plan, ops, ctx) { return root.PlanCoreOperations.applyOperations(plan, ops, ctx); },
        clonePlan: function (plan) { return root.PlanCoreOperations.clonePlan(plan); },
        inspectPlan: function (plan) { return root.PlanCoreInspect.inspectPlan(plan, { defaults: g('ISIZES') }); }
      },
      summarize: function (plan) {
        return root.ChatPlanSummary.summarize(plan, {
          selectedIds: selectedIds(),
          labelOf: function (t) { return typeof root.itemTypeLabel === 'function' ? root.itemTypeLabel(t) : t; },
          kindOf: kindOf
        });
      },
      onEvent: onEvent,
      AbortController: root.AbortController
    });
    wireGlobal();
    return S.session;
  }

  // 依頼中の見張り(初めて開いたときに1度だけ付ける)。
  function wireGlobal() {
    if (S.wired) return;
    S.wired = true;
    // 依頼中は、編集のキー操作(Delete・Ctrl+Z・矢印・r など)を、画面の受け口(index.html の2か所)より先に止める。
    // パネルの中のボタンの Enter・Space・Tab は、押す操作として通す(画面の受け口には渡さない)。
    root.addEventListener('keydown', function (e) {
      if (!S.busy) return;
      var t = e.target;
      var inPanel = !!(t && t.closest && t.closest('#chat-panel'));
      var k = e.key;
      if (inPanel && (k === 'Tab' || k === 'Enter' || k === ' ' || k === 'Escape')) { e.stopImmediatePropagation(); return; }
      if (k === 'Tab') return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
    // ページを離れるときは通信を止める(本物のプランは取り込むまで変わらない)。
    root.addEventListener('pagehide', function () { if (S.busy) cancelChat(); });
  }

  // ── 進み具合 ───────────────────────────────────────────────────────
  function onEvent(ev) {
    var e = S.current;
    if (!e || !ev) return;
    if (ev.type === 'round') {
      if (e.ai) e.needBreak = true;
      setProgress(THINKING);
    } else if (ev.type === 'text') {
      if (e.needBreak) { e.ai = e.ai.replace(/\s+$/, '') + '\n'; e.needBreak = false; }
      e.ai += String(ev.delta || '');
      updateEntry(e);
    } else if (ev.type === 'tool') {
      setProgress(ev.label || '間取りを直しています');
    } else if (ev.type === 'remaining') {
      S.remaining = ev.left;
      renderRemaining();
    }
    // thinking(考えの要約)は出さない。
  }
  function setProgress(text) {
    var p = $('chat-progress');
    if (!p) return;
    p.textContent = text || '';
    p.hidden = !text;
  }
  function renderRemaining() {
    var el = $('chat-remaining');
    if (!el) return;
    var n = S.remaining;
    if (n === null || n === undefined || !isFinite(n)) { el.hidden = true; return; }
    el.textContent = '本日あと ' + Math.max(0, Math.floor(n)) + ' 回 頼めます';
    el.hidden = false;
  }

  // ── 一覧の描画 ─────────────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function render() {
    var log = $('chat-log');
    if (!log) return;
    log.textContent = '';
    if (!S.entries.length) {
      var intro = el('div', 'chat-intro');
      intro.appendChild(el('p', 'chat-intro-text', INTRO));
      var ex = el('div', 'chat-examples');
      EXAMPLES.forEach(function (t) {
        var b = el('button', 'chat-example', t);
        b.type = 'button';
        b.addEventListener('click', function () {
          var inp = $('chat-input');
          if (!inp || S.busy) return;
          inp.value = t;
          inp.focus();
        });
        ex.appendChild(b);
      });
      intro.appendChild(ex);
      log.appendChild(intro);
    }
    S.entries.forEach(function (e) { log.appendChild(entryNode(e)); });
    log.scrollTop = log.scrollHeight;
  }
  function entryNode(e) {
    var box = el('div', 'chat-entry' + (e.kind === 'note' ? ' chat-entry-note' : ''));
    e.node = box;
    fillEntry(e);
    return box;
  }
  function fillEntry(e) {
    var box = e.node;
    if (!box) return;
    box.textContent = '';
    if (e.kind === 'note') { box.appendChild(el('div', 'chat-ai chat-ai-note', e.ai)); return; }
    box.appendChild(el('div', 'chat-user', e.user));
    var ai = el('div', 'chat-ai' + (e.status === 'error' ? ' is-error' : '') + (e.status === 'pending' ? ' is-pending' : ''));
    if (e.ai) ai.appendChild(el('span', 'chat-ai-text', e.ai));
    if (e.undone) ai.appendChild(el('span', 'chat-ai-undone', UNDONE_NOTE));
    if (e.ai || e.undone) box.appendChild(ai);
    if (e.undoable && !e.undone) {
      var u = el('button', 'pbtn sec chat-undo', '元に戻す');
      u.type = 'button';
      u.addEventListener('click', function () { undoEntry(e); });
      box.appendChild(u);
    }
  }
  function updateEntry(e) {
    fillEntry(e);
    var log = $('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  // ── 依頼中 ─────────────────────────────────────────────────────────
  function setBusy(b) {
    S.busy = !!b;
    var cover = $('chat-busy-cover');
    if (cover) cover.hidden = !b;
    var inp = $('chat-input');
    if (inp) inp.disabled = !!b;
    var send = $('chat-send');
    if (send) send.hidden = !!b;
    var stop = $('chat-stop');
    if (stop) stop.hidden = !b;
    var att = $('chat-attach');
    if (att) att.disabled = !!b;
    var panel = $('chat-panel');
    if (panel) panel.classList.toggle('is-busy', !!b);
    if (!b) setProgress('');
  }

  // カタログの札(CATALOGUE_TAGS)を読み終える前は、家具の分類を引けない(部品が「読み込み中」で断る)。
  // 起動直後に頼まれたら、読み終えるまで待ってから送る。待ちきれなければそのまま送る(部屋の操作などはできる)。
  function waitForTags(entry) {
    if (g('CATALOGUE_TAGS') || S.tagsGaveUp) return Promise.resolve();
    setProgress(TAGS_WAITING);
    var start = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        if (entry.cancelled || g('CATALOGUE_TAGS')) { resolve(); return; }
        if (Date.now() - start > TAGS_WAIT_MS) { S.tagsGaveUp = true; resolve(); return; }
        setTimeout(tick, 150);
      }());
    });
  }

  function sendChat(text) {
    text = String(text === undefined || text === null ? '' : text).trim();
    if (!text || S.busy) return;
    var session = ensureSession();
    var entry = { kind: 'chat', user: text, ai: '', status: 'pending' };
    S.entries.push(entry);
    S.current = entry;
    var inp = $('chat-input');
    if (inp) inp.value = '';
    render();
    setBusy(true);
    var M = root.ChatSession.MESSAGES;
    waitForTags(entry).then(function () {
      if (entry.cancelled) return { ok: false, reason: 'cancelled', message: M.cancelled };
      setProgress(THINKING);
      return session.send(text);
    }).then(function (r) { finishEntry(entry, r); }, function () {
      finishEntry(entry, { ok: false, reason: 'failed', message: M.failed });
    });
  }

  function finishEntry(entry, r) {
    if (S.current === entry) S.current = null;
    r = r || { ok: false, reason: 'failed', message: root.ChatSession.MESSAGES.failed };
    if (entry.cancelled && r.ok) r = { ok: false, reason: 'cancelled', message: root.ChatSession.MESSAGES.cancelled };
    if (r.ok) {
      var text = entry.ai.replace(/\s+$/, '') || r.text || NO_TEXT;
      if (r.changed > 0) {
        var res = applyChatResult(r);
        if (res.applied) {
          entry.ai = text;
          entry.status = 'done';
          entry.undoable = true;
          S.undo.entry = entry;
          startUndoWatch();
        } else {
          entry.ai = res.reason === 'conflict' ? CONFLICT_MESSAGE : root.ChatSession.MESSAGES.failed;
          entry.status = 'error';
        }
      } else {
        entry.ai = text;
        entry.status = 'done';
      }
    } else {
      // 失敗の文は部品の文そのまま。途中まで届いた AI の文は、変わっていない間取りを「直した」と読めるので出さない。
      entry.ai = r.message || root.ChatSession.MESSAGES.failed;
      entry.status = 'error';
    }
    S.fp = null;
    setBusy(false);
    updateEntry(entry);
  }

  function cancelChat() {
    var e = S.current;
    if (!e) return;
    e.cancelled = true;
    if (S.session) S.session.cancel();
  }

  // ── 取り込み ───────────────────────────────────────────────────────
  // 成功の結果の写しを本物のプランに入れる。戻り値 {applied, reason}。reason は 'unchanged'・'conflict'・'failed'。
  function applyChatResult(result) {
    if (!result || !result.ok || !result.plan) return { applied: false, reason: 'failed' };
    if (!(result.changed > 0)) return { applied: false, reason: 'unchanged' };
    var DATA = g('DATA');
    if (!DATA || S.fp === null || fingerprint(DATA) !== S.fp) return { applied: false, reason: 'conflict' };
    var work = result.plan;
    call('saveState');
    APPLY_FIELDS.forEach(function (k) { if (work[k] !== undefined) DATA[k] = work[k]; });
    root._defaultPlanPending = false;
    var ST = g('ST');
    if (ST) { ST.selected = null; ST.selectAll = false; }
    call('clearMultiSelection');
    var props = $('props');
    if (props) props.classList.remove('show');
    call('normalizeLoadedPlan', { resetHeights: false, restoreView: false });
    call('sharedForceFullSync');
    call('markDirty');
    call('draw2d');
    if (g('ren')) call('rebuild3D');
    S.fp = null;
    var H = g('HISTORY') || [];
    S.undo = { len: H.length, top: H[H.length - 1], entry: null };
    return { applied: true };
  }

  // ── 元に戻す ───────────────────────────────────────────────────────
  // 取り込みのあとに利用者が別の編集をした・取り消した(取り消しの履歴が変わった)ら、ボタンを消す。
  function undoValid() {
    var H = g('HISTORY') || [];
    return !!S.undo && H.length === S.undo.len && H[H.length - 1] === S.undo.top;
  }
  function dropUndo() {
    var u = S.undo;
    S.undo = null;
    if (S.undoTimer) { clearInterval(S.undoTimer); S.undoTimer = null; }
    if (u && u.entry) { u.entry.undoable = false; updateEntry(u.entry); }
  }
  function startUndoWatch() {
    if (S.undoTimer) clearInterval(S.undoTimer);
    S.undoTimer = setInterval(function () { if (!undoValid()) dropUndo(); }, 300);
  }
  function undoEntry(entry) {
    if (S.busy) return;
    if (!S.undo || S.undo.entry !== entry || !undoValid()) { dropUndo(); entry.undoable = false; updateEntry(entry); return; }
    S.undo.entry = null;
    dropUndo();
    call('undoAction');
    entry.undoable = false;
    entry.undone = true;
    updateEntry(entry);
  }

  // ── 図面の画像 ─────────────────────────────────────────────────────
  // 既存の読み取りをその画像で開く。チャット欄には1行だけ出す。
  function onChatFile(input) {
    var file = input && input.files && input.files[0];
    if (!file || S.busy) { if (input) input.value = ''; return; }
    call('openPlanImport');
    call('onPlanImportFile', { files: [file] });
    input.value = '';
    S.entries.push({ kind: 'note', ai: '図面の読み取りを開きました' });
    render();
  }

  // ── 開く・閉じる ───────────────────────────────────────────────────
  function wirePanel() {
    var inp = $('chat-input');
    if (inp && !inp._chatWired) {
      inp._chatWired = true;
      inp.addEventListener('keydown', function (e) {
        // 画面のキー操作(削除・取り消し・回転など)に渡さない。
        e.stopPropagation();
        if (e.key === 'Escape') { closeChat(); return; }
        if (e.key !== 'Enter' || e.shiftKey) return;
        // 日本語入力の変換中の Enter(確定)では送らない。
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        sendChat(inp.value);
      });
    }
    var send = $('chat-send');
    if (send && !send._chatWired) {
      send._chatWired = true;
      send.addEventListener('click', function () { sendChat($('chat-input').value); });
    }
    var stop = $('chat-stop');
    if (stop && !stop._chatWired) {
      stop._chatWired = true;
      stop.addEventListener('click', cancelChat);
    }
    var att = $('chat-attach');
    var file = $('chat-file');
    if (att && file && !att._chatWired) {
      att._chatWired = true;
      att.addEventListener('click', function () { if (!S.busy) file.click(); });
      file.addEventListener('change', function () { onChatFile(file); });
    }
  }

  function openChat() {
    var panel = $('chat-panel');
    if (!panel || !root.ChatSession) return;
    ensureSession();
    wirePanel();
    render();
    renderRemaining();
    S.open = true;
    panel.hidden = false;
    var fab = $('chat-fab');
    if (fab) { fab.classList.add('is-open'); fab.setAttribute('aria-expanded', 'true'); }
    if (S.undo && !undoValid()) dropUndo();
    // タッチの端末では、開いただけでキーボードを出さない。
    var coarse = false;
    try { coarse = root.matchMedia && root.matchMedia('(pointer:coarse)').matches; } catch (e) { coarse = false; }
    var inp = $('chat-input');
    if (inp && !coarse && !S.busy) inp.focus();
  }

  function closeChat() {
    if (S.busy) cancelChat();
    var panel = $('chat-panel');
    if (panel) panel.hidden = true;
    S.open = false;
    var fab = $('chat-fab');
    if (fab) { fab.classList.remove('is-open'); fab.setAttribute('aria-expanded', 'false'); }
  }

  root.openChat = openChat;
  root.closeChat = closeChat;
  root.applyChatResult = applyChatResult;
  root.ChatUI = {
    open: openChat,
    close: closeChat,
    send: sendChat,
    cancel: cancelChat,
    apply: applyChatResult,
    state: function () { return { open: S.open, busy: S.busy, hasSession: !!S.session, entries: S.entries.length }; }
  };
}(typeof window !== 'undefined' ? window : this));
