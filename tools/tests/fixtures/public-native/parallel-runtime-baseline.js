/* Two real simulator runtimes, four independent plans. No image proxy/editor replacement. */
(function(root){
 'use strict';
 const clone=v=>JSON.parse(JSON.stringify(v));
 function syncCamera(source,target){const view=target.view(),from=source.view();view.twoD=from.twoD;if(from.camera&&view.camera&&((from.view==='3d-walk')===(view.view==='3d-walk')))view.camera=from.camera;target.applyView(view);}
 function modelPool(){const cache=new Map();let resources=new Set();return {get resources(){return resources;},cache,get(url,load){if(!cache.has(url)){const owned=resources;let promise;promise=Promise.resolve().then(load).then(scene=>{scene.traverse(o=>{if(o.geometry)owned.add(o.geometry);for(const m of [].concat(o.material||[]))for(const v of Object.values(m))if(v&&v.isTexture)owned.add(v);});return scene;}).catch(e=>{if(cache.get(url)===promise)cache.delete(url);throw e;});cache.set(url,promise);}return cache.get(url);},async dispose(){const pending=[...cache.values()],owned=resources;cache.clear();resources=new Set();const results=await Promise.allSettled(pending),materials=new Set();for(const r of results)if(r.status==='fulfilled')r.value.traverse(o=>{for(const m of [].concat(o.material||[]))materials.add(m);});for(const m of materials)m.dispose();for(const resource of owned)resource.dispose();owned.clear();}};}

 if(typeof module!=='undefined')module.exports={modelPool};
 if(!root.document)return;
 root.createEditorModelPool=modelPool;
 if(typeof EDITOR_PANE!=='undefined'&&EDITOR_PANE){
  let renderCalls=0,applying=false;
  const oldRender=render3DNow;render3DNow=function(){renderCalls++;const result=oldRender.apply(this,arguments);changed();return result;};
  const ready=Promise.resolve(root.comparisonCatalogueReady);
  function view(){return {view:ST.view,floor:ST.floor,twoD:{zoom:ST.zoom,panX:ST.panX,panY:ST.panY},camera:camExt&&orbit?{pos:camExt.position.toArray(),target:orbit.target.toArray(),fov:camExt.fov,walk:ST.view==='3d-walk'&&WALK.active?{x:WALK.x,z:WALK.z,yaw:WALK.yaw,pitch:WALK.pitch}:null}:null};}
  function applyView(v){applying=true;try{if(v.floor!==ST.floor){onFloorChange(v.floor);document.getElementById('floor-sel').value=String(v.floor);if(ren)rebuild3D();}if(v.view!==ST.view)setView(v.view);if(v.twoD){Object.assign(ST,v.twoD);draw2d();}if(v.camera&&camExt&&orbit){camExt.fov=v.camera.fov;camExt.updateProjectionMatrix();if(ST.view==='3d-walk'&&v.camera.walk&&WALK.active){for(const k of ['x','z','yaw','pitch'])if(Number.isFinite(v.camera.walk[k]))WALK[k]=v.camera.walk[k];walkApplyCamera();}else applyStashedCamera(v.camera);invalidate3D();}}finally{applying=false;lastCamera=cameraKey();}}
  function localGeometry(source){
   const geometry=new THREE.BufferGeometry();geometry.name=source.name;geometry.groups=clone(source.groups);geometry.drawRange={start:source.drawRange.start,count:source.drawRange.count};geometry.userData=clone(source.userData||{});
   function attribute(a){const Typed=root[a.array.constructor.name];const array=new Typed(a.array.buffer,a.array.byteOffset,a.array.length);const out=new THREE.BufferAttribute(array,a.itemSize,a.normalized);out.usage=a.usage;return out;}
   if(source.index)geometry.setIndex(attribute(source.index));for(const [key,a] of Object.entries(source.attributes)){if(a.isInterleavedBufferAttribute){const d=a.data,Typed=root[d.array.constructor.name],buffer=new THREE.InterleavedBuffer(new Typed(d.array.buffer,d.array.byteOffset,d.array.length),d.stride);geometry.setAttribute(key,new THREE.InterleavedBufferAttribute(buffer,a.itemSize,a.offset,a.normalized));}else geometry.setAttribute(key,attribute(a));}
   for(const [key,attrs] of Object.entries(source.morphAttributes||{}))geometry.morphAttributes[key]=attrs.map(attribute);geometry.morphTargetsRelative=source.morphTargetsRelative;
   if(source.boundingBox)geometry.boundingBox=new THREE.Box3(new THREE.Vector3().copy(source.boundingBox.min),new THREE.Vector3().copy(source.boundingBox.max));if(source.boundingSphere)geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3().copy(source.boundingSphere.center),source.boundingSphere.radius);
   root.parent.ParallelEditors.modelPool.resources.add(geometry);return geometry;
  }
  root.EditorPane={ready,view,applyView,cloneModel(template){const copy=template.clone(true),geometries=new Map();copy.traverse(o=>{if(o.geometry){if(!geometries.has(o.geometry))geometries.set(o.geometry,localGeometry(o.geometry));o.geometry=geometries.get(o.geometry);}if(o.material)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});return copy;},snapshot:()=>JSON.parse(serializeDataSnapshot()),state:()=>({plan:JSON.parse(serializeDataSnapshot()),history:HISTORY.slice(),redo:REDO_HISTORY.slice(),view:view(),dirty:DIRTY}),
   async install(plan,saved){++_jsonImportRequest;await ready;DATA=clone(plan);_defaultPlanPending=false;resetHeightGlobalsForPlanLoad();ensureObjectIds();ensureFloorMetadata();ensureHeightDefaults();ensureExteriorWallSettings();ensureInteriorWallSettings();ensureRoofAppearance();normalizeLegacyFurnitureItems();syncExteriorWallSettings();ST.selected=null;clearMultiSelection();HISTORY.length=0;REDO_HISTORY.length=0;if(saved){HISTORY.push(...saved.history);REDO_HISTORY.push(...saved.redo);DIRTY=saved.dirty;}else DIRTY=false;restoreViewState();draw2d();if(ren)rebuild3D();if(saved)applyView(saved.view);else resetView();},
   undo:()=>undoAction(),redo:()=>redoAction(),async save(){captureViewState();const saved=serializeDataSnapshot();await StorageAdapter.save(DATA);if(serializeDataSnapshot()===saved)clearDirty();return root.EditorPane.snapshot();},
   metrics:()=>({renderCalls,modelCount:Object.keys(_modelCache).length,pixelRatio:ren&&ren.getPixelRatio(),renderer:ren?clone(ren.info.memory):null,quality:{ao:!!(_n8aoPass&&_n8aoPass.enabled),shadows:!!(ren&&ren.shadowMap.enabled)}}),
   dispose(){++_jsonImportRequest;root._editorPaneDisposed=true;try{orbit&&orbit.dispose();composer&&composer.dispose();_pmremGen&&_pmremGen.dispose();_envRT&&_envRT.dispose();ren&&ren.dispose();ren&&ren.forceContextLoss();}catch(_){} }
  };
  let scheduled=false,lastCamera=null;
  function cameraKey(){const v=view();return JSON.stringify({twoD:v.twoD,camera:v.camera},(k,value)=>typeof value==='number'&&Number.isFinite(value)?Number(value.toFixed(8)):value);}
  function changed(){if(applying||scheduled||root._editorPaneDisposed||root.parent.ParallelEditors.activeId!==EDITOR_PANE)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(root._editorPaneDisposed)return;const key=cameraKey();if(key===lastCamera)return;lastCamera=key;root.parent.ParallelEditors.changed(EDITOR_PANE);});}
  document.addEventListener('wheel',changed,{passive:true});document.addEventListener('pointermove',e=>{if(e.buttons)changed();},{passive:true});document.addEventListener('pointerup',changed,{passive:true});document.addEventListener('keyup',changed);document.addEventListener('click',changed);
  document.documentElement.classList.add('editor-pane');
  // Reuse the existing load button itself, its handler and styling; no duplicate action menu.
  const savedLoad=document.querySelector('.mobile-data-grid [onclick="loadPlanFromStorageButton()"]');
  if(savedLoad){savedLoad.className='tbtn';document.getElementById('save-btn').after(savedLoad);}
  return;
 }
 if(typeof COMPARISON_PREVIEW!=='undefined'&&COMPARISON_PREVIEW)return;
 const plans=new Map(),panes=new Map();let panel=null,activeId=null,sync=true,sequence=0,legacyPlans=[],launchGeneration=0,saveQueue=Promise.resolve(),hostBusy=false;
 const pool=modelPool();
 const api=root.ParallelEditors={plans,panes,modelPool:pool,get activeId(){return activeId;},
  setSync(value){sync=!!value;if(panel)panel.querySelector('[data-parallel-sync]').checked=sync;if(sync)api.align();},
  changed(id){activeId=id;if(sync){const source=panes.get(id);if(source?.ready&&source.frame.contentWindow.EditorPane)for(const p of panes.values())if(p.ready&&p.id!==id)p.frame.contentWindow.EditorPane&&syncCamera(source.frame.contentWindow.EditorPane,p.frame.contentWindow.EditorPane);}},
  align(){const active=panes.get(activeId),source=active?.ready?active:[...panes.values()].find(p=>p.ready);if(source?.frame.contentWindow.EditorPane)for(const p of panes.values())if(p.ready&&p!==source)p.frame.contentWindow.EditorPane&&syncCamera(source.frame.contentWindow.EditorPane,p.frame.contentWindow.EditorPane);},
  async addPlan(plan,name){if(plans.size>=4)throw Error('保持できる案は最大4案です。');const checked=root.PlanSchema.validatePlan(plan);if(!checked.ok)throw Error('間取りJSONを確認してください: '+checked.errors.slice(0,3).join(' / '));const valid=root.PlanSchema.normalizePlan(clone(plan));
   const id='plan-'+Date.now().toString(36)+'-'+(++sequence);plans.set(id,{id,name:name||'案 '+String.fromCharCode(64+plans.size+1),plan:clone(valid||plan),explicitlySaved:false});if(panes.size<2)await mount(id);refresh();return id;},
  async select(paneId,planId){const pane=panes.get(paneId),record=plans.get(planId);if(!pane||!record)throw Error('案がありません。');if(!pane.ready||pane.busy)throw Error('編集画面の処理が完了するまでお待ちください。');if([...panes.values()].some(p=>p!==pane&&p.planId===planId))throw Error('この案はもう一方の画面で編集中です。');stash(pane);pane.ready=false;refresh();try{pane.planId=planId;await pane.frame.contentWindow.EditorPane.install(record.plan,record.state);pane.frame.contentWindow.__editorPlanId=planId;}finally{pane.ready=true;refresh();}api.changed(pane.id);},
  async remove(id){const record=plans.get(id);if(!record)return;const mounted=[...panes.values()].filter(p=>p.planId===id);for(const pane of mounted)if(pane.busy)throw Error('この案は保存中です。完了してから操作してください。');
   const dirty=mounted.length?mounted.some(p=>p.frame.contentWindow.EditorPane?.state().dirty):record.state?.dirty;
   if(dirty&&!confirm('この案の未保存の編集を除いてよいですか？'))return false;
   for(const pane of mounted){pane.cancelMount?.();pane.frame.contentWindow.EditorPane?.dispose();pane.card.remove();panes.delete(pane.id);}plans.delete(id);const shown=new Set([...panes.values()].map(p=>p.planId));for(const other of plans.keys())if(panes.size<2&&!shown.has(other)){await mount(other);shown.add(other);}if(!panes.has(activeId))activeId=panes.keys().next().value||null;refresh();return true;},
  open(){document.documentElement.classList.add('parallel-open');if(panel){panel.hidden=false;if(!panes.size)for(const id of [...plans.keys()].slice(0,2))mount(id);return;}buildPanel();if(!plans.size){(()=>{const generation=++launchGeneration;return api.addPlan(DATA,'案 A（現在の間取りのコピー）').then(()=>{if(generation===launchGeneration&&!panel.hidden)return api.addPlan(DATA,'案 B（現在の間取りのコピー）');});})().catch(message);}else for(const id of [...plans.keys()].slice(0,2))mount(id);},
  close(){if([...panes.values()].some(p=>p.busy)){message('保存中です。完了してから比較を閉じてください。');return false;}document.documentElement.classList.remove('parallel-open');launchGeneration++;for(const pane of panes.values()){stash(pane);pane.cancelMount?.();pane.frame.contentWindow.EditorPane?.dispose();pane.card.remove();}panes.clear();panel.hidden=true;pool.dispose();},
  async persistPane(paneId,planId,data){const pane=panes.get(paneId);if(!pane||pane.planId!==planId||!plans.has(planId))throw Error('保存対象の比較案が変わりました。');const state=pane.frame.contentWindow.EditorPane.state();state.plan=clone(data);pane.busy=true;refresh();try{return await saveRecords(new Set([planId]),new Map([[planId,state]]));}finally{pane.busy=false;refresh();}},
  async readSavedPane(planId){const records=await workspace('read'),record=records?.find(r=>r.id===planId);return record&&record.explicitlySaved!==false&&!record.state?.dirty?clone(record.plan):null;},
  async saveWorkspace(){await saveRecords(new Set(plans.keys()));message('表示中・非表示の案をこのブラウザに保存しました。');},
  async legacyRecords(){const saved=await root.PlanComparison.storage();legacyPlans=(saved?.plans||[]).filter(r=>r&&r.plan&&r.name).concat(await legacyPaneRecords());return legacyPlans.map(r=>({id:r.id,name:r.name}));},
  async importLegacy(id){const record=legacyPlans.find(r=>r.id===id);if(!record)throw Error('以前の案を選んでください。');return api.addPlan(record.legacyPaneKey===undefined?record.plan:await legacyPanePlan(record.legacyPaneKey),record.name);},
  hasUnsaved(){const active=new Set([...panes.values()].map(p=>p.planId));return [...panes.values()].some(p=>p.frame.contentWindow?.DIRTY)||[...plans.values()].some(r=>!active.has(r.id)&&r.state?.dirty);},
  async loadWorkspace(){if([...panes.values()].some(p=>p.busy))throw Error('案を保存中です。完了してから読み込んでください。');const records=await workspace('read');if(!records?.length)throw Error('保存した比較はありません。');for(const p of panes.values())stash(p);if([...plans.values()].some(r=>r.state?.dirty)&&!confirm('未保存の比較案を保存済みの比較に入れ替えますか？'))return false;for(const p of panes.values()){p.cancelMount?.();p.frame.contentWindow.EditorPane?.dispose();p.card.remove();}panes.clear();plans.clear();await pool.dispose();for(const r of records.slice(0,4)){plans.set(r.id,clone(r));if(panes.size<2)await mount(r.id);}refresh();if(sync)api.align();return true;}
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
 function saveRecords(savedIds,supplied){
  const operation=saveQueue.catch(()=>{}).then(async()=>{
   for(const pane of panes.values())stash(pane);
   const records=clone([...plans.values()]);
   for(const record of records){if(supplied?.has(record.id)){record.state=clone(supplied.get(record.id));record.plan=record.state.plan;}if(savedIds.has(record.id)){record.explicitlySaved=true;if(record.state)record.state.dirty=false;}}
   await workspace('write',records,savedIds);
   for(const saved of records){if(!savedIds.has(saved.id))continue;const current=plans.get(saved.id);if(!current)continue;current.explicitlySaved=true;const pane=[...panes.values()].find(p=>p.planId===saved.id),editor=pane?.frame.contentWindow.EditorPane;
    if(editor){if(JSON.stringify(editor.snapshot())===JSON.stringify(saved.plan)){pane.frame.contentWindow.clearDirty();stash(pane);}}
    else if(JSON.stringify(current.plan)===JSON.stringify(saved.plan)&&current.state)current.state.dirty=false;
   }
   return true;
  });saveQueue=operation;return operation;
 }
 async function workspace(mode,value,savedIds){const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('webcad-parallel-workspace',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspaces');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('workspaces',mode==='write'?'readwrite':'readonly'),store=tx.objectStore('workspaces');let result;const req=store.get('local');req.onsuccess=()=>{if(mode==='write'){const previous=new Map((req.result||[]).map(r=>[r.id,r]));const records=value.map(r=>savedIds&&!savedIds.has(r.id)&&previous.has(r.id)?previous.get(r.id):r);store.put(records,'local');result=true;}else result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}}

 async function mount(planId){
  const id='pane-'+Date.now().toString(36)+'-'+(++sequence),card=document.createElement('section'),head=document.createElement('header'),select=document.createElement('select'),remove=document.createElement('button'),frame=document.createElement('iframe');card.className='parallel-pane';select.setAttribute('aria-label','編集する案');
  remove.type='button';remove.className='tbtn parallel-pane-remove';remove.textContent='×';remove.title='この案を比較対象から外す';remove.setAttribute('aria-label','この案を比較対象から外す');remove.setAttribute('data-parallel-pane-remove','');
  head.append(select,remove);card.append(head,frame);frame.title='通常の間取り編集画面';frame.src='index.html?editorPane='+id;const pane={id,planId,card,frame,select,remove,ready:false};panes.set(id,pane);panel.querySelector('[data-parallel-grid]').append(card);refresh();
  remove.onclick=e=>{const target=pane.planId;run(e.currentTarget,()=>api.remove(target),'この案を比較対象から外しました。');};
  select.onchange=()=>api.select(id,select.value).catch(message);frame.addEventListener('pointerenter',()=>activeId=id);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('編集画面の起動が時間内に完了しませんでした。')),30000);pane.cancelMount=frame.onload=()=>{clearTimeout(timer);resolve();};});if(panes.get(id)!==pane)return;await frame.contentWindow.EditorPane.ready;if(panes.get(id)!==pane)return;frame.contentWindow.__editorPlanId=planId;await frame.contentWindow.EditorPane.install(plans.get(planId).plan,plans.get(planId).state);pane.ready=true;activeId=activeId||id;refresh();if(sync)api.align();
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
