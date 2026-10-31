import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 程式生成的跑車模型：側面輪廓擠出成車身，車頭朝 +z

export const WHEEL_R = 0.38;
const AXLE_Z = 1.38, TRACK_X = 0.9;

// points：從車頭底部沿上緣畫到車尾底部；arches：[中心 x, 半徑]，由車尾往車頭排
function extrudeSide(points, width, bevel, arches = []) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  for (const [cx, r] of arches) {
    shape.lineTo(cx - r, points[0][1]);
    shape.absarc(cx, WHEEL_R, r, Math.PI, 0, true);
    shape.lineTo(cx + r, points[0][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 4, curveSegments: 18, steps: 1
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// 四種車身風格：輪廓點、寬度、燈具與尾翼位置
export const STYLES = {
  gt: {
    body: [[2.26, 0.3], [2.38, 0.48], [2.32, 0.66], [1.75, 0.86], [0.9, 0.98], [-1.2, 1.0], [-2.05, 1.04], [-2.34, 0.98], [-2.38, 0.6], [-2.28, 0.3]], width: 2.0,
    cabin: [[0.95, 0.94], [-0.05, 1.38], [-0.95, 1.4], [-1.8, 1.0], [-1.6, 0.94]], cabinW: 1.66,
    roof: [[-0.08, 1.4], [-0.95, 1.42], [-0.95, 1.47], [-0.08, 1.45]], roofW: 1.52,
    head: [0.58, 2.38], tail: [0.86, -2.45], wing: { y: 1.3, w: 1.9, d: 0.42, base: 1.04 }, scoop: 0.98,
  },
  blade: {
    body: [[2.3, 0.28], [2.42, 0.42], [2.34, 0.56], [1.7, 0.74], [0.85, 0.86], [-1.2, 0.9], [-2.1, 0.94], [-2.36, 0.9], [-2.4, 0.55], [-2.28, 0.28]], width: 1.96,
    cabin: [[0.85, 0.84], [-0.15, 1.2], [-0.95, 1.22], [-1.75, 0.9], [-1.55, 0.84]], cabinW: 1.6,
    roof: [[-0.18, 1.22], [-0.95, 1.24], [-0.95, 1.28], [-0.18, 1.26]], roofW: 1.46,
    head: [0.5, 2.4], tail: [0.8, -2.47], wing: { y: 1.12, w: 1.7, d: 0.36, base: 0.94 }, scoop: 0.86,
  },
  muscle: {
    body: [[2.32, 0.32], [2.44, 0.6], [2.36, 0.86], [0.7, 0.98], [-1.5, 1.0], [-2.3, 1.02], [-2.44, 0.92], [-2.46, 0.34]], width: 2.08,
    cabin: [[0.6, 0.96], [-0.15, 1.44], [-1.1, 1.46], [-1.85, 1.02], [-1.7, 0.96]], cabinW: 1.72,
    roof: [[-0.18, 1.45], [-1.1, 1.47], [-1.1, 1.52], [-0.18, 1.5]], roofW: 1.56,
    head: [0.72, 2.44], tail: [0.85, -2.53], wing: null, ducktail: 1.06, scoop: 1.02, bigScoop: true,
  },
  hyper: {
    body: [[2.48, 0.26], [2.58, 0.4], [2.44, 0.52], [1.65, 0.66], [0.75, 0.8], [-1.3, 0.86], [-2.2, 0.9], [-2.48, 0.86], [-2.52, 0.5], [-2.42, 0.26]], width: 2.06,
    cabin: [[0.95, 0.78], [0.05, 1.15], [-0.85, 1.17], [-1.95, 0.86], [-1.75, 0.8]], cabinW: 1.56,
    roof: [[0.02, 1.16], [-0.85, 1.18], [-0.85, 1.22], [0.02, 1.2]], roofW: 1.4,
    head: [0.5, 2.52], tail: [0.76, -2.57], wing: { y: 1.42, w: 2.1, d: 0.5, base: 0.9 }, scoop: 0.8,
  },
};

const GEO = {
  tire: new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 28).rotateZ(Math.PI / 2),
  rim: new THREE.CylinderGeometry(WHEEL_R * 0.66, WHEEL_R * 0.66, 0.36, 24).rotateZ(Math.PI / 2),
  spoke: new THREE.BoxGeometry(0.05, WHEEL_R * 1.2, 0.07),
  disc: new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.04, 20).rotateZ(Math.PI / 2),
  caliper: new THREE.BoxGeometry(0.1, 0.16, 0.22),
  box: new THREE.BoxGeometry(1, 1, 1),
  flame: new THREE.ConeGeometry(0.16, 1.3, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.65),
  shadow: new THREE.PlaneGeometry(2.6, 5.2).rotateX(-Math.PI / 2),
};

// 依高度把車身往內收（與高度成線性，側面維持平面，陰影不會出現折痕）
const clamp01 = v => Math.max(0, Math.min(1, v));
function taper(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * fn(p.getY(i)));
  geo.computeVertexNormals();
  return geo;
}
const styleGeo = {};
function geoFor(name) {
  if (styleGeo[name]) return styleGeo[name];
  const st = STYLES[name];
  const top = Math.max(...st.cabin.map(p => p[1])), belt = Math.min(...st.cabin.map(p => p[1]));
  styleGeo[name] = {
    body: taper(extrudeSide(st.body, st.width, 0.1, [[-AXLE_Z, 0.47], [AXLE_Z, 0.47]]), y => 1 - 0.13 * (y - 0.3) / 0.75),
    cabin: taper(extrudeSide(st.cabin, st.cabinW, 0.09), y => 1 - 0.24 * clamp01((y - belt) / (top - belt))),
    roof: taper(extrudeSide(st.roof, st.roofW, 0.04), () => 0.78),
  };
  return styleGeo[name];
}

const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 64, 4, 32, 64, 60);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.save(); g.scale(1, 1); g.fillRect(0, 0, 64, 128); g.restore();
  return new THREE.CanvasTexture(c);
})();

// 卡鉗與煞車碟共用一個材質（用頂點顏色區分），才能合併成同一個物件
function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
tint(GEO.disc, 0x777777);
tint(GEO.caliper, 0xffc400);

// 效能：把同一個群組裡、材質相同的零件合併成一個物件，一台車從 60 個繪製呼叫降到約 19 個
function mergeByMaterial(group) {
  const byMat = new Map();
  for (const m of group.children) if (m.isMesh) {
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(m);
  }
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      m.updateMatrix();
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.clearGroups();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      return g.applyMatrix4(m.matrix);
    });
    const merged = new THREE.Mesh(mergeGeometries(geos), mat);
    merged.castShadow = true;
    for (const m of list) group.remove(m);
    group.add(merged);
  }
}

const MAT = {
  black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 1, roughness: 0.22 }),
  brake: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1018, metalness: 0.2, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.88 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 1.1 }),
  flame: new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  shadow: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
};

export function makeCar(color, styleName = 'gt') {
  const st = STYLES[styleName] || STYLES.gt;
  const G = geoFor(styleName in STYLES ? styleName : 'gt');
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.25, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08
  });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });

  const mesh = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, parent = chassis) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  mesh(G.body, paint);
  mesh(G.cabin, MAT.glass);
  mesh(G.roof, paint);
  const [headY, headZ] = st.head, [tailY, tailZ] = st.tail;
  // 車頭 / 車尾細節
  mesh(GEO.box, MAT.black, 0, 0.42, headZ + 0.04, 1.1, 0.16, 0.1);          // 進氣口
  mesh(GEO.box, MAT.black, 0, 0.36, tailZ + 0.01, 1.6, 0.16, 0.12);         // 擴散器
  mesh(GEO.box, MAT.black, 0, 0.29, 0, 1.96, 0.08, 4.3);                    // 底盤
  if (st.bigScoop) mesh(GEO.box, MAT.black, 0, st.scoop + 0.08, 1.1, 0.6, 0.18, 0.8);  // 大型進氣罩
  else mesh(GEO.box, MAT.black, 0, st.scoop, 1.2, 0.5, 0.03, 0.6);          // 引擎蓋進氣
  for (const s of [-1, 1]) {
    if (styleName === 'muscle') mesh(GEO.box, MAT.head, s * 0.62, headY, headZ, 0.32, 0.18, 0.1);
    else mesh(GEO.box, MAT.head, s * 0.6, headY, headZ, 0.46, 0.08, 0.16).rotation.y = s * 0.32;
    mesh(GEO.box, tail, s * 0.52, tailY, tailZ, 0.62, 0.11, 0.08);
    mesh(GEO.box, MAT.chrome, s * 0.4, 0.4, tailZ - 0.03, 0.14, 0.12, 0.14);  // 排氣管
    mesh(GEO.box, paint, s * (st.width / 2 + 0.03), st.cabin[0][1] + 0.06, st.cabin[0][0] - 0.4, 0.14, 0.09, 0.2); // 後照鏡
    if (st.wing) mesh(GEO.box, MAT.black, s * 0.65, (st.wing.y + st.wing.base) / 2, tailZ + 0.45, 0.06, st.wing.y - st.wing.base, 0.1); // 尾翼支架
  }
  if (st.wing) mesh(GEO.box, MAT.black, 0, st.wing.y, tailZ + 0.37, st.wing.w, 0.05, st.wing.d);     // 尾翼
  if (st.ducktail) mesh(GEO.box, paint, 0, st.ducktail, tailZ + 0.2, st.width - 0.2, 0.06, 0.3);     // 鴨尾
  mesh(GEO.box, tail, 0, tailY, tailZ + 0.01, 0.5, 0.035, 0.06);                                     // 尾燈連桿

  // 車輪：pivot（轉向）→ spin（滾動）
  const wheels = [], pivots = [];
  for (const [x, z] of [[TRACK_X, AXLE_Z], [-TRACK_X, AXLE_Z], [TRACK_X, -AXLE_Z], [-TRACK_X, -AXLE_Z]]) {
    const piv = new THREE.Group(); piv.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group();
    const side = Math.sign(x);
    mesh(GEO.tire, MAT.tire, 0, 0, 0, 1, 1, 1, spin);
    mesh(GEO.rim, MAT.tire, 0, 0, 0, 1, 1, 1, spin).scale.x = 0.95;
    for (let k = 0; k < 5; k++) {
      const sp = mesh(GEO.spoke, MAT.rim, side * 0.17, 0, 0, 1, 1, 1, spin);
      sp.rotation.x = k * Math.PI * 2 / 5;
    }
    mesh(GEO.box, MAT.rim, side * 0.18, 0, 0, 0.04, 0.1, 0.1, spin);
    piv.add(spin);
    mesh(GEO.disc, MAT.brake, side * 0.06, 0, 0, 1, 1, 1, piv);
    mesh(GEO.caliper, MAT.brake, side * 0.1, 0.12, -0.12, 1, 1, 1, piv);
    mergeByMaterial(spin);
    mergeByMaterial(piv);
    root.add(piv);
    wheels.push(spin);
    if (z > 0) pivots.push(piv);
  }

  mergeByMaterial(chassis);

  const flames = [-0.45, 0.45].map(x => {
    const f = new THREE.Mesh(GEO.flame, MAT.flame);
    f.position.set(x, 0.4, tailZ - 0.1); f.visible = false;
    root.add(f);
    return f;
  });
  const shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, chassis, wheels, pivots, flames, tail, paint, style: styleName };
}

// 計時賽的幽靈車：半透明、不投影
export function makeGhost(styleName) {
  const g = makeCar(0x66ccff, styleName);
  g.root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.material = o.material.clone();
    Object.assign(o.material, { transparent: true, opacity: 0.32, depthWrite: false });
  });
  g.root.children.filter(o => o.geometry === GEO.shadow).forEach(o => o.removeFromParent());
  return g;
}
