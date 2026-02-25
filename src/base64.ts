const BASE64_PADDING = "=";

const normalizeBase64 = (value: string): string => {
  const trimmed = value.trim();
  const mod = trimmed.length % 4;
  if (mod === 0) {
    return trimmed;
  }
  return `${trimmed}${BASE64_PADDING.repeat(4 - mod)}`;
};

export const decodeBase64ToBytes = (value: string): Uint8Array => {
  const sanitized = normalizeBase64(value);
  const binary = atob(sanitized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

export const decodeBase64ToF32 = (value: string): Float32Array => {
  const bytes = decodeBase64ToBytes(value);
  const length = Math.floor(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
};
