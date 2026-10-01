/* Local review workspace. Never swaps editor DATA or touches editor storage/sync. */
(function(root){
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  function validatePlan(value){
    if(!value || typeof value !== 'object' || Array.isArray(value)) throw Error('プランJSONを選んでください。');
    for(const key of ['walls','rooms','items']){
      if(!Array.isArray(value[key]) || value[key].length > 20000) throw Error(key+' が正しい配列ではありません。');
      for(const item of value[key]){
        if(!item || typeof item!=='object' || Array.isArray(item)) throw Error(key+' に不正な要素があります。');
        const fields=key==='walls'?['x1','y1','x2','y2']:['x','y','w','d'];
        for(const field of fields) if(typeof item[field]!=='number'||!Number.isFinite(item[field])||Math.abs(item[field])>1e7) throw Error(key+': '+field+' が不正です。');
      }
    }
    return clone(value);
  }
  function openStore(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('webcad-comparison-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('比較保存が別のタブで使用中です。'));
      request.onsuccess=()=>resolve(request.result);
    });
  }
  // Records are immutable additions. Merge inside the same write transaction so
  // a stale tab cannot replace another tab's snapshots or shared viewpoints.
  function mergeWorkspace(current,incoming){
    const result={version:1,plans:[],views:[],cameras:[]};
    for(const source of [current,incoming]){
      if(!source)continue;
      if(source.version!==1||!Array.isArray(source.plans)||!Array.isArray(source.views)||source.cameras&&!Array.isArray(source.cameras))throw Error('保存形式が違います。');
      for(const key of ['plans','views','cameras'])for(const record of source[key]||[]){
        if(!record||typeof record.id!=='string')throw Error('比較レコードの形式が不正です。');
        const previous=result[key].find(item=>item.id===record.id);
        if(previous&&JSON.stringify(previous)!==JSON.stringify(record))throw Error('別のタブで変更されました。比較保存を開き直してください。');
        if(!previous)result[key].push(clone(record));
      }
    }
    return result;
  }
  async function storage(value){
    const db=await openStore();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('workspace',value?'readwrite':'readonly');
      let result,failure;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('保存できませんでした。'));
      const store=tx.objectStore('workspace'),req=store.get('state');
      req.onsuccess=()=>{
        try{result=value?mergeWorkspace(req.result,value):req.result;if(value)store.put(result,'state');}
        catch(error){failure=error;tx.abort();}
      };
    });}finally{db.close();}
  }
  function interiorColor(plan,wall){
    const settings=plan.interiorWallSettings||{},floor=settings.floors?.[wall.floor||1];
    return (settings.whole?.linked?settings.whole.color:floor?.linked?floor.color:wall.interiorColor)||'#f4f0e8';
  }
  function fit(plans,floor){
    const points=[];
    plans.forEach(p=>{p.walls.filter(w=>(w.floor||1)===floor).forEach(w=>points.push([w.x1,w.y1],[w.x2,w.y2]));p.rooms.filter(r=>(r.floor||1)===floor).forEach(r=>points.push([r.x,r.y],[r.x+r.w,r.y+r.d]));});
    if(!points.length) return {x:0,y:0,span:10000,floor};
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const [x,y] of points){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    return {x:(x0+x1)/2,y:(y0+y1)/2,span:Math.max(x1-x0,(y1-y0)*4/3,1000)*1.2,floor};
  }
  function validateCamera(spec){
    if(!spec||!Number.isFinite(spec.floor)||!Number.isFinite(spec.fov)||spec.fov<10||spec.fov>150||spec.width!==960||spec.height!==720||!spec.lighting||typeof spec.lighting!=='object')throw Error('3D視点の形式が不正です。');
    for(const key of ['pos','target','up'])if(!Array.isArray(spec[key])||spec[key].length!==3||!spec[key].every(n=>Number.isFinite(n)&&Math.abs(n)<1e6))throw Error('3Dカメラの座標が不正です。');
    return clone(spec);
  }
  const api={validatePlan,validateCamera,fit,storage,mergeWorkspace,interiorColor};
  if(typeof module!=='undefined') module.exports=api;
  if(!root.document || (typeof COMPARISON_PREVIEW!=='undefined'&&COMPARISON_PREVIEW)) return;
  let state={version:1,plans:[],views:[]},view=null,busy=false,ready=false,opener=null,captureGeneration=0,sceneSpec=null,renderController=null,renderVersion=0,pairReady=false;
  const $=id=>document.getElementById('compare-'+id);
  const message=text=>{$('status').textContent=text;};
  const selected=side=>state.plans.find(p=>p.id===$(side).value);
  const name=()=>{const n=$('name').value.trim();if(!n)throw Error('案の名前を入力してください。');return n.slice(0,80);};
  function fillSelect(el,records){const old=el.value;el.replaceChildren();records.forEach(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.name;el.append(o);});if(records.some(r=>r.id===old))el.value=old;}
  function refresh(repaint=true){const floors=[...new Set(state.plans.flatMap(p=>p.plan.walls.concat(p.plan.rooms).map(o=>o.floor||1)))].filter(Number.isFinite).sort((a,b)=>a-b);if(floors.length)fillSelect($('floor'),floors.map(f=>({id:String(f),name:f+'F'})));fillSelect($('a'),state.plans);fillSelect($('b'),state.plans);fillSelect($('views'),state.views);fillSelect($('cameras'),state.cameras||[]);$('count').textContent=state.plans.length+'案 · このブラウザに保存';if(repaint)render();}
  async function commit(next,repaint=true){if(!ready)throw Error('比較保存を開き直してください。');state=await storage(next);refresh(repaint);}
  async function run(action){if(busy)return;busy=true;document.querySelectorAll('[data-compare-write]').forEach(b=>b.disabled=true);try{await action();}catch(e){message('保存・読込に失敗: '+e.message+' 編集中のプランは変更していません。');}finally{busy=false;document.querySelectorAll('[data-compare-write]').forEach(b=>b.disabled=false);}}
  function color(c,fallback){return typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c)?c:fallback;}
  function imageFor(plan,v){
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=720;
    const c=canvas.getContext('2d'),s=960/v.span;
    c.fillStyle='#f7f5f0';c.fillRect(0,0,960,720);c.save();c.translate(480-v.x*s,360-v.y*s);c.scale(s,s);
    for(const r of plan.rooms.filter(r=>(r.floor||1)===v.floor)){
      c.fillStyle=color(r.floorColor||r.color,'#e4ddcf');c.fillRect(r.x,r.y,r.w,r.d);
      c.strokeStyle='#c1b9ad';c.lineWidth=1/s;c.strokeRect(r.x,r.y,r.w,r.d);
    }
    for(const w of plan.walls.filter(w=>(w.floor||1)===v.floor)){
      c.strokeStyle=color(interiorColor(plan,w),'#f4f0e8');c.lineWidth=Math.max(60,w.thick||120);c.beginPath();c.moveTo(w.x1,w.y1);c.lineTo(w.x2,w.y2);c.stroke();
      c.strokeStyle='#665e54';c.lineWidth=1/s;c.stroke();
    }
    for(const r of plan.rooms.filter(r=>(r.floor||1)===v.floor)){
      c.fillStyle='#45413b';c.font=(14/s)+'px sans-serif';c.textAlign='center';c.fillText(r.name||r.n||'部屋',r.x+r.w/2,r.y+r.d/2,Math.abs(r.w)*.9);
    }
    c.restore();c.fillStyle='#646b73';c.font='14px sans-serif';c.fillText(v.floor+'F · 平面概略 / 仕上げ色',24,32);
    return canvas.toDataURL('image/png');
  }
  function stopCapture(){renderVersion++;if(renderController)renderController.abort();renderController=null;}
  function cameraForRoom(){
    const a=selected('a');const room=a&&a.plan.rooms[Number($('room').value)];
    if(!room)throw Error('比較する部屋を選んでください。');
    return {floor:room.floor||1,room:clone(room),fov:65,up:[0,1,0],width:960,height:720,lighting:clone(LIGHT_SETTINGS)};
  }
  async function render3D(){
    stopCapture();pairReady=false;$('images').disabled=true;
    const a=selected('a'),b=selected('b');if(!a||!b)return;
    const version=renderVersion;renderController=new AbortController();
    for(const side of ['a','b'])$(side+'-image').hidden=true;
    message('内観3Dを撮影中… A → B（同じカメラ・照明）');
    try{
      const spec=sceneSpec||cameraForRoom();
      const pair=await ComparisonCapture.pair([a.plan,b.plan],spec,renderController.signal);
      if(version!==renderVersion||!$('dialog').open)return;
      sceneSpec=pair[0].spec;api.lastCapture=pair.map(p=>({spec:p.spec,actual:p.actual}));
      for(const [i,side] of ['a','b'].entries()){const img=$(side+'-image');img.src=pair[i].png;img.hidden=false;img.alt=(i?b:a).name+'・共通カメラの内観3D';}
      pairReady=true;$('images').disabled=false;
      message('内観3D · '+sceneSpec.floor+'F · FOV '+sceneSpec.fov+'° · 960 × 720 · 共通の照明条件');
    }catch(e){if(version===renderVersion&&e.name!=='AbortError')message('3D撮影に失敗: '+e.message+' 編集中のプランは変更していません。');}
  }
  function finishSummary(plan,floor){
    const settings=plan.interiorWallSettings||{};
    const scope=settings.whole?.linked?settings.whole:settings.floors?.[floor]?.linked?settings.floors[floor]:null;
    const entries=scope?[{interiorColor:scope.color,interiorTexture:scope.texture}]:plan.walls.filter(w=>(w.floor||1)===floor);
    return [...new Set(entries.map(w=>[w.interiorColor,typeof w.interiorTexture==='string'&&w.interiorTexture.startsWith('data:')?'アップロード画像':w.interiorTexture].filter(Boolean).join(' / ')).filter(Boolean))].slice(0,8).join(' · ');
  }
  function render(){
    if(!$('dialog').open)return;
    const a=selected('a'),b=selected('b');
    const is3D=$('mode').value==='3d';
    $('3d-controls').hidden=!is3D;$('2d-controls').hidden=is3D;
    if(a){const first=!$('room').options.length;fillSelect($('room'),a.plan.rooms.map((r,i)=>({id:String(i),name:(r.floor||1)+'F / '+(r.n||r.name||'部屋')})));if(first){let index=0;a.plan.rooms.forEach((r,i)=>{if(r.w*r.d>a.plan.rooms[index].w*a.plan.rooms[index].d)index=i;});$('room').value=String(index);}}
    if(!view && (a||b))view=fit([a,b].filter(Boolean).map(p=>p.plan),Number($('floor').value));
    for(const side of ['a','b']){
      const p=selected(side),img=$(side+'-image');
      $(side+'-title').textContent=p?p.name:'案を保存すると、ここに表示されます';
      img.hidden=!p||is3D;if(p&&view&&!is3D){img.src=imageFor(p.plan,view);img.alt=p.name+'・共通の平面視点';}
      $(side+'-export').disabled=!p;
      $(side+'-finishes').textContent=p?finishSummary(p.plan,is3D&&sceneSpec?sceneSpec.floor:view.floor):'';
    }
    if(is3D){render3D();}else{stopCapture();pairReady=!!(a&&b);$('images').disabled=!pairReady;}
    $('view-label').textContent=view?view.floor+'F · 共通範囲 '+Math.round(view.span)+' mm · 960 × 720':'共通の平面視点';
  }
  function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);}
  api.open=async function(){
    if($('dialog').open)return;opener=document.activeElement;$('dialog').showModal();
    // A pending operation still owns readiness and will refresh the reopened panel.
    if(busy)return;ready=false;
    await run(async()=>{const loaded=await storage();if(loaded){if(loaded.version!==1||!Array.isArray(loaded.plans)||!Array.isArray(loaded.views))throw Error('保存形式が違います。');loaded.plans.forEach(p=>{if(typeof p.id!=='string'||typeof p.name!=='string')throw Error('案の保存形式が不正です。');validatePlan(p.plan);});loaded.views.forEach(v=>{if(typeof v.id!=='string'||typeof v.name!=='string'||!['x','y','span','floor'].every(k=>Number.isFinite(v[k]))||v.span<=0)throw Error('視点の保存形式が不正です。');});if(loaded.cameras&&!Array.isArray(loaded.cameras))throw Error('3D視点の保存形式が不正です。');(loaded.cameras||[]).forEach(c=>{if(typeof c.id!=='string'||typeof c.name!=='string')throw Error('3D視点名が不正です。');validateCamera(c.spec);});state=loaded;}ready=true;refresh();message('案を切り替えても、編集中のプランはそのままです。');});
  };
  function add(plan,n){const next=clone(state);const id=crypto.randomUUID();next.plans.push({id,name:n,createdAt:new Date().toISOString(),plan:validatePlan(plan)});return commit(next).then(()=>{$('b').value=id;render();message('「'+n+'」を保存しました。');});}
  // Keep editor shortcuts (Delete, undo, camera arrows) outside the modal.
  ['keydown','keyup'].forEach(type=>$('dialog').addEventListener(type,event=>event.stopPropagation()));
  $('import-open').onclick=()=>$('import').click();
  $('save').onclick=()=>run(()=>add(DATA,name()));
  $('import').onchange=()=>run(async()=>{const file=$('import').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('JSONは20MB以内にしてください。');const n=name(),plan=validatePlan(JSON.parse(await file.text()));await add(plan,n);}).finally(()=>{$('import').value='';});
  $('close').onclick=()=>$('dialog').close();
  $('dialog').addEventListener('close',()=>{captureGeneration++;stopCapture();if(opener)opener.focus();});
  for(const side of ['a','b']){$(side).onchange=render;$(side+'-export').onclick=()=>{const p=selected(side);if(p)download(JSON.stringify(p.plan,null,2),p.name+'.json','application/json');};}
  $('fit').onclick=()=>{view=fit(['a','b'].map(selected).filter(Boolean).map(p=>p.plan),Number($('floor').value));render();};
  $('floor').onchange=()=>{$('fit').click();};
  document.querySelectorAll('[data-compare-camera]').forEach(button=>button.onclick=()=>{if(!view)return;const action=button.dataset.compareCamera;if(action==='in')view.span=Math.max(500,view.span/1.25);if(action==='out')view.span=Math.min(1e8,view.span*1.25);if(action==='left')view.x-=view.span*.15;if(action==='right')view.x+=view.span*.15;if(action==='up')view.y-=view.span*.15;if(action==='down')view.y+=view.span*.15;$('views').value='';render();});
  $('save-view').onclick=()=>run(async()=>{if(!view)throw Error('先に案を保存してください。');const n=$('view-name').value.trim();if(!n)throw Error('視点の名前を入力してください。');const next=clone(state);const id=crypto.randomUUID();next.views.push({x:view.x,y:view.y,span:view.span,floor:view.floor,id,name:n.slice(0,80)});await commit(next);$('views').value=id;message('共通の平面視点を保存しました。');});
  $('views').onchange=()=>{const v=state.views.find(v=>v.id===$('views').value);if(v){view=clone(v);$('floor').value=v.floor;render();}};
  $('mode').onchange=render;
  $('room-camera').onclick=()=>{try{sceneSpec=cameraForRoom();render();}catch(e){message(e.message);}};
  $('live-camera').onclick=()=>{
    if(ST.view!=='3d-int'||!camExt||!orbit)return message('編集画面の内観3Dで視点を決めてから、このボタンを押してください。');
    sceneSpec={floor:ST.floor,pos:camExt.position.toArray(),target:orbit.target.toArray(),up:camExt.up.toArray(),fov:camExt.fov,width:960,height:720,lighting:clone(LIGHT_SETTINGS)};render();
  };
  $('recapture').onclick=render;
  $('cancel-capture').onclick=()=>{stopCapture();message('撮影を中止しました。編集中のプランはそのままです。');};
  $('save-camera').onclick=()=>run(async()=>{
    const n=$('camera-name').value.trim();if(!n||!sceneSpec||!sceneSpec.pos)throw Error('撮影完了後に3D視点名を入力してください。');
    const next=clone(state);if(!next.cameras)next.cameras=[];const id=crypto.randomUUID();next.cameras.push({id,name:n.slice(0,80),spec:validateCamera(sceneSpec)});await commit(next,false);$('cameras').value=id;
  });
  $('cameras').onchange=()=>{const c=(state.cameras||[]).find(c=>c.id===$('cameras').value);if(c){sceneSpec=clone(c.spec);render();}};
  $('images').onclick=()=>run(async()=>{if(!pairReady)return message('比較画像の撮影完了をお待ちください。');const a=selected('a'),b=selected('b');if(!a||!b)return message('左右の案を選んでください。');const generation=captureGeneration;const images=['a','b'].map(side=>{const img=new Image();img.src=$(side+'-image').src;return img;});await Promise.all(images.map(img=>img.decode()));if(!$('dialog').open||generation!==captureGeneration)return;const c=document.createElement('canvas');c.width=1920;c.height=790;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#353b42';ctx.font='24px sans-serif';ctx.fillText(a.name,24,35);ctx.fillText(b.name,984,35);ctx.drawImage(images[0],0,60);ctx.drawImage(images[1],960,60);const link=document.createElement('a');link.href=c.toDataURL('image/png');link.download='plan-comparison.png';link.click();});
  root.PlanComparison=api;
})(typeof window==='undefined'?globalThis:window);
