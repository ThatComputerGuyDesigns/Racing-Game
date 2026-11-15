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
4. **Core loop.** Instant restart (R), quick race / hot lap, weather, tyre/fuel strategy (next).
5. **Career.** Open-world paddock hub connecting circuits, rivalries, development tree (planned).

## Art direction
Stylized-realistic: physically-based materials and lighting over procedural geometry. Readable silhouettes,
clean HUD, no licensed assets.
