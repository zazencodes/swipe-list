#!/usr/bin/env bash
# Builds Swipe List, replaces the copy in /Applications and launches it.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
"$root/build.sh"

osascript -e 'tell application id "com.zazencodes.swipelist" to quit' 2>/dev/null || true
# Opening the new copy while the old one is still quitting fails, so wait for it to go.
while pgrep -f "/Applications/Swipe List.app/Contents/MacOS/SwipeList" >/dev/null; do sleep 0.1; done
rm -rf "/Applications/Swipe List.app"
ditto "$root/build/Swipe List.app" "/Applications/Swipe List.app"
open "/Applications/Swipe List.app"
echo "Installed /Applications/Swipe List.app"
