"""室内建具(開き戸の扉板)を組み立てる。

作る約束(座標・原点・正面・UV・面数・登録)は tools/blender/README.md の
「カタログのモデルを作るときの約束」。検査は model_kit.run() が全点に掛ける。

  Blender --background --factory-startup --python tools/blender/build_doors.py [-- --no-icons]

■ 寸法(mm)
  original-door-flush 755x70x1990  フラット扉
  original-door-slit  755x70x1990  採光型(貫通した3本のスリット)

  採光型は、**3つの穴の周りを頂点で繋いで1枚の板にする**。面を選んで
  開けると桟に継ぎ目が出る。レバーと丁番は両面に付き、丁番は幅の内側へ収める
  (元の建具は幅の外へ4mm出ていて、壁に食い込んでいた)。
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403


W, D, H = .755, .070, 1.990


def leaf(wood, slits):
    # Structured front/back grid; omitted cells become windows. Shared indices
    # avoid seams between rails/stiles. Only exposed boundaries get reveal faces.
    xs = [-W/2, -.2625, -.2105, -.1805, -.1285, -.0985, -.0465, W/2] if slits else [-W/2,W/2]
    zs = [0,.55,H-.30,H] if slits else [0,H]
    nx, nz = len(xs), len(zs)
    verts = [(x,y,z) for y in (-.018,.018) for z in zs for x in xs]
    def idx(side,i,j):
        return side*nx*nz+j*nx+i
    cells = {(i,j) for i in range(nx-1) for j in range(nz-1)
             if not (slits and j == 1 and i in (1,3,5))}
    faces = []
    for i,j in sorted(cells):
        a,b,c,d = [idx(0,u,v) for u,v in ((i,j),(i+1,j),(i+1,j+1),(i,j+1))]
        shift = nx*nz
        faces.extend([(a,b,c,d), (d+shift,c+shift,b+shift,a+shift)])
        for ni,nj,u,v in ((i,j-1,a,b),(i+1,j,b,c),(i,j+1,c,d),(i-1,j,d,a)):
            if (ni,nj) not in cells:
                faces.append((v,u,u+shift,v+shift))
    mesh = bpy.data.meshes.new('Continuous leaf with reveals')
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj = bpy.data.objects.new('Door face',mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(wood)
    return bevel(obj,.0025,3)


def build_door(slits):
    wood = matp('Door face','#c7a883',rough=.5)
    wood['finishChannel'] = 'wood'
    metal = matp('Door hardware','#9ea2a6',rough=.3,metal=.85)
    glass = matp('Door glass','#cfd9dd',rough=.08,metal=0)
    parts = [leaf(wood,slits)]
    if slits:
        for x in (-.2625,-.1805,-.0985):
            parts.append(box('Door glass',(x,-.006,.55),(x+.052,.006,H-.30),glass,.0015,2))
    x = W/2-.075
    for sign in (-1,1):
        parts.append(cylinder('Door rose',(x,sign*.022,1),.027,.008,metal,axis='Y'))
        # Broad rounded lever faces reach exactly +/-35 mm. No faceted tube
        # defines the bounding box, and the spindle stays inside these faces.
        ys = sorted((sign*.020,sign*.035))
        parts.append(box('Door lever',(x-.101,ys[0],.990),(x+.010,ys[1],1.010),metal,.006,3))
    for z in (.28,H/2,H-.28):
        parts.append(box('Door hinge',(-W/2,-.013,z-.046),(-W/2+.020,.013,z+.046),metal,.002,2))
    return combine(parts)


if __name__ == '__main__':
    run([('original-door-flush', (755, 70, 1990), lambda: build_door(False), 'wood'),
         ('original-door-slit', (755, 70, 1990), lambda: build_door(True), 'wood')])
