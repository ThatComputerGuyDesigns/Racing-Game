// Circuits: one original (Red Mesa) plus real-world layouts imported in realtracks.js.
// Original circuits. Control points in metres on the (x, z) plane, closed loops.
import { Track } from './track.js';
import { REAL_TRACKS } from './realtracks.js';

export const TRACK_DEFS = {
  canyon: {
    id: 'canyon',
    name: 'Red Mesa Speedway',
    blurb: 'Desert power circuit: two huge straights joined by technical chicanes.',
    width: 15, runoff: 12,
    points: [
      [0, -500], [0, 500], [60, 620], [200, 640], [260, 560], [230, 460], [300, 380],
      [400, 420], [460, 540], [580, 560], [640, 440], [640, -440], [560, -600],
      [400, -620], [330, -520], [260, -540], [200, -650], [80, -660],
    ],
    elevation: [[0, 0], [0.25, 3], [0.5, 8], [0.75, 2]],
    start: 0.02,
  },
};

Object.assign(TRACK_DEFS, REAL_TRACKS);

// Open-world hub: an original coastal road loop linking the venues (career free-roam).
TRACK_DEFS.region = {
  id: 'region', name: 'Velocity Coast Road', hub: true,
  blurb: 'Free-roam coastal road linking every venue. Speed traps and challenges earn R&D.',
  width: 13, runoff: 16,
  points: [
    [0, 0], [0, 450], [0, 900], [150, 1150], [420, 1250], [700, 1150], [820, 950], [1100, 900],
    [1400, 1000], [1650, 850], [1700, 600], [1550, 400], [1600, 150], [1800, -50], [1750, -350],
    [1500, -500], [1200, -450], [1000, -250], [750, -350], [500, -550], [250, -500], [100, -300],
  ],
  elevation: [[0, 0], [0.15, 10], [0.3, 38], [0.45, 24], [0.6, 55], [0.75, 30], [0.9, 8]],
  start: 0.02,
};

const cache = {};
export function getTrack(id) {
  if (!cache[id]) cache[id] = new Track(TRACK_DEFS[id]);
  return cache[id];
}

/** Surface query bound to a track: returns grip/drag for a world point. */
export function makeSurfaceFn(track) {
  let hint = -1;
  return (x, z) => {
    const p = track.project(x, z, hint);
    hint = p.i;
    const a = Math.abs(p.lat), hw = track.width / 2;
    if (a <= hw) return SURF.asphalt;
    if (a <= hw + 1.4 && track.kerb[p.i]) return SURF.kerb;
    return SURF.grass;
  };
}

export const SURF = {
  asphalt: { name: 'asphalt', grip: 1.0, drag: 0 },
  kerb: { name: 'kerb', grip: 0.92, drag: 0.004 },
  grass: { name: 'grass', grip: 0.55, drag: 0.07 },
};
