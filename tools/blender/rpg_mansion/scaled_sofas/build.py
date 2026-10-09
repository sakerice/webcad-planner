"""Original native mansion seating: actual ergonomics before envelope dimensions.

Procedural geometry is project-authored, with distinct structures/capacities.
Units: metres. Native +Z up/-Y front; GLB +Y up/+Z front. Static props only.
"""
from pathlib import Path
import sys,math,json,hashlib,struct
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parents[1])]
import bpy,bmesh
from mathutils import Vector
import model_kit as kit
from shape_kit import rounded_rect
from native_utils import positive_winding,metric_uv,export_active,sanitize
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion'
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews';kit.WORK_DIR=HERE/'sources';kit.export=export_active;kit.unwrap=metric_uv
PARTS=[];M={};CURRENT={}

def palette(fabric='#476c58',leather=False):
    global M
    M={}
    for key,name,col,rough,metal,ch in [('wood','Sofa walnut heartwood','#533624',.37,0,'wood'),('trim','Sofa warm carved walnut','#6b472e',.33,0,'wood'),('brass','Sofa aged brass mounts','#9d7b3c',.37,.78,'metal'),('fabric','Sofa '+('oxblood leather' if leather else 'velvet upholstery'),fabric,.43 if leather else .82,0,'fabric'),('seam','Sofa upholstery welt',fabric,.53 if leather else .87,0,'fabric')]:
        m=kit.matp(name,col,rough,metal);m['finishChannel']=ch;m.use_backface_culling=True;M[key]=m
        n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        if key in {'fabric','seam'} and not leather:n.inputs['Sheen Weight'].default_value=.28;n.inputs['Sheen Roughness'].default_value=.7

def keep(ob,role=None):
    PARTS.append(ob);ob['constructionPart']=ob.name
    if role:ob['functionalRole']=role
    return ob

def mesh(name,verts,faces,mat='wood',smooth=True):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();me.materials.append(M[mat])
    for p in me.polygons:p.use_smooth=smooth
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);positive_winding(ob);return keep(ob)

def box(name,center,size,mat='wood',radius=.002):
    ob=kit.box(name,tuple(center[i]-size[i]/2 for i in range(3)),tuple(center[i]+size[i]/2 for i in range(3)),M[mat],radius,1)
    positive_winding(ob);return keep(ob)

def loft(name,rings,mat='wood',smooth=True):
    n=len(rings[0]);verts=[tuple(v)for ring in rings for v in ring]
    faces=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(len(rings)-1)for i in range(n)]+[tuple(range((len(rings)-1)*n,len(rings)*n))]
    ob=mesh(name,verts,faces,mat,smooth)
    ob.data.polygons[0].use_smooth=ob.data.polygons[-1].use_smooth=False
    return ob

def cushion(name,cx,cy,w,d,z0=.355,z1=.460):
    r=min(.07,w*.14,d*.14)
    rings=[rounded_rect(cx,cy,ww,dd,rr,z,n=3)for ww,dd,rr,z in [(w-.024,d-.024,r-.012,z0),(w,d,r,z0+.020),(w,d,r,z1-.024),(w-.024,d-.024,r-.012,z1)]]
    ob=loft(name,rings,'fabric');ob['functionalRole']='seat-cushion';ob['seatTopMm']=460
    path=[tuple(p)for p in rounded_rect(cx,cy,w-.002,d-.002,r-.001,z1-.026,n=3)]
    sweep(name+' attached sewn piping',path,.003,'seam',4,closed=True)
    return ob

def sweep(name,path,r,mat='wood',sides=6,closed=False,scale=(1,1),smooth=True):
    path=[Vector(p)for p in path];rings=[]
    tangents=[((path[(i+1)%len(path)]-path[(i-1)%len(path)]) if closed else (path[min(i+1,len(path)-1)]-path[max(0,i-1)])).normalized() for i in range(len(path))]
    # One least-aligned axis per path keeps planar rings coherent. Choosing
    # a different seed at each corner twists narrow sewn welts inside-out.
    seed=min([Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))],key=lambda axis:max(abs(t.dot(axis))for t in tangents))
    for i,p in enumerate(path):
        if closed:tangent=(path[(i+1)%len(path)]-path[(i-1)%len(path)]).normalized()
        else:tangent=(path[min(i+1,len(path)-1)]-path[max(0,i-1)]).normalized()
        u=tangent.cross(seed).normalized();v=tangent.cross(u).normalized()
        rr=r[i]if isinstance(r,list)else r
        rings.append([p+u*(rr*scale[0]*math.cos(math.tau*j/sides))+v*(rr*scale[1]*math.sin(math.tau*j/sides))for j in range(sides)])
    if not closed:return loft(name,rings,mat)
    verts=[tuple(v)for ring in rings for v in ring];n=sides
    faces=[(i*n+j,i*n+(j+1)%n,((i+1)%len(rings))*n+(j+1)%n,((i+1)%len(rings))*n+j)for i in range(len(rings))for j in range(n)]
    return mesh(name,verts,faces,mat,smooth=smooth)

def lathe(name,x,y,rows,mat='wood',n=10):
    return loft(name,[[(x+r*math.cos(math.tau*i/n),y+r*math.sin(math.tau*i/n),z)for i in range(n)]for r,z in rows],mat)

def legs(w,d,height=.335,bun=False):
    for sx in [-1,1]:
        for sy in [-1,1]:
            x=sx*(w/2-.12);y=sy*(d/2-.115)
            rows=[(.047,0),(.066,.026),(.070,.065),(.043,height-.012),(.044,height)]if bun else[(.027,0),(.031,.018),(.023,.055),(.018,height*.57),(.030,height*.83),(.034,height)]
            lathe(('Bun'if bun else'Turned')+' load-bearing foot %d %d'%(sx,sy),x,y,rows,'wood')
            if not bun:lathe('Attached brass foot shoe %d %d'%(sx,sy),x,y,[(.027,0),(.028,.005),(.028,.023),(.025,.028)],'brass',8)

def seat_frame(w,d,z0=.315,z1=.355,mat='wood'):
    # Broad support board, front/rear aprons and two under-seat cross braces.
    rings=[rounded_rect(0,0,w-.014,d-.014,.035,z0,n=2),rounded_rect(0,0,w,d,.042,z0+.004,n=2),rounded_rect(0,0,w,d,.042,z1-.004,n=2),rounded_rect(0,0,w-.014,d-.014,.035,z1,n=2)]
    loft('Continuous supported seat platform',rings,mat)
    for yy in [-d/2+.025,d/2-.025]:box('Apron structural rail',(0,yy,z0-.028),(w-.09,.048,.058),'trim',.005)
    for x in [-w*.24,w*.24]:box('Under-seat transverse bearer',(x,0,z0-.021),(.044,d-.04,.045),mat)

def extrusion(name,outline,y0,y1,mat='fabric',smooth=False):
    n=len(outline);v=[(x,y,z)for y in [y0,y1]for x,z in outline];f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
    return mesh(name,v,f,mat,smooth)

def camelback():
    w,d=1.55,.80;legs(w,d);seat_frame(w,d)
    for x in [-.333,.333]:cushion('Two-seat velvet cushion %.3f'%x,x,-.079,.643,.568)
    # Open walnut side frames: swept arm rails, continuous front uprights.
    for sign in [-1,1]:
        x=sign*.724
        sweep('Camelback curved open arm '+str(sign),[(x,-.305,.625),(x,-.245,.668),(x,-.08,.683),(x,.08,.744),(x,.255,.844)],.025,'trim',8)
        sweep('Camelback shaped arm front support '+str(sign),[(sign*.680,-.291,.33),(sign*.716,-.289,.458),(x,-.305,.625)],.021,'wood',6)
        sweep('Camelback rear post '+str(sign),[(sign*.675,.285,.332),(sign*.711,.286,.58),(sign*.724,.286,.870)],.026,'wood',6)
    # Crown is a two-lobed, swept camel outline rather than the baseline sofa's broad one-arch panel.
    top=[(-.70+1.4*i/16,.286,.900+.127*math.sin(math.pi*i/16)**2-.034*math.sin(2*math.pi*i/16)**2)for i in range(17)]
    # Central ring apex + radius gives exactly 1.05 m overall.
    top[8]=(0,.286,1.027)
    sweep('Double-curved camelback crown',top,.023,'trim',8)
    for sign in [-1,1]:sweep('Camelback back stile '+str(sign),[(sign*.70,.286,.413),(sign*.70,.286,.90)],.023,'trim',6)
    sweep('Camelback lower back rail',[(-.70,.286,.447),(0,.286,.463),(.70,.286,.447)],.026,'wood',6)
    inner=[(x,y-.049,z-.037)for x,y,z in top]
    outline=[(-.675,.465),(.675,.465)]+[(x,z)for x,y,z in reversed(inner)]
    extrusion('Camelback fitted velvet back panel',outline,.209,.279,'fabric')
    sweep('Camelback panel attached inset piping',[(x,.206,z)for x,z in outline],.003,'seam',4,True,smooth=False)
    # Centre crest is an attached carved walnut leaf, tangent to the crown.
    extrusion('Carved centre shell motif',[(-.041,1.015),(-.025,1.040),(0,1.05),(.025,1.04),(.041,1.015),(0,1.023)],.253,.287,'trim')

def tufted_back(name,w,yfront,yrear,z0,z1,cols=16,rows=8):
    verts=[]
    buttons=[(-w/2+w*(i+1)/8,z0+(z1-z0)*(j+1)/4)for j in range(3)for i in range(7)if (i+j)%2==0]
    for k in [0,1]:
        for j in range(rows+1):
            z=z0+(z1-z0)*j/rows
            for i in range(cols+1):
                x=-w/2+w*i/cols;depress=max((.031*math.exp(-((x-bx)/.075)**2-((z-bz)/.043)**2)for bx,bz in buttons),default=0)
                y=yfront+depress if k==0 else yrear
                verts.append((x,y,z))
    n=(cols+1)*(rows+1);faces=[]
    for k in [0,1]:
        off=k*n
        for j in range(rows):
            for i in range(cols):
                a=off+j*(cols+1)+i;faces.append((a,a+1,a+cols+2,a+cols+1)if k==0 else(a,a+cols+1,a+cols+2,a+1))
    rim=list(range(cols+1))+[j*(cols+1)+cols for j in range(1,rows+1)]+[rows*(cols+1)+i for i in range(cols-1,-1,-1)]+[j*(cols+1)for j in range(rows-1,0,-1)]
    for a,b in zip(rim,rim[1:]+rim[:1]):faces.append((a,b,b+n,a+n))
    ob=mesh(name,verts,faces,'fabric')
    for i,(x,z)in enumerate(buttons):
        # Button base intersects the dimple and is backed by the solid upholstery shell.
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=1,location=(x,yfront+.024,z));b=bpy.context.object;b.name='Attached tuft button '+str(i);b.scale=(.010,.008,.010);b.data.materials.append(M['seam']);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);positive_winding(b);keep(b)
    return ob

def chesterfield():
    w,d=2.20,.92;legs(w,d,.15,True)
    # Skirt joins the low bunfeet to the independent 355 mm cushion support.
    loft('Leather upholstered continuous base',[rounded_rect(0,0,w-.10,d-.016,.095,z,n=3)for z in [.137,.17,.322,.355]],'fabric')
    box('Chesterfield hidden load-bearing seat board',(0,-.026,.336),(1.90,.74,.028),'wood')
    for x in [-.564,0,.564]:cushion('Three-seat leather cushion %.3f'%x,x,-.083,.552,.642)
    # Barrel arm lobes: genuinely rolled closed profiles, not box cushions.
    for s in [-1,1]:
        path=[(s*.991,y,z)for y,z in [(-.451,.675),(-.447,.675),(-.435,.675),(-.401,.675),(.02,.691),(.29,.711),(.30,.711)]]
        ob=sweep('Chesterfield rolled upholstered arm '+str(s),path,[.102,.108,.109,.109,.109,.108,.102],'fabric',12,scale=(1,1))
        box('Chesterfield arm internal timber',(s*.956,.009,.407),(.066,.63,.164),'wood')
        loft('Chesterfield continuous leather arm side '+str(s),[rounded_rect(s*.958,-.018,ww,.802,rr,z,n=3)for ww,rr,z in [(.248,.059,.270),(.248,.059,.310),(.218,.052,.605),(.218,.052,.676)]],'fabric')
        # Sewn welt around the exposed barrel end follows the arm's actual cap.
        sweep('Chesterfield arm end sewn ring '+str(s),[(s*.991+.100*math.cos(math.tau*i/16),-.452,.675+.100*math.sin(math.tau*i/16))for i in range(16)],.003,'seam',4,True)
    # Close the rear upholstery below the back. The band is inset from both
    # exposed rear planes and overlaps the supported base/back by 28 mm.
    box('Chesterfield inset upholstered rear closing band',(0,.414,.391),(1.95,.062,.128),'fabric',.005)
    tufted_back('Deep diamond-tufted leather back',1.97,.255,.460,.427,.743)
    sweep('Chesterfield rolled top back',[(-.991,.351,.731),(0,.351,.731),(.991,.351,.731)],.089,'fabric',12)
    # Lower front nailheads visibly mounted into the leather base, no floating studs.
    for i in range(19):
        x=-.90+1.8*i/18
        bpy.ops.mesh.primitive_uv_sphere_add(segments=6,ring_count=4,radius=1,location=(x,-.456,.259));ob=bpy.context.object;ob.name='Mounted brass front nail %02d'%i;ob.scale=(.005,.004,.005);ob.data.materials.append(M['brass']);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);positive_winding(ob);keep(ob)

def oval_ring(name,cx,cy,cz,rx,rz,thick=.035,mat='trim',n=20):
    v=[]
    for y in [cy-.020,cy+.020]:
        for inset in [0,thick]:v.extend((cx+(rx-inset)*math.cos(math.tau*i/n),y,cz+(rz-inset)*math.sin(math.tau*i/n))for i in range(n))
    f=[]
    for i in range(n):
        j=(i+1)%n;f.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
    return mesh(name,v,f,mat)

def salon():
    w,d=1.45,.70;legs(w,d);seat_frame(w,d)
    for x in [-.310,.310]:cushion('Salon split seat cushion %.3f'%x,x,-.066,.590,.520)
    for x in [-.328,.328]:
        oval_ring('Open salon carved oval back frame %.3f'%x,x,.242,.755,.273,.235)
        outline=[(x+.242*math.cos(math.tau*i/20),.755+.204*math.sin(math.tau*i/20))for i in range(20)]
        extrusion('Salon oval padded medallion %.3f'%x,outline,.210,.252,'fabric')
        sweep('Salon medallion sewn inset welt %.3f'%x,[(a,.207,b)for a,b in outline],.003,'seam',4,True)
        # Lower medallion posts join the seat bearer; open reveals are retained.
        for sx in [-1,1]:
            xx=x+sx*.156
            sweep('Salon medallion open carved post',[(xx,.25,.333),(xx,.25,.481),(x+sx*.156,.242,.572)],.014,'wood',6)
    for sign in [-1,1]:
        x=sign*.700
        sweep('Salon scrolling open arm '+str(sign),[(x,-.250,.635),(sign*.689,-.205,.667),(sign*.667,-.035,.657),(sign*.658,.135,.727),(sign*.632,.247,.779)],.025,'trim',8)
        sweep('Salon swept front arm spindle '+str(sign),[(sign*.621,-.251,.330),(sign*.661,-.251,.495),(x,-.250,.635)],.018,'wood',6)
        sweep('Salon back arm connector '+str(sign),[(sign*.632,.247,.779),(sign*.568,.242,.81)],.020,'wood',6)
    # Small waist-shaped centre connector holds both oval frames together.
    sweep('Salon central open connecting ribbon',[(-.102,.242,.790),(0,.242,.830),(.102,.242,.790)],.015,'trim',6)

SPECS=[
 dict(slug='camelback-settee-two',name='二人用・曲線木肘キャメルバックセティ',size=(1550,800,1050),fn=camelback,capacity=2,color='#466e58',style='camelback-open-arm',meaning='Two-person curved walnut open-arm camelback; double-curved crown, exposed turned feet and split velvet seats'),
 dict(slug='chesterfield-three',name='三人用・低背革張りチェスターフィールド',size=(2200,920,820),fn=chesterfield,capacity=3,color='#6f3835',leather=True,style='low-tufted-chesterfield',meaning='Three-person low Chesterfield; rolled arms and rolled back, physically recessed tufting, squat bun feet and separate leather cushions'),
 dict(slug='open-salon-settee',name='二人用・透かし楕円背サロンセティ',size=(1450,700,990),fn=salon,capacity=2,color='#bc9f6c',style='open-double-medallion-salon',meaning='Airy two-person salon settee with two separate upholstered oval back medallions, open carved supports and scrolling arms'),
]

import forms
SPECS+=forms.add_specs(sys.modules[__name__])

def authoring(spec,stem):
    global PARTS
    PARTS=[];palette(spec['color'],spec.get('leather',False));spec['fn']()
    for ob in PARTS:positive_winding(ob);metric_uv(ob)
    sc=bpy.context.scene;sc.name='Native authoring parts';sc['front']='-Y';sc['up']='+Z';sc['units']='metres';sc['designBasis']='Intended mansion seating design; no measured historic source';sc['seatTopMm']=460;sc['seatCount']=spec['capacity']
    sanitize(stem);p=HERE/'authoring_sources'/(stem+'.blend');p.parent.mkdir(exist_ok=True)
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');bpy.context.scene.name='Validated export'
    parts=[o for o in bpy.context.scene.objects if o.type=='MESH'];ob=kit.combine(parts);ob['seatTopMm']=460;ob['seatCount']=spec['capacity'];ob['styleSignature']=spec['style'];ob['staticProp']=True
    sanitize(stem);return ob

def stamp(path,stem):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);assert len(d.get('meshes',[]))==1 and len(d.get('scenes',[]))==1
    d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original project-authored procedural Blender geometry; no imported geometry or images',source='tools/blender/rpg_mansion/scaled_sofas/build.py',staticProp=True)
    payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(ob,path,view):
    bpy.ops.scene.new(type='NEW');scene=bpy.context.scene;scene.name='Temporary product evidence'
    copy=ob.copy();copy.data=ob.data.copy();scene.collection.objects.link(copy);ob=copy
    scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world;scene.view_settings.view_transform='AgX'
    pts=[ob.matrix_world@v.co for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for name,power,loc,size in [('Key',350,(span*2,-span*3,span*3),span*3),('Fill',150,(-span*2,-span,span*1.5),span*2),('Rim',90,(span,span*2,span*2.4),span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    if view=='top':loc=(0,0,span*4);scale=max((hi-lo)[:2])*1.15
    elif view=='front':loc=(0,-span*4,target.z);scale=max(hi.x-lo.x,hi.z-lo.z)*1.15
    elif view=='rear':loc=(-span*2.5,span*4,span*1.8);scale=span*1.32
    else:loc=(span*2.5,-span*4,span*1.8);scale=span*1.32
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
    # Fit actual projected vertices, including asymmetric/L-shaped forms,
    # instead of assuming an axis-aligned envelope fits an oblique camera.
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0))
    projected=[(p.dot(right),p.dot(up))for p in pts]
    lows=[min(p[i]for p in projected)for i in range(2)];highs=[max(p[i]for p in projected)for i in range(2)]
    centre=[(lows[i]+highs[i])/2 for i in range(2)]
    cam.location+=right*(centre[0]-target.dot(right))+up*(centre[1]-target.dot(up))
    cam.data.ortho_scale=max(highs[i]-lows[i]for i in range(2))/(1-48/512)
    path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path)
    bpy.data.scenes.remove(scene)

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    file=HERE/'descriptors.json';items=json.loads(file.read_text())['items']if file.exists()else[]
    for spec in SPECS:
        if only and spec['slug']not in only:continue
        bpy.ops.wm.read_factory_settings(use_empty=True);stem='rpg-mansion-'+spec['slug']+'-01'
        ob=kit.run([(stem,spec['size'],lambda:authoring(spec,stem),{'wood','metal','fabric'},6000)],do_icons=False)[0]
        source=kit.WORK_DIR/(stem+'.blend');bpy.context.preferences.filepaths.save_version=0;sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
        path=kit.GLB_DIR/(stem+'.glb');export_active(ob,path);stamp(path,stem)
        validation=kit.WORK_DIR/(stem+'-validation.json');report=json.loads(validation.read_text());report.update(triangle_budget=4200 if spec['slug']=='chesterfield-three' else 4000,glb_bytes=path.stat().st_size,seatTopMm=460,seatCount=spec['capacity'],closedComponentSignedVolumesM3=positive_winding(ob,repair=False),source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),glb_sha256=hashlib.sha256(path.read_bytes()).hexdigest());validation.write_text(json.dumps(report,indent=2)+'\n')
        rel=lambda p:str(p.relative_to(ROOT))
        it=dict(id=stem,name=spec['name'],kind='sofa',group='家具',category='ソファ',packId='rpg-mansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),front=rel(HERE/'evidence'/(stem+'-front.png')),rear=rel(HERE/'evidence'/(stem+'-rear.png')),sourceBlend=rel(source),authoringBlend=rel(HERE/'authoring_sources'/(stem+'.blend')),validation=rel(validation),builder=rel(HERE/'build.py'),w=spec['size'][0],d=spec['size'][1],h=spec['size'][2],seatHeightMm=460,seatingCapacity=spec['capacity'],seatCushionCount=spec.get('cushions',spec['capacity']),variantOf=('rpg-mansion-'+spec['variantOf']+'-01')if spec.get('variantOf')else None,geometrySignature=spec['style'],triangleBudget=4200 if spec['slug']=='chesterfield-three' else 4000,defaultElevation=0,provenance='original',staticProp=True,placementHint='floor',semanticCoverage=spec['meaning'],dimensionBasis='Original intended footprint; declared source demands do not imply absent legacy geometry was measured',finishChannels=[dict(key=c,label={'wood':'木部','metal':'金属','fabric':'張地'}[c],default={'wood':'#533624','metal':'#9d7b3c','fabric':spec['color']}[c])for c in ['wood','metal','fabric']])
        it['sha256']=hashlib.sha256(path.read_bytes()).hexdigest();it['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest();it['authoringSha256']=hashlib.sha256((ROOT/it['authoringBlend']).read_bytes()).hexdigest()
        items=[i for i in items if i['id']!=stem]+[it];file.write_text(json.dumps(dict(set='rpg-mansion',name='洋館・ソファ試作',items=items),ensure_ascii=False,indent=2)+'\n')
        if '--no-icons'not in sys.argv:
            for view in ['thumb','top','front','rear']:
                out=ROOT/it[view];render(ob,out,view)
        print('SOFA_READY',stem,report['triangles'],report['glb_bytes'],flush=True)
    (HERE/'rights-and-provenance.json').write_text(json.dumps(dict(authoring='Original project-authored native Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Original project-authored assets for this repository; no separate public reuse license granted',measurementPolicy='Intended design dimensions; source demand matches are metadata only unless actual legacy geometry exists and is measured',source='build.py',sourceSha256=hashlib.sha256((HERE/'build.py').read_bytes()).hexdigest(),assets=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in items]),indent=2)+'\n')
if __name__=='__main__':main()
