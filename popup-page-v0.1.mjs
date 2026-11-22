// POP-UP page parts of the shared Offset / POP-UP page controller (offset/controller-v0.1.mjs).
// Split out on 2026-11-16 (POP-UP code review S6): the POP-UP-only constants, markup, result rows and button wiring.
// Nothing is computed here (values come from the POP-UP Flight BE) and no page state is kept here: the controller
// owns the state (driver, LOCKs, minimum-exposure answers, Z options) and passes it in.
import { formatG } from "./common/ui/display-precision-v0.1.mjs?v=0.1.1";
import { LOCK_TEXTS, previewToggleButton } from "./shared/input-fields-v0.1.mjs?v=0.1.1";
import { POPUP_Z_DIAGRAM_V0_1 } from "./AG/bombing/popup/view/popup-z-diagram-v0.1.mjs?v=0.1.7";

export const POPUP_PAGE_V0_1 = Object.freeze({ id: "popup-page-v0.1", version: "0.1.7" });
// 0.1.7 (owner 2026-11-22, "lock 버튼 눌렀을 때 딜레이"): a POP-UP LOCK shows its pressed state at once; a second click
// before the answer toggles the shown state again (the BE's answer then shows its own).
// 0.1.6 (owner 2026-11-20, DESIGN-STEPS.md S1): Approach-Pop Time (s) after Approach-Pop Range and Pull Down Alt after
// Roll-in Altitude (readouts of the BE's holdDownSec and PULL_DOWN event); a follower's group the same.
// 0.1.4 (owner 2026-11-19, MIL dive): Release Speed blank by default (no cap: the BE's Release speed is shown in the
// field, greyed); typed, the BE's Release speed is written in the field note. The layout is unchanged.
// 0.1.1 (owner 2026-11-17, "기본값은 4G"): the default Popup G is 4 G (was 3 G).
// 0.1.2 (owner 2026-11-18, "더 직관적으로"): the Hold-Down row is two rows, Offset-Popup Range (NM) and Offset-Popup Time (s).

// POP-UP defaults (step 3b): a low-level ingress (Offset leg 500 ft / 480 KCAS), Roll-in Altitude 4,000 ft at
// 400 KCAS, Dive 20°, Roll-in G 3, Popup G 4 (owner 2026-11-17; was 3, POP-UP SPEC §13.2c); the Popup angle from the automatic rule.
export const POPUP_DEFAULT_INPUT_VALUES = Object.freeze({
  offsetAltitudeMslFt: "500",
  offsetSpeedValue: "480",
  initialAltitudeMslFt: "500",
  rollInAltitudeMslFt: "4000",
  initialSpeedValue: "400",
  diveAngleDeg: "20",
  releaseAltitudeMslFt: "3300",
  trackingTimeSec: "5.0",
  rollInG: "3",
  vrpRangeNm: "8.0",
  // Owner 2026-11-18 ("Offset 기본값 3G"): the POP-UP Offset turn at 3 G (the Offset page keeps 2 G).
  offsetG: "3.0",
  popupG: "4",
  popupAngleDeg: "",
  popupGroundDistanceNm: "",
  popupExposureTimeSec: "",
  // Pop-up Speed (owner 2026-11-10): blank / following = the Initial Speed; typed = own (state.popupSpeedOwn).
  popupSpeedKcas: "",
  // Owner 2026-11-19 (MIL dive): blank = no cap, the Release speed is the BE's.
  releaseSpeedKcas: "",
});
export const POPUP_LOCK_KEYS = Object.freeze({ rollInSpeed: "popupLockRollInSpeed", angle: "popupLockAngle" });
export const POPUP_DRIVERS = ["DEFAULT", "ANGLE", "GROUND_DISTANCE", "EXPOSURE_TIME"];
export const POPUP_FOLLOWER_PROFILE_KEYS = ["initialSpeedValue", "initialAltitudeMslFt", "rollInAltitudeMslFt", "diveAngleDeg", "releaseAltitudeMslFt", "releaseSpeedKcas"];
// Each follower's own POP-UP inputs (Offset tab, POP-UP group).
export const POPUP_VALUE_KEYS = Object.freeze(["popupAngleDeg", "popupGroundDistanceNm", "popupExposureTimeSec", "popupG", "popupSpeedKcas"]);
// The driver line of every POP-UP group (owner 2026-11-01: what the driver is).
export const POPUP_DRIVER_NOTE = "Popup Angle · Pop to Roll-in Distance · Exposure Time 중 마지막에 입력한 값이 Driver (나머지 둘은 결과) · AUTO = 다이브 ≤15° +5°, 그 외 +10°";

// POP-UP: each drawn aircraft's Pop Point (the BE's popPoint) on its Approach leg.
export function popupTopViewMarkers(aircraft, popupOf) {
  return aircraft.map((item) => ({ item, popup: popupOf(item.number) })).filter(({ popup }) => popup?.popPoint).map(({ item, popup }) => ({ x: popup.popPoint.x, y: popup.popPoint.y, label: item.number === 1 ? "Pop Up" : `Pop Up #${item.number}`, value: Number.isFinite(popup.popToTargetNm) ? `${popup.popToTargetNm.toFixed(1)} NM` : null }));
}

// POP-UP results (#1): the BE's popup record of the Flight entry; nothing is computed here.
export const POPUP_DRIVER_TEXT = Object.freeze({ DEFAULT: "AUTO · Dive ≤ 15° → +5°, else +10°", ANGLE: "Popup Angle", GROUND_DISTANCE: "Pop to Roll-in Distance", EXPOSURE_TIME: "Exposure Time (typed)" });
// The Pop-up Range readout of a POP-UP group (Pop-up Point → Target, NM).
// Approach-Pop Range (owner 2026-11-19): Approach start (Offset Turn End) → Pop Point, horizontal, the BE's holdDownNm.
export const popupApproachPopText = (p) => (Number.isFinite(p?.holdDownNm) ? p.holdDownNm.toFixed(2) : "-");
// Approach-Pop Time (owner 2026-11-20): the same leg in seconds (holdDownSec); under 0 s INVALID, under 2 s a warning.
export const popupApproachPopTimeText = (p) => (Number.isFinite(p?.holdDownSec) ? `${p.holdDownSec.toFixed(1)}${p.holdDownSec < 0 ? " · INVALID" : p.holdDownSec < 2 ? " · under 2 s" : ""}` : "-");
// Pull Down Alt (owner 2026-11-20, "롤하고 나서 스틱을 당기는 고도"): the BE's PULL_DOWN event altitude.
export const popupPullDownText = (p) => {
  const e = p?.events?.find((x) => x.name === "PULL_DOWN");
  return Number.isFinite(e?.altitudeMslFt) ? Math.round(e.altitudeMslFt).toLocaleString("en-US") : "-";
};
export const popupRangeText = (p) => (Number.isFinite(p?.popToTargetNm) ? p.popToTargetNm.toFixed(2) : "-");
// The field each driver comes from (the other two are results).
const POPUP_DRIVER_KEY = Object.freeze({ ANGLE: "popupAngleDeg", GROUND_DISTANCE: "popupGroundDistanceNm", EXPOSURE_TIME: "popupExposureTimeSec" });
// Marks the three POP-UP fields "Driver" or "result" for the current driver (fields: key -> its inputs).
export function markPopupDriverFields(driverName, inputsOf) {
  Object.values(POPUP_DRIVER_KEY).forEach((key) => inputsOf(key).forEach((input) => {
    const unit = input.closest(".field")?.querySelector(".unit");
    if (!unit) return;
    unit.dataset.base ??= unit.textContent;
    const driving = POPUP_DRIVER_KEY[driverName] === key;
    unit.textContent = `${unit.dataset.base} · ${driving ? "DRIVER" : "result"}`;
    input.closest(".field").classList.toggle("popup-driver-field", driving);
  }));
}
const POPUP_EVENT_TEXT = Object.freeze({ POP: "Pop Point", PULL_UP_END: "Pull-up End", ROLL_IN_START: "Roll-in Start", PULL_DOWN: "Pull Down", APEX: "Apex", TRACK_POINT: "Track Point", RELEASE: "Release" });
// keyed: #1's rows carry result keys (result-change states); a follower's are plain.
export function popupResultRows(p, row, { keyed = true } = {}) {
  const r = (label, text, key, summary = false) => row(label, text, keyed ? key : null, { summary });
  const kt = (v) => `${Number.isFinite(v) ? Math.round(v) : "-"} KCAS`;
  const one = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-");
  const ft = (v) => `${Number.isFinite(v) ? Math.round(v) : "-"} ft`;
  const speed = p.speedCheck;
  const speedText = !speed ? "-" : speed.status === "AUTO"
    ? `AUTO · ${kt(speed.arrivalKcas)} (MIL arrival)`
    : speed.status === "MIL_OK" && p.rollInSpeedSource === "LOCK"
    ? `LOCK · ${kt(speed.rollInSpeedKcas)} (Pop-up Speed solved for it)`
    : speed.status === "MIL_OK"
    ? `MIL OK · ${kt(speed.arrivalKcas)} (+${Math.round(speed.marginKt)} kt over ${Math.round(speed.rollInSpeedKcas)})`
    : `MIL SHORT · ${kt(speed.arrivalKcas)} (${Math.round(speed.marginKt)} kt) · AB not judged (no AB model)`;
  const events = (p.events ?? []).map((e) => r(POPUP_EVENT_TEXT[e.name] ?? e.name, `${one(e.timeSec)} s · ${ft(e.altitudeMslFt)}${Number.isFinite(e.kcas) ? ` · ${kt(e.kcas)}` : ""}`, `popupEvent${e.name}`));
  return [
    r("Popup Angle", `${one(p.popupAngleDeg)}° · ${POPUP_DRIVER_TEXT[p.driver] ?? p.driver}`, "popupAngleDeg", true),
    r("Pop to Roll-in Distance", `${Number.isFinite(p.groundDistanceNm) ? p.groundDistanceNm.toFixed(2) : "-"} NM`, "popupGroundDistanceNm", true),
    r("Exposure (Pop → Apex)", `${one(p.exposureTimeSec)} s`, "popupExposureTimeSec", true),
    // Offset-Popup Range / Time (owner 2026-11-18, "더 직관적으로"; was the one Hold-Down row): Offset Turn End → Pop.
    r("Offset-Popup Range", `${Number.isFinite(p.holdDownNm) ? p.holdDownNm.toFixed(2) : "-"} NM`, "popupOffsetPopupRange", true),
    r("Offset-Popup Time", `${Number.isFinite(p.holdDownSec) ? one(p.holdDownSec) : "-"} s`, "popupOffsetPopupTime", true),
    // At the Pop Point (owner 2026-11-01): range and angle-off to the Target, and the time after IP.
    // Pop-up Range (owner 2026-11-02): the Pop-up Point → Target distance.
    r("Pop-up Range", `${Number.isFinite(p.popToTargetNm) ? p.popToTargetNm.toFixed(2) : "-"} NM`, "popupRange", true),
    r("Pop-up Angle Off", Number.isFinite(p.popAngleOffDeg) ? `${Math.abs(p.popAngleOffDeg).toFixed(0)}° ${p.popAngleOffDeg >= 0 ? "R" : "L"}` : "-", "popupAngleOff", true),
    r("Pop time", `IP +${one(p.popTimeSec)} s`, "popupPopTime", true),
    r("Apex", `${ft(p.events?.find((e) => e.name === "APEX")?.altitudeMslFt)} · ${kt(p.apexKcas)}`, "popupApex", true),
    r("Roll-in Speed", speedText, "popupSpeedCheck", true),
    r("Popup G", `${formatG(p.popupG)} G${p.climb?.pullUp && !p.climb.pullUp.reachesPopupG ? ` (peak ${formatG(p.climb.pullUp.peakG)} G)` : ""}`, "popupG"),
    ...events,
    ...(p.notes ?? []).map((note, i) => r("Note", note, `popupNote${i}`)),
  ];
}
// The Pop-up Speed field's note: following the Initial Speed or its own value.
// The Apex readout (owner 2026-11-10: next to Roll-in Altitude): altitude and speed of the climb's top.
export function popupApexText(p) {
  const apex = p?.events?.find((e) => e.name === "APEX");
  return Number.isFinite(apex?.altitudeMslFt) ? `${Math.round(apex.altitudeMslFt).toLocaleString("en-US")} ft${Number.isFinite(p.apexKcas) ? ` · ${Math.round(p.apexKcas)} kt` : ""}` : "-";
}
// The Release Speed field (owner 2026-11-19, MIL dive): the BE's Release speed (popup.releaseSpeedKcas) as the blank
// field's placeholder, and in the field note either way. Only text changes (the note line is the field's own).
export function syncReleaseSpeedFields(inputs, p) {
  const kcas = Number.isFinite(p?.releaseSpeedKcas) ? Math.round(p.releaseSpeedKcas) : null;
  const cap = Number.isFinite(p?.releaseSpeedCapKcas) ? p.releaseSpeedCapKcas : null;
  // One line, as the field's own note (owner: no layout change).
  const text = kcas === null ? "MIL dive · Release speed · result"
    : cap === null ? `MIL dive · Release ${kcas} KCAS · result`
    : p.releaseSpeedCapReached ? `MIL · Release ${kcas} KCAS · held`
    : `MIL · Release ${kcas} KCAS · not reached`;
  inputs.forEach((input) => {
    input.placeholder = kcas === null ? "" : String(kcas);
    const field = input.closest(".field");
    let unit = field?.querySelector(".unit");
    if (field && !unit) { unit = document.createElement("span"); unit.className = "unit"; field.append(unit); }
    if (unit) unit.textContent = text;
  });
}
export function syncPopupSpeedNote(root, own, keep = () => true, solved = false) {
  root.querySelectorAll("[data-popup-speed-note]").forEach((note) => {
    if (keep(note)) note.textContent = solved ? "Solved for the Roll-in Speed · result" : own ? "Own value · clear to follow Initial Speed" : "Follows Initial Speed · type to set";
  });
}
export function syncPopupSpeedFields(inputs, locked) {
  inputs.forEach((input) => {
    const field = input.closest(".field");
    const title = field?.querySelector(":scope > .lock-title > span:first-child") ?? field?.querySelector(":scope > span:first-child");
    if (title && !title.dataset.popupSpeed) { title.textContent = "Roll-in Speed (kcas)"; title.dataset.popupSpeed = "true"; }
    field?.querySelectorAll('select[data-key="initialSpeedMode"] option[value="MACH"]').forEach((option) => option.remove());
    let unit = field?.querySelector(".unit");
    if (field && !unit) { unit = document.createElement("span"); unit.className = "unit"; field.append(unit); }
    if (unit) unit.textContent = locked ? "LOCK · Pop-up Speed solved for it" : "AUTO · MIL arrival at Roll-in Start · result";
    field?.classList.toggle("popup-driver-field", locked);
  });
}
export function renderPopupMinimumExposure(m, out, apply) {
  out.textContent = !m ? "-" : m.status === "VALID" ? `${m.angleDeg.toFixed(1)}° · ${m.exposureTimeSec.toFixed(1)} s` : `Unavailable · ${m.reason ?? ""}`;
  if (apply) apply.hidden = !(m && m.status === "VALID");
}
// The POP-UP buttons of #1 and of each follower's POP-UP group: AUTO, Min. Exposure Calculate / Apply, the LOCKs.
// The page state stays in the controller and comes in through the argument.
export function installPopupControls({ $, calculate, setValue, flightDraft, dropSolvedIfEdited, followerFields, followerSlot, minimumExposureOf, requestMinimumExposure, leadLocks }) {
  $("#popup-auto")?.addEventListener("click", () => calculate({ aircraft: 1, kind: "set", key: "popupDriver", value: "DEFAULT", commit: true }));
  $("#popup-min-exposure")?.addEventListener("click", () => {
    requestMinimumExposure(1);
    const out = $("#popup-min-exposure-out");
    if (out) out.textContent = "Calculating…";
    calculate();
  });
  $("#popup-min-apply")?.addEventListener("click", () => {
    const m = minimumExposureOf(1);
    if (!m || m.status !== "VALID") return;
    const text = m.angleDeg.toFixed(1);
    setValue("popupAngleDeg", text, { includeActive: true });
    calculate({ aircraft: 1, kind: "set", key: "popupAngleDeg", source: "minimumExposure", commit: true });
  });
  // #2–#4: the same three controls in each follower's POP-UP group.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-popup-auto], [data-popup-min], [data-popup-min-apply]");
    const number = Number(button?.closest(".flight-slot")?.dataset.aircraft);
    if (!button || !(number >= 2 && number <= 4)) return;
    if (button.hasAttribute("data-popup-auto")) {
      calculate({ aircraft: number, kind: "set", key: "popupDriver", value: "DEFAULT", commit: true });
    } else if (button.hasAttribute("data-popup-min")) {
      requestMinimumExposure(number);
      const out = button.closest(".flight-slot").querySelector("[data-popup-min-out]");
      if (out) out.textContent = "Calculating…";
      calculate();
    } else {
      const m = minimumExposureOf(number);
      if (!m || m.status !== "VALID") return;
      const text = m.angleDeg.toFixed(1);
      const draft = flightDraft(number);
      draft.popupAngleDeg = text;
      dropSolvedIfEdited(draft.solved, "popupAngleDeg", text);
      followerFields(followerSlot(number), "popupAngleDeg").forEach((field) => { field.value = text; });
      calculate({ aircraft: number, kind: "set", key: "popupAngleDeg", source: "minimumExposure", commit: true });
    }
  });
  // The POP-UP LOCKs (#1 and #2–#4): a toggle edit; the BE returns the LOCK states.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-popup-lock]");
    if (!button) return;
    event.preventDefault();
    const number = Number(button.closest(".flight-slot")?.dataset.aircraft) || 1;
    const kind = button.dataset.popupLock;
    const current = button.dataset.pendingToggle
      ? button.getAttribute("aria-pressed") === "true"
      : (number === 1 ? leadLocks() : flightDraft(number).popupLocks ?? {})[kind] === true;
    previewToggleButton(button, !current, { texts: LOCK_TEXTS });
    calculate({ aircraft: number, kind: "set", key: POPUP_LOCK_KEYS[kind], value: !current, commit: true });
  });
}

// A follower's POP-UP input group (#2–#4). `initialSpeed` and `rollInLocked` are the controller's field markup.
export function popupFollowerGroupMarkup({ initialSpeed, rollInLocked }) {
  return `<details class="input-group-panel" open><summary class="input-group-title">POP-UP</summary><div class="driver"><span>${POPUP_DRIVER_NOTE}</span><output data-popup-driver-out>DRIVER · AUTO</output></div><div class="input-grid popup-input-grid">`
    + `<label class="field"><span>Pop-up Speed (kcas)</span><input data-flight-field="popupSpeedKcas" type="text" inputmode="decimal"><span class="unit" data-popup-speed-note>Follows Initial Speed · type to set</span></label>`
    + `<div class="field"><span>Pop-up Range (NM)</span><output class="readout" data-popup-range-out>-</output><span class="unit">Pop-up Point → Target · result</span></div>`
    + `<label class="field"><span class="lock-title"><span>Popup Angle (deg)</span><button class="lock-button" type="button" data-popup-lock="angle" aria-label="Lock Popup Angle" aria-pressed="false">LOCK</button></span><input data-flight-field="popupAngleDeg" type="text" inputmode="decimal"><span class="unit">Climb angle · 0–55°</span></label>`
    + `<label class="field"><span>Popup G (G)</span><input data-flight-field="popupG" type="text" inputmode="decimal"><span class="unit" data-follow-note></span></label>`
    + `${initialSpeed}${rollInLocked}`
    + `<div class="field"><span>Pull Down Alt (ft MSL)</span><output class="readout" data-popup-pull-down-out>-</output><span class="unit">Roll done, pull starts · result</span></div>`
    + `<div class="field"><span>Apex (ft MSL)</span><output class="readout" data-popup-apex-out>-</output><span class="unit">Top of the climb · result</span></div>`
    + `<div class="field"><span>Approach-Pop Range (NM)</span><output class="readout" data-popup-app-pop-out>-</output><span class="unit">Approach start → Pop Point · result</span></div>`
    + `<div class="field"><span>Approach-Pop Time (sec)</span><output class="readout" data-popup-app-pop-time-out>-</output><span class="unit">Approach start → Pop Point · result · 2 s recommended</span></div>`
    + `<label class="field"><span>Pop to Roll-in Distance (NM)</span><input data-flight-field="popupGroundDistanceNm" type="text" inputmode="decimal"><span class="unit">Pop Point → Roll-in Start</span></label>`
    + `<label class="field"><span>Exposure Time (sec)</span><input data-flight-field="popupExposureTimeSec" type="text" inputmode="decimal"><span class="unit">Pop Point → Apex · MIL</span></label>`
    + `<div class="field popup-auto-field"><span>Pop-up Angle</span><button class="btn" type="button" data-popup-auto>AUTO</button><span class="unit">AUTO: Dive ≤ 15° → Dive + 5°, Dive > 15° → Dive + 10°</span></div>`
    + `<div class="field"><span>Popup Angle Min. Exposure</span><span class="compound popup-min-row"><button class="btn" type="button" data-popup-min>Calculate</button><output class="readout" data-popup-min-out>-</output><button class="btn" type="button" data-popup-min-apply hidden>Apply</button></span><span class="unit">Popup angle with the shortest Pop → Apex</span></div>`
    + `</div></details>`;
}

// The POP-UP Z Text control (the Common Text group's look): − / the body size (back to the default) / +.
export function popupZTextMarkup(popupZFontSize) {
  const sizes = POPUP_Z_DIAGRAM_V0_1.fontSizes;
  const button = (step, text, label, extra = "", disabled = false) => `<button class="capture-button${extra}" type="button" data-popup-z-text="${step}" aria-label="${label}"${disabled ? " disabled" : ""}>${text}</button>`;
  return `<div class="font-scale-control" role="group" aria-label="Z-Diagram text size"><span class="diagram-control-label">Text</span>`
    + button("down", "−", "Z-Diagram text smaller", "", popupZFontSize <= sizes[0])
    + button("reset", String(popupZFontSize), `Reset Z-Diagram text size to ${POPUP_Z_DIAGRAM_V0_1.fontSize}`, " diagram-scale-output")
    + button("up", "+", "Z-Diagram text larger", "", popupZFontSize >= sizes[sizes.length - 1])
    + `</div>`;
}
export function syncPopupZTextButtons(popupZFontSize) {
  const sizes = POPUP_Z_DIAGRAM_V0_1.fontSizes;
  document.querySelectorAll('[data-popup-z-text="reset"]').forEach((b) => { b.textContent = String(popupZFontSize); });
  document.querySelectorAll('[data-popup-z-text="down"]').forEach((b) => { b.disabled = popupZFontSize <= sizes[0]; });
  document.querySelectorAll('[data-popup-z-text="up"]').forEach((b) => { b.disabled = popupZFontSize >= sizes[sizes.length - 1]; });
}
export function popupZTickMarkup(popupZTick) {
  const on = popupZTick === "PULL_DOWN";
  return `<button class="capture-button view-toggle${on ? " active" : ""}" type="button" data-popup-z-tick aria-pressed="${on}" title="Climb-leg tick: Roll-in Altitude (off) or Pull Down altitude (on)">Pull Down: ${on ? "On" : "Off"}</button>`;
}
export function syncPopupZTickButtons(popupZTick) {
  const on = popupZTick === "PULL_DOWN";
  document.querySelectorAll("[data-popup-z-tick]").forEach((b) => {
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("active", on);
    b.textContent = `Pull Down: ${on ? "On" : "Off"}`;
  });
}
