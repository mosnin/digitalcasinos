// =============================================================
// Digital Casinos — characters.js
// Low-poly humanoid avatars: the player, a wandering Vegas crowd,
// and seated dealers. Built from primitives grouped under a root.
//
// Exports:
//   buildHumanoid({ suit, accent, skin, scale }) -> api
//   class NPCManager(scene)
//   makeDealer({ suit, accent, skin }) -> { root, update(dt) }
//
// Conventions: feet at y=0, total height ~1.8*scale, root is a
// THREE.Group the caller positions at ground level. Limbs pivot
// from hip/shoulder groups so animation looks jointed, not sliding.
// =============================================================

import * as THREE from 'three';

// ---- Shared geometry cache --------------------------------------------------
// Geometries carry no color, so they are safe to share across every character.
// (Sizes are roughly in "human metres" before per-humanoid scale.)
const G = {};
function geo(key, make) { return (G[key] || (G[key] = make())); }

// Low segment counts keep the poly budget modest while still reading as round.
const headGeo     = () => geo('head',     () => new THREE.SphereGeometry(0.135, 12, 10));
const hairGeo     = () => geo('hair',     () => new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62));
const eyeGeo      = () => geo('eye',      () => new THREE.SphereGeometry(0.024, 6, 6));
const neckGeo     = () => geo('neck',     () => new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8));
const torsoGeo    = () => geo('torso',    () => new THREE.CylinderGeometry(0.15, 0.17, 0.52, 10));
const hipsGeo     = () => geo('hips',     () => new THREE.CylinderGeometry(0.17, 0.15, 0.18, 10));
const lapelGeo    = () => geo('lapel',    () => new THREE.BoxGeometry(0.10, 0.30, 0.04));
const tieGeo      = () => geo('tie',      () => new THREE.BoxGeometry(0.05, 0.26, 0.03));
const upperArmGeo = () => geo('upperArm', () => new THREE.CylinderGeometry(0.052, 0.046, 0.28, 8));
const lowerArmGeo = () => geo('lowerArm', () => new THREE.CylinderGeometry(0.044, 0.038, 0.26, 8));
const handGeo     = () => geo('hand',     () => new THREE.SphereGeometry(0.05, 8, 6));
const upperLegGeo = () => geo('upperLeg', () => new THREE.CylinderGeometry(0.075, 0.062, 0.40, 8));
const lowerLegGeo = () => geo('lowerLeg', () => new THREE.CylinderGeometry(0.058, 0.046, 0.40, 8));
const shoeGeo     = () => geo('shoe',     () => new THREE.BoxGeometry(0.11, 0.07, 0.22));

// ---- Shared materials that never vary per character -------------------------
const M = {};
function sharedMat(key, make) { return (M[key] || (M[key] = make())); }
const trousersMat = () => sharedMat('trousers', () => new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.85, metalness: 0.05 }));
const shoeMat     = () => sharedMat('shoe',     () => new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.5,  metalness: 0.1 }));
const eyeMat      = () => sharedMat('eye',      () => new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.3 }));

// Small helper: a mesh with shared geo + given material at a local position.
function part(g, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;       // shadows are expensive for a crowd
  mesh.receiveShadow = false;
  return mesh;
}

// Darken a hex color for hair derived from the skin/suit palette.
function hairColor() { return 0x2a2118; }

// =============================================================
// buildHumanoid
// =============================================================
export function buildHumanoid({ suit = 0x222831, accent = 0xffd23f, skin = 0xe0ac69, scale = 1 } = {}) {
  const root = new THREE.Group();
  root.name = 'humanoid';

  // Per-humanoid materials (cloned so recolor() only affects this character).
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.7, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.65, metalness: 0.0 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor(), roughness: 0.9 });

  // A "body" group lets setPose('sit') tilt/lower everything together while
  // root stays the clean placement handle for callers.
  const body = new THREE.Group();
  root.add(body);

  // ---- Lower body: a hip pivot at the top of the legs (~y 0.84) ----
  // Legs hang down from here; feet land at y≈0.
  const legSpan = 0.10;
  const hipY = 0.84;

  function buildLeg(side) {
    // hip pivot — rotate here to swing the whole leg from the hip joint
    const hip = new THREE.Group();
    hip.position.set(side * legSpan, hipY, 0);

    const upper = part(upperLegGeo(), trousersMat(), 0, -0.20, 0); // centered on its length
    hip.add(upper);

    // knee pivot at bottom of the upper leg
    const knee = new THREE.Group();
    knee.position.set(0, -0.40, 0);
    const lower = part(lowerLegGeo(), trousersMat(), 0, -0.20, 0);
    knee.add(lower);

    const shoe = part(shoeGeo(), shoeMat(), 0, -0.40, 0.05);
    knee.add(shoe);

    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  }
  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // hips block (pelvis) sits just above the hip pivots
  body.add(part(hipsGeo(), trousersMat(), 0, hipY + 0.05, 0));

  // ---- Torso / jacket ----
  const torsoY = hipY + 0.14 + 0.26; // base of torso just above pelvis
  const torso = part(torsoGeo(), suitMat, 0, torsoY, 0);
  body.add(torso);

  // accent lapels + tie on the chest front
  const chestZ = 0.13;
  const chestY = torsoY + 0.06;
  const lapelL = part(lapelGeo(), accentMat, -0.07, chestY, chestZ - 0.02);
  lapelL.rotation.z = 0.18;
  const lapelR = part(lapelGeo(), accentMat, 0.07, chestY, chestZ - 0.02);
  lapelR.rotation.z = -0.18;
  const tie = part(tieGeo(), accentMat, 0, chestY - 0.04, chestZ);
  body.add(lapelL, lapelR, tie);

  // ---- Shoulders / arms (pivot from shoulder) ----
  const shoulderY = torsoY + 0.22;
  const shoulderSpan = 0.205;

  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderSpan, shoulderY, 0);

    const upper = part(upperArmGeo(), suitMat, 0, -0.14, 0);
    shoulder.add(upper);

    // elbow pivot
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    const lower = part(lowerArmGeo(), skinMat, 0, -0.13, 0); // forearm = skin (sleeves up look)
    const hand = part(handGeo(), skinMat, 0, -0.28, 0);
    elbow.add(lower, hand);

    shoulder.add(elbow);
    // arms rest slightly out from the body
    shoulder.rotation.z = side * 0.06;
    body.add(shoulder);
    return { shoulder, elbow };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // ---- Neck + head ----
  const neckY = shoulderY + 0.08;
  body.add(part(neckGeo(), skinMat, 0, neckY, 0));

  const head = new THREE.Group();
  head.position.set(0, neckY + 0.16, 0);
  head.add(part(headGeo(), skinMat, 0, 0, 0));

  // hair cap over the top/back of the head
  const hair = part(hairGeo(), hairMat, 0, 0.012, -0.005);
  head.add(hair);

  // simple face: two eyes facing +Z
  head.add(part(eyeGeo(), eyeMat(), -0.052, 0.012, 0.118));
  head.add(part(eyeGeo(), eyeMat(), 0.052, 0.012, 0.118));
  body.add(head);

  // Overall scale (height ~1.8 at scale 1).
  root.scale.setScalar(scale);

  // ---- Animation state ----
  let phase = Math.random() * Math.PI * 2; // desync crowd gaits
  let pose = 'stand';
  const sway = Math.random() * Math.PI * 2;

  // Rest rotations captured per-pose so the walk cycle adds onto them.
  const rest = {
    legHip: 0, legKnee: 0,
    armShoulderX: 0, armElbow: 0,
    bodyY: 0, bodyTilt: 0,
  };

  function applyRest() {
    legL.hip.rotation.x = rest.legHip; legR.hip.rotation.x = rest.legHip;
    legL.knee.rotation.x = rest.legKnee; legR.knee.rotation.x = rest.legKnee;
    armL.shoulder.rotation.x = rest.armShoulderX; armR.shoulder.rotation.x = rest.armShoulderX;
    armL.elbow.rotation.x = rest.armElbow; armR.elbow.rotation.x = rest.armElbow;
    body.position.y = rest.bodyY;
    body.rotation.x = rest.bodyTilt;
  }

  function setPose(name) {
    pose = name;
    if (name === 'sit') {
      // Bend hips ~90° (thighs forward, horizontal) and knees ~90° (shins down).
      rest.legHip = -Math.PI / 2;
      rest.legKnee = Math.PI / 2;
      rest.armShoulderX = -0.35;       // forearms toward the table
      rest.armElbow = -0.7;
      rest.bodyTilt = 0.04;
      // Lower the whole body so the seat sits at ~stool height instead of
      // hovering; the thighs now occupy what was leg height.
      rest.bodyY = -0.46; // in local (pre-scale) units; lowers seat to stool height
    } else {
      rest.legHip = 0; rest.legKnee = 0;
      rest.armShoulderX = 0; rest.armElbow = 0;
      rest.bodyTilt = 0; rest.bodyY = 0;
    }
    applyRest();
  }

  function update(dt, moving) {
    if (!(dt > 0)) dt = 0;
    if (pose === 'sit') {
      // gentle seated idle: tiny torso bob + head doesn't slide
      phase += dt * 1.6;
      const b = Math.sin(phase) * 0.01;
      body.position.y = rest.bodyY + b;
      // small forearm fidget
      const f = Math.sin(phase * 0.8) * 0.08;
      armL.elbow.rotation.x = rest.armElbow + f;
      armR.elbow.rotation.x = rest.armElbow - f;
      return;
    }

    if (moving) {
      phase += dt * 8.5; // stride frequency
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      const swing = 0.7;
      // Legs swing in opposition.
      legL.hip.rotation.x = rest.legHip + s * swing;
      legR.hip.rotation.x = rest.legHip - s * swing;
      // Knees bend on the back-swing (only flex one way).
      legL.knee.rotation.x = rest.legKnee + Math.max(0, -c) * 0.9;
      legR.knee.rotation.x = rest.legKnee + Math.max(0, c) * 0.9;
      // Arms swing opposite to the legs.
      armL.shoulder.rotation.x = rest.armShoulderX - s * swing * 0.8;
      armR.shoulder.rotation.x = rest.armShoulderX + s * swing * 0.8;
      armL.elbow.rotation.x = rest.armElbow - 0.3;
      armR.elbow.rotation.x = rest.armElbow - 0.3;
      // subtle vertical bob from the gait
      body.position.y = rest.bodyY + Math.abs(s) * 0.02;
      body.rotation.x = rest.bodyTilt;
    } else {
      // Idle: breathing + lazy sway, ease limbs back toward rest.
      phase += dt * 1.4;
      const breathe = Math.sin(phase) * 0.012;
      body.position.y = rest.bodyY + breathe;
      body.rotation.z = Math.sin(phase * 0.5 + sway) * 0.012;
      const k = Math.min(1, dt * 6);
      legL.hip.rotation.x += (rest.legHip - legL.hip.rotation.x) * k;
      legR.hip.rotation.x += (rest.legHip - legR.hip.rotation.x) * k;
      legL.knee.rotation.x += (rest.legKnee - legL.knee.rotation.x) * k;
      legR.knee.rotation.x += (rest.legKnee - legR.knee.rotation.x) * k;
      armL.shoulder.rotation.x += (rest.armShoulderX - armL.shoulder.rotation.x) * k;
      armR.shoulder.rotation.x += (rest.armShoulderX - armR.shoulder.rotation.x) * k;
      armL.elbow.rotation.x += (rest.armElbow - armL.elbow.rotation.x) * k;
      armR.elbow.rotation.x += (rest.armElbow - armR.elbow.rotation.x) * k;
    }
  }

  function recolor(opts = {}) {
    if (opts.suit != null) suitMat.color.set(opts.suit);
    if (opts.accent != null) accentMat.color.set(opts.accent);
    if (opts.skin != null) skinMat.color.set(opts.skin);
  }

  // Dispose only the per-humanoid materials we created (shared ones stay).
  function dispose() {
    suitMat.dispose(); accentMat.dispose(); skinMat.dispose(); hairMat.dispose();
  }

  setPose('stand');

  return { root, update, recolor, setPose, dispose };
}

// =============================================================
// NPCManager — wandering Vegas crowd
// =============================================================

// A small varied palette for crowd suits/accents/skins.
const SUITS  = [0x222831, 0x2b2d42, 0x3a2e2a, 0x14213d, 0x4a4e69, 0x1d2021, 0x5c3a2e, 0x33415c];
const ACCENTS = [0xffd23f, 0xff2db8, 0x18e0ff, 0xe63946, 0xeeeeee, 0x9b1bff, 0x06d6a0];
const SKINS  = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0bd];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

export class NPCManager {
  constructor(scene) {
    this.scene = scene;
    this.npcs = [];
    this._randomPoint = null;
  }

  spawnCrowd(n, randomPointFn) {
    this._randomPoint = (typeof randomPointFn === 'function') ? randomPointFn : null;
    for (let i = 0; i < n; i++) {
      const p = this._sample();
      const scale = 0.9 + Math.random() * 0.2; // 0.9–1.1
      const h = buildHumanoid({ suit: pick(SUITS), accent: pick(ACCENTS), skin: pick(SKINS), scale });
      const baseY = (p && typeof p.y === 'number') ? p.y : 0;
      h.root.position.set(p ? p.x : 0, baseY, p ? p.z : 0);
      h.root.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(h.root);

      const npc = {
        h,
        baseY,
        target: this._sample() || { x: p ? p.x : 0, z: p ? p.z : 0, y: baseY },
        speed: 1.25 + Math.random() * 0.4, // ~1.4 m/s average
        idle: 0,
        heading: h.root.rotation.y,
      };
      this.npcs.push(npc);
    }
  }

  _sample() {
    if (!this._randomPoint) return null;
    try { return this._randomPoint(); } catch (e) { return null; }
  }

  update(dt) {
    if (!(dt > 0)) return;
    for (const npc of this.npcs) {
      const root = npc.h.root;

      // Idle pause between strolls.
      if (npc.idle > 0) {
        npc.idle -= dt;
        npc.h.update(dt, false);
        continue;
      }

      const t = npc.target || {};
      const ty = (typeof t.y === 'number') ? t.y : npc.baseY;
      const dx = (t.x ?? root.position.x) - root.position.x;
      const dz = (t.z ?? root.position.z) - root.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.35) {
        // Arrived: pick a new target, sometimes loiter.
        const next = this._sample();
        if (next) npc.target = next;
        npc.baseY = (typeof npc.target.y === 'number') ? npc.target.y : npc.baseY;
        if (Math.random() < 0.35) npc.idle = 0.8 + Math.random() * 2.4;
        npc.h.update(dt, false);
        continue;
      }

      // Face direction of travel, smoothly turning toward it.
      const desired = Math.atan2(dx, dz);
      let diff = desired - npc.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      npc.heading += diff * Math.min(1, dt * 6);
      root.rotation.y = npc.heading;

      // Step toward target (don't overshoot).
      const step = Math.min(npc.speed * dt, dist);
      const inv = step / dist;
      root.position.x += dx * inv;
      root.position.z += dz * inv;
      // Ease onto the floor's y (handles cross-floor target heights gracefully).
      root.position.y += (ty - root.position.y) * Math.min(1, dt * 4);

      npc.h.update(dt, true);
    }
  }

  clear() {
    // Geometries (G) and base materials (M) are shared/cached, so we keep them.
    // Only the per-humanoid suit/accent/skin/hair materials are freed here.
    for (const npc of this.npcs) {
      this.scene.remove(npc.h.root);
      if (npc.h.dispose) npc.h.dispose();
    }
    this.npcs.length = 0;
  }
}

// =============================================================
// makeDealer — seated humanoid for behind tables
// =============================================================
export function makeDealer({ suit = 0x18101f, accent = 0xff2db8, skin = 0xc68642 } = {}) {
  const h = buildHumanoid({ suit, accent, skin, scale: 1 });
  h.setPose('sit');
  return {
    root: h.root,
    update(dt) { h.update(dt, false); }, // sit pose runs its own subtle idle
    recolor: h.recolor,
    dispose: h.dispose,
  };
}
