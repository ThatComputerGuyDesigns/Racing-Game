// Race-weekend helpers: reference lap per circuit (simulated once, cached),
// AI qualifying times from personality, points, tyre wear scaling.
import { getTrack } from './tracks.js';
import { Session } from './session.js';

const refCache = {};
/** Simulated flying-lap time for a pace-1.0 driver on this circuit (cached). */
export function referenceLap(trackId, wet = 0) {
  const key = trackId + ':' + (wet > 0.3 ? 'wet' : 'dry');
  if (refCache[key]) return refCache[key];
  const ses = new Session(getTrack(trackId), { mode: 'practice', weather: wet > 0.3 ? 'rain' : 'dry' });
  const e = ses.addCar({ name: 'ref', persona: { name: 'ref', pace: 1, consistency: 1, aggression: 0.5, composure: 1 }, compound: wet > 0.3 ? 'inter' : 'soft' });
  while (e.laps.length < 2 && ses.time < 600) ses.update(1 / 30);
  return (refCache[key] = e.laps[1]?.time || e.laps[0]?.time || 120);
}

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** AI quali time: reference / pace, plus a consistency-driven error (mistakes cost time). */
export function aiQualiTime(persona, difficulty, ref, seed, wet = 0) {
  const r = rng(seed);
  const wetBonus = wet > 0.3 ? (persona.wetBonus || 0) : 0;
  const base = ref / (persona.pace * difficulty * (1 + wetBonus));
  const err = (1 - persona.consistency) * (r() * 2.2 + (r() < 0.12 ? 2.5 : 0));
  return base * (1 + err * 0.01) + r() * 0.15;
}

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** Wear multiplier so tyre strategy matters in a short race (a 5-lap race wears like ~45 laps). */
export function wearMulFor(laps) { return Math.max(1, 45 / laps); }
