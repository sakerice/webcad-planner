"""Replay close views from the saved, actual-GLB proofs; no geometry edits."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import *
from build import sha
from png_metadata import strip_metadata
OUT=HERE/'installation_proofs'

def detail(source,name,target,offset,scale,hide_ground=False):
    if '--gate-only' in sys.argv and not name.startswith(('detail-hinge','detail-strike')):
        prior=json.loads((OUT/'detail-view-replay.json').read_text());return next(i for i in prior if i['file']==name+'.png')
    bpy.ops.wm.open_mainfile(filepath=str(OUT/source));sc=bpy.context.scene
    if hide_ground:
        for ob in sc.objects:
            if ob.get('excludedProofFixture'):ob.hide_render=True
    sc.render.engine='CYCLES';sc.cycles.samples=64;sc.cycles.use_denoising=False;sc.render.resolution_x=sc.render.resolution_y=768;sc.render.resolution_percentage=100;sc.render.film_transparent=True;sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Detail neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;sc.world=world;sc.view_settings.view_transform='AgX';target=Vector(target)
    for loc,power,size in [((3,-4,6),650,5),((-3,-2,3),350,4),((1,4,5),300,4)]:
        bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=size;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=target+Vector(offset));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=scale;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
    p=OUT/(name+'.png');sc.render.filepath=str(p);bpy.ops.render.render(write_still=True);strip_metadata(p)
    return dict(file=p.name,sha256=sha(p),source=source,sourceSha256=sha(OUT/source),targetBlenderM=list(target),offsetBlenderM=offset,orthoScaleM=scale,excludedFixturesHidden=hide_ground,geometryAltered=False)

rows=[]
rows.append(detail('gate-leaf-between-accepted-piers.blend','detail-hinge-bearing',(0,0,1.179),(.35,-.60,.28),.23))
rows.append(detail('gate-leaf-between-accepted-piers.blend','detail-strike-socket',(1.175,-.045,1.17),(-.42,-.6,.3),.23))
rows.append(detail('terrace-step-doorway-threshold.blend','detail-terrace-underframe',(0,-.15,.18),(2.5,-3.5,-1.5),2.75,True))
rows.append(detail('terrace-step-fixed-window-threshold.blend','detail-window-nose-recess',(0,.865,.278),(1.5,-1.8,-.80),1.36,True))
rows.append(detail('terrace-step-doorway-threshold.blend','detail-step-level-joint',(0,-.90,.295),(1.3,-1.3,.65),1.40))
(OUT/'detail-view-replay.json').write_text(json.dumps(rows,indent=2)+'\n')
