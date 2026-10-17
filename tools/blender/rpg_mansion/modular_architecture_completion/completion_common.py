"""Namespaced primitive/export adaptation for original architecture expansion. Static geometry, no app code.
Authored construction metres / Blender Z-up and -Y front. Only translation to
individual measured bottom-centre origins. Connection datums retain grid meaning.
"""
import sys,math,json,struct,hashlib
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
H=Path(__file__).resolve().parent;ROOT=H.parents[3]
sys.path[:0]=[str(H),str(H.parent),str(H.parent.parent)]
import model_kit as kit
from repair_winding import repair_mesh_winding
from sanitize_sources import sanitize_loaded
from metric_atlas import metric_atlas

PACK=ROOT/'assets/models/packs/rpg-mansion';WORK=H/'work';PARTS=[];P={}
COLORS={'wood':'#70503b','wood_trim':'#8d694b','plaster':'#d8cfb7','stone':'#c4b590','slate':'#414c58','roof_deck':'#605448','metal':'#71694f','glass':'#8daaaa','mortar':'#8c897e','oak':'#b88a50','dark_stone':'#46484a','iron':'#292d31','brick':'#9b6146'}
CHANNEL={'wood':'wood','wood_trim':'wood','plaster':'plaster','stone':'stone','slate':'roof','roof_deck':'wood','metal':'metal','glass':'glass','mortar':'mortar','oak':'wood','dark_stone':'inlay','iron':'metal','brick':'brick'}

def palette():
 out={}
 for k,c in COLORS.items():
  m=kit.matp('Original '+k.replace('_',' '),c,.75 if k!='metal'else .42,.55 if k=='metal'else 0);m['finishChannel']=CHANNEL[k];out[k]=m
  if k=='iron':
   bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.42;bs.inputs['Metallic'].default_value=.15
  if k=='glass':
   bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.08;bs.inputs['Alpha'].default_value=.10;m.diffuse_color=tuple(list(m.diffuse_color)[:3]+[.10]);m.surface_render_method='DITHERED'
 return out

def mesh(name,verts,faces,mat='wood',smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();data.materials.append(P[mat]);ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free();data.update()
 for p in data.polygons:p.use_smooth=smooth and len(p.vertices)==4
 ob['constructionPart']=name;PARTS.append(ob);return ob

def prism(name,outline,axis,lo,hi,mat='wood'):
 # XY outline for Z extrusion, XZ for Y extrusion, YZ for X extrusion.
 def pt(p,t):return (p[0],p[1],t)if axis=='Z'else((p[0],t,p[1])if axis=='Y'else(t,p[0],p[1]))
 n=len(outline);v=[pt(p,t)for t in[lo,hi]for p in outline];f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 return mesh(name,v,f,mat)

def box(name,lo,hi,mat='wood'):
 return prism(name,[(lo[0],lo[1]),(hi[0],lo[1]),(hi[0],hi[1]),(lo[0],hi[1])],'Z',lo[2],hi[2],mat)

def frame(name,x0,x1,z0,z1,y0,y1,width=.035,mat='wood_trim'):
 # Continuous mitered perimeter: outside/back -> outside/front -> inset/front -> inset/back.
 ring=[(x0,z0),(x1,z0),(x1,z1),(x0,z1)];inside=[(x0+width,z0+width),(x1-width,z0+width),(x1-width,z1-width),(x0+width,z1-width)]
 rings=[[(x,y0,z)for x,z in ring],[(x,y1,z)for x,z in ring],[(x,y1-.004,z)for x,z in inside],[(x,y0,z)for x,z in inside]]
 v=[p for r in rings for p in r];f=[(k*4+i,k*4+(i+1)%4,((k+1)%4)*4+(i+1)%4,((k+1)%4)*4+i)for k in range(4)for i in range(4)]
 return mesh(name,v,f,mat)

def raised_panel(name,x0,x1,z0,z1):
 # Frame sits into backing; field is raised with a real chamfer.
 frame(name+' continuous mitred moulding',x0,x1,z0,z1,-.133,-.153,.033)
 w=min(.047,(x1-x0)*.22);ch=min(.017,(x1-x0)*.08);outline=[(x0+w,z0+w),(x1-w,z0+w),(x1-w,z1-w),(x0+w,z1-w)]
 inner=[(x0+w+ch,z0+w+ch),(x1-w-ch,z0+w+ch),(x1-w-ch,z1-w-ch),(x0+w+ch,z1-w-ch)]
 rings=[[(x,-.132,z)for x,z in outline],[(x,-.143,z)for x,z in outline],[(x,-.149,z)for x,z in inner]]
 n=4;v=[p for r in rings for p in r];f=[(3,2,1,0)]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(2)for i in range(n)]+[(8,9,10,11)];mesh(name+' bevelled raised field',v,f)

def linear_trim(name,x0,x1,z0,z1,depth=.160):
 return prism(name,[(-.135,z0),(-depth,z0),(-depth,z1-.009),(-depth+.007,z1),(-.135,z1)],'X',x0,x1,'wood_trim')

def paneled_wall():
 box('Full height plaster structural wall',(-.6,-.12,0),(.6,.12,3),'plaster')
 box('Continuous front timber backing',(-.6,-.135,0),(.6,-.12,3))
 for label,a,b in [('lower',.24,1.04),('upper',1.21,2.77)]:
  for i,(x0,x1)in enumerate([(-.53,-.035),(.035,.53)]):raised_panel(label+' panel '+str(i+1),x0,x1,a,b)
 linear_trim('Continuous timber skirting',-.6,.6,0,.18)
 linear_trim('Continuous timber dado rail',-.6,.6,1.09,1.16,.155)
 linear_trim('Continuous timber upper rail',-.6,.6,2.86,3,.150)

def doorway():
 # One concave prism has a through-hole open to the floor, no invisible filled slab.
 outline=[(-.9,0),(-.72,0),(-.72,2.51),(.72,2.51),(.72,0),(.9,0),(.9,3),(-.9,3)]
 prism('Continuous plaster piers and lintel with open portal',outline,'Y',-.12,.12,'plaster')
 prism('Continuous timber portal facing with clear opening',outline,'Y',-.135,-.12)
 # Opening reveal stops at stated clear planes x=+/-0.6 and z=2.4.
 for s in[-1,1]:
  x0,x1=(-.72,-.6)if s<0 else(.6,.72)
  box('Portal jamb timber reveal '+str(s),(x0,-.155,0),(x1,.125,2.4),'wood_trim')
  # Narrow pier panels, geometrically distinct from doorway void.
  raised_panel('Door pier raised panel '+str(s),-.877 if s<0 else .755,-.755 if s<0 else .877,.28,2.70)
 box('Portal head timber reveal',(-.72,-.155,2.4),(.72,.125,2.51),'wood_trim')
 # Three-piece architrave is mitered in X/Z, no overlaid same-plane box corners.
 prism('Portal left mitred architrave',[(-.76,0),(-.6,0),(-.6,2.4),(-.76,2.56)],'Y',-.163,-.155,'wood_trim')
 prism('Portal right mitred architrave',[(.6,0),(.76,0),(.76,2.56),(.6,2.4)],'Y',-.163,-.155,'wood_trim')
 prism('Portal mitred header architrave',[(-.76,2.56),(-.6,2.4),(.6,2.4),(.76,2.56)],'Y',-.163,-.155,'wood_trim')
 for s in[-1,1]:
  a,b=(-.9,-.76)if s<0 else(.76,.9)
  linear_trim('Pier skirting '+str(s),a,b,0,.18)
 linear_trim('Continuous overdoor cornice rail',-.9,.9,2.86,3,.150)

CORNER_OUTLINE=[(-.6,-.12),(-.12,-.12),(-.12,-.6),(.12,-.6),(.12,.12),(-.6,.12)]
def corner_strip(name,depth,z0,z1,mat='wood_trim'):
 if mat=='wood':
  outline=[(-.6,-depth),(-depth,-depth),(-depth,-.6),(-.12,-.6),(-.12,-.12),(-.6,-.12)]
  return prism(name,outline,'Z',z0,z1,mat)
 profile=[(-.135,z0),(-depth,z0),(-depth,z1-.009),(-depth+.007,z1),(-.135,z1)]
 n=len(profile);rings=[[(-.6,d,z)for d,z in profile],[(d,d,z)for d,z in profile],[(d,-.6,z)for d,z in profile]]
 verts=[p for r in rings for p in r];faces=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(2)for i in range(n)]+[tuple(range(2*n,3*n))]
 return mesh(name,verts,faces,mat)

def paneled_corner():
 prism('Continuous L shaped plaster wall core',CORNER_OUTLINE,'Z',0,3,'plaster')
 corner_strip('Continuous mitred L timber backing',.135,0,3,'wood')
 for z0,z1,label in[(.24,1.04,'lower'),(1.21,2.77,'upper')]:
  raised_panel('Corner horizontal '+label,-.55,-.18,z0,z1)
  start=len(PARTS);raised_panel('Corner returning '+label,-.55,-.18,z0,z1)
  for ob in PARTS[start:]:
   for v in ob.data.vertices:v.co.x,v.co.y=v.co.y,v.co.x
   # Reflection is baked into vertices and winding repaired, never mirrored transform.
   bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
 for name,d,a,b in [('skirting',.160,0,.18),('dado',.155,1.09,1.16),('upper',.150,2.86,3)]:corner_strip('Continuous mitred L '+name,d,a,b)

SLOPE=.7
ROOF_X=2.1

def slate_profile_tile(name,side,stations,y0,y1):
 # Explicit convex quad strips keep the thin bent profile stable through glTF
 # tessellation. No concave n-gon caps or fan triangulation are left to infer.
 n=len(stations);verts=[]
 for y in[y0,y1]:
  for extra in[0,.015]:
   verts.extend([(side*x,y,SLOPE*(ROOF_X-x)+lift+extra)for x,lift in stations])
 faces=[]
 for i in range(n-1):
  faces.extend([(i,i+1,2*n+i+1,2*n+i),(n+i,3*n+i,3*n+i+1,n+i+1),(i,n+i,n+i+1,i+1),(2*n+i,2*n+i+1,3*n+i+1,3*n+i)])
 faces.extend([(0,2*n,3*n,n),(n-1,2*n-1,4*n-1,3*n-1)])
 return mesh(name,verts,faces,'slate')

def roof():
 low=lambda x:SLOPE*(ROOF_X-abs(x))
 outline=[(-2.1,0),(0,1.47),(2.1,0),(2.1,.055),(0,1.525),(-2.1,.055)]
 prism('Continuous hollow pitched timber weather deck',outline,'Y',-.6,.6,'roof_deck')
 # Alternating half-tile courses with 10mm physical lap toward the eaves.
 # At module run boundaries, clipped halves meet flush (no invented joint).
 for side in[-1,1]:
  for row in range(7):
   a=row*.3+.004;b=(row+1)*.3+(.014 if row<6 else -.004)
   cuts=[-.6,-.3,0,.3,.6]if row%2==0 else[-.6,-.45,-.15,.15,.45,.6]
   for col,(start,end)in enumerate(zip(cuts,cuts[1:])):
    y0=start+(0 if row%2 and col==0 else .002)
    y1=end-(0 if row%2 and col==len(cuts)-2 else .002)
    if row<6:
     stations=[(a,.055),(a+.025,.055),(b-.015,.070),(b,.070)]
    else:stations=[(a,.055),(b,.055)]
    slate_profile_tile('Lapped staggered slate slope %s course %02d tile %02d'%(side,row+1,col+1),side,stations,y0,y1)
 # Thick closed ridge saddle, attached over both deck slopes; no double coincident planes.
 prism('Folded metal ridge weather cap',[(-.095,1.4585),(0,1.525),(.095,1.4585),(.095,1.4785),(0,1.548),(-.095,1.4785)],'Y',-.6,.6,'metal')
 for s in[-1,1]:
  x0,x1=(1.68,1.92)if s>0 else(-1.92,-1.68)
  poly=[(x0,.1),(x1,.1),(x1,low(x1)),(x0,low(x0))]
  prism('Continuous level wall bearing seat '+str(s),poly,'Y',-.6,.6,'roof_deck')

def gable():
 # Roof underside minus 100mm bearing datum, over 3840mm exterior wall envelope.
 outline=[(-1.68,0),(1.68,0),(1.68,.194),(0,1.370),(-1.68,.194)]
 prism('Solid gable wall closure matched to hollow roof underside',outline,'Y',-.12,.12,'plaster')
 # A small recessed decorative triangle is an attached relief, never the roof mass.
 prism('Gable front raised triangular timber field',[(-1.24,.16),(1.24,.16),(0,1.028)],'Y',-.14,-.119,'wood')
 # Timber fillet tracks below closure top by 40mm; decorative profile retains fit.
 for s in[-1,1]:
  if s<0:poly=[(-1.62,.151),(-.025,1.267),(-.025,1.322),(-1.62,.206)]
  else:poly=[(.025,1.267),(1.62,.151),(1.62,.206),(.025,1.322)]
  prism('Sloped gable raking fillet '+str(s),poly,'Y',-.153,-.119,'wood_trim')

CORNICE_PROFILE=[(.12,0),(-.12,0),(-.12,.048),(-.165,.048),(-.165,.085),(-.195,.110),(-.220,.158),(-.275,.190),(-.3,.220),(-.3,.24),(.12,.24)]
def cornice_straight():prism('Continuous profiled stone cornice',CORNICE_PROFILE,'X',-.6,.6,'stone')
def cornice_corner():
 n=len(CORNICE_PROFILE);rings=[[(x if i==0 else(d if i==1 else d),d if i==0 else(d if i==1 else x),z)for d,z in CORNICE_PROFILE]for i,x in enumerate([-.6,0,-.6])]
 v=[p for r in rings for p in r];f=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(2)for i in range(n)]+[tuple(range(2*n,3*n))]
 mesh('Continuous mitred L cornice with matching return profiles',v,f,'stone')

def column():
 box('Grounded square column plinth',(-.3,-.3,0),(.3,.3,.12),'stone')
 rows=[(.24,.12),(.24,.155),(.225,.18),(.22,.205),(.18,.24),(.18,.28),(.167,.32),(.158,.35),(.166,.85),(.16,1.25),(.15,1.85),(.138,2.53),(.14,2.60),(.165,2.625),(.17,2.66),(.17,2.70),(.205,2.745),(.235,2.82),(.245,2.855),(.245,2.88)]
 n=48;v=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z)for r,z in rows for i in range(n)];f=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(len(rows)-1)for i in range(n)]+[tuple(range((len(rows)-1)*n,len(rows)*n))]
 mesh('Continuous turned base entasis shaft necking and capital',v,f,'stone',True)
 box('Level square capital abacus bearing',(-.3,-.3,2.88),(.3,.3,3),'stone')

def bounds(parts):
 pts=[ob.matrix_world@v.co for ob in parts for v in ob.data.vertices];lo=[min(p[i]for p in pts)for i in range(3)];hi=[max(p[i]for p in pts)for i in range(3)];return lo,hi,[(hi[i]-lo[i])*1000 for i in range(3)]
def stamp(path,stem):
 raw=path.read_bytes();size,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+size]);doc['asset']['extras']=dict(front='+Z',up='+Y',units='metres',origin='bottom-centre',provenance='original',sourceAsset=stem,staticAsset=True)
 data=json.dumps(doc,separators=(',',':'),ensure_ascii=True).encode();data+=b' '*((-len(data))%4);rest=raw[20+size:];path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(data)+len(rest))+struct.pack('<II',len(data),kind)+data+rest)
def export(ob,path):
 path.parent.mkdir(parents=True,exist_ok=True);kit.activate(ob);bpy.ops.export_scene.gltf(filepath=str(path),use_selection=True,use_active_scene=True,export_format='GLB',export_apply=True,export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False,export_skins=False,export_morph=False,export_extras=True,export_texture_dir='')
 stamp(path,ob.name)
