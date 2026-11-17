// assets/js/chat/claude-stream.js の単体テスト。
// 偽の SSE は「もとにした content」から、Claude の API と同じ出来事の並びで作る。
// 組み立てた content が、もとの content と JSON.stringify で一致すること(署名を含む)を見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Stream = require('../../assets/js/chat/claude-stream.js');
const { sseFor, eventText } = require('./chat-sse-fixtures.cjs');

function feed(text, chunkSize, cb) {
  const a = Stream.createAssembler(cb || {});
  if (!chunkSize) a.push(text);
  else for (let i = 0; i < text.length; i += chunkSize) a.push(text.slice(i, i + chunkSize));
  return a.end();
}

const THINK_TOOLS = [
  { type: 'thinking', thinking: 'LDK を東へ広げる。まず部屋の大きさを変える。', signature: 'EqQBCkYIARgCKkBzaWduYXR1cmU=' },
  { type: 'text', text: '部屋を広げます。' },
  { type: 'tool_use', id: 'toolu_01', name: 'resizeRoom', input: { id: 'rm_1', w: 5460, x: 2730 } },
  { type: 'tool_use', id: 'toolu_02', name: 'placeItem', input: { type: 'sofa', x: 1000, y: 2000, rot: 90, set: { a: [1, 2, { b: 'c' }] } } },
];

test('文字だけの返事', () => {
  const content = [{ type: 'text', text: 'どの部屋を広げますか？' }];
  const texts = [];
  const r = feed(sseFor(content, { stop: 'end_turn' }), 0, { onText: (d) => texts.push(d) });
  assert.equal(r.error, undefined);
  assert.equal(JSON.stringify(r.message.content), JSON.stringify(content));
  assert.equal(r.message.role, 'assistant');
  assert.equal(r.message.stop_reason, 'end_turn');
  assert.equal(texts.join(''), 'どの部屋を広げますか？');
  assert.equal(r.message.usage.output_tokens, 42);
  assert.equal(r.message.usage.input_tokens, 100);
});

test('考え(署名つき)+ 文 + 道具2つ。道具の入力は細かく分かれて届く', () => {
  const thinking = [], tools = [];
  const r = feed(sseFor(THINK_TOOLS, { stop: 'tool_use', jsonPiece: 3 }), 0, {
    onThinking: (d) => thinking.push(d), onToolStart: (n) => tools.push(n),
  });
  assert.equal(r.error, undefined);
  assert.equal(JSON.stringify(r.message.content), JSON.stringify(THINK_TOOLS));
  assert.equal(r.message.stop_reason, 'tool_use');
  assert.equal(thinking.join(''), THINK_TOOLS[0].thinking);
  assert.deepEqual(tools, ['resizeRoom', 'placeItem']);
});

test('1回の push の途中で出来事が切れても組み立てられる(1文字ずつ・7文字ずつ・CRLF)', () => {
  const sse = sseFor(THINK_TOOLS, { stop: 'tool_use', jsonPiece: 5 });
  for (const n of [1, 7, 64]) {
    const r = feed(sse, n);
    assert.equal(r.error, undefined, 'chunk ' + n);
    assert.equal(JSON.stringify(r.message.content), JSON.stringify(THINK_TOOLS));
  }
  const crlf = feed(sse.replace(/\n/g, '\r\n'), 11);
  assert.equal(crlf.error, undefined);
  assert.equal(JSON.stringify(crlf.message.content), JSON.stringify(THINK_TOOLS));
});

test('知らない種類のブロックは start の形をそのまま保ち、知らない delta と出来事は無視する', () => {
  const content = [
    { type: 'redacted_thinking', data: 'ZW5jcnlwdGVk' },
    { type: 'fancy_block', foo: { bar: [1, 2] } },
    { type: 'text', text: 'はい' },
  ];
  let sse = sseFor(content, { stop: 'end_turn' });
  // 知らない delta(fancy_block への)と、知らない出来事と、ping を差し込む
  sse = sse.replace('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
    eventText('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'mystery_delta', zzz: 1 } })
    + eventText('mystery_event', { type: 'mystery_event', x: 1 })
    + eventText('ping', { type: 'ping' })
    + 'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}');
  const r = feed(sse, 13);
  assert.equal(r.error, undefined);
  assert.equal(JSON.stringify(r.message.content), JSON.stringify(content));
});

test('error の出来事は error を返す', () => {
  let sse = sseFor([{ type: 'text', text: '途中' }], { stop: 'end_turn', noStop: true });
  sse += eventText('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  const r = feed(sse);
  assert.equal(r.error.code, 'stream_error');
  assert.equal(r.error.type, 'overloaded_error');
});

test('途中で終わる(message_stop が来ない)と incomplete', () => {
  const sse = sseFor(THINK_TOOLS, { stop: 'tool_use' });
  const cut = sse.slice(0, sse.indexOf('event: content_block_stop\ndata: {"type":"content_block_stop","index":3}'));
  const r = feed(cut, 9);
  assert.equal(r.error.code, 'incomplete');
  // message_delta だけ届いて message_stop が来ない場合も同じ
  const r2 = feed(sse.slice(0, sse.indexOf('event: message_stop')));
  assert.equal(r2.error.code, 'incomplete');
});

test('壊れた partial_json は bad_json(例外を投げない)', () => {
  let sse = sseFor([{ type: 'tool_use', id: 't1', name: 'addRoom', input: { x: 1 } }], { stop: 'tool_use' });
  sse = sse.replace('"partial_json":"{\\"x\\":1}"', '"partial_json":"{\\"x\\":1"');
  const r = feed(sse);
  assert.equal(r.error.code, 'bad_json');
});

test('入力の無い道具(inspect_plan)は input が {} になる', () => {
  const content = [{ type: 'tool_use', id: 't1', name: 'inspect_plan', input: {} }];
  const r = feed(sseFor(content, { stop: 'tool_use', emptyJson: true }));
  assert.equal(r.error, undefined);
  assert.equal(JSON.stringify(r.message.content), JSON.stringify(content));
});

test('data が JSON でない・始まっていないブロックへの delta は bad_event', () => {
  const sse = sseFor([{ type: 'text', text: 'a' }], { stop: 'end_turn' });
  const broken = sse.replace('{"type":"message_stop"}', '{"type":"message_stop"');
  assert.equal(feed(broken).error.code, 'bad_event');
  const stray = eventText('content_block_delta', { type: 'content_block_delta', index: 5, delta: { type: 'text_delta', text: 'x' } });
  assert.equal(feed(stray + sse).error.code, 'bad_event');
});

test('push と end は何が来ても例外を投げない', () => {
  const junk = ['', 'data: ', 'event: x\n\n', 'data: null\n\n', 'data: 1\n\n', 'data: {"type":"content_block_start"}\n\n',
    'data: {"type":"content_block_delta","index":0}\n\n', 'data: {"type":"message_delta"}\n\n'];
  for (const j of junk) {
    const a = Stream.createAssembler({ onText: () => { throw new Error('画面側の失敗'); } });
    assert.doesNotThrow(() => { a.push(j); a.push(undefined); a.end(); a.end(); });
  }
});

test('グローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/chat/claude-stream.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'fetch(']) assert.ok(!src.includes(w), w + ' が残っている');
});
