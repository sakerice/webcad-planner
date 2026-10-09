"""Original attached, volumetric garden foliage; seeded editable branch hierarchies."""
from common import *

def sprig(name,start,end,rng,count=13,length=.15,width=.10,parent=None,leafmats=('leaf','leaflight','leafdark'),rounded=True,branchmat='bark'):
    start,end=Vector(start),Vector(end);axis=(end-start).normalized();mid=start.lerp(end,.55)+Vector((0,0,.025))
    path=[start,mid,end];ob=sweep(name,path,[.005,.0035,.0015],mat=branchmat,sides=5,role='secondary-branch')
    if parent:attach(start,parent)
    side=axis.cross(Vector((0,0,1))).normalized()
    if side.length<.05:side=Vector((1,0,0))
    groups=[[],[],[]]
    for j in range(count):
        t=.13+.85*(j/(count-1));root=polyline_point(path,t);sgn=-1 if j%2 else 1
        phi=j*2.39996323+rng.uniform(-.25,.25)
        direction=axis*.30+side*(math.cos(phi)*.85)+axis.cross(side)*(math.sin(phi)*.65)+Vector((0,0,.25))
        ln=length*rng.uniform(.8,1.15)*(1-.28*t)
        groups[j%3].append((root,direction,ln,width*(ln/length),rng.uniform(-.5,.5),.0018,rounded));attach(root,ob,'leaf-root',.005)
    for i,leaves in enumerate(groups):
        if leaves:leaf_group(name+' leaves '+str(i),leaves,leafmats[i])
    return ob

def deciduous(multistem=False):
    rng=random.Random(23061 if multistem else 97003)
    stems=[]
    if multistem:
        for i,a in enumerate([.1,1.75,3.3,4.95]):
            end=Vector((.29*math.cos(a),.29*math.sin(a),1.75+(i%2)*.23))
            path=[Vector((.04*math.cos(a),.04*math.sin(a),0)),Vector((.13*math.cos(a),.13*math.sin(a),.72)),end]
            stems.append((sweep('Deciduous basal stem '+str(i),path,[.037,.03,.018],sides=8,role='grounded-stem'),path))
    else:
        path=[Vector((0,0,0)),Vector((-.025,.01,.9)),Vector((.035,-.025,1.9)),Vector((.03,0,2.85))]
        stems=[(sweep('Broad canopy continuous central trunk',path,[.09,.07,.044,.012],sides=10,role='grounded-stem'),path)]
        for i in range(5):
            a=math.tau*i/5;sweep('Visible root flare '+str(i),[(.22*math.cos(a),.22*math.sin(a),.006),(0,0,.25)],[.008,.07],sides=6)
    for i in range(12):
        a=i*2.399963229728653;level=i%3;stem,path=stems[i%len(stems)]
        if multistem:
            root=polyline_point(path,.56+.13*level);height=1.6+level*.33+rng.uniform(-.09,.11);radius=.67+.08*level
        else:
            root=polyline_point(path,.38+.10*level);height=2.05+level*.30+rng.uniform(-.06,.07);radius=1.01-.21*level
        end=Vector((radius*math.cos(a),radius*(.9+.06*math.sin(a))*math.sin(a),height))
        mainpath=[root,root.lerp(end,.50)+Vector((0,0,.12)),end]
        main=sweep('Scaffold bough %02d'%i,mainpath,[.024,.016,.007],sides=7,role='primary-branch');attach(root,stem)
        for k in range(12):
            t=.25+.72*(k/11);base=polyline_point(mainpath,t)
            spread=a+(1 if k%2 else -1)*rng.uniform(.55,1.6)
            reach=rng.uniform(.22,.43);vertical=rng.uniform(-.04,.28)
            if k>8:vertical+=.12
            tip=base+Vector((math.cos(spread)*reach,math.sin(spread)*reach,vertical))
            sprig('Leaf bearing twig %02d %02d'%(i,k),base,tip,rng,count=13,length=.19 if not multistem else .175,width=.133 if not multistem else .110,parent=main)
    DATUM.update(plantStructure={'speciesIntent':'Layered broadleaf specimen with asymmetric rounded crown'if not multistem else'Four-stem deciduous garden specimen with layered open crown','scaffoldBoughs':12,'secondarySprigs':144,'leafCount':1872,'attachmentPolicy':'Every branch starts inside its parent; every leaf root lies on its supporting sprig centerline.','triangleBudget':30000},installation={'mount':'ground','rootPlaneBlenderZ':0,'note':'Static ornamental planting model; soil excavation, root viability and load capacity are not simulated.'})

def conifer():
    rng=random.Random(44103)
    trunkpath=[Vector(p)for p in [(0,0,0),(.015,-.014,.75),(-.008,.008,1.5),(0,0,2.08)]]
    trunk=sweep('Evergreen leader',trunkpath,[.045,.029,.016,.003],sides=9,role='grounded-stem')
    for level in range(10):
        layer_z=.34+level*.167;radius=.43*(1-level/12)
        for j in range(6):
            a=j*math.tau/6+level*.47;z=layer_z+.052*math.sin(j*1.71+level*.81)
            segment=next(k for k in range(3)if trunkpath[k].z<=z<=trunkpath[k+1].z)
            root=trunkpath[segment].lerp(trunkpath[segment+1],(z-trunkpath[segment].z)/(trunkpath[segment+1].z-trunkpath[segment].z));tip=Vector((radius*math.cos(a),radius*math.sin(a),z+.075+.040*math.cos(j*1.9+level)))
            path=[root,root.lerp(tip,.58)+Vector((0,0,-.02)),tip]
            branch=sweep('Evergreen layered bough %d %d'%(level,j),path,[.016*(1-level*.06),.009,.003],sides=6,role='primary-branch');attach(root,trunk)
            for k in range(3):
                base=polyline_point(path,[.18,.55,.91][k]);sgn=(-1)**k;ang=a+sgn*.67
                rise=[.18,.10,-.015][k]+.035*math.sin(j+level*.7)
                end=base+Vector((.16*math.cos(ang),.16*math.sin(ang),rise))
                sprig('Evergreen attached spray %d %d %d'%(level,j,k),base,end,rng,count=32,length=.112*(1-level*.018),width=.024,parent=branch,leafmats=('leafdark','leaf','leafdark'),rounded='needle',branchmat='leafdark')
    sprig('Evergreen leader tuft',(0,0,1.9),(0,0,2.18),rng,count=25,length=.09,width=.018,parent=trunk,leafmats=('leafdark','leaf','leafdark'),rounded='needle',branchmat='leafdark')
    DATUM.update(plantStructure={'speciesIntent':'Dense narrow evergreen with rising leader, fine clustered needle sprays and ten overlapping branch tiers','scaffoldBoughs':60,'secondarySprigs':181,'leafCount':5785,'triangleBudget':30000},installation={'mount':'ground','rootPlaneBlenderZ':0,'note':'Static ornamental evergreen; no wind animation or horticultural certification.'})

def hedge():
    rng=random.Random(703)
    for i in range(5):
        x=-.60+i*.30;y=.025*math.sin(i*2)
        path=[Vector((x,y,0)),Vector((x+.015,y,.18)),Vector((x+.025,y+.01,.48))]
        trunk=sweep('Low shrub rooted stem '+str(i),path,[.022,.016,.005],sides=6,role='grounded-stem')
        for j in range(20):
            a=j*2.3999632297+i*.3;t=.33+.57*((j%5)/4);root=polyline_point(path,t)
            reach=.22+.045*(j%3);tip=root+Vector((reach*math.cos(a),reach*math.sin(a),.10+.025*(j%4)))
            sprig('Connected low shrub sprig %d %d'%(i,j),root,tip,rng,count=12,length=.15,width=.10,parent=trunk)
    DATUM.update(plantStructure={'speciesIntent':'Continuous low clipped broadleaf border with overlapping crowns and five planted roots','secondarySprigs':100,'leafCount':1200,'triangleBudget':18000},installation={'mount':'ground','rootPlaneBlenderZ':0,'note':'Crown envelopes overlap into a connected low shrub mass; five internal stems are retained as editable support.'})

def fern():
    rng=random.Random(912)
    pot=lathe('Fern hollow terracotta pot',0,0,[(.0375,0),(.040,.018),(.061,.117),(.066,.128),(.066,.132),(.0568,.132),(.0568,.118),(.038,.020),(.0375,.018)],'pot',24)
    pot['functionalRole']='hollow-planter'
    lathe('Fern contained soil',0,0,[(.0375,.0175),(.040,.024),(.0568,.115)],'soil',24)
    crown=lathe('Fern root crown',0,0,[(.009,.107),(.010,.121),(.005,.130)],'bark',10)
    for i in range(10):
        a=i*math.tau/10;reach=.166*(.9+.12*math.sin(i*2));peak=.255+.025*math.sin(i)
        path=[Vector((reach*t*math.cos(a),reach*t*math.sin(a),z))for t,z in [(.025,.122),(.14,.178),(.35,peak-.018),(.62,peak),(.85,peak-.022),(1,peak-.070)]]
        stem=sweep('Fern curved frond %02d'%i,path,[.0024,.0021,.0018,.0014,.001,.00065],sides=5);attach(path[0],crown,'frond-root')
        leaves=[];radial=Vector((math.cos(a),math.sin(a),0));side=Vector((-math.sin(a),math.cos(a),0))
        for j in range(19):
            t=.12+.87*j/18;root=polyline_point(path,t);sgn=(-1)**j;length=.071*(math.sin(math.pi*t)*.7+.22)
            leaves.append((root,side*sgn+radial*.30+Vector((0,0,.13)),length,length*.33,.15*sgn,.00155));attach(root,stem,'leaf-root',.0024)
        leaf_group('Fern pinnules %02d'%i,leaves,'leaf'if i%2 else'leaflight')
    DATUM.update(plantStructure={'fronds':10,'pinnules':190},cavity={'rimHeightM':.132,'internalFloorM':.018,'openingRadiusM':.0568,'filledWithSoil':True},installation={'mount':'tabletop','note':'Static potted fern; bottom at placement surface.'})

def palm():
    rng=random.Random(882)
    pot=lathe('Fan palm continuous hollow planter',0,0,[(.16,0),(.18,.03),(.205,.34),(.221,.37),(.221,.40),(.195,.40),(.188,.35),(.151,.055),(.148,.045)],'pot',28);pot['functionalRole']='hollow-planter'
    lathe('Palm contained soil',0,0,[(.15,.05),(.188,.36)],'soil',24)
    trunk=sweep('Palm living trunk',[(0,0,.33),(.025,0,.9),(.012,.015,1.41)],[.055,.043,.026],sides=10)
    for j in range(10):
        a=j*2.39996323;z=1.11+(j%3)*.13;root=Vector((.015,.01,z));end=Vector((.32*math.cos(a),.32*math.sin(a),z+.18))
        stem=sweep('Palm petiole '+str(j),[root,root.lerp(end,.5)+Vector((0,0,.03)),end],[.013,.01,.007],sides=6);attach(root,trunk)
        leaves=[]
        for k in range(13):
            angle=a+(k-6)*.12;direction=Vector((math.cos(angle),math.sin(angle),.7-.05*abs(k-6)))
            leaves.append((end,direction,.36-.012*abs(k-6),.044,0,.002));attach(end,stem,'leaf-root',.007)
        leaf_group('Palm fan blade '+str(j),leaves,'leaf'if j%2 else'leafdark')
    DATUM.update(cavity={'rimHeightM':.40,'internalFloorM':.045,'openingRadiusM':.195,'filledWithSoil':True},plantStructure={'fanCount':10,'segmentsPerFan':13},installation={'mount':'floor','note':'Static ornamental palm in hollow planter.'})

def flower_box():
    body=loft('Window box continuous hollow trough',[rounded_rect(0,0,w,d,r,z,n=2)for w,d,r,z in [(1.08,.29,.025,0),(1.10,.32,.026,.21),(1.10,.32,.026,.235),(1.035,.255,.020,.235),(1.01,.23,.018,.04)]],'pot');body['functionalRole']='hollow-planter'
    soil=loft('Contained flower box soil',[rounded_rect(0,0,1.01,.23,.018,.04,n=2),rounded_rect(0,0,1.035,.255,.020,.211,n=2)],'soil')
    for x in [-.36,.36]:
        plate=box('Window wall bearing plate '+str(x),(x,.180,.13),(.045,.020,.26),'iron');plate['functionalRole']='wall-anchor'
        beam('Box support arm '+str(x),(x,.180,.019),(x,-.125,.019),.025,.028,'iron')
        sweep('Window box diagonal brace '+str(x),[(x,.190,.055),(x,-.123,.02)],[.009,.009],'iron',6)
        for z in [.035,.225]:sweep('Window anchor head '+str((x,z)),[(x,.165,z),(x,.177,z)],.007,'brass',8)
    rng=random.Random(792)
    for j in range(9):
        root=Vector((-.46+j*.115,.025*math.sin(j),.20));end=root+Vector((.035*math.sin(j),.04*math.cos(j),.20+.04*(j%3)))
        sprig('Flower box leafy shoot '+str(j),root,end,rng,count=9,length=.065,width=.035,parent=soil)
        lathe('Flower center '+str(j),end.x,end.y,[(.012,end.z-.006),(.019,end.z+.002),(.012,end.z+.011)],'brass',8)
        petals=[]
        for k in range(6):
            a=math.tau*k/6;petals.append((end,Vector((math.cos(a),math.sin(a),.15)),.038,.027,0,.003))
        leaf_group('Six attached flower petals '+str(j),petals,'flowerpink'if j%3 else'flower')
    DATUM.update(defaultElevationMm=900,cavity={'rimHeightM':.235,'internalFloorM':.04,'filledWithSoil':True},installation={'mount':'wall','wallContactPlaneBlenderY':.190,'defaultElevationMm':900,'anchorCentersX':[-.36,.36],'note':'Two physical wall plates and diagonal braces; substrate anchors and structural suitability are manual.'})

def climber():
    pot=loft('Trellis continuous hollow planter',[rounded_rect(0,0,w,d,r,z,n=2)for w,d,r,z in [(.80,.35,.03,0),(.84,.385,.035,.30),(.84,.385,.035,.34),(.765,.31,.027,.34),(.73,.28,.024,.045)]],'wood');pot['functionalRole']='hollow-planter'
    loft('Trellis contained soil',[rounded_rect(0,0,.73,.28,.02,.045,n=2),rounded_rect(0,0,.76,.30,.025,.309,n=2)],'soil')
    for x in [-.30,.30]:box('Trellis planted post '+str(x),(x,.146,.89),(.04,.044,1.721),'wood')
    rails=[]
    for z in [.60,.94,1.28,1.62]:
        rail=box('Trellis vine bearing cross rail '+str(z),(0,.139,z),(.70,.026,.035),'wood');rail['vineSupportZ']=z;rails.append(rail)
    for x in [-.15,0,.15]:box('Trellis upright lattice '+str(x),(x,.157,1.11),(.024,.021,1.27),'wood')
    rng=random.Random(490)
    for j in range(3):
        path=[]
        for k in range(17):
            z=.30+k*.087;x=(-.21+j*.21)+.045*math.sin(k*1.6+j);path.append(Vector((x,.124+.002*math.sin(k),z)))
        vine=sweep('Climbing attached main vine '+str(j),path,[.009-(k/16)*.004 for k in range(17)],'bark',5)
        for rail in rails:
            z=rail['vineSupportZ'];p=polyline_point(path,(z-.30)/(16*.087));p.y=.127;attach(p,rail,'vine-rail-contact');CONTACTS[-1]['source']=vine.name
        for k in range(10):
            root=polyline_point(path,.1+.085*k);sgn=(-1)**k;end=root+Vector((sgn*.12,-.015,.09))
            sprig('Climber leafy lateral %d %d'%(j,k),root,end,rng,count=7,length=.09,width=.056,parent=vine)
    DATUM.update(cavity={'rimHeightM':.34,'internalFloorM':.045,'filledWithSoil':True},installation={'mount':'floor','note':'Static planted trellis with four physical vine-support rails. No structural wall fixing represented.'})

