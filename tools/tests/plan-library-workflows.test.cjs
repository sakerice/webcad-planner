'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {libraryContext,fixture}=require('./plan-library-test-support.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<400;i++){if(check())return;await tick();}throw Error('condition did not settle');}
async function comparison(count=2){
 const h=libraryContext({native:false,search:'?planLibrary=1'});await h.api.ready;
 for(let i=1;i<=count;i++)await h.api.repo.save({planId:'p'+i,name:'Plan '+i,operationId:'seed-'+i,baseRevisionId:null,baseGeneration:0,payload:fixture(i*100)});
 const session='workflow-comparison-'+count;await h.api.repo.setView(session,{retainedPlanIds:Array.from({length:count},(_,i)=>'p'+(i+1)),panelPlanIds:Array.from({length:Math.min(count,2)},(_,i)=>'p'+(i+1)),sync:true});
 const restored=libraryContext({mem:h.mem,native:false,search:'?planLibrary=1&librarySession='+session});await restored.api.ready;return restored;
}
function ui(h,text){return h.document.querySelectorAll('button').find(b=>b.textContent===text);}
function status(h){return h.document.querySelector('[data-library-status]').textContent;}
function setView(p,zoom){p.frame.contentWindow.EditorPane.applyView({view:'2d',floor:1,twoD:{zoom,panX:zoom*10,panY:zoom*20}});}
async function dirty(p,x=900){await p.frame.contentWindow.EditorPane.install(fixture(x),{dirty:true,history:['undo-edit'],redo:['redo-edit'],view:p.frame.contentWindow.EditorPane.view()});}

test('selected pane identity follows successful switch; peer selection remains disabled',async()=>{
 const h=await comparison(3),p=[...h.api.panes.values()][0],other=[...h.api.panes.values()][1];
 await h.api.switchPlan(p.id,'p3');assert.equal(p.planId,'p3');assert.equal(p.frame.contentWindow.__editorPlanId,'p3');assert.equal(p.frame.title,'Plan 3の既存エディター');
 assert.match(p.remove.attrs['aria-label'],/Plan 3/);assert.equal(p.frame.contentWindow.document.querySelector('[data-library-current]').value,'p3');
 assert.equal(other.frame.contentWindow.document.querySelector('[data-library-current]').children.find(op=>op.value==='p3').disabled,true);
});

test('one-time alignment works while continuing sync is disabled; invalid sources do not take ownership',async()=>{
 const h=await comparison(),[a,b]=[...h.api.panes.values()],toggle=h.document.querySelector('[data-parallel-sync]');toggle.checked=false;toggle.onchange({target:toggle});
 setView(a,3);setView(b,8);h.api.changed(a.id);h.api.align();assert.deepEqual(plain(b.frame.contentWindow.EditorPane.view().twoD),plain(a.frame.contentWindow.EditorPane.view().twoD));assert.equal(toggle.checked,false);
 const active=h.api.activeId;assert.equal(h.api.changed('removed-pane'),false);assert.equal(h.api.activeId,active);clearTimeout(h.api.cameraTimer);
});

test('sync controls and camera changes cannot enter an in-flight layout transition; repeated actions reject',async()=>{
 const h=await comparison(),[a,b]=[...h.api.panes.values()],toggle=h.document.querySelector('[data-parallel-sync]');toggle.checked=false;toggle.onchange({target:toggle});await tick();
 setView(a,2);setView(b,7);h.api.changed(a.id);clearTimeout(h.api.cameraTimer);
 const original=h.api.repo.setView;let release,entered=false;h.api.repo.setView=async(...args)=>{entered=true;await new Promise(resolve=>release=resolve);return original(...args);};
 const pending=h.api.layout(1);await until(()=>entered);assert.equal(toggle.disabled,true);
 const before=plain(b.frame.contentWindow.EditorPane.view());assert.equal(h.api.changed(a.id),false);assert.deepEqual(plain(b.frame.contentWindow.EditorPane.view()),before);
 toggle.checked=true;assert.equal(toggle.onchange({target:toggle}),false);assert.equal(toggle.checked,false);assert.equal(await h.api.run(()=>h.api.newPlan()),false);assert.equal(h.document.querySelector('.library-dialog'),null);
 await assert.rejects(h.api.layout(1),/切替/);release();await pending;h.api.repo.setView=original;assert.equal(h.api.panes.size,1);assert.equal(toggle.disabled,false);
});

test('new plan with both panes full is saved explicitly without replacing dirty plans or reporting open failure',async()=>{
 const h=await comparison(),before=[...h.api.panes.values()];await dirty(before[0],987);h.api.edited(before[0].id);await tick();const original=before.map(p=>({id:p.id,planId:p.planId,window:p.frame.contentWindow,state:plain(p.frame.contentWindow.EditorPane.state())}));
 await h.api.newPlan();h.document.querySelector('.library-dialog').querySelector('input').value='Another plan';ui(h,'作成して開く').onclick();await until(()=>!h.document.querySelector('.library-dialog')&&/Another plan/.test(status(h)));
 const saved=(await h.api.repo.list()).find(r=>r.name==='Another plan');assert.ok(saved);assert.match(status(h),/共通一覧.*保存/);assert.match(status(h),/画面/);assert.equal(h.api.panes.size,2);assert.deepEqual(h.api.retained,['p1','p2']);
 for(const entry of original){const p=h.api.panes.get(entry.id);assert.equal(p.frame.contentWindow,entry.window);assert.equal(p.planId,entry.planId);assert.deepEqual(plain(p.frame.contentWindow.EditorPane.state()),entry.state);}
 await h.api.closePlan(before[1].id);await h.api.openPlan(saved.id);assert.equal(h.api.panes.size,2);assert.equal((await h.api.repo.read('p1')).payload.rooms[0].x,100);
});

test('Escape and replacing a dirty-choice dialog resolve cancellation; stale buttons cannot restart it',async()=>{
 const events=new Map(),h=libraryContext({beforeLibrary:context=>{context.document.addEventListener=(name,fn)=>events.set(name,event=>fn({stopImmediatePropagation(){},...event}));const create=context.document.createElement;context.document.createElement=tag=>{const element=create(tag);element.focus=()=>context.document.activeElement=element;const query=element.querySelectorAll.bind(element);element.querySelectorAll=selector=>selector.includes(',')?[...new Set(selector.split(',').flatMap(part=>query(part)))]:query(selector);element.contains=target=>{for(let node=target;node;node=node.parentNode)if(node===element)return true;return false;};return element;};}});await h.api.ready;await h.api.persistPane('native-editor',h.context.__editorPlanId,h.plan);h.context.clearDirty();
 await h.api.repo.save({planId:'next',name:'Next',operationId:'seed',baseRevisionId:null,baseGeneration:0,payload:fixture(600)});h.edit(fixture(333));await tick();const id=h.context.__editorPlanId;
 const pending=h.api.openPlan('next');await until(()=>h.document.querySelector('[data-library-decision="cancel"]'));const obsolete=h.document.querySelector('[data-library-decision="discard"]');assert.equal(h.document.activeElement.tagName,'SECTION');
 let tabPrevented=false;events.get('keydown')({key:'Tab',preventDefault(){tabPrevented=true;}});assert.equal(tabPrevented,true);assert.equal(h.document.activeElement.dataset.libraryDecision,'save');events.get('keydown')({key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(h.document.activeElement.dataset.libraryDecision,'cancel');let prevented=false;assert.equal(typeof events.get('keydown'),'function');events.get('keydown')({key:'Escape',preventDefault(){prevented=true;}});assert.equal(await pending,false);assert.equal(prevented,true);assert.equal(h.context.__editorPlanId,id);assert.equal(h.context.DIRTY,true);assert.equal(h.plan.rooms[0].x,333);assert.equal(obsolete.onclick(),false);
 const second=h.api.openPlan('next');await until(()=>h.document.querySelector('[data-library-decision="cancel"]'));await h.api.newPlan();assert.equal(await second,false);assert.equal(h.context.__editorPlanId,id);assert.equal(h.document.querySelector('.library-dialog').querySelector('h2').textContent,'新しいプラン');
});

test('edited persists one immutable snapshot and latest generation remains authoritative',async()=>{
 const h=await comparison(1),p=[...h.api.panes.values()][0],editor=p.frame.contentWindow.EditorPane,original=editor.state;let calls=0;editor.state=function(){calls++;return original.apply(this,arguments);};
 await dirty(p,222);calls=0;h.api.edited(p.id);assert.equal(calls,1);await dirty(p,333);h.api.edited(p.id);assert.equal(calls,2);
 assert.equal(h.api.plans.get(p.planId).generation,2);const draft=await h.api.repo.get('drafts',JSON.stringify([h.api.session,p.planId]));assert.equal(draft.generation,2);assert.equal(draft.payload.rooms[0].x,333);assert.equal(h.api.plans.get(p.planId).plan.rooms[0].x,333);
});

test('collapsed dirty working plan remains included in unsaved-close warning until released from working set',async()=>{
 const h=await comparison(),[a,b]=[...h.api.panes.values()];await dirty(b,654);h.api.edited(b.id);await tick();h.api.changed(a.id);clearTimeout(h.api.cameraTimer);await h.api.layout(1);assert.equal(h.api.panes.size,1);assert.equal(h.api.hasUnsaved(),true);
 await h.api.layout(2);const restored=[...h.api.panes.values()].find(p=>p.planId==='p2');assert.equal(restored.frame.contentWindow.DIRTY,true);assert.equal(restored.frame.contentWindow.EditorPane.snapshot().rooms[0].x,654);
 await h.api.closePlan(restored.id);assert.equal(h.api.hasUnsaved(),false);assert.equal((await h.api.repo.get('drafts',JSON.stringify([h.api.session,'p2']))).payload.rooms[0].x,654);
});

test('3D alignment preserves pane-owned mode/floor and does not cross walking camera boundaries',async()=>{
 const h=await comparison(),[a,b]=[...h.api.panes.values()];h.api.setSync(false);
 const external={view:'3d-ext',floor:1,twoD:{zoom:2,panX:10,panY:20},camera:{pos:[1,2,3],target:[4,5,6],fov:45,walk:null}},interior={view:'3d-int',floor:2,walkProfile:'retained-preference',twoD:{zoom:5,panX:50,panY:60},camera:{pos:[7,8,9],target:[10,11,12],fov:65,walk:null}};
 a.frame.contentWindow.EditorPane.applyView(external);b.frame.contentWindow.EditorPane.applyView(interior);h.api.changed(a.id);assert.equal(h.api.align(),true);
 const aligned=plain(b.frame.contentWindow.EditorPane.view());assert.equal(aligned.view,'3d-int');assert.equal(aligned.floor,2);assert.equal(aligned.walkProfile,'retained-preference');assert.deepEqual(aligned.camera,external.camera);
 const walking={...external,view:'3d-walk',camera:{...external.camera,walk:{x:10,z:20,yaw:1,pitch:.2}}};a.frame.contentWindow.EditorPane.applyView(walking);b.frame.contentWindow.EditorPane.applyView(interior);h.api.changed(a.id);h.api.align();assert.deepEqual(plain(b.frame.contentWindow.EditorPane.view().camera),interior.camera);
 b.installing=true;const before=plain(b.frame.contentWindow.EditorPane.view());setView(a,13);h.api.align();assert.deepEqual(plain(b.frame.contentWindow.EditorPane.view()),before);b.installing=false;
 assert.equal((await h.api.repo.history('p1')).length,1);assert.equal((await h.api.repo.history('p2')).length,1);clearTimeout(h.api.cameraTimer);
});

test('a full four-plan working set can still save a fifth inventory entry without mounting a third pane',async()=>{
 const h=await comparison(4);await h.api.layout(1);await h.api.newPlan();h.document.querySelector('.library-dialog').querySelector('input').value='Fifth';const result=await ui(h,'作成して開く').onclick();assert.equal(result.opened,false);
 assert.equal(h.api.panes.size,1);assert.equal(h.api.retained.length,4);assert.equal((await h.api.repo.list()).length,5);assert.match(status(h),/共通一覧.*保存/);assert.deepEqual(plain((await h.api.repo.get('views',h.api.session)).retainedPlanIds),['p1','p2','p3','p4']);
});

test('new plan uses the free second pane; a repeated Create click cannot create an extra inventory entry',async()=>{
 const h=await comparison(1),p=[...h.api.panes.values()][0];await dirty(p,789);h.api.edited(p.id);await tick();const before=plain(p.frame.contentWindow.EditorPane.state());
 await h.api.newPlan();h.document.querySelector('.library-dialog').querySelector('input').value='Second';const create=ui(h,'作成して開く'),pending=create.onclick();assert.equal(create.onclick(),false);const result=await pending;assert.equal(result.opened,true);assert.equal(h.api.panes.size,2);assert.equal((await h.api.repo.list()).length,2);assert.deepEqual(plain(p.frame.contentWindow.EditorPane.state()),before);assert.equal(p.frame.contentWindow.__editorPlanId,'p1');
});

test('failure after new-plan commit exposes saved recovery; creation quota failure does not claim success',async()=>{
 const h=await comparison(1),p=[...h.api.panes.values()][0],before=plain(p.frame.contentWindow.EditorPane.state()),open=h.api.openPlan;
 h.api.openPlan=async()=>{throw Error('synthetic pane startup failure');};await h.api.newPlan();h.document.querySelector('.library-dialog').querySelector('input').value='Recoverable';assert.equal(await ui(h,'作成して開く').onclick(),false);assert.match(status(h),/startup failure/);assert.match(status(h),/Recoverable.*共通一覧に保存済み/);assert.equal((await h.api.repo.list()).length,2);assert.deepEqual(plain(p.frame.contentWindow.EditorPane.state()),before);h.api.openPlan=open;
 await h.api.newPlan();h.document.querySelector('.library-dialog').querySelector('input').value='Quota failure';h.mem.failNext(new DOMException('Disk full','QuotaExceededError'),'webcad-plan-library-lab-ui-v1');assert.equal(await ui(h,'作成して開く').onclick(),false);assert.match(status(h),/空き容量/);assert.equal((await h.api.repo.list()).length,2);assert.equal(h.api.panes.size,1);assert.deepEqual(plain(p.frame.contentWindow.EditorPane.state()),before);
});

test('dirty Save-and-continue uses the original plan identity; save failure keeps scene and unlocks controls',async()=>{
 const h=libraryContext();await h.api.ready;const originalId=h.context.__editorPlanId;await h.api.persistPane('native-editor',originalId,h.plan);h.context.clearDirty();await h.api.repo.save({planId:'next',name:'Next',operationId:'seed',baseRevisionId:null,baseGeneration:0,payload:fixture(600)});
 h.context.savePlanToStorage=async()=>{h.context.setSaveButtonBusy(true);try{const result=await h.api.persistPane('native-editor',h.context.__editorPlanId,h.plan);if(result.canClean!==false)h.context.clearDirty();return true;}catch(error){return false;}finally{h.context.setSaveButtonBusy(false);}};
 h.edit(fixture(444));await tick();const pending=h.api.openPlan('next');await until(()=>h.document.querySelector('[data-library-decision="save"]'));h.document.querySelector('[data-library-decision="save"]').onclick();assert.equal(await pending,true);assert.equal(h.context.__editorPlanId,'next');assert.equal((await h.api.repo.read(originalId)).payload.rooms[0].x,444);assert.equal((await h.api.repo.read('next')).payload.rooms[0].x,600);
 h.edit(fixture(777));await tick();h.context.savePlanToStorage=async()=>false;const cancelled=h.api.switchPlan('native-editor',originalId);await until(()=>h.document.querySelector('[data-library-decision="save"]'));h.document.querySelector('[data-library-decision="save"]').onclick();assert.equal(await cancelled,false);assert.equal(h.context.__editorPlanId,'next');assert.equal(h.plan.rooms[0].x,777);assert.equal(h.context.DIRTY,true);assert.equal(h.document.querySelector('[data-library-current]').disabled,false);
});

test('single-snapshot edit draft failure leaves dirty scene, history and saved head intact',async()=>{
 const h=await comparison(1),p=[...h.api.panes.values()][0],head=plain(await h.api.repo.read('p1'));await dirty(p,987);const before=plain(p.frame.contentWindow.EditorPane.state());h.mem.failNext(new DOMException('Disk full','QuotaExceededError'),'webcad-plan-library-lab-ui-v1');h.api.edited(p.id);await until(()=>/空き容量/.test(status(h)));assert.deepEqual(plain(p.frame.contentWindow.EditorPane.state()),before);assert.deepEqual(plain(await h.api.repo.read('p1')),head);assert.equal(p.frame.contentWindow.DIRTY,true);
});
