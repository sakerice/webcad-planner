/* Search the existing catalogue without rebuilding cards or losing focus. */
(function(root){
  function normalize(value){
    return String(value||'').normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g,' ').trim();
  }
  function matches(text,query){
    var haystack=normalize(text);
    return normalize(query).split(' ').every(function(word){return haystack.indexOf(word)!==-1;});
  }
  function dimensions(item){
    var w=Math.round(Number(item.w)),d=Math.round(Number(item.d));
    return Number.isFinite(w)&&Number.isFinite(d)&&w>0&&d>0 ? '幅 '+w+' × 奥行 '+d+' mm' : '';
  }
  function install(mount,group){
    var bar=document.createElement('div');bar.className='catalogue-search';
    var label=document.createElement('label');label.textContent=group+'の一覧を絞り込む';
    var input=document.createElement('input');input.type='search';input.placeholder='例：ベッド、ソファ、Bed01';
    input.autocomplete='off';input.id=mount.id+'-search';label.htmlFor=input.id;
    var count=document.createElement('div');count.className='catalogue-count';count.setAttribute('role','status');
    bar.append(label,input,count);mount.prepend(bar);
    var sidebar=mount.closest('#sidebar'),common=sidebar&&sidebar.querySelector('.common-tools');
    if(sidebar&&common&&!sidebar._catalogueResizeObserver){
      var syncPadding=function(){sidebar.style.setProperty('--catalogue-common-height',common.offsetHeight+'px');};
      syncPadding();
      if(typeof ResizeObserver!=='undefined'){
        sidebar._catalogueResizeObserver=new ResizeObserver(syncPadding);
        sidebar._catalogueResizeObserver.observe(common);
      }
    }
    function revealSearch(){
      if(!sidebar||!common||document.activeElement!==input) return;
      var top=input.getBoundingClientRect().top,limit=common.getBoundingClientRect().bottom+12;
      if(top<limit) sidebar.scrollTop-=limit-top;
    }
    input.addEventListener('focus',function(){requestAnimationFrame(revealSearch);});
    var cats=Array.from(mount.querySelectorAll('.asset-subcat'));
    var cards=Array.from(mount.querySelectorAll('.asset-tile'));
    var saved=null;
    count.textContent=cards.length+' 点から選べます';
    input.addEventListener('input',function(){
      var query=normalize(input.value),total=0;
      if(query && !saved) saved=cats.map(function(cat){return cat.classList.contains('open');});
      cats.forEach(function(cat,index){
        var found=0;
        cat.querySelectorAll('.asset-tile').forEach(function(card){
          var visible=matches(card.getAttribute('data-search'),query);
          card.hidden=!visible;if(visible) found++;
        });
        cat.hidden=found===0;
        if(query) cat.classList.toggle('open',found>0);
        else if(saved) cat.classList.toggle('open',saved[index]);
        var arrow=cat.querySelector('.asset-arrow');
        if(arrow) arrow.textContent=cat.classList.contains('open')?'-':'+';
        total+=found;
      });
      count.textContent=query ? (total?total+' 点見つかりました':'該当するアイテムはありません。名前や種類を変えて検索してください。') : cards.length+' 点から選べます';
      if(!query) saved=null;
      requestAnimationFrame(revealSearch);
      if(typeof root.hideAssetPreview==='function') root.hideAssetPreview();
    });
  }
  var api={normalize:normalize,matches:matches,dimensions:dimensions,install:install};
  if(typeof module==='object'&&module.exports) module.exports=api;else root.AssetCatalogue=api;
})(typeof window==='object'?window:globalThis);
