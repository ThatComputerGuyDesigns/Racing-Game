# Velocity Circuit

Sim-cade open-wheel racing in the browser. Three.js, procedural everything, no downloads.

**Play:** GitHub Pages (see below), or locally with one command:

```bash
npm install && npm start
```

then open http://localhost:5173.

## Modes
- **Career**: join Velocity Works, a new team. Drive the open coast road between venues (speed trap earns R&D),
  enter the glowing gate for the next round, qualify, pick tyres, race. Points, standings, a rival who
  remembers incidents, and a 5-branch development tree (G = garage).
- **Race weekend**: qualifying (AI times from their real simulated pace) then the race.
- **Quick race** / **Hot lap**.

## Assists
- **Full**: a co-driver drives the racing line and brakes for corners; hold throttle and steer to overtake.
- **Medium**: you steer; auto corner braking, edge protection, stability control.
- **Off**: simulation.

## Controls
Arrows/WASD drive · Q/E shift (manual gearbox) · C camera · R instant restart · Backspace reset car ·
L racing line (full / corners / off) · P box this lap · 1-4 next tyre (soft/medium/hard/inter) ·
G garage (career) · Enter start event / end quali · T/Y toggle TC/ABS · Esc pause. Gamepad: left stick, RT/LT, LB/RB shift, Y camera, Start pause.
`?quality=low` for weak GPUs.

## Circuits
Spa-Francorchamps, Silverstone, Monza, Suzuka (figure-eight with the crossover bridge), Imola, plus the original
Red Mesa Speedway. Real layouts come from open centerline data (see CREDITS.md).

## Tests
`npm test` runs the automated handling and AI suite: skidpad grip, AI hot laps on every circuit
(lap time window, off-track %, wall hits), a keyboard-only bot that must lap cleanly through the real
keyboard filter + assists, human-like bots (late reactions, key taps, braking errors, or no steering)
that must lap cleanly on Full assists, full-field races, a strategy race with pit stops and changeable
weather, and the career points/R&D/upgrade logic.
`node test/race.mjs spa` and `node test/lapsim.mjs` print details.

## GitHub Pages
`.github/workflows/pages.yml` tests, builds and deploys `dist/` on every push.
One-time setup: **Settings → Pages → Source: GitHub Actions**, and under
**Settings → Environments → github-pages** allow the branch you deploy from (or merge to `main`).

## Layout
- `src/sim/`: pure-JS simulation (car physics, tyres, tracks, racing line, AI, race session). Runs in Node for tests.
- `src/game/`: rendering, FX, HUD, input, audio.
- `tools/`: build, dev server, headless screenshot playtester, circuit importer.
