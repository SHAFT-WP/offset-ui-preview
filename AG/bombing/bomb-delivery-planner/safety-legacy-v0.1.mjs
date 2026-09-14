import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";

const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;

function escapeLossFt(tasKt, diveAngleDeg, escapeG, maneuverDelaySec) {
  const angleRad = (diveAngleDeg * Math.PI) / 180;
  const speedFps = tasKt * KT_TO_FPS;
  const radialG = ((escapeG - Math.cos(angleRad)) + (escapeG - 1)) / 2;
  if (!(radialG > 0)) throw new Error("Escape G is invalid for the selected Dive Angle");
  return (
    speedFps * Math.sin(angleRad) * maneuverDelaySec +
    (speedFps * speedFps) / (G_FTPS2 * radialG) * (1 - Math.cos(angleRad))
  );
}

export function calculateFragmentData({ weapon, targetElevationMslFt }) {
  const ratio = targetElevationMslFt / 5000;
  const interpolate = (seaLevel, fiveThousand) => seaLevel + (fiveThousand - seaLevel) * ratio;
  return {
    fragmentMaximumAltitudeAglFt: interpolate(weapon.fragAlt0, weapon.fragAlt5),
    fragmentRangeFt: interpolate(weapon.fragRange0, weapon.fragRange5),
    fragmentTimeSec: interpolate(weapon.fragTime0, weapon.fragTime5),
  };
}

export function calculateLegacySafety({
  weapon,
  targetElevationMslFt,
  releaseSpeedKcas,
  speedOvershootKcas,
  diveAngleDeg,
  escapeG,
  maneuverDelaySec,
}) {
  const fragments = calculateFragmentData({ weapon, targetElevationMslFt });
  const base = fragments.fragmentMaximumAltitudeAglFt;

  function solve(kcas) {
    let heightFt = base + 2000;
    for (let i = 0; i < 28; i += 1) {
      const tasKt = casToTas(kcas, targetElevationMslFt + heightFt);
      const next = base + escapeLossFt(tasKt, diveAngleDeg, escapeG, maneuverDelaySec);
      heightFt = 0.45 * heightFt + 0.55 * next;
    }
    return heightFt;
  }

  const minAltHeightFt = base * 1.2;
  const rnltHeightFt = solve(releaseSpeedKcas + speedOvershootKcas);
  return {
    ...fragments,
    minAltAglFt: minAltHeightFt,
    minAltMslFt: targetElevationMslFt + minAltHeightFt,
    legacyRnltReleaseAglFt: rnltHeightFt,
    legacyRnltReleaseMslFt: targetElevationMslFt + rnltHeightFt,
  };
}
