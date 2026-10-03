// Offline, source-specific data stays in the annotation fixture, never in runtime code.
const fs=require('node:fs'),R=require('../assets/js/source-opening-review.js');
const base=JSON.parse(fs.readFileSync('tools/tests/fixtures/public-native/source-audit-kitchen.json'));
const annotations=JSON.parse(fs.readFileSync('tools/tests/fixtures/registration/native-astra-opening-image-review.json'));
const report=base.sceneReconstructionReports.find(r=>r.kind==='building-registration');
const readings=base.items.map(it=>{
 if(!R.isDoor(it.type)||it.type==='door-opening')return {type:it.type};
 const candidates=report.sourceLocal.items.map((s,index)=>({s,index})).filter(({s})=>s.type===it.type&&s.floor===it.floor).map(({s,index})=>{const pose=report.poses[s.floor],a=pose.quarterTurns*Math.PI/2;return {index,s,pose,x:s.x*Math.cos(a)-s.y*Math.sin(a)+pose.dx+(report.translation?.x||0),y:s.x*Math.sin(a)+s.y*Math.cos(a)+pose.dy+(report.translation?.y||0)};}).filter(r=>Math.hypot(r.x-it.x-it.w/2,r.y-it.y-it.d/2)<1e-6);
 if(candidates.length!==1)throw Error('Source item is ambiguous: '+it.id);
 const {s,index,pose,x,y}=candidates[0],annotation=annotations.find(a=>a.sourceItemIndex===index);
 if(!annotation||annotation.originalSnapshot!==JSON.stringify(s))throw Error('Annotation source changed: '+index);
 return {...s,x,y,rot:s.rot+pose.quarterTurns*90,sourceOpeningReference:{coordinateFrame:'registered-building-frame',sourceItemIndex:index,sourcePageId:annotation.sourcePageId,originalSnapshot:JSON.stringify(s),registrationPose:pose}};
});
const mapped=R.bind(readings,base).plan,result=R.applyImageDirections(mapped,annotations);
fs.mkdirSync('docs/quality-review/source-image-door-review',{recursive:true});
fs.writeFileSync('local-preview/source-reviewed-doors.json',JSON.stringify(result.plan,null,2));
fs.writeFileSync('tools/tests/fixtures/registration/source-image-door-review-results.json',JSON.stringify(result.reviews,null,2));
console.log(JSON.stringify({doors:result.reviews.length,applied:result.reviews.filter(r=>r.applied).length,physicalUnresolved:result.reviews.filter(r=>r.applied&&r.physicalValidation!=='native-envelope-pass').length}));
