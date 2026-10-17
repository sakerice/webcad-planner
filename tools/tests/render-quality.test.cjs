const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'(');return html.slice(start,html.indexOf('\nfunction ',start+1));}
function env(names,data){vm.createContext(data);vm.runInContext(names.map(fn).join('\n'),data);return data;}
test('camera redraws reuse shadows without clearing a pending scene edit',()=>{
 const s=env(['invalidate3D'],{_needs3DRender:false,_needs3DShadowUpdate:false});
 s.invalidate3D(false);assert.equal(s._needs3DRender,true);assert.equal(s._needs3DShadowUpdate,false);
 s.invalidate3D();s.invalidate3D(false);assert.equal(s._needs3DShadowUpdate,true);
});
test('authored metalness and metallic maps survive brightness adjustment',()=>{
 const s=env(['tameMaterialBrightness'],{LIGHT_SETTINGS:{env:.6}}),map={};
 const mat={metalness:1,metalnessMap:map,envMapIntensity:2};s.tameMaterialBrightness(mat);
 assert.equal(mat.metalness,1);assert.equal(mat.metalnessMap,map);assert.equal(mat.envMapIntensity,.6);
});
test('AO owns the beauty pass only when enabled; raw-render fallback stays available',()=>{
 let renders=0;const s=env(['render3DNow'],{ren:{},sc3:{},camExt:{},composer:{passes:[{},{}],render(){renders++;}},_n8aoPass:{enabled:true,configuration:{autoRenderBeauty:true}},applyInteriorLightBudget(){}});
 s.render3DNow();assert.equal(s.composer.passes[0].enabled,false);
 s._n8aoPass.enabled=false;s.render3DNow();assert.equal(s.composer.passes[0].enabled,true);
 s._n8aoPass=null;s.render3DNow();assert.equal(s.composer.passes[0].enabled,true);assert.equal(renders,3);
});
test('cutaway material changes refresh shadows, unchanged walls do not',()=>{
 const original={},cutaway={},mesh={material:original,userData:{cutawayWall:{original,cutaway}}};
 let cut=true;const s=env(['updateInteriorCutawayWalls'],{sc3:{traverse(f){f(mesh);}},isInt:true,camExt:{position:{x:0,y:1,z:2},rotation:{x:0,y:0,z:0}},_cutawayViewKey:'',shouldCutawayWallForCamera:()=>cut,ren:{shadowMap:{needsUpdate:false}}});
 s.updateInteriorCutawayWalls();assert.equal(mesh.material,cutaway);assert.equal(s.ren.shadowMap.needsUpdate,true);
 s.ren.shadowMap.needsUpdate=false;s.camExt.position.x=1;s.updateInteriorCutawayWalls();assert.equal(s.ren.shadowMap.needsUpdate,false);
 cut=false;s.camExt.position.x=2;s.updateInteriorCutawayWalls();assert.equal(mesh.material,original);assert.equal(s.ren.shadowMap.needsUpdate,true);
});
test('render loop still refreshes animated-door and edited-object shadows',()=>{
 let time=1000,frames=0;
 const s=env(['loop3D'],{
  requestAnimationFrame(){},camExt:{},ren:{shadowMap:{needsUpdate:false}},ST:{view:'3d-ext'},document:{hidden:false},performance:{now:()=>time},get3DFrameInterval:()=>0,
  _last3DFrameAt:0,_needs3DRender:false,_needs3DShadowUpdate:false,_lastSafety3DRenderAt:1000,
  updateWalkthroughCamera:()=>false,updateWalkMode:()=>true,GIZMO_DRAG:{active:false},WALK:{_doorsAnim:false,moving:true},
  isWalkView:()=>false,_walkCullApplied:false,orbit:null,anyWasdActive:()=>false,hasPendingGltfModels:()=>false,_dynResLow:false,_lastCam3DInputAt:1000,
  setDynamicResolution(){},updateInteriorCutawayWalls(){},render3DNow(){frames++;}
 });
 s.loop3D();assert.equal(s.ren.shadowMap.needsUpdate,false);
 s.WALK._doorsAnim=true;time+=34;s.loop3D();assert.equal(s.ren.shadowMap.needsUpdate,true);
 s.ren.shadowMap.needsUpdate=false;s.WALK._doorsAnim=false;s._needs3DShadowUpdate=true;time+=34;s.loop3D();assert.equal(s.ren.shadowMap.needsUpdate,true);assert.equal(s._needs3DShadowUpdate,false);assert.equal(frames,3);
});
// 歩く・回すなどの操作中も、部屋の隅や家具の下の陰影(AO)は消さない。操作中は AO を半分の解像度で計算し、
// 止まったら元の解像度へ戻す（操作中に AO を止めていたため、歩くたびに陰影が消えて現れ、ちらついて見えた — 利用者の指摘）
test('AO stays on while moving (half resolution), and returns to full resolution when still',()=>{
 const el={clientWidth:800,clientHeight:600};
 const s=env(['setDynamicResolution'],{ren:{setPixelRatio(){},setSize(){}},composer:{setPixelRatio(){},setSize(){}},
  _n8aoPass:{enabled:true,configuration:{halfRes:false}},_bloomPass:null,LIGHT_SETTINGS:{timeOfDay:'day'},
  navigator:{maxTouchPoints:0},isMobileLayout:()=>false,isWalkView:()=>true,WALK:{active:true},ST:{view:'3d-walk'},
  window:{devicePixelRatio:2},document:{getElementById:()=>el},_dynResLow:false});
 s.setDynamicResolution(true);assert.equal(s._n8aoPass.enabled,true);assert.equal(s._n8aoPass.configuration.halfRes,true);
 s.setDynamicResolution(false);assert.equal(s._n8aoPass.enabled,true);assert.equal(s._n8aoPass.configuration.halfRes,false);
});
