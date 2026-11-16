// プランの検査をまとめて行う。チャットの AI と ChatGPT(MCP)の「検査」の道具が使う。
//
// 既にある検査3つを束ねるだけで、検査の中身はここに書かない:
//   PlanSchema.validatePlan     assets/js/plan-schema.js    形(型・必須の欄・id の重複)
//   PlanCheck.knowledgeWarnings  assets/js/plan-check.js     物の置かれ方の知識(浴槽が浴室に無い など)
//   PlanStructure.floorsOverlap  assets/js/plan-structure.js 上下の階が同じ位置に積まれているか
//
// 依存は引数 deps({schema, check, structure, knownItemTypes?})で受け、省いたものは
// **呼ばれた時点で**引く(Node は require、ブラウザは UMD の root)。index.html では plan-core の
// <script> がこれら3つより前にあるので、読み込み時に引くと空になる。
// plan は書き換えない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(function (name) {
      return require({ PlanSchema: '../plan-schema.js', PlanCheck: '../plan-check.js', PlanStructure: '../plan-structure.js' }[name]);
    });
  } else {
    root.PlanCoreInspect = factory(function (name) { return root[name]; });
  }
}(typeof self !== 'undefined' ? self : this, function (lookup) {

  function isPlanLike(plan) {
    return !!plan && typeof plan === 'object' && !Array.isArray(plan)
      && Array.isArray(plan.walls) && Array.isArray(plan.rooms) && Array.isArray(plan.items);
  }
  function errorText(e) { return e && e.message ? e.message : String(e); }

  function inspectPlan(plan, deps) {
    deps = deps || {};
    var schema = deps.schema || lookup('PlanSchema');
    var check = deps.check || lookup('PlanCheck');
    var structure = deps.structure || lookup('PlanStructure');
    var errors = [], warnings = [];

    var opts = deps.knownItemTypes ? { knownItemTypes: deps.knownItemTypes } : {};
    var v = schema.validatePlan(plan, opts) || {};
    (v.errors || []).forEach(function (e) { errors.push(String(e)); });
    (v.warnings || []).forEach(function (w) { warnings.push(String(w)); });

    // 形が崩れている(walls などが配列でない)プランには、残り2つを当てない(中で投げるため)。
    if (isPlanLike(plan)) {
      try {
        (check.knowledgeWarnings(plan) || []).forEach(function (w) { warnings.push(String(w)); });
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
