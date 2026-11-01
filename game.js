import * as THREE from 'three';
import { Vehicle, SPEC, corneringSpeed } from './physics.js';
import { makeCar, makeGhost, WHEEL_R, setHeadlights } from './car.js';
import { SkySystem, setupPost, SkidMarks, Sparks, Smoke } from './fx.js';
import { Music } from './music.js';
import { connect, onlineAvailable, onlineLocal } from './net.js';
import { buildCity, CITY } from './city.js';
import { createOpenWorld } from './openworld.js';
import { icon, fillIcons } from './icons.js';
import { TRACKS, trackById, buildWorld, HALF, CURB, WALL, N, ROAD_Y } from './tracks.js';
import {
  CARS, carById, UPGRADES, MAX_LEVEL, upgradeCost, buildSpec, CUPS, POINTS, PRIZE, DIFF_PAY, DIFF_NAME, TT_REWARD,
  loadProfile, saveProfile, loadGhost, saveGhost
} from './data.js';

// ================= 基本設定 =================
const LAPS = 3;
const CAR_R = 1.6;              // 碰撞半徑
const REF_SPEED = 80;           // 用於速度感效果的參考速度 (m/s)
const COLORS = [0xd81e1e, 0x1f6dff, 0xffbf00, 0x18b85a, 0x9b3dff, 0xff6a10, 0xf2f2f2, 0x1b1d22];
const AI_NAMES = ['Blaze', 'Nova', 'Viper', 'Ghost', 'Rocket'];
const AI_SKILL = [0.97, 0.94, 1.0, 0.91, 0.96];
const AI_STYLES = ['blade', 'muscle', 'hyper', 'gt', 'blade'];
const DIFF = { easy: 0.82, normal: 0.9, hard: 0.98 };
const QUALITY_KEY = 'turbo-overdose-quality';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => {
  if (!isFinite(t)) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
const worldDef = id => id === 'city' ? CITY : trackById(id);
const money = n => '$' + Math.round(n).toLocaleString('en-US');

// ================= Renderer / Scene =================
// 手機不開硬體反鋸齒（太吃效能）；中、高畫質另外由後製的多重取樣處理
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: !matchMedia('(pointer: coarse)').matches, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fbbd8, 500, 2600);
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 5000);

// 燈光：太陽 + 天空環境光（顏色與角度依賽道主題切換）
const SUN_OFF = new THREE.Vector3(135, 125, 90);
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a5228, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 4.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 700 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const skySys = new SkySystem(renderer, scene);
const moon = new THREE.DirectionalLight(0x8fa8ff, 0);
moon.position.set(-200, 300, 120);
scene.add(moon);

// 畫質設定
const isTouch = matchMedia('(pointer: coarse)').matches;
let quality = 'high';
try { quality = localStorage.getItem(QUALITY_KEY) || (isTouch ? 'low' : 'high'); } catch { quality = isTouch ? 'low' : 'high'; }
const post = setupPost(renderer, scene, camera);
// 動態解析度：畫面掉格時自動降低解析度，順了再慢慢調回來
let dynScale = 1, frameAvg = 16, dynTimer = 0;
const basePR = () => quality === 'high' ? Math.min(devicePixelRatio, 2) : 1;
function setPR() {
  const pr = basePR() * dynScale;
  renderer.setPixelRatio(pr);
  post.composer.setPixelRatio(pr);
  resize();
}
function adaptResolution(raw) {
  if (raw > 0.25) return;                       // 切換分頁等造成的停頓不列入
  frameAvg += (raw * 1000 - frameAvg) * 0.05;
  if ((dynTimer += raw) < 1.5) return;
  dynTimer = 0;
  if (frameAvg > 24 && dynScale > 0.5) dynScale = Math.max(0.5, dynScale - 0.1);
  else if (frameAvg < 14 && dynScale < 1) dynScale = Math.min(1, dynScale + 0.1);
  else return;
  setPR();
}
// 低畫質：關掉車漆的透明漆層與氮氣光源（光源會讓所有物件的光照計算變重）
function applyCarQuality(model) {
  const low = quality === 'low';
  model.root.traverse(o => {
    if (o.material?.isMeshPhysicalMaterial) o.material.clearcoat = low ? 0 : 1;
  });
  if (model.boostLight) model.boostLight.visible = !low;
}
function applyQuality() {
  skySys.setCheap(quality === 'low');
  for (const c of [...cars, ...netCars.values()]) applyCarQuality(c.model);
  renderer.shadowMap.enabled = quality !== 'low';
  const ms = quality === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== ms) {
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  setPR();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post.composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ================= 賽道（世界）載入 =================
let W = null, P, T, NR, L, ds, center;
const SPEED = new Float32Array(N);
const AI_BRAKE = 19;
function loadTrack(id) {
  if (W && W.def.id === id && !W.isCity) return;
  if (W) { scene.remove(W.group); W.dispose(); }
  W = id === 'city' ? buildCity(renderer) : buildWorld(trackById(id), renderer);
  scene.add(W.group);
  ({ P, T, NR, L, ds, center } = W);
  const th = W.def.theme;
  skySys.set(th.sky, W.sunDir, th.envGround);
  SUN_OFF.copy(W.sunDir).multiplyScalar(300);
  sun.color.set(th.sun[0]); sun.intensity = th.sun[1];
  hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2];
  scene.fog.color.set(th.fog[0]); scene.fog.near = th.fog[1]; scene.fog.far = th.fog[2];
  renderer.toneMappingExposure = th.exposure;
  if (!W.isCity) buildSpeedTable();
  buildMinimap();
  skids.clear();
  if (quality !== 'low') sun.shadow.needsUpdate = true;
}
// AI 速度表：由彎道半徑與車輛抓地力算出過彎極速，再往回推煞車距離
function buildSpeedTable() {
  const w = 10, spec = { ...SPEC, mu: SPEC.mu * W.grip };
  for (let i = 0; i < N; i++) {
    const a = T[(i - w + N) % N], b = T[(i + w) % N];
    const ang = Math.acos(clamp(a.dot(b), -1, 1));
    const radius = (2 * w * ds) / Math.max(ang, 1e-5);
    SPEED[i] = Math.min(86, corneringSpeed(radius, spec) * 0.95);
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = N - 1; i >= 0; i--)
      SPEED[i] = Math.min(SPEED[i], Math.sqrt(SPEED[(i + 1) % N] ** 2 + 2 * AI_BRAKE * W.grip * ds));
}

// ================= 車輛 =================
const cars = [];
function makeEntity(name, color, isPlayer, skill = 1, style = 'gt', register = true) {
  const e = {
    name, color, isPlayer, skill, model: makeCar(color, style),
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), h: 0, fwd: 0, steerVis: 0, ax: 0, ay: 0,
    roll: 0, pitch: 0, braking: false, boosting: false,
    idx: 0, cross: 0, half: true, finished: false, finishTime: Infinity,
    ai: !isPlayer, s: 0, speed: 0, offset: 0, offsetTarget: 0, offsetTimer: 0, bump: 0
  };
  if (isPlayer) e.veh = new Vehicle(e.pos, e.vel);
  scene.add(e.model.root);
  applyCarQuality(e.model);
  if (register) cars.push(e);
  return e;
}
const player = makeEntity('你', COLORS[0], true);
AI_NAMES.forEach((n, i) => makeEntity(n, COLORS[(i + 1) % COLORS.length], false, AI_SKILL[i], AI_STYLES[i]));
let field = cars;               // 本場參賽的車（計時賽只有玩家）

// 依存檔換上玩家的車款、顏色與改裝
const prof = loadProfile();
saveProfile(prof);   // 第一次進遊戲時把隨機產生的暱稱存起來
const playerColor = () => prof.colors[prof.car] ?? COLORS[0];
function setPlayerCar() {
  const car = carById(prof.car);
  if (player.model.style !== car.style || player.model.stolen) {
    scene.remove(player.model.root);
    player.model = makeCar(playerColor(), car.style);
    scene.add(player.model.root);
  }
  if (!player.model.boostLight) {
    player.model.boostLight = new THREE.PointLight(0x55bbff, 0, 9, 2);
    player.model.boostLight.position.set(0, 0.6, -3.2);
    player.model.root.add(player.model.boostLight);
  }
  applyCarQuality(player.model);
  player.color = playerColor();
  player.model.paint.color.set(player.color);
  player.veh = new Vehicle(player.pos, player.vel, buildSpec(car.id, prof.upgrades[car.id]));
  player.veh.reset(player.h);
  player.veh.manual = !!settings.manual;
}

const skids = new SkidMarks(scene);
const sparks = new Sparks(scene);
const smoke = new Smoke(scene, renderer);

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

// 計時賽幽靈車
let ghost = null, ghostModel = null, ghostRec = [];
const GHOST_DT = 0.05;

// ================= 輸入（鍵盤 / 觸控 / 搖桿） =================
const keys = { up: false, down: false, left: false, right: false, hand: false, nitro: false };
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Space: 'hand', ShiftLeft: 'nitro', ShiftRight: 'nitro', KeyN: 'nitro'
};
const CAM_MODES = 3;
addEventListener('keydown', e => {
  if (!started) { e.preventDefault(); beginGame(); return; }
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; if (state !== 'menu' && state !== 'garage') e.preventDefault(); }
  if (e.repeat) return;
  if (state === 'intro') { introTime = 0; return; }
  if (state === 'replay') { replayKey(e); return; }
  if (photo) { if (e.code === 'Escape' || e.code === 'KeyP') exitPhoto(); return; }
  if (e.code === 'KeyR' && !(ow.active && ow.onFoot)) resetToTrack(player);
  if (e.code === 'KeyF') ow.toggleVehicle();
  if (e.code === 'KeyE') shiftGear(1);
  if (e.code === 'KeyQ') shiftGear(-1);
  if (e.code === 'KeyC') camMode = (camMode + 1) % CAM_MODES;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyH') toggleHints();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

if (isTouch) document.body.classList.add('touch');
// 觸控：踏板與圖示按住即作用（手指滑出也不會放開），方向盤左右拖曳是類比轉向
document.querySelectorAll('#touch [data-k]').forEach(b => {
  const k = b.dataset.k;
  const on = e => {
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch { /* 有些瀏覽器在手指已離開時會丟錯，不影響操作 */ }
    keys[k] = true; b.classList.add('active');
    navigator.vibrate?.(k === 'nitro' ? 25 : 8);
  };
  const off = e => { e.preventDefault(); keys[k] = false; b.classList.remove('active'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
let touchSteer = 0;
{
  const wheel = $('twheel'), svg = $('twheelSvg');
  let id = null;
  const set = e => {
    const r = wheel.getBoundingClientRect();
    if (!r.width) return;
    const x = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.45), -1, 1);
    touchSteer = Math.sign(x) * Math.max(0, Math.abs(x) - 0.06) / 0.94;   // 中間留一點死區
    svg.style.transform = `rotate(${touchSteer * 110}deg)`;
  };
  wheel.addEventListener('pointerdown', e => {
    e.preventDefault();
    id = e.pointerId;
    try { wheel.setPointerCapture(id); } catch { /* 同上 */ }
    wheel.classList.add('active');
    set(e);
  });
  wheel.addEventListener('pointermove', e => { if (e.pointerId === id) set(e); });
  const end = e => {
    if (e.pointerId !== id) return;
    id = null; touchSteer = 0;
    svg.style.transform = '';
    wheel.classList.remove('active');
  };
  wheel.addEventListener('pointerup', end);
  wheel.addEventListener('pointercancel', end);
}

const pad = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false, gp: null };
let padPrev = [];
function pollPad() {
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null;
  pad.gp = gp;
  if (!gp) { pad.throttle = pad.brake = pad.steer = 0; pad.hand = pad.nitro = false; return; }
  const b = i => gp.buttons[i] ? gp.buttons[i].value : 0;
  if (gp.buttons.some(x => x.value > 0.5) || gp.axes.some(a => Math.abs(a) > 0.4)) lastInput = 'pad';
  const x = gp.axes[0] || 0;
  pad.steer = Math.abs(x) < 0.1 ? 0 : Math.sign(x) * ((Math.abs(x) - 0.1) / 0.9) ** 1.4;
  pad.throttle = b(7); pad.brake = b(6);
  pad.hand = b(2) > 0.5 || b(1) > 0.5;
  pad.nitro = b(0) > 0.5;
  const pressed = i => b(i) > 0.5 && !(padPrev[i] > 0.5);
  const scr = openScreen();
  if (pressed(0) || pressed(9)) {
    if (scr === 'results') $('resBtns').firstChild?.click();
    else if (scr === 'setup') $('setupStart').click();
    else if (scr === 'menu') $('btnQuick').click();
    else if (pressed(9) && !scr) togglePause();
  }
  if (pressed(3)) { if (ow.active && state === 'race') ow.toggleVehicle(); else camMode = (camMode + 1) % CAM_MODES; }
  if (pressed(8)) resetToTrack(player);
  if (pressed(5)) shiftGear(1);
  if (pressed(4)) shiftGear(-1);
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
    steer: clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + (pad.steer || 0) + (touchSteer || 0), -1, 1),
    hand: keys.hand || pad.hand,
    nitro: keys.nitro || pad.nitro,
  };
}
const NO_INPUT = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false };

// ================= 音效 =================
let audio = null, muted = false, music = null;
const SETTINGS_KEY = 'turbo-overdose-settings';
const settings = { music: 0.6, sfx: 0.8 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch { /* 無 storage */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 無 storage */ } };
function applyVolumes() {
  if (!audio) return;
  audio.master.gain.value = muted ? 0 : 0.45 * settings.sfx;
  audio.musicBus.gain.value = muted ? 0 : 1;
  music.setVolume(settings.music);
}
function initAudio() {
  if (audio) { audio.ctx.resume(); return; }
  // 手機用較大的音訊緩衝，避免 CPU 忙碌時來不及送資料造成的劈啪聲
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: isTouch ? 'playback' : 'interactive' });
  // 混音鏈：音效 + 音樂 → 壓縮器 → 柔性削峰 → 喇叭
  // 最後一級用 tanh 曲線，訊號超過上限時是平滑飽和，不會產生數位破音
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3;
  comp.attack.value = 0.004; comp.release.value = 0.2;
  const pre = ctx.createGain(); pre.gain.value = 0.5;
  const soft = ctx.createWaveShaper();
  const sc = new Float32Array(2048);
  for (let i = 0; i < sc.length; i++) sc[i] = Math.tanh((i / (sc.length - 1) * 2 - 1) * 2);
  soft.curve = sc; soft.oversample = isTouch ? 'none' : '2x';
  comp.connect(pre); pre.connect(soft); soft.connect(ctx.destination);
  const master = ctx.createGain(); master.connect(comp);
  const musicBus = ctx.createGain(); musicBus.connect(comp);
  const osc = (type, dest, gain = 1) => {
    const o = ctx.createOscillator(); o.type = type;
    const g = ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(dest); o.start();
    return o;
  };
  // 引擎：基頻鋸齒波 ×2（失諧）、低八度方波、2 倍與 3 倍泛音，經過濾波與輕微失真
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(2.2 * x); }
  shaper.curve = curve;
  const eg = ctx.createGain(); eg.gain.value = 0;
  lp.connect(shaper); shaper.connect(eg); eg.connect(master);
  const o1 = osc('sawtooth', lp, 0.55), o2 = osc('sawtooth', lp, 0.45), o3 = osc('square', lp, 0.35);
  const o4 = osc('sine', lp, 0.3), o5 = osc('sawtooth', lp, 0.1);
  // 噪音來源（輪胎、風切、氮氣、引擎低吼）
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = (type, freq, q, dest = master) => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(dest); src.start();
    return { g, f };
  };
  const squeal = noise('bandpass', 1500, 7);
  const wind = noise('lowpass', 600, 0.5);
  const hiss = noise('bandpass', 3200, 0.6);
  const growl = noise('lowpass', 180, 1);
  const rg = ctx.createGain(); rg.gain.value = 0; rg.connect(master);
  const rumbleOsc = ctx.createOscillator(); rumbleOsc.type = 'square'; rumbleOsc.frequency.value = 34;
  rumbleOsc.connect(rg); rumbleOsc.start();
  // 渦輪哨音
  const tg = ctx.createGain(); tg.gain.value = 0; tg.connect(master);
  const turbo = ctx.createOscillator(); turbo.type = 'sine'; turbo.connect(tg); turbo.start();
  audio = { ctx, master, musicBus, comp, out: soft, lp, eg, o1, o2, o3, o4, o5, squeal, wind, hiss, growl, rg, turbo, tg, buf, lastThrottle: 0 };
  music = new Music(ctx, musicBus);
  applyVolumes();
}
function beep(freq, dur = 0.18, type = 'square', vol = 0.25) {
  if (!audio) return;
  const { ctx, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
}
function burst(freq, dur, vol, delay = 0, type = 'lowpass', sweepTo = 0) {
  if (!audio) return;
  const { ctx, master, buf } = audio, t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur);
}
function nitroWhoosh() {
  if (!audio) return;
  const { ctx, master, buf } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3500, t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 0.75);
  burst(90, 0.35, 0.45);
}
const crash = (v = 1) => { burst(500, 0.35, 0.42 * v); burst(120, 0.25, 0.5 * v); };
const backfire = () => { const n = 2 + (Math.random() * 3 | 0); for (let i = 0; i < n; i++) burst(380, 0.07, 0.35, i * (0.06 + Math.random() * 0.05)); };
const blowOff = () => burst(4200, 0.35, 0.22, 0, 'highpass', 1400);   // 洩壓閥「噗嘶」
function toggleMute() {
  muted = !muted;
  applyVolumes();
}
function updateAudio(ctl, fx) {
  if (!audio) return;
  const a = audio, t = a.ctx.currentTime, v = player.veh;
  const rpm = v.rpm, rn = rpm / SPEC.maxRpm;
  const f = rpm / 60 * 2;
  a.o1.frequency.setTargetAtTime(f, t, 0.02);
  a.o2.frequency.setTargetAtTime(f * 1.012, t, 0.02);
  a.o3.frequency.setTargetAtTime(f * 0.5, t, 0.02);
  a.o4.frequency.setTargetAtTime(f * 2, t, 0.02);
  a.o5.frequency.setTargetAtTime(f * 3, t, 0.02);
  const thr = ctl.throttle;
  a.lp.frequency.setTargetAtTime(250 + rn * 2400 * (0.45 + 0.55 * thr), t, 0.03);
  const cut = ow.active && ow.onFoot ? 0.25 : v.shiftT > 0 ? 0.35 : v.limiter ? (Math.random() < 0.5 ? 0.3 : 1) : 1;
  a.eg.gain.setTargetAtTime((0.05 + 0.08 * thr + 0.04 * rn + 0.04 * boostFx) * cut, t, 0.015);
  a.growl.g.gain.setTargetAtTime(thr * (0.04 + rn * 0.08), t, 0.05);
  a.growl.f.frequency.setTargetAtTime(120 + rn * 260, t, 0.05);
  a.turbo.frequency.setTargetAtTime(1800 + rn * 2800, t, 0.1);
  a.tg.gain.setTargetAtTime(thr * rn * rn * 0.018, t, 0.15);
  a.squeal.g.gain.setTargetAtTime(fx.squeal * 0.22, t, 0.05);
  a.squeal.f.frequency.setTargetAtTime(1300 + fx.squeal * 500, t, 0.1);
  const sp = Math.abs(player.fwd) / REF_SPEED;
  a.wind.g.gain.setTargetAtTime(Math.min(1, sp * sp) * 0.14 + boostFx * 0.06, t, 0.1);
  a.hiss.g.gain.setTargetAtTime(boostFx * 0.16, t, 0.05);
  a.rg.gain.setTargetAtTime(fx.curb ? 0.08 : 0, t, 0.03);
  if (a.lastThrottle > 0.6 && thr < 0.1 && rpm > 5000) { backfire(); blowOff(); }
  if (v.shifted) { v.shifted = 0; if (Math.random() < 0.5) backfire(); }
  a.lastThrottle = thr;
}

// ================= 遊戲狀態 =================
let state = 'menu', paused = false, cdTime = 0, raceTime = 0, lapStart = 0, bestLap = Infinity, lapTimes = [];
let boostFx = 0, boostKick = 0, wasBoosting = false, nitroLock = false, nitroEmptyFlash = 0;
const NITRO_START = 15;
let camMode = 0, camH = 0, nitro = 50, wrongWay = 0, shake = 0, menuAngle = 0, lastCd = -1;
let resultsTimer = -1, curbTimer = 0, lastPos = 0;
// 本場設定：mode = quick / career / tt
let session = { mode: 'quick', track: 'valley', diff: 'normal' };

function placeOnGrid() {
  if (session.mode === 'free') {
    for (const c of cars) c.model.root.visible = c === player;
    const sp = W.spawn, p = player;
    p.pos.set(sp.x, 0, sp.z); p.h = sp.h;
    p.vel.set(0, 0, 0); p.fwd = p.steerVis = p.ax = p.ay = 0;
    p.cross = 0; p.finished = false; p.finishTime = Infinity; p.ai = false; p.idx = 0;
    p.veh.reset(p.h); p.veh.manual = !!settings.manual;
    syncModel(p, 0);
    field = [player];
    return;
  }
  // 兩列排開，比賽時玩家從最後一位出發；計時賽玩家單獨在最前面
  const order = session.mode === 'tt' ? [player]
    : session.mode === 'online' ? session.grid.map(uid => uid === net.uid ? player : netCars.get(uid)).filter(Boolean)
    : [...cars.filter(c => !c.isPlayer), player];
  for (const c of cars) c.model.root.visible = order.includes(c);
  order.forEach((c, k) => {
    c.s = L - 14 - Math.floor(k / 2) * 11;
    c.offset = c.offsetTarget = session.mode === 'tt' ? 0 : k % 2 ? 4.5 : -4.5;
    trackAt(c.s, c.offset, c.pos);
    c.idx = Math.floor(c.s / ds) % N;
    c.h = Math.atan2(T[c.idx].x, T[c.idx].z);
    c.vel.set(0, 0, 0); c.fwd = c.speed = c.steerVis = c.ax = c.ay = 0;
    c.cross = 0; c.half = true; c.finished = false; c.finishTime = Infinity;
    c.ai = !c.isPlayer;
    c.skillNow = c.skill * DIFF[session.diff] * (0.97 + Math.random() * 0.06); // 每場狀態略有起伏
    if (c.veh) c.veh.reset(c.h);
    syncModel(c, 0);
  });
  field = order;
}
function resetToTrack(c) {
  if (state !== 'race' || c.finished) return;
  if (W.isCity) return resetCity(c);
  c.idx = nearestIdx(c.pos, c.idx, N / 2);
  c.pos.copy(P[c.idx]);
  c.h = Math.atan2(T[c.idx].x, T[c.idx].z);
  c.veh.reset(c.h);
  c.fwd = 0;
  skids.last.clear();
}

function startRace(sess = session) { fadeThen(() => beginRace(sess)); }
function beginRace(sess = session) {
  session = sess;
  document.activeElement?.blur();
  initAudio();
  loadTrack(session.track);
  setPlayerCar();
  // AI 避開玩家的顏色
  let ci = 0;
  cars.filter(c => !c.isPlayer).forEach(c => {
    while (COLORS[ci] === player.color) ci++;
    c.color = COLORS[ci % COLORS.length]; c.model.paint.color.set(c.color); ci++;
  });
  placeOnGrid();
  if (session.mode === 'free') { spawnTraffic(); ow.start(); resetDayTime(); updateDayNight(0, true); } else { clearTraffic(); if (ow.active) ow.stop(); }
  $('touch').classList.toggle('free', session.mode === 'free');
  $('trackname').classList.toggle('hidden', session.mode === 'free');
  odometer = topSpeed = 0;
  const free = session.mode === 'free';
  $('lblPos').textContent = free ? '模式' : '名次';
  $('lblLap').textContent = free ? '里程' : '圈數';
  $('lblLapTime').textContent = free ? '極速' : '本圈';
  $('lblBest').parentElement.classList.toggle('hidden', free);
  skids.clear();
  if (ghostModel) { scene.remove(ghostModel.root); ghostModel = null; }
  ghost = null; ghostRec = [];
  if (session.mode === 'tt') {
    ghost = loadGhost(session.track);
    ghostModel = makeGhost(ghost?.style || carById(prof.car).style);
    ghostModel.root.visible = false;
    scene.add(ghostModel.root);
  }
  bestLap = prof.best[session.track] ?? Infinity;
  session.prevBest = bestLap;
  lapTimes = [];
  boostFx = boostKick = 0; wasBoosting = nitroLock = false; nitroEmptyFlash = 0;
  nitro = 50; raceTime = 0; lapStart = 0; wrongWay = 0; lastCd = -1; resultsTimer = -1;
  cdTime = session.mode === 'free' ? 0 : 3.6; paused = false;
  state = 'intro'; introTime = INTRO_TIME; showIntro();
  if (isTouch && innerHeight > innerWidth) {
    $('rotatehint').classList.add('show');
    setTimeout(() => $('rotatehint').classList.remove('show'), 3500);
  }
  photo = null; $('photohud').classList.add('hidden'); applyFilter('none');
  rec = session.mode === 'free' ? null : { frames: [], cars: [...field], done: false }; recTimer = 0;
  lastPos = 0;
  music?.play('race');
  camH = player.h; camInit = false;
  showScreen(null);
  $('hud').classList.add('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  $('bestlap').textContent = fmt(bestLap);
  $('trackname').textContent = worldDef(session.track).name + (session.mode === 'free' ? ' · 自由駕駛' : session.mode === 'tt' ? ' · 計時賽' : session.mode === 'career' ? ' · ' + cupById(session.cup).name + ` 第 ${prof.cup.race + 1} 場` : '');
  showCenter('');
}
function togglePause() {
  if (state !== 'race' && state !== 'countdown') return;
  paused = !paused;
  $('restartBtn').classList.toggle('hidden', session.mode === 'online');
  $('pausemenu').classList.toggle('hidden', !paused);
  if (audio) paused ? audio.ctx.suspend() : audio.ctx.resume();
}
let centerTimer = 0;
function showCenter(text, small = false, time = 0) {
  const el = $('center');
  el.textContent = text;
  el.classList.toggle('smallmsg', small);
  el.classList.remove('pop'); void el.offsetWidth;
  if (text) el.classList.add('pop');
  centerTimer = time;
}

// ================= 物理 =================
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpL = new THREE.Vector3();
const SUBSTEPS = 4;

function surfaceOf(d) {
  const a = Math.abs(d);
  const g = W.grip;
  if (a <= HALF) return { grip: g, drag: 0, kind: 'road' };
  if (a <= HALF + CURB) return { grip: 0.95 * g, drag: 0, kind: 'curb' };
  return { grip: 0.62 * g, drag: 170, kind: 'sand' };
}

function updatePlayer(dt, ctl) {
  const c = player, v = c.veh;
  const surf = W.isCity ? CITY_SURF : surfaceOf(lateral(c));
  // 氮氣：至少要有 NITRO_START 才能啟動；噴完就鎖住，要放開按鍵才能再用
  if (!ctl.nitro) nitroLock = false;
  const canStart = nitro >= NITRO_START && !nitroLock;
  const boosting = ctl.nitro && v.u > 5 && nitro > 0 && (wasBoosting || canStart);
  if (boosting) {
    nitro = Math.max(0, nitro - v.s.nitroDrain * dt);
    if (nitro <= 0) nitroLock = true;
  }
  if (ctl.nitro && !boosting && !wasBoosting && v.u > 5) nitroEmptyFlash = 0.6;
  if (boosting && !wasBoosting) { boostKick = 1; nitroWhoosh(); rumble(0.7, 0.9, 350); }
  wasBoosting = boosting;
  const pc = { throttle: boosting ? 1 : ctl.throttle, brake: ctl.brake, steer: ctl.steer, hand: ctl.hand, boost: boosting };
  for (let i = 0; i < SUBSTEPS; i++) v.step(dt / SUBSTEPS, pc, surf);
  // 保險：萬一物理數值壞掉（NaN），把車放回賽道，不讓整場比賽卡死
  if (!Number.isFinite(v.u + v.h + c.pos.x + c.pos.z)) {
    c.pos.copy(P[c.idx]); v.reset(Math.atan2(T[c.idx].x, T[c.idx].z));
  }

  c.h = v.h; c.fwd = v.u; c.steerVis = v.delta; c.ax = v.ax; c.ay = v.ay;
  c.boosting = boosting; c.braking = ctl.brake > 0.1 && v.u > 1;
  if (session.mode === 'free') { odometer += Math.abs(v.u) * dt; topSpeed = Math.max(topSpeed, Math.abs(v.u)); }

  // 甩尾集氣
  const slide = Math.abs(v.beta);
  const drifting = slide > 0.12 && v.u > 15 && surf.kind !== 'sand';
  if (!boosting) {
    if (drifting) nitro = Math.min(100, nitro + 22 * slide * dt * 4);
    nitro = Math.min(100, nitro + 1.2 * dt);
  }

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
    if (!onRoad && k < 2 && Math.abs(v.u) > 6 && Math.random() < 0.6) smoke.emit(wheel(z, x).setY(0.5), W.def.theme.runoff[0], 1.6, 0.55, c.vel);
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
        lapTimes.push(lt);
        let msg = '';
        if (lt < bestLap) {
          bestLap = lt;
          prof.best[session.track] = lt;
          submitOnline(session.track, lt);
          saveProfile(prof);
          $('bestlap').textContent = fmt(bestLap);
          msg = '新紀錄！';
        }
        // 計時賽：比幽靈車快（或還沒有幽靈車）就把這圈存成新的幽靈車
        if (session.mode === 'tt' && ghostRec.length > 20 && (!ghost || lt < ghost.time)) {
          ghost = { time: lt, style: carById(prof.car).style, pts: ghostRec };
          saveGhost(session.track, ghost);
          ghostModel.root.removeFromParent();
          ghostModel = makeGhost(ghost.style);
          scene.add(ghostModel.root);
          msg = msg || '超越幽靈車！';
        }
        if (msg && c.cross <= LAPS) { showCenter(msg, true, 1.6); beep(1046, 0.25, 'triangle'); }
      }
      lapStart = raceTime;
      ghostRec = [];
      if (centerTimer > 0) { /* 剛顯示紀錄訊息，不蓋掉 */ }
      else if (c.cross === LAPS) { showCenter('最後一圈！', true, 1.6); beep(880, 0.3); }
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
  showCenter(session.mode === 'tt' ? 'FINISH' : pos === 1 ? '冠軍！' : 'FINISH', false, 3);
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
  for (let a = 0; a < field.length; a++) for (let b = a + 1; b < field.length; b++) {
    const A = field[a], B = field[b];
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
  return [...field].sort((a, b) => {
    if (a.finished || b.finished) return a.finishTime - b.finishTime;
    return progress(b) - progress(a);
  });
}

function syncModel(c, dt) {
  const m = c.model;
  m.root.position.set(c.pos.x, ROAD_Y + (c.lift || 0), c.pos.z);
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
    if (c.boosting) { const k = 1.2 + Math.random() * 0.4; f.scale.set(k, k, 1.4 + Math.random() * 1.2); }
  }
  if (m.boostLight) m.boostLight.intensity = c.boosting ? 25 + Math.random() * 20 : 0;
}

// ================= 相機 =================
let camInit = false;
const camPos = new THREE.Vector3(), camWant = new THREE.Vector3();
function updateCamera(dt) {
  if (ow.active && ow.onFoot) {
    ow.updateCamera(dt);
    post.speed.uniforms.amount.value = 0;
    const t = camera.position;
    sun.position.set(t.x, 0, t.z).add(SUN_OFF); sun.target.position.set(t.x, 0, t.z);
    return;
  }
  const c = player;
  const beta = !c.ai ? c.veh.beta : 0;
  const sf = clamp(Math.abs(c.fwd) / REF_SPEED, 0, 1.3);
  const aim = c.h + clamp(beta, -0.7, 0.7) * 0.55;  // 甩尾時鏡頭看向行進方向
  let dh = aim - camH; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camH += dh * Math.min(1, 5 * dt);
  const fx = Math.sin(camH), fz = Math.cos(camH);
  if (camMode < 2) {
    const far = camMode === 1;
    const dist = (far ? 13 : 6.6) + sf * 1.2 + boostKick * 2.2, hgt = (far ? 4.8 : 2.45) + sf * 0.25 - boostKick * 0.3;
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
  boostFx += ((c.boosting ? 1 : 0) - boostFx) * Math.min(1, (c.boosting ? 6 : 2.5) * dt);
  boostKick = Math.max(0, boostKick - dt * 1.6);
  const vib = shake + Math.max(0, sf - 0.75) * 0.06 + boostFx * 0.1 + boostKick * 0.25;
  if (vib > 0) {
    camera.position.x += (Math.random() - 0.5) * vib * 0.5;
    camera.position.y += (Math.random() - 0.5) * vib * 0.5;
    shake = Math.max(0, shake - dt * 2.5);
  }
  // 直向螢幕畫面很窄，把視角拉寬一點
  const fov = (58 + sf * 15 + boostFx * 16) * (camera.aspect < 1 ? 1.25 : 1);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }
  const su = post.speed.uniforms;
  const blur = clamp((sf - 0.5) * 1.6, 0, 1) * 0.8 + boostFx * 1.1;
  su.amount.value += (blur - su.amount.value) * Math.min(1, 6 * dt);
  su.aberration.value = 0.05 + boostFx * 0.45;
  if (hudCache.boost !== c.boosting) { hudCache.boost = c.boosting; document.body.classList.toggle('boosting', c.boosting); }
  const op = (boostFx * 0.9).toFixed(2);
  if (hudCache.boostOp !== op) { hudCache.boostOp = op; $('boostfx').style.opacity = op; }
  sun.position.copy(c.pos).add(SUN_OFF);
  sun.target.position.copy(c.pos);
}

// ================= HUD / 小地圖 =================
const mm = $('minimap'), mctx = mm.getContext('2d');
const mmLayer = document.createElement('canvas'); mmLayer.width = mmLayer.height = 200;
let mmScale = 1;
const mmX = x => 100 + (x - center.x) * mmScale, mmY = z => 100 + (z - center.z) * mmScale;
function buildMinimap() {
  const b = W.bounds;
  mmScale = 172 / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const g = mmLayer.getContext('2d');
  if (W.isCity) {
    g.clearRect(0, 0, 200, 200);
    g.fillStyle = '#3b3e44';
    g.fillRect(mmX(b.minX), mmY(b.minZ), (b.maxX - b.minX) * mmScale, (b.maxZ - b.minZ) * mmScale);
    for (const k of W.blocks) {
      g.fillStyle = k.park ? '#5f8f45' : '#9aa0a8';
      g.fillRect(mmX(k.x0), mmY(k.z0), (k.x1 - k.x0) * mmScale, (k.z1 - k.z0) * mmScale);
    }
    return;
  }
  g.clearRect(0, 0, 200, 200);
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
  if (ghostModel?.root.visible) {
    mctx.fillStyle = 'rgba(102,204,255,0.8)';
    mctx.beginPath(); mctx.arc(mmX(ghostModel.root.position.x), mmY(ghostModel.root.position.z), 4.5, 0, 7); mctx.fill();
  }
  if (ow.active) ow.drawMinimap(mctx, mmX, mmY);
  mctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const e of traffic) { mctx.beginPath(); mctx.arc(mmX(e.pos.x), mmY(e.pos.z), 2.5, 0, 7); mctx.fill(); }
  for (const c of field) {
    if (c.isPlayer) continue;
    mctx.fillStyle = hex(c.color);
    mctx.beginPath(); mctx.arc(mmX(c.pos.x), mmY(c.pos.z), 4.5, 0, 7); mctx.fill();
  }
  mctx.fillStyle = hex(player.color); mctx.strokeStyle = '#fff'; mctx.lineWidth = 2.5;
  mctx.beginPath(); mctx.arc(mmX(player.pos.x), mmY(player.pos.z), 6.5, 0, 7); mctx.fill(); mctx.stroke();
}
const hudCache = {};
function txt(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function bar(id, pct) {
  const v = Math.round(pct * 2) / 2;
  if (hudCache[id] !== v) { hudCache[id] = v; $(id).style.width = v + '%'; }
}
function cls(id, name, on) {
  const k = id + '.' + name;
  if (hudCache[k] !== on) { hudCache[k] = on; $(id).classList.toggle(name, on); }
}
let hudFrame = 0;
function updateHUD() {
  const order = standings();
  const v = player.veh;
  const pos = order.indexOf(player) + 1;
  txt('pos', session.mode === 'free' ? '自由' : session.mode === 'tt' ? '計時' : `${pos}/${field.length}`);
  if (state === 'race' && session.mode !== 'tt' && lastPos && pos !== lastPos) {
    const el = $('posdelta');
    el.textContent = pos < lastPos ? '▲' : '▼';
    el.className = pos < lastPos ? 'up' : 'down';
    void el.offsetWidth; el.classList.add('show');
  }
  lastPos = pos;
  if (session.mode === 'free') {
    txt('lap', (odometer / 1000).toFixed(1) + ' km');
    txt('time', fmt(raceTime));
    txt('laptime', Math.round(topSpeed * 3.6) + ' km/h');
  } else {
    txt('lap', `${clamp(player.cross, 1, LAPS)}/${LAPS}`);
    txt('time', fmt(player.finished ? player.finishTime : raceTime));
    txt('laptime', fmt(player.cross >= 1 && !player.finished ? raceTime - lapStart : 0));
  }
  txt('speed', String(Math.round(Math.abs(player.fwd) * 3.6)));
  txt('gear', String(player.ai ? 'A' : v.manual ? (v.gear === -1 ? 'R' : v.gear) : v.u < -0.5 ? 'R' : v.gear));
  cls('gear', 'shift', v.manual && !player.ai && v.gear > 0 && v.gear < v.s.gears.length && v.rpm / SPEC.maxRpm > 0.88);
  const rn = v.rpm / SPEC.maxRpm;
  bar('rpmfill', rn * 100);
  cls('rpmfill', 'red', rn > 0.9);
  bar('nitrofill', nitro);
  cls('nitro', 'low', nitro < NITRO_START);
  if (isTouch) {
    const off = (182.2 * (1 - nitro / 100)).toFixed(1);
    if (hudCache.ring !== off) { hudCache.ring = off; $('tnitroRing').setAttribute('stroke-dashoffset', off); }
    cls('tnitro', 'low', nitro < NITRO_START && !player.boosting);
  }
  if (nitroEmptyFlash > 0) nitroEmptyFlash -= 1 / 60;
  cls('nitro', 'empty', nitroEmptyFlash > 0);
  txt('warn', wrongWay > 1 ? '逆向行駛！' : '');
  if (++hudFrame % 2 === 0) drawMinimap();
  updateCtrlHint();
}

function showResults() {
  if (rec) rec.done = true;
  if (session.mode === 'online') {
    renderOnlineResults();
    showScreen('results');
    $('touch').classList.add('hidden');
    return;
  }
  const order = standings();
  const me = order.indexOf(player) + 1;
  const tr = worldDef(session.track);
  const rows = [], notes = [];
  let earned = 0, buttons;
  if (session.mode === 'tt') {
    $('resTitle').textContent = '計時賽結果';
    lapTimes.forEach((t, i) => rows.push(['', `第 ${i + 1} 圈`, fmt(t), t === Math.min(...lapTimes)]));
    const prevBest = session.prevBest;
    if (bestLap < prevBest) {
      earned = TT_REWARD;
      notes.push(`${icon('flag')}新的最佳單圈 ${fmt(bestLap)}（原紀錄 ${fmt(prevBest)}）`);
    } else notes.push(`最佳單圈紀錄：${fmt(bestLap)}`);
    buttons = [['再跑一次', () => startRace(session)], ['回主選單', toMenu]];
  } else {
    $('resTitle').innerHTML = me === 1 ? `${icon('trophy')}冠軍！` : `第 ${me} 名`;
    for (const [i, c] of order.entries()) {
      const time = c.finished ? fmt(c.finishTime) : `第 ${clamp(c.cross, 1, LAPS)} 圈`;
      rows.push([i + 1, `<span class="dot" style="background:${hex(c.color)}"></span>${c.name}`, time, c.isPlayer]);
    }
    earned = PRIZE[me - 1] * DIFF_PAY[session.diff] * (session.mode === 'career' ? 1.2 : 1);
    notes.push(`最佳單圈：${fmt(bestLap)}`);
    if (session.mode === 'career') {
      const cup = cupById(session.cup), st = prof.cup;
      order.forEach((c, i) => { st.points[c.name] = (st.points[c.name] || 0) + POINTS[i]; });
      st.race++;
      const table = cupStandings();
      const last = st.race >= cup.tracks.length;
      notes.push(`<b>${cup.name} 積分（${st.race}/${cup.tracks.length}）</b>`);
      notes.push(table.map(([n, pts], i) => `${i + 1}. ${n === '你' ? '<b class="hl">你</b>' : n} ${pts} 分`).join('　'));
      if (last) {
        const won = table[0][0] === '你';
        if (won) {
          earned += cup.prize;
          if (!prof.cupsWon.includes(cup.id)) prof.cupsWon.push(cup.id);
          notes.push(`${icon('trophy')}${cup.name} 總冠軍！獎金 ${money(cup.prize)}`);
        } else notes.push(`${cup.name} 結束，總排名第 ${table.findIndex(r => r[0] === '你') + 1}。拿下總冠軍才能解鎖下一個盃賽。`);
        prof.cup = null;
        buttons = [['回生涯模式', () => { toMenu(); openCareer(); }], ['回主選單', toMenu]];
      } else {
        buttons = [['下一場：' + trackById(cup.tracks[st.race]).name, () => startCareerRace()], ['回主選單', toMenu]];
      }
    } else {
      buttons = [['再賽一場', () => startRace(session)], ['回主選單', toMenu]];
    }
  }
  if (rec?.frames.length > 40) buttons.splice(1, 0, [icon('film') + '觀看重播', enterReplay]);
  if (earned > 0) notes.unshift(`${icon('coin')}獎金 <b class="hl">+${money(earned)}</b>`);
  prof.money += earned;
  saveProfile(prof);
  $('resSub').textContent = `${tr.name} · ${session.mode === 'tt' ? '計時賽' : DIFF_NAME[session.diff]}`;
  $('resTable').innerHTML = rows.map(([a, b, c, me]) => `<tr class="${me ? 'me' : ''}"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('');
  $('resNotes').innerHTML = notes.map(n => `<div>${n}</div>`).join('');
  const box = $('resBtns'); box.innerHTML = '';
  buttons.forEach(([label, fn], i) => {
    const b = document.createElement('button');
    b.innerHTML = label; if (i === 0) b.className = 'go';
    b.onclick = fn; box.appendChild(b);
  });
  showScreen('results');
  $('touch').classList.add('hidden');
}

// ================= 包裝：開始畫面、轉場、開場 =================
let started = false;
function beginGame() {
  if (started) return;
  started = true;
  initAudio();
  music.play('menu');
  $('loading').classList.add('gone');
  setTimeout(() => $('loading').remove(), 800);
}
addEventListener('pointerdown', () => {
  if (!started) beginGame();
  else if (state === 'intro') introTime = 0;
});
function fadeThen(fn) {
  const f = $('fade');
  f.classList.add('on');
  setTimeout(() => {
    fn();
    setTimeout(() => f.classList.remove('on'), 60);
  }, 320);
}

const INTRO_TIME = 3.6;
let introTime = 0;
function showIntro() {
  const tr = worldDef(session.track);
  $('introTrack').textContent = tr.name;
  $('introSub').textContent = session.mode === 'free' ? '自由駕駛 · 想去哪就去哪' : session.mode === 'tt' ? '計時賽 · 3 圈'
    : session.mode === 'career' ? `${cupById(session.cup).name} · 第 ${prof.cup.race + 1} / 3 場 · ${DIFF_NAME[session.diff]}`
    : `快速比賽 · ${DIFF_NAME[session.diff]} · 3 圈`;
  $('intro').classList.remove('hidden');
  $('intro').classList.remove('play'); void $('intro').offsetWidth; $('intro').classList.add('play');
}
function updateIntro(dt) {
  introTime -= dt;
  if (session.mode === 'online' && (session.startAt - net.serverNow()) / 1000 < 3.3) introTime = Math.min(introTime, 0);
  const k = 1 - Math.max(0, introTime) / INTRO_TIME;
  const e = k * k * (3 - 2 * k);
  const c = player, fx = Math.sin(c.h), fz = Math.cos(c.h);
  // 從車頭前上方繞到車尾，最後剛好接上追車視角
  const th = c.h + 0.35 + e * (Math.PI - 0.35);
  const r = 18 - e * 11.4, y = 8 - e * 5.55;
  camera.position.set(c.pos.x + Math.sin(th) * r, y, c.pos.z + Math.cos(th) * r);
  camera.lookAt(c.pos.x + fx * 6 * e, 1 + 0.1 * e, c.pos.z + fz * 6 * e);
  camera.fov = 50 + 8 * e; camera.updateProjectionMatrix();
  sun.position.copy(c.pos).add(SUN_OFF); sun.target.position.copy(c.pos);
  post.speed.uniforms.amount.value = 0;
  if (introTime <= 0) {
    state = 'countdown';
    $('intro').classList.add('hidden');
    $('hud').classList.remove('hidden');
    camH = c.h; camPos.copy(camera.position); camInit = true;
  }
}

// ================= 重播 =================
const REC_DT = 1 / 20;
let rec = null, recTimer = 0, rp = null;
function recordFrame(dt) {
  if (!rec || rec.done) return;
  recTimer += dt;
  while (recTimer >= REC_DT) {
    recTimer -= REC_DT;
    rec.frames.push(rec.cars.map(c => [c.pos.x, c.pos.z, c.h, c.steerVis, (c.boosting ? 1 : 0) | (c.braking ? 2 : 0)]));
  }
}
const SHOTS = ['tv', 'chase', 'side', 'heli', 'tv', 'bumper'];
const SHOT_NAME = { tv: '轉播鏡頭', chase: '追車', side: '側拍', heli: '空拍', bumper: '低角度' };
function enterReplay() {
  if (!rec || rec.frames.length < 2) return;
  rec.done = true;
  fadeThen(() => {
    state = 'replay';
    rp = { t: 0, speed: 1, paused: false, target: player, shot: 0, shotT: 5, tv: null };
    for (const c of rec.cars) { c.model.root.visible = true; c.ai = true; }
    if (ghostModel) ghostModel.root.visible = false;
    showScreen(null);
    $('hud').classList.add('hidden');
    $('replayhud').classList.remove('hidden');
    document.body.classList.remove('boosting'); $('boostfx').style.opacity = 0;
    silenceRace();
  });
}
function exitReplay() {
  fadeThen(() => {
    state = 'results';
    $('replayhud').classList.add('hidden');
    showScreen('results');
  });
}
function nextShot() { rp.shot = (rp.shot + 1) % SHOTS.length; rp.shotT = 4.5 + Math.random() * 2.5; rp.tv = null; }
function replayKey(e) {
  const dur = (rec.frames.length - 1) * REC_DT;
  if (e.code === 'Space') rp.paused = !rp.paused;
  else if (e.code === 'ArrowLeft') rp.t = Math.max(0, rp.t - 5);
  else if (e.code === 'ArrowRight') rp.t = Math.min(dur - 0.01, rp.t + 5);
  else if (e.code === 'ArrowUp') rp.speed = Math.min(4, rp.speed * 2);
  else if (e.code === 'ArrowDown') rp.speed = Math.max(0.25, rp.speed / 2);
  else if (e.code === 'KeyC') nextShot();
  else if (e.code === 'Tab') {
    const i = rec.cars.indexOf(rp.target);
    rp.target = rec.cars[(i + 1) % rec.cars.length]; rp.tv = null;
  } else if (e.code === 'Escape' || e.code === 'Enter') exitReplay();
  e.preventDefault();
}
function updateReplay(dt) {
  const F = rec.frames, dur = (F.length - 1) * REC_DT;
  const step = rp.paused ? 0 : dt * rp.speed;
  rp.t += step;
  if (rp.t >= dur) rp.t = 0;
  const f = rp.t / REC_DT, i = Math.min(F.length - 2, Math.floor(f)), u = f - i;
  rec.cars.forEach((c, k) => {
    const a = F[i][k], b = F[i + 1][k];
    let dh = b[2] - a[2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    c.pos.set(a[0] + (b[0] - a[0]) * u, 0, a[1] + (b[1] - a[1]) * u);
    c.h = a[2] + dh * u;
    c.steerVis = a[3];
    c.fwd = Math.hypot(b[0] - a[0], b[1] - a[1]) / REC_DT;
    c.ay = c.fwd * dh / REC_DT; c.ax = 0;
    c.boosting = !!(a[4] & 1); c.braking = !!(a[4] & 2);
    c.idx = nearestIdx(c.pos, c.idx, 80);
    syncModel(c, step);
  });
  if (!rp.paused && (rp.shotT -= dt) <= 0) nextShot();
  replayCamera();
  $('rpBar').style.width = (rp.t / dur * 100).toFixed(1) + '%';
  $('rpTime').textContent = `${fmt(rp.t)} / ${fmt(dur)}`;
  $('rpSpeed').innerHTML = rp.paused ? `${icon('pause')}暫停` : `${icon('play')}${rp.speed}x`;
  $('rpTarget').textContent = rp.target.name;
  $('rpShot').textContent = SHOT_NAME[SHOTS[rp.shot]];
}
function replayCamera() {
  const c = rp.target, fx = Math.sin(c.h), fz = Math.cos(c.h), rx = -fz, rz = fx;
  const shot = SHOTS[rp.shot];
  let fov = 55, lookY = 0.9;
  if (shot === 'tv') {
    // 賽道旁的固定攝影機，車子開過去後換下一台
    if (!rp.tv || (rp.tv.x - c.pos.x) * fx + (rp.tv.z - c.pos.z) * fz < -45) {
      const j = (c.idx + 45) % N, side = Math.random() < 0.5 ? 1 : -1;
      rp.tv = new THREE.Vector3(P[j].x + NR[j].x * side * (WALL + 6), 3 + Math.random() * 4, P[j].z + NR[j].z * side * (WALL + 6));
    }
    camera.position.copy(rp.tv);
    fov = clamp(2 * Math.atan(5 / camera.position.distanceTo(c.pos)) * 180 / Math.PI, 7, 60);
  } else if (shot === 'chase') {
    camera.position.set(c.pos.x - fx * 7, 2.6, c.pos.z - fz * 7);
    camera.lookAt(c.pos.x + fx * 5, 1, c.pos.z + fz * 5);
    camera.fov = 60; camera.updateProjectionMatrix();
    return;
  } else if (shot === 'side') {
    camera.position.set(c.pos.x + rx * 6.5 + fx * 1.5, 1.1, c.pos.z + rz * 6.5 + fz * 1.5);
  } else if (shot === 'heli') {
    camera.position.set(c.pos.x - fx * 24 + rx * 9, 17, c.pos.z - fz * 24 + rz * 9);
    fov = 40;
  } else {
    camera.position.set(c.pos.x - fx * 4.2 + rx * 1.3, 0.5, c.pos.z - fz * 4.2 + rz * 1.3);
    fov = 65; lookY = 0.7;
  }
  camera.lookAt(c.pos.x, lookY, c.pos.z);
  camera.fov = fov; camera.updateProjectionMatrix();
  post.speed.uniforms.amount.value = 0;
  sun.position.copy(c.pos).add(SUN_OFF); sun.target.position.copy(c.pos);
}

// ================= 拍照模式 =================
let photo = null;
const held = new Set();
addEventListener('keydown', e => held.add(e.code));
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => held.clear());
const FILTERS = {
  none: { sat: 1, con: 1, tint: [1, 1, 1], vig: 0.35 },
  bw: { sat: 0, con: 1.18, tint: [1, 1, 1], vig: 0.55 },
  retro: { sat: 0.7, con: 0.95, tint: [1.12, 1.0, 0.78], vig: 0.65 },
  cinema: { sat: 0.85, con: 1.22, tint: [0.94, 1.0, 1.1], vig: 0.6 },
  neon: { sat: 1.6, con: 1.1, tint: [1.06, 0.88, 1.18], vig: 0.45 },
};
function applyFilter(name) {
  const f = FILTERS[name], u = post.speed.uniforms;
  u.saturation.value = f.sat; u.contrast.value = f.con; u.tint.value.set(...f.tint); u.vignette.value = f.vig;
}
function enterPhoto() {
  const c = player;
  photo = { yaw: c.h + Math.PI + 0.7, pitch: 0.22, dist: 7.5, fov: 50 };
  $('photoFov').value = 50;
  $('pausemenu').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('photohud').classList.remove('hidden');
  $('boostfx').style.opacity = 0;
  post.speed.uniforms.amount.value = 0; post.speed.uniforms.aberration.value = 0;
}
function exitPhoto() {
  photo = null;
  applyFilter('none');
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === 'none'));
  $('photohud').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('pausemenu').classList.remove('hidden');
  updateCamera(0);
}
function updatePhotoCam(dt) {
  const p = photo, k = dt * 1.4;
  if (held.has('KeyA')) p.yaw -= k;
  if (held.has('KeyD')) p.yaw += k;
  if (held.has('KeyW')) p.pitch += k * 0.6;
  if (held.has('KeyS')) p.pitch -= k * 0.6;
  if (held.has('KeyQ')) p.dist *= 1 - dt;
  if (held.has('KeyE')) p.dist *= 1 + dt;
  p.pitch = clamp(p.pitch, 0.02, 1.45);
  p.dist = clamp(p.dist, 2.5, 45);
  const c = player.pos;
  camera.position.set(c.x + Math.sin(p.yaw) * Math.cos(p.pitch) * p.dist, 0.25 + Math.sin(p.pitch) * p.dist, c.z + Math.cos(p.yaw) * Math.cos(p.pitch) * p.dist);
  camera.lookAt(c.x, 0.75, c.z);
  camera.fov = p.fov; camera.updateProjectionMatrix();
}
{
  let drag = null;
  $('game').addEventListener('pointerdown', e => { if (photo) drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => {
    if (!photo || !drag) return;
    photo.yaw -= (e.clientX - drag.x) * 0.006;
    photo.pitch += (e.clientY - drag.y) * 0.004;
    drag = { x: e.clientX, y: e.clientY };
  });
  $('game').addEventListener('wheel', e => { if (photo) { photo.dist *= 1 + e.deltaY * 0.001; e.preventDefault(); } }, { passive: false });
}
function savePhoto() {
  render(0);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `turbo-overdose-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  a.click();
  const fl = $('flash');
  fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  beep(1800, 0.05, 'square', 0.15);
}

// ================= 線上：排行榜與多人連線 =================
let net = null, room = null, roomCode = null, roomUnsub = null, statesUnsub = null;
const netCars = new Map();
let remoteStates = {}, sendTimer = 0, onlineResultsTimer = 0, onlineRewarded = false;
const tmpN = new THREE.Vector3();
const isHost = () => !!(room && net && room.host === net.uid);
const myInfo = () => ({ name: prof.name, car: prof.car, style: carById(prof.car).style, color: playerColor() });
async function ensureNet() {
  if (!net) net = await connect();
  return net;
}
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.innerHTML = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function submitOnline(track, time) {
  if (!onlineAvailable) return;
  ensureNet()
    .then(n => n.submitLap(track, { name: prof.name, time, car: carById(prof.car).name }))
    .then(ok => { if (ok) toast(icon('upload') + '已上傳到線上排行榜'); })
    .catch(() => {});
}

// ---- 線上大廳入口 ----
function openOnline(msg = '') {
  $('nickInput').value = prof.name;
  const status = !onlineAvailable
    ? '線上功能尚未設定：請依照專案裡的 FIREBASE_SETUP.md 建立 Firebase 專案，並把設定貼進 firebase-config.js。'
    : onlineLocal ? '本機測試模式：同一台電腦開兩個分頁就能互相連線。' : '';
  $('onlineStatus').textContent = msg || status;
  for (const id of ['createRoomBtn', 'joinRoomBtn']) $(id).disabled = !onlineAvailable;
  showScreen('online');
}
$('nickInput').onchange = e => {
  prof.name = e.target.value.trim().slice(0, 12) || prof.name;
  e.target.value = prof.name;
  saveProfile(prof);
};
async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { $('onlineStatus').innerHTML = icon('warn') + escapeHtml(e.message || e); } finally { btn.disabled = false; }
}
$('createRoomBtn').onclick = e => withBusy(e.currentTarget, async () => {
  $('onlineStatus').textContent = '連線中…';
  await ensureNet();
  roomCode = await net.createRoom(myInfo(), 'valley');
  enterLobby();
});
$('joinRoomBtn').onclick = e => withBusy(e.currentTarget, async () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) throw new Error('請輸入 4 碼房間代碼');
  $('onlineStatus').textContent = '連線中…';
  await ensureNet();
  await net.joinRoom(code, myInfo());
  roomCode = code;
  enterLobby();
});
$('codeInput').onkeydown = e => { if (e.key === 'Enter') $('joinRoomBtn').click(); e.stopPropagation(); };
$('nickInput').onkeydown = e => e.stopPropagation();

// ---- 房間 ----
function enterLobby() {
  roomUnsub?.();
  room = null;
  showScreen('lobby');
  roomUnsub = net.onRoom(roomCode, onRoomUpdate);
}
function onRoomUpdate(r) {
  const prev = room;
  room = r;
  if (!r) return leaveOnline('房主離開了，房間已解散。');
  if (!r.players?.[net.uid]) return leaveOnline('你已不在這個房間。');
  if (openScreen() === 'lobby') renderLobby();
  if (r.state === 'racing' && (session.mode !== 'online' || session.race !== r.race) && (!prev || prev.state !== 'racing' || prev.race !== r.race)) startOnlineRace();
}
const roomPlayers = () => Object.entries(room?.players || {}).sort((a, b) => a[1].joined - b[1].joined);
function renderLobby() {
  $('roomCode').textContent = roomCode;
  $('lobbyPlayers').innerHTML = roomPlayers().map(([uid, p]) =>
    `<div class="lp"><span class="dot" style="background:${hex(p.color)}"></span><b>${escapeHtml(p.name)}</b>${uid === room.host ? icon('crown', 'host') : ''}${uid === net.uid ? ' <span class="hl">（你）</span>' : ''}<small>${carById(p.car).name}</small></div>`
  ).join('');
  const host = isHost();
  $('lobbyTracks').innerHTML = '';
  for (const t of TRACKS) {
    const b = document.createElement('button');
    b.textContent = t.name;
    b.className = t.id === room.track ? 'on' : '';
    b.disabled = !host;
    b.onclick = () => net.updateRoom(roomCode, { track: t.id });
    $('lobbyTracks').appendChild(b);
  }
  const n = roomPlayers().length;
  $('startOnlineBtn').classList.toggle('hidden', !host);
  $('startOnlineBtn').textContent = n < 2 ? '開始比賽（目前只有你）' : `開始比賽（${n} 人）`;
  $('lobbyHint').textContent = host ? '把房間代碼告訴朋友，他們在「線上對戰」輸入代碼就能加入（最多 6 人）。' : '等待房主選擇賽道並開始比賽…';
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
$('startOnlineBtn').onclick = () => net.updateRoom(roomCode, { state: 'racing', startAt: net.serverNow() + 7000, race: (room.race || 0) + 1 });
$('leaveRoomBtn').onclick = () => leaveOnline();
async function leaveOnline(msg) {
  roomUnsub?.(); statesUnsub?.();
  roomUnsub = statesUnsub = null;
  const code = roomCode, host = isHost(), inRoom = room?.players?.[net?.uid];
  roomCode = null; room = null;
  if (code && inRoom) await net.leaveRoom(code, host).catch(() => {});
  if (state !== 'menu' && state !== 'garage') { goMenu(); clearNetCars(); }
  openOnline(msg);
}
function clearNetCars() {
  for (const c of netCars.values()) {
    scene.remove(c.model.root);
    c.model.root.traverse(o => { if (o.material?.isMeshPhysicalMaterial) o.material.dispose(); });
  }
  netCars.clear();
  field = cars;
}

// ---- 線上比賽 ----
function startOnlineRace() {
  const order = roomPlayers();
  for (const c of netCars.values()) scene.remove(c.model.root);
  netCars.clear();
  for (const [uid, p] of order) {
    if (uid === net.uid) continue;
    const e = makeEntity(p.name, p.color, false, 1, p.style, false);
    e.net = true; e.uid = uid;
    netCars.set(uid, e);
  }
  remoteStates = {};
  statesUnsub?.();
  statesUnsub = net.onStates(roomCode, m => { remoteStates = m; });
  onlineRewarded = false;
  startRace({ mode: 'online', track: room.track, diff: 'normal', grid: order.map(([uid]) => uid), startAt: room.startAt, race: room.race });
}
function updateNet(dt) {
  if (session.mode !== 'online' || !net || !roomCode) return;
  if ((sendTimer -= dt) <= 0) {
    sendTimer = 1 / 15;
    const p = player;
    net.sendState(roomCode, {
      x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), h: +p.h.toFixed(3), st: +p.steerVis.toFixed(2), v: +p.fwd.toFixed(1),
      f: (p.boosting ? 1 : 0) | (p.braking ? 2 : 0), c: p.cross, i: p.idx, fin: p.finished ? +p.finishTime.toFixed(3) : 0, t: net.serverNow()
    });
  }
  const now = net.serverNow(), k = 1 - Math.exp(-12 * dt);
  for (const [uid, c] of netCars) {
    const s = remoteStates[uid];
    if (!s) continue;
    // 依最後收到的速度往前推算，再平滑靠過去，避免 15Hz 更新造成的頓挫
    const age = clamp((now - s.t) / 1000, 0, 0.5);
    tmpN.set(s.x + Math.sin(s.h) * s.v * age, 0, s.z + Math.cos(s.h) * s.v * age);
    if (c.pos.distanceTo(tmpN) > 15) c.pos.copy(tmpN); else c.pos.lerp(tmpN, k);
    let dh = s.h - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    c.h += dh * k;
    c.vel.set(Math.sin(c.h) * s.v, 0, Math.cos(c.h) * s.v);
    c.fwd = s.v; c.steerVis = s.st;
    c.boosting = !!(s.f & 1); c.braking = !!(s.f & 2);
    c.cross = s.c; c.idx = s.i; c.s = s.i * ds;
    if (s.fin && !c.finished) { c.finished = true; c.finishTime = s.fin; }
    c.model.root.visible = now - s.t < 5000;
  }
}
function renderOnlineResults() {
  const order = standings();
  const me = order.indexOf(player) + 1;
  $('resTitle').innerHTML = me === 1 ? `${icon('trophy')}冠軍！` : `第 ${me} 名`;
  $('resSub').textContent = `${worldDef(session.track).name} · 線上對戰 · 房間 ${roomCode || ''}`;
  $('resTable').innerHTML = order.map((c, i) => {
    const time = c.finished ? fmt(c.finishTime) : '比賽中…';
    return `<tr class="${c.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${hex(c.color)}"></span>${escapeHtml(c.isPlayer ? prof.name : c.name)}</td><td>${time}</td></tr>`;
  }).join('');
  if (!onlineRewarded) {
    onlineRewarded = true;
    const earned = field.length > 1 ? PRIZE[me - 1] * (1 + 0.1 * (field.length - 1)) : 0;
    prof.money += earned;
    saveProfile(prof);
    $('resNotes').innerHTML = (earned ? `<div>${icon('coin')}獎金 <b class="hl">+${money(earned)}</b></div>` : '<div>一個人跑不發獎金，找朋友一起來吧！</div>') + `<div>最佳單圈：${fmt(bestLap)}</div>`;
    const box = $('resBtns'); box.innerHTML = '';
    for (const [label, fn, go] of [['回房間', backToLobby, true], [icon('film') + '觀看重播', enterReplay], ['離開房間', () => leaveOnline()]]) {
      const b = document.createElement('button');
      b.innerHTML = label; if (go) b.className = 'go';
      b.onclick = fn; box.appendChild(b);
    }
  }
}
function backToLobby() {
  if (!roomCode) return openOnline('房間已不存在。');
  fadeThen(() => {
    state = 'menu'; paused = false;
    silenceRace();
    $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
    document.body.classList.remove('boosting'); $('boostfx').style.opacity = 0;
    statesUnsub?.(); statesUnsub = null;
    clearNetCars();
    placeOnGrid();
    camera.fov = 60; camera.updateProjectionMatrix();
    music?.play('menu');
    if (isHost() && room.state === 'racing') net.updateRoom(roomCode, { state: 'lobby' });
    showScreen('lobby');
    renderLobby();
  });
}

// ---- 線上排行榜 ----
let boardTrack = 'valley';
async function openBoard() {
  showScreen('board');
  $('boardTabs').innerHTML = '';
  for (const t of TRACKS) {
    const b = document.createElement('button');
    b.textContent = t.name; b.className = t.id === boardTrack ? 'on' : '';
    b.onclick = () => { boardTrack = t.id; openBoard(); };
    $('boardTabs').appendChild(b);
  }
  const list = $('boardList');
  if (!onlineAvailable) { list.innerHTML = '<p class="muted">線上功能尚未設定：請依照專案裡的 FIREBASE_SETUP.md 建立 Firebase 專案，並把設定貼進 firebase-config.js。</p>'; return; }
  list.innerHTML = '<p class="muted">載入中…</p>';
  try {
    await ensureNet();
    // 把本機最佳成績補上傳（如果比線上紀錄好）
    for (const t of TRACKS) if (prof.best[t.id]) await net.submitLap(t.id, { name: prof.name, time: prof.best[t.id], car: carById(prof.car).name });
    const rows = await net.topLaps(boardTrack, 20);
    list.innerHTML = rows.length
      ? `<table>${rows.map((r, i) => `<tr class="${r.uid === net.uid ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td><small>${escapeHtml(r.car || '')}</small></td><td>${fmt(r.time)}</td></tr>`).join('')}</table>`
      : '<p class="muted">這條賽道還沒有人上榜，跑一圈搶第一吧！</p>';
  } catch (e) {
    list.innerHTML = `<p class="muted">${icon('warn')}讀取失敗：${escapeHtml(e.message || e)}</p>`;
  }
}

// ================= 自由駕駛（城市） =================
const CITY_SURF = { grip: 1, drag: 0, kind: 'road' };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const TRAFFIC_STYLES = ['gt', 'muscle', 'blade', 'gt', 'hyper', 'muscle'];
let traffic = [], odometer = 0, topSpeed = 0;
const inGrid = (i, j) => i >= 0 && j >= 0 && i <= W.grid && j <= W.grid;
function clearTraffic() {
  for (const e of traffic) scene.remove(e.model.root);
  traffic = [];
}
// 車流沿著街道行駛，到路口隨機轉彎（不迴轉），靠右行駛
function trafficTarget(e, out) {
  const tr = e.tr, [dx, dz] = DIRS[tr.dir];
  const x = W.node(tr.i) + dx * W.cell * tr.t, z = W.node(tr.j) + dz * W.cell * tr.t;
  out.set(x - dz * 3.5, 0, z + dx * 3.5);
  return Math.atan2(dx, dz);
}
function spawnTraffic() {
  clearTraffic();
  const n = quality === 'low' ? 7 : 14;
  for (let k = 0; k < n; k++) addTrafficCar(k);
}
function addTrafficCar(k = Math.random() * 6 | 0) {
  const e = makeEntity('', COLORS[Math.random() * COLORS.length | 0], false, 1, TRAFFIC_STYLES[k % TRAFFIC_STYLES.length], false);
  let i, j, dir;
  do {
    i = Math.random() * (W.grid + 1) | 0; j = Math.random() * (W.grid + 1) | 0; dir = Math.random() * 4 | 0;
  } while (!inGrid(i + DIRS[dir][0], j + DIRS[dir][1]) || Math.hypot(W.node(i) - player.pos.x, W.node(j) - player.pos.z) < 60);
  e.tr = { i, j, dir, t: Math.random(), speed: 10 + Math.random() * 7, v: 0, wait: 0 };
  e.h = trafficTarget(e, e.pos);
  traffic.push(e);
}
function updateTraffic(dt) {
  for (const e of traffic) {
    const tr = e.tr, [dx, dz] = DIRS[tr.dir];
    const px = player.pos.x - e.pos.x, pz = player.pos.z - e.pos.z;
    // 前方有玩家就減速停下
    const ahead = px * dx + pz * dz, side = Math.abs(-px * dz + pz * dx);
    tr.wait -= dt;
    let want = tr.wait > 0 ? 0 : tr.speed;
    if (ahead > 0 && ahead < 16 && side < 3.5) want = Math.min(want, Math.max(0, ahead - 7));
    tr.v += clamp(want - tr.v, -14 * dt, 4 * dt);
    tr.t += tr.v * dt / W.cell;
    if (tr.t >= 1) {
      tr.i += dx; tr.j += dz; tr.t -= 1;
      const opts = [0, 1, 2, 3].filter(d => d !== (tr.dir + 2) % 4 && inGrid(tr.i + DIRS[d][0], tr.j + DIRS[d][1]));
      tr.dir = opts.includes(tr.dir) && Math.random() < 0.55 ? tr.dir : opts[Math.random() * opts.length | 0];
    }
    const h = trafficTarget(e, tmpV);
    e.pos.lerp(tmpV, 1 - Math.exp(-5 * dt));
    let dh = h - e.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    e.h += dh * Math.min(1, 4 * dt);
    e.steerVis = clamp(dh * 1.5, -0.5, 0.5);
    e.fwd = tr.v;
    e.vel.set(Math.sin(e.h) * tr.v, 0, Math.cos(e.h) * tr.v);
    e.braking = want < tr.v - 0.3;
    // 太遠的車不畫，省效能
    const near = px * px + pz * pz < 260 * 260;
    e.model.root.visible = near;
    if (near) syncModel(e, dt);
  }
}
function hitResponse(c, nx, nz) {
  // (nx, nz) 指向離開障礙物的方向
  const vn = c.vel.x * nx + c.vel.z * nz;
  if (vn >= 0) return;
  c.vel.x -= nx * vn * 1.3; c.vel.z -= nz * vn * 1.3;
  c.vel.multiplyScalar(0.86);
  c.veh.r *= 0.4;
  const hit = -vn;
  if (hit > 3 && c === player) ow.damage((hit - 3) * 2.2);
  if (hit > 3 && c === player) {
    shake = Math.min(1, hit / 25);
    crash(Math.min(1, hit / 20));
    rumble(Math.min(1, hit / 20), 0.6, 220);
    tmpV.set(c.pos.x - nx * 1.3, 0.5, c.pos.z - nz * 1.3);
    sparks.emit(tmpV, c.vel, 22);
  }
}
function collideCity(c) {
  const R = 1.5;
  // 開上人行道時車身墊高
  c.lift = (c.lift || 0) + ((W.blockOf(c.pos.x, c.pos.z) ? 0.25 : 0) - (c.lift || 0)) * 0.35;
  for (const blk of W.blockAt(c.pos.x, c.pos.z)) for (const b of blk.buildings) {
    const px = clamp(c.pos.x, b.x0, b.x1), pz = clamp(c.pos.z, b.z0, b.z1);
    const dx = c.pos.x - px, dz = c.pos.z - pz, d = Math.hypot(dx, dz);
    if (d >= R) continue;
    let nx, nz, push;
    if (d < 1e-4) {
      // 整台車卡進街區裡：往最近的一邊推出去
      const [pen, ax, az] = [[c.pos.x - b.x0, -1, 0], [b.x1 - c.pos.x, 1, 0], [c.pos.z - b.z0, 0, -1], [b.z1 - c.pos.z, 0, 1]].sort((a, b2) => a[0] - b2[0])[0];
      nx = ax; nz = az; push = pen + R;
    } else { nx = dx / d; nz = dz / d; push = R - d; }
    c.pos.x += nx * push; c.pos.z += nz * push;
    hitResponse(c, nx, nz);
  }
  const lim = W.edge - 0.3 - R;
  if (c.pos.x > lim) { c.pos.x = lim; hitResponse(c, -1, 0); }
  if (c.pos.x < -lim) { c.pos.x = -lim; hitResponse(c, 1, 0); }
  if (c.pos.z > lim) { c.pos.z = lim; hitResponse(c, 0, -1); }
  if (c.pos.z < -lim) { c.pos.z = -lim; hitResponse(c, 0, 1); }
}
function collideTraffic() {
  const p = player;
  for (const e of traffic) {
    const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d2 = dx * dx + dz * dz;
    if (d2 > (CAR_R * 2) ** 2 || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = CAR_R * 2 - d;
    p.pos.x += nx * over; p.pos.z += nz * over;
    const vn = (p.vel.x - e.vel.x) * nx + (p.vel.z - e.vel.z) * nz;
    if (vn < 0) {
      p.vel.x -= nx * vn * 1.3; p.vel.z -= nz * vn * 1.3;
      p.veh.r += (nx * Math.cos(p.h) - nz * Math.sin(p.h)) * vn * 0.02;
      if (-vn > 4) {
        crash(Math.min(1, -vn / 15)); shake = Math.min(1, -vn / 20);
        rumble(Math.min(1, -vn / 15), 0.5, 180);
        tmpV.set(p.pos.x - nx * CAR_R, 0.7, p.pos.z - nz * CAR_R);
        sparks.emit(tmpV, p.vel, 18);
        ow.damage((-vn - 4) * 1.8);
      }
    }
    e.tr.wait = 2; e.tr.v = 0;
  }
}
// 按 R：放回最近一條街的右側車道，車頭朝原本比較接近的方向
function resetCity(c) {
  const i = clamp(Math.round((c.pos.x - W.origin) / W.cell), 0, W.grid);
  const j = clamp(Math.round((c.pos.z - W.origin) / W.cell), 0, W.grid);
  const lim = W.edge - 6;
  let h;
  if (Math.abs(c.pos.x - W.node(i)) < Math.abs(c.pos.z - W.node(j))) {
    const dir = Math.cos(c.h) >= 0 ? 1 : -1;
    c.pos.x = W.node(i) - dir * 3.5; c.pos.z = clamp(c.pos.z, -lim, lim);
    h = dir > 0 ? 0 : Math.PI;
  } else {
    const dir = Math.sin(c.h) >= 0 ? 1 : -1;
    c.pos.z = W.node(j) + dir * 3.5; c.pos.x = clamp(c.pos.x, -lim, lim);
    h = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  c.h = h; c.veh.reset(h); c.veh.manual = !!settings.manual; c.fwd = 0;
  skids.last.clear();
}

// ================= 開放世界整合 =================
const PARKED = { throttle: 0, brake: 0, steer: 0, hand: true, nitro: false };
function makeCop() {
  const e = makeEntity('警車', 0xf2f2f2, false, 1, 'gt', false);
  const bar = (color, x) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
    m.position.set(x, 1.55, -0.4);
    e.model.chassis.add(m);
    return m;
  };
  e.model.lightR = bar(0xff2020, 0.3);
  e.model.lightB = bar(0x2060ff, -0.3);
  e.veh = new Vehicle(e.pos, e.vel, buildSpec('gt'));
  return e;
}
// 接手另一台車（搶車、上停著的車）
function takeCar(model, carId, pos, h) {
  player.model = model;
  model.stolen = true;
  if (!model.boostLight) {
    model.boostLight = new THREE.PointLight(0x55bbff, 0, 9, 2);
    model.boostLight.position.set(0, 0.6, -3.2);
    model.root.add(model.boostLight);
  }
  applyCarQuality(model);
  player.color = model.paint.color.getHex();
  player.pos.copy(pos); player.h = h; player.lift = 0;
  player.veh = new Vehicle(player.pos, player.vel, buildSpec(carId, prof.upgrades[carId]));
  player.veh.reset(h);
  player.veh.manual = !!settings.manual;
  camH = h;
}
const ow = createOpenWorld({
  scene, camera, player, $, prof,
  W: () => W, state: () => state, quality: () => quality, traffic: () => traffic, audio: () => audio,
  makeCop, takeCar, syncModel, collideCity,
  makeRacer: (style, color) => { const e = makeEntity('對手', color, false, 1, style, false); e.veh = new Vehicle(e.pos, e.vel, buildSpec(style === 'muscle' ? 'brute' : style)); return e; },
  smoke: (pos, color, size, op, vel) => smoke.emit(pos, color, size, op, vel),
  boom: pos => {
    burst(80, 0.9, 1); burst(400, 0.5, 0.7); burst(2000, 0.25, 0.3);
    for (let k = 0; k < 26; k++) {
      tmpV.set(pos.x + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 2.5, pos.z + (Math.random() - 0.5) * 3);
      smoke.emit(tmpV, k % 3 ? 0x2a2a2a : 0xff8a1f, 2.5 + Math.random() * 2, 0.9);
    }
    tmpV.set(pos.x, 1, pos.z); sparks.emit(tmpV, player.vel, 60);
    shake = 1; rumble(1, 1, 600);
    const fl = $('flash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  },
  // 被搶走的車：只從車流名單移除（模型交給玩家繼續用），再補一台新的車流
  removeTraffic: c => { traffic.splice(traffic.indexOf(c), 1); c.model.root.visible = true; addTrafficCar(); },
  respawn: () => { const sp = W.spawn; player.pos.set(sp.x, 0, sp.z); player.h = sp.h; player.veh.reset(sp.h); player.veh.manual = !!settings.manual; camH = sp.h; camInit = false; },
  saveProfile: () => saveProfile(prof),
  showCenter, toast: msg => toast(msg), beep, crash,
  shake: v => { shake = Math.max(shake, v); },
  thump: v => { burst(160, 0.2, 0.55 * v); burst(900, 0.06, 0.2 * v); },
  door: () => { burst(320, 0.07, 0.3); burst(1400, 0.03, 0.12, 0.07); },
});

// ================= 日夜循環（城市） =================
// 一個遊戲小時 = 20 秒，一整天約 8 分鐘；從下午四點開始
let timeOfDay = 16, envTimer = 0, nightNow = 0;
const DAY_COLORS = { fogDay: new THREE.Color(), fogNight: new THREE.Color(0x0a0f1e), sunDay: new THREE.Color(), sunSet: new THREE.Color(0xff8a4a) };
function updateDayNight(dt, force = false) {
  timeOfDay = (timeOfDay + dt / 20) % 24;
  const th = W.def.theme;
  const elev = 62 * Math.sin((timeOfDay - 6) / 12 * Math.PI);           // 6 點日出、18 點日落
  const az = THREE.MathUtils.degToRad(th.sky.azimuth + (timeOfDay - 12) * 8);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(elev, -10)), az);
  const n = clamp((4 - elev) / 12, 0, 1);                               // 夜晚程度
  nightNow = n;
  W.sunDir.copy(dir);
  SUN_OFF.copy(dir).multiplyScalar(300);
  skySys.sky.material.uniforms.sunPosition.value.copy(dir).multiplyScalar(1000);
  const day = clamp(elev / 18, 0, 1);
  DAY_COLORS.sunDay.set(th.sun[0]);
  sun.color.copy(DAY_COLORS.sunSet).lerp(DAY_COLORS.sunDay, day);
  sun.intensity = th.sun[1] * clamp(elev / 10, 0, 1);
  sun.castShadow = elev > 2;
  moon.intensity = n * 0.55;
  hemi.intensity = THREE.MathUtils.lerp(th.hemi[2], 0.32, n);
  hemi.color.set(th.hemi[0]).lerp(DAY_COLORS.fogNight, n * 0.6);
  DAY_COLORS.fogDay.set(th.fog[0]);
  scene.fog.color.copy(DAY_COLORS.fogDay).lerp(DAY_COLORS.fogNight, n);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(th.exposure, 0.85, n);
  W.setNight(n);
  setHeadlights(n);
  // 環境反射每 4 秒重算一次（太常算會掉格）
  if ((envTimer -= dt) <= 0 || force) { envTimer = 4; skySys.set(th.sky, dir, th.envGround); }
}
function resetDayTime() {
  timeOfDay = 16; nightNow = 0;
  setHeadlights(0);
}
function cityBeams() {
  const on = nightNow > 0.25;
  for (const c of [...traffic, ...ow.cars()]) c.model.beam.visible = on;
  player.model.beam.visible = on && !ow.onFoot && !player.model.wreck;
}

// ================= 手排換檔 =================
function shiftGear(dir) {
  const v = player.veh;
  if (!v?.manual || player.ai || (state !== 'race' && state !== 'countdown') || paused) return;
  if (v.shift(dir)) { burst(260, 0.05, 0.22); if (dir > 0 && v.rpm > 5500 && Math.random() < 0.6) backfire(); }
  else beep(140, 0.08, 'square', 0.1);
}
function setTransmission(manual) {
  settings.manual = manual;
  saveSettings();
  if (player.veh) {
    player.veh.manual = manual;
    if (!manual && player.veh.gear === -1) player.veh.gear = 1;
  }
  $('touch').classList.toggle('manual', manual);
}

// ================= 遊戲中的操作提示 =================
// 依目前情境（比賽 / 手排 / 自由駕駛 / 步行）與最後使用的輸入裝置（鍵盤 / 搖桿 / 觸控）顯示對應按鍵
let lastInput = isTouch ? 'touch' : 'kb', hintSig = '', hintShownAt = 0;
addEventListener('keydown', () => { lastInput = 'kb'; }, true);
$('touch').addEventListener('pointerdown', () => { lastInput = 'touch'; }, true);
const PAD_NAME = { 'W': 'RT', 'S': 'LT', 'A D': '左搖桿', 'Space': 'B', 'Shift': 'A', 'E Q': 'RB LB', 'F': 'Y', 'R': 'Back', 'C': 'Y', 'P': 'Start', 'W S': 'RT LT' };
function hintItems() {
  const free = session.mode === 'free', foot = free && ow.onFoot, manual = !!settings.manual && !foot;
  if (lastInput === 'touch') {
    if (foot) return [['方向盤', '轉向'], ['油門 / 煞車', '前進 / 後退'], ['氮氣瓶', '跑步'], ['拉桿', '跳'], ['車門鈕', '上車']];
    const t = [['方向盤', '左右拖曳轉向'], ['踏板', '油門 / 煞車'], ['拉桿', '甩尾'], ['氮氣瓶', '加速']];
    if (manual) t.push(['撥片', '換檔']);
    if (free) t.push(['車門鈕', '下車']);
    return t;
  }
  let k;
  if (foot) k = [['W S', '走 / 退'], ['A D', '轉向'], ['Shift', '跑'], ['Space', '跳'], ['F', '上車 / 搶車']];
  else {
    k = [['W', '油門'], ['S', '煞車'], ['A D', '轉向'], ['Space', '甩尾'], ['Shift', '氮氣']];
    if (manual) k.push(['E Q', '升 / 降檔']);
    k.push(free ? ['F', '下車'] : ['R', '回賽道']);
    if (!(free && lastInput === 'pad')) k.push(['C', '視角']);
  }
  k.push(['P', '暫停']);
  if (lastInput === 'pad') return k.map(([key, what]) => [PAD_NAME[key] || key, what]);
  k.push(['H', '隱藏提示']);
  return k;
}
function updateCtrlHint() {
  const el = $('ctrlhint');
  const free = session.mode === 'free', foot = free && ow.onFoot;
  const sig = [settings.hints !== false, lastInput, session.mode, foot, !!settings.manual].join('|');
  if (sig !== hintSig) {
    hintSig = sig; hintShownAt = performance.now();
    el.className = lastInput;
    el.innerHTML = settings.hints === false ? '' : hintItems().map(([key, what]) =>
      lastInput === 'touch' ? `<span class="kc"><b>${key}</b>${what}</span>` : `<span class="kc">${key.split(' ').map(x => `<kbd>${x}</kbd>`).join('')}${what}</span>`).join('');
  }
  // 情境剛改變時完整顯示；鍵盤 / 搖桿之後變淡，觸控幾秒後收起
  const age = (performance.now() - hintShownAt) / 1000;
  el.classList.toggle('dim', lastInput !== 'touch' && age > 8);
  el.classList.toggle('gone', lastInput === 'touch' && age > 8);
}
function toggleHints() {
  settings.hints = settings.hints === false;
  saveSettings();
  document.querySelectorAll('#hintsSet button').forEach(b => b.classList.toggle('on', (b.dataset.h === 'on') === settings.hints));
  toast(settings.hints ? '操作提示：顯示' : '操作提示：隱藏（按 H 再打開）');
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
  if (state === 'intro') {
    updateIntro(dt);
    for (const c of field) syncModel(c, dt);
    updateAudio(NO_INPUT, { squeal: 0, curb: false });
    return;
  }
  if (state === 'replay') { updateReplay(dt); smoke.update(dt); return; }
  if (state === 'results') {
    menuAngle += dt * 0.15;
    const c = player.pos;
    camera.position.set(c.x + Math.cos(menuAngle) * 10, 3.2, c.z + Math.sin(menuAngle) * 10);
    camera.lookAt(c.x, 0.8, c.z);
    camera.fov = 50; camera.updateProjectionMatrix();
    post.speed.uniforms.amount.value = 0;
    return;
  }
  if (state === 'garage') {
    // 車庫：鏡頭繞著玩家的車轉
    menuAngle += dt * 0.25;
    const c = player.pos;
    camera.position.set(c.x + Math.cos(menuAngle) * 8.5, 2.4, c.z + Math.sin(menuAngle) * 8.5);
    camera.lookAt(c.x, 0.7, c.z);
    if (Math.abs(camera.fov - 45) > 0.1) { camera.fov = 45; camera.updateProjectionMatrix(); }
    sun.position.copy(c).add(SUN_OFF); sun.target.position.copy(c);
    post.speed.uniforms.amount.value = 0;
    for (const w of player.model.wheels) w.rotation.x = 0;
    return;
  }
  if (paused) { if (photo) updatePhotoCam(dt); return; }

  const ctl = readControls();
  let fx = { squeal: 0, curb: false };
  if (state === 'countdown') {
    cdTime = session.mode === 'online' ? (session.startAt - net.serverNow()) / 1000 : cdTime - dt;
    updateNet(dt);
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
    for (const c of field) syncModel(c, dt);
  } else {
    raceTime += dt;
    if (!player.ai) {
      const prev = player.idx;
      fx = updatePlayer(dt, ow.active && ow.onFoot ? PARKED : state === 'race' ? ctl : NO_INPUT);
      if (W.isCity) collideCity(player);
      else {
        collideWalls(player);
        trackPlayerLap(prev);
        const along = player.vel.dot(T[player.idx]);
        wrongWay = along < -4 ? wrongWay + dt : 0;
      }
    } else {
      player.boosting = player.braking = false;
    }
    for (const c of field) if (c.ai && !c.net) updateAI(c, dt);
    updateNet(dt);
    if (W.isCity) { updateTraffic(dt); collideTraffic(); collideCity(player); ow.update(dt, state === 'race' ? ctl : NO_INPUT); updateDayNight(dt); cityBeams(); }
    collideCars();
    if (!player.ai && !W.isCity) collideWalls(player);
    for (const c of field) syncModel(c, dt);
    updateGhost();
    recordFrame(dt);
    if (resultsTimer > 0 && (resultsTimer -= dt) <= 0) showResults();
    if (session.mode === 'online' && openScreen() === 'results' && (onlineResultsTimer -= dt) <= 0) { onlineResultsTimer = 1; renderOnlineResults(); }
  }
  if (centerTimer > 0 && (centerTimer -= dt) <= 0) showCenter('');
  smoke.update(dt);
  sparks.update(dt);
  updateCamera(dt);
  updateAudio(player.ai || (ow.active && ow.onFoot) ? NO_INPUT : ctl, fx);
  updateHUD();
}
function updateGhost() {
  if (session.mode !== 'tt') return;
  const t = raceTime - lapStart;
  // 錄製本圈
  if (player.cross >= 1 && !player.finished) {
    const k = Math.floor(t / GHOST_DT);
    if (ghostRec.length <= k) ghostRec.push([+player.pos.x.toFixed(2), +player.pos.z.toFixed(2), +player.h.toFixed(3)]);
  }
  // 播放最佳圈
  const show = ghost && player.cross >= 1 && !player.finished && ghost.pts.length > 1;
  ghostModel.root.visible = !!show;
  if (!show) return;
  const f = t / GHOST_DT, i = Math.floor(f);
  if (i >= ghost.pts.length - 1) { ghostModel.root.visible = false; return; }
  const a = ghost.pts[i], b = ghost.pts[i + 1], u = f - i;
  ghostModel.root.position.set(a[0] + (b[0] - a[0]) * u, ROAD_Y, a[1] + (b[1] - a[1]) * u);
  let dh = b[2] - a[2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  ghostModel.root.rotation.y = a[2] + dh * u;
}
function render(dt) {
  if (quality === 'low') renderer.render(scene, camera);
  else post.composer.render(dt);
}
function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  adaptResolution(raw);
  const dt = Math.min(raw, 0.05);
  update(dt);
  render(dt);
}

// ================= 選單與介面 =================
const SCREENS = ['menu', 'setup', 'career', 'garage', 'settings', 'results', 'online', 'lobby', 'board'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  $('pausemenu').classList.add('hidden');
  document.querySelectorAll('.money').forEach(e => { e.textContent = money(prof.money); });
}
const openScreen = () => SCREENS.find(s => !$(s).classList.contains('hidden'));
function silenceRace() {
  if (!audio) return;
  audio.ctx.resume();
  for (const g of [audio.eg, audio.wind.g, audio.squeal.g, audio.hiss.g, audio.growl.g, audio.tg, audio.rg]) g.gain.value = 0;
}
function toMenu() { fadeThen(goMenu); }
function goMenu() {
  state = 'menu'; paused = false; photo = null;
  clearTraffic();
  ow.stop();
  moon.intensity = 0; setHeadlights(0); sun.castShadow = true;
  player.model.beam.visible = false;
  $('speedo').classList.remove('hidden');
  $('photohud').classList.add('hidden'); $('replayhud').classList.add('hidden');
  applyFilter('none');
  music?.play('menu');
  silenceRace();
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
  document.body.classList.remove('boosting'); $('boostfx').style.opacity = 0;
  if (ghostModel) ghostModel.root.visible = false;
  camera.fov = 60; camera.updateProjectionMatrix();
  showScreen('menu');
}
const choose = (sel, attr, fn) => document.querySelectorAll(sel).forEach(b => b.onclick = () => {
  document.querySelectorAll(sel).forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  fn(b.dataset[attr]);
});

// ---- 主選單 ----
$('btnCareer').onclick = () => openCareer();
$('btnQuick').onclick = () => openSetup('quick');
$('btnTT').onclick = () => openSetup('tt');
$('btnGarage').onclick = () => openGarage();
$('btnSettings').onclick = () => showScreen('settings');
$('btnOnline').onclick = () => openOnline();
$('btnFree').onclick = () => startRace({ mode: 'free', track: 'city', diff: 'normal' });
$('btnBoard').onclick = () => openBoard();
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {
  if (state === 'garage') leaveGarage();
  showScreen('menu');
});

// ---- 賽道選擇（快速比賽 / 計時賽） ----
let setupMode = 'quick', setupTrack = 'valley', setupDiff = 'normal';
function openSetup(mode) {
  setupMode = mode;
  $('setupTitle').textContent = mode === 'tt' ? '計時賽' : '快速比賽';
  $('setupHint').textContent = mode === 'tt' ? '獨自跑 3 圈，挑戰自己的最佳單圈。破紀錄的那一圈會變成下次的幽靈車，並獲得獎金。' : '和 5 台 AI 跑 3 圈，名次越前面獎金越多，難度越高獎金越多。';
  $('setupDiffRow').classList.toggle('hidden', mode === 'tt');
  renderTrackList();
  showScreen('setup');
}
function drawTrackThumb(cv, t) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  const pts = new THREE.CatmullRomCurve3(t.ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal').getPoints(200);
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const k = Math.min((w - 16) / (maxX - minX), (h - 16) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * k) / 2, oz = (h - (maxZ - minZ) * k) / 2;
  g.fillStyle = t.theme.ground[0]; g.fillRect(0, 0, w, h);
  g.lineJoin = g.lineCap = 'round';
  g.beginPath();
  pts.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](ox + (p.x - minX) * k, oz + (p.z - minZ) * k));
  g.closePath();
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke();
  g.strokeStyle = '#33363c'; g.lineWidth = 3.5; g.stroke();
}
function renderTrackList() {
  const list = $('trackList');
  list.innerHTML = '';
  for (const t of TRACKS) {
    const b = document.createElement('button');
    b.className = 'trackcard' + (t.id === setupTrack ? ' on' : '');
    b.innerHTML = `<canvas width="120" height="90"></canvas><div><b>${t.name}</b><small>${t.desc}</small><small class="best">最佳單圈 ${fmt(prof.best[t.id] ?? Infinity)}${t.theme.grip < 0.9 ? ' · 低抓地' : ''}</small></div>`;
    drawTrackThumb(b.querySelector('canvas'), t);
    b.onclick = () => { setupTrack = t.id; renderTrackList(); };
    list.appendChild(b);
  }
}
choose('#diffs button', 'd', d => { setupDiff = d; });
$('setupStart').onclick = () => startRace({ mode: setupMode, track: setupTrack, diff: setupMode === 'tt' ? 'normal' : setupDiff });

// ---- 生涯 ----
const cupById = id => CUPS.find(c => c.id === id);
const cupStandings = () => Object.entries(prof.cup.points).sort((a, b) => b[1] - a[1]);
function openCareer() {
  const list = $('cupList');
  list.innerHTML = '';
  for (const cup of CUPS) {
    const locked = cup.requires && !prof.cupsWon.includes(cup.requires);
    const won = prof.cupsWon.includes(cup.id);
    const active = prof.cup?.id === cup.id;
    const div = document.createElement('div');
    div.className = 'cupcard' + (locked ? ' locked' : '') + (active ? ' active' : '');
    div.innerHTML = `<div class="cuphead"><b>${cup.name}</b><span class="tag">${DIFF_NAME[cup.diff]}</span>${won ? '<span class="tag gold">已奪冠</span>' : ''}</div>
      <small>${cup.tracks.map(id => trackById(id).name).join(' → ')}</small>
      <small>總冠軍獎金 ${money(cup.prize)}${active ? ` · 進行中：第 ${prof.cup.race + 1} / ${cup.tracks.length} 場` : ''}</small>`;
    const btn = document.createElement('button');
    btn.innerHTML = locked ? `${icon('lock')}先拿下${cupById(cup.requires).name}` : active ? '繼續' : prof.cup ? '改跑這個盃賽' : '開始';
    btn.disabled = !!locked;
    btn.className = 'small' + (!locked && (active || !prof.cup) ? ' go' : '');
    btn.onclick = () => {
      if (!active) prof.cup = { id: cup.id, race: 0, points: {} };
      saveProfile(prof);
      startCareerRace();
    };
    div.appendChild(btn);
    list.appendChild(div);
  }
  showScreen('career');
}
function startCareerRace() {
  const cup = cupById(prof.cup.id);
  startRace({ mode: 'career', cup: cup.id, track: cup.tracks[prof.cup.race], diff: cup.diff });
}

// ---- 車庫 ----
let garageSel = prof.car;
const statCache = {};
function carStats(carId) {
  const spec = buildSpec(carId, prof.upgrades[carId]);
  const key = carId + JSON.stringify(prof.upgrades[carId] || {});
  if (statCache[key]) return statCache[key];
  const v = new Vehicle(new THREE.Vector3(), new THREE.Vector3(), spec);
  v.reset(0);
  let t100 = 0;
  for (let i = 0; i < 120 * 45; i++) {
    v.step(1 / 120, { throttle: 1, brake: 0, steer: 0, hand: false, boost: false }, { grip: 1, drag: 0 });
    if (!t100 && v.u * 3.6 >= 100) t100 = i / 120;
  }
  return statCache[key] = { top: v.u * 3.6, t100, grip: spec.mu, nitro: spec.nitroThrust };
}
function showcase(carId) {
  // 把要展示的車放在起跑線前方
  const saved = prof.car;
  prof.car = carId;
  setPlayerCar();
  prof.car = saved;
  const i = 40;
  player.pos.copy(P[i]); player.h = Math.atan2(T[i].x, T[i].z);
  player.fwd = player.steerVis = player.roll = player.pitch = 0;
  player.boosting = player.braking = false;
  syncModel(player, 0);
}
function openGarage() {
  if (W.isCity) loadTrack('valley');
  state = 'garage';
  garageSel = prof.car;
  showcase(garageSel);
  renderGarage();
  showScreen('garage');
  // 面板在左邊（手機在下方），把畫面往右（上）推，車子才不會被擋住
  const w = innerWidth, h = innerHeight;
  if (w > 700) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
  else camera.setViewOffset(w, h, 0, h * 0.22, w, h);
}
function leaveGarage() {
  state = 'menu';
  camera.clearViewOffset();
  setPlayerCar();
  placeOnGrid();
  camera.fov = 60; camera.updateProjectionMatrix();
}
function renderGarage() {
  const car = carById(garageSel), owned = prof.owned.includes(car.id);
  document.querySelectorAll('.money').forEach(e => { e.textContent = money(prof.money); });
  $('carList').innerHTML = '';
  for (const c of CARS) {
    const b = document.createElement('button');
    b.className = 'carbtn' + (c.id === garageSel ? ' on' : '');
    const tag = prof.car === c.id ? '使用中' : prof.owned.includes(c.id) ? '已擁有' : money(c.price);
    b.innerHTML = `<b>${c.name}</b><small>${tag}</small>`;
    b.onclick = () => { garageSel = c.id; showcase(c.id); renderGarage(); };
    $('carList').appendChild(b);
  }
  const st = carStats(car.id);
  const bar = (label, val, text) => `<div class="statrow"><span>${label}</span><div class="bar"><i style="width:${clamp(val, 0.04, 1) * 100}%"></i></div><em>${text}</em></div>`;
  $('carInfo').innerHTML = `<h3>${car.name}</h3><p>${car.desc}</p>` +
    bar('極速', (st.top - 220) / 140, Math.round(st.top) + ' km/h') +
    bar('加速', (4.2 - st.t100) / 2.4, '0-100 ' + st.t100.toFixed(1) + ' 秒') +
    bar('抓地', (st.grip - 1.8) / 1.0, st.grip.toFixed(2) + ' G') +
    bar('氮氣', (st.nitro - 7000) / 6000, (st.nitro / 1000).toFixed(1) + ' kN');

  // 顏色
  $('garageColors').innerHTML = '';
  COLORS.forEach(col => {
    const b = document.createElement('button');
    b.className = 'swatch' + ((prof.colors[car.id] ?? COLORS[0]) === col ? ' on' : '');
    b.style.background = hex(col);
    b.onclick = () => {
      prof.colors[car.id] = col;
      saveProfile(prof);
      player.model.paint.color.set(col);
      renderGarage();
    };
    $('garageColors').appendChild(b);
  });

  // 改裝
  const ups = prof.upgrades[car.id] || {};
  $('upgradeList').innerHTML = owned ? '' : '<p class="muted">購買後才能改裝。</p>';
  if (owned) for (const u of UPGRADES) {
    const lv = ups[u.id] || 0;
    const row = document.createElement('div');
    row.className = 'uprow';
    row.innerHTML = `<div><b>${u.name}</b><small>${u.desc}</small></div><div class="pips">${'<i class="on"></i>'.repeat(lv)}${'<i></i>'.repeat(MAX_LEVEL - lv)}</div>`;
    const b = document.createElement('button');
    b.className = 'small';
    if (lv >= MAX_LEVEL) { b.textContent = '已滿級'; b.disabled = true; }
    else {
      const cost = upgradeCost(car, lv);
      b.textContent = money(cost);
      b.disabled = prof.money < cost;
      b.onclick = () => {
        prof.money -= cost;
        prof.upgrades[car.id] = { ...ups, [u.id]: lv + 1 };
        saveProfile(prof);
        beep(880, 0.12, 'triangle');
        showcase(car.id);
        renderGarage();
      };
    }
    row.appendChild(b);
    $('upgradeList').appendChild(row);
  }

  // 購買 / 使用
  const act = $('garageAction');
  if (!owned) {
    act.textContent = `購買 ${money(car.price)}`;
    act.disabled = prof.money < car.price;
    act.onclick = () => {
      prof.money -= car.price;
      prof.owned.push(car.id);
      prof.car = car.id;
      saveProfile(prof);
      beep(660, 0.15, 'triangle'); setTimeout(() => beep(990, 0.25, 'triangle'), 120);
      renderGarage();
    };
  } else if (prof.car !== car.id) {
    act.textContent = '使用這台車';
    act.disabled = false;
    act.onclick = () => { prof.car = car.id; saveProfile(prof); renderGarage(); };
  } else {
    act.textContent = '使用中';
    act.disabled = true;
  }
}

// ---- 設定 ----
choose('#quals button', 'q', q => {
  quality = q;
  try { localStorage.setItem(QUALITY_KEY, q); } catch { /* 無 storage */ }
  applyQuality();
});
document.querySelectorAll('#quals button').forEach(b => b.classList.toggle('on', b.dataset.q === quality));
document.querySelectorAll('#trans button').forEach(b => b.classList.toggle('on', (b.dataset.t === 'manual') === !!settings.manual));
choose('#trans button', 't', t => setTransmission(t === 'manual'));
document.querySelectorAll('#hintsSet button').forEach(b => b.classList.toggle('on', (b.dataset.h === 'on') === (settings.hints !== false)));
choose('#hintsSet button', 'h', v => { settings.hints = v === 'on'; saveSettings(); });
$('touch').classList.toggle('manual', !!settings.manual);
$('tdoor').addEventListener('pointerdown', e => { e.preventDefault(); ow.toggleVehicle(); navigator.vibrate?.(15); });
document.querySelectorAll('#tshift [data-shift]').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault();
  shiftGear(+b.dataset.shift);
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  navigator.vibrate?.(12);
}));
$('muteBtn').onclick = () => { toggleMute(); $('muteBtn').textContent = muted ? '音效：關' : '音效：開'; };
$('resetBtn').onclick = () => {
  if (!confirm('確定要清除所有進度（金錢、車輛、改裝、盃賽與紀錄）嗎？')) return;
  try {
    localStorage.removeItem('turbo-overdose-profile');
    for (const t of TRACKS) localStorage.removeItem('turbo-overdose-ghost-' + t.id);
  } catch { /* 無 storage */ }
  location.reload();
};

// ---- 暫停選單 ----
$('resumeBtn').onclick = () => togglePause();
$('photoBtn').onclick = () => enterPhoto();
$('photoExit').onclick = () => exitPhoto();
$('photoSave').onclick = () => savePhoto();
$('photoFov').oninput = e => { if (photo) photo.fov = +e.target.value; };
choose('#filters button', 'f', f => applyFilter(f));
$('rpExit').onclick = () => exitReplay();
for (const [id, key] of [['musicVol', 'music'], ['sfxVol', 'sfx']]) {
  $(id).value = Math.round(settings[key] * 100);
  $(id).oninput = e => { settings[key] = e.target.value / 100; applyVolumes(); saveSettings(); };
}
$('restartBtn').onclick = () => { if (session.mode === 'online') return; togglePause(); startRace(session); };
$('quitBtn').onclick = () => {
  togglePause();
  if (session.mode === 'career') saveProfile(prof); // 盃賽進度保留，可從生涯模式繼續
  if (session.mode === 'online') leaveOnline(); else toMenu();
};

// ---- 啟動 ----
fillIcons();
loadTrack('valley');
setPlayerCar();
placeOnGrid();
applyQuality();
showScreen('menu');
frame();
$('loading').classList.add('ready');
$('lhint').textContent = isTouch ? '點擊畫面開始' : '按任意鍵開始';

// 除錯 / 自動測試用
window.__game = {
  get state() { return state; }, get nitro() { return nitro; },
  get P() { return P; }, get T() { return T; }, get NR() { return NR; }, get W() { return W; },
  get session() { return session; }, get field() { return field; }, get ghost() { return ghost; },
  player, cars, keys, pad, prof, standings, step: update, SPEED, renderer, render, camera, skids,
  startRace: beginRace, loadTrack, showScreen, openGarage, toMenu: goMenu, beginGame, enterReplay, enterPhoto, exitPhoto,
  get rec() { return rec; }, get net() { return net; }, get room() { return room; }, get roomCode() { return roomCode; }, netCars, openOnline, openBoard, get rp() { return rp; }, get music() { return music; }, get audio() { return audio; }, ow, get traffic() { return traffic; }, skipIntro() { introTime = 0; }
};
