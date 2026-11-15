// Keyboard + gamepad input with smoothing so keyboard players get progressive steering.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.usingPad = false;
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code); this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** consume a one-shot press */
  hit(...codes) { for (const c of codes) if (this.pressed.has(c)) { this.pressed.delete(c); return true; } return false; }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  update(dt) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA'), right = k.has('ArrowRight') || k.has('KeyD');
    const up = k.has('ArrowUp') || k.has('KeyW'), down = k.has('ArrowDown') || k.has('KeyS') || k.has('Space');
    let target = (left ? 1 : 0) - (right ? 1 : 0);
    // keyboard steering: ramp in, faster ramp out (self-centering)
    const rate = target === 0 ? 6 : (Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 3.2);
    const d = target - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    this.throttle += ((up ? 1 : 0) - this.throttle) * Math.min(1, dt * 10);
    this.brake += ((down ? 1 : 0) - this.brake) * Math.min(1, dt * 14);
    let shiftUp = this.hit('KeyE'), shiftDown = this.hit('KeyQ');

    const pad = this._pad();
    if (pad) {
      const ax = pad.axes[0] || 0;
      const dz = 0.08;
      const a = Math.abs(ax) < dz ? 0 : (Math.abs(ax) - dz) / (1 - dz);
      const curved = Math.sign(ax) * Math.pow(a, 1.5);
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      if (Math.abs(ax) > dz || rt > 0.05 || lt > 0.05) this.usingPad = true;
      if (this.usingPad) {
        this.steer = -curved;
        this.throttle = rt; this.brake = lt;
      }
      const btn = (i) => pad.buttons[i]?.pressed;
      this._padPrev = this._padPrev || [];
      const edge = (i) => btn(i) && !this._padPrev[i];
      if (edge(5) || edge(1)) shiftUp = true;
      if (edge(4) || edge(2)) shiftDown = true;
      if (edge(9)) this.pressed.add('Escape');
      if (edge(3)) this.pressed.add('KeyC');
      if (edge(8)) this.pressed.add('KeyR');
      this._padPrev = pad.buttons.map(b => b.pressed);
    }
    return { steer: this.steer, throttle: this.throttle, brake: this.brake, shiftUp, shiftDown };
  }

  endFrame() { this.pressed.clear(); }
}
