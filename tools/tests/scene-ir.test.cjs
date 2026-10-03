const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,registry,observed:f,inferred,unknown,SceneIR,runtime,read}=require('./scene-fixtures.cjs');
const registryActual=registry();
const target={heightDefaults:{modelVersion:2,floorThickness:180}};
const compile=(s,extra={})=>SceneIR.compile(s,{registry:registryActual,targetPlan:target,...extra});
const codes=r=>r.diagnostics.map(d=>d.code);

test('catalogue contract derives all 787 actual records plus nonalias built-ins and actual finish channels',()=>{
 const list=registryActual.list();assert.equal(list.filter(e=>e.source==='catalogue').length,787);
 assert.equal(registryActual.get('car').w,2083);assert.equal(registryActual.get('car').d,4790);
 assert.equal(registryActual.get('desk'),null);assert.equal(registryActual.resolveAlias('desk'),'fmp-Table01');
 assert.equal(registryActual.get('original-desk-work').h,730);
 assert.deepEqual(Array.from(registryActual.get('original-desk-work').finishChannels,c=>c.key),['wood']);
 assert.equal(registryActual.get('fmp-Bed01').front,null,'Unverified manifest metadata must remain unknown');assert.equal(registryActual.get('fmp-WashBasin01').front,'+Z');
 assert.equal(registryActual.get('https://evil.invalid/model.glb'),null);
});

test('observed entry drop/tile, desk pose/channels and car color survive the pure compiler',()=>{
 const scene=fixture(),before=JSON.stringify(scene),r=compile(scene);assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));
 assert.equal(JSON.stringify(scene),before);assert.equal(r.plan.rooms[0].floorRaiseMm,-160);assert.equal(r.plan.rooms[0].skipLevelMm,undefined);
 assert.equal(r.plan.rooms[0].floorMaterial,'tile_floor');assert.equal(r.plan.rooms[0].floorColor,'#bbccdd');
 const desk=r.plan.items.find(i=>i.type==='original-desk-work');assert.equal(desk.x+desk.w/2,2500);assert.equal(desk.y+desk.d/2,4500);assert.equal(desk.rot,90);assert.equal(desk.flipX,true);assert.equal(desk.baseRoom,'study');assert.deepEqual(desk.finishColors,{wood:'#123456'});
 const car=r.plan.items.find(i=>i.type==='car');assert.equal(car.rot,270);assert.equal(car.color,'#225588');assert.equal(car.colorCustom,true);assert.equal(car.modelFacingVersion,1);
 assert.ok(r.evidence.length>30);assert.equal(r.plan.items[0].openingHostWallId,'divider');
});

test('signed finish offset does not move actual runtime ceiling and never migrates legacy plans',()=>{
 const r=compile(fixture()),{makeCtx}=require('./height-runtime.cjs');
 const p={...r.plan,heightDefaults:{modelVersion:2,floorThickness:180},floors:{}};
 const c=makeCtx(p),room=p.rooms[0],floor=c.roomFloorTopY(room),ceiling=c.roomCeilingHeightM(room);
 room.floorRaiseMm=0;assert.ok(Math.abs(c.roomFloorTopY(room)-floor-.160)<1e-9);assert.equal(c.roomCeilingHeightM(room),ceiling);
 const legacy={walls:[],rooms:[],items:[],heightDefaults:{}};const before=JSON.stringify(legacy);
 const bad=compile(fixture(),{targetPlan:legacy});assert.equal(bad.canApply,false);assert.ok(codes(bad).includes('height_model_incompatible'));assert.equal(JSON.stringify(legacy),before);
 const tooDeep=fixture();tooDeep.rooms[0].floorRaiseMm=f(-161);assert.ok(codes(compile(tooDeep)).includes('floor_offset_out_of_range'));
 const thinner=compile(fixture(),{targetPlan:{heightDefaults:{modelVersion:2,perFloor:true},floors:{1:{floorThickness:150}}}});assert.ok(codes(thinner).includes('floor_offset_out_of_range'));
});

test('normalized room use only suggests materials, with explicit non-source provenance',()=>{
 for(const use of ['玄関','浴室','バス','洗面所','洗面','トイレ']){
  const s=fixture();delete s.rooms[0].floorMaterial;s.rooms[0].use=f(use);const r=compile(s);
  assert.equal(r.plan.rooms[0].floorMaterial,undefined);assert.equal(r.suggestions[0].value,'tile_floor');assert.equal(r.suggestions[0].provenance,'semantic-suggestion');
 }
});

test('unknowns and inferred exact choices remain reviewable; no invented value can masquerade as unknown',()=>{
 const s=fixture();s.furniture[0].catalogId=inferred('original-desk-work');const r=compile(s);
 assert.equal(r.canApply,false);assert.ok(codes(r).includes('inference_review'));
 assert.equal(compile(s,{acceptedReviews:['furniture[0].catalogId']}).canApply,true);
 s.furniture[0].sizeMm=unknown();assert.ok(codes(compile(s)).includes('unknown_value'));
 s.furniture[0].sizeMm={value:{w:1000,d:600},status:'unknown'};assert.ok(codes(compile(s)).includes('unknown_has_value'));
 const height=fixture();height.openings[0].heightMm=unknown();const hr=compile(height);assert.equal(hr.canApply,true);assert.equal(hr.plan.items[0].doorHeight,undefined);assert.ok(hr.defaults.some(d=>d.path==='openings[0].heightMm'));assert.ok(hr.evidence.some(e=>e.path==='openings[0].heightMm'&&e.status==='unknown'));
});

test('generic desk/bath aliases, remote IDs, arbitrary dimensions/props and fake material channels never enter DATA',()=>{
 for(const id of ['desk','bath','fmp-invented','https://evil.invalid/model.glb','__proto__']){
  const s=fixture();s.furniture[0].catalogId=f(id);assert.equal(compile(s).canApply,false,id);
 }
 for(const [key,value,code] of [['heightMm',f(1234),'unsupported_asset_height'],['finishColors',f({glass:'#ffffff'}),'unknown_finish_channel'],['finishTextures',f({wood:'https://evil.invalid/x'}),'unsafe_finish_texture'],['finishRoughness',f({wood:.1}),'invalid_finish_roughness'],['color',f('#abcdef'),'unsupported_generic_color'],['onclick',f('evil()'),'unsupported_field'],['facingDirection',f({x:1,y:0}),'asset_facing_conflict']]){
  const s=fixture();s.furniture[0][key]=value;const r=compile(s);assert.equal(r.canApply,false,key);assert.ok(codes(r).includes(code),key+JSON.stringify(r.diagnostics));assert.ok(!r.plan.items.some(i=>i.id==='desk1'));
 }
});

test('full rotated footprint catches symbol-centered oversized bath and rotated desk overhang',()=>{
 const s=fixture();s.furniture[0]={id:'tub',floor:f(1),catalogId:f('original-bathtub'),center:f({x:1500,y:500}),sizeMm:f({w:1600,d:1600}),rotationDeg:f(0),hostRoomId:f('entry'),semanticExtent:f('individual-fixture')};
 assert.ok(codes(compile(s)).includes('asset_outside_room'));
 s.furniture[0].sizeMm=f({w:1600,d:750});assert.equal(compile(s).canApply,true);
 s.furniture[0].semanticExtent=f('room-assembly');assert.ok(codes(compile(s)).includes('asset_semantic_extent'));
 const desk=fixture();desk.furniture[0].center=f({x:400,y:3400});assert.ok(codes(compile(desk)).includes('asset_outside_room'));
});

test('required hall-to-stair circulation needs an explicit valid aperture; a stair object cannot substitute',()=>{
 const s=fixture();s.openings=[];const r=compile(s);assert.ok(codes(r).includes('missing_traversable_connection'));assert.equal(r.canApply,false);
 const wrong=fixture();wrong.openings[0].hostWallId=f('north');assert.ok(codes(compile(wrong)).includes('opening-off-host'));
});

test('actual mkItem staging/apply/undo preserves existing work, host/baseRoom IDs, colors and v1 behavior',()=>{
 const c=runtime(),s=fixture();c.DATA.rooms=[{id:'old',floor:1,x:-2000,y:0,w:1000,d:1000,n:'untouched',floorRaiseMm:20}];
 const before=JSON.stringify(c.DATA),next=c.nextId;
 const preview=c.PlanImport.previewSceneIR(s);assert.equal(preview.canApply,true);assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.nextId,next);assert.equal(c.HISTORY.length,0);
 c.PlanImport.stageSceneIR(s);assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);
 c.applyPlanImport();assert.equal(c.HISTORY.length,1);assert.equal(c.HISTORY[0],before);assert.ok(c.DATA.rooms.some(r=>r.id==='old'&&r.floorRaiseMm===20));
 const opening=c.DATA.items.find(i=>i.type==='door-opening'),desk=c.DATA.items.find(i=>i.type==='original-desk-work'),car=c.DATA.items.find(i=>i.type==='car');
 assert.ok(c.DATA.walls.some(w=>w.id===opening.openingHostWallId));assert.ok(c.DATA.rooms.some(r=>r.id===desk.baseRoom&&r.n==='書斎'));
 assert.equal(desk.rot,90);assert.equal(desk.flipX,true);assert.equal(desk.finishColors.wood,'#123456');assert.equal(car.color,'#225588');assert.equal(car.rot,270);assert.equal(car.modelFacingVersion,1);
 const applied=JSON.stringify(c.DATA);c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),applied);assert.equal(c.HISTORY.length,1,'Repeated Apply cannot duplicate the staged scene');
 const saved=JSON.stringify(c.DATA);assert.equal(JSON.stringify(JSON.parse(saved)),saved);assert.equal(JSON.parse(saved).items.find(i=>i.type==='door-opening').openingHostWallId,opening.openingHostWallId);
 const PlanSchema=require('../../assets/js/plan-schema.js');const normalized=PlanSchema.normalizePlan(JSON.parse(saved));assert.equal(normalized.items.find(i=>i.type==='door-opening').openingHostWallId,opening.openingHostWallId);assert.equal(normalized.items.find(i=>i.type==='original-desk-work').finishColors.wood,'#123456');
 c.DATA=JSON.parse(c.HISTORY.pop());assert.equal(JSON.stringify(c.DATA),before);
 const legacy=c.PlanImport.toAppObjects({walls:[],rooms:[],items:[{type:'desk',floor:1,x:500,y:800,w:1200,d:600}]});
 assert.equal(legacy.items[0].type,'fmp-Table01');assert.equal(legacy.items[0].x,-100,'v1 center conversion preserved');
});

test('Apply revalidates stale preview, refuses incompatible height changes and cannot auto-flip strict sliders',()=>{
 const c=runtime();c.PlanImport.stageSceneIR(fixture());const before=JSON.stringify(c.DATA);c.DATA.heightDefaults.modelVersion=1;c.applyPlanImport();assert.equal(c.DATA.items.length,0);assert.equal(c.HISTORY.length,0);
 assert.doesNotMatch(read('assets/js/plan-import.js'),/orientSlideInDoorsToWalls\(read\.items\)/);
});

test('raw PlanFinish room analysis uses source centers without adding half dimensions',()=>{
 const c=runtime();require('node:vm').runInContext(read('assets/js/plan-finish.js'),c);
 const plan={rooms:[{id:'room',n:'浴室',floor:1,x:0,y:0,w:1000,d:1000}],items:[{type:'sink',x:800,y:700,w:750,d:560,floor:1}]};
 const result=c.PlanFinish._roomsOf(plan);assert.ok(result[0].kinds.includes('vanity'));
});


test('relative entrance annotations cannot masquerade as absolute model offsets',()=>{
 const missing=fixture();delete missing.rooms[0].floorDatum;assert.equal(compile(missing).canApply,false);
 const relative=fixture();relative.rooms[0].floorRaiseMm=f(-150);relative.rooms[0].floorDatum=f({relativeToRoomId:'study'});
 assert.equal(compile(relative).canApply,true);assert.equal(compile(relative).plan.rooms[0].floorRaiseMm,-150);
 relative.rooms[1].floorRaiseMm=unknown();assert.ok(codes(compile(relative)).includes('unresolved_relative_datum'));
 const unknownOffset=fixture();unknownOffset.rooms[0].floorRaiseMm=unknown();delete unknownOffset.rooms[0].floorDatum;
 assert.equal(compile(unknownOffset).canApply,true,'Ordinary unknown offsets are explicit defaults, not fabricated measurements');
});

test('catalogue footprint scaling is a reviewable policy, never an implicit product substitution',()=>{
 const s=fixture();s.furniture[0].sizeMm=f({w:1500,d:750});
 assert.ok(codes(compile(s)).includes('unreviewed_asset_scaling'));
 s.furniture[0].sizePolicy=f('fit-observed');const r=compile(s);assert.equal(r.canApply,false);
 assert.equal(compile(s,{acceptedReviews:['furniture[0].sizePolicy']}).canApply,true);
});


test('relative entrance drop resolves against verified first-floor datum with actual height helpers in both models',()=>{
 const {makeCtx}=require('./height-runtime.cjs');
 for(const v2 of [false,true]){
  const s=fixture();s.rooms[0].floorRaiseMm=f(-150);s.rooms[0].floorDatum=f({relativeToRoomId:'study'});s.rooms[1].floorRaiseMm=f(v2?0:150);
  const targetPlan={heightDefaults:v2?{modelVersion:2,floorThickness:180}:{},floors:{}};
  const r=compile(s,{targetPlan});assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));
  assert.equal(r.plan.rooms[0].floorRaiseMm,v2?-150:0);assert.ok(r.evidence.some(e=>e.observedDeltaMm===-150));
  const c=makeCtx({...targetPlan,...r.plan});const entry=r.plan.rooms[0],ref=r.plan.rooms[1];
  assert.ok(Math.abs(c.roomFloorTopY(entry)-c.roomFloorTopY(ref)+.15)<1e-9);
  const ceiling=c.roomCeilingHeightM(entry);entry.floorRaiseMm=ref.floorRaiseMm;assert.equal(c.roomCeilingHeightM(entry),ceiling);
 }
 const cycle=fixture();cycle.rooms[0].floorDatum=f({relativeToRoomId:'study'});cycle.rooms[1].floorDatum=f({relativeToRoomId:'entry'});assert.equal(compile(cycle).canApply,false);
});

test('windows preserve supported fields and use the actual runtime vertical normalizer without silent clamps',()=>{
 const c=runtime(),s=fixture();s.openings.push({id:'north-window',floor:f(1),hostWallId:f('north'),adjacentRoomIds:f(['entry',null]),center:f({x:3000,y:0}),widthMm:f(1200),kind:f('window'),heightMm:f(1000),sillMm:f(900),windowKind:f('fix'),color:f('#abcdef')});
 let r=c.PlanImport.previewSceneIR(s);assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));
 let it=r.plan.items.find(i=>i.id==='north-window');assert.equal(it.windowHeight,1000);assert.equal(it.windowSill,900);assert.equal(it.windowKind,'fix');assert.equal(it.colorCustom,true);
 s.openings[1].heightMm=f(2200);r=c.PlanImport.previewSceneIR(s);assert.equal(r.canApply,false);assert.ok(codes(r).includes('window_vertical_clamp'));
 s.openings[1].heightMm=unknown();s.openings[1].sillMm=unknown();r=c.PlanImport.previewSceneIR(s);assert.equal(r.canApply,true,'Ordinary unknown window heights/sills use documented defaults');
});


test('source-observed relative delta can use a review-required editor datum without inventing foundation evidence',()=>{
 const {makeCtx}=require('./height-runtime.cjs');
 for(const v2 of [false,true]){
  const c=runtime(),s=fixture();c.DATA.heightDefaults=v2?{modelVersion:2,floorThickness:180,floorRaise:0,floorRaiseSet:true}:{};
  s.rooms[0].floorRaiseMm=f(-150);s.rooms[0].floorDatum=f({relativeToRoomId:'study'});s.rooms[1].floorRaiseMm=unknown();delete s.rooms[1].floorDatum;
  const before=JSON.stringify(c.DATA);let r=c.PlanImport.previewSceneIR(s);
  assert.equal(r.canApply,false);assert.ok(codes(r).includes('reference_datum_review'));assert.equal(r.plan.rooms[0].floorRaiseMm,v2?-150:0);
  r=c.PlanImport.previewSceneIR(s,{acceptedReviews:['rooms[1].floorRaiseMm']});assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));
  assert.equal(JSON.stringify(c.DATA),before);assert.ok(r.evidence.some(e=>e.path==='rooms[1].floorRaiseMm'&&e.status==='unknown'));
  assert.ok(r.defaults.some(d=>d.path==='rooms[1].floorRaiseMm'&&d.provenance==='editor-reference-datum'));
  const h=makeCtx({...c.DATA,...r.plan});assert.ok(Math.abs(h.roomFloorTopY(r.plan.rooms[0])-h.roomFloorTopY(r.plan.rooms[1])+.15)<1e-9);
 }
});


test('unknown noncritical fields do not turn into unsupported observed-parameter errors',()=>{
 const s=fixture();s.openings[0].sillMm=unknown();s.openings[0].windowKind=unknown();s.openings[0].openingModel=unknown();s.openings[0].doorFinish=unknown();
 s.furniture[0].facingDirection=unknown();s.furniture[0].heightMm=unknown();s.furniture[0].finishRoughness=unknown();
 const r=compile(s);assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));assert.ok(r.evidence.filter(e=>e.status==='unknown').length>=7);
});


test('verified asset front axis checks world-facing identity independently of wall binding',()=>{
 const s=fixture(),desk=s.furniture[0];desk.facingDirection=f({x:-1,y:0});assert.equal(compile(s).canApply,true);
 desk.flipY=f(true);assert.ok(codes(compile(s)).includes('asset_facing_conflict'));desk.facingDirection=f({x:1,y:0});assert.equal(compile(s).canApply,true);
 const c=runtime(),model=c.FMP_ITEMS['fmp-WashBasin01'];desk.catalogId=f('fmp-WashBasin01');desk.semanticExtent=f('individual-fixture');desk.sizeMm=f({w:model.w,d:model.d});desk.rotationDeg=f(270);desk.flipX=f(false);desk.flipY=f(false);delete desk.finishColors;delete desk.finishTextures;delete desk.finishRoughness;
 assert.equal(compile(s).canApply,true,JSON.stringify(compile(s).diagnostics));
});

test('review groups preserve fields and optional omissions require explicit per-object classification',()=>{
 const s=fixture();s.furniture.push({id:'decor-vase',floor:f(1),catalogId:unknown(),center:f({x:3500,y:4400}),sizeMm:unknown(),rotationDeg:unknown(),hostRoomId:f('study'),semanticExtent:f('asset')});
 let r=compile(s);assert.equal(r.canApply,false);let g=r.reviewGroups.find(g=>g.entityId==='decor-vase');assert.equal(g.canAcknowledgeOmission,true);assert.ok(g.evidence.some(e=>e.path==='furniture[2].catalogId'&&e.status==='unknown'));assert.equal(r.unresolvedEntities.find(e=>e.id==='decor-vase').source.catalogId.status,'unknown');
 const omission={entityId:'decor-vase',decision:'leave-unplaced',classification:'noncritical-decoration'};
 r=compile(s,{unresolvedDecisions:[omission]});assert.equal(r.canApply,true);assert.deepEqual(r.acknowledgedOmissions,['decor-vase']);assert.equal(r.reconstructionStatus,'incomplete-acknowledged-omissions');assert.ok(!r.plan.items.some(i=>i.id==='decor-vase'));
 assert.equal(compile(s,{unresolvedDecisions:[{entityId:'decor-vase',decision:'leave-unplaced'}]}).canApply,false,'Unknown role is not automatically decoration');
 const stairs=JSON.parse(JSON.stringify(s));stairs.furniture[2].id='stairs';assert.equal(compile(stairs,{unresolvedDecisions:[{...omission,entityId:'stairs'}]}).canApply,false,'Stairs cannot be waived as decoration');
 const bad=fixture();bad.furniture[0].center=f({x:-500,y:-500});assert.equal(compile(bad,{unresolvedDecisions:[{...omission,entityId:'desk1'}]}).canApply,false,'Physical-fit errors cannot be waived');
 const inferredScene=fixture();inferredScene.furniture[0].catalogId=inferred('original-desk-work');r=compile(inferredScene);assert.equal(r.canApply,false);assert.equal(compile(inferredScene,{acceptedReviewGroups:['furniture:desk1']}).canApply,true);
});

test('acknowledged incomplete reconstruction and original evidence persist through Apply, save/load and undo',()=>{
 const c=runtime(),s=fixture();s.furniture.push({id:'decor-vase',floor:f(1),catalogId:unknown(),center:f({x:3500,y:4400}),sizeMm:unknown(),rotationDeg:unknown(),hostRoomId:f('study'),semanticExtent:f('asset')});
 const before=JSON.stringify(c.DATA),decision={entityId:'decor-vase',decision:'leave-unplaced',classification:'noncritical-decoration'};
 c.PlanImport.stageSceneIR(s,{unresolvedDecisions:[decision]});assert.equal(JSON.stringify(c.DATA),before);c.applyPlanImport();
 const report=c.DATA.sceneReconstructionReports[0];assert.equal(report.status,'incomplete-acknowledged-omissions');assert.equal(report.originalIR.furniture[2].catalogId.status,'unknown');assert.equal(report.unresolvedEntities[0].id,'decor-vase');assert.equal(report.reviewDecisions.unresolvedDecisions[0].classification,'noncritical-decoration');assert.ok(report.sourceIdMap.divider);
 const loaded=require('../../assets/js/plan-schema.js').normalizePlan(JSON.parse(JSON.stringify(c.DATA)));assert.deepEqual(loaded.sceneReconstructionReports[0].originalIR,s);assert.equal(loaded.sceneReconstructionReports[0].unresolvedEntities[0].acknowledgedOmission,true);
 c.DATA=JSON.parse(c.HISTORY.pop());assert.equal(JSON.stringify(c.DATA),before);
});

test('grouped review dialog requires actual checkbox action and retains incomplete label',()=>{
 const c=runtime(),nodes={};
 function node(tag){const n={tag,children:[],listeners:{},textContent:'',style:{},classList:{add(){},remove(){}},setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k]??null;},querySelectorAll(){return this.children.flatMap(n=>[...(n.tag==='details'&&n.open?[n]:[]),...(n.querySelectorAll?n.querySelectorAll():[])]);},appendChild(child){child.parentNode=this;this.children.push(child);return child;},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);if(this.id)delete nodes[this.id];},addEventListener(name,fn){this.listeners[name]=fn;}};Object.defineProperty(n,'id',{get(){return this._id;},set(v){this._id=v;nodes[v]=this;}});return n;}
 const parent=node('section');for(const id of ['plan-import-notes','plan-import-status','plan-import-summary','plan-import-rooms','plan-import-cost','plan-import-step3','plan-import-apply','plan-import-modal']){const n=node('div');n.id=id;parent.appendChild(n);}
 c.document={getElementById:id=>nodes[id]||null,createElement:node,createTextNode:text=>({tag:'#text',textContent:text,children:[]})};
 const s=fixture();s.furniture.push({id:'decor-vase',floor:f(1),catalogId:unknown(),center:f({x:3500,y:4400}),sizeMm:unknown(),rotationDeg:unknown(),hostRoomId:f('study'),semanticExtent:f('asset')});
 c.PlanImport.stageSceneIR(s);assert.equal(nodes['plan-import-apply'].disabled,true);
 function all(n){return [n,...n.children.flatMap(all)];}let boxes=all(nodes['scene-ir-review']).filter(n=>n.tag==='input'&&n.type==='checkbox');assert.equal(boxes.length,1,'No global accept-all control or automatic omission');
 boxes[0].checked=true;boxes[0].listeners.change();assert.equal(nodes['plan-import-apply'].disabled,false);assert.ok(nodes['plan-import-notes'].textContent.includes('未完成'));assert.equal(c.DATA.items.length,0,'Review itself never Applies');
 assert.ok(all(nodes['scene-ir-review']).some(n=>n.tag==='pre'&&n.textContent.includes('unknown')));
});

test('existing v1 multipart logical rooms retain open internal seams; v2 shape limitation stays explicit',()=>{
 const PlanGrid=require('../../assets/js/plan-grid.js');
 const one=PlanGrid.build({width:3000,depth:3000,gridX:[0,1000,3000],gridY:[0,1000,3000],floor:1,rooms:[{name:'L-shaped living',parts:[{x0:0,y0:0,x1:1000,y1:3000},{x0:1000,y0:0,x1:3000,y1:1000}]}]});
 assert.equal(one.rooms.length,2);assert.ok(one.rooms.every(r=>r.n==='L-shaped living'));
 assert.equal(one.grid[0][0],one.grid[0][one.grid[0].length-1]);assert.equal(one.grid[0][0],one.grid[one.grid.length-1][0]);assert.equal(one.grid[one.grid.length-1][one.grid[0].length-1],null);
 assert.ok(!one.walls.some(w=>w.x1===one.rooms[1].w&&w.x2===one.rooms[1].w&&Math.min(w.y1,w.y2)===0),'No invented wall at the logical internal seam');
 const s=fixture();s.rooms[0].parts=f([{x:0,y:0,w:1000,d:3000},{x:1000,y:0,w:3000,d:1000}]);assert.ok(codes(compile(s)).includes('unsupported_field'),'Do not silently collapse multipart source to a bounding rectangle');
});

test('actual legacy normalizer preserves explicit Scene IR ceiling elevation while still migrating old objects',()=>{
 const vm=require('node:vm'),{makeCtx,topLevelFunction,topLevelVar}=require('./height-runtime.cjs');
 const c=runtime(),s=fixture();s.furniture=[{id:'fan',floor:f(1),catalogId:f('fmp-CeilingFan01'),center:f({x:2500,y:4500}),sizeMm:f({w:1200,d:1200}),rotationDeg:f(0),hostRoomId:f('study'),semanticExtent:f('asset'),elev:f(1000)}];
 c.PlanImport.stageSceneIR(s);c.applyPlanImport();assert.equal(c.DATA.items.find(i=>i.type==='fmp-CeilingFan01').elev,1000);
 const loaded=JSON.parse(JSON.stringify(c.DATA)),item=loaded.items.find(i=>i.type==='fmp-CeilingFan01');assert.equal(item.sceneImportVersion,2);
 loaded.items.push({...item,id:'legacy-fan',sceneImportVersion:undefined,elev:1000});
 const h=makeCtx(loaded);Object.assign(h,{FMP_ITEMS:c.FMP_ITEMS,getFmpItem:c.getFmpItem,bestFmpType:c.bestFmpType,getItemDefaultSize:c.getItemDefaultSize,ICOLORS:c.ICOLORS,ST:{}});
 vm.runInContext(topLevelVar('PLAN_FIX_OUTDOOR_CEILING_FIXTURES')+'\n'+topLevelFunction('snapOutdoorCeilingFixturesToRoof')+'\n'+topLevelFunction('normalizeLegacyFurnitureItems'),h);
 h.normalizeLegacyFurnitureItems();assert.equal(item.elev,1000,'Observed Scene IR value survives actual save/load normalizer');assert.notEqual(loaded.items.find(i=>i.id==='legacy-fan').elev,1000,'Unrelated legacy migration is not globally disabled');
 const roundtrip=JSON.parse(JSON.stringify(loaded));assert.equal(roundtrip.items.find(i=>i.id===item.id).elev,1000);
});

test('normal collaborative delta path preserves unresolved/provenance reports end to end',async()=>{
 const vm=require('node:vm'),{topLevelFunction,topLevelVar}=require('./height-runtime.cjs'),{pathToFileURL}=require('node:url'),path=require('node:path');
 const c=runtime(),s=fixture();const before=JSON.parse(JSON.stringify(c.DATA));c.PlanImport.stageSceneIR(s);c.applyPlanImport();
 const changed=JSON.parse(JSON.stringify(c.DATA)),noop=()=>{};
 Object.assign(c,{SHARED:{forceScan:true,dirtyIds:{walls:{},items:{},rooms:{}}},ST:{selected:null},
   syncNorthFromPlan:noop,ensureObjectIds:noop,ensureExteriorWallSettings:noop,ensureInteriorWallSettings:noop,ensureRoofAppearance:noop,ensureFloorMetadata:noop,ensureHeightDefaults:noop,syncHeightDefaultsUI:noop,syncExteriorWallSettings:noop,normalizeLegacyFurnitureItems:noop,clearMultiSelection:noop,clearEditHistory:noop,draw2d:noop,updateProps:noop,markDirtyUiOnly:noop,sharedSchedule3DRefresh:noop});
 vm.runInContext(topLevelVar('SHARED_FIELDS')+'\n'+['sharedClone','sharedFastSignature','sharedCollectionNameFor','sharedBaselineFrom','buildSharedPatch','applySharedPatch'].map(topLevelFunction).join('\n'),c);
 const baseline=c.sharedBaselineFrom(before),patch=c.buildSharedPatch(changed,baseline);assert.ok(patch.fields.sceneReconstructionReports);
 const {applyPatch}=await import(pathToFileURL(path.join(__dirname,'../../worker/shared.mjs')).href);
 const server=applyPatch(JSON.parse(JSON.stringify(before)),JSON.parse(JSON.stringify(patch)));assert.deepEqual(server.sceneReconstructionReports,changed.sceneReconstructionReports);
 c.DATA=JSON.parse(JSON.stringify(before));c.applySharedPatch(patch,false);assert.equal(JSON.stringify(c.DATA.sceneReconstructionReports),JSON.stringify(changed.sceneReconstructionReports));
 assert.equal(c.buildSharedPatch(c.DATA,c.SHARED.baseline),null,'Acknowledged patch does not cause repeated report retransmission');
});

test('strict window preview, Apply and actual renderer normalizer share floor-specific host height',()=>{
 const c=runtime(),s=fixture();c.DATA.heightDefaults={modelVersion:2,perFloor:true,wallHeight:2400,floorThickness:180};c.DATA.floors={1:{wallHeight:2400},2:{wallHeight:3000}};
 for(const key of ['walls','rooms','openings','furniture'])for(const entity of s[key])entity.floor=f(2);
 s.rooms[0].floorRaiseMm=f(0);s.openings.push({id:'tall-window',floor:f(2),hostWallId:f('north'),adjacentRoomIds:f(['entry',null]),center:f({x:3000,y:0}),widthMm:f(1200),kind:f('window'),heightMm:f(2500),sillMm:f(200),windowKind:f('fix')});
 let r=c.PlanImport.previewSceneIR(s);assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));let win=r.plan.items.find(i=>i.id==='tall-window');c.normalizeWindowVerticalProps(win);assert.equal(win.windowHeight,2500);
 c.PlanImport.stageSceneIR(s);c.applyPlanImport();win=c.DATA.items.find(i=>i.type==='window');c.normalizeWindowVerticalProps(win);assert.equal(win.windowHeight,2500);assert.equal(win.windowSill,200);
 const legacy={type:'window',floor:2,windowHeight:2500,windowSill:200};c.normalizeWindowVerticalProps(legacy);assert.equal(legacy.windowHeight,2150,'Legacy fallback behavior is unchanged');
});

test('malformed extraction is a blocked diagnostic result, never a staging or grouping exception',()=>{
 const c=runtime(),badVersion=fixture(),missingArray=fixture(),extra=fixture(),nullEntity=fixture();badVersion.sceneVersion=3;delete missingArray.walls;extra.invented='no';nullEntity.furniture.push(null);
 for(const s of [null,badVersion,missingArray,extra,nullEntity]){
  const before=JSON.stringify(c.DATA),id=c.nextId;let r;assert.doesNotThrow(()=>{r=c.PlanImport.stageSceneIR(s);});assert.equal(r.canApply,false);assert.ok(r.diagnostics.some(d=>d.severity==='error'));assert.ok(Array.isArray(r.reviewGroups));assert.ok(Array.isArray(r.acknowledgedOmissions));assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.nextId,id);
 }
});

test('raised room floors cannot produce an accepted frame above the actual wall aperture',()=>{
 const c=runtime(),s=fixture();s.rooms[0].floorRaiseMm=f(600);s.openings.push({id:'raised-window',floor:f(1),hostWallId:f('north'),adjacentRoomIds:f(['entry',null]),center:f({x:3000,y:0}),widthMm:f(1200),kind:f('window'),heightMm:f(1200),sillMm:f(1100),windowKind:f('fix')});
 let r=c.PlanImport.previewSceneIR(s);assert.equal(r.canApply,false);assert.ok(codes(r).includes('window_context_height_conflict'));assert.equal(s.openings[1].heightMm.value,1200,'Do not fix the source height by silent clamping');
 s.openings[1].heightMm=f(500);s.openings[1].sillMm=f(100);r=c.PlanImport.previewSceneIR(s);assert.equal(r.canApply,true,JSON.stringify(r.diagnostics));
});
