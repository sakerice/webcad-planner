const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const page=(floors,notes=[])=>({floors:floors.map(floor=>({floor,width:1820,depth:1820,rooms:[{name:'A',parts:[{x0:0,y0:0,x1:1820,y1:1820}]}]})),notes});
test('page order never becomes floor identity and notes keep provenance',async()=>{
  const {mergeReadPages}=await import('../../worker/plan-pages.mjs');
  const input=[page([3],['寸法は未確定']),page([1,2],['階段は要確認'])];
  const snapshot=JSON.stringify(input), r=mergeReadPages(input);
  assert.deepEqual(r.floors.map(f=>f.floor),[3,1,2]);
  assert.deepEqual(r.notes,['1ページ: 寸法は未確定','2ページ: 階段は要確認']);
  assert.deepEqual(r.pageProblems,[]); assert.equal(JSON.stringify(input),snapshot);
});
for(const floors of [[[1,2],[2]],[[1],[1],[1]],[[2,2]],[[null]],[[0]],[[1.5]],[[6]],[[undefined]]]) {
  test(`ambiguous identities produce no partial floors: ${JSON.stringify(floors)}`,async()=>{
    const {mergeReadPages}=await import('../../worker/plan-pages.mjs');
    const pages=floors.map(f=>page(f,['読めない文字がある']));
    const r=mergeReadPages(pages);
    assert.ok(r.pageProblems.length); assert.deepEqual(r.floors,[]); assert.equal(r.notes.length,pages.length);
    const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
    const response=finishImportedPlan(r,{calls:pages.length},{pages});
    assert.equal(response.status,422);
    const body=await response.json();
    assert.equal(body.error,'ai_ambiguous_floors'); assert.equal(body.plan,undefined);
    assert.equal(body.revisionCandidate,false); assert.deepEqual(body.pages,JSON.parse(JSON.stringify(pages)));
    assert.equal(body.notes.length,pages.length);
  });
}
test('single-page legacy readings and ordinary notes remain compatible',async()=>{
  const {mergeReadPages}=await import('../../worker/plan-pages.mjs');
  const old={walls:[{x1:0,y1:0,x2:1820,y2:0}],notes:['legacy']};
  assert.equal(mergeReadPages([old]),old);
  assert.deepEqual(mergeReadPages([page(['2'],['単独'])]).notes,['単独']);
  const {finishImportedPlan}=await import('../../worker/routes-ai.mjs');
  const response=finishImportedPlan(mergeReadPages([page([1],['曖昧']),page([2],['要確認'])]));
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).notes,['1ページ: 曖昧','2ページ: 要確認']);
});
test('room-use evidence survives editable object construction without mutating input',()=>{
  const context={document:undefined,nextId:1,newRoomFloorRaiseMm:()=>0}; context.self=context;
  vm.createContext(context); vm.runInContext(fs.readFileSync('assets/js/plan-import.js','utf8'),context);
  const input={rooms:[{n:'趣味室',x:0,y:0,w:1000,d:1000,use:'bedroom'},{n:'未分類',x:1000,y:0,w:1000,d:1000}]};
  const snapshot=JSON.stringify(input), out=context.PlanImport.toAppObjects(input);
  assert.equal(out.rooms[0].use,'bedroom'); assert.equal('use' in out.rooms[1],false);
  assert.equal(JSON.stringify(input),snapshot);
});
