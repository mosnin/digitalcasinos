// =============================================================
// Digital Casinos — 2D HUD / UI layer (DOM, not WebGL).
// Owns the heads-up display, prompts, toasts, modal host, the
// world map render, the floor-select menu and the build palette.
// Reuses the DOM ids/classes defined in index.html + css/style.css.
// Subscribes to Economy so coins + VIP badge stay live.
// Defensive everywhere: never throws, guards null elements.
// =============================================================

import {
  FLOOR, FLOORS, ELEVATOR,
  tileCenter, isBuildableTile, parcelKey, COLORS,
} from './config.js';
import { Economy } from './economy.js';

// ---- tiny helpers ------------------------------------------------
const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const safe = (fn) => { try { return fn(); } catch (e) { /* never throw out of UI */ return undefined; } };
const fmt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
};
const hex = (c) => {
  // accept number (0xrrggbb) or css string
  if (typeof c === 'number') return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  return c || '#ffffff';
};

// World extents used by the map projection (matches config coord system).
const WORLD = { x0: -60, x1: 60, z0: -42, z1: 42 };

const UI = {
  // cached refs
  _refs: {
    hud: null, coins: null, coinValue: null, locationInfo: null,
    prompt: null, toast: null, modalHost: null,
    mapScreen: null, mapCanvas: null, palette: null, paletteItems: null,
  },
  _vipBadge: null,

  // overlay state
  _mapOpen: false,
  _floorMenuOpen: false,
  _paletteOpen: false,
  _paletteOnClose: null,

  // toast queue
  _toastQueue: [],
  _toastBusy: false,
  _toastTimer: null,

  _unsub: null,
  _inited: false,

  // ---------------------------------------------------------------
  init() {
    return safe(() => {
      if (typeof document === 'undefined') return;
      const r = this._refs;
      r.hud = $('hud');
      r.coins = $('coins');
      r.coinValue = $('coinValue');
      r.locationInfo = $('locationInfo');
      r.prompt = $('prompt');
      r.toast = $('toast');
      r.modalHost = $('modalHost');
      r.mapScreen = $('mapScreen');
      r.mapCanvas = $('mapCanvas');
      r.palette = $('palette');
      r.paletteItems = r.palette ? r.palette.querySelector('.palette-items') : null;

      // wire the map close button(s) once
      if (r.mapScreen) {
        r.mapScreen.querySelectorAll('.close-map').forEach((btn) => {
          btn.addEventListener('click', () => this.toggleMap(this._mapCtx));
        });
      }

      // keep coins + VIP badge live off the Economy store
      if (!this._unsub && Economy && typeof Economy.subscribe === 'function') {
        this._unsub = Economy.subscribe((s) => {
          safe(() => this.setCoins(s ? s.coins : 0));
        });
      }
      this._inited = true;
    });
  },

  _ensure() { if (!this._inited) this.init(); },

  // ---------------------------------------------------------------
  // Coins + VIP badge
  setCoins(n) {
    safe(() => {
      this._ensure();
      const el = this._refs.coinValue || $('coinValue');
      if (el) el.textContent = fmt(n);
      this._renderVip();
    });
  },

  _renderVip() {
    safe(() => {
      const owned = !!(Economy && typeof Economy.inventoryCount === 'function'
        && Economy.inventoryCount('vippass') > 0);
      const host = this._refs.coins || $('coins');
      if (!host) return;
      if (owned) {
        if (!this._vipBadge || !this._vipBadge.isConnected) {
          const b = document.createElement('span');
          b.className = 'vip-badge';
          b.textContent = 'VIP';
          // inline style so we don't depend on css/style.css being edited
          b.style.cssText =
            'margin-left:10px;padding:1px 8px;border-radius:8px;font-size:12px;' +
            'font-weight:800;letter-spacing:1px;color:#1a0f00;vertical-align:middle;' +
            'background:linear-gradient(135deg,#ffd23f,#ff9d00);' +
            'box-shadow:0 0 12px rgba(255,210,63,0.7);';
          this._vipBadge = b;
          host.appendChild(b);
        }
      } else if (this._vipBadge && this._vipBadge.parentNode) {
        this._vipBadge.parentNode.removeChild(this._vipBadge);
        this._vipBadge = null;
      }
    });
  },

  // ---------------------------------------------------------------
  // Location readout (floor name + parcel/coords)
  setLocation(html) {
    safe(() => {
      this._ensure();
      const el = this._refs.locationInfo || $('locationInfo');
      if (el) el.innerHTML = (html == null) ? '' : String(html);
    });
  },

  // ---------------------------------------------------------------
  // Contextual prompt
  showPrompt(text) {
    safe(() => {
      this._ensure();
      const el = this._refs.prompt || $('prompt');
      if (!el) return;
      el.innerHTML = (text == null) ? '' : String(text);
      el.classList.add('show');
    });
  },

  hidePrompt() {
    safe(() => {
      const el = this._refs.prompt || $('prompt');
      if (el) el.classList.remove('show');
    });
  },

  // ---------------------------------------------------------------
  // Toast — queue-safe flash messages
  toast(msg, kind) {
    safe(() => {
      this._ensure();
      if (msg == null) return;
      this._toastQueue.push({ msg: String(msg), kind });
      this._pumpToast();
    });
  },

  _pumpToast() {
    if (this._toastBusy) return;
    const el = this._refs.toast || $('toast');
    const next = this._toastQueue.shift();
    if (!el || !next) return;
    this._toastBusy = true;

    // normalize kind -> css class (good|bad). Map common synonyms.
    let cls = '';
    const k = next.kind;
    if (k === 'good' || k === 'win' || k === 'success') cls = 'good';
    else if (k === 'bad' || k === 'warn' || k === 'error' || k === 'lose') cls = 'bad';

    el.classList.remove('good', 'bad', 'show');
    el.textContent = next.msg;
    if (cls) el.classList.add(cls);
    // force reflow so re-triggered transitions actually animate
    void el.offsetWidth;
    el.classList.add('show');

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      safe(() => el.classList.remove('show'));
      // wait for the opacity fade (~.3s in css) before showing the next one
      this._toastTimer = setTimeout(() => {
        this._toastBusy = false;
        safe(() => { el.classList.remove('good', 'bad'); });
        this._pumpToast();
      }, 320);
    }, 2200);
  },

  // ---------------------------------------------------------------
  // Modal host (casino games, editors, generic nodes)
  openModal(node) {
    return safe(() => {
      this._ensure();
      const host = this._refs.modalHost || $('modalHost');
      if (!host) return;
      host.innerHTML = '';
      if (node) {
        if (typeof node === 'string') host.innerHTML = node;
        else host.appendChild(node);
      }
      host.classList.remove('hidden');
    });
  },

  closeModal() {
    safe(() => {
      const host = this._refs.modalHost || $('modalHost');
      if (!host) return;
      host.innerHTML = '';
      host.classList.add('hidden');
    });
  },

  // ANY overlay open? (modal host, map, floor menu, palette)
  isModalOpen() {
    return safe(() => {
      const host = this._refs.modalHost || $('modalHost');
      const modalUp = !!(host && !host.classList.contains('hidden') && host.childNodes.length > 0);
      return !!(modalUp || this._mapOpen || this._floorMenuOpen || this._paletteOpen);
    }) || false;
  },

  closeAll() {
    safe(() => {
      this.closeModal();
      this.closeFloorMenu();
      this.closeBuildPalette();
      if (this._mapOpen) {
        const ms = this._refs.mapScreen || $('mapScreen');
        if (ms) ms.classList.add('hidden');
        this._mapOpen = false;
      }
      this.hidePrompt();
    });
  },

  // ---------------------------------------------------------------
  // World map — top-down of the CURRENT floor onto a 512x512 canvas
  drawMap(canvas, opts) {
    safe(() => {
      const cv = canvas || this._refs.mapCanvas || $('mapCanvas');
      if (!cv || typeof cv.getContext !== 'function') return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;

      const W = cv.width || 512;
      const H = cv.height || 512;
      const o = opts || {};
      const economy = o.economy || Economy;
      const fi = Math.max(0, Math.min(FLOORS.length - 1, (o.floorIndex | 0) || 0));
      const floorDef = FLOORS[fi] || FLOORS[0];

      // padding so the footprint isn't flush to the canvas edge
      const pad = 24;
      const innerW = W - pad * 2;
      const innerH = H - pad * 2;
      const spanX = WORLD.x1 - WORLD.x0; // 120
      const spanZ = WORLD.z1 - WORLD.z0; // 84
      const sx = innerW / spanX;
      const sz = innerH / spanZ;

      // world (x,z) -> canvas (px,py). +x right, +z down.
      const toPx = (x) => pad + (x - WORLD.x0) * sx;
      const toPy = (z) => pad + (z - WORLD.z0) * sz;
      // rect [x0,z0,x1,z1] -> canvas rect (handles unordered corners)
      const rectPx = (r) => {
        const ax = toPx(Math.min(r[0], r[2])), bx = toPx(Math.max(r[0], r[2]));
        const az = toPy(Math.min(r[1], r[3])), bz = toPy(Math.max(r[1], r[3]));
        return { x: ax, y: az, w: bx - ax, h: bz - az };
      };

      // ---- background ----
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#06060e';
      ctx.fillRect(0, 0, W, H);

      // ---- floor footprint ----
      const foot = rectPx([WORLD.x0, WORLD.z0, WORLD.x1, WORLD.z1]);
      ctx.fillStyle = hex(floorDef.carpet != null ? floorDef.carpet : COLORS.carpet);
      ctx.globalAlpha = 0.28;
      ctx.fillRect(foot.x, foot.y, foot.w, foot.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(foot.x, foot.y, foot.w, foot.h);

      // ---- buildable tiles (dark), owned (green), placed-game (pink) ----
      const tw = FLOOR.TILE * sx;
      const th = FLOOR.TILE * sz;
      for (let ti = 0; ti < FLOOR.TX; ti++) {
        for (let tj = 0; tj < FLOOR.TZ; tj++) {
          if (!isBuildableTile(fi, ti, tj)) continue;
          const c = tileCenter(ti, tj);
          const px = toPx(c.x) - tw / 2;
          const py = toPy(c.z) - th / 2;
          const key = parcelKey(fi, ti, tj);
          const owned = !!(economy && economy.ownsParcel && economy.ownsParcel(key));
          const games = (owned && economy && economy.getGames) ? (economy.getGames(key) || []) : [];

          if (games.length) ctx.fillStyle = hex(COLORS.neon);        // placed game -> pink
          else if (owned) ctx.fillStyle = '#2ec27e';                 // owned -> green
          else ctx.fillStyle = '#2a3340';                            // buildable -> dark
          ctx.globalAlpha = games.length ? 0.92 : (owned ? 0.85 : 0.7);
          ctx.fillRect(px + 0.5, py + 0.5, tw - 1, th - 1);
          ctx.globalAlpha = 1;
          // subtle grid line
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tw - 1, th - 1);
        }
      }

      // ---- feature rects from FLOORS[floorIndex] ----
      const featColor = (type) => {
        switch (type) {
          case 'pool': return { fill: hex(COLORS.water), a: 0.7 };
          case 'bar':
          case 'giftshop':
          case 'restaurant':
          case 'theater':
          case 'shop': return { fill: hex(COLORS.brass), a: 0.7 };           // amber
          case 'elevator': return { fill: hex(COLORS.gold), a: 0.85 };       // gold
          case 'fountain': return { fill: hex(COLORS.neon2), a: 0.6 };
          case 'window': return { fill: 'rgba(180,220,255,0.5)', a: 0.6 };
          default: return null; // 'hall' and unknowns: skip (already part of footprint)
        }
      };
      const feats = Array.isArray(floorDef.features) ? floorDef.features : [];
      for (const ft of feats) {
        if (!ft || !ft.rect) continue;
        const col = featColor(ft.type);
        if (!col) continue;
        const rp = rectPx(ft.rect);
        ctx.globalAlpha = col.a;
        ctx.fillStyle = col.fill;
        ctx.fillRect(rp.x, rp.y, rp.w, rp.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rp.x, rp.y, rp.w, rp.h);
        // label, when present and the rect is roomy enough
        if (ft.label && rp.w > 40) {
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.font = '10px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(ft.label), rp.x + rp.w / 2, rp.y + rp.h / 2, rp.w - 4);
        }
      }

      // ---- elevator core marker (shared on every floor) ----
      safe(() => {
        const e = ELEVATOR;
        const er = rectPx([e.x - e.w / 2, e.z - e.d / 2, e.x + e.w / 2, e.z + e.d / 2]);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = hex(COLORS.gold);
        ctx.fillRect(er.x, er.y, er.w, er.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1a0f00';
        ctx.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LIFT', er.x + er.w / 2, er.y + er.h / 2, er.w - 2);
      });

      // ---- player dot ----
      const pp = o.playerPos;
      if (pp && typeof pp.x === 'number' && (typeof pp.z === 'number')) {
        const px = toPx(Math.max(WORLD.x0, Math.min(WORLD.x1, pp.x)));
        const py = toPy(Math.max(WORLD.z0, Math.min(WORLD.z1, pp.z)));
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = hex(COLORS.gold);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1a0f00';
        ctx.stroke();
        // little glow ring
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,210,63,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // ---- title + legend text ----
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(floorDef.name || ('Floor ' + fi), pad, 18);

      const legend = [
        { c: '#2a3340', t: 'Buildable' },
        { c: '#2ec27e', t: 'Owned' },
        { c: hex(COLORS.neon), t: 'Game' },
        { c: hex(COLORS.water), t: 'Pool' },
        { c: hex(COLORS.brass), t: 'Bar/Shop' },
        { c: hex(COLORS.gold), t: 'You / Lift' },
      ];
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      let lx = pad;
      const ly = H - 8;
      for (const item of legend) {
        ctx.fillStyle = item.c;
        ctx.fillRect(lx, ly - 9, 10, 10);
        ctx.fillStyle = 'rgba(220,220,235,0.95)';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(item.t, lx + 14, ly);
        lx += 16 + ctx.measureText(item.t).width + 14;
      }
    });
  },

  // ---------------------------------------------------------------
  // Map screen toggle. ctx = { economy, playerPos, floorIndex } (or
  // a function returning that) — re-rendered each time it opens.
  toggleMap(ctx) {
    return safe(() => {
      this._ensure();
      const ms = this._refs.mapScreen || $('mapScreen');
      if (!ms) return this._mapOpen;
      this._mapCtx = ctx || this._mapCtx;
      if (this._mapOpen) {
        ms.classList.add('hidden');
        this._mapOpen = false;
      } else {
        const resolved = (typeof this._mapCtx === 'function') ? safe(() => this._mapCtx()) : this._mapCtx;
        this.drawMap(this._refs.mapCanvas || $('mapCanvas'), resolved || {});
        ms.classList.remove('hidden');
        this._mapOpen = true;
      }
      return this._mapOpen;
    });
  },

  // ---------------------------------------------------------------
  // Floor-select menu — modal list of floors; pick calls onPick(index)
  openFloorMenu(floors, current, onPick) {
    safe(() => {
      this._ensure();
      const list = Array.isArray(floors) ? floors : FLOORS;
      const cur = (current | 0);

      const modal = document.createElement('div');
      modal.className = 'game-modal floor-menu';

      const close = document.createElement('button');
      close.className = 'game-close btn-small btn-ghost';
      close.textContent = '✕';
      close.addEventListener('click', () => this.closeFloorMenu());
      modal.appendChild(close);

      const h = document.createElement('h2');
      h.textContent = 'Take the Elevator';
      modal.appendChild(h);
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'Choose a floor';
      modal.appendChild(sub);

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:6px;';

      list.forEach((f, i) => {
        const name = (f && f.name) ? f.name : ('Floor ' + i);
        const row = document.createElement('button');
        row.className = 'btn-small' + (i === cur ? '' : ' btn-ghost');
        row.style.cssText = 'width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:12px;';
        const lbl = document.createElement('span');
        lbl.innerHTML = '<b style="color:var(--gold)">' + (i + 1) + '.</b> ' + name;
        row.appendChild(lbl);
        if (i === cur) {
          const tag = document.createElement('span');
          tag.textContent = 'HERE';
          tag.style.cssText = 'font-size:11px;color:#1a0f00;background:var(--gold);padding:1px 8px;border-radius:8px;font-weight:800;';
          row.appendChild(tag);
        }
        row.addEventListener('click', () => {
          this.closeFloorMenu();
          safe(() => onPick && onPick(i));
        });
        wrap.appendChild(row);
      });
      modal.appendChild(wrap);

      this.openModal(modal);
      this._floorMenuOpen = true;
    });
  },

  closeFloorMenu() {
    safe(() => {
      if (this._floorMenuOpen) {
        this._floorMenuOpen = false;
        this.closeModal();
      }
    });
  },

  // ---------------------------------------------------------------
  // Build palette — grouped GAME/DECOR items in the bottom #palette.
  // groups = [{ label, items:[{id,name,icon,cost,kind}] }]
  openBuildPalette(groups, onPick, onClose, current) {
    safe(() => {
      this._ensure();
      const palette = this._refs.palette || $('palette');
      if (!palette) return;
      const itemsHost = this._refs.paletteItems || palette.querySelector('.palette-items');
      if (!itemsHost) return;

      this._paletteOnClose = (typeof onClose === 'function') ? onClose : null;
      itemsHost.innerHTML = '';
      // arrange groups as labeled sections; keep .palette-items as a wrapping flex row
      itemsHost.style.flexWrap = 'wrap';
      itemsHost.style.alignItems = 'flex-start';

      const list = Array.isArray(groups) ? groups : [];
      const makeCard = (item) => {
        const card = document.createElement('div');
        card.className = 'palette-item';
        if (item && current != null && item.id === current) card.classList.add('active');
        card.dataset.id = item ? String(item.id) : '';

        const icon = document.createElement('div');
        icon.className = 'pi-icon';
        icon.textContent = (item && item.icon) ? item.icon : '🎲';
        const name = document.createElement('div');
        name.className = 'pi-name';
        name.textContent = (item && item.name) ? item.name : (item ? item.id : '');
        const cost = document.createElement('div');
        cost.className = 'pi-cost';
        cost.textContent = (item && item.cost != null) ? (fmt(item.cost) + ' 🪙') : '';
        card.appendChild(icon);
        card.appendChild(name);
        card.appendChild(cost);

        card.addEventListener('click', () => {
          // mark active across the whole palette
          itemsHost.querySelectorAll('.palette-item.active').forEach((n) => n.classList.remove('active'));
          card.classList.add('active');
          safe(() => onPick && onPick(item));
        });
        return card;
      };

      list.forEach((g) => {
        if (!g) return;
        const section = document.createElement('div');
        section.className = 'palette-group';
        section.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';
        if (g.label) {
          const head = document.createElement('div');
          head.className = 'palette-group-label';
          head.textContent = g.label;
          head.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:1px;color:var(--neon2);text-transform:uppercase;';
          section.appendChild(head);
        }
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';
        const items = Array.isArray(g.items) ? g.items : [];
        items.forEach((it) => row.appendChild(makeCard(it)));
        section.appendChild(row);
        itemsHost.appendChild(section);
      });

      // ensure the existing hint is visible (it's static markup in index.html)
      const hint = palette.querySelector('.palette-hint');
      if (hint) hint.classList.remove('hidden');

      palette.classList.remove('hidden');
      this._paletteOpen = true;
    });
  },

  closeBuildPalette() {
    safe(() => {
      const palette = this._refs.palette || $('palette');
      if (palette) palette.classList.add('hidden');
      const wasOpen = this._paletteOpen;
      this._paletteOpen = false;
      const cb = this._paletteOnClose;
      this._paletteOnClose = null;
      if (wasOpen && typeof cb === 'function') safe(() => cb());
    });
  },
};

// expose on window for debugging / cross-module access
if (typeof window !== 'undefined') window.UI = UI;

export { UI };
