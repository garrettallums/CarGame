import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Rapier } from './Physics';
import type { Terrain } from '../world/Terrain';
import type { DebrisSystem } from '../fx/Debris';

/** Shared services handed to entities when they are built. */
export interface GameContext {
  R: Rapier;
  world: RAPIER.World;
  scene: THREE.Scene;
  terrain: Terrain;
  debris: DebrisSystem;
}
