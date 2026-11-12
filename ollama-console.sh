#!/bin/sh
# Gives the console its own Ollama, so plain-words requests don't wait
# behind other programs that use Ollama. macOS only. Optional.
#
# Ollama answers one request at a time. If something else on your computer
# keeps it busy, the console's requests queue behind it for a minute or more.
# This runs a second Ollama on port 11435 that only the console uses. It
# shares the models you already have, and holds about 6 GB of memory while
# its model is loaded (it unloads after 10 idle minutes).
#
#   sh ollama-console.sh install   start it now and at every login
#   sh ollama-console.sh remove    stop it
#   sh ollama-console.sh status    is it running

set -u

LABEL="com.spotify-minigame-ui.ollama-console"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=11435

find_ollama() {
  for candidate in "$(command -v ollama 2>/dev/null)" /Applications/Ollama.app/Contents/Resources/ollama /opt/homebrew/bin/ollama /usr/local/bin/ollama; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
}

install() {
  ollama="$(find_ollama)"
  if [ -z "$ollama" ]; then echo "Ollama isn't installed. Get it from https://ollama.com"; exit 1; fi
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$ollama</string><string>serve</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_HOST</key><string>127.0.0.1:$PORT</string>
    <key>OLLAMA_ORIGINS</key><string>https://xpui.app.spotify.com</string>
    <key>OLLAMA_KEEP_ALIVE</key><string>10m</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || { echo "Couldn't start it. The job file is at $PLIST"; exit 1; }
  sleep 2
  status
}

remove() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  rm -f "$PLIST"
  echo "The console's own Ollama is off. The console goes back to the usual one."
}

status() {
  if [ "$(curl -s -m 3 -o /dev/null -w "%{http_code}" -H "Origin: https://xpui.app.spotify.com" "http://localhost:$PORT/api/tags")" = "200" ]; then
    echo "The console's own Ollama is running on port $PORT."
  else
    echo "The console's own Ollama isn't running."
  fi
}

case "${1:-}" in
  install) install ;;
  remove) remove ;;
  status) status ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
