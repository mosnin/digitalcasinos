// =============================================================
// Digital Casinos — character SKIN shop + skin application.
// DOM-only modal where players buy / equip humanoid skins
// (SKIN_CATALOG) and a couple of helpers that recolor humanoids
// built by characters.buildHumanoid().
//
// Buying & equipping go through the Economy singleton. Whenever the
// equipped skin changes we dispatch a window 'skinchange' event so
// player.js (and anything else listening) can rebuild/recolor its
// avatar.
//
// Reuses UI.openModal/closeModal/toast and the existing CSS classes
// (.game-modal, .btn-row, .btn-small, .btn-ghost, .chip-options, .chip).
// Defensive everywhere: never throws, guards missing UI/Economy.
// =============================================================

// THREE is not needed (DOM only + plain recolor calls) but importing it
// is harmless and keeps this module consistent with the rest of the
// codebase / the page's import map.
import * as THREE from 'three';
import { SKIN_CATALOG } from './config.js';
import { Economy } from './economy.js';
import { UI } from './ui.js';

// ---- tiny defensive helpers ------------------------------------
const safe = (fn) => { try { return fn(); } catch (e) { /* never throw out of skins */ return undefined; } };

// Format a coin amount with thousands separators.
const fmt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
};

// Fallback colors if the catalog is somehow empty / malformed.
const FALLBACK_SKIN = { id: 'highroller', name: 'High Roller', cost: 0, suit: 0xf5f5f5, accent: 0xffd23f, skin: 0xe0ac69 };

// Resolve a skin definition, always returning something usable.
function skinDef(id) {
  return safe(() => {
    const cat = SKIN_CATALOG || {};
    return cat[id] || cat.highroller || FALLBACK_SKIN;
  }) || FALLBACK_SKIN;
}

// number (0xrrggbb) or css string -> css hex string for inline swatches.
function cssColor(c) {
  if (typeof c === 'number' && isFinite(c)) {
    return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  }
  return (typeof c === 'string' && c) ? c : '#ffffff';
}

// Read the live coin balance without assuming Economy exists.
function coinBalance() {
  return safe(() => (Economy && typeof Economy.coins === 'number') ? Economy.coins : 0) || 0;
}

// The currently equipped skin id (defensive).
function equippedId() {
  return safe(() => (Economy && Economy.skin) || 'highroller') || 'highroller';
}

// Does the player own this skin?
function owns(id) {
  return safe(() => (Economy && typeof Economy.ownsSkin === 'function') ? !!Economy.ownsSkin(id) : false) || false;
}

// Affordability check that degrades gracefully if Economy is absent.
function affordable(cost) {
  return safe(() => (Economy && typeof Economy.canAfford === 'function') ? !!Economy.canAfford(cost) : false) || false;
}

// Toast via UI when available; swallow otherwise.
function toast(msg, kind) {
  safe(() => { if (UI && typeof UI.toast === 'function') UI.toast(msg, kind); });
}

function closeModal() {
  safe(() => { if (UI && typeof UI.closeModal === 'function') UI.closeModal(); });
}

function openModal(node) {
  safe(() => { if (UI && typeof UI.openModal === 'function') UI.openModal(node); });
}

// Tell the rest of the app (player.js) the equipped skin changed so it
// can rebuild its avatar.
function dispatchSkinChange() {
  safe(() => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('skinchange', { detail: { skin: equippedId() } }));
  });
}

// Small element factory (matches the style used across the UI modules).
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

// A reusable "✕" close button wired to UI.closeModal().
function makeCloseX() {
  const x = el('button', { className: 'game-close btn-small btn-ghost', text: '✕' });
  x.addEventListener('click', closeModal);
  return x;
}

// A tiny labeled color square (inline-styled) for the card preview.
function swatch(color, label) {
  return el('span', {
    title: label,
    css: 'display:inline-block;width:20px;height:20px;border-radius:5px;' +
         'border:1px solid rgba(255,255,255,0.35);' +
         'box-shadow:inset 0 0 4px rgba(0,0,0,0.45);background:' + cssColor(color) + ';',
  });
}

// =============================================================
// openSkinShop() — buy / equip humanoid skins from SKIN_CATALOG.
// =============================================================
export function openSkinShop() {
  return safe(() => {
    if (typeof document === 'undefined') return;

    const modal = el('div', { className: 'game-modal skin-modal' });
    modal.style.position = 'relative';
    // Roomier than a game modal so cards have space to breathe.
    modal.style.maxWidth = '760px';

    modal.appendChild(makeCloseX());

    modal.appendChild(el('h2', { text: '👗 Style & Skins' }));
    modal.appendChild(el('div', {
      className: 'sub',
      text: 'Dress your high roller. Buy a look, then strut the floor.',
    }));

    // Live-ish balance line (re-rendered on every re-render()).
    const balance = el('div', { className: 'balance' });
    modal.appendChild(balance);

    // Card grid host — its contents are rebuilt by render().
    const grid = el('div', {
      css: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));' +
           'gap:14px;margin:8px 0 4px;text-align:left;',
    });
    modal.appendChild(grid);

    // Footer: Close button row.
    const row = el('div', { className: 'btn-row' });
    const closeBtn = el('button', { className: 'btn-small btn-ghost', text: 'Close' });
    closeBtn.addEventListener('click', closeModal);
    row.appendChild(closeBtn);
    modal.appendChild(row);

    // ---- render(): redraw balance + all cards from current state ----
    const render = () => safe(() => {
      balance.textContent = '🪙 Balance: ' + fmt(coinBalance());
      grid.innerHTML = '';

      const items = safe(() => Object.values(SKIN_CATALOG || {})) || [];
      if (!items.length) {
        grid.appendChild(el('div', {
          css: 'grid-column:1/-1;color:#b9b3d6;text-align:center;padding:18px;',
          text: 'No skins available right now.',
        }));
        return;
      }

      const equipped = equippedId();

      items.forEach((item) => {
        if (!item || item.id == null) return;
        const id = item.id;
        const name = item.name || id;
        const cost = Number(item.cost) || 0;
        const isOwned = owns(id);
        const isEquipped = isOwned && equipped === id;

        const card = el('div', {
          css: 'background:rgba(255,255,255,0.04);' +
               'border:2px solid ' + (isEquipped ? 'var(--gold)' : 'rgba(255,255,255,0.10)') + ';' +
               'border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;' +
               (isEquipped ? 'box-shadow:0 0 16px rgba(255,210,63,0.4);' : ''),
        });

        // Header: name + EQUIPPED tag.
        const head = el('div', { css: 'display:flex;align-items:center;gap:10px;' });
        head.appendChild(el('div', { css: 'flex:1;min-width:0;font-weight:800;font-size:16px;', text: name }));
        if (isEquipped) {
          head.appendChild(el('span', {
            css: 'flex:none;font-size:11px;font-weight:800;color:#1a0f00;padding:2px 9px;' +
                 'border-radius:9px;background:linear-gradient(135deg,#ffd23f,#ff9d00);' +
                 'box-shadow:0 0 10px rgba(255,210,63,0.55);',
            text: 'EQUIPPED',
          }));
        } else if (isOwned) {
          head.appendChild(el('span', {
            css: 'flex:none;font-size:11px;font-weight:700;color:#cfc9e6;padding:2px 9px;' +
                 'border-radius:9px;background:rgba(255,255,255,0.08);',
            text: 'OWNED',
          }));
        }
        card.appendChild(head);

        // Color-swatch preview row (suit + accent + skin tone).
        const swatches = el('div', { className: 'chip-options', css: 'gap:8px;justify-content:flex-start;margin:0;align-items:center;' });
        swatches.appendChild(swatch(item.suit, 'Suit'));
        swatches.appendChild(swatch(item.accent, 'Accent'));
        swatches.appendChild(swatch(item.skin, 'Skin tone'));
        swatches.appendChild(el('span', {
          css: 'font-size:11px;letter-spacing:0.5px;color:#8a85a8;margin-left:2px;',
          text: 'suit · accent · skin',
        }));
        card.appendChild(swatches);

        // Footer: price chip + action button.
        const footer = el('div', {
          css: 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;',
        });
        footer.appendChild(el('span', {
          className: 'chip',
          css: 'color:var(--gold);font-weight:800;',
          text: cost > 0 ? ('🪙 ' + fmt(cost)) : 'Free',
        }));

        const btn = el('button', { className: 'btn-small' });

        if (isEquipped) {
          // Equipped -> disabled / active style.
          btn.textContent = 'EQUIPPED';
          btn.disabled = true;
          btn.style.opacity = '0.65';
          btn.style.cursor = 'default';
          btn.classList.add('btn-ghost');
        } else if (isOwned) {
          // Owned but not equipped -> EQUIP.
          btn.textContent = 'EQUIP';
          btn.addEventListener('click', () => safe(() => {
            safe(() => { if (Economy && typeof Economy.equipSkin === 'function') Economy.equipSkin(id); });
            dispatchSkinChange();
            toast('Equipped ' + name, 'good');
            render();
          }));
        } else {
          // Not owned -> BUY (cost).
          btn.textContent = 'BUY (' + (cost > 0 ? fmt(cost) : '0') + ')';
          const canBuy = affordable(cost);
          if (!canBuy) {
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Not enough coins';
          }
          btn.addEventListener('click', () => safe(() => {
            if (!affordable(cost)) { toast('Not enough coins', 'bad'); render(); return; }
            const res = safe(() => (Economy && typeof Economy.buySkin === 'function')
              ? Economy.buySkin(id, cost) : { ok: false });
            if (res && res.ok) {
              // buySkin also equips the new skin.
              dispatchSkinChange();
              toast('Bought ' + name + '!', 'good');
            } else {
              toast('Not enough coins', 'bad');
            }
            render();
          }));
        }

        footer.appendChild(btn);
        card.appendChild(footer);

        grid.appendChild(card);
      });
    });

    render();
    openModal(modal);
  });
}

// =============================================================
// getSkinColors(skinId) -> { suit, accent, skin }
// Resolves a skin's colors, falling back to High Roller.
// =============================================================
export function getSkinColors(skinId) {
  const def = skinDef(skinId);
  return {
    suit: (def && def.suit != null) ? def.suit : FALLBACK_SKIN.suit,
    accent: (def && def.accent != null) ? def.accent : FALLBACK_SKIN.accent,
    skin: (def && def.skin != null) ? def.skin : FALLBACK_SKIN.skin,
  };
}

// =============================================================
// applySkinToHumanoid(humanoidApi, skinId)
// Recolor a humanoid built by characters.buildHumanoid() to the
// given skin. Defensive: guards a missing api / recolor method and
// falls back to High Roller for unknown ids.
// =============================================================
export function applySkinToHumanoid(humanoidApi, skinId) {
  return safe(() => {
    if (!humanoidApi || typeof humanoidApi.recolor !== 'function') return;
    const colors = getSkinColors(skinId);
    humanoidApi.recolor({ suit: colors.suit, accent: colors.accent, skin: colors.skin });
  });
}

// Expose on window for debugging / cross-module access (harmless).
if (typeof window !== 'undefined') {
  window.openSkinShop = openSkinShop;
}

// Reference THREE so linters/bundlers don't flag the import as unused.
// (No-op; DOM-only module.) void avoids any side effects.
void THREE;
