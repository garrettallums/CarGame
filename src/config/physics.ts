/** World-level driving physics shared by all vehicles. Exposed in the tuning panel. */
export interface PhysicsConfig {
  gravity: number;
  /** Suspension rest length, metres. */
  suspensionLength: number;
  /** Spring stiffness per kg of vehicle mass. */
  suspensionStiffness: number;
  /** Damper strength per kg of vehicle mass. */
  suspensionDamping: number;
  /** Air drag deceleration coefficient (m/s² per (m/s)²). */
  airDrag: number;
  /** Torque gain that pulls the car upright. */
  selfRighting: number;
  /** Damping of pitch and roll rotation. */
  uprightDamping: number;
  /** Fraction of steering available while airborne. */
  airControl: number;
  /** Extra yaw rate multiplier when the handbrake is pulled. */
  handbrakeYawBoost: number;
  /** Seconds upside-down before an automatic reset. */
  flipResetTime: number;
}

export const PHYSICS: PhysicsConfig = {
  gravity: 16,
  suspensionLength: 0.5,
  suspensionStiffness: 40,
  suspensionDamping: 5,
  airDrag: 0.0035,
  selfRighting: 9,
  uprightDamping: 3,
  airControl: 0.25,
  handbrakeYawBoost: 1.4,
  flipResetTime: 3,
};

export interface DamageSettings {
  /** Closing speed (m/s) below which hits do nothing. */
  minImpactSpeed: number;
  /** Share of total integrity held by each zone. */
  zoneShare: number;
  /** Radius of a dent in metres. */
  dentRadius: number;
  /** Depth of a dent per m/s of closing speed, before deformStrength. */
  dentPerSpeed: number;
  maxDentPerHit: number;
  maxDentDepth: number;
  /** Seconds before detached panels fade away. */
  debrisLifetime: number;
  /** Front-zone health fraction below which the engine smokes. */
  smokeBelow: number;
  /** Overall health fraction below which the car burns. */
  fireBelow: number;
  /** Explosion when a vehicle is wrecked. */
  wreckExplosionRadius: number;
  wreckExplosionSpeed: number;
  /** Global multiplier on all collision damage. */
  damageScale: number;
}

export const DAMAGE: DamageSettings = {
  minImpactSpeed: 3.5,
  zoneShare: 0.35,
  dentRadius: 1.0,
  dentPerSpeed: 0.022,
  maxDentPerHit: 0.35,
  maxDentDepth: 0.5,
  debrisLifetime: 12,
  smokeBelow: 0.4,
  fireBelow: 0.25,
  wreckExplosionRadius: 10,
  wreckExplosionSpeed: 9,
  damageScale: 1.5,
};
