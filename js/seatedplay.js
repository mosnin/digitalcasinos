// js/seatedplay.js — Digital Casinos Wave 6
// Pure camera control for seated 3D play. Never throws.
import * as THREE from 'three';

function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

export function createSeatedPlay({ camera, getPlayer } = {}) {
  // Reusable temporaries (avoid per-frame allocation).
  const _tmpObj = new THREE.Object3D();
  const _worldPos = new THREE.Vector3();
  const _front = new THREE.Vector3();
  const _target = new THREE.Vector3();

  const state = {
    active: false,
    type: null,
    config: null,
    onExit: null,

    // Saved camera pose (to restore on leave).
    savedPos: new THREE.Vector3(),
    savedQuat: new THREE.Quaternion(),

    // Seat pose (destination while entering / hold).
    seatPos: new THREE.Vector3(),
    seatQuat: new THREE.Quaternion(),

    // Tween bookkeeping.
    tweening: false,
    phase: 'idle', // 'enter' | 'leave' | 'idle'
    t: 0,
    dur: 0,
    fromPos: new THREE.Vector3(),
    fromQuat: new THREE.Quaternion(),
    toPos: new THREE.Vector3(),
    toQuat: new THREE.Quaternion(),

    settled: false,
    idleTime: 0,
  };

  function clearActive() {
    state.active = false;
    state.tweening = false;
    state.phase = 'idle';
    state.type = null;
    state.config = null;
    state.onExit = null;
    state.settled = false;
    state.t = 0;
    state.dur = 0;
    state.idleTime = 0;
  }

  function startTween(toPos, toQuat, dur, phase) {
    try {
      if (!camera) return;
      state.fromPos.copy(camera.position);
      state.fromQuat.copy(camera.quaternion);
      state.toPos.copy(toPos);
      state.toQuat.copy(toQuat);
      state.dur = Math.max(0.0001, dur || 0.0001);
      state.t = 0;
      state.tweening = true;
      state.phase = phase;
      state.settled = false;
    } catch (e) { /* never throw */ }
  }

  function computeSeatPose(prop) {
    try {
      if (!prop || !camera) return false;

      // Prop world position (base).
      if (typeof prop.getWorldPosition === 'function') {
        prop.getWorldPosition(_worldPos);
      } else if (prop.position) {
        _worldPos.copy(prop.position);
      } else {
        return false;
      }

      const ry = (prop.rotation && typeof prop.rotation.y === 'number') ? prop.rotation.y : 0;

      // Front direction: props face +Z rotated by their y-rotation (toward player).
      _front.set(Math.sin(ry), 0, Math.cos(ry));
      if (_front.lengthSq() < 1e-9) _front.set(0, 0, 1);
      _front.normalize();

      // Seat ~2.4 units in front, eye height ~1.15 above prop base.
      state.seatPos.copy(_worldPos)
        .addScaledVector(_front, 2.4);
      state.seatPos.y = _worldPos.y + 1.15;

      // Look target: prop world position raised ~1.1 (screen / felt).
      _target.copy(_worldPos);
      _target.y = _worldPos.y + 1.1;

      // Build target quaternion via a temp Object3D.lookAt().
      _tmpObj.position.copy(state.seatPos);
      _tmpObj.up.set(0, 1, 0);
      _tmpObj.lookAt(_target);
      _tmpObj.updateMatrixWorld(true);
      state.seatQuat.copy(_tmpObj.quaternion);

      return true;
    } catch (e) {
      return false;
    }
  }

  const Seated = {
    enter({ prop, type, config, onExit } = {}) {
      try {
        if (!camera) return;
        // Save current camera pose.
        state.savedPos.copy(camera.position);
        state.savedQuat.copy(camera.quaternion);

        state.type = type != null ? type : null;
        state.config = config != null ? config : null;
        state.onExit = (typeof onExit === 'function') ? onExit : null;

        const ok = computeSeatPose(prop);
        state.active = true;
        state.idleTime = 0;

        if (ok) {
          startTween(state.seatPos, state.seatQuat, 0.9, 'enter');
        } else {
          // Could not compute a seat pose; stay active but do not move.
          state.tweening = false;
          state.phase = 'idle';
          state.settled = true;
        }
      } catch (e) { /* never throw */ }
    },

    update(dt) {
      try {
        if (!state.active || !camera) return;
        const d = (typeof dt === 'number' && isFinite(dt)) ? dt : 0;

        if (state.tweening) {
          state.t += d;
          let raw = state.dur > 0 ? state.t / state.dur : 1;
          if (raw > 1) raw = 1;
          const k = smoothstep(raw);

          camera.position.lerpVectors(state.fromPos, state.toPos, k);
          camera.quaternion.copy(state.fromQuat).slerp(state.toQuat, k);

          if (raw >= 1) {
            // Tween finished.
            state.tweening = false;
            camera.position.copy(state.toPos);
            camera.quaternion.copy(state.toQuat);

            if (state.phase === 'leave') {
              const cb = state.onExit;
              clearActive();
              if (cb) { try { cb(); } catch (e) { /* never throw */ } }
              return;
            }
            // phase === 'enter'
            state.phase = 'idle';
            state.settled = true;
            state.idleTime = 0;
          }
          return;
        }

        // Settled at seat: hold pose with a tiny idle sway.
        if (state.settled && state.phase === 'idle') {
          state.idleTime += d;
          camera.position.copy(state.seatPos);
          const sway = Math.sin(state.idleTime * 0.9) * 0.006;
          const bob = Math.sin(state.idleTime * 1.3) * 0.004;
          camera.position.x += sway;
          camera.position.y += bob;
          camera.quaternion.copy(state.seatQuat);
        }
      } catch (e) { /* never throw */ }
    },

    leave() {
      try {
        if (!state.active || !camera) {
          // Still honor onExit if there's a pending callback.
          const cb = state.onExit;
          clearActive();
          if (cb) { try { cb(); } catch (e) { /* never throw */ } }
          return;
        }
        startTween(state.savedPos, state.savedQuat, 0.7, 'leave');
      } catch (e) { /* never throw */ }
    },

    isActive() {
      return !!state.active;
    },

    isBusy() {
      return !!state.tweening;
    },
  };

  try {
    if (typeof window !== 'undefined') window.Seated = Seated;
  } catch (e) { /* never throw */ }

  return Seated;
}
