// Cloudflare Worker の入口。中身は worker/ に分けてある。
//
//   worker/router.mjs       /api/ の振り分け
//   worker/routes-rooms.mjs 共有ルームの HTTP
//   worker/collab-room.mjs  共有ルームの実体(Durable Object)
//   worker/routes-ai.mjs    AI の呼び出し(鍵を扱うのはここだけ)
//   worker/shared.mjs       共通の道具と上限値
//
// wrangler.toml の main はこのファイルを指しているので、Durable Object の
// クラスはここから出し続ける必要がある。
import router from "./worker/router.mjs";

export default router;
export { CollaborationRoom } from "./worker/collab-room.mjs";
export { AiQuota } from "./worker/ai-quota.mjs";
export { applyPatch } from "./worker/shared.mjs";
