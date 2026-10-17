"""Replace self-overlapping thin-part charts while preserving exact triangles.

Only the two reported components are triangulated using Blender's existing
loop triangles. No vertex position, material, smoothing or oriented triangle
surface changes. Each corrected triangle gets a metric-isometric chart; the
combined atlas is uniformly repacked, retaining other chart shapes/density.
"""
import hashlib,json,sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE.parent))
from repair_winding import repair_mesh_winding
from sanitize_sources import sanitize_loaded
from build import export_active,stamp_contract,kit
TARGET_PARTS={'rpg-mansion-kidney-writing-desk-01':'Concave desk center drawer face',
              'rpg-mansion-roll-top-writing-desk-01':'Roll-top cover bottom handle rail'}

def triangle_invariant(obj):
    mesh=obj.data;mesh.calc_loop_triangles();rows=[]
    for tri in mesh.loop_triangles:
        points=[tuple(obj.matrix_world@mesh.vertices[i].co)for i in tri.vertices]
        # Cycle-canonical ordering retains orientation, never reverses it.
        rows.append((mesh.materials[tri.material_index].name,
                     mesh.polygons[tri.polygon_index].use_smooth,
                     min(tuple(points[i:]+points[:i])for i in range(3))))
    return hashlib.sha256(repr(sorted(rows)).encode()).hexdigest()

def repack(obj):
    selected=list(bpy.context.selected_objects);active=bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT');bpy.ops.uv.pack_islands(rotate=True,margin=0.008)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in selected:
        if ob.name in bpy.context.view_layer.objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=active

def correct_mesh(obj,target_vertices=None):
    before=triangle_invariant(obj);old=obj.data;old.calc_loop_triangles()
    has_custom_normals=old.has_custom_normals
    loop_normals=[tuple(normal.vector)for normal in old.corner_normals]if has_custom_normals else None
    density=kit.uv_report(obj)['meters_per_uv']
    target_polygons={p.index for p in old.polygons
                     if target_vertices is None or all(v in target_vertices for v in p.vertices)}
    assert target_polygons
    triangles={}
    for tri in old.loop_triangles:triangles.setdefault(tri.polygon_index,[]).append(tri)
    faces=[];corner_uvs=[];corner_normals=[];properties=[];new_charts=[]
    for polygon in old.polygons:
        if polygon.index in target_polygons:
            for tri in triangles[polygon.index]:
                faces.append(tuple(tri.vertices));corner_uvs.append([tuple(old.uv_layers.active.data[i].uv)for i in tri.loops])
                if has_custom_normals:corner_normals.extend(loop_normals[i]for i in tri.loops)
                properties.append((polygon.material_index,polygon.use_smooth));new_charts.append(len(faces)-1)
        else:
            faces.append(tuple(polygon.vertices));corner_uvs.append([tuple(old.uv_layers.active.data[i].uv)for i in polygon.loop_indices])
            if has_custom_normals:corner_normals.extend(loop_normals[i]for i in polygon.loop_indices)
            properties.append((polygon.material_index,polygon.use_smooth))
    mesh=bpy.data.meshes.new(old.name+' temporary triangle charts')
    mesh.from_pydata([tuple(v.co)for v in old.vertices],[],faces);mesh.update()
    for material in old.materials:mesh.materials.append(material)
    layer=mesh.uv_layers.new(name=old.uv_layers.active.name)
    for face,uvs,props in zip(mesh.polygons,corner_uvs,properties):
        face.material_index=props[0];face.use_smooth=props[1]
        for index,uv in zip(face.loop_indices,uvs):layer.data[index].uv=uv
    for chart_index,face_index in enumerate(new_charts):
        face=mesh.polygons[face_index];p,q,r=[obj.matrix_world@mesh.vertices[v].co for v in face.vertices]
        axis=(q-p).normalized();length=(q-p).length
        x=(r-p).dot(axis);height=((r-p)-axis*x).length
        assert length>1e-12 and height>1e-12
        points=[(0,0),(length/density,0),(x/density,height/density)]
        for index,(u,v)in zip(face.loop_indices,points):layer.data[index].uv=(u+3*(chart_index+1),v)
    # Setting custom normals reallocates Mesh CustomData. Finish UV writes
    # first and reacquire the RNA layer afterward; never use a stale layer.
    if has_custom_normals:mesh.normals_split_custom_set(corner_normals)
    layer=mesh.uv_layers.active
    mesh.update();obj.data=mesh;bpy.context.view_layer.update();old_name=old.name
    if old.users==0:bpy.data.meshes.remove(old)
    mesh.name=old_name;layer.active_render=True
    assert triangle_invariant(obj)==before,'Oriented geometry/material/smoothing changed during UV correction'
    layer=mesh.uv_layers.active
    assert all(layer.data[i].uv.x>2 for i in mesh.polygons[new_charts[0]].loop_indices), 'Triangle UV writes were lost'
    repack(obj)
    assert triangle_invariant(obj)==before
    normal_error=0.0
    if has_custom_normals:
        # Blender re-encodes custom loop normals after topology remapping.
        # Allow only its tiny quantization round-trip, with no shading change.
        normal_error=max((Vector(expected)-actual.vector).length
                         for expected,actual in zip(corner_normals,mesh.corner_normals))
        assert normal_error<0.0005,'Custom normal association changed beyond quantization'
    obj['triangleChartUvRepair']=True
    assert all(c['signedVolumeAfterM3']>0 for c in repair_mesh_winding(obj,repair=False)['components'])
    return {'part':obj.name,'correctedTriangles':len(new_charts),'orientedGeometryMaterialFingerprint':before,
            'orientedGeometryMaterialsPreserved':True,'customNormalsPreserved':has_custom_normals,
            'maximumCustomNormalVectorError':normal_error,'customNormalVectorTolerance':0.0005,
            'uv':kit.uv_report(obj)}

def repair_loaded(asset_id):
    if asset_id not in TARGET_PARTS:return []
    active=bpy.context.scene;native=bpy.data.scenes.get('Native authoring parts')
    source_scene=native or active
    part=next(ob for ob in source_scene.objects if ob.type=='MESH'and ob.name.startswith(TARGET_PARTS[asset_id]))
    part_vertices={tuple(part.matrix_world@v.co)for v in part.data.vertices}
    rows=[]
    if not part.get('triangleChartUvRepair')or '--force' in sys.argv:
        bpy.context.window.scene=source_scene
        rows.append(correct_mesh(part))
    if native:
        bpy.context.window.scene=active
        combined=next(ob for ob in active.objects if ob.type=='MESH')
        if not combined.get('triangleChartUvRepair')or '--force' in sys.argv:
            vertices={v.index for v in combined.data.vertices if tuple(combined.matrix_world@v.co)in part_vertices}
            rows.append(correct_mesh(combined,vertices))
    bpy.context.window.scene=active
    return rows

def main():
    reports=[]
    for item in json.loads((HERE/'descriptors.json').read_text()):
        if item['id']not in TARGET_PARTS:continue
        for field in ['authoringBlend','sourceBlend']:
            path=ROOT/item[field];bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
            rows=repair_loaded(item['id']);sanitize_loaded(item['id'])
            bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
            if field=='sourceBlend':
                obj=next(ob for ob in bpy.context.scene.objects if ob.type=='MESH')
                export_active(obj,ROOT/item['model']);stamp_contract(ROOT/item['model'],item['id'])
                validation=json.loads((ROOT/item['validation']).read_text());validation['uv']=kit.uv_report(obj)
                validation['packedUvOverlapCorrected']=True;validation['glb_bytes']=(ROOT/item['model']).stat().st_size
                (ROOT/item['validation']).write_text(json.dumps(validation,indent=2)+'\n')
            reports.append({'id':item['id'],'field':field,'path':item[field],'repairs':rows,
                            'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            print('UV_ATLAS_REPAIRED',item['id'],field,flush=True)
    (HERE/'uv-atlas-repair-qa.json').write_text(json.dumps({'items':reports,'errors':[]},indent=2)+'\n')

if __name__=='__main__':main()
