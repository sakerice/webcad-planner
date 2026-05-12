#!/usr/bin/env python3
"""Task 5: JIS A 0150 建具記号改善 (door-slide / window / door-swing)"""
import os, sys

TARGET = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'))

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

applied = 0

# ── door-swing / door-front ──────────────────────────────────────
OLD_SWING = """    } else if(it.type === 'door-swing' || it.type === 'door-front') {
      ctx.strokeStyle='#333'; ctx.lineWidth=2;
      // Frame
      ctx.beginPath(); ctx.moveTo(-hw, hd); ctx.lineTo(-hw, -hd); ctx.stroke();
      // Door Leaf (open)
      ctx.save();
      ctx.translate(-hw, hd);
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0, -it.w*sc); ctx.stroke();
      // Arc
      ctx.lineWidth=1; ctx.setLineDash([2,2]);
      ctx.beginPath(); ctx.arc(0,0, it.w*sc, -Math.PI/2, 0); ctx.stroke();
      ctx.restore();
    }"""

NEW_SWING = """    } else if(it.type === 'door-swing' || it.type === 'door-front') {
      ctx.strokeStyle='#333'; ctx.lineWidth=1.8;
      ctx.beginPath(); ctx.moveTo(-hw, -hd); ctx.lineTo(-hw, hd); ctx.stroke();
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(-hw, hd); ctx.lineTo(hw, hd); ctx.stroke();
      ctx.lineWidth=0.8; ctx.setLineDash([3,3]);
      ctx.beginPath();
      ctx.arc(-hw, hd, it.w*sc, -Math.PI/2, 0);
      ctx.strokeStyle='#555'; ctx.stroke();
      ctx.setLineDash([]);
    }"""

if OLD_SWING in src:
    src = src.replace(OLD_SWING, NEW_SWING, 1); applied += 1
elif 'setLineDash([3,3])' in src:
    applied += 1  # already applied

# ── door-slide ───────────────────────────────────────────────────
OLD_SLIDE = """    } else if(it.type === 'door-slide') {
      ctx.strokeStyle='#333'; ctx.lineWidth=1.5;
      ctx.strokeRect(-hw,-hd*0.3, it.w*sc, hd*0.6);
      ctx.beginPath();
      ctx.moveTo(0, -hd*0.3); ctx.lineTo(0, hd*0.3);
      ctx.moveTo(-hw*0.5, -hd*0.3); ctx.lineTo(-hw*0.5, hd*0.3);
      ctx.moveTo(hw*0.5, -hd*0.3); ctx.lineTo(hw*0.5, hd*0.3);
      ctx.stroke();
    }"""

NEW_SLIDE = """    } else if(it.type === 'door-slide') {
      ctx.strokeStyle='#333'; ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(-hw, -hd); ctx.lineTo(hw, -hd);
      ctx.moveTo(-hw,  hd); ctx.lineTo(hw,  hd);
      ctx.stroke();
      ctx.strokeRect(-hw, -hd*0.85, it.w*sc*0.6, hd*1.7);
      ctx.beginPath();
      ctx.moveTo(-hw + it.w*sc*0.55, -hd*0.3);
      ctx.lineTo(-hw + it.w*sc*0.55,  hd*0.3);
      ctx.lineWidth=2; ctx.stroke();
    }"""

if OLD_SLIDE in src:
    src = src.replace(OLD_SLIDE, NEW_SLIDE, 1); applied += 1
elif 'it.w*sc*0.6, hd*1.7' in src:
    applied += 1

# ── window ───────────────────────────────────────────────────────
OLD_WIN = """    } else if(it.type === 'window') {
      ctx.strokeStyle='#666'; ctx.lineWidth=1;
      ctx.strokeRect(-hw,-hd*0.5, it.w*sc, hd);
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0);
      ctx.strokeStyle='#3080e8'; ctx.stroke();
    }"""

NEW_WIN = """    } else if(it.type === 'window') {
      ctx.strokeStyle='#555'; ctx.lineWidth=1.0;
      ctx.strokeRect(-hw, -hd, it.w*sc, it.d*sc);
      ctx.beginPath();
      ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0);
      ctx.strokeStyle='#3080e8'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-hw, -hd*0.45); ctx.lineTo(hw, -hd*0.45);
      ctx.moveTo(-hw,  hd*0.45); ctx.lineTo(hw,  hd*0.45);
      ctx.strokeStyle='#777'; ctx.lineWidth=0.8; ctx.stroke();
    }"""

if OLD_WIN in src:
    src = src.replace(OLD_WIN, NEW_WIN, 1); applied += 1
elif 'hd*0.45' in src:
    applied += 1

if applied == 0:
    print("✗ ERROR: no matching blocks found"); sys.exit(1)
elif applied < 3:
    print(f"⚠ Partial: {applied}/3 blocks applied")
else:
    print("✓ Task 5 applied: JIS door/window symbols updated")

with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)
