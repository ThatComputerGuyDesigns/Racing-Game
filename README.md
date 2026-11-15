# Velocity Circuit

Sim-cade open-wheel racing in the browser. Three.js, procedural everything, no downloads.

**Play:** GitHub Pages (see below), or locally with one command:

```bash
npm install && npm start
```

then open http://localhost:5173.

## Controls
Arrows/WASD drive · Q/E shift (manual gearbox) · C camera · R instant restart · Backspace reset car ·
L racing line (full / corners / off) · T/Y toggle TC/ABS · Esc pause. Gamepad: left stick, RT/LT, LB/RB shift, Y camera, Start pause.
`?quality=low` for weak GPUs.

## Circuits
Spa-Francorchamps, Silverstone, Monza, Suzuka (figure-eight with the crossover bridge), Imola, plus the original
Red Mesa Speedway. Real layouts come from open centerline data (see CREDITS.md).

## Tests
`npm test` runs the automated handling and AI suite: skidpad grip, AI hot laps on every circuit
(lap time window, off-track %, wall hits), a keyboard-only bot that must lap cleanly through the real
keyboard filter + assists, and full-field races that must finish with little contact.
`node test/race.mjs spa` and `node test/lapsim.mjs` print details.

## GitHub Pages
`.github/workflows/pages.yml` tests, builds and deploys `dist/` on every push.
One-time setup: **Settings → Pages → Source: GitHub Actions**, and under
**Settings → Environments → github-pages** allow the branch you deploy from (or merge to `main`).

## Layout
- `src/sim/`: pure-JS simulation (car physics, tyres, tracks, racing line, AI, race session). Runs in Node for tests.
- `src/game/`: rendering, FX, HUD, input, audio.
- `tools/`: build, dev server, headless screenshot playtester, circuit importer.
