/* Common plan inventory using native editors and a separate, non-destructive repository. */
(function(){
'use strict';
const native=typeof NATIVE_PLAN_EDITOR!=='undefined'&&NATIVE_PLAN_EDITOR;
if(!native&&new URLSearchParams(location.search).get('planLibrary')!=='1')return;
const copy=v=>JSON.parse(JSON.stringify(v)),uid=()=>crypto.randomUUID(),q=(s,r=document)=>r.querySelector(s);
function attachCurrentEditor(parent,paneId){
 const toolbar=q('#toolbar'),label=document.createElement('div'),select=document.createElement('select'),dirty=document.createElement('span');
 label.className='library-current';label.append('編集中：',select,dirty);select.dataset.libraryCurrent='';select.setAttribute('aria-label','編集中のプラン');dirty.dataset.libraryDirty='';dirty.setAttribute('role','status');dirty.setAttribute('aria-live','polite');toolbar.prepend(label);
 for(const [action,title] of [['duplicate','⧉ 複製'],['history','↶ 履歴']]){const b=document.createElement('button');b.className='tbtn';b.textContent=title;b.dataset.libraryAction=action;b.onclick=()=>parent.run(()=>parent[action](paneId));q('#save-btn').after(b);}
 label.append(q('#save-btn'));
 select.onchange=()=>{const target=select.value;parent.run(()=>target==='__open__'?parent.list():target==='__new__'?parent.newPlan():parent.switchPlan(paneId,target));};
 const oldRenderSave=renderSaveButtonState;renderSaveButtonState=function(){oldRenderSave();parent.refresh();};
 const oldSaveBusy=setSaveButtonBusy;setSaveButtonBusy=function(value){oldSaveBusy(value);parent.refresh();};
 const oldMark=markDirty,oldClear=clearDirty;markDirty=function(){oldMark();queueMicrotask(()=>parent.edited(paneId));};clearDirty=function(){oldClear();parent.refresh();};
 for(const name of ['applyJsonImport','undoAction','redoAction','markDirtyUiOnly']){const original=window[name];window[name]=function(){const result=original.apply(this,arguments);parent.edited(paneId);return result;};}
 document.addEventListener('change',event=>{if(event.target.id==='catalogue-pack')parent.edited(paneId);});
 window.loadPlanFromStorageButton=()=>parent.run(()=>parent.reloadPlan(paneId));
 const style=document.createElement('style');style.textContent='.library-current{position:sticky;left:0;z-index:3;background:white;border-radius:18px;padding:0 8px;flex-shrink:0;display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap}.library-current select{min-height:40px;max-width:210px;border:0;border-radius:18px;background:#f4f5f3;padding:6px}.library-current span{color:#ac5d13}.library-current #save-btn{flex-shrink:0}@media(max-width:600px){.library-current select{max-width:140px}.library-current{padding:0 4px;gap:3px;font-size:11px}}';document.head.append(style);
 parent.childReady(paneId);
}
if(EDITOR_PANE){attachCurrentEditor(window.parent.PlanLibrary,EDITOR_PANE);return;}
if(typeof PlanRepositoryLab==='undefined'||typeof createEditorModelPool!=='function'||native&&!window.EditorPane){
 const message='プラン保存の初期化に失敗しました。再読み込みしてください。旧保存と現在の編集は変更していません。';
 const unavailable=()=>Promise.reject(Error(message));
 window.PlanLibrary={ready:Promise.resolve(false),persistPane:unavailable,readSavedPane:unavailable,openComparison:()=>{alert(message);return false;}};
 window.loadPlanFromStorageButton=()=>{alert(message);return Promise.resolve(false);};
 console.error('[WebCAD] '+message);alert(message);return;
}
const repo=PlanRepositoryLab.create({name:'webcad-plan-library-lab-ui-v1'}),plans=new Map(),panes=new Map(),pool=createEditorModelPool();
const sessionKey=native?'webcad-plan-library-native-session':'webcad-plan-library-lab-session';
let session;try{session=sessionStorage.getItem(sessionKey);}catch(_){}
if(!session){session=uid();try{sessionStorage.setItem(sessionKey,session);}catch(_){} }
let retained=[],activeId=null,sync=true,busy=true,transitionBusy=true,initializing=true,authorizedSavePane=null,dialog=null,dialogEpoch=0,dismissDialog=null,dialogReturnFocus=null,viewQueue=Promise.resolve(),sequence=0;
const shell=document.createElement('section');shell.className='parallel-editors library-host';shell.innerHTML='<div class="parallel-heading"><strong>複数プラン比較モード</strong></div><header class="parallel-controls" aria-label="共通操作"><div class="library-group"><span>① プラン</span><button class="tbtn" data-library-open>▤ 開く</button><button class="tbtn" data-library-new>＋ 新規</button></div><div class="library-group"><span>② 配置</span><button class="tbtn" data-library-layout="1">▣ 1画面</button><button class="tbtn" data-library-layout="2">▥ 2画面</button></div><div class="library-group"><span>③ 画角</span><label><input type="checkbox" data-parallel-sync checked>同期</label><button class="tbtn" data-parallel-align>◎ 一度だけ揃える</button></div></header><p data-library-status role="status">共通一覧からプランを開き、各画面の保存・JSON・カメラ操作を使えます。</p><div class="parallel-grid" data-library-grid></div><footer class="library-notice">保存先はこのブラウザです。大切な案は各画面からJSONを書き出してください。</footer>';
const brand=q('#toolbar>.brand-mark')?.cloneNode(true);if(brand)q('.parallel-heading',shell).prepend(brand);if(native){shell.hidden=true;}else{document.body.append(shell);document.documentElement.classList.add('parallel-open');}
const style=document.createElement('style');style.textContent='.library-notice{font-size:11px;color:#657065;padding:4px 18px}.library-group{display:flex;align-items:center;gap:8px;padding-right:16px;border-right:1px solid #e0e4e2}.library-group>span{font-size:12px;color:#647069}.library-host[data-layout="1"] .parallel-grid{grid-template-columns:1fr}.library-dialog{position:fixed;inset:0;z-index:100003;background:#182a3544;display:grid;place-items:center}.library-dialog>section{background:white;border-radius:24px;padding:20px;max-width:680px;width:calc(100% - 40px);max-height:80vh;overflow:auto;box-shadow:0 8px 40px #0003}.library-dialog button,.library-dialog select{min-height:40px;margin:4px;padding:8px 14px;border:0;border-radius:18px}.library-dialog h2{font-size:18px}.library-row{display:flex;align-items:center;gap:8px;border-bottom:1px solid #edf0ed;padding:8px 0}.library-row span{flex:1}.library-dialog input{min-height:40px;width:90%;padding:4px 10px}.library-pane>header{justify-content:flex-end}.library-pane>header span{margin-right:auto;font-size:11px;color:#647069}.library-host [data-library-status]{margin:6px 18px;font-size:12px;color:#657065}';document.head.append(style);
const visibilityObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
 for(const entry of entries){const p=[...panes.values()].find(p=>p.frame===entry.target);if(!p)continue;p.visible=entry.isIntersecting;
  if(p.ready){p.frame.contentWindow._editorHostCovered=!p.visible;if(p.visible)p.frame.contentWindow.invalidate3D?.();}
 }
},{root:q('[data-library-grid]',shell)}):null;
function status(value){const message=value?.message||String(value);const text=value?.name==='QuotaExceededError'?'空き容量が不足して保存できません。未保存の編集は保持しています。各画面からJSONを書き出して保全してください。':message==='unsupported_revision_codec'?'この保存版は新しい形式のため開けません。原本は変更していません。対応するアプリで確認してください。':message;q('[data-library-status]',shell).textContent=text;if(native){const label=q('[data-library-dirty]');if(label)label.title=text;const hint=q('#st-hint');if(hint)hint.textContent=text;}}
function child(p){return p.frame.contentWindow?.EditorPane;}
function anyPaneBusy(){return [...panes.values()].some(p=>p.busy||p.frame.contentWindow?.SHARED?.saveBusy);}
function controlsLocked(){return busy||transitionBusy||anyPaneBusy();}
function cameraReady(p){return !!p?.ready&&!p.installing&&!p.busy&&!p.frame.contentWindow?.SHARED?.saveBusy;}
function synchronizeViews(source){if(!cameraReady(source))return false;const from=child(source).view();for(const p of panes.values())if(p!==source&&cameraReady(p)){const v=child(p).view();v.twoD=from.twoD;if(from.camera&&v.camera&&((from.view==='3d-walk')===(v.view==='3d-walk')))v.camera=from.camera;child(p).applyView(v);}return true;}
function valid(p,fromNativeSave=false){if(!p?.ready||p.installing||p.busy||!fromNativeSave&&p.frame.contentWindow?.SHARED?.saveBusy)throw Error('編集画面の処理完了をお待ちください。');return p;}
// Host-owned copies keep saved state without retaining a detached editor realm.
function state(p){return cloneEditorPaneState(child(p).state());}
// Detached session-only evidence. Never written to saveDraft, DATA, views or revisions.
// No eviction: exceeding either encoded-source budget cancels the transition.
const importMementos=new Map(),IMPORT_PLAN_LIMIT=64*1024*1024,IMPORT_SESSION_LIMIT=128*1024*1024,IMPORT_PLAN_COUNT=16;
function retainImport(p){
 const flow=p.frame.contentWindow?.PlanImport;if(!flow?.capture)return;
 const saved=flow.capture(),key=JSON.stringify([session,p.planId]);
 // A mounted empty controller reflects reset; a boot realm must not erase retained source.
 if(!flow.hasUnexportedReview?.()&&!saved.reference){if(p.ready)importMementos.delete(key);return saved;}
 const encoded=JSON.stringify(saved),bytes=new TextEncoder().encode(encoded).byteLength;
 let total=bytes;for(const [id,entry]of importMementos)if(id!==key)total+=entry.bytes;
 if(bytes>IMPORT_PLAN_LIMIT||total>IMPORT_SESSION_LIMIT||!importMementos.has(key)&&importMementos.size>=IMPORT_PLAN_COUNT)throw Error('原図・確認結果の一時保全容量（1案64MB／この作業128MB・16案）を超えるため画面を閉じていません。確認メモをJSONに保存し、必要なら元の入力をやり直してください。現在の入力は保持しています。');
 importMementos.set(key,{encoded,bytes});return saved;
}
async function withRetainedImport(p,work){
 const saved=retainImport(p),w=p.frame.contentWindow,flow=w.PlanImport,previous=w._editorPlanInstalling;
 if(!flow)return work();
 flow.invalidate({preserve:true});w._editorPlanInstalling=true;
 try{const result=await work(saved);if(result===false){w._editorPlanInstalling=previous;flow.restore(saved);}return result;}
 catch(error){w._editorPlanInstalling=previous;flow.restore(saved);throw error;}
 finally{w._editorPlanInstalling=previous;}
}
function restoreImport(p,id){const entry=importMementos.get(JSON.stringify([session,id]));p.frame.contentWindow?.PlanImport?.restore(entry?JSON.parse(entry.encoded):null);}
async function install(p,payload,saved,targetPlanId=p.planId,options){
 const priorImport=p.ready?retainImport(p):p.frame.contentWindow.PlanImport?.capture(),previousEditor=child(p).captureInstallState?.(),previousIdentity=p.frame.contentWindow.__editorPlanId;
 p.installEpoch=(p.installEpoch||0)+1;p.installing=true;p.frame.contentWindow._editorPlanInstalling=true;
 p.frame.contentWindow.PlanImport?.invalidate({preserve:true});
 try{
  const admission=await repo.admission(targetPlanId,payload);
  if(await child(p).install(payload,saved,admission,options)===false)throw Error('編集画面の読込を取り消しました。現在の編集は保持しています。');
  p.frame.contentWindow.__editorPlanId=targetPlanId;p.frame.contentWindow._editorPlanInstalling=false;
  restoreImport(p,targetPlanId);
 }catch(error){
  p.frame.contentWindow.__editorPlanId=previousIdentity;p.frame.contentWindow._editorPlanInstalling=false;
  if(previousEditor)child(p).restoreInstallState(previousEditor);
  p.frame.contentWindow.PlanImport?.restore(priorImport);throw error;
 }finally{p.installing=false;p.frame.contentWindow._editorPlanInstalling=false;}
}
function nativeNavigation(){if(native&&window.SHARED?.createPending)throw Error('共同編集ルームを作成中です。完了後に別のプランを開いてください。');if(native&&window.SHARED?.roomId)throw Error('共同編集中は別のプランへ切り替えられません。共同編集を終了してから開いてください。');}
function record(p){return plans.get(p.planId);}
function snapshot(p){const r=record(p),s=state(p),encoded=JSON.stringify(s.plan);if(r.lastPayload!==encoded){r.generation++;r.lastPayload=encoded;}r.state=s;r.plan=s.plan;return s;}
async function checkpoint(p){const r=record(p);if(r.baseRevisionId)return;const s=snapshot(p),result=await repo.save({planId:r.id,name:r.name,operationId:uid(),baseRevisionId:null,baseGeneration:0,payload:s.plan,kind:'unsaved-checkpoint',origin:{explicitlySaved:false}});if(result.status!=='saved')throw Error('未保存の編集保全が競合しました。');r.baseRevisionId=result.revisionId;r.baseGeneration=result.head.headGeneration;r.state.dirty=true;p.frame.contentWindow.markDirty();await persistDraft(p);}
async function persistDraft(p,captured){const r=record(p),s=captured||snapshot(p);const result=await repo.saveDraft(session,r.id,{...s,payload:s.plan,generation:r.generation,baseRevisionId:r.baseRevisionId,baseGeneration:r.baseGeneration});if(result.status==='conflict')throw Error('下書きの世代が競合しました。元の編集を保持しています。');return result;}
const roomContexts=new Map(),nativeActions=new Map();let nativeActionOwner=null,nativeActionRoom=null,nativeActionStatus='none';
function verifiedRoom(context,planId){return !!context&&/^[A-Za-z0-9_-]{22}$/.test(context.roomId||'')&&planId==='shared-room-'+context.roomId&&context.planId===planId&&typeof context.sourceSession==='string'&&Number.isSafeInteger(context.roomGeneration)&&context.roomGeneration>=0;}
function viewState(){return {roomContexts:Object.fromEntries([...roomContexts].filter(([id])=>retained.includes(id))),retainedPlanIds:retained.slice(),panelPlanIds:[...panes.values()].map(p=>p.planId),sync,cameras:Object.fromEntries([...panes.values()].filter(p=>p.ready).map(p=>[p.planId,child(p).view()]))};}
function persistView(){viewQueue=viewQueue.catch(()=>{}).then(()=>repo.setView(session,viewState()));return viewQueue;}
function modal(title){closeDialog();dialogReturnFocus=document.activeElement;dialog=document.createElement('div');dialog.className='library-dialog';const box=document.createElement('section'),heading=document.createElement('h2');heading.id='library-dialog-heading-'+dialogEpoch;heading.textContent=title;box.tabIndex=-1;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby',heading.id);box.append(heading);dialog.append(box);dialog.onclick=event=>{if(event.target===dialog)closeDialog();};document.body.append(dialog);box.focus?.();return box;}
function closeDialog(){++dialogEpoch;dialog?.remove();dialog=null;const focus=dialogReturnFocus;dialogReturnFocus=null;focus?.focus?.();const dismiss=dismissDialog;dismissDialog=null;dismiss?.();}
function button(box,title,action){const epoch=dialogEpoch,b=document.createElement('button');b.className='tbtn';b.textContent=title;b.onclick=()=>{if(epoch!==dialogEpoch)return false;return action();};box.append(b);return b;}
document.addEventListener('keydown',event=>{
 if(!dialog)return;
 // Own modal keyboard input before native document/window scene shortcuts.
 // Do not suppress browser text editing, copy/undo or select defaults.
 event.stopImmediatePropagation();
 if(event.key==='Escape'){event.preventDefault();closeDialog();return;}
 if(event.key!=='Tab')return;
 const box=q('section',dialog),items=[...box.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(element=>!element.disabled&&!element.hidden&&element.type!=='hidden'&&element.tabIndex!==-1&&(!element.getClientRects||element.getClientRects().length));
 const active=document.activeElement,inside=box.contains?.(active),target=event.shiftKey?(active===items[0]||active===box||!inside?items.at(-1):null):(active===items.at(-1)||active===box||!inside?items[0]:null);
 if(target||!items.length){event.preventDefault();(target||box).focus?.();}
},true);
async function chooseDirty(p,reviewOnly=false){if(!state(p).dirty&&!reviewOnly)return true;return new Promise(resolve=>{const box=modal('「'+record(p).name+'」の未保存の編集');if(reviewOnly){const note=document.createElement('p');note.textContent='原図と確認結果はこの作業中だけ保持します。通常のプラン保存には原図の画像を含みません。再読み込みやタブ終了の前に、既存の「確認メモをJSONに保存」と元のPDF・画像で保全してください。';box.append(note);}let answered=false;const finish=v=>{if(answered)return;answered=true;dismissDialog=null;closeDialog();resolve(v);};dismissDialog=()=>{if(!answered){answered=true;resolve(false);}};button(box,'保存して続ける',()=>finish('save')).dataset.libraryDecision='save';button(box,'保存せず続ける',()=>finish('discard')).dataset.libraryDecision='discard';button(box,'キャンセル',()=>finish(false)).dataset.libraryDecision='cancel';}).then(async choice=>{if(!choice)return false;if(choice==='save'){authorizedSavePane=p.id;try{if(!await p.frame.contentWindow.savePlanToStorage())return false;return !state(p).dirty;}finally{authorizedSavePane=null;}}
 if(reviewOnly)return true;
 const r=record(p),s=snapshot(p);await repo.saveDraft('discard:'+uid(),r.id,{...s,payload:s.plan,generation:r.generation,baseRevisionId:r.baseRevisionId,baseGeneration:r.baseGeneration});const saved=await repo.read(r.id);if(!saved)return true;await install(p,saved.payload,{view:s.view,cataloguePack:s.cataloguePack,dirty:false});r.state=state(p);r.generation++;r.lastPayload=JSON.stringify(r.state.plan);r.baseRevisionId=saved.revision.id;r.baseGeneration=saved.head.headGeneration;await persistDraft(p);return true;});}
async function loadRecord(id){const cached=plans.get(id);if(cached?.state?.dirty)return cached;const saved=await repo.read(id);if(cached&&cached.baseRevisionId===saved?.revision.id&&cached.baseGeneration===saved?.head.headGeneration)return cached;if(!saved)throw Error('プランがありません。');const storedDraft=await repo.get('drafts',JSON.stringify([session,id])),draft=storedDraft&&(storedDraft.dirty||storedDraft.baseRevisionId===saved.revision.id&&storedDraft.baseGeneration===saved.head.headGeneration)?storedDraft:null;const recovery=(!draft&&saved.head.recoveredUnsaved)?await repo.get('drafts',JSON.stringify(['recovery:'+saved.head.origin.snapshotId,id])):null,s=draft||recovery;const r={id,name:saved.head.name,plan:s?.plan||s?.payload||saved.payload,state:s?{plan:s.plan||s.payload,history:s.history||[],redo:s.redo||[],view:s.view,dirty:!!s.dirty||saved.revision.kind==='unsaved-checkpoint',cataloguePack:s.cataloguePack}:saved.revision.kind==='unsaved-checkpoint'?{plan:saved.payload,history:[],redo:[],dirty:true}:null,generation:s?.generation||0,baseRevisionId:s?.baseRevisionId||saved.revision.id,baseGeneration:s?.baseGeneration||saved.head.headGeneration};if(cached){r.generation=Math.max(r.generation,cached.generation+1);if(!s)r.state={plan:r.plan,history:[],redo:[],dirty:false,view:cached.state?.view,cataloguePack:cached.state?.cataloguePack};}r.lastPayload=JSON.stringify(r.plan);plans.set(id,r);return r;}
function refresh(){const locked=controlsLocked();shell.dataset.layout=panes.size===1?'1':'2';for(const p of panes.values()){p.remove.disabled=locked||!p.ready;if(!p.ready)continue;const w=p.frame.contentWindow,r=record(p);p.frame.title=r.name+'の既存エディター';p.remove.title='「'+r.name+'」の画面を閉じる';p.remove.setAttribute('aria-label',p.remove.title);const select=q('[data-library-current]',w.document);if(!select)continue;select.replaceChildren();for(const id of retained){const r=plans.get(id);if(!r)continue;const op=document.createElement('option');op.value=id;op.textContent=r.name;op.disabled=[...panes.values()].some(other=>other!==p&&other.planId===id);select.append(op);}if(native)for(const [id,name] of [['__open__','▤ プランを開く…'],['__new__','＋ 新しいプラン…']]){const op=document.createElement('option');op.value=id;op.textContent=name;select.append(op);}select.value=p.planId;select.disabled=locked;const save=q('#save-btn',w.document);if(save)save.disabled=locked;for(const b of w.document.querySelectorAll('[data-library-action]'))b.disabled=locked;q('[data-library-dirty]',w.document).textContent=w.DIRTY||!record(p)?.baseRevisionId?'● 未保存':'✓ 保存済み';p.label.textContent='';}for(const b of shell.querySelectorAll('.parallel-controls button'))b.disabled=locked;q('[data-parallel-sync]',shell).disabled=locked;}
async function mount(id){if(native){const r=await loadRecord(id),p=panes.get(NATIVE_EDITOR_PANE);if(!p)throw Error('編集画面の初期化をお待ちください。');await install(p,r.plan,r.state,id);p.planId=id;window.__editorPlanId=id;return p;}if(panes.size>=2)throw Error('同時に開ける画面は2つです。');const r=await loadRecord(id),paneId='library-pane-'+(++sequence)+'-'+uid(),card=document.createElement('section'),header=document.createElement('header'),label=document.createElement('span'),remove=document.createElement('button'),frame=document.createElement('iframe');card.className='parallel-pane library-pane';remove.className='tbtn parallel-pane-remove';remove.textContent='×';remove.title='このプランの画面を閉じる';remove.dataset.libraryClose='';remove.setAttribute('aria-label','このプランの画面を閉じる');header.append(label,remove);card.append(header,frame);frame.title=r.name+'の既存エディター';const p={id:paneId,planId:id,card,frame,label,remove,ready:false};panes.set(paneId,p);q('[data-library-grid]',shell).append(card);remove.onclick=()=>api.run(()=>api.closePlan(paneId));frame.onpointerenter=()=>{if(!controlsLocked()&&cameraReady(p))activeId=paneId;};let timer;
try{
 const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(Error('編集画面を読み込めませんでした。'));timer=setTimeout(()=>reject(Error('編集画面の読み込みが時間内に完了しませんでした。')),30000);});
 frame.src='/index.html?editorPane='+paneId+'&planLibrary=1';await loaded;
 if(!child(p))throw Error('編集画面の初期化に失敗しました。保存済みプランは変更していません。');
 await child(p).ready;frame.contentWindow.__editorPlanId=id;await install(p,r.plan,r.state);
 p.ready=true;visibilityObserver?.observe(frame);activeId=activeId||paneId;refresh();if(sync)synchronizeViews(panes.get(activeId)||p);return p;
}catch(error){await dispose(p);throw error;}finally{clearTimeout(timer);frame.onload=null;frame.onerror=null;}}

async function dispose(p,importRetained=false){if(native)return;if(!importRetained)retainImport(p);visibilityObserver?.unobserve(p.frame);child(p)?.dispose();panes.delete(p.id);if(activeId===p.id)activeId=panes.keys().next().value||null;try{if(!panes.size)await pool.dispose();}finally{p.card.remove();refresh();}}
async function createBlankPlan(name){nativeNavigation();name=String(name||'新しいプラン').trim().slice(0,80)||'新しいプラン';const id='plan-'+uid(),result=await repo.save({planId:id,name,operationId:uid(),baseRevisionId:null,baseGeneration:0,payload:{walls:[],rooms:[],items:[],startMode:'blank'}});if(result.status!=='saved')throw Error('新しいプランを保存できませんでした。');if(retained.length>=4||!native&&panes.size>=2){status('新しいプラン「'+name+'」を共通一覧に保存しました。現在の画面は保持しています。画面を閉じるか作業対象を外してから「開く」で選んでください。');return {id,opened:false};}try{const opened=await api.openPlan(id);if(!opened)status('新しいプラン「'+name+'」は共通一覧に保存済みです。現在の画面は保持しています。「開く」から選べます。');return {id,opened:!!opened};}catch(error){throw Error(error.message+' 新しいプラン「'+name+'」は共通一覧に保存済みです。「開く」から回収できます。');}}
const api=window.PlanLibrary=window.ParallelEditors={repo,async validateDerivedPlan(planId,payload){const cap=await repo.admission(planId,payload);return repo.validateAdmission(payload,cap);},plans,panes,modelPool:pool,get activeId(){return activeId;},get session(){return session;},get retained(){return retained.slice();},get nativeActionStatus(){return nativeActionStatus;},get nativeActionOwner(){return nativeActionOwner&&panes.get(NATIVE_EDITOR_PANE)?.planId===nativeActionOwner.ownedPlanId?copy(nativeActionOwner):null;},get nativeActionRoomId(){return nativeActionRoom&&panes.get(NATIVE_EDITOR_PANE)?.planId==='shared-room-'+nativeActionRoom?nativeActionRoom:null;},childReady(){refresh();},refresh,
 async run(fn){if(controlsLocked()){status('保存／読込中の画面があります。完了後に操作してください。');return false;}busy=true;refresh();try{return await fn();}catch(e){status(e);return false;}finally{busy=false;refresh();}},
 resetImport(id,sourceWindow){const p=panes.get(id);if(p&&p.frame.contentWindow===sourceWindow)importMementos.delete(JSON.stringify([session,p.planId]));},
 edited(id){const p=panes.get(id);if(p?.ready&&!p.installing){const captured=snapshot(p);refresh();if(record(p)?.baseRevisionId)persistDraft(p,captured).catch(status);}},
 changed(id,options){const source=panes.get(id);if(controlsLocked()||!cameraReady(source))return false;activeId=id;if(sync&&options?.cameraChanged!==false)synchronizeViews(source);api.persistCameras();return true;},
 persistCameras(){clearTimeout(api.cameraTimer);api.cameraTimer=setTimeout(()=>{const cameras=viewState().cameras;viewQueue=viewQueue.catch(()=>{}).then(()=>repo.updateView(session,previous=>({...previous,cameras,sync}))).catch(status);},200);},
 align(){if(controlsLocked())return false;const source=panes.get(activeId)||[...panes.values()].find(cameraReady);if(!synchronizeViews(source))return false;api.persistCameras();return true;},
 setSync(value){if(controlsLocked()){q('[data-parallel-sync]',shell).checked=sync;status('保存／画面切替の完了後に画角を操作してください。');return false;}sync=!!value;q('[data-parallel-sync]',shell).checked=sync;if(sync)api.align();persistView().catch(status);return true;},
 // Converted/partial plans use this same inventory, draft and CAS repository.
 // With two visible panes the clone is retained for the ordinary switch flow.
 async createIndependentPlan(payload,name,options={}){
  if(busy)throw Error('一覧の保存／読込が完了してから作成してください。');
  const check=()=>{if(options.sourcePaneId){const p=panes.get(options.sourcePaneId);if(!p||p.planId!==options.sourcePlanId||p.frame.contentWindow._editorPaneDisposed)throw Error('元の画面が切り替わりました。');if(options.sourceSnapshot!==undefined&&JSON.stringify(state(p).plan)!==options.sourceSnapshot)throw Error('元の案が更新されました。プレビューを開き直してください。');}if(options.signal?.aborted)throw options.signal.reason||new DOMException('作成を取り消しました。','AbortError');if(options.isCurrent&&!options.isCurrent())throw Error('元の案／確認内容が更新されました。プレビューを開き直してください。');};
  check();if(retained.length>=4)throw Error('比較は4案までです。保存してから比較対象の画面を閉じてください。');
  const plan=copy(payload);
  const title=String(name||'新しい案').trim().slice(0,80);if(!title)throw Error('新しい案の名前を入力してください。');
  if(!options.sourcePaneId||!options.sourcePlanId)throw Error('保存済みプランの通常の編集画面から作成してください。');
  const source=valid(panes.get(options.sourcePaneId)),sourceRecord=record(source),sourceWindow=source.frame.contentWindow;
  if(source.planId!==options.sourcePlanId||!sourceRecord||sourceWindow._editorPaneDisposed)throw Error('元の画面が切り替わりました。');
  if(sourceRecord.memoryOnly||source.memoryOnly||sourceWindow.COMPARISON_PREVIEW)throw Error('隔離プレビューから保存可能な案は作成できません。');
  if(typeof options.sourceSnapshot!=='string'||typeof options.isCurrent!=='function')throw Error('元の案のプレビューを確認してから作成してください。');
  let sourceState,sourceRevision,sourceTicket;
  {sourceState=snapshot(source);await checkpoint(source);await persistDraft(source);check();
   const saved=await repo.read(source.planId),r=record(source);check();
   if(r.baseRevisionId&&(!saved||saved.revision.id!==r.baseRevisionId||saved.head.headGeneration!==r.baseGeneration))throw Error('元の保存版が更新されました。再読み込みして確認してください。');sourceRevision=saved?.revision.id||null;sourceTicket=await repo.prepareDerivationSource(source.planId,sourceRevision,JSON.stringify([session,source.planId]),r.generation);check();
  }
  check();const admission=await repo.admission(source.planId,sourceState.plan),checked=repo.validateAdmission(plan,admission);if(!checked.ok)throw Error('新しい案の形式を確認できませんでした。');
  check();const id='plan-'+uid(),previous=retained.slice();let committed=false,mounted,viewCommitted=false;
  try{
   const saved=await repo.derive({planId:id,name:title,operationId:uid(),baseRevisionId:null,baseGeneration:0,payload:plan,kind:'derived-plan',origin:{copiedFromPlanId:source.planId,copiedFromRevisionId:sourceRevision}},source.planId,sourceRevision,sourceTicket,{isCurrent:()=>{try{check();return true;}catch(_){return false;}}});
   if(saved.status!=='saved')throw Error('新しい案の保存が競合しました。');committed=true;check();
   const draft=await repo.saveDraft(session,id,{plan,payload:plan,history:[],redo:[],view:options.view||sourceState?.view,dirty:true,cataloguePack:options.cataloguePack,generation:0,baseRevisionId:saved.revisionId,baseGeneration:saved.head.headGeneration});
   if(draft.status==='conflict')throw Error('新しい案の下書きが競合しました。');check();
   await loadRecord(id);check();retained.push(id);if(!native&&panes.size<2)mounted=await mount(id);check();await persistView();viewCommitted=true;check();
   status(native?'新しい案「'+title+'」を共通一覧と切替欄へ追加しました。元の案の編集画面は保持しています。':mounted?'新しい案「'+title+'」を別の画面で開きました。元の案は保持しています。':'新しい案「'+title+'」を共通一覧と切替欄へ追加しました。表示中の2画面は保持しています。');return id;
  }catch(error){
   retained=previous;if(mounted)await dispose(mounted);plans.delete(id);refresh();
   if(viewCommitted)try{await persistView();}catch(recoveryError){error=new Error(error.message+' 画面配置の復元を保存できませんでした。'+recoveryError.message);}
   if(committed)throw Error(error.message+' 新しい案は共通一覧に保存済みです。「開く」から回収できます。元の案は変更していません。');throw error;
  }
 },
 async openPlan(id){
  nativeNavigation();if([...panes.values()].some(p=>p.planId===id))return true;
  if(!retained.includes(id)&&retained.length>=4)throw Error('作業対象は4案までです。保存済み一覧の案は削除されません。');
  if(!native&&panes.size>=2)throw Error('開いている画面を閉じてから別のプランを開いてください。');
  await loadRecord(id);const previous=retained.slice();if(!retained.includes(id))retained.push(id);let mounted;
  try{if(native){if(!await nativeSwitchPlan(NATIVE_EDITOR_PANE,id)){retained=previous;refresh();return false;}}else{mounted=await mount(id);await persistView();}}
  catch(error){if(mounted)await dispose(mounted);retained=previous;refresh();throw error;}
  refresh();status('プランを開きました。');return true;
 },
 async switchPlan(paneId,id){
  nativeNavigation();const p=valid(panes.get(paneId));if(p.planId===id)return true;
  if([...panes.values()].some(other=>other!==p&&other.planId===id))throw Error('このプランはもう一方で開いています。');
  const r=await loadRecord(id);if(!await chooseDirty(p)){refresh();return false;}
  return withRetainedImport(p,async()=>{await checkpoint(p);await persistDraft(p);const previousId=p.planId,previousState=state(p);p.ready=false;
  try{await install(p,r.plan,r.state,id);p.planId=id;p.frame.contentWindow.__editorPlanId=id;await persistView();}
  catch(error){p.planId=previousId;p.frame.contentWindow.__editorPlanId=previousId;try{await install(p,previousState.plan,previousState);}catch(recoveryError){throw Error(error.message+' 元の案の編集は下書きに保持しています。画面の復元に失敗しました: '+recoveryError.message);}throw error;}
  finally{p.ready=true;refresh();}
  status('編集中のプランを切り替えました。');return true;});
 },
 async closePlan(paneId){nativeNavigation();if(native)throw Error('通常の編集画面は閉じません。切替欄から別のプランを選んでください。');if(anyPaneBusy())throw Error('保存中の画面があります。完了後に閉じてください。');const p=valid(panes.get(paneId));return withRetainedImport(p,async()=>{if(p.frame.contentWindow.PlanImport?.hasUnexportedReview()&&!await chooseDirty(p,true))return false;await persistDraft(p);const captured=viewState();captured.panelPlanIds=captured.panelPlanIds.filter(id=>id!==p.planId);captured.retainedPlanIds=captured.retainedPlanIds.filter(id=>id!==p.planId);await repo.setView(session,captured);retained=captured.retainedPlanIds;await dispose(p,true);status('画面を閉じました。未保存の編集・保存済みプラン・履歴は保持しています。');return true;});},
 async persistPane(paneId,id,data){if((busy||transitionBusy)&&authorizedSavePane!==paneId)throw Error('画面の配置／読込を処理中です。編集は保持しています。完了後に保存してください。');const p=valid(panes.get(paneId),true);if(p.planId!==id)throw Error('保存対象が変わりました。');if(native&&window.SHARED?.roomId&&id!=='shared-room-'+window.SHARED.roomId)throw Error('共同編集の保存先の切替が完了していません。現在の編集は保持しています。');const r=record(p),s=snapshot(p),generation=r.generation,baseRevisionId=r.baseRevisionId,baseGeneration=r.baseGeneration;p.busy=true;refresh();try{const draftResult=await repo.saveDraft(session,id,{...s,plan:copy(data),payload:copy(data),generation,baseRevisionId,baseGeneration});if(draftResult.status==='conflict')throw Error('下書きの世代が競合しました。編集内容を保全しました。');const result=await repo.save({planId:id,payload:data,name:r.name,operationId:uid(),baseRevisionId,baseGeneration,sessionId:session,draftGeneration:generation});if(result.status!=='saved')throw Error('別画面の保存と競合しました。編集内容と競合版を保持しました。履歴で確認してください。');r.baseRevisionId=result.revisionId;r.baseGeneration=result.head.headGeneration;snapshot(p);if(r.generation===generation&&result.canClean){r.state.dirty=false;r.plan=copy(data);}else await persistDraft(p);await persistView();status('「'+r.name+'」を同じプランIDへ保存しました。');return result;}catch(error){status(error);throw error;}finally{p.busy=false;refresh();}},
 async readSavedPane(id){return (await repo.read(id))?.payload||null;},
 async reloadPlan(paneId){const p=valid(panes.get(paneId));if(!record(p).baseRevisionId)return api.legacyList();if(!await chooseDirty(p))return false;const r=record(p),saved=await repo.read(r.id),current=state(p);await install(p,saved.payload,{view:current.view,cataloguePack:current.cataloguePack,dirty:false});r.baseRevisionId=saved.revision.id;r.baseGeneration=saved.head.headGeneration;r.generation++;r.lastPayload=JSON.stringify(child(p).snapshot());await persistDraft(p);refresh();status('保存したプランを開き直しました。');return true;},
 async duplicate(paneId){const p=valid(panes.get(paneId));if(!await chooseDirty(p))return false;const r=record(p),id='plan-'+uid();await repo.duplicate(r.id,id,r.name+'（複製）',uid());status('複製を別のプランIDで保存しました。共通一覧から開けます。');await api.list();},
 async history(paneId){const p=valid(panes.get(paneId)),r=record(p),box=modal('「'+r.name+'」の保存履歴');for(const rev of (await repo.history(r.id)).reverse()){const row=document.createElement('div');row.className='library-row';const span=document.createElement('span');span.textContent=rev.kind+' · '+rev.id.split(':').at(-1).slice(0,8)+(rev.id===r.baseRevisionId?'（現在の基準）':'');row.append(span);button(row,'この版を復元',()=>{closeDialog();api.run(async()=>{if(!await chooseDirty(p))return;const current=record(p);const result=await repo.restore(current.id,rev.id,current.baseRevisionId,current.baseGeneration,uid());if(result.status!=='saved')throw Error('復元が競合しました。現在の編集は変更していません。');const restored=await repo.read(current.id);await install(p,restored.payload);current.baseRevisionId=result.revisionId;current.baseGeneration=result.head.headGeneration;current.generation++;current.lastPayload=JSON.stringify(child(p).snapshot());await persistDraft(p);status('履歴を新しい保存版として復元しました。以前の版も残っています。');refresh();});}).dataset.libraryRestore=rev.id;box.append(row);}button(box,'閉じる',closeDialog);},
 async list(){const expectedEpoch=dialogEpoch;const recoverable=(await repo.draftSummaries()).filter(d=>d.sessionId!==session&&!String(d.sessionId).startsWith('discard:'));if(expectedEpoch!==dialogEpoch)return false;const box=modal('共通プラン一覧');for(const head of (await repo.list()).filter(h=>h.verified!==false)){const row=document.createElement('div');row.className='library-row';const text=document.createElement('span');text.textContent=head.name+(panes.size&&[...panes.values()].some(p=>p.planId===head.id)?'（編集中）':'');row.append(text);if(head.origin?.snapshotId&&!head.origin?.legacyCopy){button(row,'原本を確認',()=>api.run(()=>api.inspectOriginal(head.id)));button(row,'変換コピーを確認',()=>api.run(()=>api.reviewLegacyCopy(head.id))).dataset.libraryConvertReview=head.id;}else button(row,'開く',()=>{closeDialog();api.run(()=>api.openPlan(head.id));}).dataset.libraryOpenPlan=head.id;if(retained.includes(head.id)&&![...panes.values()].some(p=>p.planId===head.id))button(row,'作業対象から外す',()=>api.run(async()=>{retained=retained.filter(id=>id!==head.id);await persistView();refresh();await api.list();}));box.append(row);
const drafts=recoverable.filter(d=>d.planId===head.id);if(drafts.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='別タブの未保存編集を回収（'+drafts.length+'件）';details.append(summary);for(const draft of drafts){button(details,'未保存の編集 '+draft.generation+' を別案として回収',()=>{closeDialog();api.run(()=>api.recoverDraft(draft.id));}).dataset.libraryRecoverDraft=draft.id;}box.append(details);}}button(box,'旧保存を読み取り専用で一覧',()=>api.legacyList());button(box,'閉じる',closeDialog);},
 async recoverDraft(id){const draft=await repo.get('drafts',id);if(!draft?.dirty)throw Error('回収できる未保存の編集がありません。');const head=await repo.get('plans',draft.planId);const result=await repo.importSource({sourceId:'draft:'+id,kind:'workspace',raw:[{id:draft.planId,name:(head?.name||'プラン')+'（未保存の編集を回収）',plan:draft.payload||draft.plan,state:draft,explicitlySaved:false}]});if(!result.plans.length)throw Error('下書き原本を保全しましたが、この形式は開けません。');let recovered=result.plans[0].planId;if(head?.origin?.legacyCopy){const sourceTicket=await repo.prepareDerivationSource(draft.planId,draft.baseRevisionId,draft.id,draft.generation),newId='plan-'+uid();const saved=await repo.derive({planId:newId,name:(head.name||'プラン')+'（未保存の編集を回収）',operationId:uid(),baseRevisionId:null,baseGeneration:0,payload:draft.payload||draft.plan,kind:'recovered-derived-plan',origin:{copiedFromPlanId:draft.planId,copiedFromRevisionId:draft.baseRevisionId,archivedRecoveryPlanId:recovered}},draft.planId,draft.baseRevisionId,sourceTicket);if(saved.status!=='saved')throw Error('回収案の保存が競合しました。原本は保持しています。');recovered=newId;}if(panes.size<2&&(retained.length<4||retained.includes(recovered)))await api.openPlan(recovered);else await api.list();status('未保存の編集を別案として回収しました。元の保存版と下書きは変更していません。');return recovered;},
 async inspectOriginal(id){const expectedEpoch=dialogEpoch,original=await repo.read(id);if(expectedEpoch!==dialogEpoch)return false;const box=modal('保存原本（読み取り専用）');if(!original)throw Error('原本がありません。');const note=document.createElement('p');note.textContent='原本と元の保存版は変更していません。編集用コピーは別の案として作成できます。';box.append(note);const text=document.createElement('textarea');text.readOnly=true;text.value=JSON.stringify(original.payload,null,2);text.style.width='100%';text.style.height='40vh';box.append(text);button(box,'戻る',()=>api.list());},
 async reviewLegacyImport(raw,options={}){const expectedEpoch=dialogEpoch,current=()=>expectedEpoch===dialogEpoch&&(!options.isCurrent||options.isCurrent());const candidate=JSON.parse(raw);if(PlanSchema.validatePlan(candidate).ok)throw Error('このJSONは通常の読み込みで確認してください。');const report=LegacyPlanCopyDryRun.createDryRunHelper(PlanSchema)(candidate);if(!report.prepared)throw Error('原本を変更せず変換を中止しました: '+report.diagnostics.map(d=>d.code).join(', '));if(!current())return false;const archived=await repo.importSource({sourceId:'json-import:'+uid(),kind:'plan',name:'取り込みJSON原本',raw});if(!current())return false;if(archived.plans.length!==1)throw Error('JSON原本を保全しましたが、この形式は開けません。');return api.reviewLegacyCopy(archived.plans[0].planId,{...options,expectedEpoch});},
 async reviewLegacyCopy(id,options={}){const expectedEpoch=options.expectedEpoch??dialogEpoch,review=await repo.prepareLegacyCopy(id);if(expectedEpoch!==dialogEpoch||options.isCurrent&&!options.isCurrent())return false;const r=review.report,box=modal('原本を残して変換コピーを作成');const reviewEpoch=dialogEpoch,reviewCurrent=()=>reviewEpoch===dialogEpoch&&(!options.isCurrent||options.isCurrent());const note=document.createElement('p');note.textContent='壁・部屋・物の数、配置、寸法、階、既存設定と未知の項目を保持します。後の階で重複していたIDだけを変更します。対応が曖昧な参照は変換しません。';box.append(note);const summary=document.createElement('p');summary.textContent='ID変更 '+r.mapping.length+'件 / 設定キーのコピー '+r.settingsCopies.length+'件 / 長さゼロの壁 '+r.zeroLengthWalls.length+'件を原状保持。原本は別に確認できます。ゼロ長の壁を含む案はサーバー互換性未確認のため共有できません。JSON単体の再取り込みでは原本を残す変換確認が必要です。';box.append(summary);for(const entry of r.mapping){const row=document.createElement('p');row.textContent=entry.collection+'['+entry.index+']: '+entry.oldId+' → '+entry.newId;box.append(row);}button(box,'変換コピーを別案として保存',()=>{if(!reviewCurrent())return;closeDialog();const commitEpoch=dialogEpoch,commitCurrent=()=>commitEpoch===dialogEpoch&&(!options.isCurrent||options.isCurrent());api.run(async()=>{const check=()=>{if(!commitCurrent())throw Error('確認中の取り込みが更新されました。保存原本は一覧に保持しています。');};check();const head=await repo.get('plans',id);check();const newId='plan-'+uid();await repo.createLegacyCopy(review,newId,(head?.name||'旧保存')+'（変換コピー）',uid(),{isCurrent:commitCurrent});if(!commitCurrent())return newId;status('変換コピーを別のプランIDへ保存しました。共通一覧から選んで開いてください。原本は保持しています。');await api.list();return newId;});}).dataset.libraryConvertCommit=id;button(box,'キャンセル',()=>{closeDialog();return api.list();});},
 async legacyList(){const expectedEpoch=dialogEpoch,sources=await repo.readLegacySources();if(expectedEpoch!==dialogEpoch)return false;const box=modal('旧保存：読み取り専用 → コピー → 検証');const note=document.createElement('p');note.textContent='旧保存を削除・更新しません。選んだ原本の非破壊コピーを新しい一覧へ追加します。';box.append(note);for(const source of sources){const row=document.createElement('div');row.className='library-row';const span=document.createElement('span');span.textContent=source.sourceId;row.append(span);button(row,'非破壊コピーして検証',()=>api.run(async()=>{const result=await repo.importSource(source);if(result.diagnostic&&!result.plans.length)throw Error('原本を回収しましたが、この形式を開けません: '+result.diagnostic);status(result.plans.length+'案の原本を一覧へ保全しました。編集用の変換コピーは確認してから別案へ作成してください。旧原本は保持しています。'+(result.entryDiagnostics?.length?' '+result.entryDiagnostics.length+'案は形式を確認できないため原本保全のみです。':''));await api.list();})).dataset.libraryCopySource=source.sourceId;box.append(row);}if(!sources.length){const p=document.createElement('p');p.textContent='旧保存はありません。';box.append(p);}button(box,'戻る',()=>api.list());},

 async newPlan(){nativeNavigation();const box=modal('新しいプラン');const input=document.createElement('input');input.placeholder='プラン名';input.setAttribute('aria-label','プラン名');input.maxLength=80;input.value='新しいプラン';box.append(input);button(box,'作成して開く',()=>{const name=input.value.trim()||'新しいプラン';closeDialog();return api.run(()=>createBlankPlan(name));});if(window.LOCAL_PREVIEW_OFFLINE)button(box,'読み取り済み3階サンプルを確認（AIなし）',()=>{closeDialog();api.run(async()=>{const body=await(await fetch('/local-preview/sample.json')).json(),id='plan-'+uid();await repo.save({planId:id,name:'読み取り済み3階サンプル',operationId:uid(),baseRevisionId:null,baseGeneration:0,payload:{walls:[],rooms:[],items:[],startMode:'blank'}});await api.openPlan(id);const p=[...panes.values()].find(p=>p.planId===id),w=p.frame.contentWindow;w.openPlanImport();w.PlanImport.stageBuildingReview(body);w.document.getElementById('plan-import-status').textContent='読み取り済みのテストサンプルです。AIは実行していません。階を確認して部分適用できます。';status('読み取り済みサンプルを既存の取り込み確認UIで開きました。');});}).dataset.librarySample='';if(window.LOCAL_PREVIEW_OFFLINE)button(box,'図面で扉5点を確認した設定例（6点未確認・AIなし）',()=>{closeDialog();api.run(async()=>{if(panes.size>=2||retained.length>=4)throw Error('画面を1つ閉じてから設定例を開いてください。保存済み案は保持されます。');const payload=await(await fetch('/local-preview/source-reviewed-doors.json')).json(),id='plan-'+uid();await repo.save({planId:id,name:'図面確認例：扉5点／6点未確認',operationId:uid(),baseRevisionId:null,baseGeneration:0,payload});await api.openPlan(id);status('手動で図面を確認した方向設定例です。位置・幅は未実測で、4点に壁との干渉が残ります。既存案は上書きしていません。');});}).dataset.libraryReviewedDoors='';button(box,'キャンセル',closeDialog);},
 async layout(count){if(native)return; if(anyPaneBusy())throw Error('保存中の画面があります。完了後に配置を変更してください。');if(count===1&&panes.size===2){const p=[...panes.values()].find(p=>p.id!==activeId)||[...panes.values()][1];return withRetainedImport(p,async()=>{if(p.frame.contentWindow.PlanImport?.hasUnexportedReview()&&!await chooseDirty(p,true))return false;await persistDraft(p);const v=viewState();v.panelPlanIds=v.panelPlanIds.filter(id=>id!==p.planId);await repo.setView(session,v);await dispose(p,true);status('1画面に切り替えました。閉じた案の編集と履歴は作業対象に保持しています。切替欄から開けます。');return true;});}if(count===2&&panes.size<2){const id=retained.find(id=>![...panes.values()].some(p=>p.planId===id));if(!id)return api.list();let mounted;try{mounted=await mount(id);await persistView();status('作業対象の案を2画面で開きました。各画面のヘッダーから編集・保存できます。');}catch(error){if(mounted)await dispose(mounted);throw error;}}},
 hasUnsaved(){if([...panes.values()].some(p=>p.frame.contentWindow?.PlanImport?.hasUnexportedReview())||[...importMementos.values()].some(entry=>{const s=JSON.parse(entry.encoded).state;return !!(s.result||s.failedSceneResponse||s.imageSource||s.pages||s.pdfData);}))return true;const visible=new Set([...panes.values()].map(p=>p.planId));return [...panes.values()].some(p=>p.ready&&state(p).dirty)||retained.some(id=>!visible.has(id)&&plans.get(id)?.state?.dirty);}
};
const nativeSwitchPlan=api.switchPlan.bind(api);
// One transition owns its pane until all awaited persistence/install work completes.
for(const name of ['openPlan','switchPlan','closePlan','reloadPlan','layout','createIndependentPlan']){const original=api[name];api[name]=async function(){if(transitionBusy||anyPaneBusy())throw Error('保存／画面切替の完了後に操作してください。');transitionBusy=true;refresh();try{return await original.apply(api,arguments);}finally{transitionBusy=false;refresh();}};}
q('[data-library-open]',shell).onclick=()=>api.run(()=>api.list());q('[data-library-new]',shell).onclick=()=>api.run(()=>api.newPlan());for(const b of shell.querySelectorAll('[data-library-layout]'))b.onclick=()=>api.run(()=>api.layout(Number(b.dataset.libraryLayout)));q('[data-parallel-sync]',shell).onchange=e=>api.setSync(e.target.checked);q('[data-parallel-align]',shell).onclick=()=>api.align();
window.addEventListener('beforeunload',e=>{if(api.hasUnsaved()){e.preventDefault();e.returnValue='';}});
refresh();
if(native){
 const id='plan-'+uid(),p={id:NATIVE_EDITOR_PANE,planId:id,frame:{contentWindow:window},card:shell,label:document.createElement('span'),remove:document.createElement('button'),ready:true};
 plans.set(id,{id,name:'現在のプラン '+id.slice(-6),plan:child(p).snapshot(),state:state(p),generation:0,baseRevisionId:null,baseGeneration:0,lastPayload:JSON.stringify(child(p).snapshot())});
 retained=[id];panes.set(p.id,p);activeId=p.id;window.__editorPlanId=id;attachCurrentEditor(api,p.id);
}
api.withSharedIdentity=async function(roomId,install){
 if(!native||typeof install!=='function'||!roomId)throw Error('共同編集の保存先を確認できませんでした。');
 if(!initializing&&(busy||transitionBusy||anyPaneBusy()))throw Error('保存／画面切替の完了後に共同編集へ接続してください。');
 const p=panes.get(NATIVE_EDITOR_PANE),editor=child(p),id='shared-room-'+roomId,previousId=p.planId,previousTransition=transitionBusy,previousLifecycle=window.SHARED?.roomGeneration||0;
 if(typeof editor?.captureInstallState!=='function'||typeof editor.restoreInstallState!=='function')throw Error('共同編集の復元機能を準備できません。現在の編集は変更していません。');
 return withRetainedImport(p,async(previousImport)=>{
 transitionBusy=true;refresh();let transaction;
 try{
  let saved;if(previousId!==id){
   const before=state(p),r=record(p);if(!initializing&&(r.baseRevisionId||before.dirty||before.plan.walls.length||before.plan.items.length||before.plan.rooms.length)){
    await checkpoint(p);await persistDraft(p);await persistView();
   }
   saved=await repo.read(id);
   if(!initializing&&record(p).baseRevisionId)await persistDraft(p);
  }
  if(p.planId!==previousId||(window.SHARED?.roomGeneration||0)!==previousLifecycle)throw Error('共同編集の接続操作が更新されました。現在の編集は変更していません。');
  const shared=window.SHARED,sharedBefore={...shared};for(const key of ['baseline','confirmedSave','people','dirtyIds'])if(shared[key]!==undefined)sharedBefore[key]=copy(shared[key]);
  transaction={importReview:previousImport,editor:editor.captureInstallState(),shared:sharedBefore,records:new Map([...plans].map(([key,value])=>[key,copy(value)])),retained:retained.slice(),planId:p.planId,editorPlanId:window.__editorPlanId,url:location.href,historyState:window.history?.state,inert:document.body.inert};
  // No user gesture can enter the partially installed scene while its draft and
  // view commit. Old asynchronous room work is invalidated at this boundary.
  document.body.inert=true;p.installing=true;p.installEpoch=(p.installEpoch||0)+1;window._editorPlanInstalling=true;window.PlanImport?.invalidate({preserve:true});shared.installing=true;shared.roomGeneration=(shared.roomGeneration||0)+1;
  install();
  if(previousId!==id){
   const r={id,name:'共同編集のプラン',plan:editor.snapshot(),state:state(p),generation:0,baseRevisionId:saved?.revision.id||null,baseGeneration:saved?.head.headGeneration||0};r.lastPayload=JSON.stringify(r.plan);plans.set(id,r);
   const keepPrevious=!!plans.get(previousId)?.baseRevisionId;retained=[id,...retained.filter(x=>x!==id&&(x!==previousId||keepPrevious))].slice(0,4);p.planId=id;window.__editorPlanId=id;
  }
  window._editorPlanInstalling=false;restoreImport(p,id);
  snapshot(p);const confirmed=shared.confirmedSave;if(confirmed?.roomId===roomId)confirmed.planId=id;
  if(record(p).baseRevisionId){await persistDraft(p);await persistView();}
  for(const key of ['timer','localAutoTimer','rebuildTimer','reconnectTimer']){clearTimeout(transaction.shared[key]);shared[key]=null;}
  shared.sending=false;shared.sendPromise=null;shared.refreshing=false;shared.refreshPromise=null;shared.installing=false;shared.connectAfterInstall=false;p.installing=false;document.body.inert=transaction.inert;
  if(nativeActionOwner?.ownedPlanId===previousId)nativeActionOwner.ownedPlanId=id;
  nativeActionRoom=null;
  // Connection/render failure after the data commit is a connection error, not
  // permission to resume an ordinary plan under a joined room identity.
  try{window.connectSharedSocket?.();window.renderSharedUi?.();if(shared.pending||window.sharedHasTrackedChanges?.())window.queueSharedSync?.(600);}catch(error){status(error);}
  return true;
 }catch(error){
  if(transaction){
   const shared=window.SHARED,generation=(shared.roomGeneration||0)+1;
   if(shared.socket!==transaction.shared.socket)try{shared.socket?.close(1000,'rollback');}catch(_){}
   for(const key of Object.keys(shared))delete shared[key];Object.assign(shared,transaction.shared,{roomGeneration:generation,installing:false,connectAfterInstall:false,sending:false,sendPromise:null,refreshing:false,refreshPromise:null});
   plans.clear();for(const [key,value]of transaction.records)plans.set(key,value);retained=transaction.retained;p.planId=transaction.planId;window.__editorPlanId=transaction.editorPlanId;
   try{window.history?.replaceState(transaction.historyState,'',transaction.url);}catch(recoveryError){console.warn('[WebCAD] room URL recovery',recoveryError);}
   window._editorPlanInstalling=false;editor.restoreInstallState(transaction.editor);window.PlanImport?.restore(transaction.importReview);
   try{await persistView();}catch(recoveryError){console.warn('[WebCAD] room view recovery',recoveryError);}
   // An invalidated old request cannot finish a restored room's pending work.
   // Reconnect and scan the retained DATA rather than borrowing its response.
   if(shared.roomId){shared.forceScan=true;try{window.connectSharedSocket?.();window.queueSharedSync?.();}catch(recoveryError){console.warn('[WebCAD] room connection recovery',recoveryError);}}
   try{window.renderSharedUi?.();}catch(recoveryError){console.warn('[WebCAD] room UI recovery',recoveryError);}
  }
  status(error);try{window.sharedSetStatus?.(error.message,true);}catch(_){}throw error;
 }finally{window._editorPlanInstalling=false;if(transaction)document.body.inert=transaction.inert;p.installing=false;transitionBusy=previousTransition;refresh();}
 });
};
// The existing pane header delegates only to its actual host-owned editor.
// Tickets live in the existing views store; plans never travel in a URL or a
// message. This is application ownership, not a same-origin security boundary.
function actionState(draft){return copy({plan:draft.payload||draft.plan,history:draft.history||[],redo:draft.redo||[],view:draft.view,dirty:!!draft.dirty,cataloguePack:draft.cataloguePack});}
function ticketShape(view,token){
 const t=view?.nativeAction,o=t?.source;
 return !!t&&t.version===1&&t.role==='native-action'&&t.action==='share'&&t.token===token&&t.status==='prepared'&&Number.isSafeInteger(t.expiresAt)&&t.expiresAt>Date.now()&&Number.isSafeInteger(t.preparedAt)&&t.preparedAt<=Date.now()&&t.expiresAt-t.preparedAt<=300000&&typeof t.planId==='string'&&t.planId.length>0&&t.planId.length<=256&&/^[a-f0-9]{64}$/.test(t.stateDigest||'')&&!!o&&typeof o.sessionId==='string'&&typeof o.paneId==='string'&&Number.isSafeInteger(o.installEpoch)&&o.installEpoch>=0&&o.planId===t.planId&&Number.isSafeInteger(o.generation)&&o.generation>=0&&typeof o.baseRevisionId==='string'&&Number.isSafeInteger(o.baseGeneration)&&o.baseGeneration>0&&view.retainedPlanIds?.length===1&&view.retainedPlanIds[0]===t.planId&&view.panelPlanIds?.length===1&&view.panelPlanIds[0]===t.planId&&(!t.roomContext||verifiedRoom(t.roomContext,t.planId));
}
async function abandonNativeTicket(entry){
 if(!entry.token)return;
 const v=await repo.get('views',entry.token);if(v?.nativeAction?.status!=='prepared')return;
 await repo.updateView(entry.token,previous=>({...previous,nativeAction:{...previous.nativeAction,status:'cancelled'}}),v.generation);
}
api.openNativeAction=function(paneId,action,sourceWindow){
 let p,r,entry,key;
 try{
  if(native||action!=='share')throw Error('この操作は比較の編集画面から開いてください。');
  p=valid(panes.get(paneId));r=record(p);
  if(sourceWindow!==p.frame.contentWindow||p.memoryOnly||r.memoryOnly||sourceWindow.COMPARISON_PREVIEW||sourceWindow._editorPaneDisposed||sourceWindow.__editorPlanId!==p.planId)throw Error('元の編集画面を確認できませんでした。');
  key=JSON.stringify([session,p.id,p.planId,action]);entry=nativeActions.get(key);
  if(entry&&!entry.target.closed){
   let destination;try{destination=entry.target.PlanLibrary;}catch(_){entry.target.focus?.();status('共同編集の通常タブの状態を確認できません。そのタブで確認してください。比較の編集と下書きは保持しています。');return Promise.resolve(false);}
   if(entry.navigated&&(destination?.nativeActionStatus==='failed'||destination?.nativeActionStatus!=='ready'&&entry.expiresAt<=Date.now())){nativeActions.delete(key);abandonNativeTicket(entry).catch(()=>{});entry=null;}
   else{if(entry.navigated&&destination?.nativeActionStatus==='ready'&&(destination.nativeActionOwner?.sourceSession!==session||destination.nativeActionOwner?.sourcePlanId!==r.id||entry.target.__editorPlanId!==destination.nativeActionOwner?.ownedPlanId)){status('共同編集の通常タブは別のプランへ切り替わっています。そのタブで確認してください。比較の編集は保持しています。');entry.target.focus?.();return Promise.resolve(false);}entry.target.focus?.();if(entry.navigated&&destination?.nativeActionStatus!=='ready'){status('共同編集の通常タブで下書きを復元しています。まだ準備を確認できません。比較の編集と下書きは保持しています。');return Promise.resolve(false);}status('共同編集の通常タブを表示しました。比較の編集と配置は保持しています。');return entry.promise||Promise.resolve(true);}
  }
  if(controlsLocked())throw Error('保存／画面切替の完了後に共同編集を開いてください。');
  const roomContext=roomContexts.get(p.planId);if(String(p.planId).startsWith('shared-room-')&&!verifiedRoom(roomContext,p.planId))throw Error('元の共同編集ルームを確認できません。共有URLから通常の編集画面で再接続してください。比較の編集は保持しています。');
  // Synchronous with the original header click, before the first await.
  const target=window.open('about:blank','_blank');if(!target){status('共同編集のタブを開けませんでした。ブラウザでポップアップを許可してください。比較の編集は保持しています。');return Promise.resolve(false);}
  try{target.opener=null;}catch(error){target.close();throw error;}entry={target,navigated:false,cancelled:false,token:null};nativeActions.set(key,entry);
  const captured=actionState(snapshot(p)),owner={sessionId:session,paneId:p.id,planId:p.planId,installEpoch:p.installEpoch||0,generation:r.generation,baseRevisionId:r.baseRevisionId,baseGeneration:r.baseGeneration};let expected=JSON.stringify(captured);
  const check=(checkpointed=false)=>{if(entry.cancelled||target.closed||session!==owner.sessionId||panes.get(p.id)!==p||record(p)!==r||p.planId!==owner.planId||p.frame.contentWindow!==sourceWindow||sourceWindow.__editorPlanId!==owner.planId||sourceWindow._editorPaneDisposed||p.installing||(p.installEpoch||0)!==owner.installEpoch||r.generation!==owner.generation||JSON.stringify(actionState(state(p)))!==expected||!checkpointed&&(r.baseRevisionId!==owner.baseRevisionId||r.baseGeneration!==owner.baseGeneration))throw Error('元の編集／画面が更新されたため共同編集の引き継ぎを中止しました。比較の編集は保持しています。');};
  entry.promise=api.run(async()=>{
   try{
    check();if((await persistDraft(p,captured)).status!=='saved')throw Error('元の下書きの保存を確認できません。');check();
    if(!r.baseRevisionId){await checkpoint(p);expected=JSON.stringify({...captured,dirty:true});check(true);captured.dirty=true;owner.baseRevisionId=r.baseRevisionId;owner.baseGeneration=r.baseGeneration;}
    check();if((await persistDraft(p,captured)).status!=='saved')throw Error('元の下書きの保存を確認できません。');check();
    const saved=await repo.read(owner.planId);check();if(!saved||saved.revision.id!==owner.baseRevisionId||saved.head.headGeneration!==owner.baseGeneration)throw Error('元の保存版が別画面で更新されました。下書きを保持しています。履歴／再読み込みで確認してください。');
    const token=uid();entry.token=token;const digest=await repo.digest(JSON.stringify(captured));check();
    const written=await repo.saveDraft(token,owner.planId,{...captured,payload:captured.plan,generation:owner.generation,baseRevisionId:owner.baseRevisionId,baseGeneration:owner.baseGeneration});check();if(written.status!=='saved')throw Error('通常タブへの下書き保存が競合しました。比較の編集は保持しています。');
    const now=Date.now(),ticket={version:1,role:'native-action',action,token,status:'prepared',preparedAt:now,expiresAt:now+300000,planId:owner.planId,stateDigest:digest,source:copy(owner),roomContext:roomContext?copy(roomContext):null};entry.expiresAt=ticket.expiresAt;
    const view=await repo.setView(token,{retainedPlanIds:[owner.planId],panelPlanIds:[owner.planId],sync:false,cameras:{[owner.planId]:captured.view},nativeAction:ticket},0);check();
    const draft=await repo.get('drafts',JSON.stringify([token,owner.planId]));check();const readback=await repo.get('views',token);check();
    const readDigest=await repo.digest(JSON.stringify(actionState(draft||{})));check();
    if(!draft||draft.planId!==owner.planId||draft.sessionId!==token||draft.generation!==owner.generation||draft.baseRevisionId!==owner.baseRevisionId||draft.baseGeneration!==owner.baseGeneration||readDigest!==digest||JSON.stringify(draft.plan)!==JSON.stringify(draft.payload)||readback?.generation!==view.generation||JSON.stringify(readback.nativeAction)!==JSON.stringify(ticket))throw Error('通常タブへの下書きの検証に失敗しました。比較の編集は保持しています。');
    const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('nativeAction',token);check();target.location.replace(url.href);entry.navigated=true;
    status('同じプランの下書きを通常タブへ引き継ぎました。そこで共同編集を操作できます。比較の編集・履歴・配置は保持しています。');return true;
   }catch(error){try{await abandonNativeTicket(entry);}catch(_){}if(!entry.navigated)target.close();nativeActions.delete(key);throw error;}
  });return entry.promise;
 }catch(error){status(error);return Promise.resolve(false);}
};
window.addEventListener('pagehide',()=>{for(const entry of nativeActions.values())if(!entry.navigated){entry.cancelled=true;abandonNativeTicket(entry).catch(()=>{});}});
async function restoreNativeAction(params){
 const token=params.get('nativeAction');
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(token||'')||params.getAll('nativeAction').length!==1||[...params.keys()].some(key=>key!=='nativeAction')||location.hash)throw Error('共同編集の引き継ぎURLを確認できません。比較の編集は保持しています。元の比較タブから開き直してください。');
 const view=await repo.get('views',token);if(!ticketShape(view,token))throw Error('共同編集の引き継ぎは期限切れ／使用済みです。比較の編集と下書きは保持しています。元の比較タブから開き直してください。');
 const ticket=copy(view.nativeAction),runtimeSession=uid();let claimed,consumed,transaction,runtimeView;
 try{
  claimed=await repo.updateView(token,previous=>({...previous,nativeAction:{...previous.nativeAction,status:'claimed',claimedBy:runtimeSession}}),view.generation);
  const draft=await repo.get('drafts',JSON.stringify([token,ticket.planId])),o=ticket.source;
  if(!draft||draft.planId!==ticket.planId||draft.sessionId!==token||draft.generation!==o.generation||draft.baseRevisionId!==o.baseRevisionId||draft.baseGeneration!==o.baseGeneration||JSON.stringify(draft.plan)!==JSON.stringify(draft.payload)||await repo.digest(JSON.stringify(actionState(draft)))!==ticket.stateDigest)throw Error('共同編集の引き継ぎ下書きを確認できません。比較の編集は保持しています。');
  const saved=await repo.read(ticket.planId,o.baseRevisionId);if(!saved||saved.revision.id!==o.baseRevisionId)throw Error('共同編集の元の保存版を確認できません。');
  const p=panes.get(NATIVE_EDITOR_PANE),editor=child(p);await editor.ready;
  const current=await repo.get('views',token);if(current?.generation!==claimed.generation||current.nativeAction?.claimedBy!==runtimeSession||current.nativeAction?.status!=='claimed'||ticket.expiresAt<=Date.now())throw Error('共同編集の引き継ぎ操作が更新されました。');
  transaction={p,editor:editor.captureInstallState(),records:new Map([...plans].map(([id,r])=>[id,copy(r)])),retained:retained.slice(),session,planId:p.planId,editorPlanId:window.__editorPlanId,clientId:window.SHARED.clientId,inert:document.body.inert};document.body.inert=true;
  const captured=actionState(draft);await install(p,captured.plan,captured,ticket.planId,{restoreCamera:true});
  if(ticket.expiresAt<=Date.now())throw Error('共同編集の引き継ぎが復元中に期限切れになりました。');
  if(JSON.stringify(actionState(state(p)))!==JSON.stringify(captured))throw Error('共同編集の下書きを正確に復元できませんでした。');
  const r={id:ticket.planId,name:saved.head.name,plan:captured.plan,state:captured,generation:o.generation,baseRevisionId:o.baseRevisionId,baseGeneration:o.baseGeneration,lastPayload:JSON.stringify(captured.plan)};
  plans.clear();plans.set(r.id,r);retained=[r.id];p.planId=r.id;window.__editorPlanId=r.id;session=runtimeSession;
  if(ticket.roomContext)roomContexts.set(r.id,copy(ticket.roomContext));
  const result=await persistDraft(p,captured);if(result.status!=='saved')throw Error('通常タブの下書き保存が競合しました。');
  runtimeView=await repo.setView(session,viewState(),0);
  const restored=await repo.get('drafts',JSON.stringify([session,r.id]));if(!restored||await repo.digest(JSON.stringify(actionState(restored)))!==ticket.stateDigest)throw Error('通常タブの下書き保存を確認できません。');
  consumed=await repo.updateView(token,previous=>({...previous,nativeAction:{...previous.nativeAction,status:'consumed'}}),claimed.generation);
  if(ticket.expiresAt<=Date.now())throw Error('共同編集の引き継ぎが復元中に期限切れになりました。');
  // Popups may inherit sessionStorage. Neither runtime nor collaboration
  // client identity is borrowed from the source or the one-shot ticket.
  window.SHARED.clientId=uid().replace(/-/g,'');try{sessionStorage.setItem('webcad-collab-client',window.SHARED.clientId);sessionStorage.setItem(sessionKey,session);}catch(_){}
  nativeActionOwner={token,action:'share',sourceSession:o.sessionId,sourcePlanId:r.id,ownedPlanId:r.id};nativeActionRoom=ticket.roomContext?.roomId||null;
  document.body.inert=transaction.inert;refresh();window.openShareDialog();nativeActionStatus='ready';
  const message=nativeActionRoom?'比較の下書きを保持して元の共同編集ルームへの再接続を準備しました。「共有URLに再接続」で接続してください。接続時はルームの内容を開きます。比較の未送信編集は元のタブに残ります。':'比較と同じプランの下書きを開きました。比較の編集と履歴は元のタブに保持しています。共同編集はこの通常タブで開始してください。';
  status(message);window.sharedSetStatus?.(message);return true;
 }catch(error){
  if(transaction){const p=transaction.p;plans.clear();for(const [id,r]of transaction.records)plans.set(id,r);retained=transaction.retained;p.planId=transaction.planId;window.__editorPlanId=transaction.editorPlanId;session=transaction.session;window.SHARED.clientId=transaction.clientId;nativeActionOwner=null;nativeActionRoom=null;transaction.p.frame.contentWindow.EditorPane.restoreInstallState(transaction.editor);if(runtimeView)try{await repo.setView(runtimeSession,viewState(),runtimeView.generation);}catch(_){}document.body.inert=transaction.inert;}
  if(transaction)try{sessionStorage.setItem(sessionKey,session);if(transaction.clientId)sessionStorage.setItem('webcad-collab-client',transaction.clientId);else sessionStorage.removeItem('webcad-collab-client');}catch(_){}
  if(claimed)try{await repo.updateView(token,previous=>({...previous,nativeAction:{...previous.nativeAction,status:'failed'}}),(consumed||claimed).generation);}catch(_){}
  throw Error(error.message+' 比較の編集と引き継ぎ下書きは保持しています。元の比較タブから回収してください。');
 }
}
api.openComparison=async function(){
 // Open synchronously within the click to avoid popup blockers; no URL or saved
 // plan is installed until the verified local checkpoint has completed.
 const target=window.open('about:blank','_blank');if(!target){status('比較のタブを開けませんでした。ブラウザでポップアップを許可してください。');return false;}
 try{target.opener=null;const ok=await api.run(async()=>{
  const p=valid(panes.get(NATIVE_EDITOR_PANE));await persistDraft(p);const r=record(p);
  await checkpoint(p);
  const room=window.SHARED?.roomId;if(room){const context={roomId:room,planId:r.id,sourceSession:session,roomGeneration:window.SHARED.roomGeneration||0};if(!verifiedRoom(context,r.id))throw Error('共同編集の保存先を確認できませんでした。現在の編集は保持しています。');roomContexts.set(r.id,context);}
  const comparisonSession=uid(),captured=state(p);await repo.saveDraft(comparisonSession,r.id,{...captured,payload:captured.plan,generation:r.generation,baseRevisionId:r.baseRevisionId,baseGeneration:r.baseGeneration});
  await repo.setView(comparisonSession,{...viewState(),panelPlanIds:[r.id]});await persistView();
  const url=new URL(location.href);url.search='';url.searchParams.set('planLibrary','1');url.searchParams.set('librarySession',comparisonSession);target.location.replace(url.href);status('同じプランIDの編集を保全して比較を開きました。保存ボタンで保存するまで未保存のままです。');return true;
 });if(!ok)target.close();return !!ok;}catch(error){target.close();status(error);return false;}
};
api.ready=(async()=>{
 const params=new URLSearchParams(location.search);
 if(native&&params.has('nativeAction')){const inert=document.body.inert;document.body.inert=true;nativeActionStatus='restoring';try{await restoreNativeAction(params);}catch(error){nativeActionStatus='failed';throw error;}finally{document.body.inert=inert;}return;}
 const requested=params.get('librarySession');
 if(!native&&requested&&/^[a-zA-Z0-9-]{1,80}$/.test(requested)){session=requested;try{sessionStorage.setItem(sessionKey,session);}catch(_){} }
 if(native){if(await initSharedRoomFromUrl())return;if(window.SHARED?.roomId)throw Error('共同編集の復元に失敗しました。現在の編集を保持しています。共有URLへ再接続するか共同編集を終了してください。');}
 const preset=new URLSearchParams(location.search).get('preset'),explicitStart=native&&['blank','2f','3f'].includes(preset);
 const view=explicitStart?null:await repo.get('views',session);
 if(explicitStart){session=uid();try{sessionStorage.setItem(sessionKey,session);}catch(_){} }
 if(view){
  if(!Array.isArray(view.retainedPlanIds)||view.retainedPlanIds.length>4||!Array.isArray(view.panelPlanIds)||view.panelPlanIds.length>2)throw Error('画面の保存形式を確認できませんでした。保存済みプランは変更していません。');
  for(const [id,context]of Object.entries(view.roomContexts||{})){if(!verifiedRoom(context,id)||!view.retainedPlanIds.includes(id))throw Error('共同編集の元ルームを確認できませんでした。保存済みプランは変更していません。');roomContexts.set(id,copy(context));}
  for(const id of view.retainedPlanIds)await loadRecord(id);retained=view.retainedPlanIds.slice();sync=view.sync!==false;q('[data-parallel-sync]',shell).checked=sync;
  const visible=native?view.panelPlanIds.slice(0,1):view.panelPlanIds;
  for(const id of visible){const p=await mount(id);if(view.cameras?.[id])child(p).applyView(view.cameras[id]);}
  if(native&&visible.length){session=uid();try{sessionStorage.setItem(sessionKey,session);}catch(_){}const p=panes.get(NATIVE_EDITOR_PANE);await persistDraft(p);await persistView();return;}
 }
 if(native){
  const p=panes.get(NATIVE_EDITOR_PANE);if(!retained.includes(p.planId))retained.push(p.planId);
  loadPreset();maybeOfferPresetChoice();
  const legacy=await repo.readLegacySources();if(legacy.length&&confirm('前回保存したプランがあります。原本を残して読み込みますか？'))await api.legacyList();
 }else if(!panes.size)status('「開く」から保存済みプラン、「新規」から新しいプランを選んでください。旧保存は自動移行しません。');
 refresh();
})().catch(status).finally(()=>{initializing=false;busy=false;transitionBusy=false;refresh();});
})();
