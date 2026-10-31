// 車輛動力學：自行車模型 + 簡化 Pacejka 輪胎 + 載重轉移 + 六速自排
// 座標慣例：heading h 時前方 f = (sin h, cos h)，左方 = (cos h, -sin h)，h 增加 = 向左轉

const G = 9.81;

export const SPEC = {
  mass: 1250,
  inertia: 1750,
  a: 1.25,            // 重心到前軸
  b: 1.38,            // 重心到後軸
  cgH: 0.32,          // 重心高度（載重轉移用）
  mu: 2.6,            // 街機化的高抓地力
  rearGrip: 1.12,     // 後輪多一點抓地，過彎車尾比較穩
  steerFade: 24,      // 高速時轉角遞減的速度（越大，高速能打的角度越多）
  downforce: 1.7,     // N/(m/s)^2
  drag: 0.66,
  rolling: 12,
  brake: 30000,
  wheelR: 0.34,
  gears: [3.3, 2.25, 1.68, 1.32, 1.07, 0.89],
  final: 3.95,
  idleRpm: 1100,
  maxRpm: 8200,
  peakTorque: 730,
  steerMax: 0.58,
  nitroThrust: 8500,   // 氮氣推力（N），不經過輪胎、直接推車身
  pacB: 9, pacC: 1.45, // 輪胎曲線：約 10° 打滑角時抓地力最高，之後緩降
};

export const corneringSpeed = (radius, s = SPEC) => {
  // 由抓地力與下壓力推得某半徑的極限過彎速度（AI 速度表用）
  const k = s.mu * s.downforce / s.mass;
  const den = 1 / radius - k;
  return den <= 0 ? Infinity : Math.sqrt(s.mu * G / den);
};

const pac = (alpha, s) => Math.sin(s.pacC * Math.atan(s.pacB * alpha));
const torqueCurve = (rpm, s) => {
  const x = Math.min(1, Math.max(0, (rpm - 1000) / 7000));
  return s.peakTorque * (0.62 + 0.38 * Math.sin(Math.PI * x));
};

export class Vehicle {
  constructor(pos, vel, spec = SPEC) {
    this.s = spec;
    this.pos = pos; this.vel = vel;   // THREE.Vector3（y 不使用）
    this.reset(0);
  }

  reset(h) {
    this.h = h; this.r = 0;
    this.vel.set(0, 0, 0);
    this.delta = 0; this.u = 0; this.vl = 0;
    this.gear = 1; this.rpm = this.s.idleRpm; this.shiftT = 0;
    this.ax = 0; this.ay = 0;
    this.slipF = 0; this.slipR = 0; this.spin = 0; this.lockup = 0;
    this.shifted = 0; this.limiter = false;
  }

  // 手排換檔：dir = +1 升檔、-1 降檔；gear = -1 代表倒檔。回傳是否換檔成功
  shift(dir) {
    const s = this.s;
    if (this.shiftT > 0) return false;
    if (dir > 0) {
      if (this.gear === -1) { if (this.u < -2) return false; this.gear = 1; }
      else if (this.gear < s.gears.length) this.gear++;
      else return false;
    } else {
      if (this.gear === -1) return false;
      if (this.gear === 1) { if (this.u > 2) return false; this.gear = -1; }
      else {
        // 降檔後轉速會爆表就拒絕，保護引擎
        const rpm = Math.abs(this.u) / s.wheelR * s.gears[this.gear - 2] * s.final * 60 / (2 * Math.PI);
        if (rpm > s.maxRpm + 300) return false;
        this.gear--;
      }
    }
    this.shiftT = 0.12;
    this.shifted = 1;
    return true;
  }

  get beta() { return Math.atan2(this.vl, Math.max(Math.abs(this.u), 1)); }

  // ctl: { throttle 0..1, brake 0..1, steer -1..1（右為正）, hand bool, boost bool }
  // surf: { grip, drag } 路面係數
  step(dt, ctl, surf) {
    const s = this.s, m = s.mass, L = s.a + s.b;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    let u = this.vel.x * sh + this.vel.z * ch;
    let vl = this.vel.x * ch - this.vel.z * sh;
    const sgn = u >= 0 ? 1 : -1;
    const uAbs = Math.max(Math.abs(u), 2.5);

    // ---- 轉向：高速自動減少轉角，並提供反打輔助 ----
    const steerCap = s.steerMax / (1 + Math.abs(u) / s.steerFade);
    let target = -ctl.steer * steerCap;
    if (u > 6) target += Math.max(-0.35, Math.min(0.35, this.beta * 0.55)); // 反打輔助
    const rate = 3.2 * dt;
    this.delta += Math.max(-rate, Math.min(rate, target - this.delta));
    const d = this.delta * sgn;

    // ---- 載重 ----
    const df = s.downforce * u * u;
    const wT = Math.max(-0.22, Math.min(0.22, this.ax * s.cgH / L / G)) * m * G; // 載重轉移上限 ±22%
    const Fzf = Math.max(0, m * G * s.b / L - wT + df * 0.45);
    const Fzr = Math.max(0, m * G * s.a / L + wT + df * 0.55);
    const muF = s.mu * surf.grip;
    const muR = s.mu * surf.grip * (ctl.hand ? 0.62 : s.rearGrip);

    // ---- 動力系統 ----
    if (this.shiftT > 0) this.shiftT -= dt;
    const ratio = () => s.gears[Math.max(1, this.gear) - 1] * s.final;
    let wheelRpm = Math.abs(u) / s.wheelR * ratio() * 60 / (2 * Math.PI);
    if (!this.manual && u >= -0.5 && this.shiftT <= 0) {
      if (wheelRpm > 7350 && this.gear < s.gears.length) { this.gear++; this.shiftT = 0.16; this.shifted = 1; }
      else if (this.gear > 1 && wheelRpm * s.gears[this.gear - 2] / s.gears[this.gear - 1] < 6600 && wheelRpm < 3800) { this.gear--; this.shiftT = 0.1; }
      wheelRpm = Math.abs(u) / s.wheelR * ratio() * 60 / (2 * Math.PI);
    }
    const reversing = !this.manual && ctl.brake > 0.1 && u < 1.5 && ctl.throttle < 0.1 && Math.abs(this.r) < 0.5;
    let Fdrive = 0;
    if (reversing) {
      Fdrive = u > -14 ? -7000 * ctl.brake : 0;
      this.rpm += (2500 + 2500 * ctl.brake - this.rpm) * Math.min(1, 8 * dt);
    } else {
      // 低速時離合器半聯結，引擎可以拉高轉速
      const low = this.gear === 1 || this.gear === -1;
      const clutchRpm = low ? s.idleRpm + ctl.throttle * 4200 : 0;
      const rpm = Math.min(s.maxRpm, Math.max(wheelRpm, clutchRpm, s.idleRpm));
      this.rpm += (rpm - this.rpm) * Math.min(1, 20 * dt);
      // 手排沒換檔會撞到斷油（轉速上限），引擎動力暫時切斷
      this.limiter = this.manual && wheelRpm >= s.maxRpm - 50 && ctl.throttle > 0.1;
      if (this.shiftT <= 0 && this.rpm < s.maxRpm - 50) {
        const dir = this.gear === -1 ? -1 : 1;
        Fdrive = dir * ctl.throttle * torqueCurve(this.rpm, s) * (ctl.boost ? 1.2 : 1) * ratio() / s.wheelR * 0.9;
        if (dir < 0 && u < -14) Fdrive = 0;
      }
    }

    // ---- 煞車 ----
    let FxF = 0, FxR = Fdrive;
    if (ctl.brake > 0 && !reversing && Math.abs(u) > 0.3) {
      // ABS：每軸最多用掉 80% 抓地力，保留轉向能力
      const B = s.brake * ctl.brake;
      FxF -= sgn * Math.min(B * 0.7, 0.8 * s.mu * surf.grip * Fzf);
      FxR -= sgn * Math.min(B * 0.3, 0.8 * muR * Fzr);
    }

    // ---- 輪胎側向力 ----
    const af = Math.atan((vl + s.a * this.r) / uAbs) - d;
    const ar = Math.atan((vl - s.b * this.r) / uAbs);
    let FyF = -muF * Fzf * pac(af, s);
    let FyR = -muR * Fzr * pac(ar, s);

    // 循跡控制：驅動力最多用掉後輪 85% 抓地力（手煞車甩尾時關閉）
    const capF = muF * Fzf, capR = muR * Fzr;
    const spinDemand = Fdrive / Math.max(capR, 1);
    if (!ctl.hand && Fdrive > 0.85 * capR) FxR = Fdrive = 0.85 * capR;

    // 手煞車：後輪鎖死滑動
    if (ctl.hand && Math.abs(u) > 1) FxR += -sgn * muR * Fzr * 0.3;

    // 摩擦圓：縱向力吃掉側向抓地（油門甩尾、煞車推頭）
    const fixCircle = (fx, fy, cap) => {
      const t = Math.hypot(fx, fy);
      return t > cap ? [fx * cap / t, fy * cap / t, t / cap] : [fx, fy, t / cap];
    };
    let overF, overR;
    [FxF, FyF, overF] = fixCircle(FxF, FyF, capF);
    [FxR, FyR, overR] = fixCircle(FxR, FyR, capR);
    // 起步時仍顯示輪胎空轉冒煙（視覺與音效用）
    this.spin = spinDemand > 1 && Math.abs(u) < 25 ? Math.min(1, spinDemand - 1 + 0.3) : 0;
    this.lockup = ctl.brake > 0.6 && Math.abs(u) > 10 && overF >= 1 ? 1 : 0;
    this.slipF = af; this.slipR = ar;

    // ---- 合力 ----
    const cd = Math.cos(d), sd = Math.sin(d);
    let Fx = FxR + FxF * cd - FyF * sd - s.drag * u * Math.abs(u) - (s.rolling + surf.drag) * u;
    if (ctl.boost && u > 0) Fx += s.nitroThrust * Math.max(0.25, 1 - u / 120);
    const Fy = FyR + FyF * cd + FxF * sd;
    let Tz = s.a * (FyF * cd + FxF * sd) - s.b * FyR;

    // 低速時抑制抖動
    if (Math.abs(u) < 1 && ctl.throttle < 0.05 && !reversing) { Fx -= u * m * 4; }
    Tz -= this.r * 900 * (1 + 2 / (1 + Math.abs(u)));

    this.ax += (Fx / m - this.ax) * Math.min(1, 10 * dt);
    this.ay += (Fy / m - this.ay) * Math.min(1, 10 * dt);

    const axw = (Fx * sh + Fy * ch) / m, azw = (Fx * ch - Fy * sh) / m;
    this.vel.x += axw * dt; this.vel.z += azw * dt;
    this.r += Tz / s.inertia * dt;
    // 車身穩定系統：滑動角超過上限就把車頭拉回行進方向（甩尾時放寬）
    const b = this.beta, bLim = ctl.hand ? 0.6 : 0.3;
    if (Math.abs(b) > bLim && Math.abs(u) > 5) this.r += Math.sign(b) * (Math.abs(b) - bLim) * 18 * dt;
    this.h += this.r * dt;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;

    u = this.vel.x * Math.sin(this.h) + this.vel.z * Math.cos(this.h);
    vl = this.vel.x * Math.cos(this.h) - this.vel.z * Math.sin(this.h);
    this.u = u; this.vl = vl;
  }
}
