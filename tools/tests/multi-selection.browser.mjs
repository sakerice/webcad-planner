import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch();try{
const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://localhost:8932/');await p.waitForFunction(()=>window.ST&&window.DATA);await p.waitForSelector('#app-loading',{state:'hidden'});
await p.evaluate(()=>{DATA.items=[mkItem('table',1000,1000,0,1,800,800),mkItem('table',2600,1000,30,1,800,800),mkItem('table',1000,1000,0,2,800,800)];DATA.walls=[mkWall(1000,2800,3400,2800,1,120)];DATA.rooms=[];ST.floor=1;ST.tool='select';ST.selected=null;clearMultiSelection();ST.zoom=2;ST.panX=400;ST.panY=100;ST.snap=10;clearEditHistory();draw2d();});
async function pos(x,y){return await p.evaluate(({x,y})=>{const pt=w2c(x,y),r=canvas.getBoundingClientRect();return{x:pt.cx+r.left,y:pt.cy+r.top};},{x,y});}
async function drag(a,b){const start=await pos(...a),end=await pos(...b);await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(end.x,end.y,{steps:8});await p.mouse.up();}
await drag([400,400],[3800,3200]);assert.equal(await p.evaluate(()=>explicit2DSelection().length),3);
await drag([1400,1400],[1900,1800]);let state=await p.evaluate(()=>({x:DATA.items.map(i=>i.x),y:DATA.items.map(i=>i.y),wall:DATA.walls[0].x1,history:HISTORY.length,selected:explicit2DSelection().length}));assert.deepEqual(state,{x:[1500,3100,1000],y:[1400,1400,1000],wall:1500,history:1,selected:3});
await p.evaluate(()=>undoAction());assert.equal(await p.evaluate(()=>DATA.items[0].x),1000);assert.equal(await p.evaluate(()=>DATA.walls[0].x1),1000);await p.evaluate(()=>redoAction());assert.equal(await p.evaluate(()=>DATA.items[1].x),3100);
// Reverse marquee, then drag a wall rather than a furniture anchor.
await p.evaluate(()=>{ST.selected=null;clearMultiSelection();});await drag([4500,3700],[800,900]);assert.equal(await p.evaluate(()=>explicit2DSelection().length),3);
await p.evaluate(()=>DATA.items[1].locked=true);await drag([2400,3200],[2700,3400]);assert.equal(await p.evaluate(()=>DATA.items[0].x),1800);assert.equal(await p.evaluate(()=>DATA.items[1].x),3100);assert.equal(await p.evaluate(()=>DATA.walls[0].x1),1800);
// Empty click clears, Shift-click adds/toggles without changing geometry.
const empty=await pos(5000,5000);await p.mouse.click(empty.x,empty.y);assert.equal(await p.evaluate(()=>explicit2DSelection().length),0);
const a=await pos(2100,1900),b=await pos(3500,1800);await p.mouse.click(a.x,a.y);await p.keyboard.down('Shift');await p.mouse.click(b.x,b.y);await p.keyboard.up('Shift');assert.equal(await p.evaluate(()=>explicit2DSelection().length),2);
// Add a wall with Shift-marquee without losing the two explicitly selected items.
await p.keyboard.down('Shift');await drag([1600,3100],[4300,3600]);await p.keyboard.up('Shift');assert.equal(await p.evaluate(()=>explicit2DSelection().length),3);
// A rectangle which only intersects an item must not select it.
await drag([1600,1500],[1900,1800]);assert.equal(await p.evaluate(()=>explicit2DSelection().length),0);
// Releasing outside the canvas ends the gesture instead of leaving a stale drag.
const start=await pos(4800,4500);await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(5,5,{steps:3});await p.mouse.up();assert.equal(await p.evaluate(()=>!!DRAG.marquee||DRAG.active),false);
assert.deepEqual(errors,[]);console.log('PASS marquee both directions, rotated items, floor isolation, group drag from item/wall, locked member, one-step undo/redo, Shift selection.');
}finally{await browser.close();}
