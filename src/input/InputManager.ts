import { clamp } from '../core/math';

/** Continuous driving actions. Fire and aim are reserved for Phase 2. */
export interface AnalogState {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

/** One-shot actions, true for a single frame. */
export type ButtonAction = 'reset' | 'pause' | 'toggleTuning' | 'respawnWorld' | 'toggleDebug' | 'toggleCamera';

export interface InputSource {
  /** Write this source's contribution into `out`. */
  poll(out: AnalogState, dt: number): void;
  /** Return and clear button presses since the last poll. */
  consumePresses(into: Set<ButtonAction>): void;
}

/** Merges keyboard, gamepad and touch into abstract actions. */
export class InputManager {
  readonly state: AnalogState = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
  private pressed = new Set<ButtonAction>();
  private scratch: AnalogState = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
  /** Name of the source that last produced input, for HUD hints. */
  lastSource = 'keyboard';

  constructor(private sources: { name: string; source: InputSource }[]) {}

  update(dt: number): void {
    const s = this.state;
    s.throttle = 0;
    s.brake = 0;
    s.steer = 0;
    s.handbrake = false;
    s.boost = false;
    this.pressed.clear();
    for (const { name, source } of this.sources) {
      const o = this.scratch;
      o.throttle = 0;
      o.brake = 0;
      o.steer = 0;
      o.handbrake = false;
      o.boost = false;
      source.poll(o, dt);
      const active = o.throttle > 0.05 || o.brake > 0.05 || Math.abs(o.steer) > 0.05 || o.handbrake || o.boost;
      if (active) this.lastSource = name;
      s.throttle = Math.max(s.throttle, o.throttle);
      s.brake = Math.max(s.brake, o.brake);
      if (Math.abs(o.steer) > Math.abs(s.steer)) s.steer = o.steer;
      s.handbrake ||= o.handbrake;
      s.boost ||= o.boost;
      source.consumePresses(this.pressed);
    }
    s.throttle = clamp(s.throttle, 0, 1);
    s.brake = clamp(s.brake, 0, 1);
    s.steer = clamp(s.steer, -1, 1);
  }

  wasPressed(a: ButtonAction): boolean {
    return this.pressed.has(a);
  }

  /** Inject a press from UI buttons. */
  press(a: ButtonAction): void {
    this.pressed.add(a);
  }
}
