"""512px transparent icons, two-face proof and GLB replay for each mystery prop.

Blender --background --factory-startup --python tools/blender/rpg_mansion/mystery_props/render.py
Temporary proof PNGs are collated by validate.py; only concise sheets are retained.
"""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from build import ENTRIES,ROOT


def render(obj,path,view='front',transparent=True,size=512):
    for o in list(bpy.context.scene.objects):
        if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
    scene=bpy.context.scene;scene.render.engine='CYCLES'
    scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=scene.render.resolution_y=size;scene.render.resolution_percentage=100
    scene.render.film_transparent=transparent;scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Neutral mystery prop studio');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.42,.42,.42,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.7;scene.world=world
    bpy.context.view_layer.update()
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    lo=Vector([min(p[i] for p in points) for i in range(3)])
    hi=Vector([max(p[i] for p in points) for i in range(3)])
    dims=hi-lo;target=(lo+hi)/2;span=max(dims)
    if view=='top':location=target+Vector((0,0,span*3))
    else:location=target+Vector((span*.60,span*(-2.5 if view=='front' else 2.5),span*2.2))
    bpy.ops.object.camera_add(location=location);camera=bpy.context.object
    camera.rotation_euler=(target-location).to_track_quat('-Z','Y').to_euler()
    if view=='top':camera.rotation_euler=(0,0,0)
    camera.data.type='ORTHO'
    # Fit projected vertices rather than the largest world-space axis. A folded
    # card has an asymmetric projection; a world-axis estimate can crop a foot.
    rotation=camera.rotation_euler.to_matrix()
    right=rotation@Vector((1,0,0));up=rotation@Vector((0,1,0))
    xs=[(p-target).dot(right) for p in points];ys=[(p-target).dot(up) for p in points]
    camera.location+=right*((min(xs)+max(xs))/2)+up*((min(ys)+max(ys))/2)
    camera.data.ortho_scale=max(max(xs)-min(xs),max(ys)-min(ys))*1.14
    scene.camera=camera
    # Scale studio lights with the prop, so a 5cm object is not overexposed.
    for position,energy,area in [((span*2,-span*3,span*4),75,span*3),
                                 ((-span*2,span*2,span*3),55,span*2)]:
        bpy.ops.object.light_add(type='AREA',location=position);light=bpy.context.object
        light.data.energy=energy*span*span;light.data.size=area
        light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    path.parent.mkdir(parents=True,exist_ok=True)
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for stem,*_ in ENTRIES:
        if selected and stem not in selected:continue
        bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/(stem+'.blend')))
        obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        render(obj,ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-thumb.png'))
        render(obj,ROOT/'assets/models/packs/rpg-mansion/previews'/(stem+'-top.png'),'top')
        render(obj,Path('/tmp/webcad-mystery-proofs')/(stem+'-rear.png'),'rear')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/models/packs/rpg-mansion/models'/(stem+'.glb')))
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH'];assert len(objects)==1
        render(objects[0],Path('/tmp/webcad-mystery-proofs')/(stem+'-glb.png'))
        print('MYSTERY PROOF COMPLETE',stem,flush=True)
