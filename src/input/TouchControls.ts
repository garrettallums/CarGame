import type { AnalogState, ButtonAction, InputSource } from './InputManager';
import { clamp } from '../core/math';

export type TouchLayout = 'stick' | 'buttons';

const STICK_RADIUS = 60;
const DEADZONE = 0.12;

/**
 * Floating left stick plus right-hand buttons. Uses pointer events so several
 * fingers work at once. The lower-right corner is left free for a future aim stick.
 */
export class TouchControls implements InputSource {
  readonly root: HTMLDivElement;
  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private vec = { x: 0, y: 0 };
  private held = new Set<string>();
  private presses: ButtonAction[] = [];
  private buttons = new Map<string, HTMLElement>();
  layout: TouchLayout;
  enabled = false;

  constructor(parent: HTMLElement, layout: TouchLayout) {
    this.layout = layout;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-zone"></div>
      <div class="t-stick-base"><div class="t-stick-knob"></div></div>
      <button class="t-btn t-boost" data-hold="boost">BOOST</button>
      <button class="t-btn t-hand" data-hold="handbrake">DRIFT</button>
      <button class="t-btn t-gas" data-hold="gas">GAS</button>
      <button class="t-btn t-brake" data-hold="brake">BRAKE</button>
      <button class="t-btn t-small t-reset" data-press="reset">&#8634;</button>
      <button class="t-btn t-small t-pause" data-press="pause">II</button>
      <button class="t-btn t-small t-tune" data-press="toggleTuning">&#9881;</button>
    `;
    parent.appendChild(this.root);
    this.zone = this.root.querySelector('.t-zone')!;
    this.base = this.root.querySelector('.t-stick-base')!;
    this.knob = this.root.querySelector('.t-stick-knob')!;

    this.zone.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.zone.addEventListener('pointermove', (e) => this.stickMove(e));
    const end = (e: PointerEvent) => this.stickUp(e);
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);

    this.root.querySelectorAll<HTMLElement>('[data-hold]').forEach((el) => {
      const name = el.dataset.hold!;
      this.buttons.set(name, el);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.held.add(name);
        el.classList.add('on');
      });
      const up = () => {
        this.held.delete(name);
        el.classList.remove('on');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    });
    this.root.querySelectorAll<HTMLElement>('[data-press]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.presses.push(el.dataset.press as ButtonAction);
      });
    });
    this.setLayout(layout);
  }

  setLayout(layout: TouchLayout): void {
    this.layout = layout;
    this.root.dataset.layout = layout;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.style.display = on ? 'block' : 'none';
    document.body.classList.toggle('touch', on);
  }

  private stickDown(e: PointerEvent): void {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.zone.setPointerCapture(e.pointerId);
    this.stickId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.vec = { x: 0, y: 0 };
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.base.classList.add('on');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // Drag the base along so the stick never "runs out".
      const over = len - STICK_RADIUS;
      this.origin.x += (dx / len) * over;
      this.origin.y += (dy / len) * over;
      this.base.style.left = `${this.origin.x}px`;
      this.base.style.top = `${this.origin.y}px`;
      dx = e.clientX - this.origin.x;
      dy = e.clientY - this.origin.y;
    }
    this.vec = { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS };
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.vec = { x: 0, y: 0 };
    this.base.classList.remove('on');
  }

  poll(out: AnalogState): void {
    if (!this.enabled) return;
    const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : Math.sign(v) * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE)));
    const x = clamp(dz(this.vec.x), -1, 1);
    const y = clamp(dz(this.vec.y), -1, 1);
    out.steer = x;
    if (this.layout === 'stick') {
      out.throttle = Math.max(0, -y);
      out.brake = Math.max(0, y);
    } else {
      out.throttle = this.held.has('gas') ? 1 : 0;
      out.brake = this.held.has('brake') ? 1 : 0;
    }
    out.handbrake = this.held.has('handbrake');
    out.boost = this.held.has('boost');
  }

  consumePresses(into: Set<ButtonAction>): void {
    for (const p of this.presses) into.add(p);
    this.presses.length = 0;
  }

  /** Visual state for the boost button. */
  setBoostLevel(frac: number): void {
    const el = this.buttons.get('boost');
    if (el) el.style.setProperty('--fill', `${Math.round(frac * 100)}%`);
  }
}
