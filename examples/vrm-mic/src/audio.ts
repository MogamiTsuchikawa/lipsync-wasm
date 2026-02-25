const clampToI16 = (sample: number): number => {
  if (sample > 1) {
    return 32767;
  }
  if (sample < -1) {
    return -32768;
  }
  return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
};

export const joinChunks = (chunks: Float32Array[]): Float32Array => {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

export const encodePcmAsWavBase64 = (pcm: Float32Array, sampleRate: number): string => {
  const bytesPerSample = 2;
  const wavHeaderSize = 44;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(wavHeaderSize + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = wavHeaderSize;
  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(offset, clampToI16(pcm[i] ?? 0), true);
    offset += bytesPerSample;
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};
