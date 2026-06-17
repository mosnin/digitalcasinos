// =============================================================
// Digital Casinos — main integrator.
// Wires the mega-casino, player, parcels, games, shops, skins,
// UI, auth AND the wave-2 depth features (audio, bloom, patrons,
// achievements, daily bonus, settings, minimap, touch, leaderboard,
// games lobby) into one playable loop. Only the ACTIVE floor renders.
// =============================================================
import * as THREE from 'three';
import {
  FLOORS, GAME_CATALOG, DECOR_CATALOG,
  tileFromWorld, parcelKey, isBuildableTile,
} from './config.js';
import { Economy } from './economy.js';
import { UI } from './ui.js';
import { createCasino } from './casino.js';
import { attachParcels } from './parcels.js';
import { NPCManager } from './characters.js';
import { Player } from './player.js';
import { openGame, openGameEditor } from './games.js';
import { openShop, openDecorStore } from './shops.js';
import { openSkinShop } from './skins.js';
import { initAuth } from './auth.js';
// wave 2
import { SFX } from './audio.js';
import { createPostFX } from './postfx.js';
import { createPatrons } from './patrons.js';
import { Achievements } from './achievements.js';
import { maybeShowDailyBonus, openDailyBonus } from './dailybonus.js';
import { Settings } from './settings.js';
import { Minimap } from './minimap.js';
import { initTouchControls } from './touch.js';
import { openLeaderboard, submitScore } from './leaderboard.js';
import { openGamesLobby } from './gameslobby.js';

const sfx = (name) => { try { SFX.play(name); } catch (e) {} };

// ---- renderer / camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.setClearColor(0x05050b, 1);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);
const clock = new THREE.Clock();
const scenePlaceholder = new THREE.Scene();
const postfx = createPostFX(renderer, scenePlaceholder, camera, { strength: 0.7, radius: 0.5, threshold: 0.85 });

const _euler = new THREE.Euler();
function camYaw() { _euler.setFromQuaternion(camera.quaternion, 'YXZ'); return _euler.y; }

// ---- core state ----
UI.init();
Minimap.init();
const NPC_PER_FLOOR = 14;
let crowdOn = true;

const player = new Player({ camera, domElement: renderer.domElement });

// passive-income patrons that play your placed machines
const patrons = createPatrons({
  economy: Economy,
  onEarn: () => { sfx('coin'); },
});

// hooks parcels uses to open game / editor modals
const parcelHooks = {
  onPlay: (type, key, index, config) => { player.unlock(); sfx('click'); openGame(type, config); },
  onEdit: (type, key, index, config) => {
    player.unlock(); sfx('click');
    openGameEditor(type, config, (newCfg) => {
      Economy.updateGameConfig(key, index, newCfg);
      UI.toast('Game mechanics updated', 'good');
    });
  },
  toast: (m, k) => { UI.toast(m, k); if (k === 'good') sfx('place'); else if (k === 'bad' || k === 'warn') sfx('error'); },
};

const casino = createCasino({ economy: Economy, openShop: (kind) => { player.unlock(); sfx('click'); openShop(kind); } });

const floorStates = new Map(); // index -> { stage, parcelsApi, npc }
let currentFloor = 0;
let active = null;
let started = false;
let buildSelId = null;

function ensureFloor(idx) {
  if (floorStates.has(idx)) return floorStates.get(idx);
  const stage = casino.getFloor(idx);
  const parcelsApi = attachParcels(stage, Economy, parcelHooks);
  const npc = new NPCManager(stage.scene);
  if (crowdOn) { try { npc.spawnCrowd(NPC_PER_FLOOR, () => casino.randomWalkablePoint(idx)); } catch (e) {} }
  const st = { stage, parcelsApi, npc };
  floorStates.set(idx, st);
  return st;
}

function switchFloor(idx) {
  idx = Math.max(0, Math.min(FLOORS.length - 1, idx | 0));
  exitBuildMode();
  const st = ensureFloor(idx);
  currentFloor = idx;
  active = st;
  player.setStage(st.stage);
  st.parcelsApi.refresh();
  try { patrons.setFloor(st.stage.scene, idx); } catch (e) {}
  try { Minimap.setFloor(idx); } catch (e) {}
  try { SFX.startAmbient(FLOORS[idx].theme); } catch (e) {}
  UI.closeFloorMenu();
  player.lock();
}

// elevator → floor menu
casino.onElevator = () => {
  player.unlock(); sfx('elevator');
  UI.openFloorMenu(FLOORS, currentFloor, (idx) => switchFloor(idx));
};

// ---- build palette (games + decorations) ----
function buildPaletteGroups() {
  return [
    { label: '🎲 Casino Games', items: Object.values(GAME_CATALOG).map(g => ({ id: g.id, name: g.name, icon: g.icon, cost: g.cost, kind: 'game' })) },
    { label: '✨ Decorations', items: Object.values(DECOR_CATALOG).map(d => ({ id: d.id, name: d.name, icon: d.icon, cost: d.cost, kind: 'decor' })) },
  ];
}
function openBuild() {
  player.unlock(); sfx('click');
  UI.openBuildPalette(buildPaletteGroups(), (item) => {
    buildSelId = item.id;
    active.parcelsApi.enterBuildMode({ kind: item.kind, type: item.id });
    player.lock();
    UI.toast(`Placing ${item.name} — walk to a tile, [F] place`, 'good');
  }, () => { active.parcelsApi.exitBuildMode(); buildSelId = null; }, buildSelId);
}
function exitBuildMode() {
  buildSelId = null;
  if (active) active.parcelsApi.exitBuildMode();
  UI.closeBuildPalette();
}
function isBuildMode() { return !!(active && active.parcelsApi.isBuildMode()); }

// ---- interaction ----
function nearestTrigger(pos) {
  const trigs = (active && active.stage && active.stage.triggers) || [];
  let best = null, bestD = Infinity;
  for (const t of trigs) {
    if (!t || !t.pos) continue;
    const dx = t.pos.x - pos.x, dz = t.pos.z - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < (t.radius || 2.5) && d < bestD) { bestD = d; best = t; }
  }
  return best;
}
function interact() {
  const pos = player.position;
  if (!isBuildMode() && active.parcelsApi.playNearest(pos)) return;
  const t = nearestTrigger(pos);
  if (t && typeof t.action === 'function') { try { t.action(); } catch (e) {} }
}
function doBuyOrBuild() {
  const pos = player.position;
  const t = tileFromWorld(pos.x, pos.z);
  const key = t ? parcelKey(currentFloor, t.ti, t.tj) : null;
  if (key && Economy.ownsParcel(key)) openBuild();
  else { sfx('buy'); active.parcelsApi.tryBuyUnderPlayer(pos); Achievements.evaluate(); }
}

// ---- key handling (movement + V handled inside Player) ----
document.addEventListener('keydown', (e) => {
  if (!started) return;
  const code = e.code;
  if (code === 'Escape') { if (UI.isModalOpen()) { exitBuildMode(); UI.closeAll(); } return; }
  if (UI.isModalOpen() && !isBuildMode()) return;

  switch (code) {
    case 'KeyE': interact(); break;
    case 'KeyB': doBuyOrBuild(); break;
    case 'KeyG': if (UI.isModalOpen()) exitBuildMode(); else openBuild(); break;
    case 'KeyF': if (isBuildMode()) { active.parcelsApi.placeUnderPlayer(player.position); Achievements.evaluate(); } break;
    case 'KeyR':
      if (isBuildMode()) { active.parcelsApi.rotateGhost(); sfx('click'); }
      else active.parcelsApi.editNearest(player.position);
      break;
    case 'KeyX': sfx('remove'); active.parcelsApi.removeUnderPlayer(player.position); break;
    case 'KeyM': player.unlock(); UI.toggleMap(() => ({ economy: Economy, playerPos: player.position, floorIndex: currentFloor })); break;
    case 'KeyP': player.unlock(); openSkinShop(); break;          // personalize / skins
    case 'KeyT': player.unlock(); openShop('gift'); break;        // sTore / gift shop
    case 'KeyJ': player.unlock(); Achievements.openPanel(); break; // achievements
    case 'KeyO': player.unlock(); Settings.open(); break;         // options
    case 'KeyK': player.unlock(); openGamesLobby(); break;        // games lobby
    case 'KeyL': player.unlock(); openLeaderboard({ economy: Economy }); break; // leaderboard
    case 'KeyC': player.unlock(); openDailyBonus({ economy: Economy, force: true }); break; // daily bonus / claim
    default: break;
  }
});

renderer.domElement.addEventListener('click', () => {
  if (started && !player.isLocked && (!UI.isModalOpen() || isBuildMode())) { try { SFX.unlock(); } catch (e) {} player.lock(); }
});

// ---- settings application ----
function applySettings(v) {
  if (!v) return;
  try { SFX.setVolume(v.volume); SFX.setMuted(v.volume <= 0); } catch (e) {}
  try { postfx.setEnabled(!!v.bloom); } catch (e) {}
  try { camera.fov = v.fov || 72; camera.updateProjectionMatrix(); } catch (e) {}
  try { if (player.controls) player.controls.pointerSpeed = v.sensitivity || 1; } catch (e) {}
  try { Minimap.setVisible(!!v.minimap); } catch (e) {}
  applyCrowd(v.crowd !== false);
}
function applyCrowd(on) {
  crowdOn = on;
  if (!active || !active.npc) return;
  try {
    active.npc.clear();
    if (on) active.npc.spawnCrowd(NPC_PER_FLOOR, () => casino.randomWalkablePoint(currentFloor));
  } catch (e) {}
}
Settings.init({ onChange: applySettings });

// touch controls (no-op on desktop)
initTouchControls({
  player,
  actions: {
    interact, buy: doBuyOrBuild, build: openBuild,
    place: () => { if (isBuildMode()) active.parcelsApi.placeUnderPlayer(player.position); },
    jump: () => { player.keys['Space'] = true; setTimeout(() => { player.keys['Space'] = false; }, 120); },
  },
});

// ---- HUD ----
let hudAcc = 0;
function updateHud(dt) {
  const pos = player.position;
  let prompt = '';
  if (isBuildMode()) {
    prompt = '<b>[F]</b> place · <b>[R]</b> rotate · <b>[X]</b> remove · <b>[G]</b> done';
  } else {
    prompt = (active.parcelsApi.getPrompt(pos) || '');
    if (!prompt) { const t = nearestTrigger(pos); if (t) prompt = t.prompt; }
  }
  if (prompt) UI.showPrompt(prompt); else UI.hidePrompt();

  hudAcc += dt;
  if (hudAcc > 0.2) {
    hudAcc = 0;
    let loc = `<b>${FLOORS[currentFloor].name}</b>`;
    const t = tileFromWorld(pos.x, pos.z);
    if (t) {
      const key = parcelKey(currentFloor, t.ti, t.tj);
      if (Economy.ownsParcel(key)) loc += '<br><span style="color:#3fff8c">● Your parcel</span>';
      else if (isBuildableTile(currentFloor, t.ti, t.tj)) loc += `<br><span style="color:#ffd23f">○ For sale — ${Economy.parcelPrice(currentFloor)} 🪙</span>`;
      else loc += '<br><span style="color:#8a85a8">Common area</span>';
    }
    loc += '<br><span style="font-size:11px;color:#8a85a8">G build·B buy·E use·M map·K games·J wins·L ranks·O opts·P skins·T shop·V view</span>';
    UI.setLocation(loc);
  }
}

// ---- main loop ----
let achAcc = 0, lbAcc = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (!started || !active) { postfx.render(scenePlaceholder, camera); return; }
  if (player.isLocked) player.update(dt);
  try { active.stage.update(dt, { playerPos: player.position, camera, keys: player.keys }); } catch (e) {}
  try { active.npc.update(dt); } catch (e) {}
  try { patrons.update(dt); } catch (e) {}
  try { Minimap.update(player.position, camYaw()); } catch (e) {}
  achAcc += dt; if (achAcc > 1.5) { achAcc = 0; try { Achievements.evaluate(); } catch (e) {} }
  lbAcc += dt; if (lbAcc > 25) { lbAcc = 0; submitScore({ economy: Economy, name: (Economy.state.profile && Economy.state.profile.name) || 'Player' }).catch(() => {}); }
  updateHud(dt);
  postfx.render(active.stage.scene, camera);
}
animate();

// ---- resize ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  try { postfx.setSize(window.innerWidth, window.innerHeight); } catch (e) {}
});

// ---- start / auth ----
Achievements.init({ economy: Economy, onUnlock: (a) => { UI.toast(`🏆 ${a.name || 'Achievement'}!`, 'good'); sfx('win'); } });

function startGame() {
  if (started) return;
  started = true;
  const ss = document.getElementById('startScreen');
  const hud = document.getElementById('hud');
  if (ss) ss.classList.add('hidden');
  if (hud) hud.classList.remove('hidden');
  try { SFX.unlock(); } catch (e) {}
  switchFloor(0);
  setTimeout(() => {
    try { if (maybeShowDailyBonus({ economy: Economy })) player.unlock(); } catch (e) {}
  }, 900);
}

const playBtn = document.getElementById('playBtn');
if (playBtn) playBtn.addEventListener('click', startGame);

initAuth().catch(() => {});

if (typeof window !== 'undefined') {
  window.DigitalCasinos = {
    Economy, casino, player, switchFloor,
    openShop, openDecorStore, openSkinShop, openGamesLobby,
    openLeaderboard: () => openLeaderboard({ economy: Economy }),
    Achievements, Settings, SFX,
  };
}
