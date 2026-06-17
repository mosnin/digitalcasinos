// =============================================================
// Digital Casinos — settings menu (wave 2).
// Persists user preferences to localStorage and notifies the app
// via an onChange callback whenever a value changes.
// Builds a .game-modal via UI.openModal, reusing existing CSS
// classes (.game-modal, .btn-row, .btn-small, .btn-ghost).
// Defensive everywhere: never throws, guards missing UI / storage.
// =============================================================

import { UI } from './ui.js';

const STORAGE_KEY = 'dc_settings';

const DEFAULTS = {
  volume: 0.7,
  bloom: true,
  minimap: true,
  fov: 72,
  sensitivity: 1,
  crowd: true,
};

const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

const clamp = (v, lo, hi) => {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
};

const Settings = {
  _values: Object.assign({}, DEFAULTS),
  _onChange: null,
  _inited: false,

  // ---------------------------------------------------------------
  _load() {
    return safe(() => {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        this._values = Object.assign({}, DEFAULTS, saved);
        // coerce known numeric ranges defensively
        this._values.volume = clamp(this._values.volume, 0, 1);
        this._values.fov = clamp(this._values.fov, 60, 100);
        this._values.sensitivity = clamp(this._values.sensitivity, 0.3, 2);
        this._values.bloom = !!this._values.bloom;
        this._values.minimap = !!this._values.minimap;
        this._values.crowd = !!this._values.crowd;
      }
    });
  },

  _persist() {
    safe(() => {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._values));
    });
  },

  _emit() {
    safe(() => {
      if (typeof this._onChange === 'function') this._onChange(this.all());
    });
  },

  _commit(key, value) {
    safe(() => {
      this._values[key] = value;
      this._persist();
      this._emit();
    });
  },

  // ---------------------------------------------------------------
  init(opts) {
    return safe(() => {
      const o = opts || {};
      this._onChange = (typeof o.onChange === 'function') ? o.onChange : null;
      this._load();
      this._inited = true;
      // apply once at startup
      this._emit();
    });
  },

  get(key) {
    return safe(() => this._values[key]);
  },

  all() {
    return Object.assign({}, this._values);
  },

  // ---------------------------------------------------------------
  open() {
    safe(() => {
      if (typeof document === 'undefined') return;
      if (!this._inited) { this._load(); }

      const modal = document.createElement('div');
      modal.className = 'game-modal';

      const close = document.createElement('button');
      close.className = 'game-close btn-small btn-ghost';
      close.textContent = '✕';
      close.addEventListener('click', () => safe(() => UI && UI.closeModal && UI.closeModal()));
      modal.appendChild(close);

      const h = document.createElement('h2');
      h.textContent = '⚙️ Settings';
      modal.appendChild(h);

      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'Tweak the casino to taste';
      modal.appendChild(sub);

      const body = document.createElement('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:16px;margin:6px 0 8px;text-align:left;';
      modal.appendChild(body);

      // ---- slider builder -----------------------------------------
      const makeSlider = (key, label, min, max, step, fmtVal) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:14px;color:#cfc9e6;';
        const name = document.createElement('span');
        name.textContent = label;
        const val = document.createElement('span');
        val.style.cssText = 'color:var(--gold);font-weight:700;';
        const fmt = (typeof fmtVal === 'function') ? fmtVal : ((v) => String(v));
        val.textContent = fmt(this._values[key]);
        head.appendChild(name);
        head.appendChild(val);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(this._values[key]);
        input.style.cssText = 'width:100%;accent-color:var(--neon);cursor:pointer;';
        input.addEventListener('input', () => safe(() => {
          const v = clamp(input.value, min, max);
          val.textContent = fmt(v);
          this._commit(key, v);
        }));

        wrap.appendChild(head);
        wrap.appendChild(input);
        return wrap;
      };

      // ---- toggle builder (button) --------------------------------
      const makeToggle = (key, label, desc) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;';

        const txt = document.createElement('div');
        txt.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
        const name = document.createElement('span');
        name.style.cssText = 'font-size:14px;color:#cfc9e6;';
        name.textContent = label;
        txt.appendChild(name);
        if (desc) {
          const d = document.createElement('span');
          d.style.cssText = 'font-size:11px;color:#8a85a8;';
          d.textContent = desc;
          txt.appendChild(d);
        }

        const btn = document.createElement('button');
        btn.className = 'btn-small';
        const paint = () => {
          const on = !!this._values[key];
          btn.textContent = on ? 'ON' : 'OFF';
          btn.classList.toggle('btn-ghost', !on);
        };
        paint();
        btn.addEventListener('click', () => safe(() => {
          this._commit(key, !this._values[key]);
          paint();
        }));

        wrap.appendChild(txt);
        wrap.appendChild(btn);
        return wrap;
      };

      body.appendChild(makeSlider('volume', 'Volume', 0, 1, 0.01,
        (v) => Math.round(Number(v) * 100) + '%'));
      body.appendChild(makeSlider('fov', 'Field of View', 60, 100, 1,
        (v) => Math.round(Number(v)) + '°'));
      body.appendChild(makeSlider('sensitivity', 'Mouse Sensitivity', 0.3, 2, 0.05,
        (v) => Number(v).toFixed(2) + '×'));

      body.appendChild(makeToggle('bloom', 'Bloom', 'Neon glow post-processing'));
      body.appendChild(makeToggle('minimap', 'Minimap', 'Radar overlay'));
      body.appendChild(makeToggle('crowd', 'Crowd', 'NPC patrons'));

      const row = document.createElement('div');
      row.className = 'btn-row';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-small btn-ghost';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => safe(() => UI && UI.closeModal && UI.closeModal()));
      row.appendChild(closeBtn);
      modal.appendChild(row);

      if (UI && typeof UI.openModal === 'function') UI.openModal(modal);
    });
  },
};

if (typeof window !== 'undefined') window.Settings = Settings;

export { Settings };
