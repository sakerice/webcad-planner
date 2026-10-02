const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const G=require('../../assets/js/scene-opening-geometry.js');
const helperPath=path.join(__dirname,'scene-opening-lifecycle.test.cjs');let helper=fs.readFileSync(helperPath,'utf8');helper=helper.slice(0,helper.indexOf("test('completed 2D drag"))+'\nmodule.exports={runtime,load,beginDrag,key};';
const host={require:createRequire(helperPath),module:{exports:{}},__dirname,console};vm.runInNewContext(helper,host);const H=host.module.exports;
function sourceRuntime(){const c=H.runtime();const r=G.compileOpening({id:7,floor:1,kind:'door-swing',hostWallId:'host',center:{x:2000,y:0},widthMm:780,swingSide:{x:0,y:1},sourceLeaf:{mechanism:'swing',pivot:{x:1610,y:60},closedAxis:{x:1,y:0},leafWidthMm:780,thicknessMm:36,angleDeg:90}},c.DATA.walls,[]);assert.equal(r.ok,true,JSON.stringify(r.diagnostics));c.ST.selected=r.item;c.DATA.items=[r.item];c.alerts=[];c.alert=s=>c.alerts.push(s);return c;}
test('source property controls are visibly disabled with explanation; movement/open state stay enabled',()=>{
const c=sourceRuntime();H.load('setPropsBodyHtml',c);
const handlers=['w','d','rot','flipX','flipY','doorHeight','openingModel','windowKind','x','y','doorOpenState','color'].map(k=>`updateSelectedProp('${k}',1)`);handlers.push('applyDoorWidthPreset(this.value)','applyWindowStdPreset(this.value)','extendWallForSlideDoor()');
const elements=handlers.map(h=>({attrs:{onchange:h},disabled:false,getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},hasAttribute(k){return k in this.attrs;}}));
const body={innerHTML:'',classList:{toggle(){}},querySelectorAll(){return elements;}};
c.setPropsBodyHtml(body,'<div>Properties</div>',c.ST.selected);
assert.match(body.innerHTML,/data-source-opening-note/);assert.match(body.innerHTML,/移動.*開閉状態/);
elements.forEach((e,i)=>{assert.equal(e.disabled,G.sourceControlBlocked(c.ST.selected,handlers[i]),handlers[i]);if(e.disabled){assert.equal(e.attrs['aria-disabled'],'true');assert.match(e.title,/未対応/);}});
const legacy={...c.ST.selected};delete legacy.openingSourceGeometry;elements.forEach(e=>e.disabled=false);c.setPropsBodyHtml(body,'legacy',legacy);assert.equal(elements.some(e=>e.disabled),false);assert.equal(body.innerHTML,'legacy');
});
test('direct shape/flip mutations and F/V shortcuts explain rejection without state or undo changes',()=>{
const c=sourceRuntime(),before=JSON.stringify(c.DATA);
for(const p of ['w','d','rot','flipX','flipY','type','openingSourceGeometry','openingHostWallId','doorHeight'])c.updateSelectedProp(p,123);
H.key(c,'f');H.key(c,'v');assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);assert.equal(c.alerts.length,11);assert.ok(c.alerts.every(s=>s===G.sourceEditMessage));
});
test('source movement and open-state editing are functional and preserve source panel geometry',()=>{
const c=sourceRuntime(),it=c.ST.selected,p=JSON.stringify(it.openingSourceGeometry),x=it.x;
c.updateSelectedProp('doorOpenState','closed');assert.equal(it.doorOpenState,'closed');assert.equal(c.HISTORY.length,1);
c.updateSelectedProp('x',x+100);assert.equal(it.x,x+100);assert.equal(it.openingHostWallId,'host');assert.equal(JSON.stringify(it.openingSourceGeometry),p);
H.key(c,'ArrowRight');assert.equal(it.x,x+110);assert.equal(c.alerts.length,0);
});
test('resize/rotation drags are rejected before save, but source translation remains functional',()=>{
const c=sourceRuntime(),before=JSON.stringify(c.DATA);
for(const handle of ['nw','e','s','rot']){H.beginDrag(c,handle);c.applyHandleDrag(100,100,{});assert.equal(c.DRAG.active,false);assert.equal(JSON.stringify(c.DATA),before);}
assert.equal(c.HISTORY.length,0);H.beginDrag(c,'move');c.applyHandleDrag(5,0,{});assert.notEqual(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,1);
});
test('source rehost never silently rotates onto reversed or perpendicular wall basis',()=>{
const c=sourceRuntime(),it=c.ST.selected;it.y+=2000;c.DATA.walls=[{id:'reverse',floor:1,x1:4000,y1:2000,x2:0,y2:2000,thick:120},{id:'vertical',floor:1,x1:2000,y1:0,x2:2000,y2:4000,thick:120}];
const before=JSON.stringify(it.openingSourceGeometry);G.rebindAfterEdit(it,c.DATA.walls,{snapToWall:true});assert.equal(it.openingHostWallId,null);assert.equal(it.rot,0);assert.equal(JSON.stringify(it.openingSourceGeometry),before);
c.DATA.walls.push({id:'same',floor:1,x1:0,y1:2000,x2:4000,y2:2000,thick:120});G.rebindAfterEdit(it,c.DATA.walls,{snapToWall:true});assert.equal(it.openingHostWallId,'same');assert.equal(it.rot,0);
});
test('source pocket panel suppresses approximate legacy backing and reverse/extend actions',()=>{
const c=sourceRuntime();c.isSlideInDoorType=t=>t==='door-pocket';c.slideDoorDirLabel=()=> '右';H.load('slideDoorPocketHtml',c);H.load('extendWallForSlideDoor',c);
c.ST.selected.type='door-pocket';c.ST.selected.openingSourceGeometry={mode:'single',direction:1,leafWidthMm:940,closedXmm:0,openXmm:940};
const html=c.slideDoorPocketHtml(c.ST.selected);assert.match(html,/<select[^>]+disabled/);assert.match(html,/940mm/);assert.doesNotMatch(html,/onclick|onchange|足りません/);
const before=JSON.stringify(c.DATA);c.extendWallForSlideDoor();assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);assert.equal(c.alerts.length,1);
});
test('door/window presets and model replacement cannot bypass source shape guard',()=>{
const c=sourceRuntime();for(const name of ['applyDoorWidthPreset','applyWindowStdPreset','applyOpeningModelToItem','canApplyOpeningPresetToItem'])H.load(name,c);
const before=JSON.stringify(c.DATA);c.applyDoorWidthPreset(900);c.applyWindowStdPreset('anything');assert.equal(c.applyOpeningModelToItem(c.ST.selected,'model'),false);assert.equal(c.canApplyOpeningPresetToItem(c.ST.selected,{kind:'door'}),false);assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.HISTORY.length,0);
});
test('source SVG exports exact shared leaf polygons under translation and host rotation; legacy symbols unchanged',()=>{
const c=sourceRuntime();for(const name of ['openingFrame','frameStr','lineTag','rectCutSvg','sourceDoorSymbolSvg','swingDoorSymbolSvg','slideDoorSymbolSvg'])H.load(name,c);
const it=c.ST.selected,lw={thin:1,mid:2},norm=points=>points.map(p=>p.map(n=>+n.toFixed(6))).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
for(const state of ['open','closed'])for(const rot of [0,90,180]){
it.doorOpenState=state;const info={x:1200,y:300,rot,wall:{thick:120}},svg=c.swingDoorSymbolSvg(it,info,lw),polys=[...svg.matchAll(/<polygon points="([^"]+)"/g)],points=polys[polys.length-1][1].split(' ').map(s=>s.split(',').map(Number));
const a=rot*Math.PI/180,leaf=G.sourcePlanGeometry(it,state==='open').leaf.map(p=>[1200+p.x*Math.cos(a)-p.y*Math.sin(a),300+p.x*Math.sin(a)+p.y*Math.cos(a)]);assert.deepEqual(norm(points),norm(leaf));if(state==='open')assert.match(svg,/A780,780/);else assert.doesNotMatch(svg,/<path/);
}
const legacy={type:'door-swing',w:780,flipX:false,flipY:false},svg=c.swingDoorSymbolSvg(legacy,{x:0,y:0,rot:0,wall:{thick:120}},lw);assert.match(svg,/M390,0 A780,780 0 0,1/);assert.equal([...svg.matchAll(/<polygon /g)].length,1);
const pocket={type:'door-pocket',w:900,doorOpenState:'open',openingSourceGeometry:{mode:'single',direction:1,leafWidthMm:940,leafThicknessMm:32,closedXmm:0,openXmm:940,leafZmm:0,pocketBoundsMm:[450,1430,-30,30]}};
const ps=c.slideDoorSymbolSvg(pocket,{x:0,y:0,rot:0,wall:{thick:120}},lw);assert.match(ps,/470,-16 1410,-16 1410,16 470,16/);assert.match(ps,/450,-30 1430,-30 1430,30 450,30/);
});
test('source placement status distinguishes detached host and edited unvalidated placement without touching provenance',()=>{
const c=sourceRuntime();H.load('setPropsBodyHtml',c);c.DATA.sceneReconstructionReports=[{source:{id:'original',center:{x:2000,y:0}},diagnostics:[{code:'import-snapshot'}]}];
const report=JSON.stringify(c.DATA.sceneReconstructionReports),it=c.ST.selected,body={innerHTML:'',classList:{toggle(){}},querySelectorAll(){return [];}};
c.setPropsBodyHtml(body,'',it);assert.match(body.innerHTML,/data-source-placement-status="import-snapshot"/);assert.equal(it.openingPlacementEdited,undefined);
c.updateSelectedProp('doorOpenState','closed');assert.equal(it.openingPlacementEdited,undefined,'state alone does not alter placement');
c.updateSelectedProp('x',it.x+100);assert.equal(it.openingPlacementEdited,true);c.setPropsBodyHtml(body,'',it);assert.match(body.innerHTML,/edited-unvalidated/);assert.match(body.innerHTML,/現在の配置.*再検証していません/);
c.updateSelectedProp('y',it.y+1000);const before=JSON.stringify(c.DATA);assert.equal(it.openingHostWallId,null);c.setPropsBodyHtml(body,'',it);assert.match(body.innerHTML,/unresolved-host/);assert.match(body.innerHTML,/取り付け先の壁が未解決/);assert.equal(JSON.stringify(c.DATA),before,'passive status never rebinds or mutates');assert.equal(JSON.stringify(c.DATA.sceneReconstructionReports),report);
const saved=JSON.parse(JSON.stringify(it));assert.equal(G.sourcePlacementStatus(saved,c.DATA.walls).edited,true);assert.equal(G.sourcePlacementStatus(saved,c.DATA.walls).detached,true);
});
