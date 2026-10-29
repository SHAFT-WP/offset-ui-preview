// Wheel page controller (owner 2026-10-25: "Wheel도 작업하자" — Wheel-BOX (V2), a separate page as BOX's, on the Offset
// FE layout, PC Wide and phone). The FE never calculates: it keeps the Wheel-BOX Flight record the BE returned, puts typed
// values into it, sends the edit events (Common calculation client, Wheel-BOX Flight Worker) and draws the adopted answer.
// Wheel values stay in Wheel: nothing here reads or writes the Offset or BOX page's state.
import {
  WHEEL_BOX_FLIGHT_DEFAULT_STATE, WHEEL_BOX_FLIGHT_DEFAULT_VALUES, WHEEL_BOX_FLIGHT_FORMATION_REFERENCE, WHEEL_BOX_FLIGHT_V0_1, wheelBoxFlightDefaultFollower, wheelBoxFlightDefaultLead,
} from "../AG/bombing/wheel-box/wheel-box-flight-v0.1.mjs?v=0.3.0";
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
import { formationPositionMarkup, installFormationSideSelects } from "../common/ui/formation-position-v0.1.mjs";
import { installSvgLegend } from "../common/diagram/svg-legend-v0.1.mjs";
import { saveSvgAsPng } from "../common/diagram/svg-png-export-v0.1.mjs";
import { svgNode } from "../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { installSvgViewport } from "../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { installSmartLabelDrag } from "../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createTimePlayer, timeDialMarkup } from "../common/ui/time-dial-v0.1.mjs?v=0.1.0";
import { formatDeg, formatFt, formatG, formatKt, formatNm, formatSec } from "../common/ui/display-precision-v0.1.mjs?v=0.1.1";
import { WHEEL_BOX_TOP_VIEW_V0_1, renderWheelBoxTopView, wheelRadiusText, wheelTopViewTitle } from "../AG/bombing/wheel-box/view/wheel-box-top-view-v0.1.mjs?v=0.2.0";
import { renderWheelBoxZDiagramV0_1, wheelAbeamText, wheelZDiagramTitle } from "../AG/bombing/wheel-box/view/wheel-box-z-diagram-v0.1.mjs?v=0.1.2";
import { bdpDiagramsMarkup, bdpFlightViewWindow, cancelBdpDiagramRender, clearBdpDiagrams, renderBdpDiagrams } from "../AG/bombing/bomb-delivery-planner/view/bdp-diagrams-panel-v0.1.mjs?v=0.12.2";

// 0.1.0 (2026-10-25, owner): #1–#4 fly #1's BDP and Wheel data; #2–#4 hold only their Formation position, and the Wheel
// Top View shows each aircraft at its place (BOX's Formation rule).
// 0.2.0 (2026-10-26, owner; Wheel-BOX v0.9 through Wheel-BOX Flight 0.2.0): Downwind Angle 0°, shown fixed, never typed;
// the Base Turn G field is the G asked for, its note and the Result give the G flown; Min Wheel Radius is the geometry or
// the Wheel turn limit radius (no Base Distance floor); Wheel / Orbit limits NOT_EVALUATED read as such.
// 0.3.0 (2026-10-26, owner; Wheel-BOX v0.10 through Wheel-BOX Flight 0.3.0): the Return after a CSEM (Advanced: Return Turn
// G; the Join G in its note), its Result rows (the 300 KCAS hold; the Roll-in Altitude only, a descent to it, the speed
// at Abeam) and the circuit; OA2 = the Base Turn start in the Abeam row.
export const WHEEL_BOX_PAGE_CONTROLLER_V0_1 = Object.freeze({ id: "wheel-box-page-controller-v0.1", version: "0.3.0", flight: WHEEL_BOX_FLIGHT_V0_1.version });

const WORKER_URL = new URL("../AG/bombing/wheel-box/wheel-box-flight-worker-v0.1.mjs?v=0.1.3", import.meta.url);
const SAVE_KEY = "bombing-v2-wheel-work";
const SAVE_SCHEMA = 1;
// The Wheel tab's fields besides its BDP Profile / Roll-in / Turn Onset copies (its Tab Default restores all of them).
const WHEEL_KEYS = Object.freeze(["attackHeadingDeg", "direction", "wheelRadiusNm", "baseTurnG", "wheelSpeedKcas", "wheelAltitudeMslFt", "orbitRadiusNm", "orbitSpeedKcas", "orbitAltitudeMslFt", "returnTurnG"]);
const WHEEL_TAB_COPY_KEYS = Object.freeze(["initialSpeedValue", "initialSpeedMode", "initialAltitudeMslFt", "rollInAltitudeMslFt", "diveAngleDeg", "trackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas", "rollInG", "rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
// Display digits of values a solve writes back (the BDP tab's, plus the Wheel Radius at its 0.01 NM step).
const FIELD_DIGITS = Object.freeze({ ...BDP_FIELD_DIGITS, wheelRadiusNm: 2 });
const TOP_VIEW_TEXT_SCALES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];

const $ = (selector) => document.querySelector(selector);
const app = $("#wheel-calculator");
const fields = (key) => [...app.querySelectorAll(`[data-key="${key}"]`)];
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const sameValue = (a, b) => (isNumber(a) && isNumber(b) ? Math.abs(a - b) <= 1e-9 : Object.is(a ?? null, b ?? null));

let lead = wheelBoxFlightDefaultLead();
let lastEntry = null;
// The Flight: its size, the followers' records ({ formation }, kept when the size shrinks) and the places the BE gave.
let flightSize = 1;
const followers = {};
let lastPositions = {};
let scheduler = null;
let transport = null;
let topViewTextScale = 1;
// Top View Advanced: MAP, the Roll-in Distance, the Min Wheel Radius and the Orbit circles, and the SEM and the Return
// (owner 2026-10-27; off, the first Wheel drawing). The legend follows it.
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
  // The Wheel Radius and its minimums read as the BE states them: rounded up to the field's step, so the MIN radius
  // typed back as shown is never below the route's minimum.
  if (key === "wheelRadiusNm") return wheelRadiusText(value);
  return Object.hasOwn(FIELD_DIGITS, key) ? value.toFixed(FIELD_DIGITS[key]) : String(value);
}

function writeField(field, key, value) {
  const text = fieldText(key, value);
  if (field.tagName === "SELECT") field.value = value ?? "";
  else if (field.value !== text) field.value = text;
}

function writeAllFields() {
  const keys = new Set([...Object.keys(WHEEL_BOX_FLIGHT_DEFAULT_VALUES), ...Object.keys(lead.values), "rollInBankAngleDeg"]);
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

const followerRecord = (number) => (followers[number] ??= wheelBoxFlightDefaultFollower(number));
const followerNumbers = () => [2, 3, 4].filter((number) => number <= flightSize);

function collectInput(edits) {
  const aircraft = { 1: structuredClone(lead) };
  followerNumbers().forEach((number) => { aircraft[number] = structuredClone(followerRecord(number)); });
  const input = { schemaVersion: WHEEL_BOX_FLIGHT_V0_1.schemaVersion, flightSize, aircraft };
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

// A follower's next record: its Formation fields are rewritten unless one is being typed in and kept as sent.
function applyFollowerState(number, next, sent, edits) {
  followers[number] = structuredClone({ formation: next.formation });
  const last = edits.findLast((edit) => (edit.aircraft ?? 1) === number) ?? null;
  const typing = last && last.kind === "set" && last.commit !== true ? last.key : null;
  const active = document.activeElement;
  formationFields(number).forEach((field) => {
    const key = field.dataset.formationField;
    const value = next.formation[key];
    if (field === active && key === typing && sameValue(value, sent?.formation?.[key])) return;
    writeField(field, key, value);
  });
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
  for (const number of followerNumbers()) {
    const record = output.nextInput?.aircraft?.[number];
    if (isRecordObject(record?.formation)) applyFollowerState(number, record, sent.input.aircraft[number], sent.input.edits ?? []);
  }
  lastPositions = Object.fromEntries(Object.entries(output.aircraftResults).filter(([, entry]) => entry?.position).map(([number, entry]) => [number, entry.position]));
  followerNumbers().forEach((number) => renderFollowerStatus(number, output.aircraftResults[number]));
  renderLead(output.aircraftResults[1]);
}

function installCalculation() {
  transport = createWorkerTransport({ workerUrl: WORKER_URL, hostFactory: "createWheelBoxFlightHost" });
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
const formationFields = (number) => [...app.querySelectorAll(`.flight-slot[data-aircraft="${number}"] [data-formation-field]`)];
const slotNumber = (node) => Number(node.closest(".flight-slot")?.dataset.aircraft);

// A follower's Formation field: the typed value goes into its record, then the event (the BE refills a cleared one).
function commitFormationField(field, how) {
  const number = slotNumber(field);
  const key = field.dataset.formationField;
  const record = followerRecord(number);
  if (field.value.trim() === "") {
    record.formation[key] = null;
    scheduler[how]({ aircraft: number, kind: "clear", key });
    return;
  }
  record.formation[key] = field.tagName === "SELECT" ? field.value : parsedFieldValue(field.value, null);
  scheduler[how]({ aircraft: number, kind: "set", key, commit: true });
}

function installFormationEdits() {
  app.addEventListener("input", (event) => {
    const field = event.target.closest?.("input[data-formation-field]");
    if (!field) return;
    const record = followerRecord(slotNumber(field));
    const key = field.dataset.formationField;
    if (field.value.trim() === "") {
      record.formation[key] = null;
      scheduler.hold();
      return;
    }
    record.formation[key] = parsedFieldValue(field.value, null);
    scheduler.input({ aircraft: slotNumber(field), kind: "set", key });
  });
  app.addEventListener("change", (event) => {
    const field = event.target.closest?.("[data-formation-field]");
    if (!field) return;
    if (field.tagName === "SELECT") { commitFormationField(field, "immediate"); return; }
    if (enterCommit.consumed(field)) return;
    commitFormationField(field, "commit");
  });
  app.addEventListener("keydown", (event) => {
    const field = event.target.closest?.("input[data-formation-field]");
    if (event.key !== "Enter" || !field) return;
    event.preventDefault();
    enterCommit.mark(field);
    commitFormationField(field, "immediate");
  });
}

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
  keys.forEach((key) => { lead.values[key] = WHEEL_BOX_FLIGHT_DEFAULT_VALUES[key]; });
  lead.locks = {};
  Object.assign(lead.state, {
    solveMode: WHEEL_BOX_FLIGHT_DEFAULT_STATE.solveMode,
    rollInAltitudeLinked: WHEEL_BOX_FLIGHT_DEFAULT_STATE.rollInAltitudeLinked,
    enteredTrackingTimeSec: WHEEL_BOX_FLIGHT_DEFAULT_STATE.enteredTrackingTimeSec,
    ...(tab === "wheel" ? { wheelRadiusSource: WHEEL_BOX_FLIGHT_DEFAULT_STATE.wheelRadiusSource } : {}),
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
function turnText(turn) {
  return `${formatG(turn.loadFactorG)} G · ${formatDeg(turn.bankAngleDeg)}° · R ${formatNm(turn.instantaneous.radiusNm)} NM · ${formatSec(turn.timeSec)} sec`;
}
// The Base Turn G the BE flew: the G asked for, or raised to fit Base Distance (both shown).
const raisedGText = (base) => `${formatG(base.requestedLoadFactorG)} → ${formatG(base.loadFactorG)} G · raised to fit Base Distance`;
// Source-bounded turn limits: within, outside (the issues), or not evaluated (the reason; neither a pass nor a block).
function limitsText(performance) {
  if (performance.valid === null) return `not evaluated: ${performance.reason}`;
  return performance.valid ? "within the source limits" : `outside: ${performance.issues.join(", ")}`;
}

function wheelResultRows(result) {
  const p = result.pattern;
  const w = result.wheel;
  const abeam = wheelAbeamText(p.abeamExtensionTimeSec) ?? "-";
  const row = (label, text, key, summary = false) => resultRow(label, text, key, { summary });
  const rows = [
    row("Abeam", `${abeam.replace("Abeam ", "")} · ${formatNm(p.abeamExtensionDistanceNm)} NM${oa2Text(result)}`, "abeam", true),
    row("Wheel Radius", `${fieldText("wheelRadiusNm", w.radiusNm)} NM · ${w.radiusMode === "MIN_WHEEL_RADIUS" ? "MIN" : "manual"} · min ${wheelRadiusText(w.minimumUsableWheelRadiusNm)} NM`, "wheelRadiusNm", true),
    row("Min Wheel Radius", `${wheelRadiusText(w.minWheelRadiusNm)} NM · zero Base Leg ${wheelRadiusText(w.geometryMinWheelRadiusNm)} NM · turn limit ${isNumber(w.performanceMinWheelRadiusNm) ? `${wheelRadiusText(w.performanceMinWheelRadiusNm)} NM` : "not evaluated"}`, "minWheelRadiusNm"),
    row("Wheel Turn", `${formatKt(w.wheelSpeedKcas)} kcas · ${formatFt(w.wheelAltitudeMslFt)} ft · ${formatDeg(w.wheelBankAngleDeg)}° · 180° ${legTime(w.wheelTurn180TimeSec)}`, "wheelTurn", true),
    row("Wheel Performance", `${w.performance.profile?.id ?? "source profile"} · ${limitsText(w.performance)}`, "wheelPerformance"),
    row("Downwind", `${headingText(result.downwindHeadingDeg)} · Downwind Angle ${formatDeg(p.downwindAngleDeg)}° · Fixed`, "downwind"),
    row("Base Turn", turnText(result.turns.base), "baseTurn", true),
    ...(result.turns.base.autoRaised ? [row("Base Turn G", raisedGText(result.turns.base), "baseTurnG", true)] : []),
    row("Base Leg", `${formatNm(p.baseLegNm)} NM · ${legTime(p.baseLegTimeSec)}`, "baseLegNm", true),
    row("Base Distance", `${formatNm(p.baseDistanceNm)} NM`, "baseDistanceNm"),
    row("Roll-in Long. D", `${formatNm(p.rollInLongitudinalDistanceNm)} NM`, "rollInLongitudinalDistanceNm"),
    row("Pattern Speed", `${formatKt(p.patternSpeedKcas)} kcas · ${formatKt(p.patternTasKt)} kt TAS`, "patternSpeed", true),
  ];
  if (result.orbit) {
    const o = result.orbit;
    rows.push(row("Orbit", `${formatNm(o.orbitRadiusNm)} NM · ${formatKt(o.orbitSpeedKcas)} kcas · ${formatFt(o.orbitAltitudeMslFt)} ft · ${formatDeg(o.orbitBankAngleDeg)}° · 180° ${legTime(o.orbitTurn180TimeSec)}${o.performance.valid ? "" : ` · ${limitsText(o.performance)}`}`, "orbit"));
  }
  rows.push(...returnRows(result, row));
  rows.push(row("Direction", result.direction, "direction"), row("Attack Heading", headingText(result.attackHeadingDeg), "attackHeadingDeg"));
  return rows;
}

// OA2 (Wheel-BOX v0.10): the Base Turn start, the Abeam Extension's visual reference, as the Roll-in point's range / angle.
function oa2Text(result) {
  const v = result.geometry?.values ?? {};
  return isNumber(v.oa2RangeNm) && isNumber(v.oa2AngleDeg) ? ` · to OA2 ${formatNm(v.oa2RangeNm)}NM/${formatDeg(v.oa2AngleDeg)}° (Base Turn start)` : "";
}

// The Return (v0.10): solved, not calculated (no CSEM) or INVALID (the reason); the recovery and the circuit.
function returnRows(result, row) {
  const ret = result.return;
  if (!ret) return [];
  if (ret.status === "NOT_CALCULATED") return [row("Return", `not calculated · ${ret.reason}`, "return")];
  if (ret.status !== "VALID" && !ret.samples?.length) return [row("Return", `INVALID · ${ret.errors.join(" / ")}`, "return")];
  const perf = ret.performance;
  const p = ret.phases;
  const extension = ret.extensionNm > 0 ? ` · Extension ${formatNm(ret.extensionNm)} NM (altitude first)` : "";
  // The Join G turn at 300 KCAS where MIL cannot hold it: the altitude it gives up.
  const held = ret.minimumSpeedHeldSec > 0 ? ` (300 kcas held ${legTime(ret.minimumSpeedHeldSec)}, ${formatFt(p.turnLevel.altitudeMslFt - p.turnBank.altitudeMslFt)} ft)` : "";
  const descent = p.downwind.descentFt > 0 ? ` · ${formatFt(p.downwind.descentFt)} ft descended on the Downwind (below MIL)` : "";
  const rows = [
    row("Return", `${legTime(ret.timeSec)} · ${formatNm(ret.distanceNm)} NM · Climb ${formatFt(p.climb.altitudeMslFt)} ft / ${formatKt(p.climb.casKt)} kcas${extension} · Turn ${formatG(ret.inputs.turnG)} G (90° bank) → ${formatG(ret.joinLoadFactorG)} G${held} · Downwind ${formatNm(p.downwind.distanceNm)} NM`, "return", true),
    row("Recovery", ret.recovery
      ? `${formatFt(ret.target.altitudeMslFt)} ft at ${legTime(ret.recovery.timeSec)}${descent} · ${formatKt(ret.abeamState.casKt)} kcas at Abeam · ${perf.engineModel} ${perf.powerSetting} research model · unofficial${perf.outsideDomainStates ? ` · ${perf.outsideDomainStates}/${perf.states} states outside its data` : ""}`
      : `not back by Abeam · ${ret.errors.join(" / ")}`, "recovery"),
  ];
  if (result.circuit) rows.push(row("Circuit", `${formatNm(result.circuit.distanceNm)} NM · ${legTime(result.circuit.timeSec)} (Abeam → Release → SEM → Return)`, "circuit", true));
  return rows;
}

function renderResults(entry) {
  const result = entry?.result;
  $("#wheel-result-body").innerHTML = result ? wheelResultRows(result).join("") : "";
  $("#profile-result-body").innerHTML = result ? bdpResultRows(result.bombDelivery).join("") : "";
  resultPanel.refresh();
}

function renderPlaceholders(result) {
  // Wheel turn and Orbit options left blank show the value the BE used (the BDP Initial state).
  const placeholderOf = {
    wheelSpeedKcas: result?.wheel?.wheelSpeedKcas,
    wheelAltitudeMslFt: result?.wheel?.wheelAltitudeMslFt,
    orbitSpeedKcas: result?.orbit?.orbitSpeedKcas ?? result?.pattern?.patternSpeedKcas,
    orbitAltitudeMslFt: result?.orbit?.orbitAltitudeMslFt ?? result?.pattern?.patternAltitudeMslFt,
  };
  for (const [key, value] of Object.entries(placeholderOf)) {
    fields(key).forEach((field) => { field.placeholder = isNumber(value) ? String(Math.round(value)) : ""; });
  }
  fields("orbitRadiusNm").forEach((field) => { field.placeholder = "No Orbit"; });
  const turnNote = app.querySelector("[data-return-turn-note]");
  if (turnNote) turnNote.textContent = Number.isFinite(result?.return?.joinLoadFactorG) ? `90° bank · then ${formatG(result.return.joinLoadFactorG)} G to the Abeam line` : "90° bank to level · default 1.5 G";
  const gNote = app.querySelector("[data-base-turn-g-note]");
  if (gNote) gNote.textContent = result?.turns?.base?.autoRaised ? `Flown ${formatG(result.turns.base.loadFactorG)} G · raised to fit Base Distance` : "Level Turn 90° · default 2 G, up to 3 G";
  const note = app.querySelector("[data-wheel-radius-note]");
  if (note) {
    const minimum = result?.wheel?.minimumUsableWheelRadiusNm;
    const source = lead.state.wheelRadiusSource === "MANUAL" ? "Typed · clear for MIN" : "MIN: the smallest radius that flies the route";
    note.textContent = isNumber(minimum) ? `${source} · min ${wheelRadiusText(minimum)} NM` : source;
  }
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

// Top View Size (owner 2026-10-25, as on Offset): the Common viewport, button-only Size 50–200 % in 25 % steps, pan
// only while zoomed in, Reset back to 100 %. The view's canvas is the 100 % base. A new result or another set of
// shown aircraft refits; Text and Advanced keep the user's zoom. As on Offset, the Common label drag is installed too:
// it keeps a pan from selecting the view's text (the Wheel view marks no label movable yet, so no label moves).
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
    baseViewBox: { x: 0, y: 0, w: WHEEL_BOX_TOP_VIEW_V0_1.canvas.width, h: WHEEL_BOX_TOP_VIEW_V0_1.canvas.maxHeight },
    panOnlyWhenZoomed: true,
    buttonOnlyZoom: true,
    allowPageScrollWhenPanDisabled: true,
    maxZoom: 2,
    maxZoomOut: 2,
    onViewBoxChange: (box) => {
      const percent = Math.round((topViewViewport?.getBaseViewBox().w ?? WHEEL_BOX_TOP_VIEW_V0_1.canvas.width) / box.w * 100);
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
    const width = WHEEL_BOX_TOP_VIEW_V0_1.canvas.width;
    showCalculationFailed(svg, wheelTopViewTitle({ aircraftNumber: 1 }), lastEntry?.error ?? "no result", width);
    syncTopViewSize({ width, height: 220 }, null);
    $("#capture-top-view").disabled = true;
    return;
  }
  // Formation (Flight of 2–4): each shown aircraft at the place the BE gave it.
  const formation = flightSize > 1
    ? shownAircraft.visible().filter((number) => lastPositions[number]).map((number) => ({ number, ...lastPositions[number], color: AIRCRAFT_COLORS[number] }))
    : [];
  const rendered = renderWheelBoxTopView(svg, result, { aircraftNumber: 1, textScale: topViewTextScale, formation, advanced: topViewAdvanced });
  syncTopViewSize(rendered.canvas, `${resultSerial(result)}|${formation.map((item) => item.number).join(",")}`);
  $("#capture-top-view").disabled = false;
  legend?.render?.();
}

function renderZ() {
  const svg = $("#wheel-z-svg");
  const result = lastEntry?.result;
  if (!result) {
    showCalculationFailed(svg, wheelZDiagramTitle({ aircraftNumber: 1 }), lastEntry?.error ?? "no result", 650);
    $("#capture-z").disabled = true;
    return;
  }
  $("#capture-z").disabled = !renderWheelBoxZDiagramV0_1(svg, result, { aircraftNumber: 1 }).rendered;
}

const dedOut = (index, key) => app.querySelector(`[data-ded-pages="1"] [data-ded-oa="${index}-${key}"]`);
function renderDed(ded) {
  if (ded?.pages) writeDedPages(dedOut, ded.pages);
  else clearDedPages(dedOut, 2);
}

function renderLead(entry) {
  lastEntry = entry ?? null;
  renderStatus(entry);
  renderResults(entry);
  renderPlaceholders(entry?.result ?? null);
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
      scope: "wheel-aircraft-1",
      aircraftNumber: 1,
      layout: "OFFSET",
      viewportWidth: globalThis.innerWidth,
      // Wheel-BOX (BE): the Base Leg into OA1 is the Initial heading; the Roll-in turns to the Wheel side (RIGHT / LEFT).
      topView: { orientation: "NORTH_UP", inHeadingDeg: result.baseLegHeadingDeg, rollDirection: result.rollDirection, context: "PATTERN", rollInRangeStyle: "radial", title: "BDP #1 Top View", lateralDistance: false, remarkDetail: true, attackHeadingDeg: result.attackHeadingDeg, oneLineLabels: true },
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
// The DED is #1's (the Flight flies #1's data): "PNG (shown)" takes #1 when it is shown.
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
// The Top View draws the shown aircraft's places.
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
        aircraft: { 1: structuredClone(lead), ...Object.fromEntries(Object.entries(followers).map(([number, record]) => [number, structuredClone(record)])) },
        editAircraft: editAircraftOf(), shown: shownAircraft.saved(),
      }),
    }),
    status: setSaveStatus,
    savedText: (saved) => `Saved · ${savedTimeText(new Date(saved.savedAt))}`,
    failedText: (error) => `Save failed · ${error.message}`,
  });
  $("#work-save").addEventListener("click", () => saveRun.run());
  $("#work-default").addEventListener("click", () => {
    lead = wheelBoxFlightDefaultLead();
    [2, 3, 4].forEach((number) => { followers[number] = wheelBoxFlightDefaultFollower(number); });
    writeAllFields();
    writeFormationFields();
    scheduler.reset();
    setSaveStatus("Default loaded · not saved until Save", "warning");
  });
}

// ---- Top View / Z controls --------------------------------------------------------------------------------------------

function installViewControls() {
  // The legend reads its items at each render: Advanced swaps them in place.
  const legendItems = [...WHEEL_BOX_TOP_VIEW_V0_1.legend];
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
    legendItems.splice(0, legendItems.length, ...(topViewAdvanced ? WHEEL_BOX_TOP_VIEW_V0_1.advancedLegend : WHEEL_BOX_TOP_VIEW_V0_1.legend));
    renderTopView();
  });
  const png = (svg, title) => saveSvgAsPng(svg, `${title.replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" });
  $("#capture-top-view").addEventListener("click", () => png($("#wheel-top-view"), wheelTopViewTitle({ aircraftNumber: 1 })));
  $("#capture-z").addEventListener("click", () => png($("#wheel-z-svg"), wheelZDiagramTitle({ aircraftNumber: 1 })));
  installDedPngClicks({
    visibleAircraft: shownDedAircraft,
    exportPng: (numbers) => {
      const cards = numbers.map((number) => readDedCard(app.querySelector(`[data-output-aircraft="${number}"][data-aircraft-output="ded"]`), number)).filter(Boolean);
      if (cards.length) saveDedPng(cards, { filename: `WHEEL_DED_${numbers.map((number) => `#${number}`).join("_")}.png`, colorOf: (number) => AIRCRAFT_COLORS[number] });
    },
  });
}

// ---- Flight (#2–#4) ---------------------------------------------------------------------------------------------------
// The Formation tab (Offset's structure, #2–#4) holds each follower's position; the BDP / Wheel / Spacer Turn tabs of a
// follower say that it flies #1's data (BOX's rule).

const followerNote = (number, text) => `<p class="flight-draft-note">${text}</p>`;
function followerSlotMarkup(number) {
  const reference = WHEEL_BOX_FLIGHT_FORMATION_REFERENCE[number];
  const section = (tab, title, body, head = "") => `<section class="section" data-tab="${tab}" data-aircraft-tab="${number}"><div class="section-head"><h2>${title} #${number}</h2>${head}</div>${body}</section>`;
  const sameData = followerNote(number, `#${number} flies #1's BDP and Wheel data: the Flight has one data set. Edit it on #1.`);
  return section("formation", "Formation",
    followerNote(number, `Position from #${reference}'s tail, laid off at #1's Abeam on the Downwind heading. The Wheel Top View shows each aircraft there. The Spacer Turn will set the spacing from this Formation (later step).`)
      + formationPositionMarkup({ attribute: "data-formation-field", keys: { side: "side", bearing: "bearingDeg", range: "distanceNm" }, referenceLabel: `#${reference}` })
      + `<div id="flight-status-${number}" class="status-message valid">-</div>`,
    `<div class="wheel-head-status"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div>`)
    + section("bdp", "BDP", sameData)
    + section("wheel", "Wheel", sameData)
    + section("spacer", "Spacer Turn", followerNote(number, "Spacer Turn is the Wheel slot of S&amp;R. Its content comes in a later step."));
}

function writeFormationFields() {
  followerNumbers().forEach((number) => formationFields(number).forEach((field) => writeField(field, field.dataset.formationField, followerRecord(number).formation[field.dataset.formationField])));
}

function renderFollowerStatus(number, entry) {
  const pill = document.getElementById(`flight-state-pill-${number}`);
  const message = document.getElementById(`flight-status-${number}`);
  if (!pill || !message) return;
  const status = !entry || entry.status === "FAILED" ? "INVALID" : entry.status;
  pill.textContent = status;
  pill.className = `status ${status === "VALID" ? "ok" : status === "WARNING" ? "warn" : "bad"}`;
  message.textContent = status === "VALID" ? "VALID" : `INVALID · ${entry?.error ?? "no result"}`;
  message.className = `status-message ${status.toLowerCase()}`;
}

function renderFollowerSlots() {
  const host = document.getElementById("flight-followers");
  host.replaceChildren(...followerNumbers().map((number) => {
    const slot = document.createElement("div");
    slot.className = "flight-slot";
    slot.dataset.aircraft = String(number);
    slot.innerHTML = followerSlotMarkup(number);
    return slot;
  }));
  installFormationSideSelects(host);
  installSectionDisclosureOn(host.querySelectorAll(".section[data-tab]"), { idPrefix: "wheel-follower-body" });
  installTabs(host);
  writeFormationFields();
}

// Size of Flight: the followers it adds take their saved or default place and are shown; the ones it drops keep
// their records for a later regrowth.
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
  const turnNote = "Base Turn";
  const bdpSection = app.querySelector('[data-bdp-tab="1"]');
  bdpSection.innerHTML = bdpTabMarkup({ number: 1, weapons: WEAPON_DATABASE_V0_1.map((weapon) => ({ id: weapon.id, label: weapon.name })), angleOff: { value: "90", note: "Wheel-BOX fixed" }, turnNote, targetNote: "Target MSL" });
  app.querySelector("[data-bdp-profile-copy]").innerHTML = bdpProfileFieldsMarkup();
  app.querySelector("[data-roll-in-copy]").innerHTML = rollInTurnFieldsMarkup();
  app.querySelector("[data-turn-onset-copy]").innerHTML = turnOnsetFieldsMarkup({ turnNote });
  app.querySelector('[data-ded-pages="1"]').innerHTML = dedPagesMarkup(["OA1", "OA2"]);
}

function installTabs(root = app) {
  // BDP: Full BDP immediately before Tab Default (owner 2026-10-25); Wheel: Advanced (Turn Onset, Wheel Turn, Orbit) and
  // Tab Default; a follower's Formation: Tab Default. A follower's BDP / Wheel note has no tools.
  installSectionTools(root.querySelectorAll(".section[data-tab]"), {
    toolsOf: (section) => (section.dataset.aircraftTab
      ? (section.dataset.tab === "formation" ? ["default"] : [])
      : ({ bdp: ["fullBdp", "default"], wheel: ["advanced", "default"] })[section.dataset.tab] ?? []),
    defaultLabel: "Tab Default",
    onDefault: (section) => (section.dataset.aircraftTab ? resetFormation(Number(section.dataset.aircraftTab)) : resetTab(section.dataset.tab)),
  });
}

function resetFormation(number) {
  followers[number] = wheelBoxFlightDefaultFollower(number);
  writeFormationFields();
  scheduler.reset();
}

mountInputs();
mountBdpViews();
installTabs();
installEdits();
installFormationEdits();
installCalculation();
installSaveTab();
installViewControls();
loadedSave = readSave();
if (loadedSave) {
  lead = structuredClone(loadedSave.aircraft[1]);
  lead.values ??= {};
  lead.locks ??= {};
  lead.state ??= {};
  [2, 3, 4].forEach((number) => { if (isRecordObject(loadedSave.aircraft[number]?.formation)) followers[number] = structuredClone({ formation: loadedSave.aircraft[number].formation }); });
  setFlightSize(loadedSave.flightSize ?? 1, { calculate: false });
  if (Array.isArray(loadedSave.shown)) shownAircraft.replace(loadedSave.shown.filter((number) => number <= flightSize));
  // An angle saved before Wheel-BOX v0.9 is now 0° (Wheel-BOX Flight drops it with a warning on the first solve).
  const savedAngle = loadedSave.aircraft[1].values.downwindAngleDeg;
  const angleNote = typeof savedAngle === "number" && savedAngle !== 0 ? ` · saved Downwind Angle ${formatDeg(savedAngle)}° is now fixed at 0°` : "";
  setSaveStatus(`Loaded · saved ${savedTimeText(new Date(loadedSave.savedAt))}${angleNote}`, angleNote ? "warning" : "valid");
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
