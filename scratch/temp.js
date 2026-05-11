
// ───── CONSTANTS ─────
var WALL_H = 2400;
var FLOOR_H = 2700;
var U = 0.001;
var ROOF = {type:'gable', pitch:30, color:'#2a2a30'};
var WALL_COLORS = {upper:'#e8e0cc', lower:'#5c3820'};

var ISIZES = {
  bath:{w:1600,d:1600}, toilet:{w:450,d:750}, sink:{w:750,d:500},
  kitchen:{w:2550,d:650}, fridge:{w:650,d:650}, washer:{w:640,d:640},
  sofa:{w:1900,d:850}, loveseat_2p:{w:1400,d:850}, low_table:{w:1200,d:600},
  'dining-table':{w:1400,d:800}, dining_6:{w:1800,d:900}, round_table_4:{w:1100,d:1100},
  'bed-d':{w:1400,d:2000}, 'bed-s':{w:1000,d:2000}, semi_double_bed:{w:1200,d:2000},
  futon_set:{w:1000,d:2100}, desk:{w:1200,d:600}, tv:{w:1500,d:450},
  closet:{w:1820,d:600}, shoe_cabinet:{w:1200,d:400}, stair:{w:910,d:1820},
  balcony:{w:1820,d:910}, tree:{w:1500,d:1500},
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
  kitchen:'キッチン',bath:'バス',toilet:'トイレ',sink:'洗面',fridge:'冷蔵庫',washer:'洗濯機',
  sofa:'3Pソファ',loveseat_2p:'2Pソファ',low_table:'ローテーブル',
  'dining-table':'食卓(4)','dining_6':'食卓(6)','round_table_4':'円卓',
  'bed-d':'ベッド(D)','bed-s':'ベッド(S)','semi_double_bed':'ベッド(SD)',futon_set:'布団',
  desk:'デスク',tv:'TV',closet:'収納',shoe_cabinet:'下駄箱',stair:'階段',balcony:'バルコニー',
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
var SPRITE_IMG1 = new Image(), SPRITE_IMG2 = new Image();
var SPRITE_JSON = {
  cell: 512,
  sprites: {
    // Sheet 1
    toilet: {x: 0, y: 0, img:1}, bed: {x: 512, y: 0, img:1}, sink: {x: 1024, y: 0, img:1},
    tv: {x: 1536, y: 0, img:1}, bathtub: {x: 2048, y: 0, img:1}, car: {x: 0, y: 512, img:1},
    sofa: {x: 512, y: 512, img:1}, kitchen: {x: 1024, y: 512, img:1}, fridge: {x: 1536, y: 512, img:1},
    dining: {x: 2048, y: 512, img:1}, wood_floor: {x: 0, y: 1024, img:1}, stone: {x: 512, y: 1024, img:1},
    tree: {x: 1024, y: 1024, img:1}, tile_floor: {x: 1536, y: 1024, img:1}, grass: {x: 2048, y: 1024, img:1},
    // Sheet 2
    loveseat_2p: {x:0, y:0, img:2}, low_table: {x:512, y:0, img:2}, armchair_1p: {x:1024, y:0, img:2},
    dining_6: {x:1536, y:0, img:2}, round_table_4: {x:2048, y:0, img:2}, desk: {x:0, y:512, img:2},
    closet_pole: {x:512, y:512, img:2}, double_bed_alt: {x:1024, y:512, img:2}, semi_double_bed: {x:1536, y:512, img:2},
    shoe_cabinet: {x:2048, y:512, img:2}, washer: {x:0, y:1024, img:2}, desk_chair: {x:512, y:1024, img:2},
    chest_drawers: {x:1024, y:1024, img:2}, futon_set: {x:1536, y:1024, img:2}, storage_boxes: {x:2048, y:1024, img:2}
  }
};
var SPRITE_MAP = {
  toilet:'toilet', 'bed-d':'bed', 'bed-s':'bed', sink:'sink', tv:'tv', bath:'bathtub',
  sofa:'sofa', kitchen:'kitchen', fridge:'fridge', 'dining-table':'dining', tree:'tree',
  loveseat_2p:'loveseat_2p', low_table:'low_table', dining_6:'dining_6', round_table_4:'round_table_4',
  desk:'desk', semi_double_bed:'semi_double_bed', futon_set:'futon_set', shoe_cabinet:'shoe_cabinet', washer:'washer'
};
var PATTERNS = {};
var loadedCount = 0;
function onSheetLoad() {
  loadedCount++;
  if(loadedCount < 2) return;
  function extPat(key) {
    var s = SPRITE_JSON.sprites[key]; if(!s) return;
    var img = s.img === 1 ? SPRITE_IMG1 : SPRITE_IMG2;
    var c = document.createElement('canvas'); c.width=512; c.height=512;
    c.getContext('2d').drawImage(img, s.x, s.y, 512, 512, 0, 0, 512, 512);
    PATTERNS[key] = c;
  }
  extPat('wood_floor'); extPat('grass'); extPat('stone'); extPat('tile_floor');
  draw2d();
}
SPRITE_IMG1.crossOrigin = "anonymous";
SPRITE_IMG2.crossOrigin = "anonymous";
SPRITE_IMG1.onload = onSheetLoad;
SPRITE_IMG2.onload = onSheetLoad;
SPRITE_IMG1.src = 'assets/japanese_floorplan_parts_sprite_gpt.png';
SPRITE_IMG2.src = 'assets/japanese_floorplan_parts_sprite_gpt_2.png';


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
  drawSite();
  if(ST.showGrid) drawGrid();
  drawFootprint();

  var sc=ST.zoom*0.05;
  DATA.rooms.filter(function(r){return r.floor===ST.floor;}).forEach(function(r){
    var px=ST.panX+r.x*sc, py=ST.panY+r.y*sc, w=r.w*sc, d=r.d*sc;
    var sel=ST.selected===r || (ST.selectAll && r.floor===ST.floor);
    ctx.save();
    ctx.shadowBlur=12; ctx.shadowColor='rgba(0,0,0,0.06)';
    ctx.fillStyle='rgba(252,251,248,0.95)';
    ctx.fillRect(px,py,w,d);
    ctx.restore();
    ctx.strokeStyle=sel?'#e94560':'rgba(0,0,0,0.1)';
    ctx.lineWidth=sel?3.5:1.2;
    ctx.strokeRect(px,py,w,d);
  });

  var fw=DATA.walls.filter(function(w){return w.floor===ST.floor;});
  var fi=DATA.items.filter(function(i){return i.floor===ST.floor;});
  fw.forEach(drawWall2d);
  fi.forEach(drawItem2d);
  
  if(!ST.drawing && ISIZES[ST.tool] && ST.view === '2d') {
    var mx = snapV(ST.mouseW.x), my = snapV(ST.mouseW.y);
    var sz = ISIZES[ST.tool];
    var ghost = {type:ST.tool, x:mx - sz.w/2, y:my - sz.d/2, w:sz.w, d:sz.d, rot:ST.placingRot||0, floor:ST.floor};
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawItem2d(ghost);
    ctx.restore();
  }

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

function drawSite(){
  var site=DATA.site||{x:-5000,y:-5000,w:25000,h:20000};
  var a=w2c(site.x,site.y),b=w2c(site.x+site.w,site.y+site.h);
  var sw=b.cx-a.cx,sh=b.cy-a.cy;
  if(PATTERNS.grass){
    ctx.save();
    ctx.fillStyle='rgba(160,190,140,0.3)';
    ctx.fillRect(a.cx,a.cy,sw,sh);
    ctx.globalAlpha=0.35;
    var pat=ctx.createPattern(PATTERNS.grass,'repeat');
    if(pat.setTransform){
      var m=new DOMMatrix();
      m.translateSelf(ST.panX,ST.panY);
      var patSc = ST.zoom*0.05 * 1.5; // Larger scale to avoid repetitive grid
      m.scaleSelf(patSc, patSc);
      pat.setTransform(m);
    }
    ctx.fillStyle=pat;
    ctx.fillRect(a.cx,a.cy,sw,sh);
    ctx.restore();
  } else {
    ctx.fillStyle='rgba(210,230,190,0.4)';
    ctx.fillRect(a.cx,a.cy,sw,sh);
  }
  ctx.strokeStyle='rgba(0,0,0,0.2)';ctx.lineWidth=1;ctx.setLineDash([8,4]);
  ctx.strokeRect(a.cx,a.cy,sw,sh);ctx.setLineDash([]);
}

function drawFootprint(){
  var fp=FOOTPRINTS[ST.floor],a=w2c(0,0),b=w2c(fp.w,fp.h);
  var fw=b.cx-a.cx,fh=b.cy-a.cy;
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
  ctx.fillStyle='rgba(250,248,240,0.55)';
  ctx.fillRect(a.cx,a.cy,fw,fh);
  ctx.restore();
}

function drawRoomLbls(){
  var fr=DATA.rooms.filter(function(r){return r.floor===ST.floor;});
  fr.forEach(function(l){
    var p=w2c(l.x+l.w/2,l.y+l.d/2);
    var nameFull=l.n||'部屋';
    var parts=nameFull.split(' ');
    var name=parts[0], area=parts[1]||'';
    var szN=Math.max(10,ST.zoom*0.8), szA=Math.max(8,ST.zoom*0.5);
    ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
    var tw=Math.max(ctx.measureText(name).width,ctx.measureText(area).width)+18;
    var th=area?szN+szA+14:szN+12;
    ctx.save();
    ctx.translate(p.cx,p.cy);
    if(ST.selected===l) {
      ctx.shadowBlur=10; ctx.shadowColor='rgba(0,120,255,0.5)';
      ctx.strokeStyle='#0078ff'; ctx.lineWidth=2;
    }
    ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.roundRect(-tw/2,-th/2,tw,th,6); ctx.fill();
    if(ST.selected===l) ctx.stroke();
    ctx.restore();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#222';
    ctx.fillText(name,p.cx,area?p.cy-szA/2-2:p.cy);
    if(area){
      ctx.font='bold '+szA+'px "Noto Sans JP",sans-serif';
      ctx.fillStyle='#555';
      ctx.fillText(area,p.cx,p.cy+szN/2+3);
    }
  });
}

function drawWall2d(w){
  var a=w2c(w.x1,w.y1),b=w2c(w.x2,w.y2);
  var dx=b.cx-a.cx,dy=b.cy-a.cy,len=Math.sqrt(dx*dx+dy*dy);
  if(len<1) return;
  var nx=-dy/len,ny=dx/len,t=w.thick*ST.zoom*0.05/2;
  var isOuter=w.thick>=130, sel=ST.selected===w;
  ctx.save();
  if(!sel) {
    ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowOffsetX = 1.5; ctx.shadowOffsetY = 1.5;
  }
  ctx.beginPath();
  ctx.moveTo(a.cx+nx*t,a.cy+ny*t); ctx.lineTo(b.cx+nx*t,b.cy+ny*t);
  ctx.lineTo(b.cx-nx*t,b.cy-ny*t); ctx.lineTo(a.cx-nx*t,a.cy-ny*t);
  ctx.closePath();
  if(sel||(ST.selectAll && w.floor===ST.floor)){
    ctx.fillStyle='rgba(233,69,96,0.95)'; ctx.fill();
    ctx.strokeStyle='#e94560'; ctx.lineWidth=2.5; ctx.stroke();
  } else if(w.color&&w.color!=='#888'){
    ctx.fillStyle=w.color; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=1; ctx.stroke();
  } else if(isOuter){
    ctx.fillStyle='#3a3a40'; ctx.fill();
    ctx.strokeStyle='#111'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=0.5;
    ctx.beginPath(); ctx.moveTo(a.cx+nx*t*0.6, a.cy+ny*t*0.6); ctx.lineTo(b.cx+nx*t*0.6, b.cy+ny*t*0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.cx-nx*t*0.6, a.cy-ny*t*0.6); ctx.lineTo(b.cx-nx*t*0.6, b.cy-ny*t*0.6); ctx.stroke();
  } else {
    ctx.fillStyle='#909098'; ctx.fill();
    ctx.strokeStyle='#666'; ctx.lineWidth=1; ctx.stroke();
  }
  ctx.restore();
}

function drawItem2d(it){
  var sc=ST.zoom*0.05;
  var ccx=ST.panX+(it.x+it.w/2)*sc, ccy=ST.panY+(it.y+it.d/2)*sc; 
  ctx.save();
  ctx.translate(ccx,ccy); ctx.rotate(it.rot*Math.PI/180);
  var spriteKey=SPRITE_MAP[it.type];
  var s = spriteKey ? SPRITE_JSON.sprites[spriteKey] : null;
  if(s){
    var img = s.img === 1 ? SPRITE_IMG1 : SPRITE_IMG2;
    if (img.complete) {
      ctx.drawImage(img, s.x, s.y, 512, 512, -it.w/2*sc, -it.d/2*sc, it.w*sc, it.d*sc);
    }
  } else {
    ctx.fillStyle=ICOLORS[it.type]||'#dddddd'; ctx.fillRect(-it.w/2*sc,-it.d/2*sc,it.w*sc,it.d*sc);
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(-it.w/2*sc,-it.d/2*sc,it.w*sc,it.d*sc);
  }
  ctx.restore();
  if(ST.selected===it&&ST.tool==='select') drawHandles(it,ccx,ccy,it.w*sc/2,it.d*sc/2,sc);
}

function drawHandles(o,ccx,ccy,hw,hd,sc){
  ctx.save();
  ctx.translate(ccx,ccy); ctx.rotate(o.rot*Math.PI/180);
  ctx.strokeStyle='#3080e8'; ctx.lineWidth=1.5; ctx.setLineDash([4,2]);
  ctx.strokeRect(-hw,-hd,hw*2,hd*2); ctx.setLineDash([]);
  var pts=[[-hw,-hd],[0,-hd],[hw,-hd],[hw,0],[hw,hd],[0,hd],[-hw,hd],[-hw,0]];
  pts.forEach(function(p){
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(p[0],p[1],5,0,Math.PI*2); ctx.fill(); ctx.stroke();
  });
  ctx.beginPath(); ctx.moveTo(0,-hd); ctx.lineTo(0,-hd-30); ctx.stroke();
  ctx.fillStyle='#3080e8'; ctx.beginPath(); ctx.arc(0,-hd-30,7,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
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
    var ocx = o.x + o.w/2, ocy = o.y + o.d/2;
    var oAng=Math.atan2(cy-ST.panY-(ocy*ST.zoom*0.05),cx-ST.panX-(ocx*ST.zoom*0.05));
    var sAng=Math.atan2(DRAG.startCY-ST.panY-(ocy*ST.zoom*0.05),DRAG.startCX-ST.panX-(ocx*ST.zoom*0.05));
    var nRot=o.rot+(oAng-sAng)*180/Math.PI;
    if(e.shiftKey) nRot=Math.round(nRot/15)*15;
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
  var handles=[
    {lx:-hw,ly:-hd,t:'nw'},{lx:0,ly:-hd,t:'n'},{lx:hw,ly:-hd,t:'ne'},
    {lx:hw,ly:0,t:'e'},{lx:hw,ly:hd,t:'se'},{lx:0,ly:hd,t:'s'},
    {lx:-hw,ly:hd,t:'sw'},{lx:-hw,ly:0,t:'w'},
    {lx:0,ly:-hd-30,t:'rot'}
  ];
  for(var i=0;i<handles.length;i++){
    if(Math.abs(lx-handles[i].lx)<10&&Math.abs(ly-handles[i].ly)<10) return handles[i].t;
  }
  return (Math.abs(lx)<=hw&&Math.abs(ly)<=hd)?'move':null;
}

// ───── 3D ENGINE ─────
var ren=null,sc3=null,camExt=null,camInt=null,orbit=null;
var isInt=false, iMov={};

var _texCache = {};
function getTexture3D(key) {
  if (_texCache[key]) return _texCache[key];
  if (!PATTERNS[key]) return null;
  var tex = new THREE.CanvasTexture(PATTERNS[key]);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.15, 0.15);
  if(ren) tex.anisotropy = ren.capabilities.getMaxAnisotropy();
  _texCache[key] = tex;
  return tex;
}

function init3D(){
  if(ren) return;
  var wrap=document.getElementById('c3d-wrap');
  ren=new THREE.WebGLRenderer({antialias:true, logarithmicDepthBuffer: true});
  ren.shadowMap.enabled=true; ren.shadowMap.type=THREE.PCFSoftShadowMap;
  ren.outputColorSpace = THREE.SRGBColorSpace;
  ren.setPixelRatio(Math.min(window.devicePixelRatio,2));
  ren.setSize(wrap.clientWidth,wrap.clientHeight);
  ren.setClearColor(0xd0e8ff);
  wrap.appendChild(ren.domElement);
  sc3=new THREE.Scene();
  sc3.fog=new THREE.Fog(0xd0e8ff,100,500);
  sc3.background=new THREE.Color(0xd0e8ff);

  var hemi=new THREE.HemisphereLight(0xffffff,0x444444,0.6);
  sc3.add(hemi);

  var sun=new THREE.DirectionalLight(0xffffff,1.2);
  sun.position.set(50,100,50); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=-100; sun.shadow.camera.right=100;
  sun.shadow.camera.top=100; sun.shadow.camera.bottom=-100;
  sun.shadow.bias = -0.0005; 
  sc3.add(sun);
  
  var amb = new THREE.AmbientLight(0xffffff, 0.4);
  sc3.add(amb);

  var grassTex = getTexture3D('grass');
  if(grassTex) { grassTex.repeat.set(50, 50); }
  var gnd=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000), new THREE.MeshStandardMaterial({
    color:0xffffff, map: grassTex, roughness:1.0
  }));
  gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true; sc3.add(gnd);

  camExt=new THREE.PerspectiveCamera(45,wrap.clientWidth/wrap.clientHeight,0.1,2000);
  camExt.position.set(35,25,50); camExt.lookAt(8,0,8);
  camInt=new THREE.PerspectiveCamera(75,wrap.clientWidth/wrap.clientHeight,0.01,800);
  camInt.position.set(4,1.6,4);
  orbit=new THREE.OrbitControls(camExt,ren.domElement);
  orbit.enableDamping=true; orbit.dampingFactor=0.08;
  orbit.target.set(8,0,8);
  build3D(); loop3D();
}

function build3D(){
  if(!sc3) return;
  var toRemove=[];
  sc3.children.forEach(function(c){if(c.userData.b) toRemove.push(c);});
  toRemove.forEach(function(c){sc3.remove(c);});
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
  var color = isOuter ? (fl===1 ? WALL_COLORS.lower : WALL_COLORS.upper) : '#f4f0e8';
  var mat=new THREE.MeshStandardMaterial({color:color, roughness:0.7, metalness:0.1});
  var geo=new THREE.BoxGeometry(len,WALL_H*U,w.thick*U);
  var mesh=new THREE.Mesh(geo,mat);
  mesh.castShadow=true; mesh.receiveShadow=true;
  mesh.position.set((x1+x2)/2,fy+WALL_H*U/2,(z1+z2)/2);
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
    var frameMat=new THREE.MeshStandardMaterial({color:0x3a3a3a,roughness:0.5});
    var glassMat=new THREE.MeshStandardMaterial({color:0xaaccff,transparent:true,opacity:0.4,roughness:0.1,metalness:0.8});
    
    var ww=it.w*U, wh=1.8, wt=0.15;
    if(it.type==='window') { wh=1.2; fy+=1.0; }
    
    var glass=new THREE.Mesh(new THREE.BoxGeometry(ww-0.08,wh-0.08,0.01),glassMat);
    glass.position.set(0, wh/2, 0); grp.add(glass);
    var sill=new THREE.Mesh(new THREE.BoxGeometry(ww+0.1,0.05,wt+0.1),frameMat);
    sill.position.y=0.025; grp.add(sill);
    var top=new THREE.Mesh(new THREE.BoxGeometry(ww+0.1,0.05,wt+0.05),frameMat);
    top.position.y=wh; grp.add(top);
    var sideL=new THREE.Mesh(new THREE.BoxGeometry(0.05,wh,wt+0.05),frameMat);
    sideL.position.set(-ww/2,wh/2,0); grp.add(sideL);
    var sideR=new THREE.Mesh(new THREE.BoxGeometry(0.05,wh,wt+0.05),frameMat);
    sideR.position.set(ww/2,wh/2,0); grp.add(sideR);

    grp.position.set(px,fy,pz);
    grp.rotation.y=Math.atan2(wdy,wdx);
    grp.userData={b:true};
    sc3.add(grp);
  });
}

function ptSegDist(px,py,x1,y1,x2,y2){
  var dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;
  if(l2<1) return Math.sqrt((px-x1)*(px-x1)+(py-y1)*(py-y1));
  var t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/l2));
  return Math.sqrt((px-x1-t*dx)*(px-x1-t*dx)+(py-y1-t*dy)*(py-y1-t*dy));
}

var _tex3d_1 = null, _tex3d_2 = null;
function getSpriteTexture3D(sheet) {
  var img = sheet === 1 ? SPRITE_IMG1 : SPRITE_IMG2;
  if (!img.complete) return null;
  if (sheet === 1) {
    if (!_tex3d_1) { _tex3d_1 = new THREE.CanvasTexture(img); _tex3d_1.colorSpace = THREE.SRGBColorSpace; }
    return _tex3d_1;
  } else {
    if (!_tex3d_2) { _tex3d_2 = new THREE.CanvasTexture(img); _tex3d_2.colorSpace = THREE.SRGBColorSpace; }
    return _tex3d_2;
  }
}

function buildItem3D(it){
  var fy=(it.floor-1)*FLOOR_H*U, h=getItemH(it.type)*U, col=getItemCol(it.type);
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
  var s = spriteKey ? SPRITE_JSON.sprites[spriteKey] : null;
  if(s){
    var img = s.img === 1 ? SPRITE_IMG1 : SPRITE_IMG2;
    var tex = getSpriteTexture3D(s.img);
    if(tex && img.complete){
      var topMat = new THREE.MeshStandardMaterial({map: tex, transparent:true, roughness: 0.3, metalness:0.1, alphaTest:0.1, side:THREE.DoubleSide});
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(it.w*U, it.d*U), topMat);
      plane.rotation.x = -Math.PI/2;
      plane.position.y = h + 0.02;
      plane.receiveShadow=true; plane.castShadow=true;
      
      var uvAttr = plane.geometry.attributes.uv;
      for(var i=0; i<uvAttr.count; i++){
        var u = uvAttr.getX(i), v = uvAttr.getY(i);
        var sheet_u = (s.x + u * 512) / img.width;
        var sheet_v = 1 - (s.y + 512) / img.height + v * (512 / img.height);
        uvAttr.setXY(i, sheet_u, sheet_v);
      }
      uvAttr.needsUpdate = true;
      grp.add(plane);
    }
  }
  grp.userData={b:true}; sc3.add(grp);
}

function getItemH(type){return {kitchen:850,bath:500,toilet:380,sink:800,fridge:1800,washer:900,sofa:750,desk:720,'dining-table':730,low_table:400,'bed-d':550,'bed-s':550,tv:1100,closet:2100,stair:20,balcony:50}[type]||400;}
function getItemCol(type){return {kitchen:0xc8c0a0,bath:0xe8f4ff,toilet:0xf0f0f0,sink:0xe8f0ff,fridge:0xd0e8d0,washer:0xffffff,sofa:0xc8a870,'dining-table':0xd4a84a,'bed-d':0xe8d8c0,desk:0x9a8060,tv:0x181818}[type]||0xdddddd;}

function buildRooms3D(){
  var woodTex = getTexture3D('wood_floor');
  if(woodTex) { woodTex.repeat.set(1, 1); }
  var matFloor=new THREE.MeshStandardMaterial({map: woodTex, color:0xffffff, roughness:0.8});
  DATA.rooms.forEach(function(r){
    var y=(r.floor-1)*FLOOR_H*U;
    var slab=new THREE.Mesh(new THREE.BoxGeometry(r.w*U,0.05,r.d*U),matFloor);
    slab.position.set((r.x+r.w/2)*U,y+0.025,(r.y+r.d/2)*U);
    slab.receiveShadow=true; slab.userData={b:true}; sc3.add(slab);
  });
}

function buildRoof3D(){
  var topFloor = 1;
  DATA.rooms.forEach(function(r){if(r.floor>topFloor) topFloor=r.floor;});
  var fp = FOOTPRINTS[topFloor] || {w:8000, h:6000};
  var w = fp.w*U, d = fp.h*U, h = topFloor * FLOOR_H * U;
  var pitch = (ROOF.pitch || 30) * Math.PI / 180;
  var ridgeH = (w/2) * Math.tan(pitch);
  var mat = new THREE.MeshStandardMaterial({color:ROOF.color||0x2a2a30, side:THREE.DoubleSide, roughness:0.7});
  if(ROOF.type === 'gable') {
    var geo = new THREE.BufferGeometry();
    var pts = new Float32Array([
      0, h, 0,  w, h, 0,  w/2, h+ridgeH, 0,
      0, h, d,  w, h, d,  w/2, h+ridgeH, d,
      0, h, 0,  0, h, d,  w/2, h+ridgeH, d,
      0, h, 0,  w/2, h+ridgeH, 0,  w/2, h+ridgeH, d,
      w, h, 0,  w, h, d,  w/2, h+ridgeH, d,
      w, h, 0,  w/2, h+ridgeH, 0,  w/2, h+ridgeH, d
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geo.computeVertexNormals();
    var roof = new THREE.Mesh(geo, mat);
    roof.castShadow = true; roof.receiveShadow = true; roof.userData={b:true};
    sc3.add(roof);
  } else if(ROOF.type === 'flat') {
    var geo = new THREE.BoxGeometry(w+0.4, 0.2, d+0.4);
    var roof = new THREE.Mesh(geo, mat);
    roof.position.set(w/2, h+0.1, d/2);
    roof.castShadow = true; roof.receiveShadow = true; roof.userData={b:true};
    sc3.add(roof);
  }
}
function buildLandscape(){
  DATA.items.filter(function(it){return it.type==='tree';}).forEach(function(it){
    var grp=new THREE.Group();
    grp.position.set((it.x+it.w/2)*U,0,(it.y+it.d/2)*U);
    var trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.22,1.2,8),new THREE.MeshStandardMaterial({color:0x4d342a}));
    trunk.position.y=0.6; trunk.castShadow=true;
    var foliage=new THREE.Mesh(new THREE.SphereGeometry(1.2,10,10),new THREE.MeshStandardMaterial({color:0x1b5e20,roughness:0.8}));
    foliage.position.y=1.8; foliage.castShadow=true;
    grp.add(trunk); grp.add(foliage); grp.userData={b:true}; sc3.add(grp);
  });
}
function loop3D(){
  requestAnimationFrame(loop3D);
  if(ST.view==='3d-ext'){orbit.update();ren.render(sc3,camExt);}
  else if(ST.view==='3d-int'&&camInt){ren.render(sc3,camInt);}
}

function setView(v){
  ST.view=v;
  document.getElementById('c2d').style.display=(v==='2d'?'block':'none');
  document.getElementById('c3d-wrap').style.display=(v==='2d'?'none':'block');
  document.getElementById('help-box').style.display=(v==='2d'?'block':'none');
  document.getElementById('int-ctrl').className=(v==='3d-int'?'show':'');
  document.getElementById('wasd').style.display=(v==='3d-int'?'block':'none');
  document.getElementById('btn-2d').className='tbtn'+(v==='2d'?' active':'');
  document.getElementById('btn-3de').className='tbtn'+(v==='3d-ext'?' active':'');
  document.getElementById('btn-3di').className='tbtn'+(v==='3d-int'?' active':'');
  var modeNames={'2d':'平面図','3d-ext':'外観3D','3d-int':'内観3D'};
  document.getElementById('st-mode').textContent='モード:'+(modeNames[v]||v);
  if(v!=='2d'){
    init3D();
    if(v==='3d-int'&&orbit){orbit.enabled=false;}
    else if(orbit){orbit.enabled=true;}
  }
  if(v==='2d') draw2d();
}

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

function toggleCat(el) {
  var body = el.nextElementSibling;
  body.classList.toggle('open');
  var span = el.querySelector('span');
  if (span) span.style.transform = body.classList.contains('open') ? 'rotate(90deg)' : 'rotate(0deg)';
}
function toggleGrid(){ST.showGrid=!ST.showGrid;draw2d();}
function toggleDim(){ST.showDim=!ST.showDim;draw2d();}
function resetView(){
  var fp=FOOTPRINTS[ST.floor], area=document.getElementById('canvas-area');
  if(area&&fp){
    ST.zoom=Math.min((area.clientWidth-120)/(fp.w*0.05),(area.clientHeight-120)/(fp.h*0.05));
  } else { ST.zoom=0.2; }
  ST.panX=60;ST.panY=60;draw2d();
}
function onFloorChange(v){
  ST.floor=+v; ST.selected=null; DRAG.active=false;
  document.getElementById('props').classList.remove('show');
  document.getElementById('st-floor').textContent='フロア:'+v+'F';
  draw2d();
}
function setRoof(v){ROOF.type=v;if(sc3)build3D();}

// ───── CANVAS EVENTS ─────
canvas.onmousedown=function(e){
  ST.selectAll = false;
  var r=canvas.getBoundingClientRect(); var cx=e.clientX-r.left, cy=e.clientY-r.top;
  if(e.button===1 || (e.button===0 && e.altKey)){
    ST.panning = true; ST.lastPanCX = cx; ST.lastPanCY = cy;
    e.preventDefault(); return;
  }
  if(e.button===2){ST.drawing=false;ST.drawPts=[];DRAG.active=false;draw2d();return;}
  if(e.button!==0) return;
  var w=c2w(cx,cy);
  var wx=snapV(w.x), wy=snapV(w.y);
  if(ST.tool==='select') handleSelectDown(cx,cy,wx,wy,e);
  else if(ST.tool==='erase') handleErase(wx,wy);
  else if(ST.tool==='wall') handleWallClick(wx,wy);
  else if(ST.tool==='room-rect') handleRoomClick(wx,wy);
  else placeItem(ST.tool,wx,wy);
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
  var fr=DATA.rooms.filter(function(r){return r.floor===ST.floor;});
  for(var i=fr.length-1;i>=0;i--){
    if(isInsideItem(fr[i],wx,wy)){
      ST.selected=fr[i];
      DRAG.active=true;DRAG.saved=false; DRAG.handle='move';
      DRAG.startCX=cx; DRAG.startCY=cy;
      DRAG.origItem=JSON.parse(JSON.stringify(fr[i]));
      draw2d();return;
    }
  }
  var fw=DATA.walls.filter(function(w){return w.floor===ST.floor;});
  for(var i=fw.length-1;i>=0;i--){
    if(nearWall(wx,wy,fw[i])){ ST.selected=fw[i]; draw2d(); return; }
  }
  ST.selected=null; draw2d();
}

canvas.addEventListener('mousemove',function(e){
  var r=canvas.getBoundingClientRect(); var cx=e.clientX-r.left, cy=e.clientY-r.top;
  if(ST.panning) {
    ST.panX += (cx - ST.lastPanCX); ST.panY += (cy - ST.lastPanCY);
    ST.lastPanCX = cx; ST.lastPanCY = cy; draw2d(); return;
  }
  var wc=c2w(cx,cy);
  ST.mouseW = wc;
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
    var zoomDelta = -e.deltaY * 0.01; var oldZoom = ST.zoom;
    ST.zoom = Math.min(Math.max(0.02, ST.zoom + zoomDelta), 5.0);
    var r=canvas.getBoundingClientRect(); var cx=e.clientX-r.left, cy=e.clientY-r.top;
    ST.panX = cx - (cx - ST.panX) * (ST.zoom / oldZoom);
    ST.panY = cy - (cy - ST.panY) * (ST.zoom / oldZoom);
  } else {
    ST.panX -= e.deltaX; ST.panY -= e.deltaY;
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
  if(it.type === 'room') rad = 0;
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
  if(!ST.showDim||ST.zoom<0.3) return;
  var fp=FOOTPRINTS[ST.floor], a=w2c(0,0), b=w2c(fp.w,0), c=w2c(0,fp.h);
  var off=24; ctx.save();
  ctx.strokeStyle='rgba(40,70,160,0.6)'; ctx.fillStyle='rgba(40,70,160,0.8)'; ctx.lineWidth=1.2;
  var fsz=Math.max(10,ST.zoom*5.5); ctx.font='bold '+fsz+'px sans-serif'; ctx.textAlign='center';
  ctx.beginPath(); ctx.moveTo(a.cx, a.cy-off); ctx.lineTo(b.cx, a.cy-off); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(a.cx-5, a.cy-off+5); ctx.lineTo(a.cx+5, a.cy-off-5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(b.cx-5, a.cy-off+5); ctx.lineTo(b.cx+5, a.cy-off-5); ctx.stroke();
  ctx.fillText(fp.w+'mm', (a.cx+b.cx)/2, a.cy-off-6);
  ctx.beginPath(); ctx.moveTo(a.cx-off, a.cy); ctx.lineTo(a.cx-off, c.cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(a.cx-off-5, a.cy+5); ctx.lineTo(a.cx-off+5, a.cy-5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(a.cx-off-5, c.cy+5); ctx.lineTo(a.cx-off+5, c.cy-5); ctx.stroke();
  ctx.translate(a.cx-off-8, (a.cy+c.cy)/2); ctx.rotate(-Math.PI/2); ctx.fillText(fp.h+'mm', 0, 0);
  ctx.restore();
}

function delSel(){
  if(!ST.selected)return;
  saveState();
  if(ST.selected.thick!==undefined){ DATA.walls=DATA.walls.filter(function(w){return w!==ST.selected;}); }
  else if(ST.selected.type==='room'){ DATA.rooms=DATA.rooms.filter(function(r){return r!==ST.selected;}); }
  else { DATA.items=DATA.items.filter(function(i){return i!==ST.selected;}); }
  ST.selected=null;DRAG.active=false;document.getElementById('props').classList.remove('show');
  draw2d();rebuild3D();
}

function undoAction(){
  if(!HISTORY.length) return;
  DATA = JSON.parse(HISTORY.pop());
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

function exportPlan(){
  var json=JSON.stringify(DATA,null,2);
  var a=document.createElement('a');
  a.href='data:application/json;charset=utf-8,'+encodeURIComponent(json);
  a.download='plan.json';a.click();
}
function doImport(inp){
  var file=inp.files[0];if(!file)return;
  var r=new FileReader();
  r.onload=function(e){
    try{ DATA=JSON.parse(e.target.result); draw2d(); rebuild3D(); }
    catch(ex){alert('読み込みエラー:'+ex.message);}
  };
  r.readAsText(file);
}

window.addEventListener('keydown', function(e){
  if(e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;
  if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); undoAction(); }
  if(e.key === 'Backspace' || e.key === 'Delete'){ if(ST.selected){ e.preventDefault(); delSel(); } }
  if(e.key.toLowerCase() === 'r') { ST.placingRot = (ST.placingRot + 90) % 360; draw2d(); }
});
window.addEventListener('resize',function(){
  resize2d();
  if(ren){var wrap=document.getElementById('c3d-wrap');ren.setSize(wrap.clientWidth,wrap.clientHeight);
    [camExt,camInt].forEach(function(c){c.aspect=wrap.clientWidth/wrap.clientHeight;c.updateProjectionMatrix();});}
});

loadPreset(); resize2d(); resetView();
