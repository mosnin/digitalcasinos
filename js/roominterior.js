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
  scene.background = new THREE.Color(0x07060c);

  // Resolve style: prefer the saved room style, else the passed styleId.
  const savedStyle = safe(() => {
    const r = economy && economy.getRoom && economy.getRoom(roomId);
    return r && r.style;
  }, null);
  let currentStyleId = savedStyle || styleId || 'standard';

  // -------------------------------------------------------------
  // Materials we re-theme live (wall / floor / accent).
  // -------------------------------------------------------------
  const st0 = styleDef(currentStyleId);
  const wallMat = new THREE.MeshStandardMaterial({ color: st0.wall, roughness: 0.9, metalness: 0.04 });
  const floorMat = new THREE.MeshStandardMaterial({ color: st0.floor, roughness: 0.85, metalness: 0.05 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.95, metalness: 0.0 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: st0.accent, emissive: st0.accent, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.2,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: st0.mood, emissive: st0.mood, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.0,
  });
  const rugMat = new THREE.MeshStandardMaterial({
    color: st0.accent, emissive: st0.accent, emissiveIntensity: 0.12, roughness: 0.95, metalness: 0.0,
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

  // ---- door panel (in the doorway, slightly ajar look — flat panel) ----
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.6, metalness: 0.1 });
  const doorGroup = new THREE.Group();
  doorGroup.name = 'roomDoor';
  const doorPanel = addMesh(doorGroup, new THREE.BoxGeometry(DOOR_W - 0.1, DOOR_H, 0.08), doorMat,
    0, DOOR_H / 2, 0);
  doorPanel.position.z = HALF + 0.02;
  // door handle (accent)
  addMesh(doorGroup, new THREE.SphereGeometry(0.07, 10, 8), accentMat, DOOR_W / 2 - 0.35, DOOR_H / 2, HALF + 0.07);
  // glowing EXIT strip above door
  addMesh(doorGroup, new THREE.BoxGeometry(DOOR_W, 0.12, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x35e06a, emissive: 0x35e06a, emissiveIntensity: 1.0 }),
    0, DOOR_H + 0.18, HALF + 0.03);
  shell.add(doorGroup);

  // ---- bed (frame + mattress + pillows + headboard) ----
  // Place against the -X wall.
  const bed = new THREE.Group();
  bed.name = 'bed';
  const bedW = 2.4, bedL = 4.0, frameH = 0.5;
  const bedX = -HALF + 1.5;
  const bedZ = -HALF + 2.6;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7, metalness: 0.1 });
  const mattressMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.85, metalness: 0.0 });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xfbf7ef, roughness: 0.9, metalness: 0.0 });
  const blanketMat = new THREE.MeshStandardMaterial({ color: st0.accent, roughness: 0.8, metalness: 0.05 });
  // frame
  addMesh(bed, new THREE.BoxGeometry(bedW, frameH, bedL), frameMat, 0, frameH / 2, 0);
  // mattress
  addMesh(bed, new THREE.BoxGeometry(bedW - 0.2, 0.35, bedL - 0.2), mattressMat, 0, frameH + 0.175, 0);
  // blanket (accent, covers lower 2/3)
  const blanket = addMesh(bed, new THREE.BoxGeometry(bedW - 0.16, 0.12, bedL * 0.62), blanketMat,
    0, frameH + 0.4, bedL * 0.16);
  blanket.userData.accent = true;
  // headboard against the wall (toward -Z end)
  addMesh(bed, new THREE.BoxGeometry(bedW + 0.2, 1.3, 0.18), frameMat, 0, 0.65, -bedL / 2 - 0.05);
  // two pillows at the head (-Z end)
  addMesh(bed, new THREE.BoxGeometry(bedW / 2 - 0.2, 0.22, 0.7), pillowMat, -bedW / 4, frameH + 0.45, -bedL / 2 + 0.6);
  addMesh(bed, new THREE.BoxGeometry(bedW / 2 - 0.2, 0.22, 0.7), pillowMat, bedW / 4, frameH + 0.45, -bedL / 2 + 0.6);
  bed.position.set(bedX, 0, bedZ);
  shell.add(bed);

  // ---- nightstand + glowing lamp ----
  const nightstand = new THREE.Group();
  const nsMat = new THREE.MeshStandardMaterial({ color: 0x241810, roughness: 0.6, metalness: 0.1 });
  addMesh(nightstand, new THREE.BoxGeometry(0.7, 0.7, 0.7), nsMat, 0, 0.35, 0);
  // lamp base + shade (emissive shade = lamp glow)
  addMesh(nightstand, new THREE.CylinderGeometry(0.05, 0.07, 0.45, 10), accentMat, 0, 0.7 + 0.225, 0);
  const shade = addMesh(nightstand, new THREE.CylinderGeometry(0.22, 0.28, 0.3, 14), lampMat, 0, 0.7 + 0.55, 0);
  shade.userData.lampShade = true;
  const lampLight = new THREE.PointLight(st0.mood, 1.2, 6, 2.0);
  lampLight.position.set(0, 0.7 + 0.55, 0);
  nightstand.add(lampLight);
  nightstand.position.set(bedX + bedW / 2 + 0.7, 0, bedZ - bedL / 2 + 0.4);
  shell.add(nightstand);

  // ---- big window on the -Z wall with skyline behind glass ----
  const skyline = safe(() => makeWindowSkyline(), null);
  if (skyline) {
    skyline.position.set(0, ROOM_H * 0.55, -HALF - 0.5);
    // skyline plane is 130x30; shrink so a slice fills the window opening
    skyline.scale.set(0.055, 0.06, 1);
    shell.add(skyline);
  }
  // window frame + glass on -Z wall
  const winW = ROOM * 0.62, winH = ROOM_H * 0.55;
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
  });
  addMesh(shell, new THREE.PlaneGeometry(winW, winH), glassMat, 0, ROOM_H * 0.55, -HALF + 0.02);
  // frame bars (accent)
  const frameBarMat = accentMat;
  addMesh(shell, new THREE.BoxGeometry(winW + 0.2, 0.12, 0.12), frameBarMat, 0, ROOM_H * 0.55 + winH / 2, -HALF + 0.05);
  addMesh(shell, new THREE.BoxGeometry(winW + 0.2, 0.12, 0.12), frameBarMat, 0, ROOM_H * 0.55 - winH / 2, -HALF + 0.05);
  addMesh(shell, new THREE.BoxGeometry(0.12, winH, 0.12), frameBarMat, -winW / 2, ROOM_H * 0.55, -HALF + 0.05);
  addMesh(shell, new THREE.BoxGeometry(0.12, winH, 0.12), frameBarMat, winW / 2, ROOM_H * 0.55, -HALF + 0.05);

  // ---- rug (center of the room) ----
  const rug = addMesh(shell, new THREE.BoxGeometry(ROOM * 0.4, 0.04, ROOM * 0.4), rugMat, 0.5, 0.025, 1.0);
  rug.userData.rug = true;

  // ---- wall-mounted TV on +X wall (emissive screen) ----
  const tv = new THREE.Group();
  const tvBodyMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.5, metalness: 0.4 });
  const tvScreenMat = new THREE.MeshStandardMaterial({
    color: 0x101830, emissive: st0.mood, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.0,
  });
  addMesh(tv, new THREE.BoxGeometry(0.12, 1.4, 2.4), tvBodyMat, 0, 0, 0);
  const screen = addMesh(tv, new THREE.PlaneGeometry(2.2, 1.2), tvScreenMat, -0.07, 0, 0);
  screen.rotation.y = -Math.PI / 2;
  screen.userData.tvScreen = true;
  tv.position.set(HALF - 0.08, ROOM_H * 0.5, 1.5);
  shell.add(tv);

  // ---- lighting ----
  const ambient = new THREE.AmbientLight(0xfff0dd, 0.5);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0x1a1018, 0.6);
  scene.add(hemi);
  const ceilLight = new THREE.PointLight(st0.mood, 0.9, ROOM * 1.6, 2.0);
  ceilLight.position.set(0, ROOM_H - 0.6, 0);
  scene.add(ceilLight);

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
    wallMat.color.setHex(s.wall >>> 0);
    floorMat.color.setHex(s.floor >>> 0);
    accentMat.color.setHex(s.accent >>> 0);
    accentMat.emissive.setHex(s.accent >>> 0);
    blanketMat.color.setHex(s.accent >>> 0);
    rugMat.color.setHex(s.accent >>> 0);
    rugMat.emissive.setHex(s.accent >>> 0);
    lampMat.color.setHex(s.mood >>> 0);
    lampMat.emissive.setHex(s.mood >>> 0);
    tvScreenMat.emissive.setHex(s.mood >>> 0);
    safe(() => { lampLight.color.setHex(s.mood >>> 0); });
    safe(() => { ceilLight.color.setHex(s.mood >>> 0); });
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
    // gentle lamp flicker for life
    safe(() => { if (lampLight) lampLight.intensity = 1.1 + 0.12 * Math.sin(performance.now() * 0.003); });
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
