// Automated lap simulation: an AI driver at full pace drives each circuit.
import { getTrack, TRACK_DEFS } from '../src/sim/tracks.js';
import { Session } from '../src/sim/session.js';

export function runLapSim(trackId, { laps = 3, persona, compound = 'medium', wet = 0, verbose = false } = {}) {
  const tr = getTrack(trackId);
  const ses = new Session(tr, { mode: 'practice' });
  ses.env.wet = wet;
  const e = ses.addCar({ name: 'SIM', persona: persona || { name: 'sim', pace: 1.0, consistency: 1, aggression: 0.5, composure: 1, brakeLate: 0.5 }, compound });
  const dt = 1 / 60;
  let offFrames = 0, frames = 0, maxLatG = 0, maxSpeed = 0;
  while (e.laps.length < laps && ses.time < 200 * laps) {
    ses.update(dt);
    frames++;
    if (e.car.offTrack >= 2) offFrames++;
    maxLatG = Math.max(maxLatG, Math.abs(e.car.ay) / 9.81);
    maxSpeed = Math.max(maxSpeed, e.car.speed);
  }
  const res = {
    track: tr.name, length: tr.length, laps: e.laps.map(l => +l.time.toFixed(2)),
    best: e.best, offPct: 100 * offFrames / frames, wallHits: e.wallHits,
    maxLatG, vmax: maxSpeed * 3.6,
    temps: e.car.wheels.map(w => Math.round(w.temp)), wear: e.car.wheels.map(w => +(w.wear * 100).toFixed(1)),
  };
  if (verbose) console.log(res);
  return res;
}

if (process.argv[1].endsWith('lapsim.mjs')) {
  for (const id of (process.argv[2] ? [process.argv[2]] : Object.keys(TRACK_DEFS))) { const r = runLapSim(id); console.log(r.track.padEnd(24), 'laps', r.laps.join(' '), 'off%', r.offPct.toFixed(1), 'walls', r.wallHits, 'vmax', r.vmax.toFixed(0), 'T', r.temps.join(','), 'wear', r.wear.join(',')); }
}
