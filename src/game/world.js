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
    this.scene.environmentIntensity = 0.55 - wet * 0.15;
    const fogCol = new THREE.Color(wet > 0.2 ? 0x8d949c : 0x9fb8d6);
    this.scene.fog = new THREE.Fog(fogCol, 700 - wet * 450, 5500 - wet * 4200);

    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2 * (1 - wet * 0.65));
    sun.position.copy(sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 700;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.sun = sun; this.group.add(sun); this.group.add(sun.target);
    this._clouds(sunDir, wet);
    const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x3a4a2a, 0.22 + wet * 0.35);
    this.group.add(hemi); this.hemi = hemi;
  }

  _clouds(sunDir, wet) {
    // procedural animated cloud layer on a dome (fbm noise, lit from the sun side)
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, sunDir: { value: sunDir.clone() }, cover: { value: 0.55 + (wet ? -0.2 : 0) }, dark: { value: wet } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float time, cover, dark; uniform vec3 sunDir; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          if (vP.y < 0.0) discard;
          vec2 uv = vP.xz / (vP.y + 0.12) * 1.6 + vec2(time*0.004, time*0.002);
          float d = fbm(uv);
          float c = smoothstep(cover, cover + 0.28, d);
          float edge = smoothstep(0.0, 0.25, vP.y);
          float lit = 0.75 + 0.35 * max(0.0, dot(normalize(vec3(vP.x, 0.3, vP.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))));
          float shade = 1.0 - 0.45 * smoothstep(cover, cover + 0.6, fbm(uv * 1.7 + 3.0));
          vec3 col = mix(vec3(1.0), vec3(0.55, 0.58, 0.62), dark) * lit * shade;
          gl_FragColor = vec4(col, c * edge * 0.92);
        }`,
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), mat);
    dome.renderOrder = -1; this.group.add(dome); this.cloudMat = mat;
    this.cloudDome = dome;
    // distant mountain ring for a real horizon
    const ring = new THREE.CylinderGeometry(5200, 5200, 1, 160, 1, true);
    const pos = ring.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), a = Math.atan2(z, x);
      if (pos.getY(i) > 0) pos.setY(i, 120 + fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3) * 700 + Math.abs(Math.sin(a * 7.0)) * 160);
      else pos.setY(i, -60);
    }
    ring.computeVertexNormals();
    const mtn = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: wet > 0.2 ? 0x7b838c : 0x7d93ad, side: THREE.BackSide, fog: false }));
    this.mountains = mtn; this.group.add(mtn);
  }

  update(dt, camPos) {
    if (this.cloudMat) this.cloudMat.uniforms.time.value += dt;
    if (camPos) { this.cloudDome.position.set(camPos.x, 0, camPos.z); this.mountains.position.set(camPos.x, 0, camPos.z); }
  }

  /** Blend visuals between dry (0) and soaked (1): road sheen, fog, light, clouds. */
  setWet(w) {
    if (Math.abs((this._wet ?? -1) - w) < 0.004) return;
    this._wet = w;
    const r = this.roadMat;
    r.roughness = 0.78 - w * 0.66; r.envMapIntensity = 0.35 + w * 2.0;
    r.color.setScalar(1 - w * 0.4);
    this.terrainMat.color.setRGB(1 - w * 0.3, 1 - w * 0.25, 1 - w * 0.3);
    for (const g of this.grassMats) g.color.setRGB(0.78 - w * 0.2, 0.85 - w * 0.2, 0.69 - w * 0.15);
    const dry = new THREE.Color(0x9fb8d6), wetC = new THREE.Color(0x8d949c);
    this.scene.fog.color.copy(dry).lerp(wetC, w);
    this.scene.fog.near = 700 - w * 520; this.scene.fog.far = 5500 - w * 4300;
    this.sun.intensity = 3.2 * (1 - w * 0.7);
    this.hemi.intensity = 0.22 + w * 0.4;
    this.scene.environmentIntensity = 0.55 - w * 0.2;
    this.cloudMat.uniforms.cover.value = 0.55 - w * 0.4;
    this.cloudMat.uniforms.dark.value = w;
    this.sky.material.uniforms.turbidity.value = 2.5 + w * 12;
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
    // colour variation: meadow patches, dry grass, darker hollows
    const cols = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const a = fbm(x * 0.006, z * 0.006), b2 = fbm(x * 0.03 + 7, z * 0.03);
      c.setHSL(0.22 + a * 0.12, 0.35 + b2 * 0.3, 0.52 + a * 0.35 + b2 * 0.12);
      cols.set([c.r * 1.6, c.g * 1.6, c.b * 1.6], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const tex = TX.grassTexture(this.renderer);
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, envMapIntensity: 0.3, color: this.weather.wet > 0.3 ? 0xa8b8a0 : 0xffffff });
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
    this.group.add(mesh); this.terrainMat = mat;
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
      map: asphalt, normalMap: TX.asphaltNormal(), normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.78 - wet * 0.62, metalness: 0.0, color: wet > 0.2 ? 0x8a8a8a : 0xffffff,
      envMapIntensity: 0.35 + wet * 1.8,
    });
    this.roadMat = roadMat; this.grassMats = [];
    const road = new THREE.Mesh(this._ribbon(hw, -hw, 0.06, 'track', null, 1 / 24), roadMat);
    road.receiveShadow = true; this.group.add(road);
    // grass shoulders follow the track elevation and overlap the terrain
    const grassMat = new THREE.MeshStandardMaterial({ map: TX.grassTexture(this.renderer), roughness: 0.95, envMapIntensity: 0.3, color: wet > 0.3 ? 0x98a890 : 0xc8d8b0 });
    this.grassMats.push(grassMat);
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
    // catch fences behind the barriers (alpha-tested diamond mesh)
    const fenceMat = new THREE.MeshStandardMaterial({ map: TX.fenceTexture(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    for (const sgn of [1, -1]) {
      const f = this._wall(sgn * (hw + t.runoff + 0.4), 1.1, 4.2, fenceMat, false);
      f.material.map.repeat.set(3, 3); this.group.add(f);
    }
    // sponsor gantries spanning the track
    const steel = new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.7, roughness: 0.4 });
    for (const frac of [0.22, 0.47, 0.73]) {
      const p = t.pointAt(t.length * frac), g = new THREE.Group(), span = t.width + 2 * t.runoff + 2;
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), steel); post.position.set(sd * span / 2, 4.5, 0); post.castShadow = true; g.add(post); }
      const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 2.2, 0.5), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: TX.bannerTexture(frac), roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: TX.bannerTexture(frac + 0.3), roughness: 0.6 })]);
      banner.position.y = 8.2; banner.castShadow = true; g.add(banner);
      g.position.set(p.x, p.h, p.z); g.rotation.y = p.yaw; this.group.add(g);
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
    const mergeGeos = (list) => {
      // tiny merge helper (non-indexed) so each tree type is one instanced draw
      const parts = list.map(g => g.index ? g.toNonIndexed() : g);
      const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
      const P = new Float32Array(total * 3), N = new Float32Array(total * 3); let o = 0;
      for (const g of parts) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
      const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return out;
    };
    const pineGeo = mergeGeos([
      new THREE.ConeGeometry(3.0, 5.5, 8).translate(0, 5.0, 0), new THREE.ConeGeometry(2.4, 4.8, 8).translate(0, 8.0, 0),
      new THREE.ConeGeometry(1.6, 4.0, 8).translate(0, 10.8, 0), new THREE.ConeGeometry(0.9, 2.8, 6).translate(0, 13.0, 0)]);
    const leafGeo = mergeGeos([
      new THREE.IcosahedronGeometry(3.2, 1).translate(0, 7.2, 0), new THREE.IcosahedronGeometry(2.4, 1).translate(1.8, 8.6, 0.6),
      new THREE.IcosahedronGeometry(2.2, 1).translate(-1.6, 8.2, -0.8), new THREE.IcosahedronGeometry(1.8, 1).translate(0.2, 10.0, 0.2)]);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.4, 5, 6).translate(0, 2.5, 0);
    const pines = trees.filter(t2 => t2[4] < 0.55), leafs = trees.filter(t2 => t2[4] >= 0.55);
    const folMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true, envMapIntensity: 0.25 });
    const mk = (geo, list) => { const im = new THREE.InstancedMesh(geo, folMat, Math.max(1, list.length)); im.count = list.length; im.castShadow = true; im.receiveShadow = true; return im; };
    const pineM = mk(pineGeo, pines), leafM = mk(leafGeo, leafs);
    const trk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const place = (im, list, pine) => list.forEach((tr, k) => {
      sc.set(tr[3], tr[3] * (0.85 + tr[4] * 0.4), tr[3]); ps.set(tr[0], tr[1] - 0.3, tr[2]);
      q.setFromAxisAngle(up, tr[4] * 40);
      m.compose(ps, q, sc); im.setMatrixAt(k, m);
      if (pine) col.setHSL(0.30 + tr[4] * 0.06, 0.42, 0.16 + tr[4] * 0.08); else col.setHSL(0.20 + (tr[4] - 0.55) * 0.25, 0.5, 0.24 + (tr[4] - 0.55) * 0.2);
      im.setColorAt(k, col);
    });
    place(pineM, pines, true); place(leafM, leafs, false);
    trees.forEach((tr, k) => { sc.setScalar(tr[3]); ps.set(tr[0], tr[1] - 0.3, tr[2]); m.compose(ps, q.identity(), sc); trk.setMatrixAt(k, m); });
    trk.castShadow = true;
    this.group.add(pineM, leafM, trk);

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
