/* Two real simulator runtimes, four independent plans. No image proxy/editor replacement. */
(function(root){
 'use strict';
 function detachSharedTextureListeners(shared,rendererCallbacks){
  let detached=0;
  for(const texture of shared)if(texture?.isTexture)for(const callback of rendererCallbacks)if(texture.hasEventListener('dispose',callback)){texture.removeEventListener('dispose',callback);detached++;}
  return detached;
 }
 function detachRendererTextureListeners(renderer,shared,three){
  if(!renderer||typeof renderer.initTexture!=='function'||!three?.DataTexture)return 0;
  // A private 1px texture identifies this renderer's callback without borrowing
  // observers from any application texture. The probe is released immediately.
  const probe=new three.DataTexture(new Uint8Array(4),1,1);probe.needsUpdate=true;
  try{renderer.initTexture(probe);return detachSharedTextureListeners(shared,new Set(probe._listeners?.dispose||[]));}
  catch(_){return 0;}
  finally{try{probe.dispose();}catch(_){}}
 }
 const clone=v=>JSON.parse(JSON.stringify(v));
 function syncCamera(source,target){const view=target.view(),from=source.view();view.twoD=from.twoD;if(from.camera&&view.camera&&((from.view==='3d-walk')===(view.view==='3d-walk')))view.camera=from.camera;target.applyView(view);}
 function modelPool(){const cache=new Map(),controllers=new Map();let resources=new Set(),materials=new Set();return {get resources(){return resources;},owns(resource){return resources.has(resource)||materials.has(resource);},cache,get(url,load){if(!cache.has(url)){const owned=resources,ownedMaterials=materials,controller=new AbortController();controllers.set(url,controller);let promise;promise=Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return load(controller.signal);}).then(scene=>{if(controllers.get(url)===controller)controllers.delete(url);scene.traverse(o=>{if(o.geometry)owned.add(o.geometry);for(const m of [].concat(o.material||[])){ownedMaterials.add(m);for(const v of Object.values(m))if(v&&v.isTexture)owned.add(v);}});return scene;}).catch(e=>{if(cache.get(url)===promise){cache.delete(url);controllers.delete(url);}throw e;});cache.set(url,promise);}return cache.get(url);},async dispose(){const pending=[...cache.values()],owned=resources,ownedMaterials=materials;for(const controller of controllers.values())controller.abort();controllers.clear();cache.clear();resources=new Set();materials=new Set();await Promise.allSettled(pending);for(const m of ownedMaterials)m.dispose();ownedMaterials.clear();for(const resource of owned)resource.dispose();owned.clear();}};}

 if(typeof module!=='undefined')module.exports={modelPool,cloneState,cloneRecord,detachSharedTextureListeners,detachRendererTextureListeners};
 if(!root.document)return;
 root.createEditorModelPool=modelPool;
 root.cloneEditorPaneState=cloneState;
 if(typeof EDITOR_PANE!=='undefined'&&EDITOR_PANE || typeof NATIVE_PLAN_EDITOR!=='undefined'&&NATIVE_PLAN_EDITOR){
  const native=typeof NATIVE_PLAN_EDITOR!=='undefined'&&NATIVE_PLAN_EDITOR,paneId=native?NATIVE_EDITOR_PANE:EDITOR_PANE;
  const hostApi=()=>native?root.PlanLibrary:root.parent.ParallelEditors;
  let renderCalls=0,applying=false,installGeneration=0;const paneGeometries=new Set(),pendingEngineWaits=new Set();
  const oldRender=render3DNow;render3DNow=function(){renderCalls++;const result=oldRender.apply(this,arguments);changed();return result;};
  const ready=Promise.resolve(root.comparisonCatalogueReady);
  function cancelEngineWaits(){for(const cancel of [...pendingEngineWaits])cancel();}
  function waitForEngine(){if(root.threeModulesReady||root._editorPaneDisposed)return Promise.resolve();return new Promise((resolve,reject)=>{
   let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);root.removeEventListener('three-ready',done);pendingEngineWaits.delete(cancel);if(error)reject(error);else resolve();};
   const done=()=>finish(),cancel=()=>finish(),timer=setTimeout(()=>finish(new Error('3D描画エンジンの読み込みが完了しませんでした。復元対象のデータは変更していません。')),30000);
   pendingEngineWaits.add(cancel);root.addEventListener('three-ready',done,{once:true});
  });}
  function view(){return {view:ST.view,floor:ST.floor,walkProfile:root.WalkTps&&root.WalkTps.enabled()?root.WalkTps.preference():undefined,twoD:{zoom:ST.zoom,panX:ST.panX,panY:ST.panY},camera:camExt&&orbit?{pos:camExt.position.toArray(),target:orbit.target.toArray(),fov:camExt.fov,walk:ST.view==='3d-walk'&&WALK.active?{x:WALK.x,z:WALK.z,yaw:WALK.yaw,pitch:WALK.pitch}:null}:null};}
  function applyView(v){applying=true;try{if(v.floor!==ST.floor){onFloorChange(v.floor);document.getElementById('floor-sel').value=String(v.floor);if(ren)rebuild3D();}if(v.view!==ST.view)setView(v.view);if(root.WalkTps)root.WalkTps.restorePreference(v.walkProfile);if(v.twoD){Object.assign(ST,v.twoD);draw2d();}if(v.camera&&camExt&&orbit){if(typeof cancelScheduledCameraFit==='function')cancelScheduledCameraFit();camExt.fov=v.camera.fov;camExt.updateProjectionMatrix();if(ST.view==='3d-walk'&&v.camera.walk&&WALK.active){for(const k of ['x','z','yaw','pitch'])if(Number.isFinite(v.camera.walk[k]))WALK[k]=v.camera.walk[k];walkApplyCamera();}else applyStashedCamera(v.camera);invalidate3D();}}finally{applying=false;lastCamera=cameraKey();}}
  function localGeometry(source){
   const geometry=new THREE.BufferGeometry();geometry.name=source.name;geometry.groups=clone(source.groups);geometry.drawRange={start:source.drawRange.start,count:source.drawRange.count};geometry.userData=clone(source.userData||{});
   function attribute(a){const Typed=root[a.array.constructor.name];const array=new Typed(a.array.buffer,a.array.byteOffset,a.array.length);const out=new THREE.BufferAttribute(array,a.itemSize,a.normalized);out.usage=a.usage;return out;}
   if(source.index)geometry.setIndex(attribute(source.index));for(const [key,a] of Object.entries(source.attributes)){if(a.isInterleavedBufferAttribute){const d=a.data,Typed=root[d.array.constructor.name],buffer=new THREE.InterleavedBuffer(new Typed(d.array.buffer,d.array.byteOffset,d.array.length),d.stride);geometry.setAttribute(key,new THREE.InterleavedBufferAttribute(buffer,a.itemSize,a.offset,a.normalized));}else geometry.setAttribute(key,attribute(a));}
   for(const [key,attrs] of Object.entries(source.morphAttributes||{}))geometry.morphAttributes[key]=attrs.map(attribute);geometry.morphTargetsRelative=source.morphTargetsRelative;
   if(source.boundingBox)geometry.boundingBox=new THREE.Box3(new THREE.Vector3().copy(source.boundingBox.min),new THREE.Vector3().copy(source.boundingBox.max));if(source.boundingSphere)geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3().copy(source.boundingSphere.center),source.boundingSphere.radius);
   root.parent.ParallelEditors.modelPool.resources.add(geometry);paneGeometries.add(geometry);return geometry;
  }
  // Both JSON import and shared-room handoff own this same native rollback.
  // Keep object-selection references attached to the untouched previous DATA.
  function captureInstallState(){
   return {data:DATA,state:{...clone({...ST,selected:null,multiSelected:[],_snapState:null}),selected:ST.selected,multiSelected:ST.multiSelected.slice(),_snapState:ST._snapState},
    drag:{...clone({...DRAG,origItem:null}),origItem:DRAG.origItem},history:HISTORY.slice(),redo:REDO_HISTORY.slice(),dirty:DIRTY,view:view(),
    wallHeight:WALL_H,nextId:nextId,light:clone(LIGHT_SETTINGS),pending:_defaultPlanPending,legacyAdmission:root.__legacyPlanAdmission,
    walk:typeof WALK==='undefined'?null:clone(WALK),cataloguePack:root.AssetPackPicker?.getSelection()};
  }
  function restoreInstallState(previous){
   DATA=previous.data;ST=previous.state;DRAG=previous.drag;DIRTY=previous.dirty;root.__legacyPlanAdmission=previous.legacyAdmission;
   WALL_H=previous.wallHeight;nextId=previous.nextId;for(const key of Object.keys(LIGHT_SETTINGS))if(!(key in previous.light))delete LIGHT_SETTINGS[key];Object.assign(LIGHT_SETTINGS,previous.light);_defaultPlanPending=previous.pending;
   if(previous.walk&&typeof WALK!=='undefined')WALK=previous.walk;
   HISTORY.length=0;HISTORY.push(...previous.history);REDO_HISTORY.length=0;REDO_HISTORY.push(...previous.redo);
   // Restore authoritative state first. A renderer fault during recovery must
   // never prevent undo, unsaved edits, selection, options or camera recovery.
   for(const recover of [()=>{const camera=previous.view.camera;if(camera&&camExt&&orbit){camExt.position.fromArray(camera.pos);orbit.target.fromArray(camera.target);camExt.fov=camera.fov;camExt.updateProjectionMatrix();if(ST.view==='3d-walk'&&WALK.active)walkApplyCamera();else orbit.update();invalidate3D();}},()=>applyView(previous.view),syncNorthUi,syncHeightDefaultsUI,updateProps,draw2d,
    ()=>{if(ren)rebuild3D(true);},()=>root.AssetPackPicker?.setSelection(previous.cataloguePack),()=>{document.getElementById('save-btn')?.classList.toggle('dirty',DIRTY);renderSaveButtonState();}]){
    try{recover();}catch(recoveryError){console.warn('[WebCAD] pane install recovery',recoveryError);}
   }
  }
  root.EditorPane={ready,view,applyView,captureInstallState,restoreInstallState,cloneModel(template){const copy=template.clone(true),geometries=new Map();copy.traverse(o=>{if(o.geometry){if(!geometries.has(o.geometry))geometries.set(o.geometry,localGeometry(o.geometry));o.geometry=geometries.get(o.geometry);}if(o.material)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});if(root.parent.TailoredSofaFinish)root.parent.TailoredSofaFinish.transfer(template,copy);return copy;},snapshot:()=>JSON.parse(serializeDataSnapshot()),state:()=>({plan:JSON.parse(serializeDataSnapshot()),history:HISTORY.slice(),redo:REDO_HISTORY.slice(),view:view(),dirty:DIRTY,cataloguePack:root.AssetPackPicker?.getSelection()}),
   async install(plan,saved,admission){
    ++_jsonImportRequest;const generation=++installGeneration;cancelEngineWaits();await ready;
    if(root._editorPaneDisposed||generation!==installGeneration)return false;
    if(saved?.view&&saved.view.view!=='2d')await waitForEngine();
    if(root._editorPaneDisposed||generation!==installGeneration)return false;
    // Use the native JSON validation/migration/render transaction. A failed
    // first draw must never leave the new scene under the previous plan ID.
    const staged=stageJsonImport(JSON.stringify(plan),admission),previous=captureInstallState();
    try{
     applyJsonImport(staged);
     HISTORY.length=0;REDO_HISTORY.length=0;
     if(saved){HISTORY.push(...(saved.history||[]));REDO_HISTORY.push(...(saved.redo||[]));}
     DIRTY=!!saved?.dirty;
     if(saved?.view)applyView(saved.view);else resetView();
     root.AssetPackPicker?.setSelection(saved?.cataloguePack);if(DIRTY)renderSaveButtonState();else clearDirty();
     return true;
    }catch(error){
     restoreInstallState(previous);
     throw error;
    }
   },
   undo:()=>undoAction(),redo:()=>redoAction(),async save(){captureViewState();const saved=serializeDataSnapshot(),result=await StorageAdapter.save(DATA);if(serializeDataSnapshot()===saved&&result?.canClean!==false)clearDirty();return root.EditorPane.snapshot();},
   metrics:()=>({renderCalls,modelCount:Object.keys(_modelCache).length,pixelRatio:ren&&ren.getPixelRatio(),renderer:ren?clone(ren.info.memory):null,quality:{ao:!!(_n8aoPass&&_n8aoPass.enabled),shadows:!!(ren&&ren.shadowMap.enabled)}}),
   dispose(){++_jsonImportRequest;if(root._editorPaneDisposed)return;root._editorPaneDisposed=true;if(root.WalkTps)root.WalkTps.dispose();++installGeneration;cancelEngineWaits();if(typeof cancelScheduledCameraFit==='function')cancelScheduledCameraFit();if(typeof cancel3DEngineWait==='function')cancel3DEngineWait();try{detachRendererTextureListeners(ren,root.parent.ParallelEditors.modelPool.resources,typeof THREE==='undefined'?null:THREE);const seenGeometry=new Set(paneGeometries),seenMaterial=new Set();for(const geometry of paneGeometries){root.parent.ParallelEditors.modelPool.resources.delete(geometry);geometry.dispose();}paneGeometries.clear();if(sc3)disposeObj(sc3,seenGeometry,seenMaterial);for(const model of Object.values(_modelCache||{}))disposeObj(model,seenGeometry,seenMaterial);for(const texture of Object.values(_texCache||{}))if(texture?.dispose&&!root.parent.ParallelEditors.modelPool.resources.has(texture))texture.dispose();orbit&&orbit.dispose();composer&&composer.dispose();_pmremGen&&_pmremGen.dispose();_envRT&&_envRT.dispose();ren&&ren.dispose();ren&&ren.forceContextLoss();}catch(_){} }
  };
  let scheduled=false,lastCamera=null;
  function cameraKey(){const v=view();return JSON.stringify({twoD:v.twoD,camera:v.camera},(k,value)=>typeof value==='number'&&Number.isFinite(value)?Number(value.toFixed(8)):value);}
  function changed(){if(applying||scheduled||root._editorPaneDisposed||hostApi()?.activeId!==paneId)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(root._editorPaneDisposed)return;const key=cameraKey();if(key===lastCamera)return;lastCamera=key;hostApi()?.changed(paneId);});}
  document.addEventListener('wheel',changed,{passive:true});document.addEventListener('pointermove',e=>{if(e.buttons)changed();},{passive:true});document.addEventListener('pointerup',changed,{passive:true});document.addEventListener('keyup',changed);document.addEventListener('click',changed);
  if(!native)document.documentElement.classList.add('editor-pane');
  // Reuse the existing load button itself, its handler and styling; no duplicate action menu.
  const savedLoad=document.querySelector('.mobile-data-grid [onclick="loadPlanFromStorageButton()"]');
  if(savedLoad&&!native){savedLoad.className='tbtn';document.getElementById('save-btn').after(savedLoad);}
  return;
 }
 if(typeof COMPARISON_PREVIEW!=='undefined'&&COMPARISON_PREVIEW)return;
 const plans=new Map(),panes=new Map();let panel=null,activeId=null,sync=true,sequence=0,legacyPlans=[],launchGeneration=0,saveQueue=Promise.resolve(),hostBusy=false;
 const pool=modelPool();
 const api=root.ParallelEditors={plans,panes,modelPool:pool,get activeId(){return activeId;},
  setSync(value){sync=!!value;if(panel)panel.querySelector('[data-parallel-sync]').checked=sync;if(sync)api.align();},
  changed(id){activeId=id;if(sync){const source=panes.get(id);if(source?.ready&&source.frame.contentWindow.EditorPane)for(const p of panes.values())if(p.ready&&p.id!==id)p.frame.contentWindow.EditorPane&&syncCamera(source.frame.contentWindow.EditorPane,p.frame.contentWindow.EditorPane);}},
  align(){const active=panes.get(activeId),source=active?.ready?active:[...panes.values()].find(p=>p.ready);if(source?.frame.contentWindow.EditorPane)for(const p of panes.values())if(p.ready&&p!==source)p.frame.contentWindow.EditorPane&&syncCamera(source.frame.contentWindow.EditorPane,p.frame.contentWindow.EditorPane);},
  async addPlan(plan,name,options){options=options||{};checkPreviewSignal(options.signal);if(plans.size>=4)throw Error('保持できる案は最大4案です。');const checked=root.PlanSchema.validatePlan(plan);if(!checked.ok)throw Error('間取りJSONを確認してください: '+checked.errors.slice(0,3).join(' / '));const valid=root.PlanSchema.normalizePlan(clone(plan));
   const id='plan-'+Date.now().toString(36)+'-'+(++sequence);plans.set(id,{id,name:name||'案 '+String.fromCharCode(64+plans.size+1),plan:clone(valid||plan),explicitlySaved:false,memoryOnly:options.memoryOnly===true});options.onCreated?.(id);if(panes.size<2)await mount(id,options.signal);checkPreviewSignal(options.signal);refresh();return id;},
  async openPlan(plan,name,options){options=options||{};checkPreviewSignal(options.signal);const checked=root.PlanSchema.validatePlan(plan);if(!checked.ok)throw Error('間取りJSONを確認してください。');if(plans.size>=4)throw Error('保持できる案は最大4案です。既存の案を保存してから確認してください。');root._editorHostCovered=true;document.documentElement.classList.add('parallel-open');if(!panel)buildPanel();else panel.hidden=false;if(!plans.size)await api.addPlan(DATA,'案 A（現在の間取りのコピー）',options);else if(!panes.size)for(const id of [...plans.keys()].slice(0,2))await mount(id);checkPreviewSignal(options.signal);const id=await api.addPlan(plan,name,options);checkPreviewSignal(options.signal);if(![...panes.values()].some(p=>p.planId===id)){const target=[...panes.values()].find(p=>p.ready&&!p.busy);if(!target)throw Error('編集画面の処理が完了するまでお待ちください。');await api.select(target.id,id);}const pane=[...panes.values()].find(p=>p.planId===id),editor=pane&&pane.frame.contentWindow;if(editor){const floors=[...new Set([...(plan.walls||[]),...(plan.rooms||[]),...(plan.items||[])].map(o=>Number(o.floor)||1))].sort((a,b)=>a-b);if(floors.length){editor.document.getElementById('floor-sel').value=String(floors[0]);editor.onFloorChange(floors[0]);}editor.resetView();api.changed(pane.id);}return id;},
  discardMemoryPlan(id){const record=plans.get(id);if(!record)return;if(!record.memoryOnly)throw Error('Only memory-only previews can be discarded without review');for(const pane of [...panes.values()])if(pane.planId===id){pane.cancelMount?.();pane.frame.contentWindow.EditorPane?.dispose();pane.card.remove();panes.delete(pane.id);}plans.delete(id);if(!panes.has(activeId))activeId=panes.keys().next().value||null;refresh();if(!plans.size&&!panes.size&&panel)api.close();},
  async select(paneId,planId){const pane=panes.get(paneId),record=plans.get(planId);if(!pane||!record)throw Error('案がありません。');if(!pane.ready||pane.busy)throw Error('編集画面の処理が完了するまでお待ちください。');if([...panes.values()].some(p=>p!==pane&&p.planId===planId))throw Error('この案はもう一方の画面で編集中です。');stash(pane);pane.ready=false;refresh();try{await pane.frame.contentWindow.EditorPane.install(record.plan,record.state);pane.planId=planId;pane.frame.contentWindow.__editorPlanId=planId;}finally{pane.ready=true;refresh();}api.changed(pane.id);},
  async remove(id){const record=plans.get(id);if(!record)return;const mounted=[...panes.values()].filter(p=>p.planId===id);for(const pane of mounted)if(pane.busy)throw Error('この案は保存中です。完了してから操作してください。');
   const dirty=mounted.length?mounted.some(p=>p.frame.contentWindow.EditorPane?.state().dirty):record.state?.dirty;
   if(dirty&&!confirm('この案の未保存の編集を除いてよいですか？'))return false;
   for(const pane of mounted){pane.cancelMount?.();pane.frame.contentWindow.EditorPane?.dispose();pane.card.remove();panes.delete(pane.id);}plans.delete(id);const shown=new Set([...panes.values()].map(p=>p.planId));for(const other of plans.keys())if(panes.size<2&&!shown.has(other)){await mount(other);shown.add(other);}if(!panes.has(activeId))activeId=panes.keys().next().value||null;refresh();return true;},
  open(){root._editorHostCovered=true;document.documentElement.classList.add('parallel-open');if(panel){panel.hidden=false;if(!panes.size)for(const id of [...plans.keys()].slice(0,2))mount(id);return;}buildPanel();if(!plans.size){(()=>{const generation=++launchGeneration;return api.addPlan(DATA,'案 A（現在の間取りのコピー）').then(()=>{if(generation===launchGeneration&&!panel.hidden)return api.addPlan(DATA,'案 B（現在の間取りのコピー）');});})().catch(message);}else for(const id of [...plans.keys()].slice(0,2))mount(id);},
  close(){if([...panes.values()].some(p=>p.busy)){message('保存中です。完了してから比較を閉じてください。');return false;}document.documentElement.classList.remove('parallel-open');root._editorHostCovered=false;invalidate3D();launchGeneration++;for(const pane of panes.values()){stash(pane);pane.cancelMount?.();pane.frame.contentWindow.EditorPane?.dispose();pane.card.remove();}panes.clear();panel.hidden=true;pool.dispose();},
  async persistPane(paneId,planId,data){if(plans.get(planId)?.memoryOnly)throw Error('Memory-only preview cannot be saved');const pane=panes.get(paneId);if(!pane||pane.planId!==planId||!plans.has(planId))throw Error('保存対象の比較案が変わりました。');const state=pane.frame.contentWindow.EditorPane.state();state.plan=clone(data);pane.busy=true;refresh();try{return await saveRecords(new Set([planId]),new Map([[planId,state]]));}finally{pane.busy=false;refresh();}},
  async readSavedPane(planId){if(plans.get(planId)?.memoryOnly)return null;const records=await workspace('read'),record=records?.find(r=>r.id===planId);return record&&record.explicitlySaved!==false&&!record.state?.dirty?clone(record.plan):null;},
  async saveWorkspace(){await saveRecords(new Set(plans.keys()));message('表示中・非表示の案をこのブラウザに保存しました。');},
  async legacyRecords(){const saved=await root.PlanComparison.storage();legacyPlans=(saved?.plans||[]).filter(r=>r&&r.plan&&r.name).concat(await legacyPaneRecords());return legacyPlans.map(r=>({id:r.id,name:r.name}));},
  async importLegacy(id){const record=legacyPlans.find(r=>r.id===id);if(!record)throw Error('以前の案を選んでください。');return api.addPlan(record.legacyPaneKey===undefined?record.plan:await legacyPanePlan(record.legacyPaneKey),record.name);},
  hasUnsaved(){const active=new Set([...panes.values()].map(p=>p.planId));return [...panes.values()].some(p=>p.frame.contentWindow?.DIRTY)||[...plans.values()].some(r=>!active.has(r.id)&&r.state?.dirty);},
  async loadWorkspace(){if([...panes.values()].some(p=>p.busy))throw Error('案を保存中です。完了してから読み込んでください。');const records=await workspace('read');if(!records?.length)throw Error('保存した比較はありません。');for(const p of panes.values())stash(p);if([...plans.values()].some(r=>r.state?.dirty)&&!confirm('未保存の比較案を保存済みの比較に入れ替えますか？'))return false;for(const p of panes.values()){p.cancelMount?.();p.frame.contentWindow.EditorPane?.dispose();p.card.remove();}panes.clear();plans.clear();await pool.dispose();for(const r of records.filter(r=>!r.memoryOnly).slice(0,4)){plans.set(r.id,clone(r));if(panes.size<2)await mount(r.id);}refresh();if(sync)api.align();return true;}
 };
  async function run(button,operation,success){if(hostBusy)return;hostBusy=true;button.disabled=true;refresh();message('処理しています…');try{const result=await operation();if(success)message(result===false?'操作を取り消しました。現在の編集を保持しています。':success);}catch(error){message(error);}finally{hostBusy=false;button.disabled=false;refresh();}}
 function message(error){if(panel)panel.querySelector('[data-parallel-status]').textContent=error.message||String(error);}
 function stash(pane){const record=plans.get(pane.planId),editor=pane.frame.contentWindow.EditorPane;if(record&&editor){record.state=editor.state();record.plan=record.state.plan;}}
 async function legacyPaneRecords(){
  if(indexedDB.databases&&!(await indexedDB.databases()).some(db=>db.name==='webcad-parallel-plans'))return [];
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('webcad-parallel-plans');req.onupgradeneeded=()=>req.transaction.abort();req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);});if(!db)return [];
  let rows;try{rows=await new Promise((resolve,reject)=>{const tx=db.transaction('plans','readonly'),store=tx.objectStore('plans'),keys=store.getAllKeys();tx.oncomplete=()=>resolve(keys.result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  const saved=await workspace('read');return rows.map(key=>({id:'legacy-pane:'+key,name:'旧ペイン保存: '+(saved?.find(p=>p.id===key)?.name||String(key)),legacyPaneKey:key}));
 }
 async function legacyPanePlan(key){const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('webcad-parallel-plans');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('plans','readonly'),req=tx.objectStore('plans').get(key);tx.oncomplete=()=>resolve(req.result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
 function cloneState(state){const {history,redo,...mutable}=state;return {...clone(mutable),history:(history||[]).every(v=>typeof v==='string')?(history||[]).slice():clone(history),redo:(redo||[]).every(v=>typeof v==='string')?(redo||[]).slice():clone(redo)};}
 function cloneRecord(record){const {state,...mutable}=record,result=clone(mutable);if(state)result.state=cloneState(state);return result;}
 function saveRecords(savedIds,supplied){
  const operation=saveQueue.catch(()=>{}).then(async()=>{
   for(const pane of panes.values())stash(pane);
   const records=[...plans.values()].filter(r=>!r.memoryOnly).map(cloneRecord);
   for(const record of records){if(supplied?.has(record.id)){record.state=cloneState(supplied.get(record.id));record.plan=record.state.plan;}if(savedIds.has(record.id)){record.explicitlySaved=true;if(record.state)record.state.dirty=false;}}
   await workspace('write',records,savedIds);
   for(const saved of records){if(!savedIds.has(saved.id))continue;const current=plans.get(saved.id);if(!current)continue;current.explicitlySaved=true;const pane=[...panes.values()].find(p=>p.planId===saved.id),editor=pane?.frame.contentWindow.EditorPane;
    if(editor){if(JSON.stringify(editor.snapshot())===JSON.stringify(saved.plan)){pane.frame.contentWindow.clearDirty();stash(pane);}}
    else if(JSON.stringify(current.plan)===JSON.stringify(saved.plan)&&current.state)current.state.dirty=false;
   }
   return true;
  });saveQueue=operation;return operation;
 }
 async function workspace(mode,value,savedIds){const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('webcad-parallel-workspace',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspaces');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('workspaces',mode==='write'?'readwrite':'readonly'),store=tx.objectStore('workspaces');let result;const req=store.get('local');req.onsuccess=()=>{if(mode==='write'){const previous=new Map((req.result||[]).map(r=>[r.id,r]));const records=value.filter(r=>!r.memoryOnly).map(r=>savedIds&&!savedIds.has(r.id)&&previous.has(r.id)?previous.get(r.id):r).filter(r=>!r.memoryOnly);store.put(records,'local');result=true;}else result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}}

 function checkPreviewSignal(signal){if(signal?.aborted)throw signal.reason||Error('Preview cancelled');}
 async function mount(planId,signal){checkPreviewSignal(signal);
  const id='pane-'+Date.now().toString(36)+'-'+(++sequence),card=document.createElement('section'),head=document.createElement('header'),select=document.createElement('select'),remove=document.createElement('button'),frame=document.createElement('iframe');card.className='parallel-pane';select.setAttribute('aria-label','編集する案');
  remove.type='button';remove.className='tbtn parallel-pane-remove';remove.textContent='×';remove.title='この案を比較対象から外す';remove.setAttribute('aria-label','この案を比較対象から外す');remove.setAttribute('data-parallel-pane-remove','');
  head.append(select,remove);card.append(head,frame);frame.title='通常の間取り編集画面';frame.src='index.html?editorPane='+id;const pane={id,planId,card,frame,select,remove,ready:false};panes.set(id,pane);panel.querySelector('[data-parallel-grid]').append(card);refresh();
  remove.onclick=e=>{const target=pane.planId;run(e.currentTarget,()=>api.remove(target),'この案を比較対象から外しました。');};
  select.onchange=()=>api.select(id,select.value).catch(message);frame.addEventListener('pointerenter',()=>activeId=id);
  await new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();},abort=()=>finish(signal.reason||Error('Preview cancelled')),timer=setTimeout(()=>finish(Error('編集画面の起動が時間内に完了しませんでした。')),30000);pane.cancelMount=frame.onload=()=>finish();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});checkPreviewSignal(signal);if(panes.get(id)!==pane)return;await frame.contentWindow.EditorPane.ready;checkPreviewSignal(signal);if(panes.get(id)!==pane)return;frame.contentWindow.__editorPlanId=planId;await frame.contentWindow.EditorPane.install(plans.get(planId).plan,plans.get(planId).state);pane.ready=true;activeId=activeId||id;refresh();if(sync)api.align();
 }

 function refresh(){if(!panel)return;for(const control of panel.querySelectorAll('.parallel-controls button,.parallel-controls select,.parallel-controls input'))control.disabled=hostBusy;panel.querySelector('[data-parallel-close]').disabled=hostBusy||[...panes.values()].some(p=>p.busy);for(const pane of panes.values()){pane.select.replaceChildren();for(const r of plans.values()){const option=document.createElement('option');option.value=r.id;option.textContent=r.name;option.disabled=[...panes.values()].some(p=>p!==pane&&p.planId===r.id);pane.select.append(option);}pane.select.value=pane.planId;pane.select.disabled=!pane.ready||!!pane.busy||hostBusy;pane.remove.disabled=!pane.ready||!!pane.busy||hostBusy;pane.remove.dataset.planId=pane.planId;}panel.querySelector('[data-parallel-add]').disabled=hostBusy||plans.size>=4;}
 function buildPanel(){
  panel=document.createElement('div');panel.className='parallel-editors';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','複数プラン比較モード');
  panel.innerHTML='<div class="parallel-heading"><strong>複数プラン比較モード</strong></div><header class="parallel-controls" aria-label="比較全体の操作"><button class="tbtn" data-parallel-close>元の編集に戻る</button><button class="tbtn" data-parallel-save>比較セットを保存</button><button class="tbtn" data-parallel-load>保存した比較セットを開く</button><button class="tbtn" data-parallel-add>空の案を追加</button><details class="parallel-recovery"><summary class="mobile-data-title">以前保存した案を比較へ追加</summary><select data-parallel-legacy aria-label="以前保存した案" hidden></select><button class="tbtn" data-parallel-legacy-add>保存済み案を選ぶ</button></details><label><input type="checkbox" data-parallel-sync checked>画角を同期</label><button class="tbtn" data-parallel-align>一度だけ揃える</button></header><p data-parallel-status role="status">上部は比較全体の操作です。各案の保存・JSON読込／出力は、その案の既存ヘッダーを使います。</p><div class="parallel-grid" data-parallel-grid></div>';
  const brand=document.querySelector('#toolbar>.brand-mark').cloneNode(true);brand.classList.add('parallel-brand');panel.querySelector('.parallel-heading').prepend(brand);document.body.append(panel);
  panel.querySelector('[data-parallel-sync]').onchange=e=>{api.setSync(e.target.checked);message(e.target.checked?'画角の同期を有効にしました。':'画角は各案で独立して操作できます。');};panel.querySelector('[data-parallel-align]').onclick=()=>{api.align();message('最後に操作した案の画角へ一度だけ揃えました。');};

  panel.querySelector('[data-parallel-save]').onclick=e=>run(e.currentTarget,()=>api.saveWorkspace());panel.querySelector('[data-parallel-load]').onclick=e=>run(e.currentTarget,()=>api.loadWorkspace(),'保存した比較セットを開きました。');panel.querySelector('[data-parallel-close]').onclick=()=>api.close();
  panel.querySelector('[data-parallel-legacy-add]').onclick=async()=>{try{const select=panel.querySelector('[data-parallel-legacy]');if(select.hidden){const records=await api.legacyRecords();select.replaceChildren();for(const r of records){const option=document.createElement('option');option.value=r.id;option.textContent=r.name;select.append(option);}if(!records.length)return message('以前に保存した案はありません。');select.hidden=false;panel.querySelector('[data-parallel-legacy-add]').textContent='選んだ案を追加';message('追加する保存済み案を選んでください。');}else {await api.importLegacy(select.value);message('保存済み案をコピーして追加しました。');}}catch(error){message(error);}};
  panel.querySelector('[data-parallel-add]').onclick=e=>run(e.currentTarget,()=>api.addPlan({walls:[],rooms:[],items:[],startMode:'blank'}),'空の案を追加しました。パネルでその案へ切り替えてJSONを読み込めます。');


 }

 root.addEventListener('beforeunload',event=>{if(api.hasUnsaved()){event.preventDefault();event.returnValue='';}});

})(typeof window==='undefined'?globalThis:window);
