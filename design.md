# house-planner mobile Design Guide

## Brand

`house-planner mobile` is a mobile-first house planning tool for drawing floor plans, placing architectural parts, adjusting colors and textures, and checking exterior/interior 3D views. The design should feel approachable enough for touch operation, but precise enough for architectural work.

## Logo Direction

- Mark: a solid warm-orange pentagon house shape.
- Face: simple white dot eyes and a small white smile.
- Touch cue: a simplified sky-blue one-finger tap mark overlapping the lower-right of the house.
- Implementation default: use inline SVG/HTML so the logo is crisp and does not add image-loading dependencies.
- Avoid: rough paint texture, complex outlines, mascots, detailed hands, and mouse-cursor metaphors.

## Color System

- Canvas/background: warm off-white.
- Text: charcoal and soft slate.
- Primary action: vivid red-orange/coral with a stronger red component.
- Secondary action: clear sky blue used as a contrast accent for touch cues, secondary icons, and snap-style controls.
- Panels: crisp white surfaces with minimal or no borders; use spacing and subtle elevation instead of frequent divider lines.
- Contrast target: the UI should read as clean white floating controls against the planning canvas, with red-orange reserved for primary/selected states and sky blue reserved for secondary accents and icon wells.
- Status/secondary text: muted gray-blue.
- Use dark colors only for text, subtle overlays, and 3D/canvas contrast; avoid returning to a navy-dominant UI.

## UI Principles

- Preserve all existing planning capabilities and their discoverability.
- Prefer floating, card-like controls around the workspace, but keep desktop workflows dense and efficient.
- Treat the toolbar, tool sidebar, property panel, and mobile bottom navigation as floating controls layered around the plan canvas.
- Floating controls should have enough shadow and spacing to feel detached, but must not steal excessive drawing area.
- Prefer flat design: avoid frequent outlines, stacked borders, and pale-orange fills. Use whitespace, round icon wells, and a small number of strong accent states.
- Keep `共通操作` independent from the tool-category scroll area; it should stay visible while the site/wall/furniture categories scroll underneath.
- On mobile/tablet, keep bottom navigation, tool sheets, property sheets, virtual Shift, copy, and paste easy to reach.
- Keep controls stable: no layout jumps when active states, labels, thumbnails, or color/texture controls update.
- The UI may become more polished, but must not hide critical editing controls behind decorative chrome.

## Non-Negotiables

- Do not remove existing tools, categories, IDs, `onclick` handlers, or `data-tool` values.
- Do not change JSON import/export compatibility.
- Do not change 2D floor-plan drawing symbols or 3D geometry/rendering logic as part of this design pass.
- Do not change color/texture data behavior, snap behavior, copy/paste behavior, or Unity render request behavior.
- Design changes should be CSS/HTML chrome first; JavaScript should be touched only if needed to keep existing UI state visible.

## Responsive Rules

- Desktop: compact top toolbar, left tool sidebar, right property panel, maximum canvas area.
- Tablet/mobile: bottom navigation plus sheet-style tool/property panels; touch targets should be at least 40px high.
- Floating panels for color, texture, lighting, and Unity render must fit inside small screens and remain scrollable.
- Active view/tool states should use the orange accent consistently.

## Acceptance Checks

- Initial tool is still `選択・変形`.
- 2D, exterior 3D, interior 3D, 3D refresh, save/load, undo, grid, dimensions, snap, virtual Shift, copy, and paste remain available.
- Sidebar categories and generated Furniture Mega Pack menu items remain usable.
- Color/texture panels and the Unity render dialog remain usable on desktop and mobile.
- JSON save and import still work.
