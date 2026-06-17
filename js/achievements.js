// =============================================================
// Digital Casinos — achievements & objectives.
// Reads Economy.state (coins, stats, parcels, getGames) to award
// achievements. Persists unlocked ids to localStorage and fires
// onUnlock(ach) exactly once per achievement. Never throws.
// Renders a `.game-modal` grid panel via UI.openModal.
// =============================================================

import { GAME_CATALOG } from './config.js';
import { UI } from './ui.js';

const STORE_KEY = 'dc_achievements';

const safe = (fn, fallback) => {
  try { return fn(); } catch (e) { return fallback; }
};

// ---- helpers reading economy.state defensively --------------------
function getState(economy) {
  return (economy && economy.state) || {};
}
function getCoins(economy) {
  const s = getState(economy);
  const v = Number(s.coins);
  return isFinite(v) ? v : 0;
}
function getStats(economy) {
  const s = getState(economy);
  const st = s.stats || {};
  return {
    wagered: Number(st.wagered) || 0,
    won: Number(st.won) || 0,
    spins: Number(st.spins) || 0,
  };
}
function ownedKeys(economy) {
  return safe(() => {
    if (economy && typeof economy.ownedParcelKeys === 'function') {
      const k = economy.ownedParcelKeys();
      return Array.isArray(k) ? k : [];
    }
    const parcels = getState(economy).parcels || {};
    return Object.keys(parcels).filter((k) => parcels[k] && parcels[k].owned);
  }, []);
}
function gamesForKey(economy, key) {
  return safe(() => {
    if (economy && typeof economy.getGames === 'function') {
      const g = economy.getGames(key);
      return Array.isArray(g) ? g : [];
    }
    const parcels = getState(economy).parcels || {};
    const p = parcels[key];
    return (p && Array.isArray(p.games)) ? p.games : [];
  }, []);
}
function allPlacedGames(economy) {
  const out = [];
  for (const key of ownedKeys(economy)) {
    for (const g of gamesForKey(economy, key)) out.push(g);
  }
  return out;
}
function placedGameTypes(economy) {
  const set = new Set();
  for (const g of allPlacedGames(economy)) {
    if (g && g.type != null) set.add(String(g.type));
  }
  return set;
}
function ownedSkinsCount(economy) {
  const s = getState(economy);
  return Array.isArray(s.ownedSkins) ? s.ownedSkins.length : 0;
}

const CATALOG_TYPES = safe(() => Object.keys(GAME_CATALOG || {}), []);

// ---- achievement definitions --------------------------------------
const ACHIEVEMENTS = [
  {
    id: 'first_parcel', name: 'Land Baron', icon: '🏞️',
    desc: 'Own your first parcel.',
    test: (e) => ownedKeys(e).length >= 1,
  },
  {
    id: 'three_parcels', name: 'Property Mogul', icon: '🏘️',
    desc: 'Own 3 parcels.',
    test: (e) => ownedKeys(e).length >= 3,
  },
  {
    id: 'eight_parcels', name: 'Casino Tycoon', icon: '🏙️',
    desc: 'Own 8 parcels.',
    test: (e) => ownedKeys(e).length >= 8,
  },
  {
    id: 'first_machine', name: 'Open for Business', icon: '🎰',
    desc: 'Place your first machine.',
    test: (e) => allPlacedGames(e).length >= 1,
  },
  {
    id: 'five_machines', name: 'Gaming Floor', icon: '🕹️',
    desc: 'Place 5 machines.',
    test: (e) => allPlacedGames(e).length >= 5,
  },
  {
    id: 'one_of_each', name: 'Full House', icon: '🃏',
    desc: 'Place one of every game type.',
    test: (e) => {
      if (!CATALOG_TYPES.length) return false;
      const types = placedGameTypes(e);
      return CATALOG_TYPES.every((t) => types.has(String(t)));
    },
  },
  {
    id: 'coins_3k', name: 'Stacking Chips', icon: '🪙',
    desc: 'Reach 3,000 coins.',
    test: (e) => getCoins(e) >= 3000,
  },
  {
    id: 'coins_10k', name: 'High Roller', icon: '💰',
    desc: 'Reach 10,000 coins.',
    test: (e) => getCoins(e) >= 10000,
  },
  {
    id: 'spins_50', name: 'Seasoned Gambler', icon: '🎲',
    desc: 'Play 50 spins.',
    test: (e) => getStats(e).spins >= 50,
  },
  {
    id: 'spins_250', name: 'No Quit in You', icon: '🔥',
    desc: 'Play 250 spins.',
    test: (e) => getStats(e).spins >= 250,
  },
  {
    id: 'won_5k', name: 'Lucky Streak', icon: '🍀',
    desc: 'Win 5,000 coins total.',
    test: (e) => getStats(e).won >= 5000,
  },
  {
    id: 'skins_3', name: 'Dressed to Impress', icon: '🤵',
    desc: 'Own 3 character skins.',
    test: (e) => ownedSkinsCount(e) >= 3,
  },
];

// ---- module state -------------------------------------------------
let _economy = null;
let _onUnlock = null;
let _unlocked = new Set();

function loadUnlocked() {
  return safe(() => {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  }, new Set());
}

function persist() {
  safe(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(_unlocked)));
  });
}

// ---- panel rendering ----------------------------------------------
function buildPanel() {
  return safe(() => {
    if (typeof document === 'undefined') return null;

    const modal = document.createElement('div');
    modal.className = 'game-modal achievements-panel';

    const close = document.createElement('button');
    close.className = 'game-close btn-small btn-ghost';
    close.textContent = '✕';
    close.addEventListener('click', () => safe(() => UI.closeModal()));
    modal.appendChild(close);

    const h = document.createElement('h2');
    h.textContent = 'Achievements';
    modal.appendChild(h);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = unlockedCount() + ' / ' + total() + ' unlocked';
    modal.appendChild(sub);

    const grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));' +
      'gap:10px;margin-top:12px;max-height:60vh;overflow-y:auto;';

    for (const ach of ACHIEVEMENTS) {
      const unlocked = _unlocked.has(ach.id);
      const card = document.createElement('div');
      card.className = 'achievement-card' + (unlocked ? ' unlocked' : ' locked');
      card.style.cssText =
        'display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;' +
        'padding:12px 10px;border-radius:12px;' +
        'background:rgba(255,255,255,0.04);' +
        'border:1px solid ' + (unlocked ? 'rgba(255,210,63,0.7)' : 'rgba(255,255,255,0.08)') + ';' +
        (unlocked
          ? 'box-shadow:0 0 16px rgba(255,210,63,0.45);'
          : 'opacity:0.5;filter:grayscale(0.6);');

      const icon = document.createElement('div');
      icon.style.cssText = 'font-size:30px;line-height:1;';
      icon.textContent = unlocked ? (ach.icon || '🏆') : '🔒';
      card.appendChild(icon);

      const name = document.createElement('div');
      name.style.cssText = 'font-weight:800;font-size:13px;color:' +
        (unlocked ? 'var(--gold)' : '#cfd2dc') + ';';
      name.textContent = ach.name || ach.id;
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:11px;color:rgba(220,220,235,0.8);';
      desc.textContent = ach.desc || '';
      card.appendChild(desc);

      grid.appendChild(card);
    }
    modal.appendChild(grid);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:center;margin-top:14px;';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-small';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => safe(() => UI.closeModal()));
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    return modal;
  }, null);
}

// ---- public API ---------------------------------------------------
function unlockedCount() {
  return safe(() => {
    let n = 0;
    for (const ach of ACHIEVEMENTS) if (_unlocked.has(ach.id)) n++;
    return n;
  }, 0);
}

function total() {
  return ACHIEVEMENTS.length;
}

export const Achievements = {
  init({ economy, onUnlock } = {}) {
    return safe(() => {
      _economy = economy || (typeof window !== 'undefined' ? window.Economy : null) || null;
      _onUnlock = (typeof onUnlock === 'function') ? onUnlock : null;
      _unlocked = loadUnlocked();
      return this;
    }, this);
  },

  evaluate() {
    return safe(() => {
      const e = _economy || (typeof window !== 'undefined' ? window.Economy : null);
      const newlyUnlocked = [];
      for (const ach of ACHIEVEMENTS) {
        if (_unlocked.has(ach.id)) continue;
        const passed = safe(() => !!ach.test(e), false);
        if (passed) {
          _unlocked.add(ach.id);
          newlyUnlocked.push(ach);
        }
      }
      if (newlyUnlocked.length) {
        persist();
        for (const ach of newlyUnlocked) {
          if (_onUnlock) safe(() => _onUnlock(ach));
        }
      }
      return newlyUnlocked;
    }, []);
  },

  openPanel() {
    safe(() => {
      const node = buildPanel();
      if (node) UI.openModal(node);
    });
  },

  unlockedCount,
  total,
};

if (typeof window !== 'undefined') window.Achievements = Achievements;

export default Achievements;
