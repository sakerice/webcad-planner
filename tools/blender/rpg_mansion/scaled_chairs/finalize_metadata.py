"""Bind all descriptor deliverables to their actual final bytes before QA."""
import json,hashlib
from pathlib import Path
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
plan=json.loads((H/'production-plan.json').read_text())['items'];data=json.loads((H/'descriptors.json').read_text());by={i['id']:i for i in data['items']}
assert len(by)==24 and set(by)=={p['id']for p in plan}
for p in plan:
 i=by[p['id']];i['name']=p['name'];i['geometrySignature']=p['geometrySignature'];i['coverageTarget']=p;i['capacity']=p['capacity']
 i['placementNotes']='Static original period-adapted manual alternative. Seat top 460 mm. No interactive rocking, folding or adjustment mechanism. Declared legacy footprint references are metadata-only and do not establish geometry, role or clearance equivalence.'
 for key in ['model','sourceBlend','exportBlend','authoringBlend','validation','thumb','top','front','rear']:
  path=ROOT/i[key];assert path.is_file();i['hashes'][key]=hashlib.sha256(path.read_bytes()).hexdigest()
 if i['id']=='rpg-mansion-prayer-01':i['placementNotes']+=' Low support is a footrest, not an accessible kneeling platform.'
 data['items']=[by[p['id']]for p in plan]
(H/'descriptors.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('FINAL_DESCRIPTORS',len(data['items']))
