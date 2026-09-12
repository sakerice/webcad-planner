// 入ってきた要求をどこへ渡すかだけを決める層。
//
// /api/ 以外は静的ファイル(dist/)をそのまま返す。/api/ は用途ごとの
// モジュールへ渡す。ここに処理そのものを書かない——書き始めると、また
// 1枚のファイルに全部が集まる。
import { json } from "./shared.mjs";
import { handlesRooms, handleRooms } from "./routes-rooms.mjs";
import { handlesAi, handleAi } from "./routes-ai.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (handlesRooms(url.pathname)) return handleRooms(request, env, url);
    if (handlesAi(url.pathname)) return handleAi(request, env, url);
    return json({ error: "not_found" }, 404);
  },
};
