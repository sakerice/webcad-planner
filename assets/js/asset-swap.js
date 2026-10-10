/* 置いてある家具を、別のセット（洋館など）の物へ一括で差し替える。
 *
 * ここは「どれを何に替えるか」を決めるだけで、プランには触らない（テストできるように）。
 * 実際に書き換えるのは apply（画面から呼ぶ）。
 *
 * 決め方（セットの定義 assets/models/asset-sets.json の swap に従う）:
 *   1. 同じ分類(kind)の物があれば、置いてある大きさに一番近い物へ替える。
 *      大きさが2倍以上・半分以下しか無ければ替えない（小型家電が戸棚になるのを防ぐ）
 *   2. 同じ分類が無い物は代役へ替える（テレビ → 額絵 など）
 *   3. テーブルセットは食卓と椅子に、キッチンは流し台・調理台・戸棚の並びに分けて置き直す
 *   4. どれにも当てはまらない物は、そのまま残す（理由を添える）
 *
 * 向き: 家具の正面はプランの回転 rot（度）のとき (-sin rot, cos rot) を向く（モデルは +Z が正面）。
 */
(function(root){
  var DEG=Math.PI/180;

  // 大きさの近さ。高さも分かるときは高さも比べる（床置きのスタンド照明が小さなランタンにならないように）
  function sizeScore(w,d,cw,cd,h,ch){
    var s=Math.abs(Math.log(cw/w))+Math.abs(Math.log(cd/d));
    if(h>0&&ch>0) s+=1.5*Math.abs(Math.log(ch/h));
    return s;
  }
  function withinBounds(w,d,cw,cd){
    // 長辺どうし・短辺どうしで比べる（向きを変えて置ける物があるので）
    var a=[w,d].sort(function(x,y){return y-x;}), b=[cw,cd].sort(function(x,y){return y-x;});
    return b[0]/a[0]<=2 && b[0]/a[0]>=0.5 && b[1]/a[1]<=2.5 && b[1]/a[1]>=0.4;
  }
  function center(it){ return {x:(Number(it.x)||0)+(Number(it.w)||0)/2, y:(Number(it.y)||0)+(Number(it.d)||0)/2}; }
  // 元の家具の中心から、自分の向きで (u: 幅の方向, v: 正面の方向) だけずらした位置に置く部品
  function part(orig,cand,u,v,rot,extra){
    var r=(Number(orig.rot)||0)*DEG, c=center(orig);
    var cx=c.x+u*Math.cos(r)-v*Math.sin(r), cy=c.y+u*Math.sin(r)+v*Math.cos(r);
    var p={type:cand.id,w:cand.w,d:cand.d,rot:rot,cx:cx,cy:cy,name:cand.name};
    for(var k in extra) p[k]=extra[k];
    return p;
  }

  function closest(list,w,d,bounded,h){
    var best=null,score=Infinity;
    list.forEach(function(c){
      if(bounded && !withinBounds(w,d,c.w,c.d)) return;
      var s=sizeScore(w,d,c.w,c.d,h,c.h);
      if(s<score){score=s;best=c;}
    });
    return best;
  }

  // テーブルセット → 食卓と、長い辺の両側に人数分の椅子
  function expandTableSet(it,cat,cfg){
    var W=Number(it.w),D=Number(it.d),rot=Number(it.rot)||0;
    var tables=cat.filter(function(c){return c.kind==='dining-table';});
    var chair=cat.filter(function(c){return c.id===cfg.chair;})[0]||cat.filter(function(c){return c.kind==='chair';})[0];
    if(!tables.length||!chair) return null;
    var fit=tables.filter(function(t){return t.w<=W && t.d<=D-2*chair.d*0.6;});
    var table=fit.length?fit.sort(function(a,b){return b.w*b.d-a.w*a.d;})[0]:closest(tables,W*0.7,D*0.5,false);
    var n=Math.max(1,Math.floor(table.w/650));
    var parts=[part(it,table,0,0,rot,{})];
    var v=table.d/2+chair.d*0.25;
    for(var i=0;i<n;i++){
      var u=-table.w/2+table.w*(i+0.5)/n;
      parts.push(part(it,chair,u, v,rot+180,{}));   // 正面側の椅子は、こちら(テーブル)を向く
      parts.push(part(it,chair,u,-v,rot,{}));
    }
    return {parts:parts,label:table.name+'と'+chair.name+' '+(2*n)+'脚'};
  }

  // キッチン → 流し台・調理炉・戸棚を、元の幅の中に背を揃えて並べる
  function expandKitchen(it,cat,cfg){
    var W=Number(it.w),D=Number(it.d),rot=Number(it.rot)||0;
    if(W<(cfg.minWidth||1200)) return null;
    // 床に置く台（流し台は水はね板の分だけ背が高い）。直線に並べるので L字のコーナー物は使わない
    var floor=function(c){return !(c.defaultElevation>0) && c.h>=700 && c.h<=1300 && !/corner/.test(c.id);};
    var sink=cat.filter(function(c){return c.kind==='kitchen-sink'&&floor(c);}).sort(function(a,b){return a.w-b.w;})[0];
    var cook=cat.filter(function(c){return c.kind==='cooktop'&&floor(c);}).sort(function(a,b){return a.w-b.w;})[0];
    var bases=cat.filter(function(c){return c.kind==='kitchen-storage'&&floor(c)&&c.d<=D+100;}).sort(function(a,b){return b.w-a.w;});
    var row=[];
    if(sink) row.push(sink);
    if(cook) row.push(cook);
    var used=row.reduce(function(s,c){return s+c.w;},0);
    if(used>W) return null;
    // 残りの幅を、入る中で一番広い戸棚から詰める
    for(var guard=0;guard<12;guard++){
      var left=W-used, pick=bases.filter(function(b){return b.w<=left;})[0];
      if(!pick) break;
      row.splice(Math.floor(row.length/2)+1,0,pick); used+=pick.w;
    }
    if(row.length<2) return null;
    var u=-W/2+(W-used)/2, parts=[];
    row.forEach(function(c){
      parts.push(part(it,c,u+c.w/2,-D/2+c.d/2,rot,{}));   // 背(正面の反対側)を元のキッチンに揃える
      u+=c.w;
    });
    return {parts:parts,label:row.map(function(c){return c.name;}).join('・')};
  }

  // items: プランの物。ctx: {kindOf(type), catalogue: 差し替え先のセットの物, swap: セットの swap 設定, setId}
  function plan(items,ctx){
    var cfg=ctx.swap||{}, cat=(ctx.catalogue||[]).filter(function(c){return !c.retired;});
    var byKind={};
    cat.forEach(function(c){ if(c.kind)(byKind[c.kind]||(byKind[c.kind]=[])).push(c); });
    var rows=[];
    (items||[]).forEach(function(it){
      if(!it||!it.type) return;
      if(String(it.type).indexOf(ctx.setId+'-')===0) return;        // もうこのセットの物
      var kind=(cfg.typeKinds&&cfg.typeKinds[it.type])||ctx.kindOf(it.type);
      if(!kind) return;                                              // カタログの家具ではない（壁・窓・照明など）
      var w=Number(it.w)||0,d=Number(it.d)||0,h=ctx.heightOf?Number(ctx.heightOf(it.type))||0:0;
      var row={id:it.id,type:it.type,kind:kind,floor:it.floor||1};
      // 1. 決め打ちの差し替え先（洗濯機 → ランドリーボックス など）。在る物だけ使う
      var prefer=(cfg.prefer&&cfg.prefer[it.type])||[];
      var pick=null;
      for(var i=0;i<prefer.length&&!pick;i++) pick=cat.filter(function(c){return c.id===prefer[i];})[0]||null;
      // 2. 同じ分類で大きさの近い物。窓や床に合わせて伸ばす物（カーテン・ラグ）と飾る物（額・鏡・照明）は、
      //    大きさの開きを気にしない（伸ばす・そのまま飾るので、比率が違っても破綻しない）
      var stretch=(cfg.stretchKinds||[]).indexOf(kind)>=0;
      var loose=stretch||(cfg.looseKinds||[]).indexOf(kind)>=0;
      if(!pick) pick=closest(byKind[kind]||[],w,d,!loose,h);
      if(pick){
        row.action='swap'; row.label=pick.name;
        var c=center(it);
        row.parts=[{type:pick.id,w:stretch?w:pick.w,d:stretch?d:pick.d,rot:Number(it.rot)||0,cx:c.x,cy:c.y,name:pick.name}];
        // 高さ: 壁・天井に付いていた物を床置きの物に替えるときは床へ下ろし、
        // 床に置いていた物を壁掛けの物に替えるときは、差し替え先の決まった高さへ上げる。
        // それ以外（卓上の物など）は元の高さのまま。
        var mount=ctx.mountOf?ctx.mountOf(it.type):null, lifted=Number(pick.defaultElevation)>0;
        if((mount==='wall'||mount==='ceiling')&&!lifted) row.parts[0].elev=0;
        else if((mount==='floor'||!mount)&&lifted&&!(Number(it.elev)>0)) row.parts[0].elev=Number(pick.defaultElevation);
        rows.push(row); return;
      }
      // 3. 代役（テレビ → 額絵）。同じ壁の、少し高い位置に掛ける
      var si=cfg.standIns&&cfg.standIns[kind];
      if(si){
        var cands=si.ids.map(function(id){return cat.filter(function(c){return c.id===id;})[0];}).filter(Boolean);
        var s=closest(cands,w,Math.max(d,1),false);
        if(s){
          var cc=center(it);
          row.action='standin'; row.label=s.name;
          row.parts=[{type:s.id,w:s.w,d:s.d,rot:Number(it.rot)||0,cx:cc.x,cy:cc.y,name:s.name,elevAdd:si.liftMm||0}];
          rows.push(row); return;
        }
      }
      // 4. 分けて置き直す（テーブルセット・キッチン）
      var ex=null;
      if(kind==='table-set' && cfg.expand && cfg.expand['table-set']) ex=expandTableSet(it,cat,cfg.expand['table-set']);
      if(kind==='kitchen-unit' && cfg.expand && cfg.expand['kitchen-unit']) ex=expandKitchen(it,cat,cfg.expand['kitchen-unit']);
      if(ex){ row.action='expand'; row.label=ex.label; row.parts=ex.parts; rows.push(row); return; }
      row.action='keep';
      row.reason=(byKind[kind]&&byKind[kind].length)?'ちょうどよい大きさの物が無い':'置き換えられる物が無い';
      rows.push(row);
    });
    return rows;
  }

  function summary(rows){
    var s={swap:0,standin:0,expand:0,keep:0};
    rows.forEach(function(r){ s[r.action]=(s[r.action]||0)+1; });
    return s;
  }

  var api={plan:plan,summary:summary,_withinBounds:withinBounds};

  // ── ここから画面（ブラウザだけ） ─────────────────────────────────────────
  // 差し替えの入口は、カタログの「表示するセット」の下に置く（差し替え設定を持つセットごとに1つ）。
  function setCfg(setId){
    var s=(root.AssetSets&&root.AssetSets.sets()||[]).filter(function(x){return x.id===setId;})[0];
    return s||null;
  }
  // 確認画面に出す元の家具の名前。カタログの名前が英語・型番のままの物は、分類名を先に出す
  // （例:「チェア（Chair29）」）。名前だけでは何の家具か分からないため。
  function itemName(type){
    var f=typeof root.getFmpItem==='function'?root.getFmpItem(type):null;
    var labels={washer:'洗濯機'};
    if(!f) return labels[type]||type;
    var name=f.name||type;
    if(/[ぁ-んァ-ヶ一-龠]/.test(name)) return name;
    return (f.kindJa?f.kindJa+'（'+name+'）':name);
  }
  function planFor(setId){
    var set=setCfg(setId); if(!set||!set.swap) return [];
    var cat=Object.keys(root.FMP_ITEMS||{}).map(function(k){return root.FMP_ITEMS[k];}).filter(function(i){return i.assetSet===setId;});
    return plan(root.DATA.items,{setId:setId,catalogue:cat,swap:set.swap,mountOf:function(type){
      var f=typeof root.getFmpItem==='function'?root.getFmpItem(type):null; return f&&f.mount;
    },heightOf:function(type){
      var f=typeof root.getFmpItem==='function'?root.getFmpItem(type):null; return f&&f.h;
    },kindOf:function(type){
      var f=typeof root.getFmpItem==='function'?root.getFmpItem(type):null;
      return (f&&f.kind&&f.assetSet!==setId)?f.kind:null;
    }});
  }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  function renderEntry(doc){
    var picker=doc.getElementById('asset-set-picker'); if(!picker) return;
    var old=doc.getElementById('asset-swap-entry'); if(old) old.remove();
    var sets=(root.AssetSets&&root.AssetSets.sets()||[]).filter(function(s){return s.swap;});
    if(!sets.length) return;
    var wrap=doc.createElement('div');wrap.id='asset-swap-entry';wrap.className='asset-swap-entry';
    sets.forEach(function(s){
      var b=doc.createElement('button');b.type='button';b.className='asset-swap-open';b.dataset.assetSet=s.id;
      b.textContent='家具を'+s.name+'に差し替える';
      b.title='置いてある家具を、まとめて'+s.name+'の物に差し替えます。差し替える前に一覧で確かめられます';
      b.addEventListener('click',function(){ open(s.id); });
      wrap.append(b);
    });
    var st=doc.createElement('div');st.id='asset-swap-status';st.className='asset-swap-status';st.setAttribute('role','status');
    wrap.append(st);
    picker.append(wrap);
  }

  function open(setId){
    var doc=root.document, set=setCfg(setId), rows=planFor(setId);
    close();
    var modal=doc.createElement('div');modal.id='asset-swap-modal';
    modal.addEventListener('click',function(e){ if(e.target===modal) close(); });
    var change=rows.filter(function(r){return r.action!=='keep';}), keep=rows.filter(function(r){return r.action==='keep';});
    var floors=function(r){ return r.floor+'階'; };
    var html='<div class="asset-swap-card" role="dialog" aria-modal="true" aria-labelledby="asset-swap-title">';
    html+='<div class="asset-swap-title" id="asset-swap-title">置いてある家具を'+esc(set.name)+'に差し替える</div>';
    if(!change.length){
      html+='<p class="asset-swap-sub">差し替えられる家具がありません。</p>';
    }else{
      html+='<p class="asset-swap-sub">'+change.length+'点を差し替え、'+keep.length+'点はそのまま残します。チェックを外した物は替えません。'+
            '位置・向き・階はそのままです。差し替えたあとでも、Undo を1回押せば全部元に戻ります。</p>';
      html+='<div class="asset-swap-list">';
      change.forEach(function(r){
        var how=r.action==='standin'?'代わりに':r.action==='expand'?'分けて置き直す':'';
        html+='<label class="asset-swap-row"><input type="checkbox" checked data-swap-id="'+esc(r.id)+'">'+
              '<span class="asset-swap-from">'+esc(itemName(r.type))+'<small>'+floors(r)+'</small></span>'+
              '<span class="asset-swap-arrow" aria-hidden="true">→</span>'+
              '<span class="asset-swap-to">'+esc(r.label)+(how?'<small>'+how+'</small>':'')+'</span></label>';
      });
      html+='</div>';
    }
    if(keep.length){
      html+='<details class="asset-swap-keep"><summary>そのまま残す物（'+keep.length+'点）</summary><ul>';
      keep.forEach(function(r){ html+='<li>'+esc(itemName(r.type))+' <small>'+floors(r)+'・'+esc(r.reason)+'</small></li>'; });
      html+='</ul></details>';
    }
    html+='<div class="asset-swap-actions">'+(change.length?'<button type="button" class="asset-swap-apply">差し替える</button>':'')+
          '<button type="button" class="asset-swap-cancel">'+(change.length?'やめる':'閉じる')+'</button></div></div>';
    modal.innerHTML=html;
    doc.body.append(modal);
    modal.querySelector('.asset-swap-cancel').addEventListener('click',close);
    var go=modal.querySelector('.asset-swap-apply');
    if(go) go.addEventListener('click',function(){
      var picked={};
      modal.querySelectorAll('input[data-swap-id]').forEach(function(c){ if(c.checked) picked[c.dataset.swapId]=true; });
      var done=apply(change.filter(function(r){return picked[String(r.id)];}));
      close();
      var st=doc.getElementById('asset-swap-status');
      if(st) st.textContent=done?done+'点を'+set.name+'に差し替えました。元に戻すときは Undo を押してください。':'';
    });
    // 焦点はボタンに置くが、一覧の先頭(何点を替えて何点を残すか)が見える位置のまま開く
    (go||modal.querySelector('.asset-swap-cancel')).focus({preventScroll:true});
    modal.querySelector('.asset-swap-card').scrollTop=0;
  }
  function close(){ var m=root.document.getElementById('asset-swap-modal'); if(m) m.remove(); }

  // 選んだ行をプランに書き込む。Undo 1回で全部戻るよう、最初に1度だけ履歴を取る。
  function apply(rows){
    if(!rows.length) return 0;
    var D=root.DATA;
    root.saveState();
    var done=0;
    rows.forEach(function(r){
      var idx=-1;
      for(var i=0;i<D.items.length;i++) if(String(D.items[i].id)===String(r.id)){ idx=i; break; }
      if(idx<0) return;
      var it=D.items[idx];
      if(r.action==='expand'){
        D.items.splice(idx,1);
        r.parts.forEach(function(p){
          var n=root.mkItem(p.type,p.cx-p.w/2,p.cy-p.d/2,((p.rot%360)+360)%360,it.floor||1,p.w,p.d);
          D.items.push(n);
        });
      }else{
        var p=r.parts[0];
        it.type=p.type; it.w=p.w; it.d=p.d;
        it.x=p.cx-p.w/2; it.y=p.cy-p.d/2;
        if(typeof p.elev==='number') it.elev=p.elev;
        if(p.elevAdd) it.elev=(Number(it.elev)||0)+p.elevAdd;
        // 元の家具の色・素材の上書きは、差し替え先の部位と合わないので外す（差し替え先の既定の色になる）
        it.colorCustom=false; delete it.finishColors; delete it.finishRoughness; delete it.finishTextures; it.texture=null;
      }
      done++;
    });
    root.ST.selected=null;
    if(typeof root.ensureObjectIds==='function') root.ensureObjectIds();
    root.draw2d();
    if(typeof root.rebuild3D==='function') root.rebuild3D();
    return done;
  }

  api.renderEntry=renderEntry; api.open=open; api.apply=apply; api.planFor=planFor;
  if(typeof module==='object'&&module.exports) module.exports=api;else root.AssetSwap=api;
})(typeof window==='object'?window:globalThis);
