"""Replay exact saved-source/GLB camera recipes without rebuilding geometry or saving sources."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import *
def main():
    rows=json.loads((HERE/'reports/render-bindings.json').read_text());out=HERE/'reports/image-replay';out.mkdir(exist_ok=True);report=[]
    only=sys.argv[sys.argv.index('--only')+1]if '--only'in sys.argv else None
    for row in rows:
        if only and only not in row['image']:continue
        source=HERE/row['source'];assert sha(source)==row['sourceSha256'];r=row['recipe'];bpy.ops.wm.read_factory_settings(use_empty=True)
        if source.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(source))
        else:bpy.ops.import_scene.gltf(filepath=str(source))
        obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];edit=r.get('finishOverride')
        if edit:
            for ob in obs:
                for m in ob.data.materials:
                    if m.get('finishChannel')==edit['channel']:m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=edit['color']
        image=out/Path(row['image']).name;render(obs,image,r['delta'],r['resolution'],target=r['target'],scale=r['orthoScale']);report.append(dict(source=row['source'],image=row['image'],sourceHashStillExact=sha(source)==row['sourceSha256'],recordedImageHash=row['imageSha256'],replayedImageHash=sha(image),exactPngHashMatch=sha(image)==row['imageSha256']))
    (HERE/'reports/image-replay-results.json').write_text(json.dumps(report,indent=2)+'\n');assert all(r['sourceHashStillExact']and r['exactPngHashMatch']for r in report)
if __name__=='__main__':main()
