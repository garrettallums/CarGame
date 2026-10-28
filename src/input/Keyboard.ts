import type { AnalogState, ButtonAction, InputSource } from './InputManager';
import { damp } from '../core/math';

const PRESS_MAP: Record<string, ButtonAction> = {
  KeyR: 'reset',
  Escape: 'pause',
  KeyP: 'pause',
  Backquote: 'toggleTuning',
  F3: 'toggleDebug',
  KeyC: 'toggleCamera',
};

/** WASD / arrows, Space handbrake, Shift boost. Digital steering is smoothed. */
export class Keyboard implements InputSource {
  private down = new Set<string>();
  private presses: ButtonAction[] = [];
  private steer = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (!e.repeat && PRESS_MAP[e.code]) this.presses.push(PRESS_MAP[e.code]);
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'F3') e.preventDefault();
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  poll(out: AnalogState, dt: number): void {
    out.throttle = this.any('KeyW', 'ArrowUp') ? 1 : 0;
    out.brake = this.any('KeyS', 'ArrowDown') ? 1 : 0;
    const target = (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0);
    // Ease in quickly, return to centre faster.
    const rate = target === 0 ? 14 : Math.sign(target) !== Math.sign(this.steer) ? 16 : 8;
    this.steer += (target - this.steer) * damp(rate, dt);
    if (Math.abs(this.steer) < 0.01) this.steer = 0;
    out.steer = this.steer;
    out.handbrake = this.any('Space');
    out.boost = this.any('ShiftLeft', 'ShiftRight');
  }

  consumePresses(into: Set<ButtonAction>): void {
    for (const p of this.presses) into.add(p);
    this.presses.length = 0;
  }
}
