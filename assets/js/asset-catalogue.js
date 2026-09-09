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
  function installGlobal(sidebar){
    if(!sidebar) return;
    if(sidebar._globalCatalogueSearch){sidebar._globalCatalogueSearch();return;}
    var bar=document.createElement('div');bar.className='catalogue-search';bar.id='object-search';
    var label=document.createElement('label');label.textContent='すべてのオブジェクトを検索';
    var field=document.createElement('div');field.className='catalogue-search-field';
    var input=document.createElement('input');input.type='search';input.placeholder='名前・種類で検索';
    input.autocomplete='off';input.id='object-search-input';label.htmlFor=input.id;
    var clear=document.createElement('button');clear.type='button';clear.className='catalogue-search-clear';clear.textContent='×';clear.setAttribute('aria-label','検索をクリア');clear.hidden=true;
    field.append(input,clear);
    var count=document.createElement('div');count.className='catalogue-count';count.setAttribute('role','status');
    var results=document.createElement('div');results.id='object-search-results';results.hidden=true;
    input.setAttribute('aria-controls',results.id);
    bar.append(label,field,count);sidebar.querySelector('.common-tools').after(bar);bar.after(results);
    function entries(){
      var seen=new Set(),out=[];
      sidebar.querySelectorAll('.cat-body [data-tool]').forEach(function(card){
        var tool=card.getAttribute('data-tool');if(!tool||seen.has(tool))return;seen.add(tool);
        var body=card.closest('.cat-body'),header=body&&body.previousElementSibling;
        var group=header?header.textContent.replace(/[+−-]/g,'').trim():'';
        var sub=card.closest('.asset-subcat'),subhead=sub&&sub.querySelector('.asset-subhdr');
        var text=[group,subhead&&subhead.textContent,card.getAttribute('data-search'),card.getAttribute('title'),card.textContent,tool].join(' ');
        out.push({card:card,group:group,text:text});
      });
      return out;
    }
    function update(){
      var query=normalize(input.value),all=entries(),found=query?all.filter(function(e){return matches(e.text,query);}):[];
      sidebar.classList.toggle('catalogue-searching',!!query);results.hidden=!query;clear.hidden=!query;
      results.replaceChildren();
      count.textContent=query?(found.length?found.length+' 点見つかりました':'該当するオブジェクトはありません。名前や種類を変えて検索してください。'):all.length+' 点から検索できます';
      var currentGroup=null,grid;
      found.forEach(function(entry){
        if(entry.group!==currentGroup){
          currentGroup=entry.group;var heading=document.createElement('div');heading.className='catalogue-result-heading';heading.textContent=currentGroup;results.append(heading);
          grid=document.createElement('div');grid.className='catalogue-result-grid';results.append(grid);
        }
        var source=entry.card,button=document.createElement('button');button.type='button';button.className='catalogue-result '+source.className;
        Array.from(source.attributes).forEach(function(a){if(a.name.indexOf('data-')===0||a.name==='title'||a.name.indexOf('onmouse')===0)button.setAttribute(a.name,a.value);});
        button.innerHTML=source.innerHTML;
        button.addEventListener('click',function(){source.click();});grid.append(button);
      });
      if(typeof root.hideAssetPreview==='function')root.hideAssetPreview();
    }
    input.addEventListener('input',update);
    clear.addEventListener('click',function(){input.value='';update();input.focus();});
    input.addEventListener('keydown',function(event){if(event.key==='Escape'){event.stopPropagation();input.value='';update();}});
    sidebar._globalCatalogueSearch=update;update();
  }
  var api={normalize:normalize,matches:matches,dimensions:dimensions,installGlobal:installGlobal};
  if(typeof module==='object'&&module.exports) module.exports=api;else root.AssetCatalogue=api;
})(typeof window==='object'?window:globalThis);
