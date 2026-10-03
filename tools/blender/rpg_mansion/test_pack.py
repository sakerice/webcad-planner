"""Read delivered GLB bytes, not builder assumptions. Run from any directory."""
import json, math, struct, unittest
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
        self.assertEqual(len(ids),14);self.assertEqual(len(set(ids)),14)
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
                self.assertTrue((ROOT/item['sourceBlend']).read_bytes().startswith(b'BLENDER'))
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
        self.assertLess(total,1000000)

    def test_previews_not_empty_or_clipped(self):
        for item in MANIFEST['items']:
            for key in ['thumb','top','rear']:
                with self.subTest(item=item['id'],view=key):
                    im=Image.open(ROOT/item[key]).convert('RGBA');self.assertEqual(im.size,(512,512))
                    bounds=im.getchannel('A').getbbox();self.assertIsNotNone(bounds)
                    self.assertGreater(bounds[0],0);self.assertGreater(bounds[1],0)
                    self.assertLess(bounds[2],512);self.assertLess(bounds[3],512)
                    self.assertGreater(bounds[2]-bounds[0],60)

if __name__=='__main__':unittest.main(verbosity=2)
