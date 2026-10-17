from pathlib import Path
import bpy,json,hashlib,sys
R=Path('/workspace/scratch/a6c8080223a8/mansion-recovery-20261008T0401/repo')
H=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
D=json.loads((R/'assets/models/packs/rpg-mansion/manifest.json').read_text())
rows=[]
for i in D['items']:
 if i.get('kind')!='bed' and 'range' not in i['id']:continue
 source=R/i.get('authoringBlend',i['sourceBlend']);canonical=R/i['sourceBlend']
 bpy.ops.wm.open_mainfile(filepath=str(source)); active=bpy.context.scene
 native=next((sc for sc in bpy.data.scenes if 'Native authoring' in sc.name),active)
 meshes=[o for o in native.objects if o.type=='MESH']; parts=[]
 for o in meshes:
  pts=[o.matrix_world@v.co for v in o.data.vertices]
  parts.append(dict(name=o.name,role=o.get('functionalRole',o.get('partRole','')),channels=sorted(set(m.get('finishChannel','') for m in o.data.materials if m)),boundsBlenderM=[[min(p[a]for p in pts)for a in range(3)],[max(p[a]for p in pts)for a in range(3)]],vertices=len(o.data.vertices)))
 row=dict(id=i['id'],kind=i.get('kind'),authoringRead=str(source.relative_to(R)),sourceSha256=sha(source),canonical=str(canonical.relative_to(R)),canonicalSha256=sha(canonical),model=i['model'],modelSha256=sha(R/i['model']),inspectedScene=native.name,availableScenes=[sc.name for sc in bpy.data.scenes],meshPartCount=len(meshes),parts=parts,materialChannels=sorted(set(m.get('finishChannel','')for o in meshes for m in o.data.materials if m)))
 rows.append(row)
old=json.loads((H/'reports/existing-oven-bedding-audit.json').read_text())
(H/'reports/existing-oven-bedding-audit.json').write_text(json.dumps(dict(readOnly=True,sourceRoot=str(R),decision=old.get('decision'),bedCount=sum(r['kind']=='bed'for r in rows),rangeCount=sum(r['kind']!='bed'for r in rows),items=rows),indent=2)+'\n')
print('AUDITED',len(rows),'sources')
