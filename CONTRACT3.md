# Digital Casinos — Wave 3: Hotel, Attractions, Audit & Polish

Builds a Las-Vegas-scale resort on top of the shipped game: **hotel towers with
hundreds of buyable/decoratable rooms**, a **physical elevator** with a ride
transition + destination directory, a **horse-racing arena**, a **botanical
garden**, plus an **audit & quality pass** (working games, higher-quality
aesthetic, better parcels, smoother performance).

Anchors (import, never duplicate): `js/config.js`, `js/economy.js`.
New config you will use: `ROOM_STYLES, HOTEL, hotelDoorSlots(floorId), hotelRoomCount(), DESTINATIONS`,
plus existing `FLOORS, FLOOR, tileCenter, COLORS, GAME_CATALOG, DECOR_CATALOG, box3FromRect, clamp`.
New economy: `ownsRoom(id), buyRoom(id,styleId,price), getRoom(id), setRoomStyle(id,styleId,cost), getRoomDecor(id), addRoomDecor(id,decorId,transform,cost), removeRoomDecor(id,i), ownedRoomIds()`.

Wave-1/2 siblings you may import: `./aesthetics.js` (`addInteriorLighting, neonMaterial, makeNeonSign, material, makeChandelier, makeWindowSkyline`), `./characters.js` (`buildHumanoid, NPCManager, makeDealer`), `./decor.js` (`createDecorProp, decorCollider`), `./ui.js` (`UI`), `./audio.js` (`SFX`).

Rules: `import * as THREE from 'three'` (+ `three/addons/...`). Never throw. Reuse geometry/materials. `node --check`.

## Stage interface (unchanged)
```
{ scene:THREE.Scene, floorIndex|id, baseY:0, spawn:{x,z,heading},
  sampleGround(x,z)->y, colliders:THREE.Box3[],
  triggers:[{pos:THREE.Vector3, radius, prompt, action}], update(dt,ctx) }
```
Build everything at y≥0 in the stage's own scene (only the active stage renders).

---

## NEW MODULES

### js/hotel.js
`createHotel({ economy }) -> hotel`:
- `floorCount` = `HOTEL.FLOORS.length`.
- `getFloor(i) -> Stage` (lazy+cache): a long hotel **hallway** (Z = `[-HALL_LEN/2, HALL_LEN/2]`, width `HALL_W`, height `HOTEL.H`), patterned carpet runner (use floorDef.carpet via aesthetics.material), sconces / neon trim, ceiling, framed art, an elevator alcove at the start. For every slot from `hotelDoorSlots(floorDef.id)` build a numbered **door** in the side wall (door panel + frame + unit number plate); owned doors get a green "occupied" light + the player's room name. Walls/doors are colliders (the hallway is the only walkable space). Add a per-door trigger:
  - owned → `{ prompt:'Enter your room — [E]', action: () => hotel.onEnterRoom(roomId, floorDef.id, floorDef.style) }`
  - unowned → `{ prompt:'[E] Buy this room — '+price, action: () => hotel.onBuyRoom(roomId, floorDef.style, price) }` where price = `ROOM_STYLES[floorDef.style].cost`.
  Also an elevator trigger `{ action: () => hotel.onElevator() }` and end-of-hall window (makeWindowSkyline).
- `getPenthouse() -> Stage`: a luxurious top floor — `HOTEL.PENTHOUSE_SUITES` large suites (each a buyable room id `ph_0..`), a **rooftop pool**, bar, skyline windows, lounge furniture. Same door/trigger pattern (style 'penthouse').
- `randomWalkablePoint(i) -> {x,z}` (points along the hallway centerline) for NPC strollers.
- `refresh()` re-reads ownership and updates door visuals.
- settable callbacks: `hotel.onElevator`, `hotel.onEnterRoom(roomId, hallId, style)`, `hotel.onBuyRoom(roomId, style, price)`.

### js/roominterior.js
`createRoom({ economy, roomId, styleId }) -> { stage, api }`:
- `stage`: a cozy hotel-room interior (`HOTEL.ROOM` square, `HOTEL.ROOM_H` tall) themed by `ROOM_STYLES[styleId]` (wall/floor/accent/mood colors). Include a bed, nightstand+lamp, a big window with `makeWindowSkyline`, a rug, a TV, and a **door** with an exit trigger `{ prompt:'Leave room — [E]', action: () => stage.onExit && stage.onExit() }` (settable). Spawn just inside facing the room. Walls are colliders.
- `api` (mirrors parcels for the integrator): `enterBuildMode(decorId)`, `exitBuildMode()`, `placeUnderPlayer(pos)` (charges `economy.addRoomDecor(roomId, decorId, {x,z,rot}, DECOR_CATALOG[decorId].cost)`, spawns `decor.createDecorProp`), `removeUnderPlayer(pos)`, `rotateGhost()`, `isBuildMode()`, `getPrompt(pos)`, `setStyle(styleId, cost)` (re-theme + persist via economy.setRoomStyle), `refresh()`. Load existing decor from `economy.getRoomDecor(roomId)` on build. Keep decor inside the room bounds.

### js/elevator.js
`createElevator({ destinations }) -> elevator` (UX only — the car meshes already exist in venues):
- `openDirectory(currentId, onPick)`: a `.game-modal` "🛗 Elevator" via `UI.openModal`, listing `DESTINATIONS` grouped by `.group` (Casino / towers / Hotel / Attractions) with icon + name; the current one marked "HERE"; clicking calls `onPick(dest)` (and closes). Include Close.
- `playRide(fromName, toName, onArrive)`: show a full-screen elevator-ride overlay (sliding doors closing, a ticking floor indicator from→to, a soft "ding"), ~1.1s, then remove overlay and call `onArrive()`. If anything fails, call `onArrive()` immediately. Build the overlay with DOM (inline styles) appended to body; use `SFX.play('elevator')` if available.

### js/arena.js
`createArena({ economy }) -> { getStage() }`:
- `getStage() -> Stage` (lazy+cache): an oval **horse-racing track** with infield, grandstand seating (instanced), rail, start gate, finish line, jumbotron, stadium lights, a sky backdrop. Place ~6 horses (simple stylized horse models or jockey humanoids on horse-shaped bodies) at the gate. A **betting kiosk** trigger `{ prompt:'[E] Bet on the next race', action: openRaceBetting }`.
- `openRaceBetting()`: a `.game-modal` to pick a horse (with odds) and a stake (validate vs `Economy.canAfford`); on "Race!", animate the horses around the track over a few seconds (drive from `stage.update`), then settle: winner pays `stake * odds` via `Economy.add`/`wager`. Show results. Reuse UI modal.
- `stage.update(dt)` animates idle/racing horses + lights.

### js/garden.js
`createGarden({ economy }) -> { getStage() }`:
- `getStage() -> Stage` (lazy+cache): a serene **botanical garden** — winding paths, hedges, many trees/flowers (instanced for perf), a central fountain (animated), koi pond, benches, butterflies/particles, soft daytime lighting (override fog to a light airy haze), birdsong-free. A couple of benches with a small interaction `{ prompt:'[E] Rest a moment', action:()=>UI.toast('A peaceful break 🌸') }`. Walls/hedges as needed; keep it open and walkable. Good performance (instancing).

### js/perf.js
`createPerfGovernor(renderer, opts={}) -> { update(dt), getFps(), setEnabled(b) }`:
- Track a rolling FPS estimate; if FPS dips below ~45 for a sustained window, lower `renderer.setPixelRatio` (down to ~0.75×); if comfortably above ~58, raise back toward the cap (`Math.min(2, devicePixelRatio)`). Smooth, hysteresis, no thrashing. `getFps()` returns the current estimate.
- Also export `optimizeStage(stage)`: walk `stage.scene`, set `matrixAutoUpdate=false` (and `updateMatrix()`) on clearly static meshes (no userData.animated), enable frustum culling (default), to cut per-frame cost. Defensive.

---

## AUDIT & IMPROVE (edit the named existing file ONLY; keep its public exports/signatures identical)

### js/games.js — "working casino games" audit
Read it, fix any correctness bugs (payout math, bet validation, dealer logic, modal cleanup, balance-never-negative), and improve UX/polish: clearer win/lose feedback, disabled buttons mid-round, keyboard-free operation, nicer 3D props. Call `SFX.play(...)` on spin/win/lose if `./audio.js` is importable (guard it). Do NOT change `createGameProp(type)`, `openGame(type,config)`, `openGameEditor(type,config,onSave)` signatures.

### js/aesthetics.js — "higher quality aesthetic" upgrade
Improve material/lighting quality while keeping ALL existing exports + signatures (`addInteriorLighting, neonMaterial, makeNeonSign, material, makeChandelier, makeWindowSkyline`). Allowed additions: richer PBR params (subtle metalness/roughness maps, clearcoat via MeshPhysicalMaterial where it helps marble/glass/brass), better carpet/marble textures, crisper neon glow, nicer chandelier. You MAY add a new export `installEnvironment(renderer, scene)` that builds a small PMREM environment (from a procedural gradient/room) and assigns `scene.environment` for real reflections — keep it optional & guarded. Keep everything performant and cached.

### js/parcels.js — "better designed parcels" polish
Keep `attachParcels(stage, economy, hooks)` and its returned `api` identical. Improve visuals only: glowing tile borders, corner posts/markers on owned plots, a cleaner ownership tint, a ghost that turns green (valid) / red (invalid/occupied), a subtle floating "FOR SALE — price" / nameplate over tiles, and a smoother highlight follow. Don't regress behavior.

## Notes for the integrator (not the agents)
main.js will switch among `DESTINATIONS` via the elevator: casino→`casino.getFloor`, hotel→`hotel.getFloor`, penthouse→`hotel.getPenthouse`, arena→`arena.getStage`, garden→`garden.getStage`; hotel doors → `roominterior.createRoom` (enter/exit); `elevator.playRide` wraps transitions; `perf` governs pixel ratio.
