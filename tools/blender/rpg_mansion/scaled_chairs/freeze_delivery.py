"""Freeze a strictly enumerated, hash-verified chair deliverable after local QA.
Certification and publication are separate parent/reviewer decisions.
"""
import json,hashlib
from pathlib import Path
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
def read(name):return json.loads((H/name).read_text())
def write(name,obj):(H/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
items=read('descriptors.json')['items'];assert len(items)==24
for item in items:
 for field,digest in item['hashes'].items():assert sha(ROOT/item[field])==digest,(item['id'],field)
byte=read('actual-byte-qa.json');native=read('reopened-source-qa.json');uv=read('packed-uv-overlap-qa.json');privacy=read('source-privacy-qa.json');contacts=read('qa-namedpart-contact.json');shading=read('shading-qa.json');distinct=read('distinct-support-qa.json');reexport=read('source-reexport-qa/checkpoint.json')
for name,result in [('byte',byte),('native',native),('uv',uv),('privacy',privacy),('shading',shading),('distinct',distinct)]:assert not result['errors'],name
assert all(not r['floating_groups'] and not r['source_changed']for r in contacts['items'])
assert all(not r['errors']for r in reexport)
assert all(r['reexportPbrMatches']and r['reexportCornerShadingMatches']for r in shading['items'])
expected={i['id']for i in items}
for report in [byte,native,uv,contacts,shading,distinct]:assert {i['id']for i in report['items']}==expected
assert {i['id']for i in reexport}==expected
assert len(privacy['items'])==48
by={i['id']:i for i in items}
for report,key,field in [(byte,'sha256','model'),(uv,'modelSha256','model'),(contacts,'source_sha256','sourceBlend'),(shading,'modelSha256','model'),(distinct,'modelSha256','model')]:
 for r in report['items']:assert r[key]==by[r['id']]['hashes'][field],r['id']+' stale '+key
for r in native['items']:
 for entry in r['sources']:assert entry['sha256']==by[r['id']]['hashes'][entry['field']],r['id']+' stale native source'
for r in privacy['items']:assert r['sha256']==by[r['id']]['hashes'][r['field']],r['id']+' stale privacy source'
for r in reexport:assert r['source_sha256']==by[r['id']]['hashes']['sourceBlend'],r['id']+' stale re-export'
for r in shading['items']:assert r['sourceSha256']==by[r['id']]['hashes']['sourceBlend'],r['id']+' stale shading source'
# The public source evidence never exports absolute executor paths.
def public(value):
 if isinstance(value,str):return value.replace(str(ROOT)+'/', '')
 if isinstance(value,list):return [public(v)for v in value]
 if isinstance(value,dict):return {k:public(v)for k,v in value.items()}
 return value
write('source-reexport-evidence.json',public(reexport))
summary=dict(family='chairs',forms=24,modelBytes=byte['actualModelBytes'],triangles=byte['actualTriangles'],canonicalSourceBytes=sum((ROOT/i['sourceBlend']).stat().st_size for i in items),authoringSourceBytes=sum((ROOT/i['authoringBlend']).stat().st_size for i in items),renderedViews=96,localQa='all required local gates passed against actual files',independentQa='pending independent full-family final certificate',visualReview='representative prototypes approved; full-family final review pending',publication='none; isolated local production only',descriptorSha256=sha(H/'descriptors.json'),materialIndependentDistinctGeometry=distinct['distinctGeometryCount'],limitations=['Static props; no interactive folding, rocking or adjustment mechanism.','Metadata-only footprint targets do not prove legacy geometry or clearance equivalence.','Static contact evidence is not physical load testing.'])
write('delivery-summary.json',summary)
write('production-checkpoint.json',dict(status='frozen-awaiting-independent-qa-and-parent-review',plannedForms=24,builtForms=24,renderedViews=96,builtIds=[i['id']for i in items],localQa='passed',visualReview=summary['visualReview'],releaseQa=summary['independentQa'],publication=summary['publication'],deliveryAllowlist='delivery-files.json'))
paths=set()
for item in items:
 for field in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation']:paths.add(item[field])
 binding=H/'work'/(item['id']+'-render-binding.json')
 if binding.exists():
  b=json.loads(binding.read_text());assert b['sourceSha256']==item['hashes']['sourceBlend'] and b['modelSha256']==item['hashes']['model'],item['id']+' stale render binding'
  assert all(b['images'][k]['sha256']==item['hashes'][k]for k in ['thumb','top','front','rear'])
  paths.add(str(binding.relative_to(ROOT)))
files=['README.md','build.py','extended_forms.py','metric_uv.py','repair_winding.py','sanitize_sources.py','render.py','create_plan.py','production-plan.json','production-checkpoint.json','descriptors.json','qa_family.py','check_uv_overlap.py','source_privacy.py','qa_contacts.py','qa_shading.py','qa_distinct_support.py','contact_sheet.py','finalize_metadata.py','freeze_delivery.py','actual-byte-qa.json','reopened-source-qa.json','packed-uv-overlap-qa.json','source-privacy-qa.json','qa-namedpart-contact.json','shading-qa.json','distinct-support-qa.json','source-reexport-evidence.json','delivery-summary.json']
files+=['family-'+v+'-contact-sheet.png'for v in ['thumb','top','front','rear']]
paths.update(str((H/f).relative_to(ROOT))for f in files)
paths.update(['tools/blender/model_kit.py','tools/blender/shape_kit.py','tools/blender/exterior_build.py','tools/blender/rpg_mansion/png_metadata.py','tools/blender/rpg_mansion/qa_asset_delivery.py'])
assert sha(ROOT/'tools/blender/rpg_mansion/qa_asset_delivery.py')=='55befe8339de8e6089340e865186bdd1008cf9ed5ee53486ced779172459cee9'
checks=''.join(sha(ROOT/p)+'  '+p+'\n'for p in sorted(paths));(H/'SHA256SUMS.txt').write_text(checks);paths.add(str((H/'SHA256SUMS.txt').relative_to(ROOT)))
rows=[dict(path=p,bytes=(ROOT/p).stat().st_size,sha256=sha(ROOT/p))for p in sorted(paths)]
write('delivery-files.json',dict(format=1,scope='Only listed delivery files. Excludes logs, debug/preflight scripts, backups, caches, stale prototype QA, private scratch requests and regenerated source-QA GLBs. This allowlist does not include itself.',fileCount=len(rows),totalBytes=sum(r['bytes']for r in rows),files=rows))
print('DELIVERY_FROZEN',len(rows),'FILES',sum(r['bytes']for r in rows),'BYTES','ALLOWLIST_SHA256',sha(H/'delivery-files.json'))
