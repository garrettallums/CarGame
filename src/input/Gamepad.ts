import type { AnalogState, ButtonAction, InputSource } from './InputManager';

const DEADZONE = 0.15;
const BUTTONS: [number, ButtonAction][] = [
  [3, 'reset'],
  [9, 'pause'],
  [8, 'toggleTuning'],
];

/** Standard-mapping gamepad: left stick steer, triggers throttle/brake, A handbrake, B boost. */
export class GamepadInput implements InputSource {
  private prev = new Map<number, boolean>();
  private presses: ButtonAction[] = [];

  poll(out: AnalogState): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const x = pad.axes[0] ?? 0;
      out.steer = Math.abs(x) > DEADZONE ? Math.sign(x) * ((Math.abs(x) - DEADZONE) / (1 - DEADZONE)) : 0;
      out.throttle = pad.buttons[7]?.value ?? 0;
      out.brake = pad.buttons[6]?.value ?? 0;
      out.handbrake = !!pad.buttons[0]?.pressed;
      out.boost = !!pad.buttons[1]?.pressed;
      for (const [i, action] of BUTTONS) {
        const now = !!pad.buttons[i]?.pressed;
        if (now && !this.prev.get(i)) this.presses.push(action);
        this.prev.set(i, now);
      }
      break;
    }
  }

  consumePresses(into: Set<ButtonAction>): void {
    for (const p of this.presses) into.add(p);
    this.presses.length = 0;
  }
}
