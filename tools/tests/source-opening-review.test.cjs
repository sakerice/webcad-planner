const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../../assets/js/source-opening-review.js');
const wall={id:'host',floor:1,x1:0,y1:0,x2:4000,y2:0,thick:120};
const reading=(extra={})=>({type:'door-swing',floor:1,x:2000,y:0,w:780,d:780,rot:0,flipX:false,flipY:false,...extra});
const reverse=w=>({...w,x1:w.x2,y1:w.y2,x2:w.x1,y2:w.y1});
const native={id:'native'};
const points=p=>p.map(v=>[Math.round(v.x*1e5),Math.round(v.y*1e5)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
test('reader axis and intent preserve hinge and world swing for reversed walls',()=>{
 for(const rot of [0,90,180,270])for(const flipX of [false,true])for(const flipY of [false,true]){
  const a=rot*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},n={x:-u.y,y:u.x},at=x=>({x:u.x*x,y:u.y*x});
  const w={...wall,x2:u.x*4000,y2:u.y*4000},r=reading({rot,...at(2000),flipX,flipY}),raw=JSON.stringify(r);
  const f=R.compile(r,native,[w],[]),b=R.compile(r,native,[reverse(w)],[]);
  assert.equal(f.ok,true,JSON.stringify(f.diagnostics));assert.equal(b.ok,true,JSON.stringify(b.diagnostics));
  assert.deepEqual(points(f.geometry.fullOpenLeaf),points(b.geometry.fullOpenLeaf));
  const sign=flipX?-1:1,hinge=at(2000-sign*390),open={x:hinge.x+n.x*sign*(flipY?-1:1)*780,y:hinge.y+n.y*sign*(flipY?-1:1)*780};
  for(const p of [f,b]){assert.ok(Math.hypot(p.geometry.hinge.x-hinge.x,p.geometry.hinge.y-hinge.y)<1e-6);assert.ok(Math.hypot(p.geometry.fullOpenLatch.x-open.x,p.geometry.fullOpenLatch.y-open.y)<1e-6);}
  assert.equal(JSON.stringify(r),raw);
 }
});
test('surface slider travel and face survive reversed walls, including both handings',()=>{
 for(const rot of [0,90,180,270])for(const flipX of [false,true])for(const flipY of [false,true]){
  const a=rot*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},w={...wall,x2:u.x*4000,y2:u.y*4000},r=reading({type:'door-slide-s',d:150,x:u.x*2000,y:u.y*2000,rot,flipX,flipY});
  const f=R.compile(r,native,[w],[]),b=R.compile(r,native,[reverse(w)],[]);
  assert.equal(f.ok,true,JSON.stringify(f.diagnostics));assert.equal(b.ok,true,JSON.stringify(b.diagnostics));assert.deepEqual(points(f.geometry.fullOpenLeaf),points(b.geometry.fullOpenLeaf));
 }
});
test('unknown direction, unknown kind, ambiguous host and off-wall center remain explicit',()=>{
 const r=reading();delete r.flipY;
 assert.equal(R.compile(r,native,[wall],[]).diagnostics[0].code,'unknown-reader-door-direction');
 assert.equal(R.compile(reading({type:'door-fold'}),native,[wall],[]).diagnostics[0].code,'unsupported-reader-door-mechanism');
 assert.equal(R.compile(reading(),native,[wall,{...wall,id:'other'}],[]).diagnostics[0].code,'ambiguous-reader-door-host');
 assert.equal(R.compile(reading({y:20}),native,[wall],[]).diagnostics[0].code,'unresolved-reader-door-host');
});
test('insufficient supporting wall fails even when the opening itself fits; no clamp or flip',()=>{
 const r=reading({type:'door-slide-s',d:150,x:3400});const before=JSON.stringify(r);
 const result=R.compile(r,native,[wall],[]);assert.equal(result.ok,false);assert.ok(result.diagnostics.some(d=>d.code==='insufficient-slider-backing'));assert.equal(JSON.stringify(r),before);
});
test('reviewed invalid placement aborts the whole derived plan while preserving input',()=>{
 const r=reading({type:'door-slide-s',d:150,x:3400});delete r.flipX;delete r.flipY;r.sourceOpeningReview={reviewed:true,evidence:'source page and travel arrow inspected',flipX:false,flipY:false};
 const plan={walls:[wall],items:[{id:'native',type:r.type,floor:1,x:3010,y:-75,w:780,d:150,rot:0}],rooms:[]},before=JSON.stringify(plan);
 assert.throws(()=>R.bind([r],plan),/建具/);assert.equal(JSON.stringify(plan),before);
});
test('support uses exact native width/travel and detects a 2mm gap between coarse sampling points',()=>{
 const it={id:'slide',type:'door-slide-s',floor:1,x:1610,y:-75,w:780,d:150,rot:0,flipX:false,flipY:false};
 const walls=[{...wall,x2:2751},{...wall,id:'next',x1:2753}],info={wall:walls[0],x:2000,y:0};
 const r=R.slidingBacking(it,1,info,walls,[it],()=>null);
 assert.equal(r.leafWidthMm,840);assert.equal(r.travelMm,810);assert.equal(r.needMm,800);assert.equal(r.missingMm,2);assert.deepEqual(r.missingIntervalsMm,[[2751,2753]]);
});
test('native setting provenance, roundtrip and current inspection retain unknown source and detect later wall loss',()=>{
 const source=reading();delete source.flipX;delete source.flipY;
 const plan={walls:[wall],items:[{id:'native',type:source.type,floor:1,x:1610,y:-390,w:780,d:780,rot:0,flipX:false,flipY:false}],rooms:[]};
 const bound=R.bind([source],plan).plan,it=bound.items[0],raw=it.sourceOpeningMapping.sourceReading;
 assert.equal(R.currentStatus(it,bound.walls,bound.items).status,'source-direction-unknown');
 it.flipX=true;R.recordEditorSetting(it,'flipX',true,bound.walls);it.flipY=true;R.recordEditorSetting(it,'flipY',true,bound.walls);
 const loaded=JSON.parse(JSON.stringify(bound));assert.equal(R.currentStatus(loaded.items[0],loaded.walls,loaded.items).status,'editor-direction-set');assert.equal(loaded.items[0].sourceOpeningMapping.sourceReading,raw);assert.equal(JSON.parse(raw).flipX,undefined);
 loaded.walls=[];assert.equal(R.currentStatus(loaded.items[0],loaded.walls,loaded.items).current.ok,false);
});
test('current diagnostics use the actual native wall basis and expose projected display without changing the source',()=>{
 const source=reading();delete source.flipX;delete source.flipY;const host=reverse(wall);
 const plan={walls:[host],items:[{id:'native',type:source.type,floor:1,x:1610,y:-390,w:780,d:780,rot:0,flipX:false,flipY:false}],rooms:[]},it=R.bind([source],plan).plan.items[0],raw=it.sourceOpeningMapping.sourceReading;
 const current=R.currentStatus(it,[host],[it],{wall:host,x:2000,y:0,rot:180});assert.equal(current.current.ok,true);assert.ok(Math.abs(current.current.geometry.hinge.x-2390)<1e-6);assert.ok(current.current.geometry.fullOpenLatch.y<0);
 const projected=R.currentStatus(it,[host],[it],{wall:host,x:2050,y:0,rot:180});assert.equal(projected.current.ok,false);assert.ok(projected.current.diagnostics.some(d=>d.code==='legacy-display-projection'));assert.equal(it.sourceOpeningMapping.sourceReading,raw);
});
test('initial beside placement records translation without rewriting source or reporting a user edit',()=>{
 const source=reading({x:2000.1}),native={id:'native',type:source.type,floor:1,x:source.x-390,y:-390,w:780,d:780,rot:0,flipX:false,flipY:false},plan=R.bind([source],{walls:[wall],items:[native],rooms:[]}).plan,it=plan.items[0],raw=it.sourceOpeningMapping.sourceReading;
 it.x+=5000;for(const w of plan.walls){w.x1+=5000;w.x2+=5000;}R.initialTranslation(plan,5000);
 assert.equal(it.sourceOpeningMapping.sourceReading,raw);assert.equal(it.sourceOpeningMapping.displayTranslation.x,5000);assert.equal(R.currentStatus(it,plan.walls,plan.items).edited,false);assert.equal(R.currentStatus(it,plan.walls,plan.items).current.ok,true);
 assert.throws(()=>R.initialTranslation(plan,5000),/来歴/);
});
function imageFixture(){const source=reading();delete source.flipX;delete source.flipY;source.sourceOpeningReference={sourcePageId:'public-page',originalSnapshot:JSON.stringify(source)};const plan=R.bind([source],{walls:[wall],items:[{...native,type:source.type,floor:1,x:1610,y:-390,w:780,d:780,rot:0,flipX:false,flipY:false}],rooms:[]}).plan;return {plan,annotation:{originalSnapshot:plan.items[0].sourceOpeningMapping.sourceReading,sourcePageId:'public-page',reviewed:true,observedKind:'door-swing',hingeSide:'axis-high',openSide:'normal-low',evidence:'Quarter arc at east hinge opens north',region:{page:1}}};}
test('manual pixel evidence derives native direction but leaves original reading and dimensions unchanged',()=>{const {plan,annotation}=imageFixture(),before=JSON.stringify(plan),result=R.applyImageDirections(plan,[annotation]),it=result.plan.items[0];assert.equal(result.reviews[0].applied,true);assert.equal(JSON.stringify(plan),before);assert.equal(it.flipX,true);assert.equal(it.flipY,false);assert.equal(it.w,780);assert.equal(it.sourceOpeningMapping.sourceReading,plan.items[0].sourceOpeningMapping.sourceReading);assert.equal(R.currentStatus(it,result.plan.walls,result.plan.items).status,'source-image-direction-reviewed');const loaded=JSON.parse(JSON.stringify(result.plan));assert.equal(R.currentStatus(loaded.items[0],loaded.walls,loaded.items).imageCurrent,true);it.x+=10;assert.equal(R.currentStatus(it,result.plan.walls,result.plan.items).status,'source-image-review-edited');});
test('unknown, stale, duplicate and unsupported image annotations never force a direction',()=>{for(const change of [{reviewed:false,reason:'No legend'},{originalSnapshot:'stale'},{sourcePageId:'wrong'},{observedKind:'door-fold'},{hingeSide:null}]){const {plan,annotation}=imageFixture(),result=R.applyImageDirections(plan,[{...annotation,...change}]);assert.equal(result.reviews[0].applied,false);assert.equal(result.plan.items[0].flipX,false);}const {plan,annotation}=imageFixture();plan.items.push({...plan.items[0],id:'duplicate'});assert.equal(R.applyImageDirections(plan,[annotation]).reviews[0].applied,false);});
test('beside translation preserves image direction and strict collisions remain unresolved',()=>{const {plan,annotation}=imageFixture();plan.items[0].x+=5000;plan.walls.forEach(w=>{w.x1+=5000;w.x2+=5000;});R.initialTranslation(plan,5000);plan.walls.push({id:'collision',floor:1,x1:7000,y1:-1000,x2:7000,y2:1000,thick:120});const result=R.applyImageDirections(plan,[annotation]);assert.equal(result.reviews[0].applied,true);assert.equal(result.reviews[0].physicalValidation,'reader-geometry-unresolved');assert.ok(result.reviews[0].diagnostics.some(d=>d.code==='opening-sweep-collision'));assert.equal(result.plan.items[0].x,6610);});
test('all eleven public sample annotations preserve raw source; only five directions are reviewed',()=>{const fs=require('node:fs'),p=JSON.parse(fs.readFileSync('local-preview/source-reviewed-doors.json')),a=require('./fixtures/registration/native-astra-opening-image-review.json'),r=require('../../tools/tests/fixtures/registration/source-image-door-review-results.json');assert.equal(a.length,11);assert.equal(r.filter(i=>i.applied).length,5);assert.equal(r.filter(i=>i.applied&&i.physicalValidation==='reader-geometry-unresolved').length,4);for(const annotation of a){const it=p.items.find(i=>i.sourceOpeningMapping?.sourceReading===annotation.originalSnapshot);assert.ok(it);assert.equal(JSON.parse(it.sourceOpeningMapping.sourceReading).flipX,undefined);assert.equal(!!it.sourceOpeningMapping.imageReview,annotation.reviewed);}});
test('image direction rejects edited targets atomically, including stale baseline geometry',()=>{for(const edit of [i=>i.x+=100,i=>i.rot=90,i=>i.w+=20,i=>i.flipX=true,i=>i.openingHostWallId='different']){const {plan,annotation}=imageFixture();edit(plan.items[0]);const before=JSON.stringify(plan),r=R.applyImageDirections(plan,[annotation]);assert.equal(r.reviews[0].applied,false);assert.equal(r.reviews[0].diagnostics[0].code,'edited-image-door-target');assert.equal(JSON.stringify(r.plan),before);assert.equal(JSON.stringify(plan),before);}const {plan,annotation}=imageFixture();plan.items[0].x+=200;plan.items[0].sourceOpeningMapping.importedDisplayGeometry=R.displayGeometry(plan.items[0]);const before=JSON.stringify(plan),r=R.applyImageDirections(plan,[annotation]);assert.equal(r.reviews[0].diagnostics[0].code,'stale-image-door-frame');assert.equal(JSON.stringify(r.plan),before);});
test('contradictory and identical duplicate image annotations reject the complete batch without metadata changes',()=>{for(const extra of [{hingeSide:'axis-low',openSide:'normal-high'},{}]){const {plan,annotation}=imageFixture(),before=JSON.stringify(plan),r=R.applyImageDirections(plan,[annotation,{...annotation,...extra}]);assert.equal(r.reviews.length,2);assert.ok(r.reviews.every(v=>!v.applied&&v.diagnostics[0].code==='duplicate-image-door-annotation'));assert.equal(JSON.stringify(r.plan),before);}const {plan,annotation}=imageFixture(),before=JSON.stringify(plan),r=R.applyImageDirections(plan,[annotation,{...annotation,sourcePageId:'stale-page'}]);assert.ok(r.reviews.every(v=>!v.applied));assert.equal(JSON.stringify(r.plan),before);});
test('changed registration/source provenance and previously applied review require explicit new review',()=>{for(const edit of [m=>{const r=JSON.parse(m.registeredReading);r.rot=180;m.registeredReading=JSON.stringify(r);},m=>m.sourceReference.originalSnapshot='other',m=>m.sourceReference.registrationPose={quarterTurns:0,dx:100,dy:0}]){const {plan,annotation}=imageFixture();edit(plan.items[0].sourceOpeningMapping);const before=JSON.stringify(plan),r=R.applyImageDirections(plan,[annotation]);assert.equal(r.reviews[0].diagnostics[0].code,'stale-image-door-frame');assert.equal(JSON.stringify(r.plan),before);}const {plan,annotation}=imageFixture(),applied=R.applyImageDirections(plan,[annotation]).plan,before=JSON.stringify(applied),again=R.applyImageDirections(applied,[annotation]);assert.equal(again.reviews[0].diagnostics[0].code,'edited-image-door-target');assert.equal(JSON.stringify(again.plan),before);});
