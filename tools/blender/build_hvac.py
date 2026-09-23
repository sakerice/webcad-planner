"""壁掛けエアコンを組み立てる。

作る約束(座標・原点・正面・UV・面数・登録)は tools/blender/README.md の
「カタログのモデルを作るときの約束」。検査は model_kit.run() が全点に掛ける。

  Blender --background --factory-startup --python tools/blender/build_hvac.py [-- --no-icons]

■ 寸法(mm)
  original-ac-wall      798x235x295  標準的な一般壁掛け
  original-ac-wall-wide 890x330x295  高機能(お掃除機能付き)の大きい筐体

  下前面を後退させ、吹出口とルーバーの空間を取る。**面取りが深すぎると、
  12mm の吹出口で上下の丸みがぶつかり潰れた三角形ができる**(6→5mm で解消)。
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403


def build_ac(w, d, h):
    skin = matp('Air conditioner shell', '#f6f6f4', rough=.35)
    outlet = matp('Air conditioner outlet', '#d8d9d6', rough=.6)
    louver = matp('Air conditioner louver', '#eceae6', rough=.4)
    lamp = matp('Air conditioner indicator', '#5d6b74', rough=.3)
    # Lower front is withdrawn 60 mm: the outlet sits in real negative space.
    # Ring centers keep the rear face aligned with +d/2 throughout the profile.
    rows = [
        (w-.032,d-.082,.022,0,.041),
        (w-.012,d-.070,.028,.009,.035),
        (w,d-.060,.035,.032,.030),
        (w,d-.052,.038,.067,.026),
        (w,d-.008,.045,.103,.004),
        (w,d,.048,.133,0),
        (w,d-.006,.048,h-.036,.003),
        (w-.008,d-.018,.044,h-.014,.009),
        (w-.028,d-.036,.034,h,.018),
    ]
    rings = [rounded_rect(0,cy,rw,rd,r,z,n=5) for rw,rd,r,z,cy in rows]
    parts = [shell('Air conditioner continuous shell', rings, [skin], [0]*8)]
    # Keep bevel width below half the 12 mm depth: at 6 mm the opposing
    # bevels meet and can leave zero-area triangles after tessellation.
    parts.append(box('Air conditioner recessed outlet',
                     (-w/2+.049,-d/2+.052,.022), (w/2-.049,-d/2+.064,.072), outlet, .005))
    parts.append(box('Air conditioner louver',
                     (-w/2+.056,-d/2+.012,.022), (w/2-.056,-d/2+.051,.039), louver, .006))
    # Upper intake slot and small display; both remain inside the nominal box.
    parts.append(box('Air conditioner upper intake',
                     (-w/2+.070,-d/2+.010,h-.013), (w/2-.070,-d/2+.016,h-.006), outlet, .002, 2))
    parts.append(box('Air conditioner indicator',
                     (w/2-.145,-d/2+.0001,.148), (w/2-.099,-d/2+.006,.162), lamp, .002, 2))
    return combine(parts)


if __name__ == '__main__':
    run([('original-ac-wall', (798, 235, 295), lambda: build_ac(.798, .235, .295)),
         ('original-ac-wall-wide', (890, 330, 295), lambda: build_ac(.890, .330, .295))])
