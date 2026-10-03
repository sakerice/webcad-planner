// Reader-frame intent -> strict native wall-frame parameters. No AI calls.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./scene-opening-geometry.js'));else root.SourceOpeningReview=factory(root.SceneOpeningGeometry);}(typeof self!=='undefined'?self:this,function(G){
 'use strict';
 const clone=o=>JSON.parse(JSON.stringify(o)),snapshot=o=>JSON.stringify(o);
 const swing=['door-swing','door-swing-s','door-front'],slide=['door-slide-s','door-pocket','door-slide'];
 function isMoving(type){return swing.includes(type)||slide.includes(type);}
 function isDoor(type){return /^door-/.test(type||'');}
 function diagnostic(code,message){return {code,message};}
 function compile(reading,native,walls,otherItems){
  const review=reading.sourceOpeningReview;
  const known=typeof reading.flipX==='boolean'&&typeof reading.flipY==='boolean';
  if(!isMoving(reading.type))return {ok:false,diagnostics:[diagnostic('unsupported-reader-door-mechanism','この建具の可動範囲は未対応です。種類・向きを推測して置き換えません。')]};
  if(!known&&!review)return {ok:false,diagnostics:[diagnostic('unknown-reader-door-direction','元の読み取りに吊元・開く側／引き込む側がありません。表示既定値は図面の向きとして未確認です。')]};
  const intent=review||reading;
  if(typeof intent.flipX!=='boolean'||typeof intent.flipY!=='boolean'||review&&(!review.reviewed||typeof review.evidence!=='string'||!review.evidence.trim()))return {ok:false,diagnostics:[diagnostic('invalid-reader-door-review','向きと図面上の根拠を明示してください。')]};
  const center={x:reading.x,y:reading.y},a=reading.rot*Math.PI/180,u={x:Math.cos(a),y:Math.sin(a)},n={x:-u.y,y:u.x};
  if(![center.x,center.y,reading.w,reading.rot].every(Number.isFinite)||reading.w<=0)return {ok:false,diagnostics:[diagnostic('invalid-reader-door-pose','位置・幅・向きが有限数ではありません。')]};
  const hosts=walls.filter(w=>{if((w.floor||1)!==(reading.floor||1))return false;const dx=w.x2-w.x1,dy=w.y2-w.y1,len=Math.hypot(dx,dy);if(!len)return false;const off=Math.abs((center.x-w.x1)*dy-(center.y-w.y1)*dx)/len,t=((center.x-w.x1)*dx+(center.y-w.y1)*dy)/(len*len);return off<1e-6&&t>=0&&t<=1&&Math.abs(u.x*dy-u.y*dx)/len<1e-6;});
  if(hosts.length!==1)return {ok:false,diagnostics:[diagnostic(hosts.length?'ambiguous-reader-door-host':'unresolved-reader-door-host','元の中心・向きに一致する支持壁を一意に確認できません。近い壁へ移動・端点で丸めません。')]};
  const half=reading.w/2,spec={id:native.id,floor:reading.floor,kind:reading.type,hostWallId:hosts[0].id,center,widthMm:reading.w,depthMm:reading.d,rotationDeg:reading.rot};
  if(swing.includes(reading.type)){
   const sign=intent.flipX?-1:1,hingeSign=-sign,side=sign*(intent.flipY?-1:1);
   spec.hinge={x:center.x+u.x*half*hingeSign,y:center.y+u.y*half*hingeSign};spec.latch={x:center.x-u.x*half*hingeSign,y:center.y-u.y*half*hingeSign};spec.swingSide={x:n.x*side,y:n.y*side};
  }else{
   const dir=reading.type==='door-slide'?(intent.flipX?1:-1):(intent.flipX?-1:1);
   spec.travelDirection={x:u.x*dir,y:u.y*dir};spec.wallFace=reading.type==='door-pocket'?'center':{x:n.x*(intent.flipY?1:-1),y:n.y*(intent.flipY?1:-1)};
  }
  const result=G.compileOpening(spec,walls,otherItems||[]);
  return Object.assign(result,{spec,sourceIntent:clone(intent),sourceReading:snapshot(reading)});
 }
 function bind(readings,plan,options){
  // toAppObjects owns its newly materialized output; other callers stay pure.
  const out=options&&options.ownedOutput===true?plan:clone(plan),reports=[];
  readings.forEach((reading,index)=>{
   if(!isDoor(reading.type)||reading.type==='door-opening')return;const it=out.items[index];
   if(!it||it.type!==reading.type)throw Error('建具と読み取りの対応が変わりました。適用しません。');
   const result=compile(reading,it,out.walls,out.items.filter(o=>o!==it));
   const report={status:result.ok?'source-direction-derived':'unresolved',sourceReading:reading.sourceOpeningReference&&reading.sourceOpeningReference.originalSnapshot||snapshot(reading),sourceReference:reading.sourceOpeningReference?clone(reading.sourceOpeningReference):null,registeredReading:snapshot(reading),sourceAxisDeg:reading.rot,sourceIntent:result.sourceIntent||null,diagnostics:clone(result.diagnostics),geometry:result.geometry?clone(result.geometry):null,displayAssumptions:'既存モデルの扉厚・引き残し・枠寸法。図面の実測寸法ではありません。'};
   it.sourceOpeningMapping=report;reports.push({itemId:it.id,...report});
   if(reading.sourceOpeningReview&&!result.ok)throw Error('建具 '+index+': '+result.diagnostics.map(d=>d.message).join(' / '));
   if(result.ok){Object.assign(it,{flipX:result.item.flipX,flipY:result.item.flipY,openingHostWallId:result.item.openingHostWallId,rot:result.item.rot});}
   report.importedDisplayGeometry=displayGeometry(it);
   // An unresolved default remains visible for review; never auto-reverse it.
  });
  return {plan:out,reports};
 }
 function displayGeometry(it){return Object.fromEntries(['type','floor','x','y','w','d','rot','flipX','flipY','openingHostWallId','openingModel'].map(k=>[k,it[k]===undefined?null:it[k]]));}
 function initialTranslation(plan,dx){
  for(const it of plan.items||[]){const mapping=it.sourceOpeningMapping;if(!mapping)continue;const before=displayGeometry(it);before.x-=dx;
   const baseline=mapping.importedDisplayGeometry;if(baseline&&Math.abs(before.x-baseline.x)<1e-6)before.x=baseline.x;
   if(mapping.displayTranslation||snapshot(before)!==snapshot(baseline))throw Error('建具の初期配置が変わりました。来歴を上書きしません。');
   mapping.registrationDisplayGeometry=clone(mapping.importedDisplayGeometry);mapping.importedDisplayGeometry=displayGeometry(it);mapping.displayTranslation={x:dx,y:0};
  }
 }
 function applyImageDirections(plan,annotations){
  const out=clone(plan),reviews=[],entries=annotations||[],counts=new Map();
  const key=a=>snapshot([a.originalSnapshot,a.sourcePageId]);
  for(const a of entries)counts.set(key(a),(counts.get(key(a))||0)+1);
  const failures=entries.map(a=>{
   if(counts.get(key(a))!==1)return diagnostic('duplicate-image-door-annotation','同じ原本の建具に複数の画像判断があります。新しい一意のレビューが必要です。');
   const matches=(out.items||[]).filter(it=>it.sourceOpeningMapping&&it.sourceOpeningMapping.sourceReading===a.originalSnapshot&&it.sourceOpeningMapping.sourceReference&&it.sourceOpeningMapping.sourceReference.sourcePageId===a.sourcePageId);
   if(matches.length!==1)return diagnostic('ambiguous-image-door-source','画像の判断と原本の建具を一意に対応付けられません。');
   const it=matches[0],m=it.sourceOpeningMapping;
   if(snapshot(displayGeometry(it))!==snapshot(m.importedDisplayGeometry))return diagnostic('edited-image-door-target','取り込み後に建具が編集されています。古い画像判断は再適用しません。現在の配置で明示的な再レビューが必要です。');
   try{
    const r=JSON.parse(m.registeredReading),s=JSON.parse(m.sourceReading),ref=m.sourceReference,pose=ref.registrationPose||{quarterTurns:0,dx:0,dy:0},translation=m.displayTranslation||{x:0,y:0},angle=pose.quarterTurns*Math.PI/2;
    const x=s.x*Math.cos(angle)-s.y*Math.sin(angle)+pose.dx,y=s.x*Math.sin(angle)+s.y*Math.cos(angle)+pose.dy,rot=s.rot+pose.quarterTurns*90;
    if(ref.originalSnapshot!==m.sourceReading||![x,y,rot,r.x,r.y,r.rot,translation.x,translation.y].every(Number.isFinite)||Math.hypot(r.x-x,r.y-y)>1e-6||Math.abs(r.rot-rot)>1e-6||['type','floor','w','d'].some(k=>r[k]!==s[k]||r[k]!==it[k])||Math.hypot(it.x+it.w/2-r.x-translation.x,it.y+it.d/2-r.y-translation.y)>1e-6)throw Error('frame changed');
   }catch(_){return diagnostic('stale-image-door-frame','原本・位置合わせ・現在の配置の対応が変わっています。画像判断を適用せず、再レビューを要求します。');}
   return null;
  });
  // A stale or duplicate batch is rejected before touching geometry or metadata.
  if(failures.some(Boolean))return {plan:out,reviews:entries.map((a,i)=>({sourceItemIndex:a.sourceItemIndex,sourcePageId:a.sourcePageId,applied:false,diagnostics:[failures[i]||diagnostic('image-door-batch-cancelled','同じ適用内に失効した判断があるため、全体を変更せず保持しました。')]}))};
  for(const annotation of entries){
   const matches=(out.items||[]).filter(it=>it.sourceOpeningMapping&&it.sourceOpeningMapping.sourceReading===annotation.originalSnapshot&&it.sourceOpeningMapping.sourceReference&&it.sourceOpeningMapping.sourceReference.sourcePageId===annotation.sourcePageId);
   const review={sourceItemIndex:annotation.sourceItemIndex,sourcePageId:annotation.sourcePageId,applied:false,diagnostics:[]};reviews.push(review);
   if(matches.length!==1){review.diagnostics.push(diagnostic('ambiguous-image-door-source','画像の判断と原本の建具を一意に対応付けられません。'));continue;}
   const it=matches[0],mapping=it.sourceOpeningMapping;mapping.imageObservation=clone(annotation);
   if(!annotation.reviewed){review.diagnostics.push(diagnostic('image-door-intent-unknown',annotation.reason||'元画像の向き・機構を確定できません。'));continue;}
   if(!swing.includes(annotation.observedKind)||annotation.observedKind!==it.type){review.diagnostics.push(diagnostic('unsupported-image-door-mechanism','図面で確認した機構に対応する厳密な表示がありません。元の下書きを保持します。'));continue;}
   if(!['axis-low','axis-high'].includes(annotation.hingeSide)||!['normal-low','normal-high'].includes(annotation.openSide)||typeof annotation.evidence!=='string'||!annotation.evidence.trim()){review.diagnostics.push(diagnostic('incomplete-image-door-evidence','吊元・開く側・画像上の根拠が不足しています。'));continue;}
   const registered=JSON.parse(mapping.registeredReading);if(mapping.displayTranslation){registered.x+=mapping.displayTranslation.x;registered.y+=mapping.displayTranslation.y;}const flipX=annotation.hingeSide==='axis-high',sign=flipX?-1:1,flipY=(annotation.openSide==='normal-high'?1:-1)*sign<0;
   const decision={reviewed:true,flipX,flipY,evidence:annotation.evidence},result=compile({...registered,sourceOpeningReview:decision},it,out.walls,out.items.filter(o=>o!==it)),p=result.geometry&&result.geometry.parameters;
   if(!p||p.mode!=='hinge'){review.diagnostics.push(...result.diagnostics);continue;}
   // Direction evidence may be clear while the reader's position/width still
   // collides. Preserve those diagnostics; never move/resize/clamp to hide them.
   const host=out.walls.find(w=>w.id===result.spec.hostWallId);
   Object.assign(it,{flipX:p.leafCenterXmm<0,flipY:p.openAngleY>0,rot:Math.atan2(host.y2-host.y1,host.x2-host.x1)*180/Math.PI,openingHostWallId:host.id});
   recordEditorSetting(it,'flipX',it.flipX,out.walls);recordEditorSetting(it,'flipY',it.flipY,out.walls);
   mapping.imageReview={kind:'manual-source-image-direction-review',originalSnapshot:annotation.originalSnapshot,sourcePageId:annotation.sourcePageId,evidence:annotation.evidence,region:clone(annotation.region||null),reviewedDisplayGeometry:displayGeometry(it),direction:clone(decision),physicalValidation:result.ok?'native-envelope-pass':'reader-geometry-unresolved',diagnostics:clone(result.diagnostics),dimensions:'元の読み取り寸法を保持。実図面の開口幅・位置・高さを実測したものではありません。'};
   review.applied=true;review.physicalValidation=mapping.imageReview.physicalValidation;review.diagnostics=clone(result.diagnostics);
  }
  return {plan:out,reviews};
 }
 function recordEditorSetting(it,field,value,walls){
  if(!it||!it.sourceOpeningMapping||!['flipX','flipY','x','y','w','d','rot','floor','type'].includes(field))return;
  const mapping=it.sourceOpeningMapping,settings=mapping.editorSettings||(mapping.editorSettings={});
  settings[field]={value:clone(value),source:'existing-native-editor-setting',sourceReading:mapping.sourceReading};
  mapping.currentDisplayGeometry=displayGeometry(it);
 }
 function diagnosticMessage(d){const messages={
  'opening-sweep-collision':'開閉途中のパネルが別の壁と干渉します。',
  'insufficient-slider-backing':'全開時のパネルを支持する壁が連続していません。',
  'insufficient-slider-envelope':'開閉途中のパネル外形が支持壁の範囲を越えます。',
  'source-swing-host-collision':'吊元の周囲で扉が支持壁へ入り込んでいます。',
  'unsupported-bypass-face':'この引き違い戸モデルは指定された可動側へ対応していません。',
  'opening-outside-host':'開口幅が支持壁の端からはみ出しています。',
  'closed-slider-outside-support':'閉状態のパネルが支持壁の端からはみ出しています。'
 };return messages[d.code]||d.message;}
 function currentStatus(it,walls,items,nativeInfo){
  const mapping=it.sourceOpeningMapping,settings=mapping.editorSettings||{};let source;try{source=JSON.parse(mapping.sourceReading);if(!source||typeof source!=='object')throw Error('invalid source');}catch(_){return {status:'unknown-provenance',message:'元の読み取り記録を確認できません。現在の向き・配置を図面由来として保証できません。'};}
  const sourceKnown=typeof source.flipX==='boolean'&&typeof source.flipY==='boolean';
  const explicitlySet=!!(settings.flipX&&settings.flipY),edited=snapshot(displayGeometry(it))!==snapshot(mapping.importedDisplayGeometry);
  const reading={type:it.type,floor:it.floor,x:it.x+it.w/2,y:it.y+it.d/2,w:it.w,d:it.d,rot:nativeInfo?nativeInfo.rot:it.rot,flipX:!!it.flipX,flipY:!!it.flipY};
  const current=compile(reading,it,walls,(items||[]).filter(o=>o!==it));
  if(nativeInfo&&Math.hypot(nativeInfo.x-reading.x,nativeInfo.y-reading.y)>1e-6){current.ok=false;current.diagnostics.push(diagnostic('legacy-display-projection','現在の3Dは近い壁へ寄せた表示です。元の中心は保持していますが、図面の位置との一致は未確認です。'));}
  const imageReview=mapping.imageReview,imageCurrent=!!(imageReview&&imageReview.kind==='manual-source-image-direction-review'&&imageReview.originalSnapshot===mapping.sourceReading&&snapshot(imageReview.reviewedDisplayGeometry)===snapshot(displayGeometry(it)));
  const status=imageCurrent?'source-image-direction-reviewed':imageReview?'source-image-review-edited':explicitlySet?'editor-direction-set':edited?'edited-unvalidated':sourceKnown&&mapping.status==='source-direction-derived'?'source-direction-derived':'source-direction-unknown';
  let message=sourceKnown?'元の読み取りに向きの指定があります。原本の符号を保持し、壁の向きに対応付けた表示です。 ':'元の読み取りには向きの情報がありません。読取段階では吊元・開く側／引く側は未確認です。 ';
  if(explicitlySet&&!imageCurrent&&!imageReview)message+='既存の扉設定で両方向を明示しています。図面との一致は利用者による確認が必要です。 ';
  else if(edited&&!imageReview)message+='取り込み後に編集しています。当初の検証は現在の配置を保証しません。 ';
  if(imageCurrent)message+='画像の扉線・円弧を手動確認した方向設定です。'+imageReview.evidence+' '+imageReview.dimensions+' ';
  else if(imageReview)message+='画像確認後に配置・向き・モデルを変更しています。以前の画像確認を現在の表示へ引き継いで保証しません。 ';
  else if(mapping.imageObservation)message+='画像の判断: '+(mapping.imageObservation.reason||'方向・機構が未確認です。')+' ';
  message+=it.openingModel?'選択した3Dモデルの厚み・金物・可動範囲はこの検査で検証していません。 ':current.ok?'現在の設定は既存モデルの可動範囲と支持壁の検査を通過しています。実測寸法・施工納まりの保証ではありません。 ':[...new Set(current.diagnostics.map(d=>diagnosticMessage(d)))].join(' / ')+' ';
  if(it.type==='door-pocket'&&!it.openingSourceGeometry)message+='戸袋の内部空洞は元図面で未確認です。壁に隠れることを収まりの成功とは扱いません。 ';
  message+=mapping.displayAssumptions;
  return {status,edited,sourceKnown,explicitlySet,imageCurrent,current,message};
 }
 function slidingBacking(it,dir,info,walls,items,getInfo){
  if(!info||!info.wall)return null;
  const host=info.wall,dx=host.x2-host.x1,dy=host.y2-host.y1,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
  const projected=(x,y)=>(x-host.x1)*ux+(y-host.y1)*uy,off=(x,y)=>Math.abs(-(x-host.x1)*uy+(y-host.y1)*ux);
  const parameters=G.rendererParameters({...it,flipX:dir<0},host.thick),s=projected(info.x,info.y),half=parameters.leafWidthMm/2;
  const a=s+Math.min(parameters.closedXmm,parameters.openXmm)-half,b=s+Math.max(parameters.closedXmm,parameters.openXmm)+half;
  const cut=G.wallCutWidthMm(it,len)/2;
  function merge(list){const out=[];for(const q of list.slice().sort((a,b)=>a[0]-b[0])){const p=out[out.length-1];if(p&&q[0]<=p[1]+1e-6)p[1]=Math.max(p[1],q[1]);else out.push(q.slice());}return out;}
  function subtract(available,holes){let result=merge(available);for(const h of merge(holes)){const next=[];for(const q of result){if(h[1]<=q[0]||h[0]>=q[1])next.push(q);else{if(h[0]>q[0])next.push([q[0],h[0]]);if(h[1]<q[1])next.push([h[1],q[1]]);}}result=next;}return result;}
  const required=subtract([[a,b]],[[s-cut,s+cut]]),cover=[],holes=[];
  for(const w of walls){const wx=w.x2-w.x1,wy=w.y2-w.y1,wl=Math.hypot(wx,wy);if((w.floor||1)!==(it.floor||1)||!wl||Math.abs(wx*uy-wy*ux)/wl>1e-6||off(w.x1,w.y1)>1e-6||off(w.x2,w.y2)>1e-6)continue;if(it.type==='door-pocket'?w.thick<parameters.leafThicknessMm:Math.abs(w.thick-host.thick)>1e-6)continue;const ends=[projected(w.x1,w.y1),projected(w.x2,w.y2)].sort((a,b)=>a-b);cover.push(ends);}
  for(const other of items){if(other===it||(other.floor||1)!==(it.floor||1))continue;const oi=getInfo(other);if(!oi||!oi.wall||off(oi.x,oi.y)>1e-6)continue;const ow=oi.wall,olen=Math.hypot(ow.x2-ow.x1,ow.y2-ow.y1),c=projected(oi.x,oi.y),h=G.wallCutWidthMm(other,olen)/2;holes.push([c-h,c+h]);}
  const missing=subtract(required,subtract(cover,holes)),length=qs=>qs.reduce((v,q)=>v+q[1]-q[0],0),need=length(required),missingMm=length(missing),reach=dir>0?b:a;
  const extendable=missing.length>0&&missing.every(q=>dir>0?q[0]>=len-1e-6:q[1]<=1e-6)&&!holes.some(q=>q[1]>a&&q[0]<b);
  return {dir,needMm:need,haveMm:need-missingMm,missingMm,wall:host,reachMm:reach,hostEnd:dir>0?len:0,extendable,ux,uy,requiredIntervalsMm:required,missingIntervalsMm:missing,leafWidthMm:parameters.leafWidthMm,travelMm:Math.abs(parameters.openXmm-parameters.closedXmm),evaluation:'exact-native-panel-envelope'};
 }
 return {compile,bind,isMoving,isDoor,snapshot,currentStatus,recordEditorSetting,displayGeometry,slidingBacking,initialTranslation,applyImageDirections};
}));
