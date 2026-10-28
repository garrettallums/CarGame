import type { DestructibleType } from './props';

/** Timing and rules of a run. Exposed in the tuning panel. */
export const ROUND = {
  /** Seconds of 3-2-1 before the player can drive. */
  countdown: 3,
  /** Seconds into the run before extraction opens. */
  extractUnlock: 75,
  /** Radius of the extraction zone, metres. */
  extractRadius: 9,
  /** Seconds the player must stay inside the zone. */
  extractHold: 3,
  /** Seconds after being wrecked before the results screen. */
  deathDelay: 3,
};

/** Parts paid out when a vehicle is wrecked, by vehicle definition id. */
export const WRECK_REWARDS: Record<string, number> = {
  buggy: 15,
  sedan: 25,
  truck: 40,
  hauler: 60,
};

export type ObjectiveSpec =
  | { kind: 'destroyVehicle'; vehicle: string }
  | { kind: 'wreckCount' }
  | { kind: 'breakProp'; prop: DestructibleType };

export interface ObjectiveDef {
  id: string;
  label: string;
  count: number;
  reward: number;
  spec: ObjectiveSpec;
}

/** Always offered. */
export const MAIN_OBJECTIVE: ObjectiveDef = {
  id: 'hauler',
  label: 'Destroy the Hauler',
  count: 1,
  reward: 80,
  spec: { kind: 'destroyVehicle', vehicle: 'hauler' },
};

/** Two of these are drawn at random each run. */
export const SIDE_OBJECTIVES: ObjectiveDef[] = [
  { id: 'wreck3', label: 'Wreck 3 cars', count: 3, reward: 40, spec: { kind: 'wreckCount' } },
  { id: 'barrels', label: 'Detonate 4 fuel barrels', count: 4, reward: 25, spec: { kind: 'breakProp', prop: 'explosiveBarrel' } },
  { id: 'fences', label: 'Smash 8 fences', count: 8, reward: 20, spec: { kind: 'breakProp', prop: 'fence' } },
  { id: 'checkpoint', label: 'Breach the scrap checkpoint', count: 3, reward: 30, spec: { kind: 'breakProp', prop: 'barricade' } },
  { id: 'signs', label: 'Flatten 4 road signs', count: 4, reward: 15, spec: { kind: 'breakProp', prop: 'sign' } },
];
