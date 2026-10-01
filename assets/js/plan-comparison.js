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
  async function storage(value){
    const db=await openStore();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('workspace',value?'readwrite':'readonly');
      const req=value?tx.objectStore('workspace').put(value,'state'):tx.objectStore('workspace').get('state');
      tx.oncomplete=()=>resolve(req.result);
      tx.onerror=tx.onabort=()=>reject(tx.error||Error('保存できませんでした。'));
    });}finally{db.close();}
  }
  function fit(plans,floor){
    const points=[];
    plans.forEach(p=>{p.walls.filter(w=>(w.floor||1)===floor).forEach(w=>points.push([w.x1,w.y1],[w.x2,w.y2]));p.rooms.filter(r=>(r.floor||1)===floor).forEach(r=>points.push([r.x,r.y],[r.x+r.w,r.y+r.d]));});
    if(!points.length) return {x:0,y:0,span:10000,floor};
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const [x,y] of points){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    return {x:(x0+x1)/2,y:(y0+y1)/2,span:Math.max(x1-x0,(y1-y0)*4/3,1000)*1.2,floor};
  }
  const api={validatePlan,fit,storage};
  if(typeof module!=='undefined') module.exports=api;
  if(!root.document) return;
  let state={version:1,plans:[],views:[]},view=null,busy=false,ready=false,opener=null,captureGeneration=0;
  const $=id=>document.getElementById('compare-'+id);
  const message=text=>{$('status').textContent=text;};
  const selected=side=>state.plans.find(p=>p.id===$(side).value);
  const name=()=>{const n=$('name').value.trim();if(!n)throw Error('案の名前を入力してください。');return n.slice(0,80);};
  function fillSelect(el,records){const old=el.value;el.replaceChildren();records.forEach(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.name;el.append(o);});if(records.some(r=>r.id===old))el.value=old;}
  function refresh(){const floors=[...new Set(state.plans.flatMap(p=>p.plan.walls.concat(p.plan.rooms).map(o=>o.floor||1)))].filter(Number.isFinite).sort((a,b)=>a-b);if(floors.length)fillSelect($('floor'),floors.map(f=>({id:String(f),name:f+'F'})));fillSelect($('a'),state.plans);fillSelect($('b'),state.plans);fillSelect($('views'),state.views);$('count').textContent=state.plans.length+'案 · このブラウザに保存';render();}
  async function commit(next){if(!ready)throw Error('比較保存を開き直してください。');await storage(next);state=next;refresh();}
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
      c.strokeStyle=color(w.interiorColor||w.color,'#655f58');c.lineWidth=Math.max(60,w.thick||120);c.beginPath();c.moveTo(w.x1,w.y1);c.lineTo(w.x2,w.y2);c.stroke();
      c.strokeStyle='#665e54';c.lineWidth=1/s;c.stroke();
    }
    for(const r of plan.rooms.filter(r=>(r.floor||1)===v.floor)){
      c.fillStyle='#45413b';c.font=(14/s)+'px sans-serif';c.textAlign='center';c.fillText(r.name||r.n||'部屋',r.x+r.w/2,r.y+r.d/2,Math.abs(r.w)*.9);
    }
    c.restore();c.fillStyle='#646b73';c.font='14px sans-serif';c.fillText(v.floor+'F · 平面概略 / 仕上げ色',24,32);
    return canvas.toDataURL('image/png');
  }
  function render(){
    const a=selected('a'),b=selected('b');
    if(!view && (a||b))view=fit([a,b].filter(Boolean).map(p=>p.plan),Number($('floor').value));
    for(const side of ['a','b']){
      const p=selected(side),img=$(side+'-image');
      $(side+'-title').textContent=p?p.name:'案を保存すると、ここに表示されます';
      img.hidden=!p;if(p&&view){img.src=imageFor(p.plan,view);img.alt=p.name+'・共通の平面視点';}
      $(side+'-export').disabled=!p;
      $(side+'-finishes').textContent=p?[...new Set(p.plan.walls.filter(w=>(w.floor||1)===view.floor).map(w=>[w.interiorColor,w.interiorTexture].filter(Boolean).join(' / ')).filter(Boolean))].slice(0,8).join(' · '):'';
    }
    $('view-label').textContent=view?view.floor+'F · 共通範囲 '+Math.round(view.span)+' mm · 960 × 720':'共通の平面視点';
  }
  function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);}
  api.open=async function(){
    if($('dialog').open)return;opener=document.activeElement;ready=false;$('dialog').showModal();
    await run(async()=>{const loaded=await storage();if(loaded){if(loaded.version!==1||!Array.isArray(loaded.plans)||!Array.isArray(loaded.views))throw Error('保存形式が違います。');loaded.plans.forEach(p=>{if(typeof p.id!=='string'||typeof p.name!=='string')throw Error('案の保存形式が不正です。');validatePlan(p.plan);});loaded.views.forEach(v=>{if(typeof v.id!=='string'||typeof v.name!=='string'||!['x','y','span','floor'].every(k=>Number.isFinite(v[k]))||v.span<=0)throw Error('視点の保存形式が不正です。');});state=loaded;}ready=true;refresh();message('案を切り替えても、編集中のプランはそのままです。');});
  };
  function add(plan,n){const next=clone(state);const id=crypto.randomUUID();next.plans.push({id,name:n,createdAt:new Date().toISOString(),plan:validatePlan(plan)});return commit(next).then(()=>{$('b').value=id;render();message('「'+n+'」を保存しました。');});}
  // Keep editor shortcuts (Delete, undo, camera arrows) outside the modal.
  ['keydown','keyup'].forEach(type=>$('dialog').addEventListener(type,event=>event.stopPropagation()));
  $('import-open').onclick=()=>$('import').click();
  $('save').onclick=()=>run(()=>add(DATA,name()));
  $('import').onchange=()=>run(async()=>{const file=$('import').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('JSONは20MB以内にしてください。');const n=name(),plan=validatePlan(JSON.parse(await file.text()));await add(plan,n);}).finally(()=>{$('import').value='';});
  $('close').onclick=()=>$('dialog').close();
  $('dialog').addEventListener('close',()=>{captureGeneration++;if(opener)opener.focus();});
  for(const side of ['a','b']){$(side).onchange=render;$(side+'-export').onclick=()=>{const p=selected(side);if(p)download(JSON.stringify(p.plan,null,2),p.name+'.json','application/json');};}
  $('fit').onclick=()=>{view=fit(['a','b'].map(selected).filter(Boolean).map(p=>p.plan),Number($('floor').value));render();};
  $('floor').onchange=()=>{$('fit').click();};
  document.querySelectorAll('[data-compare-camera]').forEach(button=>button.onclick=()=>{if(!view)return;const action=button.dataset.compareCamera;if(action==='in')view.span=Math.max(500,view.span/1.25);if(action==='out')view.span=Math.min(1e8,view.span*1.25);if(action==='left')view.x-=view.span*.15;if(action==='right')view.x+=view.span*.15;if(action==='up')view.y-=view.span*.15;if(action==='down')view.y+=view.span*.15;$('views').value='';render();});
  $('save-view').onclick=()=>run(async()=>{if(!view)throw Error('先に案を保存してください。');const n=$('view-name').value.trim();if(!n)throw Error('視点の名前を入力してください。');const next=clone(state);const id=crypto.randomUUID();next.views.push({id,name:n.slice(0,80),...view});await commit(next);$('views').value=id;message('共通の平面視点を保存しました。');});
  $('views').onchange=()=>{const v=state.views.find(v=>v.id===$('views').value);if(v){view=clone(v);$('floor').value=v.floor;render();}};
  $('images').onclick=()=>run(async()=>{const a=selected('a'),b=selected('b');if(!a||!b)return message('左右の案を選んでください。');const generation=captureGeneration;const images=['a','b'].map(side=>{const img=new Image();img.src=$(side+'-image').src;return img;});await Promise.all(images.map(img=>img.decode()));if(!$('dialog').open||generation!==captureGeneration)return;const c=document.createElement('canvas');c.width=1920;c.height=790;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#353b42';ctx.font='24px sans-serif';ctx.fillText(a.name,24,35);ctx.fillText(b.name,984,35);ctx.drawImage(images[0],0,60);ctx.drawImage(images[1],960,60);const link=document.createElement('a');link.href=c.toDataURL('image/png');link.download='plan-comparison.png';link.click();});
  root.PlanComparison=api;
})(typeof window==='undefined'?globalThis:window);
