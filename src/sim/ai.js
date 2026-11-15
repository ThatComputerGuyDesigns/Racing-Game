// AI driver: same controls as the player (throttle/brake/steer), same physics.
// Racecraft = lane choice by cost + physically-based following distance.
// No rubber-banding: pace is personality.pace x global difficulty, nothing else.

export const PERSONALITIES = [
  // pace: fraction of the calibrated limit; consistency: noise; aggression: overtake/defend;
  // composure: resistance to pressure mistakes
  { name: 'Mara Okonkwo',   team: 'Halcyon Racing',    color: 0x1f6feb, pace: 1.000, consistency: 0.96, aggression: 0.55, composure: 0.92, style: 'Precise' },
  { name: 'Dario Vell',     team: 'Ferroquin Motori',  color: 0xd7262e, pace: 0.996, consistency: 0.86, aggression: 0.92, composure: 0.55, style: 'Aggressive' },
  { name: 'Ines Kallström', team: 'Nordlys GP',        color: 0x2ec4b6, pace: 0.990, consistency: 0.98, aggression: 0.35, composure: 0.95, style: 'Metronome' },
  { name: 'Theo Marchetti', team: 'Vantage Corsa',     color: 0xf2a33a, pace: 0.986, consistency: 0.82, aggression: 0.80, composure: 0.45, style: 'Hothead' },
  { name: 'Yuki Arashiro',  team: 'Kaze Dynamics',     color: 0xffffff, pace: 0.988, consistency: 0.93, aggression: 0.50, composure: 0.82, style: 'Tyre whisperer' },
  { name: 'Sol Benítez',    team: 'Cobalt Autosport',  color: 0x7a3cff, pace: 0.978, consistency: 0.88, aggression: 0.70, composure: 0.70, style: 'Opportunist' },
  { name: 'Priya Raman',    team: 'Lumen Works',       color: 0xc8f031, pace: 0.982, consistency: 0.94, aggression: 0.40, composure: 0.85, style: 'Strategist' },
  { name: 'Lukas Brandt',   team: 'Eisen Motorsport',  color: 0x8a8f98, pace: 0.972, consistency: 0.90, aggression: 0.60, composure: 0.75, style: 'Defender' },
  { name: 'Céleste Roy',    team: 'Aurore Racing',     color: 0xff5fa2, pace: 0.980, consistency: 0.86, aggression: 0.72, composure: 0.62, style: 'Late braker' },
  { name: 'Kofi Mensah',    team: 'Sable Engineering', color: 0x3a3d44, pace: 0.966, consistency: 0.92, aggression: 0.45, composure: 0.88, style: 'Rookie' },
  { name: 'Ana Duarte',     team: 'Maré Racing',       color: 0x00a3ff, pace: 0.975, consistency: 0.89, aggression: 0.58, composure: 0.78, style: 'Wet specialist', wetBonus: 0.03 },
];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

const CAR_W = 2.0;     // lateral clearance needed between car centres
const DECEL = 26;      // m/s^2 the AI plans to brake at when following

export class AIDriver {
  /** @param difficulty global pace multiplier for the whole field (e.g. 0.93 easy .. 1.0 pro) */
  constructor(car, track, line, profile, persona, seed = 1, difficulty = 1) {
    this.car = car; this.track = track; this.line = line; this.profile = profile;
    this.p = persona; this.rand = rng(seed); this.difficulty = difficulty;
    this.hint = -1; this.s = 0;
    this.lat = null;
    this.mistake = 0; this.mistakeKind = '';
    this.pressure = 0; this.noise = 0;
    this.launchDelay = 0.08 + this.rand() * 0.3 * (1.2 - (persona.consistency ?? 0.9));
    this.status = '';
    // pit control (set by the session): forced lateral line, speed cap, stop point (track s)
    this.forceLat = null; this.speedCap = null; this.stopIn = null;
  }

  update(dt, others = [], env = { wet: 0 }, racing = true) {
    const car = this.car, tr = this.track, p = this.p, line = this.line;
    const pr = tr.project(car.x, car.z, this.hint);
    this.hint = pr.i; this.s = pr.s;
    const v = car.speed, L = tr.length;
    const hw = tr.width / 2 - 1.3;
    if (this.lat === null) this.lat = pr.lat;

    // ---- nearby cars in track coordinates ----
    const near = [];
    for (const o of others) {
      if (o.car === car) continue;
      let ds = o.s - pr.s;
      if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
      if (ds < -25 || ds > 120) continue;
      const opr = tr.project(o.car.x, o.car.z, o.hint ?? -1);
      near.push({ ds, lat: opr.lat, v: o.car.speed });
    }

    // ---- pressure from a car close behind (composure resists it) ----
    let behind = 0;
    for (const o of near) if (o.ds < 0 && o.ds > -18) behind = Math.max(behind, 1 + o.ds / 18);
    this.pressure += (behind * (1 - p.composure) - this.pressure) * Math.min(1, dt * 0.7);

    // ---- lane choice by cost ----
    const lookI = tr.idx(pr.i + Math.round((10 + v * 0.6) / tr.ds));
    const ideal = line.offset[lookI];
    let cornerK = 0;
    for (let k = 0; k < 120; k += 10) cornerK = Math.max(cornerK, Math.abs(tr.curv[tr.idx(pr.i + Math.round(k / tr.ds))]));
    const cornerW = Math.min(1, cornerK / 0.012);
    let best = ideal, bestCost = Infinity;
    for (let c = -hw; c <= hw + 1e-6; c += 0.75) {
      let cost = Math.abs(c - ideal) * (0.12 + cornerW * 0.5) + Math.abs(c - this.lat) * 0.08;
      for (const o of near) {
        if (Math.abs(c - o.lat) >= CAR_W + 0.6) continue;
        if (o.ds > -4 && o.ds < 7) cost += 50;              // alongside: never steer into them
        else if (o.ds >= 7) {
          const closing = v - o.v;
          const reach = o.ds / Math.max(0.5, closing);       // seconds until we arrive
          if (closing > -1 && reach < 4) cost += (6 + 6 * p.aggression) * (1 - reach / 4) + 2;
          else if (o.ds < 25) cost += 1.5;
        }
      }
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    if (this.mistake > 0 && this.mistakeKind === 'wide') best -= Math.sign(tr.curv[lookI] || 1) * 3;
    if (this.forceLat !== null) best = this.forceLat;
    best = Math.max(-hw, Math.min(hw, best));
    const latRate = 2.2 + v * 0.03;
    this.lat += Math.max(-latRate * dt, Math.min(latRate * dt, best - this.lat));

    // ---- mistakes under pressure ----
    if (this.mistake <= 0) {
      const chance = ((1 - p.consistency) * 0.02 + this.pressure * 0.25) * dt;
      if (racing && this.rand() < chance) {
        this.mistake = 0.8 + this.rand() * 0.8;
        this.mistakeKind = this.rand() < 0.5 ? 'late' : 'wide';
      }
    } else this.mistake -= dt;

    // ---- steering: pure pursuit on (centreline + chosen lateral) ----
    const look = 8 + v * 0.42;
    const li = tr.idx(pr.i + Math.round(look / tr.ds));
    const tx = tr.x[li] + tr.nx[li] * this.lat, tz = tr.z[li] + tr.nz[li] * this.lat;
    const sinY = Math.sin(car.yaw), cosY = Math.cos(car.yaw);
    const dx = tx - car.x, dz = tz - car.z;
    const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY;
    const alpha = Math.atan2(lx, Math.max(0.1, lz));
    const ld = Math.hypot(lx, lz);
    const kappa = 2 * Math.sin(alpha) / ld;
    const steerAng = Math.atan(car.spec.wheelbase * kappa) + (kappa * v - car.r) * 0.06;
    this.noise += ((this.rand() - 0.5) * (1 - p.consistency) * 0.06 - this.noise) * Math.min(1, dt * 3);
    const steer = Math.max(-1, Math.min(1, steerAng / car.spec.maxSteer + this.noise));

    // ---- target speed ----
    const wetPen = env.wet ? env.wet * (0.40 - (p.wetBonus || 0) * 3) : 0;
    let paceMul = p.pace * this.difficulty * (1 - wetPen * 0.55);
    if (this.mistake > 0 && this.mistakeKind === 'late') paceMul *= 1.07;
    paceMul *= 1 - Math.min(0.12, Math.abs(this.lat - ideal) * 0.012 * cornerW);
    let target = Infinity;
    for (let k = 0; k <= 6; k++) target = Math.min(target, this.profile[tr.idx(pr.i + k)]);
    target *= paceMul;
    // follow: hold a safe gap behind any car in our lane (stopping-distance based)
    this.status = '';
    for (const o of near) {
      if (o.ds <= 0) continue;
      if (Math.abs(o.lat - this.lat) > CAR_W + 0.3 && Math.abs(o.lat - pr.lat) > CAR_W + 0.3) continue;
      const gap = o.ds - (6 + v * 0.12);
      const vSafe = gap >= 0 ? Math.sqrt(o.v * o.v + 2 * DECEL * gap) : Math.max(0, o.v + gap * 0.8);
      if (vSafe < target) { target = vSafe; this.status = 'follow'; }
    }

    if (this.speedCap !== null) target = Math.min(target, this.speedCap);
    if (this.stopIn !== null) target = Math.min(target, Math.sqrt(2 * 7 * Math.max(0, this.stopIn - 1)));
    let throttle = 0, brake = 0;
    const err = target - v;
    if (!racing) { throttle = 0.4; brake = 1; }
    else if (err > 0) throttle = Math.min(1, 0.35 + err * 0.6);
    else if (err < -0.4) brake = Math.min(1, -err * 0.28);
    const rearSlide = Math.max(car.wheels[2].slide, car.wheels[3].slide);
    throttle *= Math.max(0.2, Math.min(1, 1.6 - rearSlide));
    if (racing && this.launchDelay > 0) { this.launchDelay -= dt; throttle = 0; brake = 1; }
    if (this.stopIn !== null && this.stopIn < 1.5) { throttle = 0; brake = 1; }
    return { throttle, brake, steer };
  }
}
