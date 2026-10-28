import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/** FPS counter and physics collider wireframes. */
export class Debug {
  readonly fpsEl: HTMLDivElement;
  readonly lines: THREE.LineSegments;
  showFps = false;
  showColliders = false;
  private frames = 0;
  private acc = 0;
  fps = 0;

  constructor(parent: HTMLElement) {
    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'fps';
    this.fpsEl.style.display = 'none';
    parent.appendChild(this.fpsEl);
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
  }

  setFps(on: boolean): void {
    this.showFps = on;
    this.fpsEl.style.display = on ? 'block' : 'none';
  }

  setColliders(on: boolean): void {
    this.showColliders = on;
    this.lines.visible = on;
  }

  update(dt: number, world: RAPIER.World, extra = ''): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      if (this.showFps) this.fpsEl.textContent = `${this.fps.toFixed(0)} FPS ${extra}`;
    }
    if (this.showColliders) {
      const { vertices, colors } = world.debugRender();
      const g = this.lines.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    }
  }
}
