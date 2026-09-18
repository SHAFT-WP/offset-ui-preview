import { calculateOffsetV0_2 } from "./AG/bombing/offset-bombing/offset-be-v0.2.mjs";
import { SVG_DIAGRAM_TEXT_SCALE_V0_1 } from "./common/diagram/svg-primitives-v0.1.mjs";
import { createValueStateController } from "./common/ui/value-state-controller-v0.1.mjs";
import { exportOffsetTopView, installOffsetTopViewControls, renderOffsetTopView } from "./renderer-v0.1.mjs";

const LOW_ANGLE_BOUNDARY_DEG = 10;
const TOP_VIEW_TEXT_SCALE_DEFAULT = SVG_DIAGRAM_TEXT_SCALE_V0_1.userDefaultScale;
const TOP_VIEW_MOBILE_MAX_WIDTH_PX = SVG_DIAGRAM_TEXT_SCALE_V0_1.mobileMaxWidthPx;
const FT_PER_NM = 6076.11549;
const DEFAULT_REFERENCE_RANGE_NM = 10;
const STORAGE_KEY = "flight-sim-tools.offset.v2.input.v1";
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
  gOnsetTimeSec: "2",
  windDirectionDeg: "0",
  windSpeedKt: "0",
  solveMode: "height",
  rollInBankAngleDeg: "113",
  rollInG: "4",
  vrpRangeNm: "10.0",
  runInHeadingDeg: "000",
  ipRangeNm: "10.0",
  attackHeadingDeg: "030",
  offsetAngleDeg: "40",
  actionRangeNm: "3.0",
  offsetRangeNm: "1.0",
  offsetAltitudeMslFt: "16000",
  offsetSpeedValue: "350",
  offsetSpeedMode: "CAS",
  offsetG: "2.0",
  offsetBankDeg: "60",
  offsetRadiusNm: "1.60",
});

const locks = {};
let driver = "angleOffDeg";
let turnDriver = "offsetG";
let referenceMode = "VRP";
let vipBearingDirection = "TO_TARGET";
let ipBearingDirection = "TO_TARGET";
let ipLinked = true;
let vipBearingExplicit = false;
let vipRangeExplicit = false;
let vrpBearingExplicit = false;
let vrpRangeExplicit = false;
let rollBankAuto = true;
let rollInAltitudeLinked = true;
let topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
let lastResult = null;
let initialRender = true;
let lastResultSnapshot = null;
let defaultPersistedState = null;
let persistenceReady = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const allFields = (key) => $$(`[data-key="${key}"]`);
const fields = (key) => key === "runInHeadingDeg"
  ? allFields(key).filter((field) => field.id !== "ip-bearing-input")
  : allFields(key);
const firstField = (key) => fields(key)[0];
const valueStates = createValueStateController({ root: document, transientMs: 1200 });

const numberValue = (key) => {
  const parsed = Number.parseFloat(firstField(key)?.value ?? "");
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
  if (!vrpRangeExplicit) return DEFAULT_REFERENCE_RANGE_NM;
  const parsed = Number.parseFloat(firstField("vrpRangeNm")?.value ?? "");
  return Number.isFinite(parsed) ? parsed : DEFAULT_REFERENCE_RANGE_NM;
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
    vrpRange.value = DEFAULT_REFERENCE_RANGE_NM.toFixed(1);
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

function applyVipToLinkedIp(sourceKey = "vip") {
  if (!ipLinked) return false;
  if (locks.runInHeadingDeg) {
    ipLinked = false;
    return false;
  }

  const vipBearingDeg = readVipToTargetBearing();
  const vipRangeNm = readVipRangeNm();
  const headingChanged = setAutoValue("runInHeadingDeg", vipBearingDeg.toFixed(2), sourceKey);
  const rangeChanged = setAutoValue("ipRangeNm", vipRangeNm.toFixed(3), sourceKey);
  syncIpBearingInput(vipBearingDeg, { includeActive: true });
  syncImplicitReferenceInputs(vipBearingDeg);
  return headingChanged || rangeChanged;
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
  const approachRangeNm = numberValue("offsetRangeNm");
  return {
    driver,
    turnDriver,
    locks: { ...locks },
    referenceMode,
    vrpLinked: false,
    vipLinked: false,
    runInHeadingDeg,
    attackHeadingDeg: numberValue("attackHeadingDeg"),
    angleOffDeg: numberValue("angleOffDeg"),
    diveAngleDeg: numberValue("diveAngleDeg"),
    offsetAngleDeg: numberValue("offsetAngleDeg"),
    actionRangeNm: numberValue("actionRangeNm"),
    approachRangeNm,
    offsetRangeNm: approachRangeNm,
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
  return setAutoValue(key, next, sourceKey);
}

function applyResolved(result) {
  setIfUnlocked("attackHeadingDeg", result.resolved.attackHeadingDeg, 2);
  setIfUnlocked("angleOffDeg", result.resolved.angleOffDeg, 2);
  setIfUnlocked("offsetAngleDeg", result.resolved.offsetAngleDeg, 2);
  setIfUnlocked("actionRangeNm", result.resolved.actionRangeNm, 3);
  setIfUnlocked("offsetRangeNm", result.resolved.approachRangeNm, 3);
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

function row(label, renderedValue, resultKey = null) {
  const rendered = resultKey ? `<span class="value-result" data-result-key="${resultKey}">${renderedValue}</span>` : renderedValue;
  return `<tr><td>${label}</td><td>${rendered}</td></tr>`;
}

function renderOffsetResult(result) {
  const g = result.geometry;
  const t = result.timing;
  $("#offset-result-body").innerHTML = [
    row("State", result.state),
    row("Run-In / Attack", `${fmtHeading(g.runInHeadingDeg)} → ${fmtHeading(g.attackHeadingDeg)}`, "runAttackSummary"),
    row("Offset Heading", fmtHeading(g.offsetHeadingDeg), "offsetHeadingDeg"),
    row("Offset Angle", `${fmt(g.offsetAngleDeg, 2)}°`, "offsetAngleDeg"),
    row("Angle-Off (Heading)", `${fmt(g.angleOffDeg, 2)}°`, "angleOffDeg"),
    row("Action Range", `${fmt(g.actionRangeNm, 3)} NM`, "actionRangeNm"),
    row("Approach Range", `${fmt(result.resolved.approachRangeNm, 3)} NM`, "approachRangeNm"),
    row("IP Range", `${fmt(result.resolved.ipRangeNm, 3)} NM · ${ipLinked ? "LINKED TO VIP" : "INDEPENDENT"}`, "ipRangeNm"),
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
  });
}

function calculate() {
  try {
    const result = calculateOffsetV0_2(buildInput());
    lastResult = result;
    applyResolved(result);
    renderStatus(result);
    renderOffsetResult(result);
    renderProfileResult(result);
    renderTopView(result);
    renderDed(result);
    applyResultChangeStates(result);
  } catch (error) {
    const message = $("#constraint-message");
    message.textContent = `INVALID · ${error.message}`;
    message.className = "status-message invalid";
    const pill = $("#state-pill");
    pill.textContent = "INVALID";
    pill.className = "status bad";
    if (lastResult) {
      renderTopView(lastResult);
      renderDed(lastResult);
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

  if (key === "initialAltitudeMslFt" && rollInAltitudeLinked) {
    setAutoValue("rollInAltitudeMslFt", Math.round(numberValue("initialAltitudeMslFt")), key);
  }
  if (key === "rollInAltitudeMslFt") {
    rollInAltitudeLinked = false;
  }

  if (key === "vrpRangeNm") {
    vrpRangeExplicit = Number.isFinite(Number.parseFloat(field.value));
    calculate();
    return;
  }

  if (key === "ipRangeNm") {
    ipLinked = false;
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
  } else if (key === "offsetRangeNm") {
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
  if (ipLinked) applyVipToLinkedIp("vipBearingDeg");
  calculate();
}

function handleVipRangeInput(event) {
  vipRangeExplicit = Number.isFinite(Number.parseFloat(event.target.value));
  if (ipLinked) applyVipToLinkedIp("vipRangeNm");
  calculate();
}

function handleIpBearingInput(event) {
  const entered = Number.parseFloat(event.target.value);
  if (!Number.isFinite(entered)) return;
  ipLinked = false;
  const canonical = canonicalToTargetBearing(entered, ipBearingDirection);
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
    inputs[key] = control.value;
  });
  return {
    version: 1,
    inputs,
    vrpBearingInput: $("#vrp-bearing-input")?.value ?? "",
    vipBearingInput: $("#vip-bearing-input")?.value ?? "",
    vipRangeInput: $("#vip-range-input")?.value ?? "",
    referenceMode,
    vipBearingDirection,
    ipBearingDirection,
    ipLinked,
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
    version: 1,
    inputs: { ...DEFAULT_INPUT_VALUES },
    vrpBearingInput: "180",
    vipBearingInput: "000",
    vipRangeInput: "10.0",
    referenceMode: "VRP",
    vipBearingDirection: "TO_TARGET",
    ipBearingDirection: "TO_TARGET",
    ipLinked: true,
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
  Object.entries(saved.inputs ?? {}).forEach(([key, next]) => {
    if (firstField(key)) setValue(key, next, { includeActive: true });
  });

  if ($("#vrp-bearing-input") && typeof saved.vrpBearingInput === "string") $("#vrp-bearing-input").value = saved.vrpBearingInput;
  if ($("#vip-bearing-input") && typeof saved.vipBearingInput === "string") $("#vip-bearing-input").value = saved.vipBearingInput;
  if ($("#vip-range-input") && typeof saved.vipRangeInput === "string") $("#vip-range-input").value = saved.vipRangeInput;

  referenceMode = saved.referenceMode === "VIP" ? "VIP" : "VRP";
  vipBearingDirection = saved.vipBearingDirection === "FROM_TARGET" ? "FROM_TARGET" : "TO_TARGET";
  ipBearingDirection = saved.ipBearingDirection === "FROM_TARGET" ? "FROM_TARGET" : "TO_TARGET";
  ipLinked = saved.ipLinked !== false;
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
  if (ipLinked) applyVipToLinkedIp("restore");
  return true;
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return applyPersistedState(JSON.parse(raw));
  } catch {
    return false;
  }
}

function savePersistedState({ feedback = false } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capturePersistedState()));
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
  if (!defaultPersistedState) return;
  applyPersistedState(JSON.parse(JSON.stringify(defaultPersistedState)));
  clearPendingInputStates();
  driver = "angleOffDeg";
  turnDriver = "offsetG";
  topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
  const fontScaleSelect = $("#top-view-font-scale");
  if (fontScaleSelect) {
    fontScaleSelect.value = String(topViewTextScale);
    fontScaleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  calculate();
  savePersistedState();
}

function installToolbarControls() {
  $("#advanced-toggle")?.addEventListener("click", (event) => {
    document.body.classList.toggle("show-advanced");
    const on = document.body.classList.contains("show-advanced");
    event.currentTarget.classList.toggle("active", on);
    event.currentTarget.textContent = `Advanced: ${on ? "On" : "Off"}`;
  });
  $("#save-button")?.addEventListener("click", () => savePersistedState({ feedback: true }));
  $("#default-button")?.addEventListener("click", resetDefaults);
}

function install() {
  populateWeapons();
  installLocks();
  installModeButtons();
  installReferenceBearingControls();
  installValueStateBindings();
  installToolbarControls();
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
    resetButton: $("#zoom-reset"),
  });
  const fontScaleSelect = $("#top-view-font-scale");
  if (fontScaleSelect) {
    fontScaleSelect.value = String(topViewTextScale);
    fontScaleSelect.addEventListener("change", () => {
      const next = Number.parseFloat(fontScaleSelect.value);
      topViewTextScale = Number.isFinite(next) ? next : TOP_VIEW_TEXT_SCALE_DEFAULT;
      if (lastResult) renderTopView(lastResult);
    });
  }
  $("#zoom-reset")?.addEventListener("click", () => {
    topViewTextScale = TOP_VIEW_TEXT_SCALE_DEFAULT;
    if (fontScaleSelect) {
      fontScaleSelect.value = String(topViewTextScale);
      fontScaleSelect.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (lastResult) {
      renderTopView(lastResult);
    }
  });
  let compactTextViewport = globalThis.innerWidth <= TOP_VIEW_MOBILE_MAX_WIDTH_PX;
  const syncViewportTextBase = () => {
    const nextCompact = globalThis.innerWidth <= TOP_VIEW_MOBILE_MAX_WIDTH_PX;
    if (nextCompact === compactTextViewport) return;
    compactTextViewport = nextCompact;
    if (lastResult) renderTopView(lastResult);
  };
  globalThis.addEventListener?.("resize", syncViewportTextBase);
  if (globalThis.ResizeObserver) {
    const viewportObserver = new ResizeObserver(syncViewportTextBase);
    viewportObserver.observe(document.documentElement);
  }
  $("#capture-top-view").addEventListener("click", () => exportOffsetTopView(svg));

  const restored = loadPersistedState();
  if (!restored) applyPersistedState(defaultPersistedState);
  if (rollBankAuto) applyAutomaticRollBank(restored ? "restore" : "default");
  persistenceReady = true;
  calculate();
  initialRender = false;
}

install();