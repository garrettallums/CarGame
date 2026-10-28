import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { bus } from './EventBus';
import { Loop } from './Loop';
import type { Rapier } from './Physics';
import type { GameContext } from './Context';
import { clamp, rand } from './math';
import { PHYSICS, DAMAGE } from '../config/physics';
import { CAMERA } from '../config/camera';
import { WORLD } from '../config/world';
import { DESTRUCTIBLES } from '../config/props';
import { PLAYER_CAR, DUMMY_BUGGY, DUMMY_SEDAN, DUMMY_TRUCK } from '../config/vehicles';
import { GameWorld } from '../world/World';
import type { Destructible } from '../world/Destructibles';
import { DebrisSystem } from '../fx/Debris';
import { Effects } from '../fx/Effects';
import { CameraRig } from '../camera/CameraRig';
import { Vehicle } from '../vehicle/Vehicle';
import { VehicleFactory } from '../vehicle/VehicleFactory';
import { WaypointDriver } from '../vehicle/WaypointDriver';
import { InputManager } from '../input/InputManager';
import { Keyboard } from '../input/Keyboard';
import { GamepadInput } from '../input/Gamepad';
import { TouchControls, type TouchLayout } from '../input/TouchControls';
import { Hud } from '../ui/Hud';
import { TuningPanel, type TuningSection } from '../ui/TuningPanel';
import { PauseMenu } from '../ui/PauseMenu';
import { Debug } from '../ui/Debug';
import { AudioEngine } from '../audio/AudioEngine';

type Owner = { kind: 'vehicle'; v: Vehicle } | { kind: 'prop'; d: Destructible } | { kind: 'static' } | { kind: 'terrain' };

interface QueuedExplosion {
  pos: THREE.Vector3;
  radius: number;
  speed: number;
  damage: number;
  at: number;
}

interface Settings {
  touchLayout: TouchLayout;
  muted: boolean;
  showFps: boolean;
  showColliders: boolean;
}

const SETTINGS_KEY = 'sas.settings.v1';
const DEFAULT_SETTINGS: Settings = { touchLayout: 'stick', muted: false, showFps: false, showColliders: false };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Storage unavailable: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly loop: Loop;
  readonly rig: CameraRig;
  readonly gw: GameWorld;
  readonly debris: DebrisSystem;
  readonly fx: Effects;
  readonly player: Vehicle;
  readonly dummies: Vehicle[] = [];
  readonly drivers: WaypointDriver[] = [];
  readonly vehicles: Vehicle[] = [];
  readonly input: InputManager;
  readonly touch: TouchControls;
  readonly hud: Hud;
  readonly tuning: TuningPanel;
  readonly pause: PauseMenu;
  readonly debug: Debug;
  readonly audio = new AudioEngine();
  readonly settings: Settings;
  private sun: THREE.DirectionalLight;
  private owners = new Map<number, Owner>();
  private cooldowns = new Map<string, number>();
  private explosions: QueuedExplosion[] = [];
  private time = 0;
  /** Counters for automated tests. */
  readonly stats = { collisions: 0, vehicleHits: 0, propsBroken: 0, explosions: 0, partsLost: 0, wrecks: 0 };

  constructor(
    R: Rapier,
    container: HTMLElement,
  ) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0xe7b98c);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, WORLD.fogNear, WORLD.fogFar);
    this.scene.add(new THREE.HemisphereLight(0xffe6c4, 0x7a4a2e, 0.95));
    this.sun = new THREE.DirectionalLight(0xffd7a6, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -55;
    sc.right = 55;
    sc.top = 55;
    sc.bottom = -55;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Physics world.
    this.world = new R.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
    this.world.timestep = 1 / 60;
    this.eventQueue = new R.EventQueue(true);

    this.debris = new DebrisSystem(R, this.world);
    this.gw = new GameWorld(R, this.world, this.debris);
    this.scene.add(this.gw.group, this.debris.group);
    this.owners.set(this.gw.terrain.collider.handle, { kind: 'terrain' });
    for (const d of this.gw.destructibles.items) this.owners.set(d.collider.handle, { kind: 'prop', d });

    this.fx = new Effects();
    this.scene.add(this.fx.group);

    const ctx: GameContext = { R, world: this.world, scene: this.scene, terrain: this.gw.terrain, debris: this.debris };
    const sp = this.gw.playerSpawn;
    this.player = VehicleFactory.create(ctx, PLAYER_CAR, { isPlayer: true, position: sp.position, yaw: sp.yaw });
    this.addVehicle(this.player);
    const defs = { buggy: DUMMY_BUGGY, sedan: DUMMY_SEDAN, truck: DUMMY_TRUCK };
    for (const spawn of this.gw.dummies) {
      const v = VehicleFactory.create(ctx, defs[spawn.def], { position: spawn.position, yaw: spawn.yaw });
      this.addVehicle(v);
      this.dummies.push(v);
      if (spawn.route.length) this.drivers.push(new WaypointDriver(v, spawn.route, spawn.speed));
    }

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);

    // UI and input.
    const ui = document.createElement('div');
    ui.id = 'ui';
    container.appendChild(ui);
    this.hud = new Hud(ui);
    this.debug = new Debug(ui);
    this.scene.add(this.debug.lines);
    this.touch = new TouchControls(ui, this.settings.touchLayout);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.touch.setEnabled(coarse);
    window.addEventListener('touchstart', () => this.touch.enabled || this.touch.setEnabled(true), { once: true, passive: true });
    this.input = new InputManager([
      { name: 'keyboard', source: new Keyboard() },
      { name: 'gamepad', source: new GamepadInput() },
      { name: 'touch', source: this.touch },
    ]);
    this.pause = new PauseMenu(ui, {
      resume: () => this.setPaused(false),
      resetCar: () => this.resetPlayer(),
      respawnWorld: () => this.respawnWorld(),
      openTuning: () => this.tuning.setOpen(true),
      toggleMute: () => {
        this.setSetting('muted', !this.settings.muted);
        this.audio.setMuted(this.settings.muted);
        return this.settings.muted;
      },
    });
    this.tuning = new TuningPanel(ui, this.tuningSections(), [
      {
        id: 'touchLayout',
        label: 'Touch layout',
        type: 'select',
        choices: [
          { value: 'stick', label: 'Stick drives (gas/brake on stick)' },
          { value: 'buttons', label: 'Steer stick + gas/brake buttons' },
        ],
        get: () => this.settings.touchLayout,
        set: (v) => {
          this.setSetting('touchLayout', v as TouchLayout);
          this.touch.setLayout(v as TouchLayout);
        },
      },
      {
        id: 'rotateCam',
        label: 'Camera rotates with car',
        type: 'toggle',
        get: () => CAMERA.rotateWithCar > 0.5,
        set: (v) => {
          CAMERA.rotateWithCar = v ? 1 : 0;
          this.tuning.sync();
        },
      },
      { id: 'fps', label: 'Show FPS', type: 'toggle', get: () => this.settings.showFps, set: (v) => this.setDebug(!!v, this.settings.showColliders) },
      {
        id: 'colliders',
        label: 'Collider wireframes',
        type: 'toggle',
        get: () => this.settings.showColliders,
        set: (v) => this.setDebug(this.settings.showFps, !!v),
      },
      {
        id: 'mute',
        label: 'Mute sound',
        type: 'toggle',
        get: () => this.settings.muted,
        set: (v) => {
          this.setSetting('muted', !!v);
          this.audio.setMuted(!!v);
        },
      },
    ]);
    this.tuning.onClose = () => {
      if (!this.pause.open) this.loop.paused = false;
    };
    this.audio.setMuted(this.settings.muted);
    this.setDebug(this.settings.showFps, this.settings.showColliders);
    this.world.gravity = { x: 0, y: -PHYSICS.gravity, z: 0 };
    this.player.applyMass();

    this.bindEvents();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.rig.subject.position.copy(this.player.position);
    this.rig.snap();
    this.loop = new Loop(
      60,
      (dt) => this.physicsStep(dt),
      (alpha, dt) => this.render(alpha, dt),
      (dt) => this.frameInput(dt),
    );
  }

  start(): void {
    this.loop.start();
  }

  private addVehicle(v: Vehicle): void {
    this.vehicles.push(v);
    this.owners.set(v.collider.handle, { kind: 'vehicle', v });
  }

  private tuningSections(): TuningSection[] {
    const c = this.player.config as unknown as Record<string, number>;
    return [
      {
        id: 'vehicle',
        title: 'Vehicle',
        target: c,
        onChange: (k) => {
          if (k === 'mass') this.player.applyMass();
          if (k === 'integrity') this.player.damage.repair();
        },
        sliders: [
          { key: 'mass', min: 400, max: 4000, step: 50 },
          { key: 'enginePower', min: 4000, max: 45000, step: 500 },
          { key: 'maxSpeed', min: 10, max: 70, step: 1 },
          { key: 'reverseSpeed', min: 3, max: 25, step: 1 },
          { key: 'steerRate', min: 0.5, max: 5, step: 0.05 },
          { key: 'steerFalloff', min: 0, max: 0.95, step: 0.01 },
          { key: 'grip', min: 1, max: 20, step: 0.1 },
          { key: 'handbrakeGrip', min: 0, max: 8, step: 0.1 },
          { key: 'driftRecovery', min: 0.2, max: 10, step: 0.1 },
          { key: 'boostForce', min: 0, max: 40000, step: 500 },
          { key: 'boostCapacity', min: 0, max: 8, step: 0.1 },
          { key: 'boostRecharge', min: 0, max: 2, step: 0.05 },
          { key: 'armorFront', min: 0, max: 0.95, step: 0.01 },
          { key: 'armorRear', min: 0, max: 0.95, step: 0.01 },
          { key: 'armorSide', min: 0, max: 0.95, step: 0.01 },
          { key: 'integrity', min: 20, max: 500, step: 5 },
          { key: 'damageMultiplier', min: 0, max: 5, step: 0.05 },
          { key: 'deformStrength', min: 0, max: 4, step: 0.05 },
        ],
      },
      {
        id: 'physics',
        title: 'Physics',
        target: PHYSICS as unknown as Record<string, number>,
        onChange: (k) => {
          if (k === 'gravity') this.world.gravity = { x: 0, y: -PHYSICS.gravity, z: 0 };
        },
        sliders: [
          { key: 'gravity', min: 5, max: 30, step: 0.5 },
          { key: 'suspensionLength', min: 0.2, max: 1.2, step: 0.05 },
          { key: 'suspensionStiffness', min: 10, max: 120, step: 1 },
          { key: 'suspensionDamping', min: 0.5, max: 15, step: 0.1 },
          { key: 'airDrag', min: 0, max: 0.02, step: 0.0005 },
          { key: 'selfRighting', min: 0, max: 30, step: 0.5 },
          { key: 'uprightDamping', min: 0, max: 10, step: 0.1 },
          { key: 'airControl', min: 0, max: 1, step: 0.05 },
          { key: 'handbrakeYawBoost', min: 1, max: 3, step: 0.05 },
          { key: 'flipResetTime', min: 1, max: 10, step: 0.5 },
        ],
      },
      {
        id: 'camera',
        title: 'Camera',
        target: CAMERA as unknown as Record<string, number>,
        sliders: [
          { key: 'fov', min: 15, max: 70, step: 1 },
          { key: 'pitch', min: 30, max: 90, step: 1 },
          { key: 'distance', min: 15, max: 120, step: 1 },
          { key: 'zoomPerSpeed', min: 0, max: 1.5, step: 0.05 },
          { key: 'maxZoom', min: 0, max: 60, step: 1 },
          { key: 'lookAhead', min: 0, max: 2, step: 0.05 },
          { key: 'maxLookAhead', min: 0, max: 40, step: 1 },
          { key: 'followRate', min: 1, max: 20, step: 0.5 },
          { key: 'zoomRate', min: 0.2, max: 10, step: 0.1 },
          { key: 'rotateWithCar', min: 0, max: 1, step: 1, label: 'rotateWithCar (0/1)' },
          { key: 'rotateRate', min: 0.5, max: 10, step: 0.1 },
          { key: 'shakeScale', min: 0, max: 3, step: 0.05 },
          { key: 'shakeDecay', min: 0.5, max: 8, step: 0.1 },
          { key: 'maxShake', min: 0, max: 3, step: 0.05 },
        ],
      },
      {
        id: 'damage',
        title: 'Damage',
        target: DAMAGE as unknown as Record<string, number>,
        sliders: [
          { key: 'minImpactSpeed', min: 0, max: 15, step: 0.5 },
          { key: 'damageScale', min: 0, max: 5, step: 0.05 },
          { key: 'zoneShare', min: 0.1, max: 1, step: 0.05 },
          { key: 'dentRadius', min: 0.3, max: 3, step: 0.05 },
          { key: 'dentPerSpeed', min: 0, max: 0.1, step: 0.002 },
          { key: 'maxDentPerHit', min: 0, max: 1, step: 0.01 },
          { key: 'maxDentDepth', min: 0, max: 1.5, step: 0.01 },
          { key: 'debrisLifetime', min: 2, max: 60, step: 1 },
          { key: 'smokeBelow', min: 0, max: 1, step: 0.05 },
          { key: 'fireBelow', min: 0, max: 1, step: 0.05 },
          { key: 'wreckExplosionRadius', min: 0, max: 30, step: 0.5 },
          { key: 'wreckExplosionSpeed', min: 0, max: 30, step: 0.5 },
        ],
      },
    ];
  }

  private setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Not persisted; fine.
    }
  }

  private setDebug(fps: boolean, colliders: boolean): void {
    this.setSetting('showFps', fps);
    this.setSetting('showColliders', colliders);
    this.debug.setFps(fps);
    this.debug.setColliders(colliders);
  }

  private bindEvents(): void {
    bus.on('propBroken', (e) => {
      this.stats.propsBroken++;
      const d = e.prop as Destructible;
      const ex = d.config.explosion;
      if (ex) this.queueExplosion(e.position, ex.radius, ex.speed, ex.damage, 0.05);
      else this.audio.wood(e.position.distanceTo(this.player.position));
    });
    bus.on('vehicleDestroyed', (e) => {
      this.stats.wrecks++;
      this.queueExplosion(e.position, DAMAGE.wreckExplosionRadius, DAMAGE.wreckExplosionSpeed, 20, 0);
    });
    bus.on('vehiclePartLost', () => this.stats.partsLost++);
  }

  queueExplosion(pos: THREE.Vector3, radius: number, speed: number, damage: number, delay: number): void {
    this.explosions.push({ pos: pos.clone(), radius, speed, damage, at: this.time + delay });
  }

  setPaused(p: boolean): void {
    this.pause.setOpen(p);
    this.loop.paused = p || this.tuning.open;
  }

  resetPlayer(): void {
    this.player.respawn();
    this.rig.subject.position.copy(this.player.position);
    this.rig.snap();
    bus.emit('playerReset', {});
  }

  respawnWorld(): void {
    for (const v of this.dummies) v.respawn();
    for (const d of this.drivers) d.reset();
    this.gw.destructibles.resetAll();
    this.debris.clear();
    this.explosions.length = 0;
    bus.emit('worldReset', {});
  }

  // ---------------------------------------------------------------------
  private frameInput(dt: number): void {
    const input = this.input;
    input.update(dt);
    if (input.wasPressed('pause')) {
      if (this.tuning.open) this.tuning.setOpen(false);
      else this.setPaused(!this.pause.open);
    }
    if (input.wasPressed('toggleTuning')) {
      this.tuning.toggle();
      this.loop.paused = this.pause.open || this.tuning.open;
    }
    if (input.wasPressed('reset')) this.resetPlayer();
    if (input.wasPressed('respawnWorld')) this.respawnWorld();
    if (input.wasPressed('toggleDebug')) {
      const on = !(this.settings.showFps && this.settings.showColliders);
      this.setDebug(on, on);
    }
    if (input.wasPressed('toggleCamera')) CAMERA.rotateWithCar = CAMERA.rotateWithCar > 0.5 ? 0 : 1;
    const s = input.state;
    const pi = this.player.input;
    pi.throttle = s.throttle;
    pi.brake = s.brake;
    pi.steer = s.steer;
    pi.handbrake = s.handbrake;
    pi.boost = s.boost;
  }

  private physicsStep(dt: number): void {
    this.time += dt;
    for (const d of this.drivers) d.update(dt);
    for (const v of this.vehicles) {
      v.snapshotVelocity();
      v.physicsStep(dt);
    }
    this.gw.destructibles.snapshotVelocities();
    this.world.step(this.eventQueue);
    this.processContacts(dt);
    this.processExplosions();
    for (const v of this.vehicles) v.capture();
    this.gw.destructibles.step();
    this.debris.step(dt);
    for (const [k, until] of this.cooldowns) if (until < this.time) this.cooldowns.delete(k);

    const p = this.player.interp.pos;
    if (!this.gw.terrain.inBounds(p.x, p.z, 1) || p.y < -15) this.resetPlayer();
    for (const v of this.dummies) {
      const q = v.interp.pos;
      if (!this.gw.terrain.inBounds(q.x, q.z, 1) || q.y < -15) v.respawn();
    }
  }

  private velocityAt(o: Owner, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    let body: RAPIER.RigidBody | null = null;
    let lin: THREE.Vector3 | null = null;
    let ang: THREE.Vector3 | null = null;
    if (o.kind === 'vehicle') {
      body = o.v.body;
      lin = o.v.prevLinvel;
      ang = o.v.prevAngvel;
    } else if (o.kind === 'prop') {
      body = o.d.body;
      lin = o.d.prevLinvel;
      ang = o.d.prevAngvel;
    }
    if (!body || !lin || !ang) return out.set(0, 0, 0);
    const c = body.worldCom();
    _r.set(point.x - c.x, point.y - c.y, point.z - c.z);
    return out.crossVectors(ang, _r).add(lin);
  }

  private massOf(o: Owner): number {
    if (o.kind === 'vehicle') return o.v.config.mass;
    if (o.kind === 'prop') return o.d.config.mass;
    return Infinity;
  }

  private processContacts(dt: number): void {
    this.eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (!a || !b) return;
      if (a.kind !== 'vehicle' && a.kind !== 'prop' && b.kind !== 'vehicle' && b.kind !== 'prop') return;
      const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
      if ((this.cooldowns.get(key) ?? -1) > this.time) return;
      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      let found = false;
      this.world.contactPair(c1, c2, (m, flipped) => {
        if (found) return;
        const n = m.normal();
        _n.set(n.x, n.y, n.z);
        if (flipped) _n.negate();
        const count = m.numSolverContacts();
        if (count > 0) {
          _p.set(0, 0, 0);
          for (let i = 0; i < count; i++) {
            const sp = m.solverContactPoint(i);
            _p.x += sp.x;
            _p.y += sp.y;
            _p.z += sp.z;
          }
          _p.divideScalar(count);
          found = true;
        } else if (m.numContacts() > 0) {
          const lp = m.localContactPoint1(0);
          if (!lp) return;
          const col = flipped ? c2 : c1;
          const t = col.translation();
          const r = col.rotation();
          _p.set(lp.x, lp.y, lp.z).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(_d.set(t.x, t.y, t.z));
          found = true;
        }
      });
      if (!found) return;
      this.velocityAt(a, _p, _va);
      this.velocityAt(b, _p, _vb);
      const closing = Math.abs(_va.sub(_vb).dot(_n));
      const isVeh = a.kind === 'vehicle' || b.kind === 'vehicle';
      const minSpeed = isVeh ? DAMAGE.minImpactSpeed : 2;
      const terrainHit = a.kind === 'terrain' || b.kind === 'terrain';
      if (closing < (terrainHit ? minSpeed * 1.8 : minSpeed)) return;
      this.cooldowns.set(key, this.time + 0.25);

      const ma = this.massOf(a);
      const mb = this.massOf(b);
      const ratioA = mb === Infinity ? 1 : mb / (ma + mb);
      const ratioB = ma === Infinity ? 1 : ma / (ma + mb);
      const point = _p.clone();
      // The manifold normal points from collider 1 toward collider 2.
      if (a.kind === 'vehicle') a.v.takeHit(point, _d.copy(_n).negate(), closing, ratioA * (terrainHit ? 0.6 : 1));
      if (b.kind === 'vehicle') b.v.takeHit(point, _d.copy(_n), closing, ratioB * (terrainHit ? 0.6 : 1));
      if (a.kind === 'prop') this.gw.destructibles.damage(a.d, closing * ratioA, this.velocityAt(b, point, new THREE.Vector3()));
      if (b.kind === 'prop') this.gw.destructibles.damage(b.d, closing * ratioB, this.velocityAt(a, point, new THREE.Vector3()));

      const metalA = a.kind === 'vehicle' || (a.kind === 'prop' && a.d.type !== 'fence' && a.d.type !== 'sign');
      const metalB = b.kind === 'vehicle' || (b.kind === 'prop' && b.d.type !== 'fence' && b.d.type !== 'sign');
      const metal = metalA && metalB;
      const involvesPlayer = (a.kind === 'vehicle' && a.v.isPlayer) || (b.kind === 'vehicle' && b.v.isPlayer);
      this.stats.collisions++;
      if (a.kind === 'vehicle' && b.kind === 'vehicle') this.stats.vehicleHits++;
      bus.emit('collision', {
        a: a.kind === 'vehicle' ? a.v : a.kind === 'prop' ? a.d : null,
        b: b.kind === 'vehicle' ? b.v : b.kind === 'prop' ? b.d : null,
        point,
        normal: _n.clone(),
        closingSpeed: closing,
        impulse: ev.totalForceMagnitude() * dt,
        metal: metal || (isVeh && (a.kind === 'static' || b.kind === 'static')),
        involvesPlayer,
      });
      this.audio.impact(closing / 25, metal, point.distanceTo(this.player.position));
    });
  }

  private processExplosions(): void {
    if (!this.explosions.length) return;
    const due = this.explosions.filter((e) => e.at <= this.time);
    if (!due.length) return;
    this.explosions = this.explosions.filter((e) => e.at > this.time);
    for (const e of due) {
      this.stats.explosions++;
      bus.emit('explosion', { position: e.pos, radius: e.radius, force: e.speed });
      this.audio.explosion(e.pos.distanceTo(this.player.position));
      const push = (body: RAPIER.RigidBody, mass: number): number => {
        const t = body.translation();
        _d.set(t.x - e.pos.x, t.y - e.pos.y, t.z - e.pos.z);
        const dist = _d.length();
        if (dist > e.radius) return 0;
        const f = 1 - dist / e.radius;
        _d.y = Math.max(0, _d.y);
        if (_d.lengthSq() < 1e-4) _d.set(rand(-1, 1), 0, rand(-1, 1));
        _d.normalize();
        _d.y += 0.7;
        _d.normalize();
        // Light objects fly further, heavy ones still get a shove.
        const dv = e.speed * f * ((2 * 1000) / (1000 + mass));
        body.applyImpulseAtPoint(
          { x: _d.x * dv * mass, y: _d.y * dv * mass, z: _d.z * dv * mass },
          { x: t.x + rand(-0.4, 0.4), y: t.y + 0.3, z: t.z + rand(-0.4, 0.4) },
          true,
        );
        return f;
      };
      for (const v of this.vehicles) {
        const f = push(v.body, v.config.mass);
        if (f > 0 && e.damage > 0) v.applyDamage(v.zoneAt(v.worldToLocal(e.pos, new THREE.Vector3())), e.damage * f * DAMAGE.damageScale);
        if (f > 0) {
          // Blast dents on the side facing the explosion.
          const t = v.body.translation();
          const dir = new THREE.Vector3(t.x - e.pos.x, 0, t.z - e.pos.z).normalize();
          const hitPoint = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(dir, -1.2);
          v.takeHit(hitPoint, dir, DAMAGE.minImpactSpeed + 12 * f, 0);
        }
      }
      for (const d of this.gw.destructibles.items) {
        if (d.broken) continue;
        const f = push(d.body, d.config.mass);
        if (f > 0) this.gw.destructibles.damage(d, Math.max(d.config.breakThreshold, e.damage * 0.4 * f));
      }
      for (const body of this.debris.activeBodies()) push(body, body.mass());
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.updatePointScale();
  }

  private updatePointScale(): void {
    const hpx = this.renderer.domElement.height;
    this.fx.setPointScale(hpx / (2 * Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov) / 2)));
  }

  private render(alpha: number, dt: number): void {
    for (const v of this.vehicles) v.render(alpha);
    this.gw.destructibles.render(alpha);
    this.debris.render(alpha);

    const p = this.player;
    const subj = this.rig.subject;
    subj.position.copy(p.visual.root.position);
    subj.velocity.copy(p.prevLinvel);
    subj.yaw = p.yaw;
    if (!this.loop.paused) this.rig.update(dt);
    this.updatePointScale();

    // Keep the shadow camera centred on the view, snapped to texels to avoid shimmer.
    const look = subj.position;
    const texel = 110 / 1024;
    const fx = Math.round(look.x / texel) * texel;
    const fz = Math.round(look.z / texel) * texel;
    const sd = WORLD.sunDirection;
    this.sun.position.set(fx + sd[0] * 80, look.y + sd[1] * 80, fz + sd[2] * 80);
    this.sun.target.position.set(fx, look.y, fz);

    if (!this.loop.paused) this.fx.update(dt, this.vehicles);
    this.hud.update(p);
    this.touch.setBoostLevel(p.config.boostCapacity > 0 ? p.controller.boost / p.config.boostCapacity : 0);
    const ctrl = p.controller;
    this.audio.updateCar(
      Math.abs(ctrl.forwardSpeed) / Math.max(1, p.config.maxSpeed),
      this.loop.paused ? 0 : p.input.throttle,
      ctrl.slip,
      ctrl.boosting,
      ctrl.grounded > 0,
      !p.wrecked && !this.loop.paused,
    );
    this.debug.update(dt, this.world, `· ${this.renderer.info.render.calls} calls`);
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** Average of the bodies' speeds, used by tests. */
  get playerSpeed(): number {
    return clamp(this.player.controller.speed, 0, 999);
  }

  get destructibleTypes(): string[] {
    return Object.keys(DESTRUCTIBLES);
  }
}
