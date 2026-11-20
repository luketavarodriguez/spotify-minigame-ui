# Developer notes

What was learned building this, written for whoever works on it next. [AGENTS.md](../AGENTS.md) is the short version. This is the reference. Measurements are from one Mac (Apple silicon, Spotify 1.3.9, Spicetify 2.46.7, a library of about 6,500 liked songs and 230 owned playlists). Anything not tested is marked as such.

Contents: [Tools](#tools) · [Test recipes](#test-recipes) · [Spotify internals](#spotify-internals) · [Layout and CSS](#layout-and-css) · [Games](#games) · [Song index](#song-index) · [Up next and mixing grades](#up-next-and-mixing-grades) · [Console](#console) · [Model layer](#model-layer) · [Sets and the DJ](#sets-and-the-dj) · [Player quirks](#player-quirks) · [Install and updates](#install-and-updates) · [Decisions already made](#decisions-already-made) · [Not verified](#not-verified) · [Agent DJs](#agent-djs)

## Tools

Everything in `dev/` needs Node 22 or newer and no packages.

| File | What it does |
| --- | --- |
| `cdp.mjs` | Talks to a running Spotify over its inspection port: `status`, `reload`, `run`, `snap`, `eval`, `file`, `shot`, `clip`, `perf`. Run it with no arguments for the list. |
| `page-helpers.js` | Loaded into the page by `cdp.mjs` as `__tty`: `run(line)`, `snap()`, `wait(ms)`, `look(value)`, `open()`, `close()`. |
| `model-eval.mjs` | Sends the requests in `model-cases.json` to Ollama with the console's real instructions and checks the commands. Spotify is not involved. |
| `validate-set.mjs` | Checks a set file for `dj load` with the theme's own `checkSet` (read out of `theme.js`). `--library <export>` adds length and tempo checks, `--strict` fails on warnings. Format in `SET-FORMAT.md`, examples in `examples/`. |
| `model-cases.json` | The requests, a sample tag list, and the commands each request should produce. |

Inspection mode is a launch flag, so it takes a restart of Spotify:

```bash
osascript -e 'quit app "Spotify"' && open -a Spotify --args --remote-debugging-port=9222
```

`SPOTIFY_DEBUG_PORT` changes the port. `CDP_TIMEOUT` (seconds, default 240) changes how long `cdp.mjs` waits.

## Test recipes

**A change that only lists things** (find, mix, like, search, genres, `dj plan`). Safe while music plays:

```bash
spicetify apply -n && node dev/cdp.mjs reload
node dev/cdp.mjs run "find deep house 120-126bpm"
```

`run` works with the console pane closed. It adds the line to the console's saved history.

**A change that plays, queues or reorders.** Take the state before, run it, undo it, compare. The console's `undo` is the tested way back:

```bash
node dev/cdp.mjs snap
node dev/cdp.mjs run "dj 20 minutes of house"
node dev/cdp.mjs snap
node dev/cdp.mjs run "undo"
node dev/cdp.mjs snap
```

The first and last `snap` should match: song, position within a few seconds, pause state, queue count. If they don't, fix it by hand and say so. Don't run these while the owner is in a game in play mode, and don't switch game or mode for them.

**A visual change.** The window must be on screen. A hidden window never paints, and `shot` refuses instead of hanging.

```bash
node dev/cdp.mjs shot /tmp/spotify.png
node dev/cdp.mjs clip ".tty-console" /tmp/console.png 12
```

To photograph the other look, use the theme's own switches and switch back: `node dev/cdp.mjs eval '__tty.look("terminal")'`, then `"spotify"`. Values are `terminal`, `spotify`, `games`, `compact`. Don't toggle the `tty-spotify` class directly. The saved choice is in localStorage `tty-look` and `tty-view`.

**Performance.** With the window on screen:

```bash
node dev/cdp.mjs perf 10
```

A healthy idle page is around 16 ms of style work per second. To find a costly rule, swap `user.css` for a copy with rules removed (through a `CSSStyleSheet` in the page) and measure again.

**The model.** After any change to `MODEL_GUIDE`:

```bash
node dev/model-eval.mjs
```

qwen3:8b passes 24 of 24 at about a second each. Add a case for every sentence that goes wrong in real use.

**Self-repair, without restarting Spotify.** `spicetify restore -n` makes the app stock on disk while the running Spotify carries on. `sh self-repair.sh run` should put the patch back.

## Spotify internals

None of this is documented by Spotify. It was found by reading the app. Any of it can change in an update.

### Functions on `Spicetify.Platform`

- **`PlayerAPI`**: `_state` (read directly: `item`, `nextItems`, `context`, `positionAsOfTimestamp`, `timestamp`, `isPaused`, `shuffle`). Each queue item has `uri`, `uid` and `provider` (`context`, `queue` or `autoplay`). Commands: `play(context, origin, options)`, `skipTo({uid, uri})`, `seekTo(ms)`, `pause()`, `resume()`, `setShuffle(bool)`, `addToQueue([{uri}])`, `removeFromQueue`, `clearQueue()`, `reorderQueue(items, {before: anchor})`.
- **`reorderQueue`** does a whole permutation in one call: pass the items in the wanted order and an anchor (the first song after the group, or the group's own last song). Spotify matches by `uid`, else `uri`. If the anchor is a queued song, the moved ones become queued too.
- **Playing a playlist from a given song**: `play({uri: listUri}, {featureIdentifier: "playlist", referrerIdentifier: "other"}, {skipTo: {uri, uid}, seekTo: ms})`.
- **`LibraryAPI.getTracks({limit, offset})`**: Liked Songs, with `addedAt` but no release date.
- **`PlaylistAPI.getContents("spotify:user:@:collection", {limit, offset})`**: Liked Songs read as a playlist. Each item has `release.isoString`, which is where release years come from (`releaseYears` in `theme.js`). It returned about 250 more items than `LibraryAPI` on one library; the theme keeps `LibraryAPI` as the song list and only takes years from this. Playlist items also carry `bpm`, `key` and `threeBandWaveform` fields, null on the items checked. Not explored.
- **`RootlistAPI`**: `getContents()`, `createPlaylist(name, {before: "start"})`, `remove([{uri}])`.
- **`PlaylistAPI`**: `getContents(uri, {limit, offset})`, `getMetadata(uri)`, `add(uri, uris, {after: "end"})`, `remove(uri, [{uri, uid}])`, `updateDetails(uri, {name})`.
- **`PlaylistMixingAPI`**: see [Sets and the DJ](#sets-and-the-dj).
- **`AuthorizationAPI.getState().token.accessToken`**: the bearer token for the endpoints below.
- `Spicetify.CosmosAsync` is broken on 1.3.x ("Resolver not found"). Use `fetch` with the token.
- The public Web API answers 429 for this client. Don't build on it.

### Endpoints

All on `https://spclient.wg.spotify.com`, with `Authorization: Bearer <token>`.

- **Tempo, key and tags**: `POST /extended-metadata/v0/extended-metadata`, a hand-built protobuf body (see `fetchSongRecords`). 300 songs per request works. The response holds one list per kind, with the kind in field 2 of each list.
  - Kind 222 (audio attributes): tempo is a double in field 1. Key is field 2 > field 3 (Camelot) > field 1 (the code, such as `8A`). No confidence value. It sometimes disagrees with the audio analysis (175 against 140 on one song).
  - Kind 6 (track descriptors): repeated field 1 = `{name 1, weight 2 (float32), sorts 3 (packed: 1 genre, 2 mood), concept uri 4, display 5}`.
  - Kind 217 is beats. Not explored. Kinds 94 and 280 answer 404. Kind 8 (artist) has no genre field.
- **Audio analysis**: `GET /audio-attributes/v1/audio-analysis/{id}?format=json`, with `Spotify-App-Version` and `App-Platform` headers. Beats, bars, sections (with loudness), segments (pitches, timbre). The games run on this. Some songs answer 404.
- **Lyrics**: `color-lyrics` (see the Lyrics section of `theme.js`).
- **Song radio**: `GET /inspiredby-mix/v2/seed_to_playlist/{trackUri}?response-format=json` returns `mediaItems[0].uri`, a playlist of about 50 similar songs.
- **Catalog search**: there is no stable endpoint, so the theme uses the app's own. Each session it reads the `searchTracks` query hash out of `/xpui-routes-search.js` with a regex, then calls `Spicetify.GraphQL.Request`. Results are at `data.searchV2.tracksV2.items[].item.data`. If Spotify renames that file or the query, `catalogSearch` returns nothing and `search`, `like <song>` and `radio <song>` for songs outside the library stop working. That is the most fragile piece in the project.

### Storage

All in the page's localStorage, prefixed `tty-`: `tty-song-index-v1` (id to `[bpm, key]`), `tty-song-tags-v1` (`{names: [[name, kind]], songs: {id: [tagNumber, weight 0-100, ...]}}`, top 10 tags at weight 0.45 or more), `tty-stats` (listening tally, today and this month only), `tty-console-dock`, `tty-console-history`, `tty-console-model`, `tty-look`, `tty-view`, `tty-game`, `tty-level`, `tty-side-width`. The index and tags for 6,500 songs take about 720 KB.

## Layout and CSS

- Spotify 1.3.8 removed the readable class names Spicetify's map relied on. Every selector here is built on Spotify's `data-testid`s (`now-playing-bar`, `player-controls`, `playback-progressbar`, `now-playing-widget-v2`...), IDs (`#main-view`, `#global-nav-bar`, `#Desktop_LeftSidebar_Id`, `#Desktop_PanelContainer_Id`), roles and structure. That rebuild survived the 1.3.9 update with no changes.
- `labelLayout()` runs every 250 ms and tags Spotify's containers: `tty-app`, `tty-player`, `tty-row`, `tty-left`, `tty-center`, `tty-right`, `tty-extra`, `tty-playback`, `tty-home` and others. CSS styles the tags. This replaced `:has()` container selectors, which cost about 230 ms of style work per second because Spotify recalculates style about 100 times a second even when idle. With labels it is about 16.
- Never animate `content` on a pseudo-element. A text spinner did that once and forced a 60 ms full-app layout 12 times a second.
- Two looks. Terminal-skin CSS sits under `html:not(.tty-spotify)`. `html.tty-spotify` styles the theme's own pieces to match stock Spotify. `buildSprites()` re-tints the games on a look switch.
- The console pane is appended to `.tty-app` (Spotify's root grid) in the `main-view` cell. `html.tty-console-bottom` and `html.tty-console-right` shrink `#main-view` to make room. Minimum sizes: main view 320 by 180, console 300 by 120.
- A 75 Hz monitor gives 75 frames a second. That is not a regression.

## Games

- The dino sprites and constants are from Chromium's dino game (BSD license, credited in `theme.js`). The flappy and shooter art is original.
- Obstacles are pinned to the song clock every frame. Adding up frame times drifted 100 to 385 ms late.
- The frame loop runs physics in fixed steps of at most 16.7 ms. One long step used to let the autopilot miss.
- Auto mode is an autopilot, and it should never crash. Stress tests at 95 to 175 BPM on hard showed none after the fixes above.
- Arrows only. Space stays Spotify's play and pause. Play mode leaves arrows alone in text fields, menus, lists and dialogs.
- Live audio is not reachable from the page. Everything musical comes from the analysis, fetched per song.

## Song index

`wantSongs(uris)` queues songs for lookup and `pumpIndex` fetches them 300 at a time. `songFacts(uri)` returns `[bpm, key]` or nothing. `tagsOf(uri)` returns its tags. `learnSongs` does the same for songs outside the library (search and radio results), so every song the console shows has facts if Spotify has them.

The first console use reads Liked Songs and every owned playlist, four playlists at a time. That took about 18 seconds for 230 playlists, and results grow while it runs.

Tags are Spotify's and they are imperfect. Some rap songs carry "new age".

## Up next and mixing grades

`transition(from, to)` returns `{keyFits, cost, grade}`. Clean means tempo within 6% (half and double time folded in) and a key that is the same, adjacent on the Camelot wheel, or the relative major or minor. Rough means neither. `smooth` reorders the next 30 songs (`SMOOTH_WINDOW`) by lowest total cost, keeping queued songs and playlist songs in their own groups.

These grades know tempo and key only. Two songs can grade clean and still clash by genre, energy or vocals.

## Console

- `commands` in `theme.js` is the whole list. A command returns the `ASK` symbol when its arguments read like a sentence, and the line then goes to the model.
- The pool is Liked Songs plus owned playlists. A trailing `in <playlist>`, `in liked` or `in library` changes it (`readScope`, `songsFor`).
- `readTags` takes the longest phrase that is an exact tag name and also matches its relatives ("techno" matches "minimal techno"). `a or b` is a union. `OCCASIONS` maps words such as party and workout to real tags, because "party" used to match song titles. An exact artist name is never read as a tag.
- `find <year>` means the year a song was liked. `find 90s`, `find 1995-1999` and `find released 2018` mean when it came out. `top` is this month's plays as counted by the theme. The console says so when asked for things it can't know.
- `like` ranks by shared tags (genres count double). `mix` is tempo and key only. `radio` is Spotify's song radio minus songs already in the pool.
- `undo` covers play, add, smooth and dj through `undoPlan = {done, run}`.
- `shift` (also a button on up next) picks one of the library's 40 commonest genres that shares no word with the playing song's or the next five songs' top genres, then queues six songs of it: the best mix out of the playing song first, the rest within 12% of its tempo, ordered by `smoothest`. Copies of one song (a single and the album) count once. They are moved ahead of anything already queued. Running it again removes them; it has its own undo, not `undoPlan`.
- The listening log (`log`) keeps one row per song in IndexedDB (`tty-log`, store `plays`): heard ms, where it stopped, finished or skipped, seeks, the song before, context, provider and hour. Finished means it reached its last 40 seconds or 85%, since Mix blends leave songs up to 35 seconds early.

## Model layer

- The model never touches Spotify. It gets the instructions (`MODEL_GUIDE`), up to 8 earlier messages, the top 160 tag names, the playing song and the first six rows of the last list. It answers `{say, commands}`, and the commands run exactly as typed ones would.
- It was tuned on qwen3:8b through Ollama: temperature 0, `think: false`, a JSON schema, `num_ctx` 8192. About one second per request once loaded. Thinking mode was tried and dropped: 30 seconds or more per request.
- Small models follow examples better than rules. Most of `MODEL_GUIDE` is worked examples, one for each kind of sentence that once went wrong.
- Code catches the slips that examples don't: one retry when the model names an action and gives no command, one retry when it gives up on a vibe, and no play command from a request that began with find, show, list or what. `awaitingName` handles the answer to "what should I call the playlist?" without the model.
- Avoid test names containing words like "delete". The model reads them as a request.
- Ollama answers one request at a time. If another program keeps it busy, console requests wait in line (70 to 120 seconds was seen). A different model on the same Ollama does not skip the line. A second Ollama on port 11435 does, which is what `ollama-console.sh` sets up. The console tries 11435, then 11434.
- Ollama refuses web pages it wasn't told about. `OLLAMA_ORIGINS` must include `https://xpui.app.spotify.com` (`ollama-allow.sh`).

## Sets and the DJ

`set` builds a list by greedy choice: lowest transition cost plus distance from a tempo curve (`SHAPES`), with penalties for a repeated artist and a third song in one key.

`dj <brief>` goes further, in four steps:

1. **Plan** (`planSet`). One model call turns the brief into `{name, minutes, phases}`. Each phase has a share of the set, up to three tags, a start and end tempo, and a blend length (long 16 bars, medium 8, quick 4). Without a model, a plain plan is built from genre words in the brief.
2. **Pick** (`pickSet`). Code fills each phase from songs carrying its tags, scoring transition cost, distance from the phase's tempo at that moment (real tempo, no half or double), tag strength, repeated artists and repeated keys.
3. **Mix** (`mixPlaylist`). The songs go into one reused playlist, "AI DJ (working set)", with Mix turned on. For each pair the theme asks Spotify for its own transition and may rewrite it (`planBlend`).
4. **Play**. The user's queue is set aside, shuffle goes off, the playlist starts from its first second, and `undo` puts everything back.

Planning takes about 9 seconds on qwen3:8b. A whole run takes 11 to 19.

**Set files** (`export`, `dj load`, `dj check`). An outside agent plans the set. `export` writes the library as one file, one song per line (save dialog from a click, clipboard if that fails). The set file (`SET-FORMAT.md`) gives each pair an arm (`custom`, `auto` for Spotify's own, `today` for `planBlend`), an `intent` (type, bars, where A should be gone, where B should be by then, tolerance) and optionally a `resolved` transition in exact ms. `dj load` copies Spotify's own transition for each pair and changes only the points, length and preset: intent points move to the nearest bar of Spotify's grid, too-long blends are shortened keeping their end, and anything that doesn't fit (outside the song, under 60 s after the previous blend, a blend on a pair Spotify won't beatmatch) falls back to Spotify's own with the reason printed. Every write is read back. One row per pair goes to the `sets` store of the `tty-log` IndexedDB (version 2), so skips in `plays` can be joined to the transition before them. `dj` and `dj load` share `playWorkingSet`.

### How transitions work

`PlaylistMixingAPI`, on playlists the user owns:

- `setMixState(listUri, true)` turns Mix on.
- `getAutoTransitionForTrackPair(a, b, {trackAUid, trackBUid})` returns Spotify's suggestion: `{overlap: {startAMs, startBMs, durationMs, durationBars, speedA, speedB, isBeatmatched, bpmA, bpmB, ...}, preset: {id, type, ...curve overrides}}`.
- `setTransitionForTrack(listUri, uidOfTrackA, transition, {previousTransition: {type: "auto", transition}})` stores a custom one.
- `getCustomTransitionForTrackPair(listUri, a, b, opts)` reads it back. `playTransition(a, b, listUri, opts)` auditions it from 3 seconds before the mix-out point. `getMaxTransitionLength()` is 35,000 ms.

**Measured.** On one pair, Spotify suggested leaving song A at 146.3 s and entering song B at 2.1 s over 8 bars. A custom transition was written: leave at 116.3 s, enter at 32.1 s, 16 bars. The player switched to B with A at about 116.5 s and B at 32.2 s. So the mix-out and mix-in points are honored. By ear it sounded beatmatched.

**The rule in `planBlend`.** Spotify can hear the songs and this code can't, so its suggestion is the starting point. The theme only changes the length, by whole bars, moving the mix-out point earlier or later and leaving the mix-in point alone. It halves or doubles at most. A suggestion of 2 bars or less is left as is, since Spotify had a reason to cut fast. Rough pairs get 4 bars.

**How Spotify picks its own (measured, 221 pairs from four house playlists, 2026-11-19).** Every candidate point sits on a per-song bar grid in whole bars. Its bar length matches the audio analysis within 1%, but its downbeat lands on an analysis bar line only about 21% of the time (on an analysis beat 60 to 67%), so snap to Spotify's grid, not the analysis bars. It does no phrase or drop alignment: the blend ends near B's first drop in 6% of pairs. Lengths are only 2, 4, 8 or 16 bars, or 0 when not beatmatched (52 of 221; those are 2.5 or 5 s fades at the very end of A). `speedA` is always 1 and `speedB` stretches B to A's tempo, never past 10%. `setTransitionForTrack` validates nothing, and a custom transition is replaced by Spotify's own on read-back if a song is swapped for another version. 23 presets, ids 0 to 22; types 1 fade, 2 cut, 3 and 4 the beatmatched versions; 11 to 15 cut at the middle of the overlap.

**Not verified.** Whether the blend length and the volume, EQ or filter curves in `preset` are honored. That needs listening, or a way to observe the audio.

## Player quirks

- `play` and `skipTo` sometimes do the job and never resolve. `within(command, ms)` gives up waiting after 4 seconds.
- An `addToQueue` or `clearQueue` sent right after a jump or seek is silently dropped. Wait 700 ms, check with `settle()`, resend up to three times.
- Queued songs play before a playlist's next track, and Spotify blends into them. A set must set the queue aside first.
- A playlist with Mix on opens its first song at the point Spotify would have blended in, 20 to 40 seconds late. Seek to 0 about 1.4 seconds after it starts, and check twice.
- During a blend the player reports the incoming song as the current one from the start of the overlap.
- `whereItWas()` records context, song, position, pause, shuffle and queue. `goBack(was)` restores them. A song that came from the queue or autoplay has no place in a playlist, so it is queued again and jumped to.
- When the window is hidden, page timers run about once a minute (ten 100 ms timers took 91 seconds). Every wait in the theme goes through `nap()`, a timer in a worker, and the main loop runs on it too. Before this fix, listening stats counted about 2 seconds per minute in the background.

## Install and updates

- A Spotify update replaces the app's files and removes the patch. `spicetify upgrade`, then `spicetify backup apply`. A plain `apply` reports a mismatched backup in that case. On an already patched app, `backup apply` refuses, and plain `apply` is the right command.
- macOS App Management decides which programs may change another app. A program without it can delete files inside Spotify.app and cannot create them, so a blocked `spicetify apply` leaves Spotify without its interface. Recovery: run `spicetify apply` from an approved program. Spicetify's backup is in `~/.local/state/spicetify/Backup`.
- `self-repair.sh` is a login job that notices a missing patch and re-applies it. It tests for write access first, and when it has none it opens a Terminal window to do the work, since Terminal can be approved. Terminal must be quit and reopened after being approved. Measured: patch restored in 21 seconds.
- Only macOS has been tested. The theme itself should run wherever Spicetify does. The three shell scripts are macOS only.

## Decisions already made

These were tried or considered and turned down by the owner. Don't bring them back without asking.

- Beat flashing (sky, ground, border glow) and a loudness-driven skyline: looked wrong.
- A typing game: boring. Karaoke: not wanted. A terminal-styled search page: dropped.
- A text banner on Home: replaced by the stats pane.
- Spotify's own lyrics button in the games view: hidden, since its view lagged and sometimes blanked the game.
- General direction: simplify or remove a feature before adding failure handling to it. Work with Spotify's own interface where possible.
- People will want plain speech, not memorized commands. Commands exist so the model has something exact to call, and so the console works with no model.

## Not verified

- A real request to a hosted model provider. The hosted path was tested against a local stand-in that speaks the same format.
- Windows and Linux.
- How a full DJ set sounds from start to end. Blend length and curves, as above.
- Dragging the console pane with a real mouse. It was tested with scripted pointer events.
- MIDI input. Web MIDI exists in Spotify's engine and reports permission state "prompt". No controller was connected.
- Editing a mixed playlist while it plays, and whether its transitions survive.
- `userscript/`, a browser build. Never run.

Ideas raised and not built: share cards, full play history, yes and no buttons on the console's offers, loudness in set building, tag corrections, typo tolerance, a phrase matcher for people with no model.

## Agent DJs

Design notes, not built. The `dj` command today is one model call and then code. This section is about replacing that with agents that have taste, work in a loop, and differ from each other. Opinions are marked. Which model runs the agents and how it signs in is left out on purpose. That is the owner's call and is being worked out separately.

### What a DJ decides

| Decision | Who makes it today | What an agent would add |
| --- | --- | --- |
| The crate: which songs are even considered | The scope (`in <playlist>`) | A persona's own crate: genres it favors, genres it refuses |
| The arc: energy and tempo over the set | One model call (`planSet`) | Revision after seeing what songs exist |
| Each next song | Code scoring (`pickSet`) | Judgment: this vocal after that one, this is the peak record |
| Each transition | Spotify's suggestion, length adjusted | Per-pair choices: cut here, ride this one long |
| Reacting | Nothing | Skips, requests, time of night |

### What an agent can know, and what it can't

It cannot hear. It works from data:

- Tempo, key, genre and mood tags with weights, length, the year a song was liked, this month's play counts. All in the index today.
- The audio analysis: sections with loudness, bars, beats. From that, an energy curve per song, intro and outro lengths, and roughly where the drop is. Available per song but not in the index yet. This is the largest gap.
- Spotify's own transition for any pair, which carries what Spotify's engine heard: whether the pair beatmatches, and where it would mix out and in.
- Titles and artists, plus whatever the model already knows about those records. Speculative: that knowledge is good for well-known tracks and unreliable for obscure ones, and a model will not tell you which is which.
- After the fact: what got skipped, replayed or sought through.

### What an agent can control

Song choice and order. Per pair: where song A is left, where song B enters, and the length in bars (points confirmed, length not verified). The `preset` object has curve fields that nobody has explored.

Not available: live EQ, loops, effects, scratching, or two decks under free control. Spotify's engine does the blending. An agent here is closer to a DJ preparing a set in advance than one working the mixer.

### A persona is a soul file plus numbers

A prose description alone ("warm, patient, loves long blends") changes what the model says about a set more than what the set is. Pair it with numbers that code enforces. A sketch:

```markdown
---
name: Marlowe
crate: { deep house: 1.0, soul: 0.6, disco: 0.5, techno: -1 }   # weights; negative means never
tempo: [112, 124]
max_step_bpm: 2          # per song
keys: strict             # strict, loose or ignore
blend_bars: { warmup: 16, peak: 8 }
artist_gap: 6            # songs before an artist may repeat
risk: 0.1                # share of picks allowed to break a rule on purpose
---
Plays the first hour of the night. Never rushes. Would rather hold one groove
for twenty minutes than show range. Picks vocals sparingly, and never two in a row.
Ends a set lower than its peak so the next DJ has somewhere to go.
```

The numbers go into the scoring in `pickSet` and the lengths in `planBlend`. The prose goes to the model for the judgment calls.

My opinion: several personas given the same songs and the same data will converge. What makes them different is the crate and the constraints, more than the writing. Test it: run two personas on one brief and count shared songs. If more than half overlap, the personas aren't doing anything yet.

### Options for where the agent runs

**A. A persona inside the console.** `dj as marlowe 90 minutes`. The persona's prose is added to the planning call and its numbers override the scoring. Every user of the mod gets it, with whatever model they connected. It is the cheapest to build and the weakest: one small call, no loop. Good for finding out whether personas produce different sets at all.

**B. An outside agent driving the mod live.** An agent on the same computer works in a loop: ask for candidates, pick, check the transition, revise, write the set, play it. This gives the best sets, since the agent can take many steps and remember across sessions. It needs a way in. Today that is the inspection port, which works for the owner and is wrong for users (a launch flag, and full control of the page). A real version needs a small bridge: the theme connects out to a local program, and that program offers a few tools:

- `library(filters)`: songs with tempo, key, tags, energy
- `candidates(after, filters)`: what could follow a song, graded
- `transition(a, b)`: the grade and Spotify's suggestion
- `write_set(songs, transitions)`, `play()`, `state()`, `undo()`

**C. Set prep with no connection at all.** The mod exports the library as a file (songs with their facts). An agent anywhere reads it, takes as long as it likes, and writes a set file: songs in order, a transition per pair, notes. The mod imports it (`dj load`) and plays it. No bridge, nothing live, and set files can be shared between people when the songs are catalog songs. It can't react during playback. Needs two commands that don't exist: an export and an import.

**D. A team.** A builder persona and a critic that scores the draft against the brief (clean transitions, arc, repetition) and sends it back. Or three personas build and a judge or the listener picks. Or a back-to-back: two personas alternate three songs each, and each has to mix out of the other's last record. Back-to-back is the format most likely to produce sets that differ from what one agent makes, and it demos well. Cost grows with every agent added, so measure whether the critic changes the set before keeping it.

**E. A resident.** The agent stays on while the set plays. It watches skips and requests typed in the console ("more vocals", "bring it down"), and re-plans the songs not yet played. This is the option closest to a real DJ. It depends on B's bridge when the agent is outside the mod, and on something not yet tested: editing a mixed playlist while it plays. Reading the room through a camera, an idea from early in this project, would plug in here as one more signal.

### Suggested order (opinion)

1. Persona file format and `dj as` in the console (A). One day of work, and it answers whether personas matter.
2. Energy, intro and outro from the audio analysis into the index. Every option gets better.
3. Export and `dj load` (C). Any outside agent can now build sets with nothing else installed.
4. A log of skips per set. The first feedback signal.
5. The bridge (B), then the resident (E).
6. Back-to-back (D).

### How to tell whether a DJ is good

Countable: share of clean transitions, the biggest tempo step, how well songs match their phase's tags, artist repeats, the arc against the brief, and overlap between personas on one brief. Only by ear: whether it works. The fair test is blind: two sets from one brief, one from the current `dj` and one from the agent, and the listener picks without knowing which is which.
