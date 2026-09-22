"""水まわり・住設のモデルを組むための共通部品。

■ なぜ在るのか
  角丸の輪をロフトする組み方は、浴槽の縁も便器の鉢もエアコンの筐体も同じ
  やり方で作れる。スクリプトごとに書き写すと、Rの取り方や面の向きが少しずつ
  食い違って、同じ「角丸の箱」なのに見え方が揃わなくなる。

  glTF の extras を載せる書き出しもここに置く。`export_extras=True` を
  落とすと、色を変えられる部位(finishChannel)の情報ごと消える。
"""
import math
import os

import bpy
from mathutils import Vector

# ── 角丸の輪郭とロフト ──────────────────────────────────────────
#
# 水まわりは角が丸い。直方体で作ると、3Dで見たときに「箱」にしか見えない。
# 角丸の輪を高さ違いで並べて、輪と輪を面でつなぐ(ロフト)と、縁のある浴槽も
# 便器の鉢も同じやり方で作れる。
def rounded_rect(cx, cy, w, d, r, z, n=6):
    """角丸長方形の頂点列。角ごとに n 分割する。"""
    hw, hd = w / 2 - r, d / 2 - r
    pts = []
    for sx, sy, start in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(n + 1):
            a = math.radians(start + k * 90 / n)
            pts.append(Vector((cx + sx * hw + r * math.cos(a),
                               cy + sy * hd + r * math.sin(a), z)))
    # 角の継ぎ目で同じ点が重なるので間引く
    out = []
    for p in pts:
        if not out or (p - out[-1]).length > 1e-6:
            out.append(p)
    return out


def loft(bm, mat_index, lower, upper):
    """2つの輪を面でつなぐ。輪の頂点数は同じであること。"""
    a = [bm.verts.new(p) for p in lower]
    b = [bm.verts.new(p) for p in upper]
    for i in range(len(a)):
        j = (i + 1) % len(a)
        bm.faces.new((a[i], a[j], b[j], b[i])).material_index = mat_index
    return a, b


def cap(bm, mat_index, ring, flip=False):
    """輪を1枚の面でふさぐ。"""
    vs = [bm.verts.new(p) for p in ring]
    bm.faces.new(vs[::-1] if flip else vs).material_index = mat_index
    return vs



def export(obj, path):
    """GLBへ書き出す。**extras を載せる**ところだけ exterior_build と違う。

    色を変えられる部位は、マテリアルの `finishChannel` で示す。これは glTF の
    materials[].extras に入り、three.js が material.userData へ移す
    (assets/js/model-quality.js の applyFinishes が読む)。`export_extras=True`
    を落とすと extras ごと消え、扉の色が変えられなくなる。
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, use_selection=True, export_format='GLB',
        export_apply=True, export_yup=True, export_animations=False,
        export_skins=False, export_morph=False, export_extras=True,
        export_texture_dir='')
    return os.path.getsize(path)

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def join(target, others):
    """others を target へ統合する。マテリアルは維持される。"""
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    if others:
        bpy.ops.object.join()
    return target


