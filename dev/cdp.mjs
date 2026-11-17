#!/usr/bin/env node
// Looks inside a running Spotify, for checking a change after `spicetify apply -n`.
//
// Spotify must be running in inspection mode:
//   open -a Spotify --args --remote-debugging-port=9222
//
//   node dev/cdp.mjs status                     is Spotify reachable, is the theme loaded, what is playing
//   node dev/cdp.mjs reload                     reload Spotify's page and wait for the theme
//   node dev/cdp.mjs run "find deep house"      type a line into the console and print what it answered
//   node dev/cdp.mjs snap                       the player's state: song, position, queue
//   node dev/cdp.mjs eval "<javascript>"        run an expression in the page and print its value
//   node dev/cdp.mjs file test.js               the same, from a file
//   node dev/cdp.mjs shot out.png               screenshot the window
//   node dev/cdp.mjs clip ".tty-console" out.png [padding]   screenshot one element
//   node dev/cdp.mjs perf [seconds]             time spent on style, layout and script, per second
//
// eval, file, run and snap load page-helpers.js first, so `__tty` is there.
// Needs Node 22 or newer (built-in WebSocket). No packages.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.SPOTIFY_DEBUG_PORT ?? 9222;
const LIMIT = Number(process.env.CDP_TIMEOUT ?? 240) * 1000;
const [command, ...args] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));

const stop = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

if (!command || command === "help") stop(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"), 0);

setTimeout(() => stop(`no answer after ${LIMIT / 1000} s. Set CDP_TIMEOUT (seconds) for longer runs`, 2), LIMIT).unref();

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
} catch {
  stop(`Spotify isn't in inspection mode on port ${PORT}. Restart it with:\n  open -a Spotify --args --remote-debugging-port=${PORT}\nThat stops the music, so ask first.`);
}
const page = targets.find((target) => target.type === "page" && target.url.includes("xpui")) ?? targets.find((target) => target.type === "page");
if (!page) stop("Spotify is running but has no page to inspect yet. Try again in a few seconds.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let sent = 0;
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error("socket"));
}).catch(() => stop("couldn't connect to Spotify's page. Another inspector may be attached."));

const send = (method, params = {}) =>
  new Promise((resolve) => {
    sent += 1;
    pending.set(sent, resolve);
    socket.send(JSON.stringify({ id: sent, method, params }));
  });

// The value of an expression in the page. Promises are awaited.
const evaluate = async (expression) => {
  const answer = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const failure = answer.result?.exceptionDetails;
  if (failure) throw new Error(failure.exception?.description ?? failure.text ?? "the page threw");
  return answer.result?.result?.value;
};
const show = (value) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
const helpers = () => evaluate(readFileSync(join(here, "page-helpers.js"), "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A hidden window never paints, so a screenshot of one waits forever.
const visible = async () => (await evaluate("document.visibilityState")) === "visible" || stop("Spotify's window is hidden or minimized, so there is nothing to photograph. Bring it on screen and try again.");

try {
  if (command === "status") {
    show(
      await evaluate(`(() => {
        const state = globalThis.Spicetify?.Platform?.PlayerAPI?._state;
        return {
          spotify: globalThis.Spicetify?.Platform?.version ?? navigator.userAgent.match(/Spotify\\/([\\d.]+)/)?.[1] ?? "?",
          spicetify: Boolean(globalThis.Spicetify),
          theme: Boolean(document.querySelector(".tty-app")),
          console: Boolean(document.querySelector(".tty-console-input")),
          look: document.documentElement.classList.contains("tty-spotify") ? "spotify" : "terminal",
          window: document.visibilityState,
          playing: state?.item ? state.item.name + (state.isPaused ? " (paused)" : "") : "nothing",
        };
      })()`),
    );
  } else if (command === "reload") {
    await send("Page.enable");
    await send("Page.reload", { ignoreCache: true });
    let ready = false;
    for (let tries = 0; tries < 80 && !ready; tries += 1) {
      await sleep(500);
      ready = await evaluate('Boolean(document.querySelector(".tty-console-input"))').catch(() => false);
    }
    await sleep(1500); // The theme labels Spotify's boxes on a 250 ms timer. Let it finish a few passes.
    console.log(ready ? "reloaded, theme is up" : "reloaded, but the theme didn't appear within 40 s. Check the page for errors: node dev/cdp.mjs eval \"document.querySelector('.tty-app') !== null\"");
    if (!ready) process.exitCode = 1;
  } else if (command === "eval" || command === "file") {
    if (!args[0]) stop(`${command} needs ${command === "eval" ? "an expression" : "a file"}`);
    await helpers();
    show(await evaluate(command === "eval" ? args[0] : readFileSync(args[0], "utf8")));
  } else if (command === "run") {
    if (!args[0]) stop('run needs a console line, for example: run "find deep house"');
    await helpers();
    show(await evaluate(`__tty.run(${JSON.stringify(args.join(" "))})`));
  } else if (command === "snap") {
    await helpers();
    show(await evaluate("__tty.snap()"));
  } else if (command === "shot") {
    if (!args[0]) stop("shot needs a file to write");
    await visible();
    const image = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(args[0], Buffer.from(image.result.data, "base64"));
    console.log("saved", args[0]);
  } else if (command === "clip") {
    if (!args[1]) stop('clip needs a selector and a file, for example: clip ".tty-console" console.png');
    await visible();
    const pad = Number(args[2] ?? 10);
    const box = await evaluate(`(() => {
      const found = document.querySelector(${JSON.stringify(args[0])});
      if (!found) return null;
      const at = found.getBoundingClientRect();
      return { x: Math.max(0, at.x - ${pad}), y: Math.max(0, at.y - ${pad}), width: at.width + ${pad * 2}, height: at.height + ${pad * 2} };
    })()`);
    if (!box) stop(`nothing on the page matches ${args[0]}`);
    const image = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
    writeFileSync(args[1], Buffer.from(image.result.data, "base64"));
    console.log("saved", args[1]);
  } else if (command === "perf") {
    // Where the page spends its time. Spotify recalculates style about 100 times a second
    // even when idle, so a costly selector shows up here as style milliseconds per second.
    const seconds = Number(args[0] ?? 10);
    const hidden = (await evaluate("document.visibilityState")) !== "visible";
    await send("Performance.enable");
    const read = async () => Object.fromEntries((await send("Performance.getMetrics")).result.metrics.map((metric) => [metric.name, metric.value]));
    const before = await read();
    const frames = evaluate(`new Promise((done) => { let count = 0; const until = performance.now() + ${seconds * 1000}; const step = () => { count += 1; performance.now() < until ? requestAnimationFrame(step) : done(count); }; requestAnimationFrame(step); })`);
    await sleep(seconds * 1000);
    const after = await read();
    const each = (name) => Math.round(((after[name] - before[name]) * 1000) / seconds);
    show({
      seconds,
      window: hidden ? "hidden, so Spotify is barely drawing and these numbers say little. Measure with the window on screen" : "visible",
      style_ms_per_s: each("RecalcStyleDuration"),
      layout_ms_per_s: each("LayoutDuration"),
      script_ms_per_s: each("ScriptDuration"),
      all_work_ms_per_s: each("TaskDuration"),
      frames_per_s: Math.round((await Promise.race([frames, sleep(1500).then(() => 0)])) / seconds),
      style_recalcs_per_s: Math.round((after.RecalcStyleCount - before.RecalcStyleCount) / seconds),
    });
  } else {
    stop(`unknown command: ${command}. Run with no arguments for the list.`);
  }
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
}
socket.close();
process.exit(process.exitCode ?? 0);
