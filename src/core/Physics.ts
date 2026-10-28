import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

/** Collision groups: 16-bit membership << 16 | 16-bit filter. */
export const GROUP = {
  terrain: 1 << 0,
  static: 1 << 1,
  vehicle: 1 << 2,
  prop: 1 << 3,
  debris: 1 << 4,
} as const;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

const ALL = 0xffff;
export const COLLISION = {
  terrain: groups(GROUP.terrain, ALL),
  static: groups(GROUP.static, ALL),
  vehicle: groups(GROUP.vehicle, ALL),
  prop: groups(GROUP.prop, ALL),
  // Small debris does not push cars around; it only rests on the ground and props.
  debris: groups(GROUP.debris, GROUP.terrain | GROUP.static | GROUP.prop | GROUP.debris),
  /** Suspension rays hit ground, static props and other vehicles, not debris. */
  suspensionRay: groups(ALL, GROUP.terrain | GROUP.static | GROUP.vehicle),
};

export async function initPhysics(): Promise<Rapier> {
  await RAPIER.init();
  return RAPIER;
}
