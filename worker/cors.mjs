// /api/* を、出どころの違うページ(iPhone のアプリ版)から呼べるようにする見出し(CORS)。
//
// なぜ要るか: アプリ版(Capacitor)はページの出どころが capacitor://localhost になる。WebView(WKWebView)は、
// 出どころの違うサーバーの応答を、サーバーが「この出どころには見せてよい」と返さない限りページに渡さない。
// また content-type: application/json の POST は、本体を送る前に事前の問い合わせ(OPTIONS)が飛ぶ。
//
// 決まり
// ------
//   - 許すのは worker/ai-budget.mjs の originAllowed が通す出どころだけ(SITE_ORIGINS=本番と capacitor://localhost、
//     手元の開発のホスト)。`*` にはしない。送られてきた Origin をそのまま返す。
//   - 同じ出どころ(Web 版)と Origin の無い呼び出しには何も足さない(見出しが要らない。今の応答のまま)。
//   - 許していない出どころにも何も足さない。今の応答のまま(断っている所は断ったまま、ブラウザは中身を渡さない)。
//   - 資格情報(Cookie)は使っていないので Access-Control-Allow-Credentials は付けない。
//   - /api/mcp には付けない。外の AI のサーバーから呼ばれる口で、ブラウザに読ませない作り(worker/mcp.mjs の handle 冒頭)。
//   - 事前の問い合わせへの返事はここで返し、各ルートには渡さない(回数制限・AI の数え方に数えない。本体の呼び出しで数える)。
//   - 見出しを足すだけで、通す・断るの判断はしない。AI の出どころの検査・回数制限・チャットの札はそれぞれのルートのまま。
//
// 確かめる検査: tools/tests/worker-cors.test.cjs(振り分けの単体)と tools/tests/security-headers.browser.mjs(本物の Worker)。
import { originAllowed } from "./ai-budget.mjs";
import { handlesMcp } from "./mcp.mjs";

// 画面が送る要求の形(assets/js/ と index.html の fetch)。GET と、content-type: application/json の POST だけ。
const ALLOW_METHODS = "GET, POST";
const ALLOW_HEADERS = "content-type";
// 画面が応答から読む独自の見出し。ここに無い見出しは、出どころの違うページからは読めない。
//   x-room-*  共有ルームの版・期限・保存時刻(worker/collab-room.mjs、index.html の部屋の読み込み)
//   x-chat-*  チャットの札・残りの往復・今日の残り(worker/chat.mjs、assets/js/chat/chat-session.js)
export const EXPOSE_HEADERS = [
  "x-room-version", "x-room-expires-at", "x-room-saved-at",
  "x-chat-ticket", "x-chat-rounds-left", "x-chat-remaining",
].join(", ");
const MAX_AGE = "600";

// 見出しを付けてよい出どころなら、その Origin の文字列。付けないなら null。
export function corsOrigin(request, url = new URL(request.url)) {
  if (handlesMcp(url.pathname)) return null;
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") return null;
  if (origin === url.origin) return null;
  return originAllowed(request) ? origin : null;
}

export function isPreflight(request) {
  return request.method === "OPTIONS" && request.headers.get("access-control-request-method") !== null;
}

export function preflightResponse(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": ALLOW_METHODS,
      "access-control-allow-headers": ALLOW_HEADERS,
      "access-control-max-age": MAX_AGE,
      "vary": "Origin",
      "cache-control": "no-store",
    },
  });
}

function setCors(headers, origin) {
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", EXPOSE_HEADERS);
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Origin");
  else if (!/(^|,)\s*origin\s*(,|$)/i.test(vary)) headers.set("vary", vary + ", Origin");
}

// 応答に見出しを足す。WebSocket への切り替え(101)はそのまま返す(包み直せない。出どころの制限も掛からない)。
// Durable Object から返った応答は見出しを書き換えられないので、写しを作って付ける(worker/router.mjs の withNosniff と同じ)。
export function withCors(res, origin) {
  if (!origin || !(res instanceof Response) || res.status === 101 || res.webSocket) return res;
  try {
    setCors(res.headers, origin);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    setCors(copy.headers, origin);
    return copy;
  }
}
