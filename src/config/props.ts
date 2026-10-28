export type DebrisKind = 'plank' | 'shard' | 'scrap';

export interface ExplosionConfig {
  radius: number;
  /** Velocity change applied to a reference-mass body at the centre, m/s. */
  speed: number;
  /** Damage dealt to vehicles at the centre. */
  damage: number;
}

export interface DestructibleConfig {
  id: string;
  mass: number;
  /** Damage points before it breaks. */
  health: number;
  /** Hits weaker than this are ignored. */
  breakThreshold: number;
  debris: DebrisKind;
  debrisCount: number;
  explosion: ExplosionConfig | null;
}

export const DESTRUCTIBLES = {
  fence: { id: 'fence', mass: 60, health: 4, breakThreshold: 2, debris: 'plank', debrisCount: 6, explosion: null },
  sign: { id: 'sign', mass: 30, health: 2, breakThreshold: 1.2, debris: 'plank', debrisCount: 3, explosion: null },
  barrel: { id: 'barrel', mass: 70, health: 6, breakThreshold: 3, debris: 'shard', debrisCount: 5, explosion: null },
  explosiveBarrel: {
    id: 'explosiveBarrel',
    mass: 70,
    health: 3,
    breakThreshold: 2.5,
    debris: 'shard',
    debrisCount: 6,
    explosion: { radius: 10, speed: 14, damage: 45 },
  },
  barricade: { id: 'barricade', mass: 900, health: 30, breakThreshold: 6, debris: 'scrap', debrisCount: 8, explosion: null },
} satisfies Record<string, DestructibleConfig>;

export type DestructibleType = keyof typeof DESTRUCTIBLES;

export const DEBRIS = {
  /** Small chunk debris lifetime before shrinking away. */
  chunkLifetime: 8,
  maxChunks: 160,
  maxPanels: 24,
};
