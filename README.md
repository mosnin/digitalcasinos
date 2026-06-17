# 🎰 Digital Casinos

An open-world voxel-flavored casino game built with **Three.js** (no build step —
just static files + an import map). The entire game takes place **inside one
massive mega-casino** made of several themed floors/sections. Walk the floors,
**buy parcels of land inside the casino**, **place & tune casino games**
(slots, roulette, blackjack, poker), **decorate** your space, spend winnings in
the gift shops, and sit down to play — with a 3D avatar, a wandering Las-Vegas
crowd, and optional **Supabase** accounts for cloud saves.

## ▶️ Run it

It's pure static files. Serve the folder over HTTP (ES modules + the import map
need `http://`, not `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Three.js loads from a CDN via the import map in `index.html`, so an internet
connection is required the first time.

## 🎮 Controls

| Key | Action |
| --- | --- |
| **W A S D** / arrows | Move |
| **Mouse** | Look (click the canvas to capture the pointer) |
| **Space** | Jump · **Shift** Sprint |
| **V** | Toggle 1st / 3rd person (see your avatar) |
| **E** | Use: enter the elevator, open a gift shop, or **sit & play** a game |
| **B** | Buy the parcel you're standing on / open the build menu on a parcel you own |
| **G** | Open/close **Build mode** (place games & decorations) |
| **F** | Place the selected item · **R** rotate (or **R** to edit a game's mechanics) |
| **X** | Remove the item under you |
| **M** | World map of the current floor |
| **P** | Style & Skins shop · **T** Gift shop |
| **Esc** | Release the mouse / close menus |

## 🏨 The mega-casino (floors / sections)

Only the **active** floor is built & rendered (lazy construction) so it stays
smooth. Take the elevator (**E**) to travel between sections:

1. **Grand Casino Floor** — classic red & gold, the main gaming hall.
2. **Poolside Promenade** — neon-cyan pool, bars, cabanas.
3. **High-Roller Sky Lounge** — purple & gold, panoramic Vegas skyline windows.
4. **The Promenade — Shops & Dining** — gift shops, restaurants, a showroom.

## 🪙 Gameplay loop

1. Find a glowing **gold** (for-sale) floor tile and press **B** to buy it.
2. Press **G** to open Build mode, pick a **game** or **decoration**, walk onto
   your tile and press **F** to place it (**R** rotates).
3. Walk up to one of your machines and press **E** to **play** it, or **R** to
   **edit its mechanics** (bet limits, payouts, RTP, jackpot…).
4. Win coins, then spend them on more land, decorations, skins, or the gift shop.

## ☁️ Supabase login (optional)

The game is fully playable as a **guest** (progress saved in `localStorage`).
To enable accounts + cloud saves:

1. Create a Supabase project and run this SQL:
   ```sql
   create table saves (
     user_id uuid primary key references auth.users on delete cascade,
     data jsonb,
     updated_at timestamptz default now()
   );
   alter table saves enable row level security;
   create policy "own save" on saves for all
     using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```
2. Put your keys in `js/config.js` (`SUPABASE.url` / `SUPABASE.anonKey`), or set
   `window.SUPABASE_CONFIG = { url, anonKey }` before `main.js` loads.
3. A login form appears on the start screen; sign up / log in to sync.

No secrets are committed — keys are read from config only.

## 🧱 Architecture

Modular browser-native ES modules in `js/`, all coded against a shared contract
(`CONTRACT.md`) and two anchor files (`config.js`, `economy.js`):

| File | Responsibility |
| --- | --- |
| `config.js` | Floor/tile math, prices, game/decor/skin catalogs, tuning |
| `economy.js` | Coins, parcels, placed games & decor, skins, save/load |
| `aesthetics.js` | Lighting, neon materials/signs, carpet/marble/water, chandeliers, skyline |
| `characters.js` | Rigged low-poly humanoids, NPC crowd, dealers |
| `casino.js` | Builds the mega-casino, lazy per-floor stages, elevator |
| `venues.js` | Pools, bars, fountains, gift shops, restaurants, theater, windows |
| `parcels.js` | Tile grid, buying, placing/removing games & decor |
| `games.js` | Game 3D props + playable modals + mechanics editor |
| `decor.js` | Placeable decoration meshes |
| `shops.js` | Gift shop / concessions UI |
| `skins.js` | Character skin shop |
| `ui.js` | HUD, prompts, toasts, map, floor menu, build palette, modals |
| `auth.js` | Supabase auth + cloud save (guest fallback) |
| `player.js` | First/third-person controller + avatar |
| `main.js` | Wires everything into the game loop |

Built as a parallel multi-agent effort; see `CONTRACT.md` for the module interfaces.

## 🧪 Dev smoke test

`test/smoke.mjs` loads the game headlessly (Playwright) and exercises buying a
parcel, placing a game, and switching floors. It expects a local server on
`:8123` and a Playwright Chromium install.
