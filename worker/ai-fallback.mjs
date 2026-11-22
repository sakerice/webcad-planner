// AI の提供元が一時的に失敗したとき、別の提供元へ1回だけ切り替える決まり。
//
// なぜ在るのか
// ------------
// 提供元（Anthropic・Vertex AI）が混んでいる（529・429）・落ちている（5xx）・鍵が効かない（401・403）・
// 届かない、といった失敗は、利用者の入力と関係なく起きる。これまでは要求の前に提供元を1つ選び、
// 失敗したらそのままエラーを返していた。鍵の入っている別の提供元へ1回だけ回して、読み取りを続けられるようにする。
//
// 切り替えないもの
// ----------------
//   - 利用者の入力が悪い（400・413 など）… どこへ送っても同じく断られる
//   - モデルが安全上の理由で断った … 別のモデルで通すことはしない
//   - 2xx で返ったが読めなかった … 費用はもう出ている
//   - AI_FALLBACK=off のとき（切り替えを止める手段）
//   - AI_IMPORT_PROVIDER・AI_LOCATE_PROVIDER で提供元を名指ししているとき（名指しの振る舞いは変えない）
//
// 切り替えは1回まで。切り替え先も失敗したら、これまでどおりのエラーを返す。
// どの提供元をどこで使うか（モデルを比べた実測・Vertex は日本のリージョンだけ）は worker/routes-ai.mjs の判断のまま。

// 切り替えてよい環境か。既定は切り替える。AI_FALLBACK=off で止める。
export function fallbackEnabled(env) {
  const v = String((env && env.AI_FALLBACK) || "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}

// 一時的な失敗の種類。切り替えない失敗なら null。
//   network … 届かなかった（通信の失敗・時間切れ）
//   auth    … 鍵で認証できなかった（Vertex のトークンを取れなかった）
//   status_<n> … 上流が 408・429・5xx（529 overloaded を含む）・401・403 を返した
export function transientKind(result) {
  if (!result || result.ok) return null;
  if (result.refused) return null;
  if (result.network) return "network";
  if (result.authFailed) return "auth";
  const status = Number(result.status) || 0;
  if (!result.unbilled) return null;
  if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) return "status_" + status;
  return null;
}

// 切り替えたことを1行で残す。本文・IP・鍵は入れない。
export function logFallback(route, from, to, kind) {
  console.log(JSON.stringify({ ai_fallback: { route, from, to, kind: String(kind || "") } }));
}
