// AWS の署名 (Signature Version 4)。
//
// 署名は1文字違えば AWS に拒否されるだけで、部分的に正しいということが無い。
// 一方、正しいかどうかを手元で確かめるのは難しい。そこで:
//
//   1. **AWS 公式ドキュメントが公開している派生鍵の値**と突き合わせる。
//      これが合えば HMAC の連鎖（日付→リージョン→サービス→aws4_request）は
//      間違いなく正しい。外部の正解と照らす唯一の手段。
//   2. 残りは、署名の対象に何が入っているかを性質として見る。
//      本文・日付・リージョン・モデルIDのどれを変えても署名が変わること。
//      どれかが署名に入っていなければ、そこは黙って無視されていることになる。
//
// 実際に Bedrock が受け付けるかは鍵が要るので、tools/probe_bedrock.cjs で
// 1度だけ確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const sigv4 = () => import(pathToFileURL(join(ROOT, 'worker', 'aws-sigv4.mjs')).href);

const CREDS = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const WHEN = Date.parse('2026-09-12T04:05:06Z');

async function sign(over) {
  const { signRequest } = await sigv4();
  return signRequest({
    url: 'https://bedrock-runtime.ap-northeast-1.amazonaws.com/model/jp.anthropic.claude-sonnet-4-6/converse',
    body: '{"hello":1}',
    service: 'bedrock',
    region: 'ap-northeast-1',
    credentials: CREDS,
    headers: { 'content-type': 'application/json' },
    now: WHEN,
    ...over,
  });
}
function signatureOf(request) {
  return /Signature=([0-9a-f]{64})/.exec(request.headers.get('authorization'))[1];
}

test('派生鍵が AWS 公式ドキュメントの例と一致する', async () => {
  const { _internals } = await sigv4();
  const { hmac, hex } = _internals;
  let key = await hmac('AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830');
  key = await hmac(key, 'us-east-1');
  key = await hmac(key, 'iam');
  key = await hmac(key, 'aws4_request');
  assert.equal(hex(key), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
});

test('Authorization ヘッダの形と、鍵の使い分け', async () => {
  const req = await sign();
  const auth = req.headers.get('authorization');
  assert.match(auth, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260912\/ap-northeast-1\/bedrock\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
  // アクセスキーIDは表に出る（そういうもの）。秘密鍵は出てはいけない。
  assert.ok(!auth.includes('wJalrXUtnFEMI'), '秘密鍵が署名ヘッダに出ている');
  assert.equal(req.headers.get('x-amz-date'), '20260912T040506Z');
});

test('署名するヘッダは小文字・名前順で、host と日付を必ず含む', async () => {
  const req = await sign();
  const signed = /SignedHeaders=([a-z0-9;-]+)/.exec(req.headers.get('authorization'))[1].split(';');
  assert.deepEqual(signed, signed.slice().sort(), '名前順になっていない');
  for (const need of ['host', 'x-amz-date', 'x-amz-content-sha256', 'content-type']) {
    assert.ok(signed.includes(need), need + ' が署名の対象に入っていない');
  }
});

test('本文の要約(SHA-256)がヘッダに入り、本文を変えれば署名も変わる', async () => {
  const a = await sign();
  const b = await sign({ body: '{"hello":2}' });
  assert.notEqual(a.headers.get('x-amz-content-sha256'), b.headers.get('x-amz-content-sha256'));
  assert.notEqual(signatureOf(a), signatureOf(b), '本文が署名に効いていない（差し替え放題になる）');
});

test('日付・リージョン・サービス・パスのどれを変えても署名が変わる', async () => {
  const base = signatureOf(await sign());
  const variants = {
    '日付': await sign({ now: WHEN + 86400000 }),
    'リージョン': await sign({ region: 'us-east-1' }),
    'サービス': await sign({ service: 's3' }),
    'パス(モデルID)': await sign({ url: 'https://bedrock-runtime.ap-northeast-1.amazonaws.com/model/jp.anthropic.claude-opus-4-8/converse' }),
  };
  for (const [name, req] of Object.entries(variants)) {
    assert.notEqual(signatureOf(req), base, name + ' が署名に効いていない');
  }
});

test('同じ入力なら毎回同じ署名になる', async () => {
  assert.equal(signatureOf(await sign()), signatureOf(await sign()));
});

test('モデルIDの "." や ":" をパスで壊さない', async () => {
  // encodeURIComponent をパス全体にかけると "/" まで潰れる。区切りは残す。
  const req = await sign();
  assert.match(req.url, /\/model\/jp\.anthropic\.claude-sonnet-4-6\/converse$/);
});

test('一時的な認証情報のときは、トークンも署名の対象に入る', async () => {
  const withToken = await sign({ credentials: { ...CREDS, sessionToken: 'FwoGZXIvYXdzEExample' } });
  assert.equal(withToken.headers.get('x-amz-security-token'), 'FwoGZXIvYXdzEExample');
  assert.match(/SignedHeaders=([a-z0-9;-]+)/.exec(withToken.headers.get('authorization'))[1], /x-amz-security-token/);
});
