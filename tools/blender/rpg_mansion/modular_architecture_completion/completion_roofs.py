"""Original completion roof construction, in native construction metres.

The weather surfaces are closed thin shells, never filled attic volumes.  These
functions accept the local completion_common helper; no frozen source is loaded.
"""
import math

from reference_mansard_roofs import patch, clip


SEAM_PROFILE = [(-.012, 0), (-.012, .030), (-.007, .038),
                (.007, .038), (.012, .030), (.012, 0),
                (.009, 0), (.009, .029), (.006, .035),
                (-.006, .035), (-.009, .029), (-.009, 0)]


def square(r):
    return [(-r, -r), (r, -r), (r, r), (-r, r)]


def variable_patch(g, name, top_polys, bottom, mat):
    """A stitched surface with a corresponding, possibly sloping, underside."""
    verts, faces, lookup = [], [], {}
    for poly in top_polys:
        ids = []
        for point in poly:
            key = tuple(round(v, 10) for v in point)
            if key not in lookup:
                lookup[key] = len(verts)
                verts.append(tuple(point))
            idx = lookup[key]
            if not ids or ids[-1] != idx:
                ids.append(idx)
        if len(ids) > 1 and ids[-1] == ids[0]:
            ids.pop()
        if len(set(ids)) >= 3:
            faces.append(ids)
    edges = {}
    for face in faces:
        for a, b in zip(face, face[1:] + face[:1]):
            edges.setdefault(tuple(sorted((a, b))), []).append((a, b))
    n = len(verts)
    verts += [(x, y, bottom(x, y, z)) for x, y, z in verts]
    closed = [tuple(face) for face in faces]
    closed += [tuple(i + n for i in reversed(face)) for face in faces]
    for values in edges.values():
        if len(values) == 1:
            a, b = values[0]
            closed.append((a, b, b + n, a + n))
        else:
            assert len(values) == 2, (name, 'nonmanifold patch', values)
    return g.mesh(name, verts, closed, mat)


def annulus(g, name, outer, inner, bottom, top, mat):
    """Closed polygonal annulus; the two profiles keep the same winding."""
    n = len(outer)
    assert n == len(inner)
    verts = [(x, y, f(x, y)) for f in (bottom, top)
             for loop in (outer, inner) for x, y in loop]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend([(i, j, 2*n+j, 2*n+i),
                      (n+i, 3*n+i, 3*n+j, n+j),
                      (i, n+i, n+j, j),
                      (2*n+i, 2*n+j, 3*n+j, 3*n+i)])
    return g.mesh(name, verts, faces, mat)


def folded_seam(g, name, start, end, position, mat='metal'):
    """Extrude the recovered twelve-point folded metal section."""
    n = len(SEAM_PROFILE)
    verts = [position(t, w, h) for t in (start, end)
             for w, h in SEAM_PROFILE]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    return g.mesh(name, verts, faces, mat)


def _gable_slate(g, label, side, stations, t0, t1):
    polys = []
    for (a, za), (b, zb) in zip(stations, stations[1:]):
        poly = clip([(a, t0), (b, t0), (b, t1), (a, t1)], 1, 1, 0)
        poly = clip(poly, 1, -1, 0) if side == 'front' else clip(poly, 0, -1, 0)
        # Clipping at a hip can create coincident corners.  Removing them here
        # preserves closed native caps when that corner is exactly on a course.
        clean = []
        for point in poly:
            if not clean or math.dist(point, clean[-1]) > 1e-9:
                clean.append(point)
        if len(clean) > 1 and math.dist(clean[0], clean[-1]) < 1e-9:
            clean.pop()
        if len(clean) < 3:
            continue
        area = abs(sum(p[0]*q[1]-q[0]*p[1]
                       for p, q in zip(clean, clean[1:]+clean[:1]))) / 2
        if area < 1e-10:
            continue
        pp = []
        for r, t in clean:
            lift = za+(zb-za)*(r-a)/(b-a)
            x, y = (t, -r) if side == 'front' else (side*r, t)
            pp.append((x, y, .7*(2.1-r)+lift+.015))
        polys.append(pp)
    if polys:
        return patch(g, label, polys, .015, 'slate')


def gable_hip(g):
    """Three-sided gable end: 4200 x 2100, matching the existing .7 span."""
    rim = [(-2.1, 0), (-2.1, -2.1), (2.1, -2.1), (2.1, 0)]
    polys = [[(0, 0, 1.525), (a[0], a[1], .055), (b[0], b[1], .055)]
             for a, b in zip(rim, rim[1:])]
    patch(g, 'Continuous three-sided hollow gable hip timber deck',
          polys, .055, 'roof_deck')
    for side in (-1, 1, 'front'):
        for row in range(7):
            a = row*.3+.004
            b = (row+1)*.3+(.014 if row < 6 else -.004)
            stations = ([(a, .055), (a+.025, .055),
                         (b-.015, .070), (b, .070)] if row < 6
                        else [(a, .055), (b, .055)])
            tmin, tmax = (-2.1, 2.1) if side == 'front' else (-2.1, 0)
            phase = .15 if row % 2 else 0
            cuts = sorted([tmin, tmax] + [k*.3+phase for k in range(-8, 9)
                          if tmin+1e-7 < k*.3+phase < tmax-1e-7])
            for col, (lo, hi) in enumerate(zip(cuts, cuts[1:])):
                q0 = lo+.002
                q1 = hi-(0 if hi == 0 and row % 2 else .002)
                _gable_slate(g, 'Gable hip slate %s course %02d tile %02d' %
                             (side, row+1, col+1), side, stations, q0, q1)
    # At y=0 this is the precise six-vertex section of the frozen ridge saddle.
    r = .095
    cap_rim = [(-r, 0), (-r, -r), (r, -r), (r, 0)]
    cap = [[(0, 0, 1.548), (a[0], a[1], 1.4785), (b[0], b[1], 1.4785)]
           for a, b in zip(cap_rim, cap_rim[1:])]
    variable_patch(g, 'Gable hip folded apex weather saddle', cap,
                   lambda x, y, z: 1.525-.7*max(abs(x), -y), 'metal')
    low = lambda r: .7*(2.1-r)
    for side in (-1, 1):
        a, b = (1.68, 1.92) if side > 0 else (-1.92, -1.68)
        g.prism('Gable hip side wall bearing '+str(side),
                [(a, .1), (b, .1), (b, low(abs(b))), (a, low(abs(a)))],
                'Y', -1.68, 0, 'roof_deck')
    g.prism('Gable hip transverse end wall bearing',
            [(-1.92, .1), (-1.68, .1), (-1.68, low(1.68)), (-1.92, low(1.92))],
            'X', -1.68, 1.68, 'roof_deck')
    for side in (-1, 1):
        a, b = (side*1.68, -1.68), (side*1.92, -1.68)
        c, d = (side*1.92, -1.92), (side*1.68, -1.92)
        for i, tri in enumerate(([a, b, c], [a, c, d])):
            pp = [[(x, y, low(max(abs(x), -y))) for x, y in tri]]
            variable_patch(g, 'Gable hip bearing corner %s wedge %s' % (side, i),
                           pp, lambda x, y, z: .1, 'roof_deck')


def turret(g):
    """32-facet, hollow 4200 mm diameter conical roof with real radial seams."""
    n = 32
    def circle(r):
        return [(r*math.cos(i*math.tau/n), r*math.sin(i*math.tau/n))
                for i in range(n)]
    rim = circle(2.1)
    for name, apex, edge, thickness, mat in [
            ('Conical hollow timber weather deck', 2.155, .055, .055, 'roof_deck'),
            ('Conical thin metal weather skin', 2.161, .061, .006, 'metal')]:
        polys = [[(0, 0, apex), (rim[i][0], rim[i][1], edge),
                  (rim[(i+1) % n][0], rim[(i+1) % n][1], edge)]
                 for i in range(n)]
        patch(g, name, polys, thickness, mat)
    tangent = math.tan(math.pi/n)
    for i in range(n):
        angle = i*math.tau/n
        c, s = math.cos(angle), math.sin(angle)
        def pos(r, w, lift, c=c, s=s):
            return (r*c-w*s, r*s+w*c, 2.161-r-abs(w)*tangent+lift)
        folded_seam(g, 'Turret folded radial standing seam %02d' % (i+1),
                    .18, 2.1-.012*tangent, pos)
    first, last = circle(.145), circle(.16)
    hood = []
    for i in range(n):
        j = (i+1) % n
        hood.append([(0, 0, 2.28), (*first[i], 2.027), (*first[j], 2.027)])
        hood.append([(*first[i], 2.027), (*last[i], 2.012),
                     (*last[j], 2.012), (*first[j], 2.027)])
    patch(g, 'Turret hollow apex hood and weather skirt', hood, .011, 'metal')
    annulus(g, 'Turret continuous level-bottom structural bearing ring',
            circle(1.92), circle(1.56), lambda x, y: .1,
            lambda x, y: 2.1-math.hypot(x, y), 'roof_deck')


def flat_cap(g, chimney_host=False):
    """Complete square roof cap with a true low-side scupper and hollow soffit."""
    lower = lambda x, y: .120+.012*(y+2.1)
    upper = lambda x, y: .200+.012*(y+2.1)
    membrane = lambda x, y: .206+.012*(y+2.1)
    outer = square(2.094)
    opening = [(.7, .7), (1.1, .7), (1.1, 1.1), (.7, 1.1)]
    if chimney_host:
        annulus(g, 'Flat roof timber deck with true 400 mm chimney opening',
                outer, opening, lower, upper, 'roof_deck')
        annulus(g, 'Flat roof membrane around open chimney penetration',
                outer, opening, upper, membrane, 'metal')
    else:
        variable_patch(g, 'Flat roof sloping structural timber deck',
                       [[(x, y, upper(x, y)) for x, y in outer]],
                       lambda x, y, z: lower(x, y), 'roof_deck')
        patch(g, 'Flat roof continuous sloping metal membrane',
              [[(x, y, membrane(x, y)) for x, y in outer]], .006, 'metal')
    annulus(g, 'Flat roof level-bottom perimeter wall bearing', square(1.92),
            square(1.68), lambda x, y: 0, lower, 'roof_deck')
    annulus(g, 'Flat roof thin perimeter metal fascia', square(2.1),
            square(2.094), lower, membrane, 'metal')
    # Side and back sectors meet on mitres; the front contains a real opening.
    out, inn = square(1.92), square(1.68)
    for i in (1, 2, 3):
        j = (i+1) % 4
        poly = [out[i], out[j], inn[j], inn[i]]
        variable_patch(g, 'Flat roof parapet mitred sector '+str(i),
                       [[(x, y, .60) for x, y in poly]],
                       lambda x, y, z: membrane(x, y), 'stone')
    front = [
        [(-1.92, -1.92), (-.12, -1.92), (-.12, -1.68), (-1.68, -1.68)],
        [(.12, -1.92), (1.92, -1.92), (1.68, -1.68), (.12, -1.68)]]
    for i, poly in enumerate(front):
        variable_patch(g, 'Flat roof front scupper pier '+str(i),
                       [[(x, y, .60) for x, y in poly]],
                       lambda x, y, z: membrane(x, y), 'stone')
    g.box('Flat roof scupper clear opening lintel', (-.12, -1.92, .36),
          (.12, -1.68, .60), 'stone')
    # Three upper profile rings make two genuinely sloping coping faces.
    loops = [(square(1.95), .665-.08*.15),
             (square(1.8), .665), (square(1.65), .665-.04*.15)]
    polys = []
    for (a, za), (b, zb) in zip(loops, loops[1:]):
        for i in range(4):
            j = (i+1) % 4
            polys.append([(*a[i], za), (*a[j], za), (*b[j], zb), (*b[i], zb)])
    variable_patch(g, 'Flat roof continuous double-fall stone coping', polys,
                   lambda x, y, z: .60, 'stone')


def lean_to(g):
    """Repaired span with 41 mm intercept and fixed 100 mm bearing bottoms."""
    height = lambda x: .041+.4*(x+1.5)
    a, b = -1.494, 1.495
    for name, low, high, mat in [
            ('Lean-to continuous hollow timber deck', 0, .055, 'roof_deck'),
            ('Lean-to six millimetre standing seam pan', .055, .061, 'metal')]:
        g.prism(name, [(a, height(a)+low), (b, height(b)+low),
                       (b, height(b)+high), (a, height(a)+high)],
                'Y', -.6, .6, mat)
    for y in (-.45, -.15, .15, .45):
        folded_seam(g, 'Lean-to folded standing seam '+str(y), a, b,
                    lambda x, w, lift, y=y: (x, y+w, height(x)+.061+lift))
    g.prism('Lean-to low eave folded metal drip toe',
            [(-1.5, 0), (a, .003), (a, height(a)+.061),
             (-1.5, height(-1.5)+.061)], 'Y', -.6, .6, 'metal')
    g.prism('Lean-to high end folded metal fascia',
            [(b, height(b)-.015), (1.5, height(1.5)-.015),
             (1.5, height(1.5)+.061), (b, height(b)+.061)],
            'Y', -.6, .6, 'metal')
    g.prism('Lean-to low wall level bearing',
            [(-1.32, .1), (-1.08, .1), (-1.08, height(-1.08)),
             (-1.32, height(-1.32))], 'Y', -.6, .6, 'roof_deck')
    g.prism('Lean-to high wall solid riser core',
            [(1.08, .1), (1.32, .1), (1.32, height(1.32)-.080),
             (1.08, height(1.08)-.080)], 'Y', -.6, .6, 'plaster')
    g.prism('Lean-to high wall eighty millimetre timber plate',
            [(1.08, height(1.08)-.080), (1.32, height(1.32)-.080),
             (1.32, height(1.32)), (1.08, height(1.08))],
            'Y', -.6, .6, 'roof_deck')
