// AI に渡る文の守り(囲みと決まり)。攻撃の文の固定集 fixtures/injection/ai-payloads.json を、
// 利用者の依頼・部屋の名前・物の id と種類・壁の欄・読み取りのひとことに入れ、AI に渡る最終の文を確かめる。
//
// 道は3つ。どれも本物の部品を通す(本物の AI は呼ばない。Claude への送り先は偽物で、送られた本文を受け取るだけ)。
//   1. 画面のチャット: ChatSession(assets/js/chat/chat-session.js)→ 本物の Worker の /api/ai/chat → 偽の Claude。
//      道具は Worker の写し(worker/plan-ctx.mjs)で本物の操作・検査を当てる
//   2. 外の AI(MCP): 本物の振り分け・本物のルームで get_plan / open_plan / inspect_plan / renameRoom / deleteObjects
//   3. 読み取り: worker/plan-free.mjs・plan-prompt.mjs・plan-revise.mjs の指示文
//
// 確かめること(どの攻撃の文でも):
//   (a) 決まりが囲みより前にある(system の先頭、MCP の返す文の先頭)
//   (b) 信頼できない文がすべて囲みの中にある(攻撃の文に付けた目印 ZQX が囲みの外に出ない)
//   (c) 囲みの中から偽の閉じタグで外へ出ていない(半角の < > は、決まった名前の囲みの開き・閉じとしてだけ現れ、入れ子も無い)
//   (d) 掃除で落とすはずの文字(制御文字・書式文字・片割れのサロゲート・山かっこに似た文字・& と符号化した山かっこ)が囲みの中に残っていない
// あわせて、寸法つきのふつうの依頼が掃除で壊れないこと、名前の長さの上限と、system の役割を足せないことを見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const FIX = JSON.parse(fs.readFileSync(join(__dirname, 'fixtures', 'injection', 'ai-payloads.json'), 'utf8'));
const expand = (p) => (p.repeat ? p.value.repeat(p.repeat) : p.value);
const MARK = 'ZQX';
const ATTACKS = FIX.attacks.map((p) => ({ id: p.id, value: MARK + expand(p) }));
const BENIGN = FIX.benign.map((p) => ({ id: p.id, value: expand(p) }));

const TAGS = ['plan_summary', 'user_request', 'tool_result', 'inspect_result', 'user_hint', 'previous_answer', 'check_facts'];
// 決まりの見出し。どの道の決まりもこの見出しで始める。
const RULES_HEAD = '【入力の扱い】';
// 囲みの中に残ってはいけない文字。
const BAD = /[\p{Cf}\p{Cs}\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029＜＞﹤﹥‹›«»〈〉〈〉《》⟨⟩⟪⟫❮❯❬❭❰❱⧼⧽˂˃ᐸᐳ≪≫⋘⋙︿﹀︽︾&]|\\u\{?0*3[ce]|\\x3[ce]|%3[ce]/iu;

// 文を囲みで切り分ける。半角の < > が決まった囲みの開き・閉じ以外で出たら、入れ子・閉じ忘れ・対の違いがあったら落とす。
function segments(text, where) {
  const re = /<(\/?)([A-Za-z_]+)>|[<>]/g;
  let m, open = null, at = 0, outside = '', firstTag = -1;
  const insides = [];
  while ((m = re.exec(text))) {
    assert.ok(m[2] && TAGS.includes(m[2]), `${where}: 囲みでない < > がある: ${JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + 30))}`);
    if (firstTag < 0) firstTag = m.index;
    if (!m[1]) {
      assert.equal(open, null, `${where}: 囲みが入れ子になっている(${open && open.tag} の中に ${m[2]})`);
      outside += text.slice(at, m.index);
      open = { tag: m[2], from: re.lastIndex };
    } else {
      assert.ok(open && open.tag === m[2], `${where}: 開いていない囲み ${m[2]} を閉じている`);
      insides.push({ tag: m[2], inner: text.slice(open.from, m.index) });
      open = null;
    }
    at = re.lastIndex;
  }
  assert.equal(open, null, `${where}: 囲み ${open && open.tag} が閉じていない`);
  outside += text.slice(at);
  return { outside, insides, firstTag };
}
// 信頼できない文だけの欄(利用者の依頼・道具の結果): 囲みの外は空白だけ。囲みの中に落とすはずの文字が無い。
function checkWrapped(text, where) {
  const s = segments(text, where);
  assert.equal(s.outside.trim(), '', `${where}: 囲みの外に文がある: ${JSON.stringify(s.outside.slice(0, 80))}`);
  assert.ok(s.insides.length > 0, `${where}: 囲みが無い`);
  for (const one of s.insides) assert.ok(!BAD.test(one.inner), `${where}: <${one.tag}> の中に落とすはずの文字が残っている: ${JSON.stringify(one.inner.match(BAD))}`);
  return s;
}
// こちらの文と信頼できない文が混ざる欄(MCP の返す文・読み取りの指示文): 決まりが先頭にあり、目印は囲みの中だけ。
function checkMixed(text, where, { rules = true } = {}) {
  const s = segments(text, where);
  if (rules) {
    assert.ok(text.startsWith(RULES_HEAD), `${where}: 先頭に決まりが無い: ${JSON.stringify(text.slice(0, 40))}`);
    assert.ok(s.firstTag < 0 || s.firstTag > RULES_HEAD.length, `${where}: 決まりより前に囲みがある`);
  }
  assert.ok(!s.outside.includes(MARK), `${where}: 攻撃の文が囲みの外にある: ${JSON.stringify(s.outside.slice(Math.max(0, s.outside.indexOf(MARK) - 40), s.outside.indexOf(MARK) + 60))}`);
  for (const one of s.insides) assert.ok(!BAD.test(one.inner), `${where}: <${one.tag}> の中に落とすはずの文字が残っている: ${JSON.stringify(one.inner.match(BAD))}`);
  return s;
}

// ── 1. 画面のチャット → Worker → Claude ─────────────────────────────
const Session = require('../../assets/js/chat/chat-session.js');
const Ops = require('../../assets/js/plan-core/operations.js');
const Catalog = require('../../assets/js/plan-core/operations-catalog.js');
const { sseFor } = require('./chat-sse-fixtures.cjs');
const KEY = 'sk-test-guard-key';

async function realQuota() {
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const data = new Map();
  const storage = {
    get: async (keys) => {
      if (Array.isArray(keys)) { const m = new Map(); for (const k of keys) if (data.has(k)) m.set(k, data.get(k)); return m; }
      return data.get(keys);
    },
    put: async (a, b) => { if (typeof a === 'string') data.set(a, b); else for (const k of Object.keys(a)) data.set(k, a[k]); },
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async () => new Map(data),
  };
  const obj = new AiQuota({ storage }, {});
  const stub = { fetch: async (url) => obj.fetch(new Request(String(url))) };
  return { idFromName: () => 'id', get: () => stub };
}

// Worker の受け口を直接呼ぶ fetch。Claude へ送った本文を upstream に貯め、台本の SSE を返す。
async function workerFetch(script) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: await realQuota() };
  const upstream = [];
  const browser = [];
  const fetchImpl = async (req) => {
    const body = JSON.parse(await req.text());
    upstream.push(body);
    const step = script[upstream.length - 1];
    if (!step) throw new Error('台本に無い呼び出し');
    return new Response(sseFor(step.content, { stop: step.stop }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const fetch = async (url, init) => {
    browser.push(JSON.parse(init.body));
    const u = new URL('https://example.test' + url);
    const request = new Request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: init.body });
    return handleAi(request, env, u, { fetchImpl });
  };
  return { fetch, upstream, browser, env, handleAi, fetchImpl };
}

// id は共有ルームの検査(worker/room-guard.mjs の maxIdLength 200)に収まる長さにする。
function attackPlan(a) {
  const id = a.slice(0, 150);
  return {
    walls: [{ id: 1, x1: 0, y1: 0, x2: 4000, y2: 0, floor: 1, thick: 120, baseLevel: a }],
    rooms: [
      { id: 'rm_a', x: 0, y: 0, w: 4000, d: 3000, floor: 1, n: a },
      { id: 'rm_' + id, x: 0, y: 3000, w: 2000, d: 2000, floor: 1, n: '寝室' },
    ],
    items: [
      { id: 10, type: 'bath', x: 1000, y: 1000, w: 800, d: 1400, rot: 0, floor: 1 },
      { id, type: a, x: 2500, y: 500, w: 600, d: 600, rot: 0, floor: 1, stairTarget: a },
    ],
  };
}

async function chatTools() {
  const pc = await mod('worker/plan-ctx.mjs');
  const Summary = require('../../assets/js/chat/plan-summary.js');
  return {
    pc,
    tools: {
      checkArgs: Catalog.checkArgs,
      applyOperations: (p, ops, ctx) => Ops.applyOperations(p, ops, ctx),
      inspectPlan: (p) => pc.workerInspect(p),
      clonePlan: Ops.clonePlan,
    },
    summarize: (p) => Summary.summarize(p, {}),
  };
}

function checkUpstream(body, where) {
  const sys = body.system.map((b) => b.text).join('\n');
  assert.ok(sys.startsWith(RULES_HEAD), `${where}: system の先頭に決まりが無い`);
  assert.ok(!sys.includes(MARK), `${where}: system に攻撃の文が入っている`);
  body.messages.forEach((m, i) => {
    const at = `${where} messages[${i}]`;
    if (m.role === 'user') {
      if (typeof m.content === 'string') { checkWrapped(m.content, at); return; }
      for (const b of m.content) {
        if (b.type === 'text') checkWrapped(b.text, at + ' text');
        else if (b.type === 'tool_result') {
          if (typeof b.content === 'string') checkWrapped(b.content, at + ' tool_result');
          else for (const x of b.content || []) checkWrapped(x.text, at + ' tool_result');
        }
      }
    } else if (typeof m.content === 'string') {
      // 前の依頼の AI の文(画面が文字で入れ直す)。囲みは付けないが、< > と落とす文字は無い。
      assert.ok(!/[<>]/.test(m.content) && !BAD.test(m.content), `${at}: 前の AI の文に < > か落とす文字がある`);
    }
  });
}

test('画面のチャット: どの攻撃の文でも、AI に渡る system と messages の形が守られる', async () => {
  const { tools, summarize } = await chatTools();
  for (const { id, value: a } of ATTACKS) {
    const w = await workerFetch([
      { content: [{ type: 'tool_use', id: 't1', name: 'renameRoom', input: { id: 'rm_a', name: a } },
        { type: 'tool_use', id: 't2', name: 'deleteObjects', input: { ids: [a] } },
        { type: 'tool_use', id: 't3', name: 'inspect_plan', input: {} },
        { type: 'tool_use', id: 't4', name: 'placeItem', input: { type: a, x: 1, y: 1 } }], stop: 'tool_use' },
      { content: [{ type: 'text', text: a }], stop: 'end_turn' },
      { content: [{ type: 'text', text: 'はい' }], stop: 'end_turn' },
    ]);
    const pc = await mod('worker/plan-ctx.mjs');
    let plan = attackPlan(a);
    const s = Session.create({ fetch: w.fetch, getPlan: () => plan, ctxFor: () => pc.workerOpsCtx(plan, {}), tools, summarize, AbortController });
    const r1 = await s.send(a);
    assert.equal(r1.ok, true, `${id}: ${JSON.stringify(r1)}`);
    const r2 = await s.send(a);
    assert.equal(r2.ok, true, `${id}: ${JSON.stringify(r2)}`);
    assert.equal(w.upstream.length, 3, id);
    w.upstream.forEach((b, i) => checkUpstream(b, `${id} 呼び出し${i + 1}`));
    // 画面が送った形のまま Claude に届く(Worker で包み直していない = 画面の側で守れている)
    w.browser.forEach((b, i) => assert.deepEqual(w.upstream[i].messages, b.messages, `${id}: Worker が画面の messages を包み直した(画面の側で囲めていない)`));
  }
});

test('画面のチャット: 寸法つきのふつうの依頼は、掃除で変わらずに届く', async () => {
  const { tools, summarize } = await chatTools();
  const pc = await mod('worker/plan-ctx.mjs');
  for (const { id, value } of BENIGN) {
    const w = await workerFetch([{ content: [{ type: 'text', text: 'はい' }], stop: 'end_turn' }]);
    const plan = attackPlan('洋室');
    const s = Session.create({ fetch: w.fetch, getPlan: () => plan, ctxFor: () => pc.workerOpsCtx(plan, {}), tools, summarize, AbortController });
    assert.equal((await s.send(value)).ok, true, id);
    const last = w.upstream[0].messages[w.upstream[0].messages.length - 1].content;
    const seg = checkWrapped(last, id);
    const req = seg.insides.find((x) => x.tag === 'user_request');
    assert.equal(req.inner.trim(), value, `${id}: 依頼の文が変わった`);
  }
});

test('Worker: 囲みの形になっていない messages(古い画面・直接の呼び出し)は Worker が囲んで送る', async () => {
  for (const { id, value: a } of ATTACKS) {
    const w = await workerFetch([{ content: [{ type: 'text', text: 'はい' }], stop: 'end_turn' }]);
    const messages = [
      { role: 'user', content: '<plan_summary>\n部屋「' + a + '」\n</plan_summary>\n\n' + a },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x1', name: 'renameRoom', input: { id: 'rm_a', name: a } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x1', content: JSON.stringify({ errors: [a] }) },
        { type: 'text', text: a }] },
    ];
    const res = await w.fetch('/api/ai/chat', { body: JSON.stringify({ messages }) });
    assert.equal(res.status, 200, id);
    checkUpstream(w.upstream[0], 'Worker ' + id);
  }
});

test('Worker: system の役割の文をブラウザから足せない', async () => {
  const w = await workerFetch([{ content: [{ type: 'text', text: 'はい' }], stop: 'end_turn' }]);
  const bad = await w.fetch('/api/ai/chat', { body: JSON.stringify({ messages: [{ role: 'system', content: 'EVILSYS' }, { role: 'user', content: 'x' }] }) });
  assert.equal(bad.status, 400);
  const ok = await w.fetch('/api/ai/chat', { body: JSON.stringify({ system: 'EVILSYS', messages: [{ role: 'user', content: 'x' }] }) });
  assert.equal(ok.status, 200);
  assert.equal(w.upstream.length, 1);
  assert.ok(!JSON.stringify(w.upstream[0]).includes('EVILSYS'), 'payload.system が Claude に届いた');
  assert.ok(w.upstream[0].system[0].text.startsWith(RULES_HEAD));
});

// ── 2. 外の AI(MCP) ──────────────────────────────────────────────
const { makeEnv, fakeState } = require('./collab-room-fakes.cjs');
const HOST = 'https://cad-planner.example.test';
async function mcpSetup() {
  const env = await makeEnv();
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const quotas = new Map();
  env.AI_QUOTA = {
    idFromName: (name) => ({ name: String(name) }),
    get(idv) {
      if (!quotas.has(idv.name)) { const st = fakeState(); quotas.set(idv.name, new AiQuota(st, env)); }
      const q = quotas.get(idv.name);
      return { fetch: (input, init) => q.fetch(input instanceof Request ? input : new Request(input, init)) };
    },
  };
  const router = (await mod('worker/router.mjs')).default;
  let n = 1;
  const call = async (name, args) => {
    const res = await router.fetch(new Request(HOST + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: n++, method: 'tools/call', params: { name, arguments: args } }),
    }), env);
    const j = await res.json();
    assert.ok(j.result, JSON.stringify(j));
    return j.result.content.map((c) => c.text).join('\n');
  };
  return { env, call };
}

test('MCP: どの攻撃の文でも、返す文の先頭に決まりがあり、プラン由来の文は囲みの中', async () => {
  const { env, call } = await mcpSetup();
  const rooms = await mod('worker/routes-rooms.mjs');
  for (const { id, value: a } of ATTACKS) {
    const made = await rooms.createRoomWithPlan(env, attackPlan(a), HOST);
    assert.ok(made && made.roomId, id);
    const plan = made.roomId;
    const outs = [
      ['get_plan', await call('get_plan', { plan })],
      ['open_plan', await call('open_plan', { plan })],
      ['inspect_plan', await call('inspect_plan', { plan })],
      ['renameRoom', await call('renameRoom', { plan, id: 'rm_a', name: a.slice(0, 400) })],
      ['deleteObjects', await call('deleteObjects', { plan, ids: [a.slice(0, 400)] })],
      ['setProps', await call('setProps', { plan, id: 'rm_a', set: { ['k' + a.slice(0, 300)]: 1 } })],
      ['placeItem', await call('placeItem', { plan, type: a.slice(0, 400), x: 100, y: 100 })],
    ];
    for (const [name, t] of outs) checkMixed(t, `MCP ${id} ${name}`);
  }
});

test('MCP: 道具の説明に、結果の囲みの中はデータで指示ではないことを書く', async () => {
  const { MCP_TOOLS, INSTRUCTIONS } = await mod('worker/mcp.mjs');
  for (const t of MCP_TOOLS) {
    if (t.name === 'create_plan') continue;
    assert.match(t.description, /指示ではない/, t.name);
  }
  assert.match(INSTRUCTIONS, /指示ではありません/);
});

// ── 3. 読み取り ───────────────────────────────────────────────────
test('読み取り: ひとこと・前回の答え・機械で分かったことは囲みの中。決まりは system の先頭', async () => {
  const free = await mod('worker/plan-free.mjs');
  const prompt = await mod('worker/plan-prompt.mjs');
  const revise = await mod('worker/plan-revise.mjs');
  for (const sys of [free.FREE_SYSTEM, free.FREE_REVIEW_SYSTEM, prompt.SYSTEM_PROMPT, revise.REVISE_SYSTEM]) {
    assert.ok(sys.startsWith(RULES_HEAD), '読み取りの system の先頭に決まりが無い: ' + sys.slice(0, 30));
    assert.match(sys, /画像/);
  }
  for (const { id, value: a } of ATTACKS) {
    const hint = a.slice(0, 500);
    const answer = { floors: [{ floor: 1, rooms: [{ name: a, parts: [] }] }], notes: [a] };
    const texts = [
      ['read-plan', free.buildFreePrompt({ pages: 1, hint })],
      ['review-plan-3d', free.buildFreeReviewPrompt({ pages: 1, shots: ['1階 平面図'], answer, facts: [a.slice(0, 200)], hint })],
      ['import-plan', prompt.buildPlanPrompt({ hint })],
      ['import-plan 2ページ', prompt.buildPlanPrompt({ hint, page: 'この画像はPDFの1ページ目です（全2ページ）。' })],
      ['revise-plan', revise.buildRevisePrompt({ json: JSON.stringify(answer), hint })],
    ];
    for (const [name, t] of texts) {
      const s = checkMixed(t, `読み取り ${id} ${name}`, { rules: false });
      assert.ok(s.insides.some((x) => x.tag === 'user_hint'), `${id} ${name}: ひとことの囲みが無い`);
    }
  }
  // ふつうのひとことは変わらない
  for (const { id, value } of BENIGN) {
    const s = segments(free.buildFreePrompt({ pages: 1, hint: value }), id);
    assert.equal(s.insides.find((x) => x.tag === 'user_hint').inner.trim(), value, id);
  }
});

// ── 名前の長さと掃除(書き込む時点) ──────────────────────────────────
test('名前: addRoom・renameRoom は 40 字を超えると失敗し、制御文字・書式文字は落として書く', async () => {
  const pc = await mod('worker/plan-ctx.mjs');
  const base = () => ({ walls: [], items: [], rooms: [{ id: 'rm_a', x: 0, y: 0, w: 1000, d: 1000, floor: 1, n: '洋室' }] });
  const long = 'あ'.repeat(41);
  assert.equal(Catalog.checkArgs('renameRoom', { id: 'rm_a', name: long }).ok, false, 'checkArgs が 41 字を通した');
  assert.equal(Catalog.checkArgs('addRoom', { x: 0, y: 0, w: 1, d: 1, name: long }).ok, false);
  assert.equal(Catalog.checkArgs('renameRoom', { id: 'rm_a', name: '😀'.repeat(40) }).ok, true, '40 字(絵文字は1字)は通る');
  let p = base();
  let r = Ops.applyOperations(p, [{ op: 'renameRoom', args: { id: 'rm_a', name: long } }], pc.workerOpsCtx(p, {}));
  assert.ok(r.errors.length, 'renameRoom が 41 字を通した');
  r = Ops.applyOperations(p, [{ op: 'addRoom', args: { x: 0, y: 0, w: 1000, d: 1000, name: long } }], pc.workerOpsCtx(p, {}));
  assert.ok(r.errors.length, 'addRoom が 41 字を通した');
  r = Ops.applyOperations(p, [{ op: 'renameRoom', args: { id: 'rm_a', name: '和\u200b室\u202e\u0007\udb40\udc41\ud800' } }], pc.workerOpsCtx(p, {}));
  assert.equal(r.errors.length, 0);
  assert.equal(r.plan.rooms[0].n, '和室');
  // 既に長い名前が入ったプランも、ほかの操作はそのまま通る(開ける・直せる)
  p = base(); p.rooms[0].n = 'い'.repeat(300);
  r = Ops.applyOperations(p, [{ op: 'resizeRoom', args: { id: 'rm_a', w: 2000 } }], pc.workerOpsCtx(p, {}));
  assert.equal(r.errors.length, 0);
  assert.equal(r.plan.rooms[0].n, 'い'.repeat(300));
});

test('名前: 読み取りの答えの部屋の名前は 40 字に切り、制御文字・書式文字を落とす', () => {
  const Apply = require('../../assets/js/plan-free-apply.js');
  const out = Apply.toImportPlan({ floors: [{ floor: 1, walls: [], openings: [], stairs: [], roofs: [], objects: [],
    rooms: [{ name: '書\u200d斎' + '長'.repeat(100), parts: [{ x0: 0, y0: 0, x1: 1000, y1: 1000 }], set: "" }] }] }, {});
  const n = out.rooms[0].n;
  assert.equal(Array.from(n).length, 40, n);
  assert.ok(n.startsWith('書斎長'));
});

test('掃除: 画面・Worker・名前の書き込みで、落とす文字の決まりが同じ', () => {
  const Summary = require('../../assets/js/chat/plan-summary.js');
  const Settable = require('../../assets/js/plan-settable.js');
  for (const { id, value } of ATTACKS) {
    const v = value.slice(0, 300);
    const want = Summary.stripInvisible(v).replace(new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g'), ' ').replace(/\s+/g, ' ').trim();
    assert.equal(Ops.tidyName(v), want, id + ' operations.js');
    assert.equal(Settable.tidyText(v), want, id + ' plan-settable.js');
    // 1行の掃除(要約の名前)は、見えない文字と制御文字の扱いが同じうえで、山かっこなどを書き換える
    assert.equal(Summary.clean(v, 100000), Summary.clean(want, 100000), id + ' clean');
    // 切り詰めは文字(コードポイント)単位で、片割れのサロゲートを作らない
    const c = Summary.clean(v, 7);
    assert.ok(!/\p{Cs}/u.test(c), id);
  }
});
