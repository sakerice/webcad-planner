// チャットの1回の依頼の往復を回す。画面を持たない(画面は作業3のチャット欄)。グローバルに触らない。
//
//   var s = ChatSession.create(deps);
//   s.send(text) → Promise<結果>   1回の依頼を最後まで回す(実行中にもう一度呼ぶと reason 'busy')
//   s.cancel()                     実行中の依頼を取り消す(send はすぐに reason 'cancelled' で終わる)
//   s.forgetLast()                 最後に済んだ依頼を履歴から外す(画面が結果を取り込まなかったとき)
//   s.history                      済んだ依頼の [{user, assistant}](利用者の文と AI の最後の文。写し)
//
// deps:
//   fetch(url, init)           … POST /api/ai/chat を呼ぶ(画面では window.fetch)
//   getPlan()                  … 今のプラン(依頼の始めに1回だけ読み、写しを取る。本物には触らない)
//   ctxFor()                   … 操作を写しに当てる ctx(画面では planChatCtx())。道具の呼び出しごとに呼ぶ
//   tools: {checkArgs, applyOperations, inspectPlan, clonePlan}
//                              … PlanCoreOperationsCatalog.checkArgs、PlanCoreOperations.applyOperations・clonePlan、
//                                 inspectPlan(plan) は PlanCoreInspect.inspectPlan を画面の deps で包んだもの
//   summarize(plan)            … 要約の文字列(画面では ChatPlanSummary.summarize に選択と呼び名を付けて包んだもの)
//   onEvent(ev)                … 進み具合(下の一覧)。中で投げても依頼は止まらない
//   AbortController(省略可)、TextDecoder(省略可。無ければ組み込みのもの)、url(省略可。既定 /api/ai/chat)、
//   stream(省略可。既定 ChatClaudeStream)
//
// onEvent の出来事:
//   {type:'round', round}          … n 回めの呼び出しを始めた(1 から)
//   {type:'thinking', delta}       … AI の考えの要約(日本語。足していくと全文)
//   {type:'text', delta}           … AI の文(足していくと全文。途中の回の文も来る)
//   {type:'tool', name, label}     … 道具を呼び始めた。label は利用者向けの文(「部屋を足しています」)
//   {type:'remaining', left}       … 今日あと何回頼めるか(最初の呼び出しの返事に付いたときだけ)
//
// 結果:
//   成功 {ok:true, plan: 写し, changedIds, removedIds, text, changed, warnings, rounds}
//     plan は当て終えた写し。本物のプランには入れていない(入れるのは画面の側)。
//     changedIds は写しにある、足した・変えた物の id。removedIds は元のプランにあって消した物の id
//     (この依頼で置いてから消した物はどちらにも入らない)。changed はその合計の件数。
//     changed が 0 なら、AI は何も変えずに返事をした(聞き返しなど)。
//   失敗 {ok:false, reason, message} … plan は無い(写しは捨てる)。message は利用者向けの文(MESSAGES)。
//
// 会話の履歴は足すだけ: 1回の依頼の中では、送った messages の配列を作り直さず同じ配列に足していく。
// 受け取った assistant の content は、そのままの物を次の呼び出しに入れる。例外は空の text ブロックだけで、
// API が受け付けないため、文字が空か空白だけの text ブロックは返す前に外す(thinking・tool_use・知らない種類は必ず残す)。
// user のメッセージは、文字列(最初の依頼文)と tool_result(中身は文字列)だけで作る。
// 前の依頼までのやり取りは、「利用者の文」と「AI の最後の文」だけを文字で入れる(考え・道具の呼び出しは入れない)。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./claude-stream.js'));
  } else {
    root.ChatSession = factory(root.ChatClaudeStream);
  }
}(typeof self !== 'undefined' ? self : this, function (ChatClaudeStream) {

  var MAX_ROUNDS = 8;   // 1回の依頼の呼び出しは、最初を含めて 8 回まで(Worker と同じ)
  // 送る量の決まり(Worker の上限は1回 160KB、1回の依頼の合計 1MB)。
  var LIST_MAX = 10;               // 検査の結果に入れる指摘と警告の数(それぞれ)。残りは「ほか N 件」
  var RESULT_MAX_CHARS = 2000;     // 道具の結果の文1件の長さ
  var HISTORY_MAX = 6;             // 前の依頼のやり取りを入れる件数(直近から)
  var HISTORY_TEXT_MAX = 400;      // 前の依頼の、利用者の文と AI の文それぞれの長さ
  var BODY_MAX_BYTES = 150 * 1024; // 1回の本文の上限(Worker の 160KB より少し手前で止める)

  // 道具の名前 → 利用者向けの進み具合の文。
  var TOOL_LABELS = {
    addRoom: '部屋を足しています',
    resizeRoom: '部屋の大きさを変えています',
    renameRoom: '部屋の名前を変えています',
    addWall: '壁を足しています',
    removeWall: '壁を消しています',
    placeItem: '家具や設備を置いています',
    moveObject: '位置を動かしています',
    rotateObject: '向きを変えています',
    deleteObjects: '消しています',
    setProps: '設定を変えています',
    inspect_plan: '間取りを確かめています'
  };
  var TOOL_LABEL_OTHER = '間取りを直しています';

  // 失敗の理由 → 利用者向けの文。
  var MESSAGES = {
    busy: '前の依頼がまだ終わっていません。終わってからもう一度お試しください。',
    empty: '頼みたいことを書いてください。',
    cancelled: '依頼を取り消しました。',
    network: '通信できませんでした。通信の状態を確かめて、もう一度お試しください。',
    quota_exceeded: '本日ぶんのチャットを使い切りました。明日またお試しください。',
    rounds_exceeded: '1回の依頼で直せる回数を超えました。依頼を分けて頼み直してください。',
    ticket_invalid: '依頼の期限が切れました。もう一度頼み直してください。',
    too_large: 'やり取りが長くなりました。チャットを新しく始めてからお試しください。',
    bad_request: '依頼をうまく送れませんでした。チャットを新しく始めてからお試しください。',
    quota_unavailable: 'いまチャットを使えません。少し時間をおいてお試しください。',
    ai_unavailable: 'この環境ではチャットを使えません。',
    ai_upstream_error: 'AI から返事を受け取れませんでした。少し時間をおいてお試しください。',
    http_error: 'いまチャットを使えません。少し時間をおいてお試しください。',
    ai_error: 'AI 側で問題が起きて、返事が途中で止まりました。少し時間をおいてお試しください。',
    interrupted: '返事が途中で切れました。もう一度お試しください。',
    bad_response: 'AI の返事を読み取れませんでした。もう一度お試しください。',
    max_tokens: '返事が長くなりすぎて、途中で止まりました。依頼を小さく分けて頼み直してください。',
    refusal: 'AI がこの依頼を断りました。間取りをどう直したいかを書いて、頼み直してください。',
    pause_turn: 'AI の返事が途中で止まりました。もう一度お試しください。',
    too_long: '頼みごとが多すぎて、途中で続けられなくなりました。少しずつ分けてお試しください。',
    failed: '依頼を最後まで進められませんでした。もう一度お試しください。'
  };
  // サーバの失敗の code のうち、そのまま理由にするもの(ほかは http_error)。
  var SERVER_CODES = ['quota_exceeded', 'rounds_exceeded', 'ticket_invalid', 'too_large', 'bad_request',
    'quota_unavailable', 'ai_unavailable', 'ai_upstream_error'];
  // 組み立ての失敗 → 理由。
  var STREAM_REASONS = { stream_error: 'ai_error', incomplete: 'interrupted', bad_json: 'bad_response', bad_event: 'bad_response' };

  function failure(reason) { return { ok: false, reason: reason, message: MESSAGES[reason] || MESSAGES.failed }; }
  function idKey(id) { return String(id); }
  function isBlankText(b) { return b && b.type === 'text' && !(typeof b.text === 'string' && b.text.trim()); }
  function textOf(content) {
    return (content || []).filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
      .map(function (b) { return b.text; }).join('').trim();
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function labelFor(name) { return typeof name === 'string' && hasOwn(TOOL_LABELS, name) ? TOOL_LABELS[name] : TOOL_LABEL_OTHER; }
  function cut(str, max) { str = String(str); return str.length > max ? str.slice(0, max - 1) + '…' : str; }
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
  // 取り消したあとに届いた返事の通信を閉じる(AbortController が無いときの備え)。
  function closeBody(res) {
    try {
      if (res && res.body && typeof res.body.cancel === 'function') {
        var p = res.body.cancel();
        if (p && typeof p.then === 'function') p.then(null, function () {});
      }
    } catch (e) { /* 無視 */ }
  }
  function capList(list) {
    list = (list || []).map(String);
    if (list.length <= LIST_MAX) return list;
    return list.slice(0, LIST_MAX).concat(['ほか ' + (list.length - LIST_MAX) + ' 件']);
  }

  function create(deps) {
    deps = deps || {};
    var Stream = deps.stream || ChatClaudeStream;
    var url = deps.url || '/api/ai/chat';
    var history = [];
    var current = null;     // 実行中の依頼の札(取り消しの印など)

    function emit(ev) {
      if (typeof deps.onEvent !== 'function') return;
      try { deps.onEvent(ev); } catch (e) { /* 画面側の失敗で依頼を止めない */ }
    }
    function decoder() {
      var D = deps.TextDecoder || (typeof TextDecoder !== 'undefined' ? TextDecoder : null);
      return D ? new D() : null;
    }

    // 返事の本文を最後まで読み、組み立て部品に入れる。
    function readBody(res, job, assembler) {
      if (res.body && typeof res.body.getReader === 'function') {
        var reader = res.body.getReader();
        job.reader = reader;
        var dec = decoder();
        var pump = function () {
          if (job.cancelled) return Promise.resolve();
          return reader.read().then(function (chunk) {
            if (chunk.done) { if (dec) assembler.push(dec.decode()); return; }
            var v = chunk.value;
            assembler.push(typeof v === 'string' ? v : dec ? dec.decode(v, { stream: true }) : '');
            return pump();
          });
        };
        return pump();
      }
      if (typeof res.text === 'function') return res.text().then(function (t) { assembler.push(String(t || '')); });
      return Promise.resolve();
    }

    function readError(res) {
      var p = typeof res.json === 'function' ? res.json() : Promise.resolve(null);
      return p.then(function (body) { return body; }, function () { return null; }).then(function (body) {
        var code = body && (body.code || body.error);
        if (res.status === 404) return failure('ai_unavailable');
        return failure(SERVER_CODES.indexOf(code) >= 0 ? code : 'http_error');
      });
    }

    function run(job, text) {
      var tools = deps.tools || {};
      var plan0 = deps.getPlan();
      var work = typeof tools.clonePlan === 'function' ? tools.clonePlan(plan0)
        : tools.applyOperations(plan0, [], {}).plan;
      var origIds = {};
      ['walls', 'rooms', 'items'].forEach(function (c) {
        (work[c] || []).forEach(function (o) { if (o && o.id !== undefined) origIds[idKey(o.id)] = true; });
      });
      var changed = {};   // idKey → id(写しにある、足した・変えた物)
      var removed = {};   // idKey → id(元のプランにあって消した物)
      var warnings = [];
      var summary = String(deps.summarize(work));
      var messages = [];
      // 前の依頼は直近 HISTORY_MAX 件まで、文はそれぞれ HISTORY_TEXT_MAX 字までに切って入れる。
      history.slice(-HISTORY_MAX).forEach(function (h) {
        messages.push({ role: 'user', content: cut(h.user, HISTORY_TEXT_MAX) });
        messages.push({ role: 'assistant', content: cut(h.assistant, HISTORY_TEXT_MAX) });
      });
      messages.push({ role: 'user', content: '<plan_summary>\n' + summary + '\n</plan_summary>\n\n' + text });
      var retried = false;
      var ticket = null;
      var round = 0;

      function noteChange(res) {
        (res.changedIds || []).forEach(function (id) { changed[idKey(id)] = id; });
        (res.removedIds || []).forEach(function (id) {
          delete changed[idKey(id)];
          if (origIds[idKey(id)]) removed[idKey(id)] = id;
        });
      }

      function runTool(block) {
        var name = block.name, input = block.input;
        var result = function (obj, isError) {
          var r = { type: 'tool_result', tool_use_id: block.id, content: cut(JSON.stringify(obj), RESULT_MAX_CHARS) };
          if (isError) r.is_error = true;
          return r;
        };
        try {
          if (name === 'inspect_plan') {
            // 検査も写しを「今のプラン」として行う(画面の関数を使う検査を足しても、本物の DATA を見ないように)。
            var ictx = deps.ctxFor();
            var target = work;
            var ins = (ictx && typeof ictx.withPlan === 'function'
              ? ictx.withPlan(target, function () { return tools.inspectPlan(target); })
              : tools.inspectPlan(target)) || {};
            return result({ ok: !!ins.ok, errors: capList(ins.errors), warnings: capList(ins.warnings) });
          }
          if (typeof name !== 'string' || !hasOwn(TOOL_LABELS, name)) {
            return result({ errors: ['知らない道具です: ' + String(name)] }, true);
          }
          var ck = tools.checkArgs(name, input);
          if (!ck || !ck.ok) return result({ errors: (ck && ck.errors) || ['引数の形が違います'] }, true);
          var res = tools.applyOperations(work, [{ op: name, args: input }], deps.ctxFor());
          if (!res || (res.errors && res.errors.length)) {
            var errs = (res && res.errors) || [];
            var out = { errors: errs.map(function (e) { return e.message; }) };
            var cands = [];
            errs.forEach(function (e) { (e.candidates || []).forEach(function (c) { if (cands.indexOf(c) < 0) cands.push(c); }); });
            if (cands.length) out.candidates = cands;
            return result(out, true);
          }
          work = res.plan;
          noteChange(res);
          (res.warnings || []).forEach(function (w) { warnings.push(w); });
          return result({ ok: true, changedIds: res.changedIds || [], removedIds: res.removedIds || [], warnings: res.warnings || [] });
        } catch (e) {
          return result({ errors: ['道具を当てる途中で誤りが起きました'] }, true);
        }
      }

      function finish(lastText) {
        var changedIds = Object.keys(changed).map(function (k) { return changed[k]; });
        var removedIds = Object.keys(removed).map(function (k) { return removed[k]; });
        return { ok: true, plan: work, changedIds: changedIds, removedIds: removedIds, text: lastText,
          changed: changedIds.length + removedIds.length, warnings: warnings, rounds: round };
      }

      function step() {
        if (job.cancelled) return Promise.resolve(failure('cancelled'));
        if (round >= MAX_ROUNDS) return Promise.resolve(failure('rounds_exceeded'));
        var body = JSON.stringify(ticket ? { ticket: ticket, messages: messages } : { messages: messages });
        if (utf8Bytes(body) > BODY_MAX_BYTES) {
          // 最初の呼び出しなら、前の依頼のやり取りを古い順に落として収める(まだ何も送っていないので変えてよい)。
          // 続きの呼び出しでは送った messages を変えられないので、依頼を終える。
          if (round > 0) return Promise.resolve(failure('too_long'));
          while (messages.length > 1 && utf8Bytes(body) > BODY_MAX_BYTES) {
            messages.splice(0, 2);
            body = JSON.stringify({ messages: messages });
          }
          if (utf8Bytes(body) > BODY_MAX_BYTES) return Promise.resolve(failure('too_long'));
        }
        round++;
        emit({ type: 'round', round: round });
        var init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: body };
        if (job.abort) init.signal = job.abort.signal;
        return Promise.resolve().then(function () { return deps.fetch(url, init); }).then(function (res) {
          if (job.cancelled) { closeBody(res); return failure('cancelled'); }
          var head = function (k) { try { return res.headers && res.headers.get ? res.headers.get(k) : null; } catch (e) { return null; } };
          var t = head('x-chat-ticket');
          if (t) ticket = t;
          var left = head('x-chat-rounds-left');
          var roundsLeft = left === null || left === undefined || left === '' ? null : Number(left);
          var remain = head('x-chat-remaining');
          if (remain !== null && remain !== undefined && remain !== '' && isFinite(Number(remain))) emit({ type: 'remaining', left: Number(remain) });
          if (!res.ok) {
            return readError(res).then(function (f) {
              // 最初の呼び出しで AI が失敗し、失敗の返事に札が付いていたら、その札で同じ本文を1回だけ送り直す
              // (札があれば今日の回数を使い直さない)。2度めの失敗はそのまま終える。
              if (f.reason === 'ai_upstream_error' && round === 1 && !retried && t && !job.cancelled) {
                retried = true;
                return step();
              }
              return f;
            });
          }
          var assembler = Stream.createAssembler({
            onText: function (d) { if (!job.cancelled) emit({ type: 'text', delta: d }); },
            onThinking: function (d) { if (!job.cancelled) emit({ type: 'thinking', delta: d }); },
            onToolStart: function (name) { if (!job.cancelled) emit({ type: 'tool', name: name, label: labelFor(name) }); }
          });
          return readBody(res, job, assembler).then(function () { return assembler.end(); }, function () {
            var r = assembler.end();
            return { message: r.message, error: r.error || { code: 'incomplete' } };
          }).then(function (r) {
            if (job.cancelled) return failure('cancelled');
            if (r.error) return failure(STREAM_REASONS[r.error.code] || 'bad_response');
            var msg = r.message;
            var stop = msg.stop_reason;
            if (stop === 'max_tokens' || stop === 'refusal' || stop === 'pause_turn') return failure(stop);
            if (stop === 'end_turn' || stop === 'stop_sequence') return finish(textOf(msg.content));
            if (stop !== 'tool_use') return failure('bad_response');
            var calls = msg.content.filter(function (b) { return b && b.type === 'tool_use'; });
            if (!calls.length) return failure('bad_response');
            // この返事のあとに呼べる回が残っていなければ、道具を当てずに終える。
            if ((roundsLeft !== null && isFinite(roundsLeft) && roundsLeft <= 0) || round >= MAX_ROUNDS) return failure('rounds_exceeded');
            messages.push({ role: 'assistant', content: msg.content.filter(function (b) { return !isBlankText(b); }) });
            var results = [];
            for (var i = 0; i < calls.length; i++) {
              if (job.cancelled) return failure('cancelled');
              results.push(runTool(calls[i]));
            }
            messages.push({ role: 'user', content: results });
            return step();
          });
        }, function () {
          return failure(job.cancelled ? 'cancelled' : 'network');
        });
      }

      return step();
    }

    function send(text) {
      if (current) return Promise.resolve(failure('busy'));
      text = String(text === undefined || text === null ? '' : text).trim();
      if (!text) return Promise.resolve(failure('empty'));
      var job = { cancelled: false, reader: null, abort: null, cancelResolve: null };
      if (deps.AbortController) { try { job.abort = new deps.AbortController(); } catch (e) { job.abort = null; } }
      current = job;
      var cancelled = new Promise(function (resolve) { job.cancelResolve = resolve; });
      var running = Promise.resolve().then(function () { return run(job, text); })
        .then(null, function () { return failure('failed'); });
      return Promise.race([running, cancelled]).then(function (r) {
        if (current === job) current = null;
        if (job.cancelled) r = failure('cancelled');
        if (r && r.ok) history.push({ user: text, assistant: r.text || '（文の返事はありませんでした）' });
        return r;
      });
    }

    function cancel() {
      var job = current;
      if (!job) return;
      job.cancelled = true;
      current = null;
      if (job.abort) { try { job.abort.abort(); } catch (e) { /* 無視 */ } }
      if (job.reader && typeof job.reader.cancel === 'function') {
        try { var p = job.reader.cancel(); if (p && typeof p.then === 'function') p.then(null, function () {}); } catch (e) { /* 無視 */ }
      }
      job.cancelResolve(failure('cancelled'));
    }

    return {
      send: send,
      cancel: cancel,
      // 最後に済んだ依頼を履歴から外す。画面が結果を取り込まなかったとき(途中でプランが変わった・取り込みで失敗した)に呼ぶ。
      // 外さないと、次の依頼で AI が「前の依頼で直した」と思い込む。実行中は何もしない(まだ履歴に入っていないため)。
      forgetLast: function () { if (!current && history.length) history.pop(); },
      get history() { return history.map(function (h) { return { user: h.user, assistant: h.assistant }; }); }
    };
  }

  return { create: create, TOOL_LABELS: TOOL_LABELS, MESSAGES: MESSAGES, MAX_ROUNDS: MAX_ROUNDS };
}));
