// Track geometry: closed Catmull-Rom centerline resampled at fixed arc length.
// Pure JS (no three.js) so it runs in Node for automated lap simulations.
// Conventions: world plane is (x, z); yaw 0 faces +z; "left" normal = (tz, -tx).

const STEP = 2.0; // metres between samples

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Track {
  /**
   * @param {object} def { name, points: [[x,z],...], width, runoff, elevation?: [[s01, h]], surfaceGrip? }
   */
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.width = def.width ?? 14;
    this.runoff = def.runoff ?? 9; // grass/gravel from track edge to barrier
    this.closed = def.closed !== false;
    this._build(def.points);
  }

  _build(pts) {
    const n = pts.length;
    const dense = [];
    const SUB = 40;
    const count = this.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const g = (k) => this.closed ? pts[(k + n) % n] : pts[Math.max(0, Math.min(n - 1, k))];
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      for (let j = 0; j < SUB; j++) {
        const t = j / SUB;
        dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
      }
    }
    if (this.closed) dense.push(dense[0].slice()); else dense.push(pts[n - 1].slice());
    // cumulative length
    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    const N = Math.max(8, Math.round(total / STEP));
    this.length = total;
    this.ds = total / N;
    this.n = this.closed ? N : N + 1;
    const X = new Float64Array(this.n), Z = new Float64Array(this.n);
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const s = i * this.ds;
      while (k < cum.length - 2 && cum[k + 1] < s) k++;
      const f = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
      X[i] = dense[k][0] + (dense[k + 1][0] - dense[k][0]) * f;
      Z[i] = dense[k][1] + (dense[k + 1][1] - dense[k][1]) * f;
    }
    this.x = X; this.z = Z;
    this.tx = new Float64Array(this.n); this.tz = new Float64Array(this.n);
    this.nx = new Float64Array(this.n); this.nz = new Float64Array(this.n);
    this.curv = new Float64Array(this.n);
    this.yaw = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = this.idx(i - 1), b = this.idx(i + 1);
      let dx = X[b] - X[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      this.tx[i] = dx; this.tz[i] = dz;
      this.nx[i] = dz; this.nz[i] = -dx;
      this.yaw[i] = Math.atan2(dx, dz);
    }
    for (let i = 0; i < this.n; i++) {
      const a = this.idx(i - 2), b = this.idx(i + 2);
      let d = this.yaw[b] - this.yaw[a];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.curv[i] = d / (4 * this.ds);
    }
    // elevation profile (rendering + slope force); default flat
    this.h = new Float64Array(this.n);
    if (this.def.elevation) {
      const e = this.def.elevation; // [[fraction, height]] closed
      for (let i = 0; i < this.n; i++) {
        const f = i / this.n;
        let j = 0;
        while (j < e.length - 1 && e[j + 1][0] <= f) j++;
        const a = e[j], b = e[(j + 1) % e.length];
        const span = ((b[0] - a[0]) + 1) % 1 || 1;
        const t = (((f - a[0]) + 1) % 1) / span;
        const sm = t * t * (3 - 2 * t);
        this.h[i] = a[1] + (b[1] - a[1]) * sm;
      }
    }
    // kerb flags where curvature is significant
    this.kerb = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) if (Math.abs(this.curv[i]) > 0.006) this.kerb[i] = 1;
  }

  idx(i) {
    if (this.closed) return ((i % this.n) + this.n) % this.n;
    return Math.max(0, Math.min(this.n - 1, i));
  }

  wrapS(s) { return this.closed ? ((s % this.length) + this.length) % this.length : Math.max(0, Math.min(this.length, s)); }

  /** World point at arc length s and lateral offset (positive = left). */
  pointAt(s, lat = 0) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i = Math.floor(f), t = f - i;
    const a = this.idx(i), b = this.idx(i + 1);
    const x = this.x[a] + (this.x[b] - this.x[a]) * t;
    const z = this.z[a] + (this.z[b] - this.z[a]) * t;
    const nx = this.nx[a] + (this.nx[b] - this.nx[a]) * t;
    const nz = this.nz[a] + (this.nz[b] - this.nz[a]) * t;
    const h = this.h[a] + (this.h[b] - this.h[a]) * t;
    return { x: x + nx * lat, z: z + nz * lat, yaw: Math.atan2(this.tx[a], this.tz[a]), h };
  }

  /**
   * Project a world point onto the centerline.
   * @returns {{i:number, s:number, lat:number}} lat positive = left of centerline
   */
  project(x, z, hint = -1) {
    let best = -1, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = this.idx(hint + k);
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      // if we jumped far away (teleport), fall back to full search
      if (bestD > 60 * 60) hint = -1;
    }
    if (hint < 0) {
      for (let i = 0; i < this.n; i++) {
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // refine along segment
    const i = best;
    const dx = x - this.x[i], dz = z - this.z[i];
    let along = dx * this.tx[i] + dz * this.tz[i];
    const lat = dx * this.nx[i] + dz * this.nz[i];
    let s = i * this.ds + along;
    s = this.wrapS(s);
    return { i, s, lat };
  }

  heightAt(i) { return this.h[i]; }
}
