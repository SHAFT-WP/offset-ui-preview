const DEG_TO_RAD = Math.PI / 180;

function requireObject(name, value) {
  if (!value || typeof value !== "object") throw new TypeError(`${name} must be an object`);
}

function pointAlong(origin, distanceNm, axis, altitudeMslFt) {
  return {
    forwardNm: origin.forwardNm + distanceNm * axis.forward,
    turnSideNm: origin.turnSideNm + distanceNm * axis.turnSide,
    altitudeMslFt,
  };
}

export const BDP_VISUALIZATION_STATE_MODEL_V0_1 = Object.freeze({
  id: "bdp-visualization-state-v0.1",
  version: "0.1.0",
  coordinateFrame: "ROLL_IN_START_LOCAL",
});

export function buildBombDeliveryVisualizationState(result) {
  requireObject("result", result);
  requireObject("result.inputs", result.inputs);
  requireObject("result.public", result.public);
  requireObject("result.visualization", result.visualization);

  const angleOffDeg = result.inputs.angleOffDeg;
  const attackAxisRad = angleOffDeg * DEG_TO_RAD;
  const attackAxis = {
    forward: Math.cos(attackAxisRad),
    turnSide: Math.sin(attackAxisRad),
  };

  const rollInStart = {
    forwardNm: 0,
    turnSideNm: 0,
    altitudeMslFt: result.public.resolvedInitialAltitudeMslFt,
  };
  const trackPoint = {
    forwardNm: result.public.rollInDisplacement.forwardNm,
    turnSideNm: result.public.rollInDisplacement.turnSideNm,
    altitudeMslFt: result.public.trackPointAltitudeMslFt,
  };
  const release = pointAlong(
    trackPoint,
    result.public.downRangeTravelNm,
    attackAxis,
    result.public.effectiveReleaseAltitudeMslFt,
  );
  const target = pointAlong(
    trackPoint,
    result.public.groundRangeNm,
    attackAxis,
    result.inputs.targetElevationMslFt,
  );
  const impact = pointAlong(
    release,
    result.public.bombRangeNm,
    attackAxis,
    result.inputs.targetElevationMslFt,
  );
  const aimOffPoint =
    result.local.aimOffPointRangeNm === null
      ? null
      : pointAlong(
          trackPoint,
          result.local.aimOffPointRangeNm,
          attackAxis,
          result.inputs.targetElevationMslFt,
        );

  const rollInPath = result.visualization.rollInTrajectorySamples.map((sample) => ({
    forwardNm: sample.forwardNm,
    turnSideNm: sample.turnSideNm,
    altitudeMslFt: rollInStart.altitudeMslFt - sample.altitudeLossFt,
    groundArcNm: sample.groundArcNm,
    headingChangeDeg: sample.headingChangeDeg,
  }));

  const bombPath = result.visualization.bombTrajectorySamples.map((sample) =>
    pointAlong(
      release,
      sample.downRangeNm,
      attackAxis,
      result.inputs.targetElevationMslFt + sample.altitudeAglFt,
    ),
  );

  return {
    model: { ...BDP_VISUALIZATION_STATE_MODEL_V0_1 },
    frame: {
      origin: "ROLL_IN_START",
      forwardAxis: "IMMEDIATE_PRE_ROLL_IN_FLIGHT_DIRECTION",
      turnSideAxis: "SELECTED_ROLL_IN_TURN_SIDE",
      verticalAxis: "ALTITUDE_MSL_FT",
      attackAxisHeadingChangeDeg: angleOffDeg,
    },
    stations: {
      rollInStart,
      trackPoint,
      release,
      impact,
      target,
      aimOffPoint,
    },
    paths: {
      rollIn: rollInPath,
      tracking: [trackPoint, release],
      bomb: bombPath,
    },
    dimensions: {
      rollInRangeNm: result.public.rollInRangeNm,
      rollInRangeProfileFitNm: result.local.rollInRangeProfileFitNm,
      groundRangeNm: result.public.groundRangeNm,
      downRangeTravelNm: result.public.downRangeTravelNm,
      bombRangeNm: result.public.bombRangeNm,
      rollInGroundArcNm: result.public.rollInGroundArcNm,
      baseDistanceNm: result.public.baseDistanceNm,
    },
    annotations: {
      leadAngleDeg: result.public.leadAngleDeg,
      angleOffDeg,
      minAltMslFt: result.public.minAltMslFt,
      nltReleaseMslFt: result.public.nltReleaseMslFt,
      aimOffAngleDeg: result.local.aimOffAngleDeg,
      aimOffDistanceNm: result.local.aimOffDistanceNm,
    },
  };
}
