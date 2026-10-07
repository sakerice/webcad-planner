/* Local review-file and evidence navigation adapters. Existing compilers/renderers own all geometry. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(null);else root.SceneReviewFlow=factory(root);}(typeof self!=='undefined'?self:this,function(root){
 'use strict';
 var FORMAT='webcad-source-review',LIMIT=8*1024*1024,readVersion=0,referenceVersion=0,reference=null,interactionVersion=0;
 // UTF-8 bytes, including surrogate pairs/replacement bytes, without allocating another buffer.
 function byteLength(text){var n=0;for(var i=0;i<text.length;i++){var c=text.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=55296&&c<=56319&&i+1<text.length&&text.charCodeAt(i+1)>=56320&&text.charCodeAt(i+1)<=57343){n+=4;i++;}else n+=3;}return n;}
 function rawScene(extraction){if(!extraction||typeof extraction.rawResponse!=='string')return null;try{var v=JSON.parse(extraction.rawResponse);return v&&v.sceneIR||(v&&v.sceneVersion!==undefined?v:null);}catch(_){return null;}}
 function clone(v){return JSON.parse(JSON.stringify(v));}
 function isReviewData(v){return !!v&&typeof v==='object'&&!(Array.isArray(v.walls)&&Array.isArray(v.rooms)&&Array.isArray(v.items))&&(v.sceneVersion!==undefined||!!v.sceneIR||!!v.sourceLocal||v.format===FORMAT);}
 function options(input){var out={materialization:'bounded-v3',acceptedReviews:[],acceptedReviewGroups:[],reviewedEntities:{},unresolvedDecisions:[]};['bindingDecisions','partialSelection','pageScope','destinationFloor','placementContext','sourceInvalidated'].forEach(function(k){if(input&&input[k]!==undefined)out[k]=clone(input[k]);});return out;}
 function buildingBody(v){var out={sourceLocal:clone(v.sourceLocal),buildingRegistration:clone(v.buildingRegistration||{version:1,floors:[]}),plan:{walls:[],rooms:[],items:[]}};['notes','pages','sourceImageAnnotations','registrationExtraction','originalBuildingRegistration'].forEach(function(k){if(v[k]!==undefined)out[k]=clone(v[k]);});return out;}
 function decode(text){
  if(typeof text!=='string'||text.length>LIMIT||byteLength(text)>LIMIT)throw Error('確認JSONは8MB以下のファイルを選んでください。');
  var v;try{v=JSON.parse(text);}catch(_){throw Error('JSONの構文を読めません。途中で切れていない元の抽出JSONを選び直してください。編集中の案は変更しません。');}
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('抽出結果のJSONオブジェクトが必要です。');
  if(v.format===FORMAT&&v.version!==1&&v.version!==2)throw Error('この確認メモの版は未対応です。元の抽出JSONを開いてください。');
  var source=v.sceneIR||(v.sceneVersion!==undefined?v:null);
  if(v.format===FORMAT&&v.version===2){if(v.sceneEncoding!=='raw-response-v1'||v.sceneIR!==undefined||v.sourceLocal!==undefined)throw Error('確認メモの版または原本参照形式が不正です。元の抽出JSONを開いてください。');source=rawScene(v.extraction);if(!source)throw Error('確認メモの原本JSONを読めません。元の抽出JSONを開いてください。');}
  if(source){if(source.sceneVersion!==2&&source.sceneVersion!==3)throw Error('対応する抽出JSONはScene IR v2 / v3です。原本を書き換えずに対応する抽出結果を選んでください。');return {kind:'scene',sceneIR:clone(source),options:options(v.sceneOptions),extraction:v.extraction?clone(v.extraction):{rawResponse:text,kind:'local-json-import',paidCalls:0},referenceInfo:v.referenceInfo||null};}
  if(v.sourceLocal){if(!Array.isArray(v.sourceLocal.floors)||!v.sourceLocal.floors.length)throw Error('複数階のsourceLocal.floorsがありません。統合済みの読み取りJSONを選んでください。');var building=buildingBody(v);if(!building.registrationExtraction)building.registrationExtraction={rawResponse:text,kind:'local-json-import',paidCalls:0};return {kind:'building',sourceLocal:building.sourceLocal,buildingRegistration:building.buildingRegistration,body:building,referenceInfo:v.referenceInfo||null};}
  if(Array.isArray(v.walls)&&Array.isArray(v.rooms)&&Array.isArray(v.items))throw Error('これは保存した間取りJSONです。上部の通常の「JSON読込」で開くと、編集を再開できます。');
  if(Array.isArray(v.pages)||Array.isArray(v.floors))throw Error('ページ別rawはここでは統合しません。元のrawを保持し、sourceLocalを含む統合済み結果を選んでください。再読み取りやAI実行は不要です。');
  throw Error('抽出結果を見つけられません。Scene IR v2 / v3、sourceLocalを含む結果、または保存した確認メモを選んでください。');
 }
 function packet(body,ref){
  if(!body||!body.sceneIR&&!body.sourceLocal)throw Error('先に抽出JSONか保存した根拠を開いてください。');
  var out={format:FORMAT,version:1,notice:'Original source and separate choices only. All approvals require fresh review on resume. No image bytes, target plan or automatic AI request.',referenceInfo:ref?{name:ref.name,pages:ref.pages.length,association:'user-selected-reference-not-verified'}:null};
  if(body.sceneIR){out.sceneIR=clone(body.sceneIR);out.sceneOptions=options(body.sceneOptions);out.extraction=body.extraction?clone(body.extraction):null;}
  else {var building=buildingBody(body);delete building.plan;Object.keys(building).forEach(function(k){out[k]=building[k];});}
  if(byteLength(JSON.stringify(out))<=LIMIT)return out;
  // v2 stores the exact raw once only when it losslessly reconstructs this source.
  // Never substitute unrelated extraction text for a changed source object.
  if(out.sceneIR&&JSON.stringify(rawScene(out.extraction))===JSON.stringify(out.sceneIR)){
   delete out.sceneIR;out.version=2;out.sceneEncoding='raw-response-v1';
   if(byteLength(JSON.stringify(out))<=LIMIT)return out;
  }
  throw Error('原本を保持した確認メモが8MBを超えるため、書き出していません。元の抽出JSONを保管してください。現在の案・確認中の入力は変更していません。');
 }
 var names={hostWallId:'対応する壁',mechanism:'開閉方式',adjacentRoomIds:'隣接する部屋',travelDirection:'引く方向',travelDistanceMm:'引く距離',pocketRegion:'引込み先の範囲',pivot:'蝶番の位置',leafWidthMm:'扉1枚の幅',relativeToId:'段差の基準となる部屋',offsetMm:'基準からの高低差',floor:'図面の階数',shape:'部屋の範囲',heightMm:'高さ'};
 function guidance(d){var field=d.path&&d.path.split('.').pop(),label=names[field]||field||'対象の値';
  if(d.code==='mapping_unresolved'||d.code==='appearance_mapping_required')return '次の操作: この項目の「対応付ける」でモデル・寸法の扱い・図面の見た目を選びます。候補なしの場合は下の拒否理由を確認してください。選択だけでは取り込まれません。';
  if(d.code==='unknown_required_geometry')return '不足: '+label+'。原図の該当箇所と出典を確認してください。原図でも不明なら推定値で埋めず、この項目を未解決として残し、確認できる部分だけを新しい案で開いてください。';
  if(d.code==='wrong_adjacent_room'||d.code==='invalid_opening_host')return '要照合: 開口の端点・対応する壁・隣接部屋の境界が一致していません。原図と根拠欄を見比べてください。向きの反転やモデル選択だけでは解決しません。';
  if(/stair/.test(d.code))return '未対応: 階段の記号だけでは段高・上下階の接続・床の開口を確定できません。根拠を残し、階段を除く部分を確認してください。表示用の階段は接続の実測ではありません。';
  if(d.code==='unsupported_opening_mechanism')return '未対応: この開閉方式の物理的な動きを、この取込経路ではまだ検証できません。引く方向や距離を既定値で成功扱いにせず、開口を未解決として残します。';
  if(d.code==='missing_traversable_connection')return '先に確認: つながる2部屋の間の開口が未解決です。対応する開口のエラーを確認してください。接続の採用チェックだけでは通路は作れません。';
  if(/stale|invalidated/.test(d.code))return '確認をやり直す: 原図・切り出し・対応付け・編集先のいずれかが変わっています。保存した根拠を開き直し、現在の条件で再確認してください。元の案へは自動適用しません。';
  if(/asset_|appearance_channels/.test(d.code))return '対応付けを確認: 元の種類・外形・向き・色を保持できる候補を選んでください。合う候補がなければ未解決のまま残します。元の数値を候補に合わせて変更しません。';
  return 'この項目の根拠と診断詳細を確認してください。値の意味が確定しない場合は未解決のまま残し、確認できる部分から進めます。';
 }
 function el(tag,text){var e=root.document.createElement(tag);if(text)e.textContent=text;return e;}
 function status(text){var e=root.document.getElementById('scene-review-file-status');if(e)e.textContent=text;var visible=root.document.getElementById('plan-import-status');if(visible)visible.textContent=text?text.split('。')[0]+'。':'';}
 function currentBody(){return root.PlanImport.state.result;}
 function usable(){var s=root.PlanImport.state;return !s.busy&&!s.mappingEditor;}
 function reviewInteraction(){interactionVersion++;}
 function interactionEpoch(){return interactionVersion;}
 function invalidate(opts){readVersion++;referenceVersion++;interactionVersion++;if(!opts||!opts.preserveReference){reference=null;renderReference();}}
 function capture(){return reference?clone(reference):null;}
 function restore(saved){invalidate();reference=saved?clone(saved):null;renderReference();}
 function clearApprovals(body){if(body&&body.sceneIR){var opts=options(body.sceneOptions);opts.extraction=body.extraction;root.PlanImport.stageSceneIR(body.sceneIR,opts);}else if(body&&body.sourceLocal){root.PlanImport.stageBuildingReview(buildingBody(body));}}
 function importText(text){
  if(!usable())throw Error('処理中または対応付けの編集中です。先に確定か取消をしてください。');
  var parsed=decode(text),s=root.PlanImport.state;
  if(parsed.kind==='scene'){var check=root.PlanImport.previewSceneIR(parsed.sceneIR,parsed.options);if(check.valid===false)throw Error('抽出JSONの項目が不正です: '+check.diagnostics.filter(function(d){return d.severity==='error';}).slice(0,3).map(function(d){return d.path+' — '+d.message;}).join(' / '));}
  if(parsed.kind==='building'){try{root.PlanRegistration.compile(parsed.sourceLocal,{proposals:parsed.buildingRegistration});}catch(e){throw Error('複数階JSONの構造を読めません。sourceLocalを含む統合済み結果を選び直してください。確認中の結果は変更しません。');}}
  if(!reference&&s.pages&&s.pages.length)reference={name:s.fileName||'選択中のPDF',pages:s.pageReview?s.pageReview.map(function(p){return p.source;}):s.pages.slice(),index:s.selectedPage||0};
  if(!reference&&s.image&&s.image.src)reference={name:s.fileName||'選択中の画像',pages:[s.image.src],index:0};
  if(parsed.kind==='scene'){
   // The real validator/compiler provides all shape, field and binding errors.
   parsed.options.extraction=parsed.extraction;
   root.PlanImport.stageSceneIR(parsed.sceneIR,parsed.options);
  }else root.PlanImport.stageBuildingReview(parsed.body);
  root.document.getElementById('plan-import-modal').classList.add('show');
  var fileBox=root.document.getElementById('scene-review-files');if(fileBox)fileBox.open=false;
  status('原本を開きました。Scene IRの対応付け／複数階の対応点は保持します。採用チェックと複数階の部材・表示選択は再確認が必要です。AIは実行していません。'+(parsed.referenceInfo?' 照合画像「'+parsed.referenceInfo.name+'」は保存していません。必要なら選び直してください。':''));
  render(currentBody());return currentBody();
 }
 function readFile(input){var file=input.files&&input.files[0];input.value='';if(!file)return;var owner=root.PlanImport.captureContext?root.PlanImport.captureContext(false):null,token=++readVersion,version=root.PlanImport.state.version,body=currentBody(),request=root.PlanImport.state.requestVersion,operation=interactionVersion;if(file.size>LIMIT){status('確認JSONは8MB以下のファイルを選んでください。');if(owner)owner.done();return;}
  file.text().then(function(text){if(owner&&!owner.isCurrent()||token!==readVersion||version!==root.PlanImport.state.version||body!==currentBody()||request!==root.PlanImport.state.requestVersion)return;if(operation!==interactionVersion){status('読込中に確認操作が変わりました。確認JSONを選び直してください。');return;}try{importText(text);}catch(e){status(e.message);}}).catch(function(){if((!owner||owner.isCurrent())&&token===readVersion&&version===root.PlanImport.state.version&&body===currentBody()&&request===root.PlanImport.state.requestVersion&&operation===interactionVersion)status('ファイルを読めませんでした。元の案と確認中の結果は変更していません。');}).then(function(){if(owner)owner.done();});
 }
 function attach(input){
  var file=input.files&&input.files[0];input.value='';if(!file)return;
  var owner=root.PlanImport.captureContext?root.PlanImport.captureContext(false):null,s=root.PlanImport.state,body=currentBody(),token=++referenceVersion,version=s.version,operation=interactionVersion,request=s.requestVersion;
  if(!usable()){status('対応付けを確定か取消してから照合画像を選んでください。');if(owner)owner.done();return;}
  if(file.size>32*1024*1024){status('照合用のPDF・画像は32MB以下を選んでください。');if(owner)owner.done();return;}
  // Every asynchronous boundary must still own the same review AND editing operation.
  // Opening/canceling an editor or switching away and back must not revive old work.
  function current(){
   if(owner&&!owner.isCurrent()||token!==referenceVersion||version!==s.version||body!==currentBody())return false;
   if(operation!==interactionVersion||request!==s.requestVersion||!usable()||body&&(body.sceneApplied||body.scenePartialOpened||body.buildingApplied)){
    status('読込中に確認操作が変わったため、照合ファイルは反映していません。編集中の入力は保持しています。対応付けを確定か取消した後、照合ファイルを選び直してください。');return false;
   }
   return true;
  }
  var reader=new FileReader();
  reader.onload=function(e){
   if(!current()){if(owner)owner.done();return;}
   var pdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
   var work=Promise.resolve().then(function(){
    if(!current())return null;
    if(pdf)return root.PdfPages.renderPages(e.target.result,{maxPx:1600});
    return new Promise(function(resolve,reject){var image=new Image();image.onload=function(){resolve([e.target.result]);};image.onerror=function(){reject(Error('画像の形式を確認してください'));};image.src=e.target.result;});
   });
   work.then(function(pages){
    if(!current())return;
    if(!pages||!pages.length)throw Error('ページがありません');
    reference={name:file.name,pages:pages,index:0};clearApprovals(body);render(currentBody());
    status('照合用ファイルを開きました。抽出JSONとの一致は未確認です。画像を変えたため採用チェックを外しました。AIへの送信はありません。');
   }).catch(function(err){if(current())status('照合用ファイルを開けません: '+err.message);}).then(function(){if(owner)owner.done();});
  };
  reader.onerror=function(){if(current())status('照合用ファイルを読めませんでした。');if(owner)owner.done();};
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)||/^image\/(png|jpeg|webp)$/.test(file.type))reader.readAsDataURL(file);else {status('照合用にはPDF / PNG / JPEG / WebPを選んでください。');if(owner)owner.done();}
 }
 function mount(){if(!root||!root.document)return;var host=root.document.getElementById('scene-review-files');if(!host)return;if(!host.firstChild){
  var title=el('summary','保存メモ・JSON');host.appendChild(title);
  var note=el('p','抽出JSONを開き、原図の根拠と候補を確認します。確認途中はファイルへ保存できます。通常の間取りJSONは上部の「JSON読込」で開いてください。');host.appendChild(note);
  var label=el('label','抽出JSON／確認メモ '),input=el('input');input.type='file';input.accept='.json,application/json';input.setAttribute('data-scene-review-file','');input.addEventListener('change',function(){readFile(input);});label.appendChild(input);host.appendChild(label);
  var save=el('button','確認メモをJSONに保存');save.type='button';save.setAttribute('data-scene-review-save','');save.addEventListener('click',function(){try{if(!usable())throw Error('対応付けを確定か取消してから保存してください。');var p=packet(currentBody(),reference);root.downloadJsonFile(JSON.stringify(p),'source-review.json');status('確認メモを書き出しました。原本とScene IRの対応付け／複数階の対応点を保持します。再開時は採用チェックと複数階の部材・表示選択をやり直します。照合画像は含めません。');}catch(e){status(e.message);}});host.appendChild(save);
  var reports=el('div');reports.setAttribute('data-scene-saved-reviews','');host.appendChild(reports);
  var feedback=el('p');feedback.id='scene-review-file-status';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');host.appendChild(feedback);
  var compare=el('details');compare.setAttribute('data-scene-reference','');compare.appendChild(el('summary','原図と見比べる（照合用・AIへの送信なし）'));
  compare.appendChild(el('p','ページを切り替えて対象の根拠と見比べてください。照合用に選んだ画像が抽出元と同じかは、ご自身で確認してください。画像を変えると採用チェックを外します。'));
  var pick=el('input');pick.type='file';pick.accept='application/pdf,image/png,image/jpeg,image/webp';pick.setAttribute('aria-label','照合するPDFか画像');pick.addEventListener('change',function(){attach(pick);});compare.appendChild(pick);
  var select=el('select');select.setAttribute('data-scene-reference-page','');select.setAttribute('aria-label','照合用のページ');select.addEventListener('change',function(){if(reference){reference.index=Number(select.value);renderReference();}});compare.appendChild(select);
  var zoom=el('button','拡大（2倍）');zoom.type='button';zoom.setAttribute('data-scene-reference-zoom','');zoom.addEventListener('click',function(){if(reference){reference.zoom=reference.zoom===2?4:reference.zoom===4?1:2;renderReference();}});compare.appendChild(zoom);
  var viewport=el('div');viewport.setAttribute('data-scene-reference-viewport','');viewport.setAttribute('tabindex','0');viewport.setAttribute('aria-label','原図の拡大表示。拡大時は縦横にスクロールできます');
  var image=el('img');image.setAttribute('data-scene-reference-image','');image.alt='利用者が選んだ照合用の原図（抽出元との一致は未確認）';viewport.appendChild(image);compare.appendChild(viewport);host.appendChild(compare);
 }render(currentBody());}
 function renderReference(){if(!root||!root.document)return;var host=root.document.getElementById('scene-review-files');if(!host)return;var select=host.querySelector('[data-scene-reference-page]'),image=host.querySelector('[data-scene-reference-image]');if(!select||!image)return;var zoom=host.querySelector('[data-scene-reference-zoom]');if(zoom){zoom.disabled=!reference;zoom.textContent=reference&&reference.zoom===4?'全体表示に戻す':reference&&reference.zoom===2?'拡大（4倍）':'拡大（2倍）';}select.textContent='';select.hidden=!reference;image.hidden=!reference;if(!reference){image.removeAttribute('src');return;}reference.pages.forEach(function(_,i){var opt=el('option',(i+1)+'ページ / '+reference.pages.length+' — '+reference.name);opt.value=String(i);select.appendChild(opt);});select.value=String(reference.index);image.src=reference.pages[reference.index];image.style.width=reference.zoom>1?(reference.zoom*100)+'%':'';image.style.maxWidth=reference.zoom>1?'none':'';image.style.maxHeight=reference.zoom>1?'none':'';host.querySelector('[data-scene-reference]').open=true;}
 function render(body){if(!root||!root.document)return;var host=root.document.getElementById('scene-review-files');if(!host||!host.firstChild)return;var save=host.querySelector('[data-scene-review-save]');if(save)save.disabled=!body||!body.sceneIR&&!body.sourceLocal||!usable();var list=host.querySelector('[data-scene-saved-reviews]');if(list){list.textContent='';((root.DATA&&root.DATA.sceneReconstructionReports)||[]).forEach(function(report,i){if(!report.originalIR&&!report.sourceLocal)return;var button=el('button','保存した根拠 '+(i+1)+' を再確認');button.type='button';button.setAttribute('data-scene-resume-report',String(i));button.addEventListener('click',function(){if(!usable())return;try{var payload=report.originalIR?{sceneIR:report.originalIR,sceneOptions:report.reviewDecisions||{},extraction:report.extraction}:{sourceLocal:report.sourceLocal,buildingRegistration:report.proposals||report.registrationProposals||report.buildingRegistration||{version:1,floors:[]},originalBuildingRegistration:report.originalProposals||null,notes:report.sourceNotes||[],pages:report.sourceReadings||null,sourceImageAnnotations:report.sourceImageAnnotations||[],registrationExtraction:report.registrationExtraction||null};importText(JSON.stringify(packet(payload)));status('保存した原本を再確認しています。配置後の手動編集は原本へ逆反映しません。現在の案は変更せず、採用チェックをやり直してください。');}catch(e){status(e.message);}});list.appendChild(button);});}renderReference();}
 function enhance(body,box){if(!root||!box)return;var full=body.sceneFullCompilation||body.sceneCompilation,errors=full.diagnostics.filter(function(d){return d.severity==='error';}),groups=Array.prototype.slice.call(box.querySelectorAll('[data-scene-group]'));
  function focus(groupId){if(currentBody()!==body||!usable())return;if(root.PlanImport.focusSceneReviewGroup)return root.PlanImport.focusSceneReviewGroup(groupId);var target=groups.find(function(g){return g.getAttribute('data-scene-group')===groupId;})||box;target.hidden=false;if(target!==box)target.open=true;var title=target.querySelector('summary')||target;title.setAttribute('tabindex','-1');if(title.focus)title.focus();if(target.scrollIntoView)target.scrollIntoView({block:'start'});}
  var titles={mapping_unresolved:'モデルの対応付け',appearance_mapping_required:'色・模様の対応付け',unsupported_stair_reconstruction:'階段の接続が未確定',unsupported_stair_room_floor:'階段室の床・開口が未確定',unsupported_opening_mechanism:'開閉方式が未対応',missing_traversable_connection:'通路の開口が未解決',wrong_adjacent_room:'開口と部屋境界の不一致',asset_semantic_type:'モデルの種類が不一致'};
  var nav=el('details');nav.setAttribute('data-scene-next-steps','');nav.appendChild(el('summary','未解決箇所（'+errors.length+'）'));nav.appendChild(el('p','箇所を選ぶと、不足情報と次の操作を表示します。未対応の項目は確認しても取り込めません。'));
  errors.forEach(function(d){var g=full.reviewGroups.find(function(g){return d.path===g.path||(d.path||'').indexOf(g.path+'.')===0;}),button=el('button',(g?g.label+' — ':'')+(names[(d.path||'').split('.').pop()]||titles[d.code]||d.code));button.type='button';button.setAttribute('data-scene-error-focus',d.path||'');button.setAttribute('data-scene-review-control','');button.addEventListener('click',function(){focus(g&&g.id);});nav.appendChild(button);});
  if(errors.length===0)nav.appendChild(el('p','エラーはありません。推定値・表示仮定の採用チェックと、原図全体が未完成かどうかを続けて確認してください。'));
  var audit=box.querySelector('[data-scene-full-status]');if(audit&&audit.parentNode) audit.parentNode.appendChild(nav);else box.appendChild(nav);
  groups.forEach(function(node){var g=full.reviewGroups.find(function(g){return g.id===node.getAttribute('data-scene-group');});if(!g)return;var source=g.collection==='objects'&&body.sceneIR.objects.find(function(o){return o.id===g.entityId;});var messages=[];if(source&&source.objectType&&source.objectType.value==='kitchen-sink')messages.push('表示限界: シンク単体の外形・向きの候補です。取付高さ・支持する天板・天板の切欠き・配管接続は未確認です。既定高さで見えても設置の再現完了ではありません。');g.diagnostics.filter(function(d){return d.severity==='error';}).forEach(function(d){var text=guidance(d);if(messages.indexOf(text)<0)messages.push(text);});if(messages.length){var advice=el('div');advice.setAttribute('data-scene-guidance',g.id);messages.forEach(function(t){advice.appendChild(el('p',t));});node.insertBefore(advice,node.children[1]||null);}});
 }
 return {format:FORMAT,maxFileBytes:LIMIT,byteLength:byteLength,isReviewData:isReviewData,decode:decode,packet:packet,guidance:guidance,mount:mount,render:render,enhance:enhance,importText:importText,capture:capture,restore:restore,invalidate:invalidate,reviewInteraction:reviewInteraction,interactionEpoch:interactionEpoch};
}));
