/* One exact native asset, colors only. Source semantics remain unverified. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./tailored-sofa-finish.js'));
 else root.SceneAppearanceProfiles=factory(root.TailoredSofaFinish,root);
})(typeof globalThis!=='undefined'?globalThis:this,function(Native,root){
 'use strict';
 const ID='tailored-sofa-regional-colors',HEX=/^#[0-9a-f]{6}$/i;
 function runtime(){return root&&root.parent!==root&&root.parent?.TailoredSofaFinish||Native;}
 function fields(v,keys){
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v),ctor=p&&Object.getOwnPropertyDescriptor(p,'constructor')?.value;
  if(p!==null&&!(Object.getPrototypeOf(p)===null&&typeof ctor==='function'&&ctor.prototype===p&&Function.prototype.toString.call(ctor)===Function.prototype.toString.call(Object)))return null;
  const ds=Object.getOwnPropertyDescriptors(v);
  if(Reflect.ownKeys(ds).length!==keys.length||Reflect.ownKeys(ds).some(k=>!keys.includes(k)||!Object.hasOwn(ds[k],'value')))return null;
  return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
 }
 function parse(v){const p=fields(v,['id','version','assetSha256','colors']);if(!p||p.id!==ID||p.version!==1||p.assetSha256!==Native.sha256)return null;const c=fields(p.colors,['body','seat']);if(!c||Object.values(c).some(v=>typeof v!=='string'||!HEX.test(v)))return null;return {...p,colors:c};}
 function describe(item){
  if(!item||item.id!==Native.type||item.model!==Native.url||item.w!==2000||item.d!==940||item.h!==1020)return null;
  const cap=runtime().capability();return {id:ID,version:1,assetSha256:Native.sha256,available:cap.available,auditRevision:cap.auditRevision,renderer:'existing-native-editor',parameters:['body','seat'],colorsOnly:true,genericFinishChannel:false,fixedMaterials:['Oak legs','Upholstery seam'],sourceRegionSemanticsAudited:false,productIdentityVerified:false,physicalMaterialVerified:false,uniformPixelRGBGuaranteed:false,reason:cap.reason||null,frontAudit:cap.frontAudit};
 }
 function validate(value,binding,source,model){
  const profile=parse(value);if(!profile)throw Error('Exact v1 profile requires own data fields and complete primitive body/seat hex strings');
  if(!model||model.id!==Native.type||model.w!==2000||model.d!==940||model.h!==1020||binding.catalogId?.value!==Native.type||binding.appearanceMode!=='match-diagram-appearance'||Object.hasOwn(binding,'channels')||Object.hasOwn(binding,'rotationDeg'))throw Error('Profile only supports the exact sofa, diagram appearance and existing derived orientation');
  const cap=runtime().capability(),advertised=(model.appearanceProfiles||[]).find(p=>p.id===ID);
  if(!cap.available||!advertised?.available||advertised.version!==1||advertised.assetSha256!==Native.sha256||advertised.auditRevision!==cap.auditRevision)throw Error('Trusted native loader capability is unavailable or stale');
  const fact=source?.appearance?.diagramColor,regions=fact&&['observed','inferred'].includes(fact.status)&&fact.value;
  if(!Array.isArray(regions)||regions.length!==2)throw Error('Raw source requires exactly one body and one seat region');
  const raw={};for(const region of regions){const r=fields(region,['region','color']);if(!r||!['body','seat'].includes(r.region)||Object.hasOwn(raw,r.region)||typeof r.color!=='string'||!HEX.test(r.color))throw Error('Raw region is missing, duplicated or unsupported');raw[r.region]=r.color;}
  if(profile.colors.body!==raw.body||profile.colors.seat!==raw.seat)throw Error('Profile colors must exactly equal retained raw regional colors');
  return {profile,provenance:{origin:'explicit-display-assumption',sourceSnapshot:JSON.stringify(source),sourceEntityId:source.id,assetSha256:Native.sha256,auditRevision:cap.auditRevision,sourceRegionSemanticsAudited:false,sourceMeasured:false,approvalState:'unreviewed',mapping:{body:'native-back-arms-base',seat:'native-two-seat-cushions'},fixedMaterials:['Oak legs','Upholstery seam']}};
 }
 function preflight(scene,options){
  const list=[];
  for(const container of [scene?.bindings,options?.bindingDecisions])if(Array.isArray(container))for(const value of container){const b=container===scene?.bindings?value:Object.getOwnPropertyDescriptor(value||{},'binding')?.value;if(!b)continue;const d=Object.getOwnPropertyDescriptor(b,'appearanceProfile');if(d&&(!Object.hasOwn(d,'value')||!parse(d.value)))list.push({code:'invalid_appearance_profile',path:'bindings.appearanceProfile',severity:'error',message:'Profile must be an exact plain data record; getters are not evaluated'});}
  return list;
 }
 return Object.freeze({id:ID,parse,describe,validate,preflight,nativeColors:item=>runtime().colors(item),acceptsRenderProof:(proof,c)=>runtime().acceptsRenderProof(proof,c)});
});
