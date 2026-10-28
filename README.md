# Sand & Steel

Top-down desert driving and crash sandbox. Phase 1 of the plan in [docs/VISION.md](docs/VISION.md): driving, camera, terrain, deformation damage, destructibles, touch controls and a live tuning panel.

TypeScript + Vite + Three.js + Rapier. Static site, installable as a PWA.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN for phone testing)
npm run build      # typecheck + production build into dist/
npm run test:smoke # needs a build; drives the game headlessly with Playwright
```

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive / steer | WASD or arrows | LS steer, RT gas, LT brake | Drag on the left half |
| Drift (handbrake) | Space | A | DRIFT |
| Boost | Shift | B | BOOST |
| Repair & reset car | R | Y | ↻ |
| Respawn dummies & props | T | X | Pause menu |
| Pause | Esc | Start | II |
| Tuning panel | ` (backtick) | Back | ⚙ |
| Camera follow / rotate | C | | Tuning → Options |
| FPS + collider debug | F3 | | Tuning → Options |

Touch has a second layout (steer stick + GAS/BRAKE buttons) under Tuning → Options.

## Layout

```
src/core     loop (fixed 60 Hz physics, interpolated render), event bus, physics setup, Game wiring
src/vehicle  VehicleController, DamageModel, DeformableMesh, VehicleFactory, Vehicle, WaypointDriver
src/input    InputManager + Keyboard, Gamepad, TouchControls adapters
src/camera   CameraRig
src/world    Terrain (heightfield + roads), Statics, Destructibles, World layout
src/fx       particles, tire tracks, debris, effects manager
src/ui       HUD, tuning panel, pause menu, debug overlay
src/audio    synthesized Web Audio placeholder sound
src/config   every tunable number as typed data
```

Design decisions and tradeoffs are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Deploy

Connect the repo to Vercel; the Vite preset needs no configuration (build `npm run build`, output `dist`).
