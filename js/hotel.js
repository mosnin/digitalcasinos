// =============================================================
// Digital Casinos — hotel.js
// Buildable hotel towers + a luxury penthouse, each rendered as its
// own "Stage" (THREE.Scene). Floors are long hallways lined with
// numbered, buyable rooms; the penthouse is an open rooftop suite
// level with a pool and bar. Built lazily and cached.
//
// Exports: createHotel({ economy }) -> hotel
//   hotel.floorCount
//   hotel.getFloor(i) -> Stage
//   hotel.getPenthouse() -> Stage
//   hotel.randomWalkablePoint(i) -> { x, z }
//   hotel.refresh()
//   hotel.onElevator / onEnterRoom / onBuyRoom  (settable callbacks)
//
// Never throws on missing data. Reuses geometry/materials.
// =============================================================

import * as THREE from 'three';
import {
  HOTEL, ROOM_STYLES, COLORS,
  hotelDoorSlots, clamp,
} from './config.js';
import * as aesthetics from './aesthetics.js';
import * as characters from './characters.js';

// ----------------------------------------------------------------
// Shared geometry — a unit box reused (scaled) for every wall/slab.
// ----------------------------------------------------------------
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

const HALF = HOTEL.HALL_LEN / 2;     // hallway extends Z ∈ [-HALF, HALF]
const HW = HOTEL.HALL_W;             // hallway width (X)
const HHW = HW / 2;                  // half width
const HH = HOTEL.H;                  // ceiling height
const WALL_T = 0.8;                  // wall / collider thickness

// ----------------------------------------------------------------
// Small builder helpers
// ----------------------------------------------------------------
function boxMesh(material, sx, sy, sz, cx, cy, cz) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(sx, sy, sz);
  m.position.set(cx, cy, cz);
  return m;
}

function box3FromCenter(cx, cy, cz, hx, hy, hz) {
  return new THREE.Box3(
    new THREE.Vector3(cx - hx, cy - hy, cz - hz),
    new THREE.Vector3(cx + hx, cy + hy, cz + hz),
  );
}

function markStatic(obj) {
  // hint for perf governor: static meshes don't animate
  obj.traverse((o) => { if (o.isMesh && o.userData.animated == null) o.userData.animated = false; });
  return obj;
}

// A small lit "unit number" / nameplate via a cached canvas texture.
const _plateCache = new Map();
function platePlane(text, accentHex, w = 0.7, h = 0.45) {
  const key = `${text}_${(accentHex >>> 0).toString(16)}`;
  let mat = _plateCache.get(key);
  if (!mat) {
    let tex = null;
    try {
      const S = 256, S2 = 160;
      const canvas = (typeof document !== 'undefined')
        ? document.createElement('canvas')
        : null;
      if (canvas) {
        canvas.width = S; canvas.height = S2;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const col = new THREE.Color(accentHex >>> 0);
          ctx.fillStyle = '#0a0a10';
          ctx.fillRect(0, 0, S, S2);
          ctx.strokeStyle = `#${col.getHexString()}`;
          ctx.lineWidth = 8;
          ctx.strokeRect(8, 8, S - 16, S2 - 16);
          ctx.fillStyle = `#${col.clone().lerp(new THREE.Color(0xffffff), 0.5).getHexString()}`;
          ctx.font = 'bold 92px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = `#${col.getHexString()}`;
          ctx.shadowBlur = 18;
          ctx.fillText(String(text), S / 2, S2 / 2);
        }
        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      }
    } catch (e) { tex = null; }
    mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: tex || null,
      emissiveIntensity: 1.2,
      map: tex || null,
      transparent: !!tex,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (!tex) { mat.color.set(accentHex >>> 0); mat.emissive.set(accentHex >>> 0); }
    _plateCache.set(key, mat);
  }
  const mesh = new THREE.Mesh(UNIT_PLANE, mat);
  mesh.scale.set(w, h, 1);
  return mesh;
}

// ----------------------------------------------------------------
// createHotel
// ----------------------------------------------------------------
export function createHotel({ economy } = {}) {
  const eco = economy || null;

  const hotel = {
    floorCount: HOTEL.FLOORS.length,
    onElevator: null,
    onEnterRoom: null,
    onBuyRoom: null,
    getFloor,
    getPenthouse,
    randomWalkablePoint,
    refresh,
    dispose,
  };

  const _cache = new Map();   // index -> stage ; 'ph' -> penthouse stage

  // ---- safe economy helpers ----
  function ownsRoom(id) {
    try { return !!(eco && eco.ownsRoom && eco.ownsRoom(id)); } catch (e) { return false; }
  }
  function roomName(id) {
    try {
      const r = eco && eco.getRoom && eco.getRoom(id);
      return (r && r.name) ? String(r.name) : '';
    } catch (e) { return ''; }
  }
  function styleCost(styleId) {
    const s = ROOM_STYLES[styleId];
    return (s && typeof s.cost === 'number') ? s.cost : 300;
  }

  // ----------------------------------------------------------------
  // Build a numbered door (panel + frame + nameplate) flush against
  // a side wall. Returns { group, refresh() } so ownership visuals
  // can be updated later.
  // ----------------------------------------------------------------
  function buildDoor(scene, slot, accentHex, styleId) {
    const group = new THREE.Group();
    const inward = -slot.side;       // direction toward hallway center (X)
    const wallX = slot.side * HHW;   // door sits on the side wall

    // Door frame (slightly proud of the wall, facing inward).
    const frameMat = aesthetics.material('wood');
    const doorW = 2.2, doorH = 3.4;
    const frame = boxMesh(frameMat, 0.3, doorH + 0.4, doorW + 0.4,
      wallX + inward * 0.05, doorH / 2, slot.z);
    group.add(frame);

    // Door panel.
    const panelMat = new THREE.MeshStandardMaterial({
      color: styleId === 'penthouse' ? 0x2a2418 : 0x3a2a1a,
      roughness: 0.55, metalness: 0.15,
    });
    const panel = boxMesh(panelMat, 0.18, doorH, doorW,
      wallX + inward * 0.12, doorH / 2, slot.z);
    group.add(panel);

    // Brass handle.
    const handle = new THREE.Mesh(UNIT_BOX, aesthetics.material('brass'));
    handle.scale.set(0.1, 0.18, 0.18);
    handle.position.set(wallX + inward * 0.22, doorH * 0.5, slot.z + inward * 0.6);
    group.add(handle);

    // Lit unit number plate above the door, facing inward.
    const plate = platePlane(slot.unit != null ? slot.unit : '•', accentHex, 0.7, 0.45);
    plate.position.set(wallX + inward * 0.16, doorH + 0.5, slot.z);
    plate.rotation.y = slot.side < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(plate);

    // Occupied light (green) — toggled by refresh().
    const occLight = new THREE.PointLight(0x3dff7a, 0.0, 6, 2.0);
    occLight.position.set(wallX + inward * 0.5, doorH + 0.2, slot.z);
    group.add(occLight);

    const occOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x3dff7a, emissive: 0x3dff7a, emissiveIntensity: 0.0 }),
    );
    occOrb.position.set(wallX + inward * 0.18, doorH + 0.95, slot.z);
    group.add(occOrb);

    // Optional nameplate slot (created lazily on refresh when owned + named).
    let nameMesh = null;

    function refreshDoor() {
      const owned = ownsRoom(slot.roomId);
      occLight.intensity = owned ? 1.3 : 0.0;
      occOrb.material.emissiveIntensity = owned ? 1.4 : 0.0;
      const nm = owned ? roomName(slot.roomId) : '';
      if (nm) {
        if (!nameMesh) {
          nameMesh = platePlane(nm.slice(0, 10), 0x3dff7a, 1.3, 0.36);
          nameMesh.position.set(wallX + inward * 0.16, doorH + 1.0, slot.z);
          nameMesh.rotation.y = slot.side < 0 ? Math.PI / 2 : -Math.PI / 2;
          group.add(nameMesh);
        }
        nameMesh.visible = true;
      } else if (nameMesh) {
        nameMesh.visible = false;
      }
    }

    refreshDoor();
    scene.add(markStatic(group));
    return { group, refresh: refreshDoor };
  }

  // ----------------------------------------------------------------
  // Build a hallway floor stage (index i).
  // ----------------------------------------------------------------
  function buildFloorStage(i) {
    const floorDef = HOTEL.FLOORS[i] || {
      id: `h${i}`, name: `Floor ${i}`, style: 'standard',
      carpet: COLORS.carpet, accent: COLORS.gold,
    };
    const accentHex = (floorDef.accent != null ? floorDef.accent : COLORS.gold) >>> 0;

    const scene = new THREE.Scene();
    const colliders = [];
    const triggers = [];
    const doors = [];
    const disposers = [];
    const animated = [];

    // -- Carpet runner (full hallway floor) --
    const carpetMat = aesthetics.material('carpet', floorDef);
    scene.add(markStatic(boxMesh(carpetMat, HW, 0.4, HOTEL.HALL_LEN, 0, -0.2, 0)));

    // gold trim runner down the center
    const runnerMat = aesthetics.neonMaterial(accentHex, 0.5);
    const runner = boxMesh(runnerMat, 1.6, 0.02, HOTEL.HALL_LEN - 4, 0, 0.02, 0);
    scene.add(markStatic(runner));

    // -- Side walls (colliders: hallway is the only walkable space) --
    const wallMat = aesthetics.material('wall', floorDef);
    for (const side of [-1, 1]) {
      const wx = side * (HHW + WALL_T / 2);
      const wall = boxMesh(wallMat, WALL_T, HH, HOTEL.HALL_LEN, wx, HH / 2, 0);
      scene.add(markStatic(wall));
      colliders.push(box3FromCenter(wx, HH / 2, 0, WALL_T / 2, HH / 2, HALF));
    }
    // -- End caps --
    for (const end of [-1, 1]) {
      const ez = end * (HALF + WALL_T / 2);
      const cap = boxMesh(wallMat, HW + WALL_T * 2, HH, WALL_T, 0, HH / 2, ez);
      scene.add(markStatic(cap));
      colliders.push(box3FromCenter(0, HH / 2, ez, HHW + WALL_T, HH / 2, WALL_T / 2));
    }

    // -- Ceiling --
    const ceilMat = aesthetics.material('ceiling', floorDef);
    scene.add(markStatic(boxMesh(ceilMat, HW + WALL_T * 2, 0.4, HOTEL.HALL_LEN, 0, HH + 0.2, 0)));

    // -- Neon / sconce trim along both walls --
    const trimMat = aesthetics.neonMaterial(accentHex, 1.2);
    const neonStrips = [];
    for (const side of [-1, 1]) {
      const sx = side * (HHW - 0.05);
      const strip = boxMesh(trimMat, 0.06, 0.12, HOTEL.HALL_LEN - 6, sx, HH - 0.6, 0);
      strip.userData.animated = true;
      scene.add(strip);
      neonStrips.push(strip);
      // periodic sconce point-lights (sparse, for perf)
      const nSconce = 6;
      for (let s = 0; s < nSconce; s++) {
        const z = -HALF + 12 + s * ((HOTEL.HALL_LEN - 24) / (nSconce - 1));
        const pl = new THREE.PointLight(accentHex, 0.9, 16, 2.0);
        pl.position.set(side * (HHW - 0.4), HH - 1.0, z);
        scene.add(pl);
      }
    }

    // -- Ambient + house lighting (lightweight) --
    const hemi = new THREE.HemisphereLight(0xfff1d6, 0x201020, 0.8);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(0xfff0dd, 0.45);
    scene.add(amb);
    scene.fog = new THREE.FogExp2(0x140a14, 0.012);

    // -- Elevator alcove at the start of the hall --
    const alcoveZ = -HALF + 5;
    const alcMat = aesthetics.material('brass');
    // recessed back panel
    scene.add(markStatic(boxMesh(alcMat, HW - 1.6, 4.2, 0.4, 0, 2.1, -HALF + 0.6)));
    // elevator doors
    const elDoorMat = new THREE.MeshStandardMaterial({ color: 0x222730, roughness: 0.35, metalness: 0.9 });
    for (const d of [-1, 1]) {
      scene.add(markStatic(boxMesh(elDoorMat, 1.5, 3.6, 0.2, d * 0.8, 1.8, -HALF + 0.85)));
    }
    // neon ELEVATOR sign over the alcove
    let elevatorSign = null;
    try {
      elevatorSign = aesthetics.makeNeonSign('ELEVATOR', accentHex, { size: 0.55, light: true });
      elevatorSign.position.set(0, 4.6, -HALF + 0.9);
      elevatorSign.userData.animated = true;
      scene.add(elevatorSign);
    } catch (e) { /* ignore */ }

    // -- Window skyline at the far end --
    try {
      const win = aesthetics.makeWindowSkyline();
      const ww = 26 / 130; // scale 130-wide plane down toward hall width
      win.scale.set(ww, (HH - 1) / 30, 1);
      win.position.set(0, HH / 2, HALF - 0.2);
      win.rotation.y = Math.PI;
      scene.add(win);
      // window frame
      scene.add(markStatic(boxMesh(alcMat, HW - 1, 0.2, 0.3, 0, HH - 0.4, HALF - 0.4)));
      scene.add(markStatic(boxMesh(alcMat, HW - 1, 0.2, 0.3, 0, 0.6, HALF - 0.4)));
    } catch (e) { /* ignore */ }

    // -- Doors + framed art panels between them --
    const slots = hotelDoorSlots(floorDef.id);
    const artMat = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.5, metalness: 0.2,
      emissive: accentHex, emissiveIntensity: 0.06 });
    for (const slot of slots) {
      const d = buildDoor(scene, slot, accentHex, floorDef.style);
      doors.push({ slot, refresh: d.refresh });

      // door face collider (so you can't walk through the wall recess)
      colliders.push(box3FromCenter(slot.side * (HHW - 0.1), 1.7, slot.z, 0.2, 1.7, 1.2));

      // framed art panel offset between doors
      const artZ = slot.z + HOTEL.DOOR_SPACING / 2;
      if (Math.abs(artZ) < HALF - 6) {
        const art = boxMesh(artMat, 0.08, 1.6, 1.2, slot.side * (HHW - 0.06), 2.4, artZ);
        scene.add(markStatic(art));
      }

      // per-door trigger
      const triggerPos = new THREE.Vector3(slot.side * (HHW - 1.4), 1.2, slot.z);
      const price = styleCost(floorDef.style);
      const roomId = slot.roomId;
      triggers.push({
        pos: triggerPos,
        radius: 2.2,
        get prompt() {
          return ownsRoom(roomId)
            ? 'Enter your room — [E]'
            : `[E] Buy room — ${price} 🪙`;
        },
        action() {
          if (ownsRoom(roomId)) {
            if (hotel.onEnterRoom) hotel.onEnterRoom(roomId, floorDef.id, floorDef.style);
          } else if (hotel.onBuyRoom) {
            hotel.onBuyRoom(roomId, floorDef.style, price);
          }
        },
      });
    }

    // -- Elevator trigger --
    triggers.push({
      pos: new THREE.Vector3(0, 1.2, alcoveZ),
      radius: 3.5,
      prompt: 'Press E — Elevator',
      action() { if (hotel.onElevator) hotel.onElevator(); },
    });

    // -- A few strollers walking the hall (capped) --
    let npcMgr = null;
    try {
      npcMgr = new characters.NPCManager(scene);
      npcMgr.spawnCrowd(4, () => {
        const z = (Math.random() * 2 - 1) * (HALF - 14);
        return { x: (Math.random() - 0.5) * (HW - 4), z, y: 0 };
      });
      disposers.push(() => { try { npcMgr.clear(); } catch (e) {} });
    } catch (e) { npcMgr = null; }

    let t = 0;
    function update(dt) {
      if (!(dt > 0)) dt = 0.016;
      t += dt;
      const pulse = 0.7 + 0.3 * Math.sin(t * 1.6);
      trimMat.emissiveIntensity = 0.9 + 0.5 * pulse;
      if (npcMgr) { try { npcMgr.update(dt); } catch (e) {} }
    }

    const stage = {
      scene,
      floorIndex: i,
      id: floorDef.id,
      baseY: 0,
      spawn: { x: 0, z: alcoveZ + 4, heading: Math.PI }, // heading PI faces +Z, down the hall toward the doors
      sampleGround() { return 0; },
      colliders,
      triggers,
      update,
      doors,
      dispose() { for (const d of disposers) { try { d(); } catch (e) {} } },
    };
    return stage;
  }

  // ----------------------------------------------------------------
  // Penthouse — open luxury top floor with pool, bar, suites.
  // Uses the same overall hallway footprint but laid out open-plan.
  // ----------------------------------------------------------------
  function buildPenthouseStage() {
    const ph = HOTEL.PENTHOUSE || { id: 'ph', name: 'Penthouse', style: 'penthouse', carpet: 0x16161f, accent: 0xffd23f };
    const accentHex = (ph.accent != null ? ph.accent : COLORS.gold) >>> 0;
    const floorDef = { id: ph.id, carpet: ph.carpet, accent: accentHex, theme: 'highroller' };

    // A wider, shorter footprint than a hallway for an open feel.
    const PW = 40;            // X width
    const PD = 60;            // Z depth
    const PHX = PW / 2;
    const PHZ = PD / 2;

    const scene = new THREE.Scene();
    const colliders = [];
    const triggers = [];
    const doors = [];
    const disposers = [];

    // -- Floor (marble-ish carpet) --
    scene.add(markStatic(boxMesh(aesthetics.material('carpet', floorDef), PW, 0.4, PD, 0, -0.2, 0)));
    const marble = boxMesh(aesthetics.material('marble'), PW - 8, 0.02, PD - 8, 0, 0.02, 0);
    scene.add(markStatic(marble));

    // -- Walls (3 solid, 1 with windows; all colliders) --
    const wallMat = aesthetics.material('wall', floorDef);
    const walls = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
    ];
    for (const [sx, sz] of walls) {
      if (sx !== 0) {
        const wx = sx * (PHX + WALL_T / 2);
        scene.add(markStatic(boxMesh(wallMat, WALL_T, HOTEL.H + 1, PD, wx, (HOTEL.H + 1) / 2, 0)));
        colliders.push(box3FromCenter(wx, (HOTEL.H + 1) / 2, 0, WALL_T / 2, (HOTEL.H + 1) / 2, PHZ));
      } else {
        const wz = sz * (PHZ + WALL_T / 2);
        scene.add(markStatic(boxMesh(wallMat, PW + WALL_T * 2, HOTEL.H + 1, WALL_T, 0, (HOTEL.H + 1) / 2, wz)));
        colliders.push(box3FromCenter(0, (HOTEL.H + 1) / 2, wz, PHX + WALL_T, (HOTEL.H + 1) / 2, WALL_T / 2));
      }
    }

    // -- Ceiling --
    scene.add(markStatic(boxMesh(aesthetics.material('ceiling'), PW + WALL_T * 2, 0.4, PD, 0, HOTEL.H + 1.2, 0)));

    // -- Skyline windows all around (above the walls / on far wall) --
    try {
      for (const conf of [
        { pos: [0, (HOTEL.H + 1) / 2, -PHZ + 0.3], rotY: 0,  w: PW / 130 },
        { pos: [-PHX + 0.3, (HOTEL.H + 1) / 2, 0], rotY: Math.PI / 2, w: PD / 130 },
        { pos: [PHX - 0.3, (HOTEL.H + 1) / 2, 0],  rotY: -Math.PI / 2, w: PD / 130 },
      ]) {
        const win = aesthetics.makeWindowSkyline();
        win.scale.set(conf.w, (HOTEL.H + 1) / 30, 1);
        win.position.set(conf.pos[0], conf.pos[1], conf.pos[2]);
        win.rotation.y = conf.rotY;
        scene.add(win);
      }
    } catch (e) { /* ignore */ }

    // -- Lighting --
    scene.add(new THREE.HemisphereLight(0xfff1d6, 0x201020, 0.9));
    scene.add(new THREE.AmbientLight(0xfff0dd, 0.5));
    scene.fog = new THREE.FogExp2(0x141018, 0.008);

    // -- Chandeliers --
    const chandeliers = [];
    try {
      for (const cz of [-PHZ + 16, PHZ - 16]) {
        const ch = aesthetics.makeChandelier();
        ch.position.set(0, HOTEL.H - 0.4, cz);
        ch.userData.animated = true;
        scene.add(ch);
        chandeliers.push(ch);
      }
    } catch (e) { /* ignore */ }

    // -- Rooftop pool (water plane + deck + railing colliders) --
    const poolCx = 0, poolCz = PHZ - 14, poolW = 18, poolD = 14;
    // sunken deck around pool
    const deckMat = aesthetics.material('marble');
    scene.add(markStatic(boxMesh(deckMat, poolW + 6, 0.08, poolD + 6, poolCx, 0.05, poolCz)));
    // water
    const water = boxMesh(aesthetics.material('water'), poolW, 0.3, poolD, poolCx, 0.1, poolCz);
    water.userData.animated = true;
    scene.add(water);
    // pool rim + railing (colliders so you don't fall in)
    const rimMat = aesthetics.material('brass');
    for (const [rx, rz, rw, rd] of [
      [poolCx, poolCz - poolD / 2 - 0.4, poolW + 1, 0.4],
      [poolCx, poolCz + poolD / 2 + 0.4, poolW + 1, 0.4],
      [poolCx - poolW / 2 - 0.4, poolCz, 0.4, poolD + 1],
      [poolCx + poolW / 2 + 0.4, poolCz, 0.4, poolD + 1],
    ]) {
      scene.add(markStatic(boxMesh(rimMat, rw, 0.6, rd, rx, 0.3, rz)));
      colliders.push(box3FromCenter(rx, 0.5, rz, rw / 2, 0.5, rd / 2));
    }

    // -- Bar --
    const barCx = -PHX + 7, barCz = -PHZ + 12;
    const barMat = aesthetics.material('wood');
    scene.add(markStatic(boxMesh(barMat, 8, 1.1, 2.2, barCx, 0.55, barCz)));
    colliders.push(box3FromCenter(barCx, 0.55, barCz, 4, 0.55, 1.1));
    const barTopMat = aesthetics.material('marble');
    scene.add(markStatic(boxMesh(barTopMat, 8.4, 0.12, 2.6, barCx, 1.16, barCz)));
    // back-bar neon
    try {
      const sign = aesthetics.makeNeonSign('SKY BAR', accentHex, { size: 0.45 });
      sign.position.set(barCx, 2.4, -PHZ + 0.6);
      sign.userData.animated = true;
      scene.add(sign);
    } catch (e) { /* ignore */ }

    // -- Lounge furniture (a couple of sofas + table) --
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.7, metalness: 0.1 });
    for (const [lx, lz] of [[PHX - 9, -PHZ + 12], [PHX - 9, -PHZ + 20]]) {
      const sofa = boxMesh(sofaMat, 4, 0.8, 1.6, lx, 0.4, lz);
      scene.add(markStatic(sofa));
      scene.add(markStatic(boxMesh(sofaMat, 4, 0.8, 0.4, lx, 0.9, lz - 0.7)));
      colliders.push(box3FromCenter(lx, 0.4, lz, 2, 0.4, 0.8));
    }
    const tblMat = aesthetics.material('brass');
    scene.add(markStatic(boxMesh(tblMat, 1.6, 0.5, 1.6, PHX - 11.5, 0.25, -PHZ + 16)));

    // -- Suite doors along the left wall (big penthouse suites) --
    const suiteN = Math.max(1, HOTEL.PENTHOUSE_SUITES | 0);
    const startZ = -PHZ + 10;
    const span = (PD - 20);
    for (let k = 0; k < suiteN; k++) {
      const z = startZ + (suiteN > 1 ? (k * span / (suiteN - 1)) : span / 2);
      const slot = {
        roomId: `ph_${k}`, x: -PHX, z, side: -1, unit: k + 1,
        rot: Math.PI / 2,
      };
      const d = buildDoor(scene, slot, accentHex, 'penthouse');
      doors.push({ slot, refresh: d.refresh });
      colliders.push(box3FromCenter(-(PHX - 0.1), 1.7, z, 0.2, 1.7, 1.6));

      const price = styleCost('penthouse');
      const roomId = slot.roomId;
      triggers.push({
        pos: new THREE.Vector3(-(PHX - 1.6), 1.2, z),
        radius: 2.4,
        get prompt() {
          return ownsRoom(roomId)
            ? 'Enter your room — [E]'
            : `[E] Buy room — ${price} 🪙`;
        },
        action() {
          if (ownsRoom(roomId)) {
            if (hotel.onEnterRoom) hotel.onEnterRoom(roomId, ph.id, 'penthouse');
          } else if (hotel.onBuyRoom) {
            hotel.onBuyRoom(roomId, 'penthouse', price);
          }
        },
      });
    }

    // -- Elevator alcove + trigger --
    const alcoveZ = PHZ - 4;
    const elDoorMat = new THREE.MeshStandardMaterial({ color: 0x222730, roughness: 0.35, metalness: 0.9 });
    scene.add(markStatic(boxMesh(aesthetics.material('brass'), 5, 4.2, 0.4, PHX - 6, 2.1, PHZ - 0.6)));
    for (const dd of [-1, 1]) {
      scene.add(markStatic(boxMesh(elDoorMat, 1.5, 3.6, 0.2, PHX - 6 + dd * 0.8, 1.8, PHZ - 0.85)));
    }
    try {
      const elSign = aesthetics.makeNeonSign('ELEVATOR', accentHex, { size: 0.5 });
      elSign.position.set(PHX - 6, 4.6, PHZ - 0.9);
      elSign.userData.animated = true;
      scene.add(elSign);
    } catch (e) { /* ignore */ }
    triggers.push({
      pos: new THREE.Vector3(PHX - 6, 1.2, alcoveZ),
      radius: 3.5,
      prompt: 'Press E — Elevator',
      action() { if (hotel.onElevator) hotel.onElevator(); },
    });

    let t = 0;
    function update(dt) {
      if (!(dt > 0)) dt = 0.016;
      t += dt;
      // gentle water shimmer
      water.position.y = 0.1 + Math.sin(t * 1.5) * 0.02;
      for (let ci = 0; ci < chandeliers.length; ci++) {
        chandeliers[ci].rotation.y = Math.sin(t * 0.3 + ci) * 0.1;
      }
    }

    const stage = {
      scene,
      id: ph.id,
      floorIndex: 0,
      baseY: 0,
      spawn: { x: PHX - 6, z: alcoveZ - 4, heading: Math.PI }, // in front of elevator facing in
      sampleGround() { return 0; },
      colliders,
      triggers,
      update,
      doors,
      dispose() { for (const d of disposers) { try { d(); } catch (e) {} } },
    };
    return stage;
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------
  function getFloor(i) {
    i = i | 0;
    if (i < 0) i = 0;
    if (i >= HOTEL.FLOORS.length) i = HOTEL.FLOORS.length - 1;
    if (_cache.has(i)) return _cache.get(i);
    let stage;
    try { stage = buildFloorStage(i); }
    catch (e) { stage = fallbackStage(`h${i}`, i); }
    _cache.set(i, stage);
    return stage;
  }

  function getPenthouse() {
    if (_cache.has('ph')) return _cache.get('ph');
    let stage;
    try { stage = buildPenthouseStage(); }
    catch (e) { stage = fallbackStage('ph', 0); }
    _cache.set('ph', stage);
    return stage;
  }

  function randomWalkablePoint(i) {
    // Points along the hallway centerline (x ≈ 0, random z within bounds).
    const z = (Math.random() * 2 - 1) * (HALF - 14);
    const x = clamp((Math.random() - 0.5) * (HW - 4), -(HHW - 1), HHW - 1);
    return { x, z };
  }

  function refresh() {
    for (const stage of _cache.values()) {
      if (stage && stage.doors) {
        for (const d of stage.doors) { try { d.refresh(); } catch (e) {} }
      }
    }
  }

  function dispose() {
    for (const stage of _cache.values()) {
      if (stage && stage.dispose) { try { stage.dispose(); } catch (e) {} }
    }
    _cache.clear();
  }

  // Minimal safe stage if a build ever fails — never throw.
  function fallbackStage(id, i) {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    scene.add(markStatic(boxMesh(aesthetics.material('carpet'), HW, 0.4, HOTEL.HALL_LEN, 0, -0.2, 0)));
    return {
      scene, id, floorIndex: i, baseY: 0,
      spawn: { x: 0, z: 0, heading: 0 },
      sampleGround() { return 0; },
      colliders: [], triggers: [], doors: [],
      update() {}, dispose() {},
    };
  }

  return hotel;
}
