// Keyboard drivability test: a bot that can only press digital keys (like a keyboard
// player), fed through the real keyboard filter and the player's assists.
// A good handling model + assists should let it lap cleanly and reasonably fast.
import { getTrack } from '../src/sim/tracks.js';
import { Session } from '../src/sim/session.js';
import { keyboardFilter } from '../src/game/input.js';
import { ASSIST_PRESETS as PRESETS } from '../src/sim/assists.js';
export { PRESETS };
const _old = {
  full:   { abs: true, tc: true, stability: 0.6, steerAssist: 1.0, autoGear: true, brakeAssist: true },
  medium: { abs: true, tc: true, stability: 0.3, steerAssist: 0.8, autoGear: true },
  off:    { abs: false, tc: false, stability: 0, steerAssist: 0.5, autoGear: true },
};
export function keyboardLap(trackId, preset = 'full', laps = 2) {
  const tr = getTrack(trackId);
  const ses = new Session(tr, { mode: 'practice' });
  const e = ses.addCar({ name: 'KB', isPlayer: true, assists: PRESETS[preset], fuel: 20 });
  const st = { steer: 0, throttle: 0, brake: 0 };
  let off = 0, n = 0, hint = -1;
  while (e.laps.length < laps && ses.time < 260 * laps) {
    const c = e.car;
    const pr = tr.project(c.x, c.z, hint); hint = pr.i;
    // aim at the racing line ahead; press a key only when clearly off-target (bang-bang)
    const li = tr.idx(pr.i + Math.round((8 + c.speed * 0.45) / tr.ds));
    const lat = ses.line.offset[li];
    const tx = tr.x[li] + tr.nx[li] * lat, tz = tr.z[li] + tr.nz[li] * lat;
    const dx = tx - c.x, dz = tz - c.z, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    const ang = Math.atan2(dx * cy - dz * sy, dx * sy + dz * cy) - c.r * 0.12;
    let target = Infinity;
    for (let k = 0; k < 8; k++) target = Math.min(target, ses.profile[tr.idx(pr.i + k)]);
    const keys = { left: ang > 0.02, right: ang < -0.02, up: c.speed < target * 0.93, down: c.speed > target * 0.97 + 1.5 };
    keyboardFilter(st, keys, 1 / 60);
    ses.update(1 / 60, { ...st });
    if (c.offTrack >= 2) off++; n++;
  }
  return { track: tr.name, preset, laps: e.laps.map(l => +l.time.toFixed(2)), offPct: +(100 * off / n).toFixed(1), walls: e.wallHits };
}
if (process.argv[1]?.endsWith('keyboardbot.mjs')) for (const t of ['spa', 'suzuka', 'monza']) for (const p of ['full', 'off']) console.log(keyboardLap(t, p));
