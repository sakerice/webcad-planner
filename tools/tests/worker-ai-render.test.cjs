// アプリの中で AIレンダーを生成する窓口（POST /api/ai/render・POST /api/ai/render-report・GET /api/ai/quota の
// レンダーの欄）。設計書 docs/superpowers/specs/2026-11-27-ai-render-in-app-design.md の「検査」の Worker の項目。
//
// 本物の Vertex AI は呼ばない（fetch を偽物にする）。数の持ち主は本物の AiQuota を偽の storage で動かす。
// サービスアカウントの鍵は、検査の中で作った使い捨ての RSA 鍵（本物の鍵は読まない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { generateKeyPairSync } = require('node:crypto');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

// 2026-11-20 12:00（日本時間）
const T = Date.UTC(2026, 10, 20, 3, 0, 0);
const realNow = Date.now;
function at(ms) { Date.now = () => ms; }
test.afterEach(() => { Date.now = realNow; });

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = JSON.stringify({ client_email: 'render-test@p.iam.gserviceaccount.com', private_key: PEM, project_id: 'proj-test',
  token_uri: 'https://oauth2.googleapis.com/token' });

// 小さな JPEG と PNG（先頭の印だけ本物。中身は検査では見ない）。
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const OUT_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
const BODY = () => ({ preset: 'life', view: 'interior', aspect: '3:2', images: { base: JPEG, depth: JPEG, edge: PNG } });
// 4 枚目（面の向き＝法線の絵）を添えた形。normal は任意の欄。
const NORMAL_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDB==';
const BODY4 = () => ({ ...BODY(), images: { ...BODY().images, normal: NORMAL_JPEG } });

const micro = (usd) => Math.ceil(usd * 1e6);

async function realQuota({ seed } = {}) {
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const data = new Map(Object.entries(seed || {}));
  const storage = {
    get: async (keys) => {
      if (Array.isArray(keys)) { const m = new Map(); for (const k of keys) if (data.has(k)) m.set(k, data.get(k)); return m; }
      return data.get(keys);
    },
    put: async (a, b) => { if (typeof a === 'string') data.set(a, b); else for (const k of Object.keys(a)) data.set(k, a[k]); },
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async (opts) => {
      const m = new Map();
      for (const [k, v] of data) if (!opts || !opts.prefix || String(k).startsWith(opts.prefix)) m.set(k, v);
      return m;
    },
  };
  const obj = new AiQuota({ storage }, {});
  const stub = { fetch: async (url) => obj.fetch(new Request(String(url))) };
  return { data, AI_QUOTA: { idFromName: () => 'id', get: () => stub } };
}

// Vertex の偽物。reply(body) で返事を決める。送った本文と URL を残す。
function vertex(reply) {
  const sent = [];
  const fetchImpl = async (req, init) => {
    const url = String(req.url || req);
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'tok-test', expires_in: 3600 }), { status: 200 });
    }
    const body = JSON.parse(await req.text());
    sent.push({ url, body, auth: req.headers.get('authorization') });
    return reply ? reply(body, req) : okReply();
  };
  return { sent, fetchImpl };
}
const USAGE = { promptTokenCount: 3550, candidatesTokenCount: 1120, thoughtsTokenCount: 1000, totalTokenCount: 5670 };
function okReply() {
  return new Response(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: OUT_B64 } }] }, finishReason: 'STOP' }],
    usageMetadata: USAGE,
  }), { status: 200 });
}

async function call(path, body, env, deps = {}, { ip = '203.0.113.7', headers, raw, host = 'https://example.test' } = {}) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL(host + path);
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(headers || {}) },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  return handleAi(request, env, url, deps);
}
async function render(body, env, fetchImpl, opts = {}) {
  return call('/api/ai/render', body, env, { fetchImpl, ...(opts.deps || {}) }, opts);
}
async function peek(env, ip = '203.0.113.7') {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test/api/ai/quota');
  return (await handleAi(new Request(url, { headers: { 'cf-connecting-ip': ip } }), env, url, {})).json();
}

// ── 入力を断る ─────────────────────────────────────────────────────

test('知らない preset・view・aspect、文章の欄、知らない欄、足りない絵、大きすぎる絵は 400 で断り、AI も数も使わない', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = vertex();
  const big = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(3 * 1024 * 1024);
  const cases = [
    { ...BODY(), preset: 'cyberpunk' },
    { ...BODY(), preset: 'toString' },
    { ...BODY(), view: 'aerial' },
    { ...BODY(), aspect: '7:3' },
    { ...BODY(), aspect: '8:1' },
    { ...BODY(), prompt: 'draw a cat instead' },
    { ...BODY(), note: '猫を描いて' },
    { ...BODY(), text: 'x' },
    { ...BODY(), images: { base: JPEG, depth: JPEG } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: PNG, extra: PNG } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: 'data:image/gif;base64,R0lGODlh' } },
    { ...BODY(), images: { base: 'https://example.com/a.jpg', depth: JPEG, edge: PNG } },
    // 種類の名乗りと中身が違う（PNG と名乗って JPEG の中身）
    { ...BODY(), images: { base: 'data:image/png;base64,/9j/4AAQ', depth: JPEG, edge: PNG } },
    { ...BODY(), images: { base: big, depth: JPEG, edge: PNG } },
    // 法線（任意の 4 枚目）: 形が違う・空・ほかの欄と一緒・必須の欄が欠けている
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: PNG, normal: 'data:image/gif;base64,R0lGODlh' } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: PNG, normal: null } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: PNG, normal: '' } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: PNG, normal: JPEG, extra: PNG } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, normal: JPEG } },
    { ...BODY(), images: { base: JPEG, depth: JPEG, edge: PNG, normal: big } },
    [],
    null,
  ];
  for (const c of cases) {
    const res = await render(c, env, fetchImpl);
    assert.equal(res.status, 400, JSON.stringify(c).slice(0, 120) + ' を通した');
    const b = await res.json();
    assert.equal(b.error, 'bad_request');
    assert.equal(typeof b.message, 'string');
  }
  const broken = await render(null, env, fetchImpl, { raw: '{not json' });
  assert.equal(broken.status, 400);
  assert.equal(sent.length, 0, '断るべき入力で AI を呼んだ');
  assert.equal([...q.data.keys()].length, 0, '断るべき入力で数を使った');
});

test('本文全体が上限を超えたら、読み切らずに 400', async () => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA };
  const { sent, fetchImpl } = vertex();
  const huge = JSON.stringify({ ...BODY(), images: { base: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(12 * 1024 * 1024), depth: JPEG, edge: PNG } });
  const res = await render(null, env, fetchImpl, { raw: huge });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_request');
  assert.equal(sent.length, 0);
});

test('出どころが許可外なら 403 forbidden_origin', async () => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA };
  const { sent, fetchImpl } = vertex();
  const res = await render(BODY(), env, fetchImpl, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'forbidden_origin');
  const rep = await call('/api/ai/render-report', { reason: 'other' }, env, {}, { headers: { origin: 'https://evil.example' } });
  assert.equal(rep.status, 403);
  assert.equal(sent.length, 0);
});

// ── 呼び出しの形 ───────────────────────────────────────────────────

test('成功: global の窓口へ、3 枚の絵と Worker が組んだ指示文を送り、絵と残り枚数を返す', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = vertex();
  const res = await render(BODY(), env, fetchImpl);
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.image, 'data:image/png;base64,' + OUT_B64);
  assert.equal(b.remaining, 4);
  assert.deepEqual(Object.keys(b).sort(), ['image', 'remaining']);

  assert.equal(sent.length, 1);
  const { url, body, auth } = sent[0];
  assert.equal(url, 'https://aiplatform.googleapis.com/v1/projects/proj-test/locations/global/publishers/google/models/gemini-nano-banana-2.1:generateContent');
  assert.equal(auth, 'Bearer tok-test');
  const parts = body.contents[0].parts;
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.slice(0, 3).map((p) => p.inlineData.mimeType), ['image/jpeg', 'image/jpeg', 'image/png']);
  assert.equal(parts[0].inlineData.data, JPEG.split(',')[1]);
  assert.equal(parts[2].inlineData.data, PNG.split(',')[1]);
  const { buildRenderPrompt } = await mod('worker/render-prompt.mjs');
  assert.equal(parts[3].text, buildRenderPrompt({ preset: 'life', view: 'interior' }));
  assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
  assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '3:2', imageSize: '1K' });
  assert.equal(body.tools, undefined, 'Google Search による根拠づけを使っている');
  assert.ok(!JSON.stringify(body).includes('googleSearch'));
});

test('法線あり: 4 枚目として法線の絵を送り、指示文に 4 枚目の説明が入る。法線なしの指示文は今までと同じ', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = vertex();
  const res = await render(BODY4(), env, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).image, 'data:image/png;base64,' + OUT_B64);
  const parts = sent[0].body.contents[0].parts;
  assert.equal(parts.length, 5);
  assert.deepEqual(parts.slice(0, 4).map((p) => p.inlineData.mimeType), ['image/jpeg', 'image/jpeg', 'image/png', 'image/jpeg']);
  assert.equal(parts[3].inlineData.data, NORMAL_JPEG.split(',')[1], '4 枚目が法線の絵でない');
  const { buildRenderPrompt } = await mod('worker/render-prompt.mjs');
  assert.equal(parts[4].text, buildRenderPrompt({ preset: 'life', view: 'interior', withNormal: true }));
  assert.match(parts[4].text, /Image 4/);

  // 法線なし（3 枚）は 4 枚目に触れない
  const three = vertex();
  assert.equal((await render(BODY(), env, three.fetchImpl)).status, 200);
  const t = three.sent[0].body.contents[0].parts;
  assert.equal(t.length, 4);
  assert.doesNotMatch(t[3].text, /Image 4|normal map/i);
  assert.equal(t[3].text, buildRenderPrompt({ preset: 'life', view: 'interior' }));
});

test('光の出し方は環境変数 AI_RENDER_LIGHTING でだけ切り替わる（無い・知らない値は soft）。API の欄では変えられない', async () => {
  at(T);
  const q = await realQuota();
  const { buildRenderPrompt } = await mod('worker/render-prompt.mjs');
  const soft = buildRenderPrompt({ preset: 'life', view: 'interior' });
  const sunlit = buildRenderPrompt({ preset: 'life', view: 'interior', lighting: 'sunlit' });
  assert.notEqual(soft, sunlit);
  const textOf = async (env, body = BODY()) => {
    const v = vertex();
    const res = await render(body, { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA, ...env }, v.fetchImpl);
    return { status: res.status, text: v.sent.length ? v.sent[0].body.contents[0].parts.at(-1).text : null };
  };
  assert.equal((await textOf({})).text, soft);
  assert.equal((await textOf({ AI_RENDER_LIGHTING: 'sunlit' })).text, sunlit);
  assert.equal((await textOf({ AI_RENDER_LIGHTING: 'SUNLIT' })).text, soft);
  assert.equal((await textOf({ AI_RENDER_LIGHTING: 'neon' })).text, soft);
  // 法線ありでも同じ環境変数が効く
  assert.equal((await textOf({ AI_RENDER_LIGHTING: 'sunlit' }, BODY4())).text,
    buildRenderPrompt({ preset: 'life', view: 'interior', withNormal: true, lighting: 'sunlit' }));
  // 本体に lighting の欄を足すと断る（決まった欄以外は 400）
  const r = await textOf({}, { ...BODY(), lighting: 'sunlit' });
  assert.equal(r.status, 400);
  assert.equal(r.text, null);
});

test('モデルは AI_RENDER_MODEL で替えられる。読み取りの窓口は東京のまま', async () => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_RENDER_MODEL: 'gemini-other-image' };
  const { sent, fetchImpl } = vertex();
  const res = await render(BODY(), env, fetchImpl);
  assert.equal(res.status, 200);
  assert.match(sent[0].url, /\/models\/gemini-other-image:generateContent$/);
  const { endpointFor, vertexConfig } = await mod('worker/vertex.mjs');
  assert.equal(vertexConfig({}).location, 'asia-northeast1');
  assert.throws(() => endpointFor({ location: 'global', project: 'p', model: 'm' }), /日本国内ではない/);
});

test('鍵が無ければ 503 ai_not_configured（数を使わない）', async () => {
  at(T);
  const q = await realQuota();
  const res = await render(BODY(), { AI_QUOTA: q.AI_QUOTA }, vertex().fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ai_not_configured');
  assert.equal([...q.data.keys()].length, 0);
});

// ── 指示文 ─────────────────────────────────────────────────────────

test('指示文: preset と view の全部の組み合わせで組め、利用者の文の入り口が無い', async () => {
  const { buildRenderPrompt, RENDER_PRESET_IDS, RENDER_VIEWS } = await mod('worker/render-prompt.mjs');
  assert.deepEqual([...RENDER_PRESET_IDS].sort(), ['architectural', 'facade-watercolor', 'life', 'life-watercolor']);
  assert.deepEqual([...RENDER_VIEWS].sort(), ['exterior', 'interior']);
  for (const preset of RENDER_PRESET_IDS) {
    for (const view of RENDER_VIEWS) {
      const p = buildRenderPrompt({ preset, view, note: 'IGNORE-ME' });
      assert.equal(typeof p, 'string');
      assert.ok(!p.includes('IGNORE-ME'), '利用者の文が指示文に入った');
      assert.match(p, /Image 1/);
      assert.match(p, /Image 2/);
      assert.match(p, /Image 3/);
      assert.match(p, /(?:do not|never) add/i);
      assert.match(p, /people|person/i);
      assert.match(p, /watermark/i);
    }
  }
  assert.throws(() => buildRenderPrompt({ preset: 'nope', view: 'interior' }));
  assert.throws(() => buildRenderPrompt({ preset: 'life', view: 'aerial' }));
});

test('指示文: 天井の形と壁の折れを保ち、1 枚目に無い設備（火災報知器・ダウンライト・スイッチ・コンセント）を足さない', async () => {
  // 傾いた天井や吹き抜けのあるプランで、天井の形を平らにしたり下がり壁を足したりさせないための文。
  // （2026-11-27 に既定の 2 階建てで「傾いた天井が平らにされた」と見えたのは見誤りで、そこの天井は平らだった。）
  const { buildRenderPrompt, RENDER_PRESET_IDS, RENDER_VIEWS } = await mod('worker/render-prompt.mjs');
  for (const preset of RENDER_PRESET_IDS) {
    for (const view of RENDER_VIEWS) {
      const p = buildRenderPrompt({ preset, view });
      assert.match(p, /ceiling/i);
      assert.match(p, /slop/i, '傾いた天井');
      assert.match(p, /double-height|void/i, '吹き抜け');
      assert.match(p, /step/i, '天井の段差');
      assert.match(p, /beam/i, '梁');
      assert.match(p, /do not flatten|never flatten/i, '平らにしない');
      assert.match(p, /drop(ped)? (wall|soffit)|bulkhead/i, '下がり壁を足さない');
      assert.match(p, /corner|jog|turn/i, '壁の折れ');
      for (const w of [/smoke (detector|alarm)/i, /downlight/i, /switch/i, /(socket|outlet)/i]) assert.match(p, w);
    }
  }
});

test('指示文（法線あり）: 4 枚目の色と向きの対応を、撮影（three.js の MeshNormalMaterial、カメラから見た向き）どおりに書く', async () => {
  // 撮影は index.html の captureAiOverrideGuideDataUrl('normal')。色 = カメラから見た法線 × 0.5 + 0.5。
  // 赤 = 右向き、緑 = 上向き、青 = カメラの方を向く。床（上向き）は緑が強く、平らな天井（下向き）は緑が無い。
  const { buildRenderPrompt, RENDER_PRESET_IDS, RENDER_VIEWS } = await mod('worker/render-prompt.mjs');
  for (const preset of RENDER_PRESET_IDS) {
    for (const view of RENDER_VIEWS) {
      const p = buildRenderPrompt({ preset, view, withNormal: true });
      assert.match(p, /Image 4/);
      assert.match(p, /more red = facing further to the right/i);
      assert.match(p, /more green = facing up/i);
      assert.match(p, /more blue = facing the camera/i);
      assert.match(p, /flat floor is light green/i);
      assert.match(p, /flat horizontal ceiling is purple \(no green\)/i);
      assert.match(p, /never copy its colours/i);
      assert.match(p, /tilt in image 4/i);
      assert.match(p, /images 2, 3 and 4/i);
      // 法線なしの指示文の決まり（天井・設備）は、法線ありでも全部残る
      assert.match(p, /never flatten/i);
      assert.match(p, /downlight/i);
      // 法線を頼んでいない形（true 以外）は 4 枚目に触れない
      assert.equal(buildRenderPrompt({ preset, view, withNormal: 'yes' }), buildRenderPrompt({ preset, view }));
    }
  }
});

test('指示文（sunlit）: 窓の形の日だまり・家具の影・面ごとの明るさの差を頼み、黒つぶれと白飛びを禁じる。形と色の決まりは soft と同じ', async () => {
  // 2026-11-27 利用者「候補で出していた時のような、光がよく差し込み複雑な陰影ができる見た目の方が映える」。
  const { buildRenderPrompt, RENDER_PRESET_IDS, RENDER_VIEWS, RENDER_LIGHTINGS } = await mod('worker/render-prompt.mjs');
  assert.deepEqual([...RENDER_LIGHTINGS], ['soft', 'sunlit']);
  for (const preset of RENDER_PRESET_IDS) {
    for (const view of RENDER_VIEWS) {
      for (const withNormal of [false, true]) {
        const soft = buildRenderPrompt({ preset, view, withNormal });
        const sun = buildRenderPrompt({ preset, view, withNormal, lighting: 'sunlit' });
        // 既定は soft。知らない値も soft。
        assert.equal(buildRenderPrompt({ preset, view, withNormal, lighting: 'soft' }), soft);
        assert.equal(buildRenderPrompt({ preset, view, withNormal, lighting: 'noon' }), soft);
        assert.notEqual(sun, soft);
        // 変わるのは「光」の 2 行だけ。形・色・設備の決まりは 1 文字も変わらない。
        const a = soft.split('\n'), b = sun.split('\n');
        assert.equal(a.length, b.length);
        const diff = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
        assert.equal(diff.length, 2, `${preset}/${view}: 光の行以外が変わった`);
        for (const i of diff) assert.ok(i > a.indexOf('Improve only light and material realism:'), '光の段より前が変わった');
        assert.match(sun, /keep the hue and lightness of every surface/i);
        if (view === 'interior') {
          assert.match(sun, /direct sunlight/i);
          assert.match(sun, /patches of sun that copy the shape of those windows/i, '窓の形の日だまり');
          assert.match(sun, /casts a clear, well-defined shadow/i, '家具の影');
          assert.match(sun, /own brightness/i, '面ごとの明るさの差');
          assert.match(sun, /nothing turns black/i, '黒つぶれ');
          assert.match(sun, /never blown out/i, '白飛び');
          assert.doesNotMatch(sun, /soft fill light/i);
        } else {
          assert.match(sun, /sunny/i);
          assert.match(sun, /never black/i);
        }
      }
    }
  }
});

test('指示文: 3 枚目（輪郭）に描かれた照明器具はその位置に描いてよく、3 枚目に無いダウンライトは足さない（soft・sunlit とも）', async () => {
  // 図面のダウンライト（light-down）は 3D の絵に写らず、輪郭の絵にだけ輪として出る（2026-11-27 に確かめた）。
  // 以前の「ダウンライトを足すな」は 3 枚目と食い違っていた。
  const { buildRenderPrompt, RENDER_PRESET_IDS, RENDER_VIEWS } = await mod('worker/render-prompt.mjs');
  for (const preset of RENDER_PRESET_IDS) {
    for (const view of RENDER_VIEWS) {
      for (const lighting of ['soft', 'sunlit']) {
        const p = buildRenderPrompt({ preset, view, lighting });
        assert.match(p, /neither image 1 nor image 3 shows/i);
        assert.match(p, /light fitting that image 3 draws on the ceiling/i);
        assert.match(p, /at exactly that spot/i);
        assert.match(p, /add no downlights or recessed lights anywhere else/i);
        assert.doesNotMatch(p, /no downlights or recessed lights, no ceiling lights/i, '古い「ダウンライトを足すな」が残っている');
      }
    }
  }
});

// ── 上限 ───────────────────────────────────────────────────────────

test('1 接続元 1 日 5 枚まで。6 枚目は 429 scope user で、AI を呼ばない', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = vertex();
  for (let i = 0; i < 5; i++) {
    const res = await render(BODY(), env, fetchImpl);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).remaining, 4 - i);
  }
  const over = await render(BODY(), env, fetchImpl);
  assert.equal(over.status, 429);
  const b = await over.json();
  assert.equal(b.error, 'ai_quota_exceeded');
  assert.equal(b.scope, 'user');
  assert.match(b.message, /朝9時/);
  assert.ok(!/\$|usd|token|トークン|秒/i.test(b.message));
  assert.equal(sent.length, 5);
  // 別の接続元はまだ使える
  const other = await render(BODY(), env, fetchImpl, { ip: '198.51.100.9' });
  assert.equal(other.status, 200);
});

test('全体の上限（環境変数で変更）に達すると 429 scope total。1 人の枚数も環境変数で変わる', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA, AI_RENDER_DAILY_TOTAL: '3', AI_RENDER_DAILY_PER_USER: '2' };
  const { fetchImpl } = vertex();
  assert.equal((await render(BODY(), env, fetchImpl, { ip: '192.0.2.1' })).status, 200);
  assert.equal((await render(BODY(), env, fetchImpl, { ip: '192.0.2.1' })).status, 200);
  const mine = await render(BODY(), env, fetchImpl, { ip: '192.0.2.1' });
  assert.equal(mine.status, 429);
  assert.equal((await mine.json()).scope, 'user');
  const third = await render(BODY(), env, fetchImpl, { ip: '192.0.2.2' });
  assert.equal(third.status, 200);
  assert.equal((await third.json()).remaining, 0, '全体の残りが 0 なのに 1 以上を返した');
  const total = await render(BODY(), env, fetchImpl, { ip: '192.0.2.3' });
  assert.equal(total.status, 429);
  assert.equal((await total.json()).scope, 'total');
});

test('レンダーは読み取りの点（1 人 168・全体 700）を減らさない', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const before = await peek(env);
  for (let i = 0; i < 5; i++) assert.equal((await render(BODY(), env, vertex().fetchImpl)).status, 200);
  const after = await peek(env);
  assert.equal(after.left, before.left, '読み取りの残り回数が減った');
  assert.equal(q.data.get('total:2026-11-20'), undefined, '読み取りの点（全体）に数えた');
  assert.equal(q.data.get('who:2026-11-20:203.0.113.7'), undefined, '読み取りの点（1 人）に数えた');
  assert.equal(q.data.get('render-who:2026-11-20:203.0.113.7'), 5);
});

test('金額の枠は共有: 仮押さえしてから呼び、usage で精算する。月の枠が尽きていれば呼ばずに 429', async () => {
  at(T);
  const { renderUsageUsd } = await mod('worker/ai-price.mjs');
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  let monthDuringCall = null;
  const { fetchImpl } = vertex(() => { monthDuringCall = q.data.get('usd-month:2026-11'); return okReply(); });
  assert.equal((await render(BODY(), env, fetchImpl)).status, 200);
  const expected = renderUsageUsd({ inputTokens: 3550, outputTokens: 1120, thoughtTokens: 1000 });
  assert.ok(expected > 0.03 && expected < 0.08, '1 枚の額の見積もりがおかしい: ' + expected);
  assert.ok(monthDuringCall > micro(expected), '呼ぶ前に仮押さえしていない');
  assert.equal(q.data.get('usd-month:2026-11'), micro(expected), 'usage どおりに精算していない');
  assert.equal([...q.data.keys()].filter((k) => k.startsWith('hold:')).length, 0, '仮押さえが残った');

  const full = await realQuota({ seed: { 'usd-month:2026-11': micro(80) } });
  const v = vertex();
  const res = await render(BODY(), { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: full.AI_QUOTA }, v.fetchImpl);
  assert.equal(res.status, 429);
  const b = await res.json();
  assert.equal(b.error, 'ai_quota_exceeded');
  assert.equal(b.scope, 'month');
  assert.equal(v.sent.length, 0);
});

test('数えられない（数の持ち主が返らない・壊れた返事）ときは 503 ai_quota_unavailable で、AI を呼ばない', async () => {
  const broken = { idFromName: () => 'id', get: () => ({ fetch: async () => new Response('oops', { status: 500 }) }) };
  const { sent, fetchImpl } = vertex();
  const res = await render(BODY(), { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: broken }, fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ai_quota_unavailable');
  // 本番のホストで数える仕組みが無いのは設定の事故なので断る
  const none = await render(BODY(), { GOOGLE_SERVICE_ACCOUNT_JSON: SA }, fetchImpl, { host: 'https://cad-planner.srapps.us' });
  assert.equal(none.status, 503);
  assert.equal(sent.length, 0);
});

// ── 上流の失敗 ─────────────────────────────────────────────────────

test('安全上の停止（finishReason・promptFeedback.blockReason）は 422 render_blocked', async () => {
  at(T);
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: (await realQuota()).AI_QUOTA };
  const replies = [
    { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }], usageMetadata: USAGE },
    { candidates: [{ finishReason: 'SAFETY' }], usageMetadata: USAGE },
    { candidates: [{ finishReason: 'IMAGE_PROHIBITED_CONTENT' }] },
    { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 3550 } },
  ];
  for (const r of replies) {
    const { fetchImpl } = vertex(() => new Response(JSON.stringify(r), { status: 200 }));
    const res = await render(BODY(), env, fetchImpl);
    assert.equal(res.status, 422, JSON.stringify(r));
    const b = await res.json();
    assert.equal(b.error, 'render_blocked');
    assert.match(b.message, /視点/);
  }
});

test('上流のエラー本文は返さない（502 ai_upstream_error）。2xx 以外は 0 で精算する', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const secret = 'SECRET-PART-OF-KEY-AIza123 project proj-test quota';
  const { fetchImpl } = vertex(() => new Response(JSON.stringify({ error: { code: 429, message: secret } }), { status: 429 }));
  const res = await render(BODY(), env, fetchImpl);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes('SECRET-PART'), '上流の本文を返した');
  assert.ok(!text.includes('proj-test'));
  assert.equal(JSON.parse(text).error, 'ai_upstream_error');
  assert.equal(q.data.get('usd-month:2026-11'), 0, '課金されていない失敗の額を残した');
});

test('絵が返らない（文だけ・NO_IMAGE・JSON でない）は 502 ai_upstream_error', async () => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA };
  const replies = [
    () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'I cannot' }] }, finishReason: 'STOP' }] }), { status: 200 }),
    () => new Response(JSON.stringify({ candidates: [{ finishReason: 'NO_IMAGE' }] }), { status: 200 }),
    () => new Response('<html>bad gateway</html>', { status: 200 }),
    () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'text/html', data: 'PGI+' } }] } }] }), { status: 200 }),
  ];
  for (const reply of replies) {
    const res = await render(BODY(), env, vertex(reply).fetchImpl);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'ai_upstream_error');
  }
});

test('上流の待ちは時間で切り、502 ai_upstream_error', async () => {
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA };
  let aborted = false;
  const fetchImpl = async (req) => {
    const url = String(req.url);
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    return new Promise((_, reject) => {
      req.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    });
  };
  const started = realNow();
  const res = await render(BODY(), env, fetchImpl, { deps: { renderTimeoutMs: 50 } });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'ai_upstream_error');
  assert.ok(aborted, '上流への要求を止めていない');
  assert.ok(realNow() - started < 5000);
  const { RENDER_TIMEOUT_MS } = await mod('worker/vertex-render.mjs');
  assert.equal(RENDER_TIMEOUT_MS, 90000);
});

// ── 時間切れ・通信失敗の精算（1 日の額の枠は読み取り・チャットと共有するので、積む額を現実の 1 枚に近づける）──

test('出力の上限は 4096 トークン。呼んでいる間の仮押さえ（途中で Worker が止まったら pend に残る額）は $0.17 未満', async () => {
  at(T);
  const { RENDER_MAX_OUTPUT_TOKENS } = await mod('worker/vertex-render.mjs');
  assert.equal(RENDER_MAX_OUTPUT_TOKENS, 4096);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  let holds = null;
  const { sent, fetchImpl } = vertex(() => {
    holds = [...q.data.entries()].filter(([k]) => String(k).startsWith('hold:')).map(([, v]) => v);
    return okReply();
  });
  assert.equal((await render(BODY(), env, fetchImpl)).status, 200);
  assert.equal(sent[0].body.generationConfig.maxOutputTokens, 4096);
  assert.equal(holds.length, 1, '仮押さえが 1 件でない');
  // 精算されずに期限が過ぎた仮押さえは、この額のまま pend に積まれる（worker/ai-quota.mjs の forgetOld）。
  assert.ok(holds[0].usd > micro(0.1) && holds[0].usd < micro(0.17), '仮押さえの額: ' + holds[0].usd / 1e6);

  // 法線あり（4 枚）は、入力の絵 1 枚分だけ多く仮押さえする
  at(T);
  const q4 = await realQuota();
  let holds4 = null;
  const v4 = vertex(() => {
    holds4 = [...q4.data.entries()].filter(([k]) => String(k).startsWith('hold:')).map(([, v]) => v);
    return okReply();
  });
  assert.equal((await render(BODY4(), { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q4.AI_QUOTA }, v4.fetchImpl)).status, 200);
  assert.equal(holds4.length, 1);
  const { renderHoldUsd, imageTokens } = await mod('worker/ai-price.mjs');
  const oneImage = renderHoldUsd({ inputTokens: imageTokens([{}]), maxOutputTokens: 0 }) - renderHoldUsd({ inputTokens: 0, maxOutputTokens: 0 });
  assert.ok(holds4[0].usd > holds[0].usd, '法線ありの仮押さえが増えていない');
  assert.ok(Math.abs((holds4[0].usd - holds[0].usd) - micro(oneImage)) <= micro(0.002), '差が絵 1 枚分でない: ' + (holds4[0].usd - holds[0].usd) / 1e6);
  assert.ok(holds4[0].usd < micro(0.19), '法線ありの仮押さえの額: ' + holds4[0].usd / 1e6);
});

test('時間切れ・届かない・usage の無い返事は、仮押さえの額でなく現実的な見積もり（約 $0.06）で精算する', async () => {
  const { renderFailureUsd } = await mod('worker/ai-price.mjs');
  const { buildRenderPrompt } = await mod('worker/render-prompt.mjs');
  const expected = renderFailureUsd({ text: buildRenderPrompt({ preset: 'life', view: 'interior' }), images: 3 });
  assert.ok(expected > 0.04 && expected < 0.08, '失敗の見積もり: ' + expected);
  const hang = async (req) => {
    const url = String(req.url);
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    return new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };
  const unreachable = async (req) => {
    const url = String(req.url);
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    throw new TypeError('network down');
  };
  const noUsage = vertex(() => new Response('<html>gateway</html>', { status: 200 })).fetchImpl;
  for (const [name, fetchImpl, deps] of [['時間切れ', hang, { renderTimeoutMs: 50 }], ['届かない', unreachable, {}], ['usage が無い', noUsage, {}]]) {
    at(T);
    const q = await realQuota();
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
    const res = await render(BODY(), env, fetchImpl, { deps });
    assert.equal(res.status, 502, name);
    assert.equal(q.data.get('usd-month:2026-11'), micro(expected), name + ': 月の額が見積もりどおりでない');
    assert.equal(q.data.get('pend:2026-11-20:203.0.113.7'), micro(expected), name + ': 精算されずに残った額が見積もりどおりでない');
    assert.equal([...q.data.keys()].filter((k) => k.startsWith('hold:')).length, 0, name + ': 仮押さえが残った');
  }
  // 法線あり（4 枚）は、入力の絵 1 枚分（と長くなった指示文の分）だけ多く見積もる
  const expected4 = renderFailureUsd({ text: buildRenderPrompt({ preset: 'life', view: 'interior', withNormal: true }), images: 4 });
  assert.ok(expected4 > expected && expected4 < 0.08, '法線ありの失敗の見積もり: ' + expected4);
  at(T);
  const q4 = await realQuota();
  const res4 = await render(BODY4(), { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q4.AI_QUOTA }, unreachable);
  assert.equal(res4.status, 502);
  assert.equal(q4.data.get('usd-month:2026-11'), micro(expected4), '法線あり: 月の額が見積もりどおりでない');
});

// ── レンダーだけを止める ─────────────────────────────────────────────

test('AI_RENDER_DAILY_TOTAL=0・AI_RENDER_DAILY_PER_USER=0 はレンダーを止める（429 scope total。AI も数も使わない）', async () => {
  at(T);
  for (const stop of [{ AI_RENDER_DAILY_TOTAL: '0' }, { AI_RENDER_DAILY_PER_USER: '0' }, { AI_RENDER_DAILY_TOTAL: 0 }]) {
    const q = await realQuota();
    const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA, ...stop };
    const { sent, fetchImpl } = vertex();
    const res = await render(BODY(), env, fetchImpl);
    assert.equal(res.status, 429, JSON.stringify(stop));
    const b = await res.json();
    assert.equal(b.error, 'ai_quota_exceeded');
    assert.equal(b.scope, 'total');
    assert.match(b.message, /使えません/);
    assert.ok(!/\$|usd|token|トークン|AI_RENDER/i.test(b.message));
    assert.equal(sent.length, 0, 'AI を呼んだ');
    assert.equal([...q.data.keys()].length, 0, '数か額を使った');
    // 残り枚数の欄は 0 と、断る文
    const r = (await peek(env)).render;
    assert.equal(r.left, 0);
    assert.equal(r.message, b.message);
    assert.equal(typeof r.perUser, 'number');
    // 数える仕組みが無い環境（手元）でも止まる
    const local = (await peek({ ...stop })).render;
    assert.equal(local.left, 0);
    assert.equal((await render(BODY(), { GOOGLE_SERVICE_ACCOUNT_JSON: SA, ...stop }, fetchImpl)).status, 429);
    assert.equal(sent.length, 0);
  }
});

test('上限の環境変数: 未設定・空・数でない値は既定（1 人 5・全体 30）。jev の数え方は変えない', async () => {
  const { renderLimits, jevLimits } = await mod('worker/ai-quota.mjs');
  assert.deepEqual(renderLimits({}), { perUser: 5, total: 30 });
  assert.deepEqual(renderLimits({ AI_RENDER_DAILY_TOTAL: '', AI_RENDER_DAILY_PER_USER: '  ' }), { perUser: 5, total: 30 });
  assert.deepEqual(renderLimits({ AI_RENDER_DAILY_TOTAL: 'abc', AI_RENDER_DAILY_PER_USER: 'x' }), { perUser: 5, total: 30 });
  assert.deepEqual(renderLimits({ AI_RENDER_DAILY_TOTAL: '-3' }), { perUser: 5, total: 30 });
  assert.deepEqual(renderLimits({ AI_RENDER_DAILY_TOTAL: '0' }), { perUser: 5, total: 0 });
  assert.deepEqual(renderLimits({ AI_RENDER_DAILY_PER_USER: '0' }), { perUser: 0, total: 30 });
  assert.deepEqual(renderLimits({ AI_RENDER_DAILY_TOTAL: '12', AI_RENDER_DAILY_PER_USER: '2' }), { perUser: 2, total: 12 });
  assert.deepEqual(jevLimits({ AI_JEV_DAILY_TOTAL: '0', AI_JEV_DAILY_PER_USER: '0' }), jevLimits({}));
});

// ── 残り枚数 ───────────────────────────────────────────────────────

test('/api/ai/quota にレンダーの残り枚数を足す（既存の欄は変えない）', async () => {
  at(T);
  const q = await realQuota();
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: SA, AI_QUOTA: q.AI_QUOTA };
  const fresh = await peek(env);
  assert.equal(fresh.left, 2);
  assert.equal(fresh.counted, true);
  assert.deepEqual(fresh.render, { left: 5, perUser: 5 });
  await render(BODY(), env, vertex().fetchImpl);
  assert.deepEqual((await peek(env)).render, { left: 4, perUser: 5 });
  // 月の枠が尽きたら 0 と、断る文
  const full = await realQuota({ seed: { 'usd-month:2026-11': micro(80) } });
  const f = await peek({ AI_QUOTA: full.AI_QUOTA });
  assert.equal(f.render.left, 0);
  assert.match(f.render.message, /今月ぶん/);
  // 数えられないときは数を出さない
  const hidden = await peek({});
  assert.deepEqual(hidden.render, { left: null, perUser: 5 });
  for (const v of [fresh, f, hidden]) assert.ok(!JSON.stringify(v).match(/usd|dollar/i));
});

// ── 報告 ───────────────────────────────────────────────────────────

function fakeR2() {
  const objects = new Map();
  return { objects, PLANS: { put: async (key, value, opts) => { objects.set(key, { value: String(value), opts }); } } };
}

test('報告: R2 の render-reports/<日付>/ に時刻・理由・絵を書き、接続元の IP は書かない', async () => {
  at(T);
  const q = await realQuota();
  const r2 = fakeR2();
  const env = { AI_QUOTA: q.AI_QUOTA, PLANS: r2.PLANS };
  const res = await call('/api/ai/render-report', { reason: 'wrong_layout', image: PNG }, env, {}, { ip: '203.0.113.99' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(r2.objects.size, 1);
  const [key, obj] = [...r2.objects][0];
  assert.match(key, /^render-reports\/2026-11-20\/[A-Za-z0-9_-]{16,}\.json$/);
  const saved = JSON.parse(obj.value);
  assert.equal(saved.reason, 'wrong_layout');
  assert.equal(saved.image, PNG);
  assert.equal(saved.at, new Date(T).toISOString());
  assert.ok(!obj.value.includes('203.0.113'), 'IP を書いた');
  assert.ok(![...q.data.keys()].some((k) => k.startsWith('render-')), '報告をレンダーの枚数に数えた');

  // 絵なしでもよい
  const noImage = await call('/api/ai/render-report', { reason: 'inappropriate' }, env);
  assert.equal(noImage.status, 200);
  const last = JSON.parse([...r2.objects.values()][1].value);
  assert.equal(last.image, undefined);
});

test('報告: 知らない理由・知らない欄・絵の形の違いは 400。1 接続元 1 日 10 件まで', async () => {
  at(T);
  const q = await realQuota();
  const r2 = fakeR2();
  const env = { AI_QUOTA: q.AI_QUOTA, PLANS: r2.PLANS };
  for (const bad of [{ reason: 'spam' }, { reason: 'other', text: 'hello' }, { reason: 'other', image: 'https://x/y.png' }, {}, []]) {
    const res = await call('/api/ai/render-report', bad, env);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal((await res.json()).error, 'bad_request');
  }
  assert.equal(r2.objects.size, 0);
  for (let i = 0; i < 10; i++) assert.equal((await call('/api/ai/render-report', { reason: 'other' }, env)).status, 200);
  const over = await call('/api/ai/render-report', { reason: 'other' }, env);
  assert.equal(over.status, 429);
  assert.equal((await over.json()).error, 'ai_quota_exceeded');
  assert.equal(r2.objects.size, 10);
  assert.equal((await call('/api/ai/render-report', { reason: 'other' }, env, {}, { ip: '198.51.100.1' })).status, 200);
});
