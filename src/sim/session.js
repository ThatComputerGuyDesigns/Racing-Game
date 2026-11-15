// Race session: owns cars on a track, timing, barriers, car-to-car contact,
// race state machine. Shared by the game and the headless tests.
import { Car, CAR_SPECS } from './car.js';
import { makeSurfaceFn } from './tracks.js';
import { computeRacingLine, speedProfile } from './racingline.js';
import { AIDriver, PERSONALITIES } from './ai.js';

const lineCache = new WeakMap();
export function lineFor(track) {
  if (!lineCache.has(track)) {
    const line = computeRacingLine(track);
    const profile = speedProfile(track, line, CAR_SPECS.formula);
    lineCache.set(track, { line, profile });
  }
  return lineCache.get(track);
}

export class Entry {
  constructor(car, track, name, isPlayer = false) {
    this.car = car; this.name = name; this.isPlayer = isPlayer;
    this.surface = makeSurfaceFn(track);
    this.hint = -1; this.s = 0; this.lat = 0;
    this.lap = 0; this.lapStart = 0; this.laps = []; this.best = Infinity;
    this.sector = 0; this.sectorTimes = [];
    this.totalProgress = 0; // laps*len + s, for positions
    this.invalid = false; this.finished = false; this.finishTime = 0;
    this.wallHits = 0; this.ai = null;
    this.pos = 0;
  }
}

export class Session {
  /**
   * @param {Track} track
   * @param {object} opts { laps, mode: 'practice'|'race'|'quali', grid: entries[] }
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.mode = opts.mode || 'practice';
    this.totalLaps = opts.laps ?? 3;
    this.entries = [];
    this.time = 0;
    this.state = this.mode === 'race' ? 'grid' : 'running';
    this.countdown = 0;
    this.env = { grip: 1, temp: 24, wet: 0 };
    this.events = []; // {type:'impact'|'lap'|..., ...} drained by renderer
    const { line, profile } = lineFor(track);
    this.line = line; this.profile = profile;
  }

  addCar({ name, isPlayer = false, persona = null, difficulty = 1, spec = CAR_SPECS.formula, compound, fuel, assists, setup, gridSlot = 0, seed = 1 }) {
    const car = new Car(spec, { compound, fuel, assists, setup });
    const e = new Entry(car, this.track, name, isPlayer);
    e.gridSlot = gridSlot;
    if (persona) {
      e.persona = persona;
      e.ai = new AIDriver(car, this.track, this.line, this.profile, persona, seed, difficulty);
      car.assists = { abs: true, tc: true, stability: 0, autoGear: true, steerAssist: 0 };
    }
    this.entries.push(e);
    this.placeOnGrid(e);
    return e;
  }

  placeOnGrid(e) {
    const tr = this.track;
    const startS = tr.length * (tr.def.start ?? 0);
    const slot = e.gridSlot;
    const back = this.mode === 'race' ? 10 + slot * 8 : 30 + slot * 12;
    const lat = this.mode === 'race' ? (slot % 2 ? -3 : 3) : 0;
    const p = tr.pointAt(startS - back, lat);
    e.car.reset(p.x, p.z, p.yaw, this.mode === 'race' ? 0 : 0);
    e.hint = -1;
    const pr = tr.project(p.x, p.z);
    e.hint = pr.i; e.s = pr.s; e.lat = pr.lat;
    // starting behind the line: lap 0 until crossing
    e.lap = 0; e.laps = []; e.best = Infinity; e.lapStart = this.time;
    e.totalProgress = pr.s - tr.length; e.finished = false; e.invalid = false;
    e.sectorTimes = []; e.sector = 0;
  }

  startRace() {
    this.state = 'countdown';
    this.countdown = 4.2;
  }

  /** Advance the simulation by dt. inputs: Map(entry -> input) for players. */
  update(dt, playerInput) {
    if (this.state === 'grid') return;
    let racing = true;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      racing = false;
      if (this.countdown <= 0) { this.state = 'running'; this.raceStart = this.time; for (const e of this.entries) e.lapStart = this.time; this.events.push({ type: 'go' }); }
    }
    this.time += dt;
    const others = this.entries.map(e => ({ car: e.car, s: e.s, hint: e.hint }));
    const h = 1 / 240;
    // fixed 240 Hz physics with an accumulator: identical behaviour at 30, 60 or 144 fps
    this._acc = (this._acc || 0) + dt;
    let steps = Math.min(48, Math.floor(this._acc / h + 1e-9));
    this._acc -= steps * h;
    // AI decisions at frame rate, physics at 240 Hz
    const inputs = this.entries.map(e => {
      if (e.finished && e.ai == null) return { throttle: 0, brake: 0.3, steer: 0 };
      let inp = e.ai ? e.ai.update(dt, others, this.env, racing) : (playerInput || { throttle: 0, brake: 0, steer: 0 });
      if (!racing) inp = { ...inp, throttle: e.ai ? 0.35 : inp.throttle, brake: 1, steer: 0 };
      if (e.finished && e.ai) inp = { ...inp, throttle: Math.min(inp.throttle, 0.4) };
      return inp;
    });
    for (let k = 0; k < steps; k++) {
      for (let j = 0; j < this.entries.length; j++) {
        const e = this.entries[j];
        e.car.step(h, inputs[j], e.surface, this.env);
      }
      if (k % 4 === 0) this._contacts();
    }
    for (const e of this.entries) this._track(e);
    this._positions();
  }

  _track(e) {
    const tr = this.track, car = e.car;
    const pr = tr.project(car.x, car.z, e.hint);
    const prevS = e.s;
    e.hint = pr.i; e.s = pr.s; e.lat = pr.lat;
    // road gradient along the car's heading (for slope force + rendering pitch)
    {
      const a = tr.idx(pr.i - 2), b = tr.idx(pr.i + 2);
      const grad = (tr.h[b] - tr.h[a]) / (4 * tr.ds);
      const along = Math.sin(car.yaw) * tr.tx[pr.i] + Math.cos(car.yaw) * tr.tz[pr.i];
      car.slope = grad * along;
      const f = pr.s / tr.ds - Math.floor(pr.s / tr.ds);
      car.y = tr.h[pr.i] + (tr.h[tr.idx(pr.i + 1)] - tr.h[pr.i]) * f;
    }
    // barrier collision
    const wall = tr.width / 2 + tr.runoff;
    if (Math.abs(pr.lat) > wall - 1.0) {
      const sgn = Math.sign(pr.lat);
      const nx = tr.nx[pr.i] * sgn, nz = tr.nz[pr.i] * sgn; // outward normal
      const pen = Math.abs(pr.lat) - (wall - 1.0);
      car.x -= nx * pen; car.z -= nz * pen;
      const vn = car.vx * nx + car.vz * nz;
      if (vn > 0) {
        car.vx -= nx * vn * 1.35; car.vz -= nz * vn * 1.35;
        car.vx *= 0.93; car.vz *= 0.93;
        car.r += (this._rand() - 0.5) * vn * 0.08;
        e.wallHits++;
        if (vn > 2) this.events.push({ type: 'impact', x: car.x, z: car.z, power: vn, entry: e });
      }
    }
    if (car.offTrack >= 4) e.invalid = true;
    // lap crossing
    const L = tr.length;
    const startS = L * (tr.def.start ?? 0);
    const rel = (s) => ((s - startS) % L + L) % L;
    const a = rel(prevS), b = rel(pr.s);
    if (a > L * 0.8 && b < L * 0.2 && this.state !== 'countdown') {
      if (e.lap > 0) {
        const t = this.time - e.lapStart;
        e.laps.push({ time: t, valid: !e.invalid });
        if (!e.invalid && t < e.best) e.best = t;
        this.events.push({ type: 'lap', entry: e, time: t, valid: !e.invalid });
      }
      e.lap++;
      e.lapStart = this.time; e.invalid = false; e.sector = 0; e.sectorTimes = [];
      if (this.mode === 'race' && e.lap > this.totalLaps && !e.finished) {
        e.finished = true; e.finishTime = this.time - this.raceStart;
        this.events.push({ type: 'finish', entry: e });
      }
    } else if (b < a && a - b < L * 0.5 && a > L * 0.8 === false) {
      // went backwards across the line: ignore
    }
    // sectors (thirds)
    const sec = Math.floor(b / (L / 3));
    if (e.lap > 0 && sec > e.sector && sec < 3) {
      e.sectorTimes.push(this.time - e.lapStart);
      e.sector = sec;
    }
    e.totalProgress = (e.lap - 1) * L + b;
  }

  _contacts() {
    const E = this.entries;
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const a = E[i].car, b = E[j].car;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 25) continue;
      // capsule approximation: two circles per car along heading
      let best = null;
      for (const oa of [-1.3, 1.3]) for (const ob of [-1.3, 1.3]) {
        const ax = a.x + Math.sin(a.yaw) * oa, az = a.z + Math.cos(a.yaw) * oa;
        const bx = b.x + Math.sin(b.yaw) * ob, bz = b.z + Math.cos(b.yaw) * ob;
        const ddx = bx - ax, ddz = bz - az, dd = Math.hypot(ddx, ddz);
        const pen = 1.9 - dd;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: ddx / (dd || 1), nz: ddz / (dd || 1) };
      }
      if (!best) continue;
      const { pen, nx, nz } = best;
      const ma = a.mass, mb = b.mass, tot = ma + mb;
      a.x -= nx * pen * mb / tot; a.z -= nz * pen * mb / tot;
      b.x += nx * pen * ma / tot; b.z += nz * pen * ma / tot;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const jimp = -(1 + 0.25) * rv / (1 / ma + 1 / mb);
        a.vx -= jimp * nx / ma; a.vz -= jimp * nz / ma;
        b.vx += jimp * nx / mb; b.vz += jimp * nz / mb;
        a.r += (this._rand() - 0.5) * 0.4; b.r += (this._rand() - 0.5) * 0.4;
        if (-rv > 1.5) this.events.push({ type: 'impact', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, power: -rv, entry: E[i], other: E[j] });
      }
    }
  }

  _positions() {
    const sorted = [...this.entries].sort((p, q) => {
      if (p.finished && q.finished) return p.finishTime - q.finishTime;
      if (p.finished) return -1; if (q.finished) return 1;
      if (this.mode !== 'race') return (p.best || 1e9) - (q.best || 1e9);
      return q.totalProgress - p.totalProgress;
    });
    sorted.forEach((e, i) => e.pos = i + 1);
    this.order = sorted;
  }

  _rand() { this._seed = ((this._seed || 12345) * 16807) % 2147483647; return this._seed / 2147483647; }
}

export { PERSONALITIES };
