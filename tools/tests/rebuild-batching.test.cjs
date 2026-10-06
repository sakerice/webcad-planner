'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {topLevelFunction,topLevelVar}=require('./height-runtime.cjs');
const source=require('./app-source.cjs').appSource();
function host(options={}){
  const callbacks=[],timers=new Map(),snapshots=[],events=[];let timerId=0,clock=1;
  const classes=new Set(options.loading?['show']:[]),loading={classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)}};
  const ctx={sc3:{},ren:{shadowMap:{}},DATA:{revision:0},ST:{view:'3d-int'},window:{},document:{getElementById:id=>id==='app-loading'?loading:{textContent:''}},performance:{now:()=>clock++},
    isLikelyHeavy3DRebuild:()=>options.heavy!==false,build3D(){snapshots.push(ctx.DATA.revision);events.push(['build',ctx._tablet3DRebuildQueued]);if(ctx.onBuild)ctx.onBuild();},invalidateLightBudget(){},
    runAfterNextPaint(fn){callbacks.push(fn);},setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  ctx.window=ctx;ctx.WalkTps={invalidate(){events.push(['invalidate',ctx._tablet3DRebuildQueued]);}};vm.createContext(ctx);
  const names=['_tablet3DRebuildQueued','_tablet3DRebuildBatch','_tablet3DRebuildActive','_3DRebuildDepth','_last3DRebuildMs','APP_LOADING_MIN_MS','_appLoadingShownAt','_appLoadingHideTimer','_appLoadingGeneration'];
  const vars=names.filter(n=>source.includes('\nvar '+n+'=')||source.includes('\nvar '+n+' =')).map(topLevelVar);
  const functions=['showAppLoading','hideAppLoading','hideAppLoadingForOwner','runWithAppLoading','finish3DRebuildBatch','perform3DRebuild','rebuild3D'].filter(n=>source.includes('\nfunction '+n+'(')).map(topLevelFunction);
  vm.runInContext(vars.concat(functions).join('\n'),ctx);
  return {ctx,callbacks,snapshots,events,classes,flush(){const fn=callbacks.shift();assert.ok(fn,'queued callback');fn();},flushTimers(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}
test('heavy burst, later quiet/light requests, and own overlay share one latest-DATA batch',()=>{
 const h=host();h.ctx.rebuild3D();h.ctx.DATA.revision=1;h.ctx.rebuild3D();h.ctx.DATA.revision=2;h.ctx.rebuild3D(true);h.ctx.isLikelyHeavy3DRebuild=()=>false;h.ctx.DATA.revision=3;h.ctx.rebuild3D();
 assert.deepEqual(h.snapshots,[],'no rebuild before paint');assert.equal(h.callbacks.length,1);h.flush();assert.deepEqual(h.snapshots,[3]);assert.equal(h.ctx._tablet3DRebuildQueued,false);h.flushTimers();assert.equal(h.classes.has('show'),false);
});
test('without a pending batch, quiet, light, and unrelated loading keep synchronous behavior',()=>{
 for(const options of [{heavy:false},{loading:true},{}]){const h=host(options);h.ctx.rebuild3D(!options.loading&&options.heavy!==false);assert.deepEqual(h.snapshots,[0]);assert.equal(h.callbacks.length,0);if(options.loading){h.flushTimers();assert.equal(h.classes.has('show'),true);}}
});
test('forced synchronous build consumes pending work and obsolete callback cannot cancel a later batch',()=>{
 const h=host();h.ctx.rebuild3D();h.ctx.DATA.revision=1;h.ctx.perform3DRebuild();assert.deepEqual(h.snapshots,[1]);assert.equal(h.ctx._tablet3DRebuildQueued,false);h.flushTimers();h.ctx.DATA.revision=2;h.ctx.rebuild3D();assert.equal(h.callbacks.length,2);h.flush();assert.equal(h.ctx._tablet3DRebuildQueued,true);assert.deepEqual(h.snapshots,[1]);h.flush();assert.deepEqual(h.snapshots,[1,2]);assert.equal(h.ctx._tablet3DRebuildQueued,false);
});
test('reentrant change during a forced build gets a fresh batch that survives old cleanup',()=>{
 const h=host();h.ctx.rebuild3D();h.ctx.onBuild=()=>{h.ctx.onBuild=null;h.ctx.DATA.revision=2;h.ctx.rebuild3D();};h.ctx.DATA.revision=1;h.ctx.perform3DRebuild();assert.deepEqual(h.snapshots,[1]);assert.equal(h.ctx._tablet3DRebuildQueued,true);h.flushTimers();assert.equal(h.classes.has('show'),true);h.flush();assert.deepEqual(h.snapshots,[1]);h.flush();assert.deepEqual(h.snapshots,[1,2]);assert.equal(h.ctx._tablet3DRebuildQueued,false);
});
test('queued and forced failures release their batch and permit recovery',()=>{
 for(const forced of [false,true]){const h=host();h.ctx.rebuild3D();h.ctx.onBuild=()=>{throw Error('fixture rebuild failure');};assert.throws(()=>forced?h.ctx.perform3DRebuild():h.flush(),/fixture rebuild failure/);assert.equal(h.ctx._tablet3DRebuildQueued,false);h.flushTimers();assert.equal(h.classes.has('show'),false);h.ctx.onBuild=null;h.ctx.DATA.revision=2;h.ctx.rebuild3D();if(forced)h.flush();h.flush();assert.deepEqual(h.snapshots,[0,2]);}
});
test('failure with a reentrant request does not release or hide the newer batch',()=>{
 const h=host();h.ctx.rebuild3D();h.ctx.onBuild=()=>{h.ctx.onBuild=null;h.ctx.DATA.revision=1;h.ctx.rebuild3D();throw Error('fixture rebuild failure');};assert.throws(()=>h.ctx.perform3DRebuild(),/fixture/);assert.equal(h.ctx._tablet3DRebuildQueued,true);h.flushTimers();assert.equal(h.classes.has('show'),true);h.flush();h.flush();assert.deepEqual(h.snapshots,[0,1]);
});
test('a newer unrelated loading owner remains visible after queued work finishes',()=>{
 const h=host();h.ctx.rebuild3D();h.ctx.showAppLoading('unrelated import');h.flush();h.flushTimers();assert.equal(h.classes.has('show'),true);h.ctx.hideAppLoading();h.flushTimers();assert.equal(h.classes.has('show'),false);
});
test('new loading cancels an old delayed hide, including the same-clock case',()=>{
 const h=host();h.ctx.performance.now=()=>100;h.ctx.rebuild3D();h.flush();h.ctx.showAppLoading('unrelated import');h.flushTimers();assert.equal(h.classes.has('show'),true);
});
test('TPS stays unverified during queued work and is invalidated after completion',()=>{
 const h=host();h.ctx.rebuild3D();h.flush();assert.deepEqual(h.events,[['invalidate',false],['build',true],['invalidate',false]]);
});
test('loss of scene before callback still clears the owned overlay and pending state',()=>{
 const h=host();h.ctx.rebuild3D();h.ctx.sc3=null;h.flush();assert.equal(h.ctx._tablet3DRebuildQueued,false);assert.deepEqual(h.snapshots,[]);h.flushTimers();assert.equal(h.classes.has('show'),false);
});

// runWithAppLoading passes Promise fulfillments straight to hideAppLoading.
// Public callback values must never be interpreted as an ownership token.
test('actual runWithAppLoading hides for boolean, object, undefined and other Promise values',async()=>{
 for(const value of [true,false,{done:true},undefined,17,'done',null]){
  const h=host();h.ctx.runWithAppLoading('promise import',()=>Promise.resolve(value));assert.equal(h.classes.has('show'),true);h.flush();await Promise.resolve();h.flushTimers();assert.equal(h.classes.has('show'),false,'fulfilled value '+String(value));
 }
});
test('actual runWithAppLoading releases overlay after Promise rejection and synchronous throw',async()=>{
 const rejected=host();rejected.ctx.runWithAppLoading('promise import',()=>Promise.reject(Error('fixture promise rejection')));rejected.flush();await Promise.resolve();rejected.flushTimers();assert.equal(rejected.classes.has('show'),false);
 const thrown=host();thrown.ctx.runWithAppLoading('sync import',()=>{throw Error('fixture sync failure');});thrown.flush();thrown.flushTimers();assert.equal(thrown.classes.has('show'),false);
});
test('queued rebuild cannot hide a newer real runWithAppLoading Promise owner',async()=>{
 const h=host();let resolve;h.ctx.rebuild3D();h.ctx.runWithAppLoading('promise import',()=>new Promise(r=>{resolve=r;}));h.flush();h.flushTimers();assert.equal(h.classes.has('show'),true);h.flush();h.flushTimers();assert.equal(h.classes.has('show'),true);resolve({done:true});await Promise.resolve();h.flushTimers();assert.equal(h.classes.has('show'),false);
});
test('public hideAppLoading still ignores arguments used by callback and event callers',()=>{
 for(const value of [true,{type:'click'},undefined,17]){const h=host();h.ctx.showAppLoading('ordinary loading');h.ctx.hideAppLoading(value);h.flushTimers();assert.equal(h.classes.has('show'),false);}
});
