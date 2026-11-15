// Skidpad: hold a speed, sweep steering, record peak steady lateral g.
// Returns effective friction mu_eff = ay / (g + downforce/m) used to calibrate AI speed profiles.
import { Car, CAR_SPECS } from '../src/sim/car.js';
export function skidpad(v, assists = { abs: true, tc: true, stability: 0, steerAssist: 0, autoGear: true }) {
  const spec = CAR_SPECS.formula;
  let best = 0;
  for (let st = 0.02; st <= 0.6; st += 0.02) {
    const c = new Car(spec, { assists, fuel: 30 });
    c.reset(0, 0, 0, v); c.gear = 4;
    let ay = 0;
    for (let i = 0; i < 240 * 4; i++) {
      const thr = Math.max(0, Math.min(1, (v - c.u) * 0.5 + 0.25));
      c.step(1 / 240, { throttle: thr, brake: c.u > v + 1 ? 0.3 : 0, steer: st }, null, { grip: 1, temp: 24, wet: 0 });
      if (i > 240 * 3) ay = Math.max(ay, Math.abs(c.ay));
    }
    if (Math.abs(c.u - v) < 4 && ay > best) best = ay;
  }
  const m = spec.mass + 30, down = 0.5 * 1.225 * spec.cla * v * v;
  return { v, g: best / 9.81, muEff: best / (9.81 + down / m) };
}
if (process.argv[1]?.endsWith('skidpad.mjs')) for (const v of [15, 30, 50, 70]) console.log(skidpad(v));
