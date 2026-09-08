import importlib.util, json, math, sys
spec = importlib.util.spec_from_file_location('lp', 'tools/lint_plan.py')
lp = importlib.util.module_from_spec(spec); spec.loader.exec_module(lp)
# 引数2つ目でプランのパスを差し替えられる(3階建てプランなどの調査用)
floor = int(sys.argv[1])
data = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'assets/default_plan.json'))
CELL = 100.0; CLEAR = 600.0; pad = CLEAR / 2.0
rms = [r for r in data['rooms'] if r.get('floor', 1) == floor]
x0 = min(r['x'] for r in rms); x1 = max(r['x'] + r['w'] for r in rms)
y0 = min(r['y'] for r in rms); y1 = max(r['y'] + r['d'] for r in rms)
nx = int((x1 - x0) / CELL) + 2; ny = int((y1 - y0) / CELL) + 2
inside = [[False] * ny for _ in range(nx)]
for i in range(nx):
    for j in range(ny):
        px, py = x0 + i * CELL, y0 + j * CELL
        for r in rms:
            if r['x'] <= px <= r['x'] + r['w'] and r['y'] <= py <= r['y'] + r['d']:
                inside[i][j] = True; break
blocked = [[False] * ny for _ in range(nx)]
WHO = {}
cur = ['?']
def mark(box, extra):
    for i in range(max(0, int(math.floor((box[0]-extra-x0)/CELL))+1), min(nx-1, int(math.ceil((box[2]+extra-x0)/CELL))-1)+1):
        for j in range(max(0, int(math.floor((box[1]-extra-y0)/CELL))+1), min(ny-1, int(math.ceil((box[3]+extra-y0)/CELL))-1)+1):
            blocked[i][j] = True
            WHO.setdefault((i, j), []).append(cur[0])
for w in data['walls']:
    if w.get('floor', 1) != floor: continue
    ht = (w.get('thick', 120) or 120) / 2.0
    cur[0] = 'wall%s' % w['id']
    mark((min(w['x1'],w['x2'])-ht, min(w['y1'],w['y2'])-ht, max(w['x1'],w['x2'])+ht, max(w['y1'],w['y2'])+ht), pad)
for f in data['items']:
    if f.get('floor', 1) == floor and lp.is_furniture(f) and (f.get('elev') or 0) < 500:
        cur[0] = lp.label(f)
        mark(lp.aabb(f), pad)
for d in data['items']:
    if d.get('floor',1) != floor or d.get('type') not in lp.DOOR_TYPES or d.get('type') == 'window': continue
    b = lp.aabb(d); vx, vy = lp.axes(d)[1]
    ex = CLEAR if abs(vx) > abs(vy) else 0.0
    ey = CLEAR if abs(vy) >= abs(vx) else 0.0
    for i in range(max(0, int((b[0]-ex-x0)/CELL)), min(nx-1, int((b[2]+ex-x0)/CELL))+1):
        for j in range(max(0, int((b[1]-ey-y0)/CELL)), min(ny-1, int((b[3]+ey-y0)/CELL))+1):
            blocked[i][j] = False
free = [[inside[i][j] and not blocked[i][j] for j in range(ny)] for i in range(nx)]
start = None
entry = [r for r in rms if '玄関' in (r.get('n') or '')] or [r for r in rms if 'ホール' in (r.get('n') or '')] or rms
for r in entry:
    ci = int((r['x']+r['w']/2-x0)/CELL); cj = int((r['y']+r['d']/2-y0)/CELL)
    for di in range(-4, 5):
        for dj in range(-4, 5):
            i, j = ci+di, cj+dj
            if 0 <= i < nx and 0 <= j < ny and free[i][j]: start = (i, j); break
        if start: break
    if start: break
seen = [[False]*ny for _ in range(nx)]
st = [start]; seen[start[0]][start[1]] = True
while st:
    i, j = st.pop()
    for di, dj in ((1,0),(-1,0),(0,1),(0,-1)):
        a, b2 = i+di, j+dj
        if 0 <= a < nx and 0 <= b2 < ny and free[a][b2] and not seen[a][b2]:
            seen[a][b2] = True; st.append((a, b2))
print('start', start, 'entry room', entry[0].get('n'))
for j in range(ny):
    print('%5d %s' % (int(y0+j*CELL), ''.join('o' if seen[i][j] else ('.' if free[i][j] else ('#' if inside[i][j] else ' ')) for i in range(nx))))
if len(sys.argv) > 3:
    print('WHO', (int(sys.argv[2]), int(sys.argv[3])), WHO.get((int(sys.argv[2]), int(sys.argv[3]))))
