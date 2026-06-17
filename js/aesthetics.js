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
// Best anisotropy we can use without a renderer handle. 8 is safely supported
// on virtually all WebGL2 hardware; installEnvironment() can bump cached
// textures higher if a renderer is available.
let MAX_ANISO = 8;

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

// Subtle damask-ish carpet pattern over a base color. Higher-res w/ a woven
// fiber texture, sharper lattice and richer two-tone damask flourishes.
function drawCarpetCanvas(baseHex) {
  const S = 512;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // lighter + darker accents derived from base
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.22);
  const dark = base.clone().lerp(new THREE.Color(0x000000), 0.42);
  const lightCss = `#${light.getHexString()}`;
  const darkCss = `#${dark.getHexString()}`;

  // fine woven fiber speckle for a plush, non-flat look
  for (let i = 0; i < 4200; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const up = Math.random() < 0.5;
    const col = base.clone().lerp(new THREE.Color(up ? 0xffffff : 0x000000), 0.10 + Math.random() * 0.10);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = 0.05;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  // crisp diamond lattice (two passes: shadow + highlight for relief)
  const step = 64;
  ctx.lineWidth = 2;
  ctx.strokeStyle = darkCss;
  ctx.globalAlpha = 0.40;
  ctx.beginPath();
  for (let i = -S; i < S * 2; i += step) {
    ctx.moveTo(i, 0); ctx.lineTo(i + S, S);
    ctx.moveTo(i, S); ctx.lineTo(i + S, 0);
  }
  ctx.stroke();
  ctx.strokeStyle = lightCss;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  for (let i = -S + 1; i < S * 2; i += step) {
    ctx.moveTo(i, 0); ctx.lineTo(i + S, S);
    ctx.moveTo(i, S); ctx.lineTo(i + S, 0);
  }
  ctx.stroke();

  // damask medallions at lattice intersections
  for (let y = 0; y <= S; y += step * 2) {
    for (let x = 0; x <= S; x += step * 2) {
      const ox = ((y / (step * 2)) % 2) ? step : 0;
      const cx = x + ox, cy = y;
      // soft glow center
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 22);
      grad.addColorStop(0, lightCss);
      grad.addColorStop(1, `#${base.getHexString()}`);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      // 4-petal flourish
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = lightCss;
      ctx.lineWidth = 2;
      for (let p = 0; p < 4; p++) {
        const a = p * Math.PI / 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 9, 4, a, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

// Soft veiny marble. Higher-res, layered mottling + fine + bold veins,
// brighter polished sheen.
function drawMarbleCanvas(baseHex) {
  const S = 512;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // broad cloudy mottling (large soft blobs)
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const towardWhite = Math.random() < 0.55;
    const col = base.clone().lerp(new THREE.Color(towardWhite ? 0xffffff : 0xcfc8b8), 0.12 + Math.random() * 0.18);
    const r = 18 + Math.random() * 60;
    const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, `#${col.getHexString()}`);
    grad.addColorStop(1, `#${base.getHexString()}`);
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // bold dark veins with branching, drawn with soft + sharp pass
  const veinCol = base.clone().lerp(new THREE.Color(0x3a3a3a), 0.55);
  const veinCss = `#${veinCol.getHexString()}`;
  function drawVein(sx, sy, len, jitter, width, alpha) {
    ctx.strokeStyle = veinCss;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let x = sx, y = sy;
    ctx.moveTo(x, y);
    let ang = Math.random() * Math.PI * 2;
    for (let s = 0; s < len; s++) {
      ang += (Math.random() - 0.5) * jitter;
      x += Math.cos(ang) * 10;
      y += Math.sin(ang) * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    return { x, y };
  }
  for (let v = 0; v < 6; v++) {
    const sx = Math.random() * S, sy = Math.random() * S;
    drawVein(sx, sy, 24, 0.5, 2.2 + Math.random() * 1.5, 0.16);
    // branch
    if (Math.random() < 0.7) drawVein(sx, sy, 14, 0.8, 1.0, 0.12);
  }
  // fine hairline veins for crispness
  for (let v = 0; v < 16; v++) {
    drawVein(Math.random() * S, Math.random() * S, 12, 0.9, 0.6, 0.10);
  }

  // faint bright sheen streak across the slab
  const sheen = ctx.createLinearGradient(0, 0, S, S);
  sheen.addColorStop(0.0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// Grayscale roughness/normal-ish helper: a soft mottled grayscale map used to
// add micro roughness variation to marble (subtle, cached separately).
function drawMarbleRoughCanvas() {
  const S = 256;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const g = Math.random() < 0.5 ? 60 : 200;
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath();
    ctx.arc(x, y, 4 + Math.random() * 14, 0, Math.PI * 2);
    ctx.fill();
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
  ctx.lineJoin = 'round';

  // wide soft halo passes (large blur, low intensity) for a real glow falloff
  ctx.shadowColor = css;
  ctx.fillStyle = css;
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 0.5;
    ctx.shadowBlur = 48 - i * 9;
    ctx.fillText(text, W / 2, H / 2);
  }
  ctx.globalAlpha = 1;

  // tube body: colored stroke + fill so glyphs read as glass neon tubes
  ctx.shadowBlur = 16;
  ctx.lineWidth = Math.max(2, fontPx * 0.05);
  ctx.strokeStyle = css;
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillStyle = brightCss;
  ctx.fillText(text, W / 2, H / 2);

  // bright inner core (tinted toward white but keeps hue)
  ctx.shadowBlur = 6;
  ctx.fillStyle = `#${col.clone().lerp(new THREE.Color(0xffffff), 0.78).getHexString()}`;
  ctx.fillText(text, W / 2, H / 2);

  // thin white-hot center line
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.save();
  ctx.font = `bold ${Math.round(fontPx * 0.97)}px Arial, sans-serif`;
  ctx.fillText(text, W / 2, H / 2);
  ctx.restore();
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
  // Slightly brighten the base color toward white so the tube reads as a hot
  // light source, and push emissive a touch above the requested intensity for
  // a crisper bloom under tone mapping.
  const bright = new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.12);
  m = new THREE.MeshStandardMaterial({
    color: bright.getHex(),
    emissive: hex,
    emissiveIntensity: intensity * 1.25,
    roughness: 0.2,
    metalness: 0.0,
    toneMapped: false, // let neon pop past the tone-map ceiling
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
          t.anisotropy = MAX_ANISO;
        });
      // bump map reuses the diffuse for cheap plush relief
      m = new THREE.MeshStandardMaterial({
        map: tex,
        bumpMap: tex,
        bumpScale: 0.04,
        color: 0xffffff,
        roughness: 0.96,
        metalness: 0.0,
      });
      break;
    }
    case 'marble': {
      const tex = cachedTexture('marble_' + colorKey(toHex(COLORS.marble)),
        () => drawMarbleCanvas(COLORS.marble),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(6, 6);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = MAX_ANISO;
        });
      const rough = cachedTexture('marble_rough',
        () => drawMarbleRoughCanvas(),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(6, 6);
          t.anisotropy = MAX_ANISO;
        });
      m = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughnessMap: rough,
        color: 0xffffff,
        roughness: 0.22,
        metalness: 0.0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        envMapIntensity: 1.1,
        reflectivity: 0.6,
      });
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
      m = new THREE.MeshPhysicalMaterial({
        color: 0xcfeeff,
        roughness: 0.03,
        metalness: 0.0,
        transparent: true,
        opacity: 0.28,
        transmission: 0.6,
        ior: 1.45,
        thickness: 0.4,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.4,
        side: THREE.DoubleSide,
      });
      break;
    }
    case 'brass': {
      m = new THREE.MeshPhysicalMaterial({
        color: toHex(COLORS.brass),
        roughness: 0.26,
        metalness: 1.0,
        clearcoat: 0.5,
        clearcoatRoughness: 0.25,
        envMapIntensity: 1.5,
        emissive: mixColor(COLORS.brass, 0x000000, 0.7).getHex(),
        emissiveIntensity: 0.08,
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
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0x3a1820, 1.0);
  scene.add(hemi); added.push(hemi);

  const ambient = new THREE.AmbientLight(0xfff0dd, 0.72);
  scene.add(ambient); added.push(ambient);

  // --- soft directional "house" light from above ---
  const dir = new THREE.DirectionalLight(0xfff4e2, 1.05);
  dir.position.set(20, 60, 10);
  scene.add(dir); added.push(dir);
  if (dir.target) { scene.add(dir.target); added.push(dir.target); }

  // --- cool rim/fill from the opposite side for depth & shape ---
  const rim = new THREE.DirectionalLight(mixColor(neonHex, 0xffffff, 0.4).getHex(), 0.35);
  rim.position.set(-30, 30, -40);
  scene.add(rim); added.push(rim);
  if (rim.target) { scene.add(rim.target); added.push(rim.target); }

  // --- 4 colored neon point lights tinted to neon/accent ---
  const tints = [neonHex, accentHex, mixColor(neonHex, accentHex, 0.5).getHex(), neonHex];
  // spread roughly across the floor footprint (X[-60,60], Z[-42,42])
  const spots = [
    { x: -38, z: -24 },
    { x: 40, z: -22 },
    { x: -34, z: 26 },
    { x: 36, z: 24 },
  ];
  const count = 4;
  const baseI = 2.3;
  for (let i = 0; i < count; i++) {
    const pl = new THREE.PointLight(tints[i % tints.length], baseI, 105, 1.8);
    pl.position.set(spots[i].x, 5.8, spots[i].z);
    scene.add(pl); added.push(pl);
    neonLights.push({ light: pl, base: baseI, phase: i * 1.7, speed: 0.8 + i * 0.15 });
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
    ringGeo: new THREE.TorusGeometry(1.15, 0.05, 10, 40),
    ring2Geo: new THREE.TorusGeometry(0.78, 0.045, 10, 34),
    ring3Geo: new THREE.TorusGeometry(0.42, 0.04, 8, 28),
    capGeo: new THREE.ConeGeometry(0.2, 0.55, 12),
    finialGeo: new THREE.SphereGeometry(0.12, 12, 10),
    beadGeo: new THREE.OctahedronGeometry(0.075, 0), // faceted crystal
    rodGeo: new THREE.CylinderGeometry(0.022, 0.022, 1.2, 8),
    goldMat: neonMaterial(COLORS.gold, 1.1),
    crystalMat: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0xfff0c0,
      emissiveIntensity: 1.35,
      roughness: 0.06,
      metalness: 0.0,
      transmission: 0.5,
      ior: 1.5,
      thickness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.92,
      envMapIntensity: 1.6,
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

  // three gold rings forming a tiered frame
  const ring = new THREE.Mesh(g.ringGeo, g.goldMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.05;
  group.add(ring);

  const ring2 = new THREE.Mesh(g.ring2Geo, g.goldMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.24;
  group.add(ring2);

  const ring3 = new THREE.Mesh(g.ring3Geo, g.goldMat);
  ring3.rotation.x = Math.PI / 2;
  ring3.position.y = 0.5;
  group.add(ring3);

  // central cap + glowing finial
  const cap = new THREE.Mesh(g.capGeo, g.goldMat);
  cap.position.y = -0.05;
  group.add(cap);
  const finial = new THREE.Mesh(g.finialGeo, g.crystalMat);
  finial.position.y = -0.32;
  group.add(finial);

  // crystal beads draped around three tiers (single instanced mesh)
  // tiers: [radius, baseY, count, dropStep]
  const tiers = [
    { r: 1.15, y: -0.05, n: 56, drop: 0.16 },
    { r: 0.78, y: 0.24, n: 36, drop: 0.14 },
    { r: 0.42, y: 0.5, n: 22, drop: 0.12 },
  ];
  const beadCount = tiers.reduce((s, t) => s + t.n, 0);
  const beads = new THREE.InstancedMesh(g.beadGeo, g.crystalMat, beadCount);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const scl = new THREE.Vector3(1, 1, 1);
  let idx = 0;
  for (const tier of tiers) {
    for (let i = 0; i < tier.n && idx < beadCount; i++) {
      const a = (i / tier.n) * Math.PI * 2;
      const drop = tier.y - 0.05 - ((i % 4) * tier.drop);
      pos.set(Math.cos(a) * tier.r, drop, Math.sin(a) * tier.r);
      eul.set(0, a, Math.PI / 6 + (i % 3) * 0.2);
      quat.setFromEuler(eul);
      const s = 0.75 + (i % 4) * 0.18;
      scl.set(s, s * 1.4, s); // elongated teardrop crystals
      m.compose(pos, quat, scl);
      beads.setMatrixAt(idx++, m);
    }
  }
  beads.instanceMatrix.needsUpdate = true;
  group.add(beads);

  // soft warm point light (warmer + brighter for opulence)
  const light = new THREE.PointLight(0xffdfa0, 1.4, 34, 2.0);
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

// ----------------------------------------------------------------
// installEnvironment(renderer, scene) -> THREE.Texture | null
// Build a small PMREM environment from a procedural gradient "room" so that
// marble / brass / glass pick up real reflections. Fully guarded: returns null
// and is a no-op on any failure. The generated env map is cached and reused
// across calls (and across scenes) so this is cheap to call repeatedly.
// ----------------------------------------------------------------
let _envTexture = null;
let _envTried = false;

// Procedural equirect-ish gradient canvas used as the PMREM source. A warm
// Vegas glow up top fading to a darker floor, with a couple of soft light pools
// to give metals/marble something to reflect.
function drawEnvCanvas() {
  const W = 512, H = 256;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#2a2030'); // upper warm-violet ambience
  sky.addColorStop(0.45, '#3a2a3a');
  sky.addColorStop(0.6, '#54402f'); // warm horizon band (gilded glow)
  sky.addColorStop(0.75, '#241820');
  sky.addColorStop(1.0, '#0a0810'); // dark floor
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // soft bright light pools near the horizon for specular highlights
  const pools = [
    { x: W * 0.22, y: H * 0.52, r: 70, col: 'rgba(255,225,170,0.55)' },
    { x: W * 0.62, y: H * 0.5, r: 90, col: 'rgba(255,120,210,0.30)' },
    { x: W * 0.85, y: H * 0.55, r: 60, col: 'rgba(120,224,255,0.28)' },
  ];
  for (const p of pools) {
    const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
    g.addColorStop(0, p.col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return c;
}

export function installEnvironment(renderer, scene) {
  try {
    // Try to raise anisotropy on already-cached textures now that we have a
    // real renderer to query the hardware limit.
    if (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
      const max = renderer.capabilities.getMaxAnisotropy() || MAX_ANISO;
      if (max > MAX_ANISO) {
        MAX_ANISO = max;
        for (const tex of _texCache.values()) {
          if (tex && 'anisotropy' in tex && tex.anisotropy < max && tex.repeat && (tex.repeat.x > 1 || tex.repeat.y > 1)) {
            tex.anisotropy = max;
            tex.needsUpdate = true;
          }
        }
      }
    }

    // Reuse a previously generated env map.
    if (_envTexture) {
      if (scene) scene.environment = _envTexture;
      return _envTexture;
    }
    if (_envTried) return null; // already failed once; don't keep churning
    _envTried = true;

    if (!renderer || typeof THREE.PMREMGenerator !== 'function') return null;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader && pmrem.compileEquirectangularShader();

    const canvas = drawEnvCanvas();
    const srcTex = new THREE.CanvasTexture(canvas);
    srcTex.mapping = THREE.EquirectangularReflectionMapping;
    srcTex.colorSpace = THREE.SRGBColorSpace;
    srcTex.needsUpdate = true;

    const rt = pmrem.fromEquirectangular(srcTex);
    _envTexture = rt && rt.texture ? rt.texture : null;

    // PMREM source no longer needed; the prefiltered RT texture is what we keep.
    srcTex.dispose();
    pmrem.dispose();

    if (_envTexture && scene) scene.environment = _envTexture;
    return _envTexture;
  } catch (e) {
    // Never throw from a visual helper.
    return _envTexture || null;
  }
}
