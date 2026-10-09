"""Render only repaired geometry and record the exact source/render snapshot."""
import sys, json, hashlib
from pathlib import Path
import bpy
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sys.path.insert(0,str(H));sys.path.insert(0,str(H.parent))
import build
import qa_support as qa
qa.ROOT=ROOT
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
items=json.loads((H/'storage-items.json').read_text())['items']
checkpoint=json.loads((H/'repair-checkpoint.json').read_text())
repairs={r['id']:r for r in checkpoint['items']}
out=H/'render-source-snapshot.json'
rows=json.loads(out.read_text())['items'] if out.exists() else []
for item in items:
    source=ROOT/item['sourceBlend'];source_hash=sha(source)
    model=ROOT/item['model'];doc,binary=qa.load_glb(model)
    signature=qa.shape_signature(doc,qa.scene_geometry(doc,binary))
    existing=next((r for r in rows if r['id']==item['id']),None)
    valid=existing and existing['sourceSha256']==source_hash and all(
        sha(ROOT/item[k])==existing['images'][k]['sha256'] for k in ['thumb','top','front','rear'])
    changed=repairs[item['id']]['geometryChanged']
    if changed and not valid:
        bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
        obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        for view in ['thumb','top','front','rear']:
            build.render(obj,ROOT/item[view],view)
            print('RENDER_VIEW_READY',item['id'],view,flush=True)
    if not changed:
        assert signature['point_support']==checkpoint['baseline'][item['id']]['geometrySignature']['point_support']
        assert all(sha(ROOT/item[k])==checkpoint['baseline'][item['id']]['files'][item[k]] for k in ['thumb','top','front','rear'])
    row={'id':item['id'],'source':item['sourceBlend'],'sourceSha256':source_hash,
         'glbSha256':sha(model),'geometrySignature':signature,
         'rerenderedAfterJoineryRepair':changed,
         'images':{k:{'path':item[k],'sha256':sha(ROOT/item[k])} for k in ['thumb','top','front','rear']},
         'renderContract':'512x512 transparent Cycles, saved canonical geometry, -Y front in Blender',
         'unchangedGeometryRenderReuseVerified':not changed}
    rows=[r for r in rows if r['id']!=item['id']]+[row]
    out.write_text(json.dumps({'items':rows},indent=2)+'\n')
    print('RENDER_SNAPSHOT_READY',item['id'],flush=True)
