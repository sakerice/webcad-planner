// AI を呼ぶ前の数え方（点・月の金額の枠・jev の回数）と、呼んだ後の精算。Worker 側の窓口。
//
// 数の持ち主は worker/ai-quota.mjs の AiQuota（Durable Object）。単価と見積もりは worker/ai-price.mjs。
//
// 決まり
// ------
//   - 運営者の費用がかかる呼び出しは、呼ぶ前に必ずここを通す。数える仕組みが 5 秒返らない・例外・
//     形の違う返事のときは **AI を呼ばずに断る**（以前の読み取りは通していた。上限なしになるため改めた）
//   - env.AI_QUOTA が無いときは、手元の開発のホスト（localhost・127.0.0.1・*.localhost・*.test）だけ
//     数えずに通す（手元の検査のため）。それ以外のホストで束縛が無いのは設定の事故なので断る
//   - 仮押さえ（最悪の額）を取ってから呼び、返事の usage で精算する。usage が取れなければ仮押さえのまま
import { budgetConfig, toMicro, anthropicUsageUsd, inputHoldUsd, interruptedOutputTokens, priceOf } from "./ai-price.mjs";
import { quotaLimits, jevLimits } from "./ai-quota.mjs";

export const QUOTA_TIMEOUT_MS = 5000;

// ── 利用者への文（開発の都合の数字は出さない） ───────────────────────
// 1日の数は UTC の日付で切っているので、日本時間の朝9時に戻る。0時〜9時に断ったときは「明日」ではない。
export function dayLimitMessage(now = Date.now()) {
  const jstHour = new Date(now + 9 * 60 * 60 * 1000).getUTCHours();
  return "本日ぶんの AI は受付を終えました。" + (jstHour < 9 ? "朝9時から再開します。" : "明日の朝9時から再開します。")
    + "画面の操作では引き続き作れます。";
}
export const MONTH_LIMIT_MESSAGE = "今月ぶんの AI の受付を終えました。来月1日から再開します。画面の操作では引き続き作れます。";
export const BUSY_MESSAGE = "いま AI が混み合っています。少し待ってから、もう一度お試しください。";

// ── 出どころ（Origin）の確認 ─────────────────────────────────────
//
// 他サイトのページから、利用者のブラウザ越しに /api/ai/* を使われるのを止める（Origin は偽れるので、
// ブラウザの外からの呼び出しは止まらない。そちらは上の数え方で止める）。
// 通すのは: Origin が無い（ブラウザの外・同じ出どころの GET など）・要求先と同じ出どころ（本番・プレビューの
// *.workers.dev は自分のホストへ送るのでここで通る）・本番のホスト・手元の開発のホスト。
// capacitor://localhost は iOS 版（Capacitor）の画面の出どころ。
const SITE_ORIGINS = new Set(["https://cad-planner.srapps.us", "capacitor://localhost"]);
export function isLocalHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost") || h.endsWith(".test");
}
export function originAllowed(request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  // capacitor: のような特別でない形の URL は origin が "null" になるので、文字のまま比べる。
  if (SITE_ORIGINS.has(origin)) return true;
  let o;
  try { o = new URL(origin); } catch (e) { return false; }
  if (o.origin === "null") return false;
  if (o.origin === new URL(request.url).origin) return true;
  if (SITE_ORIGINS.has(o.origin)) return true;
  return (o.protocol === "http:" || o.protocol === "https:") && isLocalHost(o.hostname);
}

// ── 数の持ち主に聞く ─────────────────────────────────────────────
// 返らない・例外・形が違うときは null（呼び出し側が断る）。
export async function askQuota(env, path, params, name = "ai-usage") {
  if (!env || !env.AI_QUOTA) return null;
  let timer;
  try {
    const stub = env.AI_QUOTA.get(env.AI_QUOTA.idFromName(name));
    const res = await Promise.race([
      stub.fetch("https://ai-quota" + path + "?" + new URLSearchParams(params)),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), QUOTA_TIMEOUT_MS); }),
    ]);
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" && !Array.isArray(data) && typeof data.ok === "boolean" ? data : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 数える仕組みが無いとき、数えずに通してよいか（手元の開発のホストだけ）。
export function quotaOptional(request, env) {
  if (env && env.AI_QUOTA) return false;
  try { return isLocalHost(new URL(request.url).hostname); } catch (e) { return false; }
}

// 「1人」。IPv4 は1アドレス、IPv6 は /64 ごと（1つの回線に /64 がまるごと配られることが多く、
// アドレスを替えるだけで別人になれないように）。
export function whoOf(request) {
  const ip = String((request && request.headers.get("cf-connecting-ip")) || "unknown");
  if (!ip.includes(":")) return ip;
  return ipv6Prefix64(ip) || "unknown";
}
function ipv6Prefix64(ip) {
  const [head, tail] = ip.toLowerCase().split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined && tail ? tail.split(":") : [];
  if (ip.includes("::")) {
    const fill = 8 - a.length - b.length;
    if (fill < 0) return null;
    a.push(...Array(fill).fill("0"), ...b);
  }
  if (a.length < 4) return null;
  const groups = a.slice(0, 4).map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? g.replace(/^0+(?=.)/, "") : null));
  if (groups.includes(null)) return null;
  return groups.join(":") + "::/64";
}

export function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 金額の欄（仮押さえの額と枠）。usd・minUsd は米ドル。minUsd はいちばん小さな依頼の仮押さえ（言い切ってよいかの目安）。
export function moneyParams(env, usd, hold, { minUsd = 0, who } = {}) {
  const b = budgetConfig(env);
  return {
    usd: String(toMicro(usd)), hold, monthCap: String(b.monthCap), dayMax: String(b.dayMax), dayMin: String(b.dayMin),
    factor: String(b.factor), minUsd: String(toMicro(minUsd)), ...(who ? { who } : {}),
  };
}

// 点と金額をまとめて数える。
//   { ok: true, hold, holdUsd, remaining, usdLeft, raw } … 通す（hold は精算に使う。数えない環境では null）
//   { ok: false, kind: "day" | "month" | "busy" | "unavailable", scope }
//   busy … 大きな依頼だけが額の枠に入らない・その人の「精算されずに残った額」が上限を超えた（「混み合っています」）
export async function reserve(request, env, { points, usd, minUsd, extra }) {
  if (quotaOptional(request, env)) return { ok: true, hold: null, holdUsd: usd, remaining: null, usdLeft: null, raw: null };
  const limits = quotaLimits(env);
  const hold = randomId();
  const data = await askQuota(env, "/take", {
    cost: String(points), who: whoOf(request),
    perDay: String(limits.points.perUser), totalPerDay: String(limits.points.total),
    ...moneyParams(env, usd, hold, { minUsd }), ...(extra || {}),
  });
  if (!data) return { ok: false, kind: "unavailable" };
  if (!data.ok) {
    if (data.scope === "month") return { ok: false, kind: "month", scope: "month" };
    if (data.scope === "busy" || data.scope === "pending") return { ok: false, kind: "busy", scope: data.scope };
    // spent … その人の1日の使用額（精算した額）が上限を超えた。その人だけ「本日ぶん」
    if (data.scope === "total" || data.scope === "who" || data.scope === "day" || data.scope === "spent") return { ok: false, kind: "day", scope: data.scope };
    return { ok: false, kind: "unavailable" };
  }
  return { ok: true, hold, holdUsd: usd, remaining: Number(data.remaining), usdLeft: Number(data.usdLeft), raw: data };
}

// 精算。usd が null（実額が分からない）なら何もしない（仮押さえのまま残す）。失敗しても呼び出し元は止めない。
// exact が false（usage どおりでなく見積もり）なら、その額はその人の「精算されずに残った額」にも積まれる。
export async function settle(env, hold, usd, out, exact = true) {
  if (!hold || usd === null || usd === undefined || !Number.isFinite(Number(usd))) return;
  const params = { hold, usd: String(toMicro(usd)), exact: exact ? "1" : "0" };
  if (Number.isFinite(Number(out)) && out !== null && out !== undefined) params.out = String(Math.max(0, Math.floor(Number(out))));
  await askQuota(env, "/settle", params);
}

// jev（Workers AI）を呼ぶ窓口の回数。{ ok: true } か { ok: false, kind }。
export async function takeJev(request, env) {
  if (quotaOptional(request, env)) return { ok: true };
  const limits = jevLimits(env);
  const data = await askQuota(env, "/take", {
    pool: "jev", cost: "1", who: whoOf(request), perDay: String(limits.perUser), totalPerDay: String(limits.total),
  });
  if (!data) return { ok: false, kind: "unavailable" };
  if (!data.ok) return { ok: false, kind: "day" };
  return { ok: true };
}

// 断るときの返事（読み取り・仕上げなど、チャット以外）。画面は ai_quota_exceeded の message をそのまま出す。
export function refusal(json, result) {
  if (result.kind === "month") {
    return json({ error: "ai_quota_exceeded", scope: "month", limit: "month", message: MONTH_LIMIT_MESSAGE }, 429);
  }
  if (result.kind === "day") {
    return json({ error: "ai_quota_exceeded", scope: result.scope || "day", limit: "day", message: dayLimitMessage() }, 429);
  }
  return json({ error: "ai_quota_unavailable", message: BUSY_MESSAGE }, 503);
}

// ── 流れてくる答え（SSE）から usage を拾う ─────────────────────────────
//
// 答えは読み解かずに画面へ流す（Worker の CPU 時間の上限のため）。ここでも全部を JSON として読まず、
// message_start（入力の量・モデル）と message_delta（出力の量。累計）の行だけを探して読む。
// 安全側の判定で別のモデルにやり直したときは message_start が2度来うるので、区切りごとに足す。
// 終わったら onDone({ done, segments, elapsedMs }) を呼ぶ。done は「最後まで流れ、どの区切りにも
// message_delta があった」とき。途中で切れた（利用者が閉じた・上流の流れが途切れた・上流がエラーの出来事を
// 返した）ときは done: false で、呼び出し側が streamCharge で見積もって精算する。
// 利用者が閉じたあとの精算は waitUntil で走らせる（応答が終わっても Worker が精算を待つように）。
const EVENT_RE = /"type"\s*:\s*"message_(start|delta)"/g;
const MAX_CARRY = 256 * 1024;
export function meterStream(body, onDone, { waitUntil } = {}) {
  const decoder = new TextDecoder();
  let carry = "";
  const segments = [];
  const readLine = (line) => {
    const at = line.indexOf("data:");
    if (at !== 0) return;
    let obj;
    try { obj = JSON.parse(line.slice(5)); } catch (e) { return; }
    if (!obj || typeof obj !== "object") return;
    if (obj.type === "message_start" && obj.message) {
      const u = obj.message.usage || null;
      segments.push({
        model: String(obj.message.model || ""),
        input: u ? Number(u.input_tokens) || 0 : 0,
        cacheWrite: u ? Number(u.cache_creation_input_tokens) || 0 : 0,
        cacheRead: u ? Number(u.cache_read_input_tokens) || 0 : 0,
        output: u ? Number(u.output_tokens) || 0 : 0,
        known: Boolean(u), done: false,
      });
    } else if (obj.type === "message_delta" && segments.length) {
      const seg = segments[segments.length - 1];
      const u = obj.usage;
      if (u && typeof u === "object") {
        if (Number.isFinite(Number(u.output_tokens))) seg.output = Math.max(seg.output, Number(u.output_tokens));
        if (Number.isFinite(Number(u.input_tokens))) seg.input = Math.max(seg.input, Number(u.input_tokens));
        if (Number.isFinite(Number(u.cache_creation_input_tokens))) seg.cacheWrite = Math.max(seg.cacheWrite, Number(u.cache_creation_input_tokens));
        if (Number.isFinite(Number(u.cache_read_input_tokens))) seg.cacheRead = Math.max(seg.cacheRead, Number(u.cache_read_input_tokens));
        seg.done = true;
      }
    }
  };
  const scan = (text) => {
    const cut = text.lastIndexOf("\n");
    if (cut < 0) { carry = text.length > MAX_CARRY ? "" : text; return; }
    const lines = text.slice(0, cut);
    carry = text.slice(cut + 1);
    if (carry.length > MAX_CARRY) carry = "";
    EVENT_RE.lastIndex = 0;
    let m, lastEnd = -1;
    while ((m = EVENT_RE.exec(lines))) {
      const start = lines.lastIndexOf("\n", m.index) + 1;
      if (start <= lastEnd) continue;
      let end = lines.indexOf("\n", m.index);
      if (end < 0) end = lines.length;
      lastEnd = end;
      readLine(lines.slice(start, end).replace(/\r$/, ""));
    }
  };
  const reader = body.getReader();
  const startedAt = Date.now();
  let finished = null;
  const finish = (cut) => {
    if (finished) return finished;
    try { scan(carry + decoder.decode() + "\n"); } catch (e) { /* 数えられなくても止めない */ }
    const done = !cut && segments.length > 0 && segments.every((s) => s.known && s.done);
    finished = Promise.resolve().then(() => onDone({ done, segments, elapsedMs: Date.now() - startedAt }))
      .catch(() => { /* 精算の失敗で答えを止めない */ });
    if (waitUntil) { try { waitUntil(finished); } catch (e) { /* 無ければ待つだけ */ } }
    return finished;
  };
  return new ReadableStream({
    async pull(controller) {
      let r;
      try {
        r = await reader.read();
      } catch (e) {
        await finish(true);
        controller.error(e);
        return;
      }
      if (r.done) {
        await finish(false);
        controller.close();
        return;
      }
      controller.enqueue(r.value);
      try { scan(carry + decoder.decode(r.value, { stream: true })); } catch (e) { /* 同上 */ }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch (e) { /* 上流がもう閉じている */ }
      await finish(true);
    },
  });
}

// 流れてくる答えの実額。最後まで流れたら usage どおり（exact）。途中で切れたら見積もり（exact: false）:
//   入力 … message_start の usage が取れていればその実数、取れていなければ見積もり（inputTokens）
//   出力 … max(届いた usage の出力, min(出力の上限, 経過秒数 × 300 + 1,000))（worker/ai-price.mjs の
//          interruptedOutputTokens。厳密な保証ではなく、Opus の生成の速さの3倍以上の余裕を見た上限）
export function streamCharge({ requested, done, segments, elapsedMs, maxOutputTokens, inputTokens }) {
  let usd = 0, out = 0;
  if (done) {
    for (const s of segments) {
      usd += anthropicUsageUsd({ requested, model: s.model, input: s.input, cacheWrite: s.cacheWrite, cacheRead: s.cacheRead, output: s.output });
      out += s.output;
    }
    return { usd, out, exact: true };
  }
  const known = segments.filter((s) => s.known);
  if (known.length) {
    for (const s of known) {
      usd += anthropicUsageUsd({ requested, model: s.model, input: s.input, cacheWrite: s.cacheWrite, cacheRead: s.cacheRead, output: 0 });
    }
  } else {
    usd += inputHoldUsd({ model: requested, inputTokens });
  }
  const reported = segments.reduce((n, s) => n + (Number(s.output) || 0), 0);
  out = Math.max(reported, interruptedOutputTokens(maxOutputTokens, elapsedMs));
  const models = segments.map((s) => s.model).filter(Boolean);
  const perOut = Math.max(...[requested].concat(models).map((m) => priceOf(m).out));
  usd += out * perOut / 1e6;
  return { usd, out, exact: false };
}
