# Sand & Steel

Top-down desert vehicular combat built around short runs. Deploy from the garage onto Rust Ridge, wreck cars (the Hauler is worth the most) and finish objectives to earn Parts, then reach the extraction beacon to keep them. Get wrecked first and the run's Parts are lost. Spend Parts in the garage on upgrades that show up on the car. See [docs/VISION.md](docs/VISION.md).

TypeScript + Vite + Three.js + Rapier. Static site, installable as a PWA.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN for phone testing)
npm run build      # typecheck + production build into dist/
npm run test:smoke # needs a build; plays garage → run → extract → wreck headlessly
npm run build:artifact # single self-contained HTML file for a claude.ai Artifact
```

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive / steer | WASD or arrows | LS steer, RT gas, LT brake | Drag on the left half |
| Drift (handbrake) | Space | A | DRIFT |
| Boost | Shift | B | BOOST |
| Flip car upright | R | Y | ↻ |
| Pause | Esc | Start | II |
| Tuning panel | ` (backtick) | Back | ⚙ |
| Camera follow / rotate | C | | Tuning → Options |
| FPS + collider debug | F3 | | Tuning → Options |

Touch has a second layout (steer stick + GAS/BRAKE buttons) under Tuning → Options.

## Layout

```
src/game     Round (timer, objectives, Parts at risk, extraction), Progress (save data)
src/core     loop (fixed 60 Hz physics, interpolated render), event bus, physics setup, Game wiring
src/vehicle  VehicleController, DamageModel, DeformableMesh, VehicleFactory, Vehicle, WaypointDriver
src/input    InputManager + Keyboard, Gamepad, TouchControls adapters
src/camera   CameraRig
src/world    Terrain (heightfield + roads), Statics, Destructibles, World layout
src/fx       particles, tire tracks, debris, effects manager
src/ui       HUD, run HUD, garage, results, tuning panel, pause menu, debug overlay
src/audio    synthesized Web Audio placeholder sound
src/config   every tunable number as typed data (vehicles, upgrades, run rules, rewards)
```

Design decisions and tradeoffs are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Deploy

Connect the repo to Vercel; the Vite preset needs no configuration (build `npm run build`, output `dist`).
