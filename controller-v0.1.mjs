import { formatDeg, formatFt, formatG, formatKt, formatNm, formatSec, formatSignedSec, truncateBeOutput } from "./common/ui/display-precision-v0.1.mjs";
import { installResultPanel } from "./common/ui/result-panel-v0.1.mjs";
import { formationPositionMarkup, installFormationSideSelects } from "./common/ui/formation-position-v0.1.mjs";
import { installSvgLegend } from "./common/diagram/svg-legend-v0.1.mjs";
// Full (untruncated) BE results feed the follower solves; displays use the 5-decimal truncation
// (docs/FE-BE-RULES.md "Calculation consumers").
import { OFFSET_BE_V0_2, calculateOffsetWithVrpStartFull } from "./AG/bombing/offset-bombing/offset-be-v0.2.mjs?v=2026-10-01a";
import { autoRollInBankDegFull, levelTurnRollInGFull } from "./AG/bombing/bomb-delivery-planner/bomb-delivery-planner-v0.3.mjs";
import {
  applyElementLeadOffsetAngle,
  computeDropOrderDelta,
  computeFormationOffsetVector,
  solveElementSameTimeActionRange,
  solveIngressTimeMatch,
  solveMetricMatch,
} from "./AG/bombing/offset-bombing/offset-formation-v0.1.mjs?v=2026-10-01a";
import { calculateOffAxisOffsetFull } from "./AG/bombing/offset-bombing/offset-formation-geometry-v0.1.mjs?v=2026-10-01a";
import { add as addWorldPoints } from "./AG/bombing/offset-bombing/offset-geometry-v0.2.mjs?v=2026-10-01a";
// Cache tokens: these Common modules gained what the Offset views and toolbar need (primitives
// 0.1.6 canvas-aware text scale, smart-label 0.1.5, viewport 0.1.5 refresh); stale copies would fail.
import { SVG_DIAGRAM_TEXT_SCALE_V0_1, svgNode } from "./common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { installSmartLabelDrag } from "./common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { installSvgViewport } from "./common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { createValueStateController } from "./common/ui/value-state-controller-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";
// Offset graphs are BE-owned views (AG/bombing/offset-bombing/view/, common/diagram/SPEC.md); this
// controller only wires their toolbars, legend and titles.
import { OFFSET_TOP_VIEW_V0_1, offsetTopViewLegend, offsetTopViewTitle, renderOffsetTopView } from "./AG/bombing/offset-bombing/view/offset-top-view-v0.1.mjs?v=0.1.0";
import { renderOffsetFlightTopView } from "./AG/bombing/offset-bombing/view/offset-flight-top-view-v0.1.mjs?v=0.1.0";
import { offsetZDiagramTitle, renderOffsetZDiagram } from "./AG/bombing/offset-bombing/view/offset-z-diagram-v0.1.mjs?v=0.1.3";
// Cache token: panel 0.4.0 adds the Common Text / Size / Reset toolbar to each Full BDP panel.
import { bdpDiagramsMarkup, clearBdpDiagrams, renderBdpDiagrams } from "./AG/bombing/bomb-delivery-planner/view/bdp-diagrams-panel-v0.1.mjs?v=0.4.0";

const resultPanel = installResultPanel(document.querySelector('[data-result-panel]'));
// Legend items and colours come from the Offset Top View (values follow each result).
const legendItems = offsetTopViewLegend();
const legend = installSvgLegend(document.getElementById('offset-legend'), legendItems);
const LOW_ANGLE_BOUNDARY_DEG = 10;
const TOP_VIEW_TEXT_SCALE_DEFAULT = SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale;
const TOP_VIEW_MOBILE_MAX_WIDTH_PX = SVG_DIAGRAM_TEXT_SCALE_V0_1.mobileMaxWidthPx;
const FT_PER_NM = 6076.11549;
const DEFAULT_REFERENCE_RANGE_NM = 10;
const STORAGE_KEY = "flight-sim-tools.offset.v2.input.v1";
const FLIGHT_LAYOUT_KEY = "flight-sim-tools.offset.v2.flight-layout.v1";
const flightLayout = { size: 1, aircraft: {} };
const flightResults = new Map();
// Flight of 4 (2026-09-27): #2 and #3 fly off #1, #4 flies off its element lead #3.
const FLIGHT_CALCULATING_AIRCRAFT = new Set([2, 3, 4]);
// Wingmen carry the Angle #n / Time #n element-lead options; #3 is element lead B and has none.
const FLIGHT_WINGMEN = new Set([2, 4]);
// Follower DED panels (2026-09-28: #2 only; #3 / #4 wait and keep the placeholder).
const FLIGHT_DED_AIRCRAFT = new Set([2]);
// "Angle #n" / "Time #n" toggles are LOCK-style buttons, not checkboxes: turning one on turns off
// its own manual LOCK (they substitute the same field a LOCK would otherwise hold). When both the
// Offset Angle (Angle #n or LOCK) and the Action Point (Time #n or Action Range LOCK) are fixed,
// calculateFollower solves this aircraft's Roll-in Altitude / Tracking Time pair instead, so its
// own Dive Angle stays an input (user rule, 2026-09-26).
const FLIGHT_TACTICAL_DRIVERS = ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm"];
const FLIGHT_TOGGLE_EXCLUSIONS = {
  offsetAngleLocked: ["sameAngleAsLead"],
  sameAngleAsLead: ["offsetAngleLocked"],
  actionRangeLocked: ["sameTimeAsLead"],
  sameTimeAsLead: ["actionRangeLocked"],
};
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
  windDirectionDeg: "0",
  windSpeedKt: "0",
  rollInBankAngleDeg: "113",
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
let ipLinked = true;
// Linked IP sits this far beyond VRP on the Run-In axis (IP = VRP + 3 NM).
const IP_LINK_LEAD_NM = 3;
let ipLockHeadingDeg = 0;
let vipBearingExplicit = false;
let vipRangeExplicit = false;
let vrpBearingExplicit = false;
let vrpRangeExplicit = false;
let rollBankAuto = true;
// LINK (2026-10-01): while on, Initial Altitude and Roll-in Altitude always hold the same value,
// edited from either side or derived from Tracking Time. Off: Initial Altitude is reference only.
let rollInAltitudeLinked = true;
// BDP solve mode is internal (the Solve Mode select was removed 2026-10-01): the last edited of
// Roll-in / Initial (height) or Tracking Time (time) decides it.
let bdpSolveMode = "height";
// Last Tracking Time the user entered (whole seconds). Height mode derives the field's value, so a
// level delivery (Dive 0°, where BDP always takes Tracking Time as input) uses this instead.
const DEFAULT_TRACKING_TIME_SEC = 18;
let enteredTrackingTimeSec = DEFAULT_TRACKING_TIME_SEC;
let topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
let topViewAdvanced = false;
// IP Bottom (default on): Top View drawn with the Run-In (IP -> Target) pointing up; off = north up
// with a north arrow.
let topViewIpBottom = true;
let lastResult = null;
// Full-precision twin of lastResult (and of each follower result) for BE-to-BE use.
let lastResultFull = null;
const flightResultsFull = new Map();
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

const numberValue = (key) => {
  const text = firstField(key)?.value ?? "";
  const solved = solvedInputValues.get(key);
  const parsed = solved && valuesEquivalent(text, solved.text) ? solved.value : Number.parseFloat(text);
  if (!Number.isFinite(parsed)) throw new TypeError(`${key} must be numeric`);
  return parsed;
};
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
  const changed = targets.some((field) => (includeActive || field !== active) && !valuesEquivalent(field.value, nextText));
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
const setAutoValue = (key, next, sourceKey = null) => {
  const changed = setValue(key, next);
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

function parseInputNumber(selector, fallback) {
  const parsed = Number.parseFloat($(selector)?.value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readRunInHeading() {
  return normHeading(numberValue("runInHeadingDeg"));
}

function readVipToTargetBearing() {
  const fallback = readRunInHeading();
  if (!vipBearingExplicit) return fallback;
  const displayed = parseInputNumber("#vip-bearing-input", displayedBearing(fallback, vipBearingDirection));
  return canonicalToTargetBearing(displayed, vipBearingDirection);
}

function readVipRangeNm() {
  if (!vipRangeExplicit) return DEFAULT_REFERENCE_RANGE_NM;
  return parseInputNumber("#vip-range-input", DEFAULT_REFERENCE_RANGE_NM);
}

function readVrpBearing() {
  const fallback = reciprocalHeading(readRunInHeading());
  if (!vrpBearingExplicit) return fallback;
  return normHeading(parseInputNumber("#vrp-bearing-input", fallback));
}

function readVrpRangeNm() {
  const parsed = Number.parseFloat(firstField("vrpRangeNm")?.value ?? "");
  return Number.isFinite(parsed) ? parsed : 7;
}

function syncBearingInput(selector, canonicalToTargetDeg, direction, { includeActive = false } = {}) {
  const field = $(selector);
  if (!field) return;
  if (!includeActive && document.activeElement === field) return;
  field.value = formatBearingInput(displayedBearing(canonicalToTargetDeg, direction));
}

function syncVipBearingInput(canonicalVipToTargetDeg, options) {
  syncBearingInput("#vip-bearing-input", canonicalVipToTargetDeg, vipBearingDirection, options);
}

function syncIpBearingInput(runInHeadingDeg, options) {
  syncBearingInput("#ip-bearing-input", runInHeadingDeg, ipBearingDirection, options);
}

function syncImplicitReferenceInputs(runInHeadingDeg, { includeActive = false } = {}) {
  if (!vipBearingExplicit) syncVipBearingInput(runInHeadingDeg, { includeActive });

  const vipRange = $("#vip-range-input");
  if (!vipRangeExplicit && vipRange && (includeActive || document.activeElement !== vipRange)) {
    vipRange.value = DEFAULT_REFERENCE_RANGE_NM.toFixed(1);
  }

  const vrpBearing = $("#vrp-bearing-input");
  if (!vrpBearingExplicit && vrpBearing && (includeActive || document.activeElement !== vrpBearing)) {
    vrpBearing.value = formatBearingInput(reciprocalHeading(runInHeadingDeg));
  }

  const vrpRange = firstField("vrpRangeNm");
  if (!vrpRangeExplicit && vrpRange && (includeActive || document.activeElement !== vrpRange)) {
    vrpRange.value = "7.0";
  }
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

// AUTO Roll-in Bank is BDP's own rule (autoRollInBankDegFull: acos(1/G) below 10°, else
// round(90 + Dive/2)); the field shows an integer and keeps the full value behind, so #1 and the
// followers feed BDP the same unrounded bank.
function automaticRollInBankDeg() {
  return autoRollInBankDegFull({ diveAngleDeg: numberValue("diveAngleDeg"), rollInG: numberValue("rollInG") });
}

function applyAutomaticRollBank(sourceKey = "diveAngleDeg") {
  if (!rollBankAuto) return false;
  return setSolvedValue("rollInBankAngleDeg", automaticRollInBankDeg(), 0, sourceKey);
}

function buildInput() {
  const runInHeadingDeg = readRunInHeading();
  const approachRangeNm = numberValue("approachRangeNm");
  return {
    driver,
    turnDriver,
    locks: { ...locks },
    ipLinkedToVrp: ipLinked,
    ipLinkLeadNm: IP_LINK_LEAD_NM,
    ipLockHeadingDeg,
    referenceMode,
    runInHeadingDeg,
    attackHeadingDeg: numberValue("attackHeadingDeg"),
    angleOffDeg: numberValue("angleOffDeg"),
    diveAngleDeg: numberValue("diveAngleDeg"),
    offsetAngleDeg: numberValue("offsetAngleDeg"),
    actionRangeNm: numberValue("actionRangeNm"),
    approachRangeNm,
    ipRangeNm: numberValue("ipRangeNm"),
    vipToTargetBearingDeg: readVipToTargetBearing(),
    vipRangeNm: readVipRangeNm(),
    vrpBearingDeg: readVrpBearing(),
    vrpRangeNm: readVrpRangeNm(),
    offsetAltitudeMslFt: numberValue("offsetAltitudeMslFt"),
    offsetSpeedValue: numberValue("offsetSpeedValue"),
    offsetSpeedMode: value("offsetSpeedMode") ?? "CAS",
    offsetG: numberValue("offsetG"),
    offsetBankDeg: numberValue("offsetBankDeg"),
    offsetRadiusNm: numberValue("offsetRadiusNm"),
    profile: {
      weaponId: value("weaponId") ?? "M82",
      targetElevationMslFt: numberValue("targetElevationMslFt"),
      releaseSpeedKcas: numberValue("releaseSpeedKcas"),
      speedOvershootKcas: numberValue("speedOvershootKcas"),
      fragmentHeightMarginPercent: numberValue("fragmentHeightMarginPercent"),
      recoveryG: numberValue("recoveryG"),
      gOnsetTimeSec: numberValue("gOnsetTimeSec"),
      diveAngleDeg: numberValue("diveAngleDeg"),
      // Wind Direction is the true FROM direction (user decision 2026-10-01); the BE turns it into
      // BDP's attack-axis angle for each candidate Attack Heading.
      windDirectionTrueDeg: numberValue("windDirectionDeg"),
      windSpeedKt: numberValue("windSpeedKt"),
      initialSpeedValue: numberValue("initialSpeedValue"),
      initialSpeedMode: value("initialSpeedMode") ?? "CAS",
      // BDP v0.3 still names its module-entry altitude initialAltitudeMslFt.
      // In Offset composition that module entry is OA1 / Roll-In Altitude.
      initialAltitudeMslFt: numberValue("rollInAltitudeMslFt"),
      solveMode: bdpSolveMode,
      trackingTimeSec: bdpSolveMode === "time" ? numberValue("trackingTimeSec") : enteredTrackingTimeSec,
      releaseAltitudeMslFt: numberValue("releaseAltitudeMslFt"),
      angleOffDeg: numberValue("angleOffDeg"),
      rollInBankAngleDeg: numberValue("rollInBankAngleDeg"),
      rollInG: numberValue("rollInG"),
    },
  };
}

function setIfUnlocked(key, nextValue, digits = null, sourceKey = driver) {
  if (locks[key]) return false;
  const next = digits === null ? nextValue : Number(nextValue).toFixed(digits);
  const changed = setAutoValue(key, next, sourceKey);
  if (valuesEquivalent(firstField(key)?.value, next)) solvedInputValues.set(key, { text: String(next), value: nextValue });
  return changed;
}

// Writes a derived value into an editable field at display precision while keeping the full
// solved value behind it (numberValue reads it back unchanged until the user edits the field).
function setSolvedValue(key, nextValue, digits, sourceKey = null) {
  const next = Number(nextValue).toFixed(digits);
  const changed = setAutoValue(key, next, sourceKey);
  if (valuesEquivalent(firstField(key)?.value, next)) solvedInputValues.set(key, { text: String(next), value: nextValue });
  return changed;
}

// BDP solve-mode coupling (BDP v0.3 height/time modes; same rule as the standalone BDP app):
// Roll-in Altitude drives in "height" mode and Tracking Time is derived; Tracking Time drives in
// "time" mode and Roll-in Altitude (the BDP entry altitude) is derived as
// Release Altitude + tracking path x sin(Dive) + Roll-in altitude loss. BDP reports the mode it
// actually used (resolvedSolveMode): a level delivery (Dive 0°) always takes Tracking Time.
// With LINK on, Initial Altitude follows Roll-in Altitude.
function applyBdpSolveCoupling(result) {
  const p = result.profile.public;
  const mode = p.resolvedSolveMode ?? bdpSolveMode;
  if (mode === "time") {
    if (bdpSolveMode !== "time") {
      // Dive 0° in height mode: the entered Tracking Time was used; show it, not an old derived one.
      solvedInputValues.delete("trackingTimeSec");
      setAutoValue("trackingTimeSec", String(enteredTrackingTimeSec), "diveAngleDeg");
    }
    if (Number.isFinite(p.resolvedInitialAltitudeMslFt)) setSolvedValue("rollInAltitudeMslFt", p.resolvedInitialAltitudeMslFt, 0, "trackingTimeSec");
  } else if (Number.isFinite(p.trackingTimeSec)) {
    setSolvedValue("trackingTimeSec", p.trackingTimeSec, 0, "rollInAltitudeMslFt");
  }
  syncLinkedInitialAltitude("rollInAltitudeMslFt");
}

// LINK on: Initial Altitude shows Roll-in Altitude (integer ft, full value kept behind).
function syncLinkedInitialAltitude(sourceKey = null) {
  if (!rollInAltitudeLinked) return false;
  return setSolvedValue("initialAltitudeMslFt", numberValue("rollInAltitudeMslFt"), 0, sourceKey);
}

function syncInitialLinkUi() {
  const button = $("#initial-link-btn");
  if (button) {
    button.setAttribute("aria-pressed", String(rollInAltitudeLinked));
    button.textContent = rollInAltitudeLinked ? "LINKED" : "LINK";
  }
  const note = $("[data-initial-link-note]");
  if (note) note.textContent = rollInAltitudeLinked ? "Linked to Roll-in Altitude" : "Reference only (not linked)";
  const section = $('#offset-calculator > .section[data-tab="bdp"]');
  if (section) section.dataset.solveMode = bdpSolveMode;
}

function applyResolved(result) {
  setAutoValue("runInHeadingDeg", formatBearingInput(result.resolved.runInHeadingDeg));
  // VRP must stay at or inside IP: the BE pushes an unlocked independent IP that VRP passed back
  // out to VRP + 3 NM and reports it re-linked.
  if (result.ipRelinked) ipLinked = true;
  if (ipLinked && !locks.ipReference) setSolvedValue("ipRangeNm", result.resolved.ipRangeNm, 1);
  if (!locks.vrpReference) {
    setSolvedValue("vrpRangeNm", result.resolved.vrpRangeNm, 1);
    if (document.activeElement !== $("#vrp-bearing-input")) $("#vrp-bearing-input").value = formatBearingInput(result.resolved.vrpBearingDeg);
    vrpBearingExplicit = true;
    vrpRangeExplicit = true;
  }
  // Display precision (docs/TERMINOLOGY.md): angles integer, NM 1 decimal, G 1 decimal; the full
  // solved value stays behind each field (solvedInputValues).
  setIfUnlocked("attackHeadingDeg", result.resolved.attackHeadingDeg, 0);
  setIfUnlocked("angleOffDeg", result.resolved.angleOffDeg, 0);
  setIfUnlocked("offsetAngleDeg", result.resolved.offsetAngleDeg, 0);
  setIfUnlocked("actionRangeNm", result.resolved.actionRangeNm, 1);
  setIfUnlocked("approachRangeNm", result.resolved.approachRangeNm, 1);
  setIfUnlocked("offsetG", result.resolved.offsetG, 1, turnDriver);
  setIfUnlocked("offsetBankDeg", result.resolved.offsetBankDeg, 0, turnDriver);
  setIfUnlocked("offsetRadiusNm", result.resolved.offsetRadiusNm, 1, turnDriver);

  syncVipBearingInput(result.resolved.vipToTargetBearingDeg);
  syncIpBearingInput(result.resolved.runInHeadingDeg);
  $("#offset-heading-out").textContent = fmtHeading(result.resolved.offsetHeadingDeg);
  $("#turn-time-out").textContent = `${formatSec(result.timing.offsetTurnSec)} sec`;
  $("#driver-out").textContent = `DRIVER · ${driver}`;
  $("#lock-count").textContent = `LOCK ${Object.values(locks).filter(Boolean).length}`;
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
    r("Tracking Time", `${formatSec(p.trackingTimeSec)} sec`, "trackingTimeSecResult"),
    r("Roll-in Range", `${formatNm(p.rollInRangeNm)} NM`, "rollInRangeNm"),
    r("Ground Range", `${formatNm(p.groundRangeNm)} NM`, "groundRangeNm"),
    r("Roll-in Radius", `${formatNm(p.rollInRadiusNm)} NM`, "rollInRadiusNm"),
    r("Roll-in Time", `${formatSec(p.rollInTimeSec)} sec`, "rollInTimeSec"),
    r("Roll-in Ground Arc", `${formatNm(p.rollInGroundArcNm)} NM`, "rollInGroundArcNm"),
    r("Roll-in Altitude Loss", `${formatFt(p.rollInAltitudeLossFt)} ft`, "rollInAltitudeLossFt"),
    r("Lead Angle", `${formatDeg(p.leadAngleDeg)}°`, "leadAngleDeg"),
    r("MINALT", `${formatFt(p.minAltMslFt)} ft MSL`, "minAltMslFt"),
    // NLT is not calculated below 10° (BDP SPEC §6.2): N/A, never 0.
    r("NLT Release", p.nltReleaseMslFt === null || p.nltReleaseMslFt === undefined ? "N/A" : `${formatFt(p.nltReleaseMslFt)} ft MSL`, "nltReleaseMslFt"),
    r("Bomb Range / TOF", `${formatNm(p.bombRangeNm)} NM / ${formatSec(p.bombTofSec)} sec`, "bombRangeTofSummary"),
  ];
}

function renderOffsetResult(result) {
  $("#offset-result-body").innerHTML = offsetResultRows(result, {
    ipRangeText: `${formatNm(result.resolved.ipRangeNm)} NM · ${ipLinked ? `LINKED TO VRP + ${IP_LINK_LEAD_NM} NM` : "INDEPENDENT"}`,
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
}

function pointDistanceNm(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function bearingBetween(a, b) {
  const heading = Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
  return normHeading(heading);
}

function dedRangeText(rangeNm) {
  return `${Math.round(rangeNm * FT_PER_NM)} ft (${formatNm(rangeNm)} NM)`;
}

function dedElevationText(elevationFt) {
  return `${Math.round(elevationFt)} ft`;
}

function renderDed(result) {
  const points = result.geometry.points;
  const targetElevationMslFt = result.profile.canonicalInputs?.targetElevationMslFt ?? numberValue("targetElevationMslFt");
  const rollInStartAltitudeMslFt = result.profile.public.resolvedInitialAltitudeMslFt;
  const isVip = result.referenceMode === "VIP";

  $("#ded-page-title").textContent = isVip ? "VIP" : "VRP";
  $("#ded-bearing").textContent = `${formatDeg(isVip ? result.resolved.vipToTargetBearingDeg : result.resolved.vrpBearingDeg)}°`;
  $("#ded-range").textContent = dedRangeText(isVip ? result.resolved.vipRangeNm : result.resolved.vrpRangeNm);
  $("#ded-elevation").textContent = dedElevationText(targetElevationMslFt);

  const oa1Base = isVip ? points.vip : points.target;
  $("#ded-oa1-bearing").textContent = `${formatDeg(bearingBetween(oa1Base, points.rollStart))}°`;
  $("#ded-oa1-range").textContent = dedRangeText(pointDistanceNm(oa1Base, points.rollStart));
  $("#ded-oa1-elevation").textContent = dedElevationText(rollInStartAltitudeMslFt);
}

// Follower DED (same grammar as DED #1). VRP mode: the follower's own VRP is its Action Point, so
// the VRP page is Target -> own Action Point and OA1 is Target -> own Roll-in Start. VIP mode: the
// VIP is the Flight's shared ground reference (#1's VIP), and OA1 is VIP -> own Roll-in Start.
function renderFollowerDed(number, slot, result) {
  if (!FLIGHT_DED_AIRCRAFT.has(number)) return;
  const out = (key) => slot.querySelector(`[data-flight-ded="${key}"]`);
  if (!out("reference-title")) return;
  const isVip = lastResult?.referenceMode === "VIP";
  out("reference-title").textContent = isVip ? "VIP" : "VRP";
  if (!result || !lastResult) {
    ["reference-bearing", "reference-range", "reference-elevation", "oa1-bearing", "oa1-range", "oa1-elevation"].forEach((key) => { out(key).textContent = "-"; });
    return;
  }
  const points = result.geometry.points;
  const targetElevationMslFt = result.profile.canonicalInputs?.targetElevationMslFt ?? lastResult.profile.canonicalInputs?.targetElevationMslFt;
  if (isVip) {
    out("reference-bearing").textContent = `${formatDeg(lastResult.resolved.vipToTargetBearingDeg)}°`;
    out("reference-range").textContent = dedRangeText(lastResult.resolved.vipRangeNm);
  } else {
    out("reference-bearing").textContent = `${formatDeg(bearingBetween(points.target, points.realActionPoint))}°`;
    out("reference-range").textContent = dedRangeText(pointDistanceNm(points.target, points.realActionPoint));
  }
  out("reference-elevation").textContent = dedElevationText(targetElevationMslFt);
  const oa1Base = isVip ? lastResult.geometry.points.vip : points.target;
  out("oa1-bearing").textContent = `${formatDeg(bearingBetween(oa1Base, points.rollStart))}°`;
  out("oa1-range").textContent = dedRangeText(pointDistanceNm(oa1Base, points.rollStart));
  out("oa1-elevation").textContent = dedElevationText(result.profile.public.resolvedInitialAltitudeMslFt);
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
function syncTopViewViewport(svg, rendered, result) {
  const viewport = topViewViewports.get(svg);
  if (viewport) {
    viewport.setBaseViewBox({ x: 0, y: 0, w: rendered.canvas.width, h: rendered.canvas.height });
    if (topViewLastResults.get(svg) !== result) viewport.autoFit();
    else if (viewport.isUserAdjusted()) viewport.refresh();
    else viewport.ensureBaseWhenUnadjusted();
  }
  topViewLastResults.set(svg, result);
  topViewLabelDrags.get(svg)?.applyStoredPositions();
}

// PNG named after the graph title (docs/TERMINOLOGY.md "Diagram titles").
function exportOffsetTopView(svg, title) {
  return saveSvgAsPng(svg, `${title.replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" });
}

function renderTopView(result) {
  const svg = $("#offset-top-view");
  delete svg.dataset.calculationFailed;
  const rendered = renderOffsetTopView(svg, result, {
    aircraftNumber: 1,
    textScale: topViewTextScale,
    viewportWidth: globalThis.innerWidth,
    advanced: topViewAdvanced,
    upHeadingDeg: topViewIpBottom ? result.resolved.runInHeadingDeg : 0,
    northArrow: !topViewIpBottom,
  });
  syncTopViewViewport(svg, rendered, result);
  legendItems.splice(0, legendItems.length, ...offsetTopViewLegend(result));
  legend.render();
}

function calculate() {
  syncInitialLinkUi();
  try {
    const full = calculateOffsetWithVrpStartFull(buildInput());
    const result = truncateBeOutput(full);
    lastResultFull = full;
    lastResult = result;
    applyResolved(result);
    applyBdpSolveCoupling(result);
    renderStatus(result);
    renderOffsetResult(result);
    renderProfileResult(result);
    resultPanel.refresh();
    renderTopView(result);
    refreshBdpDiagrams(1);
    renderDed(result);
    applyResultChangeStates(result);
    // Z #1 is drawn after the followers: its ΔTime row is #2's (#1 Impact − #2 Release).
    recalculateFollowers();
  } catch (error) {
    document.querySelectorAll("[data-result-value]").forEach(node => { node.textContent = "N/A"; });
    resultPanel.refresh();
    const message = $("#constraint-message");
    message.textContent = `INVALID · ${error.message}`;
    message.className = "status-message invalid";
    const pill = $("#state-pill");
    pill.textContent = "INVALID";
    pill.className = "status bad";
    // A failed solve leaves no current result (FE-BE-RULES): Top View, Z, DED and the Full BDP
    // diagrams are cleared and every follower reports that #1 has no result, instead of showing
    // or re-solving from the previous success.
    lastResult = null;
    lastResultFull = null;
    showCalculationFailed($("#offset-top-view"), "Offset #1 Top View", error.message);
    showCalculationFailed($("#offset-z-svg"), "Offset #1 Z-Diagram", error.message);
    $("#capture-z").disabled = true;
    clearDed();
    refreshBdpDiagrams(1);
    lastResultSnapshot = null;
    recalculateFollowers();
  }
  if (persistenceReady) savePersistedState();
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
// an empty field is committed (Enter or moving to another field) it is filled from the other
// values instead of turning the solve INVALID: the edit stops driving (the driver from before the
// edit returns), coupled fields take the value solved from the others, linked fields their link
// (Roll-in Bank AUTO, Roll-in Altitude = Initial Altitude, Tracking Time derived) and plain inputs
// the value they had before the edit.
let leadEditStart = null;
const LEAD_FALLBACK_DRIVERS = { vrpRangeNm: "actionRangeNm", actionRangeNm: "vrpRangeNm" };
const LEAD_TURN_FALLBACK = { offsetG: "offsetBankDeg", offsetBankDeg: "offsetG", offsetRadiusNm: "offsetG" };

function rememberLeadEditStart(event) {
  const field = event.target.closest?.("[data-key]");
  if (!field || field.tagName === "SELECT" || field.id === "ip-bearing-input") return;
  const key = field.dataset.key;
  leadEditStart = { key, text: field.value, solved: solvedInputValues.get(key), driver, turnDriver };
}

// Text for a field whose value the solve derives from the other values (null: plain input).
function leadDerivedFieldText(key, result) {
  if (!result) return null;
  const r = result.resolved;
  const p = result.profile.public;
  const table = {
    runInHeadingDeg: [r.runInHeadingDeg, "heading"],
    attackHeadingDeg: [r.attackHeadingDeg, 0],
    angleOffDeg: [r.angleOffDeg, 0],
    offsetAngleDeg: [r.offsetAngleDeg, 0],
    actionRangeNm: [r.actionRangeNm, 1],
    approachRangeNm: [r.approachRangeNm, 1],
    ipRangeNm: [r.ipRangeNm, 1],
    vrpRangeNm: [r.vrpRangeNm, 1],
    offsetG: [r.offsetG, 1],
    offsetBankDeg: [r.offsetBankDeg, 0],
    offsetRadiusNm: [r.offsetRadiusNm, 1],
    trackingTimeSec: [p.trackingTimeSec, 0],
    rollInAltitudeMslFt: [p.resolvedInitialAltitudeMslFt, 0],
  };
  const entry = table[key];
  if (!entry || !Number.isFinite(entry[0])) return null;
  const [value, digits] = entry;
  return { text: digits === "heading" ? formatBearingInput(value) : Number(value).toFixed(digits), value };
}

function fillEmptyLeadField(key) {
  const start = leadEditStart?.key === key ? leadEditStart : null;
  if (start) {
    driver = start.driver;
    turnDriver = start.turnDriver;
  }
  if (driver === key) driver = LEAD_FALLBACK_DRIVERS[key] ?? "vrpRangeNm";
  if (turnDriver === key) turnDriver = LEAD_TURN_FALLBACK[key] ?? "offsetG";
  const defaults = createDefaultPersistedState().inputs;
  let text = start?.text?.trim() ? start.text : leadDerivedFieldText(key, lastResult)?.text ?? String(defaults[key] ?? "");
  if (key === "rollInBankAngleDeg") {
    rollBankAuto = true;
    try {
      const full = automaticRollInBankDeg();
      text = full.toFixed(0);
      setValue(key, text, { includeActive: true });
      solvedInputValues.set(key, { text, value: full });
      calculate();
      return;
    } catch { /* keep the previous bank */ }
  } else if (key === "rollInAltitudeMslFt" && bdpSolveMode !== "time" && rollInAltitudeLinked) {
    text = String(Math.round(numberValue("initialAltitudeMslFt")));
  } else if (key === "initialAltitudeMslFt" && rollInAltitudeLinked) {
    text = String(Math.round(numberValue("rollInAltitudeMslFt")));
  } else if (key === "trackingTimeSec") {
    bdpSolveMode = "height";
  }
  setValue(key, text, { includeActive: true });
  if (start?.solved && valuesEquivalent(text, start.solved.text)) solvedInputValues.set(key, start.solved);
  else solvedInputValues.delete(key);
  calculate();
  const derived = leadDerivedFieldText(key, lastResult);
  if (derived && !locks[key]) {
    setValue(key, derived.text, { includeActive: true });
    solvedInputValues.set(key, derived);
  }
}

function handleFieldChange(event) {
  const field = event.target.closest?.("[data-key]");
  if (!field || field.id === "ip-bearing-input") return;
  if (field.tagName !== "SELECT" && field.value.trim() === "") {
    if (event.type === "change") fillEmptyLeadField(field.dataset.key);
    return;
  }
  syncDuplicates(field);
  const key = field.dataset.key;

  solvedInputValues.delete(key);

  // Initial ↔ Roll-in LINK and the internal BDP solve mode (2026-10-01). With LINK off an
  // Initial Altitude edit changes nothing in the solve (reference only).
  if (key === "initialAltitudeMslFt" && rollInAltitudeLinked) {
    solvedInputValues.delete("rollInAltitudeMslFt");
    setAutoValue("rollInAltitudeMslFt", Math.round(numberValue("initialAltitudeMslFt")), key);
    bdpSolveMode = "height";
  }
  if (key === "rollInAltitudeMslFt") {
    bdpSolveMode = "height";
    if (rollInAltitudeLinked) setAutoValue("initialAltitudeMslFt", Math.round(numberValue("rollInAltitudeMslFt")), key);
  }
  if (key === "trackingTimeSec") {
    bdpSolveMode = "time";
    // Tracking Time is whole seconds (BDP rounds it; user decision 2026-10-01): a committed entry
    // shows the value actually used.
    const entered = Number.parseFloat(field.value);
    if (Number.isFinite(entered)) {
      enteredTrackingTimeSec = Math.round(entered);
      if (event.type === "change") setValue("trackingTimeSec", String(enteredTrackingTimeSec), { includeActive: true });
    }
  }

  if (key === "vrpRangeNm") {
    vrpRangeExplicit = Number.isFinite(Number.parseFloat(field.value));
    driver = "vrpRangeNm";
    calculate();
    return;
  }

  if (key === "ipRangeNm") {
    // A change event that only commits the value the link already shows (the field was rewritten
    // by a re-link) is not a new IP edit and must not unlink IP again.
    if (event.type === "change" && ipLinked && lastResult && valuesEquivalent(field.value, Number(lastResult.resolved.ipRangeNm).toFixed(1))) {
      solvedInputValues.set(key, { text: field.value, value: lastResult.resolved.ipRangeNm });
      return;
    }
    ipLinked = false;
    driver = "ipRangeNm";
    calculate();
    // A committed IP Range inside VRP was pushed back out (re-linked): show the linked value now,
    // including in the field being edited.
    if (event.type === "change" && ipLinked && lastResult) {
      const text = Number(lastResult.resolved.ipRangeNm).toFixed(1);
      setValue("ipRangeNm", text, { includeActive: true });
      solvedInputValues.set("ipRangeNm", { text, value: lastResult.resolved.ipRangeNm });
    }
    return;
  }

  if (["offsetG", "offsetBankDeg", "offsetRadiusNm"].includes(key)) turnDriver = key;

  const diveAngleDeg = numberValue("diveAngleDeg");
  if (key === "rollInBankAngleDeg") {
    rollBankAuto = false;
    if (diveAngleDeg < LOW_ANGLE_BOUNDARY_DEG) {
      setSolvedValue("rollInG", levelTurnRollInGFull(numberValue("rollInBankAngleDeg")), 1, key);
    }
  }
  if (key === "diveAngleDeg") {
    rollBankAuto = true;
    applyAutomaticRollBank(key);
  }
  if (key === "rollInG" && diveAngleDeg < LOW_ANGLE_BOUNDARY_DEG) {
    rollBankAuto = true;
    applyAutomaticRollBank(key);
  }

  if (key === "runInHeadingDeg") {
    // Run-In only rotates the axis: a linked IP stays VRP + 3 NM on the new axis (user rule,
    // 2026-09-26). Only an explicit IP Range edit or an IP/VRP LOCK ends the IP<-VRP link.
    const parsed = Number.parseFloat(field.value);
    if (!Number.isFinite(parsed)) {
      driver = "runInHeadingDeg";
      calculate();
      return;
    }
    const runInHeadingDeg = normHeading(parsed);
    if (event.type === "change") {
      setValue("runInHeadingDeg", formatBearingInput(runInHeadingDeg), { includeActive: true });
    }
    syncIpBearingInput(runInHeadingDeg, { includeActive: true });
    syncImplicitReferenceInputs(runInHeadingDeg);
    driver = "runInHeadingDeg";
  } else if (key === "approachRangeNm") {
    driver = "approachRangeNm";
  } else if (["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm"].includes(key)) {
    driver = key;
  }
  // BDP / Offset Turn Condition edits (Dive Angle, Roll-in/Release Altitude, speeds, bomb,
  // G/Bank/Radius ...) are not tactical drivers: the last tactical driver keeps its constraint
  // (default VRP = Action Point held), so the unlocked Offset Angle / Angle-Off re-solve
  // against the new profile instead of the Action Point silently sliding.
  calculate();
}

function handleVipBearingInput(event) {
  const entered = Number.parseFloat(event.target.value);
  vipBearingExplicit = Number.isFinite(entered);
  calculate();
}

function handleVipRangeInput(event) {
  vipRangeExplicit = Number.isFinite(Number.parseFloat(event.target.value));
  calculate();
}

function handleIpBearingInput(event) {
  const entered = Number.parseFloat(event.target.value);
  if (!Number.isFinite(entered)) return;
  // The IP bearing is the Run-In axis in TO/FROM notation; like Run-In it keeps the IP<-VRP link.
  const canonical = canonicalToTargetBearing(entered, ipBearingDirection);
  if (locks.ipReference) ipLockHeadingDeg = canonical;
  setValue("runInHeadingDeg", canonical.toFixed(2), { includeActive: true });
  syncImplicitReferenceInputs(canonical);
  driver = "runInHeadingDeg";
  calculate();
}

function installLocks() {
  $$("[data-lock-key]").forEach((button) => {
    const key = button.dataset.lockKey;
    locks[key] = button.getAttribute("aria-pressed") === "true";
    button.addEventListener("click", () => {
      locks[key] = !locks[key];
      button.setAttribute("aria-pressed", String(locks[key]));
      button.textContent = locks[key] ? "LOCKED" : "LOCK";
      // Only an IP LOCK freezes IP; a VRP LOCK holds VRP and a linked IP keeps following it.
      if (key === "ipReference" && locks[key]) ipLinked = false;
      if (key === "ipReference" && locks[key]) ipLockHeadingDeg = readRunInHeading();
      if (["ipReference", "vrpReference"].includes(key)) driver = "referenceLock";
      calculate();
    });
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

  const setVipDirection = (nextDirection) => {
    const canonical = readVipToTargetBearing();
    vipBearingDirection = nextDirection;
    setDirectionButtons("vip", vipBearingDirection);
    syncVipBearingInput(canonical, { includeActive: true });
  };
  const setIpDirection = (nextDirection) => {
    const canonical = readRunInHeading();
    ipBearingDirection = nextDirection;
    setDirectionButtons("ip", ipBearingDirection);
    syncIpBearingInput(canonical, { includeActive: true });
  };

  $("#vip-to-target-btn").addEventListener("click", () => { setVipDirection("TO_TARGET"); savePersistedState(); });
  $("#vip-from-target-btn").addEventListener("click", () => { setVipDirection("FROM_TARGET"); savePersistedState(); });
  $("#ip-to-target-btn").addEventListener("click", () => { setIpDirection("TO_TARGET"); savePersistedState(); });
  $("#ip-from-target-btn").addEventListener("click", () => { setIpDirection("FROM_TARGET"); savePersistedState(); });

  vipBearingInput.addEventListener("input", handleVipBearingInput);
  vipBearingInput.addEventListener("blur", () => syncVipBearingInput(readVipToTargetBearing(), { includeActive: true }));
  vipRangeInput.addEventListener("input", handleVipRangeInput);
  vipRangeInput.addEventListener("blur", () => { vipRangeInput.value = formatNm(readVipRangeNm()); });

  vrpBearingInput.addEventListener("input", () => {
    vrpBearingExplicit = Number.isFinite(Number.parseFloat(vrpBearingInput.value));
    driver = "vrpBearingDeg";
    calculate();
  });
  vrpBearingInput.addEventListener("blur", () => { vrpBearingInput.value = formatBearingInput(readVrpBearing()); });
  vrpRangeInput?.addEventListener("blur", () => { vrpRangeInput.value = formatNm(readVrpRangeNm()); });

  ipBearingInput.addEventListener("input", handleIpBearingInput);
  ipBearingInput.addEventListener("blur", () => syncIpBearingInput(readRunInHeading(), { includeActive: true }));
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
  $$("[data-key]").forEach((control) => {
    const key = control.dataset.key;
    if (!key || control.id === "ip-bearing-input" || Object.prototype.hasOwnProperty.call(inputs, key)) return;
    const solved = solvedInputValues.get(key);
    inputs[key] = solved && valuesEquivalent(control.value, solved.text) ? String(solved.value) : control.value;
  });
  return {
    version: 3,
    inputs,
    vrpBearingInput: $("#vrp-bearing-input")?.value ?? "",
    vipBearingInput: $("#vip-bearing-input")?.value ?? "",
    vipRangeInput: $("#vip-range-input")?.value ?? "",
    referenceMode,
    vipBearingDirection,
    ipBearingDirection,
    ipLinked,
    ipLockHeadingDeg,
    rollInAltitudeLinked,
    solveMode: bdpSolveMode,
    enteredTrackingTimeSec,
    vipBearingExplicit,
    vipRangeExplicit,
    vrpBearingExplicit,
    vrpRangeExplicit,
    rollBankAuto,
    locks: { ...locks },
  };
}

function createDefaultPersistedState() {
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
    rollBankAuto: true,
    locks: Object.fromEntries(Object.keys(locks).map((key) => [key, false])),
  };
}

function applyPersistedState(saved) {
  if (!saved || typeof saved !== "object") return false;
  solvedInputValues.clear();
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

  if ($("#vrp-bearing-input") && typeof saved.vrpBearingInput === "string") $("#vrp-bearing-input").value = saved.vrpBearingInput;
  if ($("#vip-bearing-input") && typeof saved.vipBearingInput === "string") $("#vip-bearing-input").value = saved.vipBearingInput;
  if ($("#vip-range-input") && typeof saved.vipRangeInput === "string") $("#vip-range-input").value = saved.vipRangeInput;

  referenceMode = saved.referenceMode === "VIP" ? "VIP" : "VRP";
  vipBearingDirection = saved.vipBearingDirection === "FROM_TARGET" ? "FROM_TARGET" : "TO_TARGET";
  ipBearingDirection = saved.ipBearingDirection === "FROM_TARGET" ? "FROM_TARGET" : "TO_TARGET";
  ipLinked = saved.version >= 3 && saved.ipLinked !== false;
  ipLockHeadingDeg = Number.isFinite(saved.ipLockHeadingDeg) ? saved.ipLockHeadingDeg : readRunInHeading();
  rollInAltitudeLinked = saved.rollInAltitudeLinked !== false;
  // Before 2026-10-01 the solve mode was the Solve Mode select, saved with the inputs.
  const savedMode = saved.solveMode ?? oldInputs.solveMode;
  bdpSolveMode = savedMode === "time" ? "time" : "height";
  const savedTracking = Number(saved.enteredTrackingTimeSec ?? (bdpSolveMode === "time" ? saved.inputs.trackingTimeSec : NaN));
  enteredTrackingTimeSec = Number.isFinite(savedTracking) && savedTracking > 0 ? Math.round(savedTracking) : DEFAULT_TRACKING_TIME_SEC;
  vipBearingExplicit = saved.vipBearingExplicit === true;
  vipRangeExplicit = saved.vipRangeExplicit === true;
  vrpBearingExplicit = saved.vrpBearingExplicit === true;
  vrpRangeExplicit = saved.vrpRangeExplicit === true;
  rollBankAuto = saved.rollBankAuto !== false;

  Object.keys(locks).forEach((key) => {
    locks[key] = saved.locks?.[key] === true;
  });
  $$("[data-lock-key]").forEach((button) => {
    const key = button.dataset.lockKey;
    const locked = locks[key] === true;
    button.setAttribute("aria-pressed", String(locked));
    button.textContent = locked ? "LOCKED" : "LOCK";
  });

  syncReferencePanes();
  setDirectionButtons("vip", vipBearingDirection);
  setDirectionButtons("ip", ipBearingDirection);

  // Roll-in Altitude is the solve's value; a linked Initial Altitude shows it.
  if (rollInAltitudeLinked) {
    solvedInputValues.delete("initialAltitudeMslFt");
    setValue("initialAltitudeMslFt", Math.round(numberValue("rollInAltitudeMslFt")), { includeActive: true });
  }
  syncInitialLinkUi();
  const runInHeadingDeg = readRunInHeading();
  syncImplicitReferenceInputs(runInHeadingDeg, { includeActive: true });
  syncVipBearingInput(readVipToTargetBearing(), { includeActive: true });
  syncIpBearingInput(runInHeadingDeg, { includeActive: true });
  if (locks.ipReference) ipLinked = false;
  return true;
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const record = JSON.parse(raw);
    const previous = record.version === 4 ? record.aircraft?.["1"] : record;
    if (!previous) return false;
    if ((previous.version ?? 0) < 3 && !localStorage.getItem(`${STORAGE_KEY}.pre-vrp-start`)) {
      localStorage.setItem(`${STORAGE_KEY}.pre-vrp-start`, raw);
    }
    return applyPersistedState(previous);
  } catch {
    return false;
  }
}

function savePersistedState() {
  try {
    const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const aircraft = previous?.version === 4 && previous.aircraft && typeof previous.aircraft === "object"
      ? previous.aircraft : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, aircraft: { ...aircraft, "1": capturePersistedState() } }));
  } catch {
    // Storage may be unavailable in a restricted browser context; calculation remains usable.
  }
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

// Full BDP diagrams (BDP Top View + Profile) of one aircraft's BDP tab, drawn from the profile
// its own solve used; only while that tab's Full BDP is on (they are hidden otherwise).
function bdpDiagramsContainer(number) {
  const section = number === 1
    ? document.querySelector('#offset-calculator > .section[data-tab="bdp"]')
    : document.querySelector(`.flight-slot[data-aircraft="${number}"] .section[data-tab="bdp"]`);
  return section ? { section, container: section.querySelector("[data-bdp-diagrams]") } : null;
}

function refreshBdpDiagrams(number) {
  const target = bdpDiagramsContainer(number);
  if (!target?.container || !target.section.classList.contains("show-full-bdp")) return;
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
      topView: { orientation: "NORTH_UP", inHeadingDeg: result.geometry.offsetHeadingDeg, rollDirection: result.geometry.direction.rollDirection, context: "PATTERN" },
    });
  } catch {
    clearBdpDiagrams(target.container);
  }
}

function flashSaved(button) {
  const previous = button.textContent;
  button.textContent = "Saved";
  window.setTimeout(() => { button.textContent = previous; }, 900);
}

function installSectionTools(root = document) {
  root.querySelectorAll(".section[data-tab]").forEach((section) => {
    const header = section.firstElementChild;
    if (!header || header.querySelector(".section-tools")) return;
    const tools = TAB_TOOLS[section.dataset.tab] ?? [];
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
          if (tool === "fullBdp" && on) refreshBdpDiagrams(aircraft);
        });
      } else if (tool === "save") {
        make(tool, "Save").addEventListener("click", (event) => {
          savePersistedState();
          saveFlightLayout();
          flashSaved(event.currentTarget);
        });
      } else if (tool === "default") {
        make(tool, "Default").addEventListener("click", () => {
          if (aircraft === 1) resetLeadTab(section.dataset.tab, section);
          else resetFollowerTab(aircraft, section.dataset.tab);
        });
      }
    });
    const icon = header.querySelector(".section-collapse-icon");
    if (icon && icon.parentElement === header) header.insertBefore(group, icon);
    else header.append(group);
  });
}

// Default for one #1 tab: only that tab's inputs (and its locks / link states) return to
// their defaults; other tabs keep their current values.
function resetLeadTab(tab, section) {
  const current = capturePersistedState();
  const defaults = createDefaultPersistedState();
  section.querySelectorAll("[data-key]").forEach((control) => {
    const key = control.dataset.key;
    if (control.id !== "ip-bearing-input" && Object.hasOwn(defaults.inputs, key)) current.inputs[key] = defaults.inputs[key];
  });
  section.querySelectorAll("[data-lock-key]").forEach((button) => { current.locks[button.dataset.lockKey] = false; });
  if (tab === "bdp") {
    current.rollInAltitudeLinked = true;
    current.solveMode = "height";
    current.enteredTrackingTimeSec = DEFAULT_TRACKING_TIME_SEC;
    current.rollBankAuto = true;
  }
  if (tab === "reference") {
    for (const key of ["vrpBearingInput", "vipBearingInput", "vipRangeInput", "referenceMode", "vipBearingDirection", "ipBearingDirection", "ipLinked", "ipLockHeadingDeg", "vipBearingExplicit", "vipRangeExplicit", "vrpBearingExplicit", "vrpRangeExplicit"]) {
      current[key] = defaults[key];
    }
    current.inputs.runInHeadingDeg = defaults.inputs.runInHeadingDeg;
    driver = "vrpRangeNm";
  }
  if (tab === "offset") {
    driver = "vrpRangeNm";
    turnDriver = "offsetG";
  }
  applyPersistedState(current);
  section.querySelectorAll(".value-dependent-input").forEach((node) => node.classList.remove("value-dependent-input"));
  calculate();
  savePersistedState();
}

function resetFollowerTab(number, tab) {
  const draft = flightDraft(number);
  const defaults = defaultFlightDraft(number);
  (FOLLOWER_TAB_KEYS[tab] ?? []).forEach((key) => {
    draft[key] = defaults[key];
    followerSolvedValues.delete(`${number}:${key}`);
  });
  const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (slot) initializeFlightSlotFields(slot, number);
  saveFlightLayout();
  if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) recalculateFollowers(number);
}

// Follower BDP Advanced/Full BDP inputs owned per aircraft. An empty value follows #1's current
// value (Roll-in Bank: automatic from this aircraft's own Dive Angle), shown as the placeholder.
const FOLLOWER_BDP_EXTRA_KEYS = ["fragmentHeightMarginPercent", "recoveryG", "speedOvershootKcas", "gOnsetTimeSec", "rollInBankAngleDeg", "rollInG"];
// Per-tab keys reset by that tab's Default (follower aircraft).
const FOLLOWER_TAB_KEYS = {
  formation: ["side", "bearingDeg", "distanceNm"],
  bdp: ["weaponId", "initialSpeedValue", "initialAltitudeMslFt", "rollInAltitudeMslFt", "rollInAltitudeLinked", "diveAngleDeg", "trackingTimeSec", "solveMode", "enteredTrackingTimeSec", "releaseAltitudeMslFt", "releaseSpeedKcas", ...FOLLOWER_BDP_EXTRA_KEYS],
  offset: ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "offsetAngleLocked", "sameAngleAsLead", "actionRangeLocked", "sameTimeAsLead", "driver"],
};

// Default 4-ship positions (fingertip): #2 left of #1, #3 right of #1 at 2 NM, #4 right of #3.
// #1 offsets to its right by default, so the right-hand element solves cleanly from these values.
const FLIGHT_DEFAULT_POSITIONS = { 2: { side: "LEFT", distanceNm: "1" }, 3: { side: "RIGHT", distanceNm: "2" }, 4: { side: "RIGHT", distanceNm: "1" } };

function defaultFlightDraft(number = 2) {
  const position = FLIGHT_DEFAULT_POSITIONS[number] ?? FLIGHT_DEFAULT_POSITIONS[2];
  return {
    weaponId: "M82", side: position.side, bearingDeg: "90", distanceNm: position.distanceNm,
    initialSpeedValue: "350", initialAltitudeMslFt: "16000", diveAngleDeg: "45",
    rollInAltitudeMslFt: "16000", rollInAltitudeLinked: true,
    trackingTimeSec: "18", solveMode: "height", enteredTrackingTimeSec: "18", releaseAltitudeMslFt: "6800", releaseSpeedKcas: "450",
    ...Object.fromEntries(FOLLOWER_BDP_EXTRA_KEYS.map((key) => [key, ""])),
    attackHeadingDeg: "030", angleOffDeg: "70",
    offsetAngleDeg: "40", actionRangeNm: "7.0",
    offsetAngleLocked: false, sameAngleAsLead: true,
    actionRangeLocked: false, sameTimeAsLead: false,
    driver: "actionRangeNm",
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

function flightResultOf(number) {
  return number === 1 ? lastResult : flightResults.get(number) ?? null;
}

// Full-precision result of an aircraft, for the solves of the aircraft that follow it.
function flightResultFullOf(number) {
  return number === 1 ? lastResultFull : flightResultsFull.get(number) ?? null;
}

function saveFlightLayout() {
  try {
    localStorage.setItem(FLIGHT_LAYOUT_KEY, JSON.stringify(flightLayout));
  } catch {
    // The UI remains usable when browser storage is unavailable.
  }
}

// `heading` overrides "<title> #n" for graph sections, whose titles read "<Subject> #n <View>".
function flightSection(number, title, content, { calculating = false, tab = "", heading = null } = {}) {
  const badge = calculating ? "" : `<span class="flight-draft-badge">UI draft</span>`;
  const tabAttr = calculating && tab ? ` data-tab="${tab}" data-aircraft-tab="${number}"` : "";
  return `<section class="section flight-draft-section"${tabAttr}><div class="section-head"><h2>${heading ?? `${title} #${number}`}</h2>${badge}</div>${content}</section>`;
}

function followerExtraField(key, label) {
  return `<label class="field advanced-only bdp-extra"><span>${label} <span class="adv-tag">ADV</span></span><input data-flight-field="${key}" type="text" inputmode="decimal"></label>`;
}

// Same Text / Size / Reset / PNG / Advanced toolbar as Top View #1, scoped to one follower.
function followerTopViewToolbar(number) {
  return `<div class="diagram-actions"><div class="diagram-action-row"><div class="font-scale-control" role="group" aria-label="Top View #${number} font size"><span class="diagram-control-label">Text</span><button class="capture-button" type="button" data-ftv="text-down" aria-label="Top View #${number} font smaller">-</button><button class="capture-button diagram-scale-output" type="button" data-ftv="text-reset" aria-label="Reset Top View #${number} text size to 100%">100%</button><button class="capture-button" type="button" data-ftv="text-up" aria-label="Top View #${number} font larger">+</button></div><div class="view-scale-control" role="group" aria-label="Top View #${number} picture size"><span class="diagram-control-label">Size</span><button class="capture-button" type="button" data-ftv="zoom-out" aria-label="Picture smaller">-</button><button class="capture-button diagram-scale-output" type="button" data-ftv="size-reset" aria-label="Reset Top View #${number} size to 100%">100%</button><button class="capture-button" type="button" data-ftv="zoom-in" aria-label="Picture larger">+</button></div><button class="capture-button" type="button" data-ftv="reset">Reset</button><button class="capture-button" type="button" data-ftv="png">PNG</button><button class="capture-button view-toggle" type="button" data-ftv="ip-bottom" aria-pressed="true" title="Run-In (IP → Target) up; off = north up">IP Bottom</button><button class="capture-button" type="button" data-ftv="advanced" aria-pressed="false">Advanced: Off</button></div></div>`;
}

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
  return [
    flightSection(number, "Formation", `<p class="flight-draft-note">Start point relative to #${leadNumber}'s own IP; feeds this aircraft's Run-In line.</p>${followerFormationMarkup(leadNumber)}`, { calculating: true, tab: "formation" }),
    flightSection(number, "BDP", `<div class="input-grid"><label class="field flight-weapon-field"><span>Bomb</span><select data-flight-field="weaponId"></select></label><label class="field"><span>Initial Speed (KCAS)</span><input data-flight-field="initialSpeedValue" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Initial Altitude (ft MSL)</span><button class="lock-button" type="button" data-flight-field="rollInAltitudeLinked" aria-label="Link Initial Altitude to Roll-in Altitude" aria-pressed="true">LINKED</button></span><input data-flight-field="initialAltitudeMslFt" type="text" inputmode="decimal"><span class="unit" data-initial-link-note>Linked to Roll-in Altitude</span></label><label class="field"><span>Roll-in Altitude (ft MSL)</span><input data-flight-field="rollInAltitudeMslFt" type="text" inputmode="decimal"><span class="unit">BDP entry altitude</span></label><label class="field"><span>Dive Angle (deg)</span><input data-flight-field="diveAngleDeg" type="text" inputmode="decimal"></label><label class="field"><span>Tracking Time (sec)</span><input data-flight-field="trackingTimeSec" type="text" inputmode="decimal"><span class="unit">Whole seconds</span></label><label class="field"><span>Release Altitude (ft MSL)</span><input data-flight-field="releaseAltitudeMslFt" type="text" inputmode="decimal"></label><label class="field"><span>Release Speed (KCAS)</span><input data-flight-field="releaseSpeedKcas" type="text" inputmode="decimal"></label>${followerExtraField("fragmentHeightMarginPercent", "Fragment Height Margin (%)")}${followerExtraField("recoveryG", "Recovery G (G)")}${followerExtraField("speedOvershootKcas", "Speed Overshoot (KCAS)")}${followerExtraField("gOnsetTimeSec", "G Onset Time (sec)")}${followerExtraField("rollInBankAngleDeg", "Roll-in Bank Angle (deg)")}${followerExtraField("rollInG", "Roll-in G (G)")}</div><p class="flight-draft-note">Target Elevation and Wind are shared with #1 (same Target). Full BDP fields left blank follow #1 (Roll-in Bank: automatic from this aircraft's Dive Angle).</p>${bdpDiagramsMarkup({ aircraftNumber: number })}`, { calculating: true, tab: "bdp" }),
    flightSection(number, "Offset", `<div class="section-head"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div><div class="input-grid"><label class="field"><span>Run-In Heading</span><output data-flight-readout="runInHeadingDeg">-</output><span class="unit">Follows #1 · parallel Run-In</span></label><label class="field"><span>IP Range from Target</span><output data-flight-readout="ipRangeFromTargetNm">-</output><span class="unit">NM · from Formation position</span></label><label class="field"><span>Attack Heading (deg)</span><input data-flight-field="attackHeadingDeg" type="text" inputmode="decimal"></label><label class="field"><span>Angle-Off (deg)</span><input data-flight-field="angleOffDeg" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Offset Angle (deg)</span><span class="lock-group"><button class="lock-button" type="button" data-flight-field="offsetAngleLocked" aria-pressed="false">LOCK</button>${wingman ? `<button class="lock-button" type="button" data-flight-field="sameAngleAsLead" aria-pressed="false" title="Align Offset Angle to #${leadNumber}">ANGLE #${leadNumber}</button>` : ""}</span></span><input data-flight-field="offsetAngleDeg" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Action Range (NM)</span><span class="lock-group"><button class="lock-button" type="button" data-flight-field="actionRangeLocked" aria-pressed="false">LOCK</button>${wingman ? `<button class="lock-button" type="button" data-flight-field="sameTimeAsLead" aria-pressed="false" title="Align Action timing to #${leadNumber}">TIME #${leadNumber}</button>` : ""}</span></span><input data-flight-field="actionRangeNm" type="text" inputmode="decimal"><span class="unit">Target → Action Point</span></label></div><div id="flight-status-${number}" class="status-message valid">-</div>`, { calculating: true, tab: "offset" }),
    flightSection(number, "Z-Diagram", `<div class="diagram-actions"><div class="diagram-action-row"><button class="capture-button" type="button" data-flight-z-png>PNG</button></div></div><div class="z-diagram-shell"><svg data-flight-z viewBox="0 0 650 710" role="img" aria-label="${offsetZDiagramTitle({ aircraftNumber: number })}"><g data-z-root></g></svg></div>`, { calculating: true, heading: offsetZDiagramTitle({ aircraftNumber: number }) }),
    flightSection(number, "Top View", `${followerTopViewToolbar(number)}<div class="top-view-shell"><svg data-flight-topview viewBox="0 0 ${TOP_VIEW_WIDTH} ${OFFSET_TOP_VIEW_V0_1.canvas.maxHeight}" role="img" aria-label="${offsetTopViewTitle({ aircraftNumber: number })}"></svg></div><p class="flight-draft-note">Leader #${leadNumber}'s already-solved profile is drawn in full alongside this aircraft's own, sharing Target and scale; it does not feed aircraft #${number}'s own solve.</p>`, { calculating: true, heading: offsetTopViewTitle({ aircraftNumber: number }) }),
    // Same variables as Result #1 first (same groups and order), then what only this aircraft has.
    flightSection(number, "Result", `<div class="compact-results" data-flight-result-panel><div class="result-panel-head"><span></span><div data-result-controls aria-label="Result #${number} display controls"></div></div><div class="result-panel-body"><div data-result-group><h3>Offset</h3><table><tbody class="result-rows" data-flight-result="offset"></tbody></table></div><div data-result-group><h3>Bomb Profile</h3><table><tbody class="result-rows" data-flight-result="profile"></tbody></table></div><div data-result-group><h3>#${number} vs #${predecessor}</h3><table><tbody class="result-rows" data-flight-result="flight"></tbody></table></div><p data-result-empty>No available summary results.</p></div></div>`, { calculating: true }),
    FLIGHT_DED_AIRCRAFT.has(number) ? flightSection(number, "DED", followerDedMarkup(), { calculating: true }) : flightSection(number, "DED", `<p class="flight-draft-note">Aircraft #${number} DED is pending its profile result.</p>`),
  ].join("");
}

// Same two green boxes as DED #1: the reference page (VRP or VIP, following #1's Reference Point
// mode) and OA1.
function followerDedMarkup() {
  const rows = (page) => ["bearing:TBRG", "range:RNG", "elevation:ELEV"].map((item) => {
    const [key, label] = item.split(":");
    return `<div class="ded-row"><span>${label}</span><output data-flight-ded="${page}-${key}">-</output></div>`;
  }).join("");
  return `<div class="ded-boxes"><div class="ded-screen" aria-live="polite"><div class="ded-page-title" data-flight-ded="reference-title">VRP</div>${rows("reference")}</div><div class="ded-screen" aria-live="polite"><div class="ded-page-title">OA1</div>${rows("oa1")}</div></div>`;
}

// Follower LOCK / ANGLE #n / TIME #n buttons share #1's LOCK button format: pressed state via
// aria-pressed, and a LOCK reads LOCKED while on (same as installLocks on #1).
const FOLLOWER_LOCK_KEYS = new Set(["offsetAngleLocked", "actionRangeLocked"]);
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

function renderFlightLayout() {
  const host = $("#flight-followers");
  $("#flight-size").value = String(flightLayout.size);
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
  // Result #n gets the same Text / Advanced controls as Result #1 (summary rows by default).
  followerResultPanels.clear();
  host.querySelectorAll(".flight-slot").forEach((slot) => {
    const panel = slot.querySelector("[data-flight-result-panel]");
    if (panel) followerResultPanels.set(Number(slot.dataset.aircraft), installResultPanel(panel));
  });
  recalculateFollowers();
}

function installFlightLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(FLIGHT_LAYOUT_KEY) || "null");
    if (saved && Number.isInteger(saved.size) && saved.size >= 1 && saved.size <= 4) {
      flightLayout.size = saved.size;
      if (saved.aircraft && typeof saved.aircraft === "object" && !Array.isArray(saved.aircraft)) {
        for (const number of [2, 3, 4]) {
          const record = saved.aircraft[number];
          if (!record || typeof record !== "object" || Array.isArray(record)) continue;
          const fallback = flightDraft(number);
          const str = (key) => typeof record[key] === "string" ? record[key] : fallback[key];
          flightLayout.aircraft[number] = {
            weaponId: typeof record.weaponId === "string" ? record.weaponId : "M82",
            side: record.side === "RIGHT" ? "RIGHT" : "LEFT",
            bearingDeg: str("bearingDeg"),
            distanceNm: str("distanceNm"),
            initialSpeedValue: str("initialSpeedValue"),
            initialAltitudeMslFt: str("initialAltitudeMslFt"),
            rollInAltitudeMslFt: str("rollInAltitudeMslFt"),
            rollInAltitudeLinked: record.rollInAltitudeLinked !== false,
            diveAngleDeg: str("diveAngleDeg"),
            trackingTimeSec: str("trackingTimeSec"),
            solveMode: record.solveMode === "time" ? "time" : "height",
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
            offsetAngleLocked: record.offsetAngleLocked === true,
            sameAngleAsLead: record.sameAngleAsLead === true,
            actionRangeLocked: record.actionRangeLocked === true,
            sameTimeAsLead: record.sameTimeAsLead === true,
            driver: FLIGHT_TACTICAL_DRIVERS.includes(record.driver) ? record.driver : "actionRangeNm",
          };
        }
      }
    }
  } catch {
    // Ignore malformed or unavailable presentation-only storage.
  }
  $("#flight-size").addEventListener("change", (event) => {
    flightLayout.size = Math.max(1, Math.min(4, Number(event.target.value) || 1));
    renderFlightLayout();
    saveFlightLayout();
  });
  const flightSlotNumber = (node) => {
    const number = Number(node?.closest?.(".flight-slot")?.dataset.aircraft);
    return Number.isInteger(number) && number >= 2 && number <= 4 ? number : null;
  };
  const updateFlightDraft = (event) => {
    const field = event.target.closest?.("[data-flight-field]");
    const number = flightSlotNumber(field);
    if (!field || !number) return;
    const key = field.dataset.flightField;
    const draft = flightDraft(number);
    // Empty-field commit, same rule as #1: blank Full-BDP extras keep meaning "follow #1".
    if (field.tagName !== "SELECT" && field.type !== "checkbox" && field.value.trim() === "" && !FOLLOWER_BDP_EXTRA_KEYS.includes(key)) {
      if (event.type === "change") fillEmptyFollowerField(number, field, key);
      return;
    }
    draft[key] = field.type === "checkbox" ? field.checked : field.value;
    // Mirrors #1's Initial Altitude -> Roll-in Altitude default link (index.html's
    // rollInAltitudeMslFt field / rollInAltitudeLinked): Roll-in Altitude is the actual BDP
    // entry altitude and follows Initial Altitude until explicitly edited on its own.
    // LINK (2026-10-01): Initial and Roll-in hold the same value from either side; off, Initial is
    // reference only. The BDP solve mode is internal: last edited Roll-in/Initial or Tracking Time.
    const slotNode = field.closest(".flight-slot");
    if (key === "initialAltitudeMslFt" && draft.rollInAltitudeLinked) {
      draft.rollInAltitudeMslFt = field.value;
      followerSolvedValues.delete(`${number}:rollInAltitudeMslFt`);
      const rollInField = followerField(slotNode, "rollInAltitudeMslFt");
      if (rollInField && rollInField !== document.activeElement) rollInField.value = field.value;
      draft.solveMode = "height";
    } else if (key === "rollInAltitudeMslFt") {
      draft.solveMode = "height";
      if (draft.rollInAltitudeLinked) {
        draft.initialAltitudeMslFt = field.value;
        const initialField = followerField(slotNode, "initialAltitudeMslFt");
        if (initialField && initialField !== document.activeElement) initialField.value = field.value;
      }
    } else if (key === "trackingTimeSec") {
      draft.solveMode = "time";
      const entered = Number.parseFloat(field.value);
      if (Number.isFinite(entered)) {
        // Whole seconds (BDP rounds; user decision 2026-10-01): a committed entry shows that value.
        draft.enteredTrackingTimeSec = String(Math.round(entered));
        if (event.type === "change") {
          field.value = draft.enteredTrackingTimeSec;
          draft.trackingTimeSec = draft.enteredTrackingTimeSec;
        }
      }
    }
    followerSolvedValues.delete(`${number}:${key}`);
    // Same rule as #1's handleFieldChange: only tactical Offset edits become the driver; BDP
    // edits keep the last tactical constraint so the unlocked geometry re-solves around it.
    if (FLIGHT_TACTICAL_DRIVERS.includes(key)) draft.driver = key;
    saveFlightLayout();
    // Later aircraft depend on this one (drop-order predecessor, #4 on #3).
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) recalculateFollowers(number);
  };
  $("#flight-followers").addEventListener("focusin", (event) => {
    const field = event.target.closest?.("input[data-flight-field]");
    const number = flightSlotNumber(field);
    if (!field || !number) return;
    const key = field.dataset.flightField;
    followerEditStart = { number, key, text: field.value, driver: flightDraft(number).driver, solved: followerSolvedValues.get(`${number}:${key}`) };
  });
  $("#flight-followers").addEventListener("input", updateFlightDraft);
  $("#flight-followers").addEventListener("change", updateFlightDraft);
  $("#flight-followers").addEventListener("click", (event) => {
    const button = event.target.closest?.(".lock-button[data-flight-field]");
    const number = flightSlotNumber(button);
    if (!button || !number) return;
    const slot = button.closest(".flight-slot");
    const draft = flightDraft(number);
    const key = button.dataset.flightField;
    draft[key] = !draft[key];
    syncFlightToggleButton(button, draft[key]);
    if (key === "rollInAltitudeLinked" && draft[key]) {
      // Turning LINK on copies Roll-in Altitude (the solve's value) into Initial Altitude.
      const rollIn = Number.parseFloat(followerField(slot, "rollInAltitudeMslFt")?.value ?? draft.rollInAltitudeMslFt);
      if (Number.isFinite(rollIn)) {
        draft.initialAltitudeMslFt = String(Math.round(rollIn));
        const initialField = followerField(slot, "initialAltitudeMslFt");
        if (initialField) initialField.value = draft.initialAltitudeMslFt;
      }
    }
    if (draft[key] && FLIGHT_TOGGLE_EXCLUSIONS[key]) {
      FLIGHT_TOGGLE_EXCLUSIONS[key].forEach((excludedKey) => {
        draft[excludedKey] = false;
        const excludedButton = slot?.querySelector(`.lock-button[data-flight-field="${excludedKey}"]`);
        if (excludedButton) syncFlightToggleButton(excludedButton, false);
      });
    }
    saveFlightLayout();
    // Later aircraft depend on this one (drop-order predecessor, #4 on #3).
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) recalculateFollowers(number);
  });
  renderFlightLayout();
}

// Follower counterpart of fillEmptyLeadField: the emptied field stops driving and is filled from the
// other values (solved coupled value, Roll-in Altitude link, derived Tracking Time), or keeps the
// value it had before the edit.
let followerEditStart = null;
const FOLLOWER_FALLBACK_DRIVERS = { actionRangeNm: "offsetAngleDeg" };

function followerDerivedFieldText(key, result) {
  if (!result) return null;
  const table = {
    attackHeadingDeg: [result.resolved.attackHeadingDeg, 0],
    angleOffDeg: [result.resolved.angleOffDeg, 0],
    offsetAngleDeg: [result.resolved.offsetAngleDeg, 0],
    actionRangeNm: [result.resolved.actionRangeNm, 1],
    trackingTimeSec: [result.profile.public.trackingTimeSec, 0],
    rollInAltitudeMslFt: [result.profile.public.resolvedInitialAltitudeMslFt, 0],
  };
  const entry = table[key];
  if (!entry || !Number.isFinite(entry[0])) return null;
  return { text: Number(entry[0]).toFixed(entry[1]), value: entry[0] };
}

function fillEmptyFollowerField(number, field, key) {
  const draft = flightDraft(number);
  const start = followerEditStart?.number === number && followerEditStart.key === key ? followerEditStart : null;
  if (start && FLIGHT_TACTICAL_DRIVERS.includes(start.driver)) draft.driver = start.driver;
  if (draft.driver === key) draft.driver = FOLLOWER_FALLBACK_DRIVERS[key] ?? "actionRangeNm";
  let text = start?.text?.trim() ? start.text : String(draft[key] ?? defaultFlightDraft(number)[key] ?? "");
  if (key === "rollInAltitudeMslFt" && draft.solveMode !== "time" && draft.rollInAltitudeLinked) {
    text = String(draft.initialAltitudeMslFt);
  } else if (key === "initialAltitudeMslFt" && draft.rollInAltitudeLinked) {
    text = String(draft.rollInAltitudeMslFt);
  } else if (key === "trackingTimeSec") {
    draft.solveMode = "height";
  }
  field.value = text;
  draft[key] = text;
  const solvedKey = `${number}:${key}`;
  if (start?.solved && start.solved.text === text) followerSolvedValues.set(solvedKey, start.solved);
  else followerSolvedValues.delete(solvedKey);
  saveFlightLayout();
  if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) recalculateFollowers(number);
  // The field is still focused, which the normal solved-value sync skips: write it here.
  const derived = followerDerivedFieldText(key, flightResults.get(number));
  const lockedKey = { offsetAngleDeg: "offsetAngleLocked", actionRangeNm: "actionRangeLocked" }[key];
  if (derived && !(lockedKey && draft[lockedKey])) {
    field.value = derived.text;
    draft[key] = derived.text;
    followerSolvedValues.set(solvedKey, derived);
    saveFlightLayout();
  }
}

function followerField(slot, key) {
  return slot.querySelector(`[data-flight-field="${key}"]`);
}

// Full-precision values behind follower fields that display a rounded solved value (same idea as
// #1's solvedInputValues); keyed "<aircraft>:<field>" and dropped when the user edits the field.
const followerSolvedValues = new Map();

function followerNumberValue(slot, draft, key) {
  const raw = followerField(slot, key)?.value ?? draft[key];
  const number = Number(slot?.closest?.(".flight-slot")?.dataset.aircraft ?? slot?.dataset?.aircraft);
  const solved = followerSolvedValues.get(`${number}:${key}`);
  if (solved && String(raw) === solved.text) return solved.value;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) throw new TypeError(`${key} must be numeric`);
  return parsed;
}

function followerIpPoint(number, slot, leaderResult) {
  const draft = flightDraft(number);
  const side = followerField(slot, "side")?.value === "RIGHT" ? "RIGHT" : "LEFT";
  const relativeBearingDeg = followerNumberValue(slot, draft, "bearingDeg");
  const distanceNm = followerNumberValue(slot, draft, "distanceNm");
  const { vector } = computeFormationOffsetVector({
    runInHeadingDeg: leaderResult.resolved.runInHeadingDeg,
    relativeBearingDeg,
    side,
    distanceNm,
  });
  return addWorldPoints(leaderResult.geometry.points.ip, vector);
}

function buildFollowerInput(number, slot, leaderResult) {
  const draft = flightDraft(number);
  const num = (key) => followerNumberValue(slot, draft, key);
  const offsetAngleLocked = followerField(slot, "offsetAngleLocked")?.getAttribute("aria-pressed") === "true";
  const sameAngleAsLead = followerField(slot, "sameAngleAsLead")?.getAttribute("aria-pressed") === "true";
  const actionRangeLocked = followerField(slot, "actionRangeLocked")?.getAttribute("aria-pressed") === "true";
  const sameTimeAsLead = followerField(slot, "sameTimeAsLead")?.getAttribute("aria-pressed") === "true";

  if (sameAngleAsLead && offsetAngleLocked) throw new Error("CONSTRAINT CONFLICT: Angle #n (Offset Angle same as element lead) cannot combine with a manual Offset Angle LOCK");
  if (sameTimeAsLead && actionRangeLocked) throw new Error("CONSTRAINT CONFLICT: Time #n (Action at the element lead's time) cannot combine with a manual Action Range LOCK");

  // Follower BDP extras: an entered value is this aircraft's own; blank follows #1.
  const own = (key) => {
    const parsed = Number.parseFloat(followerField(slot, key)?.value ?? draft[key]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const runInHeadingDeg = leaderResult.resolved.runInHeadingDeg;
  const ipPoint = followerIpPoint(number, slot, leaderResult);
  const sharedProfile = leaderResult.profile.canonicalInputs;
  // Plain mode (no element-lead toggle) mirrors #1's VRP-start default: the last tactical edit
  // drives, defaulting to this aircraft's own Action Point (Target-referenced Action Range) held,
  // so a BDP change (e.g. Dive) re-solves the unlocked Offset Angle; after an Offset Angle edit it
  // is held instead and the Action Range moves. A manual Offset Angle LOCK plus a held Action
  // Point is the both-fixed case calculateFollower solves through Roll-in Altitude/Tracking Time.
  const draftDriver = FLIGHT_TACTICAL_DRIVERS.includes(draft.driver) ? draft.driver : "actionRangeNm";
  const driver = actionRangeLocked
    ? "actionRangeNm"
    : offsetAngleLocked && draftDriver === "actionRangeNm" ? "offsetAngleDeg" : draftDriver;
  const rollInG = own("rollInG") ?? sharedProfile.rollInG;

  const baseInput = {
    driver,
    turnDriver: "offsetG",
    locks: { offsetAngleDeg: offsetAngleLocked, actionRangeNm: actionRangeLocked },
    runInHeadingDeg,
    ipPoint,
    attackHeadingDeg: num("attackHeadingDeg"),
    angleOffDeg: num("angleOffDeg"),
    offsetAngleDeg: num("offsetAngleDeg"),
    actionRangeNm: num("actionRangeNm"),
    offsetAltitudeMslFt: leaderResult.resolved.offsetAltitudeMslFt,
    offsetSpeedValue: leaderResult.resolved.offsetSpeedValue,
    offsetSpeedMode: leaderResult.resolved.offsetSpeedMode,
    offsetG: leaderResult.resolved.offsetG,
    offsetBankDeg: leaderResult.resolved.offsetBankDeg,
    offsetRadiusNm: leaderResult.resolved.offsetRadiusNm,
    profile: {
      weaponId: followerField(slot, "weaponId")?.value || draft.weaponId,
      targetElevationMslFt: sharedProfile.targetElevationMslFt,
      // Same true wind as #1 (same Target); converted to this aircraft's own Attack Heading by the BE.
      windDirectionTrueDeg: numberValue("windDirectionDeg"),
      windSpeedKt: sharedProfile.windSpeedKt,
      recoveryG: own("recoveryG") ?? sharedProfile.recoveryG,
      gOnsetTimeSec: own("gOnsetTimeSec") ?? sharedProfile.gOnsetTimeSec,
      speedOvershootKcas: own("speedOvershootKcas") ?? sharedProfile.speedOvershootKcas,
      fragmentHeightMarginPercent: own("fragmentHeightMarginPercent") ?? sharedProfile.fragmentHeightMarginPercent,
      diveAngleDeg: num("diveAngleDeg"),
      initialSpeedValue: num("initialSpeedValue"),
      initialSpeedMode: "CAS",
      // Matches #1's own adapter mapping (line ~314): Roll-in Altitude, not the "Initial
      // Altitude" field, is the actual BDP entry altitude (OA1).
      initialAltitudeMslFt: num("rollInAltitudeMslFt"),
      solveMode: draft.solveMode === "time" ? "time" : "height",
      // Height mode shows a derived Tracking Time; BDP only uses it at Dive 0°, where the last
      // entered value applies (BDP public.resolvedSolveMode).
      trackingTimeSec: draft.solveMode === "time" ? num("trackingTimeSec") : followerEnteredTrackingTimeSec(draft),
      releaseAltitudeMslFt: num("releaseAltitudeMslFt"),
      releaseSpeedKcas: num("releaseSpeedKcas"),
      rollInBankAngleDeg: own("rollInBankAngleDeg") ?? followerAutoRollBank(num("diveAngleDeg"), rollInG),
      rollInG,
    },
  };
  return { baseInput, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked };
}

function followerEnteredTrackingTimeSec(draft) {
  const entered = Number.parseFloat(draft.enteredTrackingTimeSec);
  return Number.isFinite(entered) && entered > 0 ? Math.round(entered) : 18;
}

// Same automatic Roll-in Bank rule as #1 (BDP autoRollInBankDegFull), from this aircraft's own Dive.
function followerAutoRollBank(diveAngleDeg, rollInG) {
  return autoRollInBankDegFull({ diveAngleDeg, rollInG });
}

// Placeholders show what a blank follower BDP extra currently follows.
function syncFollowerExtraPlaceholders(slot, result) {
  const inputs = result.profile.canonicalInputs;
  FOLLOWER_BDP_EXTRA_KEYS.forEach((key) => {
    const field = followerField(slot, key);
    if (!field) return;
    const value = inputs[key];
    const text = key === "rollInBankAngleDeg" ? `auto ${formatDeg(value)}` : `#1 ${key === "rollInG" ? formatG(value) : formatDeg(value)}`;
    field.placeholder = Number.isFinite(value) ? text : "";
  });
  const section = slot.querySelector('.section[data-tab="bdp"]');
  if (section) section.dataset.solveMode = flightDraft(Number(slot.dataset.aircraft)).solveMode === "time" ? "time" : "height";
}

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
  const body = (group) => slot.querySelector(`[data-flight-result="${group}"]`);
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

function syncFollowerResolvedFields(number, slot, result, { pairSolved = false } = {}) {
  const draft = flightDraft(number);
  const active = document.activeElement;
  const sync = (key, value, digits) => {
    if (!Number.isFinite(value)) return;
    const text = value.toFixed(digits);
    const field = followerField(slot, key);
    if (field && field !== active) field.value = text;
    draft[key] = text;
    followerSolvedValues.set(`${number}:${key}`, { text, value });
  };
  sync("offsetAngleDeg", result.resolved.offsetAngleDeg, 0);
  sync("actionRangeNm", result.resolved.actionRangeNm, 1);
  sync("attackHeadingDeg", result.resolved.attackHeadingDeg, 0);
  sync("angleOffDeg", result.resolved.angleOffDeg, 0);
  const p = result.profile.public;
  // LINK on: Initial Altitude shows Roll-in Altitude.
  const syncLinkedInitial = (value) => { if (draft.rollInAltitudeLinked) sync("initialAltitudeMslFt", value, 0); };
  if (pairSolved) {
    // Offset Angle and Action Point both fixed: Roll-in Altitude and Tracking Time were solved
    // together (see calculateFollower); Dive Angle stays this aircraft's own input.
    sync("rollInAltitudeMslFt", p.resolvedInitialAltitudeMslFt, 0);
    sync("trackingTimeSec", p.trackingTimeSec, 0);
    syncLinkedInitial(p.resolvedInitialAltitudeMslFt);
    return;
  }
  // BDP solve-mode coupling, same rule as #1 (applyBdpSolveCoupling); Dive 0° always uses
  // Tracking Time (resolvedSolveMode).
  if ((p.resolvedSolveMode ?? draft.solveMode) === "time") {
    if (draft.solveMode !== "time") {
      const text = String(followerEnteredTrackingTimeSec(draft));
      const field = followerField(slot, "trackingTimeSec");
      if (field && field !== active) field.value = text;
      draft.trackingTimeSec = text;
      followerSolvedValues.delete(`${number}:trackingTimeSec`);
    }
    sync("rollInAltitudeMslFt", p.resolvedInitialAltitudeMslFt, 0);
    syncLinkedInitial(p.resolvedInitialAltitudeMslFt);
  } else {
    sync("trackingTimeSec", p.trackingTimeSec, 0);
    syncLinkedInitial(followerNumberValue(slot, draft, "rollInAltitudeMslFt"));
  }
}


// Both Top View calls below share one auto-fit projection (each passes the other's world points
// as extraFitPoints), so the element lead's full-fidelity render and this aircraft's own render
// land in the same scale/frame and their Target markers coincide. The lead layer is drawn exactly
// as in its own Top View; this aircraft's layer uses the follower palette, "#n"-prefixed labels,
// and places its labels clear of the lead's labels and paths (and vice versa for the paths).
// Per-follower Top View presentation state (Text scale / Advanced), same controls as Top View #1.
const followerTopViewState = new Map();
function followerTopView(number) {
  if (!followerTopViewState.has(number)) followerTopViewState.set(number, { textScale: TOP_VIEW_TEXT_SCALE_DEFAULT, advanced: false, ipBottom: true });
  return followerTopViewState.get(number);
}

function installFollowerTopViewControls(number, slot) {
  const svg = slot.querySelector("svg[data-flight-topview]");
  if (!svg || svg.dataset.controlsInstalled) return;
  svg.dataset.controlsInstalled = "true";
  const control = (name) => slot.querySelector(`[data-ftv="${name}"]`);
  installOffsetTopViewControls(svg, {
    zoomInButton: control("zoom-in"),
    zoomOutButton: control("zoom-out"),
    sizeResetButton: control("size-reset"),
    resetButton: control("reset"),
  });
  const state = followerTopView(number);
  const syncText = () => {
    control("text-reset").textContent = `${Math.round(state.textScale * 100)}%`;
    control("text-down").disabled = state.textScale <= 0.5;
    control("text-up").disabled = state.textScale >= 2;
    const advanced = control("advanced");
    advanced.setAttribute("aria-pressed", String(state.advanced));
    advanced.classList.toggle("active", state.advanced);
    advanced.textContent = `Advanced: ${state.advanced ? "On" : "Off"}`;
    control("ip-bottom").setAttribute("aria-pressed", String(state.ipBottom));
  };
  const redraw = () => {
    const leadNumber = elementLeadNumber(number);
    const leaderResult = leadNumber === 1 ? lastResult : flightResults.get(leadNumber);
    if (leaderResult) renderFollowerTopView(number, slot, leaderResult, flightResults.get(number) ?? null);
  };
  const setText = (value) => {
    state.textScale = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10));
    syncText();
    redraw();
  };
  control("text-down").addEventListener("click", () => setText(state.textScale - 0.1));
  control("text-up").addEventListener("click", () => setText(state.textScale + 0.1));
  control("text-reset").addEventListener("click", () => setText(TOP_VIEW_TEXT_SCALE_DEFAULT));
  control("advanced").addEventListener("click", () => {
    state.advanced = !state.advanced;
    syncText();
    redraw();
  });
  control("ip-bottom").addEventListener("click", () => {
    state.ipBottom = !state.ipBottom;
    syncText();
    redraw();
  });
  control("png").addEventListener("click", () => exportOffsetTopView(svg, offsetTopViewTitle({ aircraftNumber: number })));
  syncText();
  const zPng = slot.querySelector("[data-flight-z-png]");
  const zSvg = slot.querySelector("svg[data-flight-z]");
  if (zPng && zSvg) zPng.addEventListener("click", () => saveSvgAsPng(zSvg, `${offsetZDiagramTitle({ aircraftNumber: number }).replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" }));
}

// Offset #n Z (every aircraft, 2026-10-01). ΔTime is the drop-order delta: #(n-1) Impact − #n
// Release for #n; #1 shows #2's, so Z #1 and Z #2 carry the same ΔTime.
function zDeltaTime(releaseNumber) {
  if (releaseNumber > flightLayout.size || !FLIGHT_CALCULATING_AIRCRAFT.has(releaseNumber)) return null;
  const predecessor = flightResultFullOf(releaseNumber - 1);
  const own = flightResultsFull.get(releaseNumber);
  if (!predecessor || !own) return null;
  const delta = computeDropOrderDelta({ predecessorResult: predecessor, ownResult: own });
  return { impactNumber: releaseNumber - 1, releaseNumber, seconds: delta.predecessorImpactToOwnReleaseSec };
}

function renderZDiagramOf(number, svg, resultFull) {
  if (!svg) return false;
  delete svg.dataset.calculationFailed;
  return renderOffsetZDiagram(svg, resultFull, { aircraftNumber: number, deltaTime: zDeltaTime(Math.max(2, number)) });
}

// Offset #n Top View: this aircraft and its element lead in one frame (BE-owned Flight view).
function renderFollowerTopView(number, slot, leaderResult, result) {
  const svg = slot.querySelector("svg[data-flight-topview]");
  if (!svg) return;
  delete svg.dataset.calculationFailed;
  const view = followerTopView(number);
  // Both layers share one rotation: the lead's Run-In (followers fly parallel Run-In lines).
  const rendered = renderOffsetFlightTopView(svg, leaderResult, result, {
    aircraftNumber: number,
    leadNumber: elementLeadNumber(number),
    textScale: view.textScale,
    viewportWidth: globalThis.innerWidth,
    advanced: view.advanced,
    upHeadingDeg: view.ipBottom ? leaderResult.resolved.runInHeadingDeg : 0,
    northArrow: !view.ipBottom,
  });
  syncTopViewViewport(svg, rendered, result ?? leaderResult);
}

function calculateFollower(number) {
  const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (!slot) return;
  const leadNumber = elementLeadNumber(number);
  try {
    // Solves read the lead's full-precision result; the truncated one is only drawn.
    const leaderResult = flightResultFullOf(leadNumber);
    if (!leaderResult) throw new Error(`Aircraft #${leadNumber} has no current result`);
    const { baseInput, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked } = buildFollowerInput(number, slot, leaderResult);
    // IP limit (user rule, 2026-09-27): no follower's Action Point may lie below the Flight IP
    // (#1's IP, VRP + 3 NM when linked) in the IP Bottom view. Violations stay INVALID but drawn.
    if (lastResultFull?.geometry?.points?.ip) baseInput.ipLimitPoint = lastResultFull.geometry.points.ip;
    // Offset Angle is fixed by Angle #n or its LOCK; the Action Point by Time #n or the Action
    // Range LOCK. With one of them free, a BDP edit (e.g. Dive Angle) moves the free one; with
    // both fixed it moves this aircraft's Roll-in Altitude / Tracking Time (user rule, 2026-09-26).
    const angleInput = sameAngleAsLead ? applyElementLeadOffsetAngle({ leaderResult, followerInput: baseInput }) : baseInput;
    const angleFixed = sameAngleAsLead || offsetAngleLocked;
    const actionFixed = sameTimeAsLead || actionRangeLocked;

    let result;
    let pairSolved = false;
    if (angleFixed && actionFixed) {
      // Search the active Solve Mode's own input (Roll-in Altitude in height mode, Tracking Time
      // in time mode); BDP derives the other, so both change while Dive Angle stays as entered.
      const timeMode = baseInput.profile.solveMode === "time";
      const pairKey = timeMode ? "trackingTimeSec" : "initialAltitudeMslFt";
      const fixedAngleInput = { ...angleInput, driver: "offsetAngleDeg", locks: { offsetAngleDeg: !!angleInput.locks.offsetAngleDeg } };
      const evaluate = (value) => calculateOffAxisOffsetFull({ ...fixedAngleInput, profile: { ...fixedAngleInput.profile, [pairKey]: value } });
      const [minValue, maxValue] = timeMode ? [0, 60] : [baseInput.profile.releaseAltitudeMslFt + 100, 45000];
      const solved = sameTimeAsLead
        ? solveIngressTimeMatch({ targetIngressSec: leaderResult.timing.ingressSec, evaluate, minValue, maxValue })
        : solveMetricMatch({ target: baseInput.actionRangeNm, metric: (item) => item.resolved.actionRangeNm, evaluate, minValue, maxValue, tolerance: 0.005 });
      if (!solved.result || !solved.exact) {
        const variable = timeMode ? "Tracking Time (0-60 sec)" : "Roll-in Altitude";
        const target = sameTimeAsLead ? `#${leadNumber}'s Action time` : "the locked Action Range";
        throw new Error(`CONSTRAINT CONFLICT: no ${variable} at this Offset Angle and Dive Angle matches ${target}; change this aircraft's Dive Angle or free its Offset Angle`);
      }
      result = solved.result;
      pairSolved = true;
    } else if (sameTimeAsLead) {
      // Time #n: same Action time as the lead, i.e. Action Point = lead's Action Point + Formation
      // vector (same IP crossing time and Offset speed); the free Offset Angle re-solves. A
      // time-matched INVALID geometry is still drawn with its errors.
      const solved = solveElementSameTimeActionRange({
        leaderResult,
        followerLocks: baseInput.locks,
        evaluate: (actionRangeFromIpNm) => calculateOffAxisOffsetFull({ ...baseInput, driver: "actionRangeFromIpNm", locks: { offsetAngleDeg: false }, actionRangeFromIpNm }),
      });
      if (!solved.result || !solved.exact) {
        throw new Error(`CONSTRAINT CONFLICT: no Offset Angle puts this aircraft's Action Point at #${leadNumber}'s Action time`);
      }
      result = solved.result;
    } else {
      // Angle #n alone holds the Offset Angle (Action Range moves); otherwise the last tactical
      // edit or LOCK drives, as on #1.
      result = calculateOffAxisOffsetFull(angleInput);
    }

    const resultFull = result;
    result = truncateBeOutput(resultFull);
    flightResultsFull.set(number, resultFull);
    flightResults.set(number, result);
    syncFollowerResolvedFields(number, slot, resultFull, { pairSolved });
    syncFollowerExtraPlaceholders(slot, result);
    renderFollowerStatus(number, result.state, result.errors.length ? result.errors.join(" / ") : result.warnings[0] ?? "-");
    renderFollowerTopView(number, slot, flightResultOf(leadNumber), result);
    const runInReadout = slot.querySelector('[data-flight-readout="runInHeadingDeg"]');
    if (runInReadout) runInReadout.textContent = fmtHeading(result.resolved.runInHeadingDeg);
    const ipRangeReadout = slot.querySelector('[data-flight-readout="ipRangeFromTargetNm"]');
    if (ipRangeReadout) ipRangeReadout.textContent = formatNm(result.resolved.ipRangeNm);
    const predecessorResult = flightResultFullOf(number - 1);
    renderFollowerResult(number, slot, { result, delta: predecessorResult ? computeDropOrderDelta({ predecessorResult, ownResult: resultFull }) : null });
    renderFollowerDed(number, slot, result);
    const zSvg = slot.querySelector("svg[data-flight-z]");
    const zPng = slot.querySelector("[data-flight-z-png]");
    const zDrawn = renderZDiagramOf(number, zSvg, resultFull);
    if (zPng) zPng.disabled = !zDrawn;
    refreshBdpDiagrams(number);
  } catch (error) {
    flightResults.delete(number);
    flightResultsFull.delete(number);
    renderFollowerStatus(number, "INVALID", error.message);
    renderFollowerResult(number, slot, { state: "INVALID", message: error.message });
    renderFollowerDed(number, slot, null);
    showCalculationFailed(slot.querySelector("svg[data-flight-z]"), offsetZDiagramTitle({ aircraftNumber: number }), error.message);
    const zPng = slot.querySelector("[data-flight-z-png]");
    if (zPng) zPng.disabled = true;
    refreshBdpDiagrams(number);
    const leaderResult = flightResultOf(leadNumber);
    if (leaderResult) renderFollowerTopView(number, slot, leaderResult, null);
    else showCalculationFailed(slot.querySelector("svg[data-flight-topview]"), offsetTopViewTitle({ aircraftNumber: number }), error.message);
  }
}

// Presentation-only refresh (text scale, Advanced toggle, viewport): redraw each calculating
// follower's Top View from the results already solved, without re-solving.
function refreshFollowerTopViews() {
  for (let number = 2; number <= flightLayout.size; number += 1) {
    if (!FLIGHT_CALCULATING_AIRCRAFT.has(number)) continue;
    const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
    const leaderResult = flightResultOf(elementLeadNumber(number));
    if (slot && leaderResult) renderFollowerTopView(number, slot, leaderResult, flightResults.get(number) ?? null);
  }
}

function recalculateFollowers(from = 2) {
  for (let number = from; number <= flightLayout.size; number += 1) {
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) calculateFollower(number);
  }
  // Z #1 last, so its ΔTime row follows #2's current solve (a failed #1 keeps its placeholder).
  if (lastResultFull) $("#capture-z").disabled = !renderZDiagramOf(1, $("#offset-z-svg"), lastResultFull);
}

function installSectionDisclosure() {
  $$("#offset-calculator .section").forEach((section, index) => {
    const header = section.firstElementChild;
    const heading = header?.querySelector("h2");
    if (!heading || heading.querySelector(".section-disclosure-toggle")) return;
    const body = document.createElement("div");
    body.id = `offset-section-body-${index}`;
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

function install() {
  // Header shows the Offset BE version actually loaded.
  const rev = $(".rev");
  if (rev) rev.textContent = `V2 WORK · OFFSET BE ${OFFSET_BE_V0_2.version}`;
  populateWeapons();
  installLocks();
  $("#initial-link-btn")?.addEventListener("click", () => {
    rollInAltitudeLinked = !rollInAltitudeLinked;
    // Turning LINK on copies Roll-in Altitude (the solve's value) into Initial Altitude, so the
    // result does not change.
    syncLinkedInitialAltitude("rollInAltitudeMslFt");
    calculate();
  });
  installModeButtons();
  installReferenceBearingControls();
  installValueStateBindings();
  installFlightLayout();
  const leadDiagramsHost = document.querySelector('[data-bdp-diagrams-host="1"]');
  if (leadDiagramsHost) leadDiagramsHost.outerHTML = bdpDiagramsMarkup({ aircraftNumber: 1 });
  installSectionDisclosure();
  installSectionTools();
  installTempDef();
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
    if (lastResult) renderTopView(lastResult);
    refreshFollowerTopViews();
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
    if (lastResult) renderTopView(lastResult);
    refreshFollowerTopViews();
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
  $("#capture-top-view").addEventListener("click", () => exportOffsetTopView(svg, offsetTopViewTitle({ aircraftNumber: 1 })));
  $("#top-view-ip-bottom").addEventListener("click", (event) => {
    topViewIpBottom = !topViewIpBottom;
    event.currentTarget.setAttribute("aria-pressed", String(topViewIpBottom));
    if (lastResult) renderTopView(lastResult);
  });
  $("#top-view-advanced").addEventListener("click", (event) => {
    topViewAdvanced = !topViewAdvanced;
    event.currentTarget.setAttribute("aria-pressed", String(topViewAdvanced));
    event.currentTarget.textContent = `Advanced: ${topViewAdvanced ? "On" : "Off"}`;
    if (lastResult) renderTopView(lastResult);
    refreshFollowerTopViews();
  });
  $("#capture-z").addEventListener("click", () => saveSvgAsPng($("#offset-z-svg"), `${offsetZDiagramTitle({ aircraftNumber: 1 }).replace(/[^A-Za-z0-9-]+/g, "_")}.png`, { scale: 2, background: "#ffffff" }));

  const restored = loadPersistedState();
  if (!restored) applyPersistedState(defaultPersistedState);
  if (rollBankAuto) applyAutomaticRollBank(restored ? "restore" : "default");
  persistenceReady = true;
  calculate();
  initialRender = false;
}

install();
