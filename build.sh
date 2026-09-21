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

# **ここでは配信しない。ビルドするだけ。**
#
# 以前は末尾で `npx wrangler deploy` を実行し、SKIP_DEPLOY=1 を付けたときだけ
# 止まる形だった。つまり「ビルドを確かめよう」と思って `bash build.sh` と
# 打つと、そのまま本番が入れ替わった。実際、検証のつもりで実行して本番を
# 差し替える事故が起きている。
#
# **既定を逆にする。** 名前が build なら build しかしない。配信は
# tools/deploy.sh という別の名前の、別の操作にする。
#
# Workers Builds(Gitからの自動デプロイ)への影響は無い。あちらは
# wrangler.toml の [build] command で `SKIP_DEPLOY=1 bash build.sh` を呼び、
# dist/ を作らせるだけで、配信は wrangler 自身が行う。この変更後も同じ
# コマンドが同じ dist/ を作って終了コード0で返る。SKIP_DEPLOY はもう
# 読んでいないが、付いていても害は無いのでコマンドは変えていない。
echo
echo "dist/ を作りました。**本番には出していません。**"
echo "本番へ出すときは: bash tools/deploy.sh"
