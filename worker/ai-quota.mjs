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
// 日付は UTC で切っている。日本時間の朝9時に戻る。利用者に見せる数字では
// ないので、ずれても実害はない。
//
// 2つめの操作（/ticket）は、チャットの「依頼の札」ごとの往復の数を数える（worker/chat.mjs）。
// 札は署名つきで画面が持ち回るので、何回使ったかは札の中ではなくここで数える。

// 1日の上限。**回数ではなく「点」で数える**（点の重さは worker/routes-ai.mjs の COST_* と
// worker/chat.mjs の AI_CHAT_POINTS）。
// 「1回の取り込み」の目安。3ページのPDFで 3×(1+10+10) = 63点。
// 上限は**回数で**設定する（点は内部の数え方で、設定する人が意識するものではない）。
// 読み取りとチャットが同じ枠を使う。
export const POINTS_PER_IMPORT = 63;
const DEFAULT_IMPORTS_TOTAL = 5;     // 全体。1日およそ ¥1,100
const DEFAULT_IMPORTS_PER_USER = 2;  // 1つの接続元

export function quotaLimits(env) {
  const perUser = Number((env && env.AI_DAILY_IMPORTS_PER_USER) || DEFAULT_IMPORTS_PER_USER);
  const total = Number((env && env.AI_DAILY_IMPORTS_TOTAL) || DEFAULT_IMPORTS_TOTAL);
  return {
    imports: { perUser, total },
    points: {
      perUser: Math.max(1, Math.round(perUser * POINTS_PER_IMPORT)),
      total: Math.max(1, Math.round(total * POINTS_PER_IMPORT)),
    },
  };
}

// 札の記録の鍵。forgetOldDays（日付で古い数を捨てる）はこの前置きの鍵に触らない。
const TICKET_PREFIX = "chat-ticket:";
const TICKET_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export class AiQuota {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // { ok, remaining, limit, scope } を返す。ok が false なら断る。
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ticket") return this.countTicket(url);
    const cost = Math.max(1, Math.min(64, Number(url.searchParams.get("cost")) || 1));
    const who = url.searchParams.get("who") || "unknown";
    const perDay = Math.max(1, Number(url.searchParams.get("perDay")) || 0);
    const totalPerDay = Math.max(1, Number(url.searchParams.get("totalPerDay")) || 0);
    // peek のときは数えずに残りだけ返す。画面に「本日あと何回」を出すため。
    const peek = url.searchParams.get("peek") === "1";
    const day = new Date().toISOString().slice(0, 10);

    const totalKey = `total:${day}`;
    const whoKey = `who:${day}:${who}`;
    const used = await this.state.storage.get([totalKey, whoKey]);
    const total = Number(used.get(totalKey) || 0);
    const mine = Number(used.get(whoKey) || 0);

    const leftTotal = Math.max(0, totalPerDay - total);
    const leftMine = Math.max(0, perDay - mine);
    if (peek) {
      return this.reply({ ok: leftTotal > 0 && leftMine > 0, scope: "peek",
        limit: perDay, remaining: Math.min(leftMine, leftTotal),
        totalLimit: totalPerDay, totalRemaining: leftTotal });
    }
    if (total + cost > totalPerDay) {
      return this.reply({ ok: false, scope: "total", limit: totalPerDay, remaining: leftTotal });
    }
    if (mine + cost > perDay) {
      return this.reply({ ok: false, scope: "who", limit: perDay, remaining: leftMine });
    }

    await this.state.storage.put({ [totalKey]: total + cost, [whoKey]: mine + cost });
    if (!total) await this.forgetOldDays(day);
    return this.reply({ ok: true, scope: "who", limit: perDay, remaining: perDay - mine - cost });
  }

  // 古い日の数を捨てる。放っておくと日付ぶんだけ増え続ける。
  //
  // **目覚まし(setAlarm)は使わない。** 1日の最初の1回だけ、その場で捨てる。
  // 掃除のために毎回書き込みを増やすと、この1つの Durable Object に全員の
  // 要求が集まっているぶん、詰まりやすくなる。
  async forgetOldDays(today) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const keep = new Set([today, yesterday]);
    const all = await this.state.storage.list();
    const stale = [];
    for (const key of all.keys()) {
      if (String(key).startsWith(TICKET_PREFIX)) continue;
      const day = String(key).split(":")[1];
      if (day && !keep.has(day)) stale.push(key);
    }
    if (stale.length) await this.state.storage.delete(stale);
  }

  // 札の id の使用回数を1つ増やして返す。{ ok, n, left }。ok が false なら往復の上限を超えた。
  //
  // 札を作った最初の呼び出しは、ここを通らずに数える（記録が無ければ「1回使った」とみなす）。
  // 最初の呼び出しのたびに Durable Object へもう1往復するのを避けるため。
  // max を超えたら増やさない（何度叩いても記録は max のまま）。
  // 新しい札の記録を作るときだけ、期限の過ぎた札の記録を消す。札は10分で切れるので、残るのは
  // ここ10分ほどに使われた札だけで、一覧を読む量は小さい。
  async countTicket(url) {
    const id = url.searchParams.get("id") || "";
    const exp = Number(url.searchParams.get("exp"));
    const max = Math.max(1, Math.min(64, Math.floor(Number(url.searchParams.get("max")) || 0)));
    if (!TICKET_ID_RE.test(id) || !Number.isFinite(exp)) {
      return this.reply({ ok: false, error: "bad_ticket" }, 400);
    }
    const key = TICKET_PREFIX + id;
    const seen = await this.state.storage.get(key);
    const used = seen && Number.isFinite(Number(seen.n)) ? Number(seen.n) : 1;
    if (used >= max) return this.reply({ ok: false, n: used, left: 0 });
    const n = used + 1;
    await this.state.storage.put(key, { n, exp });
    if (!seen) await this.forgetOldTickets(Date.now());
    return this.reply({ ok: true, n, left: max - n });
  }

  async forgetOldTickets(now) {
    const all = await this.state.storage.list({ prefix: TICKET_PREFIX });
    const stale = [];
    for (const [key, value] of all) {
      if (!value || !(Number(value.exp) > now)) stale.push(key);
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
