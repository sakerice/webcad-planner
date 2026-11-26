// 共同編集のルームへの書き込みを、ルームをまたいだ全体で数える。
//
// なぜ在るのか
// ------------
// 回数の上限はルームごとにしか無かった(外の AI の /op が 1ルーム 1日 600 回)。画面からの /update・/save と、
// 画面からのルームの作成(POST /api/rooms)は数えていなかった。ルームを次々に作れば、全体としては上限なしに書けた。
// Durable Object の無料枠は1日の書き込み 10 万行で、使い切ると、その日の共同編集と AI の機能がすべて止まる。
//
// 数の持ち主は、今ある AiQuota(worker/ai-quota.mjs)を別の名前のインスタンスで使う(新しいクラスも束縛も足さない)。
//   idFromName("room-writes")         画面からの書き込み(/update・/save・外部 AI のスイッチの切り替え)。接続元ごと・全体
//   idFromName("room-ops")            外の AI の操作(/op)で実際に積んだ数。全体だけ
//   idFromName("room-create-screen")  画面から作るルームの数。接続元ごと・全体
//   (外の AI が作るルームの数は、前からある "room-create"。worker/mcp.mjs)
// 画面の数と外の AI の数を別のインスタンスにしているのは、片方を使い切られても、もう片方が止まらないようにするため。
//
// 上限の値と根拠
// --------------
// 1回の書き込みで Durable Object に書く行は、差分1行・meta 1行・アラーム1行と、あとの書き戻しで差分を消す1行で、
// 均して約5行。数えるための行は、画面が 20 回に2行(下の「まとめ取り」)、外の AI が1回に2行。
//   画面    全体 10,000 回 → 約 5 万行      外の AI  全体 3,000 回 → 約 2.1 万行
//   作成    画面 600 個・外の AI 300 個 → 約 0.4 万行
// 合わせて約 7.5 万行で、残りの約 2.5 万行を AI の回数(ai-usage)と余裕に残す。
// ふつうの使い方で当たらないこと:
//   - 画面は、操作が止まって 0.5 秒後に1回送る(index.html の queueSharedSync)。5 秒に1回の編集を4時間続けて 2,880 回。
//     接続元ごとの 3,000 回はこれを超える。全体の 10,000 回は、その使い方の人が同じ日に3人いても残る。
//   - 外の AI は、白紙から1軒を作る会話で数十〜150 回ほど。3,000 回は 20 軒ぶん以上
//     (1日に外の AI が作れるルームは 300 個。全部が使われる日は先に当たるが、公開前の今は桁が違う)。
//   - 画面からの作成は「共同編集を始める」を押した数。接続元ごとに 60 個は、同じ回線を数十人で使う事務所でも当たりにくい。
// 利用が増えて当たるようになったら、ここの数を上げる(上げる前に、Durable Object の枠を有料にするかを決める)。
//
// まとめ取り(画面だけ)
// --------------------
// 画面の書き込みを1回ずつ数えると、書き込みのたびに数える側へ2行書くことになり、守りたい枠を自分で減らす。
// ルームは 20 回ぶんをまとめて取り、残りを meta.writeLease に持つ(meta はどのみち毎回書くので行は増えない)。
// 日付(UTC)が変わると残りは捨てる。使い切らなかった分は、その接続元の数から引かれたままになる
// (1日に触るルームが数個なら、捨てるのは多くて数十回)。
//
// 数えられないとき
// ----------------
//   - 束縛(env.AI_QUOTA)が無い … 数えずに通す(手元の検査。本番には束縛がある)
//   - 数える先が返らない・例外・形が違う … 画面は通す(共同編集を止めないほうを選ぶ)。外の AI は断る
//     (ルームの作成と同じ止める側。worker/mcp.mjs の takeRoomCreate)
import { askQuota, whoOf, originAllowed } from "./ai-budget.mjs";

export const ROOM_WRITES_TOTAL = 10000;
export const ROOM_WRITES_PER_USER = 3000;
export const ROOM_WRITE_LEASE = 20;
export const ROOM_OPS_TOTAL = 3000;
export const SCREEN_ROOM_CREATE_PER_USER = 60;
export const SCREEN_ROOM_CREATE_TOTAL = 600;

export const ROOM_WRITES_NAME = "room-writes";
export const ROOM_OPS_NAME = "room-ops";
export const SCREEN_ROOM_CREATE_NAME = "room-create-screen";

// ── 利用者・外の AI への文(開発の都合の数字は出さない) ─────────────────
// 1日の数は UTC の日付で切っているので、日本時間の朝9時に戻る(worker/ai-budget.mjs の dayLimitMessage と同じ言い方)。
function reopenAt(now) {
  const jstHour = new Date(now + 9 * 60 * 60 * 1000).getUTCHours();
  return jstHour < 9 ? "朝9時" : "明日の朝9時";
}
export function writeLimitMessage(now = Date.now()) {
  return `本日は共同編集への反映が混み合っているため、これ以上の変更を受け付けられません。${reopenAt(now)}から再開します。`
    + "いまのプランは「ファイルに保存」で手元に残せます。";
}
export function roomCreateLimitMessage(now = Date.now()) {
  return `本日は共同編集のルームをこれ以上作れません。${reopenAt(now)}から再開します。`;
}
export const MCP_OP_LIMIT_ALL_MESSAGE = "本日は AI からの変更が混み合っているため、これ以上直せません。あすまたお試しいただくか、house-planner の画面で直してください。";
export const MCP_OP_BUSY_MESSAGE = "いまは操作できませんでした。少し待ってからもう一度お試しください。";

// ── 画面からの要求か ──────────────────────────────────────────────
// ブラウザは、同じ出どころへの POST にも Origin を付ける。Origin が付いていて、自分の出どころ・本番のホスト・
// アプリ版・手元の開発のホストのどれかなら「画面から」とみなす(worker/ai-budget.mjs の originAllowed)。
// Origin はブラウザの外からなら好きに付けられるので、これで止まるのは、ルームの URL を知った外の AI や道具が
// 素の HTTP で呼ぶ場合まで(止めるスイッチを素通りさせないための最低限の線)。
export const SCREEN_HEADER = "x-room-screen";
export function isFromScreen(request) {
  const origin = request && request.headers.get("origin");
  return origin !== null && origin !== undefined && origin !== "" && originAllowed(request);
}

// ── 数える ────────────────────────────────────────────────────────
// 戻り値: "ok" | "exceeded" | "unavailable" | "uncounted"(束縛が無い)
export async function takeRoomQuota(env, name, { cost = 1, who = "all", perDay, totalPerDay }) {
  if (!env || !env.AI_QUOTA) return "uncounted";
  const data = await askQuota(env, "/take", {
    cost: String(cost), who, perDay: String(perDay), totalPerDay: String(totalPerDay),
  }, name);
  if (!data) return "unavailable";
  return data.ok ? "ok" : "exceeded";
}

// 画面からのルームの作成を1つ数える。
export function takeScreenRoomCreate(env, request) {
  return takeRoomQuota(env, SCREEN_ROOM_CREATE_NAME, {
    who: whoOf(request), perDay: SCREEN_ROOM_CREATE_PER_USER, totalPerDay: SCREEN_ROOM_CREATE_TOTAL,
  });
}

// 画面からの書き込みを 20 回ぶんまとめて取る。
export function takeScreenWriteLease(env, request) {
  return takeRoomQuota(env, ROOM_WRITES_NAME, {
    cost: ROOM_WRITE_LEASE, who: whoOf(request), perDay: ROOM_WRITES_PER_USER, totalPerDay: ROOM_WRITES_TOTAL,
  });
}

// 外の AI の操作を1つ数える。接続元ごとには分けない(Claude・ChatGPT 経由は全利用者が同じ接続元に見えるため。
// 分け方は決まっていない)。
export function takeMcpOpAll(env) {
  return takeRoomQuota(env, ROOM_OPS_NAME, { who: "all", perDay: ROOM_OPS_TOTAL, totalPerDay: ROOM_OPS_TOTAL });
}
