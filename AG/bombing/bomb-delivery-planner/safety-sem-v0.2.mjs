import { calculateWingsLevelRecoveryPull } from "../../../common/maneuvers/recovery-pull/recovery-pull-v0.1.mjs";
import { calculateFragmentData } from "./safety-legacy-v0.1.mjs";

export const SEM_NLT_MODEL_V0_2 = Object.freeze({
  id: "sem-g-onset-nlt-v0.2",
  version: "0.2.1",
});

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

export function calculateSemNltSafety({
  weapon,
  targetElevationMslFt,
  releaseSpeedKcas,
  speedOvershootKcas = 50,
  releaseFpaDeg,
  recoveryG = 5,
  gOnsetTimeSec = 2,
}) {
  [
    ["targetElevationMslFt", targetElevationMslFt],
    ["releaseSpeedKcas", releaseSpeedKcas],
    ["speedOvershootKcas", speedOvershootKcas],
    ["releaseFpaDeg", releaseFpaDeg],
    ["recoveryG", recoveryG],
    ["gOnsetTimeSec", gOnsetTimeSec],
  ].forEach(([name, value]) => requireFinite(name, value));

  if (!(releaseSpeedKcas > 0)) throw new RangeError("releaseSpeedKcas must be > 0");
  if (!(speedOvershootKcas >= 0)) throw new RangeError("speedOvershootKcas must be >= 0");
  if (!(releaseFpaDeg <= 0 && releaseFpaDeg > -90)) throw new RangeError("releaseFpaDeg must be <= 0 and > -90");
  if (!(recoveryG > 1 && recoveryG <= 9)) throw new RangeError("recoveryG must be > 1 and <= 9");
  if (!(gOnsetTimeSec > 0)) throw new RangeError("gOnsetTimeSec must be > 0");

  const fragments = calculateFragmentData({ weapon, targetElevationMslFt });
  const minAltAglFt = fragments.fragmentMaximumAltitudeAglFt * 1.2;
  const minAltMslFt = targetElevationMslFt + minAltAglFt;
  const recoverySpeedKcas = releaseSpeedKcas + speedOvershootKcas;

  if (Math.abs(releaseFpaDeg) < 1e-12) {
    return {
      model: { ...SEM_NLT_MODEL_V0_2 },
      ...fragments,
      minAltAglFt,
      minAltMslFt,
      nltReleaseMslFt: minAltMslFt,
      recoverySpeedKcas,
      releaseFpaDeg,
      recoveryAtNlt: {
        minAltitudeMslFt: minAltMslFt,
        altitudeMarginFt: 0,
        elapsedToLevelSec: 0,
      },
    };
  }

  function evaluate(releaseAltitudeMslFt) {
    const recovery = calculateWingsLevelRecoveryPull({
      startAltitudeMslFt: releaseAltitudeMslFt,
      startSpeedKcas: recoverySpeedKcas,
      startFpaDeg: releaseFpaDeg,
      targetFpaDeg: 0,
      recoveryG,
      gOnsetTimeSec,
      // V2 NLT starts G onset immediately at Release. There is no pre-onset delay.
      maneuverInitiationDelaySec: 0,
    });
    return {
      recovery,
      residualFt: recovery.minAltitudeMslFt - minAltMslFt,
    };
  }

  let low = minAltMslFt;
  let high = minAltMslFt + 2000;
  let highEval = evaluate(high);
  for (let expand = 0; highEval.residualFt < 0 && expand < 20; expand += 1) {
    high += Math.max(2000, (high - minAltMslFt) * 0.75);
    highEval = evaluate(high);
  }
  if (highEval.residualFt < 0) throw new Error("NLT Release root could not be bracketed");

  let lowEval = evaluate(low);
  if (lowEval.residualFt >= 0) {
    high = low;
    highEval = lowEval;
  } else {
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const mid = (low + high) / 2;
      const midEval = evaluate(mid);
      if (midEval.residualFt >= 0) {
        high = mid;
        highEval = midEval;
      } else {
        low = mid;
        lowEval = midEval;
      }
    }
  }

  const nltReleaseMslFt = Math.max(minAltMslFt, high);
  const finalEval = evaluate(nltReleaseMslFt);
  return {
    model: { ...SEM_NLT_MODEL_V0_2 },
    ...fragments,
    minAltAglFt,
    minAltMslFt,
    nltReleaseMslFt,
    recoverySpeedKcas,
    releaseFpaDeg,
    recoveryAtNlt: {
      minAltitudeMslFt: finalEval.recovery.minAltitudeMslFt,
      altitudeMarginFt: finalEval.residualFt,
      elapsedToLevelSec: finalEval.recovery.elapsedTimeSec,
      horizontalDistanceNm: finalEval.recovery.horizontalDistanceNm,
      phaseTimeSec: finalEval.recovery.phaseTimeSec,
    },
  };
}
