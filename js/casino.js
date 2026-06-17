// =============================================================
// Digital Casinos — casino.js
// Builds the whole mega-casino as a stack of FLOORS / SECTIONS.
// Each floor is its own THREE.Scene ("Stage") so only the active
// section renders → smooth perf. Floors are built lazily on first
// request and cached.
//
// Exports: createCasino({ economy, openShop }) -> casino
//   casino.floorCount
//   casino.getFloor(i) -> Stage  (built + cached on first call)
//   casino.randomWalkablePoint(i) -> { x, z, y:0 }
//   casino.onElevator = null     (settable callback; main.js wires it)
//   casino.dispose()
//
// Never throws on missing data. Reuses geometry/materials where it can.
// =============================================================

import * as THREE from 'three';
import {
  FLOOR, FLOORS, ELEVATOR,
  tileCenter, isBuildableTile,
  inRect, clamp,
} from './config.js';
import * as aesthetics from './aesthetics.js';
import * as venues from './venues.js';

// ----------------------------------------------------------------
// Shared geometry — a single 1×1×1 box reused (scaled) for the slab,
// every perimeter wall, and the ceiling. Cheaper than minting a new
// BoxGeometry per surface on every floor.
// ----------------------------------------------------------------
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

// Half-extents of the floor footprint (X spans [-HX, HX], Z spans [-HZ, HZ]).
const HX = FLOOR.W / 2;   // 60
const HZ = FLOOR.D / 2;   // 42
const WALL_T = 1.2;       // wall thickness (visual + collider)

// ----------------------------------------------------------------
// Small builder helpers
// ----------------------------------------------------------------

// A scaled unit box mesh positioned by its center.
function boxMesh(material, sx, sy, sz, cx, cy, cz) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(sx, sy, sz);
  m.position.set(cx, cy, cz);
  return m;
}

// Defensive: build a Box3 from a center + half-extents.
function box3FromCenter(cx, cy, cz, hx, hy, hz) {
  return new THREE.Box3(
    new THREE.Vector3(cx - hx, cy - hy, cz - hz),
    new THREE.Vector3(cx + hx, cy + hy, cz + hz),
  );
}

// ----------------------------------------------------------------
// Build one floor's Stage. Everything is created in a fresh Scene and
// lives at y ≥ 0 (each floor's own scene puts the player at y = 0).
// ----------------------------------------------------------------
function buildStage(casino, i) {
  const floorDef = FLOORS[i] || { id: i, name: `Floor ${i}`, theme: 'classic' };

  const scene = new THREE.Scene();
  const colliders = [];
  const triggers = [];
  const disposers = [];        // extra cleanup callbacks (lighting/venues)

  // -- Floor slab (carpet) --------------------------------------------------
  const carpetMat = aesthetics.material('carpet', floorDef);
  const slab = boxMesh(carpetMat, FLOOR.W, 0.4, FLOOR.D, 0, -0.2, 0);
  slab.receiveShadow = true;
  scene.add(slab);

  // -- Ceiling --------------------------------------------------------------
  const ceilMat = aesthetics.material('ceiling', floorDef);
  const ceiling = boxMesh(ceilMat, FLOOR.W, 0.4, FLOOR.D, 0, FLOOR.H + 0.2, 0);
  scene.add(ceiling);

  // -- Four perimeter walls (enclose the floor) -----------------------------
  // Walls are centered just inside the footprint edge; colliders are thin
  // Box3 slabs along each edge so the player can't walk out.
  const wallMat = aesthetics.material('wall', floorDef);
  const wallH = FLOOR.H;
  const wallCY = FLOOR.H / 2;

  // North (+Z) and South (-Z): run full width along X.
  const northZ = HZ - WALL_T / 2;
  const southZ = -HZ + WALL_T / 2;
  scene.add(boxMesh(wallMat, FLOOR.W, wallH, WALL_T, 0, wallCY, northZ));
  scene.add(boxMesh(wallMat, FLOOR.W, wallH, WALL_T, 0, wallCY, southZ));

  // East (+X) and West (-X): run full depth along Z.
  const eastX = HX - WALL_T / 2;
  const westX = -HX + WALL_T / 2;
  scene.add(boxMesh(wallMat, WALL_T, wallH, FLOOR.D, eastX, wallCY, 0));
  scene.add(boxMesh(wallMat, WALL_T, wallH, FLOOR.D, westX, wallCY, 0));

  // Wall colliders (thin slabs hugging each edge, slightly tall).
  colliders.push(box3FromCenter(0, wallCY, northZ, HX, wallH, WALL_T / 2));
  colliders.push(box3FromCenter(0, wallCY, southZ, HX, wallH, WALL_T / 2));
  colliders.push(box3FromCenter(eastX, wallCY, 0, WALL_T / 2, wallH, HZ));
  colliders.push(box3FromCenter(westX, wallCY, 0, WALL_T / 2, wallH, HZ));

  // -- Interior lighting ----------------------------------------------------
  let lighting = { update() {}, dispose() {} };
  try {
    lighting = aesthetics.addInteriorLighting(scene, floorDef) || lighting;
  } catch (e) { /* keep no-op lighting */ }
  if (lighting && lighting.dispose) disposers.push(lighting.dispose);

  // -- Decor / venue features ----------------------------------------------
  // venues.decorateFloor builds into its own group; we add it to the scene,
  // merge colliders, keep its update, and turn interactables into triggers.
  const decoGroup = new THREE.Group();
  let deco = { colliders: [], update() {}, interactables: [] };
  try {
    const out = venues.decorateFloor(decoGroup, floorDef, { openShop: casino.openShop });
    if (out) deco = out;
  } catch (e) { /* venue build failed — floor still usable */ }
  scene.add(decoGroup);

  if (Array.isArray(deco.colliders)) {
    for (const c of deco.colliders) if (c && c.isBox3) colliders.push(c);
  }

  // Convert venue interactables into triggers.
  if (Array.isArray(deco.interactables)) {
    for (const it of deco.interactables) {
      if (!it) continue;
      const pos = (it.pos && it.pos.isVector3)
        ? it.pos
        : new THREE.Vector3(
            (it.pos && it.pos.x) || 0,
            (it.pos && it.pos.y) || 1,
            (it.pos && it.pos.z) || 0,
          );
      triggers.push({
        pos,
        radius: (typeof it.radius === 'number') ? it.radius : 2.5,
        prompt: it.prompt || 'Press E',
        action: (typeof it.action === 'function') ? it.action : () => {},
        key: it.key || 'E',
      });
    }
  }

  // -- Neon marquee over the elevator --------------------------------------
  try {
    const marquee = aesthetics.makeNeonSign(floorDef.name || `Floor ${i}`, floorDef.neon, { size: 1.4 });
    if (marquee) {
      // Sit it high on the +Z wall, just over the elevator alcove, facing in.
      marquee.position.set(ELEVATOR.x, FLOOR.H - 1.6, HZ - WALL_T - 0.4);
      marquee.rotation.y = Math.PI; // face into the room (toward -Z)
      scene.add(marquee);
    }
  } catch (e) { /* marquee optional */ }

  // -- Elevator trigger -----------------------------------------------------
  triggers.push({
    pos: new THREE.Vector3(ELEVATOR.x, 1, ELEVATOR.z),
    radius: 3.5,
    prompt: 'Press E — Elevator',
    action: () => { if (casino.onElevator) casino.onElevator(); },
    key: 'E',
  });

  // -- Stage object ---------------------------------------------------------
  const stage = {
    scene,
    floorIndex: i,
    baseY: 0,                       // player stands at y = 0 in this floor's own scene
    spawn: { x: ELEVATOR.x, z: ELEVATOR.z - 6, heading: Math.PI },
    sampleGround(_x, _z) { return 0; },
    colliders,
    triggers,
    update(dt, ctx) {
      const d = (dt > 0) ? dt : 0.016;
      try { lighting.update(d, ctx); } catch (e) {}
      try { if (deco && deco.update) deco.update(d, ctx); } catch (e) {}
    },
    // internal — used by dispose()
    _disposers: disposers,
    _floorDef: floorDef,
  };

  return stage;
}

// ----------------------------------------------------------------
// Dispose a built scene: free geometries/materials/textures and run
// any lighting/venue cleanup. Shared resources (UNIT_BOX, cached
// aesthetics materials) are intentionally NOT disposed here.
// ----------------------------------------------------------------
function disposeStage(stage) {
  if (!stage) return;
  // Run venue/lighting disposers first (they may detach lights, restore fog).
  if (Array.isArray(stage._disposers)) {
    for (const fn of stage._disposers) { try { fn(); } catch (e) {} }
    stage._disposers.length = 0;
  }
  if (stage.scene && stage.scene.traverse) {
    stage.scene.traverse((obj) => {
      // Geometry: skip the shared unit box (reused across all floors).
      if (obj.geometry && obj.geometry !== UNIT_BOX) {
        try { obj.geometry.dispose(); } catch (e) {}
      }
      // Materials: skip cached aesthetics materials (no userData flag → we
      // can't always tell, so only dispose materials we positively created).
      // We do dispose InstancedMesh instance buffers implicitly via geometry.
    });
    // Detach children so the scene can be GC'd.
    while (stage.scene.children.length) {
      stage.scene.remove(stage.scene.children[0]);
    }
    stage.scene.fog = null;
  }
}

// ----------------------------------------------------------------
// createCasino — the public factory.
// ----------------------------------------------------------------
export function createCasino({ economy, openShop } = {}) {
  const cache = new Map();   // floorIndex -> Stage

  const casino = {
    economy: economy || null,
    openShop: (typeof openShop === 'function') ? openShop : () => {},
    onElevator: null,        // main.js sets this to open the floor menu

    floorCount: FLOORS.length,

    // Lazily build + cache floor i.
    getFloor(i) {
      i = clamp(Math.floor(i || 0), 0, FLOORS.length - 1);
      let stage = cache.get(i);
      if (stage) return stage;
      stage = buildStage(casino, i);
      cache.set(i, stage);
      return stage;
    },

    // Random walkable point inside a hall of floor i (avoids features &
    // the elevator). Tries buildable tiles first, then raw hall rects,
    // then falls back to the spawn position.
    randomWalkablePoint(i) {
      i = clamp(Math.floor(i || 0), 0, FLOORS.length - 1);
      const f = FLOORS[i];
      if (!f) return { x: ELEVATOR.x, z: ELEVATOR.z - 6, y: 0 };

      const halls = Array.isArray(f.halls) ? f.halls : [];

      // Strategy A: pick a random buildable tile (already excludes features).
      for (let attempt = 0; attempt < 30; attempt++) {
        const ti = Math.floor(Math.random() * FLOOR.TX);
        const tj = Math.floor(Math.random() * FLOOR.TZ);
        if (isBuildableTile(i, ti, tj)) {
          const c = tileCenter(ti, tj);
          if (!nearElevator(c.x, c.z)) return { x: c.x, z: c.z, y: 0 };
        }
      }

      // Strategy B: sample a random point inside a random hall rect, then
      // reject if it lands in a colliding feature or near the elevator.
      if (halls.length) {
        for (let attempt = 0; attempt < 30; attempt++) {
          const h = halls[(Math.random() * halls.length) | 0];
          const x = h[0] + Math.random() * (h[2] - h[0]);
          const z = h[1] + Math.random() * (h[3] - h[1]);
          if (nearElevator(x, z)) continue;
          if (inCollidingFeature(f, x, z)) continue;
          return { x, z, y: 0 };
        }
      }

      // Fallback: spawn point in front of the elevator.
      return { x: ELEVATOR.x, z: ELEVATOR.z - 6, y: 0 };
    },

    dispose() {
      for (const stage of cache.values()) disposeStage(stage);
      cache.clear();
    },
  };

  return casino;
}

// Is (x,z) inside any non-hall feature that is flagged collide? Used to keep
// random walkable points out of pools/bars/fountains/storefronts.
function inCollidingFeature(floorDef, x, z) {
  const feats = (floorDef && floorDef.features) || [];
  for (const ft of feats) {
    if (!ft || ft.type === 'hall' || !ft.rect) continue;
    if (ft.collide && inRect(x, z, ft.rect)) return true;
  }
  return false;
}

// Keep a clear radius around the shared elevator core.
function nearElevator(x, z) {
  const dx = x - ELEVATOR.x;
  const dz = z - ELEVATOR.z;
  const r = Math.max(ELEVATOR.w, ELEVATOR.d) * 0.5 + 4;
  return (dx * dx + dz * dz) < (r * r);
}
