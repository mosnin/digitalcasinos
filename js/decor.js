// =============================================================
// Digital Casinos — decor.js
// 3D meshes for placeable DECORATIONS players buy and put on their
// owned parcels. No-build-step Three.js. Pure mesh factory — never
// throws on an unknown id (returns a small gold placeholder cube).
// Tile size = 6 units; each prop has feet at y=0 and fits ~1–2 tiles.
//
// Exports:
//   createDecorProp(id) -> THREE.Group     (feet at y=0)
//   decorCollider(id)   -> {w,d} | null    (half-extents, null=walk-through)
// =============================================================
import * as THREE from 'three';
import { COLORS, DECOR_CATALOG } from './config.js';
import { neonMaterial, material, makeNeonSign, makeChandelier } from './aesthetics.js';

// ----------------------------------------------------------------
// Shared geometry / material caches (module scope) so repeated props
// don't reallocate. Everything here is read-only after creation.
// ----------------------------------------------------------------
const _geo = new Map();
function geo(key, make) {
  let g = _geo.get(key);
  if (!g) { g = make(); _geo.set(key, g); }
  return g;
}

const _mat = new Map();
function mat(key, make) {
  let m = _mat.get(key);
  if (!m) { m = make(); _mat.set(key, m); }
  return m;
}

// Plain (non-emissive) standard material helper, cached by params.
function standard(color, roughness = 0.7, metalness = 0.0, extra) {
  const hex = (color >>> 0);
  const key = `std_${hex.toString(16)}_${roughness}_${metalness}_${extra ? JSON.stringify(extra) : ''}`;
  return mat(key, () => new THREE.MeshStandardMaterial(Object.assign({
    color: hex, roughness, metalness,
  }, extra || {})));
}

// Emissive accent material (cached). Wrapper over neonMaterial when a
// pure neon glow is wanted; otherwise a tinted emissive.
function emissive(color, intensity = 0.6, roughness = 0.4, metalness = 0.0) {
  const hex = (color >>> 0);
  const key = `emi_${hex.toString(16)}_${intensity}_${roughness}_${metalness}`;
  return mat(key, () => new THREE.MeshStandardMaterial({
    color: hex, emissive: hex, emissiveIntensity: intensity, roughness, metalness,
  }));
}

// Small convenience to add a mesh with a position in one line.
function addMesh(parent, g, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// ----------------------------------------------------------------
// Individual builders. Each returns a THREE.Group with feet at y=0.
// ----------------------------------------------------------------

// Potted palm: terracotta-ish pot + dirt + trunk + angled frond planes.
function buildPlant() {
  const g = new THREE.Group();

  const potMat = standard(0x8a4b2a, 0.85, 0.05);
  const rimMat = standard(0xa05c34, 0.8, 0.05);
  // tapered pot (wider at top)
  addMesh(g, geo('plant_pot', () => new THREE.CylinderGeometry(0.42, 0.3, 0.6, 16)), potMat, 0, 0.3, 0);
  addMesh(g, geo('plant_rim', () => new THREE.CylinderGeometry(0.46, 0.44, 0.1, 16)), rimMat, 0, 0.6, 0);
  // soil disc
  addMesh(g, geo('plant_soil', () => new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16)),
    standard(0x231811, 0.95), 0, 0.62, 0);

  // trunk
  const trunkMat = standard(0x6b4a2a, 0.9, 0.0);
  addMesh(g, geo('plant_trunk', () => new THREE.CylinderGeometry(0.07, 0.11, 1.5, 8)), trunkMat, 0, 1.35, 0);

  // fronds — flattened cones radiating out & up from the crown
  const frondMat = mat('plant_frond', () => new THREE.MeshStandardMaterial({
    color: 0x2e7d32, emissive: 0x0c2e12, emissiveIntensity: 0.25,
    roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
  }));
  const frondGeo = geo('plant_frondGeo', () => new THREE.ConeGeometry(0.16, 1.25, 5, 1, true));
  const crownY = 2.05;
  const FRONDS = 7;
  for (let i = 0; i < FRONDS; i++) {
    const a = (i / FRONDS) * Math.PI * 2;
    const frond = new THREE.Mesh(frondGeo, frondMat);
    frond.position.set(0, crownY, 0);
    // splay outwards: tilt away from vertical, rotate around Y
    frond.rotation.order = 'YXZ';
    frond.rotation.y = a;
    frond.rotation.x = 0.95 + (i % 2) * 0.18; // bend over
    // push tip outward by moving along local up after rotation
    frond.translateY(0.55);
    frond.scale.set(1, 1, 0.35); // flatten into a leaf-blade
    g.add(frond);
  }
  // a couple of inner upright shoots for fullness
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const shoot = new THREE.Mesh(frondGeo, frondMat);
    shoot.position.set(0, crownY, 0);
    shoot.rotation.order = 'YXZ';
    shoot.rotation.y = a;
    shoot.rotation.x = 0.35;
    shoot.translateY(0.5);
    shoot.scale.set(0.8, 0.9, 0.3);
    g.add(shoot);
  }

  return g;
}

// Gold statue: pedestal + abstract posed figure in emissive metallic gold.
function buildStatue() {
  const g = new THREE.Group();

  // marble-ish pedestal (try aesthetics marble, fall back to stone)
  let pedMat;
  try { pedMat = material('marble'); } catch (e) { pedMat = null; }
  if (!pedMat) pedMat = standard(0xe8e2d6, 0.3, 0.1);
  addMesh(g, geo('statue_pedBase', () => new THREE.BoxGeometry(1.0, 0.18, 1.0)), pedMat, 0, 0.09, 0);
  addMesh(g, geo('statue_pedCol', () => new THREE.CylinderGeometry(0.36, 0.4, 0.7, 16)), pedMat, 0, 0.53, 0);
  addMesh(g, geo('statue_pedCap', () => new THREE.BoxGeometry(0.85, 0.12, 0.85)), pedMat, 0, 0.94, 0);

  // gold material — strongly emissive + metallic so it pops in dim light.
  const goldMat = mat('statue_gold', () => new THREE.MeshStandardMaterial({
    color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 0.55,
    roughness: 0.18, metalness: 1.0,
  }));
  const figure = new THREE.Group();
  figure.position.y = 1.0; // stand on pedestal cap

  // abstract posed figure: stacked + slightly twisted forms.
  // hips / base
  addMesh(figure, geo('statue_hips', () => new THREE.SphereGeometry(0.22, 14, 12)), goldMat, 0, 0.18, 0);
  // torso (tapered)
  const torso = addMesh(figure, geo('statue_torso', () => new THREE.CylinderGeometry(0.16, 0.24, 0.7, 12)), goldMat, 0, 0.6, 0);
  torso.rotation.z = 0.08;
  // chest block
  addMesh(figure, geo('statue_chest', () => new THREE.SphereGeometry(0.2, 14, 12)), goldMat, 0.03, 0.98, 0);
  // head
  addMesh(figure, geo('statue_head', () => new THREE.SphereGeometry(0.15, 14, 12)), goldMat, 0.05, 1.32, 0);
  // one raised arm (holding pose)
  const armUp = addMesh(figure, geo('statue_arm', () => new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8)), goldMat, 0.22, 1.18, 0);
  armUp.rotation.z = -0.9;
  // orb/coin in the raised hand
  addMesh(figure, geo('statue_orb', () => new THREE.IcosahedronGeometry(0.1, 0)), goldMat, 0.46, 1.4, 0);
  // one arm at side
  const armDn = addMesh(figure, geo('statue_arm2', () => new THREE.CylinderGeometry(0.05, 0.06, 0.55, 8)), goldMat, -0.2, 0.78, 0);
  armDn.rotation.z = 0.35;
  // draped legs as a tapered skirt
  addMesh(figure, geo('statue_skirt', () => new THREE.ConeGeometry(0.26, 0.5, 12)), goldMat, 0, 0.1, 0);

  g.add(figure);

  // faint warm uplight so the gold glints
  const glow = new THREE.PointLight(COLORS.gold, 0.5, 5, 2.0);
  glow.position.set(0, 1.4, 0.3);
  g.add(glow);

  return g;
}

// Coin fountain: tiered basins + shimmering emissive water discs + glow.
function buildFountain() {
  const g = new THREE.Group();

  let stoneMat;
  try { stoneMat = material('marble'); } catch (e) { stoneMat = null; }
  if (!stoneMat) stoneMat = standard(0xd8d2c4, 0.35, 0.1);

  // water material — cyan, emissive & translucent so it shimmers.
  let waterMat;
  try { waterMat = material('water'); } catch (e) { waterMat = null; }
  if (!waterMat) {
    waterMat = mat('fountain_water', () => new THREE.MeshStandardMaterial({
      color: COLORS.water, emissive: COLORS.water, emissiveIntensity: 0.4,
      roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.82,
    }));
  }

  // --- lower basin (wide) ---
  addMesh(g, geo('fnt_base', () => new THREE.CylinderGeometry(1.7, 1.8, 0.35, 28)), stoneMat, 0, 0.175, 0);
  addMesh(g, geo('fnt_wall1', () => new THREE.TorusGeometry(1.7, 0.12, 10, 28)), stoneMat, 0, 0.45, 0).rotation.x = Math.PI / 2;
  // water surface for lower basin
  const w1 = addMesh(g, geo('fnt_water1', () => new THREE.CircleGeometry(1.62, 28)), waterMat, 0, 0.4, 0);
  w1.rotation.x = -Math.PI / 2;

  // --- pedestal up to mid basin ---
  addMesh(g, geo('fnt_col1', () => new THREE.CylinderGeometry(0.3, 0.4, 0.7, 16)), stoneMat, 0, 0.75, 0);

  // --- mid basin ---
  addMesh(g, geo('fnt_mid', () => new THREE.CylinderGeometry(0.95, 1.0, 0.22, 22)), stoneMat, 0, 1.1, 0);
  addMesh(g, geo('fnt_midRim', () => new THREE.TorusGeometry(0.95, 0.08, 10, 22)), stoneMat, 0, 1.22, 0).rotation.x = Math.PI / 2;
  const w2 = addMesh(g, geo('fnt_water2', () => new THREE.CircleGeometry(0.9, 22)), waterMat, 0, 1.21, 0);
  w2.rotation.x = -Math.PI / 2;

  // --- top column + finial ---
  addMesh(g, geo('fnt_col2', () => new THREE.CylinderGeometry(0.16, 0.22, 0.55, 14)), stoneMat, 0, 1.5, 0);
  const finial = addMesh(g, geo('fnt_finial', () => new THREE.SphereGeometry(0.16, 14, 12)),
    emissive(COLORS.gold, 0.7, 0.25, 0.9), 0, 1.85, 0);
  finial.userData.spin = true;

  // central jet — a thin translucent water column
  const jet = addMesh(g, geo('fnt_jet', () => new THREE.CylinderGeometry(0.05, 0.08, 0.6, 8)), waterMat, 0, 1.55, 0);
  jet.userData.flicker = true;

  // a few gold "coins" resting in the lower basin
  const coinMat = emissive(COLORS.gold, 0.55, 0.3, 0.95);
  const coinGeo = geo('fnt_coin', () => new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 0.7 + (i % 2) * 0.5;
    const coin = addMesh(g, coinGeo, coinMat, Math.cos(a) * r, 0.42, Math.sin(a) * r);
    coin.rotation.x = -Math.PI / 2;
    coin.rotation.z = a;
  }

  // watery glow from within
  const glow = new THREE.PointLight(COLORS.water, 0.7, 6, 2.0);
  glow.position.set(0, 0.8, 0);
  g.add(glow);

  return g;
}

// Red carpet tile: a flat, slightly raised plane with soft emissive trim.
function buildRedCarpet() {
  const g = new THREE.Group();
  const S = 5.6; // a touch under one 6-unit tile
  const carpetMat = mat('carpet_red', () => new THREE.MeshStandardMaterial({
    color: 0x8a0f1a, emissive: 0x3a0408, emissiveIntensity: 0.3,
    roughness: 0.95, metalness: 0.0,
  }));
  // raised slab so it reads as a mat, not z-fighting with the floor
  addMesh(g, geo('carpet_slab', () => new THREE.BoxGeometry(S, 0.06, S)), carpetMat, 0, 0.03, 0);

  // soft glowing gold trim border (4 thin emissive bars)
  const trimMat = emissive(COLORS.gold, 0.7, 0.4, 0.2);
  const half = S / 2 - 0.12;
  const barLong = geo('carpet_barLong', () => new THREE.BoxGeometry(S - 0.1, 0.07, 0.16));
  const barShort = geo('carpet_barShort', () => new THREE.BoxGeometry(0.16, 0.07, S - 0.1));
  addMesh(g, barLong, trimMat, 0, 0.065, half);
  addMesh(g, barLong, trimMat, 0, 0.065, -half);
  addMesh(g, barShort, trimMat, half, 0.065, 0);
  addMesh(g, barShort, trimMat, -half, 0.065, 0);

  return g;
}

// Velvet rope: two brass posts + a draped velvet rope between them.
function buildRope() {
  const g = new THREE.Group();

  let brassMat;
  try { brassMat = material('brass'); } catch (e) { brassMat = null; }
  if (!brassMat) brassMat = standard(COLORS.brass, 0.3, 0.95);

  const postH = 1.05;
  const span = 2.4; // distance between posts along X
  const postGeo = geo('rope_post', () => new THREE.CylinderGeometry(0.05, 0.06, postH, 12));
  const baseGeo = geo('rope_base', () => new THREE.CylinderGeometry(0.22, 0.26, 0.08, 16));
  const capGeo = geo('rope_cap', () => new THREE.SphereGeometry(0.09, 14, 12));
  const ringGeo = geo('rope_ring', () => new THREE.TorusGeometry(0.09, 0.02, 8, 16));

  for (const sx of [-span / 2, span / 2]) {
    addMesh(g, baseGeo, brassMat, sx, 0.04, 0);
    addMesh(g, postGeo, brassMat, sx, 0.04 + postH / 2, 0);
    addMesh(g, capGeo, brassMat, sx, 0.04 + postH + 0.05, 0);
    addMesh(g, ringGeo, brassMat, sx, 0.85, 0).rotation.y = Math.PI / 2;
  }

  // velvet rope: a sagging curve approximated by a thin tube along a Catmull-Rom.
  const velvetMat = mat('rope_velvet', () => new THREE.MeshStandardMaterial({
    color: COLORS.neon, emissive: 0x4a0a30, emissiveIntensity: 0.45,
    roughness: 0.6, metalness: 0.1,
  }));
  const attachY = 0.85;
  const sag = 0.28;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span / 2, attachY, 0),
    new THREE.Vector3(-span / 4, attachY - sag * 0.85, 0),
    new THREE.Vector3(0, attachY - sag, 0),
    new THREE.Vector3(span / 4, attachY - sag * 0.85, 0),
    new THREE.Vector3(span / 2, attachY, 0),
  ]);
  const ropeGeo = geo('rope_tube', () => new THREE.TubeGeometry(curve, 24, 0.045, 8, false));
  g.add(new THREE.Mesh(ropeGeo, velvetMat));

  return g;
}

// Neon sign on a small base — reuse aesthetics.makeNeonSign('JACKPOT').
function buildNeonSign() {
  const g = new THREE.Group();

  // small dark base / plinth
  const baseMat = standard(0x14121a, 0.7, 0.3);
  addMesh(g, geo('sign_base', () => new THREE.BoxGeometry(2.6, 0.18, 0.6)), baseMat, 0, 0.09, 0);

  // two slim support posts
  const postMat = standard(0x2a2630, 0.6, 0.4);
  const postGeo = geo('sign_post', () => new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8));
  addMesh(g, postGeo, postMat, -1.0, 0.18 + 0.65, 0);
  addMesh(g, postGeo, postMat, 1.0, 0.18 + 0.65, 0);

  // the glowing sign itself
  let sign;
  try {
    sign = makeNeonSign('JACKPOT', COLORS.neon, { size: 0.85 });
  } catch (e) {
    sign = null;
  }
  if (sign) {
    sign.position.set(0, 1.7, 0);
    g.add(sign);
  } else {
    // fallback emissive bar if the sign helper is unavailable
    addMesh(g, geo('sign_fallback', () => new THREE.BoxGeometry(2.2, 0.7, 0.08)),
      neonMaterial(COLORS.neon, 1.6), 0, 1.7, 0);
  }

  return g;
}

// Bar stool: round padded seat + footring + chrome legs.
function buildBarStool() {
  const g = new THREE.Group();

  const chromeMat = standard(0xcfd4da, 0.25, 0.95);
  const seatMat = mat('stool_seat', () => new THREE.MeshStandardMaterial({
    color: COLORS.neon, emissive: 0x3a0826, emissiveIntensity: 0.4,
    roughness: 0.55, metalness: 0.15,
  }));

  const seatY = 1.05;
  // cushion (slightly domed via squashed cylinder + torus rim)
  addMesh(g, geo('stool_seat', () => new THREE.CylinderGeometry(0.34, 0.34, 0.12, 20)), seatMat, 0, seatY, 0);
  addMesh(g, geo('stool_rim', () => new THREE.TorusGeometry(0.34, 0.05, 10, 20)), chromeMat, 0, seatY - 0.06, 0)
    .rotation.x = Math.PI / 2;

  // central column
  addMesh(g, geo('stool_col', () => new THREE.CylinderGeometry(0.06, 0.07, seatY - 0.06, 12)), chromeMat, 0, (seatY - 0.06) / 2, 0);

  // splayed legs (4) from a small hub near the base. Centered a touch above
  // the floor and length-bounded so the tilted ends never dip below y=0.
  const legGeo = geo('stool_leg', () => new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, chromeMat);
    leg.position.set(Math.cos(a) * 0.16, 0.49, Math.sin(a) * 0.16);
    leg.rotation.x = Math.sin(a) * 0.26;
    leg.rotation.z = -Math.cos(a) * 0.26;
    g.add(leg);
    // foot pad resting on the floor (bottom at y=0)
    addMesh(g, geo('stool_foot', () => new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8)), chromeMat,
      Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3);
  }

  // chrome footring
  addMesh(g, geo('stool_footring', () => new THREE.TorusGeometry(0.26, 0.025, 8, 20)), chromeMat, 0, 0.4, 0)
    .rotation.x = Math.PI / 2;

  return g;
}

// Chandelier decoration: reuse aesthetics.makeChandelier(), scaled down,
// hanging from a short ceiling-less mount so it stands on the floor.
function buildChandelier() {
  const g = new THREE.Group();

  // slim mounting pole so it reads as a standing fixture (no ceiling here)
  const poleMat = standard(0x2a2530, 0.5, 0.6);
  addMesh(g, geo('chand_base', () => new THREE.CylinderGeometry(0.4, 0.5, 0.1, 16)), poleMat, 0, 0.05, 0);
  addMesh(g, geo('chand_pole', () => new THREE.CylinderGeometry(0.04, 0.05, 3.0, 8)), poleMat, 0, 1.55, 0);
  // a small arched arm reaching out over where the chandelier hangs
  addMesh(g, geo('chand_arm', () => new THREE.BoxGeometry(0.9, 0.06, 0.06)), poleMat, 0.4, 3.0, 0);

  let chand;
  try { chand = makeChandelier(); } catch (e) { chand = null; }
  if (chand) {
    chand.scale.setScalar(0.6);
    // hang it below the arm tip; makeChandelier's body sits around its origin,
    // so place origin at ~2.6 and let beads drape below.
    chand.position.set(0.8, 2.6, 0);
    g.add(chand);
  } else {
    // fallback: a glowing crystal cluster
    const cluster = new THREE.Group();
    const crystalMat = mat('chand_crystal', () => new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xfff3c0, emissiveIntensity: 1.1,
      roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9,
    }));
    const cGeo = geo('chand_bead', () => new THREE.IcosahedronGeometry(0.12, 0));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 0.3 + (i % 3) * 0.1;
      addMesh(cluster, cGeo, crystalMat, Math.cos(a) * r, -0.1 - (i % 4) * 0.12, Math.sin(a) * r);
    }
    cluster.position.set(0.8, 2.6, 0);
    cluster.add(new THREE.PointLight(0xffe6a8, 1.0, 12, 2.0));
    g.add(cluster);
  }

  return g;
}

// Lounge card table: round table with green felt top + a couple of chips.
function buildCardTable() {
  const g = new THREE.Group();

  const woodMat = standard(0x3a2414, 0.6, 0.1);
  const feltMat = mat('table_felt', () => new THREE.MeshStandardMaterial({
    color: 0x0d6b34, emissive: 0x052816, emissiveIntensity: 0.3,
    roughness: 0.9, metalness: 0.0,
  }));

  const topY = 0.95;
  // wooden pedestal base
  addMesh(g, geo('table_base', () => new THREE.CylinderGeometry(0.5, 0.62, 0.1, 20)), woodMat, 0, 0.05, 0);
  addMesh(g, geo('table_post', () => new THREE.CylinderGeometry(0.12, 0.16, topY - 0.12, 14)), woodMat, 0, (topY - 0.12) / 2 + 0.05, 0);
  // table top: wood underside + felt surface + wood rail
  addMesh(g, geo('table_top', () => new THREE.CylinderGeometry(1.0, 1.0, 0.08, 28)), woodMat, 0, topY, 0);
  addMesh(g, geo('table_felt', () => new THREE.CylinderGeometry(0.92, 0.92, 0.02, 28)), feltMat, 0, topY + 0.05, 0);
  addMesh(g, geo('table_rail', () => new THREE.TorusGeometry(0.98, 0.06, 10, 28)), woodMat, 0, topY + 0.04, 0)
    .rotation.x = Math.PI / 2;

  // a small stack of poker chips + a couple loose ones, slightly emissive
  const chipGeo = geo('table_chip', () => new THREE.CylinderGeometry(0.11, 0.11, 0.025, 16));
  const chipCols = [COLORS.neon, COLORS.neon2, COLORS.gold, 0xffffff];
  const chipY = topY + 0.06;
  // stack
  for (let i = 0; i < 4; i++) {
    addMesh(g, chipGeo, emissive(chipCols[i % chipCols.length], 0.35, 0.5, 0.1),
      0.35, chipY + i * 0.027, 0.1);
  }
  // a couple of loose chips
  addMesh(g, chipGeo, emissive(COLORS.gold, 0.4, 0.5, 0.1), -0.25, chipY, -0.2);
  addMesh(g, chipGeo, emissive(COLORS.neon2, 0.4, 0.5, 0.1), -0.1, chipY, 0.3);

  return g;
}

// Neon archway: two posts + an arched emissive top spanning ~2 tiles.
// Walk-through / walk-under (collider is null).
function buildArchway() {
  const g = new THREE.Group();

  const span = 9.5;      // outer leg-to-leg, just under 2 tiles (12u)
  const postH = 3.2;     // clearance to walk under
  const radius = span / 2;

  // dark structural posts
  const postMat = standard(0x16131c, 0.6, 0.4);
  const postGeo = geo('arch_post', () => new THREE.CylinderGeometry(0.18, 0.22, postH, 14));
  const baseGeo = geo('arch_base', () => new THREE.BoxGeometry(0.7, 0.2, 0.7));
  for (const sx of [-radius, radius]) {
    addMesh(g, baseGeo, postMat, sx, 0.1, 0);
    addMesh(g, postGeo, postMat, sx, 0.1 + postH / 2, 0);
  }

  // emissive neon arch: a half-torus spanning the two posts.
  const archMat = neonMaterial(COLORS.neon, 1.6);
  const archGeo = geo('arch_torus', () => new THREE.TorusGeometry(radius, 0.16, 12, 40, Math.PI));
  const arch = new THREE.Mesh(archGeo, archMat);
  arch.position.set(0, 0.1 + postH, 0);
  // torus is in XY plane; default half (0..PI) is the upper half — good.
  g.add(arch);

  // a second, inner accent arch in the secondary neon color
  const archGeo2 = geo('arch_torus2', () => new THREE.TorusGeometry(radius - 0.32, 0.08, 10, 40, Math.PI));
  const arch2 = new THREE.Mesh(archGeo2, neonMaterial(COLORS.neon2, 1.4));
  arch2.position.set(0, 0.1 + postH, 0);
  g.add(arch2);

  // glowing light bulbs running along the arch
  const bulbMat = emissive(COLORS.gold, 1.2, 0.3, 0.2);
  const bulbGeo = geo('arch_bulb', () => new THREE.SphereGeometry(0.09, 10, 8));
  const BULBS = 11;
  for (let i = 0; i <= BULBS; i++) {
    const t = i / BULBS;
    const ang = Math.PI * t; // 0..PI along the arch
    const x = Math.cos(ang) * radius;
    const y = 0.1 + postH + Math.sin(ang) * radius;
    addMesh(g, bulbGeo, bulbMat, x, y, 0);
  }

  // a couple of point lights to cast the neon glow onto the floor
  const l1 = new THREE.PointLight(COLORS.neon, 0.6, 12, 2.0);
  l1.position.set(0, postH * 0.9, 0);
  g.add(l1);

  return g;
}

// Small gold placeholder cube — used for unknown ids (never throw).
function buildPlaceholder() {
  const g = new THREE.Group();
  const m = mat('placeholder_gold', () => new THREE.MeshStandardMaterial({
    color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 0.5,
    roughness: 0.35, metalness: 0.8,
  }));
  addMesh(g, geo('placeholder_cube', () => new THREE.BoxGeometry(0.8, 0.8, 0.8)), m, 0, 0.4, 0);
  return g;
}

// ----------------------------------------------------------------
// Builder dispatch table
// ----------------------------------------------------------------
const BUILDERS = {
  plant: buildPlant,
  statue: buildStatue,
  fountain: buildFountain,
  redcarpet: buildRedCarpet,
  rope: buildRope,
  neonsign: buildNeonSign,
  barstool: buildBarStool,
  chandelier: buildChandelier,
  cardtable: buildCardTable,
  archway: buildArchway,
};

// ----------------------------------------------------------------
// createDecorProp(id) -> THREE.Group  (feet at y=0)
// ----------------------------------------------------------------
export function createDecorProp(id) {
  const build = (id != null && BUILDERS[id]) ? BUILDERS[id] : buildPlaceholder;
  let group;
  try {
    group = build();
  } catch (e) {
    // Defensive: never throw out of the factory.
    group = buildPlaceholder();
  }
  if (!group || !group.isObject3D) group = buildPlaceholder();
  group.userData.decorId = (id != null) ? String(id) : 'placeholder';
  group.name = `decor:${group.userData.decorId}`;
  return group;
}

// ----------------------------------------------------------------
// decorCollider(id) -> {w,d} | null
// Half-extents (world units) for optional XZ collision.
// null  => walk-through / walk-under (redcarpet, archway, and unknown ids).
// ----------------------------------------------------------------
const COLLIDERS = {
  // solid-ish props get a small footprint box (half-extents)
  plant: { w: 0.5, d: 0.5 },
  statue: { w: 0.6, d: 0.6 },
  fountain: { w: 1.85, d: 1.85 },
  cardtable: { w: 1.0, d: 1.0 },
  barstool: { w: 0.4, d: 0.4 },
  chandelier: { w: 0.5, d: 0.5 },   // the standing mount/base
  neonsign: { w: 1.3, d: 0.35 },    // thin sign base
  rope: { w: 1.3, d: 0.25 },        // thin: posts + rope line
  // walk-through / walk-under
  redcarpet: null,
  archway: null,
};

export function decorCollider(id) {
  if (id == null) return null;
  // Only ids explicitly listed return a box; everything else (incl. unknown) is null.
  return Object.prototype.hasOwnProperty.call(COLLIDERS, id) ? COLLIDERS[id] : null;
}

// Touch DECOR_CATALOG so the import is meaningful and ids stay in sync if
// the catalog ever drives validation elsewhere (no-op at runtime).
void DECOR_CATALOG;
