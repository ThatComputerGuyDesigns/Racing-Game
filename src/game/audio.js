// Synthesised audio (no samples): engine harmonics, tyre squeal, wind, impacts.
export class Audio {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = this.master = C.createGain(); master.gain.value = 0.5; master.connect(C.destination);
    // engine: three detuned harmonics through a resonant lowpass and soft clipper
    this.engGain = C.createGain(); this.engGain.gain.value = 0;
    const shaper = C.createWaveShaper(); const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); } shaper.curve = curve;
    this.engFilter = C.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 4;
    this.oscs = [[1, 'sawtooth', 0.5], [2, 'square', 0.18], [0.5, 'sawtooth', 0.35], [3, 'sawtooth', 0.08]].map(([mul, type, g]) => {
      const o = C.createOscillator(); o.type = type; const gg = C.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(shaper); o.start(); return { o, mul };
    });
    shaper.connect(this.engFilter); this.engFilter.connect(this.engGain); this.engGain.connect(master);
    // noise source for tyres & wind
    const buf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type, f, q) => { const s = C.createBufferSource(); s.buffer = buf; s.loop = true; const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = C.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return { g, fl }; };
    this.squeal = mk('bandpass', 1400, 9);
    this.wind = mk('lowpass', 600, 0.5);
    this.rumble = mk('lowpass', 120, 1);
    this.buf = buf;
  }
  update(car, kerb) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = car.rpm / 60 * 4; // 8-cyl: 4 firings per rev
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul * 0.5, t, 0.015);
    this.engFilter.frequency.setTargetAtTime(500 + car.throttle * 3500 + car.rpm * 0.2, t, 0.03);
    this.engGain.gain.setTargetAtTime(0.10 + car.throttle * 0.22, t, 0.03);
    let slide = 0; for (const w of car.wheels) slide = Math.max(slide, w.surface === 'asphalt' ? w.slide : 0);
    this.squeal.g.gain.setTargetAtTime(Math.max(0, slide - 0.55) * 0.5 * Math.min(1, car.speed / 8), t, 0.05);
    this.squeal.fl.frequency.setTargetAtTime(1100 + slide * 500, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.35, (car.speed / 90) ** 2 * 0.35), t, 0.1);
    this.wind.fl.frequency.setTargetAtTime(300 + car.speed * 12, t, 0.1);
    this.rumble.g.gain.setTargetAtTime(kerb ? 0.9 : (car.offTrack ? 0.4 : 0), t, 0.03);
  }
  impact(power) {
    if (!this.ctx) return;
    const C = this.ctx, s = C.createBufferSource(); s.buffer = this.buf;
    const g = C.createGain(); const fl = C.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 900;
    g.gain.setValueAtTime(Math.min(1, power / 12), C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.35);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(); s.stop(C.currentTime + 0.4);
  }
  mute(m) { if (this.master) this.master.gain.value = m ? 0 : 0.5; }
}
