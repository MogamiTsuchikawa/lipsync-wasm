export const LIPSYNC_MOUTH_PRESET_COUNT = 5;

export type EncodedLipSyncTrackJson = {
  fps: number;
  frameCount: number;
  durationMs: number;
  phonemeIndexBase64: string;
  rawVolumeBase64: string;
};

export type LipSyncTrack = {
  fps: number;
  frameCount: number;
  durationMs: number;
  phonemeIndices: Uint8Array;
  rawVolumes: Float32Array;
  volumeScale: number;
};

export type LipSyncFrame = {
  frameIndex: number;
  phonemeIndex: number;
  intensity: number;
};
