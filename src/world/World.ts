import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Rapier } from '../core/Physics';
import { mulberry32 } from '../core/math';
import { ROAD_PATHS, Terrain } from './Terrain';
import { Statics } from './Statics';
import { Destructibles } from './Destructibles';
import type { DebrisSystem } from '../fx/Debris';
import type { DestructibleType } from '../config/props';

export interface DummySpawn {
  /** The Hauler slot is always the big truck; car slots get a random light car each run. */
  def: 'hauler' | 'car';
  position: THREE.Vector3;
  yaw: number;
  /** Waypoint loop; empty means parked. */
  route: THREE.Vector3[];
  speed: number;
}

/** Point and heading on a road at parameter t. */
function roadPoint(road: number, t: number): { x: number; z: number; yaw: number } {
  const [x, z] = ROAD_PATHS[road](t);
  const [x2, z2] = ROAD_PATHS[road](t + 0.5);
  return { x, z, yaw: Math.atan2(x2 - x, z2 - z) };
}

/** Offset sideways from a road point (positive = to the left of travel). */
function beside(road: number, t: number, offset: number): { x: number; z: number; yaw: number } {
  const p = roadPoint(road, t);
  // Left of heading (sin yaw, cos yaw) is (cos yaw, -sin yaw) in this convention.
  return { x: p.x + Math.cos(p.yaw) * offset, z: p.z - Math.sin(p.yaw) * offset, yaw: p.yaw };
}

/** Builds the arena: terrain, static obstacles, destructibles and dummy spawns. */
export class GameWorld {
  readonly terrain = new Terrain();
  readonly statics: Statics;
  readonly destructibles: Destructibles;
  readonly group = new THREE.Group();
  readonly playerSpawn: { position: THREE.Vector3; yaw: number };
  readonly dummies: DummySpawn[] = [];
  /** Candidate extraction points near the map edge. */
  readonly extractPoints: THREE.Vector3[] = [];

  constructor(R: Rapier, world: RAPIER.World, debris: DebrisSystem) {
    const terrain = this.terrain;
    terrain.addPhysics(R, world);
    this.statics = new Statics(R, world, terrain);
    this.destructibles = new Destructibles(R, world, terrain, debris);

    const sp = roadPoint(0, -20);
    this.playerSpawn = { position: new THREE.Vector3(sp.x, terrain.heightAt(sp.x, sp.z) + 1.5, sp.z), yaw: sp.yaw };

    this.layout();
    this.statics.finalize();
    this.destructibles.build();
    this.group.add(terrain.mesh, terrain.roadMesh, this.statics.mesh, this.statics.decor, this.destructibles.group);
  }

  private layout(): void {
    const t = this.terrain;
    const S = this.statics;
    const D = this.destructibles;
    const rnd = mulberry32(4242);

    // Landmarks.
    const b = beside(0, 70, 26);
    S.addBuilding(b.x, b.z, b.yaw);
    const tk = beside(1, -95, -20);
    S.addTanker(tk.x, tk.z, tk.yaw + 0.4);

    // Extraction candidates near the edges, mostly at road ends.
    for (const [x, z] of [
      [roadPoint(0, -110).x, roadPoint(0, -110).z],
      [roadPoint(0, 106).x, roadPoint(0, 106).z],
      [roadPoint(1, 108).x, roadPoint(1, 108).z],
      [95, -100],
      [-100, -95],
    ]) {
      this.extractPoints.push(new THREE.Vector3(x, t.heightAt(x, z), z));
    }

    // Rock clusters away from roads, the spawn and extraction points.
    const rocks: [number, number][] = [
      [-6, -30],
      [40, -18],
      [-35, 70],
    ];
    let guard = 0;
    while (rocks.length < 14 && guard++ < 2000) {
      const x = (rnd() - 0.5) * (t.size - 90);
      const z = (rnd() - 0.5) * (t.size - 90);
      if (t.roadDistance(x, z) < 15) continue;
      if (Math.hypot(x - this.playerSpawn.position.x, z - this.playerSpawn.position.z) < 25) continue;
      if (rocks.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 30)) continue;
      if (this.extractPoints.some((e) => Math.hypot(e.x - x, e.z - z) < 22)) continue;
      rocks.push([x, z]);
    }
    for (const [x, z] of rocks) {
      if (t.roadDistance(x, z) < 12) continue;
      S.addRockCluster(x, z, 3 + Math.floor(rnd() * 3), 0.8 + rnd() * 0.6);
    }

    // Fences lining the road ahead of the spawn.
    for (let s = 0; s < 14; s++) {
      const p = beside(0, 10 + s * 4.1, -10);
      D.add('fence', p.x, p.z, p.yaw + Math.PI / 2);
    }
    // A corral of fences with barrels inside.
    const cx = 25;
    const cz = -35;
    for (let i = 0; i < 6; i++) {
      D.add('fence', cx - 12 + 2 + i * 4, cz - 12, 0);
      D.add('fence', cx - 12 + 2 + i * 4, cz + 12, 0);
      if (i !== 2 && i !== 3) {
        D.add('fence', cx - 12, cz - 12 + 2 + i * 4, Math.PI / 2);
        D.add('fence', cx + 12, cz - 12 + 2 + i * 4, Math.PI / 2);
      }
    }
    this.barrelCluster(cx, cz, 9, 0.35);

    // Barrel stacks near the spawn, the building and the crossroads.
    const near = beside(0, 25, 13);
    this.barrelCluster(near.x, near.z, 6, 0.5);
    this.barrelCluster(b.x + 12, b.z - 4, 7, 0.4);
    const cross = roadPoint(0, -52);
    this.barrelCluster(cross.x + 14, cross.z + 12, 6, 0.5);

    // A scrap checkpoint across the crossroad.
    for (const [o, along] of [
      [-4, 0],
      [3, 6],
      [-1, 12],
    ]) {
      const p = beside(1, -70 + along, o);
      D.add('barricade', p.x, p.z, p.yaw + Math.PI / 2);
    }
    for (const o of [-6, 6]) {
      const p = beside(0, 92, o);
      D.add('barricade', p.x, p.z, p.yaw + Math.PI / 2 + o * 0.03);
    }

    // Road signs.
    for (const tt of [-105, -60, 0, 50, 100]) {
      const p = beside(0, tt, 9);
      D.add('sign', p.x, p.z, p.yaw);
    }
    for (const tt of [-100, -30, 70, 100]) {
      const p = beside(1, tt, -9);
      D.add('sign', p.x, p.z, p.yaw);
    }

    // Parked cars.
    const park = beside(0, 12, 12);
    this.dummies.push({ def: 'car', position: this.ground(park.x, park.z), yaw: park.yaw + 1.2, route: [], speed: 0 });
    const park2 = beside(0, 80, 14);
    this.dummies.push({ def: 'car', position: this.ground(park2.x, park2.z), yaw: park2.yaw - 0.8, route: [], speed: 0 });
    this.dummies.push({ def: 'car', position: this.ground(cx - 6, cz + 6), yaw: 2.2, route: [], speed: 0 });

    // The Hauler runs up and down the main road, using both lanes.
    const lane: THREE.Vector3[] = [];
    for (let s = -100; s <= 100; s += 20) {
      const p = beside(0, s, -3.5);
      lane.push(this.ground(p.x, p.z));
    }
    for (let s = 100; s >= -100; s -= 20) {
      const p = beside(0, s, 3.5);
      lane.push(this.ground(p.x, p.z));
    }
    this.dummies.push({ def: 'hauler', position: lane[8].clone(), yaw: roadPoint(0, 60).yaw, route: lane, speed: 10 });

    // A car loops the north half of the cross road, short of the checkpoint.
    const lane2: THREE.Vector3[] = [];
    for (let s = -35; s <= 105; s += 20) {
      const p = beside(1, s, -3.5);
      lane2.push(this.ground(p.x, p.z));
    }
    for (let s = 105; s >= -35; s -= 20) {
      const p = beside(1, s, 3.5);
      lane2.push(this.ground(p.x, p.z));
    }
    this.dummies.push({ def: 'car', position: lane2[4].clone(), yaw: roadPoint(1, 45).yaw, route: lane2, speed: 13 });

    // Another circles an open patch of sand.
    const circle: THREE.Vector3[] = [];
    const ccx = 60;
    const ccz = 20;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      circle.push(this.ground(ccx + Math.cos(a) * 28, ccz + Math.sin(a) * 28));
    }
    this.dummies.push({ def: 'car', position: circle[0].clone(), yaw: 0, route: circle, speed: 15 });
  }

  private barrelCluster(x: number, z: number, count: number, explosiveChance: number): void {
    const rnd = mulberry32(Math.floor(x * 13 + z * 7));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd();
      const r = i === 0 ? 0 : 1.2 + rnd() * 1.6;
      const type: DestructibleType = rnd() < explosiveChance ? 'explosiveBarrel' : 'barrel';
      this.destructibles.add(type, x + Math.cos(a) * r, z + Math.sin(a) * r, rnd() * 6);
    }
  }

  private ground(x: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, this.terrain.heightAt(x, z) + 1.4, z);
  }
}
