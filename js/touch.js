// =============================================================
// Digital Casinos — touch.js
// Mobile / touch on-screen controls.
//
// export function initTouchControls({ player, actions })
//   -> { enabled, destroy() }
//
// On a touch device, overlays:
//   * a left virtual joystick driving player.keys (WASD via thresholds),
//   * a right-side look pad rotating player.camera yaw/pitch,
//   * an action-button cluster calling actions.interact/buy/build/place/jump.
// On a non-touch device it is a pure no-op (enabled:false, no DOM).
//
// Never throws: every external touch-point is guarded.
// =============================================================

import * as THREE from 'three';

// Movement deadzone (fraction of joystick radius) before a direction "fires".
const DEADZONE = 0.32;
// Joystick base radius (px) and knob travel radius.
const STICK_R = 56;
const KNOB_R = 30;
// Look sensitivity (radians per px dragged).
const LOOK_SENS = 0.0042;
// Pitch clamp (radians).
const PITCH_LIMIT = 1.5;

// Movement key codes we drive.
const MOVE_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];

function isTouchDevice() {
  try {
    if (typeof window === 'undefined') return false;
    if ('ontouchstart' in window) return true;
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
    if (typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer:coarse)').matches) return true;
  } catch (e) { /* ignore */ }
  return false;
}

function noopController() {
  return { enabled: false, destroy() {} };
}

export function initTouchControls({ player, actions } = {}) {
  // Guard the whole thing — never throw out of init.
  try {
    if (!isTouchDevice() || typeof document === 'undefined' || !document.body) {
      return noopController();
    }

    const acts = actions || {};
    const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Track listener registrations so destroy() can remove them all.
    const listeners = []; // { el, type, fn, opts }
    function on(el, type, fn, opts) {
      if (!el || !el.addEventListener) return;
      try { el.addEventListener(type, fn, opts); listeners.push({ el, type, fn, opts }); }
      catch (e) { /* ignore */ }
    }

    // ---- Helpers ---------------------------------------------------------

    function setKey(code, v) {
      try { if (player && player.keys) player.keys[code] = !!v; } catch (e) { /* ignore */ }
    }
    function clearMoveKeys() {
      for (let i = 0; i < MOVE_KEYS.length; i++) setKey(MOVE_KEYS[i], false);
    }

    function applyLook(dx, dy) {
      try {
        const cam = player && player.camera;
        if (!cam || !cam.quaternion) return;
        _euler.setFromQuaternion(cam.quaternion, 'YXZ');
        _euler.y += dx * LOOK_SENS;
        _euler.x -= dy * LOOK_SENS;
        if (_euler.x > PITCH_LIMIT) _euler.x = PITCH_LIMIT;
        if (_euler.x < -PITCH_LIMIT) _euler.x = -PITCH_LIMIT;
        _euler.z = 0;
        cam.quaternion.setFromEuler(_euler);
      } catch (e) { /* ignore */ }
    }

    function callAction(name) {
      try {
        const fn = acts && acts[name];
        if (typeof fn === 'function') fn();
      } catch (e) { /* ignore */ }
    }

    // ---- DOM scaffolding -------------------------------------------------

    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed', left: '0', top: '0', right: '0', bottom: '0',
      width: '100%', height: '100%', margin: '0', padding: '0',
      pointerEvents: 'none', zIndex: '99999',
      touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none',
      webkitTapHighlightColor: 'transparent', overflow: 'hidden',
    });

    const NEON = '#39f6ff';
    const NEON_DIM = 'rgba(57,246,255,0.12)';
    const NEON_LINE = 'rgba(57,246,255,0.55)';

    // ---- Left virtual joystick ------------------------------------------

    const stick = document.createElement('div');
    Object.assign(stick.style, {
      position: 'absolute', left: '26px', bottom: '26px',
      width: (STICK_R * 2) + 'px', height: (STICK_R * 2) + 'px',
      borderRadius: '50%',
      background: NEON_DIM, border: '2px solid ' + NEON_LINE,
      boxShadow: '0 0 14px rgba(57,246,255,0.35)',
      pointerEvents: 'auto', touchAction: 'none',
    });
    const knob = document.createElement('div');
    Object.assign(knob.style, {
      position: 'absolute',
      left: (STICK_R - KNOB_R) + 'px', top: (STICK_R - KNOB_R) + 'px',
      width: (KNOB_R * 2) + 'px', height: (KNOB_R * 2) + 'px',
      borderRadius: '50%',
      background: 'rgba(57,246,255,0.35)', border: '2px solid ' + NEON,
      boxShadow: '0 0 16px rgba(57,246,255,0.6)',
      pointerEvents: 'none', transition: 'none',
    });
    stick.appendChild(knob);
    root.appendChild(stick);

    let stickId = null; // active touch identifier for the joystick

    function findTouch(touchList, id) {
      if (!touchList) return null;
      for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === id) return touchList[i];
      }
      return null;
    }

    function updateStick(clientX, clientY) {
      let rect;
      try { rect = stick.getBoundingClientRect(); } catch (e) { return; }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy) || 0;
      const max = STICK_R;
      let nx = 0, ny = 0;
      if (len > 0) {
        const cl = Math.min(len, max);
        nx = (dx / len) * cl;
        ny = (dy / len) * cl;
        knob.style.left = (STICK_R - KNOB_R + nx) + 'px';
        knob.style.top = (STICK_R - KNOB_R + ny) + 'px';
        dx = nx / max; // -1..1
        dy = ny / max;
      }
      // Forward is up (negative screen Y).
      setKey('KeyW', dy < -DEADZONE);
      setKey('KeyS', dy > DEADZONE);
      setKey('KeyA', dx < -DEADZONE);
      setKey('KeyD', dx > DEADZONE);
    }

    function resetStick() {
      knob.style.left = (STICK_R - KNOB_R) + 'px';
      knob.style.top = (STICK_R - KNOB_R) + 'px';
      clearMoveKeys();
    }

    on(stick, 'touchstart', (e) => {
      try {
        if (stickId !== null) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        stickId = t.identifier;
        updateStick(t.clientX, t.clientY);
        e.preventDefault();
      } catch (err) { /* ignore */ }
    }, { passive: false });

    on(stick, 'touchmove', (e) => {
      try {
        if (stickId === null) return;
        const t = findTouch(e.changedTouches, stickId);
        if (!t) return;
        updateStick(t.clientX, t.clientY);
        e.preventDefault();
      } catch (err) { /* ignore */ }
    }, { passive: false });

    function endStick(e) {
      try {
        if (stickId === null) return;
        const t = findTouch(e.changedTouches, stickId);
        if (!t) return;
        stickId = null;
        resetStick();
        e.preventDefault();
      } catch (err) { /* ignore */ }
    }
    on(stick, 'touchend', endStick, { passive: false });
    on(stick, 'touchcancel', endStick, { passive: false });

    // ---- Right-side look pad --------------------------------------------

    const lookPad = document.createElement('div');
    Object.assign(lookPad.style, {
      position: 'absolute', right: '0', top: '0',
      width: '50%', height: '100%',
      pointerEvents: 'auto', touchAction: 'none', background: 'transparent',
    });
    root.appendChild(lookPad);

    let lookId = null;
    let lastLX = 0, lastLY = 0;

    on(lookPad, 'touchstart', (e) => {
      try {
        if (lookId !== null) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        lookId = t.identifier;
        lastLX = t.clientX;
        lastLY = t.clientY;
        e.preventDefault();
      } catch (err) { /* ignore */ }
    }, { passive: false });

    on(lookPad, 'touchmove', (e) => {
      try {
        if (lookId === null) return;
        const t = findTouch(e.changedTouches, lookId);
        if (!t) return;
        const dx = t.clientX - lastLX;
        const dy = t.clientY - lastLY;
        lastLX = t.clientX;
        lastLY = t.clientY;
        applyLook(dx, dy);
        e.preventDefault();
      } catch (err) { /* ignore */ }
    }, { passive: false });

    function endLook(e) {
      try {
        if (lookId === null) return;
        const t = findTouch(e.changedTouches, lookId);
        if (!t) return;
        lookId = null;
        e.preventDefault();
      } catch (err) { /* ignore */ }
    }
    on(lookPad, 'touchend', endLook, { passive: false });
    on(lookPad, 'touchcancel', endLook, { passive: false });

    // ---- Action buttons --------------------------------------------------

    const cluster = document.createElement('div');
    Object.assign(cluster.style, {
      position: 'absolute', right: '22px', bottom: '24px',
      display: 'flex', flexWrap: 'wrap', flexDirection: 'row-reverse',
      gap: '10px', width: '188px', justifyContent: 'flex-start',
      pointerEvents: 'none',
    });
    root.appendChild(cluster);

    function makeButton(label, color, action) {
      const b = document.createElement('div');
      Object.assign(b.style, {
        pointerEvents: 'auto', touchAction: 'none',
        minWidth: '56px', height: '56px', padding: '0 10px',
        boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%',
        font: '700 15px/1 system-ui, sans-serif', letterSpacing: '0.5px',
        color: color, textAlign: 'center',
        background: 'rgba(0,0,0,0.35)',
        border: '2px solid ' + color,
        boxShadow: '0 0 12px ' + color + '66',
        userSelect: 'none', webkitUserSelect: 'none',
      });
      b.textContent = label;
      function press(e) {
        try {
          b.style.background = 'rgba(255,255,255,0.18)';
          callAction(action);
          if (e && e.preventDefault) e.preventDefault();
        } catch (err) { /* ignore */ }
      }
      function release(e) {
        try {
          b.style.background = 'rgba(0,0,0,0.35)';
          if (e && e.preventDefault) e.preventDefault();
        } catch (err) { /* ignore */ }
      }
      on(b, 'touchstart', press, { passive: false });
      on(b, 'touchend', release, { passive: false });
      on(b, 'touchcancel', release, { passive: false });
      cluster.appendChild(b);
      return b;
    }

    // Order: row-reverse means first-added sits right-most.
    makeButton('E', '#39f6ff', 'interact');
    makeButton('Jump', '#ffd23f', 'jump');
    makeButton('Buy', '#ff5fd2', 'buy');
    makeButton('Build', '#7cff5f', 'build');
    makeButton('Place', '#ff9d3f', 'place');

    // ---- Mount -----------------------------------------------------------

    document.body.appendChild(root);

    // ---- Teardown --------------------------------------------------------

    let destroyed = false;
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      try { clearMoveKeys(); } catch (e) { /* ignore */ }
      for (let i = 0; i < listeners.length; i++) {
        const l = listeners[i];
        try { l.el.removeEventListener(l.type, l.fn, l.opts); } catch (e) { /* ignore */ }
      }
      listeners.length = 0;
      try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) { /* ignore */ }
    }

    return { enabled: true, destroy };
  } catch (e) {
    return noopController();
  }
}

export default initTouchControls;
