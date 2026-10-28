import type { Vehicle } from '../vehicle/Vehicle';
import { ZONES, type DamageZone } from '../vehicle/DamageModel';

const ZONE_SHAPES: Record<DamageZone, string> = {
  front: 'M8 4 L32 4 L28 16 L12 16 Z',
  rear: 'M12 54 L28 54 L32 66 L8 66 Z',
  // Car points up, so its left side is on the screen's left.
  left: 'M6 8 L11 18 L11 52 L6 62 Z',
  right: 'M34 8 L29 18 L29 52 L34 62 Z',
};

function zoneColor(frac: number, broken: boolean): string {
  if (broken) return '#3a3330';
  if (frac > 0.66) return '#8fb35a';
  if (frac > 0.33) return '#e0b13c';
  return '#d4462c';
}

/** Speed, damage silhouette, boost meter and critical warnings. */
export class Hud {
  readonly root: HTMLDivElement;
  private speedEl: HTMLElement;
  private boostEl: HTMLElement;
  private zoneEls = new Map<DamageZone, SVGPathElement>();
  private warnEl: HTMLElement;
  private healthEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-card">
        <svg class="hud-car" viewBox="0 0 40 70" width="34" height="60">
          <rect x="12" y="17" width="16" height="36" rx="2" fill="#2b2622" stroke="#000" stroke-opacity=".4"/>
          ${ZONES.map((z) => `<path data-zone="${z}" d="${ZONE_SHAPES[z]}" fill="#8fb35a" stroke="#000" stroke-opacity=".35"/>`).join('')}
        </svg>
        <div class="hud-main">
          <div class="hud-speed"><span class="v">0</span><span class="u">MPH</span></div>
          <div class="hud-bar hud-health"><i></i></div>
          <div class="hud-bar hud-boost"><i></i></div>
        </div>
      </div>
      <div class="hud-warn"></div>
    `;
    parent.appendChild(this.root);
    this.speedEl = this.root.querySelector('.hud-speed .v')!;
    this.boostEl = this.root.querySelector('.hud-boost i')!;
    this.healthEl = this.root.querySelector('.hud-health i')!;
    this.warnEl = this.root.querySelector('.hud-warn')!;
    this.root.querySelectorAll<SVGPathElement>('path[data-zone]').forEach((p) => this.zoneEls.set(p.dataset.zone as DamageZone, p));
  }

  update(v: Vehicle): void {
    const mph = Math.round(Math.abs(v.controller.forwardSpeed) * 2.23694);
    this.speedEl.textContent = String(mph);
    const boost = v.config.boostCapacity > 0 ? v.controller.boost / v.config.boostCapacity : 0;
    this.boostEl.style.width = `${boost * 100}%`;
    this.boostEl.parentElement!.classList.toggle('active', v.controller.boosting);
    const health = v.damage.fraction;
    this.healthEl.style.width = `${health * 100}%`;
    this.healthEl.style.background = zoneColor(health, false);
    for (const z of ZONES) {
      this.zoneEls.get(z)!.setAttribute('fill', zoneColor(v.damage.zoneFraction(z), v.damage.broken[z]));
    }
    let warn = '';
    if (v.wrecked) warn = 'WRECKED';
    else if (health < 0.25) warn = 'ON FIRE';
    else if (v.damage.zoneFraction('front') < 0.4) warn = 'ENGINE FAILING';
    if (this.warnEl.textContent !== warn) this.warnEl.textContent = warn;
    this.warnEl.style.display = warn ? 'block' : 'none';
  }
}
