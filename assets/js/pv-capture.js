// PV の撮影用の口(window.__PV_CAPTURE__)。URL に ?pvCapture=1 を付けたときだけ index.html の末尾が読み込む。
// 普段の利用者には読み込まれない。もとは index.html の末尾にあった(2026-11-20 に切り出した)。
//
// ここはアプリ本体の後に読まれるので、本体のグローバル(DATA・ST・sc3・setView など)をそのまま使う。
// PV_INTERIOR_DAYLIGHT(assets/js/app-constants.js)を書き換えてよいのは、ここだけ
// (pv/tools/truth-render/tests/interior-daylight-guards.test.mjs が見張っている)。
/* ===== PV capture hook (guarded; no effect unless ?pvCapture=1) ===== */
(function(){
  try{
    if(new URLSearchParams(location.search||'').get('pvCapture')!=='1') return;
    // captureInstance3DData() は画像と legend を同時に返す。legend
    // (部材ID -> 色 -> 種別・寸法) が無いと Layer 3 は「どの家具が消えたか」を
    // 一切名指しできないので、captureGuide の呼び出しで得たものを保持し、
    // runner が取り出して instance-legend.json として書き出せるようにする。
    var lastInstanceLegend=null;

    // ── 内観の実採光 ───────────────────────────────────────────────
    // 内観3D(3d-int)は上から間取りを読めるよう天井を作らず、太陽も消灯している。
    // そのまま太陽だけ点けると、天井の無い部屋へ真上から日射が降り注ぐ物理的に
    // あり得ない絵になる。天井を「カメラには描かれないがシャドウマップには入る」
    // オクルーダーとして生成することで、日射が窓と階段の吹き抜けからだけ入る。
    //
    // オクルーダー化は**生成時**に決まる(makeCeilingMaterial /
    // buildRoomCeilingMesh)。ここフックから後付けで差し替えてはならない:
    // GLBの読み込み完了で scheduleGltfRebuild3D() が setTimeout 経由で
    // rebuild3D() を呼ぶため、後付けの差し替えは撮影開始前に静かに巻き戻る。
    // 実際にそれで「部屋全体が不透明な天井で覆われた俯瞰」が撮れてしまった。
    // ここで行うのは**観測だけ**で、状態を変えない。
    function pvCeilingCensus(){
      var ceilings=0, occluders=0;
      sc3.traverse(function(o){
        if(!o.isMesh || !o.userData || !o.userData.ceiling) return;
        ceilings++;
        var m=o.material;
        // 「本当に描かれないか」をマテリアルの実値で見る。userData のフラグを
        // 信用すると、材質だけ差し替わった場合に嘘をつく。
        if(m && m.colorWrite===false && m.depthWrite===false && o.castShadow===true) occluders++;
      });
      return {ceilings:ceilings,occluders:occluders};
    }
    // 実際にシーンへ効いた採光状態。runner はこれを検査し、shot.json にも残す。
    function pvDaylightState(){
      var sun=null;
      sc3.traverse(function(o){ if(o.isDirectionalLight) sun=o; });
      var cam=sun&&sun.shadow?sun.shadow.camera:null;
      var census=pvCeilingCensus();
      return {
        enabled:!!PV_INTERIOR_DAYLIGHT,
        sunScale:PV_INTERIOR_DAYLIGHT?PV_INTERIOR_DAYLIGHT.sunScale:0,
        timeOfDay:LIGHT_SETTINGS.timeOfDay,
        sunSim:!!LIGHT_SETTINGS.sunSim,
        sunIntensity:sun?sun.intensity:0,
        sunCastShadow:!!(sun&&sun.castShadow),
        sunPosition:sun?[sun.position.x,sun.position.y,sun.position.z]:null,
        shadowMapSize:(sun&&sun.shadow)?[sun.shadow.mapSize.x,sun.shadow.mapSize.y]:null,
        shadowCameraSpanM:cam?(cam.right-cam.left):null,
        ceilings:census.ceilings,
        ceilingOccluders:census.occluders
      };
    }
    // 「天井はあるのにオクルーダーが1枚も無い」= 部屋が不透明な板で覆われた絵に
    // なる、という自己矛盾。黙って描かず、その場で落とす。
    function pvAssertNoCoveredRoom(state,when){
      if(!state.enabled) return state;
      if(state.ceilings>0 && state.ceilingOccluders===0){
        throw new Error('[pv-capture] interior daylight is on and '+state.ceilings+
          ' ceiling mesh(es) exist, but none of them is a shadow-only occluder ('+when+'). '+
          'The overhead frame would be an opaque slab covering the room.');
      }
      return state;
    }

    window.__PV_CAPTURE__={
      version:5,
      // 内観の実採光を入れる/戻す。cfg が falsy なら元の内観(天井なし・太陽消灯)へ戻す。
      // 戻り値は実際にシーンへ効いた状態で、太陽が点いたか・天井オクルーダーが
      // 何枚できたかを呼び出し側が独立に検査できるようにしている。
      setInteriorDaylight:function(cfg){
        if(!cfg){
          PV_INTERIOR_DAYLIGHT=null;
        }else{
          var s=Number(cfg.sunScale);
          PV_INTERIOR_DAYLIGHT={sunScale:(isFinite(s)&&s>0)?s:1};
        }
        // 順序が重要: applyLightingToScene は太陽をプリセットの絶対座標
        // (昼なら 100,200,100)へ置き直す。影カメラを建物へフィットさせる
        // build3D(fitShadowCamera)より先に呼ばないと、太陽が影カメラの far の
        // 外側に残り、影が一枚も出ない状態になる。
        applyLightingToScene(false);
        // rebuild3D() ではなく perform3DRebuild() を直接呼ぶ。rebuild3D は
        // タブレット判定に当たると requestAnimationFrame まで再構築を遅らせるため、
        // 戻った時点でまだ天井が無いことがある。ここは同期的に作り切る。
        // 天井のオクルーダー化はこの再構築の中(生成時)で完了しており、
        // ここから後付けで触ることは無い。
        perform3DRebuild();
        if(ren&&ren.shadowMap) ren.shadowMap.needsUpdate=true;
        if(typeof invalidate3D==='function') invalidate3D();
        return pvAssertNoCoveredRoom(pvDaylightState(),'right after enabling');
      },
      // 今この瞬間のシーンを測り直す(状態は変えない)。runner は最初のフレームの
      // 直前と最後のフレームの直後に呼び、撮影中に非同期の再構築が採光を
      // 巻き戻していないことを確かめる。以前の実装はまさにそこで壊れた。
      inspectInteriorDaylight:function(when){
        return pvAssertNoCoveredRoom(pvDaylightState(),when||'on inspection');
      },
      ensure3D:function(){ return ensureAiRenderable3D(); },
      // 家具GLBは ensureGltfModel() が GLTFLoader で非同期に読み込む。
      // ロード中は _modelLoading[url]===true、完了で _modelCache[url] に
      // 入って _modelLoading から false に落ちる(index.html 内 ensureGltfModel
      // 参照)。この2つは three.js 本体が読み書きする唯一の権威的な状態で、
      // 「まだ読み込み中の家具モデルURLの一覧」を過不足なく表す。
      // ここではその2つを直接読むだけで、キャプチャ側の推測(タイマー等)を
      // 一切足さない。何も読み込み中でなければ空配列を返す。
      pendingModelLoads:function(){
        return Object.keys(_modelLoading).filter(function(url){ return !!_modelLoading[url]; });
      },
      setView:function(v){ return setView(v); },
      getView:function(){ return ST.view; },
      // 実行中のプランを識別する。shot spec の "plan" と突き合わせるためのもの。
      // アプリはプラン名を持たないが、「デフォルトプランが効いているか」は
      // 判定できる: _defaultPlanPending は起動時 true で、IndexedDB 復元・
      // 共同編集参加・ファイル取り込みのいずれかが起きたときだけ false になる
      // (loadPreset は成功しても true のまま)。したがって true は
      // 「assets/default_plan.json 以外は読まれていない」と同値である。
      // 一致しない場合に runner 側で落とせるよう、正体の分かる文字列を返す。
      getPlanId:function(){
        var hasPlan=!!(DATA&&((DATA.walls&&DATA.walls.length)||(DATA.items&&DATA.items.length)||(DATA.rooms&&DATA.rooms.length)));
        if(!hasPlan) return '(no plan loaded yet)';
        if(typeof SHARED!=='undefined' && SHARED && SHARED.roomId) return 'shared-room:'+SHARED.roomId;
        if(!_defaultPlanPending) return '(a saved or imported plan, not the default plan)';
        return 'assets/default_plan.json';
      },
      // フロア切替はアプリ自身の既存経路(#floor-sel の onchange と同じ onFloorChange)
      // に委譲する。ST.floor を直接書き換えると、選択解除・#st-floor 表示更新・
      // draw2d 再描画が一切走らず、
      // アプリの他部分が古いフロアの状態を参照し続ける恐れがあるため。
      // getFloor は ST.floor をそのまま読み返す — setFloor の戻り値を信用せず、
      // 呼び出し元(capture-runner.mjs)が実際に反映されたかを別途確認できるようにする。
      setFloor:function(floor){ onFloorChange(floor); },
      getFloor:function(){ return ST.floor; },
      // #c3d-wrap を厳密な CSS px サイズへ固定し、既存の window resize ハンドラ
      // (下記 window.addEventListener('resize',...) 参照)と同じ手順で
      // ren/composer/camExt/camInt を追従させる。captureCurrent3DDataUrl 等は
      // wrap.clientWidth/clientHeight から解像度を導出するため、これでショット
      // 全体を通じて出力アスペクト比とピクセル寸法を固定できる。
      setCaptureViewport:function(width,height){
        var wrap=document.getElementById('c3d-wrap');
        var prev={width:wrap.style.width,height:wrap.style.height};
        wrap.style.width=width+'px';
        wrap.style.height=height+'px';
        try{
          if(ren){
            ren.setSize(wrap.clientWidth,wrap.clientHeight);
            if(typeof composer!=='undefined' && composer) composer.setSize(wrap.clientWidth,wrap.clientHeight);
            [camExt,camInt].forEach(function(c){
              if(c){ c.aspect=wrap.clientWidth/wrap.clientHeight; c.updateProjectionMatrix(); }
            });
            invalidate3D();
          }
        }catch(e){
          // ren/composer/camera 側の適用に失敗しても、wrap の inline サイズだけは
          // 必ず呼び出し前の状態へ戻してから再送出する。呼び出し元
          // (capture-runner.mjs) の finally 節は、この関数が prev を return
          // して初めて復元できるため、途中で投げた場合はここで自前に戻す。
          wrap.style.width=prev.width;
          wrap.style.height=prev.height;
          throw e;
        }
        return prev;
      },
      restoreCaptureViewport:function(prev){
        var wrap=document.getElementById('c3d-wrap');
        wrap.style.width=(prev&&prev.width)||'';
        wrap.style.height=(prev&&prev.height)||'';
        if(ren){
          ren.setSize(wrap.clientWidth,wrap.clientHeight);
          if(typeof composer!=='undefined' && composer) composer.setSize(wrap.clientWidth,wrap.clientHeight);
          [camExt,camInt].forEach(function(c){
            if(c){ c.aspect=wrap.clientWidth/wrap.clientHeight; c.updateProjectionMatrix(); }
          });
          invalidate3D();
        }
      },
      // OrbitControls の damping / autoRotate はキャプチャ中は切る必要があるが、
      // 切りっぱなしにするとキャプチャ後のユーザー操作の手触りが恒久的に変わる。
      // 呼び出し前の値を返し、runner の finally で戻せるようにする。
      captureOrbitState:function(){
        if(typeof orbit==='undefined' || !orbit) return null;
        return {enableDamping:orbit.enableDamping,autoRotate:orbit.autoRotate};
      },
      restoreOrbitState:function(prev){
        if(!prev || typeof orbit==='undefined' || !orbit) return;
        orbit.enableDamping=prev.enableDamping;
        orbit.autoRotate=prev.autoRotate;
      },
      setPose:function(pos,target,fov){
        var cam=getActive3DCamera();
        if(!cam) throw new Error('no active 3D camera');
        // OrbitControls の damping / autoRotate は再現性を壊すので必ず切る。
        // 元の値は captureOrbitState() で先に控えてある前提。
        if(typeof orbit!=='undefined' && orbit){
          orbit.enableDamping=false;
          orbit.autoRotate=false;
        }
        cam.position.set(pos[0],pos[1],pos[2]);
        if(typeof fov==='number' && fov>0){ cam.fov=fov; }
        cam.updateProjectionMatrix();
        if(typeof orbit!=='undefined' && orbit && orbit.object===cam){
          orbit.target.set(target[0],target[1],target[2]);
          orbit.update();
        }else{
          cam.lookAt(new THREE.Vector3(target[0],target[1],target[2]));
        }
        cam.updateMatrixWorld(true);
      },
      renderNow:function(){
        if(ren&&ren.shadowMap) ren.shadowMap.needsUpdate=true;
        var cam=getActive3DCamera();
        if(typeof layoutSetbackDimLabels==='function') layoutSetbackDimLabels(cam);
        if(typeof composer!=='undefined' && composer) composer.render();
        else ren.render(sc3,cam);
      },
      captureBase:function(){ return Promise.resolve(captureCurrent3DDataUrl()); },
      captureGuide:function(kind){
        if(kind==='base') return Promise.resolve(captureCurrent3DDataUrl());
        if(kind==='segmentation') return Promise.resolve(captureSegmentation3DDataUrl());
        if(kind==='depth') return Promise.resolve(captureAiOverrideGuideDataUrl('depth'));
        if(kind==='normal') return Promise.resolve(captureAiOverrideGuideDataUrl('normal'));
        if(kind==='instance'){
          var inst=captureInstance3DData();
          lastInstanceLegend=inst.legend;
          return Promise.resolve(inst.dataUrl);
        }
        if(kind==='edge'){
          var forEdge=captureInstance3DData();
          lastInstanceLegend=forEdge.legend;
          return makeEdgeDataUrlFromSegmentation(forEdge.dataUrl);
        }
        return Promise.reject(new Error('unknown guide kind: '+kind));
      },
      // 直近の instance / edge キャプチャで得た legend。まだ一度も撮っていなければ null。
      getInstanceLegend:function(){ return lastInstanceLegend; }
    };
    // 毎回モジュールを取り直す。ここは ?pvCapture=1 のときだけ通る撮影専用の
    // 経路で、ランナーは開発中に何度も書き換わる。実際、ランナーを直した直後の
    // 撮影2回がどちらもブラウザのキャッシュ(304)で古い実装を読み込み、出力が
    // 1ビットも変わらないまま「修正が効かなかった」と誤読しかけた。
    // 撮影は決定論的なので、古い実装で撮り直しても結果が同一になり、
    // キャッシュ事故と「修正が無効」が見分けられない。
    import('/pv/tools/truth-render/capture-runner.mjs?v='+Date.now()).catch(function(e){
      console.error('[pv-capture] runner failed to load',e);
    });
  }catch(e){ console.error('[pv-capture] hook init failed',e); }
})();
