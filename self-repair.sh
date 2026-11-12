#!/bin/sh
# Puts the theme back after Spotify updates itself. macOS only.
#
# Every Spotify update replaces the app's files, which removes Spicetify's
# patch and the theme with it. This checks for that at login, every 30
# minutes, and whenever Spotify's files change. When the patch is gone, it
# opens a Terminal window that re-applies it.
#
#   sh self-repair.sh install   start checking
#   sh self-repair.sh remove    stop checking
#   sh self-repair.sh run       check once, now
#   sh self-repair.sh status    is it on, and what did it last do
#
# Why a Terminal window: macOS only lets programs you've allowed under
# Privacy & Security > App Management change another app. A background job
# isn't one of them, and Spicetify fails badly when it's blocked: it deletes
# Spotify's interface files and then can't write them back. So this never
# starts Spicetify without first checking that it's allowed to write.

set -u

LABEL="com.spotify-minigame-ui.self-repair"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE="$HOME/.config/spicetify/self-repair"
LOG="$STATE/log.txt"
LOCK="$STATE/lock"
HANDOFF="$STATE/re-apply.command"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

find_spicetify() {
  if [ -n "${SPICETIFY:-}" ] && [ -x "$SPICETIFY" ]; then echo "$SPICETIFY"; return; fi
  for candidate in "$(command -v spicetify 2>/dev/null)" "$HOME/.spicetify/spicetify" /opt/homebrew/bin/spicetify /usr/local/bin/spicetify; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
}

# Where Spotify keeps its interface files, according to Spicetify's config.
find_resources() {
  path="$("$1" config spotify_path 2>/dev/null | tail -1)"
  [ -d "$path" ] || path="/Applications/Spotify.app/Contents/Resources"
  echo "$path"
}

say() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >>"$LOG"
  [ -t 1 ] && echo "$*"
  return 0
}

notify() {
  osascript -e "display notification \"$1\" with title \"Spotify Minigame UI\"" >/dev/null 2>&1 || true
}

# Spicetify's output without its colors and spinner frames.
plain() {
  esc="$(printf '\033')"
  tr '\r' '\n' | sed "s/${esc}\[[0-9;]*m//g" | grep -E "success|warning|error|fatal" | sort -u
}

# Is this program allowed to change Spotify's files? Creating a file is the
# honest test: macOS blocks that for programs without App Management access.
can_write() {
  probe="$1/.self-repair-write-test"
  if ( : >"$probe" ) 2>/dev/null; then rm -f "$probe"; return 0; fi
  return 1
}

spotify_pid() { pgrep -x Spotify | head -1; }

# Opened in the last 3 minutes? Then Spotify just updated on launch, and
# restarting it interrupts nothing.
just_opened() {
  [ -n "$1" ] && ps -o etime= -p "$1" | grep -Eq '^ *0[0-2]:[0-9][0-9]$'
}

run() {
  mkdir -p "$STATE"
  spicetify="$(find_spicetify)"
  if [ -z "$spicetify" ]; then say "Spicetify isn't installed. Nothing to do."; exit 0; fi
  resources="$(find_resources "$spicetify")"
  apps="$resources/Apps"

  # A patched Spotify has an xpui folder. A fresh one has xpui.spa instead.
  if [ ! -f "$apps/xpui.spa" ]; then
    [ -t 1 ] && echo "Spotify has the patch. Nothing to do."
    exit 0
  fi

  # One run at a time. A lock older than 10 minutes was left by a crash.
  tries=0
  until mkdir "$LOCK" 2>/dev/null; do
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; continue; fi
    tries=$((tries + 1)); [ "$tries" -lt 5 ] || exit 0
    sleep 1
  done
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT

  # The update may still be copying files. Wait until they've been still for 10 seconds.
  tries=0
  while [ $(( $(date +%s) - $(stat -f %c "$apps/xpui.spa" 2>/dev/null || echo 0) )) -lt 10 ] && [ "$tries" -lt 12 ]; do
    sleep 5; tries=$((tries + 1))
  done
  [ -f "$apps/xpui.spa" ] || exit 0

  version="$(defaults read "${resources%/Resources}/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?")"

  if ! can_write "$apps"; then
    if [ -t 1 ]; then
      say "macOS is blocking this program from changing Spotify, so nothing was touched."
      echo "Allow it once: System Settings > Privacy & Security > App Management, turn on Terminal."
      echo "Then run this again:  sh \"$SELF\" run"
      exit 1
    fi
    # In the background: hand over to a Terminal window, at most once a day
    # per Spotify version, so a blocked Terminal doesn't keep popping up.
    stamp="$version $(date +%Y-%m-%d)"
    [ "$(cat "$STATE/handed-off" 2>/dev/null)" = "$stamp" ] && exit 0
    echo "$stamp" >"$STATE/handed-off"
    say "Spotify $version has no patch. Opening Terminal to re-apply it."
    notify "Spotify updated to $version. Re-applying the theme in Terminal."
    open -a Terminal "$HANDOFF"
    exit 0
  fi

  say "Spotify $version has no patch. Re-applying. This takes about a minute."
  pid="$(spotify_pid)"
  fresh=""
  just_opened "$pid" && fresh=1

  # A new Spotify often needs the newest Spicetify, so update it first.
  if [ -z "${SKIP_SPICETIFY_UPDATE:-}" ]; then
    "$spicetify" update 2>&1 | plain >>"$LOG"
  fi
  "$spicetify" backup apply -n 2>&1 | plain >>"$LOG"
  # If Spicetify already holds a backup of this version, a plain apply is all it needs.
  [ -f "$apps/xpui.spa" ] && "$spicetify" apply -n 2>&1 | plain >>"$LOG"

  if [ -f "$apps/xpui.spa" ] || [ ! -d "$apps/xpui" ]; then
    say "Couldn't re-apply. Details are in $LOG"
    notify "Spotify updated and the theme couldn't be re-applied."
    exit 1
  fi
  rm -f "$STATE/handed-off"

  if [ -n "$fresh" ] && [ -z "${NO_RESTART:-}" ]; then
    pkill -x Spotify 2>/dev/null
    tries=0
    while pgrep -x Spotify >/dev/null && [ "$tries" -lt 20 ]; do sleep 0.5; tries=$((tries + 1)); done
    open "${resources%/Contents/Resources}"
    say "The theme is back on Spotify $version. Spotify was restarted."
  elif [ -n "$pid" ]; then
    say "The theme is back on Spotify $version. Quit and reopen Spotify to see it."
    notify "The theme is re-applied. Quit and reopen Spotify to see it."
  else
    say "The theme is back on Spotify $version."
  fi
  [ -t 1 ] && echo "You can close this window."
  return 0
}

install() {
  spicetify="$(find_spicetify)"
  if [ -z "$spicetify" ]; then echo "Spicetify isn't installed. Install it first: https://spicetify.app"; exit 1; fi
  resources="$(find_resources "$spicetify")"
  mkdir -p "$STATE" "$HOME/Library/LaunchAgents"
  printf '#!/bin/sh\nclear\necho "Spotify Minigame UI: Spotify updated, so the theme needs re-applying."\necho\nSPICETIFY="%s" exec sh "%s" run\n' "$spicetify" "$SELF" >"$HANDOFF"
  chmod +x "$HANDOFF"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$SELF</string><string>run</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SPICETIFY</key><string>$spicetify</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WatchPaths</key>
  <array><string>$resources</string><string>$resources/Apps</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>ThrottleInterval</key><integer>30</integer>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  if launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
    echo "Self-repair is on. After a Spotify update, a Terminal window opens and re-applies the theme."
    echo "Terminal needs to be allowed under System Settings > Privacy & Security > App Management."
    echo "Log: $LOG"
  else
    echo "Couldn't start it. The job file is at $PLIST"; exit 1
  fi
}

remove() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
  rm -f "$PLIST" "$HANDOFF" "$STATE/handed-off"
  echo "Self-repair is off."
}

status() {
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "Self-repair is on."; else echo "Self-repair is off."; fi
  [ -f "$LOG" ] && tail -5 "$LOG"
  return 0
}

case "${1:-}" in
  install) install ;;
  remove) remove ;;
  run) run ;;
  status) status ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
