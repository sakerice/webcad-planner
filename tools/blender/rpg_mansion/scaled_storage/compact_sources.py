"""Remove orphan datablocks only; preserve both live canonical scenes."""
import bpy,json,hashlib
from pathlib import Path
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
items=json.loads((H/'storage-items.json').read_text())['items'];rows=[]
for item in items:
 for key in ['sourceBlend','authoringBlend']:
  path=ROOT/item[key];old=path.stat().st_size;bpy.ops.wm.open_mainfile(filepath=str(path))
  bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
  bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path))
  rows.append({'id':item['id'],'kind':key,'beforeBytes':old,'afterBytes':path.stat().st_size,'scenes':[s.name for s in bpy.data.scenes]})
 item['sourceSha256']=hashlib.sha256((ROOT/item['sourceBlend']).read_bytes()).hexdigest()
(H/'storage-items.json').write_text(json.dumps({'set':'rpg-mansion','name':'洋館・収納家具','items':items},ensure_ascii=False,indent=2)+'\n')
(H/'source-compaction.json').write_text(json.dumps(rows,indent=2)+'\n')
