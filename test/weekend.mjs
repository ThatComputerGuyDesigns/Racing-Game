// Headless strategy race: tyre wear, pit stops, dynamic weather.
import { getTrack } from '../src/sim/tracks.js';
import { Session, PERSONALITIES } from '../src/sim/session.js';
export function strategyRace(trackId = 'monza', laps = 5, weather = 'dynamic', verbose = false) {
  const ses = new Session(getTrack(trackId), { mode: 'race', laps, wearMul: 45 / laps, weather, estLap: 105 });
  PERSONALITIES.forEach((p, k) => { const e = ses.addCar({ name: p.name, persona: p, gridSlot: k, seed: 17 + k * 31, compound: ['soft', 'medium', 'hard'][k % 3] }); e.plannedStop = Math.max(2, Math.round(laps * (0.4 + (k % 3) * 0.15))); });
  ses.startRace();
  const log = []; let contacts = 0;
  while (ses.time < 300 * laps && !ses.entries.every(e => e.finished)) {
    ses.update(1 / 60);
    for (const ev of ses.events) {
      if (ev.type === 'impact') contacts++;
      else if (ev.type !== 'lap') log.push(`${ses.time.toFixed(0)}s ${ev.type} ${ev.entry ? ev.entry.name.split(' ')[1] : ''} ${ev.compound || (ev.wet !== undefined ? 'wet->' + ev.wet : '')}`);
    }
    ses.events.length = 0;
  }
  if (verbose) console.log(log.join('\n'));
  return { finished: ses.entries.filter(e => e.finished).length, of: ses.entries.length, stops: ses.entries.map(e => e.stops || 0), contacts,
    order: ses.order.map(e => `${e.name.split(' ')[1]}(${e.car.compound[0]})`).join(' ') };
}
if (process.argv[1]?.endsWith('weekend.mjs')) console.log(strategyRace(process.argv[2] || 'monza', +(process.argv[3] || 5), process.argv[4] || 'dynamic', true));
