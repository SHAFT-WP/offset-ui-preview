import { HFFM_THRUST_DATA } from "../data/hffm-thrust-v0.1.mjs";

export const LBF_TO_NEWTON = 4.4482216152605;

export const HFFM_THRUST_MODEL = Object.freeze({
  id: HFFM_THRUST_DATA.modelId,
  version: HFFM_THRUST_DATA.modelVersion,
  status: "WORK_NOT_OFFICIAL",
  interpolation: "LINEAR_MACH_THEN_LINEAR_ALTITUDE",
  extrapolation: "REJECT",
  bms438FlightValidated: false,
});

const FIELDS = new Set(["engineModel", "altitudeMslFt", "mach", "powerSetting"]);
const WARNINGS = Object.freeze([
  "HFFM_SOURCE_ESTIMATED",
  "BMS_438_RUNTIME_IDENTITY_UNVERIFIED",
  "BMS_438_FLIGHT_VALIDATION_PENDING",
  "REFERENCE_ATMOSPHERE_ONLY",
]);

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function lowerBound(items, value, read) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (read(items[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function baseResult(inputs) {
  return {
    model: { ...HFFM_THRUST_MODEL },
    inputs,
    thrustLbf: null,
    thrustN: null,
    source: { ...HFFM_THRUST_DATA.source, authors: [...HFFM_THRUST_DATA.source.authors] },
    sourcePage: null,
    interpolation: null,
    validation: {
      valid: false,
      status: "INVALID_INPUT",
      errors: [],
      errorDetails: [],
      warnings: [...WARNINGS],
    },
  };
}

function addError(result, code, field, extra = {}) {
  if (!result.validation.errors.includes(code)) result.validation.errors.push(code);
  result.validation.errorDetails.push({ code, field, ...extra });
}

function evaluateCurve(curve, mach) {
  const points = curve.points;
  const high = lowerBound(points, mach, (p) => p[0]);
  const exact = points[high][0] === mach;
  const low = exact ? high : high - 1;
  const a = points[low];
  const b = points[high];
  const weight = exact ? 0 : (mach - a[0]) / (b[0] - a[0]);
  return {
    altitudeMslFt: curve.altitudeMslFt,
    lowerPointIndex: low,
    upperPointIndex: high,
    lowerPoint: { mach: a[0], thrustLbf: a[1] },
    upperPoint: { mach: b[0], thrustLbf: b[1] },
    machWeight: weight,
    thrustLbf: exact ? a[1] : a[1] + (b[1] - a[1]) * weight,
  };
}

/**
 * Stateless, strict, source-bounded thrust lookup. See ../SPEC.md.
 * No defaults, atmosphere conversion, partial throttle, drag, or acceleration.
 */
export function calculateHffmThrust(rawInput) {
  const isRecord = rawInput !== null && typeof rawInput === "object" && !Array.isArray(rawInput);
  const inputs = isRecord ? { ...rawInput } : null;
  const result = baseResult(inputs);
  if (!isRecord) {
    addError(result, "INPUT_OBJECT_REQUIRED", "input");
    return result;
  }

  for (const field of Reflect.ownKeys(inputs)) {
    if (!FIELDS.has(field)) addError(result, "UNSUPPORTED_INPUT_FIELD", String(field));
  }

  const { engineModel, altitudeMslFt, mach, powerSetting } = inputs;
  if (typeof engineModel !== "string" || !Object.hasOwn(HFFM_THRUST_DATA.engines, engineModel)) {
    addError(result, "UNSUPPORTED_ENGINE_MODEL", "engineModel");
  }
  if (!finiteNumber(altitudeMslFt)) addError(result, "ALTITUDE_MSL_FT_REQUIRED", "altitudeMslFt");
  if (!finiteNumber(mach)) addError(result, "MACH_REQUIRED", "mach");
  if (powerSetting !== "MIL" && powerSetting !== "MAX_AB") {
    addError(result, "UNSUPPORTED_POWER_SETTING", "powerSetting");
  }
  if (result.validation.errors.length) return result;

  const chart = HFFM_THRUST_DATA.engines[engineModel][powerSetting];
  const curves = chart.curves;
  result.sourcePage = chart.page;
  const minAltitude = curves[0].altitudeMslFt;
  const maxAltitude = curves.at(-1).altitudeMslFt;
  if (altitudeMslFt < minAltitude || altitudeMslFt > maxAltitude) {
    result.validation.status = "OUTSIDE_SOURCE_DOMAIN";
    addError(result, "ALTITUDE_OUTSIDE_SOURCE_DOMAIN", "altitudeMslFt", {
      allowedRange: [minAltitude, maxAltitude],
    });
    return result;
  }

  const high = lowerBound(curves, altitudeMslFt, (c) => c.altitudeMslFt);
  const exactAltitude = curves[high].altitudeMslFt === altitudeMslFt;
  const low = exactAltitude ? high : high - 1;
  const a = curves[low];
  const b = curves[high];
  // Both adjacent altitude curves must contain the requested Mach. Never skip
  // the nearest altitude, clamp Mach, or extrapolate a short source curve.
  const minMach = Math.max(a.machRange[0], b.machRange[0]);
  const maxMach = Math.min(a.machRange[1], b.machRange[1]);
  if (mach < minMach || mach > maxMach) {
    result.validation.status = "OUTSIDE_SOURCE_DOMAIN";
    addError(result, "MACH_OUTSIDE_SOURCE_DOMAIN", "mach", {
      allowedRange: [minMach, maxMach],
      adjacentAltitudesMslFt: [a.altitudeMslFt, b.altitudeMslFt],
    });
    return result;
  }

  const lower = evaluateCurve(a, mach);
  const upper = exactAltitude ? lower : evaluateCurve(b, mach);
  const altitudeWeight = exactAltitude ? 0 :
    (altitudeMslFt - a.altitudeMslFt) / (b.altitudeMslFt - a.altitudeMslFt);
  const thrustLbf = exactAltitude ? lower.thrustLbf :
    lower.thrustLbf + (upper.thrustLbf - lower.thrustLbf) * altitudeWeight;

  result.thrustLbf = thrustLbf;
  result.thrustN = thrustLbf * LBF_TO_NEWTON;
  result.interpolation = {
    method: HFFM_THRUST_MODEL.interpolation,
    exactAltitude,
    exactSourcePoint: exactAltitude && lower.lowerPointIndex === lower.upperPointIndex,
    altitudeWeight,
    validMachRange: [minMach, maxMach],
    lower,
    upper: exactAltitude ? null : upper,
  };
  result.validation.valid = true;
  result.validation.status = "VALID_WITH_SOURCE_LIMITATIONS";
  return result;
}

/** Return independent metadata copies; callers cannot modify the source table. */
export function getHffmThrustCatalog() {
  return {
    model: { ...HFFM_THRUST_MODEL },
    engines: Object.entries(HFFM_THRUST_DATA.engines).map(([engineModel, modes]) => ({
      engineModel,
      modes: Object.entries(modes).map(([powerSetting, chart]) => ({
        powerSetting,
        sourcePage: chart.page,
        curves: chart.curves.map((curve) => ({
          altitudeMslFt: curve.altitudeMslFt,
          machRange: [...curve.machRange],
          sourcePointCount: curve.points.length,
        })),
      })),
    })),
  };
}
