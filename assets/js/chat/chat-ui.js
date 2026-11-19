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
// 後始末に揃えてある: saveState を1回 → 入れ替え → 選択とドラッグを解く → normalizeLoadedPlan → sharedForceFullSync →
// markDirty → 描画。1回の依頼で入った変更は、取り消し1回で全部戻る。途中で例外が出たら、依頼の前の状態へ戻す。
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
  var APPLY_FAILED_MESSAGE = '変更を取り込めませんでした。間取りは依頼の前のままです。もう一度お試しください。';
  var UNDO_BLOCKED_MESSAGE = 'そのあとにプランが変わったため、元に戻せませんでした。';
  var DRAGGING_MESSAGE = '動かしている途中です。動かし終えてから送ってください。';
  var NO_TEXT = '（文の返事はありませんでした）';
  var UNDONE_NOTE = '元に戻しました';
  var THINKING = '考えています…';
  var TAGS_WAITING = '家具の一覧を読み込んでいます…';
  var TAGS_WAIT_MS = 20000;
  // 取り込む欄。壁・物・部屋と、操作の後始末(planOpsCtx の hooks)が書く外壁の設定表。
  // 視点(viewState)・階・高さの既定・屋根の見た目など、操作が書かない欄は本物のまま残す。
  var APPLY_FIELDS = ['walls', 'rooms', 'items', 'exteriorWallSettings'];
  // 印から外す欄。外壁の設定表は、3D の作り直し(モデルの読み終わりなど)でも欄が足される。
  // 利用者や相手の変更でなくても変わるので、比べると取り込みを誤って断る。
  var FINGERPRINT_SKIP = { exteriorWallSettings: true };

  var S = {
    session: null,     // ChatSession(初めて開いたときに作る)
    open: false,
    busy: false,
    entries: [],       // やり取りの一覧 {kind:'chat'|'note', user, ai, status, undoable, note, cancelled}
    current: null,     // 依頼中のやり取り
    fp: null,          // 依頼の始めの本物のプランの印
    undo: null,        // 最後に取り込んだ依頼の取り消しの印 {len, top, fp, entry}
    undoTimer: null,
    remaining: null,
    tagsGaveUp: false, // カタログの札を待ちきれなかった(以後は待たない)
    inerted: [],       // 依頼中に inert を付けた要素(終わったら必ず外す)
    wired: false
  };

  function $(id) { return document.getElementById(id); }
  function g(name) { return root[name]; }
  function call(name) {
    var fn = root[name];
    if (typeof fn !== 'function') return undefined;
    return fn.apply(root, Array.prototype.slice.call(arguments, 1));
  }
  function isCoarse() {
    try { return !!(root.matchMedia && root.matchMedia('(pointer:coarse)').matches); } catch (e) { return false; }
  }

  // ── 本物のプランの印 ───────────────────────────────────────────────
  // 壁・物・部屋と、共同編集で共有する欄(外壁の設定表を除く)の JSON の長さと簡単なハッシュ。
  // _ で始まる欄(描画の記憶など)は見ない。
  function fingerprintFields() {
    var P = g('PlanCorePatch');
    var shared = P && P.SHARED_FIELDS ? P.SHARED_FIELDS : [];
    return ['walls', 'rooms', 'items'].concat(shared.filter(function (k) { return !FINGERPRINT_SKIP[k]; }));
  }
  function fingerprint(plan) {
    if (!plan) return '';
    var o = {};
    fingerprintFields().forEach(function (k) { o[k] = plan[k] === undefined ? null : plan[k]; });
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
    root.addEventListener('resize', function () { if (S.busy) positionBusyNote(); });
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
      updateStreamingText(e);
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
    // 進み具合の1行が出ると一覧が縮むので、最後まで送り直す。
    scrollLog();
  }
  function renderRemaining() {
    var el = $('chat-remaining');
    if (!el) return;
    var n = S.remaining;
    if (n === null || n === undefined || !isFinite(n)) { el.hidden = true; return; }
    el.textContent = '本日あと ' + Math.max(0, Math.floor(n)) + ' 回 頼めます';
    el.hidden = false;
  }
  // 読み上げは、やり取りが1件終わったときに1度だけ(届いている途中の文は読ませない)。
  function announce(text) {
    var a = $('chat-announce');
    if (!a) return;
    a.textContent = '';
    setTimeout(function () { a.textContent = text || ''; }, 30);
  }

  // ── 一覧の描画 ─────────────────────────────────────────────────────
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function scrollLog() {
    var log = $('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
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
    scrollLog();
  }
  // やり取りを1件、一覧の末尾に足す(一覧全体は描き直さない)。
  function appendEntry(e) {
    var log = $('chat-log');
    if (!log) return;
    var intro = log.querySelector('.chat-intro');
    if (intro) intro.remove();
    log.appendChild(entryNode(e));
    scrollLog();
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
    e.textNode = null;
    if (e.kind === 'note') { box.appendChild(el('div', 'chat-ai chat-ai-note', e.ai)); return; }
    box.appendChild(el('div', 'chat-user', e.user));
    var ai = el('div', 'chat-ai' + (e.status === 'error' ? ' is-error' : '') + (e.status === 'pending' ? ' is-pending' : ''));
    var text = el('span', 'chat-ai-text', e.ai);
    ai.appendChild(text);
    e.textNode = text;
    if (e.note) ai.appendChild(el('span', 'chat-ai-undone', e.note));
    ai.hidden = !(e.ai || e.note);
    box.appendChild(ai);
    if (e.undoable) {
      var u = el('button', 'pbtn sec chat-undo', '元に戻す');
      u.type = 'button';
      u.addEventListener('click', function () { undoEntry(e); });
      box.appendChild(u);
    }
  }
  function updateEntry(e) {
    fillEntry(e);
    scrollLog();
  }
  // 届いている途中の AI の文だけを書き換える。
  function updateStreamingText(e) {
    if (!e.textNode) { updateEntry(e); return; }
    e.textNode.textContent = e.ai;
    if (e.textNode.parentNode) e.textNode.parentNode.hidden = !e.ai;
    scrollLog();
  }

  // ── 依頼中 ─────────────────────────────────────────────────────────
  // 覆いの後ろへ Tab でフォーカスが移らないよう、パネルと覆い以外の body の子に inert を付ける。
  function setInert(on) {
    if (on) {
      var kids = document.body ? document.body.children : [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.id === 'chat-panel' || k.id === 'chat-busy-cover' || k.id === 'chat-announce') continue;
        if (k.tagName === 'SCRIPT' || k.tagName === 'STYLE' || k.tagName === 'LINK') continue;
        if (k.inert || k.hasAttribute('inert')) continue;
        k.setAttribute('inert', '');
        S.inerted.push(k);
      }
    } else {
      S.inerted.forEach(function (k) { try { k.removeAttribute('inert'); } catch (e) { /* 無視 */ } });
      S.inerted = [];
    }
  }
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
    setInert(!!b);
    if (b) positionBusyNote();
    else setProgress('');
  }

  // 「AIが作業しています」は、作図の領域の中で、既存の部品に重ならない所に置く。
  // 上はツールバー・表示の切り替え・操作ガイドの下、下はチャットのシート(768px 以下)か下の行の上、
  // 左右はサイドバーと右に浮くパネル・設定欄の間。入りきらなければ上の端に寄せる。
  function rectOf(id) {
    var n = $(id);
    if (!n) return null;
    var cs = root.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    var r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= root.innerHeight || r.right <= 0 || r.left >= root.innerWidth) return null;
    return r;
  }
  function positionBusyNote() {
    var note = document.querySelector('#chat-busy-cover .chat-busy-note');
    if (!note) return;
    var vw = root.innerWidth, vh = root.innerHeight;
    var top = 12, bottom = vh - 12, left = 0, right = vw;
    ['toolbar', 'surface-control', 'help-box', 'walk-exit'].forEach(function (id) {
      var r = rectOf(id);
      if (r && r.top < vh / 2) top = Math.max(top, r.bottom + 12);
    });
    ['statusbar', 'app-version', 'coords', 'bottom-nav'].forEach(function (id) {
      var r = rectOf(id);
      if (r && r.top > vh / 2) bottom = Math.min(bottom, r.top - 12);
    });
    var panel = rectOf('chat-panel');
    if (panel) {
      if (panel.left < vw / 3) bottom = Math.min(bottom, panel.top - 12);   // 下からのシート
      else right = Math.min(right, panel.left - 12);                          // 右に浮く箱
    }
    var props = rectOf('props');
    if (props && props.left > vw / 2) right = Math.min(right, props.left - 12);
    var side = rectOf('sidebar');
    if (side && side.right < vw / 2 && side.height > vh / 3) left = Math.max(left, side.right + 12);
    var w = note.offsetWidth || 160, h = note.offsetHeight || 38;
    var x = (left + right) / 2 - w / 2;
    x = Math.max(8, Math.min(vw - w - 8, x));
    var y = bottom - top >= h ? (top + bottom) / 2 - h / 2 : top;
    note.style.left = Math.round(x) + 'px';
    note.style.top = Math.round(y) + 'px';
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

  function isDragging() {
    var D = g('DRAG'), G = g('GIZMO_DRAG');
    return !!((D && (D.active || D.marquee)) || (G && G.active));
  }

  function sendChat(text) {
    text = String(text === undefined || text === null ? '' : text).trim();
    if (!text || S.busy) return;
    // 画面で物を動かしている途中は始めない(取り込みでドラッグの相手が消えるため)。
    if (isDragging()) {
      S.entries.push({ kind: 'note', ai: DRAGGING_MESSAGE });
      appendEntry(S.entries[S.entries.length - 1]);
      return;
    }
    var session = ensureSession();
    var entry = { kind: 'chat', user: text, ai: '', status: 'pending' };
    S.entries.push(entry);
    S.current = entry;
    var inp = $('chat-input');
    if (inp) { inp.value = ''; if (inp._charLimitUpdate) inp._charLimitUpdate(); }
    appendEntry(entry);
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
    var M = root.ChatSession.MESSAGES;
    try {
      if (S.current === entry) S.current = null;
      r = r || { ok: false, reason: 'failed', message: M.failed };
      if (entry.cancelled && r.ok) {
        if (S.session) S.session.forgetLast();
        r = { ok: false, reason: 'cancelled', message: M.cancelled };
      }
      if (r.ok) {
        var text = entry.ai.replace(/\s+$/, '') || r.text || NO_TEXT;
        if (r.changed > 0) {
          // 新しく取り込む前に、前の「元に戻す」を片付ける(古いボタンで新しい取り込みを戻さないように)。
          dropUndo();
          var res = applyChatResult(r);
          if (res.applied) {
            entry.ai = text;
            entry.status = 'done';
            entry.undoable = true;
            S.undo.entry = entry;
            startUndoWatch();
          } else {
            // 取り込まなかった依頼は、部品の履歴からも外す(次の依頼で AI が「直した」と思わないように)。
            if (S.session) S.session.forgetLast();
            entry.ai = res.reason === 'conflict' ? CONFLICT_MESSAGE : APPLY_FAILED_MESSAGE;
            entry.status = 'error';
          }
        } else {
          entry.ai = text;
          entry.status = 'done';
        }
      } else {
        // 失敗の文は部品の文そのまま。途中まで届いた AI の文は、変わっていない間取りを「直した」と読めるので出さない。
        entry.ai = r.message || M.failed;
        entry.status = 'error';
      }
    } catch (err) {
      if (root.console && console.error) console.error('[chat] 依頼の後始末で例外が出ました', err);
      entry.ai = APPLY_FAILED_MESSAGE;
      entry.status = 'error';
      entry.undoable = false;
    } finally {
      // どこで例外が出ても、依頼中の状態(覆い・キー操作の止め・inert・印)は必ず解く。
      S.fp = null;
      if (S.current === entry) S.current = null;
      try { setBusy(false); } catch (e2) {
        S.busy = false;
        var cover = $('chat-busy-cover');
        if (cover) cover.hidden = true;
        setInert(false);
      }
      try { updateEntry(entry); } catch (e3) { /* 表示の失敗で止めない */ }
      announce(entry.ai);
      var inp = $('chat-input');
      if (inp && S.open && !isCoarse()) { try { inp.focus(); } catch (e4) { /* 無視 */ } }
    }
  }

  function cancelChat() {
    var e = S.current;
    if (!e) return;
    e.cancelled = true;
    if (S.session) S.session.cancel();
  }

  // ── 取り込み ───────────────────────────────────────────────────────
  // 依頼の前の状態へ戻す(取り込みの途中で例外が出たとき)。saveState で積んだ写しから DATA を作り直し、
  // 積んだ取り消しの履歴は外す(やり直しの履歴は積まない)。後始末も1つずつ包み、ここで止まらないようにする。
  function rollback(snapshot, mark, pendingBefore) {
    try { root.DATA = JSON.parse(snapshot); } catch (e) { console.error('[chat] 依頼の前のプランに戻せませんでした', e); }
    root._defaultPlanPending = pendingBefore;
    ['syncNorthFromPlan', 'ensureFloorMetadata'].forEach(function (n) { try { call(n); } catch (e) { console.error(e); } });
    try { call('copyPlanWallHeightToGlobal', g('DATA')); call('syncHeightDefaultsUI'); } catch (e) { console.error(e); }
    try { call('undoSaveState', mark); } catch (e) { console.error(e); }
    try { call('sharedForceFullSync'); } catch (e) { console.error(e); }
    try { call('draw2d'); } catch (e) { console.error(e); }
    try { if (g('ren')) call('rebuild3D'); } catch (e) { console.error(e); }
  }

  // 成功の結果の写しを本物のプランに入れる。戻り値 {applied, reason}。reason は 'unchanged'・'conflict'・'failed'。
  function applyChatResult(result) {
    if (!result || !result.ok || !result.plan) return { applied: false, reason: 'failed' };
    if (!(result.changed > 0)) return { applied: false, reason: 'unchanged' };
    var DATA = g('DATA');
    if (!DATA || S.fp === null || fingerprint(DATA) !== S.fp) return { applied: false, reason: 'conflict' };
    var work = result.plan;
    var mark = call('saveStateMark');
    var pendingBefore = root._defaultPlanPending;
    call('saveState');
    var H0 = g('HISTORY') || [];
    var snapshot = H0[H0.length - 1];
    try {
      APPLY_FIELDS.forEach(function (k) { if (work[k] !== undefined) DATA[k] = work[k]; });
      root._defaultPlanPending = false;
      // 選択とドラッグの後始末は restoreHistorySnapshot と同じ。
      var ST = g('ST');
      if (ST) { ST.selected = null; ST.selectAll = false; }
      call('clearMultiSelection');
      var D = g('DRAG');
      if (D) D.active = false;
      var props = $('props');
      if (props) props.classList.remove('show');
      call('normalizeLoadedPlan', { resetHeights: false, restoreView: false });
      // 写しの外壁の設定表を、今の壁に合わせる(消えた壁の設定を外す)。
      call('syncExteriorWallSettings');
      call('sharedForceFullSync');
      call('markDirty');
      call('draw2d');
      if (g('ren')) call('rebuild3D');
    } catch (err) {
      if (root.console && console.error) console.error('[chat] 変更を取り込む途中で例外が出たので、依頼の前に戻しました', err);
      rollback(snapshot, mark, pendingBefore);
      S.fp = null;
      return { applied: false, reason: 'failed' };
    }
    S.fp = null;
    var H = g('HISTORY') || [];
    S.undo = { len: H.length, top: H[H.length - 1], fp: fingerprint(g('DATA')), entry: null };
    return { applied: true };
  }

  // ── 元に戻す ───────────────────────────────────────────────────────
  // 取り込みのあとに利用者が別の編集をした・取り消した(取り消しの履歴が変わった)ら、ボタンを消す。
  // 定期の見張りは履歴の件数と最後の1件だけを見る(印は計算しない)。
  function historyUnchanged() {
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
    S.undoTimer = setInterval(function () { if (!historyUnchanged()) dropUndo(); }, 300);
  }
  function undoEntry(entry) {
    if (S.busy) return;
    if (!S.undo || S.undo.entry !== entry || !historyUnchanged()) { dropUndo(); entry.undoable = false; updateEntry(entry); return; }
    // 取り消しの履歴に積まれない変更(共同編集の相手の変更など)が入っていたら、巻き戻さない。
    if (fingerprint(g('DATA')) !== S.undo.fp) {
      dropUndo();
      entry.undoable = false;
      entry.note = UNDO_BLOCKED_MESSAGE;
      updateEntry(entry);
      announce(UNDO_BLOCKED_MESSAGE);
      return;
    }
    S.undo.entry = null;
    dropUndo();
    call('undoAction');
    entry.undoable = false;
    entry.note = UNDONE_NOTE;
    updateEntry(entry);
    announce(UNDONE_NOTE);
  }

  // ── 図面の画像 ─────────────────────────────────────────────────────
  // 既存の読み取りをその画像で開く。チャット欄には1行だけ出す。
  function onChatFile(input) {
    var file = input && input.files && input.files[0];
    if (!file || S.busy) { if (input) input.value = ''; return; }
    call('openPlanImport');
    call('onPlanImportFile', { files: [file] });
    input.value = '';
    var note = { kind: 'note', ai: '図面の読み取りを開きました' };
    S.entries.push(note);
    appendEntry(note);
  }

  // ── AI に渡す文の字数の上限 ───────────────────────────────────────────
  // 利用者の文が AI に渡る入力欄(チャット・読み取りの補足・画像AI と動画AI の仕上げメモ)は、
  // ChatPlanSummary.REQUEST_MAX_CHARS 字(500。文字=コードポイントで数える。Worker も同じ値を見る)まで。
  //   - ふだんは何も出さない。残りが CHAR_NEAR 字を切ったら「あと 32 字」を出す
  //   - 上限を超える分は入れない(貼り付けは入る分だけ入れ、打ち込みは末尾を戻す)。そのときは
  //     「500字までです。超えた分は入りませんでした。」と出す(黙って切らない)
  //   - 読み上げは、見せている文が「残りわずか」「超えた分を入れなかった」に変わったときだけ(1字ごとには読まない)
  var CHAR_NEAR = 50;
  function charMax() {
    var G = root.ChatPlanSummary;
    return G && G.REQUEST_MAX_CHARS > 0 ? G.REQUEST_MAX_CHARS : 500;
  }
  function charCount(v) { return Array.from(String(v || '')).length; }
  function attachCharLimit(input, note) {
    if (!input || !note || input._charLimit) return;
    var max = charMax();
    var live = root.document.createElement('span');
    live.className = 'chat-sr-only';
    live.setAttribute('aria-live', 'polite');
    note.parentNode.insertBefore(live, note.nextSibling);
    if (note.id) {
      var by = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (by.indexOf(note.id) < 0) by.push(note.id);
      input.setAttribute('aria-describedby', by.join(' '));
    }
    var state = '';
    function show(cut) {
      var left = Math.max(0, max - charCount(input.value));
      var next = cut ? 'cut' : left < CHAR_NEAR ? 'near' : '';
      if (cut) note.textContent = max + '字までです。超えた分は入りませんでした。';
      else if (next) note.textContent = 'あと ' + left + ' 字';
      note.hidden = !next;
      note.classList.toggle('is-limit', cut || (!!next && left === 0));
      if (next && next !== state) live.textContent = cut ? note.textContent : 'あと ' + left + ' 字で上限です';
      state = next;
    }
    function update(e) {
      if (e && e.isComposing) return;   // 日本語入力の変換中は数えない(確定したときに見る)
      var chars = Array.from(String(input.value || ''));
      if (chars.length > max) {
        input.value = chars.slice(0, max).join('');
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* 無視 */ }
        show(true);
        return;
      }
      show(false);
    }
    input.addEventListener('paste', function (e) {
      var data = e.clipboardData && e.clipboardData.getData('text');
      if (typeof data !== 'string' || typeof input.setRangeText !== 'function') return;
      var a = input.selectionStart, b = input.selectionEnd;
      if (typeof a !== 'number' || typeof b !== 'number') return;
      var v = String(input.value || '');
      var room = max - (charCount(v) - charCount(v.slice(a, b)));
      if (charCount(data) <= room) return;
      e.preventDefault();
      input.setRangeText(Array.from(data).slice(0, Math.max(0, room)).join(''), a, b, 'end');
      show(true);
    });
    input.addEventListener('input', update);
    input.addEventListener('compositionend', function () { update(null); });
    input._charLimit = true;
    input._charLimitUpdate = function () { update(null); };
  }
  var CHAR_LIMITED = [
    ['chat-input', 'chat-input-count'],
    ['plan-import-hint', 'plan-import-hint-count'],
    ['ai-render-style-input', 'ai-render-style-count'],
    ['video-render-note', 'video-render-note-count']
  ];
  function wireCharLimits() {
    CHAR_LIMITED.forEach(function (p) { attachCharLimit($(p[0]), $(p[1])); });
  }

  // ── 開く・閉じる ───────────────────────────────────────────────────
  function wirePanel() {
    wireCharLimits();
    var inp = $('chat-input');
    if (inp && !inp._chatWired) {
      inp._chatWired = true;
      inp.addEventListener('keydown', function (e) {
        // 画面のキー操作(削除・取り消し・回転など)に渡さない。
        e.stopPropagation();
        // 日本語入力の変換中の Enter(確定)・Escape(取り消し)では、送らない・閉じない。
        var composing = e.isComposing || e.keyCode === 229;
        if (e.key === 'Escape') { if (!composing) closeChat(); return; }
        if (e.key !== 'Enter' || e.shiftKey || composing) return;
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
    scrollLog();
    var fab = $('chat-fab');
    if (fab) { fab.classList.add('is-open'); fab.setAttribute('aria-expanded', 'true'); }
    if (S.undo && !historyUnchanged()) dropUndo();
    // タッチの端末では、開いただけでキーボードを出さない。
    var inp = $('chat-input');
    if (inp && !isCoarse() && !S.busy) inp.focus();
  }

  function closeChat() {
    if (S.busy) cancelChat();
    var panel = $('chat-panel');
    if (panel) panel.hidden = true;
    S.open = false;
    var fab = $('chat-fab');
    if (fab) { fab.classList.remove('is-open'); fab.setAttribute('aria-expanded', 'false'); }
  }

  // 読み取り・画像AI・動画AI の入力欄は、チャットを開かなくても上限を効かせる(要素は index.html でこのファイルより前にある)。
  try { wireCharLimits(); } catch (e) { if (root.console && console.error) console.error('[chat] 字数の上限を付けられませんでした', e); }
  root.attachCharLimit = attachCharLimit;
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
