const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8').match(/function onFloorChange\(v\)\{[\s\S]*?\n\}/)[0];
test('floor switch retires old property controls while preserving plan and editing history',()=>{
 const saved={items:[{id:'sofa',floor:2,x:9000}],walls:[],rooms:[]},history=[{items:[]}],redo=[saved];
 const body={textContent:'previous sofa controls'},panel={classList:{remove(name){assert.equal(name,'show');}}},floorLabel={};let draw=0,multi=0,pick=0;
 const ctx={DATA:saved,HISTORY:history,REDO:redo,DIRTY:true,ST:{floor:2,selected:saved.items[0]},DRAG:{active:true},clearMultiSelection(){multi++},resetPickCycle(){pick++},draw2d(){draw++},document:{getElementById:id=>({'props':panel,'props-body':body,'st-floor':floorLabel})[id]}};
 vm.runInNewContext(source+';onFloorChange(1)',ctx);
 assert.equal(ctx.ST.floor,1);assert.equal(ctx.ST.selected,null);assert.equal(body.textContent,'');assert.equal(ctx.DRAG.active,false);assert.equal(floorLabel.textContent,'フロア:1F');assert.equal(draw,1);assert.equal(multi,1);assert.equal(pick,1);assert.equal(ctx.DATA,saved);assert.equal(ctx.HISTORY,history);assert.equal(ctx.REDO,redo);assert.equal(ctx.DIRTY,true);assert.equal(saved.items[0].x,9000);
});
