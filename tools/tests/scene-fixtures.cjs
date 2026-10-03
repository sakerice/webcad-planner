const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {topLevelFunction}=require('./height-runtime.cjs');
const root=path.join(__dirname,'../..');
const SceneCatalogue=require('../../assets/js/scene-catalogue.js');
const SceneIR=require('../../assets/js/scene-ir.js');
const SceneOpeningGeometry=require('../../assets/js/scene-opening-geometry.js');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function observed(value){return {value,status:'observed',source:'synthetic-fixture:explicit-measurement'};}
function inferred(value,reason='Reviewable catalogue choice'){return {value,status:'inferred',source:'synthetic-fixture:symbol',reason};}
function unknown(){return {value:null,status:'unknown'};}
function runtime(){
 const c=vm.createContext({console,Math,Number,Object,Array,String,Boolean,JSON,isFinite,SceneCatalogue,SceneIR,SceneOpeningGeometry,HeightModel:require('../../assets/js/height-model.js'),
   FMP_ITEMS:{},CATALOGUE_TAGS:JSON.parse(read('assets/models/tags.json')),CATALOGUE_FINISHES:JSON.parse(read('assets/models/finishes.json')),
   nextId:1000,DATA:{walls:[],rooms:[],items:[],heightDefaults:{modelVersion:2,floorThickness:180}},HISTORY:[],
   WALL_H:2400,U:.001,ST:{floor:1},ICOLORS:{car:'#d0d0dc'},
   isLightItemType:()=>false,isContextExteriorItemType:()=>false,isWindowLikeType:t=>t==='window'||t==='window-door',
   isDoorLikeOpeningType:t=>t.startsWith('door-'),isDoorPanelType:t=>t.startsWith('door-')&&t!=='door-opening',
   canSetItemElevation:()=>true,
   MODEL_FINISH_TEXTURES:[['','original'],['wood_oak','oak'],['wood_floor','wood'],['tile_floor','tile'],['stone','stone']],
   _defaultPlanPending:false,confirm:()=>true});
 c.self=c;c.window=c;
 const src=read('assets/js/app-constants.js');
 ['ISIZES','LEGACY_FMP_TYPE_MAP'].forEach(name=>{const at=src.indexOf('var '+name+' = ');const end=src.indexOf('\n};',at);vm.runInContext(src.slice(at,end+3),c);});
 ['applyCatalogueTag','applyFinishChannels','mergeFurnitureMegaManifest','getFmpItem','isFmpItemType','bestFmpType','getItemDefaultSize',
  'normalizeWindowVerticalProps','windowMaxTopMm','wallHeightMm','perFloorHeightsEnabled','planFloorHeightEntry','defaultWallHeightMmForFloor','newRoomFloorRaiseMm','clampFloorRaiseMm','mkItem','mkWall'].forEach(name=>vm.runInContext(topLevelFunction(name),c));
 for(const dir of ['furniture_mega','interior_model_0_26_1','custom'])c.mergeFurnitureMegaManifest(JSON.parse(read('assets/models/'+dir+'/manifest.json')));
 vm.runInContext(read('assets/js/plan-import.js'),c);
 c.document={getElementById:()=>({textContent:'',disabled:false,style:{},classList:{add(){},remove(){}}})};
 c.saveState=()=>c.HISTORY.push(JSON.stringify(c.DATA));
 return c;
}
function registry(){return runtime().PlanImport.sceneCatalogue();}
function fixture(){
 const f=observed;
 return {sceneVersion:2,units:'mm',coordinateSystem:'x-east-y-south-clockwise',
  walls:[
   {id:'north',floor:f(1),start:f({x:0,y:0}),end:f({x:6000,y:0}),thicknessMm:f(120)},
   {id:'divider',floor:f(1),start:f({x:0,y:3000}),end:f({x:6000,y:3000}),thicknessMm:f(120)}],
  rooms:[
   {id:'entry',floor:f(1),bounds:f({x:0,y:0,w:6000,d:3000}),name:f('玄関'),use:f('entrance'),floorRaiseMm:f(-160),floorDatum:f('target-model-finish'),floorMaterial:f('tile_floor'),floorColor:f('#bbccdd')},
   {id:'study',floor:f(1),bounds:f({x:0,y:3000,w:6000,d:3000}),name:f('書斎'),floorRaiseMm:f(0),floorDatum:f('target-model-finish'),floorMaterial:f('wood_oak')}],
  openings:[{id:'passage',floor:f(1),hostWallId:f('divider'),adjacentRoomIds:f(['entry','study']),center:f({x:3000,y:3000}),widthMm:f(1000),kind:f('door-opening'),heightMm:f(2100)}],
  furniture:[
   {id:'desk1',floor:f(1),catalogId:f('original-desk-work'),center:f({x:2500,y:4500}),sizeMm:f({w:1400,d:700}),rotationDeg:f(90),flipX:f(true),flipY:f(false),hostRoomId:f('study'),semanticExtent:f('asset'),elev:f(0),baseRoom:f('study'),finishColors:f({wood:'#123456'}),finishTextures:f({wood:'wood_oak'}),finishRoughness:f({wood:.48})},
   {id:'car1',floor:f(1),catalogId:f('car'),center:f({x:9000,y:2500}),sizeMm:f({w:2083,d:4790}),rotationDeg:f(270),hostRoomId:f(null),semanticExtent:f('asset'),color:f('#225588')}],
  connections:[{id:'circulation',rooms:f(['entry','study']),openingId:f('passage'),requiredTraversable:f(true)}]};
}
module.exports={observed,inferred,unknown,runtime,registry,fixture,read,SceneIR,SceneCatalogue,SceneOpeningGeometry};
