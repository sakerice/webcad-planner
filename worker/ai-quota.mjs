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
// 2つめの操作（/ticket）は、チャットの「依頼の札」ごとに、往復の数・送った本文の合計・会話のつながり
// （前の messages に足しただけか）を確かめて数える（worker/chat.mjs）。札の記録はチャットの最初の
// 呼び出しで、/take に札の欄を足して作る。札は署名つきで画面が持ち回るので、何回使ったかは
// 札の中ではなくここで数える。

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

    // チャットの最初の呼び出しは、点を使うのと同じ書き込みで札の記録を作る（Durable Object への
    // 問い合わせを1回にし、点だけ使って札の記録が無い、という途中の状態を作らない）。
    const ticket = readTicketParams(url);
    if (url.searchParams.has("ticket") && !ticket) return this.reply({ ok: false, error: "bad_ticket" }, 400);
    const writes = { [totalKey]: total + cost, [whoKey]: mine + cost };
    if (ticket) {
      writes[TICKET_PREFIX + ticket.id] = { n: 1, exp: ticket.exp, count: ticket.count, hash: ticket.hash, bytes: ticket.bytes };
    }
    await this.state.storage.put(writes);
    if (!total) await this.forgetOldDays(day);
    if (ticket) await this.forgetOldTickets(Date.now());
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

  // 続きの呼び出しを1回数える。{ ok, n, left } か { ok:false, reason }。
  //
  // 札の id ごとに、往復の回数 n・前回の messages の件数 count・前回の messages 全体の
  // SHA-256（hash）・Claude へ送った本文のバイト数の合計 bytes を持つ。
  //
  // 札を会話に結び付ける（1回ぶんの点で、別々の会話を何度もさせない）:
  //   - 札に書かれた件数（prevCount）が記録の count と同じであること（古い札の使い回しを断る）
  //   - 今回の件数が count より多く、今回の messages の先頭 count 件の SHA-256（prefix）が記録の hash と
  //     同じこと（前の会話に足しただけであること）
  //   - ただし件数も全体の SHA-256 も前回と同じ（同じ本文のやり直し）は通す。最初の呼び出しで Claude が
  //     失敗したとき、点を使い直さずにやり直せるようにするため（往復とバイト数は数える）
  // reason: unknown（記録が無い）・mismatch（会話が合わない）→ 画面へは ticket_invalid
  //         rounds（往復の上限）・bytes（本文の合計の上限）→ 画面へは rounds_exceeded
  // 上限を超えたときは数を増やさない（何度叩いても記録は変わらない）。
  async countTicket(url) {
    const t = readTicketParams(url);
    const prevCount = Math.floor(Number(url.searchParams.get("prevCount")));
    const prefix = url.searchParams.get("prefix") || "";
    const max = Math.max(1, Math.min(64, Math.floor(Number(url.searchParams.get("max")) || 0)));
    const maxBytes = Math.max(1, Number(url.searchParams.get("maxBytes")) || 0);
    if (!t || !Number.isFinite(prevCount) || !HASH_RE.test(prefix)) {
      return this.reply({ ok: false, error: "bad_ticket" }, 400);
    }
    const key = TICKET_PREFIX + t.id;
    const rec = await this.state.storage.get(key);
    if (!rec || !(Number(rec.exp) + TICKET_GRACE_MS > Date.now())) return this.reply({ ok: false, reason: "unknown" });
    const same = t.count === rec.count && t.hash === rec.hash;
    if (prevCount !== rec.count) return this.reply({ ok: false, reason: "mismatch" });
    if (!same && (t.count <= rec.count || prefix !== rec.hash)) return this.reply({ ok: false, reason: "mismatch" });
    const used = Number(rec.n) || 1;
    if (used >= max) return this.reply({ ok: false, reason: "rounds", n: used, left: 0 });
    const bytes = (Number(rec.bytes) || 0) + t.bytes;
    if (bytes > maxBytes) return this.reply({ ok: false, reason: "bytes", n: used, left: max - used });
    const n = used + 1;
    await this.state.storage.put(key, { n, exp: rec.exp, count: t.count, hash: t.hash, bytes });
    return this.reply({ ok: true, n, left: max - n });
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
