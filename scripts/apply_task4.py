#!/usr/bin/env python3
"""Task 4: 部屋の畳数・平米自動表示 (drawRoomLbls置き換え)"""
import os, sys

TARGET = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'))

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

if 'tatami.toFixed' in src:
    print("✓ Task 4 already applied"); sys.exit(0)

OLD = """function drawRoomLbls(){
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
}"""

NEW = """function drawRoomLbls(){
  var fr=DATA.rooms.filter(function(r){return r.floor===ST.floor;});
  fr.forEach(function(l){
    var p=w2c(l.x+l.w/2,l.y+l.d/2);
    var name=l.n||'部屋';
    var sqm = (l.w * l.d) / 1000000;
    var tatami = sqm / 1.62;
    var areaStr = tatami.toFixed(1) + '畳 / ' + sqm.toFixed(2) + '㎡';
    var showArea = ST.zoom >= 0.4;
    var szN=Math.max(10,ST.zoom*0.8), szA=Math.max(8,ST.zoom*0.55);
    ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
    var tw=Math.max(ctx.measureText(name).width, showArea?ctx.measureText(areaStr).width:0)+18;
    var th=showArea?szN+szA+14:szN+12;
    ctx.save();
    ctx.translate(p.cx,p.cy);
    if(ST.selected===l) {
      ctx.shadowBlur=10; ctx.shadowColor='rgba(0,120,255,0.5)';
      ctx.strokeStyle='#0078ff'; ctx.lineWidth=2;
    }
    ctx.fillStyle='rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.roundRect(-tw/2,-th/2,tw,th,6); ctx.fill();
    if(ST.selected===l) ctx.stroke();
    ctx.restore();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='bold '+szN+'px "Noto Sans JP",sans-serif';
    ctx.fillStyle='#222';
    ctx.fillText(name, p.cx, showArea ? p.cy-szA/2-2 : p.cy);
    if(showArea){
      ctx.font=szA+'px "Noto Sans JP",sans-serif';
      ctx.fillStyle='#666';
      ctx.fillText(areaStr, p.cx, p.cy+szN/2+3);
    }
  });
}"""

if OLD not in src:
    print("✗ ERROR: drawRoomLbls original not found (may already be modified)"); sys.exit(1)

src = src.replace(OLD, NEW, 1)
with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)
print("✓ Task 4 applied: auto tatami/sqm display added")
