"""Original lighting reconstruction from surviving geometry recipe. Fresh build and QA required."""
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
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews'
kit.WORK_DIR=HERE/'sources';kit.export=export_active;kit.unwrap=metric_uv
PARTS=[];M={};DATUM={}

def palette():
    global M
    M={}
    for key,label,col,rough,metal,ch in [
        ('metal','Antique brass structure','#96703c',.3,.78,'metal'),
        ('iron','Bronzed iron structure','#39352e',.34,.78,'metal'),
        ('shade','Ivory enamel spun metal shades','#c9bd9b',.29,.25,'shade'),
        ('glass','Green cast glass shade','#15583d',.18,.08,'glass'),
        ('clear','Clear lightly tinted glass','#c2ded2',.1,.0,'glass'),
        ('bulb','Opal bulb glass static appearance','#fff0c9',.24,0,'glass'),
        ('ceramic','Porcelain socket insulator','#d1c7ae',.42,0,'ceramic')
    ]:
        m=kit.matp(label,col,rough,metal)
        m['finishChannel']=ch;m.use_backface_culling=True;M[key]=m
        bs=m.node_tree.nodes.get('Principled BSDF')
        if key=='clear':
            bs.inputs['Alpha'].default_value=.1
            m.diffuse_color=(*m.diffuse_color[:3],.1)
            m.surface_render_method='DITHERED'
            bs.inputs['Transmission Weight'].default_value=.92
            bs.inputs['IOR'].default_value=1.45
            m['glassAppearance']='Closed 3mm panels, nonzero green tint, alpha 0.10 and transmission 0.92 using standard glTF PBR extension; actual GLB contrast tested'
        if key=='glass':
            bs.inputs['Transmission Weight'].default_value=.08
        if key=='bulb':
            bs.inputs['Emission Color'].default_value=(1,.71,.34,1)
            bs.inputs['Emission Strength'].default_value=.3
            m['appearanceOnly']='Modest material emission; no native PointLight or SpotLight'

def keep(ob,role=None):
    PARTS.append(ob);ob['constructionPart']=ob.name
    if role:ob['functionalRole']=role
    return ob

def mesh(name,verts,faces,mat='ceramic',smooth=True):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    me.materials.append(M[mat])
    for p in me.polygons:p.use_smooth=smooth
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    positive_winding(ob);return keep(ob)

def box(name,center,size,mat='metal',radius=.002):
    ob=kit.box(name,tuple(center[i]-size[i]/2 for i in range(3)),
               tuple(center[i]+size[i]/2 for i in range(3)),M[mat],radius,1)
    positive_winding(ob);return keep(ob)

def loft(name,rings,mat='ceramic',smooth=True,caps=True):
    n=len(rings[0]);verts=[tuple(v)for ring in rings for v in ring]
    faces=[tuple(reversed(range(n)))] if caps else []
    faces += [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)
              for k in range(len(rings)-1)for i in range(n)]
    if caps:faces.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    else:faces += [((len(rings)-1)*n+i,(len(rings)-1)*n+(i+1)%n,(i+1)%n,i)for i in range(n)]
    ob=mesh(name,verts,faces,mat,smooth)
    if caps:ob.data.polygons[0].use_smooth=ob.data.polygons[-1].use_smooth=False
    return ob

def ellipse(w,d,z,cx=0,cy=0,n=48):
    return [(cx+w/2*math.cos(math.tau*i/n),
             cy+d/2*math.sin(math.tau*i/n),
             z(math.tau*i/n)if callable(z)else z)for i in range(n)]

def sweep(name,path,r,mat='metal',sides=10,closed=False,smooth=True):
    path=[Vector(p)for p in path]
    tangents=[((path[(i+1)%len(path)]-path[(i-1)%len(path)])if closed
               else(path[min(i+1,len(path)-1)]-path[max(i-1,0)])).normalized()
              for i in range(len(path))]
    seed=min([Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))],
             key=lambda a:max(abs(t.dot(a))for t in tangents))
    rings=[]
    for p,t in zip(path,tangents):
        u=t.cross(seed).normalized();v=t.cross(u).normalized()
        rings.append([p+r*(u*math.cos(math.tau*j/sides)+v*math.sin(math.tau*j/sides))
                      for j in range(sides)])
    return loft(name,rings,mat,smooth,caps=not closed)

def lathe(name,x,y,rows,mat='metal',n=16):
    return loft(name,[ellipse(2*r,2*r,z,x,y,n)for r,z in rows],mat)

def bulb(name,x,y,z,scale=1):
    return lathe(name,x,y,[(r*scale,z+h*scale)for r,h in
        [(.004,0),(.016,.009),(.025,.025),(.03,.052),(.025,.078),(.018,.095),(.015,.112)]],
        'bulb',24)

def banker():
    base=loft('Weighted stepped oval desk base',
        [ellipse(w,d,z,n=40)for w,d,z in
         [(.20,.14,0),(.218,.155,.01),(.218,.155,.020),(.20,.14,.029),(.14,.105,.034)]],
        'metal')
    base['functionalRole']='desk-support'
    lathe('Fluted stem foot',0,.045,
          [(.026,.031),(.025,.044),(.017,.055),(.015,.09)],'metal',24)
    stem=sweep('Desk lamp central articulated support',
               [(0,.045,.053),(0,.045,.224)],.010,'metal',16)
    stem['functionalRole']='bearing-stem'
    sweep('Crosswise yoke crossmember',
          [(-.219,.045,.232),(.219,.045,.232)],.009,'metal',16)
    for sx in [-1,1]:
        sweep('Curved yoke side arm '+str(sx),
              [(sx*.211,.045,.232),(sx*.22,.039,.253),
               (sx*.225,.018,.31),(sx*.225,0,.332)],.009,'metal',12)
        sweep('Articulated side pivot '+str(sx),
              [(sx*.202,0,.333),(sx*.229,0,.333)],.013,'metal',20)
        sweep('Shade interior crown carrier '+str(sx),
              [(sx*.205,0,.338),(sx*.205,0,.417)],.004,'metal',12)
    n=32;verts=[]
    for x,r in [(-.208,.087),(.208,.087),(-.202,.081),(.202,.081)]:
        verts += [(x,r*math.cos(math.pi*i/n),.333+r*math.sin(math.pi*i/n))
                  for i in range(n+1)]
    k=n+1;faces=[]
    for i in range(n):
        faces.extend([(i,i+1,k+i+1,k+i),
                      (2*k+i,3*k+i,3*k+i+1,2*k+i+1),
                      (i,2*k+i,2*k+i+1,i+1),
                      (k+i,k+i+1,3*k+i+1,3*k+i)])
    for i in [0,n]:faces.append((i,k+i,3*k+i,2*k+i))
    ob=mesh('Open bottom green cast glass banker shade',verts,faces,'glass')
    ob['functionalRole']='hollow-shade'
    for p in ob.data.polygons:
        if p.index%4 in [2,3]or p.index>=4*n:p.use_smooth=False
    lamp=sweep('Horizontal opal tubular bulb',
               [(-.149,0,.332),(.149,0,.332)],.016,'bulb',24)
    lamp['functionalRole']='bulb'
    for sx in [-1,1]:
        sweep('Banker bulb end socket '+str(sx),
              [(sx*.144,0,.332),(sx*.196,0,.332)],.019,'ceramic',20)
        sweep('Banker socket retaining stud '+str(sx),
              [(sx*.19,0,.332),(sx*.211,0,.332)],.010,'metal',16)
    lathe('Decorative switch bezel',.052,-.025,
          [(.009,.027),(.009,.034),(.005,.037)],'iron',12)
    sweep('Static switch lever',
          [(.052,-.025,.032),(.052,-.019,.047)],.003,'metal',10)
    DATUM.update(
        installation={'mount':'desk','supportPlaneGltfY':0,'defaultElevationMm':740,
         'note':'Place bottom on a 740mm desk plane. Static fixture; no configured runtime illumination.'},
        shade={'construction':'continuous cast glass closed volume with open underside',
               'minimumWallThicknessMm':6,'openingWidthMm':404,'openingDepthMm':162},
        bulb={'type':'tubular mesh bulb','materialEmissionStrength':.3,'runtimeLightObjects':0})

def wall_lantern():
    p=box('Wall mounting plate',(0,.14,.44),(.082,.022,.32),'iron',.003)
    p['functionalRole']='wall-anchor'
    for z in [.31,.57]:
        sweep('Wall plate screw '+str(z),[(0,.129,z),(0,.121,z)],.006,'metal',12)
    arm=sweep('Gooseneck wall lantern bracket',
              [(0,.141,.525),(0,.095,.573),(0,-.02,.573),
               (0,-.05,.548),(0,-.05,.50)],.013,'iron',16)
    arm['functionalRole']='bearing-bracket'
    sweep('Triangular wall bracket brace',
          [(0,.139,.395),(0,.087,.419),(0,-.044,.533)],.008,'iron',12)
    # The original script created then removed a temporary diamond-profile tray here.
    # It contributed no final geometry and is omitted from this reconstruction recipe.
    box('Lantern lower plinth',(0,-.05,.015),(.270,.240,.030),'iron',.004)
    box('Lantern floor plate',(0,-.05,.035),(.244,.214,.016),'metal',.002)
    for sx in [-1,1]:
        for sy in [-1,1]:
            box('Corner frame upright %d %d'%(sx,sy),
                (sx*.116,sy*.101-.05,.194),(.018,.018,.33),'iron',.002)
    for z in [.049]:
        for sy in [-1,1]:
            box('Front rear frame rail %.3f %d'%(z,sy),
                (0,sy*.101-.05,z),(.246,.019,.018),'iron',.002)
        for sx in [-1,1]:
            box('Side frame rail %.3f %d'%(z,sx),
                (sx*.116,-.05,z),(.019,.202,.018),'iron',.002)
    rrframe=lambda w,d,z:[
        (-w/2,-.05-d/2,z),(w/2,-.05-d/2,z),
        (w/2,-.05+d/2,z),(-w/2,-.05+d/2,z)]
    upper=loft('Continuous upper lantern frame ring',
        [rrframe(.252,.222,.344),rrframe(.252,.222,.362),
         rrframe(.212,.180,.362),rrframe(.212,.180,.344)],'iron',False,False)
    upper['functionalRole']='body-hanging-frame'
    for sx in [-1,1]:
        h=sweep('Roof to body suspension hanger '+str(sx),
                [(sx*.116,-.05,.351),(sx*.1,-.05,.411)],.007,'iron',12)
        h['functionalRole']='roof-body-hanger'
    for sy in [-1,1]:
        gl=box('Clear front rear glass panel '+str(sy),
               (0,sy*.101-.05,.2),(.224,.003,.294),'clear',0)
        gl['functionalRole']='clear-glass-pane'
    for sx in [-1,1]:
        gl=box('Clear side glass panel '+str(sx),
               (sx*.116,-.05,.2),(.003,.19,.294),'clear',0)
        gl['functionalRole']='clear-glass-pane'
    rr=lambda w,d,z:[
        (-w/2,-.05-d/2,z),(w/2,-.05-d/2,z),
        (w/2,-.05+d/2,z),(-w/2,-.05+d/2,z)]
    roof=loft('Hollow hip roof with turned eave',
        [rr(.30,.24,.355),rr(.30,.24,.377),rr(.082,.068,.471),
         rr(.066,.052,.471),rr(.283,.223,.372),rr(.282,.222,.355)],
        'iron',False,False)
    roof['functionalRole']='hollow-roof'
    lathe('Roof hanging attachment boss',0,-.05,
          [(.03,.465),(.031,.480),(.016,.49),(.016,.512)],'metal',20)
    for z in [.115,.285]:
        lathe('Front door hinge barrel '+str(z),-.124,-.158,
              [(.006,z-.022),(.006,z+.022)],'metal',12)
    box('Front door latch tongue',(.119,-.163,.205),(.026,.009,.025),'metal',.001)
    sweep('Front door turn catch',
          [(.118,-.169,.194),(.118,-.169,.220)],.0035,'metal',10)
    lathe('Inner pedestal mount',0,-.05,
          [(.040,.041),(.036,.049),(.019,.063),(.019,.09)],'metal',20)
    lathe('Inner porcelain screw socket',0,-.05,
          [(.025,.08),(.025,.11),(.020,.12)],'ceramic',20)
    ob=bulb('Inner opal lamp bulb',0,-.05,.109,1.15)
    ob['functionalRole']='bulb'
    DATUM.update(
        installation={'mount':'wall-bracket','wallContactPlaneBlenderY':.151,
                      'defaultElevationMm':1500,'wallAnchorPart':'Wall mounting plate',
                      'note':'Back of plate lies on declared wall plane. Lantern bottom at 1500mm; no electrical fitting or runtime Light.'},
        shade={'construction':'four closed 3mm glass panels within metal frame; hollow hip roof and visible inner socket','glassThicknessMm':3},
        bulb={'type':'mesh opal bulb','materialEmissionStrength':.3,'runtimeLightObjects':0})

def linear_pendant():
    canopy=box('Ceiling mounting canopy',(0,0,.575),(1.02,.10,.05),'iron',.006)
    canopy['functionalRole']='ceiling-anchor'
    for x in [-.45,.45]:
        lathe('Canopy fixing boss '+str(x),x,0,
              [(.022,.54),(.022,.555)],'metal',20)
        rod=sweep('Suspension rod '+str(x),
                  [(x,0,.231),(x,0,.559)],.009,'metal',16)
        rod['functionalRole']='suspension'
        lathe('Beam top collar '+str(x),x,0,
              [(.016,.216),(.019,.240),(.016,.254)],'metal',16)
    box('Suspended rectangular crossbeam',(0,0,.22),(1.4,.045,.048),'iron',.004)
    for x in [-.525,-.175,.175,.525]:
        lathe('Pendant socket stem '+str(x),x,0,
              [(.024,.141),(.025,.160),(.018,.185),(.018,.225)],'metal',20)
        lathe('Pendant porcelain insulator '+str(x),x,0,
              [(.019,.110),(.021,.14),(.023,.161)],'ceramic',20)
        lathe('Shade retaining collar '+str(x),x,0,
              [(.019,.172),(.031,.175),(.031,.179),(.024,.183)],'metal',16)
        rows=[(.025,.182),(.038,.168),(.06,.137),(.100,.072),
              (.128,.026),(.127,.021),(.123,.020),(.123,.026),
              (.096,.070),(.057,.135),(.035,.166),(.022,.180)]
        # Original script first made and removed a capped lathe using these rows.
        # Only the following annular open shell survived into authoring/export.
        ob=loft('Downward open spun shade '+str(x),
                [ellipse(2*r,2*r,z,x,0,26)for r,z in rows],'shade',True,False)
        ob['functionalRole']='hollow-shade'
        b=bulb('Downward opal bulb '+str(x),x,0,0,1);b['functionalRole']='bulb'
    DATUM.update(
        installation={'mount':'ceiling-rods','ceilingContactPlaneBlenderZ':.600,
                      'defaultElevationMm':2100,'ceilingPlaneMm':2700,
                      'note':'Fixture bottom 2100mm and canopy top 2700mm. No automatic ceiling following or native illumination.'},
        shade={'construction':'four distinct downward-open spun shells with 3mm nominal sheet separation',
               'openingDiameterMm':246,'minimumAuthoredSheetThicknessMm':2},
        bulb={'type':'four mesh opal bulbs','materialEmissionStrength':.3,'runtimeLightObjects':0})



SPECS=[
 dict(slug='banker-desk-lamp',name='緑ガラス笠・バンカーズデスクランプ',kind='table-lamp',fn=banker,channels=['metal','glass','ceramic'],size=(468,174,420),elevation=740,signature='weighted-oval-base-articulated-yoke-halfcylinder-open-glass-tubular-bulb',meaning='Weighted oval desktop base, physical articulated yoke and hollow green glass vault, supported horizontal tubular bulb with paired sockets.'),
 dict(slug='bracketed-wall-lantern',name='取付板と曲線腕付き・ガラス壁ランタン',kind='wall-lamp',fn=wall_lantern,channels=['metal','glass','ceramic'],size=(300,323.5,600),elevation=1500,signature='wall-plate-gooseneck-braced-bracket-hollow-framed-lantern-clear-panes',meaning='Backplate, braced gooseneck and real roof-to-frame hangers carry a hollow lantern with four clear panes, socket and bulb.'),
 dict(slug='linear-four-light-pendant',name='二本吊りロッド・四灯リニアペンダント',kind='pendant-lamp',fn=linear_pendant,channels=['metal','shade','glass','ceramic'],size=(1400,254.133,600),elevation=2100,signature='ceiling-canopy-two-suspension-rods-rectangular-beam-four-open-spun-shades',meaning='One static four-head linear pendant with common ceiling canopy, paired suspension rods, physical shade retaining collars and four open spun shades.')]

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
    d['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',packId='rpg-mansion',provenance='Original project-authored native Blender geometry; no imported geometry or images',source='tools/blender/rpg_mansion/decorative_lighting/build.py',staticProp=True)
    payload=json.dumps(d,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(ob,path,view):
    bpy.ops.scene.new(type='NEW');scene=bpy.context.scene;scene.name='Temporary product evidence'
    copy=ob.copy();copy.data=ob.data.copy();scene.collection.objects.link(copy);ob=copy
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.seed=0;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world;scene.view_settings.view_transform='AgX'
    pts=[ob.matrix_world@v.co for v in ob.data.vertices];lo=Vector([min(p[i]for p in pts)for i in range(3)]);hi=Vector([max(p[i]for p in pts)for i in range(3)]);span=max(hi-lo);target=(lo+hi)/2
    for name,power,loc,size in [('Key',350,(span*2,-span*3,span*3),span*3),('Fill',150,(-span*2,-span,span*1.5),span*2),('Rim',90,(span,span*2,span*2.4),span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    if view=='top':loc=(0,0,span*4)
    elif view=='front':loc=(0,-span*4,target.z)
    elif view=='side':loc=(span*4,-span*.5,target.z+span*.25)
    elif view=='underside':loc=(span*1.9,-span*3,-span*1.7)
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
        rel=lambda p:str(p.relative_to(ROOT));it=dict(id=stem,name=spec['name'],kind=spec['kind'],group='住設',category='照明',packId='rpg-mansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),front=rel(HERE/'evidence'/(stem+'-front.png')),rear=rel(HERE/'evidence'/(stem+'-rear.png')),sourceBlend=rel(source),authoringBlend=rel(HERE/'authoring_sources'/(stem+'.blend')),validation=rel(validation),builder=rel(HERE/'build.py'),w=size[0],d=size[1],h=size[2],authoredNominalDimensionsMm=spec['size']or list(size),actualMeasuredDimensionsMm=list(size),geometrySignature=spec['signature'],triangleBudget=6000,defaultElevation=spec['elevation'],provenance='original',staticProp=True,placementHint=DATUM['installation']['mount'],semanticCoverage=spec['meaning'],dimensionBasis='Original intended design envelope. Source catalogue dimensions are demand references, not measured replacement or ergonomic certification.',installationDatums=DATUM,finishChannels=[dict(key=c,label={'ceramic':'陶器','metal':'金属','glass':'ガラス','shade':'笠'}[c],default=({'metal':'#39352e','glass':'#c2ded2'}if spec['kind']=='wall-lamp'else{'metal':'#39352e','glass':'#fff0c9'}if spec['kind']=='pendant-lamp'else{}).get(c,{'ceramic':'#d1c7ae','metal':'#96703c','glass':'#15583d','shade':'#c9bd9b'}[c]))for c in spec['channels']])
        for key,field in [('sha256','model'),('sourceSha256','sourceBlend'),('authoringSha256','authoringBlend')]:it[key]=hashlib.sha256((ROOT/it[field]).read_bytes()).hexdigest()
        items=[i for i in items if i['id']!=stem]+[it];items.sort(key=lambda i:next(n for n,s in enumerate(SPECS)if i['id']=='rpg-mansion-'+s['slug']+'-01'));file.write_text(json.dumps(dict(set='rpg-mansion',name='洋館・照明試作',prototypeOnly=True,items=items),ensure_ascii=False,indent=2)+'\n')
        if '--no-icons'not in sys.argv:
            for view in ['thumb','top','front','rear']:render(ob,ROOT/it[view],view)
        print('LIGHTING_PROTOTYPE_READY',stem,report['triangles'],report['glb_bytes'],flush=True)
    (HERE/'rights-and-provenance.json').write_text(json.dumps(dict(authoring='Original project-authored native Blender geometry',thirdPartyGeometry=False,thirdPartyTextures=False,paidGeneration=False,license='Original project-authored assets for this project; no separate public reuse license granted',measurementPolicy='Intended design dimensions; catalogue demands do not establish replacement equivalence',source='build.py',sourceSha256=hashlib.sha256((HERE/'build.py').read_bytes()).hexdigest(),assets=[dict(id=i['id'],glbSha256=i['sha256'],sourceSha256=i['sourceSha256'],authoringSha256=i['authoringSha256'])for i in items]),indent=2)+'\n')
if __name__=='__main__':main()
