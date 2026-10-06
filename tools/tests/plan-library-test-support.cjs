'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto').webcrypto;
const ROOT=path.resolve(__dirname,'../..');
// Focused IndexedDB contract simulator: transactional staging, serialized writes,
// request-success-before-commit, rollback and injected transaction failure.
// This deliberately does not claim browser durability or WebGL acceptance.
function memoryIDB(){
 const dbs=new Map(),calls=[];let failure=null;
 const keyRange={only:key=>({only:key}),bound:(lo,hi)=>({lo,hi})};
 class DB{
  constructor(name){this.name=name;this.stores=new Map();this.queue=[];this.running=false;this.objectStoreNames={contains:name=>this.stores.has(name)};}
  createObjectStore(name){this.stores.set(name,new Map());return {};}
  close(){}
  transaction(names,mode='readonly'){
   names=[].concat(names);const db=this,tx={error:null,pending:0,aborted:false,completed:false,started:false,operations:[]};let staged;
   function finish(){if(tx.completed)return;tx.completed=true;db.running=false;const event=tx.aborted?'onabort':'oncomplete';tx[event]?.();db.startNext();}
   function idle(){setImmediate(()=>{if(tx.pending||tx.completed||!tx.started)return;if(failure&&(!failure.db||failure.db===db.name)&&mode==='readwrite'){const e=failure.error;failure=null;tx.error=e;tx.aborted=true;return finish();}if(!tx.aborted&&mode==='readwrite')for(const name of names)db.stores.set(name,staged.get(name));finish();});}
   function request(fn){const r={};tx.pending++;const run=()=>setImmediate(()=>{if(tx.completed)return;try{r.result=fn();r.onsuccess?.({target:r});}catch(error){tx.error=r.error=error;r.onerror?.({target:r});tx.abort();}finally{tx.pending--;idle();}});if(tx.started)run();else tx.operations.push(run);return r;}
   tx.start=()=>{tx.started=true;staged=new Map(names.map(name=>{if(!db.stores.has(name))throw Error('missing store '+name);return [name,new Map([...db.stores.get(name)].map(([k,v])=>[k,structuredClone(v)]))];}));for(const run of tx.operations)run();tx.operations=[];idle();};
   tx.abort=()=>{if(tx.completed)return;tx.aborted=true;setImmediate(finish);};
   tx.objectStore=name=>{
    function map(){if(!staged?.has(name))throw Error('missing store '+name);return staged.get(name);}
    return {get:key=>request(()=>structuredClone(map().get(key))),getKey:key=>request(()=>map().has(key)?key:undefined),getAll:()=>request(()=>[...map().values()].map(v=>structuredClone(v))),
     add:(record,key)=>request(()=>{key=key??record.id;if(map().has(key))throw Error('duplicate key');map().set(key,structuredClone(record));return key;}),
     put:(record,key)=>request(()=>{key=key??record.id;map().set(key,structuredClone(record));return key;}),
     openCursor:range=>{const rows=()=>[...map()].filter(([key])=>!range||'only'in range?(!range||key===range.only):key>=range.lo&&key<=range.hi);let i=0;const r={};tx.pending++;function next(){setImmediate(()=>{if(tx.completed)return;try{const row=rows()[i++];r.result=row?{key:row[0],value:structuredClone(row[1]),continue:next}:null;r.onsuccess?.({target:r});if(!row){tx.pending--;idle();}}catch(error){tx.error=error;tx.abort();}});}if(tx.started)next();else tx.operations.push(next);return r;}
    };
   };
   db.queue.push(tx);setImmediate(()=>db.startNext());return tx;
  }
  startNext(){if(this.running)return;const tx=this.queue.shift();if(!tx)return;this.running=true;tx.start();}
 }
 const idb={open(name){calls.push({action:'open',name});const r={};setImmediate(()=>{let fresh=!dbs.has(name);if(fresh)dbs.set(name,new DB(name));r.result=dbs.get(name);let aborted=false;r.transaction={abort(){aborted=true;}};if(fresh)r.onupgradeneeded?.();if(aborted){dbs.delete(name);r.error=new DOMException('Absent database','AbortError');r.onerror?.();}else r.onsuccess?.();});return r;}};
 return {idb,dbs,calls,keyRange,seed(dbName,store,key,value){if(!dbs.has(dbName))dbs.set(dbName,new DB(dbName));const db=dbs.get(dbName);if(!db.stores.has(store))db.stores.set(store,new Map());db.stores.get(store).set(key,structuredClone(value));},failNext(error=new DOMException('Injected failure','QuotaExceededError'),db){failure={error,db};}};
}
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.style={};this.parentNode=null;this.textContent='';this.className='';this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
 append(...children){for(const child of children)if(child instanceof Element){child.remove();child.parentNode=this;this.children.push(child);}}
 prepend(child){child.remove();child.parentNode=this;this.children.unshift(child);}
 after(child){const p=this.parentNode;if(!p)return;child.remove();child.parentNode=p;p.children.splice(p.children.indexOf(this)+1,0,child);}
 remove(){if(this.parentNode){const list=this.parentNode.children;list.splice(list.indexOf(this),1);this.parentNode=null;}}
 replaceChildren(...children){this.children.forEach(child=>child.parentNode=null);this.children=[];this.append(...children);}
 setAttribute(k,v){this.attrs[k]=v;}
 set src(value){this._src=value;if(this._sourceChanged)this._sourceChanged(value);}
 get src(){return this._src;}
 addEventListener(){}
 cloneNode(){const e=new Element(this.tagName);e.className=this.className;return e;}
 matches(selector){if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector.startsWith('[')){const parts=selector.slice(1,-1).split('=');const k=parts[0].replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return k in this.dataset&&(!parts[1]||String(this.dataset[k])===parts[1].replace(/["']/g,''));}return this.tagName.toLowerCase()===selector;}
 querySelectorAll(selector){if(selector.includes('>')){const [a,b]=selector.split('>');return this.querySelector(a)?.children.filter(e=>e.matches(b))||[];}if(selector==='[data-library-grid]')return this._grid?[this._grid]:[];if(selector==='.parallel-controls button')return this._controls||[];if(selector==='[data-library-layout]')return this._layouts||[];const result=[];for(const e of this.children){if(e.matches(selector))result.push(e);result.push(...e.querySelectorAll(selector));}return result;}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 set innerHTML(value){this._html=value;if(value.includes('data-library-grid')){this._grid=new Element();this._grid.dataset.libraryGrid='';const status=new Element();status.dataset.libraryStatus='';const heading=new Element();heading.className='parallel-heading';this._controls=[];for(const name of ['libraryOpen','libraryNew','parallelSync','parallelAlign']){const e=new Element(name==='parallelSync'?'input':'button');e.dataset[name]='';this.append(e);if(e.tagName==='BUTTON')this._controls.push(e);}this._layouts=[1,2].map(n=>{const e=new Element('button');e.dataset.libraryLayout=String(n);return e;});this.append(heading,status,this._grid,...this._layouts);this._controls.push(...this._layouts);}}
}
class Storage{constructor(){this.map=new Map();}getItem(k){return this.map.get(k)??null;}setItem(k,v){this.map.set(k,String(v));}removeItem(k){this.map.delete(k);}}
function fixture(x=100){return {walls:[],rooms:[{id:'room-stable',floor:1,x,y:0,w:1000,d:1000,n:'Fixture'}],items:[],futureExtension:{version:12,data:['preserve']}};}
function makePaneWindow(plan=fixture()){
 const document=new Element('document'),save=new Element('button'),select=new Element('select'),dirty=new Element('span');document.createElement=tag=>new Element(tag);document.body=new Element('body');document.append(document.body);save.id='save-btn';select.dataset.libraryCurrent='';dirty.dataset.libraryDirty='';document.body.append(save,select,dirty);let payload=structuredClone(plan),state={history:[],redo:[],view:{view:'2d',floor:1,twoD:{zoom:1,panX:0,panY:0}},dirty:false};const w={document,DIRTY:false,SHARED:{saveBusy:false},COMPARISON_PREVIEW:false,EditorPane:{ready:Promise.resolve(),snapshot:()=>structuredClone(payload),state:()=>({plan:structuredClone(payload),...structuredClone(state)}),view:()=>structuredClone(state.view),applyView:v=>state.view=structuredClone(v),async install(p,s){payload=structuredClone(p);const {plan:ignored,...saved}=structuredClone(s||{});state={...state,...saved,dirty:!!s?.dirty};w.DIRTY=state.dirty;return true;},dispose(){}},markDirty(){state.dirty=w.DIRTY=true;},clearDirty(){state.dirty=w.DIRTY=false;}};return {window:w,edit(p){payload=structuredClone(p);w.markDirty();},get plan(){return structuredClone(payload);}};
}
function libraryContext({mem=memoryIDB(),sessionStorage=new Storage(),localStorage=new Storage(),native=true,joined=false,search='',missing=null,plan=fixture(),iframeFactory=()=>makePaneWindow().window,beforeLibrary}={}){
 const document=new Element('document');document.getElementById=id=>document.querySelector('#'+id);document.createElement=tag=>{const e=new Element(tag);if(tag==='iframe'){e.contentWindow=iframeFactory();e._sourceChanged=()=>setImmediate(()=>e.onload?.());}return e;};document.documentElement=new Element('html');document.head=new Element('head');document.body=new Element('body');document.append(document.head,document.body);const toolbar=new Element();toolbar.id='toolbar';const save=new Element('button');save.id='save-btn';toolbar.append(save);document.body.append(toolbar);
 let installed=structuredClone(plan),history=['undo-fixture'],redo=['redo-fixture'],view={view:'2d',floor:1,twoD:{zoom:2,panX:3,panY:4}},dirty=false,failInstall=null,installFalse=false;const alerts=[],popups=[];
 const context={document,console,URL,URLSearchParams,TextEncoder,DOMException,Blob,structuredClone,crypto,indexedDB:mem.idb,IDBKeyRange:mem.keyRange,sessionStorage,localStorage,NATIVE_PLAN_EDITOR:native,NATIVE_EDITOR_PANE:native?'native-editor':null,EDITOR_PANE:null,COMPARISON_PREVIEW:!native,location:{search,hash:'',href:'http://127.0.0.1:65238/index.html'+search},history:{state:null,replaceState(state,unused,url){this.state=state;const next=new URL(url);Object.assign(context.location,{href:next.href,search:next.search,hash:next.hash});}},setTimeout,clearTimeout,queueMicrotask,requestAnimationFrame:fn=>setImmediate(fn),alert:m=>alerts.push(m),confirm:()=>false,addEventListener(){},open(){const p={closed:false,location:{replace:url=>p.url=url},close(){p.closed=true;}};popups.push(p);return p;},SHARED:{saveBusy:false,roomId:joined?'room-fixture':null},renderSaveButtonState(){},setSaveButtonBusy(v){context.SHARED.saveBusy=v;},markDirty(){dirty=context.DIRTY=true;},clearDirty(){dirty=context.DIRTY=false;},applyJsonImport(){},undoAction(){},redoAction(){},markDirtyUiOnly(){},initSharedRoomFromUrl:async()=>{if(!joined)return false;await context.PlanLibrary.withSharedIdentity('room-fixture',()=>{context.SHARED.roomId='room-fixture';});return true;},loadPreset(){context.presetLoads=(context.presetLoads||0)+1;},maybeOfferPresetChoice(){},createEditorModelPool:()=>({resources:new Set(),dispose:async()=>{}}),cloneEditorPaneState:structuredClone,PlanSchema:require(path.join(ROOT,'assets/js/plan-schema.js')),DIRTY:false};
 Object.defineProperty(context,'DATA',{get:()=>installed,set:v=>{installed=v;},configurable:true});
 context.EditorPane={ready:Promise.resolve(),snapshot:()=>structuredClone(installed),state:()=>({plan:structuredClone(installed),history:history.slice(),redo:redo.slice(),view:structuredClone(view),dirty,cataloguePack:'native-pack'}),view:()=>structuredClone(view),applyView:v=>view=structuredClone(v),async install(p,s){if(failInstall)throw failInstall;if(installFalse)return false;installed=structuredClone(p);history=s?.history?.slice()||[];redo=s?.redo?.slice()||[];view=structuredClone(s?.view||view);dirty=context.DIRTY=!!s?.dirty;return true;},dispose(){}};
 context.EditorPane.captureInstallState=()=>({plan:structuredClone(installed),history:history.slice(),redo:redo.slice(),view:structuredClone(view),dirty:context.DIRTY});
 context.EditorPane.restoreInstallState=previous=>{installed=structuredClone(previous.plan);history=previous.history.slice();redo=previous.redo.slice();view=structuredClone(previous.view);dirty=context.DIRTY=previous.dirty;};
 context.window=context;context.parent=context;context.self=context;if(missing)delete context[missing];
 const sandbox=vm.createContext(context);if(missing!=='PlanRepositoryLab')vm.runInContext(fs.readFileSync(path.join(ROOT,'assets/js/plan-repository-lab.js'),'utf8'),sandbox);if(beforeLibrary)beforeLibrary(context,sandbox);vm.runInContext(fs.readFileSync(path.join(ROOT,'assets/js/plan-library.js'),'utf8'),sandbox,{filename:'plan-library.js'});
 return {context,api:context.PlanLibrary,mem,document,alerts,popups,sessionStorage,localStorage,get plan(){return structuredClone(installed);},edit(p){installed=structuredClone(p);context.markDirty();},failInstall(error){failInstall=error;},cancelInstall(v=true){installFalse=v;}};
}
module.exports={makePaneWindow,memoryIDB,libraryContext,fixture,Storage,ROOT};
