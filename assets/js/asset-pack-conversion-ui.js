/* Pane-local object-set controls. Reuse the catalogue, conversion review,
 * comparison capture, native edit transaction and independent-plan/CAS path. */
(function(root){
 'use strict';
 let dialog,button,contract=null,controller=null,capture=null,generation=0,sourceText='',sourcePlanId=null,sourceOwner=null,preview=null,converter=null,excluded=new Set(),approved=new Set(),busy=false;
 const clone=v=>JSON.parse(JSON.stringify(v)),host=()=>root.EDITOR_PANE?root.parent:root;
 const workspace=()=>host().PlanLibrary||host().ParallelEditors;
 const paneId=()=>root.EDITOR_PANE||root.NATIVE_EDITOR_PANE||null;
 const currentPlanId=()=>root.EDITOR_PANE||root.NATIVE_PLAN_EDITOR?root.__editorPlanId:null;
 const el=id=>dialog.querySelector('[data-conversion="'+id+'"]');
 const registry=()=>root.AssetPackPicker.getRegistry();
 function status(text){el('status').textContent=text;}
 function stopCapture(){capture?.abort();capture=null;el('images').replaceChildren();}
 function cancel(){generation++;controller?.abort();controller=null;stopCapture();}
 function unchanged(){
  if(currentPlanId()!==sourcePlanId||root.serializeDataSnapshot()!==sourceText||root._editorPaneDisposed||root._editorPlanInstalling)return false;
  const owner=root.EditorPane?.importOwner?.();
  return !sourceOwner||owner&&['paneId','planId','installGeneration','targetGeneration'].every(key=>owner[key]===sourceOwner[key]);
 }
 function changedMessage(){status('元の案が更新されました。閉じて開き直し、差し替える内容を確認してください。');}
 function notifyCatalogue(){workspace()?.edited?.(paneId());}
 function planPack(plan){
  let japanese=false,rpg=false;
  const nativeSources=new Set((root.AssetPackConversionContract?.mappings||[]).filter(pair=>pair.native).map(pair=>pair.sourceId));
  for(const item of plan.items){
   if(registry().hasCandidate(item.type,'rpg-mansion')&&!registry().hasCandidate(item.type,'japanese-standard'))rpg=true;
   if(nativeSources.has(item.type)||registry().hasCandidate(item.type,'japanese-standard')&&!registry().hasCandidate(item.type,'rpg-mansion'))japanese=true;
  }
  return japanese&&rpg?'mixed':rpg?'rpg-mansion':'japanese-standard';
 }
 function options(select,value){
  select.replaceChildren();
  if(value==='mixed'){const option=document.createElement('option');option.value='mixed';option.textContent='混在（差し替え先を選択）';option.disabled=true;select.append(option);}
  for(const pack of registry().listPacks()){
   const option=document.createElement('option');option.value=pack.id;option.textContent=pack.name;select.append(option);
  }
  select.value=value;
 }
 function syncDestination(){
  const copy=el('copy').checked;
  el('name-field').hidden=!copy;
  el('destination-note').textContent=copy?'元の間取りを残して、共通一覧に別プランを作成します。':root.SHARED?.roomId?'共同編集中は別プランを作成してください。現在の案への一斉差し替えは利用できません。':'現在のプランに適用します。Undoで元に戻せます。保存は通常の保存操作で行ってください。';
  el('create').disabled=busy||!preview?.changed||!copy&&!!root.SHARED?.roomId;
 }
 function render(){
  stopCapture();
  if(!converter||el('pack').value==='mixed'){
   preview=null;el('summary').textContent='差し替え先のオブジェクトセットを選択してください。';el('rows').replaceChildren();el('capture').disabled=true;syncDestination();return;
  }
  const plan=JSON.parse(sourceText),targetPack=el('pack').value;
  const resolvedDimensions=plan.items.map(i=>({...root.getItemDefaultSize(i.type),h:root.getItemHeightValue(i)}));
  const resolvedTargets=targetPack==='japanese-standard'?plan.items.map(i=>{const id=i.assetPackConversion?.sourceType;return id?{id,name:root.itemTypeLabel?.(id)||id,...root.getItemDefaultSize(id),h:root.getItemHeightValue({...i,type:id})}:null;}):[];
  const resolvedTargetHeights=resolvedTargets.map(target=>target?.h);
  preview=converter.preview(plan,{targetPack,excludedIndexes:[...excluded],approvedIndexes:[...approved],resolvedDimensions,resolvedTargetHeights,resolvedTargets});
  const pending=preview.rows.filter(row=>row.canSelect&&!row.changed&&!excluded.has(row.index)).length;
  el('summary').textContent=preview.changed+'点を差し替え / '+preview.retained+'点を保持'+(pending?'（うち'+pending+'点は確認して選択）':'');
  el('capture').disabled=!preview.changed||!plan.rooms.length||busy;syncDestination();
  const fragment=document.createDocumentFragment();
  for(const row of preview.rows){
   const tr=document.createElement('tr');tr.dataset.index=row.index;
   const choice=document.createElement('td'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=row.changed;checkbox.disabled=!row.canSelect||busy;checkbox.setAttribute('aria-label',(row.sourceName||'物')+'を差し替え');
   checkbox.onchange=()=>{if(checkbox.checked){excluded.delete(row.index);approved.add(row.index);}else{excluded.add(row.index);approved.delete(row.index);}render();el('rows').querySelector('tr[data-index="'+row.index+'"] input')?.focus({preventScroll:true});};choice.append(checkbox);tr.append(choice);
   for(const [id,name] of [[row.sourceId,row.sourceName],[row.targetId,row.targetName]]){
    const td=document.createElement('td'),asset=registry().getAsset(id);
    if(asset?.thumb){const img=document.createElement('img');img.src=asset.thumb;img.alt='';img.loading='lazy';img.width=64;img.height=64;img.onerror=()=>img.remove();td.append(img);}
    const label=document.createElement('span');label.textContent=name||'変更なし';td.append(label);tr.append(td);
   }
   const detail=document.createElement('td');detail.textContent=row.reason+(row.changed?' · '+['w','d','h'].map(k=>Math.round(row.dimensions[k])).join(' × ')+' mm':'');
   if(row.warnings.length){const details=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('small');summary.textContent='引継ぎの詳細';note.textContent=row.warnings.join(' ');details.append(summary,note);detail.append(details);}tr.append(detail);fragment.append(tr);
  }
  el('rows').replaceChildren(fragment);
 }
 async function open(){
  if(busy)return;ensureDialog();cancel();const ticket=generation;
  sourceText=root.serializeDataSnapshot();sourcePlanId=currentPlanId();sourceOwner=root.EditorPane?.importOwner?.()||null;
  excluded=new Set();approved=new Set();preview=null;converter=null;
  options(el('list-pack'),root.AssetPackPicker.getSelection());options(el('pack'),planPack(JSON.parse(sourceText)));
  el('copy').checked=true;el('name').value='オブジェクト差し替え案';el('review').open=false;
  el('list-status').textContent='配置済みのオブジェクトや間取りは変更しません。';
  dialog.showModal();el('rows').replaceChildren();el('summary').textContent='対応表を読み込み中…';el('capture').disabled=true;syncDestination();status('対応するオブジェクトだけを差し替えます。未対応の物はそのまま保持します。');controller=new AbortController();
  try{
   if(!contract){const response=await fetch('assets/models/packs/rpg-mansion/conversion-map.json',{signal:controller.signal});if(!response.ok)throw Error('対応表を読み込めません。');const loaded=await response.json();if(ticket!==generation||!dialog.open)return;contract=loaded;}
   if(ticket!==generation||!dialog.open)return;
   converter=root.AssetPackConversion.createConverter(contract,registry().listAssets());
   const rooms=JSON.parse(sourceText).rooms;el('room').replaceChildren();for(let i=0;i<rooms.length;i++){const o=document.createElement('option');o.value=i;o.textContent=(rooms[i].floor||1)+'F / '+(rooms[i].n||rooms[i].name||'部屋');el('room').append(o);}
   render();
  }catch(e){if(ticket===generation&&e.name!=='AbortError')status(e.message+' 元の間取りは変更していません。');}
 }
 function applyList(){
  if(busy||!dialog?.open)return;
  if(!unchanged()){changedMessage();return;}
  root.AssetPackPicker.setSelection(el('list-pack').value);notifyCatalogue();
  el('list-status').textContent=registry().listPacks().find(p=>p.id===root.AssetPackPicker.getSelection()).name+'のオブジェクトリストに差し替えました。配置済みの物は変更していません。';
 }
 async function capturePair(){
  stopCapture();if(!preview||!unchanged()){changedMessage();return;}
  const plan=JSON.parse(sourceText),room=plan.rooms[Number(el('room').value)];if(!room)return;
  const ticket=generation,own=new AbortController();capture=own;status('同じ視点で元の案 → 差し替え案を描画中…');el('capture').disabled=true;
  try{
   const pairs=await root.ComparisonCapture.pair([plan,preview.plan],{floor:room.floor||1,room:clone(room),fov:65,up:[0,1,0],width:960,height:720,lighting:clone(root.LIGHT_SETTINGS)},own.signal);
   if(ticket!==generation||capture!==own||!dialog.open||!unchanged())return;
   for(let i=0;i<2;i++){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img');caption.textContent=i?'差し替え案':'元の案';img.src=pairs[i].png;img.alt=caption.textContent+'・同じ視点の3D';figure.append(caption,img);el('images').append(figure);}status('同じカメラ・照明のプレビュー。寸法と向きを確認してください。');
  }catch(e){if(!own.signal.aborted)status('3Dプレビューを作成できませんでした。'+e.message);}
  finally{if(capture===own)el('capture').disabled=!preview?.changed;}
 }
 async function create(){
  if(busy||!dialog?.open||!preview?.changed)return;
  if(!unchanged()){changedMessage();return;}
  const copy=el('copy').checked,targetPack=el('pack').value,name=el('name').value.trim(),ws=workspace();
  if(!copy&&root.SHARED?.roomId){status('共同編集中は別プランを作成してください。現在の案への一斉差し替えは利用できません。');return;}
  if(copy&&!name){status('別プランの名前を入力してください。');return;}
  if(copy&&(!ws||typeof ws.createIndependentPlan!=='function')){status('通常の編集画面から別プランを作成してください。');return;}
  if(copy&&ws.retained.length>=4){status('比較は4案までです。不要な案を保存してから比較対象から外してください。');return;}
  const ticket=generation,current=()=>ticket===generation&&dialog.open&&unchanged();busy=true;stopCapture();
  dialog.querySelectorAll('button,input,select').forEach(control=>control.disabled=true);
  try{
   const plan=clone(preview.plan),checked=typeof ws?.validateDerivedPlan==='function'?await ws.validateDerivedPlan(sourcePlanId,plan):root.PlanSchema.validatePlan(plan);
   if(!current()){changedMessage();return;}
   if(!checked.ok)throw Error('差し替え案の形式を確認できませんでした。');
   if(copy){
    await ws.createIndependentPlan(plan,name,{sourcePaneId:paneId(),sourcePlanId,sourceSnapshot:sourceText,signal:controller?.signal,isCurrent:current,cataloguePack:targetPack});
   }else{
    root.applyObjectSetReplacement(plan,{sourcePlanId,sourceSnapshot:sourceText,isCurrent:current,cataloguePack:targetPack});
   }
   dialog.close();
  }catch(e){if(ticket===generation)status(e.message+' 元の間取りへの差し替えは行っていません。');}
  finally{
   busy=false;dialog.querySelectorAll('button,input,select').forEach(control=>control.disabled=false);if(dialog.open)render();
  }
 }
 function ensureDialog(){
  if(dialog)return;dialog=document.createElement('dialog');dialog.className='asset-conversion-dialog';dialog.id='asset-conversion-dialog';dialog.setAttribute('aria-labelledby','asset-conversion-title');
  dialog.innerHTML='<div class="compare-row"><h2 id="asset-conversion-title">オブジェクトセットの入れ替え</h2><button type="button" data-conversion="close">閉じる ×</button></div>'+
   '<section class="object-set-operation" aria-labelledby="object-set-list-title"><h3 id="object-set-list-title">オブジェクトリストの差し替え</h3><p>左のリストに表示する配置候補を選びます。</p><div class="compare-row"><label for="object-set-list-pack">現在のオブジェクトセット<select id="object-set-list-pack" data-conversion="list-pack"></select></label><button type="button" data-conversion="list-apply" aria-label="オブジェクトリストを差し替え">オブジェクトを差し替え</button></div><p role="status" aria-live="polite" data-conversion="list-status"></p></section>'+
   '<section class="object-set-operation" aria-labelledby="object-set-plan-title"><h3 id="object-set-plan-title">現在の間取りのオブジェクト一斉差し替え</h3><p>対応する家具だけを入れ替え、壁・開口・未対応の物は保持します。位置・寸法・回転・階・色・個別設定を引き継ぎます。</p><label for="object-set-plan-pack">現在のオブジェクトセット<select id="object-set-plan-pack" data-conversion="pack"></select></label><p data-conversion="summary" role="status" aria-live="polite"></p>'+
   '<details class="object-set-review" data-conversion="review"><summary>差し替えるオブジェクトを確認・選択</summary><p>座面・天板・棚位置や機能が未確認の候補は初期状態では保持します。確認した候補だけを選択してください。日本建築標準へ戻す場合、元のモデルを特定できる変換情報がない洋館の物は保持します。同名の材質設定だけが適用され、モデル固有の設定は見た目に反映されない場合があります。</p><div class="compare-row"><button type="button" data-conversion="all">要確認の候補をまとめて選択</button><button type="button" data-conversion="none">すべて保持</button></div><div class="asset-conversion-table"><table><thead><tr><th>対象</th><th>現在の物</th><th>差し替え先</th><th>扱い</th></tr></thead><tbody data-conversion="rows"></tbody></table></div><div class="compare-row"><label>確認する部屋 <select data-conversion="room"></select></label><button type="button" data-conversion="capture">同じ視点で3D比較</button><button type="button" data-conversion="stop">描画を取消</button></div><div class="asset-conversion-images" data-conversion="images"></div></details>'+
   '<label class="object-set-copy"><input type="checkbox" data-conversion="copy" checked>元の間取りを残して別プランを作成</label><p data-conversion="destination-note"></p><label data-conversion="name-field">別プランの名前 <input maxlength="80" data-conversion="name" value="オブジェクト差し替え案"></label><div class="compare-row object-set-actions"><button type="button" class="compare-primary" data-conversion="create" aria-label="間取りのオブジェクトを差し替え">オブジェクトを差し替え</button><button type="button" data-conversion="cancel-bottom">取消</button></div><p role="status" aria-live="polite" data-conversion="status"></p><p>差し替え後は通常の保存操作で保存してください。家具の縦横比や正面の見え方は3Dで確認してください。</p></section>';
  document.body.append(dialog);
  el('pack').onchange=()=>{if(busy)return;excluded=new Set();approved=new Set();render();};el('copy').onchange=syncDestination;el('list-apply').onclick=applyList;
  el('all').onclick=()=>{if(!preview||busy)return;for(const row of preview.rows)if(row.canSelect){approved.add(row.index);excluded.delete(row.index);}render();status('支持高さや個別機能は自動一致しません。3Dと各候補を確認してください。');};el('none').onclick=()=>{if(!preview||busy)return;approved.clear();excluded=new Set(preview.rows.map(r=>r.index));render();};el('close').onclick=()=>dialog.close();el('cancel-bottom').onclick=()=>dialog.close();el('create').onclick=create;el('capture').onclick=capturePair;el('stop').onclick=()=>{stopCapture();el('capture').disabled=!preview?.changed||!JSON.parse(sourceText).rooms.length;status('描画を取り消しました。差し替えは行っていません。');};
  dialog.addEventListener('close',()=>{cancel();button?.focus();});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});for(const event of ['keydown','keyup'])dialog.addEventListener(event,e=>e.stopPropagation());
 }
 function install(container){
  if(button||!container||!registry()?.listPacks().some(p=>p.id==='rpg-mansion'))return;
  button=document.createElement('button');button.id='asset-conversion-open';button.type='button';button.className='tbtn object-set-open';button.textContent='オブジェクトセットの入れ替え';button.setAttribute('aria-haspopup','dialog');button.onclick=open;container.append(button);
 }
 root.AssetPackConversionUI={install,open};
})(window);
