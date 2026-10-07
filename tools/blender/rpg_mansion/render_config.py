"""Keep repository icon framing while supporting distro Blender without OIDN."""
def configure():
    import bpy
    import exterior_build
    original = exterior_build._icon_scene
    def icon_scene(*args, **kwargs):
        scene = original(*args, **kwargs)
        scene.cycles.use_denoising = False
        scene.cycles.samples = 64
        return scene
    exterior_build._icon_scene = icon_scene
    @bpy.app.handlers.persistent
    def fit_margin(scene, *args):
        camera = scene.camera
        if camera and camera.constraints and not camera.get('rpg_margin_applied'):
            camera.data.ortho_scale *= 1.4
            camera['rpg_margin_applied'] = True
    bpy.app.handlers.render_pre.append(fit_margin)
