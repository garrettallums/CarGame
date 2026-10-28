export interface PauseActions {
  resume: () => void;
  resetCar: () => void;
  respawnWorld: () => void;
  openTuning: () => void;
  toggleMute: () => boolean;
}

/** Pause overlay with the few actions Phase 1 needs. */
export class PauseMenu {
  readonly root: HTMLDivElement;
  open = false;

  constructor(parent: HTMLElement, actions: PauseActions) {
    this.root = document.createElement('div');
    this.root.id = 'pause';
    this.root.innerHTML = `
      <div class="pm-card">
        <h1>SAND <span>&amp;</span> STEEL</h1>
        <p class="pm-sub">Phase 1 — driving &amp; crash sandbox</p>
        <div class="pm-btns">
          <button data-a="resume" class="primary">Resume</button>
          <button data-a="resetCar">Repair &amp; reset car</button>
          <button data-a="respawnWorld">Respawn dummies &amp; props</button>
          <button data-a="openTuning">Tuning</button>
          <button data-a="mute">Sound: on</button>
        </div>
        <div class="pm-help">
          <div><b>Keyboard</b> WASD/arrows drive · Space drift · Shift boost · R reset · T respawn world · C camera · \` tuning · F3 debug · Esc pause</div>
          <div><b>Gamepad</b> LS steer · RT gas · LT brake · A drift · B boost · Y reset · X respawn world · Start pause</div>
          <div><b>Touch</b> drag anywhere on the left to drive · DRIFT and BOOST on the right</div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const btn = (a: string) => this.root.querySelector<HTMLButtonElement>(`[data-a=${a}]`)!;
    btn('resume').addEventListener('click', actions.resume);
    btn('resetCar').addEventListener('click', () => {
      actions.resetCar();
      actions.resume();
    });
    btn('respawnWorld').addEventListener('click', () => {
      actions.respawnWorld();
      actions.resume();
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
  }
}
