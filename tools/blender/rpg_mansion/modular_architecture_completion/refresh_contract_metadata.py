"""Refresh scene-level assembly contract metadata only, preserving all mesh data.
The rendered view pixels are unchanged; independent saved-source replay verifies them.
"""
import sys,json,hashlib,math
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
H=Path(__file__).resolve().parent;ROOT=H.parents[3];sys.path.insert(0,str(H))
from sanitize_sources import scene_fingerprints,sanitize_loaded
D={i['id']:i for p in [H/'descriptors.json',H/'proof_inputs/reference-descriptors.json'] for i in json.loads(p.read_text())['items']};receipts=[]
for name in ['gable-dormer-room','flat-chimney-room']:
 p=H/'assemblies'/(name+'.json');report=json.loads(p.read_text());src=ROOT/report['source'];beforehash=hashlib.sha256(src.read_bytes()).hexdigest();assert beforehash==report['sourceSha256'];bpy.ops.wm.open_mainfile(filepath=str(src),load_ui=False);before=scene_fingerprints()
 for r in report['instances']:
  it=D[r['id']];placement=Matrix(r['assetToWorldBlenderMatrix']);rotation=Matrix.Rotation(math.radians(r['zRotationDegrees']),4,'Z');rows=[]
  for c in it['moduleContract']['connections']:
   pt=placement@Vector(c['assetPointM']);normal=rotation.to_3x3()@Vector(c['normal']);rows.append(dict(label=c['label'],pointBlenderWorldM=list(pt),normalBlenderWorld=list(normal),pointGltfWorldM=[pt.x,pt.z,-pt.y],normalGltfWorld=[normal.x,normal.z,-normal.y]))
  r['worldConnections']=rows
 bpy.context.scene['assemblyManifest']=json.dumps(report['instances']);sanitize_loaded(name);assert before==scene_fingerprints();bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(src),compress=True);bpy.ops.wm.open_mainfile(filepath=str(src),load_ui=False);assert before==scene_fingerprints();report['sourceSha256']=hashlib.sha256(src.read_bytes()).hexdigest();p.write_text(json.dumps(report,indent=2)+'\n');receipts.append(dict(name=name,previousSourceSha256=beforehash,currentSourceSha256=report['sourceSha256'],geometryUvMaterialsAndObjectsUnchanged=True,reason='Correct outward slope interface normals and place dormer fit datum on physical cheek',viewImagesChanged=False))
(H/'assembly-contract-refresh.json').write_text(json.dumps(dict(items=receipts,errors=[]),indent=2)+'\n')
