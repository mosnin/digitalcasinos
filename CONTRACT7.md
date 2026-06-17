# Digital Casinos — Wave 7: Premium look + zero lag

Direct player feedback: "looks like shit", "slots are lanky", and it lags.
GOAL: make the whole game look like a **real high-end Las Vegas casino-resort** —
detailed, polished, correctly proportioned — while **eliminating lag**. Each agent
edits ONLY its named file(s) and keeps that file's public exports/signatures
identical (no API changes; the integrator's main.js stays as-is).

## THE TWO HARD RULES (apply to every agent)

### A. PERFORMANCE BUDGET (non-negotiable — the game must NOT lag)
- **Instance** any geometry repeated >4 times (`THREE.InstancedMesh`). Never add N separate meshes in a loop for columns/seats/bottles/books/etc.
- **Lights:** at most ~3 real lights total per scene/stage (ambient + hemi + 1 directional/key is ideal). Everything else must be **emissive materials**, NOT real lights. Do not add PointLights per fixture.
- **Materials:** `MeshStandardMaterial` only (NO `MeshPhysicalMaterial`, NO `transmission`, NO `clearcoat` — they're GPU-killers). Share/cache materials at module scope; aim for a small fixed set per scene. Reuse geometry via caches.
- **Textures:** canvas/procedural textures ≤ 512px; cache and reuse them. No per-instance textures.
- **Static:** set `userData.animated = false` and `matrixAutoUpdate = false` on non-animated meshes.
- Keep total scene draw calls modest. If you add detail, add it via instancing or merged geometry, not many draws.

### B. ART DIRECTION (premium, realistic, NO neon)
- Warm, classy palette: cream/ivory marble, dark walnut, burgundy/emerald patterned carpet, brushed brass/gold accents, soft warm light. Architectural detail (moldings, columns, coffered ceilings, framed art, rugs, plants) — but achieved cheaply per Rule A.
- Correct, believable **proportions**. Nothing stretched, thin, or "lanky".

## FILE ASSIGNMENTS

### js/games.js — FIX LANKY SLOTS + premium props
Keep `createGameProp(type)`, `openGame`, `openGameEditor`, `openSeatedGame`, `closeSeatedGame`, and all `prop.userData` animation hooks (reels/spin/spinWheel/dealCard/update) working. The slot machine currently looks "lanky" (too tall/thin/stretched) — REBUILD it with realistic proportions: a real slot cabinet is roughly **0.7m wide × ~1.6m tall × 0.6m deep** body on a base, a slightly tilted button deck, a curved topper, and a clear 3-reel window. Make slots/roulette/blackjack/poker look like real, solid, detailed casino furniture (proper rails, felt, chip trays) — but cheap (cached geo, ≤ a couple materials each, emissive screens not real lights). The reels must still spin via `userData.spin`.

### js/aesthetics.js — keystone materials + lighting (perf-critical)
Keep all exports. Ensure `material()` returns only MeshStandardMaterial (no physical/transmission/clearcoat). Tight, beautiful warm marble/wood/carpet/brass/glass at ≤512px textures, cached. `addInteriorLighting` = ambient + hemi + 1 warm directional/key ONLY (drop extra point lights; emissive carries accents). `makeChandelier` = emissive (no per-chandelier point light, or at most share one). Keep `installEnvironment` cheap/cached. This file most affects both look and FPS — make it gorgeous AND lean.

### js/casino.js — detailed but lean gaming floor
Keep API + Stage + parcels/venues/elevator wiring. Use instancing for columns/coffers/aisle runners (already partly done — audit and ensure NO per-fixture lights, NO physical materials). Add tasteful detail (carpet patterns, framed art, planters) cheaply. Verify the floor reads as a real casino and is light on draw calls/lights.

### js/venues.js — pools/bars/restaurants/shops, lean
Keep `decorateFloor` API. Instance stools/bottles/booths/seats; replace any per-fixture PointLights with emissive; no physical materials. Detailed but cheap.

### js/lobby.js — optimize the grand lobby (it's the START scene — must be smooth)
Keep `createLobby` API + Stage. It's large; ensure EVERYTHING repeated is instanced (columns, coffers, art, seating), ≤3 real lights (rest emissive), shared materials, ≤512px textures, static flags set. Keep it grand and beautiful but it MUST run at 60fps. This is the first thing players see.

### js/hotel.js — corridors/penthouse, lean
Keep API. Instance doors/sconces/plaques/art/rail-posts; emissive instead of per-sconce lights; shared mats. Detailed, warm, cheap.

### js/characters.js — fix proportions + perf
Keep `buildHumanoid`, `NPCManager`, `makeDealer` (incl. deal/gesture). The humanoids may look "lanky" — adjust proportions to look natural (shorter/wider torso, proper limb thickness, head size), keep shared/cached geometry, and ensure NPCManager stays cheap (cap crowd, no shadows). Keep the existing animation + dealer methods working.

### js/roominterior.js — cozy realistic room, lean
Keep `createRoom` API + spawn heading 0. Polish the room (bedding, drapes, art, rug, lamps) with ≤2 real lights and shared mats; correct proportions.

### js/ui.js + css/style.css — PREMIUM 2D UI (one agent owns BOTH)
Keep the `UI` API (all methods) and the DOM element IDs/classes that `index.html` and other modules rely on (`#coins #coinValue #locationInfo #prompt #toast #modalHost #mapScreen #mapCanvas #palette .palette-items .game-modal .seated-panel` etc. — do NOT rename existing hooks; you may ADD classes). Redesign the look: a refined casino HUD (elegant coin counter, location card, contextual prompt, toasts), gorgeous `.game-modal` and build-palette and floor-menu styling, and a beautiful `.seated-panel`. Use a tasteful gold/cream/charcoal theme, good typography, subtle shadows — premium, not gaudy, no harsh neon. Must stay readable and not hurt performance (CSS only; avoid heavy backdrop-filters everywhere).

### js/perf.js — aggressive adaptive performance
Keep `createPerfGovernor(renderer, opts)` + `optimizeStage(stage)`. Make the governor more aggressive: target ~60fps, drop `setPixelRatio` quickly (down to ~0.6) when fps<50, recover slowly; add an optional tiny FPS readout (a small fixed-corner div) toggled by `opts.debug`. `optimizeStage` should also disable `matrixAutoUpdate` on static meshes and ensure frustum culling. Never throw.

## Verify with `node --check <file>` after editing. Summarize changes + how you kept it cheap.
