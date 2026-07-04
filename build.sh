#!/bin/bash
set -e
MAX_CLOUDFLARE_ASSET_BYTES=$((25 * 1024 * 1024))

check_cloudflare_asset_sizes() {
  local oversized=0
  local size
  while IFS= read -r -d '' file; do
    size=$(wc -c < "$file" | tr -d '[:space:]')
    echo "Asset too large for Cloudflare Workers: $file (${size} bytes; max ${MAX_CLOUDFLARE_ASSET_BYTES})" >&2
    oversized=1
  done < <(find dist -type f -size +"${MAX_CLOUDFLARE_ASSET_BYTES}"c -print0)

  if [ "$oversized" -ne 0 ]; then
    exit 1
  fi
}

rm -rf dist
mkdir -p dist/assets/env dist/assets/textures dist/assets/models
cp index.html dist/
cp -r assets/. dist/assets/
echo "Build complete: dist/"
ls -lh dist/index.html
du -sh dist/
check_cloudflare_asset_sizes
if [ "${SKIP_DEPLOY:-0}" = "1" ]; then
  echo "Skipping deploy because SKIP_DEPLOY=1"
  exit 0
fi
npx wrangler deploy
