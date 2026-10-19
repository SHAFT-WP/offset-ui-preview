import { readOffsetWorkSave, writeOffsetWorkSave } from "./work-save-v0.1.mjs?v=0.1.0";
import { formatDeg, formatFt, formatG, formatKt, formatNm, formatSec, formatSecTenths, formatSignedSec, truncateBeOutput } from "./common/ui/display-precision-v0.1.mjs?v=0.1.1";
import { installResultPanel } from "./common/ui/result-panel-v0.1.mjs";
import { formationPositionMarkup, installFormationSideSelects } from "./common/ui/formation-position-v0.1.mjs";
import { installSvgLegend } from "./common/diagram/svg-legend-v0.1.mjs";
// One BE call per request (AG SPEC "Flight entrypoint", 2026-10-12): the Flight entrypoint owns every
// solve, inheritance, position, drop-order timing and the next input state. This controller collects
// the inputs and the edit events, stores the returned state and displays the results; Full results
// feed the views and the next call, displays use the 5-decimal truncation (docs/FE-BE-RULES.md).
// The BE runs in a Worker (offset-flight-worker-v0.1.mjs); calculation-client-v0.1.mjs decides when a
// request goes (200 ms after typing stops; Enter / LOCK / buttons at once) and which answer is
// current (performance addendum 2026-10-12, P4).
import { OFFSET_FLIGHT_V0_1 } from "./AG/bombing/offset-bombing/offset-flight-v0.1.mjs?v=2026-10-14a";
import { createCalculationScheduler, createWorkerTransport } from "./calculation-client-v0.1.mjs?v=0.1.0";
const OFFSET_FLIGHT_WORKER_URL = new URL("./AG/bombing/offset-bombing/offset-flight-worker-v0.1.mjs?v=0.1.2", import.meta.url);
// Cache tokens: these Common modules gained what the Offset views and toolbar need (primitives
// 0.1.6 canvas-aware text scale, smart-label 0.1.5, viewport 0.1.5 refresh); stale copies would fail.
import { SVG_DIAGRAM_TEXT_SCALE_V0_1, svgNode } from "./common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { installSmartLabelDrag } from "./common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { installSvgViewport } from "./common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { createValueStateController } from "./common/ui/value-state-controller-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";
// Offset graphs are BE-owned views (AG/bombing/offset-bombing/view/, common/diagram/SPEC.md); this
// controller only wires their toolbars, legend and titles.
import { OFFSET_TOP_VIEW_V0_1, offsetTopViewLegend, offsetTopViewTitle } from "./AG/bombing/offset-bombing/view/offset-top-view-v0.1.mjs?v=0.1.10";
import { offsetAircraftColors, offsetCombinedTopViewTitle, offsetFlightTopViewLegend, renderOffsetCombinedTopView } from "./AG/bombing/offset-bombing/view/offset-flight-top-view-v0.1.mjs?v=0.1.9";
import { offsetApproachInBdpFrame, offsetTimeline } from "./AG/bombing/offset-bombing/view/offset-time-path-v0.1.mjs?v=0.1.2";
import { offsetZDiagramTitle, renderOffsetZDiagram } from "./AG/bombing/offset-bombing/view/offset-z-diagram-v0.1.mjs?v=0.1.9";
// Cache token: panel 0.4.0 adds the Common Text / Size / Reset toolbar to each Full BDP panel.
import { bdpDiagramsMarkup, bdpFlightViewWindow, clearBdpDiagrams, renderBdpDiagrams } from "./AG/bombing/bomb-delivery-planner/view/bdp-diagrams-panel-v0.1.mjs?v=0.10.3";

const resultPanel = installResultPanel(document.querySelector('[data-result-panel]'));
// Legend items and colours come from the Offset Top View (values follow each result).
const legendItems = offsetTopViewLegend();
const legend = installSvgLegend(document.getElementById('offset-legend'), legendItems);
const TOP_VIEW_TEXT_SCALE_DEFAULT = SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale;
const TOP_VIEW_MOBILE_MAX_WIDTH_PX = SVG_DIAGRAM_TEXT_SCALE_V0_1.mobileMaxWidthPx;
const flightLayout = { size: 1, aircraft: {} };
const flightResults = new Map();
// Flight of 4 (2026-09-27): #2 and #3 fly off #1, #4 flies off its element lead #3.
const FLIGHT_CALCULATING_AIRCRAFT = new Set([2, 3, 4]);
// Wingmen carry the Angle #n / Time #n element-lead options; #3 is element lead B and has none.
const FLIGHT_WINGMEN = new Set([2, 4]);
// Follower DED panels (2026-09-28: #2 only; #3 / #4 from 2026-10-06, index UI handoff §8.2: the
// same per-aircraft rule on each aircraft's own result).
const FLIGHT_DED_AIRCRAFT = new Set([2, 3, 4]);
// Developer default preset (index UI handoff 2026-10-06 §3): replaces the built-in defaults in this
// browser only. The work save is one complete Flight snapshot (work-save-v0.1.mjs).
const PRESET_KEY = "flight-sim-tools.offset.v2.default-preset.v1";
const PRESET_SCHEMA_VERSION = 1;
// index.html (body.offset-wide) groups the inputs as Offset (profile + geometry) / BDP (settings);
// index-standard.html keeps the earlier BDP / Offset grouping. Same keys and state either way.
const INDEX_LAYOUT = document.body.classList.contains("offset-wide");
const LEAD_DRIVERS = new Set(["vrpRangeNm", "actionRangeNm", "runInHeadingDeg", "approachRangeNm", "attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "ipRangeNm", "vrpBearingDeg", "referenceLock"]);
const LEAD_TURN_DRIVERS = new Set(["offsetG", "offsetBankDeg", "offsetRadiusNm"]);
// Follower driver keys a stored draft may carry ("Angle #n" / "Time #n" toggles, their exclusivity
// with the LOCKs and the both-fixed Roll-in Altitude / Tracking Time solve are the BE's).
const FLIGHT_TACTICAL_DRIVERS = ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm"];
const DEFAULT_INPUT_VALUES = Object.freeze({
  weaponId: "M82",
  targetElevationMslFt: "31",
  initialSpeedValue: "350",
  initialSpeedMode: "CAS",
  initialAltitudeMslFt: "16000",
  rollInAltitudeMslFt: "16000",
  diveAngleDeg: "45",
  angleOffDeg: "70",
  trackingTimeSec: "18",
  releaseAltitudeMslFt: "6800",
  releaseSpeedKcas: "450",
  recoveryG: "5",
  speedOvershootKcas: "50",
  fragmentHeightMarginPercent: "20",
  gOnsetTimeSec: "2",
  // BDP v0.4 Roll-in / Offset Turn onset rates (owner 2026-10-15; Full BDP).
  rollInRollRateDegSec: "60",
  rollOutRollRateDegSec: "55",
  gOnsetRateGSec: "2",
  // The selected SEM (owner handoff 2026-10-18 §6; BDP v0.4.2): every BDP view and S&R fly it.
  semEnd: "LEVEL",
  csemTargetFpaDeg: "30",
  // The Level SEM turn from the level-off (owner 2026-10-19; BDP v0.4.3): Level (bank AUTO) / Slice, 90° default;
  // blank direction = the Roll-in side, blank G = Recovery G, blank speed = the level-off speed.
  semTurnType: "LEVEL",
  semTurnDirection: "",
  semTurnDeg: "90",
  semTurnG: "",
  semTurnSpeedKcas: "",
  semTurnBankDeg: "85",
  windDirectionDeg: "0",
  windSpeedKt: "0",
  rollInBankAngleDeg: "",
  rollInG: "4",
  vrpRangeNm: "7.0",
  runInHeadingDeg: "000",
  ipRangeNm: "10.0",
  attackHeadingDeg: "030",
  offsetAngleDeg: "40",
  actionRangeNm: "7.0",
  approachRangeNm: "1.0",
  offsetAltitudeMslFt: "16000",
  offsetSpeedValue: "350",
  offsetSpeedMode: "CAS",
  offsetG: "2.0",
  offsetBankDeg: "60",
  offsetRadiusNm: "1.6",
});

const locks = {};
let driver = "vrpRangeNm";
let turnDriver = "offsetG";
let referenceMode = "VRP";
let vipBearingDirection = "TO_TARGET";
let ipBearingDirection = "TO_TARGET";
// Stored input state (written from the BE's nextInput, restored from a save; never derived here).
let ipLinked = true;
let ipLockHeadingDeg = null;
let vipBearingExplicit = false;
let vipRangeExplicit = false;
let vrpBearingExplicit = false;
let vrpRangeExplicit = false;
// LINK (2026-10-01): Initial Altitude and Roll-in Altitude hold the same value while on.
let rollInAltitudeLinked = true;
// Developer option (owner Q8, 2026-10-15): Fragment Height Margin on the radius too, or on the height only.
let fragmentMarginAppliesTo = "HEIGHT_AND_RADIUS";
// BDP solve mode (last edited Roll-in / Initial or Tracking Time) and the last entered Tracking Time.
let bdpSolveMode = "height";
const DEFAULT_TRACKING_TIME_SEC = 18;
let enteredTrackingTimeSec = DEFAULT_TRACKING_TIME_SEC;
let topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
let topViewAdvanced = false;
// IP Bottom (default on): Top View drawn with the Run-In (IP -> Target) pointing up; off = north up
// with a north arrow.
let topViewIpBottom = true;
// Time dial (2026-10-02): seconds after IP drawn on the Top View; null = off (the plain view).
let topViewTimeSec = null;
// One Offset Top View for the Flight (user 2026-10-05): the #1–#4 buttons choose the aircraft drawn;
// several can be on together. Default: #1 only.
const topViewAircraft = new Set([1]);
let lastResult = null;
// Full-precision twin of lastResult (and of each follower result) for the views.
let lastResultFull = null;
const flightResultsFull = new Map();
// Last BE output pieces the views read: drop-order timing and #1's next state.
let lastFlightTiming = {};
let lastLeadState = null;
let initialRender = true;
let lastResultSnapshot = null;
let defaultPersistedState = null;
let persistenceReady = false;
let topViewViewportObserver = null;
let topViewCompactQuery = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const allFields = (key) => $$(`[data-key="${key}"]`);
const fields = (key) => key === "runInHeadingDeg"
  ? allFields(key).filter((field) => field.id !== "ip-bearing-input")
  : allFields(key);
const firstField = (key) => fields(key)[0];
const valueStates = createValueStateController({ root: document, transientMs: 1200 });
const solvedInputValues = new Map();

const value = (key) => firstField(key)?.value;
const valuesEquivalent = (current, next) => {
  const a = Number.parseFloat(current);
  const b = Number.parseFloat(next);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= 1e-9;
  return String(current) === String(next);
};
const setValue = (key, next, { includeActive = false } = {}) => {
  const nextText = String(next);
  const active = document.activeElement;
  const targets = fields(key);
  // Tracking Time compares as text, so a committed "12" is rewritten as "12.0" (0.1 s display).
  const same = key === "trackingTimeSec" ? (a, b) => String(a) === String(b) : valuesEquivalent;
  const changed = targets.some((field) => (includeActive || field !== active) && !same(field.value, nextText));
  if (!changed) return false;

  if (key === "runInHeadingDeg") {
    targets.forEach((field) => {
      if (includeActive || field !== active) field.value = nextText;
    });
  } else {
    valueStates.setInputValue(key, nextText, { includeActive });
  }
  return true;
};
const setAutoValue = (key, next, sourceKey = null, { includeActive = false } = {}) => {
  const changed = setValue(key, next, { includeActive });
  if (changed && !initialRender && sourceKey !== key && key !== "runInHeadingDeg") valueStates.markDependentInput(key);
  return changed;
};
const fmt = (number, digits = 2) => Number.isFinite(number) ? Number(number).toFixed(digits) : "-";
const normHeading = (number) => ((number % 360) + 360) % 360;
const reciprocalHeading = (number) => normHeading(number + 180);
const fmtHeading = (number) => {
  if (!Number.isFinite(number)) return "-";
  const heading = ((Math.round(number) % 360) + 360) % 360;
  return String(heading).padStart(3, "0") + "°";
};
const formatBearingInput = (number) => {
  const rounded = Math.round(normHeading(number) * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return text.padStart(3, "0");
};
const displayedBearing = (canonicalToTargetDeg, direction) => direction === "FROM_TARGET"
  ? reciprocalHeading(canonicalToTargetDeg)
  : normHeading(canonicalToTargetDeg);
const canonicalToTargetBearing = (displayedDeg, direction) => direction === "FROM_TARGET"
  ? reciprocalHeading(displayedDeg)
  : normHeading(displayedDeg);

// Inputs for the BE (input collection only): a field's Full value when its text still shows the
// rounded solved value, else the parsed text; blank = null; an unparsable entry goes as its text and
// the BE reports it (never replaced here).
const NON_NUMERIC_FIELDS = new Set(["weaponId", "initialSpeedMode", "offsetSpeedMode", "side", "semEnd", "semTurnType", "semTurnDirection"]);
function parsedFieldValue(text, solved) {
  const raw = String(text ?? "");
  if (raw.trim() === "") return null;
  if (solved && valuesEquivalent(raw, solved.text)) return solved.value;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : raw;
}
// A genuine edit (text no longer showing the solved value) drops the Full value behind the field;
// an event that leaves the shown value (e.g. a commit of a re-linked IP) keeps it.
function dropSolvedIfEdited(store, key, text) {
  const solved = store instanceof Map ? store.get(key) : store?.[key];
  if (!solved || valuesEquivalent(text, solved.text)) return;
  if (store instanceof Map) store.delete(key);
  else delete store[key];
}
function readFieldValue(key) {
  const field = firstField(key);
  if (!field) return null;
  if (NON_NUMERIC_FIELDS.has(key)) return field.value;
  return parsedFieldValue(field.value, solvedInputValues.get(key));
}
// Reference inputs without a data-key: VRP bearing, VIP bearing (TO/FROM notation, canonical TO
// value passed) and VIP range. Their Full value is kept in solvedInputValues under these keys.
const REFERENCE_INPUTS = Object.freeze({ vrpBearingDeg: "#vrp-bearing-input", vipToTargetBearingDeg: "#vip-bearing-input", vipRangeNm: "#vip-range-input" });
function readReferenceValue(key) {
  const field = $(REFERENCE_INPUTS[key]);
  if (!field) return null;
  const value = parsedFieldValue(field.value, solvedInputValues.get(key));
  if (key === "vipToTargetBearingDeg" && typeof value === "number" && !valuesEquivalent(field.value, solvedInputValues.get(key)?.text)) {
    return canonicalToTargetBearing(value, vipBearingDirection);
  }
  return value;
}
function writeReferenceField(key, value, { includeActive = false } = {}) {
  const field = $(REFERENCE_INPUTS[key]);
  if (!field || !Number.isFinite(value) || (!includeActive && document.activeElement === field)) return;
  const text = key === "vipRangeNm" ? Number(value).toFixed(1)
    : formatBearingInput(key === "vipToTargetBearingDeg" ? displayedBearing(value, vipBearingDirection) : value);
  field.value = text;
  solvedInputValues.set(key, { text, value });
}

// Run-In heading of the current state, for the TO/FROM display of the IP bearing.
function readRunInHeading() {
  const value = lastLeadState?.values?.runInHeadingDeg ?? readFieldValue("runInHeadingDeg");
  return Number.isFinite(value) ? normHeading(value) : 0;
}

function syncBearingInput(selector, canonicalToTargetDeg, direction, { includeActive = false } = {}) {
  const field = $(selector);
  if (!field) return;
  if (!includeActive && document.activeElement === field) return;
  field.value = formatBearingInput(displayedBearing(canonicalToTargetDeg, direction));
}

function syncIpBearingInput(runInHeadingDeg, options) {
  syncBearingInput("#ip-bearing-input", runInHeadingDeg, ipBearingDirection, options);
}

function setDirectionButtons(prefix, direction) {
  const toTarget = $(`#${prefix}-to-target-btn`);
  const fromTarget = $(`#${prefix}-from-target-btn`);
  if (!toTarget || !fromTarget) return;
  const toActive = direction === "TO_TARGET";
  toTarget.classList.toggle("active", toActive);
  fromTarget.classList.toggle("active", !toActive);
  toTarget.setAttribute("aria-pressed", String(toActive));
  fromTarget.setAttribute("aria-pressed", String(!toActive));
}

// ---- BE input and returned state (2026-10-12) ------------------------------------------------------
// The FE passes the field values, LOCKs, options, formation positions and stored state as they are,
// plus the raw edit event; the BE decides every consequence and returns the next state, which is
// written back here (display text with the Full value behind it) without any further rule.
const LEAD_VALUE_KEYS = Object.keys(DEFAULT_INPUT_VALUES);
// Display digits of fields a solve writes back (docs/TERMINOLOGY.md): angles and ft integer, NM and G
// one decimal, Tracking Time one decimal (user 2026-10-12; entered in 0.1 s); the Full value stays
// behind the text (solvedInputValues / draft.solved).
const FIELD_DISPLAY_DIGITS = Object.freeze({ attackHeadingDeg: 0, angleOffDeg: 0, offsetAngleDeg: 0, actionRangeNm: 1, approachRangeNm: 1, ipRangeNm: 1, vrpRangeNm: 1, offsetG: 1, offsetBankDeg: 0, offsetRadiusNm: 1, trackingTimeSec: 1, rollInAltitudeMslFt: 0, initialAltitudeMslFt: 0, releaseAltitudeMslFt: 0, rollInBankAngleDeg: 0, rollInG: 1 });
function fieldDisplayText(key, value) {
  if (key === "runInHeadingDeg") return formatBearingInput(value);
  return Object.hasOwn(FIELD_DISPLAY_DIGITS, key) ? value.toFixed(FIELD_DISPLAY_DIGITS[key]) : String(value);
}
const sameStateValue = (a, b) => Object.is(a, b);
const REFORMAT_ON_COMMIT = new Set(["runInHeadingDeg", "trackingTimeSec"]);

function collectLeadRecord() {
  const values = Object.fromEntries(LEAD_VALUE_KEYS.map((key) => [key, readFieldValue(key)]));
  Object.keys(REFERENCE_INPUTS).forEach((key) => { values[key] = readReferenceValue(key); });
  return {
    values,
    locks: { ...locks },
    state: {
      driver, turnDriver, referenceMode, ipLinkedToVrp: ipLinked, ipLockHeadingDeg, rollInAltitudeLinked,
      solveMode: bdpSolveMode, enteredTrackingTimeSec, vipBearingExplicit, vipRangeExplicit, vrpBearingExplicit, vrpRangeExplicit,
      fragmentMarginAppliesTo,
    },
  };
}

function collectFlightInput(edit = null) {
  const aircraft = { 1: collectLeadRecord() };
  for (const number of [2, 3, 4]) {
    if (number <= flightLayout.size || flightLayout.aircraft[number]) aircraft[number] = collectFollowerRecord(number);
  }
  return { schemaVersion: OFFSET_FLIGHT_V0_1.schemaVersion, flightSize: flightLayout.size, aircraft, ...(edit ? { edit } : {}) };
}

function syncLockButtons() {
  $$("[data-lock-key]").forEach((button) => {
    const locked = locks[button.dataset.lockKey] === true;
    button.setAttribute("aria-pressed", String(locked));
    button.textContent = locked ? "LOCKED" : "LOCK";
  });
}

// #1 values the LOCKs settle (the BE's lockSolvedKeys) show the solved value and cannot be typed.
const LOCK_SOLVED_CANDIDATES = ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm"];
const LOCK_SOLVED_TITLE = "Solved from the LOCKed values (unlock one to enter it)";
function syncLockSolvedFields(keys = []) {
  for (const key of LOCK_SOLVED_CANDIDATES) {
    const solved = keys.includes(key);
    fields(key).forEach((field) => {
      field.readOnly = solved;
      field.toggleAttribute("data-lock-solved", solved);
      if (solved) field.title = LOCK_SOLVED_TITLE;
      else if (field.title === LOCK_SOLVED_TITLE) field.removeAttribute("title");
    });
  }
}

// Writes the BE's next state. A field is rewritten only when its returned value differs from the
// value sent (a field being typed in keeps its text until the edit is committed); a committed Run-In
// heading shows its formatted value.
function applyFlightState(next, sent, edits) {
  // Per aircraft, its latest edit event decides the active field and whether it was committed.
  const lastEdit = (number) => edits.findLast((edit) => (edit.aircraft ?? 1) === number) ?? null;
  const committed = (edit) => !!edit && (edit.commit === true || edit.kind === "clear");
  const lead = lastEdit(1);
  applyLeadState(next.aircraft[1], sent.aircraft[1], lead?.key ?? null, committed(lead));
  for (const number of [2, 3, 4]) {
    const edit = lastEdit(number);
    if (next.aircraft[number] && sent.aircraft[number]) applyFollowerState(number, next.aircraft[number], sent.aircraft[number], edit?.key ?? null, committed(edit));
  }
}

function applyLeadState(lead, sentLead, activeKey, commit) {
  lastLeadState = lead;
  const s = lead.state;
  driver = s.driver;
  turnDriver = s.turnDriver;
  referenceMode = s.referenceMode;
  ipLinked = s.ipLinkedToVrp;
  ipLockHeadingDeg = s.ipLockHeadingDeg;
  rollInAltitudeLinked = s.rollInAltitudeLinked;
  bdpSolveMode = s.solveMode;
  enteredTrackingTimeSec = s.enteredTrackingTimeSec;
  vipBearingExplicit = s.vipBearingExplicit;
  vipRangeExplicit = s.vipRangeExplicit;
  vrpBearingExplicit = s.vrpBearingExplicit;
  vrpRangeExplicit = s.vrpRangeExplicit;
  if (s.fragmentMarginAppliesTo) fragmentMarginAppliesTo = s.fragmentMarginAppliesTo;
  syncFragmentMarginButton();
  Object.keys(locks).forEach((key) => { locks[key] = lead.locks?.[key] === true; });
  syncLockButtons();
  syncLockSolvedFields(lead.lockSolvedKeys);
  for (const key of LEAD_VALUE_KEYS) {
    const value = lead.values[key];
    const own = key === activeKey;
    if (typeof value !== "number") continue;
    // A committed Run-In Heading / Tracking Time is rewritten in its display format ("030", "18.0").
    if (sameStateValue(value, sentLead.values[key]) && !(commit && own && REFORMAT_ON_COMMIT.has(key))) continue;
    const text = fieldDisplayText(key, value);
    setAutoValue(key, text, activeKey, { includeActive: commit && own });
    if (valuesEquivalent(firstField(key)?.value, text)) solvedInputValues.set(key, { text, value });
  }
  for (const key of Object.keys(REFERENCE_INPUTS)) {
    if (!sameStateValue(lead.values[key], sentLead.values[key])) writeReferenceField(key, lead.values[key]);
  }
  if (Number.isFinite(lead.values.runInHeadingDeg)) syncIpBearingInput(lead.values.runInHeadingDeg);
  syncInitialLinkUi();
}

function syncInitialLinkUi() {
  const button = $("#initial-link-btn");
  if (button) {
    button.setAttribute("aria-pressed", String(rollInAltitudeLinked));
    button.textContent = rollInAltitudeLinked ? "LINKED" : "LINK";
  }
  const note = $("[data-initial-link-note]");
  if (note) note.textContent = rollInAltitudeLinked ? "Linked to Roll-in Altitude" : "Reference only (not linked)";
  // #1's BDP section: a direct child of the calculator in Standard, inside the #1 workspace in PC Wide.
  const section = button?.closest(".section[data-tab]");
  if (section) section.dataset.solveMode = bdpSolveMode;
}

const SUMMARY_RESULTS = new Set(['runAttackSummary', 'offsetHeadingDeg', 'actionRangeNm', 'approachRangeNm', 'offsetTurnSec', 'approachSec', 'effectiveReleaseAltitudeMslFt', 'trackingTimeSecResult', 'leadAngleDeg', 'nltReleaseMslFt']);
function row(label, renderedValue, resultKey = null, { summaryKey = resultKey, summary = SUMMARY_RESULTS.has(summaryKey) } = {}) {
  const rendered = resultKey ? `<span class="value-result" data-result-key="${resultKey}">${renderedValue}</span>` : renderedValue;
  return `<tr class="result-row" data-result-row data-summary="${summary}"><td>${label}</td><td data-result-value>${rendered}</td></tr>`;
}

// Signed IP -> Action leg; negative means the Action Point lies beyond IP (turn before IP).
function ingressText(t) {
  const beforeIp = t.ingressDistanceNm < -0.0005 ? " · BEFORE IP" : "";
  return `${formatNm(t.ingressDistanceNm)} NM / ${formatSec(t.ingressSec)} sec${beforeIp}`;
}

// Offset / Bomb Profile result rows shared by Result #1 and each follower's Result #n, so a
// follower lists the same variables in the same order first. `keyed` false drops the
// data-result-key hooks (#1's change highlighting / Top View links must not match follower rows);
// rows a follower does not have (Reference point, Legacy ΔTOS) are passed as null and skipped.
function offsetResultRows(result, { ipRangeText, reference = null, legacyDeltaTosSec = null, keyed = true }) {
  const g = result.geometry;
  const t = result.timing;
  // Unkeyed follower rows keep #1's summary/Advanced split through summaryKey.
  const r = (label, text, key) => row(label, text, keyed ? key : null, { summaryKey: key });
  return [
    r("State", result.state),
    r("Run-In / Attack", `${fmtHeading(g.runInHeadingDeg)} → ${fmtHeading(g.attackHeadingDeg)}`, "runAttackSummary"),
    r("Approaching Heading", fmtHeading(g.offsetHeadingDeg), "offsetHeadingDeg"),
    r("Offset Angle", `${formatDeg(g.offsetAngleDeg)}°`, "offsetAngleDeg"),
    r("Angle-Off (Heading)", `${formatDeg(g.angleOffDeg)}°`, "angleOffDeg"),
    r("Action Range", `${formatNm(g.actionRangeNm)} NM`, "actionRangeNm"),
    r("Approach Range", `${formatNm(result.resolved.approachRangeNm)} NM`, "approachRangeNm"),
    r("IP Range", ipRangeText, "ipRangeNm"),
    r("Offset Radius", `${formatNm(result.resolved.offsetRadiusNm)} NM`, "offsetRadiusNm"),
    r("Offset TAS", `${formatKt(result.resolved.offsetTasKt)} kt`, "offsetTasKt"),
    reference === null ? null : r("Reference", reference, "referenceSummary"),
    r("IP → Action Point", ingressText(t), "ingressSummary"),
    r("Offset Turn", `${formatSec(t.offsetTurnSec)} sec`, "offsetTurnSec"),
    r("Approach Time", `${formatSec(t.approachSec)} sec`, "approachSec"),
    r("Roll-in → Release", `${formatSec(t.rollToReleaseSec)} sec`, "rollToReleaseSec"),
    legacyDeltaTosSec === null ? null : r("Legacy ΔTOS", `${formatSignedSec(legacyDeltaTosSec)} sec`, "legacyDeltaTosSec"),
  ].filter(Boolean);
}

function profileResultRows(result, { keyed = true } = {}) {
  const p = result.profile.public;
  const r = (label, text, key) => row(label, text, keyed ? key : null, { summaryKey: key });
  return [
    r("Effective Release Altitude", `${formatFt(p.effectiveReleaseAltitudeMslFt)} ft MSL`, "effectiveReleaseAltitudeMslFt"),
    r("Roll-In Altitude", `${formatFt(p.resolvedInitialAltitudeMslFt)} ft MSL`, "resolvedInitialAltitudeMslFt"),
    r("Track Point Altitude", `${formatFt(p.trackPointAltitudeMslFt)} ft MSL`, "trackPointAltitudeMslFt"),
    r("Tracking Time", `${formatSecTenths(p.trackingTimeSec)} sec`, "trackingTimeSecResult"),
    r("Roll-in Range", `${formatNm(p.rollInRangeNm)} NM`, "rollInRangeNm"),
    r("Ground Range", `${formatNm(p.groundRangeNm)} NM`, "groundRangeNm"),
    r("Roll-in Radius", `${formatNm(p.rollInRadiusNm)} NM`, "rollInRadiusNm"),
    r("Roll-in Time", `${formatSec(p.rollInTimeSec)} sec`, "rollInTimeSec"),
    r("Roll-in Ground Arc", `${formatNm(p.rollInGroundArcNm)} NM`, "rollInGroundArcNm"),
    r("Roll-in Altitude Loss", `${formatFt(p.rollInAltitudeLossFt)} ft`, "rollInAltitudeLossFt"),
    r("Lead Angle", `${formatDeg(p.leadAngleDeg)}°`, "leadAngleDeg"),
    // SEM group (owner handoff 2026-10-18 §7.1): the selected SEM's lowest point, then MINALT (a separate floor).
    r("SEM Minimum Altitude", p.sem?.status === "INVALID" ? "INVALID" : Number.isFinite(p.semMinimumAltitudeMslFt) ? `${formatFt(p.semMinimumAltitudeMslFt)} ft MSL` : "N/A", "semMinimumAltitudeMslFt"),
    r("MINALT", `${formatFt(p.minAltMslFt)} ft MSL`, "minAltMslFt"),
    // NLT is not calculated below 10° (BDP SPEC §6.2): N/A, never 0.
    r("NLT Release", p.nltReleaseMslFt === null || p.nltReleaseMslFt === undefined ? "N/A" : `${formatFt(p.nltReleaseMslFt)} ft MSL`, "nltReleaseMslFt"),
    r("Bomb Range / TOF", `${formatNm(p.bombRangeNm)} NM / ${formatSec(p.bombTofSec)} sec`, "bombRangeTofSummary"),
  ];
}

function renderOffsetResult(result) {
  $("#offset-result-body").innerHTML = offsetResultRows(result, {
    ipRangeText: `${formatNm(result.resolved.ipRangeNm)} NM · ${result.ipLinkedToVrp ? `LINKED TO VRP + ${result.ipLinkLeadNm} NM` : "INDEPENDENT"}`,
    reference: `${result.referenceMode} · ${formatDeg(result.reference.bearingDeg)}° / ${formatNm(result.reference.displayRangeNm)} NM`,
    legacyDeltaTosSec: result.timing.legacyDeltaTosSec,
  }).join("");
}

function renderProfileResult(result) {
  $("#profile-result-body").innerHTML = profileResultRows(result).join("");
}

function renderStatus(result) {
  const pill = $("#state-pill");
  pill.textContent = result.state;
  pill.className = `status ${result.state === "VALID" ? "ok" : result.state === "WARNING" ? "warn" : "bad"}`;
  const message = $("#constraint-message");
  const parts = [];
  if (result.errors.length) parts.push(`INVALID · ${result.errors.join(" / ")}`);
  if (result.warnings.length) parts.push(`WARNING · ${result.warnings.join(" / ")}`);
  if (!parts.length) parts.push("VALID");
  message.textContent = parts.join("  ");
  message.className = `status-message ${result.state.toLowerCase()}`;
  markInvalidFields(1, result.state === "INVALID" ? result.errors : []);
}

// INVALID input titles (2026-10-12, user): the title above each input an INVALID message names turns
// red (names as the BE writes them, e.g. "LOCK conflict: Offset Angle …"). When the message names
// no input, the input edited last on that aircraft is marked instead (#2–#4: only when the message
// is not about another aircraft, e.g. "#1 has no result"). Cleared by the next VALID / WARNING result.
const INVALID_FIELD_NAMES = {
  runInHeadingDeg: ["run-in heading"], angleOffDeg: ["angle-off", "angle off"], attackHeadingDeg: ["attack heading"],
  offsetAngleDeg: ["offset angle", "angle #"], actionRangeNm: ["action range", "action point", "time #"], approachRangeNm: ["approach range"],
  vrpRangeNm: ["vrp range", "vrp would"], ipRangeNm: ["ip range", "flight ip", "ip bearing"],
  offsetG: ["offset g "], offsetBankDeg: ["offset bank"], offsetRadiusNm: ["offset radius"], offsetSpeedValue: ["offset speed"],
  initialAltitudeMslFt: ["initial altitude"], rollInAltitudeMslFt: ["roll-in altitude"], diveAngleDeg: ["dive angle"],
  trackingTimeSec: ["tracking time"], releaseAltitudeMslFt: ["release altitude"], releaseSpeedKcas: ["release speed"],
  distanceNm: ["distancenm"], bearingDeg: ["relativebearingdeg"],
};
const lastEditedField = new Map();
function markInvalidFields(number, messages) {
  const scope = number === 1 ? document.querySelector("#offset-calculator") : document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (!scope) return;
  const attr = number === 1 ? "data-key" : "data-flight-field";
  const labelsOf = (key) => [...scope.querySelectorAll(`[${attr}="${key}"]`)]
    .filter((node) => node.id !== "ip-bearing-input" && (number !== 1 || !node.closest(".flight-slot")))
    .map((node) => node.closest("label")).filter(Boolean);
  scope.querySelectorAll("label.input-invalid").forEach((label) => {
    if (number !== 1 || !label.closest(".flight-slot")) label.classList.remove("input-invalid");
  });
  const text = ` ${messages.filter(Boolean).join(" / ").toLowerCase()} `;
  if (!text.trim()) return;
  const keys = Object.entries(INVALID_FIELD_NAMES).filter(([, names]) => names.some((name) => text.includes(name))).map(([key]) => key);
  if (!keys.length && lastEditedField.has(number) && (number === 1 || !/#\d/.test(text))) keys.push(lastEditedField.get(number));
  keys.forEach((key) => labelsOf(key).forEach((label) => label.classList.add("input-invalid")));
}

// DED pages come from the BE (aircraftResults[n].ded: bearing, range in NM and ft, elevation);
// the FE only formats them.
function dedRangeText(page) {
  return `${Math.round(page.rangeFt)} ft (${formatNm(page.rangeNm)} NM)`;
}

function dedElevationText(elevationFt) {
  return `${Math.round(elevationFt)} ft`;
}

function renderDed(ded) {
  $("#ded-page-title").textContent = ded.page;
  $("#ded-bearing").textContent = `${formatDeg(ded.reference.bearingDeg)}°`;
  $("#ded-range").textContent = dedRangeText(ded.reference);
  $("#ded-elevation").textContent = dedElevationText(ded.reference.elevationFt);
  $("#ded-oa1-bearing").textContent = `${formatDeg(ded.oa1.bearingDeg)}°`;
  $("#ded-oa1-range").textContent = dedRangeText(ded.oa1);
  $("#ded-oa1-elevation").textContent = dedElevationText(ded.oa1.elevationFt);
}

// Follower DED (same grammar as DED #1): VRP = own Action Point and OA1 from Target, or the Flight
// VIP and OA1 from it (BE-owned values).
function renderFollowerDed(number, ded) {
  if (!FLIGHT_DED_AIRCRAFT.has(number)) return;
  const out = (key) => flightOutput(number, `[data-flight-ded="${key}"]`);
  if (!out("reference-title")) return;
  out("reference-title").textContent = ded?.page ?? (lastResult?.referenceMode === "VIP" ? "VIP" : "VRP");
  if (!ded) {
    ["reference-bearing", "reference-range", "reference-elevation", "oa1-bearing", "oa1-range", "oa1-elevation"].forEach((key) => { out(key).textContent = "-"; });
    return;
  }
  out("reference-bearing").textContent = `${formatDeg(ded.reference.bearingDeg)}°`;
  out("reference-range").textContent = dedRangeText(ded.reference);
  out("reference-elevation").textContent = dedElevationText(ded.reference.elevationFt);
  out("oa1-bearing").textContent = `${formatDeg(ded.oa1.bearingDeg)}°`;
  out("oa1-range").textContent = dedRangeText(ded.oa1);
  out("oa1-elevation").textContent = dedElevationText(ded.oa1.elevationFt);
}

function collectResultSnapshot(result) {
  const g = result.geometry;
  const t = result.timing;
  const p = result.profile.public;
  return {
    runAttackSummary: `${fmtHeading(g.runInHeadingDeg)}|${fmtHeading(g.attackHeadingDeg)}`,
    offsetHeadingDeg: g.offsetHeadingDeg,
    offsetAngleDeg: g.offsetAngleDeg,
    angleOffDeg: g.angleOffDeg,
    actionRangeNm: g.actionRangeNm,
    approachRangeNm: result.resolved.approachRangeNm,
    ipRangeNm: result.resolved.ipRangeNm,
    offsetRadiusNm: result.resolved.offsetRadiusNm,
    offsetTasKt: result.resolved.offsetTasKt,
    referenceSummary: `${result.referenceMode}|${result.reference.bearingDeg}|${result.reference.displayRangeNm}`,
    ingressSummary: `${t.ingressDistanceNm}|${t.ingressSec}`,
    offsetTurnSec: t.offsetTurnSec,
    approachSec: t.approachSec,
    rollToReleaseSec: t.rollToReleaseSec,
    legacyDeltaTosSec: t.legacyDeltaTosSec,
    effectiveReleaseAltitudeMslFt: p.effectiveReleaseAltitudeMslFt,
    resolvedInitialAltitudeMslFt: p.resolvedInitialAltitudeMslFt,
    trackPointAltitudeMslFt: p.trackPointAltitudeMslFt,
    trackingTimeSecResult: p.trackingTimeSec,
    rollInRangeNm: p.rollInRangeNm,
    groundRangeNm: p.groundRangeNm,
    rollInRadiusNm: p.rollInRadiusNm,
    rollInTimeSec: p.rollInTimeSec,
    rollInGroundArcNm: p.rollInGroundArcNm,
    rollInAltitudeLossFt: p.rollInAltitudeLossFt,
    leadAngleDeg: p.leadAngleDeg,
    minAltMslFt: p.minAltMslFt,
    nltReleaseMslFt: p.nltReleaseMslFt,
    bombRangeTofSummary: `${p.bombRangeNm}|${p.bombTofSec}`,
  };
}

function sameSnapshotValue(a, b) {
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= 1e-9;
  return Object.is(a, b);
}

function applyResultChangeStates(result) {
  const next = collectResultSnapshot(result);
  if (lastResultSnapshot && !initialRender) {
    Object.entries(next).forEach(([key, current]) => {
      if (!sameSnapshotValue(lastResultSnapshot[key], current)) valueStates.markResultChange(key);
    });
  }
  lastResultSnapshot = next;
}

// Top View toolbar wiring (FE): Common viewport (button-only Size, pan only when zoomed) and the
// Common smart-label long-press on the BE-owned view's svg.
const TOP_VIEW_WIDTH = OFFSET_TOP_VIEW_V0_1.canvas.width;
const topViewViewports = new WeakMap();
const topViewLabelDrags = new WeakMap();
const topViewLastResults = new WeakMap();
function installOffsetTopViewControls(svg, controls = {}) {
  if (topViewViewports.has(svg)) return topViewViewports.get(svg);
  const viewport = installSvgViewport(svg, {
    baseViewBox: { x: 0, y: 0, w: TOP_VIEW_WIDTH, h: OFFSET_TOP_VIEW_V0_1.canvas.maxHeight },
    panOnlyWhenZoomed: true,
    buttonOnlyZoom: true,
    allowPageScrollWhenPanDisabled: true,
    maxZoom: 2,
    maxZoomOut: 2,
    onViewBoxChange: (box) => {
      const percent = Math.round(TOP_VIEW_WIDTH / box.w * 100);
      if (controls.sizeResetButton) controls.sizeResetButton.textContent = `${percent}%`;
      if (controls.zoomInButton) controls.zoomInButton.disabled = percent >= 200;
      if (controls.zoomOutButton) controls.zoomOutButton.disabled = percent <= 50;
    },
    resetButton: controls.resetButton,
  });
  topViewViewports.set(svg, viewport);
  const stepSize = (delta) => {
    const current = TOP_VIEW_WIDTH / viewport.getViewBox().w;
    const next = Math.max(0.5, Math.min(2, Math.round((current + delta) * 100) / 100));
    viewport.zoomCenter(current / next);
  };
  controls.zoomInButton?.addEventListener("click", () => stepSize(0.25));
  controls.zoomOutButton?.addEventListener("click", () => stepSize(-0.25));
  controls.sizeResetButton?.addEventListener("click", () => viewport.reset());
  topViewLabelDrags.set(svg, installSmartLabelDrag(svg));
  return viewport;
}

// After each render: the view's canvas becomes the Size 100% base; a new result refits, the same
// result (Text, Advanced, IP Bottom) keeps the user's zoom/pan; moved labels return to their offsets.
// The key names what is drawn (the chosen aircraft and their results), so switching an aircraft on or
// off refits the canvas like a new result.
function syncTopViewViewport(svg, rendered, key) {
  const viewport = topViewViewports.get(svg);
  if (viewport) {
    viewport.setBaseViewBox({ x: 0, y: 0, w: rendered.canvas.width, h: rendered.canvas.height });
    if (topViewLastResults.get(svg) !== key) viewport.autoFit();
    else if (viewport.isUserAdjusted()) viewport.refresh();
    else viewport.ensureBaseWhenUnadjusted();
  }
  topViewLastResults.set(svg, key);
  topViewLabelDrags.get(svg)?.applyStoredPositions();
}

// PNG named after the graph title (docs/TERMINOLOGY.md "Diagram titles").
function exportOffsetTopView(svg, title) {
  return saveSvgAsPng(svg, `${title.replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" });
}

// Time dial: range 0 → the latest Impact of the drawn aircraft (whole seconds after IP), plus its fragment
// time when it has a SEM (2026-10-15, owner R5: the Profile shows the fragment cylinder over that time; the
// Top View holds its Impact state). The output button shows T and the phase; pressing it turns it off.
const TIME_PHASE_LABELS = Object.freeze({ ingress: "Ingress", turn: "Offset Turn", approach: "Approach", "roll-in": "Roll-in", tracking: "Tracking", released: "Released" });
function timeDialMaxSec(results) {
  let max = 0;
  results.filter(Boolean).forEach((result) => {
    try {
      const fragmentSec = result.profile?.public?.fragmentCheck?.applicable ? result.profile.public.fragment.timeSec : 0;
      max = Math.max(max, offsetTimeline(result).impactSec + fragmentSec);
    } catch (_) { /* unsolved: no time path */ }
  });
  return Math.max(1, Math.ceil(max));
}
function syncTimeDial(dial, svg, results, timeSec) {
  if (!dial) return;
  const range = dial.querySelector("[data-time-range]");
  const output = dial.querySelector("[data-time-output]");
  const maxSec = timeDialMaxSec(results);
  range.max = String(maxSec);
  range.value = String(Math.min(timeSec ?? 0, maxSec));
  const on = Number.isFinite(timeSec);
  dial.classList.toggle("active", on);
  const phase = svg?.querySelector('[data-top-view-role="time-overlay"]')?.dataset.timePhase;
  output.textContent = on ? `${Math.round(Math.min(timeSec, maxSec))} s${phase ? ` · ${TIME_PHASE_LABELS[phase] ?? phase}` : ""}` : "Off";
  output.setAttribute("aria-pressed", String(on));
}
function timeDialMarkup(number, label = `Top View #${number}`) {
  return `<div class="diagram-action-row time-dial" data-time-dial="${number}" role="group" aria-label="${label} time after IP"><span class="diagram-control-label">Time</span><button class="capture-button time-dial-play" type="button" data-time-play aria-pressed="false" title="Play the time dial (${TIME_PLAY_SPEED}× real time)">Play</button><input class="time-dial-range" type="range" min="0" max="1" step="1" value="0" data-time-range aria-label="Seconds after IP"><button class="capture-button diagram-scale-output time-dial-output" type="button" data-time-output aria-pressed="false" title="Seconds after IP; press to turn off">Off</button></div>`;
}
// Play (owner 2026-10-15, plan Q13): the dial runs from its T (0 when off) to the last Impact at
// TIME_PLAY_SPEED × real time, redrawn at most every TIME_PLAY_FRAME_MS; pressing Play again, moving the
// dial or turning it off stops it.
const TIME_PLAY_SPEED = 4;
const TIME_PLAY_FRAME_MS = 100;
// The Offset clock (seconds after IP): the Top View, and the BDP Profiles, 3D Profiles and HUD Views follow it
// (owner 2026-10-15, R5 / R6).
function setOffsetClock(timeSec) {
  topViewTimeSec = timeSec;
  renderTopView();
  [1, 2, 3, 4].forEach((number) => refreshBdpDiagrams(number));
}
// Every dial (the Top View's and each HUD View's copy, owner R6) shows the one clock; one Play runs it.
function syncTimeDials(svg, results, timeSec) {
  syncTimeDial($("#top-view-time-dial"), svg, results, timeSec);
  document.querySelectorAll("[data-time-dial]:not(#top-view-time-dial)").forEach(mirrorTimeDial);
}
function mirrorTimeDial(dial) {
  const source = $("#top-view-time-dial");
  if (!dial || !source) return;
  const range = dial.querySelector("[data-time-range]");
  const output = dial.querySelector("[data-time-output]");
  const sourceRange = source.querySelector("[data-time-range]");
  const sourceOutput = source.querySelector("[data-time-output]");
  range.max = sourceRange.max;
  range.value = sourceRange.value;
  dial.classList.toggle("active", source.classList.contains("active"));
  output.textContent = sourceOutput.textContent;
  output.setAttribute("aria-pressed", sourceOutput.getAttribute("aria-pressed"));
  const play = dial.querySelector("[data-time-play]");
  play?.setAttribute("aria-pressed", String(Boolean(timePlaying)));
  if (play) play.textContent = timePlaying ? "Pause" : "Play";
}
let timePlaying = null;
function setPlayButtons(on) {
  document.querySelectorAll("[data-time-dial] [data-time-play]").forEach((button) => {
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Pause" : "Play";
  });
}
function stopTimePlay() {
  if (timePlaying) cancelAnimationFrame(timePlaying.frame);
  timePlaying = null;
  setPlayButtons(false);
}
// startSec (optional): where Play from off, or from the end, starts (HUD copies: Roll-in −3 s; else 0).
// startSec: where Play from off (or from the end) starts; endSec: where it stops (the HUD: 1 s after this aircraft's
// SEM, owner 2026-10-19), else the dial's end.
function installTimeDial(dial, onChange, { startSec: freshStartSec = () => 0, endSec: windowEndSec = () => Infinity } = {}) {
  if (!dial || dial.dataset.installed) return;
  dial.dataset.installed = "true";
  const range = dial.querySelector("[data-time-range]");
  const play = dial.querySelector("[data-time-play]");
  const step = (now) => {
    if (!timePlaying) return;
    const maxSec = Math.min(Number(range.max) || 0, timePlaying.endSec);
    if (now - timePlaying.lastDraw >= TIME_PLAY_FRAME_MS) {
      const timeSec = Math.min(maxSec, timePlaying.startSec + ((now - timePlaying.startedAt) / 1000) * TIME_PLAY_SPEED);
      timePlaying.lastDraw = now;
      timePlaying.onChange(timeSec);
      if (timeSec >= maxSec) { stopTimePlay(); return; }
    }
    timePlaying.frame = requestAnimationFrame(step);
  };
  play?.addEventListener("click", () => {
    if (timePlaying) { stopTimePlay(); return; }
    const active = dial.classList.contains("active");
    const current = active ? (Number.isFinite(topViewTimeSec) ? topViewTimeSec : Number(range.value)) : null;
    const endSec = windowEndSec();
    const stopSec = Math.min(Number(range.max) || 0, Number.isFinite(endSec) ? endSec : Infinity);
    const startSec = current === null || current >= stopSec ? freshStartSec() : current;
    timePlaying = { startSec, endSec: Number.isFinite(endSec) ? endSec : Infinity, startedAt: performance.now(), lastDraw: -Infinity, frame: 0, onChange };
    setPlayButtons(true);
    timePlaying.frame = requestAnimationFrame(step);
  });
  range.addEventListener("input", (event) => { stopTimePlay(); onChange(Number(event.currentTarget.value)); });
  dial.querySelector("[data-time-output]").addEventListener("click", () => { stopTimePlay(); onChange(null); });
}

// Identity of a solved result for the viewport key (a new solve is a new object).
const topViewResultIds = new WeakMap();
let topViewResultCounter = 0;
function topViewResultId(result) {
  if (!topViewResultIds.has(result)) topViewResultIds.set(result, ++topViewResultCounter);
  return topViewResultIds.get(result);
}

// The aircraft the Top View buttons can show: #1 and the calculating followers of the Flight size.
function topViewAvailableAircraft() {
  return [1, 2, 3, 4].filter((number) => number === 1 || (number <= flightLayout.size && FLIGHT_CALCULATING_AIRCRAFT.has(number)));
}
function syncTopViewAircraftButtons() {
  const available = topViewAvailableAircraft();
  const visible = available.filter((number) => topViewAircraft.has(number));
  visibleAircraftListeners.forEach((listener) => listener(visible));
  document.querySelectorAll("[data-top-view-aircraft-button]").forEach((button) => {
    const number = Number(button.dataset.topViewAircraftButton);
    const shown = available.includes(number);
    const on = shown && topViewAircraft.has(number);
    button.hidden = !shown;
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("active", on);
  });
}

// Shown aircraft (handoff 2026-10-06 §5): the Top View #1–#4 set is the one visibleAircraftIds every
// output tab of the index shares; display only, never a solve input.
const visibleAircraftListeners = new Set();
function toggleVisibleAircraft(number) {
  if (topViewAircraft.has(number)) topViewAircraft.delete(number);
  else topViewAircraft.add(number);
  renderTopView();
}
// Flight Size shrink: drop the numbers it removed; a selection cut to nothing returns to #1.
function pruneVisibleAircraft() {
  const before = topViewAircraft.size;
  [...topViewAircraft].forEach((number) => { if (number > flightLayout.size) topViewAircraft.delete(number); });
  if (before && !topViewAircraft.size) topViewAircraft.add(1);
}
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-top-view-aircraft-button]");
  if (button && !button.disabled) toggleVisibleAircraft(Number(button.dataset.topViewAircraftButton));
});

// Offset Top View (user 2026-10-05): the aircraft switched on with #1–#4, drawn together in one frame
// fitted to all of them. One rotation for every aircraft: #1's Run-In (followers fly parallel Run-Ins).
function renderTopView() {
  const svg = $("#offset-top-view");
  const selected = topViewAvailableAircraft().filter((number) => topViewAircraft.has(number));
  syncTopViewAircraftButtons();
  if (persistenceReady) syncDedPngButtons();
  const aircraft = selected.map((number) => ({ number, result: flightResultOf(number) })).filter((item) => item.result);
  const title = offsetCombinedTopViewTitle(selected);
  svg.dataset.exportTitle = title;
  // A shown aircraft without a current result is named, not silently left out (§7.1).
  const missing = selected.filter((number) => !flightResultOf(number));
  const shell = svg.closest(".top-view-shell");
  let note = shell?.parentElement?.querySelector("[data-top-view-missing]");
  if (!note && shell) {
    note = document.createElement("p");
    note.className = "flight-draft-note top-view-missing";
    note.dataset.topViewMissing = "";
    note.setAttribute("role", "status");
    shell.after(note);
  }
  if (note) {
    note.hidden = !(aircraft.length && missing.length);
    note.textContent = note.hidden ? "" : `#${missing.join(", #")} not drawn · no current result`;
  }
  const capture = $("#capture-top-view");
  if (capture) capture.disabled = !aircraft.length;
  if (!aircraft.length) {
    const failed = selected.length ? `#${selected.join(", #")} has no current result` : "Choose an aircraft (#1–#4)";
    showCalculationFailed(svg, title, failed);
    syncTimeDials(svg, [], topViewTimeSec);
    legendItems.splice(0, legendItems.length);
    legend.render();
    return;
  }
  delete svg.dataset.calculationFailed;
  const upResult = lastResult ?? aircraft[0].result;
  const rendered = renderOffsetCombinedTopView(svg, aircraft, {
    textScale: topViewTextScale,
    viewportWidth: globalThis.innerWidth,
    advanced: topViewAdvanced,
    upHeadingDeg: topViewIpBottom ? upResult.resolved.runInHeadingDeg : 0,
    northArrow: !topViewIpBottom,
    timeSec: topViewTimeSec ?? undefined,
  });
  syncTopViewViewport(svg, rendered, aircraft.map((item) => `${item.number}:${topViewResultId(item.result)}`).join(","));
  syncTimeDials(svg, aircraft.map((item) => item.result), topViewTimeSec);
  legendItems.splice(0, legendItems.length, ...topViewLegendItems(aircraft));
  legend.render();
}

const CANVAS_LABELED_LEGEND = ["Roll-in Radius", "Offset Angle", "Approaching Heading"];

// Legend: #1 alone keeps #1's legend; otherwise the highest aircraft shown against the aircraft it
// releases after (#n vs #(n-1), the ΔTime reference; user 2026-10-05), in their drawing colours.
function topViewLegendItems(aircraft) {
  const own = aircraft[aircraft.length - 1];
  // Advanced off leaves out Roll-in Radius (user 2026-10-07) and the values the Top View already draws
  // as labels, Offset Angle and Approaching Heading (owner 2026-10-12).
  if (own.number === 1) return offsetTopViewLegend(own.result).filter((item) => topViewAdvanced || !CANVAS_LABELED_LEGEND.some((name) => item.label.startsWith(name)));
  const referenceNumber = own.number - 1;
  const referenceFull = flightResultFullOf(referenceNumber) ?? null;
  const ownFull = flightResultFullOf(own.number) ?? null;
  const delta = flightTimingOf(own.number);
  return offsetFlightTopViewLegend({
    reference: { number: referenceNumber, result: referenceFull },
    own: { number: own.number, result: ownFull },
    deltaTimeSec: delta?.predecessorImpactToOwnReleaseSec ?? null,
    referenceColor: offsetAircraftColors(referenceNumber).run,
    ownColor: offsetAircraftColors(own.number).run,
  });
}

// Drop-order timing of aircraft n against n - 1 from the last BE call (display precision), or null.
function flightTimingOf(number) {
  const timing = lastFlightTiming[number];
  return timing?.available ? truncateBeOutput(timing) : null;
}

// Calculation requests (performance addendum 2026-10-12, P4). Numeric typing waits for 200 ms of
// quiet (calculateLater), a numeric commit joins the waiting request (calculateCommit), Enter / LOCK
// / buttons / selections go at once (calculate), and a reset or load drops what was waiting
// (recalculateFresh). Each request is one BE call for the whole Flight with the ordered edit events.
let calculationScheduler = null;
let lastCalculationStats = null;
function calculate(edit = null) {
  calculationScheduler.immediate(edit);
}
function calculateLater(edit) {
  calculationScheduler.input(edit);
}
function calculateCommit(edit) {
  calculationScheduler.commit(edit);
}
function recalculateFresh(keep = undefined) {
  calculationScheduler.reset(keep);
}
// LOCK / option toggles: the next value follows the clicks not yet answered.
function toggledValue(aircraft, kind, key, current) {
  const pending = calculationScheduler.pendingToggle(aircraft, kind, key);
  return !(pending === undefined ? current : pending);
}

// The request input: the current inputs and state, plus the edit events not yet answered (an event
// for an aircraft no longer in the Flight is dropped with it).
function collectCalculationInput(edits) {
  const input = collectFlightInput();
  const current = edits.filter((edit) => !!input.aircraft[edit.aircraft ?? 1]);
  return current.length ? { ...input, edits: current } : input;
}

// Answer to the current state (calculation-client adopts nothing else): the returned state is stored
// and the results drawn. Nothing is solved, inherited or re-derived here.
function applyCalculationAnswer(message, sent) {
  const input = sent.input;
  const output = message.output ?? {
    // An input the BE cannot read at all (not a per-aircraft failure): nothing is current.
    aircraftResults: { 1: { status: "FAILED", result: null, error: message.error ?? "no result" } }, flightTiming: {}, nextInput: null,
  };
  lastCalculationStats = message.stats ?? null;
  if (output.nextInput) applyFlightState(output.nextInput, input, input.edits ?? []);
  else syncInitialLinkUi();
  lastFlightTiming = output.flightTiming ?? {};
  renderLead(output.aircraftResults[1]);
  for (let number = 2; number <= flightLayout.size; number += 1) {
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) renderFollower(number, output.aircraftResults[number] ?? { status: "FAILED", result: null, error: `Aircraft #${number} has no current result` });
  }
  // Z #1 after the followers: its ΔTime row is #2's (#1 Impact − #2 Release).
  if (lastResultFull) $("#capture-z").disabled = !renderZDiagramOf(1, $("#offset-z-svg"), lastResultFull);
  // The Flight Top View once every aircraft has its current result.
  renderTopView();
  syncDedPngButtons();
  initialRender = false;
  // SEM & Rejoin (2026-10-13) starts from this answer: the Full results and the input they answer.
  lastFlightAnswer = { input, output };
  flightAnswerListeners.forEach((listener) => listener(lastFlightAnswer));
}

// SEM & Rejoin hooks (index only, sem-rejoin-controller-v0.1.mjs through wide-layout.mjs): the last
// adopted Flight answer, extra records kept by the one Save, and the Load Default notice.
let lastFlightAnswer = null;
const flightAnswerListeners = new Set();
const saveExtensions = new Map();
const flightDefaultsListeners = new Set();

function installCalculation() {
  const transport = createWorkerTransport({ workerUrl: OFFSET_FLIGHT_WORKER_URL });
  calculationScheduler = createCalculationScheduler({ collect: collectCalculationInput, apply: applyCalculationAnswer, transport });
  // Read-only diagnostics for the browser oracle and performance checks (nothing here calculates).
  globalThis.offsetCalculation = Object.freeze({
    whenIdle: () => calculationScheduler.whenIdle(),
    state: () => calculationScheduler.state(),
    lastStats: () => lastCalculationStats,
    mode: () => transport.mode(),
  });
}

function renderLead(entry) {
  if (entry?.result) {
    const full = entry.result;
    const result = truncateBeOutput(full);
    lastResultFull = full;
    lastResult = result;
    $("#offset-heading-out").textContent = fmtHeading(result.resolved.offsetHeadingDeg);
    $("#turn-time-out").textContent = `${formatSec(result.timing.offsetTurnSec)} sec`;
    $("#driver-out").textContent = `DRIVER · ${driver}`;
    $("#lock-count").textContent = `LOCK ${Object.values(locks).filter(Boolean).length}`;
    renderStatus(result);
    renderOffsetResult(result);
    renderProfileResult(result);
    renderSemFragmentReadouts($("#lead-sem-readouts"), result);
    resultPanel.refresh();
    refreshBdpDiagrams(1);
    renderDed(entry.ded);
    applyResultChangeStates(result);
    return;
  }
  const errorMessage = entry?.error ?? "no result";
  document.querySelectorAll("[data-result-value]").forEach(node => { node.textContent = "N/A"; });
  resultPanel.refresh();
  const message = $("#constraint-message");
  message.textContent = `INVALID · ${errorMessage}`;
  message.className = "status-message invalid";
  markInvalidFields(1, [errorMessage]);
  const pill = $("#state-pill");
  pill.textContent = "INVALID";
  pill.className = "status bad";
  // A failed solve leaves no current result (FE-BE-RULES): Top View, Z, DED and the Full BDP
  // diagrams are cleared; the BE fails every follower that depends on #1.
  lastResult = null;
  lastResultFull = null;
  renderSemFragmentReadouts($("#lead-sem-readouts"), null);
  showCalculationFailed($("#offset-z-svg"), "Offset #1 Z-Diagram", errorMessage);
  $("#capture-z").disabled = true;
  clearDed();
  refreshBdpDiagrams(1);
  lastResultSnapshot = null;
}

// Placeholder drawn in a view whose solve failed (no stale geometry is left on screen).
function showCalculationFailed(svg, title, message) {
  if (!svg) return;
  const isZ = svg === $("#offset-z-svg") || svg.hasAttribute("data-flight-z");
  const width = isZ ? 650 : TOP_VIEW_WIDTH;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} 220`);
  svg.style.aspectRatio = `${width} / 220`;
  svg.dataset.calculationFailed = "true";
  const root = svg.appendChild(svgNode("g", isZ ? { "data-z-root": "" } : {}));
  const lines = [title, "Calculation failed · no current result", message.length > 70 ? `${message.slice(0, 67)}...` : message];
  lines.forEach((line, index) => root.append(svgNode("text", { x: width / 2, y: 70 + index * 40, "text-anchor": "middle", "font-size": index === 0 ? 22 : 17, fill: "#14202c" }, line)));
  topViewLastResults.delete(svg);
}

function clearDed() {
  ["ded-bearing", "ded-range", "ded-elevation", "ded-oa1-bearing", "ded-oa1-range", "ded-oa1-elevation"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.textContent = "-";
  });
}

function syncDuplicates(source) {
  const key = source.dataset.key;
  if (!key || source.id === "ip-bearing-input") return;
  if (key === "runInHeadingDeg") {
    fields(key).forEach((field) => {
      if (field !== source) field.value = source.value;
    });
    return;
  }
  valueStates.syncInputMirrors(key, source);
}

// Empty-field commit (user rule, 2026-09-28). While a field is empty nothing is recalculated; when
// an empty field is committed it is refilled instead of turning the solve INVALID. The FE passes the
// value and drivers from the start of the edit and the current default; the BE decides the refill
// (AG SPEC "Flight entrypoint", edit events).
let leadEditStart = null;

function rememberLeadEditStart(event) {
  const field = event.target.closest?.("[data-key]");
  if (!field || field.tagName === "SELECT" || field.id === "ip-bearing-input") return;
  const key = field.dataset.key;
  leadEditStart = { key, value: readFieldValue(key), driver, turnDriver };
  if (key === "initialAltitudeMslFt") rememberDeveloperEditStart(field);
}

function leadEditBefore(key) {
  return leadEditStart?.key === key ? { value: leadEditStart.value, driver: leadEditStart.driver, turnDriver: leadEditStart.turnDriver } : undefined;
}

function fillEmptyLeadField(key) {
  const fallback = Number.parseFloat(createDefaultPersistedState().inputs[key]);
  calculate({ aircraft: 1, kind: "clear", key, commit: true, before: leadEditBefore(key), fallbackValue: Number.isFinite(fallback) ? fallback : null });
}

// Enter in a numeric field: its commit goes at once; the browser's change that follows for the same
// field and text adds nothing (the commit already went).
let enterCommit = null;
function enterCommitted(field) {
  const same = enterCommit?.field === field && enterCommit.text === field.value;
  enterCommit = null;
  return same;
}

function handleFieldChange(event) {
  const field = event.target.closest?.("[data-key]");
  if (!field || field.id === "ip-bearing-input") return;
  // A LOCK-solved field is read-only; no event from it becomes an edit.
  if (field.hasAttribute("data-lock-solved")) return;
  // A selection is computed when it changes (its input event adds nothing).
  if (field.tagName === "SELECT" && event.type !== "change") return;
  // 7777 in Initial Altitude is the developer command (index only): not an altitude, never solved.
  if (field.dataset.key === "initialAltitudeMslFt" && isDeveloperCommand(field)) {
    if (event.type === "change") runDeveloperCommand(field);
    return;
  }
  if (event.type === "change" && field.tagName !== "SELECT" && enterCommitted(field)) return;
  if (event.type === "input") enterCommit = null;
  if (field.tagName !== "SELECT" && field.value.trim() === "") {
    // While a field is empty nothing is calculated (edits already typed wait for the next request).
    if (event.type === "change") fillEmptyLeadField(field.dataset.key);
    else calculationScheduler.hold();
    return;
  }
  syncDuplicates(field);
  const key = field.dataset.key;
  lastEditedField.set(1, key);
  dropSolvedIfEdited(solvedInputValues, key, field.value);
  // previousValue: this field's value in the state last returned (the IP link no-op commit).
  const edit = { aircraft: 1, kind: "set", key, commit: event.type !== "input", previousValue: lastLeadState?.values?.[key] ?? null };
  if (field.tagName === "SELECT") calculate(edit);
  else if (event.type === "input") calculateLater(edit);
  else if (event.type === "enter") calculate(edit);
  else calculateCommit(edit);
}

// Reference inputs: the typed value goes to the BE as entered (VIP bearing in canonical TO notation).
function handleReferenceInput(key) {
  dropSolvedIfEdited(solvedInputValues, key, $(REFERENCE_INPUTS[key])?.value ?? "");
  calculateLater({ aircraft: 1, kind: "set", key });
}

function handleIpBearingInput(event) {
  const entered = Number.parseFloat(event.target.value);
  if (!Number.isFinite(entered)) return;
  // The IP bearing is the Run-In axis in TO/FROM notation (canonical TO value to the BE).
  calculateLater({ aircraft: 1, kind: "set", key: "ipBearingDeg", value: canonicalToTargetBearing(entered, ipBearingDirection) });
}

function installLocks() {
  $$("[data-lock-key]").forEach((button) => {
    const key = button.dataset.lockKey;
    locks[key] = button.getAttribute("aria-pressed") === "true";
    button.addEventListener("click", () => calculate({ aircraft: 1, kind: "lock", key, value: toggledValue(1, "lock", key, locks[key]) }));
  });
}

function syncReferencePanes() {
  const isVrp = referenceMode === "VRP";
  $("#vrp-btn")?.classList.toggle("active", isVrp);
  $("#vip-btn")?.classList.toggle("active", !isVrp);
  $("#vrp-pane").hidden = !isVrp;
  $("#vip-pane").hidden = isVrp;
}

function installModeButtons() {
  $("#vrp-btn").addEventListener("click", () => {
    referenceMode = "VRP";
    syncReferencePanes();
    calculate();
  });
  $("#vip-btn").addEventListener("click", () => {
    referenceMode = "VIP";
    syncReferencePanes();
    calculate();
  });
}

function installReferenceBearingControls() {
  const vipBearingInput = $("#vip-bearing-input");
  const vipRangeInput = $("#vip-range-input");
  const vrpBearingInput = $("#vrp-bearing-input");
  const vrpRangeInput = firstField("vrpRangeNm");
  const ipBearingInput = $("#ip-bearing-input");
  // Blur shows the current state value at display precision (Full value kept behind).
  const showLeadValue = (key) => {
    const value = lastLeadState?.values?.[key];
    if (!Number.isFinite(value)) return;
    if (REFERENCE_INPUTS[key]) writeReferenceField(key, value, { includeActive: true });
    else {
      const text = formatNm(value);
      setValue(key, text, { includeActive: true });
      if (valuesEquivalent(firstField(key)?.value, text)) solvedInputValues.set(key, { text, value });
    }
  };

  // TO / FROM only changes the notation of the same canonical bearing.
  const setVipDirection = (nextDirection) => {
    const canonical = readReferenceValue("vipToTargetBearingDeg");
    vipBearingDirection = nextDirection;
    setDirectionButtons("vip", vipBearingDirection);
    if (Number.isFinite(canonical)) writeReferenceField("vipToTargetBearingDeg", canonical, { includeActive: true });
  };
  const setIpDirection = (nextDirection) => {
    const canonical = readRunInHeading();
    ipBearingDirection = nextDirection;
    setDirectionButtons("ip", ipBearingDirection);
    syncIpBearingInput(canonical, { includeActive: true });
  };

  $("#vip-to-target-btn").addEventListener("click", () => setVipDirection("TO_TARGET"));
  $("#vip-from-target-btn").addEventListener("click", () => setVipDirection("FROM_TARGET"));
  $("#ip-to-target-btn").addEventListener("click", () => setIpDirection("TO_TARGET"));
  $("#ip-from-target-btn").addEventListener("click", () => setIpDirection("FROM_TARGET"));

  // Leaving a reference field shows the BE's value for it once the answer to the current state is
  // in (a typed value may still be waiting for its request); not while the field is being typed in again.
  const onBlurAnswered = (field, show) => field?.addEventListener("blur", () => {
    calculationScheduler.whenIdle().then(() => { if (document.activeElement !== field) show(); });
  });
  vipBearingInput.addEventListener("input", () => handleReferenceInput("vipToTargetBearingDeg"));
  onBlurAnswered(vipBearingInput, () => showLeadValue("vipToTargetBearingDeg"));
  vipRangeInput.addEventListener("input", () => handleReferenceInput("vipRangeNm"));
  onBlurAnswered(vipRangeInput, () => showLeadValue("vipRangeNm"));

  vrpBearingInput.addEventListener("input", () => handleReferenceInput("vrpBearingDeg"));
  onBlurAnswered(vrpBearingInput, () => showLeadValue("vrpBearingDeg"));
  onBlurAnswered(vrpRangeInput, () => showLeadValue("vrpRangeNm"));

  ipBearingInput.addEventListener("input", handleIpBearingInput);
  onBlurAnswered(ipBearingInput, () => syncIpBearingInput(readRunInHeading(), { includeActive: true }));
}

function installValueStateBindings() {
  const heading = $("#offset-heading-out");
  heading.classList.add("value-result");
  heading.dataset.resultKey = "offsetHeadingDeg";
  const turnTime = $("#turn-time-out");
  turnTime.classList.add("value-result");
  turnTime.dataset.resultKey = "offsetTurnSec";
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const field = event.target.closest?.("[data-key]");
    if (!field?.dataset?.key || field.id === "ip-bearing-input") return;
    valueStates.confirmDependentInput(field.dataset.key);
    // Enter commits the typed value at once (with every waiting edit).
    if (field.tagName === "INPUT" && field.value.trim() !== "" && !(field.dataset.key === "initialAltitudeMslFt" && isDeveloperCommand(field))) {
      handleFieldChange({ type: "enter", target: field });
      enterCommit = { field, text: field.value };
    }
  });
}

function populateWeapons() {
  const options = [["M82", "Mk-82 (LD)"], ["B49", "Mk-82 AIR (HD)"], ["M83", "Mk-83 (LD)"], ["B85", "Mk-83 AIR (HD)"], ["M84", "Mk-84 (LD)"], ["B50", "Mk-84 AIR (HD)"]];
  fields("weaponId").forEach((select) => {
    select.innerHTML = options.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
    select.value = "M82";
  });
}


function capturePersistedState() {
  const inputs = {};
  // Display text of a field that holds a rounded solved value (inputs keep the full value), so a
  // restored save shows the same rounded text with the full value behind it (2026-10-11).
  const inputTexts = {};
  $$("[data-key]").forEach((control) => {
    const key = control.dataset.key;
    if (!key || control.id === "ip-bearing-input" || Object.prototype.hasOwnProperty.call(inputs, key)) return;
    const solved = solvedInputValues.get(key);
    const useSolved = solved && valuesEquivalent(control.value, solved.text);
    inputs[key] = useSolved ? String(solved.value) : control.value;
    if (useSolved && control.value !== inputs[key]) inputTexts[key] = control.value;
  });
  // Full values behind the reference inputs' rounded text (VRP bearing, VIP bearing / range).
  const referenceValues = {};
  Object.entries(REFERENCE_INPUTS).forEach(([key, selector]) => {
    const solved = solvedInputValues.get(key);
    const text = $(selector)?.value;
    if (solved && text !== undefined && valuesEquivalent(text, solved.text)) referenceValues[key] = { text, value: solved.value };
  });
  return {
    version: 3,
    inputs,
    inputTexts,
    referenceValues,
    vrpBearingInput: $("#vrp-bearing-input")?.value ?? "",
    vipBearingInput: $("#vip-bearing-input")?.value ?? "",
    vipRangeInput: $("#vip-range-input")?.value ?? "",
    referenceMode,
    vipBearingDirection,
    ipBearingDirection,
    ipLinked,
    ipLockHeadingDeg,
    rollInAltitudeLinked,
    fragmentMarginAppliesTo,
    solveMode: bdpSolveMode,
    enteredTrackingTimeSec,
    vipBearingExplicit,
    vipRangeExplicit,
    vrpBearingExplicit,
    vrpRangeExplicit,
    // Persisted since 2026-10-06 (handoff §3.1): the last tactical / turn edit decides the solve,
    // so a restored save re-solves to the same result.
    driver,
    turnDriver,
    locks: { ...locks },
  };
}

// Built-in (deployed) defaults; a developer preset saved in this browser replaces them (§3.2).
function factoryPersistedState() {
  return {
    version: 3,
    inputs: { ...DEFAULT_INPUT_VALUES },
    vrpBearingInput: "180",
    vipBearingInput: "000",
    vipRangeInput: "10.0",
    referenceMode: "VRP",
    vipBearingDirection: "TO_TARGET",
    ipBearingDirection: "TO_TARGET",
    ipLinked: true,
    ipLockHeadingDeg: 0,
    rollInAltitudeLinked: true,
    solveMode: "height",
    enteredTrackingTimeSec: DEFAULT_TRACKING_TIME_SEC,
    vipBearingExplicit: false,
    vipRangeExplicit: false,
    vrpBearingExplicit: false,
    vrpRangeExplicit: false,
    driver: "vrpRangeNm",
    turnDriver: "offsetG",
    locks: Object.fromEntries(Object.keys(locks).map((key) => [key, false])),
  };
}

function createDefaultPersistedState() {
  const factory = factoryPersistedState();
  const preset = readDefaultPreset();
  if (!preset) return factory;
  const lead = JSON.parse(JSON.stringify(preset.lead));
  return { ...factory, ...lead, inputs: { ...factory.inputs, ...lead.inputs }, locks: { ...factory.locks, ...lead.locks } };
}

// Restores a stored #1 record as input state (texts, Full values, flags, LOCKs). Storage-format
// migration only: the couplings (LINK, AUTO Bank, implicit references, IP LOCK unlink) are the BE's
// and are applied by the calculation that follows.
function applyPersistedState(saved) {
  if (!saved || typeof saved !== "object") return false;
  solvedInputValues.clear();
  lastLeadState = null;
  // One-time local-storage migration. Explicit canonical values/locks (including 0/false) win.
  const oldInputs = saved.inputs ?? {};
  saved = { ...saved, inputs: { ...DEFAULT_INPUT_VALUES, ...saved.inputs }, locks: { ...saved.locks } };
  if (saved.inputs.offsetRangeNm !== undefined && !Object.hasOwn(oldInputs, "approachRangeNm")) {
    saved.inputs.approachRangeNm = saved.inputs.offsetRangeNm;
  }
  if (saved.locks.approachRangeNm === undefined && saved.locks.offsetRangeNm !== undefined) {
    saved.locks.approachRangeNm = saved.locks.offsetRangeNm;
  }
  delete saved.inputs.offsetRangeNm;
  delete saved.locks.offsetRangeNm;
  Object.entries(saved.inputs ?? {}).forEach(([key, next]) => {
    if (firstField(key)) setValue(key, next, { includeActive: true });
  });
  // Rounded display text over the saved full value (see capturePersistedState).
  Object.entries(saved.inputTexts && typeof saved.inputTexts === "object" ? saved.inputTexts : {}).forEach(([key, text]) => {
    const full = Number.parseFloat(saved.inputs[key]);
    if (!firstField(key) || typeof text !== "string" || !Number.isFinite(full) || !Number.isFinite(Number.parseFloat(text))) return;
    // Only a rounding of that full value (a stale text over a changed value is ignored).
    const decimals = (text.split(".")[1] ?? "").length;
    if (Math.abs(Number.parseFloat(text) - full) > 0.5 * 10 ** -decimals + 1e-9) return;
    // Equal values in another spelling (035 vs 35) are skipped by setValue: write the text itself.
    if (!setValue(key, text, { includeActive: true })) fields(key).forEach((field) => { field.value = text; });
    solvedInputValues.set(key, { text, value: full });
  });

  if ($("#vrp-bearing-input") && typeof saved.vrpBearingInput === "string") $("#vrp-bearing-input").value = saved.vrpBearingInput;
  if ($("#vip-bearing-input") && typeof saved.vipBearingInput === "string") $("#vip-bearing-input").value = saved.vipBearingInput;
  if ($("#vip-range-input") && typeof saved.vipRangeInput === "string") $("#vip-range-input").value = saved.vipRangeInput;
  Object.entries(saved.referenceValues && typeof saved.referenceValues === "object" ? saved.referenceValues : {}).forEach(([key, entry]) => {
    const field = $(REFERENCE_INPUTS[key] ?? "#none");
    if (field && entry && typeof entry.text === "string" && Number.isFinite(entry.value) && field.value === entry.text) solvedInputValues.set(key, { text: entry.text, value: entry.value });
  });

  referenceMode = saved.referenceMode === "VIP" ? "VIP" : "VRP";
  vipBearingDirection = saved.vipBearingDirection === "FROM_TARGET" ? "FROM_TARGET" : "TO_TARGET";
  ipBearingDirection = saved.ipBearingDirection === "FROM_TARGET" ? "FROM_TARGET" : "TO_TARGET";
  ipLinked = saved.version >= 3 && saved.ipLinked !== false;
  ipLockHeadingDeg = Number.isFinite(saved.ipLockHeadingDeg) ? saved.ipLockHeadingDeg : null;
  rollInAltitudeLinked = saved.rollInAltitudeLinked !== false;
  fragmentMarginAppliesTo = saved.fragmentMarginAppliesTo === "HEIGHT" ? "HEIGHT" : "HEIGHT_AND_RADIUS";
  syncFragmentMarginButton();
  // Before 2026-10-01 the solve mode was the Solve Mode select, saved with the inputs.
  const savedMode = saved.solveMode ?? oldInputs.solveMode;
  // "release" = Roll-in Altitude LOCK + Tracking Time entry (Release Altitude solved; 2026-10-12).
  bdpSolveMode = savedMode === "time" || savedMode === "release" ? savedMode : "height";
  // Older records kept the entered Tracking Time only in the time-mode field; absent = BE default.
  const savedTracking = Number(saved.enteredTrackingTimeSec ?? (bdpSolveMode === "time" ? saved.inputs.trackingTimeSec : NaN));
  enteredTrackingTimeSec = Number.isFinite(savedTracking) ? savedTracking : null;
  vipBearingExplicit = saved.vipBearingExplicit === true;
  vipRangeExplicit = saved.vipRangeExplicit === true;
  vrpBearingExplicit = saved.vrpBearingExplicit === true;
  vrpRangeExplicit = saved.vrpRangeExplicit === true;
  // An older save's rollBankAuto is ignored: the Roll-in Bank is BDP v0.4's result (owner 2026-10-15).
  if (LEAD_DRIVERS.has(saved.driver)) driver = saved.driver;
  if (LEAD_TURN_DRIVERS.has(saved.turnDriver)) turnDriver = saved.turnDriver;

  Object.keys(locks).forEach((key) => {
    locks[key] = saved.locks?.[key] === true;
  });
  syncLockButtons();

  syncReferencePanes();
  setDirectionButtons("vip", vipBearingDirection);
  setDirectionButtons("ip", ipBearingDirection);
  syncInitialLinkUi();
  syncIpBearingInput(readRunInHeading(), { includeActive: true });
  return true;
}

// Read once at startup so #1, followers, view and extensions come from one snapshot.
let restoredWorkSave = { lead: null, flight: null, notice: null };
function loadPersistedState() {
  return applyPersistedState(restoredWorkSave.lead);
}

function clearPendingInputStates() {
  $$(".value-dependent-input").forEach((node) => node.classList.remove("value-dependent-input"));
}


// Per-tab controls (2026-09-26): each input tab of each aircraft carries its own visibility
// toggle, Save and Default in its section head instead of one global title-bar row.
// BDP tabs use Full BDP (their Advanced fields are exactly the BDP extras); Reference Point uses
// Advanced (IP); tabs without hidden fields carry only Save / Default.
const TAB_TOOLS = {
  bdp: ["fullBdp", "save", "default"],
  reference: ["advanced", "save", "default"],
  offset: ["save", "default"],
  formation: ["save", "default"],
};

// BDP Top View + Profile of one aircraft (user 2026-10-02): their own block between that aircraft's
// Offset Top View and Z-Diagram, drawn from the profile its own solve used, shown only while the
// Top View's Full button is on. (The BDP tab's Full BDP now reveals only the BDP extra inputs.)
// 2026-10-07 (user): "(Bomb Delivery Planner)" dropped from the title; an Advanced button sits beside it.
const offsetBdpTopViewTitle = (number) => `BDP #${number} Top View`;
// 2026-10-15 (owner R6): the 3D Profile and HUD View under the BDP Top View; the HUD carries its own copy of
// the Offset time dial (one clock, one Play).
const offsetBdpDiagramsMarkup = (number) => bdpDiagramsMarkup({
  aircraftNumber: number, topTitle: offsetBdpTopViewTitle(number), topAdvanced: true, topOrientation: true, profileAdvanced: true,
  flightViews: true, threeDTitle: `BDP #${number} 3D Profile`, hudTitle: `BDP #${number} HUD View`, hudTimeMarkup: timeDialMarkup(`hud-${number}`, `BDP #${number} HUD View`),
});
function bdpDiagramsContainer(number) {
  const section = document.querySelector(`[data-bdp-views="${number}"]`);
  return section ? { section, container: section.querySelector("[data-bdp-diagrams]") } : null;
}

// Seconds after this aircraft's Release at the Top View time dial's T (null while the dial is off).
function dialTimeAfterRelease(result) {
  if (!Number.isFinite(topViewTimeSec)) return null;
  try { return topViewTimeSec - offsetTimeline(result).releaseSec; } catch (_) { return null; }
}

// Seconds after this aircraft's Roll-in Point at the dial's T, for the 3D Profile and HUD View (null while off).
function dialTimeFromRollIn(result) {
  if (!Number.isFinite(topViewTimeSec)) return null;
  try { return topViewTimeSec - offsetTimeline(result).legs.find((leg) => leg.phase === "roll-in").startSec; } catch (_) { return null; }
}

// The HUD starts at Roll-in −3 s (owner handoff §3.1): the real Offset path before it, a little longer (the BDP flight
// path cuts it at −3 s, 0.1.3).
const HUD_APPROACH_SEC = 3.5;
// HUD Play from off or the end starts at this aircraft's Roll-in −3 s on the Offset clock (not before the IP).
function hudStartClockSec(number) {
  try {
    const rollLeg = offsetTimeline(flightResultOf(number)).legs.find((leg) => leg.phase === "roll-in");
    return Math.max(0, rollLeg.startSec - 3);
  } catch (_) { return 0; }
}

// HUD Play stops 1 s after this aircraft's SEM ends (owner 2026-10-19): the BDP views' window end on the Offset clock.
function hudEndClockSec(number) {
  try {
    const rollLeg = offsetTimeline(flightResultOf(number)).legs.find((leg) => leg.phase === "roll-in");
    const window = bdpFlightViewWindow(bdpDiagramsContainer(number)?.container);
    return window ? rollLeg.startSec + window.endSec : Infinity;
  } catch (_) { return Infinity; }
}

function refreshBdpDiagrams(number) {
  const target = bdpDiagramsContainer(number);
  if (!target?.container || !target.section.classList.contains("show-full-views")) return;
  const result = flightResultOf(number);
  if (!result?.profile) {
    clearBdpDiagrams(target.container);
    return;
  }
  try {
    // Offset draws the Roll-in Top View on a north-up map: the Initial → OA1 leg flies the Approaching
    // Heading (offsetHeadingDeg) and the Roll-in turns to the Attack Heading (Offset FE SPEC).
    renderBdpDiagrams(target.container, result.profile, {
      scope: `aircraft-${number}`,
      aircraftNumber: number,
      // 2026-10-07 (user): Offset layout — 2× text, legend box under each BDP view, Profile labels.
      layout: "OFFSET",
      // 2026-10-18 (owner): on a PC (viewport > 620 px) the Top View and Dive Profile text at 100% is the former 60%
      // (1.2× instead of 2×); a phone keeps 2× (diagrams panel 0.10.1).
      viewportWidth: globalThis.innerWidth,
      // 2026-10-06 (user): spelled-out BDP title; no Roll-in Lat. D (the dashed reference line stays;
      // its Angle-Off-90 rule and Base Distance were cancelled the same day).
      // 2026-10-18 (owner handoff §5): the BDP Top View is Initial Up by default — this aircraft's Initial
      // (Approaching) heading into the Roll-in Point points up — or North Up, by the buttons beside its title
      // (diagrams panel 0.9.0). Independent of the Offset Top View's Run-in up (IP Bottom). True headings kept.
      topView: { orientation: "NORTH_UP", inHeadingDeg: result.geometry.offsetHeadingDeg, rollDirection: result.geometry.direction.rollDirection, context: "PATTERN", rollInRangeStyle: "radial",
        title: offsetBdpTopViewTitle(number), lateralDistance: false,
        // 2026-10-06 (user): Remark adds Attack Heading, Dive Angle, Roll-in Bank Angle, Roll-in G, AOD; MAP on one line.
        remarkDetail: true, attackHeadingDeg: result.geometry.attackHeadingDeg, oneLineLabels: true },
      // 2026-10-15 (owner R5): the Profile shows the SEM, the fragment cylinder and the aircraft at the Top View
      // time dial's T (seconds after IP → seconds after this aircraft's Release).
      profileView: { timeAfterReleaseSec: dialTimeAfterRelease(result) },
      // 2026-10-15 (owner R6): 3D Profile and HUD View on the same clock (seconds from the Roll-in Point).
      // 2026-10-18 (owner handoff §3.1): the real approach before the Roll-in Point (the HUD starts at Roll-in −3 s).
      flightView: { rollDirection: result.geometry.direction.rollDirection, timeSec: dialTimeFromRollIn(result), approach: offsetApproachInBdpFrame(result, HUD_APPROACH_SEC) },
    });
    const hudDial = target.container.querySelector(`[data-time-dial="hud-${number}"]`);
    installTimeDial(hudDial, setOffsetClock, { startSec: () => hudStartClockSec(number), endSec: () => hudEndClockSec(number) });
    mirrorTimeDial(hudDial);
  } catch {
    clearBdpDiagrams(target.container);
  }
}

// Full (Offset Top View toolbar, last button; one Top View for the Flight since 2026-10-05): its
// data-full-views="all" shows the BDP Top View and Profile of every aircraft. A data-full-views="n"
// button (PC wide workspace "BDP Views") still toggles aircraft #n alone.
const fullViewsOn = new Set();
function fullViewsAircraft() {
  return [1, 2, 3, 4].filter((number) => document.querySelector(`[data-bdp-views="${number}"]`));
}
function syncFullViewButtons() {
  const all = fullViewsAircraft();
  document.querySelectorAll("[data-full-views]").forEach((button) => {
    const key = button.dataset.fullViews;
    const on = key === "all" ? all.length > 0 && all.every((number) => fullViewsOn.has(number)) : fullViewsOn.has(Number(key));
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("active", on);
  });
}
function applyFullViews(number) {
  const on = fullViewsOn.has(number);
  document.querySelector(`[data-bdp-views="${number}"]`)?.classList.toggle("show-full-views", on);
  syncFullViewButtons();
  if (on) refreshBdpDiagrams(number);
}
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-full-views]");
  if (!button) return;
  if (button.dataset.fullViews === "all") {
    const all = fullViewsAircraft();
    const allOn = all.every((number) => fullViewsOn.has(number));
    [1, 2, 3, 4].forEach((number) => (allOn ? fullViewsOn.delete(number) : fullViewsOn.add(number)));
    [1, 2, 3, 4].forEach(applyFullViews);
    return;
  }
  const number = Number(button.dataset.fullViews);
  if (fullViewsOn.has(number)) fullViewsOn.delete(number);
  else fullViewsOn.add(number);
  applyFullViews(number);
});

const saveFeedbackTimers = new WeakMap();
function showSaveButtonResult(button, ok) {
  const oldTimer = saveFeedbackTimers.get(button);
  if (oldTimer) clearTimeout(oldTimer);
  button.textContent = ok ? "Saved" : "Save failed";
  if (ok) saveFeedbackTimers.set(button, setTimeout(() => { button.textContent = "Save"; }, 900));
}

function installSectionTools(root = document) {
  root.querySelectorAll(".section[data-tab]").forEach((section) => {
    const header = section.firstElementChild;
    if (!header || header.querySelector(".section-tools")) return;
    // index (2026-10-12, user): the Save/Load tab is the one Save, so tabs drop their own Save and
    // their Default reads "Tab Default" (it resets only that tab). Standard keeps both as before.
    const tools = (TAB_TOOLS[section.dataset.tab] ?? []).filter((tool) => !(INDEX_LAYOUT && tool === "save"));
    if (!tools.length) return;
    const aircraft = Number(section.dataset.aircraftTab ?? 1);
    const title = header.querySelector("h2")?.textContent.trim() ?? section.dataset.tab;
    const group = document.createElement("span");
    group.className = "section-tools";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${title} controls`);
    const make = (tool, text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn tab-tool";
      button.dataset.tabTool = tool;
      button.textContent = text;
      group.append(button);
      return button;
    };
    tools.forEach((tool) => {
      // A tab without hidden BDP extras needs no Full BDP toggle. index BDP tabs (owner 2026-10-15, R1): basic =
      // Target, Bomb, Wind; SEM / Recovery under the tab's own Full BDP.
      if (tool === "fullBdp" && !section.querySelector(".bdp-extra")) return;
      if (tool === "advanced" && !section.querySelector(".advanced-only")) return;
      if (tool === "fullBdp" || tool === "advanced") {
        const className = tool === "fullBdp" ? "show-full-bdp" : "show-advanced";
        const label = tool === "fullBdp" ? "Full BDP" : "Advanced";
        const button = make(tool, `${label}: Off`);
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          const on = section.classList.toggle(className);
          button.classList.toggle("active", on);
          button.setAttribute("aria-pressed", String(on));
          button.textContent = `${label}: ${on ? "On" : "Off"}`;
        });
      } else if (tool === "save") {
        make(tool, "Save").addEventListener("click", (event) => { saveCurrentWork(event.currentTarget); });
      } else if (tool === "default") {
        make(tool, INDEX_LAYOUT ? "Tab Default" : "Default").addEventListener("click", () => {
          if (aircraft === 1) resetLeadTab(section.dataset.tab, section);
          else resetFollowerTab(aircraft, section.dataset.tab, section);
        });
      }
    });
    const icon = header.querySelector(".section-collapse-icon");
    if (icon && icon.parentElement === header) header.insertBefore(group, icon);
    else header.append(group);
  });
}

// Default for one #1 tab: only that tab's inputs (and its locks / link states) return to the
// current defaults (developer preset, else built-in); other tabs keep their current values.
// Ownership follows the fields the tab holds (handoff 2026-10-06 §4.2), so the index grouping
// (profile in Offset) and the Standard grouping (profile in BDP) reset the same state with the field:
// Initial Altitude carries LINK / solve mode / entered Tracking Time, Roll-in Bank carries AUTO,
// the tactical fields carry the drivers, the Reference panes carry the reference state.
const LEAD_TACTICAL_KEYS = ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm", "offsetG", "offsetBankDeg", "offsetRadiusNm"];
function resetLeadTab(tab, section) {
  const current = capturePersistedState();
  const defaults = createDefaultPersistedState();
  const owns = (key) => !!section.querySelector(`[data-key="${key}"]:not(#ip-bearing-input)`);
  section.querySelectorAll("[data-key]").forEach((control) => {
    const key = control.dataset.key;
    if (control.id !== "ip-bearing-input" && Object.hasOwn(defaults.inputs, key)) {
      current.inputs[key] = defaults.inputs[key];
      if (Object.hasOwn(defaults.inputTexts ?? {}, key)) current.inputTexts[key] = defaults.inputTexts[key];
      else delete current.inputTexts[key];
    }
  });
  section.querySelectorAll("[data-lock-key]").forEach((button) => { current.locks[button.dataset.lockKey] = defaults.locks?.[button.dataset.lockKey] === true; });
  if (owns("initialAltitudeMslFt")) {
    current.rollInAltitudeLinked = defaults.rollInAltitudeLinked;
    current.solveMode = defaults.solveMode;
    current.enteredTrackingTimeSec = defaults.enteredTrackingTimeSec;
  }
  if (tab === "reference" || section.querySelector("#vrp-pane")) {
    for (const key of ["vrpBearingInput", "vipBearingInput", "vipRangeInput", "referenceMode", "vipBearingDirection", "ipBearingDirection", "ipLinked", "ipLockHeadingDeg", "vipBearingExplicit", "vipRangeExplicit", "vrpBearingExplicit", "vrpRangeExplicit"]) {
      current[key] = defaults[key];
    }
    current.referenceValues = { ...(defaults.referenceValues ?? {}) };
    current.inputs.runInHeadingDeg = defaults.inputs.runInHeadingDeg;
    current.driver = defaults.driver;
  }
  if (LEAD_TACTICAL_KEYS.some(owns)) {
    current.driver = defaults.driver;
    current.turnDriver = defaults.turnDriver;
  }
  applyPersistedState(current);
  section.querySelectorAll(".value-dependent-input").forEach((node) => node.classList.remove("value-dependent-input"));
  // Edits waiting for this tab's fields are replaced by the defaults; other waiting edits stay.
  recalculateFresh((edit) => (edit.aircraft ?? 1) !== 1 || !owns(edit.key));
}

// Follower tab Default: the draft keys of the fields this tab holds (plus the solve mode and entered
// Tracking Time with Initial Altitude, and the driver with the tactical fields) from the default draft.
function resetFollowerTab(number, tab, section = null) {
  const draft = flightDraft(number);
  const defaults = defaultFlightDraft(number);
  const keys = section
    ? [...new Set([...section.querySelectorAll("[data-flight-field]")].map((node) => node.dataset.flightField))]
    : FOLLOWER_TAB_KEYS[tab] ?? [];
  if (keys.includes("initialAltitudeMslFt")) keys.push("solveMode", "enteredTrackingTimeSec");
  if (keys.some((key) => FLIGHT_TACTICAL_DRIVERS.includes(key))) keys.push("driver");
  keys.forEach((key) => {
    if (!Object.hasOwn(defaults, key)) return;
    draft[key] = defaults[key];
    if (draft.solved) delete draft.solved[key];
  });
  const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (slot) initializeFlightSlotFields(slot, number);
  recalculateFresh((edit) => (edit.aircraft ?? 1) !== number || !keys.includes(edit.key));
}

// Follower BDP inputs owned per aircraft. An empty value follows the element lead's current value
// (#2 / #3: #1, #4: #3; Roll-in Bank: automatic from this aircraft's own Dive Angle), shown as the
// placeholder; the BE resolves it (AG SPEC "Flight entrypoint").
const FOLLOWER_BDP_EXTRA_KEYS = ["fragmentHeightMarginPercent", "recoveryG", "speedOvershootKcas", "gOnsetTimeSec", "rollInG", "rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec", "csemTargetFpaDeg", "semTurnDeg", "semTurnG", "semTurnSpeedKcas", "semTurnBankDeg"];
// Follower selections stored as text: blank SEM End / SEM Turn follow the element lead; a blank Turn Direction is
// this aircraft's own Roll-in side (owner 2026-10-19).
const FOLLOWER_CHOICES = Object.freeze({ semEnd: ["LEVEL", "CLIMB"], semTurnType: ["LEVEL", "SLICE"], semTurnDirection: ["LEFT", "RIGHT"] });
const followerChoice = (key, value) => (FOLLOWER_CHOICES[key].includes(value) ? value : "");
// Follower LOCKs and element-lead options (BE options; same LOCK fields as #1 since 2026-10-12).
const FOLLOWER_LOCK_OPTIONS = ["offsetAngleLocked", "sameAngleAsLead", "actionRangeLocked", "sameTimeAsLead", "rollInAltitudeLocked", "attackHeadingLocked", "angleOffLocked", "approachRangeLocked", "diveAngleLocked"];
// Per-tab keys reset by that tab's Default (follower aircraft).
const FOLLOWER_TAB_KEYS = {
  formation: ["side", "bearingDeg", "distanceNm"],
  bdp: ["weaponId", "semEnd", "semTurnType", "semTurnDirection", "initialSpeedValue", "initialAltitudeMslFt", "rollInAltitudeMslFt", "rollInAltitudeLinked", "diveAngleDeg", "diveAngleLocked", "trackingTimeSec", "solveMode", "enteredTrackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas", ...FOLLOWER_BDP_EXTRA_KEYS],
  offset: ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm", ...FOLLOWER_LOCK_OPTIONS, "driver"],
};

// Default 4-ship positions (fingertip): #2 left of #1, #3 right of #1 at 2 NM, #4 right of #3.
// #1 offsets to its right by default, so the right-hand element solves cleanly from these values.
const FLIGHT_DEFAULT_POSITIONS = { 2: { side: "LEFT", distanceNm: "1" }, 3: { side: "RIGHT", distanceNm: "2" }, 4: { side: "RIGHT", distanceNm: "1" } };

// Default draft of a follower: the developer preset's draft when one is saved (§3.2), else built-in.
function defaultFlightDraft(number = 2) {
  const factory = factoryFlightDraft(number);
  const record = readDefaultPreset()?.flight?.aircraft?.[number];
  return record ? normalizeFlightDraft(number, record, factory) : factory;
}

function factoryFlightDraft(number = 2) {
  const position = FLIGHT_DEFAULT_POSITIONS[number] ?? FLIGHT_DEFAULT_POSITIONS[2];
  return {
    weaponId: "M82", semEnd: "", semTurnType: "", semTurnDirection: "", side: position.side, bearingDeg: "90", distanceNm: position.distanceNm,
    initialSpeedValue: "350", initialAltitudeMslFt: "16000", diveAngleDeg: "45",
    rollInAltitudeMslFt: "16000", rollInAltitudeLinked: true,
    trackingTimeSec: "18.0", solveMode: "height", enteredTrackingTimeSec: "18", releaseAltitudeMslFt: "6800", releaseSpeedKcas: "450",
    ...Object.fromEntries(FOLLOWER_BDP_EXTRA_KEYS.map((key) => [key, ""])),
    attackHeadingDeg: "030", angleOffDeg: "70",
    offsetAngleDeg: "40", actionRangeNm: "7.0", approachRangeNm: "",
    offsetAngleLocked: false, sameAngleAsLead: true,
    actionRangeLocked: false, sameTimeAsLead: false,
    rollInAltitudeLocked: false, attackHeadingLocked: false, angleOffLocked: false, approachRangeLocked: false, diveAngleLocked: false,
    driver: "actionRangeNm",
    // Full values behind fields that show a rounded solved value ({ key: { text, value } }).
    solved: {},
  };
}

function flightDraft(number) {
  return flightLayout.aircraft[number] ||= defaultFlightDraft(number);
}

// Reference aircraft of a follower: Formation position, Angle/Time options and the Top View lead
// layer (#4 -> #3, #2/#3 -> #1). Drop-order timing always compares with the predecessor n-1.
function elementLeadNumber(number) {
  return number === 4 ? 3 : 1;
}

// A follower's output sections (Z, Result, DED, BDP views) carry data-output-aircraft="n" so they
// are found by aircraft number wherever the layout puts them (index moves them out of the slot,
// whose inputs stay in #flight-followers for the delegated input handlers).
function flightOutput(number, selector) {
  return document.querySelector(`[data-output-aircraft="${number}"] ${selector}`);
}

function flightResultOf(number) {
  return number === 1 ? lastResult : flightResults.get(number) ?? null;
}

// Full-precision result of an aircraft, for the solves of the aircraft that follow it.
function flightResultFullOf(number) {
  return number === 1 ? lastResultFull : flightResultsFull.get(number) ?? null;
}

// Save also keeps what the index shows (2026-10-12, user: Save is the whole Offset page, #1–#4):
// the Top View #1–#4 set and the edited aircraft come back with the saved conditions.
let editAircraftOf = () => 1;
let loadedSave = null;
function captureFlightLayout() {
  const view = { shownAircraft: [...topViewAircraft].sort(), editAircraft: editAircraftOf() };
  const extensions = Object.fromEntries([...saveExtensions].map(([name, extension]) => [name, extension.capture()]));
  return { ...flightLayout, view, ...extensions, savedAt: new Date().toISOString() };
}

// `heading` overrides "<title> #n" for graph sections, whose titles read "<Subject> #n <View>".
function flightSection(number, title, content, { calculating = false, tab = "", heading = null, output = "", tools = "" } = {}) {
  const badge = calculating ? "" : `<span class="flight-draft-badge">UI draft</span>`;
  const tabAttr = calculating && tab ? ` data-tab="${tab}" data-aircraft-tab="${number}"` : "";
  const outputAttr = output ? ` data-output-aircraft="${number}" data-aircraft-output="${output}"` : "";
  return `<section class="section flight-draft-section"${tabAttr}${outputAttr}><div class="section-head"><h2>${heading ?? `${title} #${number}`}</h2>${badge}${tools}</div>${content}</section>`;
}

// A BDP result shown in the follower's tab (Roll-in Bank, owner 2026-10-15): written from the BE's
// derived value, never typed.
function followerResultField(key, label, { always = false } = {}) {
  const className = always ? "field" : "field advanced-only bdp-extra";
  const tag = always ? "" : ` <span class="adv-tag">ADV</span>`;
  return `<label class="${className}"><span>${label}${tag}</span><input data-flight-field="${key}" type="text" inputmode="decimal" readonly data-bdp-result title="Solved by BDP (Roll-in model B)"><span class="unit">Result · solved by BDP (Roll-in model B)</span></label>`;
}

// BDP v0.4 onset rates (owner 2026-10-15; Full BDP). Blank on a follower = follows its element lead.
const ONSET_FIELDS = [["rollInRollRateDegSec", "Roll-in Rate (deg/s)"], ["rollOutRollRateDegSec", "Roll-out Rate (deg/s)"], ["gOnsetRateGSec", "G Onset Rate (G/s)"]];

// Fragment data in the BDP tab (owner handoff 2026-10-18 §7.2): developer mode only, read only. The weapon's own
// values (no margin), then the planning envelope the views draw (with the Fragment Height Margin). The SEM results
// moved to the Result (SEM Minimum Altitude, MINALT); the fragment check stays a BE diagnostic.
const FRAGMENT_DEV_ROWS = [
  ["lateral", "Fragment Lateral Extent", "Left / right of the impact point (total 2R) · weapon data, no margin"],
  ["height", "Fragment Height", "Above the Target · weapon data, no margin"],
  ["duration", "Fragment Duration", "After impact · weapon data"],
  ["envelope", "Planning Envelope (max)", "With the Fragment Height Margin · Profile / 3D"],
];
function semFragmentReadoutsMarkup() {
  return `<h3 class="input-group-title">Fragment Data (developer)</h3><div class="input-grid">${FRAGMENT_DEV_ROWS.map(([key, label, note]) => `<label class="field"><span>${label}</span><output data-sem-readout="${key}">-</output><span class="unit">${note}</span></label>`).join("")}</div>`;
}
// Fields of one SEM only (owner handoff 2026-10-18 §6.1; owner 2026-10-19): CSEM Target FPA with the CSEM; the SEM
// Turn with the Level SEM — its AUTO bank with a level turn, the bank entry with a slice. A follower's blank
// ("Follow") shows what its element lead flies.
function followedChoice(slot, key, leadValue) {
  if (!slot) return leadValue;
  const own = slot.querySelector(`[data-flight-field="${key}"]`)?.value;
  if (own) return own;
  return Number(slot.dataset.aircraft) === 4 ? (followerSlot(3)?.querySelector(`[data-flight-field="${key}"]`)?.value || leadValue) : leadValue;
}
function syncSemFields() {
  const leadSem = firstField("semEnd")?.value ?? "LEVEL";
  const leadTurn = firstField("semTurnType")?.value ?? "LEVEL";
  document.querySelectorAll("[data-csem-only], [data-level-sem-only], [data-sem-turn-level-only], [data-sem-turn-slice-only]").forEach((node) => {
    const slot = node.closest(".flight-slot[data-aircraft]");
    const climb = followedChoice(slot, "semEnd", leadSem) === "CLIMB";
    const slice = followedChoice(slot, "semTurnType", leadTurn) === "SLICE";
    node.hidden = (node.hasAttribute("data-csem-only") && !climb)
      || (node.hasAttribute("data-level-sem-only") && climb)
      || (node.hasAttribute("data-sem-turn-level-only") && slice)
      || (node.hasAttribute("data-sem-turn-slice-only") && !slice);
  });
}
document.addEventListener("change", (event) => {
  if (event.target?.matches?.('[data-key="semEnd"], [data-flight-field="semEnd"], [data-key="semTurnType"], [data-flight-field="semTurnType"]')) syncSemFields();
});

function renderSemFragmentReadouts(box, result) {
  syncSemFields();
  // The level turn's AUTO bank as flown (BDP v0.4.3 public.sem.turn).
  const turn = result?.profile?.public?.sem?.turn;
  box?.closest(".section")?.querySelectorAll("[data-sem-turn-auto-bank]").forEach((node) => {
    node.textContent = turn?.bankAuto ? `AUTO · ${formatDeg(turn.bankDeg)}°` : "AUTO";
  });
  if (!box) return;
  box.hidden = !developerMode;
  if (!box.children.length) box.innerHTML = semFragmentReadoutsMarkup();
  const set = (key, text) => { const node = box.querySelector(`[data-sem-readout="${key}"]`); if (node) node.textContent = text; };
  const f = result?.profile?.public?.fragment;
  if (!f?.raw) { FRAGMENT_DEV_ROWS.forEach(([key]) => set(key, "-")); return; }
  set("lateral", `L ${formatFt(f.raw.rangeFt)} ft / R ${formatFt(f.raw.rangeFt)} ft · 2R ${formatFt(2 * f.raw.rangeFt)} ft`);
  set("height", `${formatFt(f.raw.maximumAltitudeAglFt)} ft AGL`);
  set("duration", `${formatSecTenths(f.raw.timeSec)} s`);
  set("envelope", `H ${formatFt(f.heightAglFt)} ft · R ${formatFt(f.radiusFt)} ft · ${f.marginPercent}% on ${f.marginAppliesTo === "HEIGHT" ? "height only" : "height and radius"}`);
}

function followerExtraField(key, label, { always = false, fullBdp = false, attrs = "" } = {}) {
  const className = always ? `field${fullBdp ? " bdp-extra" : ""}` : "field advanced-only bdp-extra";
  const tag = always ? "" : ` <span class="adv-tag">ADV</span>`;
  return `<label class="${className}"${attrs}><span>${label}${tag}</span><input data-flight-field="${key}" type="text" inputmode="decimal"><span class="unit" data-follow-note></span></label>`;
}
// SEM End (owner handoff 2026-10-18 §6): this aircraft's, or its element lead's while "Follow" (blank); with the
// CSEM its Target FPA (blank follows the lead too).
function followerSemFields(number, { always = false } = {}) {
  const className = always ? "field bdp-extra" : "field advanced-only bdp-extra";
  const tag = always ? "" : ` <span class="adv-tag">ADV</span>`;
  return `<label class="${className}"><span>SEM End${tag}</span><select data-flight-field="semEnd"><option value="">Follow #${elementLeadNumber(number)}</option><option value="LEVEL">Level (FPA 0°, then 1 G)</option><option value="CLIMB">CSEM (climb to Target FPA)</option></select><span class="unit">Every BDP view and S&amp;R fly this SEM</span></label>`
    + followerExtraField("csemTargetFpaDeg", "CSEM Target FPA (deg)", { always, fullBdp: always, attrs: " data-csem-only" });
}
// Level SEM turn (owner 2026-10-19): its type and numbers follow the element lead while blank / "Follow"; the
// direction is this aircraft's own (blank: its Roll-in side). index wraps these in a group of its own (data-level-sem-only);
// Standard marks each field.
function followerSemTurnFields(number, { always = false } = {}) {
  const className = always ? "field bdp-extra" : "field advanced-only bdp-extra";
  const tag = always ? "" : ` <span class="adv-tag">ADV</span>`;
  const level = always ? "" : " data-level-sem-only";
  const extra = (key, label, attrs = "") => followerExtraField(key, label, { always, fullBdp: always, attrs: `${level}${attrs}` });
  return `<label class="${className}"${level}><span>SEM Turn${tag}</span><select data-flight-field="semTurnType"><option value="">Follow #${elementLeadNumber(number)}</option><option value="LEVEL">Level turn (bank AUTO)</option><option value="SLICE">Slice (entered bank, descends)</option></select><span class="unit">Right at the level-off · speed and G held</span></label>`
    + `<label class="${className}"${level}><span>Turn Direction${tag}</span><select data-flight-field="semTurnDirection"><option value="">Roll-in direction</option><option value="LEFT">Left</option><option value="RIGHT">Right</option></select><span class="unit">This aircraft's own · blank: its Roll-in side</span></label>`
    + extra("semTurnDeg", "Turn Amount (deg)")
    + extra("semTurnG", "Turn G (G)")
    + extra("semTurnSpeedKcas", "Turn Speed (KCAS)")
    + `<label class="${className}"${level} data-sem-turn-level-only><span>Turn Bank${tag}</span><output data-sem-turn-auto-bank>AUTO</output><span class="unit">Level turn: acos(1/G)</span></label>`
    + extra("semTurnBankDeg", "Turn Bank (deg)", " data-sem-turn-slice-only");
}

// Same Text / Size / Reset / PNG / Advanced toolbar as Top View #1, scoped to one follower.

function followerDraftMarkup(number) {
  const leadNumber = elementLeadNumber(number);
  return [
    flightSection(number, "Formation", `<p class="flight-draft-note">Position relative to #${leadNumber} · display only, not yet fed into geometry.</p>${followerFormationMarkup(leadNumber)}`),
    flightSection(number, "BDP", `<p class="flight-draft-note">Aircraft #${number} input draft · profile calculation is not connected.</p><label class="field flight-weapon-field"><span>Bomb</span><select data-flight-field="weaponId"></select></label>`),
    flightSection(number, "Offset", `<p class="flight-draft-note">Aircraft #${number} Offset draft · align to #${leadNumber}. Inputs and results are not connected yet.</p>`),
    flightSection(number, "Z-Diagram", `<p class="flight-draft-note">Aircraft #${number} diagram is pending its profile result.</p>`, { heading: offsetZDiagramTitle({ aircraftNumber: number }) }),
    flightSection(number, "Top View", `<p class="flight-draft-note">Leader #1 is the reference. Aircraft #${number} overlay is pending.</p>`, { heading: offsetTopViewTitle({ aircraftNumber: number }) }),
    flightSection(number, "Result", `<p class="flight-draft-note">No calculated result for aircraft #${number}.</p>`),
    flightSection(number, "DED", `<p class="flight-draft-note">Aircraft #${number} DED is pending its profile result.</p>`),
  ].join("");
}

// Common Formation row (L/R + Bearing from the reference aircraft's tail, Range) on one line.
function followerFormationMarkup(leadNumber) {
  return formationPositionMarkup({ attribute: "data-flight-field", keys: { side: "side", bearing: "bearingDeg", range: "distanceNm" }, referenceLabel: `#${leadNumber}` });
}

function followerCalculatingMarkup(number) {
  const leadNumber = elementLeadNumber(number);
  const predecessor = number - 1;
  const wingman = FLIGHT_WINGMEN.has(number);
  const field = {
    weapon: `<label class="field flight-weapon-field"><span>Bomb</span><select data-flight-field="weaponId"></select></label>`,
    initialSpeed: `<label class="field"><span>Initial Speed (KCAS)</span><input data-flight-field="initialSpeedValue" type="text" inputmode="decimal"></label>`,
    initialAltitude: `<label class="field"><span class="lock-title"><span>Initial Altitude (ft MSL)</span><button class="lock-button" type="button" data-flight-field="rollInAltitudeLinked" aria-label="Link Initial Altitude to Roll-in Altitude" aria-pressed="true">LINKED</button></span><input data-flight-field="initialAltitudeMslFt" type="text" inputmode="decimal"><span class="unit" data-initial-link-note>Linked to Roll-in Altitude</span></label>`,
    rollInAltitude: `<label class="field"><span>Roll-in Altitude (ft MSL)</span><input data-flight-field="rollInAltitudeMslFt" type="text" inputmode="decimal"><span class="unit">BDP entry altitude</span></label>`,
    dive: `<label class="field"><span class="lock-title"><span>Dive Angle (deg)</span><button class="lock-button" type="button" data-flight-field="diveAngleLocked" aria-label="Lock Dive Angle" aria-pressed="false">LOCK</button></span><input data-flight-field="diveAngleDeg" type="text" inputmode="decimal"></label>`,
    tracking: `<label class="field"><span>Tracking Time (sec)</span><input data-flight-field="trackingTimeSec" type="text" inputmode="decimal"><span class="unit">Track Point → Release · 0.1 s</span></label>`,
    releaseAltitude: `<label class="field"><span>Release Altitude (ft MSL)</span><input data-flight-field="releaseAltitudeMslFt" type="text" inputmode="decimal"></label>`,
    releaseSpeed: `<label class="field"><span>Release Speed (KCAS)</span><input data-flight-field="releaseSpeedKcas" type="text" inputmode="decimal"></label>`,
    runIn: `<label class="field"><span>Run-In Heading</span><output data-flight-readout="runInHeadingDeg">-</output><span class="unit">Follows #1 · parallel Run-In</span></label>`,
    ipRange: `<label class="field"><span>IP Range from Target</span><output data-flight-readout="ipRangeFromTargetNm">-</output><span class="unit">NM · from Formation position</span></label>`,
    attack: `<label class="field"><span class="lock-title"><span>Attack Heading (deg)</span><button class="lock-button" type="button" data-flight-field="attackHeadingLocked" aria-label="Lock Attack Heading" aria-pressed="false">LOCK</button></span><input data-flight-field="attackHeadingDeg" type="text" inputmode="decimal"></label>`,
    angleOff: `<label class="field"><span class="lock-title"><span>Angle-Off (deg)</span><button class="lock-button" type="button" data-flight-field="angleOffLocked" aria-label="Lock Angle-Off" aria-pressed="false">LOCK</button></span><input data-flight-field="angleOffDeg" type="text" inputmode="decimal"></label>`,
    offsetAngle: `<label class="field"><span class="lock-title"><span>Offset Angle (deg)</span><span class="lock-group"><button class="lock-button" type="button" data-flight-field="offsetAngleLocked" aria-pressed="false">LOCK</button>${wingman ? `<button class="lock-button" type="button" data-flight-field="sameAngleAsLead" aria-pressed="false" title="Align Offset Angle to #${leadNumber}">ANGLE #${leadNumber}</button>` : ""}</span></span><input data-flight-field="offsetAngleDeg" type="text" inputmode="decimal"></label>`,
    actionRange: `<label class="field"><span class="lock-title"><span>Action Range (NM)</span><span class="lock-group"><button class="lock-button" type="button" data-flight-field="actionRangeLocked" aria-pressed="false">LOCK</button>${wingman ? `<button class="lock-button" type="button" data-flight-field="sameTimeAsLead" aria-pressed="false" title="Align Action timing to #${leadNumber}">TIME #${leadNumber}</button>` : ""}</span></span><input data-flight-field="actionRangeNm" type="text" inputmode="decimal"><span class="unit">Target → Action Point</span></label>`,
    approachRange: `<label class="field"><span class="lock-title"><span>Approach Range (NM)</span><button class="lock-button" type="button" data-flight-field="approachRangeLocked" aria-label="Lock Approach Range" aria-pressed="false">LOCK</button></span><input data-flight-field="approachRangeNm" type="text" inputmode="decimal"><span class="unit">Offset Turn End → Roll-in Start</span></label>`,
    approachingHeading: `<label class="field"><span>Approaching Heading</span><output data-flight-readout="offsetHeadingDeg">-</output><span class="unit">Offset Turn completion → Roll-in Start</span></label>`,
  };
  const statusHead = `<div class="section-head"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div>`;
  const statusLine = `<div id="flight-status-${number}" class="status-message valid">-</div>`;
  const group = (title, content) => `<h3 class="input-group-title">${title}</h3><div class="input-grid">${content}</div>`;
  // index Offset tab groups fold like #1's (owner 2026-10-12); Roll-in Condition starts folded.
  const foldGroup = (title, content, open = true) => `<details class="input-group-panel"${open ? " open" : ""}><summary class="input-group-title">${title}</summary><div class="input-grid">${content}</div></details>`;
  // Roll-in Altitude LOCK (index): a Tracking Time entry then moves Release Altitude.
  const rollInLocked = `<label class="field"><span class="lock-title"><span>Roll-in Altitude (ft MSL)</span><button class="lock-button" type="button" data-flight-field="rollInAltitudeLocked" aria-label="Lock Roll-in Altitude" aria-pressed="false">LOCK</button></span><input data-flight-field="rollInAltitudeMslFt" type="text" inputmode="decimal"><span class="unit">BDP entry altitude</span></label>`;
  // index (handoff 2026-10-06 §4): the frequently edited profile sits with the Offset geometry; the
  // BDP tab holds the settings (Target / Wind shared with #1, Bomb, Roll-in condition, SEM). Standard
  // keeps the earlier grouping. Same draft keys either way.
  const inputSections = INDEX_LAYOUT ? [
    flightSection(number, "BDP", `<div class="input-grid"><label class="field"><span>Target Elevation (ft MSL)</span><output data-flight-readout="targetElevationMslFt">-</output><span class="unit">Shared with #1</span></label>${field.weapon}</div>${group("Wind", `<label class="field"><span>Wind FROM / Speed</span><output data-flight-readout="wind">-</output><span class="unit">Shared with #1 · TRUE FROM</span></label>`)}<div class="bdp-full-group">${group("Roll-in / Turn Onset", ONSET_FIELDS.map(([key, label]) => followerExtraField(key, label, { always: true, fullBdp: true })).join(""))}${group("SEM / Recovery", `${followerSemFields(number, { always: true })}${followerExtraField("recoveryG", "Recovery G (G)", { always: true, fullBdp: true })}${followerExtraField("gOnsetTimeSec", "G Onset Time (sec)", { always: true, fullBdp: true })}${followerExtraField("speedOvershootKcas", "Speed Overshoot (KCAS)", { always: true, fullBdp: true })}${followerExtraField("fragmentHeightMarginPercent", "Fragment Height Margin (%)", { always: true, fullBdp: true })}`)}<h3 class="input-group-title" data-level-sem-only>SEM Turn</h3><div class="input-grid" data-level-sem-only>${followerSemTurnFields(number, { always: true })}</div><div data-sem-readouts></div></div>`, { calculating: true, tab: "bdp" }),
    flightSection(number, "Offset", `${statusHead}${foldGroup("BDP Profile", `${field.initialSpeed}${field.initialAltitude}${rollInLocked}${field.dive}${field.tracking}${field.releaseAltitude}${field.releaseSpeed}`)}${foldGroup("Offset Geometry", `${field.runIn}${field.ipRange}${field.angleOff}${field.attack}${field.offsetAngle}${field.actionRange}${field.approachRange}${field.approachingHeading}`)}${foldGroup("Roll-in Condition", `${followerResultField("rollInBankAngleDeg", "Roll-in Bank Angle (deg)", { always: true })}${followerExtraField("rollInG", "Roll-in G (G)", { always: true })}`, false)}${statusLine}`, { calculating: true, tab: "offset" }),
  ] : [
    flightSection(number, "BDP", `<div class="input-grid">${field.weapon}${field.initialSpeed}${field.initialAltitude}${field.rollInAltitude}${field.dive}${field.tracking}${field.releaseAltitude}${field.releaseSpeed}${followerResultField("rollInBankAngleDeg", "Roll-in Bank Angle (deg)")}${followerExtraField("rollInG", "Roll-in G (G)")}${ONSET_FIELDS.map(([key, label]) => followerExtraField(key, label)).join("")}${followerExtraField("fragmentHeightMarginPercent", "Fragment Height Margin (%)")}${followerSemFields(number)}${followerExtraField("recoveryG", "Recovery G (G)")}${followerExtraField("speedOvershootKcas", "Speed Overshoot (KCAS)")}${followerExtraField("gOnsetTimeSec", "G Onset Time (sec)")}${followerSemTurnFields(number)}</div><div data-sem-readouts></div><p class="flight-draft-note">Target Elevation and Wind are shared with #1 (same Target).</p>`, { calculating: true, tab: "bdp" }),
    flightSection(number, "Offset", `${statusHead}<div class="input-grid">${field.runIn}${field.ipRange}${field.attack}${field.angleOff}${field.offsetAngle}${field.actionRange}${field.approachRange}${field.approachingHeading}</div>${statusLine}`, { calculating: true, tab: "offset" }),
  ];
  return [
    flightSection(number, "Formation", `<p class="flight-draft-note">Start point relative to #${leadNumber}'s own IP; feeds this aircraft's Run-In line.</p>${followerFormationMarkup(leadNumber)}`, { calculating: true, tab: "formation" }),
    ...inputSections,
    // View order (user 2026-10-02): BDP Top View, BDP Profile, Z-Diagram; the Offset Top View is the
    // one Flight view under #1 (user 2026-10-05). The two BDP views show only while its Full is on.
    `<div class="bdp-views" data-bdp-views="${number}" data-output-aircraft="${number}" data-aircraft-output="bdp">${offsetBdpDiagramsMarkup(number)}</div>`,
    flightSection(number, "Z-Diagram", `<div class="diagram-actions"><div class="diagram-action-row"><button class="capture-button" type="button" data-flight-z-png>PNG</button>${zAdvancedMarkup(number)}</div></div><div class="z-diagram-shell"><svg data-flight-z viewBox="0 0 650 710" role="img" aria-label="${offsetZDiagramTitle({ aircraftNumber: number })}"><g data-z-root></g></svg></div>`, { calculating: true, heading: offsetZDiagramTitle({ aircraftNumber: number }), output: "z" }),
    // Same variables as Result #1 first (same groups and order), then what only this aircraft has.
    flightSection(number, "Result", `<div class="compact-results" data-flight-result-panel><div class="result-panel-head"><span></span><div data-result-controls aria-label="Result #${number} display controls"></div></div><div class="result-panel-body"><div data-result-group><h3>Offset</h3><table><tbody class="result-rows" data-flight-result="offset"></tbody></table></div><div data-result-group><h3>Bomb Profile</h3><table><tbody class="result-rows" data-flight-result="profile"></tbody></table></div><div data-result-group><h3>#${number} vs #${predecessor}</h3><table><tbody class="result-rows" data-flight-result="flight"></tbody></table></div><p data-result-empty>No available summary results.</p></div></div>`, { calculating: true, output: "result" }),
    FLIGHT_DED_AIRCRAFT.has(number)
      ? flightSection(number, "DED", followerDedMarkup(), { calculating: true, output: "ded", tools: `<button class="btn ded-png-button" type="button" data-ded-png="${number}">PNG</button>` })
      : flightSection(number, "DED", `<p class="flight-draft-note">Aircraft #${number} DED is pending its profile result.</p>`, { output: "ded" }),
  ].join("");
}

// Same two green boxes as DED #1: the reference page (VRP or VIP, following #1's Reference Point
// mode) and OA1.
function followerDedMarkup() {
  // OA1 reads RNG, TBRG, ELEV (user 2026-10-02); the VRP / VIP page keeps TBRG, RNG, ELEV.
  const rows = (page) => (page === "oa1" ? ["range:RNG", "bearing:TBRG", "elevation:ELEV"] : ["bearing:TBRG", "range:RNG", "elevation:ELEV"]).map((item) => {
    const [key, label] = item.split(":");
    return `<div class="ded-row"><span>${label}</span><output data-flight-ded="${page}-${key}">-</output></div>`;
  }).join("");
  return `<div class="ded-boxes"><div class="ded-screen" aria-live="polite"><div class="ded-page-title" data-flight-ded="reference-title">VRP</div>${rows("reference")}</div><div class="ded-screen" aria-live="polite"><div class="ded-page-title">OA1</div>${rows("oa1")}</div></div>`;
}

// Follower LOCK / ANGLE #n / TIME #n buttons share #1's LOCK button format: pressed state via
// aria-pressed, and a LOCK reads LOCKED while on (same as installLocks on #1).
const FOLLOWER_LOCK_KEYS = new Set(FOLLOWER_LOCK_OPTIONS.filter((key) => key.endsWith("Locked")));
function syncFlightToggleButton(button, on) {
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("active", on);
  if (FOLLOWER_LOCK_KEYS.has(button.dataset.flightField)) button.textContent = on ? "LOCKED" : "LOCK";
  if (button.dataset.flightField === "rollInAltitudeLinked") {
    button.textContent = on ? "LINKED" : "LINK";
    const note = button.closest(".field")?.querySelector("[data-initial-link-note]");
    if (note) note.textContent = on ? "Linked to Roll-in Altitude" : "Reference only (not linked)";
  }
}

function initializeFlightSlotFields(slot, number) {
  const draft = flightDraft(number);
  const weapon = slot.querySelector('[data-flight-field="weaponId"]');
  weapon.replaceChildren(...[...firstField("weaponId").options].map((option) => option.cloneNode(true)));
  slot.querySelectorAll("[data-flight-field]").forEach((field) => {
    const draftValue = draft[field.dataset.flightField];
    if (field.type === "checkbox") field.checked = draftValue === true;
    else field.value = String(draftValue ?? "");
  });
  slot.querySelectorAll(".lock-button[data-flight-field]").forEach((button) => {
    syncFlightToggleButton(button, draft[button.dataset.flightField] === true);
  });
}

function renderFlightLayout({ fresh = false } = {}) {
  const host = $("#flight-followers");
  $("#flight-size").value = String(flightLayout.size);
  // Follower outputs the index layout moved out of their slot go with the slot.
  document.querySelectorAll("[data-output-aircraft]").forEach((node) => {
    if (node.dataset.outputAircraft !== "1") node.remove();
  });
  host.replaceChildren();
  for (let number = 2; number <= flightLayout.size; number += 1) {
    const slot = document.createElement("div");
    slot.className = "flight-slot";
    slot.dataset.aircraft = String(number);
    slot.innerHTML = FLIGHT_CALCULATING_AIRCRAFT.has(number) ? followerCalculatingMarkup(number) : followerDraftMarkup(number);
    host.append(slot);
    initializeFlightSlotFields(slot, number);
  }
  installFormationSideSelects(host);
  installSectionDisclosure();
  installSectionTools(host);
  host.querySelectorAll(".flight-slot").forEach((slot) => installFollowerTopViewControls(Number(slot.dataset.aircraft), slot));
  host.querySelectorAll(".flight-slot").forEach((slot) => applyFullViews(Number(slot.dataset.aircraft)));
  host.querySelectorAll("[data-z-advanced]").forEach(syncZAdvancedButton);
  // Result #n gets the same Text / Advanced controls as Result #1 (summary rows by default).
  followerResultPanels.clear();
  host.querySelectorAll(".flight-slot").forEach((slot) => {
    const panel = slot.querySelector("[data-flight-result-panel]");
    if (panel) followerResultPanels.set(Number(slot.dataset.aircraft), installResultPanel(panel));
  });
  if (persistenceReady) {
    if (fresh) recalculateFresh();
    else calculate();
  }
}

// One follower draft record from storage (work save or developer preset): known keys only, typed,
// blank Full BDP extras kept blank (= follow #1).
function normalizeFlightDraft(number, record, fallback) {
  const str = (key) => typeof record[key] === "string" ? record[key] : fallback[key];
  return {
    weaponId: typeof record.weaponId === "string" ? record.weaponId : fallback.weaponId,
    ...Object.fromEntries(Object.keys(FOLLOWER_CHOICES).map((key) => [key, followerChoice(key, record[key])])),
    side: record.side === "RIGHT" ? "RIGHT" : "LEFT",
    bearingDeg: str("bearingDeg"),
    distanceNm: str("distanceNm"),
    initialSpeedValue: str("initialSpeedValue"),
    initialAltitudeMslFt: str("initialAltitudeMslFt"),
    rollInAltitudeMslFt: str("rollInAltitudeMslFt"),
    rollInAltitudeLinked: record.rollInAltitudeLinked !== false,
    diveAngleDeg: str("diveAngleDeg"),
    trackingTimeSec: str("trackingTimeSec"),
    solveMode: record.solveMode === "time" || record.solveMode === "release" ? record.solveMode : "height",
    // Last entered Tracking Time (a height-mode field holds a derived value); older saves
    // fall back to the field in time mode, else the default.
    enteredTrackingTimeSec: typeof record.enteredTrackingTimeSec === "string"
      ? record.enteredTrackingTimeSec
      : record.solveMode === "time" ? str("trackingTimeSec") : "18",
    ...Object.fromEntries(FOLLOWER_BDP_EXTRA_KEYS.map((key) => [key, typeof record[key] === "string" ? record[key] : ""])),
    releaseAltitudeMslFt: str("releaseAltitudeMslFt"),
    releaseSpeedKcas: str("releaseSpeedKcas"),
    attackHeadingDeg: str("attackHeadingDeg"),
    angleOffDeg: str("angleOffDeg"),
    offsetAngleDeg: str("offsetAngleDeg"),
    // Action Range is Target-referenced since 2026-09-26; an old IP-referenced value is
    // not carried over (different meaning), so the default applies.
    actionRangeNm: str("actionRangeNm"),
    approachRangeNm: str("approachRangeNm"),
    ...Object.fromEntries(FOLLOWER_LOCK_OPTIONS.map((key) => [key, record[key] === true])),
    driver: FLIGHT_TACTICAL_DRIVERS.includes(record.driver) ? record.driver : "actionRangeNm",
    solved: normalizeSolvedValues(record),
  };
}

// Full values saved behind a draft's rounded text; kept only while the text still shows them.
function normalizeSolvedValues(record) {
  const solved = record.solved && typeof record.solved === "object" && !Array.isArray(record.solved) ? record.solved : {};
  return Object.fromEntries(Object.entries(solved).filter(([key, entry]) => entry && typeof entry.text === "string" && Number.isFinite(entry.value) && record[key] === entry.text)
    .map(([key, entry]) => [key, { text: entry.text, value: entry.value }]));
}

function installFlightLayout() {
  try {
    const saved = restoredWorkSave.flight;
    if (saved && Number.isInteger(saved.size) && saved.size >= 1 && saved.size <= 4) {
      flightLayout.size = saved.size;
      const shown = Array.isArray(saved.view?.shownAircraft) ? saved.view.shownAircraft.filter((number) => Number.isInteger(number) && number >= 1 && number <= saved.size) : [];
      if (Array.isArray(saved.view?.shownAircraft)) { topViewAircraft.clear(); shown.forEach((number) => topViewAircraft.add(number)); }
      const edit = saved.view?.editAircraft;
      loadedSave = { savedAt: typeof saved.savedAt === "string" ? saved.savedAt : null, editAircraft: Number.isInteger(edit) && edit >= 1 && edit <= saved.size ? edit : 1, record: saved };
      if (saved.aircraft && typeof saved.aircraft === "object" && !Array.isArray(saved.aircraft)) {
        for (const number of [2, 3, 4]) {
          const record = saved.aircraft[number];
          if (!record || typeof record !== "object" || Array.isArray(record)) continue;
          flightLayout.aircraft[number] = normalizeFlightDraft(number, record, flightDraft(number));
        }
      }
    } else if (!saved) {
      // No work save: the developer preset's Flight size (its drafts come through flightDraft).
      const preset = readDefaultPreset();
      if (preset) flightLayout.size = preset.flight.size;
    }
  } catch {
    // Ignore malformed or unavailable presentation-only storage.
  }
  $("#flight-size").addEventListener("change", (event) => {
    flightLayout.size = Math.max(1, Math.min(4, Number(event.target.value) || 1));
    pruneVisibleAircraft();
    renderFlightLayout();
  });
  const flightSlotNumber = (node) => {
    const number = Number(node?.closest?.(".flight-slot")?.dataset.aircraft);
    return Number.isInteger(number) && number >= 2 && number <= 4 ? number : null;
  };
  // Follower edits store the entered text and pass the raw event; LINK, solve mode, whole-second
  // Tracking Time, driver and option exclusivity are the BE's (AG SPEC "Flight entrypoint").
  const updateFlightDraft = (event) => {
    const field = event.target.closest?.("[data-flight-field]");
    const number = flightSlotNumber(field);
    if (!field || !number) return;
    const key = field.dataset.flightField;
    const selection = field.tagName === "SELECT" || field.type === "checkbox";
    // A selection is computed when it changes (its input event adds nothing).
    if (selection && event.type !== "change") return;
    if (key === "initialAltitudeMslFt" && isDeveloperCommand(field)) {
      if (event.type === "change") runDeveloperCommand(field);
      return;
    }
    if (event.type === "change" && !selection && enterCommitted(field)) return;
    if (event.type === "input") enterCommit = null;
    if (FOLLOWER_BDP_EXTRA_KEYS.includes(key)) {
      if (event.type !== "input" && unchangedFollowingField(field)) return;
      delete field.dataset.following;
    }
    const draft = flightDraft(number);
    // Empty-field commit, same rule as #1: blank inherited BDP values keep meaning "follow the lead".
    if (!selection && field.value.trim() === "" && !FOLLOWER_BDP_EXTRA_KEYS.includes(key)) {
      if (event.type === "change") fillEmptyFollowerField(number, key);
      else calculationScheduler.hold();
      return;
    }
    draft[key] = field.type === "checkbox" ? field.checked : field.value;
    lastEditedField.set(number, key);
    dropSolvedIfEdited(draft.solved, key, field.value);
    const edit = { aircraft: number, kind: "set", key, commit: event.type !== "input" };
    if (selection || event.type === "enter") calculate(edit);
    else if (event.type === "input") calculateLater(edit);
    else calculateCommit(edit);
  };
  $("#flight-followers").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const field = event.target.closest?.("input[data-flight-field]");
    if (!field || field.type === "checkbox" || !flightSlotNumber(field)) return;
    // A cleared BDP extra follows again at once and shows the followed value (focus stays).
    if (field.value.trim() === "" && FOLLOWER_BDP_EXTRA_KEYS.includes(field.dataset.flightField)) {
      field.dataset.refill = "true";
      updateFlightDraft({ type: "enter", target: field });
      return;
    }
    if (field.value.trim() === "") return;
    if (field.dataset.flightField === "initialAltitudeMslFt" && isDeveloperCommand(field)) return;
    updateFlightDraft({ type: "enter", target: field });
    enterCommit = { field, text: field.value };
  });
  $("#flight-followers").addEventListener("focusin", (event) => {
    const field = event.target.closest?.("input[data-flight-field]");
    const number = flightSlotNumber(field);
    if (!field || !number) return;
    const key = field.dataset.flightField;
    const draft = flightDraft(number);
    followerEditStart = { number, key, value: parsedFieldValue(field.value, draft.solved?.[key]), driver: draft.driver };
    if (key === "initialAltitudeMslFt") rememberDeveloperEditStart(field);
  });
  $("#flight-followers").addEventListener("input", updateFlightDraft);
  $("#flight-followers").addEventListener("change", updateFlightDraft);
  $("#flight-followers").addEventListener("click", (event) => {
    const button = event.target.closest?.(".lock-button[data-flight-field]");
    const number = flightSlotNumber(button);
    if (!button || !number) return;
    const key = button.dataset.flightField;
    calculate({ aircraft: number, kind: "toggle", key, value: toggledValue(number, "toggle", key, flightDraft(number)[key] === true) });
  });
  renderFlightLayout();
}

// Follower counterpart of fillEmptyLeadField: the value and driver from the start of the edit and
// the last entered (else default) value go to the BE, which refills the field.
let followerEditStart = null;

function fillEmptyFollowerField(number, key) {
  const draft = flightDraft(number);
  const start = followerEditStart?.number === number && followerEditStart.key === key ? followerEditStart : null;
  const fallback = Number.parseFloat(draft[key] ?? defaultFlightDraft(number)[key]);
  const defaultValue = Number.parseFloat(defaultFlightDraft(number)[key]);
  calculate({
    aircraft: number, kind: "clear", key, commit: true,
    before: start ? { value: start.value, driver: start.driver } : undefined,
    fallbackValue: Number.isFinite(fallback) ? fallback : Number.isFinite(defaultValue) ? defaultValue : null,
  });
}

function followerField(slot, key) {
  return slot.querySelector(`[data-flight-field="${key}"]`);
}

function followerSlot(number) {
  return document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
}

// Follower input record for the BE: the field text when the slot is shown, else the draft (Full
// value behind a rounded solved text, blank = null = follow the element lead for the BDP extras).
const FOLLOWER_VALUE_KEYS = ["weaponId", "initialSpeedValue", "initialAltitudeMslFt", "rollInAltitudeMslFt", "diveAngleDeg", "trackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas", "attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm", ...FOLLOWER_BDP_EXTRA_KEYS];
function collectFollowerRecord(number) {
  const draft = flightDraft(number);
  const slot = followerSlot(number);
  const text = (key) => (slot ? followerField(slot, key)?.value : undefined) ?? draft[key];
  const read = (key) => parsedFieldValue(text(key), draft.solved?.[key]);
  const values = Object.fromEntries(FOLLOWER_VALUE_KEYS.map((key) => [key, read(key)]));
  // A BDP extra that follows its lead shows the applied value in its field, but it is blank (null)
  // in the draft; the draft is what counts for these (a typed value reaches it on input).
  FOLLOWER_BDP_EXTRA_KEYS.forEach((key) => { values[key] = parsedFieldValue(draft[key], draft.solved?.[key]); });
  values.weaponId = text("weaponId") || draft.weaponId;
  // Blank SEM End / SEM Turn = follow the element lead; blank Turn Direction = own Roll-in side (the BE resolves them).
  Object.keys(FOLLOWER_CHOICES).forEach((key) => { values[key] = followerChoice(key, draft[key]) || null; });
  const entered = Number.parseFloat(draft.enteredTrackingTimeSec);
  return {
    values,
    formation: { side: text("side") === "RIGHT" ? "RIGHT" : "LEFT", bearingDeg: read("bearingDeg"), distanceNm: read("distanceNm") },
    options: Object.fromEntries(FOLLOWER_LOCK_OPTIONS.map((key) => [key, draft[key] === true])),
    state: { driver: draft.driver, solveMode: draft.solveMode, enteredTrackingTimeSec: Number.isFinite(entered) ? entered : null, rollInAltitudeLinked: draft.rollInAltitudeLinked !== false },
  };
}

// Writes a follower's returned state: changed values (display text, Full value in draft.solved; a
// field being typed in keeps its text until committed), options, LINK and the stored state.
function applyFollowerState(number, record, sent, activeKey, commit) {
  const draft = flightDraft(number);
  const slot = followerSlot(number);
  const active = document.activeElement;
  draft.solved ||= {};
  const write = (key, value) => {
    if (typeof value !== "number") return;
    const text = fieldDisplayText(key, value);
    const field = slot ? followerField(slot, key) : null;
    if (field && field === active && !(commit && key === activeKey)) return;
    if (field) field.value = text;
    draft[key] = text;
    draft.solved[key] = { text, value };
  };
  Object.entries(record.values).forEach(([key, value]) => {
    if (sameStateValue(value, sent.values[key]) && !(commit && key === activeKey && REFORMAT_ON_COMMIT.has(key))) return;
    // A BDP extra the BE returned to "follow" (null).
    if (value === null && FOLLOWER_BDP_EXTRA_KEYS.includes(key)) {
      draft[key] = "";
      delete draft.solved[key];
      return;
    }
    write(key, value);
  });
  ["bearingDeg", "distanceNm"].forEach((key) => { if (!sameStateValue(record.formation[key], sent.formation[key])) write(key, record.formation[key]); });
  Object.entries(record.options).forEach(([key, on]) => { draft[key] = on; });
  draft.driver = record.state.driver;
  draft.solveMode = record.state.solveMode;
  draft.enteredTrackingTimeSec = String(record.state.enteredTrackingTimeSec);
  draft.rollInAltitudeLinked = record.state.rollInAltitudeLinked;
  slot?.querySelectorAll(".lock-button[data-flight-field]").forEach((button) => syncFlightToggleButton(button, draft[button.dataset.flightField] === true));
}

// Follower BDP extras (2026-10-12, user: #2–#4 Roll-in Condition looked locked): a field left to
// follow shows the applied value in the field like any input, and its note says it follows the element
// lead. Typing over it gives the aircraft its own value; clearing it follows again. (The Roll-in Bank is
// no longer an extra: it is BDP v0.4's result, owner 2026-10-15.)
const FOLLOWER_EXTRA_DIGITS = { fragmentHeightMarginPercent: 0, recoveryG: 1, speedOvershootKcas: 0, gOnsetTimeSec: 1, rollInG: 1, rollInRollRateDegSec: 0, rollOutRollRateDegSec: 0, gOnsetRateGSec: 1, csemTargetFpaDeg: 0, semTurnDeg: 0, semTurnG: 1, semTurnSpeedKcas: 0, semTurnBankDeg: 0 };
// What a blank (followed) entry means when the lead's is blank too.
const FOLLOWER_EXTRA_PLACEHOLDERS = { semTurnG: "Recovery G", semTurnSpeedKcas: "Level-off" };
const followerExtraText = (key, value) => String(Number(value.toFixed(FOLLOWER_EXTRA_DIGITS[key])));
function syncFollowerExtraFields(slot, entry, result, leadNumber) {
  const number = Number(slot.dataset.aircraft);
  const draft = flightDraft(number);
  const inputs = result.profile.canonicalInputs;
  FOLLOWER_BDP_EXTRA_KEYS.forEach((key) => {
    const field = followerField(slot, key);
    if (!field) return;
    const value = inputs[key];
    const source = entry.inheritance?.[key]?.source;
    const following = String(draft[key] ?? "").trim() === "";
    const note = field.closest(".field")?.querySelector("[data-follow-note]");
    if (note) note.textContent = following ? `Follows #${leadNumber}` : `Own value · clear to follow #${leadNumber}`;
    field.placeholder = FOLLOWER_EXTRA_PLACEHOLDERS[key] ?? "";
    if (!following || !Number.isFinite(value)) {
      delete field.dataset.refill;
      delete field.dataset.following;
      delete field.dataset.followingText;
      return;
    }
    field.dataset.following = "true";
    field.dataset.followingText = followerExtraText(key, value);
    if (field !== document.activeElement || field.dataset.refill) field.value = field.dataset.followingText;
    delete field.dataset.refill;
  });
  // The tab holding Initial Altitude (Standard: BDP, index: Offset) shows the solve mode.
  const section = followerField(slot, "initialAltitudeMslFt")?.closest(".section");
  if (section) section.dataset.solveMode = draft.solveMode === "time" ? "time" : "height";
}

// A following extra field committed without a change (focus + Enter / Tab) stays following.
const unchangedFollowingField = (field) => field.dataset.following === "true" && field.value.trim() === field.dataset.followingText;

function renderFollowerStatus(number, state, message) {
  const pill = $(`#flight-state-pill-${number}`);
  if (pill) {
    pill.textContent = state;
    pill.className = state === "VALID" ? "status ok" : state === "WARNING" ? "status warn" : "status bad";
  }
  const status = $(`#flight-status-${number}`);
  if (status) {
    status.textContent = message ?? "-";
    status.className = `status-message ${state === "VALID" ? "valid" : state === "WARNING" ? "warning" : "invalid"}`;
  }
  markInvalidFields(number, state === "INVALID" ? [message] : []);
}

// Result #n: the same Offset / Bomb Profile variables as Result #1 first, then the variables only
// this aircraft has (drop-order timing against its predecessor). Without a result it shows the
// state and message only.
const followerResultPanels = new Map();

function renderFollowerResult(number, slot, options = {}) {
  renderFollowerResultRows(number, slot, options);
  followerResultPanels.get(number)?.refresh();
}

function renderFollowerResultRows(number, slot, { result = null, delta = null, state = "INVALID", message = "" } = {}) {
  const body = (group) => flightOutput(number, `[data-flight-result="${group}"]`);
  if (!body("offset")) return;
  if (!result) {
    body("offset").innerHTML = [row("State", state, null, { summary: true }), message ? row("Message", message, null, { summary: true }) : ""].join("");
    body("profile").innerHTML = "";
    body("flight").innerHTML = "";
    return;
  }
  const leadNumber = number - 1; // drop-order predecessor
  body("offset").innerHTML = offsetResultRows(result, { ipRangeText: `${formatNm(result.resolved.ipRangeNm)} NM · FORMATION`, keyed: false }).join("");
  body("profile").innerHTML = profileResultRows(result, { keyed: false }).join("");
  // Bomb TOF is a duration, the other three are signed deltas.
  const timing = (key, text) => `<span data-flight-timing="${key}">${Number.isFinite(delta?.[key]) ? `${text(delta[key])} sec` : "-"}</span>`;
  body("flight").innerHTML = [
    // Follower-only rows are always in the summary.
    row(`IP→Release Δ vs #${leadNumber}`, timing("ipToReleaseDeltaSec", formatSignedSec), null, { summary: true }),
    row(`IP→Impact Δ vs #${leadNumber}`, timing("ipToImpactDeltaSec", formatSignedSec), null, { summary: true }),
    row(`#${leadNumber} Impact → #${number} Release`, timing("predecessorImpactToOwnReleaseSec", formatSignedSec), null, { summary: true }),
    row(`#${leadNumber} Bomb TOF`, timing("predecessorBombTofSec", formatSec), null, { summary: true }),
  ].join("");
}

// Follower Z PNG (the follower Top View controls left with the one Flight Top View, 2026-10-05).
function installFollowerTopViewControls(number, slot) {
  const zPng = flightOutput(number, "[data-flight-z-png]");
  const zSvg = flightOutput(number, "svg[data-flight-z]");
  if (!zPng || !zSvg || zPng.dataset.installed) return;
  zPng.dataset.installed = "true";
  zPng.addEventListener("click", () => saveSvgAsPng(zSvg, `${offsetZDiagramTitle({ aircraftNumber: number }).replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" }));
}

// Offset #n Z (every aircraft, 2026-10-01). ΔTime is the drop-order delta: #(n-1) Impact − #n
// Release for #n; #1 shows #2's, so Z #1 and Z #2 carry the same ΔTime.
function zDeltaTime(releaseNumber) {
  if (releaseNumber > flightLayout.size || !FLIGHT_CALCULATING_AIRCRAFT.has(releaseNumber)) return null;
  const timing = lastFlightTiming[releaseNumber];
  const delta = flightTimingOf(releaseNumber);
  if (!delta) return null;
  return { impactNumber: timing.predecessor, releaseNumber, seconds: delta.predecessorImpactToOwnReleaseSec, impactIpToImpactSec: timing.predecessorIpToImpactSec };
}

// Z Advanced (2026-10-03): off = the Essential lower rows; per aircraft, not saved.
const zAdvancedOn = new Set();
function renderZDiagramOf(number, svg, resultFull) {
  if (!svg) return false;
  delete svg.dataset.calculationFailed;
  return renderOffsetZDiagram(svg, resultFull, { aircraftNumber: number, deltaTime: zDeltaTime(Math.max(2, number)), advanced: zAdvancedOn.has(number) });
}
function zAdvancedMarkup(number) {
  return `<button class="capture-button view-toggle" type="button" data-z-advanced="${number}" aria-pressed="false">Advanced: Off</button>`;
}
function syncZAdvancedButton(button) {
  const on = zAdvancedOn.has(Number(button.dataset.zAdvanced));
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("active", on);
  button.textContent = `Advanced: ${on ? "On" : "Off"}`;
}
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-z-advanced]");
  if (!button) return;
  const number = Number(button.dataset.zAdvanced);
  zAdvancedOn.has(number) ? zAdvancedOn.delete(number) : zAdvancedOn.add(number);
  syncZAdvancedButton(button);
  if (number === 1) {
    if (lastResultFull) renderZDiagramOf(1, $("#offset-z-svg"), lastResultFull);
  } else {
    const resultFull = flightResultsFull.get(number);
    const svg = flightOutput(number, "svg[data-flight-z]");
    if (resultFull) renderZDiagramOf(number, svg, resultFull);
  }
});

// Draws follower n from its BE entry (result or failure) and its drop-order timing.
function renderFollower(number, entry) {
  const slot = followerSlot(number);
  if (!slot) return;
  // index BDP tab: Target Elevation and Wind are #1's (shared), shown read-only here.
  const sharedTarget = slot.querySelector('[data-flight-readout="targetElevationMslFt"]');
  if (sharedTarget) sharedTarget.textContent = `${value("targetElevationMslFt") ?? "-"} ft`;
  const sharedWind = slot.querySelector('[data-flight-readout="wind"]');
  if (sharedWind) sharedWind.textContent = `${value("windDirectionDeg") ?? "-"}° / ${value("windSpeedKt") ?? "-"} kt`;
  // The tab holding Initial Altitude (Standard: BDP, index: Offset) shows the stored solve mode.
  const profileSection = followerField(slot, "initialAltitudeMslFt")?.closest(".section");
  if (profileSection) profileSection.dataset.solveMode = flightDraft(number).solveMode === "time" ? "time" : "height";
  const zSvg = flightOutput(number, "svg[data-flight-z]");
  const zPng = flightOutput(number, "[data-flight-z-png]");
  if (!entry.result) {
    flightResults.delete(number);
    flightResultsFull.delete(number);
    renderFollowerStatus(number, "INVALID", entry.error);
    renderFollowerResult(number, slot, { state: "INVALID", message: entry.error });
    renderSemFragmentReadouts(slot.querySelector("[data-sem-readouts]"), null);
    renderFollowerDed(number, null);
    showCalculationFailed(zSvg, offsetZDiagramTitle({ aircraftNumber: number }), entry.error ?? "no result");
    if (zPng) zPng.disabled = true;
    refreshBdpDiagrams(number);
    return;
  }
  const resultFull = entry.result;
  const result = truncateBeOutput(resultFull);
  flightResultsFull.set(number, resultFull);
  flightResults.set(number, result);
  syncFollowerExtraFields(slot, entry, result, entry.elementLead);
  // The entry's state and warnings: the Flight entrypoint adds what the aircraft result cannot know
  // (a typed value its LOCK / ANGLE / TIME then replaced).
  const warnings = entry.warnings ?? result.warnings;
  renderFollowerStatus(number, entry.status ?? result.state, result.errors.length ? result.errors.join(" / ") : warnings[0] ?? "-");
  const runInReadout = slot.querySelector('[data-flight-readout="runInHeadingDeg"]');
  if (runInReadout) runInReadout.textContent = fmtHeading(result.resolved.runInHeadingDeg);
  const ipRangeReadout = slot.querySelector('[data-flight-readout="ipRangeFromTargetNm"]');
  if (ipRangeReadout) ipRangeReadout.textContent = formatNm(result.resolved.ipRangeNm);
  const headingReadout = slot.querySelector('[data-flight-readout="offsetHeadingDeg"]');
  if (headingReadout) headingReadout.textContent = fmtHeading(result.resolved.offsetHeadingDeg);
  renderFollowerResult(number, slot, { result, delta: flightTimingOf(number) });
  renderSemFragmentReadouts(slot.querySelector("[data-sem-readouts]"), result);
  renderFollowerDed(number, entry.ded);
  const zDrawn = renderZDiagramOf(number, zSvg, resultFull);
  if (zPng) zPng.disabled = !zDrawn;
  refreshBdpDiagrams(number);
}

function installSectionDisclosure() {
  $$("#offset-calculator .section").forEach((section, index) => {
    const header = section.firstElementChild;
    const heading = header?.querySelector("h2");
    if (!heading || heading.querySelector(".section-disclosure-toggle")) return;
    const body = document.createElement("div");
    // A section added after the layout moved the others (index S&R tab) must not reuse an id.
    let bodyId = `offset-section-body-${index}`;
    while (document.getElementById(bodyId)) bodyId += "-b";
    body.id = bodyId;
    body.className = "section-disclosure-body";
    [...section.children].filter((child) => child !== header).forEach((child) => body.append(child));
    section.append(body);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-disclosure-toggle";
    button.textContent = heading.textContent;
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", body.id);
    heading.replaceChildren(button);
    // Visible collapse control at the right of every section head, same "−/＋" grammar as the
    // inner input panels; the title stays clickable too.
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "section-collapse-icon";
    icon.setAttribute("aria-controls", body.id);
    icon.setAttribute("aria-label", `Collapse ${heading.textContent}`);
    icon.textContent = "−";
    if (getComputedStyle(header).display === "block") heading.append(icon);
    else header.append(icon);
    const toggle = () => {
      body.hidden = !body.hidden;
      button.setAttribute("aria-expanded", String(!body.hidden));
      icon.setAttribute("aria-expanded", String(!body.hidden));
      icon.textContent = body.hidden ? "＋" : "−";
      icon.setAttribute("aria-label", `${body.hidden ? "Expand" : "Collapse"} ${button.textContent}`);
      if (!body.hidden) requestAnimationFrame(() => legend.render());
    };
    icon.setAttribute("aria-expanded", "true");
    button.addEventListener("click", toggle);
    icon.addEventListener("click", toggle);
    // Reference Point starts collapsed (2026-10-12, user); its title or ＋ opens it.
    if (section.classList.contains("reference-point-section")) toggle();
  });
}

// Temp Def (temporary default staging, 2026-09-26, user request). Save stores the current #1
// state (all tabs, locks, links, reference mode), the Flight layout and the field text as shown,
// in this browser only. Copy hands that JSON over (clipboard, else a file download) so the code
// defaults can be updated from it. It never changes Default, saved inputs or calculation. Remove
// this block, its markup and CSS once the defaults have been updated.
const TEMP_DEF_KEY = "flight-sim-tools.offset.v2.temp-def.v1";

function readTempDef() {
  try {
    return JSON.parse(localStorage.getItem(TEMP_DEF_KEY) || "null");
  } catch {
    return null;
  }
}

function captureTempDef() {
  const displayed = {};
  $$("[data-key]").forEach((control) => {
    const key = control.dataset.key;
    if (key && !Object.hasOwn(displayed, key)) displayed[key] = control.value;
  });
  return {
    kind: "offset-v2-temp-def",
    version: 1,
    savedAt: new Date().toISOString(),
    lead: capturePersistedState(),
    displayed,
    flightLayout: JSON.parse(JSON.stringify(flightLayout)),
  };
}

function renderTempDefStatus(message) {
  const status = $("#temp-def-status");
  if (!status) return;
  const saved = readTempDef();
  const when = saved?.savedAt ? new Date(saved.savedAt) : null;
  const stamp = when && !Number.isNaN(when.getTime())
    ? `saved ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "none";
  status.textContent = message ? `${message} · ${stamp}` : stamp;
}

function downloadTempDef(text) {
  const blob = new Blob([text], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "offset-temp-def.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function installTempDef() {
  $("#temp-def-save")?.addEventListener("click", () => {
    try {
      localStorage.setItem(TEMP_DEF_KEY, JSON.stringify(captureTempDef()));
      renderTempDefStatus("Saved");
    } catch {
      renderTempDefStatus("Save failed");
    }
  });
  $("#temp-def-copy")?.addEventListener("click", async () => {
    const saved = readTempDef();
    if (!saved) {
      renderTempDefStatus("Save first");
      return;
    }
    const text = JSON.stringify(saved, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      renderTempDefStatus("Copied");
    } catch {
      downloadTempDef(text);
      renderTempDefStatus("Downloaded");
    }
  });
  $("#temp-def-clear")?.addEventListener("click", () => {
    if (!readTempDef()) {
      renderTempDefStatus();
      return;
    }
    if (!window.confirm("Temp Def를 지울까요? (Default와 현재 입력은 바뀌지 않습니다)")) return;
    try {
      localStorage.removeItem(TEMP_DEF_KEY);
    } catch {
      // Storage may be unavailable; nothing else to clear.
    }
    renderTempDefStatus("Cleared");
  });
  renderTempDefStatus();
}

// ---- DED PNG (handoff 2026-10-06 §8.3) ---------------------------------------------------------
// The PNG draws the DED boxes from the strings on screen (same formatter, no export rounding):
// per aircraft the reference page (VRP / VIP) box and the OA1 box, aircraft after aircraft.
function dedSection(number) {
  return number === 1 ? $("#ded-reference-screen")?.closest(".section") ?? null : flightOutput(number, ".ded-boxes")?.closest(".section") ?? null;
}
function dedCard(number) {
  const section = dedSection(number);
  if (!section || !flightResultOf(number)) return null;
  const boxes = [...section.querySelectorAll(".ded-screen")].map((screen) => ({
    title: screen.querySelector(".ded-page-title")?.textContent.trim() ?? "",
    rows: [...screen.querySelectorAll(".ded-row")].map((row) => [row.querySelector("span")?.textContent.trim() ?? "", row.querySelector("output")?.textContent.trim() ?? ""]),
  }));
  if (boxes.length !== 2 || boxes.some((box) => box.rows.some(([, text]) => !text || text === "-"))) return null;
  return { number, mode: boxes[0].title, boxes };
}
function dedAvailable(number) {
  return !!dedCard(number);
}
function dedExportSvg(cards) {
  const pad = 20, boxWidth = 330, gap = 16, headerHeight = 38, boxHeight = 150, cardGap = 18;
  const width = pad * 2 + boxWidth * 2 + gap;
  const cardHeight = headerHeight + boxHeight;
  const height = pad * 2 + cards.length * cardHeight + (cards.length - 1) * cardGap;
  const svg = svgNode("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${width} ${height}`, "data-ded-export": cards.map((card) => card.number).join(",") });
  svg.append(svgNode("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  cards.forEach((card, index) => {
    const top = pad + index * (cardHeight + cardGap);
    svg.append(svgNode("text", { x: pad, y: top + 24, "font-size": 20, "font-weight": 800, "font-family": "system-ui, sans-serif", fill: offsetAircraftColors(card.number).run }, `DED #${card.number} · ${card.mode}`));
    card.boxes.forEach((box, boxIndex) => {
      const x = pad + boxIndex * (boxWidth + gap);
      const y = top + headerHeight;
      svg.append(svgNode("rect", { x, y, width: boxWidth, height: boxHeight, rx: 12, fill: "#07120c", stroke: "#2f6b45", "stroke-width": 1.5 }));
      svg.append(svgNode("text", { x: x + 16, y: y + 30, "font-size": 17, "font-weight": 900, "font-family": mono, fill: "#9ef0af" }, box.title));
      svg.append(svgNode("line", { x1: x + 16, x2: x + boxWidth - 16, y1: y + 42, y2: y + 42, stroke: "#9ef0af", "stroke-opacity": 0.3 }));
      box.rows.forEach(([label, text], rowIndex) => {
        const rowY = y + 72 + rowIndex * 28;
        svg.append(svgNode("text", { x: x + 16, y: rowY, "font-size": 15, "font-family": mono, fill: "#9ef0af" }, label));
        svg.append(svgNode("text", { x: x + 86, y: rowY, "font-size": 15, "font-family": mono, fill: "#9ef0af" }, text));
      });
    });
  });
  return svg;
}
let lastDedExport = null;
function exportDedPng(numbers) {
  const ordered = [...new Set(numbers)].sort((a, b) => a - b);
  const cards = ordered.map(dedCard);
  if (!ordered.length || cards.some((card) => !card)) return null;
  const svg = dedExportSvg(cards);
  const filename = `Offset_DED_${ordered.join("-")}_${cards[0].mode}.png`;
  lastDedExport = { filename, numbers: ordered, svg: svg.outerHTML };
  // Attached while exporting so the computed text styles are read (svg-png-export clones them).
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px";
  host.append(svg);
  document.body.append(host);
  const done = saveSvgAsPng(svg, filename, { scale: 2, background: "#ffffff" });
  host.remove();
  return done;
}
function syncDedPngButtons() {
  document.querySelectorAll("[data-ded-png]").forEach((button) => {
    const key = button.dataset.dedPng;
    const numbers = key === "visible" ? offsetIndexUi.visibleAircraft() : [Number(key)];
    const missing = numbers.filter((number) => !dedAvailable(number));
    button.disabled = !numbers.length || missing.length > 0;
    button.title = !numbers.length ? "No aircraft shown" : missing.length ? `No current DED for #${missing.join(", #")}` : `Save DED #${numbers.join(", #")} as PNG`;
  });
}
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-ded-png]");
  if (!button || button.disabled) return;
  const key = button.dataset.dedPng;
  exportDedPng(key === "visible" ? offsetIndexUi.visibleAircraft() : [Number(key)]);
});

// ---- Save / Load Default / developer Save as Default (handoff 2026-10-06 §3) --------------------
// Work save: one schema-3 Flight record including #1 (work-save-v0.1.mjs); legacy split
// records are read only for migration. Both layouts write and verify the same snapshot. Since 2026-10-11 (user)
// nothing else writes them: edits, tab Defaults and Load Default stay unsaved until Save, and a
// reload or a newly opened page loads the last Save. Developer preset:
// PRESET_KEY, its own schemaVersion, read by every Default; built-in defaults when absent.
let presetCache = { raw: undefined, value: null };
const NON_NUMERIC_INPUTS = new Set(["weaponId", "initialSpeedMode", "offsetSpeedMode", "semEnd", "semTurnType", "semTurnDirection"]);
// Keys added after presets existed (2026-10-18 / 2026-10-19): a preset without them is still valid (built-in default).
const PRESET_OPTIONAL_KEYS = new Set(["semEnd", "csemTargetFpaDeg", "semTurnType", "semTurnDirection", "semTurnDeg", "semTurnG", "semTurnSpeedKcas", "semTurnBankDeg"]);
// Numbers whose blank is a value (Turn G: Recovery G, Turn Speed: the level-off speed).
const PRESET_BLANK_KEYS = new Set(["semTurnG", "semTurnSpeedKcas"]);
function validDefaultPreset(record) {
  if (!record || typeof record !== "object" || record.schemaVersion !== PRESET_SCHEMA_VERSION) return null;
  const { lead, flight } = record;
  if (!lead || typeof lead !== "object" || !lead.inputs || typeof lead.inputs !== "object") return null;
  for (const key of Object.keys(DEFAULT_INPUT_VALUES)) {
    const text = lead.inputs[key];
    if (text === undefined && PRESET_OPTIONAL_KEYS.has(key)) continue;
    if (typeof text !== "string") return null;
    if (text.trim() === "" && PRESET_BLANK_KEYS.has(key)) continue;
    if (!NON_NUMERIC_INPUTS.has(key) && !Number.isFinite(Number.parseFloat(text))) return null;
  }
  if (lead.locks && typeof lead.locks !== "object") return null;
  if (!flight || !Number.isInteger(flight.size) || flight.size < 1 || flight.size > 4) return null;
  if (!flight.aircraft || typeof flight.aircraft !== "object" || Array.isArray(flight.aircraft)) return null;
  for (const number of [2, 3, 4]) {
    const draft = flight.aircraft[number];
    if (draft === undefined) continue;
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  }
  return record;
}
function readDefaultPreset() {
  let raw = null;
  try { raw = localStorage.getItem(PRESET_KEY); } catch { raw = null; }
  if (raw !== presetCache.raw) {
    let value = null;
    try { value = raw ? validDefaultPreset(JSON.parse(raw)) : null; } catch { value = null; }
    presetCache = { raw, value };
  }
  return presetCache.value;
}

function saveWorkState() {
  return writeOffsetWorkSave(localStorage, { lead: capturePersistedState(), flight: captureFlightLayout() });
}

// Every work Save uses the same completion and error path, in both layouts.
let workSavePending = null;
function saveCurrentWork(button) {
  if (workSavePending) return workSavePending;
  const buttons = $$("#work-save, [data-tab-tool='save']");
  buttons.forEach((node) => {
    clearTimeout(saveFeedbackTimers.get(node));
    node.disabled = true;
    node.textContent = "Saving…";
  });
  renderSaveStatus("Saving…", "warning");
  workSavePending = (async () => {
    try {
      // S&R may still be answering when another Offset edit arrives. Capture only
      // after both have flushed against the same current Offset revision.
      for (;;) {
        commitActiveEdit();
        await calculationScheduler.flush();
        const revision = calculationScheduler.state().revision;
        for (const extension of saveExtensions.values()) await extension.flush?.();
        const state = calculationScheduler.state();
        if (state.revision === revision && !state.timer && !state.inFlight && !state.sendWanted && !state.held) break;
      }
      const saved = saveWorkState();
      renderSaveStatus(`Saved · #1–#${saved.size} · ${savedTimeText(new Date(saved.savedAt))}`);
      buttons.forEach((node) => showSaveButtonResult(node, true));
      return true;
    } catch (error) {
      renderSaveStatus(`Save failed · ${error?.message || "browser storage unavailable"} · inputs stay usable`, "invalid");
      buttons.forEach((node) => showSaveButtonResult(node, false));
      return false;
    } finally {
      buttons.forEach((node) => { node.disabled = false; });
      workSavePending = null;
    }
  })();
  return workSavePending;
}

// Ends the edit in progress through the normal commit (change / empty-field rules) first.
function commitActiveEdit() {
  const active = document.activeElement;
  if (active?.matches?.("input, select") && active.closest("#offset-calculator")) active.blur();
}

function currentFlightPreset() {
  const aircraft = {};
  for (const number of [2, 3, 4]) {
    if (flightLayout.aircraft[number]) aircraft[number] = JSON.parse(JSON.stringify(flightLayout.aircraft[number]));
  }
  return { size: flightLayout.size, aircraft };
}

function saveDefaultPreset() {
  if (!lastResult) return { ok: false, message: "#1 has no current result" };
  const missing = [];
  for (let number = 2; number <= flightLayout.size; number += 1) {
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number) && !flightResults.has(number)) missing.push(number);
  }
  if (missing.length) return { ok: false, message: `#${missing.join(", #")} has no current result` };
  const record = { schemaVersion: PRESET_SCHEMA_VERSION, kind: "offset-v2-default-preset", savedAt: new Date().toISOString(), lead: capturePersistedState(), flight: currentFlightPreset() };
  if (!validDefaultPreset(record)) return { ok: false, message: "current inputs are not a valid preset" };
  let previous = null;
  try { previous = localStorage.getItem(PRESET_KEY); } catch { previous = null; }
  const text = JSON.stringify(record);
  try {
    localStorage.setItem(PRESET_KEY, text);
    if (localStorage.getItem(PRESET_KEY) !== text) throw new Error("read-back mismatch");
  } catch (error) {
    try {
      if (previous === null) localStorage.removeItem(PRESET_KEY);
      else localStorage.setItem(PRESET_KEY, previous);
    } catch { /* the previous preset stays as storage left it */ }
    return { ok: false, message: `storage write failed (${error.message})` };
  }
  return { ok: true, message: "Saved as Default" };
}

// Save/Load tab Load Default: every aircraft and the shared settings from the current defaults; the
// Flight size too when a developer preset holds one (built-in defaults keep the current size). It
// does not touch the saved conditions: only Save writes browser storage (2026-10-11, user).
function applyFlightDefaults() {
  const preset = readDefaultPreset();
  applyPersistedState(createDefaultPersistedState());
  clearPendingInputStates();
  if (preset) flightLayout.size = preset.flight.size;
  for (const number of [2, 3, 4]) flightLayout.aircraft[number] = defaultFlightDraft(number);
  pruneVisibleAircraft();
  // Rebuilds the follower slots; the loaded state replaces every waiting edit and answer.
  renderFlightLayout({ fresh: true });
  flightDefaultsListeners.forEach((listener) => listener());
}

// Developer mode (temporary, §3.3): typing 7777 into the edited aircraft's Initial Altitude and
// committing it turns on Save as Default for this page only. The 7777 is a command: it is never
// solved or saved, and the state from the start of that edit (values with their full precision,
// LINK, solve mode, entered Tracking Time, LOCKs, drivers, the Flight drafts) comes back.
const DEVELOPER_COMMAND = "7777";
let developerMode = false;
let developerEditStart = null;
function developerCommandAvailable() {
  return !!$("#save-as-default");
}
function isDeveloperCommand(field) {
  return developerCommandAvailable() && field?.value?.trim() === DEVELOPER_COMMAND;
}
function captureEditSnapshot() {
  return {
    lead: capturePersistedState(),
    texts: [...$$("[data-key]"), $("#vrp-bearing-input"), $("#vip-bearing-input"), $("#vip-range-input")].filter(Boolean).map((node) => [node, node.value]),
    solved: new Map(solvedInputValues),
    flight: JSON.parse(JSON.stringify(flightLayout)),
  };
}
function restoreEditSnapshot(snapshot) {
  applyPersistedState(snapshot.lead);
  snapshot.texts.forEach(([node, text]) => { node.value = text; });
  solvedInputValues.clear();
  snapshot.solved.forEach((entry, key) => solvedInputValues.set(key, entry));
  syncInitialLinkUi();
  flightLayout.size = snapshot.flight.size;
  Object.keys(flightLayout.aircraft).forEach((key) => { delete flightLayout.aircraft[key]; });
  Object.assign(flightLayout.aircraft, JSON.parse(JSON.stringify(snapshot.flight.aircraft)));
  document.querySelectorAll("#flight-followers .flight-slot").forEach((slot) => initializeFlightSlotFields(slot, Number(slot.dataset.aircraft)));
  clearPendingInputStates();
  recalculateFresh();
}
function rememberDeveloperEditStart(field) {
  if (developerCommandAvailable()) developerEditStart = { field, snapshot: captureEditSnapshot() };
}
function runDeveloperCommand(field) {
  const start = developerEditStart?.field === field ? developerEditStart.snapshot : null;
  if (start) restoreEditSnapshot(start);
  developerEditStart = null;
  developerMode = true;
  syncDeveloperUi();
  // index (2026-10-12, user): the developer row lives in the Save/Load tab; open it so the
  // Save as Default button is in view instead of hidden behind the tab being edited.
  document.querySelector('[data-wide-input="save"]')?.click();
  renderSaveStatus("Developer mode: Save as Default is on until this page reloads", "warning");
}

// Developer option button (index Save/Load developer row, owner Q8 2026-10-15).
function syncFragmentMarginButton() {
  const button = $("#fragment-margin-mode");
  if (!button) return;
  const heightOnly = fragmentMarginAppliesTo === "HEIGHT";
  button.textContent = `Fragment margin: ${heightOnly ? "Height only" : "Height + Radius"}`;
  button.setAttribute("aria-pressed", String(heightOnly));
  button.classList.toggle("active", heightOnly);
}
function installFragmentMarginButton() {
  $("#fragment-margin-mode")?.addEventListener("click", () => {
    fragmentMarginAppliesTo = fragmentMarginAppliesTo === "HEIGHT" ? "HEIGHT_AND_RADIUS" : "HEIGHT";
    syncFragmentMarginButton();
    calculate();
  });
  syncFragmentMarginButton();
}

function renderSaveStatus(message, state = "valid") {
  let status = $("#save-status");
  if (!status) {
    status = document.createElement("output");
    status.id = "save-status";
    status.setAttribute("role", "status");
    $("#offset-calculator .topbar").after(status);
  }
  status.textContent = message;
  status.className = `status-message ${state}`;
}
function syncDeveloperUi() {
  const dev = $("#save-developer");
  if (dev) dev.hidden = !developerMode;
  document.querySelectorAll("[data-sem-readouts]").forEach((box) => { box.hidden = !developerMode; });
  const preset = readDefaultPreset();
  const presetStatus = $("#preset-status");
  if (presetStatus) {
    const when = preset?.savedAt ? new Date(preset.savedAt) : null;
    presetStatus.textContent = preset
      ? `Default: developer preset${when && !Number.isNaN(when.getTime()) ? ` · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""} · Flight of ${preset.flight.size}`
      : "Default: built-in";
  }
}
function installSaveTab() {
  if (!$("#work-save")) return;
  $("#work-save").addEventListener("click", (event) => { saveCurrentWork(event.currentTarget); });
  // Load Default (2026-10-11, user): loads the Default conditions; nothing is stored until Save.
  $("#work-default").addEventListener("click", () => {
    commitActiveEdit();
    applyFlightDefaults();
    renderSaveStatus(`${readDefaultPreset() ? "Developer preset" : "Built-in Default"} loaded · press Save to keep it`, "valid");
  });
  $("#save-as-default").addEventListener("click", async () => {
    if (!developerMode) return;
    commitActiveEdit();
    await calculationScheduler.flush();
    const outcome = saveDefaultPreset();
    syncDeveloperUi();
    renderSaveStatus(outcome.ok ? outcome.message : `Save as Default failed · ${outcome.message} · previous Default kept`, outcome.ok ? "valid" : "invalid");
  });
  $("#preset-clear")?.addEventListener("click", () => {
    if (!developerMode) return;
    try { localStorage.removeItem(PRESET_KEY); } catch { /* nothing stored */ }
    syncDeveloperUi();
    renderSaveStatus("Developer preset removed · Default is built-in again", "valid");
  });
  syncDeveloperUi();
}
function renderLoadedSaveStatus() {
  if (restoredWorkSave.notice) {
    renderSaveStatus(restoredWorkSave.notice, "warning");
  } else if (restoredWorkSave.lead) {
    const when = loadedSave?.savedAt ? new Date(loadedSave.savedAt) : null;
    renderSaveStatus(`Saved conditions loaded · #1–#${flightLayout.size}${when && !Number.isNaN(when.getTime()) ? ` · saved ${savedTimeText(when)}` : ""}`);
  }
}
function savedTimeText(date) {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// index layout hooks (wide-layout.mjs): the shared shown-aircraft set, the centre BDP views and the
// DED PNG state. Display only: nothing here changes a solve input.
export const offsetIndexUi = Object.freeze({
  visibleAircraft: () => topViewAvailableAircraft().filter((number) => topViewAircraft.has(number)),
  toggleVisibleAircraft,
  syncShowAircraftButtons: syncTopViewAircraftButtons,
  onVisibleAircraftChange(listener) {
    visibleAircraftListeners.add(listener);
    listener(this.visibleAircraft());
  },
  // Centre BDP tab: BDP Top View + Profile of exactly these aircraft (empty: none drawn).
  showBdpViews(numbers) {
    fullViewsOn.clear();
    numbers.forEach((number) => fullViewsOn.add(number));
    [1, 2, 3, 4].forEach(applyFullViews);
  },
  flightSize: () => flightLayout.size,
  // Saved edit aircraft (null without a work save) and the getter Save reads it from.
  savedEditAircraft: () => loadedSave?.editAircraft ?? null,
  registerEditAircraft(getter) { editAircraftOf = getter; },
  hasResult: (number) => !!flightResultOf(number),
  dedAvailable,
  exportDedPng,
  lastDedExport: () => lastDedExport,
  syncDedPngButtons,
  // SEM & Rejoin (2026-10-13): the last adopted Flight answer (Full results + the input they answer)
  // and its updates; a record kept by Save (capture, plus flush awaited before Save writes); the saved
  // record of that name (null without a work save); Load Default. Nothing here calculates.
  flightAnswer: () => lastFlightAnswer,
  onFlightAnswer(listener) { flightAnswerListeners.add(listener); },
  registerSaveExtension(name, extension) { saveExtensions.set(name, extension); },
  savedExtension: (name) => loadedSave?.record?.[name] ?? null,
  onFlightDefaults(listener) { flightDefaultsListeners.add(listener); },
  // A section added by the layout gets the same collapse controls as the others (idempotent).
  installSectionDisclosure,
});

function install() {
  // Header shows the Offset BE version actually loaded.
  const rev = $(".rev");
  if (rev) rev.textContent = `V2 WORK · OFFSET BE ${OFFSET_FLIGHT_V0_1.components.offsetBe} · FLIGHT ${OFFSET_FLIGHT_V0_1.version}`;
  installCalculation();
  populateWeapons();
  installLocks();
  $("#initial-link-btn")?.addEventListener("click", () => calculate({ aircraft: 1, kind: "toggle", key: "rollInAltitudeLinked", value: toggledValue(1, "toggle", "rollInAltitudeLinked", rollInAltitudeLinked) }));
  installModeButtons();
  installFragmentMarginButton();
  installReferenceBearingControls();
  installValueStateBindings();
  try { restoredWorkSave = readOffsetWorkSave(localStorage); }
  catch { restoredWorkSave = { lead: null, flight: null, notice: "Saved conditions unavailable · browser storage could not be read" }; }
  installFlightLayout();
  const leadDiagramsHost = document.querySelector('[data-bdp-diagrams-host="1"]');
  if (leadDiagramsHost) leadDiagramsHost.outerHTML = offsetBdpDiagramsMarkup(1);
  installSectionDisclosure();
  installSectionTools();
  installTempDef();
  installSaveTab();
  syncReferencePanes();
  defaultPersistedState = createDefaultPersistedState();

  document.addEventListener("focusin", rememberLeadEditStart);
  document.addEventListener("input", handleFieldChange);
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-key]")) handleFieldChange(event);
  });

  const svg = $("#offset-top-view");
  installOffsetTopViewControls(svg, {
    zoomInButton: $("#zoom-in"),
    zoomOutButton: $("#zoom-out"),
    sizeResetButton: $("#top-view-size-output"),
    resetButton: $("#zoom-reset"),
  });
  const fontScaleSelect = $("#top-view-font-scale");
  const textOutput = $("#top-view-font-scale-output");
  const smallerText = $("#top-view-font-down");
  const largerText = $("#top-view-font-up");
  const syncTextControls = () => {
    if (fontScaleSelect) fontScaleSelect.value = String(topViewTextScale);
    if (textOutput) textOutput.textContent = `${Math.round(topViewTextScale * 100)}%`;
    if (smallerText) smallerText.disabled = topViewTextScale <= 0.5;
    if (largerText) largerText.disabled = topViewTextScale >= 2;
  };
  const setTextScale = (value) => {
    topViewTextScale = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
    syncTextControls();
    renderTopView();
  };
  fontScaleSelect?.addEventListener("change", () => {
    const value = Number.parseFloat(fontScaleSelect.value);
    setTextScale(Number.isFinite(value) ? value : TOP_VIEW_TEXT_SCALE_DEFAULT);
  });
  smallerText?.addEventListener("click", () => setTextScale(topViewTextScale - 0.1));
  largerText?.addEventListener("click", () => setTextScale(topViewTextScale + 0.1));
  textOutput?.addEventListener("click", () => setTextScale(TOP_VIEW_TEXT_SCALE_DEFAULT));
  syncTextControls();
  let compactTextViewport = globalThis.innerWidth <= TOP_VIEW_MOBILE_MAX_WIDTH_PX;
  const syncViewportTextBase = () => {
    const nextCompact = globalThis.innerWidth <= TOP_VIEW_MOBILE_MAX_WIDTH_PX;
    if (nextCompact === compactTextViewport) return;
    compactTextViewport = nextCompact;
    renderTopView();
    // The BDP Top View and Dive Profile text base changes across the same width (PC 1.2×, phone 2×).
    [1, 2, 3, 4].forEach((number) => refreshBdpDiagrams(number));
  };
  globalThis.addEventListener?.("resize", syncViewportTextBase);
  globalThis.visualViewport?.addEventListener?.("resize", syncViewportTextBase);
  topViewCompactQuery = globalThis.matchMedia?.(`(max-width: ${TOP_VIEW_MOBILE_MAX_WIDTH_PX}px)`) ?? null;
  topViewCompactQuery?.addEventListener?.("change", syncViewportTextBase);
  if (globalThis.ResizeObserver) {
    topViewViewportObserver = new ResizeObserver(syncViewportTextBase);
    topViewViewportObserver.observe(document.documentElement);
    if (document.body) topViewViewportObserver.observe(document.body);
  }
  $("#capture-top-view").addEventListener("click", () => exportOffsetTopView(svg, svg.dataset.exportTitle || offsetTopViewTitle({ aircraftNumber: 1 })));
  $("#top-view-ip-bottom").addEventListener("click", (event) => {
    topViewIpBottom = !topViewIpBottom;
    event.currentTarget.setAttribute("aria-pressed", String(topViewIpBottom));
    renderTopView();
  });
  installTimeDial($("#top-view-time-dial"), setOffsetClock);
  $("#top-view-advanced").addEventListener("click", (event) => {
    topViewAdvanced = !topViewAdvanced;
    event.currentTarget.setAttribute("aria-pressed", String(topViewAdvanced));
    event.currentTarget.textContent = `Advanced: ${topViewAdvanced ? "On" : "Off"}`;
    renderTopView();
  });
  $("#capture-z").addEventListener("click", () => saveSvgAsPng($("#offset-z-svg"), `${offsetZDiagramTitle({ aircraftNumber: 1 }).replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" }));

  const restored = loadPersistedState();
  if (!restored) applyPersistedState(defaultPersistedState);
  renderLoadedSaveStatus();
  persistenceReady = true;
  // The first answer draws the page (initialRender ends there).
  recalculateFresh();
}

install();

