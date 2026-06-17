// =============================================================
// Digital Casinos — Pause menu overlay.
// A ".game-modal" "⏸ Paused" panel built via UI.openModal, with
// Resume / Settings / Controls (inline cheatsheet) / Profile /
// Sign out actions, plus a mute quick-toggle reflecting SFX state.
// All `actions` callbacks are optional and called defensively.
// Reuses existing CSS classes; builds DOM with createElement.
// Never throws.
// =============================================================

import { UI } from './ui.js';
import { SFX } from './audio.js';

// ---- tiny helpers ------------------------------------------------
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
const call = (fn) => { if (typeof fn === 'function') safe(() => fn()); };

// internal open state
let _open = false;

// Key-binding cheatsheet rows: [key, description].
const CONTROLS = [
  ['WASD', 'Move'],
  ['Mouse', 'Look'],
  ['Space', 'Jump'],
  ['V', 'View'],
  ['E', 'Use'],
  ['B', 'Buy'],
  ['G', 'Build'],
  ['F', 'Place'],
  ['R', 'Rotate / Edit'],
  ['X', 'Remove'],
  ['M', 'Map'],
  ['K', 'Games'],
  ['J', 'Achievements'],
  ['L', 'Leaderboard'],
  ['Q', 'Quests'],
  ['I', 'Profile'],
  ['N', 'Bank'],
  ['P', 'Skins'],
  ['T', 'Shop'],
  ['O', 'Settings'],
  ['H', 'Help'],
  ['`', 'Pause'],
];

function makeBtn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls || 'btn-small btn-ghost';
  b.textContent = label;
  b.addEventListener('click', () => safe(() => onClick && onClick(b)));
  return b;
}

function buildControlsPanel() {
  const panel = document.createElement('div');
  panel.className = 'pause-controls';
  panel.style.cssText =
    'margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;' +
    'max-height:240px;overflow:auto;text-align:left;';
  CONTROLS.forEach(([key, desc]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;';
    const kbd = document.createElement('span');
    kbd.textContent = key;
    kbd.style.cssText =
      'min-width:42px;text-align:center;padding:2px 6px;border-radius:6px;' +
      'font-weight:800;font-family:monospace;color:#1a0f00;background:var(--gold,#ffd23f);';
    const lbl = document.createElement('span');
    lbl.textContent = desc;
    lbl.style.cssText = 'color:rgba(230,230,245,0.92);';
    row.appendChild(kbd);
    row.appendChild(lbl);
    panel.appendChild(row);
  });
  return panel;
}

// Close the pause menu (clears open state + the modal host).
function closePause() {
  safe(() => {
    _open = false;
    if (UI && typeof UI.closeModal === 'function') UI.closeModal();
  });
}

export function openPauseMenu(actions) {
  return safe(() => {
    if (typeof document === 'undefined') return;
    const acts = (actions && typeof actions === 'object') ? actions : {};

    const modal = document.createElement('div');
    modal.className = 'game-modal pause-menu';

    // Close (X)
    const close = document.createElement('button');
    close.className = 'game-close btn-small btn-ghost';
    close.textContent = '✕';
    close.addEventListener('click', () => closePause());
    modal.appendChild(close);

    const h = document.createElement('h2');
    h.textContent = '⏸ Paused';
    modal.appendChild(h);

    // ---- primary action buttons ----
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:6px;';

    row.appendChild(makeBtn('▶ Resume', 'btn-small', () => {
      closePause();
      call(acts.resume);
    }));

    row.appendChild(makeBtn('⚙ Settings', 'btn-small btn-ghost', () => {
      call(acts.settings);
    }));

    // Controls toggles an inline cheatsheet.
    let controlsPanel = null;
    const controlsBtn = makeBtn('🎮 Controls', 'btn-small btn-ghost', () => {
      safe(() => {
        if (controlsPanel && controlsPanel.parentNode) {
          controlsPanel.parentNode.removeChild(controlsPanel);
          controlsPanel = null;
        } else {
          controlsPanel = buildControlsPanel();
          modal.appendChild(controlsPanel);
        }
      });
    });
    row.appendChild(controlsBtn);

    row.appendChild(makeBtn('🧑 Profile', 'btn-small btn-ghost', () => {
      call(acts.profile);
    }));

    row.appendChild(makeBtn('🚪 Sign out', 'btn-small btn-ghost', () => {
      call(acts.signOut);
    }));

    modal.appendChild(row);

    // ---- mute quick-toggle ----
    const muteRow = document.createElement('div');
    muteRow.className = 'btn-row';
    muteRow.style.cssText = 'display:flex;justify-content:center;margin-top:10px;';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'btn-small btn-ghost';
    const refreshMute = () => {
      const muted = safe(() => SFX && typeof SFX.isMuted === 'function' && SFX.isMuted()) || false;
      muteBtn.textContent = muted ? '🔇 Sound: Off' : '🔊 Sound: On';
    };
    refreshMute();
    muteBtn.addEventListener('click', () => {
      safe(() => {
        const cur = (SFX && typeof SFX.isMuted === 'function') ? SFX.isMuted() : false;
        if (SFX && typeof SFX.setMuted === 'function') SFX.setMuted(!cur);
      });
      refreshMute();
    });
    muteRow.appendChild(muteBtn);
    modal.appendChild(muteRow);

    if (UI && typeof UI.openModal === 'function') UI.openModal(modal);
    _open = true;
  });
}

export function isPauseOpen() {
  return !!_open;
}
