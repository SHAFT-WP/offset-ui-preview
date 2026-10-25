export const TURN_PERFORMANCE_MODEL = Object.freeze({
  id: "fst-coordinated-level-turn-v0.1",
  version: "0.1.0",
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

export function bankAngleDegFromLoadFactor(loadFactorG) {
  requireFinite("loadFactorG", loadFactorG);
  if (loadFactorG < 1) throw new RangeError("loadFactorG must be >= 1 for coordinated level turn");
  return Math.acos(1 / loadFactorG) * RAD_TO_DEG;
}

export function loadFactorFromBankAngle(bankAngleDeg) {
  requireFinite("bankAngleDeg", bankAngleDeg);
  const magnitude = Math.abs(bankAngleDeg);
  if (magnitude >= 90) throw new RangeError("|bankAngleDeg| must be < 90");
  return 1 / Math.cos(magnitude * DEG_TO_RAD);
}

export function turnRadiusNmFromTasAndBank(tasKt, bankAngleDeg) {
  requirePositive("tasKt", tasKt);
  requireFinite("bankAngleDeg", bankAngleDeg);
  const magnitude = Math.abs(bankAngleDeg);
  if (!(magnitude > 0 && magnitude < 90)) {
    throw new RangeError("|bankAngleDeg| must be > 0 and < 90");
  }
  const velocityFps = tasKt * KNOT_TO_FPS;
  const radiusFt = (velocityFps * velocityFps) / (G_FTPS2 * Math.tan(magnitude * DEG_TO_RAD));
  return radiusFt / FT_PER_NM;
}

export function bankAngleDegFromTasAndRadius(tasKt, turnRadiusNm) {
  requirePositive("tasKt", tasKt);
  requirePositive("turnRadiusNm", turnRadiusNm);
  const velocityFps = tasKt * KNOT_TO_FPS;
  const radiusFt = turnRadiusNm * FT_PER_NM;
  return Math.atan((velocityFps * velocityFps) / (G_FTPS2 * radiusFt)) * RAD_TO_DEG;
}

export function turnRateDegSecFromTasAndBank(tasKt, bankAngleDeg) {
  const radiusNm = turnRadiusNmFromTasAndBank(tasKt, bankAngleDeg);
  const velocityFps = tasKt * KNOT_TO_FPS;
  const radiusFt = radiusNm * FT_PER_NM;
  return (velocityFps / radiusFt) * RAD_TO_DEG;
}

export function turnArcDistanceNm(turnRadiusNm, headingChangeDeg) {
  requirePositive("turnRadiusNm", turnRadiusNm);
  requireFinite("headingChangeDeg", headingChangeDeg);
  return turnRadiusNm * Math.abs(headingChangeDeg) * DEG_TO_RAD;
}

export function turnTimeSecFromRate(turnRateDegSec, headingChangeDeg) {
  requirePositive("turnRateDegSec", turnRateDegSec);
  requireFinite("headingChangeDeg", headingChangeDeg);
  return Math.abs(headingChangeDeg) / turnRateDegSec;
}

export function coordinatedTurnFromTasAndLoadFactor({ tasKt, loadFactorG, headingChangeDeg = null }) {
  requirePositive("tasKt", tasKt);
  const bankAngleDeg = bankAngleDegFromLoadFactor(loadFactorG);
  if (bankAngleDeg === 0) {
    return {
      model: { ...TURN_PERFORMANCE_MODEL },
      tasKt,
      loadFactorG,
      bankAngleDeg: 0,
      turnRadiusNm: Infinity,
      turnRateDegSec: 0,
      turnDistanceNm: headingChangeDeg === null ? null : Infinity,
      turnTimeSec: headingChangeDeg === null ? null : Infinity,
    };
  }

  const turnRadiusNm = turnRadiusNmFromTasAndBank(tasKt, bankAngleDeg);
  const turnRateDegSec = turnRateDegSecFromTasAndBank(tasKt, bankAngleDeg);
  const hasHeadingChange = headingChangeDeg !== null;
  if (hasHeadingChange) requireFinite("headingChangeDeg", headingChangeDeg);

  return {
    model: { ...TURN_PERFORMANCE_MODEL },
    tasKt,
    loadFactorG,
    bankAngleDeg,
    turnRadiusNm,
    turnRateDegSec,
    turnDistanceNm: hasHeadingChange ? turnArcDistanceNm(turnRadiusNm, headingChangeDeg) : null,
    turnTimeSec: hasHeadingChange ? turnTimeSecFromRate(turnRateDegSec, headingChangeDeg) : null,
  };
}
