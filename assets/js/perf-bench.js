// 性能の基準を測る。URL に ?bench=1 を付けたときだけ読み込まれる（index.html の末尾）。
//
// なぜ要るか: 「軽くなった／重くなった」を数字で言えるようにするため。
// 下限の端末(iPad Pro 第2・第3世代)では Playwright を動かせないので、
// 同じ手順をページの中で流し、結果を画面に出してコピーできるようにする。
// Mac では tools/perf/run_bench.mjs がこれを呼んで、結果をファイルに残す。
//
// 測るもの（間取りは ?preset=2f / 3f で選ぶ）:
//   - 3Dに入るまでの時間（モデルの読み込みが終わり、最初の1コマが出るまで）
//   - 1コマの間隔（利用者が感じる滑らかさ。タッチ端末は app 側で 30fps に抑えている）
//   - 1コマを描くのにかかる時間（GPU の仕事が終わるまで待って測る。
//     間隔は上限で頭打ちになるので、余力はこちらで見る）
//   - 描画の呼び出し数・三角形の数
// 場面: 外観3D・内観3D を「止まって見ている（最高画質）」「回している（操作中の画質）」、
//       ウォークスルーで前へ歩きながら向きを変える。
(function(){
  'use strict';
  if(!/[?&]bench=1\b/.test(location.search)) return;

  var STILL_FRAMES=90, MOVE_FRAMES=150;

  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function nextFrame(){ return new Promise(function(r){ requestAnimationFrame(function(t){ r(t); }); }); }
  function stats(list){
    var a=list.slice().sort(function(x,y){ return x-y; });
    if(!a.length) return {median:null,p95:null};
    function q(p){ return a[Math.min(a.length-1,Math.floor(p*(a.length-1)))]; }
    return {median:+q(0.5).toFixed(2), p95:+q(0.95).toFixed(2)};
  }
  async function waitFor(cond,timeoutMs){
    var t0=performance.now();
    while(!cond()){
      if(performance.now()-t0>timeoutMs) throw new Error('時間切れ');
      await sleep(50);
    }
    return performance.now()-t0;
  }

  // 1コマを描くのにかかる時間を、GPU の仕事が終わるまで待って測る。
  // gl.finish() は測定中だけ挟む（普段の描画には入れない）。
  var renderCosts=null, lastInfo={calls:0,triangles:0};
  var originalRender=window.render3DNow;
  window.render3DNow=function(){
    if(!renderCosts) return originalRender.apply(this,arguments);
    // 後処理(AO・Bloom・出力)は各段で info を数え直すので、1コマ分を自分で数える
    var auto=ren.info.autoReset;
    ren.info.autoReset=false; ren.info.reset();
    var t0=performance.now();
    var out=originalRender.apply(this,arguments);
    try{ ren.getContext().finish(); }catch(e){}
    renderCosts.push(performance.now()-t0);
    lastInfo={calls:ren.info.render.calls, triangles:ren.info.render.triangles};
    ren.info.autoReset=auto;
    return out;
  };

  async function measure(frames,eachFrame){
    var intervals=[], last=null;
    renderCosts=[];
    for(var i=0;i<frames;i++){
      eachFrame(i);
      var t=await nextFrame();
      if(last!==null) intervals.push(t-last);
      last=t;
    }
    var costs=renderCosts; renderCosts=null;
    var info=lastInfo;
    var iv=stats(intervals), rc=stats(costs);
    return {
      intervalMedianMs:iv.median, intervalP95Ms:iv.p95,
      fps:iv.median?+(1000/iv.median).toFixed(1):null,
      renderMedianMs:rc.median, renderP95Ms:rc.p95, rendered:costs.length,
      calls:info.calls||0, triangles:info.triangles||0
    };
  }

  async function enter(view){
    var t0=performance.now();
    setView(view);
    await nextFrame();
    await waitFor(function(){ return !hasPendingGltfModels(); },120000);
    renderCosts=[];
    await waitFor(function(){ return renderCosts.length>0; },30000).catch(function(){});
    renderCosts=null;
    return +(performance.now()-t0).toFixed(0);
  }

  function orbitStep(i){
    // 注視点のまわりを一定の角速度で回す。操作中として扱わせるため入力の印も付ける。
    var c=camExt, t=orbit.target;
    var dx=c.position.x-t.x, dz=c.position.z-t.z, a=0.012;
    c.position.x=t.x+dx*Math.cos(a)-dz*Math.sin(a);
    c.position.z=t.z+dx*Math.sin(a)+dz*Math.cos(a);
    c.lookAt(t);
    noteCam3DInput();
    invalidate3D();
  }
  function still(){ invalidate3D(); }

  async function run(){
    var preset=(location.search.match(/[?&]preset=([^&]+)/)||[])[1]||'(既定)';
    var result={
      when:new Date().toISOString(), preset:preset,
      userAgent:navigator.userAgent, devicePixelRatio:window.devicePixelRatio,
      viewport:[window.innerWidth,window.innerHeight], touch:(navigator.maxTouchPoints||0)>0,
      cases:[]
    };
    // 既定間取り(?preset=)で開いたときも _defaultPlanPending は立ったままなので、
    // 壁が入って読み込み表示が消えたことで「開き終わった」とみなす。
    await waitFor(function(){
      var loading=document.getElementById('app-loading');
      return window.DATA && DATA.walls && DATA.walls.length>4 && (!loading || loading.offsetParent===null);
    },120000);
    await sleep(1500);
    var views=[['3d-ext','外観3D'],['3d-int','内観3D']];
    for(var v=0;v<views.length;v++){
      var enterMs=await enter(views[v][0]);
      await sleep(1500);
      var s=await measure(STILL_FRAMES,still);
      result.cases.push(Object.assign({name:views[v][1]+'・静止',enterMs:enterMs},s));
      var m=await measure(MOVE_FRAMES,orbitStep);
      result.cases.push(Object.assign({name:views[v][1]+'・回転'},m));
      await sleep(1000);
    }
    var walkEnter=await enter('3d-walk');
    await sleep(1500);
    iMov.w=true;
    var w=await measure(MOVE_FRAMES,function(){ WALK.yaw+=0.01; invalidate3D(); });
    iMov.w=false;
    result.cases.push(Object.assign({name:'ウォークスルー・歩行',enterMs:walkEnter},w));
    if(performance.memory) result.jsHeapMB=+(performance.memory.usedJSHeapSize/1048576).toFixed(0);
    setView('2d');
    window.__benchResult=result;
    show(result);
  }

  function show(result){
    var card=document.createElement('div');
    card.id='perf-bench-result';
    card.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;'+
      'background:#fff;color:#222;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);'+
      'padding:20px;max-width:min(92vw,720px);max-height:86vh;overflow:auto;font:13px/1.5 system-ui,sans-serif';
    var rows=result.cases.map(function(c){
      var td='<td style="padding:4px 10px;text-align:right;white-space:nowrap">';
      return '<tr><td style="padding:4px 10px 4px 0;white-space:nowrap">'+c.name+'</td>'+td+(c.enterMs!=null?c.enterMs:'')+'</td>'+td+c.fps+'</td>'+td+c.renderMedianMs+'</td>'+td+c.renderP95Ms+'</td>'+td+c.triangles.toLocaleString()+'</td></tr>';
    }).join('');
    card.innerHTML='<div style="font-weight:600;font-size:15px;margin-bottom:8px">性能の測定結果（'+result.preset+'）</div>'+
      '<table style="border-collapse:collapse;width:100%"><thead><tr style="text-align:left">'+
      '<th style="padding:4px 10px 4px 0">場面</th><th style="padding:4px 10px;text-align:right">入るまで(ms)</th><th style="padding:4px 10px;text-align:right">fps</th><th style="padding:4px 10px;text-align:right">1コマ(ms)</th><th style="padding:4px 10px;text-align:right">遅い方(ms)</th><th style="padding:4px 10px;text-align:right">三角形</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<textarea readonly style="width:100%;height:120px;margin-top:12px;font:11px monospace">'+JSON.stringify(result)+'</textarea>'+
      '<button type="button" style="margin-top:10px;border:0;border-radius:999px;padding:8px 18px;background:#222;color:#fff">結果をコピー</button>';
    card.querySelector('button').onclick=function(){
      var ta=card.querySelector('textarea'); ta.select();
      try{ navigator.clipboard.writeText(ta.value); }catch(e){ document.execCommand('copy'); }
      this.textContent='コピーしました';
    };
    document.body.appendChild(card);
  }

  run().catch(function(e){
    window.__benchResult={error:String(e&&e.message||e)};
    console.error('[bench]',e);
  });
})();
