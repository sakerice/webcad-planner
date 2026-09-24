import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_kit import *  # noqa: F401,F403

# Laundry fixtures and a compact AC. Metres, Z-up, front = -Y.
# Explicit closed profile rings bake in rounded corners and edge chamfers.
# No modifiers, textures, rescaling or thin plates. run() owns UV and export.
# Triangle estimates use n-gon caps = n-2; Blender validation is still required.


def shift(obj, x=0, y=0, z=0):
    for v in obj.data.vertices:
        v.co.x += x
        v.co.y += y
        v.co.z += z
    obj.data.update()
    return obj


def block(name, lo, hi, mat, corner=.006, edge=.001, n=1):
    """Rounded XY rectangle with explicit top/bottom chamfers, exact bounds."""
    w, d, h = [hi[i]-lo[i] for i in range(3)]
    assert 0 < edge < min(corner, h/2)
    assert corner < min(w, d)/2
    obj = profile(name, [(w-2*edge, d-2*edge, corner-edge, lo[2]),
                         (w, d, corner, lo[2]+edge),
                         (w, d, corner, hi[2]-edge),
                         (w-2*edge, d-2*edge, corner-edge, hi[2])], mat, n=n)
    return shift(obj, (lo[0]+hi[0])/2, (lo[1]+hi[1])/2)


def radial(name, rows, mat, center=(0, 0, 0), axis='Z', sides=16):
    """Closed radial shell; rows=(radius, axial distance), positive radii.

    axis Y advances toward the front (-Y); X advances right. Both mappings
    preserve winding. Returning down the inside makes a recessed circular cup.
    Triangles = 2*sides*len(rows)-4, with no bevel modifier expansion.
    """
    rings = []
    for radius, t in rows:
        ring = []
        for i in range(sides):
            a = math.tau*i/sides
            u, v = radius*math.cos(a), radius*math.sin(a)
            p = (u, -t, v) if axis == 'Y' else ((t, u, v) if axis == 'X' else (u, v, t))
            ring.append(tuple(center[j]+p[j] for j in range(3)))
        rings.append(ring)
    return shell(name, rings, [mat], [0]*(len(rows)-1))


def washer_drum():
    white = matp('Laundry washer enamel', '#f2f2ee', rough=.30)
    trim = matp('Laundry washer graphite trim', '#30383c', rough=.40)
    glass = matp('Laundry washer smoked window', '#192e38', rough=.13)
    silver = matp('Laundry washer satin hardware', '#aab0b3', rough=.28, metal=.75)
    rubber = matp('Laundry washer rubber feet', '#343533', rough=.85)
    display = matp('Laundry washer display', '#163d48', rough=.23)
    # Enclosure sets +/-320 X, rear +360 Y and top 1050 Z. Door sets -360 Y.
    parts = [block('Rounded washer cabinet', (-.320, -.302, .055),
                   (.320, .360, 1.050), white, .025, .006, n=2)]
    # 460 mm circular door; inner return exposes a smaller recessed window.
    parts.append(radial('Circular door rim and recessed seal', [
        (.210, 0), (.230, .015), (.230, .049), (.216, .060),
        (.170, .060), (.160, .028)], trim, (0, -.300, .555), 'Y', 24))
    parts.append(radial('Glossy recessed smoked glass window', [
        (.151, .029), (.164, .033), (.164, .040), (.151, .044)],
        glass, (0, -.300, .555), 'Y', 24))
    parts.append(block('Left door hinge', (-.250, -.344, .492),
                       (-.214, -.299, .614), silver, .008, .002))
    parts.append(block('Right door pull grip', (.190, -.359, .489),
                       (.239, -.335, .611), silver, .009, .003))
    parts.append(block('Upper full width control panel', (-.294, -.310, .904),
                       (.294, -.299, 1.015), trim, .004, .001))
    parts.append(block('Detergent drawer front', (-.286, -.315, .913),
                       (-.083, -.306, 1.005), white, .003, .001))
    parts.append(block('Detergent drawer finger recess', (-.250, -.317, .920),
                       (-.114, -.313, .931), trim, .0015, .0004))
    parts.append(radial('Program selector dial', [
        (.030, 0), (.034, .003), (.034, .012), (.030, .015)],
        silver, (-.018, -.308, .959), 'Y', 12))
    parts.append(block('Inset status display', (.066, -.313, .944),
                       (.235, -.309, .983), display, .0015, .0005))
    parts.append(radial('Start button', [(.010, 0), (.010, .003)],
                        silver, (.264, -.310, .958), 'Y', 8))
    parts.append(block('Recessed lower plinth', (-.289, -.305, .058),
                       (.289, -.295, .130), trim, .004, .001))
    for x in (-.251, .251):
        for y in (-.236, .282):
            parts.append(radial('Adjustable foot and rubber pad', [
                (.025, 0), (.029, .004), (.029, .017), (.019, .066)],
                rubber, (x, y, 0), sides=8))
    return combine(parts)


def washer_pan():
    resin = matp('Laundry pan warm white resin', '#e8e6de', rough=.42)
    well = matp('Laundry pan drain shadow', '#626765', rough=.65)
    # 12 vertices/ring. Outer walls set +/-320 mm; lip is at Z=120 mm.
    rows = [(.628, .628, .024, 0), (.640, .640, .030, .006),
            (.640, .640, .030, .113), (.628, .628, .027, .120),
            (.576, .576, .023, .120), (.560, .560, .024, .111),
            (.544, .544, .025, .028)]
    rings = [rounded_rect(0, 0, w, d, r, z, n=2) for w, d, r, z in rows]
    # Project each floor-boundary vertex toward a corner trap: corresponding
    # rays cannot cross. The 28 -> 20 mm annulus is a real shallow drain slope.
    cx, cy = .198, .198
    angles = [math.atan2(v.y-cy, v.x-cx) for v in rings[-1]]
    for radius, z in ((.052, .020), (.046, .017), (.046, .009)):
        rings.append([(cx+radius*math.cos(a), cy+radius*math.sin(a), z)
                      for a in angles])
    parts = [shell('Raised pan rim sloping floor and trap recess', rings,
                   [resin, well], [0]*8+[1])]
    # Raised smaller cover leaves a visible annular opening; integral central
    # pedestal supports it, while the recessed well remains a closed volume.
    parts.append(radial('Drain cover central support', [(.009, .009), (.009, .025)],
                        resin, (cx, cy, 0), sides=8))
    parts.append(radial('Removable round trap cover', [
        (.034, .024), (.038, .026), (.038, .029), (.034, .031)],
        resin, (cx, cy, 0), sides=16))
    return combine(parts)


def laundry_pole():
    metal = matp('Laundry pole satin aluminium', '#bec4c7', rough=.30, metal=.8)
    metal['finishChannel'] = 'metal'
    parts = []
    # Two rods within a narrow 60 mm depth; square rounded end plugs set
    # X +/-600 and Z=0, so tube sampling never determines the envelope.
    for y in (-.016, .016):
        parts.append(radial('Horizontal drying rod', [
            (.008, -.596), (.009, -.593), (.009, .593), (.008, .596)],
            metal, (0, y, .012), 'X', 8))
        for x in (-.596, .596):
            parts.append(block('Rounded rod end plug', (x-.004, y-.011, 0),
                               (x+.004, y+.011, .024), metal, .003, .001))
    for x in (-.480, .480):
        parts.append(block('Ceiling fixing plate', (x-.032, -.030, .238),
                           (x+.032, .030, .250), metal, .010, .002))
        parts.append(radial('Vertical suspension stem', [
            (.006, .025), (.007, .028), (.007, .238), (.006, .241)],
            metal, (x, 0, 0), sides=8))
        parts.append(block('Twin rod support crossbar', (x-.011, -.028, .017),
                           (x+.011, .028, .035), metal, .005, .001))
    return combine(parts)


def ac_wall_slim():
    skin = matp('Slim AC porcelain white shell', '#f0eee7', rough=.33)
    dark = matp('Slim AC deep outlet', '#343e40', rough=.65)
    blade = matp('Slim AC pale louver', '#d1d5d1', rough=.42)
    lamp = matp('Slim AC small status window', '#547a78', rough=.25)
    # A flat upright fascia, crisp shoulder and two separate low louvers make
    # this distinct from the rounded, bulging existing 798/890 mm siblings.
    # Rear remains +110 mm; lower front withdraws to -14 mm for a deep outlet.
    rows = [(.698, .106, .014, 0, .057),
            (.720, .118, .018, .010, .051),
            (.728, .124, .020, .040, .048),
            (.728, .132, .022, .075, .044),
            (.728, .220, .027, .119, 0),
            (.728, .220, .027, .250, 0),
            (.720, .212, .025, .272, 0),
            (.702, .194, .020, .280, 0)]
    rings = [rounded_rect(0, cy, w, d, r, z, n=3) for w, d, r, z, cy in rows]
    parts = [shell('Compact flat front stepped enclosure', rings, [skin], [0]*7)]
    parts.append(block('Deep recessed outlet back', (-.309, -.029, .027),
                       (.309, -.017, .068), dark, .004, .001))
    # 8 mm thick closed blades, separated vertically and staggered in depth.
    for name, y, z in (('Front outlet louver', -.090, .024),
                        ('Inner outlet louver', -.059, .053)):
        parts.append(block(name, (-.300, y, z), (.300, y+.029, z+.008),
                           blade, .005, .0015))
    for x in (-.309, .300):
        parts.append(block('Outlet louver side pivot', (x, -.087, .026),
                           (x+.009, -.020, .069), skin, .003, .001))
    parts.append(block('Upper intake shadow seam', (-.294, -.107, .258),
                       (.294, -.101, .264), dark, .002, .0007))
    parts.append(block('Right vertical status window', (.293, -.110, .164),
                       (.301, -.106, .207), lamp, .0015, .0005))
    return combine(parts)


if __name__ == '__main__':
    run([('original-washer-drum', (640, 720, 1050), washer_drum, None, 1400),
         ('original-washer-pan', (640, 640, 120), washer_pan, None, 700),
         ('original-laundry-pole', (1200, 60, 250), laundry_pole, 'metal', 800),
         ('original-ac-wall-slim', (728, 220, 280), ac_wall_slim, None, 1000)])
