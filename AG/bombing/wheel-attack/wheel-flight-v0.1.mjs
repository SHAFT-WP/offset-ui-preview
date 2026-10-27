import { WHEEL_BOX_BE_MODEL_V0_10, calculateWheelBoxV0_10Full } from "./wheel-box-be-v0.10.mjs";
import { FRAGMENT_MARGIN_MODES, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { createCalculationCache, withCalculationCache } from "../../../common/calculation/calculation-cache-v0.1.mjs";
// The flight-level mechanics (Flight structure, input records, edit events, per-aircraft reuse, editing session,
// drop-order walk) are Flight Bombing Tactics'; this entrypoint gives them the Wheel meaning.
import {
  aircraftSolveKey as flightSolveKey, applyFlightEdits, createFlightSession, flightEditEvents, readFlightRecords, reusedSolve,
} from "../../../flight/flight-bombing-tactics/flight-composition-v0.1.mjs";

// Wheel Flight entrypoint (Wheel SPEC "Wheel Flight entrypoint and the Wheel page BE", owner 2026-10-25: the Wheel page
// as BOX's). One call takes the whole Flight input state and returns every aircraft's Full Wheel-BOX v0.10 result, its
// DED pages (OA1, OA2) and the next input state. It has the BOX / Offset Flight entrypoint's shape, so the Wheel page
// uses the same Flight host, Worker and session:
//   { schemaVersion?, flightSize, aircraft: { 1: { values, locks, state }, 2–4: { formation } }, edit? | edits? }
// The BDP Profile edit rules are BOX's (one BDP list): a Tracking Time entry solves the Roll-in Altitude ("time"), a
// Roll-in / Release Altitude entry solves the Tracking Time ("height"), and with the Roll-in Altitude LOCK a Tracking
// Time entry moves the Release Altitude ("release"); Initial Altitude may be LINKED to the Roll-in Altitude. Wheel's
// turn conditions and Roll-in values stay in Wheel.
// Wheel Radius: blank / cleared = MIN (the smallest radius that flies the route, written back); a typed value = MANUAL.
// Formation: #1–#4 fly the same Wheel data, #1's; a follower record holds only its Formation position (BOX's rule),
// laid off from #1's Abeam on the Downwind heading, on the pattern side (RIGHT / LEFT).
// Pure: no DOM, window, storage or FE import; the input is never mutated; the same input gives the same output.
// 0.2.0 (2026-10-26, Wheel-BOX handoff): on Wheel-BOX v0.9 — Downwind Angle fixed at 0° (a non-zero value of an older
// record becomes 0° with a warning, and leaves the record), Base Turn G the requested G (≤ 3 G; the G flown is the
// result's, never written back), Min Wheel Radius v0.9's, every BDP weapon flown.
// 0.3.0 (2026-10-26, owner): on Wheel-BOX v0.10 — the Return after a CSEM back into the Wheel at Abeam (Return Turn G;
// the Join G and the Extension are the result's, never written back); a new aircraft's SEM End is CLIMB (CSEM), as the
// Return starts at the CSEM End. A saved record keeps its SEM End; a blank Return Turn G is the BE default. A new
// aircraft's Initial Speed is 300 KCAS (owner: "휠박스의 디폴트 속도는 300이 적당할 듯"); DED OA2 is the Base Turn start.
export const WHEEL_FLIGHT_V0_1 = Object.freeze({
  id: "wheel-flight-v0.1",
  version: "0.3.0",
  status: "work",
  schemaVersion: 1,
  components: Object.freeze({ wheelComposition: WHEEL_BOX_BE_MODEL_V0_10.version }),
});

// Defaults of a new Wheel aircraft (the page's Default and each Tab Default return to these). The BDP values are BOX's
// (one BDP list) but the Initial Speed, 300 KCAS (owner 2026-10-26); the Wheel values: Attack Heading 000, RIGHT, Wheel Radius MIN, Base Turn G 2 (owner 2026-10-25:
// Base / Crosswind Turn 2 G; the requested G). The Downwind Angle is not a value: v0.9 fixes it at 0°. A blank optional
// value (Wheel turn Speed / Altitude, Orbit, SEM Turn G / Speed / Direction) is the BE's default; without an Orbit
// Radius there is no Orbit.
export const WHEEL_FLIGHT_DEFAULT_VALUES = Object.freeze({
  weaponId: "M82",
  targetElevationMslFt: 31,
  windDirectionDeg: 0,
  windSpeedKt: 0,
  initialSpeedValue: 300,
  initialSpeedMode: "CAS",
  initialAltitudeMslFt: 16000,
  rollInAltitudeMslFt: 16000,
  diveAngleDeg: 45,
  trackingTimeSec: 18,
  releaseAltitudeMslFt: 6800,
  releaseSpeedKcas: 450,
  rollInG: 4,
  rollInRollRateDegSec: ROLL_IN_ONSET_DEFAULTS.rollInRollRateDegSec,
  rollOutRollRateDegSec: ROLL_IN_ONSET_DEFAULTS.rollOutRollRateDegSec,
  gOnsetRateGSec: ROLL_IN_ONSET_DEFAULTS.gOnsetRateGSec,
  semEnd: "CLIMB",
  csemTargetFpaDeg: 30,
  recoveryG: 5,
  gOnsetTimeSec: 2,
  speedOvershootKcas: 50,
  fragmentHeightMarginPercent: 20,
  semTurnType: "LEVEL",
  semTurnDirection: null,
  semTurnDeg: 90,
  semTurnG: null,
  semTurnSpeedKcas: null,
  semTurnBankDeg: 85,
  attackHeadingDeg: 0,
  direction: "RIGHT",
  wheelRadiusNm: null,
  baseTurnG: 2,
  wheelSpeedKcas: null,
  wheelAltitudeMslFt: null,
  orbitRadiusNm: null,
  orbitSpeedKcas: null,
  orbitAltitudeMslFt: null,
  returnTurnG: WHEEL_BOX_BE_MODEL_V0_10.defaultReturnTurnG,
});
// The Wheel options a blank leaves to the BE.
const WHEEL_OPTION_KEYS = Object.freeze(["wheelSpeedKcas", "wheelAltitudeMslFt", "orbitRadiusNm", "orbitSpeedKcas", "orbitAltitudeMslFt"]);
export const WHEEL_FLIGHT_DEFAULT_STATE = Object.freeze({
  solveMode: "height",
  rollInAltitudeLinked: true,
  enteredTrackingTimeSec: 18,
  wheelRadiusSource: "MIN",
  fragmentMarginAppliesTo: "HEIGHT_AND_RADIUS",
});
export function wheelFlightDefaultLead() {
  return { values: { ...WHEEL_FLIGHT_DEFAULT_VALUES }, locks: {}, state: { ...WHEEL_FLIGHT_DEFAULT_STATE } };
}

// Formation (Offset's Flight structure): the reference aircraft and the default (fingertip) position of each follower.
export const WHEEL_FLIGHT_FORMATION_REFERENCE = Object.freeze({ 2: 1, 3: 1, 4: 3 });
export const WHEEL_FLIGHT_FORMATION_DEFAULTS = Object.freeze({
  2: Object.freeze({ side: "LEFT", bearingDeg: 90, distanceNm: 1 }),
  3: Object.freeze({ side: "RIGHT", bearingDeg: 90, distanceNm: 2 }),
  4: Object.freeze({ side: "RIGHT", bearingDeg: 90, distanceNm: 1 }),
});
export function wheelFlightDefaultFollower(number) {
  const formation = WHEEL_FLIGHT_FORMATION_DEFAULTS[number];
  if (!formation) throw new RangeError("follower number must be 2, 3 or 4");
  return { formation: { ...formation } };
}
const FORMATION_KEYS = new Set(["side", "bearingDeg", "distanceNm"]);

// Keys a blank leaves to the BE (each one's default applies); every other numeric key is required.
const OPTIONAL_KEYS = new Set(["semTurnDirection", "semTurnG", "semTurnSpeedKcas", "wheelRadiusNm", ...WHEEL_OPTION_KEYS]);
const TEXT_CHOICES = Object.freeze({
  weaponId: null,
  initialSpeedMode: ["CAS", "MACH"],
  semEnd: ["LEVEL", "CLIMB"],
  semTurnType: ["LEVEL", "SLICE"],
  semTurnDirection: ["LEFT", "RIGHT"],
  direction: ["RIGHT", "LEFT"],
});
const LOCK_KEYS = new Set(["rollInAltitudeMslFt", "diveAngleDeg"]);
const WHEEL_RADIUS_SOURCES = new Set(["MIN", "MANUAL"]);
const FRAGMENT_MARGIN_MODE_SET = new Set(FRAGMENT_MARGIN_MODES);

// Tracking Time is entered in 0.1 s (the Offset page's step); BDP rounds the same.
export const WHEEL_FLIGHT_TRACKING_TIME_STEP_SEC = 0.1;
const roundTrackingTime = (value) => Math.round(value * 10) / 10;

// Roll-in Altitude LOCK with a Tracking Time entry: the Release Altitude that gives the entered Tracking Time from
// the held Roll-in Altitude. Wheel's BDP input does not depend on the pattern (Angle-Off fixed at 90°, wind relative to
// the Attack Heading), so the search runs on the BDP alone.
export const WHEEL_FLIGHT_RELEASE_SOLVE = Object.freeze({ toleranceFt: 0.01, acceptFt: 0.5, iterations: 40 });

const FT_PER_NM = 6076.11549;
const norm = (deg) => ((deg % 360) + 360) % 360;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const blank = (value) => value === null || value === undefined || value === "";

function requireNumber(key, value) {
  if (!isNumber(value)) throw new TypeError(`${key} must be numeric`);
  return value;
}

// ---- Input records ------------------------------------------------------------------------------------------------

function enumOr(name, value, allowed, fallback) {
  if (blank(value)) return fallback;
  if (!allowed.has(value)) throw new TypeError(`${name} "${value}" is not supported`);
  return value;
}

// "release" exists only while the Roll-in Altitude is LOCKed; without the LOCK it reads as "time".
function normalizeSolveMode(mode, rollInLocked) {
  if (mode === "release") return rollInLocked ? "release" : "time";
  return mode === "time" ? "time" : "height";
}

// A Downwind Angle of an older record (Wheel Flight 0.1) leaves the record: v0.9 flies 0°. A non-zero one is reported
// once, as a warning of the solve that read it (the next state no longer carries it).
function downwindNotices(values) {
  if (!Object.hasOwn(values, "downwindAngleDeg")) return [];
  const angle = values.downwindAngleDeg;
  delete values.downwindAngleDeg;
  return isNumber(angle) && angle !== 0 ? [`Downwind Angle ${angle}° of an earlier setting is now fixed at 0° (Wheel-BOX v0.9).`] : [];
}

function normalizeLead(record = {}) {
  if (!record || typeof record !== "object") throw new TypeError("aircraft[1] must be an object");
  const state = record.state ?? {};
  const values = { ...(record.values ?? {}) };
  const notices = downwindNotices(values);
  const locks = Object.fromEntries(Object.entries(record.locks ?? {}).filter(([key]) => LOCK_KEYS.has(key)).map(([key, on]) => [key, on === true]));
  const entered = blank(state.enteredTrackingTimeSec) ? WHEEL_FLIGHT_DEFAULT_STATE.enteredTrackingTimeSec : requireNumber("enteredTrackingTimeSec", state.enteredTrackingTimeSec);
  return {
    values,
    locks,
    notices,
    state: {
      solveMode: normalizeSolveMode(state.solveMode, locks.rollInAltitudeMslFt === true),
      rollInAltitudeLinked: state.rollInAltitudeLinked !== false,
      enteredTrackingTimeSec: roundTrackingTime(entered),
      wheelRadiusSource: enumOr("wheelRadiusSource", state.wheelRadiusSource, WHEEL_RADIUS_SOURCES, "MIN"),
      fragmentMarginAppliesTo: enumOr("fragmentMarginAppliesTo", state.fragmentMarginAppliesTo, FRAGMENT_MARGIN_MODE_SET, "HEIGHT_AND_RADIUS"),
    },
  };
}

// A follower holds only its Formation position (its Wheel data is #1's). A missing record is the default position.
function normalizeFollower(record = {}) {
  if (!record || typeof record !== "object") throw new TypeError("a follower record must be an object");
  const formation = record.formation ?? {};
  return { formation: { side: formation.side ?? null, bearingDeg: formation.bearingDeg ?? null, distanceNm: formation.distanceNm ?? null } };
}

function normalizeFlightInput(input) {
  return readFlightRecords(input, { schemaVersion: WHEEL_FLIGHT_V0_1.schemaVersion, normalizeLead, normalizeFollower });
}

// ---- One-shot edit events -----------------------------------------------------------------------------------------
// The page puts the typed value into the record and sends the event; its consequences (solve mode, LINK, Crosswind
// Radius source, a cleared field's default) are decided here and live on only through nextInput.

function lockedSolveMode(mode, on) {
  if (on) return mode === "time" ? "release" : mode;
  return mode === "release" ? "time" : mode;
}

// A typed Roll-in (or linked Initial) Altitude: height mode, except while Tracking Time and the Roll-in LOCK move the
// Release Altitude, which keeps doing so from the new Roll-in Altitude.
const rollInEditMode = (mode) => (mode === "release" ? "release" : "height");

function applyLeadEdit(lead, edit) {
  const { values: v, state: s, locks } = lead;
  const key = edit.key;
  if (edit.kind === "lock") {
    if (!LOCK_KEYS.has(key)) throw new TypeError(`LOCK "${key}" is not supported on Wheel #1`);
    locks[key] = edit.value === true;
    if (key === "rollInAltitudeMslFt") s.solveMode = lockedSolveMode(s.solveMode, locks[key]);
    return;
  }
  if (edit.kind === "toggle") {
    if (key !== "rollInAltitudeLinked") throw new TypeError(`toggle "${key}" is not supported on Wheel #1`);
    s.rollInAltitudeLinked = edit.value === true;
    // Turning LINK on shows the Roll-in Altitude as the Initial Altitude.
    if (s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) v.initialAltitudeMslFt = v.rollInAltitudeMslFt;
    return;
  }
  if (edit.kind === "clear") {
    // A cleared field takes its default (an optional one goes blank), with the LINK and solve-mode rules.
    let value = Object.hasOwn(WHEEL_FLIGHT_DEFAULT_VALUES, key) ? WHEEL_FLIGHT_DEFAULT_VALUES[key] : null;
    if (key === "rollInAltitudeMslFt" && s.solveMode !== "time" && s.rollInAltitudeLinked && isNumber(v.initialAltitudeMslFt)) value = Math.round(v.initialAltitudeMslFt);
    else if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) value = Math.round(v.rollInAltitudeMslFt);
    else if (key === "trackingTimeSec") s.solveMode = "height";
    else if (key === "wheelRadiusNm") s.wheelRadiusSource = "MIN";
    v[key] = value;
    return;
  }
  if (edit.kind !== "set") throw new TypeError(`edit kind "${edit.kind}" is not supported`);
  const value = v[key];
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
    s.solveMode = locks.rollInAltitudeMslFt ? "release" : "time";
    if (isNumber(value)) {
      s.enteredTrackingTimeSec = roundTrackingTime(value);
      v.trackingTimeSec = s.enteredTrackingTimeSec;
    }
  }
  // A typed Wheel Radius is kept as typed (MANUAL); a cleared one goes back to MIN.
  if (key === "wheelRadiusNm") s.wheelRadiusSource = isNumber(value) ? "MANUAL" : "MIN";
}

// A follower's Formation edit: the page puts the typed value into `formation`; a cleared field takes its default.
function applyFollowerEdit(follower, edit, number) {
  if (!FORMATION_KEYS.has(edit.key)) throw new TypeError(`"${edit.key}" is not a Formation field (#${number} flies #1's Wheel data)`);
  if (edit.kind === "clear") {
    follower.formation[edit.key] = WHEEL_FLIGHT_FORMATION_DEFAULTS[number][edit.key];
    return;
  }
  if (edit.kind !== "set") throw new TypeError(`edit kind "${edit.kind}" is not supported on #${number}`);
}

function applyEdits(aircraft, edits) {
  return applyFlightEdits(aircraft, edits, (number, edit) => {
    if (number === 1) applyLeadEdit(aircraft[1], edit);
    else applyFollowerEdit(aircraft[number], edit, number);
  });
}

// ---- #1 solve ------------------------------------------------------------------------------------------------------

function textChoice(key, value) {
  if (blank(value)) return OPTIONAL_KEYS.has(key) ? undefined : WHEEL_FLIGHT_DEFAULT_VALUES[key];
  const allowed = TEXT_CHOICES[key];
  if (allowed && !allowed.includes(value)) throw new TypeError(`${key} "${value}" is not supported`);
  return value;
}

function optionalNumber(key, value) {
  return blank(value) ? undefined : requireNumber(key, value);
}

// The BDP v0.4 input of one Wheel aircraft. Wind Direction is the true FROM direction, given to the BDP relative to the
// Attack Heading (the Offset page's conversion). The Wheel-BOX composition sets Angle-Off 90°.
function leadBdpInput(lead) {
  const { values: v, state: s } = lead;
  const n = (key) => requireNumber(key, v[key]);
  const attackHeadingDeg = norm(n("attackHeadingDeg"));
  const solveMode = s.solveMode;
  return {
    weaponId: textChoice("weaponId", v.weaponId),
    targetElevationMslFt: n("targetElevationMslFt"),
    releaseSpeedKcas: n("releaseSpeedKcas"),
    speedOvershootKcas: n("speedOvershootKcas"),
    fragmentHeightMarginPercent: n("fragmentHeightMarginPercent"),
    fragmentMarginAppliesTo: s.fragmentMarginAppliesTo,
    recoveryG: n("recoveryG"),
    gOnsetTimeSec: n("gOnsetTimeSec"),
    diveAngleDeg: n("diveAngleDeg"),
    windDirectionDeg: norm(n("windDirectionDeg") - attackHeadingDeg),
    windSpeedKt: n("windSpeedKt"),
    initialSpeedValue: n("initialSpeedValue"),
    initialSpeedMode: textChoice("initialSpeedMode", v.initialSpeedMode),
    // Roll-in Altitude is the BDP entry altitude (OA1); Initial Altitude is linked or reference only.
    initialAltitudeMslFt: n("rollInAltitudeMslFt"),
    solveMode: solveMode === "release" ? "time" : solveMode,
    // A Roll-in Altitude too low gives a negative Tracking Time, not an error (the Offset page's rule).
    allowNegativeTrackingTime: true,
    trackingTimeSec: solveMode === "time" ? n("trackingTimeSec") : s.enteredTrackingTimeSec,
    trackingTimeStepSec: WHEEL_FLIGHT_TRACKING_TIME_STEP_SEC,
    releaseAltitudeMslFt: n("releaseAltitudeMslFt"),
    rollInG: n("rollInG"),
    rollInRollRateDegSec: n("rollInRollRateDegSec"),
    rollOutRollRateDegSec: n("rollOutRollRateDegSec"),
    gOnsetRateGSec: n("gOnsetRateGSec"),
    semEnd: textChoice("semEnd", v.semEnd),
    csemTargetFpaDeg: n("csemTargetFpaDeg"),
    semTurnType: textChoice("semTurnType", v.semTurnType),
    semTurnDeg: n("semTurnDeg"),
    semTurnDirection: textChoice("semTurnDirection", v.semTurnDirection) ?? textChoice("direction", v.direction),
    semTurnG: optionalNumber("semTurnG", v.semTurnG),
    semTurnSpeedKcas: optionalNumber("semTurnSpeedKcas", v.semTurnSpeedKcas),
    semTurnBankDeg: n("semTurnBankDeg"),
  };
}

function leadWheelInput(lead, bombDeliveryInput) {
  const { values: v, state: s } = lead;
  const n = (key) => requireNumber(key, v[key]);
  const options = {};
  for (const key of WHEEL_OPTION_KEYS) {
    const value = optionalNumber(key, v[key]);
    if (value !== undefined) options[key] = value;
  }
  return {
    bombDeliveryInput,
    attackHeadingDeg: norm(n("attackHeadingDeg")),
    direction: textChoice("direction", v.direction),
    // MIN: the BE's radius (the record's value is the one it wrote back); MANUAL: the typed radius.
    wheelRadiusNm: s.wheelRadiusSource === "MANUAL" ? n("wheelRadiusNm") : null,
    baseTurnG: n("baseTurnG"),
    // The Return: a blank (or a record from before 0.3.0) is the BE default.
    returnTurnG: optionalNumber("returnTurnG", v.returnTurnG) ?? WHEEL_FLIGHT_DEFAULT_VALUES.returnTurnG,
    ...options,
  };
}

// "release" mode: the Release Altitude at which the time-mode BDP (entered Tracking Time) reaches the held Roll-in
// Altitude (secant on the BDP at the Wheel-BOX Angle-Off).
function solveReleaseAltitude(bombDeliveryInput) {
  const config = WHEEL_FLIGHT_RELEASE_SOLVE;
  const rollInAltitudeMslFt = bombDeliveryInput.initialAltitudeMslFt;
  const angleOffDeg = WHEEL_BOX_BE_MODEL_V0_10.fixedAngleOffDeg;
  const f = (releaseAltitudeMslFt) => calculateBombDeliveryV0_4Full({ ...bombDeliveryInput, angleOffDeg, solveMode: "time", releaseAltitudeMslFt }).public.resolvedInitialAltitudeMslFt - rollInAltitudeMslFt;
  const conflict = (belowNlt) => new Error(`CONSTRAINT CONFLICT: Roll-in Altitude LOCK: no Release Altitude gives Tracking Time ${bombDeliveryInput.trackingTimeSec} sec from Roll-in Altitude ${Math.round(rollInAltitudeMslFt)} ft${belowNlt ? " (Release would be below NLT; shorten Tracking Time or raise Roll-in Altitude)" : ""}`);
  let x0 = bombDeliveryInput.releaseAltitudeMslFt;
  let f0 = f(x0);
  if (Math.abs(f0) <= config.acceptFt) return x0;
  let x1 = x0 - f0;
  for (let index = 0; index < config.iterations; index += 1) {
    let f1;
    try { f1 = f(x1); } catch { break; }
    if (!isNumber(f1)) break;
    if (Math.abs(f1) <= config.toleranceFt) return x1;
    const slope = (f1 - f0) / (x1 - x0);
    if (!(slope > 1e-6)) break;
    x0 = x1;
    f0 = f1;
    x1 -= f1 / slope;
  }
  if (isNumber(f0) && Math.abs(f0) <= config.acceptFt) return x0;
  let belowNlt = false;
  try { belowNlt = f(bombDeliveryInput.targetElevationMslFt + 1) > 0; } catch { belowNlt = false; }
  throw conflict(belowNlt);
}

// Values the solve writes back (shown solved; the page keeps the Full value behind the rounded text).
function deriveLeadNext(lead, result, derived) {
  const { values: v, state: s } = lead;
  const p = result.bombDelivery.public;
  const write = (key, value) => {
    if (!isNumber(value)) return;
    v[key] = value;
    derived.add(key);
  };
  write("rollInBankAngleDeg", p.rollInBankAngleDeg);
  if (s.solveMode === "release") {
    v.trackingTimeSec = s.enteredTrackingTimeSec;
    derived.add("trackingTimeSec");
    derived.add("releaseAltitudeMslFt");
  } else if ((p.resolvedSolveMode ?? s.solveMode) === "time") {
    if (s.solveMode !== "time") { v.trackingTimeSec = s.enteredTrackingTimeSec; derived.add("trackingTimeSec"); }
    write("rollInAltitudeMslFt", p.resolvedInitialAltitudeMslFt);
  } else {
    write("trackingTimeSec", p.trackingTimeSec);
  }
  if (s.rollInAltitudeLinked) write("initialAltitudeMslFt", v.rollInAltitudeMslFt);
  // A MIN Wheel Radius shows the radius the BE flew; a MANUAL one stays as typed.
  if (s.wheelRadiusSource === "MIN") write("wheelRadiusNm", result.wheel.radiusNm);
}

// DED pages: OA1 = the Roll-in point; OA2 = the Base Turn start (Wheel-BOX v0.10, owner 2026-10-26: the Abeam Extension
// is flown to it, a visual reference, not timed). The composition gives the Target → point bearings, ranges and the
// Roll-in altitude.
function leadDed(result) {
  return {
    pages: [
      { page: "OA1", ...result.ded.oa1 },
      { page: "OA2", ...result.ded.oa2 },
    ],
  };
}

function solveLead(lead, stateError) {
  const derived = new Set();
  const base = { aircraft: 1, elementLead: null, predecessor: null };
  // No result, no MIN: a MIN Wheel Radius is cleared rather than left at the last answer's radius (v0.9).
  const failed = (message, warnings) => {
    if (lead.state.wheelRadiusSource === "MIN" && lead.values.wheelRadiusNm !== null) {
      lead.values.wheelRadiusNm = null;
      derived.add("wheelRadiusNm");
    }
    return { ...base, status: "FAILED", result: null, error: message, errors: [message], warnings, derived, ded: null };
  };
  if (stateError) return failed(stateError, []);
  try {
    const bombDeliveryInput = leadBdpInput(lead);
    if (lead.state.solveMode === "release") {
      const release = solveReleaseAltitude(bombDeliveryInput);
      bombDeliveryInput.releaseAltitudeMslFt = release;
      lead.values.releaseAltitudeMslFt = release;
    }
    const result = calculateWheelBoxV0_10Full(leadWheelInput(lead, bombDeliveryInput));
    deriveLeadNext(lead, result, derived);
    const errors = [...result.geometry.validation.errors];
    const warnings = [...(lead.notices ?? []), ...result.geometry.validation.warnings];
    const status = errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID";
    return { ...base, status, result, error: null, errors, warnings, derived, ded: leadDed(result) };
  } catch (error) {
    return failed(error.message, [...(lead.notices ?? [])]);
  }
}

// ---- Flight ---------------------------------------------------------------------------------------------------------

const SOLVE_MODEL_KEY = `${WHEEL_FLIGHT_V0_1.id}@${WHEEL_FLIGHT_V0_1.version}`;

function outputRecord(number, record) {
  if (record.raw) return structuredClone(record.raw);
  if (number !== 1) return { formation: record.formation };
  return { values: record.values, locks: record.locks, state: record.state };
}

// #1's place in the Formation: its Abeam on the Wheel, flying the Downwind heading (Attack Heading + 180°; v0.9 fixes
// the Downwind Angle at 0°). Attack frame: alongNm along the Attack Heading from the Target, sideNm toward the
// pattern side (right of the Attack Heading for RIGHT, left for LEFT).
function leadPosition(result) {
  const abeam = result.geometry.stations.abeam;
  return { alongNm: abeam.alongNm, sideNm: abeam.sideNm, headingDeg: result.downwindHeadingDeg, sideSign: result.turnSideSign };
}

// A follower's place (Offset's Formation rule, offset-formation-v0.1 computeFormationOffsetVector): the bearing is
// measured from the reference aircraft's tail, 0° behind, 90° abeam, 180° ahead, clockwise on the Left; the vector is
// laid off from the reference aircraft's place on the Downwind heading. Every aircraft flies that heading. The side
// axis is the pattern side (sideSign + 1 RIGHT / − 1 LEFT).
function followerPosition(number, follower, reference, attackHeadingDeg) {
  const { side, bearingDeg, distanceNm } = follower.formation;
  if (side !== "LEFT" && side !== "RIGHT") throw new TypeError(`#${number} Formation side must be LEFT or RIGHT`);
  requireNumber(`#${number} Formation bearingDeg`, bearingDeg);
  requireNumber(`#${number} Formation distanceNm`, distanceNm);
  if (!(bearingDeg >= 0 && bearingDeg <= 180)) throw new RangeError(`#${number} Formation bearing must be between 0 and 180 deg`);
  if (!(distanceNm >= 0)) throw new RangeError(`#${number} Formation range must be 0 NM or more`);
  const trueBearingDeg = norm(reference.headingDeg + 180 + (side === "LEFT" ? bearingDeg : -bearingDeg));
  const relative = ((trueBearingDeg - attackHeadingDeg) * Math.PI) / 180;
  return {
    alongNm: reference.alongNm + distanceNm * Math.cos(relative),
    sideNm: reference.sideNm + reference.sideSign * distanceNm * Math.sin(relative),
    headingDeg: reference.headingDeg,
    sideSign: reference.sideSign,
    referenceAircraft: WHEEL_FLIGHT_FORMATION_REFERENCE[number],
    trueBearingFromReferenceDeg: trueBearingDeg,
    distanceFromReferenceNm: distanceNm,
  };
}

function placeFollower(number, follower, stateError, results) {
  const base = { aircraft: number, elementLead: WHEEL_FLIGHT_FORMATION_REFERENCE[number], predecessor: number - 1, result: null, ded: null, derived: new Set(), warnings: [] };
  const failed = (message) => ({ ...base, status: "FAILED", position: null, error: message, errors: [message] });
  if (stateError) return failed(stateError);
  const referenceNumber = WHEEL_FLIGHT_FORMATION_REFERENCE[number];
  const reference = results[referenceNumber]?.position;
  if (!reference) return failed(`#${referenceNumber} has no current position`);
  try {
    const position = followerPosition(number, follower, reference, results[1].result.attackHeadingDeg);
    return { ...base, status: "VALID", position, error: null, errors: [] };
  } catch (error) {
    return failed(error.message);
  }
}

function calculateFlight(input, session) {
  const { flightSize, aircraft, stateErrors } = normalizeFlightInput(input);
  // A follower within the Flight size without a record takes the default Formation position.
  for (let number = 2; number <= flightSize; number += 1) aircraft[number] ??= wheelFlightDefaultFollower(number);
  const editErrors = applyEdits(aircraft, flightEditEvents(input));
  const errorOf = (number) => stateErrors[number] ?? editErrors[number];
  const results = {};
  const solveLog = {};
  const lead = reusedSolve(session, () => flightSolveKey(SOLVE_MODEL_KEY, 1, aircraft[1], errorOf(1), null), () => {
    const entry = solveLead(aircraft[1], errorOf(1));
    return { entry, record: aircraft[1] };
  });
  aircraft[1] = lead.record;
  // A copy: the solved entry may be kept for reuse by the next call.
  results[1] = { ...lead.entry, position: lead.entry.result ? leadPosition(lead.entry.result) : null };
  solveLog[1] = lead.reused ? "reused" : "solved";
  // Followers fly #1's Wheel: only their places are computed (no solve, nothing to reuse).
  for (let number = 2; number <= flightSize; number += 1) {
    results[number] = placeFollower(number, aircraft[number], errorOf(number), results);
    solveLog[number] = "placed";
  }

  const aircraftResults = {};
  const nextAircraft = {};
  for (const [key, record] of Object.entries(aircraft)) nextAircraft[key] = outputRecord(Number(key), record);
  for (const [key, entry] of Object.entries(results)) {
    const { derived, ...rest } = entry;
    if (key === "1" && nextAircraft[key] && !aircraft[key].raw) nextAircraft[key].derivedKeys = [...derived].sort();
    aircraftResults[key] = rest;
  }
  const output = {
    model: { ...WHEEL_FLIGHT_V0_1, components: { ...WHEEL_FLIGHT_V0_1.components } },
    flightSize,
    aircraftResults,
    constraintDiagnostics: [],
    // The spacing between aircraft (and so their drop-order times) is the Spacer Turn's, a later step.
    flightTiming: {},
    nextInput: { schemaVersion: WHEEL_FLIGHT_V0_1.schemaVersion, flightSize, aircraft: nextAircraft },
  };
  return { output, solveLog };
}

// Pure reference entrypoint: every call starts from nothing; identical BDP sub-solves inside the call run once.
export function calculateWheelFlightFull(input) {
  return withCalculationCache(createCalculationCache(), () => calculateFlight(input, null)).output;
}

// Editing session: the same contract as calculateWheelFlightFull for the repeated calls of one page (the Flight host
// and Worker hold it).
export function createWheelFlightSession({ solveLimit = 32, cacheLimits = { "bdp-v0.4": 512, "ballistic-trajectory": 512, "sem-nlt": 64 } } = {}) {
  return createFlightSession(calculateFlight, { solveLimit, cacheLimits });
}

// Public entrypoint: results truncated to 5 decimals (docs/FE-BE-RULES.md), without nextInput (the next input state
// is continued only from calculateWheelFlightFull).
export function calculateWheelFlight(input) {
  const { nextInput, ...rest } = calculateWheelFlightFull(input);
  return truncateBeOutput(rest);
}

export { FT_PER_NM as WHEEL_FLIGHT_FT_PER_NM };
