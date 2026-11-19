// CSP の「報告だけ」(静的アセットの _headers の Content-Security-Policy-Report-Only)の違反の報告を受ける口。
// POST /api/csp-report。ブラウザが report-uri で送る application/csp-report(と Reporting API の配列)を読む。
//
// 何を残すか: Worker のログに、違反した決まり(script-src など)と、読み込もうとした先の種類(オリジンだけ。
//   'inline'・'eval'・'data' などの語はそのまま)を1行。ページの URL・道・問い合わせ・送り手の IP・UA・
//   コードの抜粋(script-sample)は残さない(ページの URL には共有の部屋の id が入ることがある)。
// 上限: 本文は 16KB まで読む(超えたら読まずに捨てる)。1つの Worker の実体あたり、1分に LOG_PER_MINUTE 行まで出し、
//   超えた分は数だけ数えて、次の分の最初に「捨てた数」を1行出す。永続の数え先(Durable Object)は使わない
//   (クラスを増やさないため。実体ごとの上限なので、全体の上限ではない)。
// 返事: いつも 204(ブラウザは返事を見ない。断っても送り直さない)。POST 以外は 405。
import { json } from "./shared.mjs";

export const CSP_REPORT_PATH = "/api/csp-report";
export const MAX_REPORT_BYTES = 16 * 1024;
export const LOG_PER_MINUTE = 60;
const MAX_REPORTS_PER_BODY = 20;
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink", "data", "blob", "self", ""]);

const state = { minute: 0, logged: 0, dropped: 0 };

export function handlesCspReport(pathname) {
  return pathname === CSP_REPORT_PATH;
}

// 読み込もうとした先を、オリジンか決まった語だけにする。
export function blockedKind(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (KEYWORDS.has(s)) return s || "(なし)";
  try {
    const u = new URL(s);
    if (u.protocol === "data:" || u.protocol === "blob:") return u.protocol.slice(0, -1);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:" || u.protocol === "wss:") return u.origin;
    return u.protocol;
  } catch {
    return "(不明)";
  }
}

const directiveOf = (v) => (typeof v === "string" && /^[a-z-]{1,40}$/.test(v) ? v : "(不明)");

// 本文から [決まり, 先] の組を取り出す。形が違えば空。
export function parseReports(text) {
  let body;
  try { body = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(body) ? body : [body];
  const out = [];
  for (const one of list.slice(0, MAX_REPORTS_PER_BODY)) {
    if (!one || typeof one !== "object") continue;
    // report-uri の形 {"csp-report": {...}} と、Reporting API の形 {type:"csp-violation", body:{...}}
    const r = one["csp-report"] && typeof one["csp-report"] === "object" ? one["csp-report"]
      : (one.type === "csp-violation" && one.body && typeof one.body === "object" ? one.body : null);
    if (!r) continue;
    const directive = directiveOf(r["effective-directive"] || r.effectiveDirective || r["violated-directive"] || r.violatedDirective);
    const blocked = blockedKind(r["blocked-uri"] !== undefined ? r["blocked-uri"] : r.blockedURL);
    out.push([directive, blocked]);
  }
  return out;
}

async function readLimited(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_REPORT_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPORT_BYTES) { try { await reader.cancel(); } catch { /* 読み捨て */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

// now は試験で時刻を決めるため。log は console.log の代わり(試験で集める)。
export async function handleCspReport(request, { now = Date.now(), log = (...a) => console.log(...a) } = {}) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const text = await readLimited(request).catch(() => null);
  if (text === null) return new Response(null, { status: 204 });
  const minute = Math.floor(now / 60000);
  if (minute !== state.minute) {
    if (state.dropped) log(`[csp-report] 上限を超えて捨てた報告 ${state.dropped} 件`);
    state.minute = minute; state.logged = 0; state.dropped = 0;
  }
  for (const [directive, blocked] of parseReports(text)) {
    if (state.logged >= LOG_PER_MINUTE) { state.dropped++; continue; }
    state.logged++;
    log(`[csp-report] ${directive} ${blocked}`);
  }
  return new Response(null, { status: 204 });
}

// 試験のために、数え直す。
export function resetCspReportState() {
  state.minute = 0; state.logged = 0; state.dropped = 0;
}
