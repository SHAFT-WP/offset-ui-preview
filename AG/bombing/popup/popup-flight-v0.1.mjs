import { casToTas, machToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { OFFSET_FLIGHT_V0_1, calculateOffsetFlightFull, createOffsetFlightSession } from "../offset-bombing/offset-flight-v0.1.mjs";
import { POPUP_BE_V0_2, assemblePopupAttack, calculatePopupMinimumExposureFull, defaultPopupAngleDeg, normalizePopupInput, resolvePopupAngle } from "./popup-be-v0.2.mjs";
import { calculatePopupClimbFull } from "./popup-climb-v0.2.mjs";

// POP-UP Flight v0.1 (owner 2026-10-27, POP-UP SPEC §13.1, step 3b): the Offset Flight (as is) with each aircraft's
// Roll-in flown from its Popup angle at MIL (BDP v0.4.5 POP-UP option), and the POP-UP climb in front of it.
//   Pop Point: on the Approach leg (Offset Turn End → Roll-in Start, the Offset heading), the Popup ground distance
//   before Roll-in Start; Hold-Down = Approach Range − ground distance, which must be ≥ 0 (an error, never clipped).
//   The Pop Point state is the Offset leg's: Offset Altitude and Offset Speed (§13.5).
// Per aircraft (values / state of the Offset record; blank follows #1, then the defaults):
//   state.popupDriver "DEFAULT" (automatic rule) | "ANGLE" | "GROUND_DISTANCE" | "EXPOSURE_TIME";
//   values.popupAngleDeg / popupGroundDistanceNm / popupExposureTimeSec (the driver's value); values.popupG (3 G).
// The angle for a distance or a time is solved on the aircraft's BDP input from an Offset Flight at the previous
// angle, repeated until the angle settles (the Offset solve moves the Roll-in a little with the angle).
export const POPUP_FLIGHT_V0_1 = Object.freeze({
  id: "popup-flight-v0.1",
  version: "0.1.0",
  status: "work",
  offsetFlight: `${OFFSET_FLIGHT_V0_1.id} ${OFFSET_FLIGHT_V0_1.version}`,
  popupBe: `${POPUP_BE_V0_2.id} ${POPUP_BE_V0_2.version}`,
  defaultPopupG: 3,
  angleIterations: 4,
  angleSettleDeg: 0.01,
});

const DEG = Math.PI / 180;
const blank = (value) => value === null || value === undefined || value === "";

// The page's POP-UP edits (FE edit events, as Offset's): a typed angle / distance / time becomes that aircraft's
// driver; { key: "popupDriver", value: "DEFAULT" } goes back to the automatic rule. They are the POP-UP's, so they
// are not passed to the Offset Flight.
const POPUP_DRIVER_OF_KEY = Object.freeze({ popupAngleDeg: "ANGLE", popupGroundDistanceNm: "GROUND_DISTANCE", popupExposureTimeSec: "EXPOSURE_TIME" });
const isPopupEdit = (edit) => typeof edit?.key === "string" && edit.key.startsWith("popup");
function editedDrivers(input) {
  const drivers = {};
  for (const edit of [...(input.edit ? [input.edit] : []), ...(input.edits ?? [])]) {
    if (!isPopupEdit(edit)) continue;
    const number = String(edit.aircraft ?? 1);
    if (edit.key === "popupDriver") drivers[number] = edit.value ?? "DEFAULT";
    else if (POPUP_DRIVER_OF_KEY[edit.key]) drivers[number] = POPUP_DRIVER_OF_KEY[edit.key];
  }
  return drivers;
}

// Per aircraft: its own values, else #1's (a follower without its own POP-UP inputs flies #1's), then the defaults.
function popupSettings(input, number, edited) {
  const own = input.aircraft[number] ?? {};
  const lead = input.aircraft[1] ?? {};
  const ownInputs = number === "1" || !blank(own.state?.popupDriver) || !!edited[number];
  const source = ownInputs ? own : lead;
  const pick = (key) => (blank(own.values?.[key]) ? lead.values?.[key] : own.values?.[key]);
  const driver = edited[number] ?? source.state?.popupDriver ?? (number === "1" ? undefined : edited["1"]) ?? "DEFAULT";
  return {
    driver,
    popupG: blank(pick("popupG")) ? POPUP_FLIGHT_V0_1.defaultPopupG : Number(pick("popupG")),
    popupAngleDeg: source.values?.popupAngleDeg,
    groundDistanceNm: source.values?.popupGroundDistanceNm,
    exposureTimeSec: source.values?.popupExposureTimeSec,
  };
}

// The Offset input with every aircraft's Roll-in from its angle at MIL (the POP-UP edits and request left out).
function withAngles(input, angles) {
  const aircraft = {};
  for (const [key, record] of Object.entries(input.aircraft)) {
    const angle = angles[key];
    aircraft[key] = angle === undefined
      ? record
      : { ...record, values: { ...record.values, rollInStartFpaDeg: angle, rollInSpeedModel: "MIL" } };
  }
  const { popupRequest, edit, ...rest } = input;
  const edits = (input.edits ?? []).filter((e) => !isPopupEdit(e));
  return { ...rest, aircraft, ...(input.edits ? { edits } : {}), ...(edit && !isPopupEdit(edit) ? { edit } : {}) };
}

// The BDP input of the Roll-in onward without the POP-UP option (the POP-UP BE adds it per trial angle).
function bdpInputOf(profile) {
  const { rollInStartFpaDeg, rollInSpeedModel, ...rest } = profile.canonicalInputs;
  return rest;
}

function popState(resolved) {
  const altitudeMslFt = resolved.offsetAltitudeMslFt;
  const tasKt = resolved.offsetSpeedMode === "MACH" ? machToTas(resolved.offsetSpeedValue, altitudeMslFt) : casToTas(resolved.offsetSpeedValue, altitudeMslFt);
  return { popAltitudeMslFt: altitudeMslFt, popSpeedKcas: tasToCas(tasKt, altitudeMslFt) };
}

function flownAircraft(output) {
  return Object.entries(output.aircraftResults).filter(([, r]) => r.result?.profile?.canonicalInputs && (r.status === "VALID" || r.status === "WARNING"));
}

export function calculatePopupFlightFull(input) {
  return popupFlight(input, calculateOffsetFlightFull);
}

// The output has the Offset Flight's shape (the page reuses the Offset controller): each aircraftResults[n] is the
// Offset's with the POP-UP status, errors and warnings merged in and `popup` added (angle, climb, events, checks,
// Pop Point, Hold-Down).
function popupFlight(input, offsetFlight) {
  if (!input?.aircraft?.[1]) throw new TypeError("POP-UP Flight input needs aircraft #1");
  const numbers = Object.keys(input.aircraft);
  const edited = editedDrivers(input);
  const settings = Object.fromEntries(numbers.map((n) => [n, popupSettings(input, n, edited)]));
  // First angles: the driver's own value or the automatic rule on the aircraft's Dive.
  const angles = {};
  for (const n of numbers) {
    const s = settings[n];
    const dive = Number(input.aircraft[n].values?.diveAngleDeg ?? input.aircraft[1].values?.diveAngleDeg);
    angles[n] = s.driver === "ANGLE" && Number.isFinite(Number(s.popupAngleDeg)) ? Number(s.popupAngleDeg) : defaultPopupAngleDeg(dive);
  }
  const angleErrors = {};
  const solved = {};
  let output = offsetFlight(withAngles(input, angles));
  const needsSolve = numbers.filter((n) => settings[n].driver === "GROUND_DISTANCE" || settings[n].driver === "EXPOSURE_TIME");
  for (let iteration = 0; needsSolve.length && iteration < POPUP_FLIGHT_V0_1.angleIterations; iteration += 1) {
    let moved = false;
    for (const n of needsSolve) {
      const r = output.aircraftResults[n];
      if (!r?.result?.profile?.canonicalInputs) continue;
      const s = settings[n];
      try {
        const p = normalizePopupInput({ bdp: bdpInputOf(r.result.profile), popup: { ...popState(r.result.resolved), popupG: s.popupG, driver: s.driver, groundDistanceNm: Number(s.groundDistanceNm), exposureTimeSec: Number(s.exposureTimeSec) } });
        const resolved = resolvePopupAngle(p);
        solved[n] = resolved;
        delete angleErrors[n];
        if (Math.abs(resolved.angleDeg - angles[n]) > POPUP_FLIGHT_V0_1.angleSettleDeg) moved = true;
        angles[n] = resolved.angleDeg;
      } catch (error) {
        angleErrors[n] = error.message;
      }
    }
    if (!moved) break;
    output = offsetFlight(withAngles(input, angles));
  }
  const aircraftResults = {};
  for (const n of numbers) {
    const offset = output.aircraftResults[n];
    const s = settings[n];
    const base = { driver: s.driver, popupG: s.popupG, popupAngleDeg: angles[n] };
    const merge = (popup, errors, warnings) => {
      const status = errors.length ? "INVALID" : offset.status === "WARNING" || warnings.length ? "WARNING" : offset.status;
      return { ...offset, status, errors: [...(offset.errors ?? []), ...errors], warnings: [...(offset.warnings ?? []), ...warnings], popup: { ...base, ...popup } };
    };
    if (!offset) { aircraftResults[n] = { status: "FAILED", errors: ["No Offset result"], warnings: [], popup: base }; continue; }
    if (angleErrors[n]) { aircraftResults[n] = merge({}, [angleErrors[n]], []); continue; }
    if (!offset.result?.profile?.canonicalInputs || !(offset.status === "VALID" || offset.status === "WARNING")) {
      aircraftResults[n] = { ...offset, popup: base };
      continue;
    }
    const r = offset.result;
    const bdp = r.profile;
    const pop = popState(r.resolved);
    const p = normalizePopupInput({ bdp: bdpInputOf(bdp), popup: { ...pop, popupG: s.popupG, driver: "ANGLE", popupAngleDeg: angles[n] } });
    let climb;
    try {
      climb = calculatePopupClimbFull({ ...pop, rollInAltitudeMslFt: bdp.public.resolvedInitialAltitudeMslFt, popupAngleDeg: angles[n], popupG: s.popupG, gOnsetRateGSec: bdp.canonicalInputs.gOnsetRateGSec });
    } catch (error) {
      aircraftResults[n] = merge({}, [error.message], []);
      continue;
    }
    const errors = [];
    const warnings = [];
    const attack = assemblePopupAttack({ p: { ...p, driver: s.driver }, angleDeg: angles[n], otherSolutionsDeg: solved[n]?.otherSolutionsDeg ?? [], bdp, climb, errors, warnings });
    // Pop Point on the Approach leg, ground distance before Roll-in Start.
    const approachRangeNm = r.resolved.approachRangeNm;
    const holdDownNm = approachRangeNm - climb.groundDistanceNm;
    if (!(holdDownNm >= 0)) {
      errors.push(`Hold-Down ${holdDownNm.toFixed(2)} NM: the Popup ground distance ${climb.groundDistanceNm.toFixed(2)} NM is longer than the Approach Range ${approachRangeNm.toFixed(2)} NM`);
    }
    const heading = r.geometry.offsetHeadingDeg * DEG;
    const rollStart = r.geometry.points.rollStart;
    const popPoint = { x: rollStart.x - climb.groundDistanceNm * Math.sin(heading), y: rollStart.y - climb.groundDistanceNm * Math.cos(heading) };
    // Timing: the Offset clock with its Approach replaced by the Hold-Down (Offset ground speed) and the climb.
    const approachGroundSpeedNmSec = r.timing.approachSec > 0 ? approachRangeNm / r.timing.approachSec : null;
    const holdDownSec = approachGroundSpeedNmSec ? Math.max(0, holdDownNm) / approachGroundSpeedNmSec : null;
    const { status, errors: attackErrors, warnings: attackWarnings, bdp: _bdp, ...popup } = attack;
    aircraftResults[n] = merge({ ...popup, popPoint, approachRangeNm, holdDownNm, holdDownSec }, errors, warnings);
  }
  // Written back for the page: each aircraft's flown angle and the two results of its driver.
  const nextInput = structuredClone(output.nextInput ?? input);
  for (const n of numbers) {
    const a = aircraftResults[n].popup ?? {};
    const values = nextInput.aircraft?.[n]?.values;
    if (!values || !Number.isFinite(a.popupAngleDeg)) continue;
    delete values.rollInStartFpaDeg;
    delete values.rollInSpeedModel;
    values.popupAngleDeg = a.popupAngleDeg;
    if (Number.isFinite(a.groundDistanceNm)) values.popupGroundDistanceNm = a.groundDistanceNm;
    if (Number.isFinite(a.exposureTimeSec)) values.popupExposureTimeSec = a.exposureTimeSec;
    nextInput.aircraft[n].state = { ...nextInput.aircraft[n].state, popupDriver: settings[n].driver };
  }
  const result = { ...output, model: { ...POPUP_FLIGHT_V0_1, offsetModel: output.model }, aircraftResults, nextInput };
  // The page's on-demand request: the minimum-exposure angle of one aircraft (an Apply result, §13.5).
  const requested = input.popupRequest?.minimumExposure;
  if (requested !== undefined && requested !== null) {
    result.popupMinimumExposure = { aircraft: Number(requested), ...calculatePopupFlightMinimumExposureFull(result, String(requested)) };
  }
  return result;
}

// Editing session for the page's Worker (the Flight worker host contract): an Offset Flight session inside, so the
// repeated calls reuse its sub-solves.
export function createPopupFlightSession(options) {
  const offset = createOffsetFlightSession(options);
  return {
    calculate: (input) => popupFlight(input, (i) => offset.calculate(i)),
    lastStats: () => offset.lastStats(),
    prepare(nextInput) {
      popupFlight(nextInput, (i) => offset.calculate(i));
      return offset.lastStats();
    },
  };
}

// The minimum-exposure angle of aircraft n (an Apply result), on its flown BDP input.
export function calculatePopupFlightMinimumExposureFull(flightResult, number) {
  const a = flightResult.aircraftResults[number];
  const r = a?.result;
  if (!r?.profile?.canonicalInputs) return { status: "UNAVAILABLE", reason: "No Offset result" };
  return calculatePopupMinimumExposureFull({ bdp: bdpInputOf(r.profile), popup: { ...popState(r.resolved), popupG: a.popup?.popupG ?? POPUP_FLIGHT_V0_1.defaultPopupG } });
}

export function calculatePopupFlight(input) {
  return truncateBeOutput(calculatePopupFlightFull(input));
}
