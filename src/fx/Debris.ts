import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { DEBRIS, type DebrisKind } from '../config/props';
import { DAMAGE } from '../config/physics';
import { InterpPose } from '../core/Interp';
import { COLLISION, type Rapier } from '../core/Physics';
import { rand } from '../core/math';

interface PanelSlot {
  /** Created per spawn and removed on release; only the mesh is pooled. */
  body: RAPIER.RigidBody | null;
  mesh: THREE.Mesh;
  interp: InterpPose;
  life: number;
  active: boolean;
}

interface ChunkSlot {
  body: RAPIER.RigidBody;
  interp: InterpPose;
  life: number;
  active: boolean;
  kind: DebrisKind;
  index: number;
  scale: THREE.Vector3;
}

const CHUNK_SHAPES: Record<DebrisKind, { size: [number, number, number]; color: number; density: number }> = {
  plank: { size: [0.18, 0.08, 1.3], color: 0x8a6440, density: 400 },
  shard: { size: [0.45, 0.06, 0.45], color: 0x7a3b24, density: 600 },
  scrap: { size: [0.7, 0.12, 0.5], color: 0x5f5650, density: 900 },
};

const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Vector3(0, 0, 0);

/**
 * Pooled physical debris. Panels are unique (dented) meshes torn off cars;
 * chunks are instanced planks, shards and scrap from broken props.
 */
export class DebrisSystem {
  private panels: PanelSlot[] = [];
  private panelCursor = 0;
  private chunks: ChunkSlot[] = [];
  private chunkCursor = 0;
  private instanced = new Map<DebrisKind, THREE.InstancedMesh>();
  readonly group = new THREE.Group();

  constructor(
    private R: Rapier,
    private world: RAPIER.World,
  ) {
    for (let i = 0; i < DEBRIS.maxPanels; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ flatShading: true, transparent: true }));
      mesh.visible = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.panels.push({ body: null, mesh, interp: new InterpPose(), life: 0, active: false });
    }
    const kinds = Object.keys(CHUNK_SHAPES) as DebrisKind[];
    const perKind = Math.floor(DEBRIS.maxChunks / kinds.length);
    for (const kind of kinds) {
      const s = CHUNK_SHAPES[kind];
      const geo = new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
      const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), perKind);
      inst.castShadow = true;
      inst.frustumCulled = false;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < perKind; i++) {
        inst.setMatrixAt(i, _m.makeScale(0, 0, 0));
        inst.setColorAt(i, _c.set(s.color));
        const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setEnabled(false).setLinearDamping(0.2).setAngularDamping(0.3));
        world.createCollider(
          R.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2)
            .setDensity(s.density)
            .setFriction(0.8)
            .setRestitution(0.2)
            .setCollisionGroups(COLLISION.debris),
          body,
        );
        this.chunks.push({ body, interp: new InterpPose(), life: 0, active: false, kind, index: i, scale: new THREE.Vector3(1, 1, 1) });
      }
      this.instanced.set(kind, inst);
      this.group.add(inst);
    }
  }

  /** Tear a panel off: copy its (dented) geometry into a physical debris piece. */
  spawnPanel(source: THREE.Mesh, pos: THREE.Vector3, rot: THREE.Quaternion, vel: THREE.Vector3, angvel: THREE.Vector3, scale = new THREE.Vector3(1, 1, 1)): void {
    const slot = this.panels[this.panelCursor];
    this.panelCursor = (this.panelCursor + 1) % this.panels.length;
    if (slot.active) this.releasePanel(slot);
    slot.mesh.geometry.dispose();
    const geo = source.geometry.clone();
    // Bake in children (ram bars, windows) so they fly off with the panel.
    const extras: THREE.BufferGeometry[] = [];
    source.children.forEach((child) => {
      if (child instanceof THREE.Mesh) extras.push(child.geometry.clone().applyMatrix4(child.matrix));
    });
    slot.mesh.geometry = geo;
    slot.mesh.children.slice().forEach((c) => slot.mesh.remove(c));
    for (const e of extras) {
      const m = new THREE.Mesh(e, (source.children[0] as THREE.Mesh).material);
      slot.mesh.add(m);
    }
    const srcMat = source.material as THREE.MeshLambertMaterial;
    const mat = slot.mesh.material as THREE.MeshLambertMaterial;
    mat.color.copy(srcMat.color ?? _c.set(0x777777));
    mat.vertexColors = !!srcMat.vertexColors;
    mat.needsUpdate = true;
    mat.opacity = 1;
    slot.mesh.scale.copy(scale);
    slot.mesh.visible = true;
    geo.computeBoundingBox();
    _box.copy(geo.boundingBox!);
    _box.getSize(_size);
    const center = _box.getCenter(new THREE.Vector3());
    const hx = Math.max(0.05, _size.x / 2);
    const hy = Math.max(0.05, _size.y / 2);
    const hz = Math.max(0.05, _size.z / 2);
    // A fresh body per panel: re-shaping colliders on disabled pooled bodies is fragile in Rapier.
    const b = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setLinearDamping(0.3).setAngularDamping(0.4));
    slot.body = b;
    this.world.createCollider(
      this.R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(center.x, center.y, center.z)
        .setDensity(250)
        .setFriction(0.7)
        .setRestitution(0.15)
        .setCollisionGroups(COLLISION.debris),
      b,
    );
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    b.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    b.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    b.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);
    slot.interp.snap(b);
    slot.life = DAMAGE.debrisLifetime;
    slot.active = true;
  }

  spawnChunks(kind: DebrisKind, count: number, pos: THREE.Vector3, baseVel: THREE.Vector3, spread: number, color?: number): void {
    const kinds = this.chunks.filter((c) => c.kind === kind);
    const inst = this.instanced.get(kind)!;
    for (let n = 0; n < count; n++) {
      // Reuse the oldest chunk of this kind.
      let slot = kinds.find((c) => !c.active);
      if (!slot) slot = kinds.reduce((a, c) => (c.life < a.life ? c : a), kinds[0]);
      const b = slot.body;
      b.setEnabled(true);
      b.setTranslation({ x: pos.x + rand(-0.6, 0.6), y: pos.y + rand(0, 0.8), z: pos.z + rand(-0.6, 0.6) }, true);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
      b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      b.setLinvel({ x: baseVel.x + rand(-spread, spread), y: baseVel.y + rand(spread * 0.4, spread * 1.2), z: baseVel.z + rand(-spread, spread) }, true);
      b.setAngvel({ x: rand(-8, 8), y: rand(-8, 8), z: rand(-8, 8) }, true);
      slot.interp.snap(b);
      slot.life = DEBRIS.chunkLifetime * rand(0.8, 1.2);
      slot.active = true;
      if (color !== undefined) {
        inst.setColorAt(slot.index, _c.set(color).multiplyScalar(rand(0.8, 1.1)));
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      }
    }
    this.chunkCursor = (this.chunkCursor + count) % this.chunks.length;
  }

  /** All active debris bodies, for explosions. */
  *activeBodies(): Generator<RAPIER.RigidBody> {
    for (const p of this.panels) if (p.active && p.body) yield p.body;
    for (const c of this.chunks) if (c.active) yield c.body;
  }

  step(dt: number): void {
    for (const p of this.panels) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) this.releasePanel(p);
      else if (p.body) p.interp.capture(p.body);
    }
    for (const c of this.chunks) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        c.body.setEnabled(false);
      } else c.interp.capture(c.body);
    }
  }

  private releasePanel(p: PanelSlot): void {
    p.active = false;
    p.mesh.visible = false;
    if (p.body) this.world.removeRigidBody(p.body);
    p.body = null;
  }

  render(alpha: number): void {
    for (const p of this.panels) {
      if (!p.active) continue;
      p.interp.apply(p.mesh, alpha);
      const mat = p.mesh.material as THREE.MeshLambertMaterial;
      mat.opacity = Math.min(1, p.life / 1.5);
    }
    for (const [kind, inst] of this.instanced) {
      for (const c of this.chunks) {
        if (c.kind !== kind) continue;
        if (!c.active) {
          inst.setMatrixAt(c.index, _m.makeScale(0, 0, 0));
          continue;
        }
        const s = Math.min(1, c.life / 1.2);
        c.scale.setScalar(s);
        inst.setMatrixAt(c.index, c.interp.toMatrix(_m, alpha, c.scale));
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    for (const p of this.panels) if (p.active) this.releasePanel(p);
    for (const c of this.chunks) {
      c.active = false;
      c.body.setEnabled(false);
      c.body.setLinvel(ZERO, false);
    }
  }

  get activeCount(): number {
    return this.panels.filter((p) => p.active).length + this.chunks.filter((c) => c.active).length;
  }
}
