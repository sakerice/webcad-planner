"""机(学習机・ワークデスク)を組み立てる。

作る約束(座標・原点・正面・UV・面数・登録)は tools/blender/README.md の
「カタログのモデルを作るときの約束」。検査は model_kit.run() が全点に掛ける。

  Blender --background --factory-startup --python tools/blender/build_desks.py [-- --no-icons]

■ 寸法(mm)
  original-desk      1000x600x720  学習机(3段袖)
  original-desk-work 1400x700x730  ワークデスク(2段袖)

  天板 R8mm、側板・袖・前板に面取り。引出しの目地と取手の支持部、接地する
  袖の巾木まで作る。木部は finishChannel='wood' で色と素材を変えられる。
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403


def build_desk(w,d,h,drawers):
    wood = matp('Desk wood', '#c9a97e', rough=.55)
    wood['finishChannel'] = 'wood'
    metal = matp('Desk fitting', '#9fa3a7', rough=.35, metal=.85)
    x0 = w/2-.36
    parts = [box('Desk top', (-w/2,-d/2,h-.025), (w/2,d/2,h), wood, .008, 4),
             box('Desk pedestal', (x0,-d/2+.047,.060), (w/2-.008,d/2-.012,h-.027), wood, .006),
             box('Desk side panel', (-w/2+.006,-d/2+.026,.020), (-w/2+.026,d/2-.012,h-.025), wood, .004),
             box('Desk modesty panel', (-w/2+.026,d/2-.033,h*.45), (x0,d/2-.015,h-.028), wood, .003),
             box('Desk left foot', (-w/2+.009,-d/2+.05,0), (-w/2+.029,d/2-.05,.022), metal, .003),
             box('Desk pedestal plinth', (x0+.018,-d/2+.065,0), (w/2-.026,d/2-.04,.062), wood, .004)]
    span = (h-.125)/drawers
    for k in range(drawers):
        z0 = .09+k*span
        z1 = z0+span-.008
        parts.append(box('Desk drawer front', (x0+.006,-d/2+.025,z0), (w/2-.014,-d/2+.045,z1), wood, .003))
        z = (z0+z1)/2
        for x in (x0+.085,w/2-.085):
            parts.append(box('Desk pull mount', (x-.006,-d/2+.012,z-.007), (x+.006,-d/2+.026,z+.007), metal, .003, 2))
        parts.append(box('Desk drawer pull', (x0+.077,-d/2+.004,z-.008), (w/2-.077,-d/2+.017,z+.008), metal, .006))
    return combine(parts)


def desk_counter():
    wood = matp('Study counter oak', '#c9ad85', rough=.58)
    wood['finishChannel'] = 'wood'
    parts = [box('Study counter single top', (-.900,-.225,.700),
                 (.900,.225,.730), wood, .006, 3)]
    # Three 24 mm panels leave two equal seating bays. Their recessed backs
    # leave a continuous 45 mm cable route beneath the wall edge of the top.
    for x in (-.864,0,.864):
        parts.append(box('Study counter thin support panel', (x-.012,-.205,0),
                         (x+.012,.180,.704), wood, .002, 2))
    for lo, hi in ((-.852,-.012),(.012,.852)):
        parts.append(box('Study counter rear stiffener', (lo,.150,.615),
                         (hi,.174,.704), wood, .002, 1))
    return combine(parts)


if __name__ == '__main__':
    run([('original-desk', (1000, 600, 720), lambda: build_desk(1, .6, .72, 3), 'wood'),
         ('original-desk-work', (1400, 700, 730), lambda: build_desk(1.4, .7, .73, 2), 'wood'),
         ('original-desk-counter', (1800, 450, 730), desk_counter, 'wood', 1000)])
