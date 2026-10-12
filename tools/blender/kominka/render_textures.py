"""Render the delivered diffuse/normal/roughness JPEGs on physical 2x2 tiles.
Only this set's own procedural textures are read. Blender CLI, no browser.
"""
import json,sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sys.path.insert(0,str(HERE))
from render import render
for it in json.loads((HERE/'catalogue.json').read_text())['textures']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    size=it['tileMm']/1000*2
    bpy.ops.mesh.primitive_plane_add(size=size)
    obj=bpy.context.object
    obj.name=it['key']+' 2x2 physical tiles'
    for loop in obj.data.uv_layers.active.data:loop.uv*=2
    mat=bpy.data.materials.new(it['key']);mat.use_nodes=True
    obj.data.materials.append(mat)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    for suffix,socket in [('diffuse','Base Color'),('roughness','Roughness'),('normal','Normal')]:
        image=bpy.data.images.load(str(ROOT/'assets/textures/kominka'/f'{it["key"]}_{suffix}.jpg'))
        image.colorspace_settings.name='sRGB' if suffix=='diffuse' else 'Non-Color'
        tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.extension='REPEAT'
        if suffix=='normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65
            links.new(tex.outputs['Color'],normal.inputs['Color'])
            links.new(normal.outputs['Normal'],bsdf.inputs[socket])
        else:links.new(tex.outputs['Color'],bsdf.inputs[socket])
    render(obj,HERE/'evidence'/f'{it["key"]}-pbr.jpg','thumb',32)
    print('PBR '+it['key'],flush=True)
