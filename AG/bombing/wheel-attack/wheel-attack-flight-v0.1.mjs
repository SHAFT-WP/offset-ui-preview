import { WHEEL_ATTACK_BE_MODEL_V0_1, calculateWheelAttackV0_1Full } from "./wheel-attack-be-v0.1.mjs";
import { FRAGMENT_MARGIN_MODES, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { createCalculationCache, withCalculationCache } from "../../../common/calculation/calculation-cache-v0.1.mjs";
// The flight-level mechanics (Flight structure, input records, edit events, per-aircraft reuse, editing session) are
// Flight Bombing Tactics'; this entrypoint gives them the Wheel meaning.
import {
  aircraftSolveKey as flightSolveKey, applyFlightEdits, createFlightSession, flightEditEvents, readFlightRecords, reusedSolve,
} from "../../../flight/flight-bombing-tactics/flight-composition-v0.1.mjs";

// Wheel Attack Flight entrypoint (Wheel SPEC §20, owner 2026-10-27: the Wheel (V2) as BOX's BE / FE). One call takes the whole
// Flight input state and returns every aircraft's Full Wheel Attack v0.1 result (#1), its DED page (OA1), each
// follower's place on the Wheel and the next input state. It has the BOX / Wheel-BOX Flight entrypoint's shape, so the
// Wheel page uses the same Flight host, Worker and session:
//   { schemaVersion?, flightSize, aircraft: { 1: { values, locks, state }, 2–4: {} }, edit? | edits? }
// The BDP Profile edit rules are BOX's (one BDP list): a Tracking Time entry solves the Roll-in Altitude ("time"), a
// Roll-in / Release Altitude entry solves the Tracking Time ("height"), and with the Roll-in Altitude LOCK a Tracking
// Time entry moves the Release Altitude ("release"); Initial Altitude may be LINKED to the Roll-in Altitude.
// The Wheel values: Attack Heading, Direction (RIGHT / LEFT) and Aircraft Count (2–8). The Angle-Off is the BE's
// tangent solution, never a value.
// The Flight: #1–#4 fly #1's data. A follower has no Formation position: its place is its slot on the Wheel in the
// attack order 1 → N → … → 2, one attack interval apart (Rev0.4); a follower beyond the Aircraft Count has none.
// Pure: no DOM, window, storage or FE import; the input is never mutated; the same input gives the same output.
export const WHEEL_ATTACK_FLIGHT_V0_1 = Object.freeze({
  id: "wheel-attack-flight-v0.1",
  version: "0.1.0",
  status: "work",
  schemaVersion: 1,
  components: Object.freeze({ wheelComposition: WHEEL_ATTACK_BE_MODEL_V0_1.version }),
});

// Defaults of a new Wheel aircraft (the page's Default and each Tab Default return to these): BOX's BDP values (one
// BDP list; Initial Speed 350 KCAS, Rev0.4's) and the Wheel's: Attack Heading 000 (the V2 pages'), RIGHT and four
// aircraft (Rev0.4).
export const WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES = Object.freeze({
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
  direction: "RIGHT",
  aircraftCount: WHEEL_ATTACK_BE_MODEL_V0_1.defaultAircraftCount,
});
export const WHEEL_ATTACK_FLIGHT_DEFAULT_STATE = Object.freeze({
  solveMode: "height",
  rollInAltitudeLinked: true,
  enteredTrackingTimeSec: 18,
  fragmentMarginAppliesTo: "HEIGHT_AND_RADIUS",
});
export function wheelAttackFlightDefaultLead() {
  return { values: { ...WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES }, locks: {}, state: { ...WHEEL_ATTACK_FLIGHT_DEFAULT_STATE } };
}
// A follower holds no values: it flies #1's data at its Wheel slot.
export function wheelAttackFlightDefaultFollower(number) {
  if (![2, 3, 4].includes(number)) throw new RangeError("follower number must be 2, 3 or 4");
  return {};
}

// Keys a blank leaves to the BE (each one's default applies); every other numeric key is required.
const OPTIONAL_KEYS = new Set(["semTurnDirection", "semTurnG", "semTurnSpeedKcas"]);
const TEXT_CHOICES = Object.freeze({
  weaponId: null,
  initialSpeedMode: ["CAS", "MACH"],
  semEnd: ["LEVEL", "CLIMB"],
  semTurnType: ["LEVEL", "SLICE"],
  semTurnDirection: ["LEFT", "RIGHT"],
  direction: ["RIGHT", "LEFT"],
});
const LOCK_KEYS = new Set(["rollInAltitudeMslFt", "diveAngleDeg"]);
const FRAGMENT_MARGIN_MODE_SET = new Set(FRAGMENT_MARGIN_MODES);

// Tracking Time is entered in 0.1 s (the Offset page's step); BDP rounds the same.
export const WHEEL_ATTACK_FLIGHT_TRACKING_TIME_STEP_SEC = 0.1;
const roundTrackingTime = (value) => Math.round(value * 10) / 10;

// Roll-in Altitude LOCK with a Tracking Time entry: the Release Altitude that gives the entered Tracking Time from the
// held Roll-in Altitude. The BDP depends on the tangent Angle-Off and the Angle-Off on the BDP, so the two are solved in
// turn (the release at the last Angle-Off, then the Angle-Off at that release) until the release moves less than the
// tolerance.
export const WHEEL_ATTACK_FLIGHT_RELEASE_SOLVE = Object.freeze({ toleranceFt: 0.01, acceptFt: 0.5, iterations: 40, rounds: 8 });

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
  const entered = blank(state.enteredTrackingTimeSec) ? WHEEL_ATTACK_FLIGHT_DEFAULT_STATE.enteredTrackingTimeSec : requireNumber("enteredTrackingTimeSec", state.enteredTrackingTimeSec);
  return {
    values,
    locks,
    state: {
      solveMode: normalizeSolveMode(state.solveMode, locks.rollInAltitudeMslFt === true),
      rollInAltitudeLinked: state.rollInAltitudeLinked !== false,
      enteredTrackingTimeSec: roundTrackingTime(entered),
      fragmentMarginAppliesTo: enumOr("fragmentMarginAppliesTo", state.fragmentMarginAppliesTo, FRAGMENT_MARGIN_MODE_SET, "HEIGHT_AND_RADIUS"),
    },
  };
}

function normalizeFollower(record = {}) {
  if (!record || typeof record !== "object") throw new TypeError("a follower record must be an object");
  return {};
}

function normalizeFlightInput(input) {
  return readFlightRecords(input, { schemaVersion: WHEEL_ATTACK_FLIGHT_V0_1.schemaVersion, normalizeLead, normalizeFollower });
}

// ---- One-shot edit events -----------------------------------------------------------------------------------------
// The page puts the typed value into the record and sends the event; its consequences (solve mode, LINK, a cleared
// field's default) are decided here and live on only through nextInput.

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
    let value = Object.hasOwn(WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES, key) ? WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES[key] : null;
    if (key === "rollInAltitudeMslFt" && s.solveMode !== "time" && s.rollInAltitudeLinked && isNumber(v.initialAltitudeMslFt)) value = Math.round(v.initialAltitudeMslFt);
    else if (key === "initialAltitudeMslFt" && s.rollInAltitudeLinked && isNumber(v.rollInAltitudeMslFt)) value = Math.round(v.rollInAltitudeMslFt);
    else if (key === "trackingTimeSec") s.solveMode = "height";
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
}

function applyEdits(aircraft, edits) {
  return applyFlightEdits(aircraft, edits, (number, edit) => {
    if (number !== 1) throw new TypeError(`#${number} has no fields of its own: it flies #1's Wheel data at its slot in the attack order`);
    applyLeadEdit(aircraft[1], edit);
  });
}

// ---- #1 solve ------------------------------------------------------------------------------------------------------

function textChoice(key, value) {
  if (blank(value)) return OPTIONAL_KEYS.has(key) ? undefined : WHEEL_ATTACK_FLIGHT_DEFAULT_VALUES[key];
  const allowed = TEXT_CHOICES[key];
  if (allowed && !allowed.includes(value)) throw new TypeError(`${key} "${value}" is not supported`);
  return value;
}

function optionalNumber(key, value) {
  return blank(value) ? undefined : requireNumber(key, value);
}

// The BDP v0.4 input of one Wheel aircraft. Wind Direction is the true FROM direction, given to the BDP relative to the
// Attack Heading (the Offset page's conversion). The Wheel composition sets the Angle-Off it solves.
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
    // Roll-in Altitude is the BDP entry altitude (OA1, on the Wheel); Initial Altitude is linked or reference only.
    initialAltitudeMslFt: n("rollInAltitudeMslFt"),
    solveMode: solveMode === "release" ? "time" : solveMode,
    // A Roll-in Altitude too low gives a negative Tracking Time, not an error (the Offset page's rule).
    allowNegativeTrackingTime: true,
    trackingTimeSec: solveMode === "time" ? n("trackingTimeSec") : s.enteredTrackingTimeSec,
    trackingTimeStepSec: WHEEL_ATTACK_FLIGHT_TRACKING_TIME_STEP_SEC,
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

function leadWheelInput(lead, bombDeliveryInput, angleOffHintDeg = null) {
  const { values: v } = lead;
  const count = requireNumber("aircraftCount", v.aircraftCount);
  return {
    bombDeliveryInput,
    attackHeadingDeg: norm(requireNumber("attackHeadingDeg", v.attackHeadingDeg)),
    direction: textChoice("direction", v.direction),
    aircraftCount: count,
    angleOffHintDeg,
  };
}

// "release" mode at one Angle-Off: the Release Altitude at which the time-mode BDP (entered Tracking Time) reaches the
// held Roll-in Altitude (secant on the BDP).
function solveReleaseAltitude(bombDeliveryInput, angleOffDeg) {
  const config = WHEEL_ATTACK_FLIGHT_RELEASE_SOLVE;
  const rollInAltitudeMslFt = bombDeliveryInput.initialAltitudeMslFt;
  const f = (releaseAltitudeMslFt) => calculateBombDeliveryV0_4Full({ ...bombDeliveryInput, angleOffDeg, solveMode: "time", releaseAltitudeMslFt }).public.resolvedInitialAltitudeMslFt - rollInAltitudeMslFt;
  const conflict = (belowNlt) => new Error(`CONSTRAINT CONFLICT: Roll-in Altitude LOCK: no Release Altitude gives Tracking Time ${bombDeliveryInput.trackingTimeSec} sec from Roll-in Altitude ${Math.round(rollInAltitudeMslFt)} ft${belowNlt ? " (Release would be below NLT; shorten Tracking Time or raise Roll-in Altitude)" : ""}`);
  let x0 = bombDeliveryInput.releaseAltitudeMslFt;
  let f0 = f(x0);
  if (Math.abs(f0) <= config.toleranceFt) return x0;
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

// The Wheel at the Release Altitude that holds the Roll-in Altitude (above): the tangent and the release in turn.
function solveReleaseWheel(lead, bombDeliveryInput) {
  const config = WHEEL_ATTACK_FLIGHT_RELEASE_SOLVE;
  let input = { ...bombDeliveryInput };
  let result = calculateWheelAttackV0_1Full(leadWheelInput(lead, input));
  for (let round = 0; round < config.rounds; round += 1) {
    const release = solveReleaseAltitude(input, result.angleOffDeg);
    if (Math.abs(release - input.releaseAltitudeMslFt) <= config.toleranceFt) return { result, releaseAltitudeMslFt: input.releaseAltitudeMslFt };
    input = { ...input, releaseAltitudeMslFt: release };
    result = calculateWheelAttackV0_1Full(leadWheelInput(lead, input, result.angleOffDeg));
  }
  throw new Error(`CONSTRAINT CONFLICT: Roll-in Altitude LOCK: the Release Altitude and the tangent Angle-Off did not settle in ${config.rounds} rounds`);
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
}

// DED page: OA1 = the Roll-in Start on the Wheel (Target → point bearing, range, Roll-in altitude).
function leadDed(result) {
  return { pages: [{ page: "OA1", ...result.ded.oa1 }] };
}

function solveLead(lead, stateError) {
  const derived = new Set();
  const base = { aircraft: 1, elementLead: null, predecessor: null };
  const failed = (message) => ({ ...base, status: "FAILED", result: null, error: message, errors: [message], warnings: [], derived, ded: null });
  if (stateError) return failed(stateError);
  try {
    const bombDeliveryInput = leadBdpInput(lead);
    let result;
    if (lead.state.solveMode === "release") {
      const solved = solveReleaseWheel(lead, bombDeliveryInput);
      result = solved.result;
      lead.values.releaseAltitudeMslFt = solved.releaseAltitudeMslFt;
    } else {
      result = calculateWheelAttackV0_1Full(leadWheelInput(lead, bombDeliveryInput));
    }
    deriveLeadNext(lead, result, derived);
    const errors = [...result.geometry.validation.errors];
    const warnings = [...result.geometry.validation.warnings];
    const status = errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID";
    return { ...base, status, result, error: null, errors, warnings, derived, ded: leadDed(result) };
  } catch (error) {
    return failed(error.message);
  }
}

// ---- Flight ---------------------------------------------------------------------------------------------------------

const SOLVE_MODEL_KEY = `${WHEEL_ATTACK_FLIGHT_V0_1.id}@${WHEEL_ATTACK_FLIGHT_V0_1.version}`;

function outputRecord(number, record) {
  if (record.raw) return structuredClone(record.raw);
  if (number !== 1) return {};
  return { values: record.values, locks: record.locks, state: record.state };
}

// An aircraft's place on the Wheel when #1 is at the Roll-in Start (attack frame), the heading it flies there and its
// Roll-in time after #1's.
function slotPosition(result, number) {
  const slot = result.flight.slots.find((entry) => entry.aircraft === number);
  if (!slot) return null;
  return {
    alongNm: slot.alongNm, sideNm: slot.sideNm, headingDeg: slot.headingDeg, radialDeg: slot.radialDeg, sideSign: result.turnSideSign,
    slot: slot.slot, rollInDelaySec: slot.rollInDelaySec,
  };
}

function placeFollower(number, stateError, results) {
  const base = { aircraft: number, elementLead: 1, predecessor: number - 1, result: null, ded: null, derived: new Set(), warnings: [] };
  const failed = (message) => ({ ...base, status: "FAILED", position: null, error: message, errors: [message] });
  if (stateError) return failed(stateError);
  const lead = results[1]?.result;
  if (!lead) return failed("#1 has no current Wheel");
  const position = slotPosition(lead, number);
  if (!position) return failed(`#${number} is not on the Wheel: Aircraft Count ${lead.flight.aircraftCount}`);
  return { ...base, status: "VALID", position, error: null, errors: [] };
}

function calculateFlight(input, session) {
  const { flightSize, aircraft, stateErrors } = normalizeFlightInput(input);
  for (let number = 2; number <= flightSize; number += 1) aircraft[number] ??= wheelAttackFlightDefaultFollower(number);
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
  results[1] = { ...lead.entry, position: lead.entry.result ? slotPosition(lead.entry.result, 1) : null };
  solveLog[1] = lead.reused ? "reused" : "solved";
  // Followers fly #1's Wheel: only their slots are read (no solve, nothing to reuse).
  for (let number = 2; number <= flightSize; number += 1) {
    results[number] = placeFollower(number, errorOf(number), results);
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
  // The Flight's timing: each aircraft's Roll-in after #1's (its slot × the attack interval).
  const wheel = results[1].result;
  const flightTiming = wheel
    ? {
      attackIntervalSec: wheel.flight.attackIntervalSec,
      rollInDelaySec: Object.fromEntries(Object.entries(results).filter(([, entry]) => entry.position).map(([number, entry]) => [number, entry.position.rollInDelaySec])),
    }
    : {};
  const output = {
    model: { ...WHEEL_ATTACK_FLIGHT_V0_1, components: { ...WHEEL_ATTACK_FLIGHT_V0_1.components } },
    flightSize,
    aircraftResults,
    constraintDiagnostics: [],
    flightTiming,
    nextInput: { schemaVersion: WHEEL_ATTACK_FLIGHT_V0_1.schemaVersion, flightSize, aircraft: nextAircraft },
  };
  return { output, solveLog };
}

// Pure reference entrypoint: every call starts from nothing; identical BDP sub-solves inside the call run once.
export function calculateWheelAttackFlightFull(input) {
  return withCalculationCache(createCalculationCache(), () => calculateFlight(input, null)).output;
}

// Editing session: the same contract as calculateWheelAttackFlightFull for the repeated calls of one page (the Flight host
// and Worker hold it).
export function createWheelAttackFlightSession({ solveLimit = 32, cacheLimits = { "bdp-v0.4": 512, "ballistic-trajectory": 512, "sem-nlt": 64 } } = {}) {
  return createFlightSession(calculateFlight, { solveLimit, cacheLimits });
}

// Public entrypoint: results truncated to 5 decimals (docs/FE-BE-RULES.md), without nextInput (the next input state
// is continued only from calculateWheelAttackFlightFull).
export function calculateWheelAttackFlight(input) {
  const { nextInput, ...rest } = calculateWheelAttackFlightFull(input);
  return truncateBeOutput(rest);
}

export { FT_PER_NM as WHEEL_ATTACK_FLIGHT_FT_PER_NM };
