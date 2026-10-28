import * as THREE from 'three';
import { ROUND, WRECK_REWARDS, MAIN_OBJECTIVE, SIDE_OBJECTIVES, type ObjectiveDef } from '../config/round';
import { bus } from '../core/EventBus';
import type { Vehicle } from '../vehicle/Vehicle';
import type { Destructible } from '../world/Destructibles';

export type RoundState = 'idle' | 'countdown' | 'active' | 'dying' | 'ended';

export interface ObjectiveProgress {
  def: ObjectiveDef;
  progress: number;
  done: boolean;
}

export interface LedgerEntry {
  label: string;
  amount: number;
}

export interface RoundResult {
  extracted: boolean;
  /** Parts earned this run (banked only if extracted). */
  haul: number;
  ledger: LedgerEntry[];
  objectives: ObjectiveProgress[];
  time: number;
  kills: number;
}

const _v = new THREE.Vector3();

/**
 * One run on the map: countdown, objectives, Parts at risk, and extraction.
 * Parts collected here are only kept if the player reaches the extraction zone.
 */
export class Round {
  state: RoundState = 'idle';
  /** Seconds since the countdown ended. */
  time = 0;
  countdown = 0;
  parts = 0;
  kills = 0;
  ledger: LedgerEntry[] = [];
  objectives: ObjectiveProgress[] = [];
  extractOpen = false;
  extractPos = new THREE.Vector3();
  /** Seconds spent inside the zone so far. */
  extractHold = 0;
  private dyingTime = 0;
  readonly zone: THREE.Group;
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  onEnd: (r: RoundResult) => void = () => {};

  constructor(
    private extractPoints: THREE.Vector3[],
    private heightAt: (x: number, z: number) => number,
  ) {
    this.zone = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5fe3cf, transparent: true, opacity: 0.85, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(ROUND.extractRadius - 0.8, ROUND.extractRadius, 48).rotateX(-Math.PI / 2), ringMat);
    this.ring.renderOrder = 4;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x5fe3cf,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // A thin pillar of light: visible from a distance without washing out the ground.
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 34, 12, 1, true).translate(0, 17, 0), beamMat);
    this.beam.renderOrder = 4;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(ROUND.extractRadius - 0.8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5fe3cf, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.zone.add(this.ring, this.beam, fill);
    this.zone.visible = false;

    bus.on('vehicleDestroyed', (e) => this.onVehicleDestroyed(e.vehicle as Vehicle, e.isPlayer));
    bus.on('propBroken', (e) => this.onPropBroken(e.prop as Destructible));
  }

  get live(): boolean {
    return this.state === 'countdown' || this.state === 'active';
  }

  /** Time until extraction opens, or 0 when open. */
  get extractIn(): number {
    return Math.max(0, ROUND.extractUnlock - this.time);
  }

  start(): void {
    this.state = 'countdown';
    this.countdown = ROUND.countdown;
    this.time = 0;
    this.parts = 0;
    this.kills = 0;
    this.ledger = [];
    this.extractOpen = false;
    this.extractHold = 0;
    this.dyingTime = 0;
    this.zone.visible = false;
    const pool = [...SIDE_OBJECTIVES].sort(() => Math.random() - 0.5).slice(0, 2);
    this.objectives = [MAIN_OBJECTIVE, ...pool].map((def) => ({ def, progress: 0, done: false }));
  }

  /** Stop without a result, e.g. when returning to the garage. */
  stop(): void {
    this.state = 'idle';
    this.zone.visible = false;
  }

  abandon(): void {
    if (this.state === 'idle' || this.state === 'ended') return;
    this.finish(false);
  }

  private award(amount: number, label: string): void {
    if (!this.live || amount <= 0) return;
    this.parts += amount;
    this.ledger.push({ label, amount });
    bus.emit('partsAwarded', { amount, label, total: this.parts });
  }

  private advance(match: (o: ObjectiveProgress) => boolean): void {
    for (const o of this.objectives) {
      if (o.done || !match(o)) continue;
      o.progress = Math.min(o.def.count, o.progress + 1);
      if (o.progress >= o.def.count) {
        o.done = true;
        bus.emit('objectiveComplete', { label: o.def.label, reward: o.def.reward });
        this.award(o.def.reward, `Objective: ${o.def.label}`);
      }
    }
  }

  private onVehicleDestroyed(v: Vehicle, isPlayer: boolean): void {
    if (isPlayer) {
      if (this.live) {
        this.state = 'dying';
        this.dyingTime = 0;
      }
      return;
    }
    if (!this.live) return;
    this.kills++;
    this.award(WRECK_REWARDS[v.def.id] ?? 10, `${v.def.name} wrecked`);
    this.advance((o) => o.def.spec.kind === 'wreckCount');
    this.advance((o) => o.def.spec.kind === 'destroyVehicle' && o.def.spec.vehicle === v.def.id);
  }

  private onPropBroken(d: Destructible): void {
    if (!this.live) return;
    this.advance((o) => o.def.spec.kind === 'breakProp' && o.def.spec.prop === d.type);
  }

  private openExtraction(player: THREE.Vector3): void {
    this.extractOpen = true;
    // Pick one of the far points so extraction means a drive.
    const ranked = [...this.extractPoints].sort((a, b) => b.distanceTo(player) - a.distanceTo(player));
    const pick = ranked[Math.floor(Math.random() * Math.min(2, ranked.length))];
    this.extractPos.copy(pick);
    this.extractPos.y = this.heightAt(pick.x, pick.z);
    this.zone.position.copy(this.extractPos);
    this.zone.position.y += 0.15;
    this.zone.visible = true;
    bus.emit('extractionOpen', { position: this.extractPos.clone() });
  }

  /** Called every physics step. */
  update(dt: number, player: Vehicle): void {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'active';
      return;
    }
    if (this.state === 'dying') {
      this.dyingTime += dt;
      if (this.dyingTime >= ROUND.deathDelay) this.finish(false);
      return;
    }
    if (this.state !== 'active') return;
    this.time += dt;
    if (!this.extractOpen && this.time >= ROUND.extractUnlock) this.openExtraction(player.interp.pos);
    if (this.extractOpen) {
      const p = player.interp.pos;
      const inside = _v.set(p.x - this.extractPos.x, 0, p.z - this.extractPos.z).length() < ROUND.extractRadius;
      this.extractHold = inside ? this.extractHold + dt : 0;
      if (this.extractHold >= ROUND.extractHold) this.finish(true);
    }
  }

  /** Per frame: pulse the beacon. */
  animate(t: number): void {
    if (!this.zone.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.4;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + pulse * 0.15;
    // The pillar is for finding the zone; inside it, it would only cover the car.
    this.beam.visible = this.extractHold <= 0;
    this.ring.scale.setScalar(1 + (this.extractHold > 0 ? 0.04 * Math.sin(t * 20) : 0));
  }

  private finish(extracted: boolean): void {
    this.state = 'ended';
    this.zone.visible = false;
    this.onEnd({
      extracted,
      haul: this.parts,
      ledger: this.ledger,
      objectives: this.objectives,
      time: this.time,
      kills: this.kills,
    });
  }
}
