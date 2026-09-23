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


def vent_register():
    """150 mm circular register; the exposed grille faces down for ceiling use."""
    skin = matp('Register ivory resin', '#f3f2ec', rough=.42)
    shade = matp('Register recessed interior', '#68716e', rough=.8)
    # Inner ceiling -> inner wall -> rounded outer lip -> closed rear.
    # XY diameter fixes w/d; the central pull fixes z=0. No resizing.
    rows = [(.063,.022), (.063,.003), (.073,.003),
            (.075,.005), (.075,.028), (.073,.030)]
    rings = [[(r*math.cos(i*math.tau/16), r*math.sin(i*math.tau/16), z)
              for i in range(16)] for r,z in rows]
    parts = [shell('Register circular recessed rim', rings, [skin, shade], [1,0,0,0,0])]
    for y, half_width in ((-.038,.047), (0,.059), (.038,.047)):
        parts.append(box('Register louver', (-half_width,y-.008,.003),
                         (half_width,y+.008,.009), skin, .001, 1))
    rings = [[(r*math.cos(i*math.tau/8), r*math.sin(i*math.tau/8), z)
              for i in range(8)] for r,z in ((.007,0),(.009,.002),(.009,.014))]
    parts.append(shell('Register central pull', rings, [skin], [0,0]))
    return combine(parts)


def bath_dryer():
    skin = matp('Bath dryer white resin', '#f4f4ef', rough=.4)
    dark = matp('Bath dryer intake shadow', '#485151', rough=.85)
    window = matp('Bath dryer control window', '#52686b', rough=.28)
    parts = [box('Bath dryer shallow housing', (-.325,-.225,.020),
                 (.325,.225,.130), skin, .009, 2),
             box('Bath dryer recessed intake', (-.270,-.177,.010),
                 (.170,.177,.023), dark, .003, 1)]
    # Downward-facing grille: real 6 mm gaps, recessed dark backing.
    for i in range(10):
        y = -.180+i*.038
        parts.append(box('Bath dryer grille bar', (-.278,y,0),
                         (.178,y+.032,.014), skin, .0015, 1))
    parts.append(box('Bath dryer side control panel', (.200,-.180,.003),
                     (.288,.180,.022), skin, .003, 1))
    parts.append(box('Bath dryer small control window', (.218,-.115,.001),
                     (.270,-.045,.006), window, .001, 1))
    return combine(parts)


def ac_floor():
    skin = matp('Floor AC warm white shell', '#f5f4ef', rough=.38)
    dark = matp('Floor AC recessed vents', '#465052', rough=.8)
    blade = matp('Floor AC ivory louvers', '#dedfd8', rough=.48)
    # Rear lower corners stand proud of the main back, leaving a real pipe chase.
    parts = [box('Floor AC main housing', (-.300,-.100,.025),
                 (.300,.095,.700), skin, .012, 2),
             box('Floor AC upper rear cover', (-.285,.085,.220),
                 (.285,.125,.685), skin, .004, 1)]
    for x in (-.270,.270):
        parts.append(box('Floor AC rear foot', (x-.025,-.085,0),
                         (x+.025,.125,.220), skin, .004, 1))
    parts.append(box('Floor AC upper outlet recess', (-.260,-.106,.545),
                     (.260,-.098,.664), dark, .002, 1))
    for z in (.550,.584,.618):
        parts.append(box('Floor AC outlet louver', (-.250,-.125,z),
                         (.250,-.103,z+.019), blade, .003, 1))
    parts.append(box('Floor AC lower intake recess', (-.255,-.106,.070),
                     (.255,-.098,.310), dark, .002, 1))
    for i in range(7):
        z = .074+i*.034
        parts.append(box('Floor AC intake slat', (-.263,-.115,z),
                         (.263,-.104,z+.023), skin, .002, 1))
    return combine(parts)


if __name__ == '__main__':
    run([('original-ac-wall', (798, 235, 295), lambda: build_ac(.798, .235, .295)),
         ('original-ac-wall-wide', (890, 330, 295), lambda: build_ac(.890, .330, .295)),
         ('original-vent-register', (150, 150, 30), vent_register, None, 400, False, True),
         ('original-bath-dryer', (650, 450, 130), bath_dryer, None, 700, False, True),
         ('original-ac-floor', (600, 250, 700), ac_floor, None, 900)])
