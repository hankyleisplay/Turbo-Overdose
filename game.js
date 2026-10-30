import * as THREE from 'three';
import { Vehicle, SPEC, corneringSpeed } from './physics.js';
import { makeCar, WHEEL_R } from './car.js';
import { setupSky, setupPost, SkidMarks, Sparks, Smoke } from './fx.js';

// ================= 基本設定 =================
const LAPS = 3;
const ROAD_W = 18, HALF = ROAD_W / 2, CURB = 1.6, WALL = HALF + 9;
const N = 1400;                 // 賽道取樣點數
const CAR_R = 1.6;              // 碰撞半徑
const REF_SPEED = 80;           // 用於速度感效果的參考速度 (m/s)
const COLORS = [0xd81e1e, 0x1f6dff, 0xffbf00, 0x18b85a, 0x9b3dff, 0xff6a10];
const AI_NAMES = ['Blaze', 'Nova', 'Viper', 'Ghost', 'Rocket'];
const AI_SKILL = [0.97, 0.94, 1.0, 0.91, 0.96];
const DIFF = { easy: 0.82, normal: 0.9, hard: 0.98 };
const BEST_KEY = 'turbo-overdose-best';
const QUALITY_KEY = 'turbo-overdose-quality';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => {
  if (!isFinite(t)) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};

// ================= Renderer / Scene =================
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fbbd8, 500, 2600);
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 5000);

// 燈光：太陽 + 天空環境光
const SUN_DIR = new THREE.Vector3(0.45, 0.42, 0.3).normalize();
const SUN_OFF = SUN_DIR.clone().multiplyScalar(300);
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x3a5228, 0.7));
const sun = new THREE.DirectionalLight(0xfff0d8, 4.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 700 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const sky = setupSky(renderer, scene, SUN_DIR);

// 畫質設定
const isTouch = matchMedia('(pointer: coarse)').matches;
let quality = 'high';
try { quality = localStorage.getItem(QUALITY_KEY) || (isTouch ? 'low' : 'high'); } catch { quality = isTouch ? 'low' : 'high'; }
const post = setupPost(renderer, scene, camera);
function applyQuality() {
  const pr = quality === 'high' ? Math.min(devicePixelRatio, 2) : 1;
  renderer.setPixelRatio(pr);
  post.composer.setPixelRatio(pr);
  renderer.shadowMap.enabled = quality !== 'low';
  const ms = quality === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== ms) {
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  resize();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post.composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ================= 貼圖 =================
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
}
function noise(g, w, h, base, spread, n) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const [r, gg, b] = spread();
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}
const roadTex = canvasTex(256, 512, (g, w, h) => {
  noise(g, w, h, '#3b3e44', () => { const v = 48 + Math.random() * 36 | 0; return [v, v, v + 4]; }, 9000);
  g.fillStyle = '#eeeeee';
  g.fillRect(8, 0, 7, h); g.fillRect(w - 15, 0, 7, h);
  g.fillStyle = '#f5d33a';
  g.fillRect(w / 2 - 4, 0, 8, h * 0.5);
});
const curbTex = canvasTex(32, 64, (g, w, h) => {
  g.fillStyle = '#d42020'; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#f4f4f4'; g.fillRect(0, h / 2, w, h / 2);
});
const wallTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f5fd0'; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#222'; g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
});
const grassTex = canvasTex(256, 256, (g, w, h) =>
  noise(g, w, h, '#4f8a33', () => [60 + Math.random() * 40 | 0, 110 + Math.random() * 50 | 0, 40 + Math.random() * 25 | 0], 7000), 400);
const sandTex = canvasTex(128, 128, (g, w, h) =>
  noise(g, w, h, '#cbb68a', () => { const v = Math.random() * 40 | 0; return [180 + v, 160 + v, 120 + v]; }, 3000));
const checkerTex = canvasTex(64, 64, (g, w, h) => {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    g.fillRect(x * 16, y * 16, 16, 16);
  }
});


// ================= 賽道 =================
const CTRL = [
  [0, 220], [0, 0], [0, -120], [40, -240], [150, -310], [290, -280], [340, -160], [270, -80],
  [180, -60], [150, 30], [230, 110], [350, 130], [420, 230], [380, 360], [250, 410], [120, 420],
  [30, 380], [0, 300]
];
const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
const P = curve.getSpacedPoints(N); P.pop();
const L = curve.getLength(), ds = L / N;
const T = [], NR = [];
for (let i = 0; i < N; i++) {
  const t = P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize();
  T.push(t);
  NR.push(new THREE.Vector3(-t.z, 0, t.x)); // 行進方向的右側
}


// AI 速度表：由彎道半徑與車輛抓地力算出過彎極速，再往回推煞車距離
const SPEED = new Float32Array(N);
const AI_BRAKE = 19;
{
  const w = 10;
  for (let i = 0; i < N; i++) {
    const a = T[(i - w + N) % N], b = T[(i + w) % N];
    const ang = Math.acos(clamp(a.dot(b), -1, 1));
    const radius = (2 * w * ds) / Math.max(ang, 1e-5);
    SPEED[i] = Math.min(86, corneringSpeed(radius) * 0.95);
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = N - 1; i >= 0; i--)
      SPEED[i] = Math.min(SPEED[i], Math.sqrt(SPEED[(i + 1) % N] ** 2 + 2 * AI_BRAKE * ds));
}

function strip(fn, vRep) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    pos.push(...fn(i % N));
    const v = i * ds / vRep;
    uv.push(0, v, 1, v);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
const flat = (o1, o2, y, vRep) => strip(k => {
  const p = P[k], n = NR[k];
  return [p.x + n.x * o1, y, p.z + n.z * o1, p.x + n.x * o2, y, p.z + n.z * o2];
}, vRep);
const wallGeo = (o, h, vRep) => strip(k => {
  const p = P[k], n = NR[k], x = p.x + n.x * o, z = p.z + n.z * o;
  return [x, 0, z, x, h, z];
}, vRep);
function addMesh(geo, mat, { shadow = false, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = receive;
  scene.add(m);
  return m;
}

const ROAD_Y = 0.08;
addMesh(flat(-HALF, HALF, ROAD_Y, 24), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, envMapIntensity: 0.5 }));
const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
addMesh(flat(-HALF - CURB, -HALF, ROAD_Y + 0.02, 4), curbMat);
addMesh(flat(HALF, HALF + CURB, ROAD_Y + 0.02, 4), curbMat);
const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 });
addMesh(flat(-WALL, -HALF - CURB, 0.04, 10), sandMat);
addMesh(flat(HALF + CURB, WALL, 0.04, 10), sandMat);
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.DoubleSide, roughness: 0.6 });
addMesh(wallGeo(-WALL, 1.1, 6), wallMat, { shadow: true });
addMesh(wallGeo(WALL, 1.1, 6), wallMat, { shadow: true });

const grass = addMesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
grass.rotation.x = -Math.PI / 2;

// 起跑線與拱門
const startHeading = Math.atan2(T[0].x, T[0].z);
{
  const line = addMesh(new THREE.PlaneGeometry(ROAD_W, 3), new THREE.MeshStandardMaterial({ map: checkerTex.clone() }));
  line.material.map.repeat.set(6, 1);
  line.material.map.needsUpdate = true;
  line.geometry.rotateX(-Math.PI / 2);
  line.position.copy(P[0]).setY(ROAD_Y + 0.03);
  line.rotation.y = startHeading;

  const gantry = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.7, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), metal);
    post.position.set(s * (HALF + 3), 4.5, 0); post.castShadow = true;
    gantry.add(post);
  }
  const banner = canvasTex(1024, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#ff5a1f'); gr.addColorStop(1, '#ff2d6f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = 'italic 900 84px Arial Black, Arial'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('TURBO OVERDOSE', w / 2, h / 2 + 4);
  });
  banner.wrapS = banner.wrapT = THREE.ClampToEdgeWrapping;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 7, 2.4, 0.8),
    [metal, metal, metal, metal, new THREE.MeshStandardMaterial({ map: banner }), new THREE.MeshStandardMaterial({ map: banner })]);
  beam.position.y = 9.5; beam.castShadow = true;
  gantry.add(beam);
  gantry.position.copy(P[0]);
  gantry.rotation.y = startHeading + Math.PI; // 讓正面朝向來車
  scene.add(gantry);
}

// 看台與觀眾（起跑直線外側）
{
  const tierMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.9 });
  const stand = new THREE.Group();
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 600);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  let n = 0;
  for (let t = 0; t < 5; t++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(3, 1 + t * 1.2, 100), tierMat);
    tier.position.set((WALL + 5 + t * 3), (1 + t * 1.2) / 2, 0);
    tier.castShadow = tier.receiveShadow = true;
    stand.add(tier);
    for (let z = -48; z <= 48 && n < 600; z += 0.9) {
      if (Math.random() < 0.25) continue;
      m.makeTranslation((WALL + 5 + t * 3) + (Math.random() - 0.5), 1 + t * 1.2 + 0.55, z);
      crowd.setMatrixAt(n, m);
      crowd.setColorAt(n, c.setHSL(Math.random(), 0.7, 0.55));
      n++;
    }
  }
  crowd.count = n;
  stand.add(crowd);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 104), new THREE.MeshStandardMaterial({ color: 0xff5a1f }));
  roof.position.set(WALL + 11, 10, 0); roof.castShadow = true;
  stand.add(roof);
  stand.position.copy(P[0]);
  stand.rotation.y = startHeading; // 本地 z 沿賽道方向，本地 +x 為賽道左側（外側）
  scene.add(stand);
}

// 樹木
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
function distToTrack(x, z, step = 5) {
  let m = Infinity;
  for (let i = 0; i < N; i += step) { const dx = x - P[i].x, dz = z - P[i].z; m = Math.min(m, dx * dx + dz * dz); }
  return Math.sqrt(m);
}
{
  const TN = 650;
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 6); trunkGeo.translate(0, 1.5, 0);
  const leafGeo = new THREE.ConeGeometry(3, 8, 7); leafGeo.translate(0, 7, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b }), TN);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ flatShading: true }), TN);
  trunks.castShadow = leaves.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let n = 0, tries = 0;
  while (n < TN && tries++ < 20000) {
    const x = minX - 400 + Math.random() * (maxX - minX + 800);
    const z = minZ - 400 + Math.random() * (maxZ - minZ + 800);
    if (distToTrack(x, z) < WALL + 8) continue;
    if (Math.abs(x) < WALL + 40 && Math.abs(z - P[0].z) < 70) continue; // 看台區
    const k = 0.7 + Math.random() * 1.0;
    m.compose(p.set(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * 6.28), s.set(k, k * (0.8 + Math.random() * 0.5), k));
    trunks.setMatrixAt(n, m); leaves.setMatrixAt(n, m);
    leaves.setColorAt(n, c.setHSL(0.25 + Math.random() * 0.1, 0.55, 0.22 + Math.random() * 0.15));
    n++;
  }
  trunks.count = leaves.count = n;
  scene.add(trunks, leaves);
}

// 遠山
{
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
  const snow = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + Math.random() * 0.1;
    const r = 1300 + Math.random() * 350;
    const h = 180 + Math.random() * 320, rad = 160 + Math.random() * 200;
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 6 + (Math.random() * 3 | 0)), mat.clone());
    m.material.color.setHSL(0.3 + Math.random() * 0.08, 0.2, 0.25 + Math.random() * 0.12);
    m.position.set(center.x + Math.cos(a) * r, h / 2 - 5, center.z + Math.sin(a) * r);
    scene.add(m);
    if (h > 360) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.28, h * 0.28, m.geometry.parameters.radialSegments), snow);
      cap.position.copy(m.position).setY(h - 5 - h * 0.14 + 1);
      scene.add(cap);
    }
  }
}

// ================= 車輛 =================
const cars = [];
function makeEntity(name, color, isPlayer, skill = 1) {
  const e = {
    name, color, isPlayer, skill, model: makeCar(color),
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), h: 0, fwd: 0, steerVis: 0, ax: 0, ay: 0,
    roll: 0, pitch: 0, braking: false, boosting: false,
    idx: 0, cross: 0, half: true, finished: false, finishTime: Infinity,
    ai: !isPlayer, s: 0, speed: 0, offset: 0, offsetTarget: 0, offsetTimer: 0, bump: 0
  };
  if (isPlayer) e.veh = new Vehicle(e.pos, e.vel);
  scene.add(e.model.root);
  cars.push(e);
  return e;
}
const player = makeEntity('你', COLORS[0], true);
AI_NAMES.forEach((n, i) => makeEntity(n, COLORS[(i + 1) % COLORS.length], false, AI_SKILL[i]));

const skids = new SkidMarks(scene);
const sparks = new Sparks(scene);
const smoke = new Smoke(scene);

function trackAt(s, off, out) {
  s = ((s % L) + L) % L;
  const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
  out.copy(P[i]).lerp(P[j], t);
  out.x += (NR[i].x * (1 - t) + NR[j].x * t) * off;
  out.z += (NR[i].z * (1 - t) + NR[j].z * t) * off;
  return out;
}
function nearestIdx(pos, hint, win = 40) {
  let best = hint, bd = Infinity;
  for (let o = -win; o <= win; o++) {
    const i = ((hint + o) % N + N) % N;
    const dx = pos.x - P[i].x, dz = pos.z - P[i].z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const lateral = c => (c.pos.x - P[c.idx].x) * NR[c.idx].x + (c.pos.z - P[c.idx].z) * NR[c.idx].z;
const progress = c => c.cross * N + (c.ai ? c.s / ds : c.idx);

// ================= 輸入（鍵盤 / 觸控 / 搖桿） =================
const keys = { up: false, down: false, left: false, right: false, hand: false, nitro: false };
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Space: 'hand', ShiftLeft: 'nitro', ShiftRight: 'nitro', KeyN: 'nitro'
};
const CAM_MODES = 3;
addEventListener('keydown', e => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'KeyR') resetToTrack(player);
  if (e.code === 'KeyC') camMode = (camMode + 1) % CAM_MODES;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

if (isTouch) document.body.classList.add('touch');
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); keys[k] = true; b.classList.add('active'); };
  const off = e => { e.preventDefault(); keys[k] = false; b.classList.remove('active'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});

const pad = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false, gp: null };
let padPrev = [];
function pollPad() {
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null;
  pad.gp = gp;
  if (!gp) { pad.throttle = pad.brake = pad.steer = 0; pad.hand = pad.nitro = false; return; }
  const b = i => gp.buttons[i] ? gp.buttons[i].value : 0;
  const x = gp.axes[0] || 0;
  pad.steer = Math.abs(x) < 0.1 ? 0 : Math.sign(x) * ((Math.abs(x) - 0.1) / 0.9) ** 1.4;
  pad.throttle = b(7); pad.brake = b(6);
  pad.hand = b(2) > 0.5 || b(1) > 0.5;
  pad.nitro = b(0) > 0.5 || b(5) > 0.5;
  const pressed = i => b(i) > 0.5 && !(padPrev[i] > 0.5);
  const resultsOpen = !$('results').classList.contains('hidden');
  if (pressed(0) && (state === 'menu' || resultsOpen)) startRace();
  else if (pressed(9)) { if (state === 'menu' || resultsOpen) startRace(); else togglePause(); }
  if (pressed(3)) camMode = (camMode + 1) % CAM_MODES;
  if (pressed(8)) resetToTrack(player);
  padPrev = gp.buttons.map(x => x.value);
}
function rumble(strong, weak, ms) {
  const a = pad.gp?.vibrationActuator;
  if (a?.playEffect) a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
}
function readControls() {
  return {
    throttle: Math.max(keys.up ? 1 : 0, pad.throttle),
    brake: Math.max(keys.down ? 1 : 0, pad.brake),
    steer: clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + pad.steer, -1, 1),
    hand: keys.hand || pad.hand,
    nitro: keys.nitro || pad.nitro,
  };
}
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false };

// ================= 音效 =================
let audio = null, muted = false;
function initAudio() {
  if (audio) { audio.ctx.resume(); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = muted ? 0 : 0.45; master.connect(comp);
  const osc = (type, dest, gain = 1) => {
    const o = ctx.createOscillator(); o.type = type;
    const g = ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(dest); o.start();
    return o;
  };
  // 引擎：兩個略為失諧的鋸齒波 + 低八度方波
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
  const eg = ctx.createGain(); eg.gain.value = 0;
  lp.connect(eg); eg.connect(master);
  const o1 = osc('sawtooth', lp, 0.6), o2 = osc('sawtooth', lp, 0.5), o3 = osc('square', lp, 0.35);
  // 噪音來源（輪胎、風切、回火）
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = (type, freq, q) => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { g, f };
  };
  const squeal = noise('bandpass', 1500, 7);
  const wind = noise('lowpass', 600, 0.5);
  const rg = ctx.createGain(); rg.gain.value = 0; rg.connect(master);
  const rumbleOsc = ctx.createOscillator(); rumbleOsc.type = 'square'; rumbleOsc.frequency.value = 34;
  rumbleOsc.connect(rg); rumbleOsc.start();
  audio = { ctx, master, lp, eg, o1, o2, o3, squeal, wind, rg, buf, lastThrottle: 0 };
}
function beep(freq, dur = 0.18, type = 'square', vol = 0.25) {
  if (!audio) return;
  const { ctx, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}
function burst(freq, dur, vol, delay = 0, type = 'lowpass') {
  if (!audio) return;
  const { ctx, master, buf } = audio, t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur);
}
const crash = (v = 1) => { burst(500, 0.35, 0.7 * v); burst(120, 0.25, 0.8 * v); };
const backfire = () => { const n = 2 + (Math.random() * 3 | 0); for (let i = 0; i < n; i++) burst(380, 0.07, 0.55, i * (0.06 + Math.random() * 0.05)); };
function toggleMute() {
  muted = !muted;
  if (audio) audio.master.gain.value = muted ? 0 : 0.45;
}
function updateAudio(ctl, fx) {
  if (!audio) return;
  const a = audio, t = a.ctx.currentTime, v = player.veh;
  const rpm = v.rpm, rn = rpm / SPEC.maxRpm;
  const f = rpm / 60 * 2;
  a.o1.frequency.setTargetAtTime(f, t, 0.02);
  a.o2.frequency.setTargetAtTime(f * 1.012, t, 0.02);
  a.o3.frequency.setTargetAtTime(f * 0.5, t, 0.02);
  const thr = ctl.throttle;
  a.lp.frequency.setTargetAtTime(250 + rn * 2400 * (0.45 + 0.55 * thr), t, 0.03);
  a.eg.gain.setTargetAtTime((0.05 + 0.08 * thr + 0.04 * rn) * (v.shiftT > 0 ? 0.35 : 1), t, 0.03);
  a.squeal.g.gain.setTargetAtTime(fx.squeal * 0.22, t, 0.05);
  a.squeal.f.frequency.setTargetAtTime(1300 + fx.squeal * 500, t, 0.1);
  const sp = Math.abs(player.fwd) / REF_SPEED;
  a.wind.g.gain.setTargetAtTime(Math.min(1, sp * sp) * 0.14, t, 0.1);
  a.rg.gain.setTargetAtTime(fx.curb ? 0.08 : 0, t, 0.03);
  if (a.lastThrottle > 0.6 && thr < 0.1 && rpm > 5200) backfire();
  if (v.shifted) { v.shifted = 0; if (Math.random() < 0.5) backfire(); }
  a.lastThrottle = thr;
}

// ================= 遊戲狀態 =================
let state = 'menu', paused = false, cdTime = 0, raceTime = 0, lapStart = 0, bestLap = Infinity;
let camMode = 0, camH = 0, nitro = 50, wrongWay = 0, shake = 0, menuAngle = 0, lastCd = -1;
let difficulty = 'normal', playerColor = COLORS[0], resultsTimer = -1, curbTimer = 0;
try { bestLap = parseFloat(localStorage.getItem(BEST_KEY)) || Infinity; } catch { /* 無 storage */ }

function placeOnGrid() {
  // 6 台車兩列排開，玩家從最後一位出發
  const order = [...cars.filter(c => !c.isPlayer), player];
  order.forEach((c, k) => {
    c.s = L - 14 - Math.floor(k / 2) * 11;
    c.offset = c.offsetTarget = k % 2 ? 4.5 : -4.5;
    trackAt(c.s, c.offset, c.pos);
    c.idx = Math.floor(c.s / ds) % N;
    c.h = Math.atan2(T[c.idx].x, T[c.idx].z);
    c.vel.set(0, 0, 0); c.fwd = c.speed = c.steerVis = c.ax = c.ay = 0;
    c.cross = 0; c.half = true; c.finished = false; c.finishTime = Infinity;
    c.ai = !c.isPlayer;
    c.skillNow = c.skill * DIFF[difficulty];
    if (c.veh) c.veh.reset(c.h);
    syncModel(c, 0);
  });
}
function resetToTrack(c) {
  if (state !== 'race' || c.finished) return;
  c.idx = nearestIdx(c.pos, c.idx, N / 2);
  c.pos.copy(P[c.idx]);
  c.h = Math.atan2(T[c.idx].x, T[c.idx].z);
  c.veh.reset(c.h);
  c.fwd = 0;
  skids.last.clear();
}

function startRace() {
  document.activeElement?.blur();
  initAudio();
  player.model.paint.color.set(playerColor);
  let ci = 0;
  cars.filter(c => !c.isPlayer).forEach(c => {
    while (COLORS[ci] === playerColor) ci++;
    c.color = COLORS[ci]; c.model.paint.color.set(c.color); ci++;
  });
  player.color = playerColor;
  placeOnGrid();
  skids.clear();
  nitro = 50; raceTime = 0; lapStart = 0; wrongWay = 0; lastCd = -1; resultsTimer = -1;
  cdTime = 3.6; state = 'countdown'; paused = false;
  camH = player.h; camInit = false;
  $('menu').classList.add('hidden');
  $('results').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  $('bestlap').textContent = fmt(bestLap);
  showCenter('');
}
function togglePause() {
  if (state !== 'race' && state !== 'countdown') return;
  paused = !paused;
  showCenter(paused ? '暫停' : '', true);
  if (audio) paused ? audio.ctx.suspend() : audio.ctx.resume();
}
let centerTimer = 0;
function showCenter(text, small = false, time = 0) {
  const el = $('center');
  el.textContent = text;
  el.classList.toggle('smallmsg', small);
  centerTimer = time;
}

// ================= 物理 =================
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpL = new THREE.Vector3();
const SUBSTEPS = 4;

function surfaceOf(d) {
  const a = Math.abs(d);
  if (a <= HALF) return { grip: 1, drag: 0, kind: 'road' };
  if (a <= HALF + CURB) return { grip: 0.95, drag: 0, kind: 'curb' };
  return { grip: 0.62, drag: 170, kind: 'sand' };
}

function updatePlayer(dt, ctl) {
  const c = player, v = c.veh;
  const surf = surfaceOf(lateral(c));
  const boosting = ctl.nitro && nitro > 0 && v.u > 5;
  if (boosting) nitro = Math.max(0, nitro - 26 * dt);
  const pc = { throttle: boosting ? 1 : ctl.throttle, brake: ctl.brake, steer: ctl.steer, hand: ctl.hand, boost: boosting };
  for (let i = 0; i < SUBSTEPS; i++) v.step(dt / SUBSTEPS, pc, surf);

  c.h = v.h; c.fwd = v.u; c.steerVis = v.delta; c.ax = v.ax; c.ay = v.ay;
  c.boosting = boosting; c.braking = ctl.brake > 0.1 && v.u > 1;

  // 甩尾集氣
  const slide = Math.abs(v.beta);
  const drifting = slide > 0.12 && v.u > 15 && surf.kind !== 'sand';
  if (drifting) nitro = Math.min(100, nitro + 22 * slide * dt * 4);
  nitro = Math.min(100, nitro + 1.2 * dt);

  // 胎痕 / 煙 / 揚塵
  const fx = { squeal: 0, curb: surf.kind === 'curb' && Math.abs(v.u) > 5 };
  const sh = Math.sin(v.h), ch = Math.cos(v.h);
  tmpF.set(sh, 0, ch); tmpL.set(ch, 0, -sh);
  const rearSlip = clamp((Math.abs(v.slipR) - 0.13) * 4, 0, 1);
  const rear = Math.max(rearSlip, v.spin * 0.9, ctl.hand && Math.abs(v.u) > 5 ? 0.8 : 0);
  const front = Math.max(v.lockup, clamp((Math.abs(v.slipF) - 0.2) * 3, 0, 1));
  const onRoad = surf.kind !== 'sand';
  fx.squeal = onRoad && Math.abs(v.u) > 4 ? Math.max(rear, front * 0.8) : 0;
  const wheel = (z, x) => tmpV.copy(c.pos).addScaledVector(tmpF, z).addScaledVector(tmpL, x);
  ['rl', 'rr', 'fl', 'fr'].forEach((key, k) => {
    const z = k < 2 ? -1.38 : 1.38, x = k % 2 ? -0.9 : 0.9;
    const s = onRoad ? (k < 2 ? rear : front) : 0;
    skids.add(key, wheel(z, x), tmpF, s, ROAD_Y + 0.015);
    if (onRoad && k < 2 && s > 0.35 && Math.random() < s) smoke.emit(wheel(z, x).setY(0.45), 0xe8e8e8, 1.2, 0.35 + s * 0.3, c.vel);
    if (!onRoad && k < 2 && Math.abs(v.u) > 6 && Math.random() < 0.6) smoke.emit(wheel(z, x).setY(0.5), 0xb59a6a, 1.6, 0.55, c.vel);
  });
  if (fx.curb && (curbTimer -= dt) <= 0) { curbTimer = 0.12; rumble(0.15, 0.4, 100); shake = Math.max(shake, 0.12); }
  if (drifting && Math.random() < 0.1) rumble(0, 0.25, 80);
  return fx;
}

function updateAI(c, dt) {
  const i = Math.floor(c.s / ds) % N;
  let target = SPEED[i];
  for (let k = 4; k <= 40; k += 6) target = Math.min(target, SPEED[(i + k) % N] + k * 0.3);
  target *= c.skillNow;
  if (!c.isPlayer && state === 'race') {
    const diff = progress(player) - progress(c);
    target *= clamp(1 + diff * 0.00035, 0.9, 1.07); // 輕微動態平衡
  }
  if (c.isPlayer) target = Math.min(target, 40);
  if (c.bump > 0) { c.bump -= dt; target *= 0.75; }
  const prevSpeed = c.speed;
  const acc = 3 + 10 * Math.max(0, 1 - c.speed / 95);
  c.speed += clamp(target - c.speed, -AI_BRAKE * dt, acc * dt);
  c.braking = c.speed < prevSpeed - 0.05;
  c.ax += ((c.speed - prevSpeed) / Math.max(dt, 1e-4) - c.ax) * Math.min(1, 8 * dt);

  c.offsetTimer -= dt;
  if (c.offsetTimer <= 0) {
    c.offsetTimer = 2 + Math.random() * 4;
    c.offsetTarget = (Math.random() * 2 - 1) * (HALF - 2.5);
  }
  c.offset += (c.offsetTarget - c.offset) * Math.min(1, 1.2 * dt);
  c.offset = clamp(c.offset, -(HALF - 1.5), HALF - 1.5);

  c.s += c.speed * dt;
  if (c.s >= L) { c.s -= L; onCross(c, 1); }
  trackAt(c.s, c.offset, tmpV);
  const ahead = trackAt(c.s + 4, c.offset, new THREE.Vector3());
  c.vel.copy(tmpV).sub(c.pos).divideScalar(Math.max(dt, 1e-4)).setY(0);
  c.pos.copy(tmpV);
  const nh = Math.atan2(ahead.x - c.pos.x, ahead.z - c.pos.z);
  let dh = nh - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  c.steerVis += (clamp(dh * 6, -0.5, 0.5) - c.steerVis) * Math.min(1, 6 * dt);
  c.ay += (c.speed * dh / Math.max(dt, 1e-4) - c.ay) * Math.min(1, 6 * dt);
  c.h = nh;
  c.fwd = c.speed;
  c.idx = Math.floor(c.s / ds) % N;
  if (c.idx > N * 0.45 && c.idx < N * 0.55) c.half = true;
}

function onCross(c, dir) {
  if (dir > 0) {
    if (!c.half) return;
    c.cross++; c.half = false;
    if (c.isPlayer && state === 'race') {
      if (c.cross >= 2) {
        const lt = raceTime - lapStart;
        if (lt < bestLap) {
          bestLap = lt;
          try { localStorage.setItem(BEST_KEY, String(lt)); } catch { /* 無 storage */ }
          $('bestlap').textContent = fmt(bestLap);
        }
      }
      lapStart = raceTime;
      if (c.cross === LAPS) { showCenter('最後一圈！', true, 1.6); beep(880, 0.3); }
      else if (c.cross > 1 && c.cross <= LAPS) { showCenter(`第 ${c.cross} 圈`, true, 1.4); beep(660, 0.2); }
    }
    if (c.cross > LAPS && !c.finished) {
      c.finished = true;
      c.finishTime = raceTime;
      if (c.isPlayer) finishPlayer();
    }
  } else {
    c.cross--; c.half = true;
  }
}

function finishPlayer() {
  const pos = standings().indexOf(player) + 1;
  showCenter(pos === 1 ? '冠軍！' : 'FINISH', false, 3);
  beep(523, 0.2); setTimeout(() => beep(659, 0.2), 150); setTimeout(() => beep(784, 0.4), 300);
  // 終點後交給自動駕駛
  player.ai = true;
  player.s = player.idx * ds;
  player.offset = player.offsetTarget = clamp(lateral(player), -(HALF - 1.5), HALF - 1.5);
  player.speed = Math.max(0, player.fwd);
  player.skillNow = 0.6;
  state = 'done';
  resultsTimer = 3.2;
}

function collideWalls(c) {
  c.idx = nearestIdx(c.pos, c.idx);
  const n = NR[c.idx];
  const d = lateral(c);
  const lim = WALL - 1.1;
  if (Math.abs(d) <= lim) return;
  const s = Math.sign(d);
  c.pos.addScaledVector(n, -(d - s * lim));
  const vn = c.vel.dot(n);
  if (vn * s > 0) {
    c.vel.addScaledVector(n, -vn * 1.3);
    c.vel.multiplyScalar(0.86);
    if (c.veh) c.veh.r *= 0.4;
    const hit = Math.abs(vn);
    if (hit > 3) {
      shake = Math.min(1, hit / 25);
      crash(Math.min(1, hit / 20));
      rumble(Math.min(1, hit / 20), 0.6, 220);
    }
  }
  // 擦牆火花
  if (Math.hypot(c.vel.x, c.vel.z) > 8) {
    tmpV.copy(c.pos).addScaledVector(n, s * 1.0).setY(0.5);
    sparks.emit(tmpV, c.vel, Math.abs(vn) > 3 ? 25 : 4);
  }
}

function collideCars() {
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b];
    const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, d2 = dx * dx + dz * dz;
    if (d2 > (CAR_R * 2) ** 2 || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = CAR_R * 2 - d;
    if (!A.ai && B.ai) pushPlayer(A, B, -nx, -nz, over);
    else if (A.ai && !B.ai) pushPlayer(B, A, nx, nz, over);
    else {
      const side = (B.pos.x - A.pos.x) * NR[A.idx].x + (B.pos.z - A.pos.z) * NR[A.idx].z >= 0 ? 1 : -1;
      A.offsetTarget = clamp(A.offset - side * 3, -(HALF - 2), HALF - 2);
      B.offsetTarget = clamp(B.offset + side * 3, -(HALF - 2), HALF - 2);
      if (progress(A) < progress(B)) A.bump = 0.4; else B.bump = 0.4;
    }
  }
}
function pushPlayer(p, ai, nx, nz, over) {
  // nx,nz：從 AI 指向玩家
  p.pos.x += nx * over; p.pos.z += nz * over;
  const rvx = p.vel.x - ai.vel.x, rvz = p.vel.z - ai.vel.z;
  const vn = rvx * nx + rvz * nz;
  if (vn < 0) {
    p.vel.x -= nx * vn * 1.3; p.vel.z -= nz * vn * 1.3;
    // 側面撞擊讓車身打轉一點
    const sh = Math.sin(p.h), ch = Math.cos(p.h);
    p.veh.r += (nx * ch - nz * sh) * vn * 0.02;
    if (-vn > 4) {
      crash(Math.min(1, -vn / 15)); shake = Math.min(1, -vn / 20);
      rumble(Math.min(1, -vn / 15), 0.5, 180);
      tmpV.set(p.pos.x - nx * CAR_R, 0.7, p.pos.z - nz * CAR_R);
      sparks.emit(tmpV, p.vel, 18);
    }
  }
  const side = nx * NR[ai.idx].x + nz * NR[ai.idx].z;
  ai.offsetTarget = clamp(ai.offset - Math.sign(side || 1) * 3.5, -(HALF - 2), HALF - 2);
  ai.offsetTimer = 1.5;
  if (progress(ai) < progress(p)) ai.bump = 0.5;
}

function trackPlayerLap(prevIdx) {
  const c = player;
  if (prevIdx > N * 0.9 && c.idx < N * 0.1) onCross(c, 1);
  else if (prevIdx < N * 0.1 && c.idx > N * 0.9) onCross(c, -1);
  if (c.idx > N * 0.45 && c.idx < N * 0.55) c.half = true;
}

function standings() {
  return [...cars].sort((a, b) => {
    if (a.finished || b.finished) return a.finishTime - b.finishTime;
    return progress(b) - progress(a);
  });
}

function syncModel(c, dt) {
  const m = c.model;
  m.root.position.set(c.pos.x, ROAD_Y, c.pos.z);
  m.root.rotation.y = c.h;
  let spin = c.fwd * dt / WHEEL_R;
  for (let i = 0; i < 4; i++) {
    const extra = i >= 2 && c.veh && !c.ai ? c.veh.spin * 40 * dt : 0;
    m.wheels[i].rotation.x += spin + extra;
  }
  for (const p of m.pivots) p.rotation.y = c.steerVis;
  const k = Math.min(1, 7 * dt);
  c.roll += (clamp(c.ay * 0.0045, -0.06, 0.06) - c.roll) * k;
  c.pitch += (clamp(-c.ax * 0.004, -0.045, 0.045) - c.pitch) * k;
  m.chassis.rotation.z = c.roll;
  m.chassis.rotation.x = c.pitch;
  m.tail.emissiveIntensity = c.braking ? 4 : 0.6;
  for (const f of m.flames) {
    f.visible = c.boosting;
    if (c.boosting) f.scale.set(1, 1, 0.7 + Math.random() * 0.7);
  }
}

// ================= 相機 =================
let camInit = false;
const camPos = new THREE.Vector3(), camWant = new THREE.Vector3();
function updateCamera(dt) {
  const c = player;
  const beta = !c.ai ? c.veh.beta : 0;
  const sf = clamp(Math.abs(c.fwd) / REF_SPEED, 0, 1.3);
  const aim = c.h + clamp(beta, -0.7, 0.7) * 0.55;  // 甩尾時鏡頭看向行進方向
  let dh = aim - camH; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camH += dh * Math.min(1, 5 * dt);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  if (camMode < 2) {
    const far = camMode === 1;
    const dist = (far ? 13 : 6.6) + sf * 1.2, hgt = (far ? 4.8 : 2.45) + sf * 0.25;
    camWant.set(c.pos.x - fx * dist, hgt, c.pos.z - fz * dist);
    if (!camInit) { camPos.copy(camWant); camInit = true; }
    camPos.lerp(camWant, 1 - Math.exp(-16 * dt));
    camera.position.copy(camPos);
    camera.lookAt(c.pos.x + fx * 6, 1.1, c.pos.z + fz * 6);
  } else {
    const hx = Math.sin(c.h), hz = Math.cos(c.h);
    camera.position.set(c.pos.x + hx * 0.7, 1.22 + c.pitch * 2, c.pos.z + hz * 0.7);
    camera.lookAt(c.pos.x + hx * 30, 1.0, c.pos.z + hz * 30);
    camera.rotateZ(-c.roll * 0.6);
  }
  const vib = shake + Math.max(0, sf - 0.75) * 0.06 + (c.boosting ? 0.05 : 0);
  if (vib > 0) {
    camera.position.x += (Math.random() - 0.5) * vib * 0.5;
    camera.position.y += (Math.random() - 0.5) * vib * 0.5;
    shake = Math.max(0, shake - dt * 2.5);
  }
  const fov = 58 + sf * 15 + (c.boosting ? 9 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }
  const su = post.speed.uniforms;
  const blur = clamp((sf - 0.5) * 1.6, 0, 1) * 0.8 + (c.boosting ? 0.6 : 0);
  su.amount.value += (blur - su.amount.value) * Math.min(1, 4 * dt);
  su.aberration.value = c.boosting ? 0.3 : 0.05;
  sun.position.copy(c.pos).add(SUN_OFF);
  sun.target.position.copy(c.pos);
}

// ================= HUD / 小地圖 =================
const mm = $('minimap'), mctx = mm.getContext('2d');
const mmLayer = document.createElement('canvas'); mmLayer.width = mmLayer.height = 200;
const mmScale = 172 / Math.max(maxX - minX, maxZ - minZ);
const mmX = x => 100 + (x - center.x) * mmScale, mmY = z => 100 + (z - center.z) * mmScale;
{
  const g = mmLayer.getContext('2d');
  g.lineJoin = g.lineCap = 'round';
  const path = () => { g.beginPath(); P.forEach((p, i) => i ? g.lineTo(mmX(p.x), mmY(p.z)) : g.moveTo(mmX(p.x), mmY(p.z))); g.closePath(); };
  path(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 9; g.stroke();
  path(); g.strokeStyle = '#3b3e44'; g.lineWidth = 6; g.stroke();
  const n = NR[0];
  g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(mmX(P[0].x - n.x * 8), mmY(P[0].z - n.z * 8)); g.lineTo(mmX(P[0].x + n.x * 8), mmY(P[0].z + n.z * 8)); g.stroke();
}
const hex = c => '#' + c.toString(16).padStart(6, '0');
function drawMinimap() {
  mctx.clearRect(0, 0, 200, 200);
  mctx.drawImage(mmLayer, 0, 0);
  for (const c of cars) {
    if (c.isPlayer) continue;
    mctx.fillStyle = hex(c.color);
    mctx.beginPath(); mctx.arc(mmX(c.pos.x), mmY(c.pos.z), 4.5, 0, 7); mctx.fill();
  }
  mctx.fillStyle = hex(player.color); mctx.strokeStyle = '#fff'; mctx.lineWidth = 2.5;
  mctx.beginPath(); mctx.arc(mmX(player.pos.x), mmY(player.pos.z), 6.5, 0, 7); mctx.fill(); mctx.stroke();
}
function updateHUD() {
  const order = standings();
  const v = player.veh;
  $('pos').textContent = `${order.indexOf(player) + 1}/${cars.length}`;
  $('lap').textContent = `${clamp(player.cross, 1, LAPS)}/${LAPS}`;
  $('time').textContent = fmt(player.finished ? player.finishTime : raceTime);
  $('laptime').textContent = fmt(player.cross >= 1 && !player.finished ? raceTime - lapStart : 0);
  $('speed').textContent = Math.round(Math.abs(player.fwd) * 3.6);
  $('gear').textContent = player.ai ? 'A' : v.u < -0.5 ? 'R' : v.gear;
  const rn = v.rpm / SPEC.maxRpm;
  $('rpmfill').style.width = (rn * 100).toFixed(1) + '%';
  $('rpmfill').classList.toggle('red', rn > 0.9);
  $('nitrofill').style.width = nitro + '%';
  $('warn').textContent = wrongWay > 1 ? '逆向行駛！' : '';
  drawMinimap();
}

function showResults() {
  const order = standings();
  const me = order.indexOf(player) + 1;
  $('resTitle').textContent = me === 1 ? '🏆 冠軍！' : `第 ${me} 名`;
  $('resTable').innerHTML = order.map((c, i) => {
    const time = c.finished ? fmt(c.finishTime) : `第 ${clamp(c.cross, 1, LAPS)} 圈`;
    return `<tr class="${c.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${hex(c.color)}"></span>${c.name}</td><td>${time}</td></tr>`;
  }).join('') + `<tr><td></td><td>最佳單圈</td><td>${fmt(bestLap)}</td></tr>`;
  $('results').classList.remove('hidden');
  $('touch').classList.add('hidden');
}

// ================= 主迴圈 =================
const clock = new THREE.Clock();
function update(dt) {
  pollPad();
  if (state === 'menu') {
    menuAngle += dt * 0.08;
    camera.position.set(center.x + Math.cos(menuAngle) * 520, 230, center.z + Math.sin(menuAngle) * 520);
    camera.lookAt(center);
    sun.position.copy(center).add(SUN_OFF); sun.target.position.copy(center);
    post.speed.uniforms.amount.value = 0;
    return;
  }
  if (paused) return;

  const ctl = readControls();
  let fx = { squeal: 0, curb: false };
  if (state === 'countdown') {
    cdTime -= dt;
    const n = Math.ceil(cdTime);
    if (n !== lastCd && n <= 3) {
      lastCd = n;
      if (n > 0) { showCenter(String(n)); beep(440, 0.2); }
    }
    if (cdTime <= 0) {
      state = 'race';
      showCenter('GO!', false, 0.9); beep(880, 0.4);
    }
    // 起跑前可以催油
    const v = player.veh;
    v.rpm += (SPEC.idleRpm + ctl.throttle * 6200 - v.rpm) * Math.min(1, 6 * dt);
    for (const c of cars) syncModel(c, dt);
  } else {
    raceTime += dt;
    if (!player.ai) {
      const prev = player.idx;
      fx = updatePlayer(dt, state === 'race' ? ctl : NO_INPUT);
      collideWalls(player);
      trackPlayerLap(prev);
      const along = player.vel.dot(T[player.idx]);
      wrongWay = along < -4 ? wrongWay + dt : 0;
    } else {
      player.boosting = player.braking = false;
    }
    for (const c of cars) if (c.ai) updateAI(c, dt);
    collideCars();
    if (!player.ai) collideWalls(player);
    for (const c of cars) syncModel(c, dt);
    if (resultsTimer > 0 && (resultsTimer -= dt) <= 0) showResults();
  }
  if (centerTimer > 0 && (centerTimer -= dt) <= 0) showCenter('');
  smoke.update(dt);
  sparks.update(dt);
  updateCamera(dt);
  updateAudio(player.ai ? NO_INPUT : ctl, fx);
  updateHUD();
}
function render(dt) {
  if (quality === 'low') renderer.render(scene, camera);
  else post.composer.render(dt);
}
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  render(dt);
}

// ================= 選單 =================
COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'swatch' + (i === 0 ? ' on' : '');
  b.style.background = hex(c);
  b.onclick = () => {
    playerColor = c;
    document.querySelectorAll('#colors button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    player.model.paint.color.set(c);
  };
  $('colors').appendChild(b);
});
const choose = (sel, attr, fn) => document.querySelectorAll(sel).forEach(b => b.onclick = () => {
  document.querySelectorAll(sel).forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  fn(b.dataset[attr]);
});
choose('#diffs button', 'd', d => { difficulty = d; });
choose('#quals button', 'q', q => {
  quality = q;
  try { localStorage.setItem(QUALITY_KEY, q); } catch { /* 無 storage */ }
  applyQuality();
});
document.querySelectorAll('#quals button').forEach(b => b.classList.toggle('on', b.dataset.q === quality));
$('startBtn').onclick = startRace;
$('againBtn').onclick = startRace;
$('menuBtn').onclick = () => {
  state = 'menu';
  $('results').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (audio) { audio.eg.gain.value = 0; audio.wind.g.gain.value = 0; audio.squeal.g.gain.value = 0; }
};

applyQuality();
placeOnGrid();
frame();

// 除錯 / 自動測試用
window.__game = {
  get state() { return state; }, get nitro() { return nitro; },
  player, cars, keys, pad, standings, step: update, P, T, NR, SPEED, renderer, render, camera, skids
};
