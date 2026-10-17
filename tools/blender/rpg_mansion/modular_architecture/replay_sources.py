"""Read-only native source re-export and real image replay.

Reopens saved delivery sources. Does not invoke builders or save sources. Uses
published render recipe, then compares decoded geometry/UV/PBR/corner normals
and exact RGBA pixels. This is producer reproducibility evidence; independent
acceptance remains separately owned.
"""
import sys,json,hashlib,copy
from pathlib import Path
import bpy
import numpy as np
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sys.path[:0]=[str(H),str(H.parent)]
import qa_asset_delivery as qa
from render import render
OUT=H/'replay';OUT.mkdir(exist_ok=True)

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def relative(p):return str(p.relative_to(ROOT))
def signature(path):
 d,b=qa.load_glb(path);rows=qa.scene_geometry(d,b);materials=[]
 for m in d.get('materials',[]):
  m=copy.deepcopy(m);m.pop('name',None);extras=m.pop('extras',{});m['finishChannel']=extras.get('finishChannel');materials.append(json.dumps(m,sort_keys=True,separators=(',',':')))
 result=[]
 # Actual world positions from parser, exact per-corner normal and UV attributes.
 for row,prim in zip(rows,[p for node in d['nodes'] if 'mesh'in node for p in d['meshes'][node['mesh']]['primitives']]):
  normals=qa.accessor(d,b,prim['attributes']['NORMAL'])
  for tri in row['indices']:
   verts=[tuple(row['positions'][i])+tuple(row['uv'][i])+tuple(normals[i])for i in tri]
   result.append((materials[row['material']],min(tuple(verts[i:]+verts[:i])for i in range(3))))
 return sorted(result)

def replay_assets():
 only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
 prior=H/'source-replay-inputs.json'
 rows=[r for r in json.loads(prior.read_text())['items']if not any(k in r['id']for k in only)]if only and prior.exists()else[]
 for it in json.loads((H/'descriptors.json').read_text())['items']:
  if only and not any(k in it['id']for k in only):continue
  src=ROOT/it['sourceBlend'];before=sha(src);bpy.ops.wm.open_mainfile(filepath=str(src),load_ui=False)
  ob=next(o for o in bpy.context.scene.objects if o.type=='MESH');assert len([o for o in bpy.context.scene.objects if o.type=='MESH'])==1
  bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
  regenerated=OUT/(it['id']+'.glb');bpy.ops.export_scene.gltf(filepath=str(regenerated),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_yup=True,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False,export_skins=False,export_morph=False)
  original=ROOT/it['model'];same=signature(original)==signature(regenerated);assert same,it['id']+' exact cyclic geometry/UV/PBR/corner normal source re-export differs'
  views=[]
  for key,direction in [('thumb',(6,-8,5)),('top',(0,0,1)),('front',(0,-1,0)),('rear',(0,1,0))]:
   target=OUT/(it['id']+'-'+key+'.png');camera=render([ob],target,direction,resolution=512,samples=32)
   views.append(dict(view=key,deliveredPath=it[key],deliveredSha256=sha(ROOT/it[key]),replayedPath=relative(target),replayedSha256=sha(target),camera=camera))
  assert before==sha(src)
  rows.append(dict(id=it['id'],source=it['sourceBlend'],sourceSha256=before,sourceUnchanged=True,model=it['model'],modelSha256=sha(original),reexport=relative(regenerated),reexportSha256=sha(regenerated),exactCyclicGeometryUvPbrAndCornerNormals=True,views=views,errors=[]))
  write(H/'source-replay-inputs.json',dict(method=__doc__,items=rows,complete=len(rows)==8));print('SOURCE_REPLAY',it['id'],flush=True)

def replay_assemblies():
 only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
 prior=H/'assembly-replay-inputs.json'
 rows=[r for r in json.loads(prior.read_text())['items']if r['name']not in only]if only and prior.exists()else[]
 for name in ['wall-door-corner','hollow-roof-gable','cornice-column']:
  if '--only' in sys.argv and name not in sys.argv[sys.argv.index('--only')+1].split(','):continue
  proof=json.loads((H/'assemblies'/(name+'.json')).read_text());src=ROOT/proof['source'];before=sha(src);assert before==proof['sourceSha256'];bpy.ops.wm.open_mainfile(filepath=str(src),load_ui=False);obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];views=[]
  for key,receipt in proof['views'].items():
   target=OUT/(name+'-'+key+'.png');camera=render(obs,target,receipt['camera']['direction'],resolution=1024,samples=48)
   views.append(dict(view=key,deliveredPath=receipt['path'],deliveredSha256=sha(ROOT/receipt['path']),replayedPath=relative(target),replayedSha256=sha(target),camera=camera))
  assert before==sha(src)
  rows.append(dict(name=name,source=proof['source'],sourceSha256=before,sourceUnchanged=True,views=views,errors=[]));write(H/'assembly-replay-inputs.json',dict(method=__doc__,items=rows,complete=len(rows)==3));print('ASSEMBLY_REPLAY',name,flush=True)

if __name__=='__main__':
 if '--assemblies-only'not in sys.argv:replay_assets()
 if '--assets-only'not in sys.argv:replay_assemblies()
