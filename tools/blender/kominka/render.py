"""Render the saved editable originals, never substitutes or mockups.
Blender -b --factory-startup -P tools/blender/kominka/render.py
-- --only chair --root /tmp/kominka-replay --samples 32
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]


def render(obj, path, view, samples):
    for o in list(bpy.context.scene.objects):
        if o != obj: bpy.data.objects.remove(o,do_unlink=True)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.cycles.samples=samples
    scene.cycles.use_denoising=True
    scene.cycles.use_adaptive_sampling=True
    scene.cycles.adaptive_threshold=.045
    scene.render.resolution_x=scene.render.resolution_y=512
    scene.render.resolution_percentage=100
    png=path.suffix=='.png'
    scene.render.film_transparent=png
    scene.render.image_settings.file_format='PNG' if png else 'JPEG'
    scene.render.image_settings.color_mode='RGBA' if png else 'RGB'
    scene.render.image_settings.color_depth='8'
    scene.render.image_settings.quality=85
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=-.45
    world=bpy.data.worlds.new('Kominka review world')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.81,.82,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.60
    scene.world=world
    bpy.context.view_layer.update()
    points=[obj.matrix_world@v.co for v in obj.data.vertices]
    lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    span=max(hi-lo);center=(lo+hi)/2
    if view=='top':direction=Vector((0,0,1));center.z=hi.z/2
    elif view=='front':direction=Vector((0,-1,0))
    elif view=='rear':direction=Vector((0,1,0))
    else:direction=Vector((.76,-1.25,.90)).normalized()
    bpy.ops.object.camera_add(location=center+direction*span*3)
    cam=bpy.context.object
    cam.rotation_mode='XYZ'
    # Avoid the signed-zero roll ambiguity when tracking straight down.
    cam.rotation_euler=(0,0,0) if view=='top' else (-direction).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO'
    bpy.context.view_layer.update()
    if view=='top':
        assert cam.matrix_world[0][0]>.999 and cam.matrix_world[1][1]>.999
    inv=cam.matrix_world.inverted()
    screen=[inv@p for p in points]
    ranges=[max(p[i] for p in screen)-min(p[i] for p in screen) for i in (0,1)]
    # Shift projected midpoint to frame center; gives consistent uncropped margins.
    sx=(max(p.x for p in screen)+min(p.x for p in screen))/2
    sy=(max(p.y for p in screen)+min(p.y for p in screen))/2
    cam.location+=cam.rotation_euler.to_matrix()@Vector((sx,sy,0))
    cam.data.ortho_scale=max(ranges)*1.12
    cam.data.clip_start=.001
    cam.data.clip_end=100
    scene.camera=cam
    for name,direction,energy,size in [('Key',(-1.7,-2.0,3.3),280,2.4),
         ('Fill',(2.4,-.4,1.7),110,2.2),('Rim',(.1,2.0,2.8),210,1.8)]:
        bpy.ops.object.light_add(type='AREA',location=center+Vector(direction)*span)
        light=bpy.context.object
        light.name=name
        light.data.energy=energy*span*span
        light.data.shape='DISK'
        light.data.size=size*span
        light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
    path.parent.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--only',nargs='+')
    p.add_argument('--root',type=Path,default=ROOT)
    p.add_argument('--samples',type=int,default=32)
    p.add_argument('--views',nargs='+',choices=('thumb','top','front','rear'),default=['thumb','top','front','rear'])
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    items=json.loads((HERE/'catalogue.json').read_text())['items']
    for it in items:
        if a.only and it['stem'] not in a.only:continue
        mid='kominka-'+it['stem']+'-01'
        source=a.root/'tools/blender/kominka/sources'/f'{mid}.blend'
        print('RENDER '+mid,flush=True)
        bpy.ops.wm.open_mainfile(filepath=str(source))
        obj=bpy.data.objects[mid]
        for view in a.views:
            path=(a.root/'assets/models/packs/kominka/previews'/f'{mid}-{view}.png'
                  if view in ('thumb','top') else
                  a.root/'tools/blender/kominka/evidence'/f'{mid}-{view}.jpg')
            render(obj,path,view,a.samples)
        if 'category' in it and 'front' in a.views:
            for key,sx,sz in [('w120-h80',1.20,.80),('w80-h120',.80,1.20)]:
                obj.scale=(sx,1,sz)
                render(obj,a.root/'tools/blender/kominka/evidence'/f'{mid}-{key}.jpg','front',a.samples)
            obj.scale=(1,1,1)

if __name__=='__main__':main()
