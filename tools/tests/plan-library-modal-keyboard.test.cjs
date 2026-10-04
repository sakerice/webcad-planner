'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {libraryContext,ROOT}=require('./plan-library-test-support.cjs');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const shortcutStart=html.indexOf("window.addEventListener('keydown', function(e){\n  if(isPlanImportDialogOpen()) return;"),shortcutEnd=html.indexOf("window.addEventListener('resize',function(){",shortcutStart);
const cameraStart=html.indexOf("document.addEventListener('keydown',function(e){\n    if(isPlanImportDialogOpen()) return;"),cameraEnd=html.indexOf('  loop3D();',cameraStart);
assert.ok(shortcutStart>=0&&shortcutEnd>shortcutStart&&cameraStart>=0&&cameraEnd>cameraStart,'real native key handlers must be found');
function runtime({cameraBeforeLibrary=false}={}){
 const listeners={window:[],document:[]},calls={},bump=name=>calls[name]=(calls[name]||0)+1;let sandbox,walking=false;
 function register(surface){return (type,fn,options)=>listeners[surface].push({type,fn,capture:options===true||!!options?.capture});}
 const h=libraryContext({beforeLibrary(context,vmContext){
  sandbox=vmContext;context.document.addEventListener=register('document');context.addEventListener=register('window');
  const create=context.document.createElement;context.document.createElement=tag=>{const element=create(tag);element.focus=()=>context.document.activeElement=element;return element;};
  context.ST={selected:context.DATA.rooms[0],tool:'select',drawing:false,snap:10,placingRot:0,shiftKey:false,ctrlKey:false};context.iMov={w:true};context.isInt=true;context.ren=null;context.isPlanImportDialogOpen=()=>false;context.isWalkView=()=>walking;context.isObjectLocked=()=>false;
  context.delSel=()=>{context.DATA.rooms.splice(0,1);context.markDirty();bump('delete');};context.copySelectedObject=()=>{bump('copy');return true;};context.pasteCopiedObject=()=>{bump('paste');return true;};
  context.undoAction=()=>bump('undo');context.redoAction=()=>bump('redo');context.saveState=()=>bump('history');context.draw2d=()=>bump('draw');context.updateProps=()=>bump('props');context.invalidate3D=()=>bump('invalidate');context.finishWalkRouteDrawing=()=>bump('finish-route');context.exitWalkMode=()=>bump('exit-walk');context.setView=()=>bump('set-view');
  vm.runInContext(html.slice(shortcutStart,shortcutEnd),sandbox);
  if(cameraBeforeLibrary)vm.runInContext(html.slice(cameraStart,cameraEnd),sandbox);
 }});
 if(!cameraBeforeLibrary)vm.runInContext(html.slice(cameraStart,cameraEnd),sandbox);
 function key(type,value,options={}){
  const event={type,key:value,target:options.target||h.document.activeElement||h.document.body,metaKey:false,ctrlKey:false,shiftKey:false,...options,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},stopImmediatePropagation(){this.propagationStopped=this.immediateStopped=true;}};
  // DOM ordering matters: capturing document listeners run before any native
  // document/window bubbling handler, irrespective of registration order.
  for(const [surface,capture] of [['window',true],['document',true],['document',false],['window',false]]){
   if(event.propagationStopped)break;
   for(const listener of listeners[surface])if(listener.type===type&&listener.capture===capture){listener.fn(event);if(event.immediateStopped)break;}
  }
  return event;
 }
 return Object.assign(h,{calls,key,setWalking:value=>walking=value});
}

test('existing library dialogs isolate real native scene shortcuts with earlier or later 3D listeners',async()=>{
 for(const cameraBeforeLibrary of [true,false]){
  const h=runtime({cameraBeforeLibrary});await h.api.ready;await h.api.newPlan();assert.equal(h.document.activeElement.tagName,'SECTION');const before=h.plan,view=h.context.EditorPane.view(),state=JSON.stringify(h.context.ST);
  for(const [key,modifiers] of [['Delete',{}],['Backspace',{}],['z',{ctrlKey:true}],['Z',{ctrlKey:true,shiftKey:true}],['y',{metaKey:true}],['c',{metaKey:true}],['v',{ctrlKey:true}],['a',{ctrlKey:true}],['ArrowLeft',{}],['ArrowUp',{}],['ArrowDown',{}],['ArrowRight',{}],['f',{}],['v',{}],['r',{}],['w',{}],['Shift',{}]]){
   const event=h.key('keydown',key,modifiers);assert.equal(event.propagationStopped,true,key+' owned by modal');assert.equal(event.defaultPrevented,undefined,key+' retains native defaults');
  }
  assert.deepEqual(h.plan,before);assert.deepEqual(h.context.EditorPane.view(),view);assert.equal(JSON.stringify(h.context.ST),state);assert.deepEqual(h.calls,{});assert.equal(h.context.DIRTY,false);
  // Releasing a key held before the dialog must still clear movement/modifiers.
  h.context.ST.shiftKey=h.context.ST.ctrlKey=true;h.key('keyup','w');h.key('keyup','Shift');assert.equal(h.context.iMov.w,false);assert.equal(h.context.ST.shiftKey,false);assert.equal(h.context.ST.ctrlKey,false);
  h.setWalking(true);const escape=h.key('keydown','Escape');assert.equal(escape.defaultPrevented,true);assert.equal(escape.immediateStopped,true);assert.equal(h.document.querySelector('.library-dialog'),null);assert.equal(h.calls['exit-walk'],undefined);assert.equal(h.calls['set-view'],undefined);assert.deepEqual(h.plan,before);
  // Control proves the unchanged native handler is live once the dialog closes.
  h.setWalking(false);h.key('keydown','Delete');assert.equal(h.calls.delete,1);assert.equal(h.plan.rooms.length,0);assert.equal(h.context.DIRTY,true);
 }
});

test('dialog inputs keep browser editing defaults while real native copy/undo/paste/arrows and Escape stay isolated',async()=>{
 const h=runtime();await h.api.ready;await h.api.newPlan();const input=h.document.querySelector('.library-dialog').querySelector('input');input.focus();const before=h.plan;
 for(const [key,modifiers] of [['z',{ctrlKey:true}],['y',{ctrlKey:true}],['c',{ctrlKey:true}],['v',{ctrlKey:true}],['a',{metaKey:true}],['ArrowLeft',{}],['Delete',{}],['Backspace',{}],['Enter',{}],['Shift',{}]]){
  const event=h.key('keydown',key,modifiers);assert.equal(event.defaultPrevented,undefined,key+' editing/default behavior preserved');assert.equal(event.immediateStopped,true);
 }
 assert.deepEqual(h.calls,{});assert.deepEqual(h.plan,before);assert.equal(h.context.ST.shiftKey,false);const create=h.document.querySelector('.library-dialog').querySelector('button');create.focus();for(const key of ['Enter',' ','Delete','ArrowRight']){const event=h.key('keydown',key);assert.equal(event.defaultPrevented,undefined,key+' button/default behavior preserved');assert.equal(event.immediateStopped,true);}assert.deepEqual(h.calls,{});h.key('keydown','Escape');assert.equal(h.document.querySelector('.library-dialog'),null);assert.equal(h.calls['set-view'],undefined);assert.deepEqual(h.plan,before);
});
