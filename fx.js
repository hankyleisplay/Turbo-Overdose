import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ================= 天空與環境反射 =================
export function setupSky(renderer, scene, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(3500);
  const u = sky.material.uniforms;
  u.turbidity.value = 2.5;
  u.rayleigh.value = 2.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.85;
  u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  scene.add(sky);

  // 用天空產生環境貼圖，讓車漆、玻璃有反射
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envSky.material.uniforms.turbidity.value = 2.5;
  envSky.material.uniforms.rayleigh.value = 2.2;
  envSky.material.uniforms.sunPosition.value.copy(sunDir).multiplyScalar(1000);
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3d5a2a }));
  ground.position.y = -5;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.9;
  return sky;
}

// ================= 後製 =================
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },      // 徑向模糊強度
    vignette: { value: 0.35 },
    aberration: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette; uniform float aberration;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - vec2(0.5, 0.55);
      float d = length(dir);
      vec4 col = vec4(0.0);
      float k = amount * smoothstep(0.12, 0.7, d);
      for (int i = 0; i < 8; i++) {
        float t = float(i) / 7.0;
        vec2 off = dir * k * t * 0.08;
        col.r += texture2D(tDiffuse, vUv - off * (1.0 + aberration)).r;
        col.g += texture2D(tDiffuse, vUv - off).g;
        col.b += texture2D(tDiffuse, vUv - off * (1.0 - aberration)).b;
      }
      col /= 8.0;
      col.rgb *= 1.0 - vignette * smoothstep(0.35, 0.95, d * 1.25);
      gl_FragColor = vec4(col.rgb, 1.0);
    }`
};

export function setupPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.35, 1.8);
  composer.addPass(bloom);
  const speed = new ShaderPass(SpeedShader);
  composer.addPass(speed);
  composer.addPass(new OutputPass());
  return { composer, bloom, speed };
}

// ================= 胎痕 =================
export class SkidMarks {
  constructor(scene, max = 3000) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = [];
    for (let i = 0; i < max; i++) { const a = i * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      vertexShader: 'attribute float alpha; varying float a; void main(){ a = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float a; void main(){ gl_FragColor = vec4(0.04,0.04,0.045,a); }'
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = new Map();
  }
  // key：每個輪子一個；p：輪子位置；dir：前進方向（單位向量）；strength 0..1
  add(key, p, dir, strength, y) {
    const prev = this.last.get(key);
    if (strength <= 0.05) { this.last.delete(key); return; }
    const w = 0.17, rx = -dir.z * w, rz = dir.x * w;
    const cur = { l: [p.x - rx, p.z - rz], r: [p.x + rx, p.z + rz] };
    if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.6) return;
    if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) < 4) {
      const i = this.n % this.max, o = i * 12, a = Math.min(0.55, strength * 0.6);
      const v = [prev.l[0], y, prev.l[1], prev.r[0], y, prev.r[1], cur.l[0], y, cur.l[1], cur.r[0], y, cur.r[1]];
      this.pos.set(v, o);
      this.alpha.fill(a, i * 4, i * 4 + 4);
      this.n++;
      const g = this.mesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.alpha.needsUpdate = true;
    }
    this.last.set(key, { x: p.x, z: p.z, ...cur });
  }
  clear() {
    this.pos.fill(0); this.alpha.fill(0); this.n = 0; this.last.clear();
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
}

// ================= 火花 =================
export class Sparks {
  constructor(scene, max = 300) {
    this.max = max; this.i = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffb040, size: 0.35, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.p.fill(-9999);
  }
  emit(pos, vel, n = 12) {
    for (let k = 0; k < n; k++) {
      const i = this.i++ % this.max;
      this.p.set([pos.x, pos.y, pos.z], i * 3);
      this.v.set([vel.x * 0.4 + (Math.random() - 0.5) * 10, 2 + Math.random() * 5, vel.z * 0.4 + (Math.random() - 0.5) * 10], i * 3);
      this.life[i] = 0.3 + Math.random() * 0.4;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) { this.p[o + 1] = -9999; continue; }
      this.v[o + 1] -= 18 * dt;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      if (this.p[o + 1] < 0.1) { this.p[o + 1] = 0.1; this.v[o + 1] *= -0.4; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// ================= 煙霧 / 揚塵 =================
export class Smoke {
  constructor(scene, max = 160) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.list = [];
    for (let i = 0; i < max; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; scene.add(sp);
      this.list.push({ sp, life: 0, max: 1, v: new THREE.Vector3(), size: 1, op: 0.5 });
    }
    this.i = 0;
  }
  emit(pos, color, size = 1.2, opacity = 0.5, vel) {
    const p = this.list[this.i++ % this.list.length];
    p.sp.position.copy(pos);
    p.sp.material.color.set(color);
    p.life = p.max = 0.9 + Math.random() * 0.8;
    p.v.set((Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 2);
    if (vel) p.v.addScaledVector(vel, 0.25);
    p.size = size; p.op = opacity;
    p.sp.material.rotation = Math.random() * 6.28;
    p.sp.visible = true;
  }
  update(dt) {
    for (const p of this.list) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; continue; }
      const k = 1 - p.life / p.max;
      p.v.multiplyScalar(Math.exp(-1.5 * dt));
      p.sp.position.addScaledVector(p.v, dt);
      p.sp.scale.setScalar(p.size + k * 5);
      p.sp.material.opacity = p.op * (1 - k) * Math.min(1, k * 8);
    }
  }
}
