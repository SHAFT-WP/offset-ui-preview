import { casToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { calculateBombTrajectory, ACTIVE_BALLISTIC_MODEL_ID } from "./ballistics-v0.1.mjs";
import { calculateDeliveryGeometry } from "./delivery-geometry-v0.1.mjs";
import { calculateFragmentData, calculateLegacySafety } from "./safety-legacy-v0.1.mjs";
import { calculateSemNltSafety } from "./safety-sem-v0.2.mjs";
import { getWeaponById } from "./weapon-data-v0.1.mjs";

const FT_PER_NM = 6076.11549;
const MPS_PER_KT = 0.5144444444444445;
const MIN_NLT_DIVE_ANGLE_DEG = 10;

export const BOMB_DELIVERY_PLANNER_MODEL_V0_2 = Object.freeze({
  id: "bomb-delivery-planner-v0.2-sem-nlt",
  version: "0.2.6",
  legacyGeometrySource: "Bomb Profile REV.1.9 · R_20260830",
  applicability: Object.freeze({
    minAltOnlyBelowDiveAngleDeg: MIN_NLT_DIVE_ANGLE_DEG,
  }),
});

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function normalizeInput(raw) {
  const diveAngleDeg = raw.diveAngleDeg ?? raw.diveAngle;
  if (raw.windSpeedMps !== undefined || raw.windSpeed !== undefined) {
    throw new TypeError("BDP v0.2 wind input uses windSpeedKt only; m/s wind aliases are not supported");
  }
  const windSpeedKt = raw.windSpeedKt ?? 0;
  return {
    weaponId: raw.weaponId ?? "M82",
    targetElevationMslFt: raw.targetElevationMslFt ?? raw.targetElevation,
    releaseSpeedKcas: raw.releaseSpeedKcas ?? raw.releaseSpeed,
    speedOvershootKcas: raw.speedOvershootKcas ?? raw.rnltSpeedMargin ?? 50,
    // Compatibility/legacy-diagnostic input only. V2 NLT does not apply a pre-G-onset delay.
    maneuverInitiationDelaySec:
      raw.maneuverInitiationDelaySec ?? raw.maneuverTime ?? 0,
    recoveryG: raw.recoveryG ?? raw.escapeG ?? 5,
    gOnsetTimeSec: raw.gOnsetTimeSec ?? 2,
    diveAngleDeg,
    releaseFpaDeg: raw.releaseFpaDeg ?? -diveAngleDeg,
    windDirectionDeg: raw.windDirectionDeg ?? raw.windDirection ?? 0,
    windSpeedKt,
    initialSpeedValue: raw.initialSpeedValue ?? raw.initialSpeed,
    initialSpeedMode: raw.initialSpeedMode ?? raw.initialUnit ?? "CAS",
    enteredInitialAltitudeMslFt: raw.initialAltitudeMslFt ?? raw.initialAltitude,
    solveMode: raw.solveMode ?? "height",
    enteredTrackingTimeSec: Math.round(raw.trackingTimeSec ?? raw.trackingTime ?? 0),
    enteredReleaseAltitudeMslFt: raw.releaseAltitudeMslFt ?? raw.releaseMsl,
    angleOffDeg: raw.angleOffDeg ?? raw.rollHeading,
    rollInBankAngleDeg: raw.rollInBankAngleDeg ?? raw.rollBank,
    rollInG: raw.rollInG ?? raw.rollG,
    ballisticModelId: raw.ballisticModelId ?? ACTIVE_BALLISTIC_MODEL_ID,
  };
}

function validate(p) {
  [
    "targetElevationMslFt",
    "releaseSpeedKcas",
    "diveAngleDeg",
    "releaseFpaDeg",
    "windDirectionDeg",
    "windSpeedKt",
    "initialSpeedValue",
    "enteredInitialAltitudeMslFt",
    "enteredTrackingTimeSec",
    "enteredReleaseAltitudeMslFt",
    "angleOffDeg",
    "rollInBankAngleDeg",
    "rollInG",
  ].forEach((name) => finite(name, p[name]));
  if (!(p.releaseSpeedKcas > 0)) throw new RangeError("releaseSpeedKcas must be > 0");
  if (!(p.diveAngleDeg >= 0 && p.diveAngleDeg < 90)) throw new RangeError("diveAngleDeg must be >= 0 and < 90");
  if (!(p.releaseFpaDeg <= 0 && p.releaseFpaDeg > -90)) throw new RangeError("releaseFpaDeg must be <= 0 and > -90");
  if (!(p.windSpeedKt >= 0)) throw new RangeError("windSpeedKt must be >= 0");
  if (!(p.enteredReleaseAltitudeMslFt > p.targetElevationMslFt)) throw new RangeError("Release altitude must be above Target elevation");
  if (!(p.initialSpeedValue > 0)) throw new RangeError("initialSpeedValue must be > 0");
  if (p.initialSpeedMode !== "CAS" && p.initialSpeedMode !== "MACH") throw new RangeError("initialSpeedMode must be CAS or MACH");
  if (!(p.angleOffDeg > 0 && p.angleOffDeg < 180)) throw new RangeError("angleOffDeg must be > 0 and < 180");
  if (!(p.rollInBankAngleDeg > 0 && p.rollInBankAngleDeg < 180)) throw new RangeError("rollInBankAngleDeg must be > 0 and < 180");
  if (!(p.rollInG > 1 && p.rollInG <= 9)) throw new RangeError("rollInG must be > 1 and <= 9");
  if (p.diveAngleDeg > 0 && p.solveMode === "height" && !(p.enteredInitialAltitudeMslFt > p.enteredReleaseAltitudeMslFt)) {
    throw new RangeError("Initial altitude must be above entered Release altitude in height mode");
  }
  if ((p.solveMode === "time" || Math.abs(p.diveAngleDeg) < 1e-9) && !(p.enteredTrackingTimeSec > 0)) {
    throw new RangeError("Tracking Time must be > 0");
  }

  // Below 10° the project contract is MINALT-only. NLT/SEM inputs are unused and must not invalidate geometry/ballistics.
  if (p.diveAngleDeg >= MIN_NLT_DIVE_ANGLE_DEG) {
    [
      "speedOvershootKcas",
      "maneuverInitiationDelaySec",
      "recoveryG",
      "gOnsetTimeSec",
    ].forEach((name) => finite(name, p[name]));
    if (!(p.speedOvershootKcas >= 0)) throw new RangeError("speedOvershootKcas must be >= 0");
    if (!(p.maneuverInitiationDelaySec >= 0)) throw new RangeError("maneuverInitiationDelaySec must be >= 0");
    if (!(p.recoveryG > 1 && p.recoveryG <= 9)) throw new RangeError("recoveryG must be > 1 and <= 9");
    if (!(p.gOnsetTimeSec > 0)) throw new RangeError("gOnsetTimeSec must be > 0");
  }
}

function calculateMinAltOnlySafety({ weapon, targetElevationMslFt, releaseFpaDeg }) {
  const fragments = calculateFragmentData({ weapon, targetElevationMslFt });
  const minAltAglFt = fragments.fragmentMaximumAltitudeAglFt * 1.2;
  const minAltMslFt = targetElevationMslFt + minAltAglFt;
  return {
    model: { id: "minalt-only-v0.1", version: "0.1.0" },
    applicability: "MINALT_ONLY",
    ...fragments,
    minAltAglFt,
    minAltMslFt,
    nltReleaseMslFt: null,
    recoverySpeedKcas: null,
    releaseFpaDeg,
    recoveryAtNlt: null,
  };
}

export function calculateBombDeliveryV0_2(rawInput) {
  const input = normalizeInput(rawInput);
  validate(input);
  const weapon = getWeaponById(input.weaponId);
  const nltSupported = input.diveAngleDeg >= MIN_NLT_DIVE_ANGLE_DEG;

  const safety = nltSupported
    ? calculateSemNltSafety({
        weapon,
        targetElevationMslFt: input.targetElevationMslFt,
        releaseSpeedKcas: input.releaseSpeedKcas,
        speedOvershootKcas: input.speedOvershootKcas,
        releaseFpaDeg: input.releaseFpaDeg,
        recoveryG: input.recoveryG,
        gOnsetTimeSec: input.gOnsetTimeSec,
      })
    : calculateMinAltOnlySafety({
        weapon,
        targetElevationMslFt: input.targetElevationMslFt,
        releaseFpaDeg: input.releaseFpaDeg,
      });

  const effectiveReleaseAltitudeMslFt = nltSupported
    ? Math.max(input.enteredReleaseAltitudeMslFt, safety.nltReleaseMslFt)
    : input.enteredReleaseAltitudeMslFt;
  const releaseAglFt = effectiveReleaseAltitudeMslFt - input.targetElevationMslFt;
  const releaseTasKt = casToTas(input.releaseSpeedKcas, effectiveReleaseAltitudeMslFt);
  const bomb = calculateBombTrajectory({
    params: {
      diveAngleDeg: input.diveAngleDeg,
      releaseAglFt,
      windDirectionDeg: input.windDirectionDeg,
      // Ballistics keeps SI wind internally; BDP canonical/user-facing unit is knots.
      windSpeedMps: input.windSpeedKt * MPS_PER_KT,
    },
    weapon,
    releaseTasKt,
    modelId: input.ballisticModelId,
  });
  const profile = calculateDeliveryGeometry({ input, bomb, effectiveReleaseAltitudeMslFt });
  const resolvedInitialSpeedKcas =
    input.initialSpeedMode === "CAS"
      ? input.initialSpeedValue
      : tasToCas(profile.initialTasKt, profile.initialMslFt);

  const legacySafety = nltSupported
    ? calculateLegacySafety({
        weapon,
        targetElevationMslFt: input.targetElevationMslFt,
        releaseSpeedKcas: input.releaseSpeedKcas,
        speedOvershootKcas: input.speedOvershootKcas,
        diveAngleDeg: input.diveAngleDeg,
        escapeG: input.recoveryG,
        maneuverDelaySec: input.maneuverInitiationDelaySec,
      })
    : null;

  return {
    model: { ...BOMB_DELIVERY_PLANNER_MODEL_V0_2 },
    weapon,
    inputs: input,
    public: {
      effectiveReleaseAltitudeMslFt: profile.effectiveReleaseAltitudeMslFt,
      resolvedInitialAltitudeMslFt: profile.initialMslFt,
      resolvedInitialSpeedKcas,
      trackPointAltitudeMslFt: profile.trackMslFt,
      trackingTimeSec: profile.trackingTimeSec,
      rollInRangeNm: profile.rollInRangeFt / FT_PER_NM,
      groundRangeNm: profile.groundRangeFt / FT_PER_NM,
      downRangeTravelNm: profile.downRangeTravelFt / FT_PER_NM,
      bombRangeNm: bomb.bombRangeFt / FT_PER_NM,
      bombTofSec: bomb.bombTofSec,
      rollInRadiusNm: profile.roll.equivalentRadiusFt / FT_PER_NM,
      rollInTimeSec: profile.roll.rollInTimeSec,
      rollInGroundArcNm: profile.roll.groundArcFt / FT_PER_NM,
      rollInDisplacement: {
        forwardNm: profile.roll.displacementForwardFt / FT_PER_NM,
        turnSideNm: profile.roll.displacementTurnSideFt / FT_PER_NM,
      },
      baseDistanceNm: Math.abs(profile.targetTurnSideFt) / FT_PER_NM,
      baseDistanceSlantNm: Math.hypot(profile.initialAglFt, Math.abs(profile.targetTurnSideFt)) / FT_PER_NM,
      rollInLateralSeparationNm: Math.abs(profile.targetTurnSideFt) / FT_PER_NM,
      rollInAltitudeLossFt: profile.roll.altitudeLossFt,
      leadAngleDeg: profile.leadAngleDeg,
      minAltMslFt: safety.minAltMslFt,
      nltReleaseMslFt: safety.nltReleaseMslFt,
    },
    local: {
      aimOffPointRangeNm: profile.aimOffRangeFt === null ? null : profile.aimOffRangeFt / FT_PER_NM,
      aimOffAngleDeg: profile.aimOffAngleDeg,
      aimOffDistanceNm: bomb.aimOffDistanceFt === null ? null : bomb.aimOffDistanceFt / FT_PER_NM,
      rollInRangeProfileFitNm: (profile.rollInRangeFt - profile.groundRangeFt) / FT_PER_NM,
      legacyOffsetLeadDeg: profile.legacyOffsetLeadDeg,
    },
    visualization: {
      rollInTrajectorySamples: profile.roll.samples.map((sample) => ({
        forwardNm: sample.forwardFt / FT_PER_NM,
        turnSideNm: sample.turnSideFt / FT_PER_NM,
        groundArcNm: sample.groundArcFt / FT_PER_NM,
        altitudeLossFt: sample.altitudeLossFt,
        headingChangeDeg: (sample.headingChangeRad * 180) / Math.PI,
      })),
      bombTrajectorySamples: bomb.samples.map((sample) => ({
        downRangeNm: sample.xFt / FT_PER_NM,
        altitudeAglFt: sample.altitudeAglFt,
      })),
    },
    safety: {
      model: safety.model,
      applicability: safety.applicability ?? "NLT_SUPPORTED",
      recoverySpeedKcas: safety.recoverySpeedKcas,
      releaseFpaDeg: safety.releaseFpaDeg,
      recoveryAtNlt: safety.recoveryAtNlt,
    },
    diagnostics: {
      targetForwardNm: profile.targetForwardFt / FT_PER_NM,
      targetTurnSideNm: profile.targetTurnSideFt / FT_PER_NM,
      initialTasKt: profile.initialTasKt,
      releaseTasKt: profile.releaseTasKt,
      ballisticModelId: bomb.modelId,
      ballisticModelVersion: bomb.modelVersion,
      legacyRnltReleaseMslFt: legacySafety?.legacyRnltReleaseMslFt ?? null,
      nltSupported,
    },
  };
}
