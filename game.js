import * as THREE from 'three';
import { Vehicle, SPEC, corneringSpeed } from './physics.js';
import { makeCar, makeGhost, WHEEL_R } from './car.js';
import { SkySystem, setupPost, SkidMarks, Sparks, Smoke } from './fx.js';
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
const money = n => '$' + Math.round(n).toLocaleString('en-US');

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

// ================= 賽道（世界）載入 =================
let W = null, P, T, NR, L, ds, center;
const SPEED = new Float32Array(N);
const AI_BRAKE = 19;
function loadTrack(id) {
  if (W && W.def.id === id) return;
  if (W) { scene.remove(W.group); W.dispose(); }
  W = buildWorld(trackById(id), renderer);
  scene.add(W.group);
  ({ P, T, NR, L, ds, center } = W);
  const th = W.def.theme;
  skySys.set(th.sky, W.sunDir, th.envGround);
  SUN_OFF.copy(W.sunDir).multiplyScalar(300);
  sun.color.set(th.sun[0]); sun.intensity = th.sun[1];
  hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2];
  scene.fog.color.set(th.fog[0]); scene.fog.near = th.fog[1]; scene.fog.far = th.fog[2];
  renderer.toneMappingExposure = th.exposure;
  buildSpeedTable();
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
function makeEntity(name, color, isPlayer, skill = 1, style = 'gt') {
  const e = {
    name, color, isPlayer, skill, model: makeCar(color, style),
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
AI_NAMES.forEach((n, i) => makeEntity(n, COLORS[(i + 1) % COLORS.length], false, AI_SKILL[i], AI_STYLES[i]));
let field = cars;               // 本場參賽的車（計時賽只有玩家）

// 依存檔換上玩家的車款、顏色與改裝
const prof = loadProfile();
const playerColor = () => prof.colors[prof.car] ?? COLORS[0];
function setPlayerCar() {
  const car = carById(prof.car);
  if (player.model.style !== car.style) {
    scene.remove(player.model.root);
    player.model = makeCar(playerColor(), car.style);
    scene.add(player.model.root);
  }
  if (!player.model.boostLight) {
    player.model.boostLight = new THREE.PointLight(0x55bbff, 0, 9, 2);
    player.model.boostLight.position.set(0, 0.6, -3.2);
    player.model.root.add(player.model.boostLight);
  }
  player.color = playerColor();
  player.model.paint.color.set(player.color);
  player.veh = new Vehicle(player.pos, player.vel, buildSpec(car.id, prof.upgrades[car.id]));
  player.veh.reset(player.h);
}

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
  const scr = openScreen();
  if (pressed(0) || pressed(9)) {
    if (scr === 'results') $('resBtns').firstChild?.click();
    else if (scr === 'setup') $('setupStart').click();
    else if (scr === 'menu') $('btnQuick').click();
    else if (pressed(9) && !scr) togglePause();
  }
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
  const hiss = noise('bandpass', 3200, 0.6);
  const rg = ctx.createGain(); rg.gain.value = 0; rg.connect(master);
  const rumbleOsc = ctx.createOscillator(); rumbleOsc.type = 'square'; rumbleOsc.frequency.value = 34;
  rumbleOsc.connect(rg); rumbleOsc.start();
  audio = { ctx, master, lp, eg, o1, o2, o3, squeal, wind, hiss, rg, buf, lastThrottle: 0 };
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
function nitroWhoosh() {
  if (!audio) return;
  const { ctx, master, buf } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3500, t + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + 0.75);
  burst(90, 0.35, 0.9);
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
  a.eg.gain.setTargetAtTime((0.05 + 0.08 * thr + 0.04 * rn + 0.04 * boostFx) * (v.shiftT > 0 ? 0.35 : 1), t, 0.03);
  a.squeal.g.gain.setTargetAtTime(fx.squeal * 0.22, t, 0.05);
  a.squeal.f.frequency.setTargetAtTime(1300 + fx.squeal * 500, t, 0.1);
  const sp = Math.abs(player.fwd) / REF_SPEED;
  a.wind.g.gain.setTargetAtTime(Math.min(1, sp * sp) * 0.14 + boostFx * 0.06, t, 0.1);
  a.hiss.g.gain.setTargetAtTime(boostFx * 0.16, t, 0.05);
  a.rg.gain.setTargetAtTime(fx.curb ? 0.08 : 0, t, 0.03);
  if (a.lastThrottle > 0.6 && thr < 0.1 && rpm > 5200) backfire();
  if (v.shifted) { v.shifted = 0; if (Math.random() < 0.5) backfire(); }
  a.lastThrottle = thr;
}

// ================= 遊戲狀態 =================
let state = 'menu', paused = false, cdTime = 0, raceTime = 0, lapStart = 0, bestLap = Infinity, lapTimes = [];
let boostFx = 0, boostKick = 0, wasBoosting = false;
let camMode = 0, camH = 0, nitro = 50, wrongWay = 0, shake = 0, menuAngle = 0, lastCd = -1;
let resultsTimer = -1, curbTimer = 0;
// 本場設定：mode = quick / career / tt
let session = { mode: 'quick', track: 'valley', diff: 'normal' };

function placeOnGrid() {
  // 兩列排開，比賽時玩家從最後一位出發；計時賽玩家單獨在最前面
  const order = session.mode === 'tt' ? [player] : [...cars.filter(c => !c.isPlayer), player];
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
  c.idx = nearestIdx(c.pos, c.idx, N / 2);
  c.pos.copy(P[c.idx]);
  c.h = Math.atan2(T[c.idx].x, T[c.idx].z);
  c.veh.reset(c.h);
  c.fwd = 0;
  skids.last.clear();
}

function startRace(sess = session) {
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
  boostFx = boostKick = 0; wasBoosting = false;
  nitro = 50; raceTime = 0; lapStart = 0; wrongWay = 0; lastCd = -1; resultsTimer = -1;
  cdTime = 3.6; state = 'countdown'; paused = false;
  camH = player.h; camInit = false;
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  $('bestlap').textContent = fmt(bestLap);
  $('trackname').textContent = trackById(session.track).name + (session.mode === 'tt' ? ' · 計時賽' : session.mode === 'career' ? ' · ' + cupById(session.cup).name + ` 第 ${prof.cup.race + 1} 場` : '');
  showCenter('');
}
function togglePause() {
  if (state !== 'race' && state !== 'countdown') return;
  paused = !paused;
  showCenter(paused ? '暫停' : '', true);
  $('pausemenu').classList.toggle('hidden', !paused);
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
  const g = W.grip;
  if (a <= HALF) return { grip: g, drag: 0, kind: 'road' };
  if (a <= HALF + CURB) return { grip: 0.95 * g, drag: 0, kind: 'curb' };
  return { grip: 0.62 * g, drag: 170, kind: 'sand' };
}

function updatePlayer(dt, ctl) {
  const c = player, v = c.veh;
  const surf = surfaceOf(lateral(c));
  const boosting = ctl.nitro && nitro > 0 && v.u > 5;
  if (boosting) nitro = Math.max(0, nitro - v.s.nitroDrain * dt);
  if (boosting && !wasBoosting) { boostKick = 1; nitroWhoosh(); rumble(0.7, 0.9, 350); }
  wasBoosting = boosting;
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
    if (c.boosting) { const k = 1.2 + Math.random() * 0.4; f.scale.set(k, k, 1.4 + Math.random() * 1.2); }
  }
  if (m.boostLight) m.boostLight.intensity = c.boosting ? 25 + Math.random() * 20 : 0;
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
  const fov = 58 + sf * 15 + boostFx * 16;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }
  const su = post.speed.uniforms;
  const blur = clamp((sf - 0.5) * 1.6, 0, 1) * 0.8 + boostFx * 1.1;
  su.amount.value += (blur - su.amount.value) * Math.min(1, 6 * dt);
  su.aberration.value = 0.05 + boostFx * 0.45;
  document.body.classList.toggle('boosting', c.boosting);
  $('boostfx').style.opacity = (boostFx * 0.9).toFixed(2);
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
  for (const c of field) {
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
  $('pos').textContent = session.mode === 'tt' ? '計時' : `${order.indexOf(player) + 1}/${field.length}`;
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
  const tr = trackById(session.track);
  const rows = [], notes = [];
  let earned = 0, buttons;
  if (session.mode === 'tt') {
    $('resTitle').textContent = '計時賽結果';
    lapTimes.forEach((t, i) => rows.push(['', `第 ${i + 1} 圈`, fmt(t), t === Math.min(...lapTimes)]));
    const prevBest = session.prevBest;
    if (bestLap < prevBest) {
      earned = TT_REWARD;
      notes.push(`🏁 新的最佳單圈 ${fmt(bestLap)}（原紀錄 ${fmt(prevBest)}）`);
    } else notes.push(`最佳單圈紀錄：${fmt(bestLap)}`);
    buttons = [['再跑一次', () => startRace(session)], ['回主選單', toMenu]];
  } else {
    $('resTitle').textContent = me === 1 ? '🏆 冠軍！' : `第 ${me} 名`;
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
          notes.push(`🏆 ${cup.name} 總冠軍！獎金 ${money(cup.prize)}`);
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
  if (earned > 0) notes.unshift(`💰 獎金 <b class="hl">+${money(earned)}</b>`);
  prof.money += earned;
  saveProfile(prof);
  $('resSub').textContent = `${tr.name} · ${session.mode === 'tt' ? '計時賽' : DIFF_NAME[session.diff]}`;
  $('resTable').innerHTML = rows.map(([a, b, c, me]) => `<tr class="${me ? 'me' : ''}"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('');
  $('resNotes').innerHTML = notes.map(n => `<div>${n}</div>`).join('');
  const box = $('resBtns'); box.innerHTML = '';
  buttons.forEach(([label, fn], i) => {
    const b = document.createElement('button');
    b.textContent = label; if (i === 0) b.className = 'go';
    b.onclick = fn; box.appendChild(b);
  });
  showScreen('results');
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
    for (const c of field) syncModel(c, dt);
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
    for (const c of field) if (c.ai) updateAI(c, dt);
    collideCars();
    if (!player.ai) collideWalls(player);
    for (const c of field) syncModel(c, dt);
    updateGhost();
    if (resultsTimer > 0 && (resultsTimer -= dt) <= 0) showResults();
  }
  if (centerTimer > 0 && (centerTimer -= dt) <= 0) showCenter('');
  smoke.update(dt);
  sparks.update(dt);
  updateCamera(dt);
  updateAudio(player.ai ? NO_INPUT : ctl, fx);
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
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  render(dt);
}

// ================= 選單與介面 =================
const SCREENS = ['menu', 'setup', 'career', 'garage', 'settings', 'results'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  $('pausemenu').classList.add('hidden');
  document.querySelectorAll('.money').forEach(e => { e.textContent = money(prof.money); });
}
const openScreen = () => SCREENS.find(s => !$(s).classList.contains('hidden'));
function silenceRace() {
  if (!audio) return;
  audio.ctx.resume();
  for (const g of [audio.eg, audio.wind.g, audio.squeal.g, audio.hiss.g, audio.rg]) g.gain.value = 0;
}
function toMenu() {
  state = 'menu'; paused = false;
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
    btn.textContent = locked ? `🔒 先拿下${cupById(cup.requires).name}` : active ? '繼續' : prof.cup ? '改跑這個盃賽' : '開始';
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
$('restartBtn').onclick = () => { togglePause(); startRace(session); };
$('quitBtn').onclick = () => {
  togglePause();
  if (session.mode === 'career') saveProfile(prof); // 盃賽進度保留，可從生涯模式繼續
  toMenu();
};

// ---- 啟動 ----
loadTrack('valley');
setPlayerCar();
placeOnGrid();
applyQuality();
showScreen('menu');
frame();

// 除錯 / 自動測試用
window.__game = {
  get state() { return state; }, get nitro() { return nitro; },
  get P() { return P; }, get T() { return T; }, get NR() { return NR; }, get W() { return W; },
  get session() { return session; }, get field() { return field; }, get ghost() { return ghost; },
  player, cars, keys, pad, prof, standings, step: update, SPEED, renderer, render, camera, skids,
  startRace, loadTrack, showScreen, openGarage, toMenu
};
