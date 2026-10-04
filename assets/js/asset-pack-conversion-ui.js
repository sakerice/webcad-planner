/* Pane-local preview and duplicate. Uses existing comparison renderer/workspace. */
(function(root){
 'use strict';
 let dialog,button,contract=null,controller=null,capture=null,generation=0,sourceText='',sourcePlanId=null,preview=null,converter=null,excluded=new Set(),approved=new Set(),busy=false;
 const clone=v=>JSON.parse(JSON.stringify(v)),host=()=>root.EDITOR_PANE?root.parent:root;
 const currentPlanId=()=>root.EDITOR_PANE||root.NATIVE_PLAN_EDITOR?root.__editorPlanId:null;
 const el=id=>dialog.querySelector('[data-conversion="'+id+'"]');
 function status(text){el('status').textContent=text;}
 function stopCapture(){capture?.abort();capture=null;el('images').replaceChildren();}
 function cancel(){generation++;controller?.abort();controller=null;stopCapture();}
 function unchanged(){return currentPlanId()===sourcePlanId&&root.serializeDataSnapshot()===sourceText&&!root._editorPaneDisposed;}
 function render(){
  stopCapture();const plan=JSON.parse(sourceText),resolvedDimensions=plan.items.map(i=>({...root.getItemDefaultSize(i.type),h:root.getItemHeightValue(i)}));
  preview=converter.preview(plan,{excludedIndexes:[...excluded],approvedIndexes:[...approved],resolvedDimensions});
  el('summary').textContent=preview.changed+'点を対応モデルへ / '+preview.retained+'点を保持';
  el('create').disabled=!preview.changed||busy;el('capture').disabled=!preview.changed||!plan.rooms.length||busy;
  const fragment=document.createDocumentFragment();
  for(const row of preview.rows){
   const tr=document.createElement('tr');tr.dataset.index=row.index;
   const choice=document.createElement('td'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=row.changed;checkbox.disabled=!row.canSelect;checkbox.setAttribute('aria-label',(row.sourceName||'物')+'を変換');
   checkbox.onchange=()=>{if(checkbox.checked){excluded.delete(row.index);approved.add(row.index);}else{excluded.add(row.index);approved.delete(row.index);}render();el('rows').querySelector('tr[data-index="'+row.index+'"] input')?.focus({preventScroll:true});};choice.append(checkbox);tr.append(choice);
   for(const [id,name] of [[row.sourceId,row.sourceName],[row.targetId,row.targetName]]){
    const td=document.createElement('td'),asset=root.AssetPackPicker.getRegistry().getAsset(id);
    if(asset?.thumb){const img=document.createElement('img');img.src=asset.thumb;img.alt='';img.loading='lazy';img.width=64;img.height=64;img.onerror=()=>img.remove();td.append(img);}
    const label=document.createElement('span');label.textContent=name||'変更なし';td.append(label);tr.append(td);
   }
   const detail=document.createElement('td');detail.textContent=row.reason+(row.changed?' · '+['w','d','h'].map(k=>Math.round(row.dimensions[k])).join(' × ')+' mm':'');
   if(row.warnings.length){const details=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('small');summary.textContent='引継ぎの詳細';note.textContent=row.warnings.join(' ');details.append(summary,note);detail.append(details);}tr.append(detail);fragment.append(tr);
  }
  el('rows').replaceChildren(fragment);
 }
 async function open(){
  if(busy)return;ensureDialog();cancel();const ticket=generation;sourceText=root.serializeDataSnapshot();sourcePlanId=currentPlanId();excluded=new Set();approved=new Set();preview=null;
  dialog.showModal();el('rows').replaceChildren();el('summary').textContent='対応表を読み込み中…';el('create').disabled=true;el('capture').disabled=true;status('元プランを変更せず、複製案を作成します。');controller=new AbortController();
  try{
   if(!contract){const response=await fetch('assets/models/packs/rpg-mansion/conversion-map.json',{signal:controller.signal});if(!response.ok)throw Error('対応表を読み込めません。');contract=await response.json();}
   if(ticket!==generation||!dialog.open)return;
   converter=root.AssetPackConversion.createConverter(contract,root.AssetPackPicker.getRegistry().listAssets());
   const rooms=JSON.parse(sourceText).rooms;el('room').replaceChildren();for(let i=0;i<rooms.length;i++){const o=document.createElement('option');o.value=i;o.textContent=(rooms[i].floor||1)+'F / '+(rooms[i].n||rooms[i].name||'部屋');el('room').append(o);}
   render();
  }catch(e){if(ticket===generation&&e.name!=='AbortError')status(e.message+' 元プランは変更していません。');}
 }
 async function capturePair(){
  stopCapture();if(!preview||!unchanged()){status('元プランが更新されました。閉じてプレビューを開き直してください。');return;}
  const plan=JSON.parse(sourceText),room=plan.rooms[Number(el('room').value)];if(!room)return;
  const ticket=generation,own=new AbortController();capture=own;status('同じ視点で元案 → 洋館案を描画中…');el('capture').disabled=true;
  try{
   const pairs=await root.ComparisonCapture.pair([plan,preview.plan],{floor:room.floor||1,room:clone(room),fov:65,up:[0,1,0],width:960,height:720,lighting:clone(root.LIGHT_SETTINGS)},own.signal);
   if(ticket!==generation||capture!==own||!dialog.open||!unchanged())return;
   for(let i=0;i<2;i++){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img');caption.textContent=i?'洋館の複製案':'元の案';img.src=pairs[i].png;img.alt=caption.textContent+'・同じ視点の3D';figure.append(caption,img);el('images').append(figure);}status('同じカメラ・照明のプレビュー。複製後に寸法と向きを調整できます。');
  }catch(e){if(!own.signal.aborted)status('3Dプレビューを作成できませんでした。'+e.message);}
  finally{if(capture===own)el('capture').disabled=false;}
 }
 async function create(){
  if(busy||!dialog?.open||!preview?.changed)return;
  if(!unchanged()){status('元プランが更新されました。閉じてプレビューを開き直してください。');return;}
  const name=el('name').value.trim();if(!name){status('複製案の名前を入力してください。');return;}
  const workspace=host().ParallelEditors,common=typeof workspace?.createIndependentPlan==='function';if(!workspace||(common?workspace.retained.length:workspace.plans.size)>=4){status('比較は4案までです。不要な案を保存してから比較対象から外してください。');return;}
  if(root.EDITOR_PANE&&(workspace.plans.get(sourcePlanId)?.memoryOnly||root.COMPARISON_PREVIEW)){status('隔離プレビューから保存可能な案は作成できません。');return;}
  const ticket=generation;busy=true;el('create').disabled=true;el('close').disabled=true;el('cancel-bottom').disabled=true;stopCapture();
  try{
   const plan=clone(preview.plan),checked=common?await workspace.validateDerivedPlan(sourcePlanId,plan):root.PlanSchema.validatePlan(plan);if(!checked.ok)throw Error('変換案の形式を確認できませんでした。');
   let id;
   if(common){
    id=await workspace.createIndependentPlan(plan,name,{sourcePaneId:root.EDITOR_PANE||root.NATIVE_EDITOR_PANE||null,sourcePlanId,sourceSnapshot:sourceText,signal:controller?.signal,isCurrent:()=>ticket===generation&&dialog.open&&unchanged(),cataloguePack:'rpg-mansion'});
    if(!unchanged()){status('元の案が更新されました。複製は共通一覧へ保持しています。');return;}
   }else if(root.EDITOR_PANE){
    const pane=[...workspace.panes.values()].find(p=>p.frame.contentWindow===root);if(!pane||pane.planId!==sourcePlanId||pane.busy)throw Error('元のpaneが切り替わりました。');
    // addPlan is a separate record; select stashes the unmodified original.
    id=await workspace.addPlan(plan,name);
    if(!unchanged()){status('元の案が切り替わりました。複製は別の案として保持しています。');return;}
    if(![...workspace.panes.values()].some(p=>p.planId===id))await workspace.select(pane.id,id);
   }else{id=await workspace.openPlan(plan,name);}
   const destination=[...workspace.panes.values()].find(p=>p.planId===id)?.frame.contentWindow;
   if(!common)destination?.AssetPackPicker.setSelection('rpg-mansion');if(destination&&!common){destination.DIRTY=true;destination.renderSaveButtonState();workspace.changed([...workspace.panes.values()].find(p=>p.planId===id).id);}
   dialog.close();
  }catch(e){status(e.message+' 元プランは上書きしていません。');}
  finally{busy=false;el('create').disabled=!preview?.changed;el('close').disabled=false;el('cancel-bottom').disabled=false;}
 }
 function ensureDialog(){
  if(dialog)return;dialog=document.createElement('dialog');dialog.className='asset-conversion-dialog';dialog.id='asset-conversion-dialog';dialog.setAttribute('aria-labelledby','asset-conversion-title');
  dialog.innerHTML='<div class="compare-row"><h2 id="asset-conversion-title">洋館の複製案</h2><button type="button" data-conversion="close">閉じる ×</button></div><p>元の案はそのまま残ります。座面・天板・棚位置などが未確認の候補は初期状態では保持します。形状と機能を確認した候補にチェックを入れてください。対応する家具だけを入れ替え、壁・開口・未対応の物は保持します。位置・寸法・回転・階・色・個別設定を引き継ぎます。同名の材質設定だけが適用され、モデル固有の設定は見た目に反映されない場合があります。</p><p data-conversion="summary"></p><div class="compare-row"><button type="button" data-conversion="all">要確認の候補をまとめて選択</button><button type="button" data-conversion="none">すべて保持</button></div><div class="asset-conversion-table"><table><thead><tr><th>対象</th><th>元の物</th><th>洋館の物</th><th>扱い</th></tr></thead><tbody data-conversion="rows"></tbody></table></div><div class="compare-row"><label>確認する部屋 <select data-conversion="room"></select></label><button type="button" data-conversion="capture">同じ視点で3D比較</button><button type="button" data-conversion="stop">描画を取消</button></div><div class="asset-conversion-images" data-conversion="images"></div><div class="compare-row"><label>複製案の名前 <input maxlength="80" data-conversion="name" value="洋館の案"></label><button type="button" class="compare-primary" data-conversion="create">複製案を作成</button><button type="button" data-conversion="cancel-bottom">取消</button></div><p role="status" aria-live="polite" data-conversion="status"></p><p>作成後はそのpaneの保存操作で保存してください。寸法を保持するため、家具の縦横比や正面の見え方は3Dで確認してください。</p>';
  document.body.append(dialog);el('all').onclick=()=>{if(!preview||busy)return;for(const row of preview.rows)if(row.canSelect){approved.add(row.index);excluded.delete(row.index);}render();status('支持高さや個別機能は自動一致しません。3Dと各候補を確認してください。');};el('none').onclick=()=>{if(!preview||busy)return;approved.clear();excluded=new Set(preview.rows.map(r=>r.index));render();};el('close').onclick=()=>dialog.close();el('cancel-bottom').onclick=()=>dialog.close();el('create').onclick=create;el('capture').onclick=capturePair;el('stop').onclick=()=>{stopCapture();el('capture').disabled=!preview?.changed||!JSON.parse(sourceText).rooms.length;status('描画を取り消しました。案は作成していません。');};
  dialog.addEventListener('close',()=>{cancel();button?.focus();});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});for(const event of ['keydown','keyup'])dialog.addEventListener(event,e=>e.stopPropagation());
 }
 function install(container){
  if(button||!container||!root.AssetPackPicker?.getRegistry()?.listPacks().some(p=>p.id==='rpg-mansion'))return;
  button=document.createElement('button');button.id='asset-conversion-open';button.type='button';button.className='tbtn';button.textContent='この案を洋館に変換…';button.onclick=open;container.append(button);
 }
 root.AssetPackConversionUI={install,open};
})(window);
