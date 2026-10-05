'use strict';
const fs=require('node:fs'),vm=require('node:vm');
class Vector3{constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}copy(v){return this.set(v.x,v.y,v.z);}clone(){return new Vector3(this.x,this.y,this.z);}toArray(){return [this.x,this.y,this.z];}fromArray(a){return this.set(...a);}}
const clone=value=>JSON.parse(JSON.stringify(value)),fixture=(name,north=0)=>({walls:[],items:[],rooms:[{id:name,floor:1,x:0,y:0,w:4000,d:3000,n:name}],northDeg:north,autoRoomLights:false});
function runtime(){
 const noop=()=>{},nodes=new Map(),events=new Map(),frames=[];let fail=null;
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',classList:{toggle:noop}});return nodes.get(id);},querySelector:()=>null,documentElement:{classList:{add:noop}},addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);}};
 const ctx={console:{warn:noop},document,window:null,parent:null,THREE:{Vector3},ILABELS:{},EDITOR_PANE:'pane-A',ST:{view:'3d-int',floor:1,showGrid:true,showDim:true,snap:10,zoom:1,panX:60,panY:60,multiSelected:[],selected:null,ceilingView:false},
  DATA:fixture('A',45),LIGHT_SETTINGS:{timeOfDay:'day',hemi:.4,sun:1.1,ambient:.1,room:.22,exposure:1.18,env:.62,sunSim:true,hour:13,season:'equinox',northDeg:45},DRAG:{},HISTORY:['A-history'],REDO_HISTORY:['A-redo'],DIRTY:false,WALL_H:2400,nextId:1,_jsonImportRequest:0,_defaultPlanPending:false,WALK:{active:false},U:.001,
  camExt:{position:new Vector3(1,8,4),up:new Vector3(0,1,0),fov:50,aspect:1,updateProjectionMatrix:noop},orbit:{target:new Vector3(1,0,1),minPolarAngle:0,maxPolarAngle:Math.PI,update:noop},ren:{},sc3:null,composer:null,_pmremGen:null,_envRT:null,_modelCache:{},_texCache:{},
  comparisonCatalogueReady:Promise.resolve(),threeModulesReady:true,requestAnimationFrame:fn=>frames.push(fn),setTimeout,clearTimeout,addEventListener:noop,removeEventListener:noop,
  render3DNow:noop,draw2d(){if(fail==='draw'){fail=null;throw Error('synthetic draw fault');}},rebuild3D(){if(fail==='build'){fail=null;throw Error('synthetic build fault');}},
  updateProps:noop,syncNorthUi:noop,syncHeightDefaultsUI:noop,renderSaveButtonState:noop,invalidate3D:noop,clearDirty(){ctx.DIRTY=false;},
  toggleGrid(){ctx.ST.showGrid=!ctx.ST.showGrid;},toggleDim(){ctx.ST.showDim=!ctx.ST.showDim;},syncLightPanelUi:noop,updateLightSetting(k,v){ctx.LIGHT_SETTINGS[k]=v;},flushSunHour:noop,
  stageJsonImport:text=>({data:JSON.parse(text)}),applyJsonImport(staged){ctx.DATA=staged.data;ctx.LIGHT_SETTINGS.northDeg=ctx.DATA.northDeg;},serializeDataSnapshot:()=>JSON.stringify(ctx.DATA),
  setView(v){ctx.ST.view=v;ctx.camExt.position.set(1,8,4);ctx.orbit.target.set(1,0,1);},onFloorChange(f){ctx.ST.floor=Number(f);},setTool(t){ctx.ST.tool=t;},clearMultiSelection(){ctx.ST.multiSelected=[];},resetView:noop,
  floorBaseY:()=>0,roomCeilingHeightM:()=>2.4,AssetPackPicker:{getSelection:()=>null,setSelection:noop},applyStashedCamera(c){ctx.camExt.position.fromArray(c.pos);ctx.orbit.target.fromArray(c.target);},walkApplyCamera:noop};
 for(const name of ['applyHandleDrag','updateSelectedProp','removeObjectRef','delSel','apply3DGizmoDrag','stashCurrentCamera','pasteCopiedObject'])ctx[name]=noop;
 ctx.window=ctx;ctx.parent={ParallelEditors:{activeId:'pane-A',modelPool:{resources:new Set()},changed(id,options){ctx.notifications.push({id,...options});}}};ctx.notifications=[];
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/js/ceiling-designer.js','utf8'),ctx);vm.runInContext(fs.readFileSync('assets/js/parallel-editors.js','utf8'),ctx);
 return {ctx,editor:ctx.EditorPane,nodes,fail(kind){fail=kind;},emit(name){for(const f of events.get(name)||[])f({});while(frames.length)frames.shift()();}};
}
module.exports={runtime,fixture,clone};
