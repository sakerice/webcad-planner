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
  function preview(plan,options={}){
   if(!plan||!Array.isArray(plan.items)||!Array.isArray(plan.walls)||!Array.isArray(plan.rooms))throw Error('プランの配列が不正です。');
   const result=clone(plan),rows=[],excluded=new Set(options.excludedIndexes||[]),approved=new Set(options.approvedIndexes||[]),retained=new Map((contract.retained||[]).map(r=>[r.sourceId,r.reason]));
   for(let index=0;index<plan.items.length;index++){
    const source=plan.items[index],item=result.items[index],match=mapping.get(source.type),target=match&&lookup.get(match.targetId),sourceAsset=lookup.get(source.type);
    let reason=!match?(retained.get(source.type)||'対応なし・そのまま'):null;
    // Wall-connected / externally attached objects need a separate placement adapter.
    if(match&&Object.prototype.hasOwnProperty.call(source,'assetPackConversion'))reason='既存の変換情報あり・そのまま';
    if(match&&(source.wallId!=null||source.parentId!=null||source.attachment||source.supportId!=null))reason='接続・支持情報あり・そのまま';
    const dimensions={};
    for(const key of ['w','d'])dimensions[key]=source[key]??options.resolvedDimensions?.[index]?.[key]??sourceAsset?.[key];
    // Stored item.h is not the ordinary furniture renderer's effective height.
    dimensions.h=options.resolvedDimensions?.[index]?.h??sourceAsset?.h;
    if(match&&!reason&&Object.values(dimensions).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0))reason='寸法を確定できないため保持';
    const ratios=target&&['w','d','h'].map(k=>dimensions[k]/target[k]);
    if(match&&!reason&&ratios.some(v=>v<.25||v>4))reason='形状差が大きいため保持';
    const canSelect=!!match&&!reason;
    if(canSelect&&excluded.has(index))reason='対象外に指定';
    if(canSelect&&!reason&&match.reviewRequired&&!approved.has(index))reason=match.reviewReason||'高さ・機能の確認が必要なため保持';
    if(match&&!reason){
     item.type=target.id;
     for(const key of ['w','d','h'])if(item[key]==null)item[key]=dimensions[key];
     // Retain all appearance and custom fields. Unmatched finish keys are inert
     // on the target, but survive save/load rather than being discarded.
     item.assetPackConversion={version:2,mappingVersion:contract.revision,sourceType:source.type,targetType:target.id,heightPolicy:'preserve-effective-height-v1',sourceEffectiveHeightMm:dimensions.h,renderHeightMm:dimensions.h};
    }
    rows.push({index,id:source.id,sourceId:source.type,targetId:target?.id||null,sourceName:sourceAsset?.name||source.type,targetName:target?.name||'',changed:!!match&&!reason,canSelect,reviewRequired:!!match?.reviewRequired,reason:reason||'対応モデルへ',dimensions,warnings:!reason&&match?['位置・寸法・回転・階を維持。形状比率と正面は3Dで確認。',...(['finishColors','finishTextures','finishRoughness'].some(k=>source[k])?['同名材質のみ適用。非対応の材質設定もJSON内に保持。']:[]),...(Object.keys(source).some(k=>!['id','type','x','y','w','d','h','rot','floor','elev','flipX','flipY','color','finishColors','finishTextures','finishRoughness'].includes(k))?['個別設定は保持。モデル固有の効果は再現しない場合があります。']:[])]:[]});
   }
   return {plan:result,rows,changed:rows.filter(r=>r.changed).length,retained:rows.filter(r=>!r.changed).length};
  }
  return Object.freeze({preview});
 }
 const api={createConverter,renderHeight};if(typeof module!=='undefined')module.exports=api;root.AssetPackConversion=api;
})(typeof window==='undefined'?globalThis:window);
