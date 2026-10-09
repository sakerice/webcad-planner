"""Original, measured period sleeping furniture; family-local authoring only.
No external meshes, imagery, textures, paid generation, or application changes.
Blender metres/Z-up/-Y foot-end export as glTF +Y-up/+Z foot-end.
"""
from pathlib import Path
import sys,math,json,struct,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sys.path[:0]=[str(HERE),str(HERE.parent),str(HERE.parents[1])]
import bpy,bmesh
from mathutils import Vector
import model_kit as kit
from build_decor import lathe
from shape_kit import rounded_rect
from export_contract import export
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion';WORK=HERE/'sources';EVIDENCE=HERE/'evidence'
kit.GLB_DIR=PACK/'models';kit.PREVIEW_DIR=PACK/'previews';kit.WORK_DIR=WORK;kit.export=export
P={};PARTS=[]

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def palette():
 global P
 P={}
 for k,n,c,ch,r,m in [('wood','Walnut structural heartwood','#533624','wood',.39,0),('trim','Polished walnut mouldings','#704b32','wood',.35,0),('iron','Wrought iron scrollwork','#323a39','metal',.44,.72),('brass','Aged brass joints and finials','#af8e4b','metal',.32,.78),('linen','Ivory woven mattress and pillows','#ded5bd','bedding',.84,0),('cover','Deep teal velvet bed cover','#355c57','cover',.91,0),('upholstery','Muted burgundy upholstered divan','#713e45','upholstery',.90,0)]:
  ob=kit.matp(n,c,r,m);ob['finishChannel']=ch;P[k]=ob

def normals(ob):
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 # Enforce outward winding for every closed connected native component.
 unseen=set(bm.faces)
 while unseen:
  first=unseen.pop();stack=[first];faces={first}
  while stack:
   f=stack.pop()
   for e in f.edges:
    for q in e.link_faces:
     if q in unseen:unseen.remove(q);faces.add(q);stack.append(q)
  volume=0
  for f in faces:
   v=[q.co for q in f.verts]
   for i in range(1,len(v)-1):volume+=v[0].dot(v[i].cross(v[i+1]))/6
  if volume<0:bmesh.ops.reverse_faces(bm,faces=list(faces))
 bm.to_mesh(ob.data);bm.free();ob.data.update();return ob

def keep(ob,role='structure'):
 normals(ob);ob['constructionPart']=ob.name;ob['role']=role;PARTS.append(ob);return ob

def box(name,c,s,m='wood',r=.003,role='structure'):
 return keep(kit.box(name,[c[i]-s[i]/2 for i in range(3)],[c[i]+s[i]/2 for i in range(3)],P[m],min(r,min(s)/3),1),role)

def shell(name,rings,m='wood',role='structure'):
 return keep(kit.shell(name,rings,[P[m]],[0]*(len(rings)-1)),role)

def radial(name,rows,x,y,m='wood',n=10,role='structure'):
 return keep(lathe(name,rows,P[m],x,y,n),role)

def rod(name,a,b,r=.012,m='brass',sides=10,role='structure'):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=(b-a).length,location=(a+b)/2)
 ob=bpy.context.object;ob.name=name;ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();ob.data.materials.append(P[m]);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);return keep(ob,role)

def sweep(name,points,r=.018,m='iron',sides=8,role='structure'):
 pts=[Vector(p)for p in points];rings=[]
 for i,p in enumerate(pts):
  t=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized();u=t.cross(Vector((0,1,0)))
  if u.length<.01:u=t.cross(Vector((1,0,0)))
  u.normalize();v=t.cross(u).normalized()
  rings.append([tuple(p+r*(u*math.cos(j*math.tau/sides)+v*math.sin(j*math.tau/sides)))for j in range(sides)])
 return shell(name,rings,m,role)

def prism_x(name,profile,x0,x1,m='wood'):
 n=len(profile);vs=[(x,y,z)for x in [x0,x1]for y,z in profile];fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.materials.append(P[m]);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);return keep(ob)

def cushion(name,w,d,z0,z1,cx=0,cy=0,m='linen',r=.08,role='bedding'):
 r=min(r,w/4,d/4);t=z1-z0;lip=min(.025,t*.25)
 return shell(name,[rounded_rect(cx,cy,w-.045,d-.045,max(.008,r-.023),z0,3),rounded_rect(cx,cy,w,d,r,z0+lip,3),rounded_rect(cx,cy,w,d,r,z1-lip,3),rounded_rect(cx,cy,w-.07,d-.07,max(.008,r-.035),z1,3)],m,role)

def bedframe(w,d,base=.37,legs='turned',material='wood',prefix='Bed'):
 # Open, load-bearing frame: actual side rails, end rails, cleats, slats and centre bearer.
 xp=w/2-.065;yp=d/2-.115
 for x in [-xp,xp]:
  for y in [-yp,yp]:
   if legs=='turned':radial(prefix+' turned ground leg',[(.034,0),(.039,.025),(.028,.075),(.020,.155),(.032,.225),(.035,base+.013)],x,y,material,n=10,role='ground-support')
   else:rod(prefix+' iron ground post',(x,y,0),(x,y,base+.012),.025,material,10,'ground-support')
 for x in [-w/2+.035,w/2-.035]:box(prefix+' longitudinal mortised side rail',(x,0,base-.052),(.050,d-.158,.135),material,.005)
 for y in [-yp,yp]:box(prefix+' tenoned end rail',(0,y,base-.050),(w-.068,.054,.140),material,.005)
 for x in [-w/2+.061,w/2-.061]:box(prefix+' inner slat support cleat',(x,0,base-.020),(.039,d-.162,.037),material,.002)
 box(prefix+' centre mattress bearer',(0,0,base-.029),(.050,d-.160,.060),material,.003)
 for i in range(12):box(prefix+' transverse mattress slat %02d'%i,(0,-d/2+.158+i*(d-.316)/11,base-.003),(w-.090,.090,.021),'wood',.002,'mattress-support')
 # A fifth middle foot prevents an implausible long-span stringer.
 radial(prefix+' centre bearer ground support',[(.025,0),(.028,.021),(.022,base-.028)],0,0,material,8,'ground-support')
 return base+.007

def bedding(w,d,z0,capacity=1,cy=0):
 mw=w-.132;md=d-.254
 cushion('Linen mattress supported by wooden slats',mw,md,z0-.003,z0+.165,cy=cy,r=.072,role='mattress')
 top=z0+.165
 cushion('Thick teal cover with turned-down top',mw+.021,md-.39,top-.009,top+.040,cy=cy-.185,m='cover',r=.055,role='cover')
 # Fold is a real attached volume resting on the main duvet.
 cushion('Attached folded cover bolster',mw-.040,.15,top+.028,top+.054,cy=cy+.414,m='cover',r=.038,role='cover')
 for j in range(capacity):
  x=0 if capacity==1 else (j-(capacity-1)/2)*mw/capacity
  cushion('Inflated linen sleeping pillow %d'%(j+1),min(.57,mw/capacity-.09),.335,top-.007,top+.107,cx=x,cy=cy+md/2-.231,r=.083,role='pillow')
 return top

def sleigh(w=1.660,d=2.300,h=1.150,capacity=2):
 base=bedframe(w,d,.365)
 for sx in [-1,1]:
  for y in [-d/2+.210,d/2-.210]:rod('Sleigh brass rail joint bolt',(sx*(w/2-.035),y,.325),(sx*(w/2-.004),y,.325),.012,'brass',10)
 # Swept, bent board silhouettes with rolled top rails and a solid foot-end sweep.
 for sign,top in [(1,h),(-1,.770)]:
  z0=.255;n=13;outer=[];inner=[]
  for i in range(n):
   t=i/(n-1);z=z0+(top-z0)*t;yy=sign*(d/2-.094-.080*math.sin(math.pi*t)+.067*t*t)
   outer.append((yy,z));inner.append((yy-sign*.036,z))
  prism_x(('Head'if sign==1 else'Foot')+' continuous curved sleigh board',outer+list(reversed(inner)),-w/2,w/2,'wood')
  field=[(y-sign*.040,z)for y,z in outer[2:-1]]
  backing=[(y+sign*.012,z)for y,z in field]
  prism_x(('Head'if sign==1 else'Foot')+' curved raised walnut inset',field+list(reversed(backing)),-w/2+.065,w/2-.065,'trim')
  # Real wood breadboard trim through the outer board, not floating decals.
  rod(('Head'if sign==1 else'Foot')+' rolled walnut crown',(-w/2+.027,outer[-1][0],top-.027),(w/2-.027,outer[-1][0],top-.027),.027,'trim',12)
  for x in [-w/2+.048,w/2-.048]:
   sweep('Sleigh curved end stile',[(x,y-sign*.009,z)for y,z in outer[:-1]],.024,'trim',8)
 depth_offset=.138 if capacity==2 else .086
 top=bedding(w,d-depth_offset,base,capacity)
 return dict(mattressTopM=top,mattressSupportM=base,sleepingCapacity=capacity,mattressDimensionsM=[w-.132,d-.254-depth_offset,.165],topology='continuous-bent-head-and-foot-boards/rolled-crowns/open-slat-frame/five-ground-legs')

def iron_scroll():
 w,d,h=1.100,2.120,1.220;base=bedframe(w,d,.337,legs='iron',material='iron',prefix='Iron bed')
 for sign,top in [(1,h),(-1,.760)]:
  y=sign*(d/2-.034);xx=w/2-.034
  for sx in [-1,1]:rod('Iron end-post rail connector',(sx*xx,sign*(d/2-.115),.337),(sx*xx,y,.337),.016,'iron',8)
  for x in [-xx,xx]:
   rod('Scroll bed continuous end post',(x,y,0),(x,y,top-.037),.023,'iron',10,'ground-support')
   radial('Brass post acorn finial',[(.014,top-.055),(.034,top-.039),(.028,top-.015),(.010,top)],x,y,'brass',12)
  arch=[(-xx+2*xx*i/14,y,top-.128+.075*math.sin(math.pi*i/14))for i in range(15)]
  sweep('Arched iron top rail',arch,.017,'iron',8)
  rod('Scrollwork lower joining rail',(-xx,y,.456),(xx,y,.456),.016,'iron',8)
  for x in [-.345,0,.345]:rod('Vertical iron spindle',(x,y,.447),(x,y,top-.135+.071*math.cos(x/xx*math.pi/2)),.010,'iron',8)
  # Two S-scrolls in each panel. Ends terminate within real spindles/rails.
  for s in [-1,1]:
   startz=.504;endt=top-.141
   pts=[]
   for i in range(13):
    t=i/12;pts.append((s*(.170+.119*math.sin(math.tau*t)),y,startz+(endt-startz)*t))
   sweep('Curved attached S-scroll',pts,.009,'iron',8)
   # Mounting collars connect the S-scroll ends to adjacent rails.
   rod('Scroll lower welded attachment',(s*.170,y,.456),(s*.170,y,startz+.005),.011,'iron',8)
   zz=top-.128+.075*math.sin(math.pi*(s*.170+xx)/(2*xx))
   rod('Scroll upper welded attachment',(s*.170,y,endt-.005),(s*.170,y,zz),.011,'iron',8)
 top=bedding(w,d+.084,base,1)
 return dict(mattressTopM=top,mattressSupportM=base,sleepingCapacity=1,mattressDimensionsM=[w-.132,d-.170,.165],topology='arched-wrought-iron-head-foot/open-spindles/four-S-scrolls/brass-finials/open-slat-frame')

def divan():
 w,d,h=1.000,2.140,.920
 # Low upholstered divan has exposed walnut legs and a padded rail perimeter.
 xp=w/2-.092;yp=d/2-.116
 for x in [-xp,xp]:
  for y in [-yp,yp]:radial('Divan short turned walnut foot',[(.030,0),(.039,.020),(.028,.075),(.040,.180)],x,y,'trim',10,'ground-support')
 box('Divan walnut bottom support frame',(0,0,.193),(w-.045,d-.072,.060),'wood',.006)
 for x in [-w/2+.043,w/2-.043]:box('Divan upholstered side apron',(x,0,.269),(.086,d-.092,.160),'upholstery',.018)
 for y in [-d/2+.044,d/2-.044]:box('Divan upholstered end apron',(0,y,.223),(w-.050,.088,.104),'upholstery',.018)
 for i in range(12):box('Divan sprung-deck wooden slat %02d'%i,(0,-d/2+.152+i*(d-.304)/11,.346),(w-.118,.100,.025),'wood',.002,'mattress-support')
 # Three-sided low chaise/daybed: a tall rounded head and a low curved foot.
 for sign,height in [(1,h),(-1,.610)]:
  y=sign*(d/2-.056)
  box('Divan padded end structural board',(0,y,(.21+height-.044)/2),(w-.080,.065,height-.254),'wood',.009)
  # Inflated upholstery cap envelops and touches the structural end board.
  ob=cushion('Divan padded curved end',w-.025,.112,.265,height,cy=y,m='upholstery',r=.049,role='upholstery')
  rod('Divan rolled upholstered crown',(-w/2+.049,y,height-.042),(w/2-.049,y,height-.042),.042,'upholstery',12,'upholstery')
 # A low continuous back on the right long side makes the form a daybed.
 box('Divan side back structural rail',(.447,.020,.503),(.048,d-.195,.320),'wood',.008)
 box('Divan padded side back',(.450,.020,.532),(.100,d-.193,.355),'upholstery',.035,'upholstery')
 base=.357;top=bedding(w-.040,d+.012,base,1)
 return dict(mattressTopM=top,mattressSupportM=.3585,sleepingCapacity=1,mattressDimensionsM=[w-.172,d-.242,.165],topology='low-upholstered-three-sided-divan/rolled-ends/long-side-back/open-sprung-slat-deck/four-short-turned-feet')

SPECS=[('sleigh-double-bed','曲木のそり型ダブルベッド',(1660,2300,1150),sleigh,'A double sleeping bed with curved solid walnut head and foot boards, rolled crowns and two pillows'),('iron-scroll-single-bed','鉄の曲線装飾シングルベッド',(1100,2120,1220),iron_scroll,'A one-person open iron spindle bed with attached S-scrolls and brass acorn post finials'),('upholstered-divan-bed','布張り三方背の低いディバンベッド',(1000,2140,920),divan,'A one-person low upholstered daybed with unequal rolled ends and one continuous long-side back')]

import forms
SPECS+=forms.add_specs(sys.modules[__name__])

def metric_uv(ob):
 """Independent face charts in real metres, warped quads unfolded on actual diagonals.
 All face charts are rectangle packed with uniform scale; never Smart UV.
 """
 me=ob.data;me.calc_loop_triangles();layer=me.uv_layers.active or me.uv_layers.new(name='UVMap');tris={}
 for tri in me.loop_triangles:tris.setdefault(tri.polygon_index,[]).append(tuple(tri.vertices))
 charts=[]
 for p in me.polygons:
  pts={i:ob.matrix_world@me.vertices[i].co for i in p.vertices};pair=tris[p.index]
  if len(p.vertices)==4 and len(pair)==2:
   a,b=sorted(set(pair[0])&set(pair[1]));c=next(i for i in pair[0]if i not in {a,b});d=next(i for i in pair[1]if i not in {a,b});length=(pts[b]-pts[a]).length;assert length>1e-10
   sign=1 if any(tuple(pair[0][k:]+pair[0][:k])==(a,b,c)for k in range(3))else -1;q={a:(0.,0.),b:(length,0.)}
   for idx,sgn in [(c,sign),(d,-sign)]:
    ac=(pts[idx]-pts[a]).length;bc=(pts[idx]-pts[b]).length;x=(ac*ac+length*length-bc*bc)/(2*length);y=math.sqrt(max(0,ac*ac-x*x));assert y>1e-10;q[idx]=(x,sgn*y)
   xy=[q[i]for i in p.vertices]
  else:
   coords=list(pts.values());edges=[coords[(i+1)%len(coords)]-coords[i]for i in range(len(coords))];u=max(edges,key=lambda q:q.length).normalized();n=(ob.matrix_world.to_3x3().inverted().transposed()@p.normal).normalized();v=n.cross(u).normalized();xy=[(pts[i].dot(u),pts[i].dot(v))for i in p.vertices]
  lo=[min(q[i]for q in xy)for i in range(2)];ww=max(q[0]for q in xy)-lo[0];hh=max(q[1]for q in xy)-lo[1];q=[(a-lo[0],b-lo[1])for a,b in xy]
  if hh>ww:q=[(b,a)for a,b in q];ww,hh=hh,ww
  charts.append((p.index,ww,hh,q))
 gap=.003;target=max(max(q[1]for q in charts)+2*gap,math.sqrt(sum((q[1]+gap)*(q[2]+gap)for q in charts))*1.08)
 x=y=gap;rowh=0;placed=[];maxx=0
 for idx,w,h,q in sorted(charts,key=lambda q:-q[2]):
  if x+w+gap>target and x>gap:y+=rowh+gap;x=gap;rowh=0
  placed.append((idx,x,y,q));maxx=max(maxx,x+w+gap);x+=w+gap;rowh=max(rowh,h)
 scale=max(maxx,y+rowh+gap)
 for idx,x,y,q in placed:
  for li,(u,v)in zip(me.polygons[idx].loop_indices,q):layer.data[li].uv=((x+u)/scale,(y+v)/scale)
 for q in list(me.uv_layers)[1:]:me.uv_layers.remove(q)
 layer.active_render=True;me.update();ob['metricFaceUvAtlas']=True

kit.unwrap=metric_uv

def save_authoring(stem,fn):
 global PARTS
 PARTS=[];palette();features=fn();scene=bpy.context.scene;scene.name='Native authoring parts '+stem;scene.render.filepath='//renders/'+stem+'.png';scene['front']='-Y foot-end';scene['up']='+Z';scene['units']='metres';scene['provenance']='Original project-authored procedural geometry';scene['geometrySignature']=features['topology']
 for ob in PARTS:metric_uv(ob)
 path=HERE/'authoring_sources'/(stem+'.blend');path.parent.mkdir(parents=True,exist_ok=True);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
 bpy.ops.scene.new(type='FULL_COPY');bpy.context.scene.name='Validated export mesh '+stem;obj=kit.combine([o for o in bpy.context.scene.objects if o.type=='MESH']);obj['features']=json.dumps(features);return obj

def annotate(path):
 raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);doc['asset']['extras']={'front':'+Z','frontMeaning':'foot-end','up':'+Y','units':'metres','origin':'bottom-centre','packId':'rpg-mansion','provenance':'Original procedural Blender geometry; no external mesh or image','source':'tools/blender/rpg_mansion/scaled_beds/build.py','dimensionBasis':'Intended period-adapted design; missing legacy geometry unverified'}
 payload=json.dumps(doc,separators=(',',':')).encode();payload+=b' '*(-len(payload)%4);rest=raw[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(payload)+len(rest))+struct.pack('<II',len(payload),0x4e4f534a)+payload+rest)

def render(obj,path,view='thumb'):
 for ob in list(bpy.context.scene.objects):
  if ob!=obj:bpy.data.objects.remove(ob,do_unlink=True)
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=False;scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='AgX'
 world=bpy.data.worlds.new('Neutral product studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.78,.82,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
 points=[obj.matrix_world@v.co for v in obj.data.vertices];lo=Vector(tuple(min(p[i]for p in points)for i in range(3)));hi=Vector(tuple(max(p[i]for p in points)for i in range(3)));span=max(hi-lo);target=(lo+hi)/2
 for name,power,loc,size in [('Key',450,(span*2,-span*3,span*3),span*3),('Fill',200,(-span*2,-span,span*1.7),span*2),('Rim',150,(span,span*2,span*2.4),span*2)]:
  bpy.ops.object.light_add(type='AREA',location=loc);ob=bpy.context.object;ob.name=name;ob.data.energy=power;ob.data.shape='DISK';ob.data.size=size;ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
 if view=='top':loc=(0,0,span*4);scale=max((hi-lo)[:2])*1.16
 elif view=='front':loc=(0,-span*4,target.z);scale=max(hi.x-lo.x,hi.z-lo.z)*1.18
 elif view=='rear':loc=(-span*2.4,span*3.7,span*2.9);scale=span*1.20
 else:loc=(span*2.4,-span*3.7,span*2.9);scale=span*1.20
 bpy.ops.object.camera_add(location=loc);ob=bpy.context.object;ob.data.type='ORTHO';ob.data.ortho_scale=scale;ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler();scene.camera=ob
 # Fit real projected mesh bounds with an 8% margin, including tall canopy/bunk silhouettes.
 bpy.context.view_layer.update();local=[ob.matrix_world.inverted()@p for p in points];xmin=min(p.x for p in local);xmax=max(p.x for p in local);ymin=min(p.y for p in local);ymax=max(p.y for p in local)
 right=ob.rotation_euler.to_matrix()@Vector((1,0,0));up=ob.rotation_euler.to_matrix()@Vector((0,1,0));ob.location+=right*((xmin+xmax)/2)+up*((ymin+ymax)/2);ob.data.ortho_scale=max(scale,(xmax-xmin)*1.08,(ymax-ymin)*1.08)
 path.parent.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);strip_metadata(path)

def main():
 only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else None;items=json.loads((HERE/'bed-items.json').read_text())['items']if (HERE/'bed-items.json').exists()else []
 for slug,name,size,fn,meaning in SPECS:
  if only and slug not in only:continue
  stem='rpg-mansion-'+slug+'-01';bpy.ops.wm.read_factory_settings(use_empty=True);channels={'wood','upholstery','bedding','cover'}if slug=='upholstered-divan-bed'else {'wood','metal','bedding','cover','rope'}if slug=='rope-sprung-single-bed'else {'wood','metal','bedding','cover'}
  ob=kit.run([(stem,size,lambda:save_authoring(stem,fn),channels,6000)],do_icons=False)[0];features=json.loads(ob['features']);path=kit.GLB_DIR/(stem+'.glb');annotate(path)
  # Sources remain camera/light-free; generated images do not mutate saved sources.
  if '--no-icons'not in sys.argv:
   for view,out in [('thumb',kit.PREVIEW_DIR/(stem+'-thumb.png')),('top',kit.PREVIEW_DIR/(stem+'-top.png')),('front',EVIDENCE/(stem+'-front.png')),('rear',EVIDENCE/(stem+'-rear.png'))]:render(ob,out,view)
  rel=lambda p:str(p.relative_to(ROOT));item=dict(id=stem,name=name,packId='rpg-mansion',kind='bed',group='家具',category='ベッド',model=rel(path),thumb=rel(kit.PREVIEW_DIR/(stem+'-thumb.png')),top=rel(kit.PREVIEW_DIR/(stem+'-top.png')),front=rel(EVIDENCE/(stem+'-front.png')),rear=rel(EVIDENCE/(stem+'-rear.png')),sourceBlend=rel(WORK/(stem+'.blend')),exportBlend=rel(WORK/(stem+'.blend')),authoringBlend=rel(HERE/'authoring_sources'/(stem+'.blend')),validation=rel(WORK/(stem+'-validation.json')),builder=rel(HERE/'build.py'),w=size[0],d=size[1],h=size[2],defaultElevation=0,provenance='original',placementHint='floor',semanticCoverage=meaning,dimensionBasis='Intended period-adapted design; declared standard dimensions are demand references only; legacy model geometry missing and unverified',footprintSemanticEquivalenceVerified=False,nativeFunctionEquivalencePromised=False,features=features,finishChannels=[dict(key=c,label={'wood':'木部','metal':'金属','bedding':'寝具','cover':'掛け布','upholstery':'張り布','rope':'支持ロープ'}[c],default={'wood':'#533624','metal':'#af8e4b','bedding':'#ded5bd','cover':'#355c57','upholstery':'#713e45','rope':'#b6a184'}[c])for c in sorted(channels)],sha256=sha(path),sourceSha256=sha(WORK/(stem+'.blend')))
  items=[i for i in items if i['id']!=stem]+[item];(HERE/'bed-items.json').write_text(json.dumps(dict(set='rpg-mansion',name='洋館・寝具家具試作',items=items),indent=2,ensure_ascii=False)+'\n');print('BED_READY',stem,flush=True)
if __name__=='__main__':main()
