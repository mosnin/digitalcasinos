// =============================================================
// Digital Casinos — authentication + cloud save (Supabase).
//
// Keys come from config.SUPABASE (NEVER hardcode secrets). If they
// are blank the game runs in GUEST mode (localStorage only) and is
// always fully playable. We never throw: any failure falls back to
// guest mode.
//
// ---- Supabase setup (run once in the SQL editor) ----------------
//   create table saves (
//     user_id uuid primary key references auth.users on delete cascade,
//     data jsonb,
//     updated_at timestamptz default now()
//   );
//   alter table saves enable row level security;
//   create policy "own save" on saves
//     for all
//     using (auth.uid() = user_id)
//     with check (auth.uid() = user_id);
// -----------------------------------------------------------------
//
// Exports:
//   initAuth() -> Promise<{ user, mode }>   mode = 'cloud' | 'guest'
//   signOut()
//   currentUser()
//   debounce(fn, ms)
// =============================================================

import { SUPABASE } from './config.js';
import { Economy } from './economy.js';

// ---- module state ----
let _supabase = null;   // the createClient() instance (cloud mode only)
let _user = null;       // cached authed user (or null)
let _mode = 'guest';    // 'cloud' | 'guest'

// ---------------------------------------------------------------
// tiny debounce helper: collapses bursty calls into one trailing call
// ---------------------------------------------------------------
export function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; try { fn.apply(this, args); } catch (e) {} }, ms);
  };
}

// ---- tiny DOM helpers (all defensive) ----
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const k in props) {
    if (k === 'style') Object.assign(node.style, props[k]);
    else if (k === 'text') node.textContent = props[k];
    else if (k in node) { try { node[k] = props[k]; } catch (e) { node.setAttribute(k, props[k]); } }
    else node.setAttribute(k, props[k]);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
}

function panel() {
  // Where we inject UI: the start-screen panel. Guard everything.
  if (typeof document === 'undefined') return null;
  const screen = document.getElementById('startScreen');
  if (!screen) return null;
  return screen.querySelector('.panel') || screen;
}

function setStatus(msg) {
  const s = document.getElementById('authStatus');
  if (s) s.textContent = msg || '';
}

// Remove any previously-rendered auth UI so we can re-render cleanly.
function clearAuthBox() {
  const old = document.getElementById('authBox');
  if (old && old.parentNode) old.parentNode.removeChild(old);
}

// ---------------------------------------------------------------
// Guest-mode note (shown when no keys are configured)
// ---------------------------------------------------------------
function renderGuestNote() {
  const p = panel();
  if (!p) return;
  clearAuthBox();
  const box = el('div', {
    id: 'authBox',
    className: 'auth-box',
    style: {
      margin: '12px 0', padding: '10px 12px', borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)', font: '12px/1.5 system-ui, sans-serif',
      color: '#cdd3da', textAlign: 'left',
    },
  }, [
    el('div', {
      text: 'Playing as Guest — progress saved on this device. Add Supabase keys in js/config.js to enable accounts.',
    }),
  ]);
  insertIntoPanel(p, box);
}

// Insert the auth box just before the Play button when possible.
function insertIntoPanel(p, box) {
  const playBtn = p.querySelector('#playBtn');
  if (playBtn && playBtn.parentNode === p) p.insertBefore(box, playBtn);
  else p.appendChild(box);
}

// ---------------------------------------------------------------
// Full auth form (cloud mode)
// ---------------------------------------------------------------
function renderAuthForm() {
  const p = panel();
  if (!p) return null;
  clearAuthBox();

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', margin: '4px 0', padding: '8px 10px',
    borderRadius: '6px', border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.35)', color: '#fff', font: '13px system-ui, sans-serif',
  };
  const btnStyle = {
    flex: '1', padding: '8px 10px', margin: '0', cursor: 'pointer',
    borderRadius: '6px', border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.10)', color: '#fff',
    font: '13px system-ui, sans-serif',
  };

  const email = el('input', { id: 'authEmail', type: 'email', placeholder: 'email', autocomplete: 'email', style: fieldStyle });
  const pass = el('input', { id: 'authPass', type: 'password', placeholder: 'password', autocomplete: 'current-password', style: fieldStyle });
  const loginBtn = el('button', { id: 'authLogin', type: 'button', text: 'Log in', style: btnStyle });
  const signupBtn = el('button', { id: 'authSignup', type: 'button', text: 'Sign up', style: btnStyle });
  const guestLink = el('a', {
    id: 'authGuest', href: '#', text: 'Continue as guest',
    style: { display: 'inline-block', marginTop: '6px', color: '#18e0ff', font: '12px system-ui, sans-serif', textDecoration: 'none' },
  });
  const status = el('div', {
    id: 'authStatus',
    style: { marginTop: '6px', minHeight: '16px', color: '#9aa3ad', font: '12px system-ui, sans-serif' },
  });

  const btnRow = el('div', { style: { display: 'flex', gap: '6px', margin: '4px 0' } }, [loginBtn, signupBtn]);

  const box = el('div', {
    id: 'authBox', className: 'auth-box',
    style: {
      margin: '12px 0', padding: '10px 12px', borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)', textAlign: 'left',
    },
  }, [
    el('div', { text: 'Account', style: { font: '600 12px system-ui, sans-serif', color: '#cdd3da', marginBottom: '4px' } }),
    email, pass, btnRow, guestLink, status,
  ]);

  insertIntoPanel(p, box);

  // ---- wire events (handlers never throw) ----
  loginBtn.addEventListener('click', () => { void _signIn(email.value, pass.value); });
  signupBtn.addEventListener('click', () => { void _signUp(email.value, pass.value); });
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void _signIn(email.value, pass.value); } });
  guestLink.addEventListener('click', (e) => {
    e.preventDefault();
    _mode = 'guest';
    setStatus('Continuing as guest — progress saved on this device.');
  });

  return box;
}

// Swap the form out for a "signed in" view + sign-out control.
function renderSignedIn(user) {
  const p = panel();
  if (!p) return;
  clearAuthBox();

  const email = (user && user.email) || 'your account';
  const outBtn = el('button', {
    id: 'authSignout', type: 'button', text: 'Sign out',
    style: {
      marginTop: '6px', padding: '6px 10px', cursor: 'pointer', borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.10)',
      color: '#fff', font: '12px system-ui, sans-serif',
    },
  });
  const box = el('div', {
    id: 'authBox', className: 'auth-box',
    style: {
      margin: '12px 0', padding: '10px 12px', borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)', textAlign: 'left',
    },
  }, [
    el('div', { text: 'Signed in as ' + email, style: { font: '600 13px system-ui, sans-serif', color: '#cdd3da' } }),
    outBtn,
    el('div', { id: 'authStatus', style: { marginTop: '6px', minHeight: '16px', color: '#9aa3ad', font: '12px system-ui, sans-serif' } }),
  ]);
  insertIntoPanel(p, box);

  outBtn.addEventListener('click', () => { void signOut(); });
}

// ---------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------
async function _signIn(emailVal, passVal) {
  if (!_supabase) return;
  emailVal = (emailVal || '').trim();
  if (!emailVal || !passVal) { setStatus('Enter your email and password.'); return; }
  setStatus('Signing in…');
  try {
    const { data, error } = await _supabase.auth.signInWithPassword({ email: emailVal, password: passVal });
    if (error) { setStatus(error.message || 'Sign in failed.'); return; }
    const user = data && data.user;
    if (user) { renderSignedIn(user); await _onLogin(user); }
  } catch (e) {
    setStatus('Sign in failed — you can still play as guest.');
  }
}

async function _signUp(emailVal, passVal) {
  if (!_supabase) return;
  emailVal = (emailVal || '').trim();
  if (!emailVal || !passVal) { setStatus('Enter your email and password.'); return; }
  setStatus('Creating account…');
  try {
    const { data, error } = await _supabase.auth.signUp({ email: emailVal, password: passVal });
    if (error) { setStatus(error.message || 'Sign up failed.'); return; }
    const user = data && data.user;
    const session = data && data.session;
    if (user && session) {
      // Auto-confirmed: we have a live session, proceed to cloud save.
      renderSignedIn(user);
      await _onLogin(user);
    } else {
      // Email confirmation required — still fully playable as guest meanwhile.
      setStatus('Account created — check your email to confirm, then log in. You can play as guest now.');
    }
  } catch (e) {
    setStatus('Sign up failed — you can still play as guest.');
  }
}

// On successful auth: load the cloud save, wire debounced upsert, push initial state.
async function _onLogin(user) {
  if (!_supabase || !user) return;
  _user = user;
  _mode = 'cloud';
  try {
    // Load existing save row (if any) and hydrate local economy from it.
    const { data: row, error } = await _supabase
      .from('saves')
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!error && row && row.data) Economy.hydrate(row.data);

    // Wire debounced cloud saves into the Economy. Economy.save() calls cloud.save(state).
    Economy.cloud = {
      save: debounce((state) => {
        try {
          _supabase
            .from('saves')
            .upsert({ user_id: user.id, data: state, updated_at: new Date().toISOString() })
            .then(() => {}, () => {});
        } catch (e) { /* never throw */ }
      }, 1500),
    };

    // Initial upsert of current state so the row exists immediately.
    try {
      await _supabase
        .from('saves')
        .upsert({ user_id: user.id, data: Economy.state, updated_at: new Date().toISOString() });
    } catch (e) { /* ignore */ }

    setStatus('Cloud save on');
  } catch (e) {
    // Loading/saving failed — keep playing with local save.
    setStatus('Cloud save unavailable — progress saved on this device.');
  }
}

// ---------------------------------------------------------------
// Public API
// ---------------------------------------------------------------
export async function initAuth() {
  const url = SUPABASE && SUPABASE.url;
  const anonKey = SUPABASE && SUPABASE.anonKey;

  // No keys => guest mode immediately.
  if (!url || !anonKey) {
    _mode = 'guest';
    _user = null;
    renderGuestNote();
    return { user: null, mode: 'guest' };
  }

  // Cloud mode: load the SDK dynamically. Any failure => guest fallback.
  try {
    const mod = await import('https://esm.sh/@supabase/supabase-js@2');
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (!createClient) throw new Error('supabase-js: createClient missing');
    _supabase = createClient(url, anonKey);
  } catch (e) {
    _mode = 'guest';
    _user = null;
    renderGuestNote();
    return { user: null, mode: 'guest' };
  }

  // Render the form, then react to any existing session.
  renderAuthForm();
  _mode = 'guest'; // until a session is confirmed

  try {
    const { data } = await _supabase.auth.getSession();
    const session = data && data.session;
    const user = session && session.user;
    if (user) {
      renderSignedIn(user);
      await _onLogin(user);
      return { user: _user, mode: 'cloud' };
    }
  } catch (e) {
    setStatus('Sign-in unavailable — playing as guest. Progress saved on this device.');
  }

  // Keep UI in sync if auth state changes later (e.g. confirm-email login).
  try {
    _supabase.auth.onAuthStateChange((_event, session) => {
      const u = session && session.user;
      if (u && (!_user || _user.id !== u.id)) {
        renderSignedIn(u);
        void _onLogin(u);
      } else if (!u && _user) {
        _user = null;
        _mode = 'guest';
        Economy.cloud = null;
        renderAuthForm();
      }
    });
  } catch (e) { /* optional */ }

  // No active session yet — start as guest, upgrade on login.
  return { user: null, mode: 'guest' };
}

export async function signOut() {
  try { if (_supabase) await _supabase.auth.signOut(); } catch (e) { /* ignore */ }
  _user = null;
  _mode = 'guest';
  Economy.cloud = null;
  renderAuthForm();
  setStatus('Signed out — progress saved on this device.');
}

export function currentUser() { return _user; }

// Convenience for callers/debugging.
export function authMode() { return _mode; }
