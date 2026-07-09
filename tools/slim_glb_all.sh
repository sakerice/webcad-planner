#!/bin/bash
# 配信対象マニフェスト配下の1MB超GLBのテクスチャを1024px上限に縮小(ジオメトリ非変更)。
# 失敗したファイルは元のまま残す
cd "$(dirname "$0")/.."
find assets/models/furniture_mega assets/models/interior_model_0_26_1 -name '*.glb' -size +1M | while read -r f; do
  echo "== $f"
  if npx --yes @gltf-transform/cli resize --width 1024 --height 1024 "$f" "$f.tmp.glb" >/dev/null 2>&1 \
     && npx --yes @gltf-transform/cli prune "$f.tmp.glb" "$f.tmp2.glb" >/dev/null 2>&1; then
    mv "$f.tmp2.glb" "$f"
  else
    echo "   SKIP (failed): $f"
  fi
  rm -f "$f.tmp.glb" "$f.tmp2.glb"
done
echo DONE
du -sh assets/models/furniture_mega assets/models/interior_model_0_26_1
