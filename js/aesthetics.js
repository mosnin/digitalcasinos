// =============================================================
// Digital Casinos — aesthetics.js
// Visual / atmosphere toolkit for the warm, upscale Las-Vegas
// casino-resort interior look.
// Consumed by casino.js and venues.js. Pure visual helpers — never
// throws on missing data, caches geometries/materials aggressively.
//
// Wave 5 overhaul: removed the saturated pink/cyan neon glow in favor
// of a realistic warm-amber resort palette — cream/ivory veined marble,
// dark walnut/cherry wood, burgundy/emerald patterned carpet, brushed
// brass/gold, clear glass, warm plaster walls. Signage is now tasteful
// backlit/edge-lit lettering, lighting is warm and bright, fog is thin.
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

// Warm amber reference used to tint accents toward a gilded resort glow.
const WARM_HEX = 0xffcf8a;

// Nudge an arbitrary color toward warm amber so stray cyans/magentas read
// as classy gilded accents rather than club neon.
function warmify(hex, amount) {
  return mixColor(hex, WARM_HEX, THREE.MathUtils.clamp(amount, 0, 1));
}

// ----------------------------------------------------------------
// Per-theme atmosphere tuning
// ----------------------------------------------------------------
function themeOf(floorDef) {
  return (floorDef && floorDef.theme) || 'classic';
}

// Thin, warm haze only — low density so the floor stays bright and readable.
// No saturated cyan/purple fog anymore; everything trends to warm taupe.
function fogSettingsFor(theme) {
  switch (theme) {
    case 'pool':       return { color: 0x2b2a2e, density: 0.0018 }; // cool-neutral, very light
    case 'highroller': return { color: 0x2a2320, density: 0.0022 }; // warm dusk
    case 'promenade':  return { color: 0x2b2825, density: 0.0020 }; // warm taupe
    case 'classic':
    default:           return { color: 0x2e271f, density: 0.0022 }; // warm amber haze
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

// Subtle, refined damask carpet pattern over a rich base color (burgundy /
// emerald). Tightly woven fiber speckle, a soft tone-on-tone diamond lattice
// and understated medallions — reads as a real upscale patterned carpet, not
// a glowing club floor.
function drawCarpetCanvas(baseHex) {
  const S = 512;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // tone-on-tone accents derived from base (kept subtle for realism)
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.14);
  const dark = base.clone().lerp(new THREE.Color(0x000000), 0.38);
  const lightCss = `#${light.getHexString()}`;
  const darkCss = `#${dark.getHexString()}`;

  // dense fine woven fiber speckle for a plush, non-flat look
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const up = Math.random() < 0.5;
    const col = base.clone().lerp(new THREE.Color(up ? 0xffffff : 0x000000), 0.06 + Math.random() * 0.08);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.globalAlpha = 0.045;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;

  // soft tone-on-tone diamond lattice (shadow + highlight for gentle relief)
  const step = 64;
  ctx.lineWidth = 2;
  ctx.strokeStyle = darkCss;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  for (let i = -S; i < S * 2; i += step) {
    ctx.moveTo(i, 0); ctx.lineTo(i + S, S);
    ctx.moveTo(i, S); ctx.lineTo(i + S, 0);
  }
  ctx.stroke();
  ctx.strokeStyle = lightCss;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  for (let i = -S + 1; i < S * 2; i += step) {
    ctx.moveTo(i, 0); ctx.lineTo(i + S, S);
    ctx.moveTo(i, S); ctx.lineTo(i + S, 0);
  }
  ctx.stroke();

  // understated damask medallions at lattice intersections
  for (let y = 0; y <= S; y += step * 2) {
    for (let x = 0; x <= S; x += step * 2) {
      const ox = ((y / (step * 2)) % 2) ? step : 0;
      const cx = x + ox, cy = y;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 22);
      grad.addColorStop(0, lightCss);
      grad.addColorStop(1, `#${base.getHexString()}`);
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
      // 4-petal flourish (faint)
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = lightCss;
      ctx.lineWidth = 1.5;
      for (let p = 0; p < 4; p++) {
        const a = p * Math.PI / 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15, 8, 3.5, a, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  return c;
}

// Realistic cream/ivory veined marble. Warm ivory base, soft cloudy mottling,
// fine grey-gold veining and a faint polished sheen — quarried stone, not a
// glowing surface.
function drawMarbleCanvas(baseHex) {
  const S = 512;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // broad cloudy mottling — warm cream lights and soft taupe shadows
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const towardWhite = Math.random() < 0.6;
    const col = base.clone().lerp(
      new THREE.Color(towardWhite ? 0xfffaf0 : 0xcfc4ad), 0.10 + Math.random() * 0.16);
    const r = 18 + Math.random() * 64;
    const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, `#${col.getHexString()}`);
    grad.addColorStop(1, `#${base.getHexString()}`);
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // bold veins with branching — warm grey/gold, soft + sharp pass
  const veinCol = base.clone().lerp(new THREE.Color(0x8a7a5e), 0.55);
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
    drawVein(sx, sy, 24, 0.5, 1.8 + Math.random() * 1.3, 0.14);
    if (Math.random() < 0.7) drawVein(sx, sy, 14, 0.8, 0.9, 0.10);
  }
  // fine hairline veins for crispness
  for (let v = 0; v < 16; v++) {
    drawVein(Math.random() * S, Math.random() * S, 12, 0.9, 0.5, 0.08);
  }

  // faint polished sheen streak across the slab
  const sheen = ctx.createLinearGradient(0, 0, S, S);
  sheen.addColorStop(0.0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  sheen.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// Grayscale roughness helper: a soft mottled grayscale map used to add micro
// roughness variation to marble (subtle, cached separately).
function drawMarbleRoughCanvas() {
  const S = 256;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const g = Math.random() < 0.5 ? 90 : 170;
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath();
    ctx.arc(x, y, 4 + Math.random() * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

// Realistic wood grain (dark walnut / cherry). Layered tonal bands with fine
// streaks and occasional knots — used by the 'wood' material.
function drawWoodCanvas(baseHex) {
  const S = 512;
  const c = newCanvas(S, S);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const base = new THREE.Color(toHex(baseHex));
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, S, S);

  // broad vertical tonal bands (plank-to-plank variation)
  for (let x = 0; x < S; x += 4) {
    const t = (Math.sin(x * 0.06) + Math.sin(x * 0.017 + 1.3)) * 0.5;
    const shade = base.clone().lerp(new THREE.Color(t > 0 ? 0x2a160a : 0x000000), 0.10 + Math.abs(t) * 0.10);
    ctx.fillStyle = `#${shade.getHexString()}`;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, 0, 4, S);
  }
  ctx.globalAlpha = 1;

  // long fine grain streaks
  const darkGrain = base.clone().lerp(new THREE.Color(0x000000), 0.5);
  const lightGrain = base.clone().lerp(new THREE.Color(0x6a3d1e), 0.4);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const sway = 6 + Math.random() * 10;
    ctx.strokeStyle = `#${(Math.random() < 0.6 ? darkGrain : lightGrain).getHexString()}`;
    ctx.globalAlpha = 0.10 + Math.random() * 0.12;
    ctx.lineWidth = 0.6 + Math.random() * 1.2;
    ctx.beginPath();
    let yx = x;
    ctx.moveTo(yx, 0);
    for (let y = 0; y <= S; y += 16) {
      yx += (Math.random() - 0.5) * sway * 0.5;
      ctx.lineTo(yx, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // a few subtle knots
  for (let i = 0; i < 3; i++) {
    const kx = Math.random() * S, ky = Math.random() * S;
    const r = 6 + Math.random() * 10;
    const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, r);
    g.addColorStop(0, `#${darkGrain.getHexString()}`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(kx, ky, r * 0.7, r, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // faint warm satin sheen
  const sheen = ctx.createLinearGradient(0, 0, 0, S);
  sheen.addColorStop(0.0, 'rgba(255,235,200,0)');
  sheen.addColorStop(0.5, 'rgba(255,235,200,0.05)');
  sheen.addColorStop(1.0, 'rgba(255,235,200,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// Tasteful BACKLIT sign canvas: a clean, crisp glyph rendering with only a
// soft warm edge-glow (low intensity) — no fat glowing tube halo. Tints the
// requested color toward warm white/gold so signage reads classy.
function drawSignCanvas(text, colorHex, fontScale) {
  text = String(text == null ? '' : text);
  const pad = 40;
  const fontPx = Math.round(96 * (fontScale || 1));
  // measure
  const meas = newCanvas(8, 8);
  const mctx = meas.getContext('2d');
  let textW = text.length * fontPx * 0.6;
  if (mctx) {
    mctx.font = `600 ${fontPx}px "Times New Roman", Georgia, serif`;
    textW = Math.max(8, mctx.measureText(text).width);
  }
  const W = Math.ceil(textW + pad * 2);
  const H = Math.ceil(fontPx + pad * 2);
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return { canvas: c, w: W, h: H };

  // Warm, gilded lettering color — pull the requested hue strongly toward a
  // warm gold/white so it never reads as a saturated neon tube.
  const warm = warmify(colorHex, 0.7).lerp(new THREE.Color(0xffffff), 0.15);
  const warmCss = `#${warm.getHexString()}`;
  const edge = warmify(colorHex, 0.55).lerp(new THREE.Color(0x000000), 0.1);
  const edgeCss = `#${edge.getHexString()}`;

  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontPx}px "Times New Roman", Georgia, serif`;
  ctx.lineJoin = 'round';

  // single soft warm edge-glow (low intensity backlight, not a tube halo)
  ctx.shadowColor = warmCss;
  ctx.shadowBlur = Math.max(6, fontPx * 0.14);
  ctx.fillStyle = edgeCss;
  ctx.globalAlpha = 0.55;
  ctx.fillText(text, W / 2, H / 2);
  ctx.globalAlpha = 1;

  // crisp metallic letter body with a subtle vertical gradient (brushed gold)
  ctx.shadowBlur = 0;
  const grad = ctx.createLinearGradient(0, H / 2 - fontPx / 2, 0, H / 2 + fontPx / 2);
  grad.addColorStop(0.0, `#${warm.clone().lerp(new THREE.Color(0xffffff), 0.35).getHexString()}`);
  grad.addColorStop(0.5, warmCss);
  grad.addColorStop(1.0, `#${warm.clone().lerp(new THREE.Color(0x000000), 0.2).getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillText(text, W / 2, H / 2);

  // thin clean outline to keep the glyphs legible
  ctx.lineWidth = Math.max(1, fontPx * 0.02);
  ctx.strokeStyle = `#${warm.clone().lerp(new THREE.Color(0x000000), 0.35).getHexString()}`;
  ctx.globalAlpha = 0.6;
  ctx.strokeText(text, W / 2, H / 2);
  ctx.globalAlpha = 1;

  return { canvas: c, w: W, h: H };
}

// Realistic dusk/night city skyline backdrop. Warm window lights dominate;
// just a couple of cool windows for variety — far less cartoon-neon.
function drawSkylineCanvas() {
  const W = 2048, H = 512;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  // gradient dusk sky — deep blue fading to a warm amber horizon glow
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#080b18');
  sky.addColorStop(0.5, '#16203b');
  sky.addColorStop(0.78, '#3d3147');
  sky.addColorStop(0.9, '#7a5436');  // warm dusk band
  sky.addColorStop(1.0, '#241a14');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // stars
  ctx.fillStyle = '#fff6e6';
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.45;
    ctx.globalAlpha = 0.15 + Math.random() * 0.55;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.globalAlpha = 1;

  // distant skyline layer (darker)
  drawBuildingRow(ctx, W, H, H * 0.62, '#0c0f1e', 0.55, 60, 140, false);
  // mid skyline
  drawBuildingRow(ctx, W, H, H * 0.5, '#13182f', 0.85, 50, 220, true);
  // foreground skyline (taller towers w/ lit windows)
  drawBuildingRow(ctx, W, H, H * 0.32, '#0e1122', 1.0, 70, 320, true);

  // a couple of soft warm landmark beams
  for (let i = 0; i < 3; i++) {
    const bx = (0.2 + i * 0.3) * W + (Math.random() - 0.5) * 120;
    const grad = ctx.createLinearGradient(bx, H, bx, 0);
    grad.addColorStop(0, 'rgba(255,205,130,0.0)');
    grad.addColorStop(1, 'rgba(255,205,130,0.08)');
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
      // lit windows grid — overwhelmingly warm interior light
      const cols = Math.max(1, Math.floor(bw / 8));
      const rows = Math.max(1, Math.floor(bh / 10));
      for (let r = 0; r < rows; r++) {
        for (let cI = 0; cI < cols; cI++) {
          if (Math.random() < 0.38) {
            const warm = Math.random();
            ctx.fillStyle = warm < 0.88
              ? 'rgba(255,212,140,0.9)'
              : 'rgba(200,220,255,0.7)'; // a few cool-white windows for variety
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
// neonMaterial(color, intensity) — softly, warmly emissive accent material
// (kept the name + signature; no longer a glaring neon tube)
// ----------------------------------------------------------------
const _neonMatCache = new Map();
export function neonMaterial(color, intensity = 1.4) {
  const hex = toHex(color);
  // Cap the intensity low and warm the hue so this reads as a gentle gilded
  // accent (cove glow, sign trim) rather than a hot neon tube.
  const capped = THREE.MathUtils.clamp((+intensity) || 0, 0, 1.5) * 0.4;
  const key = `${colorKey(hex)}_${capped.toFixed(3)}`;
  let m = _neonMatCache.get(key);
  if (m) return m;
  const warm = warmify(hex, 0.55);
  const body = warm.clone().lerp(new THREE.Color(0xffffff), 0.18);
  m = new THREE.MeshStandardMaterial({
    color: body.getHex(),
    emissive: warm.getHex(),
    emissiveIntensity: capped,
    roughness: 0.35,
    metalness: 0.2,
    // tone-mapped so it sits in the scene's warm exposure, no neon pop-through
    toneMapped: true,
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
      // Warm, rich patterned carpet. The config carpet colors lean dark/cool
      // on some floors; nudge toward classic burgundy/emerald so they read as
      // upscale resort carpet rather than club blue.
      const richCarpet = mixColor(carpetHex, 0x5a0d18, 0.35).getHex();
      const tex = cachedTexture('carpet_' + colorKey(carpetHex),
        () => drawCarpetCanvas(richCarpet),
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
        bumpScale: 0.035,
        color: 0xffffff,
        roughness: 0.97,
        metalness: 0.0,
      });
      break;
    }
    case 'marble': {
      // Cream/ivory veined marble — higher quality, subtle clearcoat polish.
      const marbleHex = toHex(COLORS.marble);
      const tex = cachedTexture('marble_' + colorKey(marbleHex),
        () => drawMarbleCanvas(marbleHex),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(5, 5);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = MAX_ANISO;
        });
      const rough = cachedTexture('marble_rough',
        () => drawMarbleRoughCanvas(),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(5, 5);
          t.anisotropy = MAX_ANISO;
        });
      m = new THREE.MeshStandardMaterial({
        map: tex,
        roughnessMap: rough,
        color: 0xfbf6ea,
        roughness: 0.3,
        metalness: 0.0,
        envMapIntensity: 0.7,
      });
      break;
    }
    case 'wall': {
      // Warm plaster wall — soft ivory/taupe, subtly tinted by the floor accent.
      const wallCol = mixColor(0xe7dcc8, carpetHex, 0.12).lerp(new THREE.Color(WARM_HEX), 0.06);
      m = new THREE.MeshStandardMaterial({ color: wallCol.getHex(), roughness: 0.92, metalness: 0.0 });
      break;
    }
    case 'ceiling': {
      // Warm off-white coffered ceiling tone.
      m = new THREE.MeshStandardMaterial({ color: 0xe3d7c2, roughness: 0.94, metalness: 0.0 });
      break;
    }
    case 'water': {
      // Calm pool water — clear, gently reflective, lightly warm-lit.
      m = new THREE.MeshStandardMaterial({
        color: toHex(COLORS.water),
        roughness: 0.14,
        metalness: 0.2,
        transparent: true,
        opacity: 0.82,
        envMapIntensity: 0.8,
      });
      break;
    }
    case 'glass': {
      // Clear architectural glass (cheap standard transparent — no transmission).
      m = new THREE.MeshStandardMaterial({
        color: 0xeef4f6,
        roughness: 0.05,
        metalness: 0.0,
        transparent: true,
        opacity: 0.28,
        envMapIntensity: 1.0,
        side: THREE.DoubleSide,
      });
      break;
    }
    case 'brass': {
      // Brushed brass / gold — warm, satin metal.
      m = new THREE.MeshStandardMaterial({
        color: toHex(COLORS.brass),
        roughness: 0.34,
        metalness: 1.0,
        envMapIntensity: 1.1,
        emissive: warmify(COLORS.brass, 0.5).lerp(new THREE.Color(0x000000), 0.7).getHex(),
        emissiveIntensity: 0.05,
      });
      break;
    }
    case 'wood': {
      // Dark walnut / cherry hardwood with real grain.
      const woodHex = 0x4a2417;
      const tex = cachedTexture('wood_' + colorKey(woodHex),
        () => drawWoodCanvas(woodHex),
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(3, 3);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = MAX_ANISO;
        });
      m = new THREE.MeshStandardMaterial({
        map: tex,
        bumpMap: tex,
        bumpScale: 0.02,
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.05,
      });
      break;
    }
    default: {
      m = new THREE.MeshStandardMaterial({ color: 0xb8a88f, roughness: 0.8, metalness: 0.0 });
      break;
    }
  }
  _matCache.set(key, m);
  return m;
}

// ----------------------------------------------------------------
// addInteriorLighting(scene, floorDef) -> { update(dt), dispose() }
// Warm (≈3200–4000K) ambient + hemisphere + soft warm downlights + key light.
// Thin warm fog, NO saturated colored neon point lights. Bright & readable.
// ----------------------------------------------------------------
export function addInteriorLighting(scene, floorDef) {
  const added = [];
  const flickerLights = [];
  let prevFog = null;
  let prevFogStored = false;

  if (!scene || !scene.add) {
    // Defensive no-op handle
    return { update() {}, dispose() {} };
  }

  const theme = themeOf(floorDef);

  // --- base ambient/hemispheric (warm ~3500K) ---
  const hemi = new THREE.HemisphereLight(0xfff0d4, 0x6a5848, 0.95);
  scene.add(hemi); added.push(hemi);

  const ambient = new THREE.AmbientLight(0xffe8cc, 0.62);
  scene.add(ambient); added.push(ambient);

  // --- gentle key light from above (soft warm "house" light) ---
  const key = new THREE.DirectionalLight(0xfff2e0, 0.85);
  key.position.set(24, 64, 16);
  scene.add(key); added.push(key);
  if (key.target) { scene.add(key.target); added.push(key.target); }

  // --- soft warm fill from the opposite side for depth & shape ---
  const fill = new THREE.DirectionalLight(0xffe6c8, 0.3);
  fill.position.set(-30, 34, -40);
  scene.add(fill); added.push(fill);
  if (fill.target) { scene.add(fill.target); added.push(fill.target); }

  // --- several soft warm downlight point lights (recessed-ceiling feel) ---
  // All warm white/amber — never saturated color. Spread across the footprint
  // (X[-60,60], Z[-42,42]) and kept bright so the floor reads clearly.
  // Kept to 3 warm downlights for performance (per-light cost is high with
  // many PBR surfaces); ambient + hemi + key/fill carry the base brightness.
  const downColors = [0xffe7c2, 0xffeccb, 0xffe2b8];
  const spots = [
    { x: -36, z: -22 },
    { x: 36, z: 24 },
    { x: 0, z: 0 },
  ];
  const baseI = 1.7;
  for (let i = 0; i < spots.length; i++) {
    const pl = new THREE.PointLight(downColors[i % downColors.length], baseI, 70, 2.0);
    pl.position.set(spots[i].x, 6.4, spots[i].z);
    scene.add(pl); added.push(pl);
    flickerLights.push({ light: pl, base: baseI, phase: i * 1.3, speed: 0.35 + i * 0.04 });
  }

  // --- thin warm fog tuned to theme (low density, keeps the floor bright) ---
  const fs = fogSettingsFor(theme);
  // store previous so dispose can restore (multiple floors may share one scene)
  prevFog = scene.fog || null;
  prevFogStored = true;
  scene.fog = new THREE.FogExp2(fs.color, fs.density);

  let t = 0;
  function update(dt) {
    if (!(dt > 0)) dt = 0.016;
    t += dt;
    for (const n of flickerLights) {
      // very gentle warm flicker, stays bright and steady for navigation
      const pulse = 0.97 + 0.03 * Math.sin(t * n.speed + n.phase);
      n.light.intensity = n.base * pulse;
    }
  }

  function dispose() {
    for (const obj of added) {
      if (obj.parent) obj.parent.remove(obj);
      if (obj.dispose) { try { obj.dispose(); } catch (e) {} }
    }
    added.length = 0;
    flickerLights.length = 0;
    if (prevFogStored && scene.fog && scene.fog.isFogExp2) {
      // restore whatever was there before (or clear)
      scene.fog = prevFog;
    }
  }

  return { update, dispose };
}

// ----------------------------------------------------------------
// makeNeonSign(text, color, opts) -> THREE.Object3D
// Tasteful BACKLIT sign: a brushed metal/wood panel with warm-white/gold
// edge-lit lettering and LOW emissive — no glowing tube halo.
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

  // Lettering plane: edge-lit text at LOW emissive intensity (backlit panel,
  // not a glowing tube). Tone-mapped so it sits in the warm exposure.
  const signMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.6,
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const signGeo = new THREE.PlaneGeometry(signW, signH);
  const signMesh = new THREE.Mesh(signGeo, signMat);
  signMesh.position.z = 0.06;
  group.add(signMesh);

  // brushed metal / wood backing panel slightly larger — the lit fixture body
  if (wantBacking) {
    const padX = 0.5 * size, padY = 0.4 * size;
    const backGeo = new THREE.PlaneGeometry(signW + padX, signH + padY);
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x2a1d12,            // dark walnut panel
      roughness: 0.55,
      metalness: 0.4,
      side: THREE.DoubleSide,
    });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.z = 0;
    group.add(back);

    // slim brushed-brass trim frame (low warm emissive, not a neon tube)
    const trimMat = neonMaterial(COLORS.brass, 0.5);
    const tThick = 0.05 * size;
    const halfW = (signW + padX) / 2, halfH = (signH + padY) / 2;
    const barH = new THREE.PlaneGeometry(signW + padX, tThick);
    const barV = new THREE.PlaneGeometry(tThick, signH + padY);
    const top = new THREE.Mesh(barH, trimMat); top.position.set(0, halfH, 0.01);
    const bot = new THREE.Mesh(barH, trimMat); bot.position.set(0, -halfH, 0.01);
    const lft = new THREE.Mesh(barV, trimMat); lft.position.set(-halfW, 0, 0.01);
    const rgt = new THREE.Mesh(barV, trimMat); rgt.position.set(halfW, 0, 0.01);
    group.add(top, bot, lft, rgt);
  }

  // faint warm backlight glow in front (gentle, warm — not a colored neon pop)
  if (wantLight) {
    const glow = new THREE.PointLight(warmify(hex, 0.7).getHex(), 0.35, 6 * size, 2.0);
    glow.position.set(0, 0, 0.9 * size);
    group.add(glow);
  }

  group.userData.isNeonSign = true;
  return group;
}

// ----------------------------------------------------------------
// makeChandelier() -> THREE.Object3D
// Opulent warm gold + crystal, soft warm light. Shared geometry; instanced
// beads to keep poly count reasonable.
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
    // real brushed-gold metal frame (not an emissive tube)
    goldMat: new THREE.MeshPhysicalMaterial({
      color: toHex(COLORS.gold),
      roughness: 0.3,
      metalness: 1.0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1.3,
      emissive: warmify(COLORS.gold, 0.5).lerp(new THREE.Color(0x000000), 0.75).getHex(),
      emissiveIntensity: 0.06,
    }),
    crystalMat: new THREE.MeshPhysicalMaterial({
      color: 0xfffaf0,
      emissive: 0xffe6b8,           // warm candle-like glow
      emissiveIntensity: 0.5,        // soft, not glaring
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.6,
      ior: 1.5,
      thickness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.92,
      envMapIntensity: 1.4,
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

  // soft warm point light (candle-warm, opulent but gentle)
  const light = new THREE.PointLight(0xffd9a0, 1.1, 30, 2.0);
  light.position.y = -0.1;
  group.add(light);

  group.userData.isChandelier = true;
  return group;
}

// ----------------------------------------------------------------
// makeWindowSkyline() -> THREE.Object3D
// Wide backdrop quad of a realistic dusk/night skyline (warm window lights).
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
  // Emissive so it glows on its own behind the windows regardless of interior
  // light, but at a restrained intensity for a realistic dusk read.
  _skylineMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: _skylineTex,
    emissiveIntensity: 0.85,
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
// Build a small PMREM environment from a procedural warm-interior "room" so
// that marble / brass / glass pick up real reflections. Fully guarded:
// returns null and is a no-op on any failure. The generated env map is cached
// and reused across calls (and across scenes) so this is cheap to call.
// ----------------------------------------------------------------
let _envTexture = null;
let _envTried = false;

// Procedural equirect-ish gradient canvas used as the PMREM source. A warm
// resort interior: soft ivory ceiling glow up top fading to a warm floor, with
// a couple of gentle warm light pools to give metals/marble something to
// reflect. No saturated cyan/magenta highlights.
function drawEnvCanvas() {
  const W = 512, H = 256;
  const c = newCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#efe4cf'); // bright warm ceiling
  sky.addColorStop(0.45, '#d8c4a4');
  sky.addColorStop(0.6, '#c2a374');  // gilded horizon band
  sky.addColorStop(0.78, '#7a6044');
  sky.addColorStop(1.0, '#3a2c20'); // warm floor
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // soft warm light pools near the horizon for specular highlights
  const pools = [
    { x: W * 0.22, y: H * 0.5, r: 80, col: 'rgba(255,236,200,0.5)' },
    { x: W * 0.6, y: H * 0.48, r: 95, col: 'rgba(255,224,170,0.4)' },
    { x: W * 0.85, y: H * 0.52, r: 70, col: 'rgba(255,242,215,0.4)' },
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
