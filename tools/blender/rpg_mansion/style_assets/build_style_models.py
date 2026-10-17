"""Original mansion style models. Blender 4.3+, Python Pillow. No external assets.
Run: blender -b --factory-startup --python tools/blender/rpg_mansion/style_assets/build_style_models.py
Coordinates authored Blender X/right,-Y/front,Z/up and exported glTF X/right,+Z/front,+Y/up.
All geometry is normalized to specified metric bounds, origin at bottom centre.
"""
import bpy, math, random, json, os, sys, tempfile
from pathlib import Path
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parent
MODELS=ROOT/'assets/models/packs/rpg-mansion/models'
PREV=ROOT/'assets/models/packs/rpg-mansion/previews'
for p in (OUT,MODELS,PREV): p.mkdir(parents=True,exist_ok=True)
SEED=20261010
SPECS=[('rpg-mansion-landscape-painting-1000-01','金縁の横長の額絵 1000',(1,.06,.7),'forest'),('rpg-mansion-landscape-painting-1400-01','金縁の横長の額絵 1400',(1.4,.07,.9),'sea'),('rpg-mansion-landscape-painting-1800-01','金縁の横長の額絵 1800',(1.8,.08,1.1),'garden'),('rpg-mansion-wicker-laundry-basket-01','籐の洗濯カゴ',(.6,.45,.6),'basket'),('rpg-mansion-lidded-laundry-box-01','蓋付きの木製ランドリーボックス',(.6,.5,.85),'box')]

def painting(kind,path):
    """Seeded painted landscape with atmospheric layers and original brushwork."""
    r=random.Random(SEED+{'forest':1,'sea':2,'garden':3}[kind]); W,H=1024,680
    im=Image.new('RGB',(W,H)); pix=im.load()
    top,bottom={'forest':((76,95,115),(184,180,148)),'sea':((92,92,122),(235,180,116)),'garden':((117,139,151),(207,198,165))}[kind]
    for y in range(H):
        t=min(1,y/(H*.69)); col=tuple(int(a*(1-t)+b*t) for a,b in zip(top,bottom))
        for x in range(W): pix[x,y]=col
    d=ImageDraw.Draw(im,'RGBA')
    # Loose, horizontal oil-brush clouds.
    for i in range(600):
        x=r.randrange(-100,W); y=r.randrange(20,int(H*.48)); length=r.randrange(20,120); h=r.randrange(2,12)
        c=(221,218,193,r.randrange(7,30)) if kind!='sea' else (244,187,143,r.randrange(8,35))
        d.ellipse((x,y,x+length,y+h),fill=c)
    if kind=='forest':
        for j in range(5):
            by=330+j*42; pts=[(-20,H),(-20,by)]+[(x,by+25*math.sin(x/145+j)+r.randrange(-10,10)) for x in range(0,W+30,25)]+[(W+20,H)]
            c=[(102,119,111),(76,100,90),(53,78,65),(37,61,43),(27,48,33)][j]
            d.polygon(pts,fill=(*c,255))
        d.polygon([(0,680),(310,560),(610,459),(710,440),(674,500),(551,559),(430,680)],fill=(150,160,135,255))
        for i in range(400):
            y=r.randrange(468,H); x=int(685-(y-465)*1.2+r.gauss(0,(y-440)*.30))
            d.line((x,y,x+r.randrange(7,50),y),fill=(196,192,156,r.randrange(35,110)),width=r.randrange(1,4))
        def tree(x,y,s):
            d.line((x,y,x+4*s,y-170*s),fill=(47,40,31,255),width=max(2,int(10*s)))
            for k in range(45):
                dx=r.gauss(0,42*s); dy=r.gauss(0,38*s); a=r.randrange(13,33)*s
                c=r.choice([(35,52,36),(46,66,41),(64,80,47),(80,93,56)])
                d.ellipse((x+dx-a,y-150*s+dy-a*.7,x+dx+a,y-150*s+dy+a*.7),fill=(*c,240))
            for sign in (-1,1): d.line((x,y-80*s,x+sign*45*s,y-155*s),fill=(55,45,32,220),width=max(1,int(5*s)))
        for x in range(0,1024,24): tree(x,485+r.randrange(35),r.uniform(.3,.6))
        tree(128,683,2.0); tree(929,676,1.72)
        for i in range(2200):
            x,y=r.randrange(W),r.randrange(490,H); c=r.choice([(89,91,49),(62,78,39),(115,109,58),(145,133,73)])
            d.line((x,y,x+r.randrange(2,12),y-r.randrange(1,6)),fill=(*c,r.randrange(50,150)),width=2)
    elif kind=='sea':
        d.ellipse((657,290,717,350),fill=(252,223,165,255))
        d.polygon([(0,371),(1024,371),(1024,680),(0,680)],fill=(86,112,125,255))
        # Coastal headland and distant haze.
        d.polygon([(0,365),(155,333),(256,347),(366,379),(0,418)],fill=(83,88,93,255))
        for i in range(2400):
            y=r.randrange(383,H); x=r.randrange(W); bright=abs(x-686)<(y-310)*.23 and r.random()<.65
            c=(238,188,128) if bright else r.choice([(149,161,160),(93,127,136),(192,188,165)])
            d.line((x,y,x+r.randrange(4,45),y),fill=(*c,r.randrange(28,140)),width=r.randrange(1,4))
        d.polygon([(0,546),(196,518),(351,537),(426,589),(643,636),(1024,676),(1024,680),(0,680)],fill=(137,129,107,255))
        for i in range(1300):
            x=r.randrange(W); y=r.randrange(540,H); threshold=543+x*.125
            if y>threshold: d.line((x,y,x+r.randrange(3,18),y-2),fill=(r.randrange(115,185),r.randrange(105,165),r.randrange(85,130),130),width=2)
        # White surf with broken brush edges.
        for i in range(180):
            x=i*6; y=531+x*.136+math.sin(x/46)*8
            d.line((x,y,x+12,y+2),fill=(214,209,184,185),width=r.randrange(2,7))
        for x,y,s in [(40,579,1.1),(207,567,.7),(354,636,.85),(828,650,.5)]:
            d.polygon([(x,y),(x+40*s,y-28*s),(x+93*s,y-10*s),(x+101*s,y+25*s),(x-7*s,y+17*s)],fill=(61,69,72,255))
            d.line((x+8*s,y,x+44*s,y-24*s,x+85*s,y-8*s),fill=(120,126,122,180),width=3)
        d.line((504,452,504,393),fill=(62,62,66,255),width=3); d.polygon([(501,398),(468,443),(501,443)],fill=(227,214,181,255)); d.polygon([(509,413),(529,442),(509,442)],fill=(203,198,177,255)); d.polygon([(465,447),(537,447),(526,454),(477,454)],fill=(63,57,53,255))
    else:
        d.polygon([(0,337),(180,305),(356,326),(512,288),(770,321),(1024,298),(1024,680),(0,680)],fill=(104,126,105,255))
        for i in range(150):
            x=r.randrange(W); y=r.randrange(330,410); d.ellipse((x-30,y-35,x+30,y+30),fill=(r.randrange(55,95),r.randrange(80,117),r.randrange(61,86),190))
        # Invented manor with stone wings, pitched roof and central portico.
        d.rectangle((257,340,765,465),fill=(186,173,141,255)); d.rectangle((408,307,617,465),fill=(205,192,159,255))
        d.polygon([(226,342),(287,294),(444,294),(455,342)],fill=(72,81,79,255)); d.polygon([(592,342),(615,294),(731,294),(795,342)],fill=(72,81,79,255)); d.polygon([(385,310),(513,252),(642,310)],fill=(62,72,74,255))
        d.rectangle((309,270,328,305),fill=(144,139,119,255)); d.rectangle((694,264,714,306),fill=(148,140,117,255))
        for x in [281,330,376,437,493,553,608,652,701,743]:
            for y in [357,410]:
                d.rectangle((x,y,x+17,y+30),fill=(49,65,63,255)); d.rectangle((x+7,y,x+9,y+30),fill=(183,176,146,255)); d.line((x,y+14,x+17,y+14),fill=(171,160,129,255),width=2)
        d.polygon([(460,404),(513,377),(569,404)],fill=(222,207,170,255)); d.rectangle((491,406,537,465),fill=(70,65,51,255))
        for x in [465,479,549,560]: d.rectangle((x,405,x+6,465),fill=(215,199,163,255))
        for y in [465,471,478]: d.rectangle((447,y,577,y+4),fill=(153,150,124,255))
        d.polygon([(487,479),(539,479),(675,680),(342,680)],fill=(186,176,145,255))
        d.polygon([(0,492),(459,492),(327,680),(0,680)],fill=(71,91,52,255)); d.polygon([(568,493),(1024,492),(1024,680),(685,680)],fill=(70,92,53,255))
        for x in [178,826]:
            d.ellipse((x-60,513,x+62,542),fill=(162,158,132,255)); d.rectangle((x-5,477,x+5,524),fill=(187,180,150,255)); d.ellipse((x-26,483,x+27,493),fill=(182,181,154,255))
        for x in [69,154,228,786,882,971]:
            y=493+r.randrange(20); d.polygon([(x-22,y),(x-19,y-103),(x,y-169),(x+20,y-94),(x+24,y)],fill=(42,66,47,255));
            d.line((x-7,y-22,x-7,y-101),fill=(89,107,65,200),width=5)
        for i in range(2500):
            x,y=r.randrange(W),r.randrange(509,H)
            if abs(x-513)>(y-478)*.8+45:
                c=r.choice([(114,129,68),(78,112,56),(139,142,78),(174,119,114),(195,165,137)])
                d.ellipse((x,y,x+r.randrange(2,7),y+3),fill=(*c,170))
        for x in range(20,1024,18):
            if 345<x<678: continue
            d.line((x,579,x+13,577),fill=(36,63,40,190),width=5)
    # Fine canvas and expressive, deterministic impasto flecks.
    for i in range(24000):
        x,y=r.randrange(W),r.randrange(H); p=im.getpixel((x,y)); delta=r.randrange(-14,15)
        c=tuple(max(0,min(255,v+delta)) for v in p)
        d.line((x,y,x+r.randrange(1,7),y+r.choice([-1,0,1])),fill=(*c,85),width=1)
    # Repaint the invented composition with short oil-brush dabs; no photographic input.
    reference=im.filter(ImageFilter.GaussianBlur(1.2))
    im=reference.copy(); d=ImageDraw.Draw(im,'RGBA')
    for i in range(68000):
        x,y=r.randrange(W),r.randrange(H)
        sx=max(0,min(W-1,x+r.randrange(-4,5))); sy=max(0,min(H-1,y+r.randrange(-3,4)))
        c=reference.getpixel((sx,sy)); delta=r.randrange(-14,15)
        col=tuple(max(0,min(255,a+delta)) for a in c)
        length=r.randrange(3,14); height=r.randrange(1,5)
        d.ellipse((x,y,x+length,y+height),fill=(*col,r.randrange(110,205)))
    im.save(path)

def material(name,color,channel,metal=0,rough=.5,texture=None):
    m=bpy.data.materials.new(name); m.use_nodes=True; m.diffuse_color=(*color,1); m['finishChannel']=channel
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if texture:
        n=m.node_tree.nodes.new('ShaderNodeTexImage'); n.image=bpy.data.images.load(str(texture)); n.image.pack(); m.node_tree.links.new(n.outputs['Color'],bs.inputs['Base Color'])
    return m

def mesh(name,vs,fs,mat):
    me=bpy.data.meshes.new(name); me.from_pydata(vs,[],fs); me.update(); ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat); return ob

def cube(name,loc,size,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.name=name; o.dimensions=size; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(mat)
    if bevel:
        mod=o.modifiers.new('Rounded crafted edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o

def tube(name,points,radius,mat,sides=5,closed=False):
    vs=[]; fs=[]; n=len(points)
    for i,p in enumerate(points):
        tangent=Vector(points[(i+1)%n])-Vector(points[(i-1)%n]) if closed else Vector(points[min(i+1,n-1)])-Vector(points[max(0,i-1)])
        tangent.normalize(); ref=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((0,1,0)); a=tangent.cross(ref).normalized(); b=tangent.cross(a).normalized()
        for j in range(sides): vs.append(Vector(p)+radius*(a*math.cos(j*math.tau/sides)+b*math.sin(j*math.tau/sides)))
    for i in range(n if closed else n-1):
        for j in range(sides): fs.append((i*sides+j,i*sides+(j+1)%sides,((i+1)%n)*sides+(j+1)%sides,((i+1)%n)*sides+j))
    if not closed: fs.extend([tuple(range(sides-1,-1,-1)),tuple((n-1)*sides+j for j in range(sides))])
    o=mesh(name,vs,fs,mat)
    for p in o.data.polygons: p.use_smooth=True
    return o

def ellipse(name,rx,ry,z,r,mat,sides=5,seg=64): return tube(name,[(rx*math.cos(t*math.tau/seg),ry*math.sin(t*math.tau/seg),z) for t in range(seg)],r,mat,sides,True)

def ring(name,w,h,centre_z,profile,mat):
    # Swept mitred rectangular moulding. Profile is inward offset and front depth (negative Blender Y).
    vs=[]; fs=[]
    for off,dep in profile:
        for x,z in [(-w/2+off,off),(w/2-off,off),(w/2-off,h-off),(-w/2+off,h-off)]: vs.append((x,-dep,z))
    n=len(profile)
    for i in range(n):
        for j in range(4): fs.append((i*4+j,i*4+(j+1)%4,((i+1)%n)*4+(j+1)%4,((i+1)%n)*4+j))
    return mesh(name,vs,fs,mat)

def build_frame(w,d,h,kind):
    gold=material('Antique gold frame',(.57,.37,.12),'metal',.8,.32); darkgold=material('Patinated gold recess',(.27,.16,.05),'metal',.73,.48); bright=material('Burnished gilt bead',(.72,.5,.19),'metal',.82,.29)
    wood=material('Flat walnut backing',(.12,.073,.043),'wood',0,.75)
    # Back is one absolutely flat face, no projecting wall hooks.
    cube('Flat backing',(0,d*.36,h/2),(w*.98,d*.28,h*.98),wood,.003)
    rim=min(w,h)*.075
    ring('Solid gilded frame',w,h,h/2,[(0,-d*.45),(0,d*.1),(.004,d*.3),(.018,d*.46),(.031,d*.42),(rim*.53,d*.2),(rim*.62,d*.1),(rim*.78,d*.2),(rim,d*.16),(rim,d*-.34)],gold)
    ring('Fine inner gilt lip',w,h,h/2,[(rim*.88,d*.16),(rim*.9,d*.26),(rim*.98,d*.3),(rim*1.03,d*.25),(rim*1.03,d*.12)],bright)
    ring('Shadow in moulding groove',w,h,h/2,[(rim*.58,d*.13),(rim*.63,d*.14),(rim*.67,d*.13),(rim*.63,d*.09)],darkgold)
    # Fine beading along all four sides. Low-poly spheres remain editable.
    off=rim*.3; step=.025 if w<=1 else .03
    pts=[]
    for x in [(-w/2+off)+i*(w-2*off)/max(1,round((w-2*off)/step)) for i in range(round((w-2*off)/step)+1)]: pts.extend([(x,-d*.43,off),(x,-d*.43,h-off)])
    for z in [off+i*(h-2*off)/max(1,round((h-2*off)/step)) for i in range(1,round((h-2*off)/step))]: pts.extend([(-w/2+off,-d*.43,z),(w/2-off,-d*.43,z)])
    for p in pts:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=rim*.045,location=p); o=bpy.context.object; o.name='Gilt pearl'; o.data.materials.append(bright)
        for f in o.data.polygons: f.use_smooth=True
    # Hand-designed acanthus-like corner curls, fitted inside frame boundary.
    for sx in [-1,1]:
        for sz in [-1,1]:
            cx=sx*(w/2-rim*.52); cz=h/2+sz*(h/2-rim*.52)
            for k in [-1,1]:
                ps=[]
                for t in range(20):
                    a=t/19*math.pi*1.65; rr=rim*.3*(1-t/23); ps.append((cx+sx*rr*math.cos(a),-d*.46,cz+sz*k*rr*math.sin(a)))
                tube('Corner acanthus scroll',ps,rim*.026,bright,5)
    tex=OUT/f'.{kind}_painting.png'; painting(kind,tex)
    canvas=material('Original painted linen canvas',(1,1,1),'canvas',0,.88,tex)
    x0,x1=-w/2+rim*1.04,w/2-rim*1.04; z0,z1=rim*1.04,h-rim*1.04
    o=mesh('Original '+kind+' oil painting',[(x0,-d*.13,z0),(x1,-d*.13,z0),(x1,-d*.13,z1),(x0,-d*.13,z1)],[(0,1,2,3)],canvas)
    uv=o.data.uv_layers.new(name='Canvas UV')
    for poly in o.data.polygons:
        for li,co in zip(poly.loop_indices,[(0,0),(1,0),(1,1),(0,1)]): uv.data[li].uv=co
    tex.unlink()

def build_basket():
    r=random.Random(SEED+9)
    reeds=[material('Honey wicker '+str(i),c,'wood',0,.64) for i,c in enumerate([(.22,.12,.055),(.29,.17,.079),(.35,.215,.105),(.255,.145,.064)])]
    fabric=material('Warm ivory linen',(.78,.75,.64),'fabric',0,.96); sage=material('Muted sage linen',(.29,.37,.31),'fabric',0,.92)
    # Hollow open basket, actual woven uprights and alternating over-under hoops.
    for i in range(28):
        a=i*math.tau/28; ps=[]
        for k in range(16):
            z=.032+k*.47/15; rx=.245+.038*k/15; ry=.169+.035*k/15; dev=.0028*math.cos(k*math.pi)
            ps.append(((rx+dev)*math.cos(a),(ry+dev)*math.sin(a),z))
        tube('Vertical wicker stake',ps,.0045,reeds[i%4],4)
    for j in range(22):
        z=.044+j*.0218; f=(z-.032)/.47; ps=[]
        for k in range(48):
            a=k*math.tau/48; dev=.0035*math.cos(a*28+j*math.pi)
            ps.append(((.245+.038*f+dev)*math.cos(a),(.169+.035*f+dev)*math.sin(a),z))
        tube('Woven horizontal reed',ps,.006,reeds[j%4],4,True)
    ellipse('Bound upper rim',.285,.205,.518,.011,reeds[1],6,64); ellipse('Lower woven rim',.245,.17,.027,.011,reeds[1],6,64)
    # Base: shallow bottom plate under crossed weaving, no floating strands.
    vs=[(0,0,.015)]+[(.246*math.cos(i*math.tau/56),.171*math.sin(i*math.tau/56),.015) for i in range(56)]
    mesh('Wicker base',vs,[(0,i+1,(i+1)%56+1) for i in range(56)],reeds[0])
    for j in range(-8,9):
        x=j*.026; ext=.166*math.sqrt(max(0,1-(x/.246)**2)); tube('Base weave warp',[(x,-ext,.02),(x,ext,.02)],.004,reeds[j%4],4)
    for j in range(-6,7):
        y=j*.024; ext=.246*math.sqrt(max(0,1-(y/.171)**2)); tube('Base weave weft',[(-ext,y,.024),(ext,y,.024)],.004,reeds[j%4],4)
    # Two raised arched handles at the narrow ends, securely joined to rim.
    for sx in [-1,1]:
        ps=[]
        for k in range(33):
            a=k/32*math.pi; ps.append((sx*(.272+.015*math.sin(a)),-.087*math.cos(a),.512+.077*math.sin(a)))
        tube('Raised braided handle',ps,.010,reeds[2],6)
        for k in range(25):
            t=k/24; a=t*math.pi; p=Vector((sx*(.272+.015*math.sin(a)),-.087*math.cos(a),.512+.077*math.sin(a)))
            # Small tied bands around handle, rings approximately perpendicular.
            if k%4==0: tube('Handle binding',[p+Vector((.007*math.cos(b),.004*math.sin(b),.008*math.sin(b))) for b in [i*math.tau/8 for i in range(8)]],.0018,reeds[0],4,True)
    # Small amount of soft linen inside, open rim stays plainly visible.
    for idx,(cx,cy,zz,sx,sy,mat) in enumerate([(-.06,-.01,.397,.15,.11,fabric),(.10,.06,.385,.11,.12,sage)]):
        vs=[]; fs=[]; N=15
        for j in range(N):
            for i in range(N):
                u=i/(N-1)*2-1; v=j/(N-1)*2-1
                x=cx+sx*u; y=cy+sy*v; z=zz+.012*math.sin(u*7+v*3)+.008*math.cos(v*8)+.025*(1-u*u)*(1-v*v)
                vs.append((x,y,z))
        for j in range(N-1):
            for i in range(N-1): a=j*N+i; fs.append((a,a+1,a+N+1,a+N))
        o=mesh('Draped linen '+str(idx),vs,fs,mat)
        for p in o.data.polygons: p.use_smooth=True
        so=o.modifiers.new('Thin cloth hem','SOLIDIFY'); so.thickness=.0017; bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=so.name)

def build_box():
    walnut=material('Oiled walnut rails',(.08,.035,.015),'wood',0,.47); panel=material('Walnut inset panels',(.11,.055,.024),'wood',0,.57); grain=material('Subtle walnut grain',(.065,.025,.010),'wood',0,.62); brass=material('Aged brass hardware',(.56,.38,.15),'metal',.78,.34)
    # Frame-and-panel cabinetry with ventilation, four short feet and closed lid.
    for x in [-.246,.246]:
        for y in [-.198,.198]: cube('Short square foot',(x,y,.042),(.052,.052,.084),walnut,.008)
    cube('Base plinth',(0,0,.102),(.58,.48,.06),walnut,.006)
    cube('Base interior',(0,0,.125),(.535,.435,.025),panel,.003)
    for x in [-.266,.266]:
        for y in [-.215,.215]: cube('Upright corner stile',(x,y,.463),(.048,.048,.702),walnut,.005)
    for y in [-.215,.215]:
        cube('Recessed long panel',(0,y,.415),(.492,.026,.536),panel,.003)
        for z in [.159,.69,.79]: cube('Long framing rail',(0,y,z),(.53,.047,.04),walnut,.004)
        # Eight small ventilation openings represented by gaps between actual slats.
        for i in range(9): cube('Upper ventilation slat',(-.235+i*.0588,y,.741),(.041,.025,.067),panel,.002)
        # Fine bevelled inset moulding and subtle handmade woodgrain lines.
        for x in [-.215,.215]: cube('Panel edge moulding',(x,y-.016 if y<0 else y+.016,.413),(.012,.012,.45),walnut,.002)
        for z in [.193,.634]: cube('Panel edge moulding',(0,y-.016 if y<0 else y+.016,z),(.442,.012,.012),walnut,.002)
        r=random.Random(SEED+int((y+1)*100))
        for i in range(20):
            xx=r.uniform(-.20,.20); zz=r.uniform(.23,.40)
            ps=[(xx+.002*math.sin(t*.6+i),y-.014 if y<0 else y+.014,zz+t*.017) for t in range(14)]
            tube('Quiet walnut grain',ps,.00035,grain,3)
    for x in [-.265,.265]:
        cube('Recessed side panel',(x,0,.417),(.024,.384,.54),panel,.003)
        for z in [.159,.69,.79]: cube('Side framing rail',(x,0,z),(.048,.428,.04),walnut,.004)
        for i in range(7): cube('Side ventilation slat',(x,-.171+i*.057,.741),(.026,.042,.067),panel,.002)
        for y in [-.167,.167]: cube('Side panel moulding',(x+math.copysign(.013,x),y,.413),(.012,.012,.45),walnut,.002)
        for z in [.193,.634]: cube('Side panel moulding',(x+math.copysign(.013,x),0,z),(.012,.345,.012),walnut,.002)
    cube('Closed lid',(0,0,.823),(.6,.5,.054),walnut,.008)
    # Lid inset top three planks, parallel seam gaps, no open cavity.
    for i in range(3): cube('Lid inset walnut board',(-.174+i*.174,0,.849),(.171,.43,.009),panel,.003)
    # Brass hinges lie on rear and stop below lid highest plane.
    for x in [-.177,.177]:
        cube('Rear hinge leaf',(x,.243,.786),(.052,.006,.057),brass,.0015)
        tube('Hinge barrel',[(x-.031,.247,.816),(x+.031,.247,.816)],.004,brass,8)
        for xx in [x-.016,x+.016]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.003,location=(xx,.247,.779)); bpy.context.object.data.materials.append(brass)
    # Restrained front pull, semantic front (+Z after glTF export).
    cube('Front latch escutcheon',(0,-.244,.754),(.055,.009,.032),brass,.004)
    tube('Front brass finger pull',[(-.025,-.246,.776),(-.025,-.261,.776),(.025,-.261,.776),(.025,-.246,.776)],.004,brass,6)

def normalize(target):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']; coords=[o.matrix_world@v.co for o in objects for v in o.data.vertices]; lo=Vector(tuple(min(p[i] for p in coords) for i in range(3))); hi=Vector(tuple(max(p[i] for p in coords) for i in range(3)))
    centre=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z)); sz=hi-lo; desired=Vector((target[0],target[1],target[2])); scales=Vector(tuple(desired[i]/sz[i] for i in range(3)))
    for o in objects:
        world=o.matrix_world.copy()
        for v in o.data.vertices:
            p=world@v.co-centre; v.co=Vector(tuple(p[i]*scales[i] for i in range(3)))
        o.matrix_world.identity()
    return objects

def setup_render(spec):
    w,d,h=spec; sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=64; sc.cycles.use_denoising=False
    sc.render.resolution_x=sc.render.resolution_y=512; sc.render.resolution_percentage=100; sc.render.film_transparent=True
    sc.world=bpy.data.worlds.new('Soft studio world'); sc.world.color=(.28,.28,.28); sc.world.use_nodes=True; sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.55,.55,.55,1); sc.world.node_tree.nodes['Background'].inputs[1].default_value=.45
    sc.view_settings.view_transform='AgX'; sc.view_settings.look='AgX - Medium High Contrast'
    bpy.ops.object.camera_add(); cam=bpy.context.object; cam.name='Preview camera (not exported)'; cam.data.type='ORTHO'; sc.camera=cam
    for name,loc,power,size in [('Soft key',(-2,-3,4),480,3),('Fill',(3,-1,2),280,3),('Edge',(0,3,4),500,2)]:
        bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.name=name; o.data.energy=power; o.data.shape='DISK'; o.data.size=size; o.rotation_euler=(Vector((0,0,h/2))-o.location).to_track_quat('-Z','Y').to_euler()
    return cam

def render_view(cam,loc,target,scale,path,transparent):
    sc=bpy.context.scene; cam.location=loc; cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.ortho_scale=scale
    sc.render.film_transparent=transparent; sc.render.image_settings.file_format='PNG' if transparent else 'JPEG'; sc.render.image_settings.color_mode='RGBA' if transparent else 'RGB'; sc.render.image_settings.quality=87; sc.render.filepath=str(path); bpy.ops.render.render(write_still=True)

def main():
    report=[]
    selection=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    for id,name,spec,kind in SPECS:
        if selection and id not in selection and kind not in selection: continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system='METRIC'; bpy.context.scene.unit_settings.length_unit='METERS'; bpy.context.scene.unit_settings.scale_length=1.0
        if kind in ['forest','sea','garden']: build_frame(*spec,kind)
        elif kind=='basket': build_basket()
        else: build_box()
        objects=normalize(spec); bpy.ops.object.select_all(action='DESELECT')
        for o in objects: o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.export_scene.gltf(filepath=str(MODELS/(id+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_apply=True,export_cameras=False,export_lights=False)
        cam=setup_render(spec); w,d,h=spec; m=max(w,h,d); target=(0,0,h/2)
        # A modest front-quarter angle keeps the landscapes legible.
        render_view(cam,(m*.65,-m*2.3,h/2+m*.75),target,m*1.19,PREV/(id+'-thumb.png'),True)
        render_view(cam,(0,0,h+m*3),target,max(w,d)*1.17,PREV/(id+'-top.png'),True)
        render_view(cam,(0,-m*3,h/2),target,max(w,h)*1.14,OUT/(id+'-front.jpg'),False)
        render_view(cam,(0,m*3,h/2),target,max(w,h)*1.14,OUT/(id+'-back.jpg'),False)
        # Saved source opens in thumbnail perspective and excludes disposable intermediates.
        cam.location=(m*.65,-m*2.3,h/2+m*.75); cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.ortho_scale=m*1.19; bpy.context.scene.render.film_transparent=True
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(id+'.blend')),compress=True)
        report.append({'id':id,'name':name,'requested_m':spec,'materials':[{'name':m.name,'finishChannel':m.get('finishChannel'),'baseColor':list(m.diffuse_color[:3])} for m in bpy.data.materials if m.get('finishChannel')]})
    author=OUT/'models-authoring-report.json'
    if selection and author.exists():
        old=json.loads(author.read_text()); changed={r['id'] for r in report}; report=[r for r in old if r['id'] not in changed]+report
        order={s[0]:i for i,s in enumerate(SPECS)}; report.sort(key=lambda r:order[r['id']])
    author.write_text(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
