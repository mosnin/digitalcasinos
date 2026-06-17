// =============================================================
// Digital Casinos — decor.js
// 3D meshes for placeable DECORATIONS players buy and put on their
// owned parcels. No-build-step Three.js. Pure mesh factory — never
// throws on an unknown id (returns a small marble placeholder).
// Tile size = 6 units; each prop has feet at y=0 and fits ~1–2 tiles.
//
// Wave 5 overhaul: classy, realistic, WARM props — no saturated
// pink/cyan neon glow. Wood, marble, brass, fabric. Emissive is used
// only for tiny warm lamp accents at low intensity. Geometry and
// materials are cached at module scope and shared across props.
//
// Exports:
//   createDecorProp(id) -> THREE.Group     (feet at y=0)
//   decorCollider(id)   -> {w,d} | null    (half-extents, null=walk-through)
// =============================================================
import * as THREE from 'three';
import { COLORS, DECOR_CATALOG } from './config.js';
import { material, makeNeonSign, makeChandelier } from './aesthetics.js';

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

// Tiny WARM lamp accent (cached). Low emissive only — used for the few
// glowing details (lamp bulbs, sign backlight cores). Never saturated.
function warmAccent(color = 0xffe6b0, intensity = 0.5, roughness = 0.4, metalness = 0.1) {
  const hex = (color >>> 0);
  const key = `warm_${hex.toString(16)}_${intensity}_${roughness}_${metalness}`;
  return mat(key, () => new THREE.MeshStandardMaterial({
    color: hex, emissive: hex,
    emissiveIntensity: Math.min(intensity, 0.6),
    roughness, metalness,
  }));
}

// Themed surface material from aesthetics, with a safe fallback so we never
// throw if the helper is unavailable. Cached by kind.
function surface(kind, fallback) {
  return mat(`surf_${kind}`, () => {
    try {
      const m = material(kind);
      if (m) return m;
    } catch (e) { /* fall through */ }
    return fallback();
  });
}

const matBrass = () => surface('brass', () => standard(COLORS.brass, 0.34, 1.0));
const matWood = () => surface('wood', () => standard(0x4a2417, 0.45, 0.05));
const matMarble = () => surface('marble', () => standard(0xf3ecdd, 0.22, 0.0));

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

// Potted palm/ficus: glazed terracotta pot + soil + woody trunk + lush
// layered fronds. Matte greens, warm pot — no emissive.
function buildPlant() {
  const g = new THREE.Group();

  const potMat = standard(0x9a5230, 0.7, 0.05);   // warm glazed terracotta
  const rimMat = standard(0xb06838, 0.6, 0.08);
  // tapered pot (wider at top)
  addMesh(g, geo('plant_pot', () => new THREE.CylinderGeometry(0.42, 0.3, 0.6, 18)), potMat, 0, 0.3, 0);
  addMesh(g, geo('plant_rim', () => new THREE.CylinderGeometry(0.47, 0.45, 0.12, 18)), rimMat, 0, 0.6, 0);
  // soil disc
  addMesh(g, geo('plant_soil', () => new THREE.CylinderGeometry(0.4, 0.4, 0.04, 18)),
    standard(0x231811, 0.98), 0, 0.63, 0);

  // woody trunk
  const trunkMat = standard(0x6b4a2a, 0.9, 0.0);
  addMesh(g, geo('plant_trunk', () => new THREE.CylinderGeometry(0.07, 0.11, 1.4, 8)), trunkMat, 0, 1.3, 0);

  // foliage — two matte green tones for depth (no emissive at all)
  const leafDark = mat('plant_leafDark', () => new THREE.MeshStandardMaterial({
    color: 0x276b2c, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  }));
  const leafLight = mat('plant_leafLight', () => new THREE.MeshStandardMaterial({
    color: 0x3f9440, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
  }));
  const frondGeo = geo('plant_frondGeo', () => new THREE.ConeGeometry(0.18, 1.3, 5, 1, true));
  const crownY = 2.0;

  // outer drooping fronds
  const FRONDS = 8;
  for (let i = 0; i < FRONDS; i++) {
    const a = (i / FRONDS) * Math.PI * 2;
    const frond = new THREE.Mesh(frondGeo, (i % 2) ? leafDark : leafLight);
    frond.position.set(0, crownY, 0);
    frond.rotation.order = 'YXZ';
    frond.rotation.y = a;
    frond.rotation.x = 1.0 + (i % 2) * 0.2; // bend over
    frond.translateY(0.58);
    frond.scale.set(1, 1, 0.38); // flatten into a leaf-blade
    g.add(frond);
  }
  // inner upright shoots for a full, lush crown
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const shoot = new THREE.Mesh(frondGeo, leafLight);
    shoot.position.set(0, crownY, 0);
    shoot.rotation.order = 'YXZ';
    shoot.rotation.y = a;
    shoot.rotation.x = 0.32;
    shoot.translateY(0.52);
    shoot.scale.set(0.82, 0.95, 0.32);
    g.add(shoot);
  }
  // a couple of low filler leaves near the rim
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.0;
    const leaf = new THREE.Mesh(frondGeo, leafDark);
    leaf.position.set(0, crownY - 0.25, 0);
    leaf.rotation.order = 'YXZ';
    leaf.rotation.y = a;
    leaf.rotation.x = 1.35;
    leaf.translateY(0.45);
    leaf.scale.set(0.7, 0.7, 0.3);
    g.add(leaf);
  }

  return g;
}

// Classical statue: marble plinth + a posed figure in marble (or gold-leaf
// accents). Realistic stone — no glow. A tiny warm uplight gives it presence.
function buildStatue() {
  const g = new THREE.Group();

  const pedMat = matMarble();
  // stepped marble plinth
  addMesh(g, geo('statue_pedBase', () => new THREE.BoxGeometry(1.0, 0.18, 1.0)), pedMat, 0, 0.09, 0);
  addMesh(g, geo('statue_pedStep', () => new THREE.BoxGeometry(0.86, 0.1, 0.86)), pedMat, 0, 0.23, 0);
  addMesh(g, geo('statue_pedCol', () => new THREE.CylinderGeometry(0.34, 0.38, 0.62, 18)), pedMat, 0, 0.59, 0);
  addMesh(g, geo('statue_pedCap', () => new THREE.BoxGeometry(0.82, 0.12, 0.82)), pedMat, 0, 0.96, 0);

  // figure carved from the same warm marble; subtle brass detailing
  const figMat = mat('statue_marbleFig', () => new THREE.MeshStandardMaterial({
    color: 0xeae3d3, roughness: 0.35, metalness: 0.0,
  }));
  const brass = matBrass();

  const figure = new THREE.Group();
  figure.position.y = 1.02; // stand on plinth cap

  // hips / base
  addMesh(figure, geo('statue_hips', () => new THREE.SphereGeometry(0.22, 16, 12)), figMat, 0, 0.18, 0);
  // torso (tapered)
  const torso = addMesh(figure, geo('statue_torso', () => new THREE.CylinderGeometry(0.16, 0.24, 0.7, 14)), figMat, 0, 0.6, 0);
  torso.rotation.z = 0.08;
  // chest
  addMesh(figure, geo('statue_chest', () => new THREE.SphereGeometry(0.2, 16, 12)), figMat, 0.03, 0.98, 0);
  // head
  addMesh(figure, geo('statue_head', () => new THREE.SphereGeometry(0.15, 16, 12)), figMat, 0.05, 1.32, 0);
  // one raised arm (classical pose)
  const armUp = addMesh(figure, geo('statue_arm', () => new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8)), figMat, 0.22, 1.18, 0);
  armUp.rotation.z = -0.9;
  // gilded laurel orb in the raised hand (brass accent — not emissive)
  addMesh(figure, geo('statue_orb', () => new THREE.IcosahedronGeometry(0.1, 0)), brass, 0.46, 1.4, 0);
  // one arm at side
  const armDn = addMesh(figure, geo('statue_arm2', () => new THREE.CylinderGeometry(0.05, 0.06, 0.55, 8)), figMat, -0.2, 0.78, 0);
  armDn.rotation.z = 0.35;
  // draped robe as a tapered skirt
  addMesh(figure, geo('statue_skirt', () => new THREE.ConeGeometry(0.26, 0.5, 14)), figMat, 0, 0.1, 0);

  g.add(figure);

  // faint warm gallery uplight so the marble reads (low, warm — not neon)
  const glow = new THREE.PointLight(0xffe2b0, 0.4, 4, 2.0);
  glow.position.set(0, 1.3, 0.4);
  g.add(glow);

  return g;
}

// Carved stone tiered fountain: marble basins + carved column + calm water
// surfaces using the realistic 'water' material. Brass finial accent.
function buildFountain() {
  const g = new THREE.Group();

  const stoneMat = matMarble();

  // calm, realistic water (clear, gently reflective). Fallback to a soft
  // non-glowing blue-grey if the physical material is unavailable.
  const waterMat = surface('water', () => new THREE.MeshStandardMaterial({
    color: 0x6fa8b8, roughness: 0.15, metalness: 0.2,
    transparent: true, opacity: 0.85,
  }));

  // --- lower basin (wide) ---
  addMesh(g, geo('fnt_base', () => new THREE.CylinderGeometry(1.7, 1.8, 0.35, 28)), stoneMat, 0, 0.175, 0);
  addMesh(g, geo('fnt_wall1', () => new THREE.TorusGeometry(1.7, 0.12, 10, 28)), stoneMat, 0, 0.45, 0).rotation.x = Math.PI / 2;
  // carved scalloped lip
  addMesh(g, geo('fnt_lip1', () => new THREE.CylinderGeometry(1.74, 1.7, 0.1, 28)), stoneMat, 0, 0.5, 0);
  // water surface for lower basin
  const w1 = addMesh(g, geo('fnt_water1', () => new THREE.CircleGeometry(1.62, 28)), waterMat, 0, 0.4, 0);
  w1.rotation.x = -Math.PI / 2;

  // --- pedestal up to mid basin ---
  addMesh(g, geo('fnt_col1', () => new THREE.CylinderGeometry(0.3, 0.4, 0.7, 18)), stoneMat, 0, 0.75, 0);

  // --- mid basin ---
  addMesh(g, geo('fnt_mid', () => new THREE.CylinderGeometry(0.95, 1.0, 0.22, 24)), stoneMat, 0, 1.1, 0);
  addMesh(g, geo('fnt_midRim', () => new THREE.TorusGeometry(0.95, 0.08, 10, 24)), stoneMat, 0, 1.22, 0).rotation.x = Math.PI / 2;
  const w2 = addMesh(g, geo('fnt_water2', () => new THREE.CircleGeometry(0.9, 24)), waterMat, 0, 1.21, 0);
  w2.rotation.x = -Math.PI / 2;

  // --- top column + carved finial ---
  addMesh(g, geo('fnt_col2', () => new THREE.CylinderGeometry(0.16, 0.22, 0.55, 16)), stoneMat, 0, 1.5, 0);
  const finial = addMesh(g, geo('fnt_finial', () => new THREE.SphereGeometry(0.16, 16, 12)),
    matBrass(), 0, 1.85, 0);
  finial.userData.spin = true;

  // central jet — a thin translucent water column
  const jet = addMesh(g, geo('fnt_jet', () => new THREE.CylinderGeometry(0.05, 0.08, 0.6, 8)), waterMat, 0, 1.55, 0);
  jet.userData.flicker = true;

  return g;
}

// Real runner rug: a woven burgundy runner with a brass border strip.
// Walk-over (no collider). Slightly raised so it doesn't z-fight the floor.
function buildRedCarpet() {
  const g = new THREE.Group();
  const S = 5.6; // a touch under one 6-unit tile

  // patterned burgundy rug (reuse the aesthetics carpet weave). Fall back to
  // a plain matte burgundy fabric. No emissive — it's a real rug.
  const rugMat = surface('carpet', () => new THREE.MeshStandardMaterial({
    color: 0x6e1322, roughness: 0.97, metalness: 0.0,
  }));
  // raised slab so it reads as a mat, not z-fighting with the floor
  addMesh(g, geo('carpet_slab', () => new THREE.BoxGeometry(S, 0.05, S)), rugMat, 0, 0.025, 0);

  // a darker fabric inner field so the border reads
  addMesh(g, geo('carpet_field', () => new THREE.BoxGeometry(S - 0.7, 0.052, S - 0.7)),
    standard(0x5a0f1c, 0.97, 0.0), 0, 0.027, 0);

  // brushed-brass border (4 thin bars — real metal trim, not glowing)
  const trimMat = matBrass();
  const half = S / 2 - 0.12;
  const barLong = geo('carpet_barLong', () => new THREE.BoxGeometry(S - 0.1, 0.05, 0.14));
  const barShort = geo('carpet_barShort', () => new THREE.BoxGeometry(0.14, 0.05, S - 0.1));
  addMesh(g, barLong, trimMat, 0, 0.055, half);
  addMesh(g, barLong, trimMat, 0, 0.055, -half);
  addMesh(g, barShort, trimMat, half, 0.055, 0);
  addMesh(g, barShort, trimMat, -half, 0.055, 0);

  return g;
}

// Brass stanchions + velvet rope: two posts + a draped velvet rope.
function buildRope() {
  const g = new THREE.Group();

  const brassMat = matBrass();

  const postH = 1.05;
  const span = 2.4; // distance between posts along X
  const postGeo = geo('rope_post', () => new THREE.CylinderGeometry(0.05, 0.06, postH, 12));
  const baseGeo = geo('rope_base', () => new THREE.CylinderGeometry(0.22, 0.26, 0.08, 18));
  const baseTrimGeo = geo('rope_baseTrim', () => new THREE.TorusGeometry(0.22, 0.03, 8, 18));
  const capGeo = geo('rope_cap', () => new THREE.SphereGeometry(0.09, 16, 12));
  const ringGeo = geo('rope_ring', () => new THREE.TorusGeometry(0.09, 0.02, 8, 16));

  for (const sx of [-span / 2, span / 2]) {
    addMesh(g, baseGeo, brassMat, sx, 0.04, 0);
    addMesh(g, baseTrimGeo, brassMat, sx, 0.08, 0).rotation.x = Math.PI / 2;
    addMesh(g, postGeo, brassMat, sx, 0.04 + postH / 2, 0);
    addMesh(g, capGeo, brassMat, sx, 0.04 + postH + 0.05, 0);
    addMesh(g, ringGeo, brassMat, sx, 0.85, 0).rotation.y = Math.PI / 2;
  }

  // velvet rope: a sagging burgundy velvet tube along a Catmull-Rom curve.
  // Deep matte burgundy fabric — no emissive.
  const velvetMat = mat('rope_velvet', () => new THREE.MeshStandardMaterial({
    color: 0x6a1020, roughness: 0.75, metalness: 0.05,
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
  const ropeGeo = geo('rope_tube', () => new THREE.TubeGeometry(curve, 24, 0.05, 8, false));
  g.add(new THREE.Mesh(ropeGeo, velvetMat));

  return g;
}

// Tasteful warm backlit sign: a brass-framed walnut plinth holding a classy
// edge-lit "JACKPOT" sign (via aesthetics.makeNeonSign, now a backlit panel).
function buildNeonSign() {
  const g = new THREE.Group();

  // walnut plinth with a brass top rail
  const baseMat = matWood();
  addMesh(g, geo('sign_base', () => new THREE.BoxGeometry(2.6, 0.2, 0.6)), baseMat, 0, 0.1, 0);
  addMesh(g, geo('sign_baseTrim', () => new THREE.BoxGeometry(2.62, 0.04, 0.62)), matBrass(), 0, 0.21, 0);

  // two slim brass support posts
  const postMat = matBrass();
  const postGeo = geo('sign_post', () => new THREE.CylinderGeometry(0.045, 0.05, 1.3, 10));
  addMesh(g, postGeo, postMat, -1.0, 0.2 + 0.65, 0);
  addMesh(g, postGeo, postMat, 1.0, 0.2 + 0.65, 0);

  // the tasteful backlit sign itself (warm gold edge-lit lettering, low emissive)
  let sign = null;
  try {
    sign = makeNeonSign('JACKPOT', COLORS.gold, { size: 0.85 });
  } catch (e) {
    sign = null;
  }
  if (sign) {
    sign.position.set(0, 1.7, 0);
    g.add(sign);
  } else {
    // fallback: brass-framed walnut panel with a faint warm core (no neon)
    addMesh(g, geo('sign_fallbackPanel', () => new THREE.BoxGeometry(2.3, 0.8, 0.08)),
      matWood(), 0, 1.7, 0.0);
    addMesh(g, geo('sign_fallbackFace', () => new THREE.BoxGeometry(2.0, 0.55, 0.04)),
      warmAccent(0xffe6b0, 0.45, 0.4, 0.1), 0, 1.7, 0.06);
  }

  return g;
}

// Upholstered wood/brass bar stool: padded leather seat + turned wood column
// + brass footring and feet.
function buildBarStool() {
  const g = new THREE.Group();

  const brassMat = matBrass();
  const woodMat = matWood();
  // warm tufted leather/fabric seat — matte, no emissive
  const seatMat = mat('stool_seat', () => new THREE.MeshStandardMaterial({
    color: 0x7a2a1c, roughness: 0.6, metalness: 0.05, // oxblood leather
  }));

  const seatY = 1.05;
  // cushion (slightly domed) with a wood rim
  addMesh(g, geo('stool_seat', () => new THREE.CylinderGeometry(0.34, 0.34, 0.14, 22)), seatMat, 0, seatY, 0);
  addMesh(g, geo('stool_rim', () => new THREE.TorusGeometry(0.34, 0.05, 10, 22)), woodMat, 0, seatY - 0.06, 0)
    .rotation.x = Math.PI / 2;

  // turned wood central column with brass collar
  addMesh(g, geo('stool_col', () => new THREE.CylinderGeometry(0.06, 0.08, seatY - 0.06, 14)), woodMat, 0, (seatY - 0.06) / 2, 0);
  addMesh(g, geo('stool_collar', () => new THREE.CylinderGeometry(0.075, 0.075, 0.06, 14)), brassMat, 0, 0.42, 0);

  // splayed wood legs (4). Centered above the floor; bounded so tilted ends
  // never dip below y=0.
  const legGeo = geo('stool_leg', () => new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, woodMat);
    leg.position.set(Math.cos(a) * 0.16, 0.49, Math.sin(a) * 0.16);
    leg.rotation.x = Math.sin(a) * 0.26;
    leg.rotation.z = -Math.cos(a) * 0.26;
    g.add(leg);
    // brass foot cap resting on the floor (bottom at y=0)
    addMesh(g, geo('stool_foot', () => new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8)), brassMat,
      Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3);
  }

  // brass footring
  addMesh(g, geo('stool_footring', () => new THREE.TorusGeometry(0.26, 0.025, 8, 22)), brassMat, 0, 0.4, 0)
    .rotation.x = Math.PI / 2;

  return g;
}

// Warm crystal chandelier on a standing brass mount (no ceiling here), reusing
// aesthetics.makeChandelier() (warm gold + candle-lit crystal).
function buildChandelier() {
  const g = new THREE.Group();

  // slim brass mounting pole so it reads as a standing fixture
  const poleMat = matBrass();
  addMesh(g, geo('chand_base', () => new THREE.CylinderGeometry(0.4, 0.5, 0.1, 18)), poleMat, 0, 0.05, 0);
  addMesh(g, geo('chand_pole', () => new THREE.CylinderGeometry(0.04, 0.05, 3.0, 10)), poleMat, 0, 1.55, 0);
  // a small arched arm reaching out over where the chandelier hangs
  addMesh(g, geo('chand_arm', () => new THREE.BoxGeometry(0.9, 0.06, 0.06)), poleMat, 0.4, 3.0, 0);

  let chand = null;
  try { chand = makeChandelier(); } catch (e) { chand = null; }
  if (chand) {
    chand.scale.setScalar(0.6);
    chand.position.set(0.8, 2.6, 0);
    g.add(chand);
  } else {
    // fallback: a warm crystal cluster with a single soft warm light
    const cluster = new THREE.Group();
    const crystalMat = mat('chand_crystalFallback', () => new THREE.MeshStandardMaterial({
      color: 0xfff6e0, emissive: 0xffe6b0, emissiveIntensity: 0.4,
      roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92,
    }));
    const cGeo = geo('chand_bead', () => new THREE.OctahedronGeometry(0.1, 0));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 0.3 + (i % 3) * 0.1;
      addMesh(cluster, cGeo, crystalMat, Math.cos(a) * r, -0.1 - (i % 4) * 0.12, Math.sin(a) * r);
    }
    cluster.position.set(0.8, 2.6, 0);
    cluster.add(new THREE.PointLight(0xffd9a0, 0.9, 12, 2.0));
    g.add(cluster);
  }

  return g;
}

// Felt-top wood card table: turned wood pedestal, walnut rail + green felt,
// and a few realistic poker chips (matte, no glow).
function buildCardTable() {
  const g = new THREE.Group();

  const woodMat = matWood();
  const feltMat = mat('table_felt', () => new THREE.MeshStandardMaterial({
    color: 0x0d6b34, roughness: 0.95, metalness: 0.0, // matte green felt
  }));
  const brassMat = matBrass();

  const topY = 0.95;
  // wooden pedestal base
  addMesh(g, geo('table_base', () => new THREE.CylinderGeometry(0.5, 0.62, 0.1, 22)), woodMat, 0, 0.05, 0);
  addMesh(g, geo('table_post', () => new THREE.CylinderGeometry(0.12, 0.16, topY - 0.12, 16)), woodMat, 0, (topY - 0.12) / 2 + 0.05, 0);
  // table top: wood underside + felt surface + wood rail
  addMesh(g, geo('table_top', () => new THREE.CylinderGeometry(1.0, 1.0, 0.08, 30)), woodMat, 0, topY, 0);
  addMesh(g, geo('table_felt', () => new THREE.CylinderGeometry(0.92, 0.92, 0.02, 30)), feltMat, 0, topY + 0.05, 0);
  addMesh(g, geo('table_rail', () => new THREE.TorusGeometry(0.98, 0.06, 10, 30)), woodMat, 0, topY + 0.04, 0)
    .rotation.x = Math.PI / 2;
  // slim brass chip-rail inlay
  addMesh(g, geo('table_railInlay', () => new THREE.TorusGeometry(0.9, 0.012, 8, 30)), brassMat, 0, topY + 0.06, 0)
    .rotation.x = Math.PI / 2;

  // realistic matte poker chips — solid colored clay, NOT emissive
  const chipGeo = geo('table_chip', () => new THREE.CylinderGeometry(0.11, 0.11, 0.025, 16));
  const chipMats = [
    standard(0x9a1f2a, 0.7, 0.0),  // red
    standard(0x16314f, 0.7, 0.0),  // navy
    standard(0x1d6b3a, 0.7, 0.0),  // green
    standard(0xe8e4dc, 0.7, 0.0),  // ivory
  ];
  const chipY = topY + 0.06;
  // a tidy stack
  for (let i = 0; i < 4; i++) {
    addMesh(g, chipGeo, chipMats[i % chipMats.length], 0.35, chipY + i * 0.027, 0.1);
  }
  // a couple of loose chips
  addMesh(g, chipGeo, chipMats[0], -0.25, chipY, -0.2);
  addMesh(g, chipGeo, chipMats[2], -0.1, chipY, 0.3);

  return g;
}

// Ornate gilded/wood archway: turned wood posts on brass bases + a gilded
// arched header with carved bosses. Walk-through / walk-under (collider null).
function buildArchway() {
  const g = new THREE.Group();

  const span = 9.5;      // outer leg-to-leg, just under 2 tiles (12u)
  const postH = 3.2;     // clearance to walk under
  const radius = span / 2;

  const woodMat = matWood();
  const brassMat = matBrass();

  // turned wood posts on brass plinths with brass capitals
  const postGeo = geo('arch_post', () => new THREE.CylinderGeometry(0.18, 0.22, postH, 16));
  const baseGeo = geo('arch_base', () => new THREE.BoxGeometry(0.72, 0.22, 0.72));
  const capGeo = geo('arch_cap', () => new THREE.CylinderGeometry(0.26, 0.2, 0.16, 16));
  for (const sx of [-radius, radius]) {
    addMesh(g, baseGeo, brassMat, sx, 0.11, 0);
    addMesh(g, postGeo, woodMat, sx, 0.11 + postH / 2, 0);
    addMesh(g, capGeo, brassMat, sx, 0.11 + postH - 0.02, 0);
  }

  // gilded arched header — a half-torus in brass spanning the two posts.
  const archGeo = geo('arch_torus', () => new THREE.TorusGeometry(radius, 0.18, 14, 44, Math.PI));
  const arch = new THREE.Mesh(archGeo, brassMat);
  arch.position.set(0, 0.11 + postH, 0);
  g.add(arch);

  // a slimmer inner wood accent arch for depth
  const archGeo2 = geo('arch_torus2', () => new THREE.TorusGeometry(radius - 0.34, 0.1, 12, 44, Math.PI));
  const arch2 = new THREE.Mesh(archGeo2, woodMat);
  arch2.position.set(0, 0.11 + postH, 0);
  g.add(arch2);

  // carved gilded bosses (small brass spheres) along the arch — NOT glowing
  const bossGeo = geo('arch_boss', () => new THREE.SphereGeometry(0.1, 12, 10));
  const BOSSES = 9;
  for (let i = 0; i <= BOSSES; i++) {
    const t = i / BOSSES;
    const ang = Math.PI * t; // 0..PI along the arch
    const x = Math.cos(ang) * radius;
    const y = 0.11 + postH + Math.sin(ang) * radius;
    addMesh(g, bossGeo, brassMat, x, y, 0);
  }

  // a keystone ornament at the crown
  addMesh(g, geo('arch_keystone', () => new THREE.BoxGeometry(0.5, 0.5, 0.3)), woodMat, 0, 0.11 + postH + radius, 0);
  addMesh(g, geo('arch_keystoneTrim', () => new THREE.BoxGeometry(0.54, 0.18, 0.32)), brassMat, 0, 0.11 + postH + radius, 0);

  return g;
}

// Small marble placeholder — used for unknown ids (never throw). Warm, classy.
function buildPlaceholder() {
  const g = new THREE.Group();
  const base = matMarble();
  addMesh(g, geo('placeholder_base', () => new THREE.BoxGeometry(0.9, 0.12, 0.9)), base, 0, 0.06, 0);
  addMesh(g, geo('placeholder_cube', () => new THREE.BoxGeometry(0.7, 0.7, 0.7)), base, 0, 0.47, 0);
  // a subtle brass band so it reads as a finished object, not a debug cube
  addMesh(g, geo('placeholder_band', () => new THREE.BoxGeometry(0.74, 0.08, 0.74)), matBrass(), 0, 0.47, 0);
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
