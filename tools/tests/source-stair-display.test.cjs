const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const Display=require('../../assets/js/source-stair-display.js');
const {topLevelFunction}=require('./height-runtime.cjs');
function runtime(){const c=vm.createContext({DATA:{items:[]},U:.001,floorTopY:fl=>fl*3,isStairPartType:t=>['stair','stair-corner','stair-landing'].includes(t),isStairLandingType:t=>t==='stair-landing',isFloorLanding:()=>false,stairGroupIsLevel:()=>false,stairStepCount:()=>7,stairQuadOf:i=>i.id});['stairPartsLink','stairSourceGroupMatches','stairPartsLinkRaw','stairSnapPosition','getConnectedStairParts','stairChainParts','stairUpperSpanM','stairRiseInfo','getStairStepCount','levelStairQuadsForFloor','stairwellQuadsForFloor','walkStairSampleAt','walkLevelStairGroundAt','walkFloorLandingGroundAt','floorLandingAtMm'].forEach(n=>vm.runInContext(topLevelFunction(n),c));return c;}
const source={items:[{type:'stair',floor:1,x:1000,y:2000,w:900,d:1800,rot:270},{type:'stair-corner',floor:2,x:2000,y:3000,w:900,d:900,rot:180}]};
function decisions(s=source){return Display.candidates(s).map((c,i)=>({...c,reviewed:true,displayRiseMm:i?600:2200,displayBaseOffsetMm:i?2200:0,targetFloor:c.floor+1,partOrder:i+1}));}
test('explicit source-bound decisions retain original and record assumed height, target and fixed corner limit',()=>{const before=JSON.stringify(source),items=Display.materialize(source,decisions());assert.equal(JSON.stringify(source),before);assert.equal(items[0].x,550);assert.equal(items[0].y,1100);assert.equal(items[0].rot,270);assert.equal(items[1].sourceStairDisplay.cornerStepLimit,3);assert.equal(items[0].sourceStairDisplay.measured,false);assert.deepEqual(JSON.parse(JSON.stringify(items)),items);});
test('changed source, missing review, duplicate and invalid assumptions reject before materialization',()=>{for(const mutate of [d=>d[0].sourceSnapshot='stale',d=>d[0].reviewed=false,d=>d.push(d[0]),d=>d[0].displayRiseMm=NaN,d=>d[0].targetFloor=3]){let d=decisions();mutate(d);assert.throws(()=>Display.materialize(source,d));}assert.deepEqual(Display.materialize(source,[]),[]);});
test('display stairs use reviewed rise and offset in existing 3D renderer height path',()=>{const c=runtime(),items=Display.materialize(source,decisions());assert.equal(c.stairUpperSpanM(items[0]).riseM,2.2);assert.equal(c.stairUpperSpanM(items[1]).baseY,8.2);assert.equal(c.stairRiseInfo(items[1]).rise,.6);assert.equal(c.stairRiseInfo(items[1]).steps,3);});
test('display stairs, including malformed metadata, never cut floors, connect, snap or change walk floors',()=>{const c=runtime();for(const flag of [true,'malformed',{}]){const a={id:1,type:'stair',floor:1,stairDisplayOnly:flag,displayRiseMm:'bad'},b={id:2,type:'stair',floor:1};c.DATA.items=[a];assert.equal(c.stairPartsLink(a,b),null);assert.equal(c.stairPartsLinkRaw(a,b),null);assert.equal(c.getConnectedStairParts(a).length,1);assert.equal(c.stairChainParts(a).length,1);assert.equal(c.stairSnapPosition(a,50,60).x,50);assert.equal(c.stairwellQuadsForFloor(2).length,0);assert.equal(c.levelStairQuadsForFloor(1).length,0);assert.equal(c.walkStairSampleAt(0,0,1),null);assert.equal(c.walkLevelStairGroundAt(0,0,1),null);assert.equal(c.walkFloorLandingGroundAt(0,0,1),null);assert.equal(c.floorLandingAtMm(1,{x:0,y:0}),null);assert.equal(c.stairUpperSpanM(a).riseM,0);}});
test('ordinary user stairs continue creating original upper-floor holes',()=>{const c=runtime();c.DATA.items=[{id:99,type:'stair',floor:1}];assert.equal(c.stairwellQuadsForFloor(2)[0],99);});

const {readFileSync}=require('node:fs');
const native=JSON.parse(readFileSync(require('node:path').join(__dirname,'fixtures/registration/native-astra-three-floor.raw.json'),'utf8'));
const frozenStairs={items:native.pages.slice(0,2).flatMap(p=>p.reading.floors.flatMap(f=>f.items.filter(i=>i.type.startsWith('stair')).map(i=>({...i,floor:f.floor}))))};
function direction(s,index){return {sourceItemIndex:index,sourceSnapshot:JSON.stringify(s.items[index]),reviewed:true,flipX:false,flipY:true,evidence:'固定原図のUPと1〜12: 右廻り部から左向きに上る。既存rendererとの向き規約を照合。'};}
function portsRuntime(){const c=vm.createContext({isStairLandingType:t=>t==='stair-landing',_stairEdgeCache:null,_stairLinkCache:{},_stairLinkCacheSize:0,STAIR_LINK_GAP_MM:220,STAIR_LINK_OVERLAP_MM:300,STAIR_LINK_MIN_SPAN_MM:100});['stairPartEndMm','stairPartPortsMm','stairPartEdgesRaw','stairPartEdgesMm','stairEdgesFace','stairSourceGroupMatches','stairPartsLinkRaw','stairPartsLink','hasStairOrder','stairGroupChainInfo','stairPartShapeKey','stairPartsTouch','stairBounds2D'].forEach(n=>vm.runInContext(topLevelFunction(n),c));return c;}
test('fixed native raw straight up↔winder up conflicts on both floors; reviewed display mirror resolves without changing extraction',()=>{const original=JSON.stringify(frozenStairs),diag=Display.directionDiagnostics(frozenStairs);assert.equal(diag.length,2);assert.ok(diag.every(d=>d.portRole==='up'));const dirs=[direction(frozenStairs,0),direction(frozenStairs,2)];assert.deepEqual(Display.directionDiagnostics(frozenStairs,dirs),[]);const ds=Display.candidates(frozenStairs).map((c,i)=>({...c,reviewed:true,displayRiseMm:i%2?600:2200,displayBaseOffsetMm:i%2?0:600,targetFloor:c.floor+1,partOrder:i%2?1:2,directionDecision:dirs.find(d=>d.sourceItemIndex===i)})),items=Display.materialize(frozenStairs,ds);assert.equal(JSON.stringify(frozenStairs),original);assert.equal(items[0].rot,270);assert.equal(items[0].flipY,true);assert.equal(items[0].sourceStairDisplay.physicalConnection,false);const c=portsRuntime();for(let i=0;i<items.length;i++){assert.deepEqual(JSON.parse(JSON.stringify(c.stairPartPortsMm(items[i],0))),Display.sourcePorts(frozenStairs.items[i],dirs.find(d=>d.sourceItemIndex===i)));}for(const floor of [1,2]){const pair=items.filter(i=>i.floor===floor).map((i,n)=>({...i,id:n+1,stairDisplayOnly:false}));const before=pair.map(i=>({...i,flipY:false}));assert.equal(c.stairGroupChainInfo(before).conflicts.length,1);const after=c.stairGroupChainInfo(pair);assert.equal(after.conflicts.length,0);assert.deepEqual(Array.from(after.order,i=>i.type),['stair-corner','stair']);}});
test('direction decisions reject stale source, missing explicit review, malformed flip and duplicates',()=>{for(const edit of [d=>d.sourceSnapshot='old',d=>d.reviewed=false,d=>d.flipY='true',d=>d.evidence='']){const d=direction(frozenStairs,0);edit(d);assert.throws(()=>Display.directionDiagnostics(frozenStairs,[d]));}const d=direction(frozenStairs,0);assert.throws(()=>Display.directionDiagnostics(frozenStairs,[d,d]));});
test('pure source ports agree with actual renderer in every quarter-turn and mirror for straight and corner',()=>{const c=portsRuntime();for(const type of ['stair','stair-corner'])for(const rot of [0,90,180,270])for(const flipX of [false,true])for(const flipY of [false,true]){const s={type,floor:1,x:5000,y:4000,w:910,d:1500,rot,flipX,flipY},app={...s,x:s.x-s.w/2,y:s.y-s.d/2};assert.deepEqual(JSON.parse(JSON.stringify(c.stairPartPortsMm(app,0))),Display.sourcePorts(s));}});

test('source connection draft keeps explicit assumed span and steps, without automatic floor holes or walk transitions',()=>{
 const c=runtime();vm.runInContext(topLevelFunction('sourceStairConnectionSpan'),c);
 const it={id:5,type:'stair',floor:1,stairDisplayOnly:false,sourceStairDisplay:{floorOpeningsReviewed:false},sourceStairConnection:{version:1,targetFloor:2,baseMm:330,topMm:2760,steps:9}};c.DATA.items=[it];
 assert.equal(c.stairUpperSpanM(it).baseY,.33);assert.equal(c.stairUpperSpanM(it).topY,2.7600000000000002);assert.equal(c.getStairStepCount(it),9);
 assert.equal(c.stairwellQuadsForFloor(2).length,0);assert.equal(c.walkStairSampleAt(0,0,1),null);
 it.sourceStairConnection.topMm=NaN;assert.equal(c.sourceStairConnectionSpan(it),null);assert.equal(c.stairUpperSpanM(it).riseM,0);assert.equal(c.stairwellQuadsForFloor(2).length,0);
});
test('source provenance alone cannot authorize a full footprint opening, even after edited display flags',()=>{
 const c=runtime();for(const reviewed of [false,true]){c.DATA.items=[{id:8,type:'stair',floor:1,sourceStairDisplay:{floorOpeningsReviewed:reviewed}}];assert.equal(c.stairwellQuadsForFloor(2).length,0);assert.equal(c.walkStairSampleAt(0,0,1),null);}
});

test('connection confirmation cannot apply an obsolete source or height datum',()=>{
 for(const floor of [1,2])for(const kind of ['source','datum']){
  const parts=[{id:1},{id:2}],c=vm.createContext({ST:{selected:{}},U:.001,parts,sourceVersion:1,datumVersion:1,saves:0,alerts:[],floorTopY:f=>f===floor?.18:2.76,alert:m=>c.alerts.push(m),saveState:()=>c.saves++,updateProps(){},draw2d(){},ren:null});
  const key=()=>JSON.stringify([c.sourceVersion,c.datumVersion]);const reviewed=key();
  c.sourceStairConnectionCandidate=()=>({sourceFloor:floor,targetFloor:floor+1,parts,reviewSnapshot:key()});
  c.document={getElementById:id=>id==='source-stair-connect'?{getAttribute:()=>reviewed}:{value:id==='source-stair-base-offset'?'150':id==='source-stair-target-offset'?'0':'9'}};
  c.confirm=()=>{if(kind==='source')c.sourceVersion++;else c.datumVersion++;return true;};
  vm.runInContext(topLevelFunction('connectSelectedSourceStairDraft'),c);c.connectSelectedSourceStairDraft();
  assert.equal(c.saves,0);assert.deepEqual(parts,[{id:1},{id:2}]);assert.match(c.alerts[0],/元データまたは高さ基準/);
 }
});

test('all link entry points reject crossing source/normal group boundaries even with warm cache or legacy order',()=>{
 const c=portsRuntime(),a={id:1,type:'stair',floor:1,x:0,y:0,w:910,d:910,rot:0,stairOrder:1},b={id:2,type:'stair',floor:1,x:0,y:910,w:910,d:910,rot:0,stairOrder:2};
 assert.ok(c.stairPartsLink(a,b)); // warm the regular geometry cache
 a.sourceStairConnection={groupId:'reviewed'};
 assert.equal(c.stairPartsLink(a,b),null);assert.equal(c.stairPartsLinkRaw(a,b),null);
 b.sourceStairConnection={groupId:'other'};assert.equal(c.stairPartsLink(a,b),null);
 b.sourceStairConnection={groupId:'reviewed'};assert.ok(c.stairPartsLink(a,b));
 delete a.sourceStairConnection;delete b.sourceStairConnection;assert.ok(c.stairPartsLink(a,b));
});

test('reviewed connection lifecycle survives quarter-turn registration and source mirror with saved assumptions',()=>{
 const Registration=require('../../assets/js/plan-registration.js');
 for(const floor of [1,2])for(const mirror of [false,true])for(const quarterTurns of [0,1,2,3]){
  const raw=frozenStairs.items.slice((floor-1)*2,floor*2).map(i=>({...i,...(mirror?{x:6000-i.x,rot:(360-i.rot)%360,flipX:true}:{})}));
  const source={floors:[{floor},{floor:floor+1}],items:raw},proposal={version:1,floors:[]},pose={quarterTurns,dx:8000,dy:8000};
  const decisions=Display.candidates(source).map((d,i)=>({sourceItemIndex:i,reviewed:true,entitySnapshot:d.sourceSnapshot,sourceSnapshot:JSON.stringify(source),proposalSnapshot:JSON.stringify(proposal),displayRiseMm:i?450:1800,displayBaseOffsetMm:i?0:450,partOrder:i?1:2,targetFloor:floor+1,...(!i?{directionDecision:{sourceItemIndex:i,sourceSnapshot:d.sourceSnapshot,reviewed:true,flipX:!!raw[i].flipX,flipY:true,evidence:'isolation fixture: reviewed source direction'}}:{})}));
  const items=Display.materialize(source,decisions.map(d=>({...d,sourceSnapshot:d.entitySnapshot}))).map((it,i)=>{const p=Registration.transform({x:it.x+it.w/2,y:it.y+it.d/2},pose);return {...it,id:i+1,x:p.x-it.w/2,y:p.y-it.d/2,rot:(it.rot+quarterTurns*90)%360};});
  const c=portsRuntime();Object.assign(c,{DATA:{items,rooms:[],sceneReconstructionReports:[{sourceLocal:source,stairDisplayDecisions:decisions,proposals:proposal,poses:{[floor]:pose,[floor+1]:pose},translation:{x:0,y:0}}]},ST:{selected:items[0]},SourceStairDisplay:Display,PlanRegistration:Registration,U:.001,ren:null,floorTopY:f=>f===floor?.18:2.76,roomAtPointOnFloor:f=>({id:'room-'+f,floor:f}),roomFloorAt:f=>f===floor?.33:2.76,confirm:()=>true,alert:m=>{throw Error(m);},HISTORY:[],saveState:()=>c.HISTORY.push(JSON.stringify(c.DATA)),updateProps(){},draw2d(){},isStairPartType:t=>['stair','stair-corner','stair-landing'].includes(t)});
  for(const n of ['sourceStairConnectionCandidate','connectSelectedSourceStairDraft','sourceStairConnectionSpan','isFloorLanding','isLevelStairPart','stairPartsLinked','getConnectedStairParts','stairChainParts','stairGroupOrdered','stairGroupIsLevel','stairGroupRiseM','stairUpperSpanM','stairStepCount','getStairStepCount','stairRiseInfo'])vm.runInContext(topLevelFunction(n),c);
  const draft=c.sourceStairConnectionCandidate(c.ST.selected);assert.ok(draft,`mirror=${mirror} quarter=${quarterTurns}`);
  c.document={getElementById:id=>id==='source-stair-connect'?{getAttribute:()=>draft.reviewSnapshot}:{value:id==='source-stair-base-offset'?'150':id==='source-stair-target-offset'?'0':'9'}};
  c.connectSelectedSourceStairDraft();const saved=JSON.stringify(c.DATA);assert.equal(c.HISTORY.length,1);
  c.DATA=JSON.parse(c.HISTORY[0]);assert.ok(c.DATA.items.every(i=>i.stairDisplayOnly));c.DATA=JSON.parse(saved);
  const straight=c.DATA.items.find(i=>i.type==='stair'),corner=c.DATA.items.find(i=>i.type==='stair-corner'),sp=c.stairPartPortsMm(straight,0),cp=c.stairPartPortsMm(corner,0),sr=c.stairRiseInfo(straight),cr=c.stairRiseInfo(corner);
  assert.ok(Math.hypot(sp.down.x-cp.up.x,sp.down.y-cp.up.y)<.001);assert.ok(Math.abs(sr.base-cr.rise)<1e-9);assert.equal(c.stairUpperSpanM(straight).baseY,.33);assert.equal(c.stairUpperSpanM(straight).topY,2.7600000000000002);assert.equal(sr.steps,9);assert.equal(cr.steps,3);assert.equal(c.stairChainParts(straight).length,2);assert.equal(straight.sourceStairDisplay.sourceSnapshot,JSON.stringify(raw[0]));
 }
});
