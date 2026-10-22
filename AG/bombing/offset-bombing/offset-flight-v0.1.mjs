import { OFFSET_BE_V0_2, calculateOffsetWithVrpStartFull } from "./offset-be-v0.2.mjs";
import { OFFSET_FORMATION_GEOMETRY_V0_1, calculateOffAxisOffsetFull } from "./offset-formation-geometry-v0.1.mjs";
import {
  OFFSET_FORMATION_V0_1,
  computeDropOrderDeltaFull,
  computeFormationOffsetVectorFull,
  solveElementSameTimeActionRange,
} from "./offset-formation-v0.1.mjs";
import { add, candidateFailureCause } from "./offset-geometry-v0.2.mjs";
import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, FRAGMENT_MARGIN_MODES, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { calculationCacheStats, calculationKey, createCalculationCache, snapshotCalculationCacheStats, withCalculationCache } from "../../../common/calculation/calculation-cache-v0.1.mjs";

// Offset Flight entrypoint (AG SPEC "Flight entrypoint", 2026-10-12): one call takes the whole Flight
// input state (#1 and its followers, their LOCKs / options / formation positions / entry history and
// an optional one-shot edit) and returns every aircraft's Full result, the constraint diagnostics,
// the drop-order timing and the next input state. Pure: no DOM, window, storage or FE import; the
// input is never mutated; the same input gives the same output.
export const OFFSET_FLIGHT_V0_1 = Object.freeze({
  id: "offset-flight-v0.1",
  // 0.1.2 (2026-10-12, user: #2–#4 work like #1): follower Attack Heading / Angle-Off / Approach Range
  // / Dive Angle LOCKs, Approach Range field and driver, Angle-Off / Attack Heading edits held under
  // Angle #n, every unheld tactical value written back, Roll-in Altitude LOCK in the both-fixed solve
  // (Release Altitude moves), typed values that a hold replaces reported, Tracking Time in 0.1 s.
  // 0.1.3 (2026-10-14, owner): #1 values the LOCKs fix are named in nextInput (lockSolvedKeys), shown
  // solved and read-only; a driver among them hands over to a LOCKed value and is written back.
  // 0.1.4 (2026-10-15, owner): BDP v0.4 Roll-in (technique B, linear rate onsets). The Roll-in Bank is
  // solved by BDP and written back as a derived value for every aircraft; it is no longer an input (no
  // AUTO, no level-turn Bank -> G coupling). The Roll-in / Roll-out / G Onset rates follow #1 (inherited).
  // 0.1.5 (2026-10-15, owner R3 / Q8): #1 state.fragmentMarginAppliesTo (developer option, Flight-wide:
  // HEIGHT_AND_RADIUS default, HEIGHT) goes to every aircraft's BDP; BDP v0.4.1 SEM / fragment outputs.
  // 0.1.6 (2026-10-19, owner): the Level SEM turn (BDP v0.4.3) — semTurnType / semTurnDeg / semTurnG /
  // semTurnSpeedKcas / semTurnBankDeg follow the element lead while blank; semTurnDirection is the aircraft's own
  // (blank: its Roll-in direction).
  // 0.1.7 (2026-10-22, owner): a Run-In / IP Bearing edit turns the whole attack geometry about the Target —
  // every absolute Attack Heading (#1 and each follower, LOCKed or not), the VRP and VIP bearings and a locked
  // IP's bearing move by the Run-In change from #1 state.runInBaseDeg (the last solved Run-In); LOCKs stay on
  // and the driver is kept. state.runInTurnDeg adds up these turns (S&R turns its plan by it); the wind stays.
  version: "0.1.7",
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
const FOLLOWER_DRIVERS = new Set(["attackHeadingDeg", "angleOffDeg", "offsetAngleDeg", "actionRangeNm", "approachRangeNm"]);
const LEAD_FALLBACK_DRIVERS = Object.freeze({ vrpRangeNm: "actionRangeNm", actionRangeNm: "vrpRangeNm" });
// #1 coupled tactical values (Run-In given). Any two fixing LOCKs settle all of them; Action Range and
// VRP LOCKs both fix the Action Point, and one range LOCK also settles the other range (the solve
// root-finds one range at a time). The first LOCKed key in this order takes over a settled driver.
const LEAD_COUPLED_KEYS = Object.freeze(["actionRangeNm", "approachRangeNm", "angleOffDeg", "attackHeadingDeg", "offsetAngleDeg"]);
const LEAD_TURN_FALLBACK = Object.freeze({ offsetG: "offsetBankDeg", offsetBankDeg: "offsetG", offsetRadiusNm: "offsetG" });
const FOLLOWER_FALLBACK_DRIVERS = Object.freeze({ actionRangeNm: "offsetAngleDeg" });
// Follower BDP values that follow the element lead's effective value while null.
// 2026-10-18 (owner handoff §6): csemTargetFpaDeg (CSEM Target FPA) joins them; semEnd (LEVEL / CLIMB) is the
// text key below, inherited the same way.
// 2026-10-19 (owner): the Level SEM turn — semTurnDeg and semTurnType (LEVEL / SLICE) follow the same way; the
// optional semTurnG / semTurnSpeedKcas / semTurnBankDeg follow the lead's entry, whose blank means Recovery G / the
// level-off speed / none. semTurnDirection is each aircraft's own (blank: its own Roll-in direction).
export const OFFSET_FLIGHT_INHERITED_KEYS = Object.freeze(["fragmentHeightMarginPercent", "recoveryG", "speedOvershootKcas", "gOnsetTimeSec", "rollInG", "rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec", "csemTargetFpaDeg", "semTurnDeg"]);
export const OFFSET_FLIGHT_INHERITED_TEXT_KEYS = Object.freeze(["semEnd", "semTurnType"]);
export const OFFSET_FLIGHT_INHERITED_OPTIONAL_KEYS = Object.freeze(["semTurnG", "semTurnSpeedKcas", "semTurnBankDeg"]);
const SEM_ENDS = Object.freeze(["LEVEL", "CLIMB"]);
const semEndOf = (value) => (SEM_ENDS.includes(value) ? value : undefined);
const SEM_TURN_TYPES = Object.freeze(["LEVEL", "SLICE"]);
const SEM_TURN_DIRECTIONS = Object.freeze(["LEFT", "RIGHT"]);
const choiceOf = (options) => (value) => (options.includes(value) ? value : undefined);
const semTurnTypeOf = choiceOf(SEM_TURN_TYPES);
const semTurnDirectionOf = choiceOf(SEM_TURN_DIRECTIONS);
// BDP v0.4 Roll-in onset rates (owner 2026-10-15): #1's value, or the BDP default while #1 has none.
export const OFFSET_FLIGHT_ONSET_KEYS = Object.freeze(["rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
// Follower LOCKs (same fields as #1's since 0.1.2; Run-In and IP follow #1) and element-lead options.
// Dive Angle LOCK is a hold marker as on #1 (no solve moves a Dive Angle).
const FOLLOWER_OPTIONS = ["offsetAngleLocked", "sameAngleAsLead", "actionRangeLocked", "sameTimeAsLead", "rollInAltitudeLocked", "attackHeadingLocked", "angleOffLocked", "approachRangeLocked", "diveAngleLocked"];
const OPTION_EXCLUSIONS = Object.freeze({
  offsetAngleLocked: ["sameAngleAsLead"],
  sameAngleAsLead: ["offsetAngleLocked"],
  actionRangeLocked: ["sameTimeAsLead"],
  sameTimeAsLead: ["actionRangeLocked", "approachRangeLocked"],
  approachRangeLocked: ["sameTimeAsLead"],
  rollInAltitudeLocked: [],
  attackHeadingLocked: [],
  angleOffLocked: [],
  diveAngleLocked: [],
});
// Entered Tracking Time unit (user 2026-10-12: 0.1 s, superseding whole seconds); BDP rounds the same.
export const OFFSET_FLIGHT_TRACKING_TIME_STEP_SEC = 0.1;
const roundTrackingTime = (value) => Math.round(value * 10) / 10;

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
  // Direct Tracking Time entry is in 0.1 s (BDP trackingTimeStepSec 0.1 rounds the same).
  return roundTrackingTime(value);
}

// "release" (Tracking Time entered, Roll-in Altitude held, Release Altitude solved) exists only while
// Roll-in Altitude is locked; without the LOCK it reads as "time" (same entered Tracking Time).
function normalizeSolveMode(mode, rollInLocked) {
  if (mode === "release") return rollInLocked ? "release" : "time";
  return mode === "time" ? "time" : "height";
}

const FRAGMENT_MARGIN_MODE_SET = new Set(FRAGMENT_MARGIN_MODES);

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
      rollInAltitudeLinked: state.rollInAltitudeLinked !== false,
      solveMode: normalizeSolveMode(state.solveMode, locks.rollInAltitudeMslFt === true),
      enteredTrackingTimeSec: normalizeEnteredTrackingTime(state.enteredTrackingTimeSec),
      vipBearingExplicit: state.vipBearingExplicit === true,
      vipRangeExplicit: state.vipRangeExplicit === true,
      vrpBearingExplicit: state.vrpBearingExplicit === true,
      vrpRangeExplicit: state.vrpRangeExplicit === true,
      fragmentMarginAppliesTo: enumOr("fragmentMarginAppliesTo", state.fragmentMarginAppliesTo, FRAGMENT_MARGIN_MODE_SET, "HEIGHT_AND_RADIUS"),
      runInBaseDeg: isNumber(state.runInBaseDeg) ? norm(state.runInBaseDeg) : null,
      runInTurnDeg: isNumber(state.runInTurnDeg) ? norm(state.runInTurnDeg) : 0,
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
    if (key === "rollInAltitudeMslFt" && s.solveMode !== "time" && s.rollInAltitudeLinked && isNumber(v.initialAltitudeMslFt)) value = Math.round(v.initialAltitudeMslFt);
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
    // IP <- VRP link like a Run-In edit and moves a locked IP's bearing with it. Like a Run-In edit it
    // turns the geometry and keeps the driver (0.1.7, turnWithRunIn).
    if (!isNumber(value)) return;
    if (locks.ipReference) s.ipLockHeadingDeg = norm(value);
    v.runInHeadingDeg = norm(value);
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
      s.enteredTrackingTimeSec = roundTrackingTime(value);
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
  if (key === "runInHeadingDeg") {
    // A turn of the whole geometry, not a new tactical constraint: the driver stays (0.1.7).
    if (isNumber(value)) v.runInHeadingDeg = norm(value);
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
      s.enteredTrackingTimeSec = roundTrackingTime(value);
      v.trackingTimeSec = s.enteredTrackingTimeSec;
    }
  }
  if (WINGMEN.has(number)) applyTypedOverElementLead(options, key);
  if (FOLLOWER_DRIVERS.has(key)) s.driver = key;
}

// A typed tactical value and the element-lead buttons (2026-10-12, user: followers like #1):
// - typing the field Angle #n / Time #n holds turns that hold into a LOCK at the typed value
//   (Angle #n -> Offset Angle LOCK, Time #n -> Action Range LOCK), like typing over a LOCK on #1;
// - typing a value that Angle #n / Time #n would solve over (an Action / Approach Range under
//   Angle #n, an Offset Angle or Approach Range under Time #n) turns that button off, so the typed
//   value drives as it does on #1. Manual LOCKs are never released (a value one of them decides is
//   reported as not kept, see typedNotKeptWarning).
function applyTypedOverElementLead(options, key) {
  if (key === "offsetAngleDeg") {
    if (options.sameAngleAsLead) { options.sameAngleAsLead = false; options.offsetAngleLocked = true; }
    else if (!options.offsetAngleLocked && options.sameTimeAsLead) options.sameTimeAsLead = false;
  } else if (key === "actionRangeNm") {
    if (options.sameTimeAsLead) { options.sameTimeAsLead = false; options.actionRangeLocked = true; }
    else if (!options.actionRangeLocked && !options.approachRangeLocked && options.sameAngleAsLead) options.sameAngleAsLead = false;
  } else if (key === "approachRangeNm" && !options.approachRangeLocked) {
    options.sameTimeAsLead = false;
    if (!options.actionRangeLocked && options.sameAngleAsLead) options.sameAngleAsLead = false;
  }
}

// ---- #1 ------------------------------------------------------------------------------------------

// Reference fallbacks (implicit VIP = Run-In / 10 NM, implicit VRP = reciprocal / 7 NM).
function prepareLead(lead) {
  const { values: v, state: s } = lead;
  if (isNumber(v.runInHeadingDeg)) {
    const runIn = norm(v.runInHeadingDeg);
    if (!s.vipBearingExplicit || !isNumber(v.vipToTargetBearingDeg)) v.vipToTargetBearingDeg = runIn;
    if (!s.vipRangeExplicit || !isNumber(v.vipRangeNm)) v.vipRangeNm = DEFAULT_VIP_RANGE_NM;
    if (!s.vrpBearingExplicit || !isNumber(v.vrpBearingDeg)) v.vrpBearingDeg = norm(runIn + 180);
  }
  if (!s.vrpRangeExplicit || !isNumber(v.vrpRangeNm)) v.vrpRangeNm = DEFAULT_VRP_RANGE_NM;
}

// #1's onset rates (BDP v0.4): its own value, or the BDP default while it has none.
function leadOnset(values) {
  return Object.fromEntries(OFFSET_FLIGHT_ONSET_KEYS.map((key) => [key, isNumber(values[key]) ? values[key] : ROLL_IN_ONSET_DEFAULTS[key]]));
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
      trackingTimeStepSec: OFFSET_FLIGHT_TRACKING_TIME_STEP_SEC,
      releaseAltitudeMslFt: n("releaseAltitudeMslFt"),
      angleOffDeg: n("angleOffDeg"),
      rollInG: n("rollInG"),
      ...leadOnset(v),
      fragmentMarginAppliesTo: s.fragmentMarginAppliesTo,
      // The selected SEM (BDP v0.4.2): blank = LEVEL / +30°.
      semEnd: semEndOf(v.semEnd),
      csemTargetFpaDeg: blank(v.csemTargetFpaDeg) ? undefined : n("csemTargetFpaDeg"),
      // The Level SEM turn (BDP v0.4.3): blank = LEVEL, no turn, Recovery G, the level-off speed, the Roll-in direction.
      semTurnType: semTurnTypeOf(v.semTurnType),
      semTurnDeg: blank(v.semTurnDeg) ? undefined : n("semTurnDeg"),
      semTurnDirection: semTurnDirectionOf(v.semTurnDirection),
      ...Object.fromEntries(OFFSET_FLIGHT_INHERITED_OPTIONAL_KEYS.map((key) => [key, blank(v[key]) ? undefined : n(key)])),
    },
  };
}

// BDP solve-mode coupling: height mode derives Tracking Time; time mode (or a level delivery, which
// BDP always solves from Tracking Time) derives Roll-in Altitude and shows the entered Tracking Time.
// The Roll-in Bank BDP v0.4 solved (a result, written back for display).
function deriveRollInBank(record, result, derived) {
  const bank = result.profile.public.rollInBankAngleDeg;
  if (isNumber(bank)) { record.values.rollInBankAngleDeg = bank; derived.add("rollInBankAngleDeg"); }
}

function deriveProfileValues(record, result, derived) {
  const { values: v, state: s } = record;
  const p = result.profile.public;
  deriveRollInBank(record, result, derived);
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

// #1 coupled values the active LOCKs settle (owner 2026-10-14: an edit to them could not be kept, so
// the app shows them solved and read-only instead of keeping a typed value the Top View ignores).
export function leadLockSolvedKeys(locks = {}) {
  const pointFixed = locks.actionRangeNm === true || locks.vrpReference === true;
  const fixing = [pointFixed, locks.approachRangeNm, locks.angleOffDeg, locks.attackHeadingDeg, locks.offsetAngleDeg].filter((on) => on === true).length;
  const free = LEAD_COUPLED_KEYS.filter((key) => locks[key] !== true);
  if (fixing >= 2) return free;
  if (pointFixed || locks.approachRangeNm === true) return free.filter((key) => key === "actionRangeNm" || key === "approachRangeNm");
  return [];
}

// A driver the LOCKs settle would add a target they already decide (dropped silently or INVALID);
// the first LOCKed coupled value (or the reference LOCK) drives instead, so the field is written back.
function handOverLockSolvedDriver(lead) {
  const { state: s, locks } = lead;
  if (!leadLockSolvedKeys(locks).includes(s.driver)) return;
  s.driver = LEAD_COUPLED_KEYS.find((key) => locks[key] === true) ?? "referenceLock";
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
  if (isNumber(v.runInHeadingDeg)) s.runInBaseDeg = norm(v.runInHeadingDeg);
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
  const f = (releaseAltitudeMslFt) => calculateBombDeliveryV0_4Full({ ...canonicalInputs, solveMode: "time", releaseAltitudeMslFt }).public.resolvedInitialAltitudeMslFt - rollInAltitudeMslFt;
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
    prepareLead(lead);
    handOverLockSolvedDriver(lead);
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
  for (const key of OFFSET_FLIGHT_INHERITED_TEXT_KEYS) {
    if (blank(v[key])) {
      resolved[key] = shared[key];
      inheritance[key] = { source: "inherited", fromAircraft: leadNumber, value: resolved[key] };
    } else {
      resolved[key] = semEndOf(v[key]) ?? v[key];
      inheritance[key] = { source: "explicit", fromAircraft: null, value: resolved[key] };
    }
  }
  // Optional numbers: the lead's entry, absent (its default) included.
  for (const key of OFFSET_FLIGHT_INHERITED_OPTIONAL_KEYS) {
    if (blank(v[key])) {
      resolved[key] = shared[key] ?? undefined;
      inheritance[key] = { source: "inherited", fromAircraft: leadNumber, value: resolved[key] ?? null };
    } else {
      resolved[key] = requireNumber(key, v[key]);
      inheritance[key] = { source: "explicit", fromAircraft: null, value: resolved[key] };
    }
  }
  return { inheritance, resolved };
}

function followerOffsetInput({ number, follower, leaderResult, leadNumber, flightLead, flightLeadValues, ipLimitPoint }) {
  const { values: v, state: s, options, formation } = follower;
  const n = (key) => requireNumber(key, v[key]);
  const wingman = WINGMEN.has(number);
  const sameAngleAsLead = wingman && options.sameAngleAsLead;
  const sameTimeAsLead = wingman && options.sameTimeAsLead;
  const { offsetAngleLocked, actionRangeLocked, approachRangeLocked, attackHeadingLocked, angleOffLocked } = options;
  if (sameAngleAsLead && offsetAngleLocked) throw new Error(`CONSTRAINT CONFLICT: Angle #${leadNumber} (Offset Angle same as element lead) cannot combine with a manual Offset Angle LOCK`);
  if (sameTimeAsLead && actionRangeLocked) throw new Error(`CONSTRAINT CONFLICT: Time #${leadNumber} (Action at the element lead's time) cannot combine with a manual Action Range LOCK`);
  if (sameTimeAsLead && approachRangeLocked) throw new Error(`CONSTRAINT CONFLICT: Time #${leadNumber} (Action at the element lead's time) cannot combine with an Approach Range LOCK`);

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
  // Plain path: the last tactical edit drives, default this aircraft's own Action Point held. A range
  // LOCK (Action before Approach, as #1) holds that range. A fixed Offset Angle (LOCK or Angle #n)
  // with a range as driver holds the Offset Angle instead and the range follows (no residual).
  // The last Attack Heading / Angle-Off edit stays held whatever the range driver (headingDriver).
  const rangeLock = actionRangeLocked ? "actionRangeNm" : approachRangeLocked ? "approachRangeNm" : null;
  const angleFixed = sameAngleAsLead || offsetAngleLocked;
  const rangeDriver = s.driver === "actionRangeNm" || s.driver === "approachRangeNm";
  const driver = rangeLock ?? (angleFixed && (rangeDriver || s.driver === "offsetAngleDeg") ? "offsetAngleDeg" : s.driver);
  const headingDriver = s.driver === "angleOffDeg" || s.driver === "attackHeadingDeg" ? s.driver : "offsetAngleDeg";
  const solveMode = s.solveMode;
  const baseInput = {
    driver,
    headingDriver,
    turnDriver: "offsetG",
    locks: { offsetAngleDeg: offsetAngleLocked, actionRangeNm: actionRangeLocked, approachRangeNm: approachRangeLocked, attackHeadingDeg: attackHeadingLocked, angleOffDeg: angleOffLocked },
    runInHeadingDeg,
    ipPoint,
    ipLimitPoint: ipLimitPoint ?? undefined,
    attackHeadingDeg: n("attackHeadingDeg"),
    angleOffDeg: n("angleOffDeg"),
    offsetAngleDeg: n("offsetAngleDeg"),
    actionRangeNm: n("actionRangeNm"),
    // Needed only while it is LOCKed or drives (a follower record before 0.1.2 has none).
    approachRangeNm: approachRangeLocked || s.driver === "approachRangeNm" ? n("approachRangeNm") : isNumber(v.approachRangeNm) ? v.approachRangeNm : undefined,
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
      trackingTimeStepSec: OFFSET_FLIGHT_TRACKING_TIME_STEP_SEC,
      releaseAltitudeMslFt: n("releaseAltitudeMslFt"),
      releaseSpeedKcas: n("releaseSpeedKcas"),
      rollInG: inherited.rollInG,
      ...Object.fromEntries(OFFSET_FLIGHT_ONSET_KEYS.map((key) => [key, inherited[key]])),
      semEnd: inherited.semEnd,
      csemTargetFpaDeg: inherited.csemTargetFpaDeg,
      semTurnType: semTurnTypeOf(inherited.semTurnType),
      semTurnDeg: inherited.semTurnDeg,
      ...Object.fromEntries(OFFSET_FLIGHT_INHERITED_OPTIONAL_KEYS.map((key) => [key, inherited[key]])),
      // Each aircraft's own (blank: its Roll-in direction).
      semTurnDirection: semTurnDirectionOf(v.semTurnDirection),
      // The Flight's (#1's) developer option.
      fragmentMarginAppliesTo: flightProfile.fragmentMarginAppliesTo,
    },
  };
  // Angle #n: the element lead's solved Offset Angle held as a fixed value (the heading hold above
  // still applies; a range driver already gave way to it).
  const angleInput = sameAngleAsLead
    ? { ...baseInput, offsetAngleDeg: requireNumber(`#${leadNumber} offsetAngleDeg`, leaderResult.resolved.offsetAngleDeg), locks: { ...baseInput.locks, offsetAngleDeg: true } }
    : baseInput;
  return { baseInput, angleInput, inheritance, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked, approachRangeLocked, attackHeadingLocked, angleOffLocked, rangeLock, angleFixed, plainDriver: driver, headingDriver };
}

// Both conditions fixed (Offset Angle by Angle #n / LOCK; Action by Time #n / Action Range LOCK, or
// since 0.1.2 an Approach Range LOCK): this aircraft's own Roll-in entry moves while its Dive Angle
// stays as entered. Dive > 0: Roll-in Altitude is searched continuously, each candidate solved
// explicitly in height mode (Tracking Time derived); with the Roll-in Altitude LOCK (0.1.2) the
// Release Altitude is searched instead (Roll-in held, Tracking Time derived). Level delivery (BDP
// solves it from Tracking Time; reported by BDP's resolvedSolveMode): every whole Tracking Time from
// 1 to 60 sec is evaluated in time mode. Only non-INVALID candidates within tolerance are solutions;
// the smallest |residual| wins, a tie goes to the value closest to the current input. 60 sec and
// 45000 ft are this solve's search bounds, not BDP limits.
function solvePair({ number, leadNumber, angleInput, follower, leaderResult, sameTimeAsLead, rangeLock, rollInLocked }) {
  const config = OFFSET_FLIGHT_PAIR_SOLVE;
  const { values: v, state: s } = follower;
  const { attackHeadingDeg, angleOffDeg } = angleInput.locks;
  const fixedInput = { ...angleInput, driver: "offsetAngleDeg", locks: { offsetAngleDeg: true, attackHeadingDeg: !!attackHeadingDeg, angleOffDeg: !!angleOffDeg } };
  const rangeLabel = rangeLock === "approachRangeNm" ? "Approach Range" : "Action Range";
  const target = sameTimeAsLead ? signedIngressSec(leaderResult) : angleInput[rangeLock];
  if (!isNumber(target)) throw new TypeError(sameTimeAsLead ? `#${leadNumber} Action time is not available` : `${rangeLock} must be numeric`);
  const metric = sameTimeAsLead ? signedIngressSec : (result) => result.resolved[rangeLock];
  const tolerance = sameTimeAsLead ? config.timeToleranceSec : config.actionToleranceNm;
  const unit = sameTimeAsLead ? "sec" : "NM";
  const field = sameTimeAsLead ? "ingressSec" : rangeLock;
  const what = sameTimeAsLead ? `#${leadNumber}'s Action time` : `the locked ${rangeLabel}`;
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
  const rollIn = requireNumber("rollInAltitudeMslFt", v.rollInAltitudeMslFt);
  const trackingTimeSec = Math.max(1, Math.round(fixedInput.profile.trackingTimeSec) || 1);
  // The searched variable: Roll-in Altitude (Release held) or, under the Roll-in LOCK, Release
  // Altitude (Roll-in held). Each candidate is a height-mode solve (Tracking Time derived).
  const variable = rollInLocked ? "releaseAltitudeMslFt" : "rollInAltitudeMslFt";
  const minValue = rollInLocked ? fixedInput.profile.targetElevationMslFt + config.altitudeAboveReleaseFt : release + config.altitudeAboveReleaseFt;
  const maxValue = rollInLocked ? rollIn - config.altitudeAboveReleaseFt : config.maxAltitudeMslFt;
  const currentValue = rollInLocked ? release : v.rollInAltitudeMslFt;
  const overrideOf = (value) => (rollInLocked
    ? { solveMode: "height", initialAltitudeMslFt: rollIn, releaseAltitudeMslFt: value, trackingTimeSec }
    : { solveMode: "height", initialAltitudeMslFt: value, trackingTimeSec });

  // Probe: BDP decides whether this is a level delivery (the altitudes are then not free).
  const values = [];
  if (maxValue > minValue) {
    const step = (maxValue - minValue) / config.altitudeSteps;
    for (let index = 0; index <= config.altitudeSteps; index += 1) values.push(minValue + step * index);
  }
  const probeValues = [isNumber(currentValue) && currentValue >= minValue && currentValue <= maxValue ? currentValue : null, ...values].filter((value) => value !== null);
  let probe = null;
  for (const value of probeValues) { probe = sample(overrideOf(value), value); if (probe) break; }
  if (!probe) {
    return { solved: false, failure: `CONSTRAINT CONFLICT: no ${rollInLocked ? "Release Altitude" : "Roll-in entry"} candidate could be evaluated${errors.size ? ` (cause: ${candidateFailureCause(errors)})` : ""}`, best: null, target, tolerance, unit, field, variable };
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
    if (rollInLocked) {
      return { solved: false, failure: "CONSTRAINT CONFLICT: Roll-in Altitude LOCK cannot combine with a fixed Offset Angle and Action in a level delivery (only Tracking Time can move)", best: null, target, tolerance, unit, field, variable: "trackingTimeSec", evaluations };
    }
    const currentTt = s.solveMode === "time" ? v.trackingTimeSec : s.enteredTrackingTimeSec;
    for (let tt = config.minTrackingTimeSec; tt <= config.maxTrackingTimeSec; tt += 1) consider(sample({ solveMode: "time", trackingTimeSec: tt }, tt), currentTt);
    const range = `${config.minTrackingTimeSec}-${config.maxTrackingTimeSec} sec`;
    if (match) return { solved: true, result: match.result, value: match.value, residual: match.residual, variable: "trackingTimeSec", target, tolerance, unit, field, evaluations };
    return { solved: false, failure: `CONSTRAINT CONFLICT: no whole Tracking Time (${range}) at this Offset Angle and level delivery matches ${what}${best ? `; best residual ${best.residual.toFixed(3)} ${unit} at ${best.value} sec` : ""}`, best: best ?? bestAny, target, tolerance, unit, field, variable: "trackingTimeSec", evaluations };
  }

  // Altitude scan (height mode), brackets between successive evaluated candidates (a rejected
  // candidate is a gap that is not bridged; INVALID candidates take part in bracketing because a root
  // often sits on a validity boundary, but are never a solution), every bracket refined.
  if (!values.includes(probe.value)) consider(probe, currentValue);
  let previous = null;
  const brackets = [];
  for (const value of values) {
    const item = value === probe.value ? probe : sample(overrideOf(value), value);
    consider(item, currentValue);
    if (!item) { previous = null; continue; }
    if (previous && previous.residual * item.residual <= 0) brackets.push({ lo: previous, hi: item });
    previous = item;
  }
  for (const bracket of brackets) {
    let { lo, hi } = bracket;
    if ((lo.usable && Math.abs(lo.residual) <= tolerance) || (hi.usable && Math.abs(hi.residual) <= tolerance)) continue;
    for (let index = 0; index < config.refineIterations; index += 1) {
      const mid = sample(overrideOf((lo.value + hi.value) / 2), (lo.value + hi.value) / 2);
      if (!mid) break;
      consider(mid, currentValue);
      if (mid.usable && Math.abs(mid.residual) <= tolerance) break;
      if (lo.residual * mid.residual <= 0) hi = mid;
      else lo = mid;
    }
  }
  if (match) return { solved: true, result: match.result, value: match.value, residual: match.residual, variable, target, tolerance, unit, field, evaluations };
  const searched = rollInLocked
    ? `no Release Altitude (${Math.round(minValue)}-${Math.round(maxValue)} ft) under the locked Roll-in Altitude`
    : `no Roll-in Altitude (${Math.round(minValue)}-${maxValue} ft)`;
  const remedy = rollInLocked ? "change this aircraft's Roll-in Altitude or Dive Angle, or free its Offset Angle" : "change this aircraft's Dive Angle or free its Offset Angle";
  return {
    solved: false,
    failure: `CONSTRAINT CONFLICT: ${searched} at this Offset Angle and Dive Angle matches ${what}; ${remedy}${best ? ` (best residual ${best.residual.toFixed(3)} ${unit})` : ""}`,
    best: best ?? bestAny,
    target, tolerance, unit, field, variable, evaluations,
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
  const { follower, leaderResult, leadNumber, sameAngleAsLead, sameTimeAsLead, offsetAngleLocked, actionRangeLocked, approachRangeLocked, plainDriver, branch } = context;
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
  if (approachRangeLocked && !sameTimeAsLead) push("approachRangeNm", v.approachRangeNm, r.approachRangeNm, pairTolerance && !actionRangeLocked ? OFFSET_FLIGHT_PAIR_SOLVE.actionToleranceNm : 0.002, "NM", "LOCK conflict: Approach Range cannot be satisfied");
  else if (branch === "plain" && plainDriver === "approachRangeNm") push("approachRangeNm", v.approachRangeNm, r.approachRangeNm, 0.002, "NM", "Approach Range root not found");
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

// Next follower state: what the solve held keeps its entered value (LOCK targets, the plain-path
// range or Offset Angle driver, the Attack Heading / Angle-Off the heading rule held); every other
// tactical value is written back from the result (Angle #n writes the element lead's angle, Time #n
// and the range a fixed Offset Angle moved their solved values). Inherited (null) values stay null.
function followerHeldKeys(context) {
  const held = new Set();
  const { branch, plainDriver, headingDriver, sameAngleAsLead, offsetAngleLocked, actionRangeLocked, approachRangeLocked, attackHeadingLocked, angleOffLocked } = context;
  if (offsetAngleLocked) held.add("offsetAngleDeg");
  if (actionRangeLocked) held.add("actionRangeNm");
  if (approachRangeLocked) held.add("approachRangeNm");
  if (attackHeadingLocked) held.add("attackHeadingDeg");
  if (angleOffLocked) held.add("angleOffDeg");
  let offsetFromHeadings = false;
  if (branch === "plain") {
    if (plainDriver === "offsetAngleDeg" && !sameAngleAsLead) held.add("offsetAngleDeg");
    if (plainDriver === "actionRangeNm" || plainDriver === "approachRangeNm") held.add(plainDriver);
    // No fixed Offset Angle and no range: the Offset Angle comes from both headings as entered.
    offsetFromHeadings = !offsetAngleLocked && !sameAngleAsLead && plainDriver !== "offsetAngleDeg" && plainDriver !== "actionRangeNm" && plainDriver !== "approachRangeNm";
  }
  if (offsetFromHeadings) { held.add("attackHeadingDeg"); held.add("angleOffDeg"); }
  else if (angleOffLocked || (!attackHeadingLocked && headingDriver === "angleOffDeg")) { if (!attackHeadingLocked) held.add("angleOffDeg"); }
  else held.add("attackHeadingDeg");
  return held;
}

function deriveFollowerNext(follower, result, context, pair, derived) {
  const { values: v } = follower;
  const r = result.resolved;
  const held = followerHeldKeys(context);
  for (const key of ["offsetAngleDeg", "actionRangeNm", "approachRangeNm", "attackHeadingDeg", "angleOffDeg"]) {
    if (held.has(key) || !isNumber(r[key])) continue;
    v[key] = r[key];
    derived.add(key);
  }
  const p = result.profile.public;
  if (pair?.solved) {
    // The searched altitude and Tracking Time were solved together; the entered Tracking Time
    // history and the stored solve mode are unchanged. Under the Roll-in LOCK the Release Altitude
    // moved and the Roll-in Altitude keeps its entered value.
    if (pair.variable === "releaseAltitudeMslFt") { v.releaseAltitudeMslFt = pair.value; derived.add("releaseAltitudeMslFt"); }
    else if (isNumber(p.resolvedInitialAltitudeMslFt)) { v.rollInAltitudeMslFt = p.resolvedInitialAltitudeMslFt; derived.add("rollInAltitudeMslFt"); }
    if (isNumber(p.trackingTimeSec)) { v.trackingTimeSec = p.trackingTimeSec; derived.add("trackingTimeSec"); }
    deriveRollInBank(follower, result, derived);
  } else {
    deriveProfileValues(follower, result, derived);
  }
  syncLinkedInitial(follower, derived);
}

// leaderResult / flightLead are the element lead's and #1's leaderView(): the only part of their
// Full results a follower reads (also its reuse dependency, see calculateFlight).
function solveFollower({ number, follower, stateError, leaderResult, flightLead, flightLeadValues }) {
  const leadNumber = OFFSET_FLIGHT_ELEMENT_LEAD[number];
  const derived = new Set();
  const base = { aircraft: number, elementLead: leadNumber, predecessor: number - 1, pairSolved: false, solvedVariable: null, inheritance: null, derived };
  const fail = (message, extra = {}) => ({ ...base, status: "FAILED", result: null, error: message, errors: [message], warnings: [], diagnostics: [], ...extra });
  if (!follower) return fail(`Aircraft #${number} input is missing`);
  if (stateError) return fail(stateError);
  // A leader without a result in this call fails its followers (never an earlier result).
  if (!leaderResult) return fail(`Aircraft #${leadNumber} has no current result`);
  let context;
  try {
    const built = followerOffsetInput({ number, follower, leaderResult, leadNumber, flightLead, flightLeadValues, ipLimitPoint: flightLead.geometry.points.ip });
    const { baseInput, angleInput, sameTimeAsLead, actionRangeLocked, approachRangeLocked, angleFixed, rangeLock } = built;
    const actionFixed = sameTimeAsLead || !!rangeLock;
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
    if (context.branch === "pair" && actionRangeLocked && approachRangeLocked) {
      return fail("CONSTRAINT CONFLICT: Action Range and Approach Range LOCKs cannot both hold with a fixed Offset Angle (only the Roll-in entry moves); unlock one of them", { inheritance: built.inheritance });
    }
    if (context.branch === "pair") {
      // Roll-in Altitude LOCK (0.1.2): the search moves Release Altitude instead of Roll-in Altitude.
      pair = solvePair({ number, leadNumber, angleInput, follower, leaderResult, sameTimeAsLead, rangeLock, rollInLocked: follower.options.rollInAltitudeLocked });
      if (!pair.solved) {
        return fail(pair.failure, { inheritance: built.inheritance, diagnostics: followerDiagnostics(number, context, null, pair), diagnosticCandidate: pair.best?.result ?? null });
      }
      result = pair.result;
    } else if (context.branch === "sameTime") {
      // Time #n alone: same IP -> Action time as the element lead; the free Offset Angle re-solves.
      const sameTimeAt = (releaseAltitudeMslFt) => solveElementSameTimeActionRange({
        leaderResult,
        followerLocks: baseInput.locks,
        evaluate: (actionRangeFromIpNm) => calculateOffAxisOffsetFull({ ...atRelease(baseInput, releaseAltitudeMslFt), driver: "actionRangeFromIpNm", locks: { offsetAngleDeg: false, attackHeadingDeg: baseInput.locks.attackHeadingDeg, angleOffDeg: baseInput.locks.angleOffDeg }, actionRangeFromIpNm }),
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

// Applies the one-shot edit events in the order they happened. `edit` (one event) and `edits` (the
// ordered events of one coalesced FE request, addendum P4-B) are the same contract: each event is a
// state transition on the record left by the previous one, then the final state is solved once.
function flightEdits(input) {
  if (input.edit && input.edits) throw new TypeError("input carries both edit and edits; send one ordered edits list");
  if (input.edits !== undefined && !Array.isArray(input.edits)) throw new TypeError("edits must be an array");
  return input.edits ?? (input.edit ? [input.edit] : []);
}

// A Run-In edit (2026-10-22, owner) turns the whole attack geometry about the Target, and only the
// Run-In edit does so. Every absolute direction moves by the Run-In change: each Attack Heading (#1
// and every follower record), the VRP and VIP bearings (so the references and the DED pages keep
// their place along the attack) and a locked IP's bearing. LOCKed ones move too and stay LOCKed
// (owner: the Run-In edit is the one exception; the LOCKs hold the turned values), and the driver
// is kept, so the same relative problem is solved on the new axis: Offset Angle, Angle-Off, the
// formation (relative to the Run-In) and, without wind, every range and time are unchanged. The
// change is taken from #1 state.runInBaseDeg (the last solved Run-In, carried in nextInput) and the
// base moves with it, so the events of one coalesced request, which all see the final Run-In, turn
// it once. Without a base (a record from before 0.1.7): the Run-In before the edit
// (`previousValue`; an IP Bearing edit's own record). state.runInTurnDeg adds up the turns (only
// these), for the S&R plan. Not turned: the true wind (owner) and a VRP Bearing edit (it is not a
// Run-In edit).
const RUN_IN_EDIT_KEYS = new Set(["runInHeadingDeg", "ipBearingDeg"]);
function turnWithRunIn(aircraft, edit, runInBefore) {
  const lead = aircraft[1];
  const { values: v, state: s, locks } = lead;
  if (!isNumber(v.runInHeadingDeg)) return;
  const fallback = edit.key === "ipBearingDeg" ? runInBefore : edit.previousValue;
  const base = isNumber(s.runInBaseDeg) ? s.runInBaseDeg : isNumber(fallback) ? norm(fallback) : null;
  const runIn = norm(v.runInHeadingDeg);
  s.runInBaseDeg = runIn;
  if (base === null || runIn === base) return;
  const turn = (values, key) => {
    if (isNumber(values[key])) values[key] = norm(values[key] + runIn - base);
  };
  s.runInTurnDeg = norm((isNumber(s.runInTurnDeg) ? s.runInTurnDeg : 0) + runIn - base);
  turn(v, "attackHeadingDeg");
  turn(v, "vrpBearingDeg");
  turn(v, "vipToTargetBearingDeg");
  // An IP Bearing edit already set the locked IP's bearing to its value.
  if (locks.ipReference && edit.key === "runInHeadingDeg") turn(s, "ipLockHeadingDeg");
  for (const number of FOLLOWERS) {
    const follower = aircraft[number];
    if (follower && !follower.raw) turn(follower.values, "attackHeadingDeg");
  }
}

function applyEdits(aircraft, edits) {
  const editErrors = {};
  for (const edit of edits) {
    const number = edit?.aircraft ?? 1;
    if (!aircraft[number]) throw new TypeError(`edit targets missing aircraft #${number}`);
    // An aircraft whose state cannot be read, or whose earlier event failed, takes no further event.
    if (aircraft[number].raw || editErrors[number]) continue;
    try {
      if (number === 1) {
        const runInBefore = aircraft[1].values.runInHeadingDeg;
        applyLeadEdit(aircraft[1], edit);
        if (RUN_IN_EDIT_KEYS.has(edit.key) && (edit.kind === "set" || edit.kind === "clear")) turnWithRunIn(aircraft, edit, runInBefore);
      } else applyFollowerEdit(aircraft[number], edit, number);
    } catch (error) {
      editErrors[number] = error.message;
    }
  }
  return editErrors;
}

// What a follower reads from an aircraft before it (its element lead, and #1 for the Flight-wide
// Target / wind / IP limit / VIP): resolved values, timing, geometry points, reference mode and the
// BDP inputs it inherits. Followers are given only this, so it is exactly their dependency.
const LEADER_PROFILE_KEYS = [...OFFSET_FLIGHT_INHERITED_KEYS, ...OFFSET_FLIGHT_INHERITED_TEXT_KEYS, ...OFFSET_FLIGHT_INHERITED_OPTIONAL_KEYS, "targetElevationMslFt", "windSpeedKt", "fragmentMarginAppliesTo"];
function leaderView(result) {
  if (!result) return null;
  const inputs = result.profile.canonicalInputs;
  return {
    referenceMode: result.referenceMode,
    resolved: result.resolved,
    timing: result.timing,
    geometry: { points: result.geometry.points },
    profile: { canonicalInputs: Object.fromEntries(LEADER_PROFILE_KEYS.map((key) => [key, inputs[key]])) },
  };
}

// ---- Per-aircraft reuse (addendum P3) ---------------------------------------------------------
// One aircraft's heavy solve is a pure function of: its own record after this call's edit events
// (values, LOCKs / options, formation, solve mode, driver, entry history, inherited/explicit state),
// its state error, and what it reads from the aircraft before it: leaderView() of #1 and of its
// element lead (#3 for #4) and #1's Wind Direction. The key below is exactly that (exact
// serialization), plus the model versions, so a reused solve is the one a fresh solve would return.
// Anything else changed: solved again. A failure is reused only for the identical input, never an
// earlier success for a changed one.
const SOLVE_MODEL_KEY = calculationKey({
  flight: OFFSET_FLIGHT_V0_1,
  bdp: BOMB_DELIVERY_PLANNER_MODEL_V0_4,
});

function aircraftSolveKey(number, record, stateError, leaders) {
  return calculationKey({ model: SOLVE_MODEL_KEY, number, record, stateError: stateError ?? null, leaders });
}

// solve() returns { entry, record }: the aircraft's result entry and its record after the solve.
function reusedSolve(session, keyOf, solve) {
  const memo = session?.solves;
  if (!memo) return { ...solve(), reused: false };
  const key = keyOf();
  const stored = memo.get(key);
  if (stored) {
    memo.delete(key);
    memo.set(key, stored);
    return { ...structuredClone(stored), reused: true };
  }
  const solved = solve();
  memo.set(key, structuredClone(solved));
  while (memo.size > session.solveLimit) memo.delete(memo.keys().next().value);
  return { ...solved, reused: false };
}

// A follower value typed in this call that its holds then replaced (2026-10-12): reported as a
// warning instead of silently overwritten (e.g. an Action Range under an Offset Angle LOCK, or a
// Tracking Time while Offset Angle and Action are both fixed).
const TYPED_KEPT_CHECK = Object.freeze({
  offsetAngleDeg: { label: "Offset Angle", unit: "deg", digits: 0, tolerance: 0.5 },
  attackHeadingDeg: { label: "Attack Heading", unit: "deg", digits: 0, tolerance: 0.5, wrap: true },
  angleOffDeg: { label: "Angle-Off", unit: "deg", digits: 0, tolerance: 0.5 },
  actionRangeNm: { label: "Action Range", unit: "NM", digits: 1, tolerance: 0.05 },
  approachRangeNm: { label: "Approach Range", unit: "NM", digits: 1, tolerance: 0.05 },
  trackingTimeSec: { label: "Tracking Time", unit: "sec", digits: 1, tolerance: 0.05 },
  rollInAltitudeMslFt: { label: "Roll-in Altitude", unit: "ft", digits: 0, tolerance: 0.5 },
  releaseAltitudeMslFt: { label: "Release Altitude", unit: "ft", digits: 0, tolerance: 0.5 },
});

function followerHolds(follower, number) {
  const o = follower.options;
  const lead = OFFSET_FLIGHT_ELEMENT_LEAD[number];
  const wingman = WINGMEN.has(number);
  return [
    wingman && o.sameAngleAsLead && `Angle #${lead}`, o.offsetAngleLocked && "Offset Angle LOCK",
    wingman && o.sameTimeAsLead && `Time #${lead}`, o.actionRangeLocked && "Action Range LOCK", o.approachRangeLocked && "Approach Range LOCK",
    o.attackHeadingLocked && "Attack Heading LOCK", o.angleOffLocked && "Angle-Off LOCK", o.rollInAltitudeLocked && "Roll-in Altitude LOCK",
  ].filter(Boolean);
}

function typedEntries(aircraft, edits) {
  const typed = {};
  for (const edit of edits) {
    const number = edit?.aircraft ?? 1;
    if (number === 1 || edit.kind !== "set" || !TYPED_KEPT_CHECK[edit.key] || aircraft[number]?.raw) continue;
    const values = aircraft[number]?.values;
    const value = edit.key === "trackingTimeSec" ? aircraft[number].state.enteredTrackingTimeSec : values?.[edit.key];
    if (isNumber(value)) typed[number] = { key: edit.key, value };
  }
  return typed;
}

function typedNotKeptWarning(number, follower, entry, typed) {
  if (!typed || !entry.result) return null;
  const check = TYPED_KEPT_CHECK[typed.key];
  const now = follower.values[typed.key];
  if (!isNumber(now)) return null;
  const difference = check.wrap ? ((now - typed.value + 540) % 360) - 180 : now - typed.value;
  if (Math.abs(difference) <= check.tolerance) return null;
  const holds = followerHolds(follower, number);
  const text = (value) => `${value.toFixed(check.digits)} ${check.unit}`;
  const lockHint = ["offsetAngleDeg", "actionRangeNm", "approachRangeNm"].includes(typed.key) && holds.length ? "; LOCK it too to move the Roll-in entry instead" : "";
  return `${check.label} ${text(typed.value)} not kept (now ${text(now)}): it is solved from ${holds.length ? holds.join(", ") : "the other entries"}${lockHint}`;
}

function calculateFlight(input, session) {
  const { flightSize, aircraft, stateErrors } = normalizeFlightInput(input);
  const edits = flightEdits(input);
  const editErrors = applyEdits(aircraft, edits);
  const typed = typedEntries(aircraft, edits);

  const results = {};
  const views = {};
  const solveLog = {};
  const errorOf = (number) => stateErrors[number] ?? editErrors[number];
  const lead = reusedSolve(session, () => aircraftSolveKey(1, aircraft[1], errorOf(1), null), () => {
    const entry = solveLead(aircraft[1], errorOf(1));
    return { entry, record: aircraft[1] };
  });
  aircraft[1] = lead.record;
  results[1] = lead.entry;
  views[1] = leaderView(results[1].result);
  solveLog[1] = lead.reused ? "reused" : "solved";
  const flightLeadValues = { windDirectionDeg: aircraft[1].values?.windDirectionDeg };
  for (const number of FOLLOWERS) {
    if (number > flightSize) continue;
    const leadNumber = OFFSET_FLIGHT_ELEMENT_LEAD[number];
    const leaderResult = views[leadNumber] ?? null;
    const keyOf = () => aircraftSolveKey(number, aircraft[number] ?? null, errorOf(number), { flightLead: views[1], flightLeadValues, elementLead: leaderResult });
    const solved = reusedSolve(session, keyOf, () => {
      const entry = solveFollower({ number, follower: aircraft[number], stateError: errorOf(number), leaderResult, flightLead: views[1], flightLeadValues });
      return { entry, record: aircraft[number] ?? null };
    });
    if (solved.record) aircraft[number] = solved.record;
    results[number] = solved.entry;
    const notKept = solved.record ? typedNotKeptWarning(number, solved.record, solved.entry, typed[number]) : null;
    // A copy: the solved entry may be kept for reuse by the next call.
    if (notKept) results[number] = { ...solved.entry, warnings: [notKept, ...solved.entry.warnings], status: solved.entry.status === "VALID" ? "WARNING" : solved.entry.status };
    views[number] = leaderView(results[number].result);
    solveLog[number] = solved.reused ? "reused" : "solved";
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
    if (number === 1 && nextAircraft[1] && !aircraft[1].raw) nextAircraft[1].lockSolvedKeys = leadLockSolvedKeys(aircraft[1].locks);
    aircraftResults[number] = { ...rest, ded: entry.ded ?? null };
    constraintDiagnostics.push(...diagnostics);
  }
  const output = {
    model: { ...OFFSET_FLIGHT_V0_1, components: { ...OFFSET_FLIGHT_V0_1.components } },
    flightSize,
    aircraftResults,
    constraintDiagnostics,
    flightTiming: flightTiming(flightSize, results),
    nextInput: { schemaVersion: OFFSET_FLIGHT_V0_1.schemaVersion, flightSize, aircraft: nextAircraft },
  };
  return { output, solveLog };
}

// Pure reference entrypoint: every call starts from nothing (no state survives between calls).
// Inside the call, identical BDP / SEM / trajectory sub-solves are computed once (P1/P2).
export function calculateOffsetFlightFull(input) {
  const cache = createCalculationCache();
  return withCalculationCache(cache, () => calculateFlight(input, null)).output;
}

// Verification reference (addendum P04): the same calculation with no reuse of any kind.
export function calculateOffsetFlightReferenceFull(input) {
  return withCalculationCache(null, () => calculateFlight(input, null)).output;
}

// Editing session (addendum P3): the same contract as calculateOffsetFlightFull, for the repeated
// calls of one editing page. The BE keeps, inside the session object only, the sub-solves and each
// aircraft's last solves keyed by their full dependencies, so a call re-solves only the aircraft
// whose dependencies changed. Its output equals calculateOffsetFlightFull(input) for every input
// (offset-flight-session-v0.1.test.mjs). The FE holds the session as an opaque handle (in the Worker).
export function createOffsetFlightSession({ solveLimit = 48, cacheLimits = { "bdp-v0.4": 2048, "ballistic-trajectory": 2048, "sem-nlt": 64 } } = {}) {
  const session = { solves: new Map(), solveLimit, cache: createCalculationCache({ limits: cacheLimits }) };
  let last = null;
  return Object.freeze({
    calculate(input) {
      const before = snapshotCalculationCacheStats(session.cache);
      const started = performance.now();
      const { output, solveLog } = withCalculationCache(session.cache, () => calculateFlight(input, session));
      last = { solveLog, subSolves: calculationCacheStats(session.cache, before), beMs: performance.now() - started };
      return output;
    },
    // Idle-time preparation: the page sends each returned state back as its next input, and a
    // record a solve just wrote its derived values into is a new input once (see P03 test). Solving
    // that returned state ahead of time (output discarded, counters untouched) makes the page's next
    // request reuse it. Returns which aircraft it solved.
    prepare(nextInput) {
      const { solveLog } = withCalculationCache(session.cache, () => calculateFlight(nextInput, session));
      return solveLog;
    },
    // Counters of the last calculate(): which aircraft were solved or reused, BDP / SEM / trajectory
    // calls, hits and misses (real executions), and the BE time. Diagnostics only, not output.
    lastStats() {
      return last && structuredClone(last);
    },
    clear() {
      session.solves.clear();
      session.cache = createCalculationCache({ limits: cacheLimits });
      last = null;
    },
  });
}

// Public entrypoint: results truncated to 5 decimals (docs/FE-BE-RULES.md). It carries no nextInput:
// the next input state is continued only from calculateOffsetFlightFull, so truncated numbers are
// never fed back into a calculation.
export function calculateOffsetFlight(input) {
  const { nextInput, ...rest } = calculateOffsetFlightFull(input);
  return truncateBeOutput(rest);
}
