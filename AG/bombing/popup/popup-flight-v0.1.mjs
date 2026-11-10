import { casToTas, machToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { OFFSET_FLIGHT_PROFILE_LINK, OFFSET_FLIGHT_V0_1, calculateOffsetFlightFull, createOffsetFlightSession, profileLinkStates } from "../offset-bombing/offset-flight-v0.1.mjs?v=0.1.15";
import { POPUP_BE_V0_2, assemblePopupAttack, calculatePopupMinimumExposureFull, defaultPopupAngleDeg, normalizePopupInput, resolvePopupAngle } from "./popup-be-v0.2.mjs?v=0.2.3";
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
//   state.popupDriver "DEFAULT" (automatic rule) | "ANGLE" | "GROUND_DISTANCE" | "EXPOSURE_TIME" (the last typed);
//   state.popupLocks { rollInSpeed, angle, distance } (0.1.7) override it ("ROLL_IN_SPEED", "ANGLE", "GROUND_DISTANCE");
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
  // 0.1.7 (owner 2026-11-03, SPEC §13.8i): the Roll-in Speed is AUTO — each aircraft's BDP starts its Roll-in at
  // its MIL arrival speed at Roll-in Start (iterated with the Roll-in Altitude) — unless LOCKed; three POP-UP LOCKs
  // per aircraft (state.popupLocks { rollInSpeed, angle, distance }): a LOCKed Roll-in Speed solves the Popup angle
  // for it ("ROLL_IN_SPEED"); a LOCKed angle or distance holds that driver; two LOCKs together are a conflict.
  // Typing a Roll-in Speed (initialSpeedValue) LOCKs it. "Pop with #1" (LEAD_POP_TIME) is removed (owner): a stored
  // one reads as DEFAULT.
  // 0.1.8 (owner 2026-11-03, SPEC §13.8j): Offset Flight 0.1.14's profile LINK — a linked #3 / #4 flies #1's / #2's POP-UP
  // too (its settings, angle and Roll-in Speed are its source's). A POP-UP edit of a linked aircraft (a value, a LOCK, AUTO,
  // Apply) turns its LINK off, as any other edit of it does.
  status: "work",
  offsetFlight: `${OFFSET_FLIGHT_V0_1.id} ${OFFSET_FLIGHT_V0_1.version}`,
  popupBe: `${POPUP_BE_V0_2.id} ${POPUP_BE_V0_2.version}`,
  // 0.1.9 (owner 2026-11-10, POP-UP SPEC §13.8o): when the climb does not fit, the planner fits it instead of INVALID —
  // a Hold-Down < 0 raises the entered Roll-in Altitude (not LOCKed, height mode) to the lowest one that fits; an
  // AUTO Popup angle whose pull-up arc passes the Roll-in Altitude is lowered to the steepest one that fits. Each is a
  // warning naming the change; the raised Roll-in Altitude is written back. A typed / LOCKed angle or a LOCKed Roll-in
  // Altitude stays INVALID with the value that would fit.
  version: "0.1.9",
  defaultPopupG: 3,
  angleIterations: 12,
  autoAngleMinDeg: 1,
  autoAngleToleranceDeg: 0.05,
  holdDownIterations: 8,
  holdDownTargetNm: 0.01,
  holdDownToleranceNm: 0.03,
  holdDownStepFt: 2000,
  holdDownMaxRaiseFt: 15000,
  speedSettleKt: 0.05,
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
// The POP-UP LOCK edits (0.1.7): { key: "popupLockRollInSpeed" | "popupLockAngle" | "popupLockDistance", value }.
// A typed Roll-in Speed (initialSpeedValue, not a clear) LOCKs it. The minimum-exposure Apply (popupAngleDeg with
// source "minimumExposure") releases the Roll-in Speed and distance LOCKs.
const POPUP_LOCK_OF_KEY = Object.freeze({ popupLockRollInSpeed: "rollInSpeed", popupLockAngle: "angle", popupLockDistance: "distance" });
function editedLocks(input) {
  const locks = {};
  for (const edit of editsOf(input)) {
    const number = String(edit?.aircraft ?? 1);
    if (POPUP_LOCK_OF_KEY[edit?.key]) (locks[number] ||= {})[POPUP_LOCK_OF_KEY[edit.key]] = edit.value === true;
    else if (edit?.key === "initialSpeedValue" && edit.kind !== "clear" && edit.kind !== "lock") (locks[number] ||= {}).rollInSpeed = true;
    else if (edit?.key === "popupAngleDeg" && edit.source === "minimumExposure") Object.assign((locks[number] ||= {}), { rollInSpeed: false, distance: false });
  }
  return locks;
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
function popupSettings(input, number, edited, cleared, lockEdits) {
  const own = input.aircraft[number] ?? {};
  const lead = input.aircraft[1] ?? {};
  const ownInputs = number === "1" || !blank(own.state?.popupDriver) || !!edited[number];
  const source = ownInputs ? own : lead;
  const valueOf = (record, n, key) => cleared[n]?.[key] ?? record.values?.[key];
  const sourceValue = (key) => valueOf(source, ownInputs ? number : "1", key);
  const pick = (key) => (blank(valueOf(own, number, key)) ? valueOf(lead, "1", key) : valueOf(own, number, key));
  const askedRaw = edited[number] ?? source.state?.popupDriver ?? (number === "1" ? undefined : edited["1"]) ?? "DEFAULT";
  const asked = askedRaw === "LEAD_POP_TIME" || askedRaw === "ROLL_IN_SPEED" ? "DEFAULT" : askedRaw;
  const stored = own.state?.popupLocks ?? {};
  const locks = { rollInSpeed: stored.rollInSpeed === true, angle: stored.angle === true, distance: stored.distance === true, ...(lockEdits[number] ?? {}) };
  // The LOCKs decide the driver; two together leave nothing to solve (a conflict, as the Roll-in Altitude LOCK's).
  const on = Object.entries(locks).filter(([, v]) => v).map(([k]) => k);
  const LOCK_NAME = { rollInSpeed: "Roll-in Speed", angle: "Popup Angle", distance: "Pop to Roll-in Distance" };
  const conflict = on.length > 1 ? `LOCK conflict: ${on.map((k) => LOCK_NAME[k]).join(" and ")} are both LOCKed; nothing is left to solve (release one)` : null;
  const lockedDriver = locks.rollInSpeed ? "ROLL_IN_SPEED" : locks.angle ? "ANGLE" : locks.distance ? "GROUND_DISTANCE" : null;
  const driver = conflict ? asked : lockedDriver ?? asked;
  const overridden = !conflict && lockedDriver && edited[number] && edited[number] !== "DEFAULT" && edited[number] !== lockedDriver
    ? `${LOCK_NAME[on[0]]} is LOCKed: the typed value is solved again (release the LOCK to drive it)` : null;
  return {
    driver,
    locks,
    conflict,
    overridden,
    rollInSpeedKcas: Number(pick("initialSpeedValue")),
    popupG: blank(pick("popupG")) ? POPUP_FLIGHT_V0_1.defaultPopupG : Number(pick("popupG")),
    popupAngleDeg: sourceValue("popupAngleDeg"),
    groundDistanceNm: sourceValue("popupGroundDistanceNm"),
    exposureTimeSec: sourceValue("popupExposureTimeSec"),
  };
}

// The Offset input with every aircraft's Roll-in from its angle at MIL (the POP-UP edits and request left out).
function withAngles(input, angles, speeds = {}, rollInAltitudes = {}) {
  const aircraft = {};
  for (const [key, record] of Object.entries(input.aircraft)) {
    const angle = angles[key];
    const speed = speeds[key];
    const rollIn = rollInAltitudes[key];
    aircraft[key] = angle === undefined
      ? record
      : { ...record, values: { ...record.values, rollInStartFpaDeg: angle, rollInSpeedModel: "MIL", ...(Number.isFinite(speed) ? { initialSpeedValue: speed, initialSpeedMode: "CAS" } : {}), ...(Number.isFinite(rollIn) ? { rollInAltitudeMslFt: rollIn } : {}) } };
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

const approachSpeedNmSec = (r) => r.resolved.offsetTasKt / 3600;

function flownAircraft(output) {
  return Object.entries(output.aircraftResults).filter(([, r]) => r.result?.profile?.canonicalInputs && (r.status === "VALID" || r.status === "WARNING"));
}

// The pull-up arc (0.1.9): whether an angle can be flown to the Roll-in Altitude, and the steepest one that can
// (bisection below the given angle; null when even a shallow one cannot).
function climbFits(climbInput, angleDeg) {
  try { calculatePopupClimbFull({ ...climbInput, popupAngleDeg: angleDeg }); return true; } catch { return false; }
}
function steepestFittingAngle(climbInput, upperDeg) {
  let lo = POPUP_FLIGHT_V0_1.autoAngleMinDeg;
  if (!(upperDeg > lo) || !climbFits(climbInput, lo)) return null;
  let hi = upperDeg;
  while (hi - lo > POPUP_FLIGHT_V0_1.autoAngleToleranceDeg) {
    const mid = (lo + hi) / 2;
    if (climbFits(climbInput, mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// Hold-Down of aircraft n in a solve (0.1.9): Approach Range − the climb's ground distance; `short` when negative or
// when the Offset already has its Turn End past the Roll-in Start; `failed` for any other error (no value).
function holdDownState(sol, n, settings) {
  const entry = sol.output.aircraftResults[n];
  const r = entry?.result;
  if (!r?.profile?.canonicalInputs || !(entry.status === "VALID" || entry.status === "WARNING")) {
    const turnPassed = (entry?.errors ?? []).some((e) => /Offset Turn End has passed Roll-in Start/.test(e));
    return { short: turnPassed, holdDownNm: null, failed: !turnPassed };
  }
  try {
    const climb = calculatePopupClimbFull({ ...popState(r.resolved), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupAngleDeg: sol.angles[n], popupG: settings.popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec });
    const holdDownNm = r.resolved.approachRangeNm - climb.groundDistanceNm;
    return { short: holdDownNm < 0, holdDownNm, failed: false };
  } catch {
    return { short: false, holdDownNm: null, failed: true };
  }
}

// The next Roll-in Altitude to try for a Hold-Down of 0 (0.1.9): false position between the highest short and the
// lowest fitting altitude, secant above them (the Hold-Down is nearly linear in the altitude), a fixed step when a
// value is missing; rounded up to 10 ft, never above the cap. null = nothing left to try.
function nextRollInAltitude(tried) {
  const cfg = POPUP_FLIGHT_V0_1;
  const cap = tried[0].alt + cfg.holdDownMaxRaiseFt;
  const fits = (x) => Number.isFinite(x.hd) && x.hd >= 0;
  const shortOnes = tried.filter((x) => !fits(x) && !x.failed);
  const fitting = tried.filter(fits);
  const lo = shortOnes.reduce((m, x) => (!m || x.alt > m.alt ? x : m), null);
  const hi = fitting.reduce((m, x) => (!m || x.alt < m.alt ? x : m), null);
  const up10 = (ft) => Math.ceil(ft / 10) * 10;
  let next;
  if (hi && lo) {
    if (hi.alt - lo.alt <= 10) return null;
    next = Number.isFinite(lo.hd) ? lo.alt + (hi.alt - lo.alt) * (-lo.hd) / (hi.hd - lo.hd) : (lo.alt + hi.alt) / 2;
    next = Math.min(Math.max(up10(next), lo.alt + 10), hi.alt - 10);
    if (next <= lo.alt || next >= hi.alt) return null;
    return next;
  }
  if (hi) return null;
  if (lo.alt >= cap) return null;
  // Not getting closer: two raises without a Hold-Down value, or a Hold-Down that does not grow with the altitude.
  const last = tried.slice(-2);
  if (last.length === 2 && last.every((x) => !Number.isFinite(x.hd))) return null;
  const finite = shortOnes.filter((x) => Number.isFinite(x.hd)).sort((a, b) => b.alt - a.alt);
  if (finite.length >= 2 && finite[0].hd !== finite[1].hd) {
    const slope = (finite[0].hd - finite[1].hd) / (finite[0].alt - finite[1].alt);
    if (!(slope > 0)) return null;
    next = finite[0].alt + (cfg.holdDownTargetNm - finite[0].hd) / slope;
  } else next = lo.alt + cfg.holdDownStepFt;
  next = Math.min(Math.max(next, lo.alt + 200), lo.alt + 2 * cfg.holdDownStepFt, cap);
  return up10(next);
}

export function calculatePopupFlightFull(input) {
  return popupFlight(input, calculateOffsetFlightFull);
}

// The output has the Offset Flight's shape (the page reuses the Offset controller): each aircraftResults[n] is the
// Offset's with the POP-UP status, errors and warnings merged in and `popup` added (angle, climb, events, checks,
// Pop Point, Hold-Down).
function popupFlight(rawInput, offsetFlight) {
  if (!rawInput?.aircraft?.[1]) throw new TypeError("POP-UP Flight input needs aircraft #1");
  // Profile LINK (0.1.8): the LINK after every edit of this request, the POP-UP edits included (the Offset Flight does
  // not see those), goes down with the records; a linked aircraft takes its source's POP-UP below.
  const linkStates = profileLinkStates(rawInput);
  const input = { ...rawInput, aircraft: { ...rawInput.aircraft } };
  for (const [n, on] of Object.entries(linkStates)) {
    const record = input.aircraft[n];
    if (record && (record.options?.profileLinked === true) !== on) input.aircraft[n] = { ...record, options: { ...record.options, profileLinked: on } };
  }
  const numbers = Object.keys(input.aircraft);
  const linkedTo = Object.fromEntries(numbers.filter((n) => linkStates[n] && input.aircraft[OFFSET_FLIGHT_PROFILE_LINK[n]]).map((n) => [n, String(OFFSET_FLIGHT_PROFILE_LINK[n])]));
  const edited = editedDrivers(input);
  const cleared = clearedValues(input);
  const lockEdits = editedLocks(input);
  const settings = Object.fromEntries(numbers.map((n) => [n, popupSettings(input, n, edited, cleared, lockEdits)]));
  for (const [n, source] of Object.entries(linkedTo)) settings[n] = { ...settings[source], locks: { ...settings[source].locks } };
  // One solve of every aircraft's angle and AUTO Roll-in Speed, at the given Roll-in Altitudes (0.1.9: raised ones
  // for the Hold-Down; {} = as entered).
  const solve = (rollInAltitudes = {}) => {
    // First angles: the driver's own value or the automatic rule on the aircraft's Dive.
    const angles = {};
    const ruleAngles = {};
    const lowered = {};
    for (const n of numbers) {
      const s = settings[n];
      const dive = Number(input.aircraft[n].values?.diveAngleDeg ?? input.aircraft[1].values?.diveAngleDeg);
      ruleAngles[n] = defaultPopupAngleDeg(dive);
      angles[n] = s.driver === "ANGLE" && Number.isFinite(Number(s.popupAngleDeg)) ? Number(s.popupAngleDeg) : ruleAngles[n];
    }
    const angleErrors = {};
    const solved = {};
    // Roll-in Speeds (0.1.7): a LOCKed one as entered; AUTO starts from the field and follows the MIL arrival.
    const speeds = {};
    for (const n of numbers) {
      if (settings[n].conflict) angleErrors[n] = settings[n].conflict;
      if (Number.isFinite(settings[n].rollInSpeedKcas)) speeds[n] = settings[n].rollInSpeedKcas;
    }
    // A linked aircraft flies its source's angle and Roll-in Speed (and its errors); it is not solved on its own.
    const followSources = () => {
      for (const [n, source] of Object.entries(linkedTo)) {
        angles[n] = angles[source];
        if (Number.isFinite(speeds[source])) speeds[n] = speeds[source];
        if (solved[source]) solved[n] = solved[source]; else delete solved[n];
        if (angleErrors[source]) angleErrors[n] = angleErrors[source]; else delete angleErrors[n];
        if (lowered[source]) lowered[n] = lowered[source]; else delete lowered[n];
      }
    };
    followSources();
    const autoSpeed = numbers.filter((n) => !linkedTo[n] && !settings[n].locks.rollInSpeed && !settings[n].conflict);
    let output = offsetFlight(withAngles(input, angles, speeds, rollInAltitudes));
    // AUTO Popup angle (0.1.9): the automatic rule's angle, lowered to the steepest one whose pull-up arc stays below
    // the Roll-in Altitude when the rule's angle cannot be flown.
    const autoAngle = numbers.filter((n) => !linkedTo[n] && !settings[n].conflict && settings[n].driver === "DEFAULT");
    const needsSolve = numbers.filter((n) => !linkedTo[n] && !settings[n].conflict && ["GROUND_DISTANCE", "EXPOSURE_TIME", "ROLL_IN_SPEED"].includes(settings[n].driver));
    for (let iteration = 0; (needsSolve.length || autoSpeed.length || autoAngle.length) && iteration < POPUP_FLIGHT_V0_1.angleIterations; iteration += 1) {
      let moved = false;
      for (const n of needsSolve) {
        const r = output.aircraftResults[n];
        if (!r?.result?.profile?.canonicalInputs) continue;
        const s = settings[n];
        try {
          const p = normalizePopupInput({ bdp: bdpInputOf(r.result.profile), popup: { ...popState(r.result.resolved), popupG: s.popupG, driver: s.driver, groundDistanceNm: Number(s.groundDistanceNm), exposureTimeSec: Number(s.exposureTimeSec), rollInSpeedKcas: speeds[n] } });
          const resolved = resolvePopupAngle(p);
          solved[n] = resolved;
          delete angleErrors[n];
          if (Math.abs(resolved.angleDeg - angles[n]) > POPUP_FLIGHT_V0_1.angleSettleDeg) moved = true;
          angles[n] = resolved.angleDeg;
        } catch (error) {
          angleErrors[n] = error.message;
        }
      }
      for (const n of autoAngle) {
        const r = output.aircraftResults[n]?.result;
        if (!r?.profile?.canonicalInputs) continue;
        const climbInput = { ...popState(r.resolved), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupG: settings[n].popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec };
        const ruleDeg = ruleAngles[n];
        let target = ruleDeg;
        if (!climbFits(climbInput, ruleDeg)) {
          const fit = steepestFittingAngle(climbInput, ruleDeg);
          if (fit === null) continue;
          target = fit;
          lowered[n] = { ruleDeg, angleDeg: fit };
        } else delete lowered[n];
        if (Math.abs(target - angles[n]) > POPUP_FLIGHT_V0_1.angleSettleDeg) moved = true;
        angles[n] = target;
      }
      // AUTO Roll-in Speed: the MIL arrival at this angle and Roll-in Altitude becomes the BDP's Roll-in Speed.
      for (const n of autoSpeed) {
        const r = output.aircraftResults[n]?.result;
        if (!r?.profile?.canonicalInputs || angleErrors[n]) continue;
        try {
          const arrival = calculatePopupClimbFull({ ...popState(r.resolved), rollInAltitudeMslFt: r.profile.public.resolvedInitialAltitudeMslFt, popupAngleDeg: angles[n], popupG: settings[n].popupG, gOnsetRateGSec: r.profile.canonicalInputs.gOnsetRateGSec }).rollInStart.casKt;
          if (!(Math.abs(arrival - speeds[n]) <= POPUP_FLIGHT_V0_1.speedSettleKt)) moved = true;
          speeds[n] = arrival;
        } catch { /* the climb error is reported below */ }
      }
      followSources();
      if (!moved) break;
      output = offsetFlight(withAngles(input, angles, speeds, rollInAltitudes));
    }
    return { output, angles, speeds, solved, angleErrors, lowered };
  };
  // Hold-Down (0.1.9, owner 2026-11-10): an aircraft whose climb is longer than its Approach (Hold-Down < 0) has its
  // Roll-in Altitude raised to the lowest one that fits — a higher Roll-in Start is farther from the Target, so the
  // Approach grows faster than the climb — when the Roll-in Altitude is entered (height mode) and not LOCKed.
  let sol = solve();
  const raised = {};
  const raiseable = (n) => {
    if (linkedTo[n] || settings[n].conflict) return false;
    const record = input.aircraft[n];
    const locked = n === "1" ? record.locks?.rollInAltitudeMslFt === true : record.options?.rollInAltitudeLocked === true;
    const profile = sol.output.aircraftResults[n]?.result?.profile;
    const mode = profile?.canonicalInputs?.solveMode ?? record.state?.solveMode ?? "height";
    return !locked && mode === "height" && Number.isFinite(Number(record.values?.rollInAltitudeMslFt));
  };
  const short = numbers.filter((n) => raiseable(n) && holdDownState(sol, n, settings[n]).short);
  if (short.length) {
    const tried = Object.fromEntries(short.map((n) => [n, [{ alt: Number(input.aircraft[n].values.rollInAltitudeMslFt), hd: holdDownState(sol, n, settings[n]).holdDownNm }]]));
    const overrides = {};
    const done = {};
    const best = {};
    for (let iteration = 0; iteration < POPUP_FLIGHT_V0_1.holdDownIterations; iteration += 1) {
      const active = short.filter((n) => !done[n]);
      if (!active.length) break;
      for (const n of active) {
        const next = nextRollInAltitude(tried[n]);
        if (next === null) { done[n] = true; continue; }
        overrides[n] = next;
      }
      if (active.every((n) => done[n])) break;
      const trial = solve({ ...overrides });
      for (const n of active) {
        if (done[n]) continue;
        const state = holdDownState(trial, n, settings[n]);
        tried[n].push({ alt: overrides[n], hd: state.holdDownNm, failed: state.failed });
        if (Number.isFinite(state.holdDownNm) && state.holdDownNm >= 0) {
          best[n] = overrides[n];
          if (state.holdDownNm <= POPUP_FLIGHT_V0_1.holdDownToleranceNm) done[n] = true;
        }
        if (state.failed) done[n] = true;
      }
    }
    for (const n of short) {
      // The lowest altitude tried that fits; else the solve stays as entered (its Hold-Down error stands).
      const ok = tried[n].filter((x) => Number.isFinite(x.hd) && x.hd >= 0).sort((a, b) => a.alt - b.alt)[0];
      if (ok) raised[n] = { fromFt: tried[n][0].alt, toFt: ok.alt };
    }
    if (Object.keys(raised).length) sol = solve(Object.fromEntries(Object.entries(raised).map(([n, r]) => [n, r.toFt])));
  }
  const { output, angles, speeds, solved, angleErrors, lowered } = sol;
  // 0.1.9: how a remaining Hold-Down < 0 could be fitted.
  const holdDownHint = (n) => (short.includes(n)
    ? "; raising the Roll-in Altitude does not fit it: lower the Offset Angle"
    : "; lower the Offset Angle, or raise the Roll-in Altitude (it is not raised automatically while LOCKed or solved from Tracking Time)");
  const aircraftResults = {};
  for (const n of numbers) {
    const offset = output.aircraftResults[n];
    const s = settings[n];
    const base = { driver: s.driver, popupG: s.popupG, popupAngleDeg: angles[n], ...(raised[n] ? { rollInAltitudeRaised: raised[n] } : {}), ...(lowered[n] ? { autoAngleLowered: lowered[n] } : {}), locks: s.locks, rollInSpeedSource: s.locks.rollInSpeed ? "LOCK" : "AUTO", rollInSpeedKcas: speeds[n] };
    const merge = (popup, errors, warnings) => {
      const status = errors.length ? "INVALID" : offset.status === "WARNING" || warnings.length ? "WARNING" : offset.status;
      return { ...offset, status, errors: [...(offset.errors ?? []), ...errors], warnings: [...(offset.warnings ?? []), ...warnings], popup: { ...base, ...popup } };
    };
    if (!offset) { aircraftResults[n] = { status: "FAILED", errors: ["No Offset result"], warnings: [], popup: base }; continue; }
    if (angleErrors[n]) { aircraftResults[n] = merge({}, [angleErrors[n]], []); continue; }
    if (!offset.result?.profile?.canonicalInputs || !(offset.status === "VALID" || offset.status === "WARNING")) {
      // 0.1.9: the Turn End past the Roll-in Start is the same shortage as a Hold-Down < 0; say how it could fit.
      const errors = (offset.errors ?? []).map((e) => (/Offset Turn End has passed Roll-in Start/.test(e) ? `${e}${holdDownHint(n)}` : e));
      aircraftResults[n] = { ...offset, errors, popup: base };
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
      // 0.1.9: the angle that would fit, for a typed / LOCKed angle (an AUTO one was lowered already).
      const fit = error.code === "ARC_PASSES_ROLL_IN"
        ? steepestFittingAngle({ ...pop, rollInAltitudeMslFt: bdp.public.resolvedInitialAltitudeMslFt, popupG: s.popupG, gOnsetRateGSec: bdp.canonicalInputs.gOnsetRateGSec }, angles[n]) : null;
      aircraftResults[n] = merge({}, [fit === null ? error.message : `${error.message}; at most ${fit.toFixed(1)}° fits at this Roll-in Altitude`], []);
      continue;
    }
    const errors = [];
    const warnings = s.overridden ? [s.overridden] : [];
    // 0.1.9: what the planner changed so the climb fits.
    if (raised[n]) warnings.push(`Roll-in Altitude raised ${Math.round(raised[n].fromFt).toLocaleString("en-US")} → ${Math.round(raised[n].toFt).toLocaleString("en-US")} ft so the climb fits the Approach (Hold-Down ≥ 0)`);
    if (lowered[n]) warnings.push(`Popup angle (AUTO) lowered ${lowered[n].ruleDeg.toFixed(1)}° → ${lowered[n].angleDeg.toFixed(1)}°: at ${lowered[n].ruleDeg.toFixed(1)}° the pull-up arc passes the Roll-in Altitude`);
    const attack = assemblePopupAttack({ p: { ...p, driver: s.driver }, rollInSpeedSource: s.locks.rollInSpeed ? "LOCK" : "AUTO", angleDeg: angles[n], otherSolutionsDeg: solved[n]?.otherSolutionsDeg ?? [], bdp, climb, errors, warnings });
    // Pop Point on the Approach leg, ground distance before Roll-in Start.
    const approachRangeNm = r.resolved.approachRangeNm;
    const holdDownNm = approachRangeNm - climb.groundDistanceNm;
    if (!(holdDownNm >= 0)) {
      errors.push(`Hold-Down ${holdDownNm.toFixed(2)} NM: the Popup ground distance ${climb.groundDistanceNm.toFixed(2)} NM is longer than the Approach Range ${approachRangeNm.toFixed(2)} NM${holdDownHint(n)}`);
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
    aircraftResults[n] = { ...merge({ ...popup, popPoint, approachRangeNm, holdDownNm, holdDownSec, popTimeSec, popToTargetNm, popAngleOffDeg }, errors, warnings), result: popupResult, ded };
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
    nextInput.aircraft[n].state = { ...nextInput.aircraft[n].state, popupDriver: settings[n].driver, popupLocks: { ...settings[n].locks } };
    // The AUTO Roll-in Speed is written back to the field (the Full value behind it).
    if (!settings[n].locks.rollInSpeed && Number.isFinite(speeds[n])) { values.initialSpeedValue = speeds[n]; values.initialSpeedMode = "CAS"; }
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
