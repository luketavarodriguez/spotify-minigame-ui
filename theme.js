// Terminal // Spicetify theme script
// Adds a shell prompt to the top bar, runs games on the playback bar (the
// Chrome T-Rex, flappy, a shooter; on autopilot or played by you), sets
// .tty-playing for the spinner, and shows listening stats on Home.
// Reads Spotify's player state directly, so it doesn't depend on
// Spicetify.Player being hooked up.

(function terminal() {
  const S = window.Spicetify;
  const player = S?.Platform?.PlayerAPI;
  if (!player?._state || !S.Platform.History || !document.getElementById("main-view") || !document.querySelector("[data-testid=now-playing-bar]")) {
    setTimeout(terminal, 300);
    return;
  }

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  // ---- Layout labels -------------------------------------------------------------
  //
  // Spotify labels the parts of its app (data-testid, element IDs) but not the
  // boxes around them, which the layout needs: the player bar's three columns,
  // the row under the timeline, and so on. The styles could find those boxes
  // themselves with CSS :has(), but Chrome re-checks :has() on every change
  // anywhere inside, which made the whole app sluggish. So the script finds
  // them a few times a second from Spotify's labels and tags them with ours.

  const labels = new Map();
  const label = (name, el) => {
    const old = labels.get(name);
    if (old === el && (!el || el.classList.contains(name))) return;
    if (old && old !== el) old.classList.remove(name);
    el?.classList.add(name);
    labels.set(name, el ?? null);
  };
  const labelAll = (name, els) => {
    for (const el of els) if (!el.classList.contains(name)) el.classList.add(name);
  };
  const childHolding = (parent, el) => {
    while (el && el.parentElement !== parent) el = el.parentElement;
    return el;
  };

  const labelLayout = () => {
    const app = document.getElementById("main-view")?.parentElement;
    label("tty-app", app);
    const bar = document.querySelector("[data-testid=now-playing-bar]");
    label("tty-player", bar?.parentElement);
    const controls = bar?.querySelector("[data-testid=player-controls]");
    const row = childHolding(bar, controls);
    label("tty-row", row);
    const columns = row ? [...row.children] : [];
    const center = columns.find((col) => col.contains(controls));
    const left = columns.find((col) => col !== center && col.querySelector("[data-testid=now-playing-widget], [data-testid=now-playing-widget-v2]"));
    const right = columns.find((col) => col !== center && col !== left);
    label("tty-left", left);
    label("tty-center", center);
    label("tty-right", right);
    label("tty-extra", right && [...right.children].find((child) => !child.classList.contains("tty-queue")));
    label("tty-playback", bar?.querySelector("[data-testid=playback-position]")?.parentElement);
    label("tty-home", document.querySelector("#global-nav-bar form[role=search]")?.parentElement?.previousElementSibling);
    const panel = document.getElementById("Desktop_PanelContainer_Id");
    label("tty-sidebar-peek", app && childHolding(app, panel) && [...childHolding(app, panel).children].find((child) => child.contains(panel)));
    labelAll("tty-topbar-bg", document.querySelectorAll("[data-testid=topbar] > :not(:has([data-testid=topbar-content-wrapper]))"));
    labelAll("tty-entity-bg", [...document.querySelectorAll("[data-testid=entity-header] > *")].filter((child) => !child.querySelector("h1")));
  };
  labelLayout();
  setInterval(labelLayout, 250);

  const state = () => player._state ?? {};

  const position = (s) => {
    if (s.isPaused) return s.positionAsOfTimestamp ?? 0;
    const speed = typeof s.speed === "number" ? s.speed : 1;
    return (s.positionAsOfTimestamp ?? 0) + (Date.now() - (s.timestamp ?? Date.now())) * speed;
  };

  let userName = "user";
  S.Platform.UserAPI?.getUser?.()
    .then((user) => {
      const first = (user?.displayName ?? "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (first) userName = first;
    })
    .catch(() => {});

  // ---- Shell prompt in the top bar ------------------------------------------

  const prompt = el("div", "tty-prompt");
  prompt.setAttribute("aria-hidden", "true");
  const promptUser = el("span", "tty-prompt-user");
  const promptPath = el("span", "tty-prompt-path");
  prompt.append(promptUser, ":", promptPath, "$ ", el("span", "tty-cursor"));
  document.body.append(prompt);

  // "/playlist/37i9dQZF1DXcBWIGoYBM5M" -> "~/playlist".
  const cwd = () => {
    const section = (S.Platform.History.location?.pathname ?? "/").split("/").find(Boolean);
    return section ? `~/${section}` : "~";
  };

  const renderPrompt = () => {
    promptUser.textContent = `${userName}@spotify`;
    promptPath.textContent = cwd();
    // Sit right of the last button before the search box (back/forward, and
    // whatever Spotify adds beside them); hide if the search box gets close.
    const search = document.querySelector(":is(#global-nav-bar form[role=search])")?.getBoundingClientRect();
    const before = [...document.querySelectorAll("#global-nav-bar :is(button, a)")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && (!search || r.right < search.left - 40));
    const left = Math.max(210, ...before.map((r) => r.right)) + 16;
    prompt.style.left = `${left}px`;
    prompt.style.visibility = search && left + prompt.offsetWidth + 16 > search.left ? "hidden" : "visible";
  };

  // ---- Chrome T-Rex runner on the playback bar ------------------------------
  //
  // The sprite sheet and every game constant below come from Chromium's dino
  // game (components/neterror/resources/dino_game), Copyright The Chromium
  // Authors, BSD-style license:
  // https://source.chromium.org/chromium/chromium/src/+/main:LICENSE
  //
  // The game's own code isn't vendored: it's built around a keyboard, a T-Rex
  // parked at a fixed spot and a crash screen. This reimplements it on the same
  // sprites, physics, obstacle rules, hitboxes and frame timing, with two modes:
  //   auto: an autopilot plays while the T-Rex rides the song's playhead, and
  //         each track is a fresh run.
  //   play: you play. Jump with Up, duck with Down. Crashing pauses the song;
  //         resuming it (Space or Up) starts a new run.
  // Two more games (flappy, shooter) live further down with the same two
  // modes, and every game has easy, medium and hard levels.

  const SPRITE_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAACY4AAADCCAMAAADT9DSoAAAANlBMVEUAAADa2tr/////9/e5ubn39/dTU1P29vbv7+/+/v74+Pjw8PD///9ZWVlfX1/z8/P5+fn///9RgilMAAAAEnRSTlMA///////////////2////9gn80juWAAAR/UlEQVR4AezdAW+jOBPG8QcgVPv9P+xqHQPvu9nrTWWd1enNuY7D/ydpS+gwdqRq44yN0WUBAAAAAAAA06u/sVPPbZZ0/Ie5LNvIEWbRu11msCsK7duYZM4OcaWzf1+rVk13fbTpj1SctXMWZJHluSLYTmxlUBlVxJlkZz/py2a/txeV/o1qls9B3q55/TALAAAAHa16KeU340nT4+gKZq36LesYPMIsWmR2mbGuqGvZxqkrOsct+wNgOAYA2Gy6bysmEo3N/71HKhWzg+W1haTCZqdr06Blu5tSvS/GpLIhAAzHmsxMWyWsqJA980zxKinb+4zWxh4Zs46RIyoVosWqRGNcYRGOrJE2zCTjjzsD+SwysJLTFXdaRCjf+DA7P74yeTvmrdtUKCTWjr2uaZIAoHR7k5a3H+oLANZX+W4zdf4WjFmHP+IyrM616/ucQ+S1nFO3FWTn/r6Gsbi50Sb+3l+aykxk5Q5Mu9xstTshK20UL5MAMBwbzsmyXgCF22yD5OVx/EthAMBw7NSobP1Yh2qV7X4WyjF/shLMIio5Xrw2tsTrY/3XjQXiLPYMxFktLZ7v3O04azRYA/+z9stL3s0Zk/ibHkqvqUwA2Opzl9ock5B2J2Qtn50t5ky38txW6R8AhmM9xt4w/mrVnyMpB3I8MjyOKyyimqO9+r2O16sRswdZtv+HNN01KGRJK/1tmfdhbZ4Xq67AtoS11wDwcLsLAK49HEvhqvrU9O7Po2HudpVAq0Udn0bocfQ4DuRo0NOB7nXsULPrsG7s9MUZ/zouTV3Wj0lZq6Z7juyclFQe1yYh7ZxxXJvKBJvsd+XvTbKTQHxtc+u8WPXyJp3Fh8kkAAAAhmMxzu/G/WHWccF7HesWazVYswOw0l/L++zAvmP1Oy0BoLr5a8WmIsC9lasdBVgeE8sMgOHYFl4nczZ7lqRsPVez3Nle2/qxXrvhN8hh903CqmB7uGYX3x/sDOdzaLj/2BTNB8Ahf1NerNz+DgAAwHCs/Vox9hdr2Yp/tzFqYw1XrZ1C9KmYSdrKab+tOh+42XXldqxJFf8Q95VrN5lUucuzov4+gP5r3TDrwqb/E4BLur39KI57AYCVfccra7v65Lb1Y4HqU7O9wQbdocvqUezcD3PuR3HcCwCsTGEAYDf+v4+TCkn1M/Wz9d8l/7X1vvj7l+wAAMMxoMeu+vErAhW45nVB92O/JpXOxndVtr+78tTkiiu/fFlctnqvHXcBAOtYS/incq/9oNPyALic27xrmeef6goAVqFc21Vfy9Uot+ptXozVf/y76nuvWKox8Tbsmn2op23i3MW+eAAYjn11YuOsTlUAgN9ttoHt8jj+JQBgOAb+GOKrvLr0yiIWixngaZvUxd5lgf3jyQuGYw5n5RwANH1wW3LHOyNT5WUtvpBav6n2/dwcwR0BDMfy06wb8++XewRzG9aPlfWfwBUXqEpNMqczTq3j2t9dGYg7Ncnisuw/wOkuAGBX/n4A4CYAoDrWFQ5lrboiIGvVdM/Vebq6Mn6TNt+F23u8U1JU8aasqzGBftb7M38y7zA7P86y5SBvPG+p2dxNojoGADyzEsD4qI41GtP3Xze2+r8jxHPHOXKuofqY5aAcG9+hHzyzEgBWCQB4ZmVgpvLr85VXAYDhGLIOzZ9G/HbYfWYNWrFVOtdQ26F/0TMBz6x81uei5Opv6x9buVNe8to3jOSIKSXnWqpDDURaZe0YAAAA1bEOY++ee56tzv3Bao5GuQ9X1coTYfnmSt9irVj+rPUCxVnboZ/a2MjKzV0796RDZ+wO0Jb93AQ8S93p6NVqJR4AAACsHUO80neEIoqVYYEcplihVrRyHfv7g6u1qwTAPbNScXTIS94WNVCbI5r/dSXpGKjVSwKA2zz/tJ8f+efp3GFFZn/+pJbqPazP2Mb7WSYHsI783cYh3F52rvEyJlv+JrmPatQh442o1caiOcor5korPSxda2O2O1m3XrHzmP18QQBm5+gjW2yHVg+75noAYHuTljfpJgBogclKnjdpEcH1Z/5W1kArr10bszrYx9rY0nV3MuS//p3u2b+Va8mCt6EfzFefq03tp0TTp/eUe+cRskrkbZ+3vvfY5pyyTs62Z2ef7QqvDq0yHAOA2ywbHD+OfwnAeKiOdRh793C41niZLHO0zN20PmYttG/le+0d60+7ngfO3Y6zXheA1RmTu7Vq8QAAm698IpvKHsbfVHJflVr2s5yvBBg0Yli2m5cjonUr6wB/XFYfu3Kf8PHvebqrK8SrBtnieuUlb7F+bHMuo9yaDVdW/7vo1SrPrASA25setrcf6gkA1qG+2wzA1sDF16a5cjt2LLGIAFcrSXN9z31qUdW9+JcufcK5T/f1URs7/LNs9cjUOD4itbwqBdImXRpAdQwAbvbzdQFg7RhgtTHqY7YXf3muR5+Qle0nhv94yn3ykjf+2LD4vFn8HXdvdVZHAAAAWIf5bjOALHPE9zYL5u4vh3q7fH4ucMVejVia18aWyrn9S704JU36Y9LpijPt4zzOb42bKnFdAQDVMQC46YUBoDoGHFKz2tiuXYvnCosvrrcIRxvOVmL2IqPvnfyPvXvRkRMHogAKYdT//70ImH3WitHGkTXuCpQ4Z59NsD2iETE3hWGEujHXG/2m9zvwNH9HJVfVUaVjAADSsYajaJ1YOEbfjdl9fNinPWf/Rpv+BG6ZxsnGAOqTjgEASMcgaTWwSIiiRXo2tvf/VL85FYynHP/5d//TlfEsZv7TlXlPS86eqqyv9Yx5hX7123j3pPox6RgAgHRsfO5dp27suKx2Tj62T3tfi9hvMBv7yzJeaZZSMQfEFVm/tfpdJ6RjAABqx9pzb+Rj/VlXTz7WNjBGo0Xs+159Kd+sMqqrygz1Y/pVP7ZdOKp0rD4AQDqmfkySl+1Xb27ce1sM2L+R2oX0fOyNT0PO0+d4f5e9q3J+c38AascAAKRjcL98bBlokZnaLZ0VcNlA/dim39x+k+rH1t9WP7Y1JjsfP9nnuHTUS9MxAAA+Kt3btHGcjuRRd48Cqd1ym7xutN4rnsQc70/dGIDaMQAA6RjXO4rv8YAV1GLbafvy5vX258QkaE5LmGYrjvVSP9ZR8aPf/H5H6sfWod/jfnyjkuvoXGfs2lEvTccAAPi4yb2NNcd4bGYW2VjV+rHoR90YcK3ty+RmKzCqdAwAQO0YyMf2+He4dQXZnNDrrGqshfgzlsbnGv3+4+O/7du/KcjxvX6jz5sfh6gfa30e89E4CltqzXLre/1VJnZIxwAApGO9c+8CDnVjpK1ftk/vE8nV3L9fO0vr769dQfbGGq9ZzRhYmatz/f5zivbP5yNv1NAY9XnpGACAdOz1zRX3X+Nvt4JC9sjGUkXqVZOqMSLnCNtPntk/7t9vvPXw5Bh6X2OkL9cfhz5rZv3YBSsfnEfarMoPACAd60yxeubea5H7NKjh86r9CvysQPm8tMN2bnfNqNIxAABPVgJAQr1OjX4/T/0eb8yFtvPnAsdhzVsF/7K6sZF3TkrHAACkY9mzVwCA4zajSscAAKRjr1MqBgDjq0wd7W236neOVdmz0pcCxyFmAmt72+BR+NH+SZPPw17SMQAA6dga8723zr1hmfb6LULiGPkAkI4BAEjH8r0e+75KCdjS+JW/tu+XtAjtFpliDHiarbGtQL95ChyHtXNblaO9SccAAKRjnV4x/33b3HudeJjIgRrJ1f7PP/kt+jO7aDFc4dU/BgBqxwAAeJt5gjK1Y/uFLZZGiz1anPbaT59O+8W48SuxtWsMAJ6SjgEA4MlKiDqp9pOF+S36K8rO2/f/fQr7lxH209beMQB4cjoGAACwLAVaJIwQbQB4djoGAAAAAAAAYN0xAF5eYEKVM9AZq3YMAEA6BkBCMrF+/XBPOAOdsdIxAADpGAAJNTtrM3qA689AZ6x0DABAOgZAfs1OO4CAa85AZ2zJdAwAgDmmqABU0C7R6WzabgwJZ+D62JNuvWM6BgCA2jEAz8M9sY4H1I4BACAdA+DVX+UCSMcAAKRj+dULNb0S7iQd1fzvBN+d65Wj6jsh/7uTjgEAlDRXmre/prVnteACqxknHIPe1mWOSv5Ryr9H7x+x8qhxtON7zP8ZXK9cr1yv8rleqR0DAFA7RlWvafVzXHt/XOn4q+bBdcL1yvXKk5UAAMzJM92EWXx+zUh+bUD+/D7vT9VlKfXvbOURrleuV2RwvZKOAQAUNZ/v3HJmuu3+3ZlTt0agfX6Pn2PuctvHz/WK+3K9cr2SjgEAAAAAAADFzN6R3vZHe3ew27YORGH4DDHLbu77P2Q3WQ40FygCI0xpj0xJjST8H9A2qugTZ3cwZqiFnDoHAACwdwwAAODKXLfW5JoXWoocci4NAACmYwAAALDVjW3RvD7n3LOxTmghp8jZBgAAeF2guotlvoi5FG/mNDaXAwCAu7OXXcjVianG0/rmF0Vz2q2ONbm2C4mcA+djAADA325CbZkpY95/x1iT80u2pjdm9/WHAAAArsTfH0s1LW+VMY/ht40ipypjD6b88vUvCtkNAABAHWvdrXKwVW8a2zhos+J26qIAAAC8no3ND8ia5FXO7GysY8przscAAAD87RLlkqIcbNWlztcO2kyd+w3IUiYAAMAxsA9t7oWH5dj5Hr6ZqdPKvPjPCAAAdaxNvnJ82zfnmFYyXVdSfgAAoI51166Ce9WjmtzrmDrHtJpduj9lMh8DAIA6doCIuthdj+3byEwAAIA6Nr4salSrY2vxcrHtVWvysz9lKk80I2M+BgAA2pEvdp/rdfuPmVKZn/0idaIOBQAA4IPTJ0r1Ute5WI5bW6pn6+N6OZWjHJ54kXM5gyQpD83ZDgAA+GjcFa512vJ6bBYbc2xw0qu96BCWawpUms4CAADA9c+EXCOuUMW0leV+J7IORm2zOT2bzxm98vic7QAAgI9OuQg9xMxYq41K2CPMV+dY96/likck5Yo+ZtqP6cQAAADTMX+0se8Nz3+w8aRtmo+lCrM5tuf7sR/LmQcAAHWsPa5C8r45DVtUjMdaTUNdMYuvWa4Y5di3NmB5umdXmgAAALbxw1MfTS4e3ev9KVnxO4wm5VSHsj56fi+aTedIUvYJNpUz/g1I2zXnwgAAYCu/y0cb+KN4DynZ3qOvNAEAAJy6jnkMplcuhULyvlK9Fl9iunj/8nFoEZKy2btjtttRZnbOTz3tTDkAAKDQdCh3H5Q+7xb4P+wHZ2tQAAAA7Vkzi/j7KUfuLwPGORqK+BbbqrqTuU9JMqVuzexUOQAAoOA/EuqhCXm/z/IYtAEAAK+fR7mNK/bpY3Qf9o0BAMDescO4CwAAgOnYYfzJ8ysBAADQDhhYub4JjQEAAKDpXwgVKGwAAIA6pkV/iXhy+epVS0TUc7Y6JzUjBQAAwHTM9U0MLwEAAOAvb8W65YWQFN5fO8dWAAAArOlX8VgSmtX1uvDYv3elAAAAOOjitZB3Ba8TAgAAoI5paeGDI/VDz4S0qDfOiaJzjXPS9LacX9Aj504AAGA65uM2BgAAAO/HWk/vx7i7LRpZWl3JipxuPJard46lnjOlaqYCOVcAAADTseiDn3Q6to4BAAD4eEhVKdYvbZ+ctPe2NOXW+Y+pRg4AANiTPzvXohQ80BIAAGA71wZL/XHlfM6EVMW0ATkAAOD4OrY0heT1nq8Ytagu57uYaWNpk20MAACAgy5CXnw3AAAA+MpN+F4OtYqcGGZElZPGcAwAANxaG5WsUCGiaFGj214sHEvaGAAAuLU2u69+WbEg9CkihqUuVuQkbQwAANyZj3pUi683Qp2o21iXUy0qpYw2BgAAbsunTnFdVOtzXPHWtrEP/ZKt3kCWekh9CAAA4Dr8WY8KSfJ+UbxsY0Wv876J+Ts5aYzGAADA7RT769suh7YuiienX0SV08/HZHUZYzZ2DwAAUMeKQrZoqMgJySVFP2KrC9modHnIpc+/eh8CAAC4Fi+24v8Rk2WsL3bR/+e8ePwBAAC4PFOpTRSoI3P+0x+/VWpybRNaTpfTpFO9HwAAsI2rtGjCgTm/BQAAcB+mW2vy7bOfk+U0STrZzwUAAOY1ATgnAADTMfrmcracLuEs7wcAADAdAwAAuLD/AQPLUxmjjeldAAAAAElFTkSuQmCC";
  const SCALE = 1; // CSS pixels per game unit: the real game's own 1x size.
  const FRAME_MS = 1000 / 60;
  const HEIGHT = 150; // Game canvas height.
  const GROUND_LINE = 132.5; // Where the horizon's line sits, in game units.
  const PLAY_X = 50; // The game's own start position for the T-Rex.
  const SCORE_COEFFICIENT = 0.025;
  const ACHIEVEMENT_DISTANCE = 100;
  const HIGH_SCORE_KEYS = {
    dino: "tty-dino-high-score",
    flappy: "tty-flappy-high-score",
    shooter: "tty-shooter-high-score",
  };
  const LEVEL_KEY = "tty-level";
  const GAME_KEY = "tty-game";
  const LOOK_KEY = "tty-look";
  const VIEW_KEY = "tty-view";

  const GAME = {
    speed: 6,
    acceleration: 0.001,
    maxSpeed: 13,
    gapCoefficient: 0.6,
    maxGapCoefficient: 1.5,
    maxObstacleLength: 3,
    maxObstacleDuplication: 2,
    clearTime: 3000,
    cloudFrequency: 0.5,
    maxClouds: 6,
  };
  const TREX = {
    spriteX: 1678,
    width: 44,
    height: 47,
    widthDuck: 59,
    // The head, for nodding: the rows above his neck, right of the back of
    // his neck, so the back stays joined when the head dips.
    headRows: 17,
    headX: 20,
    groundY: 93,
    gravity: 0.6,
    initialJumpVelocity: -10,
    minJumpHeight: 30,
    maxJumpHeight: 30,
    dropVelocity: -5,
    speedDropCoefficient: 3,
    running: [[22, 0, 17, 16], [1, 18, 30, 9], [10, 35, 14, 8], [1, 24, 29, 5], [5, 30, 21, 4], [9, 34, 15, 4]],
    ducking: [[1, 18, 55, 25]],
  };
  const ANIM = {
    waiting: { frames: [44, 0], ms: 1000 / 3 },
    running: { frames: [88, 132], ms: 1000 / 12 },
    jumping: { frames: [0], ms: FRAME_MS },
    ducking: { frames: [264, 323], ms: 1000 / 8 },
    crashed: { frames: [220], ms: FRAME_MS },
  };
  const OBSTACLES = [
    {
      type: "cactusSmall",
      spriteX: 446,
      width: 17,
      height: 35,
      yPos: [105],
      multipleSpeed: 4,
      minGap: 120,
      minSpeed: 0,
      boxes: [[0, 7, 5, 27], [4, 0, 6, 34], [10, 4, 7, 14]],
    },
    {
      type: "cactusLarge",
      spriteX: 652,
      width: 25,
      height: 50,
      yPos: [90],
      multipleSpeed: 7,
      minGap: 120,
      minSpeed: 0,
      boxes: [[0, 12, 7, 38], [8, 0, 7, 49], [13, 10, 10, 38]],
    },
    {
      type: "pterodactyl",
      spriteX: 260,
      width: 46,
      height: 40,
      yPos: [100, 75, 50],
      multipleSpeed: 999,
      minGap: 150,
      minSpeed: 8.5,
      numFrames: 2,
      frameRate: 1000 / 6,
      speedOffset: 0.8,
      boxes: [[15, 15, 16, 5], [18, 21, 24, 6], [2, 14, 4, 3], [6, 10, 4, 7], [10, 8, 6, 9]],
    },
  ];
  const CLOUD = { spriteX: 166, width: 46, height: 14, minGap: 100, maxGap: 400 };
  // The 2x horizon crops at x 4 or x 604, a quirk of the real game kept as-is.
  const HORIZON = { spriteX: 4, spriteY: 104, width: 600, height: 12, yPos: 127, bumpThreshold: 0.5 };
  const GAME_OVER = { textX: 1294, textY: 28, textWidth: 191, textHeight: 11, restartX: 506, restartY: 130, restartWidth: 36, restartHeight: 32 };

  // Where the T-Rex's nose sits relative to his x; the nose rides the playhead.
  const TREX_FRONT = 38;

  const randomNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const readHighScore = (key) => {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch {
      return 0;
    }
  };

  const saveHighScore = (key, score) => {
    try {
      localStorage.setItem(key, String(score));
    } catch {
      // Storage unavailable; the high score just won't survive a restart.
    }
  };

  // The sheet is grey art with white outlines and eyes. Recolor it the way
  // Chrome's dark mode does: the grey takes the theme color and the white
  // takes the background, so outlines, eyes and the restart arrow survive.
  const sheet = new Image();
  let sheets = null;
  let colors = null;
  const tinted = (rgb, background) => {
    const canvas = document.createElement("canvas");
    canvas.width = sheet.naturalWidth;
    canvas.height = sheet.naturalHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(sheet, 0, 0);
    const image = g.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const k = Math.min(1, Math.max(0, (lum - 0.33) / 0.62)); // 0 = sprite grey, 1 = white.
      for (let c = 0; c < 3; c++) px[i + c] = rgb[c] + (background[c] - rgb[c]) * k;
    }
    g.putImageData(image, 0, 0);
    return canvas;
  };
  // Clouds are a single pale grey outline, which the mapping above would fade
  // into the background. They get a flat grey of their own instead.
  // Every sprite canvas is made with willReadFrequently, which keeps it in
  // memory rather than on the GPU: a GPU reset (heavy pages like Spotify's
  // lyrics view can cause one) wipes GPU canvases, and the game would go
  // blank until a reload. The game's own canvas is redrawn every frame anyway.
  const silhouette = (color) => {
    const canvas = document.createElement("canvas");
    canvas.width = sheet.naturalWidth;
    canvas.height = sheet.naturalHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(sheet, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  };
  // Colors come from the current look, and the background from the pane
  // itself, so sprite outlines match whatever Spotify paints behind them.
  const paneBackground = () => {
    for (let node = document.querySelector(":is([data-testid=now-playing-bar])"); node; node = node.parentElement) {
      const [r, g, b, a = 1] = (getComputedStyle(node).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
      if (a > 0.5) return [r, g, b];
    }
    return null;
  };
  const buildSprites = () => {
      const css = getComputedStyle(document.querySelector(".tty-player") ?? root);
      const rgb = (name, fallback) => (css.getPropertyValue(name).trim() || fallback).split(",").map(Number);
      const text = rgb("--spice-rgb-text", "212,212,212");
      const accent = rgb("--spice-rgb-button", "95,215,95");
      const dim = rgb("--spice-rgb-subtext", "138,138,138");
      const background = paneBackground() ?? rgb("--spice-rgb-main", "12,12,12");
      const error = rgb("--spice-rgb-notification-error", "215,95,95");
      colors = { text: `rgb(${text})`, dim: `rgb(${dim})`, accent: `rgb(${accent})`, error: `rgb(${error})`, background: `rgb(${background})` };
      sheets = {
        text: tinted(text, background),
        accent: tinted(accent, background),
        dim: tinted(dim, background),
        cloud: silhouette(`rgba(${dim}, 0.8)`),
      };
      birdSprites = { up: pixelSprite(BIRD.up), down: pixelSprite(BIRD.down) };
      shooterSprites = {
        ship: pixelSprite(SHIP),
        aliens: ALIENS.map((alien) => pixelSprite(alien.rows)),
        steps: ALIENS.map((alien) => pixelSprite([...alien.rows.slice(0, -alien.step.length), ...alien.step])),
      };
  };
  sheet.src = SPRITE_SRC;
  sheet.decode().then(buildSprites).catch(() => {});

  const game = {
    kind: "dino",
    manual: false,
    look: "terminal",
    view: "games",
    level: "medium",
    autoLevel: "medium",
    fraction: 0,
    reseedAt: Infinity,
    analysis: null,
    beatPlan: null,
    beatNext: -1,
    lastSongTime: 0,
    crashed: false,
    pauseSeen: false,
    speed: GAME.speed,
    time: 0,
    distance: 0,
    highScore: readHighScore(HIGH_SCORE_KEYS.dino),
    flashFrom: -Infinity,
    width: 0,
    height: 0,
    track: null,
    obstacles: [],
    history: [],
    clouds: [],
    horizonX: 0,
    horizonSrc: [],
    trex: {
      x: 0,
      y: TREX.groundY,
      velocity: 0,
      jumping: false,
      reachedMinHeight: false,
      speedDrop: false,
      ducking: false,
      status: "waiting",
      frame: 1,
      timer: 0,
      blinkAt: 0,
    },
  };
  const keys = { duck: false };

  // Difficulty. Medium is each game's baseline; for the dino that's the real
  // game's own numbers. In play mode you pick the level; on auto it follows
  // the song (see loadSong).
  const LEVELS = {
    dino: {
      easy: { beatSpeed: 6.5, beatSpacing: 1.6, speed: 5, maxSpeed: 9, gapCoefficient: 0.9, pterodactylSpeed: Infinity },
      medium: { beatSpeed: 8, beatSpacing: 1.0, speed: 6, maxSpeed: 13, gapCoefficient: 0.6, pterodactylSpeed: 8.5 },
      hard: { beatSpeed: 9.5, beatSpacing: 0.72, speed: 7.5, maxSpeed: 15, gapCoefficient: 0.45, pterodactylSpeed: 7.5 },
    },
    flappy: {
      easy: { gap: 112, speed: 1.7, spacing: 270 },
      medium: { gap: 92, speed: 2, spacing: 230 },
      hard: { gap: 76, speed: 2.5, spacing: 200 },
    },
    // Harder means more, faster enemies that weave more, and a gun with a few
    // fewer shots in the air at once. Every alien goes down in one hit.
    shooter: {
      easy: { enemySpeed: 1.3, spawnEvery: 1500, tanks: false, sway: 0.7, fireMs: 220, maxBullets: 7 },
      medium: { enemySpeed: 1.8, spawnEvery: 1050, tanks: true, sway: 1, fireMs: 250, maxBullets: 6 },
      hard: { enemySpeed: 2.4, spawnEvery: 720, tanks: true, sway: 1.35, fireMs: 280, maxBullets: 5 },
    },
  };
  const level = () => (game.manual ? game.level : game.autoLevel);
  const tune = (kind) => LEVELS[kind][level()];

  const setStatus = (status) => {
    const t = game.trex;
    if (t.status === status) return;
    t.status = status;
    t.frame = 0;
    t.timer = 0;
  };

  const resetRun = () => {
    game.speed = tune("dino").speed;
    game.time = 0;
    game.distance = 0;
    game.obstacles = [];
    game.history = [];
    game.beatNext = -1;
    resetFlyby();
    Object.assign(game.trex, { y: TREX.groundY, velocity: 0, jumping: false, speedDrop: false, ducking: false });
    if (game.trex.status !== "waiting") setStatus("running");
  };

  const randomHorizon = () => HORIZON.spriteX + (Math.random() > HORIZON.bumpThreshold ? HORIZON.width : 0);

  // Clouds stay in the game's sky band; flappy's taller sky gets them all the
  // way up.
  const cloudY = () => {
    const top = FLAPPY.ceiling / SCALE - ground.offsetY;
    return top + Math.random() * Math.max(0, GROUND_LINE - 40 / SCALE - top);
  };

  const addCloud = () => {
    game.clouds.push({ x: game.width, y: cloudY(), gap: randomNum(CLOUD.minGap, CLOUD.maxGap) });
  };

  // Clouds drift one unit per frame regardless of speed, as in the game, at the
  // game's density (six per 600 units) across however wide the pane is.
  const updateClouds = (dt) => {
    for (const cloud of game.clouds) cloud.x -= dt / FRAME_MS;
    game.clouds = game.clouds.filter((cloud) => cloud.x + CLOUD.width > 0);
    const last = game.clouds.at(-1);
    if (!last) addCloud();
    else if (game.clouds.length < (GAME.maxClouds * game.width) / 600 && game.width - last.x > last.gap && GAME.cloudFrequency > Math.random()) addCloud();
  };

  // Grouped cacti stretch the middle hitbox and push the last one right.
  const hitboxes = (type, size) => {
    const boxes = type.boxes.map((box) => [...box]);
    if (size > 1) {
      const width = type.width * size;
      boxes[1][2] = width - boxes[0][2] - boxes[2][2];
      boxes[2][0] = width - boxes[2][2];
    }
    return boxes;
  };

  const addObstacle = () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const type = OBSTACLES[randomNum(0, OBSTACLES.length - 1)];
      // No more than two of a kind in a row, and pterodactyls only at speed.
      let repeats = 0;
      for (const past of game.history) repeats = past === type.type ? repeats + 1 : 0;
      const minSpeed = type.type === "pterodactyl" ? tune("dino").pterodactylSpeed : type.minSpeed;
      if (repeats >= GAME.maxObstacleDuplication || game.speed < minSpeed) continue;

      let size = randomNum(1, GAME.maxObstacleLength);
      if (size > 1 && type.multipleSpeed > game.speed) size = 1;
      const width = type.width * size;
      const boxes = hitboxes(type, size);
      const minGap = Math.round(width * game.speed + type.minGap * tune("dino").gapCoefficient);
      game.obstacles.push({
        type,
        size,
        width,
        boxes,
        x: game.width + type.width,
        y: type.yPos[randomNum(0, type.yPos.length - 1)],
        speedOffset: type.speedOffset ? (Math.random() > 0.5 ? type.speedOffset : -type.speedOffset) : 0,
        gap: randomNum(minGap, Math.round(minGap * GAME.maxGapCoefficient)),
        frame: 0,
        timer: 0,
        followed: false,
        hit: false,
      });
      game.history.unshift(type.type);
      game.history.length = Math.min(game.history.length, GAME.maxObstacleDuplication);
      return;
    }
  };

  const updateObstacles = (dt, spawn = true) => {
    for (const o of game.obstacles) {
      if (o.beat === undefined) o.x -= ((game.speed + o.speedOffset) * dt) / FRAME_MS;
      if (o.type.numFrames && music.flap >= 0) {
        o.frame = music.flap;
      } else if (o.type.numFrames) {
        o.timer += dt;
        if (o.timer >= o.type.frameRate) {
          o.frame = (o.frame + 1) % o.type.numFrames;
          o.timer = 0;
        }
      }
    }
    game.obstacles = game.obstacles.filter((o) => o.x + o.width > 0);
    if (!spawn) return;
    const last = game.obstacles.at(-1);
    if (!last) {
      addObstacle();
    } else if (!last.followed && last.x + last.width + last.gap < game.width) {
      addObstacle();
      last.followed = true;
    }
  };

  const overlaps = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  // The game's check: outer boxes inset by 1, then the detailed hitboxes.
  const collides = (o) => {
    const t = game.trex;
    const tx = t.x + 1;
    const ty = t.y + 1;
    const ox = o.x + 1;
    const oy = o.y + 1;
    if (!overlaps(tx, ty, TREX.width - 2, TREX.height - 2, ox, oy, o.width - 2, o.type.height - 2)) return false;
    return (t.ducking ? TREX.ducking : TREX.running).some(([bx, by, bw, bh]) =>
      o.boxes.some(([cx, cy, cw, ch]) => overlaps(tx + bx, ty + by, bw, bh, ox + cx, oy + cy, cw, ch)),
    );
  };

  const startJump = () => {
    const t = game.trex;
    if (t.jumping || t.ducking) return;
    t.velocity = TREX.initialJumpVelocity - game.speed / 10;
    t.jumping = true;
    t.reachedMinHeight = false;
    t.speedDrop = false;
    setStatus("jumping");
  };

  const endJump = () => {
    const t = game.trex;
    if (t.reachedMinHeight && t.velocity < TREX.dropVelocity) t.velocity = TREX.dropVelocity;
  };

  const duck = (on) => {
    const t = game.trex;
    if (on === t.ducking || t.jumping) return;
    t.ducking = on;
    setStatus(on ? "ducking" : "running");
  };

  // Frames a held jump needs to lift his feet `height` units off the ground.
  const framesToHeight = (height) => {
    const v = -TREX.initialJumpVelocity + game.speed / 10;
    return (v - Math.sqrt(Math.max(0, v * v - 2 * TREX.gravity * height))) / TREX.gravity;
  };

  // Jumps cacti and low pterodactyls as late as is safe (a short hop for the
  // close-together ones), and ducks the ones at head height.
  const autopilot = () => {
    const t = game.trex;
    const next = game.obstacles.find((o) => o.x + o.width > t.x);
    if (!next || next.y <= 50) {
      duck(false);
      return;
    }
    const speed = game.speed + next.speedOffset;
    const gap = next.x - (t.x + TREX_FRONT);
    if (next.y === 75) {
      duck(gap < speed * 6);
      return;
    }
    duck(false);
    // A short hop, like tapping Up in the real game: let go right away, and
    // once the cactus is behind him, press Down to drop back fast.
    if (t.jumping && t.hop) {
      endJump();
      const over = game.obstacles.some((o) => o.x < t.x + TREX.width && o.x + o.width > t.x);
      if (!over && t.velocity > 0) t.speedDrop = true;
    }
    const height = next.type.type === "pterodactyl" ? 34 : next.type.height;
    if (!t.jumping && gap > -20 && gap <= speed * (framesToHeight(height) + 1.5)) {
      t.hop = Boolean(next.hop);
      startJump();
    }
  };

  const updateTrex = (dt) => {
    const t = game.trex;
    if (t.jumping) {
      const frames = dt / FRAME_MS;
      t.y += t.velocity * (t.speedDrop ? TREX.speedDropCoefficient : 1) * frames;
      t.velocity += TREX.gravity * frames;
      if (t.y < TREX.groundY - TREX.minJumpHeight || t.speedDrop) t.reachedMinHeight = true;
      // Held jumps top out: the game caps upward speed near the ceiling.
      if (t.y < TREX.maxJumpHeight || t.speedDrop) endJump();
      if (t.y > TREX.groundY) {
        Object.assign(t, { y: TREX.groundY, velocity: 0, jumping: false, speedDrop: false });
        setStatus("running");
        // Dropped out of a jump with Down held: land in a duck.
        if (keys.duck && game.manual) duck(true);
      }
    } else if (t.status === "waiting") {
      setStatus("running");
    }
    t.timer += dt;
    const anim = ANIM[t.status];
    if (t.timer >= anim.ms) {
      t.frame = (t.frame + 1) % anim.frames.length;
      t.timer = 0;
    }
  };

  // Paused: stand still and blink now and then, like the game before you start.
  const idle = (now) => {
    const t = game.trex;
    if (t.jumping) return; // Hang in the air until the music comes back.
    if (t.status !== "waiting") {
      setStatus("waiting");
      t.ducking = false;
      t.blinkAt = now + Math.ceil(Math.random() * 7000);
    }
    if (now >= t.blinkAt + ANIM.waiting.ms) t.blinkAt = now + Math.ceil(Math.random() * 7000);
    t.frame = now >= t.blinkAt ? 0 : 1;
  };

  const score = () => Math.round(game.distance * SCORE_COEFFICIENT);

  const crash = () => {
    game.crashed = true;
    game.pauseSeen = false;
    game.trex.ducking = false;
    setStatus("crashed");
    if (score() > game.highScore) {
      game.highScore = score();
      saveHighScore(HIGH_SCORE_KEYS.dino, game.highScore);
    }
    player.pause?.();
  };

  const restart = () => {
    game.crashed = false;
    if (game.kind === "flappy") {
      resetFlappy();
      flap();
    } else if (game.kind === "shooter") {
      resetShooter();
    } else {
      resetRun();
      setStatus("running");
    }
    if (state().isPaused) player.resume?.();
  };

  const scrollGround = (distance) => {
    game.horizonX -= distance;
    while (game.horizonX <= -HORIZON.width) {
      game.horizonX += HORIZON.width;
      game.horizonSrc.shift();
      game.horizonSrc.push(randomHorizon());
    }
  };

  const step = (dt, now) => {
    game.time += dt;
    const onBeat = Boolean(game.analysis);
    game.speed = onBeat ? tune("dino").beatSpeed : Math.min(tune("dino").maxSpeed, game.speed + (GAME.acceleration * dt) / FRAME_MS);
    scrollGround((game.speed * dt) / FRAME_MS);
    updateClouds(dt);
    updateFlyby(dt);
    if (onBeat) {
      spawnOnBeats(game.lastSongTime);
      updateObstacles(dt, false);
    } else if (game.time > GAME.clearTime) {
      updateObstacles(dt);
    }
    if (!game.manual) autopilot();
    updateTrex(dt);

    for (const o of game.obstacles) {
      if (o.hit || !collides(o)) continue;
      o.hit = true;
      if (game.manual) {
        crash();
        return;
      }
    }

    if (game.manual) {
      const before = score();
      game.distance += (game.speed * dt) / FRAME_MS;
      if (Math.floor(score() / ACHIEVEMENT_DISTANCE) > Math.floor(before / ACHIEVEMENT_DISTANCE)) game.flashFrom = now;
    }
  };

  // ---- Flappy mode ------------------------------------------------------------
  //
  // An original bird and pipes in the same black and white pixel style
  // (Flappy Bird's own art isn't open source). The player pane grows taller
  // for it. On auto the bird rides the song's playhead and flies itself; on
  // play, Up flaps and hitting a pipe or the ground pauses the song, like the
  // dino. Geometry is in CSS pixels.

  const BIRD = {
    up: [
      "..................",
      ".....#######......",
      "...###########....",
      "..########oooo#...",
      "##########oo#o#...",
      "##########oooo##..",
      "####oooo##########",
      ".##oo##oo######ooo",
      ".#oo#####o########",
      "..#############...",
      "...###########....",
      ".....#######......",
      "..................",
    ],
    down: [
      "..................",
      ".....#######......",
      "...###########....",
      "..########oooo#...",
      "##########oo#o#...",
      "##oo#####ooooo##..",
      "###oo##oo#########",
      ".###oooo#######ooo",
      ".#################",
      "..#############...",
      "...###########....",
      ".....#######......",
      "..................",
    ],
  };
  const BIRD_W = BIRD.up[0].length;
  const BIRD_H = BIRD.up.length;
  // Tuned for the ~200px-tall arena flappy gets: a flap lifts the bird about
  // 36px and gaps are ~3.5 birds tall, close to the original's proportions.
  const BIRD_SCALE = 2;
  const FLAPPY = {
    gravity: 0.18, // px per frame, squared
    flap: -3.6, // px per frame
    maxFall: 4.4,
    pipeWidth: 44,
    capWidth: 52,
    capHeight: 12,
    pipeTop: 8, // just under the pane's top border
    ceiling: 10,
    hitboxInset: 5,
    wingMs: 1000 / 9,
  };

  let birdSprites = null;

  // '#' is the sprite color, 'o' the background color, '.' clear. Drawn once
  // at one pixel per cell, then scaled up without smoothing to stay crisp.
  const pixelSprite = (rows) => {
    const canvas = document.createElement("canvas");
    canvas.width = rows[0].length;
    canvas.height = rows.length;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    rows.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === ".") return;
        g.fillStyle = cell === "o" ? colors.background : colors.text;
        g.fillRect(x, y, 1, 1);
      });
    });
    return canvas;
  };

  const flappy = {
    started: false,
    y: 0,
    velocity: 0,
    pipes: [],
    score: 0,
    highScore: readHighScore(HIGH_SCORE_KEYS.flappy),
    wingUp: true,
    wingTimer: 0,
    plan: null,
    beatNext: -1,
    note: -1,
  };

  // The play area: from the pane's top border down to the ground line, across
  // the width of the ground. Pipes enter from the pane's far right edge, so
  // the autopilot sees them coming even late in a song.
  const arena = () => {
    const left = ground.left * SCALE;
    const right = ground.right * SCALE;
    const birdW = BIRD_W * BIRD_SCALE;
    const birdH = BIRD_H * BIRD_SCALE;
    // On auto the bird rides the playhead; on play it holds a spot near the
    // left, like the original.
    const birdX = game.manual
      ? left + (right - left) * 0.28
      : Math.max(left, Math.min(right - birdW, left + (right - left) * game.fraction - birdW / 2));
    return { left, right, spawn: game.width * SCALE, floor: (ground.offsetY + GROUND_LINE) * SCALE, birdX, birdW, birdH };
  };

  const resetFlappy = () => {
    const a = arena();
    Object.assign(flappy, { started: false, y: (FLAPPY.ceiling + a.floor - a.birdH) / 2, velocity: 0, pipes: [], score: 0, beatNext: -1, note: -1 });
  };

  const flap = () => {
    flappy.started = true;
    flappy.velocity = FLAPPY.flap;
  };

  // A crash in play mode: keep the high score and pause the song.
  const crashGame = (run, key) => {
    game.crashed = true;
    game.pauseSeen = false;
    if (run.score > run.highScore) {
      run.highScore = run.score;
      saveHighScore(key, run.highScore);
    }
    player.pause?.();
  };

  const crashFlappy = () => crashGame(flappy, HIGH_SCORE_KEYS.flappy);

  // With the song's analysis, the beat is the flap rhythm: its tempo, halved
  // or doubled into a comfortable 0.45 to 0.9s, and gravity set so one flap
  // per beat holds the bird level (a flap climbs and falls back in 2 * flap
  // / gravity frames). Without analysis, the game's own gravity.
  const flapBeat = () => {
    if (!game.analysis?.tempo) return null;
    let beat = 60 / game.analysis.tempo;
    while (beat < 0.45) beat *= 2;
    while (beat > 0.9) beat /= 2;
    return beat;
  };
  const flappyGravity = () => {
    const beat = flapBeat();
    return beat ? Math.min(0.3, Math.max(0.12, (-2 * FLAPPY.flap) / (beat * 60))) : FLAPPY.gravity;
  };

  // Aims for a bit below the middle of the next gap and flaps whenever the
  // bird sinks past it, the way a steady player taps. With gravity set by the
  // song, that comes out to about one flap a beat.
  const flappyAutopilot = (a) => {
    const next = flappy.pipes.find((pipe) => pipe.x + FLAPPY.capWidth > a.birdX);
    const target = next ? next.gapTop + tune("flappy").gap / 2 - a.birdH / 2 + 10 : (FLAPPY.ceiling + a.floor - a.birdH) / 2;
    if (flappy.y > target && flappy.velocity >= 0) flap();
  };

  // With the song's analysis, pipes come on the beat: each one reaches the bird
  // on a beat, about the level's spacing apart, placed from the song's clock
  // like the dino's cacti. Their gaps follow the tune, stepping up when the
  // melody climbs and down when it falls.
  const pipeX = (a, beat, t, speed) => a.birdX + a.birdW / 2 - FLAPPY.capWidth / 2 + (beat - t) * speed * 60;

  // How far a pipe's gap may move from the last one's, given the open air
  // between them. Climbing: flapping twice a beat lifts the bird about 100px
  // a second at any tempo, so gaps climb at most 80. Dropping: a bird that
  // just flapped first goes up and back down (2 * flap / gravity frames),
  // then falls under gravity up to its top speed; drops get that plus 20px of
  // slack. Auto can always make it, and play never asks more than a steady
  // player can do.
  const reachable = (top, prev, seconds, min, max) => {
    if (prev === undefined) return top;
    const free = Math.max(0.2, seconds);
    const g = flappyGravity();
    const falling = Math.max(0, free * 60 - (-2 * FLAPPY.flap) / g);
    const climb = 80 * free;
    const drop = 20 + Math.min(-FLAPPY.flap * falling + 0.5 * g * falling * falling, FLAPPY.maxFall * falling);
    return Math.max(min, Math.min(max, prev + drop, Math.max(prev - climb, top)));
  };

  const melodyGap = (an, beat, gap, a, speed) => {
    const min = FLAPPY.ceiling + 10;
    const max = a.floor - 10 - gap;
    const pitches = an.segments[indexAt(an.segments, beat)].pitches ?? [];
    const note = pitches.length ? pitches.indexOf(Math.max(...pitches)) : randomNum(0, 11);
    // Semitones up or down the short way round, -6 to 5.
    const step = flappy.note < 0 ? 0 : ((((note - flappy.note) % 12) + 18) % 12) - 6;
    flappy.note = note;
    const prev = flappy.pipes.at(-1);
    const last = prev?.gapTop ?? (min + max) / 2;
    const next = last - (step * (max - min)) / 10 + ((min + max) / 2 - last) * 0.2 + (Math.random() - 0.5) * (max - min) * 0.12;
    const free = prev ? beat - prev.beat - FLAPPY.capWidth / (speed * 60) : 1;
    return reachable(Math.max(min, Math.min(max, next)), prev?.gapTop, free, min, max);
  };

  const beatPipes = (a, gap, speed, spacing) => {
    const an = game.analysis;
    const t = game.lastSongTime;
    const target = spacing / (speed * 60) / (60 / (an.tempo || 120));
    const every = [1, 2, 3, 4, 6, 8].find((n) => n >= target * 0.85) ?? 8;
    if (flappy.plan?.analysis !== an || flappy.plan.every !== every) {
      // Every nth beat from the first bar, none skipped: quiet parts and chill
      // songs keep their pipes.
      const phase = Math.max(0, an.beats.findIndex((b) => b.t >= (an.bars[0] ?? 0) - 0.05));
      flappy.plan = { analysis: an, every, times: an.beats.filter((b, i) => i >= phase && (i - phase) % every === 0).map((b) => b.t) };
      flappy.beatNext = -1;
    }
    const times = flappy.plan.times;
    // New song, seek or level: start the pipes over from here.
    if (flappy.beatNext < 0) {
      flappy.pipes = [];
      flappy.beatNext = 0;
      while (flappy.beatNext < times.length && times[flappy.beatNext] < t) flappy.beatNext++;
    }
    for (const pipe of flappy.pipes) pipe.x = pipeX(a, pipe.beat, t, speed);
    while (flappy.beatNext < times.length) {
      const beat = times[flappy.beatNext];
      const x = pipeX(a, beat, t, speed);
      if (x > a.spawn) break;
      flappy.beatNext++;
      if (x < a.right) continue; // Would pop in on screen.
      flappy.pipes.push({ x, beat, gapTop: melodyGap(an, beat, gap, a, speed), scored: false, hit: false });
    }
  };

  const flappyStep = (dt, now) => {
    const frames = dt / FRAME_MS;
    const a = arena();
    // The sky and ground keep moving at the pipes' pace.
    updateClouds(dt);
    const { gap, speed, spacing } = tune("flappy");
    scrollGround((speed / SCALE) * frames);
    // Wings beat four times a beat with the song, else on their own clock.
    if (music.beat >= 0) {
      flappy.wingUp = Math.floor(music.phase * 4) % 2 === 0;
    } else {
      flappy.wingTimer += dt;
      if (flappy.wingTimer >= FLAPPY.wingMs) {
        flappy.wingUp = !flappy.wingUp;
        flappy.wingTimer = 0;
      }
    }
    // Busy songs blow gusts of wind past.
    updateFlyby(dt, speed * 3.5);
    if (!flappy.started) {
      if (!game.manual) {
        flap();
      } else {
        // Hover until the first flap, like the original's get-ready screen.
        flappy.y = (FLAPPY.ceiling + a.floor - a.birdH) / 2 + Math.sin(now / 220) * 3;
        return;
      }
    }

    if (game.analysis) beatPipes(a, gap, speed, spacing);
    else for (const pipe of flappy.pipes) pipe.x -= speed * frames;
    flappy.pipes = flappy.pipes.filter((pipe) => pipe.x + FLAPPY.capWidth > a.left);
    const last = flappy.pipes.at(-1);
    if (!game.analysis && (!last || last.x < a.spawn - spacing)) {
      const min = FLAPPY.ceiling + 10;
      const max = a.floor - 10 - gap;
      const free = (spacing - FLAPPY.capWidth) / (speed * 60);
      const top = reachable(min + Math.random() * Math.max(0, max - min), last?.gapTop, free, min, max);
      flappy.pipes.push({ x: a.spawn, gapTop: top, scored: false, hit: false });
    }

    if (!game.manual) flappyAutopilot(a);
    flappy.velocity = Math.min(FLAPPY.maxFall, flappy.velocity + flappyGravity() * frames);
    flappy.y = Math.max(FLAPPY.ceiling, flappy.y + flappy.velocity * frames);

    // The hitbox is the bird inset a few pixels, so grazing a pipe isn't a crash.
    const bx = a.birdX + FLAPPY.hitboxInset;
    const by = flappy.y + FLAPPY.hitboxInset;
    const bw = a.birdW - FLAPPY.hitboxInset * 2;
    const bh = a.birdH - FLAPPY.hitboxInset * 2;
    for (const pipe of flappy.pipes) {
      if (!pipe.scored && pipe.x + FLAPPY.capWidth < a.birdX) {
        pipe.scored = true;
        flappy.score++;
      }
      const inColumn = bx < pipe.x + FLAPPY.capWidth && bx + bw > pipe.x;
      if (!pipe.hit && inColumn && (by < pipe.gapTop || by + bh > pipe.gapTop + gap)) {
        if (game.manual) {
          crashFlappy();
          return;
        }
        pipe.hit = true;
      }
    }
    if (flappy.y + a.birdH - FLAPPY.hitboxInset >= a.floor) {
      if (game.manual) {
        crashFlappy();
      } else {
        flappy.y = a.floor - a.birdH;
        flappy.velocity = 0;
      }
    }
  };

  const drawPipes = (ctx, dpr) => {
    const a = arena();
    const inset = (FLAPPY.capWidth - FLAPPY.pipeWidth) / 2;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(a.left, 0, a.right - a.left, a.floor);
    ctx.clip();
    for (const pipe of flappy.pipes) {
      const top = pipe.gapTop;
      const bottom = pipe.gapTop + tune("flappy").gap;
      ctx.fillStyle = colors.text;
      ctx.fillRect(pipe.x + inset, FLAPPY.pipeTop, FLAPPY.pipeWidth, top - FLAPPY.pipeTop);
      ctx.fillRect(pipe.x, top - FLAPPY.capHeight, FLAPPY.capWidth, FLAPPY.capHeight);
      ctx.fillRect(pipe.x, bottom, FLAPPY.capWidth, FLAPPY.capHeight);
      ctx.fillRect(pipe.x + inset, bottom, FLAPPY.pipeWidth, a.floor - bottom);
      // Pixel-art shine and the seam under each cap, in the background color.
      ctx.fillStyle = colors.background;
      ctx.fillRect(pipe.x + inset + 8, FLAPPY.pipeTop, 4, top - FLAPPY.capHeight - FLAPPY.pipeTop);
      ctx.fillRect(pipe.x + inset + 8, bottom + FLAPPY.capHeight, 4, a.floor - bottom - FLAPPY.capHeight);
      ctx.fillRect(pipe.x + 6, top - FLAPPY.capHeight + 2, 4, FLAPPY.capHeight - 4);
      ctx.fillRect(pipe.x + 6, bottom + 2, 4, FLAPPY.capHeight - 4);
      ctx.fillRect(pipe.x + inset, top - FLAPPY.capHeight - 2, FLAPPY.pipeWidth, 2);
      ctx.fillRect(pipe.x + inset, bottom + FLAPPY.capHeight, FLAPPY.pipeWidth, 2);
    }
    ctx.restore();
  };

  const drawBird = (ctx, dpr) => {
    const a = arena();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(flappy.wingUp ? birdSprites.up : birdSprites.down, Math.round(a.birdX), Math.round(flappy.y), a.birdW, a.birdH);
    ctx.restore();
  };

  // ---- Music: beats, loudness and notes from Spotify's audio analysis ---------
  //
  // Spotify still serves each song's analysis to the desktop client when asked
  // with its own app headers. It's pre-computed, but played back against the
  // song's position it follows the music closely: the dino nods on every beat,
  // pterodactyls flap in time, busy songs send speed streaks past, and his
  // course is timed so jumps land on the beat, Geometry Dash style.
  // Nothing here can hear the audio itself; Spotify decodes it where themes
  // can't reach.

  const fetchAnalysis = async (id) => {
    try {
      const P = S.Platform;
      const res = await fetch(`https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${id}?format=json`, {
        headers: {
          Authorization: `Bearer ${P.AuthorizationAPI?.getState?.()?.token?.accessToken}`,
          "Spotify-App-Version": P.version,
          "App-Platform": P.PlatformData?.app_platform ?? "OSX",
        },
      });
      if (!res.ok) return null;
      const a = await res.json();
      const segments = (a.segments ?? []).map((s) => ({ t: s.start, loud: s.loudness_max, pitches: s.pitches }));
      if (!segments.length || !a.beats?.length) return null;
      const sorted = segments.map((s) => s.loud).sort((p, q) => p - q);
      return {
        tempo: a.track?.tempo ?? 0,
        beats: a.beats.map((b) => ({ t: b.start, d: b.duration, confidence: b.confidence })),
        bars: (a.bars ?? []).map((b) => b.start),
        sections: (a.sections ?? []).map((sec) => ({ t: sec.start, end: sec.start + sec.duration, loud: sec.loudness })),
        segments,
        // Anything well under the song's typical level counts as a quiet part.
        quiet: sorted[Math.floor(sorted.length / 2)] - 8,
      };
    } catch {
      return null;
    }
  };

  const tempoLevel = (bpm) => (bpm < 100 ? "easy" : bpm > 135 ? "hard" : "medium");

  // Index of the last item starting at or before t.
  const indexAt = (items, t) => {
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (items[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // energy: how loud the song is right now, 0 to 1. busy: how loud, fast and
  // dense it is, 0 to 1, eased so it swells rather than jumps. Calm songs sit
  // near 0 and loud, fast, packed ones reach 1. nod: how far
  // down the dino's head is, in pixels. flap: the wing frame for pterodactyls,
  // which beat twice a beat, or -1 to use the game's own timing.
  // beat and phase: which beat the song is on and how far through it (beat is
  // -1 without analysis or while paused); beatLen is its length in seconds.
  const music = { energy: 0.5, busy: 0, nod: 0, flap: -1, beat: -1, phase: 0, beatLen: 0.5 };
  const NOD = [4, 4, 3, 3, 2, 1, 1]; // Pixels down, by eighths of a beat.

  const updateMusic = (t, dt, playing) => {
    const a = game.analysis;
    music.nod = 0;
    music.flap = -1;
    music.beat = -1;
    if (!a) music.busy = 0;
    if (!a || !playing || reduceMotion) return;
    const seg = a.segments[indexAt(a.segments, t)];
    music.energy = Math.min(1, Math.max(0, (seg.loud + 30) / 28));
    const b = indexAt(a.beats, t);
    const beat = a.beats[b];
    const phase = (t - beat.t) / (beat.d || 0.5);
    if (phase >= 0) {
      music.beat = b;
      music.phase = Math.min(phase, 0.999);
      music.beatLen = beat.d || 0.5;
      music.nod = NOD[Math.floor(phase * 8)] ?? 0;
      music.flap = Math.floor(phase * 2) % 2;
    }
    // Sounds per second around now: busy songs change sound constantly.
    const sounds = (indexAt(a.segments, t + 1.5) - indexAt(a.segments, t - 1.5)) / 3;
    const fast = Math.min(1, Math.max(0, (a.tempo - 85) / 70));
    const dense = Math.min(1, Math.max(0, (sounds - 2.5) / 5));
    // Raw scores bunch up between 0.3 and 0.7 across real songs; spread them.
    const raw = music.energy * (0.3 + 0.7 * (fast + dense) / 2);
    const target = Math.min(1, Math.max(0, (raw - 0.3) / 0.38));
    music.busy += (target - music.busy) * Math.min(1, dt / 800);
  };

  // Which beats get an obstacle: about one per level's spacing, landing on
  // downbeats where it can, and none in the quiet parts.
  // The song's loud sections (a dB above its average section) double the
  // course: an obstacle on every beat instead of every other, as long as the
  // beat leaves room for a short hop (HOP_S). Faster songs keep the spacing.
  const HOP_S = 0.48;
  const planBeats = (a, lvl) => {
    const beatLen = 60 / (a.tempo || 120);
    const every = [1, 2, 4, 8].find((n) => n * beatLen >= LEVELS.dino[lvl].beatSpacing) ?? 8;
    const levels = (a.sections ?? []).map((sec) => sec.loud);
    const typical = levels.reduce((sum, v) => sum + v, 0) / Math.max(1, levels.length);
    const doubled = every > 1 && (every / 2) * beatLen >= HOP_S;
    const loud = (t) => doubled && (a.sections ?? []).some((sec) => t >= sec.t && t < sec.end && sec.loud > typical + 1);
    return beatTimes(a, every, (t) => (loud(t) ? every / 2 : every));
  };

  // Every nth beat from the first bar, skipping unsure beats and quiet parts.
  const beatTimes = (a, every, stepAt = () => every) => {
    const phase = Math.max(0, a.beats.findIndex((b) => b.t >= (a.bars[0] ?? 0) - 0.05));
    return a.beats
      .filter((b, i) => i >= phase && (i - phase) % stepAt(b.t) === 0 && b.confidence > 0.15 && a.segments[indexAt(a.segments, b.t)].loud > a.quiet)
      .map((b) => b.t);
  };

  // Places each obstacle so the dino takes off exactly on its beat: it jumps
  // when an obstacle is a jump's length away, so work back from there. Their
  // positions come from the song's clock every frame, so dropped frames or a
  // busy app can't pull the course off the beat.
  const beatX = (o, t) => game.trex.x + TREX_FRONT + o.lead + game.speed * 60 * (o.beat - t);

  const spawnOnBeats = (t) => {
    for (const o of game.obstacles) if (o.beat !== undefined) o.x = beatX(o, t);
    const lvl = level();
    if (game.beatPlan?.analysis !== game.analysis || game.beatPlan.level !== lvl) {
      game.beatPlan = { analysis: game.analysis, level: lvl, times: planBeats(game.analysis, lvl) };
      game.beatNext = -1;
    }
    const times = game.beatPlan.times;
    // New song, seek or level: start the course over from here.
    if (game.beatNext < 0) {
      game.obstacles = game.obstacles.filter((o) => o.beat === undefined);
      game.beatNext = 0;
      while (game.beatNext < times.length && times[game.beatNext] < t + 0.3) game.beatNext++;
    }
    const [small, large, pterodactyl] = OBSTACLES;
    const birdChance = { easy: 0, medium: 0.12, hard: 0.24 }[lvl] * (0.5 + music.busy);
    while (game.beatNext < times.length) {
      const beat = times[game.beatNext];
      // Too close to the one before or after for a full jump: a single small
      // cactus, which the dino clears with a short hop.
      const hop = beat - (times[game.beatNext - 1] ?? -Infinity) < 0.75 || (times[game.beatNext + 1] ?? Infinity) - beat < 0.75;
      const bird = !hop && Math.random() < birdChance;
      const type = bird ? pterodactyl : hop || Math.random() < 0.6 ? small : large;
      const size = !bird && !hop && lvl !== "easy" && Math.random() < 0.35 ? 2 : 1;
      // Birds fly low (jump them) or at head height (duck them), never overhead.
      const y = bird ? type.yPos[randomNum(0, 1)] : type.yPos[0];
      // When the dino reacts, it should be on the beat: low ones he jumps,
      // middle ones he ducks under from a little way off.
      const lead = !bird ? game.speed * (framesToHeight(type.height) + 1.5) : y === 100 ? game.speed * (framesToHeight(34) + 1.5) : game.speed * 6;
      const o = { type, size, width: type.width * size, boxes: hitboxes(type, size), beat, lead, y, hop, speedOffset: 0, gap: 0, frame: 0, timer: 0, followed: true, hit: false };
      o.x = beatX(o, t);
      if (o.x > game.width + 40) break; // Not due on screen yet.
      game.beatNext++;
      if (beat - t < 0.25) continue; // Too close to place fairly.
      game.obstacles.push(o);
    }
  };

  // ---- Busy songs: stuff flying past the dino ------------------------------------
  //
  // The louder, faster and denser the song gets, the more speed streaks tear
  // past.

  const flyby = { streaks: [] };

  const resetFlyby = () => {
    flyby.streaks = [];
  };

  const updateFlyby = (dt, speed = game.speed) => {
    const move = (speed * dt) / FRAME_MS;
    for (const s of flyby.streaks) s.x -= move * s.speed;
    flyby.streaks = flyby.streaks.filter((s) => s.x + s.length > 0);
    const busy = music.busy;
    // Per second: none when calm, up to ~40 streaks when wild.
    const streakRate = 40 * busy ** 1.5;
    // A chance each frame, so a song that picks up gets busy right away.
    if (Math.random() < (streakRate * dt) / 1000) {
      flyby.streaks.push({ x: game.width, y: randomNum(8, GROUND_LINE - 6), length: randomNum(10, 16 + 44 * busy), speed: 1.6 + Math.random() * 1.6, alpha: 0.2 + Math.random() * 0.35 });
    }
  };

  const drawFlyby = (ctx) => {
    ctx.save();
    // Streaks stay on the stage, clear of the song title and the controls.
    ctx.beginPath();
    ctx.rect(ground.left - 220, -HEIGHT, ground.right - ground.left + 440, HEIGHT * 3);
    ctx.clip();
    ctx.fillStyle = colors.text;
    for (const s of flyby.streaks) {
      ctx.globalAlpha = s.alpha;
      ctx.fillRect(s.x, s.y, s.length, 1);
    }
    ctx.restore();
  };

  // ---- Lyrics, on the top border --------------------------------------------------
  //
  // One line at a time, in the stretch of the top border between the volume
  // and the game switches (placeSwitches sizes it). It only touches the page
  // when the line changes.

  const lyricBar = el("div", "tty-lyricbar");
  const lyricText = el("span", "tty-lyricbar-text");
  lyricBar.append(lyricText);
  const lyricsView = { lyrics: undefined, current: -2 };

  const setLyric = (text, kind = "") => {
    if (lyricText.textContent === text && lyricText.dataset.kind === kind) return;
    lyricText.textContent = text;
    lyricText.dataset.kind = kind;
    lyricText.title = text;
    // Replay the fade-in for each new line.
    lyricText.classList.remove("is-new");
    void lyricText.offsetWidth;
    lyricText.classList.add("is-new");
  };

  // null while fetching; { synced, lines } once known.
  const showLyrics = (lyrics) => {
    if (lyrics === lyricsView.lyrics) return;
    lyricsView.lyrics = lyrics;
    lyricsView.current = -2;
    if (!lyrics) setLyric("fetching lyrics...", "note");
    else if (!lyrics.lines.length) setLyric("no lyrics for this one", "note");
  };

  const updateLyrics = (ms, fraction) => {
    const lyrics = lyricsView.lyrics;
    if (!lyrics?.lines.length) return;
    const lines = lyrics.lines;
    // Synced: the last line that has started. Unsynced: follow the song's
    // progress through the words.
    let current;
    if (lyrics.synced) {
      current = -1;
      while (current + 1 < lines.length && lines[current + 1].t <= ms) current++;
    } else {
      current = Math.min(lines.length - 1, Math.floor(fraction * lines.length));
    }
    if (current === lyricsView.current) return;
    lyricsView.current = current;
    setLyric(current < 0 ? "♪" : lines[current].text || "♪", lyrics.synced ? "" : "unsynced");
  };

  // ---- Song index: tempo and key for every song -----------------------------------
  //
  // Spotify's Mix feature knows each song's BPM and key. The desktop client
  // asks for them in batches, as "extended metadata" in protobuf, and this
  // asks the same way: a few hundred songs per request. Answers are kept in
  // localStorage, so each song is only asked about once. The up-next pane
  // asks first; Liked Songs fill in behind it, a batch every 1.5 seconds.
  //
  // The same request brings each song's tags: Spotify's own genre and mood
  // labels, each with a weight, like "house 0.94" or "chill 0.53". They are
  // what lets the console search by genre.

  const INDEX_KEY = "tty-song-index-v1";
  const AUDIO_ATTRIBUTES = 222; // Spotify's number for the BPM-and-key record.
  const songIndex = new Map(); // track id -> [bpm, key on the Camelot wheel], e.g. [174.9, "3A"]
  try {
    for (const [id, facts] of Object.entries(JSON.parse(localStorage.getItem(INDEX_KEY) ?? "{}"))) songIndex.set(id, facts);
  } catch {}
  const indexMisses = new Set(); // Songs Spotify has no numbers for. Asked again next session.

  const DESCRIPTORS = 6; // Spotify's number for a song's genre and mood tags.
  const TAGS_KEY = "tty-song-tags-v1";
  const tagNames = []; // Every tag seen, as [name, kind]: "g" a genre, "m" a mood, "o" anything else.
  const tagNumber = new Map(); // name -> its place in tagNames
  const songTags = new Map(); // track id -> [tag number, weight 0-100, tag number, weight, ...], strongest first
  try {
    const saved = JSON.parse(localStorage.getItem(TAGS_KEY) ?? "{}");
    for (const entry of saved.names ?? []) {
      tagNumber.set(entry[0], tagNames.length);
      tagNames.push(entry);
    }
    for (const [id, tags] of Object.entries(saved.songs ?? {})) songTags.set(id, tags);
  } catch {}
  const wantedNow = new Set();
  const wantedLater = new Set();
  let indexBusy = false;
  let indexDelay = 1500;

  // Just enough protobuf to write the request and read the reply.
  const pbVarint = (n) => {
    const out = [];
    while (n > 127) {
      out.push((n & 127) | 128);
      n = Math.floor(n / 128);
    }
    out.push(n);
    return out;
  };
  const pbField = (num, bytes) => [...pbVarint((num << 3) | 2), ...pbVarint(bytes.length), ...bytes];
  const pbText = (num, text) => pbField(num, [...new TextEncoder().encode(text)]);
  const pbRead = (buf) => {
    const fields = [];
    let p = 0;
    const varint = () => {
      let n = 0;
      let scale = 1;
      let byte;
      do {
        byte = buf[p++];
        n += (byte & 127) * scale;
        scale *= 128;
      } while (byte & 128 && p < buf.length);
      return n;
    };
    while (p < buf.length) {
      const tag = varint();
      const num = Math.floor(tag / 8);
      const type = tag & 7;
      if (type === 0) fields.push([num, varint()]);
      else if (type === 1) {
        fields.push([num, new DataView(buf.buffer, buf.byteOffset + p, 8).getFloat64(0, true)]);
        p += 8;
      } else if (type === 2) {
        const length = varint();
        fields.push([num, buf.subarray(p, p + length)]);
        p += length;
      } else if (type === 5) {
        fields.push([num, new DataView(buf.buffer, buf.byteOffset + p, 4).getFloat32(0, true)]);
        p += 4;
      } else break;
    }
    return fields;
  };
  const pbAll = (fields, num) => fields.filter(([n]) => n === num).map(([, value]) => value);
  const pbString = (bytes) => (bytes ? new TextDecoder().decode(bytes) : "");

  // Tempo and key, and tags, for a batch of songs. Returns { facts, tags }, each a Map by track id.
  const fetchSongRecords = async (ids) => {
    const body = new Uint8Array(
      ids.flatMap((id) => pbField(2, [...pbText(1, `spotify:track:${id}`), ...pbField(2, [8, ...pbVarint(AUDIO_ATTRIBUTES)]), ...pbField(2, [8, ...pbVarint(DESCRIPTORS)])])),
    );
    const res = await fetch("https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${S.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken}`,
        "Content-Type": "application/protobuf",
      },
      body,
    });
    if (!res.ok) throw new Error(`song records: ${res.status}`);
    const facts = new Map();
    const tags = new Map();
    // Reply > one list per kind of record > one entry per song > the record, wrapped.
    for (const list of pbAll(pbRead(new Uint8Array(await res.arrayBuffer())), 2)) {
      const fields = pbRead(list);
      const kind = pbAll(fields, 2)[0];
      for (const entry of pbAll(fields, 3)) {
        const parts = pbRead(entry);
        const id = pbString(pbAll(parts, 2)[0]).split(":").pop();
        const wrapped = pbAll(parts, 3)[0];
        const record = wrapped && pbAll(pbRead(wrapped), 2)[0];
        if (!id || !record) continue;
        if (kind === AUDIO_ATTRIBUTES) {
          const attributes = pbRead(record);
          const bpm = pbAll(attributes, 1)[0] ?? 0;
          const key = pbAll(attributes, 2)[0];
          const camelot = key && pbAll(pbRead(key), 3)[0];
          const wheel = camelot ? pbString(pbAll(pbRead(camelot), 1)[0]) : "";
          if (bpm > 0 || wheel) facts.set(id, [Math.round(bpm * 10) / 10, wheel]);
        } else if (kind === DESCRIPTORS) {
          // Each tag: its name, a weight from 0 to 1, and what sort of tag it is (1 a genre, 2 a mood).
          const found = pbAll(pbRead(record), 1).map((raw) => {
            const tag = pbRead(raw);
            const sorts = pbAll(tag, 3).flatMap((sort) => (sort instanceof Uint8Array ? [...sort] : [sort]));
            return { name: pbString(pbAll(tag, 1)[0]).toLowerCase(), weight: pbAll(tag, 2)[0] ?? 0, kind: sorts.includes(1) ? "g" : sorts.includes(2) ? "m" : "o" };
          });
          const kept = found.filter((tag) => tag.name && tag.weight >= 0.45).sort((a, b) => b.weight - a.weight).slice(0, 10);
          tags.set(
            id,
            kept.flatMap((tag) => {
              if (!tagNumber.has(tag.name)) {
                tagNumber.set(tag.name, tagNames.length);
                tagNames.push([tag.name, tag.kind]);
              }
              return [tagNumber.get(tag.name), Math.round(tag.weight * 100)];
            }),
          );
        }
      }
    }
    return { facts, tags };
  };

  const saveIndex = () => {
    // Past 30,000 songs, the oldest entries go first.
    if (songIndex.size > 30000) for (const id of [...songIndex.keys()].slice(0, songIndex.size - 25000)) songIndex.delete(id);
    for (const id of songTags.keys()) if (!songIndex.has(id) && songTags.size > 30000) songTags.delete(id);
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(Object.fromEntries(songIndex)));
      localStorage.setItem(TAGS_KEY, JSON.stringify({ names: tagNames, songs: Object.fromEntries(songTags) }));
    } catch {}
  };

  const pumpIndex = async () => {
    if (indexBusy || (!wantedNow.size && !wantedLater.size)) return;
    indexBusy = true;
    const ids = [...wantedNow, ...wantedLater].slice(0, 200);
    try {
      const found = await fetchSongRecords(ids);
      for (const id of ids) {
        wantedNow.delete(id);
        wantedLater.delete(id);
        if (found.facts.has(id)) songIndex.set(id, found.facts.get(id));
        else if (!songIndex.has(id)) indexMisses.add(id);
        songTags.set(id, found.tags.get(id) ?? []);
      }
      saveIndex();
      indexDelay = 1500;
      queueSignature = null; // Redraw up next with the new numbers.
    } catch {
      indexDelay = Math.min(indexDelay * 4, 600000); // Back off, up to 10 minutes.
    }
    indexBusy = false;
    if (wantedNow.size || wantedLater.size) setTimeout(pumpIndex, wantedNow.size ? 300 : indexDelay);
  };

  const trackId = (uri) => (/^spotify:track:([A-Za-z0-9]{22})$/.exec(uri ?? "") ?? [])[1];
  const songFacts = (uri) => songIndex.get(trackId(uri));
  // A song's tags, strongest first: [{ name: "house", kind: "g", weight: 0.94 }, ...]
  const tagsOf = (uri) => {
    const pairs = songTags.get(trackId(uri)) ?? [];
    const tags = [];
    for (let i = 0; i < pairs.length; i += 2) tags.push({ name: tagNames[pairs[i]][0], kind: tagNames[pairs[i]][1], weight: pairs[i + 1] / 100 });
    return tags;
  };

  const wantSongs = (uris, now) => {
    let added = false;
    for (const uri of uris) {
      const id = trackId(uri);
      if (!id || (songIndex.has(id) && songTags.has(id)) || indexMisses.has(id)) continue;
      const wanted = now ? wantedNow : wantedLater;
      if (!wanted.has(id)) added = true;
      wanted.add(id);
    }
    if (added && !indexBusy) setTimeout(pumpIndex, now ? 0 : indexDelay);
  };

  // Liked Songs, a page at a time. Only songs not yet in the index are asked about.
  const indexLibrary = async () => {
    try {
      for (let offset = 0; ; offset += 500) {
        const page = await S.Platform.LibraryAPI?.getTracks?.({ limit: 500, offset });
        const items = page?.items ?? [];
        wantSongs(items.map((item) => item.uri), false);
        if (items.length < 500) break;
      }
    } catch {}
  };
  setTimeout(indexLibrary, 20000);

  // ---- Up next, on the right -----------------------------------------------------
  //
  // The next tracks from the player's own queue, in a pane matching the one
  // around the cover. Songs you queued yourself get a lit number. Click one
  // to jump to it, the way Spotify's own queue does (skipTo with its uid).

  const queueBox = el("div", "tty-queue");
  queueBox.setAttribute("aria-label", "Up next");
  const queueList = el("ol", "tty-queue-list");
  // On the pane's top border: the smooth command, then the playing song's BPM and key.
  const queueBar = el("div", "tty-queue-bar");
  const smoothButton = el("button", "tty-queue-smooth", "smooth");
  smoothButton.type = "button";
  const queueNow = el("span", "tty-queue-now");
  queueBar.append(smoothButton, queueNow);
  queueBox.append(queueBar, queueList);
  let queueSignature = null;

  // "175  3A": tempo in beats per minute, then the key's place on the Camelot
  // wheel, where neighbouring numbers and the same number mix cleanly.
  const mixLabel = (facts) => {
    const mix = el("span", "tty-queue-mix");
    mix.append(el("span", "tty-queue-bpm", facts[0] ? String(Math.round(facts[0])) : ""), el("span", "tty-queue-key", facts[1] ?? ""));
    return mix;
  };

  // How well one song runs into the next, from the two things a DJ matches.
  //   Tempo: within 6% is close enough to beatmatch. Half and double time
  //   count as the same tempo, since 87 and 174 share a beat.
  //   Key: the same spot on the Camelot wheel, one step round it, or its
  //   major/minor twin.
  // "clean" fits on both, "rough" on neither. The cost is what smooth adds up.
  const transition = (from, to) => {
    let tempo = null;
    if (from?.[0] && to?.[0]) {
      const octaves = Math.abs(Math.log2(to[0] / from[0])) % 1;
      tempo = 2 ** Math.min(octaves, 1 - octaves) - 1; // 0.06 = 6% apart
    }
    let key = null;
    const a = /^(\d+)([AB])$/.exec(from?.[1] ?? "");
    const b = /^(\d+)([AB])$/.exec(to?.[1] ?? "");
    if (a && b) {
      const steps = Math.min((a[1] - b[1] + 12) % 12, (b[1] - a[1] + 12) % 12);
      key = steps === 0 ? (a[2] === b[2] ? 0 : 0.4) : steps === 1 && a[2] === b[2] ? 0.4 : 2;
    }
    const tempoFits = tempo !== null && tempo <= 0.06;
    const keyFits = key !== null && key < 2;
    return {
      keyFits,
      cost: (tempo === null ? 1.5 : Math.min(tempo / 0.04, 3)) + (key ?? 1.5),
      grade: tempoFits && keyFits ? "clean" : tempo !== null && key !== null && !tempoFits && !keyFits ? "rough" : "",
    };
  };

  // The order of `songs` that runs smoothest after `first`. Start with the
  // nearest song each time, then keep flipping stretches and moving single
  // songs while the total gets lower. Thirty songs take a few milliseconds.
  const smoothest = (first, songs) => {
    const cost = (a, b) => transition(a?.facts, b?.facts).cost;
    const total = (order) => order.reduce((sum, song, i) => sum + cost(i ? order[i - 1] : first, song), 0);
    let order = [];
    const left = [...songs];
    let last = first;
    while (left.length) {
      let best = 0;
      for (let i = 1; i < left.length; i += 1) if (cost(last, left[i]) < cost(last, left[best]) - 1e-9) best = i;
      last = left.splice(best, 1)[0];
      order.push(last);
    }
    let score = total(order);
    for (let pass = 0, improved = true; improved && pass < 40; pass += 1) {
      improved = false;
      for (let i = 0; i < order.length; i += 1) {
        for (let j = 0; j < order.length; j += 1) {
          if (i === j) continue;
          const flipped = i < j ? [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)] : null;
          const moved = [...order];
          moved.splice(j, 0, moved.splice(i, 1)[0]);
          for (const candidate of [flipped, moved]) {
            if (!candidate) continue;
            const candidateScore = total(candidate);
            if (candidateScore < score - 1e-9) {
              order = candidate;
              score = candidateScore;
              improved = true;
            }
          }
        }
      }
    }
    // Leave the queue alone unless the gain is real.
    return score < total(songs) - 0.5 ? order : songs;
  };

  // The upcoming songs smooth works on: the next 30, split into the songs
  // you queued yourself and the ones coming from the playlist or album.
  // Spotify plays queued songs first, so each group is ordered on its own.
  const SMOOTH_WINDOW = 30;
  const upcoming = () => (state().nextItems ?? []).filter((item) => /^spotify:(track|episode|local):/.test(item?.uri ?? ""));
  const withFacts = (item) => ({ item, facts: songFacts(item.uri) });
  const sameSong = (a, b) => (a?.uid && b?.uid ? a.uid === b.uid : a?.uri === b?.uri);
  const smoothGroups = () => {
    const next = upcoming();
    const ahead = next.slice(0, SMOOTH_WINDOW);
    const queued = [];
    while (queued.length < ahead.length && ahead[queued.length].provider === "queue") queued.push(ahead[queued.length]);
    const rest = ahead.slice(queued.length);
    // Spotify finds a song to move by its queue id, or by its address when it
    // has none. A song that can't be told apart from another copy stays put.
    const count = (value, of) => next.filter((item) => of(item) === value).length;
    const distinct = (item) => (item.uid ? count(item.uid, (other) => other.uid) === 1 : count(item.uri, (other) => other.uri) === 1);
    return [
      { songs: queued, after: next[queued.length] },
      { songs: rest, after: next[ahead.length] },
    ].filter((group) => group.songs.length > 1 && group.songs.every(distinct) && (!group.after || distinct(group.after)));
  };

  const cleanCount = (first, items) => items.reduce((count, item, i) => count + (transition(songFacts(i ? items[i - 1].uri : first), songFacts(item.uri)).grade === "clean" ? 1 : 0), 0);

  // Put `wanted` in that order. Spotify's reorder moves songs to sit before
  // one that stays put: the song after the group, or the group's own last.
  const reorder = async (wanted, after) => {
    const ref = (item) => ({ uid: item.uid, uri: item.uri });
    const anchor = after ?? wanted.at(-1);
    const moving = after ? wanted : wanted.slice(0, -1);
    if (!moving.length) return;
    await S.Platform.PlayerAPI.reorderQueue(moving.map(ref), { before: ref(anchor) });
    // Wait for the player to report the new order before touching it again.
    for (let tries = 0; tries < 30; tries += 1) {
      const next = upcoming();
      const at = next.findIndex((item) => sameSong(item, wanted[0]));
      if (at >= 0 && wanted.every((item, i) => sameSong(next[at + i], item))) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  let smoothUndo = null; // { groups: the orders before smooth, signature: the queue smooth left behind }
  let smoothBusy = false;
  let smoothNote = null; // { text, until }
  const windowSignature = () => upcoming().slice(0, SMOOTH_WINDOW).map((item) => item.uid ?? item.uri).join("|");
  const note = (text) => {
    smoothNote = { text, until: Date.now() + 4000 };
    showSmooth();
  };

  const showSmooth = () => {
    if (smoothUndo && smoothUndo.signature !== windowSignature()) smoothUndo = null; // The queue moved on.
    if (smoothNote && Date.now() > smoothNote.until) smoothNote = null;
    const text = smoothBusy ? "..." : smoothNote ? smoothNote.text : smoothUndo ? "undo" : "smooth";
    if (smoothButton.textContent !== text) smoothButton.textContent = text;
    smoothButton.classList.toggle("is-note", Boolean(smoothBusy || smoothNote));
    smoothButton.hidden = upcoming().length < 3;
    smoothButton.title = smoothUndo ? "Put the queue back the way it was" : "Reorder the next 30 songs so tempos and keys run into each other";
  };

  const smooth = async () => {
    if (smoothBusy || smoothNote) return;
    smoothBusy = true;
    showSmooth();
    try {
      if (smoothUndo) {
        for (const group of smoothUndo.groups) await reorder(group.songs, group.after);
        smoothUndo = null;
        smoothBusy = false;
        note("undone");
        return;
      }
      const current = state().item?.uri;
      const ahead = upcoming().slice(0, SMOOTH_WINDOW);
      wantSongs([current, ...ahead.map((item) => item.uri)], true);
      for (let tries = 0; tries < 20 && ahead.some((item) => trackId(item.uri) && !songFacts(item.uri) && !indexMisses.has(trackId(item.uri))); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150)); // Numbers for songs just outside the pane are still arriving.
      }
      const before = cleanCount(current, ahead);
      const groups = smoothGroups();
      const undo = [];
      let first = { facts: songFacts(current) };
      let changed = false;
      for (const group of groups) {
        const songs = group.songs.map(withFacts);
        const order = smoothest(first, songs);
        first = order.at(-1);
        if (order.every((song, i) => song === songs[i])) continue;
        undo.push({ songs: group.songs, after: group.after });
        await reorder(order.map((song) => song.item), group.after);
        changed = true;
      }
      smoothBusy = false;
      if (!changed) {
        note("already smooth");
        return;
      }
      smoothUndo = { groups: undo, signature: windowSignature() };
      queueSignature = null;
      note(`${before} > ${cleanCount(current, upcoming().slice(0, SMOOTH_WINDOW))} clean`);
    } catch {
      smoothBusy = false;
      note("couldn't reorder");
    }
  };
  smoothButton.addEventListener("click", () => {
    smooth();
    smoothButton.blur(); // So the keys go back to the game.
  });

  const renderQueue = () => {
    showSmooth();
    const current = state().item?.uri;
    const items = upcoming().slice(0, 12);
    wantSongs([current, ...items.map((item) => item.uri)], true);
    const signature = [current, ...items.map((item) => item.uid ?? item.uri)].map((name, i) => `${name}${songFacts(i ? items[i - 1].uri : current) ? "+" : ""}`).join("|");
    if (signature === queueSignature) return;
    queueSignature = signature;
    const playing = songFacts(current);
    queueNow.replaceChildren(...(playing ? [el("span", "tty-queue-now-word", "now"), mixLabel(playing)] : []));
    queueNow.title = playing ? `Playing now: ${Math.round(playing[0])} BPM, key ${playing[1]}` : "";
    if (!items.length) {
      queueList.replaceChildren(el("li", "tty-queue-note", "nothing up next"));
      return;
    }
    queueList.replaceChildren(
      ...items.map((item, i) => {
        const row = el("li", item.provider === "queue" ? "tty-queue-row is-queued" : "tty-queue-row");
        const artists = (item.artists ?? []).map((artist) => artist.name).join(", ");
        const play = el("button", "tty-queue-play");
        play.type = "button";
        const facts = songFacts(item.uri);
        // Bright numbers: this song mixes cleanly with the one before it. Dim: it clashes.
        const grade = transition(songFacts(i ? items[i - 1].uri : current), facts).grade;
        if (grade) row.classList.add(`is-${grade}`);
        const mixes = grade === "clean" ? ", mixes cleanly with the song before" : grade === "rough" ? ", clashes with the song before" : "";
        play.title = `Play ${artists ? `${item.name} - ${artists}` : item.name ?? ""}${facts ? ` (${Math.round(facts[0])} BPM, key ${facts[1]}${mixes})` : ""}`;
        play.addEventListener("click", () => {
          S.Platform.PlayerAPI?.skipTo?.({ uid: item.uid, uri: item.uri });
          play.blur(); // So the keys go back to the game.
        });
        play.append(el("span", "tty-queue-num", String(i + 1).padStart(2, "0")), el("span", "tty-queue-title", item.name ?? ""), el("span", "tty-queue-artist", artists));
        if (facts) play.append(mixLabel(facts));
        row.append(play);
        return row;
      }),
    );
  };

  const placeQueue = () => {
    const right = document.querySelector(".tty-right");
    if (right && queueBox.parentElement !== right) right.prepend(queueBox);
  };

  // ---- Console: the prompt takes commands --------------------------------------
  //
  // Click the prompt in the top bar, or press ` (backtick), and type. Commands
  // search Liked Songs by tempo and key, queue what they find, smooth the
  // queue and build sets. They all run on the song index above.

  let library = null;
  let libraryAt = 0;
  const loadLibrary = async () => {
    if (library && Date.now() - libraryAt < 600000) return library;
    const songs = [];
    for (let offset = 0; ; offset += 500) {
      const page = await S.Platform.LibraryAPI.getTracks({ limit: 500, offset });
      const items = page?.items ?? [];
      for (const item of items) {
        if (!trackId(item.uri)) continue;
        songs.push({ uri: item.uri, name: item.name ?? "", artists: (item.artists ?? []).map((artist) => artist.name).join(", "), ms: item.duration?.milliseconds ?? 0 });
      }
      if (items.length < 500) break;
    }
    library = songs;
    libraryAt = Date.now();
    wantSongs(songs.map((song) => song.uri), false);
    return songs;
  };

  const consoleBox = el("div", "tty-console");
  consoleBox.hidden = true;
  const consoleOut = el("div", "tty-console-out");
  const consoleLine = el("label", "tty-console-line");
  const consolePrompt = el("span", "tty-console-prompt");
  const consoleInput = el("input", "tty-console-input");
  consoleInput.type = "text";
  consoleInput.spellcheck = false;
  consoleInput.autocomplete = "off";
  consoleInput.setAttribute("aria-label", "Command");
  consoleLine.append(consolePrompt, consoleInput);
  consoleBox.append(consoleOut, consoleLine);
  document.body.append(consoleBox);

  const print = (text, kind) => {
    const row = el("div", kind ? `tty-console-row is-${kind}` : "tty-console-row", text);
    consoleOut.append(row);
    while (consoleOut.childElementCount > 300) consoleOut.firstElementChild.remove();
    consoleOut.scrollTop = consoleOut.scrollHeight;
    return row;
  };

  const queueSongs = async (songs) => {
    if (!songs.length) return;
    await S.Platform.PlayerAPI.addToQueue(songs.map((song) => ({ uri: song.uri })));
    print(songs.length === 1 ? `queued ${songs[0].name}` : `queued ${songs.length} songs`, "ok");
  };

  // A numbered list. "add" and "play" pick from the last one by number, and
  // a click on a row queues that song. In a set, rows are graded against the
  // song before them, like up next.
  let results = [];
  let resultsName = ""; // What the last list was, for a playlist's default name and for the model.
  const printSongs = (songs, before) => {
    results = songs;
    songs.forEach((song, i) => {
      const row = el("button", "tty-console-song");
      row.type = "button";
      row.title = "Add to the queue";
      const facts = songFacts(song.uri);
      if (before !== undefined) {
        const grade = transition(i ? songFacts(songs[i - 1].uri) : before, facts).grade;
        if (grade) row.classList.add(`is-${grade}`);
      }
      row.append(el("span", "tty-console-num", String(i + 1).padStart(2, " ")), el("span", "tty-console-name", song.name), el("span", "tty-console-artist", song.artists));
      if (facts) row.append(mixLabel(facts));
      row.addEventListener("click", () => {
        queueSongs([song]);
        consoleInput.focus();
      });
      consoleOut.append(row);
    });
    consoleOut.scrollTop = consoleOut.scrollHeight;
  };

  // "1 3 5", "2-6" or "all", as songs from the last list.
  const pick = (args) => {
    const picked = [];
    for (const arg of args) {
      const range = /^(\d+)(?:-(\d+))?$/.exec(arg);
      if (arg.toLowerCase() === "all") picked.push(...results);
      else if (range) for (let n = Number(range[1]); n <= Number(range[2] ?? range[1]); n += 1) if (results[n - 1]) picked.push(results[n - 1]);
    }
    return [...new Set(picked)];
  };

  // Liked Songs, with a note while their tempos and keys are still arriving.
  const likedSongs = async () => {
    const songs = await loadLibrary();
    const ready = songs.filter((song) => songFacts(song.uri) && songTags.has(trackId(song.uri))).length;
    if (ready < songs.length * 0.95) print(`still indexing Liked Songs: ${ready} of ${songs.length} ready. Results are partial for the next minute.`, "dim");
    return songs;
  };

  // Which of the words name a genre or mood? The longest phrase wins, so
  // "deep house" is one tag, not "deep" and "house". A tag also covers its
  // kin: "techno" matches songs tagged "minimal techno". Words that name no
  // tag are left to match titles and artists. An artist's exact name is never
  // read as tags, so "beach house" finds the band.
  const readTags = (words, songs) => {
    const phrase = words.join(" ");
    if (!words.length || songs.some((song) => song.artists.toLowerCase().split(", ").includes(phrase))) return { tags: [], rest: words };
    const tags = [];
    const rest = [];
    for (let i = 0; i < words.length; ) {
      let size = 0;
      for (let n = Math.min(4, words.length - i); n > 0 && !size; n -= 1) if (tagNumber.has(words.slice(i, i + n).join(" "))) size = n;
      if (size) {
        const name = words.slice(i, i + size).join(" ");
        const kin = new RegExp(`(^| )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
        tags.push({ name, numbers: new Set(tagNames.flatMap((tag, number) => (kin.test(tag[0]) ? [number] : []))) });
        i += size;
      } else {
        rest.push(words[i]);
        i += 1;
      }
    }
    return { tags, rest };
  };
  // How strongly a song carries a tag, 0 to 1.
  const tagWeight = (uri, tag) => {
    const pairs = songTags.get(trackId(uri)) ?? [];
    let best = 0;
    for (let i = 0; i < pairs.length; i += 2) if (tag.numbers.has(pairs[i]) && pairs[i + 1] > best) best = pairs[i + 1];
    return best / 100;
  };
  // The commonest tags across Liked Songs: [[name, kind, songs], ...]
  const commonTags = (songs) => {
    const counts = new Map();
    for (const song of songs) for (const tag of tagsOf(song.uri)) if (tag.weight >= 0.5) counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    return [...counts].map(([name, count]) => [name, tagNames[tagNumber.get(name)][1], count]).sort((a, b) => b[2] - a[2]);
  };

  // How far apart two tempos are, with half and double time folded together.
  const tempoApart = (a, b) => {
    const octaves = Math.abs(Math.log2(b / a)) % 1;
    return 2 ** Math.min(octaves, 1 - octaves) - 1;
  };

  // ---- Sets ----
  // A set is a run of Liked Songs for a given length whose tempo follows a
  // shape, each song chosen to mix with the one before it. The shape is a
  // tempo curve relative to where the set starts: the playing song, or a
  // random liked song when nothing is playing. A little chance in the choice
  // means the same command gives a different set each time.
  const SHAPES = {
    flat: () => 1,
    up: (x) => 1 + 0.12 * x,
    down: (x) => 1 - 0.1 * x,
    peak: (x) => (x < 0.7 ? 1 + 0.1 * (x / 0.7) : 1.1 - 0.07 * ((x - 0.7) / 0.3)), // Up 10% by the 70% mark, then easing off.
  };

  const buildSet = (songs, minutes, shape, start) => {
    const pool = songs.filter((song) => {
      const facts = songFacts(song.uri);
      return facts?.[0] && facts[1] && song.ms > 90000 && song.ms < 540000 && song.uri !== start?.uri;
    });
    if (pool.length < 20) return null;
    const length = minutes * 60000;
    const set = [];
    const used = new Set();
    let elapsed = 0;
    let last = start?.facts;
    if (!last) {
      const seed = pool[Math.floor(Math.random() * pool.length)];
      set.push(seed);
      used.add(seed.uri);
      elapsed = seed.ms;
      last = songFacts(seed.uri);
    }
    const base = last[0];
    while (elapsed < length) {
      const target = base * SHAPES[shape](elapsed / length);
      const recent = set.slice(-3).map((song) => song.artists);
      // Two songs running in one key is enough; a third costs extra, so the set moves round the wheel.
      const stuck = set.length > 1 && songFacts(set.at(-2).uri)[1] === last[1] ? last[1] : "";
      let best = null;
      let bestScore = Infinity;
      for (const song of pool) {
        if (used.has(song.uri)) continue;
        const facts = songFacts(song.uri);
        const score = transition(last, facts).cost + tempoApart(target, facts[0]) / 0.03 + (recent.includes(song.artists) ? 2 : 0) + (facts[1] === stuck ? 0.8 : 0) + Math.random() * 0.4;
        if (score < bestScore) {
          best = song;
          bestScore = score;
        }
      }
      if (!best || (set.length && elapsed + best.ms / 2 > length)) break; // Stop rather than run more than half a song over.
      set.push(best);
      used.add(best.uri);
      elapsed += best.ms;
      last = songFacts(best.uri);
    }
    return { songs: set, ms: elapsed, base };
  };

  // The set's tempo as a row of bars, lowest to highest.
  const tempoChart = (set) => {
    const ratios = set.songs.map((song) => {
      const octaves = Math.log2(songFacts(song.uri)[0] / set.base);
      return 2 ** (octaves - Math.round(octaves));
    });
    const low = Math.min(0.94, ...ratios);
    const high = Math.max(1.12, ...ratios);
    return ratios.map((ratio) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(((ratio - low) / (high - low)) * 8))]).join("");
  };


  // A command returns ASK when what followed it reads like a sentence, not
  // like its own arguments: "find me something mellow", "queue three songs
  // that mix with this". The line then goes to the model instead.
  const ASK = Symbol("ask");

  const commands = {
    help() {
      for (const [command, does] of [
        ["find deep house", "liked songs by genre or mood. Mix in a tempo, key or name: find techno 130-140bpm"],
        ["find 124bpm 8A", "liked songs near a tempo, in a key"],
        ["genres", "the genres and moods in your Liked Songs"],
        ["mix", "liked songs that mix cleanly with this one. Also: mix techno"],
        ["mix slower", "the same keys, a step down in tempo. Also: mix faster"],
        ["add 1 3 5", "queue songs from the last list. Also: add 2-6, add all"],
        ["play 2", "play one from the last list now"],
        ["play all", "play the whole list now, in place of what you had queued"],
        ["smooth", "reorder the next 30 songs. undo puts them back"],
        ["set 60m peak", "build a set: flat, up, down or peak. Add a genre: set 60m peak house"],
        ["save my list", "save the last list as a playlist"],
        ["now", "this song's tempo and key"],
        ["clear", "empty this window. Esc closes it"],
        ["plain words", "anything else goes to a model on this computer. It picks the commands and remembers the conversation. Try: play something like this but slower"],
        ["model", "which model answers plain words"],
      ]) {
        const row = print("", "help");
        row.append(el("span", "tty-console-command", command), el("span", "", does));
      }
    },

    now() {
      const item = state().item;
      const facts = songFacts(item?.uri);
      if (!item) {
        print("nothing is playing", "dim");
        return;
      }
      print(facts ? `${item.name}: ${Math.round(facts[0])} BPM, key ${facts[1]}` : `${item.name}: Spotify has no tempo or key for this one`);
      const tags = tagsOf(item.uri).slice(0, 8);
      if (tags.length) print(`tagged ${tags.map((tag) => tag.name).join(", ")}`, "dim");
    },

    async genres() {
      const common = commonTags(await likedSongs());
      const row = (kind, limit) => common.filter((tag) => tag[1] === kind).slice(0, limit).map((tag) => `${tag[0]} ${tag[2]}`).join(", ");
      if (!common.length) {
        print("no tags yet. They arrive in the first minute after Spotify opens", "dim");
        return;
      }
      print(`genres in your Liked Songs: ${row("g", 40)}`);
      print(`moods: ${row("m", 20)}`);
      print("Use any of them in find, mix and set: find deep house, mix techno, set 60m peak house", "dim");
    },

    async find(args) {
      let low = 0;
      let high = 0;
      let near = 0;
      let key = "";
      const words = [];
      for (const arg of args) {
        const range = /^(\d{2,3})-(\d{2,3})(?:bpm)?$/i.exec(arg);
        const tempo = /^(\d{2,3})bpm$/i.exec(arg);
        const wheel = /^(1[0-2]|[1-9])([ab])$/i.exec(arg);
        if (range) [low, high] = [Number(range[1]), Number(range[2])];
        else if (tempo) near = Number(tempo[1]);
        else if (wheel) key = `${wheel[1]}${wheel[2].toUpperCase()}`;
        else words.push(arg.toLowerCase());
      }
      if (!args.length) {
        print("find what? Try: find deep house, find 124bpm 8A, find techno 130-140bpm, or find a name", "dim");
        return;
      }
      // "find me some sad indie" is a sentence, not a search for the words "me" and "some".
      if (words.some((word) => ["me", "some", "any", "songs", "tracks", "music", "something", "stuff", "please", "around"].includes(word))) return ASK;
      const liked = await likedSongs();
      const { tags, rest } = readTags(words, liked);
      // A lone word can be a genre or part of a name, so it matches either. Tagged songs come first.
      const loose = tags.length === 1 && !rest.length && !near && !high && !key;
      const songs = liked
        .map((song) => ({ song, facts: songFacts(song.uri), text: `${song.name} ${song.artists}`.toLowerCase(), weights: tags.map((tag) => tagWeight(song.uri, tag)) }))
        .filter(({ facts, text, weights }) => {
          if ((near || high || key) && !facts) return false;
          if (near && tempoApart(near, facts[0]) > 0.03) return false;
          if (high && (facts[0] < low || facts[0] > high)) return false;
          if (key && facts[1] !== key) return false;
          if (!weights.every((weight, i) => weight > 0 || (loose && text.includes(tags[i].name)))) return false;
          return rest.every((word) => text.includes(word));
        })
        .map((entry) => ({ ...entry, strength: entry.weights.reduce((sum, weight) => sum + weight, 0) }));
      if (!songs.length && (rest.length > 1 || (tags.length && rest.length))) return ASK;
      // Order: nearest the tempo, or up a tempo range, or by how strongly the tags fit.
      // A genre with many matches is shuffled a little, so it isn't the same 20 every time.
      if (near) songs.sort((a, b) => tempoApart(near, a.facts[0]) - tempoApart(near, b.facts[0]));
      else if (high) songs.sort((a, b) => a.facts[0] - b.facts[0]);
      else if (tags.length) for (const entry of songs) entry.strength += songs.length > 20 ? Math.random() * 0.3 : 0;
      if (tags.length && !near && !high) songs.sort((a, b) => b.strength - a.strength);
      const spread = high && songs.length > 20;
      const shown = (spread ? Array.from({ length: 20 }, (_, i) => songs[Math.floor((i * songs.length) / 20)]) : songs.slice(0, 20)).map((entry) => entry.song);
      const tagged = tags.length ? ` tagged ${tags.map((tag) => tag.name).join(" and ")}` : "";
      const which = spread ? ", 20 spread across the range:" : songs.length > 20 ? (tags.length && !near ? ", 20 of the strongest:" : ", first 20:") : ":";
      print(songs.length ? `${songs.length} liked ${songs.length === 1 ? "song" : "songs"}${tagged}${which}` : "no liked songs match. genres lists the genres and moods you can search", songs.length ? "" : "dim");
      printSongs(shown);
      resultsName = `Find: ${args.join(" ")}`;
    },

    async mix(args) {
      const item = state().item;
      const from = songFacts(item?.uri);
      if (!from) {
        print(item ? "Spotify has no tempo or key for the playing song" : "nothing is playing", "dim");
        return;
      }
      // "slower" and "faster": keys that fit, 4% to 15% down or up in tempo.
      const step = { slower: -1, faster: 1 }[args[0]?.toLowerCase()] ?? 0;
      const liked = await likedSongs();
      // Anything after that must name genres or moods: mix techno, mix slower chill.
      const { tags, rest } = readTags(args.slice(step ? 1 : 0).map((arg) => arg.toLowerCase()), liked);
      if (rest.length) return ASK;
      const shift = (facts) => {
        const octaves = Math.log2(facts[0] / from[0]);
        return 2 ** (octaves - Math.round(octaves)) - 1;
      };
      const queued = new Set(upcoming().map((next) => next.uri));
      const songs = liked
        .filter((song) => song.uri !== item.uri && !queued.has(song.uri) && songFacts(song.uri)?.[0] && tags.every((tag) => tagWeight(song.uri, tag) > 0))
        .map((song) => ({ song, fit: transition(from, songFacts(song.uri)), shift: shift(songFacts(song.uri)) }))
        .filter((entry) => (step ? entry.fit.keyFits && entry.shift * step >= 0.04 && entry.shift * step <= 0.15 : entry.fit.grade === "clean"))
        .sort((a, b) => (step ? Math.abs(a.shift) - Math.abs(b.shift) : a.fit.cost - b.fit.cost))
        .map((entry) => entry.song);
      const tagged = tags.length ? `tagged ${tags.map((tag) => tag.name).join(" and ")} ` : "";
      const what = `${tagged}${step ? `fit ${item.name}'s key, a step ${args[0].toLowerCase()}` : `mix cleanly with ${item.name}`}`;
      print(songs.length ? `${songs.length} liked songs ${what} (${Math.round(from[0])} ${from[1]})${songs.length > 20 ? ", closest 20:" : ":"}` : `no liked songs ${what}`, songs.length ? "" : "dim");
      printSongs(songs.slice(0, 20));
      resultsName = `${step ? `A step ${args[0].toLowerCase()} than` : "Mixes with"} ${item.name}`;
    },

    async add(args) {
      if (args.some((arg) => !/^(\d+(-\d+)?|all)$/i.test(arg))) return ASK;
      const songs = pick(args);
      if (!songs.length) print(results.length ? "add which? Try: add 1 3, add 2-6 or add all" : "nothing to add yet. Run find, mix or set first", "dim");
      else await queueSongs(songs);
    },

    async play(args) {
      if (args.some((arg) => !/^(\d+(-\d+)?|all)$/i.test(arg))) return ASK;
      const songs = pick(args);
      if (!songs.length) {
        print(results.length ? "play which? Try: play 1, or play all" : "nothing to play yet. Run find, mix or set first", "dim");
        return;
      }
      const player = S.Platform.PlayerAPI;
      const queuedSongs = () => upcoming().filter((next) => next.provider === "queue");
      const settle = async (done) => {
        for (let tries = 0; tries < 30 && !done(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
        return done();
      };
      // Several songs take over from what you had queued. One song plays next and leaves the rest alone.
      const replaced = songs.length > 1 ? queuedSongs().length : 0;
      if (replaced) {
        await player.clearQueue();
        await settle(() => !queuedSongs().length);
      }
      await player.addToQueue(songs.map((song) => ({ uri: song.uri })));
      const first = await settle(() => queuedSongs().find((next) => next.uri === songs[0].uri));
      if (!first) {
        print(`queued ${songs.length === 1 ? songs[0].name : `${songs.length} songs`}, but couldn't jump to ${songs.length === 1 ? "it" : "the first"}`, "warn");
        return;
      }
      await player.skipTo({ uid: first.uid, uri: first.uri });
      if (songs.length === 1) print(`playing ${songs[0].name}`, "ok");
      else print(`playing ${songs.length} songs, starting with ${songs[0].name}${replaced ? `. They replaced the ${replaced} you had queued` : ""}`, "ok");
    },

    async smooth() {
      smoothUndo = null; // Smooth again from wherever the queue is now.
      smoothNote = null;
      await smooth();
      const result = smoothNote?.text ?? "";
      if (result === "already smooth") print("the next 30 songs are already as smooth as they get", "ok");
      else if (smoothUndo) print(`next 30 songs reordered: ${result}. undo puts them back`, "ok");
      else print("couldn't reorder the queue", "warn");
    },

    async undo() {
      if (!smoothUndo) {
        print("nothing to undo", "dim");
        return;
      }
      smoothNote = null;
      await smooth();
      print("queue put back", "ok");
    },

    async set(args) {
      const liked = await likedSongs();
      // Words that aren't the length or the shape must name genres or moods: set 60m peak house.
      const { tags, rest } = readTags(args.filter((arg) => !/^\d{1,3}m?$/i.test(arg) && !SHAPES[arg.toLowerCase()]).map((arg) => arg.toLowerCase()), liked);
      if (rest.length) return ASK;
      const minutes = Math.min(240, Math.max(10, Number((/^(\d{1,3})m?$/i.exec(args.find((arg) => /^\d/.test(arg)) ?? "") ?? [])[1] ?? 60)));
      const shape = args.map((arg) => arg.toLowerCase()).find((arg) => SHAPES[arg]) ?? "peak";
      const item = state().item;
      const start = songFacts(item?.uri) ? { uri: item.uri, facts: songFacts(item.uri) } : null;
      const tagged = tags.length ? ` of ${tags.map((tag) => tag.name).join(" and ")}` : "";
      const set = buildSet(liked.filter((song) => tags.every((tag) => tagWeight(song.uri, tag) > 0)), minutes, shape, start);
      if (!set) {
        print(`not enough liked songs${tagged ? ` tagged ${tags.map((tag) => tag.name).join(" and ")}` : " with a tempo and key"} to build a set from`, "dim");
        return;
      }
      const clean = set.songs.reduce((count, song, i) => count + (transition(i ? songFacts(set.songs[i - 1].uri) : start?.facts, songFacts(song.uri)).grade === "clean" ? 1 : 0), 0);
      // Tempos for the summary, with half and double time folded onto the set's middle tempo.
      const raw = set.songs.map((song) => songFacts(song.uri)[0]);
      const middle = [...raw].sort((a, b) => a - b)[Math.floor(raw.length / 2)];
      const tempos = raw.map((bpm) => Math.round(bpm / 2 ** Math.round(Math.log2(bpm / middle))));
      print(`${set.songs.length} songs${tagged}, ${Math.round(set.ms / 60000)} min, ${shape}${start ? `, following ${item.name}` : ""}. ${clean} of ${set.songs.length} transitions clean`);
      print(`tempo ${tempoChart(set)}  ${tempos[0]} to ${tempos.at(-1)} BPM, top ${Math.max(...tempos)}`, "chart");
      printSongs(set.songs, start?.facts);
      resultsName = `Set: ${minutes} min ${shape}${tagged}, ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      print("play all starts it. save keeps it as a playlist. Run set again for a different one", "dim");
    },

    async save(args, line) {
      if (!results.length) {
        print("nothing to save yet. Run find, mix or set first", "dim");
        return;
      }
      const typed = line
        .replace(/^\s*save\s*/i, "")
        .replace(/^(?:(?:it|this|that|them|these|those|the (?:list|set|songs))\s+)?(?:(?:as|called|named)\s+)?/i, "")
        .replace(/^["'](.*)["']$/, "$1")
        .trim();
      const name = typed || resultsName || "Console list";
      const uri = await S.Platform.RootlistAPI.createPlaylist(name, { before: "start" });
      if (!uri) {
        print("couldn't create the playlist", "warn");
        return;
      }
      await S.Platform.PlaylistAPI.add(uri, results.map((song) => song.uri), { after: "end" });
      const row = print(`saved ${results.length} songs as "${name}" `, "ok");
      const open = el("button", "tty-console-link", "open");
      open.type = "button";
      open.addEventListener("click", () => {
        S.Platform.History.push(`/playlist/${uri.split(":").pop()}`);
        closeConsole();
      });
      row.append(open);
    },

    async model(args) {
      let models;
      try {
        models = await installedModels();
      } catch {
        modelHelp();
        return;
      }
      if (args[0] && !models.includes(args[0])) {
        print(`Ollama has no model called "${args[0]}"`, "dim");
      } else if (args[0]) {
        localStorage.setItem(MODEL_KEY, args[0]);
      }
      const current = await chosenModel();
      print(models.length ? `plain words go to ${current}${ollama?.endsWith("11435") ? " on the console's own Ollama" : ""}. Installed: ${models.join(", ")}. Switch with: model <name>` : "Ollama is running but has no models. Run: ollama pull qwen3:8b");
    },

    clear() {
      consoleOut.replaceChildren();
      chat.length = 0; // A clean window is a new conversation.
    },
  };

  const HISTORY_KEY = "tty-console-history";
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {}
  let historyAt = -1; // -1: a new line; 0: the last command; and so on back.
  let consoleBusy = false;

  // ---- Plain words: a model on this computer turns a sentence into commands ----
  //
  // Anything that isn't a command goes to Ollama (ollama.com), a program that
  // runs language models locally. The model never touches Spotify. It reads
  // the request and the playing song, and answers with commands from the
  // list above, which then run like typed ones. It needs one setting,
  // because Ollama refuses pages it hasn't been told about: OLLAMA_ORIGINS
  // must include this page's address.
  // Ollama answers one request at a time, so if another program keeps it busy
  // the console waits in line. A second Ollama on port 11435, kept for the
  // console (ollama-console.sh), is tried first; the usual one is the fallback.
  const OLLAMA_PORTS = [11435, 11434];
  let ollama = null; // The address that answered last.
  const MODEL_KEY = "tty-console-model";
  const MODEL_GUIDE = [
    "You are the assistant inside a console in Spotify. You turn what the user says into console commands, and you may ask one short question when you need to. Answer with JSON only.",
    "Commands:",
    "find <genre or mood> <words> <N>bpm <key>   list songs from the user's Liked Songs. All parts are optional. Genre and mood names must come from the tag list given with each request, for example: find deep house, find chill hip hop. <N>bpm is a tempo, and a range is written like 120-128bpm. <key> is a Camelot code such as 8A or 11B. Other words match song titles and artist names.",
    "mix <genre>   list Liked Songs that mix cleanly with the playing song: a matching key and a tempo within 6%. The genre is optional. mix slower lists ones 4% to 15% slower, mix faster 4% to 15% faster.",
    "set <minutes>m <shape> <genre>   list a set built from Liked Songs that starts from the playing song. Shape is flat, up, down or peak. The genre is optional.",
    "play all   start playing the last list now, in place of the songs the user had queued. play <number> plays one song from it.",
    "add <numbers>   add songs from the last list to the queue without interrupting the music, for example: add 1 2 3. Or: add all.",
    "save <name>   save the last list as a playlist with that name.",
    "smooth   reorder the next 30 queued songs so they run into each other. undo puts them back.",
    "now   show the playing song's tempo, key and tags.",
    "Rules:",
    "Use only these commands, at most 4, in the order they should run. A list command (find, mix, set) must come before play, add or save, unless the user means the list already in the console.",
    'When the user asks to play, hear, put on or switch to something, finish with "play all". When they ask to queue or add, use add. When they only ask to find or see songs, just list them.',
    "For a genre or mood, use the closest names from the tag list. Use one or two tags, never more. If the user asks for a style that is not in the list, use its nearest tag and add a tempo range that fits it (hard techno: techno 140-160bpm). If nothing in the list is close, do not refuse: run find with the user's own word, which also matches titles and artists.",
    "Never answer a question about the playing song from memory. Use now.",
    '"say" is one or two short plain sentences: what you are doing, or a question. After playing or listing songs you may end with one offer, such as: Want these saved as a playlist?',
    "Nothing happens unless its command is in commands. Never say you are saving, playing or queueing without the command for it.",
    "The conversation continues across requests. If the user says yes, or gives a name, act on your last offer with its command. A playlist needs a name: if the user agreed but gave none, ask what to call it and give no commands. Once you have the name, the command is save <name>.",
    "If the request can't be done with these commands, give no commands and say so.",
    "Examples (they assume the tag list has house, techno, jazz, chill and hip hop):",
    'Request: queue 3 songs that mix with this -> {"say": "Queueing three songs that mix with it.", "commands": ["mix", "add 1 2 3"]}',
    'Request: queue a few techno tracks that mix with this -> {"say": "Queueing techno that mixes with it.", "commands": ["mix techno", "add 1 2 3"]}',
    'Request: play some jazz -> {"say": "Playing jazz from your Liked Songs. Want these saved as a playlist?", "commands": ["find jazz", "play all"]}',
    'Request: play some hard techno -> {"say": "Playing your fastest techno, 140 to 160 BPM. Want these saved as a playlist?", "commands": ["find techno 140-160bpm", "play all"]}',
    'Request: play some reggae -> {"say": "Reggae is not one of your tags, so I am searching the word.", "commands": ["find reggae", "play all"]}',
    'Request: what genre is this -> {"say": "Here are its tempo, key and tags.", "commands": ["now"]}',
    'Request: something chill to work to -> {"say": "Playing chill songs from your Liked Songs.", "commands": ["find chill", "play all"]}',
    'Request: play something like this but slower -> {"say": "Switching to slower songs in a matching key. Want these saved as a playlist?", "commands": ["mix slower", "play all"]}',
    'Request: yes, call it warehouse -> {"say": "Saving it as warehouse.", "commands": ["save warehouse"]}',
    'Request: sure, name it late night -> {"say": "Saving it as late night.", "commands": ["save late night"]}',
    'Request: save it as pregame -> {"say": "Saving it as pregame.", "commands": ["save pregame"]}',
    'Request: play it -> {"say": "Playing the list.", "commands": ["play all"]}',
    'Request: yes -> {"say": "What should I call the playlist?", "commands": []}',
    'Request: put on some deftones -> {"say": "Playing Deftones from your Liked Songs.", "commands": ["find deftones", "play all"]}',
    'Request: build me an hour long house set that climbs -> {"say": "Here is a one hour house set that climbs. Want me to play it or save it?", "commands": ["set 60m up house"]}',
    'Request: tidy up my queue -> {"say": "Smoothing the queue.", "commands": ["smooth"]}',
    'Request: what is the weather -> {"say": "I can only find, play, queue and save music here.", "commands": []}',
  ].join("\n");
  const MODEL_REPLY = { type: "object", properties: { say: { type: "string" }, commands: { type: "array", items: { type: "string" } } }, required: ["say", "commands"] };

  let asking = null; // The request in flight, so Ctrl+C or a minute's wait can drop it.
  const chat = []; // Earlier requests and answers, so "yes, call it friday" makes sense.
  let awaitingName = false; // The model just asked what to call a playlist. The next line is the name.
  const installedModels = async () => {
    for (const port of OLLAMA_PORTS) {
      try {
        const res = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        ollama = `http://localhost:${port}`;
        return ((await res.json()).models ?? []).map((model) => model.name);
      } catch {}
    }
    ollama = null;
    throw new Error("no Ollama");
  };
  const chosenModel = async () => {
    const models = await installedModels();
    const saved = localStorage.getItem(MODEL_KEY);
    return (saved && models.includes(saved) ? saved : null) ?? models.find((name) => /^qwen/i.test(name)) ?? models[0] ?? null;
  };
  const modelHelp = () => {
    print("That isn't a command, and no model on this computer answered. To use plain words:", "dim");
    print("  1. install Ollama from ollama.com, then run: ollama pull qwen3:8b", "dim");
    print(`  2. let Spotify talk to it (macOS): launchctl setenv OLLAMA_ORIGINS "${location.origin}"`, "dim");
    print("  3. quit and reopen Ollama", "dim");
    print("help lists the commands that work without it.", "dim");
  };

  const ask = async (line) => {
    let model;
    try {
      model = await chosenModel();
    } catch {
      modelHelp();
      return;
    }
    if (!model) {
      print("Ollama is running but has no models. Run: ollama pull qwen3:8b", "dim");
      return;
    }
    const item = state().item;
    const facts = songFacts(item?.uri);
    const playing = item ? `${item.name} by ${(item.artists ?? []).map((artist) => artist.name).join(", ")}${facts ? `, ${Math.round(facts[0])} BPM, key ${facts[1]}` : ""}` : "nothing";
    const waiting = print(`asking ${model}... (Ctrl+C stops)`, "dim");
    let reply = null;
    asking = new AbortController();
    const signal = asking.signal;
    const timer = setTimeout(() => asking?.abort("slow"), 60000);
    try {
      // The genres and moods this library actually has, so the model picks real names.
      const known = commonTags(await loadLibrary().catch(() => [])).filter((tag) => tag[1] !== "o").slice(0, 160).map((tag) => tag[0]).join(", ");
      const list = results.length ? `${results.length} songs (${resultsName}): ${results.slice(0, 6).map((song, i) => `${i + 1}. ${song.name} by ${song.artists}`).join("; ")}${results.length > 6 ? "; ..." : ""}` : "empty";
      const body = { model, stream: false, think: false, format: MODEL_REPLY, options: { temperature: 0, num_ctx: 4096 }, messages: [{ role: "system", content: MODEL_GUIDE }, ...chat.slice(-8), { role: "user", content: `Tag list: ${known || "none yet"}.\nPlaying now: ${playing}.\nLast list in the console: ${list}.\nRequest: ${line}` }] };
      let res = await fetch(`${ollama}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      if (!res.ok) {
        delete body.think; // Models that don't reason step by step reject the switch.
        res = await fetch(`${ollama}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      }
      reply = JSON.parse((await res.json()).message.content);
      // Small models sometimes announce an action and forget its command. Ask once more.
      if (!(reply.commands ?? []).length && /\b(sav|play|queu|add|switch|smooth)(ed|ing)\b/i.test(reply.say ?? "")) {
        body.messages.push({ role: "assistant", content: JSON.stringify(reply) }, { role: "user", content: "You gave no commands, so nothing happened. Answer again with the commands for what you just said." });
        const again = await fetch(`${ollama}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
        if (again.ok) reply = JSON.parse((await again.json()).message.content);
      }
    } catch {}
    clearTimeout(timer);
    asking = null;
    waiting.remove();
    if (!reply) {
      if (signal.reason === "stop") print("^C", "dim");
      else if (signal.reason === "slow") print(`${model} took over a minute, so the request was dropped. Another program may be keeping Ollama busy. Commands still work (help)`, "warn");
      else print(`${model} didn't give a usable answer. Try again, or use a command (help)`, "warn");
      return;
    }
    const lines = (Array.isArray(reply.commands) ? reply.commands : []).filter((command) => typeof command === "string" && command.trim()).slice(0, 4);
    chat.push({ role: "user", content: `Request: ${line}` }, { role: "assistant", content: JSON.stringify({ say: reply.say ?? "", commands: lines }) });
    if (chat.length > 12) chat.splice(0, chat.length - 12);
    if (reply.say) print(reply.say, "say");
    awaitingName = !lines.length && results.length > 0 && /\b(call|name)\b[^.?!]*\?/i.test(reply.say ?? "");
    if (!lines.length && !reply.say) print("the model had nothing to run", "dim");
    for (const command of lines) await runLine(command, true);
  };

  // One line, typed or from the model. Model lines show with ">" and can't ask the model again.
  const runLine = async (line, fromModel) => {
    print(`${fromModel ? ">" : "$"} ${line}`, "echo");
    const args = line.trim().split(/\s+/);
    let name = args.shift().toLowerCase();
    // Answering "what should I call the playlist?" needs no model: the line is the name.
    if (awaitingName && !fromModel) {
      awaitingName = false;
      if (/^(no|nah|nope|never ?mind|cancel|forget it|skip)\b/i.test(line.trim())) {
        print("okay, not saved", "dim");
        return;
      }
      if (!Object.hasOwn(commands, name) && name !== "queue") {
        const title = line.trim().replace(/^(?:(?:let'?s\s+)?(?:call|name)\s+(?:it|the playlist)|how about)\s+/i, "");
        chat.push({ role: "user", content: `Request: ${line.trim()}` }, { role: "assistant", content: JSON.stringify({ say: `Saving it as ${title}.`, commands: [`save ${title}`] }) });
        await commands.save([], `save ${title}`);
        return;
      }
    }
    // "queue smooth" and "queue undo" read naturally; "queue 1 3" means add.
    if (name === "queue") name = ["smooth", "undo"].includes(args[0]?.toLowerCase()) ? args.shift().toLowerCase() : "add";
    try {
      const sentence = Object.hasOwn(commands, name) ? (await commands[name](args, line.trim())) === ASK : true;
      if (!sentence) return;
      if (fromModel) print("skipped: not a command the console knows", "dim");
      else await ask(line.trim());
    } catch {
      print("that didn't work", "warn");
    }
  };

  const runCommand = async (text) => {
    const line = text.trim();
    if (!line || consoleBusy) return;
    history = [line, ...history.filter((old) => old !== line)].slice(0, 40);
    historyAt = -1;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
    consoleBusy = true;
    consoleBox.classList.add("is-busy");
    await runLine(line, false);
    consoleBusy = false;
    consoleBox.classList.remove("is-busy");
  };

  const placeConsole = () => {
    if (consoleBox.hidden) return;
    const at = prompt.getBoundingClientRect();
    const left = at.width ? Math.max(8, at.left - 12) : 230;
    consoleBox.style.left = `${left}px`;
    consoleBox.style.width = `${Math.max(320, Math.min(720, window.innerWidth - left - 24))}px`;
    consolePrompt.textContent = `${userName}@spotify:~$`;
  };

  const openConsole = () => {
    consoleBox.hidden = false;
    root.classList.add("tty-console-open");
    placeConsole();
    if (!consoleOut.childElementCount) print("Commands run on your Liked Songs. help lists them, or say what you want in plain words. Esc closes this.", "dim");
    consoleInput.focus();
  };

  const closeConsole = () => {
    consoleBox.hidden = true;
    root.classList.remove("tty-console-open");
    consoleInput.blur();
  };

  prompt.removeAttribute("aria-hidden");
  prompt.setAttribute("role", "button");
  prompt.title = "Open the console (`)";
  prompt.addEventListener("click", () => (consoleBox.hidden ? openConsole() : closeConsole()));

  consoleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const text = consoleInput.value;
      consoleInput.value = "";
      runCommand(text);
    } else if (event.key === "c" && event.ctrlKey && asking) {
      asking.abort("stop");
    } else if (event.key === "Escape") {
      closeConsole();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      historyAt = Math.max(-1, Math.min(history.length - 1, historyAt + (event.key === "ArrowUp" ? 1 : -1)));
      consoleInput.value = historyAt < 0 ? "" : history[historyAt];
      event.preventDefault();
    } else {
      return;
    }
    event.stopPropagation();
  });

  // Backtick opens the console from anywhere but a text field.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "`" || event.metaKey || event.ctrlKey || event.altKey || ownsKeys(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      openConsole();
    },
    true,
  );

  // ---- Song info: lyrics and the auto level ---------------------------------------
  //
  // Spotify still serves lyrics, usually line-synced, to this client; they
  // run along the top border. On auto the level follows the song's tempo, or
  // without analysis the lyrics' pace: wordier, faster songs play harder.

  const lyricWords = (text) =>
    String(text ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z']/g, "").replace(/^'+|'+$/g, ""))
      .filter((word) => word.length >= 2);

  const paceLevel = (lines) => {
    const timed = lines.filter((line) => Number(line.startTimeMs) > 0);
    if (timed.length < 4) return "medium";
    const words = timed.reduce((sum, line) => sum + lyricWords(line.words).length, 0);
    const minutes = (Number(timed.at(-1).startTimeMs) - Number(timed[0].startTimeMs)) / 60000;
    const perMinute = minutes > 0 ? words / minutes : 0;
    return perMinute < 90 ? "easy" : perMinute > 170 ? "hard" : "medium";
  };

  // Fetched fresh for each song; only the current one is kept.
  const loadSong = async (uri) => {
    if (!uri?.startsWith("spotify:track:")) {
      showLyrics({ synced: false, lines: [] }); // Episodes and local files.
      return;
    }
    const id = uri.split(":").pop();
    let lines = [];
    let synced = false;
    try {
      const token = S.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken;
      const res = await fetch(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`, {
        headers: { Authorization: `Bearer ${token}`, "app-platform": "WebPlayer" },
      });
      if (res.ok) {
        const lyrics = (await res.json())?.lyrics;
        lines = lyrics?.lines ?? [];
        synced = lyrics?.syncType === "LINE_SYNCED";
      }
    } catch {
      // No lyrics for this one; the level stays medium.
    }
    const analysis = await fetchAnalysis(id);
    if (state().item?.uri !== uri) return; // The song changed while we waited.
    game.analysis = analysis;
    game.beatNext = -1;
    flappy.beatNext = -1;
    showLyrics({ synced, lines: lines.map((line) => ({ t: Number(line.startTimeMs) || 0, text: String(line.words ?? "").trim() })) });
    const level = analysis?.tempo ? tempoLevel(analysis.tempo) : paceLevel(lines);
    if (level !== game.autoLevel) {
      game.autoLevel = level;
      if (!game.manual) resetRun();
    }
    refreshSwitches();
  };

  // A playfield in CSS pixels: the ground's span, the pane's right edge, and
  // the ground line as the floor.
  const field = () => ({ left: ground.left * SCALE, right: ground.right * SCALE, paneRight: game.width * SCALE, floor: (ground.offsetY + GROUND_LINE) * SCALE });

  // ---- Shooter -----------------------------------------------------------------
  //
  // A side-scroller in the same pixel style (original art). Hold Up or Down to
  // fly; the ship fires on its own so Space can stay Spotify's. Enemies come
  // in from the far right, and one touching the ship pauses the song. On auto
  // the ship flies itself.

  const SHIP = [
    "##..............",
    "####............",
    ".#####..........",
    "..###########...",
    "..#######oo#####",
    "..###########...",
    ".#####..........",
    "####............",
    "##..............",
  ];
  const ALIENS = [
    {
      points: 10,
      wave: 0,
      rows: ["....####....", "..########..", ".##oo##oo##.", "############", "..##.##.##..", ".#........#."],
      step: ["..##.##.##..", "#..........#"],
    },
    {
      points: 15,
      wave: 16,
      rows: ["...####...", ".########.", "##o####o##", "##########", ".#.#..#.#.", "#.#....#.#"],
      step: [".#.#..#.#.", ".#.#..#.#."],
    },
    {
      points: 25,
      wave: 0,
      tank: true,
      rows: ["..########..", ".##########.", "###oo##oo###", "############", "############", ".##.####.##.", "##..####..##"],
      step: [".##.####.##.", ".##..##..##."],
    },
  ];
  const SHOOTER = { scale: 2, shipSpeed: 2.8, bulletSpeed: 8, top: 26, bottomPad: 10, shipOffset: 30 };
  let shooterSprites = null;
  const shooter = {
    y: 0,
    bullets: [],
    enemies: [],
    bursts: [],
    spawnIn: 0,
    fireIn: 0,
    score: 0,
    highScore: readHighScore(HIGH_SCORE_KEYS.shooter),
    up: false,
    down: false,
    time: 0,
    shot: -1,
  };
  const SHIP_W = SHIP[0].length * SHOOTER.scale;
  const SHIP_H = SHIP.length * SHOOTER.scale;

  const resetShooter = () => {
    const f = field();
    Object.assign(shooter, {
      y: (SHOOTER.top + f.floor - SHIP_H) / 2,
      bullets: [],
      enemies: [],
      bursts: [],
      spawnIn: 800,
      fireIn: 0,
      score: 0,
      up: false,
      down: false,
      time: 0,
      shot: -1,
    });
  };

  // The shooter's sky: stars at a few depths instead of clouds. Busy songs
  // stretch them into warp streaks.
  const stars = [];
  const newStar = (x, f) => ({ x, y: randomNum(16, Math.max(17, Math.round(f.floor) - 4)), depth: 0.25 + Math.random() * 0.75 });

  const updateStars = (dt) => {
    const f = field();
    if (!stars.length) for (let x = 0; x < game.width * SCALE; x += 14) stars.push(newStar(Math.random() * game.width * SCALE, f));
    const move = 1.2 * (1 + music.busy * 5) * (dt / FRAME_MS);
    for (const star of stars) {
      star.x -= move * star.depth;
      if (star.x < -40) Object.assign(star, newStar(game.width * SCALE + Math.random() * 20, f));
    }
  };

  const drawStars = (ctx, dpr) => {
    if (!stars.length) updateStars(0);
    const stretch = music.busy * 26;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.text;
    for (const star of stars) {
      const size = star.depth > 0.8 ? 2 : 1;
      ctx.globalAlpha = 0.2 + 0.5 * star.depth;
      ctx.fillRect(Math.round(star.x), Math.round(star.y), size + stretch * star.depth, size);
    }
    ctx.restore();
  };

  // With the song's analysis the gun fires in time: on whichever beat
  // division (quarter, half, whole or two beats) is closest to its rate.
  const gunSlot = (fireMs) => {
    if (music.beat < 0) return null;
    const beatMs = music.beatLen * 1000;
    const division = [0.25, 0.5, 1, 2].reduce((p, q) => (Math.abs(q * beatMs - fireMs) < Math.abs(p * beatMs - fireMs) ? q : p));
    return division >= 1 ? Math.floor(music.beat / division) : music.beat / division + Math.floor(music.phase / division);
  };

  // Enemies emerge at the end of the playfield, not the far edge of the pane,
  // and every one weaves up and down; the wave-flyer weaves the most.
  const spawnEnemy = (f, { tanks, sway }) => {
    const choices = ALIENS.map((alien, index) => ({ alien, index })).filter(({ alien }) => tanks || !alien.tank);
    const { alien, index } = choices[randomNum(0, choices.length - 1)];
    const w = alien.rows[0].length * SHOOTER.scale;
    const h = alien.rows.length * SHOOTER.scale;
    const amp = (alien.wave || randomNum(8, 16)) * sway;
    const top = SHOOTER.top + amp;
    const bottom = f.floor - SHOOTER.bottomPad - h - amp;
    const baseY = top + Math.random() * Math.max(0, bottom - top);
    shooter.enemies.push({
      alien,
      index,
      w,
      h,
      amp,
      period: randomNum(180, 320),
      phase: Math.random() * Math.PI * 2,
      x: f.right + 8,
      y: baseY,
      baseY,
      age: 0,
      dead: false,
      hit: false,
    });
  };

  const enemyY = (e, age) => e.baseY + Math.sin(age / e.period + e.phase) * e.amp;

  // Leads the nearest enemy ahead: aims where it will be when a shot arrives.
  const shooterAutopilot = (shipX, enemySpeed) => {
    const muzzle = shipX + SHIP_W;
    // An enemy about to reach the ship that the gun hasn't stopped: get out of
    // its way first, toward the side with room, and aim again after.
    const threat = shooter.enemies
      .filter((e) => !e.dead && e.x < muzzle + 90 && e.x + e.w > shipX - 4 && e.y < shooter.y + SHIP_H + 8 && e.y + e.h > shooter.y - 8)
      .sort((p, q) => p.x - q.x)[0];
    if (threat) {
      const top = SHOOTER.top + 2;
      const bottom = field().floor - SHOOTER.bottomPad - SHIP_H - 2;
      let down = threat.y + threat.h / 2 < shooter.y + SHIP_H / 2;
      if (down && shooter.y >= bottom) down = false;
      else if (!down && shooter.y <= top) down = true;
      shooter.up = !down;
      shooter.down = down;
      return;
    }
    const target = shooter.enemies.filter((e) => !e.dead && e.x + e.w > muzzle).sort((p, q) => p.x - q.x)[0];
    if (!target) {
      shooter.up = false;
      shooter.down = false;
      return;
    }
    const frames = Math.max(0, (target.x - muzzle) / (SHOOTER.bulletSpeed + enemySpeed));
    const aim = enemyY(target, target.age + frames * FRAME_MS) + target.h / 2 - SHIP_H / 2;
    shooter.up = aim < shooter.y - 2;
    shooter.down = aim > shooter.y + 2;
  };

  const shooterStep = (dt) => {
    const frames = dt / FRAME_MS;
    const f = field();
    const level = tune("shooter");
    const { enemySpeed, spawnEvery, fireMs, maxBullets } = level;
    const shipX = f.left + SHOOTER.shipOffset;
    shooter.time += dt;
    updateStars(dt);
    scrollGround((1.2 / SCALE) * frames);

    if (!game.manual) shooterAutopilot(shipX, enemySpeed);
    const direction = (shooter.down ? 1 : 0) - (shooter.up ? 1 : 0);
    shooter.y = Math.max(SHOOTER.top, Math.min(f.floor - SHOOTER.bottomPad - SHIP_H, shooter.y + direction * SHOOTER.shipSpeed * frames));

    const fire = () => shooter.bullets.push({ x: shipX + SHIP_W, y: shooter.y + SHIP_H / 2 - 1, dead: false });
    const slot = gunSlot(fireMs);
    if (slot !== null) {
      if (slot !== shooter.shot && shooter.bullets.length < maxBullets) fire();
      shooter.shot = slot;
    } else {
      shooter.fireIn -= dt;
      if (shooter.fireIn <= 0 && shooter.bullets.length < maxBullets) {
        fire();
        shooter.fireIn = fireMs;
      }
    }
    for (const bullet of shooter.bullets) bullet.x += SHOOTER.bulletSpeed * frames;

    shooter.spawnIn -= dt;
    if (shooter.spawnIn <= 0) {
      spawnEnemy(f, level);
      shooter.spawnIn = spawnEvery * (0.7 + Math.random() * 0.6);
    }
    for (const e of shooter.enemies) {
      e.x -= enemySpeed * frames;
      e.age += dt;
      e.y = enemyY(e, e.age);
    }

    for (const bullet of shooter.bullets) {
      for (const e of shooter.enemies) {
        if (bullet.dead || e.dead || !overlaps(bullet.x, bullet.y, 6, 2, e.x, e.y, e.w, e.h)) continue;
        bullet.dead = true;
        e.dead = true;
        shooter.score += e.alien.points;
        shooter.bursts.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, age: 0 });
      }
    }

    // The hitboxes are inset a few pixels so a graze isn't a crash.
    for (const e of shooter.enemies) {
      if (e.dead || e.hit || !overlaps(shipX + 3, shooter.y + 3, SHIP_W - 6, SHIP_H - 6, e.x + 2, e.y + 2, e.w - 4, e.h - 4)) continue;
      if (game.manual) {
        crashGame(shooter, HIGH_SCORE_KEYS.shooter);
        return;
      }
      e.hit = true;
    }

    for (const burst of shooter.bursts) burst.age += dt;
    shooter.bullets = shooter.bullets.filter((b) => !b.dead && b.x < f.right);
    shooter.enemies = shooter.enemies.filter((e) => !e.dead && e.x + e.w > 0);
    shooter.bursts = shooter.bursts.filter((b) => b.age < 320);
  };

  const drawShooter = (ctx, dpr) => {
    const f = field();
    const shipX = f.left + SHOOTER.shipOffset;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colors.accent;
    for (const bullet of shooter.bullets) ctx.fillRect(Math.round(bullet.x), Math.round(bullet.y), 6, 2);
    // Aliens step on every beat, or on their own when there's no analysis.
    const step = (music.beat >= 0 ? music.beat : Math.floor(shooter.time / 400)) % 2;
    for (const e of shooter.enemies) ctx.drawImage((step ? shooterSprites.steps : shooterSprites.aliens)[e.index], Math.round(e.x), Math.round(e.y), e.w, e.h);
    // Explosions: a ring of pixels flying outward.
    ctx.fillStyle = colors.text;
    for (const burst of shooter.bursts) {
      const r = 3 + burst.age / 22;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        ctx.fillRect(Math.round(burst.x + Math.cos(angle) * r) - 1, Math.round(burst.y + Math.sin(angle) * r) - 1, 2, 2);
      }
    }
    ctx.drawImage(shooterSprites.ship, Math.round(shipX), Math.round(shooter.y), SHIP_W, SHIP_H);
    ctx.restore();
  };

  // Geometry in game units, re-measured every frame from Spotify's layout.
  // The canvas covers the whole player pane, which is the sky clouds and
  // pterodactyls cross. The ground (also the progress bar) only runs under
  // Spotify's progress bar in the middle.
  const ground = { left: 0, right: 0, offsetY: 0 };

  const drawHorizon = (ctx, image, from, to) => {
    if (to <= from) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(from, -HEIGHT, to - from, HEIGHT * 3);
    ctx.clip();
    game.horizonSrc.forEach((sourceX, i) => {
      ctx.drawImage(
        image, sourceX, HORIZON.spriteY, HORIZON.width * 2, HORIZON.height * 2,
        ground.left + game.horizonX + i * HORIZON.width, HORIZON.yPos, HORIZON.width, HORIZON.height,
      );
    });
    ctx.restore();
  };

  const drawObstacle = (ctx, o) => {
    const sourceWidth = o.type.width * 2;
    const sourceX = sourceWidth * o.size * (0.5 * (o.size - 1)) + o.type.spriteX + sourceWidth * o.frame;
    ctx.drawImage(sheets.text, sourceX, 2, sourceWidth * o.size, o.type.height * 2, o.x, o.y, o.width, o.type.height);
  };

  const setFont = (ctx, align) => {
    ctx.font = `${11 / SCALE}px "JetBrains Mono", Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = align;
  };

  // Score in the game's own "HI 00123 00045" format at the pane's top right,
  // in the terminal font so it stays readable.
  const drawScore = (ctx, current, high, flashing) => {
    const pad = (n) => String(n).padStart(5, "0");
    setFont(ctx, "right");
    const text = flashing ? "     " : pad(current);
    const right = game.width - 20 / SCALE;
    const top = 24 / SCALE;
    ctx.fillStyle = colors.text;
    ctx.fillText(text, right, top);
    if (high) {
      ctx.fillStyle = colors.dim;
      ctx.fillText(`HI ${pad(high)}  `, right - ctx.measureText(text).width, top);
    }
  };

  const drawHint = (ctx, text, y = 48) => {
    setFont(ctx, "center");
    ctx.fillStyle = colors.dim;
    ctx.fillText(text, (ground.left + ground.right) / 2, y);
  };

  // GAME OVER and the restart icon over the ground, drawn larger to stay legible.
  const drawGameOver = (ctx, top = 34) => {
    const zoom = 0.9 / SCALE;
    const center = (ground.left + ground.right) / 2;
    const textW = GAME_OVER.textWidth * zoom;
    const textH = GAME_OVER.textHeight * zoom;
    ctx.drawImage(sheets.text, GAME_OVER.textX, GAME_OVER.textY, GAME_OVER.textWidth * 2, GAME_OVER.textHeight * 2, center - textW / 2, top, textW, textH);
    const iconW = GAME_OVER.restartWidth * zoom;
    const iconH = GAME_OVER.restartHeight * zoom;
    ctx.drawImage(sheets.text, GAME_OVER.restartX, GAME_OVER.restartY, GAME_OVER.restartWidth * 2, GAME_OVER.restartHeight * 2, center - iconW / 2, top + 30, iconW, iconH);
    setFont(ctx, "left");
    ctx.fillStyle = colors.dim;
    ctx.fillText("space or \u2191 to restart", center + iconW / 2 + 14 / SCALE, top + 30 + iconH / 2 - 6 / SCALE);
  };

  const drawGround = (ctx, playhead) => {
    // The ground doubles as the progress bar: played in the accent color.
    drawHorizon(ctx, sheets.accent, ground.left, playhead);
    drawHorizon(ctx, sheets.dim, playhead, ground.right);
  };

  const draw = (ctx, playhead, now, dpr) => {
    ctx.clearRect(0, 0, game.width, game.height);
    ctx.save();
    ctx.translate(0, ground.offsetY);
    if (game.kind === "shooter") drawStars(ctx, dpr);
    else for (const cloud of game.clouds) {
      ctx.drawImage(sheets.cloud, CLOUD.spriteX, 2, CLOUD.width * 2, CLOUD.height * 2, cloud.x, cloud.y, CLOUD.width, CLOUD.height);
    }

    if (game.kind === "flappy") {
      // Middle of flappy's arena, in the game units this pass is drawn in.
      const middle = (FLAPPY.ceiling + arena().floor) / 2 / SCALE - ground.offsetY;
      drawFlyby(ctx);
      drawPipes(ctx, dpr);
      drawGround(ctx, playhead);
      drawBird(ctx, dpr);
      if (game.manual && game.crashed) drawGameOver(ctx, middle - 30);
      else if (game.manual && !flappy.started) drawHint(ctx, "\u2191 flap", middle - 8);
      ctx.restore();
      if (game.manual) drawScore(ctx, flappy.score, flappy.highScore, false);
      return;
    }

    if (game.kind === "shooter") {
      const middle = (FLAPPY.ceiling + field().floor) / 2 / SCALE - ground.offsetY;
      drawGround(ctx, playhead);
      drawShooter(ctx, dpr);
      if (game.manual && game.crashed) drawGameOver(ctx, middle - 30);
      else if (game.manual && shooter.time < GAME.clearTime) drawHint(ctx, "\u2191 \u2193 move   it fires on its own", middle - 8);
      ctx.restore();
      if (game.manual) drawScore(ctx, shooter.score, shooter.highScore, false);
      return;
    }

    drawFlyby(ctx);
    drawGround(ctx, playhead);
    // Pterodactyls fly the whole pane; cacti only show where there's ground.
    for (const o of game.obstacles) if (o.type.type === "pterodactyl") drawObstacle(ctx, o);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ground.left, -HEIGHT, ground.right - ground.left, HEIGHT * 3);
    ctx.clip();
    for (const o of game.obstacles) if (o.type.type !== "pterodactyl") drawObstacle(ctx, o);
    ctx.restore();
    const t = game.trex;
    const width = t.ducking ? TREX.widthDuck : TREX.width;
    const frameX = ANIM[t.status].frames[t.frame] ?? 0;
    const sx = TREX.spriteX + frameX * 2;
    const nod = (t.status === "running" || t.status === "jumping") && !t.ducking ? music.nod : 0;
    if (nod) {
      const [rows, cols] = [TREX.headRows, TREX.headX];
      ctx.drawImage(sheets.text, sx, 2 + rows * 2, width * 2, (TREX.height - rows) * 2, t.x, t.y + rows, width, TREX.height - rows);
      ctx.drawImage(sheets.text, sx, 2, cols * 2, rows * 2, t.x, t.y, cols, rows);
      ctx.drawImage(sheets.text, sx + cols * 2, 2, (width - cols) * 2, rows * 2, t.x + cols, t.y + nod, width - cols, rows);
    } else {
      ctx.drawImage(sheets.text, sx, 2, width * 2, TREX.height * 2, t.x, t.y, width, TREX.height);
    }
    if (game.manual && game.crashed) drawGameOver(ctx);
    if (game.manual && !game.crashed && game.time < GAME.clearTime) drawHint(ctx, "\u2191 jump   \u2193 duck");
    ctx.restore();
    if (game.manual) {
      // Flashes every 100 points, like the game.
      const since = now - game.flashFrom;
      drawScore(ctx, score(), game.highScore, since < 1500 && Math.floor(since / 250) % 2 === 0);
    }
  };

  // Scatter clouds across the sky on first load instead of waiting for them
  // to drift in from the right.
  const seedClouds = () => {
    for (let x = randomNum(0, CLOUD.maxGap); x < game.width; x += randomNum(CLOUD.minGap, CLOUD.maxGap) * 1.5) {
      game.clouds.push({ x, y: cloudY(), gap: randomNum(CLOUD.minGap, CLOUD.maxGap) });
    }
  };

  const canvas = el("canvas", "tty-runner");
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  let lastFrame = 0;
  let lastDraw = 0;

  const frame = (now) => {
    requestAnimationFrame(frame);
    const pane = document.querySelector(":is([data-testid=now-playing-bar])");
    const bar = document.querySelector("[data-testid=now-playing-bar] [data-testid=playback-progressbar]");
    if (!pane || !bar || !sheets || !birdSprites || !shooterSprites || !ctx) return;
    if (game.view === "compact") return;
    if (canvas.parentElement !== pane) pane.prepend(canvas);

    const dpr = window.devicePixelRatio || 1;
    const paneRect = pane.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    if (canvas.width !== Math.round(paneRect.width * dpr) || canvas.height !== Math.round(paneRect.height * dpr)) {
      canvas.width = Math.round(paneRect.width * dpr);
      canvas.height = Math.round(paneRect.height * dpr);
    }
    game.width = paneRect.width / SCALE;
    game.height = paneRect.height / SCALE;
    ground.left = (barRect.left - paneRect.left) / SCALE;
    ground.right = (barRect.right - paneRect.left) / SCALE;
    ground.offsetY = (barRect.top + barRect.height / 2 - paneRect.top) / SCALE - GROUND_LINE;
    while (game.horizonSrc.length < Math.ceil((ground.right - ground.left) / HORIZON.width) + 1) game.horizonSrc.push(randomHorizon());
    // After switching games, redo the clouds once the pane has finished resizing.
    if (now >= game.reseedAt) {
      game.clouds = [];
      game.reseedAt = Infinity;
    }
    if (!game.clouds.length) seedClouds();

    const s = state();
    const playing = s.isPaused === false;
    const track = s.item?.uri ?? s.item?.name ?? "";
    if (track !== game.track) {
      game.track = track;
      game.analysis = null;
      showLyrics(null);
      loadSong(s.item?.uri);
      resetAll(); // Every song starts a fresh run, like a new level.
    }
    // Resumed from Spotify's own play button after a crash: new run. Spotify
    // takes a few frames to report the crash's pause, so wait to see it first.
    if (game.crashed && !playing) game.pauseSeen = true;
    if (game.crashed && playing && game.pauseSeen) restart();

    const dt = lastFrame ? Math.min(250, now - lastFrame) : 0;
    lastFrame = now;

    const fraction = s.duration ? Math.min(1, Math.max(0, position(s) / s.duration)) : 0;
    game.fraction = fraction;
    const songTime = position(s) / 1000;
    // A seek: re-find the next beat on the course.
    if (Math.abs(songTime - game.lastSongTime) > 1.5) {
      game.beatNext = -1;
      flappy.beatNext = -1;
    }
    game.lastSongTime = songTime;
    updateMusic(songTime, dt, playing);
    updateLyrics(position(s), fraction);
    const playhead = ground.left + fraction * (ground.right - ground.left);
    const active = playing && !game.crashed && !reduceMotion;
    // The games run in steps of at most one 60fps frame. A slow frame (a busy
    // app, one of Spotify's heavier views) is split into several, so jumps
    // and flaps keep pace with obstacles placed from the song's clock; one
    // long step let them fall behind and the autopilot miss.
    const run = (stepFn) => {
      const steps = Math.max(1, Math.ceil(dt / FRAME_MS));
      const sub = dt / steps;
      for (let i = steps - 1; i >= 0; i--) {
        game.lastSongTime = songTime - (i * sub) / 1000;
        stepFn(sub, now - i * sub);
        if (game.crashed) break;
      }
      game.lastSongTime = songTime;
    };
    if (game.kind === "flappy") {
      if (active) run(flappyStep);
      else if (now - lastDraw < 100) return;
    } else if (game.kind === "shooter") {
      if (active) run(shooterStep);
      else if (now - lastDraw < 100) return;
    } else {
      // On auto he rides the playhead, starting a few pixels in so the ground
      // shows behind his tail (his outline is drawn in the background color).
      game.trex.x = game.manual ? ground.left + PLAY_X : Math.max(ground.left + 8, Math.min(ground.right - TREX.width, playhead - TREX_FRONT));
      if (active) {
        run(step);
      } else {
        if (!game.crashed) idle(now);
        // Nothing moves while paused except the odd blink.
        if (now - lastDraw < 100) return;
      }
    }

    lastDraw = now;
    ctx.setTransform(dpr * SCALE, 0, 0, dpr * SCALE, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    draw(ctx, playhead, now, dpr);
  };

  requestAnimationFrame(frame);

  // ---- Game mode ----------------------------------------------------------------

  // game / mode / level switches live on the player pane's top border, like a
  // status line. The active choice is filled in; on auto the level follows the
  // song, so that switch just shows what it picked.
  const makeSwitch = (label, options, onPick) => {
    const wrap = el("div", "tty-mode");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", label);
    const group = el("div", "tty-mode-options");
    const buttons = options.map(([value, text, short, title]) => {
      const button = el("button", "tty-mode-option", text);
      button.type = "button";
      button.title = title;
      button.dataset.value = value;
      button.dataset.short = short;
      button.addEventListener("click", () => {
        if (button.disabled) return;
        onPick(value);
        button.blur(); // So the keys go to the game, not this button.
      });
      return button;
    });
    group.append(...buttons);
    wrap.append(el("span", "tty-mode-label", label), group);
    const select = (value) => {
      for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.value === value));
    };
    const setDisabled = (disabled, title) => {
      wrap.classList.toggle("tty-mode--disabled", disabled);
      for (const button of buttons) {
        button.disabled = disabled;
        if (title) button.title = title;
      }
    };
    return { wrap, select, setDisabled, buttons };
  };

  const gameSwitch = makeSwitch(
    "game",
    [
      ["dino", "dino", "dino", "The Chrome dino runner"],
      ["flappy", "flappy", "flap", "Fly through the pipes"],
      ["shooter", "shooter", "shoot", "Side-scrolling shooter"],
    ],
    (kind) => setGame(kind, game.manual),
  );
  const modeSwitch = makeSwitch(
    "mode",
    [
      ["auto", "auto", "auto", "Plays itself along with the song"],
      ["play", "play", "play", "You play. \u2191 jumps or flaps, \u2193 ducks, the shooter moves with \u2191\u2193. Crashing pauses the song; space resumes."],
    ],
    (value) => setGame(game.kind, value === "play"),
  );
  const levelSwitch = makeSwitch(
    "level",
    [
      ["easy", "easy", "e", "Easy"],
      ["medium", "med", "m", "Medium: each game's normal pace"],
      ["hard", "hard", "h", "Hard"],
    ],
    (value) => setLevel(value),
  );
  const lookSwitch = makeSwitch(
    "look",
    [
      ["terminal", "terminal", "term", "The terminal look everywhere"],
      ["spotify", "spotify", "spot", "Spotify's normal look; only the player bar stays terminal"],
    ],
    (value) => setLook(value),
  );
  const viewSwitch = makeSwitch(
    "view",
    [
      ["games", "games", "games", "The tall player bar with the games"],
      ["compact", "compact", "min", "A regular-size player bar, no games"],
    ],
    (value) => setView(value),
  );
  const levelTitles = levelSwitch.buttons.map((button) => button.title);

  const refreshSwitches = () => {
    lookSwitch.select(game.look);
    viewSwitch.select(game.view);
    gameSwitch.select(game.kind);
    modeSwitch.select(game.manual ? "play" : "auto");
    levelSwitch.select(level());
    if (game.manual) {
      levelSwitch.setDisabled(false);
      levelSwitch.buttons.forEach((button, i) => (button.title = levelTitles[i]));
    } else {
      levelSwitch.setDisabled(true, "On auto the level follows the song's pace. Switch to play to pick one.");
    }
  };

  const resetAll = () => {
    game.crashed = false;
    resetRun();
    resetFlappy();
    resetShooter();
  };

  const setGame = (kind, manual) => {
    if (kind !== game.kind || manual !== game.manual) {
      game.kind = kind;
      game.manual = manual;
      resetAll();
      try {
        localStorage.setItem(GAME_KEY, kind);
      } catch {
        // Storage unavailable; the game resets to dino next launch.
      }
    }
    refreshSwitches();
  };

  const remember = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; this resets next launch.
    }
  };

  const setLook = (look) => {
    game.look = look;
    root.classList.toggle("tty-spotify", look === "spotify");
    remember(LOOK_KEY, look);
    if (sheet.complete) buildSprites(); // Recolor the games for this look.
    refreshSwitches();
  };

  // Compact hands the keys back to Spotify and hides the games.
  const setView = (view) => {
    if (view === game.view) return;
    game.view = view;
    root.classList.toggle("tty-compact", view === "compact");
    remember(VIEW_KEY, view);
    if (view === "compact") {
      setGame(game.kind, false);
    } else {
      game.reseedAt = performance.now() + 350; // New sky once the pane has grown.
      resetAll();
    }
    refreshSwitches();
  };

  const setLevel = (value) => {
    if (value === game.level) return;
    game.level = value;
    try {
      localStorage.setItem(LEVEL_KEY, value);
    } catch {
      // Storage unavailable; the level resets to medium next launch.
    }
    resetAll();
    refreshSwitches();
  };

  // Pick up the last level and game. Mode always starts on auto, so a game
  // left on play can't pause the song unannounced when Spotify opens.
  let savedGame = "dino";
  let savedLook = "terminal";
  let savedView = "games";
  try {
    if (localStorage.getItem(LOOK_KEY) === "spotify") savedLook = "spotify";
    if (localStorage.getItem(VIEW_KEY) === "compact") savedView = "compact";
    const savedLevel = localStorage.getItem(LEVEL_KEY);
    if (savedLevel && LEVELS.dino[savedLevel]) game.level = savedLevel;
    const lastGame = localStorage.getItem(GAME_KEY);
    if (lastGame && LEVELS[lastGame]) savedGame = lastGame;
  } catch {
    // Storage unavailable; start on dino, medium.
  }
  setGame(savedGame, false);
  setLook(savedLook);
  setView(savedView);

  // Text fields, menus, lists and dialogs keep their own arrow keys.
  const OWN_KEYS = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role=menu], [role=listbox], [role=grid], [role=treegrid], [role=dialog]";
  const ownsKeys = (target) => target instanceof Element && Boolean(target.closest(OWN_KEYS));

  // While you're playing, the arrow keys belong to the game: Up jumps or flaps,
  // Down ducks. Space stays Spotify's play/pause, and resuming after a crash
  // starts a new run. Keys in text fields, menus and lists are left alone.
  // The shooter flies while Up or Down is held.
  const shooterKey = (event) => {
    const isUp = event.code === "ArrowUp";
    const isDown = event.code === "ArrowDown";
    if (!isUp && !isDown) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pressed = event.type === "keydown";
    if (pressed && !event.repeat && game.crashed) {
      if (isUp) restart();
      return;
    }
    if (pressed && !event.repeat && state().isPaused) {
      if (isUp) player.resume?.();
      return;
    }
    if (isUp) shooter.up = pressed;
    if (isDown) shooter.down = pressed;
  };

  const onKey = (event) => {
    if (!game.manual || event.metaKey || event.ctrlKey || event.altKey || ownsKeys(event.target)) return;
    if (game.kind === "shooter") return shooterKey(event);
    const isJump = event.code === "ArrowUp";
    const isDuck = event.code === "ArrowDown" && game.kind === "dino";
    if (!isJump && !isDuck) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (game.kind === "flappy") {
      if (event.type === "keyup" || event.repeat) return;
      if (game.crashed) restart();
      else if (state().isPaused) player.resume?.();
      else flap();
      return;
    }

    const t = game.trex;
    if (event.type === "keyup") {
      if (isJump) endJump();
      if (isDuck) {
        keys.duck = false;
        t.speedDrop = false;
        duck(false);
      }
      return;
    }
    if (event.repeat) return;
    if (game.crashed) {
      if (isJump) restart();
    } else if (state().isPaused) {
      if (isJump) player.resume?.();
    } else if (isJump) {
      startJump();
    } else {
      keys.duck = true;
      if (t.jumping) {
        t.speedDrop = true;
        t.velocity = 1;
      } else {
        duck(true);
      }
    }
  };

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);

  // ---- Spotify's controls, on the top border -------------------------------------
  //
  // In the games view the right side belongs to the up-next pane, so the queue,
  // devices, miniplayer, full screen and volume controls live up here as
  // switches. Each one clicks Spotify's own button (hidden, not removed), so
  // they behave exactly like the originals.

  const SPOTIFY_BUTTONS = [
    ["queue", "queue", "q", "Queue", '[data-testid="control-button-queue"]'],
    ["devices", "devices", "dev", "Connect to a device", ".tty-extra button:not([data-testid])"],
    ["mini", "mini", "mini", "Miniplayer", '[data-testid="pip-toggle-button"]'],
    ["full", "full", "full", "Full screen", '[data-testid="fullscreen-mode-button"]'],
  ];
  const spotifyButton = (value) => document.querySelector(SPOTIFY_BUTTONS.find(([v]) => v === value)[4]);

  const refreshSpotifyButtons = () => {
    for (const button of showSwitch.buttons) {
      const original = spotifyButton(button.dataset.value);
      button.disabled = !original || original.disabled;
      button.setAttribute("aria-pressed", String(original?.getAttribute("aria-pressed") === "true"));
    }
  };

  const showSwitch = makeSwitch(
    "show",
    SPOTIFY_BUTTONS.map(([value, text, short, title]) => [value, text, short, title]),
    (value) => {
      spotifyButton(value)?.click();
      setTimeout(refreshSpotifyButtons, 150);
    },
  );
  showSwitch.wrap.classList.add("tty-mode--spotify");

  const volumeWrap = el("div", "tty-mode tty-mode--spotify");
  volumeWrap.setAttribute("role", "group");
  volumeWrap.setAttribute("aria-label", "volume");
  const muteButton = el("button", "tty-vol-mute", "vol");
  muteButton.type = "button";
  muteButton.title = "Mute";
  const volumeBar = el("div", "tty-mode-options tty-vol");
  volumeBar.tabIndex = 0;
  volumeBar.setAttribute("role", "slider");
  volumeBar.setAttribute("aria-label", "Volume");
  volumeBar.setAttribute("aria-valuemin", "0");
  volumeBar.setAttribute("aria-valuemax", "100");
  const volumeCells = Array.from({ length: 10 }, () => el("span", "tty-vol-cell"));
  volumeBar.append(...volumeCells);
  volumeWrap.append(muteButton, volumeBar);

  const currentVolume = () => {
    const v = S.Platform.PlaybackAPI?._volume;
    return typeof v === "number" ? v : 0;
  };
  const showVolume = (v = currentVolume()) => {
    const percent = Math.round(v * 100);
    volumeCells.forEach((cell, i) => cell.classList.toggle("is-on", i < Math.round(v * 10)));
    volumeBar.setAttribute("aria-valuenow", String(percent));
    volumeBar.title = `Volume ${percent}%`;
    muteButton.textContent = v === 0 ? "mute" : "vol";
    muteButton.title = v === 0 ? "Unmute" : "Mute";
  };
  const setVolume = (v) => {
    const clamped = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    S.Platform.PlaybackAPI?.setVolume?.(clamped);
    showVolume(clamped);
  };
  // Snaps to the cells: the first cell is 10%, and left of it is silence.
  const volumeAt = (event) => {
    const r = volumeBar.getBoundingClientRect();
    const ratio = (event.clientX - r.left) / r.width;
    return ratio < 0.03 ? 0 : Math.ceil(ratio * 10) / 10;
  };
  volumeBar.addEventListener("pointerdown", (event) => {
    volumeBar.setPointerCapture(event.pointerId);
    setVolume(volumeAt(event));
  });
  volumeBar.addEventListener("pointermove", (event) => {
    if (volumeBar.hasPointerCapture(event.pointerId)) setVolume(volumeAt(event));
  });
  volumeBar.addEventListener("pointerup", () => volumeBar.blur());
  volumeBar.addEventListener("wheel", (event) => {
    event.preventDefault();
    setVolume(currentVolume() + (event.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
  volumeBar.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    setVolume(currentVolume() + (event.key === "ArrowRight" ? 0.1 : -0.1));
  });
  muteButton.addEventListener("click", () => {
    document.querySelector('[data-testid="volume-bar-toggle-mute-button"]')?.click();
    setTimeout(showVolume, 150);
    muteButton.blur();
  });

  const gamesBar = el("div", "tty-switchbar tty-switchbar--games");
  gamesBar.append(gameSwitch.wrap, modeSwitch.wrap, levelSwitch.wrap);
  const settingsBar = el("div", "tty-switchbar tty-switchbar--settings");
  settingsBar.append(lookSwitch.wrap, viewSwitch.wrap, showSwitch.wrap, volumeWrap);

  const placeSwitches = () => {
    const pane = document.querySelector(":is([data-testid=now-playing-bar])");
    if (!pane) return;
    for (const bar of [settingsBar, gamesBar, lyricBar]) if (bar.parentElement !== pane) pane.append(bar);
    // Room between the pane title and the right edge, less a gap between bars.
    const room = pane.clientWidth - 96 - 14 - 24;
    // Shrinks in steps when the window is narrow: labels go first, then the
    // options switch to short names.
    for (const step of ["", "tty-switchbar--compact", "tty-switchbar--compact tty-switchbar--tight"]) {
      settingsBar.className = `tty-switchbar tty-switchbar--settings ${step}`.trim();
      gamesBar.className = `tty-switchbar tty-switchbar--games ${step}`.trim();
      const used = settingsBar.offsetWidth + (game.view === "compact" ? 0 : gamesBar.offsetWidth);
      if (used <= room) break;
    }
    // The lyric line takes whatever border is left between the two bars.
    const from = settingsBar.offsetLeft + settingsBar.offsetWidth + 12;
    const to = gamesBar.offsetLeft - 12;
    lyricBar.style.left = `${from}px`;
    lyricBar.style.width = `${Math.max(0, to - from)}px`;
    lyricBar.hidden = to - from < 80;
    // Both side panes get one width: the narrower side's, less a gap from
    // the song controls, at most 560px. Spotify's two side columns differ by
    // a few pixels, and matching panes is the point.
    const sides = [".tty-left", ".tty-right"].map((q) => document.querySelector(q));
    if (sides.every(Boolean)) {
      const inner = (node) => {
        const cs = getComputedStyle(node);
        return node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      };
      const width = Math.max(200, Math.min(560, ...sides.map((side) => inner(side) - 24)));
      if (pane.style.getPropertyValue("--tty-side-width") !== `${width}px`) pane.style.setProperty("--tty-side-width", `${width}px`);
    }
  };

  window.addEventListener("resize", placeSwitches);

  // ---- Listening stats on Home -----------------------------------------------------
  //
  // Spotify doesn't give this client listening minutes or top tracks (its Web
  // API answers it with rate limits), so the theme keeps its own tally in
  // localStorage from the day it's installed: time played today and this
  // month, and this month's plays per song and artist. A play counts after 30
  // seconds, like a Spotify stream. Until this month has a few plays, the top
  // lists come from the player's recent history (its last ~50 tracks).

  const STATS_KEY = "tty-stats";
  const PLAY_MS = 30000;
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);

  const loadStats = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null");
      if (saved?.v === 1) return saved;
    } catch {
      // Unreadable; start a fresh tally.
    }
    return { v: 1, since: dayKey(), days: {}, months: {} };
  };
  const stats = loadStats();
  const session = { ms: 0, songs: 0 };
  const listen = { uri: null, ms: 0, counted: false, lastAt: 0 };
  let statsDirty = false;
  let statsSavedAt = Date.now();

  const saveStats = () => {
    statsSavedAt = Date.now();
    if (!statsDirty) return;
    // Only today and this month are shown, so only they are kept.
    for (const day of Object.keys(stats.days)) if (day !== dayKey()) delete stats.days[day];
    for (const month of Object.keys(stats.months)) if (month !== monthKey()) delete stats.months[month];
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
      statsDirty = false;
    } catch {
      // Storage full or blocked; keep counting in memory.
    }
  };
  window.addEventListener("beforeunload", saveStats);

  // Called every tick: adds the time since the last one while something plays.
  const countListening = (s) => {
    const now = Date.now();
    const item = s.item;
    const dt = listen.lastAt ? Math.min(2000, now - listen.lastAt) : 0;
    listen.lastAt = now;
    if ((item?.uri ?? null) !== listen.uri) {
      Object.assign(listen, { uri: item?.uri ?? null, ms: 0, counted: false });
      loadRecent();
      setTimeout(loadRecent, 2000);
    }
    if (s.isPaused === false && item?.uri && dt) {
      const month = (stats.months[monthKey()] ??= { ms: 0, plays: 0, tracks: {}, artists: {} });
      const artist = item.artists?.[0]?.name ?? "";
      const track = (month.tracks[item.uri] ??= { name: item.name ?? "", artist, ms: 0, plays: 0 });
      const byArtist = artist ? (month.artists[artist] ??= { ms: 0, plays: 0 }) : null;
      session.ms += dt;
      listen.ms += dt;
      month.ms += dt;
      track.ms += dt;
      if (byArtist) byArtist.ms += dt;
      stats.days[dayKey()] = (stats.days[dayKey()] ?? 0) + dt;
      if (!listen.counted && listen.ms >= PLAY_MS) {
        listen.counted = true;
        session.songs++;
        month.plays++;
        track.plays++;
        if (byArtist) byArtist.plays++;
      }
      statsDirty = true;
    }
    if (now - statsSavedAt > 10000) saveStats();
  };

  // The player's recent history, for the top lists while this month's tally
  // is still thin. It reloads whenever the player says the history changed,
  // on every track change as a backup (the history can lag the switch by a
  // moment), and every few minutes regardless.
  let recent = [];
  let recentAt = 0;
  let recentLoads = 0;
  const loadRecent = async () => {
    recentAt = Date.now();
    const load = ++recentLoads;
    try {
      const items = (await S.Platform.PlayHistoryAPI?.getContents?.())?.items ?? [];
      if (load === recentLoads) recent = items; // A newer load wins.
    } catch {
      // Keep the last list.
    }
  };
  try {
    S.Platform.PlayHistoryAPI?.getEvents?.()?.addListener?.("update", () => loadRecent());
  } catch {
    // No history events on this version; the track-change reload covers it.
  }

  const minutes = (ms) => Math.floor(ms / 60000);
  const hoursMinutes = (ms) => {
    const m = minutes(ms);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

  const statsRows = () => {
    const month = stats.months[monthKey()] ?? { ms: 0, plays: 0, tracks: {}, artists: {} };
    const monthName = MONTHS[new Date().getMonth()];
    const day = Number(stats.since.slice(8));
    const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
    // In the month the tally started, say so: the total isn't the whole month.
    const since = stats.since.slice(0, 7) === monthKey() ? `since the ${day}${suffix}` : "this month";
    const byPlays = (p, q) => q[1].plays - p[1].plays || q[1].ms - p[1].ms;
    let songs = Object.values(month.tracks).filter((t) => t.plays > 0).sort((p, q) => q.plays - p.plays || q.ms - p.ms).slice(0, 3).map((t) => [t.name, t.artist, `${t.plays}x`]);
    let songsTitle = `top songs · ${monthName}`;
    if (songs.length < 3) {
      // Before the current song, which the now-playing pane already shows.
      songsTitle = "recently played";
      const current = state().item?.uri;
      songs = recent.filter((t) => t.uri !== current).slice(0, 3).map((t) => [t.name ?? "", t.artists?.[0]?.name ?? "", ""]);
    }
    let artists = Object.entries(month.artists).filter(([, a]) => a.plays > 0).sort(byPlays).slice(0, 3).map(([name, a]) => [name, "", `${a.plays} play${a.plays === 1 ? "" : "s"}`]);
    let artistsTitle = `top artists · ${monthName}`;
    if (artists.length < 3) {
      artistsTitle = "top artists · recent";
      const counts = new Map();
      for (const t of recent) {
        const name = t.artists?.[0]?.name;
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      artists = [...counts].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([name, n]) => [name, "", `${n} of ${recent.length}`]);
    }
    return {
      cards: [
        ["session", hoursMinutes(session.ms), `${session.songs} song${session.songs === 1 ? "" : "s"}`],
        ["today", hoursMinutes(stats.days[dayKey()] ?? 0), ""],
        [monthName, `${minutes(month.ms).toLocaleString()} min`, `${month.plays} play${month.plays === 1 ? "" : "s"} · ${since}`],
      ],
      lists: [
        [songsTitle, songs],
        [artistsTitle, artists],
      ],
    };
  };

  const renderStats = () => {
    const home = document.querySelector('[data-testid="home-page"]');
    if (!home) return;
    if (Date.now() - recentAt > 5 * 60000) loadRecent();
    let block = home.querySelector(":scope > .tty-stats");
    if (!block) {
      block = el("section", "tty-stats");
      block.setAttribute("aria-label", "Listening stats");
      home.prepend(block);
    }
    const rows = statsRows();
    const signature = JSON.stringify(rows);
    if (block.dataset.signature === signature) return;
    block.dataset.signature = signature;

    const out = document.createDocumentFragment();
    for (const [label, value, note] of rows.cards) {
      const card = el("div", "tty-stats-card");
      card.append(el("div", "tty-stats-label", label), el("div", "tty-stats-value", value), el("div", "tty-stats-note", note || " "));
      out.append(card);
    }
    for (const [title, items] of rows.lists) {
      const list = el("div", "tty-stats-list");
      list.append(el("div", "tty-stats-label", title));
      const ol = el("ol");
      if (!items.length) ol.append(el("li", "tty-stats-empty", "nothing yet"));
      items.forEach(([name, by, count], i) => {
        const li = el("li");
        li.title = by ? `${name} - ${by}` : name;
        li.append(el("span", "tty-stats-num", String(i + 1).padStart(2, "0")), el("span", "tty-stats-name", name));
        if (by) li.append(el("span", "tty-stats-by", by));
        if (count) li.append(el("span", "tty-stats-count", count));
        ol.append(li);
      });
      list.append(ol);
      out.append(list);
    }
    block.replaceChildren(out);
  };

  // ---- Loop -------------------------------------------------------------------

  const tick = () => {
    const s = state();
    root.classList.toggle("tty-playing", s.isPaused === false);
    renderPrompt();
    countListening(s);
    renderStats();
    placeSwitches();
    placeQueue();
    renderQueue();
    placeConsole();
    refreshSpotifyButtons();
    if (!volumeBar.matches(":active")) showVolume();
  };

  tick();
  setInterval(tick, 500);
})();
