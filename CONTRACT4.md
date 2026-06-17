# Digital Casinos — Wave 4: Multiplayer + Missing Systems

Adds online multiplayer (Supabase Realtime) and the systems we haven't built yet.
**Each agent creates ONE new file** and must NOT edit existing files. The
integrator wires them into `main.js` afterward.

Anchors: `js/config.js` (`SUPABASE, DESTINATIONS, SKIN_CATALOG, FLOORS, GAME_CATALOG, DECOR_CATALOG, ROOM_STYLES, HOTEL, parcelKey, tileCenter`), `js/economy.js` (`Economy`).
Siblings you may import: `./ui.js` (`UI`), `./characters.js` (`buildHumanoid`), `./skins.js` (`getSkinColors`), `./economy.js`, `./audio.js` (`SFX`), `./leaderboard.js` (`computeNetWorth`).

Rules: browser ESM, `import * as THREE from 'three'` where 3D is needed. Never throw. Everything must degrade gracefully when Supabase isn't configured (guest = offline single-player). `node --check`.

## MULTIPLAYER TECH: Supabase Realtime
Use `supabase-js@2` via `import('https://esm.sh/@supabase/supabase-js@2')`. A single
Realtime **channel** named `world`: **Presence** for the live roster, **Broadcast**
(event `pos`) for ~10 Hz movement. Shared ownership via a Postgres table + Realtime.

### js/net.js
`export function createNet({ getProfile }) -> net` where `getProfile()` returns `{ id, name, skin }`.
- `net.connect()` async: if `!SUPABASE.url||!SUPABASE.anonKey` → set offline, resolve `{ online:false }`. Else dynamic-import supabase-js, `createClient`, try `auth.getUser()` for a stable id (else generate/persist a random guest id in localStorage `dc_pid`). Create `supabase.channel('world', { config:{ presence:{ key:id }, broadcast:{ self:false } } })`. Register `presence sync/join/leave` → maintain roster and fire `onJoin/onLeave`. Register `broadcast {event:'pos'}` → fire `onUpdate(payload)`. `subscribe()`, and on SUBSCRIBED `channel.track(getProfile())`.
- `net.setLocal(state)`: `state={id,name,skin,dest,x,z,yaw}`. Throttle to ~100 ms; `channel.send({type:'broadcast',event:'pos',payload:state})`. Also re-`track` profile if name/skin changed.
- `net.onUpdate(cb)`, `net.onJoin(cb)`, `net.onLeave(cb)`, `net.roster() -> [{id,name,skin}]`, `net.isOnline()`, `net.disconnect()`.
- Defensive: any failure → offline, no throws. Expose `window.Net`.

### js/remoteplayers.js
`export function createRemotePlayers() -> remote`:
- `remote.setStage(scene, destId)`: store the active scene + destination; clear all avatars.
- `remote.apply(state)`: for a remote `state` (id,name,skin,dest,x,z,yaw): if `state.dest===destId` ensure an avatar exists (lazy `buildHumanoid` recolored via `getSkinColors(state.skin)`) added to the current scene, set a target position/yaw (lerped in update), and a floating **name sprite** above the head (canvas texture). If `state.dest!==destId`, remove that avatar from the scene.
- `remote.remove(id)`, `remote.update(dt)` (lerp positions, animate walking when moving, billboard the name sprites toward the camera if a camera is set via `remote.setCamera(cam)`), `remote.clear()`. Cap ~30 avatars. Never throw.

### js/holdings.js
`export function createHoldings() -> holdings` — shared ownership of parcels/rooms so everyone sees who owns what.
- `holdings.sync(economy)` async: if Supabase configured + a user is signed in, upsert this user's owned parcels (keys from `economy.ownedParcelKeys()`, kind `'parcel'`) and rooms (`economy.ownedRoomIds()`, kind `'room'`) into table `holdings(user_id uuid, name text, kind text, item_key text, primary key(kind,item_key))`. Use the player's display name. Delete rows no longer owned. (Offline → no-op.)
- `holdings.refresh()` async: fetch all rows → build internal map keyed `kind:item_key → {name, user_id}`. Subscribe to Realtime changes on `holdings` to keep it fresh; fire `onChange()`.
- `holdings.ownerOf(kind, key) -> { name, isMe } | null`. `holdings.onChange(cb)`. `holdings.isOnline()`.
- Put the table SQL + RLS (public SELECT; users write only `user_id = auth.uid()`) in a top comment. Never throw; offline returns null owners.

## NEW SINGLE-PLAYER SYSTEMS

### js/profile.js
`export function openProfile({ economy })` — a `.game-modal` "🧑 Profile & Portfolio" via UI.openModal: an editable **display name** (writes `economy.state.profile.name`, then `economy.save()`), **net worth** (import `computeNetWorth` from `./leaderboard.js`), coin balance, lifetime stats (`economy.state.stats`), a list of owned **parcels** (grouped by floor via `FLOORS`) and owned **hotel rooms** (with style), owned skins, and shop inventory. Close button. Read-only except the name field. Defensive.

### js/quests.js
`export const Quests = { init({ economy, onReward }), evaluate(), openPanel(), active() }`.
- Generate a small set of **daily** missions (reset by date in localStorage `dc_quests`) e.g. "Win 500 coins today", "Place 2 machines", "Bet on a horse race", "Visit the Garden", "Buy a parcel". Track progress from `economy.state.stats` deltas + explicit `Quests.mark(eventName)` calls (export `mark(name, n=1)` too). On completion grant a coin reward via `economy.add` and fire `onReward(quest)` once. `openPanel()` shows a `.game-modal` checklist with progress bars. Persist progress/claims. Never throw.

### js/bank.js
`export function openBank({ economy })` and `export function applyDailyInterest({ economy })`.
- Store bank state on `economy.state.bank = { vault:0, debt:0, lastInterest:date }` (create if missing; persist via `economy.save()`).
- `openBank`: a `.game-modal` "🏦 Vault & Bank": deposit/withdraw between coins and vault; take a **loan** (adds to coins + debt, cap by a simple limit), repay debt from coins; show vault, debt. Vault earns small daily interest; debt accrues daily interest.
- `applyDailyInterest`: if a day passed since lastInterest, apply vault interest (+~2%/day) and debt interest (+~5%/day), update lastInterest, persist. Call-safe to run at startup. Never throw.

### js/pausemenu.js
`export function openPauseMenu(actions)` and `export function isPauseOpen()`.
- A `.game-modal` "⏸ Paused" via UI.openModal with buttons: Resume (UI.closeModal + `actions.resume?.()`), Settings (`actions.settings?.()`), Controls (toggles a controls cheatsheet), Profile (`actions.profile?.()`), Sign out (`actions.signOut?.()`), and a volume quick-toggle (`SFX.setMuted`). Track open state. Defensive.

### js/notifications.js
`export const Notify = { init(), push(msg, kind, icon), openFeed(), recent() }`.
- `init()` creates a small fixed **activity feed** element (top-center or right) that shows the last ~4 events as stacked pills that fade after a few seconds; keep a history (cap ~50). `push` adds an event (kind: 'coin'|'info'|'win'|'social'). `openFeed()` opens a `.game-modal` with the full history list. Distinct from `UI.toast`. Never throw. Expose `window.Notify`.

### js/music.js
`export const Music = { init(), start(), toggle(), isPlaying(), setVolume(v), next() }`.
- Procedural background music via Web Audio (a few looping lounge/synth chord-and-bass sequences with light percussion; NO asset files), separate from `audio.js` ambience. Lazily create context on `start()` (user gesture). `toggle()` play/pause; `next()` switches track; `setVolume` 0..1; persist on/off + volume to localStorage `dc_music`. Keep CPU light. Never throw. Expose `window.Music`.

### js/tutorial.js
`export function maybeShowTutorial()` (show once, gated by localStorage `dc_tutorial`) and `export function openTutorial()`.
- A friendly multi-step `.game-modal` overlay (Next/Back/Skip) teaching: look/move, buy a parcel (B), build & decorate (G/F), play & edit games (E/R), the elevator & destinations, buying a hotel room, attractions (arena/garden), and shops/skins. `maybeShowTutorial` returns true if shown. Mark complete so it won't auto-show again. Never throw.

## Integrator notes (not for agents)
main.js will: `net.connect()` after auth; each frame `net.setLocal(playerState)` + `remote.update`; route `net.onUpdate`→`remote.apply`; on destination change `remote.setStage`; `holdings.sync/refresh` on ownership changes + surface `ownerOf` in HUD/minimap; add keys — I (profile), Q (quests), N (bank), Z (music), H (help/tutorial), Backquote (pause); `Notify.push` on earnings/purchases; `Music.start()` + `applyDailyInterest` + `maybeShowTutorial` at game start.
