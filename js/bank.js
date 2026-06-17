// =============================================================
// Digital Casinos — Vault & Bank (single-player system).
// Deposit/withdraw coins to a vault, take/repay loans, and accrue
// daily interest (vault +2%/day, debt +5%/day).
//
// State lives on economy.state.bank = { vault, debt, lastInterest }.
// Built with createElement, reusing existing CSS classes from
// css/style.css (.game-modal, .balance, .bet-row, .btn-row,
// .btn-small, .btn-ghost). Defensive everywhere: never throws.
// =============================================================

import { UI } from './ui.js';

const LOAN_CAP = 5000; // maximum total outstanding debt
const VAULT_RATE = 0.02; // +2% per day
const DEBT_RATE = 0.05; // +5% per day

// ---- helpers ------------------------------------------------------
const safe = (fn, fallback) => {
  try { return fn(); } catch (e) { return fallback; }
};

// Local date string (YYYY-MM-DD) — interest applies once per local day.
function todayString() {
  return safe(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }, '1970-01-01');
}

// Coerce to a non-negative integer (>=0). Returns 0 for bad input.
function toNonNegInt(n) {
  const v = Math.floor(Number(n));
  if (!isFinite(v) || v < 0) return 0;
  return v;
}

// Parse a user-entered amount: integer >= 1, else null (invalid).
function parseAmount(raw) {
  const v = Math.floor(Number(raw));
  if (!isFinite(v) || v < 1) return null;
  return v;
}

// Ensure economy.state.bank exists & is well-formed; persist if created.
function getBank(economy) {
  if (!economy || !economy.state) return { vault: 0, debt: 0, lastInterest: todayString() };
  let created = false;
  let b = economy.state.bank;
  if (!b || typeof b !== 'object') {
    b = { vault: 0, debt: 0, lastInterest: todayString() };
    economy.state.bank = b;
    created = true;
  }
  // sanitize fields (never negative)
  const vault = toNonNegInt(b.vault);
  const debt = toNonNegInt(b.debt);
  if (vault !== b.vault) { b.vault = vault; created = true; }
  if (debt !== b.debt) { b.debt = debt; created = true; }
  if (typeof b.lastInterest !== 'string' || !b.lastInterest) {
    b.lastInterest = todayString();
    created = true;
  }
  if (created) safe(() => economy.save && economy.save());
  return b;
}

function coinsOf(economy) {
  return safe(() => {
    const c = economy && economy.state ? economy.state.coins : 0;
    return toNonNegInt(c);
  }, 0);
}

// =============================================================
// applyDailyInterest — call-safe at startup. Applies once per day.
// =============================================================
export function applyDailyInterest({ economy } = {}) {
  return safe(() => {
    if (!economy || !economy.state) return false;
    const b = getBank(economy);
    const today = todayString();
    if (b.lastInterest === today) return false; // already applied today

    // Apply a single round of interest regardless of how many days passed.
    if (b.vault > 0) b.vault = b.vault + Math.round(b.vault * VAULT_RATE);
    if (b.debt > 0) b.debt = b.debt + Math.round(b.debt * DEBT_RATE);
    b.vault = toNonNegInt(b.vault);
    b.debt = toNonNegInt(b.debt);
    b.lastInterest = today;
    safe(() => economy.save && economy.save());
    return true;
  }, false);
}

// =============================================================
// openBank — the Vault & Bank modal.
// =============================================================
export function openBank({ economy } = {}) {
  return safe(() => {
    if (typeof document === 'undefined') return;
    if (!economy || !economy.state) return;

    const bank = getBank(economy);
    // freshen interest whenever the bank is opened
    applyDailyInterest({ economy });

    const modal = document.createElement('div');
    modal.className = 'game-modal bank-modal';

    // ---- close button ----
    const close = document.createElement('button');
    close.className = 'game-close btn-small btn-ghost';
    close.textContent = '✕';
    close.addEventListener('click', () => UI.closeModal());
    modal.appendChild(close);

    // ---- title ----
    const h = document.createElement('h2');
    h.textContent = '🏦 Vault & Bank';
    modal.appendChild(h);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = 'Vault earns +2%/day · Loans accrue +5%/day';
    modal.appendChild(sub);

    // ---- figures (coins / vault / debt) ----
    const figures = document.createElement('div');
    figures.className = 'balance';
    figures.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:10px 0;';
    modal.appendChild(figures);

    const mkFig = (label) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:16px;';
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('b');
      v.style.cssText = 'color:var(--gold);';
      row.appendChild(l);
      row.appendChild(v);
      figures.appendChild(row);
      return v;
    };
    const coinsVal = mkFig('Coins on hand');
    const vaultVal = mkFig('Vault balance');
    const debtVal = mkFig('Outstanding debt');

    const fmt = (n) => safe(() => Number(n).toLocaleString('en-US'), String(n));

    function render() {
      const b = getBank(economy);
      coinsVal.textContent = fmt(coinsOf(economy)) + ' 🪙';
      vaultVal.textContent = fmt(b.vault) + ' 🪙';
      debtVal.textContent = fmt(b.debt) + ' 🪙';
      debtVal.style.color = b.debt > 0 ? '#ff6b6b' : 'var(--gold)';
    }

    // ---- generic action row: label + input + button ----
    const mkActionRow = (labelText, btnText, onAction) => {
      const row = document.createElement('div');
      row.className = 'bet-row';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;';

      const lab = document.createElement('span');
      lab.textContent = labelText;
      lab.style.cssText = 'flex:1;min-width:90px;';

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.value = '100';
      input.style.cssText = 'width:96px;padding:4px 6px;';

      const btn = document.createElement('button');
      btn.className = 'btn-small';
      btn.textContent = btnText;
      const fire = () => safe(() => {
        onAction(parseAmount(input.value));
        render();
      });
      btn.addEventListener('click', fire);
      input.addEventListener('keydown', (e) => { if (e && e.key === 'Enter') fire(); });

      row.appendChild(lab);
      row.appendChild(input);
      row.appendChild(btn);
      modal.appendChild(row);
      return row;
    };

    // ---- Deposit: coins -> vault ----
    mkActionRow('Deposit', 'Deposit', (amount) => {
      if (amount == null) { UI.toast('Enter a whole amount (≥1).', 'bad'); return; }
      if (coinsOf(economy) < amount) { UI.toast('Not enough coins to deposit.', 'bad'); return; }
      const ok = safe(() => economy.spend(amount), false);
      if (!ok) { UI.toast('Not enough coins to deposit.', 'bad'); return; }
      const b = getBank(economy);
      b.vault = toNonNegInt(b.vault + amount);
      safe(() => economy.save && economy.save());
      UI.toast('Deposited ' + fmt(amount) + ' 🪙 to your vault.', 'good');
    });

    // ---- Withdraw: vault -> coins ----
    mkActionRow('Withdraw', 'Withdraw', (amount) => {
      if (amount == null) { UI.toast('Enter a whole amount (≥1).', 'bad'); return; }
      const b = getBank(economy);
      if (b.vault < amount) { UI.toast('Your vault does not hold that much.', 'bad'); return; }
      b.vault = toNonNegInt(b.vault - amount);
      safe(() => economy.add(amount));
      safe(() => economy.save && economy.save());
      UI.toast('Withdrew ' + fmt(amount) + ' 🪙 from your vault.', 'good');
    });

    // ---- Take Loan: adds to coins + debt, capped ----
    mkActionRow('Take Loan', 'Borrow', (amount) => {
      if (amount == null) { UI.toast('Enter a whole amount (≥1).', 'bad'); return; }
      const b = getBank(economy);
      if (b.debt + amount > LOAN_CAP) {
        const room = Math.max(0, LOAN_CAP - b.debt);
        UI.toast('Loan cap is ' + fmt(LOAN_CAP) + ' 🪙. You can borrow ' + fmt(room) + ' more.', 'bad');
        return;
      }
      safe(() => economy.add(amount));
      b.debt = toNonNegInt(b.debt + amount);
      safe(() => economy.save && economy.save());
      UI.toast('Borrowed ' + fmt(amount) + ' 🪙. Debt: ' + fmt(b.debt) + ' 🪙.', 'good');
    });

    // ---- Repay: coins -> debt ----
    mkActionRow('Repay', 'Repay', (amount) => {
      if (amount == null) { UI.toast('Enter a whole amount (≥1).', 'bad'); return; }
      const b = getBank(economy);
      if (b.debt <= 0) { UI.toast('You have no debt to repay.', 'bad'); return; }
      const pay = Math.min(amount, b.debt);
      if (coinsOf(economy) < pay) { UI.toast('Not enough coins to repay.', 'bad'); return; }
      const ok = safe(() => economy.spend(pay), false);
      if (!ok) { UI.toast('Not enough coins to repay.', 'bad'); return; }
      b.debt = toNonNegInt(b.debt - pay);
      safe(() => economy.save && economy.save());
      UI.toast('Repaid ' + fmt(pay) + ' 🪙. Debt: ' + fmt(b.debt) + ' 🪙.', 'good');
    });

    // ---- footer: done button ----
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;';
    const done = document.createElement('button');
    done.className = 'btn-small btn-ghost';
    done.textContent = 'Done';
    done.addEventListener('click', () => UI.closeModal());
    btnRow.appendChild(done);
    modal.appendChild(btnRow);

    render();
    UI.openModal(modal);
  });
}
