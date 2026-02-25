import { LIPSYNC_MOUTH_PRESET_COUNT, type LipSyncFrame } from "./types";

const EPSILON = 1.0e-6;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const toAlpha = (deltaSeconds: number, timeConstantSeconds: number): number => {
  if (timeConstantSeconds <= EPSILON) {
    return 1;
  }
  return 1 - Math.exp(-deltaSeconds / timeConstantSeconds);
};

export type LipSyncSmootherOptions = {
  attackSeconds?: number;
  releaseSeconds?: number;
  silenceReleaseSeconds?: number;
  silenceThreshold?: number;
  minOpen?: number;
  closeEpsilon?: number;
  volumeNormalization?: "none" | "log10";
  minVolume?: number;
  maxVolume?: number;
};

export type SmoothedLipSyncFrame = {
  phonemeIndex: number;
  intensity: number;
};

export type LipSyncSmoother = {
  smooth: (frame: LipSyncFrame | null, deltaSeconds?: number) => SmoothedLipSyncFrame;
  reset: () => void;
};

const resolveNumber = (value: number | undefined, fallback: number): number => {
  return Number.isFinite(value) ? Number(value) : fallback;
};

const normalizeIntensity = (
  intensity: number,
  normalization: "none" | "log10",
  minVolume: number,
  maxVolume: number
): number => {
  const safeIntensity = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  if (normalization === "none") {
    return safeIntensity;
  }
  if (safeIntensity <= EPSILON) {
    return 0;
  }
  const span = Math.max(maxVolume - minVolume, EPSILON);
  const logVolume = Math.log10(safeIntensity);
  return clamp((logVolume - minVolume) / span, 0, 1);
};

export const createLipSyncSmoother = (options: LipSyncSmootherOptions = {}): LipSyncSmoother => {
  const attackSeconds = Math.max(resolveNumber(options.attackSeconds, 0.04), EPSILON);
  const releaseSeconds = Math.max(resolveNumber(options.releaseSeconds, 0.12), EPSILON);
  const silenceReleaseSeconds = Math.max(resolveNumber(options.silenceReleaseSeconds, 0.2), EPSILON);
  const silenceThreshold = clamp(resolveNumber(options.silenceThreshold, 0.03), 0, 1);
  const minOpen = clamp(resolveNumber(options.minOpen, 0.12), 0, 1);
  const closeEpsilon = clamp(resolveNumber(options.closeEpsilon, 0.001), 0, 1);
  const volumeNormalization = options.volumeNormalization ?? "none";
  const minVolume = resolveNumber(options.minVolume, -2.5);
  const maxVolume = resolveNumber(options.maxVolume, -1.5);

  let currentIntensity = 0;
  let currentPhonemeIndex = 0;

  return {
    smooth: (frame: LipSyncFrame | null, deltaSeconds = 1 / 60): SmoothedLipSyncFrame => {
      const safeDeltaSeconds = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 1 / 60, 1 / 240, 0.5);

      const nextPhonemeIndex = clamp(frame?.phonemeIndex ?? currentPhonemeIndex, 0, LIPSYNC_MOUTH_PRESET_COUNT - 1);
      const normalized = normalizeIntensity(frame?.intensity ?? 0, volumeNormalization, minVolume, maxVolume);
      const hasVoice = normalized >= silenceThreshold;
      const targetIntensity = hasVoice ? Math.max(normalized, minOpen) : 0;

      if (hasVoice) {
        currentPhonemeIndex = nextPhonemeIndex;
      }

      const timeConstantSeconds = targetIntensity > currentIntensity
        ? attackSeconds
        : hasVoice
          ? releaseSeconds
          : silenceReleaseSeconds;
      const alpha = toAlpha(safeDeltaSeconds, timeConstantSeconds);
      currentIntensity += (targetIntensity - currentIntensity) * alpha;
      currentIntensity = clamp(currentIntensity, 0, 1);

      if (!hasVoice && currentIntensity < closeEpsilon) {
        currentIntensity = 0;
      }

      return {
        phonemeIndex: currentPhonemeIndex,
        intensity: currentIntensity
      };
    },
    reset: (): void => {
      currentIntensity = 0;
      currentPhonemeIndex = 0;
    }
  };
};
