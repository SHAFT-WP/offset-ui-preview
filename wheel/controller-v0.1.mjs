// Wheel page controller (owner 2026-10-27: "wheel에는 0.4버전(html)을 참조해서 지금의 be fe 구조를 가지게 해줘 box를
// 참조해서 만들면 된다" — the Official Wheel Rev0.4 on the V2 BE / FE, a page as BOX's and Wheel-BOX's, PC Wide and
// phone). The FE never calculates: it keeps the Wheel Attack Flight record the BE returned, puts typed values into it,
// sends the edit events (Common calculation client, Wheel Attack Flight Worker) and draws the adopted answer. Wheel
// values stay in Wheel: nothing here reads or writes the Offset, BOX or Wheel-BOX page's state.
import {
  WHEEL_ATTACK_FLIGHT_DEFAULT_STATE, WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES, WHEEL_ATTACK_FLIGHT_V0_1, wheelAttackFlightDefaultFollower, wheelAttackFlightDefaultLead,
} from "../AG/bombing/wheel-attack/wheel-attack-flight-v0.1.mjs?v=0.1.0";
import { createCalculationScheduler, createWorkerTransport } from "../common/calculation/calculation-client-v0.1.mjs?v=0.1.1";
import { WEAPON_DATABASE_V0_1 } from "../AG/bombing/bomb-delivery-planner/weapon-data-v0.1.mjs";
import {
  BDP_FIELD_DIGITS, BDP_TAB_KEYS, bdpProfileFieldsMarkup, bdpTabMarkup, rollInTurnFieldsMarkup, syncLinkButtons, syncSemChoices, turnOnsetFieldsMarkup,
} from "../shared/bdp-tab-v0.1.mjs?v=0.1.1";
import { createEnterCommit, headingText, installSectionDisclosure as installSectionDisclosureOn, installSectionTools, parsedFieldValue, syncLockButtons } from "../shared/input-fields-v0.1.mjs?v=0.1.0";
import { bdpResultRows, resultRow, semTurnAutoBankText } from "../shared/bdp-result-v0.1.mjs?v=0.2.0";
import { clearDedPages, dedPagesMarkup, installDedPngClicks, readDedCard, saveDedPng, syncDedPngButtons as syncDedPngButtonStates, writeDedPages } from "../shared/ded-v0.1.mjs?v=0.1.1";
import { createSaveRun, isRecordObject, readWorkRecord, savedTimeText, writeWorkRecord } from "../shared/save-store-v0.1.mjs?v=0.1.1";
import { AIRCRAFT_COLORS, createShownAircraft, installShownAircraftClicks } from "../shared/flight-ui-v0.1.mjs?v=0.1.0";
import { installResultPanel } from "../common/ui/result-panel-v0.1.mjs";
import { installSvgLegend } from "../common/diagram/svg-legend-v0.1.mjs";
import { saveSvgAsPng } from "../common/diagram/svg-png-export-v0.1.mjs";
import { svgNode } from "../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { installSvgViewport } from "../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { installSmartLabelDrag } from "../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createTimePlayer, timeDialMarkup } from "../common/ui/time-dial-v0.1.mjs?v=0.1.0";
import { formatDeg, formatFt, formatG, formatKt, formatNm, formatSec } from "../common/ui/display-precision-v0.1.mjs?v=0.1.1";
import { WHEEL_ATTACK_TOP_VIEW_V0_1, renderWheelAttackTopView, wheelAttackTopViewTitle } from "../AG/bombing/wheel-attack/view/wheel-attack-top-view-v0.1.mjs?v=0.1.0";
import { renderWheelAttackZDiagramV0_1, wheelAttackZDiagramTitle } from "../AG/bombing/wheel-attack/view/wheel-attack-z-diagram-v0.1.mjs?v=0.1.0";
import { bdpDiagramsMarkup, bdpFlightViewWindow, cancelBdpDiagramRender, clearBdpDiagrams, renderBdpDiagrams } from "../AG/bombing/bomb-delivery-planner/view/bdp-diagrams-panel-v0.1.mjs?v=0.11.2";

// 0.1.0 (2026-10-27, owner): #1–#4 fly #1's BDP and Wheel data; #2–#4 take their slots on the Wheel in the attack order
// (no Formation position); the Angle-Off and the Wheel Radius are the BE's (shown solved, never typed).
export const WHEEL_PAGE_CONTROLLER_V0_1 = Object.freeze({ id: "wheel-page-controller-v0.1", version: "0.1.0", flight: WHEEL_ATTACK_FLIGHT_V0_1.version });

const WORKER_URL = new URL("../AG/bombing/wheel-attack/wheel-attack-flight-worker-v0.1.mjs?v=0.1.1", import.meta.url);
// The Wheel page's own record (the Wheel-BOX page keeps `bombing-v2-wheel-work`).
const SAVE_KEY = "bombing-v2-wheel-attack-work";
const SAVE_SCHEMA = 1;
// The Wheel tab's fields besides its BDP Profile / Roll-in / Turn Onset copies (its Tab Default restores all of them).
const WHEEL_KEYS = Object.freeze(["attackHeadingDeg", "direction", "aircraftCount"]);
const WHEEL_TAB_COPY_KEYS = Object.freeze(["initialSpeedValue", "initialSpeedMode", "initialAltitudeMslFt", "rollInAltitudeMslFt", "diveAngleDeg", "trackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas", "rollInG", "rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
const FIELD_DIGITS = Object.freeze({ ...BDP_FIELD_DIGITS });
const TOP_VIEW_TEXT_SCALES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];

const $ = (selector) => document.querySelector(selector);
const app = $("#wheel-calculator");
const fields = (key) => [...app.querySelectorAll(`[data-key="${key}"]`)];
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const sameValue = (a, b) => (isNumber(a) && isNumber(b) ? Math.abs(a - b) <= 1e-9 : Object.is(a ?? null, b ?? null));

let lead = wheelAttackFlightDefaultLead();
let lastEntry = null;
// The Flight: its size, the followers' (empty) records and the places on the Wheel the BE gave.
let flightSize = 1;
const followers = {};
let lastPositions = {};
let scheduler = null;
let transport = null;
let topViewTextScale = 1;
// Top View Advanced: the MAP circle and each aircraft's Roll-in time after #1. The legend follows it.
let topViewAdvanced = false;
let bdpViewsShown = false;
let bdpClockSec = null;
let editAircraftOf = () => 1;
let loadedSave = null;
let legend = null;

// ---- Field texts ----------------------------------------------------------------------------------------------------

function fieldText(key, value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "number") return String(value);
  if (key === "attackHeadingDeg") return String(((Math.round(value) % 360) + 360) % 360).padStart(3, "0");
  return Object.hasOwn(FIELD_DIGITS, key) ? value.toFixed(FIELD_DIGITS[key]) : String(value);
}

function writeField(field, key, value) {
  const text = fieldText(key, value);
  if (field.tagName === "SELECT") field.value = value ?? "";
  else if (field.value !== text) field.value = text;
}

function writeAllFields() {
  const keys = new Set([...Object.keys(WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES), ...Object.keys(lead.values), "rollInBankAngleDeg"]);
  keys.forEach((key) => fields(key).forEach((field) => writeField(field, key, lead.values[key])));
  syncToggles();
}

// The other copies of a field (BDP tab ↔ Wheel tab) show what is typed at once: they are one value.
function mirror(source) {
  fields(source.dataset.key).forEach((field) => { if (field !== source) field.value = source.value; });
}

function syncToggles() {
  syncLockButtons(lead.locks, app);
  syncLinkButtons(app, lead.state);
  syncSemChoices(app, { semEnd: lead.values.semEnd ?? "LEVEL", semTurnType: lead.values.semTurnType ?? "LEVEL" });
  $("#lock-count").textContent = `LOCK ${Object.values(lead.locks ?? {}).filter(Boolean).length}`;
}

// ---- Calculation ----------------------------------------------------------------------------------------------------

const followerRecord = (number) => (followers[number] ??= wheelAttackFlightDefaultFollower(number));
const followerNumbers = () => [2, 3, 4].filter((number) => number <= flightSize);

function collectInput(edits) {
  const aircraft = { 1: structuredClone(lead) };
  followerNumbers().forEach((number) => { aircraft[number] = structuredClone(followerRecord(number)); });
  const input = { schemaVersion: WHEEL_ATTACK_FLIGHT_V0_1.schemaVersion, flightSize, aircraft };
  // An edit for an aircraft no longer in the Flight goes with it.
  const current = edits.filter((edit) => (edit.aircraft ?? 1) <= flightSize);
  return current.length ? { ...input, edits: current } : input;
}

// The BE's next state is the record from now on. A field is rewritten unless it is being typed in and the BE kept
// the value sent (its text stays until the edit is committed).
function applyLeadState(next, sentLead, edits) {
  const last = edits.findLast((edit) => (edit.aircraft ?? 1) === 1) ?? null;
  const typing = last && last.kind === "set" && last.commit !== true ? last.key : null;
  const active = document.activeElement;
  lead = { values: { ...next.values }, locks: { ...next.locks }, state: { ...next.state } };
  const keys = new Set([...Object.keys(next.values), ...Object.keys(sentLead.values)]);
  for (const key of keys) {
    const value = lead.values[key];
    for (const field of fields(key)) {
      if (field === active && key === typing && sameValue(value, sentLead.values[key])) continue;
      writeField(field, key, value);
    }
  }
  syncToggles();
}

function applyAnswer(message, sent) {
  const output = message.output;
  if (!output) {
    lastPositions = {};
    const failed = { status: "FAILED", result: null, error: message.error ?? "no result", errors: [message.error ?? "no result"], warnings: [], ded: null };
    followerNumbers().forEach((number) => renderFollowerStatus(number, failed));
    renderLead(failed);
    return;
  }
  const next = output.nextInput?.aircraft?.[1];
  if (next && isRecordObject(next.values)) applyLeadState(next, sent.input.aircraft[1], sent.input.edits ?? []);
  lastPositions = Object.fromEntries(Object.entries(output.aircraftResults).filter(([, entry]) => entry?.position).map(([number, entry]) => [number, entry.position]));
  followerNumbers().forEach((number) => renderFollowerStatus(number, output.aircraftResults[number]));
  renderLead(output.aircraftResults[1]);
}

function installCalculation() {
  transport = createWorkerTransport({ workerUrl: WORKER_URL, hostFactory: "createWheelAttackFlightHost" });
  scheduler = createCalculationScheduler({ collect: collectInput, apply: applyAnswer, transport });
  // Read-only diagnostics for browser checks (nothing here calculates).
  globalThis.wheelCalculation = Object.freeze({
    whenIdle: () => scheduler.whenIdle(),
    state: () => scheduler.state(),
    mode: () => transport.mode(),
    lead: () => structuredClone(lead),
    entry: () => lastEntry,
  });
}

// ---- Edits ----------------------------------------------------------------------------------------------------------

const enterCommit = createEnterCommit();

function commitField(field, how) {
  const key = field.dataset.key;
  if (field.value.trim() === "") {
    lead.values[key] = null;
    scheduler[how]({ kind: "clear", key });
    return;
  }
  lead.values[key] = parsedFieldValue(field.value, null);
  scheduler[how]({ kind: "set", key, commit: true });
}

function installEdits() {
  app.addEventListener("input", (event) => {
    const field = event.target.closest?.("input[data-key]");
    if (!field || field.readOnly) return;
    const key = field.dataset.key;
    mirror(field);
    if (field.value.trim() === "") {
      lead.values[key] = null;
      scheduler.hold();
      return;
    }
    lead.values[key] = parsedFieldValue(field.value, null);
    scheduler.input({ kind: "set", key });
  });
  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches?.("select[data-key]")) {
      const key = target.dataset.key;
      mirror(target);
      lead.values[key] = target.value === "" ? null : target.value;
      syncToggles();
      scheduler.immediate({ kind: "set", key });
      return;
    }
    if (target.matches?.("input[data-key]") && !target.readOnly) {
      if (enterCommit.consumed(target)) return;
      commitField(target, "commit");
    }
  });
  app.addEventListener("keydown", (event) => {
    const field = event.target.closest?.("input[data-key]");
    if (event.key !== "Enter" || !field || field.readOnly) return;
    event.preventDefault();
    enterCommit.mark(field);
    commitField(field, "immediate");
  });
  app.addEventListener("click", (event) => {
    const lock = event.target.closest?.("[data-lock-key]");
    if (lock) {
      event.preventDefault();
      const key = lock.dataset.lockKey;
      const pending = scheduler.pendingToggle(1, "lock", key);
      const value = !(pending === undefined ? lead.locks[key] === true : pending);
      lead.locks[key] = value;
      syncToggles();
      scheduler.immediate({ kind: "lock", key, value });
      return;
    }
    const link = event.target.closest?.("[data-link-key]");
    if (link) {
      event.preventDefault();
      const key = link.dataset.linkKey;
      const pending = scheduler.pendingToggle(1, "toggle", key);
      const value = !(pending === undefined ? lead.state[key] !== false : pending);
      lead.state[key] = value;
      syncToggles();
      scheduler.immediate({ kind: "toggle", key, value });
    }
  });
}

// Tab Default: that tab's values (and the BDP Profile solve state / LOCKs when it holds the BDP Profile) go back to
// the BE's defaults; other tabs keep theirs.
function resetTab(tab) {
  const keys = tab === "bdp" ? BDP_TAB_KEYS : tab === "wheel" ? [...WHEEL_KEYS, ...WHEEL_TAB_COPY_KEYS] : [];
  if (!keys.length) return;
  keys.forEach((key) => { lead.values[key] = WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES[key]; });
  lead.locks = {};
  Object.assign(lead.state, {
    solveMode: WHEEL_ATTACK_FLIGHT_DEFAULT_STATE.solveMode,
    rollInAltitudeLinked: WHEEL_ATTACK_FLIGHT_DEFAULT_STATE.rollInAltitudeLinked,
    enteredTrackingTimeSec: WHEEL_ATTACK_FLIGHT_DEFAULT_STATE.enteredTrackingTimeSec,
  });
  writeAllFields();
  scheduler.reset();
}

// ---- Results --------------------------------------------------------------------------------------------------------

const resultPanel = installResultPanel(document.querySelector("[data-result-panel]"));

function renderStatus(entry) {
  const status = entry.status === "FAILED" ? "INVALID" : entry.status;
  const pill = $("#state-pill");
  pill.textContent = status;
  pill.className = `status ${status === "VALID" ? "ok" : status === "WARNING" ? "warn" : "bad"}`;
  const message = $("#constraint-message");
  const parts = [];
  if (entry.errors?.length) parts.push(`INVALID · ${entry.errors.join(" / ")}`);
  if (entry.warnings?.length) parts.push(`WARNING · ${entry.warnings.join(" / ")}`);
  message.textContent = parts.length ? parts.join("  ") : "VALID";
  message.className = `status-message ${status.toLowerCase()}`;
}

const legTime = (seconds) => `${formatSec(seconds)} sec`;
// Source-bounded turn limits: within, outside (the issues), or not evaluated (the reason; neither a pass nor a block).
function limitsText(performance) {
  if (performance.valid === null) return `not evaluated: ${performance.reason}`;
  return performance.valid ? "within the source limits" : `outside: ${performance.issues.join(", ")}`;
}

function wheelResultRows(result) {
  const w = result.wheel;
  const f = result.flight;
  const row = (label, text, key, summary = false) => resultRow(label, text, key, { summary });
  return [
    row("Angle-Off", `${formatDeg(result.angleOffDeg)}° ${result.direction} (AUTO, tangent) · Intercept ${formatDeg(result.interceptAngleDeg)}°`, "angleOffDeg", true),
    row("Wheel Range", `${formatNm(w.radiusNm)} NM · Slant ${formatNm(w.slantRangeNm)} NM`, "wheelRadiusNm", true),
    row("Wheel Turn", `${formatKt(w.wheelSpeedKcas)} kcas · ${formatFt(w.wheelAltitudeMslFt)} ft · ${formatDeg(w.wheelBankAngleDeg)}° / ${formatG(w.wheelLoadFactorG)} G · ${formatDeg(w.wheelTurnRateDegSec)}°/s`, "wheelTurn", true),
    row("Wheel Time", `360° ${legTime(w.wheelTimeSec)} · 180° ${legTime(w.wheelTurn180TimeSec)}`, "wheelTime"),
    row("Attack Order", `${f.sequence.join(" → ")} · Interval ${legTime(f.attackIntervalSec)} · Arc ${formatNm(f.arcSpacingNm)} NM`, "attackOrder", true),
    row("Roll-in Start", `${headingText(result.rollInStartHeadingDeg)} · Radial ${headingText(result.rollInStartRadialDeg)}`, "rollInStart"),
    row("Wheel Performance", `${w.performance.profile?.id ?? "source profile"} · ${limitsText(w.performance)}`, "wheelPerformance"),
    row("Tangent", `closure ${formatFt(Math.abs(result.tangent.closureFt))} ft · ${result.tangent.evaluations} BDP solves`, "tangent"),
    row("Direction", result.direction, "direction"),
    row("Attack Heading", headingText(result.attackHeadingDeg), "attackHeadingDeg"),
  ];
}

function renderResults(entry) {
  const result = entry?.result;
  $("#wheel-result-body").innerHTML = result ? wheelResultRows(result).join("") : "";
  $("#profile-result-body").innerHTML = result ? bdpResultRows(result.bombDelivery).join("") : "";
  resultPanel.refresh();
}

// The solved readouts: the Angle-Off (Wheel tab and BDP tab) and the Wheel Radius.
function renderSolved(result) {
  const angle = isNumber(result?.angleOffDeg) ? formatDeg(result.angleOffDeg) : "-";
  app.querySelectorAll('[data-wheel-solved="angleOffDeg"], [data-bdp-fixed="angleOffDeg"]').forEach((node) => { node.textContent = angle; });
  app.querySelectorAll('[data-wheel-solved="wheelRadiusNm"]').forEach((node) => { node.textContent = isNumber(result?.wheel?.radiusNm) ? formatNm(result.wheel.radiusNm) : "-"; });
  app.querySelectorAll("[data-sem-turn-auto-bank]").forEach((node) => { node.textContent = semTurnAutoBankText(result?.bombDelivery?.public?.sem?.turn); });
}

function showCalculationFailed(svg, title, message, width) {
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} 220`);
  svg.style.aspectRatio = `${width} / 220`;
  const lines = [title, "Calculation failed · no current result", message.length > 70 ? `${message.slice(0, 67)}...` : message];
  svg.append(svgNode("rect", { x: 0, y: 0, width, height: 220, fill: "#ffffff" }));
  lines.forEach((line, index) => svg.append(svgNode("text", { x: width / 2, y: 70 + index * 40, "text-anchor": "middle", "font-size": index === 0 ? 22 : 17, fill: "#14202c" }, line)));
}

// Top View Size (as Wheel-BOX): the Common viewport, button-only Size 50–200 % in 25 % steps, pan only while zoomed in,
// Reset back to 100 %. A new result or another set of shown aircraft refits; Text and Advanced keep the user's zoom.
let topViewViewport = null;
let topViewLabelDrag = null;
let topViewFitKey = null;
// One serial per answer object, so a new answer refits and a redraw of the same one does not.
const resultSerials = new WeakMap();
let nextResultSerial = 1;
function resultSerial(result) {
  if (!resultSerials.has(result)) resultSerials.set(result, nextResultSerial++);
  return resultSerials.get(result);
}
function installTopViewSize() {
  const sizeOutput = $("#top-view-size-output");
  const zoomIn = $("#top-view-zoom-in");
  const zoomOut = $("#top-view-zoom-out");
  topViewViewport = installSvgViewport($("#wheel-top-view"), {
    baseViewBox: { x: 0, y: 0, w: WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.width, h: WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.maxHeight },
    panOnlyWhenZoomed: true,
    buttonOnlyZoom: true,
    allowPageScrollWhenPanDisabled: true,
    maxZoom: 2,
    maxZoomOut: 2,
    onViewBoxChange: (box) => {
      const percent = Math.round((topViewViewport?.getBaseViewBox().w ?? WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.width) / box.w * 100);
      sizeOutput.textContent = `${percent}%`;
      zoomIn.disabled = percent >= 200;
      zoomOut.disabled = percent <= 50;
    },
    resetButton: $("#top-view-zoom-reset"),
  });
  const stepSize = (delta) => {
    const current = topViewViewport.getBaseViewBox().w / topViewViewport.getViewBox().w;
    const next = Math.max(0.5, Math.min(2, Math.round((current + delta) * 100) / 100));
    if (next !== current) topViewViewport.zoomCenter(current / next);
  };
  zoomIn.addEventListener("click", () => stepSize(0.25));
  zoomOut.addEventListener("click", () => stepSize(-0.25));
  sizeOutput.addEventListener("click", () => topViewViewport.reset());
  topViewLabelDrag = installSmartLabelDrag($("#wheel-top-view"));
}
function syncTopViewSize(canvas, key) {
  if (!topViewViewport) return;
  topViewViewport.setBaseViewBox({ x: 0, y: 0, w: canvas.width, h: canvas.height });
  if (key !== topViewFitKey) topViewViewport.autoFit();
  else if (topViewViewport.isUserAdjusted()) topViewViewport.refresh();
  else topViewViewport.ensureBaseWhenUnadjusted();
  topViewFitKey = key;
  topViewLabelDrag?.applyStoredPositions();
}

function renderTopView() {
  const svg = $("#wheel-top-view");
  const result = lastEntry?.result;
  if (!result) {
    const width = WHEEL_ATTACK_TOP_VIEW_V0_1.canvas.width;
    showCalculationFailed(svg, wheelAttackTopViewTitle({ aircraftNumber: 1 }), lastEntry?.error ?? "no result", width);
    syncTopViewSize({ width, height: 220 }, null);
    $("#capture-top-view").disabled = true;
    return;
  }
  // The Flight: each shown aircraft in its colour at its slot (every aircraft on the Wheel is drawn).
  const aircraft = shownAircraft.visible().filter((number) => lastPositions[number]).map((number) => ({ number, color: AIRCRAFT_COLORS[number] }));
  const rendered = renderWheelAttackTopView(svg, result, { aircraftNumber: 1, textScale: topViewTextScale, aircraft, advanced: topViewAdvanced });
  syncTopViewSize(rendered.canvas, `${resultSerial(result)}`);
  $("#capture-top-view").disabled = false;
  legend?.render?.();
}

function renderZ() {
  const svg = $("#wheel-z-svg");
  const result = lastEntry?.result;
  if (!result) {
    showCalculationFailed(svg, wheelAttackZDiagramTitle({ aircraftNumber: 1 }), lastEntry?.error ?? "no result", 650);
    $("#capture-z").disabled = true;
    return;
  }
  $("#capture-z").disabled = !renderWheelAttackZDiagramV0_1(svg, result, { aircraftNumber: 1 }).rendered;
}

const dedOut = (index, key) => app.querySelector(`[data-ded-pages="1"] [data-ded-oa="${index}-${key}"]`);
function renderDed(ded) {
  if (ded?.pages) writeDedPages(dedOut, ded.pages);
  else clearDedPages(dedOut, 1);
}

function renderLead(entry) {
  lastEntry = entry ?? null;
  renderStatus(entry);
  renderResults(entry);
  renderSolved(entry?.result ?? null);
  renderTopView();
  renderZ();
  renderDed(entry?.ded ?? null);
  refreshBdpViews();
  syncDedPngButtons();
}

// ---- BDP views (centre BDP tab) -------------------------------------------------------------------------------------
// Dive Profile, 3D Profile, Top View and HUD of the BDP result the Wheel used, on their own clock: seconds from the Roll-in
// Point (the HUD and 3D start at Roll-in −3 s).

const timePlayer = createTimePlayer({ onStop: () => {} });
const bdpContainer = () => app.querySelector('[data-bdp-views="1"] [data-bdp-diagrams]');

function bdpTimeAfterRelease(result) {
  if (!isNumber(bdpClockSec)) return null;
  const p = result.bombDelivery.public;
  return bdpClockSec - (p.rollInTimeSec + p.trackingTimeSec);
}

function setBdpClock(timeSec) {
  bdpClockSec = isNumber(timeSec) ? timeSec : null;
  refreshBdpViews();
}

function syncBdpDials(container) {
  const span = bdpFlightViewWindow(container);
  container.querySelectorAll("[data-time-dial]").forEach((dial) => {
    timePlayer.installDial(dial, setBdpClock, { startSec: () => bdpFlightViewWindow(container)?.startSec ?? 0, endSec: () => bdpFlightViewWindow(container)?.endSec ?? Infinity, clockSec: () => bdpClockSec });
    if (!span) return;
    timePlayer.syncDial(dial, { maxSec: span.endSec, timeSec: bdpClockSec });
    const range = dial.querySelector("[data-time-range]");
    range.min = String(span.startSec);
    range.step = "any";
    if (!isNumber(bdpClockSec)) range.value = String(span.startSec);
  });
}

function refreshBdpViews() {
  const section = app.querySelector('[data-bdp-views="1"]');
  const container = bdpContainer();
  if (!section || !container) return;
  section.classList.toggle("show-full-views", bdpViewsShown);
  if (!bdpViewsShown) { cancelBdpDiagramRender(container); return; }
  const result = lastEntry?.result;
  if (!result) { clearBdpDiagrams(container); return; }
  try {
    renderBdpDiagrams(container, result.bombDelivery, {
      progressive: true,
      scope: "wheel-attack-aircraft-1",
      aircraftNumber: 1,
      layout: "OFFSET",
      viewportWidth: globalThis.innerWidth,
      // Wheel: the Roll-in starts on the Wheel at the Roll-in Start heading and turns to the Wheel side (RIGHT / LEFT).
      topView: { orientation: "NORTH_UP", inHeadingDeg: result.rollInStartHeadingDeg, rollDirection: result.rollDirection, context: "PATTERN", rollInRangeStyle: "radial", title: "BDP #1 Top View", lateralDistance: false, remarkDetail: true, attackHeadingDeg: result.attackHeadingDeg, oneLineLabels: true },
      profileView: { timeAfterReleaseSec: bdpTimeAfterRelease(result) },
      flightView: { rollDirection: result.rollDirection, timeSec: bdpClockSec, approach: null },
    });
    syncBdpDials(container);
  } catch {
    clearBdpDiagrams(container);
  }
}

function mountBdpViews() {
  const host = app.querySelector('[data-bdp-diagrams-host="1"]');
  if (!host) return;
  host.outerHTML = bdpDiagramsMarkup({
    aircraftNumber: 1, topTitle: "BDP #1 Top View", topAdvanced: true, topOrientation: true, profileAdvanced: true,
    flightViews: true, threeDTitle: "BDP #1 3D Profile", hudTitle: "BDP #1 HUD View",
    hudTimeMarkup: timeDialMarkup({ id: "hud-1", groupLabel: "BDP #1 HUD View time from the Roll-in Point", rangeLabel: "Seconds from the Roll-in Point", outputTitle: "Seconds from the Roll-in Point; press to turn off" }),
    threeDTimeMarkup: timeDialMarkup({ id: "3d-1", groupLabel: "BDP #1 3D Profile time from the Roll-in Point", rangeLabel: "Seconds from the Roll-in Point", outputTitle: "Seconds from the Roll-in Point; press to turn off" }),
  });
}

// ---- DED PNG ----------------------------------------------------------------------------------------------------------

const dedAvailable = (number) => number === 1 && !!lastEntry?.ded;
// The DED is #1's (the Flight flies #1's data and rolls in from the same point): "PNG (shown)" takes #1 when shown.
const shownDedAircraft = () => shownAircraft.visible().filter((number) => number === 1);
function syncDedPngButtons() {
  syncDedPngButtonStates({ visibleAircraft: shownDedAircraft, available: dedAvailable });
}

// ---- Shown aircraft ---------------------------------------------------------------------------------------------------

const shownAircraft = createShownAircraft({ available: () => [1, ...followerNumbers()] });
installShownAircraftClicks((number) => {
  shownAircraft.toggle(number);
  shownAircraft.sync();
  syncDedPngButtons();
});
// The Top View colours the shown aircraft.
shownAircraft.onChange(() => renderTopView());

// ---- Save / Load ------------------------------------------------------------------------------------------------------

const validSave = (record) => isRecordObject(record?.aircraft?.[1]) && isRecordObject(record.aircraft[1].values);

function readSave() {
  try {
    return readWorkRecord(localStorage, SAVE_KEY, { schemaVersion: SAVE_SCHEMA, valid: validSave }).record;
  } catch {
    return null;
  }
}

function setSaveStatus(text, kind = "valid") {
  const status = $("#save-status");
  status.textContent = text;
  status.className = `status-message ${kind}`;
}

function installSaveTab() {
  const saveRun = createSaveRun({
    buttons: () => [$("#work-save")],
    // Save keeps the state the BE answered last: wait for the current request first.
    settle: () => scheduler.flush(),
    save: () => writeWorkRecord(localStorage, SAVE_KEY, {
      schemaVersion: SAVE_SCHEMA,
      build: () => ({
        schemaVersion: SAVE_SCHEMA, savedAt: new Date().toISOString(), flightSize,
        aircraft: { 1: structuredClone(lead) },
        editAircraft: editAircraftOf(), shown: shownAircraft.saved(),
      }),
    }),
    status: setSaveStatus,
    savedText: (saved) => `Saved · ${savedTimeText(new Date(saved.savedAt))}`,
    failedText: (error) => `Save failed · ${error.message}`,
  });
  $("#work-save").addEventListener("click", () => saveRun.run());
  $("#work-default").addEventListener("click", () => {
    lead = wheelAttackFlightDefaultLead();
    writeAllFields();
    scheduler.reset();
    setSaveStatus("Default loaded · not saved until Save", "warning");
  });
}

// ---- Top View / Z controls --------------------------------------------------------------------------------------------

function installViewControls() {
  // The legend reads its items at each render: Advanced swaps them in place.
  const legendItems = [...WHEEL_ATTACK_TOP_VIEW_V0_1.legend];
  legend = installSvgLegend($("#wheel-legend"), legendItems);
  installTopViewSize();
  const output = $("#top-view-font-scale-output");
  const step = (direction) => {
    const index = TOP_VIEW_TEXT_SCALES.indexOf(topViewTextScale);
    topViewTextScale = TOP_VIEW_TEXT_SCALES[Math.min(TOP_VIEW_TEXT_SCALES.length - 1, Math.max(0, index + direction))];
    output.textContent = `${Math.round(topViewTextScale * 100)}%`;
    renderTopView();
  };
  $("#top-view-font-down").addEventListener("click", () => step(-1));
  $("#top-view-font-up").addEventListener("click", () => step(1));
  output.addEventListener("click", () => { topViewTextScale = 1; output.textContent = "100%"; renderTopView(); });
  const advancedButton = $("#top-view-advanced");
  advancedButton.addEventListener("click", () => {
    topViewAdvanced = !topViewAdvanced;
    advancedButton.setAttribute("aria-pressed", String(topViewAdvanced));
    advancedButton.classList.toggle("active", topViewAdvanced);
    advancedButton.textContent = `Advanced: ${topViewAdvanced ? "On" : "Off"}`;
    legendItems.splice(0, legendItems.length, ...(topViewAdvanced ? WHEEL_ATTACK_TOP_VIEW_V0_1.advancedLegend : WHEEL_ATTACK_TOP_VIEW_V0_1.legend));
    renderTopView();
  });
  const png = (svg, title) => saveSvgAsPng(svg, `${title.replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" });
  $("#capture-top-view").addEventListener("click", () => png($("#wheel-top-view"), wheelAttackTopViewTitle({ aircraftNumber: 1 })));
  $("#capture-z").addEventListener("click", () => png($("#wheel-z-svg"), wheelAttackZDiagramTitle({ aircraftNumber: 1 })));
  installDedPngClicks({
    visibleAircraft: shownDedAircraft,
    exportPng: (numbers) => {
      const cards = numbers.map((number) => readDedCard(app.querySelector(`[data-output-aircraft="${number}"][data-aircraft-output="ded"]`), number)).filter(Boolean);
      if (cards.length) saveDedPng(cards, { filename: `WHEEL_DED_${numbers.map((number) => `#${number}`).join("_")}.png`, colorOf: (number) => AIRCRAFT_COLORS[number] });
    },
  });
}

// ---- Flight (#2–#4) ---------------------------------------------------------------------------------------------------
// The Wheel Slot tab of a follower shows its place on the Wheel (its slot in the attack order and its Roll-in time after
// #1); its BDP / Wheel tabs say that it flies #1's data.

const followerNote = (text) => `<p class="flight-draft-note">${text}</p>`;
function followerSlotMarkup(number) {
  const section = (tab, title, body, head = "") => `<section class="section" data-tab="${tab}" data-aircraft-tab="${number}"><div class="section-head"><h2>${title} #${number}</h2>${head}</div>${body}</section>`;
  const sameData = followerNote(`#${number} flies #1's BDP and Wheel data: the Flight has one data set. Edit it on #1.`);
  return section("slot", "Wheel Slot",
    followerNote(`#${number} takes its slot on the Wheel in the attack order (1 → N → … → 2) and rolls in from #1's Roll-in Start one attack interval per slot after #1. The Wheel Top View shows each aircraft there.`)
      + `<div id="flight-slot-${number}" class="flight-draft-note">-</div>`
      + `<div id="flight-status-${number}" class="status-message valid">-</div>`,
    `<div class="wheel-head-status"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div>`)
    + section("bdp", "BDP", sameData)
    + section("wheel", "Wheel", sameData);
}

function renderFollowerStatus(number, entry) {
  const pill = document.getElementById(`flight-state-pill-${number}`);
  const message = document.getElementById(`flight-status-${number}`);
  const slot = document.getElementById(`flight-slot-${number}`);
  if (!pill || !message) return;
  const status = !entry || entry.status === "FAILED" ? "INVALID" : entry.status;
  pill.textContent = status;
  pill.className = `status ${status === "VALID" ? "ok" : status === "WARNING" ? "warn" : "bad"}`;
  message.textContent = status === "VALID" ? "VALID" : `INVALID · ${entry?.error ?? "no result"}`;
  message.className = `status-message ${status.toLowerCase()}`;
  const p = entry?.position;
  if (slot) slot.textContent = p ? `Slot ${p.slot + 1} · Roll-in ${legTime(p.rollInDelaySec)} after #1 · now at radial ${headingText(p.radialDeg)}, heading ${headingText(p.headingDeg)}` : "-";
}

function renderFollowerSlots() {
  const host = document.getElementById("flight-followers");
  host.replaceChildren(...followerNumbers().map((number) => {
    const node = document.createElement("div");
    node.className = "flight-slot";
    node.dataset.aircraft = String(number);
    node.innerHTML = followerSlotMarkup(number);
    return node;
  }));
  installSectionDisclosureOn(host.querySelectorAll(".section[data-tab]"), { idPrefix: "wheel-follower-body" });
  installTabs(host);
}

// Size of Flight: the followers it adds are shown; the ones it drops go.
function setFlightSize(size, { calculate = true } = {}) {
  const before = flightSize;
  flightSize = Math.min(4, Math.max(1, Number(size) || 1));
  $("#flight-size").value = String(flightSize);
  followerNumbers().forEach(followerRecord);
  renderFollowerSlots();
  shownAircraft.prune(flightSize);
  if (flightSize > before) shownAircraft.replace([...shownAircraft.saved(), ...followerNumbers().filter((number) => number > before)]);
  shownAircraft.sync();
  if (calculate) scheduler.immediate();
}

// ---- Mount --------------------------------------------------------------------------------------------------------------

function mountInputs() {
  const turnNote = "Roll-in";
  const bdpSection = app.querySelector('[data-bdp-tab="1"]');
  bdpSection.innerHTML = bdpTabMarkup({ number: 1, weapons: WEAPON_DATABASE_V0_1.map((weapon) => ({ id: weapon.id, label: weapon.name })), angleOff: { value: "-", note: "Wheel AUTO · tangent roll-in" }, turnNote, targetNote: "Target MSL" });
  app.querySelector("[data-bdp-profile-copy]").innerHTML = bdpProfileFieldsMarkup();
  app.querySelector("[data-roll-in-copy]").innerHTML = rollInTurnFieldsMarkup();
  app.querySelector("[data-turn-onset-copy]").innerHTML = turnOnsetFieldsMarkup({ turnNote });
  app.querySelector('[data-ded-pages="1"]').innerHTML = dedPagesMarkup(["OA1"]);
}

function installTabs(root = app) {
  // BDP: Full BDP immediately before Tab Default (as BOX and Wheel-BOX); Wheel: Advanced (Turn Onset) and Tab Default. A
  // follower's tabs have no tools.
  installSectionTools(root.querySelectorAll(".section[data-tab]"), {
    toolsOf: (section) => (section.dataset.aircraftTab ? [] : ({ bdp: ["fullBdp", "default"], wheel: ["advanced", "default"] })[section.dataset.tab] ?? []),
    defaultLabel: "Tab Default",
    onDefault: (section) => resetTab(section.dataset.tab),
  });
}

mountInputs();
mountBdpViews();
installTabs();
installEdits();
installCalculation();
installSaveTab();
installViewControls();
loadedSave = readSave();
if (loadedSave) {
  lead = structuredClone(loadedSave.aircraft[1]);
  lead.values ??= {};
  lead.locks ??= {};
  lead.state ??= {};
  setFlightSize(loadedSave.flightSize ?? 1, { calculate: false });
  if (Array.isArray(loadedSave.shown)) shownAircraft.replace(loadedSave.shown.filter((number) => number <= flightSize));
  setSaveStatus(`Loaded · saved ${savedTimeText(new Date(loadedSave.savedAt))}`, "valid");
} else {
  setSaveStatus("Default conditions · not saved yet", "warning");
}
$("#flight-size").addEventListener("change", (event) => setFlightSize(event.target.value));
writeAllFields();
scheduler.reset();

// PC Wide workspace hooks (wide-layout.mjs).
export const wheelIndexUi = Object.freeze({
  visibleAircraft: () => shownAircraft.visible(),
  onVisibleAircraftChange(listener) {
    shownAircraft.onChange(listener);
    listener(shownAircraft.visible());
  },
  syncShowAircraftButtons: () => shownAircraft.sync(),
  registerEditAircraft(getter) { editAircraftOf = getter; },
  savedEditAircraft: () => loadedSave?.editAircraft ?? null,
  syncDedPngButtons,
  installSectionDisclosure() {
    installSectionDisclosureOn(app.querySelectorAll(".section[data-tab]"), { idPrefix: "wheel-section-body" });
  },
  // Centre BDP tab: the BDP views are drawn only while it shows #1.
  showBdpViews(numbers) {
    bdpViewsShown = numbers.includes(1);
    refreshBdpViews();
  },
});
