import { calculateOffsetV0_2 } from "./AG/bombing/offset-bombing/offset-be-v0.2.mjs";
import { exportOffsetTopView, installOffsetTopViewControls, renderOffsetTopView } from "./renderer-v0.1.mjs";

const locks = {};
let driver = "angleOffDeg";
let turnDriver = "offsetG";
let referenceMode = "VRP";
let vrpLinked = true;
let vipLinked = true;
let rollBankLinked = true;
let releaseFpaLinked = true;
let lastResult = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fields = (key) => $$(`[data-key="${key}"]`);
const firstField = (key) => fields(key)[0];
const numberValue = (key) => {
  const value = Number.parseFloat(firstField(key)?.value ?? "");
  if (!Number.isFinite(value)) throw new TypeError(`${key} must be numeric`);
  return value;
};
const value = (key) => firstField(key)?.value;
const setValue = (key, next) => fields(key).forEach((field) => { field.value = String(next); });
const fmt = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : "-";
const fmtHeading = (value) => {
  if (!Number.isFinite(value)) return "-";
  const h = ((Math.round(value) % 360) + 360) % 360;
  return String(h === 0 ? 360 : h).padStart(3, "0") + "°";
};

function buildInput() {
  return {
    driver, turnDriver, locks: { ...locks }, referenceMode, vrpLinked, vipLinked,
    runInHeadingDeg: numberValue("runInHeadingDeg"), attackHeadingDeg: numberValue("attackHeadingDeg"), angleOffDeg: numberValue("angleOffDeg"),
    diveAngleDeg: numberValue("diveAngleDeg"), offsetAngleDeg: numberValue("offsetAngleDeg"), actionRangeNm: numberValue("actionRangeNm"), ipRangeNm: numberValue("ipRangeNm"),
    vrpRangeNm: numberValue("vrpRangeNm"), vipRangeNm: numberValue("vipRangeNm"),
    offsetAltitudeMslFt: numberValue("offsetAltitudeMslFt"), offsetSpeedValue: numberValue("offsetSpeedValue"), offsetSpeedMode: value("offsetSpeedMode") ?? "CAS",
    offsetG: numberValue("offsetG"), offsetBankDeg: numberValue("offsetBankDeg"), offsetRadiusNm: numberValue("offsetRadiusNm"),
    profile: {
      weaponId: value("weaponId") ?? "M82", targetElevationMslFt: numberValue("targetElevationMslFt"), releaseSpeedKcas: numberValue("releaseSpeedKcas"),
      speedOvershootKcas: numberValue("speedOvershootKcas"), maneuverInitiationDelaySec: numberValue("maneuverInitiationDelaySec"), recoveryG: numberValue("recoveryG"),
      gOnsetTimeSec: numberValue("gOnsetTimeSec"), diveAngleDeg: numberValue("diveAngleDeg"), releaseFpaDeg: numberValue("releaseFpaDeg"),
      windDirectionDeg: numberValue("windDirectionDeg"), windSpeedKt: numberValue("windSpeedKt"), initialSpeedValue: numberValue("initialSpeedValue"),
      initialSpeedMode: value("initialSpeedMode") ?? "CAS", initialAltitudeMslFt: numberValue("initialAltitudeMslFt"), solveMode: value("solveMode") ?? "height",
      trackingTimeSec: numberValue("trackingTimeSec"), releaseAltitudeMslFt: numberValue("releaseAltitudeMslFt"), angleOffDeg: numberValue("angleOffDeg"),
      rollInBankAngleDeg: numberValue("rollInBankAngleDeg"), rollInG: numberValue("rollInG"),
    },
  };
}

function setIfUnlocked(key, value, digits = null) {
  if (locks[key]) return;
  setValue(key, digits === null ? value : Number(value).toFixed(digits));
}

function applyResolved(result) {
  setIfUnlocked("angleOffDeg", result.resolved.angleOffDeg, 2);
  setIfUnlocked("offsetAngleDeg", result.resolved.offsetAngleDeg, 2);
  setIfUnlocked("actionRangeNm", result.resolved.actionRangeNm, 3);
  setIfUnlocked("ipRangeNm", result.resolved.ipRangeNm, 3);
  setIfUnlocked("offsetG", result.resolved.offsetG, 3);
  setIfUnlocked("offsetBankDeg", result.resolved.offsetBankDeg, 2);
  setIfUnlocked("offsetRadiusNm", result.resolved.offsetRadiusNm, 3);
  if (result.referenceMode === "VRP" && vrpLinked && !locks.vrpRangeNm) setValue("vrpRangeNm", fmt(result.resolved.vrpRangeNm, 3));
  if (result.referenceMode === "VIP" && vipLinked && !locks.vipRangeNm) setValue("vipRangeNm", fmt(result.resolved.vipRangeNm, 3));
  $("#offset-heading-out").textContent = fmtHeading(result.resolved.actionHeadingDeg);
  $("#turn-time-out").textContent = `${fmt(result.timing.offsetTurnSec, 1)} sec`;
  $("#driver-out").textContent = `DRIVER · ${driver}`;
  $("#lock-count").textContent = `LOCK ${Object.values(locks).filter(Boolean).length}`;
}

function row(label, value) { return `<tr><td>${label}</td><td>${value}</td></tr>`; }
function renderOffsetResult(result) {
  const g = result.geometry;
  const t = result.timing;
  $("#offset-result-body").innerHTML = [
    row("State", result.state), row("Run-In / Attack", `${fmtHeading(g.runInHeadingDeg)} → ${fmtHeading(g.attackHeadingDeg)}`),
    row("Offset Heading", fmtHeading(g.actionHeadingDeg)), row("Offset Angle", `${fmt(g.offsetAngleDeg, 2)}°`), row("Angle-Off (Heading)", `${fmt(g.angleOffDeg, 2)}°`),
    row("Action Range", `${fmt(g.actionRangeNm, 3)} NM`), row("IP Range", `${fmt(result.resolved.ipRangeNm, 3)} NM`), row("Offset Radius", `${fmt(result.resolved.offsetRadiusNm, 3)} NM`),
    row("Offset TAS", `${fmt(result.resolved.offsetTasKt, 1)} kt`), row("Turn End → Roll In", `${fmt(g.actionLegDistanceNm, 3)} NM`),
    row("Reference", `${result.referenceMode} · ${fmt(result.reference.displayRangeNm, 3)} NM${result.reference.linked ? " · LINKED" : ""}`),
    row("IP → Action Point", `${fmt(t.ingressDistanceNm, 3)} NM / ${fmt(t.ingressSec, 1)} sec`), row("Offset Turn", `${fmt(t.offsetTurnSec, 1)} sec`),
    row("Action Leg", `${fmt(t.actionLegSec, 1)} sec`), row("Roll-in → Release", `${fmt(t.rollToReleaseSec, 1)} sec`),
    row("Legacy ΔTOS", `${t.legacyDeltaTosSec >= 0 ? "+" : ""}${fmt(t.legacyDeltaTosSec, 1)} sec`),
  ].join("");
}

function renderProfileResult(result) {
  const p = result.profile.public;
  $("#profile-result-body").innerHTML = [
    row("Effective Release Altitude", `${fmt(p.effectiveReleaseAltitudeMslFt, 0)} ft MSL`), row("Resolved Initial Altitude", `${fmt(p.resolvedInitialAltitudeMslFt, 0)} ft MSL`),
    row("Track Point Altitude", `${fmt(p.trackPointAltitudeMslFt, 0)} ft MSL`), row("Tracking Time", `${fmt(p.trackingTimeSec, 2)} sec`),
    row("Roll-in Range", `${fmt(p.rollInRangeNm, 3)} NM`), row("Ground Range", `${fmt(p.groundRangeNm, 3)} NM`), row("Roll-in Radius", `${fmt(p.rollInRadiusNm, 3)} NM`),
    row("Roll-in Time", `${fmt(p.rollInTimeSec, 2)} sec`), row("Roll-in Ground Arc", `${fmt(p.rollInGroundArcNm, 3)} NM`), row("Roll-in Altitude Loss", `${fmt(p.rollInAltitudeLossFt, 0)} ft`),
    row("Lead Angle", `${fmt(p.leadAngleDeg, 2)}°`), row("MINALT", `${fmt(p.minAltMslFt, 0)} ft MSL`), row("NLT Release", `${fmt(p.nltReleaseMslFt, 0)} ft MSL`),
    row("Bomb Range / TOF", `${fmt(p.bombRangeNm, 3)} NM / ${fmt(p.bombTofSec, 2)} sec`),
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
  if (!parts.length) parts.push(referenceMode === "VIP" ? "VALID · VIP mode: IP = Action Point." : "VALID · VRP mode: Action Point is between IP and Target. VRP cannot project beyond Target.");
  message.textContent = parts.join("  ");
  message.className = `status-message ${result.state.toLowerCase()}`;
}

function calculate() {
  try {
    const result = calculateOffsetV0_2(buildInput());
    lastResult = result;
    applyResolved(result);
    renderStatus(result);
    renderOffsetResult(result);
    renderProfileResult(result);
    renderOffsetTopView($("#offset-top-view"), result);
  } catch (error) {
    const message = $("#constraint-message");
    message.textContent = `INVALID · ${error.message}`;
    message.className = "status-message invalid";
    const pill = $("#state-pill");
    pill.textContent = "INVALID";
    pill.className = "status bad";
    if (lastResult) renderOffsetTopView($("#offset-top-view"), lastResult);
  }
}

function syncDuplicates(source) {
  const key = source.dataset.key;
  if (!key) return;
  fields(key).forEach((field) => { if (field !== source) field.value = source.value; });
}

function handleFieldChange(event) {
  const field = event.target.closest("[data-key]");
  if (!field) return;
  syncDuplicates(field);
  const key = field.dataset.key;
  if (["offsetG", "offsetBankDeg", "offsetRadiusNm"].includes(key)) turnDriver = key;
  if (key === "vrpRangeNm") vrpLinked = false;
  if (key === "vipRangeNm") vipLinked = false;
  if (key === "rollInBankAngleDeg") { rollBankLinked = false; $("#link-roll-bank").checked = false; }
  if (key === "releaseFpaDeg") { releaseFpaLinked = false; $("#link-release-fpa").checked = false; }
  if (key === "diveAngleDeg") {
    if (rollBankLinked) setValue("rollInBankAngleDeg", Math.round(90 + numberValue("diveAngleDeg") / 2));
    if (releaseFpaLinked) setValue("releaseFpaDeg", -numberValue("diveAngleDeg"));
  }
  driver = ["angleOffDeg", "offsetAngleDeg", "actionRangeNm", "ipRangeNm", "diveAngleDeg"].includes(key) ? key : "profile";
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
    referenceMode = "VIP"; vipLinked = true; setValue("vipRangeNm", numberValue("ipRangeNm"));
    $("#vip-btn").classList.add("active"); $("#vrp-btn").classList.remove("active"); $("#vip-pane").classList.remove("hidden"); $("#vrp-pane").classList.add("hidden");
    driver = "ipRangeNm"; calculate();
  });
}

function installProfileLinks() {
  $("#link-roll-bank").addEventListener("change", (event) => {
    rollBankLinked = event.target.checked;
    if (rollBankLinked) setValue("rollInBankAngleDeg", Math.round(90 + numberValue("diveAngleDeg") / 2));
    driver = "profile"; calculate();
  });
  $("#link-release-fpa").addEventListener("change", (event) => {
    releaseFpaLinked = event.target.checked;
    if (releaseFpaLinked) setValue("releaseFpaDeg", -numberValue("diveAngleDeg"));
    driver = "profile"; calculate();
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
  populateWeapons(); installLocks(); installModeButtons(); installProfileLinks();
  document.addEventListener("input", handleFieldChange);
  document.addEventListener("change", (event) => { if (event.target.matches("[data-key]")) handleFieldChange(event); });
  const svg = $("#offset-top-view");
  installOffsetTopViewControls(svg, { zoomInButton: $("#zoom-in"), zoomOutButton: $("#zoom-out"), fitButton: $("#zoom-fit"), resetButton: $("#zoom-reset") });
  $("#capture-top-view").addEventListener("click", () => exportOffsetTopView(svg));
  setValue("rollInBankAngleDeg", Math.round(90 + numberValue("diveAngleDeg") / 2));
  setValue("releaseFpaDeg", -numberValue("diveAngleDeg"));
  calculate();
}

install();
