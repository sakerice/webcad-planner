"""壁掛けエアコンを生成して `assets/models/original/` へ書き出す。

■ なぜ作るのか
  カタログの空調は2点しかない(壁掛け1・シーリングファン1)。3LDK を1軒
  仕上げるとLDK・和室・主寝室・子供部屋2室で5台要るので、**同じエアコンが
  4〜5台並ぶ**。`node tools/catalogue_gap.mjs` で不足8点、全分類で最大。

  台数以前に、エアコンは「室内で必ず目に入るのに、無いと部屋が竣工写真に
  見えない」もので、居室の見え方をいちばん安く底上げできる。

■ 寸法(manifest.json の w/d/h と一対一)
  original-ac-wall      : 798 x 235 x 295 mm  6〜10畳用(2.2〜2.8kW)の標準機
  original-ac-wall-wide : 890 x 330 x 295 mm  14〜20畳用。奥行が増して前へ出る

  各社の室内機の寸法はこの2系統にほぼ集約される。高さ295は共通で、
  幅798 / 890 と奥行 235 / 330 が変わる。

■ 座標・原点の約束
  - 正面は Blender の -Y(glTF +Z)。既存の original 54点と同じ。
    ここを違えると、3Dでエアコンだけ壁にめり込む。
  - 原点は接地面の中心。壁掛けだが、アプリは高さ(elev)で持ち上げるので、
    モデル自体は Z=0 から上へ立てる。

■ 色
  **変えられる部位を作らない。** ルームエアコンの室内機は白のみで売られて
  いる。色を変えられるようにしても、現実に無い選択肢が出るだけになる。

■ 実行方法
      /Applications/Blender.app/Contents/MacOS/Blender --background \\
          --factory-startup --python tools/blender/build_hvac.py
"""
import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exterior_build import (  # noqa: E402
    matp, clear_scene, new_object, tri_count, add_box, normalize_to,
    render_top, render_thumb)
from shape_kit import rounded_rect, loft, cap, join, export  # noqa: E402

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(_ROOT, 'assets', 'models', 'original')
WORK_DIR = os.path.join(_ROOT, 'tools', 'blender', 'work', 'original')

SIZES = {
    'original-ac-wall': (798, 235, 295),
    'original-ac-wall-wide': (890, 330, 295),
}


def build_ac(w_mm, d_mm, h_mm):
    """室内機。筐体・前面パネル・吹き出し口・ルーバー・表示部。

    **吹き出し口を凹ませる。** 前面がのっぺりした白い箱だと、壁に貼った
    発泡スチロールに見える。実物は下前が斜めに切り欠かれていて、そこに
    ルーバーが1枚入る。この切り欠きだけで「エアコン」に見えるようになる。
    """
    w, d, h = w_mm / 1000, d_mm / 1000, h_mm / 1000
    shell = matp('Air conditioner shell', '#f6f6f4', rough=0.35)
    inlet = matp('Air conditioner outlet', '#d8d9d6', rough=0.6)
    louver = matp('Air conditioner louver', '#eceae6', rough=0.4)
    lamp = matp('Air conditioner indicator', '#5d6b74', rough=0.3)

    # 筐体。上面は奥へ向かって少し下がり、前面は丸い。
    bm = bmesh.new()
    n = 5
    # **背面と前面を箱の端にぴたりと付ける。** ここが内側に入っていると、
    # normalize_to が縦横比を保ったまま縮めるので、幅が狙いに届かない
    # (実測 798狙いで 791.3mm)。壁付けの機器なので、背面が平らなのも実物どおり。
    back_low = rounded_rect(0, d * 0.17, w, d * 0.66, 0.012, 0.0, n)
    front_mid = rounded_rect(0, 0, w, d, 0.030, h * 0.42, n)
    top = rounded_rect(0, d * 0.11, w, d * 0.78, 0.030, h, n)
    cap(bm, 0, back_low, flip=True)
    loft(bm, 0, back_low, front_mid)     # 下面〜前面のふくらみ
    loft(bm, 0, front_mid, top)          # 前面〜天面
    cap(bm, 0, top)
    body = new_object('original-ac-wall', bm, [shell, inlet, louver, lamp])

    parts = []
    # 吹き出し口(下前の切り欠き)。奥まった暗い面を作る。
    bo = bmesh.new()
    add_box(bo, 0, Vector((-w / 2 + 0.035, -d / 2 + 0.004, 0.012)),
            Vector((w / 2 - 0.035, -d / 2 + 0.055, 0.060)))
    parts.append(new_object('Air conditioner outlet', bo, [inlet]))
    # ルーバー1枚。わずかに前へ出して、切り欠きの中に見えるようにする。
    bl = bmesh.new()
    add_box(bl, 0, Vector((-w / 2 + 0.040, -d / 2 + 0.001, 0.020)),
            Vector((w / 2 - 0.040, -d / 2 + 0.017, 0.044)))
    parts.append(new_object('Air conditioner louver', bl, [louver]))
    # 運転表示。小さいが、これが無いと家電に見えない。
    bi = bmesh.new()
    add_box(bi, 0, Vector((w / 2 - 0.13, -d / 2 + 0.001, 0.070)),
            Vector((w / 2 - 0.09, -d / 2 + 0.007, 0.084)))
    parts.append(new_object('Air conditioner indicator', bi, [lamp]))

    join(body, parts)
    normalize_to(body, w, d, h)
    return body


def main(do_export=True, do_icons=True):
    made = []
    for stem, size in SIZES.items():
        clear_scene()
        obj = build_ac(*size)
        obj.name = stem
        vs = obj.data.vertices
        got = tuple(max(v.co[k] for v in vs) - min(v.co[k] for v in vs) for k in range(3))
        line = '  %-22s tris=%-5d %4.0f x %4.0f x %4.0f mm' % (
            stem, tri_count(obj), got[0] * 1000, got[1] * 1000, got[2] * 1000)
        for value, target, axis in zip(got, size, 'wdh'):
            assert abs(value * 1000 - target) < 1.0, \
                '%s の %s が %.1f mm。狙いは %d mm' % (stem, axis, value * 1000, target)
        if do_export:
            os.makedirs(WORK_DIR, exist_ok=True)
            import bpy
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK_DIR, stem + '.blend'))
            line += '  glb=%d bytes' % export(obj, os.path.join(OUT_DIR, stem + '.glb'))
        print(line, flush=True)
        if do_icons:
            previews = os.path.join(OUT_DIR, '..', 'previews-v2')
            render_top(obj, os.path.join(previews, stem + '-top.png'))
            render_thumb(obj, os.path.join(previews, stem + '-thumb.png'))
        made.append(obj)
    return made


if __name__ == '__main__':
    main(do_export='--no-export' not in sys.argv,
         do_icons='--no-icons' not in sys.argv)
