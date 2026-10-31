import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ================= 天空與環境反射 =================
// 每條賽道切換時呼叫 set()，更新天空參數並重新產生環境反射貼圖
export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(3500);
    scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    this.envGround.position.y = -5;
    this.envScene.add(this.envSky, this.envGround);
    this.env = null;
    // 低畫質用：把天空預先畫進立方體貼圖當背景，省掉每一格都算一次大氣散射
    this.bgScene = new THREE.Scene();
    this.bgSky = new Sky();
    this.bgSky.scale.setScalar(1000);
    this.bgScene.add(this.bgSky);
    this.bgRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(1, 3000, this.bgRT);
    this.cheap = false;
  }
  setCheap(on) {
    this.cheap = on;
    this.sky.visible = !on;
    this.scene.background = on ? this.bgRT.texture : null;
  }
  set(sky, sunDir, groundColor) {
    for (const s of [this.sky, this.envSky, this.bgSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = sky.turbidity;
      u.rayleigh.value = sky.rayleigh;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.85;
      u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
    }
    this.envGround.material.color.set(groundColor);
    this.env?.dispose();
    this.env = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.env.texture;
    this.cubeCam.update(this.renderer, this.bgScene);
    this.scene.environmentIntensity = 0.9;
  }
}

// ================= 後製 =================
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },      // 徑向模糊強度
    vignette: { value: 0.35 },
    aberration: { value: 0 },
    saturation: { value: 1 },
    contrast: { value: 1 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette; uniform float aberration;
    uniform float saturation; uniform float contrast; uniform vec3 tint;
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
      float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(vec3(l), col.rgb, saturation);
      col.rgb = max(vec3(0.0), (col.rgb - 0.18) * contrast + 0.18) * tint;
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
// 所有煙霧粒子用一個 Points 物件畫完（一次繪製呼叫），手機上比一個粒子一個 Sprite 快很多
export class Smoke {
  constructor(scene, renderer, max = 160) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.renderer = renderer;
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3).fill(-9999);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max); this.op = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    const attr = (name, arr, n) => geo.setAttribute(name, new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage));
    attr('position', this.pos, 3); attr('pcolor', this.col, 3); attr('alpha', this.alpha, 1); attr('size', this.size, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: new THREE.CanvasTexture(c) }, scale: { value: 400 } },
      vertexShader: `attribute vec3 pcolor; attribute float alpha; attribute float size; uniform float scale;
        varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(size * projectionMatrix[1][1] * scale / -mv.z, 512.0); vC = pcolor; vA = alpha; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.tmpC = new THREE.Color();
  }
  emit(pos, color, size = 1.2, opacity = 0.5, vel) {
    const i = this.i++ % this.max, o = i * 3;
    this.pos[o] = pos.x; this.pos[o + 1] = pos.y; this.pos[o + 2] = pos.z;
    const c = this.tmpC.set(color);
    this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
    this.life[i] = this.maxLife[i] = 0.9 + Math.random() * 0.8;
    this.vel[o] = (Math.random() - 0.5) * 2 + (vel ? vel.x * 0.25 : 0);
    this.vel[o + 1] = 0.8 + Math.random() * 1.4;
    this.vel[o + 2] = (Math.random() - 0.5) * 2 + (vel ? vel.z * 0.25 : 0);
    this.base[i] = size; this.op[i] = opacity;
  }
  update(dt) {
    let any = false;
    const damp = Math.exp(-1.5 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.pos[o + 1] = -9999; continue; }
      const k = 1 - this.life[i] / this.maxLife[i];
      for (let j = 0; j < 3; j++) { this.vel[o + j] *= damp; this.pos[o + j] += this.vel[o + j] * dt; }
      this.size[i] = this.base[i] + k * 5;
      this.alpha[i] = this.op[i] * (1 - k) * Math.min(1, k * 8);
    }
    if (!any && !this.dirty) return;
    this.dirty = any;
    this.mat.uniforms.scale.value = this.renderer.getDrawingBufferSize(this.tmpV ??= new THREE.Vector2()).y / 2;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = true;
  }
}
