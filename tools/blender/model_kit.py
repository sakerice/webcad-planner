"""カタログの自作モデルを組み、寸法・UV・部位を検査してから書き出す共通部品。

■ なぜ在るのか
  作る約束(座標・原点・正面・UV・面数)は `tools/blender/README.md` の
  「カタログのモデルを作るときの約束」にあるが、**約束を文章で置くだけでは
  守られない。** 実際に、寸法・正面・UV のどれも取りこぼした。
  ここは、その約束を1か所で機械に守らせる。`run()` を通していないモデルは、
  検査されていないモデルである。

■ run() が見ているもの(どれか1つでも外れると止まる)
    寸法        指定の w/d/h と 1mm 未満で一致する
    原点        XY は中心、Z=0 が接地面
    面数        1点あたりの上限(既定 3,000 三角形)
    多様体      開いた辺・孤立した辺が無い(葉のような薄板は個別に免除)
    UV          展開があり、三角形ごとの密度の 5/95 百分位の比が 2 未満
    部位        finishChannel が、狙ったものと過不足なく一致する

  **UV が無いと、アプリで素材を選んでも柄が出ない。** UV の無い面は同じ1点を
  参照するので単色になる。自作モデル63点がこの状態だったため、ここで必ず
  展開してから書き出す。

■ 出力先(既存モデルと共通)
    assets/models/original/<stem>.glb        出荷する本体
    assets/models/previews-v2/<stem>-*.png   一覧に出るサムネ
    tools/blender/work/original/<stem>.blend **編集できる元データ。必ず残す**
    tools/blender/work/original/<stem>-validation.json  上の検査結果

  .blend が1点ごとに在ることは tools/tests/original-models.test.cjs が見ている。
  GLB だけでは作り直せない。
"""
import json
import math
import statistics
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parents[1]
sys.path.insert(0, str(_HERE))
from exterior_build import matp, clear_scene, tri_count, render_top, render_thumb
from shape_kit import rounded_rect, join, export, unwrap

GLB_DIR = _ROOT / 'assets' / 'models' / 'original'
PREVIEW_DIR = _ROOT / 'assets' / 'models' / 'previews-v2'
WORK_DIR = _ROOT / 'tools' / 'blender' / 'work' / 'original'


def shell(name, rings, materials, bands):
    """Shared vertices, CCW rings: underside -> outside -> lip -> basin floor.

    Explicit profile rings bake the bevel into exportable geometry, avoiding
    modifier-dependent bounding boxes and preserving a broad flat seat rim.
    """
    n = len(rings[0])
    vertices = [tuple(v) for ring in rings for v in ring]
    faces = [tuple(reversed(range(n)))]
    for k in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((k*n+i, k*n+j, (k+1)*n+j, (k+1)*n+i))
    faces.append(tuple(range((len(rings)-1)*n, len(rings)*n)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for material in materials:
        mesh.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = p.index not in (0, len(mesh.polygons)-1)
        p.material_index = bands[min(max(0, (p.index-1)//n), len(bands)-1)]
    return obj

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bevel(obj, radius, segments=3):
    """角に物理的な丸みを付ける。

    **板物は、角を丸めないと紙に見える。** 実物の家具・建具には 2〜8mm の
    面取りがあり、そこだけが光を拾う。丸めたあとに Weighted Normal を
    掛けるのは、広い平面を平らなまま見せるため(掛けないと全体が緩く歪む)。
    """
    activate(obj)
    mod = obj.modifiers.new('Physical edge radius', 'BEVEL')
    mod.width = radius
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.update()
    mod = obj.modifiers.new('Keep broad faces planar', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    mod.weight = 50
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def box(name, lo, hi, material, radius=.003, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    # 寸法と位置を頂点へ焼く。**オブジェクトの変換は単位のまま残す。**
    # スケールを残すと、後段の UV 密度が実寸とずれる。
    for v in obj.data.vertices:
        v.co = Vector(tuple(lo[i] + (v.co[i] + .5) * (hi[i] - lo[i]) for i in range(3)))
    obj.data.materials.append(material)
    return bevel(obj, radius, segments) if radius else obj


def profile(name, rows, material, cy=0, n=5):
    """角の丸い断面を積んで、1枚の殻にする。行は 幅・奥行・XYの丸み・高さ。

    帯と蓋が頂点を共有するので、継ぎ目が出ない。陶器のように
    「接地部から縁を回って内鉢まで」が連続する形は、これで作る。
    """
    return shell(name, [rounded_rect(0, cy, w, d, r, z, n=n) for w, d, r, z in rows],
                 [material], [0] * (len(rows) - 1))


def cylinder(name, center, radius, length, material, axis='Z', sides=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=length,
                                        location=center)
    obj = bpy.context.object
    obj.name = name
    if axis == 'Y':
        obj.rotation_euler.x = math.pi / 2
    elif axis == 'X':
        obj.rotation_euler.y = math.pi / 2
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(material)
    return bevel(obj, min(.0015, length / 6), 2)


def combine(parts):
    return join(parts[0], parts[1:])


def uv_report(obj):
    """三角形ごとの「UV の1辺が実世界の何メートルか」を測る。

    **合計面積どうしで割ってはいけない。** アトラス(1枚の絵に部位を詰め込んだ
    UV)の外れ値に引きずられる。1.2m のクローゼットに repeat=15 が出て、
    板幅が10分の1になったことがある。中央値を採る。
    """
    obj.data.calc_loop_triangles()
    uv = obj.data.uv_layers.active.data
    densities = []
    degenerate_world = []
    degenerate_uv = []
    excluded = []
    for t in obj.data.loop_triangles:
        a, b, c = [uv[i].uv for i in t.loops]
        area = abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
        p, q, r = [obj.matrix_world @ obj.data.vertices[i].co for i in t.vertices]
        world = (q - p).cross(r - p).length / 2
        assert math.isfinite(world) and math.isfinite(area), ('面積が数値でない', t.index)
        if world <= 1e-14:
            degenerate_world.append(t.index)
        if area <= 1e-14:
            degenerate_uv.append(t.index)
        if world <= 1e-14 or area <= 1e-14:
            excluded.append(t.index)
            continue
        densities.append(math.sqrt(world / area))
    # **除いた数を必ず出す。** 「潰れた三角形は無視」とだけ書くと、
    # 全部潰れていても検査が通ってしまう。両方潰れた分は1回だけ数える。
    diagnostics = dict(total_triangles=len(obj.data.loop_triangles),
                       valid_triangles=len(densities), excluded_triangles=len(excluded),
                       degenerate_world=len(degenerate_world), degenerate_uv=len(degenerate_uv),
                       degenerate_world_indices=degenerate_world,
                       degenerate_uv_indices=degenerate_uv)
    print('UV三角形の内訳: ' + json.dumps(diagnostics), flush=True)
    assert densities, ('UV密度を測れる三角形が1つも無い', diagnostics)
    densities.sort()
    report = dict(meters_per_uv=statistics.median(densities),
                  min=densities[0], max=densities[-1],
                  p05=densities[int(.05 * (len(densities) - 1))],
                  p95=densities[int(.95 * (len(densities) - 1))])
    report.update(diagnostics)
    # 柄の大きさが場所で倍以上違うと、同じ板が別の材に見える。
    assert report['p95'] / report['p05'] < 2, report
    return report


def run(entries, do_export=None, do_icons=None):
    """(stem, 寸法mm, 組み立て関数[, 狙う部位, 面数の上限, 薄板を許すか]) を順に通す。

    狙う部位は文字列・集合・None。None は「部位を分けない」の意味で、
    finishChannel が1つでも付いていれば止める(付け忘れと、付けすぎの両方を見る)。
    """
    do_export = ('--no-export' not in sys.argv) if do_export is None else do_export
    do_icons = ('--no-icons' not in sys.argv) if do_icons is None else do_icons
    made = []
    for entry in entries:
        stem, size, builder = entry[:3]
        want_channels = entry[3] if len(entry) > 3 else None
        budget = entry[4] if len(entry) > 4 else 3000
        open_faces_ok = entry[5] if len(entry) > 5 else False

        clear_scene()
        bpy.context.scene.unit_settings.system = 'METRIC'
        obj = builder()
        obj.name = stem
        bpy.context.view_layer.update()

        # **obj.dimensions は使わない。** 頂点を直接動かした直後は、依存グラフが
        # 更新されるまで古い値を返す。実測で気づいた。
        points = [obj.matrix_world @ v.co for v in obj.data.vertices]
        lo = [min(p[i] for p in points) for i in range(3)]
        hi = [max(p[i] for p in points) for i in range(3)]
        dims = [(b - a) * 1000 for a, b in zip(lo, hi)]
        tris = tri_count(obj)
        for got, target, axis in zip(dims, size, 'wdh'):
            assert abs(got - target) < 1, \
                '%s の %s が %.1f mm。狙いは %d mm' % (stem, axis, got, target)
        # 原点は接地面の中心。ここがずれると、床に埋まるか浮く。
        assert max(abs(lo[i] + hi[i]) for i in (0, 1)) < 1e-6, (stem, lo, hi)
        assert abs(lo[2]) < 1e-6, (stem, lo)
        assert tris <= budget, ('%s が %d 三角形。上限は %d' % (stem, tris, budget))

        if not open_faces_ok:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            try:
                assert all(e.is_manifold for e in bm.edges), \
                    '%s に開いた辺がある(面の裏が見える)' % stem
            finally:
                bm.free()

        unwrap(obj)
        # glTF は先頭のUV層を TEXCOORD_0 として書き出す。2枚あると、
        # アプリ側では「UVが無い」のと同じ見え方(単色)になる。
        assert len(obj.data.uv_layers) == 1, \
            '%s のUV層が %d 枚' % (stem, len(obj.data.uv_layers))
        density = uv_report(obj)
        assert len([o for o in bpy.context.scene.objects if o.type == 'MESH']) == 1, \
            '%s が1つのオブジェクトに結合されていない' % stem

        channels = {m.name: m.get('finishChannel') for m in obj.data.materials}
        got_channels = set(v for v in channels.values() if v)
        want = (set() if want_channels is None else
                {want_channels} if isinstance(want_channels, str) else set(want_channels))
        assert got_channels == want, \
            '%s の部位が %s。狙いは %s' % (stem, sorted(got_channels), sorted(want))

        report = dict(model=stem, dimensions_mm=dims, bounds_m=[lo, hi], triangles=tris,
                      uv=density, materials=channels, front_blender='-Y', front_gltf='+Z')
        line = '  %-22s tris=%-5d %4.0f x %4.0f x %4.0f mm  UV=%.3f m' % (
            stem, tris, dims[0], dims[1], dims[2], density['meters_per_uv'])
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        if do_export:
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(WORK_DIR / (stem + '.blend')))
            report['glb_bytes'] = export(obj, str(GLB_DIR / (stem + '.glb')))
            line += '  glb=%d bytes' % report['glb_bytes']
        (WORK_DIR / (stem + '-validation.json')).write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        print(line, flush=True)
        if do_icons:
            PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
            render_top(obj, str(PREVIEW_DIR / (stem + '-top.png')))
            render_thumb(obj, str(PREVIEW_DIR / (stem + '-thumb.png')))
            # 背面は出荷しない。**作り手が裏を確かめるため**に work へ残す。
            obj.rotation_euler.z = math.pi
            bpy.context.view_layer.update()
            render_thumb(obj, str(WORK_DIR / (stem + '-rear.png')))
            obj.rotation_euler.z = 0
        made.append(obj)
    return made
