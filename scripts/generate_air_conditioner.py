"""Generate the wall-mounted air-conditioner GLB and catalog renders in Blender."""
import math
import os

import bpy
from mathutils import Vector


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT, "assets", "models", "custom")
MODEL_PATH = os.path.join(OUT_DIR, "air_conditioner_wall.glb")
BLEND_PATH = os.path.join(OUT_DIR, "air_conditioner_wall.blend")
THUMB_PATH = os.path.join(OUT_DIR, "air_conditioner_wall_thumb.png")
TOP_PATH = os.path.join(OUT_DIR, "air_conditioner_wall_top.png")


def material(name, color, metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def rounded_box(name, location, scale, mat, bevel=0.015):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0] / 2, scale[1] / 2, scale[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Soft molded corners", "BEVEL")
    modifier.width = bevel
    modifier.segments = 4
    obj.data.materials.append(mat)
    return obj


def add_louver(name, x, z, width, mat):
    louver = rounded_box(name, (x, -0.126, z), (width, 0.012, 0.018), mat, 0.004)
    louver.rotation_euler.x = math.radians(-18)
    return louver


def aim_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render(path, camera_location, target, ortho_scale):
    scene = bpy.context.scene
    camera = bpy.data.objects["CatalogCamera"]
    camera.location = camera_location
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = ortho_scale
    aim_camera(camera, target)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


os.makedirs(OUT_DIR, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

white = material("Warm white ABS", (0.91, 0.92, 0.91), roughness=0.28)
panel_white = material("Front panel", (0.97, 0.975, 0.97), roughness=0.22)
shadow = material("Vent shadow", (0.055, 0.065, 0.07), roughness=0.52)
fin = material("Air fins", (0.55, 0.58, 0.59), metallic=0.15, roughness=0.45)
display = material("Display lens", (0.07, 0.12, 0.13), roughness=0.18)
accent = material("Display light", (0.30, 0.92, 0.70), metallic=0.05, roughness=0.22)

# Blender coordinates: X=width, Y=depth (front is -Y), Z=height.
# The vent protrusion brings the finished depth to roughly 260 mm.
rounded_box("Main molded housing", (0, 0, 0.1475), (0.80, 0.22, 0.295), white, 0.045)
front = rounded_box("Curved front cover", (0, -0.113, 0.166), (0.735, 0.032, 0.218), panel_white, 0.027)
front.rotation_euler.x = math.radians(-2)

# Lower outlet and its inset dark cavity.
rounded_box("Lower outlet cavity", (0, -0.126, 0.061), (0.675, 0.020, 0.078), shadow, 0.010)
rounded_box("Outlet upper lip", (0, -0.143, 0.096), (0.692, 0.016, 0.018), white, 0.006)
for i in range(9):
    x = -0.288 + i * 0.072
    add_louver(f"Horizontal air guide {i + 1:02d}", x, 0.057, 0.052, fin)

# Vertical divider fins make the outlet readable at close range.
for i in range(13):
    x = -0.30 + i * 0.05
    rounded_box(f"Vertical fin {i + 1:02d}", (x, -0.142, 0.061), (0.006, 0.012, 0.056), fin, 0.002)

# Small status display and indicator; intentionally subtle like a domestic unit.
rounded_box("Status display", (0.255, -0.134, 0.151), (0.105, 0.010, 0.030), display, 0.006)
rounded_box("Status indicator", (0.287, -0.140, 0.151), (0.025, 0.004, 0.008), accent, 0.003)

# Side intake seams.
for side in (-1, 1):
    rounded_box(f"Side seam {side}", (side * 0.382, -0.015, 0.170), (0.006, 0.145, 0.165), shadow, 0.002)

# Preserve authored names and transforms, then export through Blender's glTF exporter.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
bpy.ops.export_scene.gltf(
    filepath=MODEL_PATH,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)

# Catalog renders.
bpy.ops.object.camera_add(location=(1.15, -1.35, 0.90))
camera = bpy.context.object
camera.name = "CatalogCamera"
bpy.context.scene.camera = camera
bpy.ops.object.light_add(type="AREA", location=(-1.2, -1.4, 1.8))
bpy.context.object.data.energy = 850
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 2.2
bpy.ops.object.light_add(type="AREA", location=(1.4, 0.6, 1.0))
bpy.context.object.data.energy = 500
bpy.context.object.data.size = 1.8

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.world.color = (0.055, 0.065, 0.08)

render(THUMB_PATH, (1.15, -1.35, 0.90), (0, 0, 0.14), 1.08)
render(TOP_PATH, (0, 0, 2.2), (0, 0, 0.12), 1.02)

print("Generated:", MODEL_PATH)
print("Generated:", BLEND_PATH)
print("Generated:", THUMB_PATH)
print("Generated:", TOP_PATH)
