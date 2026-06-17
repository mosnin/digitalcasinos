# Digital Casinos — Deeper Features Contract (wave 2)

Adds depth on top of the shipped game. **Every agent creates ONE new file** and
must NOT edit existing files (`main.js`, `config.js`, `economy.js`, or any wave-1
module). The integrator (`main.js`) imports and wires these afterward.

Shared anchors (import, never duplicate):
- `js/config.js` — `FLOORS, FLOOR, tileCenter, tileFromWorld, parcelKey, isBuildableTile, GAME_CATALOG, DECOR_CATALOG, COLORS, SUPABASE`.
- `js/economy.js` — `import { Economy } from './economy.js'` (`coins, add, spend, canAfford, wager, getGames, getDecor, ownedParcelKeys, ownsParcel, state, subscribe, inventoryCount`).
- Wave-1 siblings you may import: `./ui.js` (`UI.openModal/closeModal/toast/showPrompt`), `./characters.js` (`buildHumanoid`), `./aesthetics.js`.

Rules: browser-native ESM, `import * as THREE from 'three'` (+ `three/addons/...`). Never throw on missing data. Reuse geometry/materials. Verify `node --check`.

Owned-game world positions can be derived WITHOUT other modules: each key in
`Economy.state.parcels` is `"floor_ti_tj"`; parse it, and a placed game's world
position on that floor is `tileCenter(ti,tj)`. Use `Economy.getGames(key)`.

## Deliverables

### js/audio.js — procedural Web Audio sound (no asset files)
`export const SFX = { init(), unlock(), setMuted(b), isMuted(), setVolume(v01), getVolume(), play(name), startAmbient(theme), stopAmbient() }`.
Synthesize all sounds with OscillatorNode/Gain/Noise (no external files). `name` ∈
`coin, win, bigwin, jackpot, lose, spin, reel, click, place, remove, buy, elevator, error, chip, card, deal`.
`startAmbient(theme)` = a soft looping casino ambience pad/murmur tuned per floor theme. Create the AudioContext lazily on first `unlock()`/`play()` (autoplay policy). Persist mute/volume to localStorage. Expose `window.SFX`.

### js/postfx.js — neon bloom post-processing
`export function createPostFX(renderer, scene, camera, opts={}) -> { render(scene, camera), setSize(w,h), setEnabled(b), isEnabled(), setStrength(s) }`.
Use `three/addons/postprocessing/EffectComposer.js`, `RenderPass.js`, `UnrealBloomPass.js`, `OutputPass.js`. `render(scene,camera)` must update the internal RenderPass's `.scene`/`.camera` each call (the active floor scene changes). When disabled, fall back to `renderer.render(scene,camera)`. Tune bloom for glowing neon (strength ~0.7, radius ~0.5, threshold ~0.85). Guard addon import failures (fall back to direct render).

### js/patrons.js — NPC patrons play YOUR machines for passive income
`export function createPatrons({ economy, onEarn }) -> { setFloor(scene, floorIndex), update(dt), clear() }`.
On `setFloor`, spawn a handful of `characters.buildHumanoid` patrons that walk to the world positions of the player's placed games on that floor (derive from `economy.state.parcels` keys + `tileCenter`). While a patron stands at a machine, it periodically generates income: call `economy.add(amount)` and `onEarn(amount, worldPos)` (small amounts scaled by game type cost). If the player owns no machines on the floor, patrons just idle/wander. `update(dt)` advances movement + payouts; `clear()` removes them. Cap ~6 patrons. Keep y at 0.

### js/achievements.js — achievements + objectives
`export const Achievements = { init({ economy, onUnlock }), evaluate(), openPanel(), unlockedCount(), total() }`.
Define ~10 achievements (first parcel, first machine, own 5 parcels, win a jackpot, net worth 5k, place one of every game, etc.) computed from `economy.state` (coins, stats, parcels, getGames). `evaluate()` checks & fires `onUnlock(ach)` once each (persist unlocked ids to localStorage). `openPanel()` builds a `.game-modal` grid (locked/unlocked) via `UI.openModal`. Never throw.

### js/dailybonus.js — daily login reward
`export function maybeShowDailyBonus({ economy }) -> boolean` and `export function openDailyBonus({ economy, force })`.
If the last-claim date in localStorage is not today, show a `.game-modal` "Daily Bonus" with a small spin-the-wheel / reveal animation that grants 100–500 coins via `economy.add`, tracks a day streak (bigger reward at higher streak), and records today's date. Returns true if shown. Uses `UI.openModal/closeModal`.

### js/settings.js — settings menu
`export const Settings = { init({ onChange }), open(), get(key), all() }`.
Persisted values: `{ volume:0.7, bloom:true, minimap:true, fov:72, sensitivity:1, crowd:true }`. `open()` builds a `.game-modal` with sliders/toggles; on any change persist + call `onChange(all())`. `init` loads saved values and calls `onChange` once. Never throw.

### js/minimap.js — always-on radar
`export const Minimap = { init(), setFloor(floorIndex), update(playerPos, yaw), setVisible(b), isVisible() }`.
`init()` creates a small (~160px) canvas overlay element (fixed, bottom-left) appended to `document.body` with a styled border. `update` redraws: current floor footprint, buildable tiles (faint), owned tiles (green), placed-game dots (pink), feature rects (pools/bars/elevator) from `FLOORS[floor]`, and the player as a rotated arrow at center using `yaw`. Reads `Economy`. Lightweight (redraw OK each frame).

### js/touch.js — mobile/touch controls
`export function initTouchControls({ player, actions }) -> { enabled, destroy() }`.
If a touch device (`'ontouchstart' in window` or coarse pointer), overlay a left virtual joystick (drives `player.keys` WASD via thresholds), a right-side look pad (drag → rotate camera yaw/pitch on `player.camera`), and action buttons calling `actions.interact/buy/build/place/jump`. On non-touch, no-op (`enabled:false`). Append DOM with high z-index, pointer-events on buttons only. Never throw.

### js/leaderboard.js — net-worth leaderboard
`export function computeNetWorth(economy) -> number`, `export function openLeaderboard({ economy })`, `export async function submitScore({ economy, name })`.
Net worth = coins + value of owned parcels/games/decor (use catalog costs). `openLeaderboard` shows a `.game-modal` ranked list. If `config.SUPABASE.url/anonKey` set, dynamically `import('https://esm.sh/@supabase/supabase-js@2')` and read/write a `leaderboard (user_id uuid pk, name text, net_worth bigint, updated_at timestamptz)` table; otherwise use a localStorage-backed mock list (include a few seeded bot scores so the board isn't empty). Include the table SQL + RLS in a top comment. Never throw; always render something.

### js/gameslobby.js — extra casino games to play instantly
`export const EXTRA_GAMES = { craps:{...}, wheel:{...}, baccarat:{...}, keno:{...} }` (each `{id,name,icon,desc}`),
`export function openGamesLobby()` (a `.game-modal` menu listing the extra games; clicking opens one),
`export function openExtraGame(type)` (playable `.game-modal` wired to `Economy.wager/add/spend/canAfford`).
Implement **craps** (pass-line: come-out 7/11 win, 2/3/12 lose, else point), **wheel** (big-six wheel, segment multipliers), **baccarat** (player/banker/tie bet, standard draw), **keno** (pick up to 8 of 80, draw 20, paytable). Use `UI.openModal/closeModal`. Defensive bet clamping; balance can't go negative.

## Integration notes (for the integrator, not the agents)
main.js will: trigger `SFX.play` on actions; replace `renderer.render` with `postfx.render`; `patrons.setFloor` on floor change + `update`; `Achievements.evaluate` periodically; `maybeShowDailyBonus` after start; add keys J (achievements), O (settings), K (games lobby), L (leaderboard); `Minimap.update` each frame; `initTouchControls`.
