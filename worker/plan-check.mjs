// 取り込んだ間取りを知識に照らす。**中身は assets/js/plan-check.js にある。**
//
// 呼ぶ人が2人いる(取り込み直後の Worker と、仕上げのあとのブラウザ)ので、
// 実装は両方から使える場所へ置いてある。ここはその入口。
import PlanCheck from "../assets/js/plan-check.js";

export const knowledgeWarnings = PlanCheck.knowledgeWarnings;
export const _internals = PlanCheck._internals;
