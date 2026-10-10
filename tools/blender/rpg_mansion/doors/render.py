"""Final door icons, two-face source proofs, GLB reimport and stretch proofs.

Blender --background --factory-startup --python tools/blender/rpg_mansion/doors/render.py
Temporary replay/stretch images stay in /tmp; make_sheets.py retains just two sheets.
"""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from build import IDS,ROOT


def setup(obj,side='front',size=512,transparent=True):
    for o in list(bpy.context.scene.objects):
        if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=scene.render.resolution_y=size
    scene.render.resolution_percentage=100
    scene.render.film_transparent=transparent
    scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Neutral proof studio')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.55,.55,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.65
    scene.world=world
    bpy.context.view_layer.update()
    pts=[obj.matrix_world @ v.co for v in obj.data.vertices]
    lo=Vector([min(p[i] for p in pts) for i in range(3)])
    hi=Vector([max(p[i] for p in pts) for i in range(3)])
    dims=hi-lo;target=(lo+hi)/2
    if side=='top':
        location=Vector((0,0,hi.z+4))
        scale=max(dims.x,dims.y)*1.10
    else:
        sign=-1 if side=='front' else 1
        location=target+Vector((dims.z*.35,sign*dims.z*2.8,dims.z*.42))
        scale=dims.z*1.12
    bpy.ops.object.camera_add(location=location)
    cam=bpy.context.object
    cam.rotation_euler=(target-location).to_track_quat('-Z','Y').to_euler()
    if side=='top':cam.rotation_euler=(0,0,0)
    cam.data.type='ORTHO';cam.data.ortho_scale=scale
    scene.camera=cam
    for name,position,energy,area in [('Key',(2,-4,5),650,4),('Fill',(-3,1,3),450,3),('Rear',(2,4,4),650,4)]:
        bpy.ops.object.light_add(type='AREA',location=position)
        light=bpy.context.object;light.name=name;light.data.energy=energy;light.data.shape='DISK';light.data.size=area
        light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    return scene


def render(obj,path,side,size=512,transparent=True):
    scene=setup(obj,side,size,transparent)
    path.parent.mkdir(parents=True,exist_ok=True)
    scene.render.image_settings.file_format='PNG' if path.suffix=='.png' else 'JPEG'
    scene.render.image_settings.color_mode='RGBA' if path.suffix=='.png' else 'RGB'
    scene.render.image_settings.quality=90
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    for stem in IDS:
        bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/(stem+'.blend')))
        obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        if '--stretch-only' not in sys.argv:
            render(obj,ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-thumb.png'),'front')
            render(obj,ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-top.png'),'top')
            for side in ('front','rear'):
                render(obj,HERE/'evidence'/(stem+'-'+side+'.jpg'),side,768,False)
        for label,sx,sz in [('wide-short',1.2,.8),('narrow-tall',.8,1.2)]:
            obj.scale=(sx,1,sz)
            render(obj,Path('/tmp/webcad-door-proofs')/(stem+'-'+label+'.jpg'),'front',512,False)
        if '--stretch-only' in sys.argv:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/packs/rpg-mansion/models'/(stem+'.glb')))
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
        assert len(objects)==1
        render(objects[0],Path('/tmp/webcad-door-proofs')/(stem+'-glb-front.jpg'),'front',512,False)
        print('DOOR PROOF COMPLETE',stem,flush=True)
