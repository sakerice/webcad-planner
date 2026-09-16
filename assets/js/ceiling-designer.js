/* Ceiling areas are room-local millimetres. Existing plans need no migration. */
(function(){
'use strict';
function areas(r){return (r.ceilingAreas||[]).map(a=>{const x=Math.max(0,Number(a.x)||0),y=Math.max(0,Number(a.y)||0);return {...a,x,y,w:Math.min(Number(a.w)||0,r.w-x),d:Math.min(Number(a.d)||0,r.d-y),offset:Math.max(-800,Math.min(800,Number(a.offset)||0))};}).filter(a=>a.w>0&&a.d>0&&a.offset);}
function offsetAt(r,x,y){const a=areas(r).find(a=>x>=r.x+a.x&&x<=r.x+a.x+a.w&&y>=r.y+a.y&&y<=r.y+a.y+a.d);return a?a.offset:0;}
function fixtures(){return DATA.items.filter(it=>it.floor===ST.floor&&(isLightItemType(it.type)||(typeof CEILING_FIXTURE_TOP_MM!=='undefined'&&CEILING_FIXTURE_TOP_MM[it.type]!==undefined)));}
function ceilingGroup(r,ceilY,mat,holes,profile){
 if(profile||!areas(r).length)return buildRoomCeilingMesh(r,ceilY,mat,holes,profile);
 const group=new THREE.Group();group.userData={b:true,ceiling:true,roomId:r.id};const aa=areas(r);const all=(holes||[]).slice();
 aa.forEach(a=>all.push([{x:(r.x+a.x)*U,z:(r.y+a.y)*U},{x:(r.x+a.x+a.w)*U,z:(r.y+a.y)*U},{x:(r.x+a.x+a.w)*U,z:(r.y+a.y+a.d)*U},{x:(r.x+a.x)*U,z:(r.y+a.y+a.d)*U}]));
 group.add(buildRoomCeilingMesh(r,ceilY,mat,all,null));
 aa.forEach(a=>{
  const m=mat.clone();m.map=null;m.color.set(a.color||'#eee8dd');m.side=THREE.DoubleSide;
  const x=(r.x+a.x+a.w/2)*U,z=(r.y+a.y+a.d/2)*U,w=a.w*U,d=a.d*U,y=ceilY+a.offset*U-.012;
  const face=new THREE.Mesh(new THREE.PlaneGeometry(w,d),m);face.rotation.x=Math.PI/2;face.position.set(x,y,z);face.userData={b:true,ceiling:true,roomId:r.id,ceilingAreaId:a.id};group.add(face);
  const h=Math.abs(a.offset)*U,mid=(ceilY-.012+y)/2;
  [[x-w/2,z,.006,d],[x+w/2,z,.006,d],[x,z-d/2,w,.006],[x,z+d/2,w,.006]].forEach(p=>{const side=new THREE.Mesh(new THREE.BoxGeometry(p[2],h,p[3]),m);side.position.set(p[0],mid,p[1]);side.userData={b:true,ceiling:true,roomId:r.id,ceilingAreaId:a.id};group.add(side);});
 });return group;
}
let dialog,cv,view,controls,renderer,scene,camera,mode='plan',tool='select',selection=null,drag=null,scale=1,ox=0,oy=0,revision=0,viewZoom=1,panX=0,panY=0;
function rooms(){return DATA.rooms.filter(r=>r.floor===ST.floor&&!r.hidden3D);}
function selected(){if(!selection)return null;const r=DATA.rooms.find(r=>r.id===selection.room);return r?{r,a:(r.ceilingAreas||[]).find(a=>a.id===selection.id)}:null;}
function status(t){dialog.querySelector('[data-status]').textContent=t;}
function isFlat(r){return !roomCeilingProfile(r)&&roomHasCoverAbove(r);}
function valid(r,a,skip){
 if(!['x','y','w','d','offset'].every(k=>Number.isFinite(a[k])))return '寸法は数値で指定してください。';
 if(!isFlat(r))return '平天井の部屋に配置してください。勾配天井・吹き抜けは対象外です。';
 if(a.w<100||a.d<100||a.x<0||a.y<0||a.x+a.w>r.w||a.y+a.d>r.d)return '範囲を部屋の中に収め、幅・奥行を100mm以上にしてください。';
 if((r.ceilingAreas||[]).some(b=>b.id!==skip&&a.x<b.x+b.w+5&&a.x+a.w+5>b.x&&a.y<b.y+b.d+5&&a.y+a.d+5>b.y))return '天井範囲同士は5mm以上離してください。';
 if(a.x<5||a.y<5||a.x+a.w>r.w-5||a.y+a.d>r.d-5)return '壁から5mm以上内側に配置してください。';
 if(a.offset>0&&floorBaseY(r.floor)+roomCeilingHeightM(r)+a.offset*U>floorBaseY(r.floor)+storyHeightM(r.floor)-.02)return '折り上げる余裕がありません。部屋の天井高を先に下げてください。';
 if(!Number.isFinite(a.offset)||Math.abs(a.offset)<10||Math.abs(a.offset)>800)return '段差は10〜800mmで指定してください。';
 const other={};other[r.floor]=stairwellQuadsForFloor(r.floor+1);
 const holes=stairwellHolesForRoom(r,other);
 if(holes.some(poly=>{const xs=poly.map(p=>p.x/U-r.x),ys=poly.map(p=>p.z/U-r.y);return a.x<Math.max(...xs)&&a.x+a.w>Math.min(...xs)&&a.y<Math.max(...ys)&&a.y+a.d>Math.min(...ys);}))return '階段の吹き抜けと重なる範囲には配置できません。';
 return '';
}
function mutate(r,fn){
 if(isObjectLocked(r)){status('ロック中の部屋は変更できません。');return false;}
 const mounts=DATA.items.filter(it=>it.floor===r.floor&&(isLightItemType(it.type)||(typeof CEILING_FIXTURE_TOP_MM!=='undefined'&&CEILING_FIXTURE_TOP_MM[it.type]!==undefined))&&roomAtPointOnFloor(it.floor,it.x+it.w/2,it.y+it.d/2)===r).map(it=>({it,old:offsetAt(r,it.x+it.w/2,it.y+it.d/2)}));
 saveState();fn();mounts.forEach(({it,old})=>{if(Number.isFinite(Number(it.elev)))it.elev=Number(it.elev)+offsetAt(r,it.x+it.w/2,it.y+it.d/2)-old;});
 draw2d();if(ren)rebuild3D();refresh();status('変更を反映しました。');return true;
}
function bounds(){const rr=rooms();return rr.length?{x:Math.min(...rr.map(r=>r.x)),y:Math.min(...rr.map(r=>r.y)),x2:Math.max(...rr.map(r=>r.x+r.w)),y2:Math.max(...rr.map(r=>r.y+r.d))}:{x:0,y:0,x2:6000,y2:6000};}
function draw(){if(!dialog?.open)return;const box=cv.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);cv.width=Math.max(1,box.width*ratio);cv.height=Math.max(1,box.height*ratio);const c=cv.getContext('2d');c.scale(ratio,ratio);const W=box.width,H=box.height,b=bounds();scale=viewZoom*Math.min((W-70)/Math.max(b.x2-b.x,100),(H-70)/Math.max(b.y2-b.y,100));ox=(W-(b.x2-b.x)*scale)/2-b.x*scale+panX;oy=(H-(b.y2-b.y)*scale)/2-b.y*scale+panY;c.fillStyle='#f2f0eb';c.fillRect(0,0,W,H);
 rooms().forEach(r=>{c.fillStyle=r.ceilingColor||'#fffdfa';c.strokeStyle='#838b88';c.lineWidth=2;c.fillRect(ox+r.x*scale,oy+r.y*scale,r.w*scale,r.d*scale);c.strokeRect(ox+r.x*scale,oy+r.y*scale,r.w*scale,r.d*scale);c.fillStyle='#737c77';c.font='12px system-ui';c.fillText((r.n||r.name||'部屋')+' · 天井',ox+r.x*scale+8,oy+r.y*scale+18,Math.max(10,r.w*scale-16));
 areas(r).forEach(a=>{c.fillStyle=a.color||'#e4ddd1';c.strokeStyle=selection?.id===a.id?'#d3455e':'#8b8176';c.lineWidth=selection?.id===a.id?3:1.5;c.setLineDash(a.offset>0?[5,3]:[]);c.fillRect(ox+(r.x+a.x)*scale,oy+(r.y+a.y)*scale,a.w*scale,a.d*scale);c.strokeRect(ox+(r.x+a.x)*scale,oy+(r.y+a.y)*scale,a.w*scale,a.d*scale);c.setLineDash([]);c.fillStyle='#4c5550';c.fillText((a.offset<0?'下げ ':'折り上げ +')+a.offset+'mm',ox+(r.x+a.x)*scale+6,oy+(r.y+a.y)*scale+17);});});
 fixtures().forEach(it=>{const x=ox+(it.x+it.w/2)*scale,y=oy+(it.y+it.d/2)*scale,fan=/fan/i.test(it.type);c.save();c.translate(x,y);c.rotate((it.rot||0)*Math.PI/180);c.strokeStyle=selection?.item===it.id?'#d3455e':'#527b86';c.lineWidth=2;c.beginPath();c.arc(0,0,Math.max(5,(fan?it.w*.45:it.w*.35)*scale),0,Math.PI*2);c.stroke();if(fan){for(let i=0;i<3;i++){c.rotate(Math.PI*2/3);c.beginPath();c.moveTo(0,0);c.lineTo(Math.max(9,it.w*.4*scale),0);c.stroke();}}else{c.beginPath();c.moveTo(-4,0);c.lineTo(4,0);c.moveTo(0,-4);c.lineTo(0,4);c.stroke();}c.restore();});
 if(drag?.end&&!drag.create&&!drag.pan){const dx=drag.end.x-drag.start.x,dy=drag.end.y-drag.start.y;c.strokeStyle='#d3455e';c.lineWidth=2;c.setLineDash([5,4]);if(drag.a)c.strokeRect(ox+(drag.r.x+drag.x+dx)*scale,oy+(drag.r.y+drag.y+dy)*scale,drag.a.w*scale,drag.a.d*scale);else if(drag.it){c.beginPath();c.arc(ox+(drag.x+dx+drag.it.w/2)*scale,oy+(drag.y+dy+drag.it.d/2)*scale,Math.max(6,drag.it.w*scale/2),0,Math.PI*2);c.stroke();}c.setLineDash([]);}
 if(drag?.create){const x=Math.min(drag.start.x,drag.end.x),y=Math.min(drag.start.y,drag.end.y);c.fillStyle='#d3455e22';c.strokeStyle='#d3455e';c.fillRect(ox+x*scale,oy+y*scale,Math.abs(drag.end.x-drag.start.x)*scale,Math.abs(drag.end.y-drag.start.y)*scale);c.strokeRect(ox+x*scale,oy+y*scale,Math.abs(drag.end.x-drag.start.x)*scale,Math.abs(drag.end.y-drag.start.y)*scale);}
}
function fields(){const el=dialog.querySelector('[data-fields]'),s=selected(),it=selection?.item&&DATA.items.find(it=>it.id===selection.item);el.replaceChildren();
 function number(label,value,apply){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='number';input.step='50';input.value=value;input.onchange=()=>apply(Number(input.value));l.append(input);el.append(l);}
 if(s?.a){const {r,a}=s;number('X（部屋内 mm）',a.x,v=>updateArea('x',v));number('Y（部屋内 mm）',a.y,v=>updateArea('y',v));number('幅 mm',a.w,v=>updateArea('w',v));number('奥行 mm',a.d,v=>updateArea('d',v));number('天井からの段差 mm',a.offset,v=>updateArea('offset',v));const l=document.createElement('label');l.textContent='仕上げ色';const input=document.createElement('input');input.type='color';input.value=a.color||'#e4ddd1';input.onchange=()=>updateArea('color',input.value);l.append(input);el.append(l);}
 else if(s?.r){const r=s.r;number('部屋の天井高 mm',Math.round((roomCeilingHeightM(r)-floorSlabHeightMForFloor(r.floor))/U),v=>{if(!Number.isFinite(v)||v<1800||v>4000||isObjectLocked(r))return;saveState();const previous=roomCeilingHeightM(r);r.ceiling={type:'flat',heightMm:v};const delta=(roomCeilingHeightM(r)-previous)/U;fixtures().filter(it=>roomAtPointOnFloor(it.floor,it.x+it.w/2,it.y+it.d/2)===r).forEach(it=>{it.elev=Number(it.elev)+delta;});refresh();});}
 else if(it){const p=document.createElement('p');p.textContent=getFmpItem(it.type)?.name||({'light-down':'ダウンライト','light-ceiling':'シーリングライト','light-spot':'スポットライト'}[it.type]||it.type);el.append(p);number('回転 °',it.rot||0,v=>{if(!Number.isFinite(v)||isObjectLocked(it))return;saveState();it.rot=v;refresh();});number('取付高さ mm',it.elev||0,v=>{if(!Number.isFinite(v)||isObjectLocked(it))return;saveState();it.elev=v;refresh();});}
 else el.textContent='範囲や器具を選ぶと寸法を編集できます。器具・範囲はドラッグで移動。';
 dialog.querySelector('[data-delete]').disabled=!(s?.a||it);
}
function updateArea(k,v){const s=selected();if(!s?.a||s.a[k]===v)return;const next={...s.a,[k]:v};const error=valid(s.r,next,s.a.id);if(error){status(error);fields();return;}mutate(s.r,()=>Object.assign(s.a,next));}
function point(e){const b=cv.getBoundingClientRect();return{x:Math.round(((e.clientX-b.left-ox)/scale)/50)*50,y:Math.round(((e.clientY-b.top-oy)/scale)/50)*50};}
function down(e){if(e.button!==0)return;const p=point(e);cv.setPointerCapture(e.pointerId);const r=rooms().find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.d);if(tool==='pan'){drag={pan:true,startClient:{x:e.clientX,y:e.clientY},x:panX,y:panY};return;}if(!r)return;
 if(tool==='lower'||tool==='raise'){drag={create:true,r,start:p,end:p};return;}
 if(tool!=='select'){
  if(!isFlat(r)||isObjectLocked(r)){status('平天井のロックされていない部屋を選んでください。');return;}
  saveState();const it=mkItem(tool,p.x,p.y,0,ST.floor);it.x=p.x-it.w/2;it.y=p.y-it.d/2;it.elev=ceilingFinishElevationMm(ST.floor,p.x,p.y)-(typeof CEILING_FIXTURE_TOP_MM!=='undefined'?(CEILING_FIXTURE_TOP_MM[it.type]||0):0);DATA.items.push(it);selection={item:it.id};tool='select';dialog.querySelector('[data-tool]').value=tool;refresh();return;
 }
 const it=fixtures().slice().reverse().find(it=>Math.hypot(p.x-it.x-it.w/2,p.y-it.y-it.d/2)<Math.max(it.w,it.d,250)/2);
 if(it){selection={item:it.id};drag={it,start:p,x:it.x,y:it.y};}
 else{const a=(r.ceilingAreas||[]).slice().reverse().find(a=>p.x>=r.x+a.x&&p.x<=r.x+a.x+a.w&&p.y>=r.y+a.y&&p.y<=r.y+a.y+a.d);selection={room:r.id,id:a?.id};if(a)drag={r,a,start:p,x:a.x,y:a.y};}
 refresh(false);
}
function move(e){if(!drag)return;if(drag.pan){panX=drag.x+e.clientX-drag.startClient.x;panY=drag.y+e.clientY-drag.startClient.y;draw();return;}const p=point(e);if(drag.create){drag.end=p;draw();return;}drag.end=p;draw();}
function up(e){if(!drag)return;const d=drag;drag=null;if(d.pan)return;const p=point(e);
 if(d.create){const a={id:'ceiling-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),x:Math.min(d.start.x,p.x)-d.r.x,y:Math.min(d.start.y,p.y)-d.r.y,w:Math.abs(p.x-d.start.x),d:Math.abs(p.y-d.start.y),offset:tool==='lower'?-150:150,color:'#e4ddd1'};const error=valid(d.r,a);if(error){status(error);draw();return;}mutate(d.r,()=>{(d.r.ceilingAreas||(d.r.ceilingAreas=[])).push(a);selection={room:d.r.id,id:a.id};});}
 else if(p.x!==d.start.x||p.y!==d.start.y){const x=d.x+p.x-d.start.x,y=d.y+p.y-d.start.y;if(d.a){const next={...d.a,x,y},error=valid(d.r,next,d.a.id);if(error)status(error);else mutate(d.r,()=>Object.assign(d.a,next));}
 else if(!isObjectLocked(d.it)){const newRoom=roomAtPointOnFloor(d.it.floor,x+d.it.w/2,y+d.it.d/2);if(newRoom&&isFlat(newRoom)){const old=ceilingFinishElevationMm(d.it.floor,d.it.x+d.it.w/2,d.it.y+d.it.d/2);saveState();d.it.x=x;d.it.y=y;d.it.elev=Number(d.it.elev)+ceilingFinishElevationMm(d.it.floor,x+d.it.w/2,y+d.it.d/2)-old;refresh();}}}
 draw();
}
async function render3D(){if(mode!=='3d'||!dialog.open)return;const token=++revision;init3D();
 if(!renderer){renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;view.append(renderer.domElement);let pressed;renderer.domElement.addEventListener('pointerdown',e=>{pressed={x:e.clientX,y:e.clientY};});renderer.domElement.addEventListener('pointerup',e=>{if(!scene||!pressed||Math.hypot(e.clientX-pressed.x,e.clientY-pressed.y)>5)return;const b=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);for(const hit of ray.intersectObject(scene,true)){let o=hit.object;while(o){if(o.userData.ceilingAreaId){selection={room:o.userData.roomId,id:o.userData.ceilingAreaId};fields();return;}if(o.userData.selectRef&&fixtures().some(it=>it.id===o.userData.selectRef.id)){selection={item:o.userData.selectRef.id};fields();return;}if(o.userData.roomId){selection={room:o.userData.roomId};fields();return;}o=o.parent;}}});camera=new THREE.PerspectiveCamera(50,1,.01,200);controls=new THREE.OrbitControls(camera,renderer.domElement);controls.addEventListener('change',()=>{if(scene)renderer.render(scene,camera);});}
 const old=scene;scene=new THREE.Scene();scene.background=new THREE.Color('#e8eceb');scene.add(new THREE.HemisphereLight(0xeaf3ff,0xffffff,2.2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,-4,3);scene.add(light);
 rooms().forEach(r=>{if(!roomHasCoverAbove(r))return;scene.add(ceilingGroup(r,floorBaseY(r.floor)+roomCeilingHeightM(r),makeRoomCeilingMaterial(r,new THREE.MeshStandardMaterial({color:'#faf8f3',roughness:.9,side:THREE.DoubleSide})),stairwellHolesForRoom(r,{[r.floor]:stairwellQuadsForFloor(r.floor+1)}),roomCeilingProfile(r)));});
 rooms().forEach(r=>{if(!roomHasCoverAbove(r))return;const y=floorBaseY(r.floor)+roomCeilingHeightM(r)-.018;const points=[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.d],[r.x,r.y+r.d],[r.x,r.y]].map(p=>new THREE.Vector3(p[0]*U,y,p[1]*U));const g=new THREE.BufferGeometry().setFromPoints(points);scene.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:0xaaa79e})));});
 for(const it of fixtures()){const m=getFmpItem(it.type);if(m&&!_modelCache[m.model]){try{const g=await new Promise((res,rej)=>getGltfLoader().load(m.model,res,undefined,rej));ModelQuality.prepare(g.scene,m.model);_modelCache[m.model]=g.scene;}catch(e){status('一部の器具モデルを読み込めませんでした。');}}
 if(token!==revision||!dialog.open)return;const original=sc3;const selectedBefore=ST.selected;try{sc3=scene;ST.selected=it;buildItem3D(it);}finally{sc3=original;ST.selected=selectedBefore;}}
 const b=bounds(),x=(b.x+b.x2)*U/2,z=(b.y+b.y2)*U/2,h=floorBaseY(ST.floor)+(rooms()[0]?roomCeilingHeightM(rooms()[0]):2.4),extent=Math.max(b.x2-b.x,b.y2-b.y)*U;
 if(!render3D.keep){controls.target.set(x,h-.1,z);camera.position.set(x,h-Math.max(3,extent*1.5),z+Math.max(.3,extent*.45));camera.up.set(0,0,-1);controls.update();render3D.keep=true;}
 renderer.setSize(view.clientWidth,view.clientHeight);camera.aspect=view.clientWidth/view.clientHeight;camera.updateProjectionMatrix();renderer.render(scene,camera);
 if(old)disposePreview(old);
}
function disposePreview(s){const cachedG=new Set(),cachedM=new Set();Object.values(_modelCache).forEach(g=>g.traverse?.(o=>{if(o.geometry)cachedG.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).forEach(m=>cachedM.add(m));}));s.traverse(o=>{if(o.geometry&&!cachedG.has(o.geometry))o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).forEach(m=>{if(!cachedM.has(m))m.dispose();});});}
function refresh(rebuild=true){draw();fields();if(mode==='3d'&&rebuild)render3D();if(rebuild){draw2d();if(ren)rebuild3D();}}
function open(){
 if(!dialog){dialog=document.createElement('dialog');dialog.className='ceiling-designer';dialog.innerHTML='<header><strong>天井デザイン</strong><span>天井伏図 · 床の平面図と同じ向き</span><button data-close>閉じる</button></header><nav><button data-plan>天井伏図</button><button data-3d>見上げ3D</button><label>階 <select data-floor></select></label><select data-tool aria-label="天井ツール"><option value="select">選択・移動</option><option value="pan">表示を移動</option><option value="lower">下げ天井を描く</option><option value="raise">折り上げ天井を描く</option><option value="light-ceiling">シーリングライト</option><option value="light-down">ダウンライト</option><option value="light-spot">スポットライト</option></select><button data-zoom-in aria-label="拡大">＋</button><button data-zoom-out aria-label="縮小">−</button><button data-fit>全体</button><button data-undo>Undo</button><button data-redo>Redo</button></nav><section><div class="ceiling-stage"><canvas aria-label="天井伏図"></canvas><div class="ceiling-3d" hidden></div></div><aside><h3>選択範囲・器具</h3><div data-fields></div><button data-delete>選択を削除</button><p data-status>ツールを選び、部屋内をドラッグして範囲を作成。段差は下げが負、折り上げが正です。</p></aside></section>';document.body.append(dialog);cv=dialog.querySelector('canvas');view=dialog.querySelector('.ceiling-3d');cv.addEventListener('wheel',e=>{e.preventDefault();viewZoom=Math.max(.5,Math.min(8,viewZoom*(e.deltaY<0?1.1:1/1.1)));draw();},{passive:false});cv.onpointerdown=down;cv.onpointermove=move;cv.onpointerup=up;cv.onpointercancel=()=>{drag=null;draw();};
 dialog.querySelector('[data-zoom-in]').onclick=()=>{if(mode==='3d'){camera.position.sub(controls.target).multiplyScalar(.8).add(controls.target);controls.update();}else{viewZoom=Math.min(8,viewZoom*1.3);draw();}};dialog.querySelector('[data-zoom-out]').onclick=()=>{if(mode==='3d'){camera.position.sub(controls.target).multiplyScalar(1.25).add(controls.target);controls.update();}else{viewZoom=Math.max(.5,viewZoom/1.3);draw();}};dialog.querySelector('[data-fit]').onclick=()=>{viewZoom=1;panX=panY=0;render3D.keep=false;refresh();};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>{revision++;if(scene){disposePreview(scene);scene=null;}draw2d();if(ren)rebuild3D();};dialog.querySelector('[data-plan]').onclick=()=>switchMode('plan');dialog.querySelector('[data-3d]').onclick=()=>switchMode('3d');dialog.querySelector('[data-tool]').onchange=e=>{tool=e.target.value;switchMode('plan');};
 dialog.querySelector('[data-undo]').onclick=()=>{undoAction();selection=null;refresh();};dialog.querySelector('[data-redo]').onclick=()=>{redoAction();selection=null;refresh();};dialog.querySelector('[data-floor]').onchange=e=>{ST.floor=Number(e.target.value);ST.selected=null;document.getElementById('floor-sel').value=String(ST.floor);document.getElementById('st-floor').textContent='フロア:'+ST.floor+'F';selection=null;render3D.keep=false;refresh();};
 dialog.querySelector('[data-delete]').onclick=()=>{const s=selected();if(s?.a)mutate(s.r,()=>{s.r.ceilingAreas=s.r.ceilingAreas.filter(a=>a.id!==s.a.id);selection=null;});else{const it=DATA.items.find(it=>it.id===selection?.item);if(it&&!isObjectLocked(it)){saveState();DATA.items=DATA.items.filter(a=>a!==it);selection=null;refresh();}}};
 new ResizeObserver(()=>{draw();if(mode==='3d')render3D();}).observe(dialog);
 }
 const floor=dialog.querySelector('[data-floor]');floor.replaceChildren();[...new Set(DATA.rooms.map(r=>r.floor))].sort((a,b)=>a-b).forEach(f=>{const o=new Option(f+'F',f);o.selected=f===ST.floor;floor.add(o);});
 const tools=dialog.querySelector('[data-tool]');tools.querySelectorAll('[data-fixture]').forEach(o=>o.remove());Object.values(FMP_ITEMS).filter(m=>typeof CEILING_FIXTURE_TOP_MM!=='undefined'&&CEILING_FIXTURE_TOP_MM[m.id]!==undefined).forEach(m=>{const o=new Option(m.name,m.id);o.dataset.fixture='1';tools.add(o);});
 dialog.showModal();viewZoom=1;panX=panY=0;render3D.keep=false;switchMode('plan');
}
function switchMode(m){mode=m;cv.hidden=m!=='plan';view.hidden=m!=='3d';dialog.querySelector('header span').textContent=m==='plan'?'天井伏図 · 床の平面図と同じ向き':'天井を下から確認 · ドラッグで回転';dialog.querySelector('[data-plan]').classList.toggle('active',m==='plan');dialog.querySelector('[data-3d]').classList.toggle('active',m==='3d');refresh();}
window.CeilingDesigner={open,areas,offsetAt,ceilingGroup,valid};
})();
