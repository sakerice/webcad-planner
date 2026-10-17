"""Direct GLB audit, canonical blend re-export and editable-part reconstruction."""
from pathlib import Path
import sys,json,struct,math,hashlib,tempfile
import bpy,bmesh
from mathutils import Matrix,Vector,Quaternion
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from build import SPECS,PACK,stamp,kit

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def glb(path):
    raw=path.read_bytes();magic,ver,total=struct.unpack_from('<III',raw)
    assert (magic,ver,total)==(0x46546c67,2,len(raw))
    n,chunk=struct.unpack_from('<II',raw,12);assert chunk==0x4e4f534a
    g=json.loads(raw[20:20+n]);bn,btyp=struct.unpack_from('<II',raw,20+n);assert btyp==0x004e4942
    buf=raw[28+n:];assert len(buf)==bn
    def read(i):
        a=g['accessors'][i];v=g['bufferViews'][a['bufferView']]
        fmt={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']]
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        stride=v.get('byteStride',struct.calcsize('<'+fmt)*width)
        off=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+fmt*width,buf,off+j*stride)for j in range(a['count'])]
    return g,read

def local_matrix(n):
    if 'matrix'in n:return Matrix([n['matrix'][i::4]for i in range(4)])
    q=n.get('rotation',[0,0,0,1]);r=Quaternion((q[3],*q[:3])).to_matrix().to_4x4()
    return Matrix.Translation(n.get('translation',(0,0,0)))@r@Matrix.Diagonal((*n.get('scale',(1,1,1)),1))

def audit_glb(path,size):
    g,read=glb(path);assert len(g['meshes'])==1
    assert not g.get('images')and not g.get('textures')and not g.get('animations')and not g.get('skins')
    assert g['asset']['extras']['front']=='+Z'and g['asset']['extras']['up']=='+Y'
    mats={m['name']:m for m in g['materials']}
    assert set(mats)=={'Painted timber','Brass hardware','Limestone sill','Glass'}
    assert mats['Painted timber']['extras']['finishChannel']=='paint'
    assert mats['Brass hardware']['extras']['finishChannel']=='metal'
    assert not mats['Glass'].get('extras',{}).get('finishChannel')
    assert not mats['Limestone sill'].get('extras',{}).get('finishChannel')
    glass=mats['Glass'];assert glass['alphaMode']=='BLEND'
    c=glass['pbrMetallicRoughness']['baseColorFactor'];assert abs(c[3]-.25)<1e-6
    linear=lambda v:v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    expected=[linear(int('dfe8ea'[i:i+2],16)/255)for i in (0,2,4)]
    assert max(abs(a-b)for a,b in zip(c[:3],expected))<1e-6
    def walk(i,parent):
        n=g['nodes'][i];world=parent@local_matrix(n)
        if 'mesh'in n:yield (g['meshes'][n['mesh']],world)
        for ch in n.get('children',[]):yield from walk(ch,world)
    pts=[];tris=0;uvbad=0;badnorm=0;primitive_rows=[]
    for root in g['scenes'][g.get('scene',0)]['nodes']:
        for mesh,world in walk(root,Matrix.Identity(4)):
            for pr in mesh['primitives']:
                assert pr.get('mode',4)==4
                attrs=pr['attributes'];assert 'TEXCOORD_0'in attrs and 'NORMAL'in attrs
                assert 'TEXCOORD_1'not in attrs
                p=read(attrs['POSITION']);uv=read(attrs['TEXCOORD_0']);nor=read(attrs['NORMAL']);ix=[x[0]for x in read(pr['indices'])]
                assert len(ix)%3==0;tris+=len(ix)//3
                pts += [world@Vector(v)for v in p]
                for v in nor:
                    assert all(math.isfinite(x)for x in v)
                    if abs(Vector(v).length-1)>1e-4:badnorm+=1
                areas=[];uvareas=[]
                for j in range(0,len(ix),3):
                    a,b,c0=[uv[k]for k in ix[j:j+3]]
                    area=abs((b[0]-a[0])*(c0[1]-a[1])-(b[1]-a[1])*(c0[0]-a[0]))/2
                    if area<=1e-12:uvbad+=1
                    x,y,z=[world@Vector(p[k])for k in ix[j:j+3]]
                    ar=(y-x).cross(z-x).length/2;assert ar>1e-14
                    areas.append(ar);uvareas.append(area)
                primitive_rows.append({'material':g['materials'][pr['material']]['name'],'triangles':len(ix)//3,'minimumUvTriangleArea':min(uvareas),'minimumWorldTriangleAreaM2':min(areas)})
    assert uvbad==0 and badnorm==0,(uvbad,badnorm)
    lo=[min(p[i]for p in pts)for i in range(3)];hi=[max(p[i]for p in pts)for i in range(3)]
    # Direct GLB coordinates: width X, depth Z, height Y.
    dims=[(hi[i]-lo[i])*1000 for i in (0,2,1)]
    assert max(abs(a-b)for a,b in zip(dims,size))<.001,(dims,size)
    assert abs(lo[1])<1e-7 and abs(lo[0]+hi[0])<1e-7 and abs(lo[2]+hi[2])<1e-7
    assert tris<=8000
    point_set={tuple(round(c,6)for c in p)for p in pts}
    return dict(dimensionsMm=dims,boundsGltfM=[lo,hi],triangles=tris,collapsedUvTriangles=uvbad,invalidNormals=badnorm,glassAlphaMode=glass['alphaMode'],glassBaseColorLinear=glass['pbrMetallicRoughness']['baseColorFactor'],materials={n:m.get('extras',{}).get('finishChannel')for n,m in mats.items()},primitives=primitive_rows),point_set

def mesh_geometry(ob):
    ob.data.calc_loop_triangles();rows=[]
    for t in ob.data.loop_triangles:
        ps=[ob.matrix_world@ob.data.vertices[i].co for i in t.vertices]
        rows.append((ob.data.materials[t.material_index].name,tuple(sorted(tuple(round(c,7)for c in p)for p in ps))))
    return hashlib.sha256(repr(sorted(rows)).encode()).hexdigest()

def manifold_components(ob):
    bm=bmesh.new();bm.from_mesh(ob.data)
    assert all(e.is_manifold for e in bm.edges)
    bm.verts.ensure_lookup_table();seen=set();comp={};count=0
    for v in bm.verts:
        if v.index in seen:continue
        stack=[v];seen.add(v.index)
        while stack:
            vv=stack.pop();comp[vv.index]=count
            for e in vv.link_edges:
                u=e.other_vert(vv)
                if u.index not in seen:seen.add(u.index);stack.append(u)
        count+=1
    bm.free();vol=[0.0]*count;ob.data.calc_loop_triangles()
    for t in ob.data.loop_triangles:
        p,q,r=[ob.matrix_world@ob.data.vertices[i].co for i in t.vertices]
        vol[comp[t.vertices[0]]]+=p.dot(q.cross(r))/6
    assert all(v>1e-12 for v in vol),min(vol)
    return dict(closedComponents=count,minSignedVolumeM3=min(vol),openEdges=0,negativeComponents=0)

def main():
    rows=[]
    with tempfile.TemporaryDirectory(prefix='mansion-window-regenerate-')as tmp:
        td=Path(tmp);kit.WORK_DIR=td/'validation'
        for stem,name,size,_ in SPECS:
            path=PACK/'models'/(stem+'.glb');r,gltf_points=audit_glb(path,size)
            vp=HERE/'sources'/(stem+'-validation.json');rep=json.loads(vp.read_text());assert r['triangles']==rep['triangles']
            bpy.ops.wm.open_mainfile(filepath=str(HERE/'sources'/(stem+'.blend')))
            ob=next(o for o in bpy.context.scene.objects if o.type=='MESH');canonical_geometry=mesh_geometry(ob)
            native_points={tuple(round(c,6)for c in (p.x,p.z,-p.y))for p in [ob.matrix_world@v.co for v in ob.data.vertices]}
            assert native_points==gltf_points,('Blender-to-glTF axis mapping differs',stem)
            closed=manifold_components(ob)
            regen=td/(stem+'.glb');kit.export(ob,str(regen));stamp(regen)
            assert path.read_bytes()==regen.read_bytes(),('canonical re-export differs',stem)
            bpy.ops.wm.open_mainfile(filepath=str(HERE/'authoring_sources'/(stem+'.blend')))
            parts=[o for o in bpy.context.scene.objects if o.type=='MESH'];partcount=len(parts)
            ob=kit.combine(parts);ob.name=stem
            assert mesh_geometry(ob)==canonical_geometry,('editable source geometry differs',stem)
            old=kit.clear_scene;kit.clear_scene=lambda:None
            try:kit.run([(stem,size,lambda:ob,{'paint','metal'},8000)],do_export=False,do_icons=False)
            finally:kit.clear_scene=old
            native_regen=td/(stem+'-from-authoring.glb');kit.export(ob,str(native_regen));stamp(native_regen)
            native_audit,_=audit_glb(native_regen,size);assert native_audit['triangles']==r['triangles']
            row=dict(id=stem,glbSha256=sha(path),sourceBlendSha256=sha(HERE/'sources'/(stem+'.blend')),authoringBlendSha256=sha(HERE/'authoring_sources'/(stem+'.blend')),directGlbAudit=r,canonicalTopology=closed,blenderToGltfPointMappingVerified='(x,y,z) -> (x,z,-y)',canonicalBlendReexportByteIdentical=True,editablePartCount=partcount,editableSourceRebuildGeometryIdentical=True,editableSourceRebuildPassesModelKitAndGlbAudit=True,browserRuntimeTested=False)
            rows.append(row)
    (HERE/'reports/technical-validation.json').write_text(json.dumps(rows,indent=2)+'\n')
    print('PASS: four direct GLB audits; four byte-identical canonical re-exports; four editable-part rebuilds')
if __name__=='__main__':main()
