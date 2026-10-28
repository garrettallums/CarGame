import type * as THREE from 'three';
import type { DamageZone } from '../vehicle/DamageModel';

/** Every cross-system event in the game. Later phases add entries here. */
export interface GameEvents {
  collision: {
    a: unknown;
    b: unknown;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    closingSpeed: number;
    impulse: number;
    metal: boolean;
    involvesPlayer: boolean;
  };
  vehicleDamaged: { vehicle: unknown; zone: DamageZone; amount: number; isPlayer: boolean };
  vehiclePartLost: { vehicle: unknown; part: string };
  vehicleDestroyed: { vehicle: unknown; position: THREE.Vector3; isPlayer: boolean };
  propBroken: { prop: unknown; type: string; position: THREE.Vector3 };
  explosion: { position: THREE.Vector3; radius: number; force: number };
  playerReset: Record<string, never>;
  partsAwarded: { amount: number; label: string; total: number };
  objectiveComplete: { label: string; reward: number };
  extractionOpen: { position: THREE.Vector3 };
  worldReset: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as Handler<E[K]>)(payload);
  }
}

export const bus = new EventBus<GameEvents>();
