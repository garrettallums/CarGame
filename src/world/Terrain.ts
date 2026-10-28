import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { WORLD } from '../config/world';
import type { SurfaceId } from '../config/surfaces';
import { COLLISION, type Rapier } from '../core/Physics';
import { clamp, lerp, mulberry32 } from '../core/math';

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

type Vec2 = [number, number];

/** Road centrelines as functions of a parameter running across the map. */
export const ROAD_PATHS: ((t: number) => Vec2)[] = [
  (t) => [t, 46 * Math.sin(t / 62 + 0.6) + 18 * Math.sin(t / 23)],
  (t) => [-52 + 34 * Math.sin(t / 55 + 1.3), t],
];

/** Desert arena: heightfield dunes, a ridge around the edge and dirt roads. */
export class Terrain {
  readonly size = WORLD.size;
  readonly half = WORLD.size / 2;
  readonly n = WORLD.resolution;
  readonly cell = WORLD.size / WORLD.resolution;
  /** Heights indexed [row + col * (n + 1)], row along z and col along x (Rapier's layout). */
  readonly heights: Float32Array;
  readonly roads: Vec2[][] = [];
  readonly mesh: THREE.Mesh;
  readonly roadMesh: THREE.Mesh;
  collider!: RAPIER.Collider;
  private phases: number[];

  constructor() {
    const rnd = mulberry32(WORLD.seed);
    this.phases = Array.from({ length: 6 }, () => rnd() * Math.PI * 2);
    this.roads.push(this.buildRoad(ROAD_PATHS[0]));
    this.roads.push(this.buildRoad(ROAD_PATHS[1], 0.75));

    const n = this.n;
    this.heights = new Float32Array((n + 1) * (n + 1));
    for (let col = 0; col <= n; col++) {
      for (let row = 0; row <= n; row++) {
        const x = -this.half + col * this.cell;
        const z = -this.half + row * this.cell;
        this.heights[row + col * (n + 1)] = this.generateHeight(x, z);
      }
    }
    this.mesh = this.buildMesh();
    this.roadMesh = this.buildRoadMesh();
  }

  private buildRoad(f: (t: number) => Vec2, extent = 1): Vec2[] {
    const pts: Vec2[] = [];
    const len = this.half * extent + 10;
    for (let t = -len; t <= this.half + 10; t += 4) pts.push(f(t));
    return pts;
  }

  /** Distance from (x, z) to the nearest road centreline. */
  roadDistance(x: number, z: number): number {
    let best = Infinity;
    for (const road of this.roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const [ax, az] = road[i];
        const [bx, bz] = road[i + 1];
        // Cheap reject before the exact segment distance.
        if (Math.abs(ax - x) > 30 && Math.abs(bx - x) > 30) continue;
        if (Math.abs(az - z) > 30 && Math.abs(bz - z) > 30) continue;
        const dx = bx - ax;
        const dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const px = ax + dx * t - x;
        const pz = az + dz * t - z;
        const d = px * px + pz * pz;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }

  private duneNoise(x: number, z: number): number {
    const p = this.phases;
    return (
      0.55 * Math.sin(x * 0.031 + p[0] + 0.8 * Math.sin(z * 0.017 + p[1])) * Math.cos(z * 0.026 + p[2]) +
      0.3 * Math.sin((x + z) * 0.055 + p[3]) +
      0.15 * Math.sin((x - 0.7 * z) * 0.093 + p[4]) +
      0.08 * Math.sin(z * 0.17 + p[5] + 0.3 * x * 0.05)
    );
  }

  private generateHeight(x: number, z: number): number {
    let h = this.duneNoise(x, z) * WORLD.duneHeight;
    // Keep the spawn area gentle.
    h *= lerp(0.3, 1, smoothstep(10, 40, Math.hypot(x, z)));
    const road = smoothstep(WORLD.roadHalfWidth, WORLD.roadHalfWidth + WORLD.roadShoulder, this.roadDistance(x, z));
    h = lerp(h * 0.15, h, road);
    const edge = this.half - Math.max(Math.abs(x), Math.abs(z));
    const ridge = smoothstep(WORLD.ridgeWidth, 2, edge);
    h += ridge * ridge * WORLD.ridgeHeight;
    return h;
  }

  /** Bilinear height of the heightfield grid. */
  heightAt(x: number, z: number): number {
    const n = this.n;
    const fx = clamp((x + this.half) / this.cell, 0, n - 1e-4);
    const fz = clamp((z + this.half) / this.cell, 0, n - 1e-4);
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const h = this.heights;
    const s = n + 1;
    const h00 = h[r + c * s];
    const h10 = h[r + (c + 1) * s];
    const h01 = h[r + 1 + c * s];
    const h11 = h[r + 1 + (c + 1) * s];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  surfaceAt(x: number, z: number): SurfaceId {
    return this.roadDistance(x, z) < WORLD.roadHalfWidth ? 'road' : 'sand';
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  addPhysics(R: Rapier, world: RAPIER.World): void {
    const desc = R.ColliderDesc.heightfield(this.n, this.n, this.heights, { x: this.size, y: 1, z: this.size })
      .setFriction(0.6)
      .setCollisionGroups(COLLISION.terrain);
    this.collider = world.createCollider(desc);
    // Invisible walls beyond the ridge.
    const h = 40;
    const t = 4;
    const walls: [number, number, number, number][] = [
      [0, -this.half - t, this.half + t, t],
      [0, this.half + t, this.half + t, t],
      [-this.half - t, 0, t, this.half + t],
      [this.half + t, 0, t, this.half + t],
    ];
    for (const [x, z, hx, hz] of walls) {
      world.createCollider(R.ColliderDesc.cuboid(hx, h, hz).setTranslation(x, h - 5, z).setCollisionGroups(COLLISION.static));
    }
  }

  private buildMesh(): THREE.Mesh {
    const n = this.n;
    const s = n + 1;
    const pos = new Float32Array(s * s * 3);
    const col = new Float32Array(s * s * 3);
    const rnd = mulberry32(WORLD.seed + 7);
    const sandA = new THREE.Color(0xd9955a);
    const sandB = new THREE.Color(0xc77f45);
    const sandC = new THREE.Color(0xe6aa6c);
    const ridgeCol = new THREE.Color(0xa65f36);
    const shoulder = new THREE.Color(0xb98a5c);
    const c = new THREE.Color();
    for (let col_ = 0; col_ <= n; col_++) {
      for (let row = 0; row <= n; row++) {
        const i = row * s + col_;
        const x = -this.half + col_ * this.cell;
        const z = -this.half + row * this.cell;
        const h = this.heights[row + col_ * s];
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        const v = this.duneNoise(x * 1.7, z * 1.7) * 0.5 + 0.5;
        c.copy(sandA).lerp(v > 0.5 ? sandC : sandB, Math.abs(v - 0.5) * 1.6);
        c.multiplyScalar(0.94 + rnd() * 0.08);
        const edge = this.half - Math.max(Math.abs(x), Math.abs(z));
        c.lerp(ridgeCol, smoothstep(WORLD.ridgeWidth, 4, edge) * 0.8);
        const rd = this.roadDistance(x, z);
        c.lerp(shoulder, (1 - smoothstep(WORLD.roadHalfWidth, WORLD.roadHalfWidth + WORLD.roadShoulder + 3, rd)) * 0.5);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let row = 0; row < n; row++) {
      for (let col_ = 0; col_ < n; col_++) {
        const a = row * s + col_;
        const b = a + 1;
        const d = a + s;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  private buildRoadMesh(): THREE.Mesh {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const across = 5;
    const half = WORLD.roadHalfWidth;
    const rnd = mulberry32(WORLD.seed + 3);
    const base = new THREE.Color(0x9a6b45);
    const c = new THREE.Color();
    for (const road of this.roads) {
      const start = pos.length / 3;
      let rows = 0;
      for (let i = 0; i < road.length; i++) {
        const [x, z] = road[i];
        const [px, pz] = road[Math.max(0, i - 1)];
        const [nx, nz] = road[Math.min(road.length - 1, i + 1)];
        let dx = nx - px;
        let dz = nz - pz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        for (let k = 0; k < across; k++) {
          const o = (k / (across - 1) - 0.5) * 2 * half;
          const vx = x - dz * o;
          const vz = z + dx * o;
          // Sit on the highest nearby terrain sample so the ribbon never dips under triangle seams.
          const h = Math.max(
            this.heightAt(vx, vz),
            this.heightAt(vx + 1.2, vz),
            this.heightAt(vx - 1.2, vz),
            this.heightAt(vx, vz + 1.2),
            this.heightAt(vx, vz - 1.2),
          );
          pos.push(vx, h + 0.1, vz);
          // Darker wheel ruts toward the middle of each lane.
          const rut = k === 1 || k === 3 ? 0.88 : 1;
          c.copy(base).multiplyScalar(rut * (0.95 + rnd() * 0.08));
          col.push(c.r, c.g, c.b);
        }
        rows++;
      }
      for (let r = 0; r < rows - 1; r++) {
        for (let k = 0; k < across - 1; k++) {
          const a = start + r * across + k;
          const b = a + 1;
          const d = a + across;
          const e = d + 1;
          idx.push(a, b, d, b, e, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'road';
    return mesh;
  }
}
