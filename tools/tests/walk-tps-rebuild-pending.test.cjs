const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {topLevelFunction,topLevelVar}=require('./height-runtime.cjs');
function host(){
  let callback,revision=0,builds=0;
  const ctx={sc3:{},ren:{shadowMap:{}},document:{getElementById:()=>null},window:{WalkTps:{invalidate:()=>revision++}},isLikelyHeavy3DRebuild:()=>true,
    showAppLoading(){},hideAppLoadingForOwner(){},hideAppLoading(){},runAfterNextPaint:f=>{callback=f;},build3D:()=>builds++,invalidateLightBudget(){}};
  ctx.WalkTps=ctx.window.WalkTps;vm.createContext(ctx);
  vm.runInContext(['_tablet3DRebuildQueued','_tablet3DRebuildBatch','_tablet3DRebuildActive','_3DRebuildDepth','_last3DRebuildMs'].map(topLevelVar)
    .concat(['finish3DRebuildBatch','perform3DRebuild','rebuild3D'].map(topLevelFunction)).join('\n'),ctx);
  return {ctx,get revision(){return revision;},get builds(){return builds;},flush(){callback();}};
}
test('queued rebuild invalidates TPS immediately and again after the pending flag clears',()=>{
 const h=host();h.ctx.rebuild3D();assert.equal(h.revision,1);assert.equal(h.ctx._tablet3DRebuildQueued,true);assert.equal(h.builds,0);h.flush();assert.equal(h.ctx._tablet3DRebuildQueued,false);assert.equal(h.builds,1);assert.equal(h.revision,2);
});
test('failed rebuild still releases pending state and invalidates TPS for recovery',()=>{
 const h=host();h.ctx.build3D=()=>{throw Error('fixture rebuild failure');};h.ctx.rebuild3D();assert.throws(()=>h.flush(),/fixture/);assert.equal(h.ctx._tablet3DRebuildQueued,false);assert.equal(h.revision,2);
});
