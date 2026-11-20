# Set file, version 1

A set file is one JSON object. An agent (or a person) writes it from an exported library. The console plays it with `dj load <pasted file>`, and `dj check <pasted file>` lists it without touching anything. `set.schema.json` is the machine-readable version. `dev/validate-set.mjs` runs the same checks the console runs.

## Example

```json
{
  "format": "spotify-mod-set",
  "version": 1,
  "setId": "2026-11-19-marlowe-1",
  "name": "Rooftop warm-up",
  "brief": "60 minutes, deep house into soulful house, never above 124",
  "gig": "rooftop, 7pm, first hour",
  "dj": "Marlowe",
  "created": "2026-11-19T16:20:00-08:00",
  "exportId": "library-mi3k2x1a",
  "featuresVersion": "features 2026-11-19",
  "songs": [
    { "uri": "spotify:track:00bB4IIOvYeZGk69M2wNNY", "name": "Song A", "artists": "Artist", "reason": "low, warm opener" },
    { "uri": "spotify:track:00rKVLJBnmP9WHlQoRRyTJ", "name": "Song B", "artists": "Artist", "bpm": 122, "seconds": 410,
      "alternates": [{ "uri": "spotify:track:03JFIC1mWhGPewQu08Sf46", "name": "Song B2" }] },
    { "uri": "spotify:track:03JFIC1mWhGPewQu08Sf46", "name": "Song C", "artists": "Artist" }
  ],
  "transitions": [
    {
      "from": "spotify:track:00bB4IIOvYeZGk69M2wNNY", "to": "spotify:track:00rKVLJBnmP9WHlQoRRyTJ",
      "arm": "custom",
      "intent": { "type": "blend", "bars": 16, "leaveA": { "kind": "phrase", "at": 103.3 }, "landB": { "kind": "drop", "at": 33.5 }, "tolerance": 0.5 },
      "note": "ride B's intro under A's last phrase, B drops as A goes"
    },
    { "arm": "auto" }
  ],
  "notes": "Holds 120 to 122 the whole way."
}
```

## Top level

| Field | Required | What it is |
| --- | --- | --- |
| `format` | yes | Always `"spotify-mod-set"`. |
| `version` | yes | Always `1`. |
| `setId` | yes | Unique per set. Logged with every transition, so the listening log can tell which set and which pair a skip came after. |
| `name` | yes | Shown in the console. `save` and `dj keep` use it. |
| `brief`, `gig`, `dj`, `notes` | no | Text: the request, where and when, the persona, free notes. |
| `audition` | no | Transition numbers (1 is song 1 into song 2) for `dj audition` to play, in this order. Default: all of them. For a blind comparison, put the same two songs in the set twice, one pair with `arm: "auto"` and one with your own, and list both here in a shuffled order. The console never says which is which. |
| `created` | no | ISO 8601 date and time. |
| `exportId` | no | Copied from the library export the set was planned from. |
| `featuresVersion` | no | Which feature summaries the planner used. |
| `scorer` | no | The scorer's output, in the scorer's own shape. The loader ignores it. |
| `songs` | yes | 2 to 300 songs, in play order. |
| `transitions` | no | `transitions[0]` joins song 1 to song 2. Missing entries, or `null`, mean Spotify's own. |

Other top-level fields are allowed and ignored.

## Songs

| Field | Required | What it is |
| --- | --- | --- |
| `uri` | yes | `spotify:track:` and the 22-character id. Any song on Spotify, not only the library's. |
| `name` | yes | The title. The console compares it with Spotify's and warns when they differ, which catches a made-up id. |
| `artists`, `reason` | no | Text. |
| `bpm`, `seconds` | no | From the export. The validator uses them for timing. The console uses Spotify's own numbers. |
| `alternates` | no | Other songs that could take this slot. Not played. |

Other song fields are allowed and ignored.

## Transitions

| Field | What it is |
| --- | --- |
| `arm` | `custom` (default): write this file's transition. `auto`: Spotify's own. `today`: what `dj` does today (Spotify's own, length changed by whole bars; `intent.bars` 16, 8 or 4 picks long, medium or quick). Mixing arms in one set is how custom is compared with the alternatives. |
| `intent` | What the planner wants, in seconds. Works without Spotify's numbers. |
| `resolved` | The exact transition, in milliseconds, as Spotify stores it. Only possible with Spotify's live suggestion in hand. |
| `from`, `to` | Copies of the two uris. Checked if present. Recommended. |
| `note` | Why. |

A `custom` transition needs `intent`, `resolved`, or both. With both, `resolved` is tried first and `intent` is the fallback. Unknown fields anywhere in a transition are an error, so a typo can't silently become Spotify's own.

### intent

| Field | What it is |
| --- | --- |
| `type` | `blend` or `drop-entry` (beatmatched, `bars` long), `fade` (no beatmatch needed, `bars` long), `cut` (a swap). The console plays `drop-entry` exactly like `blend`; the name tells people and the scorer what it is for. |
| `bars` | 1 to 64, bars of song A's tempo. Not used for `cut`. |
| `leaveA` | `{ "kind": "phrase", "at": 103.3 }`. Seconds into A **when the change is complete**: A is gone (blend, fade) or cut (cut). |
| `landB` | Seconds into B at that same moment: where B's drop or phrase should land. |
| `tolerance` | Bars the loader may move each point to sit on Spotify's beat grid. Default 0.5, which always finds the nearest grid point. 0 means use Spotify's grid only if the points already sit on it. |

`kind` is `phrase`, `intro`, `outro`, `drop`, `breakdown` or `time`. It is a label for people, the scorer and the log. The loader doesn't use it.

Both points are the end of the change because that is what phrase-aligned mixing cares about: A out on a phrase line, B landing on its drop. The start follows from the length.

```
song A  ....|======= bars =======|            leaveA.at = end of the blend in A
song B      |======= bars =======|.......     landB.at  = where B is at that moment
```

### resolved

| Field | What it is |
| --- | --- |
| `startAMs`, `startBMs` | Where the overlap starts, in each song, in ms. |
| `durationMs`, `durationBars` | Its length. |
| `presetId` | 1 to 22. See "Presets" below. Default: Spotify's own for the pair. |
| `source` | `candidate` (Spotify's own points), `shifted` (moved by whole bars from them), `auto`. |

## What the console does

1. Puts the songs in "AI DJ (working set)" with Mix on, as `dj` does.
2. For each pair, asks Spotify for its own transition and **copies it**. Only `startAMs`, `startBMs`, `durationMs`, `durationBars` and the preset are changed. Everything else (playable ids, speeds, Spotify's own bookkeeping) stays as Spotify set it. Measured: in 49 of 221 pairs the playable id differs from the playlist's.
3. From `intent`: works out the start from the end and the length, then moves each point to the nearest bar of Spotify's grid for that pair (whole bars of each song), within `tolerance`. Measured: Spotify's grid lands on the analysis bar lines only about 21% of the time (221 pairs), so seconds from the analysis are approximate and Spotify's grid wins.
4. Shortens a transition longer than Spotify's longest (read from Spotify, 35 s so far) by whole bars, keeping the end.
5. Keeps Spotify's own for a pair, and says why, when: a point falls before a song starts, the blend runs past A's end, B would be within 10 s of its end, A would start leaving less than 60 s after its own blend in finished, the pair isn't beatmatched and the type is `blend` or `drop-entry`, or a point is further off the grid than `tolerance`.
6. Reads every written transition back from Spotify. Each pair ends as **written**, **kept auto**, or **failed** (sent but not stored as sent).
7. Logs one row per pair: `{setId, pairIndex, arm, status, source, resolved, from, to, list, loadedAt}`.
8. Sets the queue aside, turns shuffle off, plays from the top. `undo` puts the music back.

## Presets

Measured from Spotify's style tables:

- 1 is Spotify's usual pick for pairs it doesn't beatmatch.
- 11 to 15 are hard cuts: both songs at full volume, then a swap at the middle of the overlap. The console uses 11 for `cut`.
- 7 is a smooth blend with the bass swapped halfway. The console uses it for a `blend` when Spotify's own pick was a cut. My choice, not heard.
- Otherwise the console keeps Spotify's own preset for the pair.

## Rules for an agent writing one

- Use uris from the export, or ids you are sure of. Never invent one: the console plays whatever that id is.
- Give each set a new `setId`.
- `intent` seconds are approximate by nature. Write them from the analysis; the console fits them to Spotify's grid.
- Write `resolved` only from Spotify's live numbers for that exact pair.
- Run `node dev/validate-set.mjs set.json --library library.json` first.

## UNSURE

- Whether Spotify honors the blend length. Points are measured as honored; length isn't verified.
- How the cut and blend presets sound. Read from curves, not heard.
- Whether `startBMs` is in B's own timeline when Spotify speeds B up. One measurement agrees.
- A relinked song (another version plays in this country): the points refer to the file's id.
