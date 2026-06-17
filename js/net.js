// =============================================================
// Digital Casinos — Wave 4: Multiplayer transport (Supabase Realtime).
//
// A single Realtime channel named `world`:
//   - Presence  → live roster (+ onJoin/onLeave events)
//   - Broadcast (event `pos`) → ~10 Hz movement updates (onUpdate)
//
// Degrades gracefully: if Supabase isn't configured (guest mode) the net
// object stays "offline" and every method is a safe no-op. Nothing here
// ever throws — all failures fall back to offline.
//
//   import { createNet } from './net.js';
//   const net = createNet({ getProfile: () => ({ id, name, skin }) });
//   await net.connect();
//   net.onUpdate(s => remote.apply(s));
//   net.setLocal({ id, name, skin, dest, x, z, yaw });
// =============================================================

import { SUPABASE } from './config.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';
const SEND_THROTTLE_MS = 100; // ~10 Hz

export function createNet({ getProfile } = {}) {
  // ---- internal state ----
  const safeProfile = () => {
    try {
      const p = (typeof getProfile === 'function' && getProfile()) || {};
      return {
        id: p.id || '',
        name: typeof p.name === 'string' ? p.name : 'Guest',
        skin: p.skin || 'highroller',
      };
    } catch (_) {
      return { id: '', name: 'Guest', skin: 'highroller' };
    }
  };

  let supabase = null;
  let channel = null;
  let online = false;
  let myId = '';

  const roster = new Map(); // id -> { id, name, skin }

  const cbUpdate = [];
  const cbJoin = [];
  const cbLeave = [];

  let lastSend = 0;
  let lastTrackedName = null;
  let lastTrackedSkin = null;

  // ---- callback dispatch (never throws) ----
  function fire(list, arg) {
    for (const cb of list) {
      try { cb(arg); } catch (_) { /* ignore listener errors */ }
    }
  }

  // ---- stable player id ----
  function guestId() {
    try {
      const KEY = 'dc_pid';
      let id = null;
      try { id = localStorage.getItem(KEY); } catch (_) { id = null; }
      if (!id) {
        id = 'guest_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        try { localStorage.setItem(KEY, id); } catch (_) { /* ignore */ }
      }
      return id;
    } catch (_) {
      return 'guest_' + Math.random().toString(36).slice(2, 10);
    }
  }

  // ---- presence → roster ----
  function rebuildRosterFromPresence() {
    if (!channel) return;
    let prev;
    try { prev = channel.presenceState() || {}; } catch (_) { return; }
    const seen = new Set();
    for (const key of Object.keys(prev)) {
      const metas = prev[key];
      const meta = (Array.isArray(metas) && metas.length) ? metas[metas.length - 1] : null;
      const id = (meta && meta.id) || key;
      seen.add(id);
      roster.set(id, {
        id,
        name: (meta && meta.name) || 'Player',
        skin: (meta && meta.skin) || 'highroller',
      });
    }
    // prune anyone no longer present
    for (const id of Array.from(roster.keys())) {
      if (!seen.has(id)) roster.delete(id);
    }
  }

  function entryFromMeta(key, meta) {
    return {
      id: (meta && meta.id) || key,
      name: (meta && meta.name) || 'Player',
      skin: (meta && meta.skin) || 'highroller',
    };
  }

  // =============================================================
  // connect
  // =============================================================
  async function connect() {
    try {
      if (!SUPABASE || !SUPABASE.url || !SUPABASE.anonKey) {
        online = false;
        return { online: false };
      }

      const mod = await import(/* @vite-ignore */ SUPABASE_ESM);
      const createClient = mod.createClient || (mod.default && mod.default.createClient);
      if (typeof createClient !== 'function') {
        online = false;
        return { online: false };
      }

      supabase = createClient(SUPABASE.url, SUPABASE.anonKey, {
        realtime: { params: { eventsPerSecond: 12 } },
      });

      // Stable id: prefer authenticated user, else persisted guest id.
      try {
        const res = await supabase.auth.getUser();
        const user = res && res.data && res.data.user;
        myId = (user && user.id) || guestId();
      } catch (_) {
        myId = guestId();
      }

      channel = supabase.channel('world', {
        config: { presence: { key: myId }, broadcast: { self: false } },
      });

      channel.on('presence', { event: 'sync' }, () => {
        try {
          rebuildRosterFromPresence();
        } catch (_) { /* ignore */ }
      });

      channel.on('presence', { event: 'join' }, ({ key, newPresences } = {}) => {
        try {
          const list = newPresences || [];
          if (!list.length && key) {
            const e = entryFromMeta(key, null);
            roster.set(e.id, e);
            if (e.id !== myId) fire(cbJoin, e);
            return;
          }
          for (const meta of list) {
            const e = entryFromMeta(key, meta);
            roster.set(e.id, e);
            if (e.id !== myId) fire(cbJoin, e);
          }
        } catch (_) { /* ignore */ }
      });

      channel.on('presence', { event: 'leave' }, ({ key, leftPresences } = {}) => {
        try {
          const list = leftPresences || [];
          if (!list.length && key) {
            const e = roster.get(key) || entryFromMeta(key, null);
            roster.delete(e.id);
            if (e.id !== myId) fire(cbLeave, e);
            return;
          }
          for (const meta of list) {
            const e = entryFromMeta(key, meta);
            roster.delete(e.id);
            if (e.id !== myId) fire(cbLeave, e);
          }
        } catch (_) { /* ignore */ }
      });

      channel.on('broadcast', { event: 'pos' }, (msg) => {
        try {
          const payload = msg && msg.payload;
          if (!payload || payload.id === myId) return;
          fire(cbUpdate, payload);
        } catch (_) { /* ignore */ }
      });

      await new Promise((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        try {
          channel.subscribe((status) => {
            try {
              if (status === 'SUBSCRIBED') {
                online = true;
                const prof = safeProfile();
                lastTrackedName = prof.name;
                lastTrackedSkin = prof.skin;
                Promise.resolve(channel.track(prof)).catch(() => {});
                done();
              } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT' ||
                status === 'CLOSED'
              ) {
                online = false;
                done();
              }
            } catch (_) {
              online = false;
              done();
            }
          });
        } catch (_) {
          online = false;
          done();
        }
        // Safety: don't hang forever if no status callback arrives.
        try { setTimeout(done, 8000); } catch (_) { done(); }
      });

      if (online) return { online: true, id: myId };
      return { online: false };
    } catch (_) {
      online = false;
      return { online: false };
    }
  }

  // =============================================================
  // setLocal — throttled broadcast + re-track on profile change
  // =============================================================
  function setLocal(state) {
    try {
      if (!online || !channel || !state) return;
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      if (now - lastSend < SEND_THROTTLE_MS) return;
      lastSend = now;

      const payload = {
        id: state.id || myId,
        name: state.name,
        skin: state.skin,
        dest: state.dest,
        x: state.x,
        z: state.z,
        yaw: state.yaw,
      };

      Promise.resolve(
        channel.send({ type: 'broadcast', event: 'pos', payload })
      ).catch(() => {});

      // Re-track presence if identity changed (name/skin).
      const name = state.name != null ? state.name : lastTrackedName;
      const skin = state.skin != null ? state.skin : lastTrackedSkin;
      if (name !== lastTrackedName || skin !== lastTrackedSkin) {
        lastTrackedName = name;
        lastTrackedSkin = skin;
        const prof = safeProfile();
        prof.name = name != null ? name : prof.name;
        prof.skin = skin != null ? skin : prof.skin;
        Promise.resolve(channel.track(prof)).catch(() => {});
      }
    } catch (_) { /* ignore */ }
  }

  // =============================================================
  // subscriptions + queries
  // =============================================================
  function onUpdate(cb) { try { if (typeof cb === 'function') cbUpdate.push(cb); } catch (_) {} }
  function onJoin(cb) { try { if (typeof cb === 'function') cbJoin.push(cb); } catch (_) {} }
  function onLeave(cb) { try { if (typeof cb === 'function') cbLeave.push(cb); } catch (_) {} }

  function rosterList() {
    try {
      return Array.from(roster.values())
        .filter((e) => e && e.id && e.id !== myId)
        .map((e) => ({ id: e.id, name: e.name, skin: e.skin }));
    } catch (_) {
      return [];
    }
  }

  function isOnline() { return !!online; }

  async function disconnect() {
    try {
      online = false;
      if (channel) {
        try { await Promise.resolve(channel.untrack()); } catch (_) { /* ignore */ }
        try {
          if (supabase && typeof supabase.removeChannel === 'function') {
            await Promise.resolve(supabase.removeChannel(channel));
          } else if (typeof channel.unsubscribe === 'function') {
            await Promise.resolve(channel.unsubscribe());
          }
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ } finally {
      channel = null;
      roster.clear();
    }
  }

  const net = {
    connect,
    setLocal,
    onUpdate,
    onJoin,
    onLeave,
    roster: rosterList,
    isOnline,
    disconnect,
    get id() { return myId; },
  };

  try {
    if (typeof window !== 'undefined') window.Net = net;
  } catch (_) { /* ignore */ }

  return net;
}
