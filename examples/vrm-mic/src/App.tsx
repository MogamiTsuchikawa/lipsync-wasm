import { useEffect, useMemo, useRef, useState } from "react";
import { computeTrackFromWavBase64, createLipSyncSmoother, initLipSync, sampleTrack } from "@mogami/lipsync-wasm";
import lipsyncWasmUrl from "@mogami/lipsync-wasm/wasm/lipsync_wasm_bg.wasm?url";
import { encodePcmAsWavBase64, joinChunks } from "./audio";
import { VrmScene } from "./vrmScene";

const POLL_INTERVAL_MS = 220;
const MAX_WINDOW_SECONDS = 0.8;

type LogLevel = "info" | "error";
type LogItem = { level: LogLevel; message: string };

export const App = (): JSX.Element => {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<VrmScene | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pollingIdRef = useRef<number | null>(null);
  const chunkQueueRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);
  const processingRef = useRef(false);
  const lipSyncSmootherRef = useRef(
    createLipSyncSmoother({
      volumeNormalization: "log10",
      minVolume: -2.5,
      maxVolume: -1.5,
      attackSeconds: 0.05,
      releaseSeconds: 0.12,
      silenceReleaseSeconds: 0.2,
      silenceThreshold: 0.03,
      minOpen: 0.1
    })
  );
  const smootherSampleTimeRef = useRef<number | null>(null);

  const [isMicRunning, setIsMicRunning] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([{ level: "info", message: "Load VRM and start mic to test lip sync" }]);

  const canStartMic = useMemo(() => isModelLoaded && !isMicRunning, [isModelLoaded, isMicRunning]);

  useEffect(() => {
    if (!viewerRef.current) {
      return;
    }
    sceneRef.current = new VrmScene(viewerRef.current);
    return () => {
      void stopMic();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  const pushLog = (message: string, level: LogLevel = "info"): void => {
    setLogs((prev) => {
      const next = [...prev, { level, message }];
      return next.slice(-12);
    });
  };

  const clearAudioBuffers = (): void => {
    chunkQueueRef.current = [];
    totalSamplesRef.current = 0;
  };

  const stopMic = async (): Promise<void> => {
    if (pollingIdRef.current !== null) {
      window.clearInterval(pollingIdRef.current);
      pollingIdRef.current = null;
    }

    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();

    processorRef.current = null;
    sourceRef.current = null;

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    processingRef.current = false;
    lipSyncSmootherRef.current.reset();
    smootherSampleTimeRef.current = null;
    clearAudioBuffers();
    sceneRef.current?.resetMouth();
    setIsMicRunning(false);
  };

  const processWindow = async (): Promise<void> => {
    if (processingRef.current) {
      return;
    }
    const context = audioContextRef.current;
    if (!context) {
      return;
    }
    if (!sceneRef.current?.hasVrm()) {
      pushLog("VRM is not loaded", "error");
      await stopMic();
      return;
    }
    if (totalSamplesRef.current < 256) {
      return;
    }

    processingRef.current = true;
    try {
      const windowPcm = joinChunks(chunkQueueRef.current);
      const wavBase64 = encodePcmAsWavBase64(windowPcm, context.sampleRate);
      const track = await computeTrackFromWavBase64(wavBase64, { fps: 30 });
      const sampleTime = Math.max(0, windowPcm.length / context.sampleRate - 1 / 30);
      const frame = sampleTrack(track, sampleTime);

      const nowSeconds = performance.now() / 1000;
      const previousSeconds = smootherSampleTimeRef.current;
      smootherSampleTimeRef.current = nowSeconds;
      const deltaSeconds = previousSeconds === null ? 1 / 30 : nowSeconds - previousSeconds;
      const smoothedFrame = lipSyncSmootherRef.current.smooth(frame, deltaSeconds);

      if (frame || smoothedFrame.intensity > 0) {
        sceneRef.current.applyMouth(smoothedFrame.phonemeIndex, smoothedFrame.intensity);
      } else {
        sceneRef.current.resetMouth();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown mic processing error";
      pushLog(`LipSync failed: ${message}`, "error");
      await stopMic();
    } finally {
      processingRef.current = false;
    }
  };

  const onVrmSelected = async (file: File | null): Promise<void> => {
    if (!file) {
      return;
    }

    try {
      await sceneRef.current?.loadVrm(file);
      setIsModelLoaded(sceneRef.current?.hasVrm() ?? false);
      sceneRef.current?.resetMouth();
      pushLog(`Loaded VRM: ${file.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to load VRM";
      setIsModelLoaded(false);
      pushLog(message, "error");
    }
  };

  const startMic = async (): Promise<void> => {
    if (!sceneRef.current?.hasVrm()) {
      pushLog("Load VRM before starting mic", "error");
      return;
    }

    try {
      if (!isWasmReady) {
        await initLipSync({ wasmUrl: lipsyncWasmUrl });
        setIsWasmReady(true);
        pushLog("LipSync WASM initialized");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);

      clearAudioBuffers();
      lipSyncSmootherRef.current.reset();
      smootherSampleTimeRef.current = null;
      source.connect(processor);
      processor.connect(context.destination);

      const maxSamples = Math.floor(MAX_WINDOW_SECONDS * context.sampleRate);

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const copied = new Float32Array(input.length);
        copied.set(input);

        chunkQueueRef.current.push(copied);
        totalSamplesRef.current += copied.length;

        while (totalSamplesRef.current > maxSamples && chunkQueueRef.current.length > 0) {
          const removed = chunkQueueRef.current.shift();
          totalSamplesRef.current -= removed?.length ?? 0;
        }
      };

      streamRef.current = stream;
      audioContextRef.current = context;
      sourceRef.current = source;
      processorRef.current = processor;

      pollingIdRef.current = window.setInterval(() => {
        void processWindow();
      }, POLL_INTERVAL_MS);

      setIsMicRunning(true);
      pushLog("Mic started");
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to start mic";
      pushLog(`Mic start failed: ${message}`, "error");
      sceneRef.current?.resetMouth();
      await stopMic();
    }
  };

  return (
    <div className="page">
      <aside className="panel">
        <h1>VRM Mic LipSync Test</h1>
        <p>Pick a VRM, allow mic permission, and confirm mouth movement.</p>

        <label className="field">
          <span>VRM file</span>
          <input
            type="file"
            accept=".vrm,model/gltf-binary"
            onChange={(event) => {
              void onVrmSelected(event.currentTarget.files?.[0] ?? null);
            }}
          />
        </label>

        <div className="buttons">
          <button type="button" onClick={() => void startMic()} disabled={!canStartMic}>
            Start Mic
          </button>
          <button type="button" onClick={() => void stopMic()} disabled={!isMicRunning}>
            Stop Mic
          </button>
        </div>

        <ul className="status">
          <li>VRM loaded: {isModelLoaded ? "yes" : "no"}</li>
          <li>WASM ready: {isWasmReady ? "yes" : "no"}</li>
          <li>Mic running: {isMicRunning ? "yes" : "no"}</li>
        </ul>

        <div className="logs" role="log" aria-live="polite">
          {logs.map((item, index) => (
            <p key={`${item.message}-${index}`} className={item.level === "error" ? "log-error" : "log-info"}>
              {item.message}
            </p>
          ))}
        </div>
      </aside>

      <main className="viewer" ref={viewerRef} />
    </div>
  );
};
