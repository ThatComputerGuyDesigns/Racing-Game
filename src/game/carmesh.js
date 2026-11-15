// Procedural open-wheel car: lofted superellipse body sections, clearcoat paint,
// glass aeroscreen, carbon aero parts, rotating/steering wheels.
import * as THREE from 'three';

function loft(sections, segs = 20, xOff = 0) {
  // sections: [z, width, height, yCenter, exponent]; uv: u around (0.25 = top), v along
  const pos = [], idx = [], uv = [];
  let si = 0;
  for (const [z, w, h, y, e = 2.6] of sections) {
    const vv = si++ / (sections.length - 1);
    for (let k = 0; k < segs; k++) {
      uv.push(k / segs, vv);
      const a = (k / segs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * w / 2;
      const py = Math.sign(s) * Math.pow(Math.abs(s), 2 / e) * h / 2;
      pos.push(px + xOff, py + y, z);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < segs; k++) {
    const a = i * segs + k, b = i * segs + (k + 1) % segs, c = a + segs, d = b + segs;
    idx.push(a, c, b, b, c, d);
  }
  // caps
  const capA = pos.length / 3; const f = sections[0]; pos.push(xOff, f[3], f[0]); uv.push(0.25, 0);
  const capB = capA + 1; const l = sections.at(-1); pos.push(xOff, l[3], l[0]); uv.push(0.25, 1);
  const last = (sections.length - 1) * segs;
  for (let k = 0; k < segs; k++) { idx.push(capA, k, (k + 1) % segs); idx.push(capB, last + (k + 1) % segs, last + k); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }
/** Livery: base colour, accent centre stripe + pinstripes, race numbers and sponsor on the sides. */
function liveryTexture(color, accent, number, sponsor) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = hex(color); g.fillRect(0, 0, 1024, 512);
  // top centre stripe (u = 0.25) running the length of the car
  g.fillStyle = hex(accent); g.fillRect(1024 * 0.215, 0, 1024 * 0.07, 512);
  g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(1024 * 0.205, 0, 8, 512); g.fillRect(1024 * 0.295 - 8, 0, 8, 512);
  // dark lower half (underside / carbon look), gentle gradient line
  const grd = g.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0.55, 'rgba(10,10,12,0)'); grd.addColorStop(0.62, 'rgba(10,10,12,0.9)'); grd.addColorStop(0.88, 'rgba(10,10,12,0.9)'); grd.addColorStop(0.95, 'rgba(10,10,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  // numbers on both flanks (u ~ 0.0 and 0.5) near the cockpit (v ~ 0.45)
  for (const u of [0.02, 0.48]) {
    g.save(); g.translate(1024 * u, 512 * 0.42); g.rotate(Math.PI / 2);
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, -18, 46, 34, 0, 0, 7); g.fill();
    g.fillStyle = '#111'; g.font = 'italic 900 52px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(number, 0, -16);
    g.restore();
  }
  // sponsor along the flanks of the engine cover
  for (const u of [0.06, 0.44]) {
    g.save(); g.translate(1024 * u, 512 * 0.72); g.rotate(Math.PI / 2);
    g.fillStyle = hex(accent); g.font = 'italic 800 40px Arial'; g.textAlign = 'center'; g.fillText(sponsor, 0, 0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

let carbonTex = null;
function carbon() {
  if (carbonTex) return carbonTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#1b1c1f' : '#2a2b30'; g.fillRect(x * 8, y * 8, 8, 8); }
  carbonTex = new THREE.CanvasTexture(c); carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping; carbonTex.repeat.set(6, 6);
  carbonTex.colorSpace = THREE.SRGBColorSpace;
  return carbonTex;
}

export function buildCar(color = 0x1f6feb, accent = 0xffffff, compoundColor = '#f2c94c', number = '7', sponsor = 'VELOCITY') {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ map: liveryTexture(color, accent, number, sponsor), metalness: 0.1, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.14, envMapIntensity: 0.45 });
  const plain = new THREE.MeshPhysicalMaterial({ color, metalness: 0.1, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.14, envMapIntensity: 0.45 });
  const paint2 = new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 });
  const carb = new THREE.MeshPhysicalMaterial({ map: carbon(), metalness: 0.2, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x223344, metalness: 0, roughness: 0.02, transmission: 0.85, thickness: 0.02, transparent: true, opacity: 0.55, ior: 1.5, envMapIntensity: 1.5 });
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; car.add(m); return m; };

  // monocoque + nose + engine cover
  add(loft([
    [2.85, 0.14, 0.10, 0.26], [2.55, 0.26, 0.18, 0.29], [2.0, 0.36, 0.28, 0.34], [1.4, 0.48, 0.40, 0.40],
    [0.85, 0.66, 0.52, 0.46], [0.35, 0.80, 0.56, 0.48], [-0.25, 0.86, 0.62, 0.50], [-0.9, 0.70, 0.62, 0.55],
    [-1.5, 0.46, 0.50, 0.52], [-2.05, 0.26, 0.32, 0.46], [-2.35, 0.12, 0.14, 0.40],
  ]), paint);
  // airbox / roll hoop
  add(loft([[0.05, 0.22, 0.2, 0.86], [-0.25, 0.30, 0.34, 0.9], [-0.8, 0.18, 0.3, 0.86], [-1.6, 0.06, 0.12, 0.72]], 16), paint2);
  // sidepods
  for (const s of [1, -1]) {
    add(loft([[0.55, 0.06, 0.3, 0.36, 3], [0.3, 0.5, 0.42, 0.38, 3.2], [-0.4, 0.5, 0.40, 0.37, 3], [-1.1, 0.34, 0.28, 0.32, 2.6], [-1.6, 0.12, 0.14, 0.28]], 16, s * 0.62), plain);
    // radiator inlet (dark) and bargeboard
    add(new THREE.BoxGeometry(0.36, 0.26, 0.04).translate(s * 0.62, 0.4, 0.47), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 }));
    add(new THREE.BoxGeometry(0.02, 0.22, 0.6).translate(s * 0.82, 0.22, 0.9), carb);
  }
  // floor
  add(new THREE.BoxGeometry(1.55, 0.04, 3.2).translate(0, 0.08, -0.3), carb);
  // front wing
  add(new THREE.BoxGeometry(1.9, 0.035, 0.42).translate(0, 0.11, 2.62), carb);
  add(new THREE.BoxGeometry(1.75, 0.025, 0.22).translate(0, 0.17, 2.52).rotateX(0), paint2);
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.03, 0.22, 0.55).translate(s * 0.95, 0.18, 2.6), carb);
  // rear wing + endplates + pylon
  add(new THREE.BoxGeometry(1.05, 0.04, 0.34).translate(0, 0.92, -2.35), plain);
  add(new THREE.BoxGeometry(1.05, 0.03, 0.18).translate(0, 1.02, -2.45), paint2);
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.03, 0.55, 0.62).translate(s * 0.53, 0.78, -2.35), carb);
  add(new THREE.BoxGeometry(0.06, 0.45, 0.2).translate(0, 0.66, -2.25), carb);
  // diffuser
  add(new THREE.BoxGeometry(1.0, 0.25, 0.4).translate(0, 0.18, -2.15), carb);
  // halo + aeroscreen glass
  const halo = new THREE.TorusGeometry(0.42, 0.035, 8, 24, Math.PI);
  const hm = add(halo, carb); hm.rotation.x = -Math.PI / 2 + 0.12; hm.position.set(0, 0.78, 0.1);
  add(new THREE.BoxGeometry(0.06, 0.32, 0.06).translate(0, 0.66, 0.55).rotateX(0), carb);
  const screen = new THREE.CylinderGeometry(0.45, 0.45, 0.32, 24, 1, true, -Math.PI / 2.4, Math.PI / 1.2);
  const sm = add(screen, glass, false); sm.rotation.set(0.25, 0, 0); sm.position.set(0, 0.84, 0.14);
  // driver helmet
  const helmet = add(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshPhysicalMaterial({ color: accent, clearcoat: 1, roughness: 0.2, metalness: 0.3 }));
  helmet.position.set(0, 0.78, -0.12);
  const visor = add(new THREE.SphereGeometry(0.152, 20, 8, -0.9, 1.8, 1.1, 0.45), new THREE.MeshPhysicalMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.05 }));
  visor.position.copy(helmet.position); visor.rotation.y = 0;
  // mirrors
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.16, 0.08, 0.04).translate(s * 0.5, 0.72, 0.65), plain);
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.25, 12).rotateX(Math.PI / 2).translate(0, 0.52, -2.2), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, metalness: 0.9, roughness: 0.35 }));
  // rain light
  const rain = add(new THREE.BoxGeometry(0.12, 0.06, 0.03).translate(0, 0.32, -2.4), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }), false);
  car.userData.rainLight = rain.material;

  // wheels
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.9, roughness: 0.28 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: compoundColor, roughness: 0.5, emissive: compoundColor, emissiveIntensity: 0.05 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xff4400, emissiveIntensity: 0, metalness: 0.6, roughness: 0.5 });
  const armMat = carb;
  const wheels = [];
  const defs = [[0.8, 1.836, 0.30], [-0.8, 1.836, 0.30], [0.78, -1.564, 0.38], [-0.78, -1.564, 0.38]];
  for (const [x, z, w] of defs) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.33, z); car.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const prof = [];
    const R = 0.33, r0 = 0.2;
    for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 + k / 10 * Math.PI; prof.push(new THREE.Vector2(R - 0.03 + Math.cos(a) * 0.03 - (1 - Math.cos(a)) * 0.0, Math.sin(a) * w / 2)); }
    prof.unshift(new THREE.Vector2(r0, -w / 2)); prof.push(new THREE.Vector2(r0, w / 2));
    const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2), tyreMat); tyre.castShadow = true; spin.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, w * 0.92, 18).rotateZ(Math.PI / 2), rimMat); spin.add(rim);
    // spokes so rotation is visible
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(w * 0.95, 0.03, r0 * 1.8), rimMat); sp.rotation.x = k * Math.PI / 5; spin.add(sp); }
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.012, 6, 32).rotateY(Math.PI / 2), stripeMat);
    stripe.position.x = Math.sign(x) * (w / 2 + 0.001); spin.add(stripe);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 16).rotateZ(Math.PI / 2), discMat);
    disc.position.x = -Math.sign(x) * 0.05; pivot.add(disc);
    // wishbones
    for (const dy of [-0.08, 0.1]) {
      const len = Math.abs(x) - 0.25;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 6).rotateZ(Math.PI / 2), armMat);
      arm.position.set(x - Math.sign(x) * (len / 2), 0.33 + dy, z); car.add(arm);
    }
    wheels.push({ pivot, spin });
  }
  car.userData.wheels = wheels;
  car.userData.disc = discMat;
  car.userData.paint = plain;
  return car;
}

/** Sync a car mesh with the physics state. */
export function syncCar(mesh, car, y = 0, dt = 0) {
  mesh.position.set(car.x, y, car.z);
  mesh.rotation.set(0, 0, 0);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = car.yaw;
  mesh.rotation.x = car.pitch + (car.visPitch || 0);
  mesh.rotation.z = car.roll;
  const ws = mesh.userData.wheels;
  for (let k = 0; k < 4; k++) {
    const w = car.wheels[k];
    if (k < 2) ws[k].pivot.rotation.y = car.steerAngle;
    ws[k].spin.rotation.x = w.rot;
  }
  const braking = car.brake * Math.min(1, car.speed / 30);
  mesh.userData.discHeat = (mesh.userData.discHeat || 0) + (braking * 3 - (mesh.userData.discHeat || 0) * 0.6) * dt;
  mesh.userData.disc.emissiveIntensity = Math.min(4, Math.max(0, mesh.userData.discHeat - 0.3) * 3);
}
