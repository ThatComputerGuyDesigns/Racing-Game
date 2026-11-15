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
renderer.toneMappingExposure = 0.85;
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
  autopilot: params.has('autopilot'),
};
const ASSISTS = {
  full:   { abs: true, tc: true, stability: 0.6, steerAssist: 0.7, autoGear: true },
  medium: { abs: true, tc: true, stability: 0.25, steerAssist: 0.5, autoGear: true },
  off:    { abs: false, tc: false, stability: 0, steerAssist: 0.25, autoGear: false },
};

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
  for (const key of ['mode', 'laps', 'weather', 'assist']) {
    const seg = $(key);
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('sel', String(cfg[key]) === b.dataset.v);
      b.onclick = () => { cfg[key] = key === 'laps' ? +b.dataset.v : b.dataset.v; seg.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b)); $('go').textContent = cfg.mode === 'race' ? 'RACE' : 'DRIVE'; };
    });
  }
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

function showLoading(v) { $('loading').style.display = v ? 'flex' : 'none'; }

function startSession() {
  $('menu').style.display = 'none';
  showLoading(true);
  setTimeout(() => {
    const tr = getTrack(cfg.track);
    const wet = cfg.weather === 'rain' ? 0.8 : 0;
    const key = cfg.track + ':' + cfg.weather;
    if (worldKey !== key) {
      world?.dispose();
      world = new World(renderer, scene, tr, { wet, sunElev: wet ? 20 : 34, sunAz: 150 });
      worldKey = key;
      minimap.map = null;
    }
    newSession();
    showLoading(false);
  }, 30);
}

function newSession() {
  for (const m of meshes.values()) scene.remove(m);
  meshes.clear(); smoke.clear(); sparks.clear(); skids.clear();
  const tr = getTrack(cfg.track);
  const wet = cfg.weather === 'rain' ? 0.8 : 0;
  session = new Session(tr, { mode: cfg.mode, laps: cfg.laps });
  session.env.wet = wet; session.env.temp = wet ? 14 : 24;
  const compound = wet ? 'inter' : 'medium';
  if (cfg.mode === 'race') {
    const field = PERSONALITIES.slice(0, 11);
    // qualifying-order proxy: faster drivers start ahead, player starts mid-pack
    const sorted = [...field].sort((a, b) => b.pace - a.pace);
    let slot = 0;
    sorted.forEach((p, k) => {
      if (k === 7) player = session.addCar({ name: 'You', isPlayer: true, assists: ASSISTS[cfg.assist], compound, gridSlot: slot++, fuel: 30 });
      session.addCar({ name: p.name, persona: p, compound, gridSlot: slot++, seed: 17 + k * 31, fuel: 30 });
    });
    session.startRace();
  } else {
    player = session.addCar({ name: 'You', isPlayer: true, assists: ASSISTS[cfg.assist], compound, gridSlot: 0, fuel: 20 });
  }
  player.car.assists = { ...ASSISTS[cfg.assist] };
  autopilot = cfg.autopilot ? new AIDriver(player.car, tr, session.line, session.profile, { pace: 0.99, consistency: 1, aggression: 0.5, composure: 1, brakeLate: 0.5 }, 3) : null;
  for (const e of session.entries) {
    const color = e.isPlayer ? 0xff3b2f : e.persona.color;
    const accent = e.isPlayer ? 0x111111 : (e.persona.color === 0xffffff ? 0xd7262e : 0xf1f1f1);
    const m = buildCar(color, accent, COMPOUNDS[e.car.compound].color);
    scene.add(m); meshes.set(e, m);
  }
  bestTrace = null; curTrace = [];
  cam.yaw = player.car.yaw; cam.pos.set(player.car.x - Math.sin(cam.yaw) * 8, 3, player.car.z - Math.cos(cam.yaw) * 8);
  $('hud').style.display = 'block'; $('overlay').style.display = 'none';
  $('board').style.display = cfg.mode === 'race' ? 'block' : 'none';
  state = 'playing';
  toast(cfg.mode === 'race' ? `${tr.name} · ${cfg.laps} laps` : `${tr.name} · hot lap`);
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
  if (state === 'results') return;
  state = on ? 'paused' : 'playing';
  $('overlay').style.display = on ? 'flex' : 'none';
  $('ovTitle').textContent = 'Paused'; $('results').innerHTML = ''; $('bResume').style.display = '';
  audio.mute(on);
}
function showResults() {
  state = 'results';
  $('overlay').style.display = 'flex'; $('bResume').style.display = 'none';
  $('ovTitle').textContent = `Finished P${player.pos}`;
  $('results').innerHTML = session.order.map((e, i) => `<div><b>${i + 1}</b><span>${e.isPlayer ? 'You' : e.name}</span><em>${e.persona ? e.persona.team : 'Player'} · best ${fmt(e.best)}</em></div>`).join('');
}
$('bRestart').onclick = () => { $('overlay').style.display = 'none'; audio.mute(false); newSession(); };
$('bResume').onclick = () => pause(false);
$('bMenu').onclick = toMenu;
function toMenu() { state = 'menu'; $('overlay').style.display = 'none'; $('hud').style.display = 'none'; $('menu').style.display = 'block'; audio.mute(true); }

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
    const dist = mode === 'far' ? 10.5 : 7.2, hgt = mode === 'far' ? 3.4 : 2.1;
    const back = dist + speed * 0.012;
    tmpV.set(c.x - sy * back, y + hgt, c.z - cy * back);
    cam.pos.lerp(tmpV, Math.min(1, dt * 12));
    camera.position.copy(cam.pos);
    lookV.set(c.x + sy * 6, y + 0.9, c.z + cy * 6);
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
      if (ev.entry === player || ev.other === player) { audio.impact(ev.power); cam.shake = Math.min(0.6, ev.power * 0.04); }
    }
    if (ev.type === 'lap' && ev.entry === player) {
      const pb = ev.valid && ev.time <= player.best + 1e-6;
      toast(`${ev.valid ? 'Lap' : 'Invalid lap'} ${fmt(ev.time)}${pb ? ' · PERSONAL BEST' : ''}`, pb ? 'pb' : '');
      if (pb) bestTrace = curTrace;
      curTrace = [];
    }
    if (ev.type === 'finish' && ev.entry === player) setTimeout(showResults, 2500);
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
    const inp = input.update(dt);
    if (input.hit('Escape')) pause(true);
    if (input.hit('KeyR')) { newSession(); return; }
    if (input.hit('KeyC')) camMode = (camMode + 1) % CAMS.length;
    if (input.hit('Backspace')) resetCar();
    if (input.hit('KeyT')) { player.car.assists.tc = !player.car.assists.tc; toast('Traction control ' + (player.car.assists.tc ? 'ON' : 'OFF')); }
    if (input.hit('KeyY')) { player.car.assists.abs = !player.car.assists.abs; toast('ABS ' + (player.car.assists.abs ? 'ON' : 'OFF')); }
    let pIn = inp;
    if (autopilot) pIn = autopilot.update(dt, session.entries.map(e => ({ car: e.car, s: e.s, hint: e.hint })), session.env);
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
    const kerb = updateCamera(dt);
    updateFX(dt);
    updateHUD(dt);
    audio.update(player.car, kerb);
    world.follow(new THREE.Vector3(player.car.x, player.car.y || 0, player.car.z));
    post.final.uniforms.speed.value = Math.max(0, (player.car.speed - 30) / 60);
    post.final.uniforms.rain.value = session.env.wet && (CAMS[camMode] === 'cockpit' || CAMS[camMode] === 'nose') ? 1 : 0;
  } else if (state === 'paused') {
    input.update(dt);
    if (input.hit('Escape')) pause(false);
    if (input.hit('KeyR')) { $('overlay').style.display = 'none'; audio.mute(false); newSession(); }
    if (input.hit('KeyM')) toMenu();
  } else if (state === 'menu' && world) {
    // slow orbit behind the menu
    const t = now / 1000 * 0.05, tr = getTrack(cfg.track);
    camera.position.set(Math.sin(t) * 300, 120, Math.cos(t) * 300);
    camera.lookAt(tr.x[0], 0, tr.z[0]);
  }
  if (state === 'results' && input.hit('KeyM')) toMenu();
  post.final.uniforms.time.value = now / 1000;
  post.final.uniforms.aspect.value = innerWidth / innerHeight;
  input.endFrame();
}

buildMenu();
requestAnimationFrame(frame);
if (params.has('autostart')) { $('menu').style.display = 'none'; startSession(); }
// test hook: advance the game N seconds without rendering (headless playtests)
const advance = (secs) => { let t0 = performance.now(); for (let t = 0; t < secs; t += 1 / 60) { t0 += 1000 / 60; tick(1 / 60, t0); } last = performance.now(); };
window.__game = { get session() { return session; }, get player() { return player; }, cfg, setCam: (i) => camMode = i, advance };
