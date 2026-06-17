// =============================================================
// Digital Casinos — main integrator (wave 1-4).
// A Las-Vegas-scale resort: casino floors, hotel towers with
// buyable/decoratable rooms, a penthouse, a racing arena and a
// garden — connected by a physical elevator. Online multiplayer
// (Supabase Realtime) shows other players + who owns what.
// Only the ACTIVE place is updated & rendered.
// =============================================================
import * as THREE from 'three';
import {
  FLOORS, DESTINATIONS, ROOM_STYLES, GAME_CATALOG, DECOR_CATALOG,
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
import { initAuth, signOut } from './auth.js';
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
// wave 3
import { createHotel } from './hotel.js';
import createRoom from './roominterior.js';
import { createElevator } from './elevator.js';
import { createArena } from './arena.js';
import { createGarden } from './garden.js';
import { createPerfGovernor, optimizeStage } from './perf.js';
import { installEnvironment } from './aesthetics.js';
// wave 4
import { createNet } from './net.js';
import { createRemotePlayers } from './remoteplayers.js';
import { createHoldings } from './holdings.js';
import { openProfile } from './profile.js';
import { Quests } from './quests.js';
import { openBank, applyDailyInterest } from './bank.js';
import { openPauseMenu } from './pausemenu.js';
import { Notify } from './notifications.js';
import { Music } from './music.js';
import { maybeShowTutorial } from './tutorial.js';

const sfx = (n) => { try { SFX.play(n); } catch (e) {} };
const qmark = (n, c) => { try { Quests.mark(n, c); } catch (e) {} };

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
const perf = createPerfGovernor(renderer, { min: 0.75 });
let lastPR = renderer.getPixelRatio();

const _euler = new THREE.Euler();
function camYaw() { _euler.setFromQuaternion(camera.quaternion, 'YXZ'); return _euler.y; }

// ---- systems ----
UI.init();
Minimap.init();
Notify.init();
Music.init();
const NPC_PER_FLOOR = 12;
let crowdOn = true;

const player = new Player({ camera, domElement: renderer.domElement });

const patrons = createPatrons({ economy: Economy, onEarn: (amt) => { sfx('coin'); if (amt >= 20) try { Notify.push(`A guest paid you ${amt} 🪙`, 'coin', '💰'); } catch (e) {} } });

// world builders
const casino = createCasino({ economy: Economy, openShop: (kind) => { player.unlock(); sfx('click'); openShop(kind); } });
const hotel = createHotel({ economy: Economy });
const arena = createArena({ economy: Economy });
const garden = createGarden({ economy: Economy });
const elevator = createElevator({ destinations: DESTINATIONS });

// multiplayer
const remote = createRemotePlayers();
remote.setCamera(camera);
const holdings = createHoldings();
let myId = null;
const net = createNet({ getProfile: () => ({ name: (Economy.state.profile && Economy.state.profile.name) || 'Player', skin: Economy.skin }) });

// ---- parcel hooks (casino floors) ----
const parcelHooks = {
  onPlay: (type, key, index, config) => { player.unlock(); sfx('click'); openGame(type, config); },
  onEdit: (type, key, index, config) => {
    player.unlock(); sfx('click');
    openGameEditor(type, config, (newCfg) => { Economy.updateGameConfig(key, index, newCfg); UI.toast('Game mechanics updated', 'good'); });
  },
  toast: (m, k) => { UI.toast(m, k); if (k === 'good') sfx('place'); else if (k === 'bad' || k === 'warn') sfx('error'); },
};

// =============================================================
// Place (stage) management — keyed by destination id or room:<id>
// =============================================================
const places = new Map();
let current = null;       // { stage, kind, destId, parcelsApi?, roomApi?, npc?, returnDest? }
let currentDestId = 'casino0';
let started = false;
let buildSel = null;      // { kind, id } selected in palette

function destByIndexKind(kind, index) {
  return DESTINATIONS.find(d => d.kind === kind && d.index === index) || DESTINATIONS[0];
}

function buildPlace(dest) {
  const cacheKey = dest.id;
  if (places.has(cacheKey)) return places.get(cacheKey);
  let stage = null, parcelsApi = null, npc = null;
  try {
    if (dest.kind === 'casino') {
      stage = casino.getFloor(dest.index);
      parcelsApi = attachParcels(stage, Economy, parcelHooks);
      npc = new NPCManager(stage.scene);
      if (crowdOn) { try { npc.spawnCrowd(NPC_PER_FLOOR, () => casino.randomWalkablePoint(dest.index)); } catch (e) {} }
    } else if (dest.kind === 'hotel') {
      stage = hotel.getFloor(dest.index);
    } else if (dest.kind === 'penthouse') {
      stage = hotel.getPenthouse();
    } else if (dest.kind === 'arena') {
      stage = arena.getStage();
      injectExitTrigger(stage);
    } else if (dest.kind === 'garden') {
      stage = garden.getStage();
      injectExitTrigger(stage);
    }
  } catch (e) { console.warn('buildPlace failed', dest, e); }
  if (!stage) return null;
  try { ensureFillLight(stage.scene); } catch (e) {}
  try { installEnvironment(renderer, stage.scene); } catch (e) {}
  try { optimizeStage(stage); } catch (e) {}
  const st = { stage, kind: dest.kind, destId: dest.id, parcelsApi, npc };
  places.set(cacheKey, st);
  return st;
}

// Some stages (e.g. arena) only ship localized/emissive lights, leaving the
// player area dark. Guarantee a soft ambient/hemisphere fill if none exists.
function ensureFillLight(scene) {
  if (!scene || !scene.traverse) return;
  let hasFill = false;
  scene.traverse((o) => { if (o && (o.isHemisphereLight || o.isAmbientLight)) hasFill = true; });
  if (hasFill) return;
  const hemi = new THREE.HemisphereLight(0xfff3e0, 0x202028, 0.9);
  const amb = new THREE.AmbientLight(0xffffff, 0.55);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(30, 80, 20);
  hemi.userData.animated = amb.userData.animated = dir.userData.animated = true;
  scene.add(hemi); scene.add(amb); scene.add(dir);
}

// give arena/garden (no elevator) a way back
function injectExitTrigger(stage) {
  if (!stage || !Array.isArray(stage.triggers)) return;
  if (stage.triggers.some(t => t && t._exit)) return;
  const sp = stage.spawn || { x: 0, z: 0 };
  stage.triggers.push({ _exit: true, pos: new THREE.Vector3(sp.x, 1, sp.z), radius: 5, prompt: 'Press E — Call the elevator', action: () => openElevator() });
}

function setActive(st, dest) {
  current = st;
  currentDestId = (dest && dest.id) || st.destId;
  player.setStage(st.stage);
  try { remote.setStage(st.stage.scene, currentDestId); } catch (e) {}
  try { if (st.kind === 'casino') patrons.setFloor(st.stage.scene, dest.index); else patrons.clear(); } catch (e) {}
  // minimap only meaningful on casino floors
  try {
    if (st.kind === 'casino') { Minimap.setFloor(dest.index); Minimap.setVisible(Settings.get('minimap') !== false); }
    else Minimap.setVisible(false);
  } catch (e) {}
  try { SFX.startAmbient(stageTheme(st, dest)); } catch (e) {}
  if (st.parcelsApi) try { st.parcelsApi.refresh(); } catch (e) {}
  player.lock();
}

function stageTheme(st, dest) {
  if (st.kind === 'casino') return (FLOORS[dest.index] && FLOORS[dest.index].theme) || 'classic';
  if (st.kind === 'garden') return 'pool';
  if (st.kind === 'arena') return 'classic';
  return 'highroller';
}

function goToDest(dest) {
  if (!dest) return;
  exitBuildMode();
  const st = buildPlace(dest);
  if (!st) { UI.toast('That area is unavailable.', 'bad'); return; }
  setActive(st, dest);
  if (dest.kind === 'garden') qmark('visit_garden');
  try { Notify.push(`Arrived: ${dest.name}`, 'info', dest.icon || '📍'); } catch (e) {}
}

// hotel room interior (not in the elevator directory; entered via doors)
function enterRoom(roomId, style, returnDest) {
  exitBuildMode();
  let built = null;
  try {
    const styleId = (Economy.getRoom(roomId) && Economy.getRoom(roomId).style) || style || 'standard';
    built = createRoom({ economy: Economy, roomId, styleId });
  } catch (e) { console.warn('enterRoom failed', e); }
  if (!built || !built.stage) { UI.toast('Could not open room.', 'bad'); return; }
  const st = { stage: built.stage, kind: 'room', destId: 'room:' + roomId, roomApi: built.api, returnDest, roomId };
  built.stage.onExit = () => { goToDest(returnDest); };
  try { installEnvironment(renderer, built.stage.scene); } catch (e) {}
  setActive(st, { id: 'room:' + roomId, kind: 'room' });
  try { Notify.push('Entered your room', 'info', '🛏️'); } catch (e) {}
}

// elevator directory + ride
function openElevator() {
  player.unlock(); sfx('elevator');
  elevator.openDirectory(currentDestId, (dest) => {
    if (!dest || dest.id === currentDestId) { player.lock(); return; }
    const fromName = (current && current.kind === 'room') ? 'Your Room' : (DESTINATIONS.find(d => d.id === currentDestId) || {}).name || '';
    elevator.playRide(fromName, dest.name, () => goToDest(dest));
  });
}

// hotel callbacks
hotel.onElevator = () => openElevator();
hotel.onEnterRoom = (roomId, hallId, style) => {
  const ret = DESTINATIONS.find(d => d.id === hallId) || DESTINATIONS.find(d => d.kind === 'hotel');
  enterRoom(roomId, style, ret);
};
hotel.onBuyRoom = (roomId, style, price) => {
  const res = Economy.buyRoom(roomId, style, price);
  if (res && res.ok) {
    sfx('buy'); UI.toast('Room purchased! Enter to decorate it.', 'good');
    try { Notify.push(`You bought room ${roomId}`, 'coin', '🛏️'); } catch (e) {}
    try { hotel.refresh(); } catch (e) {}
    holdings.sync(Economy);
  } else { sfx('error'); UI.toast((res && res.reason) || 'Cannot buy room', 'bad'); }
};
casino.onElevator = () => openElevator();

// ---- build palette ----
function casinoPaletteGroups() {
  return [
    { label: '🎲 Casino Games', items: Object.values(GAME_CATALOG).map(g => ({ id: g.id, name: g.name, icon: g.icon, cost: g.cost, kind: 'game' })) },
    { label: '✨ Decorations', items: Object.values(DECOR_CATALOG).map(d => ({ id: d.id, name: d.name, icon: d.icon, cost: d.cost, kind: 'decor' })) },
  ];
}
function roomDecorGroups() {
  return [{ label: '✨ Decorations', items: Object.values(DECOR_CATALOG).map(d => ({ id: d.id, name: d.name, icon: d.icon, cost: d.cost, kind: 'decor' })) }];
}
function roomStyleGroups() {
  return [{ label: '🎨 Room Style', items: Object.values(ROOM_STYLES).map(s => ({ id: s.id, name: s.name, icon: '🎨', cost: s.cost, kind: 'style' })) }];
}

function openBuild() {
  player.unlock(); sfx('click');
  if (current && current.kind === 'room' && current.roomApi) {
    UI.openBuildPalette(roomDecorGroups(), (item) => {
      buildSel = { kind: 'decor', id: item.id };
      current.roomApi.enterBuildMode(item.id);
      player.lock(); UI.toast(`Placing ${item.name} — [F] place`, 'good');
    }, () => { if (current.roomApi) current.roomApi.exitBuildMode(); buildSel = null; }, buildSel && buildSel.id);
    return;
  }
  if (!current || !current.parcelsApi) { UI.toast('You can only build on casino floors and in your rooms.', 'warn'); player.lock(); return; }
  UI.openBuildPalette(casinoPaletteGroups(), (item) => {
    buildSel = { kind: item.kind, id: item.id };
    current.parcelsApi.enterBuildMode({ kind: item.kind, type: item.id });
    player.lock(); UI.toast(`Placing ${item.name} — walk to a tile, [F] place`, 'good');
  }, () => { if (current.parcelsApi) current.parcelsApi.exitBuildMode(); buildSel = null; }, buildSel && buildSel.id);
}
function openRoomStyle() {
  if (!current || current.kind !== 'room' || !current.roomApi) return;
  player.unlock();
  UI.openBuildPalette(roomStyleGroups(), (item) => {
    const r = current.roomApi.setStyle(item.id, ROOM_STYLES[item.id].cost);
    if (r && r.ok === false) UI.toast(r.reason || 'Cannot restyle', 'bad'); else { UI.toast('Room restyled!', 'good'); sfx('buy'); }
    UI.closeBuildPalette(); player.lock();
  }, () => { player.lock(); }, null);
}
function exitBuildMode() {
  buildSel = null;
  if (current && current.parcelsApi) current.parcelsApi.exitBuildMode();
  if (current && current.roomApi) current.roomApi.exitBuildMode();
  UI.closeBuildPalette();
}
function isBuildMode() {
  return !!(current && ((current.parcelsApi && current.parcelsApi.isBuildMode()) || (current.roomApi && current.roomApi.isBuildMode())));
}

// ---- interaction ----
function nearestTrigger(pos) {
  const trigs = (current && current.stage && current.stage.triggers) || [];
  let best = null, bestD = Infinity;
  for (const t of trigs) {
    if (!t || !t.pos) continue;
    const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
    if (d < (t.radius || 2.5) && d < bestD) { bestD = d; best = t; }
  }
  return best;
}
function interact() {
  const pos = player.position;
  if (!isBuildMode() && current && current.parcelsApi && current.parcelsApi.playNearest(pos)) return;
  const t = nearestTrigger(pos);
  if (t && typeof t.action === 'function') { try { t.action(); } catch (e) {} }
}
function doBuyOrBuild() {
  const pos = player.position;
  if (current && current.kind === 'room') { openRoomStyle(); return; }      // B in a room → restyle
  if (!current || !current.parcelsApi) { return; }
  const t = tileFromWorld(pos.x, pos.z);
  const key = t ? parcelKey(current.parcelsApi && current.stage.floorIndex != null ? current.stage.floorIndex : 0, t.ti, t.tj) : null;
  if (key && Economy.ownsParcel(key)) openBuild();
  else { sfx('buy'); current.parcelsApi.tryBuyUnderPlayer(pos); if (key && Economy.ownsParcel(key)) { qmark('buy_parcel'); holdings.sync(Economy); try { Notify.push('Parcel purchased!', 'coin', '🟩'); } catch (e) {} } }
}
function placeNow() {
  if (!isBuildMode()) return;
  if (current.roomApi) { current.roomApi.placeUnderPlayer(player.position); return; }
  if (current.parcelsApi) {
    current.parcelsApi.placeUnderPlayer(player.position);
    if (buildSel && buildSel.kind === 'game') qmark('place_game');
    holdings.sync(Economy);
  }
}
function rotateOrEdit() {
  if (isBuildMode()) { sfx('click'); if (current.roomApi) current.roomApi.rotateGhost(); else if (current.parcelsApi) current.parcelsApi.rotateGhost(); return; }
  if (current && current.parcelsApi) current.parcelsApi.editNearest(player.position);
}
function removeNow() {
  sfx('remove');
  if (current && current.roomApi) current.roomApi.removeUnderPlayer(player.position);
  else if (current && current.parcelsApi) current.parcelsApi.removeUnderPlayer(player.position);
}

// ---- keys ----
document.addEventListener('keydown', (e) => {
  if (!started) return;
  const code = e.code;
  if (code === 'Escape') { if (UI.isModalOpen()) { exitBuildMode(); UI.closeAll(); } return; }
  if (code === 'Backquote') { player.unlock(); openPauseMenu(pauseActions); return; }
  if (UI.isModalOpen() && !isBuildMode()) return;

  switch (code) {
    case 'KeyE': interact(); break;
    case 'KeyB': doBuyOrBuild(); break;
    case 'KeyG': if (UI.isModalOpen()) exitBuildMode(); else openBuild(); break;
    case 'KeyF': placeNow(); break;
    case 'KeyR': rotateOrEdit(); break;
    case 'KeyX': removeNow(); break;
    case 'KeyY': openElevator(); break;                                   // travel anywhere
    case 'KeyM': player.unlock(); UI.toggleMap(() => ({ economy: Economy, playerPos: player.position, floorIndex: (current && current.kind === 'casino' && current.stage.floorIndex) || 0 })); break;
    case 'KeyK': player.unlock(); openGamesLobby(); break;
    case 'KeyL': player.unlock(); openLeaderboard({ economy: Economy }); break;
    case 'KeyJ': player.unlock(); Achievements.openPanel(); break;
    case 'KeyQ': player.unlock(); Quests.openPanel(); break;
    case 'KeyI': player.unlock(); openProfile({ economy: Economy }); break;
    case 'KeyN': player.unlock(); openBank({ economy: Economy }); break;
    case 'KeyP': player.unlock(); openSkinShop(); break;
    case 'KeyT': player.unlock(); openShop('gift'); break;
    case 'KeyO': player.unlock(); Settings.open(); break;
    case 'KeyH': player.unlock(); maybeShowTutorialForce(); break;
    case 'KeyZ': try { Music.toggle(); UI.toast(Music.isPlaying() ? 'Music on' : 'Music off'); } catch (e) {} break;
    case 'KeyC': player.unlock(); openDailyBonus({ economy: Economy, force: true }); break;
    default: break;
  }
});
renderer.domElement.addEventListener('click', () => {
  if (started && !player.isLocked && (!UI.isModalOpen() || isBuildMode())) { try { SFX.unlock(); } catch (e) {} try { Music.start(); } catch (e) {} player.lock(); }
});

function maybeShowTutorialForce() { try { window.localStorage.removeItem('dc_tutorial'); } catch (e) {} maybeShowTutorial(); }

// ---- settings ----
function applySettings(v) {
  if (!v) return;
  try { SFX.setVolume(v.volume); SFX.setMuted(v.volume <= 0); } catch (e) {}
  try { Music.setVolume(v.volume); } catch (e) {}
  try { postfx.setEnabled(!!v.bloom); } catch (e) {}
  try { camera.fov = v.fov || 72; camera.updateProjectionMatrix(); } catch (e) {}
  try { if (player.controls) player.controls.pointerSpeed = v.sensitivity || 1; } catch (e) {}
  try { Minimap.setVisible(!!v.minimap && current && current.kind === 'casino'); } catch (e) {}
  applyCrowd(v.crowd !== false);
}
function applyCrowd(on) {
  crowdOn = on;
  if (!current || !current.npc) return;
  try { current.npc.clear(); if (on && current.kind === 'casino') current.npc.spawnCrowd(NPC_PER_FLOOR, () => casino.randomWalkablePoint(current.stage.floorIndex || 0)); } catch (e) {}
}
Settings.init({ onChange: applySettings });

// pause menu actions
const pauseActions = {
  resume: () => player.lock(),
  settings: () => Settings.open(),
  profile: () => openProfile({ economy: Economy }),
  signOut: async () => { try { await signOut(); UI.toast('Signed out'); } catch (e) {} },
};

// touch controls (no-op on desktop)
initTouchControls({
  player,
  actions: { interact, buy: doBuyOrBuild, build: openBuild, place: placeNow, jump: () => { player.keys['Space'] = true; setTimeout(() => { player.keys['Space'] = false; }, 120); } },
});

// ---- HUD ----
let hudAcc = 0;
function updateHud(dt) {
  const pos = player.position;
  let prompt = '';
  if (isBuildMode()) {
    prompt = current && current.kind === 'room'
      ? '<b>[F]</b> place · <b>[R]</b> rotate · <b>[X]</b> remove · <b>[G]</b> done'
      : '<b>[F]</b> place · <b>[R]</b> rotate · <b>[X]</b> remove · <b>[G]</b> done';
  } else {
    if (current && current.parcelsApi) prompt = current.parcelsApi.getPrompt(pos) || '';
    else if (current && current.roomApi) prompt = current.roomApi.getPrompt(pos) || '';
    if (!prompt) { const t = nearestTrigger(pos); if (t) prompt = t.prompt; }
  }
  if (prompt) UI.showPrompt(prompt); else UI.hidePrompt();

  hudAcc += dt;
  if (hudAcc > 0.25) {
    hudAcc = 0;
    const dest = DESTINATIONS.find(d => d.id === currentDestId);
    let loc = `<b>${(current && current.kind === 'room') ? 'Your Hotel Room' : (dest ? dest.name : '')}</b>`;
    if (current && current.kind === 'casino' && current.stage.floorIndex != null) {
      const fi = current.stage.floorIndex;
      const t = tileFromWorld(pos.x, pos.z);
      if (t) {
        const key = parcelKey(fi, t.ti, t.tj);
        if (Economy.ownsParcel(key)) loc += '<br><span style="color:#3fff8c">● Your parcel</span>';
        else {
          const owner = holdings.ownerOf && holdings.ownerOf('parcel', key);
          if (owner && !owner.isMe) loc += `<br><span style="color:#ff8cc6">● Owned by ${owner.name}</span>`;
          else if (isBuildableTile(fi, t.ti, t.tj)) loc += `<br><span style="color:#ffd23f">○ For sale — ${Economy.parcelPrice(fi)} 🪙</span>`;
          else loc += '<br><span style="color:#8a85a8">Common area</span>';
        }
      }
    }
    const online = net.isOnline && net.isOnline();
    loc += `<br><span style="font-size:11px;color:#8a85a8">Y travel · G build · E use · K games · I profile · Q quests · \`pause${online ? ' · 🟢 online' : ''}</span>`;
    UI.setLocation(loc);
  }
}

// ---- main loop ----
let achAcc = 0, lbAcc = 0, netAcc = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (!started || !current) { postfx.render(scenePlaceholder, camera); return; }
  if (player.isLocked) player.update(dt);
  try { current.stage.update(dt, { playerPos: player.position, camera, keys: player.keys }); } catch (e) {}
  try { if (current.npc) current.npc.update(dt); } catch (e) {}
  try { patrons.update(dt); } catch (e) {}
  try { remote.update(dt); } catch (e) {}
  try { if (current.kind === 'casino') Minimap.update(player.position, camYaw()); } catch (e) {}

  // multiplayer: broadcast local position ~10Hz
  netAcc += dt;
  if (netAcc > 0.1) {
    netAcc = 0;
    const p = player.position;
    try { net.setLocal({ id: myId, name: (Economy.state.profile && Economy.state.profile.name) || 'Player', skin: Economy.skin, dest: currentDestId, x: p.x, z: p.z, yaw: camYaw() }); } catch (e) {}
  }

  achAcc += dt; if (achAcc > 1.5) { achAcc = 0; try { Achievements.evaluate(); } catch (e) {} try { Quests.evaluate(); } catch (e) {} }
  lbAcc += dt; if (lbAcc > 25) { lbAcc = 0; submitScore({ economy: Economy, name: (Economy.state.profile && Economy.state.profile.name) || 'Player' }).catch(() => {}); holdings.sync(Economy); }

  try { perf.update(dt); } catch (e) {}
  const pr = renderer.getPixelRatio();
  if (pr !== lastPR) { lastPR = pr; try { postfx.setSize(window.innerWidth, window.innerHeight); } catch (e) {} }

  updateHud(dt);
  postfx.render(current.stage.scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  try { postfx.setSize(window.innerWidth, window.innerHeight); } catch (e) {}
});

// ---- start / auth ----
Achievements.init({ economy: Economy, onUnlock: (a) => { UI.toast(`🏆 ${a.name || 'Achievement'}!`, 'good'); sfx('win'); try { Notify.push(`Achievement: ${a.name}`, 'win', '🏆'); } catch (e) {} } });
Quests.init({ economy: Economy, onReward: (q) => { UI.toast(`🎯 ${q.name} +${q.reward}🪙`, 'good'); try { Notify.push(`Quest complete: ${q.name}`, 'win', '🎯'); } catch (e) {} } });

function startGame() {
  if (started) return;
  started = true;
  const ss = document.getElementById('startScreen');
  const hud = document.getElementById('hud');
  if (ss) ss.classList.add('hidden');
  if (hud) hud.classList.remove('hidden');
  try { SFX.unlock(); } catch (e) {}
  try { Music.start(); } catch (e) {}
  try { applyDailyInterest({ economy: Economy }); } catch (e) {}

  goToDest(destByIndexKind('casino', 0));

  // connect multiplayer after entering the world
  net.connect().then((r) => {
    if (r && r.online) {
      myId = r.id;
      net.onUpdate((s) => { try { remote.apply(s); } catch (e) {} });
      net.onLeave((id) => { try { remote.remove(id); } catch (e) {} });
      holdings.refresh(); holdings.sync(Economy);
      try { Notify.push('Connected — you can see other players online', 'social', '🌐'); } catch (e) {}
    }
  }).catch(() => {});

  setTimeout(() => {
    try { if (maybeShowTutorial()) { player.unlock(); return; } } catch (e) {}
    try { if (maybeShowDailyBonus({ economy: Economy })) player.unlock(); } catch (e) {}
  }, 900);
}

const playBtn = document.getElementById('playBtn');
if (playBtn) playBtn.addEventListener('click', startGame);

initAuth().then(() => { holdings.refresh(); }).catch(() => {});

if (typeof window !== 'undefined') {
  window.DigitalCasinos = {
    Economy, casino, hotel, arena, garden, player, net, remote, holdings,
    goToDest, enterRoom, openElevator, DESTINATIONS,
    openShop, openDecorStore, openSkinShop, openGamesLobby, openProfile, openBank,
    Achievements, Quests, Settings, SFX, Music, Notify,
  };
}
