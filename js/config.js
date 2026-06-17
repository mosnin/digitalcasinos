// =============================================================
// Digital Casinos — shared config & world contract.
// The whole game takes place INSIDE one massive mega-casino made
// of several stacked FLOORS (maps). Each floor is a big space with
// buildable "halls" (where parcels live) and "features" (pools,
// bars, fountains, hallways, elevators, windows).
// Every module imports from here. Do not redefine the tile math.
// =============================================================

import * as THREE from 'three';

// ---- Floor geometry (shared by all floors) ----
export const FLOOR = {
  W: 120,            // floor width  (X spans [-60, 60])
  D: 84,             // floor depth  (Z spans [-42, 42])
  H: 7.5,            // wall/ceiling height per floor
  TILE: 6,           // parcel/tile size
  get TX() { return this.W / this.TILE; }, // 20 tiles on X
  get TZ() { return this.D / this.TILE; }, // 14 tiles on Z
};

// Shared elevator core (same X/Z on every floor) — connects all maps.
export const ELEVATOR = { x: 0, z: 38, w: 8, d: 8 };

// rect = [x0, z0, x1, z1] in world coords (centered on origin)
const R = (x0, z0, x1, z1) => [x0, z0, x1, z1];

export const FLOORS = [
  {
    id: 0, name: 'Grand Casino Floor', theme: 'classic',
    carpet: 0x7a1020, accent: 0xffd23f, neon: 0xff2db8,
    halls: [ R(-58, -40, -10, 40), R(10, -40, 58, 40) ],
    features: [
      { type: 'hall',     rect: R(-10, -42, 10, 42) },
      { type: 'fountain', rect: R(-4, -6, 4, 6), collide: true },
      { type: 'elevator', rect: R(-4, 34, 4, 42), collide: false },
    ],
  },
  {
    id: 1, name: 'Poolside Promenade', theme: 'pool',
    carpet: 0x0e2230, accent: 0x18e0ff, neon: 0x18e0ff,
    halls: [ R(-58, -40, 58, -20), R(-58, 20, 58, 40), R(-58, -18, -30, 18), R(30, -18, 58, 18) ],
    features: [
      { type: 'pool',     rect: R(-26, -16, 26, 16), collide: true },
      { type: 'bar',      rect: R(-28, -19, -10, -16.5), collide: true },
      { type: 'hall',     rect: R(-30, -20, 30, 20) },
      { type: 'elevator', rect: R(-4, 34, 4, 42), collide: false },
    ],
  },
  {
    id: 2, name: 'High Roller Sky Lounge', theme: 'highroller',
    carpet: 0x1a0f2e, accent: 0xffd23f, neon: 0x9b1bff,
    halls: [ R(-54, -34, 54, 34) ],
    features: [
      { type: 'bar',      rect: R(-9, -6, 9, 6), collide: true },
      { type: 'window',   rect: R(-58, -41, 58, -39) },
      { type: 'window',   rect: R(-58, 39, 58, 41) },
      { type: 'elevator', rect: R(-4, 34, 4, 42), collide: false },
    ],
  },
  {
    id: 3, name: 'The Promenade — Shops & Dining', theme: 'promenade',
    carpet: 0x23303a, accent: 0x18e0ff, neon: 0xff2db8,
    halls: [ R(-58, -40, -12, 40), R(12, -40, 58, 40) ],
    features: [
      { type: 'hall',       rect: R(-12, -42, 12, 42) },
      { type: 'giftshop',   rect: R(-56, -38, -34, -16), collide: true, label: 'GIFT SHOP' },
      { type: 'restaurant', rect: R(-56, 16, -34, 38), collide: true, label: 'THE BUFFET' },
      { type: 'theater',    rect: R(34, -38, 56, -8), collide: true, label: 'SHOWROOM' },
      { type: 'restaurant', rect: R(34, 12, 56, 38), collide: true, label: 'NEON DINER' },
      { type: 'fountain',   rect: R(-4, -4, 4, 4), collide: true },
      { type: 'elevator',   rect: R(-4, 34, 4, 42), collide: false },
    ],
  },
];

// ---- tile <-> world helpers (single source of truth) ----
export function tileCenter(ti, tj) {
  return { x: (ti + 0.5) * FLOOR.TILE - FLOOR.W / 2, z: (tj + 0.5) * FLOOR.TILE - FLOOR.D / 2 };
}
export function tileFromWorld(x, z) {
  const ti = Math.floor((x + FLOOR.W / 2) / FLOOR.TILE);
  const tj = Math.floor((z + FLOOR.D / 2) / FLOOR.TILE);
  if (ti < 0 || tj < 0 || ti >= FLOOR.TX || tj >= FLOOR.TZ) return null;
  return { ti, tj };
}
export function parcelKey(floor, ti, tj) { return `${floor}_${ti}_${tj}`; }

function inRect(x, z, r) { return x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]; }

export function isBuildableTile(floorIndex, ti, tj) {
  const f = FLOORS[floorIndex]; if (!f) return false;
  const c = tileCenter(ti, tj);
  const inHall = f.halls.some(h => inRect(c.x, c.z, h));
  if (!inHall) return false;
  const inFeature = f.features.some(ft => ft.type !== 'hall' && inRect(c.x, c.z, ft.rect));
  return !inFeature;
}
export { inRect };

export const ECONOMY = {
  STARTING_COINS: 1500,
  PARCEL_BASE: 150,       // base price to buy a floor parcel
  PARCEL_FLOOR_PREMIUM: 120, // higher floors cost more
};

// Casino games the player can buy, place on owned parcels, and TUNE.
// `mechanics` = the default editable config saved per placed game.
// `editable` = schema the in-game editor renders (key/label/type/min/max/step/options).
export const GAME_CATALOG = {
  slots: {
    id: 'slots', name: 'Slot Machine', icon: '🎰', cost: 150, footprint: [1, 1],
    mechanics: { minBet: 5, maxBet: 100, rtp: 0.92, jackpot: 500 },
    editable: [
      { key: 'minBet', label: 'Min Bet', type: 'number', min: 1, max: 50, step: 1 },
      { key: 'maxBet', label: 'Max Bet', type: 'number', min: 10, max: 500, step: 10 },
      { key: 'rtp', label: 'Return % (house edge)', type: 'number', min: 0.80, max: 0.99, step: 0.01 },
      { key: 'jackpot', label: 'Jackpot', type: 'number', min: 100, max: 5000, step: 50 },
    ],
  },
  roulette: {
    id: 'roulette', name: 'Roulette', icon: '🟢', cost: 300, footprint: [2, 2],
    mechanics: { minBet: 5, maxBet: 200, colorPays: 2, greenPays: 14, numberPays: 35 },
    editable: [
      { key: 'minBet', label: 'Min Bet', type: 'number', min: 1, max: 50, step: 1 },
      { key: 'maxBet', label: 'Max Bet', type: 'number', min: 10, max: 1000, step: 10 },
      { key: 'colorPays', label: 'Red/Black Pays ×', type: 'number', min: 1.5, max: 3, step: 0.1 },
      { key: 'greenPays', label: 'Green Pays ×', type: 'number', min: 5, max: 20, step: 1 },
    ],
  },
  blackjack: {
    id: 'blackjack', name: 'Blackjack', icon: '♠️', cost: 250, footprint: [2, 1],
    mechanics: { minBet: 10, maxBet: 300, blackjackPays: 1.5, dealerStandsOn: 17 },
    editable: [
      { key: 'minBet', label: 'Min Bet', type: 'number', min: 1, max: 100, step: 5 },
      { key: 'maxBet', label: 'Max Bet', type: 'number', min: 25, max: 1000, step: 25 },
      { key: 'blackjackPays', label: 'Blackjack Pays ×', type: 'number', min: 1.2, max: 2, step: 0.1 },
      { key: 'dealerStandsOn', label: 'Dealer Stands On', type: 'select', options: [16, 17, 18] },
    ],
  },
  poker: {
    id: 'poker', name: 'Poker Table', icon: '🃏', cost: 350, footprint: [2, 2],
    mechanics: { ante: 10, maxBet: 200, pairPays: 1, flushPays: 6, straightPays: 4 },
    editable: [
      { key: 'ante', label: 'Ante', type: 'number', min: 1, max: 100, step: 1 },
      { key: 'maxBet', label: 'Max Raise', type: 'number', min: 25, max: 1000, step: 25 },
      { key: 'flushPays', label: 'Flush Pays ×', type: 'number', min: 3, max: 12, step: 1 },
      { key: 'straightPays', label: 'Straight Pays ×', type: 'number', min: 2, max: 8, step: 1 },
    ],
  },
};

// Decorations players can buy and place on their owned parcels.
export const DECOR_CATALOG = {
  plant:       { id: 'plant',       name: 'Potted Palm',    icon: '🌴', cost: 40,  size: [1, 1] },
  statue:      { id: 'statue',      name: 'Gold Statue',    icon: '🗿', cost: 120, size: [1, 1] },
  fountain:    { id: 'fountain',    name: 'Coin Fountain',  icon: '⛲', cost: 200, size: [2, 2] },
  redcarpet:   { id: 'redcarpet',   name: 'Red Carpet',     icon: '🟥', cost: 25,  size: [1, 1] },
  rope:        { id: 'rope',        name: 'Velvet Rope',    icon: '🪢', cost: 30,  size: [1, 1] },
  neonsign:    { id: 'neonsign',    name: 'Neon Sign',      icon: '💡', cost: 90,  size: [1, 1] },
  barstool:    { id: 'barstool',    name: 'Bar Stool',      icon: '🪑', cost: 35,  size: [1, 1] },
  chandelier:  { id: 'chandelier',  name: 'Chandelier',     icon: '✨', cost: 150, size: [1, 1] },
  cardtable:   { id: 'cardtable',   name: 'Lounge Table',   icon: '🟢', cost: 60,  size: [1, 1] },
  archway:     { id: 'archway',     name: 'Neon Archway',   icon: '🌈', cost: 110, size: [2, 1] },
};

// Gift-shop / concessions: fun ways to spend coins (consumables + cosmetics).
export const SHOP_CATALOG = {
  champagne:   { id: 'champagne',  name: 'Champagne',     icon: '🍾', cost: 50,   kind: 'consumable', desc: 'Pop bottles. Pure vibes.' },
  luckycharm:  { id: 'luckycharm', name: 'Lucky Charm',   icon: '🍀', cost: 250,  kind: 'boost', desc: '+2% luck on your next 10 spins.' },
  vippass:     { id: 'vippass',    name: 'VIP Pass',      icon: '🎟️', cost: 1000, kind: 'cosmetic', desc: 'Flex a VIP badge on your HUD.' },
  plushdice:   { id: 'plushdice',  name: 'Plush Dice',    icon: '🎲', cost: 30,   kind: 'souvenir', desc: 'A fuzzy souvenir.' },
  showticket:  { id: 'showticket', name: 'Show Ticket',   icon: '🎭', cost: 75,   kind: 'consumable', desc: 'Front-row seat at the Showroom.' },
};

// Player skins / character customization.
export const SKIN_CATALOG = {
  highroller: { id: 'highroller', name: 'High Roller',  cost: 0,    suit: 0xf5f5f5, accent: 0xffd23f, skin: 0xe0ac69 },
  neon:       { id: 'neon',       name: 'Neon Dealer',  cost: 400,  suit: 0x18101f, accent: 0xff2db8, skin: 0xc68642 },
  tux:        { id: 'tux',        name: 'Black Tux',    cost: 600,  suit: 0x101014, accent: 0xeeeeee, skin: 0xf1c27d },
  goldsuit:   { id: 'goldsuit',   name: 'Golden Whale', cost: 1500, suit: 0xb8860b, accent: 0xfff3b0, skin: 0x8d5524 },
  showgirl:   { id: 'showgirl',   name: 'Showgirl',     cost: 900,  suit: 0xff2db8, accent: 0x18e0ff, skin: 0xffdbac },
};

// Movement tuning (shared by player.js)
export const MOVE = { WALK: 6, SPRINT: 11, JUMP: 7.5, GRAVITY: 22, EYE: 1.65, RADIUS: 0.5 };

// Supabase config — inject via window.SUPABASE_CONFIG or edit here. Blank => guest mode.
export const SUPABASE = (typeof window !== 'undefined' && window.SUPABASE_CONFIG) || { url: '', anonKey: '' };

export const COLORS = {
  neon: 0xff2db8, neon2: 0x18e0ff, gold: 0xffd23f,
  carpet: 0x7a1020, marble: 0xe8e2d6, water: 0x17b6d6, brass: 0xc9a227,
};

// tiny shared util
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function box3FromRect(r, y0, y1) {
  return new THREE.Box3(new THREE.Vector3(r[0], y0, r[1]), new THREE.Vector3(r[2], y1, r[3]));
}
