// =============================================================
// Digital Casinos — hotel.js
// Buildable hotel towers + a luxury penthouse, each rendered as its
// own "Stage" (THREE.Scene). Floors are long, realistic corridors
// lined with numbered, buyable rooms; the penthouse is an open
// rooftop suite level with a warm-lit pool. Built lazily and cached.
//
// Exports: createHotel({ economy }) -> hotel
//   hotel.floorCount
//   hotel.getFloor(i) -> Stage
//   hotel.getPenthouse() -> Stage
//   hotel.randomWalkablePoint(i) -> { x, z }
//   hotel.refresh()
//   hotel.onElevator / onEnterRoom / onBuyRoom  (settable callbacks)
//
// Wave 5 overhaul: removed the saturated neon look in favor of a real
// upscale hotel corridor — patterned carpet runner, wallpaper +
// wainscoting + crown molding + baseboards, recessed door frames with
// brushed-brass numbered plaques, warm wall sconces (mostly emissive,
// few real lights), framed art, a console table with a lamp near the
// elevator, and ceiling downlights (mostly emissive discs). Owned doors
// get a subtle warm "occupied" indicator + a brass nameplate.
//
// Never throws on missing data. Reuses geometry/materials. Static
// meshes are flagged userData.animated = false. Real PointLights are
// capped to a small number for performance — emissive + the warm
// ambient/hemisphere lighting carry the rest.
// =============================================================

import * as THREE from 'three';
import {
  HOTEL, ROOM_STYLES, COLORS,
  hotelDoorSlots, clamp,
} from './config.js';
import * as aesthetics from './aesthetics.js';
import * as characters from './characters.js';

// ----------------------------------------------------------------
// Shared geometry — reused (scaled) for every wall/slab/plane.
// ----------------------------------------------------------------
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

const HALF = HOTEL.HALL_LEN / 2;     // hallway extends Z ∈ [-HALF, HALF]
const HW = HOTEL.HALL_W;             // hallway width (X)
const HHW = HW / 2;                  // half width
const HH = HOTEL.H;                  // ceiling height
const WALL_T = 0.8;                  // wall / collider thickness

// Warm palette helpers (kept local so we never depend on neon colors).
const WARM_SCONCE = 0xffd9a0;        // warm amber glow for sconces / lamps
const WARM_DOWN = 0xffe7c2;          // warm downlight tone
const OCCUPIED_WARM = 0xffcf8a;      // subtle warm "occupied" indicator

// ----------------------------------------------------------------
// Small builder helpers
// ----------------------------------------------------------------
function boxMesh(material, sx, sy, sz, cx, cy, cz) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(sx, sy, sz);
  m.position.set(cx, cy, cz);
  return m;
}

function planeMesh(material, sx, sy, cx, cy, cz) {
  const m = new THREE.Mesh(UNIT_PLANE, material);
  m.scale.set(sx, sy, 1);
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

// ----------------------------------------------------------------
// Cached materials shared across all floors (warm, realistic).
// ----------------------------------------------------------------
const _localMat = new Map();
function localMat(key, make) {
  let m = _localMat.get(key);
  if (!m) { m = make(); _localMat.set(key, m); }
  return m;
}

function wallpaperMat() {
  // Soft warm taupe/ivory wallpaper. Try a subtle damask canvas texture; fall
  // back to a flat warm plaster tone if no canvas is available.
  return localMat('wallpaper', () => {
    let tex = null;
    try {
      const S = 256;
      const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      if (canvas) {
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#d8c8ac';
          ctx.fillRect(0, 0, S, S);
          // faint vertical stripe + tone-on-tone diamonds
          ctx.globalAlpha = 0.10;
          ctx.fillStyle = '#c6b390';
          for (let x = 0; x < S; x += 16) ctx.fillRect(x, 0, 8, S);
          ctx.globalAlpha = 0.14;
          ctx.strokeStyle = '#bfa882';
          ctx.lineWidth = 1.5;
          const step = 48;
          ctx.beginPath();
          for (let i = -S; i < S * 2; i += step) {
            ctx.moveTo(i, 0); ctx.lineTo(i + S, S);
            ctx.moveTo(i, S); ctx.lineTo(i + S, 0);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
          tex = new THREE.CanvasTexture(canvas);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(2, 6);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
        }
      }
    } catch (e) { tex = null; }
    return new THREE.MeshStandardMaterial({
      color: tex ? 0xffffff : 0xd8c8ac,
      map: tex || null,
      roughness: 0.92, metalness: 0.0,
    });
  });
}

function wainscotMat() {
  // Dark walnut wainscoting / chair-rail panels.
  return localMat('wainscot', () => aesthetics.material('wood'));
}

function moldingMat() {
  // Warm cream painted molding (crown + base + door casings).
  return localMat('molding', () =>
    new THREE.MeshStandardMaterial({ color: 0xeee3cd, roughness: 0.8, metalness: 0.02 }));
}

function ceilingMat() {
  return localMat('ceiling', () => aesthetics.material('ceiling'));
}

function downlightDiscMat() {
  // Mostly-emissive recessed downlight disc (cheap fake light).
  return localMat('downlight', () =>
    new THREE.MeshStandardMaterial({
      color: 0x2a2620, emissive: WARM_DOWN, emissiveIntensity: 0.9,
      roughness: 0.6, metalness: 0.1,
    }));
}

function sconceGlowMat() {
  // Warm emissive glass shade for wall sconces.
  return localMat('sconceGlow', () =>
    new THREE.MeshStandardMaterial({
      color: 0x3a2e1c, emissive: WARM_SCONCE, emissiveIntensity: 1.1,
      roughness: 0.4, metalness: 0.0,
      transparent: true, opacity: 0.95,
    }));
}

function lampShadeMat() {
  return localMat('lampShade', () =>
    new THREE.MeshStandardMaterial({
      color: 0xf3e3c2, emissive: WARM_SCONCE, emissiveIntensity: 0.7,
      roughness: 0.6, metalness: 0.0,
    }));
}

function doorPanelMat(styleId) {
  const key = `doorPanel_${styleId === 'penthouse' ? 'ph' : 'std'}`;
  return localMat(key, () =>
    new THREE.MeshStandardMaterial({
      color: styleId === 'penthouse' ? 0x2a1c12 : 0x3a2516,
      roughness: 0.5, metalness: 0.1,
    }));
}

// Brushed-brass numbered plaque via a cached canvas texture (warm, engraved
// look — never neon). Cached per text so repeated unit numbers reuse the mat.
const _plateCache = new Map();
function brassPlate(text, w = 0.42, h = 0.5) {
  const key = `plate_${text}`;
  let mat = _plateCache.get(key);
  if (!mat) {
    let tex = null;
    try {
      const W = 192, H = 224;
      const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      if (canvas) {
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // brushed brass background
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#d8b65a');
          g.addColorStop(0.5, '#b8932f');
          g.addColorStop(1, '#8f7022');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          // fine brushed streaks
          ctx.globalAlpha = 0.12;
          for (let i = 0; i < 60; i++) {
            ctx.strokeStyle = Math.random() < 0.5 ? '#fff0c0' : '#6e551a';
            ctx.beginPath();
            const y = Math.random() * H;
            ctx.moveTo(0, y); ctx.lineTo(W, y + (Math.random() - 0.5) * 6);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          // bevel border
          ctx.strokeStyle = '#6e551a';
          ctx.lineWidth = 6;
          ctx.strokeRect(8, 8, W - 16, H - 16);
          ctx.strokeStyle = '#fff0c0';
          ctx.lineWidth = 2;
          ctx.strokeRect(12, 12, W - 24, H - 24);
          // engraved number (dark, slightly inset look)
          ctx.fillStyle = '#3a2c0e';
          ctx.font = 'bold 96px Georgia, "Times New Roman", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(text), W / 2, H / 2 + 4);
          ctx.fillStyle = 'rgba(255,240,200,0.35)';
          ctx.fillText(String(text), W / 2 - 1, H / 2 + 2);
        }
        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      }
    } catch (e) { tex = null; }
    mat = new THREE.MeshStandardMaterial({
      color: tex ? 0xffffff : toBrass(),
      map: tex || null,
      // very low warm emissive so it reads warm-lit, not glowing neon
      emissive: tex ? 0xffe7c2 : 0x000000,
      emissiveMap: tex || null,
      emissiveIntensity: 0.18,
      roughness: 0.4, metalness: 0.6,
      side: THREE.DoubleSide,
    });
    _plateCache.set(key, mat);
  }
  const mesh = new THREE.Mesh(UNIT_PLANE, mat);
  mesh.scale.set(w, h, 1);
  return mesh;
}

function toBrass() { return (COLORS.brass >>> 0) || 0xc9a227; }

// Engraved room nameplate (owned rooms) — small brushed-brass plate with the
// player's room name. Warm, low emissive. Cached per name string.
const _nameCache = new Map();
function namePlate(text, w = 1.1, h = 0.3) {
  const key = `name_${text}`;
  let mat = _nameCache.get(key);
  if (!mat) {
    let tex = null;
    try {
      const W = 384, H = 96;
      const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      if (canvas) {
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#c9a94a');
          g.addColorStop(1, '#8f7022');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.strokeStyle = '#6e551a';
          ctx.lineWidth = 4;
          ctx.strokeRect(4, 4, W - 8, H - 8);
          ctx.fillStyle = '#3a2c0e';
          ctx.font = 'bold 44px Georgia, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(text), W / 2, H / 2 + 2);
        }
        tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      }
    } catch (e) { tex = null; }
    mat = new THREE.MeshStandardMaterial({
      color: tex ? 0xffffff : toBrass(),
      map: tex || null,
      emissive: tex ? 0xffe7c2 : 0x000000,
      emissiveMap: tex || null,
      emissiveIntensity: 0.16,
      roughness: 0.45, metalness: 0.55,
      side: THREE.DoubleSide,
    });
    _nameCache.set(key, mat);
  }
  const mesh = new THREE.Mesh(UNIT_PLANE, mat);
  mesh.scale.set(w, h, 1);
  return mesh;
}

// Framed-art canvas texture (a few cached variants for variety).
const _artCache = new Map();
function artMaterial(variant) {
  const key = `art_${variant}`;
  let mat = _artCache.get(key);
  if (mat) return mat;
  let tex = null;
  try {
    const W = 256, H = 320;
    const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (canvas) {
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // warm abstract landscape washes
        const palettes = [
          ['#6a4a2a', '#caa66a', '#e8d3a8'],
          ['#3a2e44', '#7a5a6a', '#c8a98a'],
          ['#2c3a2e', '#6a7a52', '#cabd86'],
          ['#4a2420', '#9a5a44', '#d8b68a'],
        ];
        const p = palettes[variant % palettes.length];
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, p[0]); g.addColorStop(0.6, p[1]); g.addColorStop(1, p[2]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        // soft brush strokes
        ctx.globalAlpha = 0.18;
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = p[i % 3];
          const x = Math.random() * W, y = Math.random() * H;
          ctx.beginPath();
          ctx.ellipse(x, y, 10 + Math.random() * 30, 4 + Math.random() * 10, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  } catch (e) { tex = null; }
  mat = new THREE.MeshStandardMaterial({
    color: tex ? 0xffffff : 0x6a5a3a,
    map: tex || null,
    roughness: 0.85, metalness: 0.0,
  });
  _artCache.set(key, mat);
  return mat;
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
  // Build a numbered door: a recessed alcove in the wall, a casing
  // frame, the door panel, a brass handle, and a brushed-brass numbered
  // plaque. Owned rooms additionally show a subtle warm "occupied"
  // indicator + an engraved room nameplate. Returns { group, refresh() }.
  // ----------------------------------------------------------------
  function buildDoor(scene, slot, styleId) {
    const group = new THREE.Group();
    const inward = -slot.side;       // direction toward hallway center (X)
    const wallX = slot.side * HHW;   // door sits on the side wall
    const yaw = slot.side < 0 ? Math.PI / 2 : -Math.PI / 2;

    const doorW = 2.2, doorH = 3.4;
    const recess = 0.28;             // how deep the alcove sits into the wall

    // Recessed alcove back panel (sits slightly into the wall).
    const recessMat = localMat('doorRecess', () =>
      new THREE.MeshStandardMaterial({ color: 0x1c1610, roughness: 0.9, metalness: 0.0 }));
    group.add(boxMesh(recessMat, 0.12, doorH + 0.5, doorW + 0.5,
      wallX + slot.side * recess, (doorH + 0.5) / 2, slot.z));

    // Painted casing frame around the recess (cream molding), three pieces.
    const cMat = moldingMat();
    const casingX = wallX + inward * 0.02;
    group.add(boxMesh(cMat, 0.16, doorH + 0.5, 0.22, casingX, (doorH + 0.5) / 2, slot.z - (doorW / 2 + 0.18)));
    group.add(boxMesh(cMat, 0.16, doorH + 0.5, 0.22, casingX, (doorH + 0.5) / 2, slot.z + (doorW / 2 + 0.18)));
    group.add(boxMesh(cMat, 0.16, 0.24, doorW + 0.6, casingX, doorH + 0.42, slot.z));

    // Door panel (set back inside the recess) with two inset rails.
    const panelMat = doorPanelMat(styleId);
    const panelX = wallX + slot.side * (recess - 0.16);
    group.add(boxMesh(panelMat, 0.14, doorH, doorW, panelX, doorH / 2, slot.z));
    const insetMat = localMat('doorInset', () =>
      new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.55, metalness: 0.1 }));
    group.add(boxMesh(insetMat, 0.06, doorH * 0.36, doorW * 0.62, panelX + inward * 0.02, doorH * 0.66, slot.z));
    group.add(boxMesh(insetMat, 0.06, doorH * 0.36, doorW * 0.62, panelX + inward * 0.02, doorH * 0.30, slot.z));

    // Brushed-brass handle + lever.
    const brass = aesthetics.material('brass');
    const handle = boxMesh(brass, 0.1, 0.14, 0.14, panelX + inward * 0.16, doorH * 0.46, slot.z + inward * 0.62);
    group.add(handle);
    group.add(boxMesh(brass, 0.1, 0.06, 0.32, panelX + inward * 0.18, doorH * 0.46, slot.z + inward * 0.5));

    // Brushed-brass numbered plaque on the casing beside the door.
    const plate = brassPlate(slot.unit != null ? slot.unit : '•', 0.42, 0.5);
    plate.position.set(casingX + inward * 0.06, doorH * 0.62, slot.z + (doorW / 2 + 0.3));
    plate.rotation.y = yaw;
    group.add(plate);

    // Subtle warm "occupied" indicator — a small recessed glow above the door,
    // emissive only (no point light) so it costs nothing. Toggled by refresh().
    const occMat = new THREE.MeshStandardMaterial({
      color: 0x2a1c0e, emissive: OCCUPIED_WARM, emissiveIntensity: 0.0,
      roughness: 0.5, metalness: 0.1,
    });
    const occOrb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), occMat);
    occOrb.position.set(casingX + inward * 0.08, doorH + 0.18, slot.z);
    group.add(occOrb);

    // Engraved room nameplate (lazily created when owned + named).
    let nameMesh = null;

    function refreshDoor() {
      const owned = ownsRoom(slot.roomId);
      occMat.emissiveIntensity = owned ? 1.1 : 0.0;
      const nm = owned ? roomName(slot.roomId) : '';
      if (nm) {
        if (!nameMesh) {
          nameMesh = namePlate(nm.slice(0, 14), 1.1, 0.3);
          nameMesh.position.set(casingX + inward * 0.07, doorH * 0.9, slot.z);
          nameMesh.rotation.y = yaw;
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

  // Build one wall sconce object (cached geometry/materials). Returns the
  // group; the caller positions/orients it. Mostly emissive; the caller
  // decides whether to add a real point light (capped).
  function makeSconce() {
    const g = new THREE.Group();
    const brass = aesthetics.material('brass');
    // backplate + arm
    g.add(boxMesh(brass, 0.08, 0.5, 0.18, 0, 0, 0));
    g.add(boxMesh(brass, 0.16, 0.06, 0.06, 0.1, -0.2, 0));
    // warm glass shade (emissive)
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.4, 10), sconceGlowMat());
    shade.position.set(0.2, -0.05, 0);
    g.add(shade);
    return g;
  }

  // ----------------------------------------------------------------
  // Build a hallway floor stage (index i).
  // ----------------------------------------------------------------
  function buildFloorStage(i) {
    const floorDef = HOTEL.FLOORS[i] || {
      id: `h${i}`, name: `Floor ${i}`, style: 'standard',
      carpet: COLORS.carpet, accent: COLORS.gold,
    };

    const scene = new THREE.Scene();
    const colliders = [];
    const triggers = [];
    const doors = [];
    const disposers = [];

    // -- Patterned carpet runner (full hallway floor) --
    const carpetMat = aesthetics.material('carpet', floorDef);
    scene.add(markStatic(boxMesh(carpetMat, HW, 0.4, HOTEL.HALL_LEN, 0, -0.2, 0)));
    // brass inlay strips bordering a central runner
    const brass = aesthetics.material('brass');
    for (const side of [-1, 1]) {
      scene.add(markStatic(boxMesh(brass, 0.08, 0.04, HOTEL.HALL_LEN - 6, side * 2.2, 0.02, 0)));
    }

    // -- Side walls: baseboard + wainscot + wallpaper + crown molding --
    const wpMat = wallpaperMat();
    const wsMat = wainscotMat();
    const mMat = moldingMat();
    for (const side of [-1, 1]) {
      const wx = side * (HHW + WALL_T / 2);
      // structural wall (collider) painted as wallpaper above the wainscot
      const wall = boxMesh(wpMat, WALL_T, HH, HOTEL.HALL_LEN, wx, HH / 2, 0);
      scene.add(markStatic(wall));
      colliders.push(box3FromCenter(wx, HH / 2, 0, WALL_T / 2, HH / 2, HALF));
      // baseboard
      const faceX = side * (HHW - 0.02);
      scene.add(markStatic(boxMesh(mMat, 0.1, 0.3, HOTEL.HALL_LEN, faceX, 0.15, 0)));
      // wainscot panel (lower third)
      scene.add(markStatic(boxMesh(wsMat, 0.08, 1.2, HOTEL.HALL_LEN, faceX, 0.9, 0)));
      // chair-rail trim atop the wainscot
      scene.add(markStatic(boxMesh(mMat, 0.12, 0.1, HOTEL.HALL_LEN, faceX, 1.55, 0)));
      // crown molding at the ceiling
      scene.add(markStatic(boxMesh(mMat, 0.18, 0.28, HOTEL.HALL_LEN, faceX, HH - 0.2, 0)));
    }

    // -- End caps --
    for (const end of [-1, 1]) {
      const ez = end * (HALF + WALL_T / 2);
      const cap = boxMesh(wpMat, HW + WALL_T * 2, HH, WALL_T, 0, HH / 2, ez);
      scene.add(markStatic(cap));
      colliders.push(box3FromCenter(0, HH / 2, ez, HHW + WALL_T, HH / 2, WALL_T / 2));
    }

    // -- Tray ceiling --
    scene.add(markStatic(boxMesh(ceilingMat(), HW + WALL_T * 2, 0.4, HOTEL.HALL_LEN, 0, HH + 0.2, 0)));
    // central recessed tray (slightly darker inset)
    const trayMat = localMat('tray', () =>
      new THREE.MeshStandardMaterial({ color: 0xd6c8ac, roughness: 0.95, metalness: 0.0 }));
    scene.add(markStatic(boxMesh(trayMat, HW - 2.4, 0.2, HOTEL.HALL_LEN - 4, 0, HH - 0.08, 0)));

    // -- Ceiling downlights: mostly emissive discs, a couple of real lights --
    const discMat = downlightDiscMat();
    const nDown = 14;
    const downGeo = new THREE.CircleGeometry(0.22, 12);
    const downInst = new THREE.InstancedMesh(downGeo, discMat, nDown);
    downInst.userData.animated = false;
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const _s = new THREE.Vector3(1, 1, 1);
    const _p = new THREE.Vector3();
    for (let d = 0; d < nDown; d++) {
      const z = -HALF + 10 + d * ((HOTEL.HALL_LEN - 20) / (nDown - 1));
      _p.set(0, HH - 0.18, z);
      _m.compose(_p, _q, _s);
      downInst.setMatrixAt(d, _m);
    }
    downInst.instanceMatrix.needsUpdate = true;
    scene.add(downInst);

    // -- Warm wall sconces between doors (instanced glow + capped point lights).
    // Shades are an InstancedMesh (cheap). We add only a SMALL number of real
    // PointLights spread down the hall; emissive + ambient carry the rest.
    const sconceMat = sconceGlowMat();
    const nSconce = 8;                  // sconces per side
    const sconceGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.4, 10);
    const sconceInst = new THREE.InstancedMesh(sconceGeo, sconceMat, nSconce * 2);
    sconceInst.userData.animated = false;
    const brassArmMat = aesthetics.material('brass');
    const armInst = new THREE.InstancedMesh(UNIT_BOX, brassArmMat, nSconce * 2);
    armInst.userData.animated = false;
    let si = 0;
    const sconcePositions = [];
    for (const side of [-1, 1]) {
      const sx = side * (HHW - 0.18);
      for (let s = 0; s < nSconce; s++) {
        const z = -HALF + 12 + s * ((HOTEL.HALL_LEN - 24) / (nSconce - 1));
        // glow shade
        _p.set(sx, HH - 1.7, z);
        _m.compose(_p, new THREE.Quaternion(), _s);
        sconceInst.setMatrixAt(si, _m);
        // brass backplate (thin box)
        _p.set(side * (HHW - 0.06), HH - 1.7, z);
        _m.compose(_p, new THREE.Quaternion(), new THREE.Vector3(0.08, 0.55, 0.2));
        armInst.setMatrixAt(si, _m);
        si++;
        sconcePositions.push({ x: sx, z });
      }
    }
    sconceInst.instanceMatrix.needsUpdate = true;
    armInst.instanceMatrix.needsUpdate = true;
    scene.add(sconceInst, armInst);

    // Capped real point lights: only a few, evenly spaced among the sconces.
    const realLights = [];
    const MAX_HALL_LIGHTS = 3;
    for (let L = 0; L < MAX_HALL_LIGHTS; L++) {
      const idx = Math.floor((L + 0.5) / MAX_HALL_LIGHTS * sconcePositions.length);
      const sp = sconcePositions[clamp(idx, 0, sconcePositions.length - 1)];
      const pl = new THREE.PointLight(WARM_SCONCE, 0.7, 14, 2.0);
      pl.position.set(sp.x, HH - 1.7, sp.z);
      scene.add(pl);
      realLights.push(pl);
    }

    // -- Warm ambient + house lighting (lightweight, no neon) --
    scene.add(new THREE.HemisphereLight(0xfff0d4, 0x4a3c30, 0.9));
    scene.add(new THREE.AmbientLight(0xffe8cc, 0.5));
    // one soft real downlight in the middle so the hall reads bright
    const houseDown = new THREE.PointLight(WARM_DOWN, 0.8, 60, 2.0);
    houseDown.position.set(0, HH - 0.4, 0);
    scene.add(houseDown);
    scene.fog = new THREE.FogExp2(0x2a2018, 0.006);

    // -- Elevator alcove at the start of the hall --
    const alcoveZ = -HALF + 5;
    // recessed brass-framed back panel
    scene.add(markStatic(boxMesh(brass, HW - 1.6, 4.2, 0.4, 0, 2.1, -HALF + 0.6)));
    // brushed-steel elevator doors
    const elDoorMat = localMat('elDoor', () =>
      new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.28, metalness: 0.95 }));
    for (const d of [-1, 1]) {
      scene.add(markStatic(boxMesh(elDoorMat, 1.5, 3.6, 0.2, d * 0.8, 1.8, -HALF + 0.85)));
    }
    // gilded ELEVATOR sign over the alcove (tasteful backlit, via aesthetics)
    try {
      const elevatorSign = aesthetics.makeNeonSign('ELEVATOR', COLORS.gold, { size: 0.5, light: false });
      elevatorSign.position.set(0, 4.6, -HALF + 0.95);
      scene.add(elevatorSign);
    } catch (e) { /* ignore */ }

    // -- Console table with a lamp near the elevator (warm accent) --
    try {
      const consoleZ = -HALF + 11;
      const consoleX = HHW - 0.7;
      // wood console
      const wood = aesthetics.material('wood');
      scene.add(markStatic(boxMesh(wood, 0.7, 0.08, 2.2, consoleX, 1.05, consoleZ)));
      for (const lz of [consoleZ - 0.9, consoleZ + 0.9]) {
        scene.add(markStatic(boxMesh(wood, 0.08, 1.0, 0.08, consoleX, 0.5, lz)));
      }
      // lamp base + warm emissive shade
      scene.add(markStatic(boxMesh(brass, 0.1, 0.5, 0.1, consoleX, 1.35, consoleZ)));
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 14), lampShadeMat());
      shade.position.set(consoleX, 1.75, consoleZ);
      shade.userData.animated = false;
      scene.add(shade);
      // small warm point light from the lamp (counts toward our cap, but only 1)
      const lampLight = new THREE.PointLight(WARM_SCONCE, 0.5, 8, 2.0);
      lampLight.position.set(consoleX, 1.7, consoleZ);
      scene.add(lampLight);
      // a small framed mirror/art above the console
      const mirror = planeMesh(artMaterial(0), 0.9, 1.3, HHW - 0.05, 2.6, consoleZ);
      mirror.rotation.y = -Math.PI / 2;
      scene.add(markStatic(mirror));
    } catch (e) { /* ignore */ }

    // -- Window skyline at the far end --
    try {
      const win = aesthetics.makeWindowSkyline();
      const ww = 26 / 130; // scale 130-wide plane down toward hall width
      win.scale.set(ww, (HH - 1) / 30, 1);
      win.position.set(0, HH / 2, HALF - 0.2);
      win.rotation.y = Math.PI;
      scene.add(win);
      // brass window frame
      scene.add(markStatic(boxMesh(brass, HW - 1, 0.2, 0.3, 0, HH - 0.4, HALF - 0.4)));
      scene.add(markStatic(boxMesh(brass, HW - 1, 0.2, 0.3, 0, 0.6, HALF - 0.4)));
      for (const fx of [-1, 1]) {
        scene.add(markStatic(boxMesh(brass, 0.2, HH - 1, 0.3, fx * (HW / 2 - 0.6), HH / 2, HALF - 0.4)));
      }
    } catch (e) { /* ignore */ }

    // -- Doors + framed art panels between them --
    const slots = hotelDoorSlots(floorDef.id);
    // shared simple frame material for art
    const frameMat = aesthetics.material('brass');
    let artIdx = 0;
    for (const slot of slots) {
      const d = buildDoor(scene, slot, floorDef.style);
      doors.push({ slot, refresh: d.refresh });

      // door face collider (so you can't walk through the wall recess)
      colliders.push(box3FromCenter(slot.side * (HHW - 0.1), 1.7, slot.z, 0.2, 1.7, 1.2));

      // framed art panel offset between doors
      const artZ = slot.z + HOTEL.DOOR_SPACING / 2;
      if (Math.abs(artZ) < HALF - 8) {
        const faceX = slot.side * (HHW - 0.05);
        const yaw = slot.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        // gilded frame
        const fr = boxMesh(frameMat, 0.06, 1.5, 1.15, faceX, 2.55, artZ);
        scene.add(markStatic(fr));
        // canvas
        const art = planeMesh(artMaterial(artIdx++), 0.95, 1.3, slot.side * (HHW - 0.09), 2.55, artZ);
        art.rotation.y = yaw;
        scene.add(markStatic(art));
      }

      // per-door trigger (owned -> Enter, unowned -> Buy) — logic intact
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

    function update(dt) {
      if (!(dt > 0)) dt = 0.016;
      if (npcMgr) { try { npcMgr.update(dt); } catch (e) {} }
    }

    const stage = {
      scene,
      floorIndex: i,
      id: floorDef.id,
      baseY: 0,
      spawn: { x: 0, z: alcoveZ + 4, heading: Math.PI }, // heading PI faces down the hall toward the doors
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
  // Penthouse — open luxury top floor with realistic suites and a
  // warm-lit rooftop pool (stone deck, calm water, railings, loungers),
  // skyline windows all around. No neon.
  // ----------------------------------------------------------------
  function buildPenthouseStage() {
    const ph = HOTEL.PENTHOUSE || { id: 'ph', name: 'Penthouse', style: 'penthouse', carpet: 0x16161f, accent: 0xffd23f };
    const floorDef = { id: ph.id, carpet: ph.carpet, accent: (ph.accent != null ? ph.accent : COLORS.gold) >>> 0, theme: 'highroller' };

    // A wider, shorter footprint than a hallway for an open feel.
    const PW = 40;            // X width
    const PD = 60;            // Z depth
    const PHX = PW / 2;
    const PHZ = PD / 2;
    const PHH = HOTEL.H + 1;

    const scene = new THREE.Scene();
    const colliders = [];
    const triggers = [];
    const doors = [];
    const disposers = [];

    const brass = aesthetics.material('brass');
    const mMat = moldingMat();
    const wpMat = wallpaperMat();

    // -- Floor: marble inlay over warm carpet border --
    scene.add(markStatic(boxMesh(aesthetics.material('carpet', floorDef), PW, 0.4, PD, 0, -0.2, 0)));
    const marble = boxMesh(aesthetics.material('marble'), PW - 8, 0.02, PD - 8, 0, 0.02, 0);
    scene.add(markStatic(marble));

    // -- Walls (all colliders) with baseboards + crown molding --
    for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (sx !== 0) {
        const wx = sx * (PHX + WALL_T / 2);
        scene.add(markStatic(boxMesh(wpMat, WALL_T, PHH, PD, wx, PHH / 2, 0)));
        colliders.push(box3FromCenter(wx, PHH / 2, 0, WALL_T / 2, PHH / 2, PHZ));
        const faceX = sx * (PHX - 0.02);
        scene.add(markStatic(boxMesh(mMat, 0.1, 0.3, PD, faceX, 0.15, 0)));
        scene.add(markStatic(boxMesh(mMat, 0.16, 0.26, PD, faceX, PHH - 0.18, 0)));
      } else {
        const wz = sz * (PHZ + WALL_T / 2);
        scene.add(markStatic(boxMesh(wpMat, PW + WALL_T * 2, PHH, WALL_T, 0, PHH / 2, wz)));
        colliders.push(box3FromCenter(0, PHH / 2, wz, PHX + WALL_T, PHH / 2, WALL_T / 2));
        const faceZ = sz * (PHZ - 0.02);
        scene.add(markStatic(boxMesh(mMat, PW, 0.3, 0.1, 0, 0.15, faceZ)));
        scene.add(markStatic(boxMesh(mMat, PW, 0.26, 0.16, 0, PHH - 0.18, faceZ)));
      }
    }

    // -- Tray ceiling --
    scene.add(markStatic(boxMesh(ceilingMat(), PW + WALL_T * 2, 0.4, PD, 0, PHH + 0.2, 0)));
    scene.add(markStatic(boxMesh(localMat('tray', () =>
      new THREE.MeshStandardMaterial({ color: 0xd6c8ac, roughness: 0.95, metalness: 0.0 })),
      PW - 6, 0.2, PD - 6, 0, PHH - 0.08, 0)));

    // ceiling downlight discs (emissive, instanced)
    const discMat = downlightDiscMat();
    const downGeo = new THREE.CircleGeometry(0.26, 12);
    const downPts = [];
    for (let zx = -PHZ + 12; zx <= PHZ - 12; zx += 12) {
      for (const dx of [-PHX + 12, 0, PHX - 12]) downPts.push([dx, zx]);
    }
    const downInst = new THREE.InstancedMesh(downGeo, discMat, downPts.length);
    downInst.userData.animated = false;
    {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      const s = new THREE.Vector3(1, 1, 1);
      const p = new THREE.Vector3();
      for (let k = 0; k < downPts.length; k++) {
        p.set(downPts[k][0], PHH - 0.18, downPts[k][1]);
        m.compose(p, q, s);
        downInst.setMatrixAt(k, m);
      }
      downInst.instanceMatrix.needsUpdate = true;
    }
    scene.add(downInst);

    // -- Skyline windows all around --
    try {
      for (const conf of [
        { pos: [0, PHH / 2, -PHZ + 0.3], rotY: 0, w: PW / 130 },
        { pos: [-PHX + 0.3, PHH / 2, 0], rotY: Math.PI / 2, w: PD / 130 },
        { pos: [PHX - 0.3, PHH / 2, 0], rotY: -Math.PI / 2, w: PD / 130 },
      ]) {
        const win = aesthetics.makeWindowSkyline();
        win.scale.set(conf.w, PHH / 30, 1);
        win.position.set(conf.pos[0], conf.pos[1], conf.pos[2]);
        win.rotation.y = conf.rotY;
        scene.add(win);
      }
    } catch (e) { /* ignore */ }

    // -- Warm lighting (capped real lights; emissive + ambient carry it) --
    scene.add(new THREE.HemisphereLight(0xfff0d4, 0x4a3c30, 0.95));
    scene.add(new THREE.AmbientLight(0xffe8cc, 0.55));
    const phKey = new THREE.DirectionalLight(0xfff2e0, 0.5);
    phKey.position.set(20, 40, 10);
    scene.add(phKey);
    scene.fog = new THREE.FogExp2(0x241c16, 0.005);

    // -- Chandeliers (their own warm light) --
    const chandeliers = [];
    try {
      for (const cz of [-PHZ + 16, PHZ - 26]) {
        const ch = aesthetics.makeChandelier();
        ch.position.set(0, PHH - 0.5, cz);
        ch.userData.animated = true;
        scene.add(ch);
        chandeliers.push(ch);
      }
    } catch (e) { /* ignore */ }

    // -- Rooftop pool: stone deck, calm water, brass railings, loungers --
    const poolCx = 0, poolCz = PHZ - 14, poolW = 18, poolD = 14;
    // raised stone deck around the pool
    const deckMat = aesthetics.material('marble');
    scene.add(markStatic(boxMesh(deckMat, poolW + 8, 0.12, poolD + 8, poolCx, 0.06, poolCz)));
    // sunken pool basin (dark tile) so the water sits inside
    const basinMat = localMat('poolBasin', () =>
      new THREE.MeshStandardMaterial({ color: 0x16404a, roughness: 0.5, metalness: 0.1 }));
    scene.add(markStatic(boxMesh(basinMat, poolW + 0.4, 0.3, poolD + 0.4, poolCx, 0.08, poolCz)));
    // calm water surface
    const water = boxMesh(aesthetics.material('water'), poolW, 0.26, poolD, poolCx, 0.16, poolCz);
    water.userData.animated = true;
    scene.add(water);
    // a couple of warm underwater/pool-edge lights (capped: 2)
    for (const lx of [-poolW / 3, poolW / 3]) {
      const pw = new THREE.PointLight(0xffe0b0, 0.5, 12, 2.0);
      pw.position.set(poolCx + lx, 0.6, poolCz);
      scene.add(pw);
    }
    // brass railing posts + top rail around the pool (colliders)
    const railMat = brass;
    for (const [rx, rz, rw, rd] of [
      [poolCx, poolCz - poolD / 2 - 0.5, poolW + 2, 0.3],
      [poolCx, poolCz + poolD / 2 + 0.5, poolW + 2, 0.3],
      [poolCx - poolW / 2 - 0.5, poolCz, 0.3, poolD + 2],
      [poolCx + poolW / 2 + 0.5, poolCz, 0.3, poolD + 2],
    ]) {
      // low stone rim
      scene.add(markStatic(boxMesh(deckMat, rw, 0.3, rd, rx, 0.21, rz)));
      // brass top rail
      scene.add(markStatic(boxMesh(railMat, rw, 0.06, rd, rx, 0.95, rz)));
      colliders.push(box3FromCenter(rx, 0.5, rz, rw / 2, 0.5, rd / 2));
    }
    // a few rail posts (instanced)
    {
      const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8);
      const posts = [];
      for (let p = -poolW / 2; p <= poolW / 2; p += poolW / 4) {
        posts.push([poolCx + p, poolCz - poolD / 2 - 0.5]);
        posts.push([poolCx + p, poolCz + poolD / 2 + 0.5]);
      }
      const postInst = new THREE.InstancedMesh(postGeo, railMat, posts.length);
      postInst.userData.animated = false;
      const m = new THREE.Matrix4(); const q = new THREE.Quaternion();
      const s = new THREE.Vector3(1, 1, 1); const pv = new THREE.Vector3();
      for (let k = 0; k < posts.length; k++) {
        pv.set(posts[k][0], 0.55, posts[k][1]); m.compose(pv, q, s); postInst.setMatrixAt(k, m);
      }
      postInst.instanceMatrix.needsUpdate = true;
      scene.add(postInst);
    }
    // loungers along the deck (wood frame + cream cushion)
    const wood = aesthetics.material('wood');
    const cushionMat = localMat('cushion', () =>
      new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.8, metalness: 0.0 }));
    for (const lx of [poolCx - poolW / 2 - 2.4, poolCx + poolW / 2 + 2.4]) {
      for (const lz of [poolCz - 3, poolCz + 3]) {
        scene.add(markStatic(boxMesh(wood, 0.7, 0.3, 2.0, lx, 0.35, lz)));
        scene.add(markStatic(boxMesh(cushionMat, 0.6, 0.12, 1.9, lx, 0.56, lz)));
        // raised backrest
        scene.add(markStatic(boxMesh(cushionMat, 0.6, 0.5, 0.12, lx, 0.8, lz - 0.9)));
        colliders.push(box3FromCenter(lx, 0.35, lz, 0.4, 0.35, 1.0));
      }
    }

    // -- Bar (wood + marble top), tasteful gilded sign --
    const barCx = -PHX + 7, barCz = -PHZ + 12;
    scene.add(markStatic(boxMesh(wood, 8, 1.1, 2.2, barCx, 0.55, barCz)));
    colliders.push(box3FromCenter(barCx, 0.55, barCz, 4, 0.55, 1.1));
    scene.add(markStatic(boxMesh(aesthetics.material('marble'), 8.4, 0.12, 2.6, barCx, 1.16, barCz)));
    try {
      const sign = aesthetics.makeNeonSign('SKY BAR', COLORS.gold, { size: 0.4, light: false });
      sign.position.set(barCx, 2.4, -PHZ + 0.6);
      scene.add(sign);
    } catch (e) { /* ignore */ }

    // -- Lounge furniture (a couple of sofas + brass table) --
    const sofaMat = localMat('sofa', () =>
      new THREE.MeshStandardMaterial({ color: 0x5a3a3a, roughness: 0.8, metalness: 0.05 }));
    for (const [lx, lz] of [[PHX - 9, -PHZ + 12], [PHX - 9, -PHZ + 20]]) {
      scene.add(markStatic(boxMesh(sofaMat, 4, 0.8, 1.6, lx, 0.4, lz)));
      scene.add(markStatic(boxMesh(sofaMat, 4, 0.8, 0.4, lx, 0.9, lz - 0.7)));
      colliders.push(box3FromCenter(lx, 0.4, lz, 2, 0.4, 0.8));
    }
    scene.add(markStatic(boxMesh(brass, 1.6, 0.5, 1.6, PHX - 11.5, 0.25, -PHZ + 16)));
    // a potted plant for greenery
    try {
      scene.add(markStatic(boxMesh(wood, 0.6, 0.6, 0.6, PHX - 2, 0.3, -PHZ + 4)));
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8),
        localMat('foliage', () => new THREE.MeshStandardMaterial({ color: 0x2e5a32, roughness: 0.9, metalness: 0.0 })));
      foliage.position.set(PHX - 2, 1.1, -PHZ + 4);
      scene.add(markStatic(foliage));
    } catch (e) { /* ignore */ }

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
      // reuse buildDoor but with the penthouse-wall X coordinate by temporarily
      // shifting HHW behavior: buildDoor uses slot.side * HHW, which is the
      // hallway half-width. For the penthouse the wall is at -PHX, so we build
      // a bespoke door group here instead.
      const d = buildPenthouseDoor(scene, slot, PHX);
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
    const elDoorMat = localMat('elDoor', () =>
      new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.28, metalness: 0.95 }));
    scene.add(markStatic(boxMesh(brass, 5, 4.2, 0.4, PHX - 6, 2.1, PHZ - 0.6)));
    for (const dd of [-1, 1]) {
      scene.add(markStatic(boxMesh(elDoorMat, 1.5, 3.6, 0.2, PHX - 6 + dd * 0.8, 1.8, PHZ - 0.85)));
    }
    try {
      const elSign = aesthetics.makeNeonSign('ELEVATOR', COLORS.gold, { size: 0.45, light: false });
      elSign.position.set(PHX - 6, 4.6, PHZ - 0.9);
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
      // gentle calm-water shimmer
      water.position.y = 0.16 + Math.sin(t * 1.2) * 0.015;
      for (let ci = 0; ci < chandeliers.length; ci++) {
        chandeliers[ci].rotation.y = Math.sin(t * 0.3 + ci) * 0.08;
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

  // Bespoke penthouse suite door (wall at -wallHalfX, faces +X interior).
  function buildPenthouseDoor(scene, slot, wallHalfX) {
    const group = new THREE.Group();
    const wallX = -wallHalfX;
    const inward = 1;                 // toward interior (+X)
    const yaw = Math.PI / 2;
    const doorW = 2.6, doorH = 3.8;
    const recess = 0.3;

    const recessMat = localMat('doorRecess', () =>
      new THREE.MeshStandardMaterial({ color: 0x1c1610, roughness: 0.9, metalness: 0.0 }));
    group.add(boxMesh(recessMat, 0.12, doorH + 0.5, doorW + 0.5, wallX - recess, (doorH + 0.5) / 2, slot.z));

    const cMat = moldingMat();
    const casingX = wallX + inward * 0.02;
    group.add(boxMesh(cMat, 0.16, doorH + 0.5, 0.24, casingX, (doorH + 0.5) / 2, slot.z - (doorW / 2 + 0.2)));
    group.add(boxMesh(cMat, 0.16, doorH + 0.5, 0.24, casingX, (doorH + 0.5) / 2, slot.z + (doorW / 2 + 0.2)));
    group.add(boxMesh(cMat, 0.16, 0.26, doorW + 0.7, casingX, doorH + 0.46, slot.z));

    // double-leaf penthouse door
    const panelMat = doorPanelMat('penthouse');
    const panelX = wallX + (recess - 0.16);
    for (const off of [-doorW / 4, doorW / 4]) {
      group.add(boxMesh(panelMat, 0.14, doorH, doorW / 2 - 0.04, panelX, doorH / 2, slot.z + off));
    }
    const brass = aesthetics.material('brass');
    for (const off of [-0.18, 0.18]) {
      group.add(boxMesh(brass, 0.1, 0.16, 0.1, panelX + inward * 0.16, doorH * 0.46, slot.z + off));
    }

    const plate = brassPlate(slot.unit != null ? slot.unit : '•', 0.46, 0.55);
    plate.position.set(casingX + inward * 0.06, doorH * 0.62, slot.z + (doorW / 2 + 0.35));
    plate.rotation.y = yaw;
    group.add(plate);

    const occMat = new THREE.MeshStandardMaterial({
      color: 0x2a1c0e, emissive: OCCUPIED_WARM, emissiveIntensity: 0.0,
      roughness: 0.5, metalness: 0.1,
    });
    const occOrb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), occMat);
    occOrb.position.set(casingX + inward * 0.08, doorH + 0.2, slot.z);
    group.add(occOrb);

    let nameMesh = null;
    function refreshDoor() {
      const owned = ownsRoom(slot.roomId);
      occMat.emissiveIntensity = owned ? 1.1 : 0.0;
      const nm = owned ? roomName(slot.roomId) : '';
      if (nm) {
        if (!nameMesh) {
          nameMesh = namePlate(nm.slice(0, 14), 1.3, 0.34);
          nameMesh.position.set(casingX + inward * 0.07, doorH * 0.92, slot.z);
          nameMesh.rotation.y = yaw;
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
