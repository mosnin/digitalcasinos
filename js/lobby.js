// =============================================================
// Digital Casinos — lobby.js
// A HUGE, opulent Caesars-Palace-scale hotel lobby — its own scene,
// reached at game start and via the elevator (DESTINATIONS 'lobby').
// Polished marble, towering fluted columns (instanced), chandeliers,
// grand archway hallway wings, a tiered central fountain, statues,
// lounge clusters, a bell desk, and a long reception desk with a
// concierge NPC. Warm, realistic resort art direction (no neon).
//
// Public:
//   createLobby({ economy }) -> { getStage(), onElevator }
//
// Conventions: feet at y=0, spawn at the grand entrance facing INTO
// the lobby (heading 0 faces -Z). Never throws; defensive fallback
// stage. Reuses cached aesthetics materials, instances repeated props,
// caps real PointLights, flags static meshes userData.animated=false.
// =============================================================
import * as THREE from 'three';
import { COLORS, box3FromRect } from './config.js';
import {
  material as aMaterial,
  makeChandelier,
  makeNeonSign,
  addInteriorLighting,
} from './aesthetics.js';
import { buildHumanoid } from './characters.js';
import { UI } from './ui.js';

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };

// Walkable lobby extent (Caesars-scale): X in [-70,70], Z in [-50,50].
const HALF_X = 70;
const HALF_Z = 50;
const WALL_H = 14;     // soaring ceiling height
const WALL_T = 1.2;    // perimeter wall thickness

// Rotating gameplay tips for the concierge.
const TIPS = [
  'Buy a parcel on any casino floor, then press B to build a money-making game on it.',
  'Press Y or step into any elevator to travel between the casino floors, hotel towers, the penthouse, the racing arena and the garden.',
  'Sit down at a machine and play it for real — reels really spin and cards are really dealt.',
  'Higher floors cost more to buy into, but the high rollers up top tip handsomely.',
  'Own a hotel room and restyle it — a Penthouse view is the ultimate flex.',
  'Visit the Botanical Garden or Derby Racing Arena when you need a break from the tables.',
  'Tune the payouts on games you own to balance house edge against player traffic.',
  'Check the world map (M) to see which parcels you own and where the action is.',
];

export function createLobby({ economy } = {}) {
  let stage = null;
  let tipIndex = 0;

  // The lobby object returned to callers; onElevator is settable.
  const lobby = {
    onElevator: null,
    getStage,
  };

  // --------------------------------------------------------------
  function openConcierge() {
    safe(() => {
      if (!UI || typeof UI.openModal !== 'function') return;

      const modal = document.createElement('div');
      modal.className = 'game-modal';

      const close = document.createElement('button');
      close.className = 'game-close btn-small btn-ghost';
      close.textContent = '✕';
      close.addEventListener('click', () => safe(() => UI.closeModal()));
      modal.appendChild(close);

      const h = document.createElement('h2');
      h.textContent = '🛎️ Concierge';
      modal.appendChild(h);

      const greet = document.createElement('div');
      greet.className = 'sub';
      greet.textContent = 'Welcome to the resort! How may I help you this evening?';
      greet.style.cssText = 'margin-bottom:10px;';
      modal.appendChild(greet);

      // a line where dynamic answers appear
      const answer = document.createElement('div');
      answer.style.cssText =
        'min-height:48px;margin:6px 0 12px;padding:10px 12px;border-radius:10px;' +
        'background:rgba(255,210,63,0.08);border:1px solid rgba(255,210,63,0.25);' +
        'color:#f3e9d2;line-height:1.4;font-size:14px;';
      answer.textContent = 'At your service.';
      modal.appendChild(answer);

      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:6px;';

      const mkBtn = (label, fn) => {
        const b = document.createElement('button');
        b.className = 'btn-small btn-ghost';
        b.style.cssText = 'width:100%;text-align:left;';
        b.textContent = label;
        b.addEventListener('click', () => safe(fn));
        wrap.appendChild(b);
        return b;
      };

      mkBtn('Where can I go?', () => {
        answer.textContent =
          'Everything connects through the elevators — press Y or step into one. ' +
          'You can reach all seven casino floors, the Sapphire & Ruby hotel towers, ' +
          'the Penthouse & rooftop pool, the Derby Racing Arena, and the Botanical Garden.';
      });

      mkBtn('Any tips?', () => {
        answer.textContent = '💡 ' + TIPS[tipIndex % TIPS.length];
        tipIndex++;
      });

      mkBtn('Welcome perk', () => {
        if (UI && typeof UI.toast === 'function') {
          UI.toast('🛎️ Welcome to the resort — enjoy your stay!', 'good');
        }
        answer.textContent = 'Compliments of the house — have a wonderful time!';
      });

      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-small';
      closeBtn.style.cssText = 'width:100%;margin-top:4px;';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => safe(() => UI.closeModal()));
      wrap.appendChild(closeBtn);

      modal.appendChild(wrap);
      UI.openModal(modal);
    });
  }

  // --------------------------------------------------------------
  function build() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2218); // warm interior backdrop

    const colliders = [];
    const triggers = [];
    const animated = [];   // { update(dt) } handlers

    // ---- cached themed materials (shared / reused) ----
    const marbleMat = aMaterial('marble');
    const wallMat = aMaterial('wall');
    const ceilMat = aMaterial('ceiling');
    const woodMat = aMaterial('wood');
    const brassMat = aMaterial('brass');
    const carpetMat = aMaterial('carpet', { carpet: 0x6e5a3c });

    // a couple of local materials (cached here, reused)
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xddd4c0, roughness: 0.85, metalness: 0.0 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: COLORS.gold, roughness: 0.34, metalness: 1.0,
      emissive: 0x3a2a00, emissiveIntensity: 0.12,
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: COLORS.water, roughness: 0.12, metalness: 0.3,
      transparent: true, opacity: 0.82,
    });
    const statueMat = new THREE.MeshStandardMaterial({
      color: 0xe9e2d2, roughness: 0.6, metalness: 0.05,
    });
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x6a1626, roughness: 0.8, metalness: 0.05 });
    const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, metalness: 0.0 });
    const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.95, metalness: 0.0 });
    const artFrameMat = goldMat;
    const artCanvasMat = new THREE.MeshStandardMaterial({ color: 0x3a2e44, roughness: 0.7, metalness: 0.05 });

    const staticTag = (mesh) => { mesh.userData.animated = false; return mesh; };

    // matrices reused for instancing
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _s = new THREE.Vector3(1, 1, 1);

    // ------------------------------------------------------------
    // FLOOR — polished marble + large inlaid medallion / border
    // ------------------------------------------------------------
    const floor = staticTag(new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), marbleMat));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    // inlaid border band (slightly raised brass rectangle)
    const makeBorderBand = (w, d, t) => {
      const g = new THREE.Object3D();
      const bars = [
        [0, -d / 2, w, t], [0, d / 2, w, t],
        [-w / 2, 0, t, d], [w / 2, 0, t, d],
      ];
      for (const [x, z, bw, bd] of bars) {
        const bar = staticTag(new THREE.Mesh(new THREE.BoxGeometry(bw, 0.04, bd), brassMat));
        bar.position.set(x, 0.02, z);
        g.add(bar);
      }
      return g;
    };
    scene.add(makeBorderBand(96, 70, 0.5));

    // central inlaid medallion (concentric brass + dark stone rings)
    const medallion = new THREE.Object3D();
    const mRings = [
      [9.5, brassMat], [9.0, statueMat], [6.5, brassMat], [6.0, artCanvasMat], [3.0, brassMat],
    ];
    for (const [r, mat] of mRings) {
      const ring = staticTag(new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012 + (10 - r) * 0.0006;
      medallion.add(ring);
    }
    // radial spokes
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spoke = staticTag(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 6.4), brassMat));
      spoke.position.set(Math.cos(a) * 6.4, 0.02, Math.sin(a) * 6.4);
      spoke.rotation.y = -a;
      medallion.add(spoke);
    }
    medallion.position.set(0, 0, -6);
    scene.add(medallion);

    // ------------------------------------------------------------
    // PERIMETER WALLS + wainscoting + crown molding (colliders)
    // ------------------------------------------------------------
    const addWall = (cx, cz, w, d) => {
      const wall = staticTag(new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat));
      wall.position.set(cx, WALL_H / 2, cz);
      scene.add(wall);
      colliders.push(box3FromRect(
        [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2], 0, WALL_H,
      ));
      // wainscoting (dark wood base band)
      const wain = staticTag(new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 1.6, d + 0.02), woodMat));
      wain.position.set(cx, 0.8, cz);
      scene.add(wain);
      // crown molding (brass band near the top)
      const crown = staticTag(new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.5, d + 0.06), brassMat));
      crown.position.set(cx, WALL_H - 0.6, cz);
      scene.add(crown);
    };
    addWall(0, -HALF_Z - WALL_T / 2 + WALL_T, HALF_X * 2 + WALL_T * 2, WALL_T);     // back  (-Z)
    addWall(0, HALF_Z + WALL_T / 2 - WALL_T, HALF_X * 2 + WALL_T * 2, WALL_T);      // front (+Z)
    addWall(-HALF_X - WALL_T / 2 + WALL_T, 0, WALL_T, HALF_Z * 2);                  // left  (-X)
    addWall(HALF_X + WALL_T / 2 - WALL_T, 0, WALL_T, HALF_Z * 2);                   // right (+X)

    // ------------------------------------------------------------
    // COFFERED / TRAY CEILING
    // ------------------------------------------------------------
    const ceil = staticTag(new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), ceilMat));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    scene.add(ceil);
    // a raised central tray
    const tray = staticTag(new THREE.Mesh(new THREE.PlaneGeometry(70, 40), ceilMat));
    tray.rotation.x = Math.PI / 2;
    tray.position.y = WALL_H + 1.4;
    scene.add(tray);
    // coffer grid (instanced thin beams) — purely visual, just under the ceiling
    const cofferBeamGeo = new THREE.BoxGeometry(0.4, 0.4, HALF_Z * 2);
    const cofferX = new THREE.InstancedMesh(cofferBeamGeo, brassMat, 13);
    for (let i = 0; i < 13; i++) {
      _p.set(-66 + i * 11, WALL_H - 0.25, 0); _q.identity(); _s.set(1, 1, 1);
      _m.compose(_p, _q, _s); cofferX.setMatrixAt(i, _m);
    }
    cofferX.instanceMatrix.needsUpdate = true;
    cofferX.userData.animated = false;
    scene.add(cofferX);
    const cofferBeamZ = new THREE.BoxGeometry(HALF_X * 2, 0.4, 0.4);
    const cofferZ = new THREE.InstancedMesh(cofferBeamZ, brassMat, 9);
    for (let i = 0; i < 9; i++) {
      _p.set(0, WALL_H - 0.25, -48 + i * 12); _q.identity(); _s.set(1, 1, 1);
      _m.compose(_p, _q, _s); cofferZ.setMatrixAt(i, _m);
    }
    cofferZ.instanceMatrix.needsUpdate = true;
    cofferZ.userData.animated = false;
    scene.add(cofferZ);

    // ------------------------------------------------------------
    // TOWERING FLUTED COLUMNS (instanced) framing the concourse
    // ------------------------------------------------------------
    const COL_H = WALL_H - 0.5;
    const colShaftGeo = new THREE.CylinderGeometry(1.0, 1.15, COL_H, 16);
    const colCapGeo = new THREE.CylinderGeometry(1.5, 1.05, 1.1, 16);
    const colBaseGeo = new THREE.CylinderGeometry(1.35, 1.5, 1.0, 16);

    // two rows down the concourse (left & right of center), plus rows along wings
    const colPositions = [];
    for (let i = 0; i < 6; i++) {
      const z = -42 + i * 17; // spread along Z
      colPositions.push([-26, z]);
      colPositions.push([26, z]);
    }
    // a couple flanking the reception at the back
    colPositions.push([-46, -38], [46, -38], [-46, 38], [46, 38]);

    const colCount = colPositions.length;
    const shafts = new THREE.InstancedMesh(colShaftGeo, stoneMat, colCount);
    const caps = new THREE.InstancedMesh(colCapGeo, goldMat, colCount);
    const bases = new THREE.InstancedMesh(colBaseGeo, goldMat, colCount);
    colPositions.forEach(([x, z], i) => {
      _q.identity(); _s.set(1, 1, 1);
      _p.set(x, COL_H / 2, z); _m.compose(_p, _q, _s); shafts.setMatrixAt(i, _m);
      _p.set(x, COL_H + 0.45, z); _m.compose(_p, _q, _s); caps.setMatrixAt(i, _m);
      _p.set(x, 0.5, z); _m.compose(_p, _q, _s); bases.setMatrixAt(i, _m);
      // column collider
      colliders.push(box3FromRect([x - 1.3, z - 1.3, x + 1.3, z + 1.3], 0, COL_H));
    });
    [shafts, caps, bases].forEach((m) => { m.instanceMatrix.needsUpdate = true; m.userData.animated = false; });
    scene.add(shafts, caps, bases);

    // ------------------------------------------------------------
    // CHANDELIERS down the central concourse
    // ------------------------------------------------------------
    const chandeliers = [];
    for (const cz of [-30, -6, 18, 40]) {
      const ch = safe(() => makeChandelier(), null);
      if (!ch) continue;
      ch.position.set(0, WALL_H - 2.4, cz);
      ch.scale.setScalar(2.0);
      scene.add(ch);
      chandeliers.push(ch);
    }
    animated.push({
      t: 0,
      update(dt) {
        this.t += dt;
        for (let i = 0; i < chandeliers.length; i++) {
          chandeliers[i].rotation.y = Math.sin(this.t * 0.12 + i) * 0.05;
        }
      },
    });

    // ------------------------------------------------------------
    // GRAND ARCHWAY HALLWAY WINGS (alcoves a few meters deep)
    // left (-X), right (+X), back (-Z). Carpet runner + columns +
    // framed art reading as resort wings.
    // ------------------------------------------------------------
    const runnerGeo = new THREE.PlaneGeometry(4, 14);
    const archMat = goldMat;
    const makeWing = (cx, cz, rotY, label) => {
      const g = new THREE.Object3D();
      g.position.set(cx, 0, cz);
      g.rotation.y = rotY;

      // alcove back wall (a few meters behind the arch)
      const back = staticTag(new THREE.Mesh(new THREE.BoxGeometry(14, WALL_H - 1, 0.6), wallMat));
      back.position.set(0, (WALL_H - 1) / 2, -6.5);
      g.add(back);

      // carpet runner leading in
      const runner = staticTag(new THREE.Mesh(runnerGeo, carpetMat));
      runner.rotation.x = -Math.PI / 2;
      runner.position.set(0, 0.02, -1);
      g.add(runner);

      // archway: two posts + a torus top
      const postGeo = new THREE.CylinderGeometry(0.5, 0.5, 9, 12);
      const pL = staticTag(new THREE.Mesh(postGeo, archMat)); pL.position.set(-5, 4.5, 0); g.add(pL);
      const pR = staticTag(new THREE.Mesh(postGeo, archMat)); pR.position.set(5, 4.5, 0); g.add(pR);
      const top = staticTag(new THREE.Mesh(new THREE.TorusGeometry(5, 0.5, 10, 24, Math.PI), archMat));
      top.position.set(0, 9, 0);
      g.add(top);

      // framed art on the alcove back wall (3 frames)
      for (let k = -1; k <= 1; k++) {
        const frame = staticTag(new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 0.18), artFrameMat));
        frame.position.set(k * 4, 5, -6.15);
        g.add(frame);
        const canvasArt = staticTag(new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.9), artCanvasMat));
        canvasArt.position.set(k * 4, 5, -6.04);
        g.add(canvasArt);
      }

      // small alcove columns
      const aShaft = new THREE.CylinderGeometry(0.6, 0.7, WALL_H - 2, 12);
      for (const ax of [-6, 6]) {
        const c = staticTag(new THREE.Mesh(aShaft, stoneMat));
        c.position.set(ax, (WALL_H - 2) / 2, -3);
        g.add(c);
      }

      // wing label sign over the arch
      const sign = safe(() => makeNeonSign(label, COLORS.gold, { size: 0.7 }), null);
      if (sign) { sign.position.set(0, 10.5, 0.2); g.add(sign); }

      scene.add(g);
    };
    // left & right wings against the side walls; back wing in a back corner
    makeWing(-HALF_X + 7, 0, Math.PI / 2, 'WEST WING');
    makeWing(HALF_X - 7, 0, -Math.PI / 2, 'EAST WING');
    makeWing(-34, -HALF_Z + 7, 0, 'THE GALLERIA');

    // ------------------------------------------------------------
    // TIERED CENTRAL FOUNTAIN (animated water shimmer)
    // ------------------------------------------------------------
    const fountain = new THREE.Object3D();
    fountain.position.set(0, 0, -6);
    const basin = staticTag(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.8, 0.9, 28), stoneMat));
    basin.position.y = 0.45; fountain.add(basin);
    const water1 = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.2, 28), waterMat);
    water1.position.y = 0.85; water1.userData.animated = true; fountain.add(water1);
    const pedestal = staticTag(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 2.0, 16), stoneMat));
    pedestal.position.y = 1.8; fountain.add(pedestal);
    const bowl2 = staticTag(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 0.9, 0.5, 20), stoneMat));
    bowl2.position.y = 2.9; fountain.add(bowl2);
    const water2 = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.16, 20), waterMat);
    water2.position.y = 3.1; water2.userData.animated = true; fountain.add(water2);
    const pedestal2 = staticTag(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 1.4, 12), stoneMat));
    pedestal2.position.y = 3.9; fountain.add(pedestal2);
    const finial = staticTag(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), goldMat));
    finial.position.y = 4.8; fountain.add(finial);
    scene.add(fountain);
    colliders.push(box3FromRect([-4.8, -6 - 4.8, 4.8, -6 + 4.8], 0, 1.2));
    animated.push({
      t: 0,
      update(dt) {
        this.t += dt;
        const s1 = 0.78 + 0.06 * Math.sin(this.t * 2.0);
        const s2 = 0.78 + 0.06 * Math.sin(this.t * 2.6 + 1.0);
        water1.material.opacity = s1;
        water1.position.y = 0.85 + 0.02 * Math.sin(this.t * 3.0);
        water2.material.opacity = s2;
        water2.position.y = 3.1 + 0.015 * Math.sin(this.t * 3.4);
      },
    });

    // ------------------------------------------------------------
    // STATUES on plinths (instanced plinths; statue bodies reused)
    // ------------------------------------------------------------
    const statueSpots = [
      [-16, 8], [16, 8], [-40, -20], [40, -20],
    ];
    const plinthGeo = new THREE.BoxGeometry(2.0, 2.2, 2.0);
    const statueBodyGeo = new THREE.CylinderGeometry(0.5, 0.7, 2.2, 12);
    const statueHeadGeo = new THREE.SphereGeometry(0.42, 14, 12);
    for (const [sx, sz] of statueSpots) {
      const plinth = staticTag(new THREE.Mesh(plinthGeo, stoneMat));
      plinth.position.set(sx, 1.1, sz);
      scene.add(plinth);
      const body = staticTag(new THREE.Mesh(statueBodyGeo, statueMat));
      body.position.set(sx, 3.3, sz);
      scene.add(body);
      const head = staticTag(new THREE.Mesh(statueHeadGeo, statueMat));
      head.position.set(sx, 4.6, sz);
      scene.add(head);
      colliders.push(box3FromRect([sx - 1.1, sz - 1.1, sx + 1.1, sz + 1.1], 0, 2.2));
    }

    // ------------------------------------------------------------
    // LOUNGE CLUSTERS (sofas + low tables + potted palms)
    // ------------------------------------------------------------
    const makePalm = (x, z) => {
      const g = new THREE.Object3D();
      g.position.set(x, 0, z);
      const pot = staticTag(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.7, 12), brassMat));
      pot.position.y = 0.35; g.add(pot);
      const trunk = staticTag(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 8), palmTrunkMat));
      trunk.position.y = 1.5; g.add(trunk);
      for (let k = 0; k < 6; k++) {
        const leaf = staticTag(new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 5), palmLeafMat));
        const a = (k / 6) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.5, 2.7, Math.sin(a) * 0.5);
        leaf.rotation.z = Math.cos(a) * 0.9;
        leaf.rotation.x = Math.sin(a) * 0.9;
        g.add(leaf);
      }
      scene.add(g);
    };

    const sofaSeatGeo = new THREE.BoxGeometry(2.6, 0.5, 1.0);
    const sofaBackGeo = new THREE.BoxGeometry(2.6, 0.8, 0.3);
    const tableGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 16);
    const makeSofa = (x, z, rotY) => {
      const g = new THREE.Object3D();
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      const seat = staticTag(new THREE.Mesh(sofaSeatGeo, sofaMat)); seat.position.set(0, 0.45, 0); g.add(seat);
      const back = staticTag(new THREE.Mesh(sofaBackGeo, sofaMat)); back.position.set(0, 0.85, -0.35); g.add(back);
      scene.add(g);
      colliders.push(new THREE.Box3().setFromObject(seat));
    };
    const loungeClusters = [
      { x: -42, z: 14 }, { x: 42, z: 14 }, { x: -50, z: -6 }, { x: 50, z: -6 },
    ];
    for (const c of loungeClusters) {
      makeSofa(c.x, c.z - 2, 0);
      makeSofa(c.x, c.z + 2, Math.PI);
      const table = staticTag(new THREE.Mesh(tableGeo, woodMat));
      table.position.set(c.x, 0.25, c.z);
      scene.add(table);
      makePalm(c.x - 4, c.z);
      makePalm(c.x + 4, c.z);
    }

    // ------------------------------------------------------------
    // BELL DESK with luggage carts (near the entrance)
    // ------------------------------------------------------------
    const bellDesk = staticTag(new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 1.6), woodMat));
    bellDesk.position.set(-50, 0.6, 36);
    scene.add(bellDesk);
    colliders.push(new THREE.Box3().setFromObject(bellDesk));
    // luggage carts (a couple)
    const makeCart = (x, z) => {
      const g = new THREE.Object3D();
      g.position.set(x, 0, z);
      const base = staticTag(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 2.0), brassMat));
      base.position.y = 0.3; g.add(base);
      const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8);
      for (const [ox, oz] of [[-0.6, -0.9], [0.6, -0.9], [-0.6, 0.9], [0.6, 0.9]]) {
        const pole = staticTag(new THREE.Mesh(poleGeo, brassMat));
        pole.position.set(ox, 1.2, oz); g.add(pole);
      }
      // a stacked suitcase
      const bag = staticTag(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.4), sofaMat));
      bag.position.set(0, 0.7, 0); g.add(bag);
      scene.add(g);
      colliders.push(box3FromRect([x - 0.8, z - 1.1, x + 0.8, z + 1.1], 0, 1.0));
    };
    makeCart(-45, 38);
    makeCart(-55, 38);

    // ------------------------------------------------------------
    // RECEPTION / FRONT DESK (marble + dark wood) at the back,
    // with a CONCIERGE humanoid standing behind it.
    // Desk faces +Z (toward the player walking in).
    // ------------------------------------------------------------
    const deskX = 16, deskZ = -40, deskW = 18, deskD = 2.2;
    const deskBody = staticTag(new THREE.Mesh(new THREE.BoxGeometry(deskW, 1.2, deskD), woodMat));
    deskBody.position.set(deskX, 0.6, deskZ);
    scene.add(deskBody);
    // marble countertop
    const deskTop = staticTag(new THREE.Mesh(new THREE.BoxGeometry(deskW + 0.6, 0.16, deskD + 0.6), marbleMat));
    deskTop.position.set(deskX, 1.28, deskZ);
    scene.add(deskTop);
    colliders.push(box3FromRect([deskX - deskW / 2, deskZ - deskD / 2, deskX + deskW / 2, deskZ + deskD / 2], 0, 1.4));
    // backing wall panel behind the desk with a sign
    const deskBack = staticTag(new THREE.Mesh(new THREE.BoxGeometry(deskW + 4, WALL_H - 2, 0.4), woodMat));
    deskBack.position.set(deskX, (WALL_H - 2) / 2, deskZ - 3.5);
    scene.add(deskBack);
    const recSign = safe(() => makeNeonSign('RECEPTION', COLORS.gold, { size: 0.8 }), null);
    if (recSign) { recSign.position.set(deskX, 6, deskZ - 3.25); scene.add(recSign); }

    // concierge NPC standing behind the desk, facing +Z (toward the player)
    const concierge = safe(() => buildHumanoid({
      suit: 0x3a2417, accent: COLORS.gold, skin: 0xe0ac69, scale: 1.05,
    }), null);
    if (concierge && concierge.root) {
      concierge.root.position.set(deskX, 0, deskZ - 1.4);
      concierge.root.rotation.y = 0; // faces +Z toward arriving guests
      scene.add(concierge.root);
      animated.push({ update(dt) { safe(() => concierge.update(dt, false)); } });
    }

    // trigger: speak to the concierge (in FRONT of the desk = +Z side)
    triggers.push({
      pos: new THREE.Vector3(deskX, 1.0, deskZ + deskD / 2 + 1.6),
      radius: 3,
      prompt: '[E] Speak to the concierge',
      action: () => openConcierge(),
    });

    // ------------------------------------------------------------
    // ELEVATOR ALCOVE + trigger + gilded "ELEVATOR" sign
    // Placed at the back-left, an alcove a few meters deep.
    // ------------------------------------------------------------
    const elevX = -16, elevZ = -42;
    // alcove cab walls
    const cabBack = staticTag(new THREE.Mesh(new THREE.BoxGeometry(8, WALL_H - 2, 0.4), woodMat));
    cabBack.position.set(elevX, (WALL_H - 2) / 2, elevZ - 2.5);
    scene.add(cabBack);
    const cabSideGeo = new THREE.BoxGeometry(0.4, WALL_H - 2, 5);
    const cabL = staticTag(new THREE.Mesh(cabSideGeo, woodMat)); cabL.position.set(elevX - 4, (WALL_H - 2) / 2, elevZ); scene.add(cabL);
    const cabR = staticTag(new THREE.Mesh(cabSideGeo, woodMat)); cabR.position.set(elevX + 4, (WALL_H - 2) / 2, elevZ); scene.add(cabR);
    // brass doors (closed look)
    const doorGeo = new THREE.BoxGeometry(3.4, 7, 0.2);
    const doorL = staticTag(new THREE.Mesh(doorGeo, brassMat)); doorL.position.set(elevX - 1.8, 3.5, elevZ - 0.2); scene.add(doorL);
    const doorR = staticTag(new THREE.Mesh(doorGeo, brassMat)); doorR.position.set(elevX + 1.8, 3.5, elevZ - 0.2); scene.add(doorR);
    // colliders for the alcove sides/back (keep the doorway open)
    colliders.push(box3FromRect([elevX - 4.2, elevZ - 2.7, elevX - 3.8, elevZ + 2.5], 0, WALL_H));
    colliders.push(box3FromRect([elevX + 3.8, elevZ - 2.7, elevX + 4.2, elevZ + 2.5], 0, WALL_H));
    // gilded ELEVATOR sign above the doors
    const elevSign = safe(() => makeNeonSign('ELEVATOR', COLORS.gold, { size: 0.7 }), null);
    if (elevSign) { elevSign.position.set(elevX, 8, elevZ - 0.1); scene.add(elevSign); }

    triggers.push({
      pos: new THREE.Vector3(elevX, 1.0, elevZ + 2),
      radius: 3.5,
      prompt: '[E] Elevator',
      action: () => { if (lobby.onElevator) safe(() => lobby.onElevator()); },
    });

    // ------------------------------------------------------------
    // LIGHTING — warm base via aesthetics + capped extra PointLights
    // ------------------------------------------------------------
    const lighting = safe(() => addInteriorLighting(scene, {
      theme: 'classic', carpet: 0x6e5a3c, accent: 0xffd23f,
    }), null);
    if (lighting && lighting.update) animated.push({ update(dt) { safe(() => lighting.update(dt)); } });

    // 2 extra warm downlights for the big space (kept low for perf)
    const extraLightSpots = [[0, -6], [0, 30]];
    for (const [lx, lz] of extraLightSpots) {
      const pl = new THREE.PointLight(0xffe7c2, 1.4, 80, 2.0);
      pl.position.set(lx, WALL_H - 2, lz);
      scene.add(pl);
    }

    // thin warm fog already set by addInteriorLighting; keep background warm.

    // ------------------------------------------------------------
    // SPAWN — grand entrance, facing INTO the lobby (heading 0 = -Z)
    // ------------------------------------------------------------
    const spawn = { x: 0, z: 40, heading: 0 };

    function sampleGround() { return 0; }

    function update(dt) {
      if (!(dt > 0)) dt = 0.016;
      for (const a of animated) safe(() => a.update(dt));
    }

    return {
      scene,
      id: 'lobby',
      floorIndex: 0,
      baseY: 0,
      spawn,
      sampleGround,
      colliders,
      triggers,
      update,
    };
  }

  // --------------------------------------------------------------
  function getStage() {
    if (!stage) stage = safe(() => build(), null);
    if (!stage) {
      // last-resort minimal stage so callers never crash
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a2218);
      safe(() => {
        const amb = new THREE.AmbientLight(0xffe8cc, 0.8);
        scene.add(amb);
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(140, 100),
          new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.4 }),
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
      });
      stage = {
        scene,
        id: 'lobby',
        floorIndex: 0,
        baseY: 0,
        spawn: { x: 0, z: 40, heading: 0 },
        sampleGround() { return 0; },
        colliders: [],
        triggers: [{
          pos: new THREE.Vector3(0, 1, 0),
          radius: 3.5,
          prompt: '[E] Elevator',
          action: () => { if (lobby.onElevator) safe(() => lobby.onElevator()); },
        }],
        update() {},
      };
    }
    return stage;
  }

  return lobby;
}
