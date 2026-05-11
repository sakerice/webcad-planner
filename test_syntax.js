// ───── CONSTANTS ─────
var WALL_H = 2400;
var FLOOR_H = 2700;
var U = 0.001;
var ROOF = {type:'gable', pitch:30, color:'#2a2a30'};
var WALL_COLORS = {upper:'#e8e0cc', lower:'#5c3820'};

var ISIZES = {
  bath:{w:1600,d:1600}, toilet:{w:400,d:700}, sink:{w:750,d:500},
  kitchen:{w:2550,d:650}, fridge:{w:650,d:650},
  sofa:{w:1800,d:800}, 'dining-table':{w:1500,d:800},
  'bed-d':{w:1400,d:1950}, 'bed-s':{w:970,d:1950},
  desk:{w:1000,d:600}, tv:{w:1500,d:400},
  closet:{w:1820,d:600}, stair:{w:910,d:1820},
  balcony:{w:1820,d:910},
  'door-swing':{w:800,d:800}, 'door-slide':{w:1650,d:150},
  window:{w:1650,d:150}, 'door-front':{w:910,d:200},
  'site-rect':{w:10000,d:8000}
};
var ICOLORS = {
  bath:'#b8d4f0', toilet:'#d4e8f0', sink:'#c8e0f8', kitchen:'#f0d8a8',
  fridge:'#d0e8d0', sofa:'#e0c8a8', 'dining-table':'#f0e0b0',
  'bed-d':'#d8d0e8','bed-s':'#d8d0e8', desk:'#c8d8e0',
  tv:'#1a1a1a', closet:'#e8d8c8', stair:'#e8e0c8', balcony:'#c8e8c8',
  'door-swing':'#f8e8c0','door-slide':'#f8e8c0',
  window:'#c0e4f8','door-front':'#f8d0a0','site-rect':'rgba(100,160,100,0.1)'
};
var ILABELS = {
  kitchen:'キッチン',bath:'バス',toilet:'トイレ',sink:'洗面',fridge:'冷蔵庫',
  sofa:'ソファ','dining-table':'ダイニング','bed-d':'ベッド(D)','bed-s':'ベッド(S)',
  desk:'デスク',tv:'TV',closet:'収納',stair:'階段',balcony:'バルコニー',
  'door-swing':'開戸','door-slide':'引戸',window:'窓','door-front':'玄関','site-rect':'敷地'
};

// ───── STATE ─────
var ST = {
  floor:1, view:'2d', tool:'wall', selected:null,
  zoom:1, panX:60, panY:60,
  drawing:false, drawPts:[],
  mouseW:{x:0,y:0}, snap:455, showGrid:true, showDim:true,
  placingRot:0,
  isPanning:false, panStart:{x:0,y:0}, panOrigin:{x:0,y:0}, selectAll:false
};

// DRAG state for handle transform
var DRAG = {active:false, saved:false, handle:null, startCX:0, startCY:0, origItem:null};

var DATA = {walls:[], items:[], rooms:[]};
var nextId = 1;
var HISTORY = [];
function saveState(){
  var s=JSON.stringify(DATA,function(k,v){return k==='_texObj'?undefined:v;});
  HISTORY.push(s);if(HISTORY.length>50)HISTORY.shift();
}

// ───── DATA HELPERS ─────
function mkWall(x1,y1,x2,y2,floor,thick,color){
  return {id:nextId++,x1:x1,y1:y1,x2:x2,y2:y2,floor:floor||1,
    thick:thick||120,color:color||'#888',texture:null,texScale:1,_texObj:null};
}
function mkItem(type,x,y,rot,floor,w,d){
  var sz=ISIZES[type]||{w:900,d:900};
  return {id:nextId++,type:type,x:x,y:y,rot:rot||0,floor:floor||1,
    w:w||sz.w,d:d||sz.d,color:ICOLORS[type]||'#ddd'};
}

// ───── PRESET DATA ─────
function loadPreset(){
  DATA.walls=[]; DATA.items=[]; DATA.rooms=[]; nextId=1;
  // Floor 1 Rooms
  DATA.rooms.push({id:'rm_1', type:'room', x:1820, y:0, w:5460, d:3185, floor:1, n:'LDK 14.3帖'});
  DATA.rooms.push({id:'rm_2', type:'room', x:0, y:3185, w:910, d:910, floor:1, n:'収納'});
  DATA.rooms.push({id:'rm_3', type:'room', x:5460, y:3185, w:1820, d:910, floor:1, n:'バルコニー'});
  // Floor 2 Rooms
  DATA.rooms.push({id:'rm_4', type:'room', x:0, y:1820, w:2730, d:2275, floor:2, n:'洋室 4.2帖'});
  DATA.rooms.push({id:'rm_5', type:'room', x:0, y:910, w:1820, d:910, floor:2, n:'ファミリーCL'});
  DATA.rooms.push({id:'rm_6', type:'room', x:5460, y:0, w:1820, d:1820, floor:2, n:'バス'});
  DATA.rooms.push({id:'rm_7', type:'room', x:5460, y:1820, w:1820, d:1820, floor:2, n:'洗面'});
  // Floor 3 Rooms
  DATA.rooms.push({id:'rm_8', type:'room', x:0, y:0, w:2730, d:3185, floor:3, n:'趣味部屋① 4.3帖'});
  DATA.rooms.push({id:'rm_9', type:'room', x:2730, y:0, w:2275, d:2275, floor:3, n:'趣味部屋② 3.7帖'});
  DATA.rooms.push({id:'rm_10', type:'room', x:2730, y:2275, w:2275, d:910, floor:3, n:'床上げ収納'});
  DATA.rooms.push({id:'rm_11', type:'room', x:5005, y:2275, w:910, d:910, floor:3, n:'収納'});
  // 1F outer
  DATA.walls.push(mkWall(0,0,7280,0,1,150)); DATA.walls.push(mkWall(7280,0,7280,4095,1,150));
  DATA.walls.push(mkWall(7280,4095,0,4095,1,150)); DATA.walls.push(mkWall(0,4095,0,0,1,150));
  // 1F inner
  DATA.walls.push(mkWall(910,3415,910,4095,1,90)); DATA.walls.push(mkWall(0,3415,910,3415,1,90));
  DATA.walls.push(mkWall(910,0,910,2730,1,90)); DATA.walls.push(mkWall(910,2730,2275,2730,1,90));
  DATA.walls.push(mkWall(2275,0,2275,1365,1,90)); DATA.walls.push(mkWall(2275,1365,5005,1365,1,90));
  DATA.walls.push(mkWall(5005,0,5005,1365,1,90));
  DATA.walls.push(mkWall(5460,0,5460,3185,1,90)); DATA.walls.push(mkWall(5460,3185,7280,3185,1,90));
  // 2F outer
  DATA.walls.push(mkWall(0,0,7280,0,2,150)); DATA.walls.push(mkWall(7280,0,7280,4095,2,150));
  DATA.walls.push(mkWall(7280,4095,0,4095,2,150)); DATA.walls.push(mkWall(0,4095,0,0,2,150));
  // 2F inner
  DATA.walls.push(mkWall(0,1365,2730,1365,2,90)); DATA.walls.push(mkWall(2730,1365,2730,4095,2,90));
  DATA.walls.push(mkWall(0,2730,1820,2730,2,90)); DATA.walls.push(mkWall(1820,1365,1820,2730,2,90));
  DATA.walls.push(mkWall(2730,0,2730,910,2,90)); DATA.walls.push(mkWall(2730,910,4095,910,2,90));
  DATA.walls.push(mkWall(4095,0,4095,910,2,90));
  DATA.walls.push(mkWall(5460,0,5460,4095,2,90)); DATA.walls.push(mkWall(5460,2275,7280,2275,2,90));
  DATA.walls.push(mkWall(5460,1365,7280,1365,2,90));
  DATA.walls.push(mkWall(3640,910,3640,1820,2,90)); DATA.walls.push(mkWall(2730,1820,3640,1820,2,90));
  // 3F outer
  DATA.walls.push(mkWall(0,0,5915,0,3,150)); DATA.walls.push(mkWall(5915,0,5915,3185,3,150));
  DATA.walls.push(mkWall(5915,3185,0,3185,3,150)); DATA.walls.push(mkWall(0,3185,0,0,3,150));
  // 3F inner
  DATA.walls.push(mkWall(2275,0,2275,3185,3,90));
  DATA.walls.push(mkWall(3185,0,3185,910,3,90)); DATA.walls.push(mkWall(2275,910,3185,910,3,90));
  DATA.walls.push(mkWall(2275,2275,3185,2275,3,90)); DATA.walls.push(mkWall(3185,910,3185,2275,3,90));
  DATA.walls.push(mkWall(4550,2275,5915,2275,3,90)); DATA.walls.push(mkWall(4550,0,4550,2275,3,90));

  // Items 1F
  DATA.items.push(mkItem('kitchen',910,50,0,1));
  DATA.items.push(mkItem('fridge',0,1950,0,1));
  DATA.items.push(mkItem('dining-table',2800,1650,0,1));
  DATA.items.push(mkItem('sofa',3800,2200,0,1));
  DATA.items.push(mkItem('tv',5000,2100,90,1));
  DATA.items.push(mkItem('stair',2275,0,0,1));
  DATA.items.push(mkItem('door-front',3200,0,180,1));
  DATA.items.push(mkItem('window',1500,0,180,1));
  DATA.items.push(mkItem('window',4000,0,180,1));
  DATA.items.push(mkItem('window',7280,1500,90,1));
  DATA.items.push(mkItem('balcony',5460,3185,0,1));
  // Items 2F
  DATA.items.push(mkItem('bed-d',100,1700,0,2));
  DATA.items.push(mkItem('bed-d',1600,1700,0,2));
  DATA.items.push(mkItem('closet',0,1365,0,2));
  DATA.items.push(mkItem('bath',5600,0,0,2));
  DATA.items.push(mkItem('toilet',2730,910,0,2));
  DATA.items.push(mkItem('sink',5460,1365,90,2));
  DATA.items.push(mkItem('stair',2730,0,0,2));
  DATA.items.push(mkItem('window',0,2000,270,2));
  DATA.items.push(mkItem('window',3000,0,180,2));
  DATA.items.push(mkItem('window',7280,500,90,2));
  DATA.items.push(mkItem('window',7280,2800,90,2));
  // Items 3F
  DATA.items.push(mkItem('stair',2275,910,0,3));
  DATA.items.push(mkItem('toilet',2640,0,0,3));
  DATA.items.push(mkItem('desk',300,200,0,3));
  DATA.items.push(mkItem('desk',3200,300,0,3));
  DATA.items.push(mkItem('window',1000,0,180,3));
  DATA.items.push(mkItem('window',3600,0,180,3));
}

// ───── SPRITE PRELOADER ─────
var SPRITE_IMG = new Image();
var SPRITE_JSON = {
  cell: 512,
  sprites: {
    toilet: {x: 0, y: 0, w: 512, h: 512}, bed: {x: 512, y: 0, w: 512, h: 512}, sink: {x: 1024, y: 0, w: 512, h: 512},
    tv: {x: 1536, y: 0, w: 512, h: 512}, bathtub: {x: 2048, y: 0, w: 512, h: 512}, car: {x: 0, y: 512, w: 512, h: 512},
    sofa: {x: 512, y: 512, w: 512, h: 512}, kitchen: {x: 1024, y: 512, w: 512, h: 512}, fridge: {x: 1536, y: 512, w: 512, h: 512},
    dining: {x: 2048, y: 512, w: 512, h: 512}, wood_floor: {x: 0, y: 1024, w: 512, h: 512}, stone: {x: 512, y: 1024, w: 512, h: 512},
    tree: {x: 1024, y: 1024, w: 512, h: 512}, tile_floor: {x: 1536, y: 1024, w: 512, h: 512}, grass: {x: 2048, y: 1024, w: 512, h: 512}
  }
};
var SPRITE_MAP = {
  toilet:'toilet', 'bed-d':'bed', 'bed-s':'bed', sink:'sink', tv:'tv', bath:'bathtub',
  sofa:'sofa', kitchen:'kitchen', fridge:'fridge', 'dining-table':'dining'
};
var PATTERNS = {};
SPRITE_IMG.onload = function() {
  function extPat(key) {
    var s = SPRITE_JSON.sprites[key]; if(!s) return;
    var c = document.createElement('canvas'); c.width=s.w; c.height=s.h;
    c.getContext('2d').drawImage(SPRITE_IMG, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    PATTERNS[key] = c;
  }
  extPat('wood_floor'); extPat('grass'); extPat('stone'); extPat('tile_floor');
  draw2d();
};
SPRITE_IMG.src = 'assets/japanese_floorplan_parts_sprite_gpt.png';
loadSprite('kitchen','assets/kitchen.png'); loadSprite('bath','assets/bathtub.png');
loadSprite('toilet','assets/toilet.png'); loadSprite('sink','assets/sink.png');
loadSprite('sofa','assets/sofa.png'); loadSprite('dining-table','assets/dining.png');
loadSprite('bed','assets/bed.png'); loadSprite('bed-s','assets/bed.png');
loadSprite('fridge','assets/fridge.png'); loadSprite('tv','assets/tv.png');
loadSprite('tree','assets/tree.png'); loadSprite('car','assets/car.png');
loadPattern('wood','assets/wood_floor.png'); loadPattern('grass','assets/grass.png');
loadPattern('tile','assets/tile_floor.png'); loadPattern('stone','assets/stone.png');

// ───── 2D CANVAS ─────
var canvas=document.getElementById('c2d');
var ctx=canvas.getContext('2d');

function resize2d(){
  var a=document.getElementById('canvas-area');
  canvas.width=a.clientWidth; canvas.height=a.clientHeight;
  draw2d();
}
function w2c(wx,wy){return{cx:ST.panX+wx*ST.zoom*0.05, cy:ST.panY+wy*ST.zoom*0.05};}
function c2w(cx,cy){return{x:(cx-ST.panX)/(ST.zoom*0.05), y:(cy-ST.panY)/(ST.zoom*0.05)};}
function snapV(v){return ST.snap?Math.round(v/ST.snap)*ST.snap:Math.round(v);}

var FOOTPRINTS={1:{w:7280,h:4095},2:{w:7280,h:4095},3:{w:5915,h:3185}};

function draw2d(){
  var W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#e8e4dc'; ctx.fillRect(0,0,W,H);
  // Draw site/lot with grass texture
  drawSite();
  if(ST.showGrid) drawGrid();
  drawFootprint();

  var sc=ST.zoom*0.05;
  // Draw Rooms
  DATA.rooms.filter(function(r){return r.floor===ST.floor;}).forEach(function(r){
    var px=ST.panX+r.x*sc, py=ST.panY+r.y*sc, w=r.w*sc, d=r.d*sc;
    var sel=ST.selected===r || (ST.selectAll && r.floor===ST.floor);
    ctx.fillStyle='rgba(245,245,250,0.8)';
    ctx.fillRect(px,py,w,d);
    ctx.strokeStyle=sel?'#e94560':'#888';
    ctx.lineWidth=sel?3:1;
    ctx.strokeRect(px,py,w,d);
  });

  var fw=DATA.walls.filter(function(w){return w.floor===ST.floor;});
  var fi=DATA.items.filter(function(i){return i.floor===ST.floor;});
  fw.forEach(drawWall2d);
  fi.forEach(drawItem2d);
  drawRoomLbls();
  if(ST.drawing&&ST.drawPts.length>0) drawPreview();
  if(ST.showDim) drawDim();
  document.getElementById('st-walls').textContent='壁:'+fw.length;
}

function drawGrid(){
  var sc=ST.zoom*0.05, mg=910*sc;
  if(mg<3) return;
  var ox=((ST.panX%mg)+mg)%mg, oy=((ST.panY%mg)+mg)%mg;
  ctx.strokeStyle='rgba(0,0,0,0.07)'; ctx.lineWidth=1;
  for(var x=ox;x<canvas.width;x+=mg){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(var y=oy;y<canvas.height;y+=mg){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  if(sc*455>10){
    var sg=455*sc,ox2=((ST.panX%sg)+sg)%sg,oy2=((ST.panY%sg)+sg)%sg;
    ctx.strokeStyle='rgba(0,0,0,0.03)';
    for(var x=ox2;x<canvas.width;x+=sg){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
    for(var y=oy2;y<canvas.height;y+=sg){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
  }
}

// Draw the site/lot with grass texture
function drawSite(){
  var site=DATA.site||{x:-3000,y:-3000,w:22000,h:18000};
  var a=w2c(site.x,site.y),b=w2c(site.x+site.w,site.y+site.h);
  var sw=b.cx-a.cx,sh=b.cy-a.cy;
  if(PATTERNS.grass){
    ctx.save();
    ctx.globalAlpha=0.35;
    var pat=ctx.createPattern(PATTERNS.grass,'repeat');
    ctx.fillStyle=pat;
    ctx.fillRect(a.cx,a.cy,sw,sh);
    ctx.restore();
  } else {
    ctx.fillStyle='rgba(210,230,190,0.3)';
    ctx.fillRect(a.cx,a.cy,sw,sh);
  }
  // Site border
  ctx.strokeStyle='rgba(0,0,0,0.15)';ctx.lineWidth=1;ctx.setLineDash([8,4]);
  ctx.strokeRect(a.cx,a.cy,sw,sh);ctx.setLineDash([]);
}

function drawFootprint(){
  var fp=FOOTPRINTS[ST.floor],a=w2c(0,0),b=w2c(fp.w,fp.h);
  var fw=b.cx-a.cx,fh=b.cy-a.cy;
  // Fill building footprint with room floor texture
  ctx.save();
  if(PATTERNS.wood_floor){
    var pat=ctx.createPattern(PATTERNS.wood_floor,'repeat');
    ctx.fillStyle=pat;
    ctx.globalAlpha=0.45;
    ctx.fillRect(a.cx,a.cy,fw,fh);
    ctx.globalAlpha=1.0;
  } else {
    ctx.fillStyle='#f5f0e4';
    ctx.fillRect(a.cx,a.cy,fw,fh);
  }
  // Light overlay for cleaner look
  ctx.fillStyle='rgba(250,248,240,0.55)';
  ctx.fillRect(a.cx,a.cy,fw,fh);
  ctx.restore();
}

function drawRoomLbls(){
  var labels=RLABELS[ST.floor]||[];
  labels.forEach(function(l){
    var p=w2c(l.x,l.y);
    var parts=l.n.split(' ');
    var name=parts[0], area=parts[1]||'';
    var szN=Math.max(9,ST.zoom*6), szA=Math.max(7,ST.zoom*4);
    // Background pill
    ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
    var tw=Math.max(ctx.measureText(name).width,ctx.measureText(area).width)+16;
    var th=area?szN+szA+12:szN+10;
    ctx.fillStyle='rgba(255,255,255,0.75)';
    ctx.beginPath();
    var rx=p.cx-tw/2,ry=p.cy-th/2;
    ctx.roundRect(rx,ry,tw,th,4); ctx.fill();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#3a3a4a';
    ctx.fillText(name,p.cx,area?p.cy-szA/2:p.cy);
    if(area){
      ctx.font=szA+'px "Noto Sans JP",sans-serif';
      ctx.fillStyle='#8a8a98';
      ctx.fillText(area,p.cx,p.cy+szN/2+2);
    }
  });
}

function drawWall2d(w){
  var a=w2c(w.x1,w.y1),b=w2c(w.x2,w.y2);
  var dx=b.cx-a.cx,dy=b.cy-a.cy,len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return;
  var nx=-dy/len,ny=dx/len,t=w.thick*ST.zoom*0.05/2;
  var isOuter=w.thick>=130, sel=ST.selected===w;
  ctx.beginPath();
  ctx.moveTo(a.cx+nx*t,a.cy+ny*t); ctx.lineTo(b.cx+nx*t,b.cy+ny*t);
  ctx.lineTo(b.cx-nx*t,b.cy-ny*t); ctx.lineTo(a.cx-nx*t,a.cy-ny*t);
  ctx.closePath();
  if(sel||(ST.selectAll && w.floor===ST.floor)){
    ctx.fillStyle='rgba(233,69,96,0.7)'; ctx.fill();
    ctx.strokeStyle='#e94560'; ctx.lineWidth=2; ctx.stroke();
  } else if(w.color&&w.color!=='#888'){
    ctx.fillStyle=w.color; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=1; ctx.stroke();
  } else if(isOuter){
    ctx.fillStyle='#4a4a50'; ctx.fill();
    ctx.strokeStyle='#2a2a30'; ctx.lineWidth=1.5; ctx.stroke();
  } else {
    ctx.fillStyle='#808088'; ctx.fill();
    ctx.strokeStyle='#5a5a60'; ctx.lineWidth=1; ctx.stroke();
  }
}

function drawItem2d(it){
  var sc=ST.zoom*0.05;
  var ccx=ST.panX+(it.x+it.w/2)*sc, ccy=ST.panY+(it.d/2+it.y)*sc; // ccx, ccy
  ctx.save();
  ctx.translate(ccx,ccy); ctx.rotate(it.rot*Math.PI/180);
  var spriteKey=SPRITE_MAP[it.type];
  if(spriteKey && SPRITE_IMG.complete && SPRITE_JSON.sprites[spriteKey]){
    var s = SPRITE_JSON.sprites[spriteKey];
    var maxD = Math.max(it.w, it.d);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-it.w/2*sc, -it.d/2*sc, it.w*sc, it.d*sc);
    ctx.clip();
    ctx.drawImage(SPRITE_IMG, s.x, s.y, s.w, s.h, -maxD/2*sc, -maxD/2*sc, maxD*sc, maxD*sc);
    ctx.restore();
  } else {
    ctx.fillStyle=it.color||'#dddddd'; ctx.fillRect(-it.w/2*sc,-it.d/2*sc,it.w*sc,it.d*sc);
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(-it.w/2*sc,-it.d/2*sc,it.w*sc,it.d*sc);
  }
  ctx.restore();
  if(ST.selected===it&&ST.tool==='select') drawHandles(it,ccx,ccy,it.w*sc/2,it.d*sc/2,sc);
}

// ───── SELECTION HANDLES ─────
function drawHandles(it,ccx,ccy,hw,hd,sc){
  ctx.save();
  ctx.translate(ccx,ccy); 
  if(it.type !== 'room') ctx.rotate(it.rot*Math.PI/180);
  ctx.strokeStyle='rgba(50,120,240,0.7)'; ctx.lineWidth=1.2; ctx.setLineDash([4,3]);
  ctx.strokeRect(-hw-5,-hd-5,it.w*sc+10,it.d*sc+10);
  ctx.setLineDash([]);
  var pts=[[-hw,-hd],[0,-hd],[hw,-hd],[hw,0],[hw,hd],[0,hd],[-hw,hd],[-hw,0]];
  pts.forEach(function(p){
    ctx.fillStyle='#fff'; ctx.strokeStyle='#3080e8'; ctx.lineWidth=1.5;
    ctx.fillRect(p[0]-5,p[1]-5,10,10); ctx.strokeRect(p[0]-5,p[1]-5,10,10);
  });
  ctx.restore();
}

function applyHandleDrag(cx,cy,e){
  var h=DRAG.handle, o=DRAG.origItem, it=ST.selected;
  if(!it||!o) return;
  if(!DRAG.saved){saveState(); DRAG.saved=true;}
  var dx=(cx-DRAG.startCX)/(ST.zoom*0.05), dy=(cy-DRAG.startCY)/(ST.zoom*0.05);
  if(h==='move'){
    var nx=o.x+dx, ny=o.y+dy;
    if(e.shiftKey){nx=snapV(nx);ny=snapV(ny);}
    it.x=nx; it.y=ny;
  }else if(h==='rot'){
    var oAng=Math.atan2(cy-ST.panY-(o.y*ST.zoom*0.05),cx-ST.panX-(o.x*ST.zoom*0.05));
    var sAng=Math.atan2(DRAG.startCY-ST.panY-(o.y*ST.zoom*0.05),DRAG.startCX-ST.panX-(o.x*ST.zoom*0.05));
    var nRot=o.rot+(oAng-sAng)*180/Math.PI;
    if(e.shiftKey) nRot=Math.round(nRot/45)*45;
    it.rot=nRot;
  }else{
    var nw=o.w+(h.indexOf('e')>=0?dx:h.indexOf('w')>=0?-dx:0), nd=o.d+(h.indexOf('s')>=0?dy:h.indexOf('n')>=0?-dy:0);
    if(e.shiftKey){nw=Math.round(nw/100)*100;nd=Math.round(nd/100)*100;}
    it.w=Math.max(10,nw); it.d=Math.max(10,nd);
  }
}

function hitHandle(it,mx,my){
  var sc=ST.zoom*0.05;
  var ccx=ST.panX+(it.x+it.w/2)*sc, ccy=ST.panY+(it.y+it.d/2)*sc;
  var hw=it.w*sc/2, hd=it.d*sc/2;
  var dx=mx-ccx, dy=my-ccy;
  var rad=-it.rot*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad);
  var lx=dx*cos-dy*sin, ly=dx*sin+dy*cos;
  var handles=[{lx:-hw,ly:-hd,t:'nw'},{lx:0,ly:-hd,t:'n'},{lx:hw,ly:-hd,t:'ne'},{lx:hw,ly:0,t:'e'},{lx:hw,ly:hd,t:'se'},{lx:0,ly:hd,t:'s'},{lx:-hw,ly:hd,t:'sw'},{lx:-hw,ly:0,t:'w'}];
  for(var i=0;i<handles.length;i++){
    if(Math.abs(lx-handles[i].lx)<9&&Math.abs(ly-handles[i].ly)<9) return handles[i].t;
  }
  return (Math.abs(lx)<=hw&&Math.abs(ly)<=hd)?'move':null;
}

// ───── 3D ENGINE ─────
var ren=null,sc3=null,camExt=null,camInt=null,orbit=null;
var isInt=false, iMov={};

function init3D(){
  if(ren) return;
  var wrap=document.getElementById('c3d-wrap');
  ren=new THREE.WebGLRenderer({antialias:true});
  ren.shadowMap.enabled=true; ren.shadowMap.type=THREE.PCFSoftShadowMap;
  ren.setPixelRatio(Math.min(window.devicePixelRatio,2));
  ren.setSize(wrap.clientWidth,wrap.clientHeight);
  ren.setClearColor(0xa8c8e8);
  wrap.appendChild(ren.domElement);
  sc3=new THREE.Scene();
  sc3.fog=new THREE.Fog(0xa8c8e8,60,200);
  sc3.background=new THREE.Color(0xa8c8e8);
  var hemi=new THREE.HemisphereLight(0xd0e8ff,0x407030,0.7);
  sc3.add(hemi);
  var sun=new THREE.DirectionalLight(0xfff8e0,1.1);
  sun.position.set(25,50,20); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  sc3.add(sun);
  var gnd=new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({color:0x4a8a30,roughness:0.9}));
  gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true; sc3.add(gnd);
  camExt=new THREE.PerspectiveCamera(48,wrap.clientWidth/wrap.clientHeight,0.01,500);
  camExt.position.set(14,12,22); camExt.lookAt(4,4,2);
  orbit=new THREE.OrbitControls(camExt,ren.domElement);
  orbit.enableDamping=true; orbit.target.set(4,4,2);
  build3D(); loop3D();
}

function build3D(){
  if(!sc3) return;
  sc3.children.forEach(function(c){if(c.userData.b) sc3.remove(c);});
  DATA.walls.forEach(function(w){buildWall3D(w);});
  buildRooms3D();
  DATA.items.forEach(function(it){buildItem3D(it);});
  buildWinFrames();
  buildRoof3D();
  buildLandscape();
}

function rebuild3D(){if(sc3) build3D();}

function buildWall3D(w){
  var fl=w.floor, fy=(fl-1)*FLOOR_H*U;
  var x1=w.x1*U,z1=w.y1*U,x2=w.x2*U,z2=w.y2*U;
  var dx=x2-x1,dz=z2-z1,len=Math.sqrt(dx*dx+dz*dz);
  var isOuter=w.thick>=130;
  var col=w.color?parseInt(w.color.slice(1),16):0xf0ece4;
  var mat=new THREE.MeshStandardMaterial({color:col,roughness:0.85});
  var geo=new THREE.BoxGeometry(len,WALL_H*U,w.thick*U);
  var mesh=new THREE.Mesh(geo,mat);
  mesh.castShadow=true; mesh.position.set((x1+x2)/2,fy+WALL_H*U/2,(z1+z2)/2);
  mesh.rotation.y=Math.atan2(-dz,dx);
  mesh.userData={b:true};
  sc3.add(mesh);
}

function buildWinFrames(){
  var wdTypes=['window','door-swing','door-slide','door-front'];
  DATA.items.filter(function(it){return wdTypes.indexOf(it.type)>=0;}).forEach(function(it){
    var fl=it.floor, fy=(fl-1)*FLOOR_H*U;
    var walls=DATA.walls.filter(function(w){return w.floor===fl;});
    var best=null,bestD=9999;
    walls.forEach(function(w){
      var d=ptSegDist(it.x+it.w/2,it.y+it.d/2,w.x1,w.y1,w.x2,w.y2);
      if(d<bestD){bestD=d;best=w;}
    });
    if(!best||bestD>400) return;
    var wdx=best.x2-best.x1,wdy=best.y2-best.y1,wlen=Math.sqrt(wdx*wdx+wdy*wdy);
    var t=((it.x+it.w/2-best.x1)*wdx+(it.y+it.d/2-best.y1)*wdy)/(wlen*wlen);
    var px=(best.x1+t*wdx)*U, pz=(best.y1+t*wdy)*U;
    var grp=new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(it.w*U,2,0.1),new THREE.MeshPhongMaterial({color:0x7abcd0,transparent:true,opacity:0.3})));
    grp.position.set(px,fy+1,pz); grp.rotation.y=Math.atan2(wdy,wdx); grp.userData={b:true}; sc3.add(grp);
  });
}

function ptSegDist(px,py,x1,y1,x2,y2){
  var dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;
  if(l2<1) return Math.sqrt((px-x1)*(px-x1)+(py-y1)*(py-y1));
  var t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/l2));
  return Math.sqrt((px-x1-t*dx)*(px-x1-t*dx)+(py-y1-t*dy)*(py-y1-t*dy));
}

var _tex3d = null;
function getSpriteTexture3D() {
  if (!SPRITE_IMG.complete) return null;
  if (!_tex3d) {
    _tex3d = new THREE.CanvasTexture(SPRITE_IMG);
    _tex3d.minFilter = THREE.LinearFilter;
    _tex3d.magFilter = THREE.LinearFilter;
  }
  return _tex3d;
}

function buildItem3D(it){
  var fy=(it.floor-1)*FLOOR_H*U, h=getItemH(it.type)*U;
  var col=getItemCol(it.type);
  if(['window','door-swing','door-slide','door-front'].indexOf(it.type)>=0) return;
  
  var grp = new THREE.Group();
  grp.position.set((it.x+it.w/2)*U, fy, (it.y+it.d/2)*U);
  grp.rotation.y = -it.rot*Math.PI/180;
  
  var matSide = new THREE.MeshStandardMaterial({color:col, roughness: 0.85});
  var box = new THREE.Mesh(new THREE.BoxGeometry(it.w*U,h,it.d*U), matSide);
  box.position.y = h/2;
  box.castShadow=true; box.receiveShadow=true;
  grp.add(box);

  var spriteKey=SPRITE_MAP[it.type];
  if(spriteKey && SPRITE_IMG.complete && SPRITE_JSON && SPRITE_JSON.sprites[spriteKey]){
    var tex = getSpriteTexture3D();
    var s = SPRITE_JSON.sprites[spriteKey];
    if(tex && s){
      var topMat = new THREE.MeshStandardMaterial({map: tex, transparent:true, roughness: 0.6, color:0xffffff});
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(it.w*U, it.d*U), topMat);
      plane.rotation.x = -Math.PI/2;
      plane.position.y = h + 0.02;
      plane.receiveShadow=true;
      
      var maxD = Math.max(it.w, it.d);
      var uw = it.w / maxD, vh = it.d / maxD;
      var u0 = (1 - uw) / 2, v0 = (1 - vh) / 2;
      
      var uvAttr = plane.geometry.attributes.uv;
      for(var i=0; i<uvAttr.count; i++){
        var u = uvAttr.getX(i), v = uvAttr.getY(i);
        var su = u0 + u * uw;
        var sv = v0 + v * vh;
        var sheet_u = (s.x + su * s.w) / SPRITE_IMG.width;
        var sheet_v = 1 - (s.y + s.h) / SPRITE_IMG.height + sv * (s.h / SPRITE_IMG.height);
        uvAttr.setXY(i, sheet_u, sheet_v);
      }
      uvAttr.needsUpdate = true;
      grp.add(plane);
    }
  }

  grp.userData={b:true};
  sc3.add(grp);
}

function getItemH(type){return {kitchen:850,bath:500,toilet:380,sink:800,fridge:1800,sofa:750,desk:720,'dining-table':730,'bed-d':550,'bed-s':550,tv:1100,closet:2100,stair:20,balcony:50}[type]||400;}
function getItemCol(type){return {kitchen:0xc8c0a0,bath:0xe8f4ff,toilet:0xf0f0f0,sink:0xe8f0ff,fridge:0xd0e8d0,sofa:0xc8a870,'dining-table':0xd4a84a,'bed-d':0xe8d8c0,desk:0x9a8060,tv:0x181818}[type]||0xdddddd;}

function buildRooms3D(){
  var matFloor=new THREE.MeshStandardMaterial({color:0xe0dcd4});
  DATA.rooms.forEach(function(r){
    var y=(r.floor-1)*FLOOR_H*U;
    var slab=new THREE.Mesh(new THREE.BoxGeometry(r.w*U,0.22,r.d*U),matFloor);
    slab.position.set((r.x+r.w/2)*U,y,(r.y+r.d/2)*U); slab.userData={b:true}; sc3.add(slab);
  });
}

function buildRoof3D(){}
function buildLandscape(){}
function loop3D(){requestAnimationFrame(loop3D); if(ST.view==='3d-ext'){orbit.update();ren.render(sc3,camExt);}}

// ───── HISTORY ─────
function saveState(){
  HISTORY.push(JSON.stringify(DATA));
}
function undoAction(){
  if(!HISTORY.length) return;
  var s=HISTORY.pop();
  DATA=JSON.parse(s);
  var l=new THREE.TextureLoader();
  DATA.walls.forEach(function(w){if(w.texture) w._texObj=l.load(w.texture);});
  draw2d(); rebuild3D();
}

// ───── VIEW SWITCHING ─────
function setView(v){
  ST.view=v;
  document.getElementById('c2d').style.display=(v==='2d'?'block':'none');
  document.getElementById('c3d-wrap').style.display=(v==='2d'?'none':'block');
  if(v!=='2d') init3D();
  draw2d();
}

// ───── TOOLS ─────
function setTool(t){
  ST.tool=t;ST.drawing=false;ST.drawPts=[];ST.selected=null;
  var tools=document.querySelectorAll('.stool[data-tool]');
  for(var i=0;i<tools.length;i++){
    if(tools[i].getAttribute('data-tool')===t) tools[i].classList.add('active');
    else tools[i].classList.remove('active');
  }
  var tName = t;
  var actEl = document.querySelector('.stool[data-tool="'+t+'"]');
  if(actEl) tName = actEl.textContent.replace(/^./, '');
  document.getElementById('st-tool').textContent='ツール: '+tName;
  draw2d();
}
function toggleGrid(){ST.showGrid=!ST.showGrid;draw2d();}
function toggleDim(){ST.showDim=!ST.showDim;draw2d();}
function resetView(){ST.zoom=0.2;ST.panX=60;ST.panY=60;draw2d();}
function onFloorChange(v){ST.floor=+v;draw2d();}

// ───── CANVAS EVENTS ─────
canvas.onmousedown=function(e){
  var r=canvas.getBoundingClientRect(); var cx=e.clientX-r.left, cy=e.clientY-r.top;
  if(e.button===1 || (e.button===0 && e.altKey)){
    ST.panning = true;
    ST.lastPanCX = cx;
    ST.lastPanCY = cy;
    e.preventDefault();
    return;
  }
  if(e.button===2){ST.drawing=false;ST.drawPts=[];DRAG.active=false;draw2d();return;}
  if(e.button!==0) return;
  var w=c2w(cx,cy);
  var wx=snapV(w.x), wy=snapV(w.y);
  var tool=ST.tool;
  if(tool==='select') handleSelectDown(cx,cy,w.x,w.y,e);
  else if(tool==='erase') handleErase(w.x,w.y);
  else if(tool==='wall') handleWallClick(wx,wy);
  else if(tool==='room-rect') handleRoomClick(wx,wy);
  else placeItem(tool,wx,wy);
};

function handleSelectDown(cx,cy,wx,wy,e){
  if(ST.selected&&ST.selected.thick===undefined){
    var h=hitHandle(ST.selected,cx,cy);
    if(h){
      DRAG.active=true;DRAG.saved=false; DRAG.handle=h;
      DRAG.startCX=cx; DRAG.startCY=cy;
      DRAG.origItem=JSON.parse(JSON.stringify(ST.selected));
      return;
    }
  }
  var fi=DATA.items.filter(function(i){return i.floor===ST.floor;});
  for(var i=fi.length-1;i>=0;i--){
    if(isInsideItem(fi[i],wx,wy)){
      ST.selected=fi[i];
      DRAG.active=true;DRAG.saved=false; DRAG.handle='move';
      DRAG.startCX=cx; DRAG.startCY=cy;
      DRAG.origItem=JSON.parse(JSON.stringify(fi[i]));
      draw2d();return;
    }
  }
}

canvas.addEventListener('mousemove',function(e){
  var r=canvas.getBoundingClientRect(); var cx=e.clientX-r.left, cy=e.clientY-r.top;
  if(ST.panning) {
    ST.panX += (cx - ST.lastPanCX);
    ST.panY += (cy - ST.lastPanCY);
    ST.lastPanCX = cx;
    ST.lastPanCY = cy;
    draw2d();
    return;
  }
  var wc=c2w(cx,cy);
  document.getElementById('coords').textContent='X:'+Math.round(snapV(wc.x))+'mm Y:'+Math.round(snapV(wc.y))+'mm';
  if(DRAG.active&&e.buttons===1){ applyHandleDrag(cx,cy,e); draw2d(); }
});
canvas.addEventListener('mouseup',function(){
  if(ST.panning) { ST.panning = false; return; }
  DRAG.active=false;if(ren)build3D();
});
canvas.addEventListener('wheel', function(e){
  e.preventDefault();
  if(e.ctrlKey) {
    var zoomDelta = -e.deltaY * 0.01;
    var oldZoom = ST.zoom;
    ST.zoom = Math.min(Math.max(0.02, ST.zoom + zoomDelta), 5.0);
    var r=canvas.getBoundingClientRect(); var cx=e.clientX-r.left, cy=e.clientY-r.top;
    ST.panX = cx - (cx - ST.panX) * (ST.zoom / oldZoom);
    ST.panY = cy - (cy - ST.panY) * (ST.zoom / oldZoom);
  } else {
    ST.panX -= e.deltaX;
    ST.panY -= e.deltaY;
  }
  draw2d();
}, {passive: false});

function handleWallClick(wx,wy){
  if(!ST.drawing){ST.drawing=true;ST.drawPts=[{x:wx,y:wy}];}
  else{
    var st=ST.drawPts[0];
    var w=mkWall(st.x,st.y,wx,wy,ST.floor,120);
    saveState(); DATA.walls.push(w);
    ST.drawPts=[{x:wx,y:wy}];
    if(ren)build3D();draw2d();
  }
}
function handleRoomClick(wx,wy){
  if(!ST.drawing){ST.drawing=true;ST.drawPts=[{x:wx,y:wy}];}
  else{
    var st=ST.drawPts[0];
    var x1=Math.min(st.x,wx),y1=Math.min(st.y,wy),x2=Math.max(st.x,wx),y2=Math.max(st.y,wy);
    var rw=x2-x1, rd=y2-y1;
    if(rw>100 && rd>100){
      saveState();
      var r={id:'rm_'+Date.now(), type:'room', x:x1, y:y1, w:rw, d:rd, floor:ST.floor};
      DATA.rooms.push(r);
    }
    ST.drawing=false;ST.drawPts=[];if(ren)build3D();draw2d();
  }
}
function placeItem(type,wx,wy){
  saveState();
  var sz=ISIZES[type]||{w:900,d:900};
  var it=mkItem(type,wx-sz.w/2,wy-sz.d/2,ST.placingRot,ST.floor);
  DATA.items.push(it);ST.placingRot=0;
  if(ren)build3D();draw2d();
}
function handleErase(wx,wy){
  var fw=DATA.walls.filter(function(w){return w.floor===ST.floor;});
  for(var i=fw.length-1;i>=0;i--){
    if(nearWall(wx,wy,fw[i])){saveState();DATA.walls=DATA.walls.filter(function(w){return w!==fw[i];});draw2d();if(ren)build3D();return;}
  }
  var fi=DATA.items.filter(function(it){return it.floor===ST.floor;});
  for(var i=fi.length-1;i>=0;i--){
    if(isInsideItem(fi[i],wx,wy)){saveState();DATA.items=DATA.items.filter(function(x){return x!==fi[i];});draw2d();if(ren)build3D();return;}
  }
  var fr=DATA.rooms.filter(function(r){return r.floor===ST.floor;});
  for(var i=fr.length-1;i>=0;i--){
    if(isInsideItem(fr[i],wx,wy)){saveState();DATA.rooms=DATA.rooms.filter(function(x){return x!==fr[i];});draw2d();if(ren)build3D();return;}
  }
}
function isInsideItem(it, px, py){
  var cx = it.x + it.w/2, cy = it.y + it.d/2;
  var rad = -(it.rot||0)*Math.PI/180;
  if(it.type === 'room') rad = 0; // Rooms are not rotated
  var dx = px - cx, dy = py - cy;
  var lx = dx*Math.cos(rad) - dy*Math.sin(rad);
  var ly = dx*Math.sin(rad) + dy*Math.cos(rad);
  return lx >= -it.w/2 && lx <= it.w/2 && ly >= -it.d/2 && ly <= it.d/2;
}

function nearWall(px,py,w){
  var dx=w.x2-w.x1,dy=w.y2-w.y1,len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return false;
  var t=((px-w.x1)*dx+(py-w.y1)*dy)/(len*len);
  if(t<0||t>1) return false;
  var dist=Math.sqrt((px-w.x1-t*dx)*(px-w.x1-t*dx)+(py-w.y1-t*dy)*(py-w.y1-t*dy));
  return dist<Math.max(w.thick*0.7,18/ST.zoom);
}

function drawPreview(){
  var last=ST.drawPts[ST.drawPts.length-1];
  var mx=snapV(ST.mouseW.x),my=snapV(ST.mouseW.y);
  var a=w2c(last.x,last.y),b=w2c(mx,my);
  ctx.setLineDash([5,4]);ctx.strokeStyle='#e94560';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(a.cx,a.cy);ctx.lineTo(b.cx,b.cy);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#e94560';ctx.beginPath();ctx.arc(b.cx,b.cy,5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#3080e8';ctx.beginPath();ctx.arc(a.cx,a.cy,4,0,Math.PI*2);ctx.fill();
  var dx=mx-last.x,dy=my-last.y,len=Math.round(Math.sqrt(dx*dx+dy*dy));
  if(len>20){ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillStyle='#333';ctx.fillText(len+'mm',(a.cx+b.cx)/2,(a.cy+b.cy)/2-10);}
}
function drawDim(){
  if(!ST.showDim||ST.zoom<0.35) return;
  var fp=FOOTPRINTS[ST.floor],a=w2c(0,0),b=w2c(fp.w,0),c=w2c(0,fp.h);
  var off=16;
  ctx.strokeStyle='rgba(50,80,200,0.45)';ctx.fillStyle='rgba(50,80,200,0.65)';
  ctx.lineWidth=1;ctx.setLineDash([4,3]);
  var fsz=Math.max(9,ST.zoom*5);ctx.font=fsz+'px sans-serif';ctx.textAlign='center';
  ctx.beginPath();ctx.moveTo(a.cx,a.cy-off);ctx.lineTo(b.cx,a.cy-off);ctx.stroke();
  ctx.fillText(fp.w+'mm',(a.cx+b.cx)/2,a.cy-off-5);
  ctx.beginPath();ctx.moveTo(a.cx-off,a.cy);ctx.lineTo(a.cx-off,c.cy);ctx.stroke();
  ctx.save();ctx.translate(a.cx-off-5,(a.cy+c.cy)/2);ctx.rotate(-Math.PI/2);ctx.fillText(fp.h+'mm',0,0);ctx.restore();
  ctx.setLineDash([]);
}

// ───── PROPERTIES PANEL ─────
function showWallProps(w){
  document.getElementById('props').classList.add('show');
  document.getElementById('props-title').textContent='壁のプロパティ';
  var len=Math.round(Math.sqrt((w.x2-w.x1)*(w.x2-w.x1)+(w.y2-w.y1)*(w.y2-w.y1)));
  document.getElementById('props-body').innerHTML=
    '<div class="pr"><div class="pl">壁の色</div><input class="pi" type="color" value="'+(w.color||'#888888')+'" oninput="updWC(\''+w.id+'\',this.value)"></div>'+
    '<div class="pr"><div class="pl">テクスチャ</div><input class="pi" type="file" accept="image/*" onchange="upWT(\''+w.id+'\',this)"></div>'+
    '<div class="pr"><div class="pl">テクスチャサイズ(m): <span id="tv">'+( w.texScale||1)+'</span></div><input class="pi" type="range" min="0.1" max="5" step="0.1" value="'+(w.texScale||1)+'" oninput="updWTS(\''+w.id+'\',+this.value)"></div>'+
    '<div class="pr"><div class="pl">壁厚(mm)</div><input class="pi" type="number" value="'+w.thick+'" min="60" max="400" step="10" onchange="updWTh(\''+w.id+'\',+this.value)"></div>'+
    '<div class="pr"><div class="pl">長さ</div><div style="font-size:11px;color:#aab">'+len+'mm</div></div>'+
    '<button class="pbtn sec" onclick="clrWT(\''+w.id+'\')">テクスチャ消去</button>'+
    '<button class="pbtn sec" style="margin-top:4px" onclick="delSel()">🗑 削除</button>';
}
function showItemProps(it){
  document.getElementById('props').classList.add('show');
  document.getElementById('props-title').textContent=(ILABELS[it.type]||it.type);
  document.getElementById('props-body').innerHTML=
    '<div class="pr"><div class="pl">色</div><input class="pi" type="color" value="'+(it.color||'#dddddd')+'" oninput="updIC(\''+it.id+'\',this.value)"></div>'+
    '<div class="pr"><div class="pl">回転(°)</div><input class="pi" type="number" value="'+Math.round(it.rot)+'" step="15" onchange="updIR(\''+it.id+'\',+this.value)"></div>'+
    '<div class="pr"><div class="pl">X位置(mm)</div><input class="pi" type="number" value="'+Math.round(it.x)+'" onchange="updIX(\''+it.id+'\',+this.value)"></div>'+
    '<div class="pr"><div class="pl">Y位置(mm)</div><input class="pi" type="number" value="'+Math.round(it.y)+'" onchange="updIY(\''+it.id+'\',+this.value)"></div>'+
    '<div class="pr"><div class="pl">幅(mm)</div><input class="pi" type="number" value="'+Math.round(it.w)+'" onchange="updIW(\''+it.id+'\',+this.value)"></div>'+
    '<div class="pr"><div class="pl">奥行(mm)</div><input class="pi" type="number" value="'+Math.round(it.d)+'" onchange="updID(\''+it.id+'\',+this.value)"></div>'+
    '<button class="pbtn sec" style="margin-top:4px" onclick="delSel()">🗑 削除</button>';
}
function fW(id){return DATA.walls.find(function(w){return w.id==id;});}
function fI(id){return DATA.items.find(function(i){return i.id==id;});}
function updWC(id,v){var w=fW(id);if(w){w.color=v;draw2d();rebuild3D();}}
function updWTS(id,v){var w=fW(id);if(w){w.texScale=v;var el=document.getElementById('tv');if(el)el.textContent=v.toFixed(1);rebuild3D();}}
function updWTh(id,v){var w=fW(id);if(w){w.thick=v;draw2d();rebuild3D();}}
function upWT(id,inp){var w=fW(id);if(!w||!inp.files[0])return;var r=new FileReader();r.onload=function(e){var l=new THREE.TextureLoader();w._texObj=l.load(e.target.result);w.texture=e.target.result;rebuild3D();};r.readAsDataURL(inp.files[0]);}
function clrWT(id){var w=fW(id);if(w){w.texture=null;w._texObj=null;rebuild3D();}}
function updIC(id,v){saveState();var i=fI(id);if(i){i.color=v;draw2d();rebuild3D();}}
function updIR(id,v){saveState();var i=fI(id);if(i){i.rot=v;draw2d();rebuild3D();}}
function updIX(id,v){saveState();var i=fI(id);if(i){i.x=v;draw2d();rebuild3D();}}
function updIY(id,v){saveState();var i=fI(id);if(i){i.y=v;draw2d();rebuild3D();}}
function updIW(id,v){saveState();var i=fI(id);if(i){i.w=v;draw2d();rebuild3D();}}
function updID(id,v){saveState();var i=fI(id);if(i){i.d=v;draw2d();rebuild3D();}}
function delSel(){
  if(!ST.selected)return;
  saveState();
  if(ST.selected.thick!==undefined)DATA.walls=DATA.walls.filter(function(w){return w!==ST.selected;});
  else if(ST.selected.type==='room')DATA.rooms=DATA.rooms.filter(function(r){return r!==ST.selected;});
  else DATA.items=DATA.items.filter(function(i){return i!==ST.selected;});
  ST.selected=null;DRAG.active=false;document.getElementById('props').classList.remove('show');
  draw2d();rebuild3D();
}

// ───── HISTORY ─────
function undoAction(){
  if(!HISTORY.length) return;
  var s = HISTORY.pop();
  DATA = JSON.parse(s);
  var l=new THREE.TextureLoader();
  DATA.walls.forEach(function(w){if(w.texture) w._texObj=l.load(w.texture);});
  ST.selected=null;DRAG.active=false;document.getElementById('props').classList.remove('show');
  draw2d();if(ren)rebuild3D();
}
function clearFloor(){
  if(!confirm(ST.floor+'Fの全要素を削除しますか？'))return;
  saveState();
  DATA.walls=DATA.walls.filter(function(w){return w.floor!==ST.floor;});
  DATA.items=DATA.items.filter(function(i){return i.floor!==ST.floor;});
  DATA.rooms=DATA.rooms.filter(function(r){return r.floor!==ST.floor;});
  ST.selected=null;document.getElementById('props').classList.remove('show');
  draw2d();rebuild3D();
}

// ───── EXPORT/IMPORT ─────
function exportPlan(){
  var json=JSON.stringify({
    walls:DATA.walls.map(function(w){return{id:w.id,x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2,floor:w.floor,thick:w.thick,color:w.color,texScale:w.texScale};}),
    items:DATA.items.map(function(i){return{id:i.id,type:i.type,x:i.x,y:i.y,rot:i.rot,floor:i.floor,w:i.w,d:i.d,color:i.color};})
  },null,2);
  var a=document.createElement('a');
  a.href='data:application/json;charset=utf-8,'+encodeURIComponent(json);
  a.download='madori.json';a.click();
}
function doImport(inp){
  var file=inp.files[0];if(!file)return;
  var r=new FileReader();
  r.onload=function(e){
    try{
      var obj=JSON.parse(e.target.result);
      DATA.walls=(obj.walls||[]).map(function(w){return mkWall(w.x1,w.y1,w.x2,w.y2,w.floor,w.thick,w.color);});
      DATA.items=(obj.items||[]).map(function(i){return mkItem(i.type,i.x,i.y,i.rot,i.floor,i.w,i.d);});
      draw2d();rebuild3D();
    }catch(ex){alert('読み込みエラー:'+ex.message);}
  };
  r.readAsText(file);
}

// ───── RESIZE ─────
window.addEventListener('keydown', function(e){
  if(e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z'){
    e.preventDefault();
    undoAction();
  }
  if(e.key === 'Backspace' || e.key === 'Delete'){
    if(ST.selected){
      e.preventDefault();
      delSel();
    }
  }
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a'){
    e.preventDefault();
    // Pseudo Select-All: selects the first room, wall or item to start with.
    // True multi-select requires structural changes.
    var fItems = DATA.items.filter(function(i){return i.floor===ST.floor;});
    if(fItems.length>0) { ST.selected = fItems[0]; DRAG.active=false; draw2d(); return; }
    var fRooms = DATA.rooms.filter(function(r){return r.floor===ST.floor;});
    if(fRooms.length>0) { ST.selected = fRooms[0]; DRAG.active=false; draw2d(); return; }
    var fWalls = DATA.walls.filter(function(w){return w.floor===ST.floor;});
    if(fWalls.length>0) { ST.selected = fWalls[0]; DRAG.active=false; draw2d(); return; }
  }
});
window.addEventListener('resize',function(){
  resize2d();
  if(ren){var wrap=document.getElementById('c3d-wrap');ren.setSize(wrap.clientWidth,wrap.clientHeight);
    [camExt,camInt].forEach(function(c){c.aspect=wrap.clientWidth/wrap.clientHeight;c.updateProjectionMatrix();});}
});

// ───── INIT ─────
loadPreset();
resize2d();
resetView();
document.getElementById('st-floor').textContent='フロア:1F';
document.getElementById('st-mode').textContent='モード:平面図';
