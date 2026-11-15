# Velocity Circuit: design doc (short)

## The hook
**Rivals who race like people, not rubber bands.** Every AI driver has a fixed, readable personality
(pace, consistency, aggression, composure, braking style). Their speed comes only from skill: no catch-up,
no slowdown. Pressure is the variable: sit in someone's mirrors and a low-composure driver starts locking
up and running wide, while a metronome won't crack. Beating a rival is about reading *them*, not the
game's difficulty slider. The career turns this into history (grudges, respect, retaliation), so a
win against Vell at Spa means something because you know how Vell races.

## Pillars (priority order)
1. **Handling.** 240 Hz four-wheel model: load transfer, aero, magic-formula tyres, friction-ellipse
   combined slip, tyre temperature and wear windows per compound. Understeer-biased at the limit, with
   power oversteer when TC is off. Validated by automated skidpad and lap simulations.
2. **Speed and spectacle.** Speed FOV, lagging chase camera, radial speed blur, heat haze, sparks, smoke,
   skid marks, PBR clearcoat paint, glass aeroscreen.
3. **Racing AI.** Same physics and controls as the player. Racing line, overtakes off-line, gives room
   alongside, makes pressure mistakes.
4. **Core loop.** Qualifying sets the grid, tyre choice, wear-scaled strategy with driven pit stops,
   changeable weather (rain arrives, track wets/dries, crews switch to intermediates), instant restart.
5. **Career.** Free-roam coast road linking the venues (speed-trap challenges earn R&D), 6-round season,
   points and standings, a rival chosen by standings or grudge (incidents raise heat; your rival races you
   harder), and a development tree (power, aero, suspension, brakes, tyre management).

## Assists philosophy
Full assists must make the game easy: a co-driver steers the line when you're hands-off and blends with you
when you steer, plus auto braking and edge protection. Assisted steering is yaw-rate based (input asks for a
turn rate, not a wheel angle), so keyboard taps never overshoot. Verified by human-like test bots.

## Art direction
Stylized-realistic: physically-based materials and lighting over procedural geometry. Readable silhouettes,
clean HUD, no licensed assets.
