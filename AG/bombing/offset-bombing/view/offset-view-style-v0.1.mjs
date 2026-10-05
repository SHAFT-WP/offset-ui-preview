import { BDP_VIEW_COLORS } from "../../bomb-delivery-planner/view/bdp-view-style-v0.1.mjs";
import { formatDeg, formatFt, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";

// Offset view style — Offset-owned colours, heading notation, titles and legend items for the
// Offset Top View / Flight Top View / Z-Diagram (common/diagram/SPEC.md V2 unified view grammar G5,
// G10; AG Offset SPEC owns the content). Segments that come from the BDP use the BDP colours.

export const OFFSET_VIEW_STYLE_V0_1 = Object.freeze({
  id: "offset-view-style-v0.1",
  // 0.1.1 (2026-10-05, user): offsetFlightTopViewLegend — the #n Top View comparison legend.
  // 0.1.2 (2026-10-05, user): OFFSET_COMPANION_COLORS; the legend's reference rows take the companion
  // colour when the reference aircraft is drawn as a companion (referencePalette: "companion").
  version: "0.1.2",
});

// Lead aircraft: pattern segments are Offset colours kept apart from the BDP set; the approach leg
// (Turn End → OA1) is the BDP's Initial track, and Roll-in / Track Point → Target / Target are BDP's.
export const OFFSET_VIEW_COLORS = Object.freeze({
  run: "#4c5966",
  offset: "#0e7490",
  approach: BDP_VIEW_COLORS.initialTrack,
  roll: BDP_VIEW_COLORS.rollIn,
  rollText: BDP_VIEW_COLORS.rollInText,
  attack: BDP_VIEW_COLORS.map,
  attackText: BDP_VIEW_COLORS.mapText,
  target: BDP_VIEW_COLORS.target,
  reference: "#5b6f82",
  invalid: "#bd3333",
  guide: "#b1bbc4",
  // Time dial (2026-10-02): the path flown up to T, the aircraft and its velocity vector.
  time: "#e8590c",
});

// Flight followers (#2/#3/#4): one violet family so their layer reads apart from the element lead's.
export const OFFSET_FOLLOWER_COLORS = Object.freeze({
  ...OFFSET_VIEW_COLORS,
  run: "#5e4a8c",
  offset: "#8a3ab9",
  approach: "#8a3ab9",
  roll: "#5b50c8",
  rollText: "#5b50c8",
  attack: "#b0307a",
  attackText: "#b0307a",
  time: "#d6336c",
});

// Companion aircraft (2026-10-05, user): the aircraft ahead drawn without labels in a Flight Top View
// whose element lead is another aircraft (#2 in Offset #3 Top View). One green family.
export const OFFSET_COMPANION_COLORS = Object.freeze({
  ...OFFSET_VIEW_COLORS,
  run: "#3f7d5a",
  offset: "#2f9e6e",
  approach: "#2f9e6e",
  roll: "#1f8a70",
  rollText: "#1f8a70",
  attack: "#5c940d",
  attackText: "#5c940d",
  time: "#2b8a3e",
});

// Headings are three digits with the degree sign attached (Offset SPEC "Canonical heading").
export function formatHeadingDeg(value) {
  if (!Number.isFinite(value)) return "-";
  const heading = ((Math.round(value) % 360) + 360) % 360;
  return `${String(heading).padStart(3, "0")}°`;
}

// World bearing a → b (x east, y north), degrees true.
export function bearingDeg(a, b) {
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
}

// docs/TERMINOLOGY.md "Diagram titles": pattern views always carry the aircraft number.
export function offsetViewTitle(view, { aircraftNumber = 1 } = {}) {
  const number = Number.isInteger(Number(aircraftNumber)) && Number(aircraftNumber) > 0 ? Number(aircraftNumber) : 1;
  return `Offset #${number} ${view}`;
}

// Legend items of the Offset Top View (fixed footer; values follow the result). Without a result
// the labels carry no values.
export function offsetTopViewLegend(result = null) {
  const C = OFFSET_VIEW_COLORS;
  const g = result?.geometry;
  const value = (text) => (g ? ` · ${text}` : "");
  return [
    { label: `Offset Angle${value(`${formatDeg(g?.offsetAngleDeg)}°`)}`, color: C.offset },
    { label: `Approaching Heading${value(formatHeadingDeg(g?.offsetHeadingDeg))}`, color: C.approach },
    { label: `Roll-in Radial${value(g ? formatHeadingDeg(bearingDeg(g.points.target, g.points.rollStart)) : "")}`, color: C.roll },
    { label: `Roll-in Heading${value(formatHeadingDeg(g?.offsetHeadingDeg))}`, color: C.roll },
    { label: `Roll-in Radius${value(`${formatNm(g?.rollInRadiusNm)} NM`)}`, color: C.roll },
  ];
}

// Offset #n Top View legend (user 2026-10-05): this aircraft against the aircraft it releases after
// (#(n-1), the ΔTime reference: #2 vs #1, #3 vs #2, #4 vs #3). Rows in the user's order: Roll-in Alt,
// Dive Angle, Release Alt for #k then #n; #k IP to Impact Time; #n IP to Release Time; ΔTime #k Impact
// − #n Release. `reference` / `own` are { number, result } (result null when that solve failed: its
// rows are left out); `deltaTimeSec` comes from computeDropOrderDelta. Values are display-rounded only.
export function offsetFlightTopViewLegend({ reference = null, own = null, deltaTimeSec = null, referencePalette = "lead" } = {}) {
  const rows = [];
  const sides = [reference, own].filter((side) => side?.result);
  const referenceColor = referencePalette === "companion" ? OFFSET_COMPANION_COLORS.run : OFFSET_VIEW_COLORS.run;
  const colorOf = (side) => (side === own ? OFFSET_FOLLOWER_COLORS.run : referenceColor);
  const per = (name, value) => sides.forEach((side) => rows.push({ label: `#${side.number} ${name} · ${value(side.result)}`, color: colorOf(side) }));
  per("Roll-in Alt", (r) => `${formatFt(r.profile.public.resolvedInitialAltitudeMslFt)} ft`);
  per("Dive Angle", (r) => `${formatDeg(r.profile.canonicalInputs.diveAngleDeg)}°`);
  per("Release Alt", (r) => `${formatFt(r.profile.public.effectiveReleaseAltitudeMslFt)} ft`);
  if (reference?.result) {
    rows.push({ label: `#${reference.number} IP to Impact Time · ${formatSec(reference.result.timing.offsetIpToReleaseSec + reference.result.profile.public.bombTofSec)} s`, color: colorOf(reference) });
  }
  if (own?.result) {
    rows.push({ label: `#${own.number} IP to Release Time · ${formatSec(own.result.timing.offsetIpToReleaseSec)} s`, color: colorOf(own) });
  }
  if (reference?.result && own?.result && Number.isFinite(deltaTimeSec)) {
    rows.push({ label: `ΔTime #${reference.number} Impact − #${own.number} Release · ${formatSec(deltaTimeSec)} s`, color: OFFSET_VIEW_COLORS.time, dashed: true });
  }
  return rows;
}

