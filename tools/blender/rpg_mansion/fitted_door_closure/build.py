"""Original six-panel mansion door. Self-contained Blender source; no remote writes."""
from pathlib import Path
import sys, math, json, hashlib, struct, shutil
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'helpers'))
import bpy,bmesh
from mathutils import Vector,Matrix
import model_kit as kit
from native_utils import positive_winding,metric_uv,export_active,sanitize
from png_metadata import strip_metadata
ID='rpg-mansion-fitted-six-panel-door-1200-01'
PARTS=[];M={}
PIVOT=Vector((-.610,-.180,0))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def keep(ob,role='moving-leaf'):
    ob['constructionPart']=ob.name;ob['motionGroup']=role;PARTS.append(ob);return ob
def box(name,lo,hi,mat='wood',rad=.001,role='moving-leaf'):
    return keep(kit.box(name,lo,hi,M[mat],rad,1),role)
def cyl(name,center,r,depth,mat='metal',axis='Z',role='moving-leaf',sides=16):
    return keep(kit.cylinder(name,center,r,depth,M[mat],axis,sides),role)
def mesh(name,rings,mat='wood',role='moving-leaf'):
    n=len(rings[0]);vs=[p for r in rings for p in r];fs=[tuple(reversed(range(n)))]
    fs += [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rings)-1)for i in range(n)]
    fs.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();me.materials.append(M[mat]);ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);positive_winding(ob);return keep(ob,role)
def ring_knuckle(name,z,role):
    n=16;rings=[]
    for r,zz in [(.009,z-.012),(.009,z+.012),(.0032,z+.012),(.0032,z-.012)]:rings.append([(-.610+r*math.cos(math.tau*i/n),-.180+r*math.sin(math.tau*i/n),zz)for i in range(n)])
    vs=[p for ring in rings for p in ring];fs=[(k*n+i,k*n+(i+1)%n,((k+1)%4)*n+(i+1)%n,((k+1)%4)*n+i)for k in range(4)for i in range(n)]
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();me.materials.append(M['metal']);ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);positive_winding(ob);return keep(ob,role)
def panel(name,x0,x1,z0,z1):
    box(name+' inset solid panel',(x0-.003,-.130,z0-.003),(x1+.003,-.106,z1+.003),'panel',.0008)
    for side,face,sgn in [('front',-.130,-1),('rear',-.106,1)]:
        outer=[(x0+.020,z0+.020),(x1-.020,z0+.020),(x1-.020,z1-.020),(x0+.020,z1-.020)]
        inner=[(x0+.051,z0+.051),(x1-.051,z0+.051),(x1-.051,z1-.051),(x0+.051,z1-.051)]
        rings=[[(x,face-sgn*.002,z)for x,z in outer],[(x,face+sgn*.002,z)for x,z in outer],[(x,face+sgn*.008,z)for x,z in inner]]
        mesh(name+' '+side+' chamfered field',rings,'panel')
        # Mitered four-sided moulding, fully closed shell, bedded into the panel core.
        outer=[(x0-.002,z0-.002),(x1+.002,z0-.002),(x1+.002,z1+.002),(x0-.002,z1+.002)]
        inner=[(x0+.024,z0+.024),(x1-.024,z0+.024),(x1-.024,z1-.024),(x0+.024,z1-.024)]
        rings=[[(x,face-sgn*.002,z)for x,z in outer],[(x,face+sgn*.010,z)for x,z in outer],[(x,face+sgn*.006,z)for x,z in inner],[(x,face-sgn*.002,z)for x,z in inner]]
        vs=[p for r in rings for p in r];fs=[(k*4+i,k*4+(i+1)%4,((k+1)%4)*4+(i+1)%4,((k+1)%4)*4+i)for k in range(4)for i in range(4)]
        me=bpy.data.meshes.new(name+' moulding');me.from_pydata(vs,[],fs);me.update();me.materials.append(M['trim']);ob=bpy.data.objects.new(name+' '+side+' mitred moulding',me);bpy.context.collection.objects.link(ob);positive_winding(ob);keep(ob)
def screw(name,x,y,z,sgn=-1,role='moving-leaf'):
    cyl(name+' screw head',(x,y,z),.0035,.0028,'metal','Y',role,12)
def forms():
    PARTS.clear();M.clear()
    for key,color,rough,metal,channel in [('wood','#735039',.53,0,'wood'),('panel','#805b40',.57,0,'wood'),('trim','#916b49',.48,0,'trim'),('metal','#af8b4b',.33,.72,'metal')]:
        m=kit.matp('Original door '+key,color,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;M[key]=m
    for lab,x0,x1 in [('hinge',-.596,-.470),('centre',-.040,.040),('latch',.470,.596)]:box(lab+' full-height timber stile',(x0,-.140,.012),(x1,-.096,2.396))
    for lab,z0,z1 in [('bottom',.012,.192),('lower',.750,.880),('lock',1.280,1.420),('top',2.250,2.396)]:
        for side,x0,x1 in [('left',-.471,-.039),('right',.039,.471)]:box(lab+' '+side+' timber rail',(x0,-.140,z0),(x1,-.096,z1))
    for k,(z0,z1) in enumerate([(.192,.750),(.880,1.280),(1.420,2.250)]):
        for side,x0,x1 in [('left',-.470,-.040),('right',.040,.470)]:panel('Panel '+str(k+1)+' '+side,x0,x1,z0,z1)
    for k,z in enumerate([.260,1.195,2.140]):
        # Surface plates require no host mortises. Host rear of fixed plate is y=-.1625,
        # a 0.5mm bedding overlap with the unchanged y=-.163 architrave face.
        box('Hinge '+str(k)+' stationary plate',(-.690,-.168,z-.066),(-.622,-.1625,z+.066),'metal',.001,'stationary-host')
        box('Hinge '+str(k)+' leaf strap',(-.597,-.145,z-.066),(-.488,-.1395,z+.066),'metal',.001)
        # Alternating knuckles have 1mm axial clearances. Full central pin is stationary.
        cyl('Hinge '+str(k)+' stationary pin',(-.610,-.180,z-.0085),.003,.127,'metal','Z','stationary-host',16)
        for zz in [z-.073,z+.054]:cyl('Hinge '+str(k)+' stationary pin retaining head',(-.610,-.180,zz),.0105,.006,'metal','Z','stationary-host',16)
        for j in range(5):
            zz=z-.060+j*.025;role='stationary-host'if j%2==0 else'moving-leaf'
            ring_knuckle('Hinge '+str(k)+' knuckle '+str(j),zz,role)
            if role=='stationary-host':box('Hinge fixed knuckle web',(-.638,-.181,zz-.011),(-.616,-.166,zz+.011),'metal',.0005,role)
            else:
                outline=[(-.604,-.181),(-.587,-.181),(-.587,-.171),(-.575,-.171),(-.575,-.142),(-.595,-.142),(-.595,-.167),(-.604,-.167)]
                ob=mesh('Hinge one-piece L offset strap', [[(x,y,h)for x,y in outline]for h in [zz-.011,zz+.011]],'metal',role);kit.bevel(ob,.0005,1)
        for x,yy,role in [(-.665,-.169,'stationary-host'),(-.525,-.146,'moving-leaf')]:
            for zz in [z-.044,z+.044]:screw('Hinge fixing',x,yy,zz,role=role)
    # Rim latch bolts into a surface keep, entirely ahead of unchanged jamb timber.
    box('Rim latch body',(.480,-.184,1.000),(.586,-.1395,1.120),'metal',.003)
    cyl('Manually retractable latch bolt',(.596,-.176,1.060),.0045,.088,'metal','X','moving-bolt',16)
    outer=[(-.192,1.035),(-.1625,1.035),(-.1625,1.085),(-.192,1.085)]
    inner=[(-.188,1.049),(-.166,1.049),(-.166,1.071),(-.188,1.071)]
    rings=[[(x,y,z)for y,z in profile]for x,profile in [(.607,outer),(.653,outer),(.653,inner),(.607,inner)]]
    vs=[p for ring in rings for p in ring];fs=[(k*4+i,k*4+(i+1)%4,((k+1)%4)*4+(i+1)%4,((k+1)%4)*4+i)for k in range(4)for i in range(4)]
    me=bpy.data.meshes.new('Continuous bored strike keep');me.from_pydata(vs,[],fs);me.update();me.materials.append(M['metal']);ob=bpy.data.objects.new('Continuous bored strike keep',me);bpy.context.collection.objects.link(ob);positive_winding(ob);kit.bevel(ob,.0006,1);keep(ob,'stationary-host')
    for zz in [1.017,1.103]:
        box('Strike fixing ear',(.617,-.168,zz-.012),(.653,-.1625,zz+.012),'metal',.001,'stationary-host');screw('Strike fixing',.635,-.169,zz,role='stationary-host')
    for label,face,sgn in [('front',-.184,-1),('rear',-.096,1)]:
        cyl(label+' round escutcheon',(.527,face+sgn*.002,1.060),.029,.005,'metal','Y')
        cyl(label+' pull spindle',(.527,face+sgn*.016,1.060),.008,.030,'metal','Y')
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,radius=1,location=(.527,face+sgn*.042,1.060));ob=bpy.context.object;ob.name=label+' attached oval brass knob';ob.scale=(.022,.024,.022);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);ob.data.materials.append(M['metal']);keep(ob)
        for zz in [1.040,1.080]:screw(label+' escutcheon fixing',.527,face+sgn*.005,zz,sgn)
    for ob in PARTS:positive_winding(ob)
def bounds(obs):
    pts=[o.matrix_world@v.co for o in obs for v in o.data.vertices];return [Vector([min(p[i]for p in pts)for i in range(3)]),Vector([max(p[i]for p in pts)for i in range(3)])]
def stamp(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',provenance='Original native Blender geometry; no external geometry or imagery',staticProp=True);b=json.dumps(d,separators=(',',':')).encode();b+=b' '*(-len(b)%4);r=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(b)+len(r))+struct.pack('<II',len(b),0x4e4f534a)+b+r)
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True);forms();lo,hi=bounds(PARTS);shift=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z));dims=[round(x*1000,3)for x in hi-lo]
    dt=dict(host='rpg-mansion-rectangular-doorway-bay-01',leafWidthMm=1192,leafHeightMm=2384,leafBodyThicknessMm=44,leafBoundsInstalledBlenderM=[[-.596,-.140,.012],[.596,-.096,2.396]],finishedFloorMm=0,sideGapsMm=[4,4],topGapMm=4,bottomGapMm=12,hingePivotInstalledBlenderM=list(PIVOT),constructionToAssetTranslationBlenderM=list(shift),installationTransformBlenderM=[list(r)for r in Matrix.Translation(-shift)],hostClearOpeningMm=[1200,2400],manualOpeningProof=dict(rotationDegrees=-90,axis='Blender +Z through hinge pivot',stationaryGroups=['stationary-host'],movingGroups=['moving-leaf','moving-bolt'],boltRetractionBeforeSwingMm=35),wholeCatalogueModelHasNoOperableHierarchy=True)
    components=[]
    for ob in PARTS:
        a,b=bounds([ob]);components.append(dict(name=ob.name,motionGroup=ob['motionGroup'],boundsInstalledBlenderM=[list(a),list(b)],vertices=len(ob.data.vertices),polygons=len(ob.data.polygons)))
        for v in ob.data.vertices:v.co+=shift
        metric_uv(ob)
    sc=bpy.context.scene;sc.name='Editable original six-panel door';sc['assetId']=ID;sc['installationDatumsJson']=json.dumps(dt);sc['staticProp']=True;sc['front']='-Y';sc['up']='+Z'
    bpy.context.preferences.filepaths.save_version=0;sanitize(ID);author=HERE/'authoring_sources'/(ID+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(author),compress=True)
    bpy.ops.scene.new(type='FULL_COPY');sc=bpy.context.scene;sc.name='Canonical static export';ob=kit.combine([o for o in sc.objects if o.type=='MESH']);ob['assetId']=ID;ob['staticProp']=True;ob['wholeModelMustRemainClosed']=True
    kit.WORK_DIR=HERE/'sources';kit.unwrap=metric_uv;old=kit.clear_scene;kit.clear_scene=lambda:None;ob=kit.run([(ID,dims,lambda:ob,{'wood','trim','metal'},15000)],do_export=False,do_icons=False)[0];kit.clear_scene=old
    canonical=HERE/'sources'/(ID+'.blend');sanitize(ID);bpy.ops.wm.save_as_mainfile(filepath=str(canonical),compress=True);glb=HERE/'models'/(ID+'.glb');export_active(ob,glb);stamp(glb)
    vp=HERE/'sources'/(ID+'-validation.json');r=json.loads(vp.read_text());r.update(closedComponentSignedVolumesM3=positive_winding(ob,False),datums=dt,nativePartCount=len(components),glb_bytes=glb.stat().st_size,triangle_budget=15000);vp.write_text(json.dumps(r,indent=2)+'\n')
    it=dict(id=ID,name='Six-panel timber door fitted to 1200mm rectangular bay',kind='joinery-prop',group='住設',category='建築部材',assetSet='rpg-mansion',model='models/'+ID+'.glb',sourceBlend='sources/'+ID+'.blend',exportBlend='sources/'+ID+'.blend',authoringBlend='authoring_sources/'+ID+'.blend',validation='sources/'+ID+'-validation.json',builder='build.py',w=dims[0],d=dims[1],h=dims[2],defaultElevation=12,provenance='original',finishChannels=[dict(key=k,label=k,default=c)for k,c in [('wood','#735039'),('trim','#916b49'),('metal','#af8b4b')]],triangleBudget=15000,measuredTriangles=r['triangles'],glbBytes=glb.stat().st_size,nativePartCount=len(components),staticProp=True,countingClass='new-construction',coreConstructionCount=1,independentConstructionCount=1,variantOf=None,installationDatums=dt,placementNotes='One specific 1200 × 2400 mm rectangular host fit. Static closed leaf plus host-mounted hinge/strike hardware in one catalogue mesh. Manual placement only. Whole-model rigid rotation does not open the leaf. No wall cutting, automatic host association, animation, collision, traversability, weather/fire/security or code certification.',rights=dict(status='original',creator='OpenAI assistant using native Blender authoring',sources=[],externalGeometry=False,externalImages=False,licenseBasis='Original procedural door geometry created for this project; accepted host and floor are project originals reused unchanged in proof scenes only.'),acceptanceStatus='Candidate awaiting root visual and independent technical acceptance')
    for view in ['thumb','top','front','rear','left','right']:it[view]=('previews/'if view in ['thumb','top']else'evidence/')+ID+'-'+view+'.png'
    it['hashes']={key:sha(HERE/it[key])for key in ['model','sourceBlend','exportBlend','authoringBlend','validation']}
    (HERE/'descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',newConstructionCount=1,widthVariantCount=0,poseVariantCount=0,accessoryOnlyCount=0,items=[it]),indent=2)+'\n');(HERE/'reports/components.json').write_text(json.dumps(components,indent=2)+'\n')
    print('STABLE_NATIVE_PAIR',ID,r['triangles'],dims,flush=True)
def render(obs,path,delta=(2,-4,1.2),res=768,target=None,scale=None):
    original=bpy.context.scene;bpy.ops.scene.new(type='NEW');sc=bpy.context.scene;sc.name='Temporary evidence studio';copies=[]
    for ob in obs:cp=ob.copy();cp.data=ob.data.copy();sc.collection.objects.link(cp);copies.append(cp)
    sc.render.engine='CYCLES';sc.cycles.samples=32;sc.cycles.use_denoising=False;sc.render.resolution_x=sc.render.resolution_y=res;sc.render.resolution_percentage=100;sc.render.film_transparent=True;sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA';sc.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4;sc.world=world
    lo,hi=bounds(copies);span=max(hi-lo);target=Vector(target)if target is not None else(lo+hi)/2
    for power,delta0,size in [(300,(2,-3,3),3),(180,(-2,-1,1.5),2),(180,(1,2,2.4),2)]:
        bpy.ops.object.light_add(type='AREA',location=target+Vector(delta0)*span);lamp=bpy.context.object;lamp.data.energy=power*span*span;lamp.data.shape='DISK';lamp.data.size=size*span;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=target+Vector(delta)*span);cam=bpy.context.object;cam.data.type='ORTHO';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();sc.camera=cam
    pts=[ob.matrix_world@v.co for ob in copies for v in ob.data.vertices];basis=cam.rotation_euler.to_matrix();right=basis@Vector((1,0,0));up=basis@Vector((0,1,0));pr=[(p.dot(right),p.dot(up))for p in pts];a=[min(p[i]for p in pr)for i in range(2)];b=[max(p[i]for p in pr)for i in range(2)]
    if scale is None:
        cen=[(a[i]+b[i])/2 for i in range(2)];cam.location+=right*(cen[0]-target.dot(right))+up*(cen[1]-target.dot(up));cam.data.ortho_scale=max(b[i]-a[i]for i in range(2))/.88
    else:cam.data.ortho_scale=scale
    sc.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path);bpy.data.scenes.remove(sc);bpy.context.window.scene=original
def record_binding(source,path,delta,res,target=None,scale=None,finish_override=None):
    bp=HERE/'reports/render-bindings.json';rows=json.loads(bp.read_text())if bp.exists()else []
    row=dict(source=str(Path(source).relative_to(HERE)),sourceSha256=sha(source),image=str(Path(path).relative_to(HERE)),imageSha256=sha(path),recipe=dict(function='build.render',delta=list(delta),resolution=res,target=target,orthoScale=scale,engine='CYCLES',samples=32,denoise=False,transparent=True,viewTransform='AgX',finishOverride=finish_override))
    binding_dir=HERE/'reports/binding-rows';binding_dir.mkdir(exist_ok=True);(binding_dir/(Path(path).stem+'.json')).write_text(json.dumps(row,indent=2)+'\n')
    rows=[r for r in rows if r['image']!=row['image']]+[row];bp.write_text(json.dumps(rows,indent=2)+'\n')

def renders():
    bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/(ID+'.blend')));ob=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    for view,delta in [('thumb',(2,-4,1.2)),('top',(0,0,4)),('front',(0,-4,0)),('rear',(0,4,0)),('left',(-4,0,0)),('right',(4,0,0))]:
        path=HERE/('previews'if view in ['thumb','top']else'evidence')/(ID+'-'+view+'.png');res=512 if view in ['thumb','top']else 768;render([ob],path,delta,res);record_binding(HERE/'sources'/(ID+'.blend'),path,delta,res)
if __name__=='__main__':
    if '--render-only'in sys.argv:renders()
    else:build()
