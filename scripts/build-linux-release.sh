#!/usr/bin/env bash
#
# Build the Linux release artifacts for BuzzAgent: deb, rpm and AppImage.
#
# Why this is not just `tauri build`:
#   * the Tauri rpm bundler hangs with rpm >= 4.20 (stages the payload, then
#     never finishes) — we build the rpm ourselves with rpmbuild from the deb
#     staging tree, which yields the same file layout;
#   * the AppImage is assembled with appimagetool + a type-2 runtime so the
#     desktop entry can use the spec-compliant `Exec=AppRun` with a shim that
#     exports APPDIR (the bundler's $APPDIR Exec value fails desktop-file
#     validation).
#
# Usage: scripts/build-linux-release.sh [--skip-build]
# Artifacts land in ./releases/ together with SHA256SUMS.txt.

set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_BUILD=false
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=true

VERSION=$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
echo "==> Building BuzzAgent ${VERSION} (linux/amd64)"

STAGING="src-tauri/target/release/bundle"

if [[ "$SKIP_BUILD" == false ]]; then
  echo "==> npm run build (vite + tauri; produces the deb)"
  npm run build
fi

DEB_DIR="${STAGING}/deb/BuzzAgent_${VERSION}_amd64"
DEB_FILE="${STAGING}/deb/BuzzAgent_${VERSION}_amd64.deb"
[[ -f "$DEB_FILE" ]] || { echo "missing $DEB_FILE" >&2; exit 1; }

# ---------------------------------------------------------------- rpm
echo "==> rpm (rpmbuild from the deb staging tree)"
RPM_ROOT="${STAGING}/rpm"
rm -rf "${RPM_ROOT}/payload"
mkdir -p "${RPM_ROOT}/payload"
cp -r "${DEB_DIR}/data/." "${RPM_ROOT}/payload/"
SPEC="${RPM_ROOT}/rpmbuild/SPECS/buzzagent.spec"
[[ -f "$SPEC" ]] || { echo "missing $SPEC (created once by hand)" >&2; exit 1; }
sed -i "s/^Version:        .*/Version:        ${VERSION}/" "$SPEC"
TOP="$(cd "${RPM_ROOT}/rpmbuild" && pwd)"
rpmbuild --dbpath "$TOP/rpmdb" --define "_topdir $TOP" \
  --define "_rpmdir $RPM_ROOT" -bb "$SPEC" > /dev/null
RPM_FILE="${RPM_ROOT}/x86_64/buzzagent-${VERSION}-1.x86_64.rpm"
[[ -f "$RPM_FILE" ]] || { echo "rpm build did not produce a file" >&2; exit 1; }

# ------------------------------------------------------------ AppImage
echo "==> AppImage (appimagetool + type-2 runtime)"
TOOLS=/tmp/appimage
mkdir -p "$TOOLS"
[[ -x "$TOOLS/appimagetool" ]] || curl -fsSL -o "$TOOLS/appimagetool" \
  https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
[[ -f "$TOOLS/runtime-x86_64" ]] || curl -fsSL -o "$TOOLS/runtime-x86_64" \
  https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64
chmod +x "$TOOLS/appimagetool"

APPDIR="$TOOLS/BuzzAgent.AppDir"
rm -rf "$APPDIR" && mkdir -p "$APPDIR/usr/bin"
cp src-tauri/target/release/buzzagent "$APPDIR/usr/bin/"
cp src-tauri/bin/opencode "$APPDIR/usr/bin/"
cp "${DEB_DIR}/data/usr/share/applications/BuzzAgent.desktop" "$APPDIR/"
cp "${DEB_DIR}/data/usr/share/icons/hicolor/256x256/apps/buzzagent.png" "$APPDIR/buzzagent.png"
ln -sf buzzagent.png "$APPDIR/.DirIcon"
sed -i 's#^Exec=.*#Exec=AppRun#' "$APPDIR/BuzzAgent.desktop"
cat > "$APPDIR/AppRun" << 'SH'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
export APPDIR="$HERE"
export PATH="$HERE/usr/bin:$PATH"
exec "$HERE/usr/bin/buzzagent" "$@"
SH
chmod +x "$APPDIR/AppRun"
(cd "$TOOLS" && ARCH=x86_64 ./appimagetool --runtime-file runtime-x86_64 \
  --comp zstd "BuzzAgent.AppDir" "BuzzAgent_${VERSION}_amd64.AppImage") > /dev/null
APPIMAGE_FILE="$TOOLS/BuzzAgent_${VERSION}_amd64.AppImage"
[[ -f "$APPIMAGE_FILE" ]] || { echo "appimagetool produced no file" >&2; exit 1; }

# ------------------------------------------------------------- publish
echo "==> releases/"
mkdir -p releases
cp "$DEB_FILE" "$RPM_FILE" "$APPIMAGE_FILE" releases/
chmod +x "releases/BuzzAgent_${VERSION}_amd64.AppImage"
( cd releases && sha256sum \
    "BuzzAgent_${VERSION}_amd64.AppImage" \
    "BuzzAgent_${VERSION}_amd64.deb" \
    "buzzagent-${VERSION}-1.x86_64.rpm" > SHA256SUMS.txt )

ls -la releases/
echo "==> done: BuzzAgent ${VERSION}"
