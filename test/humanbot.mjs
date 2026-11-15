// Human-like drivability tests. Unlike the precise bots these:
//  - react 0.25 s late, press keys in taps, misjudge braking by +-15%
//  - or just hold throttle with no steering (what a beginner does on Full assists)
import { getTrack } from '../src/sim/tracks.js';
import { Session } from '../src/sim/session.js';
import { ASSIST_PRESETS } from '../src/sim/assists.js';
import { DriveAssist } from '../src/sim/drivingassist.js';
import { keyboardFilter } from '../src/game/input.js';

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function humanLap(trackId, preset, style = 'sloppy', laps = 2, seed = 5, withField = false) {
  const delay = style === 'decent' ? 9 : 15, err = style === 'decent' ? 0.12 : 0.3;
  const tr = getTrack(trackId), R = rng(seed);
  const ses = new Session(tr, { mode: withField ? 'race' : 'practice', laps });
  const e = ses.addCar({ name: 'H', isPlayer: true, assists: ASSIST_PRESETS[preset], fuel: 20, gridSlot: withField ? 6 : 0 });
  const assist = new DriveAssist(ses, e, preset === 'full' ? 'full' : preset === 'medium' ? 'medium' : 'off');
  const st = { steer: 0, throttle: 0, brake: 0 };
  const hist = []; let keys = { left: false, right: false, up: true, down: false }, holdT = 0;
  let off = 0, n = 0, hint = -1, brakeBias = 1;
  while (e.laps.length < laps && ses.time < 300 * laps) {
    const c = e.car;
    if (style === 'throttle') keys = { left: false, right: false, up: true, down: false };
    else {
      // perception is delayed 0.25 s
      const pr = tr.project(c.x, c.z, hint); hint = pr.i;
      const li = tr.idx(pr.i + Math.round((25 + c.speed * 0.75) / tr.ds));
      const tx = tr.x[li] + tr.nx[li] * ses.line.offset[li], tz = tr.z[li] + tr.nz[li] * ses.line.offset[li];
      const dx = tx - c.x, dz = tz - c.z, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      const ang = Math.atan2(dx * cy - dz * sy, dx * sy + dz * cy);
      let target = Infinity; for (let k = 0; k < 10; k++) target = Math.min(target, ses.profile[tr.idx(pr.i + k)]);
      hist.push({ ang, target, v: c.speed });
      const seen = hist.length > delay ? hist[hist.length - 1 - delay] : hist[0];
      if (R() < 0.01) brakeBias = 1 - err / 2 + R() * err;
      if ((holdT -= 1 / 60) <= 0) {
        keys = { left: seen.ang > 0.06, right: seen.ang < -0.06, up: seen.v < seen.target * brakeBias * 0.95, down: seen.v > seen.target * brakeBias + 2 };
        holdT = 0.08 + R() * 0.1;
      }
    }
    keyboardFilter(st, keys, 1 / 60, e.car.speed);
    const others = ses.entries.map(x => ({ car: x.car, s: x.s, hint: x.hint }));
    const inp = assist.apply(1 / 60, { ...st }, others, ses.state !== 'countdown');
    ses.update(1 / 60, inp);
    if (process.env.HDBG && n % 30 === 0 && n < 60 * 40) console.log((n / 60).toFixed(1), 's', e.s.toFixed(0), 'lat', e.lat.toFixed(1), 'v', (c.speed * 3.6).toFixed(0), 'r', c.r.toFixed(2), 'beta', Math.atan2(c.v, Math.abs(c.u)).toFixed(2), 'keys', (keys.left ? 'L' : '') + (keys.right ? 'R' : '') + (keys.up ? 'U' : '') + (keys.down ? 'D' : ''), 'st', st.steer.toFixed(2), 'in', inp.steer.toFixed(2), 'd', c.steerAngle.toFixed(3), 'lock', (c.lastLock || 0).toFixed(3));
    if (c.offTrack >= 2) off++; n++;
  }
  return { track: tr.name, preset, style, laps: e.laps.map(l => +l.time.toFixed(1)), offPct: +(100 * off / n).toFixed(1), walls: e.wallHits };
}
if (process.argv[1]?.endsWith('humanbot.mjs')) {
  for (const t of ['spa', 'suzuka', 'imola']) {
    console.log(JSON.stringify(humanLap(t, 'full', 'throttle')));
    console.log(JSON.stringify(humanLap(t, 'full', 'sloppy')));
    console.log(JSON.stringify(humanLap(t, 'medium', 'sloppy')));
  }
}
