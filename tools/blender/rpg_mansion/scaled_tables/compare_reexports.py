"""Compare generic reopened-source exports with final actual-byte geometry."""
import json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
import qa_asset_delivery as qa
actual=json.loads((HERE/'actual-byte-qa.json').read_text())['items']
sources=json.loads((HERE/'generic-source-qa.json').read_text())
qa.compare_source_reports(sources,actual)
for row in sources:
    document,_=qa.load_glb(Path(row['source_reexport']))
    row['reexportMeshCount']=len(document.get('meshes',[]));row['reexportSceneCount']=len(document.get('scenes',[]))
    if row['reexportMeshCount']!=1 or row['reexportSceneCount']!=1:row['errors'].append('Canonical re-export must have exactly one mesh and one active scene')
(HERE/'generic-source-qa.json').write_text(json.dumps(sources,indent=2)+'\n')
errors=sum(len(a['errors']) for a in sources)
assert len(sources)==len(actual)
print('GENERIC_SOURCE_EXPORT_COMPARE_ERRORS',errors)
assert not errors
