#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CRATE_DIR="${PACKAGE_DIR}/rust"
OUT_DIR="${PACKAGE_DIR}/wasm"
OUT_JS="${OUT_DIR}/lipsync_wasm.js"
OUT_WASM="${OUT_DIR}/lipsync_wasm_bg.wasm"
MODE="${1:-build}"

if [ -d "${HOME}/.cargo/bin" ]; then
  PATH="${HOME}/.cargo/bin:${PATH}"
fi

if [ -d "/opt/homebrew/opt/rustup/bin" ]; then
  PATH="/opt/homebrew/opt/rustup/bin:${PATH}"
fi

export PATH

resolve_wasm_pack_cmd() {
  if command -v wasm-pack >/dev/null 2>&1; then
    printf '%s' "wasm-pack"
    return 0
  fi

  if [ -x "${HOME}/.cargo/bin/wasm-pack" ]; then
    printf '%s' "${HOME}/.cargo/bin/wasm-pack"
    return 0
  fi

  if command -v npx >/dev/null 2>&1; then
    printf '%s' "npx --yes wasm-pack"
    return 0
  fi

  return 1
}

has_artifacts() {
  [ -f "${OUT_JS}" ] && [ -f "${OUT_WASM}" ]
}

WASM_PACK_CMD=""
if WASM_PACK_CMD="$(resolve_wasm_pack_cmd)"; then
  :
else
  WASM_PACK_CMD=""
fi

if [ "${MODE}" = "--check" ]; then
  artifacts_ok=0
  build_tools_ok=0

  if has_artifacts; then
    echo "OK: LipSync WASM artifacts are present (${OUT_DIR})"
    artifacts_ok=1
  else
    echo "NG: LipSync WASM artifacts are missing (${OUT_DIR})"
  fi

  if [ -n "${WASM_PACK_CMD}" ]; then
    echo "OK: wasm-pack command is available (${WASM_PACK_CMD})"
  else
    echo "NG: wasm-pack command is not available"
  fi

  if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
    echo "NG: cargo/rustc command is not available"
  else
    echo "OK: cargo/rustc command is available"
    build_tools_ok=1
  fi

  if [ "${artifacts_ok}" -eq 1 ] || [ "${build_tools_ok}" -eq 1 ]; then
    exit 0
  fi

  exit 1
fi

if [ "${MODE}" = "--ensure" ] && has_artifacts; then
  echo "LipSync WASM artifacts are already present: ${OUT_DIR}"
  exit 0
fi

if [ -z "${WASM_PACK_CMD}" ]; then
  echo "wasm-pack が見つかりません。" >&2
  echo "候補: cargo install wasm-pack / npx wasm-pack" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  echo "LipSync WASM の再ビルドには Rust ツールチェーン(cargo/rustc) が必要です。" >&2
  exit 1
fi

if command -v rustup >/dev/null 2>&1; then
  if ! rustup target list --installed | grep -q '^wasm32-unknown-unknown$'; then
    echo "rustup に wasm32-unknown-unknown ターゲットが入っていません。" >&2
    echo "実行: rustup target add wasm32-unknown-unknown" >&2
    exit 1
  fi
fi

mkdir -p "${OUT_DIR}"

${WASM_PACK_CMD} build "${CRATE_DIR}" \
  --target web \
  --release \
  --out-dir "${OUT_DIR}" \
  --out-name lipsync_wasm

echo "LipSync WASM build completed: ${OUT_DIR}"
