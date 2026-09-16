// Google のサービスアカウントで認証して、アクセストークンを得る。
//
// なぜ自前で書くのか
// ------------------
// Google の公式ライブラリは Node の crypto や fs に依存していて、Cloudflare
// Worker では動かない。必要なのは「秘密鍵で JWT に署名して、トークンと
// 交換する」だけで、署名は Worker の Web Crypto にある。
//
// 手順
//   1. {iss:サービスアカウント, scope, aud:トークン窓口, iat, exp} を作る
//   2. 秘密鍵(RSA)で RS256 署名して JWT にする
//   3. その JWT を Google のトークン窓口へ渡し、アクセストークンと交換する
//
// **秘密鍵はこのファイルの外へ出さない。** 署名にだけ使い、応答にも
// ログにも載せない。
const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlText(text) {
  return base64url(encoder.encode(text));
}

// PEM (-----BEGIN PRIVATE KEY----- …) を Web Crypto が読める形にする。
function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return der.buffer;
}

async function signJwt(credentials, { scope, now }) {
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    iss: credentials.client_email,
    scope,
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const signingInput =
    base64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    base64urlText(JSON.stringify(claims));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(credentials.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));
  return signingInput + "." + base64url(signature);
}

// トークンは1時間もつので、期限まで使い回す。毎回取り直すと、呼び出しの
// たびに往復が1つ増えて遅くなる。
const _tokenCache = new Map();

export async function getAccessToken(credentials, {
  scope = "https://www.googleapis.com/auth/cloud-platform",
  fetchImpl = fetch,
  now = Date.now(),
  cache = _tokenCache,
} = {}) {
  const cacheKey = credentials.client_email + "|" + scope;
  const hit = cache.get(cacheKey);
  // 期限の60秒前に取り直す。使っている最中に切れるのを避ける。
  if (hit && hit.expiresAt - 60000 > now) return { ok: true, token: hit.token, cached: true };

  let assertion;
  try {
    assertion = await signJwt(credentials, { scope, now });
  } catch (e) {
    return { ok: false, status: 500, message: "サービスアカウントの鍵を読めませんでした: " + (e && e.message) };
  }

  const response = await fetchImpl(new Request(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(assertion),
  }));
  const raw = await response.text();
  if (!response.ok) {
    let message = raw.slice(0, 200);
    try {
      const body = JSON.parse(raw);
      message = body.error_description || body.error || message;
    } catch { /* 本文が JSON でないことがある */ }
    return { ok: false, status: response.status, message };
  }
  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false, status: 502, message: "トークンの応答が JSON ではない" }; }
  if (!body.access_token) return { ok: false, status: 502, message: "トークンが返ってこなかった" };

  cache.set(cacheKey, { token: body.access_token, expiresAt: now + (Number(body.expires_in) || 3600) * 1000 });
  return { ok: true, token: body.access_token, cached: false };
}

// 鍵の JSON が、使える形かどうか。**中身は返さない。**
export function readCredentials(json) {
  const need = ["client_email", "private_key", "project_id"];
  if (!json || typeof json !== "object") return { ok: false, message: "鍵が JSON オブジェクトではない" };
  const missing = need.filter((k) => !json[k]);
  if (missing.length) return { ok: false, message: "鍵に足りない項目: " + missing.join(", ") };
  if (!String(json.private_key).includes("BEGIN")) return { ok: false, message: "private_key が PEM の形ではない" };
  return { ok: true, credentials: json };
}

export const _internals = { base64url, base64urlText, pemToDer, signJwt };
