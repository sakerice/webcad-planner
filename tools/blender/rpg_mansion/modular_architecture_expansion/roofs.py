"""Original hollow mansard system.

Span: x eaves ±2.1, y repeat ±.6. Bearings x ±1.8, bottom z=.1.
Hip end: same join cross-section at y=0, eave y=-2.1, transverse bearing
centre y=-1.8. Local lower slope1.5 / upper slope5/12; knee x=1.2,z=1.35.
A span at0 with ends at y=-.6 and+.6 (latter rigidly rotated180°) covers
3600×4800 mm wall centrelines. Deck is55 mm vertically thick and never fills
its attic. All slate components have physical15 mm thickness and10 mm laps.
"""
import math

def height(r):return 1.85-(5/12)*r if r<=1.2+1e-9 else 1.5*(2.1-r)

def patch(g,name,polys,thickness,mat):
 """Close a connected piecewise-planar top patch by a vertical thickness."""
 verts=[];faces=[];lookup={}
 def idx(v):
  key=tuple(round(x,9) for x in v)
  if key not in lookup:lookup[key]=len(verts);verts.append(tuple(v))
  return lookup[key]
 for poly in polys:
  ids=[idx(p) for p in poly]
  if len(set(ids))<3:continue
  # Keep unique polygon corners and drop geometric zero edges.
  ids=[x for i,x in enumerate(ids) if x!=ids[(i-1)%len(ids)]]
  if len(ids)>=3:faces.append(ids)
 edges={}
 for f in faces:
  for a,b in zip(f,f[1:]+f[:1]):
   key=tuple(sorted((a,b)));edges.setdefault(key,[]).append((a,b))
 n=len(verts);verts+= [(x,y,z-thickness) for x,y,z in verts];ff=[tuple(f) for f in faces]+[tuple(i+n for i in reversed(f)) for f in faces]
 for values in edges.values():
  if len(values)==1:
   a,b=values[0];ff.append((a,b,b+n,a+n))
  else:assert len(values)==2,(name,'nonmanifold patch',values)
 return g.mesh(name,verts,ff,mat)

def clip(poly,a,b,c):
 """Keep a*r+b*t+c >=0, clipping native planar tile polygons."""
 out=[]
 for p,q in zip(poly,poly[1:]+poly[:1]):
  vp=a*p[0]+b*p[1]+c;vq=a*q[0]+b*q[1]+c
  if vp>=-1e-10:out.append(p)
  if (vp>=0)!=(vq>=0):
   u=vp/(vp-vq);out.append((p[0]+u*(q[0]-p[0]),p[1]+u*(q[1]-p[1])))
 return out

def tile(g,label,side,stations,t0,t1,hip=False):
 polys=[]
 for (a,za),(b,zb) in zip(stations,stations[1:]):
  poly=[(a,t0),(b,t0),(b,t1),(a,t1)]
  if hip:
   poly=clip(poly,1,1,0) # t>=-r
   if side=='front':poly=clip(poly,1,-1,0) # t<=r
   else:poly=clip(poly,0,-1,0) # t<=0
  if len(poly)<3:continue
  area=abs(sum(p[0]*q[1]-q[0]*p[1] for p,q in zip(poly,poly[1:]+poly[:1])))/2
  if area<1e-10:continue
  pp=[]
  for r,t in poly:
   lift=za+(zb-za)*(r-a)/(b-a)
   x,y=(t,-r) if side=='front' else (side*r,t)
   pp.append((x,y,height(r)+lift+.015))
  polys.append(pp)
 if polys:return patch(g,label,polys,.015,'slate')

def slate(g,hip=False):
 for side in ([-1,1,'front'] if hip else [-1,1]):
  for row in range(7):
   a=row*.3+.004;b=(row+1)*.3+(.014 if row<6 else -.004)
   # The knee is a real flashed pitch break. End the upper-slope tile on its
   # actual slope; a short independent knee flashing covers the2 mm joint.
   if row==3:b=1.198
   stations=[(a,.055),(a+.025,.055),(b-.015,.070),(b,.070)] if row<6 and row!=3 else [(a,.055),(b,.055)]
   if hip:
    tmin,tmax=(-2.1,2.1) if side=='front' else (-2.1,0)
    step=.3;offset=.15 if row%2 else 0;cuts=[tmin]+[k*step+offset for k in range(-8,9) if tmin+1e-7<k*step+offset<tmax-1e-7]+[tmax];cuts=sorted(cuts)
   else:cuts=[-.6,-.3,0,.3,.6] if row%2==0 else [-.6,-.45,-.15,.15,.45,.6]
   for col,(lo,hi) in enumerate(zip(cuts,cuts[1:])):
    # Actual repeat boundaries use complementary half tiles without a bevel.
    q0=lo+(0 if (not hip and lo==-.6 and row%2) else .002)
    q1=hi-(0 if (not hip and hi==.6 and row%2) or (hip and hi==0 and row%2) else .002)
    tile(g,'Mansard %s slate side %s course %02d tile %02d'%('hip' if hip else 'span',side,row+1,col+1),side,stations,q0,q1,hip)

def band_patch(g,name,r0,r1,zlift,thickness,hip=False,mat='metal'):
 """A continuous U band follows the piecewise roof plane at a fixed radial range."""
 if not hip:
  for side in [-1,1]:
   patch(g,name+' slope '+str(side),[[(side*r0,-.6,height(r0)+zlift),(side*r1,-.6,height(r1)+zlift),(side*r1,.6,height(r1)+zlift),(side*r0,.6,height(r0)+zlift)]],thickness,mat)
 else:
  join=0
  a=[(-r0,join),(-r0,-r0),(r0,-r0),(r0,join)];b=[(-r1,join),(-r1,-r1),(r1,-r1),(r1,join)]
  polys=[]
  for i in range(3):
   pp=[(a[i][0],a[i][1],height(r0)+zlift),(b[i][0],b[i][1],height(r1)+zlift),(b[i+1][0],b[i+1][1],height(r1)+zlift),(a[i+1][0],a[i+1][1],height(r0)+zlift)]
   if r0==0:pp=[pp[0],pp[1],pp[2]]
   polys.append(pp)
  patch(g,name,polys,thickness,mat)

def span(g):
 outline=[(-2.1,0),(-1.2,1.35),(0,1.85),(1.2,1.35),(2.1,0),(2.1,.055),(1.2,1.405),(0,1.905),(-1.2,1.405),(-2.1,.055)]
 g.prism('Continuous hollow mansard timber deck',outline,'Y',-.6,.6,'roof_deck');slate(g)
 # Separate thin folded knee flashings seat exactly on slate top at height+.070.
 # Their8mm thickness and.078 upper lift eliminate end-face volume overlap.
 for side in [-1,1]:
  pp=[[(side*r,-.6,height(r)+.078) for r in [1.17,1.2,1.225]],[(side*r,.6,height(r)+.078) for r in [1.17,1.2,1.225]]]
  patch(g,'Mansard pitch-break metal flashing '+str(side),[[pp[0][i],pp[0][i+1],pp[1][i+1],pp[1][i]] for i in range(2)],.008,'metal')
 profile=[(-.095,height(.095)+.055),(0,1.905),(.095,height(.095)+.055),(.095,height(.095)+.080),(0,1.930),(-.095,height(.095)+.080)]
 g.prism('Mansard folded ridge cap',profile,'Y',-.6,.6,'metal')
 for s in [-1,1]:
  a,b=(1.68,1.92) if s>0 else (-1.92,-1.68)
  g.prism('Mansard level wall bearing seat '+str(s),[(a,.1),(b,.1),(b,height(abs(b))),(a,height(abs(a)))],'Y',-.6,.6,'roof_deck')

def end(g):
 # A three-face hip joined along ridges. Each face has actual underside55 mm below.
 r=1.2;s=2.1;inner=[(-r,0),(-r,-r),(r,-r),(r,0)];outer=[(-s,0),(-s,-s),(s,-s),(s,0)];polys=[]
 for i in range(3):
  polys.append([(0,0,1.905),(inner[i][0],inner[i][1],1.405),(inner[i+1][0],inner[i+1][1],1.405)])
  polys.append([(inner[i][0],inner[i][1],1.405),(outer[i][0],outer[i][1],.055),(outer[i+1][0],outer[i+1][1],.055),(inner[i+1][0],inner[i+1][1],1.405)])
 patch(g,'Continuous three-sided hollow mansard hip timber deck',polys,.055,'roof_deck');slate(g,True)
 band_patch(g,'Hip pitch-break upper folded flashing',1.17,1.2,.078,.008,True)
 band_patch(g,'Hip pitch-break lower folded flashing',1.2,1.225,.078,.008,True)
 band_patch(g,'Hip apex folded metal ridge cap',0,.095,.080,.025,True)
 # Broad physical bearings form a U-shaped supported perimeter, ending at join y0.
 for side in [-1,1]:
  a,b=(1.68,1.92) if side>0 else (-1.92,-1.68)
  g.prism('Hip side wall level bearing '+str(side),[(a,.1),(b,.1),(b,height(abs(b))),(a,height(abs(a)))],'Y',-1.68,0,'roof_deck')
 g.prism('Hip end wall level bearing',[(-1.92,.1),(-1.68,.1),(-1.68,height(1.68)),(-1.92,height(1.92))],'X',-1.68,1.68,'roof_deck')
 for side in [-1,1]:
  a=(side*1.68,-1.68);b=(side*1.92,-1.68);c=(side*1.92,-1.92);d=(side*1.68,-1.92)
  for i,tri in enumerate([[a,b,c],[a,c,d]]):
   # Top changes with max(|x|,-y) across diagonal; these two native solids fit exactly.
   top=[(x,y,height(max(abs(x),-y))) for x,y in tri];bottom=[(x,y,.1) for x,y in tri];v=bottom+top
   g.mesh('Hip bearing corner %s wedge %s'%(side,i),v,[(2,1,0),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],'roof_deck')
