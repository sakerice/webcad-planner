#!/bin/bash
# unity_exported GLB のテクスチャを1024px上限に縮小(ジオメトリ非変更)
set -e
cd "$(dirname "$0")/.."
for f in assets/models/unity_exported/*.glb; do
  echo "== $f"
  npx --yes @gltf-transform/cli resize --width 1024 --height 1024 "$f" "$f.tmp.glb"
  npx --yes @gltf-transform/cli prune "$f.tmp.glb" "$f.tmp2.glb"
  mv "$f.tmp2.glb" "$f"
  rm -f "$f.tmp.glb"
done
ls -la assets/models/unity_exported/
