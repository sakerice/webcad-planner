#!/usr/bin/env python3
"""
Apply tight crop coordinates to sprite drawing in index.html.
Run AFTER analyze_sprites.py has created japanese_floorplan_parts_sprite_gpt_cropped.json
"""
import os, json, sys, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CROPPED_JSON = os.path.join(ROOT, 'assets', 'japanese_floorplan_parts_sprite_gpt_cropped.json')
INDEX = os.path.join(ROOT, 'index.html')

if not os.path.exists(CROPPED_JSON):
    print(f"✗ Run analyze_sprites.py first to generate {CROPPED_JSON}")
    sys.exit(1)

with open(CROPPED_JSON) as f:
    cropped = json.load(f)

with open(INDEX, 'r', encoding='utf-8') as f:
    src = f.read()

# 1. Replace sprite JSON reference to use cropped version
old_ref = "'assets/japanese_floorplan_parts_sprite_gpt.json'"
new_ref = "'assets/japanese_floorplan_parts_sprite_gpt_cropped.json'"
if old_ref in src:
    src = src.replace(old_ref, new_ref, 1)
    print(f"✓ Updated sprite JSON reference to cropped version")
elif new_ref in src:
    print("- Sprite JSON reference: already updated")
else:
    print("⚠ Sprite JSON reference not found - check manually")

# 2. Update drawItem2d to use crop coordinates (cx, cy, cw, ch)
# Current code:
#   ctx.drawImage(img, s.x, s.y, 512, 512, -dw/2, -dd/2, dw, dd);
# New code with crop:
#   var scx=s.cx||0, scy=s.cy||0, scw=s.cw||512, sch=s.ch||512;
#   var aspect=scw/sch;
#   if(tw/td>aspect){dw=td*aspect;}else{dd=tw/aspect;}
#   ctx.drawImage(img, s.x+scx, s.y+scy, scw, sch, -dw/2, -dd/2, dw, dd);

OLD_DRAW = """      var tw = it.w * sc, td = it.d * sc;
      var aspect = 1.0;
      var dw = tw, dd = td;
      if (tw / td > aspect) { dw = td * aspect; } else { dd = tw / aspect; }
      ctx.save();
      ctx.translate((it.sX||0)*sc, (it.sY||0)*sc);
      var ss = it.sScale||1;
      ctx.scale(ss, ss);
      ctx.drawImage(img, s.x, s.y, 512, 512, -dw/2, -dd/2, dw, dd);"""

NEW_DRAW = """      var tw = it.w * sc, td = it.d * sc;
      // Use tight crop coords if available
      var scx=s.cx||0, scy=s.cy||0, scw=s.cw||512, sch=s.ch||512;
      var aspect = scw/sch;
      var dw = tw, dd = td;
      if (tw / td > aspect) { dw = td * aspect; } else { dd = tw / aspect; }
      ctx.save();
      ctx.translate((it.sX||0)*sc, (it.sY||0)*sc);
      var ss = it.sScale||1;
      ctx.scale(ss, ss);
      ctx.drawImage(img, s.x+scx, s.y+scy, scw, sch, -dw/2, -dd/2, dw, dd);"""

if OLD_DRAW in src:
    src = src.replace(OLD_DRAW, NEW_DRAW, 1)
    print("✓ Updated drawImage to use crop coordinates")
elif 'scx=s.cx' in src:
    print("- drawImage: already using crop coordinates")
else:
    print("⚠ drawImage anchor not found - check manually")

with open(INDEX, 'w', encoding='utf-8') as f:
    f.write(src)

print("\nDone. Run: git add assets/ index.html && git commit -m 'fix: sprite tight crop'")
