/* Reviewed source-to-existing-editor mapping. Pure: no IDs, DATA writes or assets fetched. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SourceObjectMapping=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 var clone=function(v){return JSON.parse(JSON.stringify(v));};
 function key(v){return JSON.stringify(v);}
 function finite(v){return typeof v==='number'&&Number.isFinite(v);}
 function candidates(source){
  var out=[];
  ['items','marks'].forEach(function(collection){(source[collection]||[]).forEach(function(s,index){
   if(!s||![s.x,s.y,s.w,s.d].every(finite)||s.w<=0||s.d<=0||!Number.isInteger(s.floor)||s.floor<1)return;
   var semantic=s.type||s.guess||'unknown';
   out.push({id:collection+':'+index,collection:collection,index:index,semantic:semantic,snapshot:key(s),source:clone(s)});
  });});return out;
 }
 function map(source,decision,catalogue){
  var result={canApply:false,items:[],walls:[],diagnostics:[]};
  function reject(code){result.diagnostics.push(code);return result;}
  var c=candidates(source).find(function(c){return c.id===decision.sourceId;});
  if(!c||decision.sourceSnapshot!==c.snapshot)return reject('source_review_stale');
  if(decision.reviewed!==true)return reject('mapping_review_required');
  var s=c.source,rot=finite(s.rot)?s.rot:0;
  if(s.rot!==undefined&&!finite(s.rot))return reject('invalid_source_rotation');
  var provenance={sourceId:c.id,sourceSnapshot:c.snapshot,source:clone(s),representation:'reviewed-existing-editor',assumptions:[]};
  if(c.semantic==='stair'||c.semantic==='stair-corner'){
   // Existing flights automatically cut floor/ceiling slabs. A caller cannot attest that away.
   return reject('stair_requires_renderer_cutout_isolation');
  }
  if(decision.kind==='lattice-rail'){
   if(['rail','railing','lattice','lattice-rail','lattice-screen'].indexOf(c.semantic)<0)return reject('lattice_source_semantics_required');
   if(['lattice','lattice-rail','lattice-screen'].indexOf(c.semantic)<0&&decision.acceptLatticeRepresentation!==true)return reject('lattice_representation_review_required');
   var a=s.start,b=s.end;
   if(!a||!b||![a.x,a.y,b.x,b.y].every(finite)||a.x===b.x&&a.y===b.y)return reject('rail_source_endpoints_required');
   if(!finite(s.thick)||s.thick<50)return reject('lattice_renderer_thickness_unsupported');
   var height=s.heightMm===undefined?decision.acceptDisplayHeightMm:s.heightMm,elevation=s.elevationMm===undefined?decision.acceptDisplayElevationMm:s.elevationMm;
   if(!finite(height)||height<300||height>3000)return reject('lattice_height_review_required');
   if(!finite(elevation)||elevation<-5000||elevation>10000)return reject('lattice_elevation_review_required');
   if(s.heightMm===undefined)provenance.assumptions.push({field:'heightMm',value:height,provenance:'user-reviewed-display-assumption',measured:false});
   if(s.elevationMm===undefined)provenance.assumptions.push({field:'elevationMm',value:elevation,provenance:'user-reviewed-display-assumption',measured:false});
   var pattern=s.fencePattern,infill=s.railInfill;
   if(pattern!==undefined&&['horizontal','vertical'].indexOf(pattern)<0)return reject('lattice_pattern_unsupported');
   if(infill!==undefined&&['bars','wires','baluster','none'].indexOf(infill)<0)return reject('lattice_infill_unsupported');
   if(infill===undefined&&pattern!==undefined)infill=pattern==='horizontal'?'bars':'baluster';
   if(infill===undefined){infill=decision.acceptDisplayRailInfill;if(['bars','wires','baluster','none'].indexOf(infill)<0)return reject('lattice_infill_review_required');provenance.assumptions.push({field:'railInfill',value:infill,provenance:'user-reviewed-display-assumption',measured:false});}
   if(pattern!==undefined&&((infill==='baluster'&&pattern!=='vertical')||(['bars','wires'].indexOf(infill)>=0&&pattern!=='horizontal')))return reject('lattice_pattern_infill_conflict');
   if(s.finish!==undefined||s.color!==undefined)return reject('lattice_regional_finish_required');
   var width=Math.hypot(b.x-a.x,b.y-a.y),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
   var item={type:'lattice-screen',floor:s.floor,x:center.x-width/2,y:center.y-s.thick/2,w:width,d:s.thick,rot:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,latticeHeight:height,elev:elevation,fencePattern:pattern||(['bars','wires'].indexOf(infill)>=0?'horizontal':'vertical'),railInfill:infill,sourceObjectMapping:provenance};
   if(s.latticeCap!==undefined&&typeof s.latticeCap!=='boolean')return reject('lattice_cap_unsupported');
   if(s.railCapColor!==undefined&&s.latticeCap!==true)return reject('lattice_cap_presence_required');
   if(s.latticeCap!==undefined)item.latticeCap=s.latticeCap;
   for(var field of ['latticePitch','latticeSlat'])if(s[field]!==undefined){var bounds=field==='latticePitch'?[30,600]:[15,200];if(!finite(s[field])||s[field]<bounds[0]||s[field]>bounds[1]||Math.round(s[field])!==s[field])return reject('lattice_spacing_unsupported');item[field]=s[field];}
   for(var k of ['railFrameColor','railCapColor'])if(s[k]!==undefined){if(typeof s[k]!=='string'||!/^#[0-9a-f]{6}$/i.test(s[k]))return reject('lattice_color_unsupported');item[k]=s[k];}
   result.items.push(item);
  }else if(decision.kind==='rail'){
   // The existing balcony fence is fixed at 1100 mm. Do not misrepresent other source heights.
   if(c.semantic!=='rail'&&c.semantic!=='railing'&&c.semantic!=='balcony-fence'&&c.semantic!=='parapet')return reject('rail_source_semantics_required');
   if(c.semantic!=='parapet'&&decision.acceptSolidParapet!==true)return reject('solid_parapet_representation_review_required');
   if(s.heightMm!==undefined&&s.heightMm!==1100)return reject('rail_height_unsupported');
   if(s.heightMm===undefined&&decision.acceptDisplayHeightMm!==1100)return reject('rail_display_height_review_required');
   if(s.heightMm===undefined)provenance.assumptions.push({field:'heightMm',value:1100,provenance:'existing-renderer-display-default',measured:false});
   if(s.color!==undefined||s.finish!==undefined||s.fencePattern!==undefined)return reject('rail_source_finish_unsupported');
   var a=s.start,b=s.end;
   if(!a||!b||![a.x,a.y,b.x,b.y].every(finite)||a.x===b.x&&a.y===b.y)return reject('rail_source_endpoints_required');
   if(!finite(s.thick)||s.thick<=0)return reject('rail_source_thickness_required');
   result.walls.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,floor:s.floor,thick:s.thick,wallStyle:'balcony-fence',sourceObjectMapping:provenance});
  }else{
   var asset=catalogue&&catalogue.get(decision.catalogId);
   if(!asset||asset.openingOnly||asset.id==='stair'||asset.id==='stair-corner')return reject('exact_nonopening_catalogue_required');
   if(decision.semantic!==c.semantic)return reject('source_semantics_review_required');
   if(c.semantic==='cabinet'&&asset.sourceObjectType!=='cabinet')return reject('verified_cabinet_asset_required');
   provenance.catalogueDisplay={id:asset.id,w:asset.w,d:asset.d,h:asset.h||null,front:asset.front||null,frontProvenance:asset.frontProvenance||'unknown',sourceObjectType:asset.sourceObjectType||null};
   if(decision.sizingPolicy!=='fit-source'&&(asset.w!==s.w||asset.d!==s.d))return reject('source_envelope_review_required');
   if(s.rot===undefined){if(decision.displayRotationDeg!==undefined){if(!finite(decision.displayRotationDeg)||decision.displayRotationDeg<0||decision.displayRotationDeg>=360||decision.displayRotationDeg%90!==0)return reject('display_rotation_review_required');rot=decision.displayRotationDeg;}provenance.assumptions.push({field:'rotationDeg',value:rot,provenance:'user-reviewed-display-assumption',measured:false});}else if(decision.displayRotationDeg!==undefined&&decision.displayRotationDeg!==s.rot)return reject('source_rotation_override_conflict');
   var width=s.w,depth=s.d;if(s.rot===undefined&&rot%180===90){width=s.d;depth=s.w;}
   var item={type:asset.id,floor:s.floor,x:s.x-width/2,y:s.y-depth/2,w:width,d:depth,rot:rot,modelFacingVersion:1,sourceObjectMapping:provenance};
   if(s.frontDirection){
    var axes={'+Z':{x:0,y:1},'-Z':{x:0,y:-1},'+X':{x:1,y:0},'-X':{x:-1,y:0}},axis=axes[asset.front],front=s.frontDirection;
    if(!axis||![front.x,front.y].every(finite)||Math.abs(Math.hypot(front.x,front.y)-1)>1e-6)return reject('verified_catalogue_front_required');
    var angle=rot*Math.PI/180,fx=axis.x*Math.cos(angle)-axis.y*Math.sin(angle),fy=axis.x*Math.sin(angle)+axis.y*Math.cos(angle);
    if(Math.hypot(fx-front.x,fy-front.y)>1e-6)return reject('source_front_rotation_conflict');
   }
   if(s.heightMm!==undefined)return reject('source_height_requires_supported_asset_height_mapping');
   if(s.finish!==undefined||s.material!==undefined)return reject('source_finish_mapping_unresolved');
   if(s.elevationMm!==undefined||s.elev!==undefined)return reject('source_elevation_mapping_unresolved');
   if(finite(asset.h))provenance.assumptions.push({field:'heightMm',value:asset.h,provenance:'catalogue-display-default',measured:false});
   if(s.color!==undefined){if(decision.acceptDiagramColor!==true||!asset.genericColor||!/^#[0-9a-f]{6}$/i.test(s.color))return reject('source_finish_mapping_unresolved');item.color=s.color;item.colorCustom=true;provenance.assumptions.push({field:'color',value:s.color,provenance:'reviewed-diagram-color',physicalFinishVerified:false});}
   result.items.push(item);
  }
  result.canApply=true;return result;
 }
 function displayGeometry(it){return Object.fromEntries(['type','floor','x','y','w','d','rot','flipX','flipY','elev','color','colorCustom','modelFacingVersion','baseRoom','baseLevel','finishColors','finishRoughness','finishTextures'].map(k=>[k,it[k]===undefined?null:clone(it[k])]));}
 function initialTranslation(plan,dx){var pending=[];for(const it of plan.items||[]){const m=it.sourceObjectMapping;if(!m||!m.editorDisplayBaseline)continue;const before=displayGeometry(it);before.x-=dx;if(Math.abs(before.x-m.editorDisplayBaseline.x)<1e-6)before.x=m.editorDisplayBaseline.x;if(m.displayTranslation||key(before)!==key(m.editorDisplayBaseline))throw Error('家具の初期配置が変わりました。来歴を上書きしません。');pending.push({it:it,m:m});}for(const entry of pending){entry.m.registrationDisplayBaseline=clone(entry.m.editorDisplayBaseline);entry.m.editorDisplayBaseline=displayGeometry(entry.it);entry.m.displayTranslation={x:dx,y:0};}}

 function captureSupportBaseline(items,getBaseYmm){for(const it of items||[]){const m=it.sourceObjectMapping;if(!m||!m.catalogueDisplay||m.supportDisplayBaseline)continue;let y;try{y=getBaseYmm(it);}catch(_){y=null;}m.supportDisplayBaseline={baseYmm:finite(y)?y:null,provenance:'native-support-at-initial-import',measured:false};}}
 function currentStatus(it,supportBaseYmm){var mapping=it.sourceObjectMapping,baseline=mapping&&mapping.editorDisplayBaseline,support=mapping&&mapping.supportDisplayBaseline,hasCurrent=finite(supportBaseYmm),hasSupport=support&&finite(support.baseYmm),supportUnknown=hasCurrent&&!hasSupport||!!support&&!hasCurrent,edited=!baseline||key(baseline)!==key(displayGeometry(it))||!!(mapping&&mapping.catalogueDisplay&&key(mapping.source)!==mapping.sourceSnapshot)||!!(hasCurrent&&hasSupport&&Math.abs(supportBaseYmm-support.baseYmm)>1e-6);return {edited:edited,supportUnknown:supportUnknown,status:edited?'edited-or-unverified':supportUnknown?'support-unverified':'reviewed-display-baseline',message:(edited?'取り込み後に配置・向き・外形・表示色・支持床を変更したか、当初の記録を確認できません。元記号との一致は再確認が必要です。 ':'元記号の外形へ対応付けた既存モデルの表示設定を保持しています。 ')+(supportUnknown?'現在の支持床の高さは当初の記録と比較できません。 ':!support?'支持床の高さの比較記録はありません。 ':'')+(mapping&&mapping.assumptions||[]).map(a=>a.field+'='+a.value+' は未測定の表示仮定。').join(' ')+' 製品・高さ・実物材質・施工納まりを確認したものではありません。'};}

 return {candidates:candidates,map:map,displayGeometry:displayGeometry,currentStatus:currentStatus,initialTranslation:initialTranslation,captureSupportBaseline:captureSupportBaseline};
});
