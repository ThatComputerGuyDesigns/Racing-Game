// Racing line (minimum-curvature relaxation inside track limits) + speed profile.
const G = 9.81, RHO = 1.225;

export function computeRacingLine(track, opts = {}) {
  const margin = opts.margin ?? 2.0;
  const stride = 4; // work on every 4th sample (~8 m)
  const n = Math.floor(track.n / stride);
  const cx = new Float64Array(n), cz = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * stride;
    cx[i] = track.x[k]; cz[i] = track.z[k]; nx[i] = track.nx[k]; nz[i] = track.nz[k];
  }
  const lim = track.width / 2 - margin;
  const off = new Float64Array(n);
  const px = new Float64Array(n), pz = new Float64Array(n);
  const w = (i) => (i + n) % n;
  for (let it = 0; it < 1400; it++) {
    for (let i = 0; i < n; i++) { px[i] = cx[i] + nx[i] * off[i]; pz[i] = cz[i] + nz[i] * off[i]; }
    for (let i = 0; i < n; i++) {
      const a = w(i - 2), b = w(i - 1), c = w(i + 1), d = w(i + 2);
      // blend of shortest-path (neighbour average) and min-curvature (4-point) targets
      const tx = 0.35 * (px[b] + px[c]) / 2 + 0.65 * (-px[a] + 4 * px[b] + 4 * px[c] - px[d]) / 6;
      const tz = 0.35 * (pz[b] + pz[c]) / 2 + 0.65 * (-pz[a] + 4 * pz[b] + 4 * pz[c] - pz[d]) / 6;
      const o = (tx - cx[i]) * nx[i] + (tz - cz[i]) * nz[i];
      off[i] += (o - off[i]) * 0.5;
      if (off[i] > lim) off[i] = lim; else if (off[i] < -lim) off[i] = -lim;
    }
  }
  // upsample offsets back to full resolution
  const full = new Float64Array(track.n);
  for (let k = 0; k < track.n; k++) {
    const f = k / stride, i = Math.floor(f) % n, t = f - Math.floor(f);
    full[k] = off[i] * (1 - t) + off[w(i + 1)] * t;
  }
  const line = { offset: full, x: new Float64Array(track.n), z: new Float64Array(track.n), curv: new Float64Array(track.n) };
  for (let k = 0; k < track.n; k++) {
    line.x[k] = track.x[k] + track.nx[k] * full[k];
    line.z[k] = track.z[k] + track.nz[k] * full[k];
  }
  // curvature of the line via circumcircle of neighbours 3 samples apart
  for (let k = 0; k < track.n; k++) {
    const a = track.idx(k - 3), c = track.idx(k + 3);
    const ax = line.x[a], az = line.z[a], bx = line.x[k], bz = line.z[k], qx = line.x[c], qz = line.z[c];
    const cross = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
    const d1 = Math.hypot(bx - ax, bz - az), d2 = Math.hypot(qx - bx, qz - bz), d3 = Math.hypot(qx - ax, qz - az);
    line.curv[k] = -2 * cross / Math.max(1e-6, d1 * d2 * d3);
  }
  return line;
}

/**
 * Speed profile along a racing line for a given car spec.
 * mu: effective friction the profile assumes (AI uses a fraction of the true limit).
 */
export function speedProfile(track, line, spec, opts = {}) {
  // Effective friction calibrated against test/skidpad.mjs: ~1.40 at low speed, falling
  // with aero load because of tyre load sensitivity.
  const muBase = opts.mu ?? 1.40;
  const m = spec.mass + (opts.fuel ?? 30);
  const kDown = 0.5 * RHO * spec.cla / m;
  const kDrag = 0.5 * RHO * spec.cda / m;
  const muAt = (v) => muBase * (1 - 0.15 * kDown * v * v / G);
  const power = opts.power ?? 450000;
  const vTop = 92;
  const n = track.n, ds = track.ds;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let k = -2; k <= 2; k++) c += Math.abs(line.curv[track.idx(i + k)]);
    c /= 5;
    let vv = 40;
    for (let it = 0; it < 6; it++) {
      const mu = muAt(vv), den = c - mu * kDown;
      vv = den <= 1e-5 ? vTop : Math.min(vTop, Math.sqrt(mu * G / den));
    }
    v[i] = vv;
  }
  const mu = muBase;
  // backward pass (braking), twice around for closure
  for (let pass = 0; pass < 2; pass++) {
    for (let j = n - 1; j >= 0; j--) {
      const i = j, nx = track.idx(j + 1);
      const vn = v[nx];
      const a = muAt(vn) * 0.9 * (G + kDown * vn * vn) + kDrag * vn * vn;
      const lim = Math.sqrt(vn * vn + 2 * a * ds);
      if (v[i] > lim) v[i] = lim;
    }
  }
  // forward pass (traction/power)
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < n; j++) {
      const i = track.idx(j + 1), pr = j;
      const vp = Math.max(1, v[pr]);
      const aGrip = mu * 0.9 * (G * 0.55 + kDown * vp * vp * 0.55);
      const aPow = power / (m * vp) - kDrag * vp * vp;
      const a = Math.max(0, Math.min(aGrip, aPow));
      const lim = Math.sqrt(vp * vp + 2 * a * ds);
      if (v[i] > lim) v[i] = lim;
    }
  }
  return v;
}
