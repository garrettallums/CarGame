import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aStrength;
uniform float uTime;
uniform float uLife;
varying float vAlpha;
void main() {
  float age = clamp((uTime - aBirth) / uLife, 0.0, 1.0);
  vAlpha = aStrength * (1.0 - age * age);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha);
}`;

/** Tire tracks as quads in a ring buffer that fade with age. */
export class TrackSystem {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private birth: Float32Array;
  private strength: Float32Array;
  private next = 0;
  private dirty = false;
  private time = 0;
  private material: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;

  constructor(
    private capacity = 1800,
    life = 25,
  ) {
    const v = capacity * 4;
    this.positions = new Float32Array(v * 3);
    this.birth = new Float32Array(v).fill(-1e6);
    this.strength = new Float32Array(v);
    const idx = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const b = i * 4;
      idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aStrength', new THREE.BufferAttribute(this.strength, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uLife: { value: life }, uColor: { value: new THREE.Color(0x4a2a14) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  addSegment(a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3, width: number, strength: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    // Perpendicular in the ground plane.
    const px = (-dz / len) * width * 0.5;
    const pz = (dx / len) * width * 0.5;
    const lift = 0.05;
    const ox = normal.x * lift;
    const oy = normal.y * lift;
    const oz = normal.z * lift;
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const p = this.positions;
    const o = i * 12;
    p[o] = a.x + px + ox;
    p[o + 1] = a.y + oy;
    p[o + 2] = a.z + pz + oz;
    p[o + 3] = a.x - px + ox;
    p[o + 4] = a.y + oy;
    p[o + 5] = a.z - pz + oz;
    p[o + 6] = b.x + px + ox;
    p[o + 7] = b.y + oy;
    p[o + 8] = b.z + pz + oz;
    p[o + 9] = b.x - px + ox;
    p[o + 10] = b.y + oy;
    p[o + 11] = b.z - pz + oz;
    for (let k = 0; k < 4; k++) {
      this.birth[i * 4 + k] = this.time;
      this.strength[i * 4 + k] = strength;
    }
    this.dirty = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (this.dirty) {
      this.dirty = false;
      this.geo.getAttribute('position').needsUpdate = true;
      this.geo.getAttribute('aBirth').needsUpdate = true;
      this.geo.getAttribute('aStrength').needsUpdate = true;
    }
  }

  clear(): void {
    this.birth.fill(-1e6);
    this.dirty = true;
  }
}
