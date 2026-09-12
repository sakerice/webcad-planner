// AWS の署名 (Signature Version 4)。
//
// なぜ自前で書くのか
// ------------------
// Cloudflare Worker から Bedrock を呼ぶには AWS の署名が要る。AWS の SDK は
// Node の crypto や http に依存していて Worker では素直に動かないうえ、
// 署名1つのために数MBの依存を抱えることになる。必要なのは HMAC-SHA256 と
// SHA-256 だけで、どちらも Worker の Web Crypto にある。
//
// 手順は AWS のドキュメントどおり:
//   1. 正規化した要求 (canonical request) を作って SHA-256
//   2. 署名の対象文字列 (string to sign) を組み立てる
//   3. 日付→リージョン→サービス→"aws4_request" の順に鍵を派生させる
//   4. 対象文字列を派生鍵で HMAC して署名にする
//
// ここは鍵を直接触る場所なので、**署名以外のことをさせない**。
const encoder = new TextEncoder();

function hex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

// 2026-09-12T13:45:00Z → { amzDate: "20260912T134500Z", dateStamp: "20260912" }
function timestamps(now) {
  const iso = new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

// 署名付きの Request を返す。呼ぶ側はそのまま fetch する。
//
// credentials: { accessKeyId, secretAccessKey, sessionToken? }
export async function signRequest({ method = "POST", url, body, service, region, credentials, headers = {}, now = Date.now() }) {
  const target = new URL(url);
  const { amzDate, dateStamp } = timestamps(now);
  const payloadHash = await sha256Hex(body || "");

  const baseHeaders = {
    host: target.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...headers,
  };
  if (credentials.sessionToken) baseHeaders["x-amz-security-token"] = credentials.sessionToken;

  // ヘッダ名は小文字にして名前順。値は前後の空白を落とす。
  const sorted = Object.keys(baseHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sorted.map((k) => {
    const key = Object.keys(baseHeaders).find((h) => h.toLowerCase() === k);
    return `${k}:${String(baseHeaders[key]).trim()}\n`;
  }).join("");
  const signedHeaders = sorted.join(";");

  // パスの各区切りは、区切り文字そのものを残したまま中身だけを encode する。
  // モデルIDに "." や ":" が入るので、まるごと encodeURIComponent してはいけない。
  const canonicalUri = target.pathname.split("/").map((seg) => encodeURIComponent(seg)).join("/") || "/";
  const canonicalQuery = [...target.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1)))
    .map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  let key = await hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign));

  return new Request(target.toString(), {
    method,
    body,
    headers: {
      ...baseHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
}

// 検査から手順の途中を確かめられるように出しておく。
export const _internals = { sha256Hex, hmac, hex, timestamps };
