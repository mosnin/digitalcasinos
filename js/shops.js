// =============================================================
// Digital Casinos — gift shop / concessions & decor browser UI.
// DOM-only modals where players spend coins on consumables and
// cosmetics (SHOP_CATALOG) and browse placeable decorations
// (DECOR_CATALOG). Buying happens here for shop items; decor is
// purchased at placement time in parcels.js — this is browse-only.
//
// Reuses UI.openModal/closeModal/toast and the existing CSS classes
// (.game-modal, .btn-row, .btn-small, .btn-ghost, .chip, .result-line).
// Defensive everywhere: never throws, guards missing UI/Economy.
// =============================================================

// THREE is not needed (DOM only) but importing it is harmless and keeps
// this module consistent with the rest of the codebase / import map.
import * as THREE from 'three';
import { SHOP_CATALOG, DECOR_CATALOG } from './config.js';
import { Economy } from './economy.js';
import { UI } from './ui.js';

// ---- tiny defensive helpers ------------------------------------
const safe = (fn) => { try { return fn(); } catch (e) { /* never throw out of shops */ return undefined; } };

// Format a coin amount with thousands separators.
const fmt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
};

// Read the live coin balance without assuming Economy exists.
function coinBalance() {
  return safe(() => (Economy && typeof Economy.coins === 'number') ? Economy.coins : 0) || 0;
}

// How many of an item the player owns (0 when Economy is missing).
function ownedCount(id) {
  return safe(() => (Economy && typeof Economy.inventoryCount === 'function')
    ? (Economy.inventoryCount(id) | 0) : 0) || 0;
}

// Affordability check that degrades gracefully if Economy is absent.
function affordable(cost) {
  return safe(() => (Economy && typeof Economy.canAfford === 'function')
    ? !!Economy.canAfford(cost) : false) || false;
}

// Toast via UI when available; swallow otherwise.
function toast(msg, kind) {
  safe(() => { if (UI && typeof UI.toast === 'function') UI.toast(msg, kind); });
}

// Small element factory.
function el(tag, opts) {
  const node = document.createElement(tag);
  if (opts) {
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.html != null) node.innerHTML = opts.html;
    if (opts.css) node.style.cssText = opts.css;
    if (opts.title != null) node.title = opts.title;
  }
  return node;
}

function closeModal() {
  safe(() => { if (UI && typeof UI.closeModal === 'function') UI.closeModal(); });
}

function openModal(node) {
  safe(() => {
    if (UI && typeof UI.openModal === 'function') UI.openModal(node);
  });
}

// A reusable "✕" close button wired to UI.closeModal().
function makeCloseX() {
  const x = el('button', { className: 'game-close btn-small btn-ghost', text: '✕' });
  x.addEventListener('click', closeModal);
  return x;
}

// Title + subtitle per shop kind. Unknown kinds fall back to the gift shop.
const SHOP_KINDS = {
  gift: { title: '🎁 Gift Shop', sub: 'Souvenirs, boosts & VIP perks — spend your winnings.' },
  food: { title: '🍔 Concessions', sub: 'Snacks, bubbly & front-row show tickets.' },
  show: { title: '🎭 Showroom Box Office', sub: 'Tickets & treats for tonight\'s show.' },
};

// Soft emphasis ordering by kind: items whose `kind` matches the shop's
// vibe float to the top. Pure cosmetic — the whole catalog is still shown.
const KIND_EMPHASIS = {
  gift: ['cosmetic', 'souvenir', 'boost'],
  food: ['consumable'],
  show: ['consumable'],
};

function orderedShopItems(kind) {
  const items = safe(() => Object.values(SHOP_CATALOG || {})) || [];
  const emphasis = KIND_EMPHASIS[kind] || [];
  // Stable sort: emphasized item-kinds first (in listed priority), rest after.
  const rank = (it) => {
    const i = emphasis.indexOf(it && it.kind);
    return i === -1 ? emphasis.length : i;
  };
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (rank(a.it) - rank(b.it)) || (a.i - b.i))
    .map((w) => w.it);
}

// =============================================================
// openShop(kind) — buy consumables/cosmetics from SHOP_CATALOG.
// =============================================================
export function openShop(kind = 'gift') {
  return safe(() => {
    if (typeof document === 'undefined') return;

    const meta = SHOP_KINDS[kind] || SHOP_KINDS.gift;

    // Per-open list of "re-check this card's affordability" callbacks.
    // Local to this call so opens never leak refreshers into each other.
    const buyStateRefreshers = [];
    const refreshAllBuyStates = () => buyStateRefreshers.forEach((fn) => safe(fn));

    const modal = el('div', { className: 'game-modal shop-modal' });
    modal.style.position = 'relative';
    // Roomier than a game modal so cards have space to breathe.
    modal.style.maxWidth = '760px';

    modal.appendChild(makeCloseX());

    modal.appendChild(el('h2', { text: meta.title }));
    modal.appendChild(el('div', { className: 'sub', text: meta.sub }));

    // Live-ish balance line (re-rendered after each purchase).
    const balance = el('div', { className: 'balance' });
    const renderBalance = () => { balance.textContent = '🪙 Balance: ' + fmt(coinBalance()); };
    renderBalance();
    modal.appendChild(balance);

    // Card grid.
    const grid = el('div', {
      css: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));' +
           'gap:14px;margin:8px 0 4px;text-align:left;',
    });

    const items = orderedShopItems(kind);
    if (!items.length) {
      grid.appendChild(el('div', {
        css: 'grid-column:1/-1;color:#b9b3d6;text-align:center;padding:18px;',
        text: 'The shelves are empty right now. Check back soon!',
      }));
    }

    items.forEach((item) => {
      if (!item || item.id == null) return;
      const id = item.id;
      const name = item.name || id;
      const cost = Number(item.cost) || 0;

      const card = el('div', {
        css: 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);' +
             'border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;',
      });

      // Header row: icon + name + owned badge.
      const head = el('div', { css: 'display:flex;align-items:center;gap:10px;' });
      head.appendChild(el('div', { css: 'font-size:34px;line-height:1;', text: item.icon || '🎁' }));

      const titleWrap = el('div', { css: 'flex:1;min-width:0;' });
      titleWrap.appendChild(el('div', { css: 'font-weight:800;font-size:16px;', text: name }));
      if (item.kind) {
        titleWrap.appendChild(el('div', {
          css: 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--neon2);',
          text: item.kind,
        }));
      }
      head.appendChild(titleWrap);

      // Owned-count badge (hidden when zero).
      const badge = el('span', {
        css: 'flex:none;font-size:12px;font-weight:800;color:#1a0f00;padding:2px 9px;' +
             'border-radius:9px;background:linear-gradient(135deg,#ffd23f,#ff9d00);' +
             'box-shadow:0 0 10px rgba(255,210,63,0.55);',
      });
      const renderBadge = () => {
        const n = ownedCount(id);
        if (n > 0) { badge.textContent = '×' + n + ' owned'; badge.style.display = ''; }
        else { badge.style.display = 'none'; }
      };
      renderBadge();
      head.appendChild(badge);
      card.appendChild(head);

      // Description.
      if (item.desc) {
        card.appendChild(el('div', { css: 'color:#cfc9e6;font-size:13px;flex:1;', text: item.desc }));
      }

      // Footer row: price chip + BUY button.
      const footer = el('div', { css: 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;' });
      footer.appendChild(el('span', {
        className: 'chip',
        css: 'color:var(--gold);font-weight:800;',
        text: '🪙 ' + fmt(cost),
      }));

      const buy = el('button', { className: 'btn-small', text: 'Buy' });
      const syncBuyState = () => {
        const ok = affordable(cost);
        buy.disabled = !ok;
        buy.style.opacity = ok ? '' : '0.5';
        buy.style.cursor = ok ? '' : 'not-allowed';
        buy.title = ok ? '' : 'Not enough coins';
      };
      syncBuyState();

      buy.addEventListener('click', () => safe(() => {
        if (!affordable(cost)) { toast('Not enough coins', 'bad'); return; }
        const res = safe(() => (Economy && typeof Economy.buyShopItem === 'function')
          ? Economy.buyShopItem(id, cost) : { ok: false });
        if (res && res.ok) {
          toast('Bought ' + name + '!', 'good');
          renderBalance();
          renderBadge();
          // Refresh every card's affordability — balance changed.
          refreshAllBuyStates();
        } else {
          toast('Not enough coins', 'bad');
          renderBalance();
        }
      }));

      footer.appendChild(buy);
      card.appendChild(footer);

      // Register this card's affordability refresher.
      buyStateRefreshers.push(syncBuyState);

      grid.appendChild(card);
    });

    modal.appendChild(grid);

    // Footer: Close button row.
    const row = el('div', { className: 'btn-row' });
    const close = el('button', { className: 'btn-small btn-ghost', text: 'Close' });
    close.addEventListener('click', closeModal);
    row.appendChild(close);
    modal.appendChild(row);

    openModal(modal);
  });
}

// =============================================================
// openDecorStore() — browse DECOR_CATALOG (reference only).
// Placement & charging happen in parcels.js build mode.
// =============================================================
export function openDecorStore() {
  return safe(() => {
    if (typeof document === 'undefined') return;

    const modal = el('div', { className: 'game-modal decor-modal' });
    modal.style.position = 'relative';
    modal.style.maxWidth = '760px';

    modal.appendChild(makeCloseX());

    modal.appendChild(el('h2', { text: '🛋️ Decor Catalog' }));
    modal.appendChild(el('div', {
      className: 'sub',
      text: 'Browse decorations for your parcel.',
    }));

    // How-to note.
    const note = el('div', {
      className: 'palette-hint',
      css: 'margin:0 0 14px;font-size:13px;color:#cfc9e6;',
      html: 'Open <b>Build mode</b> (press <b>G</b>) to place decorations on your parcel.',
    });
    modal.appendChild(note);

    const grid = el('div', {
      css: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));' +
           'gap:12px;margin:4px 0;',
    });

    const items = safe(() => Object.values(DECOR_CATALOG || {})) || [];
    if (!items.length) {
      grid.appendChild(el('div', {
        css: 'grid-column:1/-1;color:#b9b3d6;text-align:center;padding:18px;',
        text: 'No decorations available.',
      }));
    }

    items.forEach((item) => {
      if (!item || item.id == null) return;
      const card = el('div', {
        css: 'background:rgba(255,255,255,0.04);border:2px solid transparent;' +
             'border-radius:10px;padding:12px;text-align:center;display:flex;' +
             'flex-direction:column;align-items:center;gap:4px;',
      });
      card.appendChild(el('div', { css: 'font-size:32px;line-height:1.1;', text: item.icon || '🎲' }));
      card.appendChild(el('div', { css: 'font-weight:700;font-size:14px;', text: item.name || item.id }));
      card.appendChild(el('div', {
        css: 'font-size:12px;color:var(--gold);font-weight:700;',
        text: '🪙 ' + fmt(Number(item.cost) || 0),
      }));
      grid.appendChild(card);
    });

    modal.appendChild(grid);

    const row = el('div', { className: 'btn-row' });
    const close = el('button', { className: 'btn-small btn-ghost', text: 'Close' });
    close.addEventListener('click', closeModal);
    row.appendChild(close);
    modal.appendChild(row);

    openModal(modal);
  });
}

// Expose on window for debugging / cross-module access (harmless).
if (typeof window !== 'undefined') {
  window.openShop = openShop;
  window.openDecorStore = openDecorStore;
}

// Reference THREE so linters/bundlers don't flag the import as unused.
// (No-op; DOM-only module.) void avoids any side effects.
void THREE;
