import bpy, addon_utils
addon_utils.enable('blender_mcp_addon', default_set=True, persistent=True)
def _start():
    try:
        bpy.ops.blendermcp.start_server()
        print('BLENDERMCP_STARTED')
    except Exception as e:
        print('BLENDERMCP_START_FAILED', e)
    return None
bpy.app.timers.register(_start, first_interval=1.0)
