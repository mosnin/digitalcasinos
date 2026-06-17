// =============================================================
// Digital Casinos — parcels.js
// Per-floor parcel ownership, buying, and game/decor placement.
//
// attachParcels(stage, economy, hooks) -> api
//   stage : a floor Stage { scene, floorIndex, baseY:0, colliders, triggers, ... }
//   hooks : { onPlay(type,key,index,config), onEdit(type,key,index,config),
//             toast(msg,kind) }
//
// Adds (all parented to stage.scene):
//   1) a subtle line-grid overlay on buildable tiles only,
//   2) green tint quads on owned tiles + a moving highlight quad under
//      the player (green=owned, gold=buyable, red=not buildable),
//   3) the placed games / decor for owned tiles on THIS floor.
//
// Never throws on missing data. Reuses geometry/material where it can.
// =============================================================

import * as THREE from 'three';
import {
  FLOOR,
  tileCenter, tileFromWorld, parcelKey, isBuildableTile,
  GAME_CATALOG, DECOR_CATALOG,
} from './config.js';
import * as games from './games.js';
import * as decor from './decor.js';

// ---- small shared constants ------------------------------------
const GRID_Y    = 0.02;   // grid lines just above the floor (y=0)
const TINT_Y    = 0.015;  // owned tint quad
const HILITE_Y  = 0.03;   // moving highlight quad (above tint)
const HALF       = FLOOR.TILE / 2;
const PICK_RANGE = 2.2;    // metres for nearestGame / nearestDecor
const GAME_COLLIDER_H = 2.0;

const COL_OWNED   = 0x35e06a; // green
const COL_BUYABLE = 0xffd23f; // gold
const COL_BLOCKED = 0xff3b3b; // red

// shared unit-quad geometry (XZ plane, 1×1, centred on origin)
const QUAD_GEO = new THREE.PlaneGeometry(1, 1);
QUAD_GEO.rotateX(-Math.PI / 2); // lie flat on the floor

// ---------------------------------------------------------------
// Helpers (defensive — never throw)
// ---------------------------------------------------------------
function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

// Catalog look-ups that tolerate unknown ids.
function gameDef(type) { return (type && GAME_CATALOG[type]) || null; }
function decorDef(id)  { return (id && DECOR_CATALOG[id]) || null; }

// Make a material transparent + non-collidable for ghost previews.
function makeGhost(node) {
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      if (!m) return m;
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.45;
      c.depthWrite = false;
      return c;
    });
    if (!Array.isArray(o.material)) o.material = o.material[0];
  });
  return node;
}

// ---------------------------------------------------------------
// attachParcels
// ---------------------------------------------------------------
export function attachParcels(stage, economy, hooks) {
  hooks = hooks || {};
  const scene = stage.scene;
  const floor = stage.floorIndex | 0;
  const toast = (msg, kind) => safe(() => hooks.toast && hooks.toast(msg, kind));

  // Group that holds everything we add, so disposal/teardown is one node.
  const root = new THREE.Group();
  root.name = 'parcels';
  if (scene && scene.add) scene.add(root);

  // ----- registry: prop Object3D -> { key, index, kind, type } -----
  // kind: 'game' | 'decor'
  const registry = new Map();           // node -> meta
  const colliderMap = new Map();        // node -> Box3 (so we can remove)

  // currentTile under the player (set by update); { ti, tj } | null
  let currentTile = null;

  // -----------------------------------------------------------------
  // 1) Grid overlay on buildable tiles (single LineSegments, merged)
  // -----------------------------------------------------------------
  buildGrid();
  function buildGrid() {
    const positions = [];
    const TX = FLOOR.TX, TZ = FLOOR.TZ, T = FLOOR.TILE;
    for (let ti = 0; ti < TX; ti++) {
      for (let tj = 0; tj < TZ; tj++) {
        if (!safe(() => isBuildableTile(floor, ti, tj), false)) continue;
        const c = tileCenter(ti, tj);
        const x0 = c.x - HALF, x1 = c.x + HALF;
        const z0 = c.z - HALF, z1 = c.z + HALF;
        // four edges of the tile (slightly above floor)
        // top
        positions.push(x0, GRID_Y, z0, x1, GRID_Y, z0);
        // bottom
        positions.push(x0, GRID_Y, z1, x1, GRID_Y, z1);
        // left
        positions.push(x0, GRID_Y, z0, x0, GRID_Y, z1);
        // right
        positions.push(x1, GRID_Y, z0, x1, GRID_Y, z1);
      }
    }
    if (!positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.12,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = 'parcelGrid';
    lines.renderOrder = 1;
    root.add(lines);
  }

  // -----------------------------------------------------------------
  // 2a) Owned tint quads (one reusable material, one quad per owned tile)
  // -----------------------------------------------------------------
  const tintMat = new THREE.MeshBasicMaterial({
    color: COL_OWNED, transparent: true, opacity: 0.18,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const tintGroup = new THREE.Group();
  tintGroup.name = 'ownedTints';
  root.add(tintGroup);
  const tintQuads = new Map(); // key -> Mesh

  function ensureTint(key, ti, tj) {
    if (tintQuads.has(key)) return;
    const c = tileCenter(ti, tj);
    const q = new THREE.Mesh(QUAD_GEO, tintMat);
    q.scale.set(FLOOR.TILE * 0.96, 1, FLOOR.TILE * 0.96);
    q.position.set(c.x, TINT_Y, c.z);
    q.renderOrder = 2;
    tintGroup.add(q);
    tintQuads.set(key, q);
  }

  // -----------------------------------------------------------------
  // 2b) Moving highlight quad (follows tile under player)
  // -----------------------------------------------------------------
  const hiliteMat = new THREE.MeshBasicMaterial({
    color: COL_BUYABLE, transparent: true, opacity: 0.28,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const hilite = new THREE.Mesh(QUAD_GEO, hiliteMat);
  hilite.name = 'tileHighlight';
  hilite.scale.set(FLOOR.TILE, 1, FLOOR.TILE);
  hilite.position.set(0, HILITE_Y, 0);
  hilite.renderOrder = 3;
  hilite.visible = false;
  root.add(hilite);

  // -----------------------------------------------------------------
  // Prop spawning
  // -----------------------------------------------------------------
  // Track which (key,kind,index) we have already spawned so refresh() is
  // idempotent and only fills gaps.
  const spawned = new Set(); // `${kind}:${key}:${index}`
  function spawnTag(kind, key, index) { return `${kind}:${key}:${index}`; }

  function applyRot(node, rot) {
    const r = Number(rot);
    if (Number.isFinite(r)) node.rotation.y = r;
  }

  // Position a prop at a tile centre (feet at y=0).
  function placeAtTile(node, tile) {
    let cx = 0, cz = 0;
    if (Array.isArray(tile) && tile.length >= 2) {
      const c = tileCenter(tile[0] | 0, tile[1] | 0);
      cx = c.x; cz = c.z;
    }
    node.position.set(cx, 0, cz);
  }

  function addGameCollider(node) {
    // Light collider: a ~1.6×1.6 box around the prop footprint.
    const box = safe(() => {
      const b = new THREE.Box3().setFromObject(node);
      if (b.isEmpty()) throw new Error('empty');
      // clamp the height so players can't be blocked vertically oddly
      b.min.y = 0;
      b.max.y = Math.max(b.max.y, GAME_COLLIDER_H);
      return b;
    }, null);
    const finalBox = box || new THREE.Box3(
      new THREE.Vector3(node.position.x - 1.4, 0, node.position.z - 1.4),
      new THREE.Vector3(node.position.x + 1.4, GAME_COLLIDER_H, node.position.z + 1.4),
    );
    if (Array.isArray(stage.colliders)) stage.colliders.push(finalBox);
    colliderMap.set(node, finalBox);
  }

  function removeCollider(node) {
    const box = colliderMap.get(node);
    if (box && Array.isArray(stage.colliders)) {
      const i = stage.colliders.indexOf(box);
      if (i >= 0) stage.colliders.splice(i, 1);
    }
    colliderMap.delete(node);
  }

  function spawnGame(key, index, g) {
    if (!g) return;
    const tag = spawnTag('game', key, index);
    if (spawned.has(tag)) return;
    const node = safe(() => games.createGameProp(g.type), null);
    if (!node) { spawned.add(tag); return; } // tolerate missing prop
    placeAtTile(node, g.tile);
    applyRot(node, g.rot);
    node.userData.parcel = { key, index, kind: 'game', type: g.type };
    root.add(node);
    registry.set(node, { key, index, kind: 'game', type: g.type });
    addGameCollider(node);
    spawned.add(tag);
  }

  function spawnDecor(key, index, d) {
    if (!d) return;
    const tag = spawnTag('decor', key, index);
    if (spawned.has(tag)) return;
    const node = safe(() => decor.createDecorProp(d.id), null);
    if (!node) { spawned.add(tag); return; }
    placeAtTile(node, d.tile);
    applyRot(node, d.rot);
    node.userData.parcel = { key, index, kind: 'decor', type: d.id };
    root.add(node);
    registry.set(node, { key, index, kind: 'decor', type: d.id });
    spawned.add(tag);
  }

  // -----------------------------------------------------------------
  // api.refresh() — rebuild owned tints + spawn any missing props
  // -----------------------------------------------------------------
  function refresh() {
    const TX = FLOOR.TX, TZ = FLOOR.TZ;
    for (let ti = 0; ti < TX; ti++) {
      for (let tj = 0; tj < TZ; tj++) {
        const key = parcelKey(floor, ti, tj);
        if (!safe(() => economy.ownsParcel(key), false)) continue;
        ensureTint(key, ti, tj);
        // games on this owned tile
        const gs = safe(() => economy.getGames(key), []) || [];
        for (let i = 0; i < gs.length; i++) {
          // fall back to the tile we're iterating if no tile saved
          const g = gs[i] || {};
          if (!Array.isArray(g.tile)) g.tile = [ti, tj];
          spawnGame(key, i, g);
        }
        // decor on this owned tile
        const ds = safe(() => economy.getDecor(key), []) || [];
        for (let i = 0; i < ds.length; i++) {
          const d = ds[i] || {};
          if (!Array.isArray(d.tile)) d.tile = [ti, tj];
          spawnDecor(key, i, d);
        }
      }
    }
  }

  // -----------------------------------------------------------------
  // Build mode + ghost preview
  // -----------------------------------------------------------------
  let pending = null;   // { kind:'game'|'decor', type }
  let ghost = null;     // Object3D
  let ghostRot = 0;     // radians

  function clearGhost() {
    if (ghost) {
      root.remove(ghost);
      ghost = null;
    }
  }

  function buildGhost() {
    clearGhost();
    if (!pending) return;
    const node = pending.kind === 'game'
      ? safe(() => games.createGameProp(pending.type), null)
      : safe(() => decor.createDecorProp(pending.type), null);
    if (!node) return;
    makeGhost(node);
    node.rotation.y = ghostRot;
    node.renderOrder = 4;
    ghost = node;
    root.add(ghost);
    positionGhost();
  }

  function positionGhost() {
    if (!ghost) return;
    if (currentTile) {
      const c = tileCenter(currentTile.ti, currentTile.tj);
      ghost.position.set(c.x, 0, c.z);
      ghost.visible = true;
    } else {
      ghost.visible = false;
    }
  }

  function enterBuildMode(opts) {
    opts = opts || {};
    if (!opts.kind || !opts.type) { pending = null; clearGhost(); return; }
    pending = { kind: opts.kind, type: opts.type };
    ghostRot = 0;
    buildGhost();
  }

  function exitBuildMode() {
    pending = null;
    clearGhost();
  }

  function rotateGhost() {
    ghostRot = (ghostRot + Math.PI / 2) % (Math.PI * 2);
    if (ghost) ghost.rotation.y = ghostRot;
  }

  // -----------------------------------------------------------------
  // api.update(dt, playerPos) — move highlight to tile under player
  // -----------------------------------------------------------------
  function update(_dt, playerPos) {
    if (!playerPos) return;
    const px = playerPos.x, pz = playerPos.z;
    const t = safe(() => tileFromWorld(px, pz), null);
    currentTile = t;

    if (!t) {
      hilite.visible = false;
    } else {
      const c = tileCenter(t.ti, t.tj);
      hilite.position.set(c.x, HILITE_Y, c.z);
      hilite.visible = true;
      const key = parcelKey(floor, t.ti, t.tj);
      const owned = safe(() => economy.ownsParcel(key), false);
      const buildable = safe(() => isBuildableTile(floor, t.ti, t.tj), false);
      let col = COL_BLOCKED;
      if (owned) col = COL_OWNED;
      else if (buildable) col = COL_BUYABLE;
      hiliteMat.color.setHex(col);
    }
    positionGhost();
  }

  // -----------------------------------------------------------------
  // Buying
  // -----------------------------------------------------------------
  function tileUnder(playerPos) {
    if (!playerPos) return currentTile;
    return safe(() => tileFromWorld(playerPos.x, playerPos.z), null) || null;
  }

  function tryBuyUnderPlayer(playerPos) {
    const t = tileUnder(playerPos);
    if (!t) { toast('No tile here.', 'warn'); return { ok: false }; }
    const key = parcelKey(floor, t.ti, t.tj);
    if (!safe(() => isBuildableTile(floor, t.ti, t.tj), false)) {
      toast('You can’t build here.', 'warn');
      return { ok: false };
    }
    if (safe(() => economy.ownsParcel(key), false)) {
      toast('You already own this parcel.', 'warn');
      return { ok: false };
    }
    const price = safe(() => economy.parcelPrice(floor), 0);
    const res = safe(() => economy.buyParcel(key, price), { ok: false, reason: 'error' });
    if (res && res.ok) {
      toast(`Parcel bought for ${price} 🪙`, 'good');
      refresh();
    } else {
      toast((res && res.reason) ? res.reason : 'Could not buy parcel.', 'warn');
    }
    return res || { ok: false };
  }

  // -----------------------------------------------------------------
  // Placing (games + decor)
  // -----------------------------------------------------------------
  function gamesOnTile(key, ti, tj) {
    const gs = safe(() => economy.getGames(key), []) || [];
    return gs.filter((g) => g && Array.isArray(g.tile) && g.tile[0] === ti && g.tile[1] === tj);
  }

  function placeUnderPlayer(playerPos) {
    if (!pending) { toast('Pick something to place first.', 'warn'); return { ok: false }; }
    const t = tileUnder(playerPos);
    if (!t) { toast('No tile here.', 'warn'); return { ok: false }; }
    const key = parcelKey(floor, t.ti, t.tj);
    if (!safe(() => economy.ownsParcel(key), false)) {
      toast('You must own this tile to build.', 'warn');
      return { ok: false };
    }

    if (pending.kind === 'game') {
      // one game per tile
      if (gamesOnTile(key, t.ti, t.tj).length > 0) {
        toast('A game is already on this tile.', 'warn');
        return { ok: false };
      }
      const def = gameDef(pending.type);
      if (!def) { toast('Unknown game.', 'warn'); return { ok: false }; }
      const cost = Number(def.cost) || 0;
      const config = Object.assign({}, def.mechanics);
      const res = safe(() => economy.addGame(key, pending.type, cost, {
        tile: [t.ti, t.tj], rot: ghostRot, config,
      }), { ok: false, reason: 'error' });
      if (res && res.ok) {
        const idx = (res.index != null) ? res.index : (gamesOnTile(key, t.ti, t.tj).length - 1);
        spawnGame(key, idx, { type: pending.type, tile: [t.ti, t.tj], rot: ghostRot, config });
        toast(`${def.name} placed (−${cost} 🪙)`, 'good');
        return res;
      }
      toast((res && res.reason) ? res.reason : 'Could not place game.', 'warn');
      return res || { ok: false };
    }

    // decor
    const def = decorDef(pending.type);
    if (!def) { toast('Unknown decoration.', 'warn'); return { ok: false }; }
    const cost = Number(def.cost) || 0;
    const res = safe(() => economy.addDecor(key, pending.type,
      { tile: [t.ti, t.tj], rot: ghostRot }, cost), { ok: false, reason: 'error' });
    if (res && res.ok) {
      const idx = (res.index != null)
        ? res.index
        : ((safe(() => economy.getDecor(key), []) || []).length - 1);
      spawnDecor(key, idx, { id: pending.type, tile: [t.ti, t.tj], rot: ghostRot });
      toast(`${def.name} placed (−${cost} 🪙)`, 'good');
      return res;
    }
    toast((res && res.reason) ? res.reason : 'Could not place decoration.', 'warn');
    return res || { ok: false };
  }

  // -----------------------------------------------------------------
  // Removal
  // -----------------------------------------------------------------
  // Find the registry node nearest to a world point, optionally on a tile.
  function nearestNode(point, kindFilter, tile) {
    let best = null, bestD = Infinity;
    for (const [node, meta] of registry) {
      if (kindFilter && meta.kind !== kindFilter) continue;
      if (tile) {
        const t = safe(() => tileFromWorld(node.position.x, node.position.z), null);
        if (!t || t.ti !== tile.ti || t.tj !== tile.tj) continue;
      }
      const dx = node.position.x - point.x;
      const dz = node.position.z - point.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { node, meta, dist: Math.sqrt(d) }; }
    }
    return best;
  }

  function despawnNode(node) {
    removeCollider(node);
    root.remove(node);
    const meta = registry.get(node);
    if (meta) spawned.delete(spawnTag(meta.kind, meta.key, meta.index));
    registry.delete(node);
  }

  // After an economy splice, indices shift. Easiest robust approach:
  // drop every spawned prop for that key+kind and let refresh() rebuild.
  function resyncKey(key, kind) {
    for (const [node, meta] of Array.from(registry)) {
      if (meta.key === key && meta.kind === kind) despawnNode(node);
    }
    refresh();
  }

  function removeUnderPlayer(playerPos) {
    const t = tileUnder(playerPos);
    if (!t) { toast('No tile here.', 'warn'); return false; }
    const key = parcelKey(floor, t.ti, t.tj);
    if (!safe(() => economy.ownsParcel(key), false)) {
      toast('You don’t own this tile.', 'warn');
      return false;
    }
    const px = (playerPos && playerPos.x) || 0;
    const pz = (playerPos && playerPos.z) || 0;
    const hit = nearestNode({ x: px, z: pz }, null, t);
    if (!hit) { toast('Nothing here to remove.', 'warn'); return false; }
    const { meta } = hit;
    let ok = false;
    if (meta.kind === 'game') ok = safe(() => economy.removeGame(meta.key, meta.index), false);
    else ok = safe(() => economy.removeDecor(meta.key, meta.index), false);
    if (ok) {
      resyncKey(meta.key, meta.kind);
      toast('Removed.', 'good');
      return true;
    }
    toast('Could not remove.', 'warn');
    return false;
  }

  // -----------------------------------------------------------------
  // Nearest queries (for interaction prompts)
  // -----------------------------------------------------------------
  function nearestOfKind(playerPos, kind) {
    if (!playerPos) return null;
    const hit = nearestNode({ x: playerPos.x, z: playerPos.z }, kind, null);
    if (!hit || hit.dist > PICK_RANGE) return null;
    const meta = hit.meta;
    let config = null;
    if (kind === 'game') {
      const gs = safe(() => economy.getGames(meta.key), []) || [];
      const g = gs[meta.index];
      config = (g && g.config) || (gameDef(meta.type) && Object.assign({}, gameDef(meta.type).mechanics)) || {};
    }
    return { type: meta.type, key: meta.key, index: meta.index, config };
  }

  function nearestGame(playerPos)  { return nearestOfKind(playerPos, 'game'); }
  function nearestDecor(playerPos) {
    const r = nearestOfKind(playerPos, 'decor');
    if (!r) return null;
    return { type: r.type, key: r.key, index: r.index, config: null };
  }

  // -----------------------------------------------------------------
  // Context prompt
  // -----------------------------------------------------------------
  function getPrompt(playerPos) {
    // Build mode takes priority.
    if (pending) {
      const t = tileUnder(playerPos);
      if (!t) return '';
      const key = parcelKey(floor, t.ti, t.tj);
      if (!safe(() => economy.ownsParcel(key), false)) return '';
      if (pending.kind === 'game' && gamesOnTile(key, t.ti, t.tj).length > 0) {
        return 'Tile occupied — [R] rotate';
      }
      return 'Place here: [F]  ·  rotate [R]  ·  exit [G]';
    }

    // Near a placed game → sit & play / edit.
    const ng = nearestGame(playerPos);
    if (ng) {
      const def = gameDef(ng.type);
      const name = (def && def.name) || 'Game';
      return `${name}: [E] Sit & Play  ·  [R] Edit`;
    }

    // Standing on a tile → buy / place.
    const t = tileUnder(playerPos);
    if (!t) return '';
    const key = parcelKey(floor, t.ti, t.tj);
    const owned = safe(() => economy.ownsParcel(key), false);
    if (owned) {
      const empty = gamesOnTile(key, t.ti, t.tj).length === 0;
      if (empty) return 'Your parcel — [B] build menu';
      return 'Your parcel';
    }
    if (safe(() => isBuildableTile(floor, t.ti, t.tj), false)) {
      const price = safe(() => economy.parcelPrice(floor), 0);
      return `[B] Buy parcel — ${price} 🪙`;
    }
    return '';
  }

  // -----------------------------------------------------------------
  // Interaction passthroughs (main wires these, but expose convenience)
  // -----------------------------------------------------------------
  function playNearest(playerPos) {
    const ng = nearestGame(playerPos);
    if (!ng) return false;
    safe(() => hooks.onPlay && hooks.onPlay(ng.type, ng.key, ng.index, ng.config));
    return true;
  }
  function editNearest(playerPos) {
    const ng = nearestGame(playerPos);
    if (!ng) return false;
    safe(() => hooks.onEdit && hooks.onEdit(ng.type, ng.key, ng.index, ng.config));
    return true;
  }

  // -----------------------------------------------------------------
  // Wrap stage.update so the highlight tracks the player without main
  // having to call api.update explicitly (api.update still works too).
  // -----------------------------------------------------------------
  const prevUpdate = (typeof stage.update === 'function')
    ? stage.update.bind(stage)
    : null;
  stage.update = function (dt, ctx) {
    if (prevUpdate) safe(() => prevUpdate(dt, ctx));
    const pos = ctx && ctx.playerPos;
    if (pos) safe(() => update(dt, pos));
  };

  // -----------------------------------------------------------------
  // Teardown
  // -----------------------------------------------------------------
  function dispose() {
    for (const [node] of Array.from(registry)) despawnNode(node);
    clearGhost();
    if (scene && scene.remove) scene.remove(root);
  }

  // Initial population.
  refresh();

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------
  const api = {
    refresh,
    update,
    tryBuyUnderPlayer,
    enterBuildMode,
    exitBuildMode,
    rotateGhost,
    placeUnderPlayer,
    removeUnderPlayer,
    nearestGame,
    nearestDecor,
    getPrompt,
    playNearest,
    editNearest,
    dispose,
    // introspection helpers (handy for main / debugging)
    get currentTile() { return currentTile; },
    get pending() { return pending; },
    isBuildMode() { return !!pending; },
  };
  return api;
}

export default attachParcels;
