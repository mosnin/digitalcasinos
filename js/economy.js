// =============================================================
// Economy / player-state core. Single source of truth for coins,
// owned parcels, casinos, placed games, and the active skin.
// Persists to localStorage and (optionally) syncs to Supabase.
// =============================================================
import { ECONOMY } from './config.js';

const KEY = 'digitalcasinos_save_v1';

function defaults() {
  return {
    coins: ECONOMY.STARTING_COINS,
    parcels: {},   // key -> { owned:true, casino:false, games:[{type,tile:[tx,tz]}] }
    skin: 'highroller',
    ownedSkins: ['highroller'],
    rooms: {},       // hotel roomId -> { owned:true, style, name, decor:[{id,...}] }
    inventory: {},   // shop item id -> count
    profile: { name: 'Guest' },
    stats: { wagered: 0, won: 0, spins: 0 },
    version: 1,
  };
}

class EconomyStore {
  constructor() {
    this.state = this._load();
    this._subs = new Set();
    this.cloud = null; // set by auth.js: { save(state), }
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return defaults();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {}
    if (this.cloud && this.cloud.save) this.cloud.save(this.state);
    this._emit();
  }

  // Replace local state from a cloud snapshot (auth.js calls this on login)
  hydrate(remote) {
    if (remote && typeof remote === 'object') {
      this.state = Object.assign(defaults(), remote);
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) {}
      this._emit();
    }
  }

  subscribe(cb) { this._subs.add(cb); cb(this.state); return () => this._subs.delete(cb); }
  _emit() { for (const cb of this._subs) cb(this.state); }

  // ---- coins ----
  get coins() { return this.state.coins; }
  canAfford(n) { return this.state.coins >= n; }
  add(n) { this.state.coins += Math.round(n); this.save(); return this.state.coins; }
  spend(n) {
    n = Math.round(n);
    if (this.state.coins < n) return false;
    this.state.coins -= n; this.save(); return true;
  }
  wager(amount, payout) {
    this.state.stats.wagered += amount;
    this.state.stats.won += payout;
    this.state.stats.spins += 1;
    this.state.coins += (payout - amount);
    this.save();
  }

  // ---- parcels (floor tiles inside the mega-casino) ----
  getParcel(key) { return this.state.parcels[key] || null; }
  ownsParcel(key) { return !!(this.state.parcels[key] && this.state.parcels[key].owned); }
  ownedParcelKeys() { return Object.keys(this.state.parcels).filter(k => this.state.parcels[k].owned); }

  // price scales with floor (higher floors are pricier)
  parcelPrice(floorIndex = 0) {
    return Math.round(ECONOMY.PARCEL_BASE + floorIndex * ECONOMY.PARCEL_FLOOR_PREMIUM);
  }

  buyParcel(key, price) {
    if (this.ownsParcel(key)) return { ok: false, reason: 'already owned' };
    if (!this.spend(price)) return { ok: false, reason: 'not enough coins' };
    this.state.parcels[key] = { owned: true, games: [] };
    this.save();
    return { ok: true };
  }

  // ---- placed games (require owning the parcel) ----
  getGames(key) { const p = this.state.parcels[key]; return (p && p.games) || []; }
  addGame(key, type, cost, extra = {}) {
    const p = this.state.parcels[key];
    if (!p || !p.owned) return { ok: false, reason: 'you must own this parcel' };
    if (!this.spend(cost)) return { ok: false, reason: 'not enough coins' };
    p.games = p.games || [];
    p.games.push({ type, ...extra });
    this.save();
    return { ok: true, index: p.games.length - 1 };
  }
  removeGame(key, index) {
    const p = this.state.parcels[key];
    if (p && p.games[index]) { p.games.splice(index, 1); this.save(); return true; }
    return false;
  }
  // Edit the mechanics of a placed game (payouts, bet limits, etc.)
  updateGameConfig(key, index, patch) {
    const p = this.state.parcels[key];
    if (!p || !p.games[index]) return false;
    p.games[index].config = Object.assign({}, p.games[index].config, patch);
    this.save();
    return true;
  }

  // ---- decorations placed on owned parcels ----
  getDecor(key) { const p = this.state.parcels[key]; return (p && p.decor) || []; }
  addDecor(key, id, transform, cost) {
    const p = this.state.parcels[key];
    if (!p || !p.owned) return { ok: false, reason: 'you must own this parcel' };
    if (!this.spend(cost)) return { ok: false, reason: 'not enough coins' };
    p.decor = p.decor || [];
    p.decor.push({ id, ...transform });
    this.save();
    return { ok: true, index: p.decor.length - 1 };
  }
  removeDecor(key, index) {
    const p = this.state.parcels[key];
    if (p && p.decor && p.decor[index]) { p.decor.splice(index, 1); this.save(); return true; }
    return false;
  }

  // ---- hotel rooms ----
  getRoom(id) { return this.state.rooms[id] || null; }
  ownsRoom(id) { return !!(this.state.rooms[id] && this.state.rooms[id].owned); }
  ownedRoomIds() { return Object.keys(this.state.rooms).filter(k => this.state.rooms[k].owned); }
  buyRoom(id, styleId, price) {
    if (this.ownsRoom(id)) return { ok: false, reason: 'already yours' };
    if (!this.spend(price)) return { ok: false, reason: 'not enough coins' };
    this.state.rooms[id] = { owned: true, style: styleId || 'standard', decor: [], name: '' };
    this.save();
    return { ok: true };
  }
  setRoomStyle(id, styleId, cost = 0) {
    const r = this.state.rooms[id];
    if (!r || !r.owned) return { ok: false, reason: 'not your room' };
    if (cost > 0 && !this.spend(cost)) return { ok: false, reason: 'not enough coins' };
    r.style = styleId; this.save();
    return { ok: true };
  }
  getRoomDecor(id) { const r = this.state.rooms[id]; return (r && r.decor) || []; }
  addRoomDecor(id, decorId, transform, cost) {
    const r = this.state.rooms[id];
    if (!r || !r.owned) return { ok: false, reason: 'not your room' };
    if (!this.spend(cost)) return { ok: false, reason: 'not enough coins' };
    r.decor = r.decor || [];
    r.decor.push({ id: decorId, ...transform });
    this.save();
    return { ok: true, index: r.decor.length - 1 };
  }
  removeRoomDecor(id, index) {
    const r = this.state.rooms[id];
    if (r && r.decor && r.decor[index]) { r.decor.splice(index, 1); this.save(); return true; }
    return false;
  }

  // ---- gift shop / concessions ----
  buyShopItem(id, cost) {
    if (!this.spend(cost)) return { ok: false, reason: 'not enough coins' };
    this.state.inventory[id] = (this.state.inventory[id] || 0) + 1;
    this.save();
    return { ok: true };
  }
  inventoryCount(id) { return this.state.inventory[id] || 0; }

  // ---- skins ----
  get skin() { return this.state.skin; }
  ownsSkin(id) { return this.state.ownedSkins.includes(id); }
  buySkin(id, cost) {
    if (this.ownsSkin(id)) { this.equipSkin(id); return { ok: true }; }
    if (!this.spend(cost)) return { ok: false, reason: 'not enough coins' };
    this.state.ownedSkins.push(id); this.equipSkin(id); return { ok: true };
  }
  equipSkin(id) { this.state.skin = id; this.save(); }
}

export const Economy = new EconomyStore();
if (typeof window !== 'undefined') window.Economy = Economy;
