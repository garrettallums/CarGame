import { UPGRADES, PAINTS, applyUpgrades, type ConfigDelta, type UpgradeId } from '../config/upgrades';
import type { VehicleConfig } from '../config/vehicles';
import { ROUND } from '../config/round';
import { WORLD } from '../config/world';
import type { Progress } from '../game/Progress';

export interface GarageActions {
  /** The loadout changed; rebuild the preview car. */
  changed: () => void;
  deploy: () => void;
  openTuning: () => void;
}

const MPH = 2.23694;

/** Human-readable summary of one upgrade level. */
function describe(delta: ConfigDelta, base: VehicleConfig): string {
  const out: string[] = [];
  const d = delta;
  if (d.enginePower) out.push(`+${Math.round((d.enginePower / base.enginePower) * 100)}% power`);
  if (d.maxSpeed) out.push(`${d.maxSpeed > 0 ? '+' : ''}${Math.round(d.maxSpeed * MPH)} mph top speed`);
  if (d.integrity) out.push(`+${d.integrity} integrity`);
  if (d.armorSide || d.armorFront || d.armorRear) {
    const a = Math.max(d.armorSide ?? 0, d.armorFront ?? 0, d.armorRear ?? 0);
    out.push(`+${Math.round(a * 100)}% armor`);
  }
  if (d.ramPower) out.push(`+${Math.round(d.ramPower * 100)}% ram damage`);
  if (d.grip) out.push(`+${Math.round((d.grip / base.grip) * 100)}% grip`);
  if (d.steerRate) out.push(`${d.steerRate > 0 ? '+' : ''}${Math.round((d.steerRate / base.steerRate) * 100)}% steering`);
  if (d.boostCapacity) out.push(`+${d.boostCapacity.toFixed(1)} s boost`);
  if (d.boostRecharge) out.push(`faster recharge`);
  if (d.mass) out.push(`+${d.mass} kg`);
  return out.join(' · ');
}

interface StatSpec {
  label: string;
  value: (c: VehicleConfig) => number;
  max: number;
  show: (c: VehicleConfig) => string;
}

const STATS: StatSpec[] = [
  { label: 'Top speed', value: (c) => c.maxSpeed, max: 50, show: (c) => `${Math.round(c.maxSpeed * MPH)} mph` },
  { label: 'Acceleration', value: (c) => c.enginePower / c.mass, max: 22, show: (c) => `${(c.enginePower / c.mass).toFixed(1)} m/s²` },
  { label: 'Handling', value: (c) => c.steerRate * c.grip, max: 45, show: (c) => (c.steerRate * c.grip).toFixed(0) },
  { label: 'Toughness', value: (c) => c.integrity * (1 + (c.armorFront + c.armorRear + 2 * c.armorSide) / 2), max: 420, show: (c) => `${Math.round(c.integrity)} hp` },
  { label: 'Ram', value: (c) => c.ramPower * (1 + c.armorFront) * (c.mass / 1200), max: 4.5, show: (c) => `×${c.ramPower.toFixed(2)}` },
  { label: 'Boost', value: (c) => c.boostCapacity, max: 6, show: (c) => `${c.boostCapacity.toFixed(1)} s` },
];

/** Garage: spend Parts on upgrades, pick paint, deploy into the next run. */
export class Garage {
  readonly root: HTMLDivElement;
  private partsEl: HTMLElement;
  private statsEl: HTMLElement;
  private upsEl: HTMLElement;
  private paintEl: HTMLElement;
  private recordEl: HTMLElement;
  private noteEl: HTMLElement;
  private confirmReset = false;

  constructor(
    parent: HTMLElement,
    private progress: Progress,
    private base: () => VehicleConfig,
    private actions: GarageActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'garage';
    this.root.innerHTML = `
      <aside class="g-panel">
        <header class="g-head">
          <div>
            <div class="g-eyebrow">Scrapyard</div>
            <h1>Garage</h1>
          </div>
          <div class="g-parts"><b>0</b><span>Parts</span></div>
        </header>
        <div class="g-note"></div>
        <section class="g-stats"></section>
        <h2>Upgrades</h2>
        <section class="g-ups"></section>
        <h2>Paint</h2>
        <section class="g-paint"></section>
        <footer class="g-record"></footer>
      </aside>
      <div class="g-deploy">
        <div class="g-map">
          <div class="g-eyebrow">Next run</div>
          <strong>${WORLD.name}</strong>
          <span>Hauler sighted · extraction opens after ${Math.floor(ROUND.extractUnlock / 60)}:${String(ROUND.extractUnlock % 60).padStart(2, '0')}</span>
        </div>
        <div class="g-deploy-btns">
          <button class="g-tune" aria-label="Tuning">Tuning</button>
          <button class="g-go">Deploy</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.partsEl = q('.g-parts b');
    this.statsEl = q('.g-stats');
    this.upsEl = q('.g-ups');
    this.paintEl = q('.g-paint');
    this.recordEl = q('.g-record');
    this.noteEl = q('.g-note');
    q('.g-go').addEventListener('click', () => this.actions.deploy());
    q('.g-tune').addEventListener('click', () => this.actions.openTuning());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.setOpen(false);
  }

  setOpen(open: boolean, note = ''): void {
    this.root.hidden = !open;
    if (open) {
      this.noteEl.textContent = note;
      this.noteEl.hidden = !note;
      this.render();
    }
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  render(): void {
    const p = this.progress;
    const base = this.base();
    const cfg = applyUpgrades(base, p.data.upgrades);
    this.partsEl.textContent = String(p.data.parts);

    this.statsEl.innerHTML = STATS.map((s) => {
      const f = Math.max(0.04, Math.min(1, s.value(cfg) / s.max));
      return `<div class="g-stat"><span>${s.label}</span><div class="g-meter"><i style="width:${(f * 100).toFixed(0)}%"></i></div><em>${s.show(cfg)}</em></div>`;
    }).join('');

    this.upsEl.innerHTML = '';
    for (const up of UPGRADES) {
      const lvl = p.level(up.id);
      const cost = p.nextCost(up.id);
      const card = document.createElement('div');
      card.className = 'g-card';
      const pips = up.levels.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const next = cost === null ? 'Fully upgraded' : `Next: ${describe(up.levels[lvl].delta, base)}`;
      card.innerHTML = `
        <div class="g-card-top">
          <strong>${up.name}</strong>
          <span class="g-pips" aria-label="Level ${lvl} of ${up.levels.length}">${pips}</span>
        </div>
        <div class="g-card-sub">${up.improves} · <span class="g-cost-note">${up.tradeoff}</span></div>
        <div class="g-card-next">${next}</div>
        <div class="g-card-btns">
          ${lvl > 0 ? `<button class="g-sell" data-id="${up.id}">Refund</button>` : ''}
          <button class="g-buy" data-id="${up.id}" ${cost === null || cost > p.data.parts ? 'disabled' : ''}>${cost === null ? 'Max' : `Install · ${cost}`}</button>
        </div>`;
      this.upsEl.appendChild(card);
    }
    this.upsEl.querySelectorAll<HTMLButtonElement>('.g-buy').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.progress.buy(b.dataset.id as UpgradeId)) {
          this.render();
          this.actions.changed();
        }
      }),
    );
    this.upsEl.querySelectorAll<HTMLButtonElement>('.g-sell').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.progress.sell(b.dataset.id as UpgradeId)) {
          this.render();
          this.actions.changed();
        }
      }),
    );

    this.paintEl.innerHTML = PAINTS.map(
      (c, i) =>
        `<button class="g-swatch ${i === p.data.paint ? 'on' : ''}" data-i="${i}" style="--c:#${c.color.toString(16).padStart(6, '0')}" aria-label="${c.name}" title="${c.name}"></button>`,
    ).join('');
    this.paintEl.querySelectorAll<HTMLButtonElement>('.g-swatch').forEach((b) =>
      b.addEventListener('click', () => {
        p.data.paint = Number(b.dataset.i);
        p.save();
        this.render();
        this.actions.changed();
      }),
    );

    const d = p.data;
    this.recordEl.innerHTML = `
      <span>${d.runs} runs</span><span>${d.extractions} extracted</span><span>Best haul ${d.bestHaul}</span>
      <button class="g-reset">${this.confirmReset ? 'Tap again to wipe progress' : 'Reset progress'}</button>`;
    this.recordEl.querySelector('.g-reset')!.addEventListener('click', () => {
      if (!this.confirmReset) {
        this.confirmReset = true;
        this.render();
        setTimeout(() => {
          this.confirmReset = false;
          if (this.open) this.render();
        }, 3000);
        return;
      }
      this.confirmReset = false;
      p.reset();
      this.render();
      this.actions.changed();
    });
  }
}
