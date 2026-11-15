// Career: season calendar, standings, R&D development tree, rivalry. Pure data/logic.
import { PERSONALITIES } from './ai.js';
import { POINTS } from './weekend.js';

export const CALENDAR = ['silverstone', 'imola', 'monza', 'spa', 'suzuka', 'canyon'];

export const UPGRADES = {
  power:  { name: 'Power unit',      desc: 'More torque across the rev range', per: '+1.4% power', cost: [25, 40, 60, 85, 115] },
  aero:   { name: 'Aero package',    desc: 'More downforce: faster fast corners', per: '+2% downforce', cost: [25, 40, 60, 85, 115] },
  grip:   { name: 'Suspension',      desc: 'Mechanical grip in slow corners', per: '+0.8% grip', cost: [20, 35, 55, 80, 110] },
  brakes: { name: 'Brake system',    desc: 'Shorter stopping distances', per: '+3% brake force', cost: [15, 25, 40, 60, 85] },
  tyres:  { name: 'Tyre management', desc: 'Kinder on tyres: longer stints', per: '-7% wear', cost: [15, 25, 40, 60, 85] },
};

export function newCareer() {
  const standings = { You: 0 };
  for (const p of PERSONALITIES) standings[p.name] = 0;
  return {
    v: 1, season: 1, round: 0, calendar: CALENDAR.slice(), standings, rd: 30,
    upgrades: { power: 0, aero: 0, grip: 0, brakes: 0, tyres: 0 },
    heat: {}, rival: 'Dario Vell', history: [], challenges: {}, team: 'Velocity Works',
  };
}

/** Car setup multipliers. The rookie team starts a little behind the field. */
export function carSetup(c) {
  const u = c.upgrades;
  return {
    powerMul: 0.965 + 0.014 * u.power,
    aeroMul: 0.95 + 0.02 * u.aero,
    gripMul: 0.985 + 0.008 * u.grip,
    brakeMul: 0.95 + 0.03 * u.brakes,
    wearMul: 1.1 - 0.07 * u.tyres,
  };
}

export function upgradeCost(c, key) { const lvl = c.upgrades[key]; return lvl >= 5 ? null : UPGRADES[key].cost[lvl]; }
export function buyUpgrade(c, key) {
  const cost = upgradeCost(c, key);
  if (cost == null || c.rd < cost) return false;
  c.rd -= cost; c.upgrades[key]++; return true;
}

export function sortedStandings(c) {
  return Object.entries(c.standings).sort((a, b) => b[1] - a[1]);
}

/** Pick the rival: the driver closest to you in the standings (ahead preferred). */
export function pickRival(c) {
  const st = sortedStandings(c);
  const me = st.findIndex(([n]) => n === 'You');
  const ahead = st[me - 1], behind = st[me + 1];
  let pick = ahead ? ahead[0] : behind ? behind[0] : c.rival;
  // a hot grudge overrides standings
  for (const [n, h] of Object.entries(c.heat)) if (h >= 3 && n !== pick && (c.heat[pick] || 0) < h) pick = n;
  c.rival = pick;
  return pick;
}

/**
 * Apply a finished race. order: array of names in finishing order ('You' for player).
 * incidents: { name: count of contacts with the player }
 */
export function applyRace(c, trackId, order, { quali = null, incidents = {}, fastestLap = null } = {}) {
  const pts = {};
  order.forEach((n, i) => { const p = POINTS[i] || 0; pts[n] = p; c.standings[n] = (c.standings[n] || 0) + p; });
  const myPos = order.indexOf('You') + 1;
  const rivalPos = order.indexOf(c.rival) + 1;
  // R&D income: base + results + beating your rival
  let rd = 18 + (pts.You || 0) * 1.6 + (myPos <= 3 ? 10 : 0);
  const beatRival = myPos > 0 && rivalPos > 0 && myPos < rivalPos;
  if (beatRival) rd += 12;
  rd = Math.round(rd);
  c.rd += rd;
  // rivalry heat: contact raises it, a clean race cools it slightly
  for (const [n, k] of Object.entries(incidents)) c.heat[n] = (c.heat[n] || 0) + k;
  for (const n of Object.keys(c.heat)) if (!incidents[n]) c.heat[n] = Math.max(0, c.heat[n] - 0.5);
  const entry = { round: c.round + 1, track: trackId, pos: myPos, quali, points: pts.You || 0, rd, rival: c.rival, rivalPos, beatRival };
  c.history.push(entry);
  c.round++;
  const newRival = pickRival(c);
  if (c.round >= c.calendar.length) {
    entry.seasonOver = true;
  }
  return { ...entry, newRival };
}

export function startNextSeason(c) {
  c.season++; c.round = 0;
  for (const k of Object.keys(c.standings)) c.standings[k] = 0;
  c.rd += 40;
}

const KEY = 'vc-career-v1';
export function saveCareer(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage blocked */ } }
export function loadCareer() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
export function clearCareer() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Rival-flavoured personality: your rival races you harder and is more rattled by you. */
export function rivalPersona(p) { return { ...p, aggression: Math.min(1, p.aggression + 0.2), composure: Math.max(0.3, p.composure - 0.1), isRival: true }; }
