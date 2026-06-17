# Digital Casinos — Module Integration Contract (Mega-Casino edition)

A no-build-step Three.js game. The **entire game takes place inside one massive
mega-casino** built from stacked FLOORS / SECTIONS (see `config.FLOORS`): a Grand
Casino Floor, a Poolside Promenade, a High-Roller Sky Lounge, and a Shops & Dining
Promenade (gift shops, restaurants, a showroom) — connected by a shared elevator.
Each floor/section is its own `THREE.Scene` (a "stage"), so **only the active
section renders** → smooth performance. The player walks the floors, **buys
parcels (floor tiles) inside the casino**, places & tunes casino games (slots,
poker, roulette, blackjack), **decorates** owned parcels with placeable props,
spends winnings in gift shops, and sits down to play. Vegas aesthetic,
realistic-ish 3D characters/crowd, Supabase login.

ES modules load directly in the browser via an import map (`three`,
`three/addons/`). **No bundler, no TypeScript.** Import three as
`import * as THREE from 'three'`.

## Anchor files (already exist — import, never duplicate)
- `js/config.js` — floor/tile math, prices, catalogs, colors, tuning. Use its helpers:
  `FLOOR, FLOORS, ELEVATOR, tileCenter, tileFromWorld, parcelKey, isBuildableTile,
   GAME_CATALOG, SKIN_CATALOG, MOVE, SUPABASE, COLORS, box3FromRect, clamp`.
- `js/economy.js` — `import { Economy } from './economy.js'` singleton:
  `coins, canAfford, add, spend, wager(amount,payout), ownsParcel(key), buyParcel(key,price),
   getGames(key), addGame(key,type,cost,extra), removeGame(key,i), parcelPrice(floorIndex),
   skin, ownsSkin, buySkin(id,cost), equipSkin(id), subscribe(cb), hydrate(remote), cloud`.

## Coordinate system (do not redefine)
- Each floor spans X `[-60,60]`, Z `[-42,42]`. Floor `i` ground sits at `y = i * FLOOR.H`.
- 20×14 tiles of size `FLOOR.TILE=6`. `tileCenter(ti,tj)`, `tileFromWorld(x,z)`.
- Parcel key = `parcelKey(floorIndex, ti, tj)` → `"f_ti_tj"`. Buildable tiles via `isBuildableTile`.
- Elevator core at `(ELEVATOR.x, ELEVATOR.z)` on every floor.

## Stage interface (player.js + main.js consume this)
Each floor is a **Stage**:
```
{
  scene: THREE.Scene,
  floorIndex: number,
  baseY: number,                      // = floorIndex * FLOOR.H
  spawn: { x, z, heading },
  sampleGround(x,z) -> number,        // floor height (usually baseY)
  colliders: THREE.Box3[],            // walls/furniture/feature railings for XZ circle collision
  triggers: [ { pos:THREE.Vector3, radius, prompt:string, action:Function, key?:'E' } ],
  update(dt, ctx),                    // ctx = { playerPos, camera, keys }
}
```
Player resolves a circle (radius `MOVE.RADIUS`) vs `colliders` in XZ, stands on `sampleGround`.

## Deliverables (one file per agent)

### js/aesthetics.js
- `addInteriorLighting(scene, floorDef)` → `{ update(dt) }`. Warm casino ambient + neon point lights, soft fog.
- `neonMaterial(color, intensity=1.4)` → emissive MeshStandardMaterial.
- `makeNeonSign(text, color, opts)` → THREE.Object3D (canvas-texture glowing sign).
- `material(kind, floorDef?)` for `'carpet'|'marble'|'wall'|'ceiling'|'water'|'glass'|'brass'|'wood'` → MeshStandardMaterial.
- `makeChandelier()`, `makeWindowSkyline()` (Vegas night skyline backdrop seen through windows).

### js/characters.js
- `buildHumanoid({ suit, accent, skin, scale=1 })` → `{ root:THREE.Group, update(dt, moving), recolor(opts), setPose('stand'|'sit') }`.
  Proportioned low-poly human (head w/ face, torso, arms, hands, legs, shoes); idle sway + walk swing.
- `class NPCManager { constructor(scene); spawnCrowd(n, randomPointFn); update(dt); clear(); }` — Vegas pedestrians wandering & avoiding the elevator core.
- `makeDealer(skinOpts)` → seated humanoid for tables.

### js/venues.js  (decorates a floor group; called by casino.js)
- `decorateFloor(group, floorDef, ctx) -> { colliders: THREE.Box3[], update(dt), interactables:[{pos,radius,prompt,action}] }`.
  Build the floor's **features** from `floorDef.features` (type-driven): `pool` (animated water + tile deck + railings),
  `bar` (counter + stools + bottles), `fountain`, `hall` (hallway carpet runner), `window` (perimeter windows using
  aesthetics.makeWindowSkyline behind glass), `elevator` (shaft/doors alcove), and the Promenade venues:
  `giftshop` (storefront + signage; interactable action `() => ctx.openShop && ctx.openShop()`),
  `restaurant` (booths, tables, neon diner sign, NPC patrons via characters), `theater` (marquee + stage + seats).
  Use `floorDef.features[i].label` on signage where present. Add plants, neon trim, chandeliers (aesthetics.makeChandelier).
  Return `colliders` for solid features and `interactables` so main can wire shop/show prompts.

### js/casino.js  (builds the whole mega-casino, manages floors/sections)
- `createCasino({ economy, openShop }) -> casino` with:
  - `getFloor(i) -> Stage` — **lazily builds** floor `i` on first request (floor slab, walls, ceiling, lighting via
    aesthetics, decor via venues) and caches it, so only visited sections are constructed → smooth load/render.
  - `floorCount` (= FLOORS.length).
  - `randomWalkablePoint(floorIndex) -> {x,z}` (for NPC spawning; avoid features/elevator).
  - each floor's `triggers` includes the elevator with `action: () => casino.onElevator()` (settable callback).
  - pass `openShop` down to venues as `ctx.openShop` so gift-shop storefronts can open the shop UI.
  - `dispose()`.
  Walls enclose each floor; an elevator alcove at `ELEVATOR`. Provide `colliders` (outer walls + feature colliders).

### js/parcels.js  (parcel ownership + buying + game/decor placement, per floor)
- `attachParcels(stage, economy, hooks) -> api`. Adds to a floor `stage`:
  - a tile grid overlay on buildable tiles (subtle lines), green tint on owned tiles, a highlight on the tile under the player.
  - standing on a buildable tile → BUY prompt; owned+empty → PLACE prompt; near a placed game → SIT & PLAY / EDIT prompt.
  - `api.tryBuyUnderPlayer(pos)`, `api.refresh()`.
  - **Build/place mode** for BOTH games and decor: `api.enterBuildMode({ kind:'game'|'decor', type })`,
    `api.exitBuildMode()`, `api.placeUnderPlayer(pos)` (validates owned tile, charges via economy.addGame/addDecor,
    spawns prop via games.createGameProp / decor.createDecorProp, supports rotate), `api.removeUnderPlayer(pos)`.
  - `api.nearestGame(pos) -> { type, key, index, config }|null` and `api.nearestDecor(pos)` for interaction.
  - instantiate placed games (games.createGameProp) and decor (decor.createDecorProp) at tile centers from
    `economy.getGames(key)` / `economy.getDecor(key)`, applying saved transforms/rotation.
  - `hooks = { onPlay(type,key,index), onEdit(type,key,index), toast(msg,kind) }` — main wires play & mechanics-editor.

### js/games.js
- `createGameProp(type) -> THREE.Group` — 3D machine/table (slots cabinet w/ screen, poker/blackjack tables w/ felt + chips, roulette table+wheel). ≤ ~2 tiles.
- `openGame(type, config)` — playable modal in `#modalHost` wired to Economy, honoring the per-machine `config`
  (mechanics from GAME_CATALOG[type].mechanics merged with saved overrides: min/max bet, rtp, payouts, etc.).
  Implement **slots** (3 reels), **roulette** (red/black/green + spin), **blackjack** (hit/stand vs dealer),
  **poker** (simple 5-card draw vs house). Use `UI.openModal/closeModal`.
- `openGameEditor(type, config, onSave)` — modal that renders inputs from `GAME_CATALOG[type].editable`,
  pre-filled from `config`; on save calls `onSave(newConfig)`. This is how owners **edit the mechanics** of a placed game.

### js/ui.js
- `const UI = { setCoins(n), setLocation(html), showPrompt(text)/hidePrompt(), toast(msg,kind),
   openModal(node)/closeModal()/isModalOpen(), drawMap(canvas,{economy,playerPos,floorIndex}),
   openFloorMenu(floors,current,onPick)/closeFloorMenu(),
   openBuildPalette(groups,onPick,onClose,current)/closeBuildPalette() }`.
  - `openBuildPalette(groups, ...)` shows a bottom palette with tabs/sections: `groups = [{label, items:[{id,name,icon,cost,kind}]}]`
    so the player can pick a GAME or a DECOR item to place; `onPick(item)` selects it; highlight `current`.
  - Subscribe to `Economy` so coins/VIP badge update live. `isModalOpen()` true whenever ANY modal/menu/shop overlay is open
    (player.js checks this to suspend pointer-lock controls). Provide `closeAll()`.

### js/decor.js
- `createDecorProp(id) -> THREE.Group` — the 3D mesh for a DECOR_CATALOG item (plant/palm, gold statue, coin fountain,
  red carpet tile, velvet rope, neon sign, bar stool, small chandelier, lounge table, neon archway). ≤ ~2 tiles, feet at y=0.
- `decorCollider(id) -> {w,d} | null` — footprint half-extents for optional collision (null = walk-through like carpet).
  Reuse aesthetics materials/neon where helpful. Never throw on unknown id (return a small placeholder box).

### js/shops.js
- `openShop(kind='gift') -> void` — modal "gift shop / concessions" grid built from `SHOP_CATALOG`, buy via
  `Economy.buyShopItem(id,cost)`; show owned counts from `Economy.inventoryCount(id)`; toast on purchase. Uses `UI.openModal/closeModal`.
- `openDecorStore() -> void` — optional alias that opens the build palette filtered to decor (or its own grid) so players
  can browse decorations to place. Keep it simple; spending happens at placement via parcels.js.
- Never hardcode prices — read from `SHOP_CATALOG` / `DECOR_CATALOG`.

### js/skins.js
- `openSkinShop()` — modal grid from `SKIN_CATALOG`; buy/equip via Economy. Dispatch `window` event `'skinchange'`.
- `applySkinToHumanoid(humanoidApi, skinId)`.

### js/auth.js
- `initAuth() -> Promise<{ user|null, mode }>`. Supabase (`config.SUPABASE`) if keys present else guest.
  Dynamic import `https://esm.sh/@supabase/supabase-js@2`. Renders a small login form (email+password / magic link)
  on the start screen. On login: read table `saves(user_id uuid primary key, data jsonb)`, `Economy.hydrate(data)`,
  set `Economy.cloud = { save: debounce(upsert) }`. Export `signOut(), currentUser()`. No hardcoded secrets.

### js/player.js
- `class Player { constructor({ camera, domElement }); setStage(stage); update(dt); get position(); lock(); unlock(); }`
  PointerLockControls look + WASD + Space jump + Shift sprint + gravity; collide vs `stage.colliders`, stand on
  `stage.sampleGround`. `V` toggles 1st/3rd person (3rd shows humanoid avatar via characters.js + equipped skin).
  Rebuild avatar on window `'skinchange'`.

## Rules for every agent
- Output ONLY your one file at the given path. Do not edit other files. Do not touch `main.js`, `index.html`, `config.js`, `economy.js`.
- Import only from `three`, `three/addons/...`, `./config.js`, `./economy.js`, and the sibling modules named in your spec.
- Never throw on missing data. Reuse geometries/materials. Keep it readable.
- Assume sibling modules export exactly what this contract says (they're built in parallel).
