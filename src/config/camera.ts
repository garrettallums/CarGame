export interface CameraConfig {
  fov: number;
  /** Degrees from horizontal. */
  pitch: number;
  distance: number;
  /** Extra distance per m/s of speed. */
  zoomPerSpeed: number;
  maxZoom: number;
  /** Seconds of velocity to look ahead. */
  lookAhead: number;
  maxLookAhead: number;
  followRate: number;
  zoomRate: number;
  /** 0 = north-up, 1 = rotate with the car. */
  rotateWithCar: number;
  rotateRate: number;
  shakeScale: number;
  shakeDecay: number;
  maxShake: number;
}

export const CAMERA: CameraConfig = {
  fov: 34,
  pitch: 60,
  distance: 48,
  zoomPerSpeed: 0.45,
  maxZoom: 20,
  lookAhead: 0.5,
  maxLookAhead: 14,
  followRate: 7,
  zoomRate: 1.8,
  rotateWithCar: 0,
  rotateRate: 2.5,
  shakeScale: 1,
  shakeDecay: 2.5,
  maxShake: 1.1,
};
