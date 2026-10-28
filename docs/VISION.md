# SAND & STEEL — Vision

## The game

SAND & STEEL is a top-down vehicular destruction game set in a desert wasteland. You drive a scrap-built car, smash rivals until they visibly fall apart, salvage the wrecks, and upgrade your car to survive harder regions. Influences: the scavenging and convoys of Mad Max, the top-down readability of Micro Machines and Death Rally, and the satisfying crashes of Wreckfest. These are references for feel, not things to copy.

## Pillars

1. **Driving feels great first.** Responsive, arcade, drifty. Nothing else matters if driving isn't fun.
2. **Crashes leave marks.** Every hit dents metal, knocks off parts, and changes how the car handles. Wrecks stay in the world.
3. **Readable chaos.** Even mid-explosion on a phone screen, you can see your car, the enemies, and what's ahead.
4. **Plays anywhere.** Touch-first on iPhone and iPad, equally good with keyboard or controller.

## Core loop

Explore → encounter → fight or race → wreck → salvage → upgrade → explore further.
Sessions should work in 5 minutes on a phone or in a longer run at a desk.

## Roadmap

Start each phase only when the previous one is playable and feels good.

1. **Driving and crash sandbox** — driving, camera, terrain, deformation damage, destructibles, touch controls, tuning panel.
2. **Combat and AI** — weapons, aiming, enemy driving AI, first enemy archetypes.
3. **Gameplay loop** — missions ("destroy three raiders"), win and lose, salvage pickup, repairs, simple save.
4. **Garage and upgrades** — install parts with visible tradeoffs; parts appear on the car.
5. **World and events** — more regions, convoys, races, factions, light exploration progression.
6. **Release** — polish, real audio, App Store build via Capacitor, optional Steam build via Tauri or Electron.

## Combat (Phase 2+)

- Weapons turret-mounted and aimed independently of driving. Touch: right virtual stick aims and auto-fires. Desktop: mouse aim and click.
- Machine gun: fast, light damage, limited ammo.
- Shotgun: short range, wide spread, big close-range burst.
- Explosives: slow projectile, area damage, strong knockback, breaks structures.
- Each weapon defined as data: damage, fire rate, range, ammo, reload, projectile speed, recoil impulse.
- Ramming stays a first-class attack: push enemies into rocks, off ledges, or through fences.

## Enemy AI (Phase 2+)

A state machine: patrol, detect, pursue, attack, ram, avoid obstacles, retreat when badly damaged, destroyed. AI drives through the same `VehicleController` as the player, so it obeys momentum and steering limits and can't turn on the spot.

- **Raider buggy** — light, fast, fragile, flanks.
- **Rammer** — heavy front armor, charges head-on.
- **Gun truck** — keeps distance and shoots.
- **Convoy hauler** — slow, heavily armored, escorted.

## Upgrades (Phase 4)

Every part trades something. Heavy armor survives longer but accelerates and turns worse.

| Category   | Improves                                 | Typical cost               |
| ---------- | ---------------------------------------- | -------------------------- |
| Engine     | Acceleration, top speed, boost           | Fuel use, heat             |
| Armor      | Zone integrity, impact resistance        | Weight, handling           |
| Tires      | Grip, off-road traction, drift control   | Top speed or drift freedom |
| Suspension | Stability on dunes and jumps             | Responsiveness             |
| Ram gear   | Collision damage dealt, front armor      | Weight                     |
| Weapons    | Firepower, ammo, mount slots             | Weight, salvage            |
| Utility    | Salvage magnet, radar, fuel capacity     | Mount slots                |

Resources: scrap, mechanical parts, fuel, ammo, rare components.

## Events (Phase 5)

- **Wasteland sprint** — point-to-point race through dunes and obstacles.
- **Death circuit** — closed track with weapons allowed.
- **Convoy ambush** — wreck the cargo hauler before it escapes.
- **Scrap derby** — survive an arena brawl.
- **Supply run** — carry cargo through hostile ground.
- **Hunter pursuit** — escape escalating pursuers.

All events reuse the same driving, damage, and AI systems.

## Art direction

Flat-shaded low-poly with a warm palette: orange and tan sand, rust, bleached metal, dark shadows. Long dust trails, tire tracks, sparse scrub, rusted pipelines, scrap structures, ruined settlements. Cars are told apart by silhouette, size, and color from above. Effects are big but never hide the player's car. The polished concept renders are mood references, not the target fidelity.

## UI

Minimal and out of the way: speed, damage silhouette, boost, ammo, small radar, current objective. Muted colors; critical warnings (engine failing, on fire) stand out. Touch controls are translucent and stay clear of the action.

## Sound

Sound sells weight: engine pitch with speed, tire skids, sand and gravel crunch, metal impacts scaled by force, explosions, breaking wood, rattling debris, desert wind. Synthesized placeholders until real assets exist.

## Platforms

Web first (PWA on iPhone, iPad, and desktop), deployed on Vercel. Native wrappers later: Capacitor for the App Store, Tauri or Electron for Steam. Single-player and offline; no backend planned.
