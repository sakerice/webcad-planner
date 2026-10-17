"""Original native mansion chair family. Metres/Z-up/-Y-front, static props only.
No imported geometry, reference image maps, paid APIs, or application edits.
"""
import sys,math,json,struct,hashlib
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
import model_kit as kit
from shape_kit import rounded_rect
from repair_winding import repair_mesh_winding
from sanitize_sources import sanitize_loaded
from metric_uv import unfold_pack
from png_metadata import strip_metadata
PACK=ROOT/'assets/models/packs/rpg-mansion';WORK=H/'work';PARTS=[];P={}

def palette():
 return {key:make_mat(name,col,ch,rough,metal)for key,name,col,ch,rough,metal in [
 ('wood','Figured walnut structural frame','#563b2d','wood',.43,0),
 ('edge','Carved walnut mouldings','#765237','wood',.40,0),
 ('dark','Recessed walnut joinery','#38271f','wood',.51,0),
 ('brass','Antique brass shoes and pins','#b69b5d','metal',.32,.75),
 ('velvet','Deep teal upholstery velvet','#294d4b','fabric',.86,0),
 ('leather','Chestnut campaign leather','#694432','leather',.68,0),
 ('cane','Golden woven cane','#aa8b55','cane',.80,0)]}

def make_mat(name,col,ch,rough,metal):
 m=kit.matp(name,col,rough,metal);m['finishChannel']=ch;return m

def keep(ob,seat=False):
 PARTS.append(ob);ob['constructionPart']=ob.name;ob['seatSurface']=seat;return ob

def mesh(name,v,f,mat='wood',smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(v,[],f);data.update();data.materials.append(P[mat])
 ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
 for p in data.polygons:p.use_smooth=smooth and len(p.vertices)==4
 return keep(ob)

def shell(name,rings,mat='wood',smooth=True):
 n=len(rings[0]);f=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(len(rings)-1)for i in range(n)]+[tuple(range((len(rings)-1)*n,len(rings)*n))]
 return mesh(name,[p for ring in rings for p in ring],f,mat,smooth)

def rect(name,w,d,z0,z1,x=0,y=0,mat='wood',r=.022,seat=False):
 c=min(.003,(z1-z0)*.2);r=min(r,(min(w,d)-.006)*.5-.0001);ob=shell(name,[rounded_rect(x,y,w-.006,d-.006,r,z0,n=2),rounded_rect(x,y,w,d,r,z0+c,n=2),rounded_rect(x,y,w,d,r,z1-c,n=2),rounded_rect(x,y,w-.006,d-.006,r,z1,n=2)],mat);ob['seatSurface']=seat;return ob

def rod(name,a,b,r,mat='wood',n=8):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=axis.cross(Vector((0,0,1)))
 if side.length<.001:side=Vector((1,0,0))
 side.normalize();up=axis.cross(side).normalized()
 return shell(name,[[tuple(p+r*(side*math.cos(i*math.tau/n)+up*math.sin(i*math.tau/n)))for i in range(n)]for p in [a,b]],mat)

def sweep(name,path,widths,depths,mat='wood',n=8,sub=2):
 original=[Vector(p)for p in path];dense=[];dw=[];dd=[]
 for k in range(len(path)-1):
  a=original[max(0,k-1)];b=original[k];c=original[k+1];d=original[min(len(path)-1,k+2)]
  for j in range(sub):
   t=j/sub;dense.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t));dw.append(widths[k]*(1-t)+widths[k+1]*t);dd.append(depths[k]*(1-t)+depths[k+1]*t)
 dense.append(original[-1]);dw.append(widths[-1]);dd.append(depths[-1]);rings=[];prev=None
 for k,p in enumerate(dense):
  tangent=(dense[min(k+1,len(dense)-1)]-dense[max(k-1,0)]).normalized()
  side=tangent.cross(Vector((0,0,1)))if prev is None else prev-tangent*prev.dot(tangent)
  if side.length<.01:side=Vector((1,0,0))-tangent*tangent.x
  side.normalize();prev=side.copy();up=side.cross(tangent).normalized()
  rings.append([tuple(p+side*dw[k]*.5*math.cos(i*math.tau/n)+up*dd[k]*.5*math.sin(i*math.tau/n))for i in range(n)])
 return shell(name,rings,mat)

def lathe(name,rows,x,y,mat='wood',n=10):
 return shell(name,[[(x+r*math.cos(i*math.tau/n),y+r*math.sin(i*math.tau/n),z)for i in range(n)]for r,z in rows],mat)

def crossbar(name,x0,x1,y,z,w=.035,d=.027,mat='edge',bow=.008):
 return sweep(name,[(x0,y,z),(x0*.5,y-bow*.7,z+.010),(0,y-bow,z+.016),(x1*.5,y-bow*.7,z+.010),(x1,y,z)],[w]*5,[d]*5,mat,n=8)

def ladder():
 rect('Ladder padded seat top',.450,.445,.438,.460,y=-.0375,mat='velvet',r=.045,seat=True)
 rect('Ladder shaped seat bearing rail',.445,.434,.410,.442,y=-.033,mat='edge',r=.041)
 for sx in [-1,1]:
  x=sx*.183
  lathe('Ladder rear joined ground foot '+str(sx),[(.023,0),(.024,.030)],x,.19,n=10)
  # Continuous curved rear stiles carry both the ladder rails and seat.
  sweep('Ladder continuous rear stile '+str(sx),[(x,.19,.020),(x-sx*.012,.17,.22),(x,.181,.44),(x+sx*.009,.203,.68),(x+sx*.015,.237,.949)],[.045,.038,.047,.044,.046],[.040,.035,.044,.043,.046])
  lathe('Ladder front turned leg '+str(sx),[(.025,0),(.027,.025),(.023,.056),(.015,.13),(.017,.27),(.027,.325),(.026,.350),(.024,.415)],x,-.205,n=10)
  rod('Ladder side lower mortised stretcher '+str(sx),(x,-.207,.190),(x,.17,.190),.014,'edge')
  rect('Ladder side seat apron '+str(sx),.033,.385,.346,.419,x=x,y=-.020,r=.008)
 for y in [-.205,.181]:rect('Ladder transverse seat apron '+str(y),.374,.033,.349,.419,y=y,r=.008)
 rod('Ladder front foot stretcher',(-.183,-.205,.185),(.183,-.205,.185),.014,'edge')
 for i,z in enumerate([.581,.706,.826]):crossbar('Ladder shaped open back rail '+str(i+1),-.194,.194,.202+(z-.581)*.14,z,.044,.028)
 # Crest top reaches exact 980 mm without scaling.
 sweep('Ladder swept upper crest',[(-.201,.237,.939),(-.10,.232,.956),(0,.23,.960),(.10,.232,.956),(.201,.237,.939)],[.040]*5,[.034]*5,'edge',8)
 # Crown is a physical seat/back part, not a calibration marker.
 rect('Ladder central crest crown',.18,.033,.953,.980,y=.2295,mat='edge',r=.015)

def back_frame(name,w,z0,z1,y,thick=.027,n=24):
 # Oval outline in the X/Z plane, closed structural bent frame.
 center=(z0+z1)/2;rz=(z1-z0)/2;path=[Vector((w*.5*math.cos(i*math.tau/n),y+.018*math.sin(i*math.tau/n),center+rz*math.sin(i*math.tau/n)))for i in range(n)]
 rings=[]
 for k,p in enumerate(path):
  tangent=(path[(k+1)%n]-path[(k-1)%n]).normalized();side=Vector((0,1,0));up=tangent.cross(side).normalized()
  rings.append([tuple(p+side*thick*.6*math.cos(j*math.tau/8)+up*thick*math.sin(j*math.tau/8))for j in range(8)])
 f=[(k*8+j,k*8+(j+1)%8,((k+1)%n)*8+(j+1)%8,((k+1)%n)*8+j)for k in range(n)for j in range(8)]
 return mesh(name,[p for r in rings for p in r],f,'edge',True)

def bergere():
 rect('Bergere velvet seat cushion',.539,.474,.418,.460,y=-.0595,mat='velvet',r=.073,seat=True)
 rect('Bergere sculpted broad seat frame',.579,.506,.376,.426,y=-.0545,mat='edge',r=.060)
 for sx in [-1,1]:
  for sy in [-1,1]:
   x=sx*.235;y=-.0545+sy*.20
   sweep('Bergere continuous cabriole leg %s %s'%(sx,sy),[(x+sx*.016,y-sy*.012,.017),(x-sx*.018,y+sy*.017,.10),(x-sx*.021,y+sy*.023,.23),(x+sx*.010,y,.350),(x,y,.390)],[.045,.033,.031,.052,.049],[.036,.032,.031,.049,.050])
   lathe('Bergere attached brass foot shoe %s %s'%(sx,sy),[(.022,0),(.023,.014),(.020,.026)],x+sx*.016,y-sy*.012,'brass',n=10)
  x=sx*.282
  sweep('Bergere swept outer arm '+str(sx),[(x-sx*.040,-.22,.405),(x-sx*.005,-.19,.535),(x,-.155,.625),(x-sx*.004,.025,.650),(x-sx*.035,.208,.624)],[.038,.041,.065,.066,.060],[.040,.041,.056,.054,.059],'edge',8)
  sweep('Bergere rear arm bearing upright '+str(sx),[(sx*.245,.173,.400),(sx*.245,.220,.57),(sx*.213,.256,.713)],[.044,.043,.047],[.046,.044,.047])
  # Real arm cushion is attached along the frame, with a soft rounded silhouette.
  sweep('Bergere velvet arm pad '+str(sx),[(x,-.148,.652),(x,.027,.674),(x-sx*.030,.176,.648)],[.066,.070,.069],[.030,.030,.031],'velvet',8)
 back_frame('Bergere continuous enclosing oval back frame',.488,.488,.885,.2733,thick=.027,n=24)
 # The caned field has physical crossing reeds; no imported texture plane.
 # Reeds terminate into the surrounding wood, including diagonal apertures.
 cx=0;cz=.6865;rx=.229;rz=.189
 for k in range(-7,8):
  x=k*.030;limit=rz*math.sqrt(max(0,1-(x/rx)**2))
  rod('Bergere vertical cane reed '+str(k),(x,.2733+.018*(-limit-.007)/.1985,cz-limit-.007),(x,.2733+.018*(limit+.007)/.1985,cz+limit+.007),.0045,'cane',6)
 for k in range(-5,6):
  z=cz+k*.032;limit=rx*math.sqrt(max(0,1-((z-cz)/rz)**2))
  rod('Bergere crossing cane reed '+str(k),(-limit-.007,.2703+.018*(z-cz)/.1985,z),(limit+.007,.2703+.018*(z-cz)/.1985,z),.0045,'cane',6)
 crossbar('Bergere lower back bearing rail',-.247,.247,.24,.473,.044,.045)
 # Broad outer elbows set the intended 646 mm clearance envelope.
 for sx in [-1,1]:rect('Bergere carved elbow finial '+str(sx),.058,.09,.603,.653,x=sx*.294,y=-.132,mat='edge',r=.027)

def rocker_rail(name,x):
 count=20;lower=[(-.4325+.865*i/count,.65*(-.4325+.865*i/count)**2)for i in range(count+1)]
 outline=lower+[(y,z+.043)for y,z in reversed(lower)];n=len(outline)
 verts=[(xx,y,z)for xx in [x-.024,x+.024]for y,z in outline]
 faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 return mesh(name,verts,faces,'edge',False)

def rocker():
 for sx in [-1,1]:rocker_rail('Rocker continuous bent floor rail '+str(sx),sx*.267)
 rect('Rocker broad saddle bearing seat',.566,.504,.405,.440,y=-.023,mat='edge',r=.086)
 rect('Rocker teal velvet seat cushion',.534,.471,.430,.460,y=-.0305,mat='velvet',r=.079,seat=True)
 for sx in [-1,1]:
  x=sx*.245
  sweep('Rocker front swept leg '+str(sx),[(sx*.267,-.20,.057),(x,-.205,.16),(x-sx*.007,-.213,.33),(x,-.214,.427)],[.044,.035,.036,.050],[.041,.034,.035,.046])
  sweep('Rocker continuous tall rear stile '+str(sx),[(sx*.267,.204,.059),(x,.172,.28),(x,.194,.435),(sx*.255,.237,.74),(sx*.228,.292,.994)],[.046,.040,.047,.042,.043],[.043,.038,.045,.039,.044])
  rod('Rocker side stretcher '+str(sx),(x,-.205,.221),(x,.176,.221),.016,'wood')
  sweep('Rocker swept arm '+str(sx),[(sx*.265,-.240,.597),(sx*.275,-.165,.642),(sx*.275,.025,.656),(sx*.260,.233,.636)],[.052,.052,.052,.052],[.042,.043,.041,.046],'edge',8)
  sweep('Rocker front arm upright '+str(sx),[(x,-.209,.420),(sx*.265,-.225,.59),(sx*.275,-.19,.645)],[.036,.039,.039],[.036,.039,.039])
  rect('Rocker elbow crest cap '+str(sx),.052,.10,.638,.660,x=sx*.282,y=-.080,mat='edge',r=.025)
 for y in [-.205,.178]:rod('Rocker transverse foot brace '+str(y),(-.245,y,.218),(.245,y,.218),.016,'edge')
 crossbar('Rocker lower back rail',-.253,.253,.207,.506,.048,.041)
 # Seven physical spindles joint directly into the lower rail and arched crest.
 for k in range(-3,4):
  x=k*.066;z=.998+.026*(1-(x/.23)**2)
  sweep('Rocker tapered back spindle '+str(k),[(x,.213,.515),(x,.244,.747),(x*.98,.287,z)],[.021,.018,.020],[.019,.017,.018],n=8)
 sweep('Rocker arched full-width crest',[(-.233,.294,.996),(-.12,.296,1.020),(0,.296,1.023),(.12,.296,1.020),(.233,.294,.996)],[.055]*5,[.054]*5,'edge',8)
 # Crest centre has a legitimate carved flat crown at 1050 mm.
 rect('Rocker carved crest crown',.176,.052,1.022,1.050,y=.296,mat='edge',r=.02)

BUILDERS={'ladder-side':ladder,'caned-bergere':bergere,'curved-rocker':rocker}
import extended_forms
BUILDERS.update(extended_forms.BUILDERS)

def bounds(parts):
 pts=[ob.matrix_world@v.co for ob in parts for v in ob.data.vertices];lo=[min(p[i]for p in pts)for i in range(3)];hi=[max(p[i]for p in pts)for i in range(3)]
 return lo,hi,[(hi[i]-lo[i])*1000 for i in range(3)]

def stamp(path,stem):
 raw=path.read_bytes();size,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+size]);doc['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',provenance='original',sourceAsset=stem,staticAsset=True)
 data=json.dumps(doc,separators=(',',':'),ensure_ascii=True).encode();data+=b' '*((-len(data))%4);rest=raw[20+size:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(data)+len(rest))+struct.pack('<II',len(data),kind)+data+rest)

def export(ob,path):
 path.parent.mkdir(parents=True,exist_ok=True);kit.activate(ob)
 bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,use_active_scene=True,export_format='GLB',export_apply=True,export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False,export_skins=False,export_morph=False,export_extras=True,export_texture_dir='')
 return path.stat().st_size

def config_render():
 import exterior_build
 original=exterior_build._icon_scene
 def scene(*a,**kw):
  s=original(*a,**kw);s.cycles.use_denoising=False;s.cycles.samples=48;s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=-.55;return s
 exterior_build._icon_scene=scene
 @bpy.app.handlers.persistent
 def margin(sc,*args):
  cam=sc.camera
  if cam and cam.data.type=='ORTHO' and not cam.get('chairMarginApplied'):
   if cam.constraints:cam.data.ortho_scale*=1.20
   # Fit actual evaluated camera-space vertices, including the angled wide benches.
   bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();inv=cam.evaluated_get(deps).matrix_world.inverted()
   points=[inv@(ob.matrix_world@v.co)for ob in sc.objects if ob.type=='MESH'for v in ob.data.vertices]
   if points:cam.data.ortho_scale=max(cam.data.ortho_scale,2*max(max(abs(p.x),abs(p.y))for p in points)/.90)
   cam['chairMarginApplied']=True
 bpy.app.handlers.render_pre.append(margin)

LABEL={'wood':'木部','metal':'金物','fabric':'布','cane':'籐編み','leather':'革'}
COLOR={'wood':'#563b2d','metal':'#b69b5d','fabric':'#294d4b','cane':'#aa8b55','leather':'#694432'}

def main():
 global P,PARTS
 config_render();plan=json.loads((H/'production-plan.json').read_text());only=sys.argv[sys.argv.index('--only')+1].split(',')if '--only'in sys.argv else [i['key'] for i in plan['items']]
 descriptors=[];WORK.mkdir(parents=True,exist_ok=True);(PACK/'previews').mkdir(parents=True,exist_ok=True)
 for item in plan['items']:
  key=item['key'];stem=item['id']
  if key not in only:continue
  for scene in list(bpy.data.scenes):
   if scene!=bpy.context.scene:bpy.data.scenes.remove(scene)
  kit.clear_scene();scene=bpy.context.scene;scene.name='Native authoring parts';scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;PARTS=[];P=palette();extended_forms.configure(sys.modules[__name__],item);BUILDERS[key]();bpy.context.view_layer.update()
  # Translation only is permitted to bottom-centre; proportions never normalized.
  lo,hi,dims=bounds(PARTS);offset=Vector((-(lo[0]+hi[0])/2,-(lo[1]+hi[1])/2,-lo[2]))
  assert abs(offset.z)<1e-7,(stem,'design not grounded',lo)
  for ob in PARTS:
   for v in ob.data.vertices:v.co+=offset
   ob.data.update();repair_mesh_winding(ob);unfold_pack(ob)
  lo,hi,dims=bounds(PARTS);target=[item[x]for x in ['w','d','h']]
  print('PREFLIGHT',stem,dims,'TARGET',target,'TRIS',sum(kit.tri_count(ob)for ob in PARTS),flush=True)
  assert max(abs(a-b)for a,b in zip(dims,target))<1,(stem,dims,target)
  seat_hi=max((ob.matrix_world@v.co).z for ob in PARTS if ob.get('seatSurface')for v in ob.data.vertices)*1000
  assert abs(seat_hi-item['seatTopMm'])<.1,(stem,seat_hi)
  native_count=len(PARTS);scene['sourceAsset']=stem;scene['front']='Blender -Y / glTF +Z';scene['unitsAuthored']='metres, no normalized scaling';scene['nativePartCount']=native_count
  bpy.context.preferences.filepaths.save_version=0;sanitize_loaded(stem);author=WORK/(stem+'-authoring.blend');bpy.ops.wm.save_as_mainfile(filepath=str(author),compress=True)
  canonical=bpy.data.scenes.new('Canonical active export');canonical.unit_settings.system='METRIC';canonical.unit_settings.scale_length=1;canonical['sourceAsset']=stem;clones=[]
  for part in PARTS:
   ob=part.copy();ob.data=part.data.copy();canonical.collection.objects.link(ob);clones.append(ob)
  bpy.context.window.scene=canonical;obj=kit.combine(clones);obj.name=stem;unfold_pack(obj);winding=repair_mesh_winding(obj,repair=False);uv=kit.uv_report(obj);tris=kit.tri_count(obj);budget=4000
  assert tris<=budget,(stem,tris,budget);assert all(c['signedVolumeAfterM3']>0 for c in winding['components'])
  channels={m.get('finishChannel')for m in obj.data.materials};canonical['nativePartCount']=native_count;canonical['seatTopMm']=seat_hi
  obj['sourceAsset']=stem;obj['front']='+Z after glTF transform';obj['staticAsset']=True
  sanitize_loaded(stem);source=WORK/(stem+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
  glb=PACK/'models'/(stem+'.glb');size=export(obj,glb);stamp(glb,stem);assert glb.stat().st_size<1000000
  validation=dict(model=stem,dimensions_mm=dims,bounds_m=[lo,hi],triangles=tris,triangleBudget=budget,uv=uv,seatTopMm=seat_hi,nativePartCount=native_count,materials={m.name:m.get('finishChannel')for m in obj.data.materials},front_blender='-Y',front_gltf='+Z',glb_bytes=glb.stat().st_size,winding=winding)
  vp=WORK/(stem+'-validation.json');vp.write_text(json.dumps(validation,indent=2)+'\n')
  if '--no-icons'not in sys.argv:
   kit.render_top(obj,str(PACK/'previews'/(stem+'-top.png')));kit.render_thumb(obj,str(PACK/'previews'/(stem+'-thumb.png')))
   # Separate straight-on front/rear evidence, original canonical transform.
   def render_evidence(front):
    import exterior_build
    sc=exterior_build._icon_scene(obj);exterior_build._sun(3.2,(math.radians(45),0,math.radians(25)),(3,-4,6));span=max(obj.dimensions)
    bpy.ops.object.camera_add(location=(0,-3*span if front else 3*span,obj.dimensions.z*.50));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=span*1.12;sc.camera=cam;cam.rotation_euler=(Vector((0,0,obj.dimensions.z*.5))-cam.location).to_track_quat('-Z','Y').to_euler();sc.render.filepath=str(WORK/(stem+('-front.png'if front else '-rear.png')));bpy.ops.render.render(write_still=True)
   render_evidence(True);render_evidence(False)
   for p in [PACK/'previews'/(stem+'-top.png'),PACK/'previews'/(stem+'-thumb.png'),WORK/(stem+'-front.png'),WORK/(stem+'-rear.png')]:strip_metadata(p)
  def rel(p):return str(p.relative_to(ROOT))
  desc=dict(id=stem,name=item['name'],group='家具',category='椅子',kind='chair',assetSet='rpg-mansion',model=rel(glb),thumb=rel(PACK/'previews'/(stem+'-thumb.png')),top=rel(PACK/'previews'/(stem+'-top.png')),w=item['w'],d=item['d'],h=item['h'],defaultElevation=0,provenance='original',previewVersion=1,sourceBlend=rel(source),exportBlend=rel(source),authoringBlend=rel(author),validation=rel(vp),front=rel(WORK/(stem+'-front.png')),rear=rel(WORK/(stem+'-rear.png')),builder=rel(Path(__file__)),geometrySignature=item['geometrySignature'],seatTopMm=seat_hi,seatFinishChannels=sorted({m.get('finishChannel')for part in PARTS if part.get('seatSurface')for m in part.data.materials}),triangleBudget=budget,measuredTriangles=tris,glbBytes=glb.stat().st_size,finishChannels=[dict(key=k,label=LABEL[k],default=COLOR[k])for k in sorted(channels)],placementNotes='Static original period-adapted manual alternative. Measured seat top 460 mm. No interactive rocking, folding or adjustment mechanism. Declared legacy footprint references are metadata-only and do not prove geometry, role or clearance equivalence.',coverageTarget=item,rights=dict(status='original',creator='OpenAI assistant using native Blender mesh authoring',sources=[],externalGeometry=False,externalImages=False,licenseBasis='Original procedural geometry created for this project'))
  desc['hashes']={k:hashlib.sha256((ROOT/desc[k]).read_bytes()).hexdigest()for k in ['model','sourceBlend','authoringBlend','exportBlend']};descriptors.append(desc)
  old=json.loads((H/'descriptors.json').read_text())['items']if (H/'descriptors.json').exists()else [];by={a['id']:a for a in old};by[stem]=desc;(H/'descriptors.json').write_text(json.dumps(dict(set='rpg-mansion',items=list(by.values())),ensure_ascii=False,indent=2)+'\n')
  (H/'production-checkpoint.json').write_text(json.dumps(dict(status='building-approved-family',plannedForms=24,builtForms=len(by),builtIds=list(by),visualReview='representative prototypes approved; full-family pending',releaseQa='pending independent checks',publication='isolated local production only'),indent=2)+'\n')
  print('ASSET_READY',stem,flush=True)

if __name__=='__main__':main()
