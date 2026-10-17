"""Fifteen further original native seating structures and explicit variants."""
import math
from mathutils import Vector

def add_specs(b):
    box,loft,sweep,mesh,cushion,lathe,rr=b.box,b.loft,b.sweep,b.mesh,b.cushion,b.lathe,b.rounded_rect
    def shift(ob,x=0,y=0,z=0):
        for v in ob.data.vertices:v.co+=Vector((x,y,z))
        ob.data.update();return ob
    def flat_shell(name,outline,z0,z1,mat='wood'):
        cx=sum(p[0]for p in outline)/len(outline);cy=sum(p[1]for p in outline)/len(outline)
        rings=[]
        for z,sc in [(z0,.995),(z0+.004,1),(z1-.004,1),(z1,.995)]:rings.append([(cx+(x-cx)*sc,cy+(y-cy)*sc,z)for x,y in outline])
        return loft(name,rings,mat)
    def polygon_cushion(name,outline):
        # Chamfer sharp outline corners before sweeping the welt. This keeps
        # the narrow sewn tube from folding through itself at acute arc ends.
        beveled=[]
        for k,p in enumerate(outline):
            prev=Vector(outline[k-1]);cur=Vector(p);nxt=Vector(outline[(k+1)%len(outline)])
            incoming=(cur-prev).normalized();outgoing=(nxt-cur).normalized()
            if incoming.dot(outgoing)<math.cos(math.radians(30)):
                cut=min(.010,(cur-prev).length*.2,(nxt-cur).length*.2)
                beveled.extend([tuple(cur-incoming*cut),tuple(cur+outgoing*cut)])
            else:beveled.append(tuple(cur))
        outline=beveled
        cx=sum(p[0]for p in outline)/len(outline);cy=sum(p[1]for p in outline)/len(outline)
        rings=[]
        for z,sc in [(.355,.96),(.375,1),(.436,1),(.460,.96)]:rings.append([(cx+(x-cx)*sc,cy+(y-cy)*sc,z)for x,y in outline])
        ob=loft(name,rings,'fabric');ob['functionalRole']='seat-cushion';ob['seatTopMm']=460
        sweep(name+' attached continuous welt',[(cx+(x-cx)*.998,cy+(y-cy)*.998,.434)for x,y in outline],.003,'seam',4,True)
        return ob
    def rounded_roll(name,path,r,mat='fabric',sides=12):
        # Ring progression rounds the cap shoulders and domes both terminal
        # faces rather than ending each upholstered arm in a flat barrel disc.
        p=[Vector(v) for v in path]
        a=(p[1]-p[0]).normalized();z=(p[-1]-p[-2]).normalized()
        cap=.24*r
        pts=[p[0]-a*cap,p[0]-a*cap*.78,p[0]-a*cap*.38]+p+[p[-1]+z*cap*.38,p[-1]+z*cap*.78,p[-1]+z*cap]
        radii=[r*.35,r*.68,r*.91]+[r]*len(p)+[r*.91,r*.68,r*.35]
        return sweep(name,pts,radii,mat,sides)
    def foot_at(name,x,y):
        lathe(name,x,y,[(.027,0),(.031,.018),(.023,.06),(.019,.22),(.031,.30),(.034,.335)],'wood',10)
        lathe(name+' mounted brass shoe',x,y,[(.027,0),(.028,.005),(.028,.024),(.025,.028)],'brass',8)
    def seats(w,cap,d=.56,cy=-.04,prefix='Upholstered seat'):
        usable=w-.19;cw=(usable-.012*(cap-1))/cap
        for i in range(cap):cushion(prefix+' '+str(i+1),(i-(cap-1)/2)*(cw+.012),cy,cw,d)
    def shaped_rail_back(w,depth,h,wood=True):
        yy=depth/2-.033
        for sx in [-1,1]:box('Continuous rear load-bearing back stile',(sx*(w/2-.028),yy,(.335+h-.045)/2),(.052,.056,h-.045-.335),'wood',.007)
        sweep('Back lower walnut supporting rail',[(-w/2+.026,yy,.425),(0,yy,.435),(w/2-.026,yy,.425)],.025,'trim',6)
        sweep('Back upper gently arched crown',[(-w/2+.028,yy,h-.055),(0,yy,h-.025),(w/2-.028,yy,h-.055)],.025,'trim',8)
    def compact_loveseat():
        w,d,h=1.25,.74,.96;b.legs(w,d);b.seat_frame(w,d);seats(w,2,.535,-.046,'Compact loveseat cushion')
        for s in [-1,1]:
            # Padded side shell with timber core and modest front arm height.
            loft('Compact salon upholstered side arm '+str(s),[rr(s*.570,0,ww,.63,.042,z,n=2)for ww,z in [(.106,.31),(.110,.36),(.110,.605),(.099,.645)]],'fabric')
            sweep('Compact salon arm rounded bead '+str(s),[(s*.570,-.270,.647),(s*.570,-.22,.661),(s*.565,.045,.677),(s*.557,.278,.846)],.028,'trim',8)
        outline=[(-.540,.407),(.540,.407),(.540,.849),(.45,.878),(.27,.899),(0,.920),(-.27,.899),(-.45,.878),(-.540,.849)]
        b.extrusion('Loveseat padded scalloped fluted back',outline,.257,.334,'fabric')
        crown=[(x,.315,z+.014)for x,z in outline[2:]]
        sweep('Loveseat fitted walnut upper crown',crown,.023,'trim',8)
        b.extrusion('Loveseat small attached crown carving',[(-.030,.921),(0,.960),(.030,.921),(0,.929)],.300,.330,'trim')
        for x in [-.420,-.280,-.140,0,.140,.280,.420]:sweep('Loveseat attached vertical back seam',[(x,.256,.455),(x,.256,.83+.07*(1-abs(x)/.54))],.0025,'seam',4)
        for x in [-.53,.53]:box('Loveseat back timber upright',(x,.307,.606),(.045,.049,.567),'wood')
    def fainting():
        w,d=2.05,.80;b.legs(w,d);b.seat_frame(w,d);cushion('Fainting couch long reclining pad',.032,-.032,1.775,.650)
        # One high left end and a descending partial rear back, unlike a daybed.
        outline=[(-.947,.355),(-.775,.355),(-.775,.824),(-.847,.906),(-.947,.927)]
        n=len(outline);v=[(x,y,z)for y in [-.327,.327]for x,z in outline];f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
        mesh('Fainting high upholstered head end',v,f,'fabric')
        sweep('Fainting high-end shaped walnut rail',[(-.928,-.33,.932),(-.94,0,.945),(-.928,.330,.932)],.025,'trim',8)
        rear=[(-.91,.475),(.916,.475),(.916,.57),(.63,.62),(.28,.665),(-.10,.74),(-.52,.84),(-.91,.902)]
        b.extrusion('Fainting diagonal upholstered partial back',rear,.287,.350,'fabric')
        sweep('Fainting descending walnut back crest',[(x,.323,z+.011)for x,z in rear[2:]],.018,'trim',8)
        sweep('Fainting back attached perimeter seam',[(x,.285,z)for x,z in rear],.003,'seam',4,True,smooth=False)
        for x in [-.90,.46,.90]:box('Fainting rear support post',(x,.32,.410),(.034,.034,.15),'wood')
        # Small rolled foot-end lip, the other end remains visually open/low.
        rounded_roll('Fainting low foot-end bolster',[(.920,-.290,.543),(.930,0,.56),(.920,.295,.543)],.048,'fabric',10)
        box('Fainting foot-end timber support',(.930,0,.415),(.062,.58,.17),'wood')
    def settle(w=2.,cap=3):
        d,h=.76,1.32;b.legs(w,d);b.seat_frame(w,d);seats(w,cap,.555,-.032,'High settle velvet seat')
        # Three genuine inset panel fields supported by stiles, rails and back.
        box('Settle continuous rear backing',(0,.350,.823),(w-.068,.054,.964),'wood',.006)
        for x in [-w/2+.037,w/2-.037]:box('Settle full-height outer stile',(x,.327,.825),(.068,.060,.986),'trim',.007)
        panelw=(w-.19)/3
        for i in range(3):
            x=(i-1)*(panelw+.015)
            box('Settle raised walnut back panel '+str(i+1),(x,.314,.86),(panelw-.031,.030,.696),'trim',.007)
        # Four unique mullions avoid overlapping paired same-plane strips.
        for xx in [-1.5*panelw-.015,-.5*panelw-.0075,.5*panelw+.0075,1.5*panelw+.015]:box('Settle panel muntin',(xx,.294,.853),(.050,.030,.755),'wood')
        for z in [.450,1.255]:box('Settle transverse back moulding',(0,.289,z),(w-.11,.045,.059),'trim',.009)
        box('Settle continuous full crown',(0,.329,1.300),(w,.102,.040),'trim',.009)
        for s in [-1,1]:
            x=s*(w/2-.045)
            sweep('Settle shaped open wooden arm '+str(s),[(x,-.277,.680),(x,-.20,.706),(x,.050,.750),(x,.316,.875)],.027,'trim',8)
            sweep('Settle front arm load post '+str(s),[(x,-.277,.329),(x,-.277,.680)],.023,'wood',6)
    def corner(mirror=False):
        outline=[(-1.05,-.70),(-.35,-.70),(-.35,-.06),(1.05,-.06),(1.05,.70),(-1.05,.70)]
        flat_shell('L-shaped corner seat platform',outline,.315,.355)
        for x,y in [(-.945,-.59),(-.445,-.59),(-.945,.57),(-.445,.57),(.30,.57),(.95,.57),(.30,.06),(.95,.06)]:foot_at('Corner floor foot %.3f %.3f'%(x,y),x,y)
        for x in [-.03,.65]:cushion('Corner main two-person cushion',x,.260,.660,.645)
        cushion('Corner continuous perpendicular chaise cushion',-.645,-.045,.534,1.182)
        box('Corner back internal horizontal rail',(0,.598,.441),(2.025,.062,.170),'wood',.004)
        box('Corner return back internal rail',(-.991,-.008,.441),(.062,1.278,.170),'wood',.004)
        outlineback=[(-1.05,.355),(1.05,.355),(1.05,.901),(.45,.919),(-.40,.920),(-1.05,.901)]
        b.extrusion('Corner continuous padded main back',outlineback,.545,.700,'fabric')
        # Return has a perpendicular upholstered back shell, ending in a real upright.
        ob=box('Corner perpendicular upholstered return back',(-.975,-.022,.635),(.138,1.260,.56),'fabric',.018)
        sweep('Corner main rolled sewn crown',[(-1.03,.620,.916),(0,.620,.920),(1.03,.620,.916)],.030,'seam',10)
        sweep('Corner return rounded upper rail',[(-.990,-.632,.899),(-.990,-.02,.899),(-.990,.605,.899)],.030,'seam',10)
        sweep('Corner attached front back seam',[(-1.01,.542,.53),(0,.542,.53),(1.01,.542,.53)],.003,'seam',4)
        loft('Corner outer right padded arm',[rr(.959,.259,.146,.622,.050,z,n=3)for z in [.322,.37,.660,.685]],'fabric')
        if mirror:
            for ob in b.PARTS:
                for v in ob.data.vertices:v.co.x*=-1
                ob.data.update()
                # Repair after reflection reverses the native faces consistently.
                b.positive_winding(ob)
    def arc_outline(x0,x1,back,front,n=10):
        xs=[x0+(x1-x0)*i/n for i in range(n+1)]
        return [(x,back(x))for x in xs]+[(x,front(x))for x in reversed(xs)]
    def bent_back(name,w,curve,yhalf,z0,z1,n=20):
        xs=[-w/2+w*i/n for i in range(n+1)];verts=[]
        for z in [z0,z1]:
            for dy in [-yhalf,yhalf]:verts.extend((x,curve(x)+dy,z)for x in xs)
        m=n+1;f=[]
        for i in range(n):f.extend([(i,i+1,2*m+i+1,2*m+i),(m+i,3*m+i,3*m+i+1,m+i+1),(i,m+i,m+i+1,i+1),(2*m+i,2*m+i+1,3*m+i+1,3*m+i)])
        f.extend([(0,2*m,3*m,m),(n,m+n,3*m+n,2*m+n)])
        return mesh(name,verts,f,'fabric')
    def inward():
        w=2.5;rear=lambda x:.625-.500*(x/1.25)**2;front=lambda x:-.050-.575*(x/1.25)**2
        outline=arc_outline(-1.25,1.25,rear,front,20);flat_shell('Inward curved conversation seat foundation',outline,.315,.355)
        for x in [-1.12,-.55,.55,1.12]:
            for y in [front(x)+.09,rear(x)-.09]:foot_at('Conversation curved-base foot',x,y)
        for i,(x0,x1)in enumerate([(-1.18,-.62),(-.60,-.02),(.02,.60),(.62,1.18)],1):polygon_cushion('Inward facing arc seat '+str(i),arc_outline(x0,x1,lambda x:rear(x)-.13,lambda x:front(x)+.045,5))
        curve=lambda x:rear(x)-.050
        bent_back('Continuous inward curved velvet back',2.43,curve,.035,.411,.947,20)
        crown=[(x,curve(x),.972)for x in [-1.20+2.4*i/20 for i in range(21)]]
        sweep('Inward curved walnut crown',crown,.028,'trim',8)
        for x in [-1.12,-.60,0,.60,1.12]:box('Conversation back load post',(x,curve(x),.415),(.038,.047,.150),'wood')
        for s in [-1,1]:
            x=s*1.207
            sweep('Conversation end swept walnut arm '+str(s),[(x,front(x)+.03,.674),(x,front(x)+.18,.697),(x,rear(x)-.10,.884)],.027,'trim',8)
            sweep('Conversation front arm load spindle '+str(s),[(x,front(x)+.03,.335),(x,front(x)+.03,.674)],.019,'wood',6)
        sweep('Conversation sewn back lower welt',[(x,curve(x)-.035,.498)for x in [-1.20+2.4*i/20 for i in range(21)]],.003,'seam',4)
    def window():
        w=1.8;rear=lambda x:.36-.07*(x/.90)**2;front=lambda x:-.36+.14*(x/.90)**2
        flat_shell('Bow-shaped window sofa seat platform',arc_outline(-.9,.9,rear,front,16),.315,.355)
        for x in [-.76,0,.76]:
            for yy in [front(x)+.08,rear(x)-.08]:foot_at('Window sofa turned support',x,yy)
        for n,(x0,x1)in enumerate([(-.815,-.007),(.007,.815)],1):polygon_cushion('Window sofa curved cushion '+str(n),arc_outline(x0,x1,lambda x:rear(x)-.10,lambda x:front(x)+.045,6))
        curve=lambda x:rear(x)-.05
        bent_back('Window sofa low curved upholstered back',1.73,curve,.020,.49,.763,16)
        sweep('Window sofa gently curved walnut top',[(-.875+1.75*i/16,curve(-.875+1.75*i/16),.795)for i in range(17)],.025,'trim',8)
        for x in [-.835,-.42,0,.42,.835]:sweep('Window sofa exposed back spindle',[(x,curve(x),.332),(x,curve(x),.773)],.017,'wood',6)
        sweep('Window sofa fitted back lower welt',[(x,curve(x)-.023,.504)for x in [-.855+1.71*i/16 for i in range(17)]],.003,'seam',4)
    def servants():
        w,d=1.35,.65;b.legs(w,d);b.seat_frame(w,d);cushion('Servants continuous two-seat simple padded bench',0,-.033,1.170,.487)
        yy=.286
        for x in [-.63,.63]:box('Servants full continuous rear post',(x,yy,.618),(.049,.048,.572),'wood',.004)
        for z in [.473,.891]:box('Servants plain structural cross back rail',(0,yy,z),(1.310,.039,.058),'wood',.006)
        for i in range(8):
            x=-.540+1.08*i/7;box('Servants separate vertical back slat '+str(i),(x,yy,.687),(.071,.024,.369),'trim',.006)
        sweep('Servants upper rounded plain crown',[(-.650,yy,.902),(0,yy,.902),(.650,yy,.902)],.018,'trim',6)
    def recamier():
        w,d=2.05,.80;b.legs(w,d);b.seat_frame(w,d);cushion('Recamier single long static reclining pad',0,0,1.765,.656)
        for s in [-1,1]:
            # Two opposite upholstered scroll ends; no rear back wall.
            loft('Recamier opposite rising end '+str(s),[rr(s*.932,0,ww,.687,min(.055,ww*.45),z,n=3)for ww,z in [(.168,.324),(.180,.369),(.140,.672),(.098,.749)]],'fabric')
            rounded_roll('Recamier rounded end roll '+str(s),[(s*.936,-.307,.785),(s*.944,0,.785),(s*.936,.307,.785)],.065,'fabric',12)
            sweep('Recamier walnut end lower curved framing '+str(s),[(s*.911,-.330,.332),(s*.957,-.320,.517),(s*.936,-.307,.750)],.021,'trim',6)
            for yy in [-.322,.322]:sweep('Recamier end sewn upholstery seam '+str(s),[(s*.945,yy,.390),(s*.965,yy,.620),(s*.940,yy,.750)],.003,'seam',4)
    def daybed():
        w,d=2.05,.95;b.legs(w,d);b.seat_frame(w,d);cushion('Daybed full static lounging mattress',0,-.046,1.797,.690)
        # Three continuous padded sides with solid wood bottom rails.
        outline=[(-.987,.333),(.987,.333),(.987,.96),(.70,.978),(0,.994),(-.70,.978),(-.987,.96)]
        b.extrusion('Daybed continuous upholstered rear wall',outline,.329,.461,'fabric')
        sweep('Daybed rear gently rounded wood crown',[(-1.004,.429,.976),(0,.429,.997),(1.004,.429,.976)],.023,'trim',8)
        for s in [-1,1]:
            loft('Daybed padded side wall '+str(s),[rr(s*.959,-.027,.124,.818,.045,z,n=3)for z in [.326,.37,.731,.767]],'fabric')
            sweep('Daybed side rounded top welt '+str(s),[(s*.959,-.388,.778),(s*.959,0,.798),(s*.959,.364,.865)],.025,'seam',8)
            box('Daybed side timber inner bearer',(s*.954,-.027,.363),(.064,.792,.078),'wood')
        box('Daybed rear load-bearing rail',(0,.415,.375),(1.983,.063,.100),'wood')
        sweep('Daybed attached upholstered rear seam',[(-.939,.325,.519),(0,.325,.519),(.939,.325,.519)],.003,'seam',4)
    def channel_divan():
        w,d,h=2.00,.88,1.;b.legs(w,d);b.seat_frame(w,d);seats(w,3,.636,-.060,'Divan split seat cushion')
        # Continuous backing and separate sewn rounded upholstery channels.
        box('Divan back internal timber backing',(0,.359,.674),(1.900,.062,.643),'wood')
        for i in range(12):
            x=-.870+1.74*i/11
            outline=[(x-.077,.417),(x+.077,.417),(x+.077,.909),(x+.061,.949),(x,.963),(x-.061,.949),(x-.077,.909)]
            b.extrusion('Divan upholstered vertical sewn channel '+str(i+1),outline,.303,.379,'fabric')
            sweep('Divan attached channel stitched line '+str(i+1),[(x-.075,.302,.450),(x-.075,.302,.915)],.002,'seam',4)
        sweep('Divan shaped carved top rail',[(-.959,.362,.951),(0,.362,.975),(.959,.362,.951)],.025,'trim',8)
        for s in [-1,1]:
            loft('Divan enclosed velvet arm '+str(s),[rr(s*.922,-.045,.148,.753,.055,z,n=3)for z in [.323,.37,.656,.696]],'fabric')
            sweep('Divan rounded arm upper seam '+str(s),[(s*.922,-.383,.698),(s*.922,-.20,.723),(s*.922,.278,.785)],.028,'seam',8)
    def spindle():
        w,d,h=1.6,.70,1.1;b.legs(w,d);b.seat_frame(w,d);seats(w,2,.521,-.041,'Hall settee cushion')
        yy=.302
        for x in [-.758,.758]:box('Hall settee tall continuous back outer post',(x,yy,.691),(.067,.055,.727),'wood',.008)
        sweep('Hall settee curved spindle top crown',[(-.767,yy,1.052),(-.5,yy,1.066),(0,yy,1.075),(.5,yy,1.066),(.767,yy,1.052)],.025,'trim',8)
        box('Hall settee lower spindle connecting rail',(0,yy,.486),(1.526,.045,.055),'trim',.007)
        for i in range(11):
            x=-.690+1.38*i/10;top=1.047+.025*(1-abs(x)/.767)
            lathe('Hall settee exposed turned back spindle '+str(i),x,yy,[(.011,.485),(.013,.508),(.009,.635),(.014,.78),(.009,.91),(.012,top)],'wood',8)
        for s in [-1,1]:
            x=s*.758;sweep('Hall settee simple open arm '+str(s),[(x,-.247,.683),(x,-.08,.708),(x,.300,.815)],.023,'trim',8)
            sweep('Hall settee front arm support '+str(s),[(x,-.247,.332),(x,-.247,.683)],.017,'wood',6)
    def tete():
        outline=[(-.80,-.55),(-.015,-.55),(-.015,-.24),(.80,-.24),(.80,.55),(.015,.55),(.015,.24),(-.80,.24)]
        flat_shell('Opposed conversation staggered seat foundation',outline,.315,.355)
        for x,y in [(-.69,-.44),(-.12,-.44),(-.69,.135),(-.12,.135),(.69,.44),(.12,.44),(.69,-.135),(.12,-.135)]:foot_at('Opposed conversation floor foot',x,y)
        cushion('Opposed left front-facing seat',-.40,-.234,.610,.550);cushion('Opposed right rear-facing seat',.40,.234,.610,.550)
        curve=lambda x:-.16*math.sin(math.pi*x/.78)
        bent_back('Sinuous opposed-facing upholstered divider',1.56,curve,.045,.407,.950,20)
        sweep('Opposed serpentine carved back crest',[(x,curve(x),.975)for x in [-.776+1.552*i/20 for i in range(21)]],.025,'trim',8)
        for x in [-.72,-.40,0,.40,.72]:box('Opposed divider supporting walnut post',(x,curve(x),.405),(.040,.041,.154),'wood')
        for s in [-1,1]:
            x=s*.756;y=s*.399
            sweep('Opposed end short curved arm '+str(s),[(x,y,.676),(x,s*.245,.723),(x,curve(x),.872)],.025,'trim',8)
            sweep('Opposed outside arm spindle '+str(s),[(x,y,.333),(x,y,.676)],.018,'wood',6)
    def camel_three():
        # Rebuild from real two-seat topology, extending horizontal members and
        # replacing two cushions with three; no uniform vertical/seat rescale.
        start=len(b.PARTS);b.camelback()
        for ob in list(b.PARTS[start:]):
            if ob.get('functionalRole')=='seat-cushion' or ob.name.startswith('Two-seat velvet cushion'):
                b.PARTS.remove(ob);b.bpy.data.objects.remove(ob,do_unlink=True);continue
            for v in ob.data.vertices:v.co.x*=2.10/1.55
            ob.data.update()
        for x in [-.643,0,.643]:cushion('Three-seat camelback usable cushion',x,-.079,.631,.568)
    specs=[]
    def add(slug,name,size,fn,cap,style,meaning,color='#466e58',cushions=None,variant=None):
        specs.append(dict(slug=slug,name=name,size=size,fn=fn,capacity=cap,cushions=cushions if cushions is not None else cap,color=color,style=style,meaning=meaning,variantOf=variant))
    add('compact-salon-loveseat','二人用・小型閉肘サロンラブシート',(1250,740,960),compact_loveseat,2,'compact-closed-fluted-salon','Compact two-person enclosed-arm salon loveseat with a scalloped fluted padded back and real 535 mm deep split seats','#a28161')
    add('asymmetric-fainting-couch','一人用・片側高背の静的フェインティングカウチ',(2050,800,970),fainting,1,'single-high-end-diagonal-back-lounge','Static single reclining couch: one tall head end, descending partial rear back and low foot lip; 1775 mm long measured continuous pad','#716887')
    add('high-back-settle-three','三人用・三枚木板高背セトル',(2000,760,1320),lambda:settle(2.,3),3,'solid-three-panel-high-back-settle','Three-person high-backed walnut settle with three genuine raised back fields and open wood arms','#4e6655')
    add('corner-settee-left','三人用・左戻りL字セティ',(2100,1400,950),lambda:corner(False),3,'left-return-seating','Three-person L footprint with two main seats and one continuous left chaise-return cushion covering the corner; independent static upholstery and floor supports','#6a777c')
    add('corner-settee-right','三人用・右戻りL字セティ',(2100,1400,950),lambda:corner(True),3,'right-return-seating','Mirrored right-return layout variant of the same L-seating design; this is a layout variant, not a separate style','#6a777c',variant='corner-settee-left')
    add('inward-conversation-sofa','四人用・内向き曲線会話ソファ',(2500,1250,1000),inward,4,'curved-inward-conversation','Four individually built inward-curved seating areas with a continuous bent upholstered back and curved open walnut ends','#5a6e83')
    add('curved-window-sofa','二人用・弓形窓辺の低背ソファ',(1800,720,820),window,2,'bowed-window-upholstered-bench','Two bowed seat pads on a genuinely curved window bench foundation, low padded ribbon back and exposed spindle supports','#8d8270')
    add('servants-compact-settee','二人用・使用人室の小型無肘セティ',(1350,650,920),servants,2,'armless-slatted-service-settee','Plain armless servants settee with eight open back slats, one continuous 1170 mm two-person padded seat and turned floor legs','#8b7767',cushions=1)
    add('double-end-recamier','一人用・両端巻肘の静的レカミエ',(2050,800,850),recamier,1,'opposed-scroll-end-backless-lounge','Backless static lounge with two opposite upholstered scroll ends and one 1765 mm reclining pad; no operating recline mechanism','#8f5961')
    add('three-side-daybed','一人用・三面張りの静的デイベッド',(2050,950,1020),daybed,1,'three-sided-enclosed-static-daybed','Static three-sided daybed with one continuous 1797 mm lounging mattress, enclosing side walls and an arched upholstered rear wall','#687b73')
    add('channel-back-divan','三人用・縦縫いチャンネル背ディバン',(2000,880,1000),channel_divan,3,'vertical-channel-upholstered-divan','Three-person divan with twelve physically separate sewn vertical back channels, full side arms and split velvet seats','#9c7a56')
    add('spindle-hall-settee','二人用・十一丸棒背ホールセティ',(1600,700,1100),spindle,2,'open-turned-spindle-hall-settee','Two-person hall settee with eleven exposed turned back spindles, continuous crown and open wood arms','#4e7476')
    add('tete-a-tete-settee','二人用・対向座面の会話セティ',(1600,1100,1000),tete,2,'opposed-facing-serpentine-conversation','Two opposite-facing seats separated by one genuinely sinuous S-divider, on a staggered two-lobe footprint; static geometry','#8b637c')
    add('camelback-settee-three','三人用・曲線木肘キャメルバック幅広変種',(2100,800,1050),camel_three,3,'camelback-open-arm','Three-person capacity/usable-width variant of the two-seat camelback design; unchanged 460 mm height and 568 mm usable seat depth','#466e58',variant='camelback-settee-two')
    add('high-back-settle-two','二人用・三枚木板高背セトル小幅変種',(1450,760,1320),lambda:settle(1.45,2),2,'solid-three-panel-high-back-settle','Two-person capacity/width variant of the three-person high-backed settle; panels and static open arms retain the same structural design','#4e6655',variant='high-back-settle-three')
    return specs
