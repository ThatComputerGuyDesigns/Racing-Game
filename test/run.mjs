// `npm test`: automated handling + AI checks. Fails (exit 1) on regressions.
import { runLapSim } from './lapsim.mjs';
import { skidpad } from './skidpad.mjs';
import { runRace } from './race.mjs';
import { keyboardLap } from './keyboardbot.mjs';
import { humanLap } from './humanbot.mjs';
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
// 1. skidpad: limit lateral grip in a believable sim-cade band, rising with downforce
const s30 = skidpad(30), s60 = skidpad(60);
check(s30.g > 1.4 && s30.g < 2.2, `skidpad 108 km/h: ${s30.g.toFixed(2)} g`);
check(s60.g > s30.g, `downforce adds grip at 216 km/h: ${s60.g.toFixed(2)} g`);
// 2. AI hot laps on every circuit: complete, stay on track, consistent
const expect = { spa: [125, 160], silverstone: [115, 150], monza: [90, 115], imola: [95, 120], suzuka: [110, 140], canyon: [80, 105] };
for (const [id, [lo, hi]] of Object.entries(expect)) {
  const r = runLapSim(id, { laps: 2 });
  const t = r.laps[1];
  check(r.laps.length === 2 && t > lo && t < hi && r.offPct < 3, `${r.track}: ${t?.toFixed(2)}s, off ${r.offPct.toFixed(1)}%, walls ${r.wallHits}`);
}
// 3. keyboard drivability: digital-only inputs through the real keyboard filter + assists
for (const [t, preset] of [['spa', 'full'], ['suzuka', 'full'], ['silverstone', 'medium']]) {
  const r = keyboardLap(t, preset, 2);
  check(r.laps.length === 2 && r.offPct < 3 && r.walls === 0, `keyboard ${preset} @ ${r.track}: ${r.laps.join(' / ')}s, off ${r.offPct}%`);
}
// 3b. human-like drivers on Full assists (late reactions, key taps, braking errors, or no steering at all)
for (const [t, style] of [['spa', 'throttle'], ['suzuka', 'sloppy'], ['imola', 'sloppy'], ['monza', 'sloppy']]) {
  const r = humanLap(t, 'full', style, 2);
  check(r.laps.length === 2 && r.offPct < 3 && r.walls === 0, `human(${style}) on Full @ ${r.track}: ${r.laps.join(' / ')}s, off ${r.offPct}%`);
}
// 4. full-field races: everyone finishes, racing stays clean
for (const t of ['monza', 'spa']) {
  const race = runRace(t, 1);
  check(race.finished >= race.of - 1 && race.impacts <= 15, `${t} race: ${race.finished}/${race.of} finished, ${race.impacts} contacts`);
}
process.exit(fail ? 1 : 0);
