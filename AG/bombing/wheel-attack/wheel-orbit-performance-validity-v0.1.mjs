import { casToTas, tasToMach } from "../../../common/airspeed/airspeed-v0.1.mjs";
import {
  bankAngleDegFromLoadFactor,
  bankAngleDegFromTasAndRadius,
  loadFactorFromBankAngle,
  turnRadiusNmFromTasAndBank,
} from "../../../common/maneuvers/turn-performance/turn-performance-v0.1.mjs";

export const WHEEL_ORBIT_PERFORMANCE_VALIDITY_MODEL_V0_1 = Object.freeze({
  id: "wheel-orbit-performance-validity-v0.1",
  version: "0.1.0",
  status: "Work / Source-Bounded Calculation / Not Official",
});

const SOURCE_CASE_IDS_BY_WEAPON = Object.freeze({
  M82: Object.freeze(["L1", "L2", "L3"]),
  M84: Object.freeze(["L4", "L5"]),
});

export const WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1 = Object.freeze({
  id: "bms-f16cm52-cat-iii-bomb-limits-v0.1",
  status: "WORK_SOURCE_BOUNDED",
  aircraftModel: "F-16CM Block 52",
  engine: "F100-PW-229",
  simulationReference: "Falcon BMS 4.38 family",
  loadCategory: "III",
  sourceReferencePath:
    "flight/aircraft-performance/data/bms-f16cm52-loadout-reference-v0.1.json",
  sourceDescriptionPath:
    "flight/aircraft-performance/BMS-F16CM52-LOADOUT-REFERENCE.md",
  supportedWeaponIds: Object.freeze(Object.keys(SOURCE_CASE_IDS_BY_WEAPON)),
  sourceCaseIdsByWeapon: SOURCE_CASE_IDS_BY_WEAPON,
  limits: Object.freeze({
    maxPositiveLoadFactorG: 5.5,
    maxMach: 0.95,
    maxKias: 550,
  }),
});

export const WHEEL_ORBIT_PERFORMANCE_LIMITATIONS_V0_1 = Object.freeze([
  "MAX_KIAS_NOT_EVALUATED_FROM_KCAS_INPUT",
  "MINIMUM_SPEED_OR_STALL_NOT_MODELED",
  "SUSTAINED_TURN_OR_ENERGY_NOT_MODELED",
]);

const SUPPORTED_ROLES = Object.freeze(["WHEEL", "ORBIT"]);
const LIMIT_TOLERANCE = 1e-12;

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function requirePositive(name, value) {
  requireFinite(name, value);
  if (!(value > 0)) throw new RangeError(`${name} must be > 0`);
  return value;
}

function requireRole(role) {
  if (!SUPPORTED_ROLES.includes(role)) {
    throw new RangeError("role must be WHEEL or ORBIT");
  }
  return role;
}

function requireProfile(profileId) {
  if (profileId !== WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id) {
    throw new RangeError(
      `unsupported performanceProfileId: ${String(profileId)}`,
    );
  }
}

function requireWeapon(weaponId) {
  if (!Object.hasOwn(SOURCE_CASE_IDS_BY_WEAPON, weaponId)) {
    throw new RangeError(
      `weaponId ${String(weaponId)} is not covered by ${WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id}`,
    );
  }
  return weaponId;
}

/**
 * Evaluates only the source limits that can be mapped without guessing from
 * KCAS + altitude + radius: positive level-turn load factor and Mach.
 *
 * Max KIAS is deliberately not compared with KCAS. Stall/minimum-speed and
 * sustained-turn/energy capability require aircraft data not present in the
 * captured BMS loadout reference.
 */
export function evaluateWheelOrbitPerformanceValidityV0_1({
  role,
  weaponId,
  speedKcas,
  altitudeMslFt,
  turnRadiusNm,
  performanceProfileId = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id,
}) {
  const resolvedRole = requireRole(role);
  requireProfile(performanceProfileId);
  const resolvedWeaponId = requireWeapon(weaponId);
  requirePositive("speedKcas", speedKcas);
  requireFinite("altitudeMslFt", altitudeMslFt);
  requirePositive("turnRadiusNm", turnRadiusNm);

  const limits = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.limits;
  const tasKt = casToTas(speedKcas, altitudeMslFt);
  const mach = tasToMach(tasKt, altitudeMslFt);
  const bankAngleDeg = bankAngleDegFromTasAndRadius(tasKt, turnRadiusNm);
  const requiredLoadFactorG = loadFactorFromBankAngle(bankAngleDeg);
  const maximumBankAngleDeg = bankAngleDegFromLoadFactor(
    limits.maxPositiveLoadFactorG,
  );
  const minimumRadiusAtCurrentSpeedNm = turnRadiusNmFromTasAndBank(
    tasKt,
    maximumBankAngleDeg,
  );

  const loadFactorWithinLimit =
    requiredLoadFactorG <= limits.maxPositiveLoadFactorG + LIMIT_TOLERANCE;
  const machWithinLimit = mach <= limits.maxMach + LIMIT_TOLERANCE;
  const issues = [];
  if (!loadFactorWithinLimit) issues.push("MAX_POSITIVE_LOAD_FACTOR_EXCEEDED");
  if (!machWithinLimit) issues.push("MAX_MACH_EXCEEDED");
  const valid = loadFactorWithinLimit && machWithinLimit;

  return Object.freeze({
    model: Object.freeze({ ...WHEEL_ORBIT_PERFORMANCE_VALIDITY_MODEL_V0_1 }),
    profile: Object.freeze({
      id: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id,
      status: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.status,
      aircraftModel: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.aircraftModel,
      engine: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.engine,
      simulationReference:
        WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.simulationReference,
      loadCategory: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.loadCategory,
      sourceReferencePath:
        WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.sourceReferencePath,
      sourceDescriptionPath:
        WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.sourceDescriptionPath,
      weaponId: resolvedWeaponId,
      sourceCaseIds: SOURCE_CASE_IDS_BY_WEAPON[resolvedWeaponId],
    }),
    role: resolvedRole,
    valid,
    status: valid ? "VALID_WITH_SOURCE_LIMITATIONS" : "OUTSIDE_SOURCE_LIMITS",
    checks: Object.freeze({
      positiveLoadFactor: Object.freeze({
        evaluated: true,
        withinLimit: loadFactorWithinLimit,
        maxLoadFactorG: limits.maxPositiveLoadFactorG,
        maximumBankAngleDeg,
        minimumRadiusAtCurrentSpeedNm,
      }),
      mach: Object.freeze({
        evaluated: true,
        withinLimit: machWithinLimit,
        value: mach,
        maxMach: limits.maxMach,
      }),
      indicatedAirspeed: Object.freeze({
        evaluated: false,
        withinLimit: null,
        inputSpeedType: "KCAS",
        sourceLimitSpeedType: "KIAS",
        maxKias: limits.maxKias,
        reason: "TURN_INPUT_IS_KCAS",
      }),
      minimumSpeedOrStall: Object.freeze({
        evaluated: false,
        withinLimit: null,
        reason: "NO_STALL_OR_MINIMUM_SPEED_MODEL",
      }),
      sustainedTurnOrEnergy: Object.freeze({
        evaluated: false,
        withinLimit: null,
        reason: "NO_SUSTAINED_TURN_OR_ENERGY_MODEL",
      }),
    }),
    limitations: WHEEL_ORBIT_PERFORMANCE_LIMITATIONS_V0_1,
    issues: Object.freeze(issues),
  });
}

export const WHEEL_ORBIT_PERFORMANCE_CONSTANTS_V0_1 = Object.freeze({
  LIMIT_TOLERANCE,
  SUPPORTED_ROLES,
});
