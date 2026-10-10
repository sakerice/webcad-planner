"""Original periodic texture authoring. Requires Python, NumPy, SciPy and Pillow.
Run from any directory: python generate_order_textures.py
All fields are analytically periodic in physical millimetres. Diffuse output is
sRGB; normal/roughness are linear encoded JPEG values (no gamma conversion).
OpenGL normals: +Y is upward in UV, opposite increasing image-row coordinate.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image
N=1024
ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'assets/textures/mansion'; OUT.mkdir(parents=True,exist_ok=True)
TILE=Path(__file__).parent/'tiling'; TILE.mkdir(exist_ok=True)
rng=np.random.default_rng(20261010)
x,y=np.meshgrid((np.arange(N)+.5)/N,(np.arange(N)+.5)/N)
def noise(x,y,seed=0):
 r=np.random.default_rng(seed); z=np.zeros_like(x)
 for k in range(1,23):
  a,b=r.integers(-32,33,2); phase=r.uniform(0,2*np.pi)
  z+=np.sin(2*np.pi*(a*x+b*y)+phase)/k
 return z/3
x=np.mod(x,1.0); y=np.mod(y,1.0)  # periodic physical tile coordinates
fine=noise(x,y,2); broad=noise(x,y,17)
def normal_from_height(height,size):
 dx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*size/N)
 dy=(np.roll(height,-1,0)-np.roll(height,1,0))/(2*size/N)
 normal=np.stack([-dx,dy,np.ones_like(dx)],axis=-1)
 normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 return normal*.5+.5
# Executed convention test using the same function as exported maps.
probe=normal_from_height(np.sin(2*np.pi*x)+np.sin(2*np.pi*y),530)
assert probe[0,0,0]<.5 and probe[0,0,1]>.5
assert probe[N//2,N//2,0]>.5 and probe[N//2,N//2,1]<.5
def save(key,size,col,height,rough):
 col=np.clip(col,0,1); height=np.asarray(height)
 normal=normal_from_height(height,size)
 for kind,arr in [('diffuse',col),('normal',normal),('roughness',np.clip(rough,0,1))]:
  if arr.ndim==2:arr=np.repeat(arr[:,:,None],3,axis=2)
  im=Image.fromarray(np.round(arr*255).astype('uint8'),'RGB'); im.save(OUT/f'{key}_{kind}.jpg',quality=(90 if kind=='normal' and key in ['mansion_brick_red','mansion_slate_roof','mansion_white_subway_tile','mansion_wainscot_panel'] else 85),subsampling=0)
 tile=Image.fromarray(np.round(col*255).astype('uint8')).resize((512,512),Image.Resampling.LANCZOS)
 sheet=Image.new('RGB',(1024,1024))
 for p in [(0,0),(512,0),(0,512),(512,512)]:sheet.paste(tile,p)
 sheet.save(TILE/f'{key}.jpg',quality=85,subsampling=0)
 # Boundary differences should resemble regular adjacent-pixel differences.
 metrics={}
 for name,arr in [('diffuse',col),('height',height),('roughness',rough)]:
  edge=np.concatenate([(arr[:,0]-arr[:,-1]).ravel(),(arr[0]-arr[-1]).ravel()])
  adj=np.concatenate([np.diff(arr,axis=0).ravel(),np.diff(arr,axis=1).ravel()])
  metrics[name]={'boundary_mean_abs':float(np.abs(edge).mean()),'interior_mean_abs':float(np.abs(adj).mean()),'boundary_max_abs':float(np.abs(edge).max())}
 return {'key':key,'tile_mm':size,'size_px':N,'normal_convention':'OpenGL +Y up; image-row derivative positive in encoded Y','maps':['diffuse','normal','roughness'],'seam_metrics':metrics}
results=[]
# Ashlar: four staggered courses. Module 600x300 includes 5mm mortar.
px=x*1200; py=y*1200; row=np.floor(py/300).astype(int)%4; sx=(px+(row%2)*300)%600; sy=py%300
edge=np.minimum.reduce([sx,600-sx,sy,300-sy]); stone=np.clip((edge-2.5)/1.8,0,1)
idc=np.floor((px+(row%2)*300)/600).astype(int)%2
variation=np.sin(row*2.4+idc*3.7)*.022
col=np.array([.61,.568,.478])[None,None,:]+(fine*.005+broad*.008+variation)[...,None]
col=col*stone[...,None]+np.array([.43,.423,.40])*(1-stone[...,None])
height=stone*(2.3+fine*.30+broad*.15)
results.append(save('mansion_ashlar_stone',1200,col,height,.87+fine*.025-stone*.035))
# Original crisp classical damask, drawn from cubic curves at 2x resolution.
from PIL import ImageDraw
ornament=Image.new('L',(N*2,N*2),0); draw=ImageDraw.Draw(ornament)
def bezier(points):
 p=np.array(points);t=np.linspace(0,1,30)[:,None]
 return (1-t)**3*p[0]+3*(1-t)**2*t*p[1]+3*(1-t)*t*t*p[2]+t**3*p[3]
def poly(points,fill=255):
 draw.polygon([(int(xx*N*2),int(yy*N*2)) for xx,yy in points],fill=fill)
def line(points,width=2,fill=255):
 draw.line([(int(xx*N*2),int(yy*N*2)) for xx,yy in points],fill=fill,width=width,joint='curve')
for cy in [-.5,.5,1.5]:
 for cx in [-.5,.5,1.5]:
  # Central spear-shaped flower petals.
  for sign in [-1,1]:
   for level in [-.22,-.10,.035,.17]:
    base=(cx,cy+level+.095); tip=(cx+sign*.205,cy+level-.075)
    outer=bezier([base,(cx+sign*.21,cy+level+.11),(cx+sign*.08,cy+level-.03),tip])
    inner=bezier([tip,(cx+sign*.16,cy+level+.055),(cx+sign*.05,cy+level+.01),base])
    poly(np.vstack([outer,inner]))
    detail=bezier([base,(cx+sign*.055,cy+level+.015),(cx+sign*.12,cy+level+.025),tip])
    line(detail,width=3,fill=70)
   # Pair of curling acanthus scrolls and small upper curls.
   stem=bezier([(cx,cy+.38),(cx+sign*.36,cy+.18),(cx+sign*.36,cy-.19),(cx+sign*.21,cy-.30)])
   line(stem,width=8)
   th=np.linspace(0,2*np.pi*1.2,140);radius=np.linspace(.085,.006,len(th))
   curl=np.column_stack([cx+sign*(.18+radius*np.cos(th)),cy-.265+radius*np.sin(th)])
   line(curl,width=6)
  spear=bezier([(cx,cy-.38),(cx-.065,cy-.23),(cx-.05,cy-.18),(cx,cy-.12)])
  other=bezier([(cx,cy-.12),(cx+.05,cy-.18),(cx+.065,cy-.23),(cx,cy-.38)])
  poly(np.vstack([spear,other]))
  line([(cx,cy-.32),(cx,cy+.34)],width=5)
motif=np.asarray(ornament.resize((N,N),Image.Resampling.LANCZOS))/255
weave=np.sin(2*np.pi*x*256)*np.sin(2*np.pi*y*256)
col=np.array([.105,.205,.157])+motif[...,None]*np.array([.060,.077,.052])+(fine*.002+weave*.0004)[...,None]
results.append(save('mansion_damask_wallpaper',530,col,motif*.12+weave*.005,.93-motif*.035+fine*.006))
# Exact herringbone domino tessellation: 70x350mm boards, periodic 20-unit tile.
X=x*20; Y=y*20; col=np.zeros((N,N,3)); height=np.zeros((N,N)); rough=np.zeros((N,N)); coverage=np.zeros((N,N),np.uint8)
for a in range(-5,8):
 for b in range(-30,31):
  ox,oy=5*a+b,5*a-b
  for orient,xx,yy,w,h in [(0,ox,oy,5,1),(1,ox+5,oy,1,5)]:
   m=(X>=xx)&(X<xx+w)&(Y>=yy)&(Y<yy+h)
   if not m.any():continue
   coverage[m]+=1
   lx=X[m]-xx; ly=Y[m]-yy; along=lx if orient==0 else ly; cross=ly if orient==0 else lx
   # Stable identity on a 20x20 period.
   ident=((xx%20)*13+(yy%20)*17+orient*31)%97
   phase=ident*.79
   flow=cross*(43+4*np.sin(phase))+np.sin(along*(.65+.15*np.sin(phase))+phase)*2.4+np.sin(along*2.2+phase)*.45
   grain=np.sin(flow+phase)*.007+np.sin(flow*2.13+phase)*.003+np.exp(-(np.sin(flow*.51+phase)/.12)**2)*-.008
   tint=np.sin(ident*1.71)*.024
   c=np.array([.365,.285,.203])+tint+grain[:,None]+fine[m,None]*.009
   ed=np.minimum.reduce([lx,w-lx,ly,h-ly])*70
   bevel=np.clip(ed/.65,0,1)
   col[m]=c*bevel[:,None]+np.array([.16,.12,.085])*(1-bevel[:,None])
   height[m]=bevel*.55+grain*.06; rough[m]=.60+grain*.5+tint*.4
assert np.all(coverage==1), 'herringbone partition must cover exactly once'
results.append(save('mansion_herringbone_oak',1400,col,height,rough))
# Individual original marble mineral fields; each slab has its own orientation,
# curving main veins, subordinate branches and variable mineral deposit widths.
checker=(np.floor(x*2).astype(int)+np.floor(y*2).astype(int))%2
col=np.zeros((N,N,3));vein=np.zeros((N,N))
for iy in range(2):
 for ix in range(2):
  m=(np.floor(x*2)==ix)&(np.floor(y*2)==iy)
  qx=x[m]*2-ix; qy=y[m]*2-iy; seed=ix+iy*2+5
  ang=[.38,-.61,1.02,-.28][seed-5];phase=seed*1.37
  u=(qx-.5)*np.cos(ang)-(qy-.5)*np.sin(ang)
  v=(qx-.5)*np.sin(ang)+(qy-.5)*np.cos(ang)
  field=np.zeros_like(u)
  for j in range(3):
   center=[-.29,.045,.36][j]+.055*np.sin(v*(4.1+j*.8)+phase+j)+.031*np.sin(v*13.3+phase*.8+j)+.010*np.sin(v*37.7+phase+j*2)+.004*np.sin(v*93.1+phase*.4+j)
   width=.0025+.006*(.5+.5*np.sin(v*17.3+phase+j))+.003*(.5+.5*np.sin(v*53.9+phase))
   dist=u-center
   field+=np.exp(-(dist/width)**2)*(.42+.24*np.sin(v*2.3+phase+j)**2)
   branch=center+(j+1)*.095*np.maximum(v+.27-j*.11,0)+.012*np.sin(v*23+phase+j)+.004*np.sin(v*89+phase)
   field+=np.exp(-((u-branch)/(width*.40))**2)*.37*np.clip((v+.35)*3,0,1)
  field=np.clip(field,0,1);vein[m]=field
  white=np.array([.795,.800,.785])-field[:,None]*np.array([.13,.13,.12])+fine[m,None]*.002
  black=np.array([.103,.112,.116])+field[:,None]*.018+fine[m,None]*.001
  col[m]=white if (ix+iy)%2==0 else black
results.append(save('mansion_marble_checker',800,col,fine*.006,.245+fine*.008+vein*.01))
# New material microstructure uses original seeded stochastic fields, wrapped.
from scipy.ndimage import gaussian_filter
raw=np.random.default_rng(2026101001).normal(size=(N,N))
micro=gaussian_filter(raw,1.5,mode='wrap');micro/=micro.std()
mineral=gaussian_filter(raw,14,mode='wrap');mineral/=mineral.std()
# English bond red brick: fixed 860mm tile, 10mm mortar, twelve courses.
# Alternate 4 stretcher modules (215mm pitch) and 8 header modules (107.5mm).
px=x*860; py=y*860; pitch_y=860/12
row=np.floor(py/pitch_y).astype(int); pitch_x=np.where(row%2==0,215.,107.5)
sx=(px+np.where(row%2==0,0,53.75))%pitch_x; sy=py%pitch_y
edge=np.minimum.reduce([sx,pitch_x-sx,sy,pitch_y-sy]);mask=np.clip((edge-5)/1.0,0,1)
colid=np.floor((px+np.where(row%2==0,0,53.75))/pitch_x).astype(int)
variation=.022*np.sin(row*2.73+colid*1.96)
brick=np.array([.405,.222,.167])+(micro*.005+mineral*.006+variation)[...,None]
col=brick*mask[...,None]+np.array([.61,.598,.565])*(1-mask[...,None])
results.append(save('mansion_brick_red',860,col,mask*(.9+fine*.07),.86+fine*.025-mask*.025))
# Natural slate with staggered 300mm modules and 200mm exposed courses.
px=x*1200;py=y*1200;row=np.floor(py/200).astype(int)
sx=(px+(row%2)*150)%300;sy=py%200
phase=(row%2)*150
sx=(px+phase)%300
edge=np.minimum(sx,300-sx);joint=np.clip((edge-1.5)/1.0,0,1)
idc=np.floor((px+phase)/300).astype(int)%4
variation=.013*np.sin(row*3.6+idc*1.71)
slate=np.array([.182,.196,.205])+(micro*.003+mineral*.007+variation)[...,None]
lip=np.clip(sy/4,0,1)
col=slate*(.72+.28*joint[...,None])*(.91+.09*lip[...,None])
height=joint*(.4+fine*.08)+lip*.35
results.append(save('mansion_slate_roof',1200,col,height,.80+fine*.02+variation))
# Subway tile: exact 150x75mm joint-inclusive pitches, 147x72mm ceramic.
px=x*600;py=y*600;row=np.floor(py/75).astype(int)
sx=(px+(row%2)*75)%150;sy=py%75
edge=np.minimum.reduce([sx,150-sx,sy,75-sy]);mask=np.clip((edge-1.5)/1.1,0,1)
ceramic=np.array([.855,.850,.822])+(fine*.0018+broad*.0012)[...,None]
col=ceramic*mask[...,None]+np.array([.63,.635,.61])*(1-mask[...,None])
results.append(save('mansion_white_subway_tile',600,col,mask*.40,.27*mask+.86*(1-mask)+fine*.006))
# Full-height walnut wainscot. Horizontal repeat only; no plaster included.
px=x*900;py=y*900;sx=px%100
edge=np.minimum(sx,100-sx);join=np.clip((edge-1.2)/1.1,0,1)
board=np.floor(px/100).astype(int)
flow=sx*.42+np.sin(py/230+board)*1.8+np.sin(py/89+board)*.35
grain=np.sin(flow+mineral*.4)*.004+np.sin(flow*2.31+board)*.0015+micro*.0008
variation=.009*np.sin(board*2.7)
wood=np.array([.255,.177,.119])+(grain+variation)[...,None]
# Skirting 80mm; upper capping 30mm, two shallow moulding grooves.
cap=(py<30)|(py>820)
groove=np.exp(-((py-25)/2.0)**2)+np.exp(-((py-827)/2.0)**2)
col=wood*(.65+.35*join[...,None])*(1-groove[...,None]*.12)
height=join*.4+cap*.3-groove*.16
results.append(save('mansion_wainscot_panel',900,col,height,.64+grain*.6))
report={'generator':'generate_order_textures.py','external_assets':False,'seed':20261010,'textures':results,'ashlar_dimensions_mm':{'module':[600,300],'stone_body':[595,295],'mortar':5},'herringbone_mm':[70,350],'marble_square_mm':400,'approved_adjustments_mm':{'brick':{'tile':860,'mortar':10,'course_pitch':860/12,'stretcher_body':[205,860/12-10],'header_body':[97.5,860/12-10]},'slate':{'tile':1200,'slab_width':300,'slab_length':600,'exposed_height':200,'half_stagger':150,'courses':6},'subway':{'tile':600,'ceramic_body':[147,72],'mortar':3,'pitch':[150,75]},'wainscot':{'height':900,'horizontal_tile':900,'board_pitch':100,'repeat':'horizontal only','plaster':'excluded; implementation separate'}},'normal_direction_test':{'executed_sine_probe_passed':True,'positive_height_gradient_uv_u':'normal red below 0.5','positive_height_gradient_uv_v':'normal green below 0.5','image_rows':'UV v decreases downward'}}
(Path(__file__).parent/'texture-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'root':str(ROOT),'texture_count':len(results),'bytes':sum(p.stat().st_size for p in OUT.glob('*.jpg')),'coverage':np.unique(coverage).tolist()}))
