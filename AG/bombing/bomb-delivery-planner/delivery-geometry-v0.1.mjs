import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { integrateRollIn } from "./roll-in-v0.1.mjs";

const KT_TO_FPS = 1.687809857;

export function calculateDeliveryGeometry({ input, bomb, effectiveReleaseAltitudeMslFt }) {
  const angleRad = (input.diveAngleDeg * Math.PI) / 180;
  const levelDelivery = Math.abs(input.diveAngleDeg) < 1e-9;
  const releaseAglFt = effectiveReleaseAltitudeMslFt - input.targetElevationMslFt;
  const releaseTasKt = casToTas(input.releaseSpeedKcas, effectiveReleaseAltitudeMslFt);
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
  };

  if (levelDelivery) {
    trackingTimeSec = input.enteredTrackingTimeSec;
    initialAglFt = releaseAglFt;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      initialMslFt = input.targetElevationMslFt + initialAglFt;
      roll = integrateRollIn(rollParams, initialMslFt);
      initialAglFt = releaseAglFt + roll.altitudeLossFt;
    }
    initialMslFt = input.targetElevationMslFt + initialAglFt;
    roll = integrateRollIn(rollParams, initialMslFt);
    trackAglFt = initialAglFt - roll.altitudeLossFt;
    pathFt = ((roll.finalTasKt + releaseTasKt) / 2) * KT_TO_FPS * trackingTimeSec;
  } else if (input.solveMode === "height") {
    initialMslFt = input.enteredInitialAltitudeMslFt;
    initialAglFt = initialMslFt - input.targetElevationMslFt;
    roll = integrateRollIn(rollParams, initialMslFt);
    trackAglFt = initialAglFt - roll.altitudeLossFt;
    if (!(trackAglFt > releaseAglFt)) throw new Error("Initial altitude minus roll-in loss is below effective Release altitude");
    pathFt = (trackAglFt - releaseAglFt) / Math.sin(angleRad);
    trackingTimeSec = pathFt / (((roll.finalTasKt + releaseTasKt) / 2) * KT_TO_FPS);
  } else {
    trackingTimeSec = input.enteredTrackingTimeSec;
    initialAglFt = releaseAglFt + trackingTimeSec * releaseTasKt * KT_TO_FPS * Math.sin(angleRad) + 2500;
    for (let iteration = 0; iteration < 30; iteration += 1) {
      initialMslFt = input.targetElevationMslFt + initialAglFt;
      roll = integrateRollIn(rollParams, initialMslFt);
      pathFt = ((roll.finalTasKt + releaseTasKt) / 2) * KT_TO_FPS * trackingTimeSec;
      const nextInitial = releaseAglFt + pathFt * Math.sin(angleRad) + roll.altitudeLossFt;
      initialAglFt = 0.45 * initialAglFt + 0.55 * nextInitial;
    }
    initialMslFt = input.targetElevationMslFt + initialAglFt;
    roll = integrateRollIn(rollParams, initialMslFt);
    pathFt = ((roll.finalTasKt + releaseTasKt) / 2) * KT_TO_FPS * trackingTimeSec;
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
