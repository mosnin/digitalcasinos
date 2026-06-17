# Digital Casinos — Wave 6: Seated 3D play, elevator, parcel fixes, large plots

Goal: stop using full-screen popups for games — the player **sits down at the
actual machine** and plays it with real Three.js animations (reels spinning on
the cabinet, the roulette wheel turning, cards dealt onto the felt). Also: better
elevator, FIX building games on owned parcels, and add LARGER premium plots.

Anchors: `js/config.js`, `js/economy.js`. New config: `LARGE_PLOTS, largePlots(floor), largePlotAt(floor,x,z)`, and 7 casino floors now in `FLOORS`/`DESTINATIONS`.
Each agent edits ONLY its named file and keeps existing public exports/signatures.

## Stage interface & conventions unchanged. Realistic warm art direction (wave 5) — NO neon.

---

## BUILD AGENTS (5)

### js/seatedplay.js  (NEW FILE)
`export function createSeatedPlay({ camera, getPlayer }) -> Seated`:
- `Seated.enter({ prop, type, config, onExit })`: begin a seated session at `prop` (THREE.Object3D, has world position + rotation.y). Save the current camera position+quaternion. Compute a **seat pose** ~2.4 units in front of the prop (front = +Z rotated by prop.rotation.y; props face +Z toward the player) at sitting eye height (~1.15), looking at the prop's upper screen/felt. Smoothly **tween the camera** to that pose over ~0.9s (ease in/out). Store `type/config/onExit`. Mark active.
- `Seated.update(dt)`: advance the active camera tween; once seated, hold the pose (optional tiny idle sway).
- `Seated.leave()`: tween the camera back to the saved pose (~0.7s); on completion call the stored `onExit()` and clear active.
- `Seated.isActive()`, `Seated.isBusy()` (true while a tween is animating).
- Pure camera control + a small easing helper. Never throw. Expose `window.Seated`. Do NOT move the player body or touch DOM (the integrator freezes the player and games.js shows the panel).

### js/games.js  (extend; keep createGameProp, openGame, openGameEditor signatures + all gameplay/economy logic)
1) Make each `createGameProp(type)` expose **animation hooks** on `prop.userData`, plus `prop.userData.update(dt)` that advances any in-progress animation:
   - slots: `userData.reels` (3 reel Object3Ds) + `userData.spin(finalSymbols:[s,s,s], cb)` spins each reel and lands on the symbols (rotateX), staggered, calling `cb()` when all stop; `userData.setSymbols([s,s,s])`.
   - roulette: `userData.spinWheel(number, cb)` rotates the wheel + runs the ball, settling on `number`, then `cb()`.
   - blackjack/poker: `userData.dealCard({ to:'player'|'dealer', label }, cb)` slides a card mesh onto the felt; `userData.clearCards()`.
   Keep these self-contained and advanced ONLY via `prop.userData.update(dt)` (no internal rAF).
2) `export function openSeatedGame(type, config, ctx)` where `ctx = { prop, onExit }`:
   - Render a COMPACT control panel docked bottom-center via `UI.openPanel?` — actually append a `div.seated-panel` to `document.body` directly (NOT `UI.openModal`, NOT full-screen). It has: balance, bet controls (or bet chips for roulette / hit-stand for blackjack / hold for poker), a big **SPIN/DEAL** button, a result line, and a **Stand Up** button that calls `ctx.onExit()` and removes the panel.
   - Each round runs the SAME economy settlement as `openGame` (validate/clamp bet, `Economy.wager(amount,payout)`), BUT triggers the matching `ctx.prop.userData.*` 3D animation and only reveals the result when the animation's `cb` fires. Disable controls during the animation.
   - Honor `config` (mechanics). Play SFX via `./audio.js` (guarded).
   - Provide `export function closeSeatedGame()` to force-remove the panel.
   Keep `openGame` as a fallback (unchanged).

### js/elevator.js  (aesthetic overhaul; keep createElevator({destinations}) -> {openDirectory(currentId,onPick), playRide(from,to,onArrive)})
- `playRide`: a luxe, realistic elevator cab overlay — brushed gold + dark wood panels, a **mirrored back wall**, a brass handrail, an illuminated **floor indicator** that counts/ticks toward the destination name, two smooth sliding doors that close then open, a soft "ding". ~1.1–1.4s, with a guaranteed `onArrive` (safety timeout). Use SFX if available.
- `openDirectory`: a classy `.game-modal` "Elevator" — grouped destinations with icons, current marked "HERE", scrollable, elegant rows (hover). Keep onPick.
- Keep `window.Elevator`. Never throw.

### js/parcels.js  (FIX + LARGE PLOTS; keep attachParcels(stage,economy,hooks) + full api identical)
1) **FIX the build-on-owned-parcel flow.** Symptom: after buying a parcel, placing a game on it can fail. Trace `enterBuildMode`→ghost→`placeUnderPlayer`/`getPrompt`/`tileUnder`/`ownsParcel`; ensure: buying calls `refresh()` so placards/highlight update; an owned tile reliably accepts a game (cost deducted, prop spawned); the FOR-SALE placard disappears once owned; `getPrompt` clearly says "[B] build menu" on owned-empty tiles and "[F] place" while in build mode. Make placement robust to the player standing slightly off-center (snap to the tile under the player).
2) **LARGE PLOTS.** Use `config.largePlots(stage.floorIndex)` / `largePlotAt(floor,x,z)`. For each plot:
   - Render a grand inlaid border + a standing placard "{name} — {price} 🪙" (warm), and an owned tint when owned.
   - Standing inside an UNOWNED plot → `getPrompt` returns "[B] Buy {name} — {price}"; `tryBuyUnderPlayer` buys it via `economy.buyParcel('lp:'+id, price)` (one key for the whole plot).
   - Standing inside an OWNED plot → build mode places games/decor **anywhere inside the plot** (multiple items), stored under the plot key `'lp:'+id` with `{ x, z, rot }` (free placement, snap to a ~3-unit sub-grid; no single-per-tile limit, but keep items ~3 units apart). `placeUnderPlayer`/`removeUnderPlayer`/`nearestGame` must work inside plots too (read/write `economy.getGames('lp:'+id)` / `getDecor`).
   - Spawn existing plot games/decor on refresh using their saved x/z.
   Keep single-tile parcels fully working alongside. Never throw.

### js/characters.js  (additive; keep buildHumanoid, NPCManager, makeDealer working)
- Extend `makeDealer(opts)` to return `{ root, update(dt), deal(cb), gesture(name) }` — a seated croupier with a subtle idle and a `deal()`/`gesture()` arm motion (advanced via update(dt)) used behind seated tables. Don't break existing `makeDealer().root/update` usage.

---

### js/lobby.js  (NEW FILE) — a grand Caesars-Palace-scale hotel lobby
`export function createLobby({ economy }) -> lobby` with `lobby.getStage()` (lazy+cache) returning a **Stage**, and a settable `lobby.onElevator`.
- Build a HUGE, opulent marble lobby (bigger than a normal floor — aim ~140 x ~100 walkable, Caesars-scale): polished marble floors with inlaid medallion patterns, **towering fluted columns** (instanced) with gilded capitals, a coffered/domed ceiling with multiple **chandeliers**, grand **archway hallways** branching off in several directions (corridors with runners + columns + framed art that read as wings of the resort), a tiered **central fountain**, **statues** on plinths, lounge seating clusters (sofas + tables + palms), a bell-desk with luggage carts, warm daylight + warm downlights (few real lights; mostly emissive + ambient — performance!).
- A long **front desk / reception** with a **concierge** NPC standing behind it (use characters.buildHumanoid, posed). Add a trigger `{ pos at the desk, radius ~3, prompt:'[E] Speak to the concierge', action: openConcierge }`.
- `openConcierge()`: a `.game-modal` "🛎️ Concierge" dialogue via UI.openModal — a warm greeting + buttons: "Where can I go?" (lists the casino floors, hotel towers, arena, garden and how to reach them via the elevator), "Any tips?" (a rotating gameplay tip), "Daily perk" (toast a small welcome), and Close. Keep it charming and brief.
- Add an **elevator** alcove + trigger `{ action: () => lobby.onElevator && lobby.onElevator() }` so players can travel onward. spawn at the grand entrance facing INTO the lobby (remember: heading 0 faces -Z). sampleGround=>0. Perimeter walls + desk + fountain + columns as colliders; keep the hallways and floor open/walkable.
- PERFORMANCE: instance columns/seats/art; reuse aesthetics.material()/makeChandelier(); cap real PointLights (~2-3); flag static meshes userData.animated=false. Never throw. Provide a defensive fallback stage.

## MULTIPLAYER REPORT AGENTS (5) — READ-ONLY, produce a focused report (no file edits)
Read `js/net.js`, `js/remoteplayers.js`, `js/holdings.js`, `js/main.js`, `js/auth.js`, `js/config.js`, `CONTRACT4.md`. Each agent covers ONE area and returns a concise prioritized list of "what's still needed / gaps / risks" with file:line evidence and concrete next steps:
1. **Presence & movement sync** — broadcast cadence, interpolation/smoothing, join/leave handling, dest filtering, avatar lifecycle in remoteplayers, perf with many players.
2. **Shared ownership (holdings)** — sync correctness/race conditions, realtime subscription, ownerOf surfacing in HUD/minimap/parcels/hotel, what's missing to actually SEE who owns parcels/rooms in-world.
3. **Supabase setup & config** — exactly what the user must do to enable MP (keys, the `saves`/`holdings`/`leaderboard` tables + RLS, realtime enablement), and where docs/SQL live; deployment notes for digitalcasinos.fun.
4. **Reliability & scale** — reconnection, channel limits, throttling/rate, error handling, guest-id stability, security/anti-cheat (client-authoritative economy!), and how to harden.
5. **Missing MP features** — chat, seeing other players inside the same game/room, player list/roster UI, trading/visiting others' casinos, name uniqueness, presence indicators. Prioritize.
