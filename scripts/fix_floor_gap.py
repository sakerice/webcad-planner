#!/usr/bin/env python3
"""Fix inter-floor gaps: extend wall height from WALL_H to FLOOR_H in 3D."""
import os, sys, re

TARGET = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'))

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

original = src
patches = []

# 1. Wall mesh height and position in buildWall3D
# BoxGeometry(len, WALL_H*U, thick) → BoxGeometry(len, FLOOR_H*U, thick)
old1 = 'new THREE.BoxGeometry(len,WALL_H*U,w.thick*U)'
new1 = 'new THREE.BoxGeometry(len,FLOOR_H*U,w.thick*U)'
if old1 in src:
    src = src.replace(old1, new1, 1)
    patches.append('✓ Wall BoxGeometry height: WALL_H -> FLOOR_H')
elif new1 in src:
    patches.append('- Wall BoxGeometry: already FLOOR_H (skipped)')
else:
    patches.append('⚠ Wall BoxGeometry anchor not found')

# 2. Wall mesh Y position center
old2 = 'mesh.position.set((x1+x2)/2,fy+WALL_H*U/2,(z1+z2)/2);'
new2 = 'mesh.position.set((x1+x2)/2,fy+FLOOR_H*U/2,(z1+z2)/2);'
if old2 in src:
    src = src.replace(old2, new2, 1)
    patches.append('✓ Wall position Y center: WALL_H -> FLOOR_H')
elif new2 in src:
    patches.append('- Wall position: already FLOOR_H (skipped)')
else:
    patches.append('⚠ Wall position anchor not found')

# 3. Wall texture repeat height (siding)
old3 = '(WALL_H*U)*2.8'
new3 = '(FLOOR_H*U)*2.8'
if old3 in src:
    src = src.replace(old3, new3)
    patches.append('✓ Siding texture repeat height: WALL_H -> FLOOR_H')
else:
    patches.append('- Siding texture repeat: not found or already updated')

# 4. Wall texture repeat height (plaster)
old4 = '(WALL_H*U)*1.8'
new4 = '(FLOOR_H*U)*1.8'
if old4 in src:
    src = src.replace(old4, new4)
    patches.append('✓ Plaster texture repeat height: WALL_H -> FLOOR_H')
else:
    patches.append('- Plaster texture repeat: not found or already updated')

# 5. Wall texture repeat height (interior wall)
old5 = '.repeat.set(len,WALL_H*U)'
new5 = '.repeat.set(len,FLOOR_H*U)'
if old5 in src:
    src = src.replace(old5, new5)
    patches.append('✓ Interior wall texture repeat: WALL_H -> FLOOR_H')
else:
    patches.append('- Interior wall texture repeat: not found or already updated')

if src == original:
    print('No changes made.')
else:
    with open(TARGET, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'Patched: {TARGET}')

print('\nPatch summary:')
for p in patches:
    print(f'  {p}')
