"""Seal producer-complete sofa18 bytes; independent and visual release gates remain separate."""
from pathlib import Path
import json,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
items=json.loads((HERE/'descriptors.json').read_text())['items']
plan=json.loads((HERE/'production-plan.json').read_text())
order=['rpg-mansion-'+p['slug']+'-01' for p in plan['items']]
expected=set(order)
items=sorted(items,key=lambda i:order.index(i['id']))
assert len(items)==18 and {i['id']for i in items}==expected,'Incomplete asset family'
reports={name:json.loads((HERE/'qa'/name).read_text())for name in ['native.json','bytes.json','normals-dedupe.json','coplanar.json','exact-replay.json']}
for name,r in reports.items():
 assert r['errors']==0,(name,r['errors'])
 assert {i['id']for i in r['items']}==expected,(name,'partial QA')
for name in ['native.json','bytes.json','normals-dedupe.json','coplanar.json','exact-replay.json']:
 for row in reports[name]['items']:
  it=next(i for i in items if i['id']==row['id'])
  if name=='native.json':assert row['source_sha256']==sha(ROOT/it['sourceBlend']) and row['source_unchanged'] and row['authoring_sha256']==sha(ROOT/it['authoringBlend']) and row['authoring_source_unchanged'] and row['standalone_authoring_matches_canonical_parts']
  elif name=='bytes.json':assert row['sha256']==sha(ROOT/it['model']) and row['source_reexport_matches_geometry_material_uv'] and row['source_reexport_matches_full_materials']
  elif name=='coplanar.json':assert row['model_sha256']==sha(ROOT/it['model']) and row['externally_visible_pairs']==0
  elif name=='exact-replay.json':assert row['model_sha256']==sha(ROOT/it['model']) and row['source_sha256']==sha(ROOT/it['sourceBlend']) and row['exact_index_attribute_arrays_equal'] and row['exact_world_geometry_uv_material_equal'] and row['full_pbr_equal']
  else:assert row['model_sha256']==sha(ROOT/it['model']) and row['source_sha256']==sha(ROOT/it['sourceBlend']) and row['source_reexport_normals_match']
for h in json.loads((HERE/'shared-helper-hashes.json').read_text())['files']:assert sha(ROOT/h['path'])==h['sha256'],'Shared helper changed'
for it in items:
 validation_path=ROOT/it['validation'];validation=json.loads(validation_path.read_text())
 validation['triangle_budget']=4200 if it['id']=='rpg-mansion-chesterfield-three-01' else 4000
 if it['id']=='rpg-mansion-chesterfield-three-01':validation['triangle_budget_reason']='Rounded upholstered arm-cap shoulders and recessed tuft geometry; explicit parent-approved 4200 ceiling'
 validation_path.write_text(json.dumps(validation,indent=2)+'\n')
 it['hashes']={k:sha(ROOT/it[k])for k in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation']}
 it['sha256']=it['hashes']['model'];it['sourceSha256']=it['hashes']['sourceBlend'];it['authoringSha256']=it['hashes']['authoringBlend']
 v=json.loads((ROOT/it['validation']).read_text());it['triangles']=v['triangles'];it['glbBytes']=(ROOT/it['model']).stat().st_size;it['triangleBudget']=4200 if it['id']=='rpg-mansion-chesterfield-three-01' else 4000
 assert v['glb_sha256']==it['sha256'] and v['source_sha256']==it['sourceSha256'],'Stale source validation'
(HERE/'descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',name='洋館・ソファ十八種',items=items),ensure_ascii=False,indent=2)+'\n')
for p in plan['items']:p['state']='producer-complete-pending-independent-and-parent-review'
plan['status']='All18 built; producer source/byte/normal/contact QA passed; release acceptance pending'
(HERE/'production-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
rights=json.loads((HERE/'rights-and-provenance.json').read_text())
rights['generatorFiles']={n:sha(HERE/n)for n in ['build.py','forms.py','native_utils.py']}
rights['sourceSha256']=sha(HERE/'build.py');rights['assets']=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in items]
(HERE/'rights-and-provenance.json').write_text(json.dumps(rights,indent=2)+'\n')
files=set()
for it in items:
 for key in ['model','thumb','top','front','rear','sourceBlend','authoringBlend','validation','builder']:files.add(it[key])
for name in ['forms.py','native_utils.py','render_batch.py','qa_native.py','qa_bytes.py','qa_normals_dedupe.py','qa_coplanar.py','qa_exact_replay.py','repair_welt_normals.py','qa_prototype_delta.py','make_contact_sheet.py','freeze_delivery.py','README.md','standard-sofa-demand.json','production-plan.json','shared-helper-hashes.json','rights-and-provenance.json','descriptors.json','qa/native.json','qa/bytes.json','qa/normals-dedupe.json','qa/coplanar.json','qa/exact-replay.json','qa/shading-only-repair.json','qa/prototype-repair-delta.json']:
 p=HERE/name
 if p.exists():files.add(str(p.relative_to(ROOT)))
for p in (HERE/'evidence').glob('*.jpg'):
 if p.name!='prototype-contact-sheet.jpg':files.add(str(p.relative_to(ROOT)))
rows=[dict(path=p,bytes=(ROOT/p).stat().st_size,sha256=sha(ROOT/p))for p in sorted(files)]
manifest=dict(phase='producer-complete-review-candidate',items=len(items),structuralDesignFamilies=15,explicitVariants=3,complete_batch=True,releaseAccepted=False,independentQaPending=True,parentFinalVisualReviewPending=True,sharedHelpersReusedUnmodified=True,excludedTemporaryReexports=True,files=rows,totalBytes=sum(r['bytes']for r in rows))
(HERE/'delivery-files.json').write_text(json.dumps(manifest,indent=2)+'\n')
(HERE/'SHA256SUMS.txt').write_text(''.join(r['sha256']+'  '+r['path']+'\n'for r in rows))
checkpoint=dict(phase='producer-complete-review-candidate',planned_count=18,built_count=len(items),structural_design_families=15,explicit_variants=3,batch_not_started_pending_visual_review=False,prototype_visual_approved=True,release_accepted=False,independent_qa_pending=True,parent_final_visual_review_pending=True,source_demand_profiles=61,source_catalogue_ids=62,actual_source_geometry_available=5,legacy_geometry_comparison='Declared dimensions only; no absent source geometry measured or copied',model_bytes=sum(i['glbBytes']for i in items),triangles=sum(i['triangles']for i in items),preview_count=72,native_qa_errors=0,byte_qa_errors=0,normals_dedupe_qa_errors=0,coplanar_visible_surface_errors=0,exact_source_replay_errors=0,delivery_frozen=True,descriptor_sha256=sha(HERE/'descriptors.json'),allowlist_sha256=sha(HERE/'delivery-files.json'),sha256sums_sha256=sha(HERE/'SHA256SUMS.txt'),frozen_files=len(rows),next_step='Independent QA against exact frozen allowlist and parent final visual review; no release acceptance or remote publication claimed',scope='Isolated new sofa assets/tools/metadata only; no shared manifest or application changes')
(HERE/'PRODUCTION-CHECKPOINT.json').write_text(json.dumps(checkpoint,indent=2)+'\n')
print('SOFA_FAMILY_SEALED',len(items),len(rows),checkpoint['model_bytes'],checkpoint['triangles'],checkpoint['allowlist_sha256'])
