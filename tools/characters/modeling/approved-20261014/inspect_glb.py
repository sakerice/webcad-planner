"""Read exported GLB bytes independently of Blender's source scene."""
import hashlib
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IDENTITY = [[float(i == j) for j in range(4)] for i in range(4)]

def multiply(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def node_matrix(n):
    if 'matrix' in n:
        return [[n['matrix'][j*4+i] for j in range(4)] for i in range(4)]
    x,y,z,w = n.get('rotation',[0,0,0,1]); s=n.get('scale',[1,1,1]); t=n.get('translation',[0,0,0])
    m=[[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w,0],
       [2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w,0],
       [2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y,0],[0,0,0,1]]
    for i in range(3):
        for j in range(3):m[i][j]*=s[j]
        m[i][3]=t[i]
    return m

def read_glb(path):
    raw=path.read_bytes(); magic,version,length=struct.unpack_from('<4sII',raw)
    assert magic==b'glTF' and version==2 and length==len(raw)
    chunks={};offset=12
    while offset<len(raw):
        size,kind=struct.unpack_from('<II',raw,offset);offset+=8
        chunks[kind]=raw[offset:offset+size];offset+=size
    doc=json.loads(chunks[0x4e4f534a]);binary=chunks[0x004e4942]
    def accessor(index):
        a=doc['accessors'][index]; v=doc['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        fmt={5120:'b',5121:'B',5122:'h',5123:'H',5125:'I',5126:'f'}[a['componentType']]
        width=struct.calcsize('<'+fmt)*n;stride=v.get('byteStride',width)
        start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+fmt*n,binary,start+i*stride) for i in range(a['count'])]
    parts=[]; triangles=0; allpoints=[]; normals=0;uvs=0
    def visit(index,parent):
        nonlocal triangles,normals,uvs
        n=doc['nodes'][index];m=multiply(parent,node_matrix(n))
        if 'mesh' in n:
            points=[]
            for p in doc['meshes'][n['mesh']]['primitives']:
                assert p.get('mode',4)==4
                local=accessor(p['attributes']['POSITION'])
                world=[tuple(sum(m[i][j]*v[j] for j in range(3))+m[i][3] for i in range(3)) for v in local]
                points+=world
                for semantic,countname in [('NORMAL','normal'),('TEXCOORD_0','uv')]:
                    data=accessor(p['attributes'][semantic]);assert len(data)==len(local)
                    assert all(math.isfinite(k) for v in data for k in v)
                    if semantic=='NORMAL':
                        normals+=len(data);assert all(sum(k*k for k in v)>.9 for v in data)
                    else:uvs+=len(data)
                indices=accessor(p['indices']);assert len(indices)%3==0
                assert all(0<=i[0]<len(local) for i in indices)
                triangles+=len(indices)//3
            parts.append({'name':n.get('name'), 'bounds_m':bbox(points),'center_m':[sum(v[i] for v in points)/len(points) for i in range(3)]})
            allpoints.extend(points)
        for c in n.get('children',[]):visit(c,m)
    for n in doc['scenes'][doc.get('scene',0)]['nodes']:visit(n,IDENTITY)
    lo,hi=bbox(allpoints);height=hi[1]-lo[1]
    assert all(math.isfinite(k) for v in allpoints for k in v)
    target=1.72 if 'male-' in path.stem and 'female' not in path.stem else 1.60
    assert abs(height-target)<.001 and abs(lo[1])<1e-6 and triangles<=30000
    head=next(p for p in parts if p['name'].startswith('Head.FaceSculpt'))
    eyes=[p for p in parts if p['name'].startswith('Eye.White.')]
    face_ahead=all(p['center_m'][2]>head['center_m'][2] for p in eyes)
    assert face_ahead
    sole=[p for p in parts if p['name'].startswith('Foot.HouseMule.')]
    assert len(sole)==2 and all(abs(p['bounds_m'][0][1])<1e-6 for p in sole)
    assert sole[0]['center_m'][0]*sole[1]['center_m'][0]<0
    textures=doc.get('textures',[]);skins=doc.get('skins',[]);animations=doc.get('animations',[])
    assert not textures and not skins and not animations and not doc.get('cameras')
    assert all('Stage' not in p['name'] and 'Reference' not in p['name'] for p in parts)
    return {'id':path.stem,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'glTF_version':doc['asset']['version'],
        'bounds_m':[lo,hi],'height_m':height,'floor_y_m':lo[1],'triangle_count':triangles,'finite_normal_count':normals,'finite_uv_count':uvs,
        'front_positive_z_verified_from_eyes':face_ahead,'origin_between_contact_soles':True,'textures':len(textures),'skins':len(skins),'bones':0,'animations':[],
        'head_chin_y_m':head['bounds_m'][0][1],'head_crown_y_m':hi[1],'head_ratio_measured':height/(hi[1]-head['bounds_m'][0][1]),
        'head_measurement':'read binary POSITION accessors, apply node world transforms; total crown to floor / total crown to Head.FaceSculpt minimum chin',
        'materials':[{'name':m.get('name'),'role':m.get('extras',{}).get('role'),'sourceHex':m.get('extras',{}).get('sourceHex')} for m in doc['materials']],
        'mesh_parts':parts,'static_form_only':True,'not_tested':['rig/deformation','idle/walk/sit','animated skirt collision','app/browser/device rendering']}

def bbox(points):
    return [[min(v[i] for v in points) for i in range(3)],[max(v[i] for v in points) for i in range(3)]]

if __name__=='__main__':
    for path in sorted((ROOT/'models').glob('*.glb')):
        result=read_glb(path);(ROOT/'qa'/(path.stem+'-glb-validation.json')).write_text(json.dumps(result,indent=2)+'\n')
        print(path.stem,'height',result['height_m'],'triangles',result['triangle_count'],'heads',result['head_ratio_measured'])
