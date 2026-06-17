// =============================================================
// Digital Casinos — venues.js
// Decorates a floor group with its "features" (pools, bars,
// fountains, halls, windows, elevators, and the Promenade venues:
// gift shops, restaurants, theaters). Called by casino.js once per
// floor; returns solid colliders + interactable prompts + an update
// hook that animates water, seated patrons, and warm sign glows.
//
// Conventions: the floor group's origin is the floor's local origin
// and matches world XZ (floor spans are centered on (0,0)), so the
// rects in floorDef.features ([x0,z0,x1,z1] world coords) can be used
// directly as group-local coords. Floor ground is y=0 in the group.
//
// ART DIRECTION (Wave 5): warm, classy, upscale Las-Vegas resort.
// Cream marble, walnut/cherry wood, brushed brass & gold, soft amber
// light, plants & moldings. NO saturated neon trim. Signage is the
// tasteful backlit aesthetics.makeNeonSign (now a warm edge-lit panel).
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

// A few plain shared materials (all realistic, no glaring emissive).
function chromeMat() { return mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xcdd2d8, roughness: 0.25, metalness: 0.95 })); }
function brassMat() { return mat('brass_solid', () => new THREE.MeshStandardMaterial({ color: COLORS.brass, roughness: 0.3, metalness: 0.95 })); }
function darkMetalMat() { return mat('darkmetal', () => new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.45, metalness: 0.8 })); }
function brushedMetalMat() { return mat('brushedmetal', () => new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.9 })); }
function cushionMat() { return mat('cushion', () => new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, metalness: 0.0 })); }
function leatherMat(hex) { return mat('leather_' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.1 })); }
function stoneMat() { return mat('stone', () => new THREE.MeshStandardMaterial({ color: 0xcfc7b4, roughness: 0.85, metalness: 0.02 })); }
function darkWoodMat() { return mat('darkwood', () => new THREE.MeshStandardMaterial({ color: 0x3a2417, roughness: 0.55, metalness: 0.06 })); }
function fabricMat(hex) { return mat('fabric_' + hex, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, metalness: 0.0 })); }

// A warm low-emissive glass material (for lit bottles / lamp shades / awning
// glow). neonMaterial() is reworked into a soft warm accent in aesthetics.js,
// but we keep intensity LOW so nothing reads as a neon tube.
function warmGlow(hex, i = 0.35) { return neonMaterial(hex, i); }

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
  // tapered glazed planter
  const potGeo = geo('plantPot', () => new THREE.CylinderGeometry(0.26, 0.32, 0.42, 16));
  const pot = new THREE.Mesh(potGeo, mat('plantPot', () => new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.6, metalness: 0.1 })));
  pot.position.y = 0.21;
  g.add(pot);
  // brass rim band
  const rim = new THREE.Mesh(geo('plantRim', () => new THREE.CylinderGeometry(0.27, 0.27, 0.05, 16)), brassMat());
  rim.position.y = 0.42;
  g.add(rim);
  const leafMat = mat('leaf', () => new THREE.MeshStandardMaterial({ color: 0x2f7a3e, roughness: 0.85, metalness: 0.0 }));
  const leafDark = mat('leafDark', () => new THREE.MeshStandardMaterial({ color: 0x215a30, roughness: 0.88, metalness: 0.0 }));
  const trunkGeo = geo('palmTrunk', () => new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6));
  const trunk = new THREE.Mesh(trunkGeo, mat('palmTrunk', () => new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 })));
  trunk.position.y = 0.92;
  g.add(trunk);
  const frondGeo = geo('frond', () => new THREE.ConeGeometry(0.16, 0.95, 5));
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(frondGeo, (i % 2) ? leafDark : leafMat);
    const a = (i / 7) * Math.PI * 2;
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

// A round fluted column with a base and capital (for halls / storefronts).
function makeColumn(h = 6.4, r = 0.34) {
  const g = new THREE.Group();
  const stoneM = stoneMat();
  const shaft = new THREE.Mesh(geo(`colShaft_${h}_${r}`, () => new THREE.CylinderGeometry(r * 0.92, r, h, 18)), stoneM);
  shaft.position.y = h / 2;
  g.add(shaft);
  const base = new THREE.Mesh(geo(`colBase_${r}`, () => new THREE.CylinderGeometry(r * 1.25, r * 1.4, 0.3, 18)), stoneM);
  base.position.y = 0.15;
  g.add(base);
  const cap = new THREE.Mesh(geo(`colCap_${r}`, () => new THREE.CylinderGeometry(r * 1.4, r * 1.1, 0.34, 18)), stoneM);
  cap.position.y = h - 0.17;
  g.add(cap);
  const ring = new THREE.Mesh(geo(`colRing_${r}`, () => new THREE.TorusGeometry(r * 1.05, 0.04, 8, 22)), brassMat());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h - 0.4;
  g.add(ring);
  return g;
}

// A framed artwork panel (warm canvas in a brass frame). Hung on a wall.
function makeFramedArt(w = 1.4, h = 1.0) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(geo(`artFrame_${w}_${h}`, () => new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.08)), brassMat());
  g.add(frame);
  const palette = [0x6a4a2b, 0x3a2e4a, 0x244a3a, 0x5a2030];
  const c = palette[(Math.floor(w * 7 + h * 11)) % palette.length];
  const canvas = new THREE.Mesh(geo(`artCanvas_${w}_${h}`, () => new THREE.PlaneGeometry(w, h)),
    mat('art_' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.05 })));
  canvas.position.z = 0.05;
  g.add(canvas);
  return g;
}

// A warm pendant / lantern light fixture (shade + soft point light).
function makePendant(hex = 0xffe2b0) {
  const g = new THREE.Group();
  const cord = new THREE.Mesh(geo('pendCord', () => new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6)), darkMetalMat());
  cord.position.y = 0.3;
  g.add(cord);
  const shade = new THREE.Mesh(geo('pendShade', () => new THREE.ConeGeometry(0.22, 0.26, 16, 1, true)), brassMat());
  shade.position.y = -0.05;
  g.add(shade);
  const bulb = new THREE.Mesh(geo('pendBulb', () => new THREE.SphereGeometry(0.09, 10, 8)), warmGlow(hex, 0.6));
  bulb.position.y = -0.12;
  g.add(bulb);
  const pl = new THREE.PointLight(hex, 0.5, 6, 2.0);
  pl.position.y = -0.2;
  g.add(pl);
  return g;
}

// A simple brass / chrome post used in railings.
function makePost(h = 1.0, r = 0.035) {
  const m = new THREE.Mesh(geo(`post_${h}_${r}`, () => new THREE.CylinderGeometry(r, r, h, 10)), brassMat());
  m.position.y = h / 2;
  const cap = new THREE.Mesh(geo(`postCap_${r}`, () => new THREE.SphereGeometry(r * 1.6, 10, 8)), brassMat());
  cap.position.y = h / 2;
  m.add(cap);
  return m;
}

// A bar/lounge stool (upholstered seat, brass footring).
function makeStool() {
  const g = new THREE.Group();
  const legMat = brushedMetalMat();
  const post = new THREE.Mesh(geo('stoolPost', () => new THREE.CylinderGeometry(0.05, 0.06, 0.78, 10)), legMat);
  post.position.y = 0.42;
  g.add(post);
  const base = new THREE.Mesh(geo('stoolBase', () => new THREE.CylinderGeometry(0.26, 0.28, 0.04, 16)), legMat);
  base.position.y = 0.03;
  g.add(base);
  const footring = new THREE.Mesh(geo('stoolRing', () => new THREE.TorusGeometry(0.2, 0.018, 8, 20)), brassMat());
  footring.rotation.x = Math.PI / 2;
  footring.position.y = 0.28;
  g.add(footring);
  // upholstered cushion seat + a small back
  const seat = new THREE.Mesh(geo('stoolSeat', () => new THREE.CylinderGeometry(0.24, 0.24, 0.12, 18)), leatherMat(0x5a1322));
  seat.position.y = 0.86;
  g.add(seat);
  const back = new THREE.Mesh(geo('stoolBack', () => new THREE.BoxGeometry(0.36, 0.34, 0.07)), leatherMat(0x5a1322));
  back.position.set(0, 1.1, -0.2);
  back.rotation.x = -0.12;
  g.add(back);
  return g;
}

// A poolside lounger (chaise) with a slatted teak frame and cushion.
function makeLounger() {
  const g = new THREE.Group();
  const frame = darkWoodMat();
  const pad = new THREE.Mesh(geo('loungePad', () => new THREE.BoxGeometry(0.7, 0.12, 1.9)), cushionMat());
  pad.position.y = 0.44;
  g.add(pad);
  // raised backrest
  const back = new THREE.Mesh(geo('loungeBack', () => new THREE.BoxGeometry(0.7, 0.12, 0.7)), cushionMat());
  back.position.set(0, 0.64, -0.95);
  back.rotation.x = -0.6;
  g.add(back);
  // teak side rails
  for (const sx of [-0.36, 0.36]) {
    const rail = new THREE.Mesh(geo('loungeRail', () => new THREE.BoxGeometry(0.05, 0.08, 1.95)), frame);
    rail.position.set(sx, 0.36, 0);
    g.add(rail);
  }
  for (const sx of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(geo('loungeLeg', () => new THREE.BoxGeometry(0.06, 0.36, 0.06)), frame);
    leg.position.set(sx, 0.18, 0.8);
    g.add(leg);
    const leg2 = new THREE.Mesh(geo('loungeLeg', () => new THREE.BoxGeometry(0.06, 0.36, 0.06)), frame);
    leg2.position.set(sx, 0.18, -0.8);
    g.add(leg2);
  }
  return g;
}

// A patio umbrella (canvas canopy + pole) for the pool deck.
function makeUmbrella(hex = 0xe9e4d6) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(geo('umbPole', () => new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8)), darkWoodMat());
  pole.position.y = 1.25;
  g.add(pole);
  const canopy = new THREE.Mesh(geo('umbCanopy', () => new THREE.ConeGeometry(1.4, 0.55, 12)), fabricMat(hex));
  canopy.position.y = 2.55;
  g.add(canopy);
  const trim = new THREE.Mesh(geo('umbTrim', () => new THREE.TorusGeometry(1.36, 0.03, 6, 18)), fabricMat(0x8a1322));
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 2.32;
  g.add(trim);
  return g;
}

// A dining chair (wood frame + upholstered seat & back).
function makeChair(hex = 0x3a2030) {
  const g = new THREE.Group();
  const wood = darkWoodMat();
  const seat = new THREE.Mesh(geo('chairSeat', () => new THREE.BoxGeometry(0.46, 0.08, 0.46)), leatherMat(hex));
  seat.position.y = 0.46;
  g.add(seat);
  const back = new THREE.Mesh(geo('chairBack', () => new THREE.BoxGeometry(0.46, 0.55, 0.07)), leatherMat(hex));
  back.position.set(0, 0.74, -0.2);
  g.add(back);
  // wooden back posts framing the upholstery
  for (const sx of [-0.21, 0.21]) {
    const postp = new THREE.Mesh(geo('chairBackPost', () => new THREE.BoxGeometry(0.05, 0.62, 0.05)), wood);
    postp.position.set(sx, 0.74, -0.22);
    g.add(postp);
  }
  for (const [sx, sz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
    const leg = new THREE.Mesh(geo('chairLeg', () => new THREE.BoxGeometry(0.05, 0.46, 0.05)), wood);
    leg.position.set(sx, 0.23, sz);
    g.add(leg);
  }
  return g;
}

// Round dining table with a wood top, white cloth, and a brass pedestal.
function makeRoundTable(r = 0.6) {
  const g = new THREE.Group();
  const wood = darkWoodMat();
  const top = new THREE.Mesh(geo(`tableTop_${r}`, () => new THREE.CylinderGeometry(r, r, 0.07, 22)), wood);
  top.position.y = 0.74;
  g.add(top);
  // linen tablecloth draping just under the top
  const cloth = new THREE.Mesh(geo(`tableCloth_${r}`, () => new THREE.CylinderGeometry(r * 1.02, r * 0.9, 0.5, 22, 1, true)), cushionMat());
  cloth.position.y = 0.48;
  g.add(cloth);
  const post = new THREE.Mesh(geo('tablePost', () => new THREE.CylinderGeometry(0.06, 0.08, 0.74, 12)), brassMat());
  post.position.y = 0.37;
  g.add(post);
  const foot = new THREE.Mesh(geo('tableFoot', () => new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16)), brassMat());
  foot.position.y = 0.02;
  g.add(foot);
  return g;
}

// ----------------------------------------------------------------
// Feature builders. Each returns nothing but pushes into `out`
// (colliders / interactables / anims).
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

  // raised stone coping ring framing the water (a low lip you read as a pool edge)
  const copeH = 0.18, copeT = 0.4;
  const copeMat = stoneMat();
  const copeGeoX = geo('poolCopeX', () => new THREE.BoxGeometry(1, copeH, copeT));
  const copeGeoZ = geo('poolCopeZ', () => new THREE.BoxGeometry(copeT, copeH, 1));
  const cx0 = new THREE.Mesh(copeGeoX, copeMat); cx0.scale.x = waterW + copeT * 2; cx0.position.set((wx0 + wx1) / 2, copeH / 2 + 0.04, wz0 - copeT / 2); group.add(cx0);
  const cx1 = new THREE.Mesh(copeGeoX, copeMat); cx1.scale.x = waterW + copeT * 2; cx1.position.set((wx0 + wx1) / 2, copeH / 2 + 0.04, wz1 + copeT / 2); group.add(cx1);
  const cz0 = new THREE.Mesh(copeGeoZ, copeMat); cz0.scale.z = waterD; cz0.position.set(wx0 - copeT / 2, copeH / 2 + 0.04, (wz0 + wz1) / 2); group.add(cz0);
  const cz1 = new THREE.Mesh(copeGeoZ, copeMat); cz1.scale.z = waterD; cz1.position.set(wx1 + copeT / 2, copeH / 2 + 0.04, (wz0 + wz1) / 2); group.add(cz1);

  // pool basin floor (tiled aqua) just below the water so it reads as depth
  const basin = new THREE.Mesh(
    new THREE.PlaneGeometry(waterW, waterD),
    mat('poolBasin', () => new THREE.MeshStandardMaterial({ color: 0x2a7a8a, roughness: 0.5, metalness: 0.1 })),
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
        const h = Math.sin(px * 0.9 + t * 1.6) * 0.05 + Math.cos(py * 1.1 + t * 1.2) * 0.04;
        pos.setZ(i, base[i] + h);
      }
      pos.needsUpdate = true;
      waterGeo.computeVertexNormals();
    },
  });

  // brass railing ring of posts + top rail set back on the deck
  const railH = 1.0;
  const railRect = [R.x0 + 0.3, R.z0 + 0.3, R.x1 - 0.3, R.z1 - 0.3];
  buildRailingRing(group, railRect, railH);

  // poolside loungers along the long deck edges, with umbrellas between pairs
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
  // umbrellas spaced along the deck edges
  const nU = Math.max(1, Math.floor(R.w / 6));
  for (let i = 0; i < nU; i++) {
    const ux = R.x0 + 2 + (i + 0.5) * (R.w - 4) / nU;
    for (const uz of [R.z0 + 1.3, R.z1 - 1.3]) {
      const u = makeUmbrella();
      u.position.set(ux, 0, uz);
      group.add(u);
    }
  }

  // potted palms at all four corners
  for (const [px, pz] of [[R.x0 + 0.8, R.z0 + 0.8], [R.x1 - 0.8, R.z0 + 0.8], [R.x0 + 0.8, R.z1 - 0.8], [R.x1 - 0.8, R.z1 - 0.8]]) {
    const p = makePottedPlant(); p.position.set(px, 0, pz); group.add(p);
  }

  // soft warm light over the water (gentle, no saturated tint)
  const wl = new THREE.PointLight(0xfff0d6, 0.7, Math.max(waterW, waterD) + 12, 2.0);
  wl.position.set(R.cx, 3.6, R.cz);
  group.add(wl);

  // collider = the railing ring (so players don't walk into the water)
  out.colliders.push(box3(railRect, 0, railH));
}

// brass railing ring around a rect (posts + thin top rail bars)
function buildRailingRing(group, r, h) {
  const x0 = Math.min(r[0], r[2]), z0 = Math.min(r[1], r[3]);
  const x1 = Math.max(r[0], r[2]), z1 = Math.max(r[1], r[3]);
  const spacing = 1.6;
  const railMat = brassMat();
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

  // top + mid rails for a fuller balustrade
  for (const ry of [h - 0.02, h * 0.5]) {
    const rx0 = new THREE.Mesh(railGeoX, railMat); rx0.scale.x = (x1 - x0); rx0.position.set((x0 + x1) / 2, ry, z0); group.add(rx0);
    const rx1 = new THREE.Mesh(railGeoX, railMat); rx1.scale.x = (x1 - x0); rx1.position.set((x0 + x1) / 2, ry, z1); group.add(rx1);
    const rz0 = new THREE.Mesh(railGeoZ, railMat); rz0.scale.z = (z1 - z0); rz0.position.set(x0, ry, (z0 + z1) / 2); group.add(rz0);
    const rz1 = new THREE.Mesh(railGeoZ, railMat); rz1.scale.z = (z1 - z0); rz1.position.set(x1, ry, (z0 + z1) / 2); group.add(rz1);
  }
}

// ----- BAR ------------------------------------------------------
function buildBar(group, f, fd, out) {
  const R = rectOf(f);
  const horizontal = R.w >= R.d; // counter runs along the longer axis
  const counterH = 1.1;

  // long counter with a marble top on a walnut base + a brass kick foot-rail
  const woodMat = material('wood', fd);
  const baseB = new THREE.Mesh(geo('barBaseUnit', () => new THREE.BoxGeometry(1, counterH, 1)), woodMat);
  baseB.scale.set(R.w, 1, R.d);
  baseB.position.set(R.cx, counterH / 2, R.cz);
  group.add(baseB);
  // recessed dark kickplate so the base isn't a plain cube
  const kick = new THREE.Mesh(geo('barKickUnit', () => new THREE.BoxGeometry(1, 0.18, 1)), darkWoodMat());
  kick.scale.set(R.w - 0.1, 1, R.d - 0.1);
  kick.position.set(R.cx, 0.09, R.cz);
  group.add(kick);

  const topMat = material('marble', fd);
  const top = new THREE.Mesh(geo('barTopUnit', () => new THREE.BoxGeometry(1, 0.08, 1)), topMat);
  top.scale.set(R.w + 0.4, 1, R.d + 0.4);
  top.position.set(R.cx, counterH + 0.04, R.cz);
  group.add(top);

  const shelfLen = horizontal ? R.w : R.d;

  // brass foot-rail in front of the counter (on the stool side)
  const footRailMat = brassMat();
  const fr = new THREE.Mesh(geo('barFootRail', () => new THREE.BoxGeometry(1, 0.05, 0.05)), footRailMat);
  if (horizontal) { fr.scale.x = shelfLen; fr.position.set(R.cx, 0.18, R.z1 + 0.45); }
  else { fr.scale.x = shelfLen; fr.rotation.y = Math.PI / 2; fr.position.set(R.x1 + 0.45, 0.18, R.cz); }
  group.add(fr);

  // back-bar: a wood cabinet with a MIRRORED back panel and bottle shelves
  const shelfMat = darkWoodMat();
  const cabinet = new THREE.Mesh(geo('barCabUnit', () => new THREE.BoxGeometry(1, 2.0, 0.35)), shelfMat);
  // mirrored back panel (brushed metal reads as a back-bar mirror)
  const mirrorMat = mat('barMirror', () => new THREE.MeshStandardMaterial({ color: 0xb6c0c8, roughness: 0.08, metalness: 1.0 }));
  const mirror = new THREE.Mesh(geo('barMirrorUnit', () => new THREE.PlaneGeometry(1, 1)), mirrorMat);
  const shelfBoardMat = darkWoodMat();
  const board = geo('barBoardUnit', () => new THREE.BoxGeometry(1, 0.05, 0.28));
  const boards = [];
  if (horizontal) {
    cabinet.scale.set(shelfLen, 1, 1);
    cabinet.position.set(R.cx, 1.0, R.z0 - 0.45);
    mirror.scale.set(shelfLen - 0.3, 1.7, 1);
    mirror.position.set(R.cx, 1.05, R.z0 - 0.27);
    for (const by of [counterH + 0.35, counterH + 0.9]) {
      const b = new THREE.Mesh(board, shelfBoardMat); b.scale.x = shelfLen - 0.4; b.position.set(R.cx, by, R.z0 - 0.42); group.add(b); boards.push(by);
    }
  } else {
    cabinet.rotation.y = Math.PI / 2; cabinet.scale.set(shelfLen, 1, 1);
    cabinet.position.set(R.x0 - 0.45, 1.0, R.cz);
    mirror.rotation.y = Math.PI / 2; mirror.scale.set(shelfLen - 0.3, 1.7, 1);
    mirror.position.set(R.x0 - 0.27, 1.05, R.cz);
    for (const bx of [counterH + 0.35, counterH + 0.9]) {
      const b = new THREE.Mesh(board, shelfBoardMat); b.rotation.y = Math.PI / 2; b.scale.x = shelfLen - 0.4; b.position.set(R.x0 - 0.42, bx, R.cz); group.add(b); boards.push(bx);
    }
  }
  group.add(cabinet, mirror);

  // realistic glass bottles on the two shelves (clear/amber/green glass)
  const bottleColors = [0x9a6b2a, 0x2a5a30, 0x6a7a8a, 0x7a2a2a, 0xc9b074, 0x355a6a];
  const nB = Math.max(3, Math.floor(shelfLen / 0.5));
  const bottleGeo = geo('bottle', () => new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8));
  const neckGeo = geo('bottleNeck', () => new THREE.CylinderGeometry(0.018, 0.03, 0.12, 6));
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < nB; i++) {
      const t = (i + 0.5) / nB;
      const col = bottleColors[(i + row) % bottleColors.length];
      const bm = mat('bottleGlass_' + col, () => new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.15, metalness: 0.0, transmission: 0.5, transparent: true, opacity: 0.85, ior: 1.4 }));
      const b = new THREE.Mesh(bottleGeo, bm);
      const neck = new THREE.Mesh(neckGeo, bm); neck.position.y = 0.22; b.add(neck);
      const along = -shelfLen / 2 + t * shelfLen;
      const by = (boards[row] || (counterH + 0.35)) + 0.18;
      if (horizontal) b.position.set(R.cx + along, by, R.z0 - 0.42);
      else b.position.set(R.x0 - 0.42, by, R.cz + along);
      group.add(b);
    }
  }

  // warm pendant lights over the bar
  const nP = Math.max(2, Math.floor(shelfLen / 2.5));
  for (let i = 0; i < nP; i++) {
    const t = (i + 0.5) / nP;
    const along = -shelfLen / 2 + t * shelfLen;
    const pend = makePendant();
    if (horizontal) pend.position.set(R.cx + along, 3.0, R.z1 + 0.3);
    else pend.position.set(R.x1 + 0.3, 3.0, R.cz + along);
    group.add(pend);
  }

  // row of upholstered stools in front of the counter
  const stool = makeStool();
  const nS = Math.max(2, Math.floor(shelfLen / 1.4));
  for (let i = 0; i < nS; i++) {
    const t = (i + 0.5) / nS;
    const along = -shelfLen / 2 + t * shelfLen;
    const s = stool.clone();
    if (horizontal) { s.position.set(R.cx + along, 0, R.z1 + 0.7); s.rotation.y = Math.PI; }
    else { s.position.set(R.x1 + 0.7, 0, R.cz + along); s.rotation.y = -Math.PI / 2; }
    group.add(s);
  }

  // tasteful backlit sign over the back-bar using the floor accent + label
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const label = (f && f.label) || 'BAR';
  const sign = makeNeonSign(label, accent, { size: 0.9 });
  if (horizontal) { sign.position.set(R.cx, counterH + 2.05, R.z0 - 0.5); }
  else { sign.position.set(R.x0 - 0.5, counterH + 2.05, R.cz); sign.rotation.y = Math.PI / 2; }
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

  // outer carved stone pool basin with a coping lip
  const basinH = 0.5;
  const basin = new THREE.Mesh(
    geo(`fountBasin_${radius.toFixed(1)}`, () => new THREE.CylinderGeometry(radius, radius * 1.04, basinH, 32)),
    stoneMat(),
  );
  basin.position.set(R.cx, basinH / 2, R.cz);
  group.add(basin);
  const lip = new THREE.Mesh(
    geo(`fountLip_${radius.toFixed(1)}`, () => new THREE.TorusGeometry(radius, 0.1, 10, 36)),
    stoneMat(),
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.set(R.cx, basinH, R.cz);
  group.add(lip);

  // water disc inside
  const water = new THREE.Mesh(
    geo(`fountWater_${radius.toFixed(1)}`, () => new THREE.CircleGeometry(radius - 0.12, 32)),
    material('water', fd),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(R.cx, basinH - 0.02, R.cz);
  group.add(water);

  // carved stone tiered stack (pedestal + bowls), warm not emissive
  const sMat = stoneMat();
  const tiers = [
    { r: radius * 0.55, h: 0.45, y: basinH },
    { r: radius * 0.35, h: 0.4, y: basinH + 0.55 },
    { r: radius * 0.18, h: 0.35, y: basinH + 1.05 },
  ];
  for (const t of tiers) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.4, t.r, 0.12, 22), sMat);
    col.position.set(R.cx, t.y, R.cz);
    group.add(col);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r * 0.7, 0.08, 22), sMat);
    bowl.position.set(R.cx, t.y + t.h, R.cz);
    group.add(bowl);
    // brass rim on each bowl
    const rim = new THREE.Mesh(new THREE.TorusGeometry(t.r, 0.025, 8, 24), brassMat());
    rim.rotation.x = Math.PI / 2;
    rim.position.set(R.cx, t.y + t.h + 0.04, R.cz);
    group.add(rim);
  }
  // carved finial
  const finial = new THREE.Mesh(geo('fountFinial', () => new THREE.SphereGeometry(0.16, 14, 12)), sMat);
  finial.position.set(R.cx, basinH + 1.55, R.cz);
  group.add(finial);

  // warm uplight from inside the basin
  const fl = new THREE.PointLight(0xffe2ac, 0.85, radius * 4 + 8, 2.0);
  fl.position.set(R.cx, basinH + 0.3, R.cz);
  group.add(fl);

  // gently shimmer the water level
  out.anims.push({
    kind: 'fountain',
    update(t) { water.position.y = basinH - 0.02 + Math.sin(t * 2.0) * 0.012; },
  });

  // collider only if requested (the rect is small)
  if (f.collide) out.colliders.push(box3([R.x0, R.z0, R.x1, R.z1], 0, basinH + 1.6));
}

// ----- HALL -----------------------------------------------------
function buildHall(group, f, fd, out) {
  const R = rectOf(f);
  const horizontal = R.w >= R.d;

  // carpet runner strip down the middle of the hall
  const runnerW = Math.min(horizontal ? R.d : R.w, 6) * 0.7;
  const runner = new THREE.Mesh(geo('hallRunnerUnit', () => new THREE.PlaneGeometry(1, 1)), material('carpet', fd));
  runner.rotation.x = -Math.PI / 2;
  if (horizontal) runner.scale.set(R.w, runnerW, 1);
  else runner.scale.set(runnerW, R.d, 1);
  runner.position.set(R.cx, 0.02, R.cz);
  group.add(runner);

  // brass inlay strips along both edges of the runner (replaces neon trim)
  const inlayMat = brassMat();
  const inlayGeo = geo('hallInlayUnit', () => new THREE.BoxGeometry(1, 0.02, 1));
  const half = runnerW / 2;
  for (const sgn of [-1, 1]) {
    const tm = new THREE.Mesh(inlayGeo, inlayMat);
    if (horizontal) { tm.scale.set(R.w, 1, 0.08); tm.position.set(R.cx, 0.04, R.cz + sgn * half); }
    else { tm.scale.set(0.08, 1, R.d); tm.position.set(R.cx + sgn * half, 0.04, R.cz); }
    group.add(tm);
  }

  // a row of fluted columns down each side of the hall
  const len = horizontal ? R.w : R.d;
  const nCol = Math.max(2, Math.min(8, Math.round(len / 9)));
  const colOff = (horizontal ? R.d : R.w) / 2 - 0.8;
  for (let i = 0; i <= nCol; i++) {
    const t = i / nCol;
    for (const sgn of [-1, 1]) {
      const col = makeColumn(6.6, 0.34);
      if (horizontal) col.position.set(R.x0 + t * R.w, 0, R.cz + sgn * colOff);
      else col.position.set(R.cx + sgn * colOff, 0, R.z0 + t * R.d);
      group.add(col);
      // framed art between columns on the outer side
      if (i < nCol) {
        const art = makeFramedArt(1.3, 0.95);
        if (horizontal) {
          art.position.set(R.x0 + (t + 0.5 / nCol) * R.w, 2.4, R.cz + sgn * (colOff + 0.05));
          art.rotation.y = (sgn < 0) ? 0 : Math.PI;
        } else {
          art.position.set(R.cx + sgn * (colOff + 0.05), 2.4, R.z0 + (t + 0.5 / nCol) * R.d);
          art.rotation.y = (sgn < 0) ? Math.PI / 2 : -Math.PI / 2;
        }
        group.add(art);
      }
    }
  }

  // chandeliers spaced along the hall, hung near the ceiling
  const nC = Math.max(1, Math.min(4, Math.round(len / 18)));
  const ceilY = 7.0; // just under FLOOR.H
  for (let i = 0; i < nC; i++) {
    const t = (i + 0.5) / nC;
    const ch = makeChandelier();
    const ccx = horizontal ? (R.x0 + t * R.w) : R.cx;
    const ccz = horizontal ? R.cz : (R.z0 + t * R.d);
    ch.position.set(ccx, ceilY, ccz);
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
  glass.scale.set(len, wallY, 1);
  if (horizontal) glass.position.set(R.cx, wallY / 2, R.cz);
  else { glass.rotation.y = Math.PI / 2; glass.position.set(R.cx, wallY / 2, R.cz); }
  group.add(glass);

  // warm skyline behind the glass (pushed outward from the floor center)
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

  // a soft warm glow behind the glass so the skyline reads as a lit cityscape
  const sky = new THREE.PointLight(0xffd9a0, 0.5, len + 16, 2.0);
  if (horizontal) sky.position.set(R.cx, wallY * 0.7, R.cz + outward * 1.5);
  else sky.position.set(R.cx + ((R.cx >= 0) ? 1 : -1) * 1.5, wallY * 0.7, R.cz);
  group.add(sky);

  // brass mullions dividing the glass (vertical + a horizontal transom)
  const mulMat = material('brass', fd);
  const nM = Math.max(2, Math.round(len / 6));
  const mulGeo = geo('mullion', () => new THREE.BoxGeometry(0.1, 1, 0.1));
  for (let i = 0; i <= nM; i++) {
    const t = i / nM;
    const m = new THREE.Mesh(mulGeo, mulMat);
    m.scale.y = wallY;
    if (horizontal) m.position.set(R.x0 + t * R.w, wallY / 2, R.cz);
    else m.position.set(R.cx, wallY / 2, R.z0 + t * R.d);
    group.add(m);
  }
  // horizontal transom bar across the glass
  const transom = new THREE.Mesh(geo('transom', () => new THREE.BoxGeometry(1, 0.1, 0.1)), mulMat);
  transom.scale.x = len;
  if (horizontal) transom.position.set(R.cx, wallY * 0.66, R.cz);
  else { transom.rotation.y = Math.PI / 2; transom.position.set(R.cx, wallY * 0.66, R.cz); }
  group.add(transom);

  // low marble sill with a wood cap at the base
  const sill = new THREE.Mesh(geo('sillUnit', () => new THREE.BoxGeometry(1, 0.4, 0.5)), material('marble', fd));
  const cap = new THREE.Mesh(geo('sillCapUnit', () => new THREE.BoxGeometry(1, 0.06, 0.56)), darkWoodMat());
  if (horizontal) {
    sill.scale.set(len, 1, 1); sill.position.set(R.cx, 0.2, R.cz);
    cap.scale.x = len; cap.position.set(R.cx, 0.43, R.cz);
  } else {
    sill.rotation.y = Math.PI / 2; sill.scale.set(len, 1, 1); sill.position.set(R.cx, 0.2, R.cz);
    cap.rotation.y = Math.PI / 2; cap.scale.x = len; cap.position.set(R.cx, 0.43, R.cz);
  }
  group.add(sill, cap);

  // floor-length drapes framing the window (one swag at each end)
  const drapeMat = fabricMat(0x5a1322);
  const drapeGeo = geo('drape', () => new THREE.CylinderGeometry(0.22, 0.28, wallY, 10, 1, true, 0, Math.PI));
  const drapeEnds = horizontal ? [[R.x0 + 0.4, R.cz], [R.x1 - 0.4, R.cz]] : [[R.cx, R.z0 + 0.4], [R.cx, R.z1 - 0.4]];
  for (const [dx, dz] of drapeEnds) {
    const d = new THREE.Mesh(drapeGeo, drapeMat);
    d.position.set(dx, wallY / 2, dz + (horizontal ? 0.35 : 0));
    if (!horizontal) d.position.set(dx + 0.35, wallY / 2, dz);
    d.rotation.y = horizontal ? 0 : Math.PI / 2;
    group.add(d);
  }
  // a pelmet/valance across the top
  const valance = new THREE.Mesh(geo('winValance', () => new THREE.BoxGeometry(1, 0.4, 0.3)), drapeMat);
  valance.scale.x = len;
  if (horizontal) valance.position.set(R.cx, wallY - 0.2, R.cz + 0.3);
  else { valance.rotation.y = Math.PI / 2; valance.position.set(R.cx + 0.3, wallY - 0.2, R.cz); }
  group.add(valance);
  // no collider (outer wall handled by casino.js); the sill/drapes are decorative
}

// ----- ELEVATOR -------------------------------------------------
function buildElevator(group, f, fd, out) {
  const R = rectOf(f);
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

  // two brushed-metal elevator doors with a vertical wood inlay seam
  const doorMat = brushedMetalMat();
  const doorW = Math.min(1.1, (R.w - 1) / 2);
  const doorH = 2.6;
  const doorGeo = geo('elevDoorUnit', () => new THREE.BoxGeometry(1, 1, 0.06));
  for (const sgn of [-1, 1]) {
    const d = new THREE.Mesh(doorGeo, doorMat);
    d.scale.set(doorW, doorH, 1);
    d.position.set(R.cx + sgn * (doorW / 2 + 0.02), doorH / 2 + 0.1, R.z1 - wallT - 0.04);
    group.add(d);
    // a slim wood inlay strip on each door
    const inlay = new THREE.Mesh(geo('elevDoorInlay', () => new THREE.BoxGeometry(0.08, 1, 0.02)), darkWoodMat());
    inlay.scale.y = doorH - 0.4;
    inlay.position.set(R.cx + sgn * (doorW * 0.7), doorH / 2 + 0.1, R.z1 - wallT - 0.07);
    group.add(inlay);
  }

  // ornate brass door surround (jambs + lintel) instead of a flat frame
  const brass = material('brass', fd);
  const surroundY = doorH + 0.3;
  const jambGeo = geo('elevJamb', () => new THREE.BoxGeometry(0.16, 1, 0.16));
  for (const sgn of [-1, 1]) {
    const jamb = new THREE.Mesh(jambGeo, brass);
    jamb.scale.y = surroundY;
    jamb.position.set(R.cx + sgn * (doorW + 0.25), surroundY / 2 + 0.05, R.z1 - wallT - 0.06);
    group.add(jamb);
  }
  const lintel = new THREE.Mesh(geo('elevLintel', () => new THREE.BoxGeometry(1, 0.22, 0.18)), brass);
  lintel.scale.x = doorW * 2 + 0.66;
  lintel.position.set(R.cx, surroundY + 0.05, R.z1 - wallT - 0.06);
  group.add(lintel);

  // call panel on the side wall with two engraved brass buttons (warm, low glow)
  const panel = new THREE.Mesh(geo('elevPanel', () => new THREE.BoxGeometry(0.06, 0.5, 0.3)), brushedMetalMat());
  panel.position.set(R.x0 + wallT + 0.05, 1.3, R.z1 - 1.2);
  group.add(panel);
  const btnMat = warmGlow(0xffd9a0, 0.5);
  for (const dy of [0.08, -0.08]) {
    const btn = new THREE.Mesh(geo('elevBtn', () => new THREE.CircleGeometry(0.05, 14)), btnMat);
    btn.rotation.y = Math.PI / 2;
    btn.position.set(R.x0 + wallT + 0.09, 1.3 + dy, R.z1 - 1.2);
    group.add(btn);
  }

  // small engraved "ELEVATOR" sign above the doorway (brass plate, not neon)
  const plate = new THREE.Mesh(geo('elevPlate', () => new THREE.BoxGeometry(1.4, 0.34, 0.04)), brass);
  plate.position.set(R.cx, surroundY + 0.35, R.z1 - wallT - 0.07);
  group.add(plate);
  const sign = makeNeonSign('ELEVATOR', (fd && fd.accent != null) ? fd.accent : COLORS.gold, { size: 0.32, backing: false, light: false });
  sign.position.set(R.cx, surroundY + 0.35, R.z1 - wallT - 0.1);
  sign.rotation.y = Math.PI;
  group.add(sign);

  // a small warm downlight in the alcove
  const dl = new THREE.PointLight(0xffe2ac, 0.5, 8, 2.0);
  dl.position.set(R.cx, alcoveH - 0.4, R.cz);
  group.add(dl);

  // colliders = side walls + back wall (leave the -Z doorway open)
  out.colliders.push(box3([R.x0, R.z0, R.x0 + wallT, R.z1], 0, alcoveH));
  out.colliders.push(box3([R.x1 - wallT, R.z0, R.x1, R.z1], 0, alcoveH));
  out.colliders.push(box3([R.x0, R.z1 - wallT, R.x1, R.z1], 0, alcoveH));
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

// A fabric storefront awning over the entrance (sloped striped canopy + bar).
function makeAwning(group, faceX, faceSign, cz, span, y, hex) {
  const awnMat = fabricMat(hex);
  const awn = new THREE.Mesh(geo('awningUnit', () => new THREE.BoxGeometry(0.7, 0.08, 1)), awnMat);
  awn.scale.z = span;
  awn.rotation.z = faceSign * 0.35; // sloped outward
  awn.position.set(faceX + faceSign * 0.55, y, cz);
  group.add(awn);
  // scalloped valance hanging off the front edge
  const valance = new THREE.Mesh(geo('awningValance', () => new THREE.BoxGeometry(0.05, 0.28, 1)), awnMat);
  valance.scale.z = span;
  valance.position.set(faceX + faceSign * 0.92, y - 0.2, cz);
  group.add(valance);
  // support brackets
  for (const sgn of [-1, 1]) {
    const br = new THREE.Mesh(geo('awningBracket', () => new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6)), brassMat());
    br.rotation.z = Math.PI / 2;
    br.position.set(faceX + faceSign * 0.35, y - 0.05, cz + sgn * (span / 2 - 0.2));
    group.add(br);
  }
}

// ----- GIFT SHOP ------------------------------------------------
function buildGiftShop(group, f, fd, out) {
  const R = rectOf(f);
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const facadeH = 3.6;
  // Storefront faces the floor interior. These venues sit against a
  // perimeter; the open side is the one nearer the floor center.
  const faceX = (R.cx < 0) ? R.x1 : R.x0;   // interior-facing X edge
  const faceSign = (R.cx < 0) ? 1 : -1;     // direction from facade toward interior
  const facadeMat = material('wall', fd);
  const woodTrim = darkWoodMat();

  // facade wall along the interior edge — two segments leaving a central doorway
  const doorHalf = 1.5;
  const fSegLen = (R.d / 2) - doorHalf;
  if (fSegLen > 0.3) {
    for (const sgn of [-1, 1]) {
      const seg = new THREE.Mesh(geo('shopFacadeUnit', () => new THREE.BoxGeometry(0.4, facadeH, 1)), facadeMat);
      seg.scale.z = fSegLen;
      seg.position.set(faceX, facadeH / 2, R.cz + sgn * (doorHalf + fSegLen / 2));
      group.add(seg);
      // wood pilaster framing each side of the storefront
      const pil = new THREE.Mesh(geo('shopPilaster', () => new THREE.BoxGeometry(0.5, facadeH, 0.3)), woodTrim);
      pil.position.set(faceX + faceSign * 0.05, facadeH / 2, R.cz + sgn * doorHalf);
      group.add(pil);
    }
  }
  // a wood lintel over the doorway so the gap reads as an entrance
  const lintel = new THREE.Mesh(geo('shopLintel', () => new THREE.BoxGeometry(0.5, 0.8, 1)), woodTrim);
  lintel.scale.z = doorHalf * 2;
  lintel.position.set(faceX + faceSign * 0.05, facadeH - 0.4, R.cz);
  group.add(lintel);

  // back and side walls so it reads as an enclosed shop
  buildEnclosure(group, R, facadeH, facadeMat, faceX, faceSign, out, 1.0);

  // striped awning over the storefront + a tasteful backlit sign with the label
  makeAwning(group, faceX, faceSign, R.cz, R.d - 0.6, facadeH - 0.6, 0x7a1f2e);
  const label = (f && f.label) || 'GIFT SHOP';
  const sign = makeNeonSign(label, accent, { size: 1.0 });
  sign.position.set(faceX + faceSign * 0.25, facadeH + 0.2, R.cz);
  sign.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
  group.add(sign);
  out.anims.push({ kind: 'sign', obj: sign, base: 1.6, speed: 1.2, phase: 0.5 });

  // display windows flanking the entry, with neatly stacked merch inside
  const winMat = material('glass', fd);
  const merchColors = [0x8a2030, 0x2a4a6a, 0xc9a227, 0x2f6a3e, 0x5a3a6a];
  const winZ = [R.z0 + R.d * 0.22, R.z1 - R.d * 0.22];
  for (const wz of winZ) {
    const w = new THREE.Mesh(geo('shopWin', () => new THREE.PlaneGeometry(1, 1)), winMat);
    w.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
    w.scale.set(R.d * 0.3, 2.2, 1);
    w.position.set(faceX + faceSign * 0.02, 1.4, wz);
    group.add(w);
    // a wood display shelf behind the glass with matte gift boxes
    const shelf = new THREE.Mesh(geo('shopShelf', () => new THREE.BoxGeometry(0.4, 0.06, 1)), woodTrim);
    shelf.scale.z = R.d * 0.28;
    shelf.position.set(faceX + faceSign * -0.5, 1.2, wz);
    group.add(shelf);
    for (let i = 0; i < 3; i++) {
      const c = merchColors[i % merchColors.length];
      const b = new THREE.Mesh(geo('merch', () => new THREE.BoxGeometry(0.3, 0.3, 0.3)),
        mat('merchBox_' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.1 })));
      b.position.set(faceX + faceSign * -0.5, 0.9 + (i % 2) * 0.7, wz - 0.4 + i * 0.4);
      group.add(b);
    }
  }

  // warm storefront downlight + a potted palm each side of the entry
  const dl = new THREE.PointLight(0xffe2ac, 0.6, 12, 2.0);
  dl.position.set(faceX + faceSign * 1.0, facadeH - 0.4, R.cz);
  group.add(dl);
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

// ----- RESTAURANT -----------------------------------------------
function buildRestaurant(group, f, fd, out) {
  const R = rectOf(f);
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const facadeH = 3.4;
  const faceX = (R.cx < 0) ? R.x1 : R.x0;
  const faceSign = (R.cx < 0) ? 1 : -1;
  const wallMat = material('wall', fd);

  // enclosure (back + sides), interior open toward the floor
  buildEnclosure(group, R, facadeH, wallMat, faceX, faceSign, out);

  // a low wood host/partition counter at the interior edge (gap for entry)
  const counterH = 1.05;
  const counter = new THREE.Mesh(geo('restCounterUnit', () => new THREE.BoxGeometry(0.5, counterH, 1)), material('wood', fd));
  const gapHalf = 1.6;
  const segLen = (R.d / 2) - gapHalf;
  if (segLen > 0.3) {
    for (const sgn of [-1, 1]) {
      const c = counter.clone();
      c.scale.z = segLen;
      c.position.set(faceX, counterH / 2, R.cz + sgn * (gapHalf + segLen / 2));
      group.add(c);
      // marble cap on the partition
      const capm = new THREE.Mesh(geo('restCounterCap', () => new THREE.BoxGeometry(0.6, 0.06, 1)), material('marble', fd));
      capm.scale.z = segLen;
      capm.position.set(faceX, counterH + 0.03, R.cz + sgn * (gapHalf + segLen / 2));
      group.add(capm);
    }
  }

  // upholstered booths along the back wall
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
    // high tufted booth back
    const bback = new THREE.Mesh(geo('boothBack', () => new THREE.BoxGeometry(0.18, 1.3, 1.2)), leatherMat(boothColor));
    bback.position.set(backX + faceSign * 0.18, 0.65, bz);
    group.add(bback);
    // a small dining table in front of the booth
    const tbl = makeRoundTable(0.5);
    tbl.position.set(backX + faceSign * 1.5, 0, bz);
    group.add(tbl);
    // a small warm pendant over each booth table
    const pend = makePendant();
    pend.position.set(backX + faceSign * 1.5, 2.6, bz);
    group.add(pend);

    // seat a patron at some booths
    if (i % 2 === 0) {
      const d = makeDealer({ suit: [0x2b2d42, 0x3a2e2a, 0x14213d][i % 3], accent: [0xffd23f, 0xc9a227, 0xb6c0c8][i % 3] });
      d.root.position.set(backX + faceSign * 0.6, 0.5, bz);
      d.root.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
      group.add(d.root);
      seated.push(d);
    }
  }

  // a free-standing dining table with chairs in the open area + a seated patron
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
  const diner = makeDealer({ suit: 0x2b2d42, accent: 0xc9a227 });
  diner.root.position.set(faceX + faceSign * 1.6 + 0.95, 0.5, R.cz);
  diner.root.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
  group.add(diner.root);
  seated.push(diner);

  // striped awning + tasteful backlit sign with the label
  makeAwning(group, faceX, faceSign, R.cz, R.d - 0.6, facadeH - 0.4, 0x2f4a3a);
  const label = (f && f.label) || 'DINER';
  const sign = makeNeonSign(label, accent, { size: 0.9 });
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
  const accent = (fd && fd.accent != null) ? fd.accent : COLORS.gold;
  const wallH = 4.2;
  const faceX = (R.cx < 0) ? R.x1 : R.x0;
  const faceSign = (R.cx < 0) ? 1 : -1;
  const wallMat = material('wall', fd);

  // enclosure
  buildEnclosure(group, R, wallH, wallMat, faceX, faceSign, out);

  // stage at the BACK (away from interior), raised wood platform with a brass lip
  const backX = (faceSign > 0) ? R.x0 : R.x1;
  const stageDepth = Math.min(R.w * 0.35, 3.2);
  const stageH = 0.6;
  const stage = new THREE.Mesh(geo('stageUnit', () => new THREE.BoxGeometry(1, stageH, 1)), material('wood', fd));
  stage.scale.set(stageDepth, 1, R.d - 1);
  stage.position.set(backX + faceSign * (stageDepth / 2 + 0.4), stageH / 2, R.cz);
  group.add(stage);
  const stageLip = new THREE.Mesh(geo('stageLip', () => new THREE.BoxGeometry(0.1, 0.08, 1)), brassMat());
  stageLip.scale.z = R.d - 1;
  stageLip.position.set(backX + faceSign * (stageDepth + 0.4), stageH + 0.02, R.cz);
  group.add(stageLip);

  // velvet stage curtains (left/right) — matte fabric, not emissive
  const curtainMat = fabricMat(0x7a1326);
  const curtainGeo = geo('curtain', () => new THREE.PlaneGeometry(1, 1));
  for (const sgn of [-1, 1]) {
    const cur = new THREE.Mesh(curtainGeo, curtainMat);
    cur.scale.set(R.d * 0.45, wallH - 0.3, 1);
    cur.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
    cur.position.set(backX + faceSign * 0.5, (wallH - 0.3) / 2, R.cz + sgn * (R.d * 0.28));
    group.add(cur);
  }
  // gilded top valance
  const valance = new THREE.Mesh(curtainGeo, curtainMat);
  valance.scale.set(R.d - 0.6, 1.0, 1);
  valance.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
  valance.position.set(backX + faceSign * 0.5, wallH - 0.6, R.cz);
  group.add(valance);
  const valTrim = new THREE.Mesh(geo('valanceTrim', () => new THREE.BoxGeometry(0.05, 0.08, 1)), brassMat());
  valTrim.scale.z = R.d - 0.6;
  valTrim.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
  valTrim.position.set(backX + faceSign * 0.52, wallH - 1.1, R.cz);
  group.add(valTrim);

  // matte backdrop behind the stage
  const backdrop = new THREE.Mesh(curtainGeo, fabricMat(0x2a1622));
  backdrop.scale.set(R.d - 0.8, wallH - 1.2, 1);
  backdrop.rotation.y = (faceSign > 0) ? Math.PI / 2 : -Math.PI / 2;
  backdrop.position.set(backX + faceSign * 0.3, (wallH - 1.2) / 2 + 0.3, R.cz);
  group.add(backdrop);

  // warm stage spotlights
  const spot = new THREE.PointLight(0xffe2ac, 1.1, 18, 2.0);
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

  // a couple of seated patrons in the front row
  const seated = [];
  for (let c = 0; c < Math.min(cols, 3); c++) {
    const sx = seatStartX;
    const sz = R.z0 + 0.7 + (c * 2 + 0.5) * colSpan;
    if (sz > R.z1 - 0.5) break;
    const d = makeDealer({ suit: [0x2b2d42, 0x14213d][c % 2], accent: 0xc9a227 });
    d.root.position.set(sx, 0.5, sz);
    d.root.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
    group.add(d.root);
    seated.push(d);
  }
  if (seated.length) out.anims.push({ kind: 'npcs', list: seated });

  // marquee with the label over the entrance + warm bulb border
  const label = (f && f.label) || 'SHOWROOM';
  const sign = makeNeonSign(label, accent, { size: 1.1 });
  sign.position.set(faceX + faceSign * 0.25, wallH + 0.2, R.cz);
  sign.rotation.y = (faceSign > 0) ? -Math.PI / 2 : Math.PI / 2;
  group.add(sign);
  out.anims.push({ kind: 'sign', obj: sign, base: 1.7, speed: 2.2, phase: 0.7 });

  // marquee warm-white bulbs (a row of soft glowing bulbs under the sign)
  const bulbGeo = geo('marqueeBulb', () => new THREE.SphereGeometry(0.07, 10, 8));
  const bulbMat = warmGlow(0xffe2ac, 0.7);
  const nBulb = Math.max(6, Math.min(14, Math.round(R.d)));
  for (let i = 0; i < nBulb; i++) {
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    const t = (i + 0.5) / nBulb;
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
          // gently breathe the warm sign emissive (subtle, never a harsh flicker)
          const pulse = a.base * (0.92 + 0.12 * Math.sin(t * (a.speed || 1.2) + (a.phase || 0)));
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
