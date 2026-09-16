import { calculateOffsetV0_2 } from "./AG/bombing/offset-bombing/offset-be-v0.2.mjs";
import { createValueStateController } from "./common/ui/value-state-controller-v0.1.mjs";
import { exportOffsetTopView, installOffsetTopViewControls, renderOffsetTopView } from "./renderer-v0.1.mjs";

const LOW_ANGLE_BOUNDARY_DEG = 10;
const TOP_VIEW_FONT_SCALE_DEFAULT = 1.5;
const locks = {};
let driver = "angleOffDeg";
let turnDriver = "offsetG";
let referenceMode = "VRP";
let vrpLinked = true;
let vipLinked = true;
let rollBankAuto = true;
let topViewFontScale = TOP_VIEW_FONT_SCALE_DEFAULT;
let lastResult = null;
let initialRender = true;
let lastResultSnapshot = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fields = (key) => $$(`[data-key="${key}"]`);
const firstField = (key) => fields(key)[0];
const valueStates = createValueStateController({ root: document, transientMs: 1200 });
const numberValue = (key) => {
  const value = Number.parseFloat(firstField(key)?.value ?? "");
  if (!Number.isFinite(value)) throw new TypeError(`${key} must be numeric`);
  return value;
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
  const changed = fields(key).some((field) => (includeActive || field !== active) && !valuesEquivalent(field.value, nextText));
  if (changed) valueStates.setInputValue(key, nextText, { includeActive });
  return changed;
};
const setAutoValue = (key, next, sourceKey = null) => {
  const changed = setValue(key, next);
  if (changed && !initialRender && sourceKey !== key) valueStates.markDependentInput(key);
  return changed;
};
const fmt = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : "-";
const fmtHeading = (value) => {
  if (!Number.isFinite(value)) return "-";
  const h = ((Math.round(value) % 360) + 360) % 360;
  return String(h === 0 ? 360 : h).padStart(3, "0") + "°";
};

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
  return {
    driver, turnDriver, locks: { ...locks }, referenceMode, vrpLinked, vipLinked,
    runInHeadingDeg: numberValue("runInHeadingDeg"), attackHeadingDeg: numberValue("attackHeadingDeg"), angleOffDeg: numberValue("angleOffDeg"),
    diveAngleDeg: numberValue("diveAngleDeg"), offsetAngleDeg: numberValue("offsetAngleDeg"), actionRangeNm: numberValue("actionRangeNm"), offsetRangeNm: numberValue("offsetRangeNm"), ipRangeNm: numberValue("ipRangeNm"),
    vrpRangeNm: numberValue("vrpRangeNm"), vipRangeNm: numberValue("vipRangeNm"),
    offsetAltitudeMslFt: numberValue("offsetAltitudeMslFt"), offsetSpeedValue: numberValue("offsetSpeedValue"), offsetSpeedMode: value("offsetSpeedMode") ?? "CAS",
    offsetG: numberValue("offsetG"), offsetBankDeg: numberValue("offsetBankDeg"), offsetRadiusNm: numberValue("offsetRadiusNm"),
    profile: {
      weaponId: value("weaponId") ?? "M82", targetElevationMslFt: numberValue("targetElevationMslFt"), releaseSpeedKcas: numberValue("releaseSpeedKcas"),
      speedOvershootKcas: numberValue("speedOvershootKcas"), recoveryG: numberValue("recoveryG"), gOnsetTimeSec: numberValue("gOnsetTimeSec"),
      diveAngleDeg: numberValue("diveAngleDeg"), windDirectionDeg: numberValue("windDirectionDeg"), windSpeedKt: numberValue("windSpeedKt"),
      initialSpeedValue: numberValue("initialSpeedValue"), initialSpeedMode: value("initialSpeedMode") ?? "CAS", initialAltitudeMslFt: numberValue("initialAltitudeMslFt"),
      solveMode: value("solveMode") ?? "height", trackingTimeSec: numberValue("trackingTimeSec"), releaseAltitudeMslFt: numberValue("releaseAltitudeMslFt"),
      angleOffDeg: numberValue("angleOffDeg"), rollInBankAngleDeg: numberValue("rollInBankAngleDeg"), rollInG: numberValue("rollInG"),
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
  setIfUnlocked("offsetRangeNm", result.resolved.offsetRangeNm, 3);
  setIfUnlocked("ipRangeNm", result.resolved.ipRangeNm, 3);
  setIfUnlocked("offsetG", result.resolved.offsetG, 3, turnDriver);
  setIfUnlocked("offsetBankDeg", result.resolved.offsetBankDeg, 2, turnDriver);
  setIfUnlocked("offsetRadiusNm", result.resolved.offsetRadiusNm, 3, turnDriver);
  if (result.referenceMode === "VRP" && vrpLinked && !locks.vrpRangeNm) setAutoValue("vrpRangeNm", fmt(result.resolved.vrpRangeNm, 3), "actionRangeNm");
  if (result.referenceMode === "VIP" && vipLinked && !locks.vipRangeNm) setAutoValue("vipRangeNm", fmt(result.resolved.vipRangeNm, 3), "ipRangeNm");
  $("#offset-heading-out").textContent = fmtHeading(result.resolved.actionHeadingDeg);
  $("#turn-time-out").textContent = `${fmt(result.timing.offsetTurnSec, 1)} sec`;
  $("#driver-out").textContent = `DRIVER · ${driver}`;
  $("#lock-count").textContent = `LOCK ${Object.values(locks).filter(Boolean).length}`;
}

function row(label, value, resultKey = null) {
  const rendered = resultKey ? `<span class="value-result" data-result-key="${resultKey}">${value}</span>` : value;
  return `<tr><td>${label}</td><td>${rendered}</td></tr>`;
}

function renderOffsetResult(result) {
  const g = result.geometry;
  const t = result.timing;
  $("#offset-result-body").innerHTML = [
    row("State", result.state),
    row("Run-In / Attack", `${fmtHeading(g.runInHeadingDeg)} → ${fmtHeading(g.attackHeadingDeg)}`, "runAttackSummary"),
    row("Offset Heading", fmtHeading(g.actionHeadingDeg), "actionHeadingDeg"),
    row("Offset Angle", `${fmt(g.offsetAngleDeg, 2)}°`, "offsetAngleDeg"),
    row("Angle-Off (Heading)", `${fmt(g.angleOffDeg, 2)}°`, "angleOffDeg"),
    row("Action Range", `${fmt(g.actionRangeNm, 3)} NM`, "actionRangeNm"),
    row("Offset Range", `${fmt(result.resolved.offsetRangeNm, 3)} NM`, "offsetRangeNm"),
    row("IP Range", `${fmt(result.resolved.ipRangeNm, 3)} NM`, "ipRangeNm"),
    row("Offset Radius", `${fmt(result.resolved.offsetRadiusNm, 3)} NM`, "offsetRadiusNm"),
    row("Offset TAS", `${fmt(result.resolved.offsetTasKt, 1)} kt`, "offsetTasKt"),
    row("Reference", `${result.referenceMode} · ${fmt(result.reference.displayRangeNm, 3)} NM${result.reference.linked ? " · LINKED" : ""}`, "referenceSummary"),
    row("IP → Action Point", `${fmt(t.ingressDistanceNm, 3)} NM / ${fmt(t.ingressSec, 1)} sec`, "ingressSummary"),
    row("Offset Turn", `${fmt(t.offsetTurnSec, 1)} sec`, "offsetTurnSec"),
    row("Offset Range Time", `${fmt(t.actionLegSec, 1)} sec`, "actionLegSec"),
    row("Roll-in → Release", `${fmt(t.rollToReleaseSec, 1)} sec`, "rollToReleaseSec"),
    row("Legacy ΔTOS", `${t.legacyDeltaTosSec >= 0 ? "+" : ""}${fmt(t.legacyDeltaTosSec, 1)} sec`, "legacyDeltaTosSec"),
  ].join("");
}

function renderProfileResult(result) {
  const p = result.profile.public;
  $("#profile-result-body").innerHTML = [
    row("Effective Release Altitude", `${fmt(p.effectiveReleaseAltitudeMslFt, 0)} ft MSL`, "effectiveReleaseAltitudeMslFt"),
    row("Resolved Initial Altitude", `${fmt(p.resolvedInitialAltitudeMslFt, 0)} ft MSL`, "resolvedInitialAltitudeMslFt"),
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
  if (!parts.length) parts.push(referenceMode === "VIP" ? "VALID · VIP mode: IP = Action Point." : "VALID · VRP mode: Action Point is between IP and Target. VRP stays on the IP–Target segment.");
  message.textContent = parts.join("  ");
  message.className = `status-message ${result.state.toLowerCase()}`;
}

function collectResultSnapshot(result) {
  const g = result.geometry;
  const t = result.timing;
  const p = result.profile.public;
  return {
    runAttackSummary: `${fmtHeading(g.runInHeadingDeg)}|${fmtHeading(g.attackHeadingDeg)}`,
    actionHeadingDeg: g.actionHeadingDeg,
    offsetAngleDeg: g.offsetAngleDeg,
    angleOffDeg: g.angleOffDeg,
    actionRangeNm: g.actionRangeNm,
    offsetRangeNm: result.resolved.offsetRangeNm,
    ipRangeNm: result.resolved.ipRangeNm,
    offsetRadiusNm: result.resolved.offsetRadiusNm,
    offsetTasKt: result.resolved.offsetTasKt,
    referenceSummary: `${result.referenceMode}|${result.reference.displayRangeNm}|${result.reference.linked}`,
    ingressSummary: `${t.ingressDistanceNm}|${t.ingressSec}`,
    offsetTurnSec: t.offsetTurnSec,
    actionLegSec: t.actionLegSec,
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
  renderOffsetTopView($("#offset-top-view"), result, { fontScale: topViewFontScale });
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
    applyResultChangeStates(result);
  } catch (error) {
    const message = $("#constraint-message");
    message.textContent = `INVALID · ${error.message}`;
    message.className = "status-message invalid";
    const pill = $("#state-pill");
    pill.textContent = "INVALID";
    pill.className = "status bad";
    if (lastResult) renderTopView(lastResult);
  }
}

function syncDuplicates(source) {
  const key = source.dataset.key;
  if (!key) return;
  valueStates.syncInputMirrors(key, source);
}

function handleFieldChange(event) {
  const field = event.target.closest("[data-key]");
  if (!field) return;
  syncDuplicates(field);
  const key = field.dataset.key;
  if (["offsetG", "offsetBankDeg", "offsetRadiusNm"].includes(key)) turnDriver = key;
  if (key === "vrpRangeNm") vrpLinked = false;
  if (key === "vipRangeNm") vipLinked = false;

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

  driver = ["runInHeadingDeg", "attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "offsetRangeNm", "ipRangeNm", "diveAngleDeg"].includes(key) ? key : "profile";
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
      if (locks[key] && key === "vrpRangeNm") vrpLinked = false;
      if (locks[key] && key === "vipRangeNm") vipLinked = false;
      calculate();
    });
  });
}

function installModeButtons() {
  $("#vrp-btn").addEventListener("click", () => {
    referenceMode = "VRP"; vrpLinked = true;
    $("#vrp-btn").classList.add("active"); $("#vip-btn").classList.remove("active"); $("#vrp-pane").classList.remove("hidden"); $("#vip-pane").classList.add("hidden");
    driver = "angleOffDeg"; calculate();
  });
  $("#vip-btn").addEventListener("click", () => {
    referenceMode = "VIP"; vipLinked = true; setAutoValue("vipRangeNm", numberValue("ipRangeNm"), "ipRangeNm");
    $("#vip-btn").classList.add("active"); $("#vrp-btn").classList.remove("active"); $("#vip-pane").classList.remove("hidden"); $("#vrp-pane").classList.add("hidden");
    driver = "ipRangeNm"; calculate();
  });
}

function installValueStateBindings() {
  const heading = $("#offset-heading-out");
  heading.classList.add("value-result");
  heading.dataset.resultKey = "actionHeadingDeg";
  const turnTime = $("#turn-time-out");
  turnTime.classList.add("value-result");
  turnTime.dataset.resultKey = "offsetTurnSec";
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const field = event.target.closest?.("[data-key]");
    if (!field?.dataset?.key) return;
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

function install() {
  populateWeapons(); installLocks(); installModeButtons(); installValueStateBindings();
  document.addEventListener("input", handleFieldChange);
  document.addEventListener("change", (event) => { if (event.target.matches("[data-key]")) handleFieldChange(event); });
  const svg = $("#offset-top-view");
  installOffsetTopViewControls(svg, { zoomInButton: $("#zoom-in"), zoomOutButton: $("#zoom-out"), fitButton: $("#zoom-fit"), resetButton: $("#zoom-reset") });
  const fontScaleSelect = $("#top-view-font-scale");
  if (fontScaleSelect) {
    fontScaleSelect.value = String(topViewFontScale);
    fontScaleSelect.addEventListener("change", () => {
      const next = Number.parseFloat(fontScaleSelect.value);
      topViewFontScale = Number.isFinite(next) ? next : TOP_VIEW_FONT_SCALE_DEFAULT;
      if (lastResult) renderTopView(lastResult);
    });
  }
  $("#capture-top-view").addEventListener("click", () => exportOffsetTopView(svg));
  setValue("rollInBankAngleDeg", automaticRollInBankDeg(), { includeActive: true });
  calculate();
  initialRender = false;
}

install();