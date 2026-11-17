// チャットのテスト用の偽の SSE。もとにした content から、Claude の Messages API の
// ストリームと同じ出来事の並び(message_start → 各ブロックの start/delta/stop → message_delta → message_stop)を作る。
// *.test.cjs ではないので、run_tests.sh からは直接走らない(chat-*.test.cjs が読む)。

function eventText(name, data) {
  return 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

function pieces(str, n) {
  if (!n) return [str];
  const out = [];
  for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n));
  return out.length ? out : [''];
}

// opts: stop(stop_reason)、jsonPiece(partial_json を何文字ずつに分けるか。省くと1つ)、
//       textPiece(文・考えを何文字ずつ)、noStop(message_delta と message_stop を出さない)、
//       emptyJson(入力が {} の道具に partial_json "" を1つだけ送る)
function sseFor(content, opts) {
  opts = opts || {};
  let s = eventText('message_start', {
    type: 'message_start',
    message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 1 } },
  });
  s += eventText('ping', { type: 'ping' });
  content.forEach((b, index) => {
    let start;
    if (b.type === 'text') start = { type: 'text', text: '' };
    else if (b.type === 'thinking') start = { type: 'thinking', thinking: '', signature: '' };
    else if (b.type === 'tool_use') start = { type: 'tool_use', id: b.id, name: b.name, input: {} };
    else start = b;
    s += eventText('content_block_start', { type: 'content_block_start', index, content_block: start });
    const delta = (d) => { s += eventText('content_block_delta', { type: 'content_block_delta', index, delta: d }); };
    if (b.type === 'text') pieces(b.text, opts.textPiece || 4).forEach((t) => delta({ type: 'text_delta', text: t }));
    if (b.type === 'thinking') {
      pieces(b.thinking, opts.textPiece || 4).forEach((t) => delta({ type: 'thinking_delta', thinking: t }));
      delta({ type: 'signature_delta', signature: b.signature });
    }
    if (b.type === 'tool_use') {
      const json = JSON.stringify(b.input);
      if (opts.emptyJson && json === '{}') delta({ type: 'input_json_delta', partial_json: '' });
      else pieces(json, opts.jsonPiece).forEach((t) => delta({ type: 'input_json_delta', partial_json: t }));
    }
    s += eventText('content_block_stop', { type: 'content_block_stop', index });
  });
  if (!opts.noStop) {
    s += eventText('message_delta', { type: 'message_delta', delta: { stop_reason: opts.stop || 'end_turn', stop_sequence: null }, usage: { output_tokens: 42 } });
    s += eventText('message_stop', { type: 'message_stop' });
  }
  return s;
}

module.exports = { sseFor, eventText };
