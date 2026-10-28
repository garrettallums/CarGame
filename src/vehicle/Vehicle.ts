import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig, VehicleDefinition } from '../config/vehicles';
import { DAMAGE } from '../config/physics';
import type { GameContext } from '../core/Context';
import { bus } from '../core/EventBus';
import { InterpPose } from '../core/Interp';
import { COLLISION } from '../core/Physics';
import { rand } from '../core/math';
import { DamageModel, type DamageZone } from './DamageModel';
import { VehicleController, emptyInput, type VehicleInput } from './VehicleController';
import type { VehicleVisual } from './VehicleFactory';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const CHAR = new THREE.Color(0x1d1714);

/** A drivable, damageable car: one rigid body, a controller and a deformable visual. */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: VehicleController;
  readonly damage: DamageModel;
  readonly interp = new InterpPose();
  readonly input: VehicleInput = emptyInput();
  readonly prevLinvel = new THREE.Vector3();
  readonly prevAngvel = new THREE.Vector3();
  readonly spawnPos: THREE.Vector3;
  readonly spawnYaw: number;
  wrecked = false;
  /** Seconds since last wreck, drives the fire effect. */
  wreckAge = 0;
  private baseColors: { body: THREE.Color; trim: THREE.Color };

  constructor(
    private ctx: GameContext,
    readonly def: VehicleDefinition,
    readonly config: VehicleConfig,
    readonly visual: VehicleVisual,
    readonly isPlayer: boolean,
    position: THREE.Vector3,
    yaw: number,
  ) {
    const { R, world, scene } = ctx;
    this.spawnPos = position.clone();
    this.spawnYaw = yaw;
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const c = visual.collider;
    this.collider = world.createCollider(
      R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
        .setTranslation(0, c.cy, 0)
        .setFriction(0.35)
        .setRestitution(0.15)
        .setCollisionGroups(COLLISION.vehicle)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1),
      this.body,
    );
    this.applyMass();
    this.controller = new VehicleController(R, this.body, config, visual.wheelLocals);
    this.damage = new DamageModel(config);
    this.baseColors = { body: visual.materials.body.color.clone(), trim: visual.materials.trim.color.clone() };
    scene.add(visual.root);
    this.interp.snap(this.body);
  }

  get position(): THREE.Vector3 {
    return this.interp.pos;
  }

  /** Re-apply mass properties, for example after the tuning panel changes mass. */
  applyMass(): void {
    const m = this.config.mass;
    const c = this.visual.collider;
    const w = c.hx * 2;
    const h = c.hy * 2;
    const l = c.hz * 2;
    // Slightly inflated inertia and a low centre of mass keep the car planted.
    const k = (m / 12) * 1.4;
    this.collider.setMassProperties(
      m,
      { x: 0, y: -c.hy * 0.6 - c.cy, z: 0 },
      { x: k * (h * h + l * l), y: k * (w * w + l * l), z: k * (w * w + h * h) },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    this.collider.setContactForceEventThreshold(m * 2);
  }

  snapshotVelocity(): void {
    const v = this.body.linvel();
    const w = this.body.angvel();
    this.prevLinvel.set(v.x, v.y, v.z);
    this.prevAngvel.set(w.x, w.y, w.z);
  }

  physicsStep(dt: number): void {
    const ctrl = this.controller;
    ctrl.config = this.config;
    if (!this.wrecked) {
      const front = this.damage.zoneFraction('front');
      ctrl.engineFactor = this.damage.broken.front ? 0.35 : 0.45 + 0.55 * front;
    }
    ctrl.step(dt, this.input, this.ctx.world, this.ctx.terrain);
    if (ctrl.wantsReset) {
      ctrl.wantsReset = false;
      this.placeUpright();
    }
    if (this.wrecked) this.wreckAge += dt;
  }

  capture(): void {
    this.interp.capture(this.body);
  }

  render(alpha: number): void {
    const root = this.visual.root;
    this.interp.apply(root, alpha);
    const ctrl = this.controller;
    for (let i = 0; i < this.visual.wheels.length; i++) {
      const wv = this.visual.wheels[i];
      const ws = ctrl.wheels[i];
      wv.pivot.position.y = ws.local.y - ws.extension;
      wv.pivot.rotation.y = wv.front ? -ctrl.steerVisual * 0.5 : 0;
      wv.mesh.rotation.x = ws.spin;
    }
  }

  /** Classify a car-local point into a damage zone. */
  zoneAt(local: THREE.Vector3): DamageZone {
    const c = this.visual.collider;
    const nz = local.z / c.hz;
    const nx = local.x / c.hx;
    if (Math.abs(nz) * 0.9 > Math.abs(nx)) return nz > 0 ? 'front' : 'rear';
    // Left is +X in vehicle space (forward is +Z, up is +Y).
    return nx > 0 ? 'left' : 'right';
  }

  worldToLocal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    return out.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(_q);
  }

  localDirToWorld(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const r = this.body.rotation();
    return out.copy(d).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
  }

  /**
   * Handle an impact. `inward` points into this car, `closing` is the relative
   * speed along the contact normal and `massRatio` is other / (self + other).
   * `dealtMultiplier` is the attacker's ram bonus when it hit with its front.
   */
  takeHit(point: THREE.Vector3, inward: THREE.Vector3, closing: number, massRatio: number, dealtMultiplier = 1): number {
    const excess = closing - DAMAGE.minImpactSpeed;
    if (excess <= 0) return 0;
    const local = this.worldToLocal(point, _p);
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    const dir = _d.copy(inward).applyQuaternion(_q).normalize();
    // Dents happen even on a wreck.
    const depth = Math.min(DAMAGE.maxDentPerHit, excess * DAMAGE.dentPerSpeed * this.config.deformStrength * (0.4 + massRatio));
    for (const part of this.visual.parts) {
      if (part.deform && !part.detached) part.deform.dent(local, dir, DAMAGE.dentRadius, depth, DAMAGE.maxDentDepth);
    }
    if (this.wrecked) return 0;
    const zone = this.zoneAt(local);
    const raw = excess * massRatio * this.config.damageMultiplier * DAMAGE.damageScale * dealtMultiplier;
    const res = this.damage.hit(zone, raw);
    if (res.damage > 0) bus.emit('vehicleDamaged', { vehicle: this, zone, amount: res.damage, isPlayer: this.isPlayer });
    this.shedParts(zone);
    if (res.zoneBroken) this.breakZone(zone);
    if (res.destroyed) this.wreck();
    return res.damage;
  }

  /** Direct damage, for explosions. */
  applyDamage(zone: DamageZone, raw: number): void {
    if (this.wrecked) return;
    const res = this.damage.hit(zone, raw * this.config.damageMultiplier);
    if (res.damage > 0) bus.emit('vehicleDamaged', { vehicle: this, zone, amount: res.damage, isPlayer: this.isPlayer });
    this.shedParts(zone);
    if (res.zoneBroken) this.breakZone(zone);
    if (res.destroyed) this.wreck();
  }

  /** Knock off parts whose break point the zone has passed (bumpers go first). */
  private shedParts(zone: DamageZone): void {
    const frac = this.damage.zoneFraction(zone);
    for (const part of this.visual.parts) {
      if (part.zone === zone && !part.detached && part.breakAt > 0 && frac <= part.breakAt) this.detachPart(part.name);
    }
  }

  private breakZone(zone: DamageZone): void {
    for (const part of this.visual.parts) {
      if (part.zone === zone && !part.detached) this.detachPart(part.name);
    }
    if (zone === 'left' || zone === 'right') this.loseWheel(zone === 'left' ? 1 : -1, true);
  }

  detachPart(name: string): void {
    const part = this.visual.parts.find((p) => p.name === name);
    if (!part || part.detached) return;
    part.detached = true;
    part.mesh.visible = false;
    this.spawnPieceDebris(part.mesh);
    bus.emit('vehiclePartLost', { vehicle: this, part: name });
  }

  /** Remove a wheel on a side (1 = left, -1 = right). */
  loseWheel(side: number, front: boolean): void {
    const idx = this.controller.wheels.findIndex((w) => w.side === side && w.front === front && !w.lost);
    if (idx < 0) return;
    this.controller.wheels[idx].lost = true;
    const wv = this.visual.wheels[idx];
    wv.pivot.visible = false;
    this.spawnPieceDebris(wv.mesh, wv.pivot.position);
    // A missing wheel drags the car toward its side.
    this.controller.steerPull += side * 0.35;
    bus.emit('vehiclePartLost', { vehicle: this, part: 'wheel' });
  }

  private spawnPieceDebris(mesh: THREE.Mesh, offset?: THREE.Vector3): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _p.copy(offset ?? mesh.position).applyQuaternion(_q).add(_v.set(t.x, t.y, t.z));
    const lv = this.body.linvel();
    const out = _d.copy(offset ?? mesh.position).setY(0);
    if (out.lengthSq() < 0.01) out.set(rand(-1, 1), 0, rand(-1, 1));
    out.normalize().applyQuaternion(_q).multiplyScalar(rand(3, 6));
    const vel = new THREE.Vector3(lv.x + out.x, lv.y + rand(3, 6), lv.z + out.z);
    const ang = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    _m.makeRotationFromQuaternion(_q);
    this.ctx.debris.spawnPanel(mesh, _p, _q, vel, ang, mesh.getWorldScale(_s));
  }

  /** Zero integrity: blow apart and leave a charred wreck. */
  wreck(): void {
    if (this.wrecked) return;
    this.wrecked = true;
    this.wreckAge = 0;
    this.damage.destroyed = true;
    this.controller.disabled = true;
    for (const part of this.visual.parts) if (part.zone && !part.detached) this.detachPart(part.name);
    this.loseWheel(Math.random() < 0.5 ? 1 : -1, Math.random() < 0.5);
    const mats = this.visual.materials;
    mats.body.color.copy(this.baseColors.body).lerp(CHAR, 0.85);
    mats.trim.color.copy(CHAR);
    this.body.setLinearDamping(0.8);
    this.body.setAngularDamping(1.5);
    const t = this.body.translation();
    this.body.applyImpulse({ x: 0, y: this.config.mass * 5, z: 0 }, true);
    this.body.applyTorqueImpulse({ x: rand(-1, 1) * this.config.mass, y: 0, z: rand(-1, 1) * this.config.mass }, true);
    bus.emit('vehicleDestroyed', { vehicle: this, position: new THREE.Vector3(t.x, t.y, t.z), isPlayer: this.isPlayer });
  }

  /** Fix everything: dents, parts, wheels, colours, integrity. */
  repair(): void {
    this.wrecked = false;
    this.wreckAge = 0;
    this.damage.repair();
    this.controller.reset();
    this.controller.disabled = false;
    for (const part of this.visual.parts) {
      part.detached = false;
      part.mesh.visible = true;
      part.deform?.repair();
    }
    for (const w of this.visual.wheels) w.pivot.visible = true;
    const mats = this.visual.materials;
    mats.body.color.copy(this.baseColors.body);
    mats.trim.color.copy(this.baseColors.trim);
    this.body.setLinearDamping(0.05);
    this.body.setAngularDamping(0.6);
  }

  /** Teleport to a pose with no motion. */
  teleport(pos: THREE.Vector3, yaw: number): void {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.interp.snap(this.body);
  }

  respawn(): void {
    this.repair();
    const p = this.spawnPos.clone();
    p.y = this.ctx.terrain.heightAt(p.x, p.z) + 1.6;
    this.teleport(p, this.spawnYaw);
  }

  /** Flip back onto the wheels where the car is. */
  placeUpright(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _d.set(0, 0, 1).applyQuaternion(_q);
    const yaw = Math.atan2(_d.x, _d.z);
    this.teleport(new THREE.Vector3(t.x, this.ctx.terrain.heightAt(t.x, t.z) + 2, t.z), yaw);
  }

  /** Heading angle about +Y, 0 = facing +Z. */
  get yaw(): number {
    _d.set(0, 0, 1).applyQuaternion(this.interp.rot);
    return Math.atan2(_d.x, _d.z);
  }

  dispose(): void {
    this.ctx.world.removeRigidBody(this.body);
    this.ctx.scene.remove(this.visual.root);
    // Geometries and materials are per-vehicle, so free them with it.
    this.visual.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
  }

  /** True if a world-space point is on this car's front end. */
  isFrontContact(point: THREE.Vector3): boolean {
    return this.zoneAt(this.worldToLocal(point, _s)) === 'front';
  }
}
