/* Pure, opt-in conversion of an independent JSON clone; never remaps live IDs. */
(function(root){
 'use strict';
 const clone=v=>JSON.parse(JSON.stringify(v));
 // Only newly generated conversion v2 records opt into effective-height fitting.
 // Ordinary furniture and v1 records keep the editor's established semantics.
 function renderHeight(item,lookup,contract){
  const m=item?.assetPackConversion;
  if(!m||m.version!==2||m.heightPolicy!=='preserve-effective-height-v1'||m.targetType!==item.type||typeof item.type!=='string'||!item.type.startsWith('rpg-mansion-')||typeof m.sourceType!=='string')return null;
  if(typeof lookup!=='function'||!contract||m.mappingVersion!==contract.revision)return null;
  const pair=contract.mappings.find(row=>row.sourceId===m.sourceType&&row.targetId===m.targetType);
  const target=lookup(m.targetType),source=lookup(m.sourceType);
  if(!pair||!target||(!source&&!pair.native))return null;
  const h=m.renderHeightMm,original=m.sourceEffectiveHeightMm,nominal=target.h;
  // Reject imported underflow/overflow and implausible fitting before GPU matrices.
  if(typeof h!=='number'||!Number.isFinite(h)||h<2.2250738585072014e-308||h!==original||typeof nominal!=='number'||!Number.isFinite(nominal)||nominal<=0)return null;
  return h/nominal>=.25&&h/nominal<=4?h:null;
 }
 function createConverter(contract,assets){
  if(contract?.version!==1||!Array.isArray(contract.mappings))throw Error('対応表の形式を確認してください。');
  const lookup=new Map(assets.map(a=>[a.id,a])),mapping=new Map();
  for(const row of contract.mappings){
   if(!row.sourceId||!row.targetId||mapping.has(row.sourceId)||row.sourceId===row.targetId||!lookup.has(row.targetId))throw Error('対応表に重複・不明な変換先があります。');
   mapping.set(row.sourceId,clone(row));
  }
  // The same correspondence is used in both directions. A many-to-one RPG
  // model alone cannot identify a Japanese original; only its validated exact
  // conversion provenance can. Keep that provenance intact on a return trip.
  const heightContract={revision:contract.revision,mappings:contract.mappings.map(row=>({sourceId:row.sourceId,targetId:row.targetId,native:row.kind==='native-explicit'}))};
  function provenance(source){
   const m=source.assetPackConversion,pair=m&&mapping.get(m.sourceType);
   return pair&&pair.targetId===m.targetType&&(lookup.has(m.sourceType)||pair.kind==='native-explicit')&&renderHeight({...source,type:m.targetType},id=>lookup.get(id),heightContract)!==null?pair:null;
  }
  function preview(plan,options={}){
   if(!plan||!Array.isArray(plan.items)||!Array.isArray(plan.walls)||!Array.isArray(plan.rooms))throw Error('プランの配列が不正です。');
   const targetPack=options.targetPack||contract.targetPack||'rpg-mansion';
   if(!['japanese-standard','rpg-mansion'].includes(targetPack))throw Error('対応するオブジェクトセットを選択してください。');
   const reverse=targetPack==='japanese-standard';
   const result=clone(plan),rows=[],excluded=new Set(options.excludedIndexes||[]),approved=new Set(options.approvedIndexes||[]),retained=new Map((contract.retained||[]).map(r=>[r.sourceId,r.reason]));
   for(let index=0;index<plan.items.length;index++){
    const source=plan.items[index],item=result.items[index],sourceAsset=lookup.get(source.type),isRpg=typeof source.type==='string'&&source.type.startsWith('rpg-mansion-'),previous=provenance(source);
    const match=reverse?(isRpg&&previous&&previous.targetId===source.type?{...previous,targetId:source.assetPackConversion.sourceType}:null):mapping.get(source.type);
    // The existing contract also names native renderer IDs absent from model
    // manifests. Resolve only those exact native-explicit originals through the
    // editor's existing size/height resolver, never a guessed model or ID.
    const resolvedTarget=options.resolvedTargets?.[index];
    const target=match&&(lookup.get(match.targetId)||(reverse&&match.kind==='native-explicit'&&resolvedTarget?.id===match.targetId?resolvedTarget:null));
    let reason=!match?(reverse&&isRpg?'元のモデルを特定できる変換情報なし・そのまま':isRpg&&!reverse?'すでにRPG向け洋館・そのまま':reverse&&sourceAsset?'すでに日本建築標準・そのまま':retained.get(source.type)||'対応なし・そのまま'):null;
    // A verified return trip may be reapplied through this same correspondence.
    // Arbitrary or stale conversion/custom records still remain byte-equivalent.
    if(match&&!reverse&&Object.prototype.hasOwnProperty.call(source,'assetPackConversion')&&!(previous&&source.assetPackConversion.sourceType===source.type&&previous.targetId===match.targetId))reason='既存の変換情報あり・そのまま';
    if(match&&(source.wallId!=null||source.parentId!=null||source.attachment||source.supportId!=null))reason='接続・支持情報あり・そのまま';
    if(match&&!target&&!reason)reason='元の標準モデルの寸法を確認できないため保持';
    const dimensions={};
    for(const key of ['w','d'])dimensions[key]=source[key]??options.resolvedDimensions?.[index]?.[key]??sourceAsset?.[key];
    // Stored item.h is not the ordinary furniture renderer's effective height.
    dimensions.h=options.resolvedDimensions?.[index]?.h??sourceAsset?.h;
    if(match&&!reason&&Object.values(dimensions).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0))reason='寸法を確定できないため保持';
    // Returning to a native model must retain the editor's effective height,
    // not assume that a stored h controls its renderer.
    if(match&&reverse&&!reason&&(options.resolvedTargetHeights?.[index]??target?.h)!==dimensions.h)reason='元のモデルの表示高さを維持できないため保持';
    const ratios=target&&['w','d','h'].map(k=>dimensions[k]/target[k]);
    if(match&&!reason&&ratios.some(v=>!Number.isFinite(v)||v<.25||v>4))reason='形状差が大きいため保持';
    const canSelect=!!match&&!reason;
    if(canSelect&&excluded.has(index))reason='対象外に指定';
    if(canSelect&&!reason&&match.reviewRequired&&!approved.has(index))reason=match.reviewReason||'高さ・機能の確認が必要なため保持';
    if(match&&!reason){
     item.type=target.id;
     for(const key of ['w','d','h'])if(item[key]==null)item[key]=dimensions[key];
     // Retain all appearance and custom fields. Unmatched finish keys are inert
     // on the target, but survive save/load rather than being discarded.
     if(!reverse)item.assetPackConversion={...(source.assetPackConversion||{}),version:2,mappingVersion:contract.revision,sourceType:source.type,targetType:target.id,heightPolicy:'preserve-effective-height-v1',sourceEffectiveHeightMm:dimensions.h,renderHeightMm:dimensions.h};
    }
    rows.push({index,id:source.id,sourceId:source.type,targetId:target?.id||null,sourceName:sourceAsset?.name||source.type,targetName:target?.name||'',changed:!!match&&!reason,canSelect,reviewRequired:!!match?.reviewRequired,reason:reason||'対応モデルへ',dimensions,warnings:!reason&&match?['位置・寸法・回転・階を維持。形状比率と正面は3Dで確認。',...(['finishColors','finishTextures','finishRoughness'].some(k=>source[k])?['同名材質のみ適用。非対応の材質設定もJSON内に保持。']:[]),...(Object.keys(source).some(k=>!['id','type','x','y','w','d','h','rot','floor','elev','flipX','flipY','color','finishColors','finishTextures','finishRoughness'].includes(k))?['個別設定は保持。モデル固有の効果は再現しない場合があります。']:[])]:[]});
   }
   return {plan:result,rows,targetPack,changed:rows.filter(r=>r.changed).length,retained:rows.filter(r=>!r.changed).length};
  }
  return Object.freeze({preview});
 }
 const api={createConverter,renderHeight};if(typeof module!=='undefined')module.exports=api;root.AssetPackConversion=api;
})(typeof window==='undefined'?globalThis:window);
