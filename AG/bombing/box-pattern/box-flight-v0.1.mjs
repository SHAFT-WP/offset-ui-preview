import { BOX_V2_COMPOSITION_MODEL_V0_3, calculateBoxPatternV0_3Full } from "./box-v2-composition-v0.3.mjs";
import { FRAGMENT_MARGIN_MODES, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { createCalculationCache, withCalculationCache } from "../../../common/calculation/calculation-cache-v0.1.mjs";
// The flight-level mechanics (Flight structure, input records, edit events, per-aircraft reuse, editing session,
// drop-order walk) are Flight Bombing Tactics'; this entrypoint gives them the BOX meaning.
import {
  aircraftSolveKey as flightSolveKey, applyFlightEdits, createFlightSession, dropOrderTiming, flightEditEvents, readFlightRecords, reusedSolve,
} from "../../../flight/flight-bombing-tactics/flight-composition-v0.1.mjs";

// BOX Flight entrypoint (BOX SPEC "BOX Flight entrypoint", 2026-10-25). One call takes the whole Flight input state
// and returns every aircraft's Full BOX v0.3 result, its DED pages (OA1, OA2) and the next input state. It has the
// Offset Flight entrypoint's shape, so the BOX page uses the same Flight host, Worker and session:
//   { schemaVersion?, flightSize, aircraft: { 1: { values, locks, state } }, edit? | edits? }
// The BDP Profile edit rules are the Offset page's (one BDP list, owner 2026-10-25): a Tracking Time entry solves the
// Roll-in Altitude ("time"), a Roll-in / Release Altitude entry solves the Tracking Time ("height"), and with the
// Roll-in Altitude LOCK a Tracking Time entry moves the Release Altitude ("release"); Initial Altitude may be LINKED
// to the Roll-in Altitude. BOX's turn conditions and Roll-in values stay in BOX (owner 2026-10-25).
// #1 only for now: BOX Formation (#2–#4, Offset's Flight structure and position rules) is the next step, and a
// follower record fails its aircraft with that message.
// Pure: no DOM, window, storage or FE import; the input is never mutated; the same input gives the same output.
export const BOX_FLIGHT_V0_1 = Object.freeze({
  id: "box-flight-v0.1",
  version: "0.1.0",
  status: "work",
  schemaVersion: 1,
  components: Object.freeze({ boxComposition: BOX_V2_COMPOSITION_MODEL_V0_3.version }),
});

// Defaults of a new BOX aircraft (the page's Default and each Tab Default return to these). The BDP values are the
// Offset page's defaults (same BDP list); the BOX values are the V2 BOX shell's (Base / Crosswind Turn G 2, Crosswind
// Leg 2 NM, raised to its minimum while DEFAULT). A blank optional value (OUT options, SEM Turn G / Speed / Direction)
// is the BE's default.
export const BOX_FLIGHT_DEFAULT_VALUES = Object.freeze({
  weaponId: "M82",
  targetElevationMslFt: 31,
  windDirectionDeg: 0,
  windSpeedKt: 0,
  initialSpeedValue: 350,
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
  semEnd: "LEVEL",
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
  baseTurnG: 2,
  crossTurnG: 2,
  crossLegExtensionNm: 2,
  outMode: "CLIMB",
  outSpeedKcas: null,
  outRecoveryG: null,
  outClimbPitchDeg: null,
  outClimbG: null,
  outLevelOffSpeedKcas: null,
});
export const BOX_FLIGHT_DEFAULT_STATE = Object.freeze({
  solveMode: "height",
  rollInAltitudeLinked: true,
  enteredTrackingTimeSec: 18,
  crossLegSource: "DEFAULT",
  fragmentMarginAppliesTo: "HEIGHT_AND_RADIUS",
});
export function boxFlightDefaultLead() {
  return { values: { ...BOX_FLIGHT_DEFAULT_VALUES }, locks: {}, state: { ...BOX_FLIGHT_DEFAULT_STATE } };
}

// Keys a blank leaves to the BE (each one's default applies); every other numeric key is required.
const OPTIONAL_KEYS = new Set(["semTurnDirection", "semTurnG", "semTurnSpeedKcas", "outSpeedKcas", "outRecoveryG", "outClimbPitchDeg", "outClimbG", "outLevelOffSpeedKcas"]);
const TEXT_CHOICES = Object.freeze({
  weaponId: null,
  initialSpeedMode: ["CAS", "MACH"],
  semEnd: ["LEVEL", "CLIMB"],
  semTurnType: ["LEVEL", "SLICE"],
  semTurnDirection: ["LEFT", "RIGHT"],
  outMode: ["CLIMB", "LEVEL"],
});
const LOCK_KEYS = new Set(["rollInAltitudeMslFt", "diveAngleDeg"]);
const CROSS_LEG_SOURCES = new Set(["DEFAULT", "USER"]);
const FRAGMENT_MARGIN_MODE_SET = new Set(FRAGMENT_MARGIN_MODES);
// The BOX Roll-in turns right onto the attack run (RIGHT pattern); a blank SEM Turn Direction is that side.
const BOX_ROLL_DIRECTION = "RIGHT";

// Tracking Time is entered in 0.1 s (the Offset page's step); BDP rounds the same.
export const BOX_FLIGHT_TRACKING_TIME_STEP_SEC = 0.1;
const roundTrackingTime = (value) => Math.round(value * 10) / 10;

// Roll-in Altitude LOCK with a Tracking Time entry: the Release Altitude that gives the entered Tracking Time from
// the held Roll-in Altitude. BOX's BDP input does not depend on the pattern (Angle-Off fixed at 90°, wind relative to
// the Attack Heading), so the search runs on the BDP alone.
export const BOX_FLIGHT_RELEASE_SOLVE = Object.freeze({ toleranceFt: 0.01, acceptFt: 0.5, iterations: 40 });

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

function normalizeLead(record = {}) {
  if (!record || typeof record !== "object") throw new TypeError("aircraft[1] must be an object");
  const state = record.state ?? {};
  const values = { ...(record.values ?? {}) };
  const locks = Object.fromEntries(Object.entries(record.locks ?? {}).filter(([key]) => LOCK_KEYS.has(key)).map(([key, on]) => [key, on === true]));
  const entered = blank(state.enteredTrackingTimeSec) ? BOX_FLIGHT_DEFAULT_STATE.enteredTrackingTimeSec : requireNumber("enteredTrackingTimeSec", state.enteredTrackingTimeSec);
  return {
    values,
    locks,
    state: {
      solveMode: normalizeSolveMode(state.solveMode, locks.rollInAltitudeMslFt === true),
      rollInAltitudeLinked: state.rollInAltitudeLinked !== false,
      enteredTrackingTimeSec: roundTrackingTime(entered),
      crossLegSource: enumOr("crossLegSource", state.crossLegSource, CROSS_LEG_SOURCES, "DEFAULT"),
      fragmentMarginAppliesTo: enumOr("fragmentMarginAppliesTo", state.fragmentMarginAppliesTo, FRAGMENT_MARGIN_MODE_SET, "HEIGHT_AND_RADIUS"),
    },
  };
}

function normalizeFollower() {
  throw new TypeError("BOX Formation (#2–#4) is not available yet; it is the next step");
}

function normalizeFlightInput(input) {
  return readFlightRecords(input, { schemaVersion: BOX_FLIGHT_V0_1.schemaVersion, normalizeLead, normalizeFollower });
}

// ---- One-shot edit events -----------------------------------------------------------------------------------------
// The page puts the typed value into the record and sends the event; its consequences (solve mode, LINK, Crosswind
// Leg source, a cleared field's default) are decided here and live on only through nextInput.

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
    if (!LOCK_KEYS.has(key)) throw new TypeError(`LOCK "${key}" is not supported on BOX #1`);
    locks[key] = edit.value === true;
    if (key === "rollInAltitudeMslFt") s.solveMode = lockedSolveMode(s.solveMode, locks[key]);
    return;
  }
  if (edit.kind === "toggle") {
    if (key !== "rollInAltitudeLinked") throw new TypeError(`toggle "${key}" is not supported on BOX #1`);
    s.rollInAltitudeLinked = edit.value === true;
    // Turning LINK on shows the Roll-in Altitude as the Initial Altitude.
    if (s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) v.initialAltitudeMslFt = v.rollInAltitudeMslFt;
    return;
  }
  if (edit.kind === "clear") {
    // A cleared field takes its default (an optional one goes blank), with the LINK and solve-mode rules.
    let value = Object.hasOwn(BOX_FLIGHT_DEFAULT_VALUES, key) ? BOX_FLIGHT_DEFAULT_VALUES[key] : null;
    if (key === "rollInAltitudeMslFt" && s.solveMode !== "time" && s.rollInAltitudeLinked && isNumber(v.initialAltitudeMslFt)) value = Math.round(v.initialAltitudeMslFt);
    else if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) value = Math.round(v.rollInAltitudeMslFt);
    else if (key === "trackingTimeSec") s.solveMode = "height";
    else if (key === "crossLegExtensionNm") s.crossLegSource = "DEFAULT";
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
  // A typed Crosswind Leg is kept as typed (USER); a cleared one goes back to DEFAULT.
  if (key === "crossLegExtensionNm") s.crossLegSource = isNumber(value) ? "USER" : "DEFAULT";
}

function applyEdits(aircraft, edits) {
  return applyFlightEdits(aircraft, edits, (number, edit) => {
    if (number !== 1) throw new TypeError("BOX Formation (#2–#4) is not available yet");
    applyLeadEdit(aircraft[1], edit);
  });
}

// ---- #1 solve ------------------------------------------------------------------------------------------------------

function textChoice(key, value) {
  if (blank(value)) return OPTIONAL_KEYS.has(key) ? undefined : BOX_FLIGHT_DEFAULT_VALUES[key];
  const allowed = TEXT_CHOICES[key];
  if (allowed && !allowed.includes(value)) throw new TypeError(`${key} "${value}" is not supported`);
  return value;
}

function optionalNumber(key, value) {
  return blank(value) ? undefined : requireNumber(key, value);
}

// The BDP v0.4 input of one BOX aircraft. Wind Direction is the true FROM direction, given to the BDP relative to the
// Attack Heading (the Offset page's conversion). The BOX composition sets Angle-Off 90°.
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
    trackingTimeStepSec: BOX_FLIGHT_TRACKING_TIME_STEP_SEC,
    releaseAltitudeMslFt: n("releaseAltitudeMslFt"),
    rollInG: n("rollInG"),
    rollInRollRateDegSec: n("rollInRollRateDegSec"),
    rollOutRollRateDegSec: n("rollOutRollRateDegSec"),
    gOnsetRateGSec: n("gOnsetRateGSec"),
    semEnd: textChoice("semEnd", v.semEnd),
    csemTargetFpaDeg: n("csemTargetFpaDeg"),
    semTurnType: textChoice("semTurnType", v.semTurnType),
    semTurnDeg: n("semTurnDeg"),
    semTurnDirection: textChoice("semTurnDirection", v.semTurnDirection) ?? BOX_ROLL_DIRECTION,
    semTurnG: optionalNumber("semTurnG", v.semTurnG),
    semTurnSpeedKcas: optionalNumber("semTurnSpeedKcas", v.semTurnSpeedKcas),
    semTurnBankDeg: n("semTurnBankDeg"),
  };
}

function leadBoxInput(lead, bombDeliveryInput) {
  const { values: v, state: s } = lead;
  const n = (key) => requireNumber(key, v[key]);
  const out = { outMode: textChoice("outMode", v.outMode) };
  for (const key of ["outSpeedKcas", "outRecoveryG", "outClimbPitchDeg", "outClimbG", "outLevelOffSpeedKcas"]) {
    const value = optionalNumber(key, v[key]);
    if (value !== undefined) out[key] = value;
  }
  return {
    bombDeliveryInput,
    attackHeadingDeg: norm(n("attackHeadingDeg")),
    baseTurnG: n("baseTurnG"),
    crossTurnG: n("crossTurnG"),
    crossLegExtensionNm: n("crossLegExtensionNm"),
    crossLegExtensionSource: s.crossLegSource,
    out,
  };
}

// "release" mode: the Release Altitude at which the time-mode BDP (entered Tracking Time) reaches the held Roll-in
// Altitude (secant on the BDP at the BOX Angle-Off).
function solveReleaseAltitude(bombDeliveryInput) {
  const config = BOX_FLIGHT_RELEASE_SOLVE;
  const rollInAltitudeMslFt = bombDeliveryInput.initialAltitudeMslFt;
  const angleOffDeg = BOX_V2_COMPOSITION_MODEL_V0_3.fixedAngleOffDeg;
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
  // A DEFAULT Crosswind Leg shows the length flown (raised to its minimum when short); a USER one stays as typed.
  if (s.crossLegSource === "DEFAULT") write("crossLegExtensionNm", result.crossLeg.effectiveNm);
}

// DED pages (owner 2026-10-23 / 25, BOX only): OA1 = the Roll-in point; OA2 = 10 NM past OA1 along the travel
// direction. The composition gives the Target → point bearings, ranges and the Roll-in altitude.
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
  if (stateError) return { ...base, status: "FAILED", result: null, error: stateError, errors: [stateError], warnings: [], derived, ded: null };
  try {
    const bombDeliveryInput = leadBdpInput(lead);
    if (lead.state.solveMode === "release") {
      const release = solveReleaseAltitude(bombDeliveryInput);
      bombDeliveryInput.releaseAltitudeMslFt = release;
      lead.values.releaseAltitudeMslFt = release;
    }
    const result = calculateBoxPatternV0_3Full(leadBoxInput(lead, bombDeliveryInput));
    deriveLeadNext(lead, result, derived);
    const errors = [...result.geometry.validation.errors];
    const warnings = [];
    const status = errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID";
    return { ...base, status, result, error: null, errors, warnings, derived, ded: leadDed(result) };
  } catch (error) {
    return { ...base, status: "FAILED", result: null, error: error.message, errors: [error.message], warnings: [], derived, ded: null };
  }
}

// ---- Flight ---------------------------------------------------------------------------------------------------------

const SOLVE_MODEL_KEY = `${BOX_FLIGHT_V0_1.id}@${BOX_FLIGHT_V0_1.version}`;

function outputRecord(record) {
  if (record.raw) return structuredClone(record.raw);
  return { values: record.values, locks: record.locks, state: record.state };
}

function calculateFlight(input, session) {
  const { flightSize, aircraft, stateErrors } = normalizeFlightInput(input);
  const editErrors = applyEdits(aircraft, flightEditEvents(input));
  const errorOf = (number) => stateErrors[number] ?? editErrors[number];
  const results = {};
  const solveLog = {};
  const lead = reusedSolve(session, () => flightSolveKey(SOLVE_MODEL_KEY, 1, aircraft[1], errorOf(1), null), () => {
    const entry = solveLead(aircraft[1], errorOf(1));
    return { entry, record: aircraft[1] };
  });
  aircraft[1] = lead.record;
  results[1] = lead.entry;
  solveLog[1] = lead.reused ? "reused" : "solved";
  for (let number = 2; number <= flightSize; number += 1) {
    const message = errorOf(number) ?? "BOX Formation (#2–#4) is not available yet; it is the next step";
    results[number] = { aircraft: number, status: "FAILED", result: null, error: message, errors: [message], warnings: [], derived: new Set(), ded: null };
    solveLog[number] = "solved";
  }

  const aircraftResults = {};
  const nextAircraft = {};
  for (const [key, record] of Object.entries(aircraft)) nextAircraft[key] = outputRecord(record);
  for (const [key, entry] of Object.entries(results)) {
    const { derived, ...rest } = entry;
    if (nextAircraft[key] && !aircraft[key].raw) nextAircraft[key].derivedKeys = [...derived].sort();
    aircraftResults[key] = rest;
  }
  const output = {
    model: { ...BOX_FLIGHT_V0_1, components: { ...BOX_FLIGHT_V0_1.components } },
    flightSize,
    aircraftResults,
    constraintDiagnostics: [],
    // Drop-order timing comes with BOX Formation; until then no follower has a result.
    flightTiming: dropOrderTiming(flightSize, results, () => ({})),
    nextInput: { schemaVersion: BOX_FLIGHT_V0_1.schemaVersion, flightSize, aircraft: nextAircraft },
  };
  return { output, solveLog };
}

// Pure reference entrypoint: every call starts from nothing; identical BDP sub-solves inside the call run once.
export function calculateBoxFlightFull(input) {
  return withCalculationCache(createCalculationCache(), () => calculateFlight(input, null)).output;
}

// Editing session: the same contract as calculateBoxFlightFull for the repeated calls of one page (the Flight host
// and Worker hold it).
export function createBoxFlightSession({ solveLimit = 32, cacheLimits = { "bdp-v0.4": 512, "ballistic-trajectory": 512, "sem-nlt": 64 } } = {}) {
  return createFlightSession(calculateFlight, { solveLimit, cacheLimits });
}

// Public entrypoint: results truncated to 5 decimals (docs/FE-BE-RULES.md), without nextInput (the next input state
// is continued only from calculateBoxFlightFull).
export function calculateBoxFlight(input) {
  const { nextInput, ...rest } = calculateBoxFlightFull(input);
  return truncateBeOutput(rest);
}

export { FT_PER_NM as BOX_FLIGHT_FT_PER_NM };
