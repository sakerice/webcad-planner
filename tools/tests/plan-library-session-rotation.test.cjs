'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {libraryContext,fixture,Storage}=require('./plan-library-test-support.cjs');
const plain=v=>JSON.parse(JSON.stringify(v)),tick=()=>new Promise(resolve=>setImmediate(resolve));
const key=(session,id)=>JSON.stringify([session,id]),DB='webcad-plan-library-lab-ui-v1';
async function retained(){
 const h=libraryContext();await h.api.ready;const source=h.context.__editorPlanId;
 await h.api.persistPane('native-editor',source,h.plan);h.context.clearDirty();const ids=[];
 for(let i=0;i<3;i++)ids.push(await h.api.createIndependentPlan({...fixture(900+i),anonymousExtension:{keep:['geometry',i]}},'Anonymous retained '+i,{sourcePaneId:'native-editor',sourcePlanId:source,sourceSnapshot:JSON.stringify(h.plan),isCurrent:()=>true,cataloguePack:'rpg-mansion',view:{view:'3d-walk',floor:i+1,twoD:{zoom:7+i,panX:8,panY:9},preferences:{showGrid:false,snap:455}}}));
 for(let i=0;i<ids.length;i++){const d=await h.api.repo.get('drafts',key(h.api.session,ids[i]));await h.api.repo.saveDraft(h.api.session,ids[i],{...d,history:['anonymous-undo-'+i],redo:['anonymous-redo-'+i],dirty:i!==1,anonymousDraftExtension:{keep:['metadata',i]}});}
 return {h,source,ids};
}
function intercept(h,fn){return libraryContext({mem:h.mem,sessionStorage:h.sessionStorage,beforeLibrary:context=>{const create=context.PlanRepositoryLab.create;context.PlanRepositoryLab.create=options=>{const repo=create(options),rotate=repo.rotateSession;repo.rotateSession=async request=>{await fn(repo,request);return rotate(request);};return repo;};}});}
async function snapshot(repo){return {views:plain(await repo.list('views')),drafts:plain(await repo.list('drafts')),heads:plain(await repo.list()),revisions:plain(await repo.list('revisions')),raw:plain(await repo.list('rawSources'))};}
test('three hidden drafts retain dirty/clean history, redo, pack, view and unknown fields across repeated native rotations',async()=>{
 const {h,source,ids}=await retained(),before=await snapshot(h.api.repo),expected=new Map(await Promise.all(ids.map(async id=>[id,await h.api.repo.get('drafts',key(h.api.session,id))])));let fresh=h;
 for(let turn=0;turn<3;turn++){
  const previous=fresh.api.session;fresh=libraryContext({mem:h.mem,sessionStorage:h.sessionStorage});await fresh.api.ready;
  assert.notEqual(fresh.api.session,previous);assert.equal(fresh.context.__editorPlanId,source);assert.equal(fresh.api.panes.size,1);assert.equal(fresh.api.retained.length,4);
  for(const id of ids){const d=await fresh.api.repo.get('drafts',key(fresh.api.session,id)),e=expected.get(id);assert.ok(d);for(const field of ['plan','payload','history','redo','view','dirty','cataloguePack','anonymousDraftExtension'])assert.deepEqual(plain(d[field]),plain(e[field]));assert.deepEqual(plain((await fresh.api.repo.get('views',fresh.api.session)).cameras[id]),plain(e.view));}
 }
 const after=await snapshot(h.api.repo);assert.deepEqual(after.heads,before.heads);assert.deepEqual(after.revisions,before.revisions);assert.deepEqual(after.raw,before.raw);
 for(const old of before.drafts)assert.deepEqual(plain(await h.api.repo.get('drafts',old.id)),old);assert.deepEqual(plain(await h.api.repo.get('views',h.api.session)),before.views[0]);
 // Session-only source/review mementos are deliberately not durable draft data.
 assert.equal((await fresh.api.repo.list('drafts')).some(d=>'importReview'in d||'importMemento'in d),false);
});
test('commit-time quota abort leaves no partial target and keeps old session, heads, drafts and view intact',async()=>{
 const {h,ids}=await retained(),before=await snapshot(h.api.repo),old=h.api.session;let target;
 const fresh=intercept(h,async(repo,request)=>{target=request.targetSessionId;h.mem.failNext(new DOMException('Anonymous full store','QuotaExceededError'),DB);});await fresh.api.ready;
 assert.equal(fresh.api.session,old);assert.equal(h.sessionStorage.getItem('webcad-plan-library-native-session'),old);assert.deepEqual(await snapshot(h.api.repo),before);assert.equal(await h.api.repo.get('views',target),undefined);for(const id of ids)assert.equal(await h.api.repo.get('drafts',key(target,id)),undefined);assert.equal(fresh.api.hasUnsaved(),true);
});
for(const race of ['view','hidden-draft','hidden-head'])test('rotation rejects concurrent '+race+' advancement before any target commit',async()=>{
 const {h,ids}=await retained(),old=h.api.session;let target,afterRace;
 const fresh=intercept(h,async(repo,request)=>{target=request.targetSessionId;if(race==='view')await repo.updateView(old,v=>({...v,sync:!v.sync}),request.sourceView.generation);else if(race==='hidden-draft'){const d=await repo.get('drafts',key(old,ids[2]));await repo.saveDraft(old,ids[2],{...d,generation:d.generation+1,plan:fixture(777),payload:fixture(777),dirty:true});}else{const saved=await repo.read(ids[2]);await repo.save({planId:ids[2],operationId:'anonymous-racing-save',payload:fixture(888),baseRevisionId:saved.revision.id,baseGeneration:saved.head.headGeneration});}afterRace=await snapshot(repo);});await fresh.api.ready;
 assert.equal(fresh.api.session,old);assert.equal(h.sessionStorage.getItem('webcad-plan-library-native-session'),old);assert.deepEqual(await snapshot(h.api.repo),afterRace);assert.equal(await h.api.repo.get('views',target),undefined);for(const id of ids)assert.equal(await h.api.repo.get('drafts',key(target,id)),undefined);
});
test('a preexisting target UUID/view or draft is never overwritten',async()=>{
 for(const collision of ['view','draft']){const {h,source}=await retained(),old=h.api.session;let afterSeed;
 const fresh=intercept(h,async(repo,request)=>{if(collision==='view')await repo.setView(request.targetSessionId,{retainedPlanIds:[source],panelPlanIds:[source],sync:false});else{const d=request.drafts[0].state;await repo.saveDraft(request.targetSessionId,source,{...d,generation:d.generation+1});}afterSeed=await snapshot(repo);});await fresh.api.ready;assert.equal(fresh.api.session,old);assert.deepEqual(await snapshot(h.api.repo),afterSeed);}
});
test('invalid, duplicate and missing retained IDs fail closed without rotating or silently dropping an ID',async()=>{
 for(const fault of ['missing','duplicate','foreign-visible','non-string']){const {h,source}=await retained(),old=h.api.session,views=h.mem.dbs.get(DB).stores.get('views'),v=views.get(old);if(fault==='missing')v.retainedPlanIds[3]='missing-anonymous-plan';if(fault==='duplicate')v.retainedPlanIds=[source,source];if(fault==='foreign-visible')v.panelPlanIds=['foreign-anonymous-plan'];if(fault==='non-string')v.retainedPlanIds=[source,null];const before=await snapshot(h.api.repo),fresh=libraryContext({mem:h.mem,sessionStorage:h.sessionStorage});await fresh.api.ready;assert.equal(fresh.api.session,old);assert.deepEqual(await snapshot(h.api.repo),before);assert.equal(h.sessionStorage.getItem('webcad-plan-library-native-session'),old);}
});
test('sessionStorage adoption failure leaves the old session as the reload/recovery target',async()=>{
 const {h}=await retained(),old=h.api.session,storage=new Storage();storage.map=new Map(h.sessionStorage.map);storage.setItem=()=>{throw new DOMException('Anonymous denied session store','QuotaExceededError');};const before=await h.api.repo.get('views',old),drafts=(await h.api.repo.list('drafts')).filter(d=>d.sessionId===old);const fresh=libraryContext({mem:h.mem,sessionStorage:storage});await fresh.api.ready;assert.equal(fresh.api.session,old);assert.equal(storage.getItem('webcad-plan-library-native-session'),old);assert.deepEqual(plain(await h.api.repo.get('views',old)),plain(before));for(const d of drafts)assert.deepEqual(plain(await h.api.repo.get('drafts',d.id)),plain(d));
});
test('a clean stale hidden draft never restores its superseded geometry while its draft extension and view remain recoverable',async()=>{
 const {h,ids}=await retained(),id=ids[1],oldDraft=await h.api.repo.get('drafts',key(h.api.session,id)),saved=await h.api.repo.read(id);await h.api.repo.save({planId:id,operationId:'anonymous-newer-head',payload:fixture(12345),baseRevisionId:saved.revision.id,baseGeneration:saved.head.headGeneration});const fresh=libraryContext({mem:h.mem,sessionStorage:h.sessionStorage});await fresh.api.ready;const d=await h.api.repo.get('drafts',key(fresh.api.session,id));assert.equal(d.plan.rooms[0].x,12345);assert.equal(d.dirty,false);assert.deepEqual(plain(d.anonymousDraftExtension),plain(oldDraft.anonymousDraftExtension));assert.deepEqual(plain(d.view),plain(oldDraft.view));assert.deepEqual(plain(await h.api.repo.get('drafts',oldDraft.id)),plain(oldDraft));
});

test('rotation rejects a target UUID equal to its source session without rewriting any record',async()=>{
 const {h}=await retained(),old=h.api.session,before=await snapshot(h.api.repo);const fresh=intercept(h,async(repo,request)=>{request.targetSessionId=request.sourceSessionId;});await fresh.api.ready;assert.equal(fresh.api.session,old);assert.deepEqual(await snapshot(h.api.repo),before);
});
