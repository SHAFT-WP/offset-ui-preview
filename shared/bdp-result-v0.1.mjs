// BDP results on a bombing page (bombing app shared FE since 2026-10-22, from the Offset page): the Result rows of a
// BDP v0.4 result and the developer Fragment Data readouts. Display only: every value is the BE's, formatted with the
// Common display precision; a value the BDP does not calculate shows N/A, never 0.
import { formatDeg, formatFt, formatNm, formatSec, formatSecTenths } from "../common/ui/display-precision-v0.1.mjs?v=0.1.1";

// 0.2.0 (2026-10-23, BOX handoff G01): bdpResultRows takes the BDP result itself (was a result holding it as `profile`).
export const BDP_RESULT_V0_1 = Object.freeze({ id: "bombing-bdp-result-v0.1", version: "0.2.0" });

// One Result row (Common result panel markup: data-result-row, data-summary). resultKey marks the value for the
// result-change states (data-result-key).
export function resultRow(label, renderedValue, resultKey = null, { summary = false } = {}) {
  const rendered = resultKey ? `<span class="value-result" data-result-key="${resultKey}">${renderedValue}</span>` : renderedValue;
  return `<tr class="result-row" data-result-row data-summary="${summary}"><td>${label}</td><td data-result-value>${rendered}</td></tr>`;
}

// The BDP rows shown in the summary (the page may pass its own set).
export const BDP_RESULT_SUMMARY_KEYS = Object.freeze(new Set(["effectiveReleaseAltitudeMslFt", "trackingTimeSecResult", "leadAngleDeg", "nltReleaseMslFt"]));

// The BDP Result rows of one aircraft, from the BDP result the pattern's BE used (Offset: its aircraft result's
// `profile`; BOX: `bombDelivery`). keyed: mark the values for the result-change states (#1); a follower's rows are plain.
export function bdpResultRows(bdp, { keyed = true, summaryKeys = BDP_RESULT_SUMMARY_KEYS } = {}) {
  if (!bdp?.public) throw new TypeError("bdpResultRows takes a BDP result (with public)");
  const p = bdp.public;
  const r = (label, text, key) => resultRow(label, text, keyed ? key : null, { summary: summaryKeys.has(key) });
  return [
    r("Effective Release Altitude", `${formatFt(p.effectiveReleaseAltitudeMslFt)} ft MSL`, "effectiveReleaseAltitudeMslFt"),
    r("Roll-In Altitude", `${formatFt(p.resolvedInitialAltitudeMslFt)} ft MSL`, "resolvedInitialAltitudeMslFt"),
    r("Track Point Altitude", `${formatFt(p.trackPointAltitudeMslFt)} ft MSL`, "trackPointAltitudeMslFt"),
    r("Tracking Time", `${formatSecTenths(p.trackingTimeSec)} sec`, "trackingTimeSecResult"),
    r("Roll-in Range", `${formatNm(p.rollInRangeNm)} NM`, "rollInRangeNm"),
    r("Ground Range", `${formatNm(p.groundRangeNm)} NM`, "groundRangeNm"),
    r("Roll-in Radius", `${formatNm(p.rollInRadiusNm)} NM`, "rollInRadiusNm"),
    r("Roll-in Time", `${formatSec(p.rollInTimeSec)} sec`, "rollInTimeSec"),
    r("Roll-in Ground Arc", `${formatNm(p.rollInGroundArcNm)} NM`, "rollInGroundArcNm"),
    r("Roll-in Altitude Loss", `${formatFt(p.rollInAltitudeLossFt)} ft`, "rollInAltitudeLossFt"),
    r("Lead Angle", `${formatDeg(p.leadAngleDeg)}°`, "leadAngleDeg"),
    // SEM group (owner handoff 2026-10-18 §7.1): the selected SEM's lowest point, then MINALT (a separate floor).
    r("SEM Minimum Altitude", p.sem?.status === "INVALID" ? "INVALID" : Number.isFinite(p.semMinimumAltitudeMslFt) ? `${formatFt(p.semMinimumAltitudeMslFt)} ft MSL` : "N/A", "semMinimumAltitudeMslFt"),
    r("MINALT", `${formatFt(p.minAltMslFt)} ft MSL`, "minAltMslFt"),
    // NLT is not calculated below 10° (BDP SPEC §6.2): N/A, never 0.
    r("NLT Release", p.nltReleaseMslFt === null || p.nltReleaseMslFt === undefined ? "N/A" : `${formatFt(p.nltReleaseMslFt)} ft MSL`, "nltReleaseMslFt"),
    r("Bomb Range / TOF", `${formatNm(p.bombRangeNm)} NM / ${formatSec(p.bombTofSec)} sec`, "bombRangeTofSummary"),
  ];
}

// Fragment data in the BDP tab (owner handoff 2026-10-18 §7.2): developer mode only, read only. The weapon's own
// values (no margin), then the planning envelope the views draw (with the Fragment Height Margin).
export const FRAGMENT_READOUT_ROWS = Object.freeze([
  ["lateral", "Fragment Lateral Extent", "Left / right of the impact point (total 2R) · weapon data, no margin"],
  ["height", "Fragment Height", "Above the Target · weapon data, no margin"],
  ["duration", "Fragment Duration", "After impact · weapon data"],
  ["envelope", "Planning Envelope (max)", "With the Fragment Height Margin · Profile / 3D"],
]);

export function fragmentReadoutsMarkup() {
  return `<h3 class="input-group-title">Fragment Data (developer)</h3><div class="input-grid">${FRAGMENT_READOUT_ROWS.map(([key, label, note]) => `<label class="field"><span>${label}</span><output data-sem-readout="${key}">-</output><span class="unit">${note}</span></label>`).join("")}</div>`;
}

// fragment: BDP public.fragment (null / no raw data: every readout "-").
export function writeFragmentReadouts(box, fragment) {
  const set = (key, text) => { const node = box.querySelector(`[data-sem-readout="${key}"]`); if (node) node.textContent = text; };
  const f = fragment;
  if (!f?.raw) { FRAGMENT_READOUT_ROWS.forEach(([key]) => set(key, "-")); return; }
  set("lateral", `L ${formatFt(f.raw.rangeFt)} ft / R ${formatFt(f.raw.rangeFt)} ft · 2R ${formatFt(2 * f.raw.rangeFt)} ft`);
  set("height", `${formatFt(f.raw.maximumAltitudeAglFt)} ft AGL`);
  set("duration", `${formatSecTenths(f.raw.timeSec)} s`);
  set("envelope", `H ${formatFt(f.heightAglFt)} ft · R ${formatFt(f.radiusFt)} ft · ${f.marginPercent}% on ${f.marginAppliesTo === "HEIGHT" ? "height only" : "height and radius"}`);
}

// The level SEM turn's AUTO bank as flown (BDP v0.4.3 public.sem.turn).
export function semTurnAutoBankText(turn) {
  return turn?.bankAuto ? `AUTO · ${formatDeg(turn.bankDeg)}°` : "AUTO";
}
