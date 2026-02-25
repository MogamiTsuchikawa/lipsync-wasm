use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rustfft::num_complex::Complex32;
use rustfft::FftPlanner;
use serde::Serialize;
use wasm_bindgen::prelude::*;

const TARGET_SAMPLE_RATE: u32 = 16_000;
const SAMPLE_COUNT: usize = 1024;
const MEL_FILTER_BANK_CHANNELS: usize = 30;

const PHONEMES: [[f32; 12]; 5] = [
  [
    1.049726,
    -72.644121,
    -21.406409,
    -38.913865,
    43.978757,
    -15.453428,
    -42.135838,
    25.127982,
    -16.858767,
    -15.378271,
    -3.977149,
    -3.196901,
  ],
  [
    -34.316947,
    13.704392,
    46.031996,
    -80.115377,
    -2.998459,
    -19.909248,
    -19.256851,
    -1.972022,
    -4.047667,
    -7.308336,
    -23.577932,
    18.058027,
  ],
  [
    54.251235,
    -12.896933,
    30.864409,
    -11.689510,
    -23.367480,
    -33.996424,
    -17.389162,
    -9.970270,
    -12.007672,
    -9.794422,
    -23.175119,
    -9.238426,
  ],
  [
    8.416030,
    -36.992438,
    45.650619,
    -46.278442,
    -12.302262,
    -1.260108,
    3.795125,
    1.104198,
    -25.607063,
    -21.920556,
    -15.808195,
    -16.644407,
  ],
  [
    55.119460,
    -17.648270,
    -26.392399,
    -72.751806,
    -1.160727,
    1.822841,
    -34.575702,
    20.586881,
    -12.744785,
    -9.738746,
    11.251427,
    -4.480415,
  ],
];

#[derive(Debug)]
enum LipSyncError {
  InvalidInput,
  WavParseFailed(String),
  Base64DecodeFailed,
}

impl std::fmt::Display for LipSyncError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      LipSyncError::InvalidInput => write!(f, "invalid_input"),
      LipSyncError::WavParseFailed(reason) => write!(f, "wav_parse_failed:{reason}"),
      LipSyncError::Base64DecodeFailed => write!(f, "base64_decode_failed"),
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackJson {
  fps: u32,
  frame_count: u32,
  duration_ms: u32,
  phoneme_index_base64: String,
  raw_volume_base64: String,
}

#[derive(Clone, Copy, Debug)]
struct WavFormat {
  audio_format: u16,
  channels: u16,
  sample_rate: u32,
  bits_per_sample: u16,
}

fn read_u16_le(bytes: &[u8], off: usize) -> Option<u16> {
  bytes.get(off..off + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn read_u32_le(bytes: &[u8], off: usize) -> Option<u32> {
  bytes
    .get(off..off + 4)
    .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn parse_wav(bytes: &[u8]) -> Result<(WavFormat, Vec<f32>), LipSyncError> {
  if bytes.len() < 12 {
    return Err(LipSyncError::WavParseFailed("too_short".into()));
  }
  if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
    return Err(LipSyncError::WavParseFailed("not_riff_wave".into()));
  }

  let mut fmt: Option<WavFormat> = None;
  let mut data_chunk: Option<&[u8]> = None;

  let mut off = 12usize;
  while off + 8 <= bytes.len() {
    let chunk_id = &bytes[off..off + 4];
    let chunk_size = read_u32_le(bytes, off + 4)
      .ok_or_else(|| LipSyncError::WavParseFailed("bad_chunk_size".into()))?;
    off += 8;
    let chunk_end = off.saturating_add(chunk_size as usize);
    if chunk_end > bytes.len() {
      break;
    }

    if chunk_id == b"fmt " {
      if chunk_size < 16 {
        return Err(LipSyncError::WavParseFailed("fmt_too_short".into()));
      }
      let audio_format = read_u16_le(bytes, off)
        .ok_or_else(|| LipSyncError::WavParseFailed("bad_fmt".into()))?;
      let channels = read_u16_le(bytes, off + 2)
        .ok_or_else(|| LipSyncError::WavParseFailed("bad_fmt".into()))?;
      let sample_rate = read_u32_le(bytes, off + 4)
        .ok_or_else(|| LipSyncError::WavParseFailed("bad_fmt".into()))?;
      let bits_per_sample = read_u16_le(bytes, off + 14)
        .ok_or_else(|| LipSyncError::WavParseFailed("bad_fmt".into()))?;
      fmt = Some(WavFormat {
        audio_format,
        channels,
        sample_rate,
        bits_per_sample,
      });
    } else if chunk_id == b"data" {
      data_chunk = Some(&bytes[off..chunk_end]);
    }

    off = chunk_end + (chunk_end % 2);
  }

  let fmt = fmt.ok_or_else(|| LipSyncError::WavParseFailed("missing_fmt".into()))?;
  let data = data_chunk.ok_or_else(|| LipSyncError::WavParseFailed("missing_data".into()))?;

  if fmt.channels == 0 || fmt.sample_rate == 0 {
    return Err(LipSyncError::WavParseFailed("invalid_header".into()));
  }

  let samples = decode_pcm_to_f32(&fmt, data)?;
  Ok((fmt, samples))
}

fn decode_pcm_to_f32(fmt: &WavFormat, data: &[u8]) -> Result<Vec<f32>, LipSyncError> {
  match (fmt.audio_format, fmt.bits_per_sample) {
    (1, 16) => {
      let bytes_per_sample = 2usize;
      let frame_bytes = bytes_per_sample * fmt.channels as usize;
      if frame_bytes == 0 {
        return Err(LipSyncError::WavParseFailed("bad_frame_bytes".into()));
      }
      let frames = data.len() / frame_bytes;
      let mut out = Vec::with_capacity(frames);
      for f in 0..frames {
        let base = f * frame_bytes;
        let s0 = read_u16_le(data, base)
          .ok_or_else(|| LipSyncError::WavParseFailed("bad_pcm16".into()))?
          as i16;
        out.push((s0 as f32) / 32768.0);
      }
      Ok(out)
    }
    (3, 32) => {
      let bytes_per_sample = 4usize;
      let frame_bytes = bytes_per_sample * fmt.channels as usize;
      if frame_bytes == 0 {
        return Err(LipSyncError::WavParseFailed("bad_frame_bytes".into()));
      }
      let frames = data.len() / frame_bytes;
      let mut out = Vec::with_capacity(frames);
      for f in 0..frames {
        let base = f * frame_bytes;
        let b = data
          .get(base..base + 4)
          .ok_or_else(|| LipSyncError::WavParseFailed("bad_pcmf32".into()))?;
        let v = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
        out.push(v);
      }
      Ok(out)
    }
    _ => Err(LipSyncError::WavParseFailed(format!(
      "unsupported_format:{}_{}",
      fmt.audio_format, fmt.bits_per_sample
    ))),
  }
}

fn pre_emphasis(data: &mut [f32], p: f32) {
  if data.len() < 2 {
    return;
  }
  let tmp = data.to_vec();
  for i in 1..data.len() {
    data[i] = tmp[i] - p * tmp[i - 1];
  }
}

fn hamming_window(data: &mut [f32]) {
  let len = data.len();
  if len < 2 {
    return;
  }
  for i in 0..len {
    let x = i as f32 / (len as f32 - 1.0);
    data[i] *= 0.54 - 0.46 * (2.0 * std::f32::consts::PI * x).cos();
  }
}

fn normalize(data: &mut [f32], value: f32) {
  let mut max = 0.0f32;
  for &x in data.iter() {
    max = max.max(x.abs());
  }
  if max < 1.0e-7 {
    return;
  }
  let r = value / max;
  for x in data.iter_mut() {
    *x *= r;
  }
}

fn rms_volume(data: &[f32]) -> f32 {
  if data.is_empty() {
    return 0.0;
  }
  let mut sum = 0.0f32;
  for &x in data {
    sum += x * x;
  }
  (sum / (data.len() as f32)).sqrt()
}

fn to_mel(hz: f32) -> f32 {
  1127.0 * (hz / 700.0 + 1.0).ln()
}

fn to_hz(mel: f32) -> f32 {
  700.0 * ((mel / 1127.0).exp() - 1.0)
}

fn mel_filter_bank(spectrum: &[f32], sample_rate: u32, mel_div: usize) -> Vec<f32> {
  let len = spectrum.len();
  let mut mel_spectrum = vec![0.0f32; mel_div];
  if len < 2 {
    return mel_spectrum;
  }
  let f_max = sample_rate as f32 / 2.0;
  let mel_max = to_mel(f_max);
  let n_max = len / 2;
  let df = f_max / (n_max as f32);
  let d_mel = mel_max / ((mel_div + 1) as f32);

  for n in 0..mel_div {
    let mel_begin = d_mel * (n as f32);
    let mel_center = d_mel * ((n + 1) as f32);
    let mel_end = d_mel * ((n + 2) as f32);

    let f_begin = to_hz(mel_begin);
    let f_center = to_hz(mel_center);
    let f_end = to_hz(mel_end);

    let i_begin = (f_begin / df).ceil() as i32;
    let i_center = (f_center / df).round() as i32;
    let i_end = (f_end / df).floor() as i32;

    let mut sum = 0.0f32;
    for i in (i_begin + 1)..=i_end {
      if i < 0 {
        continue;
      }
      let i_usize = i as usize;
      if i_usize >= len {
        break;
      }
      let f = df * (i as f32);
      let mut a = if i < i_center {
        (f - f_begin) / (f_center - f_begin)
      } else {
        (f_end - f) / (f_end - f_center)
      };
      a /= (f_end - f_begin) * 0.5;
      sum += a * spectrum[i_usize];
    }
    mel_spectrum[n] = sum;
  }

  mel_spectrum
}

fn power_to_db(mel_spectrum: &mut [f32]) {
  for x in mel_spectrum.iter_mut() {
    let v = (*x).max(1.0e-12);
    *x = 10.0 * v.log10();
  }
}

fn dct(spectrum: &[f32]) -> Vec<f32> {
  let len = spectrum.len();
  let mut cepstrum = vec![0.0f32; len];
  if len == 0 {
    return cepstrum;
  }
  let a = std::f32::consts::PI / (len as f32);
  for i in 0..len {
    let mut sum = 0.0f32;
    for j in 0..len {
      let ang = (j as f32 + 0.5) * (i as f32) * a;
      sum += spectrum[j] * ang.cos();
    }
    cepstrum[i] = sum;
  }
  cepstrum
}

fn cosine_similarity_score(mfcc: &[f32; 12], phoneme: &[f32; 12]) -> f32 {
  let mut prod = 0.0f32;
  let mut mfcc_norm = 0.0f32;
  let mut phoneme_norm = 0.0f32;
  for i in 0..12 {
    let x = mfcc[i];
    let y = phoneme[i];
    mfcc_norm += x * x;
    phoneme_norm += y * y;
    prod += x * y;
  }
  let mfcc_norm = mfcc_norm.sqrt();
  let phoneme_norm = phoneme_norm.sqrt();
  if mfcc_norm <= 1.0e-12 || phoneme_norm <= 1.0e-12 {
    return 0.0;
  }
  let mut similarity = prod / (mfcc_norm * phoneme_norm);
  if similarity.is_nan() || similarity.is_infinite() {
    similarity = 0.0;
  }
  similarity = similarity.max(0.0);
  similarity.powf(100.0)
}

fn compute_mfcc_12(samples_16k_1024: &[f32], fft: &dyn rustfft::Fft<f32>) -> [f32; 12] {
  let mut data = samples_16k_1024.to_vec();
  pre_emphasis(&mut data, 0.97);
  hamming_window(&mut data);
  normalize(&mut data, 1.0);

  let mut buf: Vec<Complex32> = data
    .into_iter()
    .map(|re| Complex32 { re, im: 0.0 })
    .collect();
  fft.process(&mut buf);

  let mut spectrum = vec![0.0f32; buf.len()];
  for (i, c) in buf.iter().enumerate() {
    spectrum[i] = (c.re * c.re + c.im * c.im).sqrt();
  }

  let mut mel = mel_filter_bank(&spectrum, TARGET_SAMPLE_RATE, MEL_FILTER_BANK_CHANNELS);
  power_to_db(&mut mel);
  let cep = dct(&mel);

  let mut mfcc = [0.0f32; 12];
  for i in 0..12 {
    mfcc[i] = cep.get(i + 1).copied().unwrap_or(0.0);
  }
  mfcc
}

fn resample_to_16k(input: &[f32], input_rate: u32) -> Vec<f32> {
  if input_rate == 0 {
    return Vec::new();
  }
  if input_rate == TARGET_SAMPLE_RATE {
    return input.to_vec();
  }
  let ratio = TARGET_SAMPLE_RATE as f64 / input_rate as f64;
  let out_len = ((input.len() as f64) * ratio).round().max(0.0) as usize;
  if out_len == 0 {
    return Vec::new();
  }

  let mut out = vec![0.0f32; out_len];
  for i in 0..out_len {
    let src = (i as f64) / ratio;
    let i0 = src.floor() as isize;
    let t = (src - (i0 as f64)) as f32;
    let s0 = if i0 >= 0 && (i0 as usize) < input.len() {
      input[i0 as usize]
    } else {
      0.0
    };
    let s1 = if i0 + 1 >= 0 && ((i0 + 1) as usize) < input.len() {
      input[(i0 + 1) as usize]
    } else {
      s0
    };
    out[i] = s0 + (s1 - s0) * t;
  }
  out
}

fn compute_track_json(wav_base64: &str, fps: u32) -> Result<String, LipSyncError> {
  if wav_base64.trim().is_empty() {
    return Err(LipSyncError::InvalidInput);
  }

  let sanitized = match wav_base64.split_once(',') {
    Some((_, tail)) => tail,
    None => wav_base64,
  };
  let wav_bytes = B64
    .decode(sanitized.trim())
    .map_err(|_| LipSyncError::Base64DecodeFailed)?;
  let (fmt, samples) = parse_wav(&wav_bytes)?;
  let duration_ms = if fmt.sample_rate > 0 {
    ((samples.len() as u64) * 1000 / (fmt.sample_rate as u64)) as u32
  } else {
    0
  };

  let samples_16k = resample_to_16k(&samples, fmt.sample_rate);
  let frame_count = if fps == 0 {
    0
  } else {
    ((duration_ms as u64 * fps as u64 + 999) / 1000) as u32
  };

  let hop = (TARGET_SAMPLE_RATE as f32 / (fps as f32)).round().max(1.0) as usize;

  let mut planner = FftPlanner::<f32>::new();
  let fft = planner.plan_fft_forward(SAMPLE_COUNT);

  let mut phoneme_indices: Vec<u8> = Vec::with_capacity(frame_count as usize);
  let mut raw_volumes: Vec<f32> = Vec::with_capacity(frame_count as usize);

  for i in 0..(frame_count as usize) {
    let end = i.saturating_mul(hop).min(samples_16k.len());
    let start = end.saturating_sub(SAMPLE_COUNT);
    let mut window = vec![0.0f32; SAMPLE_COUNT];
    let slice = &samples_16k[start..end];
    window[SAMPLE_COUNT - slice.len()..].copy_from_slice(slice);

    let raw_vol = rms_volume(&window);
    let mfcc = compute_mfcc_12(&window, fft.as_ref());

    let mut scores = [0.0f32; 5];
    let mut sum = 0.0f32;
    for (idx, ph) in PHONEMES.iter().enumerate() {
      let s = cosine_similarity_score(&mfcc, ph);
      scores[idx] = s;
      sum += s;
    }
    if sum > 0.0 {
      for s in scores.iter_mut() {
        *s /= sum;
      }
    }

    let mut best_i = 0usize;
    let mut best_s = -1.0f32;
    for (idx, &s) in scores.iter().enumerate() {
      if s > best_s {
        best_s = s;
        best_i = idx;
      }
    }

    phoneme_indices.push(best_i as u8);
    raw_volumes.push(raw_vol);
  }

  let phoneme_index_base64 = B64.encode(&phoneme_indices);
  let mut raw_bytes = Vec::with_capacity(raw_volumes.len() * 4);
  for v in raw_volumes {
    raw_bytes.extend_from_slice(&v.to_le_bytes());
  }
  let raw_volume_base64 = B64.encode(&raw_bytes);

  let json = TrackJson {
    fps,
    frame_count,
    duration_ms,
    phoneme_index_base64,
    raw_volume_base64,
  };

  serde_json::to_string(&json)
    .map_err(|_| LipSyncError::WavParseFailed("json_encode_failed".into()))
}

#[wasm_bindgen]
pub fn compute_track_json_wasm(wav_base64: &str, fps: u32) -> Result<String, JsValue> {
  let fps = fps.clamp(1, 120);
  compute_track_json(wav_base64, fps).map_err(|err| JsValue::from_str(&err.to_string()))
}
