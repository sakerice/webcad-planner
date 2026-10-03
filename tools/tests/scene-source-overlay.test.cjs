const test=require('node:test'),assert=require('node:assert/strict'),Overlay=require('../../assets/js/scene-source-overlay.js');
const f=value=>({value,status:'observed',source:'test'});
test('source overlay keeps exterior car envelope/front/color independent of catalog and ignores materialized entities',()=>{const car={id:'car',objectType:f('car'),placement:f({domain:'exterior'}),sourceFootprint:f({center:{x:0,y:0},sizeMm:{w:1800,d:4400},axisX:{x:1,y:0}}),frontDirection:f({x:0,y:-1}),appearance:{diagramColor:f('#668899')}};const report={originalIR:{objects:[car]},sourcePreview:{objects:[car]},sourceIdMap:{},translation:{x:5000,y:0}};const before=JSON.stringify(report),p=Overlay.primitives(report)[0];assert.deepEqual(p.points,[{x:-900,y:-2200},{x:900,y:-2200},{x:900,y:2200},{x:-900,y:2200}]);assert.deepEqual(p.front,{x:0,y:-1});assert.equal(p.color,'#668899');assert.equal(JSON.stringify(report),before);report.sourceIdMap.car='placed';assert.equal(Overlay.primitives(report).length,0);assert.equal(Overlay.primitives(report,true).length,1);});
test('source site overlay is a diagram primitive and never a room or wall',()=>{const e={id:'parking',role:f('parking')},report={originalIR:{siteRegions:[e]},sourcePreview:{polygons:[{id:'parking',collection:'siteRegions',outer:[{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}]}]}};const p=Overlay.primitives(report)[0];assert.equal(p.kind,'polygon');assert.equal(p.collection,'siteRegions');assert.match(p.label,/source/);});
test('registered source symbols preserve distinct floor poses, item rotation and report translation without creating stairs',()=>{
 const report={kind:'building-registration',version:1,poses:{1:{quarterTurns:1,dx:100,dy:200},2:{quarterTurns:0,dx:0,dy:455}},translation:{x:5000,y:0},deferredItems:[{type:'stair',floor:1,x:100,y:200,w:100,d:200,rot:90}],sourceLocal:{marks:[{floor:1,x:10,y:20,w:20,d:40,guess:'bed'},{floor:2,x:50,y:60,w:20,d:40,label:'DN'}]}};
 const before=JSON.stringify(report),p=Overlay.buildingPrimitives(report);
 assert.deepEqual(p[1].points,[{x:100,y:200},{x:100,y:220},{x:60,y:220},{x:60,y:200}]);
 assert.deepEqual(p[2].points,[{x:40,y:495},{x:60,y:495},{x:60,y:535},{x:40,y:535}]);
 assert.ok(Math.abs(p[0].points[0].x-200)<1e-9);assert.match(p[0].label,/階接続未確認/);assert.equal(p[1].label,'');
 const texts=[],ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},setLineDash(){},stroke(){},fill(){},fillText(s,x,y){texts.push({s,x,y});}};
 Overlay.draw(ctx,{sceneReconstructionReports:[report],items:[]},{zoom:20,panX:0,panY:0,floor:2});
 assert.equal(texts.length,1);assert.equal(texts[0].x,5043);assert.equal(JSON.stringify(report),before);
});
test('missing floor pose or malformed footprints do not invent positioned source symbols',()=>{
 assert.equal(Overlay.buildingPrimitives({sourceLocal:{marks:[{floor:9,x:0,y:0,w:20,d:30}]}}).length,0);
 assert.equal(Overlay.buildingPrimitives({deferredItems:[{floor:1,x:0,y:0,w:NaN,d:30}]}).length,0);
});
