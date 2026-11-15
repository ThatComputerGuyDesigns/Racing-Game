// On-track racing line: a ribbon along the AI racing line, coloured live from your
// speed: green = accelerate, yellow = lift / light brake, red = brake now.
import * as THREE from 'three';
import { brakingNeed } from '../sim/assists.js';

const G = 9.81;

export class RaceLine {
  constructor(scene, track, line, profile, spec) {
    this.track = track; this.profile = profile; this.spec = spec;
    const n = track.n, W = 0.85;
    const pos = new Float32Array(n * 2 * 3), idx = [];
    this.col = new Float32Array(n * 2 * 3); this.alpha = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = line.x[i], z = line.z[i], h = track.h[i] + 0.1;
      pos.set([x + track.nx[i] * W, h, z + track.nz[i] * W, x - track.nx[i] * W, h, z - track.nz[i] * W], i * 6);
      const j = (i + 1) % n;
      idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA; void main(){ vC=aColor; vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ gl_FragColor=vec4(vC*2.4, vA); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.prev = [];
    this.kD = 0.5 * 1.225 * spec.cla / (spec.mass + 20);
  }

  decelCap(v) {
    const mu = 1.35 * (1 - 0.15 * this.kD * v * v / G);
    return 0.9 * mu * (G + this.kD * v * v);
  }

  /** mode: 'full' | 'corners' | 'off' */
  update(s, speed, mode) {
    const tr = this.track;
    for (const i of this.prev) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; }
    this.prev.length = 0;
    this.mesh.visible = mode !== 'off';
    if (mode !== 'off') {
      const { i0, need } = brakingNeed(tr, this.profile, s, speed, 260);
      // running "worst need" so the line stays red until the braking point is passed
      for (let k = 2; k < need.length; k++) {
        const i = tr.idx(i0 + k);
        const vj = this.profile[i];
        // static zone colour from the profile itself (braking zones / corners)
        const vn = this.profile[tr.idx(i + 6)];
        const zoneBrake = vj - vn > 1.2, zoneLift = vj - vn > 0.3;
        const capN = need[k] / this.decelCap(Math.max(vj, 20));
        let r = 0.15, g = 0.95, b = 0.35;                       // green
        if (capN > 0.55 || (zoneBrake && capN > 0.2)) { r = 1.0; g = 0.12; b = 0.1; }      // red
        else if (capN > 0.12 || zoneLift) { r = 1.0; g = 0.8; b = 0.1; }                    // yellow
        const isGreen = g > 0.9;
        if (mode === 'corners' && isGreen && Math.abs(tr.curv[i]) < 0.006) continue;
        const fadeIn = Math.min(1, k / 6), fadeOut = Math.min(1, (need.length - k) / 25);
        const a = 0.92 * fadeIn * fadeOut;
        this.col.set([r, g, b, r, g, b], i * 6);
        this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
        this.prev.push(i);
      }
    }
    const at = this.mesh.geometry.attributes;
    at.aColor.needsUpdate = true; at.aAlpha.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

/** Braking assist: brakes for you when you're over the line's target speed. */
export function brakeAssist(track, profile, s, speed, input) {
  const i = Math.floor(track.wrapS(s) / track.ds);
  let target = Infinity;
  for (let k = 0; k < 5; k++) target = Math.min(target, profile[track.idx(i + k)]);
  const over = speed - target * 1.01;
  if (over > 0.3) return { ...input, brake: Math.max(input.brake, Math.min(1, over * 0.35)), throttle: Math.min(input.throttle, 0) };
  return input;
}
