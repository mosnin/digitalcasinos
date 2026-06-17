// =============================================================
// Digital Casinos — main integrator.
// Wires the mega-casino, player, parcels, games, shops, skins,
// UI and Supabase auth into one playable loop. Only the ACTIVE
// floor/section is updated & rendered (smooth performance).
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

// ---- core state ----
UI.init();
const NPC_PER_FLOOR = 14;

const player = new Player({ camera, domElement: renderer.domElement });

// hooks parcels uses to open game / editor modals
const parcelHooks = {
  onPlay: (type, key, index, config) => { player.unlock(); openGame(type, config); },
  onEdit: (type, key, index, config) => {
    player.unlock();
    openGameEditor(type, config, (newCfg) => {
      Economy.updateGameConfig(key, index, newCfg);
      UI.toast('Game mechanics updated', 'good');
    });
  },
  toast: (m, k) => UI.toast(m, k),
};

const casino = createCasino({ economy: Economy, openShop });

const floorStates = new Map(); // index -> { stage, parcelsApi, npc }
let currentFloor = 0;
let active = null;        // current floor state
let started = false;
let buildSelId = null;

function ensureFloor(idx) {
  if (floorStates.has(idx)) return floorStates.get(idx);
  const stage = casino.getFloor(idx);
  const parcelsApi = attachParcels(stage, Economy, parcelHooks);
  const npc = new NPCManager(stage.scene);
  try { npc.spawnCrowd(NPC_PER_FLOOR, () => casino.randomWalkablePoint(idx)); } catch (e) {}
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
  UI.closeFloorMenu();
  player.lock();
}

// elevator → floor menu
casino.onElevator = () => {
  player.unlock();
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
  player.unlock();
  UI.openBuildPalette(buildPaletteGroups(), (item) => {
    buildSelId = item.id;
    active.parcelsApi.enterBuildMode({ kind: item.kind, type: item.id });
    player.lock(); // re-lock so you can walk & position the ghost
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
  // 1) sit & play a game on your parcel
  if (!isBuildMode() && active.parcelsApi.playNearest(pos)) return;
  // 2) elevator / gift shop / restaurant / show triggers
  const t = nearestTrigger(pos);
  if (t && typeof t.action === 'function') { try { t.action(); } catch (e) {} }
}

// ---- key handling (movement + V handled inside Player) ----
document.addEventListener('keydown', (e) => {
  if (!started) return;
  const code = e.code;
  // let modals/menus have Escape to close
  if (code === 'Escape') { if (UI.isModalOpen()) { exitBuildMode(); UI.closeAll(); } return; }
  if (UI.isModalOpen() && !isBuildMode()) return; // typing in a modal: ignore world keys

  switch (code) {
    case 'KeyE': interact(); break;
    case 'KeyB': {
      const pos = player.position;
      const t = tileFromWorld(pos.x, pos.z);
      const key = t ? parcelKey(currentFloor, t.ti, t.tj) : null;
      if (key && Economy.ownsParcel(key)) openBuild();
      else active.parcelsApi.tryBuyUnderPlayer(pos);
      break;
    }
    case 'KeyG': if (UI.isModalOpen()) exitBuildMode(); else openBuild(); break;
    case 'KeyF': if (isBuildMode()) active.parcelsApi.placeUnderPlayer(player.position); break;
    case 'KeyR':
      if (isBuildMode()) active.parcelsApi.rotateGhost();
      else active.parcelsApi.editNearest(player.position);
      break;
    case 'KeyX': active.parcelsApi.removeUnderPlayer(player.position); break;
    case 'KeyM': player.unlock(); UI.toggleMap(() => ({ economy: Economy, playerPos: player.position, floorIndex: currentFloor })); break;
    case 'KeyP': player.unlock(); openSkinShop(); break;   // P = personalize / skins
    case 'KeyT': player.unlock(); openShop('gift'); break; // T = sTore / gift shop
    default: break;
  }
});

// click canvas to (re)capture the mouse
renderer.domElement.addEventListener('click', () => {
  if (started && !player.isLocked && (!UI.isModalOpen() || isBuildMode())) player.lock();
});

// ---- HUD ----
let hudAcc = 0;
function updateHud(dt) {
  const pos = player.position;
  // contextual prompt
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
    loc += '<br><span style="font-size:11px;color:#8a85a8">G build · B buy · E use · M map · P skins · T shop · V view</span>';
    UI.setLocation(loc);
  }
}

// ---- main loop ----
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (!started || !active) { renderer.render(scenePlaceholder, camera); return; }
  if (player.isLocked) player.update(dt);
  try { active.stage.update(dt, { playerPos: player.position, camera, keys: player.keys }); } catch (e) {}
  try { active.npc.update(dt); } catch (e) {}
  updateHud(dt);
  renderer.render(active.stage.scene, camera);
}
const scenePlaceholder = new THREE.Scene();
animate();

// ---- resize ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- start / auth ----
function startGame() {
  if (started) return;
  started = true;
  const ss = document.getElementById('startScreen');
  const hud = document.getElementById('hud');
  if (ss) ss.classList.add('hidden');
  if (hud) hud.classList.remove('hidden');
  switchFloor(0);
}

const playBtn = document.getElementById('playBtn');
if (playBtn) playBtn.addEventListener('click', startGame);

// Render the login form / guest note into the start screen (non-blocking).
initAuth().catch(() => {});

// expose a few things for debugging / shop buttons in console
if (typeof window !== 'undefined') {
  window.DigitalCasinos = { Economy, casino, player, switchFloor, openShop, openDecorStore, openSkinShop };
}
