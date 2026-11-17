#!/bin/bash
# RedDogToolkit installer (macOS, per user, never sudo).
#
# Run it as:   bash install.sh        (works even if the zip lost the executable bit or macOS quarantined the file)
#
# Creates, and only these:
#   ~/Library/Application Support/RedDogToolkit/   install root: versions/<v>/, current -> versions/<v>, config.json, state/
#   ~/.local/bin/reddog                             command launcher
#   ~/Applications/RedDogToolkit.app                dashboard launcher
# It does NOT: use sudo, edit your shell profile, install a login item (LaunchAgent), or register an MCP server.
# Re-running upgrades in place: state and config.json are kept; the previous version stays for rollback.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$HERE/VERSION")"
ROOT="${REDDOG_HOME:-$HOME/Library/Application Support/RedDogToolkit}"
BIN_DIR="$HOME/.local/bin"
APP="$HOME/Applications/RedDogToolkit.app"
LAUNCHER_MARK="# RedDogToolkit launcher"

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS."
[ "$(id -u)" != "0" ] || die "Do not run this with sudo. It installs into your own folders; root-owned files there would break later upgrades."
[ -d "$HERE/app" ] || die "app/ folder not found next to install.sh. Unzip the whole archive and run the installer from inside it."

# ---- Node: the first candidate that is 22.16 or newer. A double-clicked/GUI launch has a short PATH, so look in the usual places too.
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)' >/dev/null 2>&1; }
NODE=""
if [ -n "${REDDOG_NODE:-}" ]; then
  # An explicit choice is honoured or refused; it never silently falls back to another Node.
  node_ok "$REDDOG_NODE" || die "REDDOG_NODE=$REDDOG_NODE is not a usable Node 22.16 or newer."
  NODE="$REDDOG_NODE"
fi
for candidate in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V -r) $(ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node 2>/dev/null | sort -V -r); do
  [ -n "$NODE" ] && break
  if [ -n "$candidate" ] && [ -x "$candidate" ] && node_ok "$candidate"; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  FOUND="$(command -v node 2>/dev/null || true)"
  [ -n "$FOUND" ] && die "Node $("$FOUND" -v) is too old. RedDogToolkit needs Node 22.16 or newer. Install it (https://nodejs.org or 'brew install node') and run this again."
  die "Node.js was not found. Install Node 22.16 or newer (https://nodejs.org or 'brew install node') and run this again."
fi

# ---- a launcher or app we did not create is never overwritten
if [ -e "$BIN_DIR/reddog" ] && ! grep -q "$LAUNCHER_MARK" "$BIN_DIR/reddog" 2>/dev/null; then
  die "$BIN_DIR/reddog exists and was not created by RedDogToolkit. Move it away and run again."
fi
if [ -e "$APP" ] && [ ! -f "$APP/Contents/Resources/.reddog" ]; then
  die "$APP exists and was not created by RedDogToolkit. Move it away and run again."
fi

# ---- we must be able to write where we install; say so plainly if not
ensure_dir() { mkdir -p "$1" 2>/dev/null && [ -w "$1" ] || die "Cannot write to $1. Check the folder's permissions (it must belong to your user)."; }
ensure_dir "$ROOT"; ensure_dir "$BIN_DIR"; ensure_dir "$(dirname "$APP")"

# ---- upgrade: stop a running service of the installed version first
if [ -x "$BIN_DIR/reddog" ] && grep -q "$LAUNCHER_MARK" "$BIN_DIR/reddog" 2>/dev/null; then
  "$BIN_DIR/reddog" service stop >/dev/null 2>&1 || true
fi

say "Installing RedDogToolkit $VERSION (node: $NODE)"
mkdir -p "$ROOT/versions" "$ROOT/state"
rm -rf "$ROOT/versions/$VERSION"
cp -R "$HERE/app" "$ROOT/versions/$VERSION"
chmod -R u+rwX,go-w "$ROOT/versions/$VERSION"
# Files from a downloaded archive carry macOS's quarantine flag. Remove it from what we installed so it runs without a prompt.
xattr -dr com.apple.quarantine "$ROOT/versions/$VERSION" 2>/dev/null || true

# ---- Chrome (browser features need it). Looked for, never installed.
CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
  [ -x "$c" ] && { CHROME="$c"; break; }
done

# ---- config.json lives outside the version folder so upgrades keep it. Created only if missing.
if [ ! -f "$ROOT/config.json" ]; then
  CHROME_LINE=""
  [ -n "$CHROME" ] && CHROME_LINE="  \"chromePath\": \"$CHROME\","
  cat > "$ROOT/config.json" <<EOF
{
$CHROME_LINE
  "stateDir": "$ROOT/state",
  "profilesDir": "$ROOT/current/profiles",
  "controllerPort": 7481
}
EOF
  say "  created config.json"
else
  say "  kept your config.json"
fi

ln -sfn "versions/$VERSION" "$ROOT/current"

cat > "$BIN_DIR/reddog" <<EOF
#!/bin/sh
$LAUNCHER_MARK
export REDDOG_CONFIG="$ROOT/config.json"
NODE="$NODE"
[ -x "\$NODE" ] || NODE=node
exec "\$NODE" "$ROOT/current/dist/adapters/cli.js" "\$@"
EOF
chmod 755 "$BIN_DIR/reddog"

# The MCP server is a separate entry point: an AI client launches this command and talks to it over stdio.
if [ -e "$BIN_DIR/reddog-mcp" ] && ! grep -q "$LAUNCHER_MARK" "$BIN_DIR/reddog-mcp" 2>/dev/null; then
  die "$BIN_DIR/reddog-mcp exists and was not created by RedDogToolkit. Move it away and run again."
fi
cat > "$BIN_DIR/reddog-mcp" <<EOF
#!/bin/sh
$LAUNCHER_MARK
export REDDOG_CONFIG="$ROOT/config.json"
NODE="$NODE"
[ -x "\$NODE" ] || NODE=node
exec "\$NODE" "$ROOT/current/dist/adapters/mcp.js" "\$@"
EOF
chmod 755 "$BIN_DIR/reddog-mcp"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
: > "$APP/Contents/Resources/.reddog"
[ -f "$HERE/reddog.icns" ] && cp "$HERE/reddog.icns" "$APP/Contents/Resources/reddog.icns"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>RedDogToolkit</string>
  <key>CFBundleDisplayName</key><string>RedDogToolkit</string>
  <key>CFBundleIdentifier</key><string>com.reddog.toolkit.dashboard</string>
  <key>CFBundleExecutable</key><string>RedDogToolkit</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>reddog</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
cat > "$APP/Contents/MacOS/RedDogToolkit" <<EOF
#!/bin/sh
# Opens the RedDogToolkit dashboard, starting its server first if it is not already answering.
URL="http://127.0.0.1:7481/"
export REDDOG_CONFIG="$ROOT/config.json"
NODE="$NODE"
[ -x "\$NODE" ] || NODE=node
if ! curl -fs -o /dev/null --max-time 1 "\$URL"; then
  mkdir -p "$ROOT/state/logs"
  nohup "\$NODE" "$ROOT/current/dist/service/controller-main.js" >> "$ROOT/state/logs/controller.out" 2>&1 &
  i=0; while [ \$i -lt 40 ]; do curl -fs -o /dev/null --max-time 1 "\$URL" && break; i=\$((i+1)); sleep 0.25; done
fi
open "\$URL"
EOF
chmod 755 "$APP/Contents/MacOS/RedDogToolkit"
# An ad-hoc signature (no Apple account needed) gives the app a valid, consistent bundle. It is not a Developer ID.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -cr "$APP" 2>/dev/null || true

# ---- prove it works before reporting success
"$BIN_DIR/reddog" describe >/dev/null 2>&1 || die "Installed, but 'reddog describe' failed. Run: $BIN_DIR/reddog describe   to see why."
INSTALLED="$("$BIN_DIR/reddog" service status 2>/dev/null || true)"

say ""
say "Installed RedDogToolkit $VERSION and verified that it runs."
say "  install root : $ROOT"
say "  command      : $BIN_DIR/reddog"
say "  MCP server   : $BIN_DIR/reddog-mcp"
say "  dashboard    : $APP"
say "  chrome       : ${CHROME:-NOT FOUND}"
say ""
[ -n "$CHROME" ] || warn "Google Chrome was not found. observe, screenshot and frames need it. Install Chrome, then set \"chromePath\" in $ROOT/config.json (or run: reddog doctor)."
case ":$PATH:" in
  *":$BIN_DIR:"*) say "'reddog' is on your PATH." ;;
  *) say "NOTE: $BIN_DIR is not on your PATH, so a new shell will not find 'reddog' yet."
     say "Add this line to your shell profile yourself (this installer does not edit it):"
     say "    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
say ""
say "Next steps, all optional and yours to decide:"
say "  reddog service start        start the background service"
say "  open '$APP'                open the dashboard"
say "  reddog service plan         print the login item that WOULD start it at login (writes nothing)"
say "Not done by this installer: a login item, and registering the MCP server in an AI client's config."
say "MCP server command for your client's config:  $BIN_DIR/reddog-mcp   (see README)"
say "Uninstall: bash uninstall.sh from this folder."
