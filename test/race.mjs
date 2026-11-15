// Headless race: full AI field, checks everyone finishes and counts contact.
import { getTrack } from '../src/sim/tracks.js';
import { Session, PERSONALITIES } from '../src/sim/session.js';
export function runRace(trackId, laps = 2, wet = 0) {
  const ses = new Session(getTrack(trackId), { mode: 'race', laps });
  ses.env.wet = wet;
  PERSONALITIES.forEach((p, k) => ses.addCar({ name: p.name, persona: p, gridSlot: k, seed: 17 + k * 31, compound: wet ? 'inter' : 'medium' }));
  ses.startRace();
  let impacts = 0, bigImpacts = 0;
  while (ses.time < 260 * laps && !ses.entries.every(e => e.finished)) {
    ses.update(1 / 60);
    for (const ev of ses.events) if (ev.type === 'impact') { impacts++; if (ev.power > 6) bigImpacts++; }
    ses.events.length = 0;
  }
  const fin = ses.entries.filter(e => e.finished).length;
  return { track: trackId, finished: fin, of: ses.entries.length, impacts, bigImpacts, winner: ses.order[0].name, order: ses.order.map(e => e.name.split(' ')[1]).join(' ') };
}
if (process.argv[1].endsWith('race.mjs')) for (const t of (process.argv[2] ? [process.argv[2]] : ['spa', 'monza', 'suzuka'])) console.log(runRace(t));
