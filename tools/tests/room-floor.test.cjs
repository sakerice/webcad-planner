const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function context(){const c={DATA:{rooms:[]},U:.001,Number,Math,floorTopY:f=>(f-1)*2.7};vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function roomFloorOffsetMm('),html.indexOf('function updateSelectedRoomFloor(')),c);return c;}
test('legacy room height is unchanged; chosen floor buildup is clamped in mm',()=>{const c=context();assert.equal(c.roomFloorOffsetMm({}),0);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:150}),150);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:-100}),0);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:Infinity}),0);assert.equal(c.roomFloorOffsetMm({floorRaiseMm:999}),600);});
test('entry, living and flush bathroom use their own floors without lifting the storey',()=>{const c=context();c.DATA.rooms=[{floor:1,x:0,y:0,w:1000,d:1000},{floor:1,x:1000,y:0,w:2000,d:2000,floorRaiseMm:150},{floor:1,x:3000,y:0,w:1000,d:1000,floorRaiseMm:150}];assert.equal(c.roomFloorAt(1,500,500),0);assert.equal(c.roomFloorAt(1,1500,500),.15);assert.equal(c.roomFloorAt(1,3500,500),.15);assert.equal(c.floorTopY(2),2.7);});
test('smaller inset room wins and rooms on another floor cannot lift objects',()=>{const c=context();c.DATA.rooms=[{floor:1,x:0,y:0,w:5000,d:5000,floorRaiseMm:150},{floor:1,x:0,y:0,w:1000,d:1000,floorRaiseMm:0}];assert.equal(c.roomFloorAt(1,500,500),0);assert.equal(c.roomFloorAt(2,500,500),2.7);assert.equal(c.roomFloorAt(1,6000,6000),0);});
test('default plan raises first-floor interiors while keeping entrance at datum',()=>{const p=JSON.parse(fs.readFileSync('tools/tests/fixtures/raised-floor-plan.json','utf8'));const rooms=p.rooms.filter(r=>r.floor===1);assert.ok(rooms.length>1);for(const r of rooms)assert.equal(r.floorRaiseMm,r.n==='玄関'?0:150,r.n||r.id);assert.ok(rooms.some(r=>r.n==='玄関'));assert.ok(rooms.some(r=>(r.n||'').includes('浴室')));});
test('new first-floor rooms start with 150mm buildup',()=>{assert.match(html,/floor:ST.floor, floorRaiseMm:ST.floor===1\?150:0/);});
test('editing the floor preserves ceiling and pendant world heights without moving furniture',()=>{
 const r={type:"room",floor:1,x:0,y:0,w:1000,d:1000,floorRaiseMm:0};
 const c=context();Object.assign(c,{ST:{selected:r},CEILING_FIXTURE_TOP_MM:{'light-down':0},isObjectLocked:()=>false,saveState:()=>{},markDirty:()=>{},updateProps:()=>{},draw2d:()=>{},ren:null,roomAtPointOnFloor:()=>r});
 c.DATA.items=[{type:'light-down',floor:1,x:100,y:100,w:100,d:100,elev:2400},{type:'original-laundry-rail',floor:1,x:100,y:100,w:100,d:100,elev:2100},{type:'original-bed',floor:1,x:100,y:100,w:100,d:100,elev:0}];
 vm.runInContext(html.slice(html.indexOf('function updateSelectedRoomFloor('),html.indexOf('function selectedRoomFloorHtml(')),c);
 c.updateSelectedRoomFloor(150);
 assert.equal(c.DATA.items[0].elev,2250);assert.equal(c.DATA.items[1].elev,1950);assert.equal(c.DATA.items[2].elev,0);
 c.updateSelectedRoomFloor(0);assert.equal(c.DATA.items[0].elev,2400);
});
