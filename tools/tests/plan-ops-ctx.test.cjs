// 画面の操作の ctx(planOpsCtx、assets/js/plan-data.js)の決まり。
//   - 写しに当てる使い方(inPlace でない)では作れない(hooks が DATA を直接書き換えるため)
//   - 途中の例外を上へ出す(rethrow)
//   - 受ける階の上限は保存プランが持てる上限(PlanSchema.LIMITS.MAX_FLOOR)。画面では今の階が 5 になりうる
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installOps } = require('./ops-vm.cjs');
const PlanSchema = require('../../assets/js/plan-schema.js');

function ctx() {
  return installOps(vm.createContext({ console, ST: { snap: 10, shiftKey: false }, nextId: 1 }));
}

test('inPlace でない使い方では作れず、分かる文言で止まる', () => {
  const c = ctx();
  assert.throws(() => c.planOpsCtx(), /inPlace/);
  assert.throws(() => c.planOpsCtx({ targets: [] }), /写しに当てる ctx には使えません/);
  assert.equal(c.planOpsCtx({ inPlace: true }).inPlace, true);
});

test('例外を上へ出し、階は保存プランの上限まで受ける', () => {
  const o = ctx().planOpsCtx({ inPlace: true });
  assert.equal(o.rethrow, true);
  assert.equal(o.maxFloor, PlanSchema.LIMITS.MAX_FLOOR);
  assert.ok(o.maxFloor >= 5, '画面で今の階が 5 になる道があるのに、5 階に置けない');
});
