// Builds the 3D environment for a track: sky, lighting, terrain, road, kerbs,
// barriers, bridges, trees, grandstands, start gantry.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import * as TX from './textures.js';

function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { let s = 0, a = 1, f = 1; for (let i = 0; i < 4; i++) { s += a * (vnoise(x * f, z * f) - 0.5); a *= 0.5; f *= 2.1; } return s; }

export class World {
  constructor(renderer, scene, track, weather) {
    this.renderer = renderer; this.scene = scene; this.track = track;
    this.group = new THREE.Group(); scene.add(this.group);
    this.weather = weather;
    this._sky();
    this._terrain();
    this._road();
    this._scenery();
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  // ---------- sky & lights ----------
  _sky() {
    const sky = new Sky(); sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    const wet = this.weather.wet;
    u.turbidity.value = 2.5 + wet * 12; u.rayleigh.value = 2.4 + wet * 1; u.mieCoefficient.value = 0.003 + wet * 0.02; u.mieDirectionalG.value = 0.85;
    const elev = THREE.MathUtils.degToRad(this.weather.sunElev ?? 32), az = THREE.MathUtils.degToRad(this.weather.sunAz ?? 140);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, az);
    u.sunPosition.value.copy(sunDir);
    this.sunDir = sunDir;
    this.group.add(sky); this.sky = sky;
    // environment map from the sky for reflections on paint / glass / wet road
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.sunPosition.value, sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = u[k].value;
    envScene.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2c3a22 }));
    ground.position.y = -5; envScene.add(ground);
    this.envMap = pm.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 1 - wet * 0.4;
    const fogCol = new THREE.Color(wet > 0.2 ? 0x8d949c : 0x9fb8d6);
    this.scene.fog = new THREE.Fog(fogCol, 700 - wet * 450, 5500 - wet * 4200);

    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2 * (1 - wet * 0.65));
    sun.position.copy(sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 700;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.sun = sun; this.group.add(sun); this.group.add(sun.target);
    const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x40502c, 0.5 + wet * 0.3);
    this.group.add(hemi);
  }

  /** keep the shadow frustum centred on the action */
  follow(pos) {
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(this.sunDir, 300);
  }

  // ---------- terrain ----------
  _nearest(x, z, stride = 3) {
    const t = this.track; let best = 1e18, bi = 0, minH = Infinity;
    for (let i = 0; i < t.n; i += stride) {
      const d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
      if (d < 35 * 35 && t.h[i] < minH) minH = t.h[i];
    }
    return { d: Math.sqrt(best), i: bi, h: minH < Infinity ? minH : t.h[bi] };
  }

  terrainHeight(x, z) {
    const n = this._nearest(x, z);
    const edge = this.track.width / 2 + this.track.runoff;
    const t = THREE.MathUtils.smoothstep(n.d, edge + 4, edge + 160);
    return n.h - 0.25 + t * (fbm(x * 0.004, z * 0.004) * 60 + 6);
  }

  _terrain() {
    const t = this.track;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < t.n; i++) { minx = Math.min(minx, t.x[i]); maxx = Math.max(maxx, t.x[i]); minz = Math.min(minz, t.z[i]); maxz = Math.max(maxz, t.z[i]); }
    const pad = 700;
    this.bounds = { minx: minx - pad, maxx: maxx + pad, minz: minz - pad, maxz: maxz + pad };
    const W = this.bounds.maxx - this.bounds.minx, H = this.bounds.maxz - this.bounds.minz;
    const cell = 9;
    const nx = Math.ceil(W / cell), nz = Math.ceil(H / cell);
    const geo = new THREE.PlaneGeometry(W, H, nx, nz).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cx = (this.bounds.minx + this.bounds.maxx) / 2, cz = (this.bounds.minz + this.bounds.maxz) / 2;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
      pos.setXYZ(i, x, this.terrainHeight(x, z), z);
      uv.setXY(i, x / 18, z / 18);
    }
    geo.computeVertexNormals();
    const tex = TX.grassTexture(this.renderer);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: this.weather.wet > 0.3 ? 0xa8b8a0 : 0xffffff });
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
    this.group.add(mesh);
    // distant ground ring so the horizon isn't empty
    const far = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a5a2a, roughness: 1 }));
    far.position.set(cx, -12, cz); this.group.add(far);
  }

  // ---------- road ----------
  _ribbon(fromLat, toLat, yOff, uvMode, filter = null, vScale = 1) {
    const t = this.track, pos = [], uvs = [], idx = [];
    let v = 0, k = 0;
    const count = t.closed ? t.n + 1 : t.n;
    let prevKept = false;
    for (let j = 0; j < count; j++) {
      const i = j % t.n;
      const keep = !filter || filter(i);
      if (!keep) { prevKept = false; continue; }
      const fl = typeof fromLat === 'function' ? fromLat(i) : fromLat;
      const tl = typeof toLat === 'function' ? toLat(i) : toLat;
      const yo = typeof yOff === 'function' ? yOff(i) : yOff;
      const x1 = t.x[i] + t.nx[i] * fl, z1 = t.z[i] + t.nz[i] * fl;
      const x2 = t.x[i] + t.nx[i] * tl, z2 = t.z[i] + t.nz[i] * tl;
      const y = t.h[i] + yo;
      pos.push(x1, y, z1, x2, y, z2);
      v = j * t.ds * vScale;
      if (uvMode === 'world') uvs.push(x1 / 18, z1 / 18, x2 / 18, z2 / 18); else uvs.push(0, v, 1, v);
      if (prevKept) { const a = k - 2, b = k - 1, c = k, d = k + 1; idx.push(a, c, b, b, c, d); }
      k += 2; prevKept = true;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // ensure normals point up regardless of winding
    const n = g.attributes.normal; let flip = 0; for (let i = 0; i < n.count; i++) flip += n.getY(i);
    if (flip < 0) { for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; } g.setIndex(idx); g.computeVertexNormals(); }
    return g;
  }

  _road() {
    const t = this.track, hw = t.width / 2, wet = this.weather.wet;
    const asphalt = TX.asphaltTexture(this.renderer);
    const roadMat = new THREE.MeshStandardMaterial({
      map: asphalt, roughness: 0.82 - wet * 0.62, metalness: 0.0, color: wet > 0.2 ? 0x9a9a9a : 0xffffff,
      envMapIntensity: 0.6 + wet * 1.6,
    });
    this.roadMat = roadMat;
    const road = new THREE.Mesh(this._ribbon(hw, -hw, 0.06, 'track', null, 1 / 24), roadMat);
    road.receiveShadow = true; this.group.add(road);
    // grass shoulders follow the track elevation and overlap the terrain
    const grassMat = new THREE.MeshStandardMaterial({ map: TX.grassTexture(this.renderer), roughness: 0.95, color: wet > 0.3 ? 0xa8b8a0 : 0xffffff });
    const runoffMat = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.97 });
    for (const sgn of [1, -1]) {
      // gravel/asphalt runoff strip near the edge at corners, grass elsewhere
      const g = new THREE.Mesh(this._ribbon(sgn * hw, sgn * (hw + t.runoff + 0.5), 0.03, 'world'), grassMat);
      g.receiveShadow = true; this.group.add(g);
      const gr = new THREE.Mesh(this._ribbon(sgn * (hw + 1.4), sgn * (hw + 6), 0.04, 'world', (i) => t.kerb[i] && Math.abs(t.curv[i]) > 0.012), runoffMat);
      gr.receiveShadow = true; this.group.add(gr);
      // kerbs
      const kerbMat = new THREE.MeshStandardMaterial({ map: TX.kerbTexture(), roughness: 0.6 - wet * 0.3 });
      const kerb = new THREE.Mesh(this._ribbon(sgn * (hw - 0.4), sgn * (hw + 1.4), 0.085, 'track', (i) => t.kerb[i], 1 / 4), kerbMat);
      kerb.receiveShadow = true; this.group.add(kerb);
    }
    // barriers: vertical ad-board walls with skirts down to hide terrain seams
    const bTex = TX.barrierTexture();
    const bMat = new THREE.MeshStandardMaterial({ map: bTex, roughness: 0.5, side: THREE.DoubleSide });
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x6d6d6a, roughness: 0.9, side: THREE.DoubleSide });
    for (const sgn of [1, -1]) {
      const lat = sgn * (hw + t.runoff);
      this.group.add(this._wall(lat, 0.05, 1.1, bMat, true));
      this.group.add(this._wall(lat, -3.0, 0.05, skirtMat, false));
    }
    // start/finish line
    const sS = t.length * (t.def.start ?? 0);
    const p = t.pointAt(sS);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(t.width, 1.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: TX.checkerTexture(), roughness: 0.7 }));
    line.position.set(p.x, p.h + 0.075, p.z); line.rotation.y = p.yaw; this.group.add(line);
    this._gantry(p);
    this._supports();
  }

  _wall(lat, y0, y1, mat, ads) {
    const t = this.track, pos = [], uvs = [], idx = [];
    for (let j = 0; j <= t.n; j++) {
      const i = j % t.n;
      const x = t.x[i] + t.nx[i] * lat, z = t.z[i] + t.nz[i] * lat, h = t.h[i];
      pos.push(x, h + y0, z, x, h + y1, z);
      const u = j * t.ds / 8; uvs.push(u, 0, u, 1);
      if (j > 0) { const k = j * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = ads; m.receiveShadow = true; return m;
  }

  _supports() {
    // concrete pillars wherever the road floats over lower ground (bridges, embankments)
    const t = this.track, pts = [];
    for (let i = 0; i < t.n; i += 6) {
      for (const sgn of [1, -1]) {
        const lat = sgn * (t.width / 2 + 0.5);
        const x = t.x[i] + t.nx[i] * lat, z = t.z[i] + t.nz[i] * lat;
        const gh = this.terrainHeight(x, z);
        if (t.h[i] - gh > 2.5) pts.push([x, gh, z, t.h[i]]);
      }
    }
    if (!pts.length) return;
    const geo = new THREE.BoxGeometry(1.2, 1, 1.2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x9a9792, roughness: 0.85 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, k) => { const h = p[3] - p[1]; m.makeScale(1, h, 1).setPosition(p[0], p[1] + h / 2, p[2]); mesh.setMatrixAt(k, m); });
    mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    // bridge deck underside slab
    const deck = new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 0.9, side: THREE.DoubleSide });
    const under = this._ribbon(this.track.width / 2 + 1, -this.track.width / 2 - 1, -0.6, 'track', (i) => this.track.h[i] - this.terrainHeight(this.track.x[i], this.track.z[i]) > 2.5);
    this.group.add(new THREE.Mesh(under, deck));
  }

  _gantry(p) {
    const t = this.track, g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35 });
    const span = t.width + 4;
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), steel); post.position.set(s * span / 2, 4, 0); post.castShadow = true; g.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.4, 0.8), steel); beam.position.y = 7.6; beam.castShadow = true; g.add(beam);
    this.lights = [];
    for (let k = 0; k < 5; k++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 });
      for (const side of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat);
        l.position.set((k - 2) * 1.2, 7.6, side * 0.42); g.add(l);
      }
      this.lights.push(mat);
    }
    g.position.set(p.x, p.h, p.z); g.rotation.y = p.yaw;
    this.group.add(g);
  }

  setStartLights(n) { this.lights?.forEach((m, k) => { m.emissiveIntensity = k < n ? 6 : 0; }); }

  // ---------- scenery ----------
  _scenery() {
    const t = this.track, hw = t.width / 2;
    // trees
    const trees = [];
    const R = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const b = this.bounds;
    for (let k = 0; k < 9000 && trees.length < 3200; k++) {
      const x = b.minx + R() * (b.maxx - b.minx), z = b.minz + R() * (b.maxz - b.minz);
      if (fbm(x * 0.01, z * 0.01) < -0.05) continue; // clustered forests
      const n = this._nearest(x, z, 6);
      if (n.d < hw + t.runoff + 10 || n.d > 520) continue;
      trees.push([x, this.terrainHeight(x, z), z, 0.7 + R() * 0.8, R()]);
    }
    const foliageGeo = new THREE.ConeGeometry(2.6, 9, 7).translate(0, 7.5, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3.5, 5).translate(0, 1.75, 0);
    const fol = new THREE.InstancedMesh(foliageGeo, new THREE.MeshStandardMaterial({ color: 0x2f4f23, roughness: 0.9 }), trees.length);
    const trk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const col = new THREE.Color();
    trees.forEach((tr, k) => {
      sc.setScalar(tr[3]); ps.set(tr[0], tr[1] - 0.3, tr[2]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr[4] * 6);
      m.compose(ps, q, sc); fol.setMatrixAt(k, m); trk.setMatrixAt(k, m);
      col.setHSL(0.25 + tr[4] * 0.08, 0.45, 0.22 + tr[4] * 0.1); fol.setColorAt(k, col);
    });
    fol.castShadow = true; fol.receiveShadow = true; trk.castShadow = true;
    this.group.add(fol, trk);

    // grandstands + pit building along the start straight
    const crowd = TX.crowdTexture();
    const standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 0.6, roughness: 0.3 });
    const startS = t.length * (t.def.start ?? 0);
    for (const [ds, side, len] of [[-120, 1, 110], [40, 1, 140], [-60, -1, 160], [180, 1, 90]]) {
      const p = t.pointAt(startS + ds, side * (hw + t.runoff + 9));
      const g = new THREE.Group();
      for (let r = 0; r < 6; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 1.6), standMat);
        step.position.set(0, 0.6 + r * 1.1, side * r * 1.5); step.castShadow = true; step.receiveShadow = true; g.add(step);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.3, 11), roofMat);
      roof.position.set(0, 10, side * 4); roof.rotation.x = side * 0.08; roof.castShadow = true; g.add(roof);
      g.position.set(p.x, p.h, p.z); g.rotation.y = p.yaw + Math.PI / 2;
      this.group.add(g);
    }
    const pp = t.pointAt(startS - 40, -(hw + t.runoff + 14));
    const pit = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 260), new THREE.MeshPhysicalMaterial({ color: 0xe9ecef, metalness: 0.2, roughness: 0.25, clearcoat: 0.5 }));
    pit.position.set(pp.x, pp.h + 4.5, pp.z); pit.rotation.y = pp.yaw; pit.castShadow = true; pit.receiveShadow = true;
    this.group.add(pit);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(14.2, 3, 250), new THREE.MeshPhysicalMaterial({ color: 0x1a2a3a, metalness: 0.9, roughness: 0.05 }));
    glass.position.set(pp.x, pp.h + 6.5, pp.z); glass.rotation.y = pp.yaw; this.group.add(glass);
  }
}
