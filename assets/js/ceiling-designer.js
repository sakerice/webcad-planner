/* Native plan/interior ceiling layer; legacy room-local areas migrate losslessly. */
(function(){
'use strict';
function areas(r){return ((r.ceilingAreas||[]).concat(DATA.items.filter(it=>it.type==='ceiling-area'&&roomFor(it)===r).map(it=>({...it,x:it.x-r.x,y:it.y-r.y})))).map(a=>{const x=Math.max(0,Number(a.x)||0),y=Math.max(0,Number(a.y)||0);return {...a,x,y,w:Math.min(Number(a.w)||0,r.w-x),d:Math.min(Number(a.d)||0,r.d-y),offset:Math.max(-800,Math.min(800,Number(a.offset)||0))};}).filter(a=>a.w>0&&a.d>0&&a.offset);}
function offsetAt(r,x,y){const a=areas(r).find(a=>x>=r.x+a.x&&x<=r.x+a.x+a.w&&y>=r.y+a.y&&y<=r.y+a.y+a.d);return a?a.offset:0;}
function fixtures(){return DATA.items.filter(it=>it.floor===ST.floor&&(isLightItemType(it.type)||(typeof CEILING_FIXTURE_TOP_MM!=='undefined'&&CEILING_FIXTURE_TOP_MM[it.type]!==undefined)));}
function ceilingGroup(r,ceilY,mat,holes,profile){
 if(profile||!areas(r).length)return buildRoomCeilingMesh(r,ceilY,mat,holes,profile);
 const inset=typeof usesFinishedHeightModel==='function'&&usesFinishedHeightModel()?0:.012;
 // 天井範囲の見えがかり。テクスチャを設定したらそれを貼り、無ければ色で塗る
 // (部屋の天井仕上げと同じ決まり: 画像が優先)。タイルの大きさも部屋の天井と
 // 同じ CEILING_TEXTURE_TILE_M。ここで別の数を持ち込むと、同じ画像が段差の
 // 中だけ違う大きさで出る。
 const faceMaterial=(base,a,w,d)=>{
  const m=base.clone();m.side=THREE.DoubleSide;
  if(a.texture&&typeof getTexture3D==='function'){
   const tex=cloneRepeatReadyTexture(getTexture3D(a.texture));
   if(tex){tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    setTextureRepeatNoDistort(tex,w,d,CEILING_TEXTURE_TILE_M);
    applyTextureFlip(tex,{textureFlipX:a.textureFlipX,textureFlipY:a.textureFlipY});
    m.map=tex;m.color.set(0xffffff);return m;}
  }
  m.map=null;m.color.set(a.color||'#eee8dd');return m;
 };
 const group=new THREE.Group();group.userData={b:true,ceiling:true,roomId:r.id};const aa=areas(r);const all=(holes||[]).slice();
 aa.forEach(a=>all.push([{x:(r.x+a.x)*U,z:(r.y+a.y)*U},{x:(r.x+a.x+a.w)*U,z:(r.y+a.y)*U},{x:(r.x+a.x+a.w)*U,z:(r.y+a.y+a.d)*U},{x:(r.x+a.x)*U,z:(r.y+a.y+a.d)*U}]));
 const base=buildRoomCeilingMesh(r,ceilY,mat,all,null);if(active())mark3DSelectable(base,r,'room');group.add(base);
 aa.forEach(a=>{
  const m=faceMaterial(mat,a,a.w*U,a.d*U);
  // 段差の立ち上がり(見付け)は色のまま。面に貼った画像を細い帯へ引き伸ばすと
  // 柄が溶けて、かえって納まりが読めなくなる。
  const fascia=m.map?faceMaterial(mat,{color:a.color},0,0):m;
  const x=(r.x+a.x+a.w/2)*U,z=(r.y+a.y+a.d/2)*U,w=a.w*U,d=a.d*U,y=ceilY+a.offset*U-inset;
  const face=new THREE.Mesh(new THREE.PlaneGeometry(w,d),m);face.rotation.x=Math.PI/2;face.position.set(x,y,z);face.userData={b:true,ceiling:true,roomId:r.id,ceilingAreaId:a.id};const ref=DATA.items.find(it=>it.type==='ceiling-area'&&it.id===a.id);if(ref)mark3DSelectable(face,ref,'item');group.add(face);
  const h=Math.abs(a.offset)*U,mid=(ceilY-inset+y)/2;
  [[x-w/2,z,.006,d],[x+w/2,z,.006,d],[x,z-d/2,w,.006],[x,z+d/2,w,.006]].forEach(p=>{const side=new THREE.Mesh(new THREE.BoxGeometry(p[2],h,p[3]),fascia);side.position.set(p[0],mid,p[1]);side.userData={b:true,ceiling:true,roomId:r.id,ceilingAreaId:a.id};if(ref)mark3DSelectable(side,ref,'item');group.add(side);});
 });return group;
}
function active(){return !!ST.ceilingView&&(ST.view==='2d'||ST.view==='3d-int');}
function zone(it){return it&&it.type==='ceiling-area';}
function fixture(it){return it&&(isLightItemType(it.type)||(typeof CEILING_FIXTURE_TOP_MM!=='undefined'&&CEILING_FIXTURE_TOP_MM[it.type]!==undefined));}
function visible(it){return zone(it)?active():!active()||fixture(it)||it.type==='room'||it.x1!==undefined;}
function roomFor(it){return DATA.rooms.find(r=>r.floor===it.floor&&it.x+it.w/2>=r.x&&it.x+it.w/2<=r.x+r.w&&it.y+it.d/2>=r.y&&it.y+it.d/2<=r.y+r.d);}
function migrate(){
 DATA.rooms.forEach(r=>{if(!r.ceilingAreas?.length)return;r.ceilingAreas.forEach(a=>{if(!DATA.items.some(it=>it.id===a.id&&zone(it)))DATA.items.push({...a,type:'ceiling-area',floor:r.floor,x:r.x+a.x,y:r.y+a.y,rot:0});});delete r.ceilingAreas;});
}
function validItem(it){
 const r=roomFor(it);if(!r||roomCeilingProfile(r)||!roomHasCoverAbove(r))return '平天井の部屋内に配置してください。';
 if(isObjectLocked(r))return '部屋がロックされています。';
 if(!['x','y','w','d','offset'].every(k=>Number.isFinite(it[k])))return '寸法を数値で指定してください。';
 if(it.rot)return '天井範囲は部屋に沿った矩形で配置してください。';
 if(it.w<100||it.d<100||it.x<r.x+5||it.y<r.y+5||it.x+it.w>r.x+r.w-5||it.y+it.d>r.y+r.d-5)return '範囲は部屋の内側に収めてください（壁から5mm以上）。';
 if(Math.abs(it.offset)<10||Math.abs(it.offset)>800)return '段差は10〜800mmで指定してください。';
 if(it.offset>0){const limit=raisingLimit(r,it);if(it.offset>limit.mm)return 'この範囲の折り上げ上限は＋'+limit.mm+'mmです（'+limit.reason+'、仕上げの残り20mmを確保）。';}
 if(DATA.items.some(b=>zone(b)&&b.id!==it.id&&b.floor===it.floor&&it.x<b.x+b.w+5&&it.x+it.w+5>b.x&&it.y<b.y+b.d+5&&it.y+it.d+5>b.y))return '天井範囲が重なっています。';
 const holes=stairwellHolesForRoom(r,{[r.floor]:stairwellQuadsForFloor(r.floor+1)});
 if(holes.some(poly=>it.x<Math.max(...poly.map(p=>p.x/U))&&it.x+it.w>Math.min(...poly.map(p=>p.x/U))&&it.y<Math.max(...poly.map(p=>p.z/U))&&it.y+it.d>Math.min(...poly.map(p=>p.z/U))))return '階段の吹き抜けには配置できません。';
 return '';
}
function message(text){const el=document.getElementById('ceiling-note');if(el){el.textContent=text;el.hidden=!text;}}
function hasAreas(){return DATA.items.some(zone)||DATA.rooms.some(r=>r.ceilingAreas?.length);}
function snapshot(){return {zones:DATA.items.filter(zone).map(it=>({it,state:{...it}})),mounts:DATA.items.filter(fixture).map(it=>({it,height:ceilingFinishElevationMm(it.floor,it.x+it.w/2,it.y+it.d/2)}))};}
function reconcile(before){
 let error='';before.zones.forEach(({it,state})=>{if(!DATA.items.includes(it))return;const invalid=validItem(it);if(invalid){Object.assign(it,state);error=invalid;}});
 before.mounts.forEach(({it,height})=>{if(DATA.items.includes(it)&&Number.isFinite(Number(it.elev)))it.elev=Number(it.elev)+ceilingFinishElevationMm(it.floor,it.x+it.w/2,it.y+it.d/2)-height;});
 if(error)message(error);
}
function isTool(t){return t==='ceiling-lower'||t==='ceiling-raise';}
function drawClick(x,y){
 if(!active())return;
 if(!ST.drawing){ST.drawing=true;ST.drawPts=[{x,y}];draw2d();return;}
 const p=ST.drawPts[0],it={id:nextId++,type:'ceiling-area',floor:ST.floor,x:Math.min(x,p.x),y:Math.min(y,p.y),w:Math.abs(x-p.x),d:Math.abs(y-p.y),rot:0,offset:ST.tool==='ceiling-raise'?150:-150,color:'#e4ddd1'};
 const error=validItem(it);ST.drawing=false;ST.drawPts=[];
 if(error){message(error);draw2d();return;}
 const before=snapshot();saveState();DATA.items.push(it);reconcile(before);setTool('select');ST.selected=it;updateProps();draw2d();if(ren)rebuild3D();
}
function drawArea(it){
 if(!active())return;const sc=ST.zoom*.05,x=ST.panX+it.x*sc,y=ST.panY+it.y*sc;
 ctx.save();ctx.fillStyle=it.color||'#e4ddd1';ctx.globalAlpha=.8;ctx.fillRect(x,y,it.w*sc,it.d*sc);ctx.globalAlpha=1;ctx.strokeStyle=ST.selected===it?'#e94560':'#8e8375';ctx.lineWidth=1.5;ctx.setLineDash(it.offset>0?[5,3]:[]);ctx.strokeRect(x,y,it.w*sc,it.d*sc);ctx.setLineDash([]);ctx.fillStyle='#56534b';ctx.font='12px sans-serif';ctx.fillText((it.offset<0?'下げ ':'折り上げ +')+it.offset+'mm',x+5,y+17,Math.max(10,it.w*sc-10));ctx.restore();if(ST.selected===it&&ST.tool==='select')drawHandles(it,x+it.w*sc/2,y+it.d*sc/2,it.w*sc/2,it.d*sc/2,sc);
}
function props(it){
 document.getElementById('props-title').textContent='天井範囲 の設定';
 let html=selectedLockControlHtml(it)+'<div class="ph">天井の範囲</div>';
 [['x','X位置'],['y','Y位置'],['w','幅'],['d','奥行'],['offset','段差（下げは負）']].forEach(([key,label])=>{html+='<div class="pr"><label class="pl">'+label+' mm</label><input class="pi" data-ceiling-field="'+key+'" type="number" step="10" value="'+(Math.round(it[key]*100)/100)+'" onchange="updateSelectedProp(\''+key+'\',Number(this.value))"></div>';});
 html+='<div class="pr"><label class="pl">仕上げ色</label><input class="pi" type="color" value="'+(it.color||'#e4ddd1')+'" onchange="updateSelectedProp(\'color\',this.value)"></div>'
  +selectedTextureUploadHtml(it,'仕上げテクスチャ')
  +(it.texture?'<button class="pbtn sec" onclick="updateSelectedProp(\'texture\',null)">テクスチャ解除</button>':'')
  +selectedTextureFlipControlsHtml(it)
  +(it.texture?'<div class="lock-status-note">テクスチャを設定しているあいだ、仕上げ色は段差の立ち上がりにだけ効きます（部屋の天井仕上げと同じ決まりです）。</div>':'')
  +'<p class="model-finish-note">通常のハンドルで移動・サイズ変更できます。照明の取付高さは天井の変更に追従します。</p>'+selectedDeleteButtonHtml();
 setPropsBodyHtml(document.getElementById('props-body'),html,it);
 const name=document.getElementById('mob-prop-name');if(name)name.textContent='天井範囲';
 const size=document.getElementById('mob-prop-size');if(size)size.textContent=it.w+' × '+it.d+' mm';
}
let floorCamera=null;
function ceilingCamera(){
 if(ST.view!=='3d-int'||!ST.ceilingView||!camExt||!orbit)return;
 const rr=DATA.rooms.filter(r=>r.floor===ST.floor);if(!rr.length)return;
 const x1=Math.min(...rr.map(r=>r.x)),x2=Math.max(...rr.map(r=>r.x+r.w)),z1=Math.min(...rr.map(r=>r.y)),z2=Math.max(...rr.map(r=>r.y+r.d));
 const x=(x1+x2)*U/2,z=(z1+z2)*U/2,h=floorBaseY(ST.floor)+roomCeilingHeightM(rr[0]);
 const half=Math.min(camExt.fov*Math.PI/360,Math.atan(Math.tan(camExt.fov*Math.PI/360)*camExt.aspect)),radius=Math.hypot((x2-x1)*U,(z2-z1)*U,2.7)/2,distance=radius/Math.sin(half)*1.18;
 orbit.maxPolarAngle=Math.PI-.01;orbit.minPolarAngle=.01;camExt.up.set(0,1,0);orbit.target.set(x,h,z);camExt.position.set(x,h-distance*.94,z+distance*.342);orbit.update();
}
function syncUI(){
 const control=document.getElementById('surface-sel');document.getElementById('surface-control').hidden=ST.view!=='2d'&&ST.view!=='3d-int';
 document.getElementById('surface-context').textContent=ST.view==='3d-int'?'内観3Dの表示':'平面図の表示';control.value=ST.ceilingView?'ceiling':'floor';
 if(ST.view==='2d'||ST.view==='3d-int')document.getElementById('st-mode').textContent='モード:'+(ST.view==='2d'?'平面図':'内観3D')+(active()?' · 天井':'');
}
function setSurface(value){
 migrate();const enabled=value==='ceiling';if(ST.ceilingView===enabled)return;
 if(ST.view==='3d-int'&&camExt&&orbit){if(enabled)floorCamera={pos:camExt.position.clone(),target:orbit.target.clone(),min:orbit.minPolarAngle,max:orbit.maxPolarAngle};else if(floorCamera){camExt.position.copy(floorCamera.pos);orbit.target.copy(floorCamera.target);orbit.minPolarAngle=floorCamera.min;orbit.maxPolarAngle=floorCamera.max;orbit.update();}}
 ST.ceilingView=enabled;ST.selected=null;clearMultiSelection();ST.drawing=false;ST.drawPts=[];setTool('select');syncUI();draw2d();updateProps();if(ren)rebuild3D();if(enabled)ceilingCamera();
}
function editOperation(fn){return function(){if(!hasAreas())return fn.apply(this,arguments);const before=snapshot();const result=fn.apply(this,arguments);reconcile(before);draw2d();if(ren)rebuild3D();return result;};}
// Reuse the application's edit pipeline, selection state, history and camera.
const originalDrag=applyHandleDrag;
applyHandleDrag=function(){if(zone(ST.selected)&&DRAG.handle==='rot')return;const before=hasAreas()?snapshot():null;originalDrag.apply(this,arguments);if(before)reconcile(before);};
const originalUpdate=updateSelectedProp;
updateSelectedProp=function(key,value){if(zone(ST.selected)&&key!=='locked'){const trial={...ST.selected,[key]:value},error=validItem(trial);if(error){message(error);updateProps();return;}}return editOperation(originalUpdate).apply(this,arguments);};
removeObjectRef=editOperation(removeObjectRef);delSel=editOperation(delSel);
const originalGizmo=apply3DGizmoDrag;
apply3DGizmoDrag=function(){const before=hasAreas()?snapshot():null;if(zone(GIZMO_DRAG.ref))GIZMO_DRAG.partialRoots=null;originalGizmo.apply(this,arguments);if(before){reconcile(before);draw2d();if(ren)rebuild3D();}};
const originalStash=stashCurrentCamera;
stashCurrentCamera=function(){if(ST.view==='3d-int'&&ST.ceilingView)return;return originalStash.apply(this,arguments);};
const originalView=setView;
setView=function(v){if(ST.ceilingView&&v!=='2d'&&v!=='3d-int')setSurface('floor');originalView(v);syncUI();if(ST.ceilingView&&v==='3d-int'){floorCamera={pos:camExt.position.clone(),target:orbit.target.clone(),min:orbit.minPolarAngle,max:orbit.maxPolarAngle};ceilingCamera();}};
const originalFloor=onFloorChange;
onFloorChange=function(){originalFloor.apply(this,arguments);syncUI();if(ST.ceilingView)ceilingCamera();};
const originalFit=resetView;
resetView=function(){originalFit.apply(this,arguments);if(active()&&ST.view==='3d-int')ceilingCamera();};
const originalTool=setTool;
setTool=function(t){if(isTool(t)){if(ST.view!=='2d'&&ST.view!=='3d-int')setView('2d');if(!ST.ceilingView)setSurface('ceiling');message('対角の2点を指定して天井範囲を作成します。');}originalTool(t);};
const originalPaste=pasteCopiedObject;
pasteCopiedObject=function(){const before=snapshot();const result=originalPaste();if(result&&zone(ST.selected)){const it=ST.selected;let error=validItem(it);if(error){const r=roomFor(it);if(r){outer:for(let y=r.y+50;y+it.d<=r.y+r.d-5;y+=100)for(let x=r.x+50;x+it.w<=r.x+r.w-5;x+=100){it.x=x;it.y=y;if(!validItem(it)){error='';break outer;}}}if(error){DATA.items=DATA.items.filter(o=>o!==it);ST.selected=null;message('貼り付け先に空き範囲がありません。');}}updateProps();draw2d();if(ren)rebuild3D();}reconcile(before);draw2d();if(ren)rebuild3D();return result;};
function pickPlacement(e){
 if(!active()||ST.view!=='3d-int'||(!isTool(ST.tool)&&!fixture({type:ST.tool})))return false;
 const rect=ren.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();
 ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camExt);
 const meshes=[];sc3.traverse(o=>{if(o.isMesh&&o.visible&&o.userData.ceiling)meshes.push(o);});
 const hit=ray.intersectObjects(meshes,false)[0];if(!hit)return true;
 const x=snapV(hit.point.x/U),y=snapV(hit.point.z/U);
 if(isTool(ST.tool))drawClick(x,y);else{placeItem(ST.tool,x,y);rebuild3D();}return true;
}
// Determine the remaining material from the very same floor/roof surfaces used to render.
function raisingLimit(r,it){
 const base=floorBaseY(r.floor)+roomCeilingHeightM(r),rect=it||r;
 let max=Infinity,reason='上階の床厚';
 DATA.rooms.filter(u=>u.floor===r.floor+1&&roomsOverlapInPlan(rect,u)).forEach(u=>{
  const y=roomFloorTopY(u)-.02;if(y<max){max=y;reason='上階の床厚・床下げ';}
 });
 if(max===Infinity){
  const roofs=DATA.items.filter(o=>o.type==='roof'&&!o.hidden3D&&o.floor>r.floor);
  // Roof surfaces are piecewise linear; sample footprint corners and interior as well.
  for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){
   const x=rect.x+rect.w*i/8,z=rect.y+rect.d*j/8;
   const covered=roofs.filter(o=>roofCoversPlanPoint(o,x,z));
   if(!covered.length)return {mm:0,reason:'屋根のない範囲'};
   for(const roof of covered){const y=roofUndersideWorldYAt(roof,x,z)-.02;if(y<max){max=y;reason='屋根の上面';}}
  }
 }
 return {mm:Math.max(0,Math.floor((max-base)/U+1e-6)),reason};
}
function floorLoweringLimit(r){
 let min=-Math.max(0,floorSlabMmForFloor(r.floor)-20);
 DATA.rooms.filter(b=>b.floor===r.floor-1).forEach(b=>areas(b).filter(a=>a.offset>0).forEach(a=>{
  const rect={x:b.x+a.x,y:b.y+a.y,w:a.w,d:a.d};if(!roomsOverlapInPlan(r,rect))return;
  const top=floorBaseY(b.floor)+roomCeilingHeightM(b)+a.offset*U;
  const floor=localSupportTopY(r.floor,r.x,r.y,r.x+r.w,r.y+r.d)+floorSlabHeightMForFloor(r.floor);
  min=Math.max(min,Math.ceil((top+.02-floor)/U-1e-6));
 }));return min;
}
// Subtract a world-space rectangular recess from generated floor/roof triangles.
// The ceiling surface and its fascia close the cut. No per-frame shader or renderer.
function cutMesh(mesh,box){
 const original=mesh.geometry;if(!original?.attributes.position)return;
 const bounds=new THREE.Box3().setFromObject(mesh);if(!bounds.intersectsBox(box))return;
 const src=original.index?original.toNonIndexed():original.clone(),attrs=src.attributes;
 const names=Object.keys(attrs),out=Object.fromEntries(names.map(k=>[k,[]])),groups=[];
 const p=attrs.position;
 function vertex(i){const a={};for(const k of names){const at=attrs[k];a[k]=Array.from({length:at.itemSize},(_,j)=>at.array[i*at.itemSize+j]);}a.world=new THREE.Vector3(...a.position).applyMatrix4(mesh.matrixWorld);return a;}
 function mix(a,b,t){const v={};for(const k of names)v[k]=a[k].map((x,i)=>x+(b[k][i]-x)*t);v.world=a.world.clone().lerp(b.world,t);return v;}
 function split(poly,axis,value,sign){const inside=[],outside=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a.world[axis]-value)*sign,db=(b.world[axis]-value)*sign;(da>=0?inside:outside).push(a);if((da>=0)!==(db>=0)){const v=mix(a,b,da/(da-db));inside.push(v);outside.push(v);}}return {inside,outside};}
 function emit(poly,material){if(poly.length<3)return;const start=out.position.length/3;for(let i=1;i<poly.length-1;i++)for(const v of [poly[0],poly[i],poly[i+1]])for(const k of names)out[k].push(...v[k]);const count=out.position.length/3-start,last=groups.at(-1);if(last&&last.materialIndex===material)last.count+=count;else groups.push({start,count,materialIndex:material});}
 const planes=[['x',box.min.x,1],['x',box.max.x,-1],['z',box.min.z,1],['z',box.max.z,-1],['y',box.max.y,-1],['y',box.min.y,1]];
 for(let i=0;i<p.count;i+=3){let poly=[vertex(i),vertex(i+1),vertex(i+2)];const material=(src.groups.find(g=>i>=g.start&&i<g.start+g.count)||{}).materialIndex||0;for(const plane of planes){if(!poly.length)break;const parts=split(poly,...plane);emit(parts.outside,material);poly=parts.inside;}}
 const geo=new THREE.BufferGeometry();for(const k of names)geo.setAttribute(k,new THREE.Float32BufferAttribute(out[k],attrs[k].itemSize));for(const g of groups)geo.addGroup(g.start,g.count,g.materialIndex);geo.computeBoundingBox();geo.computeBoundingSphere();mesh.geometry=geo;src.dispose();original.dispose();
}
function carveRecesses(scene){
 const cuts=[];DATA.rooms.forEach(r=>areas(r).filter(a=>a.offset>0).forEach(a=>{
  const base=floorBaseY(r.floor)+roomCeilingHeightM(r);
  cuts.push({floor:r.floor,box:new THREE.Box3(new THREE.Vector3((r.x+a.x)*U,base-.02,(r.y+a.y)*U),new THREE.Vector3((r.x+a.x+a.w)*U,base+a.offset*U+.001,(r.y+a.y+a.d)*U))});
 }));if(!cuts.length)return;
 scene.updateMatrixWorld(true);
 scene.traverse(mesh=>{if(!mesh.isMesh||mesh.isInstancedMesh)return;const ref=mesh.userData?.selectRef;if(!ref||mesh.userData.ceiling)return;
  if(ref.type!=='roof'&&ref.type!=='room')return;
  for(const cut of cuts)if(ref.type==='roof'?ref.floor>cut.floor:ref.floor===cut.floor+1)cutMesh(mesh,cut.box);
 });
}
// The model and view adapter intentionally have no canvas, renderer or dialog of their own.
window.CeilingDesigner={active,zone,fixture,visible,areas,offsetAt,ceilingGroup,migrate,isTool,drawClick,drawArea,props,setSurface,validItem,ceilingCamera,pickPlacement,raisingLimit,floorLoweringLimit,carveRecesses};
ILABELS['ceiling-area']='天井範囲';
syncUI();
})();
