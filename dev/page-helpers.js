// Test helpers that live in Spotify's page as `__tty`. cdp.mjs loads this
// before eval, file, run and snap. Nothing here ships with the theme.
//
//   await __tty.run("find deep house")   type a console line, wait for it, return what was printed
//   __tty.snap()                         song, position, pause, shuffle, queue
//   await __tty.wait(500)                a wait that still works when Spotify's window is hidden
//   await __tty.look("terminal")         switch look or view with the theme's own switches
//   __tty.open() / __tty.close()         show or hide the console pane (for screenshots)
(() => {
  const VERSION = 1;
  if (window.__tty?.version === VERSION) return true;

  // Chrome slows a hidden window's timers to about one a minute. A worker's timers keep time.
  const worker = new Worker(URL.createObjectURL(new Blob(["onmessage = (e) => setTimeout(() => postMessage(e.data[0]), e.data[1]);"], { type: "text/javascript" })));
  const waiting = new Map();
  let count = 0;
  worker.onmessage = (event) => {
    waiting.get(event.data)?.();
    waiting.delete(event.data);
  };
  const wait = (ms) =>
    new Promise((resolve) => {
      count += 1;
      waiting.set(count, resolve);
      worker.postMessage([count, ms]);
    });

  const player = () => Spicetify.Platform.PlayerAPI;
  const state = () => player()._state ?? {};
  const box = () => document.querySelector(".tty-console");
  const output = () => document.querySelector(".tty-console-out");
  const input = () => document.querySelector(".tty-console-input");
  const position = () => (state().positionAsOfTimestamp ?? 0) + (state().isPaused ? 0 : Date.now() - (state().timestamp ?? Date.now()));
  const queued = () => (state().nextItems ?? []).filter((item) => item.provider === "queue");
  // A player command sometimes does its job and never answers. Don't wait on it forever.
  const within = (job, ms = 4000) => Promise.race([Promise.resolve(job).catch(() => null), wait(ms)]);

  const snap = () => {
    const now = state();
    return {
      song: now.item ? `${now.item.name} by ${(now.item.artists ?? []).map((artist) => artist.name).join(", ")}` : null,
      from: now.item?.provider ?? null, // context, queue or autoplay
      context: now.context?.uri ?? null,
      seconds: Math.round(position() / 1000),
      paused: Boolean(now.isPaused),
      shuffle: Boolean(now.shuffle),
      queued: queued().length,
      next: (now.nextItems ?? []).slice(0, 3).map((item) => item.name),
    };
  };

  // Types a line into the console and waits until the console is done with it.
  // Works with the pane hidden. Song rows are counted, not returned, unless songs is set.
  const run = async (text, { max = 100000, keep = 8, songs = 0 } = {}) => {
    if (!input()) return { error: "the theme's console isn't on the page" };
    const before = output().childElementCount;
    const started = performance.now();
    input().value = text;
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(350);
    while (box().classList.contains("is-busy") && performance.now() - started < max) await wait(100);
    await wait(400);
    const rows = [...output().children].slice(before);
    const isSong = (row) => row.classList.contains("tty-console-song");
    const text1 = (row) => row.innerText.replace(/\s*\n\s*/g, " | ").slice(0, 200);
    return {
      seconds: Math.round((performance.now() - started) / 100) / 10,
      stillBusy: box().classList.contains("is-busy"),
      lines: rows.filter((row) => !isSong(row)).map(text1).slice(0, keep),
      songCount: rows.filter(isSong).length,
      ...(songs ? { songs: rows.filter(isSong).map(text1).slice(0, songs) } : {}),
    };
  };

  const look = async (value) => {
    const button = document.querySelector(`.tty-mode-option[data-value=${value}]`);
    if (!button) return false;
    if (button.getAttribute("aria-pressed") !== "true" && button.getAttribute("aria-checked") !== "true") {
      button.click();
      await wait(900);
    }
    return true;
  };

  const open = async () => {
    if (!box() || !box().hidden) return false;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "`", bubbles: true }));
    await wait(600);
    return true; // It was closed. Close it again when done.
  };
  const close = () => input()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  window.__tty = { version: VERSION, wait, within, state, snap, run, look, open, close };
  return true;
})();
