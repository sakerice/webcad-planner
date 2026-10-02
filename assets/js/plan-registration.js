// Source-local millimetres are immutable. Registration is a reviewed rigid pose,
// never a resize-to-fit, stair snap, height inference or source-coordinate rewrite.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./plan-grid.js'), require('./plan-structure.js'), require('./plan-schema.js'));
  else root.PlanRegistration = factory(root.PlanGrid, root.PlanStructure, root.PlanSchema);
}(typeof self !== 'undefined' ? self : this, function (Grid, Structure, Schema) {
  'use strict';
  var NUMERIC_EPS = 1e-7, MAX_PRECISION_MM = 100;
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function point(v) { return v && finite(v.x) && finite(v.y); }
  function evidence(v) { return typeof v === 'string' && v.trim().length > 0; }
  function rotate(p, q) { return q === 1 ? {x:-p.y,y:p.x} : q === 2 ? {x:-p.x,y:-p.y} : q === 3 ? {x:p.y,y:-p.x} : {x:p.x,y:p.y}; }
  function transform(p, pose) { var r = rotate(p, pose.quarterTurns); return {x:r.x+pose.dx,y:r.y+pose.dy}; }
  function snapshot(source) { return JSON.stringify(source); }
  function pageId(f) { return f.sourcePageId || f.sourceIdentity && f.sourceIdentity.sourcePageId || null; }
  function diagnostic(code, floor, message, severity) { return {code:code, floor:floor, message:message, severity:severity || 'error'}; }
  function solve(proposal) {
    var anchors = proposal && proposal.anchors, directions = proposal && proposal.directions || [], errors = [];
    if (!Array.isArray(anchors) || !anchors.length || anchors.length > 32 || !Array.isArray(directions) || directions.length > 8) return {ok:false,code:'missing_anchors',message:'位置合わせの対応点がありません。'};
    anchors.forEach(function (a) {
      if (!a || !point(a.local) || !point(a.building) || !evidence(a.evidence) || !finite(a.precisionMm) || a.precisionMm < 0 || a.precisionMm > MAX_PRECISION_MM) errors.push('対応点・根拠・精度（0〜100mm）が必要です。');
    });
    directions.forEach(function (a) {
      if (!a || !point(a.local) || !point(a.building) || !evidence(a.evidence) || !finite(a.precisionDeg) || a.precisionDeg < 0 || a.precisionDeg > 10 || Math.hypot(a.local.x,a.local.y) < NUMERIC_EPS || Math.hypot(a.building.x,a.building.y) < NUMERIC_EPS) errors.push('方向の根拠・精度（0〜10度）が必要です。');
    });
    if (errors.length) return {ok:false,code:'invalid_anchor_evidence',message:errors[0]};
    var independent = anchors.some(function (a, i) { return anchors.some(function (b,j) { return i !== j && Math.hypot(a.local.x-b.local.x,a.local.y-b.local.y) > Math.max(1,4*(a.precisionMm+b.precisionMm)); }); });
    if (!independent && !directions.length) return {ok:false,code:'insufficient_anchors',message:'離れた2つの対応点、または対応点と方向の根拠が必要です。'};
    var candidates = [], attempted = [];
    for (var q = 0; q < 4; q++) {
      var offsets = anchors.map(function (a) { var p=rotate(a.local,q); return {x:a.building.x-p.x,y:a.building.y-p.y}; });
      var pose = {quarterTurns:q,dx:offsets.reduce(function(s,p){return s+p.x;},0)/offsets.length,dy:offsets.reduce(function(s,p){return s+p.y;},0)/offsets.length};
      var residuals = anchors.map(function (a) { var p=transform(a.local,pose); return {residualMm:Math.hypot(p.x-a.building.x,p.y-a.building.y),precisionMm:a.precisionMm,evidence:a.evidence}; });
      var angleResiduals = directions.map(function (a) { var p=rotate(a.local,q), angle=Math.atan2(p.y,p.x)-Math.atan2(a.building.y,a.building.x); return {residualDeg:Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)))*180/Math.PI,precisionDeg:a.precisionDeg,evidence:a.evidence}; });
      var candidate = {pose:pose,residuals:residuals,directionResiduals:angleResiduals};
      attempted.push(candidate);
      if (residuals.every(function (r) {return r.residualMm <= r.precisionMm+NUMERIC_EPS;}) && angleResiduals.every(function(r){return r.residualDeg <= r.precisionDeg+NUMERIC_EPS;})) candidates.push(candidate);
    }
    if (candidates.length !== 1) {
      attempted.sort(function(a,b){return a.residuals.reduce(function(s,r){return s+r.residualMm;},0)-b.residuals.reduce(function(s,r){return s+r.residualMm;},0);});
      return {ok:false,code:candidates.length?'ambiguous_rotation':'anchor_residual',residuals:attempted[0].residuals,directionResiduals:attempted[0].directionResiduals,message:candidates.length?'回転を一意に決められません。':'対応点の残差が根拠の精度を超えています。縮尺・階・対応点を確認してください。'};
    }
    return Object.assign({ok:true},candidates[0]);
  }
  function rect(r, pose) {
    var corners = [{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.d},{x:r.x,y:r.y+r.d}].map(function(p){return transform(p,pose);});
    var xs=corners.map(function(p){return p.x;}),ys=corners.map(function(p){return p.y;});
    return Object.assign({},r,{x:Math.min.apply(null,xs),y:Math.min.apply(null,ys),w:Math.max.apply(null,xs)-Math.min.apply(null,xs),d:Math.max.apply(null,ys)-Math.min.apply(null,ys)});
  }
  function item(it, pose) {
    // The v1 extraction stores CENTRES. toAppObjects later converts to app
    // top-left coordinates exactly once. Rooms use top-left; do not mix them.
    var p=transform({x:it.x,y:it.y},pose);
    return Object.assign({},it,{x:p.x,y:p.y,rot:(((it.rot||0)+pose.quarterTurns*90)%360+360)%360});
  }
  function dimensions(f, diagnostics) {
    ['top','bottom','left','right'].forEach(function (edge) {
      var d=f.dims && f.dims[edge]; if (!d) return;
      var total=Number(d.total), expected=edge==='top'||edge==='bottom'?f.width:f.depth;
      if (d.total !== null && d.total !== undefined && Number.isFinite(total) && total > 0 && Math.abs(total-expected)>NUMERIC_EPS) diagnostics.push(diagnostic('source_scale_conflict',f.floor,edge+'の印字総寸法とローカル総寸法が一致しません。位置合わせで拡縮しません。'));
      if (Array.isArray(d.parts) && d.parts.length && d.parts.every(function(n){return finite(n)&&n>0;}) && total>0 && Math.abs(d.parts.reduce(function(s,n){return s+n;},0)-total)>NUMERIC_EPS) diagnostics.push(diagnostic('dimension_chain_conflict',f.floor,edge+'の寸法内訳と総寸法が一致しません。'));
    });
  }
  function checkBuilding(plan, poses, links) {
    var ds=[], overlap=Structure.floorsOverlap(plan.walls);
    if (!overlap.ok) ds.push(diagnostic('detached_floors',null,'基準階と重ならない階があります: '+overlap.detached.join('・')));
    var floors=Structure.floorsOf(plan.walls);
    for(var i=1;i<floors.length;i++) {
      var lower=plan.rooms.filter(function(r){return r.floor===floors[i-1];}), upper=plan.rooms.filter(function(r){return r.floor===floors[i];});
      if (!lower.some(function(a){return upper.some(function(b){return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>NUMERIC_EPS && Math.min(a.y+a.d,b.y+b.d)-Math.max(a.y,b.y)>NUMERIC_EPS;});})) ds.push(diagnostic('adjacent_floor_disjoint',floors[i],'隣接する階の実際の部屋範囲が重なりません。外接矩形だけでは整合しません。'));
    }
    (links || []).forEach(function (link) {
      if (!link || !link.lower || !link.upper || !poses[link.lower.floor] || !poses[link.upper.floor] || link.upper.floor!==link.lower.floor+1 || !point(link.lower.point) || !point(link.upper.point) || !evidence(link.evidence) || !finite(link.precisionMm) || link.precisionMm<0 || link.precisionMm>MAX_PRECISION_MM) { ds.push(diagnostic('invalid_stair_link',null,'階段の到着点の対応・階・根拠が未確認です。')); return; }
      var a=transform(link.lower.point,poses[link.lower.floor]),b=transform(link.upper.point,poses[link.upper.floor]),residual=Math.hypot(a.x-b.x,a.y-b.y);
      if(residual>link.precisionMm+NUMERIC_EPS) ds.push(Object.assign(diagnostic('stair_endpoint_mismatch',link.upper.floor,'階段の到着点が一致しません。階段全体の外接矩形で吸着しません。'),{residualMm:residual,precisionMm:link.precisionMm}));
    });
    return ds;
  }
  function compile(source, options) {
    options=options||{};
    var local=clone(source), floors=Array.isArray(local.floors)?local.floors:[], ds=[], poses={}, reports=[], plan={walls:[],rooms:[],items:[],marks:[]};
    var multi=floors.length>1, seenFloors={}, seenPages={};
    if(!floors.length) ds.push(diagnostic('missing_local_frames',null,'ローカル座標の階図面がありません。'));
    var sourceKey=snapshot(source), proposalKey=snapshot(options.proposals || {version:1,floors:[]}), decisionSet=options.sourceSnapshot===sourceKey && options.proposalSnapshot===proposalKey?options:{};
    if(options.proposalSnapshot && options.proposalSnapshot!==proposalKey) ds.push(diagnostic('stale_proposals',null,'位置合わせの提案が変わりました。確認をやり直してください。'));
    if(options.sourceSnapshot && options.sourceSnapshot!==sourceKey) ds.push(diagnostic('stale_registration',null,'元図面・切り出し・読み取りが変わりました。位置合わせを再確認してください。'));
    floors.forEach(function(f){
      var id=pageId(f), decision=(decisionSet.floors||[]).find(function(d){return d.floor===f.floor && d.sourcePageId===id;}), proposal=(options.proposals && options.proposals.floors || []).find(function(d){return d.floor===f.floor && d.sourcePageId===id;});
      if(!Number.isInteger(f.floor) || f.floor<1 || f.floor>Schema.LIMITS.MAX_FLOOR || seenFloors[f.floor]) ds.push(diagnostic('duplicate_floor',f.floor,'階の対応が重複または不正です。'));
      seenFloors[f.floor]=true;
      if(multi && (!id || seenPages[id])) ds.push(diagnostic('source_page_mapping',f.floor,'各階に一意の元ページが必要です。'));
      if(id) seenPages[id]=true;
      var identity=f.sourceIdentity;
      if(identity && identity.status==='conflict') ds.push(diagnostic('floor_identity_conflict',f.floor,'表題と読み取りの階数が矛盾しています。'));
      else if((multi || identity) && (!identity || identity.status!=='confirmed') && !(decision && decision.identityConfirmed===true && evidence(decision.identityEvidence))) ds.push(diagnostic('floor_identity_unknown',f.floor,'元ページの表題と階数を確認してください。'));
      var built=Grid.build(f); built.problems.forEach(function(m){ds.push(diagnostic('local_geometry',f.floor,m));});
      dimensions(f,ds);
      var solved=multi?solve(decision && decision.reviewed===true?decision:proposal):{ok:true,pose:{quarterTurns:0,dx:0,dy:0},residuals:[]};
      if(!solved.ok) ds.push(diagnostic(solved.code,f.floor,solved.message));
      if(multi && !(decision && decision.reviewed===true)) ds.push(diagnostic('registration_unreviewed',f.floor,'対応点と残差を確認してから位置合わせを採用してください。'));
      reports.push({floor:f.floor,sourcePageId:id,status:solved.ok?(decision&&decision.reviewed?'reviewed':'proposed'):'unknown',solution:solved});
      // Unknown poses are not presented as a building-space preview.
      if(!solved.ok) return;
      poses[f.floor]=solved.pose;
      built.walls.forEach(function(w){var a=transform({x:w.x1,y:w.y1},solved.pose),b=transform({x:w.x2,y:w.y2},solved.pose);plan.walls.push(Object.assign({},w,{x1:a.x,y1:a.y,x2:b.x,y2:b.y}));});
      built.rooms.forEach(function(r){plan.rooms.push(rect(r,solved.pose));});
    });
    (local.items||[]).forEach(function(it){
      if(!it || !poses[it.floor]) return;
      if(!['x','y','w'].every(function(k){return finite(it[k]);}) || it.w<=0 || it.d!==undefined&&(!finite(it.d)||it.d<=0) || it.rot!==undefined&&!finite(it.rot)) {ds.push(diagnostic('invalid_local_item',it.floor,'物のローカル座標・寸法が未確認です。'));return;}
      if(it.d===undefined)ds.push(diagnostic('display_depth_assumed',it.floor,it.type+' の奥行きは元図面では未記載です。既存カタログの表示既定値を使います。','warning'));
      plan.items.push(item(it,poses[it.floor]));
    });
    (local.marks||[]).forEach(function(m){if(poses[m.floor]){var pose=poses[m.floor],p=transform(m,pose);plan.marks.push(Object.assign({},m,{x:p.x,y:p.y,w:pose.quarterTurns%2?m.d:m.w,d:pose.quarterTurns%2?m.w:m.d}));}});
    if(Object.keys(poses).length===floors.length) ds=ds.concat(checkBuilding(plan,poses,options.proposals && options.proposals.stairLinks));
    var deferredItems=multi?plan.items.filter(function(it){return /^stair/.test(it.type);}):[];
    if(multi) {
      ds.push(diagnostic('vertical_geometry_unknown',null,'階高・床厚・階段の上り量・開口は未検証です。既存の表示高さを使う部分的な組み立てです。','warning'));
      if(deferredItems.length) ds.push(diagnostic('stairs_deferred',null,'階段 '+deferredItems.length+' 点は元の読み取りに保持します。高さと開口が未検証のため配置しません。','warning'));
      plan.items=plan.items.filter(function(it){return !/^stair/.test(it.type);});
      if(decisionSet.partialAcknowledged!==true) ds.push(diagnostic('partial_assembly_unacknowledged',null,'高さ・階段・屋根が未検証の部分的な取り込みであることを確認してください。'));
    }
    Schema.validatePlan(plan).errors.forEach(function(message){ds.push(diagnostic('registered_plan_invalid',null,message));});
    var canApply=!ds.some(function(d){return d.severity==='error';});
    return {version:1,canApply:canApply,status:multi?(canApply?'partial-building-assembly':'registration-review-required'):'single-floor',sourceSnapshot:sourceKey,floors:reports,diagnostics:ds,deferredItems:deferredItems,plan:plan,poses:poses};
  }
  return {compile:compile,solve:solve,checkBuilding:checkBuilding,transform:transform,snapshot:snapshot,pageId:pageId,NUMERIC_EPS:NUMERIC_EPS,MAX_PRECISION_MM:MAX_PRECISION_MM};
}));
