import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { box, merge, paint, vertexColorMaterial } from '../core/geo';
import { COLLISION, type Rapier } from '../core/Physics';
import { mulberry32 } from '../core/math';
import type { Terrain } from './Terrain';

/**
 * Immovable obstacles: rock clusters, a ruined building and a rusted tanker.
 * All visuals are merged into a single vertex-coloured mesh.
 */
export class Statics {
  readonly mesh: THREE.Mesh;
  readonly decor: THREE.InstancedMesh;
  private geos: THREE.BufferGeometry[] = [];
  private rnd = mulberry32(99);

  constructor(
    private R: Rapier,
    private world: RAPIER.World,
    private terrain: Terrain,
  ) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), vertexColorMaterial);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'statics';
    this.decor = this.buildScrub();
  }

  private fixedBody(x: number, y: number, z: number, yaw = 0): RAPIER.RigidBody {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  }

  addRockCluster(cx: number, cz: number, count: number, scale = 1): void {
    const rnd = this.rnd;
    for (let i = 0; i < count; i++) {
      const r = (1.4 + rnd() * 2.6) * scale;
      const x = cx + (rnd() - 0.5) * 7 * scale;
      const z = cz + (rnd() - 0.5) * 7 * scale;
      const y = this.terrain.heightAt(x, z) + r * 0.25;
      const g = new THREE.DodecahedronGeometry(r, 0);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      // Squash and jitter for a weathered look; keep duplicated corners in sync.
      const seen = new Map<string, [number, number, number]>();
      for (let k = 0; k < p.count; k++) {
        const key = `${p.getX(k).toFixed(3)},${p.getY(k).toFixed(3)},${p.getZ(k).toFixed(3)}`;
        let v = seen.get(key);
        if (!v) {
          const j = 0.75 + rnd() * 0.45;
          v = [p.getX(k) * j * (1 + rnd() * 0.4), p.getY(k) * j * 0.7, p.getZ(k) * j];
          seen.set(key, v);
        }
        p.setXYZ(k, v[0], v[1], v[2]);
      }
      g.rotateY(rnd() * Math.PI * 2);
      g.translate(x, y, z);
      const colors = [0xa0522d, 0x8b4a2b, 0xb3653a, 0x7a4026];
      this.geos.push(paint(g, colors[Math.floor(rnd() * colors.length)], 0.18, rnd));
      const hull = this.R.ColliderDesc.convexHull(new Float32Array(p.array as Float32Array));
      // The hull uses the already-placed world-space vertices.
      if (hull) this.world.createCollider(hull.setCollisionGroups(COLLISION.static).setFriction(0.5), this.fixedBody(0, 0, 0));
    }
  }

  addBuilding(cx: number, cz: number, yaw: number): void {
    const y = this.terrain.heightAt(cx, cz);
    const body = this.fixedBody(cx, y, cz, yaw);
    const wall = 0xb88a5e;
    const dark = 0x8c6443;
    const local: THREE.BufferGeometry[] = [];
    const addWall = (w: number, h: number, d: number, x: number, z: number, color = wall) => {
      local.push(box(w, h, d, x, h / 2 - 0.5, z, color, 0.1));
      this.world.createCollider(
        this.R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, h / 2 - 0.5, z).setCollisionGroups(COLLISION.static),
        body,
      );
    };
    // A ruined 14 x 10 shell with a doorway and a collapsed corner.
    addWall(14, 4.5, 0.6, 0, -5);
    addWall(5, 4, 0.6, -4.5, 5);
    addWall(4, 2.2, 0.6, 5, 5, dark);
    addWall(0.6, 4.5, 10, -7, 0);
    addWall(0.6, 3, 5, 7, -2.5);
    addWall(0.6, 4.5, 4, 0, -1.5, dark);
    // Rubble.
    for (let i = 0; i < 8; i++) {
      const s = 0.4 + this.rnd() * 0.8;
      local.push(box(s, s * 0.6, s, 4 + this.rnd() * 6, 0, 2 + this.rnd() * 6, dark, 0.2));
    }
    // Roof beam remains.
    local.push(box(0.3, 0.3, 10.5, -3, 4.1, 0, 0x5b4632));
    local.push(box(0.3, 0.3, 10.5, 2, 3.9, -0.5, 0x5b4632));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, y, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    for (const g of local) this.geos.push(g.applyMatrix4(m));
  }

  addTanker(cx: number, cz: number, yaw: number): void {
    const y = this.terrain.heightAt(cx, cz);
    const body = this.fixedBody(cx, y, cz, yaw);
    const rust = 0x8a4b2a;
    const local: THREE.BufferGeometry[] = [];
    const tank = new THREE.CylinderGeometry(1.5, 1.5, 9, 10, 1);
    tank.rotateX(Math.PI / 2);
    tank.translate(0, 2.1, 0);
    local.push(paint(tank, rust, 0.25, this.rnd));
    local.push(box(2.2, 0.4, 10, 0, 0.6, 0, 0x3b3029));
    for (const z of [-3.6, -2.4, 3.2]) {
      for (const x of [-1.1, 1.1]) {
        const w = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 8).rotateZ(Math.PI / 2).translate(x, 0.3, z);
        local.push(paint(w, 0x1f1b18));
      }
    }
    local.push(box(0.8, 0.4, 0.8, 0, 3.7, 1.5, 0x6b3a22));
    this.world.createCollider(this.R.ColliderDesc.cuboid(1.5, 1.6, 4.6).setTranslation(0, 1.9, 0).setCollisionGroups(COLLISION.static), body);
    // Tipped slightly as if abandoned.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0.06));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, y, cz), q, new THREE.Vector3(1, 1, 1));
    for (const g of local) this.geos.push(g.applyMatrix4(m));
  }

  /** Merge everything added so far into the single static mesh. */
  finalize(): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = merge(this.geos);
    this.geos = [];
  }

  private buildScrub(): THREE.InstancedMesh {
    const g = merge([
      paint(new THREE.ConeGeometry(0.5, 0.9, 5).translate(0, 0.4, 0), 0x8d8a46, 0.3),
      paint(new THREE.ConeGeometry(0.35, 0.7, 5).translate(0.4, 0.3, 0.25), 0x9c9550, 0.3),
      paint(new THREE.ConeGeometry(0.3, 0.6, 5).translate(-0.35, 0.25, 0.2), 0x7d7a3e, 0.3),
    ]);
    const count = 260;
    const inst = new THREE.InstancedMesh(g, vertexColorMaterial, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let i = 0;
    let guard = 0;
    while (i < count && guard++ < 5000) {
      const x = (this.rnd() - 0.5) * (this.terrain.size - 50);
      const z = (this.rnd() - 0.5) * (this.terrain.size - 50);
      if (this.terrain.roadDistance(x, z) < 10) continue;
      p.set(x, this.terrain.heightAt(x, z), z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * 6.28);
      s.setScalar(0.6 + this.rnd() * 1.1);
      inst.setMatrixAt(i++, m.compose(p, q, s));
    }
    inst.count = i;
    inst.receiveShadow = false;
    inst.castShadow = false;
    return inst;
  }
}
