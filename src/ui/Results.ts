import type { RoundResult } from '../game/Round';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** End-of-run summary: what was earned and whether it was banked or lost. */
export class Results {
  readonly root: HTMLDivElement;
  onContinue: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'results';
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.hidden = true;
  }

  show(r: RoundResult, balance: number): void {
    const ok = r.extracted;
    const rows = r.ledger.length
      ? r.ledger.map((l) => `<li><span></span><b>+${l.amount}</b></li>`).join('')
      : '<li class="empty"><span>Nothing salvaged this run</span><b>0</b></li>';
    this.root.innerHTML = `
      <div class="rs-card ${ok ? 'ok' : 'lost'}">
        <div class="g-eyebrow">${ok ? 'Run complete' : 'Run failed'} · ${fmt(r.time)} · ${r.kills} wrecked</div>
        <h1>${ok ? 'Extracted' : 'Wrecked'}</h1>
        <ul class="rs-ledger">${rows}</ul>
        <ul class="rs-obj">${r.objectives
          .map((o) => `<li class="${o.done ? 'done' : ''}"><i></i><span></span><em>${o.done ? `+${o.def.reward}` : `${o.progress}/${o.def.count}`}</em></li>`)
          .join('')}</ul>
        <div class="rs-total">
          <span>${ok ? 'Banked' : 'Lost'}</span>
          <b>${r.haul}</b>
          <small>Parts${ok ? '' : ' — extract next time to keep them'}</small>
        </div>
        <div class="rs-balance">Garage balance: <b>${balance}</b> Parts</div>
        <button class="rs-go">Return to garage</button>
      </div>`;
    // Labels go in as text so nothing in them is parsed as markup.
    const spans = this.root.querySelectorAll<HTMLElement>('.rs-ledger li:not(.empty) span');
    r.ledger.forEach((l, i) => (spans[i].textContent = l.label));
    const objSpans = this.root.querySelectorAll<HTMLElement>('.rs-obj span');
    r.objectives.forEach((o, i) => (objSpans[i].textContent = o.def.label));
    this.root.querySelector('.rs-go')!.addEventListener('click', () => this.onContinue());
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }
}
