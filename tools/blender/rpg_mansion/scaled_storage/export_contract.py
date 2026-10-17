"""Storage-only GLB export: exactly the selected active-scene mesh."""
from pathlib import Path
import bpy


def export(obj, path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.export_scene.gltf(
        filepath=str(path),use_selection=True,use_active_scene=True,
        export_format='GLB',export_apply=True,export_yup=True,
        export_animations=False,export_skins=False,export_morph=False,
        export_extras=True,export_texture_dir='')
    return path.stat().st_size
