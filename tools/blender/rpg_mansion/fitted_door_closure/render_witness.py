"""Reimport the actual GLB; edit one finish channel at a time for visual QA."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build import *
def main():
    report=[];model=HERE/'models'/(ID+'.glb')
    for channel in [None,'wood','trim','metal']:
        bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(model));obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(obs)==1
        before={m.name:tuple(m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)for m in obs[0].data.materials};changed=[];color=[.07,.37,.68,1]
        if channel:
            for m in obs[0].data.materials:
                if m.get('finishChannel')==channel:m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color;changed.append(m.name)
        after={m.name:tuple(m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)for m in obs[0].data.materials};assert set(k for k in before if before[k]!=after[k])==set(changed)
        path=HERE/'evidence'/('actual-glb-finish-'+(channel or'baseline')+'.png');render(obs,path,(1.3,-4,.6),640);record_binding(model,path,(1.3,-4,.6),640,finish_override=dict(channel=channel,color=color)if channel else None)
        report.append(dict(channel=channel,editedMaterialNames=changed,unselectedMaterialValuesPreserved=True,modelSha256=sha(model),image=str(path.relative_to(HERE)),imageSha256=sha(path)))
    (HERE/'reports/finish-channel-witness.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
