// =============================================================
// Digital Casinos — Wave 3/6: Elevator (UX only).
// The elevator car meshes already live inside the venues; this
// module owns the *directory modal* (pick a destination) and the
// *ride transition* overlay (a luxe elevator cab: sliding doors +
// brushed-gold/dark-walnut walls, mirrored back panel, brass
// handrail, an illuminated floor indicator + a soft "ding").
// DOM/UX only — no WebGL required.
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

// Soft "ding" — guarded dynamic import so a missing/broken audio module
// can never break the ride or throw.
function playDing() {
  safe(() => {
    import('./audio.js').then((mod) => {
      safe(() => {
        const sfx = (mod && (mod.SFX || mod.default)) || null;
        if (sfx && typeof sfx.play === 'function') sfx.play('elevator');
      });
    }).catch(() => { /* no audio — silent, never throws */ });
  });
}

export function createElevator(opts) {
  const cfg = opts || {};
  // Default to imported DESTINATIONS when none passed.
  const baseList = Array.isArray(cfg.destinations) && cfg.destinations.length
    ? cfg.destinations
    : (Array.isArray(DESTINATIONS) ? DESTINATIONS : []);

  // -----------------------------------------------------------
  // Directory modal — classy grouped list of destinations.
  // -----------------------------------------------------------
  function openDirectory(currentId, onPick) {
    return safe(() => {
      if (!hasDoc() || !UI || typeof UI.openModal !== 'function') return;
      const list = baseList;

      const GOLD = '#e8c873';
      const GOLD_SOFT = 'rgba(232,200,115,0.85)';
      const WALNUT = '#1c130c';

      const modal = el('div',
        'max-height:74vh;display:flex;flex-direction:column;' +
        'background:linear-gradient(160deg,#241910 0%,#160e07 100%);');
      modal.className = 'game-modal elevator-directory';

      // Close button (✕) reuses existing game-close styling.
      const close = el('button', null, '✕');
      close.className = 'game-close btn-small btn-ghost';
      close.addEventListener('click', () => safe(() => UI.closeModal()));
      modal.appendChild(close);

      const h = el('h2', null, '🛗 Elevator — Choose a destination');
      h.style.cssText =
        'margin:0 0 2px;font-size:20px;font-weight:800;letter-spacing:0.4px;' +
        'color:' + GOLD + ';text-shadow:0 1px 2px rgba(0,0,0,0.6);';
      modal.appendChild(h);

      const sub = el('div', null, 'Step into the cab and select your floor');
      sub.className = 'sub';
      sub.style.cssText = 'color:rgba(232,200,115,0.55);font-size:12.5px;margin-bottom:6px;';
      modal.appendChild(sub);

      // Thin brass divider beneath the header.
      modal.appendChild(el('div',
        'height:1px;margin:6px 0 4px;border-radius:1px;' +
        'background:linear-gradient(90deg,transparent,' + GOLD_SOFT + ',transparent);'));

      const wrap = el('div',
        'display:flex;flex-direction:column;gap:3px;margin-top:4px;' +
        'overflow:auto;flex:1 1 auto;padding-right:4px;');

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
          'font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;' +
          'color:' + GOLD + ';margin:12px 2px 4px;opacity:0.78;';
        wrap.appendChild(header);

        groups[gName].forEach((d) => {
          const isHere = (currentId != null && d.id === currentId);
          const row = el('button', null);
          row.className = 'btn-small';

          const baseRow =
            'width:100%;text-align:left;display:flex;align-items:center;gap:13px;' +
            'padding:9px 13px;border-radius:9px;border:1px solid rgba(232,200,115,0.16);' +
            'background:linear-gradient(180deg,rgba(60,44,26,0.55),rgba(34,24,14,0.55));' +
            'color:#f3e9d6;font-size:14px;transition:background 140ms,border-color 140ms,transform 120ms;';
          const hereRow =
            'width:100%;text-align:left;display:flex;align-items:center;gap:13px;' +
            'padding:9px 13px;border-radius:9px;border:1px solid rgba(232,200,115,0.5);' +
            'background:linear-gradient(180deg,rgba(232,200,115,0.16),rgba(232,200,115,0.06));' +
            'color:' + GOLD + ';font-size:14px;cursor:default;';
          row.style.cssText = isHere ? hereRow : baseRow;

          const icon = el('span',
            'font-size:19px;width:24px;text-align:center;flex:0 0 auto;' +
            'filter:drop-shadow(0 1px 1px rgba(0,0,0,0.5));',
            (d.icon != null) ? d.icon : '🛗');
          const name = el('span',
            'flex:1 1 auto;font-weight:600;letter-spacing:0.2px;',
            (d.name != null) ? d.name : String(d.id));
          row.appendChild(icon);
          row.appendChild(name);

          if (isHere) {
            const tag = el('span', null, '● HERE');
            tag.style.cssText =
              'font-size:10.5px;color:#1a0f00;background:' + GOLD + ';' +
              'padding:2px 9px;border-radius:8px;font-weight:800;letter-spacing:0.5px;flex:0 0 auto;';
            row.appendChild(tag);
            row.disabled = true;
          } else {
            // Elegant hover: warm lift + brass border.
            row.addEventListener('mouseenter', () => safe(() => {
              row.style.background = 'linear-gradient(180deg,rgba(232,200,115,0.22),rgba(60,44,26,0.6))';
              row.style.borderColor = 'rgba(232,200,115,0.55)';
              row.style.transform = 'translateX(2px)';
            }));
            row.addEventListener('mouseleave', () => safe(() => {
              row.style.background = 'linear-gradient(180deg,rgba(60,44,26,0.55),rgba(34,24,14,0.55))';
              row.style.borderColor = 'rgba(232,200,115,0.16)';
              row.style.transform = 'translateX(0)';
            }));
            // A subtle "go" chevron on the right.
            const go = el('span', 'color:' + GOLD_SOFT + ';font-size:13px;flex:0 0 auto;opacity:0.7;', '›');
            row.appendChild(go);
            row.addEventListener('click', () => {
              safe(() => { if (typeof onPick === 'function') onPick(d); });
              safe(() => UI.closeModal());
            });
          }
          wrap.appendChild(row);
        });
      });

      if (!order.length) {
        wrap.appendChild(el('div', 'opacity:0.7;padding:12px;color:#f3e9d6;', 'No destinations available.'));
      }

      modal.appendChild(wrap);

      const footer = el('div',
        'margin-top:12px;padding-top:10px;display:flex;justify-content:flex-end;' +
        'border-top:1px solid rgba(232,200,115,0.15);');
      const closeBtn = el('button', null, 'Close');
      closeBtn.className = 'btn-small btn-ghost';
      closeBtn.addEventListener('click', () => safe(() => UI.closeModal()));
      footer.appendChild(closeBtn);
      modal.appendChild(footer);

      UI.openModal(modal);
    });
  }

  // -----------------------------------------------------------
  // Ride transition overlay — a luxe elevator cab.
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
      // --- Palette ---
      const GOLD = '#e8c873';
      const GOLD_BRIGHT = '#ffe9a8';
      // Brushed gold pinstripe and dark-walnut wood grain.
      const brushedGold =
        'repeating-linear-gradient(92deg,' +
        '#7a5e2b 0px,#9c7a39 2px,#caa14f 4px,#a07e3a 6px,#806029 8px)';
      const walnut =
        'repeating-linear-gradient(89deg,' +
        '#2a1a0e 0px,#3a2614 5px,#22150b 10px,#34200f 15px,#26160c 20px)';

      overlay = el('div',
        'position:fixed;inset:0;z-index:2147483600;overflow:hidden;' +
        'background:radial-gradient(ellipse at 50% 42%,#3a2c18 0%,#140d06 100%);' +
        'font-family:"Georgia","Segoe UI",system-ui,serif;color:#f3e9d6;' +
        'display:flex;align-items:center;justify-content:center;' +
        'animation:dcElevBounce 1.2s ease-in-out;opacity:1;' +
        'transition:opacity 320ms ease;');

      // Scoped keyframes (id-guarded so we never inject twice).
      if (!document.getElementById('dc-elevator-style')) {
        const style = el('style');
        style.id = 'dc-elevator-style';
        style.textContent =
          '@keyframes dcElevBounce{0%{transform:translateY(0)}12%{transform:translateY(4px)}' +
          '42%{transform:translateY(-2px)}72%{transform:translateY(2px)}100%{transform:translateY(0)}}' +
          '@keyframes dcElevDotPulse{0%,100%{opacity:0.25}50%{opacity:1}}';
        document.head ? document.head.appendChild(style) : overlay.appendChild(style);
      }

      // === CAB INTERIOR (behind the doors) =====================
      const cab = el('div', 'position:absolute;inset:0;z-index:1;overflow:hidden;');

      // Dark-walnut side walls with a brushed-gold inlay frame.
      cab.appendChild(el('div',
        'position:absolute;inset:0;background:' + walnut + ';'));
      // Vignette to give the cab depth.
      cab.appendChild(el('div',
        'position:absolute;inset:0;' +
        'background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 40%,rgba(0,0,0,0.55) 100%);'));

      // Mirrored back panel — subtle vertical gradient with a soft sheen.
      const mirror = el('div',
        'position:absolute;left:18%;right:18%;top:14%;bottom:18%;border-radius:6px;' +
        'background:linear-gradient(160deg,#5a5e66 0%,#7e8590 30%,#aeb6c2 50%,#828a96 70%,#4c5058 100%);' +
        'box-shadow:inset 0 0 60px rgba(0,0,0,0.5),0 0 0 4px rgba(232,200,115,0.35),' +
        '0 0 0 6px rgba(0,0,0,0.4);opacity:0.92;');
      // Diagonal sheen streak across the mirror.
      mirror.appendChild(el('div',
        'position:absolute;inset:0;border-radius:4px;' +
        'background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,0.28) 48%,transparent 60%);'));
      cab.appendChild(mirror);

      // Brushed-gold inlay frame around the mirror.
      cab.appendChild(el('div',
        'position:absolute;left:14%;right:14%;top:11%;bottom:14%;border-radius:8px;' +
        'background:' + brushedGold + ';z-index:-1;box-shadow:0 6px 20px rgba(0,0,0,0.5);'));

      // Brass handrail across the back wall.
      const rail = el('div',
        'position:absolute;left:12%;right:12%;bottom:30%;height:9px;border-radius:6px;' +
        'background:linear-gradient(180deg,#ffe9a8 0%,#caa14f 45%,#8a6a2c 100%);' +
        'box-shadow:0 3px 6px rgba(0,0,0,0.55),inset 0 1px 1px rgba(255,255,255,0.6);');
      // Rail end brackets.
      rail.appendChild(el('div',
        'position:absolute;left:-6px;top:-4px;width:8px;height:24px;border-radius:3px;' +
        'background:linear-gradient(180deg,#caa14f,#7a5e2b);'));
      rail.appendChild(el('div',
        'position:absolute;right:-6px;top:-4px;width:8px;height:24px;border-radius:3px;' +
        'background:linear-gradient(180deg,#caa14f,#7a5e2b);'));
      cab.appendChild(rail);

      // Warm ceiling glow.
      cab.appendChild(el('div',
        'position:absolute;top:0;left:0;right:0;height:16%;' +
        'background:linear-gradient(180deg,rgba(255,220,150,0.22),transparent);'));

      overlay.appendChild(cab);

      // === FLOOR / DESTINATION INDICATOR (top center) ==========
      const panel = el('div',
        'position:absolute;top:6.5%;left:50%;transform:translateX(-50%);z-index:5;' +
        'background:linear-gradient(180deg,#1a120a,#0a0703);' +
        'border:2px solid;border-image:linear-gradient(180deg,#e8c873,#7a5e2b) 1;' +
        'border-radius:12px;padding:11px 26px;min-width:260px;text-align:center;' +
        'box-shadow:0 8px 26px rgba(0,0,0,0.7),inset 0 0 14px rgba(0,0,0,0.85),' +
        '0 0 0 1px rgba(0,0,0,0.6);');

      // Ticking dots + direction arrow row.
      const dotsRow = el('div',
        'display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:6px;height:14px;');
      const arrow = el('span', 'font-size:13px;color:' + GOLD + ';letter-spacing:1px;', '▲');
      dotsRow.appendChild(arrow);
      const dots = [];
      for (let i = 0; i < 5; i++) {
        const dot = el('span',
          'width:8px;height:8px;border-radius:50%;display:inline-block;' +
          'background:#5a3f18;box-shadow:inset 0 0 2px rgba(0,0,0,0.8);transition:all 120ms;');
        dots.push(dot);
        dotsRow.appendChild(dot);
      }
      panel.appendChild(dotsRow);

      // The illuminated readout (amber seven-seg-ish glow).
      const readout = el('div',
        'font-family:"Courier New",monospace;font-size:19px;font-weight:800;' +
        'color:' + GOLD_BRIGHT + ';letter-spacing:1px;white-space:nowrap;' +
        'text-shadow:0 0 10px rgba(255,180,60,0.9),0 0 2px rgba(255,210,120,1);' +
        'overflow:hidden;text-overflow:ellipsis;max-width:340px;',
        (fromName != null ? String(fromName) : 'Lobby'));
      panel.appendChild(readout);
      overlay.appendChild(panel);

      // === SLIDING DOORS (start open, close, then open) ========
      // Polished brushed-gold doors with a soft inner sheen.
      const doorFace =
        'linear-gradient(100deg,#6b5224 0%,#8a6a2c 22%,#caa14f 48%,#e8c873 52%,' +
        '#caa14f 56%,#8a6a2c 78%,#6b5224 100%)';
      const doorBase =
        'position:absolute;top:0;bottom:0;width:50%;z-index:4;' +
        'background:' + doorFace + ';' +
        'box-shadow:inset 0 0 60px rgba(0,0,0,0.45);' +
        'transition:transform 360ms cubic-bezier(.45,.05,.55,.95);';

      const leftDoor = el('div', doorBase + 'left:0;transform:translateX(-100%);');
      const rightDoor = el('div', doorBase + 'right:0;transform:translateX(100%);');
      // Brushed grain overlay on each door.
      [leftDoor, rightDoor].forEach((d) => {
        d.appendChild(el('div',
          'position:absolute;inset:0;background:' + brushedGold + ';' +
          'opacity:0.35;mix-blend-mode:overlay;'));
      });
      // Center seam shadow on each leading edge.
      leftDoor.appendChild(el('div',
        'position:absolute;top:0;bottom:0;right:0;width:3px;' +
        'background:linear-gradient(90deg,rgba(0,0,0,0.1),rgba(0,0,0,0.6));z-index:2;'));
      rightDoor.appendChild(el('div',
        'position:absolute;top:0;bottom:0;left:0;width:3px;' +
        'background:linear-gradient(270deg,rgba(0,0,0,0.1),rgba(0,0,0,0.6));z-index:2;'));
      overlay.appendChild(leftDoor);
      overlay.appendChild(rightDoor);

      document.body.appendChild(overlay);

      // --- Sequence (total ~1.3s) ---
      // force a layout read so transitions animate from the open state
      void overlay.offsetWidth;

      // 1) doors close (~360ms)
      const closeAt = 30;
      addTimer(() => {
        safe(() => { leftDoor.style.transform = 'translateX(0)'; });
        safe(() => { rightDoor.style.transform = 'translateX(0)'; });
      }, closeAt);

      // 2) indicator ticks while the cab "travels" (doors closed)
      const tickStart = 400;
      const tickDur = 420;
      const ticks = dots.length;
      for (let i = 0; i < ticks; i++) {
        addTimer(() => {
          safe(() => {
            // Light each dot in sequence (a sweeping climb).
            for (let k = 0; k < dots.length; k++) {
              const on = (k <= i);
              dots[k].style.background = on
                ? 'radial-gradient(circle,#ffe9a8,#caa14f)'
                : '#5a3f18';
              dots[k].style.boxShadow = on
                ? '0 0 8px rgba(255,200,90,0.9)'
                : 'inset 0 0 2px rgba(0,0,0,0.8)';
            }
            // Halfway through, swap the readout to the destination.
            readout.textContent = (i < Math.ceil(ticks / 2))
              ? (fromName != null ? String(fromName) : 'Lobby')
              : (toName != null ? String(toName) : 'Destination');
            // brief brightness pulse per tick
            readout.style.opacity = '0.5';
            addTimer(() => safe(() => { readout.style.opacity = '1'; }), 70);
          });
        }, tickStart + i * (tickDur / ticks));
      }

      // 3) arrival: ding + readout locks to destination + doors open (~360ms)
      const openAt = tickStart + tickDur + 60;
      addTimer(() => {
        safe(() => { readout.textContent = (toName != null ? String(toName) : 'Destination'); });
        safe(() => { arrow.textContent = '✓'; arrow.style.color = '#7fd9a0'; });
        playDing();
        safe(() => { leftDoor.style.transform = 'translateX(-100%)'; });
        safe(() => { rightDoor.style.transform = 'translateX(100%)'; });
      }, openAt);

      // 4) fade the overlay out, then remove + arrive
      const fadeAt = openAt + 320;
      addTimer(() => { safe(() => { overlay.style.opacity = '0'; }); }, fadeAt);
      addTimer(finish, fadeAt + 340);
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
