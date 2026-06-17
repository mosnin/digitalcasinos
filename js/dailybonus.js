// =============================================================
// Digital Casinos — daily login reward.
// Shows a "🎁 Daily Bonus" modal with a small reveal/spin animation
// that grants 100–500+ coins via economy.add, tracks a day streak,
// and records today's date. Once-per-day grant.
//
// New module — does NOT edit existing files. Imports UI for the
// modal host. Defensive everywhere: never throws.
// =============================================================

import { UI } from './ui.js';

const STORE_KEY = 'dc_dailybonus';

// ---- tiny helpers ------------------------------------------------
const safe = (fn, fallback) => {
  try { return fn(); } catch (e) { return fallback; }
};

// Local date string (not UTC) so "today" matches the player's clock.
function todayStr(d) {
  return safe(() => (d || new Date()).toDateString(), '');
}

function yesterdayStr() {
  return safe(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toDateString();
  }, '');
}

function loadState() {
  return safe(() => {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
    return null;
  }, null);
}

function saveState(state) {
  safe(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  });
}

// ---------------------------------------------------------------
// Public: returns true if a fresh bonus is available (and shows it).
export function maybeShowDailyBonus({ economy } = {}) {
  return safe(() => {
    const prev = loadState();
    const today = todayStr();
    if (prev && prev.date === today) return false; // already claimed today
    openDailyBonus({ economy, force: false });
    return true;
  }, false);
}

// ---------------------------------------------------------------
// Public: build + show the modal. Grants at most once per day.
export function openDailyBonus({ economy, force } = {}) {
  safe(() => {
    if (typeof document === 'undefined') return;

    const prev = loadState();
    const today = todayStr();
    const alreadyClaimed = !!(prev && prev.date === today);

    // ---- streak computation ----
    let streak = 1;
    if (alreadyClaimed) {
      streak = safe(() => Math.max(1, prev.streak | 0), 1);
    } else if (prev && prev.date === yesterdayStr()) {
      streak = safe(() => Math.max(1, (prev.streak | 0)) + 1, 1);
    } else {
      streak = 1;
    }

    // ---- reward (only when granting) ----
    const base = 100;
    const rand = Math.floor(Math.random() * 401);     // 0..400
    const streakBonus = Math.min(streak, 7) * 50;
    const reward = base + rand + streakBonus;

    // ---- build modal DOM ----
    const modal = document.createElement('div');
    modal.className = 'game-modal dc-dailybonus';

    const h = document.createElement('h2');
    h.textContent = '🎁 Daily Bonus';
    modal.appendChild(h);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.style.cssText = 'opacity:0.85;margin-bottom:8px;';
    modal.appendChild(sub);

    // reveal "reel" — a single row that cycles amounts then lands.
    const reel = document.createElement('div');
    reel.style.cssText =
      'margin:14px auto;width:220px;height:72px;display:flex;align-items:center;' +
      'justify-content:center;border-radius:14px;font-size:30px;font-weight:900;' +
      'letter-spacing:1px;color:#1a0f00;background:linear-gradient(135deg,#ffd23f,#ff9d00);' +
      'box-shadow:0 0 24px rgba(255,210,63,0.55);text-shadow:0 1px 0 rgba(255,255,255,0.35);';
    reel.textContent = '🎰';
    modal.appendChild(reel);

    const streakLine = document.createElement('div');
    streakLine.style.cssText = 'font-size:15px;font-weight:700;color:var(--neon2,#36e2ff);margin-top:4px;';
    streakLine.textContent = 'Day ' + streak + ' streak!';
    modal.appendChild(streakLine);

    const collect = document.createElement('button');
    collect.className = 'btn-small';
    collect.style.cssText = 'margin-top:16px;min-width:160px;font-weight:800;';
    collect.textContent = alreadyClaimed ? 'Close' : 'Collect';
    collect.disabled = true;
    collect.style.opacity = '0.5';
    modal.appendChild(collect);

    let spinTimer = null;
    let granted = false;

    const finish = () => {
      collect.disabled = false;
      collect.style.opacity = '1';
    };

    collect.addEventListener('click', () => {
      safe(() => {
        if (spinTimer) { clearInterval(spinTimer); spinTimer = null; }
        UI.closeModal();
      });
    });

    if (alreadyClaimed) {
      // already claimed today: show a "come back tomorrow" state, no grant.
      sub.textContent = 'Already collected today.';
      reel.textContent = '✅';
      reel.style.fontSize = '34px';
      streakLine.textContent = 'Come back tomorrow! (Day ' + streak + ' streak)';
      finish();
    } else {
      sub.textContent = 'Spinning your reward…';
      // spin animation — cycle random amounts, then land on the real reward.
      const lo = base;
      const hi = base + 400 + streakBonus;
      let ticks = 0;
      const totalTicks = 18;
      spinTimer = safe(() => setInterval(() => {
        safe(() => {
          ticks++;
          if (ticks >= totalTicks) {
            clearInterval(spinTimer);
            spinTimer = null;
            // grant exactly once
            if (!granted) {
              granted = true;
              safe(() => { if (economy && typeof economy.add === 'function') economy.add(reward); });
              saveState({ date: today, streak });
              safe(() => UI.toast && UI.toast('+' + reward + ' 🪙 daily bonus!', 'good'));
            }
            reel.textContent = '+' + reward + ' 🪙';
            sub.textContent = 'Your reward:';
            finish();
          } else {
            const r = lo + Math.floor(Math.random() * Math.max(1, (hi - lo)));
            reel.textContent = '+' + r;
          }
        });
      }, 80), null);

      // Fallback: if setInterval was unavailable, grant immediately.
      if (!spinTimer) {
        if (!granted) {
          granted = true;
          safe(() => { if (economy && typeof economy.add === 'function') economy.add(reward); });
          saveState({ date: today, streak });
        }
        reel.textContent = '+' + reward + ' 🪙';
        sub.textContent = 'Your reward:';
        finish();
      }
    }

    UI.openModal(modal);
  });
}
