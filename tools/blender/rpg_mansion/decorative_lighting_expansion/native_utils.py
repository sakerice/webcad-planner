"""Sofa-local strict metre UV unfolding, active export and saved UI sanitation.

Metric quad unfolding follows the prior kitchen family's actual-diagonal repair.
Every polygon becomes a separately packed chart, preserving native topology.
No external geometry, imagery, or imported libraries are used.
"""
import math, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector

def positive_winding(ob,repair=True):
    bm=bmesh.new();bm.from_mesh(ob.data)
    if repair:bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    assert all(e.is_manifold for e in bm.edges),ob.name
    assert all(e.is_contiguous for e in bm.edges),(ob.name,'Inconsistent adjacent face orientation')
    remain=set(bm.faces);volumes=[]
    while remain:
        seed=remain.pop();todo=[seed];faces={seed}
        while todo:
            face=todo.pop()
            for e in face.edges:
                for f in e.link_faces:
                    if f in remain:remain.remove(f);faces.add(f);todo.append(f)
        volume=sum(v[0].co.dot(v[1].co.cross(v[2].co))/6 for f in faces for v in [(f.verts[0],f.verts[i],f.verts[i+1]) for i in range(1,len(f.verts)-1)])
        if volume<0 and repair:bmesh.ops.reverse_faces(bm,faces=list(faces));volume=-volume
        assert volume>1e-12,(ob.name,volume)
        volumes.append(volume)
    if repair:bm.to_mesh(ob.data);ob.data.update()
    bm.free();return volumes

def metric_uv(ob):
    mesh=ob.data;mesh.calc_loop_triangles()
    layer=mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
    tri={}
    for t in mesh.loop_triangles:tri.setdefault(t.polygon_index,[]).append(tuple(t.vertices))
    columns=max(1,math.ceil(math.sqrt(len(mesh.polygons))))
    # Compact two-dimensional staging avoids float32 loss from chart offsets
    # thousands of metres wide, which can invert tiny concave-cap UV slivers.
    for chart,p in enumerate(mesh.polygons):
        ids=[mesh.loops[i].vertex_index for i in p.loop_indices];point={i:ob.matrix_world@mesh.vertices[i].co for i in ids}
        pair=tri[p.index]
        if len(ids)==4 and len(pair)==2:
            shared=set(pair[0])&set(pair[1]);a,b=sorted(shared);c=next(v for v in pair[0]if v not in shared);d=next(v for v in pair[1]if v not in shared)
            length=(point[b]-point[a]).length
            sign=1 if any(tuple(pair[0][k:]+pair[0][:k])==(a,b,c)for k in range(3))else -1
            coords={a:(0.,0.),b:(length,0.)}
            for index,direction in [(c,sign),(d,-sign)]:
                ac=(point[index]-point[a]).length;bc=(point[index]-point[b]).length
                x=(ac*ac+length*length-bc*bc)/(2*length);height=math.sqrt(max(0.,ac*ac-x*x))
                assert height>1e-10,(ob.name,p.index)
                coords[index]=(x,direction*height)
            xy=[coords[i]for i in ids]
        else:
            pts=[point[i]for i in ids];edges=[pts[(i+1)%len(pts)]-pts[i]for i in range(len(pts))]
            u=max(edges,key=lambda e:e.length).normalized();n=(ob.matrix_world.to_3x3().inverted().transposed()@p.normal).normalized();v=n.cross(u).normalized()
            xy=[(q.dot(u),q.dot(v))for q in pts]
        lo=[min(q[i]for q in xy)for i in range(2)]
        for i,(a,b)in zip(p.loop_indices,xy):layer.data[i].uv=(a-lo[0]+3*(chart%columns),b-lo[1]+3*(chart//columns))
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True,margin=.004);bpy.ops.object.mode_set(mode='OBJECT')
    mesh.uv_layers.active.active_render=True;mesh.update()
    for old in list(mesh.uv_layers)[1:]:mesh.uv_layers.remove(old)
    return ob

def export_active(ob,path):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,use_active_scene=True,export_format='GLB',export_apply=True,export_yup=True,export_animations=False,export_skins=False,export_morph=False,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT')
    return path.stat().st_size

def sanitize(asset_id):
    for scene in bpy.data.scenes:
        scene.render.filepath='//renders/'+asset_id+'.png'
        scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type!='FILE_BROWSER':continue
                if space.params:
                    space.params.directory=b'//'+b' '*1021;space.params.directory=b'//'
                    space.params.filename='';space.params.filter_search=''
                for key in ['bookmarks','recent_folders']:
                    for bookmark in getattr(space,key):
                        if bookmark.path:bookmark.path='//'
    assert not bpy.data.libraries
    assert not [im for im in bpy.data.images if im.source=='FILE' and im.filepath]
    for block in list(bpy.data.user_map()):
        if getattr(block,'library_weak_reference',None) is None:continue
        name=block.name;replacement=block.copy();block.user_remap(replacement);bpy.data.batch_remove(ids=[block]);replacement.name=name
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
