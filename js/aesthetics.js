// =============================================================
// Digital Casinos — aesthetics.js
// Visual / atmosphere toolkit for the Vegas-night interior look.
// Consumed by casino.js and venues.js. Pure visual helpers — never
// throws on missing data, caches geometries/materials aggressively.
// =============================================================
import * as THREE from 'three';
import { COLORS } from './config.js';

// ----------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------
const _color = new THREE.Color();
function toHex(c) {
  if (c == null) return 0xffffff;
  if (typeof c === 'number') return c >>> 0;
  try { return _color.set(c).getHex(); } catch (e) { return 0xffffff; }
}
function colorKey(c) { return toHex(c).toString(16).padStart(6, '0'); }

// Mix two colors (a,b as hex) by t -> new THREE.Color
function mixColor(a, b, t) {
  const ca = new THREE.Color(toHex(a));
  const cb = new THREE.Color(toHex(b));
  return ca.lerp(cb, THREE.MathUtils.clamp(t, 0, 1));
}

// ----------------------------------------------------------------
// Per-theme atmosphere tuning
// ----------------------------------------------------------------
function themeOf(floorDef) {
  return (floorDef && floorDef.theme) || 'classic';
}

function fogSettingsFor(theme) {
  switch (theme) {
    case 'pool':       return { color: 0x123a4d, density: 0.0055 }; // cool cyan haze
    case 'highroller': return { color: 0x241038, density: 0.0065 }; // deep purple
    case 'promenade':  return { color: 0x1a2630, density: 0.0055 }; // teal promenade
    case 'classic':
    default:           return { color: 0x3a1018, density: 0.006 };  // warm red
  }
}

// ----------------------------------------------------------------
// Canvas texture cache + private drawing helpers
// ----------------------------------------------------------------
const _texCache = new Map();
function cachedTexture(key, makeCanvas, configure) {
  let tex = _texCache.get(key);
  if (tex) return tex;
  const canvas = makeCanvas();
  tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  if (configure) configure(tex);
  _texCache.set(key, tex);
  return tex;
}

function newCanvas(w, h) {
  const c = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : { width: w, height: h, getContext: () => null };
  c.width = w; c.height = h;
  return c;
}

// Subtle damask-ish carpet pattern over a base color.
function drawCarpetCanvas(baseHex) {
  const S = 256;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // lighter + darker accents derived from base
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.18);
  const dark = base.clone().lerp(new THREE.Color(0x000000), 0.4);
  const lightCss = `#${light.getHexString()}`;
  const darkCss = `#${dark.getHexString()}`;

  // faint diamond lattice
  ctx.strokeStyle = darkCss;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  for (let i = -S; i < S * 2; i += 32) {
    ctx.moveTo(i, 0); ctx.lineTo(i + S, S);
    ctx.moveTo(i, S); ctx.lineTo(i + S, 0);
  }
  ctx.stroke();

  // damask dots at lattice intersections
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = lightCss;
  for (let y = 0; y <= S; y += 64) {
    for (let x = 0; x <= S; x += 64) {
      const ox = ((y / 64) % 2) ? 32 : 0;
      ctx.beginPath();
      ctx.arc(x + ox, y, 5, 0, Math.PI * 2);
      ctx.fill();
      // little 4-petal flourish
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(x + ox, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

// Soft veiny marble.
function drawMarbleCanvas(baseHex) {
  const S = 256;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // mottled background
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const shade = 0.5 + Math.random() * 0.5;
    const col = base.clone().lerp(new THREE.Color(0xffffff), (shade - 0.5) * 0.3);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = 0.04;
    ctx.beginPath();
    ctx.arc(x, y, 6 + Math.random() * 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // grey veins
  const veinCol = base.clone().lerp(new THREE.Color(0x444444), 0.5);
  ctx.strokeStyle = `#${veinCol.getHexString()}`;
  for (let v = 0; v < 8; v++) {
    ctx.globalAlpha = 0.12 + Math.random() * 0.12;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    let x = Math.random() * S, y = 0;
    ctx.moveTo(x, y);
    while (y < S) {
      x += (Math.random() - 0.5) * 40;
      y += 8 + Math.random() * 16;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return c;
}

// Glowing neon text on transparent -> used as an emissive map.
function drawSignCanvas(text, colorHex, fontScale) {
  text = String(text == null ? '' : text);
  const pad = 40;
  const fontPx = Math.round(96 * (fontScale || 1));
  // measure
  const meas = newCanvas(8, 8);
  const mctx = meas.getContext('2d');
  let textW = text.length * fontPx * 0.6;
  if (mctx) {
    mctx.font = `bold ${fontPx}px Arial, sans-serif`;
    textW = Math.max(8, mctx.measureText(text).width);
  }
  const W = Math.ceil(textW + pad * 2);
  const H = Math.ceil(fontPx + pad * 2);
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return { canvas: c, w: W, h: H };

  const col = new THREE.Color(toHex(colorHex));
  const css = `#${col.getHexString()}`;
  const bright = col.clone().lerp(new THREE.Color(0xffffff), 0.55);
  const brightCss = `#${bright.getHexString()}`;

  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontPx}px Arial, sans-serif`;

  // outer glow passes
  ctx.shadowColor = css;
  ctx.fillStyle = css;
  for (let i = 0; i < 3; i++) {
    ctx.shadowBlur = 28 - i * 6;
    ctx.fillText(text, W / 2, H / 2);
  }
  // bright core
  ctx.shadowBlur = 8;
  ctx.fillStyle = brightCss;
  ctx.fillText(text, W / 2, H / 2);
  // tiny white inner highlight
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, W / 2, H / 2);
  ctx.globalAlpha = 1;

  return { canvas: c, w: W, h: H };
}

// Vegas night skyline backdrop.
function drawSkylineCanvas() {
  const W = 2048, H = 512;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  // gradient night sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#05060f');
  sky.addColorStop(0.55, '#101637');
  sky.addColorStop(0.78, '#3a1f5c');
  sky.addColorStop(0.92, '#7a2f6a');
  sky.addColorStop(1.0, '#1a0c1e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // stars
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.5;
    ctx.globalAlpha = 0.2 + Math.random() * 0.7;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  // distant skyline layer (darker)
  drawBuildingRow(ctx, W, H, H * 0.62, '#0a0c1c', 0.55, 60, 140, false);
  // mid skyline
  drawBuildingRow(ctx, W, H, H * 0.5, '#11142b', 0.85, 50, 220, true);
  // foreground skyline (taller towers w/ lit windows)
  drawBuildingRow(ctx, W, H, H * 0.32, '#0c0e1f', 1.0, 70, 320, true);

  // a couple of glowing landmark beams
  for (let i = 0; i < 3; i++) {
    const bx = (0.2 + i * 0.3) * W + (Math.random() - 0.5) * 120;
    const grad = ctx.createLinearGradient(bx, H, bx, 0);
    grad.addColorStop(0, 'rgba(255,210,80,0.0)');
    grad.addColorStop(1, 'rgba(255,210,80,0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(bx - 8, 0, 16, H);
  }

  return c;
}

function drawBuildingRow(ctx, W, H, baseY, fillCss, alpha, minH, maxH, lit) {
  ctx.save();
  ctx.globalAlpha = alpha;
  let x = -20;
  while (x < W + 20) {
    const bw = 24 + Math.random() * 70;
    const bh = minH + Math.random() * (maxH - minH);
    const top = baseY - bh;
    ctx.fillStyle = fillCss;
    ctx.fillRect(x, top, bw, bh + (H - baseY));

    if (lit) {
      // lit windows grid
      const cols = Math.max(1, Math.floor(bw / 8));
      const rows = Math.max(1, Math.floor(bh / 10));
      for (let r = 0; r < rows; r++) {
        for (let cI = 0; cI < cols; cI++) {
          if (Math.random() < 0.42) {
            const warm = Math.random();
            ctx.fillStyle = warm < 0.7
              ? 'rgba(255,214,120,0.9)'
              : (warm < 0.85 ? 'rgba(120,224,255,0.85)' : 'rgba(255,90,200,0.85)');
            ctx.fillRect(x + 3 + cI * 8, top + 4 + r * 10, 4, 5);
          }
        }
      }
    }
    x += bw + 4 + Math.random() * 8;
  }
  ctx.restore();
}

// ----------------------------------------------------------------
// neonMaterial(color, intensity) — cached emissive standard material
// ----------------------------------------------------------------
const _neonMatCache = new Map();
export function neonMaterial(color, intensity = 1.4) {
  const hex = toHex(color);
  const key = `${colorKey(hex)}_${(+intensity).toFixed(2)}`;
  let m = _neonMatCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: intensity,
    roughness: 0.25,
    metalness: 0.0,
  });
  _neonMatCache.set(key, m);
  return m;
}

// ----------------------------------------------------------------
// material(kind, floorDef) — cached themed surface materials
// ----------------------------------------------------------------
const _matCache = new Map();
export function material(kind, floorDef) {
  const carpetHex = (floorDef && floorDef.carpet != null) ? toHex(floorDef.carpet) : COLORS.carpet;
  const key = `${kind}_${colorKey(carpetHex)}`;
  let m = _matCache.get(key);
  if (m) return m;

  switch (kind) {
    case 'carpet': {
      const tex = cachedTexture('carpet_' + colorKey(carpetHex),
        () => drawCarpetCanvas(carpetHex),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(20, 14);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
        });
      m = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.95, metalness: 0.0 });
      break;
    }
    case 'marble': {
      const tex = cachedTexture('marble_' + colorKey(toHex(COLORS.marble)),
        () => drawMarbleCanvas(COLORS.marble),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(6, 6);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
        });
      m = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.18, metalness: 0.15 });
      break;
    }
    case 'wall': {
      // deep tone derived from the floor carpet color, darkened & desaturated
      const wallCol = mixColor(carpetHex, 0x140a10, 0.55);
      m = new THREE.MeshStandardMaterial({ color: wallCol.getHex(), roughness: 0.85, metalness: 0.05 });
      break;
    }
    case 'ceiling': {
      m = new THREE.MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.95, metalness: 0.0 });
      break;
    }
    case 'water': {
      m = new THREE.MeshStandardMaterial({
        color: toHex(COLORS.water),
        emissive: mixColor(COLORS.water, 0x000000, 0.6).getHex(),
        emissiveIntensity: 0.25,
        roughness: 0.12,
        metalness: 0.4,
        transparent: true,
        opacity: 0.82,
      });
      break;
    }
    case 'glass': {
      m = new THREE.MeshStandardMaterial({
        color: 0xbfe6ff,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      });
      break;
    }
    case 'brass': {
      m = new THREE.MeshStandardMaterial({
        color: toHex(COLORS.brass),
        roughness: 0.3,
        metalness: 0.95,
        emissive: mixColor(COLORS.brass, 0x000000, 0.7).getHex(),
        emissiveIntensity: 0.1,
      });
      break;
    }
    case 'wood': {
      m = new THREE.MeshStandardMaterial({ color: 0x5a3417, roughness: 0.6, metalness: 0.05 });
      break;
    }
    default: {
      m = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.8, metalness: 0.0 });
      break;
    }
  }
  _matCache.set(key, m);
  return m;
}

// ----------------------------------------------------------------
// addInteriorLighting(scene, floorDef) -> { update(dt), dispose() }
// ----------------------------------------------------------------
export function addInteriorLighting(scene, floorDef) {
  const added = [];
  const neonLights = [];
  let prevFog = null;
  let prevFogStored = false;

  if (!scene || !scene.add) {
    // Defensive no-op handle
    return { update() {}, dispose() {} };
  }

  const theme = themeOf(floorDef);
  const neonHex = toHex((floorDef && floorDef.neon) != null ? floorDef.neon : COLORS.neon);
  const accentHex = toHex((floorDef && floorDef.accent) != null ? floorDef.accent : COLORS.gold);

  // --- base ambient/hemispheric (warm) ---
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0x3a1820, 0.95);
  scene.add(hemi); added.push(hemi);

  const ambient = new THREE.AmbientLight(0xfff0dd, 0.7);
  scene.add(ambient); added.push(ambient);

  // --- soft directional "house" light from above ---
  const dir = new THREE.DirectionalLight(0xfff4e2, 0.95);
  dir.position.set(20, 60, 10);
  scene.add(dir); added.push(dir);
  if (dir.target) { scene.add(dir.target); added.push(dir.target); }

  // --- 2..4 colored neon point lights tinted to neon/accent ---
  const tints = [neonHex, accentHex, mixColor(neonHex, accentHex, 0.5).getHex(), neonHex];
  // spread roughly across the floor footprint (X[-60,60], Z[-42,42])
  const spots = [
    { x: -38, z: -24 },
    { x: 40, z: -22 },
    { x: -34, z: 26 },
    { x: 36, z: 24 },
  ];
  const count = 4; // within 2..4
  for (let i = 0; i < count; i++) {
    const pl = new THREE.PointLight(tints[i % tints.length], 2.0, 95, 1.8);
    pl.position.set(spots[i].x, 5.8, spots[i].z);
    scene.add(pl); added.push(pl);
    neonLights.push({ light: pl, base: 2.0, phase: i * 1.7, speed: 0.8 + i * 0.15 });
  }

  // --- subtle exponential fog tuned to theme ---
  const fs = fogSettingsFor(theme);
  // store previous so dispose can restore (multiple floors may share one scene)
  prevFog = scene.fog || null;
  prevFogStored = true;
  scene.fog = new THREE.FogExp2(fs.color, fs.density);

  let t = 0;
  function update(dt) {
    if (!(dt > 0)) dt = 0.016;
    t += dt;
    for (const n of neonLights) {
      // gentle pulse, stays bright enough to navigate
      const pulse = 0.82 + 0.32 * Math.sin(t * n.speed + n.phase);
      n.light.intensity = n.base * pulse;
    }
  }

  function dispose() {
    for (const obj of added) {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.dispose) { try { obj.dispose(); } catch (e) {} }
    }
    added.length = 0;
    neonLights.length = 0;
    if (prevFogStored && scene.fog && scene.fog.isFogExp2) {
      // restore whatever was there before (or clear)
      scene.fog = prevFog;
    }
  }

  return { update, dispose };
}

// ----------------------------------------------------------------
// makeNeonSign(text, color, opts) -> THREE.Object3D
// ----------------------------------------------------------------
export function makeNeonSign(text, color, opts = {}) {
  const group = new THREE.Object3D();
  const hex = toHex(color);
  const size = opts.size || 1;
  const wantBacking = opts.backing !== false; // default on
  const wantLight = opts.light !== false;     // default on

  const { canvas, w, h } = drawSignCanvas(text, hex, size);
  const aspect = (h > 0) ? (w / h) : 4;

  // world height of the sign panel scales with size
  const signH = 1.1 * size;
  const signW = signH * aspect;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  // emissive plane (text glows). Use the canvas as emissive map; transparent so
  // only the glyphs light up.
  const signMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 1.6,
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const signGeo = new THREE.PlaneGeometry(signW, signH);
  const signMesh = new THREE.Mesh(signGeo, signMat);
  signMesh.position.z = 0.06;
  group.add(signMesh);

  // dark backing panel slightly larger so the sign reads as a lit fixture
  if (wantBacking) {
    const padX = 0.5 * size, padY = 0.4 * size;
    const backGeo = new THREE.PlaneGeometry(signW + padX, signH + padY);
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0e,
      roughness: 0.7,
      metalness: 0.3,
      emissive: hex,
      emissiveIntensity: 0.05,
      side: THREE.DoubleSide,
    });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.z = 0;
    group.add(back);

    // thin neon trim frame (emissive border via 4 thin bars)
    const trimMat = neonMaterial(hex, 1.3);
    const tThick = 0.06 * size;
    const halfW = (signW + padX) / 2, halfH = (signH + padY) / 2;
    const barH = new THREE.PlaneGeometry(signW + padX, tThick);
    const barV = new THREE.PlaneGeometry(tThick, signH + padY);
    const top = new THREE.Mesh(barH, trimMat); top.position.set(0, halfH, 0.01);
    const bot = new THREE.Mesh(barH, trimMat); bot.position.set(0, -halfH, 0.01);
    const lft = new THREE.Mesh(barV, trimMat); lft.position.set(-halfW, 0, 0.01);
    const rgt = new THREE.Mesh(barV, trimMat); rgt.position.set(halfW, 0, 0.01);
    group.add(top, bot, lft, rgt);
  }

  // faint point light in front for glow
  if (wantLight) {
    const glow = new THREE.PointLight(hex, 0.8, 8 * size, 2.0);
    glow.position.set(0, 0, 1.2 * size);
    group.add(glow);
  }

  group.userData.isNeonSign = true;
  return group;
}

// ----------------------------------------------------------------
// makeChandelier() -> THREE.Object3D
// Shared geometry; instanced beads to keep poly count reasonable.
// ----------------------------------------------------------------
let _chandShared = null;
function chandShared() {
  if (_chandShared) return _chandShared;
  _chandShared = {
    ringGeo: new THREE.TorusGeometry(1.0, 0.05, 8, 32),
    ring2Geo: new THREE.TorusGeometry(0.6, 0.04, 8, 28),
    capGeo: new THREE.ConeGeometry(0.18, 0.5, 10),
    beadGeo: new THREE.IcosahedronGeometry(0.07, 0),
    rodGeo: new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6),
    goldMat: neonMaterial(COLORS.gold, 0.9),
    crystalMat: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff3c0,
      emissiveIntensity: 1.2,
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.9,
    }),
  };
  return _chandShared;
}

export function makeChandelier() {
  const g = chandShared();
  const group = new THREE.Object3D();

  // hanging rod from ceiling
  const rod = new THREE.Mesh(g.rodGeo, g.goldMat);
  rod.position.y = 0.6;
  group.add(rod);

  // two gold rings forming the frame
  const ring = new THREE.Mesh(g.ringGeo, g.goldMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const ring2 = new THREE.Mesh(g.ring2Geo, g.goldMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.22;
  group.add(ring2);

  // central cap
  const cap = new THREE.Mesh(g.capGeo, g.goldMat);
  cap.position.y = -0.05;
  group.add(cap);

  // crystal beads draped around both rings (instanced)
  const beadCount = 64;
  const beads = new THREE.InstancedMesh(g.beadGeo, g.crystalMat, beadCount);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  let idx = 0;
  // outer ring strands
  const outer = 40;
  for (let i = 0; i < outer && idx < beadCount; i++) {
    const a = (i / outer) * Math.PI * 2;
    const r = 1.0;
    const drop = -0.05 - ((i % 3) * 0.18);
    pos.set(Math.cos(a) * r, drop, Math.sin(a) * r);
    const s = 0.8 + (i % 3) * 0.25;
    scl.set(s, s, s);
    m.compose(pos, quat, scl);
    beads.setMatrixAt(idx++, m);
  }
  // inner ring strands
  for (let i = 0; i < beadCount - outer && idx < beadCount; i++) {
    const a = (i / (beadCount - outer)) * Math.PI * 2;
    const r = 0.6;
    const drop = 0.15 - ((i % 2) * 0.2);
    pos.set(Math.cos(a) * r, drop, Math.sin(a) * r);
    const s = 0.7 + (i % 2) * 0.2;
    scl.set(s, s, s);
    m.compose(pos, quat, scl);
    beads.setMatrixAt(idx++, m);
  }
  beads.instanceMatrix.needsUpdate = true;
  group.add(beads);

  // soft warm point light
  const light = new THREE.PointLight(0xffe6a8, 1.0, 30, 2.0);
  light.position.y = -0.1;
  group.add(light);

  group.userData.isChandelier = true;
  return group;
}

// ----------------------------------------------------------------
// makeWindowSkyline() -> THREE.Object3D
// Wide dark backdrop quad of a Vegas night skyline with glowing windows.
// ----------------------------------------------------------------
let _skylineTex = null;
let _skylineMat = null;
function skylineMaterial() {
  if (_skylineMat) return _skylineMat;
  _skylineTex = cachedTexture('skyline', () => drawSkylineCanvas(), (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  });
  // Emissive so it glows on its own behind the windows regardless of interior light.
  _skylineMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: _skylineTex,
    emissiveIntensity: 1.0,
    roughness: 1.0,
    metalness: 0.0,
    fog: false,
    side: THREE.DoubleSide,
  });
  return _skylineMat;
}

let _skylineGeo = null;
export function makeWindowSkyline() {
  if (!_skylineGeo) _skylineGeo = new THREE.PlaneGeometry(130, 30);
  const mesh = new THREE.Mesh(_skylineGeo, skylineMaterial());
  mesh.userData.isSkyline = true;
  return mesh;
}
