"""Original local character surfacing from approved front designs.

Native Blender -Y front / +Z up; glTF +Z front / +Y up.
Separate clothing and body collections preserve editable outfit choices.
Static form-review assets, NOT finished animated walkers.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
REFERENCES = REPO / 'tools/characters/design/v2/candidates/attachment-style-review-20261014'
MODEL = []
COLLECTIONS = {}
MATERIALS = {}
SPEC = {}
HEAD_ROWS = []

def srgb(v):
    return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4

def material(name, color, emission=0):
    rgb = tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
    m = bpy.data.materials.new(name); m.use_nodes=True
    m.diffuse_color=(*[srgb(v) for v in rgb],1)
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=m.diffuse_color
    p.inputs['Roughness'].default_value=.88
    p.inputs['Specular IOR Level'].default_value=.12
    if emission:
        p.inputs['Emission Color'].default_value=m.diffuse_color; p.inputs['Emission Strength'].default_value=emission
    m['sourceHex']=color; m['role']=name
    MATERIALS[name]=m
    return m

def mesh(name, vertices, faces, mats, region='Body', indices=None):
    d=bpy.data.meshes.new(name); d.from_pydata(vertices,[],faces); d.update()
    o=bpy.data.objects.new(name,d); COLLECTIONS[region].objects.link(o)
    for m in mats:d.materials.append(m)
    for i,p in enumerate(d.polygons):p.use_smooth=True; p.material_index=indices[i] if indices else 0
    bm=bmesh.new(); bm.from_mesh(d); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(d); bm.free()
    o['partRole']=region; MODEL.append(o)
    return o

def bridge(name, rings, mat, region='Body', closed_section=False, mats=None, bands=None):
    n=len(rings[0]); vs=[tuple(p) for r in rings for p in r]; fs=[]; ids=[]
    if not closed_section:fs.append(tuple(reversed(range(n)))); ids.append(0)
    count=len(rings) if closed_section else len(rings)-1
    for k in range(count):
        kk=(k+1)%len(rings)
        for i in range(n):
            j=(i+1)%n; fs.append((k*n+i,k*n+j,kk*n+j,kk*n+i)); ids.append(bands(k,i) if bands else 0)
    if not closed_section:fs.append(tuple(range((len(rings)-1)*n,len(rings)*n))); ids.append(0)
    return mesh(name,vs,fs,mats or [mat],region,ids)

def profile(name, rows, mat, region='Body', sides=40, center=(0,0), closed=False, mats=None, bands=None):
    rings=[]
    for row in rows:
        z,rx,ry,*extra=row; cy=extra[0] if extra else center[1]
        rings.append([(center[0]+rx*math.cos(2*math.pi*i/sides),cy+ry*math.sin(2*math.pi*i/sides),z) for i in range(sides)])
    return bridge(name,rings,mat,region,closed,mats,bands)

def tube(name, stations, mat, region='Body', sides=20):
    rings=[]
    for k,(point,depth,width) in enumerate(stations):
        p=Vector(point); q=Vector(stations[min(k+1,len(stations)-1)][0])-Vector(stations[max(k-1,0)][0])
        if q.length<1e-8:q=Vector((0,0,1))
        q.normalize(); a=Vector((0,1,0)); a=(a-q*a.dot(q)).normalized(); b=q.cross(a).normalized()
        rings.append([p+a*(depth*math.cos(2*math.pi*i/sides))+b*(width*math.sin(2*math.pi*i/sides)) for i in range(sides)])
    return bridge(name,rings,mat,region)

def line(name, pts, radius, mat, region='Face'):
    d=bpy.data.curves.new(name,'CURVE'); d.dimensions='3D'; d.resolution_u=4; d.bevel_depth=radius; d.bevel_resolution=1; d.use_fill_caps=True
    s=d.splines.new('BEZIER'); s.bezier_points.add(len(pts)-1)
    for p,co in zip(s.bezier_points,pts):p.co=co; p.handle_left_type='AUTO'; p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,d); COLLECTIONS[region].objects.link(o); d.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o; bpy.ops.object.convert(target='MESH')
    o=bpy.context.object; o['partRole']=region; MODEL.append(o); return o

def lerp_rows(rows,z):
    if z<=rows[0][0]:return rows[0][1:]
    if z>=rows[-1][0]:return rows[-1][1:]
    for a,b in zip(rows,rows[1:]):
        if a[0]<=z<=b[0]:
            t=(z-a[0])/(b[0]-a[0]);return tuple(x+(y-x)*t for x,y in zip(a[1:],b[1:]))

def face_y(x,z):
    w,d,cy=lerp_rows(HEAD_ROWS,z)
    y=cy-d*math.sqrt(max(.05,1-(x/max(w,.001))**2))
    nose=SPEC['chin']+.267*SPEC['head_height']
    y-=.0058*math.exp(-(x/.009)**2-((z-nose)/.012)**2)
    return y

def patch(name,cx,cz,rx,rz,mat,offset):
    sides=32; vs=[]
    for back in [False,True]:
        off=offset-(.00045 if back else 0)
        vs.append((cx,face_y(cx,cz)-off,cz))
        for r in [.45,1]:
            for i in range(sides):
                x=cx+rx*r*math.cos(i*2*math.pi/sides);z=cz+rz*r*math.sin(i*2*math.pi/sides)
                vs.append((x,face_y(x,z)-off,z))
    fs=[]; sidecount=1+2*sides
    for layer in range(2):
        q=layer*sidecount
        for i in range(sides):
            j=(i+1)%sides; f=(q,q+1+i,q+1+j); fs.append(tuple(reversed(f)) if layer else f)
            f=(q+1+i,q+1+sides+i,q+1+sides+j,q+1+j);fs.append(tuple(reversed(f)) if layer else f)
    for i in range(sides):
        j=(i+1)%sides; fs.append((1+sides+i,1+sides+j,sidecount+1+sides+j,sidecount+1+sides+i))
    return mesh(name,vs,fs,[mat],'Face')

def face():
    female=SPEC['sex']=='female'; h=SPEC['head_height']; c=SPEC['chin']; top=SPEC['height']-.012
    scale=.94 if female else 1
    controls=[(0,.008,.028,-.01),(.055,.039,.049,-.012),(.13,.061,.061,-.011),(.24,.077,.073,-.007),(.38,.088,.080,0),(.55,.093,.082,.004),(.73,.091,.079,.008),(.85,.078,.071,.009),(.95,.049,.044,.009),(1,.006,.006,.009)]
    global HEAD_ROWS
    HEAD_ROWS=[(c+t*(top-c),w*scale,d*scale,cy) for t,w,d,cy in controls]
    rows=[]
    for k in range(33):
        z=c+(top-c)*k/32; rows.append((z,*lerp_rows(HEAD_ROWS,z)))
    rings=[]
    for z,w,d,cy in rows:
        ring=[]
        for i in range(64):
            a=2*math.pi*i/64;x=w*math.cos(a);y=cy+d*math.sin(a)
            if math.sin(a)<0:y-=.0058*math.exp(-(x/.009)**2-((z-(c+.267*h))/.012)**2)*(-math.sin(a))**8
            ring.append((x,y,z))
        rings.append(ring)
    bridge('Head.FaceSculpt',rings,MATERIALS['Skin'],'Face')
    # Ears are custom closed, shaped profiles, with a broad inner contour.
    for s in [-1,1]:
        ec=s*.090*scale; ez=c+.42*h
        p=profile('Ear.'+str(s),[(ez-.027,.010,.009),(ez-.019,.018,.014),(ez,.021,.015),(ez+.020,.016,.012),(ez+.027,.007,.006)],MATERIALS['Skin'],'Face',24,(ec,.001))
        pts=[(ec+s*.011,-.011,ez-.014),(ec+s*.014,-.017,ez+.004),(ec+s*.008,-.014,ez+.017)]
        line('Ear.Inner.'+str(s),pts,.0008,MATERIALS['SkinShade'])
    eyez=c+.535*h; eyex=.037*scale; rx=.016*scale; rz=.022
    for s in [-1,1]:
        x=s*eyex
        patch('Eye.White.'+str(s),x,eyez,rx,rz,MATERIALS['EyeWhite'],.0017)
        patch('Eye.Iris.'+str(s),x,eyez-.001,.010*scale,.0185,MATERIALS['Iris'],.0026)
        patch('Eye.Pupil.'+str(s),x,eyez,.0037,.0095,MATERIALS['Pupil'],.0033)
        patch('Eye.Glint.'+str(s),x-.0028,eyez+.010,.0027,.0042,MATERIALS['EyeWhite'],.004)
        pts=[]
        for i in range(9):
            a=.10+(math.pi-.2)*i/8;xx=x+rx*math.cos(a);zz=eyez+rz*math.sin(a);pts.append((xx,face_y(xx,zz)-.0025,zz))
        line('Eye.UpperLid.'+str(s),pts,.0013,MATERIALS['Ink'])
        browz=eyez+.034
        pts=[(x-rx,face_y(x-rx,browz)-.0015,browz),(x,face_y(x,browz+.003)-.0015,browz+.003),(x+rx,face_y(x+rx,browz)-.0015,browz)]
        line('Brow.'+str(s),pts,.0011 if female else .0014,MATERIALS['HairShadow'])
    nz=c+.267*h
    line('Nose.ShortMark',[(.001,face_y(.001,nz+.002)-.0008,nz+.002),(.0015,face_y(.0015,nz-.001)-.0008,nz-.001)],.0007,MATERIALS['SkinShade'])
    mz=c+.156*h
    pts=[(-.018,face_y(-.018,mz+.003)-.001,mz+.003),(0,face_y(0,mz)-.001,mz),(.018,face_y(.018,mz+.003)-.001,mz+.003)]
    line('Mouth.ClosedSmile',pts,.00085,MATERIALS['Ink'])

def hair_lobe(name, points, widths, thickness=.009):
    stations=[]
    for i in range(len(points)-1):
        a=Vector(points[i]);b=Vector(points[i+1])
        for k in range(5):
            t=k/5;p=a.lerp(b,t);width=widths[i]+(widths[i+1]-widths[i])*t
            stations.append((p,thickness,width))
    stations.append((Vector(points[-1]),.001,max(widths[-1],.001)))
    return tube(name,stations,MATERIALS['Hair'],'Hair',20)

def hair():
    female=SPEC['sex']=='female';c=SPEC['chin'];h=SPEC['head_height'];H=SPEC['height'];rings=[]
    for k in range(17):
        t=k/16;ring=[]
        for i in range(64):
            a=i*2*math.pi/64;s=math.sin(a)
            f=(.10+.60*max(0,-s)**2 if not female else -.028+.79*max(0,-s)**2)
            z0=c+f*h;z=z0+(H-.006-z0)*t
            w,d,cy=lerp_rows(HEAD_ROWS,z)
            if female:
                w=max(w*1.16+.017*(1-t),.107*(1-t)**.62);d=max(d+.018*(1-t),.071*(1-t)**.72)
            else:w+=.016*(1-t);d+=.014*(1-t)
            if k==16:w=.012;d=.012
            # A softly scalloped bob edge rather than an uninterrupted helmet rim.
            zz=z+(.004*math.cos(3*a)**2*(1-t)**4 if female else 0)
            ring.append((w*math.cos(a),cy+d*math.sin(a),zz))
        rings.append(ring)
    bridge('Hair.CrownAndBack',rings,MATERIALS['Hair'],'Hair')
    if female:
        hair_lobe('Hair.Fringe.Sweep',[(-.024,-.037,H-.018),(.035,-.085,H-.062),(.072,-.09,c+.70*h)],[.033,.047,.002],.008)
        hair_lobe('Hair.Bob.Left',[(-.078,-.027,H-.055),(-.106,-.015,c+.47*h),(-.109,-.003,c-.001)],[.022,.027,.002],.010)
        hair_lobe('Hair.Bob.Right',[(.078,-.012,H-.062),(.107,.007,c+.37*h),(.109,.014,c+.009)],[.020,.025,.002],.010)
        # Approved capsule clip, following the right temple surface.
        hair_lobe('Accessory.HairClipSupport',[(.083,-.059,c+.78*h),(.078,-.069,c+.70*h)],[.004,.004],.002)
        o=line('Accessory.IvoryHairClip',[(.086,-.071,c+.79*h),(.078,-.081,c+.735*h)],.0045,MATERIALS['Accessory'],'Accessories')
    else:
        hair_lobe('Hair.Fringe.Main',[(.045,-.026,H-.026),(-.015,-.087,c+.87*h),(-.075,-.09,c+.60*h)],[.024,.044,.002],.009)
        hair_lobe('Hair.Fringe.Left',[(-.030,-.012,H-.041),(-.086,-.055,c+.77*h),(-.110,-.033,c+.54*h)],[.019,.031,.001],.008)
        hair_lobe('Hair.Fringe.Right',[(.055,-.018,H-.031),(.090,-.048,c+.84*h),(.114,-.016,c+.58*h)],[.018,.025,.001],.009)
        hair_lobe('Hair.Crown.Sweep',[(.027,.012,H-.050),(.050,.012,H-.018),(.030,.007,H)],[.023,.018,.001],.006)

def hand(side,wrist,axis,scale):
    palm=[(wrist+axis*.003,.016*scale,.022*scale),(wrist+axis*.024*scale,.019*scale,.033*scale),(wrist+axis*.075*scale,.015*scale,.030*scale)]
    pieces=[tube('Hand.Palm.'+str(side),palm,MATERIALS['Skin'],'Body',20)]
    cross=axis.cross(Vector((0,1,0))).normalized()
    for j,(offset,length) in enumerate([(-.023,.052),(-.008,.073),(.008,.078),(.023,.062)]):
        start=wrist+axis*.070*scale+cross*(offset*scale)
        path=[(start,.0063*scale,.0065*scale),(start+axis*length*.48*scale+Vector((0,-.001,0)),.0060*scale,.0060*scale),(start+axis*length*scale+Vector((0,.004,0)),.0033*scale,.0037*scale)]
        pieces.append(tube('Hand.Finger.'+str(side)+'.'+str(j),path,MATERIALS['Skin'],'Body',12))
    inward=-side*cross;start=wrist+axis*.034*scale+inward*.028*scale;direction=(axis*.70+inward*.71).normalized()
    pieces.append(tube('Hand.Thumb.'+str(side),[(start,.008*scale,.008*scale),(start+direction*.020*scale,.007*scale,.007*scale),(start+direction*.043*scale,.004*scale,.0045*scale)],MATERIALS['Skin'],'Body',12))
    bpy.ops.object.select_all(action='DESELECT')
    for o in pieces:o.select_set(True)
    bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join();o=pieces[0]
    for p in pieces[1:]:MODEL.remove(p)
    o.name='Hand.UnifiedFiveDigits.'+str(side)
    # Join anatomical fingers into the palm, rather than visibly stacking capsules.
    mod=o.modifiers.new('ContinuousPalmFingerSurface','REMESH');mod.mode='VOXEL';mod.voxel_size=.0033*scale;mod.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=o.modifiers.new('SoftenPalmJunctions','SMOOTH');mod.factor=.35;mod.iterations=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def sleeve(side, shoulder, elbow, wrist, scale):
    axis=(wrist-shoulder).normalized();end=wrist-axis*.035*scale
    paths=[(shoulder,.057*scale,.065*scale),(shoulder.lerp(elbow,.45),.060*scale,.072*scale),(elbow,.054*scale,.068*scale),(elbow.lerp(end,.76),.050*scale,.063*scale),(end,.040*scale,.044*scale)]
    tube('Outfit.Sweatshirt.Sleeve.'+str(side),paths,MATERIALS['Sweatshirt'],'Clothing',28)
    tube('Outfit.Sweatshirt.Cuff.'+str(side),[(end-axis*.013*scale,.043*scale,.046*scale),(end+axis*.018*scale,.042*scale,.045*scale),(end+axis*.040*scale,.034*scale,.036*scale)],MATERIALS['SweatshirtShade'],'Clothing',28)

def watch(wrist,axis):
    tube('Accessory.WatchBand',[(wrist-axis*.005,.027,.027),(wrist+axis*.019,.027,.027)],MATERIALS['Accessory'],'Accessories',28)
    p=wrist+axis*.006+Vector((0,-.028,0));u=axis.cross(Vector((0,1,0))).normalized();v=axis
    rings=[]
    for d,w,h in [(0,.018,.016),(.002,.020,.018),(.006,.018,.016)]:
        r=[]
        for i in range(32):
            a=i*2*math.pi/32;xx=math.copysign(abs(math.cos(a))**.45,math.cos(a))*w;zz=math.copysign(abs(math.sin(a))**.45,math.sin(a))*h
            r.append(p+u*xx+v*zz+Vector((0,-d,0)))
        rings.append(r)
    bridge('Accessory.WatchRoundedFace',rings,MATERIALS['Pupil'],'Accessories')

def shoe(side,scale):
    # Contiguous, asymmetric toe/heel profiles with a real sole and rounded upper.
    cx=side*.082*scale;cy=-.027*scale; rings=[]
    for z,w,d in [(0,.045,.112),(.008,.052,.124),(.024,.054,.125),(.030,.052,.123),(.062,.053,.112),(.089,.046,.092),(.104,.030,.071)]:
        rings.append([(cx+w*math.cos(i*2*math.pi/40)*scale,cy+d*math.sin(i*2*math.pi/40)*scale,z*scale) for i in range(40)])
    bridge('Foot.HouseMule.'+str(side),rings,MATERIALS['Shoe'],'Clothing',mats=[MATERIALS['Sole'],MATERIALS['Shoe']],bands=lambda k,i:0 if k<3 else 1)
    profile('Foot.Sock.'+str(side),[(.044*scale,.036*scale,.051*scale),(.082*scale,.036*scale,.047*scale),(.141*scale,.028*scale,.033*scale),(.179*scale,.032*scale,.034*scale)],MATERIALS['Socks'],'Body',28,(cx,.035*scale))

def clothing_body():
    female=SPEC['sex']=='female'; scale=SPEC['height']/1.72;hem=.973 if not female else .948; collar=1.396 if not female else 1.296
    rx=.173 if not female else .154;ry=.111 if not female else .100
    profile('Outfit.CottonInner',[(hem-.044,rx*.96,ry*.94),(hem-.015,rx*.99,ry*.96),(hem+.012,rx*.99,ry*.96)],MATERIALS['Cotton'],'Clothing')
    profile('Outfit.Sweatshirt.Body',[(hem,rx*.97,ry*.98),(hem+.013,rx,ry),(hem+.053,rx*1.02,ry*1.02),(hem+.16,rx*1.08,ry*1.07),(collar-.075,rx*1.07,ry*1.11),(collar-.035,rx*1.02,ry*1.0),(collar,.060*scale,.049*scale)],MATERIALS['Sweatshirt'],'Clothing',48)
    profile('Outfit.Sweatshirt.SoftHem',[(hem-.002,rx*.98,ry),(hem+.004,rx*1.005,ry*1.018),(hem+.046,rx*1.016,ry*1.024)],MATERIALS['SweatshirtShade'],'Clothing',48)
    # Closed annular collar, with an actual neck opening.
    profile('Outfit.Sweatshirt.Collar',[(collar-.006,.062*scale,.052*scale),(collar+.003,.062*scale,.052*scale),(collar+.003,.055*scale,.045*scale),(collar-.006,.055*scale,.045*scale)],MATERIALS['SweatshirtShade'],'Clothing',48,closed=True)
    if female:
        rows=[(.906,.139,.098),(.864,.161,.105),(.790,.178,.116),(.620,.210,.138),(.410,.239,.159),(.160,.268,.180),(.164,.264,.176),(.410,.235,.155),(.620,.206,.134),(.790,.174,.112),(.864,.157,.101),(.906,.135,.094)]
        rings=[]
        for k,(z,w,d) in enumerate(rows):
            rings.append([(w*math.cos(i*2*math.pi/64),d*math.sin(i*2*math.pi/64),z+(.030*math.cos(i*2*math.pi/64)**2 if k in [5,6] else 0)) for i in range(64)])
        bridge('Outfit.LongSkirt.HollowWeightedShell',rings,MATERIALS['Skirt'],'Clothing',True,mats=[MATERIALS['Skirt'],MATERIALS['SkirtShade']],bands=lambda k,i:1 if (i<10 or 22<i<42 or i>54) else 0)
    else:
        profile('Outfit.Trousers.Waist',[(.888,.146,.091),(.927,.159,.099),(.940,.158,.099)],MATERIALS['Trousers'],'Clothing')
        for s in [-1,1]:
            rows=[(.152,.064,.060),(.175,.067,.063),(.270,.069,.067),(.430,.067,.066),(.560,.066,.065),(.710,.077,.073),(.850,.089,.085),(.919,.084,.078)]
            rings=[]
            for z,w,d in rows:
                cx=s*(.080 if z<.56 else .070)
                rings.append([(cx+w*math.cos(i*2*math.pi/32),d*math.sin(i*2*math.pi/32),z) for i in range(32)])
            bridge('Outfit.WideTrousers.'+str(s),rings,MATERIALS['Trousers'],'Clothing',mats=[MATERIALS['Trousers'],MATERIALS['TrousersShade']],bands=lambda k,i:1 if 3<i<13 else 0)
    for side in [-1,1]:
        shoulder=Vector((side*.155*scale,0,1.360*scale));wristz=.906*scale
        wrist=Vector((side*(.155*scale+math.tan(math.radians(30))*(shoulder.z-wristz)),-.007*scale,wristz))
        elbow=shoulder.lerp(wrist,.53);elbow.y=.003*scale
        tube('Body.Arm.'+str(side),[(shoulder,.048*scale,.047*scale),(elbow,.036*scale,.038*scale),(wrist,.021*scale,.022*scale)],MATERIALS['Skin'],'Body',24)
        sleeve(side,shoulder,elbow,wrist,scale)
        axis=(wrist-elbow).normalized();hand(side,wrist,axis,scale)
        if not female and side==1:watch(wrist,axis)
        shoe(side,scale)
        if female:
            tube('Body.Leg.'+str(side),[((side*.077,.006,.905),.060,.061),((side*.078,.012,.550),.040,.040),((side*.078,.025,.210),.033,.034),((side*.078,.035,.115),.028,.030)],MATERIALS['Skin'],'Body',28)
    profile('Body.Neck',[(collar-.020,.050*scale,.042*scale),(SPEC['chin']+.011,.042*scale,.039*scale),(SPEC['chin']+.043,.047*scale,.042*scale)],MATERIALS['Skin'],'Body',40)

def create_materials(sex):
    female=sex=='female'
    palette={'Skin':'#FFDECC' if female else '#FEE2CC','SkinShade':'#B37B62','Hair':'#875742' if female else '#5D463A','HairShadow':'#654332' if female else '#49352B','EyeWhite':'#FFFCF6','Iris':'#497D87' if female else '#699679','Pupil':'#263E39','Ink':'#684936','Cotton':'#FDF9F2','Sweatshirt':'#3D6852' if female else '#FEE973','SweatshirtShade':'#31563F' if female else '#E0C954','Skirt':'#FEF7E9','SkirtShade':'#E2D4B8','Trousers':'#314D44','TrousersShade':'#293F37','Shoe':'#B0AABC' if female else '#BA8650','Sole':'#F1E5CC','Socks':'#FEF7EB','Accessory':'#EAE5CE' if female else '#1D5A5C'}
    for name,col in palette.items():material(name,col,.12 if name in ['Iris','EyeWhite','Pupil'] else 0)

def bounds(objects):
    dg=bpy.context.evaluated_depsgraph_get();coords=[]
    for o in objects:
        e=o.evaluated_get(dg);me=e.to_mesh();coords.extend([e.matrix_world@v.co for v in me.vertices]);e.to_mesh_clear()
    return [min(v[i] for v in coords) for i in range(3)],[max(v[i] for v in coords) for i in range(3)]

def setup_stage(height):
    scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=64
    scene.render.resolution_x=1152;scene.render.resolution_y=1536;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.72,.72,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    stage=bpy.data.collections.new('RenderStage_NotExported');scene.collection.children.link(stage)
    def light(name,loc,power,size):
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);stage.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,height*.60))-o.location).to_track_quat('-Z','Y').to_euler()
    light('SoftKey',(-3.2,-4.2,5),360,4.2);light('Fill',(3,-2.8,3),220,4.0);light('Rim',(0,3.0,4),280,3.0)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.003));floor=bpy.context.object;floor.name='Stage.Floor_NotExported';floor.data.materials.append(material('StageFloor','#E5E5E5'))
    d=bpy.data.cameras.new('ReviewCamera');cam=bpy.data.objects.new('ReviewCamera',d);stage.objects.link(cam);cam.data.type='ORTHO';scene.camera=cam
    return cam

def camera_view(cam,angle,height,close=False):
    target=Vector((0,0,height*.55 if not close else height-.15))
    a=math.radians(angle);cam.location=Vector((5*math.sin(a),-5*math.cos(a),target.z+(.24 if angle in [25,35] else 0)))
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=2.01 if not close else .46

def render(cam,id,name,angle,height,fast=False,close=False):
    scene=bpy.context.scene;camera_view(cam,angle,height,close);scene.render.film_transparent=False
    scene.render.resolution_x=768 if fast else (1152 if not close else 1024);scene.render.resolution_y=1024 if fast else (1536 if not close else 1024)
    p=ROOT/'previews'/(id+'-'+name+'.png');scene.render.filepath=str(p);bpy.ops.render.render(write_still=True)
    return {'file':str(p.relative_to(ROOT)),'angle_deg':angle,'camera_ortho_scale':cam.data.ortho_scale,'resolution':[scene.render.resolution_x,scene.render.resolution_y]}

def initialize(sex):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for d in list(bpy.data.collections):bpy.data.collections.remove(d)
    global MODEL,COLLECTIONS,MATERIALS,SPEC
    MODEL=[];COLLECTIONS={};MATERIALS={}
    h=1.72 if sex=='male' else 1.60;ratio=6.545945945945946 if sex=='male' else 6.51912568306011
    SPEC={'sex':sex,'height':h,'head_height':h/ratio,'chin':h-h/ratio,'head_ratio':ratio}
    for name in ['Body','Face','Hair','Clothing','Accessories']:
        c=bpy.data.collections.new(name+'__Editable');bpy.context.scene.collection.children.link(c);COLLECTIONS[name]=c
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
    create_materials(sex)

def inspect(id):
    dg=bpy.context.evaluated_depsgraph_get();tri=0;parts=[];nonfinite=[]
    for o in MODEL:
        e=o.evaluated_get(dg);m=e.to_mesh();m.calc_loop_triangles();tri+=len(m.loop_triangles)
        for v in m.vertices:
            if not all(math.isfinite(x) for x in v.co):nonfinite.append(o.name)
        parts.append({'name':o.name,'role':o.get('partRole'),'vertices':len(m.vertices),'triangles':len(m.loop_triangles),'materials':[x.name for x in m.materials]});e.to_mesh_clear()
    lo,hi=bounds(MODEL);assert not nonfinite;assert tri<=30000,(id,tri);assert abs(hi[2]-lo[2]-SPEC['height'])<.001
    return {'id':id,'phase':'static-form-review-not-final','selection':'provisional A','native_bounds_m':[lo,hi],'height_m':hi[2]-lo[2],'native_floor_z_m':lo[2],'triangles':tri,'mesh_parts':parts,'materials':{n:m.get('sourceHex') for n,m in MATERIALS.items() if n!='StageFloor'},'textures':0,'texture_max_px':0,'bones':0,'animations':[],'head_ratio_target':SPEC['head_ratio'],'head_chin_z_m':SPEC['chin'],'native_front':'-Y','glTF_front':'+Z','glTF_up':'+Y','approved_reference_head':'1f1815e5ca7aca53d0893152e9f2926877c05c68','user_3D_approval':False,'not_tested':['rig/deformation','idle/walk/sit','walk foot-contact and in-place drift','skirt collision while animated','browser/app/device integration']}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--fast',action='store_true');parser.add_argument('--sex',choices=['male','female','both'],default='both');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for d in ['sources','models','previews','qa']:(ROOT/d).mkdir(exist_ok=True)
    for sex in (['male','female'] if args.sex=='both' else [args.sex]):
        initialize(sex);id='walker-'+sex+'-home-a-preview';face();hair();clothing_body()
        # Exact height and contact plane, using mesh vertices rather than stale object.dimensions.
        lo,hi=bounds(MODEL);s=SPEC['height']/(hi[2]-lo[2]);cy=(lo[1]+hi[1])/2
        for o in MODEL:
            for v in o.data.vertices:v.co=Vector((v.co.x*s,(v.co.y-cy)*s,(v.co.z-lo[2])*s))
        bpy.context.view_layer.update()
        # Unwrap all meshes together; material regions remain separate editable objects.
        bpy.ops.object.select_all(action='DESELECT')
        for o in MODEL:o.select_set(True)
        bpy.context.view_layer.objects.active=MODEL[0];bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')
        result=inspect(id)
        bpy.ops.object.select_all(action='DESELECT')
        for o in MODEL:o.select_set(True)
        bpy.context.view_layer.objects.active=MODEL[0]
        bpy.ops.export_scene.gltf(filepath=str(ROOT/'models'/(id+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_materials='EXPORT',export_animations=False,export_cameras=False)
        cam=setup_stage(SPEC['height']);camera_view(cam,25,SPEC['height'])
        # Pack both approved outfit references for this gender, without changing source PNGs.
        refcol=bpy.data.collections.new('ApprovedAandBReferences_NotExported');bpy.context.scene.collection.children.link(refcol)
        result['references']=[]
        for variant in ['a','b']:
            p=REFERENCES/('attached-'+sex+'-'+variant+'-front.png');img=bpy.data.images.load(str(p),check_existing=True);img.pack()
            e=bpy.data.objects.new('Reference.'+sex+'.'+variant,None);e.empty_display_type='IMAGE';e.data=img;e.hide_render=True;e.hide_viewport=True;refcol.objects.link(e)
            result['references'].append({'file':str(p.relative_to(REPO)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'selected':variant=='a'})
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'sources'/(id+'.blend')))
        result['renders']=[]
        views=[('three-quarter',25)] if args.fast else [('front',0),('three-quarter',25),('side',90),('back',180),('face',0)]
        for name,angle in views:result['renders'].append(render(cam,id,name,angle,SPEC['height'],args.fast,name=='face'))
        (ROOT/'qa'/(id+'-source-validation.json')).write_text(json.dumps(result,indent=2)+'\n')
        print('ASSET_DONE',id,'triangles',result['triangles'],'height',result['height_m'],flush=True)

if __name__=='__main__':main()
