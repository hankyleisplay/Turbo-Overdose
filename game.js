import * as THREE from 'three';

// ================= 基本設定 =================
const LAPS = 3;
const ROAD_W = 18, HALF = ROAD_W / 2, CURB = 1.6, WALL = HALF + 9;
const N = 1400;                 // 賽道取樣點數
const CAR_R = 1.6;              // 碰撞半徑
const TOP_SPEED = 76, BOOST_SPEED = 100, OFFROAD_SPEED = 34;
const COLORS = [0xe62e2e, 0x1f7cff, 0xffc21a, 0x2ecc71, 0xb44dff, 0xff7a1a];
const AI_NAMES = ['Blaze', 'Nova', 'Viper', 'Ghost', 'Rocket'];
const AI_SKILL = [0.97, 0.94, 1.0, 0.91, 0.96];
const DIFF = { easy: 0.84, normal: 0.93, hard: 1.0 };
const BEST_KEY = 'turbo-overdose-best';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => {
  if (!isFinite(t)) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};

// ================= Renderer / Scene =================
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0f2, 300, 1700);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 燈光
scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4a6b2a, 0.9));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 600 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(120, 220, 80);

// 天空
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(3000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6fd0) }, bottom: { value: new THREE.Color(0xe4f0ff) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float h;
      void main(){
        gl_FragColor = vec4(mix(bottom, top, pow(max(h,0.0),0.55)),1.0);
        #include <colorspace_fragment>
      }`
  })
);
scene.add(sky);

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
const smokeTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
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

// AI 速度表：依彎道曲率估算過彎極速，再往回推煞車距離
const SPEED = new Float32Array(N);
{
  const w = 8;
  for (let i = 0; i < N; i++) {
    const a = T[(i - w + N) % N], b = T[(i + w) % N];
    const ang = Math.acos(clamp(a.dot(b), -1, 1));
    const k = ang / (2 * w * ds);
    SPEED[i] = Math.min(84, Math.sqrt(66 / Math.max(k, 1e-4)));
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = N - 1; i >= 0; i--)
      SPEED[i] = Math.min(SPEED[i], Math.sqrt(SPEED[(i + 1) % N] ** 2 + 2 * 38 * ds));
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
addMesh(flat(-HALF, HALF, ROAD_Y, 24), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 }));
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
function makeCar(color) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.75 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0d1620, metalness: 0.85, roughness: 0.12 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 1.4 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.5 });
  const add = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true;
    chassis.add(m);
    return m;
  };
  add(2.0, 0.5, 4.4, paint, 0, 0.62, 0);
  add(1.9, 0.18, 1.3, paint, 0, 0.92, 1.35);
  add(1.62, 0.5, 2.0, glass, 0, 1.1, -0.35);
  add(1.5, 0.08, 1.6, paint, 0, 1.39, -0.4);
  add(0.45, 0.02, 4.42, white, 0, 0.88, 0);
  add(2.1, 0.16, 3.0, black, 0, 0.4, 0);
  add(1.9, 0.2, 0.3, black, 0, 0.45, 2.2);
  for (const s of [-1, 1]) {
    add(0.1, 0.42, 0.12, black, s * 0.6, 1.02, -1.95);
    add(0.45, 0.15, 0.05, head, s * 0.65, 0.7, 2.21);
    add(0.5, 0.14, 0.05, tail, s * 0.62, 0.72, -2.21);
  }
  add(2.0, 0.08, 0.55, paint, 0, 1.25, -2.0);

  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 18); wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.42, 6); rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 });
  const wheels = [], pivots = [];
  for (const [x, z] of [[0.98, 1.38], [-0.98, 1.38], [0.98, -1.38], [-0.98, -1.38]]) {
    const piv = new THREE.Group(); piv.position.set(x, 0.45, z);
    const w = new THREE.Group();
    const tire = new THREE.Mesh(wheelGeo, black); tire.castShadow = true;
    w.add(tire, new THREE.Mesh(rimGeo, rimMat));
    piv.add(w); root.add(piv);
    wheels.push(w);
    if (z > 0) pivots.push(piv);
  }
  const flameGeo = new THREE.ConeGeometry(0.2, 1.4, 10);
  flameGeo.rotateX(-Math.PI / 2); flameGeo.translate(0, 0, -0.7);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x55c8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [-0.5, 0.5].map(x => {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(x, 0.55, -2.25); f.visible = false;
    root.add(f);
    return f;
  });
  scene.add(root);
  return { root, chassis, wheels, pivots, flames, tail, paint };
}

const cars = [];
function makeEntity(name, color, isPlayer, skill = 1) {
  const e = {
    name, color, isPlayer, skill, model: makeCar(color),
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), h: 0, fwd: 0, lat: 0, steer: 0,
    idx: 0, cross: 0, half: true, finished: false, finishTime: Infinity,
    ai: !isPlayer, s: 0, speed: 0, offset: 0, offsetTarget: 0, offsetTimer: 0, bump: 0
  };
  cars.push(e);
  return e;
}
const player = makeEntity('你', COLORS[0], true);
AI_NAMES.forEach((n, i) => makeEntity(n, COLORS[(i + 1) % COLORS.length], false, AI_SKILL[i]));

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
const progress = c => c.cross * N + (c.ai ? c.s / ds : c.idx);

// ================= 輸入 =================
const input = { up: false, down: false, left: false, right: false, hand: false, nitro: false };
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Space: 'hand', ShiftLeft: 'nitro', ShiftRight: 'nitro', KeyN: 'nitro'
};
addEventListener('keydown', e => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'KeyR') resetToTrack(player);
  if (e.code === 'KeyC') camMode = (camMode + 1) % 2;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { for (const k in input) input[k] = false; });

const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); input[k] = true; b.classList.add('active'); };
  const off = e => { e.preventDefault(); input[k] = false; b.classList.remove('active'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
});

// ================= 音效 =================
let audio = null, muted = false;
function initAudio() {
  if (audio) { audio.ctx.resume(); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = muted ? 0 : 0.35; master.connect(ctx.destination);
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = 'square';
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
  const eg = ctx.createGain(); eg.gain.value = 0.1;
  const o2g = ctx.createGain(); o2g.gain.value = 0.5;
  o1.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(eg); eg.connect(master);
  o1.start(); o2.start();
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.7;
  const sg = ctx.createGain(); sg.gain.value = 0;
  ns.connect(bp); bp.connect(sg); sg.connect(master); ns.start();
  audio = { ctx, master, o1, o2, lp, eg, sg };
}
function beep(freq, dur = 0.18, type = 'square', vol = 0.25) {
  if (!audio) return;
  const { ctx, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}
function crash() { beep(90, 0.25, 'sawtooth', 0.4); }
function toggleMute() {
  muted = !muted;
  if (audio) audio.master.gain.value = muted ? 0 : 0.35;
}
function updateAudio(throttle, skid) {
  if (!audio) return;
  const t = audio.ctx.currentTime;
  const sf = Math.abs(player.fwd) / TOP_SPEED;
  const g = Math.min(4, Math.floor(sf * 5)), frac = sf * 5 - g;
  const rpm = clamp((g === 0 ? 0.15 : 0.35) + frac * 0.65 + (state === 'countdown' && input.up ? 0.5 : 0), 0, 1.1);
  const f = 38 + rpm * 115 + g * 8;
  audio.o1.frequency.setTargetAtTime(f, t, 0.04);
  audio.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
  audio.lp.frequency.setTargetAtTime(350 + rpm * 1500 + throttle * 700, t, 0.05);
  audio.eg.gain.setTargetAtTime(0.07 + throttle * 0.06, t, 0.05);
  audio.sg.gain.setTargetAtTime(skid ? 0.12 : 0, t, 0.05);
}

// ================= 粒子（輪胎煙、草地揚塵） =================
const particles = [];
for (let i = 0; i < 120; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
  sp.visible = false; scene.add(sp);
  particles.push({ sp, life: 0, max: 1, v: new THREE.Vector3() });
}
let pIdx = 0;
function emit(pos, color, size = 1.2) {
  const p = particles[pIdx++ % particles.length];
  p.sp.position.copy(pos);
  p.sp.material.color.set(color);
  p.life = p.max = 0.8 + Math.random() * 0.5;
  p.v.set((Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2);
  p.size = size;
  p.sp.visible = true;
}
function updateParticles(dt) {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.sp.visible = false; continue; }
    const k = 1 - p.life / p.max;
    p.sp.position.addScaledVector(p.v, dt);
    p.sp.scale.setScalar(p.size + k * 4);
    p.sp.material.opacity = 0.55 * (1 - k);
  }
}

// ================= 遊戲狀態 =================
let state = 'menu', paused = false, cdTime = 0, raceTime = 0, lapStart = 0, bestLap = Infinity;
let camMode = 0, camH = 0, nitro = 50, wrongWay = 0, shake = 0, menuAngle = 0, lastCd = -1;
let difficulty = 'normal', playerColor = COLORS[0], resultsTimer = -1;
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
    c.vel.set(0, 0, 0); c.fwd = c.lat = c.speed = c.steer = 0;
    c.cross = 0; c.half = true; c.finished = false; c.finishTime = Infinity;
    c.ai = !c.isPlayer;
    c.skillNow = c.skill * DIFF[difficulty];
    syncModel(c, 0);
  });
}
function resetToTrack(c) {
  if (state !== 'race' || c.finished) return;
  c.idx = nearestIdx(c.pos, c.idx, N / 2);
  c.pos.copy(P[c.idx]);
  c.h = Math.atan2(T[c.idx].x, T[c.idx].z);
  c.vel.set(0, 0, 0); c.fwd = c.lat = 0;
}

function startRace() {
  document.activeElement?.blur();
  initAudio();
  player.model.paint.color.set(playerColor);
  // 避免和玩家撞色
  let ci = 0;
  cars.filter(c => !c.isPlayer).forEach(c => {
    while (COLORS[ci] === playerColor) ci++;
    c.color = COLORS[ci]; c.model.paint.color.set(c.color); ci++;
  });
  player.color = playerColor;
  placeOnGrid();
  nitro = 50; raceTime = 0; lapStart = 0; wrongWay = 0; lastCd = -1; resultsTimer = -1;
  cdTime = 3.6; state = 'countdown'; paused = false;
  camH = player.h;
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
const tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpV = new THREE.Vector3();

function updatePlayer(dt, ctl) {
  const c = player;
  tmpF.set(Math.sin(c.h), 0, Math.cos(c.h));
  tmpR.set(-tmpF.z, 0, tmpF.x);
  let fwd = c.vel.dot(tmpF), lat = c.vel.dot(tmpR);

  const d = (c.pos.x - P[c.idx].x) * NR[c.idx].x + (c.pos.z - P[c.idx].z) * NR[c.idx].z;
  const off = Math.abs(d) > HALF + CURB;
  const boosting = ctl.nitro && nitro > 0 && fwd > 5;
  if (boosting) nitro = Math.max(0, nitro - 28 * dt);
  const maxV = off ? OFFROAD_SPEED : boosting ? BOOST_SPEED : TOP_SPEED;

  if (ctl.up) {
    const acc = (boosting ? 52 : 30) * Math.max(0.12, 1 - Math.max(0, fwd) / maxV);
    if (fwd < maxV) fwd = Math.min(maxV, fwd + acc * dt);
  } else if (ctl.down) {
    fwd = fwd > 1 ? fwd - 70 * dt : Math.max(-22, fwd - 20 * dt);
  } else {
    fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 7 * dt);
  }
  if (fwd > maxV) fwd = Math.max(maxV, fwd - (off ? 45 : 18) * dt);

  const st = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);
  c.steer += (st - c.steer) * Math.min(1, 9 * dt);
  const af = Math.abs(fwd);
  const turn = 2.35 * clamp(af / 10, 0, 1) * (1 - 0.62 * clamp(af / 90, 0, 1)) * (ctl.hand ? 1.45 : 1) * Math.sign(fwd || 1);
  c.h -= c.steer * turn * dt;

  // 側滑：抓地力把側向速度吃掉，甩尾時抓地力降低
  const grip = ctl.hand ? 1.3 : off ? 4 : 8.5;
  const kept = Math.exp(-grip * dt);
  if (fwd > 0) fwd += Math.abs(lat) * (1 - kept) * 0.45;
  lat *= kept;
  if (ctl.hand) fwd *= Math.exp(-0.35 * dt);

  const drifting = Math.abs(lat) > 4.5 && af > 18;
  if (drifting && !off) nitro = Math.min(100, nitro + 16 * dt);
  nitro = Math.min(100, nitro + 1.5 * dt);

  tmpF.set(Math.sin(c.h), 0, Math.cos(c.h));
  tmpR.set(-tmpF.z, 0, tmpF.x);
  c.vel.copy(tmpF).multiplyScalar(fwd).addScaledVector(tmpR, lat);
  c.pos.addScaledVector(c.vel, dt);
  c.fwd = fwd; c.lat = lat;
  c.boosting = boosting; c.drifting = drifting; c.off = off;
  c.braking = ctl.down && fwd > 1;

  // 粒子
  if ((drifting || (off && af > 10)) && Math.random() < 0.9) {
    for (const s of [-1, 1]) {
      tmpV.copy(c.pos).addScaledVector(tmpF, -1.6).addScaledVector(tmpR, s * 0.95).setY(0.5);
      emit(tmpV, off ? 0xa08a5a : 0xdddddd, off ? 1.5 : 1.1);
    }
  }
  return { throttle: ctl.up ? 1 : 0, skid: drifting && !off };
}

function updateAI(c, dt) {
  const i = Math.floor(c.s / ds) % N;
  // 往前看一段距離取最低安全速度
  let target = SPEED[i];
  for (let k = 4; k <= 40; k += 6) target = Math.min(target, SPEED[(i + k) % N] + k * 0.4);
  target *= c.skillNow;
  if (!c.isPlayer && state === 'race') {
    const diff = progress(player) - progress(c);
    target *= clamp(1 + diff * 0.00035, 0.9, 1.07); // 輕微動態平衡
  }
  if (c.isPlayer) target = Math.min(target, 45);
  if (c.bump > 0) { c.bump -= dt; target *= 0.75; }
  c.speed += clamp(target - c.speed, -50 * dt, 24 * dt);

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
  c.vel.copy(tmpV).sub(c.pos).divideScalar(Math.max(dt, 1e-4));
  c.pos.copy(tmpV);
  const nh = Math.atan2(ahead.x - c.pos.x, ahead.z - c.pos.z);
  let dh = nh - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  c.steer = clamp(-dh * 4, -1, 1);
  c.h = nh;
  c.fwd = c.speed;
  c.idx = Math.floor(c.s / ds) % N;
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
  const d = (player.pos.x - P[player.idx].x) * NR[player.idx].x + (player.pos.z - P[player.idx].z) * NR[player.idx].z;
  player.offset = player.offsetTarget = clamp(d, -(HALF - 1.5), HALF - 1.5);
  player.speed = Math.max(0, player.fwd);
  player.skillNow = 0.6;
  state = 'done';
  resultsTimer = 3.2;
}

function collideWalls(c) {
  c.idx = nearestIdx(c.pos, c.idx);
  const n = NR[c.idx];
  const d = (c.pos.x - P[c.idx].x) * n.x + (c.pos.z - P[c.idx].z) * n.z;
  const lim = WALL - 1.1;
  if (Math.abs(d) > lim) {
    const s = Math.sign(d);
    c.pos.addScaledVector(n, -(d - s * lim));
    const vn = c.vel.dot(n);
    if (vn * s > 0) {
      c.vel.addScaledVector(n, -vn * 1.35);
      c.vel.multiplyScalar(0.8);
      if (Math.abs(vn) > 8) { shake = Math.min(1, Math.abs(vn) / 30); crash(); }
    }
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
      // 兩台 AI：互相讓車道
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
    if (-vn > 6) { crash(); shake = Math.min(1, -vn / 25); }
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
function trackAIHalf(c) {
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
  m.root.position.copy(c.pos).setY(ROAD_Y);
  m.root.rotation.y = c.h;
  const spin = c.fwd * dt / 0.45;
  for (const w of m.wheels) w.rotation.x += spin;
  for (const p of m.pivots) p.rotation.y = -c.steer * 0.45;
  m.chassis.rotation.z = clamp(c.steer * Math.abs(c.fwd) / TOP_SPEED * 0.06, -0.08, 0.08);
  m.chassis.rotation.x = c.braking ? 0.025 : 0;
  m.tail.emissiveIntensity = c.braking ? 2.5 : 0.5;
  const boost = !!c.boosting;
  for (const f of m.flames) {
    f.visible = boost;
    if (boost) f.scale.set(1, 1, 0.7 + Math.random() * 0.6);
  }
}

// ================= 相機 =================
function updateCamera(dt) {
  const c = player;
  let dh = c.h - camH; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camH += dh * Math.min(1, 5 * dt);
  const sf = clamp(Math.abs(c.fwd) / TOP_SPEED, 0, 1.4);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  if (camMode === 0) {
    const dist = 10.5 + sf * 2.5;
    camera.position.set(c.pos.x - fx * dist, 4.2 + sf * 0.6, c.pos.z - fz * dist);
    camera.lookAt(c.pos.x + fx * 6, 1.3, c.pos.z + fz * 6);
  } else {
    const hx = Math.sin(c.h), hz = Math.cos(c.h);
    camera.position.set(c.pos.x + hx * 0.4, 1.55, c.pos.z + hz * 0.4);
    camera.lookAt(c.pos.x + hx * 30, 1.2, c.pos.z + hz * 30);
  }
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    shake = Math.max(0, shake - dt * 2.5);
  }
  const fov = 62 + sf * 12 + (c.boosting ? 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }
  sky.position.copy(camera.position);
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
  $('pos').textContent = `${order.indexOf(player) + 1}/${cars.length}`;
  $('lap').textContent = `${clamp(player.cross, 1, LAPS)}/${LAPS}`;
  $('time').textContent = fmt(player.finished ? player.finishTime : raceTime);
  $('laptime').textContent = fmt(player.cross >= 1 && !player.finished ? raceTime - lapStart : 0);
  $('speed').textContent = Math.round(Math.abs(player.fwd) * 3.6);
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
const NO_INPUT = { up: false, down: false, left: false, right: false, hand: false, nitro: false };
const clock = new THREE.Clock();
function update(dt) {
  if (state === 'menu') {
    menuAngle += dt * 0.08;
    camera.position.set(center.x + Math.cos(menuAngle) * 520, 230, center.z + Math.sin(menuAngle) * 520);
    camera.lookAt(center);
    sky.position.copy(camera.position);
    sun.position.copy(center).add(SUN_OFF); sun.target.position.copy(center);
    return;
  }
  if (paused) return;

  let snd = { throttle: input.up ? 1 : 0, skid: false };
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
    for (const c of cars) syncModel(c, dt);
  } else {
    raceTime += dt;
    if (!player.ai) {
      const prev = player.idx;
      snd = updatePlayer(dt, state === 'race' ? input : NO_INPUT);
      collideWalls(player);
      trackPlayerLap(prev);
      const along = player.vel.dot(T[player.idx]);
      wrongWay = along < -4 ? wrongWay + dt : 0;
    } else {
      player.boosting = player.braking = false;
    }
    for (const c of cars) if (c.ai) { updateAI(c, dt); trackAIHalf(c); }
    collideCars();
    if (!player.ai) collideWalls(player);
    for (const c of cars) syncModel(c, dt);
    if (resultsTimer > 0 && (resultsTimer -= dt) <= 0) showResults();
  }
  if (centerTimer > 0 && (centerTimer -= dt) <= 0) showCenter('');
  updateParticles(dt);
  updateCamera(dt);
  updateAudio(snd.throttle, snd.skid);
  updateHUD();
}
function frame() {
  requestAnimationFrame(frame);
  update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
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
document.querySelectorAll('#diffs button').forEach(b => b.onclick = () => {
  difficulty = b.dataset.d;
  document.querySelectorAll('#diffs button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
});
$('startBtn').onclick = startRace;
$('againBtn').onclick = startRace;
$('menuBtn').onclick = () => {
  state = 'menu';
  $('results').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (audio) audio.eg.gain.value = 0;
};

placeOnGrid();
frame();

// 除錯 / 自動測試用
window.__game = { get state() { return state; }, get nitro() { return nitro; }, player, cars, input, standings, step: update, P, T, NR };
