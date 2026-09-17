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

# 出荷する間取りが「読み込める形」であること。テストからは既定間取りを
# 読めない決まりなので(tools/tests/fixture-only.test.cjs)、ここで見る。
node tools/check_plan_schema.cjs assets/default_plan.json assets/default_plan_3f.json

rm -rf dist
mkdir -p dist/assets/env dist/assets/textures dist/assets/models
cp index.html dist/
cp -r assets/. dist/assets/
# HTML and its scripts/styles must advance together, even with a warm browser cache.
python3 tools/version_page_assets.py dist/index.html
# Only the reviewed, registered original collection belongs in the delivery.
# Keep bulk Blender candidates locally for further work, not in the public build.
# node で書いてあるのは、Workers Builds のビルド環境に python3 がある保証が
# 無いため。node は wrangler が動く以上かならず在る。
node - <<'JSMODELS'
const fs=require('node:fs'), path=require('node:path');
const registered=new Set();
for(const dir of fs.readdirSync('assets/models',{withFileTypes:true})){
  if(!dir.isDirectory()) continue;
  const f=path.join('assets/models',dir.name,'manifest.json');
  if(!fs.existsSync(f)) continue;
  let m; try{ m=JSON.parse(fs.readFileSync(f,'utf8')); }catch(e){ continue; }
  if(m && Array.isArray(m.items)) for(const it of m.items) if(it && it.model) registered.add(it.model);
}
const out='dist/assets/models/original';
if(fs.existsSync(out)) for(const name of fs.readdirSync(out)){
  if(!name.endsWith('.glb')) continue;
  if(!registered.has(path.posix.join('assets/models/original',name))) fs.unlinkSync(path.join(out,name));
}
JSMODELS
echo "Build complete: dist/"
ls -lh dist/index.html
du -sh dist/
check_cloudflare_asset_sizes
if [ "${SKIP_DEPLOY:-0}" = "1" ]; then
  echo "Skipping deploy because SKIP_DEPLOY=1"
  exit 0
fi
npx wrangler deploy
