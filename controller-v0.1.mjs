import { installResultPanel } from "./common/ui/result-panel-v0.1.mjs";
import { installSvgLegend } from "./common/diagram/svg-legend-v0.1.mjs";
import { calculateOffsetWithVrpStart } from "./AG/bombing/offset-bombing/offset-be-v0.2.mjs?v=vrp-start-1";
import {
  applyElementLeadOffsetAngle,
  computeDropOrderDelta,
  computeFormationOffsetVector,
  solveElementSameTimeActionRange,
} from "./AG/bombing/offset-bombing/offset-formation-v0.1.mjs?v=formation-1";
import { calculateOffAxisOffset } from "./AG/bombing/offset-bombing/offset-formation-geometry-v0.1.mjs?v=formation-geometry-1";
import { add as addWorldPoints } from "./AG/bombing/offset-bombing/offset-geometry-v0.2.mjs?v=vrp-start-1";
import { SVG_DIAGRAM_TEXT_SCALE_V0_1 } from "./common/diagram/svg-primitives-v0.1.mjs";
import { createValueStateController } from "./common/ui/value-state-controller-v0.1.mjs";
import { saveSvgAsPng } from "./common/diagram/svg-png-export-v0.1.mjs";
import { exportOffsetTopView, installOffsetTopViewControls, renderOffsetTopView } from "./renderer-v0.1.mjs";
import { renderOffsetZDiagram } from "./offset-z-diagram-v0.1.mjs";

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
// whatever it conflicts with (its own manual LOCK, and each other — the coupled solve has one
// free parameter, so Offset Angle and Action Range cannot both be substituted at once).
const FLIGHT_TOGGLE_EXCLUSIONS = {
  offsetAngleLocked: ["sameAngleAsLead"],
  sameAngleAsLead: ["offsetAngleLocked", "sameTimeAsLead"],
  actionRangeLocked: ["sameTimeAsLead"],
  sameTimeAsLead: ["actionRangeLocked", "sameAngleAsLead"],
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
  trackingTimeSec: "18.25",
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
  ipRangeNm: "7.0",
  attackHeadingDeg: "030",
  offsetAngleDeg: "40",
  actionRangeNm: "7.0",
  approachRangeNm: "1.0",
  offsetAltitudeMslFt: "16000",
  offsetSpeedValue: "350",
  offsetSpeedMode: "CAS",
  offsetG: "2.0",
  offsetBankDeg: "60",
  offsetRadiusNm: "1.60",
});

const locks = {};
let driver = "vrpRangeNm";
let turnDriver = "offsetG";
let referenceMode = "VRP";
let vipBearingDirection = "TO_TARGET";
let ipBearingDirection = "TO_TARGET";
let ipLinked = true;
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

function applyResolved(result) {
  setAutoValue("runInHeadingDeg", formatBearingInput(result.resolved.runInHeadingDeg));
  if (ipLinked && !locks.ipReference) setAutoValue("ipRangeNm", result.resolved.ipRangeNm.toFixed(3));
  if (!locks.vrpReference) {
    setAutoValue("vrpRangeNm", result.resolved.vrpRangeNm.toFixed(3));
    if (document.activeElement !== $("#vrp-bearing-input")) $("#vrp-bearing-input").value = formatBearingInput(result.resolved.vrpBearingDeg);
    vrpBearingExplicit = true;
    vrpRangeExplicit = true;
  }
  setIfUnlocked("attackHeadingDeg", result.resolved.attackHeadingDeg, 2);
  setIfUnlocked("angleOffDeg", result.resolved.angleOffDeg, 2);
  setIfUnlocked("offsetAngleDeg", result.resolved.offsetAngleDeg, 2);
  setIfUnlocked("actionRangeNm", result.resolved.actionRangeNm, 3);
  setIfUnlocked("approachRangeNm", result.resolved.approachRangeNm, 3);
  setIfUnlocked("offsetG", result.resolved.offsetG, 3, turnDriver);
  setIfUnlocked("offsetBankDeg", result.resolved.offsetBankDeg, 2, turnDriver);
  setIfUnlocked("offsetRadiusNm", result.resolved.offsetRadiusNm, 3, turnDriver);

  syncVipBearingInput(result.resolved.vipToTargetBearingDeg);
  syncIpBearingInput(result.resolved.runInHeadingDeg);
  $("#offset-heading-out").textContent = fmtHeading(result.resolved.offsetHeadingDeg);
  $("#turn-time-out").textContent = `${fmt(result.timing.offsetTurnSec, 1)} sec`;
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
    row("Offset Angle", `${fmt(g.offsetAngleDeg, 2)}°`, "offsetAngleDeg"),
    row("Angle-Off (Heading)", `${fmt(g.angleOffDeg, 2)}°`, "angleOffDeg"),
    row("Action Range", `${fmt(g.actionRangeNm, 3)} NM`, "actionRangeNm"),
    row("Approach Range", `${fmt(result.resolved.approachRangeNm, 3)} NM`, "approachRangeNm"),
    row("IP Range", `${fmt(result.resolved.ipRangeNm, 3)} NM · ${ipLinked ? "LINKED TO VRP" : "INDEPENDENT"}`, "ipRangeNm"),
    row("Offset Radius", `${fmt(result.resolved.offsetRadiusNm, 3)} NM`, "offsetRadiusNm"),
    row("Offset TAS", `${fmt(result.resolved.offsetTasKt, 1)} kt`, "offsetTasKt"),
    row("Reference", `${result.referenceMode} · ${fmt(result.reference.bearingDeg, 1)}° / ${fmt(result.reference.displayRangeNm, 3)} NM`, "referenceSummary"),
    row("IP → Action Point", `${fmt(t.ingressDistanceNm, 3)} NM / ${fmt(t.ingressSec, 1)} sec`, "ingressSummary"),
    row("Offset Turn", `${fmt(t.offsetTurnSec, 1)} sec`, "offsetTurnSec"),
    row("Approach Time", `${fmt(t.approachSec, 1)} sec`, "approachSec"),
    row("Roll-in → Release", `${fmt(t.rollToReleaseSec, 1)} sec`, "rollToReleaseSec"),
    row("Legacy ΔTOS", `${t.legacyDeltaTosSec >= 0 ? "+" : ""}${fmt(t.legacyDeltaTosSec, 1)} sec`, "legacyDeltaTosSec"),
  ].join("");
}

function renderProfileResult(result) {
  const p = result.profile.public;
  $("#profile-result-body").innerHTML = [
    row("Effective Release Altitude", `${fmt(p.effectiveReleaseAltitudeMslFt, 0)} ft MSL`, "effectiveReleaseAltitudeMslFt"),
    row("Roll-In Altitude", `${fmt(p.resolvedInitialAltitudeMslFt, 0)} ft MSL`, "resolvedInitialAltitudeMslFt"),
    row("Track Point Altitude", `${fmt(p.trackPointAltitudeMslFt, 0)} ft MSL`, "trackPointAltitudeMslFt"),
    row("Tracking Time", `${fmt(p.trackingTimeSec, 2)} sec`, "trackingTimeSecResult"),
    row("Roll-in Range", `${fmt(p.rollInRangeNm, 3)} NM`, "rollInRangeNm"),
    row("Ground Range", `${fmt(p.groundRangeNm, 3)} NM`, "groundRangeNm"),
    row("Roll-in Radius", `${fmt(p.rollInRadiusNm, 3)} NM`, "rollInRadiusNm"),
    row("Roll-in Time", `${fmt(p.rollInTimeSec, 2)} sec`, "rollInTimeSec"),
    row("Roll-in Ground Arc", `${fmt(p.rollInGroundArcNm, 3)} NM`, "rollInGroundArcNm"),
    row("Roll-in Altitude Loss", `${fmt(p.rollInAltitudeLossFt, 0)} ft`, "rollInAltitudeLossFt"),
    row("Lead Angle", `${fmt(p.leadAngleDeg, 2)}°`, "leadAngleDeg"),
    row("MINALT", `${fmt(p.minAltMslFt, 0)} ft MSL`, "minAltMslFt"),
    row("NLT Release", `${fmt(p.nltReleaseMslFt, 0)} ft MSL`, "nltReleaseMslFt"),
    row("Bomb Range / TOF", `${fmt(p.bombRangeNm, 3)} NM / ${fmt(p.bombTofSec, 2)} sec`, "bombRangeTofSummary"),
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
  return `${Math.round(rangeNm * FT_PER_NM)} ft (${fmt(rangeNm, 2)} NM)`;
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
  $("#ded-bearing").textContent = `${fmt(isVip ? result.resolved.vipToTargetBearingDeg : result.resolved.vrpBearingDeg, 1)}°`;
  $("#ded-range").textContent = dedRangeText(isVip ? result.resolved.vipRangeNm : result.resolved.vrpRangeNm);
  $("#ded-elevation").textContent = dedElevationText(targetElevationMslFt);

  const oa1Base = isVip ? points.vip : points.target;
  $("#ded-oa1-bearing").textContent = `${fmt(bearingBetween(oa1Base, points.rollStart), 1)}°`;
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
  legendItems[4].label = `Roll-in Radius · ${fmt(g.rollInRadiusNm, 2)} NM`;
  legend.render();
}

function calculate() {
  try {
    const result = calculateOffsetWithVrpStart(buildInput());
    lastResult = result;
    applyResolved(result);
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
  }
  if (key === "rollInAltitudeMslFt") {
    rollInAltitudeLinked = false;
  }

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
  } else if (["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "diveAngleDeg"].includes(key)) {
    driver = key;
  } else {
    driver = "profile";
  }
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
  vipRangeInput.addEventListener("blur", () => { vipRangeInput.value = fmt(readVipRangeNm(), 3); });

  vrpBearingInput.addEventListener("input", () => {
    vrpBearingExplicit = Number.isFinite(Number.parseFloat(vrpBearingInput.value));
    driver = "vrpBearingDeg";
    calculate();
  });
  vrpBearingInput.addEventListener("blur", () => { vrpBearingInput.value = formatBearingInput(readVrpBearing()); });
  vrpRangeInput?.addEventListener("blur", () => { vrpRangeInput.value = fmt(readVrpRangeNm(), 3); });

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

function savePersistedState({ feedback = false } = {}) {
  try {
    const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const aircraft = previous?.version === 4 && previous.aircraft && typeof previous.aircraft === "object"
      ? previous.aircraft : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, aircraft: { ...aircraft, "1": capturePersistedState() } }));
  } catch {
    // Storage may be unavailable in a restricted browser context; calculation remains usable.
  }
  if (!feedback) return;
  const button = $("#save-button");
  if (!button) return;
  const previous = button.textContent;
  button.textContent = "Saved";
  window.setTimeout(() => { button.textContent = previous; }, 900);
}

function clearPendingInputStates() {
  $$(".value-dependent-input").forEach((node) => node.classList.remove("value-dependent-input"));
}

function resetDefaults() {
  resultPanel.resetText();
  if (!defaultPersistedState) return;
  applyPersistedState(JSON.parse(JSON.stringify(defaultPersistedState)));
  clearPendingInputStates();
  driver = "vrpRangeNm";
  turnDriver = "offsetG";
  topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
  const fontScaleSelect = $("#top-view-font-scale");
  if (fontScaleSelect) {
    fontScaleSelect.value = String(topViewTextScale);
    fontScaleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  calculate();
  savePersistedState();
  flightLayout.size = 1;
  flightLayout.aircraft = {};
  renderFlightLayout();
  saveFlightLayout();
}

function installToolbarControls() {
  $("#full-bdp-toggle")?.addEventListener("click", (event) => {
    const on = document.body.classList.toggle("show-full-bdp");
    event.currentTarget.classList.toggle("active", on);
    event.currentTarget.setAttribute("aria-pressed", String(on));
    event.currentTarget.textContent = `Full BDP: ${on ? "On" : "Off"}`;
  });
  $("#advanced-toggle")?.addEventListener("click", (event) => {
    document.body.classList.toggle("show-advanced");
    const on = document.body.classList.contains("show-advanced");
    event.currentTarget.classList.toggle("active", on);
    event.currentTarget.textContent = `Advanced: ${on ? "On" : "Off"}`;
  });
  $("#save-button")?.addEventListener("click", () => savePersistedState({ feedback: true }));
  $("#default-button")?.addEventListener("click", resetDefaults);
}

function flightDraft(number) {
  return flightLayout.aircraft[number] ||= {
    weaponId: "M82", side: "LEFT", bearingDeg: "90", distanceNm: "1",
    initialSpeedValue: "350", initialAltitudeMslFt: "16000", diveAngleDeg: "45",
    trackingTimeSec: "18.25", releaseAltitudeMslFt: "6800", releaseSpeedKcas: "450",
    attackHeadingDeg: "030", angleOffDeg: "70",
    offsetAngleDeg: "40", actionRangeFromIpNm: "4.0",
    offsetAngleLocked: false, sameAngleAsLead: true,
    actionRangeLocked: false, sameTimeAsLead: false,
  };
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

function flightSection(number, title, content, { calculating = false } = {}) {
  const badge = calculating ? "" : `<span class="flight-draft-badge">UI draft</span>`;
  return `<section class="section flight-draft-section"><div class="section-head"><h2>${title} #${number}</h2>${badge}</div>${content}</section>`;
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
    flightSection(number, "Formation", `<p class="flight-draft-note">Start point relative to #1's own IP; feeds this aircraft's Run-In line.</p><div class="flight-draft-grid"><label class="field"><span>Side</span><select data-flight-field="side"><option value="LEFT">Left</option><option value="RIGHT">Right</option></select></label><label class="field"><span>Bearing (°)</span><input type="number" min="0" max="180" step="1" data-flight-field="bearingDeg"></label><label class="field"><span>Distance (NM)</span><input type="number" min="0" step="0.1" data-flight-field="distanceNm"></label></div>`),
    flightSection(number, "BDP", `<div class="input-grid"><label class="field flight-weapon-field"><span>Bomb</span><select data-flight-field="weaponId"></select></label><label class="field"><span>Initial Speed (KCAS)</span><input data-flight-field="initialSpeedValue" type="text" inputmode="decimal"></label><label class="field"><span>Initial Altitude (ft MSL)</span><input data-flight-field="initialAltitudeMslFt" type="text" inputmode="decimal"></label><label class="field"><span>Dive Angle (deg)</span><input data-flight-field="diveAngleDeg" type="text" inputmode="decimal"></label><label class="field"><span>Tracking Time (sec)</span><input data-flight-field="trackingTimeSec" type="text" inputmode="decimal"></label><label class="field"><span>Release Altitude (ft MSL)</span><input data-flight-field="releaseAltitudeMslFt" type="text" inputmode="decimal"></label><label class="field"><span>Release Speed (KCAS)</span><input data-flight-field="releaseSpeedKcas" type="text" inputmode="decimal"></label></div><p class="flight-draft-note">Target Elevation, Wind, Fragment Margin, Recovery G and Roll-in Turn inputs follow #1.</p>`, { calculating: true }),
    flightSection(number, "Offset", `<div class="section-head"><span id="flight-state-pill-${number}" class="status ok">VALID</span></div><div class="input-grid"><label class="field"><span>Run-In Heading</span><output data-flight-readout="runInHeadingDeg">-</output><span class="unit">Follows #1 · parallel Run-In</span></label><label class="field"><span>IP Range from Target</span><output data-flight-readout="ipRangeFromTargetNm">-</output><span class="unit">NM · from Formation position</span></label><label class="field"><span>Attack Heading (deg)</span><input data-flight-field="attackHeadingDeg" type="text" inputmode="decimal"></label><label class="field"><span>Angle-Off (deg)</span><input data-flight-field="angleOffDeg" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Offset Angle (deg)</span><button class="lock-button" type="button" data-flight-field="offsetAngleLocked" aria-pressed="false">LOCK</button><button class="lock-button" type="button" data-flight-field="sameAngleAsLead" aria-pressed="false">SAME AS #${leadNumber}</button></span><input data-flight-field="offsetAngleDeg" type="text" inputmode="decimal"></label><label class="field"><span class="lock-title"><span>Action Range from own IP (NM)</span><button class="lock-button" type="button" data-flight-field="actionRangeLocked" aria-pressed="false">LOCK</button><button class="lock-button" type="button" data-flight-field="sameTimeAsLead" aria-pressed="false">SAME TIME AS #${leadNumber}</button></span><input data-flight-field="actionRangeFromIpNm" type="text" inputmode="decimal"></label></div><div id="flight-status-${number}" class="status-message valid">-</div>`, { calculating: true }),
    flightSection(number, "Z-Diagram", `<p class="flight-draft-note">Aircraft #${number} diagram is pending its profile result.</p>`),
    flightSection(number, "Top View", `<div class="top-view-shell"><svg data-flight-topview viewBox="0 0 1180 1440" role="img" aria-label="Aircraft #${number} Offset top view"><defs></defs></svg></div><p class="flight-draft-note">Leader #${leadNumber}'s already-solved profile is drawn in full alongside this aircraft's own, sharing Target and scale; it does not feed aircraft #${number}'s own solve.</p><div class="flight-draft-grid flight-timing-deltas"><div class="field"><span>IP→Release Δ vs #${leadNumber}</span><output data-flight-timing="ipToReleaseDeltaSec">-</output></div><div class="field"><span>IP→Impact Δ vs #${leadNumber}</span><output data-flight-timing="ipToImpactDeltaSec">-</output></div><div class="field"><span>#${leadNumber} Impact → #${number} Release</span><output data-flight-timing="predecessorImpactToOwnReleaseSec">-</output></div><div class="field"><span>#${leadNumber} Bomb TOF</span><output data-flight-timing="predecessorBombTofSec">-</output></div></div>`, { calculating: true }),
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
            diveAngleDeg: str("diveAngleDeg"),
            trackingTimeSec: str("trackingTimeSec"),
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
    flightDraft(number)[field.dataset.flightField] = field.type === "checkbox" ? field.checked : field.value;
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

function followerNumberValue(slot, draft, key) {
  const raw = followerField(slot, key)?.value ?? draft[key];
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
  if (sameAngleAsLead && sameTimeAsLead) throw new Error("CONSTRAINT CONFLICT: Same-as-Element-Lead Offset Angle and Same-Time-as-Element-Lead Action Range cannot both be active");

  const runInHeadingDeg = leaderResult.resolved.runInHeadingDeg;
  const ipPoint = followerIpPoint(number, slot, leaderResult);
  const sharedProfile = leaderResult.profile.canonicalInputs;
  const driver = actionRangeLocked ? "actionRangeFromIpNm" : "angleOffDeg";

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
      recoveryG: sharedProfile.recoveryG,
      gOnsetTimeSec: sharedProfile.gOnsetTimeSec,
      speedOvershootKcas: sharedProfile.speedOvershootKcas,
      fragmentHeightMarginPercent: sharedProfile.fragmentHeightMarginPercent,
      diveAngleDeg: num("diveAngleDeg"),
      initialSpeedValue: num("initialSpeedValue"),
      initialSpeedMode: "CAS",
      initialAltitudeMslFt: num("initialAltitudeMslFt"),
      solveMode: "height",
      trackingTimeSec: num("trackingTimeSec"),
      releaseAltitudeMslFt: num("releaseAltitudeMslFt"),
      releaseSpeedKcas: num("releaseSpeedKcas"),
      rollInBankAngleDeg: sharedProfile.rollInBankAngleDeg,
      rollInG: sharedProfile.rollInG,
    },
  };
  return { baseInput, sameAngleAsLead, sameTimeAsLead };
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
    output.textContent = Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(1)} s` : "-";
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
  };
  sync("offsetAngleDeg", result.resolved.offsetAngleDeg, 2);
  sync("actionRangeFromIpNm", result.resolved.actionRangeFromIpNm, 2);
  sync("attackHeadingDeg", result.resolved.attackHeadingDeg, 1);
  sync("angleOffDeg", result.resolved.angleOffDeg, 1);
}

function geometryWorldPoints(geometry) {
  return [...Object.values(geometry.points), ...geometry.rollInTrajectorySamples];
}

// Both Top View calls below share one auto-fit projection (each passes the other's world points
// as extraFitPoints), so the element lead's full-fidelity render and this aircraft's own render
// land in the same scale/frame and their Target markers coincide.
function renderFollowerTopView(number, slot, leaderResult, result) {
  const svg = slot.querySelector("svg[data-flight-topview]");
  if (!svg) return;
  const leaderPoints = geometryWorldPoints(leaderResult.geometry);
  const ownPoints = geometryWorldPoints(result.geometry);
  renderOffsetTopView(svg, leaderResult, { plotGroupId: `offset-plot-lead-${number}`, extraFitPoints: ownPoints });
  renderOffsetTopView(svg, result, { plotGroupId: `offset-plot-${number}`, extraFitPoints: leaderPoints, paintBackground: false });
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
    if (sameAngleAsLead) {
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
    renderFollowerStatus(number, result.state, result.errors[0] ?? result.warnings[0] ?? "-");
    renderFollowerTopView(number, slot, leaderResult, result);
    const runInReadout = slot.querySelector('[data-flight-readout="runInHeadingDeg"]');
    if (runInReadout) runInReadout.textContent = fmtHeading(result.resolved.runInHeadingDeg);
    const ipRangeReadout = slot.querySelector('[data-flight-readout="ipRangeFromTargetNm"]');
    if (ipRangeReadout) ipRangeReadout.textContent = fmt(Math.hypot(baseInput.ipPoint.x, baseInput.ipPoint.y), 2);
    renderFollowerTimingDeltas(number, computeDropOrderDelta({ predecessorResult: leaderResult, ownResult: result }));
  } catch (error) {
    flightResults.delete(number);
    renderFollowerStatus(number, "INVALID", error.message);
    renderFollowerTimingDeltas(number, null);
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
    button.addEventListener("click", () => {
      body.hidden = !body.hidden;
      button.setAttribute("aria-expanded", String(!body.hidden));
      if (!body.hidden) requestAnimationFrame(() => legend.render());
    });
  });
}

function install() {
  populateWeapons();
  installLocks();
  installModeButtons();
  installReferenceBearingControls();
  installValueStateBindings();
  installToolbarControls();
  installFlightLayout();
  installSectionDisclosure();
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
