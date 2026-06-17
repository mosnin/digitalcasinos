// js/perf.js — Wave 3 performance governor + stage optimizer.
// Defensive by design: never throw. THREE import is optional.
import * as THREE from 'three';

/**
 * Adaptive pixel-ratio governor driven by a smoothed FPS estimate.
 * createPerfGovernor(renderer, opts) -> { update(dt), getFps(), setEnabled(b) }
 */
export function createPerfGovernor(renderer, opts = {}) {
  opts = opts || {};

  const hwRatio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const CAP = Math.min(2, hwRatio || 1);
  const FLOOR = Math.max(0.25, Math.min(CAP, opts.min || 0.75));

  // Tunables (with sane defaults).
  const LOW_FPS = opts.lowFps || 45;        // below this for a while => downscale
  const HIGH_FPS = opts.highFps || 58;      // above this for a while => upscale
  const DOWN_WINDOW = opts.downWindow || 1.5; // seconds sustained below LOW_FPS
  const UP_WINDOW = opts.upWindow || 3.0;     // seconds sustained above HIGH_FPS
  const DOWN_STEP = opts.downStep || 0.15;
  const UP_STEP = opts.upStep || 0.1;
  const COOLDOWN = opts.cooldown || 1.0;      // min seconds between adjustments
  const EMA_ALPHA = opts.emaAlpha || 0.1;     // FPS smoothing factor

  let enabled = opts.enabled === undefined ? true : !!opts.enabled;
  let emaFps = 60;
  let lowTimer = 0;     // time spent below LOW_FPS
  let highTimer = 0;    // time spent above HIGH_FPS
  let cooldownTimer = 0;
  let started = false;

  // Current ratio: start from what the renderer reports, clamped to range.
  let ratio = CAP;
  try {
    if (renderer && typeof renderer.getPixelRatio === 'function') {
      const r = renderer.getPixelRatio();
      if (isFinite(r) && r > 0) ratio = r;
    }
  } catch (e) { /* ignore */ }
  ratio = Math.max(FLOOR, Math.min(CAP, ratio));

  function applyRatio(r) {
    r = Math.max(FLOOR, Math.min(CAP, r));
    // Round to avoid float drift / micro-thrash.
    r = Math.round(r * 100) / 100;
    if (Math.abs(r - ratio) < 0.001) return;
    ratio = r;
    try {
      if (renderer && typeof renderer.setPixelRatio === 'function') {
        renderer.setPixelRatio(ratio);
      }
    } catch (e) { /* ignore */ }
  }

  function update(dt) {
    try {
      if (!isFinite(dt) || dt <= 0) return;
      // Clamp dt to avoid huge spikes (tab refocus, hitches) skewing the EMA.
      const cdt = Math.min(dt, 0.5);
      const instFps = 1 / cdt;

      // Seed EMA on first sample so it converges quickly.
      if (!started) { emaFps = instFps; started = true; }
      else emaFps = emaFps + EMA_ALPHA * (instFps - emaFps);

      if (!enabled) { lowTimer = 0; highTimer = 0; return; }

      if (cooldownTimer > 0) cooldownTimer = Math.max(0, cooldownTimer - dt);

      // Hysteresis: track sustained windows on each side; reset the other.
      if (emaFps < LOW_FPS) {
        lowTimer += dt;
        highTimer = 0;
      } else if (emaFps > HIGH_FPS) {
        highTimer += dt;
        lowTimer = 0;
      } else {
        // Comfortable middle band — decay both so transient dips don't accumulate.
        lowTimer = 0;
        highTimer = 0;
      }

      if (cooldownTimer > 0) return;

      if (lowTimer >= DOWN_WINDOW && ratio > FLOOR) {
        applyRatio(ratio - DOWN_STEP);
        lowTimer = 0;
        highTimer = 0;
        cooldownTimer = COOLDOWN;
      } else if (highTimer >= UP_WINDOW && ratio < CAP) {
        applyRatio(ratio + UP_STEP);
        lowTimer = 0;
        highTimer = 0;
        cooldownTimer = COOLDOWN;
      }
    } catch (e) { /* never throw */ }
  }

  function getFps() {
    const f = Math.round(emaFps);
    return isFinite(f) ? f : 0;
  }

  function setEnabled(b) {
    enabled = !!b;
    if (!enabled) { lowTimer = 0; highTimer = 0; }
  }

  return { update, getFps, setEnabled };
}

/**
 * Walk stage.scene and flatten per-frame cost on clearly-static meshes.
 * Defensive: tolerates missing scene / missing THREE, never throws.
 */
export function optimizeStage(stage) {
  try {
    const scene = stage && stage.scene;
    if (!scene || typeof scene.traverse !== 'function') return;

    const MeshCtor = (THREE && THREE.Mesh) || null;

    scene.traverse((obj) => {
      try {
        if (!obj) return;

        // Skip non-meshes (lights, cameras, groups, etc.).
        const isMesh = obj.isMesh === true || (MeshCtor && obj instanceof MeshCtor);
        if (!isMesh) return;

        // Skip anything explicitly flagged as animated/dynamic.
        if (obj.userData && obj.userData.animated === true) return;

        // Skip skinned/skeletal meshes (their matrices update with the rig).
        if (obj.isSkinnedMesh === true || obj.skeleton) return;

        // Always enable frustum culling for static meshes.
        obj.frustumCulled = true;

        // Freeze static matrices: bake current transform, stop auto updates.
        if (obj.matrixAutoUpdate === true) {
          if (typeof obj.updateMatrix === 'function') obj.updateMatrix();
          obj.matrixAutoUpdate = false;
        }
      } catch (e) { /* per-object guard */ }
    });
  } catch (e) { /* never throw */ }
}
