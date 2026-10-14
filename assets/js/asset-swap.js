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
  // 替えた物は元の家具の幅・奥行に合わせて伸縮する（同じ場所に同じ大きさで収まる）。
  // 幅は幅、奥行は奥行で比べる（向きはそのまま置くので、長辺どうしで比べると
  // 縦長のソファが横長の長椅子になり、合わせたときに形が崩れる）。
  // 比率が limit（既定2倍）を超える物は、伸縮すると形が崩れるので替えない
  function withinBounds(w,d,cw,cd,limit){
    var L=limit||2;
    return cw/w<=L && cw/w>=1/L && cd/d<=L && cd/d>=1/L;
  }
  function center(it){ return {x:(Number(it.x)||0)+(Number(it.w)||0)/2, y:(Number(it.y)||0)+(Number(it.d)||0)/2}; }
  // 元の家具の中心から、自分の向きで (u: 幅の方向, v: 正面の方向) だけずらした位置に置く部品
  function part(orig,cand,u,v,rot,extra){
    var r=(Number(orig.rot)||0)*DEG, c=center(orig);
    var cx=c.x+u*Math.cos(r)-v*Math.sin(r), cy=c.y+u*Math.sin(r)+v*Math.cos(r);
    var p={type:cand.id,w:cand.w,d:cand.d,h:Number(cand.h)||0,rot:rot,cx:cx,cy:cy,name:cand.name};
    for(var k in extra) p[k]=extra[k];
    return p;
  }

  function closest(list,w,d,bounded,h,limit){
    var best=null,score=Infinity;
    list.forEach(function(c){
      if(bounded && !withinBounds(w,d,c.w,c.d,limit)) return;
      var s=sizeScore(w,d,c.w,c.d,h,c.h);
      if(s<score){score=s;best=c;}
    });
    return best;
  }
  // 決まった高さに置く物か（壁掛け・天井吊りのほか、卓上の物も「机の高さ」を持つ）
  function lifted(c){ return Number(c&&c.defaultElevation)>0; }
  // 壁の高い位置・天井に吊る物か（ペンダント・ブラケット・レンジフード・扁額）。
  // 卓上の物（既定の高さ 740 前後）や掛け軸（400）はこれに当たらない
  var HUNG_ELEVATION_MM=1200;
  function hungCandidate(c){ return Number(c&&c.defaultElevation)>=HUNG_ELEVATION_MM; }
  // 台に載っていないのに床から離れている物を壁の物とみなす下限（段差や台座の上の物は床の物）
  var HUNG_ITEM_ELEVATION_MM=300;
  // 置いてある向きでの、床の上の占める範囲（回転を含む外接の長方形）
  function footprint(it){
    var c=center(it), r=(Number(it.rot)||0)*DEG, hw=(Number(it.w)||0)/2, hd=(Number(it.d)||0)/2;
    var ex=Math.abs(hw*Math.cos(r))+Math.abs(hd*Math.sin(r)), ey=Math.abs(hw*Math.sin(r))+Math.abs(hd*Math.cos(r));
    return {x0:c.x-ex,x1:c.x+ex,y0:c.y-ey,y1:c.y+ey};
  }
  // 壁の物を床へ下ろしたとき、同じ場所にある別の家具と重なるか（20mm の触れ合いは重なりとしない）
  function blockedOnFloor(it,items,heightOf,isFurniture,newH){
    var f=footprint(it);
    return (items||[]).some(function(o){
      if(!o||o===it||String(o.id)===String(it.id)) return false;
      if((o.floor||1)!==(it.floor||1)||!isFurniture(o)) return false;
      var oh=Number(heightOf(o))||0, oe=Number(o.elev)||0;
      if(oh<100||oe>=newH) return false;                       // ラグと、下ろした物より上にある物は邪魔しない
      var g=footprint(o);
      return f.x0<g.x1-20&&g.x0<f.x1-20&&f.y0<g.y1-20&&g.y0<f.y1-20;
    });
  }

  // 物が別の物の上に載っているか（卓上のランプ・台の上の洗面ボウル・カウンターの IH など）。
  // 中心が台の長方形の中にあり、自分の底が台の天端の近く（±40mm）にある物を「載っている」とみなす。
  // 台と同じ分類の物（洗面台に埋め込んだ洗面ボウル）は天端より 150mm 下まで許す
  function restsOn(it,items,heightOf,kindOf){
    var e=Number(it.elev)||0; if(e<=0) return null;
    var c=center(it), best=null, bestTop=-1, kind=kindOf?kindOf(it):null;
    (items||[]).forEach(function(b){
      if(!b||b===it||String(b.id)===String(it.id)) return;
      if((b.floor||1)!==(it.floor||1)) return;
      var bh=Number(heightOf(b))||0; if(bh<100) return;              // ラグ・カーペットの上は床扱い
      var top=(Number(b.elev)||0)+bh;
      var below=(kind&&kindOf&&kindOf(b)===kind)?150:40;
      if(e>top+40||e<top-below) return;
      var bc=center(b), r=-(Number(b.rot)||0)*DEG;
      var dx=c.x-bc.x, dy=c.y-bc.y;
      var lx=dx*Math.cos(r)-dy*Math.sin(r), ly=dx*Math.sin(r)+dy*Math.cos(r);
      if(Math.abs(lx)>(Number(b.w)||0)/2||Math.abs(ly)>(Number(b.d)||0)/2) return;
      if(top>bestTop){ bestTop=top; best=b; }
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

  // 天井との隙間。壁掛けの物を天井に食い込ませない
  var CEILING_GAP_MM=50;
  // 台の上に置く物は、台に載る大きさの物にだけ替える（元の高さの2.5倍か 600mm までの高い方）。
  // カウンターの IH が竈に、洗面台の上の洗面ボウルが据え置きの洗面台になって宙に浮かないように
  function fitsOnSurface(h,ch){ return !(ch>Math.max(h*2.5,600)); }

  // items: プランの物。ctx: {kindOf(type), catalogue: 差し替え先のセットの物, swap: セットの swap 設定, setId,
  //   mountOf(type), heightOf(type), itemHeightOf(item), ceilingAt(item): 天井の仕上げ面の高さ(mm)か null}
  function plan(items,ctx){
    var cfg=ctx.swap||{}, cat=(ctx.catalogue||[]).filter(function(c){return !c.retired;});
    var byKind={};
    cat.forEach(function(c){ if(c.kind)(byKind[c.kind]||(byKind[c.kind]=[])).push(c); });
    var heightOf=function(it){
      if(ctx.itemHeightOf){ var v=Number(ctx.itemHeightOf(it)); if(isFinite(v)&&v>0) return v; }
      return ctx.heightOf?Number(ctx.heightOf(it.type))||0:0;
    };
    items=(items||[]).filter(function(it){ return it&&it.type; });
    // カタログの家具か（壁・窓・照明・寸法線などの図面の物ではない）。このセットの物も家具
    var isFurniture=function(o){
      return !!((cfg.typeKinds&&cfg.typeKinds[o.type])||ctx.kindOf(o.type)||String(o.type).indexOf(ctx.setId+'-')===0);
    };
    var rows=[], rowById={};
    var baseOf={};   // 物の id → 載っている台（元の状態で判定する）。壁・天井に付く物は載らない
    items.forEach(function(it){
      var m=ctx.mountOf?ctx.mountOf(it.type):null;
      if(m==='wall'||m==='ceiling') return;
      var b=restsOn(it,items,heightOf,function(o){ return (cfg.typeKinds&&cfg.typeKinds[o.type])||ctx.kindOf(o.type)||null; });
      if(b) baseOf[String(it.id)]=b;
    });

    items.forEach(function(it){
      if(String(it.type).indexOf(ctx.setId+'-')===0) return;        // もうこのセットの物
      var kind=(cfg.typeKinds&&cfg.typeKinds[it.type])||ctx.kindOf(it.type);
      if(!kind) return;                                              // カタログの家具ではない（壁・窓・照明など）
      var w=Number(it.w)||0,d=Number(it.d)||0,h=heightOf(it);
      var row={id:it.id,type:it.type,kind:kind,floor:it.floor||1};
      var mount=ctx.mountOf?ctx.mountOf(it.type):null;
      var base=baseOf[String(it.id)]||null;
      var onSurface=!!base||(mount==='tabletop'&&Number(it.elev)>0);
      // 壁・天井に付いている物。札が wall/ceiling の物のほか、台に載っていないのに高い位置にある物
      // （札が builtin のレンジフード、壁に付けた棚など）も含める
      var hung=!onSurface&&(mount==='wall'||mount==='ceiling'||Number(it.elev)>=HUNG_ITEM_ELEVATION_MM);
      // 1. 決め打ちの差し替え先（洗濯機 → たらい など）。在る物だけ使う
      var prefer=(cfg.prefer&&cfg.prefer[it.type])||[];
      var pick=null, preferred=false;
      for(var i=0;i<prefer.length&&!pick;i++) pick=cat.filter(function(c){return c.id===prefer[i];})[0]||null;
      if(pick) preferred=true;
      // 2. 同じ分類で大きさの近い物。替えた物は元の幅・奥行に合わせるので、合わせても形が崩れる
      //    (各軸2倍を超える) 物は選ばない。窓や床に合わせて伸ばす物（カーテン・ラグ）は比率を見ない。
      //    飾る物（額・鏡・照明・鉢植え）は3倍まで許す（花瓶が衝立に、小鉢が盆栽になるのは防ぐ）
      var stretch=(cfg.stretchKinds||[]).indexOf(kind)>=0;
      var loose=(cfg.looseKinds||[]).indexOf(kind)>=0;
      if(!pick){
        var pool=byKind[kind]||[];
        if(onSurface) pool=pool.filter(function(c){ return !hungCandidate(c)&&fitsOnSurface(h,Number(c.h)||0); });
        pick=closest(pool,w,d,!stretch,h,loose?3:2);
        if(!pick&&onSurface&&(byKind[kind]||[]).length){
          row.action='keep'; row.reason='台の上に置ける大きさの物が無い'; rows.push(row); rowById[String(it.id)]=row; return;
        }
      }
      if(pick){
        row.action='swap'; row.label=pick.name;
        var c=center(it);
        // 大きさ: 元の幅・奥行のまま（替えた物を合わせる）。決め打ちの物（人力車・たらい）は
        // 実物の形を保ち、元より大きい軸だけ元に合わせて縮める
        var pw=preferred?Math.min(pick.w,w||pick.w):w, pd=preferred?Math.min(pick.d,d||pick.d):d;
        row.parts=[{type:pick.id,w:pw||pick.w,d:pd||pick.d,h:Number(pick.h)||0,rot:Number(it.rot)||0,cx:c.x,cy:c.y,name:pick.name}];
        var candLifted=lifted(pick), oldElev=Number(it.elev)||0, newH=Number(pick.h)||0;
        var ceil=ctx.ceilingAt?ctx.ceilingAt(it):null;
        if((cfg.topAlignKinds||[]).indexOf(kind)>=0&&h>0&&newH>0){
          // カーテン・ロールスクリーンは上端(レール・巻き取りの箱)の高さを保つ。下端を保つと、
          // 丈の違う物に替えたときに天井を突き抜けたり、窓の途中で切れたりする
          var newBottom=Math.max(0,Math.round(oldElev+h-newH));
          // 腰窓・キッチンの窓の短いカーテンを床までの丈に替えると、窓台や天板に食い込む。
          // 元の裾より決まった長さ以上に下がるなら替えない
          var maxDrop=cfg.topAlignMaxDropMm&&cfg.topAlignMaxDropMm[kind];
          if(maxDrop>0&&oldElev-newBottom>maxDrop){
            row.action='keep'; row.reason='丈の合う物が無い（長すぎて窓台に掛かる）'; delete row.parts; delete row.label;
            rows.push(row); rowById[String(it.id)]=row; return;
          }
          row.parts[0].elev=newBottom;
        } else if(onSurface){
          // 台の上の物: 高さは後で台の新しい天端に合わせる（下の post pass）
        } else if(hung&&!candLifted){
          // 壁・天井に付いていた物を床置きの物に替えるときは床へ下ろす（エアコン → ラジエーター）。
          // 下ろす先に別の家具があれば（壁付けの戸棚の下の机など）、重なるので替えない
          if(blockedOnFloor(it,items,heightOf,isFurniture,newH||h)){
            row.action='keep'; row.reason='床置きの物しか無く、下ろすと他の家具と重なる'; delete row.parts; delete row.label;
            rows.push(row); rowById[String(it.id)]=row; return;
          }
          row.parts[0].elev=0;
        } else if(hung&&candLifted&&newH>0){
          // 壁掛け → 壁掛け: 中心の高さを保つ。天井吊り → 天井吊り: 天井から吊り直す。
          // どちらも天井に食い込まず、床より下がらない位置に収める
          var hasCeil=ceil!==null&&ceil!==undefined&&isFinite(ceil);
          var e=mount==='ceiling'&&hasCeil?ceil-newH:Math.round(oldElev+h/2-newH/2);
          if(hasCeil&&mount!=='ceiling') e=Math.min(e,ceil-CEILING_GAP_MM-newH);
          row.parts[0].elev=Math.max(0,e);
        } else if(!hung&&candLifted&&!(oldElev>0)){
          // 床に置いていた物を壁掛けの物に替えるときは、差し替え先の決まった高さへ上げる
          row.parts[0].elev=Number(pick.defaultElevation);
        }
        rows.push(row); rowById[String(it.id)]=row; return;
      }
      // 3. 代役（テレビ → 額絵）。同じ壁の、少し高い位置に掛ける
      var si=cfg.standIns&&cfg.standIns[kind];
      if(si){
        var cands=si.ids.map(function(id){return cat.filter(function(c){return c.id===id;})[0];}).filter(Boolean);
        var s=closest(cands,w,Math.max(d,1),false);
        if(s){
          var cc=center(it);
          row.action='standin'; row.label=s.name;
          row.parts=[{type:s.id,w:s.w,d:s.d,h:Number(s.h)||0,rot:Number(it.rot)||0,cx:cc.x,cy:cc.y,name:s.name,elevAdd:si.liftMm||0}];
          rows.push(row); rowById[String(it.id)]=row; return;
        }
      }
      // 4. 分けて置き直す（テーブルセット・キッチン）
      var ex=null;
      if(kind==='table-set' && cfg.expand && cfg.expand['table-set']) ex=expandTableSet(it,cat,cfg.expand['table-set']);
      if(kind==='kitchen-unit' && cfg.expand && cfg.expand['kitchen-unit']) ex=expandKitchen(it,cat,cfg.expand['kitchen-unit']);
      if(ex){ row.action='expand'; row.label=ex.label; row.parts=ex.parts; rows.push(row); rowById[String(it.id)]=row; return; }
      row.action='keep';
      row.reason=(byKind[kind]&&byKind[kind].length)?'ちょうどよい大きさの物が無い':'置き換えられる物が無い';
      rows.push(row); rowById[String(it.id)]=row;
    });

    // 台の上に載っている物は、台の新しい天端に合わせて高さを決め直す。
    // 台が低い座卓に替わればランプも下り、台が高い洗面台に替わればボウルも上がる。
    // 台が替わらなくても、台の台が替われば連鎖する（台の上の台の上の物）
    var newElevMemo={};
    function newElevOf(it){
      var key=String(it.id);
      if(key in newElevMemo) return newElevMemo[key];
      newElevMemo[key]=Number(it.elev)||0;                 // 循環したときの保険
      var r=rowById[key], e=Number(it.elev)||0;
      var b=baseOf[key];
      if(b){
        var oldTop=(Number(b.elev)||0)+heightOf(b);
        e=newTopOf(b)+(e-oldTop);                            // 台の天端からのずれ（埋め込みの沈み）は保つ
      } else if(r&&r.parts&&r.parts.length&&r.action!=='expand'&&typeof r.parts[0].elev==='number'){
        e=r.parts[0].elev;
      }
      if(r&&r.parts&&r.parts.length&&r.action==='standin'&&r.parts[0].elevAdd) e+=r.parts[0].elevAdd;
      newElevMemo[key]=e;
      return e;
    }
    function newTopOf(it){
      var r=rowById[String(it.id)], hh=heightOf(it);
      if(r&&r.parts&&r.parts.length&&r.action!=='keep'){
        var ph=Number(r.parts[0].h)||0; if(ph>0) hh=ph;    // 分けて置く物は先頭(食卓・流し)の高さ
      }
      return newElevOf(it)+hh;
    }
    items.forEach(function(it){
      var key=String(it.id), b=baseOf[key];
      if(!b) return;
      var r=rowById[key], br=rowById[String(b.id)];
      // 台と同じ分類の物（洗面台の上の洗面ボウルなど）は、台が替わるなら替え先に含まれる
      // とみなして外す。残すと据え置きの洗面台の上にもう一つ洗面器が載る
      var kind=(cfg.typeKinds&&cfg.typeKinds[it.type])||ctx.kindOf(it.type)||null;
      var baseKind=(cfg.typeKinds&&cfg.typeKinds[b.type])||ctx.kindOf(b.type)||null;
      if(kind&&kind===baseKind&&br&&br.action==='swap'){
        if(!r){ r={id:it.id,type:it.type,kind:kind,floor:it.floor||1}; rows.push(r); rowById[key]=r; }
        r.action='remove'; r.label=br.label+'に含める'; delete r.reason; r.parts=[];
        return;
      }
      var e=Math.round(newElevOf(it));
      if(r&&r.parts&&r.parts.length&&r.action!=='expand'){
        if(r.action==='standin') e-=r.parts[0].elevAdd||0;  // 載せる分は apply で足す
        r.parts[0].elev=e;
      } else if(!r||r.action==='keep'){
        if(Math.abs(e-(Number(it.elev)||0))<=1) return;
        if(!r){ r={id:it.id,type:it.type,kind:ctx.kindOf(it.type)||null,floor:it.floor||1}; rows.push(r); rowById[key]=r; }
        r.action='adjust'; r.label='高さを台に合わせる'; delete r.reason;
        r.parts=[{elev:e}];
      }
    });
    return rows;
  }

  function summary(rows){
    var s={swap:0,standin:0,expand:0,adjust:0,remove:0,keep:0};
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
    },itemHeightOf:function(it){
      return typeof root.getItemHeightValue==='function'?root.getItemHeightValue(it):null;
    },ceilingAt:function(it){
      // 部屋の中にある物だけ天井がある（屋外の物は null）
      if(typeof root.ceilingFinishElevationMm!=='function'||typeof root.roomAtPointOnFloor!=='function') return null;
      var fl=it.floor||1, cx=(Number(it.x)||0)+(Number(it.w)||0)/2, cy=(Number(it.y)||0)+(Number(it.d)||0)/2;
      if(!root.roomAtPointOnFloor(fl,cx,cy)) return null;
      var v=Number(root.ceilingFinishElevationMm(fl,cx,cy)); return isFinite(v)?v:null;
    },kindOf:function(type){
      var f=typeof root.getFmpItem==='function'?root.getFmpItem(type):null;
      return (f&&f.kind&&f.assetSet!==setId)?f.kind:null;
    }});
  }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // 入口は「表示するセット」の下の折りたたみ「一括差し替え」にまとめ、中をセットごとに分ける。
  // セットが増えるたびにボタンが2つずつ並ぶと、左のパネルが縦に伸びすぎるため(利用者の指摘)。
  var ENTRY_OPEN_KEY='hp.assetSwapEntryOpen';
  function renderEntry(doc){
    var picker=doc.getElementById('asset-set-picker'); if(!picker) return;
    var old=doc.getElementById('asset-swap-entry'); if(old) old.remove();
    var oldSt=doc.getElementById('asset-swap-status'); if(oldSt) oldSt.remove();
    var sets=(root.AssetSets&&root.AssetSets.sets()||[]).filter(function(s){return s.swap||s.style;});
    if(!sets.length) return;
    var wrap=doc.createElement('details');wrap.id='asset-swap-entry';wrap.className='asset-swap-entry';
    try{ wrap.open=root.localStorage.getItem(ENTRY_OPEN_KEY)==='1'; }catch(e){}
    wrap.addEventListener('toggle',function(){ try{ root.localStorage.setItem(ENTRY_OPEN_KEY,wrap.open?'1':'0'); }catch(e){} });
    var sum=doc.createElement('summary');sum.className='asset-swap-summary';sum.textContent='一括差し替え';
    wrap.append(sum);
    sets.forEach(function(s){
      var g=doc.createElement('div');g.className='asset-swap-group';g.dataset.assetSet=s.id;
      g.setAttribute('role','group');g.setAttribute('aria-label',s.name);
      var h=doc.createElement('div');h.className='asset-swap-group-title';
      if(s.mark){ var m=doc.createElement('span');m.className='asset-set-mark';m.textContent=s.mark;h.append(m); }
      h.append(doc.createTextNode(s.name));
      g.append(h);
      if(s.swap){
        var b=doc.createElement('button');b.type='button';b.className='asset-swap-open';b.dataset.assetSet=s.id;
        b.textContent='家具を差し替える';
        b.setAttribute('aria-label','家具を'+s.name+'に差し替える');
        b.title='置いてある家具を、まとめて'+s.name+'の物に差し替えます。差し替える前に一覧で確かめられます';
        b.addEventListener('click',function(){ open(s.id); });
        g.append(b);
      }
      // 壁・床・屋根の切り替え(building-style.js)。家具の差し替えと並べて置く
      if(s.style&&root.BuildingStyle){
        var bs=doc.createElement('button');bs.type='button';bs.className='asset-swap-open building-style-open';bs.dataset.assetSet=s.id;
        bs.textContent='建物の仕上げを替える';
        bs.setAttribute('aria-label','壁・床・屋根を'+s.name+'風にする');
        bs.title='外壁・屋根・内壁・床の素材と扉・窓を、まとめて'+s.name+'の様式に切り替えます。切り替える前に内容を確かめられます';
        bs.addEventListener('click',function(){ root.BuildingStyle.open(s.id); });
        g.append(bs);
      }
      wrap.append(g);
    });
    picker.append(wrap);
    // 結果の知らせは、折りたたんでいても見えるよう外に置く
    var st=doc.createElement('div');st.id='asset-swap-status';st.className='asset-swap-status';st.setAttribute('role','status');
    picker.append(st);
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
            '位置・向き・階・大きさはそのままです（替えた物を元の大きさに合わせます）。台の上の物は台の高さに合わせます。差し替えたあとでも、Undo を1回押せば全部元に戻ります。</p>';
      html+='<div class="asset-swap-list">';
      change.forEach(function(r){
        var how=r.action==='standin'?'代わりに':r.action==='expand'?'分けて置き直す':r.action==='adjust'?'そのまま':r.action==='remove'?'外す':'';
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
      }else if(r.action==='adjust'){
        // 台の上の物: 物は替えず、台の新しい天端に高さだけ合わせる
        it.elev=r.parts[0].elev;
      }else if(r.action==='remove'){
        // 台の替え先に含まれる物（洗面台の上の洗面ボウルなど）は外す
        D.items.splice(idx,1);
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
