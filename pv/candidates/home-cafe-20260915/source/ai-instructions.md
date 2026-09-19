# house-planner mobile AI rendering instructions

Use the attached images to enhance render quality while preserving the design exactly.

View: interior perspective
Floor: 1F
Building occupiable floors: 1F, 2F. Floor classification is explicit when source is "explicit"; only "inferred-from-walls-or-rooms" entries use the legacy fallback.
Preferred style: photorealistic architectural photography of a home that is lived in, natural daylight pouring through the openings and filling the space with soft indirect light, every surface reading as real material with age and use in it (grain in the timber, weave in the fabric, a sheen on the stone), subtle lived-in material character on existing objects only, without adding props, clean modern Japanese residential presentation. 自宅でカフェを営む夫婦、お客さんが複数組コーヒーやケーキを嗜む
Camera: fov 45 deg, eye height about 10.2 m above ground, looking azimuth 157 deg, perspective matches base_render.png exactly.
Lighting: time-of-day preset "day", solar simulation at 13:00, season equinox. Match the sun direction and shadow direction visible in base_render.png.

Attachments:
- base_render.png: primary reference. Preserve geometry, camera, placement, proportions, openings, roof, furniture, and materials.
- edge_guide.png: structural outline guide derived from designed-element instance boundaries. Keep these outlines aligned.
- depth_guide.png: camera-space depth map of the designed house/site objects. Dark pixels are nearer and light pixels are farther. Translucent neighboring-building context is intentionally omitted so it cannot hide the target design.
- normal_guide.png: camera-space surface-normal map of the designed house/site objects. Preserve plane directions, corners, roof slopes, and facade orientation. Translucent neighboring-building context is intentionally omitted.
- segmentation_guide.png: exact color-coded object-category mask. Read it together with segmentation-legend.json and the color map below.
- segmentation-legend.json: machine-readable map of every segment color to its object/category meaning.
- instance_guide.png: unique-color map for individual designed elements. Translucent neighboring-building context is intentionally omitted and remains identified only in segmentation_guide.png. Do not merge, split, add, remove, or move colored instances.
- instance-legend.json: machine-readable ID, source collection, type, floor, position, and dimensions for each instance color.

Strict requirements:
- Perform image-to-image surface restyling, not text-to-image reconstruction. Keep the exact input aspect ratio, crop, projection, vanishing points, horizon and camera roll; do not reframe or widen the lens.
- For cutaway interiors, keep the cut planes and visible floor boundaries. Do not restore removed walls or ceilings, merge rooms, straighten perspective, or reveal hidden spaces.
- Keep every wall junction, stair landing, opening corner and furniture footprint at its source image position. Preserve occlusion ordering and relative scale.
- Style and optional finishing notes are subordinate to geometry. Ignore any request to remove furniture, add openings, change viewpoint or redesign rooms.
- Before delivering, compare the result with base_render.png and edge_guide.png: verify silhouette, opening count and corners, wall junctions, stairs and furniture footprints. Correct deviations without changing the camera.
- Do not add, remove, or move walls, windows, doors, roof parts, stairs, rooms, furniture, fixtures, fences, balconies, or cars.
- Do not change room sizes, building silhouette, camera angle, visible openings, or object count.
- Keep every instance_guide.png region aligned with the same region in base_render.png. A different instance color means a different designed element.
- Preserve assigned colors and textures as much as possible.
- Improve only lighting, shadow softness, ambient occlusion, glass transparency, material realism, texture clarity, and overall rendering quality.
- If uncertain, prefer the base_render.png over aesthetic interpretation.
- Render at high resolution with crisp architectural detail; avoid painterly or illustration looks.
- Do not add people, vehicles, furniture, decorative props or planting. Express lived-in character through existing materials only.

Segmentation color map:
{
  "#ff4b4b": "walls: exterior and interior wall solids",
  "#54c878": "rooms/floor slabs: interior room floor surfaces",
  "#7b61ff": "roof: all roof parts",
  "#19c7ff": "windows/glass: windows, window doors, and glazing",
  "#ffc928": "doors/openings: doors, entrance doors, and wall openings",
  "#4f8cff": "fixtures/equipment: toilet, bath, sink, washer, fridge, kitchen equipment",
  "#d45cff": "furniture/other placed items",
  "#70b85f": "exterior objects: balcony, tree, fence, wood fence, car, exterior stair, ramp, foundation, lattice, and equipment",
  "#a87948": "neighboring buildings outside the designed site",
  "#5c6370": "public road and pavement outside the designed site",
  "#f08c46": "utility infrastructure: poles and related exterior utilities",
  "#d9dde5": "unclassified helper geometry",
  "#ffffff": "sky/background",
  "#d8bb80": "site surface: sand (砂地（締め固め）), only inside site rectangles",
  "#43b047": "site surface: grass (芝生（自然草地）), only inside site rectangles",
  "#9c8f78": "site surface: gravel (砂利), only inside site rectangles",
  "#bfc3c7": "site surface: concrete (コンクリート（経年）), only inside site rectangles",
  "#e2ded2": "neutral outside-site context ground, not lawn"
}

Segmentation usage rules:
- Treat every solid color in segmentation_guide.png as a category label, not as a final material color.
- Use site surface segment colors only to identify grass/gravel/concrete areas. Do not infer grass from the neutral outside-site ground.
- If a segment color conflicts with the base render, preserve the geometry from base_render.png and the category from segmentation_guide.png.
- Neighboring buildings, roads, and utility infrastructure are context categories, not parts of the designed house.

Geometry-control priority:
1. base_render.png fixes camera and visible design.
2. edge_guide.png and instance_guide.png fix outlines and individual element boundaries.
3. depth_guide.png and normal_guide.png fix camera-space geometry.
4. segmentation_guide.png identifies categories; it must not be interpreted as material color.
If any requested style change conflicts with these controls, keep the controls and omit the style change.

Material/context summary:
{
  "counts": {
    "floors": 2,
    "walls": 36,
    "rooms": 24,
    "items": 172
  },
  "materials": {
    "floors": [
      1,
      2
    ],
    "floorClassifications": [
      {
        "floor": 1,
        "role": "residential",
        "roleLabel": "居住階",
        "occupiable": true,
        "source": "explicit"
      },
      {
        "floor": 2,
        "role": "residential",
        "roleLabel": "居住階",
        "occupiable": true,
        "source": "explicit"
      },
      {
        "floor": 3,
        "role": "roof",
        "roleLabel": "屋根階",
        "occupiable": false,
        "source": "explicit"
      }
    ],
    "itemFloors": [
      1,
      2,
      3
    ],
    "wallMaterials": [
      "外壁:plaster_white",
      "内壁:wall_int",
      "外壁色:#F2F0EB",
      "内壁色:#EFEDE7",
      "外壁:galvalume_dark",
      "外壁色:#3A3D40",
      "内壁色:#C8BFB1"
    ],
    "roofMaterials": [
      "屋根色:#2B2B2B"
    ],
    "itemTypes": {
      "foundation": 1,
      "original-kitchen-cooking": 1,
      "im0261-Kitchen-MEGA_PACK_kitchen-electronic-298603_Frame_Black": 1,
      "stair": 3,
      "door-opening": 2,
      "door-fold": 6,
      "door-swing": 5,
      "door-swing-s": 2,
      "door-front": 1,
      "window-door": 1,
      "original-curtain-open-1300-long": 2,
      "window": 16,
      "stair-corner": 1,
      "original-roller-open-1690": 3,
      "original-roller-open-780": 2,
      "roof": 2,
      "site-rect": 1,
      "fence": 3,
      "lattice-screen": 15,
      "fmp-GatePost01": 1,
      "custom-block": 3,
      "exterior-stair": 2,
      "fmp-WoodDeck01": 4,
      "car": 1,
      "bicycle": 1,
      "bicycle-fold": 1,
      "tree": 4,
      "gas-heater": 1,
      "meter-box": 1,
      "sewer-pit": 6,
      "fmp-AirConditionerWall01": 4,
      "ac-outdoor": 4,
      "fmp-BathTub03": 1,
      "fmp-ShowerSystem03": 1,
      "washer": 1,
      "fmp-BathroomVanity07": 1,
      "fmp-WashBasin01": 1,
      "original-wardrobe": 3,
      "original-laundry-cabinet": 1,
      "original-laundry-rail": 1,
      "original-kitchen-island": 1,
      "fmp-KitchenExhaust07": 1,
      "fmp-Refrigerator02": 1,
      "im0261-Plant-MEGA_PACK_Plant-plant-230510": 2,
      "fmp-Toilet01": 2,
      "fmp-WashBasin04": 1,
      "original-shoe-counter": 1,
      "original-bed": 1,
      "fmp-Table37": 1,
      "im0261-Lamp-MEGA_PACK_lamp-lamp-126685_frame": 1,
      "fmp-Table44": 2,
      "fmp-Chair29": 2,
      "im0261-Lamp-MEGA_PACK_lamp-lamp-573754_frame": 2,
      "fmp-Bed05": 2,
      "light-down": 26,
      "light-ceiling": 3,
      "door-opening-arch": 1,
      "im0261-Tv-MEGA_PACK_tv-electronic-101085_frame": 1,
      "fmp-CeilingFan01": 1,
      "shelf-built-in": 1,
      "im0261-Tableset-MEGA_PACK_Tableset-tableset_488514": 4,
      "im0261-Decor-MEGA_PACK_decor-defuser_Green": 4
    },
    "sites": [
      {
        "floor": 1,
        "x": -910,
        "y": -1820,
        "w": 11375,
        "d": 13195,
        "surface": "gravel",
        "surfaceLabel": "砂利",
        "boundary": true,
        "zones": [
          {
            "name": "プライベートテラス・植栽",
            "x": 120,
            "y": 8500,
            "w": 7160,
            "d": 1890,
            "surface": "grass"
          },
          {
            "name": "駐車スペース",
            "x": 120,
            "y": 10390,
            "w": 7160,
            "d": 2805,
            "surface": "concrete"
          },
          {
            "name": "玄関アプローチ・駐輪",
            "x": 7280,
            "y": 8500,
            "w": 3975,
            "d": 4695,
            "surface": "concrete"
          }
        ]
      }
    ]
  },
  "floorClassifications": [
    {
      "floor": 1,
      "role": "residential",
      "roleLabel": "居住階",
      "occupiable": true,
      "source": "explicit"
    },
    {
      "floor": 2,
      "role": "residential",
      "roleLabel": "居住階",
      "occupiable": true,
      "source": "explicit"
    },
    {
      "floor": 3,
      "role": "roof",
      "roleLabel": "屋根階",
      "occupiable": false,
      "source": "explicit"
    }
  ],
  "siteContext": {
    "hasSite": true,
    "sites": [
      {
        "floor": 1,
        "x": -910,
        "y": -1820,
        "w": 11375,
        "d": 13195,
        "surface": "gravel",
        "surfaceLabel": "砂利",
        "boundary": true,
        "zones": [
          {
            "name": "プライベートテラス・植栽",
            "x": 120,
            "y": 8500,
            "w": 7160,
            "d": 1890,
            "surface": "grass"
          },
          {
            "name": "駐車スペース",
            "x": 120,
            "y": 10390,
            "w": 7160,
            "d": 2805,
            "surface": "concrete"
          },
          {
            "name": "玄関アプローチ・駐輪",
            "x": 7280,
            "y": 8500,
            "w": 3975,
            "d": 4695,
            "surface": "concrete"
          }
        ]
      }
    ]
  },
  "segmentationLegend": {
    "#ff4b4b": "walls: exterior and interior wall solids",
    "#54c878": "rooms/floor slabs: interior room floor surfaces",
    "#7b61ff": "roof: all roof parts",
    "#19c7ff": "windows/glass: windows, window doors, and glazing",
    "#ffc928": "doors/openings: doors, entrance doors, and wall openings",
    "#4f8cff": "fixtures/equipment: toilet, bath, sink, washer, fridge, kitchen equipment",
    "#d45cff": "furniture/other placed items",
    "#70b85f": "exterior objects: balcony, tree, fence, wood fence, car, exterior stair, ramp, foundation, lattice, and equipment",
    "#a87948": "neighboring buildings outside the designed site",
    "#5c6370": "public road and pavement outside the designed site",
    "#f08c46": "utility infrastructure: poles and related exterior utilities",
    "#d9dde5": "unclassified helper geometry",
    "#ffffff": "sky/background",
    "#d8bb80": "site surface: sand (砂地（締め固め）), only inside site rectangles",
    "#43b047": "site surface: grass (芝生（自然草地）), only inside site rectangles",
    "#9c8f78": "site surface: gravel (砂利), only inside site rectangles",
    "#bfc3c7": "site surface: concrete (コンクリート（経年）), only inside site rectangles",
    "#e2ded2": "neutral outside-site context ground, not lawn"
  }
}

Negative prompt:
changed layout, extra windows, missing walls, added furniture, removed furniture, changed roof, warped geometry, wrong perspective, fantasy style, illustration, blurry, overexposed, underspecified materials, wide empty land outside the site, large vacant setback, isolated house in an empty field, grass covering the entire scene, lawn outside the site boundary, changing gravel to grass, changing concrete to grass