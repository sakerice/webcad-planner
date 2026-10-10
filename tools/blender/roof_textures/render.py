"""Blender PBR 2x2 proof of the shipped JPEGs; intermediate files stay in /tmp.

Blender --background --factory-startup --python tools/blender/roof_textures/render.py
"""
import json
from pathlib import Path
import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]


def make(spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    side=spec['tile_mm']/1000*2
    bpy.ops.mesh.primitive_plane_add(size=side)
    obj=bpy.context.object
    for uv in obj.data.uv_layers.active.data:uv.uv*=2
    m=bpy.data.materials.new(spec['key']);m.use_nodes=True
    nodes=m.node_tree.nodes;links=m.node_tree.links
    b=nodes.get('Principled BSDF')
    for name in ('diffuse','normal','roughness'):
        t=nodes.new('ShaderNodeTexImage')
        t.image=bpy.data.images.load(str(ROOT/'assets/textures/roof'/(spec['key']+'_'+name+'.jpg')))
        t.extension='REPEAT'
        if name!='diffuse':t.image.colorspace_settings.name='Non-Color'
        if name=='normal':
            n=nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=1
            links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],b.inputs['Normal'])
        else:links.new(t.outputs['Color'],b.inputs['Base Color' if name=='diffuse' else 'Roughness'])
    b.inputs['Metallic'].default_value=.72 if spec['kind']=='seam' else .38 if spec['kind']=='copper' else 0
    obj.data.materials.append(m)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=scene.render.resolution_y=768;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Neutral daylight');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.6;scene.world=world
    bpy.ops.object.light_add(type='AREA',location=(-side*.6,-side*.45,side*1.3))
    light=bpy.context.object;light.data.energy=700;light.data.size=side*.75
    light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(side*.22,-side*.90,side*1.2))
    camera=bpy.context.object;camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=side*1.40;scene.camera=camera
    scene.render.image_settings.file_format='JPEG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.quality=90
    out=Path('/tmp/webcad-roof-proofs');out.mkdir(exist_ok=True)
    scene.render.filepath=str(out/(spec['key']+'.jpg'))
    bpy.ops.render.render(write_still=True)
    print('PBR PROOF COMPLETE',spec['key'],flush=True)


if __name__=='__main__':
    for spec in json.loads((HERE/'validation.json').read_text())['textures']:make(spec)
