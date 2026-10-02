#!/usr/bin/env bash
# Stage the pinned OpenCode core for Tauri's `bundle > externalBin`.
#
# Tauri's build script requires every sidecar to be named
# `<name>-<rust-target-triple>`, so a job that cross-builds — an Apple Silicon
# runner producing the Intel macOS bundle, for example — must stage the binary
# for its *build target*, not for the host. Extra targets are passed as
# trailing arguments:
#
#   ./scripts/setup-core.sh src-tauri/bin
#   ./scripts/setup-core.sh src-tauri/bin x86_64-apple-darwin
#
# The host target also gets the plain `opencode` name used by `npm run dev`.
set -euo pipefail

VERSION="1.18.30"
TARGET_DIR="${1:-bin}"
shift || true

asset_for() {
  case "$1" in
    x86_64-unknown-linux-gnu) echo "opencode-linux-x64.tar.gz" ;;
    aarch64-unknown-linux-gnu) echo "opencode-linux-arm64.tar.gz" ;;
    x86_64-apple-darwin) echo "opencode-darwin-x64.zip" ;;
    aarch64-apple-darwin) echo "opencode-darwin-arm64.zip" ;;
    x86_64-pc-windows-msvc) echo "opencode-windows-x64.zip" ;;
    *) echo "" ;;
  esac
}

exe_for() {
  case "$1" in
    *windows*) echo ".exe" ;;
    *) echo "" ;;
  esac
}

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$OS" in
  linux | darwin) ;;
  msys* | mingw* | cygwin*)
    OS="windows"
    ARCH="x86_64"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

case "$OS:$ARCH" in
  linux:x86_64) HOST_TRIPLE="x86_64-unknown-linux-gnu" ;;
  linux:aarch64 | linux:arm64) HOST_TRIPLE="aarch64-unknown-linux-gnu" ;;
  darwin:x86_64) HOST_TRIPLE="x86_64-apple-darwin" ;;
  darwin:arm64) HOST_TRIPLE="aarch64-apple-darwin" ;;
  windows:x86_64) HOST_TRIPLE="x86_64-pc-windows-msvc" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Host first (it also provides the plain `opencode` binary), then every extra
# target the caller asked for, without duplicates.
TRIPLES=("$HOST_TRIPLE")
for want in "$@"; do
  [ -z "$want" ] && continue
  if [ -z "$(asset_for "$want")" ]; then
    echo "Unsupported Rust target triple: $want"
    exit 1
  fi
  for have in "${TRIPLES[@]}"; do
    if [ "$have" = "$want" ]; then
      continue 2
    fi
  done
  TRIPLES+=("$want")
done

mkdir -p "$TARGET_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for triple in "${TRIPLES[@]}"; do
  ASSET="$(asset_for "$triple")"
  SRC="$TMP_DIR/$triple"
  mkdir -p "$SRC"

  echo "Downloading OpenCode v${VERSION} (${ASSET}) from GitHub Releases..."
  curl -fsSL \
    "https://github.com/anomalyco/opencode/releases/download/v${VERSION}/${ASSET}" \
    -o "$TMP_DIR/$ASSET"

  if [[ "$ASSET" == *.tar.gz ]]; then
    tar -xzf "$TMP_DIR/$ASSET" -C "$SRC"
  else
    unzip -q "$TMP_DIR/$ASSET" -d "$SRC"
  fi

  if [ -f "$SRC/opencode.exe" ]; then
    BIN="$SRC/opencode.exe"
  elif [ -f "$SRC/opencode" ]; then
    BIN="$SRC/opencode"
  else
    echo "Archive ${ASSET} did not contain an opencode binary"
    exit 1
  fi

  EXT="$(exe_for "$triple")"
  cp "$BIN" "$TARGET_DIR/opencode-${triple}${EXT}"
  chmod +x "$TARGET_DIR/opencode-${triple}${EXT}"
  echo "Staged sidecar as opencode-${triple}${EXT} for Tauri bundling"

  if [ "$triple" = "$HOST_TRIPLE" ]; then
    cp "$BIN" "$TARGET_DIR/opencode${EXT}"
    chmod +x "$TARGET_DIR/opencode${EXT}"
    echo "OpenCode v${VERSION} core installed to $TARGET_DIR/opencode${EXT}"
    "$TARGET_DIR/opencode${EXT}" --version || true
  fi
done
