import * as THREE from 'three';
import type { Vehicle } from './Vehicle';
import { clamp } from '../core/math';

const _f = new THREE.Vector3();

/**
 * Drives a vehicle around a loop of waypoints through the same input
 * interface the player uses, so it obeys momentum and steering limits.
 */
export class WaypointDriver {
  private index = 0;
  private stuckTime = 0;
  private reverseTime = 0;

  constructor(
    readonly vehicle: Vehicle,
    readonly points: THREE.Vector3[],
    readonly targetSpeed: number,
  ) {}

  reset(): void {
    this.index = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
  }

  update(dt: number): void {
    const v = this.vehicle;
    const input = v.input;
    if (v.wrecked || this.points.length === 0) {
      input.throttle = 0;
      input.brake = 0;
      input.steer = 0;
      return;
    }
    const pos = v.interp.pos;
    let target = this.points[this.index];
    if (Math.hypot(target.x - pos.x, target.z - pos.z) < 9) {
      this.index = (this.index + 1) % this.points.length;
      target = this.points[this.index];
    }
    _f.set(0, 0, 1).applyQuaternion(v.interp.rot);
    const heading = Math.atan2(_f.x, _f.z);
    const desired = Math.atan2(target.x - pos.x, target.z - pos.z);
    let err = desired - heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    // err > 0 means the target is to the car's left; steer is +1 = right.
    const speed = v.controller.forwardSpeed;

    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      input.throttle = 0;
      input.brake = 1;
      input.steer = clamp(err * 2, -1, 1);
      return;
    }
    if (Math.abs(speed) < 1.5) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 2.5) {
      this.stuckTime = 0;
      this.reverseTime = 1.5;
    }

    input.steer = clamp(-err * 2, -1, 1);
    const want = this.targetSpeed * (1 - clamp(Math.abs(err) / Math.PI, 0, 0.7));
    input.throttle = speed < want ? clamp((want - speed) * 0.4 + 0.3, 0, 1) : 0;
    input.brake = speed > want + 3 ? 0.4 : 0;
    input.handbrake = false;
    input.boost = false;
  }
}
