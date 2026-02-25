# @mogamitsuchikawa/lipsync-wasm

Rust + WebAssembly で LipSync トラックを計算する npm パッケージです。
通常利用では Rust は不要で、同梱済み WASM をそのまま利用できます。

## Install

```bash
npm install @mogamitsuchikawa/lipsync-wasm
```

- 対応環境: Node.js `>=18`, npm `>=9`
- 利用時に Rust / wasm-pack は不要

## Quick Start

```ts
import {
  initLipSync,
  computeTrackFromWavBase64,
  sampleTrack,
  createLipSyncSmoother
} from "@mogamitsuchikawa/lipsync-wasm";

await initLipSync();

const track = await computeTrackFromWavBase64(wavBase64, { fps: 30 });
const frame = sampleTrack(track, audio.currentTime);

const smoother = createLipSyncSmoother();
const smoothed = smoother.smooth(frame, 1 / 30);
```

WASM 配信 URL を明示する場合（Vite など）:

```ts
import { initLipSync } from "@mogamitsuchikawa/lipsync-wasm";
import lipsyncWasmUrl from "@mogamitsuchikawa/lipsync-wasm/wasm/lipsync_wasm_bg.wasm?url";

await initLipSync({ wasmUrl: lipsyncWasmUrl });
```

## API

### `initLipSync(opts?)`

WASM モジュールを初期化します。

```ts
type InitLipSyncOptions = {
  wasmUrl?: WebAssembly.Module | BufferSource | Response | Promise<Response> | string | URL;
};
```

- 事前に `await initLipSync()` を 1 回実行
- URL 解決に不安がある bundler では `wasmUrl` を明示

### `computeTrackFromWavBase64(wavBase64, opts?)`

Base64 エンコード済み WAV から `LipSyncTrack` を計算します。

```ts
const track = await computeTrackFromWavBase64(wavBase64, { fps: 30 });
```

- `fps` は `1..120` にクランプ
- 返却値 `LipSyncTrack` は `phonemeIndices` / `rawVolumes` / `volumeScale` を含む

### `sampleTrack(track, currentTimeSeconds)`

任意時刻のフレームをサンプリングします。

```ts
const frame = sampleTrack(track, audio.currentTime);
// frame: { frameIndex, phonemeIndex, intensity } | null
```

- `track` が空の場合は `null`
- `intensity` は `0..1` に正規化

### `createLipSyncSmoother(options?)`

`sampleTrack` 結果を平滑化する stateful API を作成します。

```ts
const smoother = createLipSyncSmoother({
  attackSeconds: 0.04,
  releaseSeconds: 0.12,
  silenceReleaseSeconds: 0.2,
  silenceThreshold: 0.03,
  minOpen: 0.12,
  volumeNormalization: "none" // or "log10"
});

const smoothed = smoother.smooth(frame, deltaSeconds);
smoother.reset();
```

- `smooth(frame, deltaSeconds?)` は `{ phonemeIndex, intensity }` を返却
- `reset()` で内部状態を初期化

## 開発者向け（WASM 再生成が必要な場合のみ）

通常のライブラリ利用者はこの手順は不要です。

### 必要ツール

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```

### よく使うコマンド

```bash
make install
make check-wasm
make build-wasm
make build
make verify
```

- `make verify`: WASM チェック + 型チェック + ライブラリ build + example build
- `make publish-check`: `npm pack --dry-run` で公開内容確認

## Troubleshooting

### `failed to initialize lipsync wasm: Failed to execute 'compile' on 'WebAssembly': HTTP status code is not ok`

`.wasm` URL 解決が失敗し、404 で取得できない時に発生します。

```ts
import { initLipSync } from "@mogamitsuchikawa/lipsync-wasm";
import lipsyncWasmUrl from "@mogamitsuchikawa/lipsync-wasm/wasm/lipsync_wasm_bg.wasm?url";

await initLipSync({ wasmUrl: lipsyncWasmUrl });
```

Vite 利用時は prebundle 回避のため `optimizeDeps.exclude` も推奨です。

```ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@mogamitsuchikawa/lipsync-wasm"]
  }
});
```

### `computeTrackFromWavBase64` が失敗する

- 入力が PCM ではなく WAV(base64) か確認
- `data:audio/wav;base64,` のプレフィックスを除去して渡す

## Public npm Publish

公開運用の詳細チェックリストは `PUBLISHING.md` を参照してください。

### 初回公開

```bash
make install
make verify
make publish-check
npm login
npm publish --access public
```

### 更新公開

```bash
npm version patch
make verify
make publish-check
npm publish
```

## License

MIT License. 詳細は `LICENSE` を参照してください。
