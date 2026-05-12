#!/usr/bin/env python3
"""Task 3: 外壁ハッチング (drawHatch関数追加)"""
import os, sys

TARGET = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'))

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

if 'function drawHatch' in src:
    print("✓ Task 3 already applied"); sys.exit(0)

DRAW_HATCH = """function drawHatch(ctx, pts, pitch) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].cx, pts[0].cy);
  ctx.lineTo(pts[1].cx, pts[1].cy);
  ctx.lineTo(pts[2].cx, pts[2].cy);
  ctx.lineTo(pts[3].cx, pts[3].cy);
  ctx.closePath();
  ctx.clip();
  var xs = pts.map(function(p){return p.cx;}), ys = pts.map(function(p){return p.cy;});
  var x0=Math.min.apply(null,xs)-pitch, x1=Math.max.apply(null,xs)+pitch;
  var y0=Math.min.apply(null,ys)-pitch, y1=Math.max.apply(null,ys)+pitch;
  var span = (x1-x0) + (y1-y0);
  ctx.beginPath();
  for(var s = -span; s < span; s += pitch) {
    ctx.moveTo(x0, y0 + s);
    ctx.lineTo(x0 + span, y0 + s + span);
  }
  ctx.strokeStyle = 'rgba(100,90,80,0.35)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
}
"""

if 'function drawWall2d' not in src:
    print("✗ ERROR: drawWall2d not found"); sys.exit(1)

src = src.replace('function drawWall2d(w){', DRAW_HATCH + 'function drawWall2d(w){', 1)

OLD_OUTER = """  } else if(isOuter){
    ctx.fillStyle='#e8e4dc'; ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=2.0; ctx.stroke();
  }"""

NEW_OUTER = """  } else if(isOuter){
    ctx.fillStyle='#e8e4dc'; ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=2.0; ctx.stroke();
    var pts = [
      {cx: a.cx+nx*t, cy: a.cy+ny*t},
      {cx: b.cx+nx*t, cy: b.cy+ny*t},
      {cx: b.cx-nx*t, cy: b.cy-ny*t},
      {cx: a.cx-nx*t, cy: a.cy-ny*t}
    ];
    drawHatch(ctx, pts, Math.max(4, t * 0.7));
  }"""

if OLD_OUTER not in src:
    print("✗ ERROR: isOuter block not found (Task 2 must be applied first)"); sys.exit(1)

src = src.replace(OLD_OUTER, NEW_OUTER, 1)

with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)
print("✓ Task 3 applied: drawHatch added")
