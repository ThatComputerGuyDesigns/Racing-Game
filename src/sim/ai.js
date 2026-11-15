// AI driver: follows the racing line using only the same controls a player has
// (throttle/brake/steer). No rubber-banding: pace comes purely from skill traits.

export const PERSONALITIES = [
  // pace: fraction of limit grip used; consistency: noise; aggression: overtake/defend; composure: pressure handling
  { name: 'Mara Okonkwo',   team: 'Halcyon Racing',    color: 0x1f6feb, pace: 0.985, consistency: 0.95, aggression: 0.55, composure: 0.90, brakeLate: 0.6, style: 'Precise' },
  { name: 'Dario Vell',     team: 'Ferroquin Motori',   color: 0xd7262e, pace: 0.990, consistency: 0.85, aggression: 0.90, composure: 0.60, brakeLate: 0.9, style: 'Aggressive' },
  { name: 'Ines Kallström', team: 'Nordlys GP',         color: 0x2ec4b6, pace: 0.975, consistency: 0.97, aggression: 0.35, composure: 0.95, brakeLate: 0.4, style: 'Metronome' },
  { name: 'Theo Marchetti', team: 'Vantage Corsa',      color: 0xf2a33a, pace: 0.970, consistency: 0.80, aggression: 0.75, composure: 0.50, brakeLate: 0.8, style: 'Hothead' },
  { name: 'Yuki Arashiro',  team: 'Kaze Dynamics',      color: 0xffffff, pace: 0.980, consistency: 0.92, aggression: 0.50, composure: 0.80, brakeLate: 0.5, style: 'Tyre whisperer' },
  { name: 'Sol Benítez',    team: 'Cobalt Autosport',   color: 0x7a3cff, pace: 0.960, consistency: 0.88, aggression: 0.65, composure: 0.70, brakeLate: 0.6, style: 'Opportunist' },
  { name: 'Priya Raman',    team: 'Lumen Works',        color: 0xc8f031, pace: 0.965, consistency: 0.93, aggression: 0.40, composure: 0.85, brakeLate: 0.5, style: 'Strategist' },
  { name: 'Lukas Brandt',   team: 'Eisen Motorsport',   color: 0x8a8f98, pace: 0.955, consistency: 0.90, aggression: 0.60, composure: 0.75, brakeLate: 0.55, style: 'Defender' },
  { name: 'Céleste Roy',    team: 'Aurore Racing',      color: 0xff5fa2, pace: 0.968, consistency: 0.86, aggression: 0.70, composure: 0.65, brakeLate: 0.7, style: 'Late braker' },
  { name: 'Kofi Mensah',    team: 'Sable Engineering',  color: 0x2b2b2b, pace: 0.950, consistency: 0.94, aggression: 0.45, composure: 0.88, brakeLate: 0.45, style: 'Rookie' },
  { name: 'Ana Duarte',     team: 'Maré Racing',        color: 0x00a3ff, pace: 0.962, consistency: 0.89, aggression: 0.58, composure: 0.78, brakeLate: 0.6, style: 'Wet specialist', wetBonus: 0.03 },
];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export class AIDriver {
  constructor(car, track, line, profile, persona, seed = 1) {
    this.car = car; this.track = track; this.line = line; this.profile = profile;
    this.p = persona; this.rand = rng(seed);
    this.hint = -1;
    this.latTarget = 0;   // extra lateral offset for overtaking/defending
    this.lat = 0;
    this.mistake = 0;     // seconds remaining of a mistake
    this.mistakeKind = '';
    this.pressure = 0;
    this.noise = 0;
    this.s = 0;
  }

  /** others: array of {car, s} for awareness. Returns input. */
  update(dt, others = [], env = { wet: 0 }) {
    const car = this.car, tr = this.track, p = this.p;
    const pr = tr.project(car.x, car.z, this.hint);
    this.hint = pr.i; this.s = pr.s;
    const speed = car.speed;

    // --- traffic awareness ---
    let ahead = null, aheadGap = 1e9, behindGap = 1e9;
    let sideBlock = 0;
    for (const o of others) {
      if (o.car === car) continue;
      let ds = o.s - pr.s;
      if (ds > tr.length / 2) ds -= tr.length; else if (ds < -tr.length / 2) ds += tr.length;
      const olat = tr.project(o.car.x, o.car.z, o.hint ?? -1).lat;
      if (ds > 0 && ds < 60 && Math.abs(olat - pr.lat) < 6 && ds < aheadGap) { ahead = { ...o, lat: olat }; aheadGap = ds; }
      if (ds < 0 && -ds < behindGap) behindGap = -ds;
      if (Math.abs(ds) < 6) sideBlock = olat > pr.lat ? 1 : -1; // car alongside: +1 on our left
    }
    // pressure builds when someone is close behind; composure resists it
    const close = behindGap < 15 ? 1 - behindGap / 15 : 0;
    this.pressure += ((close * (1 - p.composure)) - this.pressure) * Math.min(1, dt * 0.8);

    // overtaking: move off-line when closing on a car ahead
    const hw = tr.width / 2 - 1.8;
    let wantLat = 0;
    if (ahead && aheadGap < 35) {
      const closing = speed - ahead.car.speed;
      if (closing > -2 || p.aggression > 0.6) {
        const side = ahead.lat > this.line.offset[pr.i] ? -1 : 1;
        wantLat = side * 3.4 * (0.6 + p.aggression * 0.6);
      }
    }
    if (sideBlock !== 0) wantLat = -sideBlock * 3.2; // give racing room
    this.latTarget += (wantLat - this.latTarget) * Math.min(1, dt * 0.9);

    // --- mistakes under pressure (lock-up / run wide), driven by personality ---
    if (this.mistake <= 0) {
      const base = (1 - p.consistency) * 0.006 + this.pressure * 0.05;
      if (this.rand() < base * dt * 60 * 0.02) {
        this.mistake = 0.6 + this.rand() * 0.9;
        this.mistakeKind = this.rand() < 0.5 ? 'lockup' : 'wide';
      }
    } else this.mistake -= dt;

    // --- steering: pure pursuit on (racing line + lateral offset) ---
    const look = 9 + speed * 0.5;
    const li = tr.idx(pr.i + Math.round(look / tr.ds));
    let offs = this.line.offset[li] + this.latTarget + (this.mistake > 0 && this.mistakeKind === 'wide' ? 3 : 0);
    offs = Math.max(-hw, Math.min(hw, offs));
    const tx = tr.x[li] + tr.nx[li] * offs, tz = tr.z[li] + tr.nz[li] * offs;
    const sinY = Math.sin(car.yaw), cosY = Math.cos(car.yaw);
    const dx = tx - car.x, dz = tz - car.z;
    const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY;
    const alpha = Math.atan2(lx, Math.max(0.1, lz));
    const ld = Math.hypot(lx, lz);
    let steerAng = Math.atan(2 * car.spec.wheelbase * Math.sin(alpha) / ld);
    // damp yaw: counter rotation if yaw rate exceeds what path needs
    const kappa = 2 * Math.sin(alpha) / ld;
    steerAng += (kappa * speed - car.r) * 0.08;
    this.noise += ((this.rand() - 0.5) * (1 - p.consistency) * 0.08 - this.noise) * Math.min(1, dt * 3);
    let steer = steerAng / car.spec.maxSteer + this.noise;
    steer = Math.max(-1, Math.min(1, steer));

    // --- speed control from profile ---
    const wetPen = env.wet ? env.wet * (0.42 - (p.wetBonus || 0) * 3) : 0;
    const paceMul = p.pace * (1 - wetPen * 0.55) * (1 - this.pressure * 0.02);
    const brakeLook = Math.round((4 + speed * 0.1 * (1 - p.brakeLate * 0.5)) / tr.ds);
    let target = Infinity;
    for (let k = 0; k <= brakeLook; k += 2) target = Math.min(target, this.profile[tr.idx(pr.i + k)]);
    target *= paceMul;
    // don't drive into the car ahead: if laterally overlapping, match its speed with a safety gap
    if (ahead && aheadGap < 30) {
      const overlap = Math.abs(ahead.lat - (pr.lat + (this.latTarget - (this.latTarget * 0)))) < 2.4 || Math.abs(ahead.lat - pr.lat) < 2.2;
      if (overlap) target = Math.min(target, ahead.car.speed + Math.max(-4, (aheadGap - 7) * 0.45));
    }
    let throttle = 0, brake = 0;
    const err = target - speed;
    if (err > 0) throttle = Math.min(1, 0.4 + err * 0.5); else if (err < -0.6) brake = Math.min(1, -err * 0.22);
    // traction management on exit: ease off when sliding
    const rearSlide = Math.max(car.wheels[2].slide, car.wheels[3].slide);
    if (rearSlide > 0.8) throttle *= 0.6;
    if (this.mistake > 0 && this.mistakeKind === 'lockup' && brake > 0.2) brake = 1;
    return { throttle, brake, steer };
  }
}
