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

function signTex(renderer, text, bg, fg = '#fff') {
  return canvasTex(renderer, 256, 64, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = 'bold 40px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  });
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
  const signs = [];
  // 加油站：遮雨棚 + 油槍；修車廠：小廠房 + 地上的維修位。站點中心放在離街道近的一側
  function buildService(b, type, cx, cz) {
    const g = new THREE.Group();
    g.position.set(cx, 0.25, cz);
    const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    box(38, 0.06, 38, 0, 0.03, 0, new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.9 }));
    if (type === 'gas') {
      const red = new THREE.MeshStandardMaterial({ color: 0xd8312a, roughness: 0.5 });
      const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
      box(20, 0.8, 13, 0, 6, 0, white); box(20.2, 0.35, 13.2, 0, 5.55, 0, red);
      for (const [x, z] of [[-8, -5], [8, -5], [-8, 5], [8, 5]]) box(0.5, 5.4, 0.5, x, 2.7, z, white);
      for (const x of [-4, 4]) { box(1.1, 1.7, 0.7, x, 0.85, 0, red); box(0.9, 0.5, 0.75, x, 1.45, 0, new THREE.MeshStandardMaterial({ color: 0x1b1d22 })); }
      const sign = new THREE.MeshStandardMaterial({ map: signTex(renderer, '加油站', '#d8312a'), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 });
      box(6, 1.5, 0.3, 12, 8, -14, sign); box(0.35, 8, 0.35, 12, 4, -14, white);
      signs.push(sign);
    } else {
      const wall = new THREE.MeshStandardMaterial({ color: 0x5a6470, roughness: 0.8 });
      box(24, 8, 14, 0, 4, 10, wall);
      box(10, 6, 0.4, 0, 3, 2.9, new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6 }));
      const sign = new THREE.MeshStandardMaterial({ map: signTex(renderer, '修車・烤漆', '#1f7cff'), emissive: 0xffffff, emissiveIntensity: 0 });
      box(12, 2, 0.3, 0, 9.4, 2.9, sign);
      signs.push(sign);
      b.buildings.push({ x0: cx - 12, x1: cx + 12, z0: cz + 3, z1: cz + 17 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3dc8ff, transparent: true, opacity: 0.8 }));
      ring.position.set(0, 0.1, -6);
      g.add(ring);
    }
    group.add(g);
    services.push({ type, x: cx, z: type === 'gas' ? cz : cz - 6 });
  }
  const services = [];
  for (let bi = 0; bi < GRID; bi++) for (let bj = 0; bj < GRID; bj++) {
    const x0 = node(bi) + ROAD / 2, x1 = node(bi + 1) - ROAD / 2;
    const z0 = node(bj) + ROAD / 2, z1 = node(bj + 1) - ROAD / 2;
    const dc = Math.hypot(bi + 0.5 - centerI, bj + 0.5 - centerI);
    blocks.push({ x0, x1, z0, z1, park: Math.random() < 0.12 && dc > 1, dc, buildings: [] });
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
  const litPattern = Array.from({ length: 32 }, () => Math.random() < 0.32);
  const drawWindows = night => (g, w, h) => {
    g.fillStyle = night ? '#000' : '#d9d6cf'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
      const lit = litPattern[r * 8 + c];
      if (night && !lit) continue;
      g.fillStyle = night ? '#fff' : '#2c3a4a';
      g.fillRect(c * 32 + 5, r * 56 + 10, 22, 36);
      if (!night) { g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(c * 32 + 5, r * 56 + 10, 22, 6); }
    }
    if (!night) { g.fillStyle = '#6b6b6b'; g.fillRect(0, h - 4, 4, 4); }
  };
  const winTex = canvasTex(renderer, 256, 224, drawWindows(false));
  const litTex = canvasTex(renderer, 256, 224, drawWindows(true));
  const HEIGHTS = [12, 20, 30, 44, 62, 86];
  const LOT = 40;
  const bmat = new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: litTex, emissive: 0xffd08a, emissiveIntensity: 0, roughness: 0.7, metalness: 0.1 });
  const variants = HEIGHTS.map(h => {
    const geo = new THREE.BoxGeometry(LOT, h, LOT).translate(0, h / 2, 0);
    // 讓窗戶大小一致：依建築尺寸縮放 UV；屋頂（+y 面）指到貼圖左下角的屋頂色
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      const face = Math.floor(k / 4);
      if (face === 2 || face === 3) uv.setXY(k, 0.01, 0.01);
      else uv.setXY(k, uv.getX(k) * LOT / 16, uv.getY(k) * h / 14);
    }
    const im = new THREE.InstancedMesh(geo, bmat, blocks.length * 4);
    im.castShadow = im.receiveShadow = true;
    im.count = 0;
    group.add(im);
    return im;
  });
  const PALETTE = [0xe8e2d6, 0xc9b49a, 0xa9b6c4, 0xd4a58a, 0x9fa7ad, 0xe3cfa8, 0x8fa9c2];
  const trees = [];
  {
    const pool = blocks.filter(b => !b.park && b.dc > 0.8 && b.dc < 4.2).sort(() => Math.random() - 0.5);
    ['gas', 'gas', 'gas', 'repair', 'repair'].forEach((type, k) => { pool[k].service = type; });
  }
  for (const b of blocks) {
    if (b.park) {
      for (let k = 0; k < 14; k++) trees.push([b.x0 + 8 + Math.random() * (BLOCK - 16), b.z0 + 8 + Math.random() * (BLOCK - 16)]);
      continue;
    }
    for (let lx = 0; lx < 2; lx++) for (let lz = 0; lz < 2; lz++) {
      const cx = b.x0 + 3 + LOT / 2 + lx * (LOT + 4), cz = b.z0 + 3 + LOT / 2 + lz * (LOT + 4);
      if (b.service && lx === 0 && lz === 0) { buildService(b, b.service, cx, cz); continue; }
      // 越靠市中心越高
      const tall = Math.max(0, 1 - b.dc / 5);
      const hi = Math.min(HEIGHTS.length - 1, Math.floor(Math.random() * 3 + tall * 4));
      const im = variants[hi];
      const sx = 0.8 + Math.random() * 0.2, sz = 0.8 + Math.random() * 0.2;
      m4.compose(p3.set(cx, 0.25, cz), q.identity(), sc.set(sx, 1, sz));
      im.setMatrixAt(im.count, m4);
      b.buildings.push({ x0: cx - LOT / 2 * sx, x1: cx + LOT / 2 * sx, z0: cz - LOT / 2 * sz, z1: cz + LOT / 2 * sz });
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

  // ---- 路燈：每個街區四個角各一支，夜晚亮起並在地上投出光暈 ----
  const lampPos = [];
  for (const b of blocks) for (const [x, z, dx, dz] of [[b.x0, b.z0, -1, -1], [b.x1, b.z0, 1, -1], [b.x0, b.z1, -1, 1], [b.x1, b.z1, 1, 1]])
    lampPos.push([x - dx * 1.4, z - dz * 1.4, dx, dz]);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6).translate(0, 3.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.6, roughness: 0.5 }), lampPos.length);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.22, 0.5), lampMat, lampPos.length);
  const poolTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,220,160,1)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), poolMat, lampPos.length);
  lampPos.forEach(([x, z, dx, dz], i) => {
    poles.setMatrixAt(i, m4.makeTranslation(x, 0.25, z));
    heads.setMatrixAt(i, m4.makeTranslation(x + dx * 1.2, 7.1, z + dz * 1.2));
    pools.setMatrixAt(i, m4.makeTranslation(x + dx * 3, 0.1, z + dz * 3));
  });
  poles.castShadow = true;
  pools.renderOrder = 2;
  group.add(poles, heads, pools);

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

  // (x, z) 所在的街區（人行道範圍），不在街區上回傳 null
  const blockOf = (x, z) => {
    const bi = Math.floor((x - O) / CELL), bj = Math.floor((z - O) / CELL);
    if (bi < 0 || bj < 0 || bi >= GRID || bj >= GRID) return null;
    const b = blocks[bi * GRID + bj];
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 ? b : null;
  };
  // 是否在建築物裡（留 margin 公尺的邊）
  const inBuilding = (x, z, margin = 0) => {
    const b = blockOf(x, z);
    return !!b && b.buildings.some(k => x > k.x0 - margin && x < k.x1 + margin && z > k.z0 - margin && z < k.z1 + margin);
  };

  return {
    def: CITY, group, isCity: true, blockOf, inBuilding, grip: 1, sunDir,
    center: new THREE.Vector3(0, 0, 0),
    bounds: { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge },
    grid: GRID, cell: CELL, road: ROAD, origin: O, edge, node, blocks, blockAt,
    spawn: { x: node(GRID / 2) - 3.5, z: node(GRID / 2) - CELL / 2, h: 0 },
    services,
    // 夜晚程度 0~1：窗戶、路燈、招牌亮起
    setNight(n) {
      bmat.emissiveIntensity = n * 1.1;
      lampMat.emissiveIntensity = n * 3;
      poolMat.opacity = n * 0.55;
      for (const m of signs) m.emissiveIntensity = n * 0.6;
    },
    dispose() {
      group.traverse(o => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) { m.map?.dispose(); m.dispose(); }
      });
    }
  };
}
