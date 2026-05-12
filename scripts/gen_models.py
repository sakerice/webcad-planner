#!/usr/bin/env python3
"""Generate GLB furniture models at Japanese housing standard dimensions."""
import os
import numpy as np
try:
    import pygltflib as gl
except ImportError:
    print("pip install pygltflib"); exit(1)

OUT = "assets/models"
os.makedirs(OUT, exist_ok=True)

# (name, W_m, D_m, H_m, [R,G,B] 0-1)
FURNITURE = [
    ("sofa",         2.100, 0.850, 0.750, [0.85, 0.78, 0.65]),
    ("bed_double",   1.400, 1.950, 0.550, [0.95, 0.92, 0.88]),
    ("bed_single",   0.970, 1.950, 0.550, [0.95, 0.92, 0.88]),
    ("kitchen",      2.550, 0.650, 0.850, [0.80, 0.75, 0.65]),
    ("bathtub",      1.600, 1.600, 0.600, [0.96, 0.96, 0.98]),
    ("toilet",       0.380, 0.680, 0.400, [0.96, 0.96, 0.96]),
    ("sink",         0.750, 0.560, 0.800, [0.92, 0.92, 0.95]),
    ("fridge",       0.650, 0.700, 1.800, [0.90, 0.92, 0.93]),
    ("dining_table", 1.200, 0.800, 0.720, [0.65, 0.48, 0.28]),
    ("desk",         1.200, 0.600, 0.720, [0.72, 0.62, 0.48]),
    ("tv",           1.200, 0.080, 0.700, [0.10, 0.10, 0.12]),
    ("closet",       1.800, 0.600, 2.100, [0.82, 0.76, 0.64]),
]

def box_glb(path, w, d, h, color):
    """Single-box GLB: centered on X/Z, bottom at Y=0, +Y up."""
    hw, hd = w/2, d/2
    v = np.array([
        [-hw,0,hd],[hw,0,hd],[hw,h,hd],[-hw,h,hd],
        [hw,0,-hd],[-hw,0,-hd],[-hw,h,-hd],[hw,h,-hd],
        [-hw,0,-hd],[-hw,0,hd],[-hw,h,hd],[-hw,h,-hd],
        [hw,0,hd],[hw,0,-hd],[hw,h,-hd],[hw,h,hd],
        [-hw,h,hd],[hw,h,hd],[hw,h,-hd],[-hw,h,-hd],
        [-hw,0,-hd],[hw,0,-hd],[hw,0,hd],[-hw,0,hd],
    ], dtype='f4')
    n = np.array(
        [[0,0,1]]*4+[[0,0,-1]]*4+[[-1,0,0]]*4+
        [[1,0,0]]*4+[[0,1,0]]*4+[[0,-1,0]]*4, dtype='f4')
    idx = np.array([
        0,1,2,0,2,3, 4,5,6,4,6,7, 8,9,10,8,10,11,
        12,13,14,12,14,15, 16,17,18,16,18,19, 20,21,22,20,22,23
    ], dtype='u2')
    vb, nb, ib = v.tobytes(), n.tobytes(), idx.tobytes()
    pad = (4 - len(ib)%4) % 4
    buf = vb + nb + ib + b'\x00'*pad

    gltf = gl.GLTF2(
        scene=0, scenes=[gl.Scene(nodes=[0])], nodes=[gl.Node(mesh=0)],
        meshes=[gl.Mesh(primitives=[gl.Primitive(
            attributes=gl.Attributes(POSITION=0, NORMAL=1),
            indices=2, material=0)])],
        materials=[gl.Material(
            pbrMetallicRoughness=gl.PbrMetallicRoughness(
                baseColorFactor=[*color, 1.0],
                roughnessFactor=0.78, metallicFactor=0.0),
            doubleSided=False)],
        accessors=[
            gl.Accessor(bufferView=0, componentType=gl.FLOAT, count=24,
                        type=gl.VEC3, max=v.max(0).tolist(), min=v.min(0).tolist()),
            gl.Accessor(bufferView=1, componentType=gl.FLOAT, count=24, type=gl.VEC3),
            gl.Accessor(bufferView=2, componentType=gl.UNSIGNED_SHORT,
                        count=36, type=gl.SCALAR),
        ],
        bufferViews=[
            gl.BufferView(buffer=0, byteOffset=0,         byteLength=len(vb), target=gl.ARRAY_BUFFER),
            gl.BufferView(buffer=0, byteOffset=len(vb),   byteLength=len(nb), target=gl.ARRAY_BUFFER),
            gl.BufferView(buffer=0, byteOffset=len(vb)+len(nb), byteLength=len(ib),
                          target=gl.ELEMENT_ARRAY_BUFFER),
        ],
        buffers=[gl.Buffer(byteLength=len(buf))],
    )
    gltf.set_binary_blob(buf)
    gltf.save(path)
    sz = os.path.getsize(path)
    print(f"  {os.path.basename(path):25s}  {w:.3f}x{d:.3f}x{h:.3f}m  {sz} bytes")

if __name__ == "__main__":
    print(f"Generating {len(FURNITURE)} GLB models -> {OUT}/")
    for name, w, d, h, color in FURNITURE:
        box_glb(f"{OUT}/{name}.glb", w, d, h, color)
    print("Done.")
