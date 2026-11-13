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
- **Up next:** the queue sits on the right. Click a song to play it. Each song shows its BPM and its key on the Camelot wheel, and the numbers light up when a song mixes cleanly with the one before it.
- **Smooth:** one click on the pane's border reorders the next 30 songs so tempos and keys run into each other. It works on any queue: an album, someone else's playlist, radio. Click again to undo.
- **A working console:** click the prompt in the top bar, or press the backtick key, and type. `find deep house` searches your Liked Songs by genre or mood, and `find 124bpm 8A` by tempo and key. `genres` lists the genres and moods you have. Occasions work too (`find party`, `find workout`), `find reggae or dub` matches any of several, `find 2018` lists songs you liked that year, and `top` lists your most played this month. `mix` lists the ones that mix cleanly with the playing song. `add 1 3 5` queues them. `help` lists every command.
- **Sets:** `set 60m peak` builds an hour of Liked Songs that starts from the playing song, follows a tempo shape (flat, up, down or peak) and mixes cleanly from song to song. Add a genre to keep it in one style: `set 60m peak house`. `play all` starts it, and `save` keeps any list as a playlist, which Spotify's own Mix and DJ apps can then use.
- **Plain words, with a model on your own computer:** type a sentence in the console, such as `play something like this but slower` or `queue 3 songs that mix with this`, and a local model picks the commands. It switches the music when you ask it to play, remembers the conversation, and offers follow-ups you can answer, such as saving what it found as a playlist. This part is optional and needs [Ollama](https://ollama.com). Nothing you type leaves your computer.
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
- **What counts as a clean mix:** tempos within 6% of each other, with half and double time counting as the same tempo, and keys that are the same, one step apart on the Camelot wheel, or major/minor twins. Smooth leaves songs you queued yourself ahead of the rest, the way Spotify plays them.
- **Where genres come from:** Spotify tags each song with genres and moods, each with a weight, and the theme indexes those alongside tempo and key. The tags are Spotify's and some are wrong: a rap song can carry "new age". A set without a genre is chosen by tempo and key alone, so it can put very different songs side by side. Run `set` again for a different draw.
- **Where BPM and key come from:** Spotify's own numbers, the ones behind its Mix feature. The theme asks for them in batches and keeps them in local storage, so each song is asked about once. It also indexes your Liked Songs in the background, about a minute for 6,000 songs.
- **What it's tested on:** Spotify 1.3.9 with Spicetify 2.46.7 on macOS.
- **After a Spotify update:** Spotify updates wipe Spicetify's changes. On macOS, [self-repair](#self-repair-on-macos) puts the theme back for you. By hand: run `spicetify upgrade`, then `spicetify backup apply`. New Spotify versions often need the newer Spicetify. If the theme is showing and you only want to refresh it, `spicetify apply` is enough.

## Plain words in the console

The console's commands work on their own. To also type sentences, install [Ollama](https://ollama.com), which runs language models on your computer, and a model:

```bash
ollama pull qwen3:8b
```

Ollama refuses requests from pages it hasn't been told about, and Spotify's interface is one. On macOS, allow it from the theme's folder:

```bash
sh ollama-allow.sh apply
```

That lasts until you log out. `sh ollama-allow.sh install` repeats it at every login, and `sh ollama-allow.sh remove` undoes it. On other systems, set `OLLAMA_ORIGINS` to `https://xpui.app.spotify.com` and restart Ollama.

How it works: the model reads your sentence and the playing song, and answers with up to four of the console's own commands, which then run as if you had typed them. It can't do anything the commands can't. It is given the genres and moods in your library, so "play some deep house" or "something chill to work to" searches by tag. A vibe such as "stoner music" or "late night drive" is turned into the few tags that fit it, and the console says which. Answers take a second or two once the model is loaded. If another program is keeping Ollama busy, requests wait their turn, and the console drops one after a minute. Ctrl+C drops it sooner. To stop the waiting, `sh ollama-console.sh install` runs a second Ollama that only the console uses (macOS, about 6 GB of memory while its model is loaded). `model` shows which model answers, and `model <name>` switches.

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
