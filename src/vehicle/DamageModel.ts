import type { VehicleConfig } from '../config/vehicles';
import { DAMAGE } from '../config/physics';

export type DamageZone = 'front' | 'rear' | 'left' | 'right';
export const ZONES: DamageZone[] = ['front', 'rear', 'left', 'right'];

export interface HitResult {
  damage: number;
  zoneBroken: boolean;
  destroyed: boolean;
}

/** Integrity per zone plus overall integrity. */
export class DamageModel {
  readonly zoneHealth: Record<DamageZone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  readonly broken: Record<DamageZone, boolean> = { front: false, rear: false, left: false, right: false };
  health = 0;
  destroyed = false;

  constructor(private config: VehicleConfig) {
    this.repair();
  }

  get zoneMax(): number {
    return this.config.integrity * DAMAGE.zoneShare;
  }

  armor(zone: DamageZone): number {
    const c = this.config;
    const a = zone === 'front' ? c.armorFront : zone === 'rear' ? c.armorRear : c.armorSide;
    return Math.min(0.95, Math.max(0, a));
  }

  /** Apply raw damage to a zone. Armor absorbs a fraction of it. */
  hit(zone: DamageZone, raw: number): HitResult {
    if (this.destroyed || raw <= 0) return { damage: 0, zoneBroken: false, destroyed: false };
    const damage = raw * (1 - this.armor(zone));
    this.zoneHealth[zone] = Math.max(0, this.zoneHealth[zone] - damage);
    this.health = Math.max(0, this.health - damage);
    let zoneBroken = false;
    if (!this.broken[zone] && this.zoneHealth[zone] <= 0) {
      this.broken[zone] = true;
      zoneBroken = true;
    }
    let destroyed = false;
    if (this.health <= 0) {
      this.destroyed = true;
      destroyed = true;
    }
    return { damage, zoneBroken, destroyed };
  }

  zoneFraction(zone: DamageZone): number {
    return this.zoneMax > 0 ? this.zoneHealth[zone] / this.zoneMax : 0;
  }

  get fraction(): number {
    return this.config.integrity > 0 ? this.health / this.config.integrity : 0;
  }

  repair(): void {
    for (const z of ZONES) {
      this.zoneHealth[z] = this.zoneMax;
      this.broken[z] = false;
    }
    this.health = this.config.integrity;
    this.destroyed = false;
  }
}
