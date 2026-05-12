#!/bin/bash
set -e
rm -rf dist
mkdir -p dist/assets/env dist/assets/textures dist/assets/models
cp index.html dist/
cp -r assets/. dist/assets/
echo "Build complete: dist/"
ls -lh dist/index.html
du -sh dist/
npx wrangler deploy
