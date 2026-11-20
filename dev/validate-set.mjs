#!/usr/bin/env node
// Checks a set file the way dj load will, before it reaches Spotify.
//
//   node dev/validate-set.mjs set.json
//   node dev/validate-set.mjs set.json --library library.json   also checks lengths and tempos
//   node dev/validate-set.mjs set.json --strict                 warnings count as failures
//
// The checks are theme.js's own `checkSet`, read out of theme.js (or, outside the
// repo, out of load.js beside this file), so the two can't drift apart.
// Exit code: 0 fine, 1 problems (dj load would refuse it), 2 warnings with --strict.
// Needs Node 18 or newer. No packages.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const libraryAt = args.indexOf("--library");
const libraryPath = libraryAt >= 0 ? args[libraryAt + 1] : null;
const setPath = args.find((arg, i) => !arg.startsWith("--") && (libraryAt < 0 || i !== libraryAt + 1));
if (!setPath) {
  console.error("usage: node validate-set.mjs set.json [--library library.json] [--strict]");
  process.exit(1);
}

// checkSet, from theme.js in the repo or load.js beside this file.
const source = [join(here, "..", "theme.js"), join(here, "load.js")].find((path) => existsSync(path) && readFileSync(path, "utf8").includes("// checkSet: begin"));
if (!source) {
  console.error("couldn't find checkSet in ../theme.js or ./load.js");
  process.exit(1);
}
const text = readFileSync(source, "utf8");
const block = text.slice(text.indexOf("// checkSet: begin"), text.indexOf("// checkSet: end"));
const checkSet = new Function(`${block}\nreturn checkSet;`)();

// Song lengths and tempos from an export, when given.
const known = new Map();
if (libraryPath) {
  const library = JSON.parse(readFileSync(libraryPath, "utf8"));
  if (library.format !== "spotify-mod-library") console.error(`${libraryPath} isn't a library export; ignoring it`);
  else for (const song of library.songs ?? []) known.set(song.uri, { seconds: song.seconds ?? song.features?.duration, bpm: song.bpm ?? song.features?.bpm });
}

let raw;
try {
  raw = readFileSync(setPath, "utf8");
} catch (error) {
  console.error(`can't read ${setPath}: ${error.message}`);
  process.exit(1);
}
const { set, problems, warnings } = checkSet(raw, (uri) => known.get(uri) ?? null);

if (set && libraryPath) {
  const outside = set.songs.filter((song) => !known.has(song.uri));
  if (outside.length) warnings.push(`${outside.length} songs aren't in the library export. That's allowed (catalog songs play fine), but their timing isn't checked unless the set gives seconds and bpm: ${outside.slice(0, 5).map((song) => song.name).join(", ")}${outside.length > 5 ? "..." : ""}`);
}

for (const problem of problems) console.log(`problem: ${problem}`);
for (const warning of warnings) console.log(`warning: ${warning}`);
if (set) {
  const steps = (set.transitions ?? []).filter((step) => step && (step.arm ?? "custom") === "custom").length;
  console.log(`ok: "${set.name}" (${set.setId}), ${set.songs.length} songs, ${steps} transitions of its own${warnings.length ? `, ${warnings.length} warnings` : ""}`);
}
process.exit(problems.length ? 1 : strict && warnings.length ? 2 : 0);
