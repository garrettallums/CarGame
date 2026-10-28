/**
 * Fixed-timestep loop: physics runs at a constant rate, rendering runs every
 * animation frame and receives an interpolation factor between the last two
 * physics states.
 */
export class Loop {
  readonly dt: number;
  private acc = 0;
  private last = 0;
  private running = false;
  private rafId = 0;
  /** Physics steps are skipped while paused but frames still render. */
  paused = false;
  timeScale = 1;

  constructor(
    hz: number,
    private step: (dt: number) => void,
    private render: (alpha: number, frameDt: number) => void,
    private pre: (frameDt: number) => void = () => {},
    private maxStepsPerFrame = 5,
  ) {
    this.dt = 1 / hz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      this.tick(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Advance by wall-clock time. Exposed so tests can drive the loop manually. */
  tick(now: number): void {
    const frameDt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.pre(frameDt);
    if (!this.paused) {
      this.acc += frameDt * this.timeScale;
      let steps = 0;
      while (this.acc >= this.dt && steps < this.maxStepsPerFrame) {
        this.step(this.dt);
        this.acc -= this.dt;
        steps++;
      }
      // Drop time we could not catch up on rather than spiralling.
      if (steps === this.maxStepsPerFrame) this.acc = 0;
    }
    this.render(this.paused ? 1 : this.acc / this.dt, frameDt);
  }
}
