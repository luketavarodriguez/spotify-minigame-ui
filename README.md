# Spotify Minigame UI

A Spicetify theme that turns Spotify's player bar into a small arcade. The playback bar becomes the ground for three games that play along with whatever song is on, synced to its beat.

Developed by [@iamtava](https://x.com/iamtava) on X and [@tava](https://instagram.com/tava) on Instagram.

![Spotify Minigame UI](preview.png)

## What it does

- **Three games on the playback bar:** the Chrome dino, flappy, and a side-scrolling shooter.
  - **Auto** mode plays itself along with the song.
  - **Play** mode is yours: `↑` jumps or flaps, `↓` ducks, and the shooter moves with `↑` `↓`.
  - Space stays Spotify's play/pause. Crashing pauses the song, and resuming starts a new run.
- **Synced to the music:** it reads Spotify's audio analysis for each song.
  - Obstacles land on the beat, and loud sections put one on every beat.
  - Flappy's gravity follows the tempo, so you flap in time.
  - The shooter's gun fires on the beat and the aliens march to it.
  - On auto, the difficulty follows the song's BPM.
- **Lyrics** scroll one line at a time along the top border.
- **Up next:** the queue sits on the right. Click a song to play it. Each song shows its BPM and its key on the Camelot wheel, so you can see which songs will mix well before they play.
- **Listening stats** on Home: session, today and this month, plus top songs and artists.
- **Two looks:** the terminal look (monospace, green borders, green halftone artwork) or Spotify's own look, keeping the layout and the games.
- **Two views:** the tall games view, or a compact player bar with no games.

## Install with your AI assistant

Paste this into an AI coding assistant that can run commands on your computer, and it will do the install for you:

```text
Install the Spotify Minigame UI theme on my computer:

1. Install Spicetify if it isn't installed:
   - macOS or Linux: curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sh
   - Windows (PowerShell): iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex
   If Spotify on Windows came from the Microsoft Store, stop and tell me to reinstall it from spotify.com first.
2. Clone https://github.com/luketavarodriguez/spotify-minigame-ui into the Spicetify Themes folder as "spotify-minigame-ui"
   (~/.config/spicetify/Themes on macOS and Linux, %APPDATA%\spicetify\Themes on Windows).
3. Run: spicetify config current_theme spotify-minigame-ui color_scheme tty inject_theme_js 1 inject_css 1 replace_colors 1
4. Run: spicetify backup apply (or spicetify apply if a backup already exists).
5. Tell me when it's done. Spotify will restart with the theme on.
```

## Install by hand

1. Install [Spicetify](https://spicetify.app/docs/getting-started).
2. Clone this repo into your Spicetify Themes folder:
   - macOS and Linux: `~/.config/spicetify/Themes`
   - Windows: `%APPDATA%\spicetify\Themes`

   ```bash
   git clone https://github.com/luketavarodriguez/spotify-minigame-ui ~/.config/spicetify/Themes/spotify-minigame-ui
   ```

3. Turn it on:

   ```bash
   spicetify config current_theme spotify-minigame-ui color_scheme tty inject_theme_js 1 inject_css 1 replace_colors 1
   spicetify backup apply
   ```

   The first time, use `spicetify backup apply`. After that, `spicetify apply` is enough.

Color schemes: `tty` (default), `amber` and `green`. Switch with `spicetify config color_scheme amber && spicetify apply`.

## Built on Spotify's own labels

Most Spicetify themes style Spotify through Spicetify's class-name map. Spotify scrambles its class names, and the map turns them back into readable ones. Each Spotify update scrambles them again, so a theme built on the map breaks until Spicetify ships a new one.

This theme doesn't use the map. It finds its way around the app with labels Spotify builds in itself: test IDs like `now-playing-bar`, element IDs like `main-view`, and accessibility roles. It keeps working as long as Spotify keeps those labels.

Spicetify is still how the theme loads into the app. You still need it installed, and you still run it after a Spotify update.

## Good to know

- **Where the switches are:** the controls sit on the player bar's top border: game, mode, level, look and view.
- **When the beat data is missing:** beat sync and lyrics come from Spotify's own client endpoints. Songs without analysis, and podcasts or local files, play the games without beat sync.
- **How stats are counted:** the theme keeps the stats itself, in local storage, from the day you install it. A play counts after 30 seconds of listening. Only listening in this Spotify app is counted.
- **Where BPM and key come from:** Spotify's own numbers, the ones behind its Mix feature. The theme asks for them in batches and keeps them in local storage, so each song is asked about once. It also indexes your Liked Songs in the background, about a minute for 6,000 songs.
- **What it's tested on:** Spotify 1.3.9 with Spicetify 2.46.7 on macOS.
- **After a Spotify update:** Spotify updates wipe Spicetify's changes. On macOS, [self-repair](#self-repair-on-macos) puts the theme back for you. By hand: run `spicetify upgrade`, then `spicetify backup apply`. New Spotify versions often need the newer Spicetify. If the theme is showing and you only want to refresh it, `spicetify apply` is enough.

## Self-repair on macOS

Every Spotify update removes the theme. Self-repair notices and puts it back. Turn it on once, from the theme's folder:

```bash
sh self-repair.sh install
```

It checks at login, every 30 minutes, and whenever Spotify's files change. When the patch is gone, a Terminal window opens, updates Spicetify, re-applies the theme and tells you what it did. If Spotify was opened in the last 3 minutes, it restarts Spotify for you. Otherwise it leaves your music alone and the theme shows the next time Spotify starts.

**Allow Terminal first.** macOS only lets programs you've approved change another app. Open System Settings, then Privacy & Security, then App Management, turn on Terminal, and reopen Terminal.

This matters beyond self-repair. If Spicetify runs from a program macOS is blocking, it can delete Spotify's interface files and then fail to write them back, which leaves Spotify broken until you run `spicetify apply` from a program that's allowed. Self-repair checks that it can write before it starts Spicetify, so a blocked run changes nothing.

`sh self-repair.sh status` shows whether it's on and what it last did. `sh self-repair.sh remove` turns it off.

## Credits

The dino sprites and game constants come from Chromium's dino game (`components/neterror/resources/dino_game`), Copyright The Chromium Authors, under a BSD-style license. See [LICENSE](LICENSE). Everything else, including the flappy and shooter art, is original.

## License

MIT, except the Chromium dino sprites and constants, which keep their BSD license. Both are in [LICENSE](LICENSE).
