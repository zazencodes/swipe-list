#!/bin/sh
# Installs the swipe CLI and the inspo-swipe-list agent skill from a Swipe List
# server. Served (with the URL filled in) at <agent url>/install.sh:
#
#   curl -fsSL <agent url>/install.sh | sh -s -- <skills-dir>
#
# <skills-dir> is the directory your agent loads skills from, for example
# ~/.claude/skills or ~/.agents/skills. The CLI goes to ~/.local/bin/swipe.
set -eu

URL="__AGENT_URL__"
if [ $# -ne 1 ]; then
  echo "usage: curl -fsSL $URL/install.sh | sh -s -- <skills-dir>" >&2
  exit 2
fi
SKILLS_DIR="$1"
BIN_DIR="$HOME/.local/bin"

command -v node >/dev/null 2>&1 || { echo "swipe needs Node.js 22 or newer on PATH" >&2; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || { echo "swipe needs Node.js 22 or newer (found $(node -v))" >&2; exit 1; }

mkdir -p "$BIN_DIR" "$SKILLS_DIR"
curl -fsSL "$URL/downloads/swipe.mjs" -o "$BIN_DIR/swipe"
chmod +x "$BIN_DIR/swipe"
rm -rf "$SKILLS_DIR/inspo-swipe-list"
curl -fsSL "$URL/downloads/inspo-swipe-list.tar.gz" | tar -xzf - -C "$SKILLS_DIR"

echo "installed $BIN_DIR/swipe"
echo "installed $SKILLS_DIR/inspo-swipe-list"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "note: add $BIN_DIR to PATH" ;; esac
echo "next: swipe login --url $URL   (then paste your swl_ credential)"
