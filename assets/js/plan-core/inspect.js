// プランの検査をまとめて行う。チャットの AI と ChatGPT(MCP)の「検査」の道具が使う。
//
// 既にある検査3つを束ねるだけで、検査の中身はここに書かない:
//   PlanSchema.validatePlan     assets/js/plan-schema.js    形(型・必須の欄・id の重複)
//   PlanCheck.knowledgeWarnings  assets/js/plan-check.js     物の置かれ方の知識(浴槽が浴室に無い など)
//   PlanStructure.floorsOverlap  assets/js/plan-structure.js 上下の階が同じ位置に積まれているか
//
// 依存は引数 deps({schema, check, structure, knownItemTypes?, defaults?})で受け、省いたものは
// **呼ばれた時点で**引く(Node と Worker は require、ブラウザは UMD の root)。index.html では plan-core の
// <script> がこれら3つより前にあるので、読み込み時に引くと空になる。
// require は文字列をそのまま書く。引数が式(require(表[name]) など)だと esbuild が束ねず、
// Worker(require の無い ESM)で deps なしに呼ぶと落ちる。
// 依存が見つからないときは投げず、errors に1件入れて ok:false で返す。
// defaults は種類ごとの既定寸法の表で、knowledgeWarnings の options.defaults にそのまま渡す
// (既定寸法のままの物の寸法を叱らないため。画面は ISIZES、Worker は READ_DEFAULTS を渡している)。
// plan は書き換えない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(function (name) {
      if (name === 'PlanSchema') return require('../plan-schema.js');
      if (name === 'PlanCheck') return require('../plan-check.js');
      if (name === 'PlanStructure') return require('../plan-structure.js');
      return null;
    });
  } else {
    root.PlanCoreInspect = factory(function (name) { return root[name]; });
  }
}(typeof self !== 'undefined' ? self : this, function (lookup) {

  function find(name) {
    try { return lookup(name) || null; } catch (e) { return null; }
  }

  function isPlanLike(plan) {
    return !!plan && typeof plan === 'object' && !Array.isArray(plan)
      && Array.isArray(plan.walls) && Array.isArray(plan.rooms) && Array.isArray(plan.items);
  }
  function errorText(e) { return e && e.message ? e.message : String(e); }

  function inspectPlan(plan, deps) {
    deps = deps || {};
    var schema = deps.schema || find('PlanSchema');
    var check = deps.check || find('PlanCheck');
    var structure = deps.structure || find('PlanStructure');
    var missing = [];
    if (!schema || typeof schema.validatePlan !== 'function') missing.push('PlanSchema');
    if (!check || typeof check.knowledgeWarnings !== 'function') missing.push('PlanCheck');
    if (!structure || typeof structure.floorsOverlap !== 'function') missing.push('PlanStructure');
    if (missing.length) {
      return { ok: false, errors: ['検査の部品が読み込まれていないので、検査できませんでした（' + missing.join('・') + '）'], warnings: [] };
    }
    var errors = [], warnings = [];

    var opts = deps.knownItemTypes ? { knownItemTypes: deps.knownItemTypes } : {};
    var v = schema.validatePlan(plan, opts) || {};
    (v.errors || []).forEach(function (e) { errors.push(String(e)); });
    (v.warnings || []).forEach(function (w) { warnings.push(String(w)); });

    // 形が崩れている(walls などが配列でない)プランには、残り2つを当てない(中で投げるため)。
    if (isPlanLike(plan)) {
      try {
        (check.knowledgeWarnings(plan, null, deps.defaults ? { defaults: deps.defaults } : undefined) || []).forEach(function (w) { warnings.push(String(w)); });
      } catch (e) {
        errors.push('物の置かれ方の検査の途中で誤りが起きました: ' + errorText(e));
      }
      try {
        var o = structure.floorsOverlap(plan.walls) || {};
        if (o.ok === false) {
          var floors = (o.detached || []).map(function (f) { return f + '階'; }).join('・') || 'どこかの階';
          errors.push(floors + 'の壁が、いちばん下の階の壁と重なっていません。'
            + '上下の階が同じ位置に積まれていないので、各階を同じ原点で置き直してください');
        }
      } catch (e) {
        errors.push('階の重なりの検査の途中で誤りが起きました: ' + errorText(e));
      }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  return { inspectPlan: inspectPlan };
}));
