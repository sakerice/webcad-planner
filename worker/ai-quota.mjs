// AI の使用回数を数えて、上限を超えたら断る（Durable Object）。
//
// なぜ在るのか
// ------------
// /api/ai/import-plan には認証も回数制限も無かった。URLを知っていれば誰でも
// 呼べ、1回 ¥11〜30 がそのまま請求される。図面1枚ごとに1回 AI を呼ぶので、
// 8ページのPDFなら1リクエストで8回ぶんになる。
//
// 数えるのは **リクエストの数ではなく AI を呼ぶ回数**。そこが費用に直結する。
//
// 2つの上限を持つ。
//
//   全体   … 1日に使える総数。**財布の上限**。ここが最後の砦
//   1人あたり … 1日に1つの接続元が使える数。1人が全部使い切るのを防ぐ
//
// 「1人」は接続元のIPアドレスで見ている。利用者の口座の仕組みがまだ無いため。
// 定額サブスクと使用回数制限を入れるときは、ここを口座ごとの数え方に替える。
//
// 日付は UTC で切っている。日本時間の朝9時に戻る。断るときの文（worker/ai-budget.mjs の dayLimitMessage）は
// この時刻に合わせて「朝9時から再開」と書く。
//
// 3つめの上限が、月の金額の枠（米ドル換算。2026-11 に足した）。点は1回の費用の重さを表しきれないので、
// 呼ぶ前に最悪の額を仮押さえし、返事の usage で精算する（/take の金額の欄と /settle。単価は worker/ai-price.mjs）。
// 月の枠と、1日で月の枠を使い切られないための1日の額の上限を持つ。月は日本時間の暦月で切る。
// jev（Workers AI）の窓口の1日の回数も、同じインスタンスの別の鍵（jev-total・jev-who）で数える。
//
// 2つめの操作（/ticket）は、チャットの「依頼の札」ごとに、往復の数・送った本文の合計・会話のつながり
// （前の messages に足しただけか）を確かめて数える（worker/chat.mjs）。札の記録はチャットの最初の
// 呼び出しで、/take に札の欄を足して作る。札は署名つきで画面が持ち回るので、何回使ったかは
// 札の中ではなくここで数える。
//
// 同じクラスを、別の名前のインスタンスで別の物を数えるのにも使う（数は名前ごとに別々に持つ）。
//   idFromName("ai-usage")     AI の点（読み取り・チャット）
//   idFromName("room-create")  外の AI（/api/mcp の create_plan）が作るルームの数。/take を cost=1 で呼ぶ
//                              （worker/mcp.mjs。画面からの POST /api/rooms は数えない）

// 1日の上限。**回数ではなく「点」で数える**（点の重さは worker/routes-ai.mjs の COST_* と
// worker/chat.mjs の AI_CHAT_POINTS）。
// 「1回の取り込み」の目安。3ページのPDFで 3×(1+10+10) = 63点。
// 読み取りとチャットが同じ枠を使う。
//
// 既定は点で持つ（2026-11-20 に少し緩めた。月の金額の枠が砦になる前提）:
//   全体 700点（チャット 21点で約33依頼）・1人 168点（チャット8依頼）
// 本番の環境変数 AI_DAILY_IMPORTS_TOTAL / AI_DAILY_IMPORTS_PER_USER（回数。1回=63点）が入っていれば、そちらが勝つ。
export const POINTS_PER_IMPORT = 63;
const DEFAULT_POINTS_TOTAL = 700;
const DEFAULT_POINTS_PER_USER = 168;

function pointsFrom(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n * POINTS_PER_IMPORT)) : fallback;
}

export function quotaLimits(env) {
  const perUser = pointsFrom(env && env.AI_DAILY_IMPORTS_PER_USER, DEFAULT_POINTS_PER_USER);
  const total = pointsFrom(env && env.AI_DAILY_IMPORTS_TOTAL, DEFAULT_POINTS_TOTAL);
  return {
    // 回数（画面に出す「本日あと何回」の単位）。端数は切り捨てる。
    imports: { perUser: Math.floor(perUser / POINTS_PER_IMPORT), total: Math.floor(total / POINTS_PER_IMPORT) },
    points: { perUser, total },
  };
}

// jev（Workers AI）を呼ぶ窓口の1日の回数。AI の点とは別の数で持つ（同じ Durable Object・別の鍵）。
// 1回の読み取りで仕上げ（/api/ai/finish-plan）は多くて2回呼ばれる（部屋と設備で1回、図面の印で1回）。
//   1人 30回（読み取り 15回ぶん）・全体 300回
// 環境変数 AI_JEV_DAILY_PER_USER / AI_JEV_DAILY_TOTAL で変えられる。
export function jevLimits(env) {
  const n = (v, d) => { const x = Math.round(Number(v)); return x >= 1 ? x : d; };
  return { perUser: n(env && env.AI_JEV_DAILY_PER_USER, 30), total: n(env && env.AI_JEV_DAILY_TOTAL, 300) };
}

// ── 金額の枠（米ドルを 100 万分の 1 にした整数で持つ） ─────────────────
//
// 鍵:
//   usd-month:<日本時間の年月>            その月の使用額（仮押さえ中の分を含む）
//   usd-day:<UTCの日付>:<日本時間の年月>   その日の使用額。日の区切りは点と同じ UTC（日本時間の朝9時）
//   hold:<id>                            仮押さえ。精算で消える。精算されなければ額はそのまま残る（安全側）
//   pend:<UTCの日付>:<人>                 その人の、その日の「精算されずに残った額」（見積もりで精算した額と、
//                                        精算されないまま期限の過ぎた仮押さえ）。1日の額の上限の 1/3 を超えると、その人だけ断る
// 月の区切りは日本時間の暦月（来月1日の0時に戻る）。
const MONTH_PREFIX = "usd-month:";
const DAY_PREFIX = "usd-day:";
const HOLD_PREFIX = "hold:";
const PEND_PREFIX = "pend:";
const DEFAULT_DAY_MIN = 4000000;   // 1日の額の上限の下限 $4（worker/ai-price.mjs の DEFAULT_DAILY_BUDGET_MIN_USD）
const HOLD_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
// 精算されない仮押さえの記録を消すまでの時間。消しても額は戻さない（使われたものとして残す）。
const HOLD_TTL_MS = 2 * 60 * 60 * 1000;
// 1回の続きの往復に許す出力の最小。これより少ししか残っていなければ、往復を断る。
const MIN_OUTPUT_GRANT = 1024;
const JST_MS = 9 * 60 * 60 * 1000;

export function jstMonth(now) { return new Date(now + JST_MS).toISOString().slice(0, 7); }
export function utcDay(now) { return new Date(now).toISOString().slice(0, 10); }
// UTC の日（日本時間の朝9時に始まる日）を含めた、その月（日本時間の年月 month）の残りの日数。
// 日本時間の月初め 0〜9 時は、UTC の日付がまだ前の月の最後の日なので、新しい月の日数をそのまま使う。
function daysLeftInMonth(day, month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (day.slice(0, 7) !== month) return last;
  return Math.max(1, last - Number(day.slice(8, 10)) + 1);
}

function intParam(p, name) {
  const v = p.get(name);
  if (v === null || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// 金額の欄（usd・hold・monthCap・dayMax・dayMin・factor・minUsd・who）を読む。無ければ null（金額は数えない呼び出し）。
// 形が違えば { bad: true }。minUsd はいちばん小さな依頼の仮押さえの額で、「今月ぶん」「本日ぶん」と言い切ってよいかに使う。
function readMoneyParams(url) {
  const p = url.searchParams;
  if (!p.has("monthCap")) return null;
  const monthCap = intParam(p, "monthCap");
  const dayMax = intParam(p, "dayMax");
  const dayMinRaw = intParam(p, "dayMin");
  const factor = Number(p.get("factor")) || 2;
  const usd = intParam(p, "usd") || 0;
  const minUsd = intParam(p, "minUsd") || 0;
  const hold = p.get("hold") || "";
  const who = p.get("who") || "unknown";
  if (monthCap === null || dayMax === null || (usd > 0 && !HOLD_ID_RE.test(hold))) return { bad: true };
  return { monthCap, dayMax, dayMin: dayMinRaw === null ? DEFAULT_DAY_MIN : dayMinRaw, factor, usd, minUsd, hold, who };
}

// 額が足りないときの断り方。いちばん小さな依頼も入らないときだけ「今月ぶん」「本日ぶん」と言い切る。
// 大きな依頼だけが入らないときは「混み合っています」（busy）にする（小さな依頼は通るので、言い切ると嘘になる）。
function shortScope(left, money, scope) {
  return left < money.minUsd ? scope : "busy";
}

// 札の記録の鍵。forgetOldDays（日付で古い数を捨てる）はこの前置きの鍵に触らない。
const TICKET_PREFIX = "chat-ticket:";
const TICKET_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const TICKET_GRACE_MS = 60 * 1000;

// 札の欄（id・期限・今回の messages の件数・全体の SHA-256・本文のバイト数）を読む。形が違えば null。
function readTicketParams(url) {
  const p = url.searchParams;
  const id = p.get("ticket") || p.get("id") || "";
  const exp = Number(p.get("exp"));
  const count = Math.floor(Number(p.get("count")));
  const hash = p.get("hash") || "";
  const bytes = Number(p.get("bytes"));
  if (!TICKET_ID_RE.test(id) || !Number.isFinite(exp) || !(count >= 1) || !HASH_RE.test(hash)
    || !Number.isFinite(bytes) || bytes < 0) return null;
  return { id, exp, count, hash, bytes };
}

export class AiQuota {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // 要求を1つずつ順に処理する。読んでから書くまでの間に別の要求が割り込むと、上限を超えて通しうる
    // （Durable Object の入力の門でも守られるが、検査の偽の storage でも同じに動くよう、ここでも並べる）。
    this.chain = Promise.resolve();
  }

  fetch(request) {
    const run = this.chain.then(() => this.handle(request));
    this.chain = run.catch(() => {});
    return run;
  }

  // /take   … 点（と、金額の欄があれば金額の仮押さえ）を数える。{ ok, remaining, limit, scope }。ok が false なら断る
  //            scope: total・who（1日の点）／month（月の額）／day（1日の額）
  // /ticket … チャットの続きの往復を数える（下の countTicket）
  // /settle … 仮押さえを実額で精算する（下の settle）
  async handle(request) {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === "/ticket") return this.countTicket(url, now);
    if (url.pathname === "/settle") return this.settle(url);
    // jev の窓口の回数は、AI の点とは別の鍵で数える（鍵の2つめが日付なので、古い日の掃除は同じ仕組みで済む）。
    const pool = url.searchParams.get("pool") === "jev" ? "jev-" : "";
    const cost = Math.max(1, Math.min(64, Number(url.searchParams.get("cost")) || 1));
    const who = url.searchParams.get("who") || "unknown";
    const perDay = Math.max(1, Number(url.searchParams.get("perDay")) || 0);
    const totalPerDay = Math.max(1, Number(url.searchParams.get("totalPerDay")) || 0);
    // peek のときは数えずに残りだけ返す。画面に「本日あと何回」を出すため。
    const peek = url.searchParams.get("peek") === "1";
    const day = utcDay(now);
    const money = pool ? null : readMoneyParams(url);
    if (money && money.bad) return this.reply({ ok: false, error: "bad_money" }, 400);

    const totalKey = `${pool}total:${day}`;
    const whoKey = `${pool}who:${day}:${who}`;
    const used = await this.state.storage.get([totalKey, whoKey]);
    const total = Number(used.get(totalKey) || 0);
    const mine = Number(used.get(whoKey) || 0);
    const budget = money ? await this.readBudget(now, money) : null;

    const leftTotal = Math.max(0, totalPerDay - total);
    const leftMine = Math.max(0, perDay - mine);
    if (peek) {
      return this.reply({ ok: leftTotal > 0 && leftMine > 0, scope: "peek",
        limit: perDay, remaining: Math.min(leftMine, leftTotal),
        totalLimit: totalPerDay, totalRemaining: leftTotal,
        ...(budget ? { monthLeft: budget.monthLeft, dayLeft: budget.dayLeft } : {}) });
    }
    // 月の枠を先に見る。月が尽きているのに「明日また」と言わないため。
    if (budget && money.usd > budget.monthLeft) return this.reply({ ok: false, scope: shortScope(budget.monthLeft, money, "month") });
    if (total + cost > totalPerDay) {
      return this.reply({ ok: false, scope: "total", limit: totalPerDay, remaining: leftTotal });
    }
    if (mine + cost > perDay) {
      return this.reply({ ok: false, scope: "who", limit: perDay, remaining: leftMine });
    }
    if (budget && budget.pend > budget.pendCap) return this.reply({ ok: false, scope: "pending" });
    if (budget && money.usd > budget.dayLeft) return this.reply({ ok: false, scope: shortScope(budget.dayLeft, money, "day") });

    // チャットの最初の呼び出しは、点を使うのと同じ書き込みで札の記録を作る（Durable Object への
    // 問い合わせを1回にし、点だけ使って札の記録が無い、という途中の状態を作らない）。
    const ticket = readTicketParams(url);
    if (url.searchParams.has("ticket") && !ticket) return this.reply({ ok: false, error: "bad_ticket" }, 400);
    const writes = { [totalKey]: total + cost, [whoKey]: mine + cost };
    let grant = 0;
    if (ticket) {
      // 札ごとの出力の合計（out）。最初の往復の出力の上限を、ここで札に積む。
      const outCap = intParam(url.searchParams, "outCap");
      const want = intParam(url.searchParams, "want");
      grant = outCap === null || want === null ? 0 : Math.min(want, outCap);
      writes[TICKET_PREFIX + ticket.id] = { n: 1, exp: ticket.exp, count: ticket.count, hash: ticket.hash, bytes: ticket.bytes, out: grant };
    }
    if (budget && money.usd > 0) {
      Object.assign(writes, this.holdWrites(budget, money, now, ticket ? { ticket: ticket.id, out: grant } : null));
    }
    await this.state.storage.put(writes);
    if (!total && !pool) await this.forgetOld(now);
    if (ticket) await this.forgetOldTickets(now);
    return this.reply({ ok: true, scope: "who", limit: perDay, remaining: perDay - mine - cost,
      ...(budget ? { usdLeft: Math.max(0, Math.min(budget.monthLeft, budget.dayLeft) - money.usd) } : {}),
      ...(ticket ? { grant } : {}) });
  }

  // 今月・今日の使用額と、残り（米ドルの 100 万分の 1）。
  async readBudget(now, money) {
    const month = jstMonth(now);
    const day = utcDay(now);
    const monthKey = MONTH_PREFIX + month;
    const dayKey = `${DAY_PREFIX}${day}:${month}`;
    const pendKey = `${PEND_PREFIX}${day}:${money.who}`;
    const got = await this.state.storage.get([monthKey, dayKey, pendKey]);
    const monthUsed = Number(got.get(monthKey) || 0);
    const dayUsed = Number(got.get(dayKey) || 0);
    // 1日の額の上限は、その日の始まりの時点の月の残りから決める（その日のうちに上限が動かないように）。
    // 下限（既定 $4）を付けるが、その日の始まりの月の残りは超えない。
    const atDayStart = Math.max(0, money.monthCap - (monthUsed - dayUsed));
    const byPace = Math.min(money.dayMax, Math.floor(money.factor * atDayStart / daysLeftInMonth(day, month)));
    const dayCap = Math.min(atDayStart, Math.max(money.dayMin, byPace));
    return {
      month, day, monthKey, dayKey, pendKey, monthUsed, dayUsed, dayCap,
      monthLeft: Math.max(0, money.monthCap - monthUsed),
      dayLeft: Math.max(0, dayCap - dayUsed),
      pend: Number(got.get(pendKey) || 0),
      pendCap: Math.floor(dayCap / 3),
    };
  }

  holdWrites(budget, money, now, extra) {
    return {
      [budget.monthKey]: budget.monthUsed + money.usd,
      [budget.dayKey]: budget.dayUsed + money.usd,
      [HOLD_PREFIX + money.hold]: { usd: money.usd, month: budget.month, day: budget.day, who: money.who,
        exp: now + HOLD_TTL_MS, ...(extra || {}) },
    };
  }

  // 仮押さえを実額で精算する。?hold=<id>&usd=<額>&exact=<1|0>（&out=<この往復の実際の出力トークン>）
  // 実額が小さければ差を戻し、大きければ足す。仮押さえの記録が無ければ（消えた・二度目）何もしない。
  // exact=0（usage どおりではなく見積もりで精算した）のときは、その額をその人の「精算されずに残った額」に積む。
  async settle(url) {
    const p = url.searchParams;
    const id = p.get("hold") || "";
    const usd = intParam(p, "usd");
    if (!HOLD_ID_RE.test(id) || usd === null) return this.reply({ ok: false, error: "bad_settle" }, 400);
    const holdKey = HOLD_PREFIX + id;
    const rec = await this.state.storage.get(holdKey);
    if (!rec) return this.reply({ ok: false, reason: "unknown" });
    const monthKey = MONTH_PREFIX + rec.month;
    const dayKey = `${DAY_PREFIX}${rec.day}:${rec.month}`;
    const keys = [monthKey, dayKey];
    const ticketKey = rec.ticket ? TICKET_PREFIX + rec.ticket : null;
    if (ticketKey) keys.push(ticketKey);
    const exact = p.get("exact") !== "0";
    const pendKey = !exact && rec.who ? `${PEND_PREFIX}${rec.day}:${rec.who}` : null;
    if (pendKey) keys.push(pendKey);
    const got = await this.state.storage.get(keys);
    const delta = usd - Number(rec.usd || 0);
    const writes = {};
    if (got.has(monthKey)) writes[monthKey] = Math.max(0, Number(got.get(monthKey)) + delta);
    if (got.has(dayKey)) writes[dayKey] = Math.max(0, Number(got.get(dayKey)) + delta);
    if (pendKey && usd > 0) writes[pendKey] = Number(got.get(pendKey) || 0) + usd;
    const out = intParam(p, "out");
    const t = ticketKey ? got.get(ticketKey) : null;
    if (t && out !== null) writes[ticketKey] = { ...t, out: Math.max(0, Number(t.out || 0) - Number(rec.out || 0) + out) };
    if (Object.keys(writes).length) await this.state.storage.put(writes);
    await this.state.storage.delete(holdKey);
    return this.reply({ ok: true });
  }

  // 古い日の数・古い月の額・期限の過ぎた仮押さえを捨てる。放っておくと日付ぶんだけ増え続ける。
  //
  // **目覚まし(setAlarm)は使わない。** 1日の最初の1回だけ、その場で捨てる。
  // 掃除のために毎回書き込みを増やすと、この1つの Durable Object に全員の
  // 要求が集まっているぶん、詰まりやすくなる。
  //
  // 運営者が使用額を確かめられるよう、前の日の額と今月の額を Worker のログに1行出す（外から見える窓口は作らない）。
  // ログの形: {"ai_usage":{"day":"2026-11-19","day_usd":1.23,"month":"2026-11","month_usd":20.5}}
  // day は UTC の日付（日本時間の朝9時から翌朝9時）、month は日本時間の年月。仮押さえ中の分を含む。
  async forgetOld(now) {
    const today = utcDay(now);
    const yesterday = utcDay(now - 24 * 60 * 60 * 1000);
    const keepDays = new Set([today, yesterday]);
    const month = jstMonth(now);
    const keepMonths = new Set([month, jstMonth(now - 32 * 24 * 60 * 60 * 1000)]);
    const all = await this.state.storage.list();
    const stale = [];
    let yesterdayUsd = 0;
    let monthUsd = 0;
    let money = false;
    const pendAdd = {};
    for (const [rawKey, value] of all) {
      const key = String(rawKey);
      if (key.startsWith(TICKET_PREFIX)) continue;
      if (key.startsWith(HOLD_PREFIX)) {
        if (!value || !(Number(value.exp) > now)) {
          stale.push(rawKey);
          // 精算されないまま期限が過ぎた仮押さえは、その人の「精算されずに残った額」に積む（額は戻さない）。
          if (value && value.who && keepDays.has(value.day)) {
            const k = `${PEND_PREFIX}${value.day}:${value.who}`;
            pendAdd[k] = (pendAdd[k] || 0) + (Number(value.usd) || 0);
          }
        }
        continue;
      }
      if (key.startsWith(MONTH_PREFIX)) {
        money = true;
        const m = key.slice(MONTH_PREFIX.length);
        if (m === month) monthUsd = Number(value) || 0;
        if (!keepMonths.has(m)) stale.push(rawKey);
        continue;
      }
      const parts = key.split(":");
      if (key.startsWith(DAY_PREFIX) && parts[1] === yesterday) yesterdayUsd += Number(value) || 0;
      const d = parts[1];
      if (d && !keepDays.has(d)) stale.push(rawKey);
    }
    if (stale.length) await this.state.storage.delete(stale);
    const pendKeys = Object.keys(pendAdd);
    if (pendKeys.length) {
      const got = await this.state.storage.get(pendKeys);
      const writes = {};
      for (const k of pendKeys) writes[k] = Number(got.get(k) || 0) + pendAdd[k];
      await this.state.storage.put(writes);
    }
    if (money) {
      console.log(JSON.stringify({ ai_usage: {
        day: yesterday, day_usd: +(yesterdayUsd / 1e6).toFixed(4),
        month, month_usd: +(monthUsd / 1e6).toFixed(4),
      } }));
    }
  }

  // 続きの呼び出しを1回数える。{ ok, n, left, grant } か { ok:false, reason }。
  //
  // 札の id ごとに、往復の回数 n・前回の messages の件数 count・前回の messages 全体の
  // SHA-256（hash）・Claude へ送った本文のバイト数の合計 bytes・出力の合計 out を持つ。
  //
  // 札を会話に結び付ける（1回ぶんの点で、別々の会話を何度もさせない）:
  //   - 札に書かれた件数（prevCount）が記録の count と同じであること（古い札の使い回しを断る）
  //   - 今回の件数が count より多く、今回の messages の先頭 count 件の SHA-256（prefix）が記録の hash と
  //     同じこと（前の会話に足しただけであること）
  //   - ただし件数も全体の SHA-256 も前回と同じ（同じ本文のやり直し）は通す。最初の呼び出しで Claude が
  //     失敗したとき、点を使い直さずにやり直せるようにするため（往復とバイト数は数える）
  // 出力の合計: 往復ごとに want（1回の出力の上限）を積み、精算で実際の出力に直す。合計が outCap に届くと断る。
  // 金額: 往復ごとに /take と同じく仮押さえする（月の枠・1日の額の枠で止まる）。
  // reason: unknown（記録が無い）・mismatch（会話が合わない）→ 画面へは ticket_invalid
  //         rounds（往復の上限）・bytes（本文の合計の上限）・output（出力の合計の上限）→ 画面へは rounds_exceeded
  //         month・day（金額の枠）→ 画面へは月・1日の上限の文
  // 上限を超えたときは数を増やさない（何度叩いても記録は変わらない）。
  async countTicket(url, now) {
    const t = readTicketParams(url);
    const prevCount = Math.floor(Number(url.searchParams.get("prevCount")));
    const prefix = url.searchParams.get("prefix") || "";
    const max = Math.max(1, Math.min(64, Math.floor(Number(url.searchParams.get("max")) || 0)));
    const maxBytes = Math.max(1, Number(url.searchParams.get("maxBytes")) || 0);
    const money = readMoneyParams(url);
    if (!t || !Number.isFinite(prevCount) || !HASH_RE.test(prefix) || (money && money.bad)) {
      return this.reply({ ok: false, error: "bad_ticket" }, 400);
    }
    const key = TICKET_PREFIX + t.id;
    const rec = await this.state.storage.get(key);
    if (!rec || !(Number(rec.exp) + TICKET_GRACE_MS > now)) return this.reply({ ok: false, reason: "unknown" });
    const same = t.count === rec.count && t.hash === rec.hash;
    if (prevCount !== rec.count) return this.reply({ ok: false, reason: "mismatch" });
    if (!same && (t.count <= rec.count || prefix !== rec.hash)) return this.reply({ ok: false, reason: "mismatch" });
    const used = Number(rec.n) || 1;
    if (used >= max) return this.reply({ ok: false, reason: "rounds", n: used, left: 0 });
    const bytes = (Number(rec.bytes) || 0) + t.bytes;
    if (bytes > maxBytes) return this.reply({ ok: false, reason: "bytes", n: used, left: max - used });
    const outCap = intParam(url.searchParams, "outCap");
    const want = intParam(url.searchParams, "want");
    const outUsed = Number(rec.out) || 0;
    let grant = 0;
    if (outCap !== null && want !== null) {
      grant = Math.min(want, outCap - outUsed);
      if (grant < Math.min(want, MIN_OUTPUT_GRANT)) return this.reply({ ok: false, reason: "output", n: used, left: max - used });
    }
    const budget = money ? await this.readBudget(now, money) : null;
    if (budget && money.usd > budget.monthLeft) return this.reply({ ok: false, reason: shortScope(budget.monthLeft, money, "month") });
    if (budget && budget.pend > budget.pendCap) return this.reply({ ok: false, reason: "pending" });
    if (budget && money.usd > budget.dayLeft) return this.reply({ ok: false, reason: shortScope(budget.dayLeft, money, "day") });
    const n = used + 1;
    const writes = { [key]: { n, exp: rec.exp, count: t.count, hash: t.hash, bytes, out: outUsed + grant } };
    if (budget && money.usd > 0) Object.assign(writes, this.holdWrites(budget, money, now, { ticket: t.id, out: grant }));
    await this.state.storage.put(writes);
    return this.reply({ ok: true, n, left: max - n, grant });
  }

  // 期限の過ぎた札の記録を消す。期限ちょうどに消すと、期限の直前に確かめた呼び出しが
  // 記録を引けなくなるので、期限の 60 秒後から消す。
  // 新しい札の記録を作るとき（チャットの最初の呼び出し）だけ走らせる。札は10分で切れるので、
  // 残るのはここ10分ほどに使われた札だけで、一覧を読む量は小さい。
  async forgetOldTickets(now) {
    const all = await this.state.storage.list({ prefix: TICKET_PREFIX });
    const stale = [];
    for (const [key, value] of all) {
      if (!value || !(Number(value.exp) + TICKET_GRACE_MS > now)) stale.push(key);
    }
    if (stale.length) await this.state.storage.delete(stale);
  }

  reply(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
}
