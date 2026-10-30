import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ================= 賽道定義 =================
export const ROAD_W = 18, HALF = ROAD_W / 2, CURB = 1.6, WALL = HALF + 9;
export const N = 1400;          // 賽道取樣點數
export const ROAD_Y = 0.08;

export const TRACKS = [
  {
    id: 'valley', name: '翠綠山谷', desc: '中高速彎道與長直線，最適合熟悉車輛',
    ctrl: [
      [0, 220], [0, 0], [0, -120], [40, -240], [150, -310], [290, -280], [340, -160], [270, -80],
      [180, -60], [150, 30], [230, 110], [350, 130], [420, 230], [380, 360], [250, 410], [120, 420],
      [30, 380], [0, 300]
    ],
    theme: {
      sky: { turbidity: 2.5, rayleigh: 2.2, elevation: 25, azimuth: 55 },
      exposure: 0.5, sun: [0xfff0d8, 4.4], hemi: [0xbfd9ff, 0x3a5228, 0.7], fog: [0x9fbbd8, 500, 2600],
      ground: ['#4f8a33', [60, 110, 40], [40, 50, 25]], runoff: ['#cbb68a', [180, 160, 120], [40, 40, 40]],
      wall: ['#f4f4f4', '#1f5fd0'], flora: 'pine', hills: 'peaks', grip: 1, envGround: 0x3d5a2a,
    }
  },
  {
    id: 'desert', name: '赤岩峽谷', desc: '超長直線接髮夾彎，煞車點決定勝負',
    ctrl: [
      [0, 300], [0, -200], [60, -300], [180, -300], [220, -200], [160, -80], [200, 20], [340, 0],
      [440, -80], [540, -20], [560, 120], [460, 220], [300, 200], [200, 300], [120, 400], [40, 420]
    ],
    theme: {
      sky: { turbidity: 7, rayleigh: 1.4, elevation: 11, azimuth: 205 },
      exposure: 0.56, sun: [0xffc48a, 4.2], hemi: [0xffd6a8, 0x8a5a30, 0.75], fog: [0xd9b08a, 450, 2400],
      ground: ['#c98a52', [190, 130, 80], [40, 30, 25]], runoff: ['#e0c08f', [215, 185, 140], [30, 30, 30]],
      wall: ['#f4f4f4', '#d13b1f'], flora: 'cactus', hills: 'mesas', grip: 0.97, envGround: 0x9a6a40,
    }
  },
  {
    id: 'snow', name: '冰封雪嶺', desc: '連續彎加上低抓地雪地，技術賽道',
    ctrl: [
      [0, 150], [0, -150], [-40, -250], [-140, -290], [-240, -230], [-230, -120], [-140, -70],
      [-120, 40], [-210, 90], [-300, 190], [-240, 310], [-110, 330], [-40, 260]
    ],
    theme: {
      sky: { turbidity: 1.6, rayleigh: 3, elevation: 17, azimuth: 300 },
      exposure: 0.42, sun: [0xffffff, 4.0], hemi: [0xdfeaff, 0xb8c4d2, 0.8], fog: [0xd6e2ee, 350, 2200],
      ground: ['#e9eff5', [225, 232, 240], [20, 18, 14]], runoff: ['#cdd6e0', [200, 210, 222], [20, 18, 14]],
      wall: ['#f4f4f4', '#202833'], flora: 'snowpine', hills: 'snowpeaks', grip: 0.86, envGround: 0xd8e2ec,
    }
  },
];
export const trackById = id => TRACKS.find(t => t.id === id) || TRACKS[0];

// ================= 工具 =================
function canvasTex(renderer, w, h, draw, repeat) {
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
// 底色 + 隨機顆粒：base 為底色，lo/span 為顆粒 RGB 的下限與變化範圍
function speckle(g, w, h, base, lo, span, n) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const k = Math.random();
    g.fillStyle = `rgb(${lo[0] + k * span[0] | 0},${lo[1] + k * span[1] | 0},${lo[2] + k * span[2] | 0})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

// ================= 建立世界 =================
export function buildWorld(def, renderer) {
  const th = def.theme;
  const group = new THREE.Group();
  const tex = f => canvasTex(renderer, ...f);

  // ---- 中心線取樣 ----
  const curve = new THREE.CatmullRomCurve3(def.ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const P = curve.getSpacedPoints(N); P.pop();
  const L = curve.getLength(), ds = L / N;
  const T = [], NR = [];
  for (let i = 0; i < N; i++) {
    const t = P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize();
    T.push(t);
    NR.push(new THREE.Vector3(-t.z, 0, t.x)); // 行進方向的右側
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const distToTrack = (x, z, step = 5) => {
    let m = Infinity;
    for (let i = 0; i < N; i += step) { const dx = x - P[i].x, dz = z - P[i].z; m = Math.min(m, dx * dx + dz * dz); }
    return Math.sqrt(m);
  };

  // ---- 貼圖 ----
  const roadTex = tex([256, 512, (g, w, h) => {
    speckle(g, w, h, '#3b3e44', [48, 48, 52], [36, 36, 36], 9000);
    g.fillStyle = '#eeeeee';
    g.fillRect(8, 0, 7, h); g.fillRect(w - 15, 0, 7, h);
    g.fillStyle = '#f5d33a';
    g.fillRect(w / 2 - 4, 0, 8, h * 0.5);
  }]);
  const curbTex = tex([32, 64, (g, w, h) => {
    g.fillStyle = '#d42020'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f4f4f4'; g.fillRect(0, h / 2, w, h / 2);
  }]);
  const wallTex = tex([64, 64, (g, w, h) => {
    g.fillStyle = th.wall[0]; g.fillRect(0, 0, w, h);
    g.fillStyle = th.wall[1]; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#222'; g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
  }]);
  const groundTex = tex([256, 256, (g, w, h) => speckle(g, w, h, th.ground[0], th.ground[1], th.ground[2], 7000), 400]);
  const runoffTex = tex([128, 128, (g, w, h) => speckle(g, w, h, th.runoff[0], th.runoff[1], th.runoff[2], 3000)]);
  const checkerTex = tex([64, 64, (g) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }]);

  // ---- 路面幾何 ----
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
  const add = (geo, mat, { shadow = false, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = receive;
    group.add(m);
    return m;
  };

  add(flat(-HALF, HALF, ROAD_Y, 24), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, envMapIntensity: 0.5 }));
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
  add(flat(-HALF - CURB, -HALF, ROAD_Y + 0.02, 4), curbMat);
  add(flat(HALF, HALF + CURB, ROAD_Y + 0.02, 4), curbMat);
  const runoffMat = new THREE.MeshStandardMaterial({ map: runoffTex, roughness: 1 });
  add(flat(-WALL, -HALF - CURB, 0.04, 10), runoffMat);
  add(flat(HALF + CURB, WALL, 0.04, 10), runoffMat);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.DoubleSide, roughness: 0.6 });
  add(wallGeo(-WALL, 1.1, 6), wallMat, { shadow: true });
  add(wallGeo(WALL, 1.1, 6), wallMat, { shadow: true });
  const ground = add(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;

  // ---- 起跑線與拱門 ----
  const startHeading = Math.atan2(T[0].x, T[0].z);
  {
    const lineTex = checkerTex.clone(); lineTex.repeat.set(6, 1); lineTex.needsUpdate = true;
    const line = add(new THREE.PlaneGeometry(ROAD_W, 3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: lineTex }));
    line.position.copy(P[0]).setY(ROAD_Y + 0.03);
    line.rotation.y = startHeading;

    const gantry = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.7, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), metal);
      post.position.set(s * (HALF + 3), 4.5, 0); post.castShadow = true;
      gantry.add(post);
    }
    const banner = tex([1024, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#ff5a1f'); gr.addColorStop(1, '#ff2d6f');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.font = 'italic 900 84px Arial Black, Arial'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TURBO OVERDOSE', w / 2, h / 2 + 4);
    }]);
    banner.wrapS = banner.wrapT = THREE.ClampToEdgeWrapping;
    const bannerMat = new THREE.MeshStandardMaterial({ map: banner });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 7, 2.4, 0.8), [metal, metal, metal, metal, bannerMat, bannerMat]);
    beam.position.y = 9.5; beam.castShadow = true;
    gantry.add(beam);
    gantry.position.copy(P[0]);
    gantry.rotation.y = startHeading + Math.PI;
    group.add(gantry);
  }

  // ---- 看台：放在起跑直線離其他賽段較遠的那一側 ----
  {
    const side = distToTrack(P[0].x - NR[0].x * 45, P[0].z - NR[0].z * 45) >= distToTrack(P[0].x + NR[0].x * 45, P[0].z + NR[0].z * 45) ? 1 : -1;
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.9 });
    const stand = new THREE.Group();
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 600);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let n = 0;
    for (let t = 0; t < 5; t++) {
      const x = side * (WALL + 5 + t * 3);
      const tier = new THREE.Mesh(new THREE.BoxGeometry(3, 1 + t * 1.2, 100), tierMat);
      tier.position.set(x, (1 + t * 1.2) / 2, 0);
      tier.castShadow = tier.receiveShadow = true;
      stand.add(tier);
      for (let z = -48; z <= 48 && n < 600; z += 0.9) {
        if (Math.random() < 0.25) continue;
        m.makeTranslation(x + (Math.random() - 0.5), 1 + t * 1.2 + 0.55, z);
        crowd.setMatrixAt(n, m);
        crowd.setColorAt(n, c.setHSL(Math.random(), 0.7, 0.55));
        n++;
      }
    }
    crowd.count = n;
    stand.add(crowd);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 104), new THREE.MeshStandardMaterial({ color: 0xff5a1f }));
    roof.position.set(side * (WALL + 11), 10, 0); roof.castShadow = true;
    stand.add(roof);
    stand.position.copy(P[0]);
    stand.rotation.y = startHeading; // 本地 +x 為行進方向左側
    group.add(stand);
  }

  // ---- 植物 / 岩石 ----
  const scatter = (count, minDist, place) => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0, tries = 0;
    while (n < count && tries++ < count * 30) {
      const x = minX - 400 + Math.random() * (maxX - minX + 800);
      const z = minZ - 400 + Math.random() * (maxZ - minZ + 800);
      if (distToTrack(x, z) < minDist) continue;
      const dx = x - P[0].x, dz = z - P[0].z;
      if (Math.abs(dx * NR[0].x + dz * NR[0].z) < WALL + 40 && Math.abs(dx * T[0].x + dz * T[0].z) < 70) continue; // 看台區
      const k = 0.7 + Math.random();
      m.compose(p.set(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * 6.28), s.set(k, k * (0.8 + Math.random() * 0.5), k));
      place(n, m, k);
      n++;
    }
    return n;
  };
  const instanced = (geo, mat, count) => {
    const im = new THREE.InstancedMesh(geo, mat, count);
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
    return im;
  };
  const col = new THREE.Color();
  if (th.flora === 'pine' || th.flora === 'snowpine') {
    const TN = 650;
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 6).translate(0, 1.5, 0);
    const leafGeo = new THREE.ConeGeometry(3, 8, 7).translate(0, 7, 0);
    const trunks = instanced(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b }), TN);
    const leaves = instanced(leafGeo, new THREE.MeshStandardMaterial({ flatShading: true }), TN);
    const snowy = th.flora === 'snowpine';
    const caps = snowy ? instanced(new THREE.ConeGeometry(2.1, 4.2, 7).translate(0, 9.3, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), TN) : null;
    const n = scatter(TN, WALL + 8, (i, m) => {
      trunks.setMatrixAt(i, m); leaves.setMatrixAt(i, m); caps?.setMatrixAt(i, m);
      leaves.setColorAt(i, snowy ? col.setHSL(0.36, 0.25, 0.2 + Math.random() * 0.1) : col.setHSL(0.25 + Math.random() * 0.1, 0.55, 0.22 + Math.random() * 0.15));
    });
    trunks.count = leaves.count = n;
    if (caps) caps.count = n;
  } else if (th.flora === 'cactus') {
    // 仙人掌：主幹 + 兩隻手臂合成一個幾何
    const parts = [
      new THREE.CylinderGeometry(0.55, 0.6, 6, 8).translate(0, 3, 0),
      new THREE.SphereGeometry(0.55, 8, 6).translate(0, 6, 0),
      new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8).rotateZ(Math.PI / 2).translate(1.1, 2.6, 0),
      new THREE.CylinderGeometry(0.35, 0.35, 2.2, 8).translate(1.8, 3.6, 0),
      new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8).rotateZ(Math.PI / 2).translate(-0.9, 3.4, 0),
      new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8).translate(-1.4, 4.1, 0),
    ].map(g => g.toNonIndexed());
    const cactus = instanced(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x4d7f3a, roughness: 0.8 }), 260);
    cactus.count = scatter(260, WALL + 6, (i, m) => cactus.setMatrixAt(i, m));
    const rocks = instanced(new THREE.DodecahedronGeometry(2.4, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), 260);
    rocks.count = scatter(260, WALL + 6, (i, m) => {
      rocks.setMatrixAt(i, m);
      rocks.setColorAt(i, col.setHSL(0.05 + Math.random() * 0.03, 0.45, 0.35 + Math.random() * 0.15));
    });
  }

  // ---- 遠景：山峰 / 平頂岩山 ----
  {
    const snow = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
    const count = th.hills === 'mesas' ? 34 : 46;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.1;
      const r = 1250 + Math.random() * 400;
      const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
      let mesh, h;
      if (th.hills === 'mesas') {
        h = 90 + Math.random() * 200;
        const rad = 120 + Math.random() * 220;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.75, rad, h, 7), mat);
        mat.color.setHSL(0.04 + Math.random() * 0.04, 0.5, 0.36 + Math.random() * 0.12);
      } else {
        h = 180 + Math.random() * 320;
        const rad = 160 + Math.random() * 200;
        mesh = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 6 + (Math.random() * 3 | 0)), mat);
        if (th.hills === 'snowpeaks') mat.color.setHSL(0.58, 0.15, 0.62 + Math.random() * 0.12);
        else mat.color.setHSL(0.3 + Math.random() * 0.08, 0.2, 0.25 + Math.random() * 0.12);
        if (h > 360 || th.hills === 'snowpeaks') {
          const k = th.hills === 'snowpeaks' ? 0.45 : 0.28;
          const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * k, h * k, mesh.geometry.parameters.radialSegments), snow);
          cap.position.set(center.x + Math.cos(a) * r, h - 5 - h * k / 2 + 1, center.z + Math.sin(a) * r);
          group.add(cap);
        }
      }
      mesh.position.set(center.x + Math.cos(a) * r, h / 2 - 5, center.z + Math.sin(a) * r);
      group.add(mesh);
    }
  }

  const s = th.sky;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - s.elevation), THREE.MathUtils.degToRad(s.azimuth));

  return {
    def, group, P, T, NR, L, ds, center, bounds: { minX, maxX, minZ, maxZ }, startHeading, sunDir,
    grip: th.grip,
    dispose() {
      group.traverse(o => {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) { m.map?.dispose(); m.dispose(); }
      });
    }
  };
}
