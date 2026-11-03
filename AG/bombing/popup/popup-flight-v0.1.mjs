import { casToTas, machToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { OFFSET_FLIGHT_V0_1, calculateOffsetFlightFull, createOffsetFlightSession } from "../offset-bombing/offset-flight-v0.1.mjs?v=0.1.13";
import { POPUP_BE_V0_2, assemblePopupAttack, calculatePopupMinimumExposureFull, defaultPopupAngleDeg, normalizePopupInput, resolvePopupAngle } from "./popup-be-v0.2.mjs";
import { calculatePopupClimbFull } from "./popup-climb-v0.2.mjs";
import { computeDropOrderDeltaFull } from "../offset-bombing/offset-formation-v0.1.mjs";
import { dropOrderTiming } from "../../../flight/flight-bombing-tactics/flight-composition-v0.1.mjs";
import { leadImpactToWingmanReleaseSec } from "../../../flight/flight-bombing-tactics/formation-v0.1.mjs";

// POP-UP Flight v0.1 (owner 2026-10-27, POP-UP SPEC §13.1, step 3b): the Offset Flight (as is) with each aircraft's
// Roll-in flown from its Popup angle at MIL (BDP v0.4.5 POP-UP option), and the POP-UP climb in front of it.
//   Pop Point: on the Approach leg (Offset Turn End → Roll-in Start, the Offset heading), the Popup ground distance
//   before Roll-in Start; Hold-Down = Approach Range − ground distance, which must be ≥ 0 (an error, never clipped).
//   The Pop Point state is the Offset leg's: Offset Altitude and Offset Speed (§13.5).
// Per aircraft (values / state of the Offset record; blank follows #1, then the defaults):
//   state.popupDriver "DEFAULT" (automatic rule) | "ANGLE" | "GROUND_DISTANCE" | "EXPOSURE_TIME" | "LEAD_POP_TIME"
//   (#2–#4: Pop at #1's Pop time; the ground distance for it is Approach Range − (#1's Pop time − this aircraft's
//   Turn End time) × its Offset speed, and the angle is solved for that distance; #1 takes it as "DEFAULT");
//   values.popupAngleDeg / popupGroundDistanceNm / popupExposureTimeSec (the driver's value); values.popupG (3 G).
// The angle for a distance or a time is solved on the aircraft's BDP input from an Offset Flight at the previous
// angle, repeated until the angle settles (the Offset solve moves the Roll-in a little with the angle).
export const POPUP_FLIGHT_V0_1 = Object.freeze({
  id: "popup-flight-v0.1",
  // 0.1.2 (owner 2026-11-01): the POP-UP clock — each result's timing has its Approach as the Hold-Down (level, Offset
  // speed) then the climb, IP → Release and the drop-order timing follow it, and geometry.points.popPoint is set; the
  // Pop Point's range and angle-off to the Target and its time after IP; the follower driver "LEAD_POP_TIME" (pop at
  // #1's Pop time, the angle solved for it).
  // 0.1.3 (owner 2026-11-02): flightName (Offset Flight 0.1.11's formation name, attack type) with #1 Impact − #2
  // Release on the POP-UP clock. Metadata only.
  // 0.1.4 (owner 2026-11-02): Offset Flight 0.1.12 — #3's linked Longitudinal / Lateral Range edits, the Flight's Form
  // template edit and flightName.formation.places reach the POP-UP page through it. No POP-UP rule changes.
  // 0.1.5 (owner 2026-11-02, "Pop-up ded는 pop-up 포인트가 추가되고, oa2는 oa1과 같으나 타겟 고도이다"): each aircraft's
  // DED adds OA2 = its Pop Point, read like OA1 (RNG / TBRG from the same reference: the Target, or the Flight's VIP in
  // VIP mode) with ELEV = its Target Elevation.
  // 0.1.6 (owner 2026-11-03, confirming the reading offered): OA2 is OA1's point (the Roll-in Start, same RNG / TBRG)
  // with ELEV = the Target Elevation; the Pop Point is its own DED page `popUp` (TBRG / RNG from the same reference,
  // ELEV = Target Elevation), no longer OA2.
  version: "0.1.6",
  status: "work",
  offsetFlight: `${OFFSET_FLIGHT_V0_1.id} ${OFFSET_FLIGHT_V0_1.version}`,
  popupBe: `${POPUP_BE_V0_2.id} ${POPUP_BE_V0_2.version}`,
  defaultPopupG: 3,
  angleIterations: 8,
  angleSettleDeg: 0.01,
});

const DEG = Math.PI / 180;
const FT_PER_NM = 6076.11549;
const norm360 = (deg) => ((deg % 360) + 360) % 360;

// The Pop-up Point page (0.1.6; OA2 in 0.1.5): true bearing and range from OA1's reference (the Target; the Flight's VIP
// when #1 is in VIP mode), as the Offset Flight reads OA1, with ELEV = the aircraft's Target Elevation.
function popPointDedPage(base, popPoint, targetElevationMslFt) {
  const rangeNm = Math.hypot(popPoint.x - base.x, popPoint.y - base.y);
  return { point: "POP", bearingDeg: norm360(Math.atan2(popPoint.x - base.x, popPoint.y - base.y) / DEG), rangeNm, rangeFt: rangeNm * FT_PER_NM, elevationFt: targetElevationMslFt };
}
const blank = (value) => value === null || value === undefined || value === "";

// The page's POP-UP edits (FE edit events, as Offset's, for any aircraft): a typed angle / distance / time becomes
// that aircraft's driver; { key: "popupDriver", value: "DEFAULT" } goes back to the automatic rule. A field emptied
// and committed ({ kind: "clear" }) keeps the driver and takes back its value from the start of the edit (else the
// edit's fallback), which is written back to the field. They are the POP-UP's, so they are not passed to the
// Offset Flight.
const POPUP_DRIVER_OF_KEY = Object.freeze({ popupAngleDeg: "ANGLE", popupGroundDistanceNm: "GROUND_DISTANCE", popupExposureTimeSec: "EXPOSURE_TIME" });
const isPopupEdit = (edit) => typeof edit?.key === "string" && edit.key.startsWith("popup");
const editsOf = (input) => [...(input.edit ? [input.edit] : []), ...(input.edits ?? [])];
function editedDrivers(input) {
  const drivers = {};
  for (const edit of editsOf(input)) {
    if (!isPopupEdit(edit) || edit.kind === "clear") continue;
    const number = String(edit.aircraft ?? 1);
    if (edit.key === "popupDriver") drivers[number] = edit.value ?? "DEFAULT";
    else if (POPUP_DRIVER_OF_KEY[edit.key]) drivers[number] = POPUP_DRIVER_OF_KEY[edit.key];
  }
  return drivers;
}
function clearedValues(input) {
  const cleared = {};
  for (const edit of editsOf(input)) {
    if (!isPopupEdit(edit) || edit.kind !== "clear") continue;
    const value = [edit.before?.value, edit.fallbackValue].find((v) => typeof v === "number" && Number.isFinite(v));
    if (value === undefined) continue;
    (cleared[String(edit.aircraft ?? 1)] ||= {})[edit.key] = value;
  }
  return cleared;
}

// Per aircraft: its own values, else #1's (a follower without its own POP-UP inputs flies #1's), then the defaults.
// A blank Popup G follows #1's.
function popupSettings(input, number, edited, cleared) {
  const own = input.aircraft[number] ?? {};
  const lead = input.aircraft[1] ?? {};
  const ownInputs = number === "1" || !blank(own.state?.popupDriver) || !!edited[number];
  const source = ownInputs ? own : lead;
  const valueOf = (record, n, key) => cleared[n]?.[key] ?? record.values?.[key];
  const sourceValue = (key) => valueOf(source, ownInputs ? number : "1", key);
  const pick = (key) => (blank(valueOf(own, number, key)) ? valueOf(lead, "1", key) : valueOf(own, number, key));
  const asked = edited[number] ?? source.state?.popupDriver ?? (number === "1" ? undefined : edited["1"]) ?? "DEFAULT";
  const driver = asked === "LEAD_POP_TIME" && (number === "1" || !ownInputs) ? "DEFAULT" : asked;
  return {
    driver,
    popupG: blank(pick("popupG")) ? POPUP_FLIGHT_V0_1.defaultPopupG : Number(pick("popupG")),
    popupAngleDeg: sourceValue("popupAngleDeg"),
    groundDistanceNm: sourceValue("popupGroundDistanceNm"),
    exposureTimeSec: sourceValue("popupExposureTimeSec"),
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

// Seconds after IP at the Pop Point at this angle: IP → Turn End on the Offset clock, then the Hold-Down at the
// Offset speed (the Approach Range less the climb's ground distance).
function popTimeAt(r, angleDeg, popupG) {
  const bdp = r.profile;
  const climb = calculatePopupClimbFull({ ...popState(r.resolved), rollInAltitudeMslFt: bdp.public.resolvedInitialAltitudeMslFt, popupAngleDeg: angleDeg, popupG, gOnsetRateGSec: bdp.canonicalInputs.gOnsetRateGSec });
  const speed = approachSpeedNmSec(r);
  return r.timing.ingressSec + r.timing.offsetTurnSec + (r.resolved.approachRangeNm - climb.groundDistanceNm) / speed;
}
const approachSpeedNmSec = (r) => r.resolved.offsetTasKt / 3600;

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
  const cleared = clearedValues(input);
  const settings = Object.fromEntries(numbers.map((n) => [n, popupSettings(input, n, edited, cleared)]));
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
  const needsSolve = numbers.filter((n) => ["GROUND_DISTANCE", "EXPOSURE_TIME", "LEAD_POP_TIME"].includes(settings[n].driver));
  const leadPop = {};
  for (let iteration = 0; needsSolve.length && iteration < POPUP_FLIGHT_V0_1.angleIterations; iteration += 1) {
    let moved = false;
    for (const n of needsSolve) {
      const r = output.aircraftResults[n];
      if (!r?.result?.profile?.canonicalInputs) continue;
      const s = settings[n];
      try {
        let groundDistanceNm = Number(s.groundDistanceNm);
        if (s.driver === "LEAD_POP_TIME") {
          const lead = output.aircraftResults[1]?.result;
          if (!lead?.profile?.canonicalInputs) throw new Error("Pop with #1: #1 has no result");
          const leadPopSec = popTimeAt(lead, angles["1"], settings["1"].popupG);
          const turnEndSec = r.result.timing.ingressSec + r.result.timing.offsetTurnSec;
          groundDistanceNm = r.result.resolved.approachRangeNm - (leadPopSec - turnEndSec) * approachSpeedNmSec(r.result);
          leadPop[n] = { leadPopSec, groundDistanceNm };
          if (!(groundDistanceNm > 0)) throw new RangeError(`Pop with #1: #1 pops at IP +${leadPopSec.toFixed(1)} s, after this aircraft's Roll-in Start would be reached (needed ground distance ${groundDistanceNm.toFixed(2)} NM)`);
        }
        const solveDriver = s.driver === "LEAD_POP_TIME" ? "GROUND_DISTANCE" : s.driver;
        const p = normalizePopupInput({ bdp: bdpInputOf(r.result.profile), popup: { ...popState(r.result.resolved), popupG: s.popupG, driver: solveDriver, groundDistanceNm, exposureTimeSec: Number(s.exposureTimeSec) } });
        const resolved = resolvePopupAngle(p);
        solved[n] = resolved;
        delete angleErrors[n];
        if (Math.abs(resolved.angleDeg - angles[n]) > POPUP_FLIGHT_V0_1.angleSettleDeg) moved = true;
        angles[n] = resolved.angleDeg;
      } catch (error) {
        angleErrors[n] = s.driver === "LEAD_POP_TIME" && !/^Pop with #1/.test(error.message) ? `Pop with #1: ${error.message}` : error.message;
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
    const holdDownSec = Math.max(0, holdDownNm) / approachSpeedNmSec(r);
    const popTimeSec = r.timing.ingressSec + r.timing.offsetTurnSec + holdDownSec;
    // At the Pop Point (heading = the Approaching Heading): range to the Target and the angle-off, the Target's
    // bearing from the Pop Point relative to the heading (right +).
    const target = r.geometry.points.target;
    const popToTargetNm = Math.hypot(target.x - popPoint.x, target.y - popPoint.y);
    let popAngleOffDeg = (Math.atan2(target.x - popPoint.x, target.y - popPoint.y) / DEG) - r.geometry.offsetHeadingDeg;
    popAngleOffDeg -= 360 * Math.round(popAngleOffDeg / 360);
    if (leadPop[n]) {
      const offSec = popTimeSec - leadPop[n].leadPopSec;
      if (Math.abs(offSec) > 0.05) warnings.push(`Pop with #1: ${Math.abs(offSec).toFixed(1)} s ${offSec > 0 ? "after" : "before"} #1's Pop`);
    }
    // The POP-UP clock (0.1.2): the Approach is the Hold-Down then the climb; IP → Release follows it.
    const climbSec = climb.climbTimeSec;
    const approachSec = holdDownSec + climbSec;
    const timing = { ...r.timing, offsetApproachLevelSec: r.timing.approachSec, popupHoldDownSec: holdDownSec, popupClimbSec: climbSec, popupPopSec: popTimeSec,
      approachSec, offsetIpToReleaseSec: r.timing.offsetIpToReleaseSec - r.timing.approachSec + approachSec };
    const popupResult = { ...r, timing, geometry: { ...r.geometry, points: { ...r.geometry.points, popPoint } } };
    const { status, errors: attackErrors, warnings: attackWarnings, bdp: _bdp, ...popup } = attack;
    // DED (0.1.6): the Pop-up Point page from OA1's reference (the Flight's VIP, #1's, in VIP mode, else the Target);
    // OA2 = OA1's point at the Target Elevation.
    const flightLead = output.aircraftResults[1]?.result;
    const dedBase = flightLead?.referenceMode === "VIP" ? flightLead.geometry.points.vip : target;
    const ded = offset.ded ? { ...offset.ded, popUp: popPointDedPage(dedBase, popPoint, bdp.canonicalInputs.targetElevationMslFt) } : offset.ded;
    aircraftResults[n] = { ...merge({ ...popup, popPoint, approachRangeNm, holdDownNm, holdDownSec, popTimeSec, popToTargetNm, popAngleOffDeg, ...(leadPop[n] ? { leadPopSec: leadPop[n].leadPopSec } : {}) }, errors, warnings), result: popupResult, ded };
  }
  // DED OA2 (0.1.6, owner): OA1's point (same RNG / TBRG) with ELEV = the aircraft's Target Elevation, wherever the
  // aircraft has an OA1 (with or without a Pop Point).
  for (const n of numbers) {
    const entry = aircraftResults[n];
    const targetElevationMslFt = entry?.result?.profile?.canonicalInputs?.targetElevationMslFt;
    if (!entry?.ded?.oa1 || typeof targetElevationMslFt !== "number") continue;
    entry.ded = { ...entry.ded, oa2: { ...entry.ded.oa1, elevationFt: targetElevationMslFt } };
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
  // Drop-order timing on the POP-UP clock.
  const flightTiming = dropOrderTiming(output.flightSize, aircraftResults, computeDropOrderDeltaFull);
  // The file-name metadata: the Offset Flight's formation name and attack type, #1 Impact − #2 Release on this clock.
  const flightName = output.flightName ? { ...output.flightName, leadImpactToWingmanReleaseSec: leadImpactToWingmanReleaseSec(flightTiming) } : null;
  const result = { ...output, model: { ...POPUP_FLIGHT_V0_1, offsetModel: output.model }, aircraftResults, flightTiming, flightName, nextInput };
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
