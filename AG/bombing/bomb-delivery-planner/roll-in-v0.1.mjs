import { casToTas, machToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";

const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;
const INTEGRATION_STEP_SEC = 0.01;
const LOW_ANGLE_BOUNDARY_DEG = 10;

function inputToTas(speedValue, speedMode, altitudeMslFt) {
  return speedMode === "MACH" ? machToTas(speedValue, altitudeMslFt) : casToTas(speedValue, altitudeMslFt);
}

export function integrateRollIn(params, initialAltitudeMslFt) {
  const bankRad = (params.rollInBankAngleDeg * Math.PI) / 180;
  const targetHeadingRad = (params.angleOffDeg * Math.PI) / 180;
  const targetDiveRad = (params.diveAngleDeg * Math.PI) / 180;
  const levelTurn = params.diveAngleDeg < LOW_ANGLE_BOUNDARY_DEG;
  const initialSpeedFps = inputToTas(params.initialSpeedValue, params.initialSpeedMode, initialAltitudeMslFt) * KT_TO_FPS;
  const initialTasKt = initialSpeedFps / KT_TO_FPS;

  let rawSpeed = initialSpeedFps;
  let rawGamma = 0;
  let rawHeading = 0;
  let rawTime = 0;
  const raw = [{ t: 0, dive: 0, heading: 0 }];

  function rawRates(velocityFps, flightPathRad) {
    const cosFlightPath = Math.max(0.08, Math.cos(flightPathRad));
    if (levelTurn) {
      return {
        speed: 0,
        gamma: 0,
        heading:
          (G_FTPS2 * params.rollInG * Math.abs(Math.sin(bankRad))) /
          velocityFps,
      };
    }
    return {
      speed: -G_FTPS2 * Math.sin(flightPathRad),
      gamma:
        (G_FTPS2 / velocityFps) *
        (params.rollInG * Math.cos(bankRad) - Math.cos(flightPathRad)),
      heading:
        (G_FTPS2 * params.rollInG * Math.abs(Math.sin(bankRad))) /
        (velocityFps * cosFlightPath),
    };
  }

  for (let i = 0; i < 24000 && rawHeading < targetHeadingRad - 1e-10; i += 1) {
    const firstRate = rawRates(rawSpeed, rawGamma);
    if (!(firstRate.heading > 0)) throw new Error("Invalid roll-in turn rate");
    let step = Math.min(INTEGRATION_STEP_SEC, (targetHeadingRad - rawHeading) / firstRate.heading);
    const midSpeed = rawSpeed + (firstRate.speed * step) / 2;
    const midGamma = rawGamma + (firstRate.gamma * step) / 2;
    const midRate = rawRates(midSpeed, midGamma);
    step = Math.min(step, (targetHeadingRad - rawHeading) / midRate.heading);
    rawSpeed += midRate.speed * step;
    rawGamma += midRate.gamma * step;
    rawHeading = Math.min(targetHeadingRad, rawHeading + midRate.heading * step);
    rawTime += step;
    raw.push({ t: rawTime, dive: Math.max(0, -rawGamma), heading: rawHeading });
  }

  if (rawHeading < targetHeadingRad - 1e-6) throw new Error("Angle Off was not reached");
  const rawFinalDive = raw[raw.length - 1].dive;
  if (!levelTurn && !(rawFinalDive > 0)) throw new Error("Roll-in does not produce a descending slice turn");

  const diveScale = levelTurn ? 0 : targetDiveRad / rawFinalDive;
  let speed = initialSpeedFps;
  let altitudeLossFt = 0;
  let spatialArcFt = 0;
  let groundArcFt = 0;
  let xFt = 0;
  let yFt = 0;
  let nextSample = 0.1;
  const samples = [{ groundArcFt: 0, altitudeLossFt: 0, forwardFt: 0, turnSideFt: 0, headingChangeRad: 0 }];

  for (let j = 1; j < raw.length; j += 1) {
    const dive0 = raw[j - 1].dive * diveScale;
    const dive1 = raw[j].dive * diveScale;
    const diveMid = (dive0 + dive1) / 2;
    const headingMid = (raw[j - 1].heading + raw[j].heading) / 2;
    const segmentTime = raw[j].t - raw[j - 1].t;
    const speedRate = levelTurn ? 0 : G_FTPS2 * Math.sin(diveMid);
    const speedMid = speed + (speedRate * segmentTime) / 2;
    speed += speedRate * segmentTime;
    const groundSegment = speedMid * Math.cos(diveMid) * segmentTime;
    groundArcFt += groundSegment;
    xFt += groundSegment * Math.cos(headingMid);
    yFt += groundSegment * Math.sin(headingMid);
    altitudeLossFt += speedMid * Math.sin(diveMid) * segmentTime;
    spatialArcFt += speedMid * segmentTime;

    if (j === raw.length - 1 || raw[j].t >= nextSample - 1e-9) {
      samples.push({
        groundArcFt,
        altitudeLossFt,
        forwardFt: xFt,
        turnSideFt: yFt,
        headingChangeRad: raw[j].heading,
      });
      nextSample += 0.1;
    }
  }

  const finalHeadingRad = targetHeadingRad;
  const finalAttackAxisForwardFt = xFt * Math.cos(finalHeadingRad) + yFt * Math.sin(finalHeadingRad);
  const finalAttackAxisLateralFt = Math.abs(-xFt * Math.sin(finalHeadingRad) + yFt * Math.cos(finalHeadingRad));
  const equivalentRadiusFt = groundArcFt / targetHeadingRad;

  return {
    mode: levelTurn ? "LEVEL_TURN" : "SLICE_TURN",
    initialTasKt,
    finalTasKt: speed / KT_TO_FPS,
    finalDiveAngleDeg: params.diveAngleDeg,
    rollInTimeSec: rawTime,
    displacementForwardFt: xFt,
    displacementTurnSideFt: yFt,
    finalAttackAxisForwardFt,
    finalAttackAxisLateralFt,
    altitudeLossFt,
    groundArcFt,
    spatialArcFt,
    equivalentRadiusFt,
    averageTurnRateDegSec: params.angleOffDeg / rawTime,
    dynamicFinalDiveDeg: levelTurn ? 0 : (rawFinalDive * 180) / Math.PI,
    samples,
  };
}
