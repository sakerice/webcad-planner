"""Final actual-byte checks for prototype review, including full payload privacy.

Read-only sources; writes reports and neutral contact sheets only. Canonical
sources and geometry never change here. No remote or app integration is implied.
"""
from pathlib import Path
import json,hashlib,re
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import zstandard
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
write=lambda p,d:p.write_text(json.dumps(d,indent=2)+'\n')
rel=lambda p:str(p.relative_to(ROOT))
D=json.loads((H/'descriptors.json').read_text())['items']


def image_replay():
 rows=[]
 for fn,expected in [('source-replay-inputs.json',len(D)),('assembly-replay-inputs.json',1)]:
  receipt=json.loads((H/fn).read_text());assert receipt['complete'] and len(receipt['items'])==expected,(fn,'Incomplete')
  for row in receipt['items']:
   result=dict(id=row.get('id',row.get('name')),source=row['source'],sourceSha256=sha(ROOT/row['source']),sourceUnchanged=row['sourceSha256']==sha(ROOT/row['source']),views=[],errors=[])
   if not result['sourceUnchanged']:result['errors'].append('Source hash changed after replay')
   for v in row['views']:
    a=np.asarray(Image.open(ROOT/v['deliveredPath']).convert('RGBA'));b=np.asarray(Image.open(ROOT/v['replayedPath']).convert('RGBA'));exact=np.array_equal(a,b);delta=np.abs(a.astype(int)-b.astype(int));result['views'].append(dict(view=v['view'],deliveredPath=v['deliveredPath'],deliveredSha256=sha(ROOT/v['deliveredPath']),replayedPath=v['replayedPath'],replayedSha256=sha(ROOT/v['replayedPath']),exactRgbaPixels=bool(exact),differentPixels=int(np.any(a!=b,axis=2).sum()),maximumChannelDelta=int(delta.max()),meanChannelDelta=float(delta.mean())))
    if not exact:result['errors'].append(v['view']+' exact RGBA source replay failed')
    if sha(ROOT/v['deliveredPath'])!=v['deliveredSha256']or sha(ROOT/v['replayedPath'])!=v['replayedSha256']:result['errors'].append(v['view']+' replay hash binding stale')
   rows.append(result)
 report=dict(method='Decoded RGBA comparison after reopening saved delivery sources and running their recorded camera recipes, without rebuilding or saving sources',items=rows,viewCount=sum(len(r['views'])for r in rows),errors=[r['id']+': '+e for r in rows for e in r['errors']]);write(H/'image-replay-qa.json',report);print('IMAGE_REPLAY',report['viewCount'],'views',len(report['errors']),'errors');return report


def privacy():
 paths=[(it['id'],key,ROOT/it[key])for it in D for key in ['sourceBlend','authoringBlend']]+[(p.stem,'assemblySource',p)for p in sorted((H/'assemblies').glob('*.blend'))];rows=[]
 for id,kind,path in paths:
  data=path.read_bytes();compressed=data[:4]==bytes.fromhex('28b52ffd')
  if compressed:
   with zstandard.ZstdDecompressor().stream_reader(path.open('rb'))as reader:data=reader.read()
  count=len(re.findall(rb'/(?:workspace|root|home|tmp)(?:/[^\x00\s]*)?(?=[\x00\s]|$)',data));rows.append(dict(id=id,kind=kind,path=rel(path),sha256=sha(path),compressed=compressed,decodedBytes=len(data),privateAbsolutePathOccurrences=count,errors=(['Uncompressed source']if not compressed else[])+(['Private path retained in saved native payload/UI']if count else[])))
 report=dict(method='Decompress full native payload including saved UI state; count private absolute path patterns without publishing private strings',items=rows,sourceCount=len(rows),errors=[r['id']+': '+e for r in rows for e in r['errors']]);write(H/'all-source-privacy-qa.json',report);print('PRIVACY',len(rows),'sources',len(report['errors']),'errors');return report


def borders():
 paths=[(it['id'],v,ROOT/it[v])for it in D for v in ['thumb','top','front','rear']]+[(p.stem.rsplit('-',1)[0],p.stem.rsplit('-',1)[1],p)for p in sorted((H/'assemblies').glob('*.png'))];rows=[]
 for id,v,path in paths:
  with Image.open(path)as im:
   a=np.array(im.getchannel('A'));y,x=np.nonzero(a>0);bbox=[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)];margins=[bbox[0],bbox[1],im.width-bbox[2],im.height-bbox[3]];rows.append(dict(id=id,view=v,path=rel(path),sha256=sha(path),resolution=list(im.size),alphaNonzeroBounds=bbox,marginsPixels=margins,minimumMarginPixels=min(margins),metadataKeys=sorted(im.info),errors=(['Visible geometry has less than 12 px border']if min(margins)<12 else[])+(['Unexpected image metadata']if set(im.info)-{'dpi','gamma','srgb','chromaticity'} else[])))
 report=dict(method='Actual decoded alpha > 0 extents including antialiasing; each edge requires at least 12 pixels',images=rows,imageCount=len(rows),minimumMarginPixels=min(r['minimumMarginPixels']for r in rows),errors=[r['id']+' '+r['view']+': '+e for r in rows for e in r['errors']]);write(H/'image-framing-qa.json',report);print('BORDERS',len(rows),'images',report['minimumMarginPixels'],'minimum',len(report['errors']),'errors');return report



def dimensions():
 import sys
 sys.path.insert(0,str(H.parent));import qa_asset_delivery as qa
 rows=[]
 for it in D:
  doc,binary=qa.load_glb(ROOT/it['model']);geo=qa.scene_geometry(doc,binary);pts=np.concatenate([r['positions']for r in geo]);lo=pts.min(axis=0);hi=pts.max(axis=0);actual=(hi-lo)[[0,2,1]]*1000;nominal=np.array([it[k]for k in ['w','d','h']]);errors=[];delta=actual-nominal
  if np.max(np.abs(delta))>it['dimensionToleranceMm']:errors.append('Measured GLB differs from practical nominal envelope beyond tolerance')
  for connection in it['moduleContract']['connections']:
   convert=lambda p:[p[0],p[2],-p[1]]
   if not np.allclose(connection['assetPointGltfM'],convert(connection['assetPointM']),rtol=0,atol=1e-12):errors.append('Exported asset connection point conversion differs')
   if not np.allclose(connection['constructionPointGltfM'],convert(connection['point']),rtol=0,atol=1e-12):errors.append('Exported construction connection point conversion differs')
   if not np.allclose(connection['normalGltf'],convert(connection['normal']),rtol=0,atol=1e-12):errors.append('Exported connection normal conversion differs')

  if abs(lo[1])>1e-6 or abs(lo[0]+hi[0])>1e-6 or abs(lo[2]+hi[2])>1e-6:errors.append('Actual GLB bottom centre origin is incorrect')
  rows.append(dict(id=it['id'],modelSha256=sha(ROOT/it['model']),actualGltfBoundsMetres=[lo.tolist(),hi.tolist()],actualEnvelopeWdhMm=actual.tolist(),nominalEnvelopeWdhMm=nominal.tolist(),differenceMm=delta.tolist(),toleranceMm=it['dimensionToleranceMm'],defaultElevationMm=it['defaultElevation'],gltfConnectionConversionChecked=True,placementExample=it['moduleContract']['placementExample'],errors=errors))
 report=dict(method='Decode actual GLB vertices, apply node transforms, measure extrema; nominal integer envelopes do not change mesh scale',items=rows,errors=[r['id']+': '+e for r in rows for e in r['errors']]);write(H/'dimensions-placement-qa.json',report);print('DIMENSIONS',len(rows),'assets',len(report['errors']),'errors');return report


def sheets():
 out=H/'review';out.mkdir(exist_ok=True);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13);title=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',22)
 def paste(canvas,path,x,y,edge):
  im=Image.open(path).convert('RGBA');im.thumbnail((edge,edge),Image.Resampling.LANCZOS);canvas.paste(im,(x+(edge-im.width)//2,y+(edge-im.height)//2),im)
 for page,items in enumerate([D[i:i+3] for i in range(0,len(D),3)],1):
  edge=300;pad=20;head=102;rowh=350;im=Image.new('RGB',(1240,head+rowh*len(items)+20),'#e9e7e0');dr=ImageDraw.Draw(im);dr.text((20,16),'Original architecture expansion: initial9 deliveries /8 families',font=title,fill='#202421');dr.text((20,49),'Static modules |1200 /600mm grid |3000mm wall datum | Page '+str(page),font=font,fill='#424840')
  for col,v in enumerate(['HERO / CEILING UNDERSIDE','TRUE TOP','FRONT','REAR']):dr.text((pad+col*edge,78),v,font=small,fill='#454d44')
  for row,it in enumerate(items):
   y=head+row*rowh
   for col,v in enumerate(['thumb','top','front','rear']):paste(im,ROOT/it[v],pad+col*edge,y,edge)
   dr.text((pad,y+300),it['name'],font=font,fill='#202421');dr.text((pad,y+325),f"{it['w']} W x {it['d']} D x {it['h']} H mm | {it['measuredTriangles']} triangles | {it['nativePartCount']} native parts"+(' |WIDTH-ONLY VARIANT' if it.get('variantOf') else ''),font=small,fill='#424840')
  im.save(out/('expansion-views-'+str(page)+'.png'))
 edge=480;head=90;rowh=530;im=Image.new('RGB',(1480,head+rowh*2+20),'#e9e7e0');dr=ImageDraw.Draw(im);dr.text((20,16),'Joined mansard room:41 actual module instances, no fixtures',font=title,fill='#202421');dr.text((20,50),'3600 x4800mm wall centrelines | Floor0 | Ceiling underside2860 | Wall/bearing3000 | Roof bottom2900mm',font=font,fill='#424840')
 views=[('exterior','Complete installed exterior'),('room-cutaway','Roof and ceiling omitted: actual room'),('ceiling-array','Only ceiling visible:12 joined coffers'),('roof-underside','Only roof visible: hollow shell and bearings'),('top','Complete installed true top'),('ceiling-underside','Floor omitted: installed ceiling from below')]
 for i,(v,caption) in enumerate(views):
  x=20+(i%3)*edge;y=head+(i//3)*rowh;paste(im,H/'assemblies'/('joined-mansard-room-'+v+'.png'),x,y,edge);dr.text((x,y+488),caption,font=font,fill='#202421')
 im.save(out/'joined-mansard-room.png');print('CONTACT_SHEETS',4)


if __name__=='__main__':
 import sys
 reports=[privacy(),borders(),dimensions()];sheets()
 if '--skip-replay'not in sys.argv:reports.append(image_replay())
 assert not any(r['errors']for r in reports),'See QA reports'
