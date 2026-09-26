import { formatDeg, formatFt, formatG, formatKt, formatNm, formatSec, formatSignedSec } from "./common/ui/display-precision-v0.1.mjs";
import { installResultPanel } from "./common/ui/result-panel-v0.1.mjs";
import { installSvgLegend } from "./common/diagram/svg-legend-v0.1.mjs";
import { calculateOffsetWithVrpStart } from "./AG/bombing/offset-bombing/offset-be-v0.2.mjs?v=2026-09-26b";
import {
  applyElementLeadOffsetAngle,
  computeDropOrderDelta,
  computeFormationOffsetVector,
  solveElementSameTimeActionRange,
  solveIngressTimeMatch,
} from "./AG/bombing/offset-bombing/offset-formation-v0.1.mjs?v=2026-09-26b";
import { calculateOffAxisOffset } from "./AG/bombing/offset-bombing/offset-formation-geometry-v0.1.mjs?v=2026-09-26b";
import { add as addWorldPoints } from "./AG/bombing/offset-bombing/offset-geometry-v0.2.mjs?v=2026-09-26b";
import { SVG_DIAGRAM_TEXT_SCALE_V0_1 } from "./common/diagram/svg-primitives-v0.1.mjs";
import { createValueStateController } from "./common/ui/value-state-controller-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";
import { exportOffsetTopView, installOffsetTopViewControls, offsetTopViewWorldPoints, renderOffsetTopView } from "./renderer-v0.1.mjs?v=2026-09-26d";
import { renderOffsetZDiagram } from "./offset-z-diagram-v0.1.mjs?v=2026-09-26b";

const resultPanel = installResultPanel(document.querySelector('[data-result-panel]'));
const legendItems = [
  { label: 'Offset Angle', color: '#a35d00' },
  { label: 'Approaching Heading', color: '#a35d00' },
  { label: 'Roll-in Radial', color: '#176dac' },
  { label: 'Roll-in Heading', color: '#176dac' },
  { label: 'Roll-in Radius', color: '#176dac' },
];
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
const FLIGHT_CALCULATING_AIRCRAFT = new Set([2]);
// Same-as/Same-time toggles are LOCK-style buttons, not checkboxes: turning one on turns off
// its own manual LOCK (they substitute the same field a LOCK would otherwise hold). Same-Angle
// and Same-Time may both be on together: with Offset Angle fixed to the element lead's value,
// calculateFollower then roots-finds Dive Angle (not Action Range) to match its Action time.
const FLIGHT_TACTICAL_DRIVERS = ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeFromIpNm"];
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
  solveMode: "height",
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
let rollInAltitudeLinked = true;
let topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
let topViewAdvanced = false;
let lastResult = null;
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

function coordinatedBankForG(g) {
  if (!(g > 1)) throw new RangeError("Low-angle level-turn Roll-in requires Roll-in G > 1");
  return Math.acos(1 / g) * 180 / Math.PI;
}

function coordinatedGForBank(bankDeg) {
  const bankRad = bankDeg * Math.PI / 180;
  const cosine = Math.cos(bankRad);
  if (!(bankDeg > 0 && bankDeg < 89.9) || !(cosine > 0)) throw new RangeError("Low-angle level-turn Bank must be > 0 and < 89.9 deg");
  return 1 / cosine;
}

function automaticRollInBankDeg() {
  const diveAngleDeg = numberValue("diveAngleDeg");
  if (diveAngleDeg < LOW_ANGLE_BOUNDARY_DEG) return coordinatedBankForG(numberValue("rollInG")).toFixed(1);
  return String(Math.round(90 + diveAngleDeg / 2));
}

function applyAutomaticRollBank(sourceKey = "diveAngleDeg") {
  if (!rollBankAuto) return false;
  return setAutoValue("rollInBankAngleDeg", automaticRollInBankDeg(), sourceKey);
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
      windDirectionDeg: numberValue("windDirectionDeg"),
      windSpeedKt: numberValue("windSpeedKt"),
      initialSpeedValue: numberValue("initialSpeedValue"),
      initialSpeedMode: value("initialSpeedMode") ?? "CAS",
      // BDP v0.3 still names its module-entry altitude initialAltitudeMslFt.
      // In Offset composition that module entry is OA1 / Roll-In Altitude.
      initialAltitudeMslFt: numberValue("rollInAltitudeMslFt"),
      solveMode: value("solveMode") ?? "height",
      trackingTimeSec: numberValue("trackingTimeSec"),
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
// Release Altitude + tracking path x sin(Dive) + Roll-in altitude loss.
function applyBdpSolveCoupling(result) {
  const p = result.profile.public;
  if ((value("solveMode") ?? "height") === "time") {
    if (Number.isFinite(p.resolvedInitialAltitudeMslFt)) setSolvedValue("rollInAltitudeMslFt", p.resolvedInitialAltitudeMslFt, 0, "trackingTimeSec");
  } else if (Number.isFinite(p.trackingTimeSec)) {
    setSolvedValue("trackingTimeSec", p.trackingTimeSec, 0, "rollInAltitudeMslFt");
  }
}

function applyResolved(result) {
  setAutoValue("runInHeadingDeg", formatBearingInput(result.resolved.runInHeadingDeg));
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
function row(label, renderedValue, resultKey = null) {
  const rendered = resultKey ? `<span class="value-result" data-result-key="${resultKey}">${renderedValue}</span>` : renderedValue;
  return `<tr class="result-row" data-result-row data-summary="${SUMMARY_RESULTS.has(resultKey)}"><td>${label}</td><td data-result-value>${rendered}</td></tr>`;
}

function renderOffsetResult(result) {
  const g = result.geometry;
  const t = result.timing;
  $("#offset-result-body").innerHTML = [
    row("State", result.state),
    row("Run-In / Attack", `${fmtHeading(g.runInHeadingDeg)} → ${fmtHeading(g.attackHeadingDeg)}`, "runAttackSummary"),
    row("Approaching Heading", fmtHeading(g.offsetHeadingDeg), "offsetHeadingDeg"),
    row("Offset Angle", `${formatDeg(g.offsetAngleDeg)}°`, "offsetAngleDeg"),
    row("Angle-Off (Heading)", `${formatDeg(g.angleOffDeg)}°`, "angleOffDeg"),
    row("Action Range", `${formatNm(g.actionRangeNm)} NM`, "actionRangeNm"),
    row("Approach Range", `${formatNm(result.resolved.approachRangeNm)} NM`, "approachRangeNm"),
    row("IP Range", `${formatNm(result.resolved.ipRangeNm)} NM · ${ipLinked ? `LINKED TO VRP + ${IP_LINK_LEAD_NM} NM` : "INDEPENDENT"}`, "ipRangeNm"),
    row("Offset Radius", `${formatNm(result.resolved.offsetRadiusNm)} NM`, "offsetRadiusNm"),
    row("Offset TAS", `${formatKt(result.resolved.offsetTasKt)} kt`, "offsetTasKt"),
    row("Reference", `${result.referenceMode} · ${formatDeg(result.reference.bearingDeg)}° / ${formatNm(result.reference.displayRangeNm)} NM`, "referenceSummary"),
    row("IP → Action Point", `${formatNm(t.ingressDistanceNm)} NM / ${formatSec(t.ingressSec)} sec`, "ingressSummary"),
    row("Offset Turn", `${formatSec(t.offsetTurnSec)} sec`, "offsetTurnSec"),
    row("Approach Time", `${formatSec(t.approachSec)} sec`, "approachSec"),
    row("Roll-in → Release", `${formatSec(t.rollToReleaseSec)} sec`, "rollToReleaseSec"),
    row("Legacy ΔTOS", `${formatSignedSec(t.legacyDeltaTosSec)} sec`, "legacyDeltaTosSec"),
  ].join("");
}

function renderProfileResult(result) {
  const p = result.profile.public;
  $("#profile-result-body").innerHTML = [
    row("Effective Release Altitude", `${formatFt(p.effectiveReleaseAltitudeMslFt)} ft MSL`, "effectiveReleaseAltitudeMslFt"),
    row("Roll-In Altitude", `${formatFt(p.resolvedInitialAltitudeMslFt)} ft MSL`, "resolvedInitialAltitudeMslFt"),
    row("Track Point Altitude", `${formatFt(p.trackPointAltitudeMslFt)} ft MSL`, "trackPointAltitudeMslFt"),
    row("Tracking Time", `${formatSec(p.trackingTimeSec)} sec`, "trackingTimeSecResult"),
    row("Roll-in Range", `${formatNm(p.rollInRangeNm)} NM`, "rollInRangeNm"),
    row("Ground Range", `${formatNm(p.groundRangeNm)} NM`, "groundRangeNm"),
    row("Roll-in Radius", `${formatNm(p.rollInRadiusNm)} NM`, "rollInRadiusNm"),
    row("Roll-in Time", `${formatSec(p.rollInTimeSec)} sec`, "rollInTimeSec"),
    row("Roll-in Ground Arc", `${formatNm(p.rollInGroundArcNm)} NM`, "rollInGroundArcNm"),
    row("Roll-in Altitude Loss", `${formatFt(p.rollInAltitudeLossFt)} ft`, "rollInAltitudeLossFt"),
    row("Lead Angle", `${formatDeg(p.leadAngleDeg)}°`, "leadAngleDeg"),
    row("MINALT", `${formatFt(p.minAltMslFt)} ft MSL`, "minAltMslFt"),
    row("NLT Release", `${formatFt(p.nltReleaseMslFt)} ft MSL`, "nltReleaseMslFt"),
    row("Bomb Range / TOF", `${formatNm(p.bombRangeNm)} NM / ${formatSec(p.bombTofSec)} sec`, "bombRangeTofSummary"),
  ].join("");
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

function renderTopView(result) {
  renderOffsetTopView($("#offset-top-view"), result, {
    textScale: topViewTextScale,
    viewportWidth: globalThis.innerWidth,
    advanced: topViewAdvanced,
  });
  const g = result.geometry;
  legendItems[0].label = `Offset Angle · ${fmt(g.offsetAngleDeg, 0)}°`;
  legendItems[1].label = `Approaching Heading · ${fmtHeading(g.offsetHeadingDeg)}`;
  legendItems[2].label = `Roll-in Radial · ${fmtHeading(bearingBetween(g.points.target, g.points.rollStart))}`;
  legendItems[3].label = `Roll-in Heading · ${fmtHeading(g.offsetHeadingDeg)}`;
  legendItems[4].label = `Roll-in Radius · ${formatNm(g.rollInRadiusNm)} NM`;
  legend.render();
}

function calculate() {
  try {
    const result = calculateOffsetWithVrpStart(buildInput());
    lastResult = result;
    applyResolved(result);
    applyBdpSolveCoupling(result);
    renderStatus(result);
    renderOffsetResult(result);
    renderProfileResult(result);
    resultPanel.refresh();
    renderTopView(result);
    $("#capture-z").disabled = !renderOffsetZDiagram($("#offset-z-svg"), result);
    renderDed(result);
    applyResultChangeStates(result);
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
    if (lastResult) {
      renderTopView(lastResult);
      renderDed(lastResult);
      recalculateFollowers();
    }
  }
  if (persistenceReady) savePersistedState();
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

function handleFieldChange(event) {
  const field = event.target.closest?.("[data-key]");
  if (!field || field.id === "ip-bearing-input") return;
  syncDuplicates(field);
  const key = field.dataset.key;

  solvedInputValues.delete(key);

  if (key === "initialAltitudeMslFt" && rollInAltitudeLinked) {
    setAutoValue("rollInAltitudeMslFt", Math.round(numberValue("initialAltitudeMslFt")), key);
    setValue("solveMode", "height", { includeActive: true });
  }
  if (key === "rollInAltitudeMslFt") {
    rollInAltitudeLinked = false;
    setValue("solveMode", "height", { includeActive: true });
  }
  if (key === "trackingTimeSec") setValue("solveMode", "time", { includeActive: true });

  if (key === "vrpRangeNm") {
    vrpRangeExplicit = Number.isFinite(Number.parseFloat(field.value));
    driver = "vrpRangeNm";
    calculate();
    return;
  }

  if (key === "ipRangeNm") {
    ipLinked = false;
    driver = "ipRangeNm";
    calculate();
    return;
  }

  if (["offsetG", "offsetBankDeg", "offsetRadiusNm"].includes(key)) turnDriver = key;

  const diveAngleDeg = numberValue("diveAngleDeg");
  if (key === "rollInBankAngleDeg") {
    rollBankAuto = false;
    if (diveAngleDeg < LOW_ANGLE_BOUNDARY_DEG) {
      setAutoValue("rollInG", coordinatedGForBank(numberValue("rollInBankAngleDeg")).toFixed(3), key);
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
    ipLinked = false;
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
  ipLinked = false;
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
      if (key === "runInHeadingDeg" && locks[key]) ipLinked = false;
      if (["ipReference", "vrpReference"].includes(key) && locks[key]) ipLinked = false;
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

  if (rollInAltitudeLinked) {
    setValue("rollInAltitudeMslFt", Math.round(numberValue("initialAltitudeMslFt")), { includeActive: true });
  }
  const runInHeadingDeg = readRunInHeading();
  syncImplicitReferenceInputs(runInHeadingDeg, { includeActive: true });
  syncVipBearingInput(readVipToTargetBearing(), { includeActive: true });
  syncIpBearingInput(runInHeadingDeg, { includeActive: true });
  if (locks.ipReference || locks.vrpReference) ipLinked = false;
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
  const defaults = defaultFlightDraft();
  (FOLLOWER_TAB_KEYS[tab] ?? []).forEach((key) => {
    draft[key] = defaults[key];
    followerSolvedValues.delete(`${number}:${key}`);
  });
  const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (slot) initializeFlightSlotFields(slot, number);
  saveFlightLayout();
  if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) calculateFollower(number);
}

// Follower BDP Advanced/Full BDP inputs owned per aircraft. An empty value follows #1's current
// value (Roll-in Bank: automatic from this aircraft's own Dive Angle), shown as the placeholder.
const FOLLOWER_BDP_EXTRA_KEYS = ["fragmentHeightMarginPercent", "recoveryG", "speedOvershootKcas", "gOnsetTimeSec", "rollInBankAngleDeg", "rollInG"];
// Per-tab keys reset by that tab's Default (follower aircraft).
const FOLLOWER_TAB_KEYS = {
  formation: ["side", "bearingDeg", "distanceNm"],
  bdp: ["weaponId", "initialSpeedValue", "initialAltitudeMslFt", "rollInAltitudeMslFt", "rollInAltitudeLinked", "diveAngleDeg", "trackingTimeSec", "solveMode", "releaseAltitudeMslFt", "releaseSpeedKcas", ...FOLLOWER_BDP_EXTRA_KEYS],
  offset: ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeFromIpNm", "offsetAngleLocked", "sameAngleAsLead", "actionRangeLocked", "sameTimeAsLead", "driver"],
};

function defaultFlightDraft() {
  return {
    weaponId: "M82", side: "LEFT", bearingDeg: "90", distanceNm: "1",
    initialSpeedValue: "350", initialAltitudeMslFt: "16000", diveAngleDeg: "45",
    rollInAltitudeMslFt: "16000", rollInAltitudeLinked: true,
    trackingTimeSec: "18", solveMode: "height", releaseAltitudeMslFt: "6800", releaseSpeedKcas: "450",
    ...Object.fromEntries(FOLLOWER_BDP_EXTRA_KEYS.map((key) => [key, ""])),
    attackHeadingDeg: "030", angleOffDeg: "70",
    offsetAngleDeg: "40", actionRangeFromIpNm: "4.0",
    offsetAngleLocked: false, sameAngleAsLead: true,
    actionRangeLocked: false, sameTimeAsLead: false,
    driver: "actionRangeFromIpNm",
  };
}

function flightDraft(number) {
  return flightLayout.aircraft[number] ||= defaultFlightDraft();
}

function elementLeadNumber(number) {
  return number === 4 ? 3 : 1;
}

function saveFlightLayout() {
  try {
    localStorage.setItem(FLIGHT_LAYOUT_KEY, JSON.stringify(flightLayout));
  } catch {
    // The UI remains usable when browser storage is unavailable.
  }
}

function flightSection(number, title, content, { calculating = false, tab = "" } = {}) {
  const badge = calculating ? "" : `<span class="flight-draft-badge">UI draft</span>`;
  const tabAttr = calculating && tab ? ` data-tab="${tab}" data-aircraft-tab="${number}"` : "";
  return `<section class="section flight-draft-section"${tabAttr}><div class="section-head"><h2>${title} #${number}</h2>${badge}</div>${content}</section>`;
}

function followerExtraField(key, label) {
  return `<label class="field advanced-only bdp-extra"><span>${label} <span class="adv-tag">ADV</span></span><input data-flight-field="${key}" type="text" inputmode="decimal"></label>`;
}

// Same Text / Size / Reset / PNG / Advanced toolbar as Top View #1, scoped to one follower.
function followerTopViewToolbar(number) {
  return `<div class="diagram-actions"><div class="diagram-action-row"><div class="font-scale-control" role="group" aria-label="Top View #${number} font size"><span class="diagram-control-label">Text</span><button class="capture-button" type="button" data-ftv="text-down" aria-label="Top View #${number} font smaller">-</button><button class="capture-button diagram-scale-output" type="button" data-ftv="text-reset" aria-label="Reset Top View #${number} text size to 100%">100%</button><button class="capture-button" type="button" data-ftv="text-up" aria-label="Top View #${number} font larger">+</button></div><div class="view-scale-control" role="group" aria-label="Top View #${number} picture size"><span class="diagram-control-label">Size</span><button class="capture-button" type="button" data-ftv="zoom-out" aria-label="Picture smaller">-</button><button class="capture-button diagram-scale-output" type="button" data-ftv="size-reset" aria-label="Reset Top View #${number} size to 100%">100%</button><button class="capture-button" type="button" data-ftv="zoom-in" aria-label="Picture larger">+</button></div><button class="capture-button" type="button" data-ftv="reset">Reset</button><button class="capture-button" type="button" data-ftv="png">PNG</button><button class="capture-button" type="button" data-ftv="advanced" aria-pressed="false">Advanced: Off</button></div></div>`;
}

function followerDraftMarkup(number) {
  const leadNumber = elementLeadNumber(number);
  return [
    flightSection(number, "Formation", `<p class="flight-draft-note">Position relative to #1 · display only, not yet fed into geometry.</p><div class="flight-draft-grid"><label class="field"><span>Side</span><select data-flight-field="side"><option value="LEFT">Left</option><option value="RIGHT">Right</option></select></label><label class="field"><span>Bearing (°)</span><input type="number" min="0" max="180" step="1" data-flight-field="bearingDeg"></label><label class="field"><span>Distance (NM)</span><input type="number" min="0" step="0.1" data-flight-field="distanceNm"></label></div>`),
    flightSection(number, "BDP", `<p class="flight-draft-note">Aircraft #${number} input draft · profile calculation is not connected.</p><label class="field flight-weapon-field"><span>Bomb</span><select data-flight-field="weaponId"></select></label>`),
    flightSection(number, "Offset", `<p class="flight-draft-note">Aircraft #${number} Offset draft · align to #${leadNumber}. Inputs and results are not connected yet.</p>`),
    flightSection(number, "Z-Diagram", `<p class="flight-draft-note">Aircraft #${number} diagram is pending its profile result.</p>`),
    flightSection(number, "Top View", `<p class="flight-draft-note">Leader #1 is the reference. Aircraft #${number} overlay is pending.</p>`),
    flightSection(number, "Result", `<p class="flight-draft-note">No calculated result for aircraft #${number}.</p>`),
    flightSection(number, "DED", `<p class="flight-draft-note">Aircraft #${number} DED is pending its profile result.</p>`),
  ].join("");
}

function followerCalculatingMarkup(number) {
  const leadNumber = elementLeadNumber(number);
  return [
    flightSection(number, "Formation", `<p class="flight-draft-note">Start point relative to #1's own IP; feeds this aircraft's Run-In line.</p><div class="flight-draft-grid"><label class="field"><span>Side</span><select data-flight-field="side"><option value="LEFT">Left</option><option value="RIGHT">Right</option></select></label><label class="field"><span>Bearing (°)</span><input type="number" min="0" max="180" step="1" data-flight-field="bearingDeg"></label><label class="field"><span>Distance (NM)</span><input type="number" min="0" step="0.1" data-flight-field="distanceNm"></label></div>`, { calculating: true, tab: "formation" }),
    flightSection(number, "BDP", `<div class="input-grid"><label class="field flight-weapon-field"><span>Bomb</span><select data-flight-field="weaponId"></select></label><label class="field"><span>Initial Speed (KCAS)</span><input data-flight-field="initialSpeedValue" type="text" inputmode="decimal"></label><label class="field"><span>Initial Altitude (ft MSL)</span><input data-flight-field="initialAltitudeMslFt" type="text" inputmode="decimal"></label><label class="field"><span>Roll-in Altitude (ft MSL)</span><input data-flight-field="rollInAltitudeMslFt" type="text" inputmode="decimal"><span class="unit">Default = Initial Altitude · BDP entry altitude</span></label><label class="field"><span>Dive Angle (deg)</span><input data-flight-field="diveAngleDeg" type="text" inputmode="decimal"></label><label class="field"><span>Tracking Time (sec)</span><input data-flight-field="trackingTimeSec" type="text" inputmode="decimal"></label><label class="field"><span>Release Altitude (ft MSL)</span><input data-flight-field="releaseAltitudeMslFt" type="text" inputmode="decimal"></label><label class="field"><span>Release Speed (KCAS)</span><input data-flight-field="releaseSpeedKcas" type="text" inputmode="decimal"></label>${followerExtraField("fragmentHeightMarginPercent", "Fragment Height Margin (%)")}${followerExtraField("recoveryG", "Recovery G (G)")}${followerExtraField("speedOvershootKcas", "Speed Overshoot (KCAS)")}${followerExtraField("gOnsetTimeSec", "G Onset Time (sec)")}<label class="field advanced-only bdp-extra"><span>Solve Mode <span class="adv-tag">ADV</span></span><select data-flight-field="solveMode"><option value="height">Initial Altitude</option><option value="time">Tracking Time</option></select></label>${followerExtraField("rollInBankAngleDeg", "Roll-in Bank Angle (deg)")}${followerExtraField("rollInG", "Roll-in G (G)")}</div><p class="flight-draft-note">Target Elevation and Wind are shared with #1 (same Target). Full BDP fields left blank follow #1 (Roll-in Bank: automatic from this aircraft's Dive Angle).</p>`, { calculating: true, tab: "bdp" }),
    flightSection(number, "Offset", `<div class="section-head"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div><div class="input-grid"><label class="field"><span>Run-In Heading</span><output data-flight-readout="runInHeadingDeg">-</output><span class="unit">Follows #1 · parallel Run-In</span></label><label class="field"><span>IP Range from Target</span><output data-flight-readout="ipRangeFromTargetNm">-</output><span class="unit">NM · from Formation position</span></label><label class="field"><span>Attack Heading (deg)</span><input data-flight-field="attackHeadingDeg" type="text" inputmode="decimal"></label><label class="field"><span>Angle-Off (deg)</span><input data-flight-field="angleOffDeg" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Offset Angle (deg)</span><button class="lock-button" type="button" data-flight-field="offsetAngleLocked" aria-pressed="false">LOCK</button><button class="lock-button" type="button" data-flight-field="sameAngleAsLead" aria-pressed="false">SAME AS #${leadNumber}</button></span><input data-flight-field="offsetAngleDeg" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Action Range from own IP (NM)</span><button class="lock-button" type="button" data-flight-field="actionRangeLocked" aria-pressed="false">LOCK</button><button class="lock-button" type="button" data-flight-field="sameTimeAsLead" aria-pressed="false">SAME TIME AS #${leadNumber}</button></span><input data-flight-field="actionRangeFromIpNm" type="text" inputmode="decimal"></label></div><div id="flight-status-${number}" class="status-message valid">-</div>`, { calculating: true, tab: "offset" }),
    flightSection(number, "Z-Diagram", `<p class="flight-draft-note">Aircraft #${number} diagram is pending its profile result.</p>`),
    flightSection(number, "Top View", `${followerTopViewToolbar(number)}<div class="top-view-shell"><svg data-flight-topview viewBox="0 0 1180 1440" role="img" aria-label="Aircraft #${number} Offset top view"><defs></defs></svg></div><p class="flight-draft-note">Leader #${leadNumber}'s already-solved profile is drawn in full alongside this aircraft's own, sharing Target and scale; it does not feed aircraft #${number}'s own solve.</p><div class="flight-draft-grid flight-timing-deltas"><div class="field"><span>IP→Release Δ vs #${leadNumber}</span><output data-flight-timing="ipToReleaseDeltaSec">-</output></div><div class="field"><span>IP→Impact Δ vs #${leadNumber}</span><output data-flight-timing="ipToImpactDeltaSec">-</output></div><div class="field"><span>#${leadNumber} Impact → #${number} Release</span><output data-flight-timing="predecessorImpactToOwnReleaseSec">-</output></div><div class="field"><span>#${leadNumber} Bomb TOF</span><output data-flight-timing="predecessorBombTofSec">-</output></div></div>`, { calculating: true }),
    flightSection(number, "Result", `<p class="flight-draft-note">No calculated result for aircraft #${number}.</p>`),
    flightSection(number, "DED", `<p class="flight-draft-note">Aircraft #${number} DED is pending its profile result.</p>`),
  ].join("");
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
    const on = draft[button.dataset.flightField] === true;
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("active", on);
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
  installSectionDisclosure();
  installSectionTools(host);
  host.querySelectorAll(".flight-slot").forEach((slot) => installFollowerTopViewControls(Number(slot.dataset.aircraft), slot));
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
            ...Object.fromEntries(FOLLOWER_BDP_EXTRA_KEYS.map((key) => [key, typeof record[key] === "string" ? record[key] : ""])),
            releaseAltitudeMslFt: str("releaseAltitudeMslFt"),
            releaseSpeedKcas: str("releaseSpeedKcas"),
            attackHeadingDeg: str("attackHeadingDeg"),
            angleOffDeg: str("angleOffDeg"),
            offsetAngleDeg: str("offsetAngleDeg"),
            actionRangeFromIpNm: str("actionRangeFromIpNm"),
            offsetAngleLocked: record.offsetAngleLocked === true,
            sameAngleAsLead: record.sameAngleAsLead === true,
            actionRangeLocked: record.actionRangeLocked === true,
            sameTimeAsLead: record.sameTimeAsLead === true,
            driver: FLIGHT_TACTICAL_DRIVERS.includes(record.driver) ? record.driver : "actionRangeFromIpNm",
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
    draft[key] = field.type === "checkbox" ? field.checked : field.value;
    // Mirrors #1's Initial Altitude -> Roll-in Altitude default link (index.html's
    // rollInAltitudeMslFt field / rollInAltitudeLinked): Roll-in Altitude is the actual BDP
    // entry altitude and follows Initial Altitude until explicitly edited on its own.
    if (key === "initialAltitudeMslFt" && draft.rollInAltitudeLinked) {
      draft.rollInAltitudeMslFt = field.value;
      const rollInField = followerField(field.closest(".flight-slot"), "rollInAltitudeMslFt");
      if (rollInField && rollInField !== document.activeElement) rollInField.value = field.value;
      draft.solveMode = "height";
    } else if (key === "rollInAltitudeMslFt") {
      draft.rollInAltitudeLinked = false;
      draft.solveMode = "height";
    } else if (key === "trackingTimeSec") {
      draft.solveMode = "time";
    }
    followerSolvedValues.delete(`${number}:${key}`);
    // Same rule as #1's handleFieldChange: only tactical Offset edits become the driver; BDP
    // edits keep the last tactical constraint so the unlocked geometry re-solves around it.
    if (FLIGHT_TACTICAL_DRIVERS.includes(key)) draft.driver = key;
    saveFlightLayout();
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) calculateFollower(number);
  };
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
    button.setAttribute("aria-pressed", String(draft[key]));
    button.classList.toggle("active", draft[key]);
    if (draft[key] && FLIGHT_TOGGLE_EXCLUSIONS[key]) {
      FLIGHT_TOGGLE_EXCLUSIONS[key].forEach((excludedKey) => {
        draft[excludedKey] = false;
        const excludedButton = slot?.querySelector(`.lock-button[data-flight-field="${excludedKey}"]`);
        excludedButton?.setAttribute("aria-pressed", "false");
        excludedButton?.classList.remove("active");
      });
    }
    saveFlightLayout();
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) calculateFollower(number);
  });
  renderFlightLayout();
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

  if (sameAngleAsLead && offsetAngleLocked) throw new Error("CONSTRAINT CONFLICT: Same-as-Element-Lead Offset Angle cannot combine with a manual Offset Angle LOCK");
  if (sameTimeAsLead && actionRangeLocked) throw new Error("CONSTRAINT CONFLICT: Same-Time-as-Element-Lead Action Range cannot combine with a manual Action Range LOCK");

  // Follower BDP extras: an entered value is this aircraft's own; blank follows #1.
  const own = (key) => {
    const parsed = Number.parseFloat(followerField(slot, key)?.value ?? draft[key]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const runInHeadingDeg = leaderResult.resolved.runInHeadingDeg;
  const ipPoint = followerIpPoint(number, slot, leaderResult);
  const sharedProfile = leaderResult.profile.canonicalInputs;
  // Plain mode (no element-lead toggle) mirrors #1's VRP-start default: the last tactical edit
  // drives, defaulting to this aircraft's own Action Point held so BDP changes re-solve the
  // unlocked Offset Angle. A manual Offset Angle LOCK cannot also hold the Action Point.
  const draftDriver = FLIGHT_TACTICAL_DRIVERS.includes(draft.driver) ? draft.driver : "actionRangeFromIpNm";
  const driver = actionRangeLocked
    ? "actionRangeFromIpNm"
    : offsetAngleLocked && draftDriver === "actionRangeFromIpNm" ? "offsetAngleDeg" : draftDriver;

  const baseInput = {
    driver,
    turnDriver: "offsetG",
    locks: { offsetAngleDeg: offsetAngleLocked, actionRangeFromIpNm: actionRangeLocked },
    runInHeadingDeg,
    ipPoint,
    attackHeadingDeg: num("attackHeadingDeg"),
    angleOffDeg: num("angleOffDeg"),
    offsetAngleDeg: num("offsetAngleDeg"),
    actionRangeFromIpNm: num("actionRangeFromIpNm"),
    offsetAltitudeMslFt: leaderResult.resolved.offsetAltitudeMslFt,
    offsetSpeedValue: leaderResult.resolved.offsetSpeedValue,
    offsetSpeedMode: leaderResult.resolved.offsetSpeedMode,
    offsetG: leaderResult.resolved.offsetG,
    offsetBankDeg: leaderResult.resolved.offsetBankDeg,
    offsetRadiusNm: leaderResult.resolved.offsetRadiusNm,
    profile: {
      weaponId: followerField(slot, "weaponId")?.value || draft.weaponId,
      targetElevationMslFt: sharedProfile.targetElevationMslFt,
      windDirectionDeg: sharedProfile.windDirectionDeg,
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
      trackingTimeSec: num("trackingTimeSec"),
      releaseAltitudeMslFt: num("releaseAltitudeMslFt"),
      releaseSpeedKcas: num("releaseSpeedKcas"),
      rollInBankAngleDeg: own("rollInBankAngleDeg") ?? followerAutoRollBank(num("diveAngleDeg"), own("rollInG") ?? sharedProfile.rollInG),
      rollInG: own("rollInG") ?? sharedProfile.rollInG,
    },
  };
  return { baseInput, sameAngleAsLead, sameTimeAsLead };
}

// Same automatic Roll-in Bank rule as #1 (applyAutomaticRollBank), from this aircraft's own Dive.
function followerAutoRollBank(diveAngleDeg, rollInG) {
  if (diveAngleDeg < LOW_ANGLE_BOUNDARY_DEG) return coordinatedBankForG(rollInG);
  return Math.round(90 + diveAngleDeg / 2);
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
  const mode = followerField(slot, "solveMode");
  if (mode && mode !== document.activeElement) mode.value = flightDraft(Number(slot.dataset.aircraft)).solveMode === "time" ? "time" : "height";
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

function renderFollowerTimingDeltas(number, delta) {
  const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (!slot) return;
  slot.querySelectorAll("[data-flight-timing]").forEach((output) => {
    const value = delta?.[output.dataset.flightTiming];
    // Bomb TOF is a duration, the other three are signed deltas.
    const text = output.dataset.flightTiming === "predecessorBombTofSec" ? formatSec(value) : formatSignedSec(value);
    output.textContent = Number.isFinite(value) ? `${text} s` : "-";
  });
}

function syncFollowerResolvedFields(number, slot, result) {
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
  sync("actionRangeFromIpNm", result.resolved.actionRangeFromIpNm, 1);
  sync("attackHeadingDeg", result.resolved.attackHeadingDeg, 0);
  sync("angleOffDeg", result.resolved.angleOffDeg, 0);
  // Combined Same-Angle + Same-Time mode solves Dive Angle (see calculateFollower); reflect it.
  sync("diveAngleDeg", result.profile.canonicalInputs.diveAngleDeg, 0);
  // BDP solve-mode coupling, same rule as #1 (applyBdpSolveCoupling).
  const p = result.profile.public;
  if (draft.solveMode === "time") sync("rollInAltitudeMslFt", p.resolvedInitialAltitudeMslFt, 0);
  else sync("trackingTimeSec", p.trackingTimeSec, 0);
}


// Both Top View calls below share one auto-fit projection (each passes the other's world points
// as extraFitPoints), so the element lead's full-fidelity render and this aircraft's own render
// land in the same scale/frame and their Target markers coincide. The lead layer is drawn exactly
// as in its own Top View; this aircraft's layer uses the follower palette, "#n"-prefixed labels,
// and places its labels clear of the lead's labels and paths (and vice versa for the paths).
// Per-follower Top View presentation state (Text scale / Advanced), same controls as Top View #1.
const followerTopViewState = new Map();
function followerTopView(number) {
  if (!followerTopViewState.has(number)) followerTopViewState.set(number, { textScale: TOP_VIEW_TEXT_SCALE_DEFAULT, advanced: false });
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
  control("png").addEventListener("click", () => exportOffsetTopView(svg, `offset-top-view-${number}.png`));
  syncText();
}

function geometryWorldPolylines(geometry) {
  const p = geometry.points;
  return [[p.ip, p.realActionPoint], [p.realActionPoint, p.turnEnd], [p.turnEnd, p.rollStart], geometry.rollInTrajectorySamples, [p.trackPoint, p.target]];
}

function renderFollowerTopView(number, slot, leaderResult, result) {
  const svg = slot.querySelector("svg[data-flight-topview]");
  if (!svg) return;
  const leadNumber = elementLeadNumber(number);
  const view = followerTopView(number);
  const common = { textScale: view.textScale, viewportWidth: globalThis.innerWidth, advanced: view.advanced };
  const leaderPoints = offsetTopViewWorldPoints(leaderResult);
  const ownGroup = svg.querySelector(`#offset-plot-${number}`);
  if (!result) {
    // Own solve failed: keep the lead's profile visible instead of a blank or stale frame.
    ownGroup?.replaceChildren();
    renderOffsetTopView(svg, leaderResult, { ...common, plotGroupId: `offset-plot-lead-${number}` });
    return;
  }
  const ownPoints = offsetTopViewWorldPoints(result);
  const leadLayer = renderOffsetTopView(svg, leaderResult, {
    ...common,
    plotGroupId: `offset-plot-lead-${number}`,
    extraFitPoints: ownPoints,
    obstacleWorldPolylines: geometryWorldPolylines(result.geometry),
  });
  renderOffsetTopView(svg, result, {
    ...common,
    plotGroupId: `offset-plot-${number}`,
    extraFitPoints: leaderPoints,
    paintBackground: false,
    palette: "follower",
    aircraftTag: `#${number}`,
    leadAttackHeadingDeg: leaderResult.geometry.attackHeadingDeg,
    labelObstacles: { rects: leadLayer?.labelRects, segments: leadLayer?.segments },
  });
  svg.dataset.leadAircraft = String(leadNumber);
}

function calculateFollower(number) {
  const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
  if (!slot) return;
  const leadNumber = elementLeadNumber(number);
  try {
    const leaderResult = leadNumber === 1 ? lastResult : flightResults.get(leadNumber);
    if (!leaderResult) throw new Error(`Aircraft #${leadNumber} has not resolved yet`);
    const { baseInput, sameAngleAsLead, sameTimeAsLead } = buildFollowerInput(number, slot, leaderResult);

    let result;
    if (sameAngleAsLead && sameTimeAsLead) {
      // With Offset Angle fixed to the element lead's value, Action Range is no longer an
      // independent free parameter (see AG SPEC), so matching Action time here instead varies
      // Dive Angle: a wingman displaced to the offset side needs a shallower dive to still close
      // on Target at the same time, one displaced to the opposite side needs a steeper one.
      const applied = applyElementLeadOffsetAngle({ leaderResult, followerInput: baseInput });
      const solved = solveIngressTimeMatch({
        targetIngressSec: leaderResult.timing.ingressSec,
        minValue: 5,
        maxValue: 75,
        evaluate: (diveAngleDeg) => calculateOffAxisOffset({ ...applied, profile: { ...applied.profile, diveAngleDeg } }),
      });
      if (!solved.result || !solved.exact) {
        throw new Error(`CONSTRAINT CONFLICT: no Dive Angle (5-75°) at #${leadNumber}'s Offset Angle matches its Action time; try this aircraft's own Dive Angle or Roll-in Altitude manually instead`);
      }
      result = solved.result;
    } else if (sameAngleAsLead) {
      result = calculateOffAxisOffset(applyElementLeadOffsetAngle({ leaderResult, followerInput: baseInput }));
    } else if (sameTimeAsLead) {
      const maxActionRangeNm = Math.max(5, Math.hypot(baseInput.ipPoint.x, baseInput.ipPoint.y));
      const solved = solveElementSameTimeActionRange({
        leaderResult,
        followerLocks: baseInput.locks,
        // #1's own default (VRP-start) leaves it with exactly zero ingress time, so the search
        // must bracket down through 0 (validateOffAxisOffsetCandidate only rejects < -0.001).
        minActionRangeNm: -0.5,
        maxActionRangeNm,
        evaluate: (actionRangeFromIpNm) => calculateOffAxisOffset({ ...baseInput, driver: "actionRangeFromIpNm", actionRangeFromIpNm }),
      });
      if (!solved.result || !solved.exact) {
        throw new Error(`CONSTRAINT CONFLICT: no Action Range matches #${leadNumber}'s Action time within this aircraft's reachable range`);
      }
      result = solved.result;
    } else {
      result = calculateOffAxisOffset(baseInput);
    }

    flightResults.set(number, result);
    syncFollowerResolvedFields(number, slot, result);
    syncFollowerExtraPlaceholders(slot, result);
    renderFollowerStatus(number, result.state, result.errors[0] ?? result.warnings[0] ?? "-");
    renderFollowerTopView(number, slot, leaderResult, result);
    const runInReadout = slot.querySelector('[data-flight-readout="runInHeadingDeg"]');
    if (runInReadout) runInReadout.textContent = fmtHeading(result.resolved.runInHeadingDeg);
    const ipRangeReadout = slot.querySelector('[data-flight-readout="ipRangeFromTargetNm"]');
    if (ipRangeReadout) ipRangeReadout.textContent = formatNm(Math.hypot(baseInput.ipPoint.x, baseInput.ipPoint.y));
    renderFollowerTimingDeltas(number, computeDropOrderDelta({ predecessorResult: leaderResult, ownResult: result }));
  } catch (error) {
    flightResults.delete(number);
    renderFollowerStatus(number, "INVALID", error.message);
    renderFollowerTimingDeltas(number, null);
    const leaderResult = leadNumber === 1 ? lastResult : flightResults.get(leadNumber);
    if (leaderResult) renderFollowerTopView(number, slot, leaderResult, null);
  }
}

// Presentation-only refresh (text scale, Advanced toggle, viewport): redraw each calculating
// follower's Top View from the results already solved, without re-solving.
function refreshFollowerTopViews() {
  for (let number = 2; number <= flightLayout.size; number += 1) {
    if (!FLIGHT_CALCULATING_AIRCRAFT.has(number)) continue;
    const slot = document.querySelector(`.flight-slot[data-aircraft="${number}"]`);
    const leadNumber = elementLeadNumber(number);
    const leaderResult = leadNumber === 1 ? lastResult : flightResults.get(leadNumber);
    if (slot && leaderResult) renderFollowerTopView(number, slot, leaderResult, flightResults.get(number) ?? null);
  }
}

function recalculateFollowers() {
  for (let number = 2; number <= flightLayout.size; number += 1) {
    if (FLIGHT_CALCULATING_AIRCRAFT.has(number)) calculateFollower(number);
  }
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
  populateWeapons();
  installLocks();
  installModeButtons();
  installReferenceBearingControls();
  installValueStateBindings();
  installFlightLayout();
  installSectionDisclosure();
  installSectionTools();
  installTempDef();
  syncReferencePanes();
  defaultPersistedState = createDefaultPersistedState();

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
  $("#capture-top-view").addEventListener("click", () => exportOffsetTopView(svg));
  $("#top-view-advanced").addEventListener("click", (event) => {
    topViewAdvanced = !topViewAdvanced;
    event.currentTarget.setAttribute("aria-pressed", String(topViewAdvanced));
    event.currentTarget.textContent = `Advanced: ${topViewAdvanced ? "On" : "Off"}`;
    if (lastResult) renderTopView(lastResult);
    refreshFollowerTopViews();
  });
  $("#capture-z").addEventListener("click", () => saveSvgAsPng($("#offset-z-svg"), "offset-z-diagram-1.png", { scale: 2, background: "#ffffff" }));

  const restored = loadPersistedState();
  if (!restored) applyPersistedState(defaultPersistedState);
  if (rollBankAuto) applyAutomaticRollBank(restored ? "restore" : "default");
  persistenceReady = true;
  calculate();
  initialRender = false;
}

install();
