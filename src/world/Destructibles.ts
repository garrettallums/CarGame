import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { DESTRUCTIBLES, type DestructibleConfig, type DestructibleType } from '../config/props';
import { box, merge, paint } from '../core/geo';
import { bus } from '../core/EventBus';
import { InterpPose } from '../core/Interp';
import { COLLISION, type Rapier } from '../core/Physics';
import type { DebrisSystem } from '../fx/Debris';
import type { Terrain } from './Terrain';

export class Destructible {
  health: number;
  broken = false;
  readonly interp = new InterpPose();
  readonly prevLinvel = new THREE.Vector3();
  readonly prevAngvel = new THREE.Vector3();

  constructor(
    readonly type: DestructibleType,
    readonly config: DestructibleConfig,
    readonly body: RAPIER.RigidBody,
    readonly collider: RAPIER.Collider,
    readonly index: number,
    readonly spawnPos: THREE.Vector3,
    readonly spawnRot: THREE.Quaternion,
  ) {
    this.health = config.health;
  }

  get explosive(): boolean {
    return this.config.explosion !== null;
  }
}

interface TypeVisual {
  geo: THREE.BufferGeometry;
  /** Collider half extents and vertical centre. */
  shape: { kind: 'box'; hx: number; hy: number; hz: number } | { kind: 'cyl'; r: number; hh: number };
  debrisColor: number;
}

function buildVisuals(): Record<DestructibleType, TypeVisual> {
  const wood = 0x9a7048;
  const woodDark = 0x6e4e30;
  const barrel = (body: number, band: number) => {
    const c = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10).translate(0, 0, 0);
    const b1 = new THREE.CylinderGeometry(0.47, 0.47, 0.12, 10).translate(0, 0.28, 0);
    const b2 = new THREE.CylinderGeometry(0.47, 0.47, 0.12, 10).translate(0, -0.28, 0);
    return merge([paint(c, body, 0.15), paint(b1, band), paint(b2, band)]);
  };
  const plates: THREE.BufferGeometry[] = [];
  const scrapCols = [0x6d625a, 0x7d4a2e, 0x55504b, 0x8a5a36];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(1.0, 1.4 - (i % 2) * 0.3, 0.12);
    g.rotateZ((i - 2) * 0.12);
    g.rotateY((i % 2 ? 1 : -1) * 0.15);
    g.translate(-1.6 + i * 0.8, 0.05, (i % 2) * 0.18 - 0.09);
    plates.push(paint(g, scrapCols[i % scrapCols.length], 0.15));
  }
  const tire = new THREE.TorusGeometry(0.45, 0.2, 6, 10).rotateX(Math.PI / 2).translate(1.4, -0.55, 0.35);
  plates.push(paint(tire, 0x1d1a17));
  plates.push(box(4, 0.15, 0.15, 0, 0.45, -0.2, 0x3c3530));
  return {
    fence: {
      geo: merge([
        box(0.16, 1.3, 0.16, -1.9, 0, 0, woodDark, 0.1),
        box(0.16, 1.3, 0.16, 1.9, 0, 0, woodDark, 0.1),
        box(4, 0.16, 0.07, 0, 0.3, 0, wood, 0.1),
        box(4, 0.16, 0.07, 0, -0.15, 0, wood, 0.1),
        box(0.16, 1.0, 0.06, 0, 0.05, 0.04, wood, 0.1),
      ]),
      shape: { kind: 'box', hx: 2, hy: 0.65, hz: 0.12 },
      debrisColor: wood,
    },
    sign: {
      geo: merge([box(0.12, 2.6, 0.12, 0, 0, 0, 0x5a4a3a), box(1.5, 0.8, 0.06, 0, 0.9, 0.08, 0xc9a14a, 0.1), box(1.3, 0.15, 0.07, 0, 0.9, 0.1, 0x7a2e1e)]),
      shape: { kind: 'box', hx: 0.75, hy: 1.3, hz: 0.12 },
      debrisColor: 0xc9a14a,
    },
    barrel: { geo: barrel(0x7b4a2c, 0x4a3a30), shape: { kind: 'cyl', r: 0.45, hh: 0.55 }, debrisColor: 0x7b4a2c },
    explosiveBarrel: { geo: barrel(0xb0281c, 0xe8c040), shape: { kind: 'cyl', r: 0.45, hh: 0.55 }, debrisColor: 0xb0281c },
    barricade: { geo: merge(plates), shape: { kind: 'box', hx: 2.05, hy: 0.8, hz: 0.35 }, debrisColor: 0x6d625a },
  };
}

const _m = new THREE.Matrix4();
const _zero = new THREE.Vector3(0, 0, 0);
const _v = new THREE.Vector3();

/** Breakable props, rendered with one instanced mesh per type. */
export class Destructibles {
  readonly items: Destructible[] = [];
  readonly group = new THREE.Group();
  private meshes = new Map<DestructibleType, THREE.InstancedMesh>();
  private visuals = buildVisuals();
  private pending: { type: DestructibleType; pos: THREE.Vector3; yaw: number }[] = [];
  private byCollider = new Map<number, Destructible>();

  constructor(
    private R: Rapier,
    private world: RAPIER.World,
    private terrain: Terrain,
    private debris: DebrisSystem,
  ) {}

  add(type: DestructibleType, x: number, z: number, yaw = 0): void {
    this.pending.push({ type, pos: new THREE.Vector3(x, 0, z), yaw });
  }

  /** Create bodies and instanced meshes for everything added. */
  build(): void {
    const counts = new Map<DestructibleType, number>();
    for (const p of this.pending) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    for (const [type, count] of counts) {
      const inst = new THREE.InstancedMesh(this.visuals[type].geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), count);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      this.meshes.set(type, inst);
      this.group.add(inst);
    }
    const next = new Map<DestructibleType, number>();
    for (const p of this.pending) {
      const cfg = DESTRUCTIBLES[p.type];
      const vis = this.visuals[p.type];
      const index = next.get(p.type) ?? 0;
      next.set(p.type, index + 1);
      const hy = vis.shape.kind === 'box' ? vis.shape.hy : vis.shape.hh;
      p.pos.y = this.terrain.heightAt(p.pos.x, p.pos.z) + hy + 0.02;
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      const body = this.world.createRigidBody(
        this.R.RigidBodyDesc.dynamic()
          .setTranslation(p.pos.x, p.pos.y, p.pos.z)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setLinearDamping(0.3)
          .setAngularDamping(0.5)
          .setCanSleep(true),
      );
      const desc =
        vis.shape.kind === 'box'
          ? this.R.ColliderDesc.cuboid(vis.shape.hx, vis.shape.hy, vis.shape.hz)
          : this.R.ColliderDesc.cylinder(vis.shape.hh, vis.shape.r);
      const collider = this.world.createCollider(
        desc
          .setMass(cfg.mass)
          .setFriction(0.7)
          .setRestitution(0.2)
          .setCollisionGroups(COLLISION.prop)
          .setActiveEvents(this.R.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(cfg.mass * 40),
        body,
      );
      body.sleep();
      const d = new Destructible(p.type, cfg, body, collider, index, p.pos.clone(), rot);
      d.interp.snap(body);
      this.items.push(d);
      this.byCollider.set(collider.handle, d);
    }
    this.pending = [];
    this.render(1);
  }

  fromCollider(handle: number): Destructible | undefined {
    return this.byCollider.get(handle);
  }

  snapshotVelocities(): void {
    for (const d of this.items) {
      if (d.broken) continue;
      const v = d.body.linvel();
      const w = d.body.angvel();
      d.prevLinvel.set(v.x, v.y, v.z);
      d.prevAngvel.set(w.x, w.y, w.z);
    }
  }

  /** Apply damage; returns true if it broke. Explosive props are reported via the bus. */
  damage(d: Destructible, amount: number, impactVel?: THREE.Vector3): boolean {
    if (d.broken || amount < d.config.breakThreshold) return false;
    d.health -= amount;
    if (d.health > 0) return false;
    this.breakProp(d, impactVel);
    return true;
  }

  breakProp(d: Destructible, impactVel?: THREE.Vector3): void {
    if (d.broken) return;
    d.broken = true;
    const t = d.body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const lv = d.body.linvel();
    _v.set(lv.x, lv.y, lv.z);
    if (impactVel) _v.addScaledVector(impactVel, 0.4);
    d.body.setEnabled(false);
    this.debris.spawnChunks(d.config.debris, d.config.debrisCount, pos, _v, 3.5, this.visuals[d.type].debrisColor);
    // Explosive props are detonated by whoever listens for propBroken.
    bus.emit('propBroken', { prop: d, type: d.type, position: pos });
  }

  step(): void {
    for (const d of this.items) if (!d.broken) d.interp.capture(d.body);
  }

  render(alpha: number): void {
    for (const [type, inst] of this.meshes) {
      for (const d of this.items) {
        if (d.type !== type) continue;
        if (d.broken) inst.setMatrixAt(d.index, _m.makeScale(0, 0, 0));
        else inst.setMatrixAt(d.index, d.interp.toMatrix(_m, alpha));
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  resetAll(): void {
    for (const d of this.items) {
      d.broken = false;
      d.health = d.config.health;
      const b = d.body;
      b.setEnabled(true);
      b.setTranslation({ x: d.spawnPos.x, y: d.spawnPos.y, z: d.spawnPos.z }, false);
      b.setRotation({ x: d.spawnRot.x, y: d.spawnRot.y, z: d.spawnRot.z, w: d.spawnRot.w }, false);
      b.setLinvel(_zero, false);
      b.setAngvel(_zero, false);
      b.sleep();
      d.interp.snap(b);
    }
  }

  get brokenCount(): number {
    return this.items.filter((d) => d.broken).length;
  }
}
