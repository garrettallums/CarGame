# Decisions and tradeoffs

Notable choices made while building Phase 1, newest at the bottom.

## Dependencies

- Runtime: `three` and `@dimforge/rapier3d-compat` only, as specified. The compat build inlines the WASM as base64, which adds roughly 1 MB to the JS bundle (about 1 MB gzipped total) but needs no special WASM serving on Vercel or iOS.
- `three/examples/jsm/utils/BufferGeometryUtils` (ships with three) is used to merge static geometry.
- Dev only: `typescript`, `vite`, `@types/three`. The smoke test uses the Playwright that is preinstalled in the build environment instead of adding it as a dependency.

## Physics

- **One rigid body per car with four suspension raycasts.** The spec asks for arcade forces rather than a wheel simulation. Raycast springs at the four corners give pitch and roll over dunes and on landings for free, while the driving forces (engine, grip, steering, drag, boost) are applied to the single body. The rays are suspension only; no tire model.
- **Steering is a target yaw rate**, approached each step by editing the yaw component of angular velocity. This keeps turning predictable and makes it independent of mass and inertia. Pitch and roll are left to the springs and the self-righting torque.
- **Drift = rear grip drop.** The handbrake lowers lateral grip to `handbrakeGrip` quickly and it eases back at `driftRecovery`. A `handbrakeYawBoost` multiplier kicks the yaw rate while the handbrake is held so drifts start easily.
- **Gravity is 16 m/s²**, not 9.81. Real gravity felt floaty from a top-down view. Tunable in the panel.
- **Centre of mass is lowered and inertia inflated** in `Vehicle.applyMass()` so cars rarely roll in normal driving. Rolls still happen in big crashes; after 3 s upside-down the car is put back on its wheels.
- **Heightfield layout** was verified empirically: Rapier stores heights as `heights[row + col * (nrows + 1)]`, rows along Z and columns along X.

## Damage

- **Closing speed uses velocities from before the physics step.** Rapier resolves contacts inside `world.step()`, so post-step velocities are already separated. Every vehicle and prop snapshots its velocity just before stepping; contact force events then look up the contact manifold and compute relative velocity along the normal at the contact point.
- Damage formula: `(closingSpeed − minImpactSpeed) × otherMass/(selfMass + otherMass) × damageMultiplier × damageScale × (1 − zoneArmor)`. Static objects count as mass ratio 1. Terrain hits use a higher speed threshold and 0.6× ratio so hard landings don't shred the car.
- **Zones**: each zone holds `zoneShare × integrity`; overall integrity is separate. Bumpers fall off at 50% zone health, other panels when the zone breaks, so damage reads progressively. A broken side zone also loses that side's front wheel, which drags the car toward it.
- A per-pair 0.25 s cooldown stops one crash from being counted on several consecutive steps.
- **Dents** move vertices of segmented box parts (~0.3 m spacing) with a smooth falloff and a stable per-position crumple noise, so duplicated seam vertices stay welded. Depth is clamped per hit and in total. Flat shading uses `flatShading: true` on Lambert materials; normals are still recomputed after each dent.
- Detached panels copy their dented geometry into a pooled debris body (24 slots, recycled oldest-first) and fade out after `debrisLifetime`. Prop debris (planks, shards, scrap) is instanced and shrinks away.

## World and props

- Destructibles are **light dynamic bodies that start asleep**, not static colliders. A car hitting a static fence would stop dead before the fence could break; a 60 kg dynamic fence only takes a little speed off the car. Barricades are 900 kg so they genuinely resist.
- Explosions are queued and processed after contacts, with a small delay for chain reactions. Bodies get a velocity change scaled by `2·1000/(1000 + mass)`, so barrels fly far and trucks only get shoved.
- Each prop type is one `InstancedMesh`; all static rocks, the building and the tanker are merged into one vertex-coloured mesh. Cars are individual meshes because each has its own deformable geometry.
- The road is a separate ribbon mesh draped on the heightfield (terrain is flattened under it) rather than painted into terrain vertex colours, which would be blurry at 3 m cell size.

## Camera, input, UI

- North-up means "+Z is up the screen" (camera sits on the −Z side). `rotateWithCar` is a 0/1 value so it can live in the same tuning data as the other camera numbers.
- Input sources (keyboard, gamepad, touch) each fill an analog state; the manager takes the strongest value per action. One-shot actions (`reset`, `pause`, `toggleTuning`, `respawnWorld`, …) are edge-triggered and consumed once per frame. Fire and aim are not defined yet.
- Touch uses Pointer Events with pointer capture for multi-touch. The stick floats: it appears where the left thumb lands and follows the thumb if it drags past the rim. The lower-right corner is deliberately empty for the Phase 2 aim stick.
- Tuning values persist in `localStorage` (`sas.tuning.v1`); all storage access is wrapped so private mode still works.
- The service worker is network-first so new Vercel deploys are picked up immediately; the cache only matters offline.

## Performance

- Device pixel ratio capped at 2; MSAA is only enabled when DPR < 2 (Retina phones get enough smoothing from pixel density).
- One shadow-casting directional light with a 1024² map that follows the player, snapped to shadow texels to avoid shimmering.
- Particles are four `THREE.Points` systems (dust, smoke, fire, sparks) with fixed capacity. Tire tracks are one ring-buffer mesh of 1800 quads that fade in the shader.
- Draw calls at spawn are roughly 100 (mostly the six cars' parts and their shadows). Not yet measured on a real iPhone; the in-game FPS counter (F3 or Tuning → Show FPS) shows draw calls too.

## Process

- The modules were written in one pass rather than in the step-by-step order the build prompt suggests, then verified together with the Playwright smoke test (`npm run test:smoke`). History therefore starts with one large commit instead of one commit per step.
