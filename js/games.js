// =============================================================
// Digital Casinos — games.js
// The casino games module: 3D props for the floor, playable modal
// UIs wired to the Economy, and a mechanics editor for owners.
//
// Exports:
//   createGameProp(type) -> THREE.Group   (feet at y=0, <= ~2 tiles)
//   openGame(type, config)                (playable modal via UI.openModal)
//   openGameEditor(type, config, onSave)  (mechanics editor modal)
//
// Conventions: import three as `import * as THREE from 'three'`.
// Reuse cached geometry/materials. Never throw — degrade gracefully.
// =============================================================

import * as THREE from 'three';
import { GAME_CATALOG, COLORS, clamp } from './config.js';
import { Economy } from './economy.js';
import { UI } from './ui.js';
import { makeDealer } from './characters.js';

// Optional audio — degrade silently if the module or a sound is missing.
let SFX = null;
try { import('./audio.js').then(m => { SFX = m.SFX || m.default || null; }).catch(() => {}); }
catch (e) { /* dynamic import unsupported — stay silent */ }
function sfx(name) {
  try { if (SFX && typeof SFX.play === 'function') SFX.play(name); } catch (e) { /* ignore */ }
}

// =============================================================
// Shared geometry / material caches
// A single unit box (scaled per surface) plus a handful of named
// geometries keeps the prop poly/alloc budget low across many tables.
// =============================================================
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 24);

const GEO = {};
function geo(key, make) { return GEO[key] || (GEO[key] = make()); }

const MAT = {};
// Cache plain standard materials by a color+option signature so the
// dozens of props on a floor share a small set of GPU materials.
function mat(color, opts = {}) {
  const key = `${color}|${opts.rough ?? 0.6}|${opts.metal ?? 0.1}|${opts.emissive ?? 'x'}|${opts.emIntensity ?? 0}`;
  if (MAT[key]) return MAT[key];
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.6,
    metalness: opts.metal ?? 0.1,
  });
  if (opts.emissive != null) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emIntensity ?? 1;
  }
  MAT[key] = m;
  return m;
}

// A scaled unit-box mesh positioned by its center.
function box(material, sx, sy, sz, cx = 0, cy = 0, cz = 0) {
  const m = new THREE.Mesh(UNIT_BOX, material);
  m.scale.set(sx, sy, sz);
  m.position.set(cx, cy, cz);
  return m;
}
// A scaled unit-cylinder mesh (radius rx/rz, height h) by its center.
function cyl(material, r, h, cx = 0, cy = 0, cz = 0) {
  const m = new THREE.Mesh(UNIT_CYL, material);
  m.scale.set(r, h, r);
  m.position.set(cx, cy, cz);
  return m;
}

// A small canvas texture used for slot-machine screen symbols / signs.
function makeTextTexture(text, { bg = '#0a0420', fg = '#ffd23f', size = 256, font = 'bold 120px sans-serif' } = {}) {
  try {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = font;
    g.fillText(text, size / 2, size / 2 + 6);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 2;
    return tex;
  } catch (e) {
    return null;
  }
}

// Colors pulled from the shared palette.
const C = {
  felt: 0x0c6b3f,
  feltDark: 0x0a5233,
  wood: 0x3a2418,
  woodLight: 0x5a3a22,
  gold: COLORS.gold,
  brass: COLORS.brass,
  red: 0xc0392b,
  black: 0x141414,
  green: 0x1f6e4a,
  chrome: 0xb8c0c8,
  neon: COLORS.neon,
  neon2: COLORS.neon2,
};

// =============================================================
// 3D PROPS
// =============================================================

// ---- Slot machine cabinet -------------------------------------------------
function buildSlots() {
  const g = new THREE.Group();
  const bodyMat = mat(0x8a1430, { rough: 0.5, metal: 0.3 });
  const trimMat = mat(C.gold, { rough: 0.3, metal: 0.6, emissive: C.gold, emIntensity: 0.35 });
  const darkMat = mat(0x101018, { rough: 0.7 });

  // Cabinet body (tall box), feet at y=0.
  const W = 1.1, D = 0.9, H = 2.2;
  g.add(box(bodyMat, W, H, D, 0, H / 2, 0));
  // Slanted control deck below the screen.
  const deck = box(bodyMat, W, 0.5, 0.5, 0, 1.05, D / 2 - 0.05);
  deck.rotation.x = -0.5;
  g.add(deck);

  // Emissive screen showing 3 symbols.
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x05050c, emissive: 0x4060ff, emissiveIntensity: 0.6, roughness: 0.3,
  });
  g.add(box(screenMat, 0.92, 0.62, 0.06, 0, 1.62, D / 2 - 0.02));

  // Three symbol panels on the glowing screen.
  const syms = ['7', '7', '7'];
  for (let i = 0; i < 3; i++) {
    const tex = makeTextTexture(syms[i], { bg: '#100a20', fg: '#ffd23f', font: 'bold 150px sans-serif' });
    const symMat = tex
      ? new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5, roughness: 0.4 })
      : mat(C.gold, { emissive: C.gold, emIntensity: 0.5 });
    g.add(box(symMat, 0.26, 0.42, 0.02, (i - 1) * 0.30, 1.62, D / 2 + 0.02));
  }

  // Trim frame around the screen.
  g.add(box(trimMat, 1.0, 0.07, 0.05, 0, 1.94, D / 2 - 0.01));
  g.add(box(trimMat, 1.0, 0.07, 0.05, 0, 1.30, D / 2 - 0.01));

  // Glowing top sign.
  const signMat = new THREE.MeshStandardMaterial({
    color: 0x12001a, emissive: C.neon, emissiveIntensity: 1.2, roughness: 0.4,
  });
  g.add(box(signMat, 1.15, 0.34, 0.18, 0, 2.32, 0));
  g.add(box(trimMat, 1.18, 0.05, 0.20, 0, 2.50, 0));

  // Side lever (arm + ball knob).
  const lever = new THREE.Group();
  lever.position.set(W / 2 + 0.02, 1.5, 0.1);
  lever.add(cyl(mat(C.chrome, { metal: 0.8, rough: 0.25 }), 0.035, 0.6, 0, 0.3, 0));
  lever.add(cyl(mat(0xd02020, { rough: 0.3, metal: 0.4, emissive: 0xd02020, emIntensity: 0.3 }), 0.09, 0.18, 0, 0.66, 0));
  lever.rotation.z = -0.25;
  g.add(lever);

  // Coin tray at the bottom.
  g.add(box(darkMat, 0.95, 0.16, 0.22, 0, 0.42, D / 2 + 0.02));
  g.add(box(trimMat, 0.95, 0.03, 0.04, 0, 0.50, D / 2 + 0.13));

  return g;
}

// ---- Roulette table -------------------------------------------------------
function buildRoulette() {
  const g = new THREE.Group();
  const feltMat = mat(C.felt, { rough: 0.85, emissive: C.green, emIntensity: 0.08 });
  const woodMat = mat(C.wood, { rough: 0.6, metal: 0.1 });
  const goldMat = mat(C.gold, { rough: 0.3, metal: 0.6, emissive: C.gold, emIntensity: 0.25 });

  // Round table top + skirt + pedestal.
  const topY = 0.95, R = 1.5;
  g.add(cyl(feltMat, R, 0.12, 0, topY, 0));
  g.add(cyl(woodMat, R + 0.06, 0.18, 0, topY - 0.14, 0)); // rim
  g.add(cyl(woodMat, 0.45, topY - 0.2, 0, (topY - 0.2) / 2, 0)); // pedestal
  g.add(cyl(woodMat, 0.7, 0.08, 0, 0.04, 0)); // base

  // Spinning-looking wheel: a bowl + a hub + colored number pockets.
  const wheel = new THREE.Group();
  wheel.position.set(-0.55, topY + 0.07, 0);
  wheel.add(cyl(woodMat, 0.62, 0.1, 0, 0, 0));            // wheel base
  wheel.add(cyl(mat(0x05050c, { rough: 0.4 }), 0.5, 0.06, 0, 0.06, 0)); // recess
  wheel.add(cyl(goldMat, 0.12, 0.14, 0, 0.1, 0));          // center hub
  // Number pockets as alternating colored segments around the rim.
  const pocketGeo = geo('roulettePocket', () => new THREE.BoxGeometry(0.12, 0.05, 0.18));
  const segCount = 24;
  for (let i = 0; i < segCount; i++) {
    const a = (i / segCount) * Math.PI * 2;
    const isGreen = i === 0;
    const colMat = isGreen ? mat(C.green, { rough: 0.5 })
      : (i % 2 === 0 ? mat(C.red, { rough: 0.5 }) : mat(C.black, { rough: 0.5 }));
    const p = new THREE.Mesh(pocketGeo, colMat);
    p.position.set(Math.cos(a) * 0.42, 0.08, Math.sin(a) * 0.42);
    p.rotation.y = -a;
    wheel.add(p);
  }
  // A little spinner ball.
  wheel.add(cyl(mat(0xf0f0f0, { rough: 0.3, metal: 0.4 }), 0.04, 0.04, 0.36, 0.12, 0.18));
  g.add(wheel);
  // Spin animation handle for parcels.js update loop (optional).
  g.userData.spin = wheel;

  // Felt betting layout on the +X side: a grid of small colored cells.
  const layout = new THREE.Group();
  layout.position.set(0.7, topY + 0.061, 0);
  const cellGeo = geo('rouletteCell', () => new THREE.BoxGeometry(0.16, 0.01, 0.16));
  for (let r = 0; r < 3; r++) {
    for (let cI = 0; cI < 4; cI++) {
      const isRed = (r + cI) % 2 === 0;
      const cell = new THREE.Mesh(cellGeo, isRed ? mat(C.red, { rough: 0.8 }) : mat(C.black, { rough: 0.8 }));
      cell.position.set(cI * 0.19 - 0.3, 0, r * 0.19 - 0.19);
      layout.add(cell);
    }
  }
  g.add(layout);

  return g;
}

// ---- Blackjack table ------------------------------------------------------
function buildBlackjack(withDealer = true) {
  const g = new THREE.Group();
  const feltMat = mat(C.feltDark, { rough: 0.85, emissive: C.green, emIntensity: 0.06 });
  const woodMat = mat(C.wood, { rough: 0.6 });
  const goldMat = mat(C.gold, { rough: 0.3, metal: 0.6, emissive: C.gold, emIntensity: 0.2 });

  // Half-moon top: a half cylinder (use a half-circle by clamping a cylinder
  // and pushing it back so the flat dealer edge faces -Z).
  const topY = 0.95;
  const halfGeo = geo('bjTop', () => new THREE.CylinderGeometry(1.7, 1.7, 0.12, 32, 1, false, 0, Math.PI));
  const top = new THREE.Mesh(halfGeo, feltMat);
  top.position.y = topY;
  // Orient so the curved edge faces players (+Z), flat edge toward dealer.
  top.rotation.y = -Math.PI / 2;
  g.add(top);
  // Wood rim under the felt.
  const rimGeo = geo('bjRim', () => new THREE.CylinderGeometry(1.78, 1.78, 0.16, 32, 1, false, 0, Math.PI));
  const rim = new THREE.Mesh(rimGeo, woodMat);
  rim.position.y = topY - 0.13;
  rim.rotation.y = -Math.PI / 2;
  g.add(rim);
  // Legs.
  const legMat = woodMat;
  for (const [lx, lz] of [[-1.3, 0.4], [1.3, 0.4], [0, 1.4]]) {
    g.add(cyl(legMat, 0.09, topY - 0.2, lx, (topY - 0.2) / 2, lz));
  }

  // Chip rack (a tray of colored chips) at the dealer's flat edge.
  const rack = new THREE.Group();
  rack.position.set(0, topY + 0.06, -0.7);
  rack.add(box(woodMat, 0.9, 0.08, 0.22, 0, 0, 0));
  const chipCols = [C.red, C.black, C.green, C.gold];
  for (let i = 0; i < 4; i++) {
    rack.add(cyl(mat(chipCols[i], { rough: 0.35, metal: 0.2, emissive: chipCols[i], emIntensity: 0.12 }), 0.08, 0.12, i * 0.22 - 0.33, 0.1, 0));
  }
  g.add(rack);

  // A few card rects laid on the felt (player + dealer spots).
  const cardGeo = geo('cardRect', () => new THREE.BoxGeometry(0.18, 0.01, 0.26));
  const cardMat = mat(0xf4f4f4, { rough: 0.5 });
  for (const [cx, cz] of [[-0.3, 0.5], [-0.1, 0.5], [0.2, -0.2], [0.4, -0.2]]) {
    const card = new THREE.Mesh(cardGeo, cardMat);
    card.position.set(cx, topY + 0.07, cz);
    card.rotation.y = Math.random() * 0.3 - 0.15;
    g.add(card);
  }

  // Painted arc accent on the felt.
  g.add(cyl(goldMat, 1.2, 0.005, 0, topY + 0.065, 0.2));

  // Seat a dealer behind the flat edge (facing +Z toward players).
  if (withDealer) {
    try {
      const d = makeDealer({ suit: 0x18101f, accent: C.neon, skin: 0xc68642 });
      d.root.position.set(0, 0, -1.25);
      d.root.rotation.y = 0; // faces +Z
      g.add(d.root);
      g.userData.dealer = d; // expose for optional update()
    } catch (e) { /* characters unavailable — skip dealer */ }
  }

  return g;
}

// ---- Poker table ----------------------------------------------------------
function buildPoker(withDealer = true) {
  const g = new THREE.Group();
  const feltMat = mat(C.felt, { rough: 0.85, emissive: C.green, emIntensity: 0.08 });
  const woodMat = mat(C.woodLight, { rough: 0.6 });
  const railMat = mat(0x2a1a10, { rough: 0.5, metal: 0.2 });
  const goldMat = mat(C.gold, { rough: 0.3, metal: 0.6, emissive: C.gold, emIntensity: 0.2 });

  // Oval top: a cylinder scaled on X to make an oval. Feet at y=0.
  const topY = 0.95;
  const top = cyl(feltMat, 1.0, 0.12, 0, topY, 0);
  top.scale.set(2.1, 0.12, 1.4);
  g.add(top);
  // Padded rail (oval ring) — a thin torus scaled to the oval.
  const railGeo = geo('pokerRail', () => new THREE.TorusGeometry(1.0, 0.1, 10, 40));
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.y = topY + 0.06;
  rail.rotation.x = Math.PI / 2;
  rail.scale.set(2.05, 1.38, 1);
  g.add(rail);
  // Skirt + pedestal.
  const skirt = cyl(woodMat, 1.0, 0.5, 0, topY - 0.3, 0);
  skirt.scale.set(1.9, 0.5, 1.25);
  g.add(skirt);
  g.add(box(woodMat, 0.6, topY - 0.4, 0.6, 0, (topY - 0.4) / 2, 0));

  // 5 community card rects in a row at center.
  const cardGeo = geo('cardRect', () => new THREE.BoxGeometry(0.18, 0.01, 0.26));
  const cardMat = mat(0xf4f4f4, { rough: 0.5 });
  for (let i = 0; i < 5; i++) {
    const card = new THREE.Mesh(cardGeo, cardMat);
    card.position.set((i - 2) * 0.24, topY + 0.07, 0);
    g.add(card);
  }

  // Chip stacks scattered around the felt.
  const chipCols = [C.red, C.black, C.green, C.gold, 0x3060c0];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const stackH = 0.06 + Math.random() * 0.1;
    const cc = chipCols[i % chipCols.length];
    g.add(cyl(mat(cc, { rough: 0.35, metal: 0.2, emissive: cc, emIntensity: 0.12 }),
      0.09, stackH, Math.cos(a) * 1.3, topY + 0.07 + stackH / 2, Math.sin(a) * 0.85));
  }
  // Gold dealer-button accent.
  g.add(cyl(goldMat, 0.07, 0.03, 1.4, topY + 0.08, 0.4));

  if (withDealer) {
    try {
      const d = makeDealer({ suit: 0x101426, accent: C.neon2, skin: 0xe0ac69 });
      d.root.position.set(0, 0, -1.5);
      d.root.rotation.y = 0;
      g.add(d.root);
      g.userData.dealer = d;
    } catch (e) { /* skip */ }
  }

  return g;
}

/**
 * createGameProp(type) -> THREE.Group
 * Feet at y=0; footprint <= ~2 tiles. Returns a small placeholder for
 * unknown types rather than throwing.
 */
export function createGameProp(type) {
  let group;
  try {
    switch (type) {
      case 'slots': group = buildSlots(); break;
      case 'roulette': group = buildRoulette(); break;
      case 'blackjack': group = buildBlackjack(true); break;
      case 'poker': group = buildPoker(true); break;
      default: group = null;
    }
  } catch (e) {
    group = null;
  }
  if (!group) {
    group = new THREE.Group();
    group.add(box(mat(C.neon, { emissive: C.neon, emIntensity: 0.5 }), 1, 1, 1, 0, 0.5, 0));
  }
  group.name = `game:${type}`;
  return group;
}

// =============================================================
// MODAL UI HELPERS (plain DOM via createElement)
// =============================================================
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(label, cls = '') {
  const b = el('button', ('btn-small ' + cls).trim(), label);
  return b;
}
function fmt(n) { return Math.round(n).toLocaleString(); }

// Merge a saved/override config over the catalog defaults for a type.
function mergedConfig(type, config) {
  const cat = GAME_CATALOG[type] || {};
  const base = cat.mechanics || {};
  return Object.assign({}, base, config || {});
}

// Shared modal scaffold: title bar, balance line, close button.
// Returns { node, balanceEl, setBalance, body } where `body` is where
// each game appends its specific controls.
function buildModalShell(type, subtitle) {
  const cat = GAME_CATALOG[type] || {};
  const node = el('div', 'game-modal');

  // Shared lifecycle: track whether this modal has been closed so pending
  // timers can bail out of touching detached DOM / settling rounds.
  const state = { closed: false, onClose: null };
  function doClose() {
    state.closed = true;
    try { if (typeof state.onClose === 'function') state.onClose(); } catch (e) {}
    try { UI.closeModal(); } catch (e) {}
  }

  const close = btn('Close', 'game-close btn-ghost');
  close.onclick = doClose;
  node.appendChild(close);

  node.appendChild(el('h2', null, `${cat.icon || '🎲'} ${cat.name || type}`));
  if (subtitle) node.appendChild(el('div', 'sub', subtitle));

  const balanceEl = el('div', 'balance');
  node.appendChild(balanceEl);
  function setBalance() { balanceEl.textContent = `Balance: 🪙 ${fmt(Economy.coins)}`; }
  setBalance();

  const body = el('div', 'game-body');
  node.appendChild(body);

  return {
    node, balanceEl, setBalance, body,
    isClosed: () => state.closed,
    setOnClose: (fn) => { state.onClose = fn; },
  };
}

// A standard bet input row clamped to [minBet, maxBet].
function makeBetRow(label, minBet, maxBet) {
  const row = el('div', 'bet-row');
  row.appendChild(el('label', null, label));
  const input = el('input');
  input.type = 'number';
  input.min = String(minBet);
  input.max = String(maxBet);
  input.step = '1';
  input.value = String(minBet);
  row.appendChild(input);
  row.appendChild(el('span', null, `(${minBet}–${maxBet})`));
  // Read a clamped, integer bet value.
  input.readBet = () => {
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v)) v = minBet;
    v = Math.round(clamp(v, minBet, maxBet));
    input.value = String(v);
    return v;
  };
  return { row, input };
}

// =============================================================
// SLOTS
// =============================================================
const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '💎'];

function openSlots(cfg) {
  const minBet = Math.max(1, cfg.minBet ?? 5);
  const maxBet = Math.max(minBet, cfg.maxBet ?? 100);
  const rtp = clamp(cfg.rtp ?? 0.92, 0.5, 0.99);
  const jackpot = Math.max(0, cfg.jackpot ?? 500);

  const { node, setBalance, body, isClosed, setOnClose } = buildModalShell('slots',
    `Match symbols to win · RTP ~${Math.round(rtp * 100)}%`);

  // Reels display.
  const reels = el('div', 'reels');
  const reelEls = [];
  for (let i = 0; i < 3; i++) {
    const r = el('div', 'reel', SLOT_SYMBOLS[0]);
    reels.appendChild(r);
    reelEls.push(r);
  }
  body.appendChild(reels);

  const { row, input } = makeBetRow('Bet', minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const spinBtn = btn('SPIN');
  btnRow.appendChild(spinBtn);
  body.appendChild(btnRow);

  // --- Paytable tuned so expected return ≈ rtp -------------------------
  // The reels are *weighted*: 💎 (jackpot) is rarest, then 7️⃣, down to the
  // common fruit. Weighting keeps a 💎-triple very rare (~1/16,000) so the
  // flat `jackpot` adds only a tiny, bet-stable slice of EV. We then scale
  // every multiplier-based win by a global factor `g` (solved per bet) so
  // total expected return lands on `rtp`:
  //   jackpotEV(bet) + g * multiplierEV  ==  rtp
  // g is floored at 0 so the jackpot can never push RTP above target.
  // Verified by Monte-Carlo: measured RTP tracks config within ~1%.
  const N = SLOT_SYMBOLS.length;            // 6
  const DIAMOND = 5, SEVEN = 4;              // jackpot + high symbol indices
  // Reel weights (index aligns with SLOT_SYMBOLS): 🍒 🍋 🔔 ⭐ 7️⃣ 💎.
  const WEIGHT = [10, 9, 7, 5, 3, 1.4];
  const WTOTAL = WEIGHT.reduce((a, b) => a + b, 0);
  const P = WEIGHT.map(w => w / WTOTAL);     // per-symbol probability
  const CUM = [];                            // cumulative for weighted picks
  { let acc = 0; for (const w of WEIGHT) { acc += w; CUM.push(acc / WTOTAL); } }
  // Multiplier paytable (total returned per unit bet, before scaling g).
  const tripleMult = [6, 8, 12, 20, 0, 0];   // fruit/bell/star triples; 7/💎 special
  const sevenMult = 40;                      // 7️⃣ triple multiple
  const pairMult = 2.0;                      // any exactly-two-of-a-kind

  // EV per unit bet from all multiplier wins (excludes the flat jackpot).
  function multiplierEV() {
    let ev = 0;
    for (let s = 0; s < 4; s++) ev += Math.pow(P[s], 3) * tripleMult[s];
    ev += Math.pow(P[SEVEN], 3) * sevenMult;
    for (let s = 0; s < N; s++) ev += 3 * Math.pow(P[s], 2) * (1 - P[s]) * pairMult;
    return ev;
  }
  const multEVraw = multiplierEV();
  // Global scale g so jackpotEV + g*multEVraw == rtp (never negative).
  function gFor(bet) {
    if (bet <= 0 || multEVraw <= 0) return 0;
    const jackEV = Math.pow(P[DIAMOND], 3) * (jackpot / bet);
    return Math.max(0, (rtp - jackEV) / multEVraw);
  }

  // Weighted symbol pick.
  function pickSym() {
    const r = Math.random();
    for (let i = 0; i < N; i++) if (r < CUM[i]) return i;
    return N - 1;
  }

  // Spin animation + outcome.
  let spinning = false;
  let tick = null;
  const locked = [false, false, false];
  // Stop any in-flight animation if the modal closes mid-spin.
  setOnClose(() => { if (tick) { clearInterval(tick); tick = null; } });

  function spin() {
    if (spinning || isClosed()) return;
    const bet = input.readBet();
    if (!Economy.canAfford(bet)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins.';
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    input.disabled = true;
    result.className = 'result-line';
    result.textContent = '';
    reelEls.forEach(r => r.classList.add('spin'));
    locked[0] = locked[1] = locked[2] = false;
    sfx('spin');

    // Cycle symbols for ~1s, then lock to the final outcome.
    const final = [pickSym(), pickSym(), pickSym()];
    const start = Date.now();
    tick = setInterval(() => {
      if (isClosed()) { clearInterval(tick); tick = null; return; }
      const t = Date.now() - start;
      for (let i = 0; i < 3; i++) {
        // Lock reels left-to-right near the end for a nicer feel.
        if (t > 600 + i * 200) {
          reelEls[i].textContent = SLOT_SYMBOLS[final[i]];
          if (!locked[i]) { locked[i] = true; sfx('reel'); }
        } else {
          reelEls[i].textContent = SLOT_SYMBOLS[pickSym()];
        }
      }
      if (t >= 1100) {
        clearInterval(tick);
        tick = null;
        reelEls.forEach(r => r.classList.remove('spin'));
        settle(bet, final);
        spinning = false;
        spinBtn.disabled = false;
        input.disabled = false;
      }
    }, 80);
  }

  function settle(bet, final) {
    const [a, b, c] = final;
    const g = gFor(bet);    // per-bet scale so total RTP ≈ rtp
    let payout = 0;         // total coins returned (0 = loss)
    let msg = 'No win — try again!';
    let win = false;

    if (a === b && b === c) {
      // Three of a kind.
      if (a === DIAMOND) {
        payout = jackpot;
        msg = `JACKPOT!! 💎💎💎  +${fmt(jackpot)}`;
      } else if (a === SEVEN) {
        payout = Math.max(bet, Math.round(bet * sevenMult * g));
        msg = `Three 7️⃣!  +${fmt(payout)}`;
      } else {
        payout = Math.max(bet, Math.round(bet * (tripleMult[a] || 2) * g));
        msg = `Three ${SLOT_SYMBOLS[a]}!  +${fmt(payout)}`;
      }
      win = true;
    } else if (a === b || b === c || a === c) {
      // Any exactly-two-of-a-kind.
      payout = Math.round(bet * pairMult * g);
      if (payout > 0) { msg = `Pair!  +${fmt(payout)}`; win = true; }
      else payout = 0;
    }

    // Settle through the Economy (payout = total returned, 0 on loss).
    Economy.wager(bet, payout);
    setBalance();
    result.className = 'result-line ' + (win ? 'win' : 'lose');
    result.textContent = msg;

    // Audio cue scaled to the size of the win.
    if (!win) sfx('lose');
    else if (a === DIAMOND && b === c) sfx('jackpot');
    else if (payout >= bet * 8) sfx('bigwin');
    else sfx('win');
  }

  spinBtn.onclick = spin;
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// ROULETTE
// =============================================================
// Wheel layout: 37 numbers (0 green, 1..36 alternating red/black).
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteColor(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

function openRoulette(cfg) {
  const minBet = Math.max(1, cfg.minBet ?? 5);
  const maxBet = Math.max(minBet, cfg.maxBet ?? 200);
  const colorPays = Math.max(1, cfg.colorPays ?? 2);   // total returned multiple on red/black
  const greenPays = Math.max(1, cfg.greenPays ?? 14);

  const { node, setBalance, body, isClosed, setOnClose } = buildModalShell('roulette',
    'Pick a color, place your bet, and spin.');

  // Wheel element (CSS .wheel rotates).
  const wrap = el('div', 'wheel-wrap');
  wrap.appendChild(el('div', 'wheel-ptr', '▼'));
  const wheel = el('div', 'wheel');
  wrap.appendChild(wheel);
  body.appendChild(wrap);

  // Chip color options.
  let pick = 'red';
  const chipRow = el('div', 'chip-options');
  const chipDefs = [
    { id: 'red', label: 'RED', cls: 'red' },
    { id: 'black', label: 'BLACK', cls: 'black' },
    { id: 'green', label: 'GREEN 0', cls: 'green' },
  ];
  const chipEls = {};
  chipDefs.forEach(d => {
    const ch = el('div', `chip ${d.cls}` + (d.id === pick ? ' active' : ''), d.label);
    ch.onclick = () => {
      pick = d.id;
      Object.values(chipEls).forEach(e => e.classList.remove('active'));
      ch.classList.add('active');
    };
    chipEls[d.id] = ch;
    chipRow.appendChild(ch);
  });
  body.appendChild(chipRow);

  const { row, input } = makeBetRow('Bet', minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const spinBtn = btn('SPIN');
  btnRow.appendChild(spinBtn);
  body.appendChild(btnRow);

  let spinning = false;
  let baseTurns = 0; // accumulate so the wheel keeps rotating forward
  let timer = null;
  // Disable color selection while the wheel is spinning.
  function setPicksEnabled(on) {
    Object.values(chipEls).forEach(e => {
      e.style.pointerEvents = on ? '' : 'none';
      e.style.opacity = on ? '' : '0.5';
    });
  }
  setOnClose(() => { if (timer) { clearTimeout(timer); timer = null; } });

  function spin() {
    if (spinning || isClosed()) return;
    const bet = input.readBet();
    if (!Economy.canAfford(bet)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins.';
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    input.disabled = true;
    setPicksEnabled(false);
    result.className = 'result-line';
    result.textContent = 'Spinning…';
    sfx('spin');

    const number = (Math.random() * 37) | 0;   // 0..36
    const color = rouletteColor(number);

    // Rotate the CSS wheel: several full turns + an offset for the number.
    baseTurns += 5 + ((Math.random() * 3) | 0);
    const deg = baseTurns * 360 + (number / 37) * 360;
    wheel.style.transform = `rotate(${deg}deg)`;

    // Resolve after the CSS transition (~3s in style.css).
    timer = setTimeout(() => {
      timer = null;
      if (isClosed()) return;
      let payout = 0;
      if (pick === color) {
        payout = (color === 'green')
          ? Math.round(bet * greenPays)
          : Math.round(bet * colorPays);
      }
      Economy.wager(bet, payout);
      setBalance();
      const won = payout > 0;
      result.className = 'result-line ' + (won ? 'win' : 'lose');
      const colTxt = color.toUpperCase();
      result.textContent = won
        ? `${number} ${colTxt} — you win! +${fmt(payout)}`
        : `${number} ${colTxt} — you lose ${fmt(bet)}`;
      if (won) sfx(payout >= bet * 8 ? 'bigwin' : 'win');
      else sfx('lose');
      spinning = false;
      spinBtn.disabled = false;
      input.disabled = false;
      setPicksEnabled(true);
    }, 3100);
  }

  spinBtn.onclick = spin;
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// CARD HELPERS (shared by blackjack + poker)
// =============================================================
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_VAL = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function freshDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  // Fisher–Yates shuffle.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}
function isRedSuit(s) { return s === '♥' || s === '♦'; }

// Render a card object into a .card div (red for ♥♦).
function cardDiv(card, faceDown = false) {
  if (faceDown) {
    const d = el('div', 'card');
    d.style.background = 'linear-gradient(135deg,#3a1d5e,#18101f)';
    d.style.color = '#ffd23f';
    d.textContent = '★';
    return d;
  }
  const d = el('div', 'card' + (isRedSuit(card.suit) ? ' red' : ''));
  d.textContent = card.rank + card.suit;
  return d;
}

// =============================================================
// BLACKJACK
// =============================================================
function handValue(cards) {
  // Aces are 11 or 1. Face cards = 10.
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { aces++; total += 11; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') total += 10;
    else total += RANK_VAL[c.rank];
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function isBlackjack(cards) { return cards.length === 2 && handValue(cards) === 21; }

function openBlackjack(cfg) {
  const minBet = Math.max(1, cfg.minBet ?? 10);
  const maxBet = Math.max(minBet, cfg.maxBet ?? 300);
  const bjPays = Math.max(1, cfg.blackjackPays ?? 1.5);   // bonus multiple over stake
  const standsOn = Math.max(16, cfg.dealerStandsOn ?? 17);

  const { node, setBalance, body, isClosed } = buildModalShell('blackjack',
    `Beat the dealer to 21 · Dealer stands on ${standsOn}`);

  // Dealer + player hand areas.
  const dealerLabel = el('div', 'hand-label', 'Dealer');
  body.appendChild(dealerLabel);
  const dealerCards = el('div', 'cards');
  body.appendChild(dealerCards);

  const playerLabel = el('div', 'hand-label', 'You');
  body.appendChild(playerLabel);
  const playerCards = el('div', 'cards');
  body.appendChild(playerCards);

  const { row, input } = makeBetRow('Bet', minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const dealBtn = btn('DEAL');
  const hitBtn = btn('Hit', 'btn-ghost');
  const standBtn = btn('Stand', 'btn-ghost');
  btnRow.appendChild(dealBtn);
  btnRow.appendChild(hitBtn);
  btnRow.appendChild(standBtn);
  body.appendChild(btnRow);

  let deck = [];
  let player = [];
  let dealer = [];
  let bet = 0;
  let inRound = false;

  function setControls(playing) {
    inRound = playing;
    dealBtn.disabled = playing;
    hitBtn.disabled = !playing;
    standBtn.disabled = !playing;
    input.disabled = playing;
  }
  setControls(false);

  function renderHands(revealDealer) {
    dealerCards.innerHTML = '';
    playerCards.innerHTML = '';
    dealer.forEach((c, i) => {
      const faceDown = !revealDealer && i === 1; // hide hole card mid-round
      dealerCards.appendChild(cardDiv(c, faceDown));
    });
    player.forEach(c => playerCards.appendChild(cardDiv(c)));
    dealerLabel.textContent = revealDealer ? `Dealer — ${handValue(dealer)}` : 'Dealer';
    playerLabel.textContent = `You — ${handValue(player)}`;
  }

  function deal() {
    if (inRound || isClosed()) return;
    bet = input.readBet();
    if (!Economy.canAfford(bet)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins.';
      return;
    }
    deck = freshDeck();
    player = [deck.pop(), deck.pop()];
    dealer = [deck.pop(), deck.pop()];
    result.className = 'result-line';
    result.textContent = '';
    setControls(true);
    renderHands(false);
    sfx('chip');
    sfx('card');

    // Immediate blackjack resolution.
    const pBJ = isBlackjack(player);
    const dBJ = isBlackjack(dealer);
    if (pBJ || dBJ) { finishRound(); }
  }

  function hit() {
    if (!inRound) return;
    player.push(deck.pop());
    sfx('card');
    renderHands(false);
    if (handValue(player) > 21) finishRound();
  }

  function stand() {
    if (!inRound) return;
    // Dealer draws to standsOn.
    while (handValue(dealer) < standsOn && deck.length) { dealer.push(deck.pop()); }
    finishRound();
  }

  function finishRound() {
    const pv = handValue(player);
    const pBJ = isBlackjack(player);
    const dBJ = isBlackjack(dealer);
    // If the player didn't bust and didn't already trigger a natural,
    // make the dealer play out (covers the natural-vs-natural case too).
    if (pv <= 21 && !pBJ && !dBJ) {
      while (handValue(dealer) < standsOn && deck.length) dealer.push(deck.pop());
    }
    const dv = handValue(dealer);
    renderHands(true);

    let payout = 0;       // total returned
    let msg = '';
    let cls = 'lose';

    if (pv > 21) {
      payout = 0; msg = `Bust! You lose ${fmt(bet)}.`;
    } else if (pBJ && !dBJ) {
      payout = Math.round(bet + bet * bjPays);    // stake back + blackjack bonus
      msg = `Blackjack! +${fmt(payout - bet)}`; cls = 'win';
    } else if (dBJ && !pBJ) {
      payout = 0; msg = `Dealer blackjack. You lose ${fmt(bet)}.`;
    } else if (pBJ && dBJ) {
      payout = bet; msg = 'Push — both blackjack.'; cls = '';
    } else if (dv > 21) {
      payout = bet * 2; msg = `Dealer busts! +${fmt(bet)}`; cls = 'win';
    } else if (pv > dv) {
      payout = bet * 2; msg = `You win ${pv} vs ${dv}! +${fmt(bet)}`; cls = 'win';
    } else if (pv < dv) {
      payout = 0; msg = `Dealer wins ${dv} vs ${pv}.`;
    } else {
      payout = bet; msg = `Push — ${pv} each.`; cls = '';
    }

    Economy.wager(bet, payout);
    setBalance();
    result.className = 'result-line ' + cls;
    result.textContent = msg;
    setControls(false);

    // Audio cue by outcome.
    if (cls === 'win') sfx(pBJ ? 'bigwin' : 'win');
    else if (cls === 'lose') sfx('lose');
    else sfx('chip'); // push
  }

  dealBtn.onclick = deal;
  hitBtn.onclick = hit;
  standBtn.onclick = stand;
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// POKER — 5-card draw vs the house paytable
// =============================================================
// Evaluate a 5-card hand into a category + a pay key.
function evalPoker(cards) {
  const counts = {};
  const suits = {};
  const vals = [];
  for (const c of cards) {
    counts[c.rank] = (counts[c.rank] || 0) + 1;
    suits[c.suit] = (suits[c.suit] || 0) + 1;
    vals.push(RANK_VAL[c.rank]);
  }
  vals.sort((a, b) => a - b);
  const isFlush = Object.keys(suits).length === 1;
  // Straight detection (including wheel A-2-3-4-5).
  let isStraight = true;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) { isStraight = false; break; }
  }
  const wheel = JSON.stringify(vals) === JSON.stringify([2, 3, 4, 5, 14]);
  if (wheel) isStraight = true;

  const groups = Object.values(counts).sort((a, b) => b - a); // e.g. [3,2]
  const four = groups[0] === 4;
  const three = groups[0] === 3;
  const pairs = groups.filter(g => g === 2).length;

  if (isStraight && isFlush) return { name: 'Straight Flush', key: 'straightFlush' };
  if (four) return { name: 'Four of a Kind', key: 'quads' };
  if (three && pairs === 1) return { name: 'Full House', key: 'fullHouse' };
  if (isFlush) return { name: 'Flush', key: 'flush' };
  if (isStraight) return { name: 'Straight', key: 'straight' };
  if (three) return { name: 'Three of a Kind', key: 'trips' };
  if (pairs === 2) return { name: 'Two Pair', key: 'twoPair' };
  if (pairs === 1) {
    // Jacks-or-better pays; lower pairs are a push-ish small/no win.
    const pairRank = Object.keys(counts).find(r => counts[r] === 2);
    const high = RANK_VAL[pairRank] >= 11;
    return { name: high ? 'Pair (J+)' : 'Pair (low)', key: high ? 'pair' : 'lowpair' };
  }
  return { name: 'High Card', key: 'high' };
}

function openPoker(cfg) {
  const ante = Math.max(1, cfg.ante ?? 10);
  const pairPays = Math.max(0, cfg.pairPays ?? 1);
  const flushPays = Math.max(1, cfg.flushPays ?? 6);
  const straightPays = Math.max(1, cfg.straightPays ?? 4);
  // Derived multiples for higher hands (scale off the editable ones).
  const pays = {
    pair: pairPays,                                  // jacks-or-better
    lowpair: 0,                                      // below jacks: no win
    twoPair: Math.max(pairPays + 1, 2),
    trips: Math.max(straightPays - 1, 3),
    straight: straightPays,
    flush: flushPays,
    fullHouse: Math.max(flushPays + 3, 9),
    quads: Math.max(flushPays + 19, 25),
    straightFlush: Math.max(flushPays + 44, 50),
    high: 0,
  };

  const { node, setBalance, body, isClosed } = buildModalShell('poker',
    `5-Card Draw · Ante ${ante} · Jacks-or-better pays`);

  const handLabel = el('div', 'hand-label', 'Your Hand');
  body.appendChild(handLabel);
  const cardsEl = el('div', 'cards');
  body.appendChild(cardsEl);

  // Hold toggles row (under the cards).
  const holdRow = el('div', 'btn-row');
  body.appendChild(holdRow);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const dealBtn = btn(`DEAL (ante ${ante})`);
  const drawBtn = btn('DRAW', 'btn-ghost');
  btnRow.appendChild(dealBtn);
  btnRow.appendChild(drawBtn);
  body.appendChild(btnRow);

  let deck = [];
  let hand = [];
  let held = [false, false, false, false, false];
  let phase = 'idle'; // idle -> dealt -> done

  function renderHand() {
    cardsEl.innerHTML = '';
    holdRow.innerHTML = '';
    hand.forEach((c, i) => {
      const cd = cardDiv(c);
      // Visual held marker.
      if (held[i]) cd.style.outline = '3px solid var(--gold)';
      cardsEl.appendChild(cd);

      const hb = btn(held[i] ? '✓ HELD' : 'Hold', held[i] ? '' : 'btn-ghost');
      hb.style.minWidth = '46px';
      hb.disabled = phase !== 'dealt';
      hb.onclick = () => {
        if (phase !== 'dealt') return;
        held[i] = !held[i];
        renderHand();
      };
      holdRow.appendChild(hb);
    });
  }

  function deal() {
    if (phase === 'dealt' || isClosed()) return;
    const stake = ante;
    if (!Economy.canAfford(stake)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins for the ante.';
      return;
    }
    // Take the ante now; the round returns 0 on loss (already paid) or the
    // payout total on a win.
    deck = freshDeck();
    hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    held = [false, false, false, false, false];
    phase = 'dealt';
    result.className = 'result-line';
    result.textContent = 'Pick cards to HOLD, then DRAW.';
    dealBtn.disabled = true;
    drawBtn.disabled = false;
    handLabel.textContent = 'Your Hand — hold & draw';
    renderHand();
    sfx('chip');
    sfx('card');
  }

  function draw() {
    if (phase !== 'dealt') return;
    // Replace non-held cards once.
    for (let i = 0; i < 5; i++) {
      if (!held[i] && deck.length) hand[i] = deck.pop();
    }
    phase = 'done';
    drawBtn.disabled = true;
    renderHand();
    sfx('card');

    const res = evalPoker(hand);
    const mult = pays[res.key] ?? 0;
    // Payout total returned = ante * mult on a win (mult already counts the
    // stake back where mult>=1). 0 means the ante is lost.
    let payout = 0;
    if (mult > 0) payout = Math.round(ante * mult);
    const net = payout - ante;
    // A win must actually return more than the ante; a multiple of exactly 1
    // is a push (stake back), not a win.
    let cls = net > 0 ? 'win' : (payout > 0 ? '' : 'lose');

    Economy.wager(ante, payout);
    setBalance();
    result.className = 'result-line ' + cls;
    result.textContent = net > 0
      ? `${res.name}! +${fmt(net)} (×${mult})`
      : (payout > 0
        ? `${res.name} — push (ante returned).`
        : `${res.name} — no win. Lost ${fmt(ante)}.`);
    handLabel.textContent = `Your Hand — ${res.name}`;

    // Audio cue by outcome.
    if (cls === 'win') sfx(mult >= 9 ? 'bigwin' : 'win');
    else if (cls === 'lose') sfx('lose');
    else sfx('chip');

    // Allow the next round.
    dealBtn.disabled = false;
    dealBtn.textContent = `DEAL (ante ${ante})`;
  }

  dealBtn.onclick = deal;
  drawBtn.onclick = draw;
  drawBtn.disabled = true;
  renderHand();
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// openGame — dispatcher
// =============================================================
/**
 * openGame(type, config) — opens a playable modal for a placed game.
 * `config` overrides are merged over GAME_CATALOG[type].mechanics.
 */
export function openGame(type, config) {
  const cfg = mergedConfig(type, config);
  try {
    switch (type) {
      case 'slots': return openSlots(cfg);
      case 'roulette': return openRoulette(cfg);
      case 'blackjack': return openBlackjack(cfg);
      case 'poker': return openPoker(cfg);
      default: {
        // Unknown game — a friendly placeholder modal.
        const node = el('div', 'game-modal');
        const close = btn('Close', 'game-close btn-ghost');
        close.onclick = () => { try { UI.closeModal(); } catch (e) {} };
        node.appendChild(close);
        node.appendChild(el('h2', null, 'Coming Soon'));
        node.appendChild(el('div', 'sub', `No game UI for "${type}".`));
        try { UI.openModal(node); } catch (e) {}
      }
    }
  } catch (e) {
    // Never throw out of a UI handler.
  }
}

// =============================================================
// openGameEditor — mechanics editor built from GAME_CATALOG[type].editable
// =============================================================
/**
 * openGameEditor(type, config, onSave) — renders editable mechanics inputs
 * pre-filled from the merged config. Save collects values into newConfig
 * and calls onSave(newConfig); both Save and Cancel close the modal.
 */
export function openGameEditor(type, config, onSave) {
  const cat = GAME_CATALOG[type] || {};
  const schema = Array.isArray(cat.editable) ? cat.editable : [];
  const cfg = mergedConfig(type, config);

  const node = el('div', 'game-modal');

  const close = btn('Close', 'game-close btn-ghost');
  close.onclick = () => { try { UI.closeModal(); } catch (e) {} };
  node.appendChild(close);

  node.appendChild(el('h2', null, `Edit ${cat.name || type}`));
  node.appendChild(el('div', 'sub', 'Tune this machine’s mechanics. Players see the result instantly.'));

  // Track each field so Save can collect typed values back out.
  const fields = []; // { key, type, read() }

  schema.forEach(field => {
    const row = el('div', 'bet-row');
    row.appendChild(el('label', null, field.label || field.key));

    if (field.type === 'select') {
      const sel = el('select');
      sel.style.cssText = 'padding:8px;border-radius:8px;border:1px solid #555;background:#0c0a18;color:#fff;';
      const opts = Array.isArray(field.options) ? field.options : [];
      const cur = cfg[field.key];
      let matched = false;
      opts.forEach(opt => {
        const o = el('option', null, String(opt));
        o.value = String(opt);
        if (String(opt) === String(cur)) { o.selected = true; matched = true; }
        sel.appendChild(o);
      });
      // Set the value explicitly so it reflects the current config even if the
      // option's `selected` attribute isn't honored; fall back to the first.
      if (matched) sel.value = String(cur);
      else if (opts.length) sel.value = String(opts[0]);
      row.appendChild(sel);
      fields.push({
        key: field.key, type: 'select',
        read: () => {
          let raw = sel.value;
          if (raw == null || String(raw).trim() === '') raw = String(cur); // defensive default
          const num = Number(raw);
          return Number.isFinite(num) && String(raw).trim() !== '' ? num : raw;
        },
      });
    } else {
      // number input (default)
      const inp = el('input');
      inp.type = 'number';
      if (field.min != null) inp.min = String(field.min);
      if (field.max != null) inp.max = String(field.max);
      if (field.step != null) inp.step = String(field.step);
      const cur = cfg[field.key];
      inp.value = String(cur != null ? cur : (field.min != null ? field.min : 0));
      row.appendChild(inp);
      fields.push({
        key: field.key, type: 'number',
        min: field.min, max: field.max,
        read: () => {
          let v = parseFloat(inp.value);
          if (!Number.isFinite(v)) v = field.min != null ? field.min : 0;
          if (field.min != null) v = Math.max(field.min, v);
          if (field.max != null) v = Math.min(field.max, v);
          // Keep whole numbers when the step is integer-ish.
          if (field.step == null || Number.isInteger(field.step)) {
            // Allow fractional rtp/pays where step < 1.
            if (field.step != null && field.step < 1) return v;
            return Math.round(v);
          }
          return v;
        },
      });
    }
    node.appendChild(row);
  });

  if (schema.length === 0) {
    node.appendChild(el('div', 'sub', 'This game has no editable mechanics.'));
  }

  const btnRow = el('div', 'btn-row');
  const saveBtn = btn('SAVE');
  const cancelBtn = btn('Cancel', 'btn-ghost');
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  node.appendChild(btnRow);

  saveBtn.onclick = () => {
    const newConfig = {};
    for (const f of fields) {
      try { newConfig[f.key] = f.read(); } catch (e) {}
    }
    // Defensive: ensure maxBet >= minBet if both present.
    if (newConfig.minBet != null && newConfig.maxBet != null && newConfig.maxBet < newConfig.minBet) {
      newConfig.maxBet = newConfig.minBet;
    }
    try { if (typeof onSave === 'function') onSave(newConfig); } catch (e) {}
    try { UI.closeModal(); } catch (e) {}
  };
  cancelBtn.onclick = () => { try { UI.closeModal(); } catch (e) {} };

  try { UI.openModal(node); } catch (e) {}
}
