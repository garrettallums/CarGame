import { UPGRADES, emptyUpgrades, type UpgradeId, type UpgradeLevels } from '../config/upgrades';

export interface ProgressData {
  /** Banked Parts, spendable in the garage. */
  parts: number;
  upgrades: UpgradeLevels;
  paint: number;
  runs: number;
  extractions: number;
  wrecks: number;
  bestHaul: number;
  totalEarned: number;
}

const KEY = 'sas.progress.v1';

const fresh = (): ProgressData => ({
  parts: 0,
  upgrades: emptyUpgrades(),
  paint: 0,
  runs: 0,
  extractions: 0,
  wrecks: 0,
  bestHaul: 0,
  totalEarned: 0,
});

/** Persistent garage progress, kept in localStorage when it is available. */
export class Progress {
  data: ProgressData;

  constructor() {
    this.data = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ProgressData>;
        this.data = { ...fresh(), ...saved, upgrades: { ...emptyUpgrades(), ...(saved.upgrades ?? {}) } };
      }
    } catch {
      // Storage blocked or corrupt: start fresh.
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Not persisted this session.
    }
  }

  level(id: UpgradeId): number {
    return this.data.upgrades[id] ?? 0;
  }

  /** Cost of the next level, or null when maxed. */
  nextCost(id: UpgradeId): number | null {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.level(id);
    return lvl < def.levels.length ? def.levels[lvl].cost : null;
  }

  buy(id: UpgradeId): boolean {
    const cost = this.nextCost(id);
    if (cost === null || cost > this.data.parts) return false;
    this.data.parts -= cost;
    this.data.upgrades[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  /** Refund one level at full price. Keeps experimenting cheap while balancing. */
  sell(id: UpgradeId): boolean {
    const lvl = this.level(id);
    if (lvl <= 0) return false;
    const def = UPGRADES.find((u) => u.id === id)!;
    this.data.parts += def.levels[lvl - 1].cost;
    this.data.upgrades[id] = lvl - 1;
    this.save();
    return true;
  }

  recordRun(extracted: boolean, haul: number): void {
    this.data.runs++;
    if (extracted) {
      this.data.extractions++;
      this.data.parts += haul;
      this.data.totalEarned += haul;
      this.data.bestHaul = Math.max(this.data.bestHaul, haul);
    } else {
      this.data.wrecks++;
    }
    this.save();
  }

  reset(): void {
    this.data = fresh();
    this.save();
  }
}
