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
  {
    id: 4, name: 'Emerald Card Room', theme: 'highroller',
    carpet: 0x123a2a, accent: 0xffd23f, neon: 0xffd23f,
    halls: [ R(-58, -40, -10, 40), R(10, -40, 58, 40) ],
    features: [
      { type: 'hall',     rect: R(-10, -42, 10, 42) },
      { type: 'bar',      rect: R(-7, -3, 7, 3), collide: true, label: 'CARD BAR' },
      { type: 'elevator', rect: R(-4, 34, 4, 42), collide: false },
    ],
  },
  {
    id: 5, name: 'The Grand Atrium', theme: 'classic',
    carpet: 0x2c2118, accent: 0xffd23f, neon: 0xffd23f,
    halls: [ R(-58, -40, -12, 40), R(12, -40, 58, 40) ],
    features: [
      { type: 'hall',       rect: R(-12, -42, 12, 42) },
      { type: 'fountain',   rect: R(-5, -5, 5, 5), collide: true },
      { type: 'restaurant', rect: R(-56, 16, -34, 38), collide: true, label: 'ATRIUM CAFÉ' },
      { type: 'elevator',   rect: R(-4, 34, 4, 42), collide: false },
    ],
  },
  {
    id: 6, name: 'Sapphire Sportsbook', theme: 'pool',
    carpet: 0x1c2a44, accent: 0xd9b25a, neon: 0xd9b25a,
    halls: [ R(-54, -28, 54, 34) ],
    features: [
      { type: 'theater',  rect: R(-54, -40, 54, -30), collide: true, label: 'SPORTSBOOK' },
      { type: 'bar',      rect: R(-9, 28, 9, 32), collide: true, label: 'RAIL BAR' },
      { type: 'elevator', rect: R(-4, 34, 4, 42), collide: false },
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

// Aisles: every Nth tile row/column is a walkable hallway between parcel blocks,
// so the casino floor reads like real banks of machines separated by aisles.
export const AISLE = { period: 3, offset: 2 };
export function isAisleTile(ti, tj) {
  return (((ti % AISLE.period) + AISLE.period) % AISLE.period === AISLE.offset)
      || (((tj % AISLE.period) + AISLE.period) % AISLE.period === AISLE.offset);
}

export function isBuildableTile(floorIndex, ti, tj) {
  const f = FLOORS[floorIndex]; if (!f) return false;
  if (isAisleTile(ti, tj)) return false;            // keep aisles clear (walkable hallways)
  const c = tileCenter(ti, tj);
  if (largePlotAt(floorIndex, c.x, c.z)) return false; // reserved for premium large plots
  const inHall = f.halls.some(h => inRect(c.x, c.z, h));
  if (!inHall) return false;
  const inFeature = f.features.some(ft => ft.type !== 'hall' && inRect(c.x, c.z, ft.rect));
  return !inFeature;
}
export { inRect };

// Premium LARGE plots: big contiguous areas you buy as one unit and can fill
// with many games (vs single-tile parcels). Reserved out of the tile grid above.
export const LARGE_PLOTS = {
  2: [ { id: 'lp_hr1', rect: R(-50, -30, -18, 30), price: 2800, name: 'High-Roller Salon' } ],
  4: [ { id: 'lp_em1', rect: R(14, -36, 54, 36), price: 1800, name: 'Emerald Wing' } ],
  5: [ { id: 'lp_at1', rect: R(16, -36, 56, 36), price: 2200, name: 'Atrium Gallery' } ],
};
export function largePlots(floorIndex) { return LARGE_PLOTS[floorIndex] || []; }
export function largePlotAt(floorIndex, x, z) {
  const arr = LARGE_PLOTS[floorIndex] || [];
  for (const p of arr) { if (inRect(x, z, p.rect)) return p; }
  return null;
}

export const ECONOMY = {
  STARTING_COINS: 5000,
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
  archway:     { id: 'archway',     name: 'Grand Archway',  icon: '🏛️', cost: 110, size: [2, 1] },
  floorlamp:   { id: 'floorlamp',   name: 'Floor Lamp',     icon: '💡', cost: 45,  size: [1, 1] },
  sofa:        { id: 'sofa',        name: 'Sofa',           icon: '🛋️', cost: 95,  size: [2, 1] },
  painting:    { id: 'painting',    name: 'Framed Painting',icon: '🖼️', cost: 55,  size: [1, 1] },
  rug:         { id: 'rug',         name: 'Area Rug',       icon: '🟫', cost: 40,  size: [2, 2] },
  bookshelf:   { id: 'bookshelf',   name: 'Bookshelf',      icon: '📚', cost: 70,  size: [1, 1] },
  tvstand:     { id: 'tvstand',     name: 'TV & Stand',     icon: '📺', cost: 120, size: [2, 1] },
  bigplant:    { id: 'bigplant',    name: 'Tall Plant',     icon: '🪴', cost: 50,  size: [1, 1] },
  minibar:     { id: 'minibar',     name: 'Mini Bar',       icon: '🍸', cost: 110, size: [1, 1] },
  coffeetable: { id: 'coffeetable', name: 'Coffee Table',   icon: '🪵', cost: 50,  size: [1, 1] },
  vase:        { id: 'vase',        name: 'Floor Vase',     icon: '🏺', cost: 35,  size: [1, 1] },
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

// =============================================================
// HOTEL TOWERS — buy & decorate rooms (wave 3)
// =============================================================

// Room styles a player can apply to an owned hotel room.
export const ROOM_STYLES = {
  standard:  { id: 'standard',  name: 'Standard Room', cost: 300,  wall: 0x4a4450, accent: 0xffd23f, floor: 0x6a4f33, mood: 0xffe7c2 },
  deluxe:    { id: 'deluxe',    name: 'Deluxe Suite',  cost: 750,  wall: 0x2c2440, accent: 0xff2db8, floor: 0x6a4a2a, mood: 0xffd0f0 },
  neon:      { id: 'neon',      name: 'Neon Loft',     cost: 1300, wall: 0x121220, accent: 0x18e0ff, floor: 0x24242f, mood: 0xbef9ff },
  royal:     { id: 'royal',     name: 'Royal Suite',   cost: 2600, wall: 0x281c0a, accent: 0xffd23f, floor: 0x3a2a16, mood: 0xfff0c0 },
  penthouse: { id: 'penthouse', name: 'Penthouse',     cost: 6000, wall: 0x16161f, accent: 0xffd23f, floor: 0x2c2c38, mood: 0xfff2cf },
  coastal:   { id: 'coastal',   name: 'Coastal Suite', cost: 900,  wall: 0xdfe7ec, accent: 0x4a90b8, floor: 0xc9b48a, mood: 0xdff0ff },
  artdeco:   { id: 'artdeco',   name: 'Art Deco',      cost: 1600, wall: 0x14140f, accent: 0xd4af37, floor: 0x241f18, mood: 0xffe9b0 },
  rustic:    { id: 'rustic',    name: 'Rustic Lodge',  cost: 800,  wall: 0x5a4632, accent: 0x9c6b3f, floor: 0x4a3520, mood: 0xffdca8 },
  modern:    { id: 'modern',    name: 'Modern Minimal',cost: 1100, wall: 0xe9e9ec, accent: 0x2f3640, floor: 0x9a9a9e, mood: 0xf4f4ff },
  vegas:     { id: 'vegas',     name: 'Vegas Classic', cost: 2000, wall: 0x2a0e12, accent: 0xd4af37, floor: 0x3a1620, mood: 0xffe0c0 },
};

export const HOTEL = {
  HALL_LEN: 216,        // hallway length along Z
  HALL_W: 10,           // hallway width along X
  H: 6.5,               // ceiling height
  DOOR_SPACING: 6,      // a door every N units, both sides
  ROOM: 9,              // interior room size (square)
  ROOM_H: 5,
  PENTHOUSE_SUITES: 6,  // big suites on the penthouse floor
  FLOORS: [
    { id: 'h0', name: 'Sapphire Tower — Floor 12', tower: 'Sapphire', style: 'standard', carpet: 0x1b2a44, accent: 0x18e0ff },
    { id: 'h1', name: 'Sapphire Tower — Floor 27', tower: 'Sapphire', style: 'deluxe',   carpet: 0x2a1b40, accent: 0xff2db8 },
    { id: 'h2', name: 'Ruby Tower — Sky Floor 44', tower: 'Ruby',     style: 'royal',    carpet: 0x3a1420, accent: 0xffd23f },
  ],
  PENTHOUSE: { id: 'ph', name: 'Penthouse & Rooftop Pool', style: 'penthouse', carpet: 0x16161f, accent: 0xffd23f },
};

// Door slots (rooms) along a hotel hallway floor. Hallway is its own scene
// centered on origin: Z in [-HALL_LEN/2, HALL_LEN/2], X across HALL_W.
export function hotelDoorSlots(floorId) {
  const slots = [];
  const half = HOTEL.HALL_LEN / 2;
  const startZ = -half + 12;
  const per = Math.floor((HOTEL.HALL_LEN - 20) / HOTEL.DOOR_SPACING);
  for (const side of [-1, 1]) {
    for (let k = 0; k < per; k++) {
      const z = startZ + k * HOTEL.DOOR_SPACING;
      const x = side * (HOTEL.HALL_W / 2);
      slots.push({
        roomId: `${floorId}_${side < 0 ? 'L' : 'R'}${k}`,
        x, z, side, unit: k + 1,
        rot: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      });
    }
  }
  return slots;
}
export function hotelRoomCount() {
  const per = Math.floor((HOTEL.HALL_LEN - 20) / HOTEL.DOOR_SPACING) * 2;
  return per * HOTEL.FLOORS.length + HOTEL.PENTHOUSE_SUITES;
}

// =============================================================
// DESTINATIONS — everywhere the elevator can take you.
// =============================================================
export const DESTINATIONS = [
  { id: 'lobby', kind: 'lobby', index: 0, name: 'Grand Lobby', group: 'Lobby', icon: '🏛️' },
  ...FLOORS.map((f, i) => ({ id: `casino${i}`, kind: 'casino', index: i, name: f.name, group: 'Casino', icon: '🎰' })),
  ...HOTEL.FLOORS.map((f, i) => ({ id: f.id, kind: 'hotel', index: i, name: f.name, group: `${f.tower} Tower`, icon: '🛏️' })),
  { id: HOTEL.PENTHOUSE.id, kind: 'penthouse', index: 0, name: HOTEL.PENTHOUSE.name, group: 'Hotel', icon: '🏙️' },
  { id: 'arena',  kind: 'arena',  index: 0, name: 'Derby Racing Arena', group: 'Attractions', icon: '🏇' },
  { id: 'garden', kind: 'garden', index: 0, name: 'Botanical Garden',   group: 'Attractions', icon: '🌿' },
];
