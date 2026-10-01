#!/usr/bin/env bash
set -e

VERSION="1.18.30"
TARGET_DIR="${1:-bin}"
mkdir -p "$TARGET_DIR"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux)
    case "$ARCH" in
      x86_64) ASSET="opencode-linux-x64.tar.gz" ;;
      aarch64|arm64) ASSET="opencode-linux-arm64.tar.gz" ;;
      *) echo "Unsupported Linux architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  darwin)
    case "$ARCH" in
      x86_64) ASSET="opencode-darwin-x64.zip" ;;
      arm64) ASSET="opencode-darwin-arm64.zip" ;;
      *) echo "Unsupported macOS architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  msys*|mingw*|cygwin*)
    ASSET="opencode-windows-x64.zip"
    ;;
  *)
    echo "Unsupported OS: $OS"; exit 1 ;;
esac

URL="https://github.com/anomalyco/opencode/releases/download/v${VERSION}/${ASSET}"
echo "Downloading OpenCode v${VERSION} (${ASSET}) from GitHub Releases..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -sSL "$URL" -o "$TMP_DIR/$ASSET"

if [[ "$ASSET" == *.tar.gz ]]; then
  tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"
elif [[ "$ASSET" == *.zip ]]; then
  unzip -q "$TMP_DIR/$ASSET" -d "$TMP_DIR"
fi

if [ -f "$TMP_DIR/opencode" ]; then
  mv "$TMP_DIR/opencode" "$TARGET_DIR/opencode"
  chmod +x "$TARGET_DIR/opencode"
elif [ -f "$TMP_DIR/opencode.exe" ]; then
  mv "$TMP_DIR/opencode.exe" "$TARGET_DIR/opencode.exe"
fi

# Tauri `externalBin` expects the binary named with the Rust target triple
# (e.g. opencode-x86_64-unknown-linux-gnu) so each platform bundle picks the
# right one. Stage a triple-named copy next to the plain one; on Windows the
# triple binary also needs the .exe suffix.
TRIPLE=""
case "$OS" in
  linux)
    case "$ARCH" in
      x86_64) TRIPLE="x86_64-unknown-linux-gnu" ;;
      aarch64|arm64) TRIPLE="aarch64-unknown-linux-gnu" ;;
    esac
    ;;
  darwin)
    case "$ARCH" in
      x86_64) TRIPLE="x86_64-apple-darwin" ;;
      arm64) TRIPLE="aarch64-apple-darwin" ;;
    esac
    ;;
  msys*|mingw*|cygwin*)
    TRIPLE="x86_64-pc-windows-msvc"
    ;;
esac
if [ -n "$TRIPLE" ]; then
  if [ -f "$TARGET_DIR/opencode.exe" ]; then
    cp "$TARGET_DIR/opencode.exe" "$TARGET_DIR/opencode-${TRIPLE}.exe"
  else
    cp "$TARGET_DIR/opencode" "$TARGET_DIR/opencode-${TRIPLE}"
    chmod +x "$TARGET_DIR/opencode-${TRIPLE}"
  fi
  echo "Staged sidecar as opencode-${TRIPLE} for Tauri bundling"
fi

echo "OpenCode v${VERSION} core installed to $TARGET_DIR/opencode"
"$TARGET_DIR/opencode" --version || true
