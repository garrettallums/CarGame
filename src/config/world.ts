export const WORLD = {
  /** Rust Ridge: a contained arena you deploy into for each run. */
  name: 'Rust Ridge',
  size: 300,
  /** Heightfield cells per side. */
  resolution: 128,
  duneHeight: 3,
  ridgeWidth: 22,
  ridgeHeight: 14,
  roadHalfWidth: 5.5,
  /** Road blending distance beyond the half width. */
  roadShoulder: 4,
  seed: 1337,
  sunDirection: [-0.65, 0.7, 0.45] as [number, number, number],
  fogNear: 80,
  fogFar: 230,
};
