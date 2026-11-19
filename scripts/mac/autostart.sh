#!/bin/bash
# Démarrage automatique de NEXUS à l'ouverture de session sur le Mac (launchd).
# Utile pour joindre Jarvis depuis l'iPhone sans penser à lancer NEXUS.
#   ./scripts/mac/autostart.sh install     → installe et démarre
#   ./scripts/mac/autostart.sh uninstall   → arrête et retire
#   ./scripts/mac/autostart.sh status      → état
set -euo pipefail
LABEL="com.nexus.personal-os"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$ROOT/data/logs"

case "${1:-}" in
  install)
    NODE="$(command -v node || true)"
    [ -n "$NODE" ] || { echo "Node.js introuvable : installe-le depuis https://nodejs.org"; exit 1; }
    cd "$ROOT"
    [ -d node_modules ] || npm install
    echo "Compilation de l'interface…"
    npm run build
    mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/node_modules/tsx/dist/cli.mjs</string>
    <string>$ROOT/server/index.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>NODE_OPTIONS</key><string>--no-warnings=ExperimentalWarning</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/nexus.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/nexus.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "✓ NEXUS démarrera automatiquement à chaque ouverture de session."
    echo "  Interface : http://localhost:4317 · Journal : $LOG_DIR/nexus.log"
    echo "  Après une mise à jour du code : relance cette commande (recompile l'interface)."
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ Démarrage automatique retiré."
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "Actif"; else echo "Inactif"; fi
    ;;
  *)
    echo "Usage : $0 install | uninstall | status"; exit 1 ;;
esac
