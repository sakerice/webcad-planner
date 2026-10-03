/* Explicit loopback-only harness. Native rendering returns metadata; image capture is external. */
(function(root){
 'use strict';
 if(!['127.0.0.1','localhost'].includes(location.hostname)||new URLSearchParams(location.search).get('internalAPI')!=='1'||root.parent!==root)return;
 let previewId=null,activeJob=null,ownerSignal=null;const owned=new Set();
 const clone=v=>JSON.parse(JSON.stringify(v));
 function error(code,message){const e=new Error(message);e.code=code;return e;}
 function hostView(){return {view:ST.view,floor:ST.floor,twoD:{zoom:ST.zoom,panX:ST.panX,panY:ST.panY},camera:camExt&&orbit?{pos:camExt.position.toArray(),target:orbit.target.toArray(),fov:camExt.fov,walk:null}:null};}
 function readScene(planId){
  if(typeof SHARED!=='undefined'&&SHARED.roomId)throw Error('Internal preview is unavailable in shared sessions');
  const body=PlanImport.state.result;
  if(planId==='host-draft'){if(!body?.sceneIR||body.sceneOptions?.sourceInvalidated)return null;return {snapshot:JSON.parse(serializeDataSnapshot()),source:body.sceneIR,options:body.sceneOptions,camera:hostView(),state:{history:HISTORY,redo:REDO_HISTORY,dirty:DIRTY},rawSha256:body.extraction?.rawSha256,diagnostics:body.sceneCompilation?.diagnostics||[]};}
  const record=ParallelEditors.plans.get(planId),pane=[...ParallelEditors.panes.values()].find(p=>p.planId===planId);
  if(!record||record.memoryOnly)return null;
  const state=pane?.ready?pane.frame.contentWindow.EditorPane.state():record.state;
  const snapshot=state?.plan||record.plan,report=(snapshot.sceneReconstructionReports||[]).find(r=>r.originalIR?.sceneVersion===3);if(!report)return null;
  return {snapshot,source:report.originalIR,options:report.reviewDecisions||{},camera:state?.view||hostView(),state:{history:state?.history||[],redo:state?.redo||[],dirty:state?.dirty||false},diagnostics:report.diagnostics||[]};
 }
 function discard(){const ids=[...owned];owned.clear();previewId=null;ownerSignal=null;for(const id of ids)ParallelEditors.discardMemoryPlan(id);}
 const close=ParallelEditors.close;
 ParallelEditors.close=function(){const result=close.apply(this,arguments);if(result!==false){activeJob?.cancel?.('preview_cancelled','Comparison was closed');discard();}return result;};
 const readSaved=ParallelEditors.readSavedPane;
 ParallelEditors.readSavedPane=function(planId){const record=ParallelEditors.plans.get(planId);return record&&(record.memoryOnly||record.explicitlySaved===false)?Promise.resolve(null):readSaved.call(this,planId);};
 function alive(pane,editor){return pane&&ParallelEditors.panes.get(pane.id)===pane&&ParallelEditors.plans.has(pane.planId)&&pane.planId===previewId&&pane.ready&&!editor._editorPaneDisposed&&pane.frame.isConnected!==false;}
 function wait(job,promise,pane,editor,timeoutMs){
  return new Promise((resolve,reject)=>{let done=false;const start=performance.now();let timer;
   function finish(reason,value){if(done)return;done=true;clearTimeout(timer);job.signal?.removeEventListener('abort',abort);reason?reject(reason):resolve(value);}
   const abort=()=>finish(job.signal.reason||error('preview_cancelled','Preview cancelled'));
   function check(){if(job.signal?.aborted)return abort();if(pane&&!alive(pane,editor))return finish(error('preview_cancelled','Isolated preview was disposed or replaced'));if(performance.now()-start>timeoutMs)return finish(error('preview_timeout','Isolated editor callback timed out'));timer=setTimeout(check,20);}
   job.signal?.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(v=>finish(null,v),finish);check();
  });
 }
 root.WebCADInternalAPI=root.EditorInternalAPI.create({catalogue:()=>PlanImport.sceneCatalogue(),readScene,cancelPreview:(reason,signal)=>{if(ownerSignal===signal)discard();},async renderPreview(input){
  if(previewId){const p=[...ParallelEditors.panes.values()].find(p=>p.planId===previewId);if(!p||!alive(p,p.frame.contentWindow))discard();}
  if(!previewId&&(ParallelEditors.panes.size||ParallelEditors.plans.size))throw error('preview_workspace_busy','Start an isolated API preview in a fresh comparison workspace');
  activeJob=input;ownerSignal=input.signal;
  try{
   input.assertFresh();const plan=clone(input.plan),target=input.targetSnapshot;
   plan.heightDefaults=clone(target.heightDefaults||{});plan.floors=clone(target.floors||{});
   plan.sceneReconstructionReports=[{id:'internal-preview-source',version:3,status:'incomplete-selected-preview',originalIR:clone(input.source),diagnostics:clone(input.diagnostics),reviewDecisions:{bindingDecisions:clone(input.displayBindings),displayOverrides:clone(input.displayOverrides||[])},unresolvedEntities:[],acknowledgedOmissions:[]}];
   ParallelEditors.setSync(false);
   if(!previewId)previewId=await wait(input,ParallelEditors.openPlan(plan,'表示bindingの隔離プレビュー（未完成）',{memoryOnly:true,signal:input.signal,onCreated:id=>owned.add(id)}),null,null,35000);
   input.assertFresh();ParallelEditors.setSync(false);
   const pane=[...ParallelEditors.panes.values()].find(p=>p.planId===previewId),editor=pane?.frame.contentWindow;
   if(!alive(pane,editor))throw error('preview_cancelled','Isolated preview is no longer mounted');
   await wait(input,editor.EditorPane.install(plan,{history:[],redo:[],dirty:false,view:clone(input.camera)}),pane,editor,35000);
   input.assertFresh();if(!alive(pane,editor))throw error('preview_cancelled','Isolated preview was disposed during install');
   if(input.camera.view!=='2d')await wait(input,new Promise(resolve=>{function check(){if(input.signal?.aborted||!alive(pane,editor))return resolve();if(editor.ren&&!editor.hasPendingGltfModels()&&!editor._gltfRebuildTimer)return resolve();setTimeout(check,50);}check();}),pane,editor,30000);
   input.assertFresh();if(!alive(pane,editor))throw error('preview_cancelled','Isolated preview was disposed during model load');
   editor.EditorPane.applyView(clone(input.camera));
   await wait(input,new Promise(resolve=>editor.requestAnimationFrame(()=>editor.requestAnimationFrame(resolve))),pane,editor,2000);
   input.assertFresh();if(!alive(pane,editor))throw error('preview_cancelled','Isolated preview was disposed before completion');
   editor.document.querySelectorAll('#save-btn,[onclick="loadPlanFromStorageButton()"],[onclick="openPlanImport()"],[onclick="openShareDialog()"]').forEach(el=>el.disabled=true);
   // Read the existing renderer after install. Never synthesize geometry or patch its plan.
   const heightSettings=v=>Object.fromEntries(['modelVersion','floorThickness','floorRaise','floorRaiseSet','wallHeight','perFloor'].filter(k=>v&&v[k]!==undefined).map(k=>[k,clone(v[k])]));
   const wallDisplays=editor.DATA.walls.map(w=>{
    const roots=input.camera.view==='2d'?[]:editor.getSelectableRoots3D(w),box=roots.length?new editor.THREE.Box3():null;
    roots.forEach(root=>{root.updateMatrixWorld(true);box.union(new editor.THREE.Box3().setFromObject(root));});
    const hasBox=box&&!box.isEmpty(),mm=v=>v.toArray().map(n=>n*1000);
    return {sourceEntityId:w.id,effectiveHeight:{valueMm:hasBox?(box.max.y-box.min.y)*1000:null,basis:hasBox?'native-wall-mesh-bbox':'native-editor-no-3d-mesh',sourceMeasured:false},
      bbox:hasBox?{unit:'mm',axes:'native-world-x-y-up-z',min:mm(box.min),max:mm(box.max),geometryHeightMm:(box.max.y-box.min.y)*1000}:null,
      rendererContext:{wallHeightMm:editor.wallHeightMm(w),defaultWallHeightMm:editor.defaultWallHeightMmForFloor(w.floor),ceilingLinked:w.wallHeight===undefined||Number(w.wallHeight)===editor.defaultWallHeightMmForFloor(w.floor),
        wallDisplayHeightMm:editor.wallDisplayHeightM(w)*1000,wallLiftMm:editor.wallLiftMm(w),floorSlabHeightMm:editor.floorSlabHeightMForFloor(w.floor)*1000,baseSupportWorldMm:editor.wallBaseSupportY(w)*1000,
        heightDefaults:heightSettings(editor.DATA.heightDefaults),floors:Object.fromEntries(Object.entries(editor.DATA.floors||{}).filter(([id])=>/^[1-5]$/.test(id)).map(([id,v])=>[id,heightSettings(v)])),rooms:editor.DATA.rooms.map(r=>({id:r.id,floor:r.floor,floorRaiseMm:r.floorRaiseMm,skipLevelMm:r.skipLevelMm}))}};
   });
   const appearanceProfileDisplays=(input.displayBindings||[]).filter(d=>d.binding?.appearanceProfile&&editor.DATA.items.some(it=>it.id===d.binding.sourceEntityId)).map(d=>{
    const item=editor.DATA.items.find(it=>it.id===d.binding.sourceEntityId),proof=item&&root.TailoredSofaFinish.verifyRendered(item,editor.getSelectableRoots3D(item));
    if(!proof?.ok)throw error('native_profile_not_rendered','Native appearance profile failed: '+(proof?.reason||'missing-item'));
    return {sourceEntityId:item.id,...proof};
   });
   input.assertFresh();
   return {planId:previewId,paneId:pane.id,wallDisplays,appearanceProfileDisplays,camera:editor.EditorPane.view(),memoryOnly:true,nativeEditor:true,image:null,imageCaptureStatus:'external-not-captured'};
  }catch(e){input.cancel?.(e.code||'preview_cancelled',e.message);if(ownerSignal===input.signal)discard();throw e;}
  finally{if(activeJob===input)activeJob=null;}
 }});
}(window));
