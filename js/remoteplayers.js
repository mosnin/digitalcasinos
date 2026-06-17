// =============================================================
// Digital Casinos — remoteplayers.js
// Renders other online players in the active 3D scene.
//
// Exports:
//   createRemotePlayers() -> remote
//
// Each remote player gets a lazily-built humanoid (characters.buildHumanoid)
// recolored to their skin, plus a floating canvas name sprite above the head.
// Positions/yaw are network targets we smoothly lerp toward each frame; the
// humanoid walk animation plays while the avatar is moving.
//
// The integrator routes net.onUpdate -> remote.apply, swaps scenes on a
// destination change via remote.setStage, and calls remote.update(dt) each
// frame. Everything here is defensive and never throws.
// =============================================================

import * as THREE from 'three';
import { buildHumanoid } from './characters.js';
import { getSkinColors } from './skins.js';

// Never let anything escape this module.
const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

// At most this many remote avatars in a scene; extras are ignored.
const MAX_AVATARS = 30;

// Lerp rates / thresholds.
const POS_LERP = 8;          // position smoothing per second
const YAW_LERP = 8;          // yaw smoothing per second
const MOVE_THRESHOLD = 0.004; // metres-per-frame distance that counts as "moving"
const NAME_Y = 2.1;          // sprite height above the avatar's feet

// =============================================================
// Shared canvas name-sprite helper.
// Renders text to a small canvas, returns a THREE.Sprite (auto-billboards).
// =============================================================
function makeNameSprite(text) {
  return safe(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const w = 256, h = 64;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const label = (text == null ? '' : String(text)).slice(0, 24) || 'Player';

    ctx.clearRect(0, 0, w, h);
    // Rounded pill background.
    ctx.fillStyle = 'rgba(12,10,24,0.72)';
    const r = 16;
    ctx.beginPath();
    ctx.moveTo(r, 6);
    ctx.lineTo(w - r, 6);
    ctx.quadraticCurveTo(w - 6, 6, w - 6, 6 + r);
    ctx.lineTo(w - 6, h - 6 - r);
    ctx.quadraticCurveTo(w - 6, h - 6, w - 6 - r, h - 6);
    ctx.lineTo(r, h - 6);
    ctx.quadraticCurveTo(6, h - 6, 6, h - 6 - r);
    ctx.lineTo(6, 6 + r);
    ctx.quadraticCurveTo(6, 6, r, 6);
    ctx.closePath();
    ctx.fill();

    ctx.font = '700 30px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(label, w / 2, h / 2 + 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.1, 0.275, 1);
    sprite.position.set(0, NAME_Y, 0);
    sprite.renderOrder = 999;
    return sprite;
  }, null);
}

function disposeSprite(sprite) {
  safe(() => {
    if (!sprite) return;
    if (sprite.parent) sprite.parent.remove(sprite);
    const mat = sprite.material;
    if (mat) {
      if (mat.map && typeof mat.map.dispose === 'function') mat.map.dispose();
      if (typeof mat.dispose === 'function') mat.dispose();
    }
  });
}

// Shortest signed angular difference a->b in (-PI, PI].
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// =============================================================
// createRemotePlayers()
// =============================================================
export function createRemotePlayers() {
  // id -> avatar record
  const players = new Map();
  let scene = null;
  let destId = null;
  let camera = null;

  function removeRecord(rec) {
    safe(() => {
      if (!rec) return;
      if (rec.nameSprite) disposeSprite(rec.nameSprite);
      const api = rec.api;
      if (api) {
        if (api.root && api.root.parent) api.root.parent.remove(api.root);
        else if (api.root && scene) safe(() => scene.remove(api.root));
        if (typeof api.dispose === 'function') api.dispose();
      }
    });
  }

  function clear() {
    safe(() => {
      players.forEach((rec) => removeRecord(rec));
      players.clear();
    });
  }

  function setStage(newScene, newDestId) {
    safe(() => {
      // Tear everything down off the old scene first.
      clear();
      scene = newScene || null;
      destId = (newDestId == null) ? null : newDestId;
    });
  }

  function setCamera(cam) {
    camera = cam || null;
  }

  function remove(id) {
    safe(() => {
      if (id == null) return;
      const rec = players.get(id);
      if (!rec) return;
      removeRecord(rec);
      players.delete(id);
    });
  }

  function apply(state) {
    safe(() => {
      if (!state || state.id == null) return;
      const id = state.id;

      // Wrong destination (or we have no stage) -> ensure no avatar exists.
      if (destId == null || state.dest !== destId) {
        if (players.has(id)) remove(id);
        return;
      }

      let rec = players.get(id);

      // Lazily create a new avatar if we don't have one yet.
      if (!rec) {
        if (!scene) return;
        if (players.size >= MAX_AVATARS) return; // cap reached, ignore extras
        if (typeof buildHumanoid !== 'function') return;

        const colors = safe(() => getSkinColors(state.skin), null) || {};
        const api = safe(() => buildHumanoid({
          suit: colors.suit,
          accent: colors.accent,
          skin: colors.skin,
        }), null);
        if (!api || !api.root) return;

        const x = Number.isFinite(state.x) ? state.x : 0;
        const z = Number.isFinite(state.z) ? state.z : 0;
        const yaw = Number.isFinite(state.yaw) ? state.yaw : 0;

        api.root.position.set(x, 0, z);
        api.root.rotation.y = yaw;
        safe(() => scene.add(api.root));

        const nameSprite = makeNameSprite(state.name);
        if (nameSprite) safe(() => api.root.add(nameSprite));

        rec = {
          api,
          target: { x, z, yaw },
          current: { x, z, yaw },
          nameSprite,
          name: (state.name == null ? '' : String(state.name)),
          skin: state.skin,
          lastMoveTime: 0,
        };
        players.set(id, rec);
        return;
      }

      // Existing avatar: update targets.
      if (Number.isFinite(state.x)) rec.target.x = state.x;
      if (Number.isFinite(state.z)) rec.target.z = state.z;
      if (Number.isFinite(state.yaw)) rec.target.yaw = state.yaw;

      // Rebuild the name sprite only if the name actually changed.
      const newName = (state.name == null ? '' : String(state.name));
      if (newName !== rec.name) {
        rec.name = newName;
        const next = makeNameSprite(newName);
        if (next) {
          if (rec.nameSprite) disposeSprite(rec.nameSprite);
          rec.nameSprite = next;
          if (rec.api && rec.api.root) safe(() => rec.api.root.add(next));
        }
      }

      // Recolor if the skin changed.
      if (state.skin !== rec.skin) {
        rec.skin = state.skin;
        safe(() => {
          if (rec.api && typeof rec.api.recolor === 'function') {
            const colors = getSkinColors(state.skin) || {};
            rec.api.recolor({ suit: colors.suit, accent: colors.accent, skin: colors.skin });
          }
        });
      }
    });
  }

  function update(dt) {
    safe(() => {
      const step = (dt > 0) ? dt : 0;
      const kPos = Math.min(1, step * POS_LERP);
      const kYaw = Math.min(1, step * YAW_LERP);

      players.forEach((rec) => {
        safe(() => {
          const api = rec.api;
          if (!api || !api.root) return;

          const cur = rec.current;
          const tgt = rec.target;

          const px = cur.x;
          const pz = cur.z;

          cur.x += (tgt.x - cur.x) * kPos;
          cur.z += (tgt.z - cur.z) * kPos;
          cur.yaw += angleDiff(cur.yaw, tgt.yaw) * kYaw;

          api.root.position.x = cur.x;
          api.root.position.z = cur.z;
          api.root.rotation.y = cur.yaw;

          const moved = Math.hypot(cur.x - px, cur.z - pz);
          const moving = moved > MOVE_THRESHOLD;

          if (typeof api.update === 'function') api.update(step, moving);

          // Sprites auto-billboard, but keep them upright and facing the
          // camera explicitly when one is available.
          if (rec.nameSprite && camera) {
            rec.nameSprite.position.set(0, NAME_Y, 0);
          }
        });
      });
    });
  }

  return { setStage, setCamera, apply, remove, update, clear };
}
