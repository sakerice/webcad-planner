'use strict';
// Execute the real picker/dialog/converter and native history/rollback functions
// with an anonymous DOM contract shim. This is not visual/browser acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {libraryContext}=require('./plan-library-test-support.cjs');
const {topLevelFunction}=require('./height-runtime.cjs');
const ROOT=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(ROOT,p),'utf8'),html=read('index.html');
const plain=value=>JSON.parse(JSON.stringify(value));
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attrs={};this.dataset={};this.listeners={};this.className='';this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.open=false;this.classList={contains:k=>this.className.split(' ').includes(k),add:k=>this.className+=' '+k,remove:k=>this.className=this.className.split(' ').filter(v=>v!==k).join(' '),toggle:(k,on)=>on?this.classList.add(k):this.classList.remove(k)};}
 append(...nodes){for(const node of nodes){if(node.tagName==='FRAGMENT'){this.append(...node.children.slice());continue;}node.remove?.();node.parentNode=this;this.children.push(node);}}
 prepend(node){node.remove();node.parentNode=this;this.children.unshift(node);}
 after(node){node.remove();const parent=this.parentNode;node.parentNode=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);}
 remove(){if(this.parentNode){const nodes=this.parentNode.children;nodes.splice(nodes.indexOf(this),1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
 get previousElementSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)-1]||null;}
 setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=v;if(k==='class')this.className=v;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(v);}
 getAttribute(k){return this.attrs[k]??null;}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,fn){(this.listeners[k]||=[]).push(fn);}
 dispatch(k,event={}){event.target||=this;event.stopPropagation||=()=>{};event.preventDefault||=()=>{};for(const fn of this.listeners[k]||[])fn(event);return this['on'+k]?.(event);}
 focus(){this.focused=true;}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatch('close');}
 contains(node){return node===this||this.children.some(child=>child.contains(node));}
 matches(selector){
  if(selector===':scope')return true;
  if(selector.includes(':not(')){const [main,rest]=selector.split(':not(');return this.matches(main)&&!this.matches(rest.slice(0,-1));}
  const attr=selector.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);if(attr&&!(attr[1] in this.attrs&&(!attr[2]||this.attrs[attr[1]]===attr[2])))return false;
  selector=selector.replace(/\[[^\]]*\]/g,'');if(!selector)return true;
  if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
  return this.tagName.toLowerCase()===selector;
 }
 querySelectorAll(selector){
  if(selector.includes(','))return [...new Set(selector.split(',').flatMap(s=>this.querySelectorAll(s.trim())))];
  if(selector.startsWith(':scope > '))return this.children.filter(node=>node.matches(selector.slice(9)));
  const parts=selector.split(/\s+/),last=parts.pop(),out=[];
  function walk(node){for(const child of node.children){if(child.matches(last)){let ancestor=child.parentNode,match=true;for(const part of parts.slice().reverse()){while(ancestor&&!ancestor.matches(part))ancestor=ancestor.parentNode;if(!ancestor){match=false;break;}ancestor=ancestor.parentNode;}if(match)out.push(child);}walk(child);}}walk(this);return out;
 }
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 closest(s){let node=this;while(node&&!node.matches(s))node=node.parentNode;return node;}
 set innerHTML(value){
  this.replaceChildren();this._html=value;const stack=[this];
  for(const token of value.match(/<[^>]+>|[^<]+/g)||[]){
   if(token.startsWith('</')){stack.pop();continue;}if(!token.startsWith('<')){stack.at(-1).textContent+=token;continue;}
   const name=token.match(/^<([\w-]+)/)?.[1];if(!name)continue;const node=new Element(name);
   for(const attr of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){if(attr.index===1)continue;node.setAttribute(attr[1],attr[2]??'');if(['checked','disabled','hidden'].includes(attr[1]))node[attr[1]]=true;if(attr[1]==='value')node.value=attr[2];}
   stack.at(-1).append(node);if(!['input','img','br','hr'].includes(name))stack.push(node);
  }
 }
 get innerHTML(){return this._html||'';}
}
const manifest={id:'rpg-mansion',name:'RPG向け洋館',namespace:'rpg-mansion-',items:[{id:'rpg-mansion-chair-fixture',name:'洋館の椅子',w:500,d:500,h:900}]};
const model={id:'fmp-FixtureChair',name:'椅子',w:500,d:500,h:900};
const contract={version:1,revision:'anonymous-fixture-v1',targetPack:'rpg-mansion',mappings:[{sourceId:model.id,targetId:manifest.items[0].id,reviewRequired:true,reviewReason:'高さ・機能を確認'}]};
const fixture=()=>({walls:[{id:'wall-fixture',x1:0,y1:0,x2:2000,y2:0,thick:120,floor:1}],rooms:[],items:[{id:'chair-fixture',type:model.id,x:100,y:200,w:500,d:500,rot:12,floor:1,custom:{keep:true}},{id:'unknown-fixture',type:'anonymous-unknown',x:800,y:900,w:50,d:50,rot:0,floor:1,futureField:{keep:[1,2]}}],opaqueRoot:{keep:true}});
function setup({plan=fixture(),fetcher,shared=false,rpg=manifest,extraTools=[],beforeInstall}={}){
 const document=new Element('document');document.createElement=tag=>new Element(tag);document.createDocumentFragment=()=>new Element('fragment');document.getElementById=id=>document.querySelector('#'+id);document.body=new Element('body');document.append(document.body);
 const sidebar=new Element('aside');sidebar.id='sidebar';document.body.append(sidebar);const common=new Element();common.className='common-tools';sidebar.append(common);const header=new Element();header.className='cat-hdr';header.textContent='家具';const body=new Element();body.className='cat-body';sidebar.append(header,body);
 for(const item of [model,...rpg.items,...extraTools]){const card=new Element('button');card.setAttribute('data-tool',item.id);card.setAttribute('title',item.name);card.textContent=item.name;body.append(card);}
 const calls=[],copies=[];let epoch=0;const c={document,console:{warn(){}},AbortController,URL,Set,Map,DATA:plain(plan),ST:{tool:'select',drawing:false,selected:null,multiSelected:[],zoom:1,view:'2d'},DRAG:{active:false},HISTORY:['previous-undo'],REDO_HISTORY:['previous-redo'],HISTORY_LIMIT:80,DIRTY:false,SHARED:{roomId:shared?'anonymous-room':null},ren:{},WALL_H:2500,nextId:90,LIGHT_SETTINGS:{northDeg:0},_defaultPlanPending:false,__editorPlanId:'anonymous-source',NATIVE_PLAN_EDITOR:true,NATIVE_EDITOR_PANE:'native-editor',camExt:null,PlanSchema:require('../../assets/js/plan-schema.js'),MenuIcons:{html:()=>''},getItemDefaultSize:id=>id===model.id||id===manifest.items[0].id?{w:500,d:500,h:900}:{w:50,d:50,h:50},getItemHeightValue:i=>i.assetPackConversion?.targetType===i.type?i.assetPackConversion.renderHeightMm:(i.type===model.id||i.type===manifest.items[0].id?900:50),fetch:fetcher||(async()=>({ok:true,json:async()=>plain(contract)})),syncToolUi(){calls.push('sync-tool');},clearMultiSelection(){c.ST.multiSelected=[];},sharedRememberEditTargets(){calls.push('edit-targets');},queueSharedSync(){calls.push('normal-sync-hook');},queueSharedLocalAutoSave(){calls.push('normal-autosave-hook');},renderSaveButtonState(){calls.push('save-ui');},sharedForceFullSync(){},ensureFloorMetadata(){},syncNorthFromPlan(){},updateProps(){calls.push('props');},draw2d(){calls.push('draw');},rebuild3D(){calls.push('3d');},invalidateNativeOutputs(){calls.push('outputs');},syncNorthUi(){},syncHeightDefaultsUI(){},view(){return {view:'2d',twoD:{zoom:c.ST.zoom}};},applyView(){},clone:plain};c.window=c;c.root=c;
 vm.createContext(c);
 const state=read('assets/js/app-state.js');vm.runInContext(state.slice(state.indexOf('function markDirty(){'),state.indexOf('function ensureObjectIds(){')),c);
 vm.runInContext(html.slice(html.indexOf('function undoAction(){'),html.indexOf('// 読み取り画面のページ選択')),c);
 const parallel=read('assets/js/parallel-editors.js');vm.runInContext(parallel.slice(parallel.indexOf('  function captureInstallState(){'),parallel.indexOf('  root.EditorPane={')),c);
 c.EditorPane={captureInstallState:c.captureInstallState,restoreInstallState:c.restoreInstallState,noteImportTargetEdit(){epoch++;},importOwner:()=>({paneId:'native-editor',planId:c.__editorPlanId,installGeneration:0,targetGeneration:epoch})};
 c.PlanLibrary={retained:['anonymous-source'],edited:id=>calls.push('draft:'+id),validateDerivedPlan:async()=>({ok:true}),createIndependentPlan:async(p,n,o)=>{assert.equal(o.isCurrent(),true);assert.equal(o.sourceSnapshot,c.serializeDataSnapshot());copies.push({plan:plain(p),name:n,options:o});return 'anonymous-copy';}};
 c.validateEditorPlan=(p,admission)=>{calls.push('validate');assert.equal(admission,c.__legacyPlanAdmission);return c.PlanSchema.validatePlan(p);};
 vm.runInContext(html.slice(html.indexOf('function applyObjectSetReplacement('),html.indexOf('var _jsonImportRequest=0;')),c);
 for(const p of ['asset-pack-registry','asset-catalogue','asset-pack-picker','asset-pack-conversion','asset-pack-conversion-ui'])vm.runInContext(read('assets/js/'+p+'.js'),c);
 beforeInstall?.(c);
 c.AssetPackPicker.install(sidebar,{[model.id]:model},rpg);
 const ui=id=>document.querySelector('[data-conversion="'+id+'"]');
 return {c,document,sidebar,calls,copies,ui,epoch:()=>epoch,edit(){c.DATA.items[0].x++;epoch++;},advance(){epoch++;}};
}
async function ready(h){await h.c.AssetPackConversionUI.open();return h;}
async function chooseBulk(h,pack='rpg-mansion'){h.ui('pack').value=pack;h.ui('pack').dispatch('change');h.ui('all').dispatch('click');}
const snap=h=>JSON.stringify([h.c.DATA,h.c.HISTORY,h.c.REDO_HISTORY,h.c.DIRTY,h.c.__editorPlanId]);
function nativeHeight(c){
 c.FMP_ITEMS=Object.fromEntries([model,...manifest.items].map(item=>[item.id,item]));
 c.AssetPackConversionContract={revision:contract.revision,mappings:contract.mappings.map(row=>({sourceId:row.sourceId,targetId:row.targetId,native:false}))};
 for(const name of ['isCustomBlockType','isLightItemType','isContextExteriorItemType','isColumnType'])c[name]=()=>false;
 c.balconySlabHeightMm=()=>120;
 vm.runInContext(['isFmpItemType','getFmpItem','getItemHeightValue','getItemH'].map(topLevelFunction).join('\n'),c);
}
function nativeKeyboard(h){
 const listeners={};h.c.addEventListener=(type,fn)=>(listeners[type]||=[]).push(fn);
 h.c.isPlanImportDialogOpen=()=>false;h.c.isWalkView=()=>false;h.c.isInt=true;h.c.iMov={};h.c.invalidate3D=()=>h.calls.push('invalidate');
 vm.runInContext(topLevelFunction('isNativeKeyboardControl'),h.c);
 const start=html.indexOf("  document.addEventListener('keydown',function(e){"),end=html.indexOf('  loop3D();',start);
 assert.ok(start>=0&&end>start);vm.runInContext(html.slice(start,end),h.c);
 const windowStart=html.indexOf("window.addEventListener('keydown', function(e){"),windowEnd=html.indexOf("window.addEventListener('resize',function(){",windowStart);
 assert.ok(windowStart>=0&&windowEnd>windowStart);vm.runInContext(html.slice(windowStart,windowEnd)+'\n'+topLevelFunction('anyWasdActive'),h.c);
 return (type,key,target=h.document.body,flags={})=>{
  const event={key,target,metaKey:false,ctrlKey:false,shiftKey:false,...flags,stopped:false,defaultPrevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.defaultPrevented=true;}};
  for(let node=target;node;node=node.parentNode){node.dispatch(type,event);if(event.stopped)break;}
  if(!event.stopped)for(const fn of listeners[type]||[])fn(event);
  return event;
 };
}
test('real sidebar installs search first and one compact optional dialog entry, without the old direct selector',()=>{
 const h=setup(),search=h.sidebar.querySelector('#object-search');assert.equal(search.children[0].textContent,'すべてのオブジェクトを検索');assert.equal(search.children.at(-1).id,'asset-conversion-open');assert.equal(h.document.querySelector('#catalogue-pack'),null);assert.equal(h.document.querySelectorAll('#asset-conversion-open').length,1);assert.equal(h.c.AssetPackPicker.getSelection(),'japanese-standard');assert.equal(h.document.querySelector('#asset-conversion-open').attrs['aria-haspopup'],'dialog');
});
test('two grouped operations default to Japanese and preserve-original checked; changing selects alone is read-only',async()=>{
 const h=await ready(setup()),before=snap(h);assert.equal(h.ui('list-pack').value,'japanese-standard');assert.equal(h.ui('pack').value,'japanese-standard');assert.equal(h.ui('copy').checked,true);assert.equal(h.document.querySelectorAll('.object-set-operation').length,2);
 h.ui('list-pack').value='rpg-mansion';h.ui('list-pack').dispatch('change');await chooseBulk(h);assert.equal(snap(h),before);assert.equal(h.c.AssetPackPicker.getSelection(),'japanese-standard');assert.equal(h.copies.length,0);
 h.ui('cancel-bottom').dispatch('click');assert.equal(snap(h),before);assert.equal(h.document.querySelector('#asset-conversion-dialog').open,false);
});
test('list confirmation filters the actual catalogue/search but never swaps placed objects or history',async()=>{
 const h=await ready(setup()),before=snap(h);h.ui('list-pack').value='rpg-mansion';h.ui('list-apply').dispatch('click');assert.equal(h.c.AssetPackPicker.getSelection(),'rpg-mansion');assert.equal(snap(h),before);assert.equal(h.sidebar.querySelector('.cat-body [data-tool="fmp-FixtureChair"]').hidden,true);assert.equal(h.sidebar.querySelector('.cat-body [data-tool="rpg-mansion-chair-fixture"]').hidden,false);assert.match(h.ui('list-status').textContent,/配置済みの物は変更していません/);assert.ok(h.calls.includes('draft:native-editor'));
});
test('default bulk copy delegates exactly once to existing independent-plan path with original guard and pack',async()=>{
 const h=await ready(setup()),before=snap(h);await chooseBulk(h);await h.ui('create').dispatch('click');assert.equal(h.copies.length,1);assert.equal(snap(h),before);assert.equal(h.copies[0].plan.items[0].type,manifest.items[0].id);assert.deepEqual(h.copies[0].plan.items[1],h.c.DATA.items[1]);assert.equal(h.copies[0].options.cataloguePack,'rpg-mansion');assert.equal(h.copies[0].options.sourcePlanId,'anonymous-source');assert.equal(h.copies[0].options.sourcePaneId,'native-editor');
});
test('unchecked bulk uses actual native saveState, Undo/Redo, rollback and same current identity',async()=>{
 const h=await ready(setup()),original=h.c.serializeDataSnapshot(),history=h.c.HISTORY.length;h.c.ST.selected=h.c.DATA.items[0];await chooseBulk(h);h.ui('copy').checked=false;h.ui('copy').dispatch('change');assert.equal(h.ui('name-field').hidden,true);await h.ui('create').dispatch('click');assert.equal(h.copies.length,0);assert.equal(h.c.HISTORY.length,history+1);assert.equal(h.c.REDO_HISTORY.length,0);assert.equal(h.c.DIRTY,true);assert.equal(h.c.__editorPlanId,'anonymous-source');assert.equal(h.c.ST.selected.type,manifest.items[0].id);const converted=h.c.serializeDataSnapshot();h.c.undoAction();assert.equal(h.c.serializeDataSnapshot(),original);h.c.redoAction();assert.equal(h.c.serializeDataSnapshot(),converted);assert.ok(h.calls.includes('edit-targets'));
});
test('null raw height and absent-height fallback preserve native effective height, Undo and reverse provenance',async()=>{
 for(const stored of [null,undefined,123,-5]){
  const plan=fixture();if(stored!==undefined)plan.items[0].h=stored;
  const h=await ready(setup({plan,beforeInstall:nativeHeight})),original=h.c.serializeDataSnapshot(),effective=h.c.getItemHeightValue(h.c.DATA.items[0]);
  assert.equal(h.c.PlanSchema.validatePlan(plan).ok,true);assert.equal(effective,model.h);
  await chooseBulk(h);await h.ui('create').dispatch('click');
  assert.equal(h.c.serializeDataSnapshot(),original);assert.equal(h.copies.length,1);
  assert.equal(h.copies[0].plan.items[0].h,stored===undefined?effective:stored);
  assert.equal(h.c.getItemHeightValue(h.copies[0].plan.items[0]),effective);
  await ready(h);await chooseBulk(h);h.ui('copy').checked=false;h.ui('copy').dispatch('change');await h.ui('create').dispatch('click');
  assert.equal(h.c.DATA.items[0].type,manifest.items[0].id);assert.equal(h.c.DATA.items[0].h,stored===undefined?effective:stored);
  const converted=h.c.serializeDataSnapshot(),provenance=plain(h.c.DATA.items[0].assetPackConversion);
  assert.equal(h.c.getItemHeightValue(h.c.DATA.items[0]),effective);h.c.undoAction();assert.equal(h.c.serializeDataSnapshot(),original);h.c.redoAction();assert.equal(h.c.serializeDataSnapshot(),converted);
  await ready(h);await chooseBulk(h,'japanese-standard');h.ui('copy').checked=false;h.ui('copy').dispatch('change');await h.ui('create').dispatch('click');
  assert.equal(h.c.DATA.items[0].type,model.id);assert.equal(h.c.DATA.items[0].h,stored===undefined?effective:stored);assert.equal(h.c.getItemHeightValue(h.c.DATA.items[0]),effective);assert.deepEqual(plain(h.c.DATA.items[0].assetPackConversion),provenance);
 }
});
test('modal blocks actual native edit/movement keydowns, permits defaults, and releases held movement/modifiers across repeated opens',async()=>{
 const h=setup(),emit=nativeKeyboard(h);
 for(const close of ['close','cancel-bottom']){
  h.c.ST.selected=null;
  emit('keydown','Shift');h.c.ST.ctrlKey=true;emit('keydown','w');emit('keydown','ArrowLeft');assert.equal(h.c.ST.shiftKey,true);assert.equal(h.c.anyWasdActive(),true);
  await ready(h);h.c.ST.selected=h.c.DATA.items[0];const before=snap(h);
  for(const [key,target,flags] of [['ArrowDown',h.ui('list-pack'),{}],['Delete',h.ui('list-pack'),{}],['z',h.ui('list-pack'),{ctrlKey:true}],['z',h.ui('name'),{ctrlKey:true}],['Escape',h.ui('name'),{}],['r',h.ui('list-pack'),{}],['d',h.ui('name'),{}]]){
   const e=emit('keydown',key,target,flags);assert.equal(e.stopped,true,key);assert.equal(e.defaultPrevented,false,key);assert.equal(snap(h),before,key);
  }
  assert.equal(h.c.iMov.d,undefined);
  for(const key of ['Shift','Control','W','ArrowLeft']){const e=emit('keyup',key,h.ui('name'));assert.equal(e.stopped,false,key);assert.equal(e.defaultPrevented,false,key);}
  assert.equal(h.c.ST.shiftKey,false);assert.equal(h.c.ST.ctrlKey,false);assert.equal(h.c.anyWasdActive(),false);assert.equal(snap(h),before);
  h.ui(close).dispatch('click');assert.equal(h.c.ST.shiftKey,false);assert.equal(h.c.ST.ctrlKey,false);assert.equal(h.c.anyWasdActive(),false);
  h.c.ST.floor=1;h.c.WALK={active:true,floor:1,keys:{},x:5,z:7,yaw:0};h.c.isWalkView=()=>true;h.c._lastWalkTick=0;h.c.updateWalkDoors=()=>false;
  vm.runInContext(topLevelFunction('updateWalkMode'),h.c);assert.equal(h.c.updateWalkMode(1000),false);assert.equal(h.c.WALK.moving,false);assert.deepEqual([h.c.WALK.x,h.c.WALK.z,h.c.WALK.yaw],[5,7,0]);h.c.isWalkView=()=>false;
 }
});
test('actual RPG manifest and registry supply the requested label to both real dialog selectors',async()=>{
 const rpg=JSON.parse(read('assets/models/packs/rpg-mansion/manifest.json')),mapping=JSON.parse(read('assets/models/packs/rpg-mansion/conversion-map.json'));
 const h=await ready(setup({rpg,fetcher:async()=>({ok:true,json:async()=>mapping})}));
 assert.equal(h.c.AssetPackPicker.getRegistry().listPacks().find(pack=>pack.id==='rpg-mansion').name,'RPG向け洋館');
 for(const id of ['list-pack','pack'])assert.deepEqual(h.ui(id).children.map(option=>[option.value,option.textContent]),[['japanese-standard','日本建築標準'],['rpg-mansion','RPG向け洋館']]);
 assert.doesNotMatch(h.ui('status').textContent,/読み込めません|重複・不明/);
});
test('RPG filtering retains native structural and generated opening capabilities without showing other standard furniture',()=>{
 const openingModels=JSON.parse(read('assets/models/interior_model_0_26_1/manifest.json')).items;
 const windowModel=openingModels.find(item=>item.category==='窓'),doorModel=openingModels.find(item=>item.category==='ドア'&&/^Classroom-door-/i.test(item.name));assert.ok(windowModel&&doorModel);
 const structures=['site-rect','foundation','exterior-stair','ramp','wall','room-rect','ceiling-lower','ceiling-raise','column','column-round','balcony','stair','stair-corner','stair-landing','roof','door-slide','door-slide-s','door-pocket','door-fold','door-fold-w','door-front','door-opening','door-opening-arch','window','window-door','opening-door-model:default','opening-door-model:small','opening-window-model:default','opening-window-model:fix','opening-window-model:window-door'];
 structures.push('opening-window-model:'+windowModel.id,'opening-door-model:'+doorModel.id);
 const h=setup({extraTools:[...structures,'washer','car','opening-window-model:unknown'].map(id=>({id,name:id})),beforeInstall(c){
  c.FMP_ITEMS={[windowModel.id]:windowModel,[doorModel.id]:doorModel};c.OPENING_DOOR_MODEL_TOOL_PREFIX='opening-door-model:';c.OPENING_WINDOW_MODEL_TOOL_PREFIX='opening-window-model:';
  vm.runInContext(['isWindowLikeType','isDoorLikeOpeningType','isOpeningItemType','isOpeningDoorModel','getFmpItem','getOpeningModelToolPreset'].map(topLevelFunction).join('\n'),c);
 }}),before=snap(h),cards=new Map(h.sidebar.querySelectorAll('.cat-body [data-tool]').map(card=>[card.getAttribute('data-tool'),card]));
 for(const id of structures){h.c.ST.tool=id;h.c.ST.drawing=true;h.c.ST.drawPts=[{x:1,y:2}];h.c.AssetPackPicker.setSelection('rpg-mansion');assert.equal(h.c.ST.tool,id);assert.equal(h.c.ST.drawing,true);assert.equal(cards.get(id).hidden,false,id);assert.equal(cards.get(id).parentNode.hidden,false,id);assert.equal(snap(h),before);h.c.AssetPackPicker.setSelection('japanese-standard');}
 h.c.AssetPackPicker.setSelection('rpg-mansion');for(const id of [model.id,'washer','car','opening-window-model:unknown'])assert.equal(cards.get(id).hidden,true,id);assert.equal(cards.get(manifest.items[0].id).hidden,false);
 const search=h.sidebar.querySelector('#object-search-input'),originalSearch=h.sidebar._globalCatalogueSearch;let refreshes=0;h.sidebar._globalCatalogueSearch=()=>{refreshes++;assert.equal(search.value,'wall');originalSearch();};
 search.value='wall';h.c.AssetPackPicker.refresh();assert.equal(refreshes,1);assert.equal(search.value,'wall');assert.equal(h.sidebar.querySelector('#object-search-results').hidden,false);assert.equal(cards.get(model.id).hidden,true);
});
test('same pack keeps objects with counts and disabled apply; pending proposals are explicit',async()=>{
 const h=await ready(setup());assert.equal(h.ui('create').disabled,true);assert.match(h.ui('summary').textContent,/0点を差し替え \/ 2点を保持/);h.ui('pack').value='rpg-mansion';h.ui('pack').dispatch('change');assert.equal(h.ui('create').disabled,true);assert.match(h.ui('summary').textContent,/1点は確認して選択/);h.ui('all').dispatch('click');assert.equal(h.ui('create').disabled,false);assert.match(h.ui('summary').textContent,/1点を差し替え \/ 1点を保持/);h.ui('none').dispatch('click');assert.equal(h.ui('create').disabled,true);
});
test('existing RPG selection and actual RPG layout are truthful; mixed layout requires choosing a destination',async()=>{
 const plan=fixture();plan.items[0].type=manifest.items[0].id;const h=setup({plan});h.c.AssetPackPicker.setSelection('rpg-mansion');await ready(h);assert.equal(h.ui('list-pack').value,'rpg-mansion');assert.equal(h.ui('pack').value,'rpg-mansion');assert.equal(h.ui('create').disabled,true);
 const mixed=fixture();mixed.items.push({...mixed.items[0],id:'second-chair',type:manifest.items[0].id});const m=await ready(setup({plan:mixed}));assert.equal(m.ui('pack').value,'mixed');assert.equal(m.ui('create').disabled,true);assert.match(m.ui('summary').textContent,/選択/);
});
test('native-explicit Japanese originals and RPG models are truthfully mixed even when native IDs have no catalogue card',async()=>{
 const plan=fixture();plan.items[0].type=manifest.items[0].id;plan.items.push({...plan.items[0],id:'native-sofa-fixture',type:'sofa'});const h=setup({plan});h.c.AssetPackConversionContract={mappings:[{sourceId:'sofa',targetId:manifest.items[0].id,native:true}]};await ready(h);assert.equal(h.ui('pack').value,'mixed');assert.equal(h.ui('create').disabled,true);
});
test('stale data, plan navigation, install/disposal, and edit→Undo epoch cannot apply either operation',async()=>{
 for(const change of [h=>h.edit(),h=>{h.c.__editorPlanId='other';},h=>{h.c._editorPlanInstalling=true;},h=>{h.c._editorPaneDisposed=true;},h=>h.advance()]){
  const h=await ready(setup());await chooseBulk(h);h.ui('list-pack').value='rpg-mansion';change(h);const before=snap(h);h.ui('list-apply').dispatch('click');await h.ui('create').dispatch('click');assert.equal(snap(h),before);assert.equal(h.c.AssetPackPicker.getSelection(),'japanese-standard');assert.equal(h.copies.length,0);assert.match(h.ui('status').textContent,/更新/);
 }
});
test('asynchronous validation cannot cross a newer plan or content change',async()=>{
 const h=await ready(setup());await chooseBulk(h);let resolve;h.c.PlanLibrary.validateDerivedPlan=()=>new Promise(r=>resolve=r);const pending=h.ui('create').dispatch('click');assert.equal(h.ui('close').disabled,true);h.edit();const before=snap(h);resolve({ok:true});await pending;assert.equal(snap(h),before);assert.equal(h.copies.length,0);assert.match(h.ui('status').textContent,/更新/);
});
test('duplicate apply clicks and a programmatic close during validation cannot create stale copies',async()=>{
 const h=await ready(setup());await chooseBulk(h);let resolve;h.c.PlanLibrary.validateDerivedPlan=()=>new Promise(r=>resolve=r);const pending=h.ui('create').dispatch('click');await h.ui('create').dispatch('click');h.document.querySelector('#asset-conversion-dialog').close();resolve({ok:true});await pending;assert.equal(h.copies.length,0);assert.equal(h.document.querySelector('#asset-conversion-dialog').open,false);
 await ready(h);await chooseBulk(h);h.c.PlanLibrary.validateDerivedPlan=async()=>({ok:true});const first=h.ui('create').dispatch('click'),second=h.ui('create').dispatch('click');await Promise.all([first,second]);assert.equal(h.copies.length,1);
});
test('mapping failure/cancel and repeated open discard stale loads without changing data',async()=>{
 const broken=await ready(setup({fetcher:async()=>({ok:false})})),before=snap(broken);assert.equal(broken.ui('create').disabled,true);assert.match(broken.ui('status').textContent,/読み込めません/);assert.equal(snap(broken),before);
 let resolve,count=0;const h=setup({fetcher:()=>{count++;return count===1?new Promise(r=>resolve=r):Promise.resolve({ok:true,json:async()=>plain(contract)});}});const pending=h.c.AssetPackConversionUI.open();h.ui('close').dispatch('click');await h.c.AssetPackConversionUI.open();resolve({ok:true,json:async()=>({...contract,mappings:[]})});await pending;await chooseBulk(h);assert.equal(h.ui('create').disabled,false);assert.equal(h.copies.length,0);
});
test('failed copy save, four-plan limit, and active shared in-place are safe and retryable',async()=>{
 const h=await ready(setup());await chooseBulk(h);const before=snap(h);h.c.PlanLibrary.createIndependentPlan=async()=>{throw new DOMException('匿名の容量不足','QuotaExceededError');};await h.ui('create').dispatch('click');assert.equal(snap(h),before);assert.equal(h.document.querySelector('#asset-conversion-dialog').open,true);assert.match(h.ui('status').textContent,/容量不足/);assert.equal(h.ui('close').disabled,false);
 h.c.PlanLibrary.retained=[1,2,3,4];await h.ui('create').dispatch('click');assert.match(h.ui('status').textContent,/4案まで/);assert.equal(snap(h),before);
 const s=await ready(setup({shared:true}));await chooseBulk(s);s.ui('copy').checked=false;s.ui('copy').dispatch('change');assert.equal(s.ui('create').disabled,true);assert.match(s.ui('destination-note').textContent,/共同編集中/);const original=snap(s);await s.ui('create').dispatch('click');assert.equal(snap(s),original);s.ui('copy').checked=true;s.ui('copy').dispatch('change');assert.equal(s.ui('create').disabled,false);
});
test('render/UI failures restore native memento with data, original selection, dirty/history, pack and IDs',async()=>{
 for(const name of ['updateProps','draw2d','rebuild3D','renderSaveButtonState','invalidateNativeOutputs']){
  const h=await ready(setup());h.c.ST.selected=h.c.DATA.items[0];const selected=h.c.ST.selected,old=h.c.DATA,before=snap(h);await chooseBulk(h);h.ui('copy').checked=false;h.ui('copy').dispatch('change');h.c[name]=()=>{throw Error('injected '+name);};await h.ui('create').dispatch('click');assert.equal(snap(h),before,name);assert.equal(h.c.DATA,old,name);assert.equal(h.c.ST.selected,selected,name);assert.equal(h.c.AssetPackPicker.getSelection(),'japanese-standard');assert.match(h.ui('status').textContent,/injected/);
 }
});
test('catalogue refresh failure is inside native rollback, including a partially changed picker/tool',async()=>{
 const h=await ready(setup()),before=snap(h),oldSelection=h.c.AssetPackPicker.getSelection();await chooseBulk(h);h.ui('copy').checked=false;h.ui('copy').dispatch('change');
 const set=h.c.AssetPackPicker.setSelection;h.c.AssetPackPicker.setSelection=id=>{set(id);if(id==='rpg-mansion')throw Error('injected catalogue refresh');};
 await h.ui('create').dispatch('click');assert.equal(snap(h),before);assert.equal(h.c.AssetPackPicker.getSelection(),oldSelection);assert.match(h.ui('status').textContent,/catalogue refresh/);
});
test('native transaction rejects geometry/order/ID/custom/dimension mutation before history and preserves raw admission',()=>{
 for(const change of [p=>p.walls[0].x1++,p=>p.items.reverse(),p=>p.items[0].id='different',p=>p.items[0].custom.keep=false,p=>p.items[0].w++,p=>delete p.opaqueRoot]){
  const h=setup(),before=snap(h),candidate=plain(h.c.DATA);change(candidate);assert.throws(()=>h.c.applyObjectSetReplacement(candidate,{sourcePlanId:h.c.__editorPlanId,sourceSnapshot:h.c.serializeDataSnapshot(),isCurrent:()=>true}));assert.equal(snap(h),before);
 }
 const h=setup(),admission={opaque:'anonymous admission'};h.c.__legacyPlanAdmission=admission;const candidate=plain(h.c.DATA);candidate.items[0].type=manifest.items[0].id;h.c.applyObjectSetReplacement(candidate,{sourcePlanId:h.c.__editorPlanId,sourceSnapshot:h.c.serializeDataSnapshot(),isCurrent:()=>true});assert.equal(h.c.__legacyPlanAdmission,admission);assert.deepEqual(plain(h.c.DATA.walls),fixture().walls);assert.deepEqual(plain(h.c.DATA.opaqueRoot),fixture().opaqueRoot);
});
test('actual independent repository derivation keeps original saved head and ID, with a dirty pack-specific copy',async()=>{
 const h=libraryContext({plan:fixture()});await h.api.ready;const id=h.context.__editorPlanId,before=h.plan;await h.api.persistPane('native-editor',id,before);h.context.clearDirty();const head=(await h.api.repo.read(id)).revision.id;
 const {createConverter}=require('../../assets/js/asset-pack-conversion.js'),result=createConverter(contract,[model,...manifest.items]).preview(before,{approvedIndexes:[0]});
 const copy=await h.api.createIndependentPlan(result.plan,'匿名の差し替え案',{sourcePaneId:'native-editor',sourcePlanId:id,sourceSnapshot:JSON.stringify(before),isCurrent:()=>true,cataloguePack:'rpg-mansion'});assert.notEqual(copy,id);assert.equal(h.context.__editorPlanId,id);assert.deepEqual(h.plan,before);assert.equal((await h.api.repo.read(id)).revision.id,head);assert.deepEqual(plain((await h.api.repo.read(id)).payload),before);assert.equal((await h.api.repo.get('drafts',JSON.stringify([h.api.session,copy]))).dirty,true);assert.equal((await h.api.repo.get('drafts',JSON.stringify([h.api.session,copy]))).cataloguePack,'rpg-mansion');
});
