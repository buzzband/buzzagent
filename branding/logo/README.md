# Branding

## App icon / logo

- `buzzagent-icon.svg` — the source of truth: the **Noto honeybee** 🐝
  (Google, emoji_u1f41d) standalone on a transparent background — the bee is
  shown in profile with its face visible.
- Bee artwork license: **SIL Open Font License 1.1** — see
  `noto-OFL-LICENSE.txt`; original kept as `noto-bee-1f41d.svg`.
- Historical alternatives (kept for reference): Twemoji honeybee
  (`twemoji-bee-1f41d.svg`, MIT) — top-down view; Fluent Flat/Color (MIT) were
  evaluated too.
- The same SVG ships inside the app as `src/assets/app-icon.svg` and is shown
  on the main screen (empty-chat greeting) and in the custom titlebar.

## Regenerating the icon set

`src-tauri/icons/` (32/64/128/256 PNG, 512 `icon.png`, multi-size `icon.ico`)
is generated from the SVG:

```sh
for s in 32 64 128 256 512; do
  rsvg-convert -w $s -h $s branding/logo/buzzagent-icon.svg -o /tmp/icon-$s.png
done
# 48px is only needed inside the .ico
rsvg-convert -w 48 -h 48 branding/logo/buzzagent-icon.svg -o /tmp/icon-48.png
rsvg-convert -w 16 -h 16 branding/logo/buzzagent-icon.svg -o /tmp/icon-16.png
# icon.ico = PNG entries (256/128/64/48/32/16) packed into an ICO container
# (scripts do this with python3/struct — ImageMagick lacks an ICO encoder here)
```

Copy the results over `src-tauri/icons/`, bump the version, and run
`scripts/build-linux-release.sh`.

## Colors

- The bee keeps its original Noto palette on a transparent background; it is
  legible on both dark and light system surfaces.

## Preview

`preview.html` renders the icon at 512/128/64/32/16 px (the SVG is inlined as
a data URL so it works from the preview server).
