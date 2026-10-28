export interface PauseActions {
  resume: () => void;
  flipCar: () => void;
  abandon: () => void;
  openTuning: () => void;
  toggleMute: () => boolean;
}

/** Pause overlay during a run. */
export class PauseMenu {
  readonly root: HTMLDivElement;
  open = false;
  private confirmAbandon = false;
  private abandonBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, actions: PauseActions) {
    this.root = document.createElement('div');
    this.root.id = 'pause';
    this.root.innerHTML = `
      <div class="pm-card">
        <h1>SAND <span>&amp;</span> STEEL</h1>
        <p class="pm-sub">Paused</p>
        <div class="pm-btns">
          <button data-a="resume" class="primary">Resume</button>
          <button data-a="flip">Flip car upright</button>
          <button data-a="abandon">Abandon run</button>
          <button data-a="openTuning">Tuning</button>
          <button data-a="mute">Sound: on</button>
        </div>
        <div class="pm-help">
          <div><b>Goal</b> Wreck cars and finish objectives for Parts. Parts are only yours once you reach the extraction beacon. Get wrecked and you lose them.</div>
          <div><b>Keyboard</b> WASD/arrows drive · Space drift · Shift boost · R flip upright · C camera · \` tuning · F3 debug · Esc pause</div>
          <div><b>Gamepad</b> LS steer · RT gas · LT brake · A drift · B boost · Y flip · Start pause</div>
          <div><b>Touch</b> drag anywhere on the left to drive · DRIFT and BOOST on the right</div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const btn = (a: string) => this.root.querySelector<HTMLButtonElement>(`[data-a=${a}]`)!;
    btn('resume').addEventListener('click', actions.resume);
    btn('flip').addEventListener('click', () => {
      actions.flipCar();
      actions.resume();
    });
    this.abandonBtn = btn('abandon');
    this.abandonBtn.addEventListener('click', () => {
      if (!this.confirmAbandon) {
        this.confirmAbandon = true;
        this.abandonBtn.textContent = 'Tap again: lose this run’s Parts';
        return;
      }
      actions.abandon();
    });
    btn('openTuning').addEventListener('click', actions.openTuning);
    btn('mute').addEventListener('click', () => {
      const muted = actions.toggleMute();
      btn('mute').textContent = `Sound: ${muted ? 'off' : 'on'}`;
    });
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.setOpen(false);
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('open', open);
    this.confirmAbandon = false;
    this.abandonBtn.textContent = 'Abandon run';
  }
}
