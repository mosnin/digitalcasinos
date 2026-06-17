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
// Wave 5: realistic, architectural, NON-boxy upscale casino interior.
// Fluted columns w/ base + capital down the hall, crown molding +
// baseboards + chair-rail wainscoting on the walls, framed artwork, a
// coffered/tray ceiling with recessed warm downlights + cove lighting,
// large area rugs, and walkable marble/hardwood AISLE hallways between
// the carpeted parcel blocks (with columns/planters at intersections).
// A tasteful gilded backlit sign sits over the elevator (no neon).
//
// Never throws on missing data. Reuses geometry/materials where it can.
// =============================================================

import * as THREE from 'three';
import {
  FLOOR, FLOORS, ELEVATOR,
  tileCenter, isBuildableTile, isAisleTile, AISLE,
  inRect, clamp,
} from './config.js';
import * as aesthetics from './aesthetics.js';
import * as venues from './venues.js';

// ----------------------------------------------------------------
// Shared geometry — a single 1×1×1 box reused (scaled) for the slab,
// every perimeter wall, the ceiling and most trim. Cheaper than
// minting a new BoxGeometry per surface on every floor.
// ----------------------------------------------------------------
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

// Half-extents of the floor footprint (X spans [-HX, HX], Z spans [-HZ, HZ]).
const HX = FLOOR.W / 2;   // 60
const HZ = FLOOR.D / 2;   // 42
const WALL_T = 1.2;       // wall thickness (visual + collider)

// ----------------------------------------------------------------
// Shared, lazily-built geometry for repeated architectural pieces.
// One geometry per shape, reused (instanced where it pays off) across
// every floor. Disposing a stage never frees these.
// ----------------------------------------------------------------
let _shared = null;
function shared() {
  if (_shared) return _shared;
  _shared = {
    // Fluted column shaft: many-sided cylinder reads as round + fluted
    // under lighting; slight taper top<bottom for an entasis feel.
    columnShaft: new THREE.CylinderGeometry(0.42, 0.46, 1, 16, 1, false),
    columnBase:  new THREE.CylinderGeometry(0.62, 0.7, 1, 16),
    columnCap:   new THREE.CylinderGeometry(0.68, 0.5, 1, 16),
    // Planter (round tapered pot) + a soft greenery blob.
    planterPot:  new THREE.CylinderGeometry(0.55, 0.42, 1, 14),
    foliage:     new THREE.SphereGeometry(0.6, 10, 8),
    // Recessed ceiling downlight emitter disc.
    downlight:   new THREE.CircleGeometry(0.34, 16),
    // Coffer rim torus (thin) reused for the tray-ceiling panels' inner ring.
    cofferRim:   new THREE.TorusGeometry(1.0, 0.06, 6, 20),
  };
  return _shared;
}

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

// Static-mesh tag: helps the integrator skip these in any animation pass.
function staticMesh(m) {
  m.userData.animated = false;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

// Defensive: build a Box3 from a center + half-extents.
function box3FromCenter(cx, cy, cz, hx, hy, hz) {
  return new THREE.Box3(
    new THREE.Vector3(cx - hx, cy - hy, cz - hz),
    new THREE.Vector3(cx + hx, cy + hy, cz + hz),
  );
}

// Cached themed material, swallowing any failure into a neutral fallback.
function safeMat(kind, floorDef) {
  try { return aesthetics.material(kind, floorDef); }
  catch (e) { return new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 }); }
}

// Is a tile center inside one of this floor's hall rects?
function tileInHall(floorDef, ti, tj) {
  const halls = (floorDef && Array.isArray(floorDef.halls)) ? floorDef.halls : [];
  if (!halls.length) return false;
  const c = tileCenter(ti, tj);
  for (const h of halls) if (inRect(c.x, c.z, h)) return true;
  return false;
}

// Is this tile index an "aisle index" on a given axis? (mirrors config.AISLE)
function isAisleIndex(n) {
  const p = (AISLE && AISLE.period) || 3;
  const off = (AISLE && AISLE.offset) || 2;
  return (((n % p) + p) % p) === off;
}

// ----------------------------------------------------------------
// Architectural detail builders. Each adds meshes to `scene` (and may
// push wall/feature colliders). All are wrapped by buildStage in
// try/catch so a single failure can never break the floor.
// ----------------------------------------------------------------

// Crown molding + baseboard rails hugging all four walls. A few thin,
// slightly-inset bevel boxes so the big wall planes don't read as cubes.
function addWallTrim(scene, floorDef) {
  const brass = safeMat('brass', floorDef);
  const wood  = safeMat('wood', floorDef);
  const marble = safeMat('marble', floorDef);

  const innerX = HX - WALL_T;   // wall inner face on X
  const innerZ = HZ - WALL_T;   // wall inner face on Z
  const spanX = FLOOR.W - 2 * WALL_T;
  const spanZ = FLOOR.D - 2 * WALL_T;

  // ---- Baseboards (dark wood) at the foot of each wall ----
  const baseH = 0.45, baseT = 0.18, baseY = baseH / 2;
  scene.add(staticMesh(boxMesh(wood, spanX, baseH, baseT, 0, baseY,  innerZ - baseT / 2)));
  scene.add(staticMesh(boxMesh(wood, spanX, baseH, baseT, 0, baseY, -innerZ + baseT / 2)));
  scene.add(staticMesh(boxMesh(wood, baseT, baseH, spanZ,  innerX - baseT / 2, baseY, 0)));
  scene.add(staticMesh(boxMesh(wood, baseT, baseH, spanZ, -innerX + baseT / 2, baseY, 0)));

  // ---- Chair-rail / wainscoting band (marble panel + brass rail) ----
  const wainTop = 1.45;       // top of wainscot
  const wainH = wainTop - baseH;
  const wainCY = baseH + wainH / 2;
  const wainT = 0.12;
  scene.add(staticMesh(boxMesh(marble, spanX, wainH, wainT, 0, wainCY,  innerZ - wainT / 2)));
  scene.add(staticMesh(boxMesh(marble, spanX, wainH, wainT, 0, wainCY, -innerZ + wainT / 2)));
  scene.add(staticMesh(boxMesh(marble, wainT, wainH, spanZ,  innerX - wainT / 2, wainCY, 0)));
  scene.add(staticMesh(boxMesh(marble, wainT, wainH, spanZ, -innerX + wainT / 2, wainCY, 0)));
  // brass chair-rail cap atop the wainscot
  const railT = 0.22, railH = 0.1, railY = wainTop;
  scene.add(staticMesh(boxMesh(brass, spanX, railH, railT, 0, railY,  innerZ - railT / 2)));
  scene.add(staticMesh(boxMesh(brass, spanX, railH, railT, 0, railY, -innerZ + railT / 2)));
  scene.add(staticMesh(boxMesh(brass, railT, railH, spanZ,  innerX - railT / 2, railY, 0)));
  scene.add(staticMesh(boxMesh(brass, railT, railH, spanZ, -innerX + railT / 2, railY, 0)));

  // ---- Crown molding (brass, just under the ceiling) ----
  const crownH = 0.5, crownT = 0.4, crownY = FLOOR.H - crownH / 2 - 0.05;
  scene.add(staticMesh(boxMesh(brass, spanX, crownH, crownT, 0, crownY,  innerZ - crownT / 2)));
  scene.add(staticMesh(boxMesh(brass, spanX, crownH, crownT, 0, crownY, -innerZ + crownT / 2)));
  scene.add(staticMesh(boxMesh(brass, crownT, crownH, spanZ,  innerX - crownT / 2, crownY, 0)));
  scene.add(staticMesh(boxMesh(brass, crownT, crownH, spanZ, -innerX + crownT / 2, crownY, 0)));
}

// Framed artwork along the long (north/south) walls. Each frame is a
// thin brass rectangle with an emissive "canvas" tinted to the accent.
function addFramedArt(scene, floorDef) {
  const brass = safeMat('brass', floorDef);
  const accent = (floorDef && floorDef.accent != null) ? floorDef.accent : 0xffd23f;
  // Soft, low-emissive painted canvas (warm, not glowing).
  const canvasMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accent).lerp(new THREE.Color(0x2a221a), 0.55).getHex(),
    emissive: accent,
    emissiveIntensity: 0.06,
    roughness: 0.85,
    metalness: 0.0,
  });

  const innerZ = HZ - WALL_T - 0.02;
  const artY = 3.2;
  const fw = 2.4, fh = 1.6, frameT = 0.12, depth = 0.12;
  const xs = [-38, -19, 19, 38];
  for (const x of xs) {
    for (const sign of [1, -1]) {
      const z = sign * innerZ;
      const g = new THREE.Group();
      // frame (slightly larger box behind the canvas)
      const frame = boxMesh(brass, fw + frameT * 2, fh + frameT * 2, depth, 0, 0, 0);
      const art = boxMesh(canvasMat, fw, fh, depth * 0.6, 0, 0, depth * 0.3 * sign);
      g.add(staticMesh(frame), staticMesh(art));
      g.position.set(x, artY, z);
      g.rotation.y = (sign > 0) ? Math.PI : 0; // face inward
      g.userData.animated = false;
      scene.add(g);
    }
  }
}

// Rows of fluted columns marching down the long axis of the floor, set
// just inside the long walls so they frame the central aisle without
// blocking it. Built as instanced meshes (shaft/base/cap) + per-column
// thin colliders. Returns the count placed.
function addColumnRows(scene, floorDef, colliders) {
  const s = shared();
  const brass = safeMat('brass', floorDef);
  const marble = safeMat('marble', floorDef);

  // Column placement: two rows along Z near the side walls.
  const rowX = [-(HX - 8), (HX - 8)];
  const startZ = -HZ + 10, endZ = HZ - 10;
  const stepZ = 12;
  const positions = [];
  for (const x of rowX) {
    for (let z = startZ; z <= endZ + 0.001; z += stepZ) {
      // skip columns that would sit inside the elevator alcove
      if (Math.abs(x - ELEVATOR.x) < ELEVATOR.w && z > HZ - 12) continue;
      positions.push({ x, z });
    }
  }
  const n = positions.length;
  if (!n) return 0;

  const shaftH = FLOOR.H - 1.0;       // leave room for base + cap
  const baseH = 0.4, capH = 0.45;
  const shafts = new THREE.InstancedMesh(s.columnShaft, marble, n);
  const bases  = new THREE.InstancedMesh(s.columnBase, brass, n);
  const caps   = new THREE.InstancedMesh(s.columnCap, brass, n);
  shafts.userData.animated = bases.userData.animated = caps.userData.animated = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let i = 0;
  for (const p of positions) {
    // shaft
    v.set(p.x, baseH + shaftH / 2, p.z); sc.set(1, shaftH, 1);
    m.compose(v, q, sc); shafts.setMatrixAt(i, m);
    // base
    v.set(p.x, baseH / 2, p.z); sc.set(1, baseH, 1);
    m.compose(v, q, sc); bases.setMatrixAt(i, m);
    // capital
    v.set(p.x, baseH + shaftH + capH / 2, p.z); sc.set(1, capH, 1);
    m.compose(v, q, sc); caps.setMatrixAt(i, m);
    i++;
    // collider (slim cylinder approximated by a small box)
    colliders.push(box3FromCenter(p.x, FLOOR.H / 2, p.z, 0.6, FLOOR.H / 2, 0.6));
  }
  shafts.instanceMatrix.needsUpdate = true;
  bases.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  scene.add(shafts, bases, caps);
  return n;
}

// Coffered / tray ceiling: a grid of inset recessed panels (slightly
// raised tray) with a warm emissive downlight disc in each, plus a
// continuous cove-light strip glowing along the wall tops. Adds a few
// soft point lights for actual illumination (kept low count for perf).
function addCofferedCeiling(scene, floorDef) {
  const s = shared();
  const brass = safeMat('brass', floorDef);

  // Tray base: a slightly recessed lighter panel just under the slab.
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.9, metalness: 0.0 });
  const trayInsetX = FLOOR.W - 8, trayInsetZ = FLOOR.D - 8;
  const tray = boxMesh(trayMat, trayInsetX, 0.25, trayInsetZ, 0, FLOOR.H - 0.05, 0);
  scene.add(staticMesh(tray));

  // Coffer grid: brass ribs dividing the tray into recessed panels.
  const cols = 5, rows = 3;
  const cellX = trayInsetX / cols, cellZ = trayInsetZ / rows;
  const ribT = 0.18, ribDrop = 0.35, ribY = FLOOR.H - 0.3;
  // ribs along X
  for (let r = 0; r <= rows; r++) {
    const z = -trayInsetZ / 2 + r * cellZ;
    scene.add(staticMesh(boxMesh(brass, trayInsetX, ribDrop, ribT, 0, ribY, z)));
  }
  // ribs along Z
  for (let c = 0; c <= cols; c++) {
    const x = -trayInsetX / 2 + c * cellX;
    scene.add(staticMesh(boxMesh(brass, ribT, ribDrop, trayInsetZ, x, ribY, 0)));
  }

  // Recessed warm downlight disc in the center of each coffer + a few
  // real point lights (subset, for performance) to actually light the room.
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3da, emissive: 0xffe6b8, emissiveIntensity: 0.9,
    roughness: 0.4, metalness: 0.0,
  });
  const discY = FLOOR.H - 0.4;
  const lights = [];
  let lampIdx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -trayInsetX / 2 + (c + 0.5) * cellX;
      const z = -trayInsetZ / 2 + (r + 0.5) * cellZ;
      const disc = new THREE.Mesh(s.downlight, lampMat);
      disc.position.set(x, discY, z);
      disc.rotation.x = Math.PI / 2; // face down
      staticMesh(disc);
      scene.add(disc);
      // Only a sparse subset get a real PointLight (cap ~6) to stay cheap.
      if (lampIdx % 3 === 0 && lights.length < 6) {
        const pl = new THREE.PointLight(0xffe7c0, 0.9, 26, 2.0);
        pl.position.set(x, discY - 0.4, z);
        scene.add(pl);
        lights.push(pl);
      }
      lampIdx++;
    }
  }

  // Cove lighting: a thin warm emissive strip just below the crown, run
  // along all four walls so the ceiling edge glows softly.
  const coveMat = new THREE.MeshStandardMaterial({
    color: 0x1a1410, emissive: 0xffdfa8, emissiveIntensity: 0.5,
    roughness: 0.6, metalness: 0.0, toneMapped: true,
  });
  const innerX = HX - WALL_T - 0.3, innerZ = HZ - WALL_T - 0.3;
  const coveY = FLOOR.H - 0.85, coveH = 0.12;
  const spanX = FLOOR.W - 2 * (WALL_T + 0.3), spanZ = FLOOR.D - 2 * (WALL_T + 0.3);
  scene.add(staticMesh(boxMesh(coveMat, spanX, coveH, 0.1, 0, coveY,  innerZ)));
  scene.add(staticMesh(boxMesh(coveMat, spanX, coveH, 0.1, 0, coveY, -innerZ)));
  scene.add(staticMesh(boxMesh(coveMat, 0.1, coveH, spanZ,  innerX, coveY, 0)));
  scene.add(staticMesh(boxMesh(coveMat, 0.1, coveH, spanZ, -innerX, coveY, 0)));

  return { lights };
}

// Render the AISLE hallways as marble/hardwood walkway runners (distinct
// from the parcel-block patterned carpet), and drop a column or planter
// at aisle intersections (capped). Returns the number of intersection
// props placed.
function addAisleHallways(scene, floorDef, colliders) {
  const s = shared();
  const marble = safeMat('marble', floorDef);
  const brass = safeMat('brass', floorDef);
  const planterMat = safeMat('wood', floorDef);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e6b2e, roughness: 0.85, metalness: 0.0 });

  const TILE = FLOOR.TILE;
  const runnerY = 0.02;

  // Collect aisle tiles inside halls; batch into a single InstancedMesh of
  // flat tile quads (boxes) for the walkway runner. Build a flat plane geo
  // sized to one tile, reused across instances.
  const aisleTiles = [];
  const interPts = [];
  for (let ti = 0; ti < FLOOR.TX; ti++) {
    for (let tj = 0; tj < FLOOR.TZ; tj++) {
      if (!isAisleTile(ti, tj)) continue;
      if (!tileInHall(floorDef, ti, tj)) continue;
      const c = tileCenter(ti, tj);
      aisleTiles.push(c);
      // intersection = both indices are aisle indices
      if (isAisleIndex(ti) && isAisleIndex(tj)) interPts.push({ c, ti, tj });
    }
  }

  if (aisleTiles.length) {
    const runnerGeo = new THREE.BoxGeometry(TILE, 0.04, TILE);
    const runner = new THREE.InstancedMesh(runnerGeo, marble, aisleTiles.length);
    runner.userData.animated = false;
    runner.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < aisleTiles.length; k++) {
      v.set(aisleTiles[k].x, runnerY, aisleTiles[k].z);
      m.compose(v, q, sc);
      runner.setMatrixAt(k, m);
    }
    runner.instanceMatrix.needsUpdate = true;
    scene.add(runner);

    // Thin brass inlay strips running down each unique aisle column,
    // splitting the marble runner for a real walkway look (cheap: one
    // slim strip per distinct aisle X spanning the floor depth).
    const seenX = new Set();
    const inlaySpan = FLOOR.D - 2 * WALL_T;
    for (const c of aisleTiles) {
      const kx = Math.round(c.x);
      if (seenX.has(kx)) continue;
      seenX.add(kx);
      scene.add(staticMesh(boxMesh(brass, 0.12, 0.02, inlaySpan, c.x, runnerY + 0.03, 0)));
    }
  }

  // Columns / planters at aisle intersections, alternating, capped.
  const MAX_INTER = 16;
  // sample evenly if there are more intersections than the cap
  const stride = Math.max(1, Math.ceil(interPts.length / MAX_INTER));
  let placed = 0;
  for (let idx = 0; idx < interPts.length && placed < MAX_INTER; idx += stride) {
    const { c } = interPts[idx];
    // keep clear of elevator
    if (nearElevator(c.x, c.z)) continue;
    if ((placed % 2) === 0) {
      // fluted accent column
      const shaftH = FLOOR.H - 1.0, baseH = 0.4, capH = 0.45;
      const shaft = new THREE.Mesh(s.columnShaft, marble);
      shaft.scale.set(0.8, shaftH, 0.8);
      shaft.position.set(c.x, baseH + shaftH / 2, c.z);
      const base = new THREE.Mesh(s.columnBase, brass);
      base.scale.set(0.8, baseH, 0.8); base.position.set(c.x, baseH / 2, c.z);
      const cap = new THREE.Mesh(s.columnCap, brass);
      cap.scale.set(0.8, capH, 0.8); cap.position.set(c.x, baseH + shaftH + capH / 2, c.z);
      scene.add(staticMesh(shaft), staticMesh(base), staticMesh(cap));
      colliders.push(box3FromCenter(c.x, FLOOR.H / 2, c.z, 0.55, FLOOR.H / 2, 0.55));
    } else {
      // brass planter with greenery
      const pot = new THREE.Mesh(s.planterPot, brass);
      pot.scale.set(1, 0.9, 1); pot.position.set(c.x, 0.45, c.z);
      const fol = new THREE.Mesh(s.foliage, foliageMat);
      fol.scale.set(1.1, 1.3, 1.1); fol.position.set(c.x, 1.45, c.z);
      scene.add(staticMesh(pot), staticMesh(fol));
      colliders.push(box3FromCenter(c.x, 0.9, c.z, 0.6, 0.9, 0.6));
    }
    placed++;
  }
  return placed;
}

// Large area rugs laid over the carpeted parcel zones to ground the
// space (distinct, classy border rug; sits just above the slab, below
// the aisle runner height so they don't z-fight with walkways).
function addAreaRugs(scene, floorDef) {
  const accent = (floorDef && floorDef.accent != null) ? floorDef.accent : 0xffd23f;
  const carpetHex = (floorDef && floorDef.carpet != null) ? floorDef.carpet : 0x7a1020;
  const fieldMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(carpetHex).lerp(new THREE.Color(0x000000), 0.25).getHex(),
    roughness: 0.97, metalness: 0.0,
  });
  const borderMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accent).lerp(new THREE.Color(0x3a2a10), 0.3).getHex(),
    roughness: 0.9, metalness: 0.05,
  });

  // A couple of broad rugs in the open zones flanking the central aisle.
  const rugs = [
    { x: -32, z: 0, w: 30, d: 34 },
    { x: 32, z: 0, w: 30, d: 34 },
  ];
  const rugY = 0.012; // below aisle runner (0.02)
  for (const r of rugs) {
    const border = boxMesh(borderMat, r.w, 0.03, r.d, r.x, rugY, r.z);
    const field = boxMesh(fieldMat, r.w - 2.4, 0.035, r.d - 2.4, r.x, rugY + 0.004, r.z);
    border.receiveShadow = field.receiveShadow = true;
    scene.add(staticMesh(border), staticMesh(field));
  }
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

  // -- Floor slab (patterned carpet on the parcel blocks) -------------------
  const carpetMat = safeMat('carpet', floorDef);
  const slab = boxMesh(carpetMat, FLOOR.W, 0.4, FLOOR.D, 0, -0.2, 0);
  slab.receiveShadow = true;
  scene.add(staticMesh(slab));

  // -- Ceiling slab (above the coffered tray) -------------------------------
  const ceilMat = safeMat('ceiling', floorDef);
  const ceiling = boxMesh(ceilMat, FLOOR.W, 0.4, FLOOR.D, 0, FLOOR.H + 0.2, 0);
  scene.add(staticMesh(ceiling));

  // -- Four perimeter walls (enclose the floor) -----------------------------
  // Walls are centered just inside the footprint edge; colliders are thin
  // Box3 slabs along each edge so the player can't walk out.
  const wallMat = safeMat('wall', floorDef);
  const wallH = FLOOR.H;
  const wallCY = FLOOR.H / 2;

  // North (+Z) and South (-Z): run full width along X.
  const northZ = HZ - WALL_T / 2;
  const southZ = -HZ + WALL_T / 2;
  scene.add(staticMesh(boxMesh(wallMat, FLOOR.W, wallH, WALL_T, 0, wallCY, northZ)));
  scene.add(staticMesh(boxMesh(wallMat, FLOOR.W, wallH, WALL_T, 0, wallCY, southZ)));

  // East (+X) and West (-X): run full depth along Z.
  const eastX = HX - WALL_T / 2;
  const westX = -HX + WALL_T / 2;
  scene.add(staticMesh(boxMesh(wallMat, WALL_T, wallH, FLOOR.D, eastX, wallCY, 0)));
  scene.add(staticMesh(boxMesh(wallMat, WALL_T, wallH, FLOOR.D, westX, wallCY, 0)));

  // Wall colliders (thin slabs hugging each edge, slightly tall).
  colliders.push(box3FromCenter(0, wallCY, northZ, HX, wallH, WALL_T / 2));
  colliders.push(box3FromCenter(0, wallCY, southZ, HX, wallH, WALL_T / 2));
  colliders.push(box3FromCenter(eastX, wallCY, 0, WALL_T / 2, wallH, HZ));
  colliders.push(box3FromCenter(westX, wallCY, 0, WALL_T / 2, wallH, HZ));

  // -- Architectural detail (never breaks the floor on failure) -------------
  let ceilingRig = { lights: [] };
  try { addWallTrim(scene, floorDef); } catch (e) {}
  try { addFramedArt(scene, floorDef); } catch (e) {}
  try { addAreaRugs(scene, floorDef); } catch (e) {}
  try { addColumnRows(scene, floorDef, colliders); } catch (e) {}
  try { addAisleHallways(scene, floorDef, colliders); } catch (e) {}
  try { ceilingRig = addCofferedCeiling(scene, floorDef) || ceilingRig; } catch (e) {}

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

  // -- Gilded backlit sign over the elevator (tasteful, no neon) ------------
  // Still routed through aesthetics.makeNeonSign (now a classy backlit sign).
  try {
    const signColor = (floorDef.accent != null) ? floorDef.accent : 0xffd23f; // warm gold
    const sign = aesthetics.makeNeonSign(floorDef.name || `Floor ${i}`, signColor, { size: 1.2 });
    if (sign) {
      // Sit it high on the +Z wall, just over the elevator alcove, facing in.
      sign.position.set(ELEVATOR.x, FLOOR.H - 1.7, HZ - WALL_T - 0.4);
      sign.rotation.y = Math.PI; // face into the room (toward -Z)
      sign.userData.animated = false;
      scene.add(sign);
    }
  } catch (e) { /* sign optional */ }

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
    spawn: { x: ELEVATOR.x, z: ELEVATOR.z - 6, heading: 0 }, // heading 0 faces -Z, into the gaming floor
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
    _ceilingLights: ceilingRig.lights || [],
  };

  return stage;
}

// ----------------------------------------------------------------
// Dispose a built scene: free geometries/materials/textures and run
// any lighting/venue cleanup. Shared resources (UNIT_BOX, shared
// architectural geometry, cached aesthetics materials) are intentionally
// NOT disposed here.
// ----------------------------------------------------------------
function disposeStage(stage) {
  if (!stage) return;
  // Run venue/lighting disposers first (they may detach lights, restore fog).
  if (Array.isArray(stage._disposers)) {
    for (const fn of stage._disposers) { try { fn(); } catch (e) {} }
    stage._disposers.length = 0;
  }
  const sharedGeos = _shared
    ? new Set(Object.values(_shared))
    : new Set();
  if (stage.scene && stage.scene.traverse) {
    stage.scene.traverse((obj) => {
      // Geometry: skip the shared unit box + shared architectural geos
      // (reused across all floors). Per-floor geometry (instanced runners,
      // rugs, frames, etc.) is freed.
      if (obj.geometry && obj.geometry !== UNIT_BOX && !sharedGeos.has(obj.geometry)) {
        try { obj.geometry.dispose(); } catch (e) {}
      }
      // Materials: cached aesthetics materials are shared; we only dispose
      // ones positively created per-floor (no reliable flag → leave shared
      // ones to the cache). InstancedMesh instance buffers free w/ geometry.
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
