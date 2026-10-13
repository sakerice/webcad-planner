// ブラウザに複数のプランを名前付きで残す一覧（作り直し計画 2-5）。
//
// 今までの「保存」はブラウザに1つだけ置く（StorageAdapter。起動時の「前回保存したプランがあります」）。
// これはそのまま「前回のプラン」として残し、別の入れ物に「名前を付けて保存」した物を並べる。
// 比較モードで左右どちらも保存できるようにするため（右を前回のプランへ入れると左が上書きされる）。
//
// 開いているプランが一覧のどれから来たか（PLAN_LIBRARY_ID）と、最後にどこへ保存したか（PLAN_SAVE_INFO）は
// 全体の変数に持つ。比較モードは左右でこの2つも入れ替える。
var PLAN_LIBRARY_ID = null;
// {where:'last'|'list', name, at}。null はブラウザにまだ保存していない
var PLAN_SAVE_INFO = null;

var PlanLibrary = (function(){
  var DB_NAME = 'webcad-library', VERSION = 1;
  function openDB(){
    return new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function(){
        var db = req.result;
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath:'id'});
        if(!db.objectStoreNames.contains('data')) db.createObjectStore('data');
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
  }
  function tx(stores, mode, fn){
    return openDB().then(function(db){
      return new Promise(function(resolve, reject){
        var t = db.transaction(stores, mode), out;
        t.oncomplete = function(){ resolve(out); };
        t.onerror = function(){ reject(t.error); };
        t.onabort = function(){ reject(t.error || new Error('保存できませんでした')); };
        out = fn(t);
      });
    });
  }
  function req(r){ return new Promise(function(resolve, reject){ r.onsuccess = function(){ resolve(r.result); }; r.onerror = function(){ reject(r.error); }; }); }
  function serialize(data){ return JSON.stringify(data, function(k, v){ return k==='_texObj' ? undefined : v; }); }

  function list(){
    return openDB().then(function(db){
      return req(db.transaction('meta','readonly').objectStore('meta').getAll());
    }).then(function(rows){ return (rows||[]).sort(function(a, b){ return b.savedAt - a.savedAt; }); });
  }
  function get(id){
    return openDB().then(function(db){ return req(db.transaction('data','readonly').objectStore('data').get(id)); })
      .then(function(s){ return s ? JSON.parse(s) : null; });
  }
  function put(entry){
    var id = entry.id || ('p'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
    var meta = {id:id, name:entry.name, savedAt:Date.now(), thumb:entry.thumb||''};
    var json = serialize(entry.plan);
    return tx(['meta','data'], 'readwrite', function(t){
      t.objectStore('meta').put(meta);
      t.objectStore('data').put(json, id);
    }).then(function(){ return meta; });
  }
  function rename(id, name){
    return tx(['meta'], 'readwrite', function(t){
      var s = t.objectStore('meta'), r = s.get(id);
      r.onsuccess = function(){ if(r.result){ r.result.name = name; s.put(r.result); } };
    });
  }
  function remove(id){
    return tx(['meta','data'], 'readwrite', function(t){ t.objectStore('meta').delete(id); t.objectStore('data').delete(id); });
  }

  // 保存の前に、ボタンの「保存」と同じ下ごしらえをする（壁・床の既定値や表示位置をプランへ写す）
  function prepare(){
    normalizeLegacyFurnitureItems(); ensureObjectIds(); ensureExteriorWallSettings(); ensureInteriorWallSettings();
    ensureRoofAppearance(); ensureFloorMetadata(); ensureHeightDefaults(); syncExteriorWallSettings(); captureViewState();
  }
  // 一覧に出す縮小画像。平面図を構図を合わせて撮り、小さくする
  function thumbnail(){
    var src;
    try{ src = capturePlan2dDataUrl({fit:true, selection:false, grid:false, annotations:false}); }catch(e){ return Promise.resolve(''); }
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = function(){
        var W = 240, H = Math.round(W*img.height/img.width), c = document.createElement('canvas');
        c.width = W; c.height = H;
        var g = c.getContext('2d'); g.fillStyle = '#f2f4f7'; g.fillRect(0,0,W,H); g.drawImage(img, 0, 0, W, H);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = function(){ resolve(''); };
      img.src = src;
    });
  }
  function nowLabel(t){
    var d = new Date(t), p = function(n){ return (n<10?'0':'')+n; };
    return (d.getMonth()+1)+'/'+d.getDate()+' '+p(d.getHours())+':'+p(d.getMinutes());
  }

  // いま開いているプランを一覧へ保存する。一覧から開いた物なら上書き、そうでなければ名前をたずねて新しく足す。
  // 縮小画像を撮るので、呼ぶ側は「いま編集している側」の中身が全体の変数に入った状態で呼ぶ
  function saveCurrent(opts){
    opts = opts || {};
    var ask = (!PLAN_LIBRARY_ID || opts.asNew)
      ? askName(opts.title || '名前を付けて保存', DATA.planName || opts.defaultName || '')
      : Promise.resolve(null);
    return ask.then(function(name){
      if(!PLAN_LIBRARY_ID || opts.asNew){
        if(!name) return null;
        DATA.planName = name;
        PLAN_LIBRARY_ID = null;
      }
      prepare();
      return thumbnail().then(function(thumb){
        return list().then(function(rows){
          var cur = PLAN_LIBRARY_ID && rows.find(function(r){ return r.id===PLAN_LIBRARY_ID; });
          return put({id:cur ? cur.id : null, name:DATA.planName || (cur && cur.name) || '名前なし', plan:DATA, thumb:thumb});
        });
      }).then(function(meta){
        PLAN_LIBRARY_ID = meta.id;
        PLAN_SAVE_INFO = {where:'list', name:meta.name, at:meta.savedAt};
        if(!opts.keepDirty) clearDirty();
        return meta;
      });
    }).catch(function(e){ alert('ブラウザへの保存に失敗しました: '+(e && e.message || e)); return null; });
  }

  // 読み込んだプランを、ファイルの読込と同じ手順で、いま編集している側へ入れる
  function loadIntoEditor(plan, id, name){
    _defaultPlanPending = false;
    DATA = plan;
    resetHeightGlobalsForPlanLoad(); syncNorthFromPlan(); ensureObjectIds(); ensureExteriorWallSettings(); ensureInteriorWallSettings();
    ensureRoofAppearance(); ensureFloorMetadata(); ensureHeightDefaults(); syncHeightDefaultsUI(); syncExteriorWallSettings();
    normalizeLegacyFurnitureItems(); restoreViewState(); clearEditHistory();
    if(typeof sharedForceFullSync==='function') sharedForceFullSync();
    PLAN_LIBRARY_ID = id;
    PLAN_SAVE_INFO = id ? {where:'list', name:name, at:Date.now()} : {where:'last', at:null};
    clearDirty();
    ST.selected = null;
    var props = document.getElementById('props'); if(props) props.classList.remove('show');
    draw2d(); if(typeof ren!=='undefined' && ren) rebuild3D();
  }

  // ───── 画面 ─────
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text!=null) e.textContent = text; return e; }
  function modal(){
    var old = document.getElementById('plan-library-modal'); if(old) old.remove();
    var m = el('div'); m.id = 'plan-library-modal';
    var card = el('div', 'asset-swap-card plan-library-card'); card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true');
    m.append(card);
    m.addEventListener('click', function(e){ if(e.target===m) m.remove(); });
    document.body.append(m);
    return {root:m, card:card, close:function(){ m.remove(); }};
  }
  function askName(title, initial){
    return new Promise(function(resolve){
      var d = modal();
      var input = el('input', 'plan-library-name-input'); input.type = 'text'; input.maxLength = 60; input.value = initial || '';
      input.placeholder = '例: LDK拡張案'; input.setAttribute('aria-label','プランの名前');
      var ok = el('button', 'asset-swap-apply', '保存する'), cancel = el('button', 'asset-swap-cancel', 'やめる');
      ok.type = cancel.type = 'button';
      var actions = el('div', 'asset-swap-actions'); actions.append(cancel, ok);
      d.card.append(el('div', 'asset-swap-title', title), el('div', 'asset-swap-sub', '一覧に出す名前です。あとから変えられます。'), input, actions);
      var done = function(v){ d.close(); resolve(v); };
      ok.addEventListener('click', function(){ var v = input.value.trim(); if(!v){ input.focus(); return; } done(v.slice(0,60)); });
      cancel.addEventListener('click', function(){ done(null); });
      input.addEventListener('keydown', function(e){ e.stopPropagation(); if(e.key==='Enter') ok.click(); if(e.key==='Escape') done(null); });
      d.root.addEventListener('click', function(e){ if(e.target===d.root) resolve(null); });
      setTimeout(function(){ input.focus(); input.select(); }, 0);
    });
  }

  // 一覧の画面。mode='manage' は開く・名前を変える・書き出す・削除、mode='pick' は選んだ物を onPick へ渡す
  function openList(opts){
    opts = opts || {};
    var pick = opts.mode==='pick';
    var d = modal();
    d.card.append(el('div', 'asset-swap-title', pick ? (opts.title || 'ブラウザに保存したプランから選ぶ') : 'ブラウザに保存したプラン'));
    d.card.append(el('div', 'asset-swap-sub', 'このブラウザの中にだけ残ります。ブラウザのデータを消すと失われるので、大事なプランは「JSON」で書き出しておいてください。'));
    if(!pick){
      var saveNew = el('button', 'asset-swap-open plan-library-save-new', '今のプランを名前を付けて保存'); saveNew.type = 'button';
      saveNew.addEventListener('click', function(){ d.close(); api.saveAs(); });
      d.card.append(saveNew);
    }
    var listEl = el('div', 'plan-library-list'); d.card.append(listEl);
    var actions = el('div', 'asset-swap-actions'); var close = el('button', 'asset-swap-cancel', '閉じる'); close.type = 'button';
    close.addEventListener('click', d.close); actions.append(close); d.card.append(actions);

    function row(info){
      var r = el('div', 'plan-library-row');
      var th = el('div', 'plan-library-thumb'); if(info.thumb){ var im = el('img'); im.src = info.thumb; im.alt = ''; th.append(im); }
      var body = el('div', 'plan-library-body');
      body.append(el('div', 'plan-library-name', info.name), el('div', 'plan-library-date', info.date));
      var btns = el('div', 'plan-library-actions');
      info.buttons.forEach(function(b){ var x = el('button', 'plan-library-btn'+(b[2]?' '+b[2]:''), b[0]); x.type = 'button'; x.addEventListener('click', b[1]); btns.append(x); });
      body.append(btns);
      r.append(th, body);
      return r;
    }
    function confirmReplace(){ return !DIRTY || confirm('いま開いているプランに、保存していない変更があります。開くと失われます。開きますか？'); }
    Promise.all([list(), StorageAdapter.hasData()]).then(function(res){
      var rows = res[0], hasLast = res[1];
      if(hasLast){
        listEl.append(row({name:'前回のプラン', date:'「保存」ボタンで残したプラン', thumb:'', buttons: pick
          ? [['右に開く', function(){ StorageAdapter.load().then(function(p){ d.close(); if(p) opts.onPick(p, null, '前回のプラン'); }); }, 'primary']]
          : [['開く', function(){ if(!confirmReplace()) return; StorageAdapter.load().then(function(p){ d.close(); if(p) loadIntoEditor(p, null, null); }); }, 'primary']]}));
      }
      rows.forEach(function(m){
        var open = function(){ get(m.id).then(function(p){ if(!p) return alert('読み込めませんでした。'); d.close(); if(pick) opts.onPick(p, m.id, m.name); else if(confirmReplace()) loadIntoEditor(p, m.id, m.name); }); };
        listEl.append(row({name:m.name, date:nowLabel(m.savedAt)+' に保存', thumb:m.thumb, buttons: pick
          ? [['右に開く', open, 'primary']]
          : [['開く', open, 'primary'],
             ['名前を変える', function(){ askName('名前を変える', m.name).then(function(n){ if(!n) return openList(opts);
               rename(m.id, n).then(function(){ if(PLAN_LIBRARY_ID===m.id){ DATA.planName = n; if(PLAN_SAVE_INFO) PLAN_SAVE_INFO.name = n; } openList(opts); }); }); }],
             ['JSON', function(){ get(m.id).then(function(p){ if(!p) return; var name = (m.name||'plan').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_');
               var t = new Date(m.savedAt), z = function(n){ return (n<10?'0':'')+n; };
               downloadJsonFile(JSON.stringify(p, null, 2), name+'_'+t.getFullYear()+z(t.getMonth()+1)+z(t.getDate())+'.json'); }); }],
             ['削除', function(){ if(!confirm('「'+m.name+'」を一覧から削除しますか？元に戻せません。')) return;
               remove(m.id).then(function(){ if(PLAN_LIBRARY_ID===m.id){ PLAN_LIBRARY_ID = null; PLAN_SAVE_INFO = null; } openList(opts); }); }, 'danger']]}));
      });
      if(!hasLast && !rows.length) listEl.append(el('div', 'plan-library-empty', 'まだ保存したプランがありません。'));
    });
  }

  // ───── 既存の処理へのつなぎ ─────
  function install(){
    // 「保存」: 今までどおり前回のプランへ入れる。一覧から開いたプランなら、一覧の方も更新する
    var baseSave = savePlanToStorage;
    savePlanToStorage = async function(){
      var r = await baseSave.apply(this, arguments);
      if(DIRTY) return r;                         // 失敗・空のプランなど
      PLAN_SAVE_INFO = {where:'last', at:Date.now()};
      if(PLAN_LIBRARY_ID){ var meta = await saveCurrent({}); if(meta) PLAN_SAVE_INFO = {where:'list', name:meta.name, at:meta.savedAt, alsoLast:true}; }
      return r;
    };
    // 別のプランを読み込んだら、一覧との結び付きを外す
    var baseImport = doImport;
    doImport = function(){ PLAN_LIBRARY_ID = null; PLAN_SAVE_INFO = null; return baseImport.apply(this, arguments); };
    var baseLoadStorage = loadPlanFromStorage;
    loadPlanFromStorage = async function(){ var ok = await baseLoadStorage.apply(this, arguments); if(ok){ PLAN_LIBRARY_ID = null; PLAN_SAVE_INFO = {where:'last', at:null}; } return ok; };
    var basePreset = loadPreset;
    loadPreset = function(){ PLAN_LIBRARY_ID = null; PLAN_SAVE_INFO = null; return basePreset.apply(this, arguments); };
  }
  window.addEventListener('load', install);

  var api = {
    list:list, get:get, put:put, rename:rename, remove:remove, saveCurrent:saveCurrent, openList:openList, askName:askName,
    loadIntoEditor:loadIntoEditor, nowLabel:nowLabel,
    saveAs:function(){ return saveCurrent({asNew:true}); }
  };
  return api;
})();
