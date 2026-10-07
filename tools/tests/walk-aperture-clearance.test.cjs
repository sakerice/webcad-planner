'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {topLevelFunction,topLevelVar}=require('./height-runtime.cjs');
const source=require('./app-source.cjs').appSource(),G=require('../../assets/js/scene-opening-geometry.js');
function host({width=750,thick=120,angle=0,reversed=false,openings=null,len=3000,vertical={bottom:0,top:3},floor=1}={}){
 const rad=angle*Math.PI/180,u={x:Math.cos(rad),y:Math.sin(rad)},n={x:-u.y,y:u.x},at=s=>({x:100+u.x*s,y:70+u.y*s});
 const a=at(reversed?len:0),b=at(reversed?0:len),wall={id:'w',floor,x1:a.x,y1:a.y,x2:b.x,y2:b.y,thick};
 const items=(openings||[{center:1500,width}]).map((o,i)=>{const result=G.compileOpening({id:'d'+i,kind:'door-opening',sourceExactGap:true,floor,hostWallId:'w',center:at(o.center),widthMm:o.width},[wall],[]);assert.equal(result.ok,true,JSON.stringify(result.diagnostics));return result.item;});
 const ctx={DATA:{walls:[wall],items},SceneOpeningGeometry:G,isOpeningItemType:t=>/^door-|^window/.test(t),isWindowLikeType:t=>/^window/.test(t),getOpeningWallInfo:it=>G.explicitHostWallInfo(it,[wall]),walkWallVerticalRangeM:()=>vertical,floorTopY:()=>0,WALK:{groundOff:0},_walkCollWalls:null,_walkCollFloor:null};vm.createContext(ctx);
 const funcs=['getWallDoorGapsMm','walkWallSolidSpansMm','buildWalkCollisionCache','walkBlockedAt','updateWalkMode'].filter(name=>source.includes('\nfunction '+name+'(')).map(topLevelFunction);
 vm.runInContext(['WALK_PLAYER_RADIUS_MM','WALK_BODY_HEIGHT_M','WALK_MAX_STEP_UP_M'].map(topLevelVar).concat(funcs).join('\n'),ctx);
 return {ctx,wall,items,point(s,d=0){const p=at(s);return {x:p.x+n.x*d,y:p.y+n.y*d};},blocked(s,d=0,f=floor,feet=undefined){const p=this.point(s,d);return ctx.walkBlockedAt(p.x,p.y,f,feet);}};
}
test('strict source cuts enforce the existing 560 mm diameter without changing opening data',()=>{
 for(const width of [450,560,750,900]){const h=host({width}),before=JSON.stringify(h.ctx.DATA);assert.equal(h.blocked(1500),width<560,'width '+width);assert.equal(JSON.stringify(h.ctx.DATA),before);const margin=width/2-280;if(margin>=0){assert.equal(h.blocked(1500+margin),false,'exact jamb contact '+width);assert.equal(h.blocked(1500+margin+.01),true,'jamb overlap '+width);}}
 const h=host({width:450});assert.equal(h.blocked(1500-225-40),true,'center 40 mm outside source gap');
});
test('finite-thickness jamb corners use circle-to-solid distance, including diagonal approaches',()=>{
 for(const thick of [60,120,400]){const h=host({width:900,thick}),jamb=1500+450,half=thick/2;assert.equal(h.blocked(jamb,half+280),false);assert.equal(h.blocked(jamb,half+279.99),true);assert.equal(h.blocked(jamb-200,half+200),false);assert.equal(h.blocked(jamb-190,half+200),true);assert.equal(h.blocked(jamb-100,half+100),true);assert.equal(h.blocked(1500,half+10),false);}
});
test('source jamb clearance is invariant under rotated and reversed wall endpoints',()=>{
 for(const angle of [0,37,90,135,180,270])for(const reversed of [false,true])for(const width of [450,560,750,900]){const h=host({angle,reversed,width});assert.equal(h.blocked(1500),width<560,JSON.stringify({angle,reversed,width}));if(width>=560){const margin=width/2-280;assert.equal(h.blocked(1500+margin),false);assert.equal(h.blocked(1500-margin),false);assert.equal(h.blocked(1500+margin+.01),true);assert.equal(h.blocked(1500-margin-.01),true);}}
});
test('finite wall endpoints are physical rectangles and endpoint openings remove only actual solids',()=>{
 const solid=host({openings:[]});assert.equal(solid.blocked(-280),false);assert.equal(solid.blocked(-279.99),true);assert.equal(solid.blocked(-200,260),false);assert.equal(solid.blocked(-190,260),true);
 for(const reversed of [false,true]){const h=host({reversed,openings:[{center:450,width:900}]});assert.equal(h.blocked(0),false,'no invented endpoint jamb');assert.equal(h.blocked(620),false);assert.equal(h.blocked(620.01),true);assert.equal(h.blocked(1500),true);}
});
test('multiple openings retain their intervening solid pier and union touching/overlapping gaps',()=>{
 const h=host({openings:[{center:750,width:750},{center:2250,width:750}]});assert.equal(h.blocked(750),false);assert.equal(h.blocked(2250),false);assert.equal(h.blocked(1500),true);assert.equal(h.blocked(1125),true);
 // Legacy plans can have overlapping cuts even though strict authoring rejects them.
 for(const gaps of [[{a:600,b:1500},{a:1500,b:2400}],[{a:600,b:1600},{a:1400,b:2400}]]){const c=host({openings:[]});c.ctx.getWallDoorGapsMm=()=>gaps;assert.equal(c.blocked(1500),false);assert.equal(c.blocked(600),true);assert.equal(c.blocked(880),false);}
});
test('height, floor, and wall visibility keep the existing controller contract',()=>{
 assert.equal(host({openings:[],vertical:{bottom:0,top:.4}}).blocked(1500),false);assert.equal(host({openings:[],vertical:{bottom:1.7,top:3}}).blocked(1500),false);assert.equal(host({openings:[],vertical:{bottom:0,top:.401}}).blocked(1500),true);const h=host({openings:[]});h.wall.hidden3D=true;assert.equal(h.blocked(1500),true);assert.equal(h.blocked(1500,0,2),false);assert.equal(h.blocked(1500,0,1),true);
});
test('invalid wall, opening, and query geometry fail closed without erasing solids',()=>{
 for(const patch of [{x1:NaN},{x2:Infinity},{thick:-1},{thick:NaN},{thick:Infinity},{thick:'120'},{thick:false},{thick:''}]){const h=host();Object.assign(h.wall,patch);assert.equal(h.blocked(1500),true);}
 for(const gaps of [[{a:NaN,b:1800}],[{a:100,b:Infinity}],[{a:1800,b:1000}],[{a:-1,b:3000}]]){const h=host();h.ctx.getWallDoorGapsMm=()=>gaps;assert.equal(h.blocked(1500),true);}
 const h=host();assert.equal(h.ctx.walkBlockedAt(NaN,0,1),true);assert.equal(h.ctx.walkBlockedAt(0,Infinity,1),true);assert.equal(h.blocked(1500,0,1,NaN),true);
});
test('actual movement retains blocked-position recovery and prevents normal narrow-gap entry',()=>{
 function mover(s,d,width){const h=host({width});const p=h.point(s,d);Object.assign(h.ctx,{U:.001,_lastWalkTick:900,isWalkView:()=>true,iMov:{},ST:{floor:1},walkStairSampleAt:()=>null,walkLevelStairGroundAt:()=>null,walkFlatGroundAt:()=>0,walkUpdateGround(){},walkApplyCamera(){},drawWalkMinimap(){},updateWalkDoors:()=>false});h.ctx.WALK={active:true,floor:1,x:p.x*.001,z:p.y*.001,yaw:0,groundOff:0,keys:{fwd:true},_mapT:1000};return h;}
 const stuck=mover(1500,0,450),z=stuck.ctx.WALK.z;assert.equal(stuck.blocked(1500),true);stuck.ctx.updateWalkMode(1000);assert.ok(stuck.ctx.WALK.z<z,'stuck recovery moves out of invalid location');
 const outside=mover(1500,500,450);for(const tick of [1000,1100,1200])outside.ctx.updateWalkMode(tick);assert.ok(Math.abs(outside.ctx.WALK.z-.37)<1e-9,'normal approach stops before narrow jamb corners');
 const clear=mover(1500,500,750);for(const tick of [1000,1100,1200])clear.ctx.updateWalkMode(tick);assert.ok(clear.ctx.WALK.z<.07,'valid source opening remains traversable');
});

test('only absent, null and legacy zero thickness retain the existing 100 mm default',()=>{
 for(const value of [undefined,null,0]){const h=host({openings:[]});h.wall.thick=value;assert.equal(h.blocked(1500,329.99),true);assert.equal(h.blocked(1500,330),false);}
});
test('actual legacy nearest-wall resolution cannot turn nonfinite thickness into a traversable default wall',()=>{
 for(const thick of [NaN,Infinity,-1,'120',false,'']){
  const h=host({width:750});delete h.items[0].openingHostWallId;delete h.items[0].openingSourceGeometry;h.wall.thick=thick;
  vm.runInContext(['getOpeningCenterCandidates','getOpeningWallInfo'].map(topLevelFunction).join('\n'),h.ctx);
  assert.equal(h.ctx.getOpeningWallInfo(h.items[0]).wall,h.wall,'legacy resolver finds coordinate-valid host');
  assert.equal(h.blocked(1500),true,'invalid legacy host thickness '+String(thick));assert.equal(h.ctx._walkCollWalls[0].solidSpans,null,'invalid host never certifies opening solids');
 }
});
