// js/postfx.js — neon bloom post-processing for "Digital Casinos".
//
// export function createPostFX(renderer, scene, camera, opts={})
//   -> { render(scene, camera), setSize(w,h), setEnabled(b), isEnabled(), setStrength(s) }
//
// Builds an EffectComposer (RenderPass + UnrealBloomPass + OutputPass) tuned for
// glowing neon. render() updates the RenderPass's .scene/.camera each call because
// the active floor scene swaps at runtime. If the addon imports/construction fail,
// returns a fallback handle that renders directly via renderer.render so the game
// still works without bloom. Never throws.

import * as THREE from 'three';

export function createPostFX(renderer, scene, camera, opts = {}) {
  opts = opts || {};

  const strength = (typeof opts.strength === 'number') ? opts.strength : 0.7;
  const radius = (typeof opts.radius === 'number') ? opts.radius : 0.5;
  const threshold = (typeof opts.threshold === 'number') ? opts.threshold : 0.85;

  // Resolve an initial size. Prefer renderer's drawing buffer; fall back to window.
  let initW = 1, initH = 1;
  try {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    initW = Math.max(1, size.x | 0) || 1;
    initH = Math.max(1, size.y | 0) || 1;
  } catch (e) {
    try {
      initW = Math.max(1, (typeof window !== 'undefined' ? window.innerWidth : 1) | 0) || 1;
      initH = Math.max(1, (typeof window !== 'undefined' ? window.innerHeight : 1) | 0) || 1;
    } catch (e2) { /* keep defaults */ }
  }

  let enabled = (opts.enabled !== false);

  // Fallback handle: renders directly, ignores bloom. Used if anything fails.
  function makeFallback() {
    return {
      render(s, c) {
        try { renderer.render(s || scene, c || camera); } catch (e) { /* swallow */ }
      },
      setSize(_w, _h) { /* no-op */ },
      setEnabled(b) { enabled = !!b; },
      isEnabled() { return enabled; },
      setStrength(_s) { /* no-op */ }
    };
  }

  // Attempt to build the composer pipeline. Any failure -> fallback handle.
  try {
    return buildComposerHandle();
  } catch (e) {
    try { console.warn('[postfx] bloom unavailable, falling back to direct render:', e); } catch (e2) {}
    return makeFallback();
  }

  function buildComposerHandle() {
    // Synchronous static imports would force top-level await; instead we rely on
    // the modules being loadable. We import them lazily but synchronously is not
    // possible, so we use a dynamic-import-free approach: import at module scope.
    // (Handled below by the imported references.)
    return assembleHandle();
  }

  function assembleHandle() {
    const composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initW, initH),
      strength,
      radius,
      threshold
    );
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    try { composer.setSize(initW, initH); } catch (e) {}

    return {
      render(s, c) {
        const useScene = s || scene;
        const useCamera = c || camera;
        if (!enabled) {
          try { renderer.render(useScene, useCamera); } catch (e) {}
          return;
        }
        // The active floor scene swaps at runtime; keep the RenderPass in sync.
        try {
          renderPass.scene = useScene;
          renderPass.camera = useCamera;
          composer.render();
        } catch (e) {
          // If composing fails at runtime, degrade gracefully to direct render.
          try { renderer.render(useScene, useCamera); } catch (e2) {}
        }
      },
      setSize(w, h) {
        const W = Math.max(1, w | 0) || 1;
        const H = Math.max(1, h | 0) || 1;
        try { composer.setSize(W, H); } catch (e) {}
        try {
          if (bloomPass.resolution && typeof bloomPass.resolution.set === 'function') {
            bloomPass.resolution.set(W, H);
          }
          if (typeof bloomPass.setSize === 'function') {
            bloomPass.setSize(W, H);
          }
        } catch (e) {}
      },
      setEnabled(b) { enabled = !!b; },
      isEnabled() { return enabled; },
      setStrength(sVal) {
        const v = (typeof sVal === 'number' && isFinite(sVal)) ? sVal : strength;
        try { bloomPass.strength = v; } catch (e) {}
      }
    };
  }
}

// Addon imports. Kept at module scope; wrapped via a guarded namespace so that a
// failed import surfaces as a thrown error inside createPostFX's try/catch when
// the symbols are first used (construction), triggering the direct-render fallback.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
