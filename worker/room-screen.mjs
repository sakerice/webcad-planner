// 共同編集のルームへの要求が「画面から」かどうかを見る。
//
// なぜ在るのか
// ------------
// 利用者が共有のダイアログで「外部の AI からの変更を受け付ける」を切にしても、止まるのは外の AI の受け口
// (/api/mcp → ルームの /op)だけだった。ルームの URL を知った外の AI や道具が /api/rooms/:id/update を
// 素の HTTP で呼べば書き換えられ、/api/rooms/:id/ai-edits を呼べばスイッチを入に戻せた。
// ルームは、止めている間の書き込みと、スイッチの切り替えを、画面からの要求だけに絞る(worker/collab-room.mjs)。
//
// 見分け方
// --------
// ブラウザは、同じ出どころへの POST にも Origin を付ける。Origin が付いていて、自分の出どころ・本番のホスト・
// アプリ版(capacitor://localhost)・手元の開発のホストのどれかなら「画面から」とみなす(worker/ai-budget.mjs の
// originAllowed と同じ一覧)。キャッシュに残った古い画面も、同じ出どころへの POST なので Origin が付く。
// 判定は外の受け口(worker/routes-rooms.mjs)で行い、印の見出し(SCREEN_HEADER)でルームへ伝える
// (ルームの側は URL が書き換わっていて出どころを比べられない)。外から同じ名前の見出しが付いてきても消してから付け直す。
//
// 守れる範囲
// ----------
// Origin はブラウザの外からなら好きに付けられる。止まるのは、Origin を付けずに素の HTTP で呼ぶ相手まで。
// 偽ってまで呼ぶ相手を止めるには、読む URL とは別の「書くための鍵」が要る(まだ決めていない)。
import { originAllowed } from "./ai-budget.mjs";

export const SCREEN_HEADER = "x-room-screen";

export function isFromScreen(request) {
  const origin = request && request.headers.get("origin");
  return origin !== null && origin !== undefined && origin !== "" && originAllowed(request);
}
