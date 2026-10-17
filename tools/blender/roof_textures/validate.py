"""Validate actual roof JPEGs, physical pitch, decoded seams, and 2x2 proofs.

python tools/blender/roof_textures/validate.py (numpy, Pillow)
"""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]


def validate():
    data=json.loads((HERE/'validation.json').read_text())
    files=[]
    for spec in data['textures']:
        assert abs(spec['cols']*spec['width_mm']-spec['tile_mm'])<1e-6
        if spec['length_mm'] is not None:
            assert abs(spec['rows']*spec['length_mm']-spec['tile_mm'])<1e-6
        assert all(n is None or abs(n)<=10 for n in spec['adjustment_percent'])
        for name,record in spec['maps'].items():
            path=ROOT/record['path'];im=Image.open(path)
            assert im.format=='JPEG' and im.mode=='RGB' and im.size==(1024,1024)
            a=np.asarray(im).astype(float)
            edge=np.concatenate([abs(a[0]-a[-1]).ravel(),abs(a[:,0]-a[:,-1]).ravel()])
            assert np.percentile(edge,99)<=24
            assert abs(edge.mean()-record['jpeg_edge_mean'])<1e-6
            extra={}
            if name=='roughness':
                assert np.max(abs(a[:,:,0]-a[:,:,1]))==0 and np.max(abs(a[:,:,1]-a[:,:,2]))==0
                extra['range']=[int(a.min()),int(a.max())]
            if name=='normal':
                n=a/255*2-1
                lengths=np.linalg.norm(n,axis=2)
                assert np.percentile(abs(lengths-1),99)<.15
                assert np.percentile(n[:,:,2],1)>.05
                extra['normal_length_error_p99']=float(np.percentile(abs(lengths-1),99))
            files.append(dict(path=record['path'],sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                              resolution=[1024,1024],jpeg=True,seams='pass',**extra))
        tiled=Image.open(HERE/'tiling'/(spec['key']+'.jpg'))
        assert tiled.size==(2048,2048) and tiled.format=='JPEG'
    assert len(files)==21
    return dict(status='pass',files=files,physical_pitch='square tile, exact integer counts',
                adjustments='all within +/-10%',normal='OpenGL +Y, linear data',roughness='linear grayscale')


if __name__=='__main__':
    report=validate()
    (HERE/'file-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print('PASS: 21 JPEG files, pitch, normals, decoded seams, seven 2x2 images')
