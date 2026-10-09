"""Original native garden construction primitives. Metres, Z up, -Y front."""
from pathlib import Path
import math,sys,random,json
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'helpers'))
import bpy,bmesh
from mathutils import Vector
import model_kit as kit
from native_utils import positive_winding,metric_uv,export_active,sanitize
from shape_kit import rounded_rect
PARTS=[];M={};CONTACTS=[];DATUM={}

def reset():
    PARTS.clear();M.clear();CONTACTS.clear();DATUM.clear()
    for k,label,col,rough,metal,channel in [
        ('wood','Oiled garden oak','#826044',.63,0,'wood'),
        ('bark','Branch bark','#675041',.9,0,'wood'),
        ('iron','Garden charcoal iron','#424b43',.48,.65,'metal'),
        ('brass','Weathered brass','#aa8145',.3,.75,'metal'),
        ('stone','Warm carved limestone','#b8b39d',.85,0,'stone'),
        ('brick','Handmade warm brick','#a87559',.88,0,'masonry'),
        ('pot','Terracotta planter','#95634a',.75,0,'ceramic'),
        ('soil','Planting soil','#3b3527',1,0,'soil'),
        ('leaf','Garden leaf green','#537341',.78,0,'foliage'),
        ('leaflight','Fresh growing leaf','#6e874b',.74,0,'foliage'),
        ('leafdark','Shaded leaf','#3b593c',.84,0,'foliage'),
        ('flower','Ivory garden flower','#eee4c2',.66,0,'flower'),
        ('flowerpink','Muted rose flower','#b7737c',.68,0,'flower')]:
        m=kit.matp(label,col,rough,metal);m['finishChannel']=channel;m.use_backface_culling=True;M[k]=m

def keep(ob,role=None):
    PARTS.append(ob);ob['constructionPart']=ob.name
    if role:ob['functionalRole']=role
    return ob

def mesh(name,verts,faces,mat='wood',smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();me.materials.append(M[mat])
    for p in me.polygons:p.use_smooth=smooth
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);positive_winding(ob);return keep(ob)

def box(name,center,size,mat='wood',radius=.001):
    ob=kit.box(name,tuple(center[i]-size[i]/2 for i in range(3)),tuple(center[i]+size[i]/2 for i in range(3)),M[mat],radius,1)
    positive_winding(ob);return keep(ob)

def loft(name,rings,mat='wood',smooth=False,caps=True):
    n=len(rings[0]);verts=[tuple(v)for r in rings for v in r]
    faces=[tuple(reversed(range(n)))] if caps else []
    faces += [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i)for k in range(len(rings)-1)for i in range(n)]
    if caps:faces.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    else:faces += [((len(rings)-1)*n+i,(len(rings)-1)*n+(i+1)%n,(i+1)%n,i)for i in range(n)]
    return mesh(name,verts,faces,mat,smooth)

def ellipse(w,d,z,cx=0,cy=0,n=24):
    return [(cx+w/2*math.cos(math.tau*i/n),cy+d/2*math.sin(math.tau*i/n),z)for i in range(n)]

def lathe(name,x,y,rows,mat='wood',n=16):
    return loft(name,[ellipse(r*2,r*2,z,x,y,n)for r,z in rows],mat,True)

def sweep(name,path,r,mat='bark',sides=6,role=None):
    path=[Vector(p)for p in path];r=[r]*len(path)if isinstance(r,(float,int))else r
    tangent=[(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized()for i in range(len(path))]
    seed=min([Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))],key=lambda a:max(abs(t.dot(a))for t in tangent))
    rings=[]
    for p,t,rad in zip(path,tangent,r):
        u=t.cross(seed).normalized();v=t.cross(u).normalized()
        rings.append([p+rad*(u*math.cos(math.tau*j/sides)+v*math.sin(math.tau*j/sides))for j in range(sides)])
    ob=loft(name,rings,mat,True)
    if role:ob['functionalRole']=role
    return ob

def beam(name,a,b,width,depth,mat='wood'):
    a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=Vector((0,1,0))
    if abs(axis.dot(side))>.95:side=Vector((1,0,0))
    across=axis.cross(side).normalized()
    rings=[[p+across*u*width/2+side*v*depth/2 for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]]for p in [a,b]]
    return loft(name,rings,mat)

def leaf_geometry(root,direction,length,width,roll=0,thickness=.00155,rounded=False):
    root=Vector(root);u=Vector(direction).normalized()
    s=u.cross(Vector((0,0,1)))
    if s.length<.05:s=u.cross(Vector((0,1,0)))
    s.normalize();v=u.cross(s).normalized();s2=s*math.cos(roll)+v*math.sin(roll);normal=u.cross(s2).normalized()
    mid=root+u*length*.48
    if rounded=='needle':
        # A closed four-triangle fine needle, with an actual root and triangular cross-section.
        verts=[root,root+u*length,root+u*length*.30-s2*width*.5+normal*thickness*.5,root+u*length*.30+s2*width*.5-normal*thickness*.5]
        # Offset the fourth vertex out of the first three vertex plane.
        verts[3]+=normal*thickness
        faces=[(0,1,2),(0,3,1),(0,2,3),(1,3,2)]
    elif rounded:
        verts=[root,root+u*length*.28-s2*width*.43,root+u*length*.68-s2*width*.5,root+u*length,root+u*length*.68+s2*width*.5,root+u*length*.28+s2*width*.43,mid+normal*thickness/2,mid-normal*thickness/2]
        faces=[(i,(i+1)%6,6)for i in range(6)]+[((i+1)%6,i,7)for i in range(6)]
    else:
        verts=[root,root+u*length,mid-s2*width/2,mid+s2*width/2,mid+normal*thickness/2,mid-normal*thickness/2]
        faces=[(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]
    return verts,faces

def leaf_group(name,leaves,mat='leaf'):
    verts=[];faces=[]
    for leaf in leaves:
        vs,fs=leaf_geometry(*leaf);offset=len(verts);verts+=vs;faces +=[tuple(v+offset for v in f)for f in fs]
    ob=mesh(name,verts,faces,mat);ob['functionalRole']='attached-foliage';ob['leafCount']=len(leaves);return ob

def attach(point,target,kind='branch-root',radius=None):
    CONTACTS.append(dict(pointM=list(point),target=target.name,kind=kind,contactToleranceM=.0001,**({'supportRadiusM':radius}if radius is not None else {})))

def polyline_point(path,t):
    p=t*(len(path)-1);i=min(int(p),len(path)-2);f=p-i;return Vector(path[i]).lerp(Vector(path[i+1]),f)

def author_uv(ob):
    # Exact per-triangle metric charts: no iterative packing for hundreds of authoring parts.
    me=ob.data;me.calc_loop_triangles();uv=me.uv_layers.active or me.uv_layers.new(name='UVMap')
    tris={}
    for t in me.loop_triangles:tris.setdefault(t.polygon_index,[]).append(tuple(t.vertices))
    cols=max(1,math.ceil(math.sqrt(len(me.polygons))));allcoords=[]
    for p in me.polygons:
        ids=list(p.vertices);points={i:me.vertices[i].co for i in ids};pair=tris[p.index]
        if len(ids)==4 and len(pair)==2:
            a,b=sorted(set(pair[0])&set(pair[1]));c=next(i for i in pair[0]if i not in [a,b]);d=next(i for i in pair[1]if i not in [a,b]);length=(points[b]-points[a]).length
            sign=1 if any(tuple(pair[0][k:]+pair[0][:k])==(a,b,c)for k in range(3))else -1;coords={a:(0,0),b:(length,0)}
            for j,s in [(c,sign),(d,-sign)]:
                ac=(points[j]-points[a]).length;bc=(points[j]-points[b]).length;x=(ac*ac+length*length-bc*bc)/(2*length);coords[j]=(x,s*math.sqrt(max(0,ac*ac-x*x)))
            xy=[coords[i]for i in ids]
        else:
            vs=[points[i]for i in ids];u=max([vs[(i+1)%len(vs)]-vs[i]for i in range(len(vs))],key=lambda v:v.length).normalized();v=p.normal.cross(u).normalized();xy=[(q.dot(u),q.dot(v))for q in vs]
        lo=[min(p[i]for p in xy)for i in range(2)]
        for li,(x,y)in zip(p.loop_indices,xy):
            c=(x-lo[0]+3*(p.index%cols)+.002,y-lo[1]+3*(p.index//cols)+.002);allcoords.append((li,c))
    maximum=max(max(c)for _,c in allcoords)+.002
    for li,c in allcoords:uv.data[li].uv=(c[0]/maximum,c[1]/maximum)
    uv.active_render=True

