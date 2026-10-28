import type { VehicleConfig } from './vehicles';

export type UpgradeId = 'engine' | 'armor' | 'tires' | 'ram' | 'boost';
export type ConfigDelta = Partial<Record<keyof VehicleConfig, number>>;

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** What it improves, in a few words. */
  improves: string;
  /** What it costs you besides Parts. */
  tradeoff: string;
  /** One entry per level; deltas add on top of the previous levels. */
  levels: { cost: number; delta: ConfigDelta }[];
}

/** Every part trades something: heavier parts accelerate and turn worse. */
export const UPGRADES: UpgradeDef[] = [
  {
    id: 'engine',
    name: 'Engine',
    improves: 'Acceleration and top speed',
    tradeoff: 'Adds weight',
    levels: [
      { cost: 60, delta: { enginePower: 3000, maxSpeed: 2.5, mass: 40 } },
      { cost: 130, delta: { enginePower: 3500, maxSpeed: 2.5, mass: 50 } },
      { cost: 240, delta: { enginePower: 4500, maxSpeed: 3, mass: 60 } },
    ],
  },
  {
    id: 'armor',
    name: 'Armor plating',
    improves: 'Integrity and impact resistance',
    tradeoff: 'Heavy: slower to turn and accelerate',
    levels: [
      { cost: 50, delta: { integrity: 30, armorFront: 0.06, armorRear: 0.08, armorSide: 0.1, mass: 120, steerRate: -0.08 } },
      { cost: 120, delta: { integrity: 35, armorFront: 0.06, armorRear: 0.08, armorSide: 0.1, mass: 140, steerRate: -0.08 } },
      { cost: 220, delta: { integrity: 40, armorFront: 0.06, armorRear: 0.08, armorSide: 0.1, mass: 160, steerRate: -0.1 } },
    ],
  },
  {
    id: 'tires',
    name: 'Tires',
    improves: 'Grip and sharper steering',
    tradeoff: 'Lower top speed, harder to slide',
    levels: [
      { cost: 45, delta: { grip: 1.2, steerRate: 0.15, maxSpeed: -1, handbrakeGrip: 0.15 } },
      { cost: 100, delta: { grip: 1.3, steerRate: 0.15, maxSpeed: -1, handbrakeGrip: 0.15 } },
      { cost: 190, delta: { grip: 1.5, steerRate: 0.2, maxSpeed: -1.5, handbrakeGrip: 0.2 } },
    ],
  },
  {
    id: 'ram',
    name: 'Ram bar',
    improves: 'Damage dealt head-on and front armor',
    tradeoff: 'Adds weight up front',
    levels: [
      { cost: 70, delta: { ramPower: 0.35, armorFront: 0.08, mass: 80 } },
      { cost: 150, delta: { ramPower: 0.4, armorFront: 0.08, mass: 90 } },
      { cost: 260, delta: { ramPower: 0.5, armorFront: 0.1, mass: 110 } },
    ],
  },
  {
    id: 'boost',
    name: 'Boost tank',
    improves: 'Boost duration, recharge and kick',
    tradeoff: 'A little weight',
    levels: [
      { cost: 50, delta: { boostCapacity: 0.8, boostRecharge: 0.08, boostForce: 1500, mass: 20 } },
      { cost: 110, delta: { boostCapacity: 0.8, boostRecharge: 0.1, boostForce: 2000, mass: 25 } },
      { cost: 200, delta: { boostCapacity: 1, boostRecharge: 0.12, boostForce: 2500, mass: 30 } },
    ],
  },
];

export type UpgradeLevels = Record<UpgradeId, number>;

export const emptyUpgrades = (): UpgradeLevels => ({ engine: 0, armor: 0, tires: 0, ram: 0, boost: 0 });

/** Paint jobs offered in the garage. Free; they only change looks. */
export const PAINTS: { name: string; color: number }[] = [
  { name: 'Rust', color: 0xa8402a },
  { name: 'Desert tan', color: 0xb9925a },
  { name: 'Bleached', color: 0xcfc6b4 },
  { name: 'Army', color: 0x5d6a3f },
  { name: 'Oil black', color: 0x2f2a27 },
  { name: 'Signal yellow', color: 0xd6a127 },
  { name: 'Sea glass', color: 0x4f8a8b },
];

/** Base config plus every purchased level. */
export function applyUpgrades(base: VehicleConfig, levels: UpgradeLevels): VehicleConfig {
  const out = { ...base };
  for (const up of UPGRADES) {
    const n = Math.min(levels[up.id] ?? 0, up.levels.length);
    for (let i = 0; i < n; i++) {
      for (const [k, v] of Object.entries(up.levels[i].delta)) {
        const key = k as keyof VehicleConfig;
        out[key] += v as number;
      }
    }
  }
  out.armorFront = Math.min(0.9, out.armorFront);
  out.armorRear = Math.min(0.9, out.armorRear);
  out.armorSide = Math.min(0.9, out.armorSide);
  return out;
}
