# Digital Casinos — Wave 5: Realistic look + hallways (no neon)

Player feedback: the world looks "boxy and basic" and too neon. This wave makes
it feel like a **real upscale Las-Vegas casino-resort** and adds **walkable
hallways between parcels**. Each agent edits ONLY its named existing file and
keeps that file's public exports/signatures identical.

## ART DIRECTION (apply everywhere)
- **Palette:** warm and classy — cream/ivory marble, dark walnut & cherry wood,
  burgundy/emerald patterned carpet, brushed brass & gold accents, soft amber light.
  **Remove the saturated pink/cyan NEON look.** Signage becomes tasteful warm-white
  or gold **backlit/edge-lit** lettering, not glowing tubes; keep emissive LOW.
- **Less boxy → more architectural detail:** add crown molding & baseboards on walls,
  **columns/pilasters** (round or fluted) with capitals/bases, **coffered or tray
  ceilings** with recessed warm downlights and cove lighting, framed artwork, wainscoting,
  area rugs, planters with greenery, chair-rail trim. Bevel/inset big flat surfaces so
  they don't read as plain cubes. Use chamfered edges where cheap (small bevel boxes).
- **Lighting:** warm (≈3200–4000K), soft, plentiful; gentle (thin) fog or none.
  Avoid colored neon point lights; use warm downlights + cove glow. Keep it BRIGHT
  enough to navigate and read as daytime-casino-interior, not a dark club.
- **Materials:** prefer MeshStandardMaterial/MeshPhysicalMaterial with realistic
  roughness/metalness; use the upgraded `aesthetics.material()` kinds. Reuse/cache.
- Performance: keep instancing; don't explode draw calls. Never throw.

## HALLWAYS BETWEEN PARCELS (config already updated)
`config.isAisleTile(ti,tj)` is now true for aisle tiles, and `isBuildableTile`
already excludes them. Render those aisles as **hallways**: a marble/hardwood
walkway runner (distinct from the parcel-block carpet), optionally with a brass
inlay strip or runner rug, and place **columns/planters/stanchions at aisle
intersections**. Parcel blocks (2×2 buildable tiles) sit between the aisles like
banks of machines. Use `tileCenter`, `FLOOR.TX/TZ`, `isAisleTile`, `isBuildableTile`.

## Files & tasks (keep all signatures)

### js/aesthetics.js  (keystone — most things call this)
Keep exports `addInteriorLighting, neonMaterial, makeNeonSign, material, makeChandelier, makeWindowSkyline, installEnvironment`.
- Rework them to the realistic palette: `material()` gains richer marble/wood/carpet/brass/glass; carpet/marble textures look real (subtle, higher-res). `addInteriorLighting` = warm ambient+hemi+several soft downlight point lights + a key light; thin/no fog; NO saturated colored neon lights (use warm whites/golds). `makeNeonSign(text,color,...)` now renders a tasteful **backlit sign** (brushed panel + warm edge-lit lettering, low emissive) — same signature, classy result. `neonMaterial(color,i)` returns a softly emissive accent (low intensity, warm), not a glaring tube. `makeChandelier` stays opulent but warm. Keep heavy caching.

### js/casino.js
Keep `createCasino({economy,openShop})` + the Stage shape + elevator/triggers + venues/parcels compatibility. Upgrade the floor architecture: add **columns** (rows of fluted columns down the hall), **crown molding + baseboards**, a **coffered/tray ceiling** with recessed warm downlights, wainscoting on walls, framed art, large **area rugs**. Render the **aisle hallways** (use `isAisleTile`) as marble/hardwood runners between the carpeted parcel blocks, and place columns/planters at aisle intersections. Replace the neon marquee with a tasteful gilded sign (still via `makeNeonSign`). Warm, realistic, less boxy.

### js/venues.js
Keep `decorateFloor(group,floorDef,ctx)` signature + returned `{colliders,update,interactables}`. Make pools/bars/fountains/gift shops/restaurants/theater/windows realistic and detailed (stone/tile, wood, brass, plants, columns, real furniture, warm signage) — remove neon trim. Keep interactable actions intact.

### js/parcels.js
Keep `attachParcels(stage,economy,hooks)` + full `api`. Replace neon glow borders with **subtle, realistic** parcel treatment: a faint inlaid border on buildable blocks, owned plots marked with **brass stanchions + velvet rope** at corners and a small engraved **placard** (name), unowned buildable tiles show a tasteful **"FOR SALE — price" placard** (warm, low-emissive) near the player. Ghost stays green=valid/red=invalid but matte, not glowing. Do NOT draw anything on aisle tiles (`isAisleTile`).

### js/decor.js
Keep `createDecorProp(id)`, `decorCollider(id)`. Make props less boxy and realistic; convert `neonsign` to a classy backlit sign, `archway` to an ornate (non-neon) arch, tone down emissive on all. Keep ids + footprints.

### js/games.js
Keep `createGameProp(type)`, `openGame`, `openGameEditor`. Make the 3D machines/tables look real and less boxy (rounded slot cabinets with detailed fronts, felt tables with wood rails, chip trays) and tone down emissive screens to realistic brightness. Do NOT change gameplay/signatures.

### js/hotel.js
Keep `createHotel` API + Stage shape + door triggers/callbacks. Realistic hotel corridor: patterned carpet runner, **wallpaper + wainscoting + crown molding**, **warm wall sconces** (not neon) between proper **door frames** with numbered plaques, framed art, a console table with a lamp, ceiling downlights. Penthouse: realistic luxury + warm-lit rooftop pool. Remove neon.

### js/roominterior.js
Keep `createRoom(...) -> {stage,api}`. Make the room realistic & cozy: headboard wall, nicer bed/linens, curtains around the window, warm lamps, art, a rug, baseboards/crown molding. Remove neon accents (use warm brass/lamp light).

## Integrator notes (not for agents)
Bloom is already reduced and `isAisleTile`/`isBuildableTile` updated in config; main.js wiring is unchanged.
