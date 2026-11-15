// Assist presets shared by the game and the keyboard drivability tests.
// steerAssist 1.0 = full lock always equals peak front grip for the current speed.
export const ASSIST_PRESETS = {
  full:   { abs: true, tc: true, stability: 0.6, steerAssist: 1.0, autoGear: true, brakeAssist: true, line: 'full' },
  medium: { abs: true, tc: true, stability: 0.45, steerAssist: 0.9, autoGear: true, brakeAssist: false, line: 'full' },
  off:    { abs: false, tc: false, stability: 0, steerAssist: 0.5, autoGear: false, brakeAssist: false, line: 'off' },
};
export const DIFFICULTY = { easy: 0.90, medium: 0.945, hard: 0.98, pro: 1.0 };

/**
 * Line guidance: for the stretch ahead, how hard you need to brake (m/s^2) to make
 * each point at its target speed. Used for the coloured line and the braking assist.
 */
export function brakingNeed(track, profile, s, speed, ahead = 260) {
  const i0 = Math.floor(track.wrapS(s) / track.ds);
  const steps = Math.round(ahead / track.ds);
  const need = new Float32Array(steps);
  for (let k = 1; k < steps; k++) {
    const vj = profile[track.idx(i0 + k)];
    const d = k * track.ds;
    need[k] = speed > vj ? (speed * speed - vj * vj) / (2 * d) : 0;
  }
  return { i0, need };
}
