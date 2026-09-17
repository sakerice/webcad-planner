const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=require('./app-source.cjs').appSource();
// floorBaseY / floorSlabHeightMForFloor は「階の基準面」を表すだけなので、
// 従来の floorTopY スタブと同じ値になる最小の差し替えを置く(床スラブ 0)。
// localSupportTopY は実物を切り出して走らせる -- 下階に既定より高い壁が無い
// 家では floorBaseY と同値になる、というのがこのテストの前提だからである。
function context(){const c={DATA:{rooms:[],walls:[]},U:.001,Number,Math,isFinite,
  floorTopY:f=>(f-1)*2.7,floorBaseY:f=>(f-1)*2.7,floorSlabHeightMForFloor:()=>0,
  perFloorHeightsEnabled:()=>false,planFloorHeightEntry:()=>null};
 vm.createContext(c);
 vm.runInContext(html.slice(html.indexOf('function defaultFloorRaiseMmForFloor('),html.indexOf('// 階高(mm)。plan.floors')),c);
 vm.runInContext(html.slice(html.indexOf('function segmentInsideRectLengthMm('),html.indexOf('function roomFloorTopY(')),c);
 vm.runInContext(html.slice(html.indexOf('function roomFloorOffsetMm('),html.indexOf('function updateSelectedRoomFloor(')),c);return c;}
test('legacy room height is unchanged; chosen floor buildup is clamped in mm',()=>{const c=context();assert.equal(c.roomFloorOffsetMm({}),0);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:150}),150);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:-100}),0);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:Infinity}),0);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:999}),600);});
test('entry, living and flush bathroom use their own floors without lifting the storey',()=>{const c=context();c.DATA.rooms=[{floor:1,x:0,y:0,w:1000,d:1000},{floor:1,x:1000,y:0,w:2000,d:2000,floorRaiseMm:150},{floor:1,x:3000,y:0,w:1000,d:1000,floorRaiseMm:150}];assert.equal(c.roomFloorAt(1,500,500),0);assert.equal(c.roomFloorAt(1,1500,500),.15);assert.equal(c.roomFloorAt(1,3500,500),.15);assert.equal(c.floorTopY(2),2.7);});
test('smaller inset room wins and rooms on another floor cannot lift objects',()=>{const c=context();c.DATA.rooms=[{floor:1,x:0,y:0,w:5000,d:5000,floorRaiseMm:150},{floor:1,x:0,y:0,w:1000,d:1000,floorRaiseMm:0}];assert.equal(c.roomFloorAt(1,500,500),0);assert.equal(c.roomFloorAt(2,500,500),2.7);assert.equal(c.roomFloorAt(1,6000,6000),0);});
test('default plan raises first-floor interiors while keeping entrance at datum',()=>{const p=JSON.parse(fs.readFileSync('tools/tests/fixtures/raised-floor-plan.json','utf8'));const rooms=p.rooms.filter(r=>r.floor===1);assert.ok(rooms.length>1);for(const r of rooms)assert.equal(r.floorRaiseMm,r.n==='玄関'?0:150,r.n||r.id);assert.ok(rooms.some(r=>r.n==='玄関'));assert.ok(rooms.some(r=>(r.n||'').includes('浴室')));});
test('new first-floor rooms start with 150mm buildup',()=>{
 assert.match(html,/floor:ST\.floor, floorRaiseMm:newRoomFloorRaiseMm\(ST\.floor\)/);
 // 既定値を触っていないプランでは 1階=150 / 上階=0 のまま(サイドメニューの
 // 「床の高さ」を設定したときだけその値に従う)。
 const c={DATA:{floors:{},heightDefaults:{}},Number,Math,isFinite,
   clampFloorRaiseMm:v=>Math.max(0,Math.min(600,Math.round(Number(v)||0))),
   perFloorHeightsEnabled:()=>false,planFloorHeightEntry:()=>null};
 vm.createContext(c);
 vm.runInContext(html.slice(html.indexOf('function newRoomFloorRaiseMm('),html.indexOf('// 既定値を変えたとき')),c);
 assert.equal(c.newRoomFloorRaiseMm(1),150);
 assert.equal(c.newRoomFloorRaiseMm(2),0);
 c.DATA.heightDefaults={floorRaise:120,floorRaiseSet:true};
 assert.equal(c.newRoomFloorRaiseMm(1),120);
});
test('editing the floor preserves ceiling and pendant world heights without moving furniture',()=>{
 const r={type:"room",floor:1,x:0,y:0,w:1000,d:1000,floorRaiseMm:0};
 const c=context();Object.assign(c,{ST:{selected:r},CEILING_FIXTURE_TOP_MM:{'light-down':0},isObjectLocked:()=>false,saveState:()=>{},markDirty:()=>{},updateProps:()=>{},draw2d:()=>{},ren:null,roomAtPointOnFloor:()=>r,
   // 床上げでは天井は動かない。追従の規則(followRoomCeiling)が世界での高さを
   // 保つことを測るので、天井の高さ自体は固定のスタブでよい。
   CEILING_FINISH_M:0.012,roomCeilingHeightM:()=>2.7,U:0.001});
 c.DATA.items=[{type:'light-down',floor:1,x:100,y:100,w:100,d:100,elev:2400},{type:'original-laundry-rail',floor:1,x:100,y:100,w:100,d:100,elev:2100},{type:'original-bed',floor:1,x:100,y:100,w:100,d:100,elev:0}];
 vm.runInContext([
   // 仕上げ厚は ceilingFinishThicknessM が決める(高さモデルv2では0)。
   // roomCeilingElevationMm が呼ぶので、その手前から切り出す。
   html.slice(html.indexOf('function ceilingFinishThicknessM('),html.indexOf('function ceilingFinishElevationMm(')),
   html.slice(html.indexOf('function shiftRoomCeilingFixtures('),html.indexOf('// 天井が動きうる書き換えを包む')),
   html.slice(html.indexOf('function followRoomCeiling('),html.indexOf('function contextStoryHeightMm(')),
   html.slice(html.indexOf('function updateSelectedRoomFloor('),html.indexOf('function selectedRoomFloorHtml('))
 ].join('\n'),c);
 c.updateSelectedRoomFloor(150);
 assert.equal(c.DATA.items[0].elev,2250);assert.equal(c.DATA.items[1].elev,1950);assert.equal(c.DATA.items[2].elev,0);
 c.updateSelectedRoomFloor(0);assert.equal(c.DATA.items[0].elev,2400);
});
