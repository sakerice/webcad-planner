const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const G=require('../../assets/js/scene-opening-geometry.js');
const source=require('./app-source.cjs').appSource();
const clone=o=>JSON.parse(JSON.stringify(o));
const wall=(id='host',y=0,floor=1)=>({id,floor,x1:0,y1:y,x2:4000,y2:y,thick:120});
function importedOpening(w=wall()){
  const r=G.compileOpening({id:7,floor:w.floor,kind:'door-swing',hostWallId:w.id,
    center:{x:2000,y:w.y1},widthMm:780,hinge:{x:1610,y:w.y1},latch:{x:2390,y:w.y1},swingSide:{x:0,y:1}},[w],[]);
  assert.equal(r.ok,true,JSON.stringify(r.diagnostics));return r.item;
}
function runDeclaration(start,scope){
  const at=source.indexOf(start); assert.notEqual(at,-1,start);
  const lines=source.slice(at).split('\n');
  let code='';
  for(const line of lines){
    code+=line+'\n';
    try{new vm.Script(code);}catch{continue;}
    vm.runInContext(code,scope);return;
  }
  assert.fail('Could not extract '+start);
}
function load(name,scope){runDeclaration('function '+name+'(',scope);}
function runtime(){
  const callbacks={},noop=()=>{};
  const c={SceneOpeningGeometry:G,DATA:{walls:[wall(),wall('other',2000)],items:[],rooms:[]},
    ST:{selected:null,multiSelected:[],floor:1,tool:'select',snap:10,zoom:1,panX:0,panY:0},
    DRAG:{active:false,saved:false,group:null},GIZMO_DRAG:{},nextId:100,CLIPBOARD:null,
    HISTORY:[],REDO_HISTORY:[],HISTORY_LIMIT:50,ren:null,orbit:null,WALKTHROUGH:null,
    isOpeningItemType:t=>G.supportedKinds.includes(t),isWindowLikeType:t=>t==='window'||t==='window-door',
    isObjectLocked:o=>!!o.locked,isStairPartType:()=>false,isLightItemType:()=>false,
    isMobileLayout:()=>false,isShiftLike:()=>false,isWalkView:()=>false,
    snapV:v=>v,snapRectOriginToGrid:(x,y)=>({x,y}),
    updateProps:noop,draw2d:noop,build3D:noop,rebuild3D:noop,queueSharedSync:noop,
    markDirty:noop,sharedRememberEditTargets:noop,sharedForceFullSync:noop,
    syncNorthFromPlan:noop,ensureFloorMetadata:noop,syncExteriorWallSettings:noop,
    advancePickCycleOnClick:noop,isAppearanceColorInputActive:()=>false,
    getGizmoDragBasis:()=>({sx:0,sy:1,pxPerM:50}),U:.001,
    canMoveRefVertically3D:()=>false,applyPartial3DMove:()=>false,
    canvas:{addEventListener:(name,callback)=>{callbacks[name]=callback;}},
    window:{addEventListener:(name,callback)=>{callbacks['window:'+name]=callback;}},
    document:{getElementById:()=>({classList:{remove:noop,contains:()=>false}})}};
  vm.createContext(c);
  for(const name of ['isPlanImportDialogOpen','serializeDataSnapshot','pushHistorySnapshot','saveState','explicit2DSelection','clearMultiSelection',
    'getOpeningWallInfo','getOpeningCenterCandidates','getItemDisplayPose','getWallDoorGapsMm',
    'applyHandleDrag','apply3DGizmoDrag','finish3DGizmoDrag','getSelectedCollectionKind','copySelectedObject','pasteCopiedObject',
    'updateSelectedProp','removeObjectRef','undoAction','redoAction','restoreHistorySnapshot'])load(name,c);
  runDeclaration("canvas.addEventListener('mouseup',function(){",c);
  runDeclaration("window.addEventListener('keydown', function(e){",c);
  c.callbacks=callbacks;
  c.DATA.items=[importedOpening(c.DATA.walls[0])];c.ST.selected=c.DATA.items[0];
  return c;
}
function beginDrag(c,handle='move',group=null){
  Object.assign(c.DRAG,{active:true,saved:false,handle,startCX:0,startCY:0,origItem:clone(c.ST.selected),group});
}
function key(c,key){c.callbacks['window:keydown']({key,target:{tagName:'BODY'},preventDefault(){}});}

test('completed 2D drag rebinds imported opening; raw movement and passive rendering never do',()=>{
  const c=runtime(),it=c.ST.selected,before=JSON.stringify(c.DATA);
  beginDrag(c);c.applyHandleDrag(0,110,{}); // raw centre y=2200; next wall is y=2000
  assert.equal(it.openingHostWallId,'host');assert.equal(c.getOpeningWallInfo(it),null);
  const moving=JSON.stringify(c.DATA);c.getItemDisplayPose(it);assert.equal(JSON.stringify(c.DATA),moving);
  c.callbacks.mouseup();
  assert.equal(it.openingHostWallId,'other');assert.equal(it.y+it.d/2,2000);
  assert.equal(c.getOpeningWallInfo(it).wall,c.DATA.walls[1]);
  assert.equal(c.getWallDoorGapsMm(c.DATA.walls[0]).length,0);assert.equal(c.getWallDoorGapsMm(c.DATA.walls[1]).length,1);
  assert.equal(c.HISTORY.length,1);assert.equal(c.HISTORY[0],before,'Undo snapshot precedes all edits');
});

test('drop away from all walls saves detached null; later rendering/loading cannot guess a host',()=>{
  const c=runtime(),it=c.ST.selected;beginDrag(c);c.applyHandleDrag(0,300,{});c.callbacks.mouseup();
  assert.equal(it.openingHostWallId,null);assert.equal(it.y+it.d/2,6000);
  c.DATA.walls.push(wall('newly-near',6000));
  const before=JSON.stringify(c.DATA);for(let i=0;i<3;i++)assert.equal(c.getOpeningWallInfo(it),null);
  assert.equal(JSON.stringify(c.DATA),before);
  c.DATA=JSON.parse(c.serializeDataSnapshot());
  assert.equal(c.DATA.items[0].openingHostWallId,null);assert.equal(c.getOpeningWallInfo(c.DATA.items[0]),null);
  assert.equal(G.explicitHostWallInfo(c.DATA.items[0],[wall(null,6000)]),null,'null is never a wall ID');
});

test('a later explicit move recovers a detached opening',()=>{
  const c=runtime(),it=c.ST.selected;it.openingHostWallId=null;it.y=6000-it.d/2;
  beginDrag(c);c.applyHandleDrag(0,-210,{});c.callbacks.mouseup();
  assert.equal(it.openingHostWallId,'other');assert.equal(it.y+it.d/2,2000);
});

test('wall-plus-opening group move preserves the exact host, coordinates and swing flags',()=>{
  const c=runtime(),it=c.ST.selected,w=c.DATA.walls[0],flags=[it.flipX,it.flipY];
  // A competing wall at the destination may occur earlier in DATA.walls.
  c.DATA.walls.unshift(wall('competing',500));
  beginDrag(c,'move',[{obj:it,orig:clone(it)},{obj:w,orig:clone(w)}]);
  c.applyHandleDrag(25,25,{});c.callbacks.mouseup();
  assert.equal(it.openingHostWallId,'host');assert.equal(it.x+it.w/2,2500);assert.equal(it.y+it.d/2,500);
  assert.equal(c.getOpeningWallInfo(it).wall,w);assert.deepEqual([it.flipX,it.flipY],flags);
});

test('opening-only group movement chooses new explicit hosts after all positions have changed',()=>{
  const c=runtime(),it=c.ST.selected,second={...clone(it),id:8,x:it.x+1000};c.DATA.items.push(second);
  beginDrag(c,'move',[{obj:it,orig:clone(it)},{obj:second,orig:clone(second)}]);
  c.applyHandleDrag(0,105,{});c.callbacks.mouseup();
  for(const door of [it,second]){assert.equal(door.openingHostWallId,'other');assert.equal(door.y+door.d/2,2000);}
});

test('locked/no-op selection cannot rebind an already unresolved opening',()=>{
  const c=runtime(),it=c.ST.selected;it.openingHostWallId='deleted';beginDrag(c);
  c.applyHandleDrag(0,0,{});c.callbacks.mouseup();assert.equal(it.openingHostWallId,'deleted');
  it.locked=true;beginDrag(c);c.applyHandleDrag(0,100,{});c.callbacks.mouseup();
  assert.equal(it.openingHostWallId,'deleted');assert.equal(it.y+it.d/2,0);
});

test('3D gizmo drag commits a new host only on release, with an undo snapshot',()=>{
  const c=runtime(),it=c.ST.selected,before=JSON.stringify(c.DATA);
  Object.assign(c.GIZMO_DRAG,{active:true,saved:false,axis:'z',ref:it,orig:clone(it),startX:0,startY:0,partialRoots:null,
    group:[{obj:it,orig:clone(it)}]});
  c.apply3DGizmoDrag({clientX:0,clientY:110});assert.equal(it.openingHostWallId,'host');
  assert.equal(c.getOpeningWallInfo(it),null);c.finish3DGizmoDrag();
  assert.equal(it.openingHostWallId,'other');assert.equal(it.y+it.d/2,2000);assert.equal(c.HISTORY[0],before);
});

test('repeated keyboard nudges detach without resetting accumulated coordinates, and bind only exact destination',()=>{
  const c=runtime(),it=c.ST.selected;
  for(let i=1;i<=200;i++){key(c,'ArrowDown');assert.equal(it.y+it.d/2,i*10);}
  assert.equal(it.openingHostWallId,'other');assert.equal(c.getOpeningWallInfo(it).wall,c.DATA.walls[1]);
  key(c,'ArrowDown');assert.equal(it.openingHostWallId,null);assert.equal(it.y+it.d/2,2010);
});

test('numeric coordinate/rotation/size edits preserve inputs and explicit detachment',()=>{
  const c=runtime(),it=c.ST.selected,before=JSON.stringify(c.DATA);
  c.updateSelectedProp('y',it.y+25);assert.equal(it.y+it.d/2,25);assert.equal(it.openingHostWallId,null);assert.equal(c.HISTORY[0],before);
  c.updateSelectedProp('y',2000-it.d/2);assert.equal(it.openingHostWallId,'other');
  c.updateSelectedProp('rot',90);assert.equal(it.rot,90);assert.equal(it.openingHostWallId,null);
  c.updateSelectedProp('rot',0);assert.equal(it.openingHostWallId,'other');
  c.updateSelectedProp('w',5000);assert.equal(it.w,5000);assert.equal(it.openingHostWallId,null);
});

test('appearance-only property edits do not repair or rebind invalid hosts',()=>{
  const c=runtime(),it=c.ST.selected;it.openingHostWallId='removed';
  c.updateSelectedProp('color','#123456');assert.equal(it.openingHostWallId,'removed');
  c.updateSelectedProp('flipX',true);assert.equal(it.openingHostWallId,'removed');
});

test('opening-alone copy/paste stores a fresh placement without changing the source binding',()=>{
  const c=runtime(),it=c.ST.selected,before=JSON.stringify(c.DATA);
  assert.equal(c.copySelectedObject(),true);assert.equal(JSON.stringify(c.DATA),before);
  assert.equal(c.pasteCopiedObject(),true);const cp=c.ST.selected;
  assert.notEqual(cp.id,it.id);assert.equal(cp.openingHostWallId,'host');
  assert.equal(cp.x+cp.w/2,2200);assert.equal(cp.y+cp.d/2,0);assert.equal(c.HISTORY[0],before);
  assert.equal(it.x+it.w/2,2000);assert.equal(it.openingHostWallId,'host');
});

test('cross-floor paste binds only destination floor and remains detached if it has no wall',()=>{
  const c=runtime();c.copySelectedObject();c.ST.floor=2;c.pasteCopiedObject();
  assert.equal(c.ST.selected.floor,2);assert.equal(c.ST.selected.openingHostWallId,null);
  c.DATA.walls.push(wall('floor2',0,2));c.CLIPBOARD.count=0;c.pasteCopiedObject();
  assert.equal(c.ST.selected.openingHostWallId,'floor2');assert.equal(c.getOpeningWallInfo(c.ST.selected).wall.floor,2);
});

test('actual clipboard is single-selection: multiselection does not clone/remap a group',()=>{
  const c=runtime();c.ST.multiSelected=[c.DATA.walls[0]];c.copySelectedObject();c.pasteCopiedObject();
  assert.equal(c.DATA.walls.length,2);assert.equal(c.DATA.items.length,2);
  assert.equal(c.CLIPBOARD.kind,'item');assert.equal(c.ST.selected.openingHostWallId,'host');
});

test('host deletion and endpoint reversal never redirect a passive opening to another wall',()=>{
  const c=runtime(),it=c.ST.selected,host=c.DATA.walls[0];c.DATA.walls.push(wall('nearby',0));
  const before=JSON.stringify(c.DATA);c.removeObjectRef(host);
  assert.equal(c.HISTORY[0],before);assert.equal(it.openingHostWallId,'host');assert.equal(c.getOpeningWallInfo(it),null);
  c.ST.selected=it;beginDrag(c);c.applyHandleDrag(5,0,{});c.callbacks.mouseup();
  assert.equal(it.openingHostWallId,'nearby');
  const newHost=c.getOpeningWallInfo(it).wall,flags=[it.flipX,it.flipY];
  [newHost.x1,newHost.x2]=[newHost.x2,newHost.x1];
  assert.equal(c.getOpeningWallInfo(it),null);assert.deepEqual([it.flipX,it.flipY],flags);
});

test('undo and redo restore source and edited host/pose without rebinding',()=>{
  const c=runtime(),before=c.serializeDataSnapshot();beginDrag(c);c.applyHandleDrag(0,110,{});c.callbacks.mouseup();
  const after=c.serializeDataSnapshot();c.undoAction();assert.equal(c.serializeDataSnapshot(),before);
  assert.equal(c.getOpeningWallInfo(c.DATA.items[0]).wall.id,'host');
  c.redoAction();assert.equal(c.serializeDataSnapshot(),after);assert.equal(c.getOpeningWallInfo(c.DATA.items[0]).wall.id,'other');
});

test('legacy openings retain existing placement and clipboard semantics without adding binding fields',()=>{
  const c=runtime(),it=c.ST.selected;delete it.openingHostWallId;
  beginDrag(c);c.applyHandleDrag(0,110,{});c.callbacks.mouseup();
  assert.equal(it.y+it.d/2,2200);assert.equal(it.openingHostWallId,undefined);assert.equal(c.getOpeningWallInfo(it).wall.id,'other');
  c.copySelectedObject();c.pasteCopiedObject();assert.equal(c.ST.selected.openingHostWallId,undefined);
});

test('drop rejects oversized, duplicate-ID, wrong-floor and invalid wall candidates without fallback',()=>{
  for(const walls of [[wall('short')],[wall('dup'),wall('dup')],[wall('up',0,2)],[{...wall(),thick:0}]]){
    const it=importedOpening();it.openingHostWallId=null;it.y+=50;
    if(walls[0].id==='short')walls[0].x2=700;
    G.rebindAfterEdit(it,walls,{snapToWall:true});assert.equal(it.openingHostWallId,null);
  }
});

test('actual save/load and export pipelines retain original Scene IR reports independently of live opening edits',async()=>{
  const c=runtime();let persisted=null,exported=null;
  function request(result,write){
    const r={result};queueMicrotask(()=>{if(write)write();if(r.onsuccess)r.onsuccess();});return r;
  }
  const store={put:json=>request(undefined,()=>{persisted=json;}),get:()=>request(persisted),getKey:()=>request(persisted?'webcad-plan-v1':undefined)};
  const db={objectStoreNames:{contains:()=>true},transaction:()=>({objectStore:()=>store})};
  c.indexedDB={open:()=>request(db)};c.localStorage={removeItem(){},getItem:()=>null};
  runDeclaration('var StorageAdapter = (function(){',c);
  const scene=require('./scene-fixtures.cjs'),importer=scene.runtime();
  importer.PlanImport.stageSceneIR(scene.fixture());importer.applyPlanImport();
  c.DATA=clone(importer.DATA);
  const report=JSON.stringify(c.DATA.sceneReconstructionReports);
  assert.ok(c.DATA.sceneReconstructionReports[0].originalIR);
  for(const field of ['evidence','defaults','unresolvedEntities','reviewDecisions','sourceIdMap','translation'])
    assert.ok(Object.hasOwn(c.DATA.sceneReconstructionReports[0],field),field);
  const bound=c.DATA.items.find(it=>it.openingHostWallId!==undefined);
  const second={...clone(bound),id:9999,openingHostWallId:null,_texObj:{runtime:true}};
  c.DATA.items.push(second);c.ST.selected=second;
  c.updateSelectedProp('y',second.y+100);
  assert.equal(JSON.stringify(c.DATA.sceneReconstructionReports),report,'Live edit never rewrites original evidence');
  const original=JSON.stringify(c.DATA);
  for(const name of ['normalizeLegacyFurnitureItems','ensureExteriorWallSettings','ensureInteriorWallSettings','ensureRoofAppearance',
    'ensureHeightDefaults','syncHeightDefaultsUI','captureViewState','restoreViewState','setSaveButtonBusy','clearDirty','clearEditHistory'])c[name]=()=>{};
  c.SHARED={roomId:null};c.alert=message=>assert.fail(message);c.console=console;
  load('ensureObjectIds',c);load('exportPlan',c);
  runDeclaration('async function savePlanToStorage(){',c);runDeclaration('async function loadPlanFromStorage(){',c);
  c.downloadJsonFile=(json,filename)=>{assert.equal(filename,'plan.json');exported=JSON.parse(json);};
  await c.savePlanToStorage();const loaded=await c.StorageAdapter.load();
  assert.equal(JSON.stringify(c.DATA),original,'Save pipeline does not modify live geometry/evidence');
  assert.equal(JSON.stringify(loaded.sceneReconstructionReports),report);
  assert.equal(loaded.items.find(it=>it.id===bound.id).openingHostWallId,bound.openingHostWallId);
  assert.equal(loaded.items.find(it=>it.id===9999).openingHostWallId,null);
  assert.equal(loaded.items.find(it=>it.id===9999)._texObj,undefined);
  c.DATA={walls:[],items:[],rooms:[]};assert.equal(await c.loadPlanFromStorage(),true);
  assert.equal(JSON.stringify(c.DATA.sceneReconstructionReports),report);
  assert.ok(c.getOpeningWallInfo(c.DATA.items.find(it=>it.id===bound.id)));
  assert.equal(c.getOpeningWallInfo(c.DATA.items.find(it=>it.id===9999)),null);
  c.exportPlan();assert.equal(JSON.stringify(exported.sceneReconstructionReports),report);
});
