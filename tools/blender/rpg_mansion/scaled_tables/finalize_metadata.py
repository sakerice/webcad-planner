"""Record stable final deliverable bytes/hashes and source inspection requests."""
import json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
path=HERE/'descriptors.json';items=json.loads(path.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for a in items:
    validation=json.loads((ROOT/a['validation']).read_text())
    validation['glb_bytes']=(ROOT/a['model']).stat().st_size
    validation['glb_sha256']=sha(ROOT/a['model'])
    validation['canonical_source_sha256']=sha(ROOT/a['sourceBlend'])
    validation['authoring_source_sha256']=sha(ROOT/a['authoringBlend'])
    (ROOT/a['validation']).write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
    a['measuredTriangles']=validation['triangles'];a['glbBytes']=(ROOT/a['model']).stat().st_size
    a['triangleBudget']=6000 if a['id'] in ['rpg-mansion-oval-pedestal-dining-01','rpg-mansion-drum-library-table-01'] else 4000
    a['nativeScene']='Native authoring parts'
    fields=['model','thumb','top','front','rear','sourceBlend','authoringBlend','exportBlend','validation','builder']
    a['hashes']={k:sha(ROOT/a[k]) for k in fields}
path.write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
(HERE/'source-request.json').write_text(json.dumps([{'id':a['id'],'source':a['sourceBlend']} for a in items],indent=2)+'\n')
summary={'assetCount':len(items),'modelBytes':sum(a['glbBytes'] for a in items),'triangles':sum(a['measuredTriangles'] for a in items),
         'minTriangles':min(a['measuredTriangles'] for a in items),'maxTriangles':max(a['measuredTriangles'] for a in items),
         'under4000Triangles':sum(a['measuredTriangles']<4000 for a in items),'maximumIndividualModelBytes':max(a['glbBytes'] for a in items),
         'canonicalSourceBytes':sum((ROOT/a['sourceBlend']).stat().st_size for a in items),
         'authoringCheckpointBytes':sum((ROOT/a['authoringBlend']).stat().st_size for a in items),
         'descriptorSha256':sha(path),'builderSha256':sha(HERE/'build.py'),
         'originalGeometry':True,'downloadedGeometry':False,'imageTextures':False,'paidGeneration':False,
         'staticAssets':True,'externalSources':[],
         'sourceFormat':'Canonical active combined one-mesh scene plus secondary Native authoring parts scene; separate authoring-only checkpoints',
         'scope':'Asset files and family-local production/QA only. No application code, shared manifest, git, remote, merge or deployment changes.',
         'items':[{'id':a['id'],'w':a['w'],'d':a['d'],'h':a['h'],'triangles':a['measuredTriangles'],'bytes':a['glbBytes'],'sha256':a['hashes']['model']} for a in items]}
(HERE/'delivery-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ['items','scope','sourceFormat']},indent=2))
