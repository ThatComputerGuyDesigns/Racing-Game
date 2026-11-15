// Vehicle dynamics: 4-wheel planar model with load transfer, aero, Pacejka-style
// lateral tires, friction-ellipse combined slip, tire temperature + wear, engine,
// gearbox, brakes and driver assists. Pure JS: runs in browser and Node tests.

export const COMPOUNDS = {
  soft:   { name: 'Soft',   grip: 1.06, wear: 1.7, optT: 72,  window: 28, color: '#e8333a' },
  medium: { name: 'Medium', grip: 1.00, wear: 1.0, optT: 78,  window: 32, color: '#f2c94c' },
  hard:   { name: 'Hard',   grip: 0.95, wear: 0.6, optT: 86,  window: 36, color: '#eeeeee' },
  inter:  { name: 'Inter',  grip: 0.90, wear: 1.2, optT: 60,  window: 30, color: '#3fb950', wet: 0.80 },
};

export const CAR_SPECS = {
  // Original open-wheel "Velocity Formula" class car (Apex V8 hybrid concept)
  formula: {
    name: 'VF-26',
    mass: 798,          // kg incl. driver, without fuel (F1-class)
    fuelMax: 70,        // kg
    wheelbase: 3.4,
    cgFront: 0.46,      // fraction of weight on front axle
    cgHeight: 0.30,
    trackF: 1.62, trackR: 1.56,
    wheelR: 0.33,
    izzScale: 1.0,
    mu: 1.55,           // base slick peak friction
    loadSens: 0.08,     // grip loss per unit of Fz/Fz0 above 1
    alphaPeak: 0.12,    // rad
    rollDistF: 0.58,
    rearGrip: 1.07,     // wider rears: stable, understeer-biased limit balance
    cda: 1.25, cla: 4.4, aeroBalF: 0.43,
    rollingRes: 0.012,
    maxSteer: 0.42,     // rad at the wheel
    brakeForce: 42000,  // N total requested at full pedal (exceeds grip -> lockups)
    brakeBias: 0.57,
    finalDrive: 4.1,
    gears: [2.9, 2.2, 1.8, 1.52, 1.32, 1.17, 1.05],
    shiftTime: 0.06,
    idleRpm: 4000, redline: 12500,
    torque: [[3000, 380], [6000, 520], [9000, 610], [11000, 620], [12500, 560], [13000, 300]],
    drivetrainEff: 0.92,
    diffLock: 0.35,     // 0 open, 1 spool (power oversteer tendency)
  },
};

const G = 9.81, RHO = 1.225;

function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const a = table[i - 1], b = table[i];
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
  }
  return table[table.length - 1][1];
}

// Normalized lateral curve: magic-formula shape, peak 1.0 at x=1 (x = alpha/alphaPeak)
// falling to ~0.78 when fully sliding.
function lateralCurve(x) {
  const ax = Math.abs(x);
  const B = 1.0, C = 1.45, E = -0.6;
  // scale so the peak lands at x == 1
  const k = 1.335;
  const bx = B * ax * k;
  const y = Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
  return Math.sign(x) * Math.max(y, 0.0);
}

export function defaultAssists() {
  return { abs: true, tc: true, stability: 0.5, autoGear: true, steerAssist: 0.6, brakeAssist: false };
}

export class Car {
  constructor(spec = CAR_SPECS.formula, opts = {}) {
    this.spec = spec;
    this.assists = { ...defaultAssists(), ...(opts.assists || {}) };
    this.compound = opts.compound || 'medium';
    this.fuel = opts.fuel ?? 40;
    this.setup = { ...(opts.setup || {}) }; // career upgrades: powerMul, gripMul, aeroMul, brakeMul
    const L = spec.wheelbase;
    this.a = L * (1 - spec.cgFront); // CoM to front axle
    this.b = L * spec.cgFront;       // CoM to rear axle
    this.wheels = [
      { px: spec.trackF / 2, pz: this.a, front: true },   // FL
      { px: -spec.trackF / 2, pz: this.a, front: true },  // FR
      { px: spec.trackR / 2, pz: -this.b, front: false }, // RL
      { px: -spec.trackR / 2, pz: -this.b, front: false },// RR
    ];
    for (const w of this.wheels) {
      Object.assign(w, { fz: 0, fx: 0, fy: 0, alpha: 0, alphaF: 0, slide: 0, lock: 0, spin: 0,
        temp: opts.tireTemp ?? 80, wear: 0, rot: 0, onGrass: false, slipPower: 0 });
    }
    this.reset(0, 0, 0);
  }

  get mass() { return this.spec.mass + this.fuel; }

  reset(x, z, yaw, speed = 0) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = Math.sin(yaw) * speed; this.vz = Math.cos(yaw) * speed;
    this.r = 0;
    this.u = speed; this.v = 0;
    this.ax = 0; this.ay = 0; // smoothed local accel (fwd, left)
    this.gear = speed > 20 ? 4 : 1; this.rpm = this.spec.idleRpm; this.shiftTimer = 0;
    this.steerAngle = 0; this.throttle = 0; this.brake = 0;
    this.tcActive = 0; this.absActive = 0;
    this.offTrack = 0; this.surface = 'asphalt';
    this.distance = 0;
    this.pitch = 0; this.roll = 0;
    this.lastImpact = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  /**
   * Advance the car.
   * @param {number} dt seconds (call with <= 1/120; use stepFixed for frame dt)
   * @param {{throttle:number, brake:number, steer:number, shiftUp?:boolean, shiftDown?:boolean}} input
   * @param {(x:number,z:number)=>{grip:number, drag:number, name:string}} surfaceAt per-wheel surface query
   * @param {{grip:number, temp:number}} env weather: track grip multiplier (wet) and ambient temp
   */
  step(dt, input, surfaceAt, env = { grip: 1, temp: 24, wet: 0 }) {
    const s = this.spec, A = this.assists, setup = this.setup;
    const m = this.mass;
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // local velocities: u forward, v left
    const u = this.vx * sinY + this.vz * cosY;
    const v = this.vx * cosY - this.vz * sinY;
    this.u = u; this.v = v;
    const speed = Math.hypot(u, v);

    // ---- driver inputs & assists ----
    let throttle = Math.max(0, Math.min(1, input.throttle || 0));
    let brake = Math.max(0, Math.min(1, input.brake || 0));
    let steerIn = Math.max(-1, Math.min(1, input.steer || 0));
    // reverse: brake held at standstill engages reverse
    if (this.gear === 1 && u < 0.5 && brake > 0.5 && throttle < 0.1) this.reverse = true;
    if (throttle > 0.1) this.reverse = false;

    // Grip-based steering lock: with assist, full input = the steering angle that puts the
    // front tyres at their peak slip for this speed (max cornering, no scrubbing understeer).
    const assistAmt = A.steerAssist ?? 0;
    const vv = Math.max(speed, 6);
    const kD = 0.5 * RHO * s.cla / m;
    const muE = 1.35 * (1 - 0.15 * kD * vv * vv / G);
    const aLat = muE * (G + kD * vv * vv);
    const gripLock = Math.min(s.maxSteer, Math.atan(s.wheelbase * aLat / (vv * vv)) + s.alphaPeak * 0.9);
    const lock = s.maxSteer + (gripLock - s.maxSteer) * assistAmt;
    let targetSteer = steerIn * lock;
    if (A.stability > 0 && speed > 5) {
      // body slip angle; help the driver countersteer when the rear steps out
      const beta = Math.atan2(v, Math.abs(u));
      targetSteer += -beta * 0.9 * A.stability;
      // yaw damping: resist yaw rate beyond what the path needs
      const rNeed = aLat / vv;
      if (Math.abs(this.r) > rNeed * 1.05) targetSteer -= Math.sign(this.r) * (Math.abs(this.r) - rNeed * 1.05) * 0.25 * A.stability;
    }
    targetSteer = Math.max(-s.maxSteer, Math.min(s.maxSteer, targetSteer));
    const steerRate = 4.5; // rad/s at the wheel (physical rack speed)
    const dS = targetSteer - this.steerAngle;
    this.steerAngle += Math.max(-steerRate * dt, Math.min(steerRate * dt, dS));
    const delta = this.steerAngle;

    // ---- loads: static + aero + transfer (from smoothed accels) ----
    const q = 0.5 * RHO * speed * speed;
    const aeroMul = setup.aeroMul ?? 1;
    const down = q * s.cla * aeroMul * (env.dirtyAir ?? 1);
    const drag = q * s.cda * (0.9 + 0.1 * aeroMul) * (env.slipstream ?? 1);
    const L = s.wheelbase;
    const Wf = m * G * s.cgFront + down * s.aeroBalF;
    const Wr = m * G * (1 - s.cgFront) + down * (1 - s.aeroBalF);
    const dLong = m * this.ax * s.cgHeight / L; // + when accelerating -> rear
    const latF = m * this.ay * s.cgHeight * s.rollDistF / s.trackF;
    const latR = m * this.ay * s.cgHeight * (1 - s.rollDistF) / s.trackR;
    // ay > 0 means accelerating to the left -> load goes to right wheels
    const W = this.wheels;
    W[0].fz = Math.max(0, (Wf - dLong) / 2 - latF);
    W[1].fz = Math.max(0, (Wf - dLong) / 2 + latF);
    W[2].fz = Math.max(0, (Wr + dLong) / 2 - latR);
    W[3].fz = Math.max(0, (Wr + dLong) / 2 + latR);
    const fz0 = m * G / 4;

    // ---- engine & gearbox ----
    const gears = s.gears;
    const wheelOmega = u / s.wheelR;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const ratio = () => gears[this.gear - 1] * s.finalDrive;
    let rpm = Math.abs(wheelOmega) * ratio() * 60 / (2 * Math.PI);
    if (A.autoGear && this.shiftTimer <= 0 && !this.reverse) {
      if (rpm > s.redline * 0.965 && this.gear < gears.length) { this.gear++; this.shiftTimer = s.shiftTime; }
      else if (this.gear > 1) {
        const lower = Math.abs(wheelOmega) * gears[this.gear - 2] * s.finalDrive * 60 / (2 * Math.PI);
        if (lower < s.redline * 0.80) { this.gear--; this.shiftTimer = s.shiftTime; }
      }
    } else if (!A.autoGear && this.shiftTimer <= 0) {
      if (input.shiftUp && this.gear < gears.length) { this.gear++; this.shiftTimer = s.shiftTime; }
      if (input.shiftDown && this.gear > 1) {
        const lower = Math.abs(wheelOmega) * gears[this.gear - 2] * s.finalDrive * 60 / (2 * Math.PI);
        if (lower < s.redline * 1.02) { this.gear--; this.shiftTimer = s.shiftTime; }
      }
    }
    rpm = Math.abs(wheelOmega) * ratio() * 60 / (2 * Math.PI);
    const clutchRpm = Math.max(rpm, s.idleRpm + throttle * 3500); // launch: clutch slip
    const engRpm = Math.min(clutchRpm, s.redline + 300);
    this.rpm += (engRpm - this.rpm) * Math.min(1, dt * 25);
    let torque = interp(s.torque, engRpm) * (setup.powerMul ?? 1);
    if (rpm > s.redline) torque = 0; // limiter
    if (this.shiftTimer > 0) torque *= 0.15;
    let driveForce = throttle * torque * ratio() * s.drivetrainEff / s.wheelR;
    // engine braking
    if (throttle < 0.05 && u > 2) driveForce -= 0.12 * interp(s.torque, engRpm) * ratio() / s.wheelR * (rpm / s.redline);
    if (this.reverse) driveForce = -brake * 2500;

    // ---- per-wheel tire forces ----
    const comp = COMPOUNDS[this.compound];
    let Fx = 0, Fy = 0, Mz = 0;
    let tcCut = 0, absCut = 0;
    this.offTrack = 0;
    const brakeMul = setup.brakeMul ?? 1;
    const gripMul = (setup.gripMul ?? 1);
    for (let k = 0; k < 4; k++) {
      const w = W[k];
      // wheel contact world position for surface lookup
      const wx = this.x + w.px * cosY + w.pz * sinY;
      const wz = this.z - w.px * sinY + w.pz * cosY;
      const surf = surfaceAt ? surfaceAt(wx, wz) : { grip: 1, drag: 0, name: 'asphalt' };
      w.surface = surf.name;
      if (surf.name !== 'asphalt' && surf.name !== 'kerb') this.offTrack++;
      // velocity at contact patch (local)
      const cvx = v + this.r * w.pz;
      const cvz = u - this.r * w.px;
      const d = w.front ? delta : 0;
      const cd = Math.cos(d), sd = Math.sin(d);
      const vf = cvz * cd + cvx * sd;   // along wheel
      const vl = cvx * cd - cvz * sd;   // across wheel (left)
      // slip angle with low-speed regularisation and relaxation length
      const alphaRaw = Math.atan2(vl, Math.max(Math.abs(vf), 4));
      const relax = Math.min(1, dt * Math.max(Math.abs(vf), 4) / 0.45);
      w.alphaF += (alphaRaw - w.alphaF) * relax;
      w.alpha = w.alphaF;

      // friction available
      const tempFactor = this._tempGrip(w.temp, comp);
      const wearFactor = 1 - 0.32 * w.wear * w.wear - 0.05 * w.wear;
      const wetFactor = env.wet > 0 ? (comp.wet ? 1 - env.wet * (1 - comp.wet) : 1 - env.wet * 0.42) : 1;
      const loadFactor = 1 - s.loadSens * (w.fz / fz0 - 1);
      const mu = (w.front ? 1 : s.rearGrip) * s.mu * comp.grip * tempFactor * wearFactor * wetFactor * surf.grip * env.grip * loadFactor * gripMul;
      const fmax = mu * w.fz;

      // longitudinal request
      let fxReq = 0;
      if (!w.front) fxReq += driveForce / 2;
      const bshare = w.front ? s.brakeBias / 2 : (1 - s.brakeBias) / 2;
      let bReq = (this.reverse ? 0 : brake) * s.brakeForce * brakeMul * bshare;
      if (A.abs) {
        // cornering ABS: leave the tyre the lateral grip it is using (prevents trail-brake spins)
        const latUseB = Math.min(0.95, Math.abs(w.alpha) / s.alphaPeak);
        const allowB = fmax * Math.max(0.3, Math.sqrt(1 - latUseB * latUseB)) * 0.97;
        if (bReq > allowB) { absCut = 1; bReq = allowB; }
      }
      if (Math.abs(vf) > 0.3) fxReq -= Math.sign(vf) * bReq; else fxReq -= Math.sign(fxReq) * Math.min(Math.abs(fxReq), bReq);
      // lateral demand from slip angle
      const fyPure = -fmax * lateralCurve(w.alpha / s.alphaPeak);
      // traction control: cap drive so the rear keeps the lateral grip it is using
      if (!w.front && A.tc && fxReq > 0) {
        // judge by normalised slip angle: past the peak the force drops but the tyre is still saturated
        const latUse = Math.min(0.98, Math.abs(w.alpha) / s.alphaPeak);
        const allow = fmax * Math.max(0.12, Math.sqrt(1 - latUse * latUse)) * 0.95;
        if (fxReq > allow) { tcCut = Math.max(tcCut, Math.min(1, fxReq / allow - 1)); fxReq = allow; }
      }
      // combined slip: friction ellipse with sliding when longitudinal demand exceeds grip
      let fx, fy;
      const lr = Math.abs(fxReq) / Math.max(1, fmax);
      if (lr > 1) {
        // wheelspin or lockup: sliding friction, lateral grip collapses
        const slideMu = 0.85 + 0.1 / lr;
        fx = Math.sign(fxReq) * fmax * slideMu;
        fy = fyPure * Math.sqrt(Math.max(0, 1 - slideMu * slideMu)) * 1.3;
        if (fxReq > 0) w.spin = Math.min(1, lr - 1 + 0.2); else w.lock = Math.min(1, lr - 1 + 0.2);
      } else {
        fx = fxReq;
        fy = fyPure * Math.sqrt(Math.max(0, 1 - lr * lr));
        w.spin = 0; w.lock = 0;
      }
      // rolling resistance & surface drag (grass)
      fx -= Math.sign(vf) * w.fz * (s.rollingRes + surf.drag);
      w.fx = fx; w.fy = fy;
      // slip power -> heat & wear
      const slideVel = Math.abs(vl) + (w.spin + w.lock) * Math.max(4, Math.abs(vf) * 0.25) + Math.abs(fx) / Math.max(fmax, 1) * Math.abs(vf) * 0.02;
      w.slipPower = (Math.abs(fy) + Math.abs(fx)) * slideVel;
      w.slide = Math.min(1, Math.abs(w.alpha) / (s.alphaPeak * 1.6) + w.spin + w.lock);
      this._thermal(w, dt, speed, env, comp);
      w.rot += (vf / s.wheelR) * (w.lock > 0.5 ? 0 : 1) * dt + (w.spin * 60 * dt);
      // to car local frame
      const flx = fx * sd + fy * cd;  // left component
      const flz = fx * cd - fy * sd;  // forward component
      Fx += flx; Fy += flz;
      Mz += w.pz * flx - w.px * flz;
    }
    this.tcActive = tcCut; this.absActive = absCut;

    // gravity along the road gradient (set per-frame by the session)
    Fy -= m * G * (this.slope || 0);
    // aero drag at CoM
    Fy -= Math.sign(u) * drag;
    // stationary stiction so the car doesn't creep
    if (speed < 0.5 && throttle < 0.05 && !this.reverse) { Fx *= 0.2; Fy -= u * m * 4; }

    // ---- integrate (world frame) ----
    const lx = Fx, lz = Fy; // local left / forward totals
    const wxF = lz * sinY + lx * cosY;
    const wzF = lz * cosY - lx * sinY;
    this.vx += wxF / m * dt;
    this.vz += wzF / m * dt;
    const Iz = m * this.a * this.b * 0.9 * s.izzScale;
    this.r += Mz / Iz * dt;
    if (speed < 1) this.r *= 0.9;
    this.yaw += this.r * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.distance += speed * dt;
    // smoothed accelerations for load transfer (suspension lag)
    const k = Math.min(1, dt * 12);
    this.ax += (lz / m - this.ax) * k;
    this.ay += (lx / m - this.ay) * k;
    this.pitch = -this.ax * 0.0035;
    this.roll = this.ay * 0.003;
    // fuel burn (kg/s) ~ throttle * rpm
    this.fuel = Math.max(0, this.fuel - throttle * (this.rpm / s.redline) * 0.034 * dt);
    if (this.fuel <= 0) this.fuelEmpty = true;
    this.throttle = throttle; this.brake = brake;
  }

  _tempGrip(T, comp) {
    const d = (T - comp.optT) / comp.window;
    // cold tyres lose more than slightly hot ones; overheating hurts beyond window
    const pen = d < 0 ? 0.06 * d * d : 0.08 * d * d;
    return Math.max(0.78, 1 - pen);
  }

  _thermal(w, dt, speed, env, comp) {
    const heat = w.slipPower * 0.00022 + w.fz * speed * 0.000011;
    const cool = (w.temp - env.temp) * (0.02 + speed * 0.0016) * (1 + (env.wet || 0) * 2.5);
    w.temp += (heat - cool) * dt;
    // wear grows with sliding energy and temperature above window
    const over = Math.max(0, w.temp - comp.optT - comp.window * 0.6) * 0.02;
    w.wear = Math.min(1, w.wear + (w.slipPower * 0.0000000095 + over * 0.0000012 * speed) * comp.wear * (env.wearMul ?? 1) * dt);
  }

  /** Fixed-step integration helper: splits frameDt into 1/240 substeps. */
  stepFixed(frameDt, input, surfaceAt, env) {
    const h = 1 / 240;
    this._acc = (this._acc || 0) + Math.min(frameDt, 0.1);
    let n = 0;
    while (this._acc >= h && n < 30) { this.step(h, input, surfaceAt, env); this._acc -= h; n++; }
  }

  tireSummary() {
    return this.wheels.map(w => ({ temp: w.temp, wear: w.wear, slide: w.slide }));
  }
}
