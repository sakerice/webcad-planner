"""Render final GLB (not a substitute) and first-series GLBs in the same light."""
import argparse
import importlib.util
import sys
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ID = 'kominka-kitchen-run-2560-01'
sys.path.insert(0, str(HERE.parents[1]))
import model_kit as kit
spec = importlib.util.spec_from_file_location('first_render', HERE.parent/'render.py')
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


def load(path):
    old = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    parts = [o for o in bpy.data.objects if o not in old and o.type == 'MESH']
    obj = kit.combine(parts)
    kit.activate(obj)
    # glTF +Y-up is imported back into Blender Z-up without shape scaling.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o != obj and o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return obj


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', type=Path, default=ROOT)
    p.add_argument('--samples', type=int, default=32)
    a = p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    kit.clear_scene()
    obj = load(a.root/f'assets/models/packs/kominka/models/{ID}.glb')
    for view in ('thumb', 'top', 'front', 'rear'):
        path = (a.root/f'assets/models/packs/kominka/previews/{ID}-{view}.png'
            if view in ('thumb', 'top') else
            a.root/f'tools/blender/kominka/set3/evidence/{ID}-{view}.jpg')
        R.render(obj, path, view, a.samples)
    kit.clear_scene()
    parts = []
    offset = 0
    # Left to right: first-series sink, new integrated kitchen, first-series stove.
    for mid in ('kominka-sink-01', ID, 'kominka-kamado-01'):
        source_root = a.root if mid == ID else ROOT
        obj = load(source_root/f'assets/models/packs/kominka/models/{mid}.glb')
        xs = [v.co.x for v in obj.data.vertices]
        obj.location.x = offset-min(xs)
        offset += max(xs)-min(xs)+.28
        parts.append(obj)
    obj = kit.combine(parts)
    kit.activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    R.render(obj, a.root/'tools/blender/kominka/set3/evidence/compare-kitchen.jpg', 'thumb', a.samples)
    # More pixels for the three-item comparison, keeping the exact same light.
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 512
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
