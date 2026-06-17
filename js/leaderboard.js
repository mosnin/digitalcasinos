// =============================================================
// Digital Casinos — net-worth leaderboard.
// `computeNetWorth(economy)` totals coins + the catalog value of every
// owned parcel, placed game and decoration. `submitScore` pushes the
// player's score to Supabase (or localStorage in guest mode), and
// `openLeaderboard` renders a ranked `.game-modal` board.
//
// Never throws — every path is guarded and always renders something.
//
// -------------------------------------------------------------
// SUPABASE TABLE + RLS (run once in the SQL editor):
//
//   create table if not exists public.leaderboard (
//     user_id    uuid primary key references auth.users (id) on delete cascade,
//     name       text not null default 'Player',
//     net_worth  bigint not null default 0,
//     updated_at timestamptz not null default now()
//   );
//
//   alter table public.leaderboard enable row level security;
//
//   -- anyone (incl. anon) may read the board
//   create policy "leaderboard_read"
//     on public.leaderboard for select
//     using (true);
//
//   -- a signed-in user may insert only their own row
//   create policy "leaderboard_insert_own"
//     on public.leaderboard for insert
//     with check (auth.uid() = user_id);
//
//   -- a signed-in user may update only their own row
//   create policy "leaderboard_update_own"
//     on public.leaderboard for update
//     using (auth.uid() = user_id)
//     with check (auth.uid() = user_id);
// =============================================================

import { SUPABASE, GAME_CATALOG, DECOR_CATALOG } from './config.js';

const PARCEL_BASE_VALUE = 150;
const SUPA_ESM = 'https://esm.sh/@supabase/supabase-js@2';
const LS_ME = 'dc_leaderboard_me';

// ---- tiny guards -----------------------------------------------------
const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
const fmt = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.round(v).toLocaleString('en-US');
};

function gameCost(type) {
  return safe(() => {
    const g = GAME_CATALOG[type];
    return (g && typeof g.cost === 'number') ? g.cost : 0;
  }, 0);
}
function decorCost(id) {
  return safe(() => {
    const d = DECOR_CATALOG[id];
    return (d && typeof d.cost === 'number') ? d.cost : 0;
  }, 0);
}

// =====================================================================
// Net worth
// =====================================================================
export function computeNetWorth(economy) {
  return safe(() => {
    if (!economy) return 0;
    const state = economy.state || {};
    let total = Number(state.coins) || 0;

    const parcels = state.parcels || {};
    for (const key of Object.keys(parcels)) {
      const p = parcels[key];
      if (!p || !p.owned) continue;
      total += PARCEL_BASE_VALUE;

      const games = safe(() => economy.getGames(key), p.games) || [];
      for (const g of games) {
        if (g && g.type) total += gameCost(g.type);
      }

      const decor = safe(() => economy.getDecor(key), p.decor) || [];
      for (const d of decor) {
        if (d && d.id) total += decorCost(d.id);
      }
    }
    return Math.round(total);
  }, Math.round(Number(economy && economy.state && economy.state.coins) || 0));
}

// =====================================================================
// Supabase helpers
// =====================================================================
function supabaseConfigured() {
  return !!(SUPABASE && SUPABASE.url && SUPABASE.anonKey);
}

async function getClient() {
  if (!supabaseConfigured()) return null;
  try {
    const mod = await import(/* @vite-ignore */ SUPA_ESM);
    const createClient = mod && (mod.createClient || (mod.default && mod.default.createClient));
    if (typeof createClient !== 'function') return null;
    return createClient(SUPABASE.url, SUPABASE.anonKey);
  } catch (e) {
    return null;
  }
}

function playerName(economy, override) {
  if (override && String(override).trim()) return String(override).trim().slice(0, 24);
  return safe(() => {
    const n = economy && economy.state && economy.state.profile && economy.state.profile.name;
    return (n && String(n).trim()) ? String(n).trim().slice(0, 24) : 'Player';
  }, 'Player');
}

// =====================================================================
// Submit score — never throws, resolves quietly.
// =====================================================================
export async function submitScore({ economy, name } = {}) {
  try {
    const netWorth = computeNetWorth(economy);
    const who = playerName(economy, name);

    if (supabaseConfigured()) {
      const supabase = await getClient();
      if (!supabase) return;
      let userId = null;
      try {
        const res = await supabase.auth.getUser();
        userId = res && res.data && res.data.user && res.data.user.id;
      } catch (e) { userId = null; }
      if (!userId) return; // not signed in — skip quietly
      try {
        await supabase.from('leaderboard').upsert(
          {
            user_id: userId,
            name: who,
            net_worth: netWorth,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      } catch (e) { /* ignore network/db errors */ }
      return;
    }

    // guest mode — store locally
    try {
      localStorage.setItem(LS_ME, JSON.stringify({ name: who, net_worth: netWorth }));
    } catch (e) { /* ignore */ }
  } catch (e) {
    // never throw
  }
}

// =====================================================================
// localStorage board (guest mode)
// =====================================================================
const BOT_SCORES = [
  { name: 'Ace McFortune', net_worth: 18420 },
  { name: 'Vegas Vivian', net_worth: 14250 },
  { name: 'Diamond Dex', net_worth: 11800 },
  { name: 'Lucky Lola', net_worth: 9300 },
  { name: 'Royal Reggie', net_worth: 7650 },
  { name: 'Neon Nadia', net_worth: 5400 },
  { name: 'Jackpot Jimmy', net_worth: 3120 },
  { name: 'Two-Card Tony', net_worth: 1875 },
];

function localBoard(economy) {
  const rows = BOT_SCORES.map((b) => ({ name: b.name, net_worth: b.net_worth, you: false }));

  // current player's score (recompute fresh; also persist)
  const myWorth = computeNetWorth(economy);
  const myName = playerName(economy);
  safe(() => localStorage.setItem(LS_ME, JSON.stringify({ name: myName, net_worth: myWorth })));

  rows.push({ name: myName, net_worth: myWorth, you: true });
  rows.sort((a, b) => b.net_worth - a.net_worth);
  return rows;
}

// =====================================================================
// Rendering
// =====================================================================
function buildShell() {
  const modal = document.createElement('div');
  modal.className = 'game-modal leaderboard-modal';
  modal.style.cssText = 'min-width:340px;max-width:440px;';

  const close = document.createElement('button');
  close.className = 'game-close btn-small btn-ghost';
  close.textContent = '✕';
  close.addEventListener('click', () => safe(() => window.UI && window.UI.closeModal()));
  modal.appendChild(close);

  const h = document.createElement('h2');
  h.textContent = '🏆 Leaderboard';
  modal.appendChild(h);

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'Top net worth across the mega-casino';
  modal.appendChild(sub);

  const body = document.createElement('div');
  body.className = 'lb-body';
  body.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto;';
  modal.appendChild(body);

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:14px;display:flex;justify-content:flex-end;';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-small';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => safe(() => window.UI && window.UI.closeModal()));
  footer.appendChild(closeBtn);
  modal.appendChild(footer);

  return { modal, body };
}

function rowEl(rank, name, worth, highlight) {
  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;' +
    (highlight
      ? 'background:linear-gradient(135deg,rgba(255,210,63,0.22),rgba(255,45,184,0.18));' +
        'box-shadow:0 0 10px rgba(255,210,63,0.35);font-weight:800;'
      : 'background:rgba(255,255,255,0.04);');

  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ('#' + rank);
  const rankEl = document.createElement('span');
  rankEl.style.cssText = 'width:34px;text-align:center;color:var(--gold);font-weight:800;';
  rankEl.textContent = medal;

  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  nameEl.textContent = (highlight ? '★ ' : '') + (name || 'Player');

  const worthEl = document.createElement('span');
  worthEl.style.cssText = 'color:var(--neon2,#18e0ff);font-weight:700;';
  worthEl.textContent = fmt(worth) + ' 🪙';

  row.appendChild(rankEl);
  row.appendChild(nameEl);
  row.appendChild(worthEl);
  return row;
}

function fillBoard(body, rows, opts) {
  if (!body) return;
  body.innerHTML = '';
  if (!rows || !rows.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px;text-align:center;opacity:0.7;';
    empty.textContent = 'No scores yet — go build your empire!';
    body.appendChild(empty);
    return;
  }
  const myId = opts && opts.myId;
  const myWorth = opts && typeof opts.myWorth === 'number' ? opts.myWorth : null;
  rows.forEach((r, i) => {
    let highlight = !!r.you;
    if (!highlight && myId && r.user_id && r.user_id === myId) highlight = true;
    body.appendChild(rowEl(i + 1, r.name, r.net_worth, highlight));
  });
}

// =====================================================================
// Open leaderboard
// =====================================================================
export function openLeaderboard({ economy } = {}) {
  return safe(() => {
    if (typeof document === 'undefined') return;
    const { modal, body } = buildShell();

    if (!supabaseConfigured()) {
      fillBoard(body, localBoard(economy));
      safe(() => window.UI && window.UI.openModal(modal));
      return;
    }

    // Supabase path — show a loading state, then fill asynchronously.
    const loading = document.createElement('div');
    loading.style.cssText = 'padding:18px;text-align:center;opacity:0.75;';
    loading.textContent = 'Loading…';
    body.appendChild(loading);
    safe(() => window.UI && window.UI.openModal(modal));

    (async () => {
      // make sure our own score is up to date before reading the board
      await safe(() => submitScore({ economy }), null);

      const supabase = await getClient();
      let rows = null;
      let myId = null;
      if (supabase) {
        try {
          const ures = await supabase.auth.getUser();
          myId = ures && ures.data && ures.data.user && ures.data.user.id;
        } catch (e) { myId = null; }
        try {
          const { data } = await supabase
            .from('leaderboard')
            .select('user_id,name,net_worth')
            .order('net_worth', { ascending: false })
            .limit(20);
          if (Array.isArray(data)) rows = data;
        } catch (e) { rows = null; }
      }

      if (rows && rows.length) {
        fillBoard(body, rows, { myId });
      } else {
        // network/db failed — never leave it blank; fall back to local board.
        fillBoard(body, localBoard(economy));
      }
    })();
  });
}

if (typeof window !== 'undefined') {
  safe(() => {
    window.Leaderboard = { computeNetWorth, submitScore, openLeaderboard };
  });
}
