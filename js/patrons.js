// =============================================================
// Digital Casinos — patrons.js
// NPC patrons that walk to the player's placed machines on a floor
// and play them for passive income. Derives machine world positions
// from Economy.state.parcels keys ("floor_ti_tj") + tileCenter().
//
// Export:
//   createPatrons({ economy, onEarn }) ->
//     { setFloor(scene, floorIndex), update(dt), clear() }
//
// Never throws. Reuses buildHumanoid. Keeps y at 0. Caps at 6 patrons.
// =============================================================

import * as THREE from 'three';
import { tileCenter, GAME_CATALOG, FLOOR } from './config.js';
import { buildHumanoid } from './characters.js';

const MAX_PATRONS = 6;
const WALK_SPEED = 1.3;        // m/s
const PLAY_SECONDS = 4;        // idle "playing" time before moving on (+ randomness)
const PAYOUT_INTERVAL = 2.5;   // seconds between income ticks while playing
const ARRIVE_DIST = 0.45;      // distance to a machine that counts as "arrived"

// Varied crowd palette (mirrors characters.js style).
const SUITS   = [0x222831, 0x2b2d42, 0x3a2e2a, 0x14213d, 0x4a4e69, 0x1d2021, 0x5c3a2e, 0x33415c];
const ACCENTS = [0xffd23f, 0xff2db8, 0x18e0ff, 0xe63946, 0xeeeeee, 0x9b1bff, 0x06d6a0];
const SKINS   = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffe0bd];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

export function createPatrons({ economy, onEarn } = {}) {
  let scene = null;
  let floorIndex = 0;
  let patrons = [];
  let machines = [];   // [{ x, z, cost }]

  // ---- Derive the player's placed-machine world positions on a floor ----
  function computeMachines(floor) {
    const out = [];
    try {
      const parcels = (economy && economy.state && economy.state.parcels) || {};
      for (const key in parcels) {
        if (!Object.prototype.hasOwnProperty.call(parcels, key)) continue;
        const parts = String(key).split('_');
        if (parts.length < 3) continue;
        const f = parseInt(parts[0], 10);
        const ti = parseInt(parts[1], 10);
        const tj = parseInt(parts[2], 10);
        if (f !== floor) continue;
        if (!Number.isFinite(ti) || !Number.isFinite(tj)) continue;

        let games = [];
        try {
          games = (economy && typeof economy.getGames === 'function')
            ? economy.getGames(key)
            : ((parcels[key] && parcels[key].games) || []);
        } catch (e) { games = []; }
        if (!Array.isArray(games) || games.length === 0) continue;

        const c = tileCenter(ti, tj);
        if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;

        // Each placed game becomes a payout source; default cost is modest.
        for (const g of games) {
          const type = g && g.type;
          const def = (type && GAME_CATALOG[type]) || null;
          const cost = (def && Number.isFinite(def.cost)) ? def.cost : 150;
          out.push({ x: c.x, z: c.z, cost });
        }
      }
    } catch (e) { /* never throw */ }
    return out;
  }

  // A random point inside the floor footprint to wander toward.
  function wanderPoint() {
    const halfW = (FLOOR && FLOOR.W ? FLOOR.W : 120) / 2 - 6;
    const halfD = (FLOOR && FLOOR.D ? FLOOR.D : 84) / 2 - 6;
    return { x: (Math.random() * 2 - 1) * halfW, z: (Math.random() * 2 - 1) * halfD };
  }

  // Pick a target for a patron: a random owned machine, else a wander point.
  function pickTarget() {
    if (machines.length > 0) {
      const m = machines[(Math.random() * machines.length) | 0];
      return { x: m.x, z: m.z, cost: m.cost, machine: true };
    }
    const w = wanderPoint();
    return { x: w.x, z: w.z, cost: 0, machine: false };
  }

  function spawnOne() {
    let h = null;
    try {
      h = buildHumanoid({
        suit: pick(SUITS), accent: pick(ACCENTS), skin: pick(SKINS),
        scale: 0.92 + Math.random() * 0.18,
      });
    } catch (e) { return null; }
    if (!h || !h.root) return null;

    // Start somewhere on the floor.
    const start = wanderPoint();
    h.root.position.set(start.x, 0, start.z);
    h.root.rotation.y = Math.random() * Math.PI * 2;
    try { if (scene) scene.add(h.root); } catch (e) { /* ignore */ }

    return {
      h,
      target: pickTarget(),
      heading: h.root.rotation.y,
      state: 'walk',     // 'walk' | 'play'
      playTimer: 0,
      payTimer: 0,
    };
  }

  function disposePatron(p) {
    if (!p || !p.h) return;
    try { if (scene && p.h.root) scene.remove(p.h.root); } catch (e) {}
    try { if (typeof p.h.dispose === 'function') p.h.dispose(); } catch (e) {}
  }

  function clear() {
    for (const p of patrons) disposePatron(p);
    patrons = [];
  }

  function setFloor(nextScene, nextFloorIndex) {
    try {
      clear();
      scene = nextScene || null;
      floorIndex = Number.isFinite(nextFloorIndex) ? nextFloorIndex : 0;
      machines = computeMachines(floorIndex);
      if (!scene) return;

      const count = Math.min(MAX_PATRONS, 4 + ((Math.random() * 3) | 0)); // ~4-6
      for (let i = 0; i < count; i++) {
        const p = spawnOne();
        if (p) patrons.push(p);
        if (patrons.length >= MAX_PATRONS) break;
      }
    } catch (e) { /* never throw */ }
  }

  // Generate income for a playing patron standing at a machine.
  function payout(p) {
    try {
      const cost = (p && p.target && Number.isFinite(p.target.cost)) ? p.target.cost : 0;
      if (cost <= 0) return;
      const amount = Math.round(cost * (0.02 + Math.random() * 0.05));
      if (!(amount > 0)) return;
      if (economy && typeof economy.add === 'function') economy.add(amount);
      if (typeof onEarn === 'function' && p.h && p.h.root) {
        const wp = p.h.root.position;
        onEarn(amount, new THREE.Vector3(wp.x, 0, wp.z));
      }
    } catch (e) { /* never throw */ }
  }

  function update(dt) {
    if (!(dt > 0)) return;
    try {
      for (const p of patrons) {
        const h = p.h;
        if (!h || !h.root) continue;
        const root = h.root;

        if (p.state === 'play') {
          // Stand idle and pay out on the payout interval.
          p.playTimer -= dt;
          p.payTimer -= dt;
          if (p.payTimer <= 0) {
            payout(p);
            p.payTimer = PAYOUT_INTERVAL;
          }
          try { h.update(dt, false); } catch (e) {}
          if (p.playTimer <= 0) {
            // Move on to another machine / wander point.
            p.target = pickTarget();
            p.state = 'walk';
          }
          root.position.y = 0;
          continue;
        }

        // ---- Walking toward target ----
        const t = p.target || {};
        const tx = Number.isFinite(t.x) ? t.x : root.position.x;
        const tz = Number.isFinite(t.z) ? t.z : root.position.z;
        const dx = tx - root.position.x;
        const dz = tz - root.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist < ARRIVE_DIST) {
          if (t.machine) {
            // Arrived at a machine: play it for a few seconds.
            p.state = 'play';
            p.playTimer = PLAY_SECONDS + Math.random() * 3;
            p.payTimer = PAYOUT_INTERVAL * 0.5;
            try { if (typeof h.setPose === 'function') h.setPose('stand'); } catch (e) {}
            try { h.update(dt, false); } catch (e) {}
          } else {
            // Reached a wander point: pick a new one.
            p.target = pickTarget();
            try { h.update(dt, false); } catch (e) {}
          }
          root.position.y = 0;
          continue;
        }

        // Face travel direction, turning smoothly.
        const desired = Math.atan2(dx, dz);
        let diff = desired - p.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        p.heading += diff * Math.min(1, dt * 6);
        root.rotation.y = p.heading;

        // Step toward target without overshooting.
        const step = Math.min(WALK_SPEED * dt, dist);
        const inv = dist > 0 ? step / dist : 0;
        root.position.x += dx * inv;
        root.position.z += dz * inv;
        root.position.y = 0;

        try { h.update(dt, true); } catch (e) {}
      }
    } catch (e) { /* never throw */ }
  }

  return { setFloor, update, clear };
}
