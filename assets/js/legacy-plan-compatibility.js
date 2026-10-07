/* Narrow persisted-copy admission. JSON metadata is never an admission capability. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.LegacyPlanCompatibility=factory();
})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const collections=['walls','rooms','items'];
 function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  return Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 }
 function createAuthority(schema){
  const issued=new WeakMap();
  function issue(candidate){
   const records=(candidate.walls||[]).filter(w=>zero(w)).map(canonical),cap=Object.freeze({version:1,retainedZeroWalls:records.length});
   issued.set(cap,new Set(records));return cap;
  }
  function zero(w){return !!w&&Number.isFinite(Number(w.x1))&&Number.isFinite(Number(w.y1))&&Number(w.x1)===Number(w.x2)&&Number(w.y1)===Number(w.y2);}
  function validate(plan,cap){
   if(!cap)return schema.validatePlan(plan);
   if(!issued.has(cap))throw Error('untrusted_legacy_admission');
   const strict=schema.validatePlan(plan),allowed=issued.get(cap),errors=[];
   if(!plan||collections.some(k=>!Array.isArray(plan[k])))return strict;
   for(const name of collections){const seen=new Set();for(const entity of plan[name]){
    const id=entity?.id;
    if((typeof id!=='string'&&typeof id!=='number')||id===''||typeof id==='number'&&!Number.isFinite(id)){errors.push(name+': converted copy requires stable entity IDs');continue;}
    const key=String(id);if(seen.has(key))errors.push(name+': duplicate entity ID '+key);seen.add(key);
   }}
   // Only exact, source-proven inert records are omitted from the validation
   // projection. Their actual geometry, optional fields and settings are untouched.
   const projected={...plan,walls:plan.walls.filter(w=>!zero(w)||!allowed.has(canonical(w)))},checked=schema.validatePlan(projected);
   if(plan.walls.length+plan.rooms.length+plan.items.length>schema.LIMITS.MAX_OBJECTS)errors.push('converted copy exceeds total object limit');
   return {ok:!errors.length&&checked.ok,errors:errors.concat(checked.errors),warnings:strict.warnings};
  }
  return Object.freeze({issue,validate,isIssued:cap=>issued.has(cap)});
 }
 return Object.freeze({createAuthority,canonical});
});
