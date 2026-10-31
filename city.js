import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ================= 自由駕駛：程式生成的城市 =================
// 棋盤式街道：GRID × GRID 個街區，每個街區 BLOCK 公尺見方，街道寬 ROAD 公尺
export const GRID = 8, BLOCK = 90, ROAD = 18, CELL = BLOCK + ROAD;

export const CITY = {
  id: 'city', name: '港灣市區', desc: '自由駕駛：在城市街道上隨意奔馳',
  theme: {
    sky: { turbidity: 4.5, rayleigh: 2.2, elevation: 13, azimuth: 235 },
    exposure: 0.55, sun: [0xffd6a8, 4.2], hemi: [0xcfe0ff, 0x5a5550, 0.85], fog: [0xc8bcb0, 350, 1700],
    ground: ['#58763f'], runoff: ['#8d8d8d'], envGround: 0x6a6460, grip: 1,
  }
};

function canvasTex(renderer, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function speckle(g, w, h, base, lo, span, n) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const k = Math.random();
    g.fillStyle = `rgb(${lo + k * span | 0},${lo + k * span | 0},${lo + k * span + 3 | 0})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

export function buildCity(renderer) {
  const group = new THREE.Group();
  const size = GRID * CELL;
  const O = -size / 2;                       // 第 0 條街的中心座標
  const node = i => O + i * CELL;            // 第 i 條街的中心線
  const edge = size / 2 + ROAD / 2;          // 城市外緣

  const add = (geo, mat, { shadow = false, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = receive;
    group.add(m);
    return m;
  };

  // ---- 地面：城外草地 + 整片柏油 ----
  const grass = canvasTex(renderer, 256, 256, (g, w, h) => {
    g.fillStyle = '#58763f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgb(${70 + Math.random() * 30 | 0},${110 + Math.random() * 40 | 0},${50 + Math.random() * 20 | 0})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  grass.repeat.set(300, 300);
  add(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  const asphalt = canvasTex(renderer, 256, 256, (g, w, h) => speckle(g, w, h, '#3a3d42', 46, 36, 9000));
  asphalt.repeat.set(edge * 2 / 20, edge * 2 / 20);
  add(new THREE.PlaneGeometry(edge * 2, edge * 2).rotateX(-Math.PI / 2).translate(0, 0.06, 0),
    new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85, envMapIntensity: 0.5 }));

  // ---- 標線：黃色中線虛線、斑馬線 ----
  const marks = [];
  const plane = (w, l, x, z, rot) => { const g = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2); if (rot) g.rotateY(Math.PI / 2); g.translate(x, 0.08, z); return g.toNonIndexed(); };
  for (let i = 0; i <= GRID; i++) for (let j = 0; j < GRID; j++) {
    const from = node(j) + ROAD / 2 + 6, to = node(j + 1) - ROAD / 2 - 6;
    for (let t = from; t < to; t += 9) {
      marks.push(plane(0.35, 4.5, node(i), t + 2.25, false));     // 南北向道路
      marks.push(plane(0.35, 4.5, t + 2.25, node(i), true));      // 東西向道路
    }
  }
  const yellow = mergeGeometries(marks);
  add(yellow, new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.7 }));
  const zebra = [];
  for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
    const x = node(i), z = node(j);
    for (let k = -3; k <= 3; k++) {
      const o = k * 2.2;
      zebra.push(plane(1.1, 4, x + o, z - ROAD / 2 - 2.5, false), plane(1.1, 4, x + o, z + ROAD / 2 + 2.5, false));
      zebra.push(plane(1.1, 4, x - ROAD / 2 - 2.5, z + o, true), plane(1.1, 4, x + ROAD / 2 + 2.5, z + o, true));
    }
  }
  add(mergeGeometries(zebra), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 }));

  // ---- 街區、人行道、建築、公園 ----
  const blocks = [];
  const centerI = GRID / 2;
  for (let bi = 0; bi < GRID; bi++) for (let bj = 0; bj < GRID; bj++) {
    const x0 = node(bi) + ROAD / 2, x1 = node(bi + 1) - ROAD / 2;
    const z0 = node(bj) + ROAD / 2, z1 = node(bj + 1) - ROAD / 2;
    const dc = Math.hypot(bi + 0.5 - centerI, bj + 0.5 - centerI);
    blocks.push({ x0, x1, z0, z1, park: Math.random() < 0.12 && dc > 1, dc });
  }
  const walkTex = canvasTex(renderer, 128, 128, (g, w, h) => {
    speckle(g, w, h, '#a6a39c', 150, 40, 2500);
    g.strokeStyle = 'rgba(80,80,80,.35)'; g.lineWidth = 2;
    for (let k = 0; k <= w; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
  });
  walkTex.repeat.set(BLOCK / 4, BLOCK / 4);
  const walks = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK, 0.25, BLOCK), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95 }), blocks.length);
  walks.receiveShadow = true;
  const parkGrass = new THREE.MeshStandardMaterial({ color: 0x5f8f45, roughness: 1 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), col = new THREE.Color();
  blocks.forEach((b, i) => {
    walks.setMatrixAt(i, m4.makeTranslation((b.x0 + b.x1) / 2, 0.13, (b.z0 + b.z1) / 2));
    if (b.park) add(new THREE.BoxGeometry(BLOCK - 6, 0.3, BLOCK - 6).translate((b.x0 + b.x1) / 2, 0.16, (b.z0 + b.z1) / 2), parkGrass);
  });
  group.add(walks);

  // 窗戶貼圖：一格 8 公尺寬、7 公尺高（兩層樓），部分窗戶亮燈；左下角一小塊是屋頂顏色
  const winTex = canvasTex(renderer, 128, 112, (g, w, h) => {
    g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
      const lit = Math.random() < 0.18;
      g.fillStyle = lit ? '#ffd98a' : '#2c3a4a';
      g.fillRect(c * 32 + 5, r * 56 + 10, 22, 36);
      g.fillStyle = 'rgba(255,255,255,.15)';
      g.fillRect(c * 32 + 5, r * 56 + 10, 22, 6);
    }
    g.fillStyle = '#6b6b6b'; g.fillRect(0, h - 4, 4, 4);
  });
  const HEIGHTS = [12, 20, 30, 44, 62, 86];
  const LOT = 40;
  const bmat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.7, metalness: 0.1 });
  const variants = HEIGHTS.map(h => {
    const geo = new THREE.BoxGeometry(LOT, h, LOT).translate(0, h / 2, 0);
    // 讓窗戶大小一致：依建築尺寸縮放 UV；屋頂（+y 面）指到貼圖左下角的屋頂色
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      const face = Math.floor(k / 4);
      if (face === 2 || face === 3) uv.setXY(k, 0.01, 0.01);
      else uv.setXY(k, uv.getX(k) * LOT / 8, uv.getY(k) * h / 7);
    }
    const im = new THREE.InstancedMesh(geo, bmat, blocks.length * 4);
    im.castShadow = im.receiveShadow = true;
    im.count = 0;
    group.add(im);
    return im;
  });
  const PALETTE = [0xe8e2d6, 0xc9b49a, 0xa9b6c4, 0xd4a58a, 0x9fa7ad, 0xe3cfa8, 0x8fa9c2];
  const trees = [];
  for (const b of blocks) {
    if (b.park) {
      for (let k = 0; k < 14; k++) trees.push([b.x0 + 8 + Math.random() * (BLOCK - 16), b.z0 + 8 + Math.random() * (BLOCK - 16)]);
      continue;
    }
    for (let lx = 0; lx < 2; lx++) for (let lz = 0; lz < 2; lz++) {
      const cx = b.x0 + 3 + LOT / 2 + lx * (LOT + 4), cz = b.z0 + 3 + LOT / 2 + lz * (LOT + 4);
      // 越靠市中心越高
      const tall = Math.max(0, 1 - b.dc / 5);
      const hi = Math.min(HEIGHTS.length - 1, Math.floor(Math.random() * 3 + tall * 4));
      const im = variants[hi];
      const sx = 0.8 + Math.random() * 0.2, sz = 0.8 + Math.random() * 0.2;
      m4.compose(p3.set(cx, 0.25, cz), q.identity(), sc.set(sx, 1, sz));
      im.setMatrixAt(im.count, m4);
      im.setColorAt(im.count, col.set(PALETTE[Math.random() * PALETTE.length | 0]));
      im.count++;
    }
  }
  // 公園的樹
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3, 0).translate(0, 5, 0), new THREE.MeshStandardMaterial({ color: 0x4f8a3a, flatShading: true }), trees.length);
    trunk.castShadow = crown.castShadow = true;
    trees.forEach(([x, z], i) => {
      const k = 0.8 + Math.random() * 0.6;
      m4.compose(p3.set(x, 0.3, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * 6), sc.set(k, k, k));
      trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4);
    });
    group.add(trunk, crown);
  }

  // ---- 城市外圍護欄 ----
  {
    const wallTex = canvasTex(renderer, 64, 64, (g, w, h) => {
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d13b1f'; g.fillRect(0, 0, w / 2, h);
    });
    wallTex.repeat.set(edge * 2 / 6, 1);
    const wm = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6 });
    for (const [x, z, ry] of [[0, -edge, 0], [0, edge, 0], [-edge, 0, Math.PI / 2], [edge, 0, Math.PI / 2]]) {
      const w = add(new THREE.BoxGeometry(edge * 2, 1.2, 0.6), wm, { shadow: true });
      w.position.set(x, 0.6, z); w.rotation.y = ry;
    }
  }

  // ---- 遠山（合併成一個物件）----
  {
    const parts = [], c = new THREE.Color();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, r = 1150 + Math.random() * 300;
      const h = 160 + Math.random() * 260, rad = 150 + Math.random() * 180;
      const g = new THREE.ConeGeometry(rad, h, 7).toNonIndexed().translate(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
      c.setHSL(0.3 + Math.random() * 0.06, 0.18, 0.3 + Math.random() * 0.1);
      const n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) arr.set([c.r, c.g, c.b], k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      parts.push(g);
    }
    group.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
  }

  const s = CITY.theme.sky;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - s.elevation), THREE.MathUtils.degToRad(s.azimuth));
  // 依位置找出附近的街區（碰撞用）
  const blockAt = (x, z) => {
    const bi = Math.floor((x - O) / CELL), bj = Math.floor((z - O) / CELL);
    const out = [];
    for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++)
      if (i >= 0 && j >= 0 && i < GRID && j < GRID) out.push(blocks[i * GRID + j]);
    return out;
  };

  return {
    def: CITY, group, isCity: true, grip: 1, sunDir,
    center: new THREE.Vector3(0, 0, 0),
    bounds: { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge },
    grid: GRID, cell: CELL, road: ROAD, origin: O, edge, node, blocks, blockAt,
    spawn: { x: node(GRID / 2) - 3.5, z: node(GRID / 2) - CELL / 2, h: 0 },
    dispose() {
      group.traverse(o => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) { m.map?.dispose(); m.dispose(); }
      });
    }
  };
}
