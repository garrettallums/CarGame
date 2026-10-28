import * as THREE from 'three';
import { ParticleSystem } from './Particles';
import { TrackSystem } from './Tracks';
import { SURFACES } from '../config/surfaces';
import { DAMAGE } from '../config/physics';
import { bus } from '../core/EventBus';
import { rand } from '../core/math';
import type { Vehicle } from '../vehicle/Vehicle';

const DUST = new THREE.Color(0xd8a875);
const DUST_ROAD = new THREE.Color(0xb48a66);
const SMOKE = new THREE.Color(0x3a3532);
const SMOKE_LIGHT = new THREE.Color(0x8a8580);
const FIRE_A = new THREE.Color(0xff8a2a);
const FIRE_B = new THREE.Color(0xffd34d);
const SPARK = new THREE.Color(0xffd890);
const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

interface TrackState {
  last: THREE.Vector3 | null;
}

/** Dust, smoke, fire, sparks, tire tracks and explosion flashes. */
export class Effects {
  readonly dust = new ParticleSystem({ capacity: 600, gravity: 0.4, drag: 1.6, size: [1.4, 5.5], alpha: [0.42, 0] });
  readonly smoke = new ParticleSystem({ capacity: 400, gravity: 2.2, drag: 0.8, size: [1.0, 4], alpha: [0.38, 0] });
  readonly fire = new ParticleSystem({ capacity: 300, additive: true, gravity: 3.5, drag: 1.2, size: [1.6, 0.4], alpha: [0.9, 0] });
  readonly sparks = new ParticleSystem({ capacity: 300, additive: true, gravity: -14, drag: 0.6, size: [0.35, 0.12], alpha: [1, 0.2] });
  readonly tracks = new TrackSystem();
  readonly flash = new THREE.PointLight(0xff9a40, 0, 40, 1.6);
  readonly group = new THREE.Group();
  private flashTime = 0;
  private trackState = new Map<Vehicle, TrackState[]>();
  private emitAcc = new Map<Vehicle, { dust: number; smoke: number; fire: number }>();

  constructor() {
    this.group.add(this.tracks.mesh, this.dust.points, this.smoke.points, this.fire.points, this.sparks.points, this.flash);
    bus.on('collision', (e) => {
      if (e.metal && e.closingSpeed > 4) this.burstSparks(e.point, e.normal, Math.min(40, 6 + e.closingSpeed * 1.2));
      if (e.closingSpeed > 6) this.puff(e.point, Math.min(10, e.closingSpeed * 0.4), DUST);
    });
    bus.on('explosion', (e) => this.explode(e.position, e.radius));
    bus.on('propBroken', (e) => this.puff(e.position, 8, DUST));
    bus.on('vehiclePartLost', (e) => {
      const v = e.vehicle as Vehicle;
      this.burstSparks(v.position, _n.set(0, 1, 0), 18);
    });
  }

  setPointScale(scale: number): void {
    for (const s of [this.dust, this.smoke, this.fire, this.sparks]) s.setScale(scale);
  }

  burstSparks(at: THREE.Vector3, normal: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = rand(4, 12);
      this.sparks.emit(
        at.x,
        at.y + 0.3,
        at.z,
        normal.x * s * 0.6 + rand(-6, 6),
        Math.abs(normal.y) * s * 0.3 + rand(2, 8),
        normal.z * s * 0.6 + rand(-6, 6),
        rand(0.25, 0.6),
        SPARK,
      );
    }
  }

  puff(at: THREE.Vector3, count: number, color: THREE.Color): void {
    for (let i = 0; i < count; i++) {
      this.dust.emit(at.x + rand(-0.8, 0.8), at.y + rand(0, 0.5), at.z + rand(-0.8, 0.8), rand(-3, 3), rand(0.5, 2.5), rand(-3, 3), rand(0.8, 1.6), color, rand(0.8, 1.4));
    }
  }

  explode(at: THREE.Vector3, radius: number): void {
    const s = radius / 8;
    for (let i = 0; i < 45 * s; i++) {
      const v = rand(4, 14) * s;
      const a = rand(0, Math.PI * 2);
      _c.copy(FIRE_A).lerp(FIRE_B, Math.random());
      this.fire.emit(at.x, at.y + 0.8, at.z, Math.cos(a) * v, rand(2, 10), Math.sin(a) * v, rand(0.4, 0.9), _c, rand(1.5, 3) * s);
    }
    for (let i = 0; i < 30 * s; i++) {
      const v = rand(2, 7);
      const a = rand(0, Math.PI * 2);
      this.smoke.emit(at.x, at.y + 1, at.z, Math.cos(a) * v, rand(1, 5), Math.sin(a) * v, rand(1.8, 3.5), SMOKE, rand(1.4, 2.4) * s);
    }
    this.burstSparks(at, _n.set(0, 1, 0), 40);
    this.puff(at, 20, DUST);
    this.flash.position.set(at.x, at.y + 3, at.z);
    this.flashTime = 0.35;
  }

  /** Per-frame: emit continuous effects from vehicles and advance particles. */
  update(dt: number, vehicles: Vehicle[]): void {
    for (const v of vehicles) this.updateVehicle(dt, v);
    this.dust.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.sparks.update(dt);
    this.tracks.update(dt);
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.flash.intensity = this.flashTime > 0 ? (this.flashTime / 0.35) * 900 : 0;
  }

  private updateVehicle(dt: number, v: Vehicle): void {
    const ctrl = v.controller;
    let acc = this.emitAcc.get(v);
    if (!acc) {
      acc = { dust: 0, smoke: 0, fire: 0 };
      this.emitAcc.set(v, acc);
    }
    const S = SURFACES[ctrl.surface];
    const speedF = Math.min(1, ctrl.speed / Math.max(10, v.config.maxSpeed));
    const vel = v.prevLinvel;

    // Dust from the rear wheels.
    const dustRate = (speedF * 26 + ctrl.slip * 45 + (ctrl.boosting ? 15 : 0)) * S.dust * ctrl.grounded;
    acc.dust += dustRate * dt;
    while (acc.dust >= 1) {
      acc.dust -= 1;
      const w = ctrl.wheels[2 + (Math.random() < 0.5 ? 0 : 1)];
      if (!w.grounded) continue;
      const col = ctrl.surface === 'road' ? DUST_ROAD : DUST;
      this.dust.emit(
        w.contact.x + rand(-0.3, 0.3),
        w.contact.y + 0.2,
        w.contact.z + rand(-0.3, 0.3),
        -vel.x * 0.15 + rand(-1.5, 1.5),
        rand(0.5, 2.2),
        -vel.z * 0.15 + rand(-1.5, 1.5),
        rand(0.9, 1.9),
        col,
        0.7 + speedF * 0.8 + ctrl.slip * 0.5,
      );
    }

    // Engine smoke and fire.
    const front = v.damage.zoneFraction('front');
    const health = v.damage.fraction;
    const root = v.visual.root;
    const shape = v.def.shape;
    if (v.wrecked || front < DAMAGE.smokeBelow) {
      const intensity = v.wrecked ? Math.max(0.2, 1 - v.wreckAge / 40) : 1 - front / DAMAGE.smokeBelow;
      acc.smoke += (v.wrecked ? 3 + intensity * 5 : 4 + intensity * 10) * dt;
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        _p.set(rand(-0.3, 0.3), shape.height / 2 + 0.3, shape.length / 2 - 0.9);
        root.localToWorld(_p);
        _c.copy(SMOKE_LIGHT).lerp(SMOKE, v.wrecked ? 1 : intensity);
        this.smoke.emit(_p.x, _p.y, _p.z, vel.x * 0.3 + rand(-0.5, 0.5), rand(0.5, 1.5), vel.z * 0.3 + rand(-0.5, 0.5), rand(1.4, 2.6), _c, 0.6 + intensity * 0.6);
      }
    }
    const burning = v.wrecked ? v.wreckAge < 30 : health < DAMAGE.fireBelow;
    if (burning) {
      acc.fire += (v.wrecked ? 30 : 20) * dt;
      while (acc.fire >= 1) {
        acc.fire -= 1;
        _p.set(rand(-0.5, 0.5), shape.height / 2 + 0.2, rand(-0.5, shape.length / 2 - 0.6));
        root.localToWorld(_p);
        _c.copy(FIRE_A).lerp(FIRE_B, Math.random());
        this.fire.emit(_p.x, _p.y, _p.z, vel.x * 0.5 + rand(-0.6, 0.6), rand(1, 3), vel.z * 0.5 + rand(-0.6, 0.6), rand(0.35, 0.7), _c, rand(0.7, 1.2));
      }
    }

    // Tire tracks.
    let states = this.trackState.get(v);
    if (!states) {
      states = ctrl.wheels.map(() => ({ last: null }));
      this.trackState.set(v, states);
    }
    for (let i = 0; i < ctrl.wheels.length; i++) {
      const w = ctrl.wheels[i];
      const st = states[i];
      if (!w.grounded || w.lost) {
        st.last = null;
        continue;
      }
      // Front tracks only appear when sliding.
      if (w.front && ctrl.slip < 0.3) {
        st.last = null;
        continue;
      }
      if (!st.last) {
        st.last = w.contact.clone();
        continue;
      }
      const d = st.last.distanceTo(w.contact);
      if (d > 4) {
        st.last.copy(w.contact);
      } else if (d > 0.7) {
        const strength = Math.min(0.85, S.tracks * (0.6 + speedF * 0.4) + ctrl.slip * (ctrl.surface === 'sand' ? 0.5 : 0.35));
        this.tracks.addSegment(st.last, w.contact, w.normal, shape.wheelWidth * 1.1, strength);
        st.last.copy(w.contact);
      }
    }
  }

  forget(v: Vehicle): void {
    this.trackState.delete(v);
    this.emitAcc.delete(v);
  }

  clear(): void {
    this.dust.clear();
    this.smoke.clear();
    this.fire.clear();
    this.sparks.clear();
    this.tracks.clear();
    for (const states of this.trackState.values()) for (const s of states) s.last = null;
  }
}
