import * as THREE from 'three';
import type { VehicleDefinition, VehicleShape } from '../config/vehicles';
import { box, merge, paint } from '../core/geo';
import { DeformableMesh } from './DeformableMesh';
import type { DamageZone } from './DamageModel';
import type { GameContext } from '../core/Context';
import { Vehicle } from './Vehicle';

export interface VehiclePart {
  name: string;
  mesh: THREE.Mesh;
  deform: DeformableMesh | null;
  /** Zone whose failure knocks this part off, if any. */
  zone: DamageZone | null;
  /** Falls off once its zone's health fraction drops to this. */
  breakAt: number;
  detached: boolean;
}

export interface WheelVisual {
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
  front: boolean;
  side: number;
}

export interface VehicleVisual {
  root: THREE.Group;
  parts: VehiclePart[];
  wheels: WheelVisual[];
  materials: { body: THREE.MeshLambertMaterial; trim: THREE.MeshLambertMaterial; glass: THREE.MeshLambertMaterial };
  wheelLocals: { pos: THREE.Vector3; front: boolean; side: number; radius: number }[];
  /** Collider half extents and centre offset. */
  collider: { hx: number; hy: number; hz: number; cy: number };
}

/** Segmented box so dents have vertices to move. */
function segBox(w: number, h: number, d: number, spacing = 0.32): THREE.BoxGeometry {
  const s = (v: number) => Math.max(1, Math.round(v / spacing));
  return new THREE.BoxGeometry(w, h, d, s(w), s(h), s(d));
}

function makePart(
  parts: VehiclePart[],
  root: THREE.Object3D,
  name: string,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  zone: DamageZone | null,
  breakAt = 0,
  deformable = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.name = name;
  root.add(mesh);
  parts.push({ name, mesh, deform: deformable ? new DeformableMesh(mesh) : null, zone, breakAt, detached: false });
  return mesh;
}

export function buildVehicleVisual(shape: VehicleShape, isPlayer: boolean): VehicleVisual {
  const { length: L, width: W, height: H } = shape;
  const root = new THREE.Group();
  const parts: VehiclePart[] = [];
  const body = new THREE.MeshLambertMaterial({ color: shape.color, flatShading: true });
  const trim = new THREE.MeshLambertMaterial({ color: shape.trimColor, flatShading: true });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2328, flatShading: true });

  makePart(parts, root, 'core', segBox(W * 0.86, H, L * 0.8), body, [0, 0, 0], null);

  const hoodLen = L * 0.28;
  makePart(parts, root, 'hood', segBox(W * 0.84, 0.14, hoodLen), body, [0, H / 2 + 0.07, L / 2 - hoodLen / 2 - 0.2], 'front');
  const fb = makePart(parts, root, 'frontBumper', segBox(W * 0.98, H * 0.55, 0.34), trim, [0, -H * 0.12, L / 2 - 0.17], 'front', 0.5);
  makePart(parts, root, 'rearBumper', segBox(W * 0.98, H * 0.55, 0.34), trim, [0, -H * 0.12, -L / 2 + 0.17], 'rear', 0.5);

  const doorLen = L * 0.6;
  makePart(parts, root, 'leftDoor', segBox(0.14, H * 0.86, doorLen), body, [W / 2 - 0.08, 0.02, 0], 'left');
  makePart(parts, root, 'rightDoor', segBox(0.14, H * 0.86, doorLen), body, [-W / 2 + 0.08, 0.02, 0], 'right');

  if (shape.bed) {
    // Flatbed walls behind the cabin.
    const bedLen = L * 0.5;
    const bedZ = -L / 2 + bedLen / 2 + 0.3;
    const bed = merge([
      box(W * 0.94, 0.5, 0.12, 0, 0.25, bedLen / 2 - 0.06),
      box(W * 0.94, 0.5, 0.12, 0, 0.25, -bedLen / 2 + 0.06),
      box(0.12, 0.5, bedLen, W * 0.47 - 0.06, 0.25, 0),
      box(0.12, 0.5, bedLen, -W * 0.47 + 0.06, 0.25, 0),
      box(W * 0.9, 0.06, bedLen, 0, 0.03, 0),
    ]);
    bed.deleteAttribute('color');
    makePart(parts, root, 'bed', bed, body, [0, H / 2, bedZ], 'rear');
    // A load of scrap in the bed.
    const load = new THREE.Mesh(paint(new THREE.DodecahedronGeometry(0.55), 0x5a4a3c), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    load.position.set(0.2, H / 2 + 0.45, bedZ - 0.4);
    load.castShadow = true;
    root.add(load);
    parts.push({ name: 'load', mesh: load, deform: null, zone: 'rear', breakAt: 0.5, detached: false });
  } else {
    const trunkLen = L * 0.18;
    makePart(parts, root, 'trunk', segBox(W * 0.84, 0.12, trunkLen), body, [0, H / 2 + 0.06, -L / 2 + trunkLen / 2 + 0.22], 'rear');
  }

  if (shape.cabinHeight > 0) {
    const cg = segBox(W * 0.8, shape.cabinHeight, shape.cabinLength, 0.3);
    // Taper the roof inward.
    const p = cg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + shape.cabinHeight / 2) / shape.cabinHeight;
      p.setX(i, p.getX(i) * (1 - 0.14 * t));
      p.setZ(i, p.getZ(i) * (1 - 0.22 * t));
    }
    const cabin = makePart(parts, root, 'cabin', cg, body, [0, H / 2 + shape.cabinHeight / 2, -shape.cabinOffset], null);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(W * 0.66, shape.cabinHeight * 0.62, 0.06), glass);
    ws.position.set(0, 0.02, shape.cabinLength / 2 - 0.12);
    ws.rotation.x = -0.35;
    cabin.add(ws);
    const rw = ws.clone();
    rw.position.z = -shape.cabinLength / 2 + 0.1;
    rw.rotation.x = 0.35;
    cabin.add(rw);
  } else {
    // Open seat for buggies.
    const seat = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.25, 0.7), glass);
    seat.position.set(0, H / 2 + 0.12, -shape.cabinOffset);
    root.add(seat);
  }

  if (shape.rollCage) {
    const ch = Math.max(shape.cabinHeight, 0.0) + 0.55;
    const cl = shape.cabinLength * 0.9;
    const cw = W * 0.78;
    const y0 = H / 2;
    const t = 0.08;
    const bars = merge([
      box(t, ch, t, cw / 2, y0 + ch / 2, cl / 2),
      box(t, ch, t, -cw / 2, y0 + ch / 2, cl / 2),
      box(t, ch, t, cw / 2, y0 + ch / 2, -cl / 2),
      box(t, ch, t, -cw / 2, y0 + ch / 2, -cl / 2),
      box(t, t, cl, cw / 2, y0 + ch, 0),
      box(t, t, cl, -cw / 2, y0 + ch, 0),
      box(cw, t, t, 0, y0 + ch, cl / 2),
      box(cw, t, t, 0, y0 + ch, -cl / 2),
      box(cw, t, t, 0, y0 + ch, 0),
    ]);
    bars.deleteAttribute('color');
    const cage = new THREE.Mesh(bars, trim);
    cage.position.z = -shape.cabinOffset;
    cage.castShadow = true;
    root.add(cage);
  }

  if (isPlayer) {
    // Spiked ram bar, rides on the front bumper and falls off with it.
    const spikes: THREE.BufferGeometry[] = [box(W * 1.02, 0.12, 0.12, 0, 0.12, 0.22)];
    for (let i = -2; i <= 2; i++) {
      const cone = new THREE.ConeGeometry(0.07, 0.36, 5);
      cone.rotateX(Math.PI / 2);
      cone.translate(i * W * 0.22, 0.12, 0.44);
      spikes.push(paint(cone, 0xffffff));
    }
    const ram = merge(spikes);
    ram.deleteAttribute('color');
    const ramMesh = new THREE.Mesh(ram, new THREE.MeshLambertMaterial({ color: 0x8c8378, flatShading: true }));
    ramMesh.castShadow = true;
    fb.add(ramMesh);
    // Exhaust stacks.
    const ex = merge([box(0.12, 0.6, 0.12, W * 0.32, H / 2 + 0.3, -L * 0.18), box(0.12, 0.6, 0.12, -W * 0.32, H / 2 + 0.3, -L * 0.18)]);
    ex.deleteAttribute('color');
    const exMesh = new THREE.Mesh(ex, trim);
    root.add(exMesh);
  }

  // Wheels.
  const r = shape.wheelRadius;
  const ww = shape.wheelWidth;
  const wheelGeo = merge([
    paint(new THREE.CylinderGeometry(r, r, ww, 10).rotateZ(Math.PI / 2), 0x1f1b18, 0.1),
    paint(new THREE.CylinderGeometry(r * 0.45, r * 0.45, ww + 0.02, 6).rotateZ(Math.PI / 2), 0x77695a),
  ]);
  const wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const wheels: WheelVisual[] = [];
  const wheelLocals: VehicleVisual['wheelLocals'] = [];
  const wz = L / 2 - r * 1.15 - 0.15;
  const wx = W / 2 - ww * 0.2;
  for (const [front, side] of [
    [true, 1],
    [true, -1],
    [false, 1],
    [false, -1],
  ] as [boolean, number][]) {
    const pos = new THREE.Vector3(side * wx, 0, front ? wz : -wz);
    const pivot = new THREE.Object3D();
    pivot.position.copy(pos);
    const mesh = new THREE.Mesh(wheelGeo, wheelMat);
    mesh.castShadow = true;
    pivot.add(mesh);
    root.add(pivot);
    wheels.push({ pivot, mesh, front, side });
    wheelLocals.push({ pos, front, side, radius: r });
  }

  const hy = H / 2 + shape.cabinHeight * 0.3;
  return {
    root,
    parts,
    wheels,
    materials: { body, trim, glass },
    wheelLocals,
    collider: { hx: (W / 2) * 0.95, hy, hz: L / 2, cy: shape.cabinHeight * 0.3 },
  };
}

export const VehicleFactory = {
  create(ctx: GameContext, def: VehicleDefinition, opts: { isPlayer?: boolean; position: THREE.Vector3; yaw: number }): Vehicle {
    const visual = buildVehicleVisual(def.shape, !!opts.isPlayer);
    // Each vehicle gets its own mutable copy of the config so tuning is per-instance.
    const config = { ...def.config };
    return new Vehicle(ctx, def, config, visual, !!opts.isPlayer, opts.position, opts.yaw);
  },
};
