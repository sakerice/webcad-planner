"""Original expansion walls, genuine openings, floors and ceilings.
Each primitive is an editable native closed mesh. No native wall cutting implied.
"""
import math

def ring(g,name,outer,inner,axis,lo,hi,mat):
 def pt(p,t):return (p[0],p[1],t) if axis=='Z' else (p[0],t,p[1])
 n=len(outer);v=[pt(p,t) for t in [lo,hi] for r in [outer,inner] for p in r];f=[]
 for i in range(n):
  j=(i+1)%n;f.extend([(i,j,2*n+j,2*n+i),(n+i,3*n+i,3*n+j,n+j),(i,n+i,n+j,j),(2*n+i,2*n+j,3*n+j,3*n+i)])
 return g.mesh(name,v,f,mat)

def base_trims(g,a,b,label=''):
 g.box(label+' exterior stone plinth',(a,-.16,0),(b,-.12,.18),'stone')
 g.box(label+' exterior plain stone eaves band',(a,-.15,2.9),(b,-.12,3),'stone')
 g.box(label+' interior timber skirting',(a,.12,0),(b,.14,.16),'wood_trim')

def plain(g,width=1.2):
 g.box('Plain full-height lime plaster bay',(-width/2,-.12,0),(width/2,.12,3),'plaster');base_trims(g,-width/2,width/2)

def exterior_corner(g):
 outline=[(-.6,-.12),(-.12,-.12),(-.12,-.6),(.12,-.6),(.12,.12),(-.6,.12)]
 g.prism('Continuous exterior L corner plaster core',outline,'Z',0,3,'plaster')
 for label,depth,z0,z1 in [('plinth',.16,0,.18),('eaves band',.15,2.9,3)]:
  poly=[(-.6,.12),(.12,.12),(.12,-.6),(depth,-.6),(depth,depth),(-.6,depth)]
  g.prism('Continuous convex mitred stone '+label,poly,'Z',z0,z1,'stone')
 poly=[(-.6,-.14),(-.14,-.14),(-.14,-.6),(-.12,-.6),(-.12,-.12),(-.6,-.12)]
 g.prism('Continuous concave interior timber skirting',poly,'Z',0,.16,'wood_trim')

def arch(g):
 n=24;ro=.69;ri=.6;spring=1.8
 arc=[(ro*math.cos(math.pi-i*math.pi/n),spring+ro*math.sin(math.pi-i*math.pi/n)) for i in range(n+1)]
 outline=[(-.9,0),(-ro,0)]+arc+[(ro,0),(.9,0),(.9,3),(-.9,3)]
 g.prism('Plaster wall with true polygonal arched portal',outline,'Y',-.12,.12,'plaster')
 for s in [-1,1]:
  a,b=(-ro,-ri) if s<0 else (ri,ro)
  g.box('Continuous stone arch jamb '+str(s),(a,-.15,0),(b,.12,spring),'stone')
 for i in range(n):
  a=math.pi-i*math.pi/n;b=math.pi-(i+1)*math.pi/n
  poly=[(ri*math.cos(a),spring+ri*math.sin(a)),(ri*math.cos(b),spring+ri*math.sin(b)),(ro*math.cos(b),spring+ro*math.sin(b)),(ro*math.cos(a),spring+ro*math.sin(a))]
  g.prism('Load-bearing arch voussoir %02d'%(i+1),poly,'Y',-.15,.12,'stone')
 # Stepped proud keystone. Its back contacts the outer arch surface and wall face.
 g.prism('Projecting keystone face',[(-.06,2.400),(.06,2.400),(.084,2.515),(-.084,2.515)],'Y',-.177,-.15,'stone')
 for a,b in [(-.9,-.69),(.69,.9)]:
  g.box('Exterior plinth to arch pier '+str(a),(a,-.16,0),(b,-.12,.18),'stone')
  g.box('Interior arch pier skirting '+str(a),(a,.12,0),(b,.14,.16),'wood_trim')
 g.box('Continuous over-arch eaves band',(-.9,-.15,2.9),(.9,-.12,3),'stone')

def window(g,tall=False):
 bottom=.18 if tall else .8;top=2.6;edge=.46;inner=.38
 # Four closed structural blocks meet only at opposite-facing contacts.
 g.box('Window west plaster pier',(-.6,-.12,0),(-edge,.12,3),'plaster')
 g.box('Window east plaster pier',(edge,-.12,0),(.6,.12,3),'plaster')
 g.box('Window lower solid spandrel',(-edge,-.12,0),(edge,.12,bottom),'plaster')
 g.box('Window solid lintel',(-edge,-.12,top),(edge,.12,3),'plaster')
 outer=[(-edge,bottom),(edge,bottom),(edge,top),(-edge,top)]
 inside=[(-inner,bottom+.08),(inner,bottom+.08),(inner,top-.08),(-inner,top-.08)]
 ring(g,'Fixed window continuous mitred timber frame',outer,inside,'Y',-.15,.105,'wood_trim')
 mid=(bottom+top)/2;bar=.016
 g.box('Fixed central mullion',(-bar,-.15,bottom+.08),(bar,.02,top-.08),'wood_trim')
 for a,b in [(-inner,-bar),(bar,inner)]:g.box('Fixed transom '+str(a),(a,-.15,mid-bar),(b,.02,mid+bar),'wood_trim')
 for ix,(a,b) in enumerate([(-inner,-bar),(bar,inner)]):
  for iz,(c,d) in enumerate([(bottom+.08,mid-bar),(mid+bar,top-.08)]):
   g.box('Fixed glazing pane %s %s'%(ix+1,iz+1),(a,-.08,c),(b,-.072,d),'glass')
 # Sloping nose sill with undercut drip profile is a distinct supported stone part.
 poly=[(-.12,bottom-.075),(-.22,bottom-.075),(-.22,bottom-.035),(-.16,bottom),(-.12,bottom)]
 g.prism('Raised stone sill with sloping weather nose',poly,'X',-.54,.54,'stone')
 g.box('Stone lintel front',(-.54,-.16,top),(.54,-.12,top+.095),'stone');base_trims(g,-.6,.6)

def parquet(g):
 g.box('Continuous parquet structural tile substrate',(-.6,-.6,0),(.6,.6,.06),'wood')
 # An infinite two-board L unit on lattice (a,a),(b,-b), clipped at tile edges.
 # a=3b. The unit determinant equals both board areas: exact herringbone tessellation.
 a=.3;b=.1;gap=.0008;count=0
 for i in range(-8,9):
  for j in range(-14,15):
   ox=i*a+j*b;oy=i*a-j*b
   for x0,y0,x1,y1 in [(ox,oy,ox+a,oy+b),(ox+a-b,oy+b,ox+a,oy+a+b)]:
    xa=max(-.6,x0);xb=min(.6,x1);ya=max(-.6,y0);yb=min(.6,y1)
    if xb-xa<1e-5 or yb-ya<1e-5:continue
    xa+=gap if xa>-.6+1e-5 else 0;xb-=gap if xb<.6-1e-5 else 0;ya+=gap if ya>-.6+1e-5 else 0;yb-=gap if yb<.6-1e-5 else 0
    count+=1;g.box('Herringbone clipped oak board %03d'%count,(xa,ya,.06),(xb,yb,.075),'oak' if (i+j)%2 else 'wood_trim')

def ceiling(g):
 outer=[(-.6,-.6),(.6,-.6),(.6,.6),(-.6,.6)];inside=[(-.46,-.46),(.46,-.46),(.46,.46),(-.46,.46)]
 # A continuous perimeter beam ring and true recessed plaster infill above it.
 ring(g,'Continuous coffer perimeter beam ring',outer,inside,'Z',0,.14,'wood')
 g.box('Recessed ivory plaster coffer field',(-.46,-.46,.10),(.46,.46,.14),'plaster')
 # Recess-facing chamfer joins vertical timber wall and plaster ceiling.
 lower=[(-.46,-.46),(.46,-.46),(.46,.46),(-.46,.46)];upper=[(-.425,-.425),(.425,-.425),(.425,.425),(-.425,.425)]
 v=[(x,y,z) for r,z in [(lower,.065),(lower,.10),(upper,.10)] for x,y in r];f=[]
 for i in range(4):
  j=(i+1)%4;f.extend([(i,j,4+j,4+i),(4+i,4+j,8+j,8+i),(8+i,8+j,j,i)])
 g.mesh('Continuous recessed coffer angled timber moulding',v,f,'wood_trim')
