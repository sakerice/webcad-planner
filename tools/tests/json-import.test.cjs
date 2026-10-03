const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const PlanSchema = require('../../assets/js/plan-schema.js');
const source = readFileSync(join(__dirname, '../../index.html'), 'utf8');
const implementation = source.slice(source.indexOf('function stageJsonImport('), source.indexOf('// 天井に固定する器具'));
const state = readFileSync(join(__dirname, '../../assets/js/app-state.js'), 'utf8');
const ids = state.slice(state.indexOf('function ensureObjectIds('), state.indexOf('function objectIdLabel('));
function plan() {
  return {walls:[{id:'p1',x1:0,y1:0,x2:4000,y2:0,thick:120}],rooms:[],
    items:[{type:'unknown-historical-model',x:'100',y:'200'}]};
}
function setup() {
  const readers = [], alerts = [], calls = [];
  const c = vm.createContext({PlanSchema, console:{warn(){}}, DATA:plan(), ST:{selected:{id:99},zoom:2},
    DRAG:{active:true}, WALL_H:2850,nextId:100,LIGHT_SETTINGS:{northDeg:90},DIRTY:false,
    _defaultPlanPending:true,camExt:null,orbit:null,HISTORY:['undo'],REDO_HISTORY:['redo'],
    document:{getElementById:()=>null},alert:m=>alerts.push(m),
    FileReader:class {constructor(){readers.push(this);} readAsText(f){this.file=f;}},
  });
  for (const name of ['ensureExteriorWallSettings','ensureInteriorWallSettings','ensureRoofAppearance',
    'ensureFloorMetadata','ensureHeightDefaults','syncExteriorWallSettings','normalizeLegacyFurnitureItems',
    'syncNorthFromPlan','syncNorthUi','syncHeightDefaultsUI','updateProps','draw2d','rebuild3D',
    'renderSaveButtonState','sharedForceFullSync','queueSharedSync','queueSharedLocalAutoSave']) {
    c[name] = () => calls.push(name);
  }
  c.resetHeightGlobalsForPlanLoad=()=>{c.WALL_H=2400;};
  c.restoreViewState=()=>{c.ST.zoom=5;c.ST._camStash={};};
  c.clearEditHistory=()=>{c.HISTORY.length=0;c.REDO_HISTORY.length=0;};
  vm.runInContext(ids+'\n'+implementation,c);
  return {c,readers,alerts,calls};
}
function snapshot(c) {
  return JSON.stringify([c.DATA,c.ST,c.DRAG,c.WALL_H,c.nextId,c.LIGHT_SETTINGS,c.DIRTY,
    c._defaultPlanPending,c.HISTORY,c.REDO_HISTORY]);
}
test('invalid syntax and shapes never mutate live state or touch rendering/shared storage',()=>{
  for(const text of ['{','{}','null','[]','42','{"walls":[],"rooms":[],"items":[null]}',
    JSON.stringify({...plan(),walls:[{x1:'bad'}]})]) {
    const {c,calls}=setup(), before=snapshot(c), live=c.DATA;
    assert.throws(()=>c.stageJsonImport(text));
    assert.equal(snapshot(c),before);assert.equal(c.DATA,live);assert.deepEqual(calls,[]);
  }
});
test('every migration failure restores data identity, selection, height and ID allocator',()=>{
  for(const name of ['ensureObjectIds','ensureExteriorWallSettings','ensureInteriorWallSettings',
    'ensureRoofAppearance','ensureFloorMetadata','ensureHeightDefaults','syncExteriorWallSettings','normalizeLegacyFurnitureItems']) {
    const {c,calls}=setup(),before=snapshot(c),live=c.DATA,selected=c.ST.selected;
    c[name]=()=>{c.DATA.items.push({});c.ST.selected=null;c.WALL_H=1999;c.nextId=900;throw Error(name);};
    assert.throws(()=>c.stageJsonImport(JSON.stringify(plan())),new RegExp(name));
    assert.equal(snapshot(c),before);assert.equal(c.DATA,live);assert.equal(c.ST.selected,selected);
    assert.ok(!calls.some(x=>/shared|queue|draw2d/.test(x)));
  }
});
test('legacy numeric coordinates, missing floors and IDs, unknown types are staged without ID collisions',()=>{
  const {c}=setup(), before=snapshot(c);
  const result=c.stageJsonImport(JSON.stringify(plan()));
  assert.equal(snapshot(c),before);
  assert.equal(result.data.items[0].x,100);assert.equal(result.data.items[0].floor,1);
  assert.equal(result.data.walls[0].id,'p1');assert.notEqual(result.data.items[0].id,'p1');
  assert.equal(result.wallHeight,2400);
});
test('failure at each apply step leaves undo/redo and live state usable, even if recovery fails too',()=>{
  for(const name of ['restoreViewState','syncNorthFromPlan','syncHeightDefaultsUI','updateProps','draw2d','rebuild3D','renderSaveButtonState']) {
    const {c,calls}=setup();const staged=c.stageJsonImport(JSON.stringify(plan()));
    const before=snapshot(c),live=c.DATA,state=c.ST;
    c[name]=()=>{throw Error(name);};
    assert.throws(()=>c.applyJsonImport(staged),new RegExp(name));
    assert.equal(snapshot(c),before);assert.equal(c.DATA,live);assert.equal(c.ST,state);
    assert.ok(!calls.some(x=>/shared|queue/.test(x)));
  }
});
test('success resets stale selections and history and only then queues shared work',()=>{
  const {c,calls}=setup();
  c.applyJsonImport(c.stageJsonImport(JSON.stringify(plan())));
  assert.equal(c.ST.selected,null);assert.equal(c.DRAG.active,false);
  assert.equal(c.HISTORY.length,0);assert.equal(c.REDO_HISTORY.length,0);
  assert.equal(c.DIRTY,true);assert.equal(c._defaultPlanPending,false);
  assert.ok(calls.indexOf('queueSharedSync')>calls.indexOf('rebuild3D'));
});
test('cancel, read error, abort, repeat and out-of-order readers preserve current work',()=>{
  const {c,readers,alerts}=setup(),before=snapshot(c);
  c.doImport({files:[]});assert.equal(readers.length,0);
  const input={files:['first'],value:'same.json'};
  c.doImport(input);assert.equal(input.value,'');readers[0].onerror();
  assert.equal(snapshot(c),before);assert.equal(alerts.length,1);
  c.doImport(input);readers[1].onabort();assert.equal(snapshot(c),before);
  c.doImport(input);c.doImport(input);
  readers[3].onload({target:{result:JSON.stringify(plan())}});
  const after=snapshot(c);
  readers[2].onload({target:{result:'{}'}});readers[2].onerror();
  assert.equal(snapshot(c),after);assert.equal(alerts.length,1);
  c.doImport(input);readers[4].onload({target:{result:'{}'}});
  assert.equal(snapshot(c),after);assert.equal(alerts.length,2);
});

test('empty/missing wall and item IDs cannot collide with p1; existing IDs and references survive staging',()=>{
  const {c}=setup(),before=snapshot(c);
  const input=plan();
  input.walls.push({...input.walls[0],id:''},{...input.walls[0],id:null},{...input.walls[0],id:undefined});
  input.rooms=[{id:0,x:0,y:0,w:4000,d:3000,n:'numeric zero room'},
    {id:'p2',x:4000,y:0,w:4000,d:3000,n:'referenced room'}];
  input.items=[{...input.items[0],id:'p3',baseRoom:0},
    {...input.items[0],id:'',baseRoom:'p2'},
    {...input.items[0],id:'',baseRoom:'p2'},
    {...input.items[0],id:null}, {...input.items[0]}];
  input.walls[0].baseRoom='p2';
  input.exteriorWallSettings={walls:{p1:{color:'#123456'}}};
  assert.equal(PlanSchema.validatePlan(input).ok,true);
  const out=c.stageJsonImport(JSON.stringify(input)).data;
  assert.equal(snapshot(c),before);
  assert.equal(PlanSchema.validatePlan(out).ok,true);
  const all=[...out.walls,...out.rooms,...out.items];
  assert.equal(new Set(all.map(o=>String(o.id))).size,all.length);
  assert.equal(out.walls[0].id,'p1');assert.equal(out.rooms[0].id,0);
  assert.equal(out.rooms[1].id,'p2');assert.equal(out.items[0].id,'p3');
  assert.equal(out.items[0].baseRoom,0);assert.equal(out.items[1].baseRoom,'p2');
  assert.equal(out.walls[0].baseRoom,'p2');
  assert.equal(out.exteriorWallSettings.walls.p1.color,'#123456');
  assert.equal(JSON.stringify(c.stageJsonImport(JSON.stringify(out)).data),JSON.stringify(out));
});
test('final validation rejects an ID collision introduced during staging without touching live work',()=>{
  const {c,calls}=setup(),before=snapshot(c);
  c.normalizeLegacyFurnitureItems=()=>{c.DATA.walls.push({...c.DATA.walls[0]});};
  assert.throws(()=>c.stageJsonImport(JSON.stringify(plan())),/重複/);
  assert.equal(snapshot(c),before);
  assert.ok(!calls.some(x=>/shared|queue|draw2d/.test(x)));
});

// The native JSON button protects dirty work; comparison adds no separate import UI.
test('declining valid JSON replacement keeps unsaved data, IDs and Undo/Redo',()=>{
 const {c,readers,alerts,calls}=setup();c.DIRTY=true;c.confirm=()=>false;const before=snapshot(c);
 c.doImport({files:['replacement'],value:'replacement.json'});
 readers[0].onload({target:{result:JSON.stringify(plan())}});
 assert.equal(snapshot(c),before);assert.equal(alerts.length,0);
 assert.ok(!calls.some(x=>/shared|queue|draw2d/.test(x)));
});

test('native JSON replacement preserves supplied height defaults and cancellation preserves live heights',()=>{
 const {c,readers}=setup();
 const expanded=require('./app-source.cjs').appSource();
 function actual(name){const start=expanded.indexOf('\nfunction '+name+'(')+1;const end=expanded.indexOf('\nfunction ',start+1);return expanded.slice(start,end);}
 c.DEFAULT_WALL_H_MM=2400;c.WALL_H_MIN=1800;c.WALL_H_MAX=4000;c.DEFAULT_FLOOR_RAISE_MM=120;
 vm.runInContext(actual('clampWallHeightMm')+'\n'+actual('resetHeightGlobalsForPlanLoad')+'\n'+actual('ensureHeightDefaults'),c);
 c.DATA.heightDefaults={wallHeight:2688};c.ensureHeightDefaults();c.DIRTY=true;c.confirm=()=>false;
 const replacement={...plan(),heightDefaults:{wallHeight:3120}};const before=snapshot(c);
 c.doImport({files:['height'],value:'height.json'});readers[0].onload({target:{result:JSON.stringify(replacement)}});
 assert.equal(snapshot(c),before);assert.equal(c.WALL_H,2688);
 c.confirm=()=>true;c.doImport({files:['height'],value:'height.json'});readers[1].onload({target:{result:JSON.stringify(replacement)}});
 assert.equal(c.WALL_H,3120);assert.equal(c.DATA.heightDefaults.wallHeight,3120);
});

test('pending JSON reads cannot cross installation, close, cancellation or a newer import',()=>{
 for(const reason of ['install','close','cancel','newer','during-confirm']){
  const {c,readers}=setup();c.DIRTY=true;const before=snapshot(c);c.confirm=()=>{if(reason==='during-confirm')vm.runInContext('++_jsonImportRequest',c);return true;};
  c.doImport({files:['old'],value:'old.json'});
  if(reason==='cancel')c.doImport({files:[]});
  else if(reason==='newer')c.doImport({files:['new'],value:'new.json'});
  else if(reason!=='during-confirm')vm.runInContext('++_jsonImportRequest',c);
  readers[0].onload({target:{result:JSON.stringify(plan())}});assert.equal(snapshot(c),before,reason);
  if(reason==='newer'){readers[1].onload({target:{result:JSON.stringify({...plan(),items:[]})}});assert.equal(c.DATA.items.length,0);}
 }
});
test('standard JSON reader routes source review separately and discards reads across newer review decisions',()=>{
 for(const stale of [false,true]){const {c,readers}=setup();let imported=0;c.PlanImport={state:{version:1,requestVersion:1,result:{original:true}}};c.SceneReviewFlow={isReviewData:()=>true,mount(){},importText(){imported++;}};const before=snapshot(c);c.doImport({files:[{name:'scene.json'}],value:'scene.json'});if(stale)c.PlanImport.state.requestVersion++;readers[0].onload({target:{result:'{"sceneVersion":3}'}});assert.equal(imported,stale?0:1);assert.equal(snapshot(c),before);}
});
