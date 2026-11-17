# Working on Spotify Minigame UI

Notes for an agent picking up this project. The README is for people installing it. This file is for whoever changes it next. Deeper reference lives in [dev/NOTES.md](dev/NOTES.md): read the section you need before touching that part.

## What this is

A Spicetify theme for the Spotify desktop app, in two files with no build step:

- `theme.js` (about 4,800 lines): one script injected into Spotify's page. Games on the player bar, the up-next pane, the song index, the console, sets, the DJ, stats.
- `user.css` (about 1,900 lines): the layout and both looks (terminal and Spotify).

Everything else is support: `color.ini` (color schemes), `manifest.json`, `self-repair.sh`, `ollama-allow.sh`, `ollama-console.sh` (macOS helpers), `images/` and `preview.png` (README screenshots), `dev/` (tools for working on it).

`userscript/` is an old untested browser build. It is untracked on purpose. Leave it out of commits.

## Map of theme.js

Sections are marked with `// ---- Name ----` comments. In file order:

1. Layout labels: tags Spotify's own boxes with `tty-*` classes every 250 ms.
2. Shell prompt, then the three games (dino, flappy, shooter) and the beat map that drives them.
3. Lyrics on the top border.
4. Song index: tempo, key and genre tags for every song, fetched in batches and cached.
5. Up next: the queue pane, the `smooth` reorder, transition grading.
6. Console: commands, the song pool (Liked Songs plus owned playlists), sets, the DJ.
7. Plain words: the model layer (local Ollama or a hosted provider) and the first-open setup box.
8. Game mode switches, Spotify's controls on the border, listening stats, the main loop.

## The loop for any change

1. Edit `theme.js` or `user.css`.
2. `node --check theme.js`.
3. Copy the files into Spotify without restarting it:

   ```bash
   spicetify apply -n
   ```

4. Reload Spotify's page and look at the result:

   ```bash
   node dev/cdp.mjs reload
   node dev/cdp.mjs run "find deep house"
   node dev/cdp.mjs snap
   node dev/cdp.mjs shot /tmp/spotify.png
   ```

   `run` types a line into the console and prints the answer. `snap` prints the song, position and queue. `shot` needs Spotify's window on screen. Run `node dev/cdp.mjs` alone for the full list.

5. Commit and push to `main` once it is tested.

Step 4 needs Spotify running in inspection mode. That takes a restart of Spotify, which stops the music, so ask the owner first:

```bash
osascript -e 'quit app "Spotify"' && open -a Spotify --args --remote-debugging-port=9222
```

Without inspection mode you can still apply changes, but you cannot verify them. Say so instead of claiming it works.

## Rules of this repo

- **Commits:** plain messages that say what changed for the user. No co-author lines and no mention of AI tools, in commits, code or docs.
- **Push tested work to `main`.** Hold anything untested.
- **Put the music back.** Tests that play, queue or reorder must restore the song, position, pause state and queue afterward. The console's `undo` does this (through `whereItWas()` and `goBack()` in `theme.js`), and `node dev/cdp.mjs snap` before and after proves it. If a test changed what is playing and you could not restore it, tell the owner.
- **Remove what tests create.** Test playlists and queued songs get deleted when the test ends.
- **Screenshots are public.** Never show friends' names (the listening-activity panel, blend playlists such as "Name + Name"). Blur or pixelate them, or pick another page.
- **README voice:** first person, the owner's own voice, with a "What it can't do" section that stays honest. Keep that when adding features.
- **Selectors:** never use Spicetify's class-name map. Use Spotify's own `data-testid`s, element IDs and roles, or the `tty-*` labels.

## Things that will bite you

Each of these cost real time once. Details are in `dev/NOTES.md`.

- **Hidden window, slow timers.** When Spotify's window is in the background, Chrome runs page timers about once a minute. Use `nap(ms)` (a worker timer) for every wait in `theme.js`, never `setTimeout` in a polling loop. Test helpers use a worker timer for the same reason.
- **`:has()` is expensive.** Broad `:has()` container selectors cost about 230 ms of style work per second on Spotify 1.3.8 and later. Label boxes in JS and style the labels.
- **Player commands may never answer.** `PlayerAPI.play` and `skipTo` sometimes carry out the command and never resolve. Wrap them in `within()`.
- **Queue changes get dropped** when sent right after a jump or seek. Wait about 700 ms, check that the change took, and resend.
- **The user's queue plays first.** Queued songs cut in ahead of a playlist's next track, and Spotify blends into them. Set the queue aside before playing a set, and restore it after.
- **Mixed playlists open partway into the first song.** Seek to 0 about 1.4 seconds after starting one.
- **Spicetify can break Spotify.** Run from a program macOS has not approved under App Management, `spicetify apply` deletes Spotify's interface files and cannot write them back. `self-repair.sh` checks write access first. Fix a broken install with `spicetify apply` from an approved program.
- **Spotify updates wipe the patch.** After an update: `spicetify upgrade`, then `spicetify backup apply`.
- **The data sources are Spotify's internal endpoints.** They are undocumented and can disappear. Fail quietly and keep the rest working.
- **Small models slip.** The console's instructions rely on worked examples, and code guards the common slips. When a sentence picks the wrong commands, add an example and re-run `dev/model-eval.mjs`.

## Where to read more

- `dev/NOTES.md`: Spotify's internal functions and data formats, how the console and the DJ are built, measured numbers, test recipes, and the design options for agent DJs.
- `README.md`: what users see and how they install it.
