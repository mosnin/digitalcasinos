// =============================================================
// Digital Casinos — shared ownership of parcels & hotel rooms.
// Every player upserts the parcels/rooms they own into a shared
// `holdings` table; everyone reads all rows so the world shows
// who owns what (HUD/minimap labels). Offline/guest => local-only,
// every owner lookup returns null. Never throws.
//
// --- Supabase table + RLS (run once in the SQL editor) ---
// create table holdings (
//   user_id uuid references auth.users on delete cascade,
//   name text,
//   kind text,
//   item_key text,
//   updated_at timestamptz default now(),
//   primary key (kind, item_key)
// );
// alter table holdings enable row level security;
// create policy "read all" on holdings for select using (true);
// create policy "write own" on holdings for all
//   using (auth.uid() = user_id) with check (auth.uid() = user_id);
// =============================================================

import { SUPABASE } from './config.js';

export function createHoldings() {
  let supabase = null;     // Supabase client (or null when offline)
  let myId = null;         // signed-in user id (null when guest/offline)
  let online = false;      // true once connected with a signed-in user
  let channel = null;      // realtime subscription
  const map = new Map();   // `${kind}:${item_key}` -> { name, user_id }
  const changeCbs = new Set();

  const isConfigured = () => !!(SUPABASE && SUPABASE.url && SUPABASE.anonKey);

  function fire() {
    for (const cb of changeCbs) {
      try { cb(); } catch (e) { /* ignore */ }
    }
  }

  // Lazily create the client and resolve a signed-in user id.
  async function ensureClient() {
    if (!isConfigured()) return false;
    try {
      if (!supabase) {
        const mod = await import('https://esm.sh/@supabase/supabase-js@2');
        const createClient = mod.createClient || (mod.default && mod.default.createClient);
        if (!createClient) return false;
        supabase = createClient(SUPABASE.url, SUPABASE.anonKey);
      }
      if (!myId) {
        const res = await supabase.auth.getUser();
        const user = res && res.data && res.data.user;
        if (user && user.id) myId = user.id;
      }
      online = !!myId;
      return online;
    } catch (e) {
      online = false;
      return false;
    }
  }

  // Upsert owned parcels/rooms; delete rows this user no longer owns.
  async function sync(economy) {
    try {
      if (!economy || !isConfigured()) return;
      const ok = await ensureClient();
      if (!ok || !myId || !supabase) return; // offline/guest => no-op

      const name = (economy.state && economy.state.profile && economy.state.profile.name) || 'Player';
      let parcelKeys = [];
      let roomIds = [];
      try { parcelKeys = economy.ownedParcelKeys() || []; } catch (e) { parcelKeys = []; }
      try { roomIds = economy.ownedRoomIds() || []; } catch (e) { roomIds = []; }

      const rows = [];
      for (const key of parcelKeys) rows.push({ user_id: myId, name, kind: 'parcel', item_key: String(key) });
      for (const id of roomIds) rows.push({ user_id: myId, name, kind: 'room', item_key: String(id) });

      if (rows.length) {
        try { await supabase.from('holdings').upsert(rows, { onConflict: 'kind,item_key' }); } catch (e) { /* ignore */ }
      }

      // Delete this user's rows that are no longer owned.
      const ownedSet = new Set(rows.map(r => `${r.kind}:${r.item_key}`));
      try {
        const res = await supabase.from('holdings').select('kind,item_key').eq('user_id', myId);
        const mine = (res && res.data) || [];
        const stale = mine.filter(r => !ownedSet.has(`${r.kind}:${r.item_key}`));
        for (const r of stale) {
          try {
            await supabase.from('holdings').delete()
              .eq('user_id', myId).eq('kind', r.kind).eq('item_key', r.item_key);
          } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }

      await refresh();
    } catch (e) { /* never throw */ }
  }

  function indexRow(row) {
    if (!row || row.kind == null || row.item_key == null) return;
    map.set(`${row.kind}:${row.item_key}`, { name: row.name || 'Player', user_id: row.user_id });
  }

  // Fetch all rows, rebuild the map, and subscribe to live changes.
  async function refresh() {
    try {
      const ok = await ensureClient();
      if (!ok || !supabase) return; // offline => keep empty map

      try {
        const res = await supabase.from('holdings').select('user_id,name,kind,item_key');
        const rows = (res && res.data) || [];
        map.clear();
        for (const row of rows) indexRow(row);
        fire();
      } catch (e) { /* ignore */ }

      if (!channel) {
        try {
          channel = supabase
            .channel('holdings-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holdings' }, (payload) => {
              try {
                if (payload.eventType === 'DELETE') {
                  const old = payload.old || {};
                  if (old.kind != null && old.item_key != null) map.delete(`${old.kind}:${old.item_key}`);
                } else {
                  indexRow(payload.new);
                }
                fire();
              } catch (e) { /* ignore */ }
            })
            .subscribe();
        } catch (e) { channel = null; }
      }
    } catch (e) { /* never throw */ }
  }

  function ownerOf(kind, key) {
    try {
      if (!online) return null;
      const entry = map.get(`${kind}:${key}`);
      if (!entry) return null;
      return { name: entry.name || 'Player', isMe: !!(myId && entry.user_id === myId) };
    } catch (e) { return null; }
  }

  function onChange(cb) {
    if (typeof cb === 'function') changeCbs.add(cb);
    return () => changeCbs.delete(cb);
  }

  function isOnline() { return online; }

  function disconnect() {
    try {
      if (channel && supabase) supabase.removeChannel(channel);
    } catch (e) { /* ignore */ }
    channel = null;
    online = false;
    map.clear();
  }

  const holdings = { sync, refresh, ownerOf, onChange, isOnline, disconnect };
  if (typeof window !== 'undefined') window.Holdings = holdings;
  return holdings;
}
