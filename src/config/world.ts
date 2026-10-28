export const WORLD = {
  size: 400,
  /** Heightfield cells per side. */
  resolution: 128,
  duneHeight: 3,
  ridgeWidth: 26,
  ridgeHeight: 14,
  roadHalfWidth: 5.5,
  /** Road blending distance beyond the half width. */
  roadShoulder: 4,
  seed: 1337,
  sunDirection: [-0.65, 0.7, 0.45] as [number, number, number],
  fogNear: 90,
  fogFar: 260,
};
