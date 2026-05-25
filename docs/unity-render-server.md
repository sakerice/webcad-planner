# Unity render server

WebCAD can send the current plan and camera to a Unity render server. The web app is static, so Unity rendering must run on a separate machine that can start Unity in batch mode.

## Local development

```bash
cd /Users/nariiwa/Documents/GitHub/webcad-planner
node tools/unity-render-server.cjs
```

Then use this URL in WebCAD:

```text
http://127.0.0.1:8788
```

## Remote server

Run the same server on a machine with Unity installed and expose it behind HTTPS.

```bash
WEBCAD_UNITY_RENDER_HOST=0.0.0.0 \
WEBCAD_UNITY_RENDER_PORT=8788 \
WEBCAD_UNITY_PATH=/path/to/Unity \
WEBCAD_UNITY_PROJECT=/path/to/webcad-unity \
WEBCAD_UNITY_RENDER_DIR=/path/to/render-output \
node tools/unity-render-server.cjs
```

Expose the server as something like:

```text
https://render.example.com
```

In WebCAD, open the Unity render dialog, enter that URL, and press connection check. The app calls:

- `GET /health`
- `POST /render`
- `GET /renders/<render-file>.png`

The server already sends permissive CORS headers. Put authentication or network restrictions in front of it before public use, because rendering starts a Unity process and is expensive.
