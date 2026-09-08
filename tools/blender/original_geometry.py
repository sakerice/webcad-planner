"""Independently authored furniture. Only category, ID and requested dimensions are read from the catalogue; no source geometry or texture is imported."""
import bpy,math,json,os,struct
from pathlib import Path
from mathutils import Vector,Matrix
R=Path(__file__).resolve().parents[2];OUT=R/'assets/models/original';WORK=R/'tools/blender/work/original';OUT.mkdir(exist_ok=True);WORK.mkdir(exist_ok=True)
def material(name,col,rough=.6,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def box(name,pos,size,mat,r=.012):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat);b=o.modifiers.new('Manufactured edge radius','BEVEL');b.width=min(r,min(size)*.45);b.segments=4;n=o.modifiers.new('Surface normals','WEIGHTED_NORMAL');return o
def piping(name,pos,sx,sy,corner,mat):
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=.0014;curve.bevel_resolution=2
 spline=curve.splines.new('POLY');points=[]
 for cx,cy,start in [(sx/2-corner,sy/2-corner,0),(-sx/2+corner,sy/2-corner,90),(-sx/2+corner,-sy/2+corner,180),(sx/2-corner,-sy/2+corner,270)]:
  for k in range(9):
   a=math.radians(start+k*90/8);points.append((pos[0]+cx+corner*math.cos(a),pos[1]+cy+corner*math.sin(a),pos[2],1))
 spline.points.add(len(points)-1)
 for p,co in zip(spline.points,points):p.co=co
 spline.use_cyclic_u=True;o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o);curve.materials.append(mat)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
def sphere(name,pos,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=pos);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def tube(name,a,b,r,mat):
 a,b=Vector(a),Vector(b);delta=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=r,depth=delta.length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();o.data.materials.append(mat);bv=o.modifiers.new('Edge','BEVEL');bv.width=r*.18;bv.segments=3
 for p in o.data.polygons:p.use_smooth=True
 return o
def ring(name,pos,rx,ry,r,mat):
 bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=12,major_radius=1,minor_radius=r,location=pos);o=bpy.context.object;o.name=name;o.scale=(rx,ry,1);o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def mesh(name,vs,fs,mat):
 d=bpy.data.meshes.new(name);d.from_pydata(vs,[],fs);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);d.materials.append(mat)
 for p in d.polygons:p.use_smooth=True
 return o
def bowl(w,d,z,depth,mat):
 vs=[];fs=[];N=64
 for k in range(13):
  t=k/12;r=.10+.90*t;zz=z-depth*(1-t*t)
  for j in range(N):a=j*math.tau/N;vs.append((w*.46*r*math.cos(a),d*.44*r*math.sin(a),zz))
 for k in range(12):
  for j in range(N):a=k*N+j;b=k*N+(j+1)%N;fs.append((a,b,b+N,a+N))
 fs.append(tuple(reversed(range(N))));o=mesh('Continuous ceramic bowl',vs,fs,mat);s=o.modifiers.new('Ceramic shell','SOLIDIFY');s.thickness=min(w,d)*.025;return o
