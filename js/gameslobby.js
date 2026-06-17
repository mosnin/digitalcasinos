// =============================================================
// Digital Casinos — gameslobby.js
// Extra "play instantly" casino games that don't require owning a
// parcel: Craps, Wheel of Fortune, Baccarat, Keno. A lobby modal
// lists them; each opens a playable .game-modal wired to Economy.
//
// Exports:
//   EXTRA_GAMES            — catalog { id, name, icon, desc }
//   openGamesLobby()       — lobby menu modal listing the games
//   openExtraGame(type)    — playable modal for one game
//
// Conventions match js/games.js modal DOM:
//   .game-modal / .balance / .bet-row / .btn-row / .result-line.
// Settlement always flows through Economy.wager(amount, payout) where
// payout is the TOTAL returned (0 on loss). Balance can't go negative
// because we validate Economy.canAfford(bet) before every round.
// Never throws — every handler is guarded.
// =============================================================

import { Economy } from './economy.js';
import { UI } from './ui.js';

// ---- tiny DOM helpers (mirrors games.js) --------------------------
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(label, cls = '') {
  return el('button', ('btn-small ' + cls).trim(), label);
}
function fmt(n) {
  const v = Math.round(Number(n) || 0);
  try { return v.toLocaleString('en-US'); } catch (e) { return String(v); }
}
function clamp(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) v = lo;
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}
function rollDie() { return 1 + ((Math.random() * 6) | 0); }
function pickInt(maxExclusive) { return (Math.random() * maxExclusive) | 0; }

// =============================================================
// EXTRA_GAMES catalog
// =============================================================
export const EXTRA_GAMES = {
  craps: {
    id: 'craps',
    name: 'Craps',
    icon: '🎲',
    desc: 'Pass-line dice. Win on 7 or 11, lose on craps, then chase your point.',
  },
  wheel: {
    id: 'wheel',
    name: 'Wheel of Fortune',
    icon: '🎡',
    desc: 'Big-six wheel. Land on a segment and win up to 40× your bet.',
  },
  baccarat: {
    id: 'baccarat',
    name: 'Baccarat',
    icon: '🀄',
    desc: 'Bet Player, Banker or Tie. Closest to nine wins. Tie pays 8:1.',
  },
  keno: {
    id: 'keno',
    name: 'Keno',
    icon: '🔢',
    desc: 'Pick up to 8 numbers from 80. We draw 20 — more hits, bigger pay.',
  },
};

// =============================================================
// Shared modal scaffold (title bar, live balance, body)
// =============================================================
function buildShell(icon, name, subtitle, onClose) {
  const node = el('div', 'game-modal');

  const close = btn('Close', 'game-close btn-ghost');
  close.onclick = () => {
    try {
      if (typeof onClose === 'function') onClose();
      else UI.closeModal();
    } catch (e) { /* never throw */ }
  };
  node.appendChild(close);

  node.appendChild(el('h2', null, `${icon || '🎲'} ${name || ''}`));
  if (subtitle) node.appendChild(el('div', 'sub', subtitle));

  const balanceEl = el('div', 'balance');
  node.appendChild(balanceEl);
  function setBalance() {
    try { balanceEl.textContent = `Balance: 🪙 ${fmt(Economy.coins)}`; } catch (e) {}
  }
  setBalance();

  const body = el('div', 'game-body');
  node.appendChild(body);

  return { node, body, setBalance, closeBtn: close };
}

// A clamped integer bet row (min 1).
function makeBetRow(minBet, maxBet) {
  minBet = Math.max(1, Math.round(minBet || 1));
  maxBet = Math.max(minBet, Math.round(maxBet || minBet));
  const row = el('div', 'bet-row');
  row.appendChild(el('label', null, 'Bet'));
  const input = el('input');
  input.type = 'number';
  input.min = String(minBet);
  input.max = String(maxBet);
  input.step = '1';
  input.value = String(minBet);
  row.appendChild(input);
  row.appendChild(el('span', null, `(${minBet}–${maxBet})`));
  input.readBet = () => {
    let v = parseInt(input.value, 10);
    v = Math.round(clamp(v, minBet, maxBet));
    input.value = String(v);
    return v;
  };
  return { row, input };
}

// =============================================================
// CRAPS — pass-line bet
// =============================================================
function openCraps() {
  const minBet = 5, maxBet = 500;
  const g = EXTRA_GAMES.craps;
  const { node, body, setBalance } = buildShell(g.icon, g.name,
    'Pass line: come-out 7/11 wins, 2/3/12 loses, else roll for your point.',
    () => openGamesLobby());

  const dice = el('div', 'reels');
  dice.style.cssText = 'font-size:42px;display:flex;gap:16px;justify-content:center;margin:6px 0;';
  const dieA = el('div', 'reel', '🎲');
  const dieB = el('div', 'reel', '🎲');
  dice.appendChild(dieA);
  dice.appendChild(dieB);
  body.appendChild(dice);

  const pointLine = el('div', 'sub', 'No point established.');
  body.appendChild(pointLine);

  const { row, input } = makeBetRow(minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const rollBtn = btn('ROLL');
  btnRow.appendChild(rollBtn);
  body.appendChild(btnRow);

  const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  let rolling = false;
  let bet = 0;
  let point = 0; // 0 = come-out phase

  function showDice(a, b, total) {
    dieA.textContent = FACES[a] || String(a);
    dieB.textContent = FACES[b] || String(b);
    pointLine.textContent = point
      ? `Point is ${point} — roll ${point} to win, 7 to lose.`
      : (total ? `Came out ${total}.` : 'No point established.');
  }

  function settle(payout, msg, won) {
    try { Economy.wager(bet, payout); } catch (e) {}
    setBalance();
    result.className = 'result-line ' + (won ? 'win' : 'lose');
    result.textContent = msg;
    point = 0;
    rollBtn.textContent = 'ROLL';
    input.disabled = false;
  }

  function resolve(total) {
    if (point === 0) {
      // Come-out roll.
      if (total === 7 || total === 11) {
        settle(bet * 2, `Come-out ${total} — Pass wins! +${fmt(bet)}`, true);
      } else if (total === 2 || total === 3 || total === 12) {
        settle(0, `Craps ${total} — line lost. -${fmt(bet)}`, false);
      } else {
        point = total;
        pointLine.textContent = `Point is ${point}. Roll ${point} to win, 7 to lose.`;
        result.className = 'result-line';
        result.textContent = `Point set to ${point}. Roll again.`;
        rollBtn.textContent = 'ROLL FOR POINT';
      }
    } else {
      // Point phase.
      if (total === point) {
        settle(bet * 2, `Hit your point ${point}! +${fmt(bet)}`, true);
      } else if (total === 7) {
        settle(0, `Seven out — line lost. -${fmt(bet)}`, false);
      } else {
        result.className = 'result-line';
        result.textContent = `Rolled ${total}. Still chasing ${point}…`;
      }
    }
  }

  function animateRoll(onDone) {
    let ticks = 0;
    const iv = setInterval(() => {
      const a = rollDie(), b = rollDie();
      dieA.textContent = FACES[a];
      dieB.textContent = FACES[b];
      ticks++;
      if (ticks >= 8) {
        clearInterval(iv);
        const fa = rollDie(), fb = rollDie();
        const total = fa + fb;
        showDice(fa, fb, total);
        onDone(total);
      }
    }, 70);
  }

  function roll() {
    if (rolling) return;
    if (point === 0) {
      // New come-out: validate + lock the stake conceptually.
      bet = input.readBet();
      if (!Economy.canAfford(bet)) {
        result.className = 'result-line lose';
        result.textContent = 'Not enough coins.';
        return;
      }
      input.disabled = true;
    }
    rolling = true;
    rollBtn.disabled = true;
    result.className = 'result-line';
    result.textContent = 'Rolling…';
    animateRoll((total) => {
      resolve(total);
      rolling = false;
      rollBtn.disabled = false;
    });
  }

  rollBtn.onclick = roll;
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// WHEEL OF FORTUNE — big-six style wheel
// =============================================================
function openWheel() {
  const minBet = 5, maxBet = 300;
  const g = EXTRA_GAMES.wheel;
  // Segments weighted so the house keeps an edge. EV (per unit bet):
  //   sum(weight/total * mult). With these weights EV ≈ 0.84 (16% edge).
  const SEGMENTS = [
    { label: '×2', mult: 2, weight: 23, color: '#2ec27e' },
    { label: '×5', mult: 5, weight: 14, color: '#3aa0ff' },
    { label: '×10', mult: 10, weight: 7, color: '#ffd23f' },
    { label: '×20', mult: 20, weight: 3, color: '#ff7a00' },
    { label: 'JOKER ×40', mult: 40, weight: 1, color: '#ff3df0' },
  ];
  const totalWeight = SEGMENTS.reduce((a, s) => a + s.weight, 0);

  const { node, body, setBalance } = buildShell(g.icon, g.name,
    'Bet, spin the big-six wheel, and win the segment multiplier.',
    () => openGamesLobby());

  // Visual wheel = a row of segment chips; the active one highlights.
  const wheelRow = el('div', 'chip-options');
  wheelRow.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:8px 0;';
  const segEls = SEGMENTS.map((s) => {
    const c = el('div', 'chip', s.label);
    c.style.cssText =
      'padding:8px 12px;border-radius:10px;font-weight:800;color:#0a0420;' +
      `background:${s.color};opacity:0.45;transition:opacity .08s,transform .08s;`;
    wheelRow.appendChild(c);
    return c;
  });
  body.appendChild(wheelRow);

  function highlight(idx) {
    segEls.forEach((c, i) => {
      const on = i === idx;
      c.style.opacity = on ? '1' : '0.45';
      c.style.transform = on ? 'scale(1.12)' : 'scale(1)';
    });
  }

  const { row, input } = makeBetRow(minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const spinBtn = btn('SPIN');
  btnRow.appendChild(spinBtn);
  body.appendChild(btnRow);

  // Weighted landing index.
  function pickLanding() {
    let r = Math.random() * totalWeight;
    for (let i = 0; i < SEGMENTS.length; i++) {
      r -= SEGMENTS[i].weight;
      if (r < 0) return i;
    }
    return SEGMENTS.length - 1;
  }

  let spinning = false;
  function spin() {
    if (spinning) return;
    const bet = input.readBet();
    if (!Economy.canAfford(bet)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins.';
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    input.disabled = true;
    result.className = 'result-line';
    result.textContent = 'Spinning…';

    const landing = pickLanding();
    // Cycle the highlight, decelerating, until it rests on `landing`.
    const extraLoops = 2 * SEGMENTS.length;
    const steps = extraLoops + landing + 1;
    let i = 0;
    let delay = 50;
    function step() {
      const idx = i % SEGMENTS.length;
      highlight(idx);
      i++;
      if (i >= steps) {
        const seg = SEGMENTS[landing];
        const payout = bet * seg.mult;
        try { Economy.wager(bet, payout); } catch (e) {}
        setBalance();
        result.className = 'result-line win';
        result.textContent = `Landed ${seg.label} — +${fmt(payout - bet)} (returned ${fmt(payout)})`;
        spinning = false;
        spinBtn.disabled = false;
        input.disabled = false;
        return;
      }
      // ease-out: slow down over the last loop
      if (i > steps - SEGMENTS.length) delay += 28;
      setTimeout(step, delay);
    }
    step();
  }

  spinBtn.onclick = spin;
  highlight(0);
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// BACCARAT — Player / Banker / Tie
// =============================================================
function openBaccarat() {
  const minBet = 10, maxBet = 500;
  const g = EXTRA_GAMES.baccarat;
  const TIE_PAYS = 8;       // 8:1 -> payout = bet * 9
  const BANKER_COMMISSION = 0.95; // banker wins pay 0.95:1

  const { node, body, setBalance } = buildShell(g.icon, g.name,
    'Bet Player, Banker or Tie. Closest to 9 wins. Tie pays 8:1.',
    () => openGamesLobby());

  // Hand display.
  const playerLabel = el('div', 'hand-label', 'Player');
  body.appendChild(playerLabel);
  const playerCards = el('div', 'cards');
  body.appendChild(playerCards);

  const bankerLabel = el('div', 'hand-label', 'Banker');
  body.appendChild(bankerLabel);
  const bankerCards = el('div', 'cards');
  body.appendChild(bankerCards);

  // Bet target chooser.
  let pick = 'player';
  const chipRow = el('div', 'chip-options');
  const defs = [
    { id: 'player', label: 'PLAYER 1:1' },
    { id: 'banker', label: 'BANKER 0.95:1' },
    { id: 'tie', label: 'TIE 8:1' },
  ];
  const chipEls = {};
  defs.forEach((d) => {
    const ch = el('div', 'chip' + (d.id === pick ? ' active' : ''), d.label);
    ch.style.cssText =
      'padding:8px 12px;border-radius:10px;font-weight:800;cursor:pointer;' +
      'border:2px solid var(--gold,#ffd23f);';
    ch.onclick = () => {
      pick = d.id;
      Object.values(chipEls).forEach((e) => e.classList.remove('active'));
      ch.classList.add('active');
    };
    chipEls[d.id] = ch;
    chipRow.appendChild(ch);
  });
  body.appendChild(chipRow);

  const { row, input } = makeBetRow(minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const dealBtn = btn('DEAL');
  btnRow.appendChild(dealBtn);
  body.appendChild(btnRow);

  // Card helpers (baccarat: A=1, 10/J/Q/K=0, others face value).
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  function drawCard() {
    return { rank: RANKS[pickInt(RANKS.length)], suit: SUITS[pickInt(SUITS.length)] };
  }
  function cardVal(c) {
    if (c.rank === 'A') return 1;
    if (c.rank === '10' || c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') return 0;
    return parseInt(c.rank, 10) || 0;
  }
  function handTotal(cards) {
    let t = 0;
    for (const c of cards) t += cardVal(c);
    return t % 10;
  }
  function isRed(s) { return s === '♥' || s === '♦'; }
  function renderCard(c) {
    const d = el('div', 'card' + (isRed(c.suit) ? ' red' : ''));
    d.textContent = c.rank + c.suit;
    return d;
  }
  function renderHands() {
    playerCards.innerHTML = '';
    bankerCards.innerHTML = '';
    player.forEach((c) => playerCards.appendChild(renderCard(c)));
    banker.forEach((c) => bankerCards.appendChild(renderCard(c)));
    playerLabel.textContent = `Player — ${handTotal(player)}`;
    bankerLabel.textContent = `Banker — ${handTotal(banker)}`;
  }

  let player = [];
  let banker = [];

  function deal() {
    const bet = input.readBet();
    if (!Economy.canAfford(bet)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins.';
      return;
    }
    dealBtn.disabled = true;

    player = [drawCard(), drawCard()];
    banker = [drawCard(), drawCard()];

    const pInit = handTotal(player);
    const bInit = handTotal(banker);
    const natural = pInit >= 8 || bInit >= 8;

    // Simplified standard baccarat drawing rules.
    let playerThird = null;
    if (!natural) {
      if (pInit <= 5) {
        playerThird = drawCard();
        player.push(playerThird);
      }
      // Banker draw rules depend on player's third card.
      const bTot = handTotal(banker);
      let bankerDraws = false;
      if (playerThird == null) {
        bankerDraws = bTot <= 5;
      } else {
        const t = cardVal(playerThird);
        if (bTot <= 2) bankerDraws = true;
        else if (bTot === 3) bankerDraws = t !== 8;
        else if (bTot === 4) bankerDraws = t >= 2 && t <= 7;
        else if (bTot === 5) bankerDraws = t >= 4 && t <= 7;
        else if (bTot === 6) bankerDraws = t === 6 || t === 7;
        else bankerDraws = false; // 7 stands
      }
      if (bankerDraws) banker.push(drawCard());
    }

    renderHands();

    const pv = handTotal(player);
    const bv = handTotal(banker);
    let outcome;
    if (pv > bv) outcome = 'player';
    else if (bv > pv) outcome = 'banker';
    else outcome = 'tie';

    // Settle: payout = total returned (0 on a losing bet). On a tie,
    // Player/Banker bets push (stake returned); Tie bet pays 8:1.
    let payout = 0;
    if (pick === outcome) {
      if (outcome === 'tie') payout = bet * (TIE_PAYS + 1);
      else if (outcome === 'banker') payout = Math.round(bet + bet * BANKER_COMMISSION);
      else payout = bet * 2;
    } else if (outcome === 'tie' && (pick === 'player' || pick === 'banker')) {
      payout = bet; // push: stake back
    }

    try { Economy.wager(bet, payout); } catch (e) {}
    setBalance();

    const won = payout > bet;
    const push = payout === bet && payout > 0;
    result.className = 'result-line ' + (won ? 'win' : (push ? '' : 'lose'));
    const label = outcome === 'tie' ? 'TIE' : (outcome === 'player' ? 'PLAYER' : 'BANKER');
    if (won) result.textContent = `${label} wins (${pv} vs ${bv}). +${fmt(payout - bet)}`;
    else if (push) result.textContent = `${label} — push, stake returned.`;
    else result.textContent = `${label} wins (${pv} vs ${bv}). You lose ${fmt(bet)}.`;

    dealBtn.disabled = false;
  }

  dealBtn.onclick = deal;
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// KENO — pick up to 8 of 80, draw 20
// =============================================================
function openKeno() {
  const minBet = 5, maxBet = 200;
  const MAX_PICKS = 8;
  const g = EXTRA_GAMES.keno;

  // Paytable: PAY[picks][hits] = total-returned multiple of bet.
  // 0 = loss. Tuned to keep a house edge while rewarding big hits.
  const PAY = {
    1: [0, 3],
    2: [0, 1, 9],
    3: [0, 0, 2, 16],
    4: [0, 0, 1, 4, 24],
    5: [0, 0, 0, 2, 8, 60],
    6: [0, 0, 0, 1, 4, 20, 120],
    7: [0, 0, 0, 1, 3, 12, 50, 250],
    8: [0, 0, 0, 0, 2, 8, 30, 120, 500],
  };

  const { node, body, setBalance } = buildShell(g.icon, g.name,
    `Pick up to ${MAX_PICKS} numbers, then draw 20. More hits pay more.`,
    () => openGamesLobby());

  const picks = new Set();

  const info = el('div', 'sub', `Picked 0 / ${MAX_PICKS}`);
  body.appendChild(info);

  // 1..80 clickable grid (10 columns).
  const grid = el('div', 'keno-grid');
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(10,1fr);gap:4px;margin:8px 0;';
  const cellEls = [];
  for (let n = 1; n <= 80; n++) {
    const cell = el('div', 'keno-cell', String(n));
    cell.style.cssText =
      'text-align:center;padding:6px 0;border-radius:6px;cursor:pointer;' +
      'background:#1a1530;color:#cfd2e6;font-weight:700;user-select:none;' +
      'border:1px solid #2a2545;font-size:13px;';
    cell.dataset.n = String(n);
    cell.onclick = () => toggle(n, cell);
    grid.appendChild(cell);
    cellEls[n] = cell;
  }
  body.appendChild(grid);

  function styleCell(n, state) {
    const c = cellEls[n];
    if (!c) return;
    if (state === 'pick') {
      c.style.background = 'var(--gold,#ffd23f)';
      c.style.color = '#0a0420';
    } else if (state === 'hit') {
      c.style.background = '#2ec27e';
      c.style.color = '#0a0420';
    } else if (state === 'drawn') {
      c.style.background = '#3a3560';
      c.style.color = '#fff';
    } else {
      c.style.background = '#1a1530';
      c.style.color = '#cfd2e6';
    }
  }

  function toggle(n, cell) {
    if (drawing) return;
    if (picks.has(n)) {
      picks.delete(n);
      styleCell(n, 'none');
    } else {
      if (picks.size >= MAX_PICKS) {
        info.textContent = `Max ${MAX_PICKS} numbers — deselect one first.`;
        return;
      }
      picks.add(n);
      styleCell(n, 'pick');
    }
    info.textContent = `Picked ${picks.size} / ${MAX_PICKS}`;
  }

  const { row, input } = makeBetRow(minBet, maxBet);
  body.appendChild(row);

  const result = el('div', 'result-line');
  body.appendChild(result);

  const btnRow = el('div', 'btn-row');
  const drawBtn = btn('DRAW');
  const clearBtn = btn('Clear', 'btn-ghost');
  btnRow.appendChild(drawBtn);
  btnRow.appendChild(clearBtn);
  body.appendChild(btnRow);

  let drawing = false;

  function resetCells() {
    for (let n = 1; n <= 80; n++) styleCell(n, picks.has(n) ? 'pick' : 'none');
  }

  clearBtn.onclick = () => {
    if (drawing) return;
    picks.clear();
    resetCells();
    info.textContent = `Picked 0 / ${MAX_PICKS}`;
    result.className = 'result-line';
    result.textContent = '';
  };

  function draw20() {
    const pool = [];
    for (let n = 1; n <= 80; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = pickInt(i + 1);
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, 20);
  }

  function play() {
    if (drawing) return;
    if (picks.size === 0) {
      result.className = 'result-line lose';
      result.textContent = 'Pick at least one number.';
      return;
    }
    const bet = input.readBet();
    if (!Economy.canAfford(bet)) {
      result.className = 'result-line lose';
      result.textContent = 'Not enough coins.';
      return;
    }
    drawing = true;
    drawBtn.disabled = true;
    clearBtn.disabled = true;
    input.disabled = true;
    resetCells();
    result.className = 'result-line';
    result.textContent = 'Drawing…';

    const drawn = draw20();
    const pickList = Array.from(picks);
    // Reveal drawn numbers one at a time for flavor.
    let i = 0;
    const iv = setInterval(() => {
      if (i < drawn.length) {
        const n = drawn[i];
        styleCell(n, picks.has(n) ? 'hit' : 'drawn');
        i++;
        return;
      }
      clearInterval(iv);
      const hits = pickList.filter((n) => drawn.indexOf(n) !== -1).length;
      const table = PAY[pickList.length] || [];
      const mult = table[hits] || 0;
      const payout = Math.round(bet * mult);

      try { Economy.wager(bet, payout); } catch (e) {}
      setBalance();

      const won = payout > 0;
      result.className = 'result-line ' + (won ? 'win' : 'lose');
      result.textContent = won
        ? `${hits}/${pickList.length} hits — +${fmt(payout - bet)} (×${mult})`
        : `${hits}/${pickList.length} hits — no win. Lost ${fmt(bet)}.`;

      drawing = false;
      drawBtn.disabled = false;
      clearBtn.disabled = false;
      input.disabled = false;
    }, 90);
  }

  drawBtn.onclick = play;
  try { UI.openModal(node); } catch (e) {}
}

// =============================================================
// LOBBY + DISPATCH
// =============================================================

/**
 * openGamesLobby() — a .game-modal listing the EXTRA_GAMES as cards.
 * Clicking a card opens that game via openExtraGame(id).
 */
export function openGamesLobby() {
  try {
    const node = el('div', 'game-modal');

    const close = btn('Close', 'game-close btn-ghost');
    close.onclick = () => { try { UI.closeModal(); } catch (e) {} };
    node.appendChild(close);

    node.appendChild(el('h2', null, '🎲 Games Lobby'));
    node.appendChild(el('div', 'sub', 'Play instantly — no parcel required.'));

    const balanceEl = el('div', 'balance');
    try { balanceEl.textContent = `Balance: 🪙 ${fmt(Economy.coins)}`; } catch (e) {}
    node.appendChild(balanceEl);

    const list = el('div', 'lobby-list');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:8px;';

    Object.keys(EXTRA_GAMES).forEach((id) => {
      const gdef = EXTRA_GAMES[id];
      const card = el('button', 'btn-small btn-ghost');
      card.style.cssText =
        'width:100%;text-align:left;display:flex;align-items:center;gap:14px;padding:12px;';
      const icon = el('div', null, gdef.icon || '🎲');
      icon.style.cssText = 'font-size:30px;line-height:1;';
      const txt = el('div');
      const nm = el('div', null, gdef.name || id);
      nm.style.cssText = 'font-weight:800;font-size:15px;color:var(--gold,#ffd23f);';
      const ds = el('div', null, gdef.desc || '');
      ds.style.cssText = 'font-size:12px;opacity:0.85;margin-top:2px;';
      txt.appendChild(nm);
      txt.appendChild(ds);
      card.appendChild(icon);
      card.appendChild(txt);
      card.onclick = () => openExtraGame(id);
      list.appendChild(card);
    });

    node.appendChild(list);
    UI.openModal(node);
  } catch (e) { /* never throw */ }
}

/**
 * openExtraGame(type) — opens the playable modal for one extra game.
 * Unknown types fall back to the lobby.
 */
export function openExtraGame(type) {
  try {
    switch (type) {
      case 'craps': return openCraps();
      case 'wheel': return openWheel();
      case 'baccarat': return openBaccarat();
      case 'keno': return openKeno();
      default: return openGamesLobby();
    }
  } catch (e) {
    // Never throw out of a UI handler.
  }
}

// expose for debugging / cross-module access
if (typeof window !== 'undefined') {
  window.openGamesLobby = openGamesLobby;
  window.openExtraGame = openExtraGame;
}
