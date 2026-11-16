#!/bin/bash
# Removes what install.sh created. Your state (runs, ledger, plans) and config.json are KEPT unless you pass --purge.
# A login item or MCP registration you added yourself is not touched; if one exists it is reported.
set -euo pipefail

ROOT="${REDDOG_HOME:-$HOME/Library/Application Support/RedDogToolkit}"
BIN_DIR="$HOME/.local/bin"
APP="$HOME/Applications/RedDogToolkit.app"
LAUNCHER_MARK="# RedDogToolkit launcher"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

say() { printf '%s\n' "$*"; }

if [ -x "$BIN_DIR/reddog" ] && grep -q "$LAUNCHER_MARK" "$BIN_DIR/reddog"; then
  "$BIN_DIR/reddog" service stop >/dev/null 2>&1 || true
  rm -f "$BIN_DIR/reddog"; say "removed $BIN_DIR/reddog"
fi
if [ -x "$BIN_DIR/reddog-mcp" ] && grep -q "$LAUNCHER_MARK" "$BIN_DIR/reddog-mcp"; then rm -f "$BIN_DIR/reddog-mcp"; say "removed $BIN_DIR/reddog-mcp"; fi
if [ -f "$APP/Contents/Resources/.reddog" ]; then rm -rf "$APP"; say "removed $APP"; fi
if [ -d "$ROOT" ]; then
  rm -rf "$ROOT/versions"; rm -f "$ROOT/current"; say "removed installed versions"
  if [ "$PURGE" = 1 ]; then rm -rf "$ROOT"; say "removed $ROOT (state and config included)";
  else say "kept $ROOT/state and $ROOT/config.json (use --purge to delete them)"; fi
fi
[ -e "$HOME/Library/LaunchAgents/com.reddog.toolkit.plist" ] && say "NOTE: a login item exists at ~/Library/LaunchAgents/com.reddog.toolkit.plist; remove it yourself if you no longer want it."
say "done"
