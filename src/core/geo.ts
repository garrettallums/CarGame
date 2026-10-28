import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Tag every vertex of a geometry with one colour so parts can be merged. */
export function paint(geo: THREE.BufferGeometry, color: number | THREE.Color, jitter = 0, rnd = Math.random): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    // Jitter per triangle for a hand-painted low-poly look.
    const k = 1 + (rnd() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) {
      arr[(i + j) * 3] = c.r * k;
      arr[(i + j) * 3 + 1] = c.g * k;
      arr[(i + j) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, color = 0xffffff, jitter = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color, jitter);
}

export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') n.deleteAttribute(name);
    }
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('mergeGeometries failed');
  return merged;
}

/** Shared flat-shaded vertex-colour material. */
export const vertexColorMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
