// =============================================================
// Digital Casinos — procedural background MUSIC (Web Audio).
//
// Separate from audio.js (which handles SFX + ambient pads). This
// module synthesizes a few looping lounge / synthwave Vegas "tracks"
// at runtime — NO asset files. Each track is a 4-8 bar chord
// progression with a bass line and a light hat/percussion pattern,
// scheduled via a lookahead scheduler (setInterval ~25ms, scheduling
// notes ~0.1s ahead). Pads use sine/triangle; bass uses square/saw;
// everything passes through a shared lowpass for warmth.
//
// Fully defensive: never throws, no-ops if Web Audio is unavailable
// or before start(). On/off + volume persist to localStorage 'dc_music'.
//
// API:
//   Music.init()         // best-effort: load settings, optional ctx
//   Music.start()        // resume ctx + begin scheduling (user gesture)
//   Music.toggle()       // enable/disable + persist -> bool (enabled)
//   Music.isPlaying()    // -> bool
//   Music.setVolume(v01) // 0..1 master gain (persisted)
//   Music.next()         // advance to next track (smooth-ish)
// =============================================================

const LS_KEY = 'dc_music';

const clamp01 = (v) => {
  v = Number(v);
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

// ---- persisted settings -------------------------------------------------
function loadSettings() {
  const def = { on: true, volume: 0.4 };
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        if (typeof o.on === 'boolean') def.on = o.on;
        if (typeof o.volume === 'number' && isFinite(o.volume)) {
          def.volume = clamp01(o.volume);
        }
      }
    }
  } catch (e) { /* ignore */ }
  return def;
}

function saveSettings() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_KEY, JSON.stringify({ on: !!M.on, volume: M.volume }));
    }
  } catch (e) { /* ignore */ }
}

// ---- music theory helpers ----------------------------------------------
// Midi note -> frequency.
function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Build a chord from a root midi note + interval set (semitones).
function chord(root, intervals) { return intervals.map((s) => root + s); }

const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];
const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const DOM7 = [0, 4, 7, 10];

// ---- track definitions --------------------------------------------------
// Each track: bpm, beatsPerBar (assume 4), a sequence of bars. Each bar has
// a chord (for the pad), a list of bass midi notes (one per beat or fewer),
// and a hat pattern (eighth-note grid, 8 slots: 1 = play).
// Keep voice counts low for CPU.
const TRACKS = [
  {
    name: 'Neon Lounge',
    bpm: 84,
    padType: 'sine',
    bassType: 'square',
    cutoff: 1100,
    bars: [
      { chord: chord(57, MIN7), bass: [33, 33, 40, 33], hat: [0, 1, 0, 1, 0, 1, 0, 1] }, // Am7
      { chord: chord(53, MAJ7), bass: [29, 29, 36, 29], hat: [0, 1, 0, 1, 0, 1, 1, 1] }, // Fmaj7
      { chord: chord(48, MAJ7), bass: [24, 24, 31, 24], hat: [0, 1, 0, 1, 0, 1, 0, 1] }, // Cmaj7
      { chord: chord(55, DOM7), bass: [31, 31, 38, 31], hat: [0, 1, 0, 1, 0, 1, 1, 1] }, // G7
    ],
  },
  {
    name: 'Midnight Drive',
    bpm: 100,
    padType: 'triangle',
    bassType: 'sawtooth',
    cutoff: 900,
    bars: [
      { chord: chord(52, MIN), bass: [28, 28, 28, 35], hat: [1, 0, 1, 0, 1, 0, 1, 0] }, // Em
      { chord: chord(48, MAJ), bass: [24, 24, 24, 31], hat: [1, 0, 1, 0, 1, 0, 1, 1] }, // C
      { chord: chord(50, MAJ), bass: [26, 26, 26, 33], hat: [1, 0, 1, 0, 1, 0, 1, 0] }, // D
      { chord: chord(47, MIN), bass: [23, 23, 23, 30], hat: [1, 0, 1, 1, 1, 0, 1, 0] }, // Bm
    ],
  },
  {
    name: 'High Roller',
    bpm: 72,
    padType: 'sine',
    bassType: 'square',
    cutoff: 1300,
    bars: [
      { chord: chord(50, MAJ7), bass: [26, 26, 33, 26], hat: [0, 0, 1, 0, 0, 0, 1, 0] }, // Dmaj7
      { chord: chord(55, MIN7), bass: [31, 31, 38, 31], hat: [0, 0, 1, 0, 0, 0, 1, 1] }, // Gm7
      { chord: chord(48, MAJ7), bass: [24, 24, 31, 24], hat: [0, 0, 1, 0, 0, 0, 1, 0] }, // Cmaj7
      { chord: chord(45, MIN7), bass: [21, 21, 28, 21], hat: [0, 0, 1, 0, 0, 1, 1, 0] }, // Am7 (low)
    ],
  },
];

// ---- internal state -----------------------------------------------------
const _s = loadSettings();

const M = {
  ctx: null,
  master: null,      // master gain (volume)
  lowpass: null,     // shared warmth filter
  on: _s.on,         // user enabled flag (persisted)
  volume: _s.volume, // 0..1 (persisted)
  playing: false,    // actively scheduling
  failed: false,     // no Web Audio at all
  trackIndex: 0,
  timer: null,       // setInterval handle
  // scheduler bookkeeping
  nextNoteTime: 0,   // ctx time of next note to schedule
  current16: 0,      // 0..(beatsPerBar*4 - 1) sixteenth counter within track
  barInTrack: 0,     // which bar of the current track
  activeNodes: [],   // long-lived nodes (held pads) to silence on stop
};

const LOOKAHEAD_MS = 25;     // scheduler tick
const SCHEDULE_AHEAD = 0.12; // seconds to schedule ahead
const BEATS_PER_BAR = 4;
const STEPS_PER_BEAT = 4;    // sixteenth resolution

function AudioCtor() {
  try {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  } catch (e) { return null; }
}

function ensureCtx() {
  if (M.ctx) return M.ctx;
  if (M.failed) return null;
  const Ctor = AudioCtor();
  if (!Ctor) { M.failed = true; return null; }
  try {
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.gain.value = M.on ? M.volume : 0.0001;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 0.5;

    lp.connect(master);
    master.connect(ctx.destination);

    M.ctx = ctx;
    M.master = master;
    M.lowpass = lp;
    return ctx;
  } catch (e) {
    M.failed = true;
    return null;
  }
}

function resumeCtx() {
  try {
    if (M.ctx && M.ctx.state === 'suspended' && M.ctx.resume) {
      M.ctx.resume().catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

function applyMasterGain(immediate) {
  if (!M.ctx || !M.master) return;
  const target = M.on ? Math.max(0.0001, M.volume) : 0.0001;
  try {
    const now = M.ctx.currentTime;
    const g = M.master.gain;
    g.cancelScheduledValues(now);
    const from = Math.max(0.0001, g.value || 0.0001);
    g.setValueAtTime(from, now);
    if (immediate) {
      g.exponentialRampToValueAtTime(target, now + 0.08);
    } else {
      g.setValueAtTime(target, now);
    }
  } catch (e) { /* ignore */ }
}

// ---- voices -------------------------------------------------------------
// A pad note: soft attack/release oscillator into the shared lowpass.
function padVoice(midi, t0, dur, type, gainPeak) {
  const ctx = M.ctx;
  if (!ctx || !M.lowpass) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = Math.max(1, mtof(midi));
    // gentle chorus detune
    try { osc.detune.value = (Math.random() * 8 - 4); } catch (e) {}

    const g = ctx.createGain();
    const atk = Math.min(0.25, dur * 0.4);
    const rel = Math.min(0.6, dur * 0.6);
    const peak = Math.max(0.0001, gainPeak || 0.06);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.setValueAtTime(peak, Math.max(t0 + atk, t0 + dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(M.lowpass);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (e) { /* ignore */ }
}

// A bass note: punchier square/saw with a quick envelope.
function bassVoice(midi, t0, dur, type) {
  const ctx = M.ctx;
  if (!ctx || !M.lowpass) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = type || 'square';
    osc.frequency.value = Math.max(1, mtof(midi));

    const g = ctx.createGain();
    const peak = 0.16;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.1, dur * 0.9));

    osc.connect(g);
    g.connect(M.lowpass);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (e) { /* ignore */ }
}

// A hat: very short filtered noise burst (built from a tiny shared buffer).
let _noiseBuf = null;
function noiseBuffer() {
  if (_noiseBuf) return _noiseBuf;
  const ctx = M.ctx;
  if (!ctx) return null;
  try {
    const len = Math.floor(ctx.sampleRate * 0.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    _noiseBuf = buf;
    return buf;
  } catch (e) { return null; }
}

function hatVoice(t0, accent) {
  const ctx = M.ctx;
  if (!ctx || !M.master) return; // hats bypass lowpass (stay crisp)
  const buf = noiseBuffer();
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1.6;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    const g = ctx.createGain();
    const peak = accent ? 0.05 : 0.03;
    const dur = 0.04;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(M.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  } catch (e) { /* ignore */ }
}

// ---- scheduler ----------------------------------------------------------
function currentTrack() {
  return TRACKS[M.trackIndex] || TRACKS[0];
}

function secondsPerStep() {
  const tr = currentTrack();
  const bpm = (tr && tr.bpm) || 90;
  const spb = 60 / bpm;            // seconds per beat
  return spb / STEPS_PER_BEAT;     // seconds per sixteenth
}

// Schedule all events that fall on the given sixteenth step.
function scheduleStep(step, time) {
  const tr = currentTrack();
  if (!tr || !tr.bars || !tr.bars.length) return;
  const stepsPerBar = BEATS_PER_BAR * STEPS_PER_BEAT; // 16
  const bar = tr.bars[M.barInTrack % tr.bars.length];
  if (!bar) return;

  const beat = Math.floor(step / STEPS_PER_BEAT);     // 0..3
  const isBeatStart = (step % STEPS_PER_BEAT) === 0;
  const eighth = Math.floor(step / (STEPS_PER_BEAT / 2)); // 0..7

  // Pad: trigger the whole chord at the start of each bar (held ~1 bar).
  if (step === 0) {
    const barDur = stepsPerBar * secondsPerStep();
    const ch = bar.chord || [];
    // keep voice count light: cap chord voices
    const voices = ch.slice(0, 4);
    voices.forEach((m, i) => {
      padVoice(m + 12, time, barDur * 0.98, tr.padType, 0.05 - i * 0.005);
    });
  }

  // Bass: one note per beat (if defined for that beat).
  if (isBeatStart && bar.bass) {
    const note = bar.bass[beat];
    if (typeof note === 'number') {
      bassVoice(note, time, secondsPerStep() * STEPS_PER_BEAT * 0.9, tr.bassType);
    }
  }

  // Hat: eighth-note grid (only fire on eighth boundaries).
  if ((step % (STEPS_PER_BEAT / 2)) === 0 && bar.hat) {
    if (bar.hat[eighth]) {
      hatVoice(time, eighth % 2 === 0);
    }
  }
}

function advanceStep() {
  M.nextNoteTime += secondsPerStep();
  const stepsPerBar = BEATS_PER_BAR * STEPS_PER_BEAT;
  M.current16 = (M.current16 + 1) % stepsPerBar;
  if (M.current16 === 0) {
    const tr = currentTrack();
    const nBars = (tr && tr.bars && tr.bars.length) || 1;
    M.barInTrack = (M.barInTrack + 1) % nBars;
  }
}

function schedulerTick() {
  const ctx = M.ctx;
  if (!ctx) return;
  try {
    while (M.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(M.current16, M.nextNoteTime);
      advanceStep();
    }
  } catch (e) { /* never throw */ }
}

function startScheduler() {
  if (M.playing) return;
  const ctx = M.ctx;
  if (!ctx) return;
  try {
    M.current16 = 0;
    M.barInTrack = 0;
    M.nextNoteTime = ctx.currentTime + 0.08;
    M.playing = true;
    if (typeof setInterval !== 'undefined') {
      M.timer = setInterval(schedulerTick, LOOKAHEAD_MS);
    }
    schedulerTick();
  } catch (e) { /* ignore */ }
}

function stopScheduler() {
  M.playing = false;
  try {
    if (M.timer != null && typeof clearInterval !== 'undefined') {
      clearInterval(M.timer);
    }
  } catch (e) { /* ignore */ }
  M.timer = null;
}

// ---- public API ---------------------------------------------------------
export const Music = {
  init() {
    // Best-effort: settings already loaded at module init. Optionally
    // create the (suspended) context; safe to skip until start().
    try { /* no eager ctx — wait for the gesture in start() */ } catch (e) {}
    return this;
  },

  start() {
    try {
      const ctx = ensureCtx();
      if (!ctx) return this;
      resumeCtx();
      applyMasterGain(false);
      if (M.on) startScheduler();
    } catch (e) { /* never throw */ }
    return this;
  },

  toggle() {
    try {
      M.on = !M.on;
      saveSettings();
      if (M.on) {
        // turning on: ensure ctx + scheduling + audible gain
        const ctx = ensureCtx();
        if (ctx) {
          resumeCtx();
          applyMasterGain(true);
          startScheduler();
        }
      } else {
        // turning off: silence then stop scheduling
        applyMasterGain(true);
        try {
          if (typeof setTimeout !== 'undefined') setTimeout(stopScheduler, 120);
          else stopScheduler();
        } catch (e) { stopScheduler(); }
      }
    } catch (e) { /* never throw */ }
    return !!M.on;
  },

  isPlaying() {
    return !!(M.on && M.playing && M.ctx);
  },

  setVolume(v) {
    try {
      M.volume = clamp01(v);
      saveSettings();
      applyMasterGain(true);
    } catch (e) { /* never throw */ }
    return M.volume;
  },

  next() {
    try {
      M.trackIndex = (M.trackIndex + 1) % TRACKS.length;
      if (!M.playing || !M.ctx) return this;
      // smooth-ish: duck the master briefly, restart the scheduler at the
      // new track's tempo, then ramp gain back up.
      const ctx = M.ctx;
      const g = M.master && M.master.gain;
      const target = M.on ? Math.max(0.0001, M.volume) : 0.0001;
      if (g && ctx) {
        const now = ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(0.0001, g.value || 0.0001), now);
        g.exponentialRampToValueAtTime(0.0001, now + 0.25);
      }
      const restart = () => {
        stopScheduler();
        if (M.on) startScheduler();
        if (g && M.ctx) {
          const now2 = M.ctx.currentTime;
          g.cancelScheduledValues(now2);
          g.setValueAtTime(Math.max(0.0001, g.value || 0.0001), now2);
          g.exponentialRampToValueAtTime(target, now2 + 0.3);
        }
      };
      if (typeof setTimeout !== 'undefined') setTimeout(restart, 280);
      else restart();
    } catch (e) { /* never throw */ }
    return this;
  },

  // Convenience: report current track name (handy for HUD/integrator).
  trackName() {
    try { return (currentTrack() || {}).name || ''; } catch (e) { return ''; }
  },
};

// Expose globally (integrator binds the Z key to Music.toggle / start).
try { if (typeof window !== 'undefined') window.Music = Music; } catch (e) { /* ignore */ }

export default Music;
