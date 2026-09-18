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
export class AiQuota {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // { ok, remaining, limit, scope } を返す。ok が false なら断る。
  async fetch(request) {
    const url = new URL(request.url);
    const cost = Math.max(1, Math.min(64, Number(url.searchParams.get("cost")) || 1));
    const who = url.searchParams.get("who") || "unknown";
    const perDay = Math.max(1, Number(url.searchParams.get("perDay")) || 0);
    const totalPerDay = Math.max(1, Number(url.searchParams.get("totalPerDay")) || 0);
    const day = new Date().toISOString().slice(0, 10);

    const totalKey = `total:${day}`;
    const whoKey = `who:${day}:${who}`;
    const used = await this.state.storage.get([totalKey, whoKey]);
    const total = Number(used.get(totalKey) || 0);
    const mine = Number(used.get(whoKey) || 0);

    if (total + cost > totalPerDay) {
      return this.reply({ ok: false, scope: "total", limit: totalPerDay, remaining: Math.max(0, totalPerDay - total) });
    }
    if (mine + cost > perDay) {
      return this.reply({ ok: false, scope: "who", limit: perDay, remaining: Math.max(0, perDay - mine) });
    }

    await this.state.storage.put({ [totalKey]: total + cost, [whoKey]: mine + cost });
    // 数えた日ぶんは 2 日で捨てる。古い日の数は誰も見ない。
    await this.state.storage.setAlarm(Date.now() + 2 * 24 * 60 * 60 * 1000);
    return this.reply({ ok: true, scope: "who", limit: perDay, remaining: perDay - mine - cost });
  }

  // 古い日の数を捨てる。放っておくと日付ぶんだけ増え続ける。
  async alarm() {
    const keep = new Set([0, 1].map((back) =>
      new Date(Date.now() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)));
    const all = await this.state.storage.list();
    for (const key of all.keys()) {
      const day = String(key).split(":")[1];
      if (day && !keep.has(day)) await this.state.storage.delete(key);
    }
  }

  reply(body) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}
