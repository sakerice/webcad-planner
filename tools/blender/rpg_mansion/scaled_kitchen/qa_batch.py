"""Independent actual-byte/source/hash gates for this isolated kitchen batch."""
from pathlib import Path
import json,sys,subprocess,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent))
import qa_asset_delivery as qa
qa.ROOT=ROOT
items=json.loads((HERE/'descriptors.json').read_text())['items']
only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
if only:items=[it for it in items if it['id'] in only]
reports=[qa.audit_item(it) for it in items]
for it,row in zip(items,reports):
 for key in ['front','rear']:
  im=qa.png_report(ROOT/it[key])
  if im['mode']!='RGBA' or im['alpha_min']!=0 or not im['nonempty_pixels'] or im['edge_nontransparent_pixels']:row['errors'].append('Invalid transparent unclipped '+key+' inspection image')
 for key in ['model','thumb','top','sourceBlend','validation','builder','front','rear']:
  row.setdefault('fileHashes',{})[key]=qa.sha256(ROOT/it[key])
 if row['bytes']>1000000:row['errors'].append('Single GLB exceeds 1MB')
result=dict(items=reports,actualModelBytes=sum(r['bytes'] for r in reports),actualTriangles=sum(r['triangles'] for r in reports),errors=sum(len(r['errors']) for r in reports),runtimeVisualQA='not performed by this byte/source checker')
(HERE/'actual-byte-qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('ACTUAL_BYTES_ERRORS',result['errors'],flush=True)
if '--sources' in sys.argv:
 out=HERE/'qa';out.mkdir(exist_ok=True);request=out/'source-request.json';response=out/'source-response.json'
 request.write_text(json.dumps([dict(id=it['id'],source=str(ROOT/it['sourceBlend'])) for it in items],indent=2)+'\n')
 subprocess.run(['/usr/bin/blender','-b','-t','2','--factory-startup','--python',str(HERE/'qa_sources.py'),'--','--source-request',str(request),'--source-response',str(response),'--output',str(out)],check=True)
 source=qa.compare_source_reports(json.loads(response.read_text()),reports)
 # Require full original part editing, not only a recoverable joined mesh.
 for row in source:
  if row.get('authoring_parts_mesh_objects',0)<2:row['errors'].append('Missing separate named native authoring parts')
  for field in ['source','source_reexport']:
   if row.get(field):row[field]=str(Path(row[field]).relative_to(ROOT))
 errors=sum(len(r['errors']) for r in source)
 (HERE/'reopened-source-qa.json').write_text(json.dumps(dict(items=source,errors=errors),ensure_ascii=False,indent=2)+'\n')
 print('SOURCE_ERRORS',errors,flush=True)
 assert not errors
assert not result['errors'], [(r['id'],r['errors']) for r in reports if r['errors']]
