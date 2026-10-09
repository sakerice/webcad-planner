"""Exact immutable core18 family handoff. No release, shared manifest or remote action."""
from pathlib import Path
import json,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();items=json.loads((H/'bed-items.json').read_text())['items'];paths=set();ids={i['id']for i in items};assert len(ids)==18
for i in items:
 for k in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation']:
  p=R/i[k];assert p.exists();paths.add(p)
 assert json.loads((R/i['validation']).read_text())['glb_bytes']==(R/i['model']).stat().st_size
 assert i['sha256']==sha(R/i['model'])and i['sourceSha256']==sha(R/i['sourceBlend'])and i['authoringSha256']==sha(R/i['authoringBlend'])
 assert set(i['previewSha256'])=={'thumb','top','front','rear'}
 for k,s in i['previewSha256'].items():assert sha(R/i[k])==s
checks=['qa-coplanar-exteriors.json','qa-actual-bytes.json','qa-front-axis.json','qa-uv-overlap.json','qa-native-parts.json','qa-pbr-reexport.json','source-privacy-qa.json','qa-namedpart-contact.json','qa-mattress-features.json','qa-dedupe.json','qa-image-margins.json','qa-approved-prototype-preservation.json','qa-render-recipes.json','source-ui-cleanup-report.json','generic-source-qa/source-checkpoint.json']
for n in checks:
 q=json.loads((H/n).read_text());rows=q.get('items',[])if isinstance(q,dict)else q
 if isinstance(q,dict):assert not q.get('errors',[]),n
 else:assert not any(r['errors']for r in q),n
 if n!='qa-approved-prototype-preservation.json':assert {r['id']for r in rows}==ids,(n,'Coverage mismatch')
 if n=='qa-namedpart-contact.json':assert all(not r['floating_groups']and not r['source_changed']for r in rows)
 if n=='source-privacy-qa.json':assert q['sourceFiles']==36
 if n=='qa-image-margins.json':assert q['imageCount']==72
 for row in rows:
  i=next((i for i in items if i['id']==row.get('id')),None)
  if not i:continue
  for key,ref in [('modelSha256','sha256'),('sourceSha256','sourceSha256'),('source_sha256','sourceSha256')]:
   if key in row and n not in ['source-privacy-qa.json','source-ui-cleanup-report.json']:assert row[key]==i[ref],(n,i['id'],key,'stale')
 paths.add(H/n)
common=['coplanar-repair-scope.json','PRODUCTION-CHECKPOINT.json','PRODUCTION-CHECKPOINT.md','bed-items.json','production-plan.json','rights-and-provenance.json','generic-source-qa/source-request.json','evidence/three-bed-prototypes-contact.jpg','evidence/bed18-overview.jpg']+[f'evidence/bed18-detail-page-{i}.jpg'for i in ['1','2','3a','3b']]
for n in common:paths.add(H/n)
for p in H.glob('*.py'):paths.add(p)
for n in ['model_kit.py','shape_kit.py','exterior_build.py','build_decor.py']:paths.add(H.parents[1]/n)
paths.add(H.parent/'png_metadata.py')
for i in items:paths.add(H/'generic-source-qa/regenerated'/(i['id']+'.glb'))
for p in (H/'approved-prototype-snapshot').glob('*.json'):paths.add(p)
rows=[dict(path=str(p.relative_to(R)),bytes=p.stat().st_size,sha256=sha(p))for p in sorted(paths)];seal=dict(status='core18-local-package-root-visual-approved-awaiting-independent-qa',releaseAuthorized=False,publicationPerformed=False,assetCount=len(items),constructionFamilies=15,constructionOrArrangementForms=16,uniqueFiles=len(rows),bytes=sum(r['bytes']for r in rows),files=rows)
p=H/'delivery-allowlist.json';p.write_text(json.dumps(seal,indent=2)+'\n');(H/'SHA256SUMS.txt').write_text(''.join(r['sha256']+'  '+r['path']+'\n'for r in rows));print('BED_ALLOWLIST',len(rows),seal['bytes'],sha(p))
