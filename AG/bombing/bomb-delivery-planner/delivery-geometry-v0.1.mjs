import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { groundSpeedAlongPath, windComponents } from "./flight-path-wind-v0.1.mjs";
import { integrateRollIn } from "./roll-in-v0.1.mjs";

const KT_TO_FPS = 1.687809857;

// `rollIn` (optional, BDP v0.4 2026-10-15): another Roll-in integrator with the same contract, e.g. Roll-in v0.2.
// Omitted, the v0.1 integrator runs exactly as before.
export function calculateDeliveryGeometry({ input, bomb, effectiveReleaseAltitudeMslFt, rollIn = integrateRollIn }) {
  const angleRad = (input.diveAngleDeg * Math.PI) / 180;
  const levelDelivery = Math.abs(input.diveAngleDeg) < 1e-9;
  const releaseAglFt = effectiveReleaseAltitudeMslFt - input.targetElevationMslFt;
  const releaseTasKt = casToTas(input.releaseSpeedKcas, effectiveReleaseAltitudeMslFt);
  // Tracking flies the ground-referenced Dive Angle line (SPEC §8): its length is geometric and it is
  // covered at ground speed, the mean of the roll-out and release ground speeds (still air: TAS).
  const wind = windComponents(input.windDirectionDeg ?? 0, input.windSpeedKt ?? 0);
  const trackGroundSpeedKt = (tasKt) => groundSpeedAlongPath({
    airspeed: tasKt, pathAngleDeg: input.diveAngleDeg, windAlong: wind.along, windCross: wind.cross,
  });
  const meanTrackSpeedFps = (rolloutTasKt) =>
    ((trackGroundSpeedKt(rolloutTasKt) + trackGroundSpeedKt(releaseTasKt)) / 2) * KT_TO_FPS;
  let initialAglFt;
  let initialMslFt;
  let trackAglFt;
  let pathFt;
  let trackingTimeSec;
  let roll;

  const rollParams = {
    initialSpeedValue: input.initialSpeedValue,
    initialSpeedMode: input.initialSpeedMode,
    diveAngleDeg: input.diveAngleDeg,
    angleOffDeg: input.angleOffDeg,
    rollInBankAngleDeg: input.rollInBankAngleDeg,
    rollInG: input.rollInG,
    ...(input.rollInOnset ?? {}),
  };

  if (levelDelivery) {
    trackingTimeSec = input.enteredTrackingTimeSec;
    initialAglFt = releaseAglFt;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      initialMslFt = input.targetElevationMslFt + initialAglFt;
      roll = rollIn(rollParams, initialMslFt);
      initialAglFt = releaseAglFt + roll.altitudeLossFt;
    }
    initialMslFt = input.targetElevationMslFt + initialAglFt;
    roll = rollIn(rollParams, initialMslFt);
    trackAglFt = initialAglFt - roll.altitudeLossFt;
    pathFt = meanTrackSpeedFps(roll.finalTasKt) * trackingTimeSec;
  } else if (input.solveMode === "height") {
    initialMslFt = input.enteredInitialAltitudeMslFt;
    initialAglFt = initialMslFt - input.targetElevationMslFt;
    roll = rollIn(rollParams, initialMslFt);
    trackAglFt = initialAglFt - roll.altitudeLossFt;
    // Track Point below Release: an error, or (allowNegativeTrackingTime) a negative path and
    // Tracking Time — the shortfall the pilot adds to the Roll-in Altitude.
    if (!(trackAglFt > releaseAglFt) && !input.allowNegativeTrackingTime) throw new Error("Initial altitude minus roll-in loss is below effective Release altitude");
    pathFt = (trackAglFt - releaseAglFt) / Math.sin(angleRad);
    trackingTimeSec = pathFt / meanTrackSpeedFps(roll.finalTasKt);
  } else {
    trackingTimeSec = input.enteredTrackingTimeSec;
    initialAglFt = releaseAglFt + trackingTimeSec * releaseTasKt * KT_TO_FPS * Math.sin(angleRad) + 2500;
    // Initial AGL is the fixed point of next(x) = Release AGL + tracking climb + Roll-in loss at x.
    // Secant on next(x) − x from the first damped step (core 0.2.12, 2026-10-12): about 6 Roll-in
    // integrations instead of 30 damped steps, which did not converge at steep, wide Roll-ins (up to
    // 15 ft off at Dive 60°, Angle Off 90°, 30 s). Stops at 1e-9 ft; a degenerate step falls back to
    // the damped iteration.
    const nextInitial = (aglFt) => {
      const step = rollIn(rollParams, input.targetElevationMslFt + aglFt);
      return releaseAglFt + meanTrackSpeedFps(step.finalTasKt) * trackingTimeSec * Math.sin(angleRad) + step.altitudeLossFt;
    };
    let previous = initialAglFt;
    let previousResidual = nextInitial(previous) - previous;
    let current = 0.45 * previous + 0.55 * (previous + previousResidual);
    let residual = nextInitial(current) - current;
    for (let iteration = 0; iteration < 30 && residual !== 0 && Math.abs(current - previous) > 1e-9; iteration += 1) {
      const secant = current - (residual * (current - previous)) / (residual - previousResidual);
      previous = current;
      previousResidual = residual;
      current = Number.isFinite(secant) ? secant : 0.45 * current + 0.55 * (current + residual);
      residual = nextInitial(current) - current;
    }
    initialAglFt = current;
    initialMslFt = input.targetElevationMslFt + initialAglFt;
    roll = rollIn(rollParams, initialMslFt);
    pathFt = meanTrackSpeedFps(roll.finalTasKt) * trackingTimeSec;
    trackAglFt = initialAglFt - roll.altitudeLossFt;
  }

  const downRangeTravelFt = pathFt * Math.cos(angleRad);
  const groundRangeFt = downRangeTravelFt + bomb.bombRangeFt;
  const groundSlantRangeFt = Math.hypot(trackAglFt, groundRangeFt);
  const losDeg = (Math.atan2(trackAglFt, groundRangeFt) * 180) / Math.PI;
  const aimOffRangeFt = bomb.aimOffDistanceFt === null ? null : groundRangeFt + bomb.aimOffDistanceFt;
  const offsetDistanceFt = aimOffRangeFt === null ? groundRangeFt : aimOffRangeFt;
  const headingRad = (input.angleOffDeg * Math.PI) / 180;
  const targetForwardFt = roll.displacementForwardFt + groundRangeFt * Math.cos(headingRad);
  const targetTurnSideFt = roll.displacementTurnSideFt + groundRangeFt * Math.sin(headingRad);
  const offsetForwardFt = roll.displacementForwardFt + offsetDistanceFt * Math.cos(headingRad);
  const offsetTurnSideFt = roll.displacementTurnSideFt + offsetDistanceFt * Math.sin(headingRad);
  const targetBearingDeg = (Math.atan2(targetTurnSideFt, targetForwardFt) * 180) / Math.PI;
  const offsetBearingDeg = (Math.atan2(offsetTurnSideFt, offsetForwardFt) * 180) / Math.PI;
  const leadAngleDeg = input.angleOffDeg - targetBearingDeg;
  const legacyOffsetLeadDeg = input.angleOffDeg - offsetBearingDeg;
  const rollInRangeFt = Math.hypot(targetForwardFt, targetTurnSideFt);

  return {
    initialAglFt,
    initialMslFt,
    initialTasKt: roll.initialTasKt,
    rolloutTasKt: roll.finalTasKt,
    trackAglFt,
    trackMslFt: input.targetElevationMslFt + trackAglFt,
    releaseAglFt,
    effectiveReleaseAltitudeMslFt,
    releaseTasKt,
    trackingTimeSec,
    downRangeTravelFt,
    groundRangeFt,
    groundSlantRangeFt,
    aimOffRangeFt,
    rollInRangeFt,
    totalGroundTrackFt: roll.groundArcFt + groundRangeFt,
    initialSlantFt: Math.hypot(initialAglFt, rollInRangeFt),
    targetBearingDeg,
    offsetBearingDeg,
    leadAngleDeg,
    legacyOffsetLeadDeg,
    losDeg,
    aimOffAngleDeg: losDeg - input.diveAngleDeg,
    levelDelivery,
    targetForwardFt,
    targetTurnSideFt,
    roll,
  };
}
