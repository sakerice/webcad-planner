"""Original water-room native construction; no imported geometry or images."""
from pathlib import Path
import sys, math, json, hashlib, struct
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parents[1])]
import bpy,bmesh
from mathutils import Vector
import model_kit as kit
from shape_kit import rounded_rect
from native_utils import positive_winding,metric_uv,export_active,sanitize
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion'
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews';kit.WORK_DIR=HERE/'sources';kit.export=export_active;kit.unwrap=metric_uv
PARTS=[];M={};DATUM={}

def palette():
    global M
    M={}
    for key,label,col,rough,metal,ch in [('ceramic','Ivory fired porcelain','#eee9dc',.23,0,'ceramic'),('metal','Aged polished brass','#ad8745',.28,.8,'metal'),('iron','Bronzed cast iron brackets','#494c41',.40,.72,'metal'),('wood','Dark walnut WC seat','#533728',.33,0,'wood')]:
        m=kit.matp(label,col,rough,metal);m['finishChannel']=ch;m.use_backface_culling=True;M[key]=m

def keep(ob,role=None):
    PARTS.append(ob);ob['constructionPart']=ob.name
    if role:ob['functionalRole']=role
    return ob

def mesh(name,verts,faces,mat='ceramic',smooth=True):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();me.materials.append(M[mat])
    for p in me.polygons:p.use_smooth=smooth
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);positive_winding(ob);return keep(ob)

def box(name,center,size,mat='metal',radius=.002):
    ob=kit.box(name,tuple(center[i]-size[i]/2 for i in range(3)),tuple(center[i]+size[i]/2 for i in range(3)),M[mat],radius,1)
    positive_winding(ob);return keep(ob)

def loft(name,rings,mat='ceramic',smooth=True,caps=True):
    n=len(rings[0]);verts=[tuple(v)for ring in rings for v in ring]
    faces=[tuple(reversed(range(n)))] if caps else []
    faces += [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(len(rings)-1)for i in range(n)]
    if caps:faces.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    else:faces += [((len(rings)-1)*n+i,(len(rings)-1)*n+(i+1)%n,(i+1)%n,i)for i in range(n)]
    ob=mesh(name,verts,faces,mat,smooth)
    if caps:ob.data.polygons[0].use_smooth=ob.data.polygons[-1].use_smooth=False
    return ob

def ellipse(w,d,z,cx=0,cy=0,n=48):
    return [(cx+w/2*math.cos(math.tau*i/n),cy+d/2*math.sin(math.tau*i/n),z(math.tau*i/n)if callable(z)else z)for i in range(n)]

def sweep(name,path,r,mat='metal',sides=10,closed=False,smooth=True):
    path=[Vector(p)for p in path]
    tangents=[((path[(i+1)%len(path)]-path[(i-1)%len(path)])if closed else(path[min(i+1,len(path)-1)]-path[max(i-1,0)])).normalized()for i in range(len(path))]
    seed=min([Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))],key=lambda a:max(abs(t.dot(a))for t in tangents))
    rings=[]
    for p,t in zip(path,tangents):
        u=t.cross(seed).normalized();v=t.cross(u).normalized()
        rings.append([p+r*(u*math.cos(math.tau*j/sides)+v*math.sin(math.tau*j/sides))for j in range(sides)])
    return loft(name,rings,mat,smooth,caps=not closed)

def lathe(name,x,y,rows,mat='metal',n=16):
    return loft(name,[ellipse(2*r,2*r,z,x,y,n)for r,z in rows],mat)

def fixings(name,x,y,z):
    # Recessed fastener heads visibly enter plate front, never cover a coplanar face.
    return sweep(name,[(x,y+.003,z),(x,y-.006,z)],.007,'metal',8)

def drain(name,x,y,z,r=.022):
    lathe(name,x,y,[(r*.90,z-.003),(r,z),(r*.90,z+.003)],'metal',16)

def slipper():
    rim=lambda a:.62+.24*((1-math.cos(a))/2)**3
    rings=[ellipse(1.22,.46,.172),ellipse(1.42,.58,.25),ellipse(1.65,.745,lambda a:rim(a)-.12),ellipse(1.764,.804,lambda a:rim(a)-.020),ellipse(1.78,.82,rim),ellipse(1.75,.79,lambda a:rim(a)+.002),ellipse(1.65,.69,lambda a:rim(a)-.006),ellipse(1.60,.64,lambda a:rim(a)-.045),ellipse(1.28,.43,.25),ellipse(1.22,.39,.225)]
    ob=loft('Slipper bath continuous porcelain shell with hollow bathing cavity',rings)
    ob['functionalRole']='hollow-bath';ob['clearRimLengthMm']=1650;ob['clearRimWidthMm']=690;ob['internalFloorHeightMm']=225
    for sx in [-1,1]:
        for sy in [-1,1]:
            x=sx*.53;y=sy*.18
            rings=[ellipse(.115,.09,0,x+sx*.018,y+sy*.017,12),ellipse(.13,.10,.025,x+sx*.025,y+sy*.016,12),ellipse(.075,.070,.085,x,y,12),ellipse(.082,.084,.145,x-sx*.012,y-sy*.008,12),ellipse(.14,.14,.205,x-sx*.025,y-sy*.018,12)]
            foot=loft('Load-bearing cast slipper foot %d %d'%(sx,sy),rings,'iron');foot['functionalRole']='floor-support'
            # Carved ridge is a continuous casting detail crossing into the foot.
            sweep('Foot cast scroll ridge %d %d'%(sx,sy),[(x+sx*.04,y+sy*.02,.026),(x+sx*.020,y+sy*.04,.07),(x-sx*.01,y+sy*.04,.13),(x-sx*.04,y+sy*.02,.19)],.007,'metal',6)
    drain('Bath inset drain plug',.44,0,.226,.026)
    # Overflow is mounted on sloped inner end, not floating at the opening.
    sweep('Bath high-end overflow boss',[(-.687,0,.405),(-.674,0,.401)],.025,'metal',16)
    DATUM.update(rimHeightMm={'lowEndCrest':622,'highEndCrest':862},internalFloorHeightMm=225,clearBowlMm={'rimLength':1650,'rimWidth':690,'floorLength':1220,'floorWidth':390,'lowEndDepthToRimCrest':397,'innerOpeningLowHeight':614,'innerOpeningHighHeight':854},faucetHeightMm=None,fixtureNote='No faucet included. Supply is a separate fixture.',capacityNote='One bathing occupant; volume and safety are not certified.',installation={'mount':'floor','floorPlaneY':0})

def wall_basin():
    rings=[ellipse(.44,.31,.170,cy=-.045,n=40),ellipse(.56,.40,.215,cy=-.025,n=40),ellipse(.66,.50,.305,n=40),ellipse(.68,.52,.325,n=40),ellipse(.668,.51,.340,n=40),ellipse(.54,.35,.340,cy=-.055,n=40),ellipse(.51,.325,.314,cy=-.055,n=40),ellipse(.32,.16,.205,cy=-.055,n=40),ellipse(.29,.135,.200,cy=-.055,n=40)]
    ob=loft('Wall basin continuous shell with broad rear tap deck',rings);ob['functionalRole']='hollow-basin'
    for sx in [-1,1]:
        x=sx*.185
        p=box('Wall bearing plate '+str(sx),(x,.275,.145),(.050,.020,.290),'iron',.002);p['functionalRole']='wall-anchor';p['wallContactPlaneY']=.285
        box('Bracket top horizontal bearing '+str(sx),(x,.060,.168),(.030,.43,.030),'iron',.004)
        sweep('Triangulated lower wall brace '+str(sx),[(x,.268,.045),(x,.19,.06),(x,-.12,.157)],.014,'iron',8)
        for z in [.038,.255]:fixings('Wall anchor screw %d %.2f'%(sx,z),x,.265,z)
    # Static drain and exposed P-trap are attached to bowl and a wall escutcheon.
    drain('Basin inset slotted drain cover',0,-.055,.201,.022)
    sweep('Basin attached waste tail and P-trap',[(0,-.055,.192),(0,-.055,.077),(0,-.041,.047),(0,.006,.040),(0,.055,.052),(0,.075,.083),(0,.10,.092),(0,.276,.092)],.018,'metal',10)
    sweep('Trap wall escutcheon',[(0,.266,.092),(0,.285,.092)],.039,'metal',16)
    # Two tap valves are set on the solid back deck, joined by one mixer.
    for x in [-.095,.095]:
        lathe('Tap deck foot '+str(x),x,.176,[(.026,.333),(.025,.350),(.014,.370),(.014,.40)],'metal',12)
        sweep('Tap cross handle '+str(x),[(x-.026,.176,.4),(x+.026,.176,.4)],.006,'metal',8)
        sweep('Tap cross spindle '+str(x),[(x,.151,.4),(x,.201,.4)],.006,'metal',8)
    sweep('Deck mixer bridge',[(-.095,.176,.367),(.095,.176,.367)],.011,'metal',10)
    sweep('Swept basin spout',[(0,.176,.341),(0,.176,.482),(0,.164,.526),(0,.132,.547),(0,.091,.548),(0,.043,.524),(0,-.005,.501)],.016,'metal',12)
    DATUM.update(rimHeightMm=870,clearBowlMm={'rimLength':540,'rimWidth':350,'floorLength':290,'floorWidth':135,'depth':140},faucetHeightMm=1093.5,defaultElevationMm=530,capacityNote='Single hand basin.',installation={'mount':'wall-brackets','wallContactPlaneBlenderY':.285,'defaultElevationMm':530,'bearingPlateCentersX':[-.185,.185],'anchorCentersLocalZ':[.038,.255],'topBearingZ':.183,'note':'Two physical wall plates and triangulated brackets carry the shell; P-trap is not structural support.'})

def wc():
    # One continuous stepped pedestal/bowl shell. Cavity closes below water-line.
    profile=[(.29,.40,0,-.075),(.31,.42,.025,-.075),(.23,.33,.095,-.075),(.15,.24,.205,-.055),(.27,.38,.29,-.07),(.36,.50,.377,-.07),(.38,.54,.406,-.07),(.37,.53,.42,-.07),(.278,.402,.42,-.07),(.260,.38,.387,-.07),(.17,.205,.29,-.075),(.145,.18,.27,-.075)]
    ob=loft('WC integrated porcelain foot and actually hollow bowl',[ellipse(w,d,z,cy=y,n=40)for w,d,z,y in profile]);ob['functionalRole']='hollow-wc-bowl'
    seat=loft('Open walnut WC seat annulus',[ellipse(.394,.554,.428,cy=-.07,n=40),ellipse(.40,.56,.438,cy=-.07,n=40),ellipse(.394,.554,.46,cy=-.07,n=40),ellipse(.277,.40,.46,cy=-.07,n=40),ellipse(.270,.393,.439,cy=-.07,n=40),ellipse(.278,.401,.428,cy=-.07,n=40)],'wood',True,False);seat['functionalRole']='seat-ring';seat['seatTopMm']=460
    for x in [-.135,.135]:
        box('Seat load pad '+str(x),(x,-.06,.425),(.025,.056,.013),'wood',.001)
        box('Seat rear hinge foot '+str(x),(x,.171,.434),(.044,.048,.031),'metal',.003)
        sweep('Seat hinge barrel '+str(x),[(x-.026,.183,.465),(x+.026,.183,.465)],.013,'metal',10)
    # Upright closed lid is a separate editable plate, hinged to rear of seat.
    outline=[(.195*math.cos(math.tau*i/40),.669+.215*math.sin(math.tau*i/40))for i in range(40)]
    verts=[(x,y,z)for y in [.185,.211]for x,z in outline]
    faces=[tuple(reversed(range(40))),tuple(range(40,80))]+[(i,(i+1)%40,(i+1)%40+40,i+40)for i in range(40)]
    mesh('Raised walnut WC lid',verts,faces,'wood',False)
    for x in [-.135,.135]:box('Raised lid hinge leaf '+str(x),(x,.198,.485),(.029,.019,.048),'metal',.002)
    # Tall tank has real open-box wall thickness underneath a stepped lid.
    rings=[rounded_rect(0,.30,.57,.24,.032,1.735,n=3),rounded_rect(0,.30,.58,.25,.035,1.76,n=3),rounded_rect(0,.30,.58,.25,.035,2.09,n=3),rounded_rect(0,.30,.536,.206,.027,2.09,n=3),rounded_rect(0,.30,.536,.206,.027,1.765,n=3)]
    loft('High porcelain cistern closed hollow tank body',rings)
    loft('Cistern removable stepped lid',[rounded_rect(0,.30,w,d,r,z,n=3)for w,d,r,z in [(.533,.203,.026,2.077),(.533,.203,.026,2.085),(.608,.278,.040,2.088),(.616,.286,.042,2.116),(.602,.272,.036,2.13)]])
    for sx in [-1,1]:
        x=sx*.20
        p=box('High tank wall bearing plate '+str(sx),(x,.438,1.80),(.055,.024,.38),'iron',.002);p['functionalRole']='wall-anchor';p['wallContactPlaneY']=.45
        box('High tank horizontal load-bearing arm '+str(sx),(x,.320,1.733),(.037,.25,.036),'iron',.003)
        sweep('High tank triangulated bracket '+str(sx),[(x,.430,1.63),(x,.395,1.65),(x,.210,1.732)],.015,'iron',8)
        for z in [1.65,1.95]:fixings('High tank anchor screw %d %.2f'%(sx,z),x,.426,z)
    sweep('Static high cistern flush downpipe',[(0,.3,1.755),(0,.30,.565),(0,.287,.525),(0,.22,.480),(0,.16,.417)],.022,'metal',12)
    for z in [1.70,.605]:lathe('Flush pipe union collar '+str(z),0,.30,[(.03,z-.017),(.033,z-.01),(.033,z+.01),(.03,z+.017)],'metal',12)
    # Wall saddles retain the pipe but do not carry the tank.
    for z in [.82,1.38]:
        sweep('Downpipe wall saddle stand-off '+str(z),[(0,.302,z),(0,.445,z)],.012,'metal',10)
        sweep('Downpipe saddle wall disc '+str(z),[(0,.429,z),(0,.45,z)],.03,'metal',12)
    sweep('Cistern pull lever',[(.275,.30,2.025),(.352,.30,2.025),(.375,.275,1.998)],.011,'metal',10)
    for i in range(22):
        z=1.984-i*.038
        path=[(.375+.010*math.cos(math.tau*j/12),.275,z+.022*math.sin(math.tau*j/12))if i%2==0 else(.375,.275+.010*math.cos(math.tau*j/12),z+.022*math.sin(math.tau*j/12))for j in range(12)]
        sweep('Interlinked pull chain link %02d'%i,path,.0035,'metal',4,True)
    z=1.984-21*.038-.040
    lathe('Porcelain pull handle',.375,.275,[(.010,z+.026),(.018,z+.010),(.021,z-.025),(.011,z-.056)],'ceramic',12)
    DATUM.update(seatHeightMm=460,bowlRimHeightMm=420,clearBowlMm={'rimLength':402,'rimWidth':278,'depth':150},faucetHeightMm=None,cisternBaseHeightMm=1735,cisternTopHeightMm=2130,capacityNote='One WC seat; static non-operational plumbing.',installation={'mount':'mixed-floor-and-wall','floorPlaneY':0,'wallContactPlaneBlenderY':.45,'tankBracketCentersX':[-.2,.2],'tankAnchorCentersZ':[1.65,1.95],'tankBearingHeightMm':1751,'note':'Independent wall plates, bearing arms and triangulated braces support tank; flush pipe is not tank structure.'})

SPECS=[dict(slug='high-backed-slipper-bath',name='高背スリッパ浴槽・中空槽',kind='bathtub',fn=slipper,channels=['ceramic','metal'],size=(1780,820,862),elevation=0,signature='asymmetric-high-backed-hollow-slipper-four-cast-feet',meaning='Asymmetric high-backed freestanding single bath with continuous hollow shell, actual low/high rim and cast feet; supply fixture omitted.'),dict(slug='bracketed-wall-basin',name='三角ブラケット支持・壁掛け洗面器',kind='vanity',fn=wall_basin,channels=['ceramic','metal'],size=(680,545,563.5),elevation=530,signature='wall-bearing-plates-triangulated-brackets-bowl-exposed-trap',meaning='A floor-free wall basin on two real triangular brackets, exposed trap and mixer mounted in broad solid back deck.'),dict(slug='high-cistern-chain-wc',name='高置水槽・引き鎖式便器',kind='toilet',fn=wc,channels=['ceramic','metal','wood'],size=(704,800,2130),elevation=0,signature='high-wall-cistern-independent-brackets-open-seat-chain',meaning='Floor-supported hollow WC with open walnut seat and raised lid; separately bracketed high tank, external flush pipe and visible interlinked pull chain.')]

def authoring(spec,stem):
    global PARTS,DATUM
    PARTS=[];DATUM={};palette();spec['fn']()
    pts=[ob.matrix_world@v.co for ob in PARTS for v in ob.data.vertices]
    lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)])
    offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
    for ob in PARTS:
        for v in ob.data.vertices:v.co+=offset
        positive_winding(ob);metric_uv(ob)
    DATUM['bottomCenterTranslationBlenderM']=list(offset);DATUM['measuredOriginalBoundsM']=[list(lo),list(hi)]
    if 'wallContactPlaneBlenderY'in DATUM.get('installation',{}):DATUM['installation']['wallContactPlaneGltfZ']=-(DATUM['installation']['wallContactPlaneBlenderY']+offset.y)
    sc=bpy.context.scene;sc.name='Native authoring parts';sc['front']='-Y';sc['up']='+Z';sc['units']='metres';sc['designBasis']='Original intended static fixture design, not measured historic reference';sc['installationDatumsJson']=json.dumps(DATUM)
    sanitize(stem);p=HERE/'authoring_sources'/(stem+'.blend');p.parent.mkdir(exist_ok=True);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');bpy.context.scene.name='Validated export'
    ob=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH']);ob['staticProp']=True;ob['constructionRole']=spec['signature'];ob['installationDatumsJson']=json.dumps(DATUM);sanitize(stem);return ob

def stamp(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);assert len(d.get('meshes',[]))==len(d.get('scenes',[]))==1
    d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original project-authored native Blender geometry; no imported geometry or images',source='tools/blender/rpg_mansion/water_rooms/build.py',staticProp=True)
    payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(ob,path,view):
    bpy.ops.scene.new(type='NEW');scene=bpy.context.scene;scene.name='Temporary product evidence'
    copy=ob.copy();copy.data=ob.data.copy();scene.collection.objects.link(copy);ob=copy
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world;scene.view_settings.view_transform='AgX'
    pts=[ob.matrix_world@v.co for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for name,power,loc,size in [('Key',350,(span*2,-span*3,span*3),span*3),('Fill',150,(-span*2,-span,span*1.5),span*2),('Rim',90,(span,span*2,span*2.4),span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    if view=='top':loc=(0,0,span*4)
    elif view=='front':loc=(0,-span*4,target.z)
    elif view=='rear':loc=(-span*2.5,span*4,span*1.8)
    else:loc=(span*2.5,-span*4,span*1.8)
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
    basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));projected=[(p.dot(right),p.dot(up))for p in pts];lows=[min(p[i]for p in projected)for i in range(2)];highs=[max(p[i]for p in projected)for i in range(2)];centre=[(lows[i]+highs[i])/2 for i in range(2)];cam.location+=right*(centre[0]-target.dot(right))+up*(centre[1]-target.dot(up));cam.data.ortho_scale=max(highs[i]-lows[i]for i in range(2))/(1-48/512)
    path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(scene)

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None
    file=HERE/'descriptors.json';items=json.loads(file.read_text())['items']if file.exists()else[]
    for spec in SPECS:
        if only and spec['slug']not in only:continue
        bpy.ops.wm.read_factory_settings(use_empty=True);stem='rpg-mansion-'+spec['slug']+'-01'
        # Measure first prototype envelope without ever rescaling authored geometry.
        ob=authoring(spec,stem);pts=[v.co for v in ob.data.vertices];size=tuple(round((max(p[i]for p in pts)-min(p[i]for p in pts))*1000,3)for i in range(3))
        if spec['size'] is not None:assert max(abs(a-b)for a,b in zip(size,spec['size']))<.5,(stem,size,spec['size'])
        print('AUTHORED_ENVELOPE',stem,size,flush=True)
        # The unchanged kit validates the pre-authored object; its builder clears no data.
        # Run's clear_scene is replaced locally by retaining this canonical scene.
        old=kit.clear_scene;kit.clear_scene=lambda:None
        ob=kit.run([(stem,size,lambda:ob,set(spec['channels']),6000)],do_export=False,do_icons=False)[0];kit.clear_scene=old
        source=kit.WORK_DIR/(stem+'.blend');sanitize(stem);bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
        path=kit.GLB_DIR/(stem+'.glb');export_active(ob,path);stamp(path)
        validation=kit.WORK_DIR/(stem+'-validation.json');report=json.loads(validation.read_text());report.update(triangle_budget=6000,glb_bytes=path.stat().st_size,datums=DATUM,closedComponentSignedVolumesM3=positive_winding(ob,repair=False),source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),glb_sha256=hashlib.sha256(path.read_bytes()).hexdigest());validation.write_text(json.dumps(report,indent=2)+'\n')
        rel=lambda p:str(p.relative_to(ROOT));it=dict(id=stem,name=spec['name'],kind=spec['kind'],group='住設',category='水回り',packId='rpg-mansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),front=rel(HERE/'evidence'/(stem+'-front.png')),rear=rel(HERE/'evidence'/(stem+'-rear.png')),sourceBlend=rel(source),authoringBlend=rel(HERE/'authoring_sources'/(stem+'.blend')),validation=rel(validation),builder=rel(HERE/'build.py'),w=size[0],d=size[1],h=size[2],authoredNominalDimensionsMm=spec['size']or list(size),actualMeasuredDimensionsMm=list(size),geometrySignature=spec['signature'],triangleBudget=6000,defaultElevation=spec['elevation'],provenance='original',staticProp=True,placementHint=DATUM['installation']['mount'],semanticCoverage=spec['meaning'],dimensionBasis='Original intended design envelope. Source catalogue dimensions are demand references, not measured replacement or ergonomic certification.',installationDatums=DATUM,finishChannels=[dict(key=c,label={'ceramic':'陶器','metal':'金属','wood':'木部'}[c],default={'ceramic':'#eee9dc','metal':'#ad8745','wood':'#533728'}[c])for c in spec['channels']])
        for key,field in [('sha256','model'),('sourceSha256','sourceBlend'),('authoringSha256','authoringBlend')]:it[key]=hashlib.sha256((ROOT/it[field]).read_bytes()).hexdigest()
        items=[i for i in items if i['id']!=stem]+[it];file.write_text(json.dumps(dict(set='rpg-mansion',name='洋館・水回り試作',prototypeOnly=True,items=items),ensure_ascii=False,indent=2)+'\n')
        if '--no-icons'not in sys.argv:
            for view in ['thumb','top','front','rear']:render(ob,ROOT/it[view],view)
        print('WATER_PROTOTYPE_READY',stem,report['triangles'],report['glb_bytes'],flush=True)
    (HERE/'rights-and-provenance.json').write_text(json.dumps(dict(authoring='Original project-authored native Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Original project-authored assets for this project; no separate public reuse license granted',measurementPolicy='Intended design dimensions; catalogue demands do not establish replacement equivalence',source='build.py',sourceSha256=hashlib.sha256((HERE/'build.py').read_bytes()).hexdigest(),assets=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in items]),indent=2)+'\n')
if __name__=='__main__':main()
