// Visual effects: GPU point particles (smoke, sparks, spray), skid marks,
// and the post-processing chain (bloom, speed blur, heat haze, vignette).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { softDot } from './textures.js';

export class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.grow = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.alpha = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softDot() }, scale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA;
        uniform float scale; void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize = aSize*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord);
        gl_FragColor=vec4(vC, t.a*vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, alpha, drag = 1, grav = 0) {
    let i = this.n < this.max ? this.n++ : (this._ring = ((this._ring || 0) + 1) % this.max);
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.col.set([r, g, b], i * 3); this.alpha[i] = alpha; this._a0 = this._a0 || new Float32Array(this.max); this._a0[i] = alpha;
    this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = this._a0[i] * Math.min(1, f * 2.5) * (f > 0 ? 1 : 0);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aColor.needsUpdate = a.aAlpha.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.n = 0; }
}

export class SkidMarks {
  constructor(scene, max = 6000) {
    this.max = max; this.k = 0;
    this.pos = new Float32Array(max * 4 * 3); this.alpha = new Float32Array(max * 4);
    const idx = [];
    for (let i = 0; i < max; i++) { const b = i * 4; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor=vec4(0.03,0.03,0.035,vA); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.last = new Map();
  }
  /** key identifies a wheel; call each frame with intensity 0..1 */
  add(key, x, y, z, dirx, dirz, width, intensity) {
    const prev = this.last.get(key);
    if (intensity < 0.05) { this.last.delete(key); return; }
    if (!prev) { this.last.set(key, { x, y, z, a: intensity }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    if (dx * dx + dz * dz < 0.5) return;
    if (dx * dx + dz * dz > 25) { this.last.set(key, { x, y, z, a: intensity }); return; }
    const nx = dirz * width / 2, nz = -dirx * width / 2;
    const i = this.k++ % this.max, b = i * 4;
    const P = this.pos;
    P.set([prev.x + nx, prev.y, prev.z + nz, prev.x - nx, prev.y, prev.z - nz, x + nx, y, z + nz, x - nx, y, z - nz], b * 3);
    const a = Math.min(0.75, intensity * 0.8);
    this.alpha[b] = this.alpha[b + 1] = prev.a; this.alpha[b + 2] = this.alpha[b + 3] = a;
    this.last.set(key, { x, y, z, a });
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
  clear() { this.alpha.fill(0); this.mesh.geometry.attributes.aAlpha.needsUpdate = true; this.last.clear(); }
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, speed: { value: 0 }, time: { value: 0 },
    haze: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    rain: { value: 0 }, aspect: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float speed; uniform float time; uniform vec3 haze[4]; uniform float rain; uniform float aspect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      vec2 uv = vUv;
      // heat haze: noise-driven refraction inside ellipses behind exhausts
      for (int k=0;k<4;k++){
        vec3 hz = haze[k];
        if (hz.z <= 0.0) continue;
        vec2 d = (uv - hz.xy); d.x *= aspect;
        float r = length(d / vec2(0.09, 0.06) * (0.6 + 1.0/(hz.z*8.0+0.3)));
        float m = smoothstep(1.0, 0.0, r) * hz.z;
        vec2 off = vec2(n2(uv*40.0 + vec2(0.0, time*6.0)) - 0.5, n2(uv*40.0 + vec2(time*5.0, 3.0)) - 0.5);
        uv += off * 0.012 * m;
      }
      // radial speed blur (motion blur for sense of speed), strongest at screen edges
      vec2 c = vec2(0.5, 0.55);
      vec2 dir = uv - c;
      float edge = smoothstep(0.12, 0.75, length(dir * vec2(aspect, 1.0)));
      float amt = speed * edge * 0.045;
      vec3 col = vec3(0.0);
      for (int i=0;i<10;i++){ float t = float(i)/9.0; col += texture2D(tDiffuse, uv - dir * amt * t).rgb; }
      col /= 10.0;
      // subtle chromatic fringe at speed
      float ca = speed * edge * 0.004;
      col.r = mix(col.r, texture2D(tDiffuse, uv - dir*ca).r, 0.5);
      col.b = mix(col.b, texture2D(tDiffuse, uv + dir*ca).b, 0.5);
      // rain streaks on lens
      if (rain > 0.0) {
        vec2 ruv = vec2(uv.x*80.0, uv.y*3.0 + time*(2.5+speed*4.0));
        float s = step(0.985, h(floor(ruv))) * smoothstep(0.0,1.0,fract(ruv.y));
        col = mix(col, col*1.25 + 0.05, s * rain * 0.5);
      }
      // vignette
      float v = smoothstep(1.15, 0.35, length((vUv - 0.5) * vec2(aspect*0.75, 1.0)));
      col *= mix(0.72, 1.0, v);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function makeComposer(renderer, scene, camera, low = false) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.25, 2.2);
  if (!low) composer.addPass(bloom);
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);
  composer.addPass(new OutputPass());
  return { composer, bloom, final };
}
