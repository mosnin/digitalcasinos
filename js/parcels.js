// =============================================================
// Digital Casinos — parcels.js
// Per-floor parcel ownership, buying, and game/decor placement.
//
// attachParcels(stage, economy, hooks) -> api
//   stage : a floor Stage { scene, floorIndex, baseY:0, colliders, triggers, ... }
//   hooks : { onPlay(type,key,index,config), onEdit(type,key,index,config),
//             toast(msg,kind) }
//
// Adds (all parented to stage.scene):
//   1) faint inlaid brass/stone border lines on BUILDABLE tiles only
//      (aisle tiles are walkways and get NOTHING),
//   2) a subtle floor tint + brass stanchions w/ velvet rope + engraved
//      placard on owned tiles, and a softly-lerping highlight quad under
//      the player (matte, no glow),
//   3) tasteful standing "FOR SALE — price 🪙" placards near the player,
//   4) the placed games / decor for owned tiles on THIS floor.
//
// Realistic & subtle: no neon glow bands, low/zero emissive, warm brass.
// Never throws on missing data. Reuses geometry/material where it can.
// =============================================================

import * as THREE from 'three';
import {
  FLOOR,
  tileCenter, tileFromWorld, parcelKey, isBuildableTile, isAisleTile,
  GAME_CATALOG, DECOR_CATALOG,
} from './config.js';
import * as games from './games.js';
import * as decor from './decor.js';

// ---- small shared constants ------------------------------------
const INLAY_Y   = 0.02;   // inlaid border lines just above the floor (y=0)
const TINT_Y    = 0.015;  // owned tint quad
const HILITE_Y  = 0.028;  // moving highlight quad (above tint)
const HALF       = FLOOR.TILE / 2;
const PICK_RANGE = 2.2;    // metres for nearestGame / nearestDecor
const GAME_COLLIDER_H = 2.0;

// Warm, realistic palette (matte — read as inlay/tint, not glow).
const COL_BRASS    = 0xc9a227; // inlaid border / stanchions
const COL_OWNED    = 0x2f6f4f; // muted emerald floor tint for owned plots
const COL_VALID    = 0x3f9d63; // ghost: valid placement (matte green)
const COL_INVALID  = 0xb23a3a; // ghost: invalid / occupied (matte red)
const COL_VELVET   = 0x6e1422; // velvet rope (deep burgundy)
const COL_HI_OWNED  = 0x3f9d63; // highlight when standing on owned tile
const COL_HI_BUY    = 0xc9a227; // highlight when on a buyable tile
const COL_HI_BLOCK  = 0x8a3b3b; // highlight when not buildable

const INLAY_W    = 0.06;  // width of an inlaid border line (thin, subtle)
const POST_H     = 0.95;  // height of owned-plot brass stanchions
const ROPE_SAG   = 0.12;  // how far the velvet rope droops at mid-span
const LABEL_CAP  = 2;     // max FOR-SALE placards rendered near player

// shared unit-quad geometry (XZ plane, 1×1, centred on origin)
const QUAD_GEO = new THREE.PlaneGeometry(1, 1);
QUAD_GEO.rotateX(-Math.PI / 2); // lie flat on the floor

// shared geometry for stanchion parts (scaled per-instance)
const POST_GEO = new THREE.CylinderGeometry(0.045, 0.05, 1, 10);
const BALL_GEO = new THREE.SphereGeometry(0.075, 12, 8);
const ROPE_GEO = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
const BASE_GEO = new THREE.CylinderGeometry(0.13, 0.16, 0.05, 12);

// ---------------------------------------------------------------
// Helpers (defensive — never throw)
// ---------------------------------------------------------------
function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

// Smoothly approach a target (frame-rate independent-ish lerp).
function damp(cur, target, lambda, dt) {
  const t = 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt || 0));
  return cur + (target - cur) * t;
}

// ---------------------------------------------------------------
// Shared, cached materials (reused across every instance).
// ---------------------------------------------------------------
const _matCache = {};
function brassMat() {
  return _matCache.brass || (_matCache.brass = new THREE.MeshStandardMaterial({
    color: COL_BRASS, metalness: 0.85, roughness: 0.35,
    emissive: new THREE.Color(COL_BRASS), emissiveIntensity: 0.04,
  }));
}
function velvetMat() {
  return _matCache.velvet || (_matCache.velvet = new THREE.MeshStandardMaterial({
    color: COL_VELVET, metalness: 0.0, roughness: 0.85,
  }));
}
// Inlaid border: thin matte brass line, very low emissive so it reads
// as polished metal in the floor rather than a glowing band.
function inlayMat() {
  return _matCache.inlay || (_matCache.inlay = new THREE.MeshStandardMaterial({
    color: COL_BRASS, metalness: 0.7, roughness: 0.4,
    emissive: new THREE.Color(COL_BRASS), emissiveIntensity: 0.06,
    side: THREE.DoubleSide,
  }));
}

// ---------------------------------------------------------------
// Canvas-based sprite labels (cached by text). Sprites always face
// the camera and are cheap. Warm, low-key panels (no glow bloom).
// Returns null on any failure.
// ---------------------------------------------------------------
const _labelTexCache = new Map(); // text -> THREE.CanvasTexture
function labelTexture(text, opts) {
  opts = opts || {};
  const cacheKey = `${text}|${opts.bg || ''}|${opts.fg || ''}|${opts.accent || ''}`;
  if (_labelTexCache.has(cacheKey)) return _labelTexCache.get(cacheKey);
  const tex = safe(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const W = 512, H = 160;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, W, H);
    // brushed dark panel with a brass frame — engraved-placard look
    const bg = opts.bg || 'rgba(24,18,10,0.92)';
    const fg = opts.fg || '#f3e3c0';
    const accent = opts.accent || '#c9a227';
    const r = 22;
    // panel fill
    ctx.fillStyle = bg;
    roundRect(ctx, 10, 14, W - 20, H - 28, r);
    ctx.fill();
    // brass frame
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    roundRect(ctx, 10, 14, W - 20, H - 28, r);
    ctx.stroke();
    // thin inner hairline for an engraved bezel
    ctx.strokeStyle = 'rgba(255,240,200,0.35)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 22, 26, W - 44, H - 52, r - 8);
    ctx.stroke();
    // text (no heavy glow — a faint warm shadow only)
    ctx.fillStyle = fg;
    ctx.font = 'bold 52px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fillText(String(text), W / 2, H / 2 + 2);
    const t = new THREE.CanvasTexture(canvas);
    t.anisotropy = 4;
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, null);
  _labelTexCache.set(cacheKey, tex || null);
  return tex || null;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeLabelSprite(text, opts) {
  const tex = labelTexture(text, opts);
  if (!tex) return null;
  return safe(() => {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.set(2.4, 0.75, 1);
    return s;
  }, null);
}

// A small standing engraved placard on a brass easel/post. Returns an
// Object3D (the post + a canvas sign panel) or null when headless.
function makePlacard(text, opts) {
  const sprite = makeLabelSprite(text, opts);
  if (!sprite) return null;
  return safe(() => {
    const g = new THREE.Group();
    // little brass stand: a base disc + a thin pole
    const base = new THREE.Mesh(BASE_GEO, brassMat());
    base.position.y = 0.025;
    g.add(base);
    const pole = new THREE.Mesh(POST_GEO, brassMat());
    const poleH = (opts && opts.poleH) || 0.95;
    pole.scale.y = poleH;
    pole.position.y = poleH / 2;
    g.add(pole);
    // the sign panel rides on top of the pole, facing camera
    sprite.position.set(0, poleH + 0.42, 0);
    sprite.renderOrder = 5;
    g.add(sprite);
    g.userData.sign = sprite;
    return g;
  }, null);
}

// Catalog look-ups that tolerate unknown ids.
function gameDef(type) { return (type && GAME_CATALOG[type]) || null; }
function decorDef(id)  { return (id && DECOR_CATALOG[id]) || null; }

// Make a material transparent + non-collidable for ghost previews.
// Matte tint (color, not emissive glow) so the ghost reads green/red
// without bloom. Returns the cloned materials so the caller can re-tint.
function makeGhost(node) {
  const mats = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = src.map((m) => {
      if (!m) return m;
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.45;
      c.depthWrite = false;
      // kill any source glow so the ghost stays matte
      if ('emissive' in c && c.emissive) {
        c.emissive = c.emissive.clone();
        if ('emissiveIntensity' in c) c.emissiveIntensity = 0;
      }
      if (c.color) c.color = c.color.clone();
      mats.push(c);
      return c;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  return mats;
}

// Tint a list of ghost materials toward a validity colour (matte — no glow).
function tintGhost(mats, hex) {
  for (const m of mats) {
    if (!m) continue;
    if (m.color) safe(() => m.color.setHex(hex));
    if ('emissive' in m && m.emissive) {
      safe(() => m.emissive.setHex(hex));
      if ('emissiveIntensity' in m) m.emissiveIntensity = 0.0;
    }
  }
}

// ---------------------------------------------------------------
// attachParcels
// ---------------------------------------------------------------
export function attachParcels(stage, economy, hooks) {
  hooks = hooks || {};
  const scene = stage.scene;
  const floor = stage.floorIndex | 0;
  const toast = (msg, kind) => safe(() => hooks.toast && hooks.toast(msg, kind));

  // Group that holds everything we add, so disposal/teardown is one node.
  const root = new THREE.Group();
  root.name = 'parcels';
  if (scene && scene.add) scene.add(root);

  // ----- registry: prop Object3D -> { key, index, kind, type } -----
  // kind: 'game' | 'decor'
  const registry = new Map();           // node -> meta
  const colliderMap = new Map();        // node -> Box3 (so we can remove)

  // currentTile under the player (set by update); { ti, tj } | null
  let currentTile = null;

  // helper — a buildable, non-aisle tile (aisles are walkways: skip them)
  function isParcelTile(ti, tj) {
    if (safe(() => isAisleTile(ti, tj), false)) return false;
    return safe(() => isBuildableTile(floor, ti, tj), false);
  }

  // -----------------------------------------------------------------
  // 1) Faint inlaid brass/stone border lines on BUILDABLE tiles only.
  // Built from four thin quads per tile merged into one BufferGeometry
  // (single draw call). Matte standard material — reads as an inlaid
  // metal trim line in the floor, NOT a glowing band. Aisle tiles get
  // nothing (they are hallways now).
  // -----------------------------------------------------------------
  buildInlay();
  function buildInlay() {
    const positions = [];
    const TX = FLOOR.TX, TZ = FLOOR.TZ;
    const w = INLAY_W;
    // push a flat band rectangle as two triangles (y=INLAY_Y)
    const band = (ax, az, bx, bz) => {
      positions.push(ax, INLAY_Y, az,  bx, INLAY_Y, az,  bx, INLAY_Y, bz);
      positions.push(ax, INLAY_Y, az,  bx, INLAY_Y, bz,  ax, INLAY_Y, bz);
    };
    for (let ti = 0; ti < TX; ti++) {
      for (let tj = 0; tj < TZ; tj++) {
        if (!isParcelTile(ti, tj)) continue;
        const c = tileCenter(ti, tj);
        // inset slightly so the line sits inside the tile like a border
        const m = 0.12;
        const x0 = c.x - HALF + m, x1 = c.x + HALF - m;
        const z0 = c.z - HALF + m, z1 = c.z + HALF - m;
        band(x0, z0, x1, z0 + w);          // top edge
        band(x0, z1 - w, x1, z1);          // bottom edge
        band(x0, z0, x0 + w, z1);          // left edge
        band(x1 - w, z0, x1, z1);          // right edge
      }
    }
    if (!positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, inlayMat());
    mesh.name = 'parcelInlay';
    mesh.renderOrder = 1;
    mesh.receiveShadow = false;
    root.add(mesh);
  }

  // -----------------------------------------------------------------
  // 2a) Owned plots: subtle floor tint + brass stanchions with velvet
  // rope at the corners + a small engraved placard with the game name.
  // -----------------------------------------------------------------
  const tintMat = new THREE.MeshBasicMaterial({
    color: COL_OWNED, transparent: true, opacity: 0.14,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const tintGroup = new THREE.Group();
  tintGroup.name = 'ownedPlots';
  root.add(tintGroup);
  const tintQuads = new Map();   // key -> Mesh (tint quad, presence = decorated)
  const plotPlacards = new Map(); // key -> placard Object3D (for name updates)

  // One brass stanchion (base + post + cap ball) at a position.
  function makeStanchion(x, z) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(BASE_GEO, brassMat());
    base.position.y = 0.025;
    g.add(base);
    const post = new THREE.Mesh(POST_GEO, brassMat());
    post.scale.y = POST_H;
    post.position.y = POST_H / 2;
    g.add(post);
    const ball = new THREE.Mesh(BALL_GEO, brassMat());
    ball.position.y = POST_H + 0.02;
    g.add(ball);
    g.position.set(x, 0, z);
    return g;
  }

  // A drooping velvet rope between two stanchion tops (slightly curved).
  function makeRope(ax, az, bx, bz) {
    const ay = POST_H, by = POST_H;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return null;
    const g = new THREE.Group();
    // approximate the catenary with a couple of straight segments
    const segs = 3;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = ax + dx * t, z = az + dz * t;
      const sag = Math.sin(t * Math.PI) * ROPE_SAG;
      pts.push(new THREE.Vector3(x, ay - sag, z));
    }
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = new THREE.Mesh(ROPE_GEO, velvetMat());
      const segLen = a.distanceTo(b);
      seg.scale.y = segLen;
      seg.position.copy(a).lerp(b, 0.5);
      // orient cylinder (default +Y) along the segment
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      seg.quaternion.setFromUnitVectors(up, dir);
      g.add(seg);
    }
    return g;
  }

  function ensurePlot(key, ti, tj) {
    if (tintQuads.has(key)) return;
    const c = tileCenter(ti, tj);
    // subtle floor tint
    const q = new THREE.Mesh(QUAD_GEO, tintMat);
    q.scale.set(FLOOR.TILE * 0.9, 1, FLOOR.TILE * 0.9);
    q.position.set(c.x, TINT_Y, c.z);
    q.renderOrder = 2;
    tintGroup.add(q);
    tintQuads.set(key, q);

    // brass stanchions at the four corners (inset a little)
    const inset = HALF - 0.4;
    const corners = [
      [c.x - inset, c.z - inset],
      [c.x + inset, c.z - inset],
      [c.x + inset, c.z + inset],
      [c.x - inset, c.z + inset],
    ];
    const stanch = [];
    for (const [sx, sz] of corners) {
      const st = safe(() => makeStanchion(sx, sz), null);
      if (st) { tintGroup.add(st); stanch.push([sx, sz]); }
    }
    // velvet ropes around the perimeter linking the corners
    for (let i = 0; i < stanch.length; i++) {
      const a = stanch[i], b = stanch[(i + 1) % stanch.length];
      const rope = safe(() => makeRope(a[0], a[1], b[0], b[1]), null);
      if (rope) tintGroup.add(rope);
    }

    // engraved placard with the game name (or RESERVED) — created/updated
    // lazily by refreshPlotPlacard once we know what's on the plot.
    refreshPlotPlacard(key, ti, tj);
  }

  // Set/replace the engraved name placard for an owned plot.
  function refreshPlotPlacard(key, ti, tj) {
    const name = safe(() => {
      const gs = economy.getGames(key) || [];
      for (const g of gs) {
        if (g && g.tile && g.tile[0] === ti && g.tile[1] === tj) {
          const def = gameDef(g.type);
          if (def && def.name) return def.name;
        }
      }
      // any game on this key
      for (const g of gs) {
        const def = g && gameDef(g.type);
        if (def && def.name) return def.name;
      }
      return null;
    }, null) || 'RESERVED';

    const existing = plotPlacards.get(key);
    if (existing && existing.userData.labelText === name) return;
    if (existing) { tintGroup.remove(existing); }
    const c = tileCenter(ti, tj);
    const placard = makePlacard(name, {
      fg: '#f3e3c0', bg: 'rgba(20,30,22,0.92)', accent: '#c9a227', poleH: 0.85,
    });
    if (placard) {
      placard.position.set(c.x, 0, c.z - (HALF - 0.5));
      placard.userData.labelText = name;
      tintGroup.add(placard);
      plotPlacards.set(key, placard);
    }
  }

  // -----------------------------------------------------------------
  // 2b) Moving highlight quad (follows tile under player). Matte tint,
  // smooth lerp follow, no glow.
  // -----------------------------------------------------------------
  const hiliteMat = new THREE.MeshBasicMaterial({
    color: COL_HI_BUY, transparent: true, opacity: 0.16,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const hilite = new THREE.Mesh(QUAD_GEO, hiliteMat);
  hilite.name = 'tileHighlight';
  hilite.scale.set(FLOOR.TILE * 0.96, 1, FLOOR.TILE * 0.96);
  hilite.position.set(0, HILITE_Y, 0);
  hilite.renderOrder = 3;
  hilite.visible = false;
  root.add(hilite);
  // smoothed target the highlight lerps toward
  const hiliteTarget = new THREE.Vector3(0, HILITE_Y, 0);

  // -----------------------------------------------------------------
  // 2c) "FOR SALE — price 🪙" standing placards. To stay cheap we keep a
  // small pool (LABEL_CAP placards) and reposition them over the nearest
  // unowned buildable tiles each update, instead of one per tile.
  // -----------------------------------------------------------------
  const saleGroup = new THREE.Group();
  saleGroup.name = 'forSalePlacards';
  root.add(saleGroup);
  const salePool = [];
  (function buildSalePool() {
    const price = safe(() => economy.parcelPrice(floor), 0);
    const proto = makePlacard(`FOR SALE — ${price} 🪙`, {
      fg: '#f3e3c0', bg: 'rgba(28,20,8,0.92)', accent: '#c9a227', poleH: 0.95,
    });
    if (!proto) return; // no DOM (headless) — just skip placards
    proto.visible = false;
    saleGroup.add(proto);
    salePool.push(proto);
    for (let i = 1; i < LABEL_CAP; i++) {
      const clone = safe(() => proto.clone(), null);
      if (!clone) break;
      // share the cached sign material/texture across clones
      const ps = proto.userData.sign;
      const cs = clone.userData && clone.userData.sign;
      if (ps && cs && ps.material) cs.material = ps.material;
      clone.visible = false;
      saleGroup.add(clone);
      salePool.push(clone);
    }
  })();

  // Reposition the FOR-SALE pool over the closest unowned buildable
  // tiles within a small radius of the player.
  const _saleScan = []; // reused scratch array { d, x, z }
  function updateSaleLabels(px, pz) {
    if (!salePool.length) return;
    _saleScan.length = 0;
    const R2 = 16 * 16; // only consider tiles within ~16m
    const tc = safe(() => tileFromWorld(px, pz), null);
    const ci = tc ? tc.ti : 0, cj = tc ? tc.tj : 0;
    const span = 3; // search a small neighbourhood of tiles
    for (let di = -span; di <= span; di++) {
      for (let dj = -span; dj <= span; dj++) {
        const ti = ci + di, tj = cj + dj;
        if (ti < 0 || tj < 0 || ti >= FLOOR.TX || tj >= FLOOR.TZ) continue;
        if (!isParcelTile(ti, tj)) continue; // skips aisles + non-buildable
        const key = parcelKey(floor, ti, tj);
        if (safe(() => economy.ownsParcel(key), false)) continue;
        const c = tileCenter(ti, tj);
        const dx = c.x - px, dz = c.z - pz;
        const d = dx * dx + dz * dz;
        if (d > R2) continue;
        _saleScan.push({ d, x: c.x, z: c.z });
      }
    }
    _saleScan.sort((a, b) => a.d - b.d);
    for (let i = 0; i < salePool.length; i++) {
      const s = salePool[i];
      const t = _saleScan[i];
      if (t) {
        s.position.set(t.x, 0, t.z);
        s.visible = true;
      } else {
        s.visible = false;
      }
    }
  }

  // -----------------------------------------------------------------
  // Prop spawning
  // -----------------------------------------------------------------
  // Track which (key,kind,index) we have already spawned so refresh() is
  // idempotent and only fills gaps.
  const spawned = new Set(); // `${kind}:${key}:${index}`
  function spawnTag(kind, key, index) { return `${kind}:${key}:${index}`; }

  function applyRot(node, rot) {
    const r = Number(rot);
    if (Number.isFinite(r)) node.rotation.y = r;
  }

  // Position a prop at a tile centre (feet at y=0).
  function placeAtTile(node, tile) {
    let cx = 0, cz = 0;
    if (Array.isArray(tile) && tile.length >= 2) {
      const c = tileCenter(tile[0] | 0, tile[1] | 0);
      cx = c.x; cz = c.z;
    }
    node.position.set(cx, 0, cz);
  }

  function addGameCollider(node) {
    // Light collider: a ~1.6×1.6 box around the prop footprint.
    const box = safe(() => {
      const b = new THREE.Box3().setFromObject(node);
      if (b.isEmpty()) throw new Error('empty');
      // clamp the height so players can't be blocked vertically oddly
      b.min.y = 0;
      b.max.y = Math.max(b.max.y, GAME_COLLIDER_H);
      return b;
    }, null);
    const finalBox = box || new THREE.Box3(
      new THREE.Vector3(node.position.x - 1.4, 0, node.position.z - 1.4),
      new THREE.Vector3(node.position.x + 1.4, GAME_COLLIDER_H, node.position.z + 1.4),
    );
    if (Array.isArray(stage.colliders)) stage.colliders.push(finalBox);
    colliderMap.set(node, finalBox);
  }

  function removeCollider(node) {
    const box = colliderMap.get(node);
    if (box && Array.isArray(stage.colliders)) {
      const i = stage.colliders.indexOf(box);
      if (i >= 0) stage.colliders.splice(i, 1);
    }
    colliderMap.delete(node);
  }

  function spawnGame(key, index, g) {
    if (!g) return;
    const tag = spawnTag('game', key, index);
    if (spawned.has(tag)) return;
    const node = safe(() => games.createGameProp(g.type), null);
    if (!node) { spawned.add(tag); return; } // tolerate missing prop
    placeAtTile(node, g.tile);
    applyRot(node, g.rot);
    node.userData.parcel = { key, index, kind: 'game', type: g.type };
    root.add(node);
    // modest floating nameplate above the placed game (canvas sprite,
    // not a glowing label)
    const def = gameDef(g.type);
    const labelText = (def && def.name) || 'RESERVED';
    const plate = makeLabelSprite(labelText, {
      fg: '#f3e3c0', bg: 'rgba(20,30,22,0.9)', accent: '#c9a227',
    });
    if (plate) {
      plate.scale.set(2.0, 0.62, 1);
      plate.position.set(node.position.x, 2.6, node.position.z);
      plate.renderOrder = 5;
      root.add(plate);
      node.userData.nameplate = plate;
    }
    registry.set(node, { key, index, kind: 'game', type: g.type });
    addGameCollider(node);
    spawned.add(tag);
    // refresh the engraved plot placard now that we know the game name
    if (Array.isArray(g.tile)) safe(() => refreshPlotPlacard(key, g.tile[0] | 0, g.tile[1] | 0));
  }

  function spawnDecor(key, index, d) {
    if (!d) return;
    const tag = spawnTag('decor', key, index);
    if (spawned.has(tag)) return;
    const node = safe(() => decor.createDecorProp(d.id), null);
    if (!node) { spawned.add(tag); return; }
    placeAtTile(node, d.tile);
    applyRot(node, d.rot);
    node.userData.parcel = { key, index, kind: 'decor', type: d.id };
    root.add(node);
    registry.set(node, { key, index, kind: 'decor', type: d.id });
    spawned.add(tag);
  }

  // -----------------------------------------------------------------
  // api.refresh() — rebuild owned plots + spawn any missing props
  // -----------------------------------------------------------------
  function refresh() {
    const TX = FLOOR.TX, TZ = FLOOR.TZ;
    for (let ti = 0; ti < TX; ti++) {
      for (let tj = 0; tj < TZ; tj++) {
        const key = parcelKey(floor, ti, tj);
        if (!safe(() => economy.ownsParcel(key), false)) continue;
        ensurePlot(key, ti, tj);
        // games on this owned tile
        const gs = safe(() => economy.getGames(key), []) || [];
        for (let i = 0; i < gs.length; i++) {
          // fall back to the tile we're iterating if no tile saved
          const g = gs[i] || {};
          if (!Array.isArray(g.tile)) g.tile = [ti, tj];
          spawnGame(key, i, g);
        }
        // decor on this owned tile
        const ds = safe(() => economy.getDecor(key), []) || [];
        for (let i = 0; i < ds.length; i++) {
          const d = ds[i] || {};
          if (!Array.isArray(d.tile)) d.tile = [ti, tj];
          spawnDecor(key, i, d);
        }
        // make sure the engraved placard reflects current contents
        safe(() => refreshPlotPlacard(key, ti, tj));
      }
    }
  }

  // -----------------------------------------------------------------
  // Build mode + ghost preview
  // -----------------------------------------------------------------
  let pending = null;     // { kind:'game'|'decor', type }
  let ghost = null;       // Object3D
  let ghostMats = [];     // cloned materials we re-tint each frame
  let ghostValidNow = null; // last tint state (true/false) to avoid churn
  let ghostRot = 0;       // radians

  function clearGhost() {
    if (ghost) {
      root.remove(ghost);
      ghost = null;
    }
    ghostMats = [];
    ghostValidNow = null;
  }

  function buildGhost() {
    clearGhost();
    if (!pending) return;
    const node = pending.kind === 'game'
      ? safe(() => games.createGameProp(pending.type), null)
      : safe(() => decor.createDecorProp(pending.type), null);
    if (!node) return;
    ghostMats = makeGhost(node) || [];
    node.rotation.y = ghostRot;
    node.renderOrder = 4;
    ghost = node;
    root.add(ghost);
    positionGhost();
  }

  // Is the tile under the player a legal spot for the pending item?
  function ghostValidAt(tile) {
    if (!tile || !pending) return false;
    const key = parcelKey(floor, tile.ti, tile.tj);
    if (!safe(() => economy.ownsParcel(key), false)) return false;
    if (pending.kind === 'game' && gamesOnTile(key, tile.ti, tile.tj).length > 0) return false;
    return true;
  }

  function positionGhost() {
    if (!ghost) return;
    if (currentTile) {
      const c = tileCenter(currentTile.ti, currentTile.tj);
      ghost.position.set(c.x, 0, c.z);
      ghost.visible = true;
      const valid = ghostValidAt(currentTile);
      if (valid !== ghostValidNow) {
        ghostValidNow = valid;
        tintGhost(ghostMats, valid ? COL_VALID : COL_INVALID);
      }
    } else {
      ghost.visible = false;
    }
  }

  function enterBuildMode(opts) {
    opts = opts || {};
    if (!opts.kind || !opts.type) { pending = null; clearGhost(); return; }
    pending = { kind: opts.kind, type: opts.type };
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

  // -----------------------------------------------------------------
  // api.update(dt, playerPos) — move highlight to tile under player
  // -----------------------------------------------------------------
  function update(dt, playerPos) {
    const d = Number.isFinite(dt) ? dt : 0.016;

    if (!playerPos) return;
    const px = playerPos.x, pz = playerPos.z;
    const t = safe(() => tileFromWorld(px, pz), null);
    currentTile = t;

    if (!t) {
      hilite.visible = false;
    } else {
      const c = tileCenter(t.ti, t.tj);
      hiliteTarget.set(c.x, HILITE_Y, c.z);
      // smoothly lerp the highlight toward the target tile centre
      if (!hilite.visible) hilite.position.copy(hiliteTarget);
      else {
        hilite.position.x = damp(hilite.position.x, hiliteTarget.x, 14, d);
        hilite.position.z = damp(hilite.position.z, hiliteTarget.z, 14, d);
        hilite.position.y = HILITE_Y;
      }
      const key = parcelKey(floor, t.ti, t.tj);
      const owned = safe(() => economy.ownsParcel(key), false);
      const buildable = isParcelTile(t.ti, t.tj);
      // Don't paint the aisle/walkway tiles — only show the highlight on
      // parcel tiles or tiles the player already owns.
      if (!owned && !buildable) {
        hilite.visible = false;
      } else {
        hilite.visible = true;
        let col = COL_HI_BLOCK;
        if (owned) col = COL_HI_OWNED;
        else if (buildable) col = COL_HI_BUY;
        hiliteMat.color.setHex(col);
      }
    }
    safe(() => updateSaleLabels(px, pz));
    positionGhost();
  }

  // -----------------------------------------------------------------
  // Buying
  // -----------------------------------------------------------------
  function tileUnder(playerPos) {
    if (!playerPos) return currentTile;
    return safe(() => tileFromWorld(playerPos.x, playerPos.z), null) || null;
  }

  function tryBuyUnderPlayer(playerPos) {
    const t = tileUnder(playerPos);
    if (!t) { toast('No tile here.', 'warn'); return { ok: false }; }
    const key = parcelKey(floor, t.ti, t.tj);
    if (!safe(() => isBuildableTile(floor, t.ti, t.tj), false)) {
      toast('You can’t build here.', 'warn');
      return { ok: false };
    }
    if (safe(() => economy.ownsParcel(key), false)) {
      toast('You already own this parcel.', 'warn');
      return { ok: false };
    }
    const price = safe(() => economy.parcelPrice(floor), 0);
    const res = safe(() => economy.buyParcel(key, price), { ok: false, reason: 'error' });
    if (res && res.ok) {
      toast(`Parcel bought for ${price} 🪙`, 'good');
      refresh();
    } else {
      toast((res && res.reason) ? res.reason : 'Could not buy parcel.', 'warn');
    }
    return res || { ok: false };
  }

  // -----------------------------------------------------------------
  // Placing (games + decor)
  // -----------------------------------------------------------------
  function gamesOnTile(key, ti, tj) {
    const gs = safe(() => economy.getGames(key), []) || [];
    return gs.filter((g) => g && Array.isArray(g.tile) && g.tile[0] === ti && g.tile[1] === tj);
  }

  function placeUnderPlayer(playerPos) {
    if (!pending) { toast('Pick something to place first.', 'warn'); return { ok: false }; }
    const t = tileUnder(playerPos);
    if (!t) { toast('No tile here.', 'warn'); return { ok: false }; }
    const key = parcelKey(floor, t.ti, t.tj);
    if (!safe(() => economy.ownsParcel(key), false)) {
      toast('You must own this tile to build.', 'warn');
      return { ok: false };
    }

    if (pending.kind === 'game') {
      // one game per tile
      if (gamesOnTile(key, t.ti, t.tj).length > 0) {
        toast('A game is already on this tile.', 'warn');
        return { ok: false };
      }
      const def = gameDef(pending.type);
      if (!def) { toast('Unknown game.', 'warn'); return { ok: false }; }
      const cost = Number(def.cost) || 0;
      const config = Object.assign({}, def.mechanics);
      const res = safe(() => economy.addGame(key, pending.type, cost, {
        tile: [t.ti, t.tj], rot: ghostRot, config,
      }), { ok: false, reason: 'error' });
      if (res && res.ok) {
        const idx = (res.index != null) ? res.index : (gamesOnTile(key, t.ti, t.tj).length - 1);
        spawnGame(key, idx, { type: pending.type, tile: [t.ti, t.tj], rot: ghostRot, config });
        toast(`${def.name} placed (−${cost} 🪙)`, 'good');
        return res;
      }
      toast((res && res.reason) ? res.reason : 'Could not place game.', 'warn');
      return res || { ok: false };
    }

    // decor
    const def = decorDef(pending.type);
    if (!def) { toast('Unknown decoration.', 'warn'); return { ok: false }; }
    const cost = Number(def.cost) || 0;
    const res = safe(() => economy.addDecor(key, pending.type,
      { tile: [t.ti, t.tj], rot: ghostRot }, cost), { ok: false, reason: 'error' });
    if (res && res.ok) {
      const idx = (res.index != null)
        ? res.index
        : ((safe(() => economy.getDecor(key), []) || []).length - 1);
      spawnDecor(key, idx, { id: pending.type, tile: [t.ti, t.tj], rot: ghostRot });
      toast(`${def.name} placed (−${cost} 🪙)`, 'good');
      return res;
    }
    toast((res && res.reason) ? res.reason : 'Could not place decoration.', 'warn');
    return res || { ok: false };
  }

  // -----------------------------------------------------------------
  // Removal
  // -----------------------------------------------------------------
  // Find the registry node nearest to a world point, optionally on a tile.
  function nearestNode(point, kindFilter, tile) {
    let best = null, bestD = Infinity;
    for (const [node, meta] of registry) {
      if (kindFilter && meta.kind !== kindFilter) continue;
      if (tile) {
        const t = safe(() => tileFromWorld(node.position.x, node.position.z), null);
        if (!t || t.ti !== tile.ti || t.tj !== tile.tj) continue;
      }
      const dx = node.position.x - point.x;
      const dz = node.position.z - point.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { node, meta, dist: Math.sqrt(d) }; }
    }
    return best;
  }

  function despawnNode(node) {
    removeCollider(node);
    const plate = node.userData && node.userData.nameplate;
    if (plate) { root.remove(plate); safe(() => plate.material && plate.material.dispose()); }
    root.remove(node);
    const meta = registry.get(node);
    if (meta) spawned.delete(spawnTag(meta.kind, meta.key, meta.index));
    registry.delete(node);
  }

  // After an economy splice, indices shift. Easiest robust approach:
  // drop every spawned prop for that key+kind and let refresh() rebuild.
  function resyncKey(key, kind) {
    for (const [node, meta] of Array.from(registry)) {
      if (meta.key === key && meta.kind === kind) despawnNode(node);
    }
    refresh();
  }

  function removeUnderPlayer(playerPos) {
    const t = tileUnder(playerPos);
    if (!t) { toast('No tile here.', 'warn'); return false; }
    const key = parcelKey(floor, t.ti, t.tj);
    if (!safe(() => economy.ownsParcel(key), false)) {
      toast('You don’t own this tile.', 'warn');
      return false;
    }
    const px = (playerPos && playerPos.x) || 0;
    const pz = (playerPos && playerPos.z) || 0;
    const hit = nearestNode({ x: px, z: pz }, null, t);
    if (!hit) { toast('Nothing here to remove.', 'warn'); return false; }
    const { meta } = hit;
    let ok = false;
    if (meta.kind === 'game') ok = safe(() => economy.removeGame(meta.key, meta.index), false);
    else ok = safe(() => economy.removeDecor(meta.key, meta.index), false);
    if (ok) {
      resyncKey(meta.key, meta.kind);
      // the plot's engraved placard may now read differently
      safe(() => refreshPlotPlacard(meta.key, t.ti, t.tj));
      toast('Removed.', 'good');
      return true;
    }
    toast('Could not remove.', 'warn');
    return false;
  }

  // -----------------------------------------------------------------
  // Nearest queries (for interaction prompts)
  // -----------------------------------------------------------------
  function nearestOfKind(playerPos, kind) {
    if (!playerPos) return null;
    const hit = nearestNode({ x: playerPos.x, z: playerPos.z }, kind, null);
    if (!hit || hit.dist > PICK_RANGE) return null;
    const meta = hit.meta;
    let config = null;
    if (kind === 'game') {
      const gs = safe(() => economy.getGames(meta.key), []) || [];
      const g = gs[meta.index];
      config = (g && g.config) || (gameDef(meta.type) && Object.assign({}, gameDef(meta.type).mechanics)) || {};
    }
    return { type: meta.type, key: meta.key, index: meta.index, config };
  }

  function nearestGame(playerPos)  { return nearestOfKind(playerPos, 'game'); }
  function nearestDecor(playerPos) {
    const r = nearestOfKind(playerPos, 'decor');
    if (!r) return null;
    return { type: r.type, key: r.key, index: r.index, config: null };
  }

  // -----------------------------------------------------------------
  // Context prompt
  // -----------------------------------------------------------------
  function getPrompt(playerPos) {
    // Build mode takes priority.
    if (pending) {
      const t = tileUnder(playerPos);
      if (!t) return '';
      const key = parcelKey(floor, t.ti, t.tj);
      if (!safe(() => economy.ownsParcel(key), false)) return '';
      if (pending.kind === 'game' && gamesOnTile(key, t.ti, t.tj).length > 0) {
        return 'Tile occupied — [R] rotate';
      }
      return 'Place here: [F]  ·  rotate [R]  ·  exit [G]';
    }

    // Near a placed game → sit & play / edit.
    const ng = nearestGame(playerPos);
    if (ng) {
      const def = gameDef(ng.type);
      const name = (def && def.name) || 'Game';
      return `${name}: [E] Sit & Play  ·  [R] Edit`;
    }

    // Standing on a tile → buy / place.
    const t = tileUnder(playerPos);
    if (!t) return '';
    const key = parcelKey(floor, t.ti, t.tj);
    const owned = safe(() => economy.ownsParcel(key), false);
    if (owned) {
      const empty = gamesOnTile(key, t.ti, t.tj).length === 0;
      if (empty) return 'Your parcel — [B] build menu';
      return 'Your parcel';
    }
    if (safe(() => isBuildableTile(floor, t.ti, t.tj), false)) {
      const price = safe(() => economy.parcelPrice(floor), 0);
      return `[B] Buy parcel — ${price} 🪙`;
    }
    return '';
  }

  // -----------------------------------------------------------------
  // Interaction passthroughs (main wires these, but expose convenience)
  // -----------------------------------------------------------------
  function playNearest(playerPos) {
    const ng = nearestGame(playerPos);
    if (!ng) return false;
    safe(() => hooks.onPlay && hooks.onPlay(ng.type, ng.key, ng.index, ng.config));
    return true;
  }
  function editNearest(playerPos) {
    const ng = nearestGame(playerPos);
    if (!ng) return false;
    safe(() => hooks.onEdit && hooks.onEdit(ng.type, ng.key, ng.index, ng.config));
    return true;
  }

  // -----------------------------------------------------------------
  // Wrap stage.update so the highlight tracks the player without main
  // having to call api.update explicitly (api.update still works too).
  // -----------------------------------------------------------------
  const prevUpdate = (typeof stage.update === 'function')
    ? stage.update.bind(stage)
    : null;
  stage.update = function (dt, ctx) {
    if (prevUpdate) safe(() => prevUpdate(dt, ctx));
    const pos = ctx && ctx.playerPos;
    if (pos) safe(() => update(dt, pos));
  };

  // -----------------------------------------------------------------
  // Teardown
  // -----------------------------------------------------------------
  function dispose() {
    for (const [node] of Array.from(registry)) despawnNode(node);
    clearGhost();
    if (scene && scene.remove) scene.remove(root);
  }

  // Initial population.
  refresh();

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------
  const api = {
    refresh,
    update,
    tryBuyUnderPlayer,
    enterBuildMode,
    exitBuildMode,
    rotateGhost,
    placeUnderPlayer,
    removeUnderPlayer,
    nearestGame,
    nearestDecor,
    getPrompt,
    playNearest,
    editNearest,
    dispose,
    // introspection helpers (handy for main / debugging)
    get currentTile() { return currentTile; },
    get pending() { return pending; },
    isBuildMode() { return !!pending; },
  };
  return api;
}

export default attachParcels;
