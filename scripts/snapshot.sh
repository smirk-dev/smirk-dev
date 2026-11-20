#!/usr/bin/env bash
# Copies third-party README cards into cards/ so the profile serves them from
# this repo instead of hot-linking slow serverless hosts through GitHub's image
# proxy (which times out on cold starts and shows a broken image).
#
# A snapshot only replaces the committed copy when the new download is a real,
# non-error image. If a service is down, the last good copy stays on the page.
set -uo pipefail

OUT="${1:-cards}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
FAILED=0

# snap <name> <url> <min_bytes> <extension>
snap() {
  local name="$1" url="$2" min="$3" ext="$4"
  local tmp="$TMP/$name.$ext"
  local ctype
  ctype=$(curl -fsSL --retry 3 --retry-delay 5 --max-time 90 -A "profile-cards" \
    -o "$tmp" -w '%{content_type}' "$url") || { echo "::warning::$name: download failed"; FAILED=1; return; }
  local size; size=$(stat -c %s "$tmp")
  if [[ "$ctype" != image/* ]]; then
    echo "::warning::$name: not an image ($ctype), keeping last good copy"; FAILED=1; return
  fi
  if (( size < min )); then
    echo "::warning::$name: only $size bytes (< $min), keeping last good copy"; FAILED=1; return
  fi
  if [[ "$ext" == "svg" ]] && grep -qiE "something went wrong|can't fetch|rate limit|not found|error occurred" "$tmp"; then
    echo "::warning::$name: response is an error card, keeping last good copy"; FAILED=1; return
  fi
  mv "$tmp" "$OUT/$name.$ext"
  echo "$name: ok ($size bytes)"
}

snap trophies "https://github-trophies.vercel.app/?username=smirk-dev&theme=monokai&no-frame=true&no-bg=true&margin-w=15&margin-h=15" 10000 svg
snap leetcode "https://leetcard.jacoblin.cool/smirk-dev?theme=dark&font=baloo_2&ext=heatmap" 20000 svg
snap kaggle-badges "https://kaggle-readme-badges.vercel.app/api/kaggle-badges" 50000 svg

# Holopin serves a ~1.2 MB, 2428px-wide PNG. Shrink it to 1000px and quantize
# to a 256-colour palette (~60 KB) before committing.
snap holopin-raw "https://holopin.me/smirkdev" 50000 png
if [[ -f "$OUT/holopin-raw.png" ]]; then
  python3 - "$OUT/holopin-raw.png" "$OUT/holopin.png" <<'PY' && rm -f "$OUT/holopin-raw.png"
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
w = min(1000, im.width)
im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.quantize(256, method=Image.FASTOCTREE).save(dst, optimize=True)
print(f"holopin: optimized to {w}px")
PY
  rm -f "$OUT/holopin-raw.png"
fi

rm -rf "$TMP"
# Never fail the workflow over one flaky host; warnings above show what was skipped.
exit 0
