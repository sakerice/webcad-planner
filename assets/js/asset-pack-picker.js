/* Pane-local adapter for the existing catalogue. Never mutates plan/model data. */
(function(root){
  'use strict';
  let registry=null,selected='japanese-standard',sidebar=null,select=null;
  function getSelection(){return selected;}
  function apply(){
    if(!sidebar||!registry)return;
    sidebar.querySelectorAll('.cat-body [data-tool]').forEach(card=>{
      card.hidden=!registry.hasCandidate(card.getAttribute('data-tool'),selected);
    });
    sidebar.querySelectorAll('.asset-subcat').forEach(group=>{
      const cards=[...group.querySelectorAll('[data-tool]')];
      group.hidden=cards.length>0&&cards.every(card=>card.hidden);
    });
    sidebar.querySelectorAll(':scope > .cat-body').forEach(group=>{
      const cards=[...group.querySelectorAll('[data-tool]')];
      const hasControls=group.querySelector('.stool:not([data-tool]),button:not([data-tool])');
      group.hidden=!!(cards.length&&cards.every(card=>card.hidden)&&!hasControls);
      if(group.previousElementSibling?.classList.contains('cat-hdr'))group.previousElementSibling.hidden=group.hidden;
    });
    if(select)select.value=selected;
    sidebar._globalCatalogueSearch?.();
  }
  function setSelection(id){
    selected=registry?registry.resolvePackId(id):'japanese-standard';
    // Cancel only a pending placement tool. Preserve selected objects, history,
    // drawings already committed to DATA, and all 3D caches.
    if(registry&&root.ST&&registry.getAsset(root.ST.tool)&&!registry.hasCandidate(root.ST.tool,selected)){
      root.ST.tool='select';root.ST.drawing=false;root.ST.drawPts=[];
      root.syncToolUi?.();root.draw2d?.();
    }
    apply();return selected;
  }
  function install(element,models,rpg){
    if(!element)return;
    sidebar=element;
    const extraIds=new Set((rpg?.items||[]).map(item=>item.id));
    const legacy=new Map(Object.values(models).filter(item=>!extraIds.has(item.id)).map(item=>[item.id,item]));
    sidebar.querySelectorAll('.cat-body [data-tool]').forEach(card=>{
      const id=card.getAttribute('data-tool');
      if(!legacy.has(id)&&!extraIds.has(id))legacy.set(id,{id,name:card.getAttribute('title')||card.textContent.trim()});
    });
    // Existing tag/finish enrichers may add optional undefined fields; catalogue
    // snapshots cross the same JSON boundary as their source manifests.
    registry=root.AssetPackRegistry.createRegistry(JSON.parse(JSON.stringify([...legacy.values()])),rpg?[JSON.parse(JSON.stringify(rpg))]:[]);
    root.AssetCatalogue.installGlobal(sidebar);
    if(!select){
      const field=document.createElement('div');field.className='catalogue-pack-field';
      const label=document.createElement('label');label.htmlFor='catalogue-pack';label.textContent='配置候補のセット';
      select=document.createElement('select');select.id='catalogue-pack';select.setAttribute('aria-label','配置候補のセット');
      select.addEventListener('change',()=>setSelection(select.value));
      field.append(label,select);sidebar.querySelector('#object-search').prepend(field);
      sidebar.addEventListener('error',event=>{
        const img=event.target,card=img.closest?.('.asset-tile');
        if(img.tagName!=='IMG'||!card||!sidebar.contains(card))return;
        img.hidden=true;card.removeAttribute('data-preview');
        if(!card.querySelector('.asset-thumbnail-fallback')){
          const icon=document.createElement('span');icon.className='asset-thumbnail-fallback';
          icon.setAttribute('aria-hidden','true');icon.innerHTML=root.MenuIcons.html('その他');card.prepend(icon);
        }
      },true);
    }
    select.replaceChildren();
    for(const pack of registry.listPacks()){
      const option=document.createElement('option');option.value=pack.id;option.textContent=pack.name;select.append(option);
    }
    setSelection(selected);
  }
  root.AssetPackPicker={install,getSelection,setSelection,getRegistry:()=>registry,refresh:apply};
})(window);
