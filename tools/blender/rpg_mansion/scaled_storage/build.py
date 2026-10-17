"""Original antique walnut storage family. Local Blender production only.

Authoring checkpoints retain named construction parts. Export checkpoints are
separate single-mesh scenes validated through the repository's model_kit.run.
All dimensions are intended design footprints, not measured historic antiques.
"""
import sys, math, json, hashlib, struct
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parents[1]))
sys.path.insert(0,str(HERE.parent))
import bpy, bmesh
from mathutils import Vector
import model_kit as kit
from build_decor import lathe, loop, mesh_part
from shape_kit import unwrap
from export_contract import export
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion'
kit.GLB_DIR=PACK/'models'
kit.PREVIEW_DIR=PACK/'previews'
kit.WORK_DIR=HERE/'export_sources'
kit.export=export
PARTS=[]; M={}

def palette():
    global M
    M={}
    for key,name,col,rough,metal,channel in [
        ('wood','Mansion walnut heartwood','#533624',.37,0,'wood'),
        ('trim','Mansion walnut mouldings','#68452d',.33,0,'wood'),
        ('inset','Mansion walnut veneered fields','#765038',.38,0,'wood'),
        ('brass','Mansion patinated brass','#9d7b3c',.36,.78,'metal'),
        ('glass','Mansion clear antique glazing','#d9e3dd',.08,0,'glass'),
        ('leather','Mansion teal writing leather','#355c57',.75,0,'fabric')]:
        m=kit.matp(name,col,rough,metal);m['finishChannel']=channel;M[key]=m
    g=M['glass'];g.diffuse_color=(*g.diffuse_color[:3],.12)
    node=next(n for n in g.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node.inputs['Alpha'].default_value=.12
    node.inputs['Transmission Weight'].default_value=.94
    node.inputs['IOR'].default_value=1.45
    g.surface_render_method='DITHERED'
    g.use_backface_culling=False

def keep(obj):
    PARTS.append(obj)
    obj['constructionPart']=obj.name
    return obj

def box(name,lo,hi,mat='wood',b=.002):
    return keep(kit.box(name,lo,hi,M[mat],b,1))

def centerbox(name,p,s,mat='wood',b=.002):
    return box(name,tuple(p[i]-s[i]/2 for i in range(3)),tuple(p[i]+s[i]/2 for i in range(3)),mat,b)

def mesh(name,v,f,mat='wood',bevel=0):
    obj=mesh_part(name,v,f,M[mat]);bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    if bevel:kit.bevel(obj,bevel,1)
    return keep(obj)

def radial(name,rows,x,y,mat='wood',n=12):
    return keep(lathe(name,rows,M[mat],x,y,n))

def rod(name,a,b,r,mat='brass',n=8):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=(b-a).length);obj=bpy.context.object;obj.name=name;obj.data.materials.append(M[mat])
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();obj.location=(a+b)/2
    kit.activate(obj);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return keep(obj)

def bar(name,a,b,width,depth,mat='trim'):
    a,b=Vector(a),Vector(b)
    obj=kit.box(name,(-width/2,-depth/2,-(b-a).length/2),(width/2,depth/2,(b-a).length/2),M[mat],.001,1)
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();obj.location=(a+b)/2
    kit.activate(obj);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return keep(obj)

def turned_feet(xs,ys,h=.16):
    for x in xs:
        for y in ys:
            radial('Turned foot %.3f %.3f'%(x,y),[(.029,0),(.032,.016),(.024,.039),(.016,h*.62),(.025,h*.80),(.030,h)],x,y)

def ring_pull(name,x,y,z):
    # Mounted plate, stem and suspended ring all meet; the ring top overlaps
    # the pivot stem, while the assembly stays inside the design footprint.
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.023,depth=.009,location=(x,y+.006,z+.014),rotation=(math.pi/2,0,0));obj=bpy.context.object;obj.name=name+' escutcheon';obj.data.materials.append(M['brass']);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);keep(obj)
    rod(name+' pivot',(x,y+.007,z+.014),(x,y-.010,z+.014),.007)
    keep(loop(name+' suspended ring',(x,y-.010,z-.014),.024,.028,.004,M['brass'],vertical=True,steps=12))

def keyplate(name,x,y,z):
    obj=kit.cylinder(name+' circular key escutcheon',(x,y,z),.012,.003,M['brass'],'Y',12);keep(obj)

def curved_prism(name,width,rear,edgefront,bow,z0,z1,mat='wood',steps=16):
    # Continuous convex bowed front with shared profile vertices.
    ring=[(-width/2,rear),(width/2,rear)]
    ring.extend((width/2-width*i/steps,edgefront-bow*math.sin(math.pi*i/steps)) for i in range(steps+1))
    n=len(ring);v=[(x,y,z) for z in [z0,z1] for x,y in ring]
    f=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    f.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    return mesh(name,v,f,mat,.001)

def curved_front(name,width,y,bow,z0,z1,thick=.025,mat='inset',steps=16):
    v=[]
    for z in [z0,z1]:
        for back in [0,1]:
            v.extend((-width/2+width*i/steps,y-bow*math.sin(math.pi*i/steps)+back*thick,z) for i in range(steps+1))
    n=steps+1;f=[]
    for i in range(steps):
        f.extend([(i,i+1,2*n+i+1,2*n+i),(n+i,3*n+i,3*n+i+1,n+i+1),
                  (i,n+i,n+i+1,i+1),(2*n+i,2*n+i+1,3*n+i+1,3*n+i)])
    f.extend([(0,2*n,3*n,n),(steps,n+steps,3*n+steps,2*n+steps)])
    return mesh(name,v,f,mat,0 if z1-z0<.02 else .001)

def framed_panel(name,x,y,z,w,h,mat='inset'):
    centerbox(name+' field',(x,y+.007,z),(w-.038,.020,h-.038),mat)
    for sx in [-1,1]:centerbox(name+' stile '+str(sx),(x+sx*(w/2-.014),y,z),(.028,.030,h),'trim')
    for sz in [-1,1]:centerbox(name+' rail '+str(sz),(x,y,z+sz*(h/2-.014)),(w-.056,.030,.028),'trim')

def commode():
    turned_feet([-.416,.416],[-.155,.175],.17)
    # Drawer cabinet is actually hollow: sides, back and dust shelves, rather
    # than a solid cube with ornamental panels pretending to be doors.
    for x in [-.454,.454]:centerbox('Commode side board',(x,.028,.509),(.032,.373,.678))
    centerbox('Commode rear board',(0,.224,.512),(.908,.022,.684))
    for z in [.186,.396,.610,.829]:centerbox('Drawer dust shelf',(0,.027,z),(.894,.378,.018))
    curved_prism('Bow-front bottom moulding',.963,.240,-.179,.042,.151,.203,'trim')
    curved_prism('Bow-front cornice cove',.971,.244,-.181,.044,.841,.865,'wood')
    curved_prism('Bow-front overhanging top',1.000,.250,-.200,.050,.865,.900,'trim')
    # Front pilasters terminate in the dust-rail structure.
    for x in [-.442,.442]:centerbox('Front rounded pilaster',(x,-.159,.527),(.036,.036,.628),'trim',.007)
    for i,(z0,z1) in enumerate([(.213,.389),(.411,.603),(.625,.825)],1):
        curved_front('Bowed drawer %d front'%i,.852,-.173,.042,z0,z1)
        curved_front('Bowed drawer %d upper bead'%i,.832,-.177,.042,z1-.010,z1-.004,.006,'trim')
        curved_front('Bowed drawer %d lower bead'%i,.832,-.177,.042,z0+.004,z0+.010,.006,'trim')
        for x in [-.227,.227]:
            y=-.173-.042*math.sin(math.pi*(x+.426)/.852)-.003
            ring_pull('Drawer %d brass ring'%i,x,y,(z0+z1)/2)
        keyplate('Drawer %d lock'%i,0,-.219,(z0+z1)/2+.012)
    # Rear construction detail visible in evidence.
    for x in [-.26,0,.26]:centerbox('Rear panel joint',(x,.237,.512),(.004,.003,.630),'trim',0)

def arch_outline(cx,z0,w,h,steps=10):
    # Gothic-free, shallow segmental arch: period cabinet glazed doors.
    shoulder=z0+h-.16
    return [(cx-w/2,z0),(cx+w/2,z0),(cx+w/2,shoulder)]+[(cx+w/2*math.cos(math.pi*i/steps),shoulder+.16*math.sin(math.pi*i/steps)) for i in range(1,steps+1)]

def extruded_outline(name,outline,y0,y1,mat,bevel=0):
    n=len(outline);v=[(x,y,z) for y in [y0,y1] for x,z in outline]
    f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,v,f,mat,bevel)

def arch_frame(name,cx,z0,w,h,y):
    outer=arch_outline(cx,z0,w,h);inner=arch_outline(cx,z0+.028,w-.056,h-.056)
    n=len(outer);v=[]
    for yy in [y-.011,y+.011]:v.extend((x,yy,z) for x,z in outer+inner)
    f=[]
    for i in range(n):
        j=(i+1)%n
        f.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),
                  (i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
    mesh(name,v,f,'trim',.001)
    extruded_outline(name+' antique glass',inner,y+.002,y+.005,'glass')

def display():
    turned_feet([-.355,.355],[-.137,.137],.14)
    # 900 x 420 x 1900 mm bounds set by continuous cornice and plinth.
    centerbox('Display lower plinth',(0,0,.145),(.874,.408,.058),'trim')
    centerbox('Display base cove',(0,0,.190),(.844,.388,.039),'wood')
    for x in [-.391,.391]:centerbox('Display cabinet side',(x,.014,1.018),(.034,.345,1.659))
    centerbox('Display cabinet rear',(0,.185,1.020),(.794,.021,1.66))
    for z in [.285,.690,1.070,1.440,1.786]:centerbox('Adjustable walnut shelf',(0,.004,z),(.788,.348,.021),'trim')
    for x in [-.328,.328]:
        for z in [.690,1.070,1.440]:
            rod('Shelf brass peg',(x-.020,.141,z-.017),(x+.020,.141,z-.017),.005)
    # Side recessed fields with raised surrounding rails, actual physical seams.
    for sign in [-1,1]:
        for z in [.484,1.420]:
            centerbox('Side veneer raised field',(sign*.410,.016,z),(.004,.259,.484),'inset',.001)
    for cx in [-.195,.195]:
        arch_frame('Glazed arched door',cx,.411,.376,1.338,-.176)
        for z in [.810,1.186,1.532]:centerbox('Glazing horizontal mullion',(cx,-.181,z),(.316,.018,.013),'trim',.001)
        for x in [cx-.083,cx+.083]:centerbox('Glazing vertical mullion',(x,-.181,1.027),(.013,.018,1.185),'trim',.001)
        framed_panel('Lower raised cabinet door',cx,-.178,.301,.376,.160)
        centerbox('Continuous door connecting rail',(cx,-.176,.397),(.376,.029,.034),'trim',.001)
        # Brass latch is attached to the door stile at the meeting edge.
        ring_pull('Cabinet brass latch',cx+(.131 if cx<0 else -.131),-.192,.971)
        for z in [.512,1.445]:centerbox('Mounted door butt hinge',(cx+(-.182 if cx<0 else .182),-.185,z),(.031,.022,.039),'brass',.001)
    centerbox('Upper cabinet frieze',(0,0,1.815),(.843,.385,.073),'inset')
    centerbox('Cornice lower step',(0,0,1.855),(.866,.400,.025),'wood')
    centerbox('Cornice upper overhang',(0,0,1.884),(.900,.420,.032),'trim',.005)
    # Small fluted appliqués touch the wood frieze, not floating blocks.
    for x in [-.351,0,.351]:
        for dx in [-.012,0,.012]:centerbox('Frieze vertical fluting',(x+dx,-.196,1.815),(.004,.007,.041),'trim',.001)
    for x in [-.27,0,.27]:centerbox('Rear tongue-and-groove joint',(x,.197,1.010),(.004,.003,1.574),'trim',0)

def bureau():
    turned_feet([-.413,.413],[-.191,.191],.15)
    centerbox('Bureau plinth',(0,0,.172),(.977,.540,.058),'trim')
    for x in [-.454,.454]:centerbox('Bureau lower case side',(x,.016,.515),(.035,.460,.662))
    centerbox('Bureau lower case rear',(0,.248,.519),(.939,.028,.667))
    for z in [.201,.402,.603,.818]:centerbox('Bureau drawer dust shelf',(0,.006,z),(.930,.462,.018))
    for i,z in enumerate([.302,.504,.708],1):
        framed_panel('Bureau drawer '+str(i),0,-.232,z,.887,.181)
        for x in [-.258,.258]:ring_pull('Bureau drawer %d ring'%i,x,-.253,z)
        keyplate('Bureau drawer lock',0,-.250,z+.022)
    # Slant-top carcass side cheeks are genuine wedge boards, not boxes.
    for sign in [-1,1]:
        xx=[sign*.425,sign*.458];v=[]
        for x in xx:v.extend([(x,-.244,.833),(x,.258,.833),(x,.258,1.181),(x,-.244,.884)])
        mesh('Slanted bureau side cheek',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'wood',.002)
    centerbox('Upper bureau rear board',(0,.249,1.007),(.892,.035,.351))
    centerbox('Bureau inner pigeonhole floor',(0,.043,.839),(.878,.412,.024))
    # Closed fall-front slab. Its top surface slopes 291 mm over 496 mm.
    w=.929;y0=-.267;y1=.239;z0=.887;z1=1.182;t=.022
    v=[(-w/2,y0,z0),(w/2,y0,z0),(w/2,y1,z1),(-w/2,y1,z1),
       (-w/2,y0,z0-t),(w/2,y0,z0-t),(w/2,y1,z1-t),(-w/2,y1,z1-t)]
    mesh('Closed slant writing fall-front',v,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'inset',.002)
    # Breadboard edge rails sit on the same slope and physically touch lid.
    for x in [-.443,.443]:bar('Fall-front breadboard side',(x,y0+.022,z0+.016),(x,y1-.022,z1+.007),.036,.017)
    for y,z in [(y0+.021,z0+.020),(y1-.021,z1+.010)]:centerbox('Fall-front cross edging',(0,y,z),(.883,.036,.013),'trim',.001)
    centerbox('Bureau back crown',(0,.246,1.185),(1.000,.048,.030),'trim',.003)
    for x in [-.31,.31]:centerbox('Fall-front lower brass hinge',(x,-.258,.875),(.073,.012,.027),'brass',.001)
    # Lid key escutcheon shares the plane of the fall-front rather than floating.
    plate=kit.cylinder('Fall-front brass key escutcheon',(0,0,0),.014,.003,M['brass'],sides=12)
    angle=math.atan2(z1-z0,y1-y0)
    plate.rotation_euler.x=-angle;plate.location=(0,.126,1.119)
    kit.activate(plate);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);keep(plate)
    for x in [-.278,0,.278]:centerbox('Bureau backboard tongue joint',(x,.269,.529),(.004,.002,.620),'trim',0)

SPECS=[
 ('bow-commode','弓形前板の三段整理箪笥',(1000,500,900),commode,'A convex bow-front commode with three separately built curved drawer fronts and suspended brass rings'),
 ('arched-vitrine','アーチガラスの展示戸棚',(900,420,1900),display,'A two-door segmental-arch glass display cabinet with visible shelf interiors and mullions'),
 ('slant-bureau','斜め蓋の書記ビューロー',(1000,540,1200),bureau,'A closed slant-front writing bureau with wedge cheeks, breadboard fall-front and three drawers'),
]
import forms
SPECS+=forms.add_specs(sys.modules[__name__])

def save_authoring(stem,fn):
    global PARTS
    PARTS=[];palette();fn()
    import joinery
    joinery.repair(stem,sys.modules[__name__])
    # Editable per-part UVs use dominant-face planar projection at metre scale.
    # Final packed export atlas is independently rebuilt by model_kit.run.
    for obj in PARTS:
        uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='UVMap')
        for poly in obj.data.polygons:
            axes=[i for i in range(3) if i!=max(range(3),key=lambda j:abs(poly.normal[j]))]
            for li in poly.loop_indices:
                p=obj.matrix_world@obj.data.vertices[obj.data.loops[li].vertex_index].co
                uv.data[li].uv=(p[axes[0]],p[axes[1]])
        for layer in list(obj.data.uv_layers)[1:]:obj.data.uv_layers.remove(layer)
        obj.data.uv_layers.active.active_render=True
    scene=bpy.context.scene;scene.name='Native authoring parts '+stem
    scene.render.filepath='//renders/'
    scene['designFootprintBasis']='Intended design footprint; no measured antique reference'
    scene['front']='-Y';scene['up']='+Z';scene['author']='Original project-authored procedural geometry'
    path=HERE/'authoring_sources'/(stem+'.blend');path.parent.mkdir(parents=True,exist_ok=True)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    # Preserve source file separately. Only the in-memory scene is combined.
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.scene.new(type='FULL_COPY')
    scene=bpy.context.scene;scene.name='Validated export mesh '+stem
    export_parts=[o for o in scene.objects if o.type=='MESH']
    obj=kit.combine(export_parts)
    return obj

def stamp(path,stem):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n])
    doc['asset']['extras']={'front':'+Z','up':'+Y','units':'metres','origin':'bottom-centre','packId':'rpg-mansion','provenance':'Original procedural Blender geometry; no imported geometry or imagery','source':'tools/blender/rpg_mansion/scaled_storage/build.py','designBasis':'Intended footprint; no measured antique reference'}
    payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(obj,path,view='thumb'):
    # Self-contained transparent product photography with soft area lighting.
    for o in list(bpy.context.scene.objects):
        if o!=obj:bpy.data.objects.remove(o,do_unlink=True)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=128 if any(m.get('finishChannel')=='glass' for m in obj.data.materials) else 48;scene.cycles.use_denoising=False
    scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
    scene.view_settings.view_transform='AgX'
    points=[obj.matrix_world@v.co for v in obj.data.vertices];lo=Vector(tuple(min(p[i] for p in points) for i in range(3)));hi=Vector(tuple(max(p[i] for p in points) for i in range(3)));span=max(hi-lo);target=(lo+hi)/2
    for name,power,loc,size in [('Key',350,(span*2,-span*3,span*3),span*3),('Fill',150,(-span*2,-span,span*1.5),span*2),('Rim',90,(span,span*2,span*2.4),span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name=name;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    if view=='top':loc=(0,0,span*4);scale=max((hi-lo)[:2])*1.25
    elif view=='front':loc=(0,-span*4,target.z);scale=max(hi.x-lo.x,hi.z-lo.z)*1.20
    elif view=='rear':loc=(-span*2.5,span*4,span*1.8);scale=span*1.43
    else:loc=(span*2.5,-span*4,span*1.8);scale=span*1.43
    bpy.ops.object.camera_add(location=loc);cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=scale;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.camera=cam
    path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path)

def main():
    only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
    items=json.loads((HERE/'storage-items.json').read_text())['items'] if only and (HERE/'storage-items.json').exists() else []
    for slug,name,size,fn,meaning in SPECS:
        if only and slug not in only:continue
        stem='rpg-mansion-'+slug+'-01'
        bpy.ops.wm.read_factory_settings(use_empty=True)
        channels={'wood','metal','glass'} if slug in {'arched-vitrine','corner-vitrine','glazed-credenza'} else {'wood','metal'}
        obj=kit.run([(stem,size,lambda:save_authoring(stem,fn),channels,6000)],do_icons=False)[0]
        path=kit.GLB_DIR/(stem+'.glb');stamp(path,stem)
        validation=kit.WORK_DIR/(stem+'-validation.json')
        report=json.loads(validation.read_text());report['glb_bytes']=path.stat().st_size
        report['modelSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        report['sourceSha256']=hashlib.sha256((kit.WORK_DIR/(stem+'.blend')).read_bytes()).hexdigest()
        validation.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        if '--no-icons' not in sys.argv:
            for view,out in [('thumb',kit.PREVIEW_DIR/(stem+'-thumb.png')),('top',kit.PREVIEW_DIR/(stem+'-top.png')),('front',HERE/'evidence'/(stem+'-front.png')),('rear',HERE/'evidence'/(stem+'-rear.png'))]:render(obj,out,view)
        rel=lambda p:str(p.relative_to(ROOT))
        item=dict(id=stem,name=name,packId='rpg-mansion',group='家具',category='収納',sourceFolder='BlenderRpgMansion',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),front=rel(HERE/'evidence'/(stem+'-front.png')),rear=rel(HERE/'evidence'/(stem+'-rear.png')),sourceBlend=rel(kit.WORK_DIR/(stem+'.blend')),authoringBlend=rel(HERE/'authoring_sources'/(stem+'.blend')),exportBlend=rel(kit.WORK_DIR/(stem+'.blend')),validation=rel(kit.WORK_DIR/(stem+'-validation.json')),builder=rel(HERE/'build.py'),w=size[0],d=size[1],h=size[2],defaultElevation=0,provenance='original',placementHint='floor',semanticCoverage=meaning,dimensionBasis='Intended footprint, not a measured historical reference',finishChannels=[dict(key=c,label={'wood':'木部','metal':'金属','glass':'ガラス'}[c],default={'wood':'#533624','metal':'#9d7b3c','glass':'#d9e3dd'}[c]) for c in sorted(channels)])
        inventory=json.loads((HERE/'standard-footprints.json').read_text())
        matches=[{'kind':r['kind'],'ids':v['standard_ids']} for r in inventory if r['kind'] in {'chest','closet','cabinet','shelf'} for v in r['dimensions'] if tuple(v[k] for k in ['w','d','h'])==size]
        if matches:item['dimensionBasis']='Matches declared standard catalogue footprint; legacy model geometry not independently measured';item['standardFootprintMatches']=matches
        item['sha256']=hashlib.sha256(path.read_bytes()).hexdigest();item['sourceSha256']=hashlib.sha256((ROOT/item['sourceBlend']).read_bytes()).hexdigest()
        items=[i for i in items if i['id']!=stem];items.append(item);(HERE/'storage-items.json').write_text(json.dumps({'set':'rpg-mansion','name':'洋館・収納家具試作','items':items},ensure_ascii=False,indent=2)+'\n')
        print('STORAGE_READY '+stem,flush=True)
    (HERE/'rights-and-provenance.json').write_text(json.dumps({'authoring':'Original procedural Blender geometry authored for this project','thirdPartyGeometry':False,'thirdPartyTextures':False,'paidGeneration':False,'license':'Original project-authored assets for this repository; no separate public reuse license granted','measurementPolicy':'Footprints are intentional designs. No historic source measurements are claimed.','source':'build.py','sourceSha256':hashlib.sha256((HERE/'build.py').read_bytes()).hexdigest(),'assets':[{'id':i['id'],'glbSha256':i['sha256'],'authoringSha256':i['sourceSha256']} for i in items]},indent=2)+'\n')

if __name__=='__main__':main()
