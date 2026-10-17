"""Only rerender non-approved family views with insufficient transparent border."""
import json,sys
from pathlib import Path
import bpy
H=Path(__file__).resolve().parent;sys.path.insert(0,str(H));import build
# Blender's built-in PNG loader avoids a Pillow dependency inside its Python.
def margin(path):
 im=bpy.data.images.load(str(path),check_existing=False);w,h=im.size;px=im.pixels[:];xs=[];ys=[]
 for y in range(h):
  for x in range(w):
   if px[(y*w+x)*4+3]>0:xs.append(x);ys.append(y)
 bpy.data.images.remove(im)
 return min(min(xs),min(ys),w-1-max(xs),h-1-max(ys))
items=json.loads((H/'bed-items.json').read_text())['items'];frozen=json.loads((H/'approved-prototype-snapshot/immutable-files.json').read_text())['ids']
for item in items:
 for key in ['thumb','top','front','rear']:
  path=build.ROOT/item[key];before=margin(path)
  if before>=12:continue
  assert item['id']not in frozen, 'Approved prototype requires a separate real-defect review'
  bpy.ops.wm.open_mainfile(filepath=str(build.ROOT/item['exportBlend']));ob=next(o for o in bpy.context.scene.objects if o.type=='MESH');build.render(ob,path,key);after=margin(path);print('BED_CAMERA_REPAIRED',item['id'],key,before,after,flush=True);assert after>=12
