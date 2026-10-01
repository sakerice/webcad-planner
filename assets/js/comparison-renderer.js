/* Reuse the real application renderer in a disposable, child-only runtime.
 * The live editor never installs a comparison plan or changes its camera.
 * One child renderer captures A, then B; only PNG images return to the UI.
 */
(function(){
  'use strict';
  if(typeof COMPARISON_PREVIEW==='undefined'||!COMPARISON_PREVIEW){
    window.ComparisonCapture={async pair(plans,spec,signal){
      const frame=document.createElement('iframe');
      frame.title='比較用の読み取り専用3D';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
      frame.style.cssText='position:fixed;left:-12000px;top:0;width:960px;height:720px;border:0;pointer-events:none';
      frame.src=new URL('index.html?comparisonPreview=1',document.baseURI).href;
      let abort;
      const cancelled=new Promise((_,reject)=>{abort=()=>reject(new DOMException('Capture cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});});
      document.body.append(frame);
      let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('3D撮影が時間内に完了しませんでした。')),90000);});
      try{
        if(signal.aborted)throw new DOMException('Capture cancelled','AbortError');
        return await Promise.race([cancelled,timeout,(async()=>{
          while(!frame.contentWindow?.ComparisonRenderer){await new Promise(resolve=>setTimeout(resolve,50));if(signal.aborted||!frame.isConnected)throw new DOMException('Capture cancelled','AbortError');}
          const renderer=frame.contentWindow.ComparisonRenderer;
          const a=await renderer.capture(plans[0],spec);
          if(signal.aborted)throw new DOMException('Capture cancelled','AbortError');
          const b=await renderer.capture(plans[1],a.spec);
          return [a,b];
        })()]);
      }finally{
        clearTimeout(timer);signal.removeEventListener('abort',abort);
        try{frame.contentWindow?.ComparisonRenderer?.dispose();}catch(_){}
        frame.remove();
      }
    }};
    return;
  }
  const clone=value=>JSON.parse(JSON.stringify(value));
  let pending=0,failures=[],disposed=false,active=false;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const ready=(async()=>{
    const deadline=Date.now()+20000;
    while(!window.THREE){if(Date.now()>deadline)throw Error('3Dライブラリを読み込めませんでした。');await delay(30);}
    await window.comparisonCatalogueReady;
    const manager=THREE.DefaultLoadingManager;
    const start=manager.itemStart.bind(manager),end=manager.itemEnd.bind(manager);
    manager.itemStart=url=>{pending++;start(url);};
    manager.itemEnd=url=>{pending=Math.max(0,pending-1);end(url);};
    manager.onError=url=>failures.push(url);
    const style=document.createElement('style');
    style.textContent='#c3d-wrap{display:block!important;position:fixed!important;inset:0!important;width:960px!important;height:720px!important}#compare-launch{display:none!important}';
    document.head.append(style);
  })();
  async function settle(){
    const deadline=Date.now()+30000;
    let quiet=0;
    while(quiet<3){
      if(disposed)throw Error('撮影をキャンセルしました。');
      if(failures.length)throw Error('3D素材の読込に失敗しました: '+failures[0]);
      if(Date.now()>deadline)throw Error('3D素材の読込が時間内に完了しませんでした。');
      const loading=pending||Object.keys(_modelLoading).some(key=>_modelLoading[key])||_tablet3DRebuildQueued||_textureRefreshPending;
      quiet=loading?0:quiet+1;
      await delay(100);
    }
  }
  window.ComparisonRenderer={
    async capture(plan,inputSpec){
      if(active)throw Error('比較撮影は順番に実行してください。');
      active=true;
      try{
        await ready;
        if(disposed)throw Error('撮影をキャンセルしました。');
        const spec=clone(inputSpec);
        failures=[];
        DATA=clone(plan);_defaultPlanPending=false;
        resetHeightGlobalsForPlanLoad();ensureObjectIds();ensureFloorMetadata();ensureHeightDefaults();
        ensureExteriorWallSettings();ensureInteriorWallSettings();ensureRoofAppearance();
        syncExteriorWallSettings();normalizeLegacyFurnitureItems();
        LIGHT_SETTINGS=clone(spec.lighting);
        DATA.northDeg=LIGHT_SETTINGS.northDeg;
        ST.floor=spec.floor;ST.selected=null;ST.multiSelected=[];ST._camStash={};
        ST.view='2d';setView('3d-int');
        // Room presets resolve their eye level once against plan A. B receives the exact pose.
        if(!spec.pos){
          const r=spec.room;
          const eye=floorTopY(spec.floor)+1.55;
          const pad=Math.min(650,r.w*.2,r.d*.2);
          spec.pos=[(r.x+pad)*U,eye,(r.y+r.d-pad)*U];
          spec.target=[(r.x+r.w*.75)*U,eye-.1,(r.y+r.d*.2)*U];
          delete spec.room;
        }
        await settle();
        perform3DRebuild();
        await settle();
        orbit.enableDamping=false;orbit.autoRotate=false;orbit.enabled=false;
        // Flush residual orbit movement before installing the requested pose.
        orbit.update();
        camExt.position.fromArray(spec.pos);camExt.up.fromArray(spec.up||[0,1,0]);
        orbit.target.fromArray(spec.target);camExt.fov=spec.fov;camExt.near=.01;
        camExt.aspect=spec.width/spec.height;camExt.updateProjectionMatrix();
        camExt.lookAt(new THREE.Vector3().fromArray(spec.target));camExt.updateMatrixWorld(true);
        ren.setPixelRatio(1);ren.setSize(spec.width,spec.height);
        if(composer){if(composer.setPixelRatio)composer.setPixelRatio(1);composer.setSize(spec.width,spec.height);}
        applyLightingToScene(false);
        updateInteriorCutawayWalls();invalidateLightBudget();
        if(ren.shadowMap)ren.shadowMap.needsUpdate=true;
        render3DNow();render3DNow();
        const png=ren.domElement.toDataURL('image/png');
        if(png.length<1000)throw Error('3D画像を取得できませんでした。');
        return {png,spec,actual:{up:camExt.up.toArray(),aspect:camExt.aspect,pixelRatio:ren.getPixelRatio(),pos:camExt.position.toArray(),target:orbit.target.toArray(),fov:camExt.fov,width:ren.domElement.width,height:ren.domElement.height,lighting:clone(LIGHT_SETTINGS)}};
      }finally{active=false;}
    },
    dispose(){disposed=true;if(ren){ren.dispose();ren.forceContextLoss();}}
  };
})();
