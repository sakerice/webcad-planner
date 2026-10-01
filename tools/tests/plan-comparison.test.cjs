const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePlan,fit}=require('../../assets/js/plan-comparison.js');
const fixture=require('./fixtures/house-2f.json');
test('snapshots clone the full plan without changing live edits',()=>{const before=JSON.stringify(fixture),p=validatePlan(fixture);p.walls[0].color='#ff0000';assert.equal(JSON.stringify(fixture),before);assert.notEqual(p.walls[0].color,fixture.walls[0].color);});
test('invalid structure, coordinates and non-finite values reject',()=>{for(const p of [null,[],{}, {...fixture,rooms:[null]}, {...fixture,walls:[{x1:NaN,y1:0,x2:5,y2:5}]}])assert.throws(()=>validatePlan(p));});
test('one shared view frames both plans deterministically',()=>{const b=validatePlan(fixture);b.walls.forEach(w=>{w.x1+=10000;w.x2+=10000;});const v=fit([fixture,b],1);assert.deepEqual(v,fit([b,fixture],1));assert.ok(v.span>10000);assert.equal(v.floor,1);});
test('storage acknowledges only transaction completion; abort is a failure',async()=>{
  const {storage}=require('../../assets/js/plan-comparison.js');
  let tx,closed=0;
  global.indexedDB={open(){const req={result:{close(){closed++;},transaction(){tx={objectStore(){return {get(){const req={result:undefined};queueMicrotask(()=>req.onsuccess());return req;},put(){return {result:'state'};}};}};return tx;}}};queueMicrotask(()=>req.onsuccess());return req;}};
  try{
    let settled=false;const save=storage({version:1,plans:[],views:[]}).then(()=>settled=true);
    await new Promise(setImmediate);assert.equal(settled,false,'request success must not imply committed');
    tx.oncomplete();await save;assert.equal(settled,true);assert.equal(closed,1);
    const aborted=storage({version:1,plans:[],views:[]});await new Promise(setImmediate);tx.error=Error('transaction aborted');tx.onabort();
    await assert.rejects(aborted,/transaction aborted/);assert.equal(closed,2);
  }finally{delete global.indexedDB;}
});
test('saved 3D cameras require a finite pose and fixed comparison viewport',()=>{
  const {validateCamera}=require('../../assets/js/plan-comparison.js');
  const spec={floor:1,pos:[1,1.6,3],target:[4,1.5,1],up:[0,1,0],fov:65,width:960,height:720,lighting:{timeOfDay:'day'}};
  assert.deepEqual(validateCamera(spec),spec);
  for(const invalid of [{...spec,fov:Infinity},{...spec,pos:[NaN,1,2]},{...spec,width:1920},{...spec,target:null}])assert.throws(()=>validateCamera(invalid));
});
test('preview storage adapter cannot read or overwrite the editor database',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../../assets/js/app-state.js'),'utf8');
  const block=source.slice(source.indexOf('var StorageAdapter ='),source.indexOf('function markDirty(){'));
  let opens=0;const context=vm.createContext({COMPARISON_PREVIEW:true,indexedDB:{open(){opens++;throw Error('must not open');}}});
  vm.runInContext(block,context);
  assert.equal(await context.StorageAdapter.load(),null);assert.equal(await context.StorageAdapter.hasData(),false);
  await assert.rejects(context.StorageAdapter.save({walls:[]}),/Read-only/);assert.equal(opens,0);
});

test('immutable workspace merge preserves additions from stale tabs in every collection',()=>{
  const {mergeWorkspace}=require('../../assets/js/plan-comparison.js');
  const a={version:1,plans:[{id:'a'}],views:[{id:'va'}],cameras:[{id:'ca'}]};
  const b={version:1,plans:[{id:'b'}],views:[{id:'vb'}],cameras:[{id:'cb'}]};
  const merged=mergeWorkspace(a,b);
  for(const key of ['plans','views','cameras'])assert.equal(merged[key].length,2);
  assert.deepEqual(mergeWorkspace(merged,a),merged);
  assert.throws(()=>mergeWorkspace(a,{...a,plans:[{id:'a',name:'conflict'}]}),/別のタブ/);
  assert.throws(()=>mergeWorkspace({...a,version:2},b),/保存形式/);
  assert.equal(a.plans.length,1);
});
test('2D wall colors use renderer whole, floor, wall, default precedence',()=>{
  const {interiorColor}=require('../../assets/js/plan-comparison.js');
  const wall={floor:2,interiorColor:'#112233',color:'#999999'};
  const plan={interiorWallSettings:{whole:{linked:true,color:'#abcdef'},floors:{2:{linked:true,color:'#123456'}}}};
  assert.equal(interiorColor(plan,wall),'#abcdef');
  plan.interiorWallSettings.whole.linked=false;assert.equal(interiorColor(plan,wall),'#123456');
  plan.interiorWallSettings.floors[2].linked=false;assert.equal(interiorColor(plan,wall),'#112233');
  assert.equal(interiorColor({}, {color:'#999999'}),'#f4f0e8');
  plan.interiorWallSettings.whole={linked:true};assert.equal(interiorColor(plan,wall),'#f4f0e8');
});
