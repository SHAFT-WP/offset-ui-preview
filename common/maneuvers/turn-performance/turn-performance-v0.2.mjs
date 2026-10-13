export const TURN_PERFORMANCE_MODEL_V0_2 = Object.freeze({
  id: "fst-coordinated-constant-fpa-turn-v0.2",
  version: "0.2.0",
});

const G_FTPS2 = 32.174;
const KNOT_TO_FPS = 1.687809857;
const FT_PER_NM = 6076.11549;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function requirePositive(name, value) {
  requireFinite(name, value);
  if (!(value > 0)) throw new RangeError(`${name} must be > 0`);
}

function validateFpaDeg(fpaDeg) {
  requireFinite("fpaDeg", fpaDeg);
  if (!(Math.abs(fpaDeg) < 90)) throw new RangeError("|fpaDeg| must be < 90");
}

function validateBankAngleDeg(bankAngleDeg) {
  requireFinite("bankAngleDeg", bankAngleDeg);
  const magnitude = Math.abs(bankAngleDeg);
  if (!(magnitude > 0 && magnitude < 90)) {
    throw new RangeError("|bankAngleDeg| must be > 0 and < 90");
  }
}

function turnSign(turnDirection) {
  if (turnDirection === "RIGHT") return 1;
  if (turnDirection === "LEFT") return -1;
  throw new RangeError("turnDirection must be RIGHT or LEFT");
}

export function loadFactorFromBankAndFpa(bankAngleDeg, fpaDeg) {
  validateBankAngleDeg(bankAngleDeg);
  validateFpaDeg(fpaDeg);
  return Math.cos(fpaDeg * DEG_TO_RAD) / Math.cos(Math.abs(bankAngleDeg) * DEG_TO_RAD);
}

export function bankAngleDegFromLoadFactorAndFpa(loadFactorG, fpaDeg) {
  requirePositive("loadFactorG", loadFactorG);
  validateFpaDeg(fpaDeg);
  const ratio = Math.cos(fpaDeg * DEG_TO_RAD) / loadFactorG;
  if (!(ratio > 0 && ratio <= 1)) {
    throw new RangeError("loadFactorG is not compatible with the selected FPA");
  }
  return Math.acos(ratio) * RAD_TO_DEG;
}

export function horizontalTurnRadiusNmFromTasFpaAndBank(tasKt, fpaDeg, bankAngleDeg) {
  requirePositive("tasKt", tasKt);
  validateFpaDeg(fpaDeg);
  validateBankAngleDeg(bankAngleDeg);
  const velocityFps = tasKt * KNOT_TO_FPS;
  const gamma = fpaDeg * DEG_TO_RAD;
  const bank = Math.abs(bankAngleDeg) * DEG_TO_RAD;
  const horizontalVelocityFps = velocityFps * Math.cos(gamma);
  const radiusFt = (horizontalVelocityFps * horizontalVelocityFps) / (G_FTPS2 * Math.tan(bank));
  return radiusFt / FT_PER_NM;
}

export function turnRateDegSecFromTasFpaAndBank(tasKt, fpaDeg, bankAngleDeg) {
  const radiusNm = horizontalTurnRadiusNmFromTasFpaAndBank(tasKt, fpaDeg, bankAngleDeg);
  const horizontalVelocityFps = tasKt * KNOT_TO_FPS * Math.cos(fpaDeg * DEG_TO_RAD);
  return (horizontalVelocityFps / (radiusNm * FT_PER_NM)) * RAD_TO_DEG;
}

export function coordinatedConstantFpaTurn({
  tasKt,
  fpaDeg,
  bankAngleDeg,
  headingChangeDeg,
  turnDirection = "RIGHT",
}) {
  requirePositive("tasKt", tasKt);
  validateFpaDeg(fpaDeg);
  validateBankAngleDeg(bankAngleDeg);
  requireFinite("headingChangeDeg", headingChangeDeg);
  if (!(headingChangeDeg >= 0 && headingChangeDeg <= 360)) {
    throw new RangeError("headingChangeDeg must be in [0, 360]");
  }
  const sign = turnSign(turnDirection);
  const theta = headingChangeDeg * DEG_TO_RAD;
  const gamma = fpaDeg * DEG_TO_RAD;
  const radiusNm = horizontalTurnRadiusNmFromTasFpaAndBank(tasKt, fpaDeg, bankAngleDeg);
  const horizontalArcDistanceNm = radiusNm * theta;
  const spatialPathDistanceNm = horizontalArcDistanceNm / Math.cos(gamma);
  const altitudeChangeFt = horizontalArcDistanceNm * FT_PER_NM * Math.tan(gamma);
  const elapsedTimeSec = (spatialPathDistanceNm * FT_PER_NM) / (tasKt * KNOT_TO_FPS);
  const loadFactorG = loadFactorFromBankAndFpa(bankAngleDeg, fpaDeg);
  const turnRateDegSec = headingChangeDeg === 0
    ? turnRateDegSecFromTasFpaAndBank(tasKt, fpaDeg, bankAngleDeg)
    : headingChangeDeg / elapsedTimeSec;

  return {
    model: { ...TURN_PERFORMANCE_MODEL_V0_2 },
    tasKt,
    fpaDeg,
    bankAngleDeg: Math.abs(bankAngleDeg),
    loadFactorG,
    headingChangeDeg,
    turnDirection,
    horizontalSpeedKt: tasKt * Math.cos(gamma),
    horizontalTurnRadiusNm: radiusNm,
    turnRateDegSec,
    horizontalArcDistanceNm,
    spatialPathDistanceNm,
    altitudeChangeFt,
    elapsedTimeSec,
    displacement: {
      forwardNm: radiusNm * Math.sin(theta),
      turnSideNm: sign * radiusNm * (1 - Math.cos(theta)),
      altitudeFt: altitudeChangeFt,
    },
  };
}
