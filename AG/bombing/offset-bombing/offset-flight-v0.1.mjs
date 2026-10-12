import { OFFSET_BE_V0_2, calculateOffsetWithVrpStartFull } from "./offset-be-v0.2.mjs";
import { OFFSET_FORMATION_GEOMETRY_V0_1, calculateOffAxisOffsetFull } from "./offset-formation-geometry-v0.1.mjs";
import {
  OFFSET_FORMATION_V0_1,
  applyElementLeadOffsetAngle,
  computeDropOrderDeltaFull,
  computeFormationOffsetVectorFull,
  solveElementSameTimeActionRange,
} from "./offset-formation-v0.1.mjs";
import { add, candidateFailureCause } from "./offset-geometry-v0.2.mjs";
import { autoRollInBankDegFull, calculateBombDeliveryV0_3Full, isLevelTurnRollIn, levelTurnRollInGFull } from "../bomb-delivery-planner/bomb-delivery-planner-v0.3.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// Offset Flight entrypoint (AG SPEC "Flight entrypoint", 2026-10-12): one call takes the whole Flight
// input state (#1 and its followers, their LOCKs / options / formation positions / entry history and
// an optional one-shot edit) and returns every aircraft's Full result, the constraint diagnostics,
// the drop-order timing and the next input state. Pure: no DOM, window, storage or FE import; the
// input is never mutated; the same input gives the same output.
export const OFFSET_FLIGHT_V0_1 = Object.freeze({
  id: "offset-flight-v0.1",
  version: "0.1.1",
  status: "work",
  schemaVersion: 1,
  components: Object.freeze({
    offsetBe: OFFSET_BE_V0_2.version,
    offsetFormationGeometry: OFFSET_FORMATION_GEOMETRY_V0_1.version,
    offsetFormation: OFFSET_FORMATION_V0_1.version,
  }),
});

const FT_PER_NM = 6076.11549;
// Linked IP sits this far beyond VRP on the Run-In axis (IP = VRP + 3 NM, Offset app policy).
export const OFFSET_FLIGHT_IP_LINK_LEAD_NM = 3;
// Entry history default when a state carries none (the app's built-in Tracking Time).
export const OFFSET_FLIGHT_DEFAULT_TRACKING_TIME_SEC = 18;
const DEFAULT_VIP_RANGE_NM = 10;
const DEFAULT_VRP_RANGE_NM = 7;

// Element lead (Formation reference, Angle #n / Time #n, inherited BDP values) vs drop-order
// predecessor (n - 1): #2 and #3 fly off #1, #4 off #3; #3 releases after #2.
export const OFFSET_FLIGHT_ELEMENT_LEAD = Object.freeze({ 2: 1, 3: 1, 4: 3 });
const WINGMEN = new Set([2, 4]);
const FOLLOWERS = [2, 3, 4];

// Both-fixed pair solve (Offset Angle and Action condition fixed): search bounds and tolerances.
export const OFFSET_FLIGHT_PAIR_SOLVE = Object.freeze({
  timeToleranceSec: 0.05,
  actionToleranceNm: 0.005,
  altitudeAboveReleaseFt: 100,
  maxAltitudeMslFt: 45000,
  altitudeSteps: 24,
  refineIterations: 40,
  minTrackingTimeSec: 1,
  maxTrackingTimeSec: 60,
});

const LEAD_DRIVERS = new Set(["vrpRangeNm", "actionRangeNm", "runInHeadingDeg", "approachRangeNm", "attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "ipRangeNm", "vrpBearingDeg", "referenceLock"]);
const TURN_DRIVERS = new Set(["offsetG", "offsetBankDeg", "offsetRadiusNm"]);
const LEAD_TACTICAL_DRIVERS = new Set(["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm"]);
const FOLLOWER_DRIVERS = new Set(["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm"]);
const LEAD_FALLBACK_DRIVERS = Object.freeze({ vrpRangeNm: "actionRangeNm", actionRangeNm: "vrpRangeNm" });
const LEAD_TURN_FALLBACK = Object.freeze({ offsetG: "offsetBankDeg", offsetBankDeg: "offsetG", offsetRadiusNm: "offsetG" });
const FOLLOWER_FALLBACK_DRIVERS = Object.freeze({ actionRangeNm: "offsetAngleDeg" });
// Follower BDP values that follow the element lead's effective value while null (Roll-in Bank: AUTO
// from this aircraft's own Dive and applied Roll-in G while null).
export const OFFSET_FLIGHT_INHERITED_KEYS = Object.freeze(["fragmentHeightMarginPercent", "recoveryG", "speedOvershootKcas", "gOnsetTimeSec", "rollInG"]);
const FOLLOWER_OPTIONS = ["offsetAngleLocked", "sameAngleAsLead", "actionRangeLocked", "sameTimeAsLead", "rollInAltitudeLocked"];
const OPTION_EXCLUSIONS = Object.freeze({
  offsetAngleLocked: ["sameAngleAsLead"],
  sameAngleAsLead: ["offsetAngleLocked"],
  actionRangeLocked: ["sameTimeAsLead"],
  sameTimeAsLead: ["actionRangeLocked"],
  rollInAltitudeLocked: [],
});

// Roll-in Altitude LOCK (owner 2026-10-12): with it on, a Tracking Time entry keeps Roll-in Altitude
// and moves Release Altitude ("release" solve mode). The Release Altitude is found on the BDP core
// (the Offset geometry's own canonical profile input) and confirmed by a full Offset solve.
export const OFFSET_FLIGHT_RELEASE_SOLVE = Object.freeze({
  toleranceFt: 0.01,
  acceptFt: 0.5,
  profileIterations: 40,
  geometryPasses: 4,
});
const FORMATION_KEYS = new Set(["side", "bearingDeg", "distanceNm"]);

const norm = (deg) => ((deg % 360) + 360) % 360;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const blank = (value) => value === null || value === undefined;
const sameValue = (a, b) => (isNumber(a) && isNumber(b) ? Math.abs(a - b) <= 1e-9 : Object.is(a, b));

function requireNumber(key, value) {
  if (!isNumber(value)) throw new TypeError(`${key} must be numeric`);
  return value;
}

function bearingBetween(a, b) {
  return norm((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI);
}

function distanceNm(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function signedIngressSec(result) {
  return result?.timing?.signedIngressSec ?? result?.timing?.ingressSec;
}

// ---- Input state normalization ------------------------------------------------------------------

function normalizeEnteredTrackingTime(value) {
  if (blank(value)) return OFFSET_FLIGHT_DEFAULT_TRACKING_TIME_SEC;
  if (!isNumber(value)) throw new TypeError("enteredTrackingTimeSec must be numeric");
  // Direct Tracking Time entry is whole seconds (BDP enteredTrackingTimeSec = round).
  return Math.round(value);
}

// "release" (Tracking Time entered, Roll-in Altitude held, Release Altitude solved) exists only while
// Roll-in Altitude is locked; without the LOCK it reads as "time" (same entered Tracking Time).
function normalizeSolveMode(mode, rollInLocked) {
  if (mode === "release") return rollInLocked ? "release" : "time";
  return mode === "time" ? "time" : "height";
}

function enumOr(name, value, allowed, fallback) {
  if (blank(value)) return fallback;
  if (!allowed.has(value)) throw new TypeError(`${name} "${value}" is not supported`);
  return value;
}

function normalizeLead(record = {}) {
  const state = record.state ?? {};
  const values = { ...(record.values ?? {}) };
  const locks = Object.fromEntries(Object.entries(record.locks ?? {}).map(([key, on]) => [key, on === true]));
  // An IP LOCK holds IP on its own bearing: it is never linked, and a missing lock bearing is the
  // current Run-In.
  const ipLockHeadingDeg = isNumber(state.ipLockHeadingDeg) ? state.ipLockHeadingDeg
    : locks.ipReference && isNumber(values.runInHeadingDeg) ? norm(values.runInHeadingDeg) : null;
  return {
    values,
    locks,
    state: {
      driver: enumOr("driver", state.driver, LEAD_DRIVERS, "vrpRangeNm"),
      turnDriver: enumOr("turnDriver", state.turnDriver, TURN_DRIVERS, "offsetG"),
      referenceMode: state.referenceMode === "VIP" ? "VIP" : "VRP",
      ipLinkedToVrp: state.ipLinkedToVrp !== false && !locks.ipReference,
      ipLockHeadingDeg,
      rollBankAuto: state.rollBankAuto !== false,
      rollInAltitudeLinked: state.rollInAltitudeLinked !== false,
      solveMode: normalizeSolveMode(state.solveMode, locks.rollInAltitudeMslFt === true),
      enteredTrackingTimeSec: normalizeEnteredTrackingTime(state.enteredTrackingTimeSec),
      vipBearingExplicit: state.vipBearingExplicit === true,
      vipRangeExplicit: state.vipRangeExplicit === true,
      vrpBearingExplicit: state.vrpBearingExplicit === true,
      vrpRangeExplicit: state.vrpRangeExplicit === true,
    },
  };
}

function normalizeFollower(record = {}) {
  const state = record.state ?? {};
  const formation = record.formation ?? {};
  const options = record.options ?? {};
  const optionValues = Object.fromEntries(FOLLOWER_OPTIONS.map((key) => [key, options[key] === true]));
  return {
    values: { ...(record.values ?? {}) },
    formation: { side: formation.side === "RIGHT" ? "RIGHT" : "LEFT", bearingDeg: formation.bearingDeg ?? null, distanceNm: formation.distanceNm ?? null },
    options: optionValues,
    state: {
      driver: enumOr("driver", state.driver, FOLLOWER_DRIVERS, "actionRangeNm"),
      solveMode: normalizeSolveMode(state.solveMode, optionValues.rollInAltitudeLocked),
      enteredTrackingTimeSec: normalizeEnteredTrackingTime(state.enteredTrackingTimeSec),
      rollInAltitudeLinked: state.rollInAltitudeLinked !== false,
    },
  };
}

function normalizeFlightInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  if (input.schemaVersion !== undefined && input.schemaVersion !== OFFSET_FLIGHT_V0_1.schemaVersion) {
    throw new TypeError(`schemaVersion ${input.schemaVersion} is not supported`);
  }
  const flightSize = input.flightSize ?? 1;
  if (!Number.isInteger(flightSize) || flightSize < 1 || flightSize > 4) throw new RangeError("flightSize must be an integer from 1 to 4");
  const source = structuredClone(input.aircraft ?? {});
  if (!source[1] || typeof source[1] !== "object") throw new TypeError("aircraft[1] is required");
  const aircraft = {};
  const stateErrors = {};
  // A record whose state cannot be read fails that aircraft and goes back unchanged in nextInput
  // (never silently replaced by defaults).
  const normalize = (number, fn) => {
    try { aircraft[number] = fn(source[number]); }
    catch (error) { stateErrors[number] = error.message; aircraft[number] = { raw: source[number] }; }
  };
  normalize(1, normalizeLead);
  for (const number of FOLLOWERS) if (source[number]) normalize(number, normalizeFollower);
  return { flightSize, aircraft, stateErrors };
}

// ---- One-shot edit events -----------------------------------------------------------------------
// The FE passes the raw UI event; its consequences (driver, BDP solve mode, Initial <-> Roll-in LINK,
// whole-second Tracking Time, IP link, AUTO Bank, option exclusivity, empty-field refill) are decided
// here and live on only through nextInput, so an edit is never applied twice.

// Roll-in Altitude LOCK on: a Tracking Time entry in force (time mode) now moves Release Altitude.
// LOCK off: the entered Tracking Time keeps driving, Roll-in Altitude solved again (time mode).
function lockedSolveMode(mode, on) {
  if (on) return mode === "time" ? "release" : mode;
  return mode === "release" ? "time" : mode;
}

// A typed Roll-in (or linked Initial) Altitude: height mode, except while Tracking Time and the
// Roll-in LOCK move Release Altitude, which keeps doing so from the new Roll-in Altitude.
function rollInEditMode(mode) {
  return mode === "release" ? "release" : "height";
}

function applyLeadEdit(lead, edit) {
  const { values: v, state: s, locks } = lead;
  const key = edit.key;
  if (edit.kind === "lock") {
    locks[key] = edit.value === true;
    if (key === "rollInAltitudeMslFt") s.solveMode = lockedSolveMode(s.solveMode, locks[key]);
    // Only an IP LOCK freezes IP (it unlinks it on the current Run-In); a VRP LOCK holds VRP.
    if (key === "ipReference" && locks[key]) {
      s.ipLinkedToVrp = false;
      if (isNumber(v.runInHeadingDeg)) s.ipLockHeadingDeg = norm(v.runInHeadingDeg);
    }
    if (key === "ipReference" || key === "vrpReference") s.driver = "referenceLock";
    return;
  }
  if (edit.kind === "toggle") {
    if (key !== "rollInAltitudeLinked") throw new TypeError(`toggle "${key}" is not supported on #1`);
    s.rollInAltitudeLinked = edit.value === true;
    // Turning LINK on shows Roll-in Altitude (the solve's value) as Initial Altitude.
    if (s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) v.initialAltitudeMslFt = v.rollInAltitudeMslFt;
    return;
  }
  if (edit.kind === "clear") {
    const before = edit.before ?? {};
    if (LEAD_DRIVERS.has(before.driver)) s.driver = before.driver;
    if (TURN_DRIVERS.has(before.turnDriver)) s.turnDriver = before.turnDriver;
    if (s.driver === key) s.driver = LEAD_FALLBACK_DRIVERS[key] ?? "vrpRangeNm";
    if (s.turnDriver === key) s.turnDriver = LEAD_TURN_FALLBACK[key] ?? "offsetG";
    let value = !blank(before.value) ? before.value : edit.fallbackValue ?? null;
    if (key === "rollInBankAngleDeg") s.rollBankAuto = true;
    else if (key === "rollInAltitudeMslFt" && s.solveMode !== "time" && s.rollInAltitudeLinked && isNumber(v.initialAltitudeMslFt)) value = Math.round(v.initialAltitudeMslFt);
    else if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) value = Math.round(v.rollInAltitudeMslFt);
    else if (key === "trackingTimeSec") s.solveMode = "height";
    v[key] = value;
    return;
  }
  if (edit.kind !== "set") throw new TypeError(`edit kind "${edit.kind}" is not supported`);
  const value = key === "ipBearingDeg" ? edit.value : v[key];

  if (key === "vipToTargetBearingDeg") { s.vipBearingExplicit = isNumber(value); return; }
  if (key === "vipRangeNm") { s.vipRangeExplicit = isNumber(value); return; }
  if (key === "vrpBearingDeg") { s.vrpBearingExplicit = isNumber(value); s.driver = "vrpBearingDeg"; return; }
  if (key === "ipBearingDeg") {
    // The IP bearing is the Run-In axis in TO/FROM notation (canonical TO value here); it keeps the
    // IP <- VRP link like a Run-In edit and moves a locked IP's bearing with it.
    if (!isNumber(value)) return;
    if (locks.ipReference) s.ipLockHeadingDeg = norm(value);
    v.runInHeadingDeg = norm(value);
    s.driver = "runInHeadingDeg";
    return;
  }
  const rollInLocked = locks.rollInAltitudeMslFt === true;
  if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked) {
    if (isNumber(value)) v.rollInAltitudeMslFt = Math.round(value);
    s.solveMode = rollInEditMode(s.solveMode);
  }
  if (key === "rollInAltitudeMslFt") {
    s.solveMode = rollInEditMode(s.solveMode);
    if (s.rollInAltitudeLinked && isNumber(value)) v.initialAltitudeMslFt = Math.round(value);
  }
  if (key === "releaseAltitudeMslFt" && s.solveMode === "release") s.solveMode = "height";
  if (key === "trackingTimeSec") {
    s.solveMode = rollInLocked ? "release" : "time";
    if (isNumber(value)) {
      s.enteredTrackingTimeSec = Math.round(value);
      v.trackingTimeSec = s.enteredTrackingTimeSec;
    }
  }
  if (key === "vrpRangeNm") {
    s.vrpRangeExplicit = isNumber(value);
    s.driver = "vrpRangeNm";
    return;
  }
  if (key === "ipRangeNm") {
    // A commit of the value the link already shows (the previous state's linked IP) is not a new IP
    // edit (no unlink).
    if (edit.commit && s.ipLinkedToVrp && !locks.ipReference && sameValue(value, edit.previousValue)) return;
    s.ipLinkedToVrp = false;
    s.driver = "ipRangeNm";
    return;
  }
  if (TURN_DRIVERS.has(key)) s.turnDriver = key;
  const diveAngleDeg = v.diveAngleDeg;
  if (key === "rollInBankAngleDeg") s.rollBankAuto = false;
  if (key === "diveAngleDeg") s.rollBankAuto = true;
  if (key === "rollInG" && isNumber(diveAngleDeg) && isLevelTurnRollIn(diveAngleDeg)) s.rollBankAuto = true;
  if (key === "runInHeadingDeg") {
    if (isNumber(value)) v.runInHeadingDeg = norm(value);
    s.driver = "runInHeadingDeg";
  } else if (key === "approachRangeNm" || LEAD_TACTICAL_DRIVERS.has(key)) {
    s.driver = key;
  }
  // BDP / Offset Turn Condition edits are not tactical drivers: the last tactical constraint holds.
}

function applyFollowerEdit(follower, edit, number) {
  const { values: v, state: s, options, formation } = follower;
  const key = edit.key;
  if (edit.kind === "toggle") {
    const on = edit.value === true;
    if (key === "rollInAltitudeLinked") {
      s.rollInAltitudeLinked = on;
      if (on && isNumber(v.rollInAltitudeMslFt)) v.initialAltitudeMslFt = v.rollInAltitudeMslFt;
      return;
    }
    if (!FOLLOWER_OPTIONS.includes(key)) throw new TypeError(`toggle "${key}" is not supported on #${number}`);
    options[key] = on;
    if (on) OPTION_EXCLUSIONS[key].forEach((excluded) => { options[excluded] = false; });
    if (key === "rollInAltitudeLocked") s.solveMode = lockedSolveMode(s.solveMode, on);
    return;
  }
  const target = FORMATION_KEYS.has(key) ? formation : v;
  if (edit.kind === "clear") {
    const before = edit.before ?? {};
    if (FOLLOWER_DRIVERS.has(before.driver)) s.driver = before.driver;
    if (s.driver === key) s.driver = FOLLOWER_FALLBACK_DRIVERS[key] ?? "actionRangeNm";
    let value = !blank(before.value) ? before.value : edit.fallbackValue ?? null;
    if (key === "rollInAltitudeMslFt" && s.solveMode !== "time" && s.rollInAltitudeLinked && isNumber(v.initialAltitudeMslFt)) value = v.initialAltitudeMslFt;
    else if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) value = v.rollInAltitudeMslFt;
    else if (key === "trackingTimeSec") s.solveMode = "height";
    target[key] = value;
    return;
  }
  if (edit.kind !== "set") throw new TypeError(`edit kind "${edit.kind}" is not supported`);
  const value = target[key];
  if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked) {
    v.rollInAltitudeMslFt = value;
    s.solveMode = rollInEditMode(s.solveMode);
  } else if (key === "rollInAltitudeMslFt") {
    s.solveMode = rollInEditMode(s.solveMode);
    if (s.rollInAltitudeLinked) v.initialAltitudeMslFt = value;
  } else if (key === "releaseAltitudeMslFt") {
    if (s.solveMode === "release") s.solveMode = "height";
  } else if (key === "trackingTimeSec") {
    s.solveMode = options.rollInAltitudeLocked ? "release" : "time";
    if (isNumber(value)) {
      s.enteredTrackingTimeSec = Math.round(value);
      v.trackingTimeSec = s.enteredTrackingTimeSec;
    }
  }
  if (FOLLOWER_DRIVERS.has(key)) s.driver = key;
}

// ---- #1 ------------------------------------------------------------------------------------------

// Reference fallbacks (implicit VIP = Run-In / 10 NM, implicit VRP = reciprocal / 7 NM) and the
// Roll-in Bank couplings (AUTO from Dive and G; a manual bank in a level-turn Roll-in sets G).
function prepareLead(lead, derived) {
  const { values: v, state: s } = lead;
  if (isNumber(v.runInHeadingDeg)) {
    const runIn = norm(v.runInHeadingDeg);
    if (!s.vipBearingExplicit || !isNumber(v.vipToTargetBearingDeg)) v.vipToTargetBearingDeg = runIn;
    if (!s.vipRangeExplicit || !isNumber(v.vipRangeNm)) v.vipRangeNm = DEFAULT_VIP_RANGE_NM;
    if (!s.vrpBearingExplicit || !isNumber(v.vrpBearingDeg)) v.vrpBearingDeg = norm(runIn + 180);
  }
  if (!s.vrpRangeExplicit || !isNumber(v.vrpRangeNm)) v.vrpRangeNm = DEFAULT_VRP_RANGE_NM;
  if (s.rollBankAuto) {
    v.rollInBankAngleDeg = autoRollInBankDegFull({ diveAngleDeg: requireNumber("diveAngleDeg", v.diveAngleDeg), rollInG: v.rollInG });
    derived.add("rollInBankAngleDeg");
  } else if (isNumber(v.diveAngleDeg) && isLevelTurnRollIn(v.diveAngleDeg)) {
    v.rollInG = levelTurnRollInGFull(requireNumber("rollInBankAngleDeg", v.rollInBankAngleDeg));
    derived.add("rollInG");
  }
}

function leadOffsetInput(lead) {
  const { values: v, state: s, locks } = lead;
  const n = (key) => requireNumber(key, v[key]);
  const runInHeadingDeg = norm(n("runInHeadingDeg"));
  const solveMode = s.solveMode;
  return {
    driver: s.driver,
    turnDriver: s.turnDriver,
    locks: { ...locks },
    ipLinkedToVrp: s.ipLinkedToVrp,
    ipLinkLeadNm: OFFSET_FLIGHT_IP_LINK_LEAD_NM,
    ipLockHeadingDeg: s.ipLockHeadingDeg ?? runInHeadingDeg,
    referenceMode: s.referenceMode,
    runInHeadingDeg,
    attackHeadingDeg: n("attackHeadingDeg"),
    angleOffDeg: n("angleOffDeg"),
    diveAngleDeg: n("diveAngleDeg"),
    offsetAngleDeg: n("offsetAngleDeg"),
    actionRangeNm: n("actionRangeNm"),
    approachRangeNm: n("approachRangeNm"),
    ipRangeNm: n("ipRangeNm"),
    vipToTargetBearingDeg: n("vipToTargetBearingDeg"),
    vipRangeNm: n("vipRangeNm"),
    vrpBearingDeg: n("vrpBearingDeg"),
    vrpRangeNm: n("vrpRangeNm"),
    offsetAltitudeMslFt: n("offsetAltitudeMslFt"),
    offsetSpeedValue: n("offsetSpeedValue"),
    offsetSpeedMode: v.offsetSpeedMode ?? "CAS",
    offsetG: n("offsetG"),
    offsetBankDeg: n("offsetBankDeg"),
    offsetRadiusNm: n("offsetRadiusNm"),
    profile: {
      weaponId: v.weaponId ?? "M82",
      targetElevationMslFt: n("targetElevationMslFt"),
      releaseSpeedKcas: n("releaseSpeedKcas"),
      speedOvershootKcas: n("speedOvershootKcas"),
      fragmentHeightMarginPercent: n("fragmentHeightMarginPercent"),
      recoveryG: n("recoveryG"),
      gOnsetTimeSec: n("gOnsetTimeSec"),
      diveAngleDeg: n("diveAngleDeg"),
      // Wind Direction is the true FROM direction; the BE converts it per candidate Attack Heading.
      windDirectionTrueDeg: n("windDirectionDeg"),
      windSpeedKt: n("windSpeedKt"),
      initialSpeedValue: n("initialSpeedValue"),
      initialSpeedMode: v.initialSpeedMode ?? "CAS",
      // Roll-in Altitude is the BDP entry altitude (OA1); Initial Altitude is linked or reference only.
      initialAltitudeMslFt: n("rollInAltitudeMslFt"),
      // "release" is a time-mode BDP solve at a searched Release Altitude (solveReleaseAltitude).
      solveMode: solveMode === "release" ? "time" : solveMode,
      // A Roll-in Altitude too low gives a negative Tracking Time, not an error.
      allowNegativeTrackingTime: true,
      trackingTimeSec: solveMode === "time" ? n("trackingTimeSec") : s.enteredTrackingTimeSec,
      releaseAltitudeMslFt: n("releaseAltitudeMslFt"),
      angleOffDeg: n("angleOffDeg"),
      rollInBankAngleDeg: n("rollInBankAngleDeg"),
      rollInG: n("rollInG"),
    },
  };
}

// BDP solve-mode coupling: height mode derives Tracking Time; time mode (or a level delivery, which
// BDP always solves from Tracking Time) derives Roll-in Altitude and shows the entered Tracking Time.
function deriveProfileValues(record, result, derived) {
  const { values: v, state: s } = record;
  const p = result.profile.public;
  if (s.solveMode === "release") {
    // Roll-in Altitude held by its LOCK; the entered Tracking Time shows; Release Altitude was solved.
    v.trackingTimeSec = s.enteredTrackingTimeSec;
    derived.add("trackingTimeSec");
    derived.add("releaseAltitudeMslFt");
    return;
  }
  const mode = p.resolvedSolveMode ?? s.solveMode;
  if (mode === "time") {
    if (s.solveMode !== "time") { v.trackingTimeSec = s.enteredTrackingTimeSec; derived.add("trackingTimeSec"); }
    if (isNumber(p.resolvedInitialAltitudeMslFt)) { v.rollInAltitudeMslFt = p.resolvedInitialAltitudeMslFt; derived.add("rollInAltitudeMslFt"); }
  } else if (isNumber(p.trackingTimeSec)) {
    v.trackingTimeSec = p.trackingTimeSec;
    derived.add("trackingTimeSec");
  }
}

function syncLinkedInitial(record, derived) {
  const { values: v, state: s } = record;
  if (s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) { v.initialAltitudeMslFt = v.rollInAltitudeMslFt; derived.add("initialAltitudeMslFt"); }
}

// Next #1 state from its Full result. A LOCK target and the active driver / turn driver target are
// never replaced by the value the solver reached (even within tolerance).
function deriveLeadNext(lead, result, derived) {
  const { values: v, state: s, locks } = lead;
  const r = result.resolved;
  const held = new Set([s.driver, s.turnDriver]);
  const write = (key, value) => {
    if (locks[key] || held.has(key) || !isNumber(value)) return;
    v[key] = value;
    derived.add(key);
  };
  if (!locks.runInHeadingDeg && isNumber(r.runInHeadingDeg)) { v.runInHeadingDeg = r.runInHeadingDeg; derived.add("runInHeadingDeg"); }
  // VRP must stay at or inside IP: an unlocked independent IP that VRP passed is re-linked.
  if (result.ipRelinked) s.ipLinkedToVrp = true;
  if (s.ipLinkedToVrp && !locks.ipReference && isNumber(r.ipRangeNm)) { v.ipRangeNm = r.ipRangeNm; derived.add("ipRangeNm"); }
  if (!locks.vrpReference) {
    write("vrpRangeNm", r.vrpRangeNm);
    write("vrpBearingDeg", r.vrpBearingDeg);
    s.vrpBearingExplicit = true;
    s.vrpRangeExplicit = true;
  }
  ["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm", "offsetG", "offsetBankDeg", "offsetRadiusNm"].forEach((key) => write(key, r[key]));
  deriveProfileValues(lead, result, derived);
  syncLinkedInitial(lead, derived);
}

function leadDiagnostics(lead, result) {
  const { values: v, state: s, locks } = lead;
  const r = result.resolved;
  const out = [];
  const pushRange = (field, target, actual, cause) => {
    const residual = actual - target;
    const satisfied = Math.abs(residual) <= 0.002;
    out.push({ aircraft: 1, field, target, actual, residual, tolerance: 0.002, unit: "NM", satisfied, cause: satisfied ? null : cause });
  };
  const pushAngle = (field, target, actual, wrap, cause) => {
    const residual = wrap ? ((actual - target + 540) % 360) - 180 : actual - target;
    const satisfied = Math.abs(residual) <= 0.02;
    out.push({ aircraft: 1, field, target, actual, residual, tolerance: 0.02, unit: "deg", satisfied, cause: satisfied ? null : cause });
  };
  const holdVrp = !!locks.vrpReference || s.driver === "vrpRangeNm" || s.driver === "vrpBearingDeg";
  if (holdVrp) pushRange("vrpRangeNm", v.vrpRangeNm, r.actionRangeNm, "VRP Range cannot be satisfied (Action Point held at VRP)");
  if (locks.actionRangeNm || (!holdVrp && s.driver === "actionRangeNm")) pushRange("actionRangeNm", v.actionRangeNm, r.actionRangeNm, locks.actionRangeNm ? "LOCK conflict: Action Range cannot be satisfied" : "Action Range root not found");
  if (locks.approachRangeNm || (!holdVrp && !locks.actionRangeNm && s.driver === "approachRangeNm")) pushRange("approachRangeNm", v.approachRangeNm, r.approachRangeNm, locks.approachRangeNm ? "LOCK conflict: Approach Range cannot be satisfied" : "Approach Range root not found");
  if (locks.attackHeadingDeg) pushAngle("attackHeadingDeg", norm(v.attackHeadingDeg), r.attackHeadingDeg, true, "LOCK conflict: Attack Heading cannot be satisfied");
  if (locks.angleOffDeg) pushAngle("angleOffDeg", Math.abs(v.angleOffDeg), r.angleOffDeg, false, "LOCK conflict: Angle-Off cannot be satisfied");
  if (locks.offsetAngleDeg) pushAngle("offsetAngleDeg", Math.abs(v.offsetAngleDeg), r.offsetAngleDeg, false, "LOCK conflict: Offset Angle cannot be satisfied");
  return out;
}

// DED pages: the reference page (VRP or VIP) and OA1, from the aircraft's own Full result.
function dedFrom({ result, isVip, flightVip, referenceRangeNm, referenceBearingDeg, initialAltitudeMslFt }) {
  const points = result.geometry.points;
  const targetElevationMslFt = result.profile.canonicalInputs?.targetElevationMslFt;
  const rollInAltitudeMslFt = result.profile.public.resolvedInitialAltitudeMslFt;
  const oa1Base = isVip ? flightVip : points.target;
  const oa1RangeNm = distanceNm(oa1Base, points.rollStart);
  return {
    page: isVip ? "VIP" : "VRP",
    reference: {
      bearingDeg: referenceBearingDeg,
      rangeNm: referenceRangeNm,
      rangeFt: referenceRangeNm * FT_PER_NM,
      // VRP page ELEV is the aircraft's Initial Altitude; the VIP page keeps the Target elevation.
      elevationFt: isVip ? targetElevationMslFt : isNumber(initialAltitudeMslFt) ? initialAltitudeMslFt : rollInAltitudeMslFt,
    },
    oa1: { bearingDeg: bearingBetween(oa1Base, points.rollStart), rangeNm: oa1RangeNm, rangeFt: oa1RangeNm * FT_PER_NM, elevationFt: rollInAltitudeMslFt },
  };
}

function leadDed(lead, result) {
  const isVip = result.referenceMode === "VIP";
  return dedFrom({
    result,
    isVip,
    flightVip: result.geometry.points.vip,
    referenceBearingDeg: isVip ? result.resolved.vipToTargetBearingDeg : result.resolved.vrpBearingDeg,
    referenceRangeNm: isVip ? result.resolved.vipRangeNm : result.resolved.vrpRangeNm,
    initialAltitudeMslFt: lead.values.initialAltitudeMslFt,
  });
}

// Release Altitude at which the time-mode BDP (entered Tracking Time) reaches the held Roll-in
// Altitude, on one canonical BDP profile input (fixed Angle-Off / wind of one Offset geometry).
function solveProfileReleaseAltitude(canonicalInputs, rollInAltitudeMslFt, guessFt) {
  const config = OFFSET_FLIGHT_RELEASE_SOLVE;
  const f = (releaseAltitudeMslFt) => calculateBombDeliveryV0_3Full({ ...canonicalInputs, solveMode: "time", releaseAltitudeMslFt }).public.resolvedInitialAltitudeMslFt - rollInAltitudeMslFt;
  let x0 = guessFt;
  let f0 = f(x0);
  if (Math.abs(f0) <= config.toleranceFt) return { value: x0, belowNlt: false };
  let x1 = x0 - f0;
  for (let index = 0; index < config.profileIterations; index += 1) {
    let f1;
    try { f1 = f(x1); } catch { break; }
    if (!isNumber(f1)) break;
    if (Math.abs(f1) <= config.toleranceFt) return { value: x1, belowNlt: false };
    const slope = (f1 - f0) / (x1 - x0);
    if (!(slope > 1e-6)) break;
    x0 = x1;
    f0 = f1;
    x1 -= f1 / slope;
  }
  // No root: belowNlt when even the lowest Release (the NLT clamp holds it) leaves Roll-in too high.
  let belowNlt = false;
  try { belowNlt = f(canonicalInputs.targetElevationMslFt + 1) > 0; } catch { belowNlt = false; }
  return { value: null, belowNlt };
}

// "release" mode: Roll-in Altitude (LOCK) and the entered Tracking Time hold, Release Altitude moves.
// compute(releaseAltitudeMslFt) is the aircraft's own full Offset solve; the BDP-core step is
// repeated while the geometry (Angle-Off, wind) it ran on shifts.
function solveReleaseAltitude({ compute, rollInAltitudeMslFt, releaseAltitudeMslFt, trackingTimeSec }) {
  const config = OFFSET_FLIGHT_RELEASE_SOLVE;
  const conflict = (belowNlt = false) => new Error(`CONSTRAINT CONFLICT: Roll-in Altitude LOCK: no Release Altitude gives Tracking Time ${trackingTimeSec} sec from Roll-in Altitude ${Math.round(rollInAltitudeMslFt)} ft${belowNlt ? " (Release would be below NLT; shorten Tracking Time or raise Roll-in Altitude)" : ""}`);
  let release = releaseAltitudeMslFt;
  let result = compute(release);
  for (let pass = 0; ; pass += 1) {
    const reached = result.profile.public.resolvedInitialAltitudeMslFt;
    if (isNumber(reached) && Math.abs(reached - rollInAltitudeMslFt) <= config.acceptFt) return { result, releaseAltitudeMslFt: release };
    if (pass >= config.geometryPasses) throw conflict();
    let next;
    try { next = solveProfileReleaseAltitude(result.profile.canonicalInputs, rollInAltitudeMslFt, release); }
    catch { next = { value: null, belowNlt: false }; }
    if (!isNumber(next.value)) throw conflict(next.belowNlt);
    release = next.value;
    result = compute(release);
  }
}

function solveLead(lead, stateError) {
  const derived = new Set();
  const base = { aircraft: 1, elementLead: null, predecessor: null, pairSolved: false, solvedVariable: null, inheritance: null };
  if (stateError) return { ...base, status: "FAILED", result: null, error: stateError, errors: [stateError], warnings: [], derived, diagnostics: [] };
  try {
    prepareLead(lead, derived);
    const input = leadOffsetInput(lead);
    let result;
    if (lead.state.solveMode === "release") {
      const solved = solveReleaseAltitude({
        compute: (releaseAltitudeMslFt) => calculateOffsetWithVrpStartFull({ ...input, profile: { ...input.profile, releaseAltitudeMslFt } }),
        rollInAltitudeMslFt: input.profile.initialAltitudeMslFt,
        releaseAltitudeMslFt: input.profile.releaseAltitudeMslFt,
        trackingTimeSec: input.profile.trackingTimeSec,
      });
      result = solved.result;
      lead.values.releaseAltitudeMslFt = solved.releaseAltitudeMslFt;
    } else {
      result = calculateOffsetWithVrpStartFull(input);
    }
    deriveLeadNext(lead, result, derived);
    return { ...base, status: result.state, result, error: null, errors: result.errors, warnings: result.warnings, derived, diagnostics: leadDiagnostics(lead, result), ded: leadDed(lead, result) };
  } catch (error) {
    return { ...base, status: "FAILED", result: null, error: error.message, errors: [error.message], warnings: [], derived, diagnostics: [] };
  }
}

// ---- Followers ------------------------------------------------------------------------------------

function followerInheritance(follower, leaderResult, leadNumber) {
  const v = follower.values;
  const shared = leaderResult.profile.canonicalInputs;
  const inheritance = {};
  const resolved = {};
  for (const key of OFFSET_FLIGHT_INHERITED_KEYS) {
    if (blank(v[key])) {
      resolved[key] = requireNumber(`#${leadNumber} ${key}`, shared[key]);
      inheritance[key] = { source: "inherited", fromAircraft: leadNumber, value: resolved[key] };
    } else {
      resolved[key] = requireNumber(key, v[key]);
      inheritance[key] = { source: "explicit", fromAircraft: null, value: resolved[key] };
    }
  }
  const diveAngleDeg = requireNumber("diveAngleDeg", v.diveAngleDeg);
  if (blank(v.rollInBankAngleDeg)) {
    resolved.rollInBankAngleDeg = autoRollInBankDegFull({ diveAngleDeg, rollInG: resolved.rollInG });
    inheritance.rollInBankAngleDeg = { source: "auto", fromAircraft: null, value: resolved.rollInBankAngleDeg };
  } else {
    resolved.rollInBankAngleDeg = requireNumber("rollInBankAngleDeg", v.rollInBankAngleDeg);
    inheritance.rollInBankAngleDeg = { source: "explicit", fromAircraft: null, value: resolved.rollInBankAngleDeg };
  }
  return { inheritance, resolved };
}

function followerOffsetInput({ number, follower, leaderResult, leadNumber, flightLead, flightLeadValues, ipLimitPoint }) {
  const { values: v, state: s, options, formation } = follower;
  const n = (key) => requireNumber(key, v[key]);
  const wingman = WINGMEN.has(number);
  const sameAngleAsLead = wingman && options.sameAngleAsLead;
  const sameTimeAsLead = wingman && options.sameTimeAsLead;
  const { offsetAngleLocked, actionRangeLocked } = options;
  if (sameAngleAsLead && offsetAngleLocked) throw new Error(`CONSTRAINT CONFLICT: Angle #${leadNumber} (Offset Angle same as element lead) cannot combine with a manual Offset Angle LOCK`);
  if (sameTimeAsLead && actionRangeLocked) throw new Error(`CONSTRAINT CONFLICT: Time #${leadNumber} (Action at the element lead's time) cannot combine with a manual Action Range LOCK`);

  const runInHeadingDeg = leaderResult.resolved.runInHeadingDeg;
  const { vector } = computeFormationOffsetVectorFull({
    runInHeadingDeg,
    relativeBearingDeg: requireNumber("bearingDeg", formation.bearingDeg),
    side: formation.side,
    distanceNm: requireNumber("distanceNm", formation.distanceNm),
  });
  const ipPoint = add(leaderResult.geometry.points.ip, vector);
  const { inheritance, resolved: inherited } = followerInheritance(follower, leaderResult, leadNumber);
  const flightProfile = flightLead.profile.canonicalInputs;
  // Plain path: the last tactical edit drives, default this aircraft's own Action Point held; a
  // manual Offset Angle LOCK with the Action Point as driver holds the Offset Angle instead.
  const driver = actionRangeLocked ? "actionRangeNm" : offsetAngleLocked && s.driver === "actionRangeNm" ? "offsetAngleDeg" : s.driver;
  const solveMode = s.solveMode;
  const baseInput = {
    driver,
    turnDriver: "offsetG",
    locks: { offsetAngleDeg: offsetAngleLocked, actionRangeNm: actionRangeLocked },
    runInHeadingDeg,
    ipPoint,
    ipLimitPoint: ipLimitPoint ?? undefined,
    attackHeadingDeg: n("attackHeadingDeg"),
    angleOffDeg: n("angleOffDeg"),
    offsetAngleDeg: n("offsetAngleDeg"),
    actionRangeNm: n("actionRangeNm"),
    // The Offset leg (altitude, speed, turn) is the element lead's resolved one.
    offsetAltitudeMslFt: leaderResult.resolved.offsetAltitudeMslFt,
    offsetSpeedValue: leaderResult.resolved.offsetSpeedValue,
    offsetSpeedMode: leaderResult.resolved.offsetSpeedMode,
    offsetG: leaderResult.resolved.offsetG,
    offsetBankDeg: leaderResult.resolved.offsetBankDeg,
    offsetRadiusNm: leaderResult.resolved.offsetRadiusNm,
    profile: {
      weaponId: v.weaponId ?? "M82",
      // Target elevation and the true wind are the Flight's (#1's), same Target for every aircraft.
      targetElevationMslFt: flightProfile.targetElevationMslFt,
      windDirectionTrueDeg: requireNumber("#1 windDirectionDeg", flightLeadValues.windDirectionDeg),
      windSpeedKt: flightProfile.windSpeedKt,
      recoveryG: inherited.recoveryG,
      gOnsetTimeSec: inherited.gOnsetTimeSec,
      speedOvershootKcas: inherited.speedOvershootKcas,
      fragmentHeightMarginPercent: inherited.fragmentHeightMarginPercent,
      diveAngleDeg: n("diveAngleDeg"),
      initialSpeedValue: n("initialSpeedValue"),
      initialSpeedMode: "CAS",
      initialAltitudeMslFt: n("rollInAltitudeMslFt"),
      solveMode: solveMode === "release" ? "time" : solveMode,
      allowNegativeTrackingTime: true,
      trackingTimeSec: solveMode === "time" ? n("trackingTimeSec") : s.enteredTrackingTimeSec,
      releaseAltitudeMslFt: n("releaseAltitudeMslFt"),
      releaseSpeedKcas: n("releaseSpeedKcas"),
      rollInBankAngleDeg: inherited.rollInBankAngleDeg,
      rollInG: inherited.rollInG,
    },
  };
  return { baseInput, inheritance, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked, plainDriver: driver };
}

// Both conditions fixed (Offset Angle by Angle #n / LOCK, Action by Time #n / Action Range LOCK):
// this aircraft's own Roll-in entry moves while its Dive Angle stays as entered. Dive > 0: Roll-in
// Altitude is searched continuously, each candidate solved explicitly in height mode (Tracking Time
// derived). Level delivery (BDP solves it from Tracking Time; reported by BDP's resolvedSolveMode):
// every whole Tracking Time from 1 to 60 sec is evaluated in time mode. Only non-INVALID candidates
// within tolerance are solutions; the smallest |residual| wins, a tie goes to the value closest to
// the current input. 60 sec and 45000 ft are this solve's search bounds, not BDP limits.
function solvePair({ number, leadNumber, angleInput, follower, leaderResult, sameTimeAsLead }) {
  const config = OFFSET_FLIGHT_PAIR_SOLVE;
  const { values: v, state: s } = follower;
  const fixedInput = { ...angleInput, driver: "offsetAngleDeg", locks: { offsetAngleDeg: !!angleInput.locks.offsetAngleDeg } };
  const target = sameTimeAsLead ? signedIngressSec(leaderResult) : angleInput.actionRangeNm;
  if (!isNumber(target)) throw new TypeError(sameTimeAsLead ? `#${leadNumber} Action time is not available` : "actionRangeNm must be numeric");
  const metric = sameTimeAsLead ? signedIngressSec : (result) => result.resolved.actionRangeNm;
  const tolerance = sameTimeAsLead ? config.timeToleranceSec : config.actionToleranceNm;
  const unit = sameTimeAsLead ? "sec" : "NM";
  const field = sameTimeAsLead ? "ingressSec" : "actionRangeNm";
  const errors = new Map();
  let evaluations = 0;
  const sample = (override, value) => {
    evaluations += 1;
    try {
      const result = calculateOffAxisOffsetFull({ ...fixedInput, profile: { ...fixedInput.profile, ...override } });
      const residual = metric(result) - target;
      if (!isNumber(residual)) throw new Error("candidate metric is not finite");
      return { result, value, residual, usable: result.state !== "INVALID" };
    } catch (error) {
      errors.set(error.message, (errors.get(error.message) ?? 0) + 1);
      return null;
    }
  };
  const better = (a, b, current) => {
    if (!b) return a;
    const da = Math.abs(a.residual);
    const db = Math.abs(b.residual);
    if (Math.abs(da - db) > 1e-12) return da < db ? a : b;
    const ca = isNumber(current) ? Math.abs(a.value - current) : 0;
    const cb = isNumber(current) ? Math.abs(b.value - current) : 0;
    if (Math.abs(ca - cb) > 1e-12) return ca < cb ? a : b;
    return a.value <= b.value ? a : b;
  };
  const release = requireNumber("releaseAltitudeMslFt", v.releaseAltitudeMslFt);
  const minAltitude = release + config.altitudeAboveReleaseFt;
  const maxAltitude = config.maxAltitudeMslFt;
  const currentAltitude = v.rollInAltitudeMslFt;
  const altitudeOverride = (altitude) => ({ solveMode: "height", initialAltitudeMslFt: altitude, trackingTimeSec: Math.max(1, Math.round(fixedInput.profile.trackingTimeSec) || 1) });

  // Probe: BDP decides whether this is a level delivery (Roll-in Altitude is then not free).
  const altitudes = [];
  if (maxAltitude > minAltitude) {
    const step = (maxAltitude - minAltitude) / config.altitudeSteps;
    for (let index = 0; index <= config.altitudeSteps; index += 1) altitudes.push(minAltitude + step * index);
  }
  const probeValues = [isNumber(currentAltitude) && currentAltitude >= minAltitude && currentAltitude <= maxAltitude ? currentAltitude : null, ...altitudes].filter((value) => value !== null);
  let probe = null;
  for (const altitude of probeValues) { probe = sample(altitudeOverride(altitude), altitude); if (probe) break; }
  if (!probe) {
    return { solved: false, failure: `CONSTRAINT CONFLICT: no Roll-in entry candidate could be evaluated${errors.size ? ` (cause: ${candidateFailureCause(errors)})` : ""}`, best: null, target, tolerance, unit, field, variable: "rollInAltitudeMslFt" };
  }
  const level = probe.result.profile.public.resolvedSolveMode === "time";

  let best = null;
  let bestAny = null;
  let match = null;
  const consider = (item, current) => {
    if (!item) return;
    bestAny = better(item, bestAny, current);
    if (!item.usable) return;
    best = better(item, best, current);
    if (Math.abs(item.residual) <= tolerance) match = better(item, match, current);
  };

  if (level) {
    const currentTt = s.solveMode === "time" ? v.trackingTimeSec : s.enteredTrackingTimeSec;
    for (let tt = config.minTrackingTimeSec; tt <= config.maxTrackingTimeSec; tt += 1) consider(sample({ solveMode: "time", trackingTimeSec: tt }, tt), currentTt);
    const range = `${config.minTrackingTimeSec}-${config.maxTrackingTimeSec} sec`;
    if (match) return { solved: true, result: match.result, value: match.value, residual: match.residual, variable: "trackingTimeSec", target, tolerance, unit, field, evaluations };
    const what = sameTimeAsLead ? `#${leadNumber}'s Action time` : "the locked Action Range";
    return { solved: false, failure: `CONSTRAINT CONFLICT: no whole Tracking Time (${range}) at this Offset Angle and level delivery matches ${what}${best ? `; best residual ${best.residual.toFixed(3)} ${unit} at ${best.value} sec` : ""}`, best: best ?? bestAny, target, tolerance, unit, field, variable: "trackingTimeSec", evaluations };
  }

  // Roll-in Altitude scan (height mode), brackets between successive evaluated candidates (a rejected
  // candidate is a gap that is not bridged; INVALID candidates take part in bracketing because a root
  // often sits on a validity boundary, but are never a solution), every bracket refined.
  if (!altitudes.includes(probe.value)) consider(probe, currentAltitude);
  let previous = null;
  const brackets = [];
  for (const altitude of altitudes) {
    const item = altitude === probe.value ? probe : sample(altitudeOverride(altitude), altitude);
    consider(item, currentAltitude);
    if (!item) { previous = null; continue; }
    if (previous && previous.residual * item.residual <= 0) brackets.push({ lo: previous, hi: item });
    previous = item;
  }
  for (const bracket of brackets) {
    let { lo, hi } = bracket;
    if ((lo.usable && Math.abs(lo.residual) <= tolerance) || (hi.usable && Math.abs(hi.residual) <= tolerance)) continue;
    for (let index = 0; index < config.refineIterations; index += 1) {
      const mid = sample(altitudeOverride((lo.value + hi.value) / 2), (lo.value + hi.value) / 2);
      if (!mid) break;
      consider(mid, currentAltitude);
      if (mid.usable && Math.abs(mid.residual) <= tolerance) break;
      if (lo.residual * mid.residual <= 0) hi = mid;
      else lo = mid;
    }
  }
  if (match) return { solved: true, result: match.result, value: match.value, residual: match.residual, variable: "rollInAltitudeMslFt", target, tolerance, unit, field, evaluations };
  const what = sameTimeAsLead ? `#${leadNumber}'s Action time` : "the locked Action Range";
  return {
    solved: false,
    failure: `CONSTRAINT CONFLICT: no Roll-in Altitude (${Math.round(minAltitude)}-${maxAltitude} ft) at this Offset Angle and Dive Angle matches ${what}; change this aircraft's Dive Angle or free its Offset Angle${best ? ` (best residual ${best.residual.toFixed(3)} ${unit})` : ""}`,
    best: best ?? bestAny,
    target, tolerance, unit, field, variable: "rollInAltitudeMslFt", evaluations,
  };
}

function followerDiagnostics(number, context, result, pair) {
  const out = [];
  const r = result?.resolved;
  const push = (field, target, actual, tolerance, unit, cause, wrap = false) => {
    const residual = isNumber(actual) && isNumber(target) ? (wrap ? ((actual - target + 540) % 360) - 180 : actual - target) : null;
    const satisfied = residual !== null && Math.abs(residual) <= tolerance;
    out.push({ aircraft: number, field, target, actual: isNumber(actual) ? actual : null, residual, tolerance, unit, satisfied, cause: satisfied ? null : cause });
  };
  const { follower, leaderResult, leadNumber, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked, plainDriver, branch } = context;
  const v = follower.values;
  if (pair && !pair.solved) {
    out.push({ aircraft: number, field: pair.field, target: pair.target, actual: pair.best ? pair.target + pair.best.residual : null, residual: pair.best?.residual ?? null, tolerance: pair.tolerance, unit: pair.unit, satisfied: false, cause: pair.failure, searchVariable: pair.variable, searchEvaluations: pair.evaluations ?? null, bestCandidateValue: pair.best?.value ?? null, bestCandidateState: pair.best?.result?.state ?? null });
    return out;
  }
  if (!r) return out;
  if (sameAngleAsLead) push("offsetAngleDeg", leaderResult.resolved.offsetAngleDeg, r.offsetAngleDeg, 0.02, "deg", `Angle #${leadNumber} cannot be satisfied`);
  else if (offsetAngleLocked) push("offsetAngleDeg", Math.abs(v.offsetAngleDeg), r.offsetAngleDeg, 0.02, "deg", "LOCK conflict: Offset Angle cannot be satisfied");
  const pairTolerance = branch === "pair";
  if (sameTimeAsLead) push("ingressSec", signedIngressSec(leaderResult), signedIngressSec(result), OFFSET_FLIGHT_PAIR_SOLVE.timeToleranceSec, "sec", `Time #${leadNumber} cannot be satisfied`);
  else if (actionRangeLocked) push("actionRangeNm", v.actionRangeNm, r.actionRangeNm, pairTolerance ? OFFSET_FLIGHT_PAIR_SOLVE.actionToleranceNm : 0.002, "NM", "LOCK conflict: Action Range cannot be satisfied");
  else if (branch === "plain" && plainDriver === "actionRangeNm") push("actionRangeNm", v.actionRangeNm, r.actionRangeNm, 0.002, "NM", "Action Range root not found");
  return out;
}

function followerDed(follower, result, flightLead) {
  const isVip = flightLead.referenceMode === "VIP";
  const points = result.geometry.points;
  return dedFrom({
    result,
    isVip,
    // VIP mode: the Flight's shared ground reference (#1's VIP). VRP mode: own Action Point.
    flightVip: flightLead.geometry.points.vip,
    referenceBearingDeg: isVip ? flightLead.resolved.vipToTargetBearingDeg : bearingBetween(points.target, points.realActionPoint),
    referenceRangeNm: isVip ? flightLead.resolved.vipRangeNm : distanceNm(points.target, points.realActionPoint),
    initialAltitudeMslFt: follower.values.initialAltitudeMslFt,
  });
}

// Next follower state: LOCK targets and the plain-path driver are kept; Angle #n writes the element
// lead's angle, Time #n / pair solves write their derived values; Inherited (null) values stay null.
function deriveFollowerNext(follower, result, context, pair, derived) {
  const { values: v } = follower;
  const r = result.resolved;
  const locked = { offsetAngleDeg: context.offsetAngleLocked, actionRangeNm: context.actionRangeLocked };
  for (const key of ["offsetAngleDeg", "actionRangeNm", "attackHeadingDeg", "angleOffDeg"]) {
    if (locked[key]) continue;
    if (context.branch === "plain" && key === context.plainDriver && !(key === "offsetAngleDeg" && context.sameAngleAsLead)) continue;
    if (!isNumber(r[key])) continue;
    v[key] = r[key];
    derived.add(key);
  }
  const p = result.profile.public;
  if (pair?.solved) {
    // Roll-in Altitude and Tracking Time were solved together; the entered Tracking Time history
    // and the stored solve mode are unchanged.
    if (isNumber(p.resolvedInitialAltitudeMslFt)) { v.rollInAltitudeMslFt = p.resolvedInitialAltitudeMslFt; derived.add("rollInAltitudeMslFt"); }
    if (isNumber(p.trackingTimeSec)) { v.trackingTimeSec = p.trackingTimeSec; derived.add("trackingTimeSec"); }
  } else {
    deriveProfileValues(follower, result, derived);
  }
  syncLinkedInitial(follower, derived);
}

function solveFollower({ number, follower, stateError, results, flightLead, flightLeadValues }) {
  const leadNumber = OFFSET_FLIGHT_ELEMENT_LEAD[number];
  const derived = new Set();
  const base = { aircraft: number, elementLead: leadNumber, predecessor: number - 1, pairSolved: false, solvedVariable: null, inheritance: null, derived };
  const fail = (message, extra = {}) => ({ ...base, status: "FAILED", result: null, error: message, errors: [message], warnings: [], diagnostics: [], ...extra });
  if (!follower) return fail(`Aircraft #${number} input is missing`);
  if (stateError) return fail(stateError);
  const leaderResult = results[leadNumber]?.result ?? null;
  // A leader without a result in this call fails its followers (never an earlier result).
  if (!leaderResult) return fail(`Aircraft #${leadNumber} has no current result`);
  let context;
  try {
    const built = followerOffsetInput({ number, follower, leaderResult, leadNumber, flightLead, flightLeadValues, ipLimitPoint: flightLead.geometry.points.ip });
    const { baseInput, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked } = built;
    const angleInput = sameAngleAsLead ? applyElementLeadOffsetAngle({ leaderResult, followerInput: baseInput }) : baseInput;
    const angleFixed = sameAngleAsLead || offsetAngleLocked;
    const actionFixed = sameTimeAsLead || actionRangeLocked;
    context = { ...built, follower, leaderResult, leadNumber, branch: angleFixed && actionFixed ? "pair" : sameTimeAsLead ? "sameTime" : "plain" };
    let result;
    let pair = null;
    const releaseSolve = follower.state.solveMode === "release";
    // Runs one branch's solve at a given Release Altitude (the "release" mode searches it).
    const atRelease = (input, releaseAltitudeMslFt) => (releaseSolve ? { ...input, profile: { ...input.profile, releaseAltitudeMslFt } } : input);
    const solveWith = (compute) => {
      if (!releaseSolve) return compute(angleInput.profile.releaseAltitudeMslFt);
      const solved = solveReleaseAltitude({ compute, rollInAltitudeMslFt: angleInput.profile.initialAltitudeMslFt, releaseAltitudeMslFt: angleInput.profile.releaseAltitudeMslFt, trackingTimeSec: angleInput.profile.trackingTimeSec });
      follower.values.releaseAltitudeMslFt = solved.releaseAltitudeMslFt;
      return solved.result;
    };
    if (context.branch === "pair" && follower.options.rollInAltitudeLocked) {
      return fail("CONSTRAINT CONFLICT: Roll-in Altitude LOCK cannot combine with a fixed Offset Angle and Action (that solve moves Roll-in Altitude)", { inheritance: built.inheritance });
    }
    if (context.branch === "pair") {
      pair = solvePair({ number, leadNumber, angleInput, follower, leaderResult, sameTimeAsLead });
      if (!pair.solved) {
        return fail(pair.failure, { inheritance: built.inheritance, diagnostics: followerDiagnostics(number, context, null, pair), diagnosticCandidate: pair.best?.result ?? null });
      }
      result = pair.result;
    } else if (context.branch === "sameTime") {
      // Time #n alone: same IP -> Action time as the element lead; the free Offset Angle re-solves.
      const sameTimeAt = (releaseAltitudeMslFt) => solveElementSameTimeActionRange({
        leaderResult,
        followerLocks: baseInput.locks,
        evaluate: (actionRangeFromIpNm) => calculateOffAxisOffsetFull({ ...atRelease(baseInput, releaseAltitudeMslFt), driver: "actionRangeFromIpNm", locks: { offsetAngleDeg: false }, actionRangeFromIpNm }),
      });
      // The last same-time solve is kept; an unsolved one stops the Release search and fails below.
      let solved = null;
      const unsolved = Symbol("unsolved");
      const sameTimeResult = (releaseAltitudeMslFt) => {
        solved = sameTimeAt(releaseAltitudeMslFt);
        if (!solved.result || !solved.exact) throw unsolved;
        return solved.result;
      };
      try { solveWith(sameTimeResult); }
      catch (error) { if (error !== unsolved) throw error; }
      if (!solved?.result || !solved.exact) {
        const message = `CONSTRAINT CONFLICT: no Offset Angle puts this aircraft's Action Point at #${leadNumber}'s Action time`;
        const diagnostics = [{ aircraft: number, field: "ingressSec", target: signedIngressSec(leaderResult), actual: solved.result ? signedIngressSec(solved.result) : null, residual: solved.residualSec ?? null, tolerance: OFFSET_FLIGHT_PAIR_SOLVE.timeToleranceSec, unit: "sec", satisfied: false, cause: message }];
        return fail(message, { inheritance: built.inheritance, diagnostics, diagnosticCandidate: solved.result ?? null });
      }
      result = solved.result;
    } else {
      result = solveWith((releaseAltitudeMslFt) => calculateOffAxisOffsetFull(atRelease(angleInput, releaseAltitudeMslFt)));
    }
    deriveFollowerNext(follower, result, context, pair, derived);
    return {
      ...base,
      status: result.state,
      result,
      error: null,
      errors: result.errors,
      warnings: result.warnings,
      pairSolved: !!pair,
      solvedVariable: pair?.variable ?? null,
      pairResidual: pair ? { value: pair.value, residual: pair.residual, tolerance: pair.tolerance, unit: pair.unit, evaluations: pair.evaluations } : null,
      inheritance: built.inheritance,
      diagnostics: followerDiagnostics(number, context, result, pair),
      ded: followerDed(follower, result, flightLead),
    };
  } catch (error) {
    return fail(error.message, { inheritance: context?.inheritance ?? null });
  }
}

// ---- Entrypoint ------------------------------------------------------------------------------------

function flightTiming(flightSize, results) {
  const timing = {};
  for (let number = 2; number <= flightSize; number += 1) {
    const predecessor = number - 1;
    const own = results[number]?.result;
    const previous = results[predecessor]?.result;
    if (!own || !previous) {
      timing[number] = { aircraft: number, predecessor, available: false, cause: !previous ? `Aircraft #${predecessor} has no current result` : `Aircraft #${number} has no current result` };
      continue;
    }
    timing[number] = { aircraft: number, predecessor, available: true, ...computeDropOrderDeltaFull({ predecessorResult: previous, ownResult: own }) };
  }
  return timing;
}

function outputRecord(number, record) {
  if (record.raw) return structuredClone(record.raw);
  if (number === 1) return { values: record.values, locks: record.locks, state: record.state };
  return { values: record.values, formation: record.formation, options: record.options, state: record.state };
}

export function calculateOffsetFlightFull(input) {
  const { flightSize, aircraft, stateErrors } = normalizeFlightInput(input);
  const editErrors = {};
  const edit = input.edit ?? null;
  if (edit) {
    const number = edit.aircraft ?? 1;
    if (!aircraft[number]) throw new TypeError(`edit targets missing aircraft #${number}`);
    if (!aircraft[number].raw) try {
      if (number === 1) applyLeadEdit(aircraft[1], edit);
      else applyFollowerEdit(aircraft[number], edit, number);
    } catch (error) {
      editErrors[number] = error.message;
    }
  }

  const results = {};
  results[1] = solveLead(aircraft[1], stateErrors[1] ?? editErrors[1]);
  const flightLead = results[1].result;
  for (const number of FOLLOWERS) {
    if (number > flightSize) continue;
    results[number] = solveFollower({ number, follower: aircraft[number], stateError: stateErrors[number] ?? editErrors[number], results, flightLead, flightLeadValues: aircraft[1].values });
  }

  const aircraftResults = {};
  const constraintDiagnostics = [];
  const nextAircraft = {};
  for (const number of [1, ...FOLLOWERS]) {
    if (aircraft[number]) nextAircraft[number] = outputRecord(number, aircraft[number]);
    const entry = results[number];
    if (!entry) continue;
    const { derived, diagnostics, ...rest } = entry;
    if (nextAircraft[number]) nextAircraft[number].derivedKeys = [...derived].sort();
    aircraftResults[number] = { ...rest, ded: entry.ded ?? null };
    constraintDiagnostics.push(...diagnostics);
  }
  return {
    model: { ...OFFSET_FLIGHT_V0_1, components: { ...OFFSET_FLIGHT_V0_1.components } },
    flightSize,
    aircraftResults,
    constraintDiagnostics,
    flightTiming: flightTiming(flightSize, results),
    nextInput: { schemaVersion: OFFSET_FLIGHT_V0_1.schemaVersion, flightSize, aircraft: nextAircraft },
  };
}

// Public entrypoint: results truncated to 5 decimals (docs/FE-BE-RULES.md). It carries no nextInput:
// the next input state is continued only from calculateOffsetFlightFull, so truncated numbers are
// never fed back into a calculation.
export function calculateOffsetFlight(input) {
  const { nextInput, ...rest } = calculateOffsetFlightFull(input);
  return truncateBeOutput(rest);
}
