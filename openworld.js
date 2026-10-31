import * as THREE from 'three';

// ================= 開放世界：步行、上下車、行人、警察、任務 =================
// G 是 game.js 提供的介面（場景、玩家、車輛工廠、音效、HUD 等），見 game.js 的 createOpenWorld 呼叫處

const STYLE_TO_CAR = { gt: 'gt', blade: 'blade', muscle: 'brute', hyper: 'hyper' };
const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 人物模型（方塊拼成，含走路擺動） ----------
const BOX = new THREE.BoxGeometry(1, 1, 1);
const HEAD = new THREE.SphereGeometry(0.17, 12, 10);
const SKINS = [0xe8c09a, 0xd29b6e, 0xa8714a, 0x7a4e32, 0xf1d2b5];
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.8 });
export function makePerson(shirt, pants = 0x2b3442, skin = SKINS[Math.random() * SKINS.length | 0]) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 });
  const part = (mat, w, h, d, x, y, z, parent = body) => {
    const m = new THREE.Mesh(BOX, mat);
    m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true;
    parent.add(m);
    return m;
  };
  const limb = (x, y) => { const g = new THREE.Group(); g.position.set(x, y, 0); body.add(g); return g; };
  const legL = limb(0.11, 0.9), legR = limb(-0.11, 0.9);
  for (const leg of [legL, legR]) { part(pantsMat, 0.15, 0.84, 0.17, 0, -0.42, 0, leg); part(darkMat, 0.16, 0.08, 0.27, 0, -0.86, 0.04, leg); }
  part(shirtMat, 0.44, 0.58, 0.25, 0, 1.2, 0);
  part(pantsMat, 0.42, 0.12, 0.24, 0, 0.92, 0);
  const armL = limb(0.29, 1.46), armR = limb(-0.29, 1.46);
  for (const arm of [armL, armR]) { part(shirtMat, 0.12, 0.5, 0.13, 0, -0.25, 0, arm); part(skinMat, 0.1, 0.11, 0.1, 0, -0.55, 0, arm); }
  const head = new THREE.Mesh(HEAD, skinMat); head.position.y = 1.67; head.castShadow = true; body.add(head);
  part(darkMat, 0.32, 0.1, 0.32, 0, 1.82, -0.01);
  return { root, body, legL, legR, armL, armR, phase: Math.random() * 6 };
}
function animate(p, speed, dt) {
  p.phase += speed * dt * 2.4;
  const a = Math.sin(p.phase) * Math.min(1, speed / 2) * 0.75;
  p.legL.rotation.x = a; p.legR.rotation.x = -a;
  p.armL.rotation.x = -a * 0.8; p.armR.rotation.x = a * 0.8;
}
function disposeModel(root) {
  root.removeFromParent();
  root.traverse(o => { if (o.material && o.material !== darkMat) o.material.dispose?.(); });
}

// ---------- 標記 ----------
function makeMarker(color) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 40, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 20;
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
  ring.position.y = 0.3;
  g.add(beam, ring);
  return g;
}
const COIN_GEO = new THREE.CylinderGeometry(0.7, 0.7, 0.16, 20).rotateX(Math.PI / 2);
const COIN_MAT = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.6 });

export function createOpenWorld(G) {
  const { scene, camera } = G;
  const ow = { onFoot: false, wanted: 0, active: false };
  let me = null, peds = [], cops = [], parked = [], coins = [], offers = [], offerQueue = [], rivals = [];
  let mission = null, heat = 0, bustT = 0, copSpawnT = 0, clock = 0, smokeT = 0, wreckSmokeT = 0, shopAt = null, shopT = 0;
  let siren = null;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const W = () => G.W();
  const player = G.player;
  const target = () => ow.onFoot ? me.pos : player.pos;
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

  // ---- 地圖上的點 ----
  // 街區人行道上的環狀路徑（距離街區邊緣 2.5 公尺）
  function ringPos(b, s, out) {
    const x0 = b.x0 + 2.5, x1 = b.x1 - 2.5, z0 = b.z0 + 2.5, z1 = b.z1 - 2.5;
    const w = x1 - x0, d = z1 - z0, per = 2 * (w + d);
    s = ((s % per) + per) % per;
    if (s < w) out.set(x0 + s, 0, z0);
    else if (s < w + d) out.set(x1, 0, z0 + s - w);
    else if (s < 2 * w + d) out.set(x1 - (s - w - d), 0, z1);
    else out.set(x0, 0, z1 - (s - 2 * w - d));
    return per;
  }
  // 街道上靠人行道的隨機一點（給任務標記用）
  function roadPoint(minD = 0, maxD = Infinity) {
    const w = W(), t = target();
    for (let k = 0; k < 200; k++) {
      const i = Math.random() * (w.grid + 1) | 0, j = Math.random() * w.grid | 0, side = Math.random() < 0.5 ? 1 : -1;
      const along = w.node(j) + w.road / 2 + 6 + Math.random() * (w.cell - w.road - 12);
      const p = Math.random() < 0.5 ? new THREE.Vector3(w.node(i) + side * 5.5, 0, along) : new THREE.Vector3(along, 0, w.node(i) + side * 5.5);
      if (Math.abs(p.x) > w.edge - 8 || Math.abs(p.z) > w.edge - 8) continue;
      const d = Math.sqrt(dist2(p, t));
      if (d >= minD && d <= maxD) return p;
    }
    return new THREE.Vector3(w.spawn.x, 0, w.spawn.z);
  }

  // ---- 開始 / 結束 ----
  function start() {
    stop();
    ow.active = true;
    me = { model: makePerson(0xff6a10, 0x1f2a44, 0xe8c09a), pos: new THREE.Vector3(), h: 0, y: 0, vy: 0, speed: 0 };
    me.model.root.visible = false;
    scene.add(me.model.root);
    ow.onFoot = false; ow.wanted = 0; heat = 0; bustT = 0; clock = 0;
    spawnPeds();
    spawnCoins();
    for (const type of Object.keys(OFFER)) spawnOffer(type);
    Object.assign(player.model, { health: 100, fuel: 100, wreck: false });
    updateHud();
  }
  function stop() {
    ow.active = false;
    if (me) disposeModel(me.model.root);
    for (const p of peds) disposeModel(p.model.root);
    for (const c of cops) scene.remove(c.model.root);
    for (const c of parked) scene.remove(c.model.root);
    for (const c of coins) c.mesh.removeFromParent();
    for (const o of offers) o.model.removeFromParent();
    if (mission) endMissionModels();
    for (const r of rivals) scene.remove(r.model.root);
    closeShop();
    me = null; peds = []; cops = []; parked = []; coins = []; offers = []; offerQueue = []; rivals = []; mission = null;
    sirenOff();
    ow.onFoot = false; ow.wanted = 0;
    G.$('owhud').classList.add('hidden');
  }

  // ---- 行人 ----
  const SHIRTS = [0x2e86de, 0xe74c3c, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35400];
  function spawnPeds() {
    const n = G.quality() === 'low' ? 18 : 36, blocks = W().blocks;
    for (let k = 0; k < n; k++) {
      const b = blocks[Math.random() * blocks.length | 0];
      const p = {
        model: makePerson(SHIRTS[Math.random() * SHIRTS.length | 0], [0x2b3442, 0x3b3b3b, 0x5a4632, 0x1f3a5f][k % 4]),
        b, s: Math.random() * 300, dir: Math.random() < 0.5 ? 1 : -1, speed: 1.1 + Math.random() * 0.6,
        state: 'walk', t: 0, pos: new THREE.Vector3(), h: 0, y: 0, vy: 0, vel: new THREE.Vector3(), flee: new THREE.Vector3(),
      };
      ringPos(b, p.s, p.pos);
      scene.add(p.model.root);
      peds.push(p);
    }
  }
  function knockDown(p, car, speed) {
    p.state = 'down'; p.t = 4.5;
    p.vel.copy(car.vel).multiplyScalar(0.6);
    p.vel.x += (Math.random() - 0.5) * 4; p.vel.z += (Math.random() - 0.5) * 4;
    p.vy = 3 + speed * 0.08; p.spin = (Math.random() < 0.5 ? -1 : 1) * (4 + speed * 0.1);
    G.thump(Math.min(1, speed / 25));
    G.shake(Math.min(0.5, speed / 50));
    addWanted(1);
  }
  function updatePeds(dt) {
    const car = ow.onFoot ? null : player, carSpeed = car ? Math.abs(car.fwd) : 0, t = target();
    for (const p of peds) {
      const far = dist2(p.pos, t) > 230 * 230;
      p.model.root.visible = !far;
      if (far && p.state === 'walk') { p.s += p.dir * p.speed * dt; continue; }
      if (p.state === 'walk') {
        const per = ringPos(p.b, p.s, tmp2);
        p.s += p.dir * p.speed * dt;
        ringPos(p.b, p.s, p.pos);
        p.h = Math.atan2(p.pos.x - tmp2.x, p.pos.z - tmp2.z) || p.h;
        animate(p.model, p.speed, dt);
        if (per && car && carSpeed > 7) {
          // 快車衝過來就逃跑
          const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z, d = Math.hypot(dx, dz);
          if (d < 14 && (car.vel.x * dx + car.vel.z * dz) > 0) {
            p.state = 'flee'; p.t = 2.5;
            p.flee.set(-car.vel.z, 0, car.vel.x).normalize();
            if (p.flee.x * dx + p.flee.z * dz < 0) p.flee.negate();
          }
        }
      } else if (p.state === 'flee' || p.state === 'back') {
        if (p.state === 'flee') {
          p.t -= dt;
          tmp.copy(p.pos).addScaledVector(p.flee, 5.5 * dt);
          if (!W().inBuilding(tmp.x, tmp.z, 0.3)) p.pos.copy(tmp); else p.flee.set(-p.flee.z, 0, p.flee.x);
          p.h = Math.atan2(p.flee.x, p.flee.z);
          animate(p.model, 5.5, dt);
          if (p.t <= 0) p.state = 'back';
        } else {
          // 走回人行道上最近的位置
          ringPos(p.b, p.s, tmp);
          const dx = tmp.x - p.pos.x, dz = tmp.z - p.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.5) p.state = 'walk';
          else {
            const step = Math.min(d, 2 * dt);
            p.pos.x += dx / d * step; p.pos.z += dz / d * step;
            p.h = Math.atan2(dx, dz);
            animate(p.model, 2, dt);
          }
        }
      } else if (p.state === 'down') {
        p.t -= dt;
        p.y = Math.max(0, p.y + p.vy * dt); p.vy -= 18 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-(p.y > 0 ? 0.5 : 4) * dt));
        p.model.body.rotation.x = Math.max(-Math.PI / 2, p.model.body.rotation.x - Math.abs(p.spin) * dt);
        if (p.t <= 0) {
          // 爬起來、跑走
          p.model.body.rotation.x = 0;
          p.state = 'flee'; p.t = 3; p.y = 0;
          p.flee.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        }
      }
      // 被玩家的車撞到
      if (car && p.state !== 'down' && carSpeed > 4 && dist2(p.pos, car.pos) < 1.8 * 1.8) knockDown(p, car, carSpeed);
      // 步行時和行人互相推開
      if (ow.onFoot && dist2(p.pos, me.pos) < 0.6 * 0.6) {
        const dx = p.pos.x - me.pos.x, dz = p.pos.z - me.pos.z, d = Math.hypot(dx, dz) || 1;
        p.pos.x += dx / d * 0.05; p.pos.z += dz / d * 0.05;
      }
      const ground = W().blockOf(p.pos.x, p.pos.z) ? 0.25 : 0;
      p.model.root.position.set(p.pos.x, ground + p.y, p.pos.z);
      p.model.root.rotation.y = p.h;
    }
  }

  // ---- 步行 ----
  function updateFoot(dt, ctl) {
    me.h -= ctl.steer * 2.8 * dt;
    const want = (ctl.throttle - ctl.brake * 0.6) * (ctl.nitro ? 7.5 : 3.4);
    me.speed += (want - me.speed) * Math.min(1, 10 * dt);
    tmp.set(me.pos.x + Math.sin(me.h) * me.speed * dt, 0, me.pos.z + Math.cos(me.h) * me.speed * dt);
    const w = W();
    if (!w.inBuilding(tmp.x, tmp.z, 0.35)) me.pos.copy(tmp);
    else if (!w.inBuilding(tmp.x, me.pos.z, 0.35)) me.pos.x = tmp.x;
    else if (!w.inBuilding(me.pos.x, tmp.z, 0.35)) me.pos.z = tmp.z;
    const lim = w.edge - 1;
    me.pos.x = clamp(me.pos.x, -lim, lim); me.pos.z = clamp(me.pos.z, -lim, lim);
    // 不能穿過車子
    for (const c of [player, ...parked, ...cops, ...G.traffic()]) {
      const dx = me.pos.x - c.pos.x, dz = me.pos.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d < 2.2 && d > 1e-4) { me.pos.x += dx / d * (2.2 - d); me.pos.z += dz / d * (2.2 - d); }
    }
    const ground = w.blockOf(me.pos.x, me.pos.z) ? 0.25 : 0;
    if (ctl.hand && me.y <= 0.001) me.vy = 5.2;
    me.y = Math.max(0, me.y + me.vy * dt); me.vy -= 16 * dt;
    if (me.y <= 0) me.vy = 0;
    animate(me.model, Math.abs(me.speed), dt);
    me.model.root.position.set(me.pos.x, ground + me.y, me.pos.z);
    me.model.root.rotation.y = me.h;
    // 步行時沿路撿錢、碰到任務點
  }
  let camYaw = 0;
  ow.updateCamera = dt => {
    let dh = wrap(me.h - camYaw);
    camYaw += dh * Math.min(1, 4 * dt);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    camera.position.set(me.pos.x - fx * 5.2, me.model.root.position.y + 2.4, me.pos.z - fz * 5.2);
    camera.lookAt(me.pos.x + fx * 2, me.model.root.position.y + 1.4, me.pos.z + fz * 2);
    if (Math.abs(camera.fov - 60) > 0.1) { camera.fov = 60; camera.updateProjectionMatrix(); }
  };

  // ---- 上下車 ----
  function nearestCar() {
    let best = null, bd = 3.8 * 3.8;
    const consider = (c, kind) => { if (c.model.wreck) return; const d = dist2(c.pos, me.pos); if (d < bd) { bd = d; best = { c, kind }; } };
    consider(player, 'own');
    parked.forEach(c => consider(c, 'parked'));
    G.traffic().forEach(c => consider(c, 'traffic'));
    cops.forEach(c => consider(c, 'cop'));
    return best;
  }
  ow.toggleVehicle = () => {
    if (!ow.active || G.state() !== 'race') return;
    if (!ow.onFoot) {
      if (Math.abs(player.fwd) > 6) { G.toast('先減速才能下車'); return; }
      exitCar();
      return;
    }
    enterNearest();
  };
  function exitCar(dist = 2.3) {
    ow.onFoot = true;
    closeShop();
    const lx = Math.cos(player.h), lz = -Math.sin(player.h);    // 車子左側（駕駛座）
    me.pos.set(player.pos.x + lx * dist, 0, player.pos.z + lz * dist);
    if (W().inBuilding(me.pos.x, me.pos.z, 0.4)) me.pos.set(player.pos.x - lx * dist, 0, player.pos.z - lz * dist);
    me.h = player.h; me.speed = 0; me.y = 0; me.vy = 0; camYaw = me.h;
    me.model.root.visible = true;
    G.door();
    updateHud();
  }
  function enterNearest() {
    const n = nearestCar();
    if (!n) { G.toast('附近沒有能開的車'); return; }
    if (n.kind !== 'own') {
      // 原本的車留在原地變成停著的車，接手新的車
      const old = { model: player.model, pos: player.pos.clone(), vel: new THREE.Vector3(), h: player.h, fwd: 0, steerVis: 0, roll: 0, pitch: 0, ax: 0, ay: 0, lift: player.lift || 0, style: player.model.style };
      old.model.boostLight && (old.model.boostLight.intensity = 0);
      old.model.beam.visible = false;
      parked.push(old);
      const c = n.c;
      if (n.kind === 'traffic') {
        G.removeTraffic(c);
        ejectDriver(c);
        if (cops.some(k => dist2(k.pos, c.pos) < 120 * 120)) addWanted(1);
        G.toast('搶到一台車！');
      } else if (n.kind === 'cop') {
        cops.splice(cops.indexOf(c), 1);
        addWanted(2);
        G.toast('你偷了警車！');
      } else parked.splice(parked.indexOf(c), 1);
      G.takeCar(c.model, STYLE_TO_CAR[c.model.style] || 'gt', c.pos, c.h);
    }
    ow.onFoot = false;
    me.model.root.visible = false;
    G.door();
    updateHud();
  }
  function ejectDriver(car) {
    const p = {
      model: makePerson(SHIRTS[Math.random() * SHIRTS.length | 0]), b: W().blocks[0], s: 0, dir: 1, speed: 1.3,
      state: 'flee', t: 4, pos: car.pos.clone(), h: 0, y: 0, vy: 0, vel: new THREE.Vector3(), flee: new THREE.Vector3(Math.cos(car.h), 0, -Math.sin(car.h)),
    };
    // 跑完後走到最近的人行道
    let best = Infinity;
    for (const b of W().blocks) { const d = ((b.x0 + b.x1) / 2 - car.pos.x) ** 2 + ((b.z0 + b.z1) / 2 - car.pos.z) ** 2; if (d < best) { best = d; p.b = b; } }
    p.pos.addScaledVector(p.flee, 2);
    scene.add(p.model.root);
    peds.push(p);
  }

  // ---- 通緝與警察 ----
  function addWanted(n) {
    if (ow.wanted >= 5) return;
    ow.wanted = Math.min(5, ow.wanted + n);
    heat = 0;
    updateHud();
  }
  function spawnCop() {
    const w = W(), t = target();
    let i, j, tries = 0;
    do {
      i = Math.random() * (w.grid + 1) | 0; j = Math.random() * (w.grid + 1) | 0;
    } while (tries++ < 50 && (Math.hypot(w.node(i) - t.x, w.node(j) - t.z) < 150 || Math.hypot(w.node(i) - t.x, w.node(j) - t.z) > 300));
    const e = G.makeCop();
    e.pos.set(w.node(i), 0, w.node(j));
    e.h = Math.atan2(t.x - e.pos.x, t.z - e.pos.z);
    e.veh.reset(e.h);
    e.nav = { wp: null, stuck: 0, back: 0 };
    cops.push(e);
  }
  // 沿著棋盤街道找下一個路口，往目標靠近
  function nextWaypoint(e, t) {
    const w = W(), O = w.origin, C = w.cell;
    const i = clamp(Math.round((e.pos.x - O) / C), 0, w.grid), j = clamp(Math.round((e.pos.z - O) / C), 0, w.grid);
    const atNode = Math.hypot(e.pos.x - w.node(i), e.pos.z - w.node(j)) < 14;
    let cands;
    if (atNode) cands = DIRS4.map(([dx, dz]) => [i + dx, j + dz]);
    else if (Math.abs(e.pos.x - w.node(i)) < Math.abs(e.pos.z - w.node(j))) {
      const j0 = Math.floor((e.pos.z - O) / C); cands = [[i, j0], [i, j0 + 1]];
    } else {
      const i0 = Math.floor((e.pos.x - O) / C); cands = [[i0, j], [i0 + 1, j]];
    }
    let best = null, bd = Infinity;
    for (const [a, b] of cands) {
      if (a < 0 || b < 0 || a > w.grid || b > w.grid) continue;
      const x = w.node(a), z = w.node(b);
      if (atNode && a === i && b === j) continue;
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < bd) { bd = d; best = new THREE.Vector3(x, 0, z); }
    }
    return best || t.clone();
  }
  function clearLine(a, b) {
    const w = W();
    for (let k = 1; k < 10; k++) {
      const u = k / 10;
      if (w.inBuilding(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, 1)) return false;
    }
    return true;
  }
  // AI 駕駛：近距離看得到就直接開過去，否則沿著街道路口一路靠近；卡住會倒車
  function driveAI(e, goal, dt, maxSpeed, chase) {
    const d = Math.sqrt(dist2(e.pos, goal));
    let aim;
    if (d < 80 && clearLine(e.pos, goal)) { aim = goal; e.nav.wp = null; }
    else {
      if (!e.nav.wp || dist2(e.pos, e.nav.wp) < 14 * 14) e.nav.wp = nextWaypoint(e, goal);
      aim = e.nav.wp;
    }
    const dh = wrap(Math.atan2(aim.x - e.pos.x, aim.z - e.pos.z) - e.veh.h);
    let steer = clamp(-dh * 2.4, -1, 1), throttle = 1, brake = 0;
    const v = e.veh.u;
    const desired = maxSpeed <= 0 ? 0 : Math.abs(dh) > 0.7 ? 12 : chase && d < 25 ? Math.max(3, d * 0.7) : maxSpeed;
    if (v > desired + 2) { throttle = 0; brake = 0.8; }
    if (desired === 0) { throttle = 0; brake = 1; }
    if (Math.abs(v) < 1 && throttle > 0) e.nav.stuck += dt; else e.nav.stuck = 0;
    if (e.nav.stuck > 1.4) { e.nav.back = 1.3; e.nav.stuck = 0; }
    if (e.nav.back > 0) { e.nav.back -= dt; throttle = 0; brake = 1; steer = -steer; }
    const ctl = { throttle, brake, steer, hand: false, boost: false };
    for (let k = 0; k < 2; k++) e.veh.step(dt / 2, ctl, { grip: 1, drag: 0 });
    e.h = e.veh.h; e.fwd = e.veh.u; e.steerVis = e.veh.delta; e.ax = e.veh.ax; e.ay = e.veh.ay; e.braking = brake > 0.1;
    G.collideCity(e);
    G.syncModel(e, dt);
  }
  function updateCops(dt) {
    const t = target();
    const flash = (clock * 4) % 1 < 0.5;
    for (const e of cops) {
      driveAI(e, t, dt, ow.wanted === 0 ? 0 : 55, true);
      e.model.lightR.material.emissiveIntensity = flash ? 5 : 0.2;
      e.model.lightB.material.emissiveIntensity = flash ? 0.2 : 5;
    }
    // 警車之間、警車和其他車互相推開
    const others = [...parked, ...G.traffic()];
    for (let a = 0; a < cops.length; a++) {
      for (let b = a + 1; b < cops.length; b++) pushApart(cops[a], cops[b], true);
      for (const o of others) pushApart(cops[a], o, false);
      if (!ow.onFoot) {
        const hit = pushApart(player, cops[a], true);
        if (hit > 5) { addWanted(1); G.crash(Math.min(1, hit / 15)); G.shake(Math.min(1, hit / 20)); ow.damage(hit * 1.2); }
      }
    }
    if (!ow.onFoot) for (const o of parked) pushApart(player, o, false);
    for (const r of rivals) {
      for (const o of [...parked, ...G.traffic(), ...cops]) pushApart(r, o, false);
      if (!ow.onFoot) pushApart(player, r, true);
    }
  }
  // 兩台車重疊時推開，回傳相對撞擊速度
  function pushApart(A, B, bothMove) {
    const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, d2 = dx * dx + dz * dz;
    if (d2 > 3.2 * 3.2 || d2 < 1e-6) return 0;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = 3.2 - d;
    const k = bothMove ? 0.5 : 1;
    A.pos.x -= nx * over * k; A.pos.z -= nz * over * k;
    if (bothMove) { B.pos.x += nx * over * k; B.pos.z += nz * over * k; }
    const vn = (A.vel.x - B.vel.x) * nx + (A.vel.z - B.vel.z) * nz;
    if (vn <= 0) return 0;
    A.vel.x -= nx * vn * (bothMove ? 0.65 : 1.2); A.vel.z -= nz * vn * (bothMove ? 0.65 : 1.2);
    if (bothMove) { B.vel.x += nx * vn * 0.65; B.vel.z += nz * vn * 0.65; }
    return vn;
  }
  function busted() {
    const fine = Math.min(G.prof.money, Math.max(500, Math.round(G.prof.money * 0.1 / 10) * 10));
    G.prof.money -= fine;
    G.saveProfile();
    G.showCenter('被逮捕了！', true, 3);
    G.toast(`罰款 $${fine.toLocaleString('en-US')}`);
    for (const c of cops) scene.remove(c.model.root);
    cops = [];
    ow.wanted = 0; heat = 0; bustT = 0;
    if (mission) failMission('被逮捕，任務失敗');
    if (player.model.wreck) Object.assign(player.model, { wreck: false, health: 100 });
    if (ow.onFoot) { ow.onFoot = false; me.model.root.visible = false; }
    G.respawn();
    updateHud();
  }
  function updateWanted(dt) {
    const t = target();
    const want = ow.wanted === 0 ? 0 : Math.min(ow.wanted + 1, G.quality() === 'low' ? 3 : 5);
    if (cops.length < want && (copSpawnT -= dt) <= 0) { spawnCop(); copSpawnT = 3; }
    // 沒有通緝時，離遠的警車收隊
    if (ow.wanted === 0) cops = cops.filter(c => { if (dist2(c.pos, t) > 160 * 160) { scene.remove(c.model.root); return false; } return true; });
    if (ow.wanted > 0) {
      const seen = cops.some(c => dist2(c.pos, t) < 130 * 130);
      heat = seen ? 0 : heat + dt;
      if (heat > 6 + ow.wanted * 3) { ow.wanted--; heat = 0; updateHud(); if (ow.wanted === 0) G.toast('甩掉警察了'); }
      // 被包圍又停下來就會被逮捕
      const close = cops.some(c => dist2(c.pos, t) < 7 * 7);
      const slow = ow.onFoot || Math.abs(player.fwd) < 2;
      bustT = close && slow ? bustT + dt : Math.max(0, bustT - dt);
      G.$('busted').style.opacity = clamp(bustT / 2.5, 0, 1).toFixed(2);
      if (bustT > 2.5) busted();
    } else G.$('busted').style.opacity = 0;
    // 警笛：依最近的警車距離調音量，頻率來回滑動
    let near = Infinity;
    for (const c of cops) near = Math.min(near, Math.sqrt(dist2(c.pos, t)));
    if (cops.length && ow.wanted > 0) sirenOn(clamp(1 - near / 260, 0, 1)); else sirenOff();
  }
  function sirenOn(v) {
    const a = G.audio();
    if (!a) return;
    if (!siren) {
      const o = a.ctx.createOscillator(), g = a.ctx.createGain();
      o.type = 'square'; g.gain.value = 0;
      const f = a.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      o.connect(f); f.connect(g); g.connect(a.master); o.start();
      siren = { o, g };
    }
    const t = a.ctx.currentTime;
    siren.o.frequency.setTargetAtTime(760 + 340 * Math.sin(clock * Math.PI * 1.6), t, 0.02);
    siren.g.gain.setTargetAtTime(0.06 * v, t, 0.1);
  }
  function sirenOff() {
    if (!siren) return;
    siren.g.gain.value = 0;
    siren.o.stop(); siren.o.disconnect();
    siren = null;
  }

  // ---- 任務與金幣 ----
  function spawnCoins() {
    for (let k = 0; k < 10; k++) {
      const mesh = new THREE.Mesh(COIN_GEO, COIN_MAT);
      const p = roadPoint(40);
      mesh.position.set(p.x, 1.2, p.z);
      scene.add(mesh);
      coins.push({ mesh });
    }
  }
  const OFFER = {
    delivery: { color: 0xffd23f, css: '#ffd23f', name: '送貨' },
    taxi: { color: 0x3dc8ff, css: '#3dc8ff', name: '計程車' },
    race: { color: 0xff3d3d, css: '#ff3d3d', name: '街頭競速' },
    escape: { color: 0xb04dff, css: '#b04dff', name: '逃脫追捕' },
  };
  function spawnOffer(type) {
    const pos = roadPoint(120, 450), model = makeMarker(OFFER[type].color);
    model.position.copy(pos);
    scene.add(model);
    offers.push({ type, pos, model });
  }
  function marker(color, pos) {
    const m = makeMarker(color);
    m.position.copy(pos);
    scene.add(m);
    return m;
  }
  function endMissionModels() {
    mission.model?.removeFromParent();
    mission.next?.removeFromParent();
    for (const r of rivals) scene.remove(r.model.root);
    rivals = [];
  }
  function finishMission(msg, reward) {
    if (reward) { G.prof.money += reward; G.saveProfile(); }
    G.showCenter(reward ? '任務完成！' : msg, true, 2);
    if (reward) G.toast(`${msg}　獎金 $${Math.round(reward).toLocaleString('en-US')}`);
    G.beep(523, 0.15); setTimeout(() => G.beep(784, 0.25), 140);
    endMissionModels();
    offerQueue.push({ type: mission.type, t: 4 });
    mission = null;
    updateHud();
  }
  function failMission(msg) {
    endMissionModels();
    offerQueue.push({ type: mission.type, t: 4 });
    mission = null;
    G.toast(msg);
  }
  const pay = (d, tLeft) => Math.round((300 + d * 3 + Math.max(0, tLeft) * 15) / 10) * 10;
  function startMission(o) {
    o.model.removeFromParent();
    offers.splice(offers.indexOf(o), 1);
    const from = player.pos;
    if (o.type === 'delivery') {
      const dest = roadPoint(300, 650), d = Math.sqrt(dist2(dest, from));
      mission = { type: 'delivery', dest, t: Math.round(d / 15 + 20), reward: Math.round((1200 + d * 4) / 50) * 50, model: marker(0x3dff7a, dest) };
      G.toast(`把包裹送到綠色標記，限時 ${mission.t} 秒`);
    } else if (o.type === 'taxi') {
      mission = { type: 'taxi', rides: 0, earned: 0 };
      newRide();
      G.toast('乘客上車了！送到綠色標記，越快小費越多');
    } else if (o.type === 'escape') {
      mission = { type: 'escape', t: 120 };
      addWanted(3);
      G.toast('120 秒內甩掉所有警察！');
    } else if (o.type === 'race') startRace();
    G.showCenter(OFFER[o.type].name, true, 1.8);
    G.beep(880, 0.15, 'triangle'); setTimeout(() => G.beep(1175, 0.2, 'triangle'), 120);
  }
  function newRide() {
    const dest = roadPoint(200, 500), d = Math.sqrt(dist2(dest, player.pos));
    mission.model?.removeFromParent();
    Object.assign(mission, { stage: 'ride', dest, d, t: Math.round(d / 13 + 15), model: marker(0x3dff7a, dest) });
  }
  // 街頭競速：沿著街道隨機走出一條路線，每隔兩個路口一個檢查點，和兩台 AI 對手比
  function startRace() {
    const w = W(), O = w.origin, C = w.cell;
    let i = clamp(Math.round((player.pos.x - O) / C), 0, w.grid), j = clamp(Math.round((player.pos.z - O) / C), 0, w.grid), last = -1;
    const cps = [];
    for (let n = 0; n < 14; n++) {
      const opts = [0, 1, 2, 3].filter(d => d !== (last + 2) % 4 && i + DIRS4[d][0] >= 0 && j + DIRS4[d][1] >= 0 && i + DIRS4[d][0] <= w.grid && j + DIRS4[d][1] <= w.grid);
      const d = opts.includes(last) && Math.random() < 0.5 ? last : opts[Math.random() * opts.length | 0];
      i += DIRS4[d][0]; j += DIRS4[d][1]; last = d;
      if (n % 2 === 1) cps.push(new THREE.Vector3(w.node(i), 0, w.node(j)));
    }
    mission = { type: 'race', stage: 'count', t: 3.5, cps, cp: 0, done: 0, limit: 160, place: 0 };
    rivals = [['blade', 0x18b85a, 50], ['muscle', 0x9b3dff, 47]].map(([style, color, speed], k) => {
      const e = G.makeRacer(style, color);
      const side = k ? -1 : 1, lx = Math.cos(player.h), lz = -Math.sin(player.h);
      e.pos.set(player.pos.x + lx * 4 * side - Math.sin(player.h) * 5, 0, player.pos.z + lz * 4 * side - Math.cos(player.h) * 5);
      e.veh.reset(player.h); e.h = player.h;
      e.nav = { wp: null, stuck: 0, back: 0 }; e.cpi = 0; e.speed = speed;
      return e;
    });
    showCheckpoint();
  }
  function showCheckpoint() {
    mission.model?.removeFromParent(); mission.next?.removeFromParent();
    const c = mission.cps[mission.cp];
    mission.model = marker(mission.cp === mission.cps.length - 1 ? 0xffffff : 0xff3d3d, c);
    const n = mission.cps[mission.cp + 1];
    mission.next = n ? marker(0x662222, n) : null;
  }
  function updateMission(dt) {
    const t = target(), m = mission;
    if (m.type === 'delivery') {
      m.t -= dt;
      if (dist2(m.dest, t) < 7 * 7) finishMission('包裹送達', m.reward);
      else if (m.t <= 0) failMission('時間到，送貨失敗');
    } else if (m.type === 'taxi') {
      m.t -= dt;
      if (m.stage === 'ride' && !ow.onFoot && dist2(m.dest, player.pos) < 7 * 7) {
        const fare = pay(m.d, m.t);
        m.rides++; m.earned += fare;
        G.prof.money += fare; G.saveProfile();
        G.toast(`車資 $${fare.toLocaleString('en-US')}（第 ${m.rides} 位乘客）`);
        G.beep(1046, 0.12, 'triangle');
        // 下一位乘客就在附近
        const next = roadPoint(60, 220);
        m.model.removeFromParent();
        Object.assign(m, { stage: 'pickup', dest: next, t: 30, model: marker(0x3dc8ff, next) });
      } else if (m.stage === 'pickup' && !ow.onFoot && dist2(m.dest, player.pos) < 7 * 7) newRide();
      else if (m.t <= 0) {
        const total = m.earned;
        failMission(m.rides ? `收班了！共載 ${m.rides} 位乘客，收入 $${total.toLocaleString('en-US')}` : '乘客等不及，下車了');
      }
    } else if (m.type === 'escape') {
      m.t -= dt;
      if (ow.wanted === 0) finishMission('成功逃脫', 3000);
      else if (m.t <= 0) failMission('沒能甩掉警察，任務失敗');
    } else if (m.type === 'race') {
      if (m.stage === 'count') {
        const before = Math.ceil(m.t);
        m.t -= dt;
        player.vel.multiplyScalar(0.5);
        if (Math.ceil(m.t) !== before && m.t > 0) { G.showCenter(String(Math.ceil(m.t)), false, 0.8); G.beep(440, 0.15); }
        if (m.t <= 0) { m.stage = 'run'; m.t = m.limit; G.showCenter('GO!', false, 0.8); G.beep(880, 0.3); }
        for (const r of rivals) { driveAI(r, r.pos, dt, 0, false); }
        return;
      }
      m.t -= dt;
      for (const r of rivals) {
        if (r.cpi >= m.cps.length) { driveAI(r, r.pos, dt, 0, false); continue; }
        driveAI(r, m.cps[r.cpi], dt, r.speed, false);
        if (dist2(r.pos, m.cps[r.cpi]) < 13 * 13 && ++r.cpi >= m.cps.length) m.done++;
      }
      if (!ow.onFoot && dist2(player.pos, m.cps[m.cp]) < 11 * 11) {
        m.cp++;
        G.beep(1318, 0.08, 'square', 0.15);
        if (m.cp >= m.cps.length) {
          const place = m.done + 1;
          finishMission(`第 ${place} 名`, [4000, 2000, 600][place - 1]);
          return;
        }
        showCheckpoint();
      }
      if (m.t <= 0) failMission('超過時限，比賽失敗');
    }
  }
  function updateMissions(dt) {
    const t = target();
    for (const c of coins) {
      c.mesh.rotation.y += dt * 3;
      if (dist2(c.mesh.position, t) < 3.2 * 3.2) {
        G.prof.money += 150; G.saveProfile();
        G.beep(1568, 0.08, 'square', 0.15); setTimeout(() => G.beep(2093, 0.12, 'square', 0.15), 70);
        const p = roadPoint(150);
        c.mesh.position.set(p.x, 1.2, p.z);
        updateHud();
      }
    }
    for (const o of offers) {
      o.model.rotation.y += dt;
      if (!mission && !ow.onFoot && dist2(o.pos, player.pos) < 6 * 6) { startMission(o); break; }
    }
    for (const q of offerQueue) if ((q.t -= dt) <= 0) spawnOffer(q.type);
    offerQueue = offerQueue.filter(q => q.t > 0);
    if (mission) updateMission(dt);
  }

  // ---- 車況：損壞、油量、爆炸 ----
  const cond = m => { m.health ??= 100; m.fuel ??= 35 + Math.random() * 55; return m; };
  ow.damage = amt => {
    if (!ow.active || ow.onFoot || amt <= 0) return;
    const m = cond(player.model);
    if (m.wreck) return;
    m.health = Math.max(0, m.health - amt);
    if (m.health <= 0) explode();
  };
  function explode() {
    const m = player.model;
    m.wreck = true;
    m.paint.color.set(0x1c1c1c);
    m.chassis.rotation.z = 0.04;
    G.boom(player.pos);
    player.vel.multiplyScalar(0.2);
    exitCar(4);
    G.toast('車子爆炸了！換一台吧');
    if (mission?.type === 'taxi' || mission?.type === 'delivery') failMission('車子壞了，任務失敗');
  }
  function updateCondition(dt, ctl) {
    const m = cond(player.model), v = player.veh;
    if (v.baseTorque == null) v.baseTorque = v.s.peakTorque;
    if (!ow.onFoot && !m.wreck) {
      const moving = Math.abs(v.u) > 0.5 || ctl.throttle > 0;
      m.fuel = Math.max(0, m.fuel - dt * (0.03 + 0.22 * ctl.throttle) * (moving ? 1 : 0.2));
      if (m.fuel <= 0 && !m.warnedFuel) { m.warnedFuel = true; G.toast('沒油了！開到加油站，或換一台車'); }
    }
    v.s.peakTorque = m.wreck || m.fuel <= 0 ? 0 : v.baseTorque * (0.45 + 0.55 * m.health / 100);
    // 引擎蓋冒煙：受損冒白煙，嚴重受損冒黑煙帶火
    if (!m.wreck && m.health < 55 && (smokeT -= dt) <= 0) {
      const bad = m.health < 25;
      smokeT = bad ? 0.05 : 0.14;
      tmp.set(player.pos.x + Math.sin(player.h) * 1.7, 1.1 + (player.lift || 0), player.pos.z + Math.cos(player.h) * 1.7);
      G.smoke(tmp, bad ? (Math.random() < 0.35 ? 0xff7a1a : 0x1e1e1e) : 0xc8c8c8, bad ? 1 : 0.8, bad ? 0.7 : 0.4, player.vel);
    }
    // 爛車持續冒黑煙
    if ((wreckSmokeT -= dt) <= 0) {
      wreckSmokeT = 0.15;
      for (const c of [player, ...parked]) if (c.model.wreck && dist2(c.pos, target()) < 150 * 150) {
        tmp.set(c.pos.x, 1.4, c.pos.z);
        G.smoke(tmp, 0x1a1a1a, 1.4, 0.6);
      }
    }
  }

  // ---- 加油站 / 修車廠 ----
  function closeShop() {
    if (!shopAt) return;
    shopAt = null;
    G.$('shop').classList.add('hidden');
  }
  function updateShops(dt) {
    if (ow.onFoot || mission?.type === 'race') { closeShop(); shopT = 0; return; }
    const svc = W().services.find(s => (s.x - player.pos.x) ** 2 + (s.z - player.pos.z) ** 2 < 8 * 8);
    if (!svc) { closeShop(); shopT = 0; return; }
    shopT = Math.abs(player.fwd) < 1.5 ? shopT + dt : 0;
    if (shopT > 0.5 && shopAt !== svc) { shopAt = svc; renderShop(); }
  }
  function renderShop() {
    const m = cond(player.model), money = G.prof.money, svc = shopAt;
    const box = G.$('shopBtns');
    box.innerHTML = '';
    const btn = (label, cost, fn, go) => {
      const b = document.createElement('button');
      b.textContent = cost ? `${label}　$${cost.toLocaleString('en-US')}` : label;
      if (go) b.className = 'go';
      b.disabled = cost > money;
      b.onclick = () => { fn(); renderShop(); updateHud(); };
      box.appendChild(b);
    };
    if (svc.type === 'gas') {
      G.$('shopTitle').textContent = '⛽ 加油站';
      const need = Math.max(0, 100 - m.fuel), cost = Math.ceil(need * 3);
      G.$('shopInfo').textContent = `油量 ${Math.round(m.fuel)}%`;
      if (need < 1) btn('油箱已滿', 0, () => {}, false), box.lastChild.disabled = true;
      else {
        const afford = Math.min(cost, money);
        btn(afford < cost ? `加到能付的量（${Math.round(m.fuel + afford / 3)}%）` : '加滿', afford, () => {
          G.prof.money -= afford; G.saveProfile(); m.fuel = Math.min(100, m.fuel + afford / 3); m.warnedFuel = false;
          G.beep(660, 0.1, 'triangle');
        }, true);
      }
    } else {
      G.$('shopTitle').textContent = '🔧 修車・烤漆';
      const dmg = Math.max(0, 100 - m.health), cost = Math.ceil(dmg * 12);
      G.$('shopInfo').textContent = `車況 ${Math.round(m.health)}%${ow.wanted ? `　通緝 ${'★'.repeat(ow.wanted)}` : ''}`;
      if (dmg >= 1) btn('修理', cost, () => { G.prof.money -= cost; G.saveProfile(); m.health = 100; G.beep(880, 0.12, 'triangle'); }, true);
      btn('重新烤漆', 400, () => {
        G.prof.money -= 400; G.saveProfile();
        m.paint.color.setHSL(Math.random(), 0.7, 0.45);
        player.color = m.paint.color.getHex();
        if (ow.wanted > 0 && !cops.some(c => dist2(c.pos, player.pos) < 90 * 90)) { ow.wanted = 0; heat = 0; G.toast('換了顏色，警察認不出你了'); }
        else if (ow.wanted > 0) G.toast('警察正看著你，烤漆沒用！');
        G.beep(990, 0.12, 'triangle');
      }, dmg < 1);
    }
    G.$('shop').classList.remove('hidden');
  }

  // ---- HUD ----
  function updateHud() {
    const h = G.$('owhud');
    h.classList.toggle('hidden', !ow.active);
    G.$('owstars').innerHTML = [1, 2, 3, 4, 5].map(i => `<i class="${i <= ow.wanted ? 'on' : ''}">★</i>`).join('');
    G.$('owmoney').textContent = '$' + Math.round(G.prof.money).toLocaleString('en-US');
    G.$('speedo').classList.toggle('hidden', ow.onFoot);
    G.$('carstat').classList.toggle('hidden', !ow.active);
    G.$('touch').classList.toggle('onfoot', ow.onFoot);
  }
  let hudT = 0;
  function updateHint(dt) {
    if ((hudT -= dt) > 0) return;
    hudT = 0.2;
    let hint = '';
    if (ow.onFoot) { const n = nearestCar(); if (n) hint = n.kind === 'own' ? '按 F 上車' : n.kind === 'cop' ? '按 F 搶警車' : '按 F 搶車'; }
    else if (player.model.wreck) hint = '車子爛了，按 F 下車';
    G.$('owhint').textContent = hint;
    const m = mission, sec = v => Math.max(0, Math.ceil(v)), far = p => Math.round(Math.sqrt(dist2(p, target())));
    G.$('owmission').innerHTML = !m ? Object.entries(OFFER).map(([k, o]) => `<span style="color:${o.css}">●</span> ${o.name}`).join('　')
      : m.type === 'delivery' ? `送貨　剩 ${sec(m.t)} 秒 · ${far(m.dest)} m`
      : m.type === 'taxi' ? `${m.stage === 'ride' ? '載客中' : '去接下一位'}　剩 ${sec(m.t)} 秒 · ${far(m.dest)} m · 已收 $${m.earned.toLocaleString('en-US')}`
      : m.type === 'escape' ? `逃脫追捕　剩 ${sec(m.t)} 秒`
      : m.stage === 'count' ? '街頭競速　準備…' : `街頭競速　檢查點 ${m.cp + 1}/${m.cps.length} · 剩 ${sec(m.t)} 秒`;
    const cm = cond(player.model);
    G.$('hpfill').style.width = cm.health + '%';
    G.$('hpfill').classList.toggle('low', cm.health < 30);
    G.$('fuelfill').style.width = cm.fuel + '%';
    G.$('fuelfill').classList.toggle('low', cm.fuel < 15);
    G.$('owstars').classList.toggle('flash', ow.wanted > 0 && heat > 0);
    G.$('owmoney').textContent = '$' + Math.round(G.prof.money).toLocaleString('en-US');
  }

  // ---- 每一格 ----
  ow.update = (dt, ctl) => {
    if (!ow.active) return;
    clock += dt;
    if (ow.onFoot) updateFoot(dt, ctl);
    updatePeds(dt);
    updateCops(dt);
    updateWanted(dt);
    updateMissions(dt);
    updateCondition(dt, ctl);
    updateShops(dt);
    updateHint(dt);
    for (const c of parked) G.syncModel(c, 0);
  };
  ow.drawMinimap = (g, mx, my) => {
    const dot = (p, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(mx(p.x), my(p.z), r, 0, 7); g.fill(); };
    const sq = (x, z, col) => { g.fillStyle = col; g.fillRect(mx(x) - 4, my(z) - 4, 8, 8); };
    for (const s2 of W().services) sq(s2.x, s2.z, s2.type === 'gas' ? '#ff8a1f' : '#3dc8ff');
    for (const c of coins) dot(c.mesh.position, 2.5, '#ffc83d');
    for (const o of offers) dot(o.pos, 5, OFFER[o.type].css);
    if (mission?.dest) dot(mission.dest, 5.5, '#3dff7a');
    if (mission?.type === 'race') { mission.cps.slice(mission.cp).forEach((c, k) => dot(c, k ? 3 : 5.5, k ? '#a33' : '#ff3d3d')); for (const r of rivals) dot(r.pos, 3.5, '#fff'); }
    for (const c of cops) dot(c.pos, 4, (clock * 4) % 1 < 0.5 ? '#ff3d3d' : '#3d7bff');
    if (ow.onFoot) dot(me.pos, 4, '#ffffff');
  };
  ow.cars = () => [...cops, ...rivals];
  ow.start = start;
  ow.stop = stop;
  ow.debug = () => ({ get offers() { return offers; }, get rivals() { return rivals; }, startOffer: type => startMission(offers.find(o => o.type === type)),  get me() { return me; }, get peds() { return peds; }, get cops() { return cops; }, get parked() { return parked; }, get coins() { return coins; }, get mission() { return mission; }, startMission, addWanted, get bustT() { return bustT; } });
  return ow;
}
