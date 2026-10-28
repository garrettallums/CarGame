import * as THREE from 'three';

/**
 * A mesh whose vertices can be pushed in to make dents. Works in the space of
 * the mesh's parent (the vehicle root), so callers pass car-local points.
 */
export class DeformableMesh {
  readonly mesh: THREE.Mesh;
  private original: Float32Array;
  private offset: Float32Array;

  constructor(mesh: THREE.Mesh) {
    this.mesh = mesh;
    // Each deformable part owns its geometry so dents don't leak between cars.
    mesh.geometry = mesh.geometry.clone();
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setUsage(THREE.DynamicDrawUsage);
    this.original = Float32Array.from(pos.array as Float32Array);
    this.offset = new Float32Array(this.original.length);
  }

  /**
   * Push vertices near `point` along `dir` (both in parent space).
   * Returns true if any vertex moved.
   */
  dent(point: THREE.Vector3, dir: THREE.Vector3, radius: number, depth: number, maxDepth: number): boolean {
    const m = this.mesh;
    // Panels are only translated relative to the vehicle root.
    const lx = point.x - m.position.x;
    const ly = point.y - m.position.y;
    const lz = point.z - m.position.z;
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const off = this.offset;
    const orig = this.original;
    const r2 = radius * radius;
    const maxSq = maxDepth * maxDepth;
    let moved = false;
    for (let i = 0; i < arr.length; i += 3) {
      const dx = arr[i] - lx;
      const dy = arr[i + 1] - ly;
      const dz = arr[i + 2] - lz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      const amount = depth * f * f;
      // Stable per-position noise so duplicated vertices on box seams stay welded.
      const h = hash(orig[i], orig[i + 1], orig[i + 2]);
      const crumple = (h - 0.5) * 0.35 * amount;
      let ox = off[i] + dir.x * amount + crumple;
      let oy = off[i + 1] + dir.y * amount - Math.abs(crumple) * 0.5;
      let oz = off[i + 2] + dir.z * amount - crumple;
      const len2 = ox * ox + oy * oy + oz * oz;
      if (len2 > maxSq) {
        const s = maxDepth / Math.sqrt(len2);
        ox *= s;
        oy *= s;
        oz *= s;
      }
      off[i] = ox;
      off[i + 1] = oy;
      off[i + 2] = oz;
      arr[i] = orig[i] + ox;
      arr[i + 1] = orig[i + 1] + oy;
      arr[i + 2] = orig[i + 2] + oz;
      moved = true;
    }
    if (moved) {
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingSphere();
    }
    return moved;
  }

  /** Largest displacement of any vertex, for tests and debugging. */
  maxDisplacement(): number {
    let best = 0;
    const off = this.offset;
    for (let i = 0; i < off.length; i += 3) {
      const l = off[i] * off[i] + off[i + 1] * off[i + 1] + off[i + 2] * off[i + 2];
      if (l > best) best = l;
    }
    return Math.sqrt(best);
  }

  repair(): void {
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(this.original);
    this.offset.fill(0);
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
