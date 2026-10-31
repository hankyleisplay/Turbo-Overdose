import { SPEC } from './physics.js';

// ================= 車輛 =================
export const CARS = [
  {
    id: 'gt', name: 'Street GT', style: 'gt', price: 0, tier: 1,
    desc: '後驅入門跑車，各方面都很平均，好上手。',
    spec: {},
  },
  {
    id: 'blade', name: 'Blade R', style: 'blade', price: 22000, tier: 1.3,
    desc: '輕量化賽車，抓地力最高，過彎之王。',
    spec: { mass: 1080, inertia: 1450, peakTorque: 680, mu: 2.9, downforce: 2.1 },
  },
  {
    id: 'brute', name: 'Brute V8', style: 'muscle', price: 38000, tier: 1.5,
    desc: '大排氣量肌肉車，馬力驚人、尾巴很活，天生的甩尾機器。',
    spec: { mass: 1420, inertia: 2050, peakTorque: 1050, mu: 2.45, drag: 0.72, downforce: 1.2, nitroThrust: 9500 },
  },
  {
    id: 'hyper', name: 'Apex Hyper', style: 'hyper', price: 85000, tier: 2,
    desc: '頂級超跑，極速與下壓力都是頂尖，直線無人能敵。',
    spec: { mass: 1220, inertia: 1700, peakTorque: 1000, mu: 2.85, drag: 0.56, downforce: 2.6, nitroThrust: 10500 },
  },
];
export const carById = id => CARS.find(c => c.id === id) || CARS[0];

// ================= 改裝 =================
export const UPGRADES = [
  { id: 'engine', name: '引擎', desc: '扭力 +8% / 級' },
  { id: 'tires', name: '輪胎', desc: '抓地力 +4% / 級' },
  { id: 'nitro', name: '氮氣', desc: '推力 +12%、消耗 -10% / 級' },
];
export const MAX_LEVEL = 3;
export const upgradeCost = (car, level) => Math.round([4000, 8000, 15000][level] * car.tier / 500) * 500;

// 合成最終車輛參數：基礎值 → 車款 → 改裝
export function buildSpec(carId, ups = {}) {
  const car = carById(carId);
  const s = { ...SPEC, ...car.spec, nitroDrain: 30 };
  s.peakTorque *= 1 + 0.08 * (ups.engine || 0);
  s.mu *= 1 + 0.04 * (ups.tires || 0);
  s.nitroThrust *= 1 + 0.12 * (ups.nitro || 0);
  s.nitroDrain *= 1 - 0.1 * (ups.nitro || 0);
  return s;
}

// ================= 生涯 =================
export const CUPS = [
  { id: 'rookie', name: '新手盃', diff: 'easy', tracks: ['valley', 'desert', 'snow'], prize: 12000 },
  { id: 'pro', name: '職業盃', diff: 'normal', tracks: ['desert', 'snow', 'valley'], prize: 25000, requires: 'rookie' },
  { id: 'legend', name: '傳奇盃', diff: 'hard', tracks: ['snow', 'valley', 'desert'], prize: 50000, requires: 'pro' },
];
export const POINTS = [10, 8, 6, 4, 3, 2];
export const PRIZE = [5000, 3500, 2500, 1500, 1000, 500];
export const DIFF_PAY = { easy: 0.7, normal: 1, hard: 1.5 };
export const DIFF_NAME = { easy: '簡單', normal: '普通', hard: '困難' };
export const TT_REWARD = 1500;   // 計時賽刷新最佳單圈的獎金

// ================= 存檔 =================
const KEY = 'turbo-overdose-profile';
const DEFAULT = () => ({
  name: '車手' + (1000 + Math.random() * 9000 | 0), money: 5000, owned: ['gt'], car: 'gt', colors: {}, upgrades: {}, cupsWon: [], cup: null, best: {},
});
export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && typeof p === 'object') return { ...DEFAULT(), ...p };
  } catch { /* 無 storage 或資料損毀 */ }
  return DEFAULT();
}
export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 無 storage */ }
}
export function loadGhost(trackId) {
  try { return JSON.parse(localStorage.getItem('turbo-overdose-ghost-' + trackId)); } catch { return null; }
}
export function saveGhost(trackId, ghost) {
  try { localStorage.setItem('turbo-overdose-ghost-' + trackId, JSON.stringify(ghost)); } catch { /* 無 storage */ }
}
