"""Import unchanged delivered GLBs, assemble actual stair joints and a visible upper-floor void."""
from pathlib import Path
import sys,json,math,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import *
from build import render,sha
from mathutils.bvhtree import BVHTree
import forms
ITEMS={x['id'].removeprefix('rpg-mansion-stair-').removesuffix('-01'):x for x in json.loads((HERE/'descriptors.json').read_text())['items']}
PLACED=[];CONTEXT=[];PROBES=[]

def place(slug,name,position=(0,0,0),angle=0):
    it=ITEMS[slug];before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(HERE/it['model']));obs=[x for x in set(bpy.data.objects)-before if x.type=='MESH'];shift=Vector(it['installationDatums']['bottomCenterTranslationBlenderM']);transform=Matrix.Translation(Vector(position))@Matrix.Rotation(angle,4,'Z')@Matrix.Translation(-shift)
    for ob in obs:
        old=ob.matrix_world.copy();ob.parent=None;ob.matrix_world=transform@old;ob.name=name;ob['assetId']=it['id'];ob['sourceSha256']=it['sha256']
    bpy.context.view_layer.update();assert len(obs)==1
    PLACED.append(dict(name=obs[0].name,id=it['id'],source=it['model'],sha256=it['sha256'],constructionPositionBlenderM=list(position),rotationZRadians=angle,matrixFromAssetBlender=[list(row)for row in transform]));return obs[0]

def ctxbox(name,c,s):
    ob=box(name,c,s,'context',.0);ob['proofContextOnly']=True;CONTEXT.append(ob);return ob

def floor_ring(xmin,xmax,ymin,ymax,void):
    vx0,vx1,vy0,vy1=void
    for nm,c,s in [
        ('Upper floor west',((xmin+vx0)/2,(ymin+ymax)/2,2.88),(vx0-xmin,ymax-ymin,.24)),
        ('Upper floor east',((vx1+xmax)/2,(ymin+ymax)/2,2.88),(xmax-vx1,ymax-ymin,.24)),
        ('Upper floor low end',((vx0+vx1)/2,(ymin+vy0)/2,2.88),(vx1-vx0,vy0-ymin,.24)),
        ('Upper floor high end',((vx0+vx1)/2,(vy1+ymax)/2,2.88),(vx1-vx0,ymax-vy1,.24))]:
        if min(s)>0:ctxbox(nm,c,s)
    for x in (xmin+.15,xmax-.15):
        for y in (ymin+.15,ymax-.15):ctxbox('Visible upper-floor support column',(x,y,1.38),(.20,.20,2.76))
    ctxbox('Visible ground bearing slab',((xmin+xmax)/2,(ymin+ymax)/2,-.06),(xmax-xmin,ymax-ymin,.12))

def receiving_ledge(end,angle):
    # Local 60 mm stair tongue ends at a visible slab face. Steel shoes bear on this exposed ledge.
    rot=Matrix.Rotation(angle,4,'Z');p=Vector(end)
    result=[]
    for x in (-.54,.54):
        ob=box('Visible upper-floor stair bearing ledge',(x,.0275,2.80),(.12,.065,.02),'iron',0)
        # end z is 0: floor upper datum remains 3000 mm for all arrangements.
        ob.matrix_world=Matrix.Translation(p)@rot@ob.matrix_world;CONTEXT.append(ob);ob['proofContextOnly']=True;result.append(ob)
    return result

def bvh(ob):
    vs=[ob.matrix_world@v.co for v in ob.data.vertices];return BVHTree.FromPolygons(vs,[tuple(p.vertices)for p in ob.data.polygons])

def ray_check(name,ob,origin,direction,expected=None,tol=.001):
    hit,normal,index,dist=bvh(ob).ray_cast(Vector(origin),Vector(direction),100)
    result=dict(name=name,target=ob.name,originM=list(origin),direction=list(direction),hitM=list(hit)if hit is not None else None,distanceM=dist)
    if expected is not None:result['expectedM']=list(expected);result['errorM']=(hit-Vector(expected)).length if hit is not None else None;result['pass']=hit is not None and result['errorM']<tol
    PROBES.append(result);return result

def contact_z(name,upper,lower,point,tol=.001):
    x,y,z=point
    a=ray_check(name+' upper underside',upper,(x,y,z-.003),(0,0,1))
    b=ray_check(name+' lower topside',lower,(x,y,z+.003),(0,0,-1))
    gap=(a['hitM'][2]-b['hitM'][2])if a['hitM']and b['hitM']else None
    return dict(name=name,upper=upper.name,lower=lower.name,pointM=list(point),upperHit=a['hitM'],lowerHit=b['hitM'],gapM=gap,**{'pass':gap is not None and abs(gap)<tol})

def path_samples(flight,position,angle,n=9):
    rr=Matrix.Rotation(angle,4,'Z');pos=Vector(position);out=[]
    for i in range(n-1):
        for frac in (.10,.50,.90):
            p=pos+rr@Vector((0,(i+frac)*forms.G,(i+1)*forms.R));out.append(p)
            ray_check('Walking tread %d %.1f'%(i+1,frac),flight,p+Vector((0,0,.07)),(0,0,-1),p)
    return out

def build(layout):
    bpy.ops.wm.read_factory_settings(use_empty=True);reset();PLACED.clear();CONTEXT.clear();PROBES.clear();contacts=[];paths=[];L=8*forms.G
    lower=place('flight-nine-riser','Lower flight')
    lgr=place('guard-nine-riser','Lower right guard');lgl=place('guard-nine-riser','Lower left guard',(-1.08,0,0))
    paths+=path_samples(lower,(0,0,0),0)
    if layout=='straight':
        land=place('square-supported-landing','Grounded intermediate landing',(0,L+.06,0));start=(0,L+.06+1.16,1.5);ang=0;end=(0,2*L+.06+1.16,0);void=(-.72,.72,.56,end[1]+.06)
        for x in (-.54,.54):place('landing-guard-straight','Intermediate side guard', (x,L+.06,1.5))
        floor_ring(-1.70,1.70,-.50,end[1]+1.25,void)
    elif layout=='quarter':
        land=place('square-supported-landing','Grounded quarter-turn landing',(0,L+.06,0));start=(.58,L+.06+.58,1.5);ang=-math.pi/2;end=(.58+L,L+.06+.58,0);void=(-.72,end[0]+.06,.56,L+1.32)
        place('landing-guard-corner','Quarter-turn outer guard',(0,L+.06,1.5))
        # Rectangular opening intentionally generous, visibly bounded by real floor blocks.
        floor_ring(-1.70,end[0]+1.20,-.50,L+2.25,void)
    else:
        land=place('return-supported-landing','Grounded return landing',(.62,L+.06,0));start=(1.24,L+.06,1.5);ang=math.pi;end=(1.24,.06,0);void=(-.72,1.96,0,L+1.38)
        place('landing-guard-return','Return outer guard',(.62,L+.06,1.5))
        floor_ring(-1.70,2.95,-1.30,L+2.25,void)
    upper=place('flight-nine-riser','Upper flight',start,ang)
    rr=Matrix.Rotation(ang,4,'Z');place('guard-nine-riser','Upper right guard',start,ang);place('guard-nine-riser','Upper left guard',Vector(start)+rr@Vector((-1.08,0,0)),ang)
    paths+=path_samples(upper,start,ang);ledges=receiving_ledge(end,ang)
    # Probe actual imported triangle surfaces for head shoes / receiving ledges.
    for x in (-.54,.54):contacts.append(contact_z('Lower flight head shoe %.2f'%x,lower,land,(x,L+.035,1.31)))
    for x in (-.54,.54):
        point=Vector(start)+rr@Vector((x,-.03,0))
        contacts.append(contact_z('Upper foot bearing %.2f'%x,upper,land,point))
    for side,x in [('right',.54),('left',-.54)]:
        guard=lgr if side=='right'else lgl
        for i in (0,3,7):contacts.append(contact_z('Lower guard shoe %s tread%d'%(side,i+1),guard,lower,(x,i*forms.G+.10,(i+1)*forms.R)))
    # Explicit load-path geometry interfaces; independent QA measures clipped contact area.
    supports=[]
    def si(label,part,host,point,normal=(0,0,1),minimum=.0005):
        supports.append(dict(label=label,part=part,host=host,pointWorldBlenderM=list(point),normalWorldBlender=list(normal),minimumPositiveAreaM2=minimum,planeToleranceM=.0001,claim='Geometric support only; no structural capacity claim'))
    for ob,pos,angle,host in [(lower,(0,0,0),0,land.name),(upper,start,ang,'Visible upper-floor stair bearing ledge')]:
        rot=Matrix.Rotation(angle,4,'Z');pos=Vector(pos)
        for j,x in enumerate((-.54,.54)):
            suffix=''if j==0 else'.001';side='Left'if j==0 else'Right'
            footY=.21 if ob==lower else-.03;footHost='Visible ground bearing slab'if ob==lower else land.name
            si(ob.name+' foot to host',ob.name+' / Foot bearing plate'+suffix,footHost,pos+rot@Vector((x,footY,0)),minimum=.003)
            si(ob.name+' foot to stringer',ob.name+' / '+side+' continuous housed stringer',ob.name+' / Foot bearing plate'+suffix,pos+rot@Vector((x,.24,.008)),minimum=.025)
            si(ob.name+' head shoe to host',ob.name+' / Head bearing plate'+suffix,host+(' / Header receiver ledge'if ob==lower else suffix),pos+rot@Vector((x,L+.035,1.31)),minimum=.003)
            si(ob.name+' notch to head shoe',ob.name+' / '+side+' continuous housed stringer',ob.name+' / Head bearing plate'+suffix,pos+rot@Vector((x,L+.035,1.32)),minimum=.0028)
    width=2.4 if layout=='return'else 1.16;cx=.62 if layout=='return'else 0
    index=0
    for xx in (-width/2+.09,width/2-.09):
        for yy in (.09,1.07):
            suffix=''if index==0 else'.%03d'%index;point=Vector((cx+xx,L+.06+yy,0));index+=1
            for label,part,host,z,minarea in [('plinth to ground','Leg plinth shoe','Visible ground bearing slab',0,.015),('leg to plinth','Grounded square timber leg','Leg plinth shoe',.08,.010),('cap to leg','Leg cap block','Grounded square timber leg',1.23,.010),('frame to cap','Landing frame union','Leg cap block',1.29,.005)]:
                point.z=z;si(land.name+' '+label,land.name+' / '+part+(suffix if part!='Landing frame union'else''),host if host=='Visible ground bearing slab'else land.name+' / '+host+suffix,point,minimum=minarea)
    if layout=='return':
        for j,yy in enumerate((.09,1.07)):
            suffix=''if j==0 else'.001'
            si('Return center post to ground',land.name+' / Wide span center ground leg'+suffix,'Visible ground bearing slab',(.62,L+.06+yy,0),minimum=.008)
            si('Return center post to header',land.name+' / Landing transverse header'+suffix,land.name+' / Wide span center ground leg'+suffix,(.62,L+.06+yy,1.29),minimum=.007)
    # Actual overhead ray intersections, excluding own treads, ground and guards.
    ceilings=[ob for ob in CONTEXT if ob.name.startswith('Upper floor')];head=[]
    for p in paths:
        hits=[]
        for ob in ceilings:
            hit,normal,ind,dist=bvh(ob).ray_cast(p+Vector((0,0,.002)),Vector((0,0,1)),10)
            if hit is not None:hits.append((dist+.002,ob.name))
        minimum=min(hits)if hits else None;head.append(dict(walkingPointM=list(p),overhead=minimum,**{'pass':minimum is None or minimum[0]>=2.1}))
    report=dict(openingEdgeGuardStatus='These three route proofs isolate stair and landing joins. Every non-access edge of the visible upper-floor opening still requires separate guard modules. The full-straight-guarded-opening proof demonstrates an actual guarded opening using the delivered kit.',openingEdgesRequiringGuards=[{'fromM':[void[0],void[2],3.],'toM':[void[0],void[3],3.]},{'fromM':[void[1],void[2],3.],'toM':[void[1],void[3],3.]},{'fromM':[void[0],void[2],3.],'toM':[void[1],void[2],3.]},{'fromM':[void[0],void[3],3.],'toM':[void[1],void[3],3.]}],intendedAccessGap={'centerBlenderM':list(Vector(end)+Matrix.Rotation(ang,4,'Z')@Vector((0,.06,3.))),'directionFromFlight':list(Matrix.Rotation(ang,4,'Z')@Vector((0,1,0))),'nominalWidthM':1.16,'excludeOnlyThisGapFromEdgeGuardCoverage':True},layout=layout,stage='producer-candidate-not-independent-acceptance',units='metres',coordinateSystem='Blender Z up; glTF conversion x,z,-y',storeyRiseM=3.0,riserCount=18,riserM=forms.R,goingM=forms.G,nominalClearWidthM=1.0,minimumNewelCapClearWidthM=.96,headClearanceEnvelopeM=2.1,actualOverheadRaycastMinimumM=min([x['overhead'][0]for x in head if x['overhead']]or[None]),visibleFloorOpeningBlenderXYM=list(void),upperFloorTopM=3.,upperFloorUndersideM=2.76,contextExclusion='Visible upper floor ring, its supports, lower slab and head bearing ledges are delivered proof context, not catalogue asset IDs.',placements=PLACED.copy(),supportInterfaces=supports,contacts=contacts,triangleProbes=PROBES.copy(),headClearanceSamples=head,intendedJoinery='60 mm head tongue meets the landing front edge. Head shoes bear on the projecting receiver ledge. Newel feet seat into their own flight tread. Upper floor tongue meets the visible floor face, with head shoes supported by visible metal ledges.',limits='Under-stair passage is not claimed. Manual static RPG assembly; no native floor-cut, stair-port, routing, collision, load or legal/code certification.')
    folder=HERE/'assemblies'/layout;folder.mkdir(exist_ok=True);(folder/'assembly-contract.json').write_text(json.dumps(report,indent=2)+'\n');sanitize('stairs-'+layout);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(folder/'assembled-from-delivered-glbs.blend'),compress=True)
    if '--no-renders'not in sys.argv:
        obs=[ob for ob in bpy.context.scene.objects if ob.type=='MESH']
        for view in ('assembly','top','side'):render(obs,folder/(view+'.png'),view,1024)
    print('ASSEMBLY_READY',layout,'contacts',all(c['pass']for c in contacts),'walking',all(p.get('pass',True)for p in PROBES),'headroom',all(p['pass']for p in head),flush=True)

if __name__=='__main__':
    layouts=sys.argv[sys.argv.index('--layouts')+1].split(',')if '--layouts'in sys.argv else['straight','quarter','return']
    for layout in layouts:build(layout)
