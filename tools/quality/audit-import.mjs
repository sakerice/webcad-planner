// Offline stage audit. This reports retained evidence, not architectural accuracy.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mergeReadPages} from '../../worker/plan-pages.mjs';
import {finishImportedPlan} from '../../worker/routes-ai.mjs';
import Registration from '../../assets/js/plan-registration.js';
export function audit(body){
 const local=body.sourceLocal,compiled=Registration.compile(local,{proposals:body.buildingRegistration});
 const counts=a=>(a||[]).reduce((o,e)=>(o[e.type||e.guess||'unknown']=(o[e.type||e.guess||'unknown']||0)+1,o),{});
 const baths=(local.items||[]).filter(i=>i.type==='bath').map(item=>({item,sourceSymbols:(local.marks||[]).filter(m=>m.floor===item.floor&&m.guess==='bathtub'),note:'図面記号と設備範囲の差を人が確認する。記号の数値だけで設備を自動置換しない。'}));
 return {kind:'offline-stage-audit',accuracyVerified:false,sourceItems:counts(local.items),registeredItems:counts(compiled.plan.items),deferredItems:counts(compiled.deferredItems),retainedMarks:counts(local.marks),bathExtentReview:baths,roomUseEvidence:local.floors.flatMap(f=>(f.rooms||[]).filter(r=>r.use==='entry'||r.use==='bath').map(r=>({floor:f.floor,name:r.name,use:r.use,level:r.level,note:'level=0は未記載の既定値の可能性があり、段差の測定結果とは限らない'}))),unknowns:compiled.diagnostics.filter(d=>/unknown|assumed|deferred/.test(d.code)),notes:['marksは設備と重複するものを含むため、marks数をそのまま欠落物体数としない','入力に読み取られなかった物体はこの監査だけでは検出不能。元PDFでの独立確認が必要','canApplyはユーザーの確認を含む別の判定で、再現品質の点数ではない']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const filename=process.argv[2]||'tools/tests/fixtures/registration/native-astra-three-floor.raw.json';
 const raw=JSON.parse(fs.readFileSync(filename));
 const merged=mergeReadPages(raw.pages.map(p=>p.reading));
 merged.floors=merged.floors.map(f=>({...f,sourcePageId:raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor)).sourcePageId}));
 const res=finishImportedPlan({...merged,buildingRegistration:raw.buildingRegistration},null,{});
 if(res.status!==200)throw Error('Offline finalization failed: '+res.status);
 console.log(JSON.stringify(audit(await res.json()),null,2));
}
