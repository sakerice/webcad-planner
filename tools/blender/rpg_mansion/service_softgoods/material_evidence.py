"""Visual channel-isolation witnesses from exact product GLBs; product bytes unchanged."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import *
PALETTE={'fabric':'#27bdca','metal':'#ee6334','wood':'#aa55db','hardware':'#f4cc32','border':'#d526ba','pattern':'#46b450','washsurface':'#27bdca'}
def srgb(x):return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4
rows=[]
for it in json.loads((HERE/'descriptors.json').read_text())['items']:
    path=HERE/it['model'];before=sha(path);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(path));obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];parts=[]
    for mat in bpy.data.materials:
        ch=mat.get('finishChannel');assert ch in PALETTE,(mat.name,ch)
        color=PALETTE[ch];rgb=[srgb(int(color[i:i+2],16)/255)for i in [1,3,5]];mat.diffuse_color=(*rgb,1)
        bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Base Color'].default_value=(*rgb,1)
        parts.append(dict(material=mat.name,channel=ch,witnessColor=color))
    output='evidence/'+it['id']+'-finish-channels.png';render(obs,HERE/output,'thumb')
    assert sha(path)==before;rows.append(dict(id=it['id'],sourceGlbSha256=before,usedMaterials=parts,witness=output,productBytesUnchanged=True))
(HERE/'reports'/'material-channel-witnesses.json').write_text(json.dumps(dict(note='Deliberately false-colored render-only witnesses. Original product materials and GLB bytes unchanged.',items=rows),indent=2)+'\n')
