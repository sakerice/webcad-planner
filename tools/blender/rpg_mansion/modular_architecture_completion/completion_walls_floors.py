"""Original editable architecture reconstructed from measured construction recipes."""
import math
import bpy
from reference_walls_floors import ring,base_trims

def bevel(g,ob,width):
 g.kit.activate(ob);m=ob.modifiers.new('Physical one-segment edge bevel','BEVEL');m.width=width;m.segments=1;bpy.ops.object.modifier_apply(modifier=m.name)
 return ob

def clip(poly,a,b,c):
 out=[]
 for p,q in zip(poly,poly[1:]+poly[:1]):
  vp=a*p[0]+b*p[1]+c;vq=a*q[0]+b*q[1]+c
  if vp>=-1e-10:out.append(p)
  if (vp>=0)!=(vq>=0):
   t=vp/(vp-vq);out.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
 clean=[]
 for p in out:
  if not clean or math.dist(p,clean[-1])>1e-8:clean.append(p)
 if len(clean)>1 and math.dist(clean[0],clean[-1])<1e-8:clean.pop()
 return clean

def ashlar(g):
 g.box('Full-height plaster wall core',(-.6,-.12,0),(.6,.12,3),'plaster');base_trims(g,-.6,.6)
 g.box('Continuous recessed mortar backing',(-.6,-.128,.18),(.6,-.12,2.9),'mortar')
 step=(2.9-.18)/9
 for row in range(9):
  cuts=[-.6,0,.6] if row%2==0 else [-.6,-.3,.3,.6]
  for col,(a,b) in enumerate(zip(cuts,cuts[1:])):
   bevel(g,g.box('Ashlar course %02d stone %02d'%(row+1,col+1),(a+.002,-.19,.18+row*step+.002),(b-.002,-.128,.18+(row+1)*step-.002),'stone'),.002)

def plinth(g):
 g.box('Broad continuous foundation footing',(-.6,-.30,0),(.6,.12,.08),'stone')
 g.box('Foundation mortar core',(-.6,-.20,.08),(.6,.12,.55),'mortar')
 g.box('Broad pilaster-supporting foundation cap',(-.6,-.30,.55),(.6,.12,.6),'stone')
 for row in range(2):
  cuts=[-.6,0,.6] if row%2==0 else [-.6,-.3,.3,.6]
  for col,(a,b) in enumerate(zip(cuts,cuts[1:])):
   bevel(g,g.box('Rusticated foundation block %s %s'%(row,col),(a+.0025,-.26,.08+row*.235+.0025),(b-.0025,-.20,.08+(row+1)*.235-.0025),'stone'),.008)

def half_timber(g):
 g.box('Full-height plaster half-timber infill',(-.6,-.12,0),(.6,.12,3),'plaster');base_trims(g,-.6,.6)
 for a,b in [(-.6,-.52),(.52,.6)]:g.box('Outer timber post '+str(a),(a,-.17,.18),(b,-.12,2.9),'wood')
 for a,b in [(.18,.27),(2.81,2.9)]:g.box('Horizontal timber edge rail '+str(a),(-.52,-.17,a),(.52,-.12,b),'wood')
 g.box('Central timber stile',(-.045,-.17,.27),(.045,-.12,2.81),'wood')
 for a,b in [(-.52,-.045),(.045,.52)]:g.box('Middle timber rail '+str(a),(a,-.17,1.35),(b,-.12,1.44),'wood')
 for ix,(x0,x1) in enumerate([(-.52,-.045),(.045,.52)]):
  for iz,(z0,z1) in enumerate([(.27,1.35),(1.44,2.81)]):
   p=(x0,z0) if (ix+iz)%2==0 else (x0,z1);q=(x1,z1) if (ix+iz)%2==0 else (x1,z0)
   dx=q[0]-p[0];dz=q[1]-p[1];ln=math.hypot(dx,dz);nx=-dz/ln*.025;nz=dx/ln*.025
   poly=[(p[0]+nx,p[1]+nz),(q[0]+nx,q[1]+nz),(q[0]-nx,q[1]-nz),(p[0]-nx,p[1]-nz)]
   for a,b,c in [(1,0,-x0),(-1,0,x1),(0,1,-z0),(0,-1,z1)]:poly=clip(poly,a,b,c)
   g.prism('Clipped diagonal timber brace %s %s'%(ix,iz),poly,'Y',-.17,-.12,'wood')

def french(g):
 for a,b in [(-.6,-.52),(.52,.6)]:g.box('French window plaster pier '+str(a),(a,-.12,0),(b,.12,3),'plaster')
 g.box('French window structural head',(-.52,-.12,2.75),(.52,.12,3),'plaster')
 ring(g,'Floor-height French window continuous timber surround',[(-.52,0),(.52,0),(.52,2.75),(-.52,2.75)],[(-.46,.09),(.46,.09),(.46,2.68),(-.46,2.68)],'Y',-.15,.12,'wood_trim')
 for i,(a,b) in enumerate([(-.46,0),(0,.46)]):
  ring(g,'Fixed French leaf mitred frame '+str(i),[(a,.09),(b,.09),(b,2.4),(a,2.4)],[(a+.035,.125),(b-.035,.125),(b-.035,2.365),(a+.035,2.365)],'Y',-.15,-.04,'wood_trim')
  for z0,z1 in [(.88,.915),(1.60,1.635)]:g.box('French leaf crossrail %s %s'%(i,z0),(a+.035,-.15,z0),(b-.035,-.04,z1),'wood_trim')
  for j,(z0,z1) in enumerate([(.125,.88),(.915,1.60),(1.635,2.365)]):g.box('Clear fixed French leaf glazing %s %s'%(i,j),(a+.035,-.08,z0),(b-.035,-.072,z1),'glass')
 g.box('French transom horizontal rail',(-.46,-.15,2.4),(.46,-.04,2.46),'wood_trim')
 g.box('French transom centre mullion',(-.016,-.15,2.46),(.016,-.04,2.68),'wood_trim')
 for a,b in [(-.46,-.016),(.016,.46)]:g.box('Clear fixed French transom glazing '+str(a),(a,-.08,2.46),(b,-.072,2.68),'glass')
 g.prism('French threshold sloped weather nose',[(-.23,0),(-.23,.035),(-.18,.06),(-.15,.06),(-.15,0)],'X',-.52,.52,'stone')
 for a,b in [(-.6,-.52),(.52,.6)]:
  g.box('French pier plinth '+str(a),(a,-.16,0),(b,-.12,.18),'stone');g.box('French pier inner skirting '+str(a),(a,.12,0),(b,.14,.16),'wood_trim')
 g.box('French continuous stone eaves band',(-.6,-.15,2.9),(.6,-.12,3),'stone')

def octagon_floor(g):
 g.box('Continuous stone tile support substrate',(-.6,-.6,0),(.6,.6,.05),'mortar')
 base=[(-.09,-.15),(.09,-.15),(.15,-.09),(.15,.09),(.09,.15),(-.09,.15),(-.15,.09),(-.15,-.09)]
 for i,x in enumerate([-.45,-.15,.15,.45]):
  for j,y in enumerate([-.45,-.15,.15,.45]):g.prism('Octagonal limestone paving block %s %s'%(i,j),[(x+a*.992,y+b*.992) for a,b in base],'Z',.05,.075,'stone')
 for i,x in enumerate([-.6,-.3,0,.3,.6]):
  for j,y in enumerate([-.6,-.3,0,.3,.6]):
   poly=[(x-.0588,y),(x,y-.0588),(x+.0588,y),(x,y+.0588)]
   for a,b,c in [(1,0,.6),(-1,0,.6),(0,1,.6),(0,-1,.6)]:poly=clip(poly,a,b,c)
   if len(poly)>=3:g.prism('Dark clipped cabochon stone %s %s'%(i,j),poly,'Z',.05,.075,'dark_stone')
