// =============================================================
// Digital Casinos — always-on radar minimap (wave 2).
// Top-down view of the current floor: footprint, buildable tiles,
// owned parcels (green), placed games (pink), features, and the
// player as a gold rotated arrow. Reads Economy + config; never
// edits other modules. Never throws.
// =============================================================
import { FLOOR, FLOORS, tileCenter, parcelKey, isBuildableTile } from './config.js';
import { Economy } from './economy.js';

const SIZE = 170;          // css pixels (square)
const PAD = 6;             // inner padding (css px)

const M = {
  container: null,
  canvas: null,
  ctx: null,
  floorIndex: 0,
  visible: true,
  dpr: 1,
  _ready: false,
};

function safe(fn) {
  try { return fn(); } catch (e) { /* never throw */ return undefined; }
}

// ---- world <-> map projection ----
// World X in [-W/2, W/2] -> canvas x in [PAD, SIZE-PAD]
// World Z in [-D/2, D/2] -> canvas y in [PAD, SIZE-PAD]
function inner() { return SIZE - PAD * 2; }
function mapX(x) {
  const t = (x + FLOOR.W / 2) / FLOOR.W;
  return PAD + Math.max(0, Math.min(1, t)) * inner();
}
function mapY(z) {
  const t = (z + FLOOR.D / 2) / FLOOR.D;
  return PAD + Math.max(0, Math.min(1, t)) * inner();
}
function scaleX(units) { return (units / FLOOR.W) * inner(); }
function scaleY(units) { return (units / FLOOR.D) * inner(); }

export const Minimap = {
  init() {
    return safe(() => {
      if (M._ready && M.container && document.body.contains(M.container)) return;
      if (typeof document === 'undefined' || !document.body) return;

      const container = document.createElement('div');
      container.id = 'dc-minimap';
      const s = container.style;
      s.position = 'fixed';
      s.left = '14px';
      s.bottom = '14px';
      s.width = SIZE + 'px';
      s.height = SIZE + 'px';
      s.zIndex = '40';
      s.pointerEvents = 'none';
      s.background = 'rgba(8, 10, 18, 0.55)';
      s.border = '1px solid rgba(24,224,255,.5)';
      s.borderRadius = '10px';
      s.boxShadow = '0 0 16px rgba(24,224,255,.35), inset 0 0 12px rgba(24,224,255,.12)';
      s.overflow = 'hidden';
      s.display = M.visible ? 'block' : 'none';

      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(SIZE * dpr);
      canvas.height = Math.round(SIZE * dpr);
      canvas.style.width = SIZE + 'px';
      canvas.style.height = SIZE + 'px';
      canvas.style.display = 'block';

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);

      container.appendChild(canvas);
      document.body.appendChild(container);

      M.container = container;
      M.canvas = canvas;
      M.ctx = ctx;
      M.dpr = dpr;
      M._ready = true;
    });
  },

  setFloor(floorIndex) {
    safe(() => {
      const n = Number(floorIndex);
      if (Number.isFinite(n)) M.floorIndex = Math.max(0, Math.min(FLOORS.length - 1, Math.floor(n)));
    });
  },

  setVisible(b) {
    safe(() => {
      M.visible = !!b;
      if (M.container) M.container.style.display = M.visible ? 'block' : 'none';
    });
  },

  isVisible() {
    return !!M.visible;
  },

  update(playerPos, yaw) {
    safe(() => {
      if (!M._ready) Minimap.init();
      const ctx = M.ctx;
      if (!ctx) return;
      if (!M.visible) return;

      const fi = M.floorIndex;
      const floor = FLOORS[fi];

      // clear
      ctx.clearRect(0, 0, SIZE, SIZE);

      // floor footprint background
      ctx.fillStyle = 'rgba(20, 26, 40, 0.85)';
      ctx.fillRect(mapX(-FLOOR.W / 2), mapY(-FLOOR.D / 2), scaleX(FLOOR.W), scaleY(FLOOR.D));

      // buildable tiles (faint cells) + owned (green) + placed games (pink)
      const TX = FLOOR.TX | 0;
      const TZ = FLOOR.TZ | 0;
      const cw = scaleX(FLOOR.TILE);
      const ch = scaleY(FLOOR.TILE);
      for (let ti = 0; ti < TX; ti++) {
        for (let tj = 0; tj < TZ; tj++) {
          let buildable = false;
          safe(() => { buildable = isBuildableTile(fi, ti, tj); });
          if (!buildable) continue;

          const c = tileCenter(ti, tj);
          const x = mapX(c.x) - cw / 2;
          const y = mapY(c.z) - ch / 2;

          const key = parcelKey(fi, ti, tj);
          let owned = false, hasGame = false;
          if (Economy) {
            safe(() => { owned = !!(Economy.ownsParcel && Economy.ownsParcel(key)); });
            if (owned) safe(() => { hasGame = !!(Economy.getGames && Economy.getGames(key).length > 0); });
          }

          if (hasGame) {
            ctx.fillStyle = 'rgba(255, 45, 184, 0.85)';   // pink
          } else if (owned) {
            ctx.fillStyle = 'rgba(64, 230, 120, 0.8)';    // green
          } else {
            ctx.fillStyle = 'rgba(120, 150, 190, 0.18)';  // faint
          }
          ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cw - 1), Math.max(1, ch - 1));
        }
      }

      // feature rects
      if (floor && Array.isArray(floor.features)) {
        for (const ft of floor.features) {
          if (!ft || !ft.rect) continue;
          const r = ft.rect;
          const fx = mapX(r[0]);
          const fy = mapY(r[1]);
          const fw = scaleX(Math.abs(r[2] - r[0]));
          const fh = scaleY(Math.abs(r[3] - r[1]));

          let fill = null;
          switch (ft.type) {
            case 'pool':
              fill = 'rgba(24, 224, 255, 0.4)'; break;       // blue
            case 'bar':
            case 'giftshop':
            case 'restaurant':
            case 'theater':
              fill = 'rgba(255, 178, 44, 0.4)'; break;       // amber
            case 'fountain':
              fill = 'rgba(255, 210, 63, 0.6)'; break;       // gold
            case 'elevator':
              fill = 'rgba(255, 210, 63, 0.85)'; break;      // gold square
            default:
              fill = null;                                   // halls/windows: skip
          }
          if (!fill) continue;
          ctx.fillStyle = fill;
          ctx.fillRect(fx, fy, Math.max(2, fw), Math.max(2, fh));
          if (ft.type === 'elevator') {
            ctx.strokeStyle = 'rgba(255, 210, 63, 1)';
            ctx.lineWidth = 1;
            ctx.strokeRect(fx + 0.5, fy + 0.5, Math.max(2, fw) - 1, Math.max(2, fh) - 1);
          }
        }
      }

      // player arrow (gold), rotated by yaw
      let px = 0, pz = 0;
      if (playerPos) {
        if (Number.isFinite(playerPos.x)) px = playerPos.x;
        if (Number.isFinite(playerPos.z)) pz = playerPos.z;
      }
      const ax = mapX(px);
      const ay = mapY(pz);
      const ya = Number.isFinite(yaw) ? yaw : 0;

      ctx.save();
      ctx.translate(ax, ay);
      // World forward (yaw=0) faces -Z; on the map -Z is "up" (smaller y).
      // Rotate so the arrow tip points the heading. Canvas rotation is
      // clockwise; this matches yaw about the world Y axis.
      ctx.rotate(ya);
      ctx.beginPath();
      ctx.moveTo(0, -7);    // tip (forward / up)
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 210, 63, 0.98)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 16, 8, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // border accent ring
      ctx.strokeStyle = 'rgba(24,224,255,.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
    });
  },
};

if (typeof window !== 'undefined') window.Minimap = Minimap;

export default Minimap;
