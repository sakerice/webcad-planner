// Claude の返事(Messages API のストリーム。SSE の文字列)を、1つの message に組み立てる。
// 画面にも Worker にも依存しない(チャットの往復は assets/js/chat/chat-session.js が回す)。
//
//   var a = ChatClaudeStream.createAssembler({onText, onThinking, onToolStart});
//   a.push(文字列) … 届いた順に何度でも。出来事の途中で切れていてよい。
//   a.end() → {message, error?}
//     message = {role:'assistant', content:[…ブロック], stop_reason, usage}
//     error   = {code, message, type?}
//       stream_error … SSE の error の出来事が来た(type は error.type。overloaded_error など)
//       incomplete   … message_stop が来ないまま終わった(通信が途中で切れた)
//       bad_json     … 道具の入力(partial_json をつないだもの)が JSON として読めない
//       bad_event    … data が JSON でない、始まっていないブロックへの delta、同じ番号のブロックが2度始まるなど、並びが壊れている
//
// 会話の履歴は足すだけ(1バイトも変えずに次の呼び出しへ返す)なので、ブロックは
// content_block_start の content_block を土台にし、delta をその欄へ足すだけにする。
// 知らない種類のブロックは start の形のまま保ち、知らない delta・出来事は無視する(捨てずに読み飛ばす)。
// tool_use の input は、ためた partial_json を content_block_stop で JSON.parse する(空なら {})。
// push・end は例外を投げない(画面が止まらないように)。onText などの中の例外も外へ出さない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChatClaudeStream = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function call(fn, v) {
    if (typeof fn !== 'function') return;
    try { fn(v); } catch (e) { /* 途中経過の知らせの失敗で、組み立てを止めない */ }
  }
  function copyBlock(b) {
    // start の content_block を写して土台にする(欄の並びはそのまま)。
    var out = {};
    Object.keys(b).forEach(function (k) { out[k] = b[k]; });
    return out;
  }

  function createAssembler(cb) {
    cb = cb || {};
    var buf = '';
    var content = [];
    var json = {};          // index → ためた partial_json
    var message = { role: 'assistant', content: content, stop_reason: null, usage: {} };
    var error = null;
    var stopped = false;
    var ended = null;

    function setError(code, msg, type) {
      if (error) return;
      error = { code: code, message: msg };
      if (type) error.type = type;
    }
    function mergeUsage(u) {
      if (!u || typeof u !== 'object') return;
      Object.keys(u).forEach(function (k) { message.usage[k] = u[k]; });
    }

    function onEvent(ev) {
      if (!ev || typeof ev !== 'object') { setError('bad_event', '返事の形が壊れています'); return; }
      var i = ev.index;
      switch (ev.type) {
        case 'message_start':
          if (ev.message && ev.message.usage) mergeUsage(ev.message.usage);
          return;
        case 'content_block_start':
          if (typeof i !== 'number' || !ev.content_block || typeof ev.content_block !== 'object') {
            setError('bad_event', 'ブロックの始まりの形が壊れています'); return;
          }
          // 同じ番号のブロックが2度始まるのは並びが壊れている(前のためた入力を別のブロックに付けないため止める)。
          if (content[i]) { setError('bad_event', '同じ番号のブロックが2度始まりました'); return; }
          content[i] = copyBlock(ev.content_block);
          if (content[i].type === 'tool_use') { json[i] = ''; call(cb.onToolStart, content[i].name); }
          return;
        case 'content_block_delta': {
          var b = content[i];
          var d = ev.delta;
          if (typeof i !== 'number' || !b) { setError('bad_event', '始まっていないブロックへの続きが来ました'); return; }
          if (!d || typeof d !== 'object') return;
          if (d.type === 'text_delta') {
            b.text = (b.text || '') + (d.text || '');
            call(cb.onText, d.text || '');
          } else if (d.type === 'thinking_delta') {
            b.thinking = (b.thinking || '') + (d.thinking || '');
            call(cb.onThinking, d.thinking || '');
          } else if (d.type === 'signature_delta') {
            b.signature = (b.signature || '') + (d.signature || '');
          } else if (d.type === 'input_json_delta') {
            json[i] = (json[i] || '') + (d.partial_json || '');
          }
          // 知らない delta は無視する
          return;
        }
        case 'content_block_stop': {
          var blk = content[i];
          if (typeof i !== 'number' || !blk) { setError('bad_event', '始まっていないブロックの終わりが来ました'); return; }
          if (Object.prototype.hasOwnProperty.call(json, i)) {
            var raw = json[i];
            delete json[i];
            if (raw === '') { if (blk.input === undefined) blk.input = {}; return; }
            try {
              var parsed = JSON.parse(raw);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
              blk.input = parsed;
            } catch (e) {
              setError('bad_json', '道具の入力が読めません');
            }
          }
          return;
        }
        case 'message_delta':
          if (ev.delta && ev.delta.stop_reason !== undefined) message.stop_reason = ev.delta.stop_reason;
          if (ev.usage) mergeUsage(ev.usage);
          return;
        case 'message_stop':
          stopped = true;
          return;
        case 'error': {
          var er = ev.error || {};
          setError('stream_error', String(er.message || 'AI 側で失敗しました'), er.type ? String(er.type) : null);
          return;
        }
        default:
          return;   // ping・知らない出来事
      }
    }

    // 1つの出来事(空行で区切られた塊)を読む。data: の行をつないで JSON にする。
    function takeBlock(block) {
      var data = [];
      block.split('\n').forEach(function (line) {
        if (line.charAt(line.length - 1) === '\r') line = line.slice(0, -1);
        if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
      });
      if (!data.length) return;
      var ev;
      try { ev = JSON.parse(data.join('\n')); } catch (e) { setError('bad_event', '返事の形が壊れています'); return; }
      onEvent(ev);
    }

    function drain(final) {
      buf = buf.replace(/\r\n/g, '\n');
      var cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        var block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        takeBlock(block);
      }
      if (final && buf.trim()) { takeBlock(buf); buf = ''; }
    }

    function push(text) {
      if (ended || typeof text !== 'string' || !text) return;
      try {
        // \r\n が塊の境目で割れても困らないよう、末尾の \r は次の push まで持ち越す。
        buf += text;
        if (buf.charAt(buf.length - 1) === '\r') {
          var keep = '\r';
          buf = buf.slice(0, -1);
          drain(false);
          buf += keep;
        } else {
          drain(false);
        }
      } catch (e) {
        setError('bad_event', '返事を読めませんでした');
      }
    }

    function end() {
      if (ended) return ended;
      try { drain(true); } catch (e) { setError('bad_event', '返事を読めませんでした'); }
      if (!error && !stopped) setError('incomplete', '返事が途中で切れました');
      // 抜けた番号(穴)があれば並びが壊れている。
      for (var i = 0; i < content.length; i++) {
        if (!content[i]) { setError('bad_event', 'ブロックの番号が飛んでいます'); break; }
      }
      ended = error ? { message: message, error: error } : { message: message };
      return ended;
    }

    return { push: push, end: end };
  }

  return { createAssembler: createAssembler };
}));
