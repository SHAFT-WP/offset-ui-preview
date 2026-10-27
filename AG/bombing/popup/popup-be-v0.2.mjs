import { tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { POPUP_CLIMB_V0_2, calculatePopupClimbFull } from "./popup-climb-v0.2.mjs";

// POP-UP BE v0.2 (owner 2026-10-27, POP-UP SPEC §13): the POP-UP attack from the Pop Point to the Release.
//   Pop Point → Roll-in Start: popup-climb-v0.2 (MIL, pull-up with onsets, the Popup angle held).
//   Roll-in Start → Release: BDP v0.4.5 with the POP-UP Roll-in option (Roll-in from the Popup angle at the entered
//   Roll-in Speed, TAS at MIL; Pull Down, Apex); Track, Release, NLT, SEM as the BDP.
// The Popup angle comes from one driver (§13.5): "DEFAULT" (the automatic rule: Dive ≤ 15° → Dive + 5°, else
// Dive + 10°; owner 2026-10-27), "ANGLE", "GROUND_DISTANCE" (Pop Point → Roll-in Start, horizontal) or
// "EXPOSURE_TIME" (Pop Point → Apex). The other two are results. The minimum-exposure angle is a separate call
// (calculatePopupMinimumExposureFull), shown with an Apply (§13.5).
// Checks: the MIL arrival speed at Roll-in Start against the entered Roll-in Speed (§13.3); the Apex speed below
// 250 KCAS is a warning only (§13.3). No G limit check (§13.9 item 9).
export const POPUP_BE_V0_2 = Object.freeze({
  id: "popup-be-v0.2",
  version: "0.2.0",
  status: "Work / Not Official",
  bdpModel: `${BOMB_DELIVERY_PLANNER_MODEL_V0_4.id} ${BOMB_DELIVERY_PLANNER_MODEL_V0_4.version}`,
  climbModel: `${POPUP_CLIMB_V0_2.id} ${POPUP_CLIMB_V0_2.version}`,
  drivers: Object.freeze(["DEFAULT", "ANGLE", "GROUND_DISTANCE", "EXPOSURE_TIME"]),
  apexSpeedWarningKcas: 250,
  // Angle search for the distance / time drivers and the minimum exposure: a scan, then refinement.
  angleScanDeg: Object.freeze([2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 54.9]),
  angleToleranceDeg: 0.01,
});

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// The automatic Popup angle rule (POP-UP SPEC §11.2, default driver §13.5).
export function defaultPopupAngleDeg(diveAngleDeg) {
  return diveAngleDeg <= 15 ? diveAngleDeg + 5 : diveAngleDeg + 10;
}

export function normalizePopupInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("POP-UP input must be an object");
  const bdp = input.bdp;
  if (!bdp || typeof bdp !== "object") throw new TypeError("bdp (the BDP v0.4 input of the Roll-in onward) is required");
  if ((bdp.initialSpeedMode ?? "CAS") !== "CAS") throw new RangeError("POP-UP takes the Roll-in Speed in KCAS (initialSpeedMode CAS)");
  const popup = input.popup ?? {};
  const driver = popup.driver ?? "DEFAULT";
  if (!POPUP_BE_V0_2.drivers.includes(driver)) throw new RangeError(`driver must be one of ${POPUP_BE_V0_2.drivers.join(", ")}`);
  return {
    bdp,
    driver,
    popAltitudeMslFt: finite("popAltitudeMslFt", popup.popAltitudeMslFt),
    popSpeedKcas: finite("popSpeedKcas", popup.popSpeedKcas),
    popupG: finite("popupG", popup.popupG ?? 3),
    popupAngleDeg: driver === "ANGLE" ? finite("popupAngleDeg", popup.popupAngleDeg) : null,
    groundDistanceNm: driver === "GROUND_DISTANCE" ? finite("groundDistanceNm", popup.groundDistanceNm) : null,
    exposureTimeSec: driver === "EXPOSURE_TIME" ? finite("exposureTimeSec", popup.exposureTimeSec) : null,
  };
}

// One Popup angle flown end to end: the BDP from the Popup angle (its resolved Roll-in Altitude), then the climb to it.
function flyAngle(p, angleDeg) {
  const bdp = calculateBombDeliveryV0_4Full({ ...p.bdp, rollInStartFpaDeg: angleDeg, rollInSpeedModel: "MIL" });
  const rollInAltitudeMslFt = bdp.public.resolvedInitialAltitudeMslFt;
  const climb = calculatePopupClimbFull({
    popAltitudeMslFt: p.popAltitudeMslFt,
    popSpeedKcas: p.popSpeedKcas,
    rollInAltitudeMslFt,
    popupAngleDeg: angleDeg,
    popupG: p.popupG,
    gOnsetRateGSec: bdp.canonicalInputs.gOnsetRateGSec,
  });
  const apex = bdp.public.rollInPopUp.apex;
  return {
    angleDeg,
    bdp,
    climb,
    groundDistanceNm: climb.groundDistanceNm,
    exposureTimeSec: apex ? climb.climbTimeSec + apex.timeSec : null,
  };
}

// The climb alone for a ground distance (it does not depend on the Roll-in): the Roll-in Altitude must be known.
function groundDistanceAt(p, rollInAltitudeMslFt, angleDeg) {
  return calculatePopupClimbFull({
    popAltitudeMslFt: p.popAltitudeMslFt, popSpeedKcas: p.popSpeedKcas, rollInAltitudeMslFt, popupAngleDeg: angleDeg, popupG: p.popupG,
    gOnsetRateGSec: p.bdp.gOnsetRateGSec ?? 2,
  }).groundDistanceNm;
}

// Bisection on the angle for f(angle) = 0 between two scan points of opposite sign.
function bisectAngle(f, a, b, fa) {
  let lo = a;
  let hi = b;
  let fLo = fa;
  while (hi - lo > POPUP_BE_V0_2.angleToleranceDeg) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(fLo)) { lo = mid; fLo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

// Scan values of f over the angle scan, skipping angles that cannot be flown (their error kept).
function scan(f) {
  return POPUP_BE_V0_2.angleScanDeg.map((angleDeg) => {
    try { return { angleDeg, value: f(angleDeg) }; } catch (error) { return { angleDeg, value: null, error: error.message }; }
  });
}

export function resolvePopupAngle(p) {
  const diveAngleDeg = finite("diveAngleDeg", p.bdp.diveAngleDeg);
  if (p.driver === "DEFAULT") return { angleDeg: defaultPopupAngleDeg(diveAngleDeg), note: "automatic rule" };
  if (p.driver === "ANGLE") return { angleDeg: p.popupAngleDeg };
  if (p.driver === "GROUND_DISTANCE") {
    if (!(p.groundDistanceNm > 0)) throw new RangeError("Popup ground distance must be > 0 NM");
    // The Roll-in Altitude is the entered one in height mode; in time mode the BDP solves it for each angle.
    const heightMode = (p.bdp.solveMode ?? "height") === "height" && diveAngleDeg > 0;
    const rollInAltitudeAt = (angleDeg) => (heightMode
      ? finite("initialAltitudeMslFt", p.bdp.initialAltitudeMslFt)
      : calculateBombDeliveryV0_4Full({ ...p.bdp, rollInStartFpaDeg: angleDeg, rollInSpeedModel: "MIL" }).public.resolvedInitialAltitudeMslFt);
    const f = (angleDeg) => groundDistanceAt(p, rollInAltitudeAt(angleDeg), angleDeg) - p.groundDistanceNm;
    const points = scan(f);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (a.value !== null && b.value !== null && Math.sign(a.value) !== Math.sign(b.value)) return { angleDeg: bisectAngle(f, a.angleDeg, b.angleDeg, a.value) };
      if (b.value === 0) return { angleDeg: b.angleDeg };
    }
    const reachable = points.filter((x) => x.value !== null).map((x) => x.value + p.groundDistanceNm);
    throw new RangeError(`No Popup angle gives a ground distance of ${p.groundDistanceNm} NM (reachable ${Math.min(...reachable).toFixed(2)}–${Math.max(...reachable).toFixed(2)} NM)`);
  }
  // EXPOSURE_TIME: not monotonic in the angle; the smallest angle with the time is used and the others are listed.
  if (!(p.exposureTimeSec > 0)) throw new RangeError("Popup exposure time must be > 0 s");
  const f = (angleDeg) => {
    const fly = flyAngle(p, angleDeg);
    if (fly.exposureTimeSec === null) throw new Error("no Apex");
    return fly.exposureTimeSec - p.exposureTimeSec;
  };
  const points = scan(f);
  const roots = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.value !== null && b.value !== null && Math.sign(a.value) !== Math.sign(b.value)) roots.push(bisectAngle(f, a.angleDeg, b.angleDeg, a.value));
  }
  if (!roots.length) {
    const flown = points.filter((x) => x.value !== null);
    const best = flown.reduce((m, x) => (!m || x.value < m.value ? x : m), null);
    throw new RangeError(`No Popup angle gives an exposure time of ${p.exposureTimeSec} s${best ? ` (the shortest on the scan is ${(best.value + p.exposureTimeSec).toFixed(1)} s at ${best.angleDeg}°; see the minimum exposure)` : ""}`);
  }
  return { angleDeg: roots[0], otherSolutionsDeg: roots.slice(1) };
}

function event(name, fields) {
  return { name, ...fields };
}

export function calculatePopupFull(input) {
  const p = normalizePopupInput(input);
  const errors = [];
  const warnings = [];
  let resolved;
  try {
    resolved = resolvePopupAngle(p);
  } catch (error) {
    return { model: { ...POPUP_BE_V0_2 }, status: "INVALID", errors: [error.message], warnings, driver: p.driver };
  }
  const angleDeg = resolved.angleDeg;
  const [lo, hi] = POPUP_CLIMB_V0_2.angleDomainDeg;
  if (!(angleDeg > lo && angleDeg < hi)) {
    return { model: { ...POPUP_BE_V0_2 }, status: "INVALID", errors: [`Popup angle ${angleDeg.toFixed(1)}° is outside ${lo}°–${hi}° (not clamped)`], warnings, driver: p.driver, popupAngleDeg: angleDeg };
  }
  let fly;
  try {
    fly = flyAngle(p, angleDeg);
  } catch (error) {
    return { model: { ...POPUP_BE_V0_2 }, status: "INVALID", errors: [error.message], warnings, driver: p.driver, popupAngleDeg: angleDeg };
  }
  return {
    model: { ...POPUP_BE_V0_2 },
    ...assemblePopupAttack({ p, angleDeg, otherSolutionsDeg: resolved.otherSolutionsDeg ?? [], bdp: fly.bdp, climb: fly.climb, errors, warnings }),
  };
}

// The checks, events and result fields of one flown POP-UP attack (climb + BDP from the Popup angle); the POP-UP
// Flight (Offset composition) builds each aircraft's with it.
export function assemblePopupAttack({ p, angleDeg, otherSolutionsDeg = [], bdp, climb, errors = [], warnings = [] }) {
  const pu = bdp.public.rollInPopUp;
  const resolved = { otherSolutionsDeg };
  const rollInSpeedKcas = bdp.canonicalInputs.initialSpeedValue;
  // §13.3: MIL arrival at Roll-in Start against the entered Roll-in Speed (the Roll-in starts at the entered one).
  const arrivalKcas = climb.rollInStart.casKt;
  const marginKt = arrivalKcas - rollInSpeedKcas;
  const speedCheck = marginKt >= 0
    ? { status: "MIL_OK", arrivalKcas, rollInSpeedKcas, marginKt }
    : { status: "MIL_SHORT", arrivalKcas, rollInSpeedKcas, marginKt, abJudgement: "UNAVAILABLE" };
  if (speedCheck.status === "MIL_SHORT") {
    warnings.push(`MIL arrives at Roll-in Start ${Math.abs(marginKt).toFixed(0)} kt below the Roll-in Speed (${arrivalKcas.toFixed(0)} / ${rollInSpeedKcas.toFixed(0)} KCAS); whether AB reaches it is not judged (no AB performance model)`);
  }
  const apexKcas = pu.apex ? tasToCas(pu.apex.tasKt, pu.apex.altitudeMslFt) : null;
  if (apexKcas !== null && apexKcas < POPUP_BE_V0_2.apexSpeedWarningKcas) warnings.push(`Apex speed ${apexKcas.toFixed(0)} KCAS is below ${POPUP_BE_V0_2.apexSpeedWarningKcas} KCAS`);
  if (pu.apexBeforePullDown) warnings.push("The Apex comes before the Pull Down (shallow Popup angle)");
  if (resolved.otherSolutionsDeg?.length) warnings.push(`Other Popup angles with the same exposure time: ${resolved.otherSolutionsDeg.map((a) => `${a.toFixed(1)}°`).join(", ")}`);
  // A note, not a warning: BOX OUT reports its envelope the same way (the model is a research model throughout).
  const notes = climb.performanceDomain.outsideDomainStates || pu.performanceDomain?.outsideDomainStates
    ? ["The MIL model is extrapolated outside its research envelope on part of the path (research model, not BMS-validated)"]
    : [];
  const t0 = climb.climbTimeSec;
  const events = [
    event("POP", { timeSec: 0, altitudeMslFt: climb.pop.altitudeMslFt, kcas: climb.pop.casKt }),
    event("PULL_UP_END", { timeSec: climb.pullUp.end.timeSec, altitudeMslFt: climb.pullUp.end.altitudeMslFt, kcas: climb.pullUp.end.casKt }),
    event("ROLL_IN_START", { timeSec: t0, altitudeMslFt: climb.rollInStart.altitudeMslFt, kcas: rollInSpeedKcas, milArrivalKcas: arrivalKcas }),
    event("PULL_DOWN", { timeSec: t0 + pu.pullDown.timeSec, altitudeMslFt: pu.pullDown.altitudeMslFt, kcas: tasToCas(pu.pullDown.tasKt, pu.pullDown.altitudeMslFt), fpaDeg: pu.pullDown.fpaDeg }),
    ...(pu.apex ? [event("APEX", { timeSec: t0 + pu.apex.timeSec, altitudeMslFt: pu.apex.altitudeMslFt, kcas: apexKcas })] : []),
    event("TRACK_POINT", { timeSec: t0 + bdp.public.rollInTimeSec, altitudeMslFt: bdp.public.trackPointAltitudeMslFt }),
    event("RELEASE", { timeSec: t0 + bdp.public.rollInTimeSec + bdp.public.trackingTimeSec, altitudeMslFt: bdp.public.effectiveReleaseAltitudeMslFt, kcas: bdp.canonicalInputs.releaseSpeedKcas }),
  ];
  return {
    status: errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID",
    errors,
    warnings,
    notes,
    driver: p.driver,
    popupAngleDeg: angleDeg,
    groundDistanceNm: climb.groundDistanceNm,
    exposureTimeSec: pu.apex ? climb.climbTimeSec + pu.apex.timeSec : null,
    otherSolutionsDeg: resolved.otherSolutionsDeg ?? [],
    popupG: p.popupG,
    speedCheck,
    apexKcas,
    events,
    climb,
    bdp,
  };
}

// The Popup angle with the shortest exposure (Pop Point → Apex) and that time (§13.5; a reference result with an
// Apply): the scan, then golden-section refinement around its best point.
export function calculatePopupMinimumExposureFull(input) {
  const p = normalizePopupInput({ ...input, popup: { ...(input?.popup ?? {}), driver: "DEFAULT" } });
  const exposure = (angleDeg) => {
    const t = flyAngle(p, angleDeg).exposureTimeSec;
    if (t === null) throw new Error("no Apex");
    return t;
  };
  const points = scan(exposure).filter((x) => x.value !== null);
  if (!points.length) return { status: "UNAVAILABLE", reason: "No Popup angle on the scan can be flown" };
  const i = points.reduce((best, x, k) => (x.value < points[best].value ? k : best), 0);
  let a = points[Math.max(0, i - 1)].angleDeg;
  let b = points[Math.min(points.length - 1, i + 1)].angleDeg;
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  let fc = exposure(c);
  let fd = exposure(d);
  while (b - a > POPUP_BE_V0_2.angleToleranceDeg * 10) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = exposure(c); } else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = exposure(d); }
  }
  const angleDeg = fc < fd ? c : d;
  const exposureTimeSec = Math.min(fc, fd);
  return { status: "VALID", angleDeg, exposureTimeSec, scan: points.map(({ angleDeg: x, value }) => ({ angleDeg: x, exposureTimeSec: value })) };
}

export function calculatePopup(input) {
  return truncateBeOutput(calculatePopupFull(input));
}
export function calculatePopupMinimumExposure(input) {
  return truncateBeOutput(calculatePopupMinimumExposureFull(input));
}

