// 入ってきた要求をどこへ渡すかだけを決める層。
//
// /api/ 以外は静的ファイル(dist/)をそのまま返す。/api/ は用途ごとの
// モジュールへ渡す。ここに処理そのものを書かない——書き始めると、また
// 1枚のファイルに全部が集まる。
import { json } from "./shared.mjs";
import { handlesRooms, handleRooms } from "./routes-rooms.mjs";
import { handlesAi, handleAi } from "./routes-ai.mjs";
import { handlesMcp, handleMcp } from "./mcp.mjs";
import { handlesCspReport, handleCspReport } from "./csp-report.mjs";

// /api/ の応答に X-Content-Type-Options: nosniff を付ける。_headers の見出しは静的アセットにしか付かず、
// Worker が返す応答には付かないため。WebSocket への切り替え(101)はそのまま返す。
// Durable Object から返った応答は見出しを書き換えられないので、写しを作って付ける。
export function withNosniff(res) {
  if (!(res instanceof Response) || res.status === 101 || res.webSocket) return res;
  try {
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.set("x-content-type-options", "nosniff");
    return copy;
  }
}

async function route(request, env, url, ctx) {
  if (handlesRooms(url.pathname)) return handleRooms(request, env, url);
  // waitUntil: 利用者が答えの途中で切ったあとも、AI の費用の精算を最後まで走らせるため（worker/ai-budget.mjs）。
  if (handlesAi(url.pathname)) {
    return handleAi(request, env, url, { waitUntil: ctx && typeof ctx.waitUntil === "function" ? (p) => ctx.waitUntil(p) : null });
  }
  // 外の AI(MCP)の受け口。/mcp でないのは run_worker_first が /api/* だけのため(worker/mcp.mjs の冒頭)。
  if (handlesMcp(url.pathname)) return handleMcp(request, env);
  // CSP の「報告だけ」の違反の報告(_headers)。ログに決まりと先の種類だけ出す(worker/csp-report.mjs の冒頭)。
  if (handlesCspReport(url.pathname)) return handleCspReport(request);
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return withNosniff(await route(request, env, url, ctx));
  },
};
