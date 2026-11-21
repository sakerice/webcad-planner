// Worker で間取りの操作を当てるための入口。部品と表を import して、worker/plan-ctx-factory.mjs の工場に渡す。
//
//   workerOpsCtx(plan) → ctx        PlanCoreOperations.applyOperations(plan, ops, ctx) にそのまま渡せる ctx
//                                   (写しに当てる。plan は変わらず、結果の plan が当てた後の写し)
//   workerApply(plan, ops) → 結果   上の2つをまとめ、断る理由の文を整えたもの(ルームの中ではこれを使う)
//   workerSummarize(plan) → 文字列  依頼文に付ける <plan_summary> の囲みつきの要約
//   workerInspect(plan) → {ok, errors, warnings}
//
// どれも plan 以外の状態を持たない。表と部品はモジュールの読み込み時に1回だけ組む。
// 決めごとと、画面のどの関数に合わせたかは worker/plan-ctx-factory.mjs と
// .superpowers/sdd/2026-11-18-stage5-mcp/task-2-report.md。
import catalog from "../assets/data/worker-catalog.json" with { type: "json" };
import tags from "../assets/models/tags.json" with { type: "json" };
import Operations from "../assets/js/plan-core/operations.js";
import Inspect from "../assets/js/plan-core/inspect.js";
import Settable from "../assets/js/plan-settable.js";
import Knowledge from "../assets/js/object-knowledge.js";
import FreeApply from "../assets/js/plan-free-apply.js";
import HeightModel from "../assets/js/height-model.js";
import Summary from "../assets/js/chat/plan-summary.js";
import Schema from "../assets/js/plan-schema.js";
import Check from "../assets/js/plan-check.js";
import Structure from "../assets/js/plan-structure.js";
import SetbackLaw from "../assets/js/setback-law.js";
import Progress from "../assets/js/plan-core/progress.js";
import { createPlanCtxTools, REFUSAL, firstNewId } from "./plan-ctx-factory.mjs";

const tools = createPlanCtxTools({
  catalog, tags, Operations, Settable, Knowledge, FreeApply, HeightModel, Summary, Inspect, Schema, Check, Structure, SetbackLaw, Progress,
});

export const workerOpsCtx = tools.workerOpsCtx;
export const workerApply = tools.workerApply;
export const workerSummarize = tools.workerSummarize;
export const workerInspect = tools.workerInspect;
export { REFUSAL, firstNewId, createPlanCtxTools };
