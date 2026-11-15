// Driving assists that sit between the player's input and the car.
//  full   : co-driver. Hands off = it drives the line; hands on = it blends with you.
//           Brakes for corners, protects track edges, avoids cars. You hold throttle and race.
//  medium : you steer; co-driver braking + edge protection (TC/ABS/stability in the car).
//  off    : raw input.
import { AIDriver } from './ai.js';

export class DriveAssist {
  constructor(session, entry, level) {
    this.session = session; this.entry = entry; this.level = level;
    this.copilot = new AIDriver(entry.car, session.track, session.line, session.profile,
      { name: 'assist', pace: 0.97, consistency: 1, aggression: 0.5, composure: 1 }, 7, 1);
    this.copilot.launchDelay = 0;
    this.active = 0; // 0..1 how much the assist is steering (for the HUD)
  }

  apply(dt, input, others, racing = true) {
    if (this.level === 'off') { this.active = 0; return input; }
    const ses = this.session, tr = ses.track, e = this.entry, car = e.car;
    let { steer, throttle, brake } = input;
    if (this.level === 'medium') {
      // you steer; the co-driver only manages corner-entry braking
      const ai = this.copilot.update(dt, others, ses.env, racing);
      if (ai.brake > 0.05) { brake = Math.max(brake, ai.brake); throttle = Math.min(throttle, 1 - ai.brake); }
      this.active = 0;
    }
    if (this.level === 'full') {
      const ai = this.copilot.update(dt, others, ses.env, racing);
      // co-driver computes raw steering; rescale for the assisted steering lock
      // convert the co-driver's wheel angle into a yaw-rate request (assisted steering)
      const v = Math.max(car.speed, 4);
      const kap = Math.tan(ai.steer * car.spec.maxSteer) / car.spec.wheelbase;
      ai.steer = Math.max(-1, Math.min(1, kap * v / (car.lastRMax || 1)));
      const hands = Math.abs(steer) > 0.05;
      const w = hands ? 0.45 : 1.0;           // how much the co-driver steers
      steer = steer * (1 - w) + ai.steer * w;
      if (ai.brake > 0.05) { brake = Math.max(brake, ai.brake); throttle = Math.min(throttle, 1 - ai.brake); }
      // never let the player's throttle exceed what the corner allows
      if (ai.throttle < 0.35 && throttle > ai.throttle + 0.3) throttle = ai.throttle + 0.3;
      this.active = w;
    }
    // edge protection: predict lateral position 0.7 s ahead and steer back inside the white lines
    const pr = tr.project(car.x, car.z, e.hint);
    const latVel = car.vx * tr.nx[pr.i] + car.vz * tr.nz[pr.i];
    const pred = pr.lat + latVel * 0.7;
    const hw = tr.width / 2 - 1.2;
    const k = this.level === 'full' ? 0.18 : 0.15;
    if (pred > hw) steer -= (pred - hw) * k;
    else if (pred < -hw) steer += (-hw - pred) * k;
    // gone off anyway: ease off and recover
    if (car.offTrack >= 2 && this.level === 'full') throttle = Math.min(throttle, 0.5);
    steer = Math.max(-1, Math.min(1, steer));
    return { ...input, steer, throttle, brake };
  }
}
