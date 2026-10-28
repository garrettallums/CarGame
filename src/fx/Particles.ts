import * as THREE from 'three';

export interface ParticleOptions {
  capacity: number;
  additive?: boolean;
  gravity: number;
  drag: number;
  /** Size at birth and death, metres. */
  size: [number, number];
  /** Alpha at birth and death. */
  alpha: [number, number];
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uScale / -mv.z, 256.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.15, d));
}`;

/** Pooled point-sprite particles. One draw call per system. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private sizeMul: Float32Array;
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private aAlpha: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private next = 0;
  readonly material: THREE.ShaderMaterial;

  constructor(private o: ParticleOptions) {
    const n = o.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.sizeMul = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aSize', this.aSize);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = o.additive ? 3 : 2;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, sizeMul = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.o.capacity;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.sizeMul[i] = sizeMul;
  }

  setScale(scale: number): void {
    this.material.uniforms.uScale.value = scale;
  }

  update(dt: number): void {
    const { gravity, drag, size, alpha } = this.o;
    const n = this.o.capacity;
    const dragF = Math.exp(-drag * dt);
    const ap = this.aPos.array as Float32Array;
    const ac = this.aCol.array as Float32Array;
    const aa = this.aAlpha.array as Float32Array;
    const as = this.aSize.array as Float32Array;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.vel[i3] *= dragF;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dragF + gravity * dt;
      this.vel[i3 + 2] *= dragF;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const c3 = count * 3;
      ap[c3] = this.pos[i3];
      ap[c3 + 1] = this.pos[i3 + 1];
      ap[c3 + 2] = this.pos[i3 + 2];
      ac[c3] = this.col[i3];
      ac[c3 + 1] = this.col[i3 + 1];
      ac[c3 + 2] = this.col[i3 + 2];
      // Quick fade-in avoids popping.
      aa[count] = (alpha[0] + (alpha[1] - alpha[0]) * t) * Math.min(1, t * 8);
      as[count] = (size[0] + (size[1] - size[0]) * t) * this.sizeMul[i];
      count++;
    }
    this.points.geometry.setDrawRange(0, count);
    if (count > 0) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aAlpha.needsUpdate = true;
      this.aSize.needsUpdate = true;
    }
  }

  get activeCount(): number {
    return this.points.geometry.drawRange.count;
  }

  clear(): void {
    this.life.fill(0);
    this.points.geometry.setDrawRange(0, 0);
  }
}
