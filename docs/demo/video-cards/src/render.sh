#!/bin/zsh
# Render every card at 3840x2160 (1920x1080 at 2x) and the YouTube thumbnail.
# Run from anywhere: zsh docs/demo/video-cards/src/render.sh
setopt err_exit
src=${0:A:h}
out=${src:h}
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
profile=$(mktemp -d)
typeset -a cards
cards=(intro:0-intro-card vision:1-vision same-tree:2-same-tree-illustration together:3-together results:4-results end:5-end-card)
for pair in $cards; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1920,1080 --user-data-dir="$profile" \
    --screenshot="$out/${pair#*:}.png" "file://$src/${pair%%:*}.html" 2>/dev/null
done
magick "$out/0-intro-card.png" -resize 1280x720 -quality 90 "$out/0-intro-card-youtube-thumbnail.jpg"
rm -rf "$profile"
ls -la "$out"
