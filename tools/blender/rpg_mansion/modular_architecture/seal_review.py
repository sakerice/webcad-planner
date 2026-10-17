"""Build a hash-verified local review allowlist and portable review ZIP.
No publisher acceptance, shared manifest, app changes or remote writes.
"""
from pathlib import Path
import json,hashlib,zipfile
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
rel=lambda p:str(p.relative_to(ROOT))
read=lambda n:json.loads((H/n).read_text())
D=read('descriptors.json')['items'];assert len(D)==8
for it in D:
 for field,digest in it['hashes'].items():assert sha(ROOT/it[field])==digest,(it['id'],field,'stale descriptor hash')
for n in ['packed-uv-overlap-qa.json','all-source-privacy-qa.json','dimensions-placement-qa.json','image-framing-qa.json','image-replay-qa.json']:
 assert read(n)['errors']==[],(n,'QA errors')
assert read('image-framing-qa.json')['imageCount']==41
assert read('image-replay-qa.json')['viewCount']==41
assert read('all-source-privacy-qa.json')['sourceCount']==19
G=read('audit/geometry-audit.json');assert G['summary']['assetCount']==8 and G['summary']['assemblyCount']==3 and G['summary']['hardFailureCount']==0,G['summary']
assert not G['findings'],G['findings']
for r in read('source-replay-inputs.json')['items']:
 assert r['exactCyclicGeometryUvPbrAndCornerNormals'] and r['sourceUnchanged']
 assert sha(ROOT/r['source'])==r['sourceSha256'] and sha(ROOT/r['model'])==r['modelSha256']
for p in (H/'assemblies').glob('*.json'):
 r=json.loads(p.read_text());assert sha(ROOT/r['source'])==r['sourceSha256']
 for it in r['instances']:assert sha(ROOT/it['model'])==it['modelSha256']
 for v in r['views'].values():assert sha(ROOT/v['path'])==v['sha256']
paths=set()
for it in D:
 for field in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation']:paths.add(ROOT/it[field])
 paths.add(H/'work'/(it['id']+'-render-binding.json'))
for p in (H/'assemblies').iterdir():
 if p.suffix in ['.blend','.json','.png']:paths.add(p)
for p in (H/'review').glob('*.png'):paths.add(p)
for name in ['README.md','RIGHTS.md','descriptors.json','build.py','render.py','assemblies.py','metadata_contract.py','metric_atlas.py','repair_winding.py','sanitize_sources.py','source_privacy.py','check_uv_overlap.py','replay_sources.py','review_checks.py','seal_review.py','packed-uv-overlap-qa.json','all-source-privacy-qa.json','dimensions-placement-qa.json','image-framing-qa.json','image-replay-qa.json','source-replay-inputs.json','assembly-replay-inputs.json','audit/audit_geometry.py','audit/audit_selftest.py','audit/summarize_geometry_audit.py','audit/audit-selftest.json','audit/geometry-audit.json','audit/geometry-audit-report.md','audit/exposed-surface-repair-targets.md']:
 paths.add(H/name)
for name in ['model_kit.py','exterior_build.py','shape_kit.py']:paths.add(H.parent.parent/name)
for name in ['qa_asset_delivery.py','png_metadata.py']:paths.add(H.parent/name)
for p in (H/'replay').iterdir():
 if p.suffix in ['.glb','.png']:paths.add(p)
rows=[dict(path=rel(p),bytes=p.stat().st_size,sha256=sha(p))for p in sorted(paths)]
report=dict(schema='mansion-prototype-review-allowlist-v1',status='Ready for parent/root prototype review; independent acceptance is separate',assetCount=8,assemblyCount=3,sourceCount=19,deliveredViews=41,catalogAssetIds=[it['id']for it in D],descriptor=rel(H/'descriptors.json'),descriptorSha256=sha(H/'descriptors.json'),limits=['Static manual geometry only.','One labelled fitted front-wall QA fixture is excluded from asset count.','No app/runtime placement or finish integration acceptance.','No expanded32-piece production until actual8-piece review approval.'],sharedManifestWrites=False,remoteWrites=False,files=rows,fileCount=len(rows),totalBytes=sum(r['bytes']for r in rows))
allow=H/'review-allowlist.json';allow.write_text(json.dumps(report,indent=2)+'\n')
archive=ROOT.parent/'architecture-prototype8-review.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6)as z:
 for p in sorted(paths|{allow}):z.write(p,arcname=rel(p))
with zipfile.ZipFile(archive)as z:
 assert z.testzip()is None
 for r in rows:assert hashlib.sha256(z.read(r['path'])).hexdigest()==r['sha256']
receipt=dict(archive=archive.name,archiveSha256=sha(archive),archiveBytes=archive.stat().st_size,allowlistPath=rel(allow),allowlistSha256=sha(allow),fileCountIncludingAllowlist=len(rows)+1,assetCount=8,deliveredViews=41,sourceCount=19,zipReopenedAndEveryMemberHashVerified=True,status=report['status'])
(ROOT.parent/'architecture-prototype8-review-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
