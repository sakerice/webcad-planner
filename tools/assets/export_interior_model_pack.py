#!/usr/bin/env python3
"""Export Interior Model 0.26.1 blend assets into WebCAD-ready GLBs.

Run with Blender:
  Blender --factory-startup -b --python tools/assets/export_interior_model_pack.py -- <blend_root> <output_root> [--limit N]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy
import mathutils


SKIP_BLEND_PARTS = {
    "Interior Model 26.blend",
    "material-7.2.2.blend",
}

SKIP_OBJECT_NAMES = {
    "Camera",
    "Plane",
}

SKIP_PREFIXES = (
    "Studio_Preset",
)

DEFAULT_FORCE_OPAQUE_FOLDERS = {
    "Bath",
    "Bed",
    "Cabinet",
    "Chair",
    "Door",
    "Electronic",
    "Kid",
    "Kitchen",
    "Lamp",
    "Mattress",
    "Shelf",
    "Sofa",
    "Table",
    "Tableset",
    "Tv",
    "Wall",
}

CATEGORY_BY_FOLDER = {
    "Bath": ("住設", "バスルーム"),
    "Bed": ("家具", "ベッド"),
    "Cabinet": ("家具", "キャビネット"),
    "Carpet": ("家具", "カーペット"),
    "Chair": ("家具", "チェア"),
    "Curtain": ("家具", "カーテン"),
    "Decor": ("家具", "装飾"),
    "Door": ("家具", "ドア"),
    "Electronic": ("家具", "家電"),
    "electronics": ("家具", "家電"),
    "Kid": ("家具", "キッズ"),
    "Kitchen": ("住設", "キッチン"),
    "Lamp": ("家具", "照明"),
    "Mattress": ("家具", "マットレス"),
    "Mirror": ("家具", "ミラー"),
    "Painting": ("家具", "絵画"),
    "Pet": ("家具", "ペット"),
    "Plant": ("家具", "植物"),
    "Shelf": ("家具", "シェルフ"),
    "Sofa": ("家具", "ソファ"),
    "Table": ("家具", "テーブル"),
    "Tableset": ("家具", "テーブルセット"),
    "Tv": ("家具", "テレビ"),
    "Wall": ("家具", "壁装飾"),
    "Window": ("家具", "窓"),
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    parser = argparse.ArgumentParser()
    parser.add_argument("blend_root")
    parser.add_argument("output_root")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--manifest-only", action="store_true")
    parser.add_argument("--mega-only", action="store_true")
    parser.add_argument("--reset-manifest", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--previews-only", action="store_true")
    parser.add_argument("--folders", default="")
    parser.add_argument("--force-opaque-folders", default=",".join(sorted(DEFAULT_FORCE_OPAQUE_FOLDERS)))
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def slugify(value: str) -> str:
    value = value.strip().replace("\\", "/").split("/")[-1]
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("._-")
    return value or "asset"


def should_skip_object(obj: bpy.types.Object) -> bool:
    if obj.type != "MESH":
        return True
    if obj.name in SKIP_OBJECT_NAMES:
        return True
    if any(obj.name.startswith(prefix) for prefix in SKIP_PREFIXES):
        return True
    if not obj.data or len(obj.data.polygons) == 0:
        return True
    return False


def object_bounds_world(obj: bpy.types.Object) -> tuple[mathutils.Vector, mathutils.Vector]:
    coords = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
    min_v = mathutils.Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
    max_v = mathutils.Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
    return min_v, max_v


def dimensions_mm(obj: bpy.types.Object) -> tuple[int, int, int]:
    min_v, max_v = object_bounds_world(obj)
    size = max_v - min_v
    # The source files are authored in meters-like Blender units.
    return (
        max(10, int(round(size.x * 1000))),
        max(10, int(round(size.y * 1000))),
        max(10, int(round(size.z * 1000))),
    )


def select_only(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def export_glb(obj: bpy.types.Object, path: Path, *, force_opaque: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    prepare_materials(obj, force_opaque=force_opaque)
    select_only(obj)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def prepare_materials(obj: bpy.types.Object, *, force_opaque: bool = False) -> None:
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        # Many source assets use single-sided planes. Keep both GLB and previews
        # double-sided so backfaces do not disappear in thumbnails or WebGL.
        mat.use_backface_culling = False
        if hasattr(mat, "show_transparent_back"):
            mat.show_transparent_back = True
        if hasattr(mat, "use_backface_culling_shadow"):
            mat.use_backface_culling_shadow = False
        if force_opaque:
            mat.blend_method = "OPAQUE"
            if hasattr(mat, "surface_render_method"):
                mat.surface_render_method = "DITHERED"
            if mat.use_nodes and mat.node_tree:
                for link in list(mat.node_tree.links):
                    if link.to_socket.name == "Alpha":
                        mat.node_tree.links.remove(link)
                for node in mat.node_tree.nodes:
                    if node.type == "BSDF_PRINCIPLED" and "Alpha" in node.inputs:
                        node.inputs["Alpha"].default_value = 1.0


def configure_scene() -> None:
    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.film_transparent = True
    for view_transform in ("AgX", "Filmic", "Standard"):
        try:
            bpy.context.scene.view_settings.view_transform = view_transform
            break
        except TypeError:
            continue
    for look in ("Medium Low Contrast", "Low Contrast", "None"):
        try:
            bpy.context.scene.view_settings.look = look
            break
        except TypeError:
            continue
    bpy.context.scene.view_settings.exposure = -0.45
    bpy.context.scene.view_settings.gamma = 1.0
    bpy.context.scene.world.color = (0.78, 0.78, 0.78)


def capture(obj: bpy.types.Object, path: Path, *, top: bool, size: int, force_opaque: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    configure_scene()
    prepare_materials(obj, force_opaque=force_opaque)
    for existing in [o for o in bpy.context.scene.objects if o.name.startswith("WebCAD_Capture_")]:
        bpy.data.objects.remove(existing, do_unlink=True)

    min_v, max_v = object_bounds_world(obj)
    center = (min_v + max_v) * 0.5
    extent = max(max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z, 0.1)

    cam_data = bpy.data.cameras.new("WebCAD_Capture_Camera")
    cam = bpy.data.objects.new("WebCAD_Capture_Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam_data.type = "ORTHO"
    cam_data.clip_end = 1000

    if top:
        cam.location = (center.x, center.y, center.z + extent * 2.6 + 1.0)
        cam.rotation_euler = (0, 0, 0)
        direction = mathutils.Vector((0, 0, -1))
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = max(max_v.x - min_v.x, max_v.y - min_v.y, 0.1) * 1.18
    else:
        direction = mathutils.Vector((1.35, -1.35, 0.9)).normalized()
        cam.location = center + direction * (extent * 2.6 + 1.0)
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = extent * 1.35

    light_data = bpy.data.lights.new("WebCAD_Capture_Key", "AREA")
    light = bpy.data.objects.new("WebCAD_Capture_Key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = center + mathutils.Vector((extent * 1.4, -extent * 1.2, extent * 2.0 + 1.0))
    light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    light_data.energy = 260
    light_data.size = max(1.2, extent * 1.2)

    bpy.context.scene.camera = cam
    bpy.context.scene.render.resolution_x = size
    bpy.context.scene.render.resolution_y = size
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.filepath = str(path)

    visible = {}
    for scene_obj in bpy.context.scene.objects:
        visible[scene_obj.name] = scene_obj.hide_render
        if scene_obj.type == "MESH":
            scene_obj.hide_render = scene_obj != obj
    bpy.ops.render.render(write_still=True)
    for scene_obj in bpy.context.scene.objects:
        if scene_obj.name in visible:
            scene_obj.hide_render = visible[scene_obj.name]


def iter_blends(root: Path, *, mega_only: bool) -> list[Path]:
    paths = []
    for path in sorted(root.rglob("*.blend")):
        if path.name in SKIP_BLEND_PARTS:
            continue
        if mega_only and not path.name.startswith("MEGA PACK"):
            continue
        paths.append(path)
    return paths


def parse_csv(value: str) -> set[str]:
    return {part.strip() for part in value.split(",") if part.strip()}


def classify(path: Path) -> tuple[str, str, str]:
    folder = path.parent.name
    group, category = CATEGORY_BY_FOLDER.get(folder, ("家具", folder))
    return folder, group, category


def load_existing_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return []
    return data.get("items", [])


def write_manifest(output_root: Path, items: list[dict]) -> None:
    manifest = {
        "version": 1,
        "source": "Interior Model 0.26.1",
        "items": items,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    text = json.dumps(manifest, ensure_ascii=False, indent=2)
    (output_root / "manifest.json").write_text(text + "\n")
    js = "window.INTERIOR_MODEL_MANIFEST = " + text + ";\n"
    (output_root / "manifest.js").write_text(js)


def main() -> int:
    args = parse_args(sys.argv)
    blend_root = Path(args.blend_root)
    output_root = Path(args.output_root)
    project_root = output_root.parents[2]
    only_folders = parse_csv(args.folders)
    force_opaque_folders = parse_csv(args.force_opaque_folders)
    items_by_id = {}
    if not args.reset_manifest:
        items_by_id = {item["id"]: item for item in load_existing_manifest(output_root / "manifest.json") if "id" in item}

    processed = 0
    for blend_path in iter_blends(blend_root, mega_only=args.mega_only):
        folder, group, category = classify(blend_path)
        if only_folders and folder not in only_folders:
            continue
        force_opaque = folder in force_opaque_folders
        print(f"OPEN {blend_path}", flush=True)
        bpy.ops.wm.open_mainfile(filepath=str(blend_path))
        mesh_objects = [obj for obj in bpy.data.objects if not should_skip_object(obj)]
        print(f"FOUND {len(mesh_objects)} mesh assets in {blend_path.relative_to(blend_root)}", flush=True)
        for obj in mesh_objects:
            asset_slug = slugify(obj.name)
            blend_slug = slugify(blend_path.stem)
            item_id = f"im0261-{folder}-{blend_slug}-{asset_slug}"
            if (
                not args.force
                and not args.previews_only
                and item_id in items_by_id
                and Path(project_root / items_by_id[item_id]["model"]).exists()
            ):
                processed += 1
                continue

            rel_dir = Path("assets/models/interior_model_0_26_1")
            model_rel = rel_dir / "glb" / folder / f"{blend_slug}__{asset_slug}.glb"
            top_rel = rel_dir / "top" / folder / f"{blend_slug}__{asset_slug}.png"
            thumb_rel = rel_dir / "thumb" / folder / f"{blend_slug}__{asset_slug}.png"
            model_path = project_root / model_rel
            top_path = project_root / top_rel
            thumb_path = project_root / thumb_rel

            w, d, h = dimensions_mm(obj)
            if args.verbose:
                print(f"EXPORT {item_id} {w}x{d}x{h}", flush=True)
            if not args.manifest_only:
                if not args.previews_only:
                    export_glb(obj, model_path, force_opaque=force_opaque)
                capture(obj, top_path, top=True, size=512, force_opaque=force_opaque)
                capture(obj, thumb_path, top=False, size=256, force_opaque=force_opaque)

            items_by_id[item_id] = {
                "id": item_id,
                "name": obj.name,
                "group": group,
                "category": category,
                "sourceFolder": folder,
                "sourceBlend": str(blend_path.relative_to(blend_root)),
                "model": model_rel.as_posix(),
                "top": top_rel.as_posix(),
                "thumb": thumb_rel.as_posix(),
                "w": w,
                "d": d,
                "h": h,
            }
            processed += 1
            write_manifest(output_root, sorted(items_by_id.values(), key=lambda item: item["id"]))
            if args.limit and processed >= args.limit:
                write_manifest(output_root, sorted(items_by_id.values(), key=lambda item: item["id"]))
                print(f"LIMIT {args.limit}", flush=True)
                return 0
        print(f"WROTE {len(items_by_id)} total manifest items", flush=True)

    write_manifest(output_root, sorted(items_by_id.values(), key=lambda item: item["id"]))
    print(f"DONE {len(items_by_id)} items", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
