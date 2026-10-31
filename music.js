// 即時合成的 synthwave 配樂：menu（舒緩）與 race（激昂）兩種曲風
// 以 16 分音符為單位排程，和弦進行 Am – F – C – G

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];

export class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.volume = 0.6;
    // 回音：附點八分音符的 delay
    this.send = ctx.createGain(); this.send.gain.value = 0.28;
    this.delay = ctx.createDelay(1.5);
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.send.connect(this.delay); this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.out);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.mode = null; this.step = 0; this.nextTime = 0; this.timer = null;
  }

  setVolume(v) {
    this.volume = v;
    if (this.mode) this.out.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.1);
  }

  play(mode) {
    if (mode === this.mode) return;
    const t = this.ctx.currentTime;
    this.mode = mode;
    this.bpm = mode === 'race' ? 128 : 96;
    this.delay.delayTime.setValueAtTime(60 / this.bpm * 0.75, t);
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(this.volume * 0.5, t + 1.2);
    this.step = 0;
    this.nextTime = t + 0.08;
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(fade = 0.6) {
    if (!this.mode) return;
    const t = this.ctx.currentTime;
    this.mode = null;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    clearInterval(this.timer); this.timer = null;
  }

  schedule() {
    if (!this.mode || this.ctx.state !== 'running') return;
    const sixteenth = 60 / this.bpm / 4;
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;   // 分頁休眠後重新對齊
    while (this.nextTime < now + 0.3) {
      // 主執行緒太忙、已經來不及的音符直接跳過，避免一次擠在一起爆音
      if (this.nextTime >= now) this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  playStep(s, t, q) {
    const i = s % 16, bar = Math.floor(s / 16);
    const chord = PROG[bar % 4];
    const race = this.mode === 'race';
    const section = Math.floor(bar / 8) % 2;       // 每 8 小節換一段，變化編曲
    if (race) {
      if (i % 4 === 0) this.kick(t, 1);
      if (i === 4 || i === 12) this.snare(t);
      if (i % 2 === 1) this.hat(t, i % 4 === 3 ? 0.09 : 0.05, i % 4 === 3);
      if (i % 2 === 0) this.bass(chord[0] - 24 + (i % 4 === 2 ? 12 : 0), t, q * 1.8, 0.32);
      const arp = [0, 1, 2, 1, 0, 1, 2, 3][(i >> 1) % 8];
      if (section === 1 || i % 2 === 0) this.pluck(chord[arp % 3] + 12 + (arp === 3 ? 12 : 0), t, q * 1.5, 0.08);
      if (section === 1 && i % 8 === 0) this.lead(chord[(i / 8) % 3] + 24, t, q * 6, 0.05);
    } else {
      if (i === 0 || i === 10) this.kick(t, 0.55);
      if (i === 8) this.snare(t, 0.4);
      if (i % 4 === 2) this.hat(t, 0.035, false);
      if (i === 0 || i === 6 || i === 8) this.bass(chord[0] - 24, t, q * 4, 0.24);
      if (i % 2 === 0) this.pluck(chord[(i >> 1) % 3] + 12 + (i >= 8 ? 12 : 0), t, q * 2.2, 0.06);
    }
    if (i === 0) this.pad(chord.map(n => n + (race ? 0 : 12)), t, q * 16, race ? 0.05 : 0.07);
  }

  // ---------- 樂器 ----------
  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
  kick(t, vol) {
    const o = this.ctx.createOscillator(), g = this.env(t, 0.8 * vol, 0.004, 0.32);
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.4);
  }
  noise(t, dur, type, freq, vol, send = 0) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.env(t, vol, 0.004, dur);
    src.connect(f); f.connect(g); g.connect(this.out);
    if (send) g.connect(this.send);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  snare(t, vol = 1) {
    this.noise(t, 0.18, 'bandpass', 1800, 0.35 * vol, 1);
    const o = this.ctx.createOscillator(), g = this.env(t, 0.25 * vol, 0.002, 0.09);
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.12);
  }
  hat(t, vol, open) { this.noise(t, open ? 0.12 : 0.04, 'highpass', 7500, vol); }
  bass(m, t, dur, vol) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.env(t, vol, 0.008, dur);
    o.connect(f); f.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.05);
  }
  pluck(m, t, dur, vol) {
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(m);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = this.env(t, vol, 0.008, dur);
    o.connect(f); f.connect(g); g.connect(this.out); g.connect(this.send);
    o.start(t); o.stop(t + dur + 0.05);
  }
  lead(m, t, dur, vol) {
    for (const det of [-7, 7]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
      const g = this.env(t, vol, 0.03, dur);
      o.connect(f); f.connect(g); g.connect(this.out); g.connect(this.send);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  pad(notes, t, dur, vol) {
    for (const m of notes) for (const det of [-10, 10]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol / notes.length, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
}
