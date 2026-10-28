export interface SliderSpec {
  key: string;
  min: number;
  max: number;
  step: number;
  label?: string;
}

export interface TuningSection {
  id: string;
  title: string;
  /** Live object whose numeric fields the sliders edit. */
  target: Record<string, number>;
  sliders: SliderSpec[];
  onChange?: (key: string) => void;
}

export interface TuningOption {
  id: string;
  label: string;
  type: 'toggle' | 'select';
  choices?: { value: string; label: string }[];
  get: () => boolean | string;
  set: (v: boolean | string) => void;
}

const STORAGE_KEY = 'sas.tuning.v1';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or storage disabled: tuning simply won't persist.
  }
}

function decimals(step: number): number {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

/** Live sliders for every tunable value, persisted to localStorage. */
export class TuningPanel {
  readonly root: HTMLDivElement;
  private defaults = new Map<string, Record<string, number>>();
  private inputs = new Map<string, { input: HTMLInputElement; out: HTMLElement; spec: SliderSpec }>();
  private ioText: HTMLTextAreaElement;
  private status: HTMLElement;
  open = false;
  onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private sections: TuningSection[],
    private options: TuningOption[],
  ) {
    for (const s of sections) this.defaults.set(s.id, { ...s.target });
    this.load();

    this.root = document.createElement('div');
    this.root.id = 'tuning';
    this.root.innerHTML = `
      <div class="tn-head">
        <strong>Tuning</strong>
        <button class="tn-close" aria-label="Close">✕</button>
      </div>
      <div class="tn-body"></div>
    `;
    parent.appendChild(this.root);
    const body = this.root.querySelector('.tn-body')!;
    this.root.querySelector('.tn-close')!.addEventListener('click', () => this.setOpen(false));

    // Options first: they matter most on a phone.
    const opt = document.createElement('details');
    opt.open = true;
    opt.innerHTML = `<summary>Options</summary>`;
    for (const o of options) opt.appendChild(this.buildOption(o));
    body.appendChild(opt);

    for (const s of sections) {
      const det = document.createElement('details');
      det.open = s.id === 'vehicle';
      det.innerHTML = `<summary>${s.title}</summary>`;
      for (const spec of s.sliders) det.appendChild(this.buildSlider(s, spec));
      body.appendChild(det);
    }

    const io = document.createElement('details');
    io.innerHTML = `
      <summary>Save / Load</summary>
      <div class="tn-io">
        <div class="tn-row-btns">
          <button data-act="copy">Copy JSON</button>
          <button data-act="paste">Paste JSON</button>
          <button data-act="apply">Apply text</button>
          <button data-act="reset" class="danger">Reset defaults</button>
        </div>
        <textarea spellcheck="false" placeholder="Tuning JSON appears here"></textarea>
        <div class="tn-status"></div>
      </div>`;
    body.appendChild(io);
    this.ioText = io.querySelector('textarea')!;
    this.status = io.querySelector('.tn-status')!;
    io.querySelector('[data-act=copy]')!.addEventListener('click', () => this.exportJson());
    io.querySelector('[data-act=paste]')!.addEventListener('click', () => this.pasteJson());
    io.querySelector('[data-act=apply]')!.addEventListener('click', () => this.importJson(this.ioText.value));
    io.querySelector('[data-act=reset]')!.addEventListener('click', () => this.resetDefaults());

    // Keep game input from reacting to panel touches.
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) this.root.addEventListener(ev, (e) => e.stopPropagation());
    this.setOpen(false);
  }

  private buildSlider(section: TuningSection, spec: SliderSpec): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tn-row';
    const id = `${section.id}.${spec.key}`;
    row.innerHTML = `<span class="tn-label">${spec.label ?? spec.key}</span><output></output><input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    input.addEventListener('input', () => {
      section.target[spec.key] = Number(input.value);
      out.textContent = Number(input.value).toFixed(decimals(spec.step));
      section.onChange?.(spec.key);
      this.save();
    });
    this.inputs.set(id, { input, out, spec });
    this.syncOne(section, spec);
    return row;
  }

  private buildOption(o: TuningOption): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tn-row tn-opt';
    if (o.type === 'toggle') {
      row.innerHTML = `<span class="tn-label">${o.label}</span><input type="checkbox">`;
      const cb = row.querySelector('input')!;
      cb.checked = !!o.get();
      cb.addEventListener('change', () => o.set(cb.checked));
      row.dataset.opt = o.id;
    } else {
      row.innerHTML = `<span class="tn-label">${o.label}</span><select>${o.choices!.map((c) => `<option value="${c.value}">${c.label}</option>`).join('')}</select>`;
      const sel = row.querySelector('select')!;
      sel.value = String(o.get());
      sel.addEventListener('change', () => o.set(sel.value));
    }
    return row;
  }

  private syncOne(section: TuningSection, spec: SliderSpec): void {
    const e = this.inputs.get(`${section.id}.${spec.key}`);
    if (!e) return;
    const v = section.target[spec.key];
    e.input.value = String(v);
    e.out.textContent = v.toFixed(decimals(spec.step));
  }

  /** Refresh sliders and option controls from the live values. */
  sync(): void {
    for (const s of this.sections) for (const spec of s.sliders) this.syncOne(s, spec);
    this.root.querySelectorAll<HTMLLabelElement>('.tn-opt').forEach((row, i) => {
      const o = this.options[i];
      const input = row.querySelector('input');
      const sel = row.querySelector('select');
      if (input) input.checked = !!o.get();
      if (sel) sel.value = String(o.get());
    });
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('open', open);
    if (open) this.sync();
    else this.onClose();
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  snapshot(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const s of this.sections) out[s.id] = { ...s.target };
    return out;
  }

  private save(): void {
    storageSet(STORAGE_KEY, JSON.stringify(this.snapshot()));
  }

  private load(): void {
    const raw = storageGet(STORAGE_KEY);
    if (raw) this.apply(raw, false);
  }

  /** Apply a JSON string; unknown keys and non-numbers are ignored. */
  private apply(json: string, notify = true): boolean {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      return false;
    }
    if (!data || typeof data !== 'object') return false;
    for (const s of this.sections) {
      const src = (data as Record<string, unknown>)[s.id];
      if (!src || typeof src !== 'object') continue;
      for (const spec of s.sliders) {
        const v = (src as Record<string, unknown>)[spec.key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          s.target[spec.key] = v;
          if (notify) s.onChange?.(spec.key);
        }
      }
    }
    return true;
  }

  private exportJson(): void {
    const json = JSON.stringify(this.snapshot(), null, 2);
    this.ioText.value = json;
    const done = () => (this.status.textContent = 'Copied to clipboard.');
    const fail = () => {
      this.ioText.select();
      this.status.textContent = 'Clipboard blocked — the JSON is selected below, copy it manually.';
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(done, fail);
    else fail();
  }

  private pasteJson(): void {
    const fail = () => {
      this.status.textContent = 'Clipboard read blocked — paste into the box and press Apply text.';
    };
    if (!navigator.clipboard?.readText) return fail();
    navigator.clipboard.readText().then((text) => {
      this.ioText.value = text;
      this.importJson(text);
    }, fail);
  }

  private importJson(text: string): void {
    if (this.apply(text)) {
      this.save();
      this.sync();
      this.status.textContent = 'Tuning applied.';
    } else {
      this.status.textContent = 'That is not valid tuning JSON.';
    }
  }

  resetDefaults(): void {
    for (const s of this.sections) {
      Object.assign(s.target, this.defaults.get(s.id));
      for (const spec of s.sliders) s.onChange?.(spec.key);
    }
    this.save();
    this.sync();
    this.status.textContent = 'Defaults restored.';
  }
}
