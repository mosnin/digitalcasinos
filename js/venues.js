// =============================================================
// Digital Casinos — venues.js
// Decorates a floor group with its "features" (pools, bars,
// fountains, halls, windows, elevators, and the Promenade venues:
// gift shops, restaurants, theaters). Called by casino.js once per
// floor; returns solid colliders + interactable prompts + an update
// hook that animates water, seated patrons, and sign pulses.
//
// Conventions: the floor group's origin is the floor's local origin
// and matches world XZ (floor spans are centered on (0,0)), so the
// rects in floorDef.features ([x0,z0,x1,z1] world coords) can be used
// directly as group-local coords. Floor ground is y=0 in the group.
//
// Pure decoration helpers — never throw on missing data, reuse
// geometry/materials wherever practical.
// =============================================================
import * as THREE from 'three';
import { COLORS, box3FromRect } from './config.js';
import {
  material, neonMaterial, makeNeonSign, makeChandelier, makeWindowSkyline,
} from './aesthetics.js';
import { makeDealer } from './characters.js';

// ----------------------------------------------------------------
// Small geometry/material cache (shared across every floor we build).
// ----------------------------------------------------------------
const _geo = new Map();
function geo(key, make) { let g = _geo.get(key); if (!g) { g = make(); _geo.set(key, g); } return g; }

const _mat = new Map();
function mat(key, make) { let m = _mat.get(key); if (!m) { m = make(); _mat.set(key, m); } return m; }

// A few plain shared materials.
function chromeMat() { return mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xcdd2d8, roughness: 0.25, metalness: 0.95 })); }
function darkMetalMat() { return mat('darkmetal', () => new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.5, metalness: 0.8 })); }
function cushionMat() { return mat('cushion', () => new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, metalness: 0.0 })); }
function leatherMat(hex) { return mat('leather_' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.1 })); }
function feltMat() { return mat('felt', () => new THREE.MeshStandardMaterial({ color: 0x0c5c2e, roughness: 0.95, metalness: 0.0 })); }

// ----------------------------------------------------------------
// rect helpers
// ----------------------------------------------------------------
function rectOf(f) {
  const r = (f && f.rect) || [-1, -1, 1, 1];
  const x0 = Math.min(r[0], r[2]), z0 = Math.min(r[1], r[3]);
  const x1 = Math.max(r[0], r[2]), z1 = Math.max(r[1], r[3]);
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

function box3(r, y0, y1) {
  // tolerate min/max swaps for the collider too
  const x0 = Math.min(r[0], r[2]), z0 = Math.min(r[1], r[3]);
  const x1 = Math.max(r[0], r[2]), z1 = Math.max(r[1], r[3]);
  return box3FromRect([x0, z0, x1, z1], y0, y1);
}

// ----------------------------------------------------------------
// Generic small props
// ----------------------------------------------------------------
function makePottedPlant() {
  const g = new THREE.Group();
  const potGeo = geo('plantPot', () => new THREE.CylinderGeometry(0.26, 0.32, 0.42, 12));
  const pot = new THREE.Mesh(potGeo, mat('plantPot', () => new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8, metalness: 0.1 })));
  pot.position.y = 0.21;
  g.add(pot);
  const leafMat = mat('leaf', () => new THREE.MeshStandardMaterial({ color: 0x1f7a3a, roughness: 0.85, metalness: 0.0 }));
  const trunkGeo = geo('palmTrunk', () => new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6));
  const trunk = new THREE.Mesh(trunkGeo, mat('palmTrunk', () => new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 })));
  trunk.position.y = 0.92;
  g.add(trunk);
  const frondGeo = geo('frond', () => new THREE.ConeGeometry(0.16, 0.95, 5));
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(frondGeo, leafMat);
    const a = (i / 6) * Math.PI * 2;
    f.position.set(Math.cos(a) * 0.34, 1.5, Math.sin(a) * 0.34);
    f.rotation.z = Math.cos(a) * 0.9;
    f.rotation.x = -Math.sin(a) * 0.9;
    g.add(f);
  }
  const top = new THREE.Mesh(frondGeo, leafMat);
  top.position.y = 1.7;
  g.add(top);
  return g;
}

// A simple chrome / metal post used in railings.
function makePost(h = 1.0, r = 0.04) {
  const m = new THREE.Mesh(geo(`post_${h}_${r}`, () => new THREE.CylinderGeometry(r, r, h, 8)), chromeMat());
  m.position.y = h / 2;
  return m;
}

// A bar/lounge stool.
function makeStool() {
  const g = new THREE.Group();
  const legMat = chromeMat();
  const post = new THREE.Mesh(geo('stoolPost', () => new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8)), legMat);
  post.position.y = 0.48;
  g.add(post);
  const base = new THREE.Mesh(geo('stoolBase', () => new THREE.CylinderGeometry(0.26, 0.26, 0.04, 12)), legMat);
  base.position.y = 0.03;
  g.add(base);
  const seat = new THREE.Mesh(geo('stoolSeat', () => new THREE.CylinderGeometry(0.24, 0.24, 0.10, 14)), leatherMat(0x7a1322));
  seat.position.y = 1.0;
  g.add(seat);
  return g;
}

// A poolside lounger (chaise).
function makeLounger() {
  const g = new THREE.Group();
  const frame = chromeMat();
  const padGeo = geo('loungePad', () => new THREE.BoxGeometry(0.7, 0.12, 1.9));
  const pad = new THREE.Mesh(padGeo, cushionMat());
  pad.position.y = 0.42;
  g.add(pad);
  // raised backrest
  const back = new THREE.Mesh(geo('loungeBack', () => new THREE.BoxGeometry(0.7, 0.12, 0.7)), cushionMat());
  back.position.set(0, 0.62, -0.95);
  back.rotation.x = -0.6;
  g.add(back);
  for (const sx of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(geo('loungeLeg', () => new THREE.BoxGeometry(0.06, 0.42, 0.06)), frame);
    leg.position.set(sx, 0.21, 0.8);
    g.add(leg);
    const leg2 = new THREE.Mesh(geo('loungeLeg', () => new THREE.BoxGeometry(0.06, 0.42, 0.06)), frame);
    leg2.position.set(sx, 0.21, -0.8);
    g.add(leg2);
  }
  return g;
}

// A dining chair.
function makeChair(hex = 0x3a2030) {
  const g = new THREE.Group();
  const wood = mat('chairWood', () => new THREE.MeshStandardMaterial({ color: 0x2c1d12, roughness: 0.7, metalness: 0.05 }));
  const seat = new THREE.Mesh(geo('chairSeat', () => new THREE.BoxGeometry(0.46, 0.08, 0.46)), leatherMat(hex));
  seat.position.y = 0.46;
  g.add(seat);
  const back = new THREE.Mesh(geo('chairBack', () => new THREE.BoxGeometry(0.46, 0.55, 0.07)), leatherMat(hex));
  back.position.set(0, 0.74, -0.2);
  g.add(back);
  for (const [sx, sz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
    const leg = new THREE.Mesh(geo('chairLeg', () => new THREE.BoxGeometry(0.05, 0.46, 0.05)), wood);
    leg.position.set(sx, 0.23, sz);
    g.add(leg);
  }
  return g;
}

// Round dining table.
function makeRoundTable(r = 0.6) {
  const g = new THREE.Group();
  const wood = mat('tableWood', () => new THREE.MeshStandardMaterial({ color: 0x3a2517, roughness: 0.5, metalness: 0.1 }));
  const top = new THREE.Mesh(geo(`tableTop_${r}`, () => new THREE.CylinderGeometry(r, r, 0.07, 18)), wood);
  top.position.y = 0.74;
  g.add(top);
  const post = new THREE.Mesh(geo('tablePost', () => new THREE.CylinderGeometry(0.06, 0.08, 0.74, 10)), chromeMat());
  post.position.y = 0.37;
  g.add(post);
  const foot = new THREE.Mesh(geo('tableFoot', () => new THREE.CylinderGeometry(0.32, 0.32, 0.04, 14)), chromeMat());
  foot.position.y = 0.02;
  g.add(foot);
  return g;
}

// ----------------------------------------------------------------
// Feature builders. Each returns { collider?:Box3[]|Box3, interactable?, anim? }
// where anim is pushed into the per-frame update list.
// ----------------------------------------------------------------

// ----- POOL -----------------------------------------------------
function buildPool(group, f, fd, out) {
  const R = rectOf(f);
  const deckMat = material('marble', fd);

  // tiled deck border around the water (a flat ring just above floor)
  const inset = 1.6; // deck width
  const wx0 = R.x0 + inset, wx1 = R.x1 - inset;
  const wz0 = R.z0 + inset, wz1 = R.z1 - inset;
  const waterW = Math.max(1, wx1 - wx0);
  const waterD = Math.max(1, wz1 - wz0);

  // deck: 4 marble strips around the water so we don't overdraw the whole rect
  const deckY = 0.06;
  const strips = [
    [R.x0, R.z0, R.x1, wz0],   // front (low z)
    [R.x0, wz1, R.x1, R.z1],   // back  (high z)
    [R.x0, wz0, wx0, wz1],     // left
    [wx1, wz0, R.x1, wz1],     // right
  ];
  for (const s of strips) {
    const sw = Math.abs(s[2] - s[0]), sd = Math.abs(s[3] - s[1]);
    if (sw < 0.05 || sd < 0.05) continue;
    const m = new THREE.Mesh(geo('poolDeckUnit', () => new THREE.PlaneGeometry(1, 1)), deckMat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(sw, sd, 1);
    m.position.set((s[0] + s[2]) / 2, deckY, (s[1] + s[3]) / 2);
    group.add(m);
  }

  // pool basin floor (dark) just below the water so it reads as depth
  const basin = new THREE.Mesh(
    new THREE.PlaneGeometry(waterW, waterD),
    mat('poolBasin', () => new THREE.MeshStandardMaterial({ color: 0x062633, roughness: 0.6, metalness: 0.2 })),
  );
  basin.rotation.x = -Math.PI / 2;
  basin.position.set((wx0 + wx1) / 2, 0.02, (wz0 + wz1) / 2);
  group.add(basin);

  // animated water plane — segmented so we can ripple vertices
  const segX = Math.max(2, Math.min(40, Math.round(waterW)));
  const segZ = Math.max(2, Math.min(40, Math.round(waterD)));
  const waterGeo = new THREE.PlaneGeometry(waterW, waterD, segX, segZ);
  const water = new THREE.Mesh(waterGeo, material('water', fd));
  water.rotation.x = -Math.PI / 2;
  water.position.set((wx0 + wx1) / 2, 0.10, (wz0 + wz1) / 2);
  group.add(water);

  // store the flat baseline so the ripple is stable over time
  const pos = waterGeo.attributes.position;
  const base = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) base[i] = pos.getZ(i); // local Z (pre-rotation) = surface height
  out.anims.push({
    kind: 'water',
    update(t) {
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i);
        const h = Math.sin(px * 0.9 + t * 1.6) * 0.06 + Math.cos(py * 1.1 + t * 1.2) * 0.05;
        pos.setZ(i, base[i] + h);
      }
      pos.needsUpdate = true;
      waterGeo.computeVertexNormals();
    },
  });

  // chrome railing ring of posts + top rail
  const railH = 1.0;
  const railRect = [R.x0 + 0.3, R.z0 + 0.3, R.x1 - 0.3, R.z1 - 0.3];
  buildRailingRing(group, railRect, railH);

  // poolside loungers along the long deck edges
  const lounge = makeLounger();
  const slots = [];
  const nL = Math.max(1, Math.floor(R.w / 3));
  for (let i = 0; i < nL; i++) {
    const fx = R.x0 + 1 + (i + 0.5) * (R.w - 2) / nL;
    slots.push([fx, R.z0 + 0.9, 0], [fx, R.z1 - 0.9, Math.PI]);
  }
  for (const [px, pz, ry] of slots) {
    const l = lounge.clone();
    l.position.set(px, 0, pz);
    l.rotation.y = ry;
    group.add(l);
  }

  // a couple potted palms at the corners
  for (const [px, pz] of [[R.x0 + 0.8, R.z0 + 0.8], [R.x1 - 0.8, R.z1 - 0.8]]) {
    const p = makePottedPlant(); p.position.set(px, 0, pz); group.add(p);
  }

  // soft caustic light over the water
  const wl = new THREE.PointLight(COLORS.water, 0.9, Math.max(waterW, waterD) + 12, 2.0);
  wl.position.set(R.cx, 3.2, R.cz);
  group.add(wl);

  // collider = the railing ring (so players don't walk into the water)
  out.colliders.push(box3(railRect, 0, railH));
}

// chrome railing ring around a rect (posts + thin top rail bars)
function buildRailingRing(group, r, h) {
  const x0 = Math.min(r[0], r[2]), z0 = Math.min(r[1], r[3]);
  const x1 = Math.max(r[0], r[2]), z1 = Math.max(r[1], r[3]);
  const spacing = 1.6;
  const railMat = chromeMat();
  const railGeoX = geo('railX', () => new THREE.BoxGeometry(1, 0.05, 0.05));
  const railGeoZ = geo('railZ', () => new THREE.BoxGeometry(0.05, 0.05, 1));

  // posts along each side
  function side(ax0, az0, ax1, az1) {
    const len = Math.hypot(ax1 - ax0, az1 - az0);
    const n = Math.max(2, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = ax0 + (ax1 - ax0) * t;
      const pz = az0 + (az1 - az0) * t;
      const post = makePost(h);
      post.position.set(px, 0, pz);
      group.add(post);
    }
  }
  side(x0, z0, x1, z0);
  side(x0, z1, x1, z1);
  side(x0, z0, x0, z1);
  side(x1, z0, x1, z1);

  // top rails
  const top = h - 0.02;
  const rx0 = new THREE.Mesh(railGeoX, railMat); rx0.scale.x = (x1 - x0); rx0.position.set((x0 + x1) / 2, top, z0); group.add(rx0);
  const rx1 = new THREE.Mesh(railGeoX, railMat); rx1.scale.x = (x1 - x0); rx1.position.set((x0 + x1) / 2, top, z1); group.add(rx1);
  const rz0 = new THREE.Mesh(railGeoZ, railMat); rz0.scale.z = (z1 - z0); rz0.position.set(x0, top, (z0 + z1) / 2); group.add(rz0);
  const rz1 = new THREE.Mesh(railGeoZ, railMat); rz1.scale.z = (z1 - z0); rz1.position.set(x1, top, (z0 + z1) / 2); group.add(rz1);
}

// ----- BAR ------------------------------------------------------
function buildBar(group, f, fd, out) {
  const R = rectOf(f);
  const horizontal = R.w >= R.d; // counter runs along the longer axis
  const counterH = 1.1;

  // long counter with a marble top on a wood base
  const woodMat = material('wood', fd);
  const base = new THREE.Mesh(geo('barBaseUnit', () => new THREE.BoxGeometry(1, counterH, 1)), woodMat);
  base.scale.set(R.w, 1, R.d);
  base.position.set(R.cx, counterH / 2, R.cz);
  group.add(base);

  const topMat = material('marble', fd);
  const top = new THREE.Mesh(geo('barTopUnit', () => new THREE.BoxGeometry(1, 0.08, 1)), topMat);
  top.scale.set(R.w + 0.4, 1, R.d + 0.4);
  top.position.set(R.cx, counterH + 0.04, R.cz);
  group.add(top);

  // back-bar shelf behind the counter (on the +d / +w side) with glowing bottles
  const neonHex = (fd && fd.neon != null) ? fd.neon : COLORS.neon;
  const shelfLen = horizontal ? R.w : R.d;
  const shelfMat = darkMetalMat();
  const shelf = new THREE.Mesh(geo('barShelfUnit', () => new THREE.BoxGeometry(1, 1.4, 0.3)), shelfMat);
  if (horizontal) {
    shelf.scale.set(shelfLen, 1, 1);
    shelf.position.set(R.cx, counterH + 0.7, R.z0 - 0.4);
  } else {
    shelf.rotation.y = Math.PI / 2;
    shelf.scale.set(shelfLen, 1, 1);
    shelf.position.set(R.x0 - 0.4, counterH + 0.7, R.cz);
  }
  group.add(shelf);

  // emissive bottles on two shelves
  const bottleColors = [0xff2db8, 0x18e0ff, 0xffd23f, 0x06d6a0, 0x9b1bff, 0xff6a3d];
  const nB = Math.max(3, Math.floor(shelfLen / 0.5));
  const bottleGeo = geo('bottle', () => new THREE.BoxGeometry(0.12, 0.34, 0.12));
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < nB; i++) {
      const t = (i + 0.5) / nB;
      const col = bottleColors[(i + row) % bottleColors.length];
      const b = new THREE.Mesh(bottleGeo, neonMaterial(col, 1.2));
      const along = -shelfLen / 2 + t * shelfLen;
      const by = counterH + 0.45 + row * 0.55;
      if (horizontal) b.position.set(R.cx + along, by, R.z0 - 0.42);
      else b.position.set(R.x0 - 0.42, by, R.cz + along);
      group.add(b);
    }
  }

  // row of stools in front of the counter
  const stool = makeStool();
  const nS = Math.max(2, Math.floor(shelfLen / 1.4));
  for (let i = 0; i < nS; i++) {
    const t = (i + 0.5) / nS;
    const along = -shelfLen / 2 + t * shelfLen;
    const s = stool.clone();
    if (horizontal) s.position.set(R.cx + along, 0, R.z1 + 0.7);
    else s.position.set(R.x1 + 0.7, 0, R.cz + along);
    group.add(s);
  }

  // neon "BAR" sign over the back-bar using the floor neon color
  const label = (f && f.label) || 'BAR';
  const sign = makeNeonSign(label, neonHex, { size: 0.9 });
  if (horizontal) { sign.position.set(R.cx, counterH + 2.1, R.z0 - 0.5); }
  else { sign.position.set(R.x0 - 0.5, counterH + 2.1, R.cz); sign.rotation.y = Math.PI / 2; }
  out.anims.push({ kind: 'sign', obj: sign, base: 1.6, speed: 1.3, phase: Math.random() * 6 });
  group.add(sign);

  // a potted plant at one end
  const plant = makePottedPlant();
  if (horizontal) plant.position.set(R.x1 + 0.8, 0, R.z0 - 0.2);
  else plant.position.set(R.x0 - 0.2, 0, R.z1 + 0.8);
  group.add(plant);

  // collider = the counter box
  out.colliders.push(box3([R.x0, R.z0, R.x1, R.z1], 0, counterH + 0.1));
}

// ----- FOUNTAIN -------------------------------------------------
function buildFountain(group, f, fd, out) {
  const R = rectOf(f);
  const radius = Math.max(1, Math.min(R.w, R.d) / 2);
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;

  // outer coin-water pool basin
  const basinH = 0.5;
  const basin = new THREE.Mesh(
    geo(`fountBasin_${radius.toFixed(1)}`, () => new THREE.CylinderGeometry(radius, radius * 1.04, basinH, 28)),
    material('marble', fd),
  );
  basin.position.set(R.cx, basinH / 2, R.cz);
  group.add(basin);

  // water disc inside
  const water = new THREE.Mesh(
    geo(`fountWater_${radius.toFixed(1)}`, () => new THREE.CircleGeometry(radius - 0.12, 28)),
    material('water', fd),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(R.cx, basinH - 0.02, R.cz);
  group.add(water);

  // tiered emissive gold stack
  const goldMat = neonMaterial(accent, 0.9);
  const tiers = [
    { r: radius * 0.55, h: 0.45, y: basinH },
    { r: radius * 0.35, h: 0.4, y: basinH + 0.55 },
    { r: radius * 0.18, h: 0.35, y: basinH + 1.05 },
  ];
  for (const t of tiers) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.4, t.r, 0.12, 20), goldMat);
    col.position.set(R.cx, t.y, R.cz);
    group.add(col);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, 0.06, 20), goldMat);
    disc.position.set(R.cx, t.y + t.h, R.cz);
    group.add(disc);
  }
  // finial
  const finial = new THREE.Mesh(geo('fountFinial', () => new THREE.SphereGeometry(0.16, 12, 10)), goldMat);
  finial.position.set(R.cx, basinH + 1.55, R.cz);
  group.add(finial);

  // soft warm light
  const fl = new THREE.PointLight(accent, 0.9, radius * 4 + 8, 2.0);
  fl.position.set(R.cx, basinH + 1.8, R.cz);
  group.add(fl);

  // gently shimmer the water level
  out.anims.push({
    kind: 'fountain',
    update(t) { water.position.y = basinH - 0.02 + Math.sin(t * 2.0) * 0.015; },
  });

  // collider only if requested (the rect is small)
  if (f.collide) out.colliders.push(box3([R.x0, R.z0, R.x1, R.z1], 0, basinH + 1.6));
}

// ----- HALL -----------------------------------------------------
function buildHall(group, f, fd, out) {
  const R = rectOf(f);
  const horizontal = R.w >= R.d;
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;

  // carpet runner strip down the middle of the hall
  const runnerW = Math.min(horizontal ? R.d : R.w, 6) * 0.7;
  const runner = new THREE.Mesh(geo('hallRunnerUnit', () => new THREE.PlaneGeometry(1, 1)), material('carpet', fd));
  runner.rotation.x = -Math.PI / 2;
  if (horizontal) runner.scale.set(R.w, runnerW, 1);
  else runner.scale.set(runnerW, R.d, 1);
  runner.position.set(R.cx, 0.02, R.cz);
  group.add(runner);

  // thin neon trim along both edges of the runner
  const trimMat = neonMaterial(accent, 1.1);
  const trimGeo = geo('hallTrimUnit', () => new THREE.PlaneGeometry(1, 1));
  const half = runnerW / 2;
  for (const sgn of [-1, 1]) {
    const tm = new THREE.Mesh(trimGeo, trimMat);
    tm.rotation.x = -Math.PI / 2;
    if (horizontal) { tm.scale.set(R.w, 0.12, 1); tm.position.set(R.cx, 0.03, R.cz + sgn * half); }
    else { tm.scale.set(0.12, R.d, 1); tm.position.set(R.cx + sgn * half, 0.03, R.cz); }
    group.add(tm);
  }

  // a couple chandeliers spaced along the hall, hung near the ceiling
  const len = horizontal ? R.w : R.d;
  const nC = Math.max(1, Math.min(4, Math.round(len / 18)));
  const ceilY = 7.0; // just under FLOOR.H
  for (let i = 0; i < nC; i++) {
    const t = (i + 0.5) / nC;
    const ch = makeChandelier();
    const cx = horizontal ? (R.x0 + t * R.w) : R.cx;
    const cz = horizontal ? R.cz : (R.z0 + t * R.d);
    ch.position.set(cx, ceilY, cz);
    group.add(ch);
  }

  // potted plants flanking the entrances of vertical halls (the spine)
  if (!horizontal) {
    for (const pz of [R.z0 + 2, R.z1 - 2]) {
      for (const px of [R.x0 + 1, R.x1 - 1]) {
        const p = makePottedPlant(); p.position.set(px, 0, pz); group.add(p);
      }
    }
  }
  // no collider for halls
}

// ----- WINDOW ---------------------------------------------------
function buildWindow(group, f, fd, out) {
  const R = rectOf(f);
  const horizontal = R.w >= R.d;
  const len = horizontal ? R.w : R.d;
  const wallY = 3.6;

  // glass wall along the rect
  const glass = new THREE.Mesh(geo('winGlassUnit', () => new THREE.PlaneGeometry(1, 1)), material('glass', fd));
  if (horizontal) {
    glass.scale.set(len, wallY, 1);
    glass.position.set(R.cx, wallY / 2, R.cz);
  } else {
    glass.rotation.y = Math.PI / 2;
    glass.scale.set(len, wallY, 1);
    glass.position.set(R.cx, wallY / 2, R.cz);
  }
  group.add(glass);

  // Vegas skyline behind the glass (pushed outward from the floor center)
  const skyline = makeWindowSkyline();
  const outward = (R.cz >= 0) ? 1 : -1; // most windows are on the perimeter Z edges
  if (horizontal) {
    skyline.position.set(R.cx, wallY * 0.6 + 1.2, R.cz + outward * 2.5);
    if (outward > 0) skyline.rotation.y = Math.PI; // face inward
  } else {
    const outX = (R.cx >= 0) ? 1 : -1;
    skyline.rotation.y = (outX > 0) ? -Math.PI / 2 : Math.PI / 2;
    skyline.position.set(R.cx + outX * 2.5, wallY * 0.6 + 1.2, R.cz);
  }
  group.add(skyline);

  // brass mullions dividing the glass
  const mulMat = material('brass', fd);
  const nM = Math.max(2, Math.round(len / 6));
  const mulGeo = geo('mullion', () => new THREE.BoxGeometry(0.12, 1, 0.12));
  for (let i = 0; i <= nM; i++) {
    const t = i / nM;
    const m = new THREE.Mesh(mulGeo, mulMat);
    m.scale.y = wallY;
    if (horizontal) m.position.set(R.x0 + t * R.w, wallY / 2, R.cz);
    else m.position.set(R.cx, wallY / 2, R.z0 + t * R.d);
    group.add(m);
  }

  // low sill at the base
  const sill = new THREE.Mesh(geo('sillUnit', () => new THREE.BoxGeometry(1, 0.4, 0.5)), material('marble', fd));
  if (horizontal) { sill.scale.set(len, 1, 1); sill.position.set(R.cx, 0.2, R.cz); }
  else { sill.rotation.y = Math.PI / 2; sill.scale.set(len, 1, 1); sill.position.set(R.cx, 0.2, R.cz); }
  group.add(sill);
  // no collider (outer wall handled by casino.js); the sill is decorative
}

// ----- ELEVATOR -------------------------------------------------
function buildElevator(group, f, fd, out) {
  const R = rectOf(f);
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const neonHex = (fd && fd.neon != null) ? fd.neon : COLORS.neon;
  const alcoveH = 3.4;
  // The alcove opens toward the floor interior. Elevator is at +Z edge,
  // so the doorway faces -Z (toward the center). Side walls run along Z.
  const wallT = 0.4;
  const wallMat = material('wall', fd);

  // back wall (at the far +Z edge)
  const back = new THREE.Mesh(geo('elevBackUnit', () => new THREE.BoxGeometry(1, alcoveH, wallT)), wallMat);
  back.scale.set(R.w, 1, 1);
  back.position.set(R.cx, alcoveH / 2, R.z1 - wallT / 2);
  group.add(back);

  // two side walls (these are the colliders; doorway stays open)
  const sideGeo = geo('elevSideUnit', () => new THREE.BoxGeometry(wallT, alcoveH, 1));
  const sideD = R.d;
  const left = new THREE.Mesh(sideGeo, wallMat);
  left.scale.set(1, 1, sideD);
  left.position.set(R.x0 + wallT / 2, alcoveH / 2, R.cz);
  group.add(left);
  const right = new THREE.Mesh(sideGeo, wallMat);
  right.scale.set(1, 1, sideD);
  right.position.set(R.x1 - wallT / 2, alcoveH / 2, R.cz);
  group.add(right);

  // two emissive elevator doors on the back wall
  const doorMat = neonMaterial(accent, 0.55);
  const doorW = Math.min(1.1, (R.w - 1) / 2);
  const doorH = 2.6;
  const doorGeo = geo('elevDoor', () => new THREE.PlaneGeometry(1, 1));
  for (const sgn of [-1, 1]) {
    const d = new THREE.Mesh(doorGeo, doorMat);
    d.scale.set(doorW, doorH, 1);
    d.position.set(R.cx + sgn * (doorW / 2 + 0.02), doorH / 2 + 0.1, R.z1 - wallT - 0.01);
    d.rotation.y = Math.PI; // face into the floor (-Z)
    group.add(d);
  }
  // brass door frame
  const frame = new THREE.Mesh(geo('elevFrame', () => new THREE.BoxGeometry(1, doorH + 0.3, 0.12)), material('brass', fd));
  frame.scale.x = doorW * 2 + 0.4;
  frame.position.set(R.cx, (doorH + 0.3) / 2 + 0.05, R.z1 - wallT - 0.06);
  group.add(frame);

  // call panel on the side wall
  const panel = new THREE.Mesh(geo('elevPanel', () => new THREE.BoxGeometry(0.06, 0.5, 0.3)), darkMetalMat());
  panel.position.set(R.x0 + wallT + 0.05, 1.3, R.z1 - 1.2);
  group.add(panel);
  // cloned material so the pulse doesn't bleed into the shared cached neon mat
  const btn = new THREE.Mesh(geo('elevBtn', () => new THREE.CircleGeometry(0.07, 12)), neonMaterial(neonHex, 1.5).clone());
  btn.rotation.y = Math.PI / 2;
  btn.position.set(R.x0 + wallT + 0.09, 1.35, R.z1 - 1.2);
  group.add(btn);
  out.anims.push({ kind: 'sign', obj: btn, base: 1.5, speed: 3.0, phase: 0, isMat: true });

  // small "ELEVATOR" sign above the doorway
  const sign = makeNeonSign('ELEVATOR', neonHex, { size: 0.55 });
  sign.position.set(R.cx, doorH + 0.6, R.z1 - wallT - 0.1);
  sign.rotation.y = Math.PI;
  group.add(sign);
  out.anims.push({ kind: 'sign', obj: sign, base: 1.6, speed: 1.8, phase: 1.0 });

  // colliders = side walls only (leave the -Z doorway open)
  out.colliders.push(box3([R.x0, R.z0, R.x0 + wallT, R.z1], 0, alcoveH));
  out.colliders.push(box3([R.x1 - wallT, R.z0, R.x1, R.z1], 0, alcoveH));
  out.colliders.push(box3([R.x0, R.z1 - wallT, R.x1, R.z1], 0, alcoveH));
}

// ----- GIFT SHOP ------------------------------------------------
function buildGiftShop(group, f, fd, out) {
  const R = rectOf(f);
  const neonHex = (fd && fd.neon != null) ? fd.neon : COLORS.neon;
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const facadeH = 3.6;
  // Storefront faces the floor interior. These venues sit against a
  // perimeter; the open side is the one nearer the floor center.
  const faceX = (R.cx < 0) ? R.x1 : R.x0;   // interior-facing X edge
  const faceSign = (R.cx < 0) ? 1 : -1;     // direction from facade toward interior
  const facadeMat = material('wall', fd);

  // facade wall along the interior edge — two segments leaving a central doorway
  const doorHalf = 1.5;
  const fSegLen = (R.d / 2) - doorHalf;
  if (fSegLen > 0.3) {
    for (const sgn of [-1, 1]) {
      const seg = new THREE.Mesh(geo('shopFacadeUnit', () => new THREE.BoxGeometry(0.4, facadeH, 1)), facadeMat);
      seg.scale.z = fSegLen;
      seg.position.set(faceX, facadeH / 2, R.cz + sgn * (doorHalf + fSegLen / 2));
      group.add(seg);
    }
  }
  // a lintel over the doorway so the gap reads as an entrance
  const lintel = new THREE.Mesh(geo('shopLintel', () => new THREE.BoxGeometry(0.4, 0.8, 1)), facadeMat);
  lintel.scale.z = doorHalf * 2;
  lintel.position.set(faceX, facadeH - 0.4, R.cz);
  group.add(lintel);

  // back and side walls so it reads as an enclosed shop
  buildEnclosure(group, R, facadeH, facadeMat, faceX, faceSign, out, 1.0);

  // big glowing sign with the label
  const label = (f && f.label) || 'GIFT SHOP';
  const sign = makeNeonSign(label, neonHex, { size: 1.0 });
  sign.position.set(faceX + faceSign * 0.25, facadeH + 0.2, R.cz);
  sign.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
  group.add(sign);
  out.anims.push({ kind: 'sign', obj: sign, base: 1.6, speed: 1.2, phase: 0.5 });

  // display windows flanking the entry, with glowing merch boxes inside
  const winMat = material('glass', fd);
  const merchColors = [0xff2db8, 0x18e0ff, 0xffd23f, 0x06d6a0, 0x9b1bff];
  const winZ = [R.z0 + R.d * 0.22, R.z1 - R.d * 0.22];
  for (const wz of winZ) {
    const w = new THREE.Mesh(geo('shopWin', () => new THREE.PlaneGeometry(1, 1)), winMat);
    w.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
    w.scale.set(R.d * 0.3, 2.2, 1);
    w.position.set(faceX + faceSign * 0.02, 1.4, wz);
    group.add(w);
    // merch boxes on a shelf behind the glass
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(geo('merch', () => new THREE.BoxGeometry(0.3, 0.3, 0.3)), neonMaterial(merchColors[i % merchColors.length], 1.0));
      b.position.set(faceX + faceSign * -0.5, 0.9 + (i % 2) * 0.7, wz - 0.4 + i * 0.4);
      group.add(b);
    }
  }

  // a velvet-rope + plant by the entry
  const plant = makePottedPlant();
  plant.position.set(faceX + faceSign * 0.6, 0, R.cz + R.d * 0.36);
  group.add(plant);
  const plant2 = makePottedPlant();
  plant2.position.set(faceX + faceSign * 0.6, 0, R.cz - R.d * 0.36);
  group.add(plant2);

  // collider = the facade/store block (leave a gap implicitly by colliding the solid walls)
  out.colliders.push(box3([R.x0, R.z0, R.x1, R.z1], 0, 0.6)); // low threshold so player can stand at counter
  out.colliders.push(box3([faceX - faceSign * 0.2, R.z0, faceX + faceSign * 0.2, R.cz - 1.5], 0, facadeH));
  out.colliders.push(box3([faceX - faceSign * 0.2, R.cz + 1.5, faceX + faceSign * 0.2, R.z1], 0, facadeH));

  // interactable at the storefront entry
  out.interactables.push({
    pos: new THREE.Vector3(faceX + faceSign * 1.2, 1.0, R.cz),
    radius: 3,
    prompt: 'Press E — Gift Shop',
    action: () => { if (out.ctx && out.ctx.openShop) out.ctx.openShop('gift'); },
  });
}

// Build back + side walls around a venue rect (the interior-facing side is left open).
function buildEnclosure(group, R, h, wallMat, faceX, faceSign, out, sideInset) {
  const wallT = 0.4;
  const backX = (faceSign > 0) ? R.x0 : R.x1; // wall opposite the facade
  // back wall
  const back = new THREE.Mesh(geo('venueBackUnit', () => new THREE.BoxGeometry(wallT, h, 1)), wallMat);
  back.scale.z = R.d;
  back.position.set(backX + (faceSign > 0 ? wallT / 2 : -wallT / 2), h / 2, R.cz);
  group.add(back);
  // two side walls (along X, capping the Z ends)
  const sideGeo = geo('venueSideUnit', () => new THREE.BoxGeometry(1, h, wallT));
  for (const zEdge of [R.z0, R.z1]) {
    const s = new THREE.Mesh(sideGeo, wallMat);
    s.scale.x = R.w;
    s.position.set(R.cx, h / 2, zEdge + (zEdge === R.z0 ? wallT / 2 : -wallT / 2));
    group.add(s);
  }
}

// ----- RESTAURANT -----------------------------------------------
function buildRestaurant(group, f, fd, out) {
  const R = rectOf(f);
  const neonHex = (fd && fd.neon != null) ? fd.neon : COLORS.neon;
  const facadeH = 3.4;
  const faceX = (R.cx < 0) ? R.x1 : R.x0;
  const faceSign = (R.cx < 0) ? 1 : -1;
  const wallMat = material('wall', fd);

  // enclosure (back + sides), interior open toward the floor
  buildEnclosure(group, R, facadeH, wallMat, faceX, faceSign, out);

  // a low partition/counter at the interior edge (with a gap for the entry)
  const counterH = 1.05;
  const counter = new THREE.Mesh(geo('restCounterUnit', () => new THREE.BoxGeometry(0.5, counterH, 1)), material('wood', fd));
  // two segments leaving a central doorway
  const gapHalf = 1.6;
  const segLen = (R.d / 2) - gapHalf;
  if (segLen > 0.3) {
    for (const sgn of [-1, 1]) {
      const c = counter.clone();
      c.scale.z = segLen;
      c.position.set(faceX, counterH / 2, R.cz + sgn * (gapHalf + segLen / 2));
      group.add(c);
    }
  }

  // booths along the back wall
  const backX = (faceSign > 0) ? R.x0 : R.x1;
  const boothColor = 0x6a1228;
  const seated = [];
  const nBooth = Math.max(2, Math.floor(R.d / 3));
  for (let i = 0; i < nBooth; i++) {
    const t = (i + 0.5) / nBooth;
    const bz = R.z0 + t * R.d;
    // booth seat block
    const seat = new THREE.Mesh(geo('boothSeat', () => new THREE.BoxGeometry(0.7, 0.5, 1.2)), leatherMat(boothColor));
    seat.position.set(backX + faceSign * 0.6, 0.25, bz);
    group.add(seat);
    // high booth back
    const bback = new THREE.Mesh(geo('boothBack', () => new THREE.BoxGeometry(0.18, 1.3, 1.2)), leatherMat(boothColor));
    bback.position.set(backX + faceSign * 0.18, 0.65, bz);
    group.add(bback);
    // a small dining table in front of the booth
    const tbl = makeRoundTable(0.5);
    tbl.position.set(backX + faceSign * 1.5, 0, bz);
    group.add(tbl);

    // seat a patron at some booths
    if (i % 2 === 0) {
      const d = makeDealer({ suit: [0x2b2d42, 0x3a2e2a, 0x14213d][i % 3], accent: [0xffd23f, 0xff2db8, 0x18e0ff][i % 3] });
      d.root.position.set(backX + faceSign * 0.6, 0.5, bz);
      d.root.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
      group.add(d.root);
      seated.push(d);
    }
  }

  // a free-standing dining table with chairs in the open area
  const ftbl = makeRoundTable(0.6);
  ftbl.position.set(faceX + faceSign * 1.6, 0, R.cz);
  group.add(ftbl);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ch = makeChair(0x33415c);
    ch.position.set(faceX + faceSign * 1.6 + Math.cos(a) * 0.95, 0, R.cz + Math.sin(a) * 0.95);
    ch.rotation.y = -a + Math.PI / 2;
    group.add(ch);
  }

  // neon diner sign with the label
  const label = (f && f.label) || 'DINER';
  const sign = makeNeonSign(label, neonHex, { size: 0.9 });
  sign.position.set(faceX + faceSign * 0.25, facadeH + 0.1, R.cz);
  sign.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
  group.add(sign);
  out.anims.push({ kind: 'sign', obj: sign, base: 1.6, speed: 1.5, phase: 2.0 });

  // potted plants by the entry
  for (const sgn of [-1, 1]) {
    const p = makePottedPlant();
    p.position.set(faceX + faceSign * 0.6, 0, R.cz + sgn * (gapHalf + 0.3));
    group.add(p);
  }

  // advance seated patrons in update
  if (seated.length) {
    out.anims.push({ kind: 'npcs', list: seated });
  }

  // collider = the counter/booth blocks (use the back portion of the venue,
  // leaving the open dining/entry area walkable)
  const backDepth = Math.min(R.w * 0.45, 2.2);
  if (faceSign > 0) out.colliders.push(box3([R.x0, R.z0, R.x0 + backDepth, R.z1], 0, 1.3));
  else out.colliders.push(box3([R.x1 - backDepth, R.z0, R.x1, R.z1], 0, 1.3));
  // counter segments
  if (segLen > 0.3) {
    for (const sgn of [-1, 1]) {
      const cz0 = R.cz + sgn * gapHalf;
      const cz1 = R.cz + sgn * (gapHalf + segLen);
      out.colliders.push(box3([faceX - 0.25, Math.min(cz0, cz1), faceX + 0.25, Math.max(cz0, cz1)], 0, counterH));
    }
  }

  // dine interactable at the entry
  out.interactables.push({
    pos: new THREE.Vector3(faceX + faceSign * 1.1, 1.0, R.cz),
    radius: 3,
    prompt: 'Press E — Dine',
    action: () => { if (out.ctx && out.ctx.openShop) out.ctx.openShop('food'); },
  });
}

// ----- THEATER --------------------------------------------------
function buildTheater(group, f, fd, out) {
  const R = rectOf(f);
  const neonHex = (fd && fd.neon != null) ? fd.neon : COLORS.neon;
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const wallH = 4.2;
  const faceX = (R.cx < 0) ? R.x1 : R.x0;
  const faceSign = (R.cx < 0) ? 1 : -1;
  const wallMat = material('wall', fd);

  // enclosure
  buildEnclosure(group, R, wallH, wallMat, faceX, faceSign, out);

  // stage at the BACK (away from interior), raised platform
  const backX = (faceSign > 0) ? R.x0 : R.x1;
  const stageDepth = Math.min(R.w * 0.35, 3.2);
  const stageH = 0.6;
  const stage = new THREE.Mesh(geo('stageUnit', () => new THREE.BoxGeometry(1, stageH, 1)), material('wood', fd));
  stage.scale.set(stageDepth, 1, R.d - 1);
  stage.position.set(backX + faceSign * (stageDepth / 2 + 0.4), stageH / 2, R.cz);
  group.add(stage);

  // emissive stage curtains (left/right) — glowing velvet
  const curtainMat = neonMaterial(0xb01030, 0.5);
  const curtainGeo = geo('curtain', () => new THREE.PlaneGeometry(1, 1));
  for (const sgn of [-1, 1]) {
    const cur = new THREE.Mesh(curtainGeo, curtainMat);
    cur.scale.set(R.d * 0.45, wallH - 0.3, 1);
    cur.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
    cur.position.set(backX + faceSign * 0.5, (wallH - 0.3) / 2, R.cz + sgn * (R.d * 0.28));
    group.add(cur);
  }
  // top valance
  const valance = new THREE.Mesh(curtainGeo, curtainMat);
  valance.scale.set(R.d - 0.6, 1.0, 1);
  valance.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
  valance.position.set(backX + faceSign * 0.5, wallH - 0.6, R.cz);
  group.add(valance);

  // backdrop glow behind the stage (cloned mat so its pulse is isolated)
  const backdrop = new THREE.Mesh(curtainGeo, neonMaterial(neonHex, 0.7).clone());
  backdrop.scale.set(R.d - 0.8, wallH - 1.2, 1);
  backdrop.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
  backdrop.position.set(backX + faceSign * 0.3, (wallH - 1.2) / 2 + 0.3, R.cz);
  group.add(backdrop);
  out.anims.push({ kind: 'sign', obj: backdrop, base: 0.7, speed: 0.9, phase: 0, isMat: true });

  // stage spotlights
  const spot = new THREE.PointLight(accent, 1.2, 18, 2.0);
  spot.position.set(backX + faceSign * (stageDepth + 1), wallH - 0.5, R.cz);
  group.add(spot);

  // rows of seats facing the stage (in the open half toward the interior).
  // Instanced to keep the draw count low even for a big showroom; capped so
  // the grid stays tasteful rather than carpeting the whole rect.
  const seatColor = 0x5a1020;
  const seatGeo = geo('theaterSeat', () => new THREE.BoxGeometry(0.42, 0.45, 0.42));
  const seatBackGeo = geo('theaterSeatBack', () => new THREE.BoxGeometry(0.42, 0.55, 0.1));
  const seatMat = leatherMat(seatColor);
  const rowGap = 1.1, colGap = 0.65;
  const rows = Math.max(2, Math.min(10, Math.floor((R.w - stageDepth - 1.5) / rowGap)));
  const cols = Math.max(2, Math.min(16, Math.floor((R.d - 1) / colGap)));
  const n = rows * cols;
  const seatInst = new THREE.InstancedMesh(seatGeo, seatMat, n);
  const backInst = new THREE.InstancedMesh(seatBackGeo, seatMat, n);
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const seatStartX = backX + faceSign * (stageDepth + 1.4);
  const colSpan = (R.d - 1.4) / Math.max(1, cols - 1);
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = seatStartX + faceSign * r * rowGap;
      const sz = R.z0 + 0.7 + c * colSpan;
      _p.set(sx, 0.45, sz); _m.compose(_p, _q, _s); seatInst.setMatrixAt(idx, _m);
      _p.set(sx + faceSign * 0.16, 0.7, sz); _m.compose(_p, _q, _s); backInst.setMatrixAt(idx, _m);
      idx++;
    }
  }
  if (seatInst.instanceMatrix) seatInst.instanceMatrix.needsUpdate = true;
  if (backInst.instanceMatrix) backInst.instanceMatrix.needsUpdate = true;
  group.add(seatInst, backInst);

  // marquee with the label over the entrance
  const label = (f && f.label) || 'SHOWROOM';
  const sign = makeNeonSign(label, accent, { size: 1.1 });
  sign.position.set(faceX + faceSign * 0.25, wallH + 0.2, R.cz);
  sign.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
  group.add(sign);
  out.anims.push({ kind: 'sign', obj: sign, base: 1.7, speed: 2.2, phase: 0.7 });

  // marquee chase bulbs (a row of emissive dots under the sign)
  const bulbGeo = geo('marqueeBulb', () => new THREE.SphereGeometry(0.08, 8, 6));
  const bulbMat = neonMaterial(0xffffff, 1.4);
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    const t = (i + 0.5) / 8;
    b.position.set(faceX + faceSign * 0.3, wallH - 0.2, R.z0 + t * R.d);
    group.add(b);
  }

  // collider = stage block + back wall area (seats are walkable/low)
  if (faceSign > 0) out.colliders.push(box3([R.x0, R.z0, R.x0 + stageDepth + 0.8, R.z1], 0, stageH + 0.2));
  else out.colliders.push(box3([R.x1 - stageDepth - 0.8, R.z0, R.x1, R.z1], 0, stageH + 0.2));

  // optional interactable
  out.interactables.push({
    pos: new THREE.Vector3(faceX + faceSign * 2.0, 1.0, R.cz),
    radius: 3,
    prompt: 'Press E — Catch a show',
    action: () => { if (out.ctx && out.ctx.openShop) out.ctx.openShop('show'); },
  });
}

// ----------------------------------------------------------------
// Dispatch table
// ----------------------------------------------------------------
const BUILDERS = {
  pool: buildPool,
  bar: buildBar,
  fountain: buildFountain,
  hall: buildHall,
  window: buildWindow,
  elevator: buildElevator,
  giftshop: buildGiftShop,
  restaurant: buildRestaurant,
  theater: buildTheater,
};

// ----------------------------------------------------------------
// decorateFloor — public entry point
// ----------------------------------------------------------------
export function decorateFloor(group, floorDef, ctx) {
  const out = {
    colliders: [],
    interactables: [],
    anims: [],
    ctx: ctx || {},
  };

  if (!group || !group.add) {
    return { colliders: [], interactables: [], update() {} };
  }

  const features = (floorDef && Array.isArray(floorDef.features)) ? floorDef.features : [];
  for (const f of features) {
    const builder = BUILDERS[f && f.type];
    if (!builder) continue;
    try { builder(group, f, floorDef, out); }
    catch (e) { /* never throw on a bad feature; skip it */ }
  }

  let t = 0;
  function update(dt) {
    if (!(dt > 0)) dt = 0.016;
    t += dt;
    for (const a of out.anims) {
      try {
        if (a.kind === 'water' || a.kind === 'fountain') {
          a.update(t);
        } else if (a.kind === 'sign') {
          // pulse emissive intensity of the sign's child materials
          const pulse = a.base * (0.85 + 0.25 * Math.sin(t * (a.speed || 1.2) + (a.phase || 0)));
          if (a.isMat && a.obj.material) {
            a.obj.material.emissiveIntensity = pulse;
          } else if (a.obj && a.obj.traverse) {
            a.obj.traverse((o) => {
              if (o.material && o.material.emissiveIntensity != null && o.material.emissiveMap) {
                o.material.emissiveIntensity = pulse;
              }
            });
          }
        } else if (a.kind === 'npcs') {
          for (const d of a.list) { if (d && d.update) d.update(dt); }
        }
      } catch (e) { /* keep animating the rest */ }
    }
  }

  return { colliders: out.colliders, interactables: out.interactables, update };
}

export default { decorateFloor };
