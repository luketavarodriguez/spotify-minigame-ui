#!/usr/bin/env node
// Checks that the console's instructions still lead a model to the right commands.
//
// It reads MODEL_GUIDE and MODEL_REPLY straight out of theme.js, sends each
// request in model-cases.json to Ollama the way the console does, and
// compares the commands that come back. Spotify isn't involved, so nothing
// plays and nothing is queued. Run it after changing the guide.
//
//   node dev/model-eval.mjs                 every case, on qwen3:8b
//   node dev/model-eval.mjs --model NAME    another installed model
//   node dev/model-eval.mjs party           only cases whose request contains "party"
//
// This tests the model's first answer. In the app, ask() also retries once
// when the model names an action without its command, and drops a play
// command from a request that only asked to find. Those guards aren't here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const theme = readFileSync(join(here, "..", "theme.js"), "utf8");
const args = process.argv.slice(2);
const named = args.indexOf("--model");
const wanted = named >= 0 ? args.splice(named, 2)[1] : "qwen3:8b";
const only = args[0]?.toLowerCase();

const guideSource = /const MODEL_GUIDE = \[\n([\s\S]*?)\n {2}\]\.join\("\\n"\);/.exec(theme)?.[1];
const replySource = /const MODEL_REPLY = (\{.*\});/.exec(theme)?.[1];
if (!guideSource || !replySource) {
  console.error("couldn't find MODEL_GUIDE or MODEL_REPLY in theme.js. Did their layout change?");
  process.exit(1);
}
const guide = new Function(`return [${guideSource}].join("\\n")`)();
const shape = new Function(`return ${replySource}`)();
const { tags, playing, cases } = JSON.parse(readFileSync(join(here, "model-cases.json"), "utf8"));

// The console's own Ollama first, then the usual one. The same order the theme uses.
let ollama = null;
for (const port of [11435, 11434]) {
  try {
    const res = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) continue;
    const models = ((await res.json()).models ?? []).map((model) => model.name);
    if (!models.includes(wanted)) {
      console.error(`Ollama on port ${port} doesn't have ${wanted}. It has: ${models.join(", ") || "nothing"}`);
      continue;
    }
    ollama = `http://localhost:${port}`;
    break;
  } catch {}
}
if (!ollama) {
  console.error("no Ollama with that model answered on port 11435 or 11434.");
  process.exit(1);
}

const answer = async (test) => {
  const body = {
    model: wanted,
    stream: false,
    think: false,
    format: shape,
    options: { temperature: 0, num_ctx: 8192, num_predict: 700 },
    messages: [{ role: "system", content: guide }, ...(test.before ?? []), { role: "user", content: `Tag list: ${tags.join(", ")}.\nPlaying now: ${test.playing ?? playing}.\nLast list in the console: ${test.list ?? "empty"}.\nRequest: ${test.say}` }],
  };
  const res = await fetch(`${ollama}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  return JSON.parse((await res.json()).message.content);
};

// Genre words in a find, mix or set command that aren't real tags are made up.
const madeUp = (command) => {
  const [name, ...rest] = command.toLowerCase().split(/\s+/);
  if (!["find", "mix", "set"].includes(name) || !rest.includes("or")) return [];
  return rest.join(" ").replace(/\s+in\s+.+$/, "").split(/\s+or\s+/).map((part) => part.replace(/\b(\d+m|\d+(-\d+)?bpm|\d{4})\b/g, "").replace(name === "set" ? /^\s*(flat|up|down|peak)\b/ : /^\s*(slower|faster)\b/, "").trim()).filter((part) => part && !tags.includes(part));
};

let passed = 0;
let ran = 0;
console.log(`${wanted} at ${ollama}\n`);
for (const test of cases) {
  if (only && !test.say.toLowerCase().includes(only)) continue;
  ran += 1;
  const started = Date.now();
  let reply = null;
  try {
    reply = await answer(test);
  } catch {}
  const commands = (reply?.commands ?? []).filter((command) => typeof command === "string");
  const problems = [];
  if (!reply) problems.push("no usable answer");
  else {
    test.expect.forEach((pattern, i) => new RegExp(pattern, "i").test(commands[i] ?? "") || problems.push(`command ${i + 1} should match /${pattern}/`));
    if (commands.length > test.expect.length && !test.more) problems.push(`${commands.length - test.expect.length} extra`);
    for (const command of commands) for (const word of madeUp(command)) problems.push(`"${word}" isn't in the tag list`);
  }
  if (!problems.length) passed += 1;
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ${test.say}`);
  console.log(`        ${JSON.stringify(commands)}${problems.length ? `\n        ${problems.join("; ")}\n        said: ${reply?.say ?? ""}` : ""}`);
}
console.log(`\n${passed} of ${ran} passed`);
process.exit(passed === ran ? 0 : 1);
