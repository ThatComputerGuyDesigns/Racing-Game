// Procedural canvas textures (no external assets).
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function asphaltTexture(renderer) {
  const [c, g] = canvas(512, 1024);
  const r = rand(7);
  g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, 512, 1024);
  const img = g.getImageData(0, 0, 512, 1024), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 34 + (r() < 0.02 ? 30 : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n + 1;
  }
  g.putImageData(img, 0, 0);
  // racing-line rubber darkening (centre-ish band, varies) + tyre streaks
  const grd = g.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.35, 'rgba(10,10,12,0.25)');
  grd.addColorStop(0.5, 'rgba(10,10,12,0.32)'); grd.addColorStop(0.65, 'rgba(10,10,12,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 1024);
  g.globalAlpha = 0.06;
  for (let i = 0; i < 60; i++) { g.fillStyle = '#000'; g.fillRect(140 + r() * 230, 0, 2 + r() * 5, 1024); }
  g.globalAlpha = 1;
  // white edge lines
  g.fillStyle = '#e8e8e2'; g.fillRect(10, 0, 12, 1024); g.fillRect(490, 0, 12, 1024);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

export function grassTexture(renderer) {
  const [c, g] = canvas(512, 512);
  const r = rand(11);
  g.fillStyle = '#3f6a2a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const x = r() * 512, y = r() * 512, l = 25 + r() * 25;
    g.fillStyle = `hsl(${85 + r() * 30},${35 + r() * 25}%,${l}%)`;
    g.fillRect(x, y, 1.5, 2 + r() * 3);
  }
  // mowing stripes
  g.globalAlpha = 0.07; g.fillStyle = '#fff';
  for (let y = 0; y < 512; y += 128) g.fillRect(0, y, 512, 64);
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

export function kerbTexture() {
  const [c, g] = canvas(64, 256);
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f4f4f0' : '#d42a2a'; g.fillRect(0, i * 64, 64, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function barrierTexture() {
  const [c, g] = canvas(512, 64);
  const ads = ['VELOCITY', 'HALCYON', 'FERROQUIN', 'NORDLYS', 'KAZE', 'LUMEN', 'COBALT', 'AURORE'];
  const cols = ['#1f6feb', '#d7262e', '#2ec4b6', '#f2a33a', '#ffffff', '#c8f031', '#7a3cff', '#ff5fa2'];
  for (let i = 0; i < 4; i++) {
    const k = i * 2 + (Math.random() * 2 | 0);
    g.fillStyle = i % 2 ? '#14161a' : '#f2f2f2'; g.fillRect(i * 128, 0, 128, 64);
    g.fillStyle = i % 2 ? cols[k % 8] : '#14161a';
    g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText(ads[k % 8], i * 128 + 64, 42);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function checkerTexture() {
  const [c, g] = canvas(256, 32);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g.fillRect(x * 16, y * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function crowdTexture() {
  const [c, g] = canvas(256, 128);
  const r = rand(5);
  g.fillStyle = '#222'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `hsl(${r() * 360},${40 + r() * 50}%,${35 + r() * 40}%)`; g.fillRect(r() * 256, r() * 128, 2, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function softDot() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
