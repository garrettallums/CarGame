/** Handling and durability values. Every field is exposed in the tuning panel. */
export interface VehicleConfig {
  /** kg */
  mass: number;
  /** Peak engine force in newtons. */
  enginePower: number;
  /** m/s */
  maxSpeed: number;
  /** m/s */
  reverseSpeed: number;
  /** Target yaw rate at full lock, rad/s. */
  steerRate: number;
  /** How much steering shrinks toward top speed (0 = none). */
  steerFalloff: number;
  /** Lateral velocity cancelled per second (higher = grippier). */
  grip: number;
  /** Rear grip while the handbrake is held. */
  handbrakeGrip: number;
  /** How quickly grip returns after releasing the handbrake, 1/s. */
  driftRecovery: number;
  /** Extra forward force while boosting, newtons. */
  boostForce: number;
  /** Seconds of boost when full. */
  boostCapacity: number;
  /** Seconds of boost regained per second. */
  boostRecharge: number;
  /** Fraction of damage absorbed per zone, 0..0.95. */
  armorFront: number;
  armorRear: number;
  armorSide: number;
  /** Total hit points. Each zone holds a share of this. */
  integrity: number;
  damageMultiplier: number;
  /** Scales how deep dents go. */
  deformStrength: number;
}

/** Visual and collision shape. Not tuned live. */
export interface VehicleShape {
  length: number;
  width: number;
  /** Height of the main body block. */
  height: number;
  cabinLength: number;
  cabinHeight: number;
  /** Offset of the cabin toward the rear (positive = rearward). */
  cabinOffset: number;
  wheelRadius: number;
  wheelWidth: number;
  color: number;
  trimColor: number;
  rollCage: boolean;
  /** Truck-style flatbed behind the cabin. */
  bed: boolean;
}

export interface VehicleDefinition {
  id: string;
  name: string;
  config: VehicleConfig;
  shape: VehicleShape;
}

export const PLAYER_CAR: VehicleDefinition = {
  id: 'player',
  name: 'Rust Runner',
  config: {
    mass: 1200,
    enginePower: 17000,
    maxSpeed: 38,
    reverseSpeed: 12,
    steerRate: 2.5,
    steerFalloff: 0.55,
    grip: 9,
    handbrakeGrip: 1.0,
    driftRecovery: 2.5,
    boostForce: 13000,
    boostCapacity: 2.5,
    boostRecharge: 0.35,
    armorFront: 0.3,
    armorRear: 0.15,
    armorSide: 0.1,
    integrity: 120,
    damageMultiplier: 1,
    deformStrength: 1,
  },
  shape: {
    length: 4.4,
    width: 2.1,
    height: 0.7,
    cabinLength: 1.9,
    cabinHeight: 0.55,
    cabinOffset: 0.35,
    wheelRadius: 0.45,
    wheelWidth: 0.4,
    color: 0xa8402a,
    trimColor: 0x2b2420,
    rollCage: true,
    bed: false,
  },
};

const dummyBase: Omit<VehicleConfig, 'mass' | 'enginePower' | 'maxSpeed' | 'integrity'> = {
  reverseSpeed: 8,
  steerRate: 1.8,
  steerFalloff: 0.4,
  grip: 8,
  handbrakeGrip: 1,
  driftRecovery: 2,
  boostForce: 0,
  boostCapacity: 0,
  boostRecharge: 0,
  armorFront: 0.1,
  armorRear: 0.05,
  armorSide: 0.05,
  damageMultiplier: 1.2,
  deformStrength: 1.2,
};

export const DUMMY_BUGGY: VehicleDefinition = {
  id: 'buggy',
  name: 'Light Buggy',
  config: { ...dummyBase, mass: 700, enginePower: 9000, maxSpeed: 22, integrity: 60, steerRate: 2.2 },
  shape: {
    length: 3.4,
    width: 1.8,
    height: 0.5,
    cabinLength: 1.4,
    cabinHeight: 0.0,
    cabinOffset: 0.2,
    wheelRadius: 0.48,
    wheelWidth: 0.38,
    color: 0xc9a227,
    trimColor: 0x3a3226,
    rollCage: true,
    bed: false,
  },
};

export const DUMMY_SEDAN: VehicleDefinition = {
  id: 'sedan',
  name: 'Mid Sedan',
  config: { ...dummyBase, mass: 1300, enginePower: 11000, maxSpeed: 18, integrity: 100 },
  shape: {
    length: 4.6,
    width: 2.0,
    height: 0.65,
    cabinLength: 2.2,
    cabinHeight: 0.6,
    cabinOffset: 0.2,
    wheelRadius: 0.4,
    wheelWidth: 0.34,
    color: 0x5b7a8c,
    trimColor: 0x262626,
    rollCage: false,
    bed: false,
  },
};

export const DUMMY_TRUCK: VehicleDefinition = {
  id: 'truck',
  name: 'Heavy Truck',
  config: {
    ...dummyBase,
    mass: 3200,
    enginePower: 26000,
    maxSpeed: 14,
    integrity: 220,
    armorFront: 0.35,
    armorSide: 0.2,
    steerRate: 1.2,
    damageMultiplier: 0.9,
    deformStrength: 0.8,
  },
  shape: {
    length: 6.6,
    width: 2.6,
    height: 0.9,
    cabinLength: 2.0,
    cabinHeight: 0.9,
    cabinOffset: -1.9,
    wheelRadius: 0.6,
    wheelWidth: 0.5,
    color: 0x6e5a3e,
    trimColor: 0x1e1c1a,
    rollCage: false,
    bed: true,
  },
};

export const VEHICLE_DEFINITIONS = [PLAYER_CAR, DUMMY_BUGGY, DUMMY_SEDAN, DUMMY_TRUCK];
