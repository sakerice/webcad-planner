"""Bind completed producer artifacts into a current-byte candidate, never an acceptance certificate."""
from pathlib import Path
import json,hashlib
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
D=json.loads((H/'descriptors.json').read_text());items=D['items'];assert len(items)==18;assert sum(i['independentConstructionCount'] for i in items)==16
paths=set();proofs=[]
for i in items:
 for k in ['model','sourceBlend','authoringBlend','thumb','top','front','rear']:
  p=ROOT/i[k];assert p.is_file();assert sha(p)==i['hashes'][k],(i['id'],k,'stale hash');paths.add(p)
 paths.add(ROOT/i['validation']);paths.add(H/'work'/(i['id']+'-render-binding.json'))
 assert i['measuredTriangles']<6000 and i['glbBytes']<1000000
for p in sorted((H/'assemblies').glob('*.json')):
 if p.stem.endswith('-measurements'):continue
 d=json.loads(p.read_text());proofs.append(d);src=ROOT/d['source'];assert sha(src)==d['sourceSha256'];paths.update([p,src,H/'assemblies'/(p.stem+'-measurements.json')]);assert len(d['views'])==len(d['viewRecipes'])
 for v in d['views'].values():
  image=ROOT/v['path'];assert sha(image)==v['sha256'];paths.add(image)
 for r in d['instances']:assert sha(ROOT/r['model'])==r['modelSha256']
assert len(proofs)==7 and sum(i['instanceCount'] for i in proofs)==118 and sum(len(i['views']) for i in proofs)==24
for name in ['all-source-privacy-qa.json','image-framing-qa.json','dimensions-placement-qa.json','packed-uv-overlap-qa.json','assembly-measurements-qa.json','glazing-proofs/optical-transmission-qa.json']:
 p=H/name;d=json.loads(p.read_text());assert not d['errors'],name;paths.add(p)
for folder in ['proof_inputs','glazing-proofs']:
 paths.update(p for p in (H/folder).rglob('*') if p.is_file())
paths.update(p for p in (H/'review').glob('architecture18-*.png'))
paths.update(p for p in H.glob('*.py'))
paths.update([H.parent/'png_metadata.py',H.parent/'qa_asset_delivery.py',H.parent.parent/'model_kit.py',H.parent.parent/'shape_kit.py',H.parent.parent/'exterior_build.py'])
for n in ['descriptors.json','README.md','RIGHTS.md','rights-registry.json','proof-input-dependencies.json','assembly-contract-refresh.json']:paths.add(H/n)
receipt=dict(status='Producer-complete current-byte candidate; independent final acceptance and root visual gate remain separately owned',newModelCount=18,independentConstructionCount=16,hostVariantCount=2,priorFrozenModelDependencyCount=8,modelSourceCount=36,assemblySourceCount=7,opticalProofSourceCount=2,productViews=72,assemblyViews=24,opticalProofViews=4,assemblyInstances=118,modelHashes={i['id']:i['hashes']['model'] for i in items},producerChecks=dict(dimensions=18,sourcePrivacy=45,framedProductAndAssemblyViews=96,actualGlbContacts=sum(len(a['actualGlbContacts']) for a in json.loads((H/'assembly-measurements-qa.json').read_text())['assemblies']),cavitySamples=sum(len(a['cavitySamples']) for a in json.loads((H/'assembly-measurements-qa.json').read_text())['assemblies']),notes='Independent saved-source replay is separate. No historical acceptance or byte identity is inherited.'),applicationChanges=False,productionDeployment=False)
p=H/'producer-completion-receipt.json';p.write_text(json.dumps(receipt,indent=2)+'\n');paths.add(p)
rows=[dict(path=str(p.relative_to(ROOT)),bytes=p.stat().st_size,sha256=sha(p)) for p in sorted(paths)];p=H/'delivery-allowlist.json';p.write_text(json.dumps(dict(kind='new-architecture18-current-byte-candidate',acceptance='Await separate final independent certificate and root visual approval',files=rows,totalBytes=sum(i['bytes'] for i in rows)),indent=2)+'\n');print('CANDIDATE',len(rows),sum(i['bytes'] for i in rows),sha(p),flush=True)
