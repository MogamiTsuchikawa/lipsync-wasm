import { decodeBase64ToBytes, decodeBase64ToF32 } from "./base64";
import { type EncodedLipSyncTrackJson, type LipSyncTrack } from "./types";

const MIN_FPS = 1;
const MAX_FPS = 120;

type LipSyncWasmModule = {
  default: (moduleOrPath?: WebAssembly.Module | BufferSource | Response | Promise<Response> | string | URL) => Promise<unknown>;
  compute_track_json_wasm: (wavBase64: string, fps: number) => string;
};

type WasmInitSource = Parameters<LipSyncWasmModule["default"]>[0];

export type InitLipSyncOptions = {
  wasmUrl?: WasmInitSource;
};

let wasmModulePromise: Promise<LipSyncWasmModule> | null = null;
let wasmModuleError: Error | null = null;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const parseAndDecodeTrack = (trackJson: string): LipSyncTrack => {
  const parsed = JSON.parse(trackJson) as EncodedLipSyncTrackJson;
  const phonemeIndices = decodeBase64ToBytes(parsed.phonemeIndexBase64 ?? "");
  const rawVolumes = decodeBase64ToF32(parsed.rawVolumeBase64 ?? "");

  const requestedFrameCount = Number.isFinite(parsed.frameCount) ? Math.max(0, Math.floor(parsed.frameCount)) : 0;
  const frameCount = Math.min(requestedFrameCount, phonemeIndices.length, rawVolumes.length);

  const normalizedPhonemeIndices = phonemeIndices.slice(0, frameCount);
  const normalizedRawVolumes = rawVolumes.slice(0, frameCount);

  let maxVolume = 0;
  for (let i = 0; i < normalizedRawVolumes.length; i += 1) {
    maxVolume = Math.max(maxVolume, Math.abs(normalizedRawVolumes[i] ?? 0));
  }

  const volumeScale = maxVolume > 1.0e-7 ? 1 / maxVolume : 0;

  return {
    fps: clamp(Number.isFinite(parsed.fps) ? Math.floor(parsed.fps) : MIN_FPS, MIN_FPS, MAX_FPS),
    frameCount,
    durationMs: Number.isFinite(parsed.durationMs) ? Math.max(0, Math.floor(parsed.durationMs)) : 0,
    phonemeIndices: normalizedPhonemeIndices,
    rawVolumes: normalizedRawVolumes,
    volumeScale
  };
};

const loadWasmModule = async (opts?: InitLipSyncOptions): Promise<LipSyncWasmModule> => {
  try {
    const imported = (await import("../wasm/lipsync_wasm.js")) as LipSyncWasmModule;
    await imported.default(opts?.wasmUrl);
    return imported;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    throw new Error(`failed to initialize lipsync wasm: ${reason}`);
  }
};

export const initLipSync = async (opts?: InitLipSyncOptions): Promise<void> => {
  if (wasmModuleError && opts?.wasmUrl) {
    wasmModuleError = null;
    wasmModulePromise = null;
  }

  if (wasmModuleError) {
    throw wasmModuleError;
  }

  if (!wasmModulePromise) {
    wasmModulePromise = loadWasmModule(opts).catch((err) => {
      const normalizedError = err instanceof Error ? err : new Error("failed to initialize lipsync wasm");
      wasmModuleError = normalizedError;
      throw normalizedError;
    });
  }

  await wasmModulePromise;
};

export const computeLipSyncTrack = async (wavBase64: string, fps: number): Promise<LipSyncTrack> => {
  const safeFps = clamp(Math.floor(fps), MIN_FPS, MAX_FPS);
  await initLipSync();
  const wasmModule = await wasmModulePromise;
  if (!wasmModule) {
    throw new Error("lipsync wasm module is unavailable");
  }

  const trackJson = wasmModule.compute_track_json_wasm(wavBase64, safeFps);
  return parseAndDecodeTrack(trackJson);
};

export const computeTrackFromWavBase64 = async (
  wavBase64: string,
  opts?: { fps?: number }
): Promise<LipSyncTrack> => {
  const fps = opts?.fps ?? 30;
  return computeLipSyncTrack(wavBase64, fps);
};
