import * as THREE from 'three';
import { CAMERA } from '../config/camera';
import { bus } from '../core/EventBus';
import { damp } from '../core/math';

const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();

/** Tilted top-down follow camera with look-ahead, speed zoom and impact shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly config = CAMERA;
  private focus = new THREE.Vector3();
  private zoom = 0;
  private yaw = 0;
  private trauma = 0;
  private time = 0;
  /** 'follow' in a run; 'orbit' circles the car in the garage. */
  mode: 'follow' | 'orbit' = 'follow';
  private orbitAngle = 0.8;
  /** Screen-space shift (px) so the garage car sits beside the panel. */
  private shiftX = 0;
  /** Position the camera follows, set each frame. */
  readonly subject = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0 };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 1, 600);
    bus.on('collision', (e) => {
      if (e.involvesPlayer) this.shake(e.closingSpeed * 0.035);
    });
    bus.on('explosion', (e) => {
      const d = e.position.distanceTo(this.subject.position);
      if (d < e.radius * 4) this.shake(0.9 * (1 - d / (e.radius * 4)));
    });
  }

  shake(amount: number): void {
    this.trauma = Math.min(this.config.maxShake, this.trauma + amount * this.config.shakeScale);
  }

  snap(): void {
    this.focus.copy(this.subject.position);
    this.zoom = 0;
    this.yaw = this.config.rotateWithCar > 0.5 ? this.subject.yaw : 0;
    this.update(0);
  }

  setShift(px: number): void {
    this.shiftX = px;
  }

  private updateOrbit(dt: number): void {
    const s = this.subject;
    this.orbitAngle += dt * 0.22;
    const cam = this.camera;
    cam.fov = 38;
    cam.position.set(s.position.x + Math.sin(this.orbitAngle) * 11.5, s.position.y + 4.4, s.position.z + Math.cos(this.orbitAngle) * 11.5);
    // Aim a little below the car so it sits above the deploy controls.
    cam.lookAt(s.position.x, s.position.y - 1.1, s.position.z);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.shiftX) cam.setViewOffset(w, h, -this.shiftX, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    const c = this.config;
    const s = this.subject;
    this.time += dt;
    if (this.mode === 'orbit') return this.updateOrbit(dt);
    if (this.camera.view?.enabled) this.camera.clearViewOffset();
    this.camera.fov = c.fov;
    const speed = Math.hypot(s.velocity.x, s.velocity.z);

    // Look ahead along the velocity, clamped.
    _target.set(s.velocity.x, 0, s.velocity.z).multiplyScalar(c.lookAhead);
    if (_target.length() > c.maxLookAhead) _target.setLength(c.maxLookAhead);
    _target.add(s.position);
    this.focus.lerp(_target, dt > 0 ? damp(c.followRate, dt) : 1);
    this.focus.y = s.position.y;

    const zoomTarget = Math.min(c.maxZoom, speed * c.zoomPerSpeed);
    this.zoom += (zoomTarget - this.zoom) * (dt > 0 ? damp(c.zoomRate, dt) : 1);

    // North-up uses yaw 0 (camera south of the car looking north).
    const wantYaw = c.rotateWithCar > 0.5 ? s.yaw : 0;
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (dt > 0 ? damp(c.rotateRate, dt) : 1);

    const dist = c.distance + this.zoom;
    const pitch = THREE.MathUtils.degToRad(c.pitch);
    _offset.set(0, Math.sin(pitch) * dist, -Math.cos(pitch) * dist);
    _offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this.camera.position.copy(this.focus).add(_offset);
    this.camera.lookAt(this.focus);

    // Trauma-based shake, squared so small bumps stay subtle.
    this.trauma = Math.max(0, this.trauma - c.shakeDecay * dt);
    const sh = this.trauma * this.trauma;
    if (sh > 0) {
      const t = this.time * 40;
      this.camera.position.x += Math.sin(t * 1.3) * sh * 1.2;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * sh * 0.8;
      this.camera.position.z += Math.sin(t * 1.1 + 2) * sh * 1.2;
      this.camera.rotateZ(Math.sin(t * 0.9) * sh * 0.03);
    }
    this.camera.updateProjectionMatrix();
  }
}
