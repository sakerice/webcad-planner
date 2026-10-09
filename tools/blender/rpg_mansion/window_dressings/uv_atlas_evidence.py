"""Draw the final exported TEXCOORD_0 atlas, colored by finish channel."""
from pathlib import Path
import sys,json,hashlib,struct
from PIL import Image,ImageDraw,ImageFont
import numpy as np
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'helpers'))
import qa_asset_delivery as q
colors={'fabric':'#408f9b','metal':'#cc7942','wood':'#916aa1','cord':'#6d9660','trim':'#c9a647'}
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
rows=[]
for it in json.load(open(HERE/'descriptors.json'))['items']:
 p=HERE/it['model'];doc,buf=q.load_glb(p);geo=q.scene_geometry(doc,buf);im=Image.new('RGB',(1024,1070),'#f4f2ea');d=ImageDraw.Draw(im);d.rectangle((10,10,1013,1013),outline='#aaa79d');triangles=0
 for g in geo:
  uv=g['uv'];ix=g['indices'];channel=doc['materials'][g['material']]['extras']['finishChannel']
  for ids in ix:
   pts=[(10+float(uv[j][0])*1003,1013-float(uv[j][1])*1003)for j in ids];d.polygon(pts,fill=colors[channel]);triangles+=1
 d.text((12,1025),it['name']+' | final exported UV atlas',font=font,fill='#313b38');d.text((12,1046),str(triangles)+' triangles | one metric atlas | colors follow finish channels',font=font,fill='#313b38')
 target=HERE/'evidence'/(it['id']+'-uv-atlas.png');im.save(target)
 rows.append(dict(id=it['id'],modelSha256=hashlib.sha256(p.read_bytes()).hexdigest(),atlas=str(target.relative_to(HERE)),statistics=q.uv_statistics(geo)))
(HERE/'reports/uv-atlas-evidence.json').write_text(json.dumps(dict(source='Actual final exported UV coordinates; no geometry regenerated',items=rows),indent=2)+'\n')
