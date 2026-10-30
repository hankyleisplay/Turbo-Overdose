import * as THREE from 'three';

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

const GEO = {
  body: extrudeSide([
    [2.26, 0.3], [2.38, 0.48], [2.32, 0.66], [1.75, 0.86], [0.9, 0.98], [-1.2, 1.0],
    [-2.05, 1.04], [-2.34, 0.98], [-2.38, 0.6], [-2.28, 0.3]
  ], 2.0, 0.1, [[-AXLE_Z, 0.47], [AXLE_Z, 0.47]]),
  cabin: extrudeSide([[0.95, 0.94], [-0.05, 1.38], [-0.95, 1.4], [-1.8, 1.0], [-1.6, 0.94]], 1.66, 0.09),
  roof: extrudeSide([[-0.08, 1.4], [-0.95, 1.42], [-0.95, 1.47], [-0.08, 1.45]], 1.52, 0.04),
  tire: new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 28).rotateZ(Math.PI / 2),
  rim: new THREE.CylinderGeometry(WHEEL_R * 0.66, WHEEL_R * 0.66, 0.36, 24).rotateZ(Math.PI / 2),
  spoke: new THREE.BoxGeometry(0.05, WHEEL_R * 1.2, 0.07),
  disc: new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.04, 20).rotateZ(Math.PI / 2),
  caliper: new THREE.BoxGeometry(0.1, 0.16, 0.22),
  box: new THREE.BoxGeometry(1, 1, 1),
  flame: new THREE.ConeGeometry(0.16, 1.3, 12).rotateX(-Math.PI / 2).translate(0, 0, -0.65),
  shadow: new THREE.PlaneGeometry(2.6, 5.2).rotateX(-Math.PI / 2),
};

// 依高度 / 前後位置把車身往內收，做出車頂內縮與尖車頭
const clamp01 = v => Math.max(0, Math.min(1, v));
function taper(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * fn(p.getY(i), p.getZ(i)));
  geo.computeVertexNormals();
}
// 只做與高度成線性的內收，側面維持平面，避免陰影出現折痕
taper(GEO.body, y => 1 - 0.13 * (y - 0.3) / 0.75);
taper(GEO.cabin, y => 1 - 0.24 * clamp01((y - 0.95) / 0.45));
taper(GEO.roof, () => 0.78);

const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 64, 4, 32, 64, 60);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.save(); g.scale(1, 1); g.fillRect(0, 0, 64, 128); g.restore();
  return new THREE.CanvasTexture(c);
})();

const MAT = {
  black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 1, roughness: 0.22 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.45 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1018, metalness: 0.2, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.88 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 1.1 }),
  flame: new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  shadow: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
};

export function makeCar(color) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.25, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08
  });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.4 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });

  const mesh = (geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, parent = chassis) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  mesh(GEO.body, paint);
  mesh(GEO.cabin, MAT.glass);
  mesh(GEO.roof, paint);
  // 車頭 / 車尾細節
  mesh(GEO.box, MAT.black, 0, 0.42, 2.42, 1.1, 0.16, 0.1);           // 進氣口
  mesh(GEO.box, MAT.black, 0, 0.36, -2.44, 1.6, 0.16, 0.12);         // 擴散器
  mesh(GEO.box, MAT.black, 0, 0.29, 0, 1.96, 0.08, 4.3);             // 底盤
  mesh(GEO.box, MAT.black, 0, 0.98, 1.2, 0.5, 0.03, 0.6);            // 引擎蓋進氣
  for (const s of [-1, 1]) {
    mesh(GEO.box, MAT.head, s * 0.6, 0.58, 2.38, 0.46, 0.08, 0.16).rotation.y = s * 0.32;
    mesh(GEO.box, tail, s * 0.52, 0.86, -2.45, 0.62, 0.11, 0.08);
    mesh(GEO.box, MAT.chrome, s * 0.4, 0.4, -2.48, 0.14, 0.12, 0.14);   // 排氣管
    mesh(GEO.box, paint, s * 1.03, 1.0, 0.55, 0.14, 0.09, 0.2);       // 後照鏡
    mesh(GEO.box, MAT.black, s * 0.65, 1.15, -2.0, 0.06, 0.26, 0.1);  // 尾翼支架
  }
  mesh(GEO.box, MAT.black, 0, 1.3, -2.08, 1.9, 0.05, 0.42);           // 尾翼
  mesh(GEO.box, tail, 0, 0.86, -2.44, 0.5, 0.035, 0.06);             // 尾燈連桿

  // 車輪：pivot（轉向）→ spin（滾動）
  const wheels = [], pivots = [];
  for (const [x, z] of [[TRACK_X, AXLE_Z], [-TRACK_X, AXLE_Z], [TRACK_X, -AXLE_Z], [-TRACK_X, -AXLE_Z]]) {
    const piv = new THREE.Group(); piv.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group();
    const side = Math.sign(x);
    mesh(GEO.tire, MAT.tire, 0, 0, 0, 1, 1, 1, spin);
    mesh(GEO.rim, MAT.black, 0, 0, 0, 1, 1, 1, spin).scale.x = 0.95;
    for (let k = 0; k < 5; k++) {
      const sp = mesh(GEO.spoke, MAT.rim, side * 0.17, 0, 0, 1, 1, 1, spin);
      sp.rotation.x = k * Math.PI * 2 / 5;
    }
    mesh(GEO.box, MAT.rim, side * 0.18, 0, 0, 0.04, 0.1, 0.1, spin);
    piv.add(spin);
    mesh(GEO.disc, MAT.disc, side * 0.06, 0, 0, 1, 1, 1, piv);
    mesh(GEO.caliper, caliperMat, side * 0.1, 0.12, -0.12, 1, 1, 1, piv);
    root.add(piv);
    wheels.push(spin);
    if (z > 0) pivots.push(piv);
  }

  const flames = [-0.45, 0.45].map(x => {
    const f = new THREE.Mesh(GEO.flame, MAT.flame);
    f.position.set(x, 0.4, -2.55); f.visible = false;
    root.add(f);
    return f;
  });
  const shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  root.add(shadow);

  return { root, chassis, wheels, pivots, flames, tail, paint };
}
