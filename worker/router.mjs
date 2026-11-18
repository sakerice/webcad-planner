// 入ってきた要求をどこへ渡すかだけを決める層。
//
// /api/ 以外は静的ファイル(dist/)をそのまま返す。/api/ は用途ごとの
// モジュールへ渡す。ここに処理そのものを書かない——書き始めると、また
// 1枚のファイルに全部が集まる。
import { json } from "./shared.mjs";
import { handlesRooms, handleRooms } from "./routes-rooms.mjs";
import { handlesAi, handleAi } from "./routes-ai.mjs";
import { handlesMcp, handleMcp } from "./mcp.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (handlesRooms(url.pathname)) return handleRooms(request, env, url);
    if (handlesAi(url.pathname)) return handleAi(request, env, url);
    // 外の AI(MCP)の受け口。/mcp でないのは run_worker_first が /api/* だけのため(worker/mcp.mjs の冒頭)。
    if (handlesMcp(url.pathname)) return handleMcp(request, env);
    return json({ error: "not_found" }, 404);
  },
};
