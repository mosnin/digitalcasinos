// =============================================================
// Digital Casinos — Wave 4: First-run tutorial / onboarding.
// A friendly multi-step .game-modal that teaches the basics:
// look/move, buying parcels, building, playing & editing games,
// the elevator, hotel rooms, attractions, and the wider menus.
//
// Public API:
//   maybeShowTutorial() -> boolean  (show once, gated by localStorage)
//   openTutorial()                  (always opens, fresh from step 1)
//
// Reuses UI.openModal / UI.closeModal and the existing CSS classes
// (.game-modal, .btn-row, .btn-small, .btn-ghost, .sub). Builds DOM
// with createElement. Defensive everywhere — never throws.
// =============================================================

import { UI } from './ui.js';

const STORAGE_KEY = 'dc_tutorial';
const DONE = 'done';

// ---- tiny defensive helpers ------------------------------------
const safe = (fn) => { try { return fn(); } catch (e) { /* never throw */ return undefined; } };

const lsGet = (k) => safe(() => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(k);
});
const lsSet = (k, v) => safe(() => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(k, v);
});

// ---- step content ----------------------------------------------
// Each step: { icon, title, body:[ ...lines ] }
const STEPS = [
  {
    icon: '🎥',
    title: 'Look & move',
    body: [
      'Move your <b>mouse</b> to look around.',
      'Walk with <b>W A S D</b>, hold <b>Shift</b> to sprint.',
      'Tap <b>V</b> to switch to third-person and see your character.',
    ],
  },
  {
    icon: '🟨',
    title: 'Buy land',
    body: [
      'Stand on a <b>glowing gold floor tile</b>.',
      'Press <b>B</b> to buy that parcel — now it’s yours to build on.',
    ],
  },
  {
    icon: '🛠️',
    title: 'Build & decorate',
    body: [
      'Press <b>G</b> to open the build menu.',
      'Press <b>F</b> to place the selected item, <b>R</b> to rotate it.',
      'Press <b>X</b> to remove something you placed.',
    ],
  },
  {
    icon: '🎰',
    title: 'Play & edit games',
    body: [
      'Walk up to one of your machines.',
      'Press <b>E</b> to play it.',
      'Press <b>R</b> to edit its payouts and house edge.',
    ],
  },
  {
    icon: '🛗',
    title: 'The Elevator',
    body: [
      'Press <b>E</b> at the elevator to travel.',
      'Hop between <b>casino floors</b>, <b>hotel towers</b>, and <b>attractions</b>.',
    ],
  },
  {
    icon: '🏨',
    title: 'Hotel rooms',
    body: [
      'On a hotel floor, press <b>E</b> at a door to <b>buy a room</b>.',
      'Then step inside and <b>decorate</b> it just like your parcels.',
    ],
  },
  {
    icon: '🎡',
    title: 'Attractions',
    body: [
      'Visit the <b>Derby</b> racing arena to bet on the horses.',
      'Or relax in the <b>botanical garden</b>.',
    ],
  },
  {
    icon: '✨',
    title: 'More to explore',
    body: [
      '<b>K</b> games lobby &nbsp; <b>J</b> achievements &nbsp; <b>L</b> leaderboard',
      '<b>Q</b> quests &nbsp; <b>N</b> bank &nbsp; <b>P</b> skins &nbsp; <b>T</b> shop',
      '<b>O</b> settings &nbsp; <b>`</b> pause.',
      'Have fun! 🎉',
    ],
  },
];

// ---- mark complete + close -------------------------------------
function finish() {
  lsSet(STORAGE_KEY, DONE);
  safe(() => UI && UI.closeModal && UI.closeModal());
}

// ---- build a small styled button -------------------------------
function makeBtn(label, ghost) {
  const b = document.createElement('button');
  b.className = 'btn-small' + (ghost ? ' btn-ghost' : '');
  b.type = 'button';
  b.textContent = label;
  return b;
}

// =============================================================
// openTutorial — always opens fresh at step 1
// =============================================================
export function openTutorial() {
  return safe(() => {
    if (typeof document === 'undefined') return;
    if (!UI || typeof UI.openModal !== 'function') return;

    const total = STEPS.length;
    let idx = 0;

    // ---- shell built once; inner content re-rendered per step ----
    const modal = document.createElement('div');
    modal.className = 'game-modal tutorial-modal';

    const close = document.createElement('button');
    close.className = 'game-close btn-small btn-ghost';
    close.type = 'button';
    close.textContent = '✕';
    close.title = 'Skip tutorial';
    close.addEventListener('click', () => finish());
    modal.appendChild(close);

    const h = document.createElement('h2');
    h.textContent = '👋 Welcome to Digital Casinos';
    modal.appendChild(h);

    const indicator = document.createElement('div');
    indicator.className = 'sub';
    modal.appendChild(indicator);

    // body host (replaced each render)
    const bodyHost = document.createElement('div');
    bodyHost.style.cssText =
      'margin:14px 0;min-height:120px;display:flex;flex-direction:column;gap:10px;';
    modal.appendChild(bodyHost);

    // button row
    const row = document.createElement('div');
    row.className = 'btn-row';
    const backBtn = makeBtn('‹ Back', true);
    const skipBtn = makeBtn('Skip', true);
    const nextBtn = makeBtn('Next ›');
    backBtn.addEventListener('click', () => {
      if (idx > 0) { idx--; render(); }
    });
    skipBtn.addEventListener('click', () => finish());
    nextBtn.addEventListener('click', () => {
      if (idx >= total - 1) { finish(); return; }
      idx++; render();
    });
    row.appendChild(backBtn);
    row.appendChild(skipBtn);
    row.appendChild(nextBtn);
    modal.appendChild(row);

    function render() {
      safe(() => {
        const step = STEPS[idx] || STEPS[0];
        indicator.textContent = 'Step ' + (idx + 1) + ' / ' + total;

        bodyHost.innerHTML = '';

        const head = document.createElement('div');
        head.style.cssText =
          'display:flex;align-items:center;gap:12px;font-weight:800;font-size:18px;';
        const icon = document.createElement('span');
        icon.style.fontSize = '34px';
        icon.textContent = step.icon || '👋';
        const titleEl = document.createElement('span');
        titleEl.textContent = step.title || '';
        head.appendChild(icon);
        head.appendChild(titleEl);
        bodyHost.appendChild(head);

        const lines = Array.isArray(step.body) ? step.body : [];
        lines.forEach((line) => {
          const p = document.createElement('div');
          p.style.cssText = 'line-height:1.5;opacity:0.92;';
          p.innerHTML = String(line == null ? '' : line);
          bodyHost.appendChild(p);
        });

        // back disabled on first step
        backBtn.disabled = (idx === 0);
        backBtn.style.opacity = (idx === 0) ? '0.4' : '';
        backBtn.style.pointerEvents = (idx === 0) ? 'none' : '';

        // last step turns Next into a finish action
        nextBtn.textContent = (idx >= total - 1) ? 'Got it! 🎉' : 'Next ›';
      });
    }

    render();
    UI.openModal(modal);
    return modal;
  });
}

// =============================================================
// maybeShowTutorial — show once unless already completed
// =============================================================
export function maybeShowTutorial() {
  return safe(() => {
    if (lsGet(STORAGE_KEY) === DONE) return false;
    openTutorial();
    return true;
  }) || false;
}

// expose for debugging / integrator convenience
if (typeof window !== 'undefined') {
  safe(() => { window.Tutorial = { maybeShowTutorial, openTutorial }; });
}
