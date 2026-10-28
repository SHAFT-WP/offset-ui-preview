// Popup-owned display adapter: use the solved climb, without integrating or changing the flight calculation.
// Frame matches BDP: Roll-in ground origin, +y along Initial heading, z above Target, t from Roll-in Start.
const KT_TO_FPS = 1.687809857;
export const POPUP_BDP_APPROACH_V0_1 = Object.freeze({ version: "0.1.0", beforePopSec: 3 });

export function popupApproachInBdpFrame(popup, targetElevationMslFt) {
  const climb = popup?.climb;
  if (!climb?.samples?.length || !(climb.climbTimeSec > 0) || !Number.isFinite(targetElevationMslFt)) {
    throw new TypeError("a solved Popup climb and target elevation are required");
  }
  const map = (sample) => ({
    t: sample.timeSec - climb.climbTimeSec,
    x: 0, y: sample.groundFt - climb.groundDistanceFt,
    z: sample.altitudeMslFt - targetElevationMslFt,
    headingDeg: 0, bankDeg: 0, fpaDeg: sample.fpaDeg,
    kcas: sample.casKt, loadFactor: sample.loadFactorG ?? 1,
    phase: sample.phase === "climb" ? "popup-climb" : "popup-pull-up",
  });
  const pop = map(climb.pop);
  const startSec = pop.t - POPUP_BDP_APPROACH_V0_1.beforePopSec;
  // The three seconds before pull-up are level at the BE's Pop speed/altitude, along the Approach leg.
  const beforePop = { ...pop, t: startSec,
    y: pop.y - climb.pop.tasKt * KT_TO_FPS * POPUP_BDP_APPROACH_V0_1.beforePopSec,
    fpaDeg: 0, loadFactor: 1, phase: "approach" };
  return { startSec, approach: [beforePop, { ...pop, phase: "approach" }, ...climb.samples.filter((s) => s.timeSec > 0).map(map)] };
}
