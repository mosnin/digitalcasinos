// =============================================================
// Digital Casinos — Profile & Portfolio panel.
// `openProfile({ economy })` renders a read-only-ish `.game-modal`
// showing the player's display name (editable + save), net worth,
// coin balance, lifetime stats, owned parcels (grouped by floor),
// owned hotel rooms (with style), owned skins and shop inventory.
//
// Reuses existing CSS classes (.game-modal, .balance, .btn-row,
// .btn-small, .btn-ghost). Builds DOM with createElement.
// Defensive everywhere — never throws.
// =============================================================

import { FLOORS, ROOM_STYLES, GAME_CATALOG, SKIN_CATALOG, SHOP_CATALOG } from './config.js';
import { computeNetWorth } from './leaderboard.js';
import { UI } from './ui.js';

// ---- tiny guards ---------------------------------------------------
const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
const fmt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
};

function el(tag, css, text) {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text != null) node.textContent = String(text);
  return node;
}

// A labeled section heading.
function sectionTitle(text) {
  return el(
    'div',
    'margin:14px 0 6px;font-size:12px;font-weight:800;letter-spacing:1px;' +
      'text-transform:uppercase;color:var(--neon2,#18e0ff);',
    text
  );
}

// One simple "label : value" stat row.
function statRow(label, value) {
  const row = el('div', 'display:flex;justify-content:space-between;gap:12px;padding:3px 0;');
  row.appendChild(el('span', 'opacity:0.8;', label));
  row.appendChild(el('span', 'font-weight:700;color:var(--gold,#ffd23f);', value));
  return row;
}

function emptyNote(text) {
  return el('div', 'padding:6px 2px;opacity:0.6;font-style:italic;', text);
}

// =====================================================================
// Public entry point
// =====================================================================
export function openProfile({ economy } = {}) {
  return safe(() => {
    if (typeof document === 'undefined') return;
    const eco = economy || (typeof window !== 'undefined' ? window.Economy : null);
    const state = (eco && eco.state) || {};

    const modal = el('div', 'min-width:340px;max-width:480px;');
    modal.className = 'game-modal profile-modal';

    // ---- close (X) ----
    const closeX = el('button', null, '✕');
    closeX.className = 'game-close btn-small btn-ghost';
    closeX.addEventListener('click', () => safe(() => UI && UI.closeModal()));
    modal.appendChild(closeX);

    modal.appendChild(el('h2', null, '🧑 Profile & Portfolio'));

    // ---- display name (editable) ----
    modal.appendChild(sectionTitle('Display Name'));
    const nameRow = el('div', 'display:flex;gap:8px;align-items:center;');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.value = safe(() => (state.profile && state.profile.name) || 'Player', 'Player');
    input.style.cssText =
      'flex:1;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);' +
      'background:rgba(0,0,0,0.35);color:#fff;font-size:14px;';
    const saveBtn = el('button', null, 'Save');
    saveBtn.className = 'btn-small';
    saveBtn.addEventListener('click', () => {
      safe(() => {
        if (!eco) return;
        if (!eco.state) eco.state = {};
        if (!eco.state.profile || typeof eco.state.profile !== 'object') eco.state.profile = {};
        const v = String(input.value || '').trim().slice(0, 24) || 'Player';
        eco.state.profile.name = v;
        input.value = v;
        if (typeof eco.save === 'function') eco.save();
        if (UI && typeof UI.toast === 'function') UI.toast('Saved');
      });
    });
    nameRow.appendChild(input);
    nameRow.appendChild(saveBtn);
    modal.appendChild(nameRow);

    // ---- wealth summary ----
    modal.appendChild(sectionTitle('Wealth'));
    const balance = el('div', null);
    balance.className = 'balance';
    const netWorth = safe(() => computeNetWorth(eco), 0);
    const coins = safe(() => (eco && typeof eco.coins === 'number') ? eco.coins : (state.coins || 0), 0);
    balance.appendChild(statRow('Net Worth', fmt(netWorth) + ' 🪙'));
    balance.appendChild(statRow('Coin Balance', fmt(coins) + ' 🪙'));
    modal.appendChild(balance);

    // ---- lifetime stats ----
    modal.appendChild(sectionTitle('Lifetime Stats'));
    const stats = (state.stats && typeof state.stats === 'object') ? state.stats : {};
    const statsWrap = el('div', null);
    statsWrap.appendChild(statRow('Total Wagered', fmt(stats.wagered || 0) + ' 🪙'));
    statsWrap.appendChild(statRow('Total Won', fmt(stats.won || 0) + ' 🪙'));
    statsWrap.appendChild(statRow('Spins / Plays', fmt(stats.spins || 0)));
    modal.appendChild(statsWrap);

    // ---- owned parcels grouped by floor ----
    modal.appendChild(sectionTitle('Owned Parcels'));
    const parcelWrap = el('div', 'display:flex;flex-direction:column;gap:6px;');
    const parcelKeys = safe(() => (eco && typeof eco.ownedParcelKeys === 'function')
      ? (eco.ownedParcelKeys() || []) : [], []);

    if (!parcelKeys.length) {
      parcelWrap.appendChild(emptyNote('No parcels yet — press B to buy a floor tile.'));
    } else {
      // group keys by parsed floor index ("floor_ti_tj")
      const byFloor = {};
      for (const key of parcelKeys) {
        const floor = safe(() => {
          const m = String(key).split('_');
          const f = parseInt(m[0], 10);
          return isFinite(f) ? f : -1;
        }, -1);
        (byFloor[floor] = byFloor[floor] || []).push(key);
      }
      Object.keys(byFloor)
        .sort((a, b) => Number(a) - Number(b))
        .forEach((floorStr) => {
          const fi = Number(floorStr);
          const keys = byFloor[floorStr];
          const floorDef = safe(() => FLOORS[fi], null);
          const floorName = (floorDef && floorDef.name) ? floorDef.name : ('Floor ' + (fi >= 0 ? fi : '?'));

          const card = el('div',
            'background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 10px;');
          const head = el('div', 'display:flex;justify-content:space-between;gap:10px;font-weight:700;');
          head.appendChild(el('span', null, floorName));
          head.appendChild(el('span', 'color:var(--gold,#ffd23f);', keys.length + ' parcel' + (keys.length === 1 ? '' : 's')));
          card.appendChild(head);

          keys.forEach((key) => {
            const games = safe(() => (eco && typeof eco.getGames === 'function')
              ? (eco.getGames(key) || []) : [], []);
            const names = games
              .map((g) => safe(() => {
                const def = g && g.type ? GAME_CATALOG[g.type] : null;
                return (def && def.name) ? def.name : (g && g.type ? g.type : null);
              }, null))
              .filter(Boolean);
            const line = el('div', 'font-size:12px;opacity:0.85;padding:2px 0 0 4px;');
            const label = names.length ? names.join(', ') : 'empty';
            line.textContent = '• ' + key + ' — ' + label;
            card.appendChild(line);
          });
          parcelWrap.appendChild(card);
        });
    }
    modal.appendChild(parcelWrap);

    // ---- owned hotel rooms ----
    modal.appendChild(sectionTitle('Hotel Rooms'));
    const roomWrap = el('div', 'display:flex;flex-direction:column;gap:4px;');
    const roomIds = safe(() => (eco && typeof eco.ownedRoomIds === 'function')
      ? (eco.ownedRoomIds() || []) : [], []);

    if (!roomIds.length) {
      roomWrap.appendChild(emptyNote('No rooms yet — visit a hotel tower to buy one.'));
    } else {
      roomIds.forEach((id) => {
        const room = safe(() => (eco && typeof eco.getRoom === 'function') ? eco.getRoom(id) : null, null);
        const styleId = room && room.style ? room.style : 'standard';
        const styleDef = safe(() => ROOM_STYLES[styleId], null);
        const styleName = (styleDef && styleDef.name) ? styleDef.name : styleId;
        const row = el('div', 'display:flex;justify-content:space-between;gap:10px;' +
          'background:rgba(255,255,255,0.04);border-radius:8px;padding:6px 10px;font-size:13px;');
        row.appendChild(el('span', null, '🛏️ ' + id));
        row.appendChild(el('span', 'color:var(--gold,#ffd23f);font-weight:700;', styleName));
        roomWrap.appendChild(row);
      });
    }
    modal.appendChild(roomWrap);

    // ---- owned skins ----
    modal.appendChild(sectionTitle('Skins'));
    const skinWrap = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
    const ownedSkins = safe(() => Array.isArray(state.ownedSkins) ? state.ownedSkins : [], []);
    if (!ownedSkins.length) {
      skinWrap.appendChild(emptyNote('No skins owned.'));
    } else {
      const equipped = state.skin;
      ownedSkins.forEach((id) => {
        const def = safe(() => SKIN_CATALOG[id], null);
        const name = (def && def.name) ? def.name : id;
        const isOn = id === equipped;
        const pill = el('span',
          'padding:3px 10px;border-radius:10px;font-size:12px;font-weight:700;' +
          (isOn
            ? 'background:linear-gradient(135deg,#ffd23f,#ff9d00);color:#1a0f00;'
            : 'background:rgba(255,255,255,0.08);color:#fff;'),
          (isOn ? '★ ' : '') + name);
        skinWrap.appendChild(pill);
      });
    }
    modal.appendChild(skinWrap);

    // ---- shop inventory ----
    modal.appendChild(sectionTitle('Shop Inventory'));
    const invWrap = el('div', 'display:flex;flex-direction:column;gap:4px;');
    const inventory = (state.inventory && typeof state.inventory === 'object') ? state.inventory : {};
    const invIds = Object.keys(inventory).filter((id) => (Number(inventory[id]) || 0) > 0);
    if (!invIds.length) {
      invWrap.appendChild(emptyNote('Nothing from the gift shop yet.'));
    } else {
      invIds.forEach((id) => {
        const def = safe(() => SHOP_CATALOG[id], null);
        const icon = (def && def.icon) ? def.icon : '🎁';
        const name = (def && def.name) ? def.name : id;
        const count = Number(inventory[id]) || 0;
        const row = el('div', 'display:flex;justify-content:space-between;gap:10px;' +
          'background:rgba(255,255,255,0.04);border-radius:8px;padding:6px 10px;font-size:13px;');
        row.appendChild(el('span', null, icon + ' ' + name));
        row.appendChild(el('span', 'color:var(--gold,#ffd23f);font-weight:700;', '×' + count));
        invWrap.appendChild(row);
      });
    }
    modal.appendChild(invWrap);

    // ---- footer: Close ----
    const footer = el('div', 'margin-top:16px;display:flex;justify-content:flex-end;');
    footer.className = 'btn-row';
    const closeBtn = el('button', null, 'Close');
    closeBtn.className = 'btn-small';
    closeBtn.addEventListener('click', () => safe(() => UI && UI.closeModal()));
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    safe(() => UI && UI.openModal(modal));
    return modal;
  });
}

if (typeof window !== 'undefined') {
  safe(() => { window.openProfile = openProfile; });
}
