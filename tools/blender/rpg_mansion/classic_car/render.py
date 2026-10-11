"""Render only the new sedan. Evidence is loaded from the delivered GLB.

blender -b -t 4 --factory-startup --python tools/blender/rpg_mansion/classic_car/render.py
"""
import json
import hashlib
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = Path(os.environ.get('WEBCAD_CAR_OUTPUT_ROOT',ROOT)).resolve()
WORK = OUT/'tools/blender/rpg_mansion/classic_car'
PACK = OUT/'assets/models/packs/rpg-mansion'
ID = 'rpg-mansion-classic-sedan-01'


def aim(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def setup():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('Sedan studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.76,.80,.85,1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .35
    scene.world = world
    for name,loc,energy,size in [
            ('Soft key',(3,-4,6),750,5),('Broad fill',(-4,-1,3.5),420,4),
            ('Rear rim',(2,5,4.5),800,3.8)]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
        aim(light,(0,0,.7))
    bpy.ops.object.camera_add()
    scene.camera = bpy.context.object
    scene.camera.data.type = 'ORTHO'
    scene.render.resolution_percentage = 100
    return scene


def shot(scene,path,position,target,scale,resolution):
    camera = scene.camera
    camera.location = position
    camera.data.ortho_scale = scale
    aim(camera,target)
    scene.render.resolution_x,scene.render.resolution_y = resolution
    path.parent.mkdir(parents=True,exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    if '--authoring' in sys.argv:
        bpy.ops.wm.open_mainfile(filepath=str(WORK/(ID+'-authoring.blend')))
    else:
        bpy.ops.import_scene.gltf(filepath=str(PACK/'models'/(ID+'.glb')))
        # Blender importer maps glTF +Y-up back to native Z-up automatically.
    scene = setup()
    shot(scene,PACK/'previews'/(ID+'-thumb.png'),(5.4,-8.1,4.0),(0,0,.76),5.0,(512,512))
    shot(scene,PACK/'previews'/(ID+'-top.png'),(0,0,8),(0,0,0),5.05,(512,512))
    evidence = WORK/'evidence'
    shot(scene,evidence/(ID+'-front.png'),(0,-8,2.35),(0,-.20,.78),3.0,(768,768))
    shot(scene,evidence/(ID+'-side.png'),(8,0,2.35),(0,0,.76),5.10,(1024,640))
    shot(scene,evidence/(ID+'-rear.png'),(4.8,7.8,3.4),(0,.15,.78),5.0,(768,768))
    shot(scene,evidence/(ID+'-front-right.png'),(5.4,-8.1,2.7),(0,-.1,.72),4.95,(1024,768))
    shot(scene,evidence/(ID+'-front-left.png'),(-5.4,-8.1,2.7),(0,-.1,.72),4.95,(1024,768))
    # Evidence is clearly named as Blender GLB readback, never browser runtime QA.
    (WORK/'render-record.json').write_text(json.dumps({
        'source':'delivered GLB readback' if '--authoring' not in sys.argv else 'authoring draft',
        'glb_sha256':hashlib.sha256((PACK/'models'/(ID+'.glb')).read_bytes()).hexdigest() if '--authoring' not in sys.argv else None,
        'blender':bpy.app.version_string,'renderer':'Cycles CPU','samples':scene.cycles.samples,
        'browser_test':'not performed; browser operation prohibited',
        'views':['transparent thumbnail','transparent top','front','side','rear','front-right','front-left'],
    },indent=2)+'\n')


if __name__ == '__main__':
    main()
