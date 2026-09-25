// 取り込んだ間取りを知識に照らす。**中身は assets/js/plan-check.js にある。**
//
// 呼ぶ人が2人いる(取り込み直後の Worker と、仕上げのあとのブラウザ)ので、
// 実装は両方から使える場所へ置いてある。ここはその入口。
import PlanCheck from "../assets/js/plan-check.js";
import { ITEM_SPEC } from "./plan-item-spec.mjs";

// 読み取りに渡した既定寸法。
//
// **これを渡さないと、正しく読めた図面ほど警告が出る。** 手順17は設備の
// 寸法を「既定値のまま変えない」と命じているので、既定のままの値は図面から
// 読んだ答えではない。寸法の指摘をしてよいのは、既定から外れているものだけ。
//
// 画面側は ISIZES(assets/js/app-constants.js)を渡す。二か所から取っているが、
// 両者が一致していることは tools/tests/plan-item-spec.test.cjs が見張っている。
const READ_DEFAULTS = Object.fromEntries(ITEM_SPEC.map((s) => [s.type, { w: s.w, d: s.d }]));

export function knowledgeWarnings(plan, roomTypes) {
  return PlanCheck.knowledgeWarnings(plan, roomTypes, { defaults: READ_DEFAULTS });
}

export const _internals = PlanCheck._internals;
