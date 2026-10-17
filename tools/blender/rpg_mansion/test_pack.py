"""Read delivered GLB bytes, not builder assumptions. Run from any directory."""
import json, math, struct, unittest, os
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[3]
PACK=ROOT/'assets/models/packs/rpg-mansion'
MANIFEST=json.loads((PACK/'manifest.json').read_text())

def glb(path):
    b=path.read_bytes()
    assert struct.unpack_from('<III',b)==(0x46546c67,2,len(b))
    n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);binary=b[28+n:]
    def values(index):
        a=j['accessors'][index];v=j['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        t={5126:'f',5125:'I',5123:'H',5121:'B'}[a['componentType']]
        offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',struct.calcsize('<'+t*n))
        return [struct.unpack_from('<'+t*n,binary,offset+i*stride) for i in range(a['count'])]
    return j,values

class Pack(unittest.TestCase):
    def test_ids_and_isolation(self):
        ids=[i['id'] for i in MANIFEST['items']]
        self.assertEqual(len(ids),55);self.assertEqual(len(set(ids)),55)
        original=json.loads((ROOT/'assets/models/packs/rpg-mansion-contract/v0.2.0/reviewed-manifest.json').read_text())
        self.assertEqual(MANIFEST['items'][:50],original['items'])
        legacy=set()
        for folder in ['custom','furniture_mega','interior_model_0_26_1']:
            legacy.update(i['id'] for i in json.loads((ROOT/'assets/models'/folder/'manifest.json').read_text())['items'])
        self.assertFalse(set(ids)&legacy)
        self.assertTrue(all(x.startswith('rpg-mansion-') for x in ids))
        self.assertEqual(MANIFEST['provenance']['externalAssets'],[])

    def test_delivered_geometry_uvs_materials_and_sources(self):
        total=0
        for item in MANIFEST['items']:
            with self.subTest(item=item['id']):
                path=ROOT/item['model'];self.assertLess(path.stat().st_size,250000)
                total+=path.stat().st_size;j,read=glb(path)
                self.assertEqual(j['asset']['extras']['front'],'+Z')
                self.assertEqual(j['asset']['extras']['up'],'+Y')
                self.assertFalse(j.get('images'));self.assertFalse(j.get('textures'))
                channels={m.get('extras',{}).get('finishChannel') for m in j['materials']}-{None}
                self.assertEqual(channels,{c['key'] for c in item['finishChannels']})
                self.assertTrue((ROOT/item['builder']).is_file())
                source=Path(os.environ.get('RPG_SOURCE_ARCHIVE',ROOT))/item['sourceBlend']
                if os.environ.get('RPG_SOURCE_ARCHIVE') or source.exists():
                    self.assertTrue(source.read_bytes().startswith(b'BLENDER'))
                report=json.loads((ROOT/item['validation']).read_text())
                self.assertEqual(report['uv']['degenerate_world'],0)
                self.assertEqual(report['uv']['degenerate_uv'],0)
                tris=0
                for mesh in j['meshes']:
                    for p in mesh['primitives']:
                        xyz=read(p['attributes']['POSITION']);uv=read(p['attributes']['TEXCOORD_0']);idx=[v[0] for v in read(p['indices'])]
                        self.assertTrue(all(math.isfinite(x) for v in xyz+uv for x in v));tris+=len(idx)//3
                        for k in range(0,len(idx),3):
                            a,b,c=[uv[idx[k+d]] for d in range(3)]
                            area=abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2
                            self.assertGreater(area,1e-12,item['id']+' collapsed exported UV')
                self.assertLessEqual(tris,6000)
                self.assertEqual(tris,report['triangles'])
        self.assertLess(total,3500000)

    def test_expansion_coplanar_faces_normals_and_leaf_orientation(self):
        # Inspect delivered bytes across material primitives, not only source meshes.
        for item in MANIFEST['items'][14:]:
            j,read=glb(ROOT/item['model']);seen=set();leaf_triangles=[]
            for mesh in j['meshes']:
                for p in mesh['primitives']:
                    xyz=read(p['attributes']['POSITION']);normals=read(p['attributes']['NORMAL']);idx=[v[0] for v in read(p['indices'])]
                    for k in range(0,len(idx),3):
                        ids=idx[k:k+3];points=[xyz[i] for i in ids]
                        key=tuple(sorted(tuple(round(v,7) for v in pt) for pt in points))
                        self.assertNotIn(key,seen,item['id']+' duplicated coplanar triangle');seen.add(key)
                        a,b,c=points;u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
                        cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                        n=[sum(normals[q][i] for q in ids) for i in range(3)]
                        self.assertGreaterEqual(sum(x*y for x,y in zip(cross,n)),-1e-10,item['id']+' reversed normal')
                        if item['id']=='rpg-mansion-planter-01' and j['materials'][p['material']].get('extras',{}).get('finishChannel')=='foliage':leaf_triangles.append(points)
            if leaf_triangles:
                # Weld positional UV/normal seams, then inspect each disconnected solid.
                parents={}
                def root(v):
                    parents.setdefault(v,v)
                    if parents[v]!=v:parents[v]=root(parents[v])
                    return parents[v]
                def pos(v):return tuple(round(x,7) for x in v)
                for t in leaf_triangles:
                    a,b,c=map(pos,t);parents[root(b)]=root(a);parents[root(c)]=root(a)
                components={}
                for t in leaf_triangles:components.setdefault(root(pos(t[0])),[]).append(t)
                leaves=[ts for ts in components.values() if len({pos(v) for t in ts for v in t})==5]
                self.assertEqual(len(leaves),9)
                for ts in leaves:
                    volume=0
                    for a,b,c in ts:volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
                    self.assertGreater(volume,0,'exported leaf winding must face outward')

    def test_previews_not_empty_or_clipped(self):
        for item in MANIFEST['items']:
            keys=['thumb','top']
            if os.environ.get('RPG_SOURCE_ARCHIVE') or (ROOT/item['rear']).exists():keys.append('rear')
            for key in keys:
                with self.subTest(item=item['id'],view=key):
                    im=Image.open((Path(os.environ.get('RPG_SOURCE_ARCHIVE',ROOT)) if key=='rear' else ROOT)/item[key]).convert('RGBA');self.assertEqual(im.size,(512,512))
                    if key!='rear':
                        self.assertFalse({'File','Date','Camera','Scene','RenderTime','exif'} & set(im.info),'Private render metadata in public preview')
                        if os.environ.get('RPG_SOURCE_ARCHIVE'):
                            original=Image.open(Path(os.environ['RPG_SOURCE_ARCHIVE'])/item[key]).convert('RGBA')
                            self.assertEqual(im.tobytes(),original.tobytes(),'Public pixels differ from reviewed source')
                    bounds=im.getchannel('A').getbbox();self.assertIsNotNone(bounds)
                    self.assertGreater(bounds[0],0);self.assertGreater(bounds[1],0)
                    self.assertLess(bounds[2],512);self.assertLess(bounds[3],512)
                    self.assertGreater(bounds[2]-bounds[0],60)

if __name__=='__main__':unittest.main(verbosity=2)
