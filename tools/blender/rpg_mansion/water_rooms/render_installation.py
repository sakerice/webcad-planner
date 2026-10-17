"""Actual source geometry installation and cutaway evidence; fixtures not assets."""
from pathlib import Path
import sys,json,math
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3];sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parents[1])]
import bpy,bmesh
from mathutils import Vector
from build import render
from png_metadata import strip_metadata

def evidence(ob,item,section=False):
    bpy.ops.scene.new(type='NEW');scene=bpy.context.scene;scene.name='QA installation fixture, excluded from asset count'
    dup=ob.copy();dup.data=ob.data.copy();scene.collection.objects.link(dup);off=Vector(item['installationDatums']['bottomCenterTranslationBlenderM'])
    cutmat=bpy.data.materials.new('QA exposed cut face');cutmat.diffuse_color=(.49,.18,.06,1);cutmat.use_nodes=True;cutmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.49,.18,.06,1)
    if section:
        axis=1 if item['kind']=='bathtub' else 0
        plane=off.copy();plane[axis]=off[axis]
        normal=Vector((0,1,0))if axis==1 else Vector((1,0,0))
        bm=bmesh.new();bm.from_mesh(dup.data);geom=list(bm.verts)+list(bm.edges)+list(bm.faces)
        cut=bmesh.ops.bisect_plane(bm,geom=geom,dist=1e-7,plane_co=plane,plane_no=normal,clear_inner=False,clear_outer=True)
        edges=[e for e in cut['geom_cut']if isinstance(e,bmesh.types.BMEdge)and e.is_boundary]
        # Fill each cut surface loop. The slice is QA-only, never a delivered model.
        dup.data.materials.append(cutmat)
        filled=bmesh.ops.holes_fill(bm,edges=edges,sides=0)
        for f in filled.get('faces',[]):f.material_index=len(dup.data.materials)-1;f.smooth=False
        bm.to_mesh(dup.data);bm.free();dup.data.update()
    elevation=item['defaultElevation']/1000;dup.location.z=elevation
    gray=bpy.data.materials.new('QA wall fixture');gray.diffuse_color=(.24,.27,.28,1);gray.use_nodes=True;gray.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.24,.27,.28,1);gray.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9
    def slab(name,center,size):
        bpy.ops.mesh.primitive_cube_add(size=1,location=center);p=bpy.context.object;p.name='QA ONLY '+name;p.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);p.data.materials.append(gray);return p
    datum=item['installationDatums']['installation'];w=item['w']/1000;d=item['d']/1000;h=item['h']/1000+elevation
    if not section:
        slab('floor fixture excluded from model count',(0,0,-.025),(w+.30,d+.23,.05))
        if 'wallContactPlaneGltfZ'in datum:
            wy=-datum['wallContactPlaneGltfZ'];slab('wall fixture excluded from model count',(0,wy+.035,h/2),(max(w+.24,.86),.07,h+.15))
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('QA neutral world');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
    bpy.context.view_layer.update()
    pts=[o.matrix_world@v.co for o in scene.objects if o.type=='MESH'for v in o.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);target=(lo+hi)/2;span=max(hi-lo)
    for name,energy,loc in [('QA key',400,(span*2,-span*3,span*3)),('QA fill',200,(-span*2,-span,span*2))]:
        bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=energy;lamp.data.size=span*3;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    if section:loc=(0,span*4,target.z)if item['kind']=='bathtub'else(span*4,0,target.z)
    else:loc=(span*2.5,-span*4,span*1.8)
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam;basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));projected=[(p.dot(right),p.dot(up))for p in pts];low=[min(p[i]for p in projected)for i in range(2)];high=[max(p[i]for p in projected)for i in range(2)];center=[(low[i]+high[i])/2 for i in range(2)];cam.location+=right*(center[0]-target.dot(right))+up*(center[1]-target.dot(up));cam.data.ortho_scale=max(high[i]-low[i]for i in range(2))/.88
    path=HERE/'evidence'/(item['id']+('-section.png'if section else'-installation.png'));scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(scene)

for item in json.loads((HERE/'descriptors.json').read_text())['items']:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/item['sourceBlend']),load_ui=False);ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    evidence(ob,item,False);evidence(ob,item,True)
    print('WATER_INSTALLATION_RENDERED',item['id'],flush=True)
