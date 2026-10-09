"""Original mansion stair primitives. Blender metres, Z up, approach -Y."""
from pathlib import Path
import math,sys,json
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'helpers'))
import bpy,bmesh
from mathutils import Vector,Matrix
import model_kit as kit
from native_utils import positive_winding,metric_uv,export_active,sanitize
PARTS=[];M={};DATUM={};CONTACTS=[]

def reset():
    PARTS.clear();M.clear();DATUM.clear();CONTACTS.clear()
    for key,name,col,rough,metal,channel in [
        ('oak','Oiled quarter-sawn oak','#92633c',.48,0,'wood'),
        ('walnut','Carved dark walnut','#54341f',.4,0,'wood'),
        ('paint','Warm ivory painted joinery','#d8ceb5',.63,0,'paint'),
        ('brass','Antique brass fixings','#a48245',.32,.75,'metal'),
        ('iron','Dark structural iron','#343b3b',.43,.7,'metal'),
        ('context','Proof floor limestone','#c4b590',.82,0,'stone')]:
        m=kit.matp(name,col,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;M[key]=m

def keep(ob,role=None):
    PARTS.append(ob);ob['constructionPart']=ob.name
    if role:ob['functionalRole']=role
    return ob

def mesh(name,verts,faces,mat='oak',smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();me.materials.append(M[mat])
    for p in me.polygons:p.use_smooth=smooth
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);positive_winding(ob);return keep(ob)

def box(name,center,size,mat='oak',radius=.001):
    ob=kit.box(name,tuple(center[i]-size[i]/2 for i in range(3)),tuple(center[i]+size[i]/2 for i in range(3)),M[mat],radius,2)
    positive_winding(ob);return keep(ob)

def loft(name,rings,mat='oak',smooth=False):
    n=len(rings[0]);vs=[tuple(v)for r in rings for v in r]
    fs=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(len(rings)-1)for i in range(n)]+[tuple(range((len(rings)-1)*n,len(rings)*n))]
    return mesh(name,vs,fs,mat,smooth)

def sweep(name,path,r,mat='walnut',sides=12):
    path=[Vector(p)for p in path];rings=[]
    for i,p in enumerate(path):
        t=(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized();u=t.cross(Vector((1,0,0)))
        if u.length<.01:u=t.cross(Vector((0,1,0)))
        u.normalize();v=t.cross(u).normalized();rings.append([p+r*(u*math.cos(math.tau*j/sides)+v*math.sin(math.tau*j/sides))for j in range(sides)])
    return loft(name,rings,mat,True)

def lathe(name,x,y,z,h,mat='walnut'):
    profile=[(0,.019),(.09,.019),(.11,.027),(.17,.027),(.23,.017),(.42,.014),(.52,.020),(.64,.015),(.81,.013),(.85,.024),(.92,.024),(1,.017)]
    return loft(name,[[(x+r*math.cos(math.tau*i/12),y+r*math.sin(math.tau*i/12),z+t*h)for i in range(12)]for t,r in profile],mat,True)

def beam(name,a,b,w,d,mat='oak'):
    a,b=Vector(a),Vector(b);u=(b-a).normalized();v=u.cross(Vector((0,0,1)))
    if v.length<.01:v=Vector((1,0,0))
    v.normalize();n=u.cross(v).normalized()
    return loft(name,[[p+v*w*s/2+n*d*t/2 for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]for p in (a,b)],mat)

def contact(part,target,point,kind):
    CONTACTS.append(dict(part=part.name if hasattr(part,'name')else part,target=target.name if hasattr(target,'name')else target,pointConstructionBlenderM=list(point),kind=kind))
