const test=require('node:test'),assert=require('node:assert/strict');
const Scene=require('../../assets/js/scene-ir-v3.js');
const base=()=>({sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],walls:[],rooms:[{id:'r',floor:{value:null,status:'unknown',unknownReason:'not-shown'},boundaryBasis:{value:'clear-face',status:'observed',source:'diagram'},shape:{value:{kind:'rectUnion',rectangles:[{x:0,y:0,w:1000,d:1000}]},status:'observed',source:'diagram'}}],openings:[],objects:[],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]});
test('current unknown-source contract keeps omission valid and rejects explicit blank without cleaning',()=>{
 assert.equal(Scene.compile(base()).valid,true);
 for(const source of ['', '   ', '\t\n']){const scene=base();scene.rooms[0].floor.source=source;const raw=JSON.stringify(scene),result=Scene.compile(scene);assert.equal(result.valid,false);assert.ok(result.diagnostics.some(x=>x.code==='missing_source'&&x.path==='scene.rooms[0].floor'));assert.equal(JSON.stringify(scene),raw);assert.equal(result.sourceScene.rooms[0].floor.source,source);assert.equal(result.sourceScene.rooms[0].floor.value,null);assert.equal(result.sourceScene.rooms[0].floor.status,'unknown');}
 const scene=base();scene.rooms[0].floor.source='diagram has no floor designation';assert.equal(Scene.compile(scene).valid,true);
});
