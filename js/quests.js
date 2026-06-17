// =============================================================
// Digital Casinos — Daily Missions / Quests.
// A small set of daily missions that reset each day. Progress is
// tracked from economy.state.stats deltas (with stored day-start
// baselines) and explicit Quests.mark(eventName) calls.
//
// On completion a coin reward is granted via economy.add ONCE and
// onReward(mission) fires. Persists to localStorage 'dc_quests'.
//
// Public API:
//   Quests.init({ economy, onReward })
//   Quests.evaluate()
//   Quests.openPanel()
//   Quests.active()  -> missions array
//   Quests.mark(name, n = 1)
//
// Defensive everywhere: never throws.
// =============================================================
import { UI } from './ui.js';

const STORE_KEY = 'dc_quests';

const safe = (fn, fallback) => {
  try { return fn(); } catch (e) { return fallback; }
};

const todayStr = () => safe(() => new Date().toISOString().slice(0, 10), '1970-01-01');

// Mission templates. `event` (if present) is the mark() name; `stat`
// (if present) is the economy.state.stats key tracked via a day-start
// baseline. `goal` is the target progress.
function templates() {
  return [
    { id: 'win500',     name: 'Win 500 coins today',  goal: 500, reward: 250, stat: 'won', icon: '🪙' },
    { id: 'spin5',      name: 'Spin the reels 5 times', goal: 5, reward: 120, stat: 'spins', icon: '🎰' },
    { id: 'place2',     name: 'Place 2 machines',     goal: 2,   reward: 200, event: 'place_game', icon: '🛠️' },
    { id: 'race',       name: 'Bet on a horse race',  goal: 1,   reward: 150, event: 'race', icon: '🐎' },
    { id: 'visitgarden',name: 'Visit the Garden',     goal: 1,   reward: 100, event: 'visit_garden', icon: '🌿' },
    { id: 'buyparcel',  name: 'Buy a parcel',         goal: 1,   reward: 300, event: 'buy_parcel', icon: '🏷️' },
  ];
}

// Pick a small daily set (4-5) deterministically per-day so a refresh
// within the same day yields the same missions.
function pickForDay(date) {
  return safe(() => {
    const all = templates();
    // seed from the date string
    let seed = 0;
    for (let i = 0; i < date.length; i++) seed = (seed * 31 + date.charCodeAt(i)) >>> 0;
    // always keep the coin-win mission; shuffle the rest
    const pinned = all.filter((t) => t.id === 'win500');
    const rest = all.filter((t) => t.id !== 'win500').slice();
    for (let i = rest.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const j = seed % (i + 1);
      const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    const count = 3 + (seed % 2); // 3 or 4 of the rest -> total 4 or 5
    return pinned.concat(rest.slice(0, count));
  }, templates().slice(0, 5));
}

const Quests = {
  _economy: null,
  _onReward: null,
  _data: null, // { date, missions:[...], baselines:{stat:value} }
  _inited: false,

  // ---------------------------------------------------------------
  init({ economy, onReward } = {}) {
    return safe(() => {
      this._economy = economy || (typeof window !== 'undefined' ? window.Economy : null);
      this._onReward = (typeof onReward === 'function') ? onReward : null;

      const today = todayStr();
      let stored = this._read();

      if (!stored || stored.date !== today || !Array.isArray(stored.missions) || !stored.missions.length) {
        stored = this._freshDay(today);
      } else {
        // ensure baselines exist
        if (!stored.baselines || typeof stored.baselines !== 'object') {
          stored.baselines = this._snapshotStats();
        }
      }

      this._data = stored;
      this._inited = true;
      this._save();
      // immediately reconcile stat-based progress
      this.evaluate();
      return this._data.missions;
    }, []);
  },

  // ---------------------------------------------------------------
  _ensure() {
    if (!this._inited || !this._data) this.init({ economy: this._economy, onReward: this._onReward });
  },

  _stats() {
    return safe(() => {
      const s = this._economy && this._economy.state && this._economy.state.stats;
      return (s && typeof s === 'object') ? s : {};
    }, {});
  },

  _snapshotStats() {
    const s = this._stats();
    return {
      won: Number(s.won) || 0,
      wagered: Number(s.wagered) || 0,
      spins: Number(s.spins) || 0,
    };
  },

  _freshDay(date) {
    const missions = pickForDay(date).map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon || '🎯',
      goal: Number(t.goal) || 1,
      reward: Number(t.reward) || 0,
      stat: t.stat || null,
      event: t.event || null,
      progress: 0,
      done: false,
      claimed: false,
    }));
    return { date, missions, baselines: this._snapshotStats() };
  },

  // ---------------------------------------------------------------
  _read() {
    return safe(() => {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    }, null);
  },

  _save() {
    safe(() => {
      if (typeof localStorage === 'undefined' || !this._data) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(this._data));
    });
  },

  // ---------------------------------------------------------------
  // Increment progress for missions whose event matches.
  mark(name, n = 1) {
    safe(() => {
      this._ensure();
      if (!this._data || !Array.isArray(this._data.missions) || !name) return;
      const inc = Number(n);
      const step = isFinite(inc) ? inc : 1;
      let changed = false;
      for (const m of this._data.missions) {
        if (!m || m.event !== name) continue;
        if (m.done) continue;
        m.progress = Math.min(m.goal, (Number(m.progress) || 0) + step);
        if (m.progress >= m.goal) { m.progress = m.goal; m.done = true; }
        changed = true;
      }
      if (changed) {
        this._save();
        this.evaluate(); // grant any newly-completed rewards
      }
    });
  },

  // ---------------------------------------------------------------
  // Recompute stat-based missions from baselines, then grant rewards
  // for any newly-done (and not yet claimed) mission exactly once.
  evaluate() {
    return safe(() => {
      this._ensure();
      if (!this._data || !Array.isArray(this._data.missions)) return [];
      const stats = this._stats();
      const base = this._data.baselines || (this._data.baselines = this._snapshotStats());

      for (const m of this._data.missions) {
        if (!m) continue;
        if (m.stat) {
          const cur = Number(stats[m.stat]) || 0;
          const b = Number(base[m.stat]) || 0;
          const delta = Math.max(0, cur - b);
          m.progress = Math.min(m.goal, delta);
          if (m.progress >= m.goal) { m.progress = m.goal; m.done = true; }
        }
      }

      // grant rewards once
      for (const m of this._data.missions) {
        if (!m || !m.done || m.claimed) continue;
        m.claimed = true;
        if (m.reward > 0 && this._economy && typeof this._economy.add === 'function') {
          safe(() => this._economy.add(m.reward));
        }
        if (this._onReward) safe(() => this._onReward(m));
      }

      this._save();
      return this._data.missions;
    }, []);
  },

  // ---------------------------------------------------------------
  active() {
    this._ensure();
    return (this._data && Array.isArray(this._data.missions)) ? this._data.missions : [];
  },

  // ---------------------------------------------------------------
  openPanel() {
    safe(() => {
      this._ensure();
      this.evaluate();
      if (typeof document === 'undefined' || !UI || typeof UI.openModal !== 'function') return;

      const missions = this.active();

      const modal = document.createElement('div');
      modal.className = 'game-modal quests-panel';

      const close = document.createElement('button');
      close.className = 'game-close btn-small btn-ghost';
      close.textContent = '✕';
      close.addEventListener('click', () => safe(() => UI.closeModal && UI.closeModal()));
      modal.appendChild(close);

      const h = document.createElement('h2');
      h.textContent = '🎯 Daily Missions';
      modal.appendChild(h);

      const sub = document.createElement('div');
      sub.className = 'sub';
      const doneCount = missions.filter((m) => m && m.done).length;
      sub.textContent = doneCount + ' / ' + missions.length + ' complete — resets daily';
      modal.appendChild(sub);

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:10px;';

      if (!missions.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'opacity:0.7;padding:8px 0;';
        empty.textContent = 'No missions available.';
        wrap.appendChild(empty);
      }

      missions.forEach((m) => {
        if (!m) return;
        const progress = Math.max(0, Math.min(m.goal, Number(m.progress) || 0));
        const pct = m.goal > 0 ? Math.round((progress / m.goal) * 100) : 0;

        const row = document.createElement('div');
        row.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);' +
          'border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;' +
          (m.done ? 'box-shadow:0 0 0 1px rgba(46,194,126,0.5) inset;' : '');

        const top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;';

        const title = document.createElement('span');
        title.style.cssText = 'font-weight:700;';
        title.textContent = (m.icon ? m.icon + '  ' : '') + (m.name || m.id || 'Mission');
        top.appendChild(title);

        const state = document.createElement('span');
        if (m.done) {
          state.textContent = '✓ ' + (m.claimed ? 'claimed' : 'done');
          state.style.cssText = 'font-size:12px;font-weight:800;color:#1a0f00;background:#2ec27e;' +
            'padding:1px 8px;border-radius:8px;';
        } else {
          state.textContent = '+' + (Number(m.reward) || 0) + ' 🪙';
          state.style.cssText = 'font-size:12px;font-weight:700;color:var(--gold,#ffd23f);';
        }
        top.appendChild(state);
        row.appendChild(top);

        // progress bar
        const barOuter = document.createElement('div');
        barOuter.style.cssText = 'position:relative;height:14px;background:rgba(0,0,0,0.35);' +
          'border-radius:8px;overflow:hidden;';
        const barInner = document.createElement('div');
        barInner.style.cssText = 'height:100%;width:' + pct + '%;border-radius:8px;transition:width .3s;' +
          'background:' + (m.done ? 'linear-gradient(90deg,#2ec27e,#27a567)' : 'linear-gradient(90deg,#ff9d00,#ffd23f)') + ';';
        barOuter.appendChild(barInner);
        row.appendChild(barOuter);

        const meta = document.createElement('div');
        meta.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;opacity:0.8;';
        const prog = document.createElement('span');
        prog.textContent = progress + ' / ' + m.goal;
        const rew = document.createElement('span');
        rew.textContent = 'Reward: ' + (Number(m.reward) || 0) + ' 🪙';
        meta.appendChild(prog);
        meta.appendChild(rew);
        row.appendChild(meta);

        wrap.appendChild(row);
      });

      modal.appendChild(wrap);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-small';
      closeBtn.style.cssText = 'margin-top:14px;width:100%;';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => safe(() => UI.closeModal && UI.closeModal()));
      modal.appendChild(closeBtn);

      UI.openModal(modal);
    });
  },
};

export { Quests };
if (typeof window !== 'undefined') window.Quests = Quests;
