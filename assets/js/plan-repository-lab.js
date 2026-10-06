/* Isolated persistence experiment. No app bootstrap and no legacy writes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./plan-schema.js'),require('./legacy-plan-compatibility.js'),require('./legacy-plan-copy-dryrun.js'),require('./legacy-plan-lineage.js'));else root.PlanRepositoryLab=factory(root.PlanSchema,root.LegacyPlanCompatibility,root.LegacyPlanCopyDryRun,root.LegacyPlanLineage);})(typeof self!=='undefined'?self:this,function(schema,compatibility,dryRun,lineageModule){
 'use strict';
 const clone=v=>structuredClone(v),text=v=>JSON.stringify(v,(k,x)=>k==='_texObj'?undefined:x);
 function snapshotJSON(value,stack=[]){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object')throw Error('non_json_save_request');
  const proto=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&proto!==null&&Object.getPrototypeOf(proto)!==null)throw Error('non_json_save_request');
  if(stack.includes(value))throw Error('non_json_save_request');
  if(Object.getOwnPropertySymbols(value).length)throw Error('non_json_save_request');
  const out=Array.isArray(value)?[]:{},names=Object.getOwnPropertyNames(value);
  if(Array.isArray(value)&&(Object.keys(value).length!==value.length||Object.keys(value).some((key,index)=>key!==String(index))))throw Error('non_json_save_request');
  for(const key of names){
   if(Array.isArray(value)&&key==='length')continue;
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor.enumerable||!Object.prototype.hasOwnProperty.call(descriptor,'value'))throw Error('non_json_save_request');
   if(key==='_texObj'||descriptor.value===undefined&&!Array.isArray(value))continue;
   Object.defineProperty(out,key,{value:snapshotJSON(descriptor.value,stack.concat([value])),enumerable:true,writable:false,configurable:false});
  }
  return Object.freeze(out);
 }
 function create(options={}){
  const idb=options.indexedDB||globalThis.indexedDB,crypto=options.crypto||globalThis.crypto,name=options.name||'webcad-plan-library-lab-v1';
  if(!/^webcad-plan-library-lab-/.test(name))throw Error('isolated_store_required');
  function keyToken(key){if(typeof key==='string')return key;if(key instanceof Date)return 'date:'+key.toISOString();if(key instanceof ArrayBuffer||ArrayBuffer.isView(key)){const bytes=key instanceof ArrayBuffer?new Uint8Array(key):new Uint8Array(key.buffer,key.byteOffset,key.byteLength);return 'binary:'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}if(Array.isArray(key))return 'array:'+JSON.stringify(key.map(keyToken));return typeof key+':'+String(key);}
  const stores=['plans','revisions','drafts','rawSources','migrations','views'];let opening;
  async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
  function open(){if(!opening)opening=new Promise((resolve,reject)=>{const r=idb.open(name,1);r.onupgradeneeded=()=>stores.forEach(s=>r.result.createObjectStore(s,{keyPath:'id'}));r.onerror=()=>{opening=null;reject(r.error);};r.onblocked=()=>reject(Error('store_blocked'));r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};});return opening;}
  async function transaction(names,mode,work){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(names,mode);let result,error;tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(error||tx.error||Error('transaction_aborted'));try{work(tx,v=>result=v,e=>{error=e;tx.abort();});}catch(e){error=e;tx.abort();}});}
  async function get(store,id){return transaction([store],'readonly',(t,set)=>{const r=t.objectStore(store).get(id);r.onsuccess=()=>set(r.result);});}
  async function list(store='plans'){return transaction([store],'readonly',(t,set)=>{const r=t.objectStore(store).getAll();r.onsuccess=()=>set(store==='plans'?r.result.filter(p=>p.verified!==false):r.result);});}
  async function history(planId){return transaction(['revisions'],'readonly',(t,set)=>{const rows=[],range=IDBKeyRange.bound(planId+':',planId+':\uffff'),r=t.objectStore('revisions').openCursor(range);r.onsuccess=()=>{const cursor=r.result;if(!cursor){set(rows);return;}const {payload,...metadata}=cursor.value;if(metadata.planId===planId)rows.push(metadata);cursor.continue();};});}
  async function draftSummaries(){return transaction(['drafts'],'readonly',(t,set)=>{const rows=[],r=t.objectStore('drafts').openCursor();r.onsuccess=()=>{const cursor=r.result;if(!cursor){set(rows);return;}const d=cursor.value;if(d.dirty)rows.push({id:d.id,planId:d.planId,sessionId:d.sessionId,generation:d.generation,updatedAt:d.updatedAt});cursor.continue();};});}
  function draftId(sessionId,planId){return JSON.stringify([sessionId,planId]);}
  function draftRecord(sessionId,planId,state){return {...clone(state),id:draftId(sessionId,planId),sessionId,planId};}
  function staleDraft(record,previous){return previous&&(record.generation<previous.generation||record.baseGeneration<previous.baseGeneration||record.baseGeneration===previous.baseGeneration&&record.baseRevisionId!==previous.baseRevisionId||record.generation===previous.generation&&(text(record.payload??record.plan)!==text(previous.payload??previous.plan)));}
  async function saveDraft(sessionId,planId,state){const record=draftRecord(sessionId,planId,state);return transaction(['drafts'],'readwrite',(t,set)=>{const store=t.objectStore('drafts'),r=store.get(record.id);r.onsuccess=()=>{const previous=r.result;if(staleDraft(record,previous)){const conflict={...record,id:record.id+':conflict:'+crypto.randomUUID(),conflictOf:record.id,dirty:true};store.add(conflict);set({...conflict,status:'conflict'});}else{store.put(record);set({...record,status:'saved'});}};});}
  // A lifecycle rotation copies at most four retained drafts. The old session,
  // heads and legacy sources remain untouched; the target view is the commit.
  async function rotateSession(request){
   const {sourceSessionId,targetSessionId}=request,sourceView=clone(request.sourceView),view=clone(request.view),entries=clone(request.drafts);
   validateView(sourceView);validateView(view);
   if(typeof sourceSessionId!=='string'||!sourceSessionId||typeof targetSessionId!=='string'||!targetSessionId||sourceSessionId===targetSessionId||sourceView.id!==sourceSessionId||!Array.isArray(entries)||entries.length!==view.retainedPlanIds.length||JSON.stringify(sourceView.retainedPlanIds)!==JSON.stringify(view.retainedPlanIds)||entries.some((entry,i)=>typeof entry.planId!=='string'||!entry.planId||entry.planId!==view.retainedPlanIds[i]||!entry.head||entry.head.id!==entry.planId||entry.sourceDraft&&(entry.sourceDraft.id!==draftId(sourceSessionId,entry.planId)||entry.sourceDraft.sessionId!==sourceSessionId||entry.sourceDraft.planId!==entry.planId)))throw Error('session_rotation_invalid');
   if(entries.some(({head,state})=>!state||!Array.isArray(state.plan?.walls)||!Array.isArray(state.plan?.rooms)||!Array.isArray(state.plan?.items)||text(state.plan)!==text(state.payload)||!Number.isSafeInteger(state.generation)||state.generation<0||!Number.isSafeInteger(state.baseGeneration)||state.baseGeneration<1||typeof state.baseRevisionId!=='string'||!state.baseRevisionId||!Number.isSafeInteger(head.headGeneration)||head.headGeneration<1||typeof head.headRevisionId!=='string'||!head.headRevisionId))throw Error('session_rotation_invalid');
   const prepared=entries.map(entry=>({...entry,record:draftRecord(targetSessionId,entry.planId,entry.state)}));
   return transaction(['views','drafts','plans'],'readwrite',(t,set,abort)=>{
    const vs=t.objectStore('views'),ds=t.objectStore('drafts'),ps=t.objectStore('plans'),source=vs.get(sourceSessionId),target=vs.get(targetSessionId);
    const reads=prepared.map(entry=>({...entry,source:ds.get(draftId(sourceSessionId,entry.planId)),target:ds.get(entry.record.id),current:ps.get(entry.planId)}));
    const requests=[source,target,...reads.flatMap(entry=>[entry.source,entry.target,entry.current])];let remaining=requests.length;
    for(const r of requests)r.onsuccess=()=>{if(--remaining)return;try{
     if(JSON.stringify(source.result)!==JSON.stringify(sourceView))throw Error('view_generation_conflict');
     if(target.result)throw Error('session_target_exists');
     for(const entry of reads){
      if(JSON.stringify(entry.current.result)!==JSON.stringify(entry.head))throw Error('plan_generation_conflict');
      if(JSON.stringify(entry.source.result)!==JSON.stringify(entry.sourceDraft))throw Error('draft_generation_conflict');
      if(staleDraft(entry.record,entry.target.result))throw Error('draft_generation_conflict');
      if(entry.target.result)throw Error('session_target_exists');
     }
     const committed={...view,id:targetSessionId,generation:1};
     for(const entry of reads)ds.add(entry.record);
     vs.add(committed);set({status:'saved',view:committed});
    }catch(error){abort(error);}};
   });
  }
  async function save(request,authorization,commitOptions={}){
   request=snapshotJSON(request);
   if(!schema||typeof schema.validatePlan!=='function')throw Error('plan_schema_unavailable');
   const checkCurrent=()=>{if(commitOptions.isCurrent&&!commitOptions.isCurrent())throw Error('legacy_conversion_review_stale');};checkCurrent();
   const registration=lineage?.registration(authorization),sourceGuard=lineage?.sourceGuard(authorization),before=await get('plans',request.planId);
   if(request.origin?.legacyCopy&&!registration)throw Error('untrusted_legacy_copy_origin');
   if(before?.origin?.legacyCopy)await lineage.admission(request.planId,request.payload);
   else if(!registration&&schema&&!schema.validatePlan(request.payload).ok)throw Error('new_plan_validation_failed');
   if(registration&&(registration.planId!==request.planId||registration.initialRevisionId!==request.planId+':'+request.operationId||registration.initialPayloadDigest!==await digest(text(request.payload))))throw Error('legacy_copy_registration_mismatch');
   if(!request.planId||!request.operationId)throw Error('stable_plan_and_operation_required');
   const payload=text(request.payload),payloadDigest=await digest(payload),revisionId=request.planId+':'+request.operationId;checkCurrent();
   const result=await transaction(['plans','revisions','drafts','migrations',...(sourceGuard?['rawSources']:[])],'readwrite',(t,set,abort)=>{
    const ps=t.objectStore('plans'),rs=t.objectStore('revisions'),ds=t.objectStore('drafts'),pr=ps.get(request.planId),rr=rs.get(revisionId),dr=request.sessionId?ds.get(draftId(request.sessionId,request.planId)):null;
    const sr=sourceGuard?ds.get(sourceGuard.sourceSnapshot.draftId):null,sp=sourceGuard?rs.get(sourceGuard.parentRevisionId):null,sa=sourceGuard?t.objectStore('rawSources').get(sourceGuard.sourceSnapshot.id):null,requests=[pr,rr,dr,sr,sp,sa].filter(Boolean);let n=requests.length;
    for(const r of requests)r.onsuccess=()=>{if(--n)return;try{checkCurrent();const head=pr.result,existing=rr.result,draft=dr?.result;
     // No async digest inside the transaction: compare the exact admitted bytes
     // whose digest was proved before entry, plus every persisted source owner.
     // This guard is private to the issued registration, never caller options.
     if(sourceGuard){const source=sr.result,parent=sp.result,archive=sa.result,owner=archive?.sourceOwner,expected=sourceGuard.sourceOwner,snapshot=sourceGuard.sourceSnapshot;
      if(!source||source.id!==snapshot.draftId||source.planId!==sourceGuard.parentPlanId||source.baseRevisionId!==sourceGuard.parentRevisionId||source.generation!==snapshot.generation||source.baseGeneration!==snapshot.baseGeneration||JSON.stringify(snapshotJSON(source.payload||source.plan))!==sourceGuard.raw||!parent||parent.id!==sourceGuard.parentRevisionId||parent.planId!==sourceGuard.parentPlanId||parent.codecVersion!==1||parent.payload!==sourceGuard.parentRevisionPayload||parent.payloadDigest!==sourceGuard.parentRevisionDigest||!archive||archive.id!==snapshot.id||archive.sourceId!==sourceGuard.sourceId||archive.codecVersion!==2||archive.sourceKind!=='plan'||archive.verified!==true||archive.raw!==sourceGuard.raw||archive.rawDigest!==snapshot.digest||archive.rawStructured!==null||archive.sourceKey!==null||!owner||owner.planId!==expected.planId||owner.parentRevisionId!==expected.parentRevisionId||owner.draftId!==expected.draftId||owner.generation!==expected.generation||owner.baseGeneration!==expected.baseGeneration)throw Error('legacy_copy_validation_failed: stale_derivation_source');
     }
     if(existing){if(existing.payloadDigest!==payloadDigest)return abort(Error('operation_reused_with_different_payload'));set({status:existing.kind==='conflict'?'conflict':head?.headRevisionId===existing.id?'saved':'superseded',revisionId:existing.id,head,canClean:existing.kind!=='conflict'&&head?.headRevisionId===existing.id&&(!draft||draft.generation===request.draftGeneration&&text(draft.payload??draft.plan)===payload)});return;}
     const matches=head?head.headRevisionId===request.baseRevisionId&&head.headGeneration===request.baseGeneration:request.baseRevisionId==null&&request.baseGeneration===0;
     const revision={id:revisionId,planId:request.planId,parentRevisionId:request.baseRevisionId||null,payload,payloadDigest,codecVersion:1,operationId:request.operationId,kind:matches?(request.kind||'save'):'conflict',restoredFrom:request.restoredFrom||null};rs.add(revision);
     if(!matches){if(draft)ds.put({...draft,dirty:true,lastConflictRevisionId:revisionId});set({status:'conflict',revisionId,head,canClean:false});return;}
     if(registration)t.objectStore('migrations').add(registration);
     const updated={...(head||{id:request.planId,name:request.name||'プラン',origin:request.origin||null}),headRevisionId:revisionId,headGeneration:(head?.headGeneration||0)+1};ps.put(updated);
     const canClean=!draft||draft.generation===request.draftGeneration&&text(draft.payload??draft.plan)===payload;if(draft)ds.put({...draft,dirty:canClean?false:draft.dirty,baseRevisionId:revisionId,baseGeneration:updated.headGeneration});set({status:'saved',revisionId,head:updated,canClean});
    }catch(e){abort(e);}};
   });
   const stored=await get('revisions',result.revisionId);if(!stored||stored.payload!==payload||stored.payloadDigest!==payloadDigest||await digest(stored.payload)!==payloadDigest)throw Error('committed_content_verification_failed');
   options.notify?.({planId:request.planId,headRevisionId:result.head?.headRevisionId,status:result.status});return result;
  }
  async function readUnchecked(planId,revisionId,allowUnverified=false){const head=await get('plans',planId);if(!head||head.verified===false&&!allowUnverified)return null;const revision=await get('revisions',revisionId||head.headRevisionId);if(revision&&revision.codecVersion!==1)throw Error('unsupported_revision_codec');if(!revision||revision.planId!==planId||await digest(revision.payload)!==revision.payloadDigest)throw Error('revision_integrity_failed');return {head,revision,payload:JSON.parse(revision.payload)};}
  async function read(planId,revisionId,allowUnverified=false){const result=await readUnchecked(planId,revisionId,allowUnverified);if(result?.head.origin?.legacyCopy){if(!lineage)throw Error('legacy_copy_support_unavailable');await lineage.admission(planId,result.payload);}return result;}
  async function duplicate(planId,newPlanId,newName,operationId){const current=await read(planId);if(!current)throw Error('plan_missing');return derive({planId:newPlanId,name:newName,operationId,baseRevisionId:null,baseGeneration:0,payload:current.payload,kind:'duplicate',origin:{copiedFromPlanId:planId,copiedFromRevisionId:current.revision.id}},planId,current.revision.id);}
  async function restore(planId,revisionId,baseRevisionId,baseGeneration,operationId,commitOptions){const past=await read(planId,revisionId);return save({planId,payload:past.payload,baseRevisionId,baseGeneration,operationId,kind:'restore',restoredFrom:revisionId},undefined,commitOptions);}
  async function sourceCodec(value){
   const blobHashes=new Map();async function collectBlobs(value,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);if(typeof Blob!=='undefined'&&value instanceof Blob){blobHashes.set(value,await digest(JSON.stringify(Array.from(new Uint8Array(await value.arrayBuffer())))));return;}const children=value instanceof Map?[...value].flat():value instanceof Set?[...value]:Object.values(value);for(const child of children)await collectBlobs(child,seen);}await collectBlobs(value);
   function encode(value,seen=new Map()){if(value===null)return ['null'];if(typeof value!=='object')return [typeof value,typeof value==='number'&&(!Number.isFinite(value)||Object.is(value,-0))?(Object.is(value,-0)?'-0':String(value)):typeof value==='bigint'?String(value):value];if(seen.has(value))return ['reference',seen.get(value)];seen.set(value,seen.size);if(typeof Blob!=='undefined'&&value instanceof Blob)return ['blob',value.type,value.size,value.name||null,value.lastModified||null,blobHashes.get(value)];if(value instanceof Date)return ['date',Number.isFinite(value.getTime())?value.toISOString():'invalid'];if(value instanceof RegExp)return ['regexp',value.source,value.flags,value.lastIndex];if(value instanceof Error)return ['error',value.name,value.message,value.stack];if(ArrayBuffer.isView(value))return [value.constructor.name,Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))];if(value instanceof ArrayBuffer)return ['ArrayBuffer',Array.from(new Uint8Array(value))];if(value instanceof Map)return ['Map',[...value].map(([k,v])=>[encode(k,seen),encode(v,seen)])];if(value instanceof Set)return ['Set',[...value].map(v=>encode(v,seen))];const entries=Object.keys(value).sort().map(k=>[k,encode(value[k],seen)]);return Array.isArray(value)?['array',value.length,entries]:['object',entries];}
   return {encode,collectBlobs};
  }
  async function verifyRawSource(raw){
   if(!raw?.verified||raw.codecVersion!==2||typeof raw.raw!=='string'||typeof raw.sourceId!=='string'||await digest(raw.raw)!==raw.rawDigest)throw Error('raw_source_verification_failed');
   const structured=raw.rawStructured!==null;
   const codec=await sourceCodec(structured?raw.rawStructured:raw.sourceKey);
   if(structured&&JSON.stringify(codec.encode(raw.rawStructured))!==raw.raw)throw Error('raw_source_verification_failed');
   const withoutKey=raw.sourceId+(structured?':codec2:':':')+raw.rawDigest;
   const withKey=raw.sourceId+':codec2:'+raw.rawDigest+':'+await digest(JSON.stringify(codec.encode(raw.sourceKey)));
   if(raw.id!==withoutKey&&raw.id!==withKey)throw Error('raw_source_verification_failed');
   return structured?raw.rawStructured:JSON.parse(raw.raw);
  }
  async function importSource(source){
   // JSON plans are a subset of structured legacy values. Keep the original before projecting anything.
   const {encode,collectBlobs}=await sourceCodec(source.raw);
   function jsonCompatible(value,seen=new Set()){if(value===null)return true;if(typeof value==='number')return Number.isFinite(value)&&!Object.is(value,-0);if(typeof value==='string'||typeof value==='boolean')return true;if(typeof value!=='object'||seen.has(value)||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))return false;seen.add(value);const ok=Object.values(value).every(v=>jsonCompatible(v,seen));seen.delete(value);return ok;}
   const structured=typeof source.raw!=='string',raw=structured?JSON.stringify(encode(source.raw)):source.raw,rawDigest=await digest(raw),snapshotId=source.sourceId+(structured||source.sourceKey!==undefined?':codec2:':':')+rawDigest+(source.sourceKey===undefined?'':':'+await digest(JSON.stringify(encode(source.sourceKey))));
   let parsed,entries=[],diagnostic=null,entryDiagnostics=[];try{parsed=structured?source.raw:JSON.parse(raw);if(source.kind==='plan')entries=[{key:'plan',name:source.name||'旧保存プラン',plan:parsed}];else if(source.kind==='workspace')entries=Array.from(Array.isArray(parsed)?parsed:parsed.plans||[],(r,i)=>{if(!r||typeof r!=='object'||Array.isArray(r)){entryDiagnostics.push({key:String(i),error:'unsupported_workspace_entry'});return null;}return {key:String(r.id??i),name:r.name||'回収プラン',plan:r.plan,state:r.state,explicitlySaved:r.explicitlySaved};}).filter(Boolean);else throw Error('unsupported_source_kind');entries=entries.filter(e=>{const valid=e.plan&&Array.isArray(e.plan.walls)&&Array.isArray(e.plan.rooms)&&Array.isArray(e.plan.items)&&jsonCompatible(e.plan);if(!valid)entryDiagnostics.push({key:e.key,error:'unsupported_plan_payload'});return valid;});if(entryDiagnostics.length)diagnostic='some_entries_archived_without_projection';}catch(e){diagnostic=e.message;entries=[];}
   const prepared=await Promise.all(entries.map(async e=>{const id=await digest(snapshotId+'\0'+e.key),payload=JSON.stringify(e.plan);return {...e,planId:'legacy-'+id,mappingId:snapshotId+':'+e.key,payload,payloadDigest:await digest(payload)};}));
   const result=await transaction(['plans','revisions','drafts','rawSources','migrations'],'readwrite',(t,set)=>{
    const rawStore=t.objectStore('rawSources'),rawRequest=rawStore.get(snapshotId);rawRequest.onsuccess=()=>{if(!rawRequest.result)rawStore.add({codecVersion:2,id:snapshotId,sourceId:source.sourceId,raw,rawDigest,sourceKind:source.kind,diagnostic,entryDiagnostics,rawStructured:structured?clone(source.raw):null,sourceKey:source.sourceKey===undefined?null:clone(source.sourceKey),verified:false});};const output=[];if(!prepared.length){set({snapshotId,diagnostic,entryDiagnostics,plans:[]});return;}let remaining=prepared.length;
    for(const e of prepared){const ms=t.objectStore('migrations'),r=ms.get(e.mappingId);r.onsuccess=()=>{if(r.result)output.push(r.result);else{const revisionId=e.planId+':import',mapping={id:e.mappingId,snapshotId,sourceEntryKey:e.key,planId:e.planId,importRevisionId:revisionId};
      t.objectStore('revisions').add({id:revisionId,planId:e.planId,parentRevisionId:null,payload:e.payload,payloadDigest:e.payloadDigest,codecVersion:1,operationId:'import',kind:'legacy-copy'});
      t.objectStore('plans').add({id:e.planId,name:e.name,headRevisionId:revisionId,headGeneration:1,origin:{snapshotId,sourceEntryKey:e.key},verified:false,recoveredUnsaved:e.explicitlySaved===false||!!e.state?.dirty});ms.add(mapping);output.push(mapping);
      if(e.state)t.objectStore('drafts').put({...clone(e.state),id:draftId('recovery:'+snapshotId,e.planId),sessionId:'recovery:'+snapshotId,planId:e.planId,baseRevisionId:revisionId,baseGeneration:1,generation:0});
     }if(!--remaining)set({snapshotId,diagnostic,entryDiagnostics,plans:output});};}
   });
   const stored=await get('rawSources',snapshotId);await collectBlobs(stored.rawStructured);if(stored.raw!==raw||await digest(stored.raw)!==rawDigest||(structured&&JSON.stringify(encode(stored.rawStructured))!==raw)||(source.sourceKey!==undefined&&JSON.stringify(encode(stored.sourceKey))!==JSON.stringify(encode(source.sourceKey))))throw Error('raw_source_verification_failed');for(const m of result.plans)await read(m.planId,m.importRevisionId,true);await transaction(['rawSources','plans'],'readwrite',(t)=>{t.objectStore('rawSources').put({...stored,verified:true});for(const m of result.plans){const r=t.objectStore('plans').get(m.planId);r.onsuccess=()=>{if(r.result)t.objectStore('plans').put({...r.result,verified:true});};}});return result;
  }
  const lineage=schema&&compatibility&&dryRun&&lineageModule?lineageModule.create({schema,compatibility,dryRun,get,readUnchecked,digest,save,snapshotJSON,verifyRawSource,transaction}):null;
  async function derive(request,parentPlanId,parentRevisionId,sourceTicket,commitOptions){return lineage?lineage.derive(request,parentPlanId,parentRevisionId,sourceTicket,commitOptions):save(request,undefined,commitOptions);}
  async function prepareDerivationSource(planId,revisionId,draftId,generation){return lineage?lineage.prepareDerivationSource(planId,revisionId,draftId,generation):null;}
  async function admission(planId,payload){return lineage?lineage.admission(planId,payload):null;}
  function validateAdmission(payload,cap){if(!lineage){if(cap)throw Error('legacy_copy_support_unavailable');return schema.validatePlan(payload);}return lineage.validate(payload,cap);}
  async function prepareLegacyCopy(planId){if(!lineage)throw Error('legacy_copy_support_unavailable');return lineage.prepare(planId);}
  async function createLegacyCopy(review,planId,name,operationId,commitOptions){if(!lineage)throw Error('legacy_copy_support_unavailable');return lineage.commit(review,planId,name,operationId,commitOptions);}
  function validateView(state){if(!Array.isArray(state.retainedPlanIds)||state.retainedPlanIds.length>4||new Set(state.retainedPlanIds).size!==state.retainedPlanIds.length||!Array.isArray(state.panelPlanIds)||state.panelPlanIds.length>2||new Set(state.panelPlanIds).size!==state.panelPlanIds.length||state.panelPlanIds.some(id=>!state.retainedPlanIds.includes(id)))throw Error('four_retained_two_visible_required');}
  async function updateView(sessionId,change,expectedGeneration){return transaction(['views'],'readwrite',(t,set,abort)=>{const store=t.objectStore('views'),r=store.get(sessionId);r.onsuccess=()=>{try{const previous=r.result||{id:sessionId,generation:0,retainedPlanIds:[],panelPlanIds:[]};if(expectedGeneration!==undefined&&expectedGeneration!==previous.generation)return abort(Error('view_generation_conflict'));const state=change(clone(previous));validateView(state);const record={...state,id:sessionId,generation:previous.generation+1};store.put(record);set(record);}catch(e){abort(e);}};});}
  async function setView(sessionId,state,expectedGeneration){validateView(state);return updateView(sessionId,()=>clone(state),expectedGeneration);}
  async function detach(sessionId,planId){return updateView(sessionId,view=>({...view,panelPlanIds:view.panelPlanIds.filter(id=>id!==planId),retainedPlanIds:view.retainedPlanIds.filter(id=>id!==planId)}));}
  async function readLegacySources(storage=globalThis.localStorage){
   const sources=[];const legacy=storage.getItem('webcad-plan-v1');if(legacy!==null)sources.push({sourceId:'localStorage:webcad-plan-v1',kind:'plan',name:'旧ローカル保存',raw:legacy});
   for(const spec of [{db:'webcad',store:'plans',kind:'plan',key:'webcad-plan-v1'},{db:'webcad-comparison-v1',store:'workspace',kind:'workspace',key:'state'},{db:'webcad-parallel-workspace',store:'workspaces',kind:'workspace',key:'local'},{db:'webcad-parallel-plans',store:'plans',kind:'plan'}]){
    const db=await new Promise((resolve,reject)=>{const r=idb.open(spec.db);r.onupgradeneeded=()=>r.transaction.abort();r.onerror=()=>r.error?.name==='AbortError'?resolve(null):reject(r.error);r.onsuccess=()=>resolve(r.result);});if(!db)continue;
    try{if(!db.objectStoreNames.contains(spec.store))continue;await new Promise((resolve,reject)=>{const tx=db.transaction(spec.store,'readonly'),store=tx.objectStore(spec.store),r=spec.key?store.openCursor(IDBKeyRange.only(spec.key)):store.openCursor();r.onsuccess=()=>{const cursor=r.result;if(!cursor)return;sources.push({sourceId:spec.db+'/'+spec.store+'/'+keyToken(cursor.key),kind:spec.kind,name:'旧保存 '+String(cursor.key),sourceKey:clone(cursor.key),raw:clone(cursor.value)});cursor.continue();};tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{db.close();}
   }return sources;
  }
  return {save,read,list,get,history,admission,validateAdmission,isAdmission:cap=>!!lineage?.isAdmission(cap),derive,prepareDerivationSource,prepareLegacyCopy,createLegacyCopy,draftSummaries,saveDraft,rotateSession,duplicate,restore,importSource,setView,updateView,detach,readLegacySources,digest,close:async()=>{(await open()).close();opening=null;}};
 }
 return {create};
});
