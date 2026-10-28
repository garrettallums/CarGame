import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../config/vehicles';
import { PHYSICS } from '../config/physics';
import { SURFACES, type SurfaceId } from '../config/surfaces';
import { COLLISION, type Rapier } from '../core/Physics';
import { clamp, damp } from '../core/math';

/** Abstract driving input, shared by player, dummies and future AI. */
export interface VehicleInput {
  /** 0..1 */
  throttle: number;
  /** 0..1, brakes then reverses. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

export const emptyInput = (): VehicleInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false });

export interface WheelState {
  /** Ray origin in vehicle space. */
  local: THREE.Vector3;
  front: boolean;
  /** -1 left, 1 right (in vehicle space). */
  side: number;
  radius: number;
  grounded: boolean;
  /** Distance from ray origin to wheel centre. */
  extension: number;
  contact: THREE.Vector3;
  normal: THREE.Vector3;
  surface: SurfaceId;
  lost: boolean;
  spin: number;
}

export interface SurfaceSampler {
  surfaceAt(x: number, z: number): SurfaceId;
}

const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _o = new THREE.Vector3();
const _r = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Arcade vehicle model on a single rigid body: four suspension rays hold the
 * body up, then engine, grip, steering, drag and boost are applied as forces.
 */
export class VehicleController {
  readonly wheels: WheelState[] = [];
  boost: number;
  boosting = false;
  /** Current rear grip, eases between handbrakeGrip and grip. */
  rearGrip: number;
  forwardSpeed = 0;
  lateralSpeed = 0;
  speed = 0;
  /** 0..1 how much the car is sliding. */
  slip = 0;
  grounded = 0;
  surface: SurfaceId = 'sand';
  flippedTime = 0;
  /** Multiplier from front damage. */
  engineFactor = 1;
  /** Yaw rate added by a missing wheel, rad/s. */
  steerPull = 0;
  /** Smoothed steering for wheel visuals. */
  steerVisual = 0;
  /** Set when the car has been upside-down too long. */
  wantsReset = false;
  disabled = false;
  /** Ignore input and hold still, e.g. during the countdown. */
  frozen = false;
  private surfaceTimer = 0;
  private ray: RAPIER.Ray;

  constructor(
    R: Rapier,
    private body: RAPIER.RigidBody,
    public config: VehicleConfig,
    wheelLocals: { pos: THREE.Vector3; front: boolean; side: number; radius: number }[],
  ) {
    this.boost = config.boostCapacity;
    this.rearGrip = config.grip;
    for (const w of wheelLocals) {
      this.wheels.push({
        local: w.pos.clone(),
        front: w.front,
        side: w.side,
        radius: w.radius,
        grounded: false,
        extension: PHYSICS.suspensionLength,
        contact: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        surface: 'sand',
        lost: false,
        spin: 0,
      });
    }
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  reset(): void {
    this.boost = this.config.boostCapacity;
    this.rearGrip = this.config.grip;
    this.flippedTime = 0;
    this.wantsReset = false;
    this.engineFactor = 1;
    this.steerPull = 0;
    for (const w of this.wheels) w.lost = false;
  }

  step(dt: number, input: VehicleInput, world: RAPIER.World, surfaces: SurfaceSampler): void {
    const body = this.body;
    const cfg = this.config;
    const mass = body.mass();
    const t = body.translation();
    const r = body.rotation();
    _pos.set(t.x, t.y, t.z);
    _q.set(r.x, r.y, r.z, r.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _right.crossVectors(_fwd, _up);
    const lv = body.linvel();
    const av = body.angvel();
    _v.set(lv.x, lv.y, lv.z);
    _w.set(av.x, av.y, av.z);
    const com = body.worldCom();

    // --- Suspension -------------------------------------------------------
    const susLen = PHYSICS.suspensionLength;
    const k = PHYSICS.suspensionStiffness * mass;
    const c = PHYSICS.suspensionDamping * mass;
    let groundedCount = 0;
    for (const wheel of this.wheels) {
      const maxLen = susLen + wheel.radius;
      _o.copy(wheel.local).applyQuaternion(_q).add(_pos);
      this.ray.origin = { x: _o.x, y: _o.y, z: _o.z };
      this.ray.dir = { x: -_up.x, y: -_up.y, z: -_up.z };
      const hit = world.castRayAndGetNormal(
        this.ray,
        maxLen,
        true,
        undefined,
        COLLISION.suspensionRay,
        undefined,
        body,
      );
      // A missing wheel lets that corner sag onto the hub.
      const effectiveLen = wheel.lost ? maxLen * 0.55 : maxLen;
      if (hit && hit.timeOfImpact < effectiveLen) {
        const dist = hit.timeOfImpact;
        const compression = effectiveLen - dist;
        // Velocity of the chassis at the ray origin.
        _r.set(_o.x - com.x, _o.y - com.y, _o.z - com.z);
        _pv.crossVectors(_w, _r).add(_v);
        const along = _pv.dot(_up);
        let f = k * compression - c * along;
        // Bump stop when fully compressed.
        if (compression > susLen * 0.9) f += k * 4 * (compression - susLen * 0.9);
        f = Math.max(0, f);
        _tmp.copy(_up).multiplyScalar(f * dt);
        body.applyImpulseAtPoint({ x: _tmp.x, y: _tmp.y, z: _tmp.z }, { x: _o.x, y: _o.y, z: _o.z }, true);
        wheel.grounded = true;
        wheel.extension = Math.max(wheel.radius * 0.6, dist - wheel.radius);
        wheel.contact.copy(_o).addScaledVector(_up, -dist);
        wheel.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        groundedCount++;
      } else {
        wheel.grounded = false;
        wheel.extension = (wheel.lost ? effectiveLen : maxLen) - wheel.radius;
      }
    }
    this.grounded = groundedCount / this.wheels.length;

    // --- Surface ----------------------------------------------------------
    this.surfaceTimer -= dt;
    if (this.surfaceTimer <= 0) {
      this.surfaceTimer = 0.1;
      this.surface = surfaces.surfaceAt(_pos.x, _pos.z);
      for (const w of this.wheels) w.surface = this.surface;
    }
    const S = SURFACES[this.surface];

    let fs = _v.dot(_fwd);
    const ls = _v.dot(_right);
    this.forwardSpeed = fs;
    this.lateralSpeed = ls;
    this.speed = Math.hypot(fs, ls);
    const g = this.grounded;
    const off = this.disabled || this.frozen;
    const throttle = off ? 0 : clamp(input.throttle, 0, 1);
    const brake = off ? 0 : clamp(input.brake, 0, 1);
    const steer = off ? 0 : clamp(input.steer, -1, 1);
    // Frozen cars (countdown, garage) hold position with the handbrake.
    const handbrake = this.frozen || (!off && input.handbrake);

    // --- Engine, brakes, boost --------------------------------------------
    let force = 0;
    this.boosting = false;
    const wantBoost = !off && input.boost && cfg.boostCapacity > 0;
    if (wantBoost && this.boost > 0) {
      this.boost = Math.max(0, this.boost - dt);
      this.boosting = true;
    } else if (!input.boost) {
      this.boost = Math.min(cfg.boostCapacity, this.boost + cfg.boostRecharge * dt);
    }
    const topSpeed = cfg.maxSpeed * (this.boosting ? 1.35 : 1);
    if (g > 0) {
      const traction = S.traction * g * this.engineFactor;
      if (throttle > 0) {
        if (fs < -1) {
          force += throttle * mass * 16;
        } else {
          const ratio = clamp(fs / topSpeed, 0, 1);
          force += throttle * cfg.enginePower * traction * (1 - ratio * ratio);
        }
      }
      if (brake > 0) {
        if (fs > 1) {
          force -= brake * mass * 18 * g;
        } else {
          const ratio = clamp(-fs / Math.max(1, cfg.reverseSpeed), 0, 1);
          force -= brake * cfg.enginePower * 0.6 * traction * (1 - ratio * ratio);
        }
      }
      if (this.boosting) {
        const ratio = clamp(fs / topSpeed, 0, 1);
        force += cfg.boostForce * g * (1 - ratio * ratio);
      }
      if (handbrake) force -= Math.sign(fs) * Math.min(Math.abs(fs) / dt, 4) * mass * g;

      // Rolling resistance on the forward axis.
      const roll = Math.min(Math.abs(fs) / dt, S.rolling) * mass * g;
      if (throttle === 0 || fs < 0) force -= Math.sign(fs) * roll;
      else force -= Math.sign(fs) * roll * 0.5;
    }
    // Air drag applies always.
    const drag = PHYSICS.airDrag * S.drag * this.speed * this.speed * mass;
    if (this.speed > 0.01) {
      _tmp.set(_v.x, 0, _v.z).normalize().multiplyScalar(-drag * dt);
      body.applyImpulse({ x: _tmp.x, y: 0, z: _tmp.z }, true);
    }
    if (force !== 0) {
      _tmp.copy(_fwd).multiplyScalar(force * dt);
      body.applyImpulse({ x: _tmp.x, y: _tmp.y, z: _tmp.z }, true);
    }

    // --- Lateral grip -----------------------------------------------------
    const gripRate = damp(handbrake ? 14 : cfg.driftRecovery, dt);
    this.rearGrip += ((handbrake ? cfg.handbrakeGrip : cfg.grip) - this.rearGrip) * gripRate;
    if (g > 0) {
      const cancel = damp(this.rearGrip * S.grip, dt) * g;
      _tmp.copy(_right).multiplyScalar(-ls * mass * cancel);
      body.applyImpulse({ x: _tmp.x, y: _tmp.y, z: _tmp.z }, true);
    }
    const slipRaw = Math.abs(ls) / Math.max(5, this.speed);
    this.slip = clamp(slipRaw * 1.6 + (handbrake && this.speed > 4 ? 0.4 : 0), 0, 1) * (g > 0 ? 1 : 0);

    // --- Steering ---------------------------------------------------------
    fs = _v.dot(_fwd);
    const dir = fs > -0.5 ? 1 : -1;
    const speedAbs = Math.abs(fs);
    const lowSpeed = clamp(speedAbs / 4, 0, 1);
    const falloff = 1 - clamp(cfg.steerFalloff, 0, 0.95) * clamp(speedAbs / cfg.maxSpeed, 0, 1);
    const hb = handbrake ? PHYSICS.handbrakeYawBoost : 1;
    // Positive yaw about +Y turns the car toward its left, so negate steer.
    const targetYaw = -steer * cfg.steerRate * falloff * lowSpeed * dir * hb + this.steerPull * lowSpeed;
    const yawRate = _w.dot(_up);
    const authority = g > 0 ? 1 : PHYSICS.airControl;
    const dYaw = (targetYaw - yawRate) * damp(10, dt) * authority;
    _w.addScaledVector(_up, dYaw);
    this.steerVisual += (steer - this.steerVisual) * damp(12, dt);

    // --- Self-righting ----------------------------------------------------
    _tmp.crossVectors(_up, WORLD_UP);
    const upright = g > 0 ? 0.35 : 1;
    _w.addScaledVector(_tmp, PHYSICS.selfRighting * dt * upright);
    // Damp pitch and roll but leave yaw to the steering.
    const yawPart = _w.dot(_up);
    _r.copy(_w).addScaledVector(_up, -yawPart);
    _w.addScaledVector(_r, -damp(PHYSICS.uprightDamping, dt));
    body.setAngvel({ x: _w.x, y: _w.y, z: _w.z }, true);

    // --- Flip detection ---------------------------------------------------
    if (_up.y < 0.25 && this.speed < 6) this.flippedTime += dt;
    else this.flippedTime = 0;
    if (this.flippedTime > PHYSICS.flipResetTime) {
      this.flippedTime = 0;
      this.wantsReset = true;
    }

    for (const wheel of this.wheels) wheel.spin += (fs * dt) / wheel.radius;
  }
}
