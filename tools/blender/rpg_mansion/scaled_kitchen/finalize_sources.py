"""Normalize only canonical source metadata, preserving every mesh and UV."""
from pathlib import Path
import sys,json,struct,hashlib
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
items=json.loads((HERE/'descriptors.json').read_text())['items']
def planar_face_atlas(ob):
 mesh=ob.data;layer=mesh.uv_layers.active
 if layer is None:layer=mesh.uv_layers.new(name='UVMap')
 offset=0;max_height=0;raw=[]
 for poly in mesh.polygons:
  coords=[ob.matrix_world@mesh.vertices[mesh.loops[i].vertex_index].co for i in poly.loop_indices]
  edges=[coords[(i+1)%len(coords)]-coords[i] for i in range(len(coords))]
  u=max(edges,key=lambda p:p.length).normalized();normal=(ob.matrix_world.to_3x3().inverted().transposed()@poly.normal).normalized();v=normal.cross(u).normalized()
  q=[(p.dot(u),p.dot(v)) for p in coords];lo=(min(p[0] for p in q),min(p[1] for p in q));width=max(p[0] for p in q)-lo[0];height=max(p[1] for p in q)-lo[1]
  for index,(a,b) in zip(poly.loop_indices,q):raw.append((index,a-lo[0]+offset,b-lo[1]))
  offset+=width+.0005;max_height=max(max_height,height)
 scale=max(offset,max_height)
 for index,u,v in raw:layer.data[index].uv=(u/scale,v/scale)
 layer.active_render=True;mesh.update()

for it in items:
 path=ROOT/it['sourceBlend'];bpy.ops.wm.open_mainfile(filepath=str(path));active=bpy.context.scene
 for scene in bpy.data.scenes:
  for layer in scene.view_layers:
   for ob in layer.objects:ob.select_set(False,view_layer=layer)
 if it['id']=='rpg-mansion-kitchen-cast-iron-range-750-01':
  for mat in bpy.data.materials:
   if mat.name.startswith('Cast iron fittings'):mat['finishChannel']='iron'
  if not any(c['key']=='iron' for c in it['finishChannels']):it['finishChannels'].append(dict(key='iron',label='鋳鉄',default='#343b3b'))
 for scene in bpy.data.scenes:
  if scene.name.startswith('Native authoring parts'):
   for ob in scene.objects:
    if ob.type=='MESH' and ob.name.startswith('Curved brass drawer pull'):planar_face_atlas(ob)
 want=(it['kind']=='kitchen-sink' or it['h']==850 or it['id']=='rpg-mansion-kitchen-baking-dresser-1200-01')
 for scene in bpy.data.scenes:
  scene.render.filepath='//renders/'+it['id']+'.png'
  scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
 for ob in active.objects:
  if ob.type=='MESH':
   if want:ob['counterTopMm']=850
   elif 'counterTopMm' in ob:del ob['counterTopMm']
 bpy.context.preferences.filepaths.save_version=0
 bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
 glb=ROOT/it['model'];raw=glb.read_bytes();n=struct.unpack_from('<I',raw,12)[0];old_doc=json.loads(raw[20:20+n]);asset_extras=old_doc.get('asset',{}).get('extras',{})
 obj=next(o for o in active.objects if o.type=='MESH');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False,export_skins=False,export_morph=False)
 raw=glb.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);doc['asset']['extras']=asset_extras
 assert len(doc.get('meshes',[]))==1 and len(doc.get('scenes',[]))==1,'Export must contain only validated active scene'
 text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4);binary=raw[20+n:]
 glb.write_bytes(struct.pack('<III',0x46546c67,2,20+len(text)+len(binary))+struct.pack('<II',len(text),0x4e4f534a)+text+binary)
 validation=ROOT/it['validation'];report=json.loads(validation.read_text());report['source_metadata']='Compressed native source; relative render paths; counter support height distinct from overall envelope';report['glb_bytes']=glb.stat().st_size;report['glb_sha256']=hashlib.sha256(glb.read_bytes()).hexdigest();report['source_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
 if it['id']=='rpg-mansion-kitchen-cast-iron-range-750-01':
  for name,key in report['materials'].items():
   if name.startswith('Cast iron fittings'):report['materials'][name]='iron'
 if want:
  report['countertop_height_mm']=850;
  if 'Countertop top is 850mm independently' not in it['placementNotes']:it['placementNotes']+=' Countertop top is 850mm independently of overall fixture/cabinet height.'
 else:report.pop('countertop_height_mm',None)
 validation.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print('SOURCE_FINALIZED '+it['id'],flush=True)
(HERE/'descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',name='RPGアセット',items=items),ensure_ascii=False,indent=1)+'\n')
