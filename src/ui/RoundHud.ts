import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { ROUND } from '../config/round';
import type { Round } from '../game/Round';

const fmt = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const _p = new THREE.Vector3();

/** Run timer, Parts at risk, objectives, toasts and the extraction pointer. */
export class RoundHud {
  readonly root: HTMLDivElement;
  private timeEl: HTMLElement;
  private partsEl: HTMLElement;
  private extractEl: HTMLElement;
  private objEl: HTMLElement;
  private toastEl: HTMLElement;
  private countEl: HTMLElement;
  private arrowEl: HTMLElement;
  private holdEl: HTMLElement;
  private holdBar: HTMLElement;
  private lastObjKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'roundhud';
    this.root.innerHTML = `
      <div class="rh-bar">
        <div class="rh-time" title="Run time">0:00</div>
        <div class="rh-parts"><b>0</b><span>PARTS AT RISK</span></div>
        <div class="rh-extract"></div>
      </div>
      <ul class="rh-obj"></ul>
      <div class="rh-toasts"></div>
      <div class="rh-count"></div>
      <div class="rh-arrow"><svg viewBox="0 0 40 40" width="40" height="40"><path d="M20 4 L34 32 L20 25 L6 32 Z"/></svg><span></span></div>
      <div class="rh-hold"><span>EXTRACTING</span><div class="rh-hold-bar"><i></i></div></div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.timeEl = q('.rh-time');
    this.partsEl = q('.rh-parts b');
    this.extractEl = q('.rh-extract');
    this.objEl = q('.rh-obj');
    this.toastEl = q('.rh-toasts');
    this.countEl = q('.rh-count');
    this.arrowEl = q('.rh-arrow');
    this.holdEl = q('.rh-hold');
    this.holdBar = q('.rh-hold-bar i');

    bus.on('partsAwarded', (e) => {
      if (!e.label.startsWith('Objective')) this.toast(`+${e.amount} Parts`, e.label);
      this.partsEl.textContent = String(e.total);
      this.partsEl.parentElement!.classList.remove('bump');
      void this.partsEl.offsetWidth;
      this.partsEl.parentElement!.classList.add('bump');
    });
    bus.on('objectiveComplete', (e) => this.toast(`Objective complete  +${e.reward}`, e.label, 'gold'));
    bus.on('extractionOpen', () => this.toast('Extraction open', 'Reach the beacon to bank your Parts', 'teal'));
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.toastEl.innerHTML = '';
  }

  toast(title: string, detail: string, tone = ''): void {
    const el = document.createElement('div');
    el.className = `rh-toast ${tone}`;
    el.innerHTML = `<b></b><span></span>`;
    el.querySelector('b')!.textContent = title;
    el.querySelector('span')!.textContent = detail;
    this.toastEl.prepend(el);
    while (this.toastEl.children.length > 3) this.toastEl.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  update(round: Round, camera: THREE.Camera, playerPos: THREE.Vector3): void {
    this.partsEl.textContent = String(round.parts);
    this.timeEl.textContent = fmt(round.time);

    // Countdown.
    if (round.state === 'countdown') {
      const n = Math.ceil(round.countdown);
      this.countEl.textContent = n > 0 ? String(n) : 'GO';
      this.countEl.hidden = false;
    } else if (round.state === 'active' && round.time < 0.8) {
      this.countEl.textContent = 'GO';
      this.countEl.hidden = false;
    } else {
      this.countEl.hidden = true;
    }

    // Extraction status.
    let ex = '';
    if (round.state === 'dying') ex = 'WRECKED — Parts lost';
    else if (!round.extractOpen) ex = `Extract opens in ${fmt(round.extractIn)}`;
    else ex = `EXTRACT ${Math.round(playerPos.distanceTo(round.extractPos))} m`;
    if (this.extractEl.textContent !== ex) this.extractEl.textContent = ex;
    this.extractEl.classList.toggle('open', round.extractOpen && round.state !== 'dying');
    this.extractEl.classList.toggle('dead', round.state === 'dying');

    // Objectives list (rebuilt only when progress changes).
    const key = round.objectives.map((o) => `${o.def.id}:${o.progress}`).join('|');
    if (key !== this.lastObjKey) {
      this.lastObjKey = key;
      this.objEl.innerHTML = '';
      for (const o of round.objectives) {
        const li = document.createElement('li');
        li.className = o.done ? 'done' : '';
        const count = o.def.count > 1 ? ` ${o.progress}/${o.def.count}` : '';
        li.innerHTML = `<i></i><span></span><em></em>`;
        li.querySelector('span')!.textContent = `${o.def.label}${count}`;
        li.querySelector('em')!.textContent = `+${o.def.reward}`;
        this.objEl.appendChild(li);
      }
    }

    // Pointer to the extraction zone: on-screen label, or an arrow pinned to the screen edge.
    const inZone = round.extractHold > 0;
    if (round.extractOpen && round.state === 'active' && !inZone) {
      _p.copy(round.extractPos);
      _p.y += 3;
      _p.project(camera);
      const w = window.innerWidth;
      const h = window.innerHeight;
      const behind = _p.z > 1;
      let x = (_p.x * 0.5 + 0.5) * w;
      let y = (-_p.y * 0.5 + 0.5) * h;
      if (behind) {
        x = w - x;
        y = h - y;
      }
      const margin = 48;
      const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
      const cx = w / 2;
      const cy = h / 2;
      let ang = Math.atan2(y - cy, x - cx);
      if (!onScreen) {
        // Clamp to the screen rectangle along the ray from the centre.
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const tx = dx !== 0 ? (dx > 0 ? w - margin - cx : margin - cx) / dx : Infinity;
        const ty = dy !== 0 ? (dy > 0 ? h - margin - cy : margin - cy) / dy : Infinity;
        const t = Math.min(tx, ty);
        x = cx + dx * t;
        y = cy + dy * t;
      } else {
        ang = Math.PI / 2;
      }
      this.arrowEl.hidden = false;
      this.arrowEl.style.transform = `translate(${x}px, ${y}px)`;
      (this.arrowEl.firstElementChild as HTMLElement).style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      this.arrowEl.querySelector('span')!.textContent = `${Math.round(playerPos.distanceTo(round.extractPos))} m`;
    } else {
      this.arrowEl.hidden = true;
    }

    this.holdEl.hidden = !(round.extractHold > 0 && round.state === 'active');
    this.holdBar.style.width = `${Math.min(1, round.extractHold / ROUND.extractHold) * 100}%`;
  }
}
