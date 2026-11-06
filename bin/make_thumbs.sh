#!/usr/bin/env bash
# Generate card thumbnails for every post cover image.
#
#   assets/images/post_123/cover.png  ->  assets/thumbs/post_123/cover.webp
#
# Thumbnails are 800px wide WebP files, which is what the post cards on the
# index, category and tag pages load instead of the full-size cover.
# Requires ImageMagick 7 (`brew install imagemagick`). Re-run after adding
# posts; existing thumbnails that are newer than their source are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."

WIDTH=800
COVER_WIDTH=1600
QUALITY=80
made=0 skipped=0

while IFS= read -r src; do
  [ -f "$src" ] || { echo "missing: $src" >&2; continue; }
  rel="${src#assets/images/}"
  out="assets/thumbs/${rel%.*}.webp"          # 800px, post cards
  cover="assets/thumbs/${rel%.*}.cover.webp"  # 1600px, featured image on the post page
  if [ -f "$out" ] && [ "$out" -nt "$src" ] && [ -f "$cover" ] && [ "$cover" -nt "$src" ]; then
    skipped=$((skipped + 1)); continue
  fi
  mkdir -p "$(dirname "$out")"
  # "[0]" takes the first frame of animated GIFs; harmless for still images.
  magick "${src}[0]" -resize "${WIDTH}x>" -strip -quality "$QUALITY" "$out"
  magick "${src}[0]" -resize "${COVER_WIDTH}x>" -strip -quality "$QUALITY" "$cover"
  made=$((made + 1))
done < <(grep -h "^image:" _posts/*.md | sed -E 's/^image: *//; s/[[:space:]]+$//' | grep -v "://" | sort -u)

echo "thumbnails: $made generated, $skipped up to date"
