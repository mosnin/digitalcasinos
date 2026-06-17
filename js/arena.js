// =============================================================
// Digital Casinos — arena.js
// A horse-racing stadium attraction. Players walk a spectator
// concourse, find the betting kiosk, pick a horse + stake, and
// watch six stylized horses (with seated jockeys) tear around an
// oval dirt track. Self-contained: its own scene, never throws.
// =============================================================
import * as THREE from 'three';
import { COLORS, box3FromRect, clamp } from './config.js';
import { Economy } from './economy.js';
import { material, neonMaterial, makeNeonSign, makeWindowSkyline } from './aesthetics.js';
import { buildHumanoid } from './characters.js';
import { UI } from './ui.js';

const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

// ---- Oval track geometry (single source of truth for the race math) ----
// Parametric oval centered at origin on the XZ plane. We use a "racing line"
// radius for each horse lane and march t in [0,1) around the loop.
const TRACK = {
  RX: 46,   // outer-ish X radius of the racing line
  RZ: 30,   // Z radius
  LANE_GAP: 1.7,
  TRACK_W: 9, // dirt band width
};

// Point on the oval at parameter t (0..1) for a given lane offset (inward+).
function ovalPoint(t, laneInset) {
  const a = t * Math.PI * 2;
  const rx = TRACK.RX - laneInset;
  const rz = TRACK.RZ - laneInset;
  return { x: Math.cos(a) * rx, z: Math.sin(a) * rz };
}
// Heading (yaw) tangent to the oval at t (so horses face forward).
function ovalHeading(t, laneInset) {
  const p0 = ovalPoint(t, laneInset);
  const p1 = ovalPoint(t + 0.001, laneInset);
  return Math.atan2(p1.x - p0.x, p1.z - p0.z);
}

const HORSES = [
  { name: 'Neon Comet',    body: 0xff2db8, jacket: 0xffd23f },
  { name: 'Golden Bluff',  body: 0xc9a227, jacket: 0x18101f },
  { name: 'Midnight Ace',  body: 0x2b2d42, jacket: 0x18e0ff },
  { name: 'Lucky Seven',   body: 0x06d6a0, jacket: 0xff2db8 },
  { name: 'Crimson Dice',  body: 0xe63946, jacket: 0xffffff },
  { name: 'Sapphire Star', body: 0x3a6ea5, jacket: 0xffd23f },
];

export function createArena({ economy } = {}) {
  const econ = economy || Economy;
  let stage = null;

  // ---- race state (shared between betting modal + stage.update) ----
  const race = {
    running: false,
    finished: false,
    t: 0,                // elapsed seconds
    duration: 5.2,
    horses: [],          // [{ progress, speed, laneInset, finishedAt }]
    winnerIdx: -1,
    order: [],           // finishing order of horse indices
    bet: null,           // { idx, stake, odds }
    onSettle: null,      // callback when race resolves
  };

  // Odds: derived so the implied probabilities sum > 1 (house edge).
  // Lower index horses are slightly favored to make it feel curated.
  function makeOdds() {
    const base = [2.4, 3.2, 4.0, 5.0, 6.5, 8.0];
    // light shuffle of the tail so it isn't always identical
    return base.map((o, i) => {
      const jitter = i === 0 ? 0 : (Math.random() - 0.5) * 0.6;
      return Math.max(1.6, Math.round((o + jitter) * 10) / 10);
    });
  }

  // ---------------------------------------------------------------
  // Build one stylized horse + seated jockey. Returns { root, legs, update }.
  // Body is elongated along +Z (forward), so root.rotation.y aims it.
  // ---------------------------------------------------------------
  function buildHorse(def) {
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: def.body, roughness: 0.6, metalness: 0.05 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x16110d, roughness: 0.7, metalness: 0.05 });
    const maneMat = new THREE.MeshStandardMaterial({ color: 0x140d08, roughness: 0.9, metalness: 0.0 });

    const standY = 1.0; // belly height pivot

    // elongated barrel
    const barrel = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.5, 6, 10), bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, standY, 0);
    root.add(barrel);

    // neck + head leaning forward
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 8), bodyMat);
    neck.position.set(0, standY + 0.5, 1.0);
    neck.rotation.x = 0.7;
    root.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.62), bodyMat);
    head.position.set(0, standY + 0.85, 1.45);
    head.rotation.x = 0.35;
    root.add(head);

    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.8), maneMat);
    mane.position.set(0, standY + 0.62, 0.95);
    mane.rotation.x = 0.7;
    root.add(mane);

    // tail
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6), maneMat);
    tail.position.set(0, standY + 0.1, -1.05);
    tail.rotation.x = -0.6;
    root.add(tail);

    // four legs (pivot groups so they can swing)
    const legs = [];
    const legGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.95, 6);
    const legSpots = [
      { x: 0.32, z: 0.75 }, { x: -0.32, z: 0.75 },
      { x: 0.32, z: -0.75 }, { x: -0.32, z: -0.75 },
    ];
    for (const s of legSpots) {
      const pivot = new THREE.Group();
      pivot.position.set(s.x, standY - 0.1, s.z);
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.y = -0.45;
      pivot.add(leg);
      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22), hoofMat);
      hoof.position.y = -0.92;
      pivot.add(hoof);
      root.add(pivot);
      legs.push({ pivot, phase: s.z > 0 ? 0 : Math.PI });
    }

    // saddle pad
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.8), neonMaterial(def.jacket, 0.4));
    saddle.position.set(0, standY + 0.5, -0.1);
    root.add(saddle);

    // jockey: a seated humanoid, scaled small, sitting on the saddle
    let jockey = null;
    safe(() => {
      jockey = buildHumanoid({ suit: def.jacket, accent: 0xffffff, skin: 0xe0ac69, scale: 0.78 });
      jockey.setPose('sit');
      jockey.root.position.set(0, standY + 0.95, -0.1);
      root.add(jockey.root);
    });

    function update(dt, gallop) {
      const speed = gallop ? 16 : 2.2;
      for (const l of legs) {
        l.phase += dt * speed;
        l.pivot.rotation.x = Math.sin(l.phase) * (gallop ? 0.7 : 0.12);
      }
      if (jockey && jockey.update) safe(() => jockey.update(dt, false));
    }

    return { root, update, dispose: () => { safe(() => jockey && jockey.dispose && jockey.dispose()); } };
  }

  // ---------------------------------------------------------------
  // Build the full stage lazily.
  // ---------------------------------------------------------------
  function build() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1020);
    scene.fog = new THREE.FogExp2(0x0a1428, 0.0025);

    const colliders = [];
    const triggers = [];

    // ---- lighting (daytime-ish stadium glow under night sky) ----
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a2a18, 0.9);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(0xfff0dd, 0.45);
    scene.add(amb);
    const sun = new THREE.DirectionalLight(0xfff4e2, 0.9);
    sun.position.set(30, 80, 20);
    scene.add(sun);

    // ---- ground plane (concourse base) ----
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.95, metalness: 0.0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 200), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    // ---- green infield ----
    const infieldMat = new THREE.MeshStandardMaterial({ color: 0x1f6b2e, roughness: 0.95, metalness: 0.0 });
    const infieldR = Math.max(2, TRACK.RX - TRACK.TRACK_W - 1);
    const infieldRz = Math.max(2, TRACK.RZ - TRACK.TRACK_W - 1);
    const infield = new THREE.Mesh(new THREE.CircleGeometry(1, 64), infieldMat);
    infield.scale.set(infieldR, infieldRz, 1);
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = 0.01;
    scene.add(infield);

    // ---- dirt track (ring built from a flat annulus) ----
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 1.0, metalness: 0.0 });
    const ringGeo = new THREE.RingGeometry(1, 1, 80);
    // RingGeometry is in XY; we'll make our own oval annulus via a shape instead.
    const trackShape = new THREE.Shape();
    const outerRx = TRACK.RX + 2, outerRz = TRACK.RZ + 2;
    const innerRx = TRACK.RX - TRACK.TRACK_W, innerRz = TRACK.RZ - TRACK.TRACK_W;
    for (let i = 0; i <= 80; i++) {
      const a = (i / 80) * Math.PI * 2;
      const x = Math.cos(a) * outerRx, y = Math.sin(a) * outerRz;
      if (i === 0) trackShape.moveTo(x, y); else trackShape.lineTo(x, y);
    }
    const hole = new THREE.Path();
    for (let i = 0; i <= 80; i++) {
      const a = (i / 80) * Math.PI * 2;
      const x = Math.cos(a) * innerRx, y = Math.sin(a) * innerRz;
      if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
    }
    trackShape.holes.push(hole);
    const trackGeo = new THREE.ShapeGeometry(trackShape, 4);
    const track = new THREE.Mesh(trackGeo, dirtMat);
    track.rotation.x = -Math.PI / 2;
    track.position.y = 0.005;
    scene.add(track);
    ringGeo.dispose();

    // ---- white rail (segmented posts + rail bars, instanced) ----
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, metalness: 0.05 });
    safe(() => {
      const segs = 64;
      const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6);
      const posts = new THREE.InstancedMesh(postGeo, railMat, segs * 2);
      const m = new THREE.Matrix4();
      let idx = 0;
      for (const which of ['inner', 'outer']) {
        const ix = which === 'inner' ? innerRx + 0.2 : outerRx - 0.2;
        const iz = which === 'inner' ? innerRz + 0.2 : outerRz - 0.2;
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          m.makeTranslation(Math.cos(a) * ix, 0.5, Math.sin(a) * iz);
          posts.setMatrixAt(idx++, m);
        }
      }
      posts.instanceMatrix.needsUpdate = true;
      scene.add(posts);
    });

    // ---- start gate (boxy stalls near t=0 of the racing line) ----
    const gateGroup = new THREE.Group();
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x2a3a55, roughness: 0.7, metalness: 0.2 });
    const startT = 0.0;
    for (let i = 0; i < 7; i++) {
      const inset = i * TRACK.LANE_GAP;
      const p = ovalPoint(startT, inset);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.2), gateMat);
      post.position.set(p.x, 1.2, p.z);
      gateGroup.add(post);
    }
    const gateBanner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, TRACK.LANE_GAP * 6.2), neonMaterial(0xffd23f, 0.6));
    const gp = ovalPoint(startT, TRACK.LANE_GAP * 3);
    gateBanner.position.set(gp.x, 2.6, gp.z);
    gateGroup.add(gateBanner);
    scene.add(gateGroup);

    // ---- finish line (checkered band across the track at t≈0.5) ----
    safe(() => {
      const finT = 0.5;
      const finMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
      const finP = ovalPoint(finT, TRACK.LANE_GAP * 3);
      const finHeading = ovalHeading(finT, TRACK.LANE_GAP * 3);
      const fin = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.TRACK_W, 1.2), finMat);
      fin.rotation.x = -Math.PI / 2;
      fin.rotation.z = -finHeading;
      fin.position.set(finP.x, 0.02, finP.z);
      scene.add(fin);
      const finishSign = makeNeonSign('FINISH', 0xff2db8, { size: 1.0 });
      finishSign.position.set(finP.x, 5.5, finP.z + 4);
      finishSign.rotation.y = Math.PI;
      scene.add(finishSign);
    });

    // ---- grandstand: tiered seats via InstancedMesh (capped) ----
    safe(() => {
      const rows = 14;
      const seatsPerRow = 90;
      const total = rows * seatsPerRow; // 1260, well under a few thousand
      const seatGeo = new THREE.BoxGeometry(0.7, 0.5, 0.7);
      const seatMat = new THREE.MeshStandardMaterial({ color: 0x33415c, roughness: 0.8, metalness: 0.1 });
      const seats = new THREE.InstancedMesh(seatGeo, seatMat, total);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3(1, 1, 1);
      const colorVar = new THREE.Color();
      const standBaseRx = TRACK.RX + 6, standBaseRz = TRACK.RZ + 6;
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        const tier = r * 0.7;          // rise
        const outRx = standBaseRx + r * 0.9;
        const outRz = standBaseRz + r * 0.9;
        // only build the grandstand on the "front straight" arc (facing concourse, +Z side)
        for (let s = 0; s < seatsPerRow; s++) {
          const frac = s / seatsPerRow;
          // span roughly the +Z half of the oval (concourse side)
          const a = Math.PI * 0.15 + frac * Math.PI * 0.7;
          const x = Math.cos(a) * outRx;
          const z = Math.sin(a) * outRz;
          pos.set(x, 0.6 + tier, z);
          // face seats toward track center
          const yaw = Math.atan2(-x, -z);
          q.setFromEuler(new THREE.Euler(0, yaw, 0));
          m.compose(pos, q, scl);
          seats.setMatrixAt(idx, m);
          colorVar.setHex(0x33415c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
          if (seats.setColorAt) seats.setColorAt(idx, colorVar);
          idx++;
        }
      }
      seats.count = idx;
      seats.instanceMatrix.needsUpdate = true;
      if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
      scene.add(seats);

      // stand structure shell behind the seats
      const shellMat = new THREE.MeshStandardMaterial({ color: 0x141824, roughness: 0.9 });
      const shell = new THREE.Mesh(new THREE.TorusGeometry((standBaseRx + standBaseRz) / 2 + 12, 3, 8, 48, Math.PI * 0.8), shellMat);
      shell.rotation.x = Math.PI / 2;
      shell.rotation.z = Math.PI * 0.6;
      shell.position.set(0, 9, 0);
      shell.scale.set(1, 1, 1.0);
      scene.add(shell);
    });

    // ---- stadium light towers (emissive lamp heads) ----
    safe(() => {
      const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.8, metalness: 0.3 });
      const lampMat = neonMaterial(0xfff6d8, 1.8);
      const spots = [
        { x: -TRACK.RX - 14, z: -TRACK.RZ - 10 },
        { x: TRACK.RX + 14, z: -TRACK.RZ - 10 },
        { x: -TRACK.RX - 14, z: TRACK.RZ + 14 },
        { x: TRACK.RX + 14, z: TRACK.RZ + 14 },
      ];
      for (const s of spots) {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 22, 8), towerMat);
        tower.position.set(s.x, 11, s.z);
        scene.add(tower);
        const head = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.6), lampMat);
        head.position.set(s.x, 22, s.z);
        head.lookAt(0, 0, 0);
        scene.add(head);
        const pl = new THREE.PointLight(0xfff2d0, 1.2, 120, 1.6);
        pl.position.set(s.x, 22, s.z);
        scene.add(pl);
      }
    });

    // ---- jumbotron (big emissive screen, flickers in update) ----
    let jumboMat = null;
    safe(() => {
      jumboMat = new THREE.MeshStandardMaterial({
        color: 0x05202a,
        emissive: 0x18e0ff,
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.2,
      });
      const screen = new THREE.Mesh(new THREE.BoxGeometry(20, 11, 0.6), jumboMat);
      screen.position.set(0, 14, -TRACK.RZ - 4);
      scene.add(screen);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(21, 12, 0.4), new THREE.MeshStandardMaterial({ color: 0x111319, roughness: 0.8 }));
      frame.position.set(0, 14, -TRACK.RZ - 4.3);
      scene.add(frame);
      // support legs
      const legMat = new THREE.MeshStandardMaterial({ color: 0x22242c, roughness: 0.8 });
      for (const lx of [-7, 7]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 16, 8), legMat);
        leg.position.set(lx, 8, -TRACK.RZ - 4.3);
        scene.add(leg);
      }
      const title = makeNeonSign('DERBY', 0xffd23f, { size: 1.4 });
      title.position.set(0, 21, -TRACK.RZ - 3.6);
      scene.add(title);
    });

    // ---- sky / skyline backdrop ring ----
    safe(() => {
      const positions = [
        { z: -TRACK.RZ - 60, ry: 0 },
        { z: TRACK.RZ + 60, ry: Math.PI },
      ];
      for (const p of positions) {
        const sky = makeWindowSkyline();
        sky.scale.set(1.6, 1.4, 1);
        sky.position.set(0, 16, p.z);
        sky.rotation.y = p.ry;
        scene.add(sky);
      }
      const skyL = makeWindowSkyline();
      skyL.scale.set(1.2, 1.4, 1);
      skyL.position.set(-TRACK.RX - 60, 16, 0);
      skyL.rotation.y = Math.PI / 2;
      scene.add(skyL);
      const skyR = makeWindowSkyline();
      skyR.scale.set(1.2, 1.4, 1);
      skyR.position.set(TRACK.RX + 60, 16, 0);
      skyR.rotation.y = -Math.PI / 2;
      scene.add(skyR);
    });

    // ---- the 6 horses at the gate ----
    race.horses.length = 0;
    const horseObjs = [];
    for (let i = 0; i < HORSES.length; i++) {
      const inset = (i + 0.5) * TRACK.LANE_GAP; // lane inward from outer line
      const h = safe(() => buildHorse(HORSES[i]), null);
      if (!h) continue;
      const p = ovalPoint(0.0, inset);
      h.root.position.set(p.x, 0, p.z);
      h.root.rotation.y = ovalHeading(0.0, inset);
      scene.add(h.root);
      horseObjs.push(h);
      race.horses.push({ progress: 0, speed: 1, laneInset: inset, finishedAt: -1, obj: h });
    }

    // ---- spectator concourse: a flat walkable apron on the +Z side ----
    // Outer perimeter walls act as colliders; concourse stays open.
    // We place colliders well outside the racing area so the player can't
    // walk onto the track, but can roam the concourse near the kiosk.
    const wallY0 = 0, wallY1 = 4;
    const concourseZ = TRACK.RZ + 8; // where the player spawns & kiosk lives
    safe(() => {
      // back wall behind concourse
      colliders.push(box3FromRect([-70, concourseZ + 14, 70, concourseZ + 16], wallY0, wallY1));
      // side walls
      colliders.push(box3FromRect([-72, -70, -70, 70], wallY0, wallY1));
      colliders.push(box3FromRect([70, -70, 72, 70], wallY0, wallY1));
      // inner rail barrier: a ring of box colliders around the outer track edge
      const segs = 20;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const cx = Math.cos(a) * (outerRx + 2.5);
        const cz = Math.sin(a) * (outerRz + 2.5);
        colliders.push(box3FromRect([cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2], wallY0, wallY1));
      }
    });

    // visible low fence around the track (so the rail collider reads visually)
    safe(() => {
      const fenceMat = new THREE.MeshStandardMaterial({ color: 0x3a4256, roughness: 0.8 });
      const fence = new THREE.Mesh(
        new THREE.TorusGeometry((outerRx + outerRz) / 2 + 2.5, 0.25, 6, 64),
        fenceMat
      );
      fence.rotation.x = Math.PI / 2;
      fence.scale.set(outerRx / ((outerRx + outerRz) / 2), outerRz / ((outerRx + outerRz) / 2), 1);
      fence.position.y = 1.0;
      scene.add(fence);
    });

    // ---- betting kiosk (a lit booth on the concourse) ----
    const kioskPos = new THREE.Vector3(0, 0, concourseZ + 5);
    safe(() => {
      const kioskGroup = new THREE.Group();
      const boothMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.7, metalness: 0.2 });
      const booth = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 2.2), boothMat);
      booth.position.y = 1.3;
      kioskGroup.add(booth);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.3, 0.6), material('brass'));
      counter.position.set(0, 1.3, -1.2);
      kioskGroup.add(counter);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 2.6), neonMaterial(0xff2db8, 0.5));
      roof.position.y = 2.75;
      kioskGroup.add(roof);
      const sign = makeNeonSign('BETS', 0x18e0ff, { size: 0.7 });
      sign.position.set(0, 3.4, 0);
      kioskGroup.add(sign);
      kioskGroup.position.copy(kioskPos);
      kioskGroup.rotation.y = Math.PI; // face the track
      scene.add(kioskGroup);
      colliders.push(box3FromRect(
        [kioskPos.x - 1.9, kioskPos.z - 1.2, kioskPos.x + 1.9, kioskPos.z + 1.2],
        wallY0, wallY1
      ));
    });

    triggers.push({
      pos: new THREE.Vector3(kioskPos.x, 0, kioskPos.z - 2.6),
      radius: 3,
      prompt: '[E] Bet on the next race',
      action: openRaceBetting,
    });

    // ---- assembled Stage object ----
    const built = {
      scene,
      id: 'arena',
      baseY: 0,
      spawn: { x: 0, z: concourseZ + 9, heading: 0 }, // heading 0 faces -Z, toward the track
      sampleGround() { return 0; },
      colliders,
      triggers,
      update(dt) { stageUpdate(dt, horseObjs, jumboMat); },
      _horseObjs: horseObjs,
      _jumboMat: jumboMat,
    };
    return built;
  }

  // ---------------------------------------------------------------
  // Per-frame update: idle bobbing, jumbotron flicker, race drive.
  // ---------------------------------------------------------------
  let jumboT = 0;
  function stageUpdate(dt, horseObjs, jumboMat) {
    if (!(dt > 0)) dt = 0.016;
    jumboT += dt;

    // jumbotron flicker
    if (jumboMat) {
      jumboMat.emissiveIntensity = 0.75 + 0.25 * Math.abs(Math.sin(jumboT * 2.3))
        + (Math.random() < 0.04 ? 0.4 : 0);
    }

    if (race.running) {
      driveRace(dt);
    }

    // animate horse legs + idle bob
    for (let i = 0; i < horseObjs.length; i++) {
      const obj = horseObjs[i];
      const st = race.horses[i];
      if (!obj || !st) continue;
      const gallop = race.running && st.finishedAt < 0;
      safe(() => obj.update(dt, gallop));
      if (!race.running) {
        // gentle idle bob at the gate
        obj.root.position.y = Math.sin(jumboT * 1.5 + i) * 0.03;
      }
    }
  }

  function driveRace(dt) {
    race.t += dt;
    let allDone = true;
    for (let i = 0; i < race.horses.length; i++) {
      const st = race.horses[i];
      if (!st) continue;
      if (st.finishedAt < 0) {
        // advance progress; speed has a steady part + per-frame jitter
        const jitter = 0.85 + Math.random() * 0.4;
        st.progress += st.speed * dt * jitter;
        if (st.progress >= 1) {
          st.progress = 1;
          st.finishedAt = race.t;
          race.order.push(i);
        } else {
          allDone = false;
        }
      }
      // position the horse along the oval (one full lap from gate t=0)
      const obj = st.obj;
      if (obj) {
        const t = (st.progress) % 1;
        const p = ovalPoint(t, st.laneInset);
        obj.root.position.set(p.x, 0, p.z);
        obj.root.rotation.y = ovalHeading(t, st.laneInset);
      }
    }

    if (allDone || race.t >= race.duration + 2.5) {
      // make sure any unfinished horses get appended to order by progress
      finishRace();
    }
  }

  function finishRace() {
    if (race.finished) return;
    race.finished = true;
    race.running = false;
    // build full finishing order: those already finished (by finishedAt),
    // then remaining by progress descending.
    const remaining = [];
    for (let i = 0; i < race.horses.length; i++) {
      if (race.order.indexOf(i) === -1) remaining.push(i);
    }
    remaining.sort((a, b) => race.horses[b].progress - race.horses[a].progress);
    const order = race.order.concat(remaining);
    race.order = order;
    race.winnerIdx = order.length ? order[0] : 0;
    if (typeof race.onSettle === 'function') safe(() => race.onSettle());
  }

  // Choose a winner with weights inverse to odds (favorites win more).
  function pickWeightedWinner(odds) {
    const weights = odds.map((o) => 1 / Math.max(1.1, o));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  // Assign per-horse speeds so the pre-chosen winner tends to arrive first.
  function assignSpeeds(winnerIdx) {
    const base = 1 / race.duration; // progress per second to finish ~one lap
    for (let i = 0; i < race.horses.length; i++) {
      const st = race.horses[i];
      if (!st) continue;
      st.progress = 0;
      st.finishedAt = -1;
      // baseline with random spread
      let mult = 0.92 + Math.random() * 0.16;
      if (i === winnerIdx) mult += 0.12; // edge for the chosen winner (not guaranteed)
      st.speed = base * mult;
    }
    race.order = [];
    race.winnerIdx = -1;
  }

  // ---------------------------------------------------------------
  // Betting modal
  // ---------------------------------------------------------------
  function openRaceBetting() {
    return safe(() => {
      if (race.running) { UI.toast('A race is already underway! 🏇', 'warn'); return; }

      const odds = makeOdds();
      let chosen = 0;

      const modal = document.createElement('div');
      modal.className = 'game-modal arena-derby';

      const close = document.createElement('button');
      close.className = 'game-close btn-small btn-ghost';
      close.textContent = '✕';
      close.addEventListener('click', () => UI.closeModal());
      modal.appendChild(close);

      const h = document.createElement('h2');
      h.textContent = '🏇 Derby';
      modal.appendChild(h);
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'Pick your horse, place your stake, and watch them run.';
      modal.appendChild(sub);

      // ---- horse list ----
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:10px 0;';
      const rows = [];
      HORSES.forEach((horse, i) => {
        const row = document.createElement('button');
        row.className = 'btn-small' + (i === chosen ? '' : ' btn-ghost');
        row.style.cssText = 'width:100%;display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;';
        const swatch = '<span style="display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:8px;vertical-align:middle;background:#'
          + (horse.body & 0xffffff).toString(16).padStart(6, '0') + ';"></span>';
        const lbl = document.createElement('span');
        lbl.innerHTML = swatch + '<b>' + (i + 1) + '.</b> ' + horse.name;
        const od = document.createElement('span');
        od.textContent = odds[i].toFixed(1) + 'x';
        od.style.cssText = 'color:var(--gold);font-weight:800;';
        row.appendChild(lbl);
        row.appendChild(od);
        row.addEventListener('click', () => {
          chosen = i;
          rows.forEach((rr, j) => {
            rr.className = 'btn-small' + (j === i ? '' : ' btn-ghost');
          });
        });
        rows.push(row);
        list.appendChild(row);
      });
      modal.appendChild(list);

      // ---- stake input ----
      const stakeWrap = document.createElement('div');
      stakeWrap.style.cssText = 'display:flex;align-items:center;gap:10px;margin:8px 0;';
      const stakeLbl = document.createElement('label');
      stakeLbl.textContent = 'Stake 🪙';
      stakeLbl.style.cssText = 'font-weight:700;';
      const stakeInput = document.createElement('input');
      stakeInput.type = 'number';
      stakeInput.min = '1';
      stakeInput.step = '1';
      stakeInput.value = '25';
      stakeInput.style.cssText = 'flex:1;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;font-size:15px;';
      stakeWrap.appendChild(stakeLbl);
      stakeWrap.appendChild(stakeInput);
      modal.appendChild(stakeWrap);

      const balLine = document.createElement('div');
      balLine.className = 'sub';
      balLine.textContent = 'Balance: ' + Math.round(econ.coins).toLocaleString('en-US') + ' 🪙';
      modal.appendChild(balLine);

      // ---- action row ----
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;margin-top:12px;';
      const raceBtn = document.createElement('button');
      raceBtn.className = 'btn-small';
      raceBtn.textContent = 'Race! 🏁';
      raceBtn.style.flex = '1';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-small btn-ghost';
      cancelBtn.textContent = 'Close';
      cancelBtn.addEventListener('click', () => UI.closeModal());
      actions.appendChild(raceBtn);
      actions.appendChild(cancelBtn);
      modal.appendChild(actions);

      raceBtn.addEventListener('click', () => {
        safe(() => {
          let stake = Math.floor(Number(stakeInput.value));
          if (!isFinite(stake) || stake < 1) stake = 1;
          stake = Math.max(1, stake);
          if (!econ.canAfford(stake)) {
            UI.toast('Not enough coins for that stake.', 'bad');
            return;
          }
          startRace({ idx: chosen, stake, odds: odds[chosen] }, odds, modal);
        });
      });

      UI.openModal(modal);
    });
  }

  // Begin the race: deduct stake, lock inputs, swap modal to a live view.
  function startRace(bet, odds, modal) {
    // deduct the stake up-front via spend
    const ok = econ.spend(bet.stake);
    if (!ok) { UI.toast('Not enough coins.', 'bad'); return; }

    race.bet = bet;
    race.finished = false;
    race.running = true;
    race.t = 0;
    const preWinner = pickWeightedWinner(odds);
    assignSpeeds(preWinner);

    // swap modal body to a "racing" status view
    safe(() => {
      modal.innerHTML = '';
      const h = document.createElement('h2');
      h.textContent = '🏇 And they\'re off!';
      modal.appendChild(h);
      const status = document.createElement('div');
      status.className = 'sub';
      status.textContent = 'Your pick: ' + HORSES[bet.idx].name + ' @ ' + bet.odds.toFixed(1) + 'x for ' + bet.stake + ' 🪙';
      modal.appendChild(status);
      const live = document.createElement('div');
      live.style.cssText = 'margin-top:10px;font-size:14px;color:#cfe;min-height:20px;';
      live.textContent = 'Watch the track…';
      modal.appendChild(live);
      // tick the live readout from a timer (independent of render loop, defensive)
      const startedAt = Date.now();
      const ticker = setInterval(() => {
        if (race.finished || !race.running) {
          clearInterval(ticker);
          showResults(modal);
          return;
        }
        const el = (Date.now() - startedAt) / 1000;
        live.textContent = 'Racing… ' + el.toFixed(1) + 's';
      }, 150);
      race._ticker = ticker;
    });

    race.onSettle = () => settle(modal);
  }

  // Settle the wager once the race resolves.
  function settle(modal) {
    safe(() => {
      const bet = race.bet;
      if (!bet) return;
      const won = race.winnerIdx === bet.idx;
      if (won) {
        const payout = Math.round(bet.stake * bet.odds);
        econ.add(payout);
        UI.toast('🏆 ' + HORSES[bet.idx].name + ' wins! +' + payout + ' 🪙', 'good');
      } else {
        UI.toast('😞 ' + HORSES[race.winnerIdx].name + ' took it. -' + bet.stake + ' 🪙', 'bad');
      }
    });
    // results panel is rendered by the ticker when it sees race.finished
  }

  function showResults(modal) {
    safe(() => {
      if (!modal) return;
      const bet = race.bet || { idx: 0, stake: 0, odds: 1 };
      const won = race.winnerIdx === bet.idx;
      modal.innerHTML = '';

      const h = document.createElement('h2');
      h.textContent = won ? '🏆 Winner!' : '🏁 Photo Finish';
      modal.appendChild(h);

      const outcome = document.createElement('div');
      outcome.className = 'sub';
      if (won) {
        const payout = Math.round(bet.stake * bet.odds);
        outcome.innerHTML = '<b style="color:#2ec27e">' + HORSES[bet.idx].name
          + '</b> came home! You won <b style="color:var(--gold)">' + payout + ' 🪙</b>.';
      } else {
        outcome.innerHTML = '<b style="color:#e63946">' + HORSES[race.winnerIdx].name
          + '</b> won. You lost <b>' + bet.stake + ' 🪙</b>.';
      }
      modal.appendChild(outcome);

      // finishing order
      const orderTitle = document.createElement('div');
      orderTitle.style.cssText = 'margin-top:10px;font-weight:800;color:var(--neon2);letter-spacing:1px;';
      orderTitle.textContent = 'FINISHING ORDER';
      modal.appendChild(orderTitle);

      const ol = document.createElement('div');
      ol.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px;';
      race.order.forEach((horseIdx, place) => {
        const r = document.createElement('div');
        const medal = place === 0 ? '🥇' : place === 1 ? '🥈' : place === 2 ? '🥉' : (place + 1) + '.';
        const mine = horseIdx === bet.idx ? ' style="color:var(--gold);font-weight:800;"' : '';
        r.innerHTML = '<span' + mine + '>' + medal + ' ' + (HORSES[horseIdx] ? HORSES[horseIdx].name : 'Horse ' + horseIdx) + '</span>';
        ol.appendChild(r);
      });
      modal.appendChild(ol);

      const bal = document.createElement('div');
      bal.className = 'sub';
      bal.style.marginTop = '10px';
      bal.textContent = 'Balance: ' + Math.round(econ.coins).toLocaleString('en-US') + ' 🪙';
      modal.appendChild(bal);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:10px;margin-top:12px;';
      const again = document.createElement('button');
      again.className = 'btn-small';
      again.textContent = 'Bet Again';
      again.style.flex = '1';
      again.addEventListener('click', () => { resetRace(); openRaceBetting(); });
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-small btn-ghost';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => { resetRace(); UI.closeModal(); });
      actions.appendChild(again);
      actions.appendChild(closeBtn);
      modal.appendChild(actions);
    });
  }

  // Reset horses back to the gate for the next race.
  function resetRace() {
    safe(() => { if (race._ticker) { clearInterval(race._ticker); race._ticker = null; } });
    race.running = false;
    race.finished = false;
    race.t = 0;
    race.bet = null;
    race.onSettle = null;
    race.order = [];
    race.winnerIdx = -1;
    for (let i = 0; i < race.horses.length; i++) {
      const st = race.horses[i];
      if (!st) continue;
      st.progress = 0;
      st.finishedAt = -1;
      const inset = st.laneInset;
      if (st.obj) {
        const p = ovalPoint(0.0, inset);
        st.obj.root.position.set(p.x, 0, p.z);
        st.obj.root.rotation.y = ovalHeading(0.0, inset);
      }
    }
  }

  // ---------------------------------------------------------------
  function getStage() {
    if (!stage) stage = safe(() => build(), null);
    if (!stage) {
      // last-resort minimal stage so callers never crash
      stage = {
        scene: new THREE.Scene(),
        id: 'arena', baseY: 0,
        spawn: { x: 0, z: 0, heading: 0 },
        sampleGround() { return 0; },
        colliders: [], triggers: [],
        update() {},
      };
    }
    return stage;
  }

  return { getStage };
}
