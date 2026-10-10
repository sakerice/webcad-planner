// 建物の外壁・屋根・内壁・床を、アセットのセットの「様式」にまとめて切り替える。
//
// 家具の一括差し替え(asset-swap.js)と対になる。様式は assets/models/asset-sets.json の
// 各セットの style に書く。素材の実体は index.html の ASSET_TEX_MAP / TEX_TILE_M と床材の
// FLOOR_PBR_STEM にある(キーで指す)。
//
// 書き込む先は、既存の外観・内観・屋根の設定と部屋の床材だけ。新しい保存項目は作らない。
// なので切り替えたプランは、今までの設定欄でそのまま1か所ずつ直せるし、古い版のアプリで
// 開いても素材が無いだけで壊れない。
//
// 決め方:
// - 外壁: 2階建て以上なら1階を基壇の石、上の階をレンガ。平屋はレンガ
// - 屋根: 家全体を1つの素材
// - 内壁: 家全体を1つの壁紙。部屋の名前が決まりに当たる面だけ別の素材(水まわりのタイルなど)
// - 床: 部屋ごとに床材。屋外(バルコニーなど)の部屋は触らない
// - 建具: 開き戸と玄関ドアの扉板を様式の扉にする。開口の大きさは変えない(扉板が開口に合わせて伸縮する)。
//   引き戸・折れ戸・浴室の透明ドアは、替えられる扉が無いのでそのまま
// - 窓: 窓の種類ごとに様式の窓にする(引き違い・開き窓・FIX・掃き出し)。開口の大きさは変えない
// - 面ごと・壁ごとに個別に付けていた色・素材は、様式が見えるよう外す(Undo で戻る)
(function(root){
  var api={};

  function matchRule(rules,name){
    name=String(name||'');
    for(var i=0;i<(rules||[]).length;i++){
      var r=rules[i];
      if((r.match||[]).some(function(m){ return name.indexOf(m)>=0; })) return r;
    }
    return null;
  }
  function isOutdoor(style,name){
    name=String(name||'');
    return (style.outdoorRooms||[]).some(function(m){ return name.indexOf(m)>=0; });
  }

  // 何をどの素材にするかを決める(画面に依らない部分)。
  //   input.floors … 外壁のある階の番号
  //   input.rooms  … [{id, n, floor}]
  //   input.faces  … 内壁の面 [{key, room: 面が向いている部屋の名前 or null}]
  //   input.doors  … 建具 [{id, type, finish}]
  //   input.windows … 窓 [{id, type, kind: sliding|casement|fix, w, h}]
  //   input.windowModels … 様式の窓の大きさ {id: {w, h}}(縦横比で選ぶため)
  // 返すのは書き込みの指示と、確認画面に出す要約。
  function plan(input,style){
    var floors=(input.floors||[]).slice().sort(function(a,b){return a-b;});
    var ext=style.exterior||{};
    var exterior=floors.map(function(f){
      var key=(floors.length>1&&f===floors[0]&&ext.base)?ext.base:ext.upper;
      return {floor:f,texture:key};
    }).filter(function(e){ return !!e.texture; });

    var rooms=[], skipped=[];
    (input.rooms||[]).forEach(function(r){
      if(isOutdoor(style,r.n)){ skipped.push(r); return; }
      var rule=matchRule(style.rooms,r.n);
      var key=(rule&&rule.floor)||style.floor;
      if(key) rooms.push({id:r.id,n:r.n,floor:r.floor,texture:key});
    });

    var faces=[];
    (input.faces||[]).forEach(function(f){
      var rule=f.room?matchRule(style.rooms,f.room):null;
      if(rule&&rule.wall) faces.push({key:f.key,room:f.room,texture:rule.wall});
    });

    var doorCfg=style.doors||{}, doors=[], keptDoors=0;
    (input.doors||[]).forEach(function(d){
      var model=null;
      if(d.type==='door-front') model=doorCfg.front;
      else if((d.type==='door-swing'||d.type==='door-swing-s')&&d.finish!=='bath-clear') model=doorCfg.swing;
      if(model) doors.push({id:d.id,type:d.type,model:model}); else keptDoors++;
    });

    // 窓は開口に合わせて縦横に伸びる。縦横比が窓の元の比から離れすぎると、格子や半円の飾りが
    // つぶれて見えるので、種類で決めた窓が合わなければ他の窓から比の近い物を選び、
    // それも合わなければ替えない(細長いスリット窓・横長の高窓など)
    var winCfg=style.windows||{}, windows=[], keptWindows=0, sizes=input.windowModels||{};
    var range=winCfg.aspectRange||[0.6,1.8];
    function stretch(id,w){
      var m=sizes[id]; if(!m||!(w.w>0)||!(w.h>0)) return 1;
      return (w.w/m.w)/(w.h/m.h);
    }
    function fits(id,w){ var r=stretch(id,w); return r>=range[0]&&r<=range[1]; }
    var plainKeys=['sliding','casement','fix'];
    (input.windows||[]).forEach(function(w){
      var model=w.type==='window-door'?winCfg.door:winCfg[w.kind||'sliding'];
      if(model&&!fits(model,w)){
        model=null;
        if(w.type!=='window-door'){
          var alts=plainKeys.map(function(k){return winCfg[k];}).filter(function(id,i,a){return id&&a.indexOf(id)===i&&fits(id,w);});
          alts.sort(function(a,b){ return Math.abs(Math.log(stretch(a,w)))-Math.abs(Math.log(stretch(b,w))); });
          model=alts[0]||null;
        }
      }
      if(model) windows.push({id:w.id,type:w.type,kind:w.kind,model:model}); else keptWindows++;
    });

    return {exterior:exterior,roof:style.roof||null,interior:style.interior||null,
            faces:faces,rooms:rooms,skippedRooms:skipped,doors:doors,keptDoors:keptDoors,
            windows:windows,keptWindows:keptWindows};
  }

  // 要約: 同じ素材ごとに部屋の名前をまとめる
  function groupRooms(list){
    var by={};
    list.forEach(function(r){ (by[r.texture]=by[r.texture]||[]).push(r); });
    return Object.keys(by).map(function(k){ return {texture:k,rooms:by[k]}; });
  }
  api.plan=plan; api.groupRooms=groupRooms;

  // ───── ここから下はブラウザだけ ─────
  function setCfg(setId){
    return (root.AssetSets&&root.AssetSets.sets()||[]).find(function(s){return s.id===setId;})||null;
  }
  function texName(style,key){ return (style.names&&style.names[key])||key; }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function roomLabel(r){ return String(r.n||'').trim()||'名前の無い部屋'; }

  // 内壁の面が、どの部屋に向いているか。面の中ほどから、面の外へ少し出た点で部屋を引く
  function faceRoom(w,face){
    var dx=w.x2-w.x1, dy=w.y2-w.y1, len=Math.hypot(dx,dy);
    if(len<1) return null;
    var ux=dx/len, uy=dy/len, nx=-uy*face.sign, ny=ux*face.sign;
    var t=(face.a+face.b)/2/root.U, off=(w.thick||120)/2+150;
    var r=root.roomAtPointOnFloor(w.floor||1,w.x1+ux*t+nx*off,w.y1+uy*t+ny*off);
    return r?r.n:null;
  }
  function collect(){
    var D=root.DATA, floors={}, faces=[];
    (D.walls||[]).forEach(function(w){
      if((w.thick||0)<120) return;
      if(root.getWallExteriorSpans(w).length) floors[w.floor||1]=true;
      root.getWallInteriorFaces(w).forEach(function(face){
        faces.push({key:root.interiorFaceKey(w,face),room:faceRoom(w,face)});
      });
    });
    return {
      floors:Object.keys(floors).map(Number),
      rooms:(D.rooms||[]).map(function(r,i){ return {id:i,n:r.n,floor:r.floor||1}; }),
      faces:faces,
      // 扉の無い開口(door-opening・アーチ)は建具に数えない
      doors:(D.items||[]).filter(function(it){ return it&&/^door-/.test(it.type)&&!/^door-opening/.test(it.type); })
        .map(function(it){ return {id:it.id,type:it.type,finish:it.doorFinish||''}; }),
      windows:(D.items||[]).filter(function(it){ return it&&(it.type==='window'||it.type==='window-door'); })
        .map(function(it){ return {id:it.id,type:it.type,kind:typeof root.effectiveWindowKind==='function'?root.effectiveWindowKind(it):(it.windowKind||'sliding'),
          w:Number(it.w)||0,h:typeof root.windowHeightMm==='function'?root.windowHeightMm(it):(Number(it.windowHeight)||0)}; }),
      windowModels:windowModelSizes()
    };
  }
  function windowModelSizes(){
    var out={};
    Object.keys(root.FMP_ITEMS||{}).forEach(function(k){
      var f=root.FMP_ITEMS[k]; if(f&&f.category==='窓') out[f.id]={w:f.w,h:f.h};
    });
    return out;
  }
  function planFor(setId){
    var set=setCfg(setId);
    if(!set||!set.style) return null;
    return plan(collect(),set.style);
  }

  var PARTS=[
    ['exterior','外壁'],['roof','屋根'],['interior','内壁'],['floor','床'],['doors','建具'],['windows','窓']
  ];
  function partHtml(part,p,style){
    var lines=[];
    if(part==='exterior'){
      if(!p.exterior.length) return null;
      lines=p.exterior.map(function(e){ return e.floor+'階: '+esc(texName(style,e.texture)); });
    }else if(part==='roof'){
      if(!p.roof) return null;
      lines=['家全体: '+esc(texName(style,p.roof))];
    }else if(part==='interior'){
      if(!p.interior) return null;
      lines=['家全体: '+esc(texName(style,p.interior))];
      var by={};
      p.faces.forEach(function(f){ (by[f.texture]=by[f.texture]||{})[f.room]=true; });
      Object.keys(by).forEach(function(k){
        lines.push(esc(Object.keys(by[k]).join('・'))+'の壁: '+esc(texName(style,k)));
      });
    }else if(part==='doors'){
      if(!p.doors.length) return null;
      var byModel={};
      p.doors.forEach(function(d){ byModel[d.model]=(byModel[d.model]||0)+1; });
      lines=Object.keys(byModel).map(function(m){
        var f=typeof root.getFmpItem==='function'?root.getFmpItem(m):null;
        return esc(f?f.name:m)+': '+byModel[m]+'か所';
      });
      if(p.keptDoors) lines.push('<small>そのまま: 引き戸・折れ戸など '+p.keptDoors+'か所（替えられる扉が無い）</small>');
    }else if(part==='windows'){
      if(!p.windows.length) return null;
      var byWin={};
      p.windows.forEach(function(w){ byWin[w.model]=(byWin[w.model]||0)+1; });
      lines=Object.keys(byWin).map(function(m){
        var f=typeof root.getFmpItem==='function'?root.getFmpItem(m):null;
        return esc(f?f.name:m)+': '+byWin[m]+'か所';
      });
      if(p.keptWindows) lines.push('<small>そのまま: '+p.keptWindows+'か所（細長い・横長すぎるなど、縦横の比が合う窓が無い）</small>');
    }else if(part==='floor'){
      if(!p.rooms.length) return null;
      lines=groupRooms(p.rooms).map(function(g){
        var names={}; g.rooms.forEach(function(r){ names[roomLabel(r)]=true; });
        return esc(texName(style,g.texture))+': '+esc(Object.keys(names).join('・'));
      });
      if(p.skippedRooms.length){
        var sk={}; p.skippedRooms.forEach(function(r){ sk[roomLabel(r)]=true; });
        lines.push('<small>そのまま: '+esc(Object.keys(sk).join('・'))+'（屋外）</small>');
      }
    }
    return lines.map(function(l){ return '<span class="building-style-line">'+l+'</span>'; }).join('');
  }

  function open(setId){
    var doc=root.document, set=setCfg(setId), p=planFor(setId);
    if(!set||!p) return;
    close();
    var style=set.style;
    var modal=doc.createElement('div');modal.id='asset-swap-modal';modal.className='building-style-modal';
    modal.addEventListener('click',function(e){ if(e.target===modal) close(); });
    var html='<div class="asset-swap-card" role="dialog" aria-modal="true" aria-labelledby="building-style-title">';
    html+='<div class="asset-swap-title" id="building-style-title">壁・床・屋根を'+esc(set.name)+'風にする</div>';
    html+='<p class="asset-swap-sub">外観・内観・屋根の設定と、部屋の床材・扉・窓を書き換えます。チェックを外した所は替えません。'+
          '面や壁ごとに付けていた色・素材は外れます。切り替えたあとでも、Undo を1回押せば全部元に戻ります。'+
          '切り替えたあとは、今までの設定欄で1か所ずつ直せます。</p>';
    html+='<div class="asset-swap-list">';
    var any=false;
    PARTS.forEach(function(pt){
      var body=partHtml(pt[0],p,style);
      if(!body) return;
      any=true;
      html+='<label class="asset-swap-row building-style-row"><input type="checkbox" checked data-style-part="'+pt[0]+'">'+
            '<span class="asset-swap-from">'+pt[1]+'</span><span class="building-style-detail">'+body+'</span></label>';
    });
    html+='</div>';
    html+='<div class="asset-swap-actions">'+(any?'<button type="button" class="asset-swap-apply">切り替える</button>':'')+
          '<button type="button" class="asset-swap-cancel">'+(any?'やめる':'閉じる')+'</button></div></div>';
    modal.innerHTML=html;
    doc.body.append(modal);
    modal.querySelector('.asset-swap-cancel').addEventListener('click',close);
    var go=modal.querySelector('.asset-swap-apply');
    if(go) go.addEventListener('click',function(){
      var parts={};
      modal.querySelectorAll('input[data-style-part]').forEach(function(c){ if(c.checked) parts[c.dataset.stylePart]=true; });
      var done=apply(p,parts);
      close();
      var st=doc.getElementById('asset-swap-status');
      if(st) st.textContent=done?'壁・床・屋根を'+set.name+'風にしました。元に戻すときは Undo を押してください。':'';
    });
    (go||modal.querySelector('.asset-swap-cancel')).focus({preventScroll:true});
    modal.querySelector('.asset-swap-card').scrollTop=0;
  }
  function close(){ var m=root.document.getElementById('asset-swap-modal'); if(m) m.remove(); }

  function finish(target,texture){
    target.color='#ffffff'; target.texture=texture; target.textureFlipX=false; target.textureFlipY=false;
  }
  // 決めた内容を書き込む。Undo 1回で全部戻るよう、最初に1度だけ履歴を取る。
  function apply(p,parts){
    parts=parts||{exterior:true,roof:true,interior:true,floor:true,doors:true,windows:true};
    if(!Object.keys(parts).some(function(k){return parts[k];})) return 0;
    var D=root.DATA;
    root.saveState();
    if(parts.exterior&&p.exterior.length){
      var s=root.ensureExteriorWallSettings();
      s.whole.linked=false;
      p.exterior.forEach(function(e){
        var fs=s.floors[e.floor]=s.floors[e.floor]||root.defaultExteriorFloorSetting(e.floor);
        fs.linked=true; finish(fs,e.texture);
      });
      Object.keys(s.faces).forEach(function(k){ s.faces[k].mode='inherit'; });
    }
    if(parts.roof&&p.roof){
      var roof=root.ensureRoofAppearance();
      roof.whole.linked=true; finish(roof.whole,p.roof);
    }
    if(parts.interior&&p.interior){
      var ins=root.ensureInteriorWallSettings();
      ins.whole.linked=true; finish(ins.whole,p.interior);
      Object.keys(ins.faces).forEach(function(k){ ins.faces[k].mode='inherit'; });
      p.faces.forEach(function(f){
        var fs=ins.faces[f.key]=ins.faces[f.key]||{};
        fs.mode='custom'; finish(fs,f.texture);
      });
    }
    if(parts.floor){
      p.rooms.forEach(function(r){
        var room=D.rooms[r.id]; if(!room) return;
        room.floorMaterial=r.texture;
        delete room.texture; delete room.floorColor; delete room.textureFlipX; delete room.textureFlipY;
      });
    }
    if(parts.doors){
      (p.doors||[]).forEach(function(d){
        var it=(D.items||[]).find(function(x){ return x.id===d.id; });
        if(it) it.openingModel=d.model;   // 開口の大きさはそのまま(applyOpeningModelToItem は幅を扉に合わせてしまう)
      });
    }
    if(parts.windows){
      (p.windows||[]).forEach(function(w){
        var it=(D.items||[]).find(function(x){ return x.id===w.id; });
        if(it) it.openingModel=w.model;   // 開口の大きさはそのまま(窓が開口に合わせて伸縮する)
      });
    }
    if(typeof root.markDirty==='function') root.markDirty();
    if(typeof root.updateProps==='function') root.updateProps();
    if(typeof root.syncExteriorWallPanel==='function') root.syncExteriorWallPanel();
    root.draw2d();
    if(typeof root.rebuild3D==='function'&&root.ren) root.rebuild3D();
    return 1;
  }

  api.open=open; api.apply=apply; api.planFor=planFor; api.collect=collect;
  if(typeof module==='object'&&module.exports) module.exports=api;else root.BuildingStyle=api;
})(typeof window==='object'?window:globalThis);
