const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('assets/js/parallel-editors.js','utf8');
function runtime(catalogue=Promise.resolve()){
 const listeners=new Map(),timers=new Map();let serial=0;
 const noop=()=>{},document={addEventListener:noop,querySelector:()=>null,documentElement:{classList:{add:noop}}};
 const root={document,comparisonCatalogueReady:catalogue,parent:{ParallelEditors:{activeId:null,modelPool:{resources:new Set()}}},addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)};
 const old={original:true},ctx={window:root,document,EDITOR_PANE:'test-pane',render3DNow:noop,_jsonImportRequest:0,DATA:old,sc3:null,ren:null,orbit:null,composer:null,_pmremGen:null,_envRT:null,_modelCache:{},_texCache:{},setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const fire=()=>{root.threeModulesReady=true;for(const fn of [...(listeners.get('three-ready')||[])])fn();};
 return {root,ctx,old,listeners,timers,fire};
}
const saved={view:{view:'3d-int'}};
test('dispose cancels engine listener/timer and late install never replaces DATA or builds 3D',async()=>{
 const r=runtime(),pending=r.root.EditorPane.install({replacement:true},saved);await new Promise(setImmediate);
 assert.equal(r.listeners.get('three-ready').size,1);assert.equal(r.timers.size,1);
 r.root.EditorPane.dispose();assert.equal(r.listeners.get('three-ready').size,0);assert.equal(r.timers.size,0);
 r.fire();assert.equal(await pending,false);assert.equal(r.ctx.DATA,r.old);assert.equal(r.ctx.ren,null);
});
test('dispose during catalogue wait prevents registering a later engine wait',async()=>{
 let release;const catalogue=new Promise(resolve=>release=resolve),r=runtime(catalogue),pending=r.root.EditorPane.install({replacement:true},saved);
 r.root.EditorPane.dispose();release();assert.equal(await pending,false);assert.equal(r.timers.size,0);assert.equal(r.listeners.get('three-ready')?.size||0,0);assert.equal(r.ctx.DATA,r.old);
});
test('new install cancels older wait and only its generation may continue',async()=>{
 const r=runtime(),first=r.root.EditorPane.install({first:true},saved);await new Promise(setImmediate);
 const second=r.root.EditorPane.install({second:true},saved);await new Promise(setImmediate);
 assert.equal(await first,false);assert.equal(r.listeners.get('three-ready').size,1);assert.equal(r.timers.size,1);
 r.root.EditorPane.dispose();assert.equal(await second,false);assert.equal(r.ctx.DATA,r.old);
});
test('engine timeout rejects restoration without writing DATA and releases pending listener',async()=>{
 const r=runtime(),pending=r.root.EditorPane.install({replacement:true},saved);await new Promise(setImmediate);
 for(const callback of [...r.timers.values()])callback();await assert.rejects(pending,/3D描画エンジン/);
 assert.equal(r.ctx.DATA,r.old);assert.equal(r.listeners.get('three-ready').size,0);assert.equal(r.timers.size,0);
});
