// =============================================================
// Digital Casinos — Wave 3: Elevator (UX only).
// The elevator car meshes already live inside the venues; this
// module owns the *directory modal* (pick a destination) and the
// *ride transition* overlay (sliding doors + ticking floor
// indicator + ding). DOM/UX only — no WebGL required.
//
// Defensive everywhere: never throws. If the ride animation fails
// for any reason, onArrive() is still called exactly once so
// navigation can never get stuck.
//
//   createElevator({ destinations }) -> elevator
//     elevator.openDirectory(currentId, onPick)
//     elevator.playRide(fromName, toName, onArrive)
//   window.Elevator = elevator
// =============================================================

import { DESTINATIONS } from './config.js';
import { UI } from './ui.js';
import { SFX } from './audio.js';

const safe = (fn) => { try { return fn(); } catch (e) { /* never throw */ return undefined; } };

const hasDoc = () => (typeof document !== 'undefined' && !!document.body);

function el(tag, css, text) {
  const n = document.createElement(tag);
  if (css) n.style.cssText = css;
  if (text != null) n.textContent = String(text);
  return n;
}

// Fire a callback at most once.
function once(fn) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    safe(() => { if (typeof fn === 'function') fn(); });
  };
}

export function createElevator(opts) {
  const cfg = opts || {};
  // Default to imported DESTINATIONS when none passed.
  const baseList = Array.isArray(cfg.destinations) && cfg.destinations.length
    ? cfg.destinations
    : (Array.isArray(DESTINATIONS) ? DESTINATIONS : []);

  // -----------------------------------------------------------
  // Directory modal
  // -----------------------------------------------------------
  function openDirectory(currentId, onPick) {
    return safe(() => {
      if (!hasDoc() || !UI || typeof UI.openModal !== 'function') return;
      const list = baseList;

      const modal = el('div', 'max-height:70vh;overflow:auto;');
      modal.className = 'game-modal elevator-directory';

      // Close button (✕) reuses existing game-close styling.
      const close = el('button', null, '✕');
      close.className = 'game-close btn-small btn-ghost';
      close.addEventListener('click', () => safe(() => UI.closeModal()));
      modal.appendChild(close);

      const h = el('h2', null, '🛗 Elevator');
      modal.appendChild(h);
      const sub = el('div', null, 'Choose a destination');
      sub.className = 'sub';
      modal.appendChild(sub);

      const wrap = el('div', 'display:flex;flex-direction:column;gap:4px;margin-top:8px;');

      // Group destinations by `.group`, preserving first-seen order.
      const order = [];
      const groups = {};
      list.forEach((d) => {
        if (!d) return;
        const g = (d.group != null) ? String(d.group) : 'Other';
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(d);
      });

      order.forEach((gName) => {
        const header = el('div', null, gName);
        header.style.cssText =
          'font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;' +
          'color:var(--neon2,#18e0ff);margin:10px 2px 2px;opacity:0.9;';
        wrap.appendChild(header);

        groups[gName].forEach((d) => {
          const isHere = (currentId != null && d.id === currentId);
          const row = el('button', null);
          row.className = 'btn-small' + (isHere ? '' : ' btn-ghost');
          row.style.cssText =
            'width:100%;text-align:left;display:flex;align-items:center;gap:12px;' +
            (isHere ? 'opacity:0.75;cursor:default;' : '');

          const icon = el('span', 'font-size:18px;width:22px;text-align:center;flex:0 0 auto;',
            (d.icon != null) ? d.icon : '🛗');
          const name = el('span', 'flex:1 1 auto;', (d.name != null) ? d.name : String(d.id));
          row.appendChild(icon);
          row.appendChild(name);

          if (isHere) {
            const tag = el('span', null, '● HERE');
            tag.style.cssText =
              'font-size:11px;color:#1a0f00;background:var(--gold,#ffd23f);' +
              'padding:1px 8px;border-radius:8px;font-weight:800;flex:0 0 auto;';
            row.appendChild(tag);
            row.disabled = true;
          } else {
            row.addEventListener('click', () => {
              safe(() => { if (typeof onPick === 'function') onPick(d); });
              safe(() => UI.closeModal());
            });
          }
          wrap.appendChild(row);
        });
      });

      if (!order.length) {
        wrap.appendChild(el('div', 'opacity:0.7;padding:12px;', 'No destinations available.'));
      }

      modal.appendChild(wrap);

      const footer = el('div', 'margin-top:14px;display:flex;justify-content:flex-end;');
      const closeBtn = el('button', null, 'Close');
      closeBtn.className = 'btn-small btn-ghost';
      closeBtn.addEventListener('click', () => safe(() => UI.closeModal()));
      footer.appendChild(closeBtn);
      modal.appendChild(footer);

      UI.openModal(modal);
    });
  }

  // -----------------------------------------------------------
  // Ride transition overlay
  // -----------------------------------------------------------
  function playRide(fromName, toName, onArrive) {
    const arrive = once(onArrive);

    // No DOM (headless) — just arrive immediately so navigation works.
    if (!hasDoc()) { arrive(); return; }

    let overlay = null;
    const timers = [];
    const addTimer = (fn, ms) => { try { timers.push(setTimeout(fn, ms)); } catch (e) {} };
    const clearTimers = () => { timers.forEach((t) => { try { clearTimeout(t); } catch (e) {} }); };

    const cleanup = once(() => {
      clearTimers();
      safe(() => { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); });
    });

    // Fail-safe: even if every animation hook breaks, this guarantees
    // the overlay is torn down and onArrive fires exactly once.
    const SAFETY_MS = 2600;
    let safety = null;
    try { safety = setTimeout(() => { cleanup(); arrive(); }, SAFETY_MS); } catch (e) { /* ignore */ }

    const finish = once(() => {
      try { if (safety) clearTimeout(safety); } catch (e) {}
      cleanup();
      arrive();
    });

    try {
      const brushed =
        'repeating-linear-gradient(90deg,#2b2b30 0px,#34343a 2px,#26262b 4px,#3a3a40 6px)';

      overlay = el('div',
        'position:fixed;inset:0;z-index:2147483600;overflow:hidden;' +
        'background:radial-gradient(ellipse at 50% 40%,#3a3a42 0%,#18181d 100%);' +
        'font-family:"Segoe UI",system-ui,sans-serif;color:#e9e9f0;' +
        'display:flex;align-items:center;justify-content:center;' +
        'animation:dcElevBounce 1.1s ease-in-out;');

      // Scoped keyframes (id-guarded so we never inject twice).
      if (!document.getElementById('dc-elevator-style')) {
        const style = el('style');
        style.id = 'dc-elevator-style';
        style.textContent =
          '@keyframes dcElevBounce{0%{transform:translateY(0)}15%{transform:translateY(3px)}' +
          '45%{transform:translateY(-2px)}70%{transform:translateY(2px)}100%{transform:translateY(0)}}';
        document.head ? document.head.appendChild(style) : overlay.appendChild(style);
      }

      // Brushed-metal interior walls (behind the doors).
      const interior = el('div',
        'position:absolute;inset:0;background:' + brushed + ';opacity:0.5;');
      overlay.appendChild(interior);

      // Floor indicator panel (top center).
      const panel = el('div',
        'position:absolute;top:7%;left:50%;transform:translateX(-50%);z-index:3;' +
        'background:#0a0a0c;border:2px solid #555;border-radius:10px;padding:10px 22px;' +
        'box-shadow:0 0 18px rgba(0,0,0,0.6),inset 0 0 10px rgba(0,0,0,0.8);' +
        'text-align:center;min-width:240px;');
      const arrows = el('div', 'font-size:14px;color:#ffd23f;letter-spacing:2px;margin-bottom:4px;', '▲ ▲ ▲');
      const readout = el('div',
        'font-size:18px;font-weight:800;color:#ffb733;letter-spacing:0.5px;' +
        'text-shadow:0 0 8px rgba(255,150,30,0.8);white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis;max-width:320px;',
        (fromName != null ? String(fromName) : 'Lobby'));
      panel.appendChild(arrows);
      panel.appendChild(readout);
      overlay.appendChild(panel);

      // Two sliding doors that start open and close inward.
      const doorBase =
        'position:absolute;top:0;bottom:0;width:50%;z-index:2;' +
        'background:linear-gradient(90deg,#52525a 0%,#6a6a72 45%,#7a7a82 50%,#6a6a72 55%,#52525a 100%);' +
        'box-shadow:inset 0 0 40px rgba(0,0,0,0.5);' +
        'transition:transform 350ms cubic-bezier(.45,.05,.55,.95);';
      const seam =
        'background-image:' + brushed + ';background-blend-mode:overlay;';

      const leftDoor = el('div', doorBase + seam + 'left:0;transform:translateX(-100%);');
      const rightDoor = el('div', doorBase + seam + 'right:0;transform:translateX(100%);');
      // Subtle center seam highlight on each leading edge.
      leftDoor.appendChild(el('div',
        'position:absolute;top:0;bottom:0;right:0;width:2px;background:rgba(0,0,0,0.5);'));
      rightDoor.appendChild(el('div',
        'position:absolute;top:0;bottom:0;left:0;width:2px;background:rgba(0,0,0,0.5);'));
      overlay.appendChild(leftDoor);
      overlay.appendChild(rightDoor);

      document.body.appendChild(overlay);

      // --- Sequence ---
      // 1) doors close (~350ms)
      safe(() => SFX && typeof SFX.play === 'function' && SFX.play('elevator'));
      // force a layout read so the transition animates from the open state
      void overlay.offsetWidth;
      addTimer(() => {
        safe(() => { leftDoor.style.transform = 'translateX(0)'; });
        safe(() => { rightDoor.style.transform = 'translateX(0)'; });
      }, 20);

      // 2) indicator ticks from -> to (~450ms, doors closed)
      const tickStart = 370;
      const tickDur = 450;
      const ticks = 5;
      for (let i = 1; i <= ticks; i++) {
        addTimer(() => {
          safe(() => {
            // Halfway through the ticking, swap to the destination name.
            readout.textContent = (i <= Math.ceil(ticks / 2))
              ? (fromName != null ? String(fromName) : 'Lobby')
              : (toName != null ? String(toName) : 'Destination');
            // brief brightness pulse per tick
            readout.style.opacity = '0.55';
            addTimer(() => safe(() => { readout.style.opacity = '1'; }), 60);
          });
        }, tickStart + (i - 1) * (tickDur / ticks));
      }

      // 3) ding + doors open (~350ms)
      const openAt = tickStart + tickDur + 40;
      addTimer(() => {
        safe(() => { readout.textContent = (toName != null ? String(toName) : 'Destination'); });
        safe(() => { arrows.textContent = '✔'; arrows.style.color = '#2ec27e'; });
        safe(() => SFX && typeof SFX.play === 'function' && SFX.play('elevator'));
        safe(() => { leftDoor.style.transform = 'translateX(-100%)'; });
        safe(() => { rightDoor.style.transform = 'translateX(100%)'; });
      }, openAt);

      // 4) remove overlay + arrive
      addTimer(finish, openAt + 360);
    } catch (e) {
      // Any failure: tear down and arrive immediately.
      finish();
    }
  }

  const elevator = { openDirectory, playRide };

  try { if (typeof window !== 'undefined') window.Elevator = elevator; } catch (e) { /* ignore */ }

  return elevator;
}

export default createElevator;
