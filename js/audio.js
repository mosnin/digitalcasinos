// =============================================================
// Digital Casinos — procedural Web Audio sound manager.
// No external asset files: every SFX and the ambient pad are
// synthesized at runtime with OscillatorNode / GainNode / noise.
// Defensive everywhere — never throws, works before init(), and
// no-ops gracefully when the AudioContext is unavailable (e.g.
// autoplay-blocked, headless, or unsupported browsers).
//
// API:
//   SFX.init()            // best-effort context create (optional)
//   SFX.unlock()          // create + resume context (call on first gesture)
//   SFX.setMuted(b)       // mute on/off (persisted)
//   SFX.isMuted()         // -> bool
//   SFX.setVolume(v01)    // 0..1 master volume (persisted)
//   SFX.getVolume()       // -> number
//   SFX.play(name)        // one-shot SFX (see NAMES below)
//   SFX.startAmbient(t)   // looping pad/murmur per theme
//   SFX.stopAmbient()     // fade ambient out
//
// name ∈ coin, win, bigwin, jackpot, lose, spin, reel, click,
//        place, remove, buy, elevator, error, chip, card, deal
// theme ∈ 'classic' | 'pool' | 'highroller' | 'promenade'
// =============================================================

const LS_KEY = 'dc_audio';

// ---- persisted settings -------------------------------------------------
function loadSettings() {
  const def = { muted: false, volume: 0.7 };
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        if (typeof o.muted === 'boolean') def.muted = o.muted;
        if (typeof o.volume === 'number' && isFinite(o.volume)) {
          def.volume = Math.max(0, Math.min(1, o.volume));
        }
      }
    }
  } catch (e) { /* ignore */ }
  return def;
}

function saveSettings(s) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEY, JSON.stringify({ muted: !!s.muted, volume: s.volume }));
    }
  } catch (e) { /* ignore */ }
}

const clamp01 = (v) => {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

// ---- internal state -----------------------------------------------------
const _s = loadSettings();

const S = {
  ctx: null,
  master: null,       // master GainNode (post-mute volume)
  sfxBus: null,       // bus for one-shots
  ambientBus: null,   // bus for ambient
  muted: _s.muted,
  volume: _s.volume,
  ambient: null,      // { nodes:[], gain, theme, lfo, ... }
  noiseBuf: null,
  failed: false,      // hard-failed (no Web Audio at all)
};

function AudioCtor() {
  try {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  } catch (e) { return null; }
}

// Create the context lazily. Returns the ctx or null.
function ensureCtx() {
  if (S.ctx) return S.ctx;
  if (S.failed) return null;
  const Ctor = AudioCtor();
  if (!Ctor) { S.failed = true; return null; }
  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = S.muted ? 0 : S.volume;
    master.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);

    const ambientBus = ctx.createGain();
    ambientBus.gain.value = 1;
    ambientBus.connect(master);

    S.ctx = ctx;
    S.master = master;
    S.sfxBus = sfxBus;
    S.ambientBus = ambientBus;
    return ctx;
  } catch (e) {
    S.failed = true;
    return null;
  }
}

function resumeCtx() {
  try {
    if (S.ctx && S.ctx.state === 'suspended' && S.ctx.resume) {
      S.ctx.resume().catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

function applyMasterGain(immediate) {
  if (!S.ctx || !S.master) return;
  const target = S.muted ? 0.0001 : Math.max(0.0001, S.volume);
  try {
    const now = S.ctx.currentTime;
    const g = S.master.gain;
    g.cancelScheduledValues(now);
    if (immediate) {
      g.setValueAtTime(Math.max(0.0001, g.value || 0.0001), now);
      g.exponentialRampToValueAtTime(target, now + 0.04);
    } else {
      g.setValueAtTime(target, now);
    }
  } catch (e) { /* ignore */ }
}

// ---- noise buffer (shared) ---------------------------------------------
function noiseBuffer() {
  if (S.noiseBuf) return S.noiseBuf;
  const ctx = S.ctx;
  if (!ctx) return null;
  try {
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    S.noiseBuf = buf;
    return buf;
  } catch (e) { return null; }
}

// ---- low-level synth helpers -------------------------------------------
// A short tone with an envelope, routed to the sfx bus.
function tone(opts) {
  const ctx = S.ctx;
  if (!ctx || !S.sfxBus) return;
  try {
    const t0 = (opts.at != null ? opts.at : ctx.currentTime) + (opts.delay || 0);
    const type = opts.type || 'sine';
    const f0 = opts.freq || 440;
    const f1 = (opts.freqEnd != null) ? opts.freqEnd : f0;
    const dur = Math.max(0.02, opts.dur || 0.15);
    const peak = (opts.gain != null) ? opts.gain : 0.25;
    const atk = Math.min(opts.attack != null ? opts.attack : 0.005, dur * 0.5);
    const rel = Math.min(opts.release != null ? opts.release : dur * 0.6, dur);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 !== f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    }
    if (opts.detune) {
      try { osc.detune.setValueAtTime(opts.detune, t0); } catch (e) {}
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let tail = g;
    if (opts.filter) {
      const flt = ctx.createBiquadFilter();
      flt.type = opts.filter.type || 'lowpass';
      flt.frequency.setValueAtTime(opts.filter.freq || 2000, t0);
      if (opts.filter.q != null) flt.Q.value = opts.filter.q;
      osc.connect(g);
      g.connect(flt);
      tail = flt;
    } else {
      osc.connect(g);
    }
    tail.connect(S.sfxBus);

    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* ignore */ }
}

// A short burst of (optionally filtered) noise.
function noise(opts) {
  const ctx = S.ctx;
  if (!ctx || !S.sfxBus) return;
  const buf = noiseBuffer();
  if (!buf) return;
  try {
    const t0 = (opts.at != null ? opts.at : ctx.currentTime) + (opts.delay || 0);
    const dur = Math.max(0.02, opts.dur || 0.12);
    const peak = (opts.gain != null) ? opts.gain : 0.2;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + Math.min(0.01, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let head = src;
    if (opts.filter) {
      const flt = ctx.createBiquadFilter();
      flt.type = opts.filter.type || 'bandpass';
      flt.frequency.setValueAtTime(opts.filter.freq || 1500, t0);
      if (opts.filter.q != null) flt.Q.value = opts.filter.q;
      if (opts.filter.freqEnd != null) {
        flt.frequency.exponentialRampToValueAtTime(Math.max(1, opts.filter.freqEnd), t0 + dur);
      }
      src.connect(flt);
      flt.connect(g);
      head = src;
    } else {
      src.connect(g);
    }
    g.connect(S.sfxBus);

    src.start(t0);
    src.stop(t0 + dur + 0.02);
  } catch (e) { /* ignore */ }
}

// ---- SFX definitions ----------------------------------------------------
function now() { return S.ctx ? S.ctx.currentTime : 0; }

const SFX_FNS = {
  coin() {
    const t = now();
    tone({ at: t, type: 'square', freq: 1320, freqEnd: 1760, dur: 0.08, gain: 0.18, filter: { type: 'lowpass', freq: 4000 } });
    tone({ at: t, delay: 0.04, type: 'sine', freq: 2640, dur: 0.06, gain: 0.12 });
  },
  win() {
    const t = now();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => tone({ at: t, delay: i * 0.08, type: 'triangle', freq: f, dur: 0.16, gain: 0.2 }));
  },
  bigwin() {
    const t = now();
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((f, i) => tone({ at: t, delay: i * 0.075, type: 'triangle', freq: f, dur: 0.22, gain: 0.2 }));
    // sparkle tail
    for (let i = 0; i < 6; i++) {
      tone({ at: t, delay: 0.45 + i * 0.05, type: 'sine', freq: 1500 + Math.random() * 2500, dur: 0.1, gain: 0.08 });
    }
  },
  jackpot() {
    const t = now();
    // triumphant chord cascade (three rolling major chords)
    const chords = [
      [392.0, 493.88, 587.33],   // G B D
      [523.25, 659.25, 783.99],  // C E G
      [659.25, 830.61, 987.77],  // E G# B
    ];
    chords.forEach((ch, ci) => {
      ch.forEach((f, ni) => {
        tone({ at: t, delay: ci * 0.22 + ni * 0.03, type: 'sawtooth', freq: f, dur: 0.5, gain: 0.14, filter: { type: 'lowpass', freq: 3000 } });
      });
    });
    // sparkle shower
    for (let i = 0; i < 14; i++) {
      tone({ at: t, delay: 0.5 + i * 0.04, type: 'sine', freq: 1800 + Math.random() * 3000, dur: 0.12, gain: 0.06 });
    }
    noise({ at: t, dur: 0.4, gain: 0.05, filter: { type: 'highpass', freq: 4000 } });
  },
  lose() {
    const t = now();
    const notes = [440, 392, 329.63, 261.63];
    notes.forEach((f, i) => tone({ at: t, delay: i * 0.1, type: 'sawtooth', freq: f, dur: 0.18, gain: 0.16, filter: { type: 'lowpass', freq: 1800 } }));
  },
  spin() {
    const t = now();
    // rising whir
    tone({ at: t, type: 'sawtooth', freq: 180, freqEnd: 520, dur: 0.5, gain: 0.1, filter: { type: 'lowpass', freq: 1200 } });
    noise({ at: t, dur: 0.5, gain: 0.05, filter: { type: 'bandpass', freq: 800, freqEnd: 1600, q: 2 } });
  },
  reel() {
    const t = now();
    tone({ at: t, type: 'square', freq: 880, dur: 0.04, gain: 0.12, filter: { type: 'lowpass', freq: 3000 } });
  },
  click() {
    const t = now();
    tone({ at: t, type: 'sine', freq: 660, dur: 0.05, gain: 0.12, attack: 0.002 });
  },
  place() {
    const t = now();
    // thunk: low body + attack click
    tone({ at: t, type: 'sine', freq: 160, freqEnd: 90, dur: 0.18, gain: 0.28 });
    noise({ at: t, dur: 0.07, gain: 0.12, filter: { type: 'lowpass', freq: 600 } });
  },
  remove() {
    const t = now();
    // reverse-thunk: rising then a soft pop
    tone({ at: t, type: 'sine', freq: 90, freqEnd: 200, dur: 0.18, gain: 0.22 });
    tone({ at: t, delay: 0.16, type: 'sine', freq: 320, dur: 0.06, gain: 0.1 });
  },
  buy() {
    const t = now();
    // cash-register-ish: bright ding + drawer noise
    tone({ at: t, type: 'square', freq: 1568, dur: 0.1, gain: 0.16 });
    tone({ at: t, delay: 0.06, type: 'square', freq: 2093, dur: 0.12, gain: 0.14 });
    noise({ at: t, delay: 0.12, dur: 0.16, gain: 0.1, filter: { type: 'bandpass', freq: 2500, q: 1.2 } });
  },
  elevator() {
    const t = now();
    // pleasant two-tone ding
    tone({ at: t, type: 'sine', freq: 1318.5, dur: 0.35, gain: 0.2 });
    tone({ at: t, delay: 0.22, type: 'sine', freq: 1046.5, dur: 0.45, gain: 0.2 });
  },
  error() {
    const t = now();
    tone({ at: t, type: 'sawtooth', freq: 180, dur: 0.16, gain: 0.16, filter: { type: 'lowpass', freq: 900 } });
    tone({ at: t, delay: 0.16, type: 'sawtooth', freq: 150, dur: 0.2, gain: 0.16, filter: { type: 'lowpass', freq: 800 } });
  },
  chip() {
    const t = now();
    // clay-chip clack: two quick high clicks
    noise({ at: t, dur: 0.04, gain: 0.16, filter: { type: 'bandpass', freq: 3200, q: 3 } });
    noise({ at: t, delay: 0.05, dur: 0.04, gain: 0.12, filter: { type: 'bandpass', freq: 2600, q: 3 } });
  },
  card() {
    const t = now();
    // card flip: short filtered noise swish
    noise({ at: t, dur: 0.12, gain: 0.12, rate: 1.4, filter: { type: 'highpass', freq: 1800, freqEnd: 4000 } });
  },
  deal() {
    const t = now();
    // riffle: several quick noise ticks
    for (let i = 0; i < 6; i++) {
      noise({ at: t, delay: i * 0.04, dur: 0.03, gain: 0.09, filter: { type: 'highpass', freq: 2500 } });
    }
  },
};

// ---- ambient pad/murmur -------------------------------------------------
const THEME_PRESETS = {
  classic:    { root: 130.81, intervals: [0, 7, 12], cutoff: 700,  type: 'sawtooth', murmur: 0.05, murmurFreq: 500 },
  pool:       { root: 146.83, intervals: [0, 5, 9],  cutoff: 600,  type: 'triangle', murmur: 0.035, murmurFreq: 400 },
  highroller: { root: 110.0,  intervals: [0, 4, 7],  cutoff: 520,  type: 'sawtooth', murmur: 0.03, murmurFreq: 350 },
  promenade:  { root: 164.81, intervals: [0, 7, 10], cutoff: 800,  type: 'triangle', murmur: 0.06, murmurFreq: 600 },
};

function buildAmbient(theme) {
  const ctx = S.ctx;
  if (!ctx || !S.ambientBus) return null;
  const preset = THEME_PRESETS[theme] || THEME_PRESETS.classic;
  try {
    const t0 = ctx.currentTime;

    // master ambient gain (fades in)
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 2.0);

    // shared lowpass + slow LFO wobble on cutoff
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = preset.cutoff;
    lp.Q.value = 0.6;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = preset.cutoff * 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start(t0);

    lp.connect(gain);
    gain.connect(S.ambientBus);

    const oscs = [lfo];

    // a few detuned oscillators forming a soft chord pad
    preset.intervals.forEach((semi, i) => {
      const freq = preset.root * Math.pow(2, semi / 12);
      // two slightly-detuned voices per note for chorus warmth
      for (let v = 0; v < 2; v++) {
        const osc = ctx.createOscillator();
        osc.type = preset.type;
        osc.frequency.value = freq;
        osc.detune.value = (v === 0 ? -1 : 1) * (5 + i * 2);
        const vg = ctx.createGain();
        vg.gain.value = 0.12;
        osc.connect(vg);
        vg.connect(lp);
        osc.start(t0);
        oscs.push(osc);
      }
    });

    // filtered noise crowd murmur
    let noiseSrc = null;
    const buf = noiseBuffer();
    if (buf && preset.murmur > 0) {
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = buf;
      noiseSrc.loop = true;
      noiseSrc.playbackRate.value = 0.6;
      const nflt = ctx.createBiquadFilter();
      nflt.type = 'bandpass';
      nflt.frequency.value = preset.murmurFreq;
      nflt.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.value = preset.murmur;
      // slow amplitude wobble for "crowd" feel
      const mlfo = ctx.createOscillator();
      mlfo.type = 'sine';
      mlfo.frequency.value = 0.13;
      const mlfoGain = ctx.createGain();
      mlfoGain.gain.value = preset.murmur * 0.5;
      mlfo.connect(mlfoGain);
      mlfoGain.connect(ng.gain);
      mlfo.start(t0);
      oscs.push(mlfo);

      noiseSrc.connect(nflt);
      nflt.connect(ng);
      ng.connect(gain);
      noiseSrc.start(t0);
    }

    return { gain, oscs, noiseSrc, theme };
  } catch (e) {
    return null;
  }
}

function fadeOutAmbient(amb, after) {
  if (!amb) return;
  const ctx = S.ctx;
  try {
    const t0 = ctx ? ctx.currentTime : 0;
    if (amb.gain && ctx) {
      const g = amb.gain.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(Math.max(0.0001, g.value || 0.0001), t0);
      g.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    }
  } catch (e) { /* ignore */ }
  // stop sources after the fade
  const stopAll = () => {
    try { (amb.oscs || []).forEach((o) => { try { o.stop(); } catch (e) {} }); } catch (e) {}
    try { if (amb.noiseSrc) amb.noiseSrc.stop(); } catch (e) {}
    try { if (amb.gain) amb.gain.disconnect(); } catch (e) {}
  };
  try { setTimeout(stopAll, 1400); } catch (e) { stopAll(); }
  if (after) { try { after(); } catch (e) {} }
}

// ---- public API ---------------------------------------------------------
export const SFX = {
  init() {
    // Best-effort: try to create the context. Some browsers allow this
    // before a gesture (it'll just be 'suspended' until unlock()).
    try { ensureCtx(); applyMasterGain(false); } catch (e) {}
    return this;
  },

  unlock() {
    try {
      ensureCtx();
      resumeCtx();
      applyMasterGain(false);
    } catch (e) { /* ignore */ }
    return this;
  },

  setMuted(b) {
    S.muted = !!b;
    saveSettings(S);
    applyMasterGain(true);
    return S.muted;
  },

  isMuted() { return !!S.muted; },

  setVolume(v01) {
    S.volume = clamp01(v01);
    saveSettings(S);
    applyMasterGain(true);
    return S.volume;
  },

  getVolume() { return S.volume; },

  play(name) {
    try {
      const fn = SFX_FNS[name];
      if (!fn) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      resumeCtx();
      if (S.muted) return; // still keep context warm, but no output needed
      fn();
    } catch (e) { /* never throw */ }
  },

  startAmbient(theme) {
    try {
      const ctx = ensureCtx();
      if (!ctx) return;
      resumeCtx();
      // switching ambience: fade out old, start new
      if (S.ambient) {
        const old = S.ambient;
        S.ambient = null;
        fadeOutAmbient(old);
      }
      const amb = buildAmbient(theme);
      if (amb) S.ambient = amb;
    } catch (e) { /* never throw */ }
    return this;
  },

  stopAmbient() {
    try {
      if (S.ambient) {
        const old = S.ambient;
        S.ambient = null;
        fadeOutAmbient(old);
      }
    } catch (e) { /* never throw */ }
    return this;
  },
};

// Expose globally (integrator triggers SFX.play on actions).
try { if (typeof window !== 'undefined') window.SFX = SFX; } catch (e) { /* ignore */ }

export default SFX;
