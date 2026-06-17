// =============================================================
// Digital Casinos — player.js
// First/third-person player controller + avatar.
//
// PointerLockControls look + WASD/arrows move + Space jump +
// Shift sprint + gravity. Resolves a circle (radius MOVE.RADIUS)
// against stage.colliders (THREE.Box3) in XZ and stands on
// stage.sampleGround. `V` toggles 1st/3rd person; 3rd person shows
// a humanoid avatar (characters.buildHumanoid) using the equipped
// skin, rebuilt/recolored on the window 'skinchange' event.
//
// Export: class Player { constructor({ camera, domElement });
//   setStage(stage); update(dt); get position(); lock(); unlock();
//   get controls(); }
//
// In three@0.160 PointerLockControls.getObject() returns the CAMERA
// itself and mouse-look writes only the camera's *rotation*. So we
// keep our own body position (an "eye anchor"), run all physics on
// it, and each frame place the camera position from it — never
// touching the camera rotation during play, which lets mouse-look
// yaw/pitch accumulate normally in both view modes.
//
// Never throws: every external call is guarded.
// =============================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { MOVE, SKIN_CATALOG } from './config.js';
import { Economy } from './economy.js';
import { buildHumanoid } from './characters.js';

// World fallback bounds (just inside the [-60,60]x[-42,42] floor).
const WORLD = { minX: -59, maxX: 59, minZ: -41, maxZ: 41 };

// Third-person follow camera offset (behind + above the head), metres.
const TP_BACK = 4.0;
const TP_UP = 2.0;

const COLLIDE_ITERS = 3;

// Reusable scratch objects (avoid per-frame allocation).
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Player {
  constructor({ camera, domElement } = {}) {
    this.camera = camera || new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    this.domElement = domElement || (typeof document !== 'undefined' ? document.body : null);

    // --- Look controls ---------------------------------------------------
    // PointerLockControls(camera, domElement). In 0.160 the controlled
    // "object" IS the camera; we never reparent it.
    this._controls = new PointerLockControls(this.camera, this.domElement);
    this.isLocked = false;

    // --- Body / physics state -------------------------------------------
    // bodyPos is the EYE anchor (head) in world space: feet = y - eye.
    this.bodyPos = new THREE.Vector3(0, MOVE.EYE, 0);
    this.velocity = new THREE.Vector3(0, 0, 0); // x/z horizontal, y vertical
    this.onGround = true;
    this.groundY = 0;
    this.eye = MOVE.EYE;

    // --- View ------------------------------------------------------------
    this.thirdPerson = false;

    // --- Input -----------------------------------------------------------
    // Public key map so main.js can read movement-independent keys too.
    this.keys = Object.create(null);

    // --- Stage / avatar --------------------------------------------------
    this.stage = null;
    this.avatar = null; // characters.buildHumanoid api

    this._bindControlsEvents();
    this._bindInput();
    this._bindSkinChange();
    this._buildAvatar();
  }

  // -- public accessors ---------------------------------------------------

  // World position of the controller body (eye anchor).
  get position() { return this.bodyPos.clone(); }

  // Spec-required controls accessor.
  get controls() { return this._controls; }
  // Backward-compatible method form some callers may use.
  getObject() { return this._controls.getObject ? this._controls.getObject() : this.camera; }

  lock() {
    try { if (this._controls && this._controls.lock) this._controls.lock(); } catch (e) { /* ignore */ }
  }

  unlock() {
    try { if (this._controls && this._controls.unlock) this._controls.unlock(); } catch (e) { /* ignore */ }
  }

  // -- setup helpers ------------------------------------------------------

  _bindControlsEvents() {
    if (!this._controls || !this._controls.addEventListener) return;
    this._controls.addEventListener('lock', () => { this.isLocked = true; });
    this._controls.addEventListener('unlock', () => { this.isLocked = false; });
  }

  _bindInput() {
    if (typeof document === 'undefined') return;
    this._onKeyDown = (e) => {
      const code = e.code || e.key;
      if (!code) return;
      this.keys[code] = true;
      if (code === 'KeyV' && !e.repeat) this.toggleView();
    };
    this._onKeyUp = (e) => {
      const code = e.code || e.key;
      if (!code) return;
      this.keys[code] = false;
    };
    // Clear keys on focus loss so movement doesn't "stick".
    this._onBlur = () => { for (const key in this.keys) this.keys[key] = false; };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    if (typeof window !== 'undefined') window.addEventListener('blur', this._onBlur);
  }

  _bindSkinChange() {
    if (typeof window === 'undefined') return;
    this._onSkinChange = () => this._refreshSkin();
    window.addEventListener('skinchange', this._onSkinChange);
  }

  _skinDef() {
    let id = 'highroller';
    try { id = (Economy && Economy.skin) || id; } catch (e) { /* ignore */ }
    return (SKIN_CATALOG && SKIN_CATALOG[id]) || (SKIN_CATALOG && SKIN_CATALOG.highroller) ||
      { suit: 0x222831, accent: 0xffd23f, skin: 0xe0ac69 };
  }

  _buildAvatar() {
    try {
      const def = this._skinDef();
      this.avatar = buildHumanoid({ suit: def.suit, accent: def.accent, skin: def.skin, scale: 1 });
      if (this.avatar && this.avatar.root) this.avatar.root.visible = this.thirdPerson;
    } catch (e) {
      this.avatar = null;
    }
  }

  // Recolor in place when possible; rebuild only if there's no avatar.
  _refreshSkin() {
    const def = this._skinDef();
    if (this.avatar && this.avatar.recolor) {
      try { this.avatar.recolor({ suit: def.suit, accent: def.accent, skin: def.skin }); return; }
      catch (e) { /* fall through to rebuild */ }
    }
    const scene = this.stage && this.stage.scene;
    this._disposeAvatar(scene);
    this._buildAvatar();
    this._attachAvatar(scene);
  }

  _disposeAvatar(scene) {
    if (!this.avatar) return;
    try {
      const root = this.avatar.root;
      if (root && root.parent) root.parent.remove(root);
      else if (scene && root) scene.remove(root);
    } catch (e) { /* ignore */ }
    try { if (this.avatar.dispose) this.avatar.dispose(); } catch (e) { /* ignore */ }
    this.avatar = null;
  }

  _attachAvatar(scene) {
    if (!scene || !this.avatar || !this.avatar.root) return;
    try { scene.add(this.avatar.root); } catch (e) { /* ignore */ }
  }

  // -- stage --------------------------------------------------------------

  setStage(stage) {
    if (!stage) return;
    this.stage = stage;

    // Re-parent the avatar into the new stage's scene.
    if (!this.avatar || !this.avatar.root) this._buildAvatar();
    if (this.avatar && this.avatar.root && this.avatar.root.parent &&
        this.avatar.root.parent !== stage.scene) {
      try { this.avatar.root.parent.remove(this.avatar.root); } catch (e) { /* ignore */ }
    }
    this._attachAvatar(stage.scene);

    // Place the controller body at the spawn point.
    const spawn = stage.spawn || { x: 0, z: 0, heading: 0 };
    const sx = Number.isFinite(spawn.x) ? spawn.x : 0;
    const sz = Number.isFinite(spawn.z) ? spawn.z : 0;
    const ground = this._sampleGround(sx, sz);
    this.groundY = ground;

    this.bodyPos.set(sx, ground + this.eye, sz);
    this.velocity.set(0, 0, 0);
    this.onGround = true;

    // Apply heading by rotating the camera yaw (preserve a level pitch).
    const heading = Number.isFinite(spawn.heading) ? spawn.heading : 0;
    this._setLook(heading, 0);

    // Snap camera + avatar into a consistent state right away.
    this._applyCamera();
    this._updateAvatar(0, false);
  }

  _sampleGround(x, z) {
    if (this.stage && typeof this.stage.sampleGround === 'function') {
      try {
        const g = this.stage.sampleGround(x, z);
        if (Number.isFinite(g)) return g;
      } catch (e) { /* ignore */ }
    }
    return (this.stage && Number.isFinite(this.stage.baseY)) ? this.stage.baseY : 0;
  }

  // -- look helpers -------------------------------------------------------

  _getYaw() {
    _euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    return _euler.y;
  }

  // Set absolute yaw/pitch on the camera (used for spawn heading only).
  _setLook(yaw, pitch) {
    _euler.set(pitch || 0, yaw || 0, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);
  }

  // -- view ---------------------------------------------------------------

  toggleView() {
    this.thirdPerson = !this.thirdPerson;
    if (this.avatar && this.avatar.root) this.avatar.root.visible = this.thirdPerson;
    this._applyCamera();
  }

  // Place the camera POSITION from the body. Never touches camera rotation,
  // so PointerLockControls mouse-look keeps working in both modes.
  _applyCamera() {
    const cam = this.camera;

    if (!this.thirdPerson) {
      // First person: camera sits at the eye anchor.
      cam.position.copy(this.bodyPos);
      return;
    }

    // Third person: pull the camera back & up along the look direction so the
    // avatar stays centered ahead of us (over-the-shoulder follow).
    const yaw = this._getYaw();
    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw)); // flattened look dir

    cam.position.copy(this.bodyPos).addScaledVector(_forward, -TP_BACK);
    cam.position.y += TP_UP;

    // Don't let the follow camera sink through the floor.
    const camGround = this._sampleGround(cam.position.x, cam.position.z);
    if (cam.position.y < camGround + 0.4) cam.position.y = camGround + 0.4;
  }

  // -- main update --------------------------------------------------------

  update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1; // clamp huge gaps (tab switch) for stability

    // --- Wish direction from keys, relative to camera yaw ---------------
    const k = this.keys;
    const fwd = (k['KeyW'] || k['ArrowUp']) ? 1 : 0;
    const back = (k['KeyS'] || k['ArrowDown']) ? 1 : 0;
    const left = (k['KeyA'] || k['ArrowLeft']) ? 1 : 0;
    const right = (k['KeyD'] || k['ArrowRight']) ? 1 : 0;
    const moveZ = fwd - back;   // forward positive
    const moveX = right - left; // right positive

    const yaw = this._getYaw();
    _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw)); // flattened forward
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));    // flattened right

    _wish.set(0, 0, 0)
      .addScaledVector(_forward, moveZ)
      .addScaledVector(_right, moveX);
    _wish.y = 0;

    const wishLen = _wish.length();
    const sprint = !!(k['ShiftLeft'] || k['ShiftRight']);
    const speed = sprint ? MOVE.SPRINT : MOVE.WALK;

    if (wishLen > 1e-4) {
      _wish.multiplyScalar(1 / wishLen); // normalize
      this.velocity.x = _wish.x * speed;
      this.velocity.z = _wish.z * speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // --- Integrate horizontal position ----------------------------------
    this.bodyPos.x += this.velocity.x * dt;
    this.bodyPos.z += this.velocity.z * dt;

    // --- Collide vs stage colliders (circle vs AABB push-out) -----------
    this._resolveCollisions();

    // --- World bounds fallback ------------------------------------------
    const r = MOVE.RADIUS;
    if (this.bodyPos.x < WORLD.minX + r) this.bodyPos.x = WORLD.minX + r;
    if (this.bodyPos.x > WORLD.maxX - r) this.bodyPos.x = WORLD.maxX - r;
    if (this.bodyPos.z < WORLD.minZ + r) this.bodyPos.z = WORLD.minZ + r;
    if (this.bodyPos.z > WORLD.maxZ - r) this.bodyPos.z = WORLD.maxZ - r;

    // --- Vertical: gravity, jump, ground --------------------------------
    const groundTop = this._sampleGround(this.bodyPos.x, this.bodyPos.z);
    this.groundY = groundTop;
    let feetY = this.bodyPos.y - this.eye;

    if (k['Space'] && this.onGround) {
      this.velocity.y = MOVE.JUMP;
      this.onGround = false;
    }

    this.velocity.y -= MOVE.GRAVITY * dt;
    feetY += this.velocity.y * dt;

    if (feetY <= groundTop) {
      feetY = groundTop; // land
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Camera/eye Y = max(groundTop + EYE, integrated). Keeps us above ground.
    this.bodyPos.y = Math.max(groundTop + this.eye, feetY + this.eye);

    // --- Avatar + camera placement --------------------------------------
    const moving = wishLen > 1e-4 &&
      (Math.abs(this.velocity.x) + Math.abs(this.velocity.z)) > 0.1;
    this._updateAvatar(dt, moving);
    this._applyCamera();
  }

  // Standard circle-vs-AABB push-out in XZ; iterated for stability.
  _resolveCollisions() {
    const stage = this.stage;
    if (!stage || !Array.isArray(stage.colliders) || stage.colliders.length === 0) return;

    const r = MOVE.RADIUS;
    const colliders = stage.colliders;
    let px = this.bodyPos.x;
    let pz = this.bodyPos.z;

    for (let iter = 0; iter < COLLIDE_ITERS; iter++) {
      let moved = false;

      for (let i = 0; i < colliders.length; i++) {
        const box = colliders[i];
        if (!box || !box.min || !box.max) continue;

        const minX = box.min.x, maxX = box.max.x;
        const minZ = box.min.z, maxZ = box.max.z;
        if (!(maxX > minX) || !(maxZ > minZ)) continue; // degenerate / non-XZ

        // Closest point on the AABB (XZ) to the circle center.
        const cx = px < minX ? minX : (px > maxX ? maxX : px);
        const cz = pz < minZ ? minZ : (pz > maxZ ? maxZ : pz);

        const dx = px - cx;
        const dz = pz - cz;
        const distSq = dx * dx + dz * dz;

        if (distSq > r * r) continue; // not penetrating

        if (distSq > 1e-8) {
          // Outside/on edge: push out along the closest-point normal.
          const dist = Math.sqrt(distSq);
          const push = (r - dist) / dist;
          px += dx * push;
          pz += dz * push;
        } else {
          // Center inside the box: push out along the axis of least penetration.
          const penLeft = px - minX;
          const penRight = maxX - px;
          const penNear = pz - minZ;
          const penFar = maxZ - pz;
          const minPenX = Math.min(penLeft, penRight);
          const minPenZ = Math.min(penNear, penFar);
          if (minPenX < minPenZ) {
            px += (penLeft < penRight) ? -(penLeft + r) : (penRight + r);
          } else {
            pz += (penNear < penFar) ? -(penNear + r) : (penFar + r);
          }
        }
        moved = true;
      }

      if (!moved) break;
    }

    this.bodyPos.x = px;
    this.bodyPos.z = pz;
  }

  // -- avatar -------------------------------------------------------------

  _updateAvatar(dt, moving) {
    const av = this.avatar;
    if (!av || !av.root) return;

    // Ensure it's parented to the current scene.
    const scene = this.stage && this.stage.scene;
    if (scene && av.root.parent !== scene) {
      try { scene.add(av.root); } catch (e) { /* ignore */ }
    }

    // Visibility follows the view mode (hidden in 1st person).
    av.root.visible = this.thirdPerson;

    // Position at the player's feet (eye anchor minus eye height).
    _tmp.copy(this.bodyPos);
    av.root.position.set(_tmp.x, _tmp.y - this.eye, _tmp.z);

    // Face the camera yaw. The humanoid's eyes face +Z, while our look
    // forward is (-sin yaw, -cos yaw); rotating the root by yaw + PI makes
    // the avatar face the same way the camera looks.
    av.root.rotation.y = this._getYaw() + Math.PI;

    if (typeof av.update === 'function') {
      try { av.update(dt, !!moving); } catch (e) { /* ignore */ }
    }
  }

  // -- teardown (not required by spec; provided for safety) ---------------

  dispose() {
    try {
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', this._onBlur);
        if (this._onSkinChange) window.removeEventListener('skinchange', this._onSkinChange);
      }
    } catch (e) { /* ignore */ }
    this._disposeAvatar(this.stage && this.stage.scene);
    try { if (this._controls && this._controls.dispose) this._controls.dispose(); } catch (e) { /* ignore */ }
  }
}

export default Player;
