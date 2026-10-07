/* アセットのセット（標準・洋館・…）。カタログに「どのセットを表示するか」を選ばせる。
 *
 * セットは assets/models/asset-sets.json に並べる。標準以外のセットは、それぞれ
 * 自分の manifest.json（本番のカタログと同じ形式）を持つ。新しいセット（例: 日本古民家）を
 * 足すときに、アプリのコードは触らない — 一覧に1行と、manifest を置くだけ。
 *
 * **表示の切り替えは、カタログに出すかどうかだけを決める。** モデルの登録は
 * 表示に関係なく全部のセットで行う。でないと、洋館の家具を置いたプランを
 * 「標準だけ表示」で開いたとき、その家具が描けなくなる。
 *
 * どのセットを表示するかは見る人ごとの好みなので、プランには入れず、
 * このブラウザに覚えておく。
 */
(function(root){
  var REGISTRY_URL='assets/models/asset-sets.json';
  var STORAGE_KEY='webcad-asset-sets-visible';
  var STANDARD='standard';
  var registry=[{id:STANDARD,name:'標準'}];
  var visible=[STANDARD];

  function setOf(item){ return (item&&item.assetSet)||STANDARD; }
  function known(id){ return registry.some(function(s){ return s.id===id; }); }
  function nameOf(id){ var s=registry.filter(function(x){ return x.id===id; })[0]; return s?s.name:id; }

  // 覚えている選択を読む。読めない・壊れている・全部消えた、のどれでも「標準だけ」に戻す。
  function restore(storage){
    try{
      var raw=storage&&storage.getItem(STORAGE_KEY);
      var list=raw?JSON.parse(raw):null;
      if(Array.isArray(list)){
        list=list.filter(known);
        if(list.length){ visible=list; return; }
      }
    }catch(e){}
    visible=[STANDARD];
  }
  function remember(storage){ try{ storage&&storage.setItem(STORAGE_KEY,JSON.stringify(visible)); }catch(e){} }

  // セットの一覧と、標準以外のセットの manifest を読む。
  // fetchJson(url) は JSON か null を返す Promise。
  function load(fetchJson,storage){
    return Promise.resolve(fetchJson(REGISTRY_URL)).then(function(doc){
      var sets=(doc&&Array.isArray(doc.sets))?doc.sets.filter(function(s){ return s&&s.id&&s.name; }):[];
      if(!sets.some(function(s){ return s.id===STANDARD; })) sets.unshift({id:STANDARD,name:'標準'});
      registry=sets;
      restore(storage);
      return Promise.all(sets.filter(function(s){ return s.manifest; }).map(function(s){
        return Promise.resolve(fetchJson(s.manifest)).then(function(m){
          if(!m) return null;
          (m.items||[]).forEach(function(item){ item.assetSet=s.id; });
          return m;
        });
      }));
    }).then(function(list){ return list.filter(Boolean); });
  }

  function isVisible(item){ return visible.indexOf(setOf(item))>=0; }
  function toggle(id,storage){
    if(!known(id)) return false;
    var at=visible.indexOf(id);
    if(at>=0){
      if(visible.length===1) return false;      // 何も表示しない状態にはしない
      visible=visible.filter(function(x){ return x!==id; });
    }else{
      // 一覧の並び順を保つ
      visible=registry.map(function(s){ return s.id; }).filter(function(x){ return x===id||visible.indexOf(x)>=0; });
    }
    remember(storage);
    return true;
  }
  // 標準以外のセットの物には、セット名の札を付ける（標準の家具に混ぜて並べるため）。
  function badge(item){ var s=setOf(item); return s===STANDARD?'':nameOf(s); }

  // カタログの検索欄の下に「表示するセット」を出す。セットが標準だけなら何も出さない。
  function renderPicker(doc,onChange,storage){
    var bar=doc.getElementById('object-search');
    var old=doc.getElementById('asset-set-picker');
    if(old) old.remove();
    if(!bar||registry.length<2) return null;
    var wrap=doc.createElement('div');wrap.id='asset-set-picker';wrap.className='asset-set-picker';
    var label=doc.createElement('div');label.className='asset-set-label';label.id='asset-set-label';label.textContent='表示するセット';
    var row=doc.createElement('div');row.className='asset-set-options';row.setAttribute('role','group');row.setAttribute('aria-labelledby',label.id);
    registry.forEach(function(s){
      var b=doc.createElement('button');b.type='button';b.className='asset-set-option';b.dataset.assetSet=s.id;
      b.textContent=s.name;
      var on=visible.indexOf(s.id)>=0;
      b.setAttribute('aria-pressed',on?'true':'false');
      b.addEventListener('click',function(){
        if(!toggle(s.id,storage)) return;
        renderPicker(doc,onChange,storage);
        if(typeof onChange==='function') onChange();
      });
      row.append(b);
    });
    wrap.append(label,row);
    bar.append(wrap);
    return wrap;
  }

  var api={REGISTRY_URL:REGISTRY_URL,STORAGE_KEY:STORAGE_KEY,STANDARD:STANDARD,
    load:load,restore:restore,isVisible:isVisible,toggle:toggle,badge:badge,setOf:setOf,renderPicker:renderPicker,
    sets:function(){ return registry.slice(); },visible:function(){ return visible.slice(); },
    _reset:function(){ registry=[{id:STANDARD,name:'標準'}]; visible=[STANDARD]; }};
  if(typeof module==='object'&&module.exports) module.exports=api;else root.AssetSets=api;
})(typeof window==='object'?window:globalThis);
