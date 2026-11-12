#!/bin/sh
# Lets the console's plain-words requests reach Ollama. macOS only.
#
# Ollama runs language models on your computer, and it refuses requests from
# web pages it hasn't been told about. Spotify's interface is one of those
# pages. This adds its address to Ollama's allowed list (OLLAMA_ORIGINS), and
# restarts Ollama if it's running without it.
#
#   sh ollama-allow.sh install   allow it now, and again at every login
#   sh ollama-allow.sh remove    stop allowing it
#   sh ollama-allow.sh apply     allow it for this login only

set -u

ORIGIN="https://xpui.app.spotify.com"
LABEL="com.spotify-minigame-ui.ollama-allow"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# What Ollama answers to a request from Spotify's page: 200 allowed, 403 refused, 000 not running.
answer() {
  curl -s -m 3 -o /dev/null -w "%{http_code}" -H "Origin: $ORIGIN" http://localhost:11434/api/tags
}

restart_ollama() {
  pkill -x Ollama 2>/dev/null
  pkill -f "Ollama.app/Contents/Resources/ollama serve" 2>/dev/null
  tries=0
  while pgrep -f "ollama serve" >/dev/null && [ "$tries" -lt 20 ]; do sleep 0.5; tries=$((tries + 1)); done
  open -a Ollama
}

apply() {
  current="$(launchctl getenv OLLAMA_ORIGINS)"
  case ",$current," in
    *",$ORIGIN,"*) ;;
    ",,") launchctl setenv OLLAMA_ORIGINS "$ORIGIN" ;;
    *) launchctl setenv OLLAMA_ORIGINS "$current,$ORIGIN" ;;
  esac
  # A running Ollama read its settings when it started. If it still refuses, restart it.
  if [ "$(answer)" = "403" ]; then
    restart_ollama
    tries=0
    while [ "$(answer)" != "200" ] && [ "$tries" -lt 20 ]; do sleep 1; tries=$((tries + 1)); done
  fi
  case "$(answer)" in
    200) echo "Ollama accepts requests from Spotify." ;;
    000) echo "Ollama isn't running. It will accept Spotify the next time it starts." ;;
    *) echo "Ollama still refuses Spotify. Quit and reopen Ollama, then try again."; return 1 ;;
  esac
}

install() {
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$SELF</string><string>apply</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || { echo "Couldn't start it. The job file is at $PLIST"; exit 1; }
  apply
}

remove() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  rm -f "$PLIST"
  current="$(launchctl getenv OLLAMA_ORIGINS)"
  rest="$(echo "$current" | tr ',' '\n' | grep -vxF "$ORIGIN" | paste -sd, -)"
  if [ -n "$rest" ]; then launchctl setenv OLLAMA_ORIGINS "$rest"; else launchctl unsetenv OLLAMA_ORIGINS; fi
  echo "Removed. Quit and reopen Ollama for it to take effect."
}

case "${1:-}" in
  install) install ;;
  remove) remove ;;
  apply) apply ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
