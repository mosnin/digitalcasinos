// =============================================================
// Digital Casinos — garden.js
// A serene botanical garden attraction (its own daytime scene).
// Reached via the elevator (DESTINATIONS 'garden'). Pure visual /
// ambient — never throws, reuses geometry/materials, uses
// InstancedMesh for the hundreds of trees/shrubs/flowers.
// =============================================================
import * as THREE from 'three';
import { COLORS } from './config.js';
import { UI } from './ui.js';

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };

// Walkable garden extent (~80 x 60). X in [-40,40], Z in [-30,30].
const HALF_X = 40;
const HALF_Z = 30;
const WALL_H = 2.2;     // perimeter hedge height
const WALL_T = 1.6;     // perimeter hedge thickness

export function createGarden({ economy } = {}) {
  let stage = null;

  // --------------------------------------------------------------
  function build() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd4ff); // bright sky blue

    const colliders = [];
    const triggers = [];
    const animated = [];     // { update(dt) } handlers

    // ---- shared geometries (reused everywhere) ----
    const GEO = {
      trunk: new THREE.CylinderGeometry(0.28, 0.38, 2.4, 6),
      canopy: new THREE.IcosahedronGeometry(1.6, 1),
      shrub: new THREE.IcosahedronGeometry(0.7, 1),
      flower: new THREE.ConeGeometry(0.18, 0.5, 5),
      petal: new THREE.IcosahedronGeometry(0.16, 0),
    };

    // ---- shared materials ----
    const MAT = {
      grass: new THREE.MeshStandardMaterial({ color: 0x5a9e3f, roughness: 0.95, metalness: 0.0 }),
      stone: new THREE.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.9, metalness: 0.0 }),
      hedge: new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1.0, metalness: 0.0 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, metalness: 0.0 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x3d8b3a, roughness: 0.9, metalness: 0.0 }),
      leaf2: new THREE.MeshStandardMaterial({ color: 0x4fae4a, roughness: 0.9, metalness: 0.0 }),
      bloom: new THREE.MeshStandardMaterial({ color: 0xff5fa2, roughness: 0.8, metalness: 0.0, emissive: 0x3a0020, emissiveIntensity: 0.15 }),
      bench: new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.7, metalness: 0.1 }),
      brass: new THREE.MeshStandardMaterial({ color: COLORS.brass, roughness: 0.35, metalness: 0.9 }),
      water: new THREE.MeshStandardMaterial({
        color: 0x3fb8d9, roughness: 0.1, metalness: 0.35,
        transparent: true, opacity: 0.82,
      }),
      pondWater: new THREE.MeshStandardMaterial({
        color: 0x2f86b0, roughness: 0.12, metalness: 0.3,
        transparent: true, opacity: 0.85,
      }),
      lantern: new THREE.MeshStandardMaterial({
        color: 0xfff0c0, emissive: 0xffe08a, emissiveIntensity: 0.9, roughness: 0.5,
      }),
      koi: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, metalness: 0.0 }),
    };

    // ---- ground (grass) ----
    const groundGeo = new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2);
    const ground = new THREE.Mesh(groundGeo, MAT.grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // ---- winding stone path strips (flat slabs slightly above grass) ----
    const pathDef = [
      // [centerX, centerZ, width, depth, rotY]
      [0, -22, 6, 14, 0],
      [0, -8, 6, 16, 0],
      [0, 8, 6, 16, 0],
      [-14, 0, 18, 5, 0.18],
      [14, 0, 18, 5, -0.18],
      [-22, 12, 5, 16, 0.5],
      [22, 12, 5, 16, -0.5],
    ];
    for (const [px, pz, pw, pd, rot] of pathDef) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.12, pd), MAT.stone);
      slab.position.set(px, 0.06, pz);
      slab.rotation.y = rot;
      scene.add(slab);
    }

    // ---- perimeter hedges (colliders, bound the area) ----
    const addHedge = (cx, cz, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), MAT.hedge);
      m.position.set(cx, WALL_H / 2, cz);
      scene.add(m);
      colliders.push(new THREE.Box3().setFromObject(m));
    };
    addHedge(0, -HALF_Z + WALL_T / 2, HALF_X * 2, WALL_T);          // back
    addHedge(0, HALF_Z - WALL_T / 2, HALF_X * 2, WALL_T);            // front
    addHedge(-HALF_X + WALL_T / 2, 0, WALL_T, HALF_Z * 2);          // left
    addHedge(HALF_X - WALL_T / 2, 0, WALL_T, HALF_Z * 2);           // right

    // gentle interior border hedges framing the central area
    addHedge(-26, -6, 0.9, 22);
    addHedge(26, -6, 0.9, 22);

    // ---- helper: scatter spots avoiding the central path corridor & fountain ----
    const onPath = (x, z) => (Math.abs(x) < 4.5 && z < 6 && z > -30) ||
      (Math.abs(z) < 3.5 && Math.abs(x) < 24);
    const nearFountain = (x, z) => (x * x + z * z) < 8 * 8;
    const inBounds = (x, z) =>
      x > -HALF_X + 3 && x < HALF_X - 3 && z > -HALF_Z + 3 && z < HALF_Z - 3;

    const rand = (() => { let s = 1337; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();

    function scatter(count, place) {
      let made = 0, tries = 0;
      while (made < count && tries < count * 12) {
        tries++;
        const x = (rand() * 2 - 1) * (HALF_X - 3);
        const z = (rand() * 2 - 1) * (HALF_Z - 3);
        if (!inBounds(x, z) || onPath(x, z) || nearFountain(x, z)) continue;
        place(x, z, made);
        made++;
      }
      return made;
    }

    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _s = new THREE.Vector3();

    // ---- MANY trees: instanced trunks + instanced canopies ----
    const TREE_N = 90;
    const treePts = [];
    scatter(TREE_N, (x, z) => treePts.push([x, z]));
    const trunks = new THREE.InstancedMesh(GEO.trunk, MAT.trunk, treePts.length);
    const canopies = new THREE.InstancedMesh(GEO.canopy, MAT.leaf, treePts.length);
    const canopies2 = new THREE.InstancedMesh(GEO.canopy, MAT.leaf2, treePts.length);
    // store sway base info for canopies
    const canopySway = [];
    treePts.forEach(([x, z], i) => {
      const sc = 0.8 + rand() * 0.9;
      const rotY = rand() * Math.PI * 2;
      // trunk
      _p.set(x, 1.2 * sc, z); _e.set(0, rotY, 0); _q.setFromEuler(_e); _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s); trunks.setMatrixAt(i, _m);
      // canopy (two overlapping clumps for fullness)
      const cy = 2.4 * sc + 0.6;
      _p.set(x, cy, z); _s.set(sc * 1.1, sc, sc * 1.1);
      _m.compose(_p, _q, _s); canopies.setMatrixAt(i, _m);
      _p.set(x + 0.5 * sc, cy + 0.5 * sc, z - 0.4 * sc); _s.set(sc * 0.8, sc * 0.8, sc * 0.8);
      _m.compose(_p, _q, _s); canopies2.setMatrixAt(i, _m);
      canopySway.push({ x, baseY: cy, z, sc, phase: rand() * Math.PI * 2 });
      // each tree trunk is a small collider so the player can't walk through
      colliders.push(new THREE.Box3(
        new THREE.Vector3(x - 0.4 * sc, 0, z - 0.4 * sc),
        new THREE.Vector3(x + 0.4 * sc, 2.4, z + 0.4 * sc),
      ));
    });
    [trunks, canopies, canopies2].forEach(m => { m.instanceMatrix.needsUpdate = true; m.userData.animated = true; });
    scene.add(trunks, canopies, canopies2);

    // gentle sway: nudge canopy instances vertically/laterally
    animated.push({
      t: 0,
      update(dt) {
        this.t += dt;
        for (let i = 0; i < canopySway.length; i++) {
          const c = canopySway[i];
          const sway = Math.sin(this.t * 0.8 + c.phase) * 0.12 * c.sc;
          _p.set(c.x + sway, c.baseY + Math.sin(this.t * 0.6 + c.phase) * 0.05, c.z);
          _e.set(0, 0, sway * 0.05); _q.setFromEuler(_e); _s.set(c.sc * 1.1, c.sc, c.sc * 1.1);
          _m.compose(_p, _q, _s); canopies.setMatrixAt(i, _m);
        }
        canopies.instanceMatrix.needsUpdate = true;
      },
    });

    // ---- MANY flowering shrubs (instanced) ----
    const SHRUB_N = 140;
    const shrubPts = [];
    scatter(SHRUB_N, (x, z) => shrubPts.push([x, z]));
    const shrubs = new THREE.InstancedMesh(GEO.shrub, MAT.leaf2, shrubPts.length);
    const blooms = new THREE.InstancedMesh(GEO.petal, MAT.bloom, shrubPts.length);
    shrubPts.forEach(([x, z], i) => {
      const sc = 0.6 + rand() * 0.8;
      _p.set(x, 0.5 * sc, z); _e.set(0, rand() * Math.PI, 0); _q.setFromEuler(_e); _s.set(sc, sc * 0.8, sc);
      _m.compose(_p, _q, _s); shrubs.setMatrixAt(i, _m);
      _p.set(x, 0.9 * sc, z); _s.set(sc * 0.9, sc * 0.9, sc * 0.9);
      _m.compose(_p, _q, _s); blooms.setMatrixAt(i, _m);
    });
    [shrubs, blooms].forEach(m => { m.instanceMatrix.needsUpdate = true; });
    scene.add(shrubs, blooms);

    // ---- flower beds: dense instanced flower cones in clustered rings ----
    const FLOWER_N = 360;
    const bedCenters = [[-30, -18], [30, -18], [-30, 20], [30, 20], [0, 24], [-18, -24], [18, -24]];
    const flowers = new THREE.InstancedMesh(GEO.flower, MAT.bloom, FLOWER_N);
    // color variety via per-instance color
    const palette = [0xff5fa2, 0xffd23f, 0xff7a3c, 0xb05cff, 0xffffff, 0xff3d6e];
    const _col = new THREE.Color();
    let fi = 0;
    for (const [bx, bz] of bedCenters) {
      const perBed = Math.floor(FLOWER_N / bedCenters.length);
      for (let k = 0; k < perBed && fi < FLOWER_N; k++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * 3.2;
        const x = bx + Math.cos(a) * r;
        const z = bz + Math.sin(a) * r;
        const sc = 0.6 + rand() * 0.7;
        _p.set(x, 0.25 * sc, z); _e.set(0, rand() * Math.PI, 0); _q.setFromEuler(_e); _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s); flowers.setMatrixAt(fi, _m);
        flowers.setColorAt(fi, _col.set(palette[Math.floor(rand() * palette.length)]));
        fi++;
      }
    }
    flowers.count = fi;
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    scene.add(flowers);

    // ---- central animated fountain ----
    const fountain = new THREE.Object3D();
    fountain.position.set(0, 0, 0);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 0.8, 24), MAT.stone);
    basin.position.y = 0.4;
    fountain.add(basin);
    const fWater = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.2, 24), MAT.water);
    fWater.position.y = 0.75;
    fountain.add(fWater);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 12), MAT.stone);
    pillar.position.y = 1.6;
    fountain.add(pillar);
    const topBowl = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.6, 0.5, 16), MAT.stone);
    topBowl.position.y = 2.8;
    fountain.add(topBowl);
    // jet particles (Points)
    const JET_N = 120;
    const jetPos = new Float32Array(JET_N * 3);
    const jetVel = new Float32Array(JET_N * 3);
    const jetLife = new Float32Array(JET_N);
    for (let i = 0; i < JET_N; i++) { jetLife[i] = rand(); }
    const jetGeo = new THREE.BufferGeometry();
    jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPos, 3));
    const jetMat = new THREE.PointsMaterial({ color: 0xcdeeff, size: 0.18, transparent: true, opacity: 0.85, depthWrite: false });
    const jet = new THREE.Points(jetGeo, jetMat);
    jet.position.set(0, 3.0, 0);
    jet.userData.animated = true;
    fountain.add(jet);
    fountain.userData.animated = true;
    scene.add(fountain);
    // fountain collider
    colliders.push(new THREE.Box3(new THREE.Vector3(-4.4, 0, -4.4), new THREE.Vector3(4.4, 1.2, 4.4)));

    animated.push({
      update(dt) {
        for (let i = 0; i < JET_N; i++) {
          jetLife[i] += dt * 0.9;
          if (jetLife[i] >= 1) {
            jetLife[i] -= 1;
            const a = rand() * Math.PI * 2;
            jetPos[i * 3] = 0; jetPos[i * 3 + 1] = 0; jetPos[i * 3 + 2] = 0;
            jetVel[i * 3] = Math.cos(a) * 0.6;
            jetVel[i * 3 + 1] = 2.4 + rand() * 1.2;
            jetVel[i * 3 + 2] = Math.sin(a) * 0.6;
          }
          jetVel[i * 3 + 1] -= dt * 4.5;
          jetPos[i * 3] += jetVel[i * 3] * dt;
          jetPos[i * 3 + 1] += jetVel[i * 3 + 1] * dt;
          jetPos[i * 3 + 2] += jetVel[i * 3 + 2] * dt;
        }
        jetGeo.attributes.position.needsUpdate = true;
        fWater.material.opacity = 0.78 + 0.06 * Math.sin(performance.now() * 0.003);
      },
    });

    // ---- koi pond (water plane) ----
    const pond = new THREE.Object3D();
    pond.position.set(-24, 0, 14);
    const pondRim = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.5, 28), MAT.stone);
    pondRim.position.y = 0.25;
    pond.add(pondRim);
    const pondSurf = new THREE.Mesh(new THREE.CircleGeometry(4.7, 28), MAT.pondWater);
    pondSurf.rotation.x = -Math.PI / 2;
    pondSurf.position.y = 0.42;
    pond.add(pondSurf);
    // a few koi swimming
    const koiList = [];
    for (let i = 0; i < 5; i++) {
      const koi = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), MAT.koi);
      koi.scale.set(1, 0.4, 0.5);
      pond.add(koi);
      koiList.push({ mesh: koi, r: 1.2 + i * 0.6, a: rand() * Math.PI * 2, spd: 0.5 + rand() * 0.4 });
    }
    pond.userData.animated = true;
    scene.add(pond);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(pond.position.x - 5.4, 0, pond.position.z - 5.4),
      new THREE.Vector3(pond.position.x + 5.4, 0.7, pond.position.z + 5.4),
    ));
    animated.push({
      update(dt) {
        for (const k of koiList) {
          k.a += dt * k.spd;
          k.mesh.position.set(Math.cos(k.a) * k.r, 0.45, Math.sin(k.a) * k.r);
          k.mesh.rotation.y = -k.a + Math.PI / 2;
        }
      },
    });

    // ---- benches (scattered) with rest interactions ----
    const benchSpots = [
      { x: 8, z: 6, rot: Math.PI },
      { x: -8, z: 6, rot: Math.PI },
      { x: 14, z: -14, rot: -0.4 },
      { x: -14, z: -14, rot: 0.4 },
      { x: -24, z: 20, rot: 0 },
    ];
    const benchSeatGeo = new THREE.BoxGeometry(2.4, 0.2, 0.7);
    const benchBackGeo = new THREE.BoxGeometry(2.4, 0.8, 0.15);
    const benchLegGeo = new THREE.BoxGeometry(0.15, 0.6, 0.6);
    for (const b of benchSpots) {
      const g = new THREE.Object3D();
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.rot;
      const seat = new THREE.Mesh(benchSeatGeo, MAT.bench); seat.position.y = 0.6; g.add(seat);
      const back = new THREE.Mesh(benchBackGeo, MAT.bench); back.position.set(0, 1.0, -0.3); g.add(back);
      const l1 = new THREE.Mesh(benchLegGeo, MAT.bench); l1.position.set(-1.0, 0.3, 0); g.add(l1);
      const l2 = new THREE.Mesh(benchLegGeo, MAT.bench); l2.position.set(1.0, 0.3, 0); g.add(l2);
      scene.add(g);
      colliders.push(new THREE.Box3().setFromObject(seat));
      triggers.push({
        pos: new THREE.Vector3(b.x, 0.6, b.z),
        radius: 2,
        prompt: '[E] Rest a moment',
        action: () => { if (UI && UI.toast) UI.toast('A peaceful break 🌸', 'good'); },
      });
    }

    // ---- decorative arches over the main path ----
    const archMat = MAT.brass;
    const makeArch = (z) => {
      const g = new THREE.Object3D();
      g.position.set(0, 0, z);
      const post = new THREE.CylinderGeometry(0.22, 0.22, 3.4, 10);
      const pL = new THREE.Mesh(post, archMat); pL.position.set(-3, 1.7, 0); g.add(pL);
      const pR = new THREE.Mesh(post, archMat); pR.position.set(3, 1.7, 0); g.add(pR);
      const top = new THREE.Mesh(new THREE.TorusGeometry(3, 0.22, 8, 20, Math.PI), archMat);
      top.position.set(0, 3.4, 0);
      g.add(top);
      scene.add(g);
    };
    makeArch(-16);
    makeArch(2);

    // ---- decorative lanterns (with subtle light) ----
    const lanternSpots = [[-6, -10], [6, -10], [-6, 2], [6, 2], [-22, 8], [22, 8]];
    const lanternPostGeo = new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8);
    const lanternHeadGeo = new THREE.IcosahedronGeometry(0.4, 0);
    for (const [lx, lz] of lanternSpots) {
      const g = new THREE.Object3D();
      g.position.set(lx, 0, lz);
      const post = new THREE.Mesh(lanternPostGeo, MAT.brass); post.position.y = 1.3; g.add(post);
      const head = new THREE.Mesh(lanternHeadGeo, MAT.lantern); head.position.y = 2.7; g.add(head);
      scene.add(g);
    }

    // ---- butterfly drifting particles (Points) ----
    const BFLY_N = 40;
    const bPos = new Float32Array(BFLY_N * 3);
    const bData = [];
    for (let i = 0; i < BFLY_N; i++) {
      const x = (rand() * 2 - 1) * (HALF_X - 5);
      const z = (rand() * 2 - 1) * (HALF_Z - 5);
      const y = 1.2 + rand() * 2.5;
      bPos[i * 3] = x; bPos[i * 3 + 1] = y; bPos[i * 3 + 2] = z;
      bData.push({ x, y, z, phase: rand() * Math.PI * 2, spd: 0.4 + rand() * 0.6, rad: 1.5 + rand() * 3 });
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    const bMat = new THREE.PointsMaterial({ color: 0xfff2a0, size: 0.35, transparent: true, opacity: 0.9, depthWrite: false });
    const butterflies = new THREE.Points(bGeo, bMat);
    butterflies.userData.animated = true;
    scene.add(butterflies);
    animated.push({
      t: 0,
      update(dt) {
        this.t += dt;
        for (let i = 0; i < BFLY_N; i++) {
          const b = bData[i];
          bPos[i * 3] = b.x + Math.cos(this.t * b.spd + b.phase) * b.rad;
          bPos[i * 3 + 1] = b.y + Math.sin(this.t * b.spd * 1.6 + b.phase) * 0.6;
          bPos[i * 3 + 2] = b.z + Math.sin(this.t * b.spd + b.phase) * b.rad;
        }
        bGeo.attributes.position.needsUpdate = true;
      },
    });

    // ---- soft, airy DAYTIME lighting ----
    const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x6a8f4f, 1.05);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff6e0, 1.2);
    sun.position.set(30, 50, 20);
    scene.add(sun);
    if (sun.target) scene.add(sun.target);
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambient);

    // light pale haze (low density) — NOT the dark casino fog
    scene.fog = new THREE.FogExp2(0xcfe8ff, 0.0045);

    // ---- spawn near front entrance, facing in (toward -Z) ----
    const spawn = { x: 0, z: HALF_Z - 5, heading: Math.PI };

    function sampleGround() { return 0; }

    function update(dt, ctx) {
      if (!(dt > 0)) dt = 0.016;
      for (const a of animated) safe(() => a.update(dt));
    }

    return {
      scene,
      id: 'garden',
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
      scene.background = new THREE.Color(0x9fd4ff);
      stage = {
        scene, id: 'garden', baseY: 0,
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
