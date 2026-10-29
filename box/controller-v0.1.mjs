// BOX page controller (owner 2026-10-23 / 25: a separate BOX page on the Offset FE layout, PC Wide and phone). The FE
// never calculates: it keeps the BOX Flight record the BE returned, puts typed values into it, sends the edit events
// (Common calculation client, BOX Flight Worker) and draws the adopted answer. BOX values stay in BOX (owner
// 2026-10-25): nothing here reads or writes the Offset page's state.
import {
  BOX_FLIGHT_DEFAULT_STATE, BOX_FLIGHT_DEFAULT_VALUES, BOX_FLIGHT_FORMATION_REFERENCE, BOX_FLIGHT_V0_1, boxFlightDefaultFollower, boxFlightDefaultLead,
} from "../AG/bombing/box-pattern/box-flight-v0.1.mjs?v=0.3.0";
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
import { BOX_TOP_VIEW_V0_5, boxTopViewTitle, renderBoxTopView } from "../AG/bombing/box-pattern/view/box-top-view-v0.5.mjs?v=0.5.3";
import { boxAbeamText, boxZDiagramTitle, renderBoxZDiagramV0_3 } from "../AG/bombing/box-pattern/view/box-z-diagram-v0.3.mjs?v=0.3.0";
import { bdpDiagramsMarkup, bdpFlightViewWindow, cancelBdpDiagramRender, clearBdpDiagrams, renderBdpDiagrams } from "../AG/bombing/bomb-delivery-planner/view/bdp-diagrams-panel-v0.1.mjs?v=0.11.7";

// 0.2.0 (2026-10-25, owner): Formation. #1–#4 fly #1's BDP and BOX data; #2–#4 hold only their Formation position, and
// the BOX Top View shows each aircraft at its place. The spacing between them is the Spacer Turn's (a later step).
export const BOX_PAGE_CONTROLLER_V0_1 = Object.freeze({ id: "box-page-controller-v0.1", version: "0.2.0", flight: BOX_FLIGHT_V0_1.version });

const WORKER_URL = new URL("../AG/bombing/box-pattern/box-flight-worker-v0.1.mjs?v=0.1.3", import.meta.url);
const SAVE_KEY = "bombing-v2-box-work";
const SAVE_SCHEMA = 1;
// The BOX tab's fields besides its BDP Profile / Roll-in / Turn Onset copies (its Tab Default restores all of them).
const BOX_KEYS = Object.freeze(["attackHeadingDeg", "baseTurnG", "crossTurnG", "crossLegExtensionNm", "outSpeedKcas", "outRecoveryG", "outClimbPitchDeg", "outClimbG", "outTurnSpeedKcas", "outTurnBankDeg", "outTurnG", "outMinimumSpeedKcas"]);
const BOX_TAB_COPY_KEYS = Object.freeze(["initialSpeedValue", "initialSpeedMode", "initialAltitudeMslFt", "rollInAltitudeMslFt", "diveAngleDeg", "trackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas", "rollInG", "rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
const OUT_DEFAULT_OF = Object.freeze({
  outSpeedKcas: "outSpeedKcas", outRecoveryG: "recoveryG", outClimbPitchDeg: "climbPitchDeg", outClimbG: "climbG",
  outTurnSpeedKcas: "turnSpeedKcas", outTurnBankDeg: "turnBankDeg", outTurnG: "turnG", outMinimumSpeedKcas: "minimumSpeedKcas",
});
// Display digits of values a solve writes back (the BDP tab's, plus the BOX Crosswind Leg).
const FIELD_DIGITS = Object.freeze({ ...BDP_FIELD_DIGITS, crossLegExtensionNm: 1 });
const TOP_VIEW_TEXT_SCALES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];

const $ = (selector) => document.querySelector(selector);
const app = $("#box-calculator");
const fields = (key) => [...app.querySelectorAll(`[data-key="${key}"]`)];
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const sameValue = (a, b) => (isNumber(a) && isNumber(b) ? Math.abs(a - b) <= 1e-9 : Object.is(a ?? null, b ?? null));

let lead = boxFlightDefaultLead();
let lastEntry = null;
// The Flight: its size, the followers' records ({ formation }, kept when the size shrinks) and the places the BE gave.
let flightSize = 1;
const followers = {};
let lastPositions = {};
let scheduler = null;
let transport = null;
let topViewTextScale = 1;
// Top View Advanced (owner 2026-10-25): MAP and the Roll-in Distance.
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
  const keys = new Set([...Object.keys(BOX_FLIGHT_DEFAULT_VALUES), ...Object.keys(lead.values), "rollInBankAngleDeg"]);
  keys.forEach((key) => fields(key).forEach((field) => writeField(field, key, lead.values[key])));
  syncToggles();
}

// The other copies of a field (BDP tab ↔ BOX tab) show what is typed at once: they are one value.
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

const followerRecord = (number) => (followers[number] ??= boxFlightDefaultFollower(number));
const followerNumbers = () => [2, 3, 4].filter((number) => number <= flightSize);

function collectInput(edits) {
  const aircraft = { 1: structuredClone(lead) };
  followerNumbers().forEach((number) => { aircraft[number] = structuredClone(followerRecord(number)); });
  const input = { schemaVersion: BOX_FLIGHT_V0_1.schemaVersion, flightSize, aircraft };
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
  transport = createWorkerTransport({ workerUrl: WORKER_URL, hostFactory: "createBoxFlightHost" });
  scheduler = createCalculationScheduler({ collect: collectInput, apply: applyAnswer, transport });
  // Read-only diagnostics for browser checks (nothing here calculates).
  globalThis.boxCalculation = Object.freeze({
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
  const keys = tab === "bdp" ? BDP_TAB_KEYS : tab === "box" ? [...BOX_KEYS, ...BOX_TAB_COPY_KEYS] : [];
  if (!keys.length) return;
  keys.forEach((key) => { lead.values[key] = BOX_FLIGHT_DEFAULT_VALUES[key]; });
  lead.locks = {};
  Object.assign(lead.state, {
    solveMode: BOX_FLIGHT_DEFAULT_STATE.solveMode,
    rollInAltitudeLinked: BOX_FLIGHT_DEFAULT_STATE.rollInAltitudeLinked,
    enteredTrackingTimeSec: BOX_FLIGHT_DEFAULT_STATE.enteredTrackingTimeSec,
    ...(tab === "box" ? { crossLegSource: BOX_FLIGHT_DEFAULT_STATE.crossLegSource } : {}),
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

// MIL OUT rows (BOX v0.4): the climb to the OUT Turn Speed, the OUT Turn and the performance model in use.
function outRows(result, row) {
  const out = result.out;
  const climb = out.climb;
  const turn = out.turn;
  const perf = out.performance;
  const turnPhases = turn.reachedLevel
    ? `${formatDeg(out.inputs.turnBankDeg)}° ${formatSec(turn.bankTimeSec)} sec, level ${formatDeg(turn.levelTurnBankDeg)}° ${formatSec(turn.levelTurnTimeSec)} sec`
    : `${formatDeg(out.inputs.turnBankDeg)}° ${formatSec(turn.bankTimeSec)} sec`;
  return [
    row("OUT Turn Start", `${formatNm(result.outClosure.effectiveOutNm)} NM past Target${result.outClosure.outAutoExtensionNm > 1e-9 ? " (extended)" : ""} · ${formatFt(climb.endAltitudeMslFt)} ft / ${formatKt(climb.endCasKt)} kcas`, "out"),
    row("OUT Climb", `${formatDeg(out.inputs.climbPitchDeg)}° MIL · ${formatSec(climb.timeSec)} sec · ${formatNm(climb.horizontalNm)} NM from level-off ${formatFt(out.levelOffAltitudeMslFt)} ft`, "outClimb"),
    row("OUT Turn", `${formatG(out.inputs.turnG)} G · ${turnPhases} · end ${formatFt(turn.endAltitudeMslFt)} ft / ${formatKt(turn.endCasKt)} kcas${out.minimumSpeedHeldSec > 0 ? ` · held ${formatKt(out.inputs.minimumSpeedKcas)} kcas` : ""}`, "outTurn"),
    row("OUT Performance", `${perf.engineModel} ${perf.powerSetting} research model · unofficial${perf.outsideDomainStates ? ` · ${perf.outsideDomainStates}/${perf.states} states outside its data` : ""}`, "outPerformance"),
  ];
}

function boxResultRows(result) {
  const p = result.pattern;
  const v = result.geometry.values;
  const abeam = boxAbeamText(p.abeamExtensionTimeSec) ?? "-";
  const row = (label, text, key, summary = false) => resultRow(label, text, key, { summary });
  return [
    row("Abeam", `${abeam.replace("Abeam ", "")} · ${formatNm(p.abeamExtensionDistanceNm)} NM`, "abeam", true),
    row("Pattern Width", `${formatNm(p.patternWidthNm)} NM`, "patternWidthNm", true),
    row("Crosswind Leg", `${formatNm(p.crossLegExtensionNm)} NM · ${legTime(p.crossLegTimeSec)} · ${result.crossLeg.source === "DEFAULT" ? "auto" : "typed"}`, "crossLegExtensionNm", true),
    row("Crosswind Leg Auto / Minimum", `${formatNm(result.crossLeg.autoNm)} NM to ${formatFt(result.out.energyLeg.targetAltitudeMslFt)} ft / ${formatKt(result.out.energyLeg.targetCasKt)} kcas · min ${formatNm(result.crossLeg.minimumNm)} NM`, "crossLegMinimumNm"),
    row("Downwind", `${formatNm(v.downwindNm)} NM · ${legTime(v.downwindTimeSec)}`, "downwindNm"),
    row("Base Leg", `${formatNm(p.baseLegNm)} NM · ${legTime(v.baseLegTimeSec)}`, "baseLegNm", true),
    row("Base Distance", `${formatNm(p.baseDistanceNm)} NM`, "baseDistanceNm"),
    row("Roll-in Long. D", `${formatNm(p.rollInLongitudinalDistanceNm)} NM`, "rollInLongitudinalDistanceNm"),
    row("Pattern Speed", `${formatKt(p.patternSpeedKcas)} kcas · ${formatKt(p.patternTasKt)} kt TAS`, "patternSpeed", true),
    row("Crosswind Turn", turnText(result.turns.cross), "crossTurn"),
    row("Base Turn", turnText(result.turns.base), "baseTurn"),
    ...outRows(result, row),
    row("Attack Heading", headingText(result.attackHeadingDeg), "attackHeadingDeg"),
  ];
}

function renderResults(entry) {
  const result = entry?.result;
  $("#box-result-body").innerHTML = result ? boxResultRows(result).join("") : "";
  $("#profile-result-body").innerHTML = result ? bdpResultRows(result.bombDelivery).join("") : "";
  resultPanel.refresh();
}

function renderPlaceholders(result) {
  // OUT options left blank show the value the BE used (Rev1.5 defaults).
  for (const [key, inputKey] of Object.entries(OUT_DEFAULT_OF)) {
    const value = result?.out?.inputs?.[inputKey];
    fields(key).forEach((field) => { field.placeholder = isNumber(value) ? String(Math.round(value * 10) / 10) : ""; });
  }
  const note = app.querySelector("[data-cross-leg-note]");
  if (note) {
    const auto = result?.crossLeg?.autoNm;
    const minimum = result?.crossLeg?.minimumNm;
    const source = lead.state.crossLegSource === "USER" ? "Typed · clear for auto" : "Auto: to the Roll-in Altitude and speed";
    note.textContent = isNumber(auto) ? `${source} · auto ${formatNm(auto)} NM · min ${formatNm(minimum)} NM` : source;
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
// it keeps a pan from selecting the view's text (the BOX view marks no label movable yet, so no label moves).
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
  topViewViewport = installSvgViewport($("#box-top-view"), {
    baseViewBox: { x: 0, y: 0, w: BOX_TOP_VIEW_V0_5.canvas.width, h: BOX_TOP_VIEW_V0_5.canvas.maxHeight },
    panOnlyWhenZoomed: true,
    buttonOnlyZoom: true,
    allowPageScrollWhenPanDisabled: true,
    maxZoom: 2,
    maxZoomOut: 2,
    onViewBoxChange: (box) => {
      const percent = Math.round((topViewViewport?.getBaseViewBox().w ?? BOX_TOP_VIEW_V0_5.canvas.width) / box.w * 100);
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
  topViewLabelDrag = installSmartLabelDrag($("#box-top-view"));
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
  const svg = $("#box-top-view");
  const result = lastEntry?.result;
  if (!result) {
    const width = BOX_TOP_VIEW_V0_5.canvas.width;
    showCalculationFailed(svg, boxTopViewTitle({ aircraftNumber: 1 }), lastEntry?.error ?? "no result", width);
    syncTopViewSize({ width, height: 220 }, null);
    $("#capture-top-view").disabled = true;
    return;
  }
  // Formation (Flight of 2–4): each shown aircraft at the place the BE gave it.
  const formation = flightSize > 1
    ? shownAircraft.visible().filter((number) => lastPositions[number]).map((number) => ({ number, ...lastPositions[number], color: AIRCRAFT_COLORS[number] }))
    : [];
  const rendered = renderBoxTopView(svg, result, { aircraftNumber: 1, textScale: topViewTextScale, formation, advanced: topViewAdvanced });
  syncTopViewSize(rendered.canvas, `${resultSerial(result)}|${formation.map((item) => item.number).join(",")}`);
  $("#capture-top-view").disabled = false;
  legend?.render?.();
}

function renderZ() {
  const svg = $("#box-z-svg");
  const result = lastEntry?.result;
  if (!result) {
    showCalculationFailed(svg, boxZDiagramTitle({ aircraftNumber: 1 }), lastEntry?.error ?? "no result", 650);
    $("#capture-z").disabled = true;
    return;
  }
  $("#capture-z").disabled = !renderBoxZDiagramV0_3(svg, result, { aircraftNumber: 1 }).rendered;
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
// Dive Profile, 3D Profile, Top View and HUD of the BDP result BOX used, on their own clock: seconds from the Roll-in
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
      scope: "box-aircraft-1",
      aircraftNumber: 1,
      layout: "OFFSET",
      viewportWidth: globalThis.innerWidth,
      // BOX (BE): the Base Leg into OA1 is the Initial heading; the Roll-in turns right onto the attack run.
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
    lead = boxFlightDefaultLead();
    [2, 3, 4].forEach((number) => { followers[number] = boxFlightDefaultFollower(number); });
    writeAllFields();
    writeFormationFields();
    scheduler.reset();
    setSaveStatus("Default loaded · not saved until Save", "warning");
  });
}

// ---- Top View / Z controls --------------------------------------------------------------------------------------------

function installViewControls() {
  legend = installSvgLegend($("#box-legend"), BOX_TOP_VIEW_V0_5.legend);
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
    renderTopView();
  });
  const png = (svg, title) => saveSvgAsPng(svg, `${title.replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" });
  $("#capture-top-view").addEventListener("click", () => png($("#box-top-view"), boxTopViewTitle({ aircraftNumber: 1 })));
  $("#capture-z").addEventListener("click", () => png($("#box-z-svg"), boxZDiagramTitle({ aircraftNumber: 1 })));
  installDedPngClicks({
    visibleAircraft: shownDedAircraft,
    exportPng: (numbers) => {
      const cards = numbers.map((number) => readDedCard(app.querySelector(`[data-output-aircraft="${number}"][data-aircraft-output="ded"]`), number)).filter(Boolean);
      if (cards.length) saveDedPng(cards, { filename: `BOX_DED_${numbers.map((number) => `#${number}`).join("_")}.png`, colorOf: (number) => AIRCRAFT_COLORS[number] });
    },
  });
}

// ---- Flight (#2–#4) ---------------------------------------------------------------------------------------------------
// Owner 2026-10-25: the Formation tab (Offset's structure, #2–#4) holds each follower's position; the BDP / BOX / Spacer
// Turn tabs of a follower say that it flies #1's data.

const followerNote = (number, text) => `<p class="flight-draft-note">${text}</p>`;
function followerSlotMarkup(number) {
  const reference = BOX_FLIGHT_FORMATION_REFERENCE[number];
  const section = (tab, title, body, head = "") => `<section class="section" data-tab="${tab}" data-aircraft-tab="${number}"><div class="section-head"><h2>${title} #${number}</h2>${head}</div>${body}</section>`;
  const sameData = followerNote(number, `#${number} flies #1's BDP and BOX data: the Flight has one data set. Edit it on #1.`);
  return section("formation", "Formation",
    followerNote(number, `Position from #${reference}'s tail, laid off at #1's Abeam on the Downwind heading. The BOX Top View shows each aircraft there. The Spacer Turn will set the spacing from this Formation (later step).`)
      + formationPositionMarkup({ attribute: "data-formation-field", keys: { side: "side", bearing: "bearingDeg", range: "distanceNm" }, referenceLabel: `#${reference}` })
      + `<div id="flight-status-${number}" class="status-message valid">-</div>`,
    `<div class="box-head-status"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div>`)
    + section("bdp", "BDP", sameData)
    + section("box", "BOX", sameData)
    + section("spacer", "Spacer Turn", followerNote(number, "Spacer Turn is the BOX slot of S&amp;R. Its content comes in a later step."));
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
  installSectionDisclosureOn(host.querySelectorAll(".section[data-tab]"), { idPrefix: "box-follower-body" });
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
  const turnNote = "Crosswind / Base Turns";
  const bdpSection = app.querySelector('[data-bdp-tab="1"]');
  bdpSection.innerHTML = bdpTabMarkup({ number: 1, weapons: WEAPON_DATABASE_V0_1.map((weapon) => ({ id: weapon.id, label: weapon.name })), angleOff: { value: "90", note: "BOX fixed" }, turnNote, targetNote: "Target MSL" });
  app.querySelector("[data-bdp-profile-copy]").innerHTML = bdpProfileFieldsMarkup();
  app.querySelector("[data-roll-in-copy]").innerHTML = rollInTurnFieldsMarkup();
  app.querySelector("[data-turn-onset-copy]").innerHTML = turnOnsetFieldsMarkup({ turnNote });
  app.querySelector('[data-ded-pages="1"]').innerHTML = dedPagesMarkup(["OA1", "OA2"]);
}

function installTabs(root = app) {
  // BDP: Full BDP immediately before Tab Default (owner 2026-10-25); BOX: Advanced (Turn Onset, OUT) and Tab Default;
  // a follower's Formation: Tab Default. A follower's BDP / BOX note has no tools.
  installSectionTools(root.querySelectorAll(".section[data-tab]"), {
    toolsOf: (section) => (section.dataset.aircraftTab
      ? (section.dataset.tab === "formation" ? ["default"] : [])
      : ({ bdp: ["fullBdp", "default"], box: ["advanced", "default"] })[section.dataset.tab] ?? []),
    defaultLabel: "Tab Default",
    onDefault: (section) => (section.dataset.aircraftTab ? resetFormation(Number(section.dataset.aircraftTab)) : resetTab(section.dataset.tab)),
  });
}

function resetFormation(number) {
  followers[number] = boxFlightDefaultFollower(number);
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
  setSaveStatus(`Loaded · saved ${savedTimeText(new Date(loadedSave.savedAt))}`);
} else {
  setSaveStatus("Default conditions · not saved yet", "warning");
}
$("#flight-size").addEventListener("change", (event) => setFlightSize(event.target.value));
writeAllFields();
scheduler.reset();

// PC Wide workspace hooks (wide-layout.mjs).
export const boxIndexUi = Object.freeze({
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
    installSectionDisclosureOn(app.querySelectorAll(".section[data-tab]"), { idPrefix: "box-section-body" });
  },
  // Centre BDP tab: the BDP views are drawn only while it shows #1.
  showBdpViews(numbers) {
    bdpViewsShown = numbers.includes(1);
    refreshBdpViews();
  },
});
