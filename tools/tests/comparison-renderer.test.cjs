const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../../assets/js/comparison-renderer.js'),'utf8');
function runtime(capture){
  const events=[];
  const frame={style:{},isConnected:false,setAttribute(){},remove(){this.isConnected=false;events.push('removed');},contentWindow:{ComparisonRenderer:{capture,dispose(){events.push('disposed');}}}};
  const context=vm.createContext({window:{},COMPARISON_PREVIEW:false,URL,DOMException,setTimeout,clearTimeout,document:{baseURI:'http://localhost:8931/index.html?room=live-room',createElement(){return frame;},body:{append(f){f.isConnected=true;events.push('created');}}}});
  vm.runInContext(source,context);
  return {pair:context.window.ComparisonCapture.pair,frame,events};
}
test('one child captures sequentially, uses the resolved A camera for B, and excludes room URLs',async()=>{
  const calls=[],resolved={pos:[1,2,3],fov:65};
  const r=runtime(async(plan,spec)=>{calls.push({plan,spec});return {png:plan,spec:resolved};});
  const results=await r.pair(['A','B'],{room:'LDK'},new AbortController().signal);
  assert.equal(results[0].png,'A');assert.equal(results[1].png,'B');assert.equal(calls.length,2);
  assert.equal(calls[1].spec,resolved);assert.equal(r.frame.src,'http://localhost:8931/index.html?comparisonPreview=1');
  assert.deepEqual(r.events,['created','disposed','removed']);
});
test('capture failure disposes the runtime and does not attempt B',async()=>{
  let calls=0;const r=runtime(async()=>{calls++;throw Error('texture failed');});
  await assert.rejects(r.pair(['A','B'],{},new AbortController().signal),/texture failed/);
  assert.equal(calls,1);assert.equal(r.frame.isConnected,false);assert.deepEqual(r.events,['created','disposed','removed']);
});
test('cancel during A removes the runtime and prevents stale B capture',async()=>{
  let release,calls=0;const r=runtime(()=>{calls++;return new Promise(resolve=>release=resolve);});
  const controller=new AbortController(),pending=r.pair(['A','B'],{},controller.signal);
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  assert.equal(r.frame.isConnected,false);release({png:'late A',spec:{}});
  await new Promise(setImmediate);assert.equal(calls,1);assert.deepEqual(r.events,['created','disposed','removed']);
});
