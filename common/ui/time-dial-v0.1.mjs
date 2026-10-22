// Time dial and Play (Common UI since 2026-10-22; written for the Offset page 2026-10-15 … 2026-10-22).
// One clock, any number of dials that show it, one Play that runs it. A mechanism only: the consumer decides what
// the clock means, the dial's end, each copy's window, the phase label and what a new time draws (`onChange`).
//
// - A dial is `[data-time-dial]` holding Play (`[data-time-play]`), the speed button (`[data-time-speed]`), a range
//   (`[data-time-range]`) and the output button (`[data-time-output]`: "Off", or "T s · phase"; pressing it turns the
//   clock off).
// - Play runs the clock at real time × the speed and draws at most every `frameMs` (30 frames a second: a slower
//   device draws fewer frames, the clock follows real time). It stops at the dial's end or the copy's window end;
//   pressing Play again, moving a range or turning the clock off stops it.
// - The speed button steps through `speeds` (default 1× → 2× → 1×, owner 2026-10-22); any other value plays at the
//   nearest step at or below it, never above the last. A change during Play keeps the clock where it is. Every
//   dial shows the one speed.

export const TIME_DIAL_V0_1 = Object.freeze({ id: "common-time-dial-v0.1", version: "0.1.0" });
export const TIME_PLAY_SPEEDS_DEFAULT = Object.freeze([1, 2]);
export const TIME_PLAY_FRAME_MS_DEFAULT = 1000 / 30;

// One dial's markup. The labels name the consumer's clock (the Offset page: "… time after IP", "Seconds after IP").
export function timeDialMarkup({ id, groupLabel, rangeLabel, outputTitle, speed = TIME_PLAY_SPEEDS_DEFAULT[0], speeds = TIME_PLAY_SPEEDS_DEFAULT }) {
  const speedTitle = `Play speed: press for the next (${speeds.map((step) => `${step}×`).join(", ")} real time)`;
  return `<div class="diagram-action-row time-dial" data-time-dial="${id}" role="group" aria-label="${groupLabel}"><span class="diagram-control-label">Time</span><button class="capture-button time-dial-play" type="button" data-time-play aria-pressed="false" title="Play the time dial">Play</button><button class="capture-button time-dial-speed" type="button" data-time-speed title="${speedTitle}">${speed}×</button><input class="time-dial-range" type="range" min="0" max="1" step="1" value="0" data-time-range aria-label="${rangeLabel}"><button class="capture-button diagram-scale-output time-dial-output" type="button" data-time-output aria-pressed="false" title="${outputTitle}">Off</button></div>`;
}

// The one Play of a page. onStop({ redraw }): Play stopped; `redraw` is false when the caller sets the clock next.
export function createTimePlayer({
  root = globalThis.document,
  speeds = TIME_PLAY_SPEEDS_DEFAULT,
  frameMs = TIME_PLAY_FRAME_MS_DEFAULT,
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (frame) => cancelAnimationFrame(frame),
  onStop = () => {},
} = {}) {
  let playing = null;
  let speed = speeds[0];

  function setPlayButtons(on) {
    root.querySelectorAll("[data-time-dial] [data-time-play]").forEach((button) => {
      button.setAttribute("aria-pressed", String(on));
      button.textContent = on ? "Pause" : "Play";
    });
  }

  function stop({ redraw = true } = {}) {
    if (playing) cancelFrame(playing.frame);
    playing = null;
    setPlayButtons(false);
    onStop({ redraw });
  }

  function setSpeed(requested) {
    // Any other value plays at the nearest step at or below it: never above the last step.
    const next = speeds.findLast((step) => step <= requested) ?? speeds[0];
    if (playing) {
      // Keep the clock where it is and go on at the new speed.
      const at = now();
      playing.startSec += ((at - playing.startedAt) / 1000) * speed;
      playing.startedAt = at;
    }
    speed = next;
    root.querySelectorAll("[data-time-dial] [data-time-speed]").forEach((button) => { button.textContent = `${next}×`; });
  }

  // onChange(timeSec | null, { playing }): the new clock. startSec: where Play from off, from the end or from before
  // it starts begins (default 0); endSec: where it stops (default the dial's end); clockSec: the clock now.
  function installDial(dial, onChange, { startSec: freshStartSec = () => 0, endSec: windowEndSec = () => Infinity, clockSec = () => null } = {}) {
    if (!dial || dial.dataset.installed) return;
    dial.dataset.installed = "true";
    const range = dial.querySelector("[data-time-range]");
    const play = dial.querySelector("[data-time-play]");
    const step = (frameTime) => {
      if (!playing) return;
      const maxSec = Math.min(Number(range.max) || 0, playing.endSec);
      // At most every frameMs: every second frame at 60 Hz for 30 a second (the 4 ms margin absorbs frame jitter).
      if (frameTime - playing.lastDraw >= frameMs - 4) {
        const timeSec = Math.min(maxSec, playing.startSec + ((frameTime - playing.startedAt) / 1000) * speed);
        playing.lastDraw = frameTime;
        const done = timeSec >= maxSec;
        playing.onChange(timeSec, { playing: !done });
        if (done) { stop({ redraw: false }); return; }
      }
      playing.frame = requestFrame(step);
    };
    play?.addEventListener("click", () => {
      if (playing) { stop(); return; }
      const active = dial.classList.contains("active");
      const clock = clockSec();
      const current = active ? (Number.isFinite(clock) ? clock : Number(range.value)) : null;
      const endSec = windowEndSec();
      const stopSec = Math.min(Number(range.max) || 0, Number.isFinite(endSec) ? endSec : Infinity);
      // A clock before the copy's start (e.g. Roll-in −3 s) starts there too, not after a wait.
      const freshSec = freshStartSec();
      const startSec = current === null || current >= stopSec || current < freshSec ? freshSec : current;
      playing = { startSec, endSec: Number.isFinite(endSec) ? endSec : Infinity, startedAt: now(), lastDraw: -Infinity, frame: 0, onChange };
      setPlayButtons(true);
      playing.frame = requestFrame(step);
    });
    range.addEventListener("input", (event) => { stop({ redraw: false }); onChange(Number(event.currentTarget.value)); });
    dial.querySelector("[data-time-output]").addEventListener("click", () => { stop({ redraw: false }); onChange(null); });
    dial.querySelector("[data-time-speed]")?.addEventListener("click", () => {
      setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length]);
    });
  }

  // The source dial: its range end (maxSec), the clock (timeSec, null = off) and the phase label beside T.
  function syncDial(dial, { maxSec, timeSec, phaseLabel = null }) {
    if (!dial) return;
    const range = dial.querySelector("[data-time-range]");
    const output = dial.querySelector("[data-time-output]");
    range.max = String(maxSec);
    range.value = String(Math.min(timeSec ?? 0, maxSec));
    const on = Number.isFinite(timeSec);
    dial.classList.toggle("active", on);
    output.textContent = on ? `${Math.round(Math.min(timeSec, maxSec))} s${phaseLabel ? ` · ${phaseLabel}` : ""}` : "Off";
    output.setAttribute("aria-pressed", String(on));
  }

  // A copy of the source dial. window = { startSec, endSec }: the copy covers only that span of the one clock (its
  // slider starts there, also while the clock is off); without one it shows the source's range.
  function mirrorDial(dial, source, { window: span = null, clockSec = null } = {}) {
    if (!dial || !source) return;
    const range = dial.querySelector("[data-time-range]");
    const output = dial.querySelector("[data-time-output]");
    const sourceRange = source.querySelector("[data-time-range]");
    const sourceOutput = source.querySelector("[data-time-output]");
    if (span) {
      const endSec = Math.min(span.endSec, Number(sourceRange.max) || span.endSec);
      range.min = String(span.startSec);
      range.max = String(Math.max(span.startSec, endSec));
      range.step = "any";
      const clock = Number.isFinite(clockSec) ? clockSec : span.startSec;
      range.value = String(Math.min(Math.max(clock, span.startSec), endSec));
    } else {
      range.max = sourceRange.max;
      range.value = sourceRange.value;
    }
    dial.classList.toggle("active", source.classList.contains("active"));
    output.textContent = sourceOutput.textContent;
    output.setAttribute("aria-pressed", sourceOutput.getAttribute("aria-pressed"));
    const play = dial.querySelector("[data-time-play]");
    play?.setAttribute("aria-pressed", String(Boolean(playing)));
    if (play) play.textContent = playing ? "Pause" : "Play";
  }

  return {
    installDial,
    syncDial,
    mirrorDial,
    stop,
    setSpeed,
    isPlaying: () => Boolean(playing),
    speed: () => speed,
    markup: (options) => timeDialMarkup({ ...options, speed, speeds }),
  };
}
