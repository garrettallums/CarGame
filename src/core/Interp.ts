import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/** Stores the previous and current physics pose of a body for render interpolation. */
export class InterpPose {
  readonly prevPos = new THREE.Vector3();
  readonly prevRot = new THREE.Quaternion();
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Quaternion();

  /** Call after teleporting so the body does not smear across the map. */
  snap(body: RAPIER.RigidBody): void {
    this.capture(body);
    this.prevPos.copy(this.pos);
    this.prevRot.copy(this.rot);
  }

  /** Call once after every physics step. */
  capture(body: RAPIER.RigidBody): void {
    this.prevPos.copy(this.pos);
    this.prevRot.copy(this.rot);
    const t = body.translation();
    const r = body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.rot.set(r.x, r.y, r.z, r.w);
  }

  apply(obj: THREE.Object3D, alpha: number): void {
    obj.position.lerpVectors(this.prevPos, this.pos, alpha);
    obj.quaternion.slerpQuaternions(this.prevRot, this.rot, alpha);
  }

  toMatrix(out: THREE.Matrix4, alpha: number, scale = ONE): THREE.Matrix4 {
    _p.lerpVectors(this.prevPos, this.pos, alpha);
    _q.slerpQuaternions(this.prevRot, this.rot, alpha);
    return out.compose(_p, _q, scale);
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
