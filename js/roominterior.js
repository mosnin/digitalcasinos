// =============================================================
// Digital Casinos — roominterior.js
// A buyable/decoratable hotel-room interior stage + a parcels-style
// build API for placing/removing decor inside the room.
//
//   createRoom({ economy, roomId, styleId }) -> { stage, api }
//
// stage : a Stage { scene, baseY:0, spawn, sampleGround, colliders,
//                   triggers, update(dt,ctx), onExit (settable) }
// api   : mirrors parcels.js for the integrator:
//   enterBuildMode(decorId), exitBuildMode(), placeUnderPlayer(pos),
//   removeUnderPlayer(pos), rotateGhost(), isBuildMode(),
//   getPrompt(pos), setStyle(styleId, cost), refresh()
//
// Wave 5 overhaul: a cozy, realistic, classy hotel room — upholstered bed
// with headboard + layered linens, warm table lamps on nightstands, drapes
// framing the window (skyline still behind glass), framed art, an area rug,
// a writing desk + armchair, baseboards + crown molding, and a warm ceiling
// fixture. NO neon glow: the style "accent" is used only as a subtle, tasteful
// trim/textile color. Real lights kept to ~2 warm point lights; everything
// else is gently emissive or lit by them.
//
// Pure Three.js, no build step. Never throws. Reuses decor + aesthetics.
// =============================================================

import * as THREE from 'three';
import { HOTEL, ROOM_STYLES, DECOR_CATALOG } from './config.js';
import * as decor from './decor.js';
import { makeWindowSkyline } from './aesthetics.js';

// ---- defensive helper: run fn, swallow throws ------------------
function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

const ROOM = (HOTEL && HOTEL.ROOM) || 9;       // interior square (X & Z span)
const ROOM_H = (HOTEL && HOTEL.ROOM_H) || 5;   // ceiling height
const HALF = ROOM / 2;
const WALL_T = 0.25;                            // wall thickness
const PICK_RANGE = 1.5;                         // metres for removeUnderPlayer
const MARGIN = 0.6;                             // keep decor off the walls

const styleDef = (id) => (id && ROOM_STYLES[id]) || ROOM_STYLES.standard;
const decorDef = (id) => (id && DECOR_CATALOG[id]) || null;

// ---- color helpers: keep everything warm & tasteful -----------
const _c = new THREE.Color();
const _c2 = new THREE.Color();
function hexOf(c) { return (c >>> 0); }
// Mix two hex colors -> hex
function mix(a, b, t) {
  _c.setHex(hexOf(a)); _c2.setHex(hexOf(b));
  return _c.lerp(_c2, THREE.MathUtils.clamp(t, 0, 1)).getHex();
}
// Tame a style accent into a soft, classy textile/trim tone (never neon):
// pull it toward a warm ivory and darken slightly so it reads as fabric/brass.
function softAccent(accentHex) { return mix(accentHex, 0xe7d6b0, 0.45); }
// A warm brass-ish trim derived from the accent (for lamp stems, frames).
function brassFrom(accentHex) { return mix(accentHex, 0xc9a227, 0.6); }
// A gentle warm lamp light color from the style "mood".
function warmMood(moodHex) { return mix(moodHex, 0xffe7c2, 0.4); }

// Clamp a world (x,z) point so it stays inside the walkable room.
function clampInside(x, z) {
  const lim = HALF - MARGIN;
  return {
    x: Math.max(-lim, Math.min(lim, x)),
    z: Math.max(-lim, Math.min(lim, z)),
  };
}
function insideRoom(x, z) {
  const lim = HALF - MARGIN;
  return x >= -lim && x <= lim && z >= -lim && z <= lim;
}

// Translucent ghost clone (mirrors parcels.makeGhost).
function makeGhost(node) {
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((m) => {
      if (!m) return m;
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.45;
      c.depthWrite = false;
      return c;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  return node;
}

export function createRoom({ economy, roomId, styleId } = {}) {
  const scene = new THREE.Scene();
  // Warm, soft interior background (replaces the cold near-black).
  scene.background = new THREE.Color(0x141016);

  // Resolve style: prefer the saved room style, else the passed styleId.
  const savedStyle = safe(() => {
    const r = economy && economy.getRoom && economy.getRoom(roomId);
    return r && r.style;
  }, null);
  let currentStyleId = savedStyle || styleId || 'standard';

  // -------------------------------------------------------------
  // Materials we re-theme live (wall / floor / textiles / trim).
  // All warm & matte; "accent" only ever appears as a soft textile/trim
  // color, never as an emissive neon glow.
  // -------------------------------------------------------------
  const st0 = styleDef(currentStyleId);

  // Warm plaster wall — tint the style wall color toward warm ivory so even
  // the dark/cool style walls read as a cozy painted room, not a dim club.
  const wallMat = new THREE.MeshStandardMaterial({
    color: mix(st0.wall, 0xe8dcc6, 0.55), roughness: 0.95, metalness: 0.0,
  });
  // Hardwood-ish floor (slightly warmer than raw style floor).
  const floorMat = new THREE.MeshStandardMaterial({
    color: mix(st0.floor, 0x7a5733, 0.3), roughness: 0.6, metalness: 0.04,
  });
  // Warm off-white ceiling.
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe7ddca, roughness: 0.96, metalness: 0.0 });
  // Painted trim: baseboards, crown molding, window/door frames (warm cream).
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf3ead7, roughness: 0.7, metalness: 0.0 });
  // Brushed-brass accent metal (lamp stems, picture frame, handle) — warm,
  // very low emissive so it has a gentle gilded sheen but never glows.
  const accentMat = new THREE.MeshStandardMaterial({
    color: brassFrom(st0.accent),
    emissive: brassFrom(st0.accent),
    emissiveIntensity: 0.06,
    roughness: 0.4, metalness: 0.9,
  });
  // Soft textile accent (blanket, throw, rug border, curtains) — matte fabric.
  const fabricMat = new THREE.MeshStandardMaterial({
    color: softAccent(st0.accent), roughness: 0.92, metalness: 0.0,
  });
  // Warm lamp shade — gently emissive (the *light* itself is a real point light).
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3df, emissive: warmMood(st0.mood), emissiveIntensity: 0.6,
    roughness: 0.55, metalness: 0.0,
  });
  // Area rug field — warm neutral wool, accent only in the border (fabricMat).
  const rugMat = new THREE.MeshStandardMaterial({
    color: mix(st0.accent, 0x6e5a3c, 0.7), roughness: 0.97, metalness: 0.0,
  });

  const colliders = [];
  const triggers = [];

  // Group that holds the static room shell (never torn down).
  const shell = new THREE.Group();
  shell.name = 'roomShell';
  scene.add(shell);

  function addMesh(parent, geo, m, x, y, z) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // ---- floor & ceiling ----
  const slabGeo = new THREE.BoxGeometry(ROOM, 0.2, ROOM);
  addMesh(shell, slabGeo, floorMat, 0, -0.1, 0);
  addMesh(shell, new THREE.BoxGeometry(ROOM, 0.2, ROOM), ceilMat, 0, ROOM_H + 0.1, 0);

  // ---- 4 walls (as meshes + Box3 colliders that keep the player inside) ----
  // Door is on the +Z wall (player spawns facing -Z into the room).
  const wallGeoX = new THREE.BoxGeometry(ROOM + WALL_T * 2, ROOM_H, WALL_T); // walls spanning X (at ±Z)
  const wallGeoZ = new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM + WALL_T * 2); // walls spanning Z (at ±X)
  const wy = ROOM_H / 2;

  // -X wall, +X wall, -Z wall (full). +Z wall split for the doorway.
  addMesh(shell, wallGeoZ, wallMat, -HALF - WALL_T / 2, wy, 0);
  addMesh(shell, wallGeoZ, wallMat, HALF + WALL_T / 2, wy, 0);
  addMesh(shell, wallGeoX, wallMat, 0, wy, -HALF - WALL_T / 2);

  // +Z wall with a doorway gap in the middle.
  const DOOR_W = 1.8, DOOR_H = 2.6;
  const sideW = (ROOM - DOOR_W) / 2;
  if (sideW > 0.05) {
    const sideGeo = new THREE.BoxGeometry(sideW + WALL_T, ROOM_H, WALL_T);
    addMesh(shell, sideGeo, wallMat, -(DOOR_W / 2 + sideW / 2), wy, HALF + WALL_T / 2);
    addMesh(shell, sideGeo, wallMat, (DOOR_W / 2 + sideW / 2), wy, HALF + WALL_T / 2);
  }
  // lintel above the door
  addMesh(shell, new THREE.BoxGeometry(DOOR_W + 0.4, ROOM_H - DOOR_H, WALL_T),
    wallMat, 0, DOOR_H + (ROOM_H - DOOR_H) / 2, HALF + WALL_T / 2);

  // ---- baseboards + crown molding (warm painted trim around the room) ----
  // Cheap chamfer-feel: thin boxes hugging the four interior wall lines.
  const BASE_H = 0.18, BASE_T = 0.06;
  const CROWN_H = 0.22, CROWN_T = 0.10;
  const inX = HALF - 0.001;
  // run along X (front/back, at ±Z) and along Z (sides, at ±X)
  const baseGeoX = new THREE.BoxGeometry(ROOM, BASE_H, BASE_T);
  const baseGeoZ = new THREE.BoxGeometry(BASE_T, BASE_H, ROOM);
  const crownGeoX = new THREE.BoxGeometry(ROOM, CROWN_H, CROWN_T);
  const crownGeoZ = new THREE.BoxGeometry(CROWN_T, CROWN_H, ROOM);
  // baseboards
  addMesh(shell, baseGeoX, trimMat, 0, BASE_H / 2, -inX + BASE_T / 2);
  addMesh(shell, baseGeoX, trimMat, 0, BASE_H / 2, inX - BASE_T / 2);
  addMesh(shell, baseGeoZ, trimMat, -inX + BASE_T / 2, BASE_H / 2, 0);
  addMesh(shell, baseGeoZ, trimMat, inX - BASE_T / 2, BASE_H / 2, 0);
  // crown molding (just below the ceiling)
  const crownY = ROOM_H - CROWN_H / 2 - 0.02;
  addMesh(shell, crownGeoX, trimMat, 0, crownY, -inX + CROWN_T / 2);
  addMesh(shell, crownGeoX, trimMat, 0, crownY, inX - CROWN_T / 2);
  addMesh(shell, crownGeoZ, trimMat, -inX + CROWN_T / 2, crownY, 0);
  addMesh(shell, crownGeoZ, trimMat, inX - CROWN_T / 2, crownY, 0);

  // Colliders: 4 thin boxes just outside each wall (full width, no door gap
  // collider so the player can pass through the door trigger). Player radius
  // is small so this reliably keeps them inside the room.
  function wallBox(x0, z0, x1, z1) {
    return new THREE.Box3(
      new THREE.Vector3(Math.min(x0, x1), 0, Math.min(z0, z1)),
      new THREE.Vector3(Math.max(x0, x1), ROOM_H, Math.max(z0, z1)),
    );
  }
  colliders.push(wallBox(-HALF - WALL_T, -HALF, -HALF, HALF));        // -X
  colliders.push(wallBox(HALF, -HALF, HALF + WALL_T, HALF));          // +X
  colliders.push(wallBox(-HALF, -HALF - WALL_T, HALF, -HALF));        // -Z
  // +Z wall split into two side colliders, leaving the doorway open.
  colliders.push(wallBox(-HALF, HALF, -(DOOR_W / 2), HALF + WALL_T)); // +Z left
  colliders.push(wallBox(DOOR_W / 2, HALF, HALF, HALF + WALL_T));     // +Z right

  // ---- door panel (a tasteful paneled door + brass handle + warm exit sign) ----
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.55, metalness: 0.1 });
  const doorGroup = new THREE.Group();
  doorGroup.name = 'roomDoor';
  const doorPanel = addMesh(doorGroup, new THREE.BoxGeometry(DOOR_W - 0.1, DOOR_H, 0.08), doorMat,
    0, DOOR_H / 2, 0);
  doorPanel.position.z = HALF + 0.02;
  // two inset panels for a paneled-door look (thin recessed rectangles)
  const doorInsetMat = new THREE.MeshStandardMaterial({ color: 0x3a2112, roughness: 0.6, metalness: 0.08 });
  addMesh(doorGroup, new THREE.BoxGeometry(DOOR_W - 0.55, DOOR_H * 0.36, 0.03), doorInsetMat,
    0, DOOR_H * 0.7, HALF + 0.065);
  addMesh(doorGroup, new THREE.BoxGeometry(DOOR_W - 0.55, DOOR_H * 0.36, 0.03), doorInsetMat,
    0, DOOR_H * 0.28, HALF + 0.065);
  // door casing (warm trim frame around the doorway, room side)
  addMesh(doorGroup, new THREE.BoxGeometry(DOOR_W + 0.3, 0.12, 0.05), trimMat, 0, DOOR_H + 0.06, HALF + 0.03);
  addMesh(doorGroup, new THREE.BoxGeometry(0.12, DOOR_H + 0.12, 0.05), trimMat, -(DOOR_W / 2 + 0.05), DOOR_H / 2, HALF + 0.03);
  addMesh(doorGroup, new THREE.BoxGeometry(0.12, DOOR_H + 0.12, 0.05), trimMat, (DOOR_W / 2 + 0.05), DOOR_H / 2, HALF + 0.03);
  // brass handle
  addMesh(doorGroup, new THREE.SphereGeometry(0.07, 12, 10), accentMat, DOOR_W / 2 - 0.35, DOOR_H / 2, HALF + 0.07);
  // small warm-white "EXIT" plate above the door (tasteful, low emissive — not a neon tube)
  addMesh(doorGroup, new THREE.BoxGeometry(0.5, 0.16, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffe7bf, emissiveIntensity: 0.5, roughness: 0.5 }),
    0, DOOR_H + 0.2, HALF + 0.04);
  shell.add(doorGroup);

  // ---- upholstered bed: frame + mattress + layered linens + pillows + headboard ----
  // Place against the -X wall.
  const bed = new THREE.Group();
  bed.name = 'bed';
  const bedW = 2.4, bedL = 4.0, frameH = 0.5;
  const bedX = -HALF + 1.5;
  const bedZ = -HALF + 2.6;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.6, metalness: 0.1 });
  // upholstered headboard fabric (warm taupe, padded look)
  const headboardMat = new THREE.MeshStandardMaterial({ color: 0x6b5640, roughness: 0.9, metalness: 0.0 });
  const sheetMat = new THREE.MeshStandardMaterial({ color: 0xf6f1e7, roughness: 0.9, metalness: 0.0 });
  const duvetMat = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.92, metalness: 0.0 });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xfbf7ef, roughness: 0.95, metalness: 0.0 });
  // wooden frame / base
  addMesh(bed, new THREE.BoxGeometry(bedW, frameH, bedL), frameMat, 0, frameH / 2, 0);
  // mattress
  addMesh(bed, new THREE.BoxGeometry(bedW - 0.16, 0.38, bedL - 0.16), sheetMat, 0, frameH + 0.19, 0);
  // crisp white top sheet (thin layer)
  addMesh(bed, new THREE.BoxGeometry(bedW - 0.12, 0.06, bedL - 0.12), sheetMat, 0, frameH + 0.41, 0);
  // duvet/comforter covering most of the bed (ivory, layered above the sheet)
  addMesh(bed, new THREE.BoxGeometry(bedW - 0.08, 0.14, bedL * 0.78), duvetMat,
    0, frameH + 0.47, bedL * 0.10);
  // folded throw blanket across the foot (accent textile — soft, matte)
  const throwBlanket = addMesh(bed, new THREE.BoxGeometry(bedW - 0.04, 0.10, bedL * 0.26), fabricMat,
    0, frameH + 0.56, bedL * 0.30);
  throwBlanket.userData.accent = true;
  // upholstered headboard against the wall (toward -Z end)
  addMesh(bed, new THREE.BoxGeometry(bedW + 0.24, 1.4, 0.2), headboardMat, 0, 0.95, -bedL / 2 - 0.06);
  // headboard accent welt (thin accent strip near the top — subtle textile trim)
  const welt = addMesh(bed, new THREE.BoxGeometry(bedW + 0.26, 0.06, 0.06), fabricMat, 0, 1.6, -bedL / 2 - 0.06);
  welt.userData.accent = true;
  // four plump pillows at the head (-Z end): two large shams + two sleeping pillows
  addMesh(bed, new THREE.BoxGeometry(bedW / 2 - 0.16, 0.26, 0.78), pillowMat, -bedW / 4, frameH + 0.52, -bedL / 2 + 0.62);
  addMesh(bed, new THREE.BoxGeometry(bedW / 2 - 0.16, 0.26, 0.78), pillowMat, bedW / 4, frameH + 0.52, -bedL / 2 + 0.62);
  // smaller accent lumbar pillow in front
  const lumbar = addMesh(bed, new THREE.BoxGeometry(bedW * 0.5, 0.2, 0.42), fabricMat, 0, frameH + 0.56, -bedL / 2 + 1.25);
  lumbar.userData.accent = true;
  bed.position.set(bedX, 0, bedZ);
  shell.add(bed);

  // ---- two nightstands, each with a warm table lamp ----
  // Only ONE carries a real point light; the other's shade is emissive only,
  // to keep real lights to ~2 (this + the ceiling fixture).
  const nsMat = new THREE.MeshStandardMaterial({ color: 0x33210f, roughness: 0.55, metalness: 0.1 });
  let lampLight = null; // primary warm bedside light (real)

  function makeNightstand(withRealLight) {
    const g = new THREE.Group();
    // small two-tier wood nightstand
    addMesh(g, new THREE.BoxGeometry(0.72, 0.62, 0.62), nsMat, 0, 0.31, 0);
    // thin drawer line + tiny brass knob
    addMesh(g, new THREE.BoxGeometry(0.64, 0.02, 0.64), frameMat, 0, 0.42, 0);
    addMesh(g, new THREE.SphereGeometry(0.035, 8, 6), accentMat, 0, 0.42, 0.32);
    // lamp: brass stem + warm shade
    addMesh(g, new THREE.CylinderGeometry(0.05, 0.08, 0.42, 12), accentMat, 0, 0.62 + 0.21, 0);
    const shade = addMesh(g, new THREE.CylinderGeometry(0.18, 0.26, 0.3, 16), lampMat, 0, 0.62 + 0.5, 0);
    shade.userData.lampShade = true;
    if (withRealLight) {
      const l = new THREE.PointLight(warmMood(st0.mood), 1.0, 5.5, 2.0);
      l.position.set(0, 0.62 + 0.5, 0);
      g.add(l);
      lampLight = l;
    }
    return g;
  }
  const ns1 = makeNightstand(true);
  ns1.position.set(bedX + bedW / 2 + 0.66, 0, bedZ - bedL / 2 + 0.45);
  shell.add(ns1);
  const ns2 = makeNightstand(false);
  ns2.position.set(bedX - bedW / 2 - 0.66, 0, bedZ - bedL / 2 + 0.45);
  shell.add(ns2);

  // ---- framed picture over the bed (warm matte art + brass frame) ----
  const artGroup = new THREE.Group();
  const artMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85, metalness: 0.0 });
  // frame (brass), slightly larger than the canvas
  addMesh(artGroup, new THREE.BoxGeometry(1.7, 1.1, 0.06), accentMat, 0, 0, 0);
  // canvas inset
  addMesh(artGroup, new THREE.BoxGeometry(1.5, 0.9, 0.03), artMat, 0, 0, 0.03);
  // a calm horizon stripe on the canvas (warm sky over land — emissive-free)
  addMesh(artGroup, new THREE.BoxGeometry(1.46, 0.32, 0.01),
    new THREE.MeshStandardMaterial({ color: 0xcaa873, roughness: 0.9 }), 0, 0.22, 0.045);
  // hang on the -X wall above the headboard
  artGroup.position.set(-HALF + 0.12, ROOM_H * 0.6, bedZ);
  artGroup.rotation.y = Math.PI / 2;
  shell.add(artGroup);

  // ---- area rug (centered, warm wool with a soft accent border) ----
  const rugGroup = new THREE.Group();
  const rugW = ROOM * 0.46, rugD = ROOM * 0.4;
  addMesh(rugGroup, new THREE.BoxGeometry(rugW, 0.04, rugD), rugMat, 0, 0.02, 0);
  // thin inset accent border (four matte fabric bars)
  const bThk = 0.12, bh = 0.045;
  const halfW = rugW / 2 - bThk, halfD = rugD / 2 - bThk;
  const rb1 = addMesh(rugGroup, new THREE.BoxGeometry(rugW - bThk, 0.01, bThk), fabricMat, 0, bh, halfD);
  const rb2 = addMesh(rugGroup, new THREE.BoxGeometry(rugW - bThk, 0.01, bThk), fabricMat, 0, bh, -halfD);
  const rb3 = addMesh(rugGroup, new THREE.BoxGeometry(bThk, 0.01, rugD - bThk), fabricMat, halfW, bh, 0);
  const rb4 = addMesh(rugGroup, new THREE.BoxGeometry(bThk, 0.01, rugD - bThk), fabricMat, -halfW, bh, 0);
  rb1.userData.accent = rb2.userData.accent = rb3.userData.accent = rb4.userData.accent = true;
  rugGroup.position.set(0.6, 0, 1.0);
  rugGroup.userData.rug = true;
  shell.add(rugGroup);

  // ---- writing desk + chair against the +X wall ----
  const desk = new THREE.Group();
  const deskTop = new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.5, metalness: 0.1 });
  const deskW = 1.6, deskD = 0.7, deskH = 0.78;
  addMesh(desk, new THREE.BoxGeometry(deskW, 0.06, deskD), deskTop, 0, deskH, 0);
  const legGeo = new THREE.BoxGeometry(0.07, deskH, 0.07);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addMesh(desk, legGeo, frameMat, sx * (deskW / 2 - 0.08), deskH / 2, sz * (deskD / 2 - 0.08));
  }
  // a small brass desk lamp (emissive shade only — no extra real light)
  addMesh(desk, new THREE.CylinderGeometry(0.04, 0.06, 0.3, 10), accentMat, deskW / 2 - 0.3, deskH + 0.15, 0);
  const deskShade = addMesh(desk, new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    lampMat, deskW / 2 - 0.3, deskH + 0.3, 0);
  deskShade.rotation.x = Math.PI;
  deskShade.userData.lampShade = true;
  desk.position.set(HALF - 0.5, 0, -1.4);
  desk.rotation.y = -Math.PI / 2;
  shell.add(desk);

  // ---- cozy armchair near the window ----
  const chair = new THREE.Group();
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.92, metalness: 0.0 });
  // seat
  addMesh(chair, new THREE.BoxGeometry(0.8, 0.18, 0.8), chairMat, 0, 0.45, 0);
  // seat cushion (accent textile)
  const seatCush = addMesh(chair, new THREE.BoxGeometry(0.7, 0.14, 0.7), fabricMat, 0, 0.58, 0);
  seatCush.userData.accent = true;
  // back
  addMesh(chair, new THREE.BoxGeometry(0.8, 0.7, 0.16), chairMat, 0, 0.85, -0.32);
  // armrests
  addMesh(chair, new THREE.BoxGeometry(0.14, 0.3, 0.8), chairMat, -0.33, 0.62, 0);
  addMesh(chair, new THREE.BoxGeometry(0.14, 0.3, 0.8), chairMat, 0.33, 0.62, 0);
  // short wooden legs
  const cLegGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.38, 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addMesh(chair, cLegGeo, frameMat, sx * 0.32, 0.19, sz * 0.32);
  }
  chair.position.set(HALF - 1.6, 0, 2.6);
  chair.rotation.y = -Math.PI * 0.8;
  shell.add(chair);

  // ---- big window on the -Z wall with skyline behind glass + drapes ----
  const skyline = safe(() => makeWindowSkyline(), null);
  if (skyline) {
    skyline.position.set(0, ROOM_H * 0.55, -HALF - 0.5);
    // skyline plane is 130x30; shrink so a slice fills the window opening
    skyline.scale.set(0.055, 0.06, 1);
    shell.add(skyline);
  }
  // window glass on -Z wall
  const winW = ROOM * 0.62, winH = ROOM_H * 0.55;
  const winCY = ROOM_H * 0.55;
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xcfe7ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
  });
  addMesh(shell, new THREE.PlaneGeometry(winW, winH), glassMat, 0, winCY, -HALF + 0.02);
  // painted window frame (warm trim, not accent)
  addMesh(shell, new THREE.BoxGeometry(winW + 0.3, 0.14, 0.12), trimMat, 0, winCY + winH / 2, -HALF + 0.06);
  addMesh(shell, new THREE.BoxGeometry(winW + 0.3, 0.16, 0.12), trimMat, 0, winCY - winH / 2, -HALF + 0.06); // sill (thicker)
  addMesh(shell, new THREE.BoxGeometry(0.12, winH, 0.12), trimMat, -winW / 2, winCY, -HALF + 0.06);
  addMesh(shell, new THREE.BoxGeometry(0.12, winH, 0.12), trimMat, winW / 2, winCY, -HALF + 0.06);
  // muntins (thin cross bars) for a classier window
  addMesh(shell, new THREE.BoxGeometry(winW, 0.05, 0.06), trimMat, 0, winCY, -HALF + 0.07);
  addMesh(shell, new THREE.BoxGeometry(0.05, winH, 0.06), trimMat, 0, winCY, -HALF + 0.07);

  // drapes/curtains framing the window (soft accent textile, gently pleated
  // via a few stacked panels). A valance runs across the top.
  const drapeTop = winCY + winH / 2 + 0.25;
  const drapeBot = 0.15;
  const drapeH = drapeTop - drapeBot;
  const drapeCY = (drapeTop + drapeBot) / 2;
  const drapePanelW = 0.5;
  function makeDrape(sideX) {
    const g = new THREE.Group();
    // three overlapping pleat slabs for a soft folded look
    for (let i = 0; i < 3; i++) {
      const w = drapePanelW - i * 0.08;
      addMesh(g, new THREE.BoxGeometry(w, drapeH, 0.07), fabricMat, (i - 1) * 0.12, 0, 0.01)
        .userData.accent = true;
    }
    g.position.set(sideX, drapeCY, -HALF + 0.16);
    return g;
  }
  shell.add(makeDrape(-(winW / 2 + drapePanelW / 2 + 0.05)));
  shell.add(makeDrape(winW / 2 + drapePanelW / 2 + 0.05));
  // valance / pelmet across the top
  const valance = addMesh(shell, new THREE.BoxGeometry(winW + drapePanelW * 2 + 0.4, 0.34, 0.16),
    fabricMat, 0, drapeTop - 0.1, -HALF + 0.18);
  valance.userData.accent = true;
  // brass curtain rod above
  addMesh(shell, new THREE.CylinderGeometry(0.035, 0.035, winW + drapePanelW * 2 + 0.6, 10),
    accentMat, 0, drapeTop + 0.08, -HALF + 0.2).rotation.z = Math.PI / 2;

  // ---- warm ceiling light fixture (flush-mount, brass + warm diffuser) ----
  const fixture = new THREE.Group();
  addMesh(fixture, new THREE.CylinderGeometry(0.45, 0.5, 0.08, 20), accentMat, 0, 0, 0);
  const diffuser = addMesh(fixture, new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xfff5e6, emissive: 0xffe8c4, emissiveIntensity: 0.55, roughness: 0.5 }),
    0, -0.04, 0);
  diffuser.rotation.x = Math.PI;
  diffuser.userData.ceilDiffuser = true;
  fixture.position.set(0, ROOM_H - 0.12, 0);
  shell.add(fixture);

  // ---- lighting (warm, ~2 real point lights + ambient/hemi fill) ----
  const ambient = new THREE.AmbientLight(0xffe8cc, 0.55);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0x3a2c22, 0.7);
  scene.add(hemi);
  // primary warm ceiling light (real)
  const ceilLight = new THREE.PointLight(warmMood(st0.mood), 1.0, ROOM * 1.7, 2.0);
  ceilLight.position.set(0, ROOM_H - 0.5, 0);
  scene.add(ceilLight);
  // (lampLight, the bedside lamp, is the second real light — added above)

  // -------------------------------------------------------------
  // Exit trigger at the door.
  // -------------------------------------------------------------
  triggers.push({
    pos: new THREE.Vector3(0, 1, HALF - 0.4),
    radius: 2.2,
    prompt: 'Leave room — [E]',
    action: () => { safe(() => stage.onExit && stage.onExit()); },
  });

  // -------------------------------------------------------------
  // Decor placement: root group + registry of placed props.
  // -------------------------------------------------------------
  const decorRoot = new THREE.Group();
  decorRoot.name = 'roomDecor';
  scene.add(decorRoot);

  // node -> { index } ; index references economy.getRoomDecor(roomId)[index]
  const registry = new Map();
  // track which economy indices we've already spawned (idempotent refresh)
  const spawned = new Set();

  function applyRot(node, rot) {
    const r = Number(rot);
    if (Number.isFinite(r)) node.rotation.y = r;
  }

  function spawnDecorAt(index, d) {
    if (!d) return;
    if (spawned.has(index)) return;
    const node = safe(() => decor.createDecorProp(d.id), null);
    if (!node) { spawned.add(index); return; }
    const p = clampInside(Number(d.x) || 0, Number(d.z) || 0);
    node.position.set(p.x, 0, p.z);
    applyRot(node, d.rot);
    node.userData.roomDecor = { index, id: d.id };
    decorRoot.add(node);
    registry.set(node, { index, id: d.id });
    spawned.add(index);
  }

  function clearDecor() {
    for (const [node] of Array.from(registry)) decorRoot.remove(node);
    registry.clear();
    spawned.clear();
  }

  // api.refresh() — clear and respawn all decor from economy.
  function refresh() {
    clearDecor();
    const list = safe(() => economy.getRoomDecor(roomId), []) || [];
    for (let i = 0; i < list.length; i++) spawnDecorAt(i, list[i]);
  }

  // -------------------------------------------------------------
  // Build mode + ghost preview.
  // -------------------------------------------------------------
  let pending = null;   // decorId string
  let ghost = null;     // Object3D
  let ghostRot = 0;     // radians
  let lastPlayerPos = null;

  function clearGhost() {
    if (ghost) { decorRoot.remove(ghost); ghost = null; }
  }

  function buildGhost() {
    clearGhost();
    if (!pending) return;
    const node = safe(() => decor.createDecorProp(pending), null);
    if (!node) return;
    makeGhost(node);
    node.rotation.y = ghostRot;
    node.renderOrder = 4;
    ghost = node;
    decorRoot.add(ghost);
    positionGhost();
  }

  function positionGhost() {
    if (!ghost) return;
    const p = lastPlayerPos
      ? clampInside(lastPlayerPos.x, lastPlayerPos.z)
      : { x: 0, z: 0 };
    ghost.position.set(p.x, 0, p.z);
    ghost.visible = true;
  }

  function enterBuildMode(decorId) {
    if (!decorId) { pending = null; clearGhost(); return; }
    pending = String(decorId);
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

  // -------------------------------------------------------------
  // Place under the player (charges economy, spawns real prop).
  // -------------------------------------------------------------
  function placeUnderPlayer(pos) {
    if (!pending) return { ok: false, reason: 'nothing selected' };
    if (!pos) return { ok: false, reason: 'no position' };
    if (!insideRoom(pos.x, pos.z)) {
      const c = clampInside(pos.x, pos.z);
      // still allow placement at the clamped point if remotely inside;
      // but if the player is well outside, refuse.
      if (Math.abs(pos.x) > HALF + 1 || Math.abs(pos.z) > HALF + 1) {
        return { ok: false, reason: 'outside room' };
      }
      pos = c;
    }
    const def = decorDef(pending);
    const cost = (def && Number(def.cost)) || 0;
    const p = clampInside(pos.x, pos.z);
    const res = safe(() => economy.addRoomDecor(
      roomId, pending, { x: p.x, z: p.z, rot: ghostRot }, cost,
    ), { ok: false, reason: 'error' });
    if (res && res.ok) {
      const idx = (res.index != null)
        ? res.index
        : ((safe(() => economy.getRoomDecor(roomId), []) || []).length - 1);
      spawnDecorAt(idx, { id: pending, x: p.x, z: p.z, rot: ghostRot });
      // keep ghost active so the player can place more.
      return res;
    }
    return res || { ok: false, reason: 'could not place' };
  }

  // -------------------------------------------------------------
  // Remove nearest placed decor (within ~1.5m).
  // -------------------------------------------------------------
  function removeUnderPlayer(pos) {
    if (!pos) return false;
    let best = null, bestD = Infinity;
    for (const [node, meta] of registry) {
      const dx = node.position.x - pos.x;
      const dz = node.position.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { node, meta }; }
    }
    if (!best || Math.sqrt(bestD) > PICK_RANGE) return false;
    const ok = safe(() => economy.removeRoomDecor(roomId, best.meta.index), false);
    // Indices shift after a splice — drop everything and rebuild from economy.
    if (ok) { refresh(); return true; }
    // Even if economy failed, remove the node so the scene matches.
    decorRoot.remove(best.node);
    registry.delete(best.node);
    spawned.delete(best.meta.index);
    return false;
  }

  // -------------------------------------------------------------
  // setStyle — persist + re-theme materials live.
  // -------------------------------------------------------------
  function applyStyleColors(s) {
    wallMat.color.setHex(mix(s.wall, 0xe8dcc6, 0.55));
    floorMat.color.setHex(mix(s.floor, 0x7a5733, 0.3));
    // brass-ish accent metal
    accentMat.color.setHex(brassFrom(s.accent));
    accentMat.emissive.setHex(brassFrom(s.accent));
    // soft fabric accent (curtains, throw, rug border, cushions)
    fabricMat.color.setHex(softAccent(s.accent));
    // warm rug field
    rugMat.color.setHex(mix(s.accent, 0x6e5a3c, 0.7));
    // warm lamp glow tint
    lampMat.emissive.setHex(warmMood(s.mood));
    safe(() => { if (lampLight) lampLight.color.setHex(warmMood(s.mood)); });
    safe(() => { ceilLight.color.setHex(warmMood(s.mood)); });
  }

  function setStyle(newStyleId, cost) {
    if (!newStyleId) return { ok: false, reason: 'no style' };
    const res = safe(() => economy.setRoomStyle(roomId, newStyleId, Number(cost) || 0),
      { ok: false, reason: 'error' });
    if (res && res.ok) {
      currentStyleId = newStyleId;
      applyStyleColors(styleDef(newStyleId));
      return res;
    }
    return res || { ok: false, reason: 'could not set style' };
  }

  // -------------------------------------------------------------
  // Prompts.
  // -------------------------------------------------------------
  function getPrompt(_pos) {
    if (pending) {
      return 'Decorate: [G] items · [F] place · [X] remove · [R] rotate · [E] leave';
    }
    return 'Decorate: [G] items · [F] place · [X] remove · [E] leave';
  }

  function isBuildMode() { return !!pending; }

  // -------------------------------------------------------------
  // Stage update — track player so the ghost follows them.
  // -------------------------------------------------------------
  function update(_dt, ctx) {
    const pos = ctx && ctx.playerPos;
    if (pos) {
      lastPlayerPos = { x: pos.x, z: pos.z };
      if (ghost) positionGhost();
    }
    // very gentle warm lamp breathing for life (subtle, not a flicker)
    safe(() => {
      if (lampLight) lampLight.intensity = 0.95 + 0.06 * Math.sin(performance.now() * 0.0018);
    });
  }

  // -------------------------------------------------------------
  // Stage object.
  // -------------------------------------------------------------
  const spawnX = (DOOR_W / 2 + 0.0) * 0; // centered on door X
  const stage = {
    scene,
    id: roomId,
    baseY: 0,
    spawn: { x: 0, z: HALF - 1.5, heading: 0 }, // heading 0 faces -Z, into the room toward the window
    sampleGround() { return 0; },
    colliders,
    triggers,
    update,
    onExit: null, // settable by integrator
  };
  void spawnX;

  // Initial decor load.
  refresh();

  const api = {
    enterBuildMode,
    exitBuildMode,
    placeUnderPlayer,
    removeUnderPlayer,
    rotateGhost,
    isBuildMode,
    getPrompt,
    setStyle,
    refresh,
    get pending() { return pending; },
  };

  return { stage, api };
}

export default createRoom;
