// =============================================================
// Digital Casinos — Activity Feed / Notifications (DOM, not WebGL).
// A persistent-ish stack of "pill" rows that animate in near the
// top of the screen and fade out after a few seconds, while a
// capped history (50) is kept for the full feed modal.
// Distinct from UI.toast (transient one-line flashes).
// Defensive everywhere: never throws, guards missing document.
// =============================================================

import { UI } from './ui.js';

const safe = (fn) => { try { return fn(); } catch (e) { /* never throw */ return undefined; } };
const hasDoc = () => (typeof document !== 'undefined' && document && document.body);

// kind -> neon left-border color
const KIND_COLOR = {
  coin: '#ffd23f',   // gold
  info: '#36e0ff',   // cyan
  win: '#2ec27e',    // green
  social: '#ff5bb0', // pink
};
const KIND_ICON = {
  coin: '🪙',
  info: 'ℹ️',
  win: '🏆',
  social: '💬',
};

const HISTORY_CAP = 50;
const MAX_PILLS = 4;
const FADE_MS = 4500;

// relative time helper ("just now", "2m ago", "3h ago", "5d ago")
const relTime = (t) => {
  const now = Date.now();
  const d = Math.max(0, now - (Number(t) || now));
  const s = Math.floor(d / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24);
  return days + 'd ago';
};

const Notify = {
  _inited: false,
  _container: null,
  _history: [],   // [{time, msg, kind, icon}] newest pushed at end
  _pills: [],     // [{el, timer}] currently-on-screen

  // ---------------------------------------------------------------
  init() {
    return safe(() => {
      if (!hasDoc()) return;
      if (this._inited && this._container && this._container.isConnected) return;

      const c = document.createElement('div');
      c.id = 'activityFeed';
      // top-center, below any top HUD; below modals (~35); no pointer capture
      c.style.cssText = [
        'position:fixed',
        'top:64px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:35',
        'pointer-events:none',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'gap:8px',
        'width:min(420px,90vw)',
        'max-width:90vw',
        'font-family:"Segoe UI",system-ui,sans-serif',
      ].join(';');

      document.body.appendChild(c);
      this._container = c;
      this._inited = true;
    });
  },

  _ensure() { if (!this._inited || !this._container || !this._container.isConnected) this.init(); },

  // ---------------------------------------------------------------
  push(msg, kind, icon) {
    return safe(() => {
      const text = (msg == null) ? '' : String(msg);
      const k = (KIND_COLOR[kind]) ? kind : 'info';
      const ic = (icon != null && icon !== '') ? String(icon) : (KIND_ICON[k] || 'ℹ️');

      const ev = { time: Date.now(), msg: text, kind: k, icon: ic };
      this._history.push(ev);
      if (this._history.length > HISTORY_CAP) {
        this._history.splice(0, this._history.length - HISTORY_CAP);
      }

      this._renderPill(ev);
      return ev;
    });
  },

  _renderPill(ev) {
    safe(() => {
      if (!hasDoc()) return;
      this._ensure();
      const host = this._container;
      if (!host) return;

      const color = KIND_COLOR[ev.kind] || KIND_COLOR.info;

      const pill = document.createElement('div');
      pill.style.cssText = [
        'pointer-events:none',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'max-width:100%',
        'box-sizing:border-box',
        'padding:8px 14px',
        'border-radius:14px',
        'background:rgba(10,12,20,0.78)',
        'border-left:4px solid ' + color,
        'box-shadow:0 0 14px ' + color + '55, 0 4px 14px rgba(0,0,0,0.45)',
        'color:#eef1f7',
        'font-size:13px',
        'font-weight:600',
        'line-height:1.25',
        'backdrop-filter:blur(4px)',
        // animate-in state
        'opacity:0',
        'transform:translateY(-8px)',
        'transition:opacity .28s ease, transform .28s ease',
      ].join(';');

      const iconEl = document.createElement('span');
      iconEl.textContent = ev.icon;
      iconEl.style.cssText = 'flex:0 0 auto;font-size:16px;';

      const msgEl = document.createElement('span');
      msgEl.textContent = ev.msg;
      msgEl.style.cssText = 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      pill.appendChild(iconEl);
      pill.appendChild(msgEl);
      host.appendChild(pill);

      // animate in (force reflow so transition triggers)
      void pill.offsetWidth;
      pill.style.opacity = '1';
      pill.style.transform = 'translateY(0)';

      const rec = { el: pill, timer: null };
      this._pills.push(rec);

      // trim to MAX_PILLS — remove oldest immediately
      while (this._pills.length > MAX_PILLS) {
        const old = this._pills.shift();
        if (old) this._removePill(old);
      }

      // schedule fade-out
      rec.timer = setTimeout(() => {
        safe(() => {
          pill.style.opacity = '0';
          pill.style.transform = 'translateY(-8px)';
        });
        setTimeout(() => {
          // drop from active list + DOM (history is kept regardless)
          const idx = this._pills.indexOf(rec);
          if (idx >= 0) this._pills.splice(idx, 1);
          this._removePill(rec);
        }, 320);
      }, FADE_MS);
    });
  },

  _removePill(rec) {
    safe(() => {
      if (!rec) return;
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      const el = rec.el;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  },

  // ---------------------------------------------------------------
  openFeed() {
    return safe(() => {
      if (!hasDoc()) return;

      const modal = document.createElement('div');
      modal.className = 'game-modal';

      const close = document.createElement('button');
      close.className = 'game-close btn-small btn-ghost';
      close.textContent = '✕';
      close.addEventListener('click', () => safe(() => UI.closeModal()));
      modal.appendChild(close);

      const h = document.createElement('h2');
      h.textContent = '📰 Activity';
      modal.appendChild(h);

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:60vh;overflow:auto;';

      const items = this._history.slice().reverse(); // most recent first
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'sub';
        empty.textContent = 'No activity yet.';
        list.appendChild(empty);
      } else {
        items.forEach((ev) => {
          const color = KIND_COLOR[ev.kind] || KIND_COLOR.info;
          const row = document.createElement('div');
          row.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:10px',
            'padding:7px 12px',
            'border-radius:10px',
            'background:rgba(255,255,255,0.04)',
            'border-left:3px solid ' + color,
          ].join(';');

          const ic = document.createElement('span');
          ic.textContent = ev.icon || (KIND_ICON[ev.kind] || 'ℹ️');
          ic.style.cssText = 'flex:0 0 auto;font-size:16px;';

          const txt = document.createElement('span');
          txt.textContent = ev.msg;
          txt.style.cssText = 'flex:1 1 auto;font-size:13px;color:#eef1f7;overflow:hidden;text-overflow:ellipsis;';

          const when = document.createElement('span');
          when.textContent = relTime(ev.time);
          when.style.cssText = 'flex:0 0 auto;font-size:11px;color:rgba(220,220,235,0.6);';

          row.appendChild(ic);
          row.appendChild(txt);
          row.appendChild(when);
          list.appendChild(row);
        });
      }
      modal.appendChild(list);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-small';
      closeBtn.textContent = 'Close';
      closeBtn.style.cssText = 'margin-top:12px;';
      closeBtn.addEventListener('click', () => safe(() => UI.closeModal()));
      modal.appendChild(closeBtn);

      UI.openModal(modal);
      return modal;
    });
  },

  // ---------------------------------------------------------------
  recent() {
    return this._history;
  },
};

// expose on window for debugging / cross-module access
if (typeof window !== 'undefined') window.Notify = Notify;

export { Notify };
