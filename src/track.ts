import { LIPSYNC_MOUTH_PRESET_COUNT, type LipSyncFrame, type LipSyncTrack } from "./types";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const sampleTrack = (track: LipSyncTrack, currentTimeSeconds: number): LipSyncFrame | null => {
  if (track.frameCount < 1 || track.fps < 1) {
    return null;
  }

  const candidateIndex = Math.floor(currentTimeSeconds * track.fps);
  const frameIndex = clamp(Number.isFinite(candidateIndex) ? candidateIndex : 0, 0, track.frameCount - 1);

  const rawPhoneme = track.phonemeIndices[frameIndex] ?? 0;
  const phonemeIndex = clamp(rawPhoneme, 0, LIPSYNC_MOUTH_PRESET_COUNT - 1);

  const rawVolume = track.rawVolumes[frameIndex] ?? 0;
  const intensity = clamp(rawVolume * track.volumeScale, 0, 1);

  return {
    frameIndex,
    phonemeIndex,
    intensity
  };
};
