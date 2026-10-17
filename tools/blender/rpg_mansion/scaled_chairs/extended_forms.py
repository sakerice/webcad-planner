"""Twenty-one original support/back/task forms, no palette-only duplicates.
All values are intended metre measurements; each builder remains static geometry.
"""
import math
from mathutils import Vector
B=None;ITEM=None

def configure(build,item):
 global B,ITEM
 B=build;ITEM=item

def size():return [ITEM[k]/1000 for k in ('w','d','h')]

def seat_frame(label,w,d,mat='velvet',x=0,y=0):
 B.rect(label+' cushion seat surface',w,d,.426,.460,x=x,y=y,mat=mat,r=min(.065,d*.15),seat=True)
 B.rect(label+' carved seat bearing frame',w-.012,d-.012,.391,.432,x=x,y=y,mat='edge',r=min(.059,d*.14))

def leg(label,x,y,top=.413,turned=True):
 if turned:
  rows=[(.024,0),(.026,.024),(.021,.052),(.014,.135),(.018,.290),(.029,.343),(.026,.370),(.026,.413)]
  return B.lathe(label,[(radius,z*top/.413) for radius,z in rows],x,y,n=10)
 B.lathe(label+' joined ground foot',[(.022,0),(.023,.029)],x,y,n=10)
 return B.sweep(label,[(x,y,.020),(x*.94,y*.95,.19),(x*.94,y*.97,.35),(x,y,top)],[.042,.034,.041,.054],[.038,.034,.041,.050],n=8)

def four_base(label,w,d,back=False,stretch=True,mat='velvet'):
 """Seat sets real width and front extent; enclosing back sets rear extent."""
 y=-d*.11;sd=d*.78
 seat_frame(label,w,sd,mat,y=y)
 xs=[-w/2+.055,w/2-.055];front=-d*.39;rear=d*.25
 for sx,x in enumerate(xs):
  leg(label+' front turned leg '+str(sx),x,front)
  if not back:leg(label+' rear shaped leg '+str(sx),x,rear,turned=False)
  else:
   B.lathe(label+' rear joined ground foot '+str(sx),[(.022,0),(.023,.030)],x,rear,n=10)
   xr=(1 if x>0 else -1)*(w/2-.040)
   B.sweep(label+' continuous rear bearing stile '+str(sx),[(x,rear,.020),(x,rear,.20),(xr,d*.265,.426),(xr,d*.39,hpart(.72)),(xr,d/2-.020,hpart(.965))],[.043,.038,.052,.043,.042],[.040,.037,.046,.039,.040],n=8)
  if stretch:B.rod(label+' mortised side stretcher '+str(sx),(x,front,.188),(x,rear,.188),.013,'edge')
  B.rect(label+' side underseat apron '+str(sx),.032,d*.64,.340,.412,x=x,y=-d*.07,r=.009)
 for sy,yy in enumerate([front,rear]):B.rect(label+' transverse apron '+str(sy),w-.088,.032,.342,.413,y=yy,r=.009)
 if stretch:B.rod(label+' front stretcher',(xs[0],front,.188),(xs[1],front,.188),.013,'edge')
 return dict(xs=xs,front=front,rear=rear,backy=d/2-.020,seatRear=d*.28)

def hpart(r):return size()[2]*r

def crest(label,w,d,h,depth=.036):
 B.rect(label+' full bearing crest rail',w-.014,depth,h-.049,h,y=d/2-depth/2,mat='edge',r=.014)

def lyre():
 w,d,h=size();g=four_base('Lyre',w,d,back=True);crest('Lyre',w,d,h);y=d/2-.023;z0=.508;z1=h-.055
 B.crossbar('Lyre lower bearing sill',-w*.41,w*.41,d*.31,z0,.041,.039,bow=-(y-d*.31))
 for sign in [-1,1]:
  B.sweep('Lyre open S-scroll outer bow '+str(sign),[(sign*w*.15,y,z0+.001),(sign*w*.28,y,z0+.08),(sign*w*.25,y,z0+.19),(sign*w*.12,y,z0+.31),(sign*w*.23,y,z1)],[.034,.040,.036,.033,.036],[.026]*5,'edge',8)
 for k in range(-2,3):B.rod('Lyre slender central string '+str(k),(k*w*.038,y,z0+.023),(k*w*.056,y,z1+.007),.005,'brass',6)
 B.crossbar('Lyre upper string attachment',-w*.23,w*.23,y,z1,.027,.028)

def balloon():
 w,d,h=size();g=four_base('Balloon',w,d,back=True);y=d/2-.0348;z0=.503;z1=h-.029
 B.back_frame('Balloon continuous oval upholstered back surround',w-.058,z0,z1,y,.028,n=28)
 # Soft oval upholstered medallion is a volumetric closed part, not a plane.
 rings=[]
 for yy,radius in [(y-.019,.96),(y-.011,1),(y+.013,1),(y+.017,.96)]:
  rings.append([((w-.119)*.5*radius*math.cos(a),yy,(z0+z1)/2+(z1-z0-.062)*.5*radius*math.sin(a))for a in [i*math.tau/28 for i in range(28)]])
 B.shell('Balloon velvet back medallion',rings,'velvet',True)
 B.crossbar('Balloon lower seat-to-back sill',-w*.40,w*.40,d*.31,.508,.041,.045,bow=-(y-d*.31))
 # Fine carved crown belongs to the actual oval frame.
 B.rect('Balloon carved oval crown',.110,.036,h-.037,h,y=d/2-.018,mat='edge',r=.013)

def windsor():
 w,d,h=size();g=four_base('Windsor',w,d,back=False,mat='wood');y=d/2-.020
 # Bent bow crown is an open arch whose ends enter seat and lower sill.
 path=[(-w*.415,d*.24,.432)]+[(w*.43*math.cos(a),y,h-.33+.305*math.sin(a))for a in [math.pi-math.pi*i/12 for i in range(13)]]+[(w*.415,d*.24,.432)]
 B.sweep('Windsor continuous bent bow',path,[.039]*len(path),[.036]*len(path),'edge',8,sub=1)
 for k in range(-4,5):
  x=k*w*.077;z=h-.33+.305*math.sqrt(max(0,1-(x/(w*.43))**2))
  B.sweep('Windsor radial back spindle '+str(k),[(x*.91,d*.225,.431),(x,d*.38,.71),(x,y,z)],[.018,.016,.017],[.017,.015,.017],n=8)
 B.rect('Windsor carved bow crown',.120,.040,h-.037,h,y=d/2-.020,mat='edge',r=.013)


def slipper():
 w,d,h=size();seat_frame('Slipper',w,d*.78,y=-d*.11)
 # Short exposed feet beneath a broad, armless upholstered lounge shell.
 for x in [-w*.35,w*.35]:
  for y in [-d*.365,d*.225]:leg('Slipper short turned foot %.3f %.3f'%(x,y),x,y,.184)
 B.rect('Slipper deep upholstered base',w-.024,d*.76,.153,.437,y=-d*.11,mat='velvet',r=.085)
 # Closed stepped rolled back with gently tilted upper rings.
 rings=[];yy=d/2-.080;ww=w-.035
 for z,width,cy,depth in [(.381,ww,yy-.055,.17),(.48,ww,yy-.015,.17),(h-.028,ww-.04,yy,.16),(h,ww-.052,yy,.148)]:
  rings.append(B.rounded_rect(0,cy,width,depth,.055,z,n=3))
 B.shell('Slipper continuous rolled upholstered back',rings,'velvet')
 B.rect('Slipper rear walnut back bearing rail',w-.086,.033,.351,.405,y=d*.36,mat='edge',r=.01)


def corner():
 w,d,h=size();seat_frame('Corner',w,d,y=0)
 # Square corner seat is open toward -Y, with a two-sided angular back.
 for x in [-w*.39,w*.39]:
  for y in [-d*.39,d*.39]:leg('Corner turned leg %.3f %.3f'%(x,y),x,y)
 for x in [-w*.39,w*.39]:B.rod('Corner side lower stretcher '+str(x),(x,-d*.39,.19),(x,d*.39,.19),.014,'edge')
 B.rod('Corner transverse lower stretcher',(-w*.39,-d*.39,.19),(w*.39,-d*.39,.19),.014,'edge')
 # L-shaped rear/right rails, different topology from a conventional chair.
 for x,y,label in [(-w/2+.026,d/2-.026,'rear left'),(w/2-.026,d/2-.026,'corner'),(w/2-.026,-d/2+.026,'side front')]:
  B.sweep('Corner '+label+' continuous post',[(x,y,.403),(x,y,.70),(x,y,h-.022)],[.046,.043,.044],[.046,.043,.044])
 B.sweep('Corner orthogonal enclosing upper rail',[(-w/2+.020,d/2-.022,h-.025),(w/2-.022,d/2-.022,h-.025),(w/2-.022,-d/2+.02,h-.025)],[.043]*3,[.042]*3,'edge',8,sub=1)
 for k in range(4):
  x=-w*.32+k*w*.205;B.rod('Corner rear spindle '+str(k),(x,d/2-.025,.453),(x,d/2-.025,h-.030),.014)
  y=-d*.32+k*d*.205;B.rod('Corner side spindle '+str(k),(w/2-.025,y,.453),(w/2-.025,y,h-.030),.014)
 B.rect('Corner genuine corner cap',.045,.045,h-.028,h,x=w/2-.0225,y=d/2-.0225,mat='edge',r=.014)


def smoking():
 w,d,h=size();g=four_base('Smoking',w,d,back=True,mat='leather');y=d/2-.025
 # Upper elbow pad is the broad backward-seating task surface.
 B.rect('Smoking broad chestnut upper elbow pad',w,.15,h-.053,h,y=d/2-.075,mat='leather',r=.050)
 B.rect('Smoking elbow pad walnut bearing',w-.023,.12,h-.083,h-.040,y=d/2-.07,mat='edge',r=.040)
 B.sweep('Smoking pierced central splat lower bow',[(-.086,y,.495),(-.066,y,.60),(-.097,y,.73),(-.126,y,h-.071)],[.041,.035,.035,.041],[.032]*4,'edge')
 B.sweep('Smoking pierced central splat upper bow',[(.086,y,.495),(.066,y,.60),(.097,y,.73),(.126,y,h-.071)],[.041,.035,.035,.041],[.032]*4,'edge')
 B.crossbar('Smoking lower splat bearing sill',-w*.40,w*.40,d*.31,.501,.044,.040,bow=-(y-d*.31))


def campaign():
 w,d,h=size();front=-d*.39;rear=d*.28;xx=w/2-.027
 # Fixed open crossed side rails have real visible brass cross pins.
 for sx in [-1,1]:
  x=sx*xx
  for sign in [-1,1]:
   B.sweep('Campaign fixed crossing side rail %s %s'%(sx,sign),[(x,front if sign<0 else rear,.022),(x,-d*.03,.235),(x,rear if sign<0 else front,.450)],[.044,.040,.046],[.040,.039,.041],n=8)
  B.rod('Campaign brass cross pin '+str(sx),(x-.025,-d*.03,.235),(x+.025,-d*.03,.235),.015,'brass',10)
  B.sweep('Campaign rear upright '+str(sx),[(x,rear,.417),(x,d/2-.029,.60),(x,d/2-.029,h-.024)],[.043,.042,.043],[.046,.042,.042])
  B.rect('Campaign horizontal ground bearer '+str(sx),.054,d*.68,0,.040,x=x,y=-d*.055,r=.014)
  B.sweep('Campaign shaped arm '+str(sx),[(x,-d*.35,.624),(x,-d*.02,.651),(x,d*.31,.642)],[.050]*3,[.044]*3,'edge')
  B.rod('Campaign arm front upright '+str(sx),(x,front,.423),(x,-d*.35,.624),.019)
 seat_frame('Campaign',w-.031,d*.78,'leather',y=-d*.11)
 # Broad closed leather panels are suspended between actual bearing rails.
 y=d/2-.022
 B.rect('Campaign top back bearing rail',w-.026,.044,h-.045,h,y=y,mat='edge',r=.012)
 panel=B.rect('Campaign leather back sling',w-.077,.026,.547,h-.03,y=y-.013,mat='leather',r=.011)
 B.rod('Campaign lower back bearing rail',(-xx,y,.55),(xx,y,.55),.022,'edge')
 B.rod('Campaign front underseat bearing rail',(-xx,front,.414),(xx,front,.414),.024,'edge')


def xback():
 w,d,h=size();g=four_base('X-back',w,d,back=True);crest('X-back',w,d,h);y=d/2-.025;z0=.503;z1=h-.06
 B.crossbar('X-back lower bearing sill',-w*.405,w*.405,d*.32,z0,.041,.045,bow=-(y-d*.32))
 for sign in [-1,1]:B.sweep('X-back diagonal open crossing rail '+str(sign),[(sign*w*.405,d*.32,z0),(-sign*w*.405,y,z1)],[.037,.037],[.032,.032],'edge',8)
 B.rod('X-back central brass crossing peg',(0,(d*.32+y)/2-.025,(z0+z1)/2),(0,(d*.32+y)/2+.021,(z0+z1)/2),.012,'brass',8)


def shield():
 w,d,h=size();g=four_base('Shield',w,d,back=True);crest('Shield',w,d,h);y=d/2-.027
 # Pierced heraldic shield outline with a tapered lower point and top shoulders.
 outline=[(-w*.19,y,h-.07),(-w*.32,y,h-.125),(-w*.25,y,.657),(0,y,.504),(w*.25,y,.657),(w*.32,y,h-.125),(w*.19,y,h-.07)]
 B.sweep('Shield left continuous pierced outline',outline[:4],[.040]*4,[.035]*4,'edge',8)
 B.sweep('Shield right continuous pierced outline',outline[3:],[.040]*4,[.035]*4,'edge',8)
 for k in [-1,0,1]:B.rod('Shield central pierced spindle '+str(k),(k*w*.048,y,.527+abs(k)*.07),(k*w*.080,y,h-.043),.013)
 B.crossbar('Shield low bearing sill',-w*.405,w*.405,d*.31,.508,.041,.044,bow=-(y-d*.31))


def gothic():
 w,d,h=size();g=four_base('Gothic hall',w,d,back=True,mat='wood');y=d/2-.025
 # Two pointed arches create real openings and a tall hall-chair silhouette.
 for sign in [-1,1]:
  B.sweep('Gothic pointed outer arch '+str(sign),[(sign*w*.37,d*.29,.50),(sign*w*.34,y,.86),(sign*w*.18,y,h-.136),(0,y,h-.028)],[.042]*4,[.036]*4,'edge',8)
  B.sweep('Gothic inner pointed arch '+str(sign),[(sign*w*.19,y,.55),(sign*w*.18,y,.83),(sign*w*.09,y,h-.185),(0,y,h-.117)],[.022]*4,[.022]*4,'edge',8)
 B.rect('Gothic upper carved arch apex',.051,.050,h-.048,h,y=y,mat='edge',r=.014)
 B.crossbar('Gothic low bearing rail',-w*.40,w*.40,d*.31,.515,.049,.032,bow=-(y-.006-d*.31))
 B.rod('Gothic central vertical mullion',(0,y,.511),(0,y,h-.031),.014)


def barrel():
 w,d,h=size();seat_frame('Barrel',w-.094,d*.76,y=-d*.12)
 for x in [-w*.35,w*.35]:
  for y in [-d*.36,d*.25]:
   leg('Barrel shaped leg %.3f %.3f'%(x,y),x,y,turned=False)
 # Half-round enclosing upper arm/back rail, ending at the front opening.
 r=w/2-.026;cy=-d*.06
 path=[(r*math.cos(a),cy+d*.44*math.sin(a),.651+.11*math.sin(a))for a in [math.pi*i/12 for i in range(13)]]
 B.sweep('Barrel continuous half-round enclosing rail',path,[.052]*13,[.048]*13,'edge',8,sub=1)
 for k,a in enumerate([math.pi*i/10 for i in range(11)]):
  x=r*math.cos(a);y=cy+d*.44*math.sin(a);top=.651+.11*math.sin(a)
  B.sweep('Barrel radial back stave '+str(k),[(x*.86,y*.86,.420),(x,y,(top+.420)/2),(x,y,top)],[.035,.029,.035],[.035,.029,.035])
 B.rect('Barrel rear crest crown',.18,.046,h-.042,h,y=d/2-.023,mat='edge',r=.014)
 # Rear bowed support rail joins crest to the staves and defines real depth.
 B.sweep('Barrel central rear crown bearing',[(0,cy+d*.44,.65),(0,d/2-.023,h-.033)],[.052,.046],[.042,.042],'edge')
 for sx in [-1,1]:B.rect('Barrel enclosing elbow end '+str(sx),.052,.065,.627,.677,x=sx*r,y=cy,mat='edge',r=.020)


def scoop():
 w,d,h=size();seat_frame('Scoop desk',w-.05,d*.77,y=-d*.115,mat='leather')
 # Four swept spider feet meet a fixed baluster; no swivel mechanism is claimed.
 B.lathe('Scoop desk fixed central baluster',[(.058,.09),(.075,.14),(.047,.20),(.038,.32),(.075,.41)],0,0,n=14)
 for sx in [-1,1]:
  for sy in [-1,1]:
   x=sx*w*.35;y=sy*d*.30
   B.sweep('Scoop desk fixed swept spider leg %s %s'%(sx,sy),[(0,0,.161),(x*.50,y*.50,.126),(x*.87,y*.87,.052),(x,y,.024)],[.052,.049,.045,.044],[.049,.045,.042,.043],'edge',8)
   B.lathe('Scoop desk brass foot cap %s %s'%(sx,sy),[(.022,0),(.023,.015),(.021,.028)],x,y,'brass',n=10)
 # Low half-rounded leather upholstered back is a closed bowed volume.
 n=16;path=[(w*.44*math.cos(a),d*.26+d*.19*math.sin(a),.536+.13*math.sin(a))for a in [math.pi*i/n for i in range(n+1)]]
 B.sweep('Scoop desk low enclosing walnut bow',path,[.050]*(n+1),[.049]*(n+1),'edge',8,sub=1)
 for sx in [-1,1]:B.sweep('Scoop desk continuous back bearing '+str(sx),[(sx*w*.37,d*.18,.410),(sx*w*.42,d*.32,.55),(sx*w*.34,d*.44,h-.030)],[.046,.039,.046],[.042,.039,.046])
 B.rect('Scoop desk rear leather crown pad',w*.76,.11,h-.063,h,y=d/2-.055,mat='leather',r=.046)
 B.rect('Scoop desk crown walnut bearing',w*.82,.10,h-.100,h-.039,y=d/2-.056,mat='edge',r=.040)
 for sx in [-1,1]:B.rect('Scoop desk carved side elbow '+str(sx),.055,.14,.514,.563,x=sx*(w/2-.0275),y=d*.26,mat='edge',r=.024)
 # The single broad cushion already reaches the intended front depth extent.
 # No coplanar overlay is added: that produced visible self-shadowing/z-fighting.


BUILDERS={'lyre-side':lyre,'balloon-side':balloon,'windsor-bow':windsor,'slipper':slipper,'corner':corner,'smoking':smoking,'campaign-fold':campaign,'x-back':xback,'shield-back':shield,'gothic-hall':gothic,'barrel-arm':barrel,'scoop-desk':scoop}

def prayer():
 w,d,h=size();g=four_base('Prayer',w,d,back=True,mat='wood')
 # Prayer-room high-back chair, with a separate low footrest at 280 mm.
 B.rect('Prayer low footrest velvet pad',w-.070,.230,.247,.280,y=-d*.30,mat='velvet',r=.042)
 B.rect('Prayer footrest walnut bearing',w-.055,.225,.226,.253,y=-d*.30,mat='edge',r=.030)
 B.rect('Prayer high padded crest rail',w,.145,h-.052,h,y=d/2-.0725,mat='velvet',r=.048)
 B.rect('Prayer padded crest walnut bearing',w-.026,.118,h-.081,h-.040,y=d/2-.066,mat='edge',r=.032)
 for x in [-w*.12,w*.12]:B.sweep('Prayer narrow back open mullion '+str(x),[(x,d*.31,.514),(x,d*.43,.79),(x,d/2-.027,h-.065)],[.030,.026,.030],[.029,.026,.030],n=8)
 B.crossbar('Prayer lower back bearing sill',-w*.405,w*.405,d*.31,.508,.044,.041,bow=-(d/2-.027-d*.31))

def music():
 w,d,h=size();g=four_base('Music',w,d,back=True,stretch=False,mat='velvet');crest('Music',w,d,h)
 y=d/2-.022;B.crossbar('Music narrow low back bearing rail',-w*.405,w*.405,d*.31,.548,.038,.036,bow=-(y-d*.31))
 for k in [-1,0,1]:B.rod('Music low straight open back spindle '+str(k),(k*w*.19,y,.548),(k*w*.19,y,h-.036),.013,'edge')
 for sign in [-1,1]:B.rod('Music crossed underseat brace '+str(sign),(sign*(w/2-.055),g['front'],.235),(-sign*(w/2-.055),g['rear'],.235),.013,'wood')

def cane_stool():
 w,d,h=size();xs=[-w/2+.055,w/2-.055];ys=[-d/2+.055,d/2-.055]
 for x in xs:
  for y in ys:leg('Cane stool turned leg %.3f %.3f'%(x,y),x,y,.438)
 for x in xs:B.rod('Cane stool side mortised stretcher '+str(x),(x,ys[0],.177),(x,ys[1],.177),.013,'edge')
 B.rod('Cane stool H centre stretcher',(xs[0],0,.177),(xs[1],0,.177),.013,'edge')
 # One closed, bevelled annular frame avoids coplanar overlap at the four joints.
 rings=[]
 for ww,dd,rr,zz in [(w-.006,d-.006,.009,.418),(w,d,.012,.421),(w,d,.012,.457),(w-.006,d-.006,.009,.460),(w-.090,d-.090,.009,.460),(w-.096,d-.096,.006,.457),(w-.096,d-.096,.006,.421),(w-.090,d-.090,.009,.418)]:
  rings.append(B.rounded_rect(0,0,ww,dd,rr,zz,n=2))
 n=len(rings[0]);faces=[(k*n+j,k*n+(j+1)%n,((k+1)%len(rings))*n+(j+1)%n,((k+1)%len(rings))*n+j)for k in range(len(rings))for j in range(n)]
 ob=B.mesh('Cane stool continuous bevelled open seat frame',[v for ring in rings for v in ring],faces,'wood',True);ob['seatSurface']=True
 for k in range(-6,7):
  x=k*(w-.10)/13;ob=B.rod('Cane stool seat warp '+str(k),(x,-d/2+.034,.456),(x,d/2-.034,.456),.004,'cane',8);ob['seatSurface']=True
 for k in range(-6,7):
  y=k*(d-.10)/13;ob=B.rod('Cane stool seat weft '+str(k),(-w/2+.034,y,.454),(w/2-.034,y,.454),.004,'cane',8);ob['seatSurface']=True

def x_stool():
 w,d,h=size();xx=w/2-.0325;yy=d/2-.048
 seat_frame('X stool',w,d,'leather')
 for y in [-yy,yy]:
  for sign in [-1,1]:B.sweep('X stool fixed crossed frame %s %s'%(y,sign),[(-sign*xx,y,.026),(0,y,.235),(sign*xx,y,.426)],[.047,.039,.050],[.044,.039,.047],n=8)
  B.rod('X stool brass fixed crossing pin '+str(y),(0,y-.030,.235),(0,y+.030,.235),.014,'brass',10)
 for x in [-xx,xx]:
  B.rect('X stool continuous ground bearer '+str(x),.062,d-.040,0,.041,x=x,mat='edge',r=.016)
  # Cross-frame ends directly enter the broad seat bearing frame; no coplanar side overlays.

def saddle_stool():
 w,d,h=size();nx=10;ny=4;v=[]
 def height(x):
  a=abs(x)/(w/2)
  return .460 if a>=.65 else .454+.006*(a/.65)**2
 for bottom in [True,False]:
  for j in range(ny+1):
   for i in range(nx+1):
    x=-w/2+w*i/nx;y=-d/2+d*j/ny;v.append((x,y,.421 if bottom else height(x)))
 n=(nx+1)*(ny+1);f=[]
 for j in range(ny):
  for i in range(nx):
   a=j*(nx+1)+i;f.append((a,a+nx+1,a+nx+2,a+1));f.append((n+a,n+a+1,n+a+nx+2,n+a+nx+1))
 boundary=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1)for j in range(ny-1,0,-1)]
 for k,a in enumerate(boundary):b=boundary[(k+1)%len(boundary)];f.append((a,b,n+b,n+a))
 ob=B.mesh('Saddle stool shaped shallow concave solid seat',v,f,'wood',True);ob['seatSurface']=True
 points=[(-w*.29,-d*.25),(w*.29,-d*.25),(0,d*.29)]
 for k,(x,y)in enumerate(points):
  B.sweep('Saddle stool tripod splayed leg '+str(k),[(x*1.22,y*1.19,.025),(x*1.12,y*1.10,.15),(x,y,.430)],[.045,.038,.052],[.041,.036,.048],n=8)
  B.lathe('Saddle stool attached ground shoe '+str(k),[(.023,0),(.023,.030)],x*1.22,y*1.19,'brass',10)
 for k in range(3):
  x,y=points[k];xx,yy=points[(k+1)%3];B.rod('Saddle stool triangular low stretcher '+str(k),(x*1.1,y*1.09,.167),(xx*1.1,yy*1.09,.167),.014,'edge')

def piano_stool():
 w,d,h=size();n=32
 rings=[]
 for r,z in [(.244,.418),(.257,.424),(.260,.441),(.255,.455),(.252,.460)]:rings.append([(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z)for i in range(n)])
 ob=B.shell('Piano stool round velvet cushion',rings,'velvet');ob['seatSurface']=True
 B.lathe('Piano stool fixed turned pedestal',[(.055,.075),(.072,.107),(.056,.142),(.036,.21),(.045,.315),(.081,.386),(.111,.425)],0,0,'wood',n=14)
 for k in range(4):
  a=k*math.pi/2;dx,dy=math.cos(a),math.sin(a)
  B.sweep('Piano stool shaped radial foot '+str(k),[(dx*.030,dy*.030,.121),(dx*.107,dy*.107,.109),(dx*.18,dy*.18,.05),(dx*.231,dy*.231,.022)],[.051,.046,.043,.043],[.045,.041,.040,.039],'edge',8)
  B.lathe('Piano stool attached brass foot shoe '+str(k),[(.022,0),(.023,.023)],dx*.231,dy*.231,'brass',10)
 B.lathe('Piano stool fixed brass bearing collar',[(.048,.305),(.048,.319)],0,0,'brass',n=14)

def boot_bench():
 w,d,h=size();seat_frame('Boot bench',w,d)
 xs=[-w/2+.090,0,w/2-.090];ys=[-d*.38,d*.38]
 for x in xs:
  for y in ys:leg('Boot bench turned load leg %.3f %.3f'%(x,y),x,y)
 for x in xs:
  B.rect('Boot bench shoe-rack cross bearer '+str(x),.044,d-.06,.132,.156,x=x,mat='edge',r=.010)
  B.rect('Boot bench upper load bearer '+str(x),.051,d-.05,.351,.415,x=x,mat='edge',r=.010)
 for k in range(-2,3):B.rect('Boot bench genuine lower shoe-rack slat '+str(k),w-.105,.055,.149,.176,y=k*d*.162,mat='wood',r=.011)
 for y in ys:B.rect('Boot bench longitudinal underseat apron '+str(y),w-.135,.036,.342,.414,y=y,mat='edge',r=.010)
 # The broad 1355 mm seat supports capacity two, with an attached centre seam welt.
 B.rod('Boot bench centre cushion seam welt',(0,-d/2+.018,.459),(0,d/2-.018,.459),.001,'velvet',6)

def hall_settle():
 w,d,h=size();seat_frame('Hall settle',w,d*.78,y=-d*.11)
 xs=[-w/2+.080,0,w/2-.080];front=-d*.39;rear=d*.25
 for x in xs:
  leg('Hall settle front load leg '+str(x),x,front)
  B.lathe('Hall settle rear joined ground foot '+str(x),[(.024,0),(.025,.030)],x,rear,n=10)
  B.sweep('Hall settle continuous rear upright '+str(x),[(x,rear,.020),(x,rear,.24),(x,d*.27,.427),(x,d/2-.022,h-.023)],[.046,.041,.056,.045],[.042,.040,.046,.042],n=8)
 for y in [front,rear]:B.rect('Hall settle longitudinal seat apron '+str(y),w-.12,.040,.340,.414,y=y,mat='edge',r=.010)
 for x in xs:B.rect('Hall settle cross-seat bearing '+str(x),.044,d*.65,.342,.414,x=x,y=-d*.068,mat='wood',r=.010)
 y=d/2-.022
 B.rect('Hall settle lower full back bearing rail',w-.075,.044,.494,.540,y=y,mat='edge',r=.011)
 B.rect('Hall settle full back crest rail',w,.044,h-.050,h,y=y,mat='edge',r=.015)
 fieldw=(w-.18)/3
 for k in [-1,0,1]:
  x=k*(fieldw+.045)
  B.rect('Hall settle solid raised back field '+str(k),fieldw,.027,.523,h-.066,x=x,y=y-.012,mat='wood',r=.009)
  for zz,label in [(.535,'lower'),(h-.064,'upper')]:B.rect('Hall settle panel '+str(k)+' '+label+' attached moulding',fieldw+.018,.033,zz,zz+.033,x=x,y=y-.025,mat='edge',r=.010)
  for sx in [-1,1]:B.rect('Hall settle panel '+str(k)+' attached stile '+str(sx),.028,.036,.524,h-.038,x=x+sx*fieldw*.49,y=y-.025,mat='edge',r=.009)
 for sign in [-1,1]:
  xx=sign*(w/2-.024)
  B.sweep('Hall settle continuous enclosing arm '+str(sign),[(xx,-d*.35,.63),(xx,-d*.04,.67),(xx,d*.29,.67)],[.048]*3,[.046]*3,'edge',8)
  B.sweep('Hall settle front arm bearing '+str(sign),[(xx,-d*.35,.414),(xx,-d*.35,.632)],[.044,.046],[.043,.043],'wood',8)
  B.rect('Hall settle closed side panel '+str(sign),.025,d*.60,.434,.642,x=xx-sign*.016,y=-d*.04,mat='wood',r=.010)


def telephone_bench():
 w,d,h=size();sw=.500;sx=-w/2+sw/2;tw=w-sw-.015;tx=w/2-tw/2
 seat_frame('Telephone bench seat',sw,d,y=0,x=sx)
 for x in [sx-sw*.397,sx+sw*.397]:
  for y in [-d*.38,d*.38]:leg('Telephone bench seat load leg %.3f %.3f'%(x,y),x,y)
 for x in [tx-tw*.36,tx+tw*.36]:
  for y in [-d*.38,d*.38]:
   B.sweep('Telephone bench tall table load post %.3f %.3f'%(x,y),[(x,y,.024),(x,y,.19),(x,y,h-.026)],[.044,.034,.048],[.041,.034,.046],n=8)
   B.lathe('Telephone bench table ground shoe %.3f %.3f'%(x,y),[(.021,0),(.022,.029)],x,y,'brass',10)
 B.rect('Telephone bench connecting main bearing sill',w-.026,d-.047,.352,.414,mat='edge',r=.014)
 B.rect('Telephone bench lower book shelf',tw-.010,d-.065,.248,.281,x=tx,mat='wood',r=.012)
 B.rect('Telephone bench raised telephone platform',tw,d,h-.036,h,x=tx,mat='edge',r=.021)
 # Seat's own low rear is structurally separate from the taller adjacent table.
 y=d/2-.020
 for x in [sx-sw*.43,sx+sw*.43]:B.sweep('Telephone bench seat back upright '+str(x),[(x,d*.38,.414),(x,y,.736)],[.041,.040],[.041,.040])
 B.rect('Telephone bench seat low back rail',sw-.020,.040,.698,.754,x=sx,y=y,mat='edge',r=.014)
 for x in [sx-.110,sx,sx+.110]:B.rod('Telephone bench open low back spindle '+str(x),(x,y,.470),(x,y,.719),.011,'wood')
 B.rect('Telephone bench seat back lower bearing',sw-.035,.039,.449,.483,x=sx,y=y,mat='wood',r=.011)

BUILDERS.update({'prayer':prayer,'music':music,'cane-stool':cane_stool,'x-stool':x_stool,'saddle-stool':saddle_stool,'piano-stool':piano_stool,'boot-bench':boot_bench,'hall-settle':hall_settle,'telephone-bench':telephone_bench})
