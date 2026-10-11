"""Read exported GLB geometry, world transforms, material extras and image files.
Run with ordinary Python 3 (numpy, Pillow), after Blender regeneration.
These checks do not claim webcad integration or repository test success.
"""
from pathlib import Path
import json,struct,math,hashlib
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
SPECS=[('rpg-mansion-landscape-painting-1000-01',(1000,60,700)),('rpg-mansion-landscape-painting-1400-01',(1400,70,900)),('rpg-mansion-landscape-painting-1800-01',(1800,80,1100)),('rpg-mansion-wicker-laundry-basket-01',(600,450,600)),('rpg-mansion-lidded-laundry-box-01',(600,500,850))]
DT={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
N={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read_glb(p):
 b=p.read_bytes(); magic,v,n=struct.unpack_from('<4sII',b); assert magic==b'glTF' and v==2 and n==len(b)
 j=None; binary=None; pos=12
 while pos<len(b):
  size,t=struct.unpack_from('<II',b,pos); data=b[pos+8:pos+8+size]; pos+=8+size
  if t==0x4e4f534a: j=json.loads(data)
  elif t==0x004e4942: binary=data
 assert j and binary is not None
 return j,binary

def accessor(g,b,i):
 a=g['accessors'][i]; v=g['bufferViews'][a['bufferView']]; typ=np.dtype(DT[a['componentType']]); width=N[a['type']]; off=v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',typ.itemsize*width)
 return np.ndarray((a['count'],width),dtype=typ,buffer=b,offset=off,strides=(stride,typ.itemsize)).copy()

def transform(n):
 if 'matrix' in n: return np.array(n['matrix']).reshape(4,4).T
 t=np.array(n.get('translation',[0,0,0])); s=np.array(n.get('scale',[1,1,1])); x,y,z,w=n.get('rotation',[0,0,0,1]); rot=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
 m=np.eye(4); m[:3,:3]=rot@np.diag(s); m[:3,3]=t; return m

def run():
 results=[]
 for id,expected in SPECS:
  path=ROOT/'assets/models/packs/rpg-mansion/models'/f'{id}.glb'; g,b=read_glb(path); coords=[]; tris=0; normals=[]; fronts=[]
  def walk(ni,parent):
   nonlocal tris
   n=g['nodes'][ni]; world=parent@transform(n)
   if 'mesh' in n:
    for p in g['meshes'][n['mesh']]['primitives']:
     assert p.get('mode',4)==4, 'All geometry must be triangles'
     a=accessor(g,b,p['attributes']['POSITION']); xyz=(world@np.c_[a,np.ones(len(a))].T).T[:,:3]; coords.append(xyz)
     idx=accessor(g,b,p['indices']).ravel() if 'indices'in p else np.arange(len(a)); tris+=len(idx)//3
     if 'painting' in n.get('name','').lower():
      v=xyz[idx[:3]]; no=np.cross(v[1]-v[0],v[2]-v[0]); no/=np.linalg.norm(no); normals.append(no.tolist()); fronts.append(float(xyz[:,2].mean()))
   for c in n.get('children',[]): walk(c,world)
  for ni in g['scenes'][g.get('scene',0)]['nodes']: walk(ni,np.eye(4))
  pts=np.concatenate(coords); lo=pts.min(axis=0); hi=pts.max(axis=0); dim=(hi-lo)*1000; whd=dim[[0,2,1]]
  assert np.max(abs(whd-np.array(expected)))<.01,(id,whd)
  assert abs(lo[1])<.000001 and abs(lo[0]+hi[0])<.000001 and abs(lo[2]+hi[2])<.000001, 'Bottom-centred origin'
  assert tris<=20000,(id,tris)
  assert all('bufferView' in image and 'uri' not in image for image in g.get('images',[])), 'All images embedded in GLB'
  mats=[]
  for m in g['materials']:
   channel=m.get('extras',{}).get('finishChannel'); assert channel, m['name']; rgba=m['pbrMetallicRoughness'].get('baseColorFactor',[1,1,1,1]); rgb=rgba[:3]
   srgb=[12.92*x if x<=.0031308 else 1.055*x**(1/2.4)-.055 for x in rgb]; hexcolor='#'+''.join(f'{round(max(0,min(1,x))*255):02x}' for x in srgb)
   mats.append({'name':m['name'],'finishChannel':channel,'baseColorFactor_linear':rgba,'default_sRGB':hexcolor,'textured':'baseColorTexture' in m['pbrMetallicRoughness']})
  if 'painting' in id: assert normals and all(np.dot(no,[0,0,1])>.99999 for no in normals) and all(x>0 for x in fronts),'Canvas faces +Z'
  # Front pull at +Z / hinges at -Z are semantic orientation evidence for the closed box.
  box_front=[]
  if 'lidded' in id:
   for n in g['nodes']:
    if 'Front' in n.get('name','') and 'mesh' in n:
     p=g['meshes'][n['mesh']]['primitives'][0]; a=accessor(g,b,p['attributes']['POSITION']); xyz=(transform(n)@np.c_[a,np.ones(len(a))].T).T[:,:3]; box_front.append(float(xyz[:,2].mean()))
   assert box_front and all(x>0 for x in box_front)
  images=[]
  for tag in ['thumb','top','front','back']:
   p=ROOT/'assets/models/packs/rpg-mansion/previews'/f'{id}-{tag}.png' if tag in ['thumb','top'] else HERE/f'{id}-{tag}.jpg'
   im=Image.open(p); assert im.size==(512,512)
   if tag in ['thumb','top']:
    assert im.mode=='RGBA'; alpha=np.array(im.getchannel('A')); assert alpha.min()==0 and alpha.max()>200
   images.append({'file':str(p.relative_to(ROOT)),'size':list(im.size),'mode':im.mode})
  blend=HERE/f'{id}.blend'; assert blend.is_file() and blend.stat().st_size>10000
  results.append({'id':id,'measured_WDH_mm':[round(float(x),5) for x in whd],'bounds_glTF_m':{'min':lo.tolist(),'max':hi.tolist()},'triangles':tris,'canvas_world_normals':normals,'front_hardware_Z_m':box_front,'materials':mats,'images':images,'glb_bytes':path.stat().st_size,'blend_bytes':blend.stat().st_size,'sha256_glb':hashlib.sha256(path.read_bytes()).hexdigest(),'checks':'PASS geometry/export/materialExtras/images; visual review separate; app integration and repo tests NOT RUN'})
 out={'generator':'Blender 4.3.2, procedural original geometry and paintings','coordinateSystem':'glTF +Y up +Z front, metres, bottom-centre origin','models':results}
 (HERE/'models-validation-report.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)); print(json.dumps([{k:r[k] for k in ['id','measured_WDH_mm','triangles','glb_bytes','blend_bytes']} for r in results],ensure_ascii=False,indent=2))
if __name__=='__main__':run()
