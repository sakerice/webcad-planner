"""Four original closed mansion windows; Blender CLI only, no app registration."""
from pathlib import Path
import sys, math, json, struct, hashlib
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / 'tools/blender'))
import bpy, bmesh
from mathutils import Vector
import model_kit as kit

PACK = ROOT / 'assets/models/packs/rpg-mansion'
SPECS = [
    ('rpg-mansion-sash-window-01', '上げ下げ窓', (900,150,1400), 'sash'),
    ('rpg-mansion-casement-window-01', '両開きの開き窓', (1200,150,1200), 'casement'),
    ('rpg-mansion-french-window-01', '縦長のフランス窓', (1600,150,2200), 'french'),
    ('rpg-mansion-arched-fixed-window-01', '飾り格子のはめ殺し窓', (900,150,1200), 'arched'),
]
M = {}; PARTS = []

def box(name, lo, hi, mat='paint', radius=.001):
    ob = kit.box(name,lo,hi,M[mat],radius,1)
    ob['constructionPart'] = name
    PARTS.append(ob)
    return ob

def cylinder(name, pos, radius, depth, axis='Y'):
    ob = kit.cylinder(name,pos,radius,depth,M['metal'],axis,12)
    ob['constructionPart'] = name; PARTS.append(ob)
    return ob

def material_setup():
    M.clear()
    for key,name,color,rough,metal,channel in [
        ('paint','Painted timber','#f4f1e9',.48,0,'paint'),
        ('metal','Brass hardware','#b69752',.28,.76,'metal'),
        ('stone','Limestone sill','#cec6b5',.85,0,None),
        ('glass','Glass','#dfe8ea',.12,0,None),
    ]:
        m=kit.matp(name,color,rough,metal);m.use_backface_culling=True
        if channel:m['finishChannel']=channel
        if key=='glass':
            bs=m.node_tree.nodes.get('Principled BSDF')
            bs.inputs['Alpha'].default_value=.25
            m.diffuse_color=(*bs.inputs['Base Color'].default_value[:3],.25)
            m.surface_render_method='DITHERED'
        M[key]=m

def outer_frame(w,h):
    # The actual envelope is exactly ±w/2, ±75mm depth, bottom z=0.
    box('stone sill core',(-w/2,-.066,0),(w/2,.075,.045),'stone',.002)
    box('stone sloping drip edge',(-w/2,-.075,.033),(w/2,-.047,.057),'stone',.001)
    for side,x0,x1 in [('left',-w/2,-w/2+.072),('right',w/2-.072,w/2)]:
        box(side+' deep jamb',(x0,-.022,.045),(x1,.075,h),'paint',.0015)
        box(side+' exterior casing',(x0,-.052,.057),(x1,-.020,h),'paint',.0015)
        xi=x1-.013 if side=='left' else x0
        box(side+' raised inner bead',(xi,-.059,.065),(xi+.013,-.047,h-.008),'paint',.001)
    box('head deep frame',(-w/2+.07,-.022,h-.074),(w/2-.07,.075,h),'paint',.0015)
    box('head exterior casing',(-w/2+.07,-.052,h-.074),(w/2-.07,-.020,h),'paint',.0015)
    box('head raised bead',(-w/2+.073,-.059,h-.074),(w/2-.073,-.047,h-.061))
    box('bottom timber rail',(-w/2+.072,-.032,.045),(w/2-.072,.070,.091),'paint',.0015)
    # Interior stops close the rebate while preserving the recessed glass.
    for x in [-w/2+.066,w/2-.080]:
        box('interior rebate stop',(x,.059,.065),(x+.014,.075,h-.066))
    box('interior head stop',(-w/2+.073,.059,h-.080),(w/2-.073,.075,h-.066))

def sash(name,x0,x1,z0,z1,y0,columns,rows,kick=0):
    t=.036; y1=y0+.038
    for side,a,b in [('left',x0,x0+t),('right',x1-t,x1)]:
        box(name+' '+side+' stile',(a,y0,z0),(b,y1,z1),'paint',.0015)
    for label,a,b in [('bottom',z0,z0+t+kick),('top',z1-t,z1)]:
        box(name+' '+label+' rail',(x0+t-.001,y0,a),(x1-t+.001,y1,b),'paint',.0015)
    ax,bx=x0+t,x1-t; az,bz=z0+t+kick,z1-t
    # One shallow, closed glass slab per light field. Internal bars bed into it.
    box(name+' glass',(ax-.001,y0+.018,az-.001),(bx+.001,y0+.022,bz+.001),'glass',0)
    for i in range(1,columns):
        x=ax+(bx-ax)*i/columns
        box(name+' vertical glazing bar '+str(i),(x-.010,y0+.009,az),(x+.010,y0+.031,bz),'paint',.0008)
    for i in range(1,rows):
        z=az+(bz-az)*i/rows
        box(name+' horizontal glazing bar '+str(i),(ax,y0+.007,z-.009),(bx,y0+.033,z+.009),'paint',.0008)
    # Fine raised glazing beads on both sides, not a painted texture.
    for face in [y0-.003,y1-.003]:
        for a,b in [(ax-.006,ax+.003),(bx-.003,bx+.006)]:
            box(name+' vertical bead',(a,face,az-.004),(b,face+.006,bz+.004),'paint',.0005)
        for a,b in [(az-.006,az+.003),(bz-.003,bz+.006)]:
            box(name+' horizontal bead',(ax,face,a),(bx,face+.006,b),'paint',.0005)
    if kick:
        # A low solid timber panel, recessed and framed on both faces.
        box(name+' recessed low panel',(ax,y0+.007,z0+.036),(bx,y1-.007,az),'paint',.001)
        for face in [y0-.002,y1-.002]:
            for z in [z0+.054,az-.019]:
                box(name+' low panel moulding',(ax+.012,face,z),(bx-.012,face+.006,z+.009),'paint',.0005)
    return y1

def handle(name,x,z,face):
    box(name+' brass backplate',(x-.013,face,z-.050),(x+.013,face+.005,z+.050),'metal',.002)
    cylinder(name+' upper fixing',(x,face+.006,z+.034),.003,.002)
    cylinder(name+' lower fixing',(x,face+.006,z-.034),.003,.002)
    cylinder(name+' spindle',(x,face+.017,z),.006,.025)
    box(name+' lever',(x-.008,face+.023,z-.009),(x+.048,face+.033,z+.009),'metal',.003)

def hinges(x,zs,face):
    for i,z in enumerate(zs):
        box('hinge '+str(i)+' leaf',(x-.018,face-.005,z-.029),(x+.018,face+.002,z+.029),'metal',.001)
        cylinder('hinge '+str(i)+' knuckle',(x,face+.006,z),.007,.062,'Z')

def band(name,points,width,y0,y1):
    # Solid rectangular cross section swept along the fanlight arc.
    vs=[]
    for j,p in enumerate(points):
        tangent=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])
        normal=Vector((-tangent.y,tangent.x)).normalized()*width/2
        x,z=p
        vs.extend([(x+normal.x,y0,z+normal.y),(x-normal.x,y0,z-normal.y),
                   (x-normal.x,y1,z-normal.y),(x+normal.x,y1,z+normal.y)])
    fs=[(3,2,1,0)]
    for j in range(len(points)-1):
        for k in range(4):fs.append((j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k))
    fs.append(tuple((len(points)-1)*4+k for k in range(4)))
    me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();me.materials.append(M['paint'])
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    ob['constructionPart']=name;PARTS.append(ob)


def build_one(stem,size,kind):
    PARTS.clear(); material_setup()
    w,d,h=[v/1000 for v in size]; outer_frame(w,h)
    x0,x1=-w/2+.079,w/2-.079;z0,z1=.092,h-.080
    if kind=='sash':
        mid=(z0+z1)/2
        sash('upper sliding sash',x0,x1,mid-.018,z1,-.035,3,2)
        sash('lower sliding sash',x0,x1,z0,mid+.018,.006,3,2)
        # Interior-accessible crescent lock on meeting rails; separate keeper.
        box('crescent lock base',(-.030,.042,mid-.027),(.030,.055,mid-.003),'metal',.003)
        cylinder('crescent lock pivot',(0,.058,mid-.015),.010,.011)
        box('crescent lock turning arm',(-.004,.059,mid-.021),(.040,.067,mid-.009),'metal',.003)
        box('crescent lock keeper',(.026,.035,mid+.005),(.048,.052,mid+.024),'metal',.002)
        for x in [-w*.25,w*.25]:
            box('lower sash lifting lip',(x-.027,.045,.123),(x+.027,.059,.137),'metal',.002)
    elif kind in ['casement','french']:
        top=z1 if kind=='casement' else h-.340
        kick=.125 if kind=='french' else 0
        for side,a,b in [('left',x0,-.003),('right',.003,x1)]:
            sash(side+' hinged leaf',a,b,z0,top,-.029,2,4 if kind=='casement' else 5,kick)
            hinges(a+.018 if side=='left' else b-.018,[z0+.20,top-.20],.013)
            handle(side+' interior handle',-.041 if side=='left' else .041,(z0+top)/2,.011)
        box('centre weather astragal',(-.012,-.044,z0),(.012,-.026,top),'paint',.001)
        if kind=='french':
            box('transom structural rail',(x0,-.033,top),(x1,.051,top+.045),'paint',.0015)
            sash('horizontal glazed transom',x0,x1,top+.046,z1,-.020,2,1)
    else:
        sash('fixed glazed light',x0,x1,z0,z1,-.029,1,1)
        radius=(x1-x0)/2-.043; cz=z1-.045-radius
        box('fanlight spring rail',(x0+.036,-.025,cz-.011),(x1-.036,.004,cz+.011),'paint',.001)
        pts=[(radius*math.cos(math.pi*i/32),cz+radius*math.sin(math.pi*i/32))for i in range(33)]
        band('semicircular fanlight moulding',pts,.021,-.026,.001)
        for i in range(1,6):
            angle=math.pi*i/6
            end=(radius*math.cos(angle),cz+radius*math.sin(angle))
            band('radial fanlight bar '+str(i),[(0,cz),end],.014,-.030,.005)
        cylinder('fanlight central brass rosette',(0,-.033,cz),.018,.010)
        for x in [-radius/3,radius/3]:
            box('lower fixed vertical bar',(x-.009,-.025,z0+.036),(x+.009,.000,cz-.011),'paint',.0008)
        for i in [1,2]:
            zz=z0+.036+(cz-.011-z0-.036)*i/3
            box('lower fixed horizontal bar',(x0+.036,-.027,zz-.009),(x1-.036,.002,zz+.009),'paint',.0008)
        # Fixed-light screws are metal and do not imply an operable sash.
        for x in [x0+.018,x1-.018]:
            for z in [z0+.10,z1-.10]:cylinder('fixed light brass screw',(x,.012,z),.003,.002)
    sc=bpy.context.scene;sc['assetId']=stem;sc['front']='Blender -Y = glTF +Z';sc['origin']='bottom-centre';sc['provenance']='Original procedural Blender geometry; no external sources'
    for ob in PARTS:
        bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'authoring_sources'/(stem+'.blend')),compress=True)
    ob=kit.combine(PARTS);ob['assetId']=stem;ob['front']='+Z';ob['staticClosedWindow']=True
    return ob

def stamp(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+n])
    g['asset']['extras']={'units':'metres','front':'+Z','up':'+Y','origin':'bottom-centre','provenance':'Original procedural Blender geometry; no external sources','staticClosedWindow':True}
    b=json.dumps(g,separators=(',',':')).encode();b+=b' '*(-len(b)%4);tail=raw[20+n:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(b)+len(tail))+struct.pack('<II',len(b),0x4e4f534a)+b+tail)

def build_all():
    kit.GLB_DIR=PACK/'models';kit.WORK_DIR=HERE/'sources'
    rows=[]
    for stem,name,size,kind in SPECS:
        kit.run([(stem,size,lambda:build_one(stem,size,kind),{'paint','metal'},8000)],do_export=True,do_icons=False)
        vp=HERE/'sources'/(stem+'-validation.json');report=json.loads(vp.read_text())
        assert report['uv']['excluded_triangles']==0,report['uv']
        stamp(PACK/'models'/(stem+'.glb'))
        rows.append({'id':stem,'name':name,'dimensions_mm':report['dimensions_mm'],'triangles':report['triangles'],'triangleBudget':8000,'materials':{'Painted timber':{'finishChannel':'paint','color':'#f4f1e9'},'Brass hardware':{'finishChannel':'metal','color':'#b69752'},'Limestone sill':{'color':'#cec6b5'},'Glass':{'color':'#dfe8ea','alpha':.25,'alphaMode':'BLEND','finishChannel':None}},'provenance':'original','externalGeometry':False,'externalImages':False,'rightsBasis':'Original Blender geometry authored for this project; no external asset attribution required','appRegistration':'Claude integration follow-up; manifest unchanged'})
    (HERE/'reports/asset-ledger.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False)+'\n')

if __name__=='__main__':
    build_all()
