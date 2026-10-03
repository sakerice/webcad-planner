const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {topLevelFunction}=require('./height-runtime.cjs');
const c=vm.createContext({FLOOR_PBR_STEM:{tile_floor:'tile',wood_floor:'wood',wood_oak:'oak'}});
for(const n of ['defaultRoomFloorMaterialKey','roomFloorMaterialKey'])vm.runInContext(topLevelFunction(n),c);
test('printed unusual entry name retains semantic finish, without inventing an elevation',()=>{
 const room={n:'KB置き場',use:'entry',floorRaiseMm:180},before=JSON.stringify(room);
 assert.equal(c.defaultRoomFloorMaterialKey(room),'tile_floor');assert.equal(JSON.stringify(room),before);
 assert.equal(c.defaultRoomFloorMaterialKey({n:'趣味部屋②',use:'other'}),'wood_floor');
 assert.equal(c.defaultRoomFloorMaterialKey({n:'浴室',use:'bath'}),'tile_floor');
});
test('explicit finish choices still override semantic display defaults',()=>{
 const room={n:'KB置き場',use:'entry',floorMaterial:'wood_oak'};
 assert.equal(c.roomFloorMaterialKey(room)||c.defaultRoomFloorMaterialKey(room),'wood_oak');
 room.texture='tile_floor';assert.equal(c.roomFloorMaterialKey(room),'tile_floor');
});
test('stairs matching a room retain semantic default and explicit finish/color/texture precedence',()=>{
 const calls=[],room={n:'KB置き場',use:'entry',floorColor:'#123456'};
 const ctx=vm.createContext({FLOOR_PBR_STEM:{tile_floor:'tile',wood_floor:'wood',wood_oak:'oak'},U:.001,roomAtPointOnFloor:()=>room,makeRoomFloorMaterial:r=>{calls.push(r);return {key:ctx.roomFloorMaterialKey(r)||ctx.defaultRoomFloorMaterialKey(r),color:r.floorColor,texture:r.texture};}});
 for(const n of ['defaultRoomFloorMaterialKey','roomFloorMaterialKey','stairTreadFloorMaterial'])vm.runInContext(topLevelFunction(n),ctx);
 assert.equal(ctx.stairTreadFloorMaterial({stairFloorMaterial:'match'},1,1).key,'tile_floor');
 room.floorMaterial='wood_oak';assert.equal(ctx.stairTreadFloorMaterial({stairFloorMaterial:'match'},1,1).key,'wood_oak');
 room.texture='tile_floor';const material=ctx.stairTreadFloorMaterial({stairFloorMaterial:'match'},1,1);assert.equal(material.key,'tile_floor');assert.equal(material.color,'#123456');
 room.texture='uploaded-texture';assert.equal(ctx.stairTreadFloorMaterial({stairFloorMaterial:'match'},1,1).texture,'uploaded-texture');
 assert.equal(calls.at(-1).use,'entry');
});
