/* Verified raw-source lineage in the existing repository; no new database. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LegacyPlanLineage=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 function create({schema,compatibility,dryRun,get,readUnchecked,digest,save,snapshotJSON,verifyRawSource,transaction}){
  const authority=compatibility.createAuthority(schema),convert=dryRun.createDryRunHelper(schema),tickets=new WeakMap(),sourceTickets=new WeakMap(),registrations=new WeakMap(),sourceGuards=new WeakMap(),canonical=compatibility.canonical;
  const equal=(a,b)=>canonical(a)===canonical(b),contractId=id=>'legacy-copy-contract:'+id;
  function fail(){throw Error('legacy_copy_lineage_verification_failed');}
  const identity=value=>typeof value==='string'&&value.length>0,generationValue=value=>Number.isSafeInteger(value)&&value>=0;
  function sourceMetadata(parentPlanId,parentRevisionId,draftId,generation,baseGeneration){
   if(!identity(parentPlanId)||!identity(parentRevisionId)||!identity(draftId)||!generationValue(generation)||!generationValue(baseGeneration))throw Error('legacy_copy_validation_failed: invalid_derivation_source_metadata');
  }
  function checked(payload,cap){const result=authority.validate(payload,cap);if(!result.ok)throw Error('legacy_copy_validation_failed: '+result.errors.slice(0,3).join(' / '));return result;}
  async function original(planId){
   const head=await get('plans',planId),origin=head?.origin;
   if(!head||head.verified===false||!origin?.snapshotId||typeof origin.sourceEntryKey!=='string')fail();
   const mapping=await get('migrations',origin.snapshotId+':'+origin.sourceEntryKey),raw=await get('rawSources',origin.snapshotId);
   if(!mapping||mapping.importRevisionId!==planId+':import'||planId!=='legacy-'+await digest(origin.snapshotId+'\0'+origin.sourceEntryKey)||mapping.planId!==planId||mapping.snapshotId!==origin.snapshotId||mapping.sourceEntryKey!==origin.sourceEntryKey||!raw?.verified||raw.id!==origin.snapshotId||await digest(raw.raw)!==raw.rawDigest)fail();
   const imported=await readUnchecked(planId,mapping.importRevisionId);if(imported?.revision.kind!=='legacy-copy')fail();
   const parsed=await verifyRawSource(raw);let source;
   if(raw.sourceKind==='plan'){if(origin.sourceEntryKey!=='plan')fail();source=parsed;}
   else if(raw.sourceKind==='workspace'){
    const entries=Array.isArray(parsed)?parsed:parsed?.plans;
    if(!Array.isArray(entries))fail();const matches=entries.filter((entry,index)=>String(entry?.id??index)===origin.sourceEntryKey);
    if(matches.length!==1)fail();source=matches[0]?.plan;
   }else fail();
   // importSource already verified the structured codec and original bytes.
   // Bind the actual retained original plan too, so replacing rawStructured
   // without its archived import revision cannot grant admission.
   if(!equal(source,imported.payload))fail();
   const report=convert(imported.payload);if(!report.prepared)throw Error('legacy_conversion_blocked: '+report.diagnostics.map(d=>d.code).join(', '));
   // The established renderer treats numeric wall ID 0 as a coordinate fallback.
   // Remapping it would activate formerly dormant ID-keyed settings or lose
   // coordinate-keyed settings; this requires a separate reviewed adapter.
   if(report.mapping.some(m=>m.collection==='walls'&&m.oldId===0))throw Error('legacy_conversion_blocked: unsupported_numeric_zero_wall_identity');
   const cap=authority.issue(report.candidate);checked(report.candidate,cap);
   return {head,report,cap,contract:{version:1,snapshotId:raw.id,rawDigest:raw.rawDigest,sourceEntryKey:origin.sourceEntryKey,sourcePlanId:planId,importRevisionId:mapping.importRevisionId,candidateDigest:await digest(JSON.stringify(report.candidate))}};
  }
  async function prove(planId,trail=[]){
   if(trail.includes(planId)||trail.length>=32)fail();
   const head=await get('plans',planId),record=await get('migrations',contractId(planId));
   if(!head?.origin?.legacyCopy)return null;
   if(!record||record.planId!==planId||!equal(record.contract,head.origin.legacyCopy))fail();
   const contract=record.contract,basis=await original(contract.sourcePlanId);
   if(!equal(contract,basis.contract))fail();
   const initial=await readUnchecked(planId,record.initialRevisionId);
   if(!initial||initial.revision.payloadDigest!==record.initialPayloadDigest||initial.revision.kind!==record.kind)fail();
   if(record.parentPlanId){
    const parent=await prove(record.parentPlanId,trail.concat(planId)),parentRevision=await readUnchecked(record.parentPlanId,record.parentRevisionId);
    if(!parent||!parentRevision||!equal(parent.contract,contract)||head.origin.copiedFromPlanId!==record.parentPlanId||head.origin.copiedFromRevisionId!==record.parentRevisionId)fail();checked(parentRevision.payload,parent.cap);
    let retained=parentRevision.payload;
    if(record.sourceSnapshot){sourceMetadata(record.parentPlanId,record.parentRevisionId,record.sourceSnapshot.draftId,record.sourceSnapshot.generation,record.sourceSnapshot.baseGeneration);const archived=await get('rawSources',record.sourceSnapshot.id),owner=archived?.sourceOwner;
     if(!archived||archived.rawDigest!==record.sourceSnapshot.digest||!owner||owner.planId!==record.parentPlanId||owner.parentRevisionId!==record.parentRevisionId||owner.draftId!==record.sourceSnapshot.draftId||owner.generation!==record.sourceSnapshot.generation||owner.baseGeneration!==record.sourceSnapshot.baseGeneration||!equal(head.origin.sourceSnapshot,record.sourceSnapshot))fail();
     retained=await verifyRawSource(archived);checked(retained,parent.cap);
    }
    checked(initial.payload,authority.issue(retained));
   }else if(head.origin.copiedFromPlanId!==contract.sourcePlanId||head.origin.copiedFromRevisionId!==contract.importRevisionId||initial.revision.kind!=='legacy-converted-copy'||initial.revision.payloadDigest!==contract.candidateDigest||!equal(initial.payload,basis.report.candidate))fail();
   checked(initial.payload,basis.cap);return {contract,cap:authority.issue(initial.payload)};
  }
  async function admission(planId,payload){const proof=await prove(planId);if(proof)checked(payload,proof.cap);return proof?.cap||null;}
  async function prepare(planId){const basis=await original(planId),review=Object.freeze({planId,report:basis.report});tickets.set(review,basis.contract);return review;}
  async function write(request,contract,parent,commitOptions={},sourceGuard){
   request=snapshotJSON(request);
   const registration={id:contractId(request.planId),planId:request.planId,contract,initialRevisionId:request.planId+':'+request.operationId,initialPayloadDigest:await digest(JSON.stringify(request.payload)),kind:request.kind,...parent};
   const token=Object.freeze({});registrations.set(token,registration);if(sourceGuard)sourceGuards.set(token,snapshotJSON(sourceGuard));return save({...request,origin:{...request.origin,legacyCopy:contract}},token,commitOptions);
  }
  async function commit(review,planId,name,operationId,commitOptions={}){
   const check=()=>{if(commitOptions.isCurrent&&!commitOptions.isCurrent())throw Error('legacy_conversion_review_stale');};check();
   if(!tickets.has(review))throw Error('explicit_legacy_conversion_review_required');
   const basis=await original(review.planId);check();if(!equal(tickets.get(review),basis.contract))throw Error('legacy_conversion_review_stale');
   const result=await write({planId,name,operationId,payload:basis.report.candidate,baseRevisionId:null,baseGeneration:0,kind:'legacy-converted-copy',origin:{copiedFromPlanId:review.planId,copiedFromRevisionId:basis.contract.importRevisionId}},basis.contract,undefined,commitOptions);
   if(result.status==='saved')tickets.delete(review);return result;
  }
  async function prepareDerivationSource(parentPlanId,parentRevisionId,draftId,generation){
   const proof=await prove(parentPlanId);if(!proof)return null;
   const revision=await readUnchecked(parentPlanId,parentRevisionId),draft=await get('drafts',draftId);
   sourceMetadata(parentPlanId,parentRevisionId,draftId,generation,draft?.baseGeneration);
   if(!revision||!draft||draft.planId!==parentPlanId||draft.id!==draftId||draft.baseRevisionId!==parentRevisionId||draft.generation!==generation)throw Error('legacy_copy_validation_failed: stale_derivation_source');
   const payload=snapshotJSON(draft.payload||draft.plan);checked(payload,proof.cap);
   const raw=JSON.stringify(payload),rawDigest=await digest(raw),sourceId='derivation-source:'+JSON.stringify([parentPlanId,parentRevisionId,draftId,generation]),id=sourceId+':'+rawDigest;
   const sourceOwner=snapshotJSON({planId:parentPlanId,parentRevisionId,draftId,generation,baseGeneration:draft.baseGeneration});
   const record={codecVersion:2,id,sourceId,raw,rawDigest,sourceKind:'plan',rawStructured:null,sourceKey:null,verified:true,sourceOwner};
   await transaction(['rawSources','drafts'],'readwrite',(t,set,abort)=>{const dr=t.objectStore('drafts').get(draftId),rs=t.objectStore('rawSources'),rr=rs.get(id);let pending=2;
    for(const r of [dr,rr])r.onsuccess=()=>{if(--pending)return;try{const current=dr.result;if(!current||current.id!==draftId||current.planId!==parentPlanId||current.baseRevisionId!==parentRevisionId||current.baseGeneration!==sourceOwner.baseGeneration||current.generation!==generation||JSON.stringify(snapshotJSON(current.payload||current.plan))!==raw)throw Error('legacy_copy_validation_failed: stale_derivation_source');
     if(rr.result){if(rr.result.raw!==raw||!equal(rr.result.sourceOwner,sourceOwner))fail();}else rs.add(record);set(true);
    }catch(error){abort(error);}};
   });
   const archived=await get('rawSources',id);await verifyRawSource(archived);if(archived.raw!==raw||!equal(archived.sourceOwner,sourceOwner))fail();
   const sourceSnapshot=snapshotJSON({id,digest:rawDigest,draftId,generation,baseGeneration:sourceOwner.baseGeneration}),token=Object.freeze({version:1,sourcePlanId:parentPlanId,parentRevisionId,sourceSnapshotId:id});
   sourceTickets.set(token,{parentPlanId,parentRevisionId,sourceSnapshot,payload});return token;
  }
  async function derive(request,parentPlanId,parentRevisionId,sourceTicket,commitOptions={}){
   request=snapshotJSON(request);const source=sourceTicket?sourceTickets.get(sourceTicket):null;
   if(sourceTicket&&!source)throw Error('legacy_copy_validation_failed: untrusted_derivation_source');
   if(source&&(source.parentPlanId!==parentPlanId||source.parentRevisionId!==parentRevisionId))throw Error('legacy_copy_validation_failed: derivation_source_mismatch');
   const parent=await prove(parentPlanId),revision=await readUnchecked(parentPlanId,parentRevisionId);if(!revision)fail();
   if(!parent){const result=schema.validatePlan(request.payload);if(!result.ok)throw Error('new_plan_validation_failed');return save(request,undefined,commitOptions);}
   checked(revision.payload,parent.cap);let retained=revision.payload,sourceGuard;
   if(source){const draft=await get('drafts',source.sourceSnapshot.draftId);
    if(!draft||draft.id!==source.sourceSnapshot.draftId||draft.planId!==parentPlanId||draft.baseRevisionId!==parentRevisionId||draft.baseGeneration!==source.sourceSnapshot.baseGeneration||draft.generation!==source.sourceSnapshot.generation||await digest(JSON.stringify(snapshotJSON(draft.payload||draft.plan)))!==source.sourceSnapshot.digest)throw Error('legacy_copy_validation_failed: stale_derivation_source');
    const archived=await get('rawSources',source.sourceSnapshot.id),sourceOwner={planId:parentPlanId,parentRevisionId,draftId:source.sourceSnapshot.draftId,generation:source.sourceSnapshot.generation,baseGeneration:source.sourceSnapshot.baseGeneration};retained=await verifyRawSource(archived);if(archived.rawDigest!==source.sourceSnapshot.digest||!equal(archived.sourceOwner,sourceOwner)||!equal(retained,source.payload))fail();
    sourceGuard={parentPlanId,parentRevisionId,sourceSnapshot:source.sourceSnapshot,sourceOwner,raw:archived.raw,sourceId:archived.sourceId,parentRevisionPayload:revision.revision.payload,parentRevisionDigest:revision.revision.payloadDigest};
   }
   checked(retained,parent.cap);checked(request.payload,authority.issue(retained));
   const {sourceSnapshot:ignoredCallerSnapshot,legacyCopy:ignoredCallerCopy,...providedOrigin}=request.origin||{};
   return write({...request,origin:{...providedOrigin,copiedFromPlanId:parentPlanId,copiedFromRevisionId:parentRevisionId,...(source?{sourceSnapshot:source.sourceSnapshot}:{})}},parent.contract,{parentPlanId,parentRevisionId,...(source?{sourceSnapshot:source.sourceSnapshot}:{})},commitOptions,sourceGuard);
  }
  return Object.freeze({prepare,commit,admission,derive,prepareDerivationSource,registration:token=>registrations.get(token),sourceGuard:token=>sourceGuards.get(token),validate:authority.validate,isAdmission:authority.isIssued});
 }
 return Object.freeze({create});
});
