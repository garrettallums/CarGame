export type SurfaceId = 'sand' | 'road';

export interface SurfaceConfig {
  /** Multiplies engine force. */
  traction: number;
  /** Multiplies lateral grip. */
  grip: number;
  /** Rolling resistance deceleration, m/s². */
  rolling: number;
  /** Multiplies air drag. */
  drag: number;
  /** Dust emission multiplier. */
  dust: number;
  /** Base darkness of tire tracks. */
  tracks: number;
}

export const SURFACES: Record<SurfaceId, SurfaceConfig> = {
  sand: { traction: 0.78, grip: 0.82, rolling: 2.2, drag: 1.25, dust: 1, tracks: 0.32 },
  road: { traction: 1, grip: 1.1, rolling: 0.5, drag: 1, dust: 0.35, tracks: 0.12 },
};
