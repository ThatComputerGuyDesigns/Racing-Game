// Velocity Circuit - game shell: menu, session lifecycle, camera, HUD, FX.
import * as THREE from 'three';
import { TRACK_DEFS, getTrack } from '../sim/tracks.js';
import { Session, PERSONALITIES } from '../sim/session.js';
import { AIDriver } from '../sim/ai.js';
import { COMPOUNDS } from '../sim/car.js';
import { World } from './world.js';
import { buildCar, syncCar } from './carmesh.js';
import { Particles, SkidMarks, makeComposer } from './fx.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { ASSIST_PRESETS, DIFFICULTY } from '../sim/assists.js';
import { RaceLine } from './raceline.js';
import { DriveAssist } from '../sim/drivingassist.js';
import { referenceLap, aiQualiTime, wearMulFor, POINTS } from '../sim/weekend.js';
import { newCareer, loadCareer, saveCareer, carSetup, UPGRADES, upgradeCost, buyUpgrade, sortedStandings, applyRace, startNextSeason, rivalPersona } from '../sim/career.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- renderer ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let savedQ = null; try { savedQ = localStorage.getItem('vc-quality'); } catch { /* storage blocked */ }
const QUALITY = params.get('quality') || savedQ || 'high';
const LOW = QUALITY === 'low';
renderer.setPixelRatio(LOW ? 0.6 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
const post = makeComposer(renderer, scene, camera, LOW);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  post.composer.setSize(innerWidth, innerHeight);
});

const input = new Input();
const audio = new Audio();
const smoke = new Particles(scene, 1500, false);
const sparks = new Particles(scene, 800, true);
const skids = new SkidMarks(scene);

// ---------- config / menu ----------
const cfg = {
  track: params.get('track') || 'spa', mode: params.get('mode') || 'race', laps: +(params.get('laps') || 5),
  weather: params.get('weather') || 'dry', assist: params.get('assist') || 'full',
  autopilot: params.has('autopilot'), difficulty: params.get('difficulty') || 'medium',
};
let lineMode = null; // null = follow assist preset
let raceLine = null;
let driveAssist = null;
const ASSISTS = ASSIST_PRESETS;

function drawTrackPreview(cv, tr, w, h, color = '#f1f3f5', lw = 3) {
  const g = cv.getContext('2d');
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < tr.n; i++) { minx = Math.min(minx, tr.x[i]); maxx = Math.max(maxx, tr.x[i]); minz = Math.min(minz, tr.z[i]); maxz = Math.max(maxz, tr.z[i]); }
  const sc = Math.min((w - 20) / (maxx - minx), (h - 20) / (maxz - minz));
  const ox = (w - (maxx - minx) * sc) / 2, oz = (h - (maxz - minz) * sc) / 2;
  const map = (x, z) => [ox + (x - minx) * sc, oz + (z - minz) * sc];
  g.clearRect(0, 0, w, h); g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round'; g.beginPath();
  for (let i = 0; i <= tr.n; i += 2) { const [x, y] = map(tr.x[i % tr.n], tr.z[i % tr.n]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.stroke();
  return map;
}

function buildMenu() {
  const host = $('tracks'); host.innerHTML = '';
  const order = ['spa', 'silverstone', 'monza', 'suzuka', 'imola', 'canyon'];
  for (const id of order) {
    const def = TRACK_DEFS[id]; if (!def) continue;
    const tr = getTrack(id);
    const el = document.createElement('div'); el.className = 'card' + (id === cfg.track ? ' sel' : '');
    const cv = document.createElement('canvas'); cv.width = 460; cv.height = 180;
    el.append(cv);
    el.insertAdjacentHTML('beforeend', `<h3 class="cond">${def.name}</h3><p>${(tr.length / 1000).toFixed(2)} km · ${def.real ? 'Real-world layout' : 'Original circuit'}<br>${def.blurb}</p>`);
    drawTrackPreview(cv, tr, 460, 180, '#e8ecf0', 4);
    el.onclick = () => { cfg.track = id; host.querySelectorAll('.card').forEach(c => c.classList.remove('sel')); el.classList.add('sel'); };
    host.append(el);
  }
  for (const key of ['mode', 'laps', 'weather', 'assist', 'difficulty']) {
    const seg = $(key);
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('sel', String(cfg[key]) === b.dataset.v);
      b.onclick = () => { cfg[key] = key === 'laps' ? +b.dataset.v : b.dataset.v; seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b)); $('go').textContent = cfg.mode === 'race' ? 'RACE' : 'DRIVE'; };
    });
  }
  const notes = { full: 'Easiest. A co-driver steers the racing line and brakes for corners. Just hold throttle; steer to overtake.', medium: 'You steer. Auto braking for corners, edge protection, stability control, racing line.', off: 'Simulation. No help, manual gears (Q/E). For wheel or pad.' };
  const setNote = () => { $('assistNote').textContent = notes[cfg.assist]; };
  setNote(); $('assist').addEventListener('click', () => setTimeout(setNote));
  $('go').onclick = () => { audio.start(); startSession(); };
}

// ---------- game state ----------
let state = 'menu';
let world = null, worldKey = '';
let session = null, player = null;
const meshes = new Map();
let camMode = 0; const CAMS = ['chase', 'far', 'cockpit', 'nose'];
const cam = { pos: new THREE.Vector3(), yaw: 0, fov: 62, shake: 0 };
let bestTrace = null, curTrace = [];
let autopilot = null;

function showLoading(v, text) { $('loading').style.display = v ? 'flex' : 'none'; if (text) $('loading').textContent = text; }

// ---------- session plans ----------
// plan.kind: 'race' | 'quali' | 'practice' | 'hub'
let plan = null;
let weekend = null;   // { track, career, weather, laps, phase, quali: [{name,time}], grid: [names] }
let career = loadCareer();
let hubGates = [], hubMeshes = [], hubState = null;

function ensureWorld(trackId) {
  if (worldKey === trackId) return;
  world?.dispose();
  world = new World(renderer, scene, getTrack(trackId), { wet: 0, sunElev: 34, sunAz: 150 });
  worldKey = trackId; minimap.map = null;
}

function launch(p) {
  plan = p;
  $('menu').style.display = 'none'; $('overlay').style.display = 'none';
  showLoading(true, p.kind === 'hub' ? 'Heading out on the coast road…' : 'Building circuit…');
  setTimeout(() => { ensureWorld(p.track); newSession(); showLoading(false); }, 30);
}

function startSession() {
  if (cfg.mode === 'weekend') return startWeekend(cfg.track, false);
  launch({ kind: cfg.mode === 'race' ? 'race' : 'practice', track: cfg.track, laps: cfg.laps, weather: cfg.weather });
}

function aiStartCompound(p) {
  if (p.style === 'Strategist' || p.style === 'Tyre whisperer') return 'hard';
  if (p.aggression > 0.75) return 'soft';
  return 'medium';
}

function newSession() {
  for (const m of meshes.values()) scene.remove(m);
  meshes.clear(); smoke.clear(); sparks.clear(); skids.clear();
  for (const m of hubMeshes) scene.remove(m); hubMeshes = []; hubGates = [];
  const p = plan, tr = getTrack(p.track);
  const isRace = p.kind === 'race';
  const weather = p.weather || 'dry';
  const startWet = weather === 'rain';
  const diff = DIFFICULTY[cfg.difficulty];
  const setup = career && (p.career || p.kind === 'hub') ? carSetup(career) : {};
  session = new Session(tr, { mode: isRace ? 'race' : 'practice', laps: isRace ? p.laps : 99, weather,
    wearMul: isRace ? wearMulFor(p.laps) : 1, estLap: referenceLapQuick(p.track), rolling: p.kind === 'quali' });
  session.env.temp = startWet ? 14 : 24;
  const myCompound = p.compound || (startWet ? 'inter' : 'medium');
  const addAI = (pers, slot, k) => {
    const persona = career && p.career && pers.name === career.rival ? rivalPersona(pers) : pers;
    const e = session.addCar({ name: pers.name, persona, compound: startWet ? 'inter' : aiStartCompound(pers), gridSlot: slot, seed: 17 + k * 31, fuel: 30, difficulty: diff });
    e.plannedStop = Math.max(2, Math.round(p.laps * (0.4 + (k % 3) * 0.15)));
    return e;
  };
  if (isRace) {
    const order = p.grid || [...PERSONALITIES].sort((a, b) => b.pace - a.pace).map(x => x.name).toSpliced(7, 0, 'You');
    order.forEach((name, slot) => {
      if (name === 'You') player = session.addCar({ name: 'You', isPlayer: true, assists: ASSISTS[cfg.assist], compound: myCompound, gridSlot: slot, fuel: 30, setup });
      else addAI(PERSONALITIES.find(x => x.name === name), slot, slot);
    });
    session.startRace();
  } else {
    player = session.addCar({ name: 'You', isPlayer: true, assists: ASSISTS[cfg.assist], compound: p.kind === 'quali' ? 'soft' : myCompound, gridSlot: 0, fuel: 20, setup });
    if (p.kind === 'hub') {
      // a few rivals out cruising the coast road for company
      PERSONALITIES.slice(0, 4).forEach((pers, k) => {
        const e = session.addCar({ name: pers.name, persona: { ...pers, pace: 0.86 + k * 0.02 }, compound: 'medium', gridSlot: 3 + k * 6, seed: 5 + k, fuel: 30, difficulty: 1 });
        e.hubTraffic = true;
      });
    }
  }
  player.car.assists = { ...ASSISTS[cfg.assist] };
  player.nextCompound = startWet ? 'inter' : 'medium';
  autopilot = cfg.autopilot;
  for (const e of session.entries) {
    const color = e.isPlayer ? 0xff3b2f : e.persona.color;
    const accent = e.isPlayer ? 0x111111 : (e.persona.color === 0xffffff ? 0xd7262e : 0xf1f1f1);
    const idx = session.entries.indexOf(e);
    const num = e.isPlayer ? '1' : String([4, 16, 22, 33, 8, 11, 27, 55, 63, 81, 14][idx % 11]);
    const sponsor = e.isPlayer ? 'VELOCITY' : e.persona.team.split(' ')[0].toUpperCase();
    const m = buildCar(color, accent, COMPOUNDS[e.car.compound].color, num, sponsor);
    scene.add(m); meshes.set(e, m);
  }
  driveAssist = new DriveAssist(session, player, cfg.assist);
  raceLine?.dispose(scene);
  raceLine = new RaceLine(scene, tr, session.line, session.profile, player.car.spec);
  lineMode = p.kind === 'hub' ? 'off' : null;
  bestTrace = null; curTrace = [];
  cam.yaw = player.car.yaw; cam.pos.set(player.car.x - Math.sin(cam.yaw) * 8, 3, player.car.z - Math.cos(cam.yaw) * 8);
  $('hud').style.display = 'block'; $('overlay').style.display = 'none';
  $('board').style.display = isRace ? 'block' : 'none';
  $('posbox').style.display = p.kind === 'hub' ? 'none' : '';
  if (p.kind === 'hub') buildHub();
  state = 'playing';
  audio.mute(false);
  toast(p.kind === 'race' ? `${tr.name} · ${p.laps} laps${weather === 'dynamic' ? ' · changeable weather' : ''}`
    : p.kind === 'quali' ? `Qualifying · ${tr.name} · ${p.qualiLaps - 1} flying laps, best counts (Enter to end)`
    : p.kind === 'hub' ? 'Coast Road · drive to the glowing gate for your next event · G garage' : `${tr.name} · hot lap`);
}

const refQuick = {};
function referenceLapQuick(id) { return refQuick[id] || (refQuick[id] = getTrack(id).length / 50); }

// ---------- race weekend ----------
function startWeekend(trackId, isCareer) {
  const weather = isCareer ? (Math.random() < 0.25 ? 'dynamic' : Math.random() < 0.12 ? 'rain' : 'dry') : cfg.weather;
  weekend = { track: trackId, career: isCareer, weather, laps: isCareer ? 6 : cfg.laps, phase: 'quali' };
  launch({ kind: 'quali', track: trackId, weather: weather === 'rain' ? 'rain' : 'dry', qualiLaps: 3, career: isCareer });
}

function endQuali() {
  const w = weekend; w.phase = 'grid';
  showLoading(true, 'Collecting lap times…');
  setTimeout(() => {
    const wet = w.weather === 'rain' ? 0.8 : 0;
    const ref = referenceLap(w.track, wet);
    const diff = DIFFICULTY[cfg.difficulty];
    const rows = PERSONALITIES.map((p, k) => ({ name: p.name, team: p.team, time: aiQualiTime(p, diff, ref, 101 + k * 7 + (career?.round || 0) * 13, wet) }));
    rows.push({ name: 'You', team: career?.team || 'Velocity Works', time: player.best });
    rows.sort((a, b) => a.time - b.time);
    w.quali = rows; w.grid = rows.map(r => r.name);
    showLoading(false);
    state = 'dialog';
    const myPos = w.grid.indexOf('You') + 1;
    const rival = career && w.career ? career.rival : null;
    const forecast = w.weather === 'dynamic' ? 'Forecast: changeable, rain likely during the race. Intermediates (key 4) if it rains.' : w.weather === 'rain' ? 'Wet race. You start on intermediates.' : 'Dry race. Tyres wear fast: plan one stop (P to box).';
    dialog(`Qualifying · P${myPos}`, `<div class="tbl">${rows.map((r, i) => `<div class="${r.name === 'You' ? 'me' : r.name === rival ? 'rv' : ''}"><b>${i + 1}</b><span>${r.name === 'You' ? 'You' : r.name}${r.name === rival ? ' <span class="pill">RIVAL</span>' : ''}</span><em>${fmt(r.time)}</em></div>`).join('')}</div>
      <p class="note">${forecast}<br>Choose your starting tyre:</p>`,
      (w.weather === 'rain' ? [['Intermediate', 'inter']] : [['Soft · fast, short life', 'soft'], ['Medium', 'medium'], ['Hard · slow, lasts', 'hard']]).map(([label, c], i) => ({ label, primary: i === 1 || w.weather === 'rain', fn: () => startWeekendRace(c) })));
  }, 30);
}

function startWeekendRace(compound) {
  const w = weekend; w.phase = 'race';
  launch({ kind: 'race', track: w.track, laps: w.laps, weather: w.weather, grid: w.grid, compound, career: w.career });
}

// ---------- dialogs ----------
function dialog(title, html, buttons) {
  $('overlay').style.display = 'flex';
  $('ovTitle').textContent = title; $('ovBody').innerHTML = html;
  const host = $('ovBtns'); host.innerHTML = '';
  dialog.keys = {};
  for (const b of buttons) {
    const el = document.createElement('button'); el.textContent = b.label + (b.key ? ` (${b.key})` : ''); if (b.primary) el.className = 'primary';
    el.onclick = () => { $('overlay').style.display = 'none'; b.fn(); };
    host.append(el);
    if (b.key) dialog.keys['Key' + b.key] = b.fn;
  }
}

function garage(onClose) {
  state = 'dialog';
  const c = career;
  const st = sortedStandings(c);
  const up = Object.entries(UPGRADES).map(([k, u]) => {
    const cost = upgradeCost(c, k);
    return `<div class="upg"><div><b>${u.name}</b> <span class="pips">${'●'.repeat(c.upgrades[k])}${'○'.repeat(5 - c.upgrades[k])}</span></div>
      <button data-up="${k}" ${cost == null || c.rd < cost ? 'disabled' : ''}>${cost == null ? 'MAX' : cost + ' R&D'}</button><small>${u.desc} · ${u.per} per level</small></div>`;
  }).join('');
  const heat = c.heat[c.rival] || 0;
  dialog(`Garage · ${c.rd} R&D`, `<p class="note">Season ${c.season} · Round ${Math.min(c.round + 1, c.calendar.length)}/${c.calendar.length} · Rival: <b>${c.rival}</b>${heat >= 2 ? ' (grudge: ' + heat.toFixed(0) + ' incidents)' : ''}</p>
    ${up}
    <h2 style="font-size:15px;margin:16px 0 6px">Standings</h2>
    <div class="tbl">${st.map(([n, p], i) => `<div class="${n === 'You' ? 'me' : n === c.rival ? 'rv' : ''}"><b>${i + 1}</b><span>${n}</span><em>${p} pts</em></div>`).join('')}</div>`,
    [{ label: 'Back to driving', primary: true, key: 'G', fn: () => { state = 'playing'; onClose?.(); } }, { label: 'Main menu', fn: toMenu }]);
  $('ovBody').querySelectorAll('button[data-up]').forEach(b => b.onclick = () => {
    if (buyUpgrade(c, b.dataset.up)) {
      saveCareer(c);
      player.car.setup = carSetup(c);
      garage(onClose);
    }
  });
}

// ---------- career hub (open-world coast road) ----------
function startCareer(fresh) {
  if (fresh || !career) { career = newCareer(); saveCareer(career); }
  goHub();
}
function goHub() { launch({ kind: 'hub', track: 'region', weather: 'dry' }); }

function buildHub() {
  const tr = session.track, c = career;
  const n = c.calendar.length;
  hubState = { trapBest: 0, lapStart: null, prompt: null };
  for (let i = 0; i < n; i++) {
    const frac = 0.08 + i * (0.9 / n);
    const s = tr.length * frac;
    const id = c.calendar[i];
    const status = i < c.round ? 'done' : i === c.round ? 'next' : 'locked';
    const p = tr.pointAt(s), g = new THREE.Group();
    const col = status === 'next' ? 0xff3b2f : status === 'done' ? 0x3fd17a : 0x555a61;
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: status === 'next' ? 2.2 : 0.4, roughness: 0.4 });
    const span = tr.width + 3;
    for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), mat); post.position.set(sd * span / 2, 4.5, 0); g.add(post); }
    const cvs = document.createElement('canvas'); cvs.width = 1024; cvs.height = 128; const gg = cvs.getContext('2d');
    gg.fillStyle = status === 'next' ? '#d7262e' : status === 'done' ? '#1e7a46' : '#2a2d33'; gg.fillRect(0, 0, 1024, 128);
    gg.fillStyle = '#fff'; gg.font = 'italic 800 64px Arial'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.fillText(`ROUND ${i + 1} · ${TRACK_DEFS[id].name.toUpperCase()}`, 512, 66);
    const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 2.4, 0.4), [mat, mat, mat, mat, new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex })]);
    banner.position.y = 8.6; g.add(banner);
    g.position.set(p.x, p.h, p.z); g.rotation.y = p.yaw;
    scene.add(g); hubMeshes.push(g);
    hubGates.push({ s, i, id, status });
  }
  // speed trap at the end of the longest straight
  let bi = 0; for (let i = 0; i < tr.n; i++) if (session.profile[i] > session.profile[bi]) bi = i;
  hubState.trapS = bi * tr.ds;
  const tp = tr.pointAt(hubState.trapS), trap = new THREE.Group();
  const tm = new THREE.MeshStandardMaterial({ color: 0xf2c94c, emissive: 0xf2c94c, emissiveIntensity: 1.2 });
  for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), tm); post.position.set(sd * (tr.width / 2 + 1.5), 2.5, 0); trap.add(post); }
  trap.position.set(tp.x, tp.h, tp.z); trap.rotation.y = tp.yaw; scene.add(trap); hubMeshes.push(trap);
}

function updateHub() {
  const tr = session.track, c = career;
  // gate proximity
  let near = null;
  for (const g of hubGates) {
    let ds = player.s - g.s; if (ds > tr.length / 2) ds -= tr.length; if (ds < -tr.length / 2) ds += tr.length;
    if (Math.abs(ds) < 45) near = g;
  }
  const pr = $('prompt');
  if (near) {
    pr.style.display = 'block';
    const name = TRACK_DEFS[near.id].name;
    if (near.status === 'next') pr.innerHTML = `Round ${near.i + 1} · ${name}<small>Press Enter to start the race weekend · G garage</small>`;
    else if (near.status === 'done') { const h = c.history.find(x => x.track === near.id && x.round === near.i + 1); pr.innerHTML = `${name} · finished P${h ? h.pos : '?'}<small>Completed this season</small>`; }
    else pr.innerHTML = `${name}<small>Locked · finish Round ${c.round + 1} first</small>`;
    if (near.status === 'next' && input.hit('Enter', 'NumpadEnter')) { pr.style.display = 'none'; startWeekend(near.id, true); return; }
  } else {
    const next = hubGates.find(g => g.status === 'next');
    pr.style.display = next ? 'block' : 'none';
    if (next) { let d = next.s - player.s; if (d < 0) d += tr.length; pr.innerHTML = `Next: Round ${next.i + 1} · ${TRACK_DEFS[next.id].name}<small>${(d / 1000).toFixed(1)} km ahead on the coast road · ${c.rd} R&D · G garage</small>`; }
    else if (c.round >= c.calendar.length) { pr.style.display = 'block'; pr.innerHTML = `Season ${c.season} complete<small>Press Enter to start Season ${c.season + 1}</small>`; if (input.hit('Enter')) { startNextSeason(c); saveCareer(c); goHub(); return; } }
  }
  // speed trap challenge
  let dt2 = player.s - hubState.trapS; if (dt2 < -tr.length / 2) dt2 += tr.length;
  if (dt2 > 0 && dt2 < 12 && !hubState.trapped) {
    hubState.trapped = true;
    const kmh = player.car.speed * 3.6;
    const best = c.challenges.trap || 0;
    let msg = `Speed trap ${kmh.toFixed(0)} km/h`;
    if (kmh > best) {
      c.challenges.trap = kmh;
      const tiers = [260, 290, 315, 330];
      const earned = tiers.filter(t => kmh >= t && best < t).length * 8;
      if (earned) { c.rd += earned; msg += ` · NEW BEST · +${earned} R&D`; }
      saveCareer(c);
    }
    toast(msg, 'pb');
  }
  if (dt2 > 40) hubState.trapped = false;
  if (input.hit('KeyG')) garage();
}

function finishRaceResults() {
  state = 'results';
  const order = session.order.map(e => e.name);
  const myPos = order.indexOf('You') + 1;
  const rows = session.order.map((e, i) => `<div class="${e.isPlayer ? 'me' : career && e.name === career.rival ? 'rv' : ''}"><b>${i + 1}</b><span>${e.isPlayer ? 'You' : e.name}</span><em>${e.stops || 0} stop${e.stops === 1 ? '' : 's'} · best ${fmt(e.best)}${i < 10 ? ' · ' + POINTS[i] + ' pts' : ''}</em></div>`).join('');
  if (weekend?.career) {
    const res = applyRace(career, weekend.track, order, { quali: weekend.grid.indexOf('You') + 1, incidents: player.incidents || {} });
    saveCareer(career);
    const rivalLine = res.rivalPos ? (res.beatRival ? `You beat your rival ${res.rival} (P${res.rivalPos}). +12 R&D bonus.` : `${res.rival} finished ahead (P${res.rivalPos}).`) : '';
    dialog(`P${myPos} · ${TRACK_DEFS[weekend.track].name}`, `<p class="note"><span class="pill">+${res.points} pts</span><span class="pill">+${res.rd} R&D</span> ${rivalLine}${res.newRival !== res.rival ? `<br>New rival: <b>${res.newRival}</b>.` : ''}${res.seasonOver ? '<br><b>Season complete!</b>' : ''}</p><div class="tbl">${rows}</div>`,
      [{ label: 'Garage', key: 'G', fn: () => garage(() => goHub()) }, { label: 'Continue to the coast road', primary: true, key: 'C', fn: goHub }]);
  } else {
    dialog(`Finished P${myPos}`, `<div class="tbl">${rows}</div>`, [{ label: 'Restart', primary: true, key: 'R', fn: () => newSession() }, { label: 'Menu', key: 'M', fn: toMenu }]);
  }
}

function resetCar() {
  const tr = session.track, c = player.car;
  const pr = tr.project(c.x, c.z, player.hint);
  const p = tr.pointAt(pr.s, Math.max(-3, Math.min(3, pr.lat * 0.3)));
  const temps = c.wheels.map(w => w.temp), wear = c.wheels.map(w => w.wear);
  c.reset(p.x, p.z, p.yaw, 0);
  c.wheels.forEach((w, k) => { w.temp = temps[k]; w.wear = wear[k]; });
  player.invalid = true;
  toast('Car reset · lap invalidated');
}

// ---------- HUD ----------
const fmt = (t) => { if (!isFinite(t)) return '--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
let toastTimer = 0;
function toast(text, cls = '') { const t = $('toast'); t.textContent = text; t.className = cls; t.style.opacity = 1; toastTimer = 2.5; }
const minimap = { map: null };
function tempColor(T, comp) {
  const d = (T - comp.optT) / comp.window;
  if (d < -0.6) return '#4aa3ff'; if (d < -0.25) return '#7fd6ff'; if (d < 0.35) return '#3fd17a'; if (d < 0.8) return '#f2c94c'; return '#ff3b2f';
}
let hudTick = 0;
function updateHUD(dt) {
  const c = player.car, s = session;
  $('speed').firstChild.nodeValue = Math.round(c.speed * 3.6);
  $('gear').textContent = c.reverse ? 'R' : c.gear;
  const rp = Math.min(1, c.rpm / c.spec.redline);
  $('rpmfill').style.width = (rp * 100) + '%';
  const lights = $('shift').children; const lit = Math.max(0, Math.floor((rp - 0.82) / 0.16 * 9));
  for (let i = 0; i < 9; i++) lights[i].style.background = i < lit ? (i < 3 ? '#3fd17a' : i < 6 ? '#ff3b2f' : '#6a8cff') : '';
  $('fTC').className = c.assists.tc ? (c.tcActive > 0.02 ? 'on' : '') : ''; $('fTC').style.opacity = c.assists.tc ? 1 : 0.35;
  $('fABS').className = c.assists.abs ? (c.absActive ? 'on' : '') : ''; $('fABS').style.opacity = c.assists.abs ? 1 : 0.35;
  $('fSTB').style.opacity = c.assists.stability > 0 ? 1 : 0.35; $('fGB').textContent = c.assists.autoGear ? 'AUTO' : 'MAN';
  // timing
  const lapT = player.lap > 0 && s.state === 'running' ? s.time - player.lapStart : 0;
  $('cur').textContent = fmt(lapT); $('cur').style.opacity = player.invalid ? 0.5 : 1;
  const lastLap = player.laps.at(-1);
  $('last').textContent = lastLap ? fmt(lastLap.time) + (lastLap.valid ? '' : ' ✕') : '--';
  $('best').textContent = fmt(player.best); $('best').className = 'pb';
  if (bestTrace && player.lap > 0) {
    const tr = s.track, L = tr.length, startS = L * (tr.def.start ?? 0);
    const rel = ((player.s - startS) % L + L) % L;
    const bin = Math.floor(rel / 10);
    if (bestTrace[bin] != null) { const d = lapT - bestTrace[bin]; $('delta').textContent = (d >= 0 ? '+' : '') + d.toFixed(2); $('delta').className = d < 0 ? 'neg' : 'pos'; }
  } else $('delta').textContent = '';
  // position & laps
  $('pos').innerHTML = `P${player.pos}<small>/${s.entries.length}</small>`;
  $('lapc').textContent = s.mode === 'race' ? `LAP ${Math.max(1, Math.min(player.lap, s.totalLaps))} / ${s.totalLaps}` : `LAP ${Math.max(1, player.lap)}`;
  // tyres
  if ((hudTick += dt) > 0.12) {
    hudTick = 0;
    const comp = COMPOUNDS[c.compound];
    $('tyres').innerHTML = c.wheels.map(w => `<div class="t" style="background:${tempColor(w.temp, comp)}">${Math.round(w.temp)}°<span style="font-weight:600;font-size:10px">${Math.round((1 - w.wear) * 100)}%</span></div>`).join('') +
      `<div class="lbl">${comp.name.toUpperCase()} · FUEL ${c.fuel.toFixed(1)}kg</div>`;
    if (s.mode === 'race') {
      const leader = s.order[0];
      $('board').innerHTML = s.order.map((e, i) => {
        const col = e.isPlayer ? '#ff3b2f' : '#' + e.persona.color.toString(16).padStart(6, '0');
        let gap = '';
        if (i > 0) { const dp = leader.totalProgress - e.totalProgress; gap = e.finished ? 'FIN' : '+' + (dp / Math.max(20, leader.car.speed)).toFixed(1); }
        return `<div class="${e.isPlayer ? 'me' : ''}"><b>${i + 1}</b><i style="background:${col}"></i><span>${e.isPlayer ? 'YOU' : e.name.split(' ').at(-1).toUpperCase()}</span><em>${gap}</em></div>`;
      }).join('');
    }
  }
  // pit & weather panels
  const pb = $('pitbox');
  if (s.mode === 'race') {
    pb.style.display = 'block';
    pb.innerHTML = player.pit ? `PIT · ${player.pit.state === 'stopped' ? 'SERVICE ' + Math.max(0, player.pit.timer).toFixed(1) + 's' : 'LIMITER 80'}`
      : player.pitRequest ? `<b style="color:var(--warn)">BOX THIS LAP</b> · ${COMPOUNDS[player.pitRequest].name} · P cancel`
      : `Next tyre ${COMPOUNDS[player.nextCompound].name} (1-4) · P to box`;
  } else pb.style.display = 'none';
  const wx = $('wxbox');
  if (s.env.wet > 0.02 || s.weatherMode === 'dynamic') { wx.style.display = 'block'; wx.textContent = s.env.wet > 0.02 ? `RAIN · track ${Math.round(s.env.wet / 0.8 * 100)}% wet` : 'DRY · rain possible'; }
  else wx.style.display = 'none';
  if (plan.kind === 'quali') $('lapc').textContent = player.lap < 1 ? 'QUALI · OUT LAP' : `QUALI · FLYING LAP ${Math.min(player.lap, plan.qualiLaps - 1)}/${plan.qualiLaps - 1}`;
  drawMinimap();
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').style.opacity = 0;
}

function drawMinimap() {
  const cv = $('minimap'), g = cv.getContext('2d');
  if (!minimap.map) {
    const off = document.createElement('canvas'); off.width = off.height = 400;
    minimap.map = drawTrackPreview(off, session.track, 400, 400, 'rgba(255,255,255,0.85)', 7);
    minimap.bg = off;
  }
  g.clearRect(0, 0, 400, 400); g.drawImage(minimap.bg, 0, 0);
  for (const e of session.entries) {
    const [x, y] = minimap.map(e.car.x, e.car.z);
    g.fillStyle = e.isPlayer ? '#ff3b2f' : '#' + e.persona.color.toString(16).padStart(6, '0');
    g.beginPath(); g.arc(x, y, e.isPlayer ? 9 : 6, 0, 7); g.fill();
    if (e.isPlayer) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
  }
}

// ---------- overlay ----------
function pause(on) {
  if (state === 'results' || state === 'dialog') return;
  if (on) {
    state = 'paused';
    dialog('Paused', '', [{ label: 'Resume', primary: true, fn: () => pause(false) }, { label: 'Restart', key: 'R', fn: () => newSession() }, ...(plan.kind === 'hub' || weekend?.career ? [{ label: 'Garage', key: 'G', fn: () => garage() }] : []), { label: 'Menu', key: 'M', fn: toMenu }]);
  } else { state = 'playing'; $('overlay').style.display = 'none'; }
  audio.mute(on);
}
function toMenu() { state = 'menu'; weekend = null; $('overlay').style.display = 'none'; $('hud').style.display = 'none'; $('menu').style.display = 'block'; audio.mute(true); renderCareerCard(); }

function renderCareerCard() {
  const el = $('careerCard');
  if (career) {
    const st = sortedStandings(career), me = st.findIndex(([n]) => n === 'You') + 1;
    const next = career.calendar[career.round];
    el.innerHTML = `<div><h3 class="cond">Career · Season ${career.season}</h3><p>${career.team} · P${me} in the standings (${career.standings.You} pts) · ${career.rd} R&D · Rival: ${career.rival}<br>${next ? `Next: Round ${career.round + 1}, ${TRACK_DEFS[next].name}` : 'Season complete'}</p></div><button id="cCont">CONTINUE CAREER</button><button class="sec" id="cNew">New career</button>`;
    $('cCont').onclick = () => { audio.start(); startCareer(false); };
    $('cNew').onclick = () => { audio.start(); startCareer(true); };
  } else {
    el.innerHTML = `<div><h3 class="cond">Career</h3><p>Join Velocity Works, the new team on the grid. Six rounds, a rival who remembers you, and a car you develop. Drive the coast road between venues.</p></div><button id="cNew">START CAREER</button>`;
    $('cNew').onclick = () => { audio.start(); startCareer(true); };
  }
}

// ---------- camera ----------
const tmpV = new THREE.Vector3(), lookV = new THREE.Vector3();
function updateCamera(dt) {
  const c = player.car, y = c.y || 0;
  const mode = CAMS[camMode];
  const fwdYaw = c.yaw;
  // camera yaw lags the car so slides read clearly; follows velocity direction a little
  const velYaw = c.speed > 3 ? Math.atan2(c.vx, c.vz) : fwdYaw;
  let target = fwdYaw + Math.atan2(Math.sin(velYaw - fwdYaw), Math.cos(velYaw - fwdYaw)) * 0.35;
  let d = Math.atan2(Math.sin(target - cam.yaw), Math.cos(target - cam.yaw));
  cam.yaw += d * Math.min(1, dt * (mode === 'chase' || mode === 'far' ? 6 : 30));
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  const speed = c.speed;
  let fov = 60 + Math.min(18, speed * 0.17);
  if (mode === 'chase' || mode === 'far') {
    const dist = mode === 'far' ? 9.5 : 5.6, hgt = mode === 'far' ? 3.0 : 1.75;
    const back = dist + speed * 0.012;
    tmpV.set(c.x - sy * back, y + hgt, c.z - cy * back);
    cam.pos.lerp(tmpV, Math.min(1, dt * 12));
    camera.position.copy(cam.pos);
    lookV.set(c.x + sy * 8, y + 1.0, c.z + cy * 8);
  } else {
    const fwd = mode === 'cockpit' ? 0.0 : 1.2, h = mode === 'cockpit' ? 0.98 : 0.62;
    camera.position.set(c.x + Math.sin(c.yaw) * fwd, y + h, c.z + Math.cos(c.yaw) * fwd);
    lookV.set(c.x + Math.sin(c.yaw) * 30, y + h - 0.6 + c.pitch * 8, c.z + Math.cos(c.yaw) * 30);
    fov += 6;
  }
  // shake from speed, kerbs and grass
  const onKerb = c.wheels.some(w => w.surface === 'kerb'), off = c.offTrack > 0;
  const sh = (speed > 60 ? (speed - 60) * 0.0008 : 0) + (onKerb ? 0.02 : 0) + (off ? 0.03 : 0) + cam.shake;
  cam.shake *= Math.max(0, 1 - dt * 5);
  camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh;
  camera.lookAt(lookV);
  camera.rotation.z += -c.ay * 0.0012 * (mode === 'cockpit' ? 2 : 1);
  cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
  camera.fov = cam.fov; camera.updateProjectionMatrix();
  // player mesh hidden in cockpit cam except wheels? keep visible for halo framing
  return onKerb;
}

// ---------- FX per frame ----------
const proj = new THREE.Vector3();
function updateFX(dt) {
  const wet = session.env.wet;
  for (const e of session.entries) {
    const c = e.car, y = c.y || 0;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    c.wheels.forEach((w, k) => {
      const wx = c.x + w.px * cy + w.pz * sy, wz = c.z - w.px * sy + w.pz * cy;
      const intensity = w.surface === 'asphalt' || w.surface === 'kerb' ? Math.max(0, w.slide - 0.5) * 1.6 + (w.lock > 0 ? 0.8 : 0) + (w.spin > 0.3 ? 0.6 : 0) : 0;
      skids.add(e.name + k, wx, y + 0.07, wz, sy, cy, w.front ? 0.3 : 0.38, wet ? 0 : intensity);
      const vs = 1 / 60;
      if (intensity > 0.35 && c.speed > 4 && Math.random() < intensity * 0.8 && !wet) {
        smoke.emit(wx, y + 0.3, wz, c.vx * 0.3 + (Math.random() - 0.5) * 2, 0.6 + Math.random(), c.vz * 0.3 + (Math.random() - 0.5) * 2, 1.6 + Math.random() * 1.4, 1.2, 4.5, 0.85, 0.85, 0.88, 0.35, 1.2, -0.3);
      }
      if (w.surface === 'grass' && c.speed > 6 && Math.random() < 0.6) {
        smoke.emit(wx, y + 0.2, wz, -c.vx * 0.05 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, -c.vz * 0.05 + (Math.random() - 0.5) * 3, 0.9, 0.7, 2.5, 0.42, 0.34, 0.22, 0.55, 1.5, 4);
      }
      if (wet && !w.front && c.speed > 15 && Math.random() < 0.9) {
        smoke.emit(wx - sy * 0.6, y + 0.4, wz - cy * 0.6, c.vx * 0.55 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.2, c.vz * 0.55 + (Math.random() - 0.5) * 2, 0.9 + Math.random() * 0.6, 1.5, 6 + c.speed * 0.08, 0.82, 0.86, 0.9, 0.22 * Math.min(1, c.speed / 50), 1.8, 1);
      }
    });
    // floor sparks: plank scraping at very high speed / bumps (downforce squash)
    if (c.speed > 62 && Math.random() < (c.speed - 62) * 0.012) {
      const n = 3 + (Math.random() * 6 | 0);
      for (let i = 0; i < n; i++) sparks.emit(c.x - sy * 1.6, y + 0.05, c.z - cy * 1.6, c.vx * 0.75 + (Math.random() - 0.5) * 5, 1 + Math.random() * 2.5, c.vz * 0.75 + (Math.random() - 0.5) * 5, 0.25 + Math.random() * 0.25, 0.12, -0.1, 1, 0.65, 0.25, 1, 0.5, 14);
    }
    const m = meshes.get(e);
    if (m) { syncCar(m, c, y, dt); m.userData.rainLight.emissiveIntensity = wet ? 4 : 0; }
  }
  // impacts
  for (const ev of session.events) {
    if (ev.type === 'impact') {
      const y = ev.entry.car.y || 0;
      for (let i = 0; i < Math.min(40, ev.power * 4); i++) sparks.emit(ev.x, y + 0.4, ev.z, (Math.random() - 0.5) * 10, Math.random() * 5, (Math.random() - 0.5) * 10, 0.3 + Math.random() * 0.4, 0.14, -0.1, 1, 0.7, 0.3, 1, 1, 12);
      if (ev.entry === player || ev.other === player) {
        audio.impact(ev.power); cam.shake = Math.min(0.6, ev.power * 0.04);
        const other = ev.entry === player ? ev.other : ev.entry;
        if (other && ev.power > 2.5 && session.mode === 'race') {
          player.incidents = player.incidents || {};
          const t = session.time; if (!player._lastInc || t - player._lastInc > 3) { player.incidents[other.name] = (player.incidents[other.name] || 0) + 1; player._lastInc = t; }
          if (career && other.name === career.rival) toast(`Contact with your rival ${other.name}!`);
        }
      }
    }
    if (ev.type === 'lap' && ev.entry === player) {
      const pb = ev.valid && ev.time <= player.best + 1e-6;
      toast(`${ev.valid ? 'Lap' : 'Invalid lap'} ${fmt(ev.time)}${pb ? ' · PERSONAL BEST' : ''}`, pb ? 'pb' : '');
      if (pb) bestTrace = curTrace;
      curTrace = [];
    }
    if (ev.type === 'finish' && ev.entry === player) setTimeout(finishRaceResults, 2500);
    if (ev.type === 'pitDone' && ev.entry === player) toast(`Pit stop done · ${COMPOUNDS[ev.compound].name}s fitted`);
    if (ev.type === 'pitIn' && ev.entry === player) toast('Pit lane · limiter on');
    if (ev.type === 'weather') toast(ev.wet > 0 ? 'Radio: rain is falling. Box for intermediates? (4 then P)' : 'Radio: track is drying. Slicks soon. (1-3 then P)');
    if (ev.type === 'pitDone' && meshes.get(ev.entry)) { const m = meshes.get(ev.entry); m.traverse(o => { if (o.material?.emissive && o.geometry?.type === 'TorusGeometry') { o.material.color.set(COMPOUNDS[ev.compound].color); o.material.emissive.set(COMPOUNDS[ev.compound].color); } }); }
    if (ev.type === 'go') { $('msg').textContent = 'GO!'; setTimeout(() => { if ($('msg').textContent === 'GO!') $('msg').textContent = ''; }, 900); }
  }
  session.events.length = 0;
  smoke.update(dt); sparks.update(dt);
  // heat haze behind nearby cars' exhausts
  const hz = post.final.uniforms.haze.value; let k = 0;
  const camFwd = new THREE.Vector3(); camera.getWorldDirection(camFwd);
  const near = session.entries.map(e => ({ e, d: Math.hypot(e.car.x - camera.position.x, e.car.z - camera.position.z) })).sort((a, b) => a.d - b.d);
  for (const { e, d } of near) {
    if (k >= 4) break;
    if (d > 45 || (e === player && CAMS[camMode] !== 'chase' && CAMS[camMode] !== 'far')) continue;
    const c = e.car;
    proj.set(c.x - Math.sin(c.yaw) * 2.5, (c.y || 0) + 0.5, c.z - Math.cos(c.yaw) * 2.5);
    if (proj.clone().sub(camera.position).dot(camFwd) < 1) continue;
    proj.project(camera);
    hz[k++].set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5, (0.35 + c.throttle * 0.65) * Math.max(0, 1 - d / 45));
  }
  for (; k < 4; k++) hz[k].z = 0;
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  tick(dt, now);
  if (world || state !== 'menu') post.composer.render(dt);
  else renderer.clear();
}
function tick(dt, now) {
  if (state === 'playing' || state === 'results') {
    input.speed = player ? player.car.speed : 0;
    const inp = input.update(dt);
    if (input.hit('Escape')) pause(true);
    if (input.hit('KeyR')) { newSession(); return; }
    if (input.hit('KeyC')) camMode = (camMode + 1) % CAMS.length;
    if (input.hit('Backspace')) resetCar();
    if (input.hit('KeyT')) { player.car.assists.tc = !player.car.assists.tc; toast('Traction control ' + (player.car.assists.tc ? 'ON' : 'OFF')); }
    if (input.hit('KeyY')) { player.car.assists.abs = !player.car.assists.abs; toast('ABS ' + (player.car.assists.abs ? 'ON' : 'OFF')); }
    if (input.hit('KeyL')) {
      const order = ['full', 'corners', 'off'];
      const cur = lineMode ?? ASSISTS[cfg.assist].line;
      lineMode = order[(order.indexOf(cur) + 1) % 3];
      toast('Racing line: ' + { full: 'full', corners: 'corners only', off: 'off' }[lineMode]);
    }
    // pit wall controls (race): 1-4 choose tyre, P to box / cancel
    if (session.mode === 'race') {
      const keys = { Digit1: 'soft', Digit2: 'medium', Digit3: 'hard', Digit4: 'inter' };
      for (const [k, c] of Object.entries(keys)) if (input.hit(k)) { player.nextCompound = c; if (player.pitRequest) player.pitRequest = c; toast(`Next tyre: ${COMPOUNDS[c].name}`); }
      if (input.hit('KeyP')) {
        if (player.pitRequest) { session.cancelPit(player); toast('Pit stop cancelled'); }
        else if (!player.pit) { session.requestPit(player, player.nextCompound); toast(`Box this lap · ${COMPOUNDS[player.nextCompound].name}s`); }
      }
    }
    if (plan.kind === 'quali' && (player.laps.length >= plan.qualiLaps - 1 || input.hit('Enter', 'NumpadEnter'))) { endQuali(); return; }
    if (plan.kind === 'hub') { updateHub(); if (state !== 'playing') return; }
    let pIn = inp;
    if (autopilot) { driveAssist.level = 'full'; pIn = { steer: 0, throttle: 1, brake: 0 }; }
    pIn = driveAssist.apply(dt, pIn, session.entries.map(e => ({ car: e.car, s: e.s, hint: e.hint })), session.state === 'running');
    if (state === 'results' || player.finished) pIn = { throttle: 0, brake: 0.4, steer: 0 };
    session.update(dt, pIn);
    // countdown lights
    if (session.state === 'countdown') {
      const n = Math.min(5, Math.floor((4.2 - session.countdown) / 0.7));
      world.setStartLights(n); $('msg').textContent = '';
    } else world.setStartLights(0);
    // lap trace for live delta
    if (player.lap > 0) {
      const tr = session.track, L = tr.length, startS = L * (tr.def.start ?? 0);
      const rel = ((player.s - startS) % L + L) % L, bin = Math.floor(rel / 10);
      if (curTrace[bin] == null) curTrace[bin] = session.time - player.lapStart;
    }
    raceLine.update(player.s, player.car.speed, lineMode ?? ASSISTS[cfg.assist].line);
    const kerb = updateCamera(dt);
    updateFX(dt);
    updateHUD(dt);
    audio.update(player.car, kerb);
    world.follow(new THREE.Vector3(player.car.x, player.car.y || 0, player.car.z));
    world.update(dt, camera.position);
    world.setWet(session.env.wet);
    if (session.env.wet > 0.05) {
      // rain around the camera
      const n = Math.round(session.env.wet * 260 * dt * 10);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, r = 2 + Math.random() * 30;
        smoke.emit(camera.position.x + Math.cos(a) * r + player.car.vx * 0.4, camera.position.y + 6 + Math.random() * 8, camera.position.z + Math.sin(a) * r + player.car.vz * 0.4,
          0, -22, 0, 0.7, 0.05, 0, 0.75, 0.8, 0.88, 0.5, 0, 0);
      }
    }
    post.final.uniforms.speed.value = Math.max(0, (player.car.speed - 30) / 60);
    post.final.uniforms.rain.value = session.env.wet && (CAMS[camMode] === 'cockpit' || CAMS[camMode] === 'nose') ? 1 : 0;
  } else if (state === 'paused' || state === 'dialog') {
    input.update(dt);
    if (state === 'paused' && input.hit('Escape')) pause(false);
    for (const [k, fn] of Object.entries(dialog.keys || {})) if (input.hit(k)) { $('overlay').style.display = 'none'; fn(); break; }
  } else if (state === 'menu' && world) {
    // slow orbit behind the menu
    const t = now / 1000 * 0.05, tr = getTrack(cfg.track);
    camera.position.set(Math.sin(t) * 300, 120, Math.cos(t) * 300);
    camera.lookAt(tr.x[0], 0, tr.z[0]);
  }
  if (state === 'results') for (const [k, fn] of Object.entries(dialog.keys || {})) if (input.hit(k)) { $('overlay').style.display = 'none'; fn(); break; }
  post.final.uniforms.time.value = now / 1000;
  post.final.uniforms.aspect.value = innerWidth / innerHeight;
  input.endFrame();
}

buildMenu();
requestAnimationFrame(frame);
renderCareerCard();
if (params.has('autostart')) { $('menu').style.display = 'none'; if (params.get('mode') === 'career') startCareer(params.has('fresh')); else startSession(); }
// test hook: advance the game N seconds without rendering (headless playtests)
const advance = (secs) => { let t0 = performance.now(); for (let t = 0; t < secs; t += 1 / 60) { t0 += 1000 / 60; tick(1 / 60, t0); } last = performance.now(); };
window.__game = { get session() { return session; }, get player() { return player; }, get state() { return state; }, get plan() { return plan; }, cfg, setCam: (i) => camMode = i, advance, endQuali: () => endQuali(), startWeekendRace: (c) => startWeekendRace(c), startWeekend: (t) => startWeekend(t, true) };
